import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { EmbeddedCodeIntelligenceStore } from './embedded-store';
import type {
  CodeIntelCluster,
  CodeIntelEdgeType,
  CodeIntelImpactResult,
  CodeIntelProcess,
  CodeIntelQueryResult,
  CodeIntelStatus,
  CodeIntelContextResult,
} from './types';

export interface CodeIntelRegressionQueryCheck {
  query: string;
  topNodeId?: string;
  reasonIncludes?: string[];
  communityIds?: string[];
  processIds?: string[];
}

export interface CodeIntelRegressionContextCheck {
  symbol: string;
  symbolId?: string;
  neighborIds?: string[];
  edgeLabels?: CodeIntelEdgeType[];
  communityIds?: string[];
  processIds?: string[];
}

export interface CodeIntelRegressionImpactCheck {
  target: string;
  direction?: 'upstream' | 'downstream' | 'both';
  limit?: number;
  seedId?: string;
  mustIncludeNodeIds?: string[];
  riskLevelOneOf?: Array<'low' | 'medium' | 'high'>;
  communityIds?: string[];
  processIds?: string[];
}

export interface CodeIntelRegressionExpectation {
  stats?: {
    fileCount?: number;
    communityCount?: number;
    processCount?: number;
  };
  requiredNodeIds?: string[];
  requiredImports?: Array<[string, string]>;
  requiredEdges?: Array<{
    from: string;
    to: string;
    label: CodeIntelEdgeType;
  }>;
  nodePropertyChecks?: Array<{
    nodeId: string;
    propertiesInclude: Record<string, unknown>;
  }>;
  clusterIds?: string[];
  processIds?: string[];
  queryChecks?: CodeIntelRegressionQueryCheck[];
  contextChecks?: CodeIntelRegressionContextCheck[];
  impactChecks?: CodeIntelRegressionImpactCheck[];
}

export interface CodeIntelRegressionDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  scope: 'stats' | 'graph' | 'clusters' | 'processes' | 'query' | 'context' | 'impact';
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface CodeIntelRegressionSummary {
  checksTotal: number;
  passed: number;
  failed: number;
}

export interface CodeIntelRegressionResult {
  ok: boolean;
  fixturePath: string;
  expectedPath: string;
  comparedAt: number;
  summary: CodeIntelRegressionSummary;
  diagnostics: CodeIntelRegressionDiagnostic[];
  status: CodeIntelStatus;
}

interface LoadedRegressionExpectation {
  raw: CodeIntelRegressionExpectation;
  path: string;
}

function normalizeIdList(values: string[] | undefined): string[] {
  return [...new Set((values || []).map(value => String(value).trim()).filter(Boolean))].sort();
}

function sameIdSet(actual: string[] | undefined, expected: string[] | undefined): boolean {
  const actualList = normalizeIdList(actual);
  const expectedList = normalizeIdList(expected);
  return JSON.stringify(actualList) === JSON.stringify(expectedList);
}

function readRegressionExpectation(expectedPath: string): LoadedRegressionExpectation {
  const raw = JSON.parse(fs.readFileSync(expectedPath, 'utf-8')) as CodeIntelRegressionExpectation;
  return { raw, path: expectedPath };
}

function defaultExpectedPath(fixturePath: string): string {
  return path.join(fixturePath, 'expected.json');
}

function createTempValidationStore(): { tempRoot: string; store: EmbeddedCodeIntelligenceStore } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-code-regression-'));
  const basePath = path.join(tempRoot, '.devplan');
  fs.mkdirSync(basePath, { recursive: true });
  return {
    tempRoot,
    store: new EmbeddedCodeIntelligenceStore('native_validation', basePath),
  };
}

function createSummary(diagnostics: CodeIntelRegressionDiagnostic[], checksTotal: number): CodeIntelRegressionSummary {
  const failed = diagnostics.filter(item => item.severity === 'error').length;
  return {
    checksTotal,
    failed,
    passed: Math.max(0, checksTotal - failed),
  };
}

