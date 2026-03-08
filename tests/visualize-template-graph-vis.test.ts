import vm from 'vm';
import { describe, expect, test } from '@jest/globals';

import { getGraphVisScript } from '../src/visualize/template-graph-vis';

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
  for (let i = braceStart; i < script.length; i++) {
    const ch = script[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return script.slice(start, i + 1);
      }
    }
  }
  throw new Error(`Function not terminated: ${functionName}`);
}

function createGraphVisContext() {
  const script = getGraphVisScript();
  const focusedScript = [
    extractFunction(script, 'getChildDocNodeIds'),
    extractFunction(script, 'getAllDescendantDocNodeIds'),
    extractFunction(script, 'isNodeCollapsedByParent'),
  ].join('\n');
  const context: Record<string, unknown> = {
    allEdges: [],
    collapsedDocNodes: {},
  };
  vm.createContext(context);
  vm.runInContext(focusedScript, context);
  return context as Record<string, any>;
}

describe('visualize graph vis doc collapse guards', () => {
  test('should not recurse forever when doc_has_child edges form a cycle', () => {
    const ctx = createGraphVisContext();
    ctx.allEdges = [
      { from: 'doc:A', to: 'doc:B', label: 'doc_has_child' },
      { from: 'doc:B', to: 'doc:A', label: 'doc_has_child' },
    ];
    ctx.collapsedDocNodes = { 'doc:A': true };

    expect(ctx.isNodeCollapsedByParent('doc:B')).toBe(true);
    expect(typeof ctx.isNodeCollapsedByParent('doc:A')).toBe('boolean');
    expect(ctx.getAllDescendantDocNodeIds('doc:A')).toEqual(['doc:B']);
  });
});
