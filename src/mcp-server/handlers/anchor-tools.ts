import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import type { ToolArgs } from '../tool-definitions';
import type { IDevPlanStore } from '../../dev-plan-interface';

type GetDevPlan = (projectName: string) => IDevPlanStore;

export async function handleAnchorToolCall(name: string, args: ToolArgs, deps: { getDevPlan: GetDevPlan }): Promise<string | null> {
  const { getDevPlan } = deps;

  switch (name) {
    case 'devplan_anchor_list': {
      const projectName = args.projectName!;
      const plan = getDevPlan(projectName);
      const g = (plan as any).graph as any;

      if (!g || typeof g.anchorList !== 'function') {
        return JSON.stringify({
          status: 'unsupported',
          message: 'Anchor API requires aifastdb with Phase-122 NAPI bindings. Please update aifastdb and rebuild.',
          anchors: [],
        });
      }

      const anchorTypes = args.anchorType
        ? [args.anchorType]
        : ['module', 'concept', 'api', 'architecture', 'feature', 'library', 'protocol'];

      const allAnchors: any[] = [];
      for (const aType of anchorTypes) {
        try {
          const anchors = g.anchorList(aType);
          if (anchors && anchors.length > 0) {
            allAnchors.push(...anchors);
          }
        } catch {
          // 该类型无触点，静默跳过
        }
      }

      // 按 flow_count 降序排列
      allAnchors.sort((a: any, b: any) => (b.flow_count || 0) - (a.flow_count || 0));

      return JSON.stringify({
        status: 'ok',
        projectName,
        totalAnchors: allAnchors.length,
        anchors: allAnchors.map((a: any) => ({
          id: a.id,
          name: a.name,
          type: a.anchor_type,
          description: a.description,
          overview: a.overview || null,
          version: a.version,
          status: a.status,
          flowCount: a.flow_count,
          createdAt: a.created_at,
          updatedAt: a.updated_at,
        })),
      });
    }


    case 'devplan_flow_query': {
      const projectName = args.projectName!;
      const anchorName = args.anchorName;
      if (!anchorName) {
        throw new McpError(ErrorCode.InvalidParams, 'anchorName is required');
      }

      const plan = getDevPlan(projectName);
      const g = (plan as any).graph as any;

      if (!g || typeof g.anchorFindByName !== 'function' || typeof g.flowQuery !== 'function') {
        return JSON.stringify({
          status: 'unsupported',
          message: 'Flow query requires aifastdb with Phase-122 NAPI bindings.',
          entries: [],
        });
      }

      // 查找触点
      let anchor: any = null;
      try {
        if (args.anchorType) {
          anchor = g.anchorFind(anchorName, args.anchorType);
        } else {
          anchor = g.anchorFindByName(anchorName);
        }
      } catch {
        // 未找到
      }

      if (!anchor) {
        return JSON.stringify({
          status: 'not_found',
          message: `Anchor "${anchorName}" not found.`,
          entries: [],
        });
      }

      // 查询记忆流
      let entries: any[] = [];
      try {
        const filter: any = {};
        if (args.changeType) filter.changeType = args.changeType;
        if (args.limit) filter.limit = args.limit;
        filter.newestFirst = args.newestFirst !== false; // 默认 true
        entries = g.flowQuery(anchor.id, filter) || [];
      } catch (e) {
        return JSON.stringify({
          status: 'error',
          message: `Flow query failed: ${e instanceof Error ? e.message : String(e)}`,
          entries: [],
        });
      }

      return JSON.stringify({
        status: 'ok',
        projectName,
        anchor: {
          id: anchor.id,
          name: anchor.name,
          type: anchor.anchor_type,
          version: anchor.version,
          status: anchor.status,
          flowCount: anchor.flow_count,
        },
        totalEntries: entries.length,
        entries: entries.map((e: any) => ({
          id: e.id,
          version: e.version,
          changeType: e.change_type,
          summary: e.summary,
          detail: e.detail,
          sourceTask: e.source_task,
          prevEntryId: e.prev_entry_id,
          createdAt: e.created_at,
        })),
      });
    }


    case 'devplan_structure_diff': {
      const projectName = args.projectName!;
      const anchorName = args.anchorName;
      if (!anchorName) {
        throw new McpError(ErrorCode.InvalidParams, 'anchorName is required');
      }

      const plan = getDevPlan(projectName);
      const g = (plan as any).graph as any;

      if (!g || typeof g.anchorFindByName !== 'function' || typeof g.structureDiff !== 'function') {
        return JSON.stringify({
          status: 'unsupported',
          message: 'Structure diff requires aifastdb with Phase-122 NAPI bindings.',
        });
      }

      // 查找触点
      let anchor: any = null;
      try {
        if (args.anchorType) {
          anchor = g.anchorFind(anchorName, args.anchorType);
        } else {
          anchor = g.anchorFindByName(anchorName);
        }
      } catch {
        // 未找到
      }

      if (!anchor) {
        return JSON.stringify({
          status: 'not_found',
          message: `Anchor "${anchorName}" not found.`,
        });
      }

      // 结构差异比较
      const fromVersion = args.fromVersion ?? Math.max(1, (anchor.version || 1) - 1);
      const toVersion = args.toVersion ?? (anchor.version || 1);

      let diff: any = null;
      try {
        diff = g.structureDiff(anchor.id, fromVersion, toVersion);
      } catch (e) {
        return JSON.stringify({
          status: 'error',
          message: `Structure diff failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }

      if (!diff) {
        return JSON.stringify({
          status: 'no_data',
          message: `No structure snapshots found for "${anchorName}" between versions ${fromVersion} and ${toVersion}.`,
          anchor: { id: anchor.id, name: anchor.name, version: anchor.version },
        });
      }

      return JSON.stringify({
        status: 'ok',
        projectName,
        anchor: {
          id: anchor.id,
          name: anchor.name,
          type: anchor.anchor_type,
          version: anchor.version,
        },
        diff: {
          fromVersion: diff.from_version,
          toVersion: diff.to_version,
          added: diff.added || [],
          removed: diff.removed || [],
          changed: diff.changed || [],
          unchanged: diff.unchanged || [],
        },
        summary: `${(diff.added || []).length} added, ${(diff.removed || []).length} removed, ${(diff.changed || []).length} changed, ${(diff.unchanged || []).length} unchanged`,
      });
    }


    case 'devplan_structure_create': {
      const projectName = args.projectName!;
      const anchorName = args.anchorName;
      const components = args.components;

      if (!anchorName) {
        throw new McpError(ErrorCode.InvalidParams, 'anchorName is required');
      }
      if (!components || components.length === 0) {
        throw new McpError(ErrorCode.InvalidParams, 'components is required and must be non-empty');
      }

      const plan = getDevPlan(projectName);
      const g = (plan as any).graph as any;

      if (!g || typeof g.anchorFindByName !== 'function' || typeof g.structureSnapshot !== 'function') {
        return JSON.stringify({
          status: 'unsupported',
          message: 'Structure create requires aifastdb with Phase-122 NAPI bindings.',
        });
      }

      // Step 1: 查找触点
      let anchor: any = null;
      try {
        if (args.anchorType) {
          anchor = g.anchorFind(anchorName, args.anchorType);
        } else {
          anchor = g.anchorFindByName(anchorName);
        }
      } catch { /* 未找到 */ }

      if (!anchor) {
        return JSON.stringify({
          status: 'not_found',
          message: `Anchor "${anchorName}" not found. Create it first with devplan_memory_save(anchorName: "${anchorName}").`,
        });
      }

      // Step 2: 获取或创建 FlowEntry（L3 结构快照必须关联一个 L2 流条目）
      let flowEntry: any = null;
      try {
        // 尝试获取最新的流条目
        flowEntry = g.flowLatest(anchor.id);
      } catch { /* 无流条目 */ }

      if (!flowEntry) {
        // 自动创建一条流条目，用于挂载结构快照
        try {
          const desc = args.description || `Structure snapshot for ${anchorName}`;
          flowEntry = g.flowAppend(
            anchor.id,
            'modified',
            desc.slice(0, 80),
            desc,
            null, // sourceTask
          );
        } catch (e) {
          return JSON.stringify({
            status: 'error',
            message: `Failed to create FlowEntry for structure: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }

      if (!flowEntry) {
        return JSON.stringify({
          status: 'error',
          message: 'Could not find or create a FlowEntry to attach the structure snapshot.',
        });
      }

      // Step 3: 创建结构快照
      let snapshot: any = null;
      try {
        snapshot = g.structureSnapshot(
          flowEntry.id,
          anchor.id,
          flowEntry.version || anchor.version || 1,
          components.map((c: any) => ({
            anchorId: c.anchorId,
            role: c.role,
            versionHint: c.versionHint,
          })),
        );
      } catch (e) {
        return JSON.stringify({
          status: 'error',
          message: `structureSnapshot failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }

      if (!snapshot) {
        return JSON.stringify({
          status: 'error',
          message: 'structureSnapshot returned null — possible NAPI compatibility issue.',
        });
      }

      return JSON.stringify({
        status: 'ok',
        projectName,
        anchor: {
          id: anchor.id,
          name: anchor.name,
          type: anchor.anchor_type,
          version: anchor.version,
        },
        flowEntry: {
          id: flowEntry.id,
          version: flowEntry.version,
          changeType: flowEntry.change_type,
        },
        snapshot: {
          id: snapshot.id,
          version: snapshot.version,
          componentsCount: snapshot.components?.length || components.length,
          components: snapshot.components || components,
        },
        message: `Structure snapshot created for "${anchorName}" with ${components.length} components at version ${flowEntry.version || anchor.version || 1}.`,
      });
    }

    // ==================================================================
    // Phase-57B: 触点驱动记忆构建工具集
    // ==================================================================


    case 'devplan_anchor_create': {
      const projectName = args.projectName!;
      const anchorName = args.anchorName;
      const anchorType = args.anchorType || 'concept';
      const description = args.description || '';

      if (!anchorName) {
        throw new McpError(ErrorCode.InvalidParams, 'anchorName is required');
      }

      const plan = getDevPlan(projectName);
      const g = (plan as any).graph as any;

      if (!g || typeof g.anchorUpsert !== 'function') {
        return JSON.stringify({
          status: 'unsupported',
          message: 'Anchor create requires aifastdb with Phase-122 NAPI bindings.',
        });
      }

      // Step 1: 检查触点是否已存在
      let existing: any = null;
      try {
        existing = g.anchorFind(anchorName, anchorType);
      } catch { /* not found */ }

      if (existing) {
        return JSON.stringify({
          status: 'already_exists',
          projectName,
          anchor: {
            id: existing.id,
            name: existing.name,
            type: existing.anchor_type || anchorType,
            version: existing.version,
            description: existing.description,
          },
          message: `Anchor "${anchorName}" (type: ${anchorType}) already exists. Use devplan_memory_save(anchorName=...) to attach memories, or devplan_anchor_query to view full info.`,
        });
      }

      // Step 2: 创建触点
      let anchor: any = null;
      try {
        anchor = g.anchorUpsert(anchorName, anchorType, description || anchorName);
      } catch (e) {
        return JSON.stringify({
          status: 'error',
          message: `anchorUpsert failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }

      if (!anchor) {
        return JSON.stringify({
          status: 'error',
          message: 'anchorUpsert returned null — possible NAPI compatibility issue.',
        });
      }

      // Step 2.5 (Phase-63): 设置 Anchor Overview（如果提供）
      const anchorOverview = args.anchorOverview || args.overview;
      if (anchorOverview && typeof g.anchorUpdateOverview === 'function') {
        try {
          g.anchorUpdateOverview(anchor.id, anchorOverview);
        } catch (e) {
          console.warn(`[devplan_anchor_create] anchorUpdateOverview failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // Step 3: 可选 — 创建初始 FlowEntry
      let flowEntry: any = null;
      const changeType = args.changeType || 'created';
      const flowSummary = args.flowSummary || description || `${anchorName} ${changeType}`;
      const flowDetail = args.flowDetail || '';

      try {
        flowEntry = g.flowAppend(
          anchor.id,
          changeType,
          flowSummary.slice(0, 80),
          flowDetail || flowSummary,
          null, // sourceTask
        );
      } catch (e) {
        // FlowEntry 创建失败不是致命错误
        console.warn(`[devplan_anchor_create] FlowEntry creation failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
      }

      return JSON.stringify({
        status: 'ok',
        projectName,
        anchor: {
          id: anchor.id,
          name: anchor.name || anchorName,
          type: anchor.anchor_type || anchorType,
          version: anchor.version || 1,
          description: anchor.description || description,
          overview: anchorOverview || anchor.overview || null,
        },
        flowEntry: flowEntry ? {
          id: flowEntry.id,
          version: flowEntry.version,
          changeType: flowEntry.change_type || changeType,
          summary: flowEntry.summary,
        } : null,
        message: `Anchor "${anchorName}" created (type: ${anchorType}).${flowEntry ? ` Initial FlowEntry (${changeType}) attached.` : ''}${anchorOverview ? ' Overview set.' : ''} Next: use devplan_memory_save(anchorName="${anchorName}") to build memories.`,
      });
    }


    case 'devplan_anchor_query': {
      const projectName = args.projectName!;
      const anchorName = args.anchorName;
      const includeFlow = args.includeFlow !== false; // default true
      const includeStructure = args.includeStructure !== false; // default true
      const includeParents = args.includeParents !== false; // default true
      const flowLimit = args.flowLimit || 20;

      if (!anchorName) {
        throw new McpError(ErrorCode.InvalidParams, 'anchorName is required');
      }

      const plan = getDevPlan(projectName);
      const g = (plan as any).graph as any;

      if (!g || typeof g.anchorFindByName !== 'function') {
        return JSON.stringify({
          status: 'unsupported',
          message: 'Anchor query requires aifastdb with Phase-122 NAPI bindings.',
        });
      }

      // Step 1: 查找触点
      let anchor: any = null;
      try {
        if (args.anchorType) {
          anchor = g.anchorFind(anchorName, args.anchorType);
        } else {
          anchor = g.anchorFindByName(anchorName);
        }
      } catch { /* not found */ }

      if (!anchor) {
        return JSON.stringify({
          status: 'not_found',
          message: `Anchor "${anchorName}" not found.${args.anchorType ? ` (type: ${args.anchorType})` : ''} Use devplan_anchor_create to create it first.`,
        });
      }

      const result: any = {
        status: 'ok',
        projectName,
        anchor: {
          id: anchor.id,
          name: anchor.name,
          type: anchor.anchor_type,
          version: anchor.version,
          description: anchor.description,
          overview: anchor.overview || null,
          status: anchor.status,
          createdAt: anchor.created_at,
          updatedAt: anchor.updated_at,
        },
      };

      // Step 2: 记忆流
      if (includeFlow) {
        try {
          const flowEntries = g.flowQuery(anchor.id, null, flowLimit, false);
          result.flow = {
            count: flowEntries?.length || 0,
            entries: (flowEntries || []).map((e: any) => ({
              id: e.id,
              version: e.version,
              changeType: e.change_type,
              summary: e.summary,
              detail: e.detail,
              createdAt: e.created_at,
            })),
          };
        } catch (e) {
          result.flow = { count: 0, entries: [], error: String(e) };
        }
      }

      // Step 3: 当前结构快照
      if (includeStructure) {
        try {
          const structure = g.structureCurrent(anchor.id);
          if (structure) {
            result.structure = {
              id: structure.id,
              version: structure.version,
              components: structure.components || [],
              createdAt: structure.created_at,
            };
          } else {
            result.structure = null;
          }
        } catch {
          result.structure = null;
        }
      }

      // Step 4: 父级结构链（反向查询）
      if (includeParents) {
        try {
          const parents = g.structureAffectedBy(anchor.id);
          result.parentStructures = (parents || []).map((p: any) => ({
            anchorId: p.anchor_id || p.anchorId || p.id,
            anchorName: p.anchor_name || p.anchorName || p.name,
            role: p.role,
          }));
        } catch {
          result.parentStructures = [];
        }
      }

      // 构建摘要
      const flowCount = result.flow?.count || 0;
      const structCount = result.structure?.components?.length || 0;
      const parentCount = result.parentStructures?.length || 0;
      result.summary = `Anchor "${anchorName}" (${anchor.anchor_type}): v${anchor.version || 1} | ${flowCount} flow entries | ${structCount} components | referenced by ${parentCount} parent structures`;

      return JSON.stringify(result);
    }


    case 'devplan_structure_affected_by': {
      const projectName = args.projectName!;
      const anchorName = args.anchorName;

      if (!anchorName) {
        throw new McpError(ErrorCode.InvalidParams, 'anchorName is required');
      }

      const plan = getDevPlan(projectName);
      const g = (plan as any).graph as any;

      if (!g || typeof g.structureAffectedBy !== 'function') {
        return JSON.stringify({
          status: 'unsupported',
          message: 'Structure affected-by query requires aifastdb with Phase-122 NAPI bindings.',
        });
      }

      // 先查找触点
      let anchor: any = null;
      try {
        if (args.anchorType) {
          anchor = g.anchorFind(anchorName, args.anchorType);
        } else {
          anchor = g.anchorFindByName(anchorName);
        }
      } catch { /* not found */ }

      if (!anchor) {
        return JSON.stringify({
          status: 'not_found',
          message: `Anchor "${anchorName}" not found.`,
        });
      }

      // 反向查询
      let parents: any[] = [];
      try {
        parents = g.structureAffectedBy(anchor.id) || [];
      } catch (e) {
        return JSON.stringify({
          status: 'error',
          message: `structureAffectedBy failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }

      // 对每个父级，获取基本触点信息
      const enrichedParents = [];
      for (const p of parents) {
        const parentId = p.anchor_id || p.anchorId || p.id;
        let parentAnchor: any = null;
        try {
          parentAnchor = g.anchorGetById(parentId);
        } catch { /* skip */ }

        enrichedParents.push({
          anchorId: parentId,
          anchorName: parentAnchor?.name || p.anchor_name || p.name || 'unknown',
          anchorType: parentAnchor?.anchor_type || p.anchor_type || 'unknown',
          role: p.role || 'component',
          version: parentAnchor?.version || 1,
        });
      }

      return JSON.stringify({
        status: 'ok',
        projectName,
        anchor: {
          id: anchor.id,
          name: anchor.name,
          type: anchor.anchor_type,
        },
        referencedBy: enrichedParents,
        count: enrichedParents.length,
        message: `Anchor "${anchorName}" is referenced as a component by ${enrichedParents.length} parent structure(s).`,
      });
    }


    default:
      return null;
  }
}
