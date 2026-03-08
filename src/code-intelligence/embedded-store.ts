import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as ts from 'typescript';
import { createDevPlan } from '../dev-plan-factory';
import type { ScoredMemory } from '../types';
import type {
  CodeIntelCluster,
  CodeIntelClusterMatch,
  CodeIntelChangeDetail,
  CodeIntelChangeStats,
  CodeIntelEdge,
  CodeIntelDetectChangesResult,
  CodeIntelGraph,
  CodeIntelImpactResult,
  CodeIntelImpactNodeDetail,
  CodeIntelContextResult,
  CodeIntelNodeMatch,
  CodeIntelNode,
  CodeIntelRenameEdit,
  CodeIntelRetrievalEvidence,
  CodeIntelGraphQueryOptions,
  CodeIntelGraphQueryResult,
  CodeIntelRefactorGuardrails,
  CodeIntelRenameResult,
  CodeIntelRenameTarget,
  CodeIntelProcess,
  CodeIntelProcessStep,
  CodeIntelProcessMatch,
  CodeIntelQueryResult,
  CodeIntelIrEntity,
  CodeIntelIrFile,
  CodeIntelIrRelation,
  CodeIntelIrSnapshot,
  CodeIntelSnapshot,
  CodeIntelStatus,
} from './types';

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.rs', '.py', '.go', '.java', '.kt',
]);

const IGNORED_DIRS = new Set([
  '.git',
  '.devplan',
  '.cursor',
  'node_modules',
  'dist',
  'target',
  'coverage',
  'build',
]);

const CACHE_TTL_MS = 10_000;
const CODE_INTEL_INDEX_VERSION = 3;

interface FileEntry {
  absPath: string;
  relPath: string;
  content: string;
  size: number;
  mtimeMs: number;
}

interface RepoFileRecord {
  absPath: string;
  relPath: string;
  size: number;
  mtimeMs: number;
}

interface SnapshotCacheEntry {
  repoPath: string;
  createdAt: number;
  snapshot: CodeIntelSnapshot;
}

interface PersistedSnapshotFile {
  version: number;
  repoPath: string;
  lastIndexedAt: number;
  sourceFingerprint: {
    fileCount: number;
    totalBytes: number;
    maxMtimeMs: number;
  };
  irSnapshot?: CodeIntelIrSnapshot;
  snapshot: CodeIntelSnapshot;
}

interface PersistedIrIndexFile {
  version: number;
  repoPath: string;
  lastIndexedAt: number;
  sourceFingerprint: {
    fileCount: number;
    totalBytes: number;
    maxMtimeMs: number;
  };
  files: CodeIntelIrFile[];
  analyses: Record<string, FileAnalysis>;
}

interface TsRenameWorkspace {
  files: FileEntry[];
  byAbsPath: Map<string, FileEntry>;
  byRelPath: Map<string, FileEntry>;
  languageService: ts.LanguageService;
}

interface ExtractedSymbol {
  node: CodeIntelNode;
  ownerId?: string;
}

interface FileAnalysis {
  symbols: ExtractedSymbol[];
  imports: string[];
  relationHints: RelationHint[];
}

interface OwnerContext {
  id: string;
  kind: string;
  name: string;
  exported?: boolean;
}

interface TsImportBinding {
  specifier: string;
  importedName?: string;
  isDefault?: boolean;
  isNamespace?: boolean;
}

interface RelationHint {
  label: Extract<CodeIntelEdge['label'], 'CALLS' | 'IMPLEMENTS' | 'EXTENDS'>;
  fromId: string;
  toName: string;
  candidateNames?: string[];
  toKind?: string;
  filePath: string;
  preferredImportSpecifier?: string;
  preferredImportName?: string;
  preferredImportIsDefault?: boolean;
  properties?: Record<string, unknown>;
}

export function inferRepoPathFromBasePath(basePath: string): string | null {
  if (!basePath) return null;
  const resolved = path.resolve(basePath);
  const marker = `${path.sep}.devplan`;
  const idx = resolved.lastIndexOf(marker);
  if (idx <= 0) return null;
  return resolved.slice(0, idx);
}

export class EmbeddedCodeIntelligenceStore {
  private readonly projectName: string;
  private readonly defaultRepoPath: string | null;
  private readonly indexPath: string;
  private readonly irIndexPath: string;
  private cache: SnapshotCacheEntry | null = null;
  private fusionPlan:
    | {
      recallUnified?: (query: string, options?: Record<string, unknown>) => ScoredMemory[];
      recallUnifiedViaAdapter?: (query: string, options?: Record<string, unknown>) => ScoredMemory[];
      searchSectionsAdvanced?: (
        query: string,
        options?: { mode?: 'literal' | 'semantic' | 'hybrid'; limit?: number }
      ) => Array<{ section?: string; subSection?: string; title?: string; score?: number }>;
      searchSections?: (query: string, limit?: number) => Array<{ section?: string; subSection?: string; title?: string }>;
    }
    | null
    | undefined;

  constructor(projectName: string, basePath: string) {
    this.projectName = projectName;
    this.defaultRepoPath = inferRepoPathFromBasePath(basePath);
    this.indexPath = path.join(path.resolve(basePath), projectName, 'code-intelligence', 'index.json');
    this.irIndexPath = path.join(path.resolve(basePath), projectName, 'code-intelligence', 'ir-index.json');
  }

  async getStatus(repoPath?: string): Promise<CodeIntelStatus> {
    const snapshot = await this.getSnapshot(repoPath);
    return snapshot.status;
  }

  async getGraph(repoPath?: string): Promise<CodeIntelGraph> {
    const snapshot = await this.getSnapshot(repoPath);
    return snapshot.graph;
  }

  async getClusters(repoPath?: string): Promise<CodeIntelCluster[]> {
    const snapshot = await this.getSnapshot(repoPath);
    return snapshot.clusters;
  }

  async getProcesses(repoPath?: string): Promise<CodeIntelProcess[]> {
    const snapshot = await this.getSnapshot(repoPath);
    return snapshot.processes;
  }

  async query(query: string, repoPath?: string, limit = 10): Promise<CodeIntelQueryResult> {
    const snapshot = await this.getSnapshot(repoPath);
    const baselineMatches = this.rankMatchingNodes(snapshot, query).slice(0, limit);
    const retrievalEvidence = this.collectRetrievalEvidence(query, limit);
    const fusedMatches = this.applyRetrievalFusionToNodeMatches(baselineMatches, retrievalEvidence);
    const related = this.rankCommunitiesAndProcesses(snapshot, fusedMatches, query);
    const communityDetails = this.applyRetrievalFusionToCommunityMatches(related.communityDetails, retrievalEvidence);
    const processDetails = this.applyRetrievalFusionToProcessMatches(related.processDetails, retrievalEvidence);
    const matches = fusedMatches.map(item => item.node);
    const fusionMeta = this.createFusionMeta(retrievalEvidence);

    return {
      query,
      matchedNodes: matches,
      matchedNodeDetails: fusedMatches,
      communities: communityDetails.map(item => item.community),
      communityDetails,
      processes: processDetails.map(item => item.process),
      processDetails,
      ...fusionMeta,
      summary: this.buildQuerySummary(query, fusedMatches, communityDetails, processDetails),
    };
  }

  async getContext(symbol: string, repoPath?: string): Promise<CodeIntelContextResult> {
    const snapshot = await this.getSnapshot(repoPath);
    const symbolMatch = this.rankMatchingNodes(snapshot, symbol)[0] || null;
    const symbolNode = symbolMatch ? symbolMatch.node : null;
    if (!symbolNode) {
      return {
        symbol: null,
        symbolMatch: null,
        neighbors: [],
        neighborDetails: [],
        edges: [],
        communities: [],
        communityDetails: [],
        processes: [],
        processDetails: [],
        ...this.createGraphOnlyFusionMeta(),
        summary: `No symbol match for "${symbol}".`,
      };
    }

    const relatedEdges = snapshot.graph.edges.filter(e => e.from === symbolNode.id || e.to === symbolNode.id);
    const neighborIds = new Set<string>();
    for (const edge of relatedEdges) {
      if (edge.from !== symbolNode.id) neighborIds.add(edge.from);
      if (edge.to !== symbolNode.id) neighborIds.add(edge.to);
    }
    const neighbors = snapshot.graph.nodes.filter(n => neighborIds.has(n.id));
    const baselineNeighborDetails = neighbors.map((neighbor): CodeIntelNodeMatch => {
      const pairedEdges = relatedEdges.filter(edge => edge.from === neighbor.id || edge.to === neighbor.id);
      const reasons = pairedEdges.map(edge => this.describeContextEdge(symbolNode, neighbor, edge));
      return this.createScoredNodeMatch(
        neighbor,
        10 + pairedEdges.reduce((total, edge) => total + this.edgeSemanticWeight(edge.label), 0),
        reasons,
      );
    }).sort((a, b) => b.score - a.score || a.node.label.localeCompare(b.node.label));
    const retrievalEvidence = this.collectRetrievalEvidence(symbolNode.label, 6);
    const neighborDetails = this.applyRetrievalFusionToNodeMatches(baselineNeighborDetails, retrievalEvidence);
    const related = this.rankCommunitiesAndProcesses(
      snapshot,
      [
        symbolMatch,
        ...neighborDetails.map(detail => this.createScoredNodeMatch(
          detail.node,
          Math.max(4, detail.score - 4),
          detail.reasons,
        )),
      ],
      symbolNode.label,
    );
    const communityDetails = this.applyRetrievalFusionToCommunityMatches(related.communityDetails, retrievalEvidence);
    const processDetails = this.applyRetrievalFusionToProcessMatches(related.processDetails, retrievalEvidence);
    return {
      symbol: symbolNode,
      symbolMatch,
      neighbors,
      neighborDetails,
      edges: relatedEdges,
      communities: communityDetails.map(item => item.community),
      communityDetails,
      processes: processDetails.map(item => item.process),
      processDetails,
      ...this.createFusionMeta(retrievalEvidence),
      summary: this.buildContextSummary(symbolNode, neighborDetails, communityDetails, processDetails),
    };
  }

  async getImpact(
    target: string,
    direction: 'upstream' | 'downstream' | 'both' = 'both',
    repoPath?: string,
    limit = 20,
  ): Promise<CodeIntelImpactResult> {
    const snapshot = await this.getSnapshot(repoPath);
    const seed = this.findBestNode(snapshot, target);
    if (!seed) {
      return {
        target,
        direction,
        seed: null,
        affectedNodes: [],
        affectedNodeDetails: [],
        affectedEdges: [],
        affectedCommunities: [],
        affectedCommunityDetails: [],
        affectedProcesses: [],
        affectedProcessDetails: [],
        riskLevel: 'low',
        ...this.createGraphOnlyFusionMeta(),
        summary: `No impact seed match for "${target}".`,
      };
    }

    const visited = new Set<string>([seed.id]);
    const distanceByNode = new Map<string, number>([[seed.id, 0]]);
    const reasonsByNode = new Map<string, Set<string>>();
    const scoreByNode = new Map<string, number>();
    const matchedEdges: CodeIntelEdge[] = [];
    const nodeById = new Map(snapshot.graph.nodes.map(node => [node.id, node] as const));
    const queue: string[] = [seed.id];

    while (queue.length > 0 && visited.size <= limit + 1) {
      const currentId = queue.shift()!;
      const currentDistance = distanceByNode.get(currentId) || 0;
      for (const edge of snapshot.graph.edges) {
        const forward = edge.from === currentId;
        const backward = edge.to === currentId;
        const allowed =
          direction === 'both' ? (forward || backward)
            : direction === 'downstream' ? forward
              : backward;
        if (!allowed) continue;

        const nextId = forward ? edge.to : edge.from;
        matchedEdges.push(edge);
        if (!reasonsByNode.has(nextId)) reasonsByNode.set(nextId, new Set<string>());
        const nextNode = nodeById.get(nextId);
        reasonsByNode.get(nextId)!.add(this.describeImpactEdge(edge, forward, nextNode));
        const nextScore = this.edgeSemanticWeight(edge.label) * Math.max(1, 5 - currentDistance);
        scoreByNode.set(nextId, (scoreByNode.get(nextId) || 0) + nextScore);
        if (!visited.has(nextId)) {
          visited.add(nextId);
          distanceByNode.set(nextId, currentDistance + 1);
          queue.push(nextId);
        }
      }
    }

    visited.delete(seed.id);
    const affectedNodeDetails = snapshot.graph.nodes
      .filter(n => visited.has(n.id))
      .map((node): CodeIntelImpactNodeDetail => this.createImpactNodeDetail(
        node,
        distanceByNode.get(node.id) || 1,
        scoreByNode.get(node.id) || 0,
        [...(reasonsByNode.get(node.id) || new Set<string>())],
      ))
      .sort((a, b) => a.distance - b.distance || b.score - a.score || a.node.label.localeCompare(b.node.label))
      .slice(0, limit);
    const retrievalEvidence = this.collectRetrievalEvidence(`${target} ${direction}`, Math.max(6, Math.ceil(limit / 2)));
    const fusedAffectedNodeDetails = this.applyRetrievalFusionToImpactNodeDetails(affectedNodeDetails, retrievalEvidence)
      .slice(0, limit);
    const affectedNodes = fusedAffectedNodeDetails.map(item => item.node);
    const related = this.rankCommunitiesAndProcesses(
      snapshot,
      fusedAffectedNodeDetails.map(item => this.createScoredNodeMatch(
        item.node,
        Math.max(1, item.score + (6 - Math.min(item.distance, 5)) * 2),
        item.reasons,
      )),
      `${target} ${direction}`,
    );
    const affectedCommunityDetails = this.applyRetrievalFusionToCommunityMatches(related.communityDetails, retrievalEvidence);
    const affectedProcessDetails = this.applyRetrievalFusionToProcessMatches(related.processDetails, retrievalEvidence);
    const edgeCount = matchedEdges.length;
    const riskLevel = edgeCount >= 12 ? 'high' : edgeCount >= 5 ? 'medium' : 'low';

    return {
      target,
      direction,
      seed,
      affectedNodes,
      affectedNodeDetails: fusedAffectedNodeDetails,
      affectedEdges: matchedEdges.slice(0, limit * 2),
      affectedCommunities: affectedCommunityDetails.map(item => item.community),
      affectedCommunityDetails,
      affectedProcesses: affectedProcessDetails.map(item => item.process),
      affectedProcessDetails,
      riskLevel,
      ...this.createFusionMeta(retrievalEvidence),
      summary: this.buildImpactSummary(seed, fusedAffectedNodeDetails, affectedCommunityDetails, affectedProcessDetails, riskLevel),
    };
  }

  async detectChanges(repoPath?: string, limit = 50): Promise<CodeIntelDetectChangesResult> {
    const resolvedRepoPath = path.resolve(repoPath || this.defaultRepoPath || process.cwd());
    const baselinePayload = await this.readPersistedSnapshotFile(resolvedRepoPath);
    const currentSnapshot = await this.buildSnapshot(resolvedRepoPath, false);

    if (!baselinePayload?.snapshot) {
      const nodeChanges = currentSnapshot.graph.nodes.map(node => ({
        id: node.id,
        changeType: 'added' as const,
        after: node,
        reasons: ['node exists only in current snapshot'],
      }));
      const edgeChanges = currentSnapshot.graph.edges.map(edge => ({
        id: this.getEdgeChangeId(edge),
        changeType: 'added' as const,
        after: edge,
        reasons: ['edge exists only in current snapshot'],
      }));
      const communityChanges = currentSnapshot.clusters.map(cluster => ({
        id: cluster.id,
        changeType: 'added' as const,
        after: cluster,
        reasons: ['community exists only in current snapshot'],
      }));
      const processChanges = currentSnapshot.processes.map(process => ({
        id: process.id,
        changeType: 'added' as const,
        after: process,
        reasons: ['process exists only in current snapshot'],
      }));
      return {
        repoPath: resolvedRepoPath,
        baseline: 'none',
        hasBaseline: false,
        limit,
        sourceFingerprintChanged: true,
        nodeChanges: nodeChanges.slice(0, limit),
        edgeChanges: edgeChanges.slice(0, limit),
        communityChanges: communityChanges.slice(0, limit),
        processChanges: processChanges.slice(0, limit),
        stats: {
          nodes: this.countChanges(nodeChanges),
          edges: this.countChanges(edgeChanges),
          communities: this.countChanges(communityChanges),
          processes: this.countChanges(processChanges),
        },
        summary: `No persisted baseline is available for ${resolvedRepoPath}; current snapshot is treated as all-added across nodes, edges, communities, and processes.`,
      };
    }

    const nodeChanges = this.diffCollection(
      baselinePayload.snapshot.graph.nodes,
      currentSnapshot.graph.nodes,
      item => item.id,
      (before, after) => this.describeNodeChange(before, after),
    );
    const edgeChanges = this.diffCollection(
      baselinePayload.snapshot.graph.edges,
      currentSnapshot.graph.edges,
      edge => this.getEdgeChangeId(edge),
      (before, after) => this.describeEdgeChange(before, after),
    );
    const communityChanges = this.diffCollection(
      baselinePayload.snapshot.clusters,
      currentSnapshot.clusters,
      item => item.id,
      (before, after) => this.describeClusterChange(before, after),
    );
    const processChanges = this.diffCollection(
      baselinePayload.snapshot.processes,
      currentSnapshot.processes,
      item => item.id,
      (before, after) => this.describeProcessChange(before, after),
    );

    return {
      repoPath: resolvedRepoPath,
      baseline: 'persisted_index',
      hasBaseline: true,
      limit,
      baselineIndexedAt: baselinePayload.lastIndexedAt,
      sourceFingerprintChanged: !this.isSameSourceFingerprint(
        baselinePayload.sourceFingerprint,
        currentSnapshot.status.sourceFingerprint || { fileCount: 0, totalBytes: 0, maxMtimeMs: 0 },
      ),
      nodeChanges: nodeChanges.slice(0, limit),
      edgeChanges: edgeChanges.slice(0, limit),
      communityChanges: communityChanges.slice(0, limit),
      processChanges: processChanges.slice(0, limit),
      stats: {
        nodes: this.countChanges(nodeChanges),
        edges: this.countChanges(edgeChanges),
        communities: this.countChanges(communityChanges),
        processes: this.countChanges(processChanges),
      },
      summary: this.buildDetectChangesSummary(
        resolvedRepoPath,
        nodeChanges,
        edgeChanges,
        communityChanges,
        processChanges,
      ),
    };
  }

  async renameSymbol(
    query: string,
    newName: string,
    repoPath?: string,
    apply = false,
  ): Promise<CodeIntelRenameResult> {
    const resolvedRepoPath = path.resolve(repoPath || this.defaultRepoPath || process.cwd());
    const snapshot = await this.getSnapshot(resolvedRepoPath);
    const targetNode = snapshot.graph.nodes.find(node => node.id === query) || this.findBestNode(snapshot, query);
    const normalizedNewName = String(newName || '').trim();

    if (!targetNode || targetNode.type !== 'symbol') {
      return {
        query,
        newName: normalizedNewName,
        applied: false,
        supported: false,
        target: null,
        edits: [],
        skippedReasons: ['target symbol not found'],
        summary: `No rename target match for "${query}".`,
      };
    }

    const target = this.buildRenameTarget(targetNode);
    if (!normalizedNewName) {
      return {
        query,
        newName: normalizedNewName,
        applied: false,
        supported: false,
        target,
        edits: [],
        skippedReasons: ['newName is empty'],
        summary: `Rename target "${targetNode.label}" requires a non-empty new name.`,
      };
    }
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(normalizedNewName)) {
      return {
        query,
        newName: normalizedNewName,
        applied: false,
        supported: false,
        target,
        edits: [],
        skippedReasons: ['newName is not a valid TypeScript identifier'],
        summary: `Rename target "${targetNode.label}" rejected invalid identifier "${normalizedNewName}".`,
      };
    }

    const filePath = typeof targetNode.properties?.filePath === 'string' ? targetNode.properties.filePath : '';
    const language = typeof targetNode.properties?.language === 'string' ? targetNode.properties.language : '';
    if (!filePath || !['ts', 'js'].includes(language)) {
      return {
        query,
        newName: normalizedNewName,
        applied: false,
        supported: false,
        target,
        edits: [],
        skippedReasons: ['rename currently supports only TS/JS symbols with filePath metadata'],
        summary: `Rename target "${targetNode.label}" is not eligible for TS/JS rename preview/apply.`,
      };
    }

    const workspace = await this.createTsRenameWorkspace(resolvedRepoPath);
    const targetFile = workspace.byRelPath.get(filePath);
    if (!targetFile) {
      return {
        query,
        newName: normalizedNewName,
        applied: false,
        supported: false,
        target,
        edits: [],
        skippedReasons: ['target file is not available in TS/JS workspace'],
        summary: `Rename target "${targetNode.label}" could not load file ${filePath}.`,
      };
    }

    const targetPosition = this.findTsRenamePosition(snapshot, targetNode, targetFile);
    if (targetPosition === null) {
      workspace.languageService.dispose();
      return {
        query,
        newName: normalizedNewName,
        applied: false,
        supported: false,
        target,
        edits: [],
        skippedReasons: ['failed to locate a stable declaration identifier'],
        summary: `Rename target "${targetNode.label}" could not resolve a stable declaration position.`,
      };
    }

