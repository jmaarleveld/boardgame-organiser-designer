import { describe, expect, it } from 'vitest';
import { formatBuildFailures, truncate } from './buildFailures';

const f = (id: string, message = 'Exposed height exceeds the inner height. (geometry: bad size)') => ({ id, label: `Tray ${id}`, message });

describe('formatBuildFailures', () => {
  it('returns null without failures', () => {
    expect(formatBuildFailures([])).toBeNull();
  });

  it('names the item and the reason, one line per failure', () => {
    const b = formatBuildFailures([f('a')])!;
    expect(b.heading).toBe('1 item could not be generated');
    expect(b.more).toBe(0);
    expect(b.lines).toHaveLength(1);
    expect(b.lines[0]).toMatchObject({ id: 'a', text: 'Tray a: Exposed height exceeds the inner height. (geometry: bad size)' });
    expect(b.lines[0].full).toBe(b.lines[0].text);
  });

  it('lists the first few and counts the rest', () => {
    const b = formatBuildFailures([f('a'), f('b'), f('c'), f('d'), f('e')], 3)!;
    expect(b.heading).toBe('5 items could not be generated');
    expect(b.lines.map((l) => l.id)).toEqual(['a', 'b', 'c']);
    expect(b.more).toBe(2);
  });

  it('truncates long messages but keeps the full text for the tooltip', () => {
    const long = `${'Wall too thin for the requested pocket depth. '.repeat(6)}(geometry: size must be positive)`;
    const b = formatBuildFailures([f('a', long)], 3, 80)!;
    const line = b.lines[0];
    expect(line.text.length).toBeLessThanOrEqual(80);
    expect(line.text.endsWith('…')).toBe(true);
    expect(line.full).toBe(`Tray a: ${long.trim()}`);
  });

  it('collapses newlines into one line', () => {
    expect(formatBuildFailures([f('a', 'first\nsecond')])!.lines[0].text).toBe('Tray a: first second');
  });
});

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('short', 10)).toBe('short');
  });
  it('cuts at a word boundary when one is near the end', () => {
    expect(truncate('alpha beta gamma delta', 15)).toBe('alpha beta…');
  });
  it('hard‑cuts a single long word', () => {
    expect(truncate('abcdefghijklmnop', 8)).toBe('abcdefg…');
  });
});
