import * as fs from 'fs';
import { resolveProjectName as factoryResolveProjectName } from '../dev-plan-factory';
import type { ToolArgs } from './tool-definitions';

export function safeReadDependencyVersion(depName: string): string | null {
  try {
    const pkgJsonPath = require.resolve(`${depName}/package.json`);
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

export function safeResolveModuleFile(moduleSpecifier: string): string | null {
  try {
    return require.resolve(moduleSpecifier);
  } catch {
    return null;
  }
}

/**
 * 解析 projectName
 *
 * 优先级：
 * 1. 显式传入的 projectName
 * 2. .devplan/config.json 中的 defaultProject
 * 3. 常量 DEFAULT_PROJECT_NAME ("devplan-db")
 *
 * devplan_init 例外：未提供时返回 undefined（表示列出已有计划）
 */
export function resolveProjectName(args: ToolArgs, toolName: string): string | undefined {
  if (args.projectName) return args.projectName;
  // devplan_init 不传 projectName 时 = 列出已有计划，不使用默认值
  if (toolName === 'devplan_init') return undefined;
  return factoryResolveProjectName(undefined);
}