    const renameInfo = workspace.languageService.getRenameInfo(targetFile.absPath, targetPosition, {
      allowRenameOfImportPath: false,
    });
    if (!renameInfo.canRename) {
      workspace.languageService.dispose();
      return {
        query,
        newName: normalizedNewName,
        applied: false,
        supported: false,
        target,
        edits: [],
        skippedReasons: [renameInfo.localizedErrorMessage || 'TypeScript rename info rejected this target'],
        summary: `Rename target "${targetNode.label}" is not renameable: ${renameInfo.localizedErrorMessage || 'unknown reason'}.`,
      };
    }

    const locations = workspace.languageService.findRenameLocations(
      targetFile.absPath,
      targetPosition,
      false,
      false,
      true,
    ) || [];
    const edits = this.buildRenameEditsFromLocations(workspace, locations, normalizedNewName);

    if (edits.length === 0) {
      workspace.languageService.dispose();
      return {
        query,
        newName: normalizedNewName,
        applied: false,
        supported: false,
        target,
        edits: [],
        skippedReasons: ['TypeScript rename produced no concrete edits'],
        summary: `Rename target "${targetNode.label}" did not produce any file edits.`,
      };
    }

    let postDetectChanges: CodeIntelDetectChangesResult | undefined;
    if (apply) {
      await this.applyRenameEdits(resolvedRepoPath, workspace, edits);
      this.cache = null;
      postDetectChanges = await this.detectChanges(resolvedRepoPath, 30);
    }
    workspace.languageService.dispose();

