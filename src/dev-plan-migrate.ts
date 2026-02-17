/**
 * DevPlan 引擎迁移工具
 *
 * 在 document（EnhancedDocumentStore）和 graph（SocialGraphV2）引擎之间迁移数据。
 *
 * 迁移流程：
 * 1. 从源引擎读取所有数据（模块 → 文档 → 主任务 → 子任务）
 * 2. 按正确顺序写入目标引擎（先模块，再文档，再主任务，最后子任务）
 * 3. 备份旧数据（可选）
 * 4. 更新 engine.json 为目标引擎
 *
 * 使用方式（MCP 工具）：
 *   devplan_migrate_engine { projectName: "ai_db", targetEngine: "graph" }
 */

import * as path from 'path';
import * as fs from 'fs';

import type { IDevPlanStore } from './dev-plan-interface';
import { DevPlanDocumentStore } from './dev-plan-document-store';
import { DevPlanGraphStore } from './dev-plan-graph-store';
import { getDefaultBasePath, type DevPlanEngine } from './dev-plan-factory';
import type {
  DevPlanDoc,
  MainTask,
  SubTask,
  Module,
  Prompt,
  DevPlanSection,
  TaskStatus,
} from './types';

// ============================================================================
// Types
// ============================================================================

/** 迁移结果 */
export interface MigrateResult {
  success: boolean;
  projectName: string;
  fromEngine: DevPlanEngine;
  toEngine: DevPlanEngine;
  /** 迁移统计 */
  stats: {
    modules: number;
    documents: number;
    mainTasks: number;
    subTasks: number;
    prompts: number;
  };
  /** 备份路径（如果启用） */
  backupPath?: string;
  /** 错误信息 */
  errors: string[];
  /** 迁移耗时（毫秒） */
  durationMs: number;
}

/** 迁移选项 */
export interface MigrateOptions {
  /** 是否备份旧数据（默认 true） */
  backup?: boolean;
  /** 是否仅预览不实际迁移（默认 false） */
  dryRun?: boolean;
}

// ============================================================================
// Migration Core
// ============================================================================

/**
 * 将项目数据从一个引擎迁移到另一个引擎
 *
 * @param projectName - 项目名称
 * @param targetEngine - 目标引擎类型
 * @param basePath - 存储基础路径（默认自动解析）
 * @param options - 迁移选项
 */
