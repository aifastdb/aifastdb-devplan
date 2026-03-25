const PHASE_TASK_ID_REGEX = /^phase-(\d+[A-Za-z]?)$/i;
const PHASE_TITLE_PREFIX_REGEX = /^phase\s*-?\s*(\d+[A-Za-z]?)\s*[:：-]?\s*(.*)$/i;

function normalizePhaseToken(value: string): string {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

export function normalizeMainTaskTitle(taskId: string, title: string): string {
  const rawTitle = String(title || '').trim();
  const phaseMatch = String(taskId || '').trim().match(PHASE_TASK_ID_REGEX);
  if (!phaseMatch) {
    return rawTitle;
  }

  const phaseToken = phaseMatch[1];
  const expectedPrefix = `Phase-${phaseToken}`;
  if (!rawTitle) {
    return expectedPrefix;
  }

  const prefixedMatch = rawTitle.match(PHASE_TITLE_PREFIX_REGEX);
  if (prefixedMatch) {
    const actualToken = normalizePhaseToken(prefixedMatch[1]);
    const expectedToken = normalizePhaseToken(phaseToken);
    const suffix = String(prefixedMatch[2] || '').trim();
    if (actualToken === expectedToken) {
      return suffix ? `${expectedPrefix}: ${suffix}` : expectedPrefix;
    }
  }

  return `${expectedPrefix}: ${rawTitle}`;
}
