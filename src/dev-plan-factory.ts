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
 * .devplan/config.json 的内容格式
 *
 * 存放在 .devplan/ 根目录下（与各项目子目录同级），
 * 用于配置当前工作区的 DevPlan 默认行为。
 */
export interface DevPlanConfig {
  /** 默认项目名称（即 .devplan/ 下的子目录名） */
  defaultProject: string;
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
 * 获取默认的 DevPlan 存储基础路径
 *
 * 优先级：
 * 1. AIFASTDB_DEVPLAN_PATH 环境变量（显式指定）
 * 2. 项目内 .devplan/ 目录（天然跟随 Git 版本管理）
 * 3. 回退到用户目录 ~/.aifastdb/dev-plans/（兜底）
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
 * @param projectName - 项目名称
 * @param basePath - 存储基础路径（默认自动解析）
 * @param engine - 显式指定引擎（优先级最高）
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
  const base = basePath || getDefaultBasePath();

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

  // 创建对应的存储实例
  if (resolvedEngine === 'graph') {
    return new DevPlanGraphStore(projectName, {
      graphPath: path.join(base, projectName, 'graph-data'),
      shardCount: 4,
    });
  } else {
    return new DevPlanDocumentStore(projectName, {
      documentPath: path.join(base, projectName, 'documents.jsonl'),
      taskPath: path.join(base, projectName, 'tasks.jsonl'),
      modulePath: path.join(base, projectName, 'modules.jsonl'),
    });
  }
}

/**
 * 列出所有已有的 DevPlan 项目
 */
export function listDevPlans(basePath?: string): string[] {
  const base = basePath || getDefaultBasePath();
  try {
    const fs = require('fs');
    if (!fs.existsSync(base)) return [];
    return fs.readdirSync(base).filter((name: string) => {
      const fullPath = path.join(base, name);
      return fs.statSync(fullPath).isDirectory();
    });
  } catch {
    return [];
  }
}

/**
 * 获取项目使用的引擎类型
 */
export function getProjectEngine(projectName: string, basePath?: string): DevPlanEngine | null {
  const base = basePath || getDefaultBasePath();
  return readEngineConfig(projectName, base);
}
