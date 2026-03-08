export type CodeIntelNodeType =
  | 'project'
  | 'folder'
  | 'file'
  | 'symbol'
  | 'community'
  | 'process';

export type CodeIntelEdgeType =
  | 'CONTAINS'
  | 'DEFINES'
  | 'IMPORTS'
  | 'MEMBER_OF'
  | 'CALLS'
  | 'IMPLEMENTS'
  | 'EXTENDS'
  | 'STEP_IN_PROCESS';

export interface CodeIntelNode {
  id: string;
  label: string;
  type: CodeIntelNodeType;
  properties?: Record<string, unknown>;
}

export interface CodeIntelEdge {
  from: string;
  to: string;
  label: CodeIntelEdgeType;
  confidence?: number;
  properties?: Record<string, unknown>;
}

export interface CodeIntelCluster {
  id: string;
  label: string;
  fileCount: number;
  symbolCount: number;
  members: string[];
}

export interface CodeIntelProcess {
  id: string;
  label: string;
  processType: 'heuristic' | 'execution_flow';
  stepCount: number;
  steps: string[];
  entryFile?: string;
  strategy?: string;
  stepDetails?: CodeIntelProcessStep[];
}

export interface CodeIntelProcessStep {
  filePath: string;
  step: number;
  role: 'entry' | 'transition' | 'fallback' | 'upstream' | 'downstream';
  score: number;
  reasons: string[];
}

export interface CodeIntelStatus {
  projectName: string;
  repoPath: string;
  source: 'native_embedded' | 'native_validation';
  mode: 'embedded_source';
  available: boolean;
  indexStatus: 'ready' | 'empty' | 'unavailable';
  indexPath?: string;
  indexPersisted?: boolean;
  lastIndexedAt?: number;
  indexVersion?: number;
  sourceFingerprint?: {
    fileCount: number;
    totalBytes: number;
    maxMtimeMs: number;
  };
  stats: {
    fileCount: number;
    symbolCount: number;
    communityCount: number;
    processCount: number;
  };
  warnings: string[];
}

export interface CodeIntelGraph {
  nodes: CodeIntelNode[];
  edges: CodeIntelEdge[];
}

export interface CodeIntelSnapshot {
  status: CodeIntelStatus;
  graph: CodeIntelGraph;
  clusters: CodeIntelCluster[];
  processes: CodeIntelProcess[];
}

export interface CodeIntelIrFile {
  id: string;
  filePath: string;
  language: string;
  size: number;
  mtimeMs: number;
}

export interface CodeIntelIrEntity {
  id: string;
  label: string;
  kind: string;
  fileId: string;
  language: string;
  rawName?: string;
  ownerId?: string;
  exported?: boolean;
  visibility?: string;
  startLine?: number;
  endLine?: number;
  properties?: Record<string, unknown>;
}

export interface CodeIntelIrRelation {
  id: string;
  type: CodeIntelEdgeType;
  fromId: string;
  toId: string;
  confidence?: number;
  properties?: Record<string, unknown>;
}

export interface CodeIntelIrSnapshot {
  projectName: string;
  repoPath: string;
  files: CodeIntelIrFile[];
  entities: CodeIntelIrEntity[];
  relations: CodeIntelIrRelation[];
}

export interface CodeIntelNodeMatch {
  node: CodeIntelNode;
  score: number;
  baselineScore?: number;
  fusionScore?: number;
  finalScore?: number;
  reasons: string[];
}

export interface CodeIntelClusterMatch {
  community: CodeIntelCluster;
  score: number;
  baselineScore?: number;
  fusionScore?: number;
  finalScore?: number;
  reasons: string[];
}

export interface CodeIntelProcessMatch {
  process: CodeIntelProcess;
  score: number;
  baselineScore?: number;
  fusionScore?: number;
  finalScore?: number;
  reasons: string[];
}

export interface CodeIntelImpactNodeDetail {
  node: CodeIntelNode;
  distance: number;
  score: number;
  baselineScore?: number;
  fusionScore?: number;
  finalScore?: number;
  reasons: string[];
}

export type CodeIntelFusionMode = 'graph_only' | 'graph_recall';

export interface CodeIntelRetrievalEvidence {
  sourceKind: 'memory' | 'doc';
  sourceId?: string;
  label: string;
  score: number;
  reasons: string[];
  mappedNodeIds?: string[];
  mappedFilePaths?: string[];
  mappedCommunityIds?: string[];
  mappedProcessIds?: string[];
}

