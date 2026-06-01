import * as fs from 'fs';
import * as path from 'path';

import type { IDevPlanStore } from './dev-plan-interface';
import {
  createDevPlan,
  createDevPlanVisualLite,
  getDefaultBasePath,
  type DevPlanEngine,
} from './dev-plan-factory';
import type { DevPlanSection, ModuleStatus, TaskPriority, TaskStatus } from './types';

const VALID_SECTIONS = new Set<DevPlanSection>([
  'overview',
  'core_concepts',
  'api_design',
  'file_structure',
  'config',
  'examples',
  'technical_notes',
  'api_endpoints',
  'milestones',
  'changelog',
  'custom',
]);

const ENTITY_TYPES = {
  doc: 'devplan-doc',
  mainTask: 'devplan-main-task',
  subTask: 'devplan-sub-task',
  module: 'devplan-module',
  prompt: 'devplan-prompt',
} as const;

interface WalEntity {
  id: string;
  entity_type: string;
  name?: string;
  properties?: Record<string, unknown>;
  updated_at?: number;
}

interface WalReadStats {
  files: number;
  invalidLines: number;
  putEntityLines: number;
}

export interface RebuildProjectFromWalOptions {
  archiveWalPath: string;
  targetProjectName: string;
  targetBasePath?: string;
  targetEngine?: DevPlanEngine;
  failIfTargetExists?: boolean;
  includeTasks?: boolean;
  includeDocs?: boolean;
  includeModules?: boolean;
  includePrompts?: boolean;
  overviewFilePath?: string;
}

export interface RebuildProjectFromWalResult {
  success: boolean;
  targetProjectName: string;
  targetBasePath: string;
  targetEngine: DevPlanEngine;
  targetDir: string;
  archiveWalPath: string;
  stats: {
    modules: number;
    mainTasks: number;
    subTasks: number;
    docs: number;
    prompts: number;
    overviewSynced: boolean;
  };
  walStats: WalReadStats;
  errors: string[];
  warnings: string[];
}

export function rebuildProjectFromWal(
  options: RebuildProjectFromWalOptions
): RebuildProjectFromWalResult {
  const archiveWalPath = path.resolve(options.archiveWalPath);
  const targetBasePath = path.resolve(options.targetBasePath || getDefaultBasePath());
  const targetProjectName = options.targetProjectName;
  const targetEngine = options.targetEngine || 'graph';
  const targetDir = path.join(targetBasePath, targetProjectName);

  const errors: string[] = [];
  const warnings: string[] = [];
  const stats = {
    modules: 0,
    mainTasks: 0,
    subTasks: 0,
    docs: 0,
    prompts: 0,
    overviewSynced: false,
  };

  if (!targetProjectName.trim()) {
    return failResult('targetProjectName is required');
  }

  if (!fs.existsSync(archiveWalPath) || !fs.statSync(archiveWalPath).isDirectory()) {
    return failResult(`archiveWalPath does not exist or is not a directory: ${archiveWalPath}`);
  }

  if (fs.existsSync(targetDir) && options.failIfTargetExists !== false) {
    return failResult(`target project directory already exists: ${targetDir}`);
  }

  const walRead = loadWalEntities(archiveWalPath);
  if (walRead.invalidLines > 0) {
    warnings.push(`Skipped ${walRead.invalidLines} invalid WAL lines while scanning ${archiveWalPath}.`);
  }
  if (walRead.entities.length === 0) {
    return failResult(`No PutEntity records found under archiveWalPath: ${archiveWalPath}`, walRead);
  }

  const grouped = groupByType(walRead.entities);
  const store = createTargetStore(targetProjectName, targetBasePath, targetEngine);

  if (options.includeModules !== false) {
    stats.modules = importModules(store, grouped.get(ENTITY_TYPES.module) || [], targetProjectName, errors);
  }

  if (options.includeTasks !== false) {
    stats.mainTasks = importMainTasks(store, grouped.get(ENTITY_TYPES.mainTask) || [], targetProjectName, errors);
    stats.subTasks = importSubTasks(store, grouped.get(ENTITY_TYPES.subTask) || [], targetProjectName, errors);
  }

  if (options.includeDocs !== false) {
    stats.docs = importDocs(store, grouped.get(ENTITY_TYPES.doc) || [], targetProjectName, errors);
  }

  if (options.includePrompts !== false) {
    stats.prompts = importPrompts(store, grouped.get(ENTITY_TYPES.prompt) || [], targetProjectName, errors);
  }

  if (options.overviewFilePath) {
    const overviewPath = path.resolve(options.overviewFilePath);
    if (fs.existsSync(overviewPath)) {
      stats.overviewSynced = syncOverviewDoc(store, targetProjectName, overviewPath);
    } else {
      warnings.push(`overviewFilePath does not exist: ${overviewPath}`);
    }
  }

  try {
    store.sync();
  } catch (error) {
    warnings.push(`Target store sync() failed: ${toErrorMessage(error)}`);
  }

  return {
    success: errors.length === 0,
    targetProjectName,
    targetBasePath,
    targetEngine,
    targetDir,
    archiveWalPath,
    stats,
    walStats: {
      files: walRead.files,
      invalidLines: walRead.invalidLines,
      putEntityLines: walRead.putEntityLines,
    },
    errors,
    warnings,
  };

  function failResult(message: string, walStats?: WalReadStats): RebuildProjectFromWalResult {
    return {
      success: false,
      targetProjectName,
      targetBasePath,
      targetEngine,
      targetDir,
      archiveWalPath,
      stats,
      walStats: walStats || { files: 0, invalidLines: 0, putEntityLines: 0 },
      errors: [message],
      warnings,
    };
  }
}

