import vm from 'vm';
import { describe, expect, test } from '@jest/globals';

import { getMdViewerScript } from '../src/visualize/template-md-viewer';

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

function createMdViewerContext() {
  const script = getMdViewerScript();
  const focusedScript = extractFunction(script, 'mdvPreprocessMermaid');
  const context: Record<string, unknown> = {};
  vm.createContext(context);
  vm.runInContext(focusedScript, context);
  return context as Record<string, any>;
}

describe('visualize md viewer mermaid preprocessing', () => {
  test('quotes square node labels that contain nested brackets', () => {
    const ctx = createMdViewerContext();
    const source = 'D1[uni-id 框架自动写<br/>dcloud_appid = [ctx.APPID]]';

    const result = ctx.mdvPreprocessMermaid(source);

    expect(result).toBe('D1["uni-id 框架自动写<br/>dcloud_appid = [ctx.APPID]"]');
  });

  test('quotes square node labels that contain brace-like payload text', () => {
    const ctx = createMdViewerContext();
    const source = 'R[★ INSERT dxt_org_join<br/>{user_id, org_id=targetOrgId,<br/>user_phone}]';

    const result = ctx.mdvPreprocessMermaid(source);

    expect(result).toBe('R["★ INSERT dxt_org_join<br/>{user_id, org_id=targetOrgId,<br/>user_phone}"]');
  });

  test('keeps Mermaid special bracket shapes unchanged', () => {
    const ctx = createMdViewerContext();
    const source = 'I[/查 dxt_project_org<br/>WHERE project_id=?/]';

    const result = ctx.mdvPreprocessMermaid(source);

    expect(result).toBe(source);
  });
});