export interface CodeIntelQueryResult {
  query: string;
  matchedNodes: CodeIntelNode[];
  matchedNodeDetails: CodeIntelNodeMatch[];
  communities: CodeIntelCluster[];
  communityDetails: CodeIntelClusterMatch[];
  processes: CodeIntelProcess[];
  processDetails: CodeIntelProcessMatch[];
  fusionMode?: CodeIntelFusionMode;
  fusionApplied?: boolean;
  fusionSummary?: string;
  retrievalEvidence?: CodeIntelRetrievalEvidence[];
  summary: string;
}

export interface CodeIntelContextResult {
  symbol: CodeIntelNode | null;
  symbolMatch: CodeIntelNodeMatch | null;
  neighbors: CodeIntelNode[];
  neighborDetails: CodeIntelNodeMatch[];
  edges: CodeIntelEdge[];
  communities: CodeIntelCluster[];
  communityDetails: CodeIntelClusterMatch[];
  processes: CodeIntelProcess[];
  processDetails: CodeIntelProcessMatch[];
  fusionMode?: CodeIntelFusionMode;
  fusionApplied?: boolean;
  fusionSummary?: string;
  retrievalEvidence?: CodeIntelRetrievalEvidence[];
  summary: string;
}

export interface CodeIntelImpactResult {
  target: string;
  direction: 'upstream' | 'downstream' | 'both';
  seed: CodeIntelNode | null;
  affectedNodes: CodeIntelNode[];
  affectedNodeDetails: CodeIntelImpactNodeDetail[];
  affectedEdges: CodeIntelEdge[];
  affectedCommunities: CodeIntelCluster[];
  affectedCommunityDetails: CodeIntelClusterMatch[];
  affectedProcesses: CodeIntelProcess[];
  affectedProcessDetails: CodeIntelProcessMatch[];
  riskLevel: 'low' | 'medium' | 'high';
  fusionMode?: CodeIntelFusionMode;
  fusionApplied?: boolean;
  fusionSummary?: string;
  retrievalEvidence?: CodeIntelRetrievalEvidence[];
  summary: string;
}

export type CodeIntelChangeType = 'added' | 'removed' | 'modified';

export interface CodeIntelChangeDetail<T> {
  id: string;
  changeType: CodeIntelChangeType;
  before?: T;
  after?: T;
  reasons: string[];
}

export interface CodeIntelChangeStats {
  added: number;
  removed: number;
  modified: number;
}

export interface CodeIntelDetectChangesResult {
  repoPath: string;
  baseline: 'persisted_index' | 'none';
  hasBaseline: boolean;
  limit: number;
  baselineIndexedAt?: number;
  sourceFingerprintChanged: boolean;
  nodeChanges: Array<CodeIntelChangeDetail<CodeIntelNode>>;
  edgeChanges: Array<CodeIntelChangeDetail<CodeIntelEdge>>;
  communityChanges: Array<CodeIntelChangeDetail<CodeIntelCluster>>;
  processChanges: Array<CodeIntelChangeDetail<CodeIntelProcess>>;
  stats: {
    nodes: CodeIntelChangeStats;
    edges: CodeIntelChangeStats;
    communities: CodeIntelChangeStats;
    processes: CodeIntelChangeStats;
  };
  summary: string;
}

export interface CodeIntelRenameEdit {
  filePath: string;
  start: number;
  end: number;
  line: number;
  oldText: string;
  newText: string;
}

export interface CodeIntelRenameTarget {
  id: string;
  label: string;
  filePath?: string;
  language?: string;
  rawName?: string;
  kind?: string;
}

export interface CodeIntelRenameResult {
  query: string;
  newName: string;
  applied: boolean;
  supported: boolean;
  target: CodeIntelRenameTarget | null;
  edits: CodeIntelRenameEdit[];
  skippedReasons: string[];
  postDetectChanges?: CodeIntelDetectChangesResult;
  summary: string;
}

export interface CodeIntelGraphQueryOptions {
  query?: string;
  nodeTypes?: CodeIntelNodeType[];
  edgeLabels?: CodeIntelEdgeType[];
  filePathPrefix?: string;
  communityId?: string;
  processId?: string;
  limit?: number;
}

export interface CodeIntelGraphQueryResult {
  repoPath: string;
  options: CodeIntelGraphQueryOptions;
  nodes: CodeIntelNode[];
  edges: CodeIntelEdge[];
  summary: string;
}

export interface CodeIntelRefactorGuardrails {
  renameSupportedLanguages: string[];
  requiresPreviewBeforeApply: boolean;
  arbitraryCypherAllowed: boolean;
  arbitraryGraphMutationAllowed: boolean;
  detectChangesRecommended: boolean;
  summary: string;
}