function createTargetStore(
  projectName: string,
  basePath: string,
  engine: DevPlanEngine
): IDevPlanStore {
  if (engine === 'graph') {
    return createDevPlanVisualLite(projectName, basePath);
  }
  return createDevPlan(projectName, basePath, engine);
}

function loadWalEntities(archiveWalPath: string): WalReadStats & { entities: WalEntity[] } {
  const walFiles = listWalFiles(archiveWalPath);
  const entitiesById = new Map<string, { entity: WalEntity; ts: number }>();
  let invalidLines = 0;
  let putEntityLines = 0;

  for (const walFile of walFiles) {
    const lines = fs.readFileSync(walFile, 'utf-8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      let parsed: any;
      try {
        parsed = JSON.parse(line);
      } catch {
        invalidLines += 1;
        continue;
      }

      if (parsed?.magic) {
        continue;
      }

      if (parsed?.operation !== 'PutEntity' || !parsed.entity) {
        continue;
      }

      putEntityLines += 1;
      const entity = parsed.entity as WalEntity;
      const currentTs = Number(parsed.timestamp || entity.updated_at || 0);
      const existing = entitiesById.get(entity.id);
      if (!existing || existing.ts <= currentTs) {
        entitiesById.set(entity.id, { entity, ts: currentTs });
      }
    }
  }

  return {
    files: walFiles.length,
    invalidLines,
    putEntityLines,
    entities: Array.from(entitiesById.values()).map((entry) => entry.entity),
  };
}

function listWalFiles(rootDir: string): string[] {
  const results: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.gwal')) {
        results.push(fullPath);
      }
    }
  }

  results.sort();
  return results;
}

function groupByType(entities: WalEntity[]): Map<string, WalEntity[]> {
  const grouped = new Map<string, WalEntity[]>();
  for (const entity of entities) {
    const list = grouped.get(entity.entity_type) || [];
    list.push(entity);
    grouped.set(entity.entity_type, list);
  }
  return grouped;
}

function importModules(
  store: IDevPlanStore,
  entities: WalEntity[],
  projectName: string,
  errors: string[]
): number {
  let ok = 0;
  for (const entity of entities) {
    try {
      const props = entity.properties || {};
      const moduleId = asString(props.moduleId).trim();
      if (!moduleId) {
        continue;
      }
      const name = asString(props.name || entity.name || moduleId).trim() || moduleId;
      const description = asString(props.description).trim() || undefined;
      const status = normalizeModuleStatus(props.status);
      const existing = store.getModule(moduleId);
      if (existing) {
        store.updateModule(moduleId, { name, description, status });
      } else {
        store.createModule({
          projectName,
          moduleId,
          name,
          description,
          status,
        });
      }
      ok += 1;
    } catch (error) {
      errors.push(`Module import failed for ${entity.id}: ${toErrorMessage(error)}`);
    }
  }
  return ok;
}

function importMainTasks(
  store: IDevPlanStore,
  entities: WalEntity[],
  projectName: string,
  errors: string[]
): number {
  let ok = 0;
  for (const entity of entities) {
    try {
      const props = entity.properties || {};
      const taskId = asString(props.taskId).trim();
      if (!taskId) {
        continue;
      }
      store.upsertMainTask(
        {
          projectName,
          taskId,
          title: asString(props.title || entity.name || taskId).trim() || taskId,
          priority: normalizePriority(props.priority),
          description: asString(props.description).trim() || undefined,
          estimatedHours: optionalNumber(props.estimatedHours),
          relatedSections: asStringArray(props.relatedSections),
          relatedPromptIds: asStringArray(props.relatedPromptIds),
          moduleId: asString(props.moduleId).trim() || undefined,
          order: optionalNumber(props.order),
        },
        {
          preserveStatus: false,
          status: normalizeTaskStatus(props.status),
        }
      );
      ok += 1;
    } catch (error) {
      errors.push(`Main task import failed for ${entity.id}: ${toErrorMessage(error)}`);
    }
  }
  return ok;
}