function compareStats(
  diagnostics: CodeIntelRegressionDiagnostic[],
  status: CodeIntelStatus,
  expected: CodeIntelRegressionExpectation,
): number {
  let checks = 0;
  if (typeof expected.stats?.fileCount === 'number') {
    checks += 1;
    if (status.stats.fileCount !== expected.stats.fileCount) {
      diagnostics.push({
        code: 'stats.fileCount.mismatch',
        severity: 'error',
        scope: 'stats',
        message: 'File count does not match expectation.',
        expected: expected.stats.fileCount,
        actual: status.stats.fileCount,
      });
    }
  }
  if (typeof expected.stats?.communityCount === 'number') {
    checks += 1;
    if (status.stats.communityCount !== expected.stats.communityCount) {
      diagnostics.push({
        code: 'stats.communityCount.mismatch',
        severity: 'error',
        scope: 'stats',
        message: 'Community count does not match expectation.',
        expected: expected.stats.communityCount,
        actual: status.stats.communityCount,
      });
    }
  }
  if (typeof expected.stats?.processCount === 'number') {
    checks += 1;
    if (status.stats.processCount !== expected.stats.processCount) {
      diagnostics.push({
        code: 'stats.processCount.mismatch',
        severity: 'error',
        scope: 'stats',
        message: 'Process count does not match expectation.',
        expected: expected.stats.processCount,
        actual: status.stats.processCount,
      });
    }
  }
  return checks;
}

function compareGraph(
  diagnostics: CodeIntelRegressionDiagnostic[],
  nodesById: Map<string, { properties?: Record<string, unknown> }>,
  nodeIds: Set<string>,
  edges: Array<{ from: string; to: string; label: CodeIntelEdgeType }>,
  importEdges: Set<string>,
  expected: CodeIntelRegressionExpectation,
): number {
  let checks = 0;
  for (const nodeId of expected.requiredNodeIds || []) {
    checks += 1;
    if (!nodeIds.has(nodeId)) {
      diagnostics.push({
        code: 'graph.node.missing',
        severity: 'error',
        scope: 'graph',
        message: `Required node is missing: ${nodeId}`,
        expected: nodeId,
      });
    }
  }
  for (const [from, to] of expected.requiredImports || []) {
    checks += 1;
    const edgeId = `${from}->${to}`;
    if (!importEdges.has(edgeId)) {
      diagnostics.push({
        code: 'graph.import.missing',
        severity: 'error',
        scope: 'graph',
        message: `Required import edge is missing: ${edgeId}`,
        expected: edgeId,
      });
    }
  }
  for (const edge of expected.requiredEdges || []) {
    checks += 1;
    const found = edges.some(item => item.from === edge.from && item.to === edge.to && item.label === edge.label);
    if (!found) {
      diagnostics.push({
        code: 'graph.edge.missing',
        severity: 'error',
        scope: 'graph',
        message: `Required edge is missing: ${edge.label} ${edge.from} -> ${edge.to}`,
        expected: edge,
      });
    }
  }
  for (const check of expected.nodePropertyChecks || []) {
    checks += 1;
    const node = nodesById.get(check.nodeId);
    if (!node) {
      diagnostics.push({
        code: 'graph.nodeProperties.nodeMissing',
        severity: 'error',
        scope: 'graph',
        message: `Node for property check is missing: ${check.nodeId}`,
        expected: check.nodeId,
      });
      continue;
    }
    const actualProps = node.properties || {};
    const mismatched: Record<string, { expected: unknown; actual: unknown }> = {};
    for (const [key, expectedValue] of Object.entries(check.propertiesInclude)) {
      const actualValue = actualProps[key];
      if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
        mismatched[key] = { expected: expectedValue, actual: actualValue };
      }
    }
    if (Object.keys(mismatched).length > 0) {
      diagnostics.push({
        code: 'graph.nodeProperties.mismatch',
        severity: 'error',
        scope: 'graph',
        message: `Node properties do not match expectation: ${check.nodeId}`,
        expected: check.propertiesInclude,
        actual: mismatched,
      });
    }
  }
  return checks;
}

function compareIdGroups(
  diagnostics: CodeIntelRegressionDiagnostic[],
  scope: 'clusters' | 'processes',
  codePrefix: string,
  actual: string[],
  expected: string[] | undefined,
): number {
  if (!expected || expected.length === 0) return 0;
  if (sameIdSet(actual, expected)) return 1;
  diagnostics.push({
    code: `${codePrefix}.mismatch`,
    severity: 'error',
    scope,
    message: `${scope} set does not match expectation.`,
    expected: normalizeIdList(expected),
    actual: normalizeIdList(actual),
  });
  return 1;
}

