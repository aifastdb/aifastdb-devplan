import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { version as aifastdbDevplanVersion } from '../../../package.json';
import { getProjectEngine } from '../../dev-plan-factory';
import { safeReadDependencyVersion, safeResolveModuleFile } from '../tool-utils';
import type { ToolArgs } from '../tool-definitions';
import type { IDevPlanStore } from '../../dev-plan-interface';

type GetDevPlan = (projectName: string) => IDevPlanStore;

export async function handleCapabilitiesToolCall(name: string, args: ToolArgs, deps: { getDevPlan: GetDevPlan }): Promise<string | null> {
  const { getDevPlan } = deps;
  switch (name) {
    case 'devplan_capabilities': {
      const projectName = args.projectName!;
      const engine = getProjectEngine(projectName) || 'unknown';
      const plan = getDevPlan(projectName);
      const nativeCaps = typeof (plan as any).getNativeCapabilities === 'function'
        ? (plan as any).getNativeCapabilities()
        : {
            memoryTreeSearch: false,
            anchorExtractFromText: false,
            applyMutations: false,
          };
      const aifastdbVersion = safeReadDependencyVersion('aifastdb');
      return JSON.stringify({
        projectName,
        engine,
        packageVersions: {
          aifastdbDevplan: aifastdbDevplanVersion,
          aifastdb: aifastdbVersion,
          node: process.version,
        },
        nativeCapabilities: nativeCaps,
        notes: [
          'If packageVersions.aifastdb is new but nativeCapabilities are false, it usually indicates JS/native binary mismatch.',
          'Restart Cursor after npm install/rebuild to ensure the updated native .node is loaded.',
        ],
      }, null, 2);
    }


    case 'devplan_capabilities_verbose': {
      const projectName = args.projectName!;
      const engine = getProjectEngine(projectName) || 'unknown';
      const plan = getDevPlan(projectName);
      const nativeCaps = typeof (plan as any).getNativeCapabilities === 'function'
        ? (plan as any).getNativeCapabilities()
        : {
            memoryTreeSearch: false,
            anchorExtractFromText: false,
            applyMutations: false,
          };
      const aifastdbVersion = safeReadDependencyVersion('aifastdb');
      const aifastdbPkgJsonPath = safeResolveModuleFile('aifastdb/package.json');
      const aifastdbEntryPath = safeResolveModuleFile('aifastdb');
      const aifastdbNativePath = safeResolveModuleFile('aifastdb/aifastdb.win32-x64-msvc.node');

      const missingCapabilities = Object.entries(nativeCaps)
        .filter(([, ok]) => !ok)
        .map(([k]) => k);

      const recommendedActions: string[] = [];
      if (missingCapabilities.length > 0) {
        recommendedActions.push('Restart Cursor/IDE process to reload native .node modules.');
        recommendedActions.push('Run `npm install` in aifastdb-devplan to ensure JS and native binaries are aligned.');
        recommendedActions.push('If still failing, remove node_modules and reinstall to clear stale native artifacts.');
        recommendedActions.push('Verify loaded module paths in this output match the expected workspace (avoid global/other workspace shadowing).');
      } else {
        recommendedActions.push('All tracked native capabilities are available. ABI alignment looks healthy.');
      }

      return JSON.stringify({
        projectName,
        engine,
        packageVersions: {
          aifastdbDevplan: aifastdbDevplanVersion,
          aifastdb: aifastdbVersion,
          node: process.version,
        },
        nativeCapabilities: nativeCaps,
        missingCapabilities,
        loadedPaths: {
          aifastdbPackageJson: aifastdbPkgJsonPath,
          aifastdbEntry: aifastdbEntryPath,
          aifastdbNativeNode: aifastdbNativePath,
        },
        recommendedActions,
      }, null, 2);
    }


    default:
      return null;
  }
}