export function migrateEngine(
  projectName: string,
  targetEngine: DevPlanEngine,
  basePath?: string,
  options?: MigrateOptions
): MigrateResult {
  const startTime = Date.now();
  const base = basePath || getDefaultBasePath();
  const backup = options?.backup !== false;
  const dryRun = options?.dryRun || false;

  const errors: string[] = [];
  const stats = { modules: 0, documents: 0, mainTasks: 0, subTasks: 0, prompts: 0 };

  // 检测当前引擎
  const currentEngine = detectCurrentEngine(projectName, base);
  if (!currentEngine) {
    return {
      success: false,
      projectName,
      fromEngine: 'document',
      toEngine: targetEngine,
      stats,
      errors: [`Project "${projectName}" not found at ${base}`],
      durationMs: Date.now() - startTime,
    };
  }

  if (currentEngine === targetEngine) {
    return {
      success: true,
      projectName,
      fromEngine: currentEngine,
      toEngine: targetEngine,
      stats,
      errors: [],
      durationMs: Date.now() - startTime,
    };
  }

  // 创建源引擎实例
  const source = createStoreInstance(projectName, currentEngine, base);
  if (!source) {
    return {
      success: false,
      projectName,
      fromEngine: currentEngine,
      toEngine: targetEngine,
      stats,
      errors: [`Failed to create source store for engine "${currentEngine}"`],
      durationMs: Date.now() - startTime,
    };
  }

  // ========== 第一步：从源引擎读取所有数据 ==========

  // 读取模块
  let modules: Module[] = [];
  try {
    modules = source.listModules();
    stats.modules = modules.length;
  } catch (e) {
    errors.push(`Failed to read modules: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 读取文档
  let documents: DevPlanDoc[] = [];
  try {
    documents = source.listSections();
    stats.documents = documents.length;
  } catch (e) {
    errors.push(`Failed to read documents: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 读取主任务
  let mainTasks: MainTask[] = [];
  try {
    mainTasks = source.listMainTasks();
    stats.mainTasks = mainTasks.length;
  } catch (e) {
    errors.push(`Failed to read main tasks: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 读取子任务（按主任务分组）
  const subTasksByParent = new Map<string, SubTask[]>();
  for (const mt of mainTasks) {
    try {
      const subs = source.listSubTasks(mt.taskId);
      subTasksByParent.set(mt.taskId, subs);
      stats.subTasks += subs.length;
    } catch (e) {
      errors.push(`Failed to read sub-tasks for ${mt.taskId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 读取 Prompt 日志
  let prompts: Prompt[] = [];
  try {
    prompts = source.listPrompts();
    stats.prompts = prompts.length;
  } catch (e) {
    // listPrompts 失败不中断迁移（旧引擎可能不支持）
    errors.push(`Failed to read prompts: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (dryRun) {
    return {
      success: errors.length === 0,
      projectName,
      fromEngine: currentEngine,
      toEngine: targetEngine,
      stats,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  // ========== 第二步：备份旧数据 ==========

  let backupPath: string | undefined;
  if (backup) {
    try {
      backupPath = backupProjectData(projectName, base, currentEngine);
    } catch (e) {
      errors.push(`Backup failed: ${e instanceof Error ? e.message : String(e)}`);
      // 备份失败不中断迁移，但记录错误
    }
  }

  // ========== 第三步：创建目标引擎实例并写入数据 ==========

  const target = createStoreInstance(projectName, targetEngine, base);
  if (!target) {
    return {
      success: false,
      projectName,
      fromEngine: currentEngine,
      toEngine: targetEngine,
      stats,
      backupPath,
      errors: [...errors, `Failed to create target store for engine "${targetEngine}"`],
      durationMs: Date.now() - startTime,
    };
  }

  // 写入模块（最先写入，因为文档和任务可能引用模块）
  for (const mod of modules) {
    try {
      target.createModule({
        projectName,
        moduleId: mod.moduleId,
        name: mod.name,
        description: mod.description,
        status: mod.status,
      });
    } catch (e) {
      errors.push(`Failed to migrate module "${mod.moduleId}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 写入文档
  for (const doc of documents) {
    try {
      target.saveSection({
        projectName,
        section: doc.section as DevPlanSection,
        title: doc.title,
        content: doc.content,
        version: doc.version,
        subSection: doc.subSection,
        relatedSections: doc.relatedSections,
        moduleId: doc.moduleId,
        parentDoc: doc.parentDoc,
      });
    } catch (e) {
      errors.push(`Failed to migrate document "${doc.section}${doc.subSection ? '/' + doc.subSection : ''}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 写入主任务
  for (const mt of mainTasks) {
    try {
      target.upsertMainTask(
        {
          projectName,
          taskId: mt.taskId,
          title: mt.title,
          priority: mt.priority,
          description: mt.description,
          estimatedHours: mt.estimatedHours,
          relatedSections: mt.relatedSections,
          moduleId: mt.moduleId,
        },
        { preserveStatus: false, status: mt.status }
      );
    } catch (e) {
      errors.push(`Failed to migrate main task "${mt.taskId}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 写入子任务
  for (const mt of mainTasks) {
    const subs = subTasksByParent.get(mt.taskId) || [];
    for (const sub of subs) {
      try {
        target.upsertSubTask(
          {
            projectName,
            taskId: sub.taskId,
            parentTaskId: sub.parentTaskId,
            title: sub.title,
            estimatedHours: sub.estimatedHours,
            relatedFiles: sub.relatedFiles,
            description: sub.description,
          },
          { preserveStatus: false, status: sub.status }
        );

        // 如果子任务有 commit 锚定，需要单独设置
        if (sub.completedAtCommit && sub.status === 'completed') {
          target.updateSubTaskStatus(sub.taskId, 'completed', {
            completedAtCommit: sub.completedAtCommit,
          });
        }
      } catch (e) {
        errors.push(`Failed to migrate sub-task "${sub.taskId}": ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // 写入 Prompt 日志
  for (const p of prompts) {
    try {
      target.savePrompt({
        projectName,
        content: p.content,
        summary: p.summary,
        relatedTaskId: p.relatedTaskId,
        tags: p.tags,
      });
    } catch (e) {
      errors.push(`Failed to migrate prompt "${p.id}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 同步确保数据落盘
  try {
    target.sync();
  } catch (e) {
    // sync is best-effort
  }

  // ========== 第四步：更新 engine.json ==========

  try {
    writeEngineConfig(projectName, base, targetEngine);
  } catch (e) {
    errors.push(`Failed to update engine.json: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    success: errors.length === 0,
    projectName,
    fromEngine: currentEngine,
    toEngine: targetEngine,
    stats,
    backupPath,
    errors,
    durationMs: Date.now() - startTime,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * 检测项目当前使用的引擎类型
 */
function detectCurrentEngine(projectName: string, basePath: string): DevPlanEngine | null {
  const projectDir = path.join(basePath, projectName);

  if (!fs.existsSync(projectDir)) return null;

  // 优先读取 engine.json
  const configPath = path.join(projectDir, 'engine.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.engine === 'graph' || config.engine === 'document') {
        return config.engine;
      }
    } catch {
      // ignore parse error
    }
  }

  // 检测 JSONL 文件 → document 引擎
  if (
    fs.existsSync(path.join(projectDir, 'documents.jsonl')) ||
    fs.existsSync(path.join(projectDir, 'tasks.jsonl'))
  ) {
    return 'document';
  }

  // 检测 graph-data 目录 → graph 引擎
  if (fs.existsSync(path.join(projectDir, 'graph-data'))) {
    return 'graph';
  }

  return null;
}

/**
 * 创建存储实例
 */
function createStoreInstance(
  projectName: string,
  engine: DevPlanEngine,
  basePath: string
): IDevPlanStore | null {
  try {
    if (engine === 'graph') {
      return new DevPlanGraphStore(projectName, {
        graphPath: path.join(basePath, projectName, 'graph-data'),
        shardCount: 5,
      });
    } else {
      return new DevPlanDocumentStore(projectName, {
        documentPath: path.join(basePath, projectName, 'documents.jsonl'),
        taskPath: path.join(basePath, projectName, 'tasks.jsonl'),
        modulePath: path.join(basePath, projectName, 'modules.jsonl'),
        promptPath: path.join(basePath, projectName, 'prompts.jsonl'),
      });
    }
  } catch {
    return null;
  }
}

/**
 * 备份项目数据
 */
function backupProjectData(
  projectName: string,
  basePath: string,
  engine: DevPlanEngine
): string {
  const projectDir = path.join(basePath, projectName);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = path.join(basePath, projectName, `_backup_${engine}_${timestamp}`);

  fs.mkdirSync(backupDir, { recursive: true });

  if (engine === 'document') {
    // 备份 JSONL 文件
    const files = ['documents.jsonl', 'tasks.jsonl', 'modules.jsonl'];
    for (const file of files) {
      const src = path.join(projectDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(backupDir, file));
      }
    }
  } else if (engine === 'graph') {
    // 备份 graph-data 目录
    const graphDir = path.join(projectDir, 'graph-data');
    if (fs.existsSync(graphDir)) {
      copyDirSync(graphDir, path.join(backupDir, 'graph-data'));
    }
  }

  // 备份 engine.json
  const engineJson = path.join(projectDir, 'engine.json');
  if (fs.existsSync(engineJson)) {
    fs.copyFileSync(engineJson, path.join(backupDir, 'engine.json'));
  }

  return backupDir;
}

/**
 * 递归复制目录
 */
function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 写入 engine.json
 */
function writeEngineConfig(projectName: string, basePath: string, engine: DevPlanEngine): void {
  const projectDir = path.join(basePath, projectName);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }
  const configPath = path.join(projectDir, 'engine.json');
  const config = { engine, version: '1.0.0' };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