function compareQueryResult(
  diagnostics: CodeIntelRegressionDiagnostic[],
  result: CodeIntelQueryResult,
  check: CodeIntelRegressionQueryCheck,
): number {
  let checks = 0;
  if (check.topNodeId) {
    checks += 1;
    const actual = result.matchedNodes[0]?.id || null;
    if (actual !== check.topNodeId) {
      diagnostics.push({
        code: 'query.topNode.mismatch',
        severity: 'error',
        scope: 'query',
        message: `Top query result mismatch for "${check.query}".`,
        expected: check.topNodeId,
        actual,
      });
    }
  }
  for (const reason of check.reasonIncludes || []) {
    checks += 1;
    const reasons = result.matchedNodeDetails[0]?.reasons || [];
    if (!reasons.includes(reason)) {
      diagnostics.push({
        code: 'query.reason.missing',
        severity: 'error',
        scope: 'query',
        message: `Expected reason "${reason}" missing for query "${check.query}".`,
        expected: reason,
        actual: reasons,
      });
    }
  }
  if (check.communityIds?.length) {
    checks += 1;
    const actualIds = result.communities.map(item => item.id);
    if (!sameIdSet(actualIds, check.communityIds)) {
      diagnostics.push({
        code: 'query.communities.mismatch',
        severity: 'error',
        scope: 'query',
        message: `Community results mismatch for query "${check.query}".`,
        expected: normalizeIdList(check.communityIds),
        actual: normalizeIdList(actualIds),
      });
    }
  }
  if (check.processIds?.length) {
    checks += 1;
    const actualIds = result.processes.map(item => item.id);
    if (!sameIdSet(actualIds, check.processIds)) {
      diagnostics.push({
        code: 'query.processes.mismatch',
        severity: 'error',
        scope: 'query',
        message: `Process results mismatch for query "${check.query}".`,
        expected: normalizeIdList(check.processIds),
        actual: normalizeIdList(actualIds),
      });
    }
  }
  return checks;
}

function compareContextResult(
  diagnostics: CodeIntelRegressionDiagnostic[],
  result: CodeIntelContextResult,
  check: CodeIntelRegressionContextCheck,
): number {
  let checks = 0;
  if (check.symbolId) {
    checks += 1;
    const actual = result.symbol?.id || null;
    if (actual !== check.symbolId) {
      diagnostics.push({
        code: 'context.symbol.mismatch',
        severity: 'error',
        scope: 'context',
        message: `Context symbol mismatch for "${check.symbol}".`,
        expected: check.symbolId,
        actual,
      });
    }
  }
  if (check.neighborIds?.length) {
    checks += 1;
    const actualIds = result.neighbors.map(item => item.id);
    if (!sameIdSet(actualIds, check.neighborIds)) {
      diagnostics.push({
        code: 'context.neighbors.mismatch',
        severity: 'error',
        scope: 'context',
        message: `Context neighbor set mismatch for "${check.symbol}".`,
        expected: normalizeIdList(check.neighborIds),
        actual: normalizeIdList(actualIds),
      });
    }
  }
  if (check.edgeLabels?.length) {
    for (const label of check.edgeLabels) {
      checks += 1;
      const actualLabels = result.edges.map(item => item.label);
      if (!actualLabels.includes(label)) {
        diagnostics.push({
          code: 'context.edgeLabel.missing',
          severity: 'error',
          scope: 'context',
          message: `Expected edge label "${label}" missing for context "${check.symbol}".`,
          expected: label,
          actual: actualLabels,
        });
      }
    }
  }
  if (check.communityIds?.length) {
    checks += 1;
    const actualIds = result.communities.map(item => item.id);
    if (!sameIdSet(actualIds, check.communityIds)) {
      diagnostics.push({
        code: 'context.communities.mismatch',
        severity: 'error',
        scope: 'context',
        message: `Context community set mismatch for "${check.symbol}".`,
        expected: normalizeIdList(check.communityIds),
        actual: normalizeIdList(actualIds),
      });
    }
  }
  if (check.processIds?.length) {
    checks += 1;
    const actualIds = result.processes.map(item => item.id);
    if (!sameIdSet(actualIds, check.processIds)) {
      diagnostics.push({
        code: 'context.processes.mismatch',
        severity: 'error',
        scope: 'context',
        message: `Context process set mismatch for "${check.symbol}".`,
        expected: normalizeIdList(check.processIds),
        actual: normalizeIdList(actualIds),
      });
    }
  }
  return checks;
}

