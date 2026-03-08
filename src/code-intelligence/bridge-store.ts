import * as fs from 'fs/promises';
import * as path from 'path';

import type { IDevPlanStore } from '../dev-plan-interface';
import type {
  CodeIntelCluster,
  CodeIntelNode,
  CodeIntelNodeMatch,
  CodeIntelProcess,
  CodeIntelQueryResult,
  CodeIntelStatus,
} from './types';
import { EmbeddedCodeIntelligenceStore } from './embedded-store';

export interface CodeBridgeModuleLink {
  moduleId: string;
  communityId: string;
  createdAt: number;
  updatedAt: number;
  note?: string;
}

export interface CodeBridgeTaskLink {
  taskId: string;
  symbolIds: string[];
  processIds: string[];
  createdAt: number;
  updatedAt: number;
  note?: string;
}

export interface CodeBridgeDocLink {
  section: string;
  subSection?: string;
  processId: string;
  createdAt: number;
  updatedAt: number;
  note?: string;
}

export interface CodeBridgeAnchorLink {
  anchorName: string;
  symbolId: string;
  createdAt: number;
  updatedAt: number;
  note?: string;
}

export interface CodeBridgeLinkSnapshot {
  version: number;
  links: {
    modules: CodeBridgeModuleLink[];
    tasks: CodeBridgeTaskLink[];
    docs: CodeBridgeDocLink[];
    anchors: CodeBridgeAnchorLink[];
  };
}

export interface ModuleCodeContext {
  module: {
    moduleId: string;
    name: string;
    status?: string;
  };
  links: CodeBridgeModuleLink[];
  communities: CodeIntelCluster[];
  processes: CodeIntelProcess[];
  status: CodeIntelStatus;
}

export interface ModuleBridgeOverview {
  modules: ModuleCodeContext[];
  status: CodeIntelStatus;
}

export interface CodeBridgeScoredCommunity {
  community: CodeIntelCluster;
  score: number;
  reasons: string[];
}

export interface CodeBridgeScoredProcess {
  process: CodeIntelProcess;
  score: number;
  reasons: string[];
}

export interface CodeBridgeScoredSymbol {
  symbol: CodeIntelNode;
  score: number;
  reasons: string[];
}

export interface ModuleBridgeRecommendation {
  sourceType: 'module';
  module: {
    moduleId: string;
    name: string;
    description?: string;
  };
  queryText: string;
  currentLinks: CodeBridgeModuleLink[];
  recommendedCommunities: CodeBridgeScoredCommunity[];
  recommendedProcesses: CodeBridgeScoredProcess[];
}

export interface TaskBridgeRecommendation {
  sourceType: 'task';
  task: {
    taskId: string;
    title: string;
    description?: string;
  };
  queryText: string;
  recommendedSymbols: CodeBridgeScoredSymbol[];
  recommendedProcesses: CodeBridgeScoredProcess[];
}

export interface DocBridgeRecommendation {
  sourceType: 'doc';
  doc: {
    section: string;
    subSection?: string;
    title: string;
  };
  queryText: string;
  recommendedSymbols: CodeBridgeScoredSymbol[];
  recommendedProcesses: CodeBridgeScoredProcess[];
}

export interface AnchorBridgeRecommendation {
  sourceType: 'anchor';
  anchor: {
    anchorName: string;
  };
  queryText: string;
  recommendedSymbols: CodeBridgeScoredSymbol[];
  recommendedProcesses: CodeBridgeScoredProcess[];
}

const BRIDGE_LINKS_VERSION = 1;

export class CodeBridgeStore {
  private readonly linksPath: string;

  constructor(
    private readonly projectName: string,
    private readonly basePath: string,
    private readonly codeStore: EmbeddedCodeIntelligenceStore,
    private readonly devPlanStore: IDevPlanStore,
  ) {
    this.linksPath = path.join(path.resolve(basePath), projectName, 'code-intelligence', 'bridge-links.json');
  }

