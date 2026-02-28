import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { readDevPlanConfig, resolveBasePathForProject, getDefaultBasePath } from '../../dev-plan-factory';
import { getCachePath, readBatchCache, createBatchCache, writeBatchCache, appendEntry, getCacheStats, deleteBatchCache, type BatchCacheFile, type BatchCacheEntry } from '../../batch-cache';
import type { ToolArgs } from '../tool-definitions';
import type { IDevPlanStore } from '../../dev-plan-interface';

type GetDevPlan = (projectName: string) => IDevPlanStore;

interface BackgroundTaskState {
  running: boolean;
  phase: 'A' | 'B';
  projectName: string;
  prepared: number;
  committed: number;
  total: number;
  errors: number;
  startedAt: number;
  lastProcessedAt: number;
  currentTitle: string;
  speed: string;
}
let bgTask: BackgroundTaskState | null = null;

type CursorBindingInput = {
  profile?: string;
  contentSessionId?: string;
  memorySessionId?: string;
  hookPhase?: string;
  hookName?: string;
};

function normalizeNonEmptyString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function buildCursorBindingProvenance(
  provenance: any,
  bindingInput: CursorBindingInput,
): any {
  const profile = normalizeNonEmptyString(bindingInput.profile);
  if (!profile || profile.toLowerCase() !== 'cursor') {
    return provenance;
  }
  const contentSessionId = normalizeNonEmptyString(bindingInput.contentSessionId);
  const memorySessionId = normalizeNonEmptyString(bindingInput.memorySessionId);
  if (!contentSessionId && !memorySessionId) {
    return provenance;
  }
  const hookPhase = normalizeNonEmptyString(bindingInput.hookPhase) || 'unknown';
  const hookName = normalizeNonEmptyString(bindingInput.hookName) || 'unknown';

  const next = {
    ...(provenance || {}),
    evidences: Array.isArray(provenance?.evidences) ? [...provenance.evidences] : [],
  };
  next.evidences.push({
    kind: 'cursor_session_binding',
    refId: memorySessionId,
    locator: contentSessionId ? `cursor://content/${contentSessionId}` : undefined,
    excerpt: `hook_phase=${hookPhase}; hook_name=${hookName}`,
  });
  next.note = `cursor_profile=true; hook_phase=${hookPhase}; hook_name=${hookName}`;
  return next;
}

