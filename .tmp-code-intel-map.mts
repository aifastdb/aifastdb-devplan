import * as path from 'node:path';
import embeddedModule from './src/code-intelligence/embedded-store.ts';
const { EmbeddedCodeIntelligenceStore } = embeddedModule as typeof import('./src/code-intelligence/embedded-store');
const store = new EmbeddedCodeIntelligenceStore('native_validation', './tests/fixtures/code-intelligence/native-advanced/.devplan-temp');
const repoPath = path.resolve('./tests/fixtures/code-intelligence/native-advanced');
const files = [] as any[];
await (store as any).walkRepo(repoPath, repoPath, files);
const ir = (store as any).buildIrSnapshot(repoPath, files);
const map = new Map<string, Map<string, string[]>>();
for (const entity of ir.entities) {
  const filePath = ir.files.find((item: any) => item.id === entity.fileId)?.filePath;
  if (!filePath || !entity.rawName) continue;
  if (!map.has(filePath)) map.set(filePath, new Map());
  const names = [entity.rawName, entity.label];
  const shortName = entity.rawName.split('.').pop();
  if (shortName && shortName !== entity.rawName) names.push(shortName);
  for (const name of names) {
    const bucket = map.get(filePath)!.get(name) || [];
    if (!bucket.includes(entity.id)) bucket.push(entity.id);
    map.get(filePath)!.set(name, bucket);
  }
}
console.log(JSON.stringify({
  exact: map.get('src/gamma/models.ts')?.get('GammaDomain.ConcreteRunner.run'),
  raw: map.get('src/gamma/models.ts')?.get('run')
}, null, 2));
