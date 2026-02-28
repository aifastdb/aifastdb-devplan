import * as fs from 'fs';
import { TestToolDefinition, TestToolRegistry } from './types';

export const DEFAULT_REGISTRY: TestToolRegistry = {
  updatedAt: new Date().toISOString(),
  tools: [
    {
      id: 'ai_db-bench-progress',
      name: 'ai_db multimodal dedup benchmark',
      projectName: 'ai_db',
      description: 'Directly reads ai_db benchmark log/process state',
      kind: 'ai_db_bench_local',
      logPath: 'D:/Project/git/ai_db/multimodal_dedup_bench_1m.log',
      enabled: true,
      timeoutMs: 3000,
      staleSecondsThreshold: 300,
      tags: ['benchmark', 'dedup', 'ai_db'],
    },
  ],
};

export function loadRegistryFromFile(registryFile?: string): TestToolRegistry {
  if (!registryFile) return DEFAULT_REGISTRY;
  if (!fs.existsSync(registryFile)) return DEFAULT_REGISTRY;
  try {
    const raw = fs.readFileSync(registryFile, 'utf8');
    const parsed = JSON.parse(raw) as TestToolRegistry;
    if (!parsed || !Array.isArray(parsed.tools)) return DEFAULT_REGISTRY;
    return parsed;
  } catch {
    return DEFAULT_REGISTRY;
  }
}

export function getEnabledTools(registry: TestToolRegistry): TestToolDefinition[] {
  return registry.tools.filter((t) => t.enabled !== false);
}
