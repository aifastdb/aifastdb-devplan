import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, jest, test } from '@jest/globals';

import {
  EmbeddedCodeIntelligenceStore,
  runCodeIntelRegressionCheck,
  type CodeIntelRegressionExpectation,
} from '../src/code-intelligence';

function fixtureRoot(name = 'native-sample'): string {
  return path.join(__dirname, 'fixtures', 'code-intelligence', name);
}

function loadExpected(name = 'native-sample'): CodeIntelRegressionExpectation {
  return JSON.parse(
    fs.readFileSync(path.join(fixtureRoot(name), 'expected.json'), 'utf-8')
  ) as CodeIntelRegressionExpectation;
}

function setupFixtureRepo(name = 'native-sample'): { tempRoot: string; expectedPath: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-code-intel-'));
  fs.cpSync(fixtureRoot(name), tempRoot, { recursive: true });
  return { tempRoot, expectedPath: path.join(tempRoot, 'expected.json') };
}

describe('Code Intelligence native golden fixtures regression', () => {
  jest.setTimeout(10_000);
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('native fixture repo should pass the shared regression comparator', async () => {
    const expected = loadExpected();
    const { tempRoot, expectedPath } = setupFixtureRepo();
    tempDirs.push(tempRoot);

    const result = await runCodeIntelRegressionCheck({
      fixturePath: tempRoot,
      expectedPath,
    });

    expect(result.ok).toBe(true);
    expect(result.status.source).toBe('native_validation');
    expect(result.status.stats.fileCount).toBe(expected.stats?.fileCount);
    expect(result.status.stats.communityCount).toBe(expected.stats?.communityCount);
    expect(result.status.stats.processCount).toBe(expected.stats?.processCount);
    expect(result.metrics.requiredNodeRecall.total).toBe(expected.requiredNodeIds?.length || 0);
    expect(result.metrics.requiredNodeRecall.rate).toBe(1);
    expect(result.metrics.queryTop1HitRate.rate).toBe(1);
    expect(result.metrics.contextNeighborExactRate.rate).toBe(1);
    expect(result.performance.indexMs).toBeGreaterThanOrEqual(0);
    expect(result.performance.graphBytes).toBeGreaterThan(0);
    expect(result.stability.rebuildStable).toBe(true);
    expect(result.stability.nodeDelta).toBe(0);
    expect(result.stability.edgeDelta).toBe(0);
    expect(result.summary.failed).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  test('native advanced fixture repo should pass the shared regression comparator', async () => {
    const expected = loadExpected('native-advanced');
    const { tempRoot, expectedPath } = setupFixtureRepo('native-advanced');
    tempDirs.push(tempRoot);

    const result = await runCodeIntelRegressionCheck({
      fixturePath: tempRoot,
      expectedPath,
    });

    expect(result.ok).toBe(true);
    expect(result.status.source).toBe('native_validation');
    expect(result.status.stats.fileCount).toBe(expected.stats?.fileCount);
    expect(result.status.stats.communityCount).toBe(expected.stats?.communityCount);
    expect(result.status.stats.processCount).toBe(expected.stats?.processCount);
    expect(result.summary.failed).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  test('native multilang fixture repo should pass the shared regression comparator', async () => {
    const expected = loadExpected('native-multilang');
    const { tempRoot, expectedPath } = setupFixtureRepo('native-multilang');
    tempDirs.push(tempRoot);

    const result = await runCodeIntelRegressionCheck({
      fixturePath: tempRoot,
      expectedPath,
    });

    expect(result.ok).toBe(true);
    expect(result.status.source).toBe('native_validation');
    expect(result.status.stats.fileCount).toBe(expected.stats?.fileCount);
    expect(result.status.stats.communityCount).toBe(expected.stats?.communityCount);
    expect(result.status.stats.processCount).toBe(expected.stats?.processCount);
    expect(result.summary.failed).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  test('native jvm fixture repo should pass the shared regression comparator', async () => {
    const expected = loadExpected('native-jvm');
    const { tempRoot, expectedPath } = setupFixtureRepo('native-jvm');
    tempDirs.push(tempRoot);

    const result = await runCodeIntelRegressionCheck({
      fixturePath: tempRoot,
      expectedPath,
    });

    expect(result.ok).toBe(true);
    expect(result.status.source).toBe('native_validation');
    expect(result.status.stats.fileCount).toBe(expected.stats?.fileCount);
    expect(result.status.stats.communityCount).toBe(expected.stats?.communityCount);
    expect(result.status.stats.processCount).toBe(expected.stats?.processCount);
    expect(result.summary.failed).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  test('real devplan ts slice should pass the shared regression comparator', async () => {
    const expected = loadExpected('real-devplan-ts-slice');
    const { tempRoot, expectedPath } = setupFixtureRepo('real-devplan-ts-slice');
    tempDirs.push(tempRoot);

    const result = await runCodeIntelRegressionCheck({
      fixturePath: tempRoot,
      expectedPath,
    });

    expect(result.ok).toBe(true);
    expect(result.status.source).toBe('native_validation');
    expect(result.status.stats.fileCount).toBe(expected.stats?.fileCount);
    expect(result.status.stats.communityCount).toBe(expected.stats?.communityCount);
    expect(result.status.stats.processCount).toBe(expected.stats?.processCount);
    expect(result.summary.failed).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  test('real zeroclaw rust slice should pass the shared regression comparator', async () => {
    const expected = loadExpected('real-zeroclaw-rust-slice');
    const { tempRoot, expectedPath } = setupFixtureRepo('real-zeroclaw-rust-slice');
    tempDirs.push(tempRoot);

    const result = await runCodeIntelRegressionCheck({
      fixturePath: tempRoot,
      expectedPath,
    });

    expect(result.ok).toBe(true);
    expect(result.status.source).toBe('native_validation');
    expect(result.status.stats.fileCount).toBe(expected.stats?.fileCount);
    expect(result.status.stats.communityCount).toBe(expected.stats?.communityCount);
    expect(result.status.stats.processCount).toBe(expected.stats?.processCount);
    expect(result.summary.failed).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  test('real repo slices should expose execution-flow metadata on inferred processes', async () => {
    const devplanRepo = setupFixtureRepo('real-devplan-ts-slice');
    const zeroclawRepo = setupFixtureRepo('real-zeroclaw-rust-slice');
    tempDirs.push(devplanRepo.tempRoot, zeroclawRepo.tempRoot);

    const devplanStore = new EmbeddedCodeIntelligenceStore(
      'native_validation',
      path.join(devplanRepo.tempRoot, '.devplan'),
    );
    fs.mkdirSync(path.join(devplanRepo.tempRoot, '.devplan'), { recursive: true });
    const devplanProcesses = await devplanStore.getProcesses(devplanRepo.tempRoot);
    const codeIntelProcess = devplanProcesses.find(item => item.id === 'process:src/code-intelligence');
    expect(codeIntelProcess?.processType).toBe('execution_flow');
    expect(codeIntelProcess?.entryFile).toBe('src/mcp-server/handlers/code-tools.ts');
    expect(codeIntelProcess?.steps[0]).toBe('src/mcp-server/handlers/code-tools.ts');
    expect(codeIntelProcess?.stepDetails?.[0]?.role).toBe('upstream');
    expect(codeIntelProcess?.stepDetails?.[1]?.role).toBe('entry');

    const zeroclawStore = new EmbeddedCodeIntelligenceStore(
      'native_validation',
      path.join(zeroclawRepo.tempRoot, '.devplan'),
    );
    fs.mkdirSync(path.join(zeroclawRepo.tempRoot, '.devplan'), { recursive: true });
    const zeroclawProcesses = await zeroclawStore.getProcesses(zeroclawRepo.tempRoot);
    const providersProcess = zeroclawProcesses.find(item => item.id === 'process:src/providers');
    expect(providersProcess?.processType).toBe('execution_flow');
    expect(providersProcess?.entryFile).toBe(providersProcess?.steps[0]);
    expect(providersProcess?.steps).toContain('src/providers/openai.rs');
    expect(providersProcess?.steps).toContain('src/providers/traits.rs');
    expect(providersProcess?.stepDetails?.map(item => item.filePath)).toEqual(providersProcess?.steps);
    expect(providersProcess?.stepDetails?.every(item => item.reasons.length > 0)).toBe(true);
  });

  test('shared regression comparator should emit structured diagnostics on mismatch', async () => {
    const { tempRoot, expectedPath } = setupFixtureRepo();
    tempDirs.push(tempRoot);

    const expected = loadExpected();
    expected.stats = { ...(expected.stats || {}), communityCount: 99 };
    fs.writeFileSync(expectedPath, JSON.stringify(expected, null, 2), 'utf-8');

    const result = await runCodeIntelRegressionCheck({
      fixturePath: tempRoot,
      expectedPath,
    });

    expect(result.ok).toBe(false);
    expect(result.summary.failed).toBeGreaterThan(0);
    expect(result.diagnostics.some(item => item.code === 'stats.communityCount.mismatch')).toBe(true);
    expect(result.diagnostics[0]?.scope).toBeDefined();
  });

  test('ts/js native parser should emit symbol ownership edges for class members', async () => {
    const { tempRoot } = setupFixtureRepo();
    tempDirs.push(tempRoot);
    const basePath = path.join(tempRoot, '.devplan');
    fs.mkdirSync(basePath, { recursive: true });

    const store = new EmbeddedCodeIntelligenceStore('native_validation', basePath);
    const graph = await store.getGraph(tempRoot);

    expect(
      graph.edges.some(edge =>
        edge.from === 'symbol:method:src/alpha/a.ts:AlphaService.run'
        && edge.to === 'symbol:class:src/alpha/a.ts:AlphaService'
        && edge.label === 'MEMBER_OF'
        && edge.properties?.membership === 'symbol_owner'
      ),
    ).toBe(true);
  });

  test('rust parser should emit ownership edges for trait and impl methods', async () => {
    const { tempRoot } = setupFixtureRepo();
    tempDirs.push(tempRoot);
    const basePath = path.join(tempRoot, '.devplan');
    fs.mkdirSync(basePath, { recursive: true });

    const store = new EmbeddedCodeIntelligenceStore('native_validation', basePath);
    const graph = await store.getGraph(tempRoot);

    expect(
      graph.edges.some(edge =>
        edge.from === 'symbol:method:src/rust/mod.rs:NativeRunner.run'
        && edge.to === 'symbol:trait:src/rust/mod.rs:NativeRunner'
        && edge.label === 'MEMBER_OF'
        && edge.properties?.membership === 'symbol_owner'
      ),
    ).toBe(true);

    expect(
      graph.edges.some(edge =>
        edge.from === 'symbol:method:src/rust/engine.rs:NativeEngine.status'
        && edge.to === 'symbol:struct:src/rust/engine.rs:NativeEngine'
        && edge.label === 'MEMBER_OF'
        && edge.properties?.membership === 'symbol_owner'
      ),
    ).toBe(true);
  });

  test('native parser should emit CALLS, IMPLEMENTS and EXTENDS edges', async () => {
    const { tempRoot } = setupFixtureRepo();
    tempDirs.push(tempRoot);
    const basePath = path.join(tempRoot, '.devplan');
    fs.mkdirSync(basePath, { recursive: true });

    const store = new EmbeddedCodeIntelligenceStore('native_validation', basePath);
    const graph = await store.getGraph(tempRoot);

    expect(
      graph.edges.some(edge =>
        edge.from === 'symbol:class:src/alpha/a.ts:AdvancedAlphaService'
        && edge.to === 'symbol:class:src/alpha/a.ts:AlphaService'
        && edge.label === 'EXTENDS'
      ),
    ).toBe(true);

    expect(
      graph.edges.some(edge =>
        edge.from === 'symbol:class:src/alpha/a.ts:AdvancedAlphaService'
        && edge.to === 'symbol:interface:src/alpha/a.ts:AlphaConfig'
        && edge.label === 'IMPLEMENTS'
      ),
    ).toBe(true);

    expect(
      graph.edges.some(edge =>
        edge.from === 'symbol:method:src/rust/engine.rs:NativeEngine.status'
        && edge.to === 'symbol:function:src/rust/engine.rs:run_native'
        && edge.label === 'CALLS'
      ),
    ).toBe(true);
  });

  test('advanced fixture should preserve namespace ownership and cross-file call edges', async () => {
    const { tempRoot } = setupFixtureRepo('native-advanced');
    tempDirs.push(tempRoot);
    const basePath = path.join(tempRoot, '.devplan');
    fs.mkdirSync(basePath, { recursive: true });

    const store = new EmbeddedCodeIntelligenceStore('native_validation', basePath);
    const graph = await store.getGraph(tempRoot);

    expect(
      graph.edges.some(edge =>
        edge.from === 'symbol:function:src/delta/consumer.ts:consumeGamma'
        && edge.to === 'symbol:function:src/gamma/entry.ts:bootstrapGamma'
        && edge.label === 'CALLS'
      ),
    ).toBe(true);

    expect(
      graph.edges.some(edge =>
        edge.from === 'symbol:method:src/gamma/models.ts:GammaDomain.ConcreteRunner.run'
        && edge.to === 'symbol:class:src/gamma/models.ts:GammaDomain.ConcreteRunner'
        && edge.label === 'MEMBER_OF'
        && edge.properties?.membership === 'symbol_owner'
      ),
    ).toBe(true);
  });

  test('advanced fixture should infer semantic communities and process steps', async () => {
    const { tempRoot } = setupFixtureRepo('native-advanced');
    tempDirs.push(tempRoot);
    const basePath = path.join(tempRoot, '.devplan');
    fs.mkdirSync(basePath, { recursive: true });

    const store = new EmbeddedCodeIntelligenceStore('native_validation', basePath);
    const clusters = await store.getClusters(tempRoot);
    const processes = await store.getProcesses(tempRoot);

    const gammaCluster = clusters.find(item => item.id === 'community:src/gamma');
    expect(gammaCluster?.members).toEqual([
      'src/gamma/default-helper.ts',
      'src/gamma/entry.ts',
      'src/gamma/models.ts',
      'src/gamma/reexport.ts',
    ]);

    const gammaProcess = processes.find(item => item.id === 'process:src/gamma');
    expect(gammaProcess?.steps).toEqual([
      'src/delta/consumer.ts',
      'src/gamma/entry.ts',
      'src/gamma/models.ts',
      'src/gamma/default-helper.ts',
      'src/gamma/reexport.ts',
    ]);
    expect(gammaProcess?.processType).toBe('execution_flow');
    expect(gammaProcess?.entryFile).toBe('src/delta/consumer.ts');
    expect(gammaProcess?.strategy).toBe('semantic_execution_flow_v2');
    expect(gammaProcess?.stepDetails?.[0]).toMatchObject({
      filePath: 'src/delta/consumer.ts',
      step: 1,
      role: 'upstream',
    });
    expect(gammaProcess?.stepDetails?.[1]).toMatchObject({
      filePath: 'src/gamma/entry.ts',
      step: 2,
      role: 'entry',
    });
    expect(gammaProcess?.stepDetails?.[1]?.reasons.some(reason => reason.includes('selected as execution-flow entry'))).toBe(true);
    expect(gammaProcess?.stepDetails?.[4]).toMatchObject({
      filePath: 'src/gamma/reexport.ts',
      step: 5,
      role: 'fallback',
    });

    const rustProcess = processes.find(item => item.id === 'process:src/rust');
    expect(rustProcess?.steps[0]).toBe('src/rust/mod.rs');
    expect(rustProcess?.entryFile).toBe('src/rust/mod.rs');
  });

  test('advanced fixture should expose ranked query/context/impact explanations', async () => {
    const { tempRoot } = setupFixtureRepo('native-advanced');
    tempDirs.push(tempRoot);
    const basePath = path.join(tempRoot, '.devplan');
    fs.mkdirSync(basePath, { recursive: true });

    const store = new EmbeddedCodeIntelligenceStore('native_validation', basePath);

    const queryResult = await store.query('GammaDomain helper', tempRoot, 10);
    expect(queryResult.communities[0]?.id).toBe('community:src/gamma');
    expect(queryResult.processes[0]?.id).toBe('process:src/gamma');
    expect(queryResult.communityDetails[0]?.reasons.some(reason => reason.includes('matched symbol') || reason.includes('query token overlap'))).toBe(true);
    expect(queryResult.fusionApplied).toBe(false);
    expect(queryResult.fusionMode).toBe('graph_only');
    expect(queryResult.retrievalEvidence).toEqual([]);
    expect(queryResult.matchedNodeDetails[0]?.baselineScore).toBe(queryResult.matchedNodeDetails[0]?.score);
    expect(queryResult.summary).toContain('community is src/gamma');

    const contextResult = await store.getContext('GammaDomain.ConcreteRunner.run', tempRoot);
    expect(contextResult.communities[0]?.id).toBe('community:src/gamma');
    expect(contextResult.processes[0]?.id).toBe('process:src/gamma');
    expect(contextResult.neighborDetails[0]?.reasons.some(reason => reason.includes('CALLS') || reason.includes('MEMBER_OF'))).toBe(true);
    expect(contextResult.fusionApplied).toBe(false);
    expect(contextResult.retrievalEvidence).toEqual([]);
    expect(contextResult.summary).toContain('src/gamma');

    const impactResult = await store.getImpact('bootstrapGamma', 'downstream', tempRoot, 20);
    expect(impactResult.affectedCommunities[0]?.id).toBe('community:src/gamma');
    expect(impactResult.affectedProcesses[0]?.id).toBe('process:src/gamma');
    expect(impactResult.affectedNodeDetails[0]?.score).toBeGreaterThan(0);
    expect(impactResult.fusionApplied).toBe(false);
    expect(impactResult.retrievalEvidence).toEqual([]);
    expect(impactResult.summary).toContain('risk');
  });
});
