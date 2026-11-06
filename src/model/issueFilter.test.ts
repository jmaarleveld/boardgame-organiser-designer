import { describe, expect, it } from 'vitest';
import type { ValidationIssue } from './layout';
import { issuesForSelection } from './issueFilter';

const issue = (itemIds: string[], message: string, severity: 'error' | 'warning' = 'error'): ValidationIssue => ({ severity, itemIds, message });

const issues: ValidationIssue[] = [
  issue([], 'Tolerance is larger than the game box.'),
  issue(['a', 'b'], 'A overlaps B.'),
  issue(['b'], 'B is too tall.'),
  issue(['c'], 'C may tip.', 'warning'),
];

describe('issuesForSelection', () => {
  it('shows everything unfiltered when nothing is selected', () => {
    expect(issuesForSelection(issues, null)).toEqual({ shown: issues, hidden: 0, filtered: false });
    expect(issuesForSelection(issues, undefined).filtered).toBe(false);
  });

  it('keeps only the selected item’s issues; overlaps count for both items', () => {
    const a = issuesForSelection(issues, 'a');
    expect(a.filtered).toBe(true);
    expect(a.shown.map((i) => i.message)).toEqual(['A overlaps B.']);
    expect(a.hidden).toBe(3);
    const b = issuesForSelection(issues, 'b');
    expect(b.shown.map((i) => i.message)).toEqual(['A overlaps B.', 'B is too tall.']);
    expect(b.hidden).toBe(2);
  });

  it('counts design‑wide issues as hidden, never shown, when filtered', () => {
    const d = issuesForSelection(issues, 'd');
    expect(d).toEqual({ shown: [], hidden: 4, filtered: true });
  });

  it('reports nothing hidden when the design has no problems', () => {
    expect(issuesForSelection([], 'a')).toEqual({ shown: [], hidden: 0, filtered: true });
  });
});
