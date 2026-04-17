import { describe, expect, test } from '@jest/globals';

import { generateCursorRuleTemplate } from '../src/mcp-server/cursor-rule-template';

describe('generateCursorRuleTemplate', () => {
  test('includes explicit phase id title constraints and doc search guidance', () => {
    const template = generateCursorRuleTemplate('zeroclaw');

    expect(template).toContain('### 主任务标题格式（强制）');
    expect(template).toContain('title` **必须**显式包含对应的 phase 编号前缀');
    expect(template).toContain('title: "Phase-43: DevPlan phase title prefix rule alignment"');
    expect(template).toContain('projectName: "zeroclaw"');
    expect(template).toContain('## 文档搜索约定');
    expect(template).toContain('searchBy: "id"');
    expect(template).toContain('searchBy: "title"');
    expect(template).toContain('searchBy: "content"');
    expect(template).toContain('searchBy: "auto", mode: "hybrid"');
    expect(template).not.toContain('## Anchor Merge Mode 选择规则');
  });

  test('includes batch-write read-back verification guidance to prevent MCP state loss', () => {
    const template = generateCursorRuleTemplate('zeroclaw');

    expect(template).toContain('## 批量写操作后必读回验证（防止 MCP 状态丢失）');
    expect(template).toContain('### 必须执行的兜底验证');
    expect(template).toContain('### 回滚处置');
    expect(template).toContain('### 高风险触发场景（看到这些信号时主动验证）');
    expect(template).toContain('连续 ≥ 3 次以下任意写操作之后');
    expect(template).toContain('devplan_search_tasks(projectName: "zeroclaw", query: "<刚改的 phase id>", includeSubTasks: true)');
    expect(template).toContain('devplan_get_module(projectName: "zeroclaw", moduleId: "<刚改的 module id>")');
    expect(template).toContain('Workspace folders changed');
  });
});
