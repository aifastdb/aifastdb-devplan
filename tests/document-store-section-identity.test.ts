import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { DevPlanDocumentStore } from '../src/dev-plan-document-store';

function createStore(tempRoot: string): DevPlanDocumentStore {
  return new DevPlanDocumentStore('ai_db', {
    documentPath: path.join(tempRoot, 'documents.jsonl'),
    taskPath: path.join(tempRoot, 'tasks.jsonl'),
    modulePath: path.join(tempRoot, 'modules.jsonl'),
    promptPath: path.join(tempRoot, 'prompts.jsonl'),
  });
}

describe('DevPlanDocumentStore section identity regression', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test('saveSection without subSection must not overwrite technical_notes sub-documents', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-doc-identity-'));
    tempDirs.push(tempRoot);
    const store = createStore(tempRoot);

    store.saveSection({
      projectName: 'ai_db',
      section: 'technical_notes',
      subSection: 'memo-a',
      title: 'Memo A',
      content: 'content-a',
    });
    store.saveSection({
      projectName: 'ai_db',
      section: 'technical_notes',
      subSection: 'memo-b',
      title: 'Memo B',
      content: 'content-b',
    });

    store.saveSection({
      projectName: 'ai_db',
      section: 'technical_notes',
      title: 'Top Note',
      content: 'top-content',
    });

    const docA = store.getSection('technical_notes', 'memo-a');
    const docB = store.getSection('technical_notes', 'memo-b');
    const root = store.getSection('technical_notes');

    expect(docA?.content).toBe('content-a');
    expect(docB?.content).toBe('content-b');
    expect(root?.title).toBe('Top Note');
    expect(root?.subSection).toBeUndefined();
  });

  test('updateSection without subSection should fail when only sub-documents exist', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-doc-identity-'));
    tempDirs.push(tempRoot);
    const store = createStore(tempRoot);

    store.saveSection({
      projectName: 'ai_db',
      section: 'technical_notes',
      subSection: 'memo-only',
      title: 'Memo Only',
      content: 'memo-content',
    });

    expect(() => store.updateSection('technical_notes', 'new-root-content')).toThrow(
      'not found for project'
    );
    expect(store.getSection('technical_notes', 'memo-only')?.content).toBe('memo-content');
  });
});
