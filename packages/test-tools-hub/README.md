# @aifastdb/test-tools-hub

Reusable test visualization hub for benchmark/test monitoring.

## Install

```bash
npm i @aifastdb/test-tools-hub
```

## Run Dashboard

```bash
aifastdb-test-tools-hub --port 3321
```

Optional custom registry:

```bash
aifastdb-test-tools-hub --registry ./test-tools.registry.json
```

## Programmatic Usage

```ts
import { loadRegistryFromFile, getEnabledTools, collectToolStatus } from '@aifastdb/test-tools-hub';

const registry = loadRegistryFromFile('./test-tools.registry.json');
const tools = getEnabledTools(registry);
const statuses = await Promise.all(
  tools.map((tool) =>
    collectToolStatus(tool, {
      getCurrentPhase: (projectName) => ({ taskId: 'phase-x', title: projectName, status: 'in_progress', completed: 1, total: 2, percent: 50 }),
    }),
  ),
);
```
