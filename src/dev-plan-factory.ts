/**
 * DevPlan 工厂函数与引擎选择
 *
 * 提供 createDevPlan() 工厂函数，根据引擎配置创建对应的存储实例。
 * 支持两种引擎：
 * - 'graph'    — DevPlanGraphStore (SocialGraphV2)，默认引擎
 * - 'document' — DevPlanDocumentStore (EnhancedDocumentStore)
 *
 * 引擎选择优先级：
 * 1. createDevPlan() 的显式 engine 参数
 * 2. .devplan/{projectName}/engine.json 中的配置
 * 3. 旧项目（已有 JSONL 数据文件）自动识别为 'document'
 * 4. 新项目默认使用 'graph'
 *
 * 多项目工作区支持：
 * 通过 .devplan/config.json 中的 projects 注册表，
 * projectName 自动路由到对应项目目录下的 .devplan/ 数据库。
 * 例如 projectName="aifastdb-devplan" → D:\xxx\aifastdb-devplan\.devplan\
 */

import * as os from 'os';
import * as path from 'path';

import type { IDevPlanStore } from './dev-plan-interface';
import { DevPlanDocumentStore } from './dev-plan-document-store';
import { DevPlanGraphStore } from './dev-plan-graph-store';

// ============================================================================
// Constants
// ============================================================================

/**
 * 默认项目名称
 *
 * 当工具调用未提供 projectName 时，使用此默认值。
 * 数据存储在 {basePath}/devplan-db/ 目录下。
 */
export const DEFAULT_PROJECT_NAME = 'devplan-db';

// ============================================================================
// Types
// ============================================================================

/** 存储引擎类型 */
export type DevPlanEngine = 'graph' | 'document';

/** engine.json 的内容格式 */
interface EngineConfig {
  engine: DevPlanEngine;
  version: string;
}

/**
 * 项目注册表条目
 *
 * 在多项目工作区中，每个 projectName 可映射到独立的项目根目录，
 * 使得 DevPlan 数据存储到对应项目自己的 .devplan/ 目录下。
 */
export interface ProjectRegistryEntry {
  /** 项目根目录的绝对路径（如 "D:\\Project\\git\\aifastdb-devplan"） */
  rootPath: string;
}

/**
 * .devplan/config.json 的内容格式
 *
 * 存放在 .devplan/ 根目录下（与各项目子目录同级），
 * 用于配置当前工作区的 DevPlan 默认行为。
 *
 * 多项目工作区：通过 projects 注册表将 projectName 路由到对应项目目录。
 */
export interface DevPlanConfig {
  /** 默认项目名称（即 .devplan/ 下的子目录名） */
  defaultProject: string;
  /** 是否启用语义搜索（graph 引擎可用时生效） */
  enableSemanticSearch?: boolean;
  /** Embedding 向量维度（默认 384） */
  embeddingDimension?: number;
  /**
   * 多项目工作区注册表：projectName → 项目根目录路径。
   *
   * 当 projectName 在此表中找到时，数据存储到对应项目的 .devplan/ 目录，
   * 而非 MCP Server 进程 cwd 解析到的默认 .devplan/ 目录。
   *
   * 示例：
   * {
   *   "ai_db": { "rootPath": "D:\\Project\\git\\ai_db" },
   *   "aifastdb-devplan": { "rootPath": "D:\\Project\\git\\aifastdb-devplan" }
   * }
   */
  projects?: Record<string, ProjectRegistryEntry>;
}

// ============================================================================
// Workspace Config (.devplan/config.json)
// ============================================================================

/**
 * 读取 .devplan/config.json 工作区配置
 *
 * @param basePath - .devplan/ 的路径（默认自动解析）
 * @returns 配置对象，不存在或解析失败时返回 null
 */