export async function handleBatchToolCall(name: string, args: ToolArgs, deps: { getDevPlan: GetDevPlan; memorySaveMutex: { acquire(): Promise<void>; release(): void } }): Promise<string | null> {
  const { getDevPlan, memorySaveMutex } = deps;
  switch (name) {
    case 'devplan_memory_batch_prepare': {
      const projectName = args.projectName!;
      const source = (args.source as 'tasks' | 'docs' | 'both') || 'both';
      const batchLimit = typeof args.limit === 'number' ? args.limit : 1; // default: 1; 0 = 后台自动全部处理
      const resume = args.resume !== false; // default true

      // ---- 如果后台任务正在运行，返回状态 ----
      if (bgTask?.running && bgTask.phase === 'A' && bgTask.projectName === projectName) {
        const bgElapsed = ((Date.now() - bgTask.startedAt) / 1000).toFixed(0);
        const bgPercent = bgTask.total > 0 ? Math.round((bgTask.prepared / bgTask.total) * 100) : 0;
        const barLen = 20;
        const filled = Math.round((bgPercent / 100) * barLen);
        const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
        return JSON.stringify({
          status: 'background_running',
          projectName,
          message: `🚀 Phase A 后台运行中 [${bar}] ${bgPercent}% — ${bgTask.prepared}/${bgTask.total} | 当前: "${bgTask.currentTitle}" | 错误: ${bgTask.errors} | 已运行 ${bgElapsed}s`,
          progress: { prepared: bgTask.prepared, total: bgTask.total, errors: bgTask.errors, percent: `${bgPercent}%` },
          hint: 'Use devplan_memory_batch_status to check progress anytime.',
        });
      }

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).generateMemoryCandidates !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory generation requires "graph" engine. Project "${projectName}" uses a different engine.`);
      }

      // ---- 读取 LLM 配置 ----
      const wsConfig = readDevPlanConfig();
      const llmCfg = (wsConfig as any)?.llmAnalyze || {};
      const engine: string = llmCfg.engine || 'ollama';

      if (engine === 'cursor') {
        return JSON.stringify({
          status: 'error',
          message: 'batch_prepare requires an LLM engine (ollama or models_online). engine=cursor is not supported for batch processing. Set "engine": "ollama" in .devplan/config.json.',
        });
      }

      // 解析 provider / model / baseUrl / apiKey
      let provider: string;
      let model: string;
      let baseUrl: string;
      let apiKey: string | undefined;
      let protocol: string;

      if (engine === 'ollama') {
        provider = 'ollama';
        model = llmCfg.ollamaModel || 'gemma3:27b';
        baseUrl = llmCfg.ollamaBaseUrl || 'http://localhost:11434/v1';
        apiKey = undefined;
        protocol = 'openai_compat';
      } else {
        provider = llmCfg.onlineProvider || 'deepseek';
        model = llmCfg.onlineModel || 'deepseek-chat';
        baseUrl = llmCfg.onlineBaseUrl || 'https://api.deepseek.com/v1';
        apiKey = llmCfg.onlineApiKey || undefined;
        protocol = llmCfg.onlineProtocol || 'openai_compat';
      }

      if (engine === 'models_online' && !apiKey) {
        return JSON.stringify({
          status: 'error',
          message: `Online provider "${provider}" requires an API key. Set onlineApiKey in .devplan/config.json.`,
        });
      }

      // ---- T58.9: 优先接入 ai_db MemoryContentGenerator 生成 L1/L2/L3 ----
      let memoryGenGateway: any = null;
      let memoryGenReady = false;
      try {
        const { LlmGateway } = require('aifastdb');
        if (LlmGateway) {
          const projectBase = resolveBasePathForProject(projectName);
          const projectRoot = path.dirname(projectBase);
          const gatewayPath = path.join(projectRoot, '.devplan', projectName, 'llm-gateway-data');
          fs.mkdirSync(gatewayPath, { recursive: true });

          memoryGenGateway = new LlmGateway(gatewayPath);
          const providerId = engine === 'ollama' ? 'ollama-memory-generator' : `online-memory-generator-${provider}`;
          const providerName = engine === 'ollama' ? 'Ollama (Memory Generator)' : `${provider} (Memory Generator)`;
          const providerBrand = engine === 'ollama' ? 'ollama' : provider;

          try {
            memoryGenGateway.registerProvider(
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
            memoryGenGateway.registerModel(
              model,
              providerId,
              model,
              undefined,
            );
          } catch {
            // already exists
          }

          // 注册内置记忆技能（幂等），失败不阻断流程
          try {
            if (typeof memoryGenGateway.ensureMemorySkills === 'function') {
              memoryGenGateway.ensureMemorySkills();
            }
          } catch {
            // ignore and let generateMemoryContent decide availability
          }

          memoryGenReady = typeof memoryGenGateway.generateMemoryContent === 'function';
        }
      } catch {
        memoryGenGateway = null;
        memoryGenReady = false;
      }

      // ---- 获取或创建缓存 ----
      const defaultBase = getDefaultBasePath();
      const cachePath = getCachePath(defaultBase, projectName);
      let cache: BatchCacheFile | null = resume ? readBatchCache(cachePath) : null;

      if (!cache) {
        cache = createBatchCache(projectName, engine, model);
      }

      // 已准备的 sourceRef.sourceId 集合（用于跳过）
      const preparedSourceIds = new Set(
        cache.entries
          .map(e => e.sourceRef.sourceId)
          .filter((v): v is string => !!v)
      );

      // ---- 获取候选项列表（优先从缓存读取，避免每次都扫描文档/任务） ----
      let candidates: any[];
      if (cache.candidates && cache.candidates.length > 0) {
        candidates = cache.candidates;
      } else {
        const allCandidates = (plan as any).generateMemoryCandidates({
          source,
          limit: 999,
        });
        candidates = allCandidates?.candidates || [];
        cache.candidates = candidates.map((c: any) => ({
          sourceRef: c.sourceRef,
          sourceType: c.sourceType || 'doc',
          title: c.title || c.sourceTitle || c.sourceRef?.sourceId || 'unknown',
          content: c.content || '',
          contentL3: c.contentL3,
          suggestedMemoryType: c.suggestedMemoryType,
          suggestedTags: c.suggestedTags,
        }));
        writeBatchCache(cachePath, cache);
      }

      // 过滤掉已缓存的
      const pending = candidates.filter((c: any) => {
        const sid = c.sourceRef?.sourceId;
        return !sid || !preparedSourceIds.has(sid);
      });
      const totalCandidates = candidates.length;
      const alreadyPrepared = totalCandidates - pending.length;

      if (pending.length === 0) {
        cache.prepareCompletedAt = Date.now();
        writeBatchCache(cachePath, cache);
        const stats = getCacheStats(cache);
        return JSON.stringify({
          status: 'completed',
          projectName,
          message: `✅ Phase A completed! All ${totalCandidates} candidates prepared. Ready for Phase B (devplan_memory_batch_commit).`,
          progress: { prepared: totalCandidates, total: totalCandidates, percent: '100%' },
          stats,
          cachePath,
        });
      }

      // ---- LLM 调用辅助函数 ----
      const timeoutMs = engine === 'ollama' ? 300000 : 120000;

      const callLlm = async (systemPrompt: string, userContent: string): Promise<string | null> => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);

          if (engine === 'ollama') {
            const nativeBase = baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
            const res = await fetch(nativeBase + '/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model,
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userContent },
                ],
                stream: true,
                think: false,
                keep_alive: '30m',
                options: { temperature: 0.3, num_predict: 1200 },
              }),
              signal: controller.signal,
            });
            clearTimeout(timer);
            if (!res.ok || !res.body) return null;

            const reader = (res.body as any).getReader();
            const decoder = new TextDecoder();
            let result = '';
            let buffer = '';
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
                    if (chunk.message?.content) result += chunk.message.content;
                  } catch { /* skip */ }
                }
              }
            } finally {
              reader.releaseLock();
            }
            if (buffer.trim()) {
              try { const c = JSON.parse(buffer); if (c.message?.content) result += c.message.content; } catch { /* skip */ }
            }
            return result || null;
          } else {
            const apiUrl = baseUrl.replace(/\/+$/, '') + '/chat/completions';
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
            const res = await fetch(apiUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                model,
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userContent },
                ],
                temperature: 0.3,
                max_tokens: 4096,
              }),
              signal: controller.signal,
            });
            clearTimeout(timer);
            if (!res.ok) return null;
            const data = await res.json() as any;
            return data?.choices?.[0]?.message?.content || null;
          }
        } catch {
          return null;
        }
      };

      const parseJsonFromLlm = (raw: string): any => {
        let cleaned = raw;
        const jsonMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (jsonMatch) cleaned = jsonMatch[1].trim();
        try { return JSON.parse(cleaned); } catch { return null; }
      };

      const extractFilePaths = (text: string): string[] => {
        const rx = /(?:[A-Za-z]:[\\/]|\.{0,2}[\\/])[\w.\-/\\]+?\.(?:ts|tsx|js|jsx|rs|py|go|java|kt|swift|c|cc|cpp|h|hpp|json|yaml|yml|md)\b/g;
        const hits = text.match(rx) || [];
        return Array.from(new Set(hits)).slice(0, 6);
      };

      const extractCodeSnippet = (text: string): string => {
        const fence = text.match(/```[\w-]*\n([\s\S]*?)```/);
        if (fence?.[1]) return fence[1].trim().slice(0, 600);
        const lines = text.split('\n').filter(l =>
          /(function|class|const |let |var |if\s*\(|return |=>|::|impl |fn |def |public |private )/.test(l),
        );
        return lines.slice(0, 12).join('\n').trim().slice(0, 600);
      };

      const summarizeBySentences = (text: string, maxSentences: number, maxChars: number): string => {
        const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
        if (!cleaned) return '';
        const parts = cleaned.match(/[^。！？.!?]+[。！？.!?]?/g) || [cleaned];
        const picked = parts.slice(0, maxSentences).join(' ');
        return picked.slice(0, maxChars);
      };

      const enforceGranularity = (entry: any, rawContent: string): any => {
        const mt = String(entry?.memoryType || '').toLowerCase();
        const next = { ...entry };
        if (mt === 'decision' || mt === 'bugfix') {
          const paths = extractFilePaths(rawContent);
          const code = extractCodeSnippet(rawContent);
          const suffixParts: string[] = [];
          if (paths.length > 0) suffixParts.push(`\n\n[Files]\n- ${paths.join('\n- ')}`);
          if (code) suffixParts.push(`\n\n[Code Snippet]\n\`\`\`\n${code}\n\`\`\``);
          if (suffixParts.length > 0) {
            next.contentL2 = `${(next.contentL2 || '').trim()}${suffixParts.join('')}`.trim();
            next.content = next.contentL2;
          }
          return next;
        }
        if (mt === 'summary') {
          const compact = summarizeBySentences(next.contentL2 || next.content || rawContent, 3, 260);
          if (compact) {
            next.contentL2 = compact;
            next.content = compact;
          }
          return next;
        }
        if (mt === 'pattern' || mt === 'insight' || mt === 'preference') {
          const compact = summarizeBySentences(next.contentL2 || next.content || rawContent, 3, 420);
          if (compact) {
            next.contentL2 = compact;
            next.content = compact;
          }
          return next;
        }
        return next;
      };

      const systemPrompt = `你是一个记忆构建助手。请根据以下文档/任务内容生成多级记忆。
生成三个层级（必须以 JSON 返回）：
- L1（触点摘要）：一句话概括（15~30字），作为记忆的"入口"或"触点"
- L2（详细记忆）：默认 3~8句话，包含关键技术细节、设计决策、实现方案。要保留重要的技术名词和架构关系
- L3_index（结构索引）：列出主要组件、依赖关系及其作用（如果内容是技术文档）。如果是非技术内容，则提供内容的结构化摘要
- memoryType：从 decision/pattern/bugfix/insight/preference/summary 中选择最合适的类型
- importance：重要性评分 0~1
- suggestedTags：建议标签数组
- anchorName：触点名称（该记忆关联的核心概念/模块/功能）
- anchorType：触点类型（module/concept/api/architecture/feature/library/protocol）
- anchorOverview：触点概览（3~5句话的目录索引式摘要，列出该触点包含的关键子项、核心 Flow 条目、主要结构组件等。类似文件夹的 README，帮助 Agent 快速判断是否需要深入查看详情）

粒度策略（必须遵守）：
- decision/bugfix：L2 必须包含“决策或根因+修复思路+关键代码片段+文件路径”（若原文存在）
- summary：仅保留 2~3 句阶段摘要，不要堆叠实现细节
- pattern/insight/preference：保留 1~3 句结论 + 最小示例
- 不要使用旧版 L1/L2/L3 定义，按本策略输出

请严格以 JSON 格式返回：
{"L1": "...", "L2": "...", "L3_index": "...", "memoryType": "...", "importance": 0.7, "suggestedTags": [...], "anchorName": "...", "anchorType": "...", "anchorOverview": "..."}`;

      // ---- 处理单个候选的核心函数 ----
      const processOneCandidate = async (candidate: any, cacheRef: BatchCacheFile): Promise<{ ok: boolean }> => {
        const candidateSourceId = candidate.sourceRef?.sourceId;
        if (!candidateSourceId) return { ok: true };
        const title = candidate.title || candidateSourceId || 'unknown';
        const rawContent = candidate.contentL3 || candidate.content || '';

        if (!rawContent || rawContent.length < 50) {
          return { ok: true }; // 跳过过短内容
        }

        const truncated = rawContent.length > 12000
          ? rawContent.slice(0, 12000) + '\n\n[... 内容已截断，共 ' + rawContent.length + ' 字符]'
          : rawContent;

        // 1) 首选：MemoryContentGenerator（统一三层生成规则）
        if (memoryGenReady && memoryGenGateway) {
          try {
            const out = memoryGenGateway.generateMemoryContent(
              truncated,
              model,
              undefined,
              undefined,
              title,
              candidate.sourceType === 'task'
                ? `sourceRef.sourceId=${candidateSourceId}; sourceType=task`
                : `sourceRef.sourceId=${candidateSourceId}; sourceType=doc`,
            );

            const l1 = out?.l1Summary ?? out?.l1_summary;
            const l2 = out?.l2Detail ?? out?.l2_detail;
            const l3 = out?.l3Content ?? out?.l3_content;
            const tags = out?.suggestedTags ?? out?.suggested_tags;
            // Some generator implementations return anchorName/anchorType (not suggestedAnchor/suggestedAnchorType).
            // Keep backward compatibility and fallback to candidate-level suggested anchors.
            const anchor = out?.suggestedAnchor
              ?? out?.suggested_anchor
              ?? out?.anchorName
              ?? out?.anchor_name
              ?? candidate.suggestedAnchor;
            const anchorType = out?.suggestedAnchorType
              ?? out?.suggested_anchor_type
              ?? out?.anchorType
              ?? out?.anchor_type
              ?? candidate.suggestedAnchorType;
            const anchorOverview = out?.anchorOverview
              ?? out?.anchor_overview
              ?? out?.overview;

            if (l1 || l2 || l3) {
              const entry: BatchCacheEntry = {
                sourceRef: candidate.sourceRef || { sourceId: candidateSourceId },
                provenance: {
                  origin: 'batch_prepare',
                  evidences: [],
                },
                sourceType: candidate.sourceType || 'doc',
                memoryType: candidate.suggestedMemoryType || 'insight',
                contentL1: l1 || rawContent.slice(0, 100),
                contentL2: l2 || rawContent.slice(0, 500),
                contentL3: l3 || rawContent,
                content: l2 || l1 || rawContent.slice(0, 300),
                importance: 0.7,
                tags: Array.isArray(tags) ? tags : (candidate.suggestedTags || []),
                relatedTaskId: candidate.sourceType === 'task' ? candidateSourceId : undefined,
                anchorName: anchor,
                anchorType,
                anchorOverview,
                changeType: candidate.suggestedChangeType,
                title,
                preparedAt: Date.now(),
                committed: false,
              };
              const normalized = enforceGranularity(entry, rawContent);
              appendEntry(cacheRef, normalized);
              writeBatchCache(cachePath, cacheRef);
              return { ok: true };
            }
          } catch {
            // fallback to legacy prompt-based generation
          }
        }

        const llmResult = await callLlm(
          systemPrompt,
          `标题：${title}\n建议类型：${candidate.suggestedMemoryType || 'insight'}\n来源：${candidate.sourceType || 'doc'}\n\n${truncated}`,
        );

        let entry: BatchCacheEntry;
        if (!llmResult) {
          entry = {
            sourceRef: candidate.sourceRef || { sourceId: candidateSourceId },
            provenance: {
              origin: 'batch_prepare',
              evidences: [],
            },
            sourceType: candidate.sourceType || 'doc',
            memoryType: candidate.suggestedMemoryType || 'insight',
            contentL1: rawContent.slice(0, 100),
            contentL2: rawContent.slice(0, 500),
            contentL3: rawContent,
            content: rawContent.slice(0, 300),
            importance: 0.5,
            tags: candidate.suggestedTags || [],
            relatedTaskId: candidate.sourceType === 'task' ? candidateSourceId : undefined,
            anchorName: candidate.suggestedAnchor,
            anchorType: candidate.suggestedAnchorType,
            changeType: candidate.suggestedChangeType,
            title,
            preparedAt: Date.now(),
            committed: false,
          };
          entry = enforceGranularity(entry, rawContent);
          appendEntry(cacheRef, entry);
          writeBatchCache(cachePath, cacheRef);
          return { ok: false };
        }

        const parsed = parseJsonFromLlm(llmResult);
        entry = {
          sourceRef: candidate.sourceRef || { sourceId: candidateSourceId },
          provenance: {
            origin: 'batch_prepare',
            evidences: [],
          },
          sourceType: candidate.sourceType || 'doc',
          memoryType: parsed?.memoryType || candidate.suggestedMemoryType || 'insight',
          contentL1: parsed?.L1 || rawContent.slice(0, 100),
          contentL2: parsed?.L2 || rawContent.slice(0, 500),
          contentL3: rawContent,
          content: parsed?.L2 || rawContent.slice(0, 300),
          importance: parsed?.importance || 0.5,
          tags: parsed?.suggestedTags || candidate.suggestedTags || [],
          relatedTaskId: candidate.sourceType === 'task' ? candidateSourceId : undefined,
          anchorName: parsed?.anchorName || parsed?.suggestedAnchor || candidate.suggestedAnchor,
          anchorType: parsed?.anchorType || parsed?.suggestedAnchorType || candidate.suggestedAnchorType,
          anchorOverview: parsed?.anchorOverview || parsed?.overview,
          changeType: candidate.suggestedChangeType,
          title,
          preparedAt: Date.now(),
          committed: false,
        };
        entry = enforceGranularity(entry, rawContent);
        appendEntry(cacheRef, entry);
        writeBatchCache(cachePath, cacheRef);
        return { ok: true };
      };

      // ========== limit=0: 后台自动工作流 ==========
      if (batchLimit === 0) {
        // 启动后台异步循环，立即返回
        bgTask = {
          running: true,
          phase: 'A',
          projectName,
          prepared: alreadyPrepared,
          committed: 0,
          total: totalCandidates,
          errors: 0,
          startedAt: Date.now(),
          lastProcessedAt: Date.now(),
          currentTitle: pending[0]?.title || '',
          speed: '',
        };

        // Fire-and-forget: 后台循环处理所有 pending 候选
        (async () => {
          let bgErrors = 0;
          let bgProcessed = 0;
          for (const candidate of pending) {
            if (!bgTask?.running) break; // 允许外部中止
            const title = candidate.title || candidate.sourceRef?.sourceId || 'unknown';
            bgTask.currentTitle = title;

            const itemStart = Date.now();
            const result = await processOneCandidate(candidate, cache!);
            const itemElapsed = ((Date.now() - itemStart) / 1000).toFixed(1);

            bgProcessed++;
            if (!result.ok) bgErrors++;
            bgTask.prepared = alreadyPrepared + bgProcessed;
            bgTask.errors = bgErrors;
            bgTask.lastProcessedAt = Date.now();
            bgTask.speed = `${itemElapsed}s/item`;
          }

          // 完成
          cache!.prepareCompletedAt = Date.now();
          writeBatchCache(cachePath, cache!);
          bgTask!.running = false;
        })();

        return JSON.stringify({
          status: 'background_started',
          projectName,
          engine,
          model,
          message: `🚀 Phase A 后台自动工作流已启动！正在处理 ${pending.length} 个候选（已跳过 ${alreadyPrepared} 个已完成）。\n`
            + `📊 使用 devplan_memory_batch_status 随时查看实时进度。\n`
            + `⏹️ 再次调用 batch_prepare(limit=0) 可查看运行状态。`,
          progress: { prepared: alreadyPrepared, total: totalCandidates, remaining: pending.length, percent: `${Math.round((alreadyPrepared / totalCandidates) * 100)}%` },
          cachePath,
        });
      }

      // ========== limit>0: 同步处理指定数量 ==========
      const toProcess = pending.slice(0, batchLimit);
      let processed = 0;
      let errors = 0;
      const startTime = Date.now();

      for (const candidate of toProcess) {
        const result = await processOneCandidate(candidate, cache);
        processed++;
        if (!result.ok) errors++;
      }

      // 检查是否全部完成
      const allDone = pending.length <= toProcess.length;
      if (allDone) {
        cache.prepareCompletedAt = Date.now();
        writeBatchCache(cachePath, cache);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const stats = getCacheStats(cache);

      const nowPrepared = alreadyPrepared + processed;
      const percent = totalCandidates > 0 ? Math.round((nowPrepared / totalCandidates) * 100) : 100;
      const remaining = totalCandidates - nowPrepared;

      const barLen = 20;
      const filled = Math.round((percent / 100) * barLen);
      const progressBar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

      return JSON.stringify({
        status: allDone ? 'completed' : 'partial',
        projectName,
        engine,
        model,
        message: allDone
          ? `✅ Phase A completed! [${progressBar}] 100% — ${totalCandidates}/${totalCandidates} candidates processed in ${elapsed}s (${errors} errors). Cache ready for Phase B (devplan_memory_batch_commit).`
          : `🔄 Phase A: [${progressBar}] ${percent}% — ${nowPrepared}/${totalCandidates} prepared (+${processed} this batch, ${elapsed}s). ${remaining} remaining. Call again to continue.`,
        progress: {
          prepared: nowPrepared,
          total: totalCandidates,
          remaining,
          percent: `${percent}%`,
          bar: `[${progressBar}]`,
          thisBatch: processed,
          thisBatchErrors: errors,
        },
        elapsedSeconds: parseFloat(elapsed),
        stats,
        cachePath,
      });
    }


    case 'devplan_memory_batch_commit': {
      const projectName = args.projectName!;
      const commitLimit = typeof args.limit === 'number' ? args.limit : 10; // default: 10; 0 = 后台自动全部
      const dryRun = args.dryRun || false;

      // ---- 如果后台 Phase B 正在运行，返回状态 ----
      if (bgTask?.running && bgTask.phase === 'B' && bgTask.projectName === projectName) {
        const bgElapsed = ((Date.now() - bgTask.startedAt) / 1000).toFixed(0);
        const bgPercent = bgTask.total > 0 ? Math.round((bgTask.committed / bgTask.total) * 100) : 0;
        const barLen = 20;
        const filled = Math.round((bgPercent / 100) * barLen);
        const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
        return JSON.stringify({
          status: 'background_running',
          projectName,
          message: `🚀 Phase B 后台运行中 [${bar}] ${bgPercent}% — ${bgTask.committed}/${bgTask.total} | 当前: "${bgTask.currentTitle}" | 错误: ${bgTask.errors} | 已运行 ${bgElapsed}s`,
          progress: { committed: bgTask.committed, total: bgTask.total, errors: bgTask.errors, percent: `${bgPercent}%` },
          hint: 'Use devplan_memory_batch_status to check progress anytime.',
        });
      }

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).saveMemory !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory features require "graph" engine. Project "${projectName}" uses a different engine.`);
      }

      // ---- 读取缓存 ----
      const defaultBase = getDefaultBasePath();
      const cachePath = getCachePath(defaultBase, projectName);
      const cache = readBatchCache(cachePath);

      if (!cache || cache.entries.length === 0) {
        return JSON.stringify({
          status: 'error',
          message: 'No batch cache found. Run devplan_memory_batch_prepare first to generate the cache.',
          cachePath,
        });
      }

      // 获取未提交的条目
      const pendingEntries = cache.entries.filter(e => !e.committed);
      if (pendingEntries.length === 0) {
        cache.commitCompletedAt = Date.now();
        writeBatchCache(cachePath, cache);
        const stats = getCacheStats(cache);
        return JSON.stringify({
          status: 'completed',
          projectName,
          message: `Phase B already completed. All ${cache.entries.length} entries have been committed.`,
          stats,
        });
      }

      if (dryRun) {
        return JSON.stringify({
          status: 'dry_run',
          projectName,
          message: `Would commit ${pendingEntries.length} entries (${cache.entries.length} total in cache).`,
          pendingCount: pendingEntries.length,
          sampleEntries: pendingEntries.slice(0, 5).map(e => ({
            sourceId: e.sourceRef.sourceId,
            title: e.title,
            memoryType: e.memoryType,
            contentL1: e.contentL1.slice(0, 80),
          })),
        });
      }

      if (!cache.commitStartedAt) {
        cache.commitStartedAt = Date.now();
      }

      // ========== limit=0: 后台自动工作流 ==========
      if (commitLimit === 0) {
        bgTask = {
          running: true,
          phase: 'B',
          projectName,
          prepared: 0,
          committed: cache.entries.length - pendingEntries.length,
          total: cache.entries.length,
          errors: 0,
          startedAt: Date.now(),
          lastProcessedAt: Date.now(),
          currentTitle: pendingEntries[0]?.title || '',
          speed: '',
        };

        // Fire-and-forget: 后台循环提交所有 pending 条目
        (async () => {
          let bgErrors = 0;
          let bgCommitted = cache.entries.length - pendingEntries.length;
          for (const entry of pendingEntries) {
            if (!bgTask?.running) break;
            bgTask.currentTitle = entry.title || entry.sourceRef.sourceId || '';

            const itemStart = Date.now();
            await memorySaveMutex.acquire();
            try {
              const provenanceWithCursor = buildCursorBindingProvenance(entry.provenance, {
                profile: args.profile,
                contentSessionId: args.contentSessionId,
                memorySessionId: args.memorySessionId,
                hookPhase: args.hookPhase,
                hookName: args.hookName,
              });
              (plan as any).saveMemory({
                projectName,
                content: entry.content,
                memoryType: entry.memoryType as any,
                importance: entry.importance,
                tags: entry.tags,
                relatedTaskId: entry.relatedTaskId,
                sourceRef: entry.sourceRef,
                provenance: provenanceWithCursor,
                source: 'batch_import',
                contentL1: entry.contentL1,
                contentL2: entry.contentL2,
                contentL3: entry.contentL3,
                anchorName: entry.anchorName,
                anchorType: entry.anchorType,
                anchorOverview: entry.anchorOverview,
                changeType: entry.changeType,
              });
              entry.committed = true;
              entry.committedAt = Date.now();
              bgCommitted++;
            } catch (e: any) {
              entry.committed = true;
              entry.commitError = e instanceof Error ? e.message : String(e);
              bgErrors++;
              bgCommitted++;
            } finally {
              memorySaveMutex.release();
            }

            writeBatchCache(cachePath, cache);
            bgTask.committed = bgCommitted;
            bgTask.errors = bgErrors;
            bgTask.lastProcessedAt = Date.now();
            bgTask.speed = `${((Date.now() - itemStart) / 1000).toFixed(1)}s/item`;
          }

          // 完成
          cache.commitCompletedAt = Date.now();
          writeBatchCache(cachePath, cache);
          bgTask!.running = false;
        })();

        const alreadyCommitted = cache.entries.length - pendingEntries.length;
        return JSON.stringify({
          status: 'background_started',
          projectName,
          message: `🚀 Phase B 后台自动工作流已启动！正在提交 ${pendingEntries.length} 条记忆（已跳过 ${alreadyCommitted} 条已提交）。\n`
            + `📊 使用 devplan_memory_batch_status 随时查看实时进度。\n`
            + `⏹️ 再次调用 batch_commit(limit=0) 可查看运行状态。`,
          progress: { committed: alreadyCommitted, total: cache.entries.length, remaining: pendingEntries.length },
        });
      }

      // ========== limit>0: 同步处理指定数量 ==========
      const toCommit = pendingEntries.slice(0, commitLimit);
      let committed = 0;
      let commitErrors = 0;
      const startTime = Date.now();

      for (const entry of toCommit) {
        await memorySaveMutex.acquire();
        try {
          const provenanceWithCursor = buildCursorBindingProvenance(entry.provenance, {
            profile: args.profile,
            contentSessionId: args.contentSessionId,
            memorySessionId: args.memorySessionId,
            hookPhase: args.hookPhase,
            hookName: args.hookName,
          });
          (plan as any).saveMemory({
            projectName,
            content: entry.content,
            memoryType: entry.memoryType as any,
            importance: entry.importance,
            tags: entry.tags,
            relatedTaskId: entry.relatedTaskId,
            sourceRef: entry.sourceRef,
            provenance: provenanceWithCursor,
            source: 'batch_import',
            contentL1: entry.contentL1,
            contentL2: entry.contentL2,
            contentL3: entry.contentL3,
            anchorName: entry.anchorName,
            anchorType: entry.anchorType,
            anchorOverview: entry.anchorOverview,
            changeType: entry.changeType,
          });

          entry.committed = true;
          entry.committedAt = Date.now();
          committed++;
        } catch (e: any) {
          entry.committed = true;
          entry.commitError = e instanceof Error ? e.message : String(e);
          commitErrors++;
        } finally {
          memorySaveMutex.release();
        }

        writeBatchCache(cachePath, cache);
      }

      // 检查是否全部完成
      const remaining = cache.entries.filter(e => !e.committed).length;
      const totalEntries = cache.entries.length;
      const totalCommitted = totalEntries - remaining;
      if (remaining === 0) {
        cache.commitCompletedAt = Date.now();
        writeBatchCache(cachePath, cache);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const stats = getCacheStats(cache);

      const commitPercent = totalEntries > 0 ? Math.round((totalCommitted / totalEntries) * 100) : 100;
      const barLen = 20;
      const filled = Math.round((commitPercent / 100) * barLen);
      const commitBar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

      return JSON.stringify({
        status: remaining === 0 ? 'completed' : 'partial',
        projectName,
        message: remaining === 0
          ? `✅ Phase B completed! [${commitBar}] 100% — ${totalEntries}/${totalEntries} memories saved + embedded in ${elapsed}s (${commitErrors} errors). 🎉 Batch import pipeline finished!`
          : `🔄 Phase B: [${commitBar}] ${commitPercent}% — ${totalCommitted}/${totalEntries} committed (+${committed} this batch, ${elapsed}s). ${remaining} remaining. Call again to continue.`,
        progress: {
          committed: totalCommitted,
          total: totalEntries,
          remaining,
          percent: `${commitPercent}%`,
          bar: `[${commitBar}]`,
          thisBatch: committed,
          thisBatchErrors: commitErrors,
        },
        elapsedSeconds: parseFloat(elapsed),
        stats,
        hint: remaining === 0
          ? 'The batch cache can be cleared with devplan_memory_batch_status(clear: true).'
          : 'Call devplan_memory_batch_commit again to continue.',
      });
    }


    case 'devplan_memory_batch_status': {
      const projectName = args.projectName!;
      const shouldClear = args.clear || false;

      const defaultBase = getDefaultBasePath();
      const cachePath = getCachePath(defaultBase, projectName);
      const cache = readBatchCache(cachePath);

      // ---- 后台工作流实时状态 ----
      const bgInfo: any = {};
      if (bgTask && bgTask.projectName === projectName) {
        const bgElapsed = ((Date.now() - bgTask.startedAt) / 1000).toFixed(0);
        const bgPercent = bgTask.total > 0 ? Math.round((bgTask.prepared / bgTask.total) * 100) : 0;
        const barLen = 20;
        const filled = Math.round((bgPercent / 100) * barLen);
        const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
        bgInfo.backgroundTask = {
          running: bgTask.running,
          phase: bgTask.phase,
          progress: `[${bar}] ${bgPercent}% — ${bgTask.prepared}/${bgTask.total}`,
          currentTitle: bgTask.currentTitle,
          errors: bgTask.errors,
          speed: bgTask.speed,
          elapsedSeconds: parseInt(bgElapsed),
          message: bgTask.running
            ? `🚀 Phase ${bgTask.phase} 后台运行中 [${bar}] ${bgPercent}% — 当前: "${bgTask.currentTitle}" | ${bgTask.speed} | 错误: ${bgTask.errors} | 已运行 ${bgElapsed}s`
            : `✅ Phase ${bgTask.phase} 后台任务已完成 — ${bgTask.prepared}/${bgTask.total} 处理完毕，${bgTask.errors} 个错误，耗时 ${bgElapsed}s`,
        };
      }

      if (!cache) {
        return JSON.stringify({
          status: 'empty',
          projectName,
          message: 'No batch cache found. Use devplan_memory_batch_prepare to start a batch import.',
          cachePath,
          ...bgInfo,
        });
      }

      const stats = getCacheStats(cache);

      const typeBreakdown: Record<string, number> = {};
      for (const entry of cache.entries) {
        typeBreakdown[entry.memoryType] = (typeBreakdown[entry.memoryType] || 0) + 1;
      }

      const errorEntries = cache.entries.filter(e => e.commitError).map(e => ({
        sourceId: e.sourceRef.sourceId,
        title: e.title,
        error: e.commitError,
      }));

      // Phase A 进度
      const totalCandidates = cache.candidates?.length || 0;
      const preparedCount = cache.entries.length;
      const phaseAPercent = totalCandidates > 0 ? Math.round((preparedCount / totalCandidates) * 100) : (cache.prepareCompletedAt ? 100 : 0);
      const barLen = 20;
      const filledA = Math.round((phaseAPercent / 100) * barLen);
      const barA = '█'.repeat(filledA) + '░'.repeat(barLen - filledA);

      // Phase B 进度
      const committedCount = cache.entries.filter(e => e.committed).length;
      const phaseBPercent = preparedCount > 0 ? Math.round((committedCount / preparedCount) * 100) : 0;
      const filledB = Math.round((phaseBPercent / 100) * barLen);
      const barB = '█'.repeat(filledB) + '░'.repeat(barLen - filledB);

      const result: any = {
        status: 'ok',
        projectName,
        cachePath,
        stats,
        phaseA: {
          status: cache.prepareCompletedAt ? 'completed' : (bgTask?.running && bgTask.phase === 'A' ? 'background_running' : 'in_progress'),
          progress: `[${barA}] ${phaseAPercent}% — ${preparedCount}/${totalCandidates}`,
          startedAt: new Date(cache.prepareStartedAt).toISOString(),
          completedAt: cache.prepareCompletedAt ? new Date(cache.prepareCompletedAt).toISOString() : null,
          engine: cache.engine,
          model: cache.model,
        },
        phaseB: {
          status: cache.commitCompletedAt ? 'completed' : cache.commitStartedAt ? 'in_progress' : 'not_started',
          progress: `[${barB}] ${phaseBPercent}% — ${committedCount}/${preparedCount}`,
          startedAt: cache.commitStartedAt ? new Date(cache.commitStartedAt).toISOString() : null,
          completedAt: cache.commitCompletedAt ? new Date(cache.commitCompletedAt).toISOString() : null,
        },
        typeBreakdown,
        errors: errorEntries.length > 0 ? errorEntries : undefined,
        ...bgInfo,
        message: `Phase A: [${barA}] ${phaseAPercent}% (${preparedCount}/${totalCandidates}) ${cache.prepareCompletedAt ? '✅' : '🔄'} | Phase B: [${barB}] ${phaseBPercent}% (${committedCount}/${preparedCount}) ${cache.commitCompletedAt ? '✅' : cache.commitStartedAt ? '🔄' : '⏳'}`,
      };

      if (shouldClear) {
        deleteBatchCache(cachePath);
        // 同时清理后台任务状态
        if (bgTask?.projectName === projectName) {
          bgTask.running = false;
          bgTask = null;
        }
        result.cleared = true;
        result.message += ' | Cache file deleted.';
      }

      return JSON.stringify(result, null, 2);
    }


    default:
      return null;
  }
}
