import type { ValidationIssue } from './layout';

export interface FilteredIssues {
  /** Issues shown in the panel. */
  shown: ValidationIssue[];
  /** Issues hidden by the filter (other items' and design‑wide ones). */
  hidden: number;
  /** True when the list is filtered to one item. */
  filtered: boolean;
}

/**
 * Problems list for the sidebar: with an item selected, only the issues that
 * involve it (an overlap between it and another item counts); design‑wide
 * issues (no item ids) and other items' issues are only counted as hidden.
 * With nothing selected everything is shown.
 */
export function issuesForSelection(issues: readonly ValidationIssue[], selectedId: string | null | undefined): FilteredIssues {
  if (!selectedId) return { shown: [...issues], hidden: 0, filtered: false };
  const shown = issues.filter((i) => i.itemIds.includes(selectedId));
  return { shown, hidden: issues.length - shown.length, filtered: true };
}
