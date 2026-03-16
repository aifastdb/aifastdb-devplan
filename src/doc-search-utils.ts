import type { DevPlanDoc } from './types';

const UUID_LIKE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DocSearchMatchField = 'id' | 'title' | 'content';
export type DocSearchBy = 'auto' | DocSearchMatchField;

export interface RankedDocMatch {
  doc: DevPlanDoc;
  score: number;
  matchedFields: DocSearchMatchField[];
}

export function isUuidLikeQuery(query: string): boolean {
  return UUID_LIKE_RE.test(query.trim());
}

export function rankLiteralDocMatches(
  query: string,
  docs: DevPlanDoc[],
  limit?: number,
  searchBy: DocSearchBy = 'auto',
): RankedDocMatch[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const normalizedQuery = trimmed.toLowerCase();
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  const ranked = docs
    .map((doc) => {
      const id = doc.id.toLowerCase();
      const title = doc.title.toLowerCase();
      const content = doc.content.toLowerCase();

      let score = 0;
      const matchedFields: DocSearchMatchField[] = [];

      if (id === normalizedQuery) {
        score += 5000;
        matchedFields.push('id');
      } else if (id.includes(normalizedQuery)) {
        score += 1800;
        matchedFields.push('id');
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

      if (content.includes(normalizedQuery)) {
        score += 1200;
        matchedFields.push('content');
      }

      if (terms.length > 1) {
        const titleTermHits = terms.filter((term) => title.includes(term)).length;
        const contentTermHits = terms.filter((term) => content.includes(term)).length;
        score += titleTermHits * 150 + contentTermHits * 60;
      }

      if (matchedFields.length === 0) return null;
      if (searchBy !== 'auto' && !matchedFields.includes(searchBy)) return null;
      return { doc, score, matchedFields } satisfies RankedDocMatch;
    })
    .filter((item): item is RankedDocMatch => item !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const updatedA = typeof a.doc.updatedAt === 'number' ? a.doc.updatedAt : 0;
      const updatedB = typeof b.doc.updatedAt === 'number' ? b.doc.updatedAt : 0;
      return updatedB - updatedA;
    });

  return typeof limit === 'number' ? ranked.slice(0, limit) : ranked;
}

export function literalSearchDocs(
  query: string,
  docs: DevPlanDoc[],
  limit?: number,
  searchBy: DocSearchBy = 'auto',
): DevPlanDoc[] {
  return rankLiteralDocMatches(query, docs, limit, searchBy).map((item) => item.doc);
}
