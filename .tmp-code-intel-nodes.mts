import embeddedModule from './src/code-intelligence/embedded-store.ts';
const { EmbeddedCodeIntelligenceStore } = embeddedModule as typeof import('./src/code-intelligence/embedded-store');
const store = new EmbeddedCodeIntelligenceStore('native_validation', './tests/fixtures/code-intelligence/native-advanced/.devplan-temp');
const graph = await store.getGraph('./tests/fixtures/code-intelligence/native-advanced');
const nodes = graph.nodes.filter(node => node.id.includes('src/gamma/models.ts') && String(node.properties?.kind || '') === 'method');
console.log(JSON.stringify(nodes.map(node => ({ id: node.id, label: node.label, rawName: node.properties?.rawName })), null, 2));
