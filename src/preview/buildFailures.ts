/** Formatting of the 3D editor's "could not be generated" banner. */

export interface BuildFailure {
  id: string;
  label: string;
  /** Full error message (leads with the item's validation problems). */
  message: string;
}

export interface BuildFailureLine extends BuildFailure {
  /** One‑line text: "label: message", truncated. */
  text: string;
  /** Untruncated "label: message" for the tooltip. */
  full: string;
}

export interface BuildFailureBanner {
  heading: string;
  lines: BuildFailureLine[];
  /** Failures not listed ("and N more"). */
  more: number;
}

export const MAX_FAILURE_LINES = 3;
export const MAX_FAILURE_CHARS = 140;

/** Single‑line text cut to `max` characters at a word boundary when possible, with an ellipsis. */
export function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

export function formatBuildFailures(
  failures: readonly BuildFailure[],
  maxLines = MAX_FAILURE_LINES,
  maxChars = MAX_FAILURE_CHARS,
): BuildFailureBanner | null {
  if (!failures.length) return null;
  const n = failures.length;
  const lines = failures.slice(0, maxLines).map((f) => {
    const full = `${f.label}: ${f.message.replace(/\s+/g, ' ').trim()}`;
    return { ...f, full, text: truncate(full, maxChars) };
  });
  return {
    heading: `${n} item${n > 1 ? 's' : ''} could not be generated`,
    lines,
    more: n - lines.length,
  };
}
