import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { readDevPlanConfig, resolveBasePathForProject } from '../../dev-plan-factory';
import type { ToolArgs } from '../tool-definitions';
import type { IDevPlanStore } from '../../dev-plan-interface';

type GetDevPlan = (projectName: string) => IDevPlanStore;

export async function handleLlmAnalyzeToolCall(name: string, args: ToolArgs, deps: { getDevPlan: GetDevPlan }): Promise<string | null> {
  const { getDevPlan } = deps;
  switch (name) {
    case 'devplan_llm_analyze': {
      const projectName = args.projectName!;
      const mode = args.mode;
      const content = args.content;
      const anchorName = args.anchorName || '';
      const customPrompt = args.customPrompt || '';

      // ---- 从 config.json 读取 LLM 分析配置 ----
      // engine 参数一键切换：cursor / ollama / models_online
      const wsConfig = readDevPlanConfig();
      const llmCfg = (wsConfig as any)?.llmAnalyze || {};
      const engine: string = llmCfg.engine || 'cursor'; // 默认 cursor

      if (!mode) {
        throw new McpError(ErrorCode.InvalidParams, 'mode is required');
      }
      if (!content) {
        throw new McpError(ErrorCode.InvalidParams, 'content is required');
      }

      // ---- engine = "cursor" → 不调用 LLM，返回提示让 Cursor 自己分析 ----
      if (engine === 'cursor') {
        return JSON.stringify({
          status: 'cursor_mode',
          projectName,
          engine: 'cursor',
          mode,
          anchorName: anchorName || undefined,
          content: content.slice(0, 500) + (content.length > 500 ? '...' : ''),
          message: 'engine=cursor: This tool is skipped. Cursor should analyze the content directly and call devplan_anchor_create / devplan_memory_save / devplan_structure_create based on its own analysis.',
          hint: {
            extract_anchors: 'Cursor should extract anchor names, types, and descriptions from the content, then call devplan_anchor_create for each.',
            determine_change: 'Cursor should determine the change type (created/upgraded/modified/deprecated/removed) and call devplan_memory_save with changeType.',
            build_structure: 'Cursor should identify components and call devplan_structure_create with the components array.',
            generate_memory: 'Cursor should generate L1 summary + L2 detail and call devplan_memory_save for each level.',
            skill_l1: 'Cursor should generate only L1 output using the latest L1 rule and return JSON with L1 plus ruleVersion.',
            skill_l2: 'Cursor should generate only L2 output using the latest L2 rule and return JSON with L2 plus key decisions.',
            skill_l3: 'Cursor should generate only L3 output using the latest L3 rule and return JSON with L3 plus structure notes.',
          }[mode] || 'Cursor should analyze the content and take appropriate action.',
          switchTo: 'To use LLM instead, set "engine": "ollama" or "engine": "models_online" in .devplan/config.json llmAnalyze section.',
        });
      }

      // ---- 根据 engine 解析 provider / model / baseUrl / apiKey ----
      let provider: string;
      let model: string;
      let baseUrl: string;
      let apiKey: string | undefined;
      let protocol: string;

      if (engine === 'ollama') {
        provider = 'ollama';
        model = args.model || llmCfg.ollamaModel || 'gemma3:27b';
        baseUrl = args.baseUrl || llmCfg.ollamaBaseUrl || 'http://localhost:11434/v1';
        apiKey = undefined;
        protocol = 'openai_compat';
      } else {
        // engine === 'models_online'
        provider = llmCfg.onlineProvider || 'deepseek';
        model = args.model || llmCfg.onlineModel || (provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4');
        baseUrl = args.baseUrl || llmCfg.onlineBaseUrl || (provider === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1');
        apiKey = llmCfg.onlineApiKey || undefined;
        protocol = llmCfg.onlineProtocol || 'openai_compat';
      }

      // ---- System prompts for each mode ----
      const systemPrompts: Record<string, string> = {
        extract_anchors: `你是一个知识图谱构建助手。请从以下文本中提取所有核心"触点"（功能模块、概念、API、架构组件等）。
每个触点需包含：name（名称）、type（module/feature/concept/api/architecture/library/protocol）、description（一句话描述）。
请以 JSON 数组格式返回，不要包含其他内容。
示例：[{"name": "SocialGraphV2", "type": "module", "description": "图结构存储引擎"}, ...]`,

        determine_change: `你是一个版本变更分析助手。请分析以下文本内容，判断触点"${anchorName}"的变更类型。
可选变更类型：created（新创建）、upgraded（功能升级）、modified（修改调整）、deprecated（弃用）、removed（移除）。
请以 JSON 格式返回：{"changeType": "...", "summary": "一句话描述变更", "detail": "详细说明", "confidence": 0.8}`,

        build_structure: `你是一个系统架构分析助手。请分析触点"${anchorName}"的结构组成，列出它依赖的所有子组件。
每个组件需包含：name（组件名）、role（角色：core/dependency/optional/adapter/config）、description（说明）。
请以 JSON 格式返回：{"components": [{"name": "...", "role": "core", "description": "..."}], "summary": "结构概述"}`,

        generate_memory: `你是一个记忆构建助手。请为触点"${anchorName}"生成多级记忆内容。
生成三个层级：
- L1（触点摘要）：一句话概括，作为记忆的"入口"
- L2（详细记忆）：3~5句话，包含关键技术细节和设计决策
- L3_index（结构索引）：列出主要组件及其关系
请以 JSON 格式返回：{"L1": "...", "L2": "...", "L3_index": "...", "suggestedTags": ["tag1", "tag2"]}`,

        skill_l1: `你是 L1 触点摘要生成器。请严格按最新 L1 规则输出：
- 只输出一个极简"触点入口"摘要（15~30字，避免细节堆叠）
- 必须可用于后续检索导航
- 不要混入 L2/L3 细节
返回 JSON：{"L1":"...","ruleVersion":"2026-02-24","notes":"..."}。`,

        skill_l2: `你是 L2 详细记忆生成器。请严格按最新 L2 规则输出：
- 输出 3~8 句话的技术细节，包含关键决策与约束
- 明确上下文、原因、取舍，不重复 L1 入口句式
- 不展开完整原文（那是 L3）
返回 JSON：{"L2":"...","keyDecisions":["..."],"ruleVersion":"2026-02-24"}。`,

        skill_l3: `你是 L3 完整内容生成器。请严格按最新 L3 规则输出：
- 提供可追溯的完整内容或核心原文片段（可较长）
- 保留结构信息（组件、关系、边界）便于深层回溯
- 不再压缩成摘要（那是 L1/L2）
返回 JSON：{"L3":"...","structureNotes":["..."],"ruleVersion":"2026-02-24"}。`,

        custom: customPrompt || '请分析以下内容并返回 JSON 格式的结果。',
      };

      const systemPrompt = systemPrompts[mode] || systemPrompts['custom'];
      const skillModes = new Set(['skill_l1', 'skill_l2', 'skill_l3']);
      const useSkillExecutor = skillModes.has(mode);

      // ---- 直接 HTTP 调用 OpenAI-Compatible API (Ollama / DeepSeek / OpenAI) ----
      // 绕过 LlmGateway NAPI 层，直接通过 HTTP 调用 LLM 推理接口
      // 这样无需 NAPI 重编译，且支持所有 OpenAI-compatible 端点

      // 验证在线模型的 API Key
      if (engine === 'models_online' && !apiKey) {
        return JSON.stringify({
          status: 'error',
          engine,
          provider,
          message: `Online provider "${provider}" requires an API key. Set onlineApiKey in .devplan/config.json:\n`
            + `{ "llmAnalyze": { "engine": "models_online", "onlineProvider": "${provider}", "onlineApiKey": "sk-..." } }`,
        });
      }

      // ---- T58.8: skill_* 模式优先走 ai_db SkillExecutor（参数映射 + 错误语义对齐）----
      if (useSkillExecutor) {
        try {
          const { LlmGateway } = require('aifastdb');
          if (!LlmGateway) {
            return JSON.stringify({
              status: 'error',
              engine,
              provider,
              model,
              errorType: 'SKILL_EXECUTOR_UNAVAILABLE',
              message: 'LlmGateway is unavailable in current aifastdb package. Please upgrade to aifastdb@2.9.8+.',
              switchTo: 'Set "engine": "cursor" to fallback to Cursor analysis.',
            });
          }

          const projectBase = resolveBasePathForProject(projectName);
          const projectRoot = path.dirname(projectBase);
          const gatewayPath = path.join(projectRoot, '.devplan', projectName, 'llm-gateway-data');
          fs.mkdirSync(gatewayPath, { recursive: true });

          const gw = new LlmGateway(gatewayPath);
          const providerId = engine === 'ollama' ? 'ollama-llm-analyze' : `online-${provider}`;
          const providerName = engine === 'ollama' ? 'Ollama (LLM Analyze)' : `${provider} (LLM Analyze)`;
          const providerBrand = engine === 'ollama' ? 'ollama' : provider;

          try {
            gw.registerProvider(
              providerId,
              providerName,
              providerBrand,
              baseUrl,
              apiKey,
              protocol,
            );
          } catch {
            // already exists
          }

          try {
            gw.registerModel(
              model,
              providerId,
              model,
              undefined,
            );
          } catch {
            // already exists
          }

          const executeSkillInline = (gw as any).executeSkillInline;
          if (typeof executeSkillInline !== 'function') {
            return JSON.stringify({
              status: 'error',
              engine,
              provider,
              model,
              errorType: 'SKILL_EXECUTOR_UNAVAILABLE',
              message: 'LlmGateway.executeSkillInline is unavailable. Please ensure aifastdb includes Phase-58 SkillExecutor APIs.',
              switchTo: 'Set "engine": "cursor" to fallback to Cursor analysis.',
            });
          }

          // 参数映射：content → prompt, model → model_name, systemPrompt → system_prompt, expect_json=true
          const skillOutput = executeSkillInline.call(gw, content, model, systemPrompt, true);
          const replyContent = skillOutput?.jsonContent || skillOutput?.content || '';
          const totalTokens = Number(skillOutput?.totalTokens || 0);
          const durationMs = Number(skillOutput?.durationMs || 0);

          if (!replyContent) {
            return JSON.stringify({
              status: 'error',
              engine,
              provider,
              model,
              errorType: 'SKILL_EMPTY_RESULT',
              message: 'SkillExecutor returned empty response.',
              switchTo: 'Set "engine": "cursor" to fallback to Cursor analysis.',
            });
          }

          let parsedResult: any = null;
          let rawContent = replyContent;
          const jsonMatch = rawContent.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
          if (jsonMatch) rawContent = jsonMatch[1].trim();
          try {
            parsedResult = JSON.parse(rawContent);
          } catch {
            parsedResult = null;
          }

          return JSON.stringify({
            status: 'ok',
            projectName,
            engine,
            mode,
            provider,
            model,
            baseUrl,
            executor: 'skill_executor',
            anchorName: anchorName || undefined,
            result: parsedResult,
            rawContent: parsedResult ? undefined : replyContent,
            tokens: {
              prompt: 0,
              completion: 0,
              total: totalTokens,
            },
            durationMs,
            message: parsedResult
              ? `SkillExecutor analysis completed (engine: ${engine}, provider: ${provider}, model: ${model}). Parsed JSON result available.`
              : `SkillExecutor analysis completed (engine: ${engine}, provider: ${provider}, model: ${model}). Raw text returned (JSON parse failed).`,
          });
        } catch (e: any) {
          const isAbort = e?.name === 'AbortError';
          const hint = isAbort
            ? `Request timed out. ${engine === 'ollama' ? 'The local model may be loading or too slow.' : 'The API server may be overloaded.'}`
            : engine === 'ollama'
              ? `Is Ollama running at ${baseUrl.replace(/\/v1\/?$/, '')}?`
              : `Check onlineApiKey in .devplan/config.json.`;
          return JSON.stringify({
            status: 'error',
            engine,
            provider,
            model,
            errorType: 'SKILL_EXECUTION_FAILED',
            message: `SkillExecutor execution failed: ${e instanceof Error ? e.message : String(e)}. ${hint}`,
            switchTo: 'Set "engine": "cursor" to fallback to Cursor analysis.',
          });
        }
      }

      try {
        let replyContent = '';
        let usage: any = {};

        if (engine === 'ollama') {
          // ---- Ollama 原生 /api/chat + 流式传输 (和 chat_api 方式一致，速度快 10 倍) ----
          const nativeBase = baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 300000); // 5 min

          const response = await fetch(nativeBase + '/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content },
              ],
              stream: true,
              keep_alive: '30m',
              options: { temperature: 0.3, num_predict: 4096 },
            }),
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (!response.ok) {
            const errText = await response.text().catch(() => 'unknown');
            return JSON.stringify({
              status: 'error',
              engine,
              provider,
              model,
              httpStatus: response.status,
              message: `Ollama API returned ${response.status}: ${errText.slice(0, 500)}. Is Ollama running at ${nativeBase}? Is model "${model}" pulled?`,
              switchTo: 'Set "engine": "cursor" to fallback to Cursor analysis.',
            });
          }

          if (!response.body) {
            return JSON.stringify({ status: 'error', engine, provider, model, message: 'No response body from Ollama.' });
          }

          // 流式读取（和 chat_api 的 iter_lines 方式一致）
          const reader = (response.body as any).getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let evalCount = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              for (const line of lines) {
                if (!line.trim()) continue;
                try {
                  const chunk = JSON.parse(line);
                  if (chunk.message?.content) replyContent += chunk.message.content;
                  if (chunk.done) {
                    evalCount = chunk.eval_count || 0;
                    usage = {
                      prompt_tokens: chunk.prompt_eval_count || 0,
                      completion_tokens: evalCount,
                      total_tokens: (chunk.prompt_eval_count || 0) + evalCount,
                    };
                  }
                } catch { /* skip unparseable lines */ }
              }
            }
          } finally {
            reader.releaseLock();
          }
          // 处理剩余 buffer
          if (buffer.trim()) {
            try {
              const c = JSON.parse(buffer);
              if (c.message?.content) replyContent += c.message.content;
              if (c.done) {
                usage = {
                  prompt_tokens: c.prompt_eval_count || 0,
                  completion_tokens: c.eval_count || 0,
                  total_tokens: (c.prompt_eval_count || 0) + (c.eval_count || 0),
                };
              }
            } catch { /* skip */ }
          }
        } else {
          // ---- Online 模型: OpenAI-compat /v1/chat/completions ----
          const requestBody = {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content },
            ],
            temperature: 0.3,
            max_tokens: 4096,
          };

          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

          const apiUrl = baseUrl.replace(/\/+$/, '') + '/chat/completions';
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 120000); // 2 min

          const response = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (!response.ok) {
            const errText = await response.text().catch(() => 'unknown');
            return JSON.stringify({
              status: 'error',
              engine,
              provider,
              model,
              httpStatus: response.status,
              message: `LLM API returned ${response.status}: ${errText.slice(0, 500)}. Check onlineApiKey and onlineModel in .devplan/config.json.`,
              switchTo: 'Set "engine": "cursor" to fallback to Cursor analysis.',
            });
          }

          const data = await response.json() as any;
          replyContent = data?.choices?.[0]?.message?.content || '';
          usage = data?.usage || {};
        }

        if (!replyContent) {
          return JSON.stringify({
            status: 'error',
            engine,
            provider,
            model,
            message: `LLM returned empty response.${engine === 'ollama' ? ' Is Ollama running?' : ''}`,
            switchTo: 'Set "engine": "cursor" to fallback to Cursor analysis.',
          });
        }

        // 尝试解析 JSON（LLM 可能返回 markdown 代码块包裹的 JSON）
        let parsedResult: any = null;
        let rawContent = replyContent;

        // 去除可能的 markdown 代码块
        const jsonMatch = rawContent.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (jsonMatch) {
          rawContent = jsonMatch[1].trim();
        }

        try {
          parsedResult = JSON.parse(rawContent);
        } catch {
          parsedResult = null;
        }

        return JSON.stringify({
          status: 'ok',
          projectName,
          engine,
          mode,
          provider,
          model,
          baseUrl,
          anchorName: anchorName || undefined,
          result: parsedResult,
          rawContent: parsedResult ? undefined : replyContent,
          tokens: {
            prompt: usage.prompt_tokens || 0,
            completion: usage.completion_tokens || 0,
            total: usage.total_tokens || 0,
          },
          message: parsedResult
            ? `LLM analysis completed (engine: ${engine}, provider: ${provider}, model: ${model}). Parsed JSON result available.`
            : `LLM analysis completed (engine: ${engine}, provider: ${provider}, model: ${model}). Raw text returned (JSON parse failed).`,
        });

      } catch (e: any) {
        const isAbort = e?.name === 'AbortError';
        const hint = isAbort
          ? `Request timed out. ${engine === 'ollama' ? 'The local model may be loading or too slow.' : 'The API server may be overloaded.'}`
          : engine === 'ollama'
            ? `Is Ollama running at ${baseUrl.replace(/\/v1\/?$/, '')}?`
            : `Check onlineApiKey in .devplan/config.json.`;
        return JSON.stringify({
          status: 'error',
          engine,
          provider,
          model,
          message: `LLM analysis failed: ${e instanceof Error ? e.message : String(e)}. ${hint}`,
          switchTo: 'Set "engine": "cursor" to fallback to Cursor analysis.',
        });
      }
    }

    // ========== Phase-59: 分相批量记忆导入处理器 ==========





    default:
      return null;
  }
}
