import vm from 'vm';
import { describe, expect, test } from '@jest/globals';

import { getStatsModalScript } from '../src/visualize/template-stats-modal';

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

function createStatsModalContext() {
  const script = getStatsModalScript();
  const globals = script.slice(
    script.indexOf('var _statsMainTaskMoreMenu = null;'),
    script.indexOf('function findMainTaskNode('),
  );
  const focusedScript = [
    globals,
    extractFunction(script, 'closeMainTaskMoreMenu'),
    extractFunction(script, 'ensureStatsMoreMenuGlobalClose'),
    extractFunction(script, 'toggleMainTaskMoreMenu'),
  ].join('\n');

  const appendedMenus: any[] = [];
  const context: Record<string, unknown> = {
    window: {},
    document: {
      addEventListener: () => undefined,
      createElement: () => ({
        className: '',
        innerHTML: '',
        addEventListener: () => undefined,
        parentNode: null,
      }),
    },
    __appendedMenus: appendedMenus,
  };
  vm.createContext(context);
  vm.runInContext(focusedScript, context);
  return context as Record<string, any>;
}

function renderMenuHtml(status: string): string {
  const ctx = createStatsModalContext();
  const parentNode = {
    appendChild(menu: any) {
      ctx.__appendedMenus.push(menu);
      menu.parentNode = parentNode;
    },
    removeChild() {
      return undefined;
    },
  };
  const btn = { parentNode };
  ctx.toggleMainTaskMoreMenu(btn, 'phase-214', 'node-1', status);
  return ctx.__appendedMenus[0]?.innerHTML || '';
}

describe('visualize stats modal task menu', () => {
  test('should show cancelled action for in-progress main tasks', () => {
    const html = renderMenuHtml('in_progress');
    expect(html).toContain('标记为废弃');
    expect(html).not.toContain('标记为完成');
  });

  test('should keep completed action limited to pending main tasks', () => {
    const html = renderMenuHtml('pending');
    expect(html).toContain('标记为废弃');
    expect(html).toContain('标记为完成');
  });
});