  async linkModuleToCommunity(moduleId: string, communityId: string, note?: string): Promise<CodeBridgeModuleLink> {
    const normalizedModuleId = String(moduleId || '').trim();
    const normalizedCommunityId = String(communityId || '').trim();
    if (!normalizedModuleId) throw new Error('moduleId is required');
    if (!normalizedCommunityId) throw new Error('communityId is required');

    const module = this.devPlanStore.getModule(normalizedModuleId);
    if (!module) throw new Error(`Module not found: ${normalizedModuleId}`);

    const clusters = await this.codeStore.getClusters();
    const community = clusters.find(c => c.id === normalizedCommunityId);
    if (!community) throw new Error(`Community not found: ${normalizedCommunityId}`);

    const snapshot = await this.readSnapshot();
    const now = Date.now();
    const existing = snapshot.links.modules.find(
      item => item.moduleId === normalizedModuleId && item.communityId === normalizedCommunityId,
    );
    if (existing) {
      existing.updatedAt = now;
      existing.note = note || existing.note;
      await this.writeSnapshot(snapshot);
      return existing;
    }

    const link: CodeBridgeModuleLink = {
      moduleId: normalizedModuleId,
      communityId: normalizedCommunityId,
      createdAt: now,
      updatedAt: now,
      note: note || undefined,
    };
    snapshot.links.modules.push(link);
    await this.writeSnapshot(snapshot);
    return link;
  }

  async resolveModuleCodeContext(moduleId: string): Promise<ModuleCodeContext> {
    const normalizedModuleId = String(moduleId || '').trim();
    if (!normalizedModuleId) throw new Error('moduleId is required');

    const module = this.devPlanStore.getModule(normalizedModuleId);
    if (!module) throw new Error(`Module not found: ${normalizedModuleId}`);

    const snapshot = await this.readSnapshot();
    const status = await this.codeStore.getStatus();
    const clusters = await this.codeStore.getClusters();
    const processes = await this.codeStore.getProcesses();
    const links = snapshot.links.modules.filter(item => item.moduleId === normalizedModuleId);
    const linkedCommunityIds = new Set(links.map(item => item.communityId));
    const communities = clusters.filter(cluster => linkedCommunityIds.has(cluster.id));
    const linkedProcesses = processes.filter(proc => {
      const communityId = String((proc as any).communityId || '');
      return communityId ? linkedCommunityIds.has(communityId) : false;
    });

    return {
      module: {
        moduleId: module.moduleId,
        name: module.name,
        status: module.status,
      },
      links,
      communities,
      processes: linkedProcesses,
      status,
    };
  }

  async recommendModuleMappings(moduleId: string, limit = 5): Promise<ModuleBridgeRecommendation> {
    const normalizedModuleId = String(moduleId || '').trim();
    if (!normalizedModuleId) throw new Error('moduleId is required');
    const module = this.devPlanStore.getModule(normalizedModuleId);
    if (!module) throw new Error(`Module not found: ${normalizedModuleId}`);
    const snapshot = await this.readSnapshot();
    const currentLinks = snapshot.links.modules.filter(item => item.moduleId === normalizedModuleId);
    const queryText = this.composeQueryText([module.moduleId, module.name, module.description || '']);
    const queryResult = await this.codeStore.query(queryText, undefined, Math.max(limit * 3, 8));
    const recommendedCommunities = await this.rankCommunities(queryText, queryResult, limit);
    const recommendedProcesses = this.rankProcesses(queryText, queryResult, limit);
    return {
      sourceType: 'module',
      module: {
        moduleId: module.moduleId,
        name: module.name,
        description: module.description,
      },
      queryText,
      currentLinks,
      recommendedCommunities,
      recommendedProcesses,
    };
  }