    return {
      query,
      newName: normalizedNewName,
      applied: apply,
      supported: true,
      target,
      edits,
      skippedReasons: [],
      postDetectChanges,
      summary: apply
        ? `Applied ${edits.length} rename edits for "${targetNode.label}" -> "${normalizedNewName}".`
        : `Prepared ${edits.length} rename edits for "${targetNode.label}" -> "${normalizedNewName}".`,
    };
  }

  async queryGraph(
    options: CodeIntelGraphQueryOptions,
    repoPath?: string,
  ): Promise<CodeIntelGraphQueryResult> {
    const resolvedRepoPath = path.resolve(repoPath || this.defaultRepoPath || process.cwd());
    const snapshot = await this.getSnapshot(resolvedRepoPath);
    const nodeTypeSet = new Set((options.nodeTypes || []).filter(Boolean));
    const edgeLabelSet = new Set((options.edgeLabels || []).filter(Boolean));
    const limit = Math.max(1, options.limit || 25);
    const selectedNodeIds = new Set<string>();
    const selectedFileIds = new Set<string>();

    if (options.communityId) {
      selectedNodeIds.add(options.communityId);
      const community = snapshot.clusters.find(item => item.id === options.communityId);
      for (const member of community?.members || []) {
        const fileId = `file:${member}`;
        selectedNodeIds.add(fileId);
        selectedFileIds.add(fileId);
      }
    }
    if (options.processId) {
      selectedNodeIds.add(options.processId);
      const process = snapshot.processes.find(item => item.id === options.processId);
      for (const step of process?.steps || []) {
        const fileId = `file:${step}`;
        selectedNodeIds.add(fileId);
        selectedFileIds.add(fileId);
      }
    }
    if (options.query) {
      for (const match of this.rankMatchingNodes(snapshot, options.query).slice(0, limit)) {
        selectedNodeIds.add(match.node.id);
      }
    }

    let nodes = snapshot.graph.nodes.filter(node => {
      const filePath = typeof node.properties?.filePath === 'string' ? node.properties.filePath : '';
      const matchesFilePrefix = options.filePathPrefix
        ? filePath.startsWith(options.filePathPrefix)
          || (node.type === 'file' && node.label.startsWith(options.filePathPrefix))
        : true;
      if (!matchesFilePrefix) return false;
      if (selectedNodeIds.size > 0 && !selectedNodeIds.has(node.id)) {
        const symbolFileId = filePath ? `file:${filePath}` : '';
        if (!(node.type === 'symbol' && symbolFileId && selectedFileIds.has(symbolFileId))) {
          return false;
        }
      }
      if (nodeTypeSet.size > 0 && !nodeTypeSet.has(node.type)) return false;
      return true;
    });

    if (selectedNodeIds.size === 0 && !options.filePathPrefix && !options.query && nodeTypeSet.size === 0) {
      nodes = snapshot.graph.nodes.slice(0, limit);
    } else {
      nodes = nodes.slice(0, limit);
    }

    const nodeIds = new Set(nodes.map(node => node.id));
    const edges = snapshot.graph.edges.filter(edge => {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) return false;
      if (edgeLabelSet.size > 0 && !edgeLabelSet.has(edge.label)) return false;
      return true;
    });

    return {
      repoPath: resolvedRepoPath,
      options: {
        ...options,
        limit,
      },
      nodes,
      edges,
      summary: `Read-only graph query returned ${nodes.length} nodes and ${edges.length} edges with structured filters; arbitrary cypher/mutation is intentionally not exposed.`,
    };
  }

  getRefactorGuardrails(): CodeIntelRefactorGuardrails {
    return {
      renameSupportedLanguages: ['ts', 'js'],
      requiresPreviewBeforeApply: true,
      arbitraryCypherAllowed: false,
      arbitraryGraphMutationAllowed: false,
      detectChangesRecommended: true,
      summary: 'Refactor workflow is intentionally constrained: read-only graph query only, TS/JS rename requires preview before apply, and arbitrary cypher or low-level graph mutation is not exposed through Code Intelligence tools.',
    };
  }

  async rebuildIndex(repoPath?: string): Promise<CodeIntelStatus> {
    const resolvedRepoPath = path.resolve(repoPath || this.defaultRepoPath || process.cwd());
    const snapshot = await this.buildSnapshot(resolvedRepoPath, true);
    this.cache = { repoPath: resolvedRepoPath, createdAt: Date.now(), snapshot };
    return snapshot.status;
  }

  private async getSnapshot(repoPath?: string): Promise<CodeIntelSnapshot> {
    const resolvedRepoPath = path.resolve(repoPath || this.defaultRepoPath || process.cwd());
    const now = Date.now();
    if (
      this.cache &&
      this.cache.repoPath === resolvedRepoPath &&
      (now - this.cache.createdAt) < CACHE_TTL_MS
    ) {
      return this.cache.snapshot;
    }

    const persisted = await this.readPersistedSnapshot(resolvedRepoPath);
    if (persisted) {
      this.cache = { repoPath: resolvedRepoPath, createdAt: now, snapshot: persisted };
      return persisted;
    }

    const snapshot = await this.buildSnapshot(resolvedRepoPath, true);
    this.cache = { repoPath: resolvedRepoPath, createdAt: now, snapshot };
    return snapshot;
  }

  private async buildSnapshot(repoPath: string, persist: boolean): Promise<CodeIntelSnapshot> {
    const warnings: string[] = [];
    try {
      const stat = await fs.stat(repoPath);
      if (!stat.isDirectory()) {
        return this.createUnavailableSnapshot(repoPath, ['repoPath 不是目录']);
      }
    } catch {
      return this.createUnavailableSnapshot(repoPath, ['repoPath 不存在']);
    }

    const files: RepoFileRecord[] = [];
    await this.walkRepo(repoPath, repoPath, files);

    if (files.length === 0) {
      const emptyFingerprint = this.buildSourceFingerprint(files);
      return {
        status: {
          projectName: this.projectName,
          repoPath,
          source: 'native_embedded',
          mode: 'embedded_source',
          available: true,
          indexStatus: 'empty',
          indexPath: this.indexPath,
          indexPersisted: false,
          indexVersion: CODE_INTEL_INDEX_VERSION,
          sourceFingerprint: emptyFingerprint,
          stats: {
            fileCount: 0,
            symbolCount: 0,
            communityCount: 0,
            processCount: 0,
          },
          warnings: ['未扫描到代码文件'],
        },
        graph: { nodes: [], edges: [] },
        clusters: [],
        processes: [],
      };
    }

    const sourceFingerprint = this.buildSourceFingerprint(files);
    const persistedIrIndex = await this.readPersistedIrIndex(repoPath);
    const analyses = await this.prepareFileAnalyses(repoPath, files, persistedIrIndex, warnings);
    const irSnapshot = this.buildIrSnapshot(repoPath, files, analyses);
    const snapshot = this.projectSnapshotFromIr(repoPath, sourceFingerprint, irSnapshot, warnings, persist);

    warnings.push(
      '当前为内嵌轻量源码扫描模式，使用原生代码图模型；尚未接入完整 AST/parser 级索引链路。',
    );
    if (persist) {
      await this.writePersistedSnapshot(repoPath, snapshot, irSnapshot);
      await this.writePersistedIrIndex(repoPath, snapshot, irSnapshot, analyses);
    }
    return snapshot;
  }

  private buildIrSnapshot(
    repoPath: string,
    files: Array<Pick<RepoFileRecord, 'relPath' | 'size' | 'mtimeMs'>>,
    analyses: Map<string, FileAnalysis>,
  ): CodeIntelIrSnapshot {
    const filePathSet = new Set<string>();
    const fileIdByPath = new Map<string, string>();
    const irFiles: CodeIntelIrFile[] = [];
    const entities: CodeIntelIrEntity[] = [];
    const relations: CodeIntelIrRelation[] = [];

    for (const file of files) {
      filePathSet.add(file.relPath);
      const fileId = `file:${file.relPath}`;
      fileIdByPath.set(file.relPath, fileId);
      irFiles.push({
        id: fileId,
        filePath: file.relPath,
        language: path.extname(file.relPath).slice(1),
        size: file.size,
        mtimeMs: file.mtimeMs,
      });
    }

    for (const file of files) {
      const analysis = analyses.get(file.relPath)!;
      const fileId = fileIdByPath.get(file.relPath)!;
      for (const symbol of analysis.symbols) {
        entities.push({
          id: symbol.node.id,
          label: symbol.node.label,
          kind: String(symbol.node.properties?.kind || 'symbol'),
          fileId,
          language: String(symbol.node.properties?.language || ''),
          rawName: String(symbol.node.properties?.rawName || ''),
          ownerId: symbol.ownerId,
          exported: Boolean(symbol.node.properties?.exported),
          visibility: typeof symbol.node.properties?.visibility === 'string'
            ? String(symbol.node.properties?.visibility)
            : undefined,
          startLine: typeof symbol.node.properties?.startLine === 'number'
            ? Number(symbol.node.properties?.startLine)
            : undefined,
          endLine: typeof symbol.node.properties?.endLine === 'number'
            ? Number(symbol.node.properties?.endLine)
            : undefined,
          properties: { ...(symbol.node.properties || {}) },
        });
        relations.push({
          id: `defines:${fileId}:${symbol.node.id}`,
          type: 'DEFINES',
          fromId: fileId,
          toId: symbol.node.id,
          confidence: 1,
        });
        if (symbol.ownerId) {
          relations.push({
            id: `member_of:${symbol.node.id}:${symbol.ownerId}`,
            type: 'MEMBER_OF',
            fromId: symbol.node.id,
            toId: symbol.ownerId,
            confidence: 0.95,
            properties: { membership: 'symbol_owner' },
          });
        }
      }
    }

    const importedFilesByFile = new Map<string, Set<string>>();
    for (const file of files) {
      const analysis = analyses.get(file.relPath)!;
      const fileId = fileIdByPath.get(file.relPath)!;
      for (const specifier of analysis.imports) {
        const resolvedImport = this.resolveImportTarget(file.relPath, specifier, filePathSet);
        if (!resolvedImport) continue;
        const targetId = fileIdByPath.get(resolvedImport);
        if (!targetId) continue;
        if (!importedFilesByFile.has(file.relPath)) importedFilesByFile.set(file.relPath, new Set<string>());
        importedFilesByFile.get(file.relPath)!.add(resolvedImport);
        relations.push({
          id: `imports:${fileId}:${targetId}:${specifier}`,
          type: 'IMPORTS',
          fromId: fileId,
          toId: targetId,
          confidence: 0.9,
          properties: { specifier },
        });
      }
    }

    const entitiesByFileAndRawName = new Map<string, Map<string, string[]>>();
    const entitiesByFile = new Map<string, CodeIntelIrEntity[]>();
    for (const entity of entities) {
      const filePath = irFiles.find(item => item.id === entity.fileId)?.filePath;
      if (!filePath || !entity.rawName) continue;
      if (!entitiesByFileAndRawName.has(filePath)) {
        entitiesByFileAndRawName.set(filePath, new Map<string, string[]>());
      }
      if (!entitiesByFile.has(filePath)) {
        entitiesByFile.set(filePath, []);
      }
      entitiesByFile.get(filePath)!.push(entity);
      const names = [entity.rawName, entity.label];
      const shortName = entity.rawName.split('.').pop();
      if (shortName && shortName !== entity.rawName) names.push(shortName);
      for (const name of names) {
        const bucket = entitiesByFileAndRawName.get(filePath)!.get(name) || [];
        if (!bucket.includes(entity.id)) bucket.push(entity.id);
        entitiesByFileAndRawName.get(filePath)!.set(name, bucket);
      }
    }

    const resolveHintTarget = (hint: RelationHint): string | null => {
      const candidateNames = [...new Set([...(hint.candidateNames || []), hint.toName].filter(Boolean))];
      const resolveFromFile = (filePath: string | undefined, visited = new Set<string>()): string | null => {
        if (!filePath) return null;
        if (visited.has(filePath)) return null;
        visited.add(filePath);
        const fileMap = entitiesByFileAndRawName.get(filePath);
        if (fileMap) {
        for (const candidateName of candidateNames) {
          const ids = fileMap.get(candidateName) || [];
          const target = this.pickIrRelationTargetId(ids, entities, hint.toKind);
          if (target) return target;
          }
        }
        if (hint.preferredImportIsDefault) {
          const fileEntities = entitiesByFile.get(filePath) || [];
          const defaultExportIds = fileEntities
            .filter(entity => entity.exported && entity.properties?.defaultExport === true)
            .map(entity => entity.id);
          if (defaultExportIds.length > 0) {
            if (hint.toKind === 'function') {
              const defaultTarget = this.pickIrRelationTargetId(defaultExportIds, entities, 'function');
              if (defaultTarget) return defaultTarget;
            }
            const defaultOwnerId = this.pickIrRelationTargetId(defaultExportIds, entities);
            if (defaultOwnerId) {
              const memberIds = fileEntities
                .filter(entity =>
                  entity.ownerId === defaultOwnerId
                  && (
                    entity.rawName === hint.toName
                    || entity.label === hint.toName
                    || entity.label.endsWith(`.${hint.toName}`)
                  ),
                )
                .map(entity => entity.id);
              const memberTarget = this.pickIrRelationTargetId(memberIds, entities, hint.toKind);
              if (memberTarget) return memberTarget;
            }
          }
        }
        const importedFiles = importedFilesByFile.get(filePath) || new Set<string>();
        for (const importedFile of importedFiles) {
          const importedTarget = resolveFromFile(importedFile, visited);
          if (importedTarget) return importedTarget;
        }
        return null;
      };

      if (hint.preferredImportSpecifier) {
        const preferredFilePath = this.resolveImportTarget(hint.filePath, hint.preferredImportSpecifier, filePathSet);
        const preferredTarget = resolveFromFile(preferredFilePath || undefined);
        if (preferredTarget) return preferredTarget;
      }

      const localTarget = resolveFromFile(hint.filePath);
      if (localTarget) return localTarget;
      const importedFiles = importedFilesByFile.get(hint.filePath) || new Set<string>();
      for (const importedFile of importedFiles) {
        const importedTarget = resolveFromFile(importedFile);
        if (importedTarget) return importedTarget;
      }
      for (const candidateName of candidateNames) {
        const globalIds = entities
          .filter(entity => entity.label === candidateName || entity.rawName === candidateName)
          .map(entity => entity.id);
        const globalTarget = this.pickIrRelationTargetId(globalIds, entities, hint.toKind);
        if (globalTarget) return globalTarget;
      }
      return null;
    };

    const seenRelationIds = new Set<string>();
    for (const [filePath, analysis] of analyses.entries()) {
      for (const hint of analysis.relationHints) {
        const targetId = resolveHintTarget(hint);
        if (!targetId) continue;
        const relationId = `${hint.label}:${hint.fromId}:${targetId}`;
        if (seenRelationIds.has(relationId)) continue;
        seenRelationIds.add(relationId);
        relations.push({
          id: relationId,
          type: hint.label,
          fromId: hint.fromId,
          toId: targetId,
          confidence: 0.92,
          properties: {
            source: 'native_parser',
            filePath,
            ...(hint.properties || {}),
          },
        });
      }
    }

    return {
      projectName: this.projectName,
      repoPath,
      files: irFiles,
      entities,
      relations,
    };
  }

  private projectSnapshotFromIr(
    repoPath: string,
    sourceFingerprint: { fileCount: number; totalBytes: number; maxMtimeMs: number },
    irSnapshot: CodeIntelIrSnapshot,
    warnings: string[],
    persist: boolean,
  ): CodeIntelSnapshot {
    const nodes: CodeIntelNode[] = [];
    const edges: CodeIntelEdge[] = [];
    const folderIds = new Set<string>();
    const projectId = `project:${this.projectName}`;
    const entitiesByFile = new Map<string, CodeIntelIrEntity[]>();
    const communitySymbolCounts = new Map<string, number>();
    const fileNodeIds = new Map<string, string>();
    const filePathById = new Map(irSnapshot.files.map(file => [file.id, file.filePath]));
    const semanticAdjacency = this.buildSemanticFileAdjacency(irSnapshot);
    const communityModel = this.inferSemanticCommunities(irSnapshot, semanticAdjacency.undirected);

    nodes.push({
      id: projectId,
      label: this.projectName,
      type: 'project',
      properties: { repoPath },
    });

    for (const file of irSnapshot.files) {
      fileNodeIds.set(file.filePath, file.id);
      nodes.push({
        id: file.id,
        label: file.filePath,
        type: 'file',
        properties: {
          filePath: file.filePath,
          language: file.language,
          size: file.size,
          mtimeMs: file.mtimeMs,
        },
      });
      edges.push({ from: projectId, to: file.id, label: 'CONTAINS', confidence: 1 });
      this.addFolderNodes(file.filePath, projectId, nodes, edges, folderIds);
    }

    for (const community of communityModel.communities) {
      communitySymbolCounts.set(community.id, 0);
        nodes.push({
        id: community.id,
        label: community.label,
          type: 'community',
        properties: {
          communityKey: community.familyKey,
          strategy: 'semantic_component',
          memberCount: community.members.length,
        },
      });
      for (const filePath of community.members) {
        const fileId = fileNodeIds.get(filePath);
        if (!fileId) continue;
        edges.push({ from: fileId, to: community.id, label: 'MEMBER_OF', confidence: 1 });
      }
    }

    for (const entity of irSnapshot.entities) {
      const filePath = filePathById.get(entity.fileId);
      if (filePath) {
        if (!entitiesByFile.has(filePath)) entitiesByFile.set(filePath, []);
        entitiesByFile.get(filePath)!.push(entity);
      }
      nodes.push({
        id: entity.id,
        label: entity.label,
        type: 'symbol',
        properties: {
          kind: entity.kind,
          language: entity.language,
          filePath,
          rawName: entity.rawName,
          ownerId: entity.ownerId,
          ownerKind: entity.properties?.ownerKind,
          exported: entity.exported,
          visibility: entity.visibility,
          startLine: entity.startLine,
          endLine: entity.endLine,
          ...(entity.properties || {}),
        },
      });
      if (filePath) {
        const communityId = communityModel.fileToCommunityId.get(filePath) || `community:${this.detectCommunityKey(filePath)}`;
        communitySymbolCounts.set(
          communityId,
          (communitySymbolCounts.get(communityId) || 0) + 1,
        );
      }
    }

    for (const relation of irSnapshot.relations) {
      edges.push({
        from: relation.fromId,
        to: relation.toId,
        label: relation.type,
        confidence: relation.confidence,
        properties: relation.properties,
      });
    }

    const clusters: CodeIntelCluster[] = [];
    const processes: CodeIntelProcess[] = [];
    for (const community of communityModel.communities) {
      const communityId = community.id;
      const members = community.members;
      const label = community.label;
      clusters.push({
        id: communityId,
        label,
        fileCount: members.length,
        symbolCount: communitySymbolCounts.get(communityId) || 0,
        members: [...members].sort(),
      });
      const processId = `process:${label}`;
      const flow = this.inferProcessFlow(
        members,
        semanticAdjacency.outgoing,
        semanticAdjacency.incoming,
        entitiesByFile,
      );
      processes.push({
        id: processId,
        label: `${label} flow`,
        processType: flow.processType,
        stepCount: flow.steps.length,
        steps: flow.steps,
        entryFile: flow.entryFile,
        strategy: flow.strategy,
        stepDetails: flow.stepDetails,
      });
      nodes.push({
        id: processId,
        label: `${label} flow`,
        type: 'process',
        properties: {
          processType: flow.processType,
          stepCount: flow.steps.length,
          communityId,
          entryFile: flow.entryFile,
          strategy: flow.strategy,
        },
      });
      edges.push({ from: communityId, to: processId, label: 'STEP_IN_PROCESS', confidence: 0.6 });
      for (const stepDetail of flow.stepDetails) {
        const targetId = fileNodeIds.get(stepDetail.filePath);
        if (!targetId) continue;
        edges.push({
          from: processId,
          to: targetId,
          label: 'STEP_IN_PROCESS',
          confidence: 0.55,
          properties: {
            step: stepDetail.step,
            role: stepDetail.role,
            score: stepDetail.score,
            reasons: stepDetail.reasons,
          },
        });
      }
    }

    return {
      status: {
        projectName: this.projectName,
        repoPath,
        source: 'native_embedded',
        mode: 'embedded_source',
        available: true,
        indexStatus: 'ready',
        indexPath: this.indexPath,
        indexPersisted: persist,
        lastIndexedAt: persist ? Date.now() : undefined,
        indexVersion: CODE_INTEL_INDEX_VERSION,
        sourceFingerprint,
        stats: {
          fileCount: irSnapshot.files.length,
          symbolCount: irSnapshot.entities.length,
          communityCount: clusters.length,
          processCount: processes.length,
        },
        warnings,
      },
      graph: { nodes, edges },
      clusters,
      processes,
    };
  }

  private createUnavailableSnapshot(repoPath: string, warnings: string[]): CodeIntelSnapshot {
    return {
      status: {
        projectName: this.projectName,
        repoPath,
        source: 'native_embedded',
        mode: 'embedded_source',
        available: false,
        indexStatus: 'unavailable',
        indexPath: this.indexPath,
        indexPersisted: false,
        indexVersion: CODE_INTEL_INDEX_VERSION,
        sourceFingerprint: {
          fileCount: 0,
          totalBytes: 0,
          maxMtimeMs: 0,
        },
        stats: {
          fileCount: 0,
          symbolCount: 0,
          communityCount: 0,
          processCount: 0,
        },
        warnings,
      },
      graph: { nodes: [], edges: [] },
      clusters: [],
      processes: [],
    };
  }

  private async readPersistedSnapshot(repoPath: string): Promise<CodeIntelSnapshot | null> {
    try {
      const parsed = await this.readPersistedSnapshotFile(repoPath);
      if (!parsed?.snapshot) {
        return null;
      }
      const currentFingerprint = await this.collectSourceFingerprint(repoPath);
      if (!this.isSameSourceFingerprint(parsed.sourceFingerprint, currentFingerprint)) {
        return null;
      }
      parsed.snapshot.status.indexPath = this.indexPath;
      parsed.snapshot.status.indexPersisted = true;
      parsed.snapshot.status.lastIndexedAt = parsed.lastIndexedAt;
      parsed.snapshot.status.indexVersion = parsed.version;
      parsed.snapshot.status.sourceFingerprint = currentFingerprint;
      return parsed.snapshot;
    } catch {
      return null;
    }
  }

  private async readPersistedSnapshotFile(repoPath: string): Promise<PersistedSnapshotFile | null> {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedSnapshotFile;
      if (parsed.version !== CODE_INTEL_INDEX_VERSION || parsed.repoPath !== repoPath || !parsed.snapshot) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private async writePersistedSnapshot(
    repoPath: string,
    snapshot: CodeIntelSnapshot,
    irSnapshot?: CodeIntelIrSnapshot,
  ): Promise<void> {
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
    const payload: PersistedSnapshotFile = {
      version: CODE_INTEL_INDEX_VERSION,
      repoPath,
      lastIndexedAt: snapshot.status.lastIndexedAt || Date.now(),
      sourceFingerprint: snapshot.status.sourceFingerprint || {
        fileCount: 0,
        totalBytes: 0,
        maxMtimeMs: 0,
      },
      irSnapshot,
      snapshot,
    };
    await fs.writeFile(this.indexPath, JSON.stringify(payload), 'utf-8');
    if (irSnapshot) {
      await fs.writeFile(this.irIndexPath, JSON.stringify(irSnapshot), 'utf-8');
    }
  }

  private async writePersistedIrIndex(
    repoPath: string,
    snapshot: CodeIntelSnapshot,
    irSnapshot: CodeIntelIrSnapshot,
    analyses: Map<string, FileAnalysis>,
  ): Promise<void> {
    await fs.mkdir(path.dirname(this.irIndexPath), { recursive: true });
    const payload: PersistedIrIndexFile = {
      version: CODE_INTEL_INDEX_VERSION,
      repoPath,
      lastIndexedAt: snapshot.status.lastIndexedAt || Date.now(),
      sourceFingerprint: snapshot.status.sourceFingerprint || {
        fileCount: 0,
        totalBytes: 0,
        maxMtimeMs: 0,
      },
      files: irSnapshot.files,
      analyses: Object.fromEntries([...analyses.entries()]),
    };
    await fs.writeFile(this.irIndexPath, JSON.stringify(payload), 'utf-8');
  }

  private async walkRepo(repoRoot: string, currentDir: string, files: RepoFileRecord[]): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await this.walkRepo(repoRoot, fullPath, files);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!CODE_EXTENSIONS.has(ext)) continue;
      const stat = await fs.stat(fullPath);
      files.push({
        absPath: fullPath,
        relPath: this.toPosix(path.relative(repoRoot, fullPath)),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
  }

  private async readFileEntries(files: RepoFileRecord[]): Promise<FileEntry[]> {
    return Promise.all(files.map(async file => ({
      absPath: file.absPath,
      relPath: file.relPath,
      content: await fs.readFile(file.absPath, 'utf-8'),
      size: file.size,
      mtimeMs: file.mtimeMs,
    })));
  }

  private async collectSourceFingerprint(repoPath: string): Promise<{
    fileCount: number;
    totalBytes: number;
    maxMtimeMs: number;
  }> {
    const fingerprint = {
      fileCount: 0,
      totalBytes: 0,
      maxMtimeMs: 0,
    };

    const walk = async (currentDir: string): Promise<void> => {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (!CODE_EXTENSIONS.has(ext)) continue;
        const stat = await fs.stat(fullPath);
        fingerprint.fileCount += 1;
        fingerprint.totalBytes += stat.size;
        if (stat.mtimeMs > fingerprint.maxMtimeMs) {
          fingerprint.maxMtimeMs = stat.mtimeMs;
        }
      }
    };

    await walk(repoPath);
    return fingerprint;
  }

  private async readPersistedIrIndex(repoPath: string): Promise<PersistedIrIndexFile | null> {
    try {
      const raw = await fs.readFile(this.irIndexPath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedIrIndexFile;
      if (parsed.version !== CODE_INTEL_INDEX_VERSION || parsed.repoPath !== repoPath) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private async prepareFileAnalyses(
    repoPath: string,
    currentFiles: RepoFileRecord[],
    persistedIrIndex: PersistedIrIndexFile | null,
    warnings: string[],
  ): Promise<Map<string, FileAnalysis>> {
    if (!persistedIrIndex) {
      const entries = await this.readFileEntries(currentFiles);
      return new Map(entries.map(file => [file.relPath, this.analyzeFile(file)] as const));
    }

    const currentByPath = new Map(currentFiles.map(file => [file.relPath, file] as const));
    const persistedByPath = new Map(persistedIrIndex.files.map(file => [file.filePath, file] as const));
    const changedOrRemoved = new Set<string>();
    for (const persistedFile of persistedIrIndex.files) {
      const currentFile = currentByPath.get(persistedFile.filePath);
      if (!currentFile) {
        changedOrRemoved.add(persistedFile.filePath);
        continue;
      }
      if (currentFile.size !== persistedFile.size || Math.floor(currentFile.mtimeMs) !== Math.floor(persistedFile.mtimeMs)) {
        changedOrRemoved.add(persistedFile.filePath);
      }
    }
    for (const currentFile of currentFiles) {
      if (!persistedByPath.has(currentFile.relPath)) {
        changedOrRemoved.add(currentFile.relPath);
      }
    }

    if (changedOrRemoved.size === 0) {
      warnings.push(`Incremental rebuild reused all ${currentFiles.length} file analyses.`);
      return new Map(
        currentFiles.map(file => [file.relPath, persistedIrIndex.analyses[file.relPath]] as const)
          .filter((entry): entry is [string, FileAnalysis] => !!entry[1]),
      );
    }

    const invalidated = this.expandInvalidatedFiles(changedOrRemoved, persistedIrIndex.analyses);
    const toAnalyze = currentFiles.filter(file =>
      invalidated.has(file.relPath) || !persistedIrIndex.analyses[file.relPath],
    );
    const freshAnalyses = new Map(
      (await this.readFileEntries(toAnalyze)).map(file => [file.relPath, this.analyzeFile(file)] as const),
    );
    const merged = new Map<string, FileAnalysis>();
    for (const file of currentFiles) {
      const fresh = freshAnalyses.get(file.relPath);
      if (fresh) {
        merged.set(file.relPath, fresh);
        continue;
      }
      const reused = persistedIrIndex.analyses[file.relPath];
      if (reused) merged.set(file.relPath, reused);
    }
    warnings.push(
      `Incremental rebuild re-analyzed ${freshAnalyses.size} file(s) and reused ${Math.max(0, merged.size - freshAnalyses.size)} cached analysis result(s).`,
    );
    return merged;
  }

  private expandInvalidatedFiles(
    seeds: Set<string>,
    analyses: Record<string, FileAnalysis>,
  ): Set<string> {
    const reverseImports = new Map<string, Set<string>>();
    const filePathSet = new Set(Object.keys(analyses));
    for (const [filePath, analysis] of Object.entries(analyses)) {
      for (const importedPath of analysis.imports || []) {
        const resolved = this.resolveImportTarget(filePath, importedPath, filePathSet);
        if (!resolved) continue;
        if (!reverseImports.has(resolved)) reverseImports.set(resolved, new Set<string>());
        reverseImports.get(resolved)!.add(filePath);
      }
    }

    const invalidated = new Set<string>(seeds);
    const queue = [...seeds];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const dependent of reverseImports.get(current) || new Set<string>()) {
        if (invalidated.has(dependent)) continue;
        invalidated.add(dependent);
        queue.push(dependent);
      }
    }
    return invalidated;
  }

  private buildSourceFingerprint(files: Array<{ size: number; mtimeMs: number }>): {
    fileCount: number;
    totalBytes: number;
    maxMtimeMs: number;
  } {
    let totalBytes = 0;
    let maxMtimeMs = 0;
    for (const file of files) {
      totalBytes += file.size;
      if (file.mtimeMs > maxMtimeMs) {
        maxMtimeMs = file.mtimeMs;
      }
    }
    return {
      fileCount: files.length,
      totalBytes,
      maxMtimeMs,
    };
  }

  private isSameSourceFingerprint(
    left: { fileCount: number; totalBytes: number; maxMtimeMs: number } | undefined,
    right: { fileCount: number; totalBytes: number; maxMtimeMs: number },
  ): boolean {
    if (!left) return false;
    return left.fileCount === right.fileCount
      && left.totalBytes === right.totalBytes
      && Math.floor(left.maxMtimeMs) === Math.floor(right.maxMtimeMs);
  }

  private diffCollection<T>(
    beforeItems: T[],
    afterItems: T[],
    getId: (item: T) => string,
    describeChange: (before: T | undefined, after: T | undefined) => string[],
  ): Array<CodeIntelChangeDetail<T>> {
    const beforeMap = new Map(beforeItems.map(item => [getId(item), item]));
    const afterMap = new Map(afterItems.map(item => [getId(item), item]));
    const ids = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();
    const changes: Array<CodeIntelChangeDetail<T>> = [];

    for (const id of ids) {
      const before = beforeMap.get(id);
      const after = afterMap.get(id);
      if (!before && after) {
        changes.push({ id, changeType: 'added', after, reasons: describeChange(undefined, after) });
        continue;
      }
      if (before && !after) {
        changes.push({ id, changeType: 'removed', before, reasons: describeChange(before, undefined) });
        continue;
      }
      if (before && after && this.stableStringify(before) !== this.stableStringify(after)) {
        changes.push({ id, changeType: 'modified', before, after, reasons: describeChange(before, after) });
      }
    }

    return changes;
  }

  private countChanges<T>(changes: Array<CodeIntelChangeDetail<T>>): CodeIntelChangeStats {
    return changes.reduce<CodeIntelChangeStats>((acc, item) => {
      acc[item.changeType] += 1;
      return acc;
    }, { added: 0, removed: 0, modified: 0 });
  }

  private getEdgeChangeId(edge: CodeIntelEdge): string {
    return `${edge.label}:${edge.from}->${edge.to}`;
  }

  private describeNodeChange(before: CodeIntelNode | undefined, after: CodeIntelNode | undefined): string[] {
    if (!before && after) return ['node exists only in current snapshot'];
    if (before && !after) return ['node exists only in baseline snapshot'];
    const reasons: string[] = [];
    if (before?.label !== after?.label) reasons.push('label changed');
    if (before?.type !== after?.type) reasons.push('type changed');
    if (this.stableStringify(before?.properties) !== this.stableStringify(after?.properties)) {
      reasons.push('properties changed');
    }
    return reasons.length > 0 ? reasons : ['node content changed'];
  }

  private describeEdgeChange(before: CodeIntelEdge | undefined, after: CodeIntelEdge | undefined): string[] {
    if (!before && after) return ['edge exists only in current snapshot'];
    if (before && !after) return ['edge exists only in baseline snapshot'];
    const reasons: string[] = [];
    if (before?.confidence !== after?.confidence) reasons.push('confidence changed');
    if (this.stableStringify(before?.properties) !== this.stableStringify(after?.properties)) {
      reasons.push('properties changed');
    }
    return reasons.length > 0 ? reasons : ['edge content changed'];
  }

  private describeClusterChange(
    before: CodeIntelCluster | undefined,
    after: CodeIntelCluster | undefined,
  ): string[] {
    if (!before && after) return ['community exists only in current snapshot'];
    if (before && !after) return ['community exists only in baseline snapshot'];
    const reasons: string[] = [];
    if (before?.label !== after?.label) reasons.push('label changed');
    if (before?.fileCount !== after?.fileCount) reasons.push('file count changed');
    if (before?.symbolCount !== after?.symbolCount) reasons.push('symbol count changed');
    if (this.stableStringify(before?.members) !== this.stableStringify(after?.members)) {
      reasons.push('member set changed');
    }
    return reasons.length > 0 ? reasons : ['community content changed'];
  }

  private describeProcessChange(
    before: CodeIntelProcess | undefined,
    after: CodeIntelProcess | undefined,
  ): string[] {
    if (!before && after) return ['process exists only in current snapshot'];
    if (before && !after) return ['process exists only in baseline snapshot'];
    const reasons: string[] = [];
    if (before?.label !== after?.label) reasons.push('label changed');
    if (before?.stepCount !== after?.stepCount) reasons.push('step count changed');
    if (this.stableStringify(before?.steps) !== this.stableStringify(after?.steps)) {
      reasons.push('step order changed');
    }
    return reasons.length > 0 ? reasons : ['process content changed'];
  }

  private buildDetectChangesSummary(
    repoPath: string,
    nodeChanges: Array<CodeIntelChangeDetail<CodeIntelNode>>,
    edgeChanges: Array<CodeIntelChangeDetail<CodeIntelEdge>>,
    communityChanges: Array<CodeIntelChangeDetail<CodeIntelCluster>>,
    processChanges: Array<CodeIntelChangeDetail<CodeIntelProcess>>,
  ): string {
    const nodeStats = this.countChanges(nodeChanges);
    const edgeStats = this.countChanges(edgeChanges);
    const communityStats = this.countChanges(communityChanges);
    const processStats = this.countChanges(processChanges);
    return `Compared current source scan against persisted index for ${repoPath}; nodes +${nodeStats.added}/-${nodeStats.removed}/~${nodeStats.modified}, edges +${edgeStats.added}/-${edgeStats.removed}/~${edgeStats.modified}, communities +${communityStats.added}/-${communityStats.removed}/~${communityStats.modified}, processes +${processStats.added}/-${processStats.removed}/~${processStats.modified}.`;
  }

  private stableStringify(value: unknown): string {
    if (value === null || value === undefined) return String(value);
    if (Array.isArray(value)) {
      return `[${value.map(item => this.stableStringify(item)).join(',')}]`;
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
      return `{${entries.map(([key, item]) => `${key}:${this.stableStringify(item)}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private buildRenameTarget(node: CodeIntelNode): CodeIntelRenameTarget {
    return {
      id: node.id,
      label: node.label,
      filePath: typeof node.properties?.filePath === 'string' ? node.properties.filePath : undefined,
      language: typeof node.properties?.language === 'string' ? node.properties.language : undefined,
      rawName: typeof node.properties?.rawName === 'string' ? node.properties.rawName : undefined,
      kind: typeof node.properties?.kind === 'string' ? node.properties.kind : undefined,
    };
  }

  private async createTsRenameWorkspace(repoPath: string): Promise<TsRenameWorkspace> {
    const files: FileEntry[] = [];
    await this.walkRepo(repoPath, repoPath, files);
    const tsFiles = files.filter(file => {
      const ext = path.extname(file.relPath).toLowerCase();
      return ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs';
    });
    const byAbsPath = new Map(tsFiles.map(file => [path.resolve(file.absPath), file]));
    const byRelPath = new Map(tsFiles.map(file => [file.relPath, file]));
    const options: ts.CompilerOptions = {
      allowJs: true,
      checkJs: false,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      skipLibCheck: true,
    };
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => options,
      getCurrentDirectory: () => repoPath,
      getDefaultLibFileName: opts => ts.getDefaultLibFilePath(opts),
      getScriptFileNames: () => tsFiles.map(file => path.resolve(file.absPath)),
      getScriptVersion: fileName => {
        const file = byAbsPath.get(path.resolve(fileName));
        return file ? String(file.mtimeMs) : '0';
      },
      getScriptSnapshot: fileName => {
        const normalized = path.resolve(fileName);
        const file = byAbsPath.get(normalized);
        if (file) return ts.ScriptSnapshot.fromString(file.content);
        if (ts.sys.fileExists(normalized)) {
          const content = ts.sys.readFile(normalized);
          return typeof content === 'string' ? ts.ScriptSnapshot.fromString(content) : undefined;
        }
        return undefined;
      },
      fileExists: fileName => {
        const normalized = path.resolve(fileName);
        return byAbsPath.has(normalized) || ts.sys.fileExists(normalized);
      },
      readFile: fileName => {
        const normalized = path.resolve(fileName);
        return byAbsPath.get(normalized)?.content || ts.sys.readFile(normalized);
      },
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    };
    return {
      files: tsFiles,
      byAbsPath,
      byRelPath,
      languageService: ts.createLanguageService(host),
    };
  }

  private findTsRenamePosition(
    snapshot: CodeIntelSnapshot,
    targetNode: CodeIntelNode,
    file: FileEntry,
  ): number | null {
    const rawName = typeof targetNode.properties?.rawName === 'string' ? targetNode.properties.rawName : '';
    const startLine = typeof targetNode.properties?.startLine === 'number' ? targetNode.properties.startLine : null;
    if (!rawName || !startLine) return null;
    const ownerId = typeof targetNode.properties?.ownerId === 'string' ? targetNode.properties.ownerId : '';
    const ownerLabel = ownerId
      ? snapshot.graph.nodes.find(node => node.id === ownerId)?.label || null
      : null;
    const sourceFile = ts.createSourceFile(
      file.relPath,
      file.content,
      ts.ScriptTarget.Latest,
      true,
      this.getTsScriptKind(file.relPath),
    );
    let found: number | null = null;

    const visit = (node: ts.Node, ownerStack: string[] = []): void => {
      if (found !== null) return;
      const declarationName = this.getRenameDeclarationName(node);
      if (declarationName) {
        const declarationLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const currentOwnerLabel = ownerStack.length > 0 ? ownerStack.join('.') : null;
        if (
          declarationName.text === rawName
          && declarationLine === startLine
          && currentOwnerLabel === ownerLabel
        ) {
          found = declarationName.getStart(sourceFile);
          return;
        }
      }

      const nextOwnerStack = this.getRenameOwnerStack(node, ownerStack);
      ts.forEachChild(node, child => visit(child, nextOwnerStack));
    };

    visit(sourceFile, []);
    return found;
  }

  private getRenameDeclarationName(node: ts.Node): ts.Identifier | null {
    if (
      ts.isFunctionDeclaration(node)
      || ts.isClassDeclaration(node)
      || ts.isInterfaceDeclaration(node)
      || ts.isTypeAliasDeclaration(node)
      || ts.isEnumDeclaration(node)
      || ts.isMethodDeclaration(node)
      || ts.isPropertyDeclaration(node)
      || ts.isGetAccessorDeclaration(node)
      || ts.isSetAccessorDeclaration(node)
      || ts.isFunctionExpression(node)
      || ts.isVariableDeclaration(node)
    ) {
      const name = node.name;
      return name && ts.isIdentifier(name) ? name : null;
    }
    if (ts.isModuleDeclaration(node)) {
      return ts.isIdentifier(node.name) ? node.name : null;
    }
    return null;
  }

  private getRenameOwnerStack(node: ts.Node, ownerStack: string[]): string[] {
    if (
      ts.isClassDeclaration(node)
      || ts.isInterfaceDeclaration(node)
      || ts.isEnumDeclaration(node)
      || ts.isModuleDeclaration(node)
    ) {
      const name = this.getRenameDeclarationName(node);
      if (name) return [...ownerStack, name.text];
    }
    return ownerStack;
  }

  private buildRenameEditsFromLocations(
    workspace: TsRenameWorkspace,
    locations: readonly ts.RenameLocation[],
    newName: string,
  ): CodeIntelRenameEdit[] {
    return locations.map(location => {
      const file = workspace.byAbsPath.get(path.resolve(location.fileName));
      const content = file?.content || '';
      const start = location.textSpan.start;
      const end = location.textSpan.start + location.textSpan.length;
      const line = content.slice(0, start).split('\n').length;
      return {
        filePath: file?.relPath || this.toPosix(path.relative(process.cwd(), location.fileName)),
        start,
        end,
        line,
        oldText: content.slice(start, end),
        newText: newName,
      };
    }).sort((a, b) => a.filePath.localeCompare(b.filePath) || a.start - b.start);
  }

  private async applyRenameEdits(
    repoPath: string,
    workspace: TsRenameWorkspace,
    edits: CodeIntelRenameEdit[],
  ): Promise<void> {
    const editsByFile = new Map<string, CodeIntelRenameEdit[]>();
    for (const edit of edits) {
      const bucket = editsByFile.get(edit.filePath) || [];
      bucket.push(edit);
      editsByFile.set(edit.filePath, bucket);
    }
    for (const [filePath, fileEdits] of editsByFile.entries()) {
      const file = workspace.byRelPath.get(filePath);
      if (!file) continue;
      let content = file.content;
      for (const edit of [...fileEdits].sort((a, b) => b.start - a.start)) {
        content = `${content.slice(0, edit.start)}${edit.newText}${content.slice(edit.end)}`;
      }
      await fs.writeFile(path.join(repoPath, filePath), content, 'utf-8');
    }
  }

  private addFolderNodes(
    relPath: string,
    projectId: string,
    nodes: CodeIntelNode[],
    edges: CodeIntelEdge[],
    folderIds: Set<string>,
  ): void {
    const parts = relPath.split('/');
    if (parts.length <= 1) return;
    let currentFolder = '';
    let parentId = projectId;
    for (let i = 0; i < parts.length - 1; i++) {
      currentFolder = currentFolder ? `${currentFolder}/${parts[i]}` : parts[i];
      const folderId = `folder:${currentFolder}`;
      if (!folderIds.has(folderId)) {
        folderIds.add(folderId);
        nodes.push({
          id: folderId,
          label: currentFolder,
          type: 'folder',
          properties: { filePath: currentFolder },
        });
        edges.push({ from: parentId, to: folderId, label: 'CONTAINS', confidence: 1 });
      }
      parentId = folderId;
    }
    edges.push({ from: parentId, to: `file:${relPath}`, label: 'CONTAINS', confidence: 1 });
  }

  private detectCommunityKey(relPath: string): string {
    const parts = relPath.split('/');
    if (parts.length >= 2 && (parts[0] === 'src' || parts[0] === 'packages')) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts.length > 1 ? parts[0] : 'root';
  }

  private buildSemanticFileAdjacency(
    irSnapshot: CodeIntelIrSnapshot,
  ): {
    outgoing: Map<string, Set<string>>;
    incoming: Map<string, Set<string>>;
    undirected: Map<string, Set<string>>;
  } {
    const entityById = new Map(irSnapshot.entities.map(entity => [entity.id, entity]));
    const filePathById = new Map(irSnapshot.files.map(file => [file.id, file.filePath]));
    const outgoing = new Map<string, Set<string>>();
    const incoming = new Map<string, Set<string>>();
    const undirected = new Map<string, Set<string>>();

    const link = (fromFile: string | undefined, toFile: string | undefined) => {
      if (!fromFile || !toFile || fromFile === toFile) return;
      if (!outgoing.has(fromFile)) outgoing.set(fromFile, new Set<string>());
      if (!incoming.has(toFile)) incoming.set(toFile, new Set<string>());
      if (!undirected.has(fromFile)) undirected.set(fromFile, new Set<string>());
      if (!undirected.has(toFile)) undirected.set(toFile, new Set<string>());
      outgoing.get(fromFile)!.add(toFile);
      incoming.get(toFile)!.add(fromFile);
      undirected.get(fromFile)!.add(toFile);
      undirected.get(toFile)!.add(fromFile);
    };

    for (const file of irSnapshot.files) {
      if (!outgoing.has(file.filePath)) outgoing.set(file.filePath, new Set<string>());
      if (!incoming.has(file.filePath)) incoming.set(file.filePath, new Set<string>());
      if (!undirected.has(file.filePath)) undirected.set(file.filePath, new Set<string>());
    }

    for (const relation of irSnapshot.relations) {
      if (relation.type === 'IMPORTS') {
        link(filePathById.get(relation.fromId), filePathById.get(relation.toId));
        continue;
      }
      if (relation.type === 'CALLS' || relation.type === 'IMPLEMENTS' || relation.type === 'EXTENDS') {
        const fromEntity = entityById.get(relation.fromId);
        const toEntity = entityById.get(relation.toId);
        link(
          fromEntity ? filePathById.get(fromEntity.fileId) : undefined,
          toEntity ? filePathById.get(toEntity.fileId) : undefined,
        );
      }
    }

    return { outgoing, incoming, undirected };
  }

  private inferSemanticCommunities(
    irSnapshot: CodeIntelIrSnapshot,
    undirectedAdjacency: Map<string, Set<string>>,
  ): {
    communities: { id: string; label: string; members: string[]; familyKey: string }[];
    fileToCommunityId: Map<string, string>;
  } {
    const filesByFamily = new Map<string, string[]>();
    for (const file of irSnapshot.files) {
      const familyKey = this.detectCommunityKey(file.filePath);
      if (!filesByFamily.has(familyKey)) filesByFamily.set(familyKey, []);
      filesByFamily.get(familyKey)!.push(file.filePath);
    }

    const communities: { id: string; label: string; members: string[]; familyKey: string }[] = [];
    const fileToCommunityId = new Map<string, string>();

    for (const [familyKey, files] of filesByFamily.entries()) {
      const sortedFiles = [...files].sort();
      const remaining = new Set(sortedFiles);
      const components: string[][] = [];
      while (remaining.size > 0) {
        const seed = [...remaining].sort()[0];
        const stack = [seed];
        const component: string[] = [];
        remaining.delete(seed);
        while (stack.length > 0) {
          const current = stack.pop()!;
          component.push(current);
          const neighbors = undirectedAdjacency.get(current) || new Set<string>();
          for (const neighbor of neighbors) {
            if (!remaining.has(neighbor) || !sortedFiles.includes(neighbor)) continue;
            remaining.delete(neighbor);
            stack.push(neighbor);
          }
        }
        components.push(component.sort());
      }

      components.sort((a, b) => a[0].localeCompare(b[0]));
      components.forEach((component, index) => {
        const communityId = components.length === 1
          ? `community:${familyKey}`
          : `community:${familyKey}:${index + 1}`;
        const label = components.length === 1
          ? familyKey
          : `${familyKey} #${index + 1}`;
        communities.push({ id: communityId, label, members: component, familyKey });
        for (const filePath of component) {
          fileToCommunityId.set(filePath, communityId);
        }
      });
    }

    communities.sort((a, b) => a.id.localeCompare(b.id));
    return { communities, fileToCommunityId };
  }

  private scoreProcessEntryFile(
    filePath: string,
    memberSet: Set<string>,
    outgoingAdjacency: Map<string, Set<string>>,
    incomingAdjacency: Map<string, Set<string>>,
    entitiesByFile: Map<string, CodeIntelIrEntity[]>,
  ): { score: number; reasons: string[] } {
    const fileName = path.basename(filePath).toLowerCase();
    const entities = entitiesByFile.get(filePath) || [];
    const exportedCount = entities.filter(entity => entity.exported).length;
    const callableCount = entities.filter(entity => entity.kind === 'function' || entity.kind === 'method').length;
    const outboundInternal = [...(outgoingAdjacency.get(filePath) || new Set<string>())]
      .filter(target => memberSet.has(target)).length;
    const inboundInternal = [...(incomingAdjacency.get(filePath) || new Set<string>())]
      .filter(source => memberSet.has(source)).length;

    let score = outboundInternal * 5 + exportedCount * 2 + callableCount;
    const reasons: string[] = [];
    if (outboundInternal > 0) reasons.push(`drives ${outboundInternal} internal dependency edge(s)`);
    if (exportedCount > 0) reasons.push(`exports ${exportedCount} symbol(s)`);
    if (callableCount > 0) reasons.push(`contains ${callableCount} callable symbol(s)`);
    if (
      fileName === 'entry.ts'
      || fileName === 'entry.js'
      || fileName === 'main.ts'
      || fileName === 'main.js'
      || fileName === 'mod.rs'
      || fileName.startsWith('bootstrap')
      || fileName.startsWith('index')
    ) {
      score += 30;
      reasons.push('entry-like filename bonus');
    }
    if (fileName.includes('reexport')) {
      score -= 4;
      reasons.push('re-export penalty');
    }
    score -= inboundInternal * 2;
    if (inboundInternal > 0) reasons.push(`penalized by ${inboundInternal} inbound internal edge(s)`);
    return { score, reasons };
  }

  private inferProcessFlow(
    members: string[],
    outgoingAdjacency: Map<string, Set<string>>,
    incomingAdjacency: Map<string, Set<string>>,
    entitiesByFile: Map<string, CodeIntelIrEntity[]>,
  ): {
    processType: 'execution_flow';
    strategy: 'semantic_execution_flow_v1' | 'semantic_execution_flow_v2';
    entryFile?: string;
    steps: string[];
    stepDetails: CodeIntelProcessStep[];
  } {
    if (members.length === 0) {
      return {
        processType: 'execution_flow',
        strategy: 'semantic_execution_flow_v1',
        entryFile: undefined,
        steps: [],
        stepDetails: [],
      };
    }

    if (members.length === 1) {
      return {
        processType: 'execution_flow',
        strategy: 'semantic_execution_flow_v1',
        entryFile: members[0],
        steps: [...members],
        stepDetails: [{
          filePath: members[0],
          step: 1,
          role: 'entry',
          score: 100,
          reasons: ['single-member execution flow'],
        }],
      };
    }

    const memberSet = new Set(members);
    const scoreCandidate = (filePath: string) => this.scoreProcessEntryFile(
      filePath,
      memberSet,
      outgoingAdjacency,
      incomingAdjacency,
      entitiesByFile,
    );
    const ranked = [...members].sort((a, b) => {
      const diff = scoreCandidate(b).score - scoreCandidate(a).score;
      return diff !== 0 ? diff : a.localeCompare(b);
    });
    const entry = ranked[0];
    const allFiles = new Set<string>([
      ...members,
      ...outgoingAdjacency.keys(),
      ...incomingAdjacency.keys(),
    ]);
    const externalUpstream = [...allFiles]
      .filter(filePath => !memberSet.has(filePath))
      .filter(filePath => [...(outgoingAdjacency.get(filePath) || new Set<string>())].some(target => memberSet.has(target)))
      .sort((a, b) => {
        const aBridges = [...(outgoingAdjacency.get(a) || new Set<string>())].filter(target => memberSet.has(target)).length;
        const bBridges = [...(outgoingAdjacency.get(b) || new Set<string>())].filter(target => memberSet.has(target)).length;
        const diff = bBridges - aBridges || scoreCandidate(b).score - scoreCandidate(a).score;
        return diff !== 0 ? diff : a.localeCompare(b);
      })
      .slice(0, 2);
    const externalDownstream = [...allFiles]
      .filter(filePath => !memberSet.has(filePath))
      .filter(filePath => [...(incomingAdjacency.get(filePath) || new Set<string>())].some(source => memberSet.has(source)))
      .sort((a, b) => {
        const aBridges = [...(incomingAdjacency.get(a) || new Set<string>())].filter(source => memberSet.has(source)).length;
        const bBridges = [...(incomingAdjacency.get(b) || new Set<string>())].filter(source => memberSet.has(source)).length;
        const diff = bBridges - aBridges || scoreCandidate(b).score - scoreCandidate(a).score;
        return diff !== 0 ? diff : a.localeCompare(b);
      })
      .slice(0, 2);
    const orderedFlowFiles: string[] = [];
    const stepDetails: CodeIntelProcessStep[] = [];
    const appendStep = (filePath: string, role: CodeIntelProcessStep['role'], reasons: string[], score: number) => {
      if (orderedFlowFiles.includes(filePath)) return;
      orderedFlowFiles.push(filePath);
      stepDetails.push({
        filePath,
        step: orderedFlowFiles.length,
        role,
        score,
        reasons,
      });
    };
    const visited = new Set<string>();
    const queue = [entry];
    const entryScoring = scoreCandidate(entry);

    for (const upstreamFile of externalUpstream) {
      const bridgeCount = [...(outgoingAdjacency.get(upstreamFile) || new Set<string>())].filter(target => memberSet.has(target)).length;
      appendStep(
        upstreamFile,
        'upstream',
        [`bridges into ${bridgeCount} internal member(s)`, 'prepended as cross-module upstream step'],
        scoreCandidate(upstreamFile).score + bridgeCount * 3,
      );
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const currentScore = scoreCandidate(current);
      appendStep(
        current,
        current === entry ? 'entry' : 'transition',
        current === entry
          ? ['selected as execution-flow entry'].concat(entryScoring.reasons)
          : ['reachable from earlier step'].concat(currentScore.reasons),
        currentScore.score,
      );
      const neighbors = [...(outgoingAdjacency.get(current) || new Set<string>())]
        .filter(target => memberSet.has(target) && !visited.has(target))
        .sort((a, b) => {
          const diff = scoreCandidate(b).score - scoreCandidate(a).score;
          return diff !== 0 ? diff : a.localeCompare(b);
        });
      queue.push(...neighbors);
    }

    for (const filePath of ranked) {
      if (!visited.has(filePath)) {
        visited.add(filePath);
        const fallbackScore = scoreCandidate(filePath);
        appendStep(
          filePath,
          'fallback',
          ['appended as disconnected or late-ranked fallback'].concat(fallbackScore.reasons),
          fallbackScore.score,
        );
      }
    }

    for (const downstreamFile of externalDownstream) {
      const bridgeCount = [...(incomingAdjacency.get(downstreamFile) || new Set<string>())].filter(source => memberSet.has(source)).length;
      appendStep(
        downstreamFile,
        'downstream',
        [`receives flow from ${bridgeCount} internal member(s)`, 'appended as cross-module downstream step'],
        scoreCandidate(downstreamFile).score + bridgeCount * 3,
      );
    }

    const cappedFiles = orderedFlowFiles.slice(0, 6);
    const cappedDetails = stepDetails
      .slice(0, 6)
      .map((detail, index) => ({ ...detail, step: index + 1 }));

    return {
      processType: 'execution_flow',
      strategy: 'semantic_execution_flow_v2',
      entryFile: cappedFiles[0],
      steps: cappedFiles,
      stepDetails: cappedDetails,
    };
  }

  private buildSnapshotRelationIndexes(snapshot: CodeIntelSnapshot): {
    nodeById: Map<string, CodeIntelNode>;
    communityIdsByFilePath: Map<string, Set<string>>;
    processIdsByFilePath: Map<string, Set<string>>;
    processIdsByCommunityId: Map<string, Set<string>>;
  } {
    const nodeById = new Map(snapshot.graph.nodes.map(node => [node.id, node] as const));
    const communityIdsByFilePath = new Map<string, Set<string>>();
    const processIdsByFilePath = new Map<string, Set<string>>();
    const processIdsByCommunityId = new Map<string, Set<string>>();

    const add = (map: Map<string, Set<string>>, key: string | undefined, value: string) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, new Set<string>());
      map.get(key)!.add(value);
    };

    for (const edge of snapshot.graph.edges) {
      if (edge.label === 'MEMBER_OF' && edge.to.startsWith('community:')) {
        const fromNode = nodeById.get(edge.from);
        const filePath = this.getNodeFilePath(fromNode);
        add(communityIdsByFilePath, filePath, edge.to);
      }
      if (edge.label === 'STEP_IN_PROCESS' && edge.from.startsWith('process:')) {
        const toNode = nodeById.get(edge.to);
        const filePath = this.getNodeFilePath(toNode);
        add(processIdsByFilePath, filePath, edge.from);
      }
      if (edge.label === 'STEP_IN_PROCESS' && edge.from.startsWith('community:') && edge.to.startsWith('process:')) {
        add(processIdsByCommunityId, edge.from, edge.to);
      }
    }

    return {
      nodeById,
      communityIdsByFilePath,
      processIdsByFilePath,
      processIdsByCommunityId,
    };
  }

  private getNodeFilePath(node: CodeIntelNode | undefined): string | undefined {
    if (!node) return undefined;
    const propPath = typeof node.properties?.filePath === 'string' ? String(node.properties?.filePath) : undefined;
    if (propPath) return propPath;
    if (node.type === 'file') return node.label;
    return undefined;
  }

  private queryTokenOverlapDetails(query: string, targetText: string): { score: number; reasons: string[] } {
    const qTokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const tText = targetText.toLowerCase();
    const overlaps = qTokens.filter(token => tText.includes(token));
    return {
      score: overlaps.length * 3,
      reasons: overlaps.slice(0, 4).map(token => `query token overlap "${token}"`),
    };
  }

  private edgeSemanticWeight(label: CodeIntelEdge['label']): number {
    switch (label) {
      case 'CALLS':
        return 8;
      case 'IMPLEMENTS':
      case 'EXTENDS':
        return 6;
      case 'DEFINES':
      case 'MEMBER_OF':
        return 4;
      case 'IMPORTS':
        return 3;
      case 'STEP_IN_PROCESS':
        return 2;
      case 'CONTAINS':
      default:
        return 1;
    }
  }

  private describeContextEdge(symbolNode: CodeIntelNode, neighbor: CodeIntelNode, edge: CodeIntelEdge): string {
    if (edge.from === symbolNode.id && edge.to === neighbor.id) {
      return `outbound ${edge.label} to ${neighbor.label}`;
    }
    if (edge.to === symbolNode.id && edge.from === neighbor.id) {
      return `inbound ${edge.label} from ${neighbor.label}`;
    }
    return `connected via ${edge.label}`;
  }

  private describeImpactEdge(edge: CodeIntelEdge, forward: boolean, nextNode?: CodeIntelNode): string {
    const direction = forward ? 'outbound' : 'inbound';
    return `${direction} ${edge.label}${nextNode ? ` -> ${nextNode.label}` : ''}`;
  }

  private createGraphOnlyFusionMeta() {
    return {
      fusionMode: 'graph_only' as const,
      fusionApplied: false,
      fusionSummary: 'Graph-only ranking active; retrieval fusion not applied.',
      retrievalEvidence: [],
    };
  }

  private createFusionMeta(retrievalEvidence: CodeIntelRetrievalEvidence[]) {
    if (!retrievalEvidence.length) return this.createGraphOnlyFusionMeta();
    return {
      fusionMode: 'graph_recall' as const,
      fusionApplied: true,
      fusionSummary: `Graph ranking reranked with ${retrievalEvidence.length} retrieval evidence item(s).`,
      retrievalEvidence,
    };
  }

  private createScoredNodeMatch(
    node: CodeIntelNode,
    baselineScore: number,
    reasons: string[],
    fusionScore = 0,
  ): CodeIntelNodeMatch {
    const finalScore = baselineScore + fusionScore;
    return {
      node,
      score: finalScore,
      baselineScore,
      fusionScore,
      finalScore,
      reasons: [...new Set(reasons)],
    };
  }

  private createScoredClusterMatch(
    community: CodeIntelCluster,
    baselineScore: number,
    reasons: string[],
    fusionScore = 0,
  ): CodeIntelClusterMatch {
    const finalScore = baselineScore + fusionScore;
    return {
      community,
      score: finalScore,
      baselineScore,
      fusionScore,
      finalScore,
      reasons: [...new Set(reasons)],
    };
  }

  private createScoredProcessMatch(
    process: CodeIntelProcess,
    baselineScore: number,
    reasons: string[],
    fusionScore = 0,
  ): CodeIntelProcessMatch {
    const finalScore = baselineScore + fusionScore;
    return {
      process,
      score: finalScore,
      baselineScore,
      fusionScore,
      finalScore,
      reasons: [...new Set(reasons)],
    };
  }

  private createImpactNodeDetail(
    node: CodeIntelNode,
    distance: number,
    baselineScore: number,
    reasons: string[],
    fusionScore = 0,
  ): CodeIntelImpactNodeDetail {
    const finalScore = baselineScore + fusionScore;
    return {
      node,
      distance,
      score: finalScore,
      baselineScore,
      fusionScore,
      finalScore,
      reasons: [...new Set(reasons)],
    };
  }

  private collectRetrievalEvidence(query: string, limit: number): CodeIntelRetrievalEvidence[] {
    const trimmed = query.trim();
    if (!trimmed) return [];

    try {
      const basePath = path.dirname(path.dirname(path.dirname(this.indexPath)));
      const projectDataPath = path.join(basePath, this.projectName);
      if (!existsSync(projectDataPath)) return [];
      const plan = this.getFusionPlan(basePath);
      if (!plan) return [];
      const recallFn = typeof plan.recallUnifiedViaAdapter === 'function'
        ? plan.recallUnifiedViaAdapter.bind(plan)
        : (typeof plan.recallUnified === 'function' ? plan.recallUnified.bind(plan) : null);
      if (!recallFn) return [];
      const recalled = recallFn(trimmed, {
        limit: Math.max(4, Math.min(limit, 8)),
        docStrategy: 'guided',
        recursive: true,
        depth: 'L1',
      });
      if (Array.isArray(recalled) && recalled.length > 0) {
        return recalled.slice(0, 5).map(item => this.toRetrievalEvidence(item));
      }
      if (typeof (plan as { searchSectionsAdvanced?: unknown }).searchSectionsAdvanced === 'function') {
        const hits = (plan as {
          searchSectionsAdvanced: (
            query: string,
            options?: { mode?: 'literal' | 'semantic' | 'hybrid'; limit?: number }
          ) => Array<{ section?: string; subSection?: string; title?: string; score?: number }>;
        }).searchSectionsAdvanced(trimmed, { mode: 'literal', limit: Math.max(3, Math.min(limit, 6)) });
        if (Array.isArray(hits) && hits.length > 0) {
          return hits.slice(0, 5).map((hit, index) => this.toDocSearchEvidence(hit, index));
        }
      }
      if (typeof (plan as { searchSections?: unknown }).searchSections === 'function') {
        const hits = (plan as {
          searchSections: (query: string, limit?: number) => Array<{ section?: string; subSection?: string; title?: string }>;
        }).searchSections(trimmed, Math.max(3, Math.min(limit, 6)));
        if (Array.isArray(hits) && hits.length > 0) {
          return hits.slice(0, 5).map((hit, index) => this.toDocSearchEvidence(hit, index));
        }
      }
      return [];
    } catch {
      return [];
    }
  }

  private getFusionPlan(basePath: string) {
    if (this.fusionPlan !== undefined) return this.fusionPlan;
    try {
      this.fusionPlan = createDevPlan(this.projectName, basePath, 'graph') as unknown as NonNullable<typeof this.fusionPlan>;
    } catch {
      this.fusionPlan = null;
    }
    return this.fusionPlan;
  }

  private toRetrievalEvidence(item: ScoredMemory): CodeIntelRetrievalEvidence {
    const isDoc = item.sourceKind === 'doc';
    const label = isDoc
      ? (item.docTitle || item.docSection || 'document')
      : (item.anchorInfo?.name || item.content.slice(0, 80));
    const reasons = isDoc
      ? (item.guidedReasons?.length ? item.guidedReasons : ['retrieved by unified recall'])
      : ['retrieved by unified recall'];
    return {
      sourceKind: isDoc ? 'doc' : 'memory',
      sourceId: isDoc
        ? `${item.docSection || 'doc'}${item.docSubSection ? `|${item.docSubSection}` : ''}`
        : item.id,
      label,
      score: item.score,
      reasons,
      mappedNodeIds: [],
      mappedFilePaths: [],
      mappedCommunityIds: [],
      mappedProcessIds: [],
    };
  }

  private toDocSearchEvidence(
    item: { section?: string; subSection?: string; title?: string; score?: number },
    index: number,
  ): CodeIntelRetrievalEvidence {
    return {
      sourceKind: 'doc',
      sourceId: `${item.section || 'doc'}${item.subSection ? `|${item.subSection}` : ''}`,
      label: item.title || item.section || 'document',
      score: typeof item.score === 'number' ? item.score : Math.max(0.2, 0.6 - index * 0.08),
      reasons: ['matched DevPlan document search'],
      mappedNodeIds: [],
      mappedFilePaths: [],
      mappedCommunityIds: [],
      mappedProcessIds: [],
    };
  }

  private applyRetrievalFusionToNodeMatches(
    matches: CodeIntelNodeMatch[],
    retrievalEvidence: CodeIntelRetrievalEvidence[],
  ): CodeIntelNodeMatch[] {
    if (!retrievalEvidence.length) return matches;
    return matches
      .map(match => {
        const baselineScore = match.baselineScore ?? match.score;
        const reasons = [...match.reasons];
        let fusionScore = 0;
        for (const evidence of retrievalEvidence) {
          const overlap = this.queryTokenOverlapDetails(
            `${evidence.label} ${evidence.reasons.join(' ')}`,
            `${match.node.label} ${JSON.stringify(match.node.properties || {})}`,
          );
          if (overlap.score <= 0) continue;
          const bonus = Math.min(6, overlap.score + Math.round(evidence.score * 2));
          fusionScore += bonus;
          for (const reason of overlap.reasons.slice(0, 2)) {
            reasons.push(`recall:${reason} via ${evidence.sourceKind} ${evidence.label}`);
          }
          this.appendUnique(evidence.mappedNodeIds, match.node.id);
        }
        return this.createScoredNodeMatch(match.node, baselineScore, reasons, fusionScore);
      })
      .sort((a, b) => b.score - a.score || a.node.label.localeCompare(b.node.label));
  }

  private applyRetrievalFusionToCommunityMatches(
    details: CodeIntelClusterMatch[],
    retrievalEvidence: CodeIntelRetrievalEvidence[],
  ): CodeIntelClusterMatch[] {
    if (!retrievalEvidence.length) return details;
    return details
      .map(detail => {
        const baselineScore = detail.baselineScore ?? detail.score;
        const reasons = [...detail.reasons];
        let fusionScore = 0;
        for (const evidence of retrievalEvidence) {
          const overlap = this.queryTokenOverlapDetails(
            `${evidence.label} ${evidence.reasons.join(' ')}`,
            `${detail.community.label} ${detail.community.members.join(' ')}`,
          );
          if (overlap.score <= 0) continue;
          const bonus = Math.min(6, overlap.score + Math.round(evidence.score * 2));
          fusionScore += bonus;
          for (const reason of overlap.reasons.slice(0, 2)) {
            reasons.push(`recall:${reason} via ${evidence.sourceKind} ${evidence.label}`);
          }
          this.appendUnique(evidence.mappedCommunityIds, detail.community.id);
        }
        return this.createScoredClusterMatch(detail.community, baselineScore, reasons, fusionScore);
      })
      .sort((a, b) => b.score - a.score || a.community.label.localeCompare(b.community.label));
  }

  private applyRetrievalFusionToProcessMatches(
    details: CodeIntelProcessMatch[],
    retrievalEvidence: CodeIntelRetrievalEvidence[],
  ): CodeIntelProcessMatch[] {
    if (!retrievalEvidence.length) return details;
    return details
      .map(detail => {
        const baselineScore = detail.baselineScore ?? detail.score;
        const reasons = [...detail.reasons];
        let fusionScore = 0;
        for (const evidence of retrievalEvidence) {
          const overlap = this.queryTokenOverlapDetails(
            `${evidence.label} ${evidence.reasons.join(' ')}`,
            `${detail.process.label} ${detail.process.steps.join(' ')}`,
          );
          if (overlap.score <= 0) continue;
          const bonus = Math.min(6, overlap.score + Math.round(evidence.score * 2));
          fusionScore += bonus;
          for (const reason of overlap.reasons.slice(0, 2)) {
            reasons.push(`recall:${reason} via ${evidence.sourceKind} ${evidence.label}`);
          }
          this.appendUnique(evidence.mappedProcessIds, detail.process.id);
        }
        return this.createScoredProcessMatch(detail.process, baselineScore, reasons, fusionScore);
      })
      .sort((a, b) => b.score - a.score || a.process.label.localeCompare(b.process.label));
  }

  private applyRetrievalFusionToImpactNodeDetails(
    details: CodeIntelImpactNodeDetail[],
    retrievalEvidence: CodeIntelRetrievalEvidence[],
  ): CodeIntelImpactNodeDetail[] {
    if (!retrievalEvidence.length) return details;
    return details
      .map(detail => {
        const baselineScore = detail.baselineScore ?? detail.score;
        const reasons = [...detail.reasons];
        let fusionScore = 0;
        for (const evidence of retrievalEvidence) {
          const overlap = this.queryTokenOverlapDetails(
            `${evidence.label} ${evidence.reasons.join(' ')}`,
            `${detail.node.label} ${JSON.stringify(detail.node.properties || {})}`,
          );
          if (overlap.score <= 0) continue;
          const bonus = Math.min(6, overlap.score + Math.round(evidence.score * 2));
          fusionScore += bonus;
          for (const reason of overlap.reasons.slice(0, 2)) {
            reasons.push(`recall:${reason} via ${evidence.sourceKind} ${evidence.label}`);
          }
          this.appendUnique(evidence.mappedNodeIds, detail.node.id);
        }
        return this.createImpactNodeDetail(detail.node, detail.distance, baselineScore, reasons, fusionScore);
      })
      .sort((a, b) => a.distance - b.distance || b.score - a.score || a.node.label.localeCompare(b.node.label));
  }

  private appendUnique(target: string[] | undefined, value: string): void {
    if (!target) return;
    if (!target.includes(value)) target.push(value);
  }

  private rankCommunitiesAndProcesses(
    snapshot: CodeIntelSnapshot,
    evidences: CodeIntelNodeMatch[],
    queryText: string,
  ): {
    communityDetails: CodeIntelClusterMatch[];
    processDetails: CodeIntelProcessMatch[];
  } {
    const indexes = this.buildSnapshotRelationIndexes(snapshot);
    const communityScores = new Map<string, { score: number; reasons: Set<string> }>();
    const processScores = new Map<string, { score: number; reasons: Set<string> }>();
    const clusterById = new Map(snapshot.clusters.map(cluster => [cluster.id, cluster] as const));
    const processById = new Map(snapshot.processes.map(process => [process.id, process] as const));

    const addScore = (
      map: Map<string, { score: number; reasons: Set<string> }>,
      id: string,
      score: number,
      reason: string,
    ) => {
      if (!map.has(id)) map.set(id, { score: 0, reasons: new Set<string>() });
      map.get(id)!.score += score;
      map.get(id)!.reasons.add(reason);
    };

    for (const evidence of evidences) {
      const node = evidence.node;
      const filePath = this.getNodeFilePath(node);
      if (node.type === 'community') {
        addScore(communityScores, node.id, evidence.score + 12, `matched community node ${node.label}`);
      }
      if (node.type === 'process') {
        addScore(processScores, node.id, evidence.score + 12, `matched process node ${node.label}`);
        const linkedCommunityId = typeof node.properties?.communityId === 'string'
          ? String(node.properties?.communityId)
          : undefined;
        if (linkedCommunityId) {
          addScore(communityScores, linkedCommunityId, Math.max(4, evidence.score / 2), `linked from process ${node.label}`);
        }
      }
      if (filePath) {
        const fileCommunities = indexes.communityIdsByFilePath.get(filePath) || new Set<string>();
        for (const communityId of fileCommunities) {
          addScore(
            communityScores,
            communityId,
            evidence.score + 6,
            `${node.type === 'file' ? 'contains matched file' : 'contains matched symbol'} ${filePath}`,
          );
        }
        const fileProcesses = indexes.processIdsByFilePath.get(filePath) || new Set<string>();
        for (const processId of fileProcesses) {
          const process = processById.get(processId);
          const stepIndex = process?.steps.indexOf(filePath) ?? -1;
          const stepBonus = stepIndex >= 0 ? Math.max(3, 8 - stepIndex) : 4;
          addScore(
            processScores,
            processId,
            evidence.score + stepBonus,
            `includes matched file ${filePath}${stepIndex >= 0 ? ` at step ${stepIndex + 1}` : ''}`,
          );
          const linkedCommunityId = typeof process?.id === 'string'
            ? String(process?.id ? snapshot.graph.nodes.find(n => n.id === processId)?.properties?.communityId || '' : '')
            : '';
          if (linkedCommunityId) {
            addScore(communityScores, linkedCommunityId, Math.max(2, evidence.score / 3), `process evidence from ${process?.label || processId}`);
          }
        }
      }
    }

    for (const cluster of snapshot.clusters) {
      const overlap = this.queryTokenOverlapDetails(queryText, `${cluster.label} ${cluster.members.join(' ')}`);
      if (overlap.score > 0) {
        for (const reason of overlap.reasons) {
          addScore(communityScores, cluster.id, overlap.score, reason);
        }
      }
    }

    for (const process of snapshot.processes) {
      const overlap = this.queryTokenOverlapDetails(queryText, `${process.label} ${process.steps.join(' ')}`);
      if (overlap.score > 0) {
        for (const reason of overlap.reasons) {
          addScore(processScores, process.id, overlap.score, reason);
        }
      }
      const communityId = snapshot.graph.nodes.find(node => node.id === process.id)?.properties?.communityId;
      if (typeof communityId === 'string' && communityScores.has(communityId)) {
        addScore(processScores, process.id, Math.max(2, (communityScores.get(communityId)?.score || 0) / 6), `shares ranked community ${communityId}`);
      }
    }

    const communityDetails = [...communityScores.entries()]
      .map(([communityId, detail]) => {
        const community = clusterById.get(communityId);
        return community
          ? this.createScoredClusterMatch(community, detail.score, [...detail.reasons])
          : null;
      })
      .filter((item): item is CodeIntelClusterMatch => !!item && item.score > 0)
      .sort((a, b) => b.score - a.score || a.community.label.localeCompare(b.community.label));

    const processDetails = [...processScores.entries()]
      .map(([processId, detail]) => {
        const process = processById.get(processId);
        return process
          ? this.createScoredProcessMatch(process, detail.score, [...detail.reasons])
          : null;
      })
      .filter((item): item is CodeIntelProcessMatch => !!item && item.score > 0)
      .sort((a, b) => b.score - a.score || a.process.label.localeCompare(b.process.label));

    return { communityDetails, processDetails };
  }

  private buildQuerySummary(
    query: string,
    matchDetails: CodeIntelNodeMatch[],
    communityDetails: CodeIntelClusterMatch[],
    processDetails: CodeIntelProcessMatch[],
  ): string {
    const topNode = matchDetails[0]?.node?.label || 'no direct node match';
    const topCommunity = communityDetails[0]?.community.label || 'no related community';
    const topProcess = processDetails[0]?.process.label || 'no related process';
    return `Query "${query}" matched ${topNode}; top related community is ${topCommunity}; top related process is ${topProcess}.`;
  }

  private buildContextSummary(
    symbolNode: CodeIntelNode,
    neighborDetails: CodeIntelNodeMatch[],
    communityDetails: CodeIntelClusterMatch[],
    processDetails: CodeIntelProcessMatch[],
  ): string {
    const topNeighbor = neighborDetails[0]?.node.label || 'no direct neighbor';
    const topCommunity = communityDetails[0]?.community.label || 'no related community';
    const topProcess = processDetails[0]?.process.label || 'no related process';
    return `Context for ${symbolNode.label} is centered on ${topNeighbor}; strongest related community is ${topCommunity}; strongest related process is ${topProcess}.`;
  }

  private buildImpactSummary(
    seed: CodeIntelNode,
    affectedNodeDetails: CodeIntelImpactNodeDetail[],
    communityDetails: CodeIntelClusterMatch[],
    processDetails: CodeIntelProcessMatch[],
    riskLevel: 'low' | 'medium' | 'high',
  ): string {
    const topAffected = affectedNodeDetails[0]?.node.label || 'no affected nodes';
    const topCommunity = communityDetails[0]?.community.label || 'no affected community';
    const topProcess = processDetails[0]?.process.label || 'no affected process';
    return `Impact from ${seed.label} reaches ${affectedNodeDetails.length} nodes; highest-priority affected node is ${topAffected}; top community ${topCommunity}; top process ${topProcess}; risk ${riskLevel}.`;
  }

  private analyzeFile(file: FileEntry): FileAnalysis {
    const language = this.detectSymbolLanguage(file.relPath);
    if (language === 'ts' || language === 'js') {
      return this.parseTsJsFile(file, language);
    }
    if (language === 'rust') {
      return this.parseRustFile(file);
    }
    if (language === 'python') {
      return this.parsePythonFile(file);
    }
    if (language === 'go') {
      return this.parseGoFile(file);
    }
    if (language === 'java') {
      return this.parseJavaFile(file);
    }
    if (language === 'kotlin') {
      return this.parseKotlinFile(file);
    }
    return {
      symbols: this.extractSymbols(file),
      imports: this.extractImports(file.content),
      relationHints: [],
    };
  }

  private parseTsJsFile(file: FileEntry, language: 'ts' | 'js'): FileAnalysis {
    const sourceFile = ts.createSourceFile(
      file.relPath,
      file.content,
      ts.ScriptTarget.Latest,
      true,
      this.getTsScriptKind(file.relPath),
    );
    const imports = new Set<string>();
    const importBindings = new Map<string, TsImportBinding>();
    const symbols: ExtractedSymbol[] = [];
    const relationHints: RelationHint[] = [];
    const seenIds = new Set<string>();

    const pushSymbol = (
      kind: string,
      rawName: string,
      node: ts.Node,
      options?: {
        owner?: OwnerContext;
        exported?: boolean;
        defaultExport?: boolean;
        declaration?: string;
        visibility?: string;
        extraProperties?: Record<string, unknown>;
      },
    ): OwnerContext | null => {
      const name = options?.owner ? `${options.owner.name}.${rawName}` : rawName;
      const symbolId = `symbol:${kind}:${file.relPath}:${name}`;
      if (!rawName || seenIds.has(symbolId)) return null;
      seenIds.add(symbolId);
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      symbols.push({
        node: {
          id: symbolId,
          label: name,
          type: 'symbol',
          properties: {
            kind,
            language,
            filePath: file.relPath,
            rawName,
            startLine: start.line + 1,
            endLine: end.line + 1,
            exported: !!options?.exported,
            defaultExport: !!options?.defaultExport,
            declaration: options?.declaration,
            ownerId: options?.owner?.id,
            ownerKind: options?.owner?.kind,
            visibility: options?.visibility,
            ...(options?.extraProperties || {}),
          },
        },
        ownerId: options?.owner?.id,
      });
      return {
        id: symbolId,
        kind,
        name,
        exported: options?.exported,
      };
    };

    const addRelationHint = (hint: Omit<RelationHint, 'filePath'>) => {
      if (!hint.fromId || !hint.toName) return;
      relationHints.push({
        ...hint,
        filePath: file.relPath,
      });
    };

    const collectTsCallHints = (owner: OwnerContext, root: ts.Node | undefined) => {
      if (!root) return;
      const seenCalls = new Set<string>();
      const bindingTypes = new Map<string, string>();

      const collectBindings = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
          const typeName = this.resolveTsBoundTypeName(node, sourceFile);
          if (typeName) bindingTypes.set(node.name.text, typeName);
        }
        ts.forEachChild(node, collectBindings);
      };
      collectBindings(root);

      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          let targetName: string | null = null;
          let candidateNames: string[] = [];
          let preferredImportSpecifier: string | undefined;
          let preferredImportName: string | undefined;
          let preferredImportIsDefault = false;
          let toKind: string | undefined;
          if (ts.isIdentifier(node.expression)) {
            targetName = node.expression.text;
            candidateNames = [targetName];
            const importBinding = importBindings.get(targetName);
            if (importBinding) {
              preferredImportSpecifier = importBinding.specifier;
              preferredImportName = importBinding.importedName;
              preferredImportIsDefault = !!importBinding.isDefault;
              if (
                importBinding.importedName
                && importBinding.importedName !== targetName
                && importBinding.importedName !== 'default'
                && importBinding.importedName !== '*'
              ) {
                candidateNames.unshift(importBinding.importedName);
              }
              if (importBinding.isDefault) {
                toKind = 'function';
              }
            }
          } else if (
            ts.isPropertyAccessExpression(node.expression)
            && ts.isIdentifier(node.expression.name)
          ) {
            targetName = node.expression.name.text;
            candidateNames = [node.expression.getText(sourceFile), targetName];
            if (ts.isIdentifier(node.expression.expression)) {
              const bindingType = bindingTypes.get(node.expression.expression.text);
              if (bindingType) {
                candidateNames.unshift(`${bindingType}.${targetName}`);
                const importBinding = this.findTsImportBindingForType(bindingType, importBindings);
                preferredImportSpecifier = importBinding?.specifier;
                preferredImportName = importBinding?.importedName;
                preferredImportIsDefault = !!importBinding?.isDefault;
                if (
                  importBinding?.importedName
                  && importBinding.importedName !== 'default'
                  && importBinding.importedName !== '*'
                ) {
                  candidateNames.unshift(`${importBinding.importedName}.${targetName}`);
                }
                toKind = 'method';
              }
            }
          }
          if (targetName && !seenCalls.has(targetName)) {
            seenCalls.add(targetName);
            addRelationHint({
              label: 'CALLS',
              fromId: owner.id,
              toName: targetName,
              candidateNames,
              toKind,
              preferredImportSpecifier,
              preferredImportName,
              preferredImportIsDefault,
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(root);
    };

    const visitClassMembers = (classNode: ts.ClassLikeDeclarationBase, owner: OwnerContext) => {
      for (const member of classNode.members) {
        const visibility = this.getTsVisibility(member);
        if (ts.isMethodDeclaration(member)) {
          const name = this.getTsPropertyName(member.name);
          if (!name) continue;
          const methodOwner = pushSymbol('method', name, member, {
            owner,
            visibility,
            extraProperties: { async: !!member.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) },
          });
          if (methodOwner) collectTsCallHints(methodOwner, member.body);
          continue;
        }
        if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
          const name = this.getTsPropertyName(member.name);
          if (!name) continue;
          pushSymbol('method', name, member, {
            owner,
            visibility,
            extraProperties: { accessor: ts.isGetAccessorDeclaration(member) ? 'get' : 'set' },
          });
          continue;
        }
        if (ts.isPropertyDeclaration(member)) {
          const name = this.getTsPropertyName(member.name);
          if (!name) continue;
          pushSymbol('field', name, member, {
            owner,
            visibility,
          });
        }
      }
    };

    const visitInterfaceMembers = (iface: ts.InterfaceDeclaration, owner: OwnerContext) => {
      for (const member of iface.members) {
        if (ts.isMethodSignature(member)) {
          const name = this.getTsPropertyName(member.name);
          if (!name) continue;
          pushSymbol('method', name, member, {
            owner,
            visibility: 'public',
          });
          continue;
        }
        if (ts.isPropertySignature(member)) {
          const name = this.getTsPropertyName(member.name);
          if (!name) continue;
          pushSymbol('field', name, member, {
            owner,
            visibility: 'public',
          });
        }
      }
    };

    const visitModuleBlock = (
      block: ts.ModuleBlock,
      owner: OwnerContext,
    ) => {
      for (const statement of block.statements) {
        visitStatement(statement, owner);
      }
    };

    const visitVariableStatement = (statement: ts.VariableStatement, owner?: OwnerContext) => {
      const exported = this.isTsExported(statement, owner?.exported);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const initializer = declaration.initializer;
        let kind = 'const';
        if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
          kind = 'function';
        } else if (initializer && ts.isClassExpression(initializer)) {
          kind = 'class';
        }
        const variableOwner = pushSymbol(kind, declaration.name.text, declaration, {
          owner,
          exported,
          declaration: 'variable',
        });
        if (!variableOwner || !initializer) continue;
        if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
          collectTsCallHints(variableOwner, initializer.body);
          continue;
        }
        if (ts.isClassExpression(initializer)) {
          visitClassMembers(initializer, variableOwner);
        }
      }
    };

    const visitStatement = (statement: ts.Statement, owner?: OwnerContext) => {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        imports.add(statement.moduleSpecifier.text);
        const clause = statement.importClause;
        if (clause?.name) {
          importBindings.set(clause.name.text, {
            specifier: statement.moduleSpecifier.text,
            importedName: 'default',
            isDefault: true,
          });
        }
        if (clause?.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) {
            importBindings.set(clause.namedBindings.name.text, {
              specifier: statement.moduleSpecifier.text,
              importedName: '*',
              isNamespace: true,
            });
          } else if (ts.isNamedImports(clause.namedBindings)) {
            for (const element of clause.namedBindings.elements) {
              importBindings.set(element.name.text, {
                specifier: statement.moduleSpecifier.text,
                importedName: (element.propertyName || element.name).text,
              });
            }
          }
        }
        return;
      }
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        imports.add(statement.moduleSpecifier.text);
        return;
      }
      if (ts.isImportEqualsDeclaration(statement)) {
        const ref = statement.moduleReference;
        if (ts.isExternalModuleReference(ref) && ref.expression && ts.isStringLiteral(ref.expression)) {
          imports.add(ref.expression.text);
        }
        return;
      }
      if (ts.isFunctionDeclaration(statement) && statement.name) {
        const functionOwner = pushSymbol('function', statement.name.text, statement, {
          owner,
          exported: this.isTsExported(statement, owner?.exported),
          defaultExport: this.isTsDefaultExported(statement),
          extraProperties: { async: !!statement.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) },
        });
        if (functionOwner) collectTsCallHints(functionOwner, statement.body);
        return;
      }
      if (ts.isClassDeclaration(statement) && statement.name) {
        const classOwner = pushSymbol('class', statement.name.text, statement, {
          owner,
          exported: this.isTsExported(statement, owner?.exported),
          defaultExport: this.isTsDefaultExported(statement),
        });
        for (const heritage of statement.heritageClauses || []) {
          for (const inheritedType of heritage.types) {
            const qualifiedName = inheritedType.expression.getText(sourceFile);
            const targetName = qualifiedName.split('.').pop() || '';
            if (!classOwner || !targetName) continue;
            if (heritage.token === ts.SyntaxKind.ExtendsKeyword) {
              addRelationHint({
                label: 'EXTENDS',
                fromId: classOwner.id,
                toName: targetName,
                candidateNames: [qualifiedName, targetName],
                preferredImportSpecifier: this.findTsImportBindingForType(qualifiedName, importBindings)?.specifier,
              });
            }
            if (heritage.token === ts.SyntaxKind.ImplementsKeyword) {
              addRelationHint({
                label: 'IMPLEMENTS',
                fromId: classOwner.id,
                toName: targetName,
                candidateNames: [qualifiedName, targetName],
                preferredImportSpecifier: this.findTsImportBindingForType(qualifiedName, importBindings)?.specifier,
              });
            }
          }
        }
        if (classOwner) visitClassMembers(statement, classOwner);
        return;
      }
      if (ts.isInterfaceDeclaration(statement)) {
        const interfaceOwner = pushSymbol('interface', statement.name.text, statement, {
          owner,
          exported: this.isTsExported(statement, owner?.exported),
        });
        if (interfaceOwner) visitInterfaceMembers(statement, interfaceOwner);
        return;
      }
      if (ts.isTypeAliasDeclaration(statement)) {
        pushSymbol('type', statement.name.text, statement, {
          owner,
          exported: this.isTsExported(statement, owner?.exported),
        });
        return;
      }
      if (ts.isEnumDeclaration(statement)) {
        pushSymbol('enum', statement.name.text, statement, {
          owner,
          exported: this.isTsExported(statement, owner?.exported),
        });
        return;
      }
      if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) {
        const moduleOwner = pushSymbol('module', statement.name.text, statement, {
          owner,
          exported: this.isTsExported(statement, owner?.exported),
        });
        if (moduleOwner && statement.body && ts.isModuleBlock(statement.body)) {
          visitModuleBlock(statement.body, moduleOwner);
        }
        return;
      }
      if (ts.isVariableStatement(statement)) {
        visitVariableStatement(statement, owner);
      }
    };

    // Use the native AST for TS/JS so later graph edges can evolve independently
    // from syntax-specific parser details.
    for (const statement of sourceFile.statements) {
      visitStatement(statement);
    }

    const walkImports = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        if (
          ts.isIdentifier(node.expression)
          && node.expression.text === 'require'
          && node.arguments.length > 0
          && ts.isStringLiteral(node.arguments[0])
        ) {
          imports.add(node.arguments[0].text);
        }
        if (
          node.expression.kind === ts.SyntaxKind.ImportKeyword
          && node.arguments.length > 0
          && ts.isStringLiteral(node.arguments[0])
        ) {
          imports.add(node.arguments[0].text);
        }
      }
      ts.forEachChild(node, walkImports);
    };
    walkImports(sourceFile);

    return {
      symbols,
      imports: [...imports],
      relationHints,
    };
  }

  private parsePythonFile(file: FileEntry): FileAnalysis {
    const content = file.content;
    const lines = content.split('\n');
    const lineOffsets: number[] = [];
    let offset = 0;
    for (const line of lines) {
      lineOffsets.push(offset);
      offset += line.length + 1;
    }

    const imports = new Set<string>();
    const importBindings = new Map<string, TsImportBinding>();
    const symbols: ExtractedSymbol[] = [];
    const relationHints: RelationHint[] = [];
    const seenIds = new Set<string>();
    const ownerStack: Array<{ indent: number; owner: OwnerContext }> = [];

    const pushSymbol = (
      kind: string,
      rawName: string,
      startIndex: number,
      options?: {
        owner?: OwnerContext;
        declaration?: string;
        extraProperties?: Record<string, unknown>;
      },
    ): OwnerContext | null => {
      const name = options?.owner ? `${options.owner.name}.${rawName}` : rawName;
      const symbolId = `symbol:${kind}:${file.relPath}:${name}`;
      if (!rawName || seenIds.has(symbolId)) return null;
      seenIds.add(symbolId);
      const startLine = content.slice(0, startIndex).split('\n').length;
      const node: CodeIntelNode = {
        id: symbolId,
        label: name,
        type: 'symbol',
        properties: {
          kind,
          language: 'python',
          filePath: file.relPath,
          rawName,
          startLine,
          exported: !rawName.startsWith('_'),
          ownerId: options?.owner?.id,
          ownerKind: options?.owner?.kind,
          declaration: options?.declaration,
          ...(options?.extraProperties || {}),
        },
      };
      symbols.push({ node, ownerId: options?.owner?.id });
      return {
        id: symbolId,
        kind,
        name,
        exported: !rawName.startsWith('_'),
      };
    };

    const addRelationHint = (hint: Omit<RelationHint, 'filePath'>) => {
      if (!hint.fromId || !hint.toName) return;
      relationHints.push({
        ...hint,
        filePath: file.relPath,
      });
    };

    const normalizePythonImportSpecifier = (moduleName: string, level: number): string => {
      if (level > 0) {
        let baseDir = path.posix.dirname(file.relPath);
        for (let i = 1; i < level; i++) {
          baseDir = path.posix.dirname(baseDir);
        }
        const modulePath = moduleName ? moduleName.replace(/\./g, '/') : '';
        const target = modulePath ? path.posix.join(baseDir, modulePath) : baseDir;
        let relative = path.posix.relative(path.posix.dirname(file.relPath), target);
        if (!relative) relative = '.';
        if (!relative.startsWith('.')) relative = `./${relative}`;
        return relative;
      }
      return moduleName.replace(/\./g, '/');
    };

    const getPythonBlockText = (lineIndex: number, indent: number): string => {
      const block: string[] = [];
      for (let i = lineIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed) {
          block.push(line);
          continue;
        }
        const currentIndent = line.match(/^\s*/)?.[0].length || 0;
        if (currentIndent <= indent) break;
        block.push(line);
      }
      return block.join('\n');
    };

    const collectPythonCallHints = (owner: OwnerContext, body: string) => {
      if (!body.trim()) return;
      const bindingTypes = new Map<string, string>();
      const seenCalls = new Set<string>();
      const bindingRe = /(^|\n)\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
      let bindingMatch: RegExpExecArray | null;
      while ((bindingMatch = bindingRe.exec(body)) !== null) {
        bindingTypes.set(bindingMatch[2], bindingMatch[3]);
      }

      const callRe = /([A-Za-z_][A-Za-z0-9_\.]*)\s*\(/g;
      const ignored = new Set(['if', 'for', 'while', 'return', 'print', 'super']);
      let callMatch: RegExpExecArray | null;
      while ((callMatch = callRe.exec(body)) !== null) {
        const expr = callMatch[1];
        if (!expr || ignored.has(expr)) continue;
        let targetName = expr;
        let candidateNames = [expr];
        let preferredImportSpecifier: string | undefined;
        let preferredImportName: string | undefined;
        let toKind: string | undefined;

        if (expr.includes('.')) {
          const segments = expr.split('.');
          const methodName = segments.pop() || '';
          const baseName = segments[segments.length - 1] || '';
          if (!methodName) continue;
          targetName = methodName;
          candidateNames = [expr, methodName];
          const boundType = bindingTypes.get(baseName);
          if (boundType) {
            candidateNames.unshift(`${boundType}.${methodName}`);
            toKind = 'method';
          }
          const importBinding = importBindings.get(baseName);
          if (importBinding) {
            preferredImportSpecifier = importBinding.specifier;
            preferredImportName = importBinding.importedName;
            if (
              importBinding.importedName
              && importBinding.importedName !== '*'
              && importBinding.importedName !== methodName
            ) {
              candidateNames.unshift(`${importBinding.importedName}.${methodName}`);
            }
          }
        } else {
          const importBinding = importBindings.get(expr);
          if (importBinding) {
            preferredImportSpecifier = importBinding.specifier;
            preferredImportName = importBinding.importedName;
            if (
              importBinding.importedName
              && importBinding.importedName !== '*'
              && importBinding.importedName !== expr
            ) {
              candidateNames.unshift(importBinding.importedName);
            }
          }
        }

        const key = `${targetName}:${candidateNames.join('|')}`;
        if (seenCalls.has(key)) continue;
        seenCalls.add(key);
        addRelationHint({
          label: 'CALLS',
          fromId: owner.id,
          toName: targetName,
          candidateNames,
          toKind,
          preferredImportSpecifier,
          preferredImportName,
        });
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const indent = line.match(/^\s*/)?.[0].length || 0;
      while (ownerStack.length > 0 && indent <= ownerStack[ownerStack.length - 1].indent) {
        ownerStack.pop();
      }

      const importFromMatch = trimmed.match(/^from\s+(\.+)?([A-Za-z_][A-Za-z0-9_\.]*)?\s+import\s+(.+)$/);
      if (importFromMatch) {
        const dotPrefix = importFromMatch[1] || '';
        const moduleName = importFromMatch[2] || '';
        const importedList = importFromMatch[3].split(',').map(part => part.trim()).filter(Boolean);
        const specifier = normalizePythonImportSpecifier(moduleName, dotPrefix.length);
        imports.add(specifier);
        for (const imported of importedList) {
          const aliasMatch = imported.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/);
          const importedName = aliasMatch ? aliasMatch[1] : imported;
          const localName = aliasMatch ? aliasMatch[2] : imported;
          importBindings.set(localName, {
            specifier,
            importedName,
          });
        }
        continue;
      }

      const importMatch = trimmed.match(/^import\s+(.+)$/);
      if (importMatch) {
        const modules = importMatch[1].split(',').map(part => part.trim()).filter(Boolean);
        for (const imported of modules) {
          const aliasMatch = imported.match(/^([A-Za-z_][A-Za-z0-9_\.]*)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/);
          const moduleName = aliasMatch ? aliasMatch[1] : imported;
          const localName = aliasMatch
            ? aliasMatch[2]
            : moduleName.split('.').pop() || moduleName;
          const specifier = normalizePythonImportSpecifier(moduleName, 0);
          imports.add(specifier);
          importBindings.set(localName, {
            specifier,
            importedName: moduleName.split('.').pop() || moduleName,
            isNamespace: true,
          });
        }
        continue;
      }

      const classMatch = line.match(/^(\s*)class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\(([^)]*)\))?\s*:/);
      if (classMatch) {
        const classOwner = pushSymbol('class', classMatch[2], lineOffsets[i]);
        if (classOwner) {
          ownerStack.push({ indent, owner: classOwner });
          const bases = (classMatch[3] || '')
            .split(',')
            .map(part => part.trim())
            .filter(part => part && part !== 'object');
          for (const baseName of bases) {
            addRelationHint({
              label: 'EXTENDS',
              fromId: classOwner.id,
              toName: baseName.split('.').pop() || baseName,
              candidateNames: [baseName, baseName.split('.').pop() || baseName],
            });
          }
        }
        continue;
      }

      const functionMatch = line.match(/^(\s*)def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
      if (functionMatch) {
        const owner = ownerStack.length > 0 ? ownerStack[ownerStack.length - 1].owner : undefined;
        const callableOwner = pushSymbol(owner ? 'method' : 'function', functionMatch[2], lineOffsets[i], {
          owner,
          declaration: owner ? 'class_method' : 'function',
        });
        if (callableOwner) {
          collectPythonCallHints(callableOwner, getPythonBlockText(i, indent));
        }
      }
    }

    return {
      symbols,
      imports: [...imports],
      relationHints,
    };
  }

  private parseGoFile(file: FileEntry): FileAnalysis {
    const content = file.content;
    const imports = new Set<string>();
    const importBindings = new Map<string, TsImportBinding>();
    const symbols: ExtractedSymbol[] = [];
    const relationHints: RelationHint[] = [];
    const seenIds = new Set<string>();
    const ownerByName = new Map<string, OwnerContext>();

    const pushSymbol = (
      kind: string,
      rawName: string,
      startIndex: number,
      options?: {
        owner?: OwnerContext;
        declaration?: string;
        extraProperties?: Record<string, unknown>;
      },
    ): OwnerContext | null => {
      const name = options?.owner ? `${options.owner.name}.${rawName}` : rawName;
      const symbolId = `symbol:${kind}:${file.relPath}:${name}`;
      if (!rawName || seenIds.has(symbolId)) return null;
      seenIds.add(symbolId);
      const startLine = content.slice(0, startIndex).split('\n').length;
      const node: CodeIntelNode = {
        id: symbolId,
        label: name,
        type: 'symbol',
        properties: {
          kind,
          language: 'go',
          filePath: file.relPath,
          rawName,
          startLine,
          exported: /^[A-Z]/.test(rawName),
          ownerId: options?.owner?.id,
          ownerKind: options?.owner?.kind,
          declaration: options?.declaration,
          ...(options?.extraProperties || {}),
        },
      };
      symbols.push({ node, ownerId: options?.owner?.id });
      return {
        id: symbolId,
        kind,
        name,
        exported: /^[A-Z]/.test(rawName),
      };
    };

    const addRelationHint = (hint: Omit<RelationHint, 'filePath'>) => {
      if (!hint.fromId || !hint.toName) return;
      relationHints.push({
        ...hint,
        filePath: file.relPath,
      });
    };

    const extractGoBlock = (braceIndex: number): string => {
      let depth = 0;
      let start = braceIndex + 1;
      for (let i = braceIndex; i < content.length; i++) {
        if (content[i] === '{') {
          depth += 1;
          if (depth === 1) start = i + 1;
        } else if (content[i] === '}') {
          depth -= 1;
          if (depth === 0) return content.slice(start, i);
        }
      }
      return '';
    };

    const collectGoCallHints = (owner: OwnerContext, body: string) => {
      if (!body.trim()) return;
      const bindingTypes = new Map<string, string>();
      const seenCalls = new Set<string>();

      const varTypeRe = /\bvar\s+([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
      let varTypeMatch: RegExpExecArray | null;
      while ((varTypeMatch = varTypeRe.exec(body)) !== null) {
        bindingTypes.set(varTypeMatch[1], varTypeMatch[2]);
      }

      const shortInitRe = /\b([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*&?([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
      let shortInitMatch: RegExpExecArray | null;
      while ((shortInitMatch = shortInitRe.exec(body)) !== null) {
        bindingTypes.set(shortInitMatch[1], shortInitMatch[2]);
      }

      const newRe = /\b([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*new\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g;
      let newMatch: RegExpExecArray | null;
      while ((newMatch = newRe.exec(body)) !== null) {
        bindingTypes.set(newMatch[1], newMatch[2]);
      }

      const callRe = /([A-Za-z_][A-Za-z0-9_\.]*)\s*\(/g;
      const ignored = new Set(['if', 'for', 'switch', 'return', 'make', 'new']);
      let callMatch: RegExpExecArray | null;
      while ((callMatch = callRe.exec(body)) !== null) {
        const expr = callMatch[1];
        if (!expr || ignored.has(expr)) continue;
        let targetName = expr;
        let candidateNames = [expr];
        let preferredImportSpecifier: string | undefined;
        let preferredImportName: string | undefined;
        let toKind: string | undefined;

        if (expr.includes('.')) {
          const segments = expr.split('.');
          const methodName = segments.pop() || '';
          const baseName = segments[segments.length - 1] || '';
          if (!methodName) continue;
          targetName = methodName;
          candidateNames = [expr, methodName];
          const boundType = bindingTypes.get(baseName);
          if (boundType) {
            candidateNames.unshift(`${boundType}.${methodName}`);
            toKind = 'method';
          }
          const importBinding = importBindings.get(baseName);
          if (importBinding) {
            preferredImportSpecifier = importBinding.specifier;
            preferredImportName = importBinding.importedName;
          }
        } else {
          const importBinding = importBindings.get(expr);
          if (importBinding) {
            preferredImportSpecifier = importBinding.specifier;
            preferredImportName = importBinding.importedName;
          }
        }

        const key = `${targetName}:${candidateNames.join('|')}`;
        if (seenCalls.has(key)) continue;
        seenCalls.add(key);
        addRelationHint({
          label: 'CALLS',
          fromId: owner.id,
          toName: targetName,
          candidateNames,
          toKind,
          preferredImportSpecifier,
          preferredImportName,
        });
      }
    };

    const registerOwner = (owner: OwnerContext | null) => {
      if (!owner) return;
      ownerByName.set(owner.name, owner);
      const shortName = owner.name.split('.').pop();
      if (shortName) ownerByName.set(shortName, owner);
    };

    const importBlockRe = /import\s*\(([\s\S]*?)\)/g;
    let importBlockMatch: RegExpExecArray | null;
    while ((importBlockMatch = importBlockRe.exec(content)) !== null) {
      const block = importBlockMatch[1];
      const itemRe = /^\s*(?:(?:([A-Za-z_][A-Za-z0-9_]*)|\.)\s+)?"([^"]+)"\s*$/gm;
      let itemMatch: RegExpExecArray | null;
      while ((itemMatch = itemRe.exec(block)) !== null) {
        const specifier = itemMatch[2];
        imports.add(specifier);
        const importedName = path.posix.basename(specifier);
        importBindings.set(itemMatch[1] || importedName, {
          specifier,
          importedName,
          isNamespace: true,
        });
      }
    }

    const singleImportRe = /^import\s+(?:(?:([A-Za-z_][A-Za-z0-9_]*)|\.)\s+)?"([^"]+)"\s*$/gm;
    let singleImportMatch: RegExpExecArray | null;
    while ((singleImportMatch = singleImportRe.exec(content)) !== null) {
      const specifier = singleImportMatch[2];
      imports.add(specifier);
      const importedName = path.posix.basename(specifier);
      importBindings.set(singleImportMatch[1] || importedName, {
        specifier,
        importedName,
        isNamespace: true,
      });
    }

    const interfaceRe = /type\s+([A-Za-z_][A-Za-z0-9_]*)\s+interface\s*\{/g;
    let interfaceMatch: RegExpExecArray | null;
    while ((interfaceMatch = interfaceRe.exec(content)) !== null) {
      const interfaceOwner = pushSymbol('interface', interfaceMatch[1], interfaceMatch.index);
      registerOwner(interfaceOwner);
      const block = extractGoBlock(content.indexOf('{', interfaceMatch.index));
      if (!interfaceOwner) continue;
      const methodRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
      let methodMatch: RegExpExecArray | null;
      while ((methodMatch = methodRe.exec(block)) !== null) {
        pushSymbol('method', methodMatch[1], interfaceMatch.index + methodMatch.index, {
          owner: interfaceOwner,
          declaration: 'interface_method',
        });
      }
    }

    const structRe = /type\s+([A-Za-z_][A-Za-z0-9_]*)\s+struct\s*\{/g;
    let structMatch: RegExpExecArray | null;
    while ((structMatch = structRe.exec(content)) !== null) {
      registerOwner(pushSymbol('struct', structMatch[1], structMatch.index));
    }

    const funcRe = /func\s*(\(([^)]*)\))?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let funcMatch: RegExpExecArray | null;
    while ((funcMatch = funcRe.exec(content)) !== null) {
      const receiver = funcMatch[2];
      const rawName = funcMatch[3];
      let owner: OwnerContext | undefined;
      if (receiver) {
        const receiverType = receiver
          .trim()
          .split(/\s+/)
          .pop()
          ?.replace(/^[\*\[\]]+/, '')
          .replace(/[^\w]/g, '');
        if (receiverType) {
          owner = ownerByName.get(receiverType);
        }
      }
      const callableOwner = pushSymbol(owner ? 'method' : 'function', rawName, funcMatch.index, {
        owner,
        declaration: owner ? 'receiver_method' : 'function',
      });
      if (!callableOwner) continue;
      const braceIndex = content.indexOf('{', funcMatch.index);
      if (braceIndex >= 0) {
        collectGoCallHints(callableOwner, extractGoBlock(braceIndex));
      }
    }

    return {
      symbols,
      imports: [...imports],
      relationHints,
    };
  }

  private parseJavaFile(file: FileEntry): FileAnalysis {
    return this.parseJvmLikeFile(file, 'java');
  }

  private parseKotlinFile(file: FileEntry): FileAnalysis {
    return this.parseJvmLikeFile(file, 'kotlin');
  }

  private parseJvmLikeFile(file: FileEntry, language: 'java' | 'kotlin'): FileAnalysis {
    const content = file.content;
    const braceDepth = this.buildBraceDepthMap(content);
    const imports = new Set<string>();
    const importBindings = new Map<string, TsImportBinding>();
    const symbols: ExtractedSymbol[] = [];
    const relationHints: RelationHint[] = [];
    const seenIds = new Set<string>();
    const ownerByName = new Map<string, OwnerContext>();
    const packageName = content.match(/^\s*package\s+([A-Za-z_][A-Za-z0-9_\.]*)/m)?.[1] || '';

    const pushSymbol = (
      kind: string,
      rawName: string,
      startIndex: number,
      options?: {
        owner?: OwnerContext;
        declaration?: string;
        extraProperties?: Record<string, unknown>;
      },
    ): OwnerContext | null => {
      const name = options?.owner ? `${options.owner.name}.${rawName}` : rawName;
      const symbolId = `symbol:${kind}:${file.relPath}:${name}`;
      if (!rawName || seenIds.has(symbolId)) return null;
      seenIds.add(symbolId);
      const startLine = content.slice(0, startIndex).split('\n').length;
      const node: CodeIntelNode = {
        id: symbolId,
        label: name,
        type: 'symbol',
        properties: {
          kind,
          language,
          filePath: file.relPath,
          rawName,
          startLine,
          exported: true,
          ownerId: options?.owner?.id,
          ownerKind: options?.owner?.kind,
          declaration: options?.declaration,
          ...(options?.extraProperties || {}),
        },
      };
      symbols.push({ node, ownerId: options?.owner?.id });
      return {
        id: symbolId,
        kind,
        name,
        exported: true,
      };
    };

    const registerOwner = (owner: OwnerContext | null) => {
      if (!owner) return;
      ownerByName.set(owner.name, owner);
      const shortName = owner.name.split('.').pop();
      if (shortName) ownerByName.set(shortName, owner);
    };

    const addRelationHint = (hint: Omit<RelationHint, 'filePath'>) => {
      if (!hint.fromId || !hint.toName) return;
      relationHints.push({
        ...hint,
        filePath: file.relPath,
      });
    };

    const normalizeJvmImportSpecifier = (importedFqn: string): string => {
      const currentDir = path.posix.dirname(file.relPath);
      const packageParts = packageName ? packageName.split('.') : [];
      const currentParts = currentDir.split('/').filter(Boolean);
      let rootParts = currentParts;
      if (
        packageParts.length > 0
        && currentParts.length >= packageParts.length
        && currentParts.slice(-packageParts.length).join('.') === packageName
      ) {
        rootParts = currentParts.slice(0, currentParts.length - packageParts.length);
      }
      return path.posix.join(...rootParts, importedFqn.replace(/\./g, '/'));
    };

    const extractBraceBlock = (braceIndex: number): string => {
      let depth = 0;
      let start = braceIndex + 1;
      for (let i = braceIndex; i < content.length; i++) {
        if (content[i] === '{') {
          depth += 1;
          if (depth === 1) start = i + 1;
        } else if (content[i] === '}') {
          depth -= 1;
          if (depth === 0) return content.slice(start, i);
        }
      }
      return '';
    };

    const collectJvmCallHints = (owner: OwnerContext, body: string) => {
      if (!body.trim()) return;
      const bindingTypes = new Map<string, string>();
      const seenCalls = new Set<string>();

      const javaNewRe = /\b[A-Za-z_][A-Za-z0-9_]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*new\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
      let javaNewMatch: RegExpExecArray | null;
      while ((javaNewMatch = javaNewRe.exec(body)) !== null) {
        bindingTypes.set(javaNewMatch[1], javaNewMatch[2]);
      }

      const javaAssignRe = /\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*new\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
      let javaAssignMatch: RegExpExecArray | null;
      while ((javaAssignMatch = javaAssignRe.exec(body)) !== null) {
        bindingTypes.set(javaAssignMatch[1], javaAssignMatch[2]);
      }

      const kotlinValRe = /\b(?:val|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*([A-Za-z_][A-Za-z0-9_]*))?\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
      let kotlinValMatch: RegExpExecArray | null;
      while ((kotlinValMatch = kotlinValRe.exec(body)) !== null) {
        bindingTypes.set(kotlinValMatch[1], kotlinValMatch[2] || kotlinValMatch[3]);
      }

      const callRe = /([A-Za-z_][A-Za-z0-9_\.]*)\s*\(/g;
      const ignored = new Set(['if', 'for', 'while', 'switch', 'return', 'new', 'super']);
      let callMatch: RegExpExecArray | null;
      while ((callMatch = callRe.exec(body)) !== null) {
        const expr = callMatch[1];
        if (!expr || ignored.has(expr)) continue;
        let targetName = expr;
        let candidateNames = [expr];
        let preferredImportSpecifier: string | undefined;
        let preferredImportName: string | undefined;
        let toKind: string | undefined;

        if (expr.includes('.')) {
          const segments = expr.split('.');
          const methodName = segments.pop() || '';
          const baseName = segments[segments.length - 1] || '';
          if (!methodName) continue;
          targetName = methodName;
          candidateNames = [expr, methodName];
          const boundType = bindingTypes.get(baseName);
          if (boundType) {
            candidateNames.unshift(`${boundType}.${methodName}`);
            toKind = 'method';
          }
          const importBinding = importBindings.get(baseName);
          if (importBinding) {
            preferredImportSpecifier = importBinding.specifier;
            preferredImportName = importBinding.importedName;
          }
        } else {
          const importBinding = importBindings.get(expr);
          if (importBinding) {
            preferredImportSpecifier = importBinding.specifier;
            preferredImportName = importBinding.importedName;
          }
        }

        const key = `${targetName}:${candidateNames.join('|')}`;
        if (seenCalls.has(key)) continue;
        seenCalls.add(key);
        addRelationHint({
          label: 'CALLS',
          fromId: owner.id,
          toName: targetName,
          candidateNames,
          toKind,
          preferredImportSpecifier,
          preferredImportName,
        });
      }
    };

    const importRe = /^\s*import\s+([A-Za-z_][A-Za-z0-9_\.]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;?$/gm;
    let importMatch: RegExpExecArray | null;
    while ((importMatch = importRe.exec(content)) !== null) {
      const importedFqn = importMatch[1];
      const importedName = importedFqn.split('.').pop() || importedFqn;
      const localName = importMatch[2] || importedName;
      const specifier = normalizeJvmImportSpecifier(importedFqn);
      imports.add(specifier);
      importBindings.set(localName, {
        specifier,
        importedName,
      });
    }

    if (language === 'java') {
      const typeRe = /\b(?:public\s+|protected\s+|private\s+)?(?:abstract\s+|final\s+)?(class|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+extends\s+([A-Za-z_][A-Za-z0-9_\.]*))?(?:\s+implements\s+([A-Za-z_][A-Za-z0-9_\.,\s]*))?\s*\{/g;
      let typeMatch: RegExpExecArray | null;
      while ((typeMatch = typeRe.exec(content)) !== null) {
        if (!this.isTopLevelMatch(braceDepth, typeMatch.index)) continue;
        const kind = typeMatch[1] === 'class' ? 'class' : typeMatch[1];
        const owner = pushSymbol(kind, typeMatch[2], typeMatch.index);
        registerOwner(owner);
        if (!owner) continue;
        if (typeMatch[3]) {
          const baseName = typeMatch[3].trim();
          addRelationHint({
            label: 'EXTENDS',
            fromId: owner.id,
            toName: baseName.split('.').pop() || baseName,
            candidateNames: [baseName, baseName.split('.').pop() || baseName],
            preferredImportSpecifier: importBindings.get(baseName.split('.').pop() || baseName)?.specifier,
          });
        }
        for (const iface of (typeMatch[4] || '').split(',').map(part => part.trim()).filter(Boolean)) {
          addRelationHint({
            label: 'IMPLEMENTS',
            fromId: owner.id,
            toName: iface.split('.').pop() || iface,
            candidateNames: [iface, iface.split('.').pop() || iface],
            preferredImportSpecifier: importBindings.get(iface.split('.').pop() || iface)?.specifier,
          });
        }
        const body = extractBraceBlock(content.indexOf('{', typeMatch.index));
        if (kind === 'interface') {
          const signatureRe = /\b[A-Za-z_][A-Za-z0-9_<>\[\]]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^;{}]*\)\s*;/g;
          let signatureMatch: RegExpExecArray | null;
          while ((signatureMatch = signatureRe.exec(body)) !== null) {
            pushSymbol('method', signatureMatch[1], typeMatch.index + signatureMatch.index, {
              owner,
              declaration: 'interface_method',
            });
          }
        } else {
          const methodRe = /\b(?:public|protected|private)?\s*(?:static\s+)?(?:final\s+)?[A-Za-z_][A-Za-z0-9_<>\[\]]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^;{}]*\)\s*\{/g;
          let methodMatch: RegExpExecArray | null;
          while ((methodMatch = methodRe.exec(body)) !== null) {
            const methodOwner = pushSymbol('method', methodMatch[1], typeMatch.index + methodMatch.index, {
              owner,
              declaration: 'class_method',
            });
            if (methodOwner) {
              const localBraceIndex = body.indexOf('{', methodMatch.index);
              if (localBraceIndex >= 0) {
                collectJvmCallHints(methodOwner, body.slice(localBraceIndex + 1));
              }
            }
          }
        }
      }
    } else {
      const interfaceRe = /\binterface\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([^{\n]+))?\s*\{/g;
      let interfaceMatch: RegExpExecArray | null;
      while ((interfaceMatch = interfaceRe.exec(content)) !== null) {
        if (!this.isTopLevelMatch(braceDepth, interfaceMatch.index)) continue;
        const owner = pushSymbol('interface', interfaceMatch[1], interfaceMatch.index);
        registerOwner(owner);
        if (!owner) continue;
        const body = extractBraceBlock(content.indexOf('{', interfaceMatch.index));
        const methodRe = /\bfun\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
        let methodMatch: RegExpExecArray | null;
        while ((methodMatch = methodRe.exec(body)) !== null) {
          pushSymbol('method', methodMatch[1], interfaceMatch.index + methodMatch.index, {
            owner,
            declaration: 'interface_method',
          });
        }
      }

      const classRe = /\b(?:open\s+|abstract\s+|data\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([^{\n]+))?\s*\{/g;
      let classMatch: RegExpExecArray | null;
      while ((classMatch = classRe.exec(content)) !== null) {
        if (!this.isTopLevelMatch(braceDepth, classMatch.index)) continue;
        const owner = pushSymbol('class', classMatch[1], classMatch.index);
        registerOwner(owner);
        if (!owner) continue;
        const baseParts = (classMatch[2] || '')
          .split(',')
          .map(part => part.trim().replace(/\(\)/g, ''))
          .filter(Boolean);
        if (baseParts[0]) {
          const baseName = baseParts[0];
          addRelationHint({
            label: 'EXTENDS',
            fromId: owner.id,
            toName: baseName.split('.').pop() || baseName,
            candidateNames: [baseName, baseName.split('.').pop() || baseName],
            preferredImportSpecifier: importBindings.get(baseName.split('.').pop() || baseName)?.specifier,
          });
        }
        for (const iface of baseParts.slice(1)) {
          addRelationHint({
            label: 'IMPLEMENTS',
            fromId: owner.id,
            toName: iface.split('.').pop() || iface,
            candidateNames: [iface, iface.split('.').pop() || iface],
            preferredImportSpecifier: importBindings.get(iface.split('.').pop() || iface)?.specifier,
          });
        }
        const body = extractBraceBlock(content.indexOf('{', classMatch.index));
        const methodRe = /\bfun\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)(?:\s*:\s*[A-Za-z_][A-Za-z0-9_<>\?]*)?\s*(?:=\s*|\{)/g;
        let methodMatch: RegExpExecArray | null;
        while ((methodMatch = methodRe.exec(body)) !== null) {
          const methodOwner = pushSymbol('method', methodMatch[1], classMatch.index + methodMatch.index, {
            owner,
            declaration: 'class_method',
          });
          if (!methodOwner) continue;
          const inlineBody = body.slice(methodRe.lastIndex, Math.min(body.length, methodRe.lastIndex + 120));
          const localBraceIndex = body.indexOf('{', methodMatch.index);
          if (localBraceIndex >= 0 && localBraceIndex < methodRe.lastIndex + 5) {
            collectJvmCallHints(methodOwner, body.slice(localBraceIndex + 1));
          } else {
            collectJvmCallHints(methodOwner, inlineBody);
          }
        }
      }

      const topLevelFunRe = /^\s*fun\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)(?:\s*:\s*[A-Za-z_][A-Za-z0-9_<>\?]*)?\s*(?:=\s*|\{)/gm;
      let topLevelFunMatch: RegExpExecArray | null;
      while ((topLevelFunMatch = topLevelFunRe.exec(content)) !== null) {
        if (!this.isTopLevelMatch(braceDepth, topLevelFunMatch.index)) continue;
        const functionOwner = pushSymbol('function', topLevelFunMatch[1], topLevelFunMatch.index, {
          declaration: 'function',
        });
        if (!functionOwner) continue;
        const tail = content.slice(topLevelFunRe.lastIndex, Math.min(content.length, topLevelFunRe.lastIndex + 200));
        collectJvmCallHints(functionOwner, tail);
      }
    }

    if (language === 'java') {
      const topLevelFunctionRe = /\b(?:public|protected|private)?\s*(?:static\s+)?[A-Za-z_][A-Za-z0-9_<>\[\]]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^;{}]*\)\s*\{/g;
      let topLevelFunctionMatch: RegExpExecArray | null;
      while ((topLevelFunctionMatch = topLevelFunctionRe.exec(content)) !== null) {
        if (!this.isTopLevelMatch(braceDepth, topLevelFunctionMatch.index)) continue;
        const functionOwner = pushSymbol('function', topLevelFunctionMatch[1], topLevelFunctionMatch.index, {
          declaration: 'function',
        });
        if (!functionOwner) continue;
        const braceIndex = content.indexOf('{', topLevelFunctionMatch.index);
        if (braceIndex >= 0) {
          collectJvmCallHints(functionOwner, extractBraceBlock(braceIndex));
        }
      }
    }

    return {
      symbols,
      imports: [...imports],
      relationHints,
    };
  }

  private getTsScriptKind(relPath: string): ts.ScriptKind {
    const ext = path.extname(relPath).toLowerCase();
    switch (ext) {
      case '.ts':
        return ts.ScriptKind.TS;
      case '.tsx':
        return ts.ScriptKind.TSX;
      case '.jsx':
        return ts.ScriptKind.JSX;
      case '.mjs':
      case '.cjs':
      case '.js':
      default:
        return ts.ScriptKind.JS;
    }
  }

  private getTsPropertyName(name: ts.PropertyName | undefined): string | null {
    if (!name) return null;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
      return name.text;
    }
    return null;
  }

  private isTsExported(node: ts.Node, inheritedExport = false): boolean {
    if (inheritedExport) return true;
    const modifiers = ((node as ts.HasModifiers).modifiers || []) as readonly ts.Modifier[];
    return modifiers.some(
      modifier => modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword,
    );
  }

  private getTsVisibility(node: ts.Node): 'public' | 'private' | 'protected' {
    const modifiers = ((node as ts.HasModifiers).modifiers || []) as readonly ts.Modifier[];
    if (modifiers.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword)) return 'private';
    if (modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ProtectedKeyword)) return 'protected';
    return 'public';
  }

  private isTsDefaultExported(node: ts.Node): boolean {
    const modifiers = ((node as ts.HasModifiers).modifiers || []) as readonly ts.Modifier[];
    return modifiers.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword);
  }

  private resolveTsBoundTypeName(
    declaration: ts.VariableDeclaration,
    sourceFile: ts.SourceFile,
  ): string | null {
    if (declaration.type && ts.isTypeReferenceNode(declaration.type)) {
      return declaration.type.typeName.getText(sourceFile);
    }
    if (declaration.initializer && ts.isNewExpression(declaration.initializer)) {
      return declaration.initializer.expression.getText(sourceFile);
    }
    return null;
  }

  private findTsImportBindingForType(
    typeName: string,
    importBindings: Map<string, TsImportBinding>,
  ): TsImportBinding | undefined {
    const rootName = typeName.split('.')[0];
    const shortName = typeName.split('.').pop() || typeName;
    return importBindings.get(rootName) || importBindings.get(shortName);
  }

  private parseRustFile(file: FileEntry): FileAnalysis {
    const content = file.content;
    const symbols: ExtractedSymbol[] = [];
    const imports = new Set<string>(this.extractRustImports(content));
    const relationHints: RelationHint[] = [];
    const seenIds = new Set<string>();
    const ownerByName = new Map<string, OwnerContext>();
    const braceDepth = this.buildBraceDepthMap(content);

    const registerOwner = (owner: OwnerContext | null) => {
      if (!owner) return;
      ownerByName.set(owner.name, owner);
      const shortName = owner.name.split('::').pop();
      if (shortName) ownerByName.set(shortName, owner);
    };

    const pushRustSymbol = (
      kind: string,
      rawName: string,
      startIndex: number,
      options?: {
        owner?: OwnerContext;
        exported?: boolean;
        visibility?: string;
        extraProperties?: Record<string, unknown>;
      },
    ): OwnerContext | null => {
      const name = options?.owner ? `${options.owner.name}.${rawName}` : rawName;
      const symbolId = `symbol:${kind}:${file.relPath}:${name}`;
      if (!rawName || seenIds.has(symbolId)) return null;
      seenIds.add(symbolId);
      const startLine = content.slice(0, startIndex).split('\n').length;
      const node: CodeIntelNode = {
        id: symbolId,
        label: name,
        type: 'symbol',
        properties: {
          kind,
          language: 'rust',
          filePath: file.relPath,
          rawName,
          startLine,
          exported: !!options?.exported,
          ownerId: options?.owner?.id,
          ownerKind: options?.owner?.kind,
          visibility: options?.visibility,
          ...(options?.extraProperties || {}),
        },
      };
      symbols.push({
        node,
        ownerId: options?.owner?.id,
      });
      return {
        id: symbolId,
        kind,
        name,
        exported: options?.exported,
      };
    };

    const addRelationHint = (hint: Omit<RelationHint, 'filePath'>) => {
      if (!hint.fromId || !hint.toName) return;
      relationHints.push({
        ...hint,
        filePath: file.relPath,
      });
    };

    const collectRustCallHints = (owner: OwnerContext, body: string, bodyStartIndex: number) => {
      const callRe = /\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)\s*\(/g;
      const bindingTypes = new Map<string, string>();
      const bindingRe = /\blet\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Z][A-Za-z0-9_:]*)/g;
      let bindingMatch: RegExpExecArray | null;
      while ((bindingMatch = bindingRe.exec(body)) !== null) {
        bindingTypes.set(bindingMatch[1], this.normalizeRustTypeName(bindingMatch[2]));
      }
      let callMatch: RegExpExecArray | null;
      const seenCalls = new Set<string>();
      while ((callMatch = callRe.exec(body)) !== null) {
        const expression = callMatch[1];
        const targetName = expression.includes('.') ? expression.split('.').pop() || '' : expression;
        if (['fn', 'if', 'while', 'loop', 'match', 'for'].includes(targetName)) continue;
        if (seenCalls.has(expression)) continue;
        seenCalls.add(expression);
        const candidateNames = [targetName];
        let preferredImportSpecifier: string | undefined;
        if (expression.includes('.')) {
          const [receiver, methodName] = expression.split('.');
          const boundType = bindingTypes.get(receiver);
          if (boundType) {
            candidateNames.unshift(`${boundType}.${methodName}`);
            preferredImportSpecifier = this.findRustImportSpecifierForType(boundType, imports);
          }
        }
        addRelationHint({
          label: 'CALLS',
          fromId: owner.id,
          toName: targetName,
          candidateNames,
          preferredImportSpecifier,
          properties: { bodyStartIndex },
        });
      }
    };

    const findOwner = (typeName: string): OwnerContext | null => {
      const normalized = this.normalizeRustTypeName(typeName);
      if (!normalized) return null;
      return ownerByName.get(normalized) || ownerByName.get(normalized.split('::').pop() || '') || null;
    };

    const traitBlockRe = /\b(?:pub\s+)?trait\s+([A-Za-z_][A-Za-z0-9_]*)[^{]*\{/g;
    let match: RegExpExecArray | null;
    while ((match = traitBlockRe.exec(content)) !== null) {
      if (!this.isTopLevelMatch(braceDepth, match.index)) continue;
      const traitOwner = pushRustSymbol('trait', match[1], match.index, {
        exported: /^pub\b/.test(match[0]),
        visibility: /^pub\b/.test(match[0]) ? 'public' : 'private',
      });
      registerOwner(traitOwner);
      if (!traitOwner) continue;
      const openBraceIndex = content.indexOf('{', match.index);
      if (openBraceIndex < 0) continue;
      const closeBraceIndex = this.findMatchingBrace(content, openBraceIndex);
      if (closeBraceIndex < 0) continue;
      const blockContent = content.slice(openBraceIndex + 1, closeBraceIndex);
      const fnRe = /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
      let fnMatch: RegExpExecArray | null;
      while ((fnMatch = fnRe.exec(blockContent)) !== null) {
        pushRustSymbol('method', fnMatch[1], openBraceIndex + 1 + fnMatch.index, {
          owner: traitOwner,
          visibility: 'public',
          extraProperties: { declaration: 'trait_method' },
        });
      }
    }

    const topLevelPatterns: Array<{
      kind: string;
      regex: RegExp;
      visibility?: (matchedText: string) => string;
      exported?: (matchedText: string) => boolean;
    }> = [
      {
        kind: 'module',
        regex: /\b(?:pub\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\b/g,
      },
      {
        kind: 'struct',
        regex: /\b(?:pub\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)\b/g,
      },
      {
        kind: 'enum',
        regex: /\b(?:pub\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)\b/g,
      },
      {
        kind: 'type',
        regex: /\b(?:pub\s+)?type\s+([A-Za-z_][A-Za-z0-9_]*)\b/g,
      },
      {
        kind: 'const',
        regex: /\b(?:pub\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\b/g,
      },
      {
        kind: 'static',
        regex: /\b(?:pub\s+)?static\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\b/g,
      },
      {
        kind: 'function',
        regex: /\b(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g,
      },
    ];

    for (const entry of topLevelPatterns) {
      let topMatch: RegExpExecArray | null;
      while ((topMatch = entry.regex.exec(content)) !== null) {
        if (!this.isTopLevelMatch(braceDepth, topMatch.index)) continue;
        const owner = pushRustSymbol(entry.kind, topMatch[1], topMatch.index, {
          exported: /^pub\b/.test(topMatch[0]),
          visibility: /^pub\b/.test(topMatch[0]) ? 'public' : 'private',
        });
        registerOwner(owner);
        if (!owner || entry.kind !== 'function') continue;
        const fnHeaderIndex = content.indexOf(topMatch[0], topMatch.index);
        const fnBodyOpen = content.indexOf('{', fnHeaderIndex);
        if (fnBodyOpen < 0) continue;
        const fnBodyClose = this.findMatchingBrace(content, fnBodyOpen);
        if (fnBodyClose <= fnBodyOpen) continue;
        collectRustCallHints(
          owner,
          content.slice(fnBodyOpen + 1, fnBodyClose),
          fnBodyOpen + 1,
        );
      }
    }

    const implRe = /\bimpl\b[^{]*\{/g;
    while ((match = implRe.exec(content)) !== null) {
      if (!this.isTopLevelMatch(braceDepth, match.index)) continue;
      const openBraceIndex = content.indexOf('{', match.index);
      if (openBraceIndex < 0) continue;
      const closeBraceIndex = this.findMatchingBrace(content, openBraceIndex);
      if (closeBraceIndex < 0) continue;
      const header = content.slice(match.index, openBraceIndex);
      const body = content.slice(openBraceIndex + 1, closeBraceIndex);
      const implInfo = this.parseRustImplHeader(header);
      const owner = findOwner(implInfo.targetType);
      if (owner && implInfo.traitName) {
        addRelationHint({
          label: 'IMPLEMENTS',
          fromId: owner.id,
          toName: implInfo.traitName,
          candidateNames: [implInfo.traitName],
          toKind: 'trait',
          preferredImportSpecifier: this.findRustImportSpecifierForType(implInfo.traitName, imports),
        });
      }
      const fnRe = /\b(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
      let fnMatch: RegExpExecArray | null;
      while ((fnMatch = fnRe.exec(body)) !== null) {
        const methodOwner = pushRustSymbol('method', fnMatch[1], openBraceIndex + 1 + fnMatch.index, {
          owner: owner || undefined,
          exported: /^pub\b/.test(fnMatch[0]) || !!owner?.exported,
          visibility: /^pub\b/.test(fnMatch[0]) ? 'public' : 'private',
          extraProperties: {
            implTarget: implInfo.targetType,
            implTrait: implInfo.traitName,
            declaration: implInfo.traitName ? 'trait_impl_method' : 'impl_method',
          },
        });
        if (methodOwner) {
          const fnHeaderIndex = body.indexOf(fnMatch[0], fnMatch.index);
          const fnBodyOpen = body.indexOf('{', fnHeaderIndex);
          if (fnBodyOpen >= 0) {
            const fnBodyClose = this.findMatchingBrace(body, fnBodyOpen);
            if (fnBodyClose > fnBodyOpen) {
              collectRustCallHints(
                methodOwner,
                body.slice(fnBodyOpen + 1, fnBodyClose),
                openBraceIndex + 1 + fnBodyOpen + 1,
              );
            }
          }
        }
      }
    }

    return {
      symbols,
      imports: [...imports],
      relationHints,
    };
  }

  private pickRelationTargetId(
    candidateIds: string[],
    nodes: CodeIntelNode[],
    expectedKind?: string,
  ): string | null {
    if (candidateIds.length === 0) return null;
    if (!expectedKind) return candidateIds[0];
    for (const candidateId of candidateIds) {
      const node = nodes.find(item => item.id === candidateId);
      if (String(node?.properties?.kind || '') === expectedKind) return candidateId;
    }
    return candidateIds[0];
  }

  private pickIrRelationTargetId(
    candidateIds: string[],
    entities: CodeIntelIrEntity[],
    expectedKind?: string,
  ): string | null {
    if (candidateIds.length === 0) return null;
    if (!expectedKind) return candidateIds[0];
    for (const candidateId of candidateIds) {
      const entity = entities.find(item => item.id === candidateId);
      if (entity?.kind === expectedKind) return candidateId;
    }
    return candidateIds[0];
  }

  private extractRustImports(content: string): string[] {
    const imports = new Set<string>();
    const rustUseRe = /^\s*use\s+((?:crate|self|super)::[A-Za-z0-9_:\{\},\s]+)\s*;/gm;
    const rustModRe = /^\s*(?:pub\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/gm;
    let match: RegExpExecArray | null;

    while ((match = rustUseRe.exec(content)) !== null) {
      const statement = match[1].trim();
      const prefixMatch = statement.match(/^(crate|self|super)::/);
      if (!prefixMatch) continue;
      const prefix = prefixMatch[1];
      const body = statement.slice(prefix.length + 2);
      const braceIndex = body.indexOf('{');
      if (braceIndex >= 0) {
        imports.add(`${prefix}::${body.slice(0, braceIndex).replace(/:+$/, '')}`);
      } else {
        imports.add(`${prefix}::${body}`);
      }
    }
    while ((match = rustModRe.exec(content)) !== null) {
      imports.add(`mod:${match[1]}`);
    }

    return [...imports];
  }

  private buildBraceDepthMap(content: string): number[] {
    const depths: number[] = new Array(content.length).fill(0);
    let depth = 0;
    for (let i = 0; i < content.length; i++) {
      depths[i] = depth;
      const char = content[i];
      if (char === '{') depth += 1;
      if (char === '}') depth = Math.max(0, depth - 1);
    }
    return depths;
  }

  private isTopLevelMatch(depths: number[], index: number): boolean {
    return (depths[index] || 0) === 0;
  }

  private findMatchingBrace(content: string, openBraceIndex: number): number {
    let depth = 0;
    for (let i = openBraceIndex; i < content.length; i++) {
      const char = content[i];
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  private parseRustImplHeader(header: string): { targetType: string; traitName?: string } {
    const raw = header.replace(/\bimpl\b/, '').trim();
    const normalized = raw.replace(/\s+/g, ' ');
    const parts = normalized.split(/\s+for\s+/);
    if (parts.length === 2) {
      return {
        traitName: this.normalizeRustTypeName(parts[0]),
        targetType: this.normalizeRustTypeName(parts[1]),
      };
    }
    return {
      targetType: this.normalizeRustTypeName(normalized),
    };
  }

  private normalizeRustTypeName(value: string): string {
    let normalized = value.trim();
    normalized = normalized.replace(/^unsafe\s+/, '');
    normalized = normalized.replace(/^default\s+/, '');
    normalized = normalized.replace(/^<[^>]+>\s*/, '');
    normalized = normalized.replace(/\bwhere\b[\s\S]*$/, '');
    normalized = normalized.replace(/<[^<>]*>/g, '');
    normalized = normalized.replace(/^&(?:mut\s+)?/, '');
    normalized = normalized.replace(/^\(?\s*/, '').replace(/\s*\)?$/, '');
    normalized = normalized.trim();
    return normalized;
  }

  private findRustImportSpecifierForType(
    typeName: string,
    imports: Set<string>,
  ): string | undefined {
    const normalized = this.normalizeRustTypeName(typeName);
    if (!normalized) return undefined;
    const shortName = normalized.split('::').pop() || normalized;
    for (const importSpecifier of imports) {
      if (importSpecifier.startsWith('mod:')) {
        if (importSpecifier.slice(4) === shortName) return importSpecifier;
        continue;
      }
      const normalizedImport = this.normalizeRustTypeName(importSpecifier);
      if (
        normalizedImport === normalized
        || normalizedImport.endsWith(`::${normalized}`)
        || normalizedImport.endsWith(`::${shortName}`)
      ) {
        return importSpecifier;
      }
    }
    return undefined;
  }

  private extractImports(content: string): string[] {
    const imports = new Set<string>();
    const tsImportRe = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match: RegExpExecArray | null;

    while ((match = tsImportRe.exec(content)) !== null) {
      imports.add(match[1]);
    }
    while ((match = requireRe.exec(content)) !== null) {
      imports.add(match[1]);
    }
    for (const rustImport of this.extractRustImports(content)) {
      imports.add(rustImport);
    }

    return [...imports];
  }

  private extractSymbols(file: FileEntry): Array<{ node: CodeIntelNode }> {
    const results: Array<{ node: CodeIntelNode }> = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const language = this.detectSymbolLanguage(file.relPath);

    const pushSymbol = (
      kind: string,
      name: string,
      matchIndex: number,
      extraProperties?: Record<string, unknown>,
    ) => {
      const symbolId = `symbol:${kind}:${file.relPath}:${name}`;
      const symbolNameKey = `${file.relPath}:${name}`;
      if (!name || seenIds.has(symbolId) || seenNames.has(symbolNameKey)) return;
      seenIds.add(symbolId);
      seenNames.add(symbolNameKey);
      const startLine = file.content.slice(0, matchIndex).split('\n').length;
      results.push({
        node: {
          id: symbolId,
          label: name,
          type: 'symbol',
          properties: {
            kind,
            language,
            filePath: file.relPath,
            startLine,
            ...(extraProperties || {}),
          },
        },
      });
    };

    const collectMatches = (
      kind: string,
      re: RegExp,
      extraProperties?: Record<string, unknown>,
    ) => {
      let match: RegExpExecArray | null;
      while ((match = re.exec(file.content)) !== null) {
        pushSymbol(kind, match[1], match.index, extraProperties);
      }
    };

    if (language === 'ts' || language === 'js') {
      collectMatches('function', /\b(?:export\s+default\s+|export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g);
      collectMatches('function', /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_][A-Za-z0-9_]*\s*=>)/g, { declaration: 'variable' });
      collectMatches('class', /\b(?:export\s+default\s+|export\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)\b/g);
      collectMatches('interface', /\b(?:export\s+)?interface\s+([A-Za-z_][A-Za-z0-9_]*)\b/g);
      collectMatches('type', /\b(?:export\s+)?type\s+([A-Za-z_][A-Za-z0-9_]*)\b/g);
      collectMatches('enum', /\b(?:export\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)\b/g);
      collectMatches('const', /\b(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g);
    } else if (language === 'rust') {
      collectMatches('function', /\b(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g);
      collectMatches('struct', /\b(?:pub\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)\b/g);
      collectMatches('enum', /\b(?:pub\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)\b/g);
      collectMatches('trait', /\b(?:pub\s+)?trait\s+([A-Za-z_][A-Za-z0-9_]*)\b/g);
      collectMatches('type', /\b(?:pub\s+)?type\s+([A-Za-z_][A-Za-z0-9_]*)\b/g);
      collectMatches('module', /\b(?:pub\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\b/g);
      collectMatches('const', /\b(?:pub\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\b/g);
      collectMatches('static', /\b(?:pub\s+)?static\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\b/g);
    } else if (language === 'python') {
      collectMatches('class', /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm);
      collectMatches('function', /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm);
    } else if (language === 'go') {
      collectMatches('function', /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/g);
      collectMatches('struct', /\btype\s+([A-Za-z_][A-Za-z0-9_]*)\s+struct\b/g);
      collectMatches('interface', /\btype\s+([A-Za-z_][A-Za-z0-9_]*)\s+interface\b/g);
    } else if (language === 'java') {
      collectMatches('class', /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/g);
      collectMatches('interface', /\binterface\s+([A-Za-z_][A-Za-z0-9_]*)\b/g);
      collectMatches('enum', /\benum\s+([A-Za-z_][A-Za-z0-9_]*)\b/g);
      collectMatches('function', /\b[A-Za-z_][A-Za-z0-9_<>\[\]]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g);
    } else if (language === 'kotlin') {
      collectMatches('class', /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/g);
      collectMatches('interface', /\binterface\s+([A-Za-z_][A-Za-z0-9_]*)\b/g);
      collectMatches('function', /\bfun\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g);
    } else {
      collectMatches('function', /\b(?:export\s+default\s+|export\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g);
      collectMatches('class', /\b(?:export\s+default\s+|export\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)\b/g);
      collectMatches('type', /\b(?:export\s+)?type\s+([A-Za-z_][A-Za-z0-9_]*)\b/g);
    }

    return results;
  }

  private detectSymbolLanguage(relPath: string): 'ts' | 'js' | 'rust' | 'python' | 'go' | 'java' | 'kotlin' | 'other' {
    const ext = path.extname(relPath).toLowerCase();
    if (ext === '.ts' || ext === '.tsx') return 'ts';
    if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'js';
    if (ext === '.rs') return 'rust';
    if (ext === '.py') return 'python';
    if (ext === '.go') return 'go';
    if (ext === '.java') return 'java';
    if (ext === '.kt') return 'kotlin';
    return 'other';
  }

  private resolveImportTarget(
    importerRelPath: string,
    specifier: string,
    filePathSet: Set<string>,
  ): string | null {
    let candidates: string[] = [];
    const importerLanguage = this.detectSymbolLanguage(importerRelPath);

    if (specifier.startsWith('.')) {
      const importerDir = path.posix.dirname(importerRelPath);
      const raw = path.posix.normalize(path.posix.join(importerDir, specifier));
      candidates = this.expandImportCandidates(raw);
    } else if (specifier.startsWith('mod:')) {
      const importerDir = path.posix.dirname(importerRelPath);
      const moduleName = specifier.slice(4);
      const raw = path.posix.normalize(path.posix.join(importerDir, moduleName));
      candidates = this.expandImportCandidates(raw);
    } else if (
      specifier.startsWith('crate::')
      || specifier.startsWith('self::')
      || specifier.startsWith('super::')
    ) {
      candidates = this.resolveRustImportCandidates(importerRelPath, specifier);
    } else if (
      (importerLanguage === 'java' || importerLanguage === 'kotlin')
      && specifier.includes('/')
    ) {
      candidates = this.expandImportCandidates(specifier);
    } else {
      return null;
    }

    for (const candidate of candidates) {
      if (filePathSet.has(candidate)) return candidate;
    }
    return null;
  }

  private expandImportCandidates(raw: string): string[] {
    return [
      raw,
      `${raw}.py`,
      `${raw}.go`,
      `${raw}.java`,
      `${raw}.kt`,
      `${raw}.ts`,
      `${raw}.tsx`,
      `${raw}.mts`,
      `${raw}.cts`,
      `${raw}.d.ts`,
      `${raw}.js`,
      `${raw}.jsx`,
      `${raw}.mjs`,
      `${raw}.cjs`,
      `${raw}.rs`,
      `${raw}/index.ts`,
      `${raw}/index.tsx`,
      `${raw}/index.mts`,
      `${raw}/index.cts`,
      `${raw}/index.js`,
      `${raw}/index.jsx`,
      `${raw}/index.mjs`,
      `${raw}/index.cjs`,
      `${raw}/__init__.py`,
      `${raw}/main.go`,
      `${raw}/mod.rs`,
      `${raw}/lib.rs`,
    ];
  }

  private resolveRustImportCandidates(importerRelPath: string, specifier: string): string[] {
    const importerDir = path.posix.dirname(importerRelPath);
    const segments = specifier.split('::').filter(Boolean);
    if (segments.length < 2) return [];

    let baseDir = importerDir;
    let pathSegments = segments.slice(1);
    const crateRoot = importerRelPath.startsWith('src/')
      ? 'src'
      : importerRelPath.includes('/')
        ? importerRelPath.slice(0, importerRelPath.indexOf('/'))
        : '';

    if (segments[0] === 'crate') {
      baseDir = crateRoot || importerDir;
    } else if (segments[0] === 'self') {
      baseDir = importerDir;
    } else if (segments[0] === 'super') {
      let upCount = 1;
      while (pathSegments[0] === 'super') {
        upCount += 1;
        pathSegments = pathSegments.slice(1);
      }
      baseDir = importerDir;
      for (let i = 0; i < upCount; i++) {
        baseDir = path.posix.dirname(baseDir);
      }
    }

    const candidates: string[] = [];
    for (let end = pathSegments.length; end >= 1; end--) {
      const partial = pathSegments.slice(0, end);
      const raw = path.posix.normalize(path.posix.join(baseDir, ...partial));
      candidates.push(...this.expandImportCandidates(raw));
    }
    return [...new Set(candidates)];
  }

  private toPosix(filePath: string): string {
    return filePath.split(path.sep).join('/');
  }

  private rankMatchingNodes(snapshot: CodeIntelSnapshot, query: string): CodeIntelNodeMatch[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    return [...snapshot.graph.nodes]
      .map((node): CodeIntelNodeMatch => {
        const label = String(node.label || '').toLowerCase();
        const typeText = String(node.type || '').toLowerCase();
        const propsText = JSON.stringify(node.properties || {}).toLowerCase();
        const haystack = [label, typeText, propsText].join(' ');
        let score = 0;
        const reasons: string[] = [];

        if (label === q) {
          score += 20;
          reasons.push('exact label match');
        } else if (label.includes(q)) {
          score += 12;
          reasons.push('label contains query');
        } else if (propsText.includes(q)) {
          score += 6;
          reasons.push('properties contain query');
        }

        for (const token of tokens) {
          if (label.includes(token)) {
            score += 4;
            reasons.push(`label contains token "${token}"`);
          } else if (typeText.includes(token)) {
            score += 2;
            reasons.push(`type matches token "${token}"`);
          } else if (haystack.includes(token)) {
            score += 1;
            reasons.push(`metadata contains token "${token}"`);
          }
        }

        return this.createScoredNodeMatch(node, score, reasons);
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.node.label.localeCompare(b.node.label))
      .slice(0, 100);
  }

  private findMatchingNodes(snapshot: CodeIntelSnapshot, query: string): CodeIntelNode[] {
    return this.rankMatchingNodes(snapshot, query).map(item => item.node);
  }

  private findBestNode(snapshot: CodeIntelSnapshot, query: string): CodeIntelNode | null {
    const matches = this.findMatchingNodes(snapshot, query);
    return matches.length > 0 ? matches[0] : null;
  }
}
