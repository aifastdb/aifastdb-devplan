import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { ToolArgs } from '../tool-definitions';
import type { IDevPlanStore } from '../../dev-plan-interface';

type GetDevPlan = (projectName: string) => IDevPlanStore;

export async function handlePromptToolCall(name: string, args: ToolArgs, deps: { getDevPlan: GetDevPlan }): Promise<string | null> {
  const { getDevPlan } = deps;
  switch (name) {
    case 'devplan_save_prompt': {
      const projectName = args.projectName!;
      const content = args.content;
      if (!content) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: content');
      }

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).savePrompt !== 'function') {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Prompt logging requires "graph" engine. Project "${projectName}" uses a different engine.`
        );
      }

      const prompt = (plan as any).savePrompt({
        projectName,
        content,
        aiInterpretation: args.aiInterpretation,
        summary: args.summary,
        relatedTaskId: args.relatedTaskId,
        tags: args.tags,
      });

      return JSON.stringify({
        status: 'saved',
        prompt,
      }, null, 2);
    }


    case 'devplan_list_prompts': {
      const projectName = args.projectName!;
      const plan = getDevPlan(projectName);

      if (typeof (plan as any).listPrompts !== 'function') {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Prompt logging requires "graph" engine. Project "${projectName}" uses a different engine.`
        );
      }

      const prompts = (plan as any).listPrompts({
        date: args.date,
        relatedTaskId: args.relatedTaskId,
        limit: args.limit,
      });

      return JSON.stringify({
        projectName,
        count: prompts.length,
        filter: {
          date: args.date || null,
          relatedTaskId: args.relatedTaskId || null,
          limit: args.limit || null,
        },
        prompts,
      }, null, 2);
    }

    // ==================================================================
    // Memory Tools (Cursor 长期记忆)
    // ==================================================================






















    default:
      return null;
  }
}
