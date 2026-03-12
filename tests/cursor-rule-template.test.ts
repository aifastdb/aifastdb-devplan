import { describe, expect, test } from '@jest/globals';

import { generateCursorRuleTemplate } from '../src/mcp-server/cursor-rule-template';

describe('generateCursorRuleTemplate', () => {
  test('includes explicit phase id title constraints and example', () => {
    const template = generateCursorRuleTemplate('zeroclaw');

    expect(template).toContain('### 主任务标题格式（强制）');
    expect(template).toContain('title` **必须**显式包含对应的 phase 编号前缀');
    expect(template).toContain('title: "Phase-43: DevPlan phase title prefix rule alignment"');
    expect(template).toContain('projectName: "zeroclaw"');
  });
});
