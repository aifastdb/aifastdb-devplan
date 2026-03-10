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
      let sections = plan.listSections();
      const compact = args.compact === true;
      const limit = typeof args.limit === 'number' ? args.limit : undefined;
      const offset = typeof args.offset === 'number' ? args.offset : 0;
      const sortOrder = (args.sort === 'asc') ? 'asc' : 'desc'; // default desc (newest first)

      // Phase-161: Filters
      if (args.section) {
        sections = sections.filter(s => s.section === args.section);
      }
      if (args.moduleId) {
        sections = sections.filter(s => s.moduleId === args.moduleId);
      }

      // Phase-161: Sort by updatedAt
      sections.sort((a, b) => {
        const aTime = a.updatedAt || 0;
        const bTime = b.updatedAt || 0;
        return sortOrder === 'desc' ? (bTime - aTime) : (aTime - bTime);
      });

      const total = sections.length;
      const sliced = limit !== undefined ? sections.slice(offset, offset + limit) : sections.slice(offset);

      return JSON.stringify({
        projectName: args.projectName,
        count: sliced.length,
        total,
        sort: sortOrder,
        ...(limit !== undefined ? { limit, offset } : {}),
        ...(args.section ? { filterSection: args.section } : {}),
        ...(args.moduleId ? { filterModuleId: args.moduleId } : {}),
        sections: sliced.map(s => compact
          ? {
              section: s.section,
              subSection: s.subSection || null,
              title: s.title,
            }
          : {
              id: s.id,
              section: s.section,
              subSection: s.subSection || null,
              title: s.title,
              version: s.version,
              moduleId: s.moduleId || null,
              parentDoc: s.parentDoc || null,
              contentPreview: s.content.slice(0, 200) + (s.content.length > 200 ? '...' : ''),
              updatedAt: s.updatedAt,
            }
        ),
      });
    }

    case 'devplan_delete_section': {
      if (!args.projectName || !args.section) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, section');
      }

      const plan = getDevPlan(args.projectName);
      const deleted = plan.deleteSection(args.section as DevPlanSection, args.subSection);

      return JSON.stringify({
        success: deleted,
        deleted,
        projectName: args.projectName,
        section: args.section,
        subSection: args.subSection || null,
      });
    }










    case 'devplan_search_sections': {
      if (!args.projectName || !args.query) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, query');
      }

      const plan = getDevPlan(args.projectName);
      const searchMode = (args.mode as SearchMode) || 'hybrid';
      const searchModuleId = args.moduleId; // Phase-161: optional moduleId filter
      // Phase-161: request more results if moduleId filter will reduce them
      const searchLimit = searchModuleId ? Math.max((args.limit || 10) * 3, 30) : (args.limit || 10);
      const finalLimit = args.limit || 10;
      const searchMinScore = args.minScore || 0;

      // 判断是否支持高级搜索
      const isSemanticEnabled = plan.isSemanticSearchEnabled?.() ?? false;

      // Phase-161: Helper to apply moduleId post-filter
      const applyModuleFilter = <T extends { moduleId?: string }>(items: T[]): T[] => {
        if (!searchModuleId) return items;
        return items.filter(r => r.moduleId === searchModuleId);
      };

      if (plan.searchSectionsAdvanced) {
        let results = plan.searchSectionsAdvanced(args.query, {
          mode: searchMode,
          limit: searchLimit,
          minScore: searchMinScore,
        });

        // Phase-161: Post-filter by moduleId
        results = applyModuleFilter(results).slice(0, finalLimit);

        return JSON.stringify({
          projectName: args.projectName,
          query: args.query,
          mode: searchMode,
          semanticSearchEnabled: isSemanticEnabled,
          actualMode: isSemanticEnabled ? searchMode : 'literal',
          ...(searchModuleId ? { filterModuleId: searchModuleId } : {}),
          count: results.length,
          results: results.map(r => ({
            id: r.id,
            section: r.section,
            subSection: r.subSection || null,
            title: r.title,
            moduleId: r.moduleId || null,
            score: r.score ?? null,
            contentPreview: r.content.slice(0, 300) + (r.content.length > 300 ? '...' : ''),
            updatedAt: r.updatedAt,
          })),
        });
      } else {
        // 回退到基础搜索（document 引擎）
        let results = plan.searchSections(args.query, searchLimit);
        // Phase-161: Post-filter by moduleId
        const filtered = applyModuleFilter(results).slice(0, finalLimit);

        return JSON.stringify({
          projectName: args.projectName,
          query: args.query,
          mode: 'literal',
          semanticSearchEnabled: false,
          actualMode: 'literal',
          ...(searchModuleId ? { filterModuleId: searchModuleId } : {}),
          count: filtered.length,
          results: filtered.map(r => ({
            id: r.id,
            section: r.section,
            subSection: r.subSection || null,
            title: r.title,
            moduleId: r.moduleId || null,
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