  async recommendTaskMappings(taskId: string, limit = 8): Promise<TaskBridgeRecommendation> {
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId) throw new Error('taskId is required');
    const task = this.devPlanStore.getMainTask(normalizedTaskId) || this.devPlanStore.getSubTask(normalizedTaskId);
    if (!task) throw new Error(`Task not found: ${normalizedTaskId}`);
    const queryText = this.composeQueryText([task.taskId, task.title, (task as any).description || '']);
    const queryResult = await this.codeStore.query(queryText, undefined, Math.max(limit * 3, 10));
    return {
      sourceType: 'task',
      task: {
        taskId: task.taskId,
        title: task.title,
        description: (task as any).description,
      },
      queryText,
      recommendedSymbols: this.rankSymbols(queryResult, limit),
      recommendedProcesses: this.rankProcesses(queryText, queryResult, limit),
    };
  }

  async recommendDocMappings(section: string, subSection?: string, limit = 8): Promise<DocBridgeRecommendation> {
    const normalizedSection = String(section || '').trim();
    const normalizedSubSection = String(subSection || '').trim() || undefined;
    if (!normalizedSection) throw new Error('section is required');
    const doc = this.devPlanStore.getSection(normalizedSection as any, normalizedSubSection);
    if (!doc) throw new Error(`Document not found: ${normalizedSection}${normalizedSubSection ? `|${normalizedSubSection}` : ''}`);
    const queryText = this.composeQueryText([doc.title, doc.content.slice(0, 400)]);
    const queryResult = await this.codeStore.query(queryText, undefined, Math.max(limit * 3, 10));
    return {
      sourceType: 'doc',
      doc: {
        section: doc.section,
        subSection: doc.subSection || undefined,
        title: doc.title,
      },
      queryText,
      recommendedSymbols: this.rankSymbols(queryResult, limit),
      recommendedProcesses: this.rankProcesses(queryText, queryResult, limit),
    };
  }

  async recommendAnchorMappings(anchorName: string, limit = 8): Promise<AnchorBridgeRecommendation> {
    const normalizedAnchorName = String(anchorName || '').trim();
    if (!normalizedAnchorName) throw new Error('anchorName is required');
    const queryText = this.composeQueryText([normalizedAnchorName]);
    const queryResult = await this.codeStore.query(queryText, undefined, Math.max(limit * 3, 10));
    return {
      sourceType: 'anchor',
      anchor: {
        anchorName: normalizedAnchorName,
      },
      queryText,
      recommendedSymbols: this.rankSymbols(queryResult, limit),
      recommendedProcesses: this.rankProcesses(queryText, queryResult, limit),
    };
  }

  async listModuleBridgeContexts(): Promise<ModuleBridgeOverview> {
    const snapshot = await this.readSnapshot();
    const status = await this.codeStore.getStatus();
    const clusters = await this.codeStore.getClusters();
    const processes = await this.codeStore.getProcesses();
    const linkedModuleIds = [...new Set(snapshot.links.modules.map(item => item.moduleId))];
    const modules = linkedModuleIds
      .map(moduleId => this.devPlanStore.getModule(moduleId))
      .filter(Boolean)
      .map(module => {
        const links = snapshot.links.modules.filter(item => item.moduleId === module!.moduleId);
        const linkedCommunityIds = new Set(links.map(item => item.communityId));
        const communities = clusters.filter(cluster => linkedCommunityIds.has(cluster.id));
        const linkedProcesses = processes.filter(proc => {
          const communityId = String((proc as any).communityId || '');
          return communityId ? linkedCommunityIds.has(communityId) : false;
        });
        return {
          module: {
            moduleId: module!.moduleId,
            name: module!.name,
            status: module!.status,
          },
          links,
          communities,
          processes: linkedProcesses,
          status,
        } as ModuleCodeContext;
      });
    return { modules, status };
  }

  async linkTaskToCode(taskId: string, symbolIds: string[], processIds: string[], note?: string): Promise<CodeBridgeTaskLink> {
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId) throw new Error('taskId is required');
    const task = this.devPlanStore.getMainTask(normalizedTaskId) || this.devPlanStore.getSubTask(normalizedTaskId);
    if (!task) throw new Error(`Task not found: ${normalizedTaskId}`);

    const normalizedSymbolIds = this.normalizeStringList(symbolIds);
    const normalizedProcessIds = this.normalizeStringList(processIds);
    await this.assertNodeIdsExist(normalizedSymbolIds);
    await this.assertProcessIdsExist(normalizedProcessIds);

    const snapshot = await this.readSnapshot();
    const now = Date.now();
    const existing = snapshot.links.tasks.find(item => item.taskId === normalizedTaskId);
    if (existing) {
      existing.symbolIds = normalizedSymbolIds;
      existing.processIds = normalizedProcessIds;
      existing.updatedAt = now;
      existing.note = note || existing.note;
      await this.writeSnapshot(snapshot);
      return existing;
    }

    const link: CodeBridgeTaskLink = {
      taskId: normalizedTaskId,
      symbolIds: normalizedSymbolIds,
      processIds: normalizedProcessIds,
      createdAt: now,
      updatedAt: now,
      note: note || undefined,
    };
    snapshot.links.tasks.push(link);
    await this.writeSnapshot(snapshot);
    return link;
  }

  async linkDocToProcess(section: string, subSection: string | undefined, processId: string, note?: string): Promise<CodeBridgeDocLink> {
    const normalizedSection = String(section || '').trim();
    const normalizedSubSection = String(subSection || '').trim() || undefined;
    const normalizedProcessId = String(processId || '').trim();
    if (!normalizedSection) throw new Error('section is required');
    if (!normalizedProcessId) throw new Error('processId is required');
    const doc = this.devPlanStore.getSection(normalizedSection as any, normalizedSubSection);
    if (!doc) throw new Error(`Document not found: ${normalizedSection}${normalizedSubSection ? `|${normalizedSubSection}` : ''}`);
    await this.assertProcessIdsExist([normalizedProcessId]);

    const snapshot = await this.readSnapshot();
    const now = Date.now();
    const existing = snapshot.links.docs.find(
      item => item.section === normalizedSection && item.subSection === normalizedSubSection && item.processId === normalizedProcessId,
    );
    if (existing) {
      existing.updatedAt = now;
      existing.note = note || existing.note;
      await this.writeSnapshot(snapshot);
      return existing;
    }

    const link: CodeBridgeDocLink = {
      section: normalizedSection,
      subSection: normalizedSubSection,
      processId: normalizedProcessId,
      createdAt: now,
      updatedAt: now,
      note: note || undefined,
    };
    snapshot.links.docs.push(link);
    await this.writeSnapshot(snapshot);
    return link;
  }

  async linkAnchorToSymbol(anchorName: string, symbolId: string, note?: string): Promise<CodeBridgeAnchorLink> {
    const normalizedAnchorName = String(anchorName || '').trim();
    const normalizedSymbolId = String(symbolId || '').trim();
    if (!normalizedAnchorName) throw new Error('anchorName is required');
    if (!normalizedSymbolId) throw new Error('symbolId is required');
    await this.assertNodeIdsExist([normalizedSymbolId]);

    const snapshot = await this.readSnapshot();
    const now = Date.now();
    const existing = snapshot.links.anchors.find(
      item => item.anchorName === normalizedAnchorName && item.symbolId === normalizedSymbolId,
    );
    if (existing) {
      existing.updatedAt = now;
      existing.note = note || existing.note;
      await this.writeSnapshot(snapshot);
      return existing;
    }

    const link: CodeBridgeAnchorLink = {
      anchorName: normalizedAnchorName,
      symbolId: normalizedSymbolId,
      createdAt: now,
      updatedAt: now,
      note: note || undefined,
    };
    snapshot.links.anchors.push(link);
    await this.writeSnapshot(snapshot);
    return link;
  }

  private async readSnapshot(): Promise<CodeBridgeLinkSnapshot> {
    try {
      const raw = await fs.readFile(this.linksPath, 'utf-8');
      const parsed = JSON.parse(raw) as CodeBridgeLinkSnapshot;
      if (!parsed || parsed.version !== BRIDGE_LINKS_VERSION || !parsed.links) {
        return this.createEmptySnapshot();
      }
      return {
        version: BRIDGE_LINKS_VERSION,
        links: {
          modules: Array.isArray(parsed.links.modules) ? parsed.links.modules : [],
          tasks: Array.isArray(parsed.links.tasks) ? parsed.links.tasks : [],
          docs: Array.isArray(parsed.links.docs) ? parsed.links.docs : [],
          anchors: Array.isArray(parsed.links.anchors) ? parsed.links.anchors : [],
        },
      };
    } catch {
      return this.createEmptySnapshot();
    }
  }

  private async writeSnapshot(snapshot: CodeBridgeLinkSnapshot): Promise<void> {
    await fs.mkdir(path.dirname(this.linksPath), { recursive: true });
    await fs.writeFile(this.linksPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  }

  private createEmptySnapshot(): CodeBridgeLinkSnapshot {
    return {
      version: BRIDGE_LINKS_VERSION,
      links: {
        modules: [],
        tasks: [],
        docs: [],
        anchors: [],
      },
    };
  }

  private normalizeStringList(values: string[]): string[] {
    return [...new Set((values || []).map(v => String(v || '').trim()).filter(Boolean))];
  }

  private composeQueryText(parts: string[]): string {
    return parts
      .map(v => String(v || '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private tokenize(text: string): string[] {
    return [...new Set(String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9_\-\/]+/)
      .filter(token => token && token.length >= 2))];
  }

  private scoreTokenOverlap(queryText: string, targetText: string): { score: number; reasons: string[] } {
    const qTokens = this.tokenize(queryText);
    const tTokens = this.tokenize(targetText);
    if (!qTokens.length || !tTokens.length) return { score: 0, reasons: [] };
    const overlap = qTokens.filter(token => tTokens.includes(token));
    return {
      score: overlap.length * 4,
      reasons: overlap.slice(0, 4).map(token => `token overlap "${token}"`),
    };
  }

  private rankSymbols(queryResult: CodeIntelQueryResult, limit: number): CodeBridgeScoredSymbol[] {
    return (queryResult.matchedNodeDetails || [])
      .filter(item => item.node.type === 'symbol')
      .slice(0, limit)
      .map(item => ({
        symbol: item.node,
        score: item.score,
        reasons: item.reasons || [],
      }));
  }

  private rankProcesses(queryText: string, queryResult: CodeIntelQueryResult, limit: number): CodeBridgeScoredProcess[] {
    return (queryResult.processes || [])
      .map((process, index) => {
        const overlap = this.scoreTokenOverlap(queryText, `${process.label} ${process.steps.join(' ')}`);
        return {
          process,
          score: 18 - index + overlap.score,
          reasons: ['returned by code query'].concat(overlap.reasons),
        };
      })
      .sort((a, b) => b.score - a.score || a.process.label.localeCompare(b.process.label))
      .slice(0, limit);
  }

  private async rankCommunities(
    queryText: string,
    queryResult: CodeIntelQueryResult,
    limit: number,
  ): Promise<CodeBridgeScoredCommunity[]> {
    const allClusters = await this.codeStore.getClusters();
    const resultCommunityIds = new Set((queryResult.communities || []).map(item => item.id));
    return allClusters
      .map((community, index) => {
        const overlap = this.scoreTokenOverlap(queryText, `${community.label} ${community.members.join(' ')}`);
        const queryBoost = resultCommunityIds.has(community.id) ? 20 : 0;
        const orderPenalty = resultCommunityIds.has(community.id) ? index : 0;
        const reasons = [];
        if (queryBoost) reasons.push('returned by code query');
        reasons.push(...overlap.reasons);
        return {
          community,
          score: queryBoost + overlap.score - orderPenalty,
          reasons: reasons.length ? reasons : ['label/member heuristic match'],
        };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.community.label.localeCompare(b.community.label))
      .slice(0, limit);
  }

  private async assertNodeIdsExist(symbolIds: string[]): Promise<void> {
    if (!symbolIds.length) return;
    const graph = await this.codeStore.getGraph();
    const nodeIdSet = new Set(graph.nodes.map(node => node.id));
    for (const symbolId of symbolIds) {
      if (!nodeIdSet.has(symbolId)) {
        throw new Error(`Code node not found: ${symbolId}`);
      }
    }
  }

  private async assertProcessIdsExist(processIds: string[]): Promise<void> {
    if (!processIds.length) return;
    const processes = await this.codeStore.getProcesses();
    const processIdSet = new Set(processes.map(proc => proc.id));
    for (const processId of processIds) {
      if (!processIdSet.has(processId)) {
        throw new Error(`Process not found: ${processId}`);
      }
    }
  }
}
