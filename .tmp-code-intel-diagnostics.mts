import regressionModule from './src/code-intelligence/regression.ts';
const { runCodeIntelRegressionCheck } = regressionModule as typeof import('./src/code-intelligence/regression');
const result = await runCodeIntelRegressionCheck({ fixturePath: './tests/fixtures/code-intelligence/native-advanced' });
console.log(JSON.stringify({ ok: result.ok, summary: result.summary, diagnostics: result.diagnostics }, null, 2));
