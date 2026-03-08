import vm from 'vm';
import { describe, expect, test } from '@jest/globals';

import { getPagesScript } from '../src/visualize/template-pages';

function extractFunction(script: string, functionName: string): string {
  const signature = `function ${functionName}(`;
  const start = script.indexOf(signature);
  if (start < 0) {
    throw new Error(`Function not found: ${functionName}`);
  }
  const braceStart = script.indexOf('{', start);
  if (braceStart < 0) {
    throw new Error(`Function body not found: ${functionName}`);
  }
  let depth = 0;
  for (let i = braceStart; i < script.length; i += 1) {
    const ch = script[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return script.slice(start, i + 1);
    }
  }
  throw new Error(`Function not terminated: ${functionName}`);
}

function createPagesContext() {
  const script = getPagesScript();
  const focusedScript = [
    extractFunction(script, 'codeIntelMapHash'),
    extractFunction(script, 'codeIntelMapUnit'),
    extractFunction(script, 'codeIntelBaseName'),
    extractFunction(script, 'codeIntelShortPath'),
    extractFunction(script, 'codeIntelFamilyKeyFromPath'),
    extractFunction(script, 'buildCodeIntelMapLayout'),
    extractFunction(script, 'buildCodeIntelAtlasLayout'),
    extractFunction(script, 'prepareCodeIntelGraphView'),
  ].join('\n');

  const context: Record<string, unknown> = {};
  vm.createContext(context);
  vm.runInContext(focusedScript, context);
  return context as Record<string, any>;
}

describe('code-intel stable map layout', () => {
  test('should drop project/symbol noise and build stable community islands coordinates', () => {
    const ctx = createPagesContext();
    const graph = {
      nodes: [
        { id: 'project:test', label: 'test', type: 'project', properties: {} },
        { id: 'community:a', label: 'Alpha', type: 'community', properties: {} },
        { id: 'community:b', label: 'Beta', type: 'community', properties: {} },
        { id: 'file:src/a/index.ts', label: 'src/a/index.ts', type: 'file', properties: { filePath: 'src/a/index.ts' } },
        { id: 'file:src/b/index.ts', label: 'src/b/index.ts', type: 'file', properties: { filePath: 'src/b/index.ts' } },
        { id: 'folder:src/a', label: 'src/a', type: 'folder', properties: { filePath: 'src/a' } },
        { id: 'process:alpha', label: 'AlphaProcess', type: 'process', properties: { communityId: 'community:a' } },
        { id: 'symbol:index', label: 'index', type: 'symbol', properties: {} },
      ],
      edges: [
        { from: 'project:test', to: 'community:a', label: 'CONTAINS', properties: {} },
        { from: 'project:test', to: 'community:b', label: 'CONTAINS', properties: {} },
        { from: 'file:src/a/index.ts', to: 'community:a', label: 'MEMBER_OF', properties: {} },
        { from: 'file:src/b/index.ts', to: 'community:b', label: 'MEMBER_OF', properties: {} },
        { from: 'file:src/a/index.ts', to: 'symbol:index', label: 'DEFINES', properties: {} },
        { from: 'file:src/a/index.ts', to: 'file:src/b/index.ts', label: 'IMPORTS', properties: {} },
        { from: 'file:src/a/index.ts', to: 'process:alpha', label: 'STEP_IN_PROCESS', properties: {} },
      ],
    };

    const prepared = ctx.prepareCodeIntelGraphView(graph);
    expect(prepared.graph.nodes.some((node: any) => node.type === 'project')).toBe(false);
    expect(prepared.graph.nodes.some((node: any) => node.type === 'symbol')).toBe(false);
    expect(prepared.graph.edges.some((edge: any) => edge.label === 'CONTAINS')).toBe(false);

    const layout = ctx.buildCodeIntelMapLayout(prepared.graph);
    expect(layout.nodes.length).toBeGreaterThanOrEqual(4);
    expect(layout.edges.some((edge: any) => edge.label === 'CONTAINS')).toBe(false);
    expect(layout.nodes.some((node: any) => node.type === 'process')).toBe(false);

    const fileNodes = layout.nodes.filter((node: any) => node.type === 'file');
    expect(fileNodes).toHaveLength(2);
    expect(fileNodes.every((node: any) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
    expect(fileNodes.some((node: any) => String(node._mapLabel || '').includes('/'))).toBe(true);

    const communityNodes = layout.nodes.filter((node: any) => node.type === 'community');
    expect(communityNodes.every((node: any) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
    expect(layout.initialScale).toBeGreaterThan(0);

    const atlas = ctx.buildCodeIntelAtlasLayout(prepared.graph);
    expect(atlas.districts.length).toBeGreaterThanOrEqual(2);
    expect(atlas.fileLabels).toHaveLength(2);
    expect(atlas.blocks.length).toBeGreaterThanOrEqual(2);
    expect(atlas.edges.some((edge: any) => edge.from === 'file:src/a/index.ts')).toBe(true);
  });
});
