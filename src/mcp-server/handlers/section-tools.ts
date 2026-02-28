import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { ToolArgs } from '../tool-definitions';
import type { IDevPlanStore } from '../../dev-plan-interface';
import type { DevPlanSection, SearchMode } from '../../types';

type GetDevPlan = (projectName: string) => IDevPlanStore;

export async function handleSectionToolCall(name: string, args: ToolArgs, deps: { getDevPlan: GetDevPlan }): Promise<string | null> {
  const { getDevPlan } = deps;
  switch (name) {
    case 'devplan_save_section': {
      if (!args.projectName || !args.section || !args.title || !args.content) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, section, title, content');
      }
      const sectionName = String(args.section);
      const normalizedSubSection = typeof args.subSection === 'string'
        ? args.subSection.trim()
        : '';
      // Guardrail: multi-doc sections should always provide subSection in MCP writes.
      // This prevents accidental root writes when callers intended to create a new sub document.
      if ((sectionName === 'technical_notes' || sectionName === 'custom') && !normalizedSubSection) {
        throw new McpError(
          ErrorCode.InvalidParams,
          [
            `For section "${sectionName}", "subSection" is required in devplan_save_section.`,
            'Reason: this section supports multiple documents; omitting subSection can cause ambiguous writes.',
            `Example: section="${sectionName}", subSection="your-topic-slug".`,
          ].join(' ')
        );
      }

      const plan = getDevPlan(args.projectName);
      const id = plan.saveSection({
        projectName: args.projectName,
        section: args.section as DevPlanSection,
        title: args.title,
        content: args.content,
        version: args.version,
        subSection: normalizedSubSection || undefined,
        moduleId: args.moduleId,
        relatedTaskIds: args.relatedTaskIds,
        parentDoc: args.parentDoc,
      });

      return JSON.stringify({
        success: true,
        documentId: id,
        projectName: args.projectName,
        section: args.section,
        subSection: normalizedSubSection || null,
        title: args.title,
      });
    }


    case 'devplan_get_section': {
      if (!args.projectName || !args.section) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, section');
      }

      const plan = getDevPlan(args.projectName);
      const doc = plan.getSection(args.section as DevPlanSection, args.subSection);

      if (!doc) {
        return JSON.stringify({
          found: false,
          message: `Section "${args.section}"${args.subSection ? ` (${args.subSection})` : ''} not found for project "${args.projectName}"`,
        });
      }

      return JSON.stringify({
        found: true,
        document: doc,
      });
    }


    case 'devplan_list_sections': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);
      const sections = plan.listSections();

      return JSON.stringify({
        projectName: args.projectName,
        count: sections.length,
        sections: sections.map(s => ({
          id: s.id,
          section: s.section,
          subSection: s.subSection || null,
          title: s.title,
          version: s.version,
          parentDoc: s.parentDoc || null,
          contentPreview: s.content.slice(0, 200) + (s.content.length > 200 ? '...' : ''),
          updatedAt: s.updatedAt,
        })),
      });
    }










    case 'devplan_search_sections': {
      if (!args.projectName || !args.query) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, query');
      }

      const plan = getDevPlan(args.projectName);
      const searchMode = (args.mode as SearchMode) || 'hybrid';
      const searchLimit = args.limit || 10;
      const searchMinScore = args.minScore || 0;

      // 判断是否支持高级搜索
      const isSemanticEnabled = plan.isSemanticSearchEnabled?.() ?? false;

      if (plan.searchSectionsAdvanced) {
        const results = plan.searchSectionsAdvanced(args.query, {
          mode: searchMode,
          limit: searchLimit,
          minScore: searchMinScore,
        });

        return JSON.stringify({
          projectName: args.projectName,
          query: args.query,
          mode: searchMode,
          semanticSearchEnabled: isSemanticEnabled,
          actualMode: isSemanticEnabled ? searchMode : 'literal',
          count: results.length,
          results: results.map(r => ({
            id: r.id,
            section: r.section,
            subSection: r.subSection || null,
            title: r.title,
            score: r.score ?? null,
            contentPreview: r.content.slice(0, 300) + (r.content.length > 300 ? '...' : ''),
            updatedAt: r.updatedAt,
          })),
        });
      } else {
        // 回退到基础搜索（document 引擎）
        const results = plan.searchSections(args.query, searchLimit);
        return JSON.stringify({
          projectName: args.projectName,
          query: args.query,
          mode: 'literal',
          semanticSearchEnabled: false,
          actualMode: 'literal',
          count: results.length,
          results: results.map(r => ({
            id: r.id,
            section: r.section,
            subSection: r.subSection || null,
            title: r.title,
            score: null,
            contentPreview: r.content.slice(0, 300) + (r.content.length > 300 ? '...' : ''),
            updatedAt: r.updatedAt,
          })),
        });
      }
    }


    case 'devplan_rebuild_index': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);

      if (!plan.rebuildIndex) {
        return JSON.stringify({
          success: false,
          error: `Rebuild index is only available for projects using the "graph" engine with enableSemanticSearch enabled. Use .devplan/config.json to enable.`,
          hint: 'Add { "enableSemanticSearch": true } to .devplan/config.json and restart.',
        });
      }

      const isSemanticEnabled = plan.isSemanticSearchEnabled?.() ?? false;
      if (!isSemanticEnabled) {
        return JSON.stringify({
          success: false,
          error: 'Semantic search is not enabled or VibeSynapse initialization failed.',
          hint: 'Ensure enableSemanticSearch is true in .devplan/config.json and VibeSynapse (Candle MiniLM) can initialize successfully.',
        });
      }

      try {
        const result = plan.rebuildIndex();
        const docStatus = result.failed === 0 ? '[OK]' : '[WARN]';
        const memStatus = result.memories && result.memories.failed === 0 ? '[OK]' : '[WARN]';
        const memInfo = result.memories
          ? ` | Memories: ${memStatus} ${result.memories.indexed}/${result.memories.total} indexed` +
            (result.memories.failed > 0 ? ` (${result.memories.failed} failed)` : '')
          : '';

        return JSON.stringify({
          success: true,
          ...result,
          summary: `${docStatus} Docs: ${result.indexed}/${result.total} indexed${memInfo} | ${result.durationMs}ms.` +
            (result.failed > 0 ? ` ${result.failed} doc(s) failed.` : ''),
        });
      } catch (err) {
        throw new McpError(ErrorCode.InternalError,
          err instanceof Error ? err.message : String(err));
      }
    }

    // ==================================================================
    // Autopilot Tool Handlers
    // ==================================================================


    default:
      return null;
  }
}
