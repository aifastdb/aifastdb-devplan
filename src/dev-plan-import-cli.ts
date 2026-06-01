#!/usr/bin/env node

import * as path from 'path';

import { rebuildProjectFromWal } from './dev-plan-import';
import type { DevPlanEngine } from './dev-plan-factory';

type ParsedArgs = Record<string, string | boolean>;

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    printUsage();
    return;
  }

  const archiveWal = getStringArg(args, 'archive-wal');
  const targetProject = getStringArg(args, 'target-project');

  if (!archiveWal || !targetProject) {
    printUsage('Missing required arguments: --archive-wal and --target-project');
    process.exitCode = 1;
    return;
  }

  const engineArg = getStringArg(args, 'engine');
  if (engineArg && engineArg !== 'graph' && engineArg !== 'document') {
    printUsage(`Invalid --engine value: ${engineArg}`);
    process.exitCode = 1;
    return;
  }

  const result = rebuildProjectFromWal({
    archiveWalPath: resolveInputPath(archiveWal),
    targetProjectName: targetProject,
    targetBasePath: resolveOptionalPath(getStringArg(args, 'target-base')),
    targetEngine: (engineArg as DevPlanEngine | undefined) || 'graph',
    failIfTargetExists: !Boolean(args['allow-existing']),
    includeModules: !Boolean(args['skip-modules']),
    includeTasks: !Boolean(args['skip-tasks']),
    includeDocs: !Boolean(args['skip-docs']),
    includePrompts: !Boolean(args['skip-prompts']),
    overviewFilePath: resolveOptionalPath(getStringArg(args, 'overview-file')),
  });

  const output = {
    success: result.success,
    targetProjectName: result.targetProjectName,
    targetBasePath: result.targetBasePath,
    targetEngine: result.targetEngine,
    targetDir: result.targetDir,
    archiveWalPath: result.archiveWalPath,
    stats: result.stats,
    walStats: result.walStats,
    warnings: result.warnings,
    errors: result.errors,
  };

  const text = JSON.stringify(output, null, 2);
  if (result.success) {
    console.log(text);
  } else {
    console.error(text);
    process.exitCode = 1;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function getStringArg(args: ParsedArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

function resolveInputPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
}

function resolveOptionalPath(input?: string): string | undefined {
  return input ? resolveInputPath(input) : undefined;
}

function printUsage(error?: string): void {
  if (error) {
    console.error(error);
    console.error('');
  }

  console.log(`Usage:
  aifastdb-devplan-import --archive-wal <path> --target-project <name> [options]

Required:
  --archive-wal <path>     WAL root directory that contains shard_* folders
  --target-project <name>  Project name to rebuild

Options:
  --target-base <path>     Base .devplan directory, defaults to current workspace resolution
  --overview-file <path>   Optional overview markdown file to upsert after import
  --engine <graph|document>
                           Target engine, defaults to graph
  --allow-existing         Import into an existing target directory instead of failing fast
  --skip-modules           Skip module import
  --skip-tasks             Skip main/sub task import
  --skip-docs              Skip document import
  --skip-prompts           Skip prompt import
  --help                   Show this message

Example:
  aifastdb-devplan-import ^
    --archive-wal .devplan/_archive_pre_rebuild/graph-data/wal ^
    --target-project typebutton ^
    --target-base .devplan ^
    --overview-file docs/typebutton-overview.md`);
}

main();