function importSubTasks(
  store: IDevPlanStore,
  entities: WalEntity[],
  projectName: string,
  errors: string[]
): number {
  let ok = 0;
  for (const entity of entities) {
    try {
      const props = entity.properties || {};
      const taskId = asString(props.taskId).trim();
      const parentTaskId = asString(props.parentTaskId).trim();
      if (!taskId || !parentTaskId) {
        continue;
      }

      store.upsertSubTask(
        {
          projectName,
          taskId,
          parentTaskId,
          title: asString(props.title || entity.name || taskId).trim() || taskId,
          estimatedHours: optionalNumber(props.estimatedHours),
          relatedFiles: asStringArray(props.relatedFiles),
          description: asString(props.description).trim() || undefined,
          order: optionalNumber(props.order),
        },
        {
          preserveStatus: false,
          status: normalizeTaskStatus(props.status),
        }
      );

      const completedAtCommit = asString(props.completedAtCommit).trim();
      if (completedAtCommit && normalizeTaskStatus(props.status) === 'completed') {
        store.updateSubTaskStatus(taskId, 'completed', { completedAtCommit });
      }

      ok += 1;
    } catch (error) {
      errors.push(`Sub-task import failed for ${entity.id}: ${toErrorMessage(error)}`);
    }
  }
  return ok;
}

function importDocs(
  store: IDevPlanStore,
  entities: WalEntity[],
  projectName: string,
  errors: string[]
): number {
  let ok = 0;
  let pending = entities
    .slice()
    .sort((left, right) => Number(Boolean(left.properties?.parentDoc)) - Number(Boolean(right.properties?.parentDoc)));

  while (pending.length > 0) {
    let progressed = false;
    const nextRound: WalEntity[] = [];

    for (const entity of pending) {
      try {
        const props = entity.properties || {};
        const normalized = normalizeSection(props.section, props.subSection);
        store.saveSection({
          projectName,
          section: normalized.section,
          subSection: normalized.subSection,
          title: asString(props.title || entity.name || 'Untitled').trim() || 'Untitled',
          content: asString(props.content),
          version: asString(props.version).trim() || undefined,
          relatedSections: asStringArray(props.relatedSections),
          moduleId: asString(props.moduleId).trim() || undefined,
          relatedTaskIds: asStringArray(props.relatedTaskIds),
          parentDoc: asString(props.parentDoc).trim() || undefined,
        });
        ok += 1;
        progressed = true;
      } catch (error) {
        const message = toErrorMessage(error);
        if (message.includes('Parent doc') || message.includes('parentDoc')) {
          nextRound.push(entity);
        } else {
          errors.push(`Document import failed for ${entity.id}: ${message}`);
        }
      }
    }

    if (!progressed) {
      for (const entity of nextRound) {
        errors.push(`Document import failed for ${entity.id}: parent doc missing`);
      }
      break;
    }

    pending = nextRound;
  }

  return ok;
}

function importPrompts(
  store: IDevPlanStore,
  entities: WalEntity[],
  projectName: string,
  errors: string[]
): number {
  let ok = 0;
  const sorted = entities.slice().sort((left, right) => {
    return (optionalNumber(left.properties?.createdAt, 0) || 0)
      - (optionalNumber(right.properties?.createdAt, 0) || 0);
  });

  for (const entity of sorted) {
    try {
      const props = entity.properties || {};
      const content = asString(props.content).trim();
      if (!content) {
        continue;
      }
      store.savePrompt({
        projectName,
        content,
        aiInterpretation: asString(props.aiInterpretation).trim() || undefined,
        summary: asString(props.summary).trim() || undefined,
        relatedTaskId: asString(props.relatedTaskId).trim() || undefined,
        tags: asStringArray(props.tags),
      });
      ok += 1;
    } catch (error) {
      errors.push(`Prompt import failed for ${entity.id}: ${toErrorMessage(error)}`);
    }
  }

  return ok;
}

function syncOverviewDoc(store: IDevPlanStore, projectName: string, overviewFilePath: string): boolean {
  const content = fs.readFileSync(overviewFilePath, 'utf-8');
  const firstLine = content.split(/\r?\n/, 1)[0] || '';
  const title = firstLine.replace(/^#\s*/, '').trim() || `${projectName} Overview`;
  store.saveSection({
    projectName,
    section: 'overview',
    title,
    content,
    version: '1.0.0',
  });
  return true;
}

function normalizeSection(section: unknown, subSection: unknown): {
  section: DevPlanSection;
  subSection?: string;
} {
  const rawSection = asString(section).trim();
  const rawSubSection = asString(subSection).trim() || undefined;
  if (VALID_SECTIONS.has(rawSection as DevPlanSection)) {
    return { section: rawSection as DevPlanSection, subSection: rawSubSection };
  }
  return {
    section: 'custom',
    subSection: rawSubSection || rawSection || undefined,
  };
}

function normalizePriority(value: unknown): TaskPriority {
  return value === 'P0' || value === 'P1' || value === 'P2' ? value : 'P1';
}

function normalizeTaskStatus(value: unknown): TaskStatus {
  return value === 'pending'
    || value === 'in_progress'
    || value === 'completed'
    || value === 'cancelled'
    || value === 'revoked'
    ? value
    : 'pending';
}

function normalizeModuleStatus(value: unknown): ModuleStatus {
  return value === 'planning'
    || value === 'active'
    || value === 'completed'
    || value === 'deprecated'
    ? value
    : 'planning';
}

function asString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value == null) {
    return '';
  }
  return String(value);
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value.map((item) => asString(item).trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function optionalNumber(value: unknown, fallback?: number): number | undefined {
  if (value == null || value === '') {
    return fallback;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
