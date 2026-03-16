import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { listDevPlans, getProjectEngine, readDevPlanConfig, writeDevPlanConfig, resolveBasePathForProject, getDefaultBasePath } from '../../dev-plan-factory';
import { ALL_SECTIONS, SECTION_DESCRIPTIONS } from '../../types';
import { generateCursorRuleTemplate } from '../cursor-rule-template';
import type { ToolArgs } from '../tool-definitions';
import type { IDevPlanStore } from '../../dev-plan-interface';

type GetDevPlan = (projectName: string) => IDevPlanStore;

export async function handleInitToolCall(name: string, args: ToolArgs, deps: { getDevPlan: GetDevPlan; clearDevPlanCache: (projectName: string) => void }): Promise<string | null> {
  const { getDevPlan, clearDevPlanCache } = deps;
  switch (name) {
    case 'devplan_init': {
      if (!args.projectName) {
        // List existing plans with engine info
        const plans = listDevPlans();
        const planDetails = plans.map((name) => ({
          name,
          engine: getProjectEngine(name) || 'unknown',
        }));
        const config = readDevPlanConfig();
        return JSON.stringify({
          existingPlans: planDetails,
          configDefaultProject: config?.defaultProject || null,
          availableSections: ALL_SECTIONS,
          sectionDescriptions: SECTION_DESCRIPTIONS,
          availableEngines: ['graph', 'document'],
          defaultEngine: 'graph',
          message: plans.length > 0
            ? `Found ${plans.length} existing plan(s).${config ? ` Default project: "${config.defaultProject}".` : ''} Provide a projectName to initialize a new one.`
            : 'No existing plans. Provide a projectName to create one.',
        });
      }

      // 自动写入/更新工作区级 .devplan/config.json
      const defaultBase = getDefaultBasePath();
      const existingConfig = readDevPlanConfig(defaultBase);
      if (!existingConfig) {
        writeDevPlanConfig({
          defaultProject: args.projectName,
          enableSemanticSearch: true,
        });
      }

      // 多项目工作区：自动注册新项目到工作区 config.json 的 projects 表
      // 当项目名不在 projects 注册表中时，尝试在工作区根目录的同级查找同名目录
      // ⚠️ Phase-114 Fix: 必须在 getDevPlan() 之前完成注册，
      //    否则 resolveBasePathForProject 会回退到默认 basePath，
      //    导致数据被写入错误的项目目录下。
      let autoRegistered = false;
      const workspaceConfig = readDevPlanConfig(defaultBase) || {
        defaultProject: args.projectName,
        enableSemanticSearch: true,
      };
      if (!workspaceConfig.projects?.[args.projectName]) {
        // 尝试自动发现项目根目录：
        // 如果 defaultBase 在某个项目下 (如 D:\xxx\ai_db\.devplan)，
        // 取其父目录 (D:\xxx\) 作为工作区根，查找 D:\xxx\{projectName}\
        const devplanParent = path.dirname(defaultBase); // e.g. D:\Project\git\ai_db
        const workspaceRoot = path.dirname(devplanParent); // e.g. D:\Project\git
        const candidateRoot = path.join(workspaceRoot, args.projectName);

        if (fs.existsSync(candidateRoot) && fs.statSync(candidateRoot).isDirectory()) {
          // 找到了同名目录，自动注册到 projects 表
          if (!workspaceConfig.projects) {
            workspaceConfig.projects = {};
          }
          workspaceConfig.projects[args.projectName] = { rootPath: candidateRoot };
          writeDevPlanConfig(workspaceConfig, defaultBase);
          autoRegistered = true;
          console.error(`[devplan] Auto-registered project "${args.projectName}" → ${candidateRoot}`);
        } else {
          console.error(`[devplan] Project "${args.projectName}" not found at candidate path: ${candidateRoot}, using default basePath`);
        }
      }

      // 多项目工作区：如果项目路由到独立目录，也在该目录创建 config.json
      const projectBase = resolveBasePathForProject(args.projectName);
      if (projectBase !== defaultBase) {
        const projectLocalConfig = readDevPlanConfig(projectBase);
        if (!projectLocalConfig) {
          writeDevPlanConfig({
            defaultProject: args.projectName,
            enableSemanticSearch: true,
          }, projectBase);
          console.error(`[devplan] Created project-level config.json at ${projectBase}`);
        }
      }

      // ⚠️ Phase-114 Fix: getDevPlan 必须在自动注册之后调用。
      //    此前 getDevPlan 在注册前调用，导致 resolveBasePathForProject 找不到
      //    项目注册信息，回退到 defaultBase（如 ai_db/.devplan），
      //    新项目的 store 被缓存到错误路径，后续所有操作都写入错误目录。
      //    同时清除可能残留的旧缓存，确保使用最新的路由信息。
      clearDevPlanCache(args.projectName);
      const plan = getDevPlan(args.projectName);
      const engine = getProjectEngine(args.projectName) || 'graph';

      // 自动生成 .cursor/rules/dev-plan-management.mdc 模板
      // 默认仅首次生成；当 refreshCursorRule=true 时允许显式刷新现有模板
      let cursorRuleGenerated = false;
      let cursorRuleRefreshed = false;
      const refreshCursorRule = args.refreshCursorRule === true;
      const projectRoot = path.dirname(projectBase); // projectBase = xxx/.devplan → projectRoot = xxx
      const cursorRulesDir = path.join(projectRoot, '.cursor', 'rules');
      const cursorRuleFile = path.join(cursorRulesDir, 'dev-plan-management.mdc');

      if (projectRoot) {
        try {
          const ruleFileExists = fs.existsSync(cursorRuleFile);
          if (!ruleFileExists || refreshCursorRule) {
            if (!fs.existsSync(cursorRulesDir)) {
              fs.mkdirSync(cursorRulesDir, { recursive: true });
            }
            const ruleContent = generateCursorRuleTemplate(args.projectName);
            fs.writeFileSync(cursorRuleFile, ruleContent, 'utf-8');
            cursorRuleGenerated = !ruleFileExists;
            cursorRuleRefreshed = ruleFileExists;
            console.error(
              ruleFileExists
                ? `[devplan] Refreshed Cursor Rule template at ${cursorRuleFile}`
                : `[devplan] Generated Cursor Rule template at ${cursorRuleFile}`
            );
          }
        } catch (err) {
          console.error(`[devplan] Failed to generate Cursor Rule: ${err}`);
        }
      }

      return JSON.stringify({
        success: true,
        projectName: args.projectName,
        engine,
        basePath: projectBase,
        autoRegistered,
        cursorRuleGenerated,
        cursorRuleRefreshed,
        cursorRulePath: cursorRuleGenerated || cursorRuleRefreshed ? cursorRuleFile : null,
        configDefaultProject: readDevPlanConfig()?.defaultProject || null,
        registeredProjects: Object.keys(readDevPlanConfig(defaultBase)?.projects || {}),
        availableSections: ALL_SECTIONS,
        sectionDescriptions: SECTION_DESCRIPTIONS,
        message: autoRegistered
          ? `DevPlan initialized for "${args.projectName}" with engine "${engine}". Project auto-registered at ${projectBase}.`
          : `DevPlan initialized for "${args.projectName}" with engine "${engine}".`,
      });
    }





    case 'devplan_cleanup_duplicates': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);
      const dryRun = args.dryRun ?? false;

      if (typeof (plan as any).cleanupDuplicates !== 'function') {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Duplicate cleanup requires "graph" engine. Project "${args.projectName}" uses a different engine.`
        );
      }

      try {
        const result = (plan as any).cleanupDuplicates(dryRun);

        return JSON.stringify({
          success: true,
          dryRun,
          cleaned: result.cleaned,
          details: result.details,
          summary: result.cleaned === 0
            ? '✅ No duplicate entities found. WAL is clean.'
            : dryRun
              ? `⚠️ Found ${result.cleaned} duplicate entities (dry run, no changes made)`
              : `🧹 Cleaned ${result.cleaned} duplicate entities from WAL`,
        });
      } catch (err) {
        throw new McpError(ErrorCode.InternalError,
          err instanceof Error ? err.message : String(err));
      }
    }


    case 'devplan_repair_counts': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);
      if (typeof (plan as any).repairAllMainTaskCounts !== 'function') {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Repair counts requires "graph" engine. Project "${args.projectName}" uses a different engine.`
        );
      }

      try {
        const result = (plan as any).repairAllMainTaskCounts();
        return JSON.stringify({
          success: true,
          repaired: result.repaired,
          autoCompleted: result.autoCompleted,
          details: result.details,
          summary: result.repaired === 0
            ? '✅ All main task counts are correct. No repair needed.'
            : `🔧 Repaired ${result.repaired} main tasks (${result.autoCompleted} auto-completed)`,
        });
      } catch (err) {
        throw new McpError(ErrorCode.InternalError,
          err instanceof Error ? err.message : String(err));
      }
    }















    default:
      return null;
  }
}
