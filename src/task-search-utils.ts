import type { MainTask, SubTask } from './types';

export type TaskSearchField = 'taskId' | 'title' | 'description' | 'subTask';
export type TaskSearchBy = 'auto' | TaskSearchField;

export interface RankedTaskMatch {
  task: MainTask;
  score: number;
  matchedFields: TaskSearchField[];
  matchedSubTasks: SubTask[];
}

export function rankTaskMatches(
  query: string,
  mainTasks: MainTask[],
  subTasksByParent: Map<string, SubTask[]>,
  limit?: number,
  searchBy: TaskSearchBy = 'auto',
): RankedTaskMatch[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const normalizedQuery = trimmed.toLowerCase();
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  const ranked = mainTasks
    .map((task) => {
      const matchedFields: TaskSearchField[] = [];
      const taskId = task.taskId.toLowerCase();
      const title = task.title.toLowerCase();
      const description = (task.description || '').toLowerCase();
      const subTasks = subTasksByParent.get(task.taskId) || [];
      const matchedSubTasks = subTasks.filter((sub) => {
        const haystack = `${sub.taskId} ${sub.title} ${sub.description || ''}`.toLowerCase();
        return haystack.includes(normalizedQuery) || terms.every((term) => haystack.includes(term));
      });

      let score = 0;

      if (taskId === normalizedQuery) {
        score += 5000;
        matchedFields.push('taskId');
      } else if (taskId.includes(normalizedQuery)) {
        score += 2400;
        matchedFields.push('taskId');
      }

      if (title === normalizedQuery) {
        score += 4000;
        matchedFields.push('title');
      } else if (title.startsWith(normalizedQuery)) {
        score += 3200;
        matchedFields.push('title');
      } else if (title.includes(normalizedQuery)) {
        score += 2600;
        matchedFields.push('title');
      }

      if (description.includes(normalizedQuery)) {
        score += 1400;
        matchedFields.push('description');
      }

      if (matchedSubTasks.length > 0) {
        score += 1800 + matchedSubTasks.length * 120;
        matchedFields.push('subTask');
      }

      if (terms.length > 1) {
        const titleTermHits = terms.filter((term) => title.includes(term)).length;
        const descriptionTermHits = terms.filter((term) => description.includes(term)).length;
        const subTaskTermHits = matchedSubTasks.reduce((sum, sub) => {
          const haystack = `${sub.taskId} ${sub.title} ${sub.description || ''}`.toLowerCase();
          return sum + terms.filter((term) => haystack.includes(term)).length;
        }, 0);
        score += titleTermHits * 120 + descriptionTermHits * 60 + subTaskTermHits * 40;
      }

      if (matchedFields.length === 0) return null;
      if (searchBy !== 'auto' && !matchedFields.includes(searchBy)) return null;

      return {
        task,
        score,
        matchedFields,
        matchedSubTasks,
      } satisfies RankedTaskMatch;
    })
    .filter((item): item is RankedTaskMatch => item !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.task.updatedAt || 0) - (a.task.updatedAt || 0);
    });

  return typeof limit === 'number' ? ranked.slice(0, limit) : ranked;
}