export function readDevPlanConfig(basePath?: string): DevPlanConfig | null {
  const fs = require('fs');
  const base = basePath || getDefaultBasePath();
  const configPath = path.join(base, 'config.json');

  try {
    if (!fs.existsSync(configPath)) return null;
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content) as DevPlanConfig;
    if (config.defaultProject && typeof config.defaultProject === 'string') {
      return config;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 写入 .devplan/config.json 工作区配置
 *
 * @param config - 配置对象
 * @param basePath - .devplan/ 的路径（默认自动解析）
 */
export function writeDevPlanConfig(config: DevPlanConfig, basePath?: string): void {
  const fs = require('fs');
  const base = basePath || getDefaultBasePath();

  // 确保 .devplan/ 目录存在
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }

  const configPath = path.join(base, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * 解析最终使用的 projectName
 *
 * 优先级：
 * 1. 显式传入的 projectName（非空时直接使用）
 * 2. .devplan/config.json 中的 defaultProject
 * 3. 常量 DEFAULT_PROJECT_NAME ("devplan-db")
 */
export function resolveProjectName(explicitName?: string, basePath?: string): string {
  if (explicitName) return explicitName;

  const config = readDevPlanConfig(basePath);
  if (config?.defaultProject) return config.defaultProject;

  return DEFAULT_PROJECT_NAME;
}

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * 获取默认的 DevPlan 存储基础路径（工作区级别）
 *
 * 优先级：
 * 1. AIFASTDB_DEVPLAN_PATH 环境变量（显式指定）
 * 2. 项目内 .devplan/ 目录（天然跟随 Git 版本管理）
 * 3. 回退到用户目录 ~/.aifastdb/dev-plans/（兜底）
 *
 * 注意：此函数返回 MCP Server 进程 cwd 解析到的默认 .devplan/ 路径。
 * 多项目工作区中，请优先使用 resolveBasePathForProject(projectName) 获取
 * 项目特定的 basePath。
 */
export function getDefaultBasePath(): string {
  if (process.env.AIFASTDB_DEVPLAN_PATH) {
    return process.env.AIFASTDB_DEVPLAN_PATH;
  }

  const projectRoot = findProjectRoot();
  if (projectRoot) {
    return path.join(projectRoot, '.devplan');
  }

  return path.join(os.homedir(), '.aifastdb', 'dev-plans');
}

/**
 * 根据 projectName 解析数据存储的 basePath（.devplan/ 目录路径）
 *
 * 多项目工作区核心路由函数。优先级：
 * 1. 工作区 config.json → projects[projectName].rootPath → {rootPath}/.devplan/
 * 2. 回退到默认 basePath（getDefaultBasePath()）
 *
 * 示例：
 * - resolveBasePathForProject("ai_db")
 *   → config.projects.ai_db.rootPath = "D:\\Project\\git\\ai_db"
 *   → 返回 "D:\\Project\\git\\ai_db\\.devplan"
 *
 * - resolveBasePathForProject("aifastdb-devplan")
 *   → config.projects["aifastdb-devplan"].rootPath = "D:\\Project\\git\\aifastdb-devplan"
 *   → 返回 "D:\\Project\\git\\aifastdb-devplan\\.devplan"
 *
 * - resolveBasePathForProject("unknown-project")
 *   → 注册表中未找到 → 返回 getDefaultBasePath()
 */
export function resolveBasePathForProject(projectName?: string): string {
  const defaultBase = getDefaultBasePath();

  if (!projectName) return defaultBase;

  // 读取工作区级别的 config.json（从默认 basePath）
  const workspaceConfig = readDevPlanConfig(defaultBase);
  if (workspaceConfig?.projects?.[projectName]?.rootPath) {
    const projectRootPath = workspaceConfig.projects[projectName].rootPath;

    // 验证项目根目录是否存在（优雅降级）
    const fs = require('fs');
    if (!fs.existsSync(projectRootPath)) {
      console.error(
        `[DevPlan] WARNING: Project "${projectName}" registered rootPath does not exist: ${projectRootPath}. ` +
        `Falling back to default basePath: ${defaultBase}. ` +
        `Please update .devplan/config.json projects registry or create the directory.`
      );
      return defaultBase;
    }

    const projectBasePath = path.join(projectRootPath, '.devplan');

    // 确保 .devplan/ 目录存在
    if (!fs.existsSync(projectBasePath)) {
      fs.mkdirSync(projectBasePath, { recursive: true });
    }

    return projectBasePath;
  }

  return defaultBase;
}

/**
 * 从当前工作目录向上查找项目根目录
 */
function findProjectRoot(): string | null {
  const fs = require('fs');
  let dir = process.cwd();
  const root = path.parse(dir).root;

  while (dir !== root) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

// ============================================================================
// Engine Config
// ============================================================================

/**
 * 读取项目的引擎配置
 */
function readEngineConfig(projectName: string, basePath: string): DevPlanEngine | null {
  const fs = require('fs');
  const configPath = path.join(basePath, projectName, 'engine.json');

  try {
    if (!fs.existsSync(configPath)) return null;
    const content = fs.readFileSync(configPath, 'utf-8');
    const config: EngineConfig = JSON.parse(content);
    if (config.engine === 'graph' || config.engine === 'document') {
      return config.engine;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 写入项目的引擎配置
 */
function writeEngineConfig(projectName: string, basePath: string, engine: DevPlanEngine): void {
  const fs = require('fs');
  const projectDir = path.join(basePath, projectName);

  // 确保目录存在
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  const configPath = path.join(projectDir, 'engine.json');
  const config: EngineConfig = { engine, version: '1.0.0' };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * 检测旧项目是否已有 JSONL 数据文件（说明是 document 引擎）
 */
function hasExistingDocumentData(projectName: string, basePath: string): boolean {
  const fs = require('fs');
  const projectDir = path.join(basePath, projectName);

  return (
    fs.existsSync(path.join(projectDir, 'documents.jsonl')) ||
    fs.existsSync(path.join(projectDir, 'tasks.jsonl')) ||
    fs.existsSync(path.join(projectDir, 'modules.jsonl'))
  );
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * 为项目创建 DevPlan 存储实例
 *
 * @param projectName - 项目名称（同时作为多项目工作区的路由键）
 * @param basePath - 存储基础路径（显式指定时跳过项目路由）
 * @param engine - 显式指定引擎（优先级最高）
 *
 * basePath 解析优先级：
 * 1. 显式传入 basePath → 直接使用
 * 2. 项目注册表路由 → resolveBasePathForProject(projectName)
 * 3. 默认 basePath → getDefaultBasePath()（由 cwd 决定）
 *
 * 引擎选择逻辑：
 * 1. 显式 engine 参数 → 使用指定引擎
 * 2. engine.json 已存在 → 使用配置的引擎
 * 3. 已有 JSONL 数据文件 → 自动识别为 'document'（向后兼容）
 * 4. 全新项目 → 默认使用 'graph'
 */
export function createDevPlan(
  projectName: string,
  basePath?: string,
  engine?: DevPlanEngine
): IDevPlanStore {
  // 核心变更：basePath 优先使用项目注册表路由
  const base = basePath || resolveBasePathForProject(projectName);

  // 解析引擎类型
  let resolvedEngine: DevPlanEngine;
  if (engine) {
    resolvedEngine = engine;
  } else {
    const configEngine = readEngineConfig(projectName, base);
    if (configEngine) {
      resolvedEngine = configEngine;
    } else if (hasExistingDocumentData(projectName, base)) {
      resolvedEngine = 'document';
    } else {
      resolvedEngine = 'graph';
    }
  }

  // 写入/更新引擎配置
  writeEngineConfig(projectName, base, resolvedEngine);

  // 读取语义搜索配置（优先项目自己的 config，其次工作区 config）
  const projectConfig = readDevPlanConfig(base);
  const defaultBase = getDefaultBasePath();
  const workspaceConfig = base !== defaultBase ? readDevPlanConfig(defaultBase) : null;
  const enableSemanticSearch = projectConfig?.enableSemanticSearch
    ?? workspaceConfig?.enableSemanticSearch
    ?? false;
  const embeddingDimension = projectConfig?.embeddingDimension
    ?? workspaceConfig?.embeddingDimension
    ?? 384;

  // 推导项目根目录（用于 git 操作的 cwd）
  // base 是 .devplan 目录路径（如 D:\xxx\project\.devplan），dirname 即项目根
  const gitCwd = base !== defaultBase ? path.dirname(base) : undefined;

  // 创建对应的存储实例
  if (resolvedEngine === 'graph') {
    return new DevPlanGraphStore(projectName, {
      graphPath: path.join(base, projectName, 'graph-data'),
      shardCount: 4,
      enableSemanticSearch,
      embeddingDimension,
      gitCwd,
    });
  } else {
    return new DevPlanDocumentStore(projectName, {
      documentPath: path.join(base, projectName, 'documents.jsonl'),
      taskPath: path.join(base, projectName, 'tasks.jsonl'),
      modulePath: path.join(base, projectName, 'modules.jsonl'),
      gitCwd,
    });
  }
}

/**
 * 列出所有已有的 DevPlan 项目
 *
 * 多项目工作区支持：
 * 1. 扫描默认 basePath 下的子目录
 * 2. 扫描项目注册表中每个注册项目的 .devplan/ 目录
 * 3. 去重后返回完整列表
 */
export function listDevPlans(basePath?: string): string[] {
  const fs = require('fs');
  const base = basePath || getDefaultBasePath();
  const plans = new Set<string>();

  // 1. 扫描默认 basePath 下的子目录
  try {
    if (fs.existsSync(base)) {
      fs.readdirSync(base).filter((name: string) => {
        const fullPath = path.join(base, name);
        return fs.statSync(fullPath).isDirectory();
      }).forEach((name: string) => plans.add(name));
    }
  } catch { /* ignore */ }

  // 2. 扫描项目注册表中的注册项目
  const config = readDevPlanConfig(base);
  if (config?.projects) {
    for (const [projectName, entry] of Object.entries(config.projects)) {
      try {
        const projectBase = path.join(entry.rootPath, '.devplan');
        const projectDataDir = path.join(projectBase, projectName);
        if (fs.existsSync(projectDataDir) && fs.statSync(projectDataDir).isDirectory()) {
          plans.add(projectName);
        }
      } catch { /* ignore */ }
    }
  }

  return Array.from(plans);
}

/**
 * 获取项目使用的引擎类型
 *
 * 支持项目注册表路由：自动解析项目对应的 basePath。
 */
export function getProjectEngine(projectName: string, basePath?: string): DevPlanEngine | null {
  const base = basePath || resolveBasePathForProject(projectName);
  return readEngineConfig(projectName, base);
}