function compareImpactResult(
  diagnostics: CodeIntelRegressionDiagnostic[],
  result: CodeIntelImpactResult,
  check: CodeIntelRegressionImpactCheck,
): number {
  let checks = 0;
  if (check.seedId) {
    checks += 1;
    const actual = result.seed?.id || null;
    if (actual !== check.seedId) {
      diagnostics.push({
        code: 'impact.seed.mismatch',
        severity: 'error',
        scope: 'impact',
        message: `Impact seed mismatch for "${check.target}".`,
        expected: check.seedId,
        actual,
      });
    }
  }
  for (const nodeId of check.mustIncludeNodeIds || []) {
    checks += 1;
    const affectedIds = new Set(result.affectedNodes.map(item => item.id));
    if (!affectedIds.has(nodeId)) {
      diagnostics.push({
        code: 'impact.node.missing',
        severity: 'error',
        scope: 'impact',
        message: `Expected impacted node "${nodeId}" missing for "${check.target}".`,
        expected: nodeId,
      });
    }
  }
  if (check.riskLevelOneOf?.length) {
    checks += 1;
    if (!check.riskLevelOneOf.includes(result.riskLevel)) {
      diagnostics.push({
        code: 'impact.riskLevel.mismatch',
        severity: 'error',
        scope: 'impact',
        message: `Impact risk level mismatch for "${check.target}".`,
        expected: check.riskLevelOneOf,
        actual: result.riskLevel,
      });
    }
  }
  if (check.communityIds?.length) {
    checks += 1;
    const actualIds = result.affectedCommunities.map(item => item.id);
    if (!sameIdSet(actualIds, check.communityIds)) {
      diagnostics.push({
        code: 'impact.communities.mismatch',
        severity: 'error',
        scope: 'impact',
        message: `Impact community set mismatch for "${check.target}".`,
        expected: normalizeIdList(check.communityIds),
        actual: normalizeIdList(actualIds),
      });
    }
  }
  if (check.processIds?.length) {
    checks += 1;
    const actualIds = result.affectedProcesses.map(item => item.id);
    if (!sameIdSet(actualIds, check.processIds)) {
      diagnostics.push({
        code: 'impact.processes.mismatch',
        severity: 'error',
        scope: 'impact',
        message: `Impact process set mismatch for "${check.target}".`,
        expected: normalizeIdList(check.processIds),
        actual: normalizeIdList(actualIds),
      });
    }
  }
  return checks;
}

export async function runCodeIntelRegressionCheck(options: {
  fixturePath: string;
  expectedPath?: string;
}): Promise<CodeIntelRegressionResult> {
  const fixturePath = path.resolve(options.fixturePath);
  const expectedPath = path.resolve(options.expectedPath || defaultExpectedPath(fixturePath));
  const { raw: expected } = readRegressionExpectation(expectedPath);
  const diagnostics: CodeIntelRegressionDiagnostic[] = [];
  let checksTotal = 0;

  const { tempRoot, store } = createTempValidationStore();
  try {
    const status = await store.getStatus(fixturePath);
    const graph = await store.getGraph(fixturePath);
    const clusters = await store.getClusters(fixturePath);
    const processes = await store.getProcesses(fixturePath);

    const nodesById = new Map(graph.nodes.map(node => [node.id, node] as const));
    const nodeIds = new Set(graph.nodes.map(node => node.id));
    const importEdges = new Set(
      graph.edges
        .filter(edge => edge.label === 'IMPORTS')
        .map(edge => `${edge.from}->${edge.to}`),
    );

    checksTotal += compareStats(diagnostics, status, expected);
    checksTotal += compareGraph(diagnostics, nodesById, nodeIds, graph.edges, importEdges, expected);
    checksTotal += compareIdGroups(
      diagnostics,
      'clusters',
      'clusters',
      clusters.map((item: CodeIntelCluster) => item.id),
      expected.clusterIds,
    );
    checksTotal += compareIdGroups(
      diagnostics,
      'processes',
      'processes',
      processes.map((item: CodeIntelProcess) => item.id),
      expected.processIds,
    );

    for (const check of expected.queryChecks || []) {
      const result = await store.query(check.query, fixturePath, 10);
      checksTotal += compareQueryResult(diagnostics, result, check);
    }
    for (const check of expected.contextChecks || []) {
      const result = await store.getContext(check.symbol, fixturePath);
      checksTotal += compareContextResult(diagnostics, result, check);
    }
    for (const check of expected.impactChecks || []) {
      const result = await store.getImpact(
        check.target,
        check.direction || 'both',
        fixturePath,
        check.limit || 20,
      );
      checksTotal += compareImpactResult(diagnostics, result, check);
    }

    const summary = createSummary(diagnostics, checksTotal);
    return {
      ok: summary.failed === 0,
      fixturePath,
      expectedPath,
      comparedAt: Date.now(),
      summary,
      diagnostics,
      status: {
        ...status,
        source: 'native_validation',
      },
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
