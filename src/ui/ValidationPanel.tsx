import type { LayoutSummary } from '../model/layout';
import { useStore } from '../state/store';

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

export function ValidationPanel({ summary }: { summary: LayoutSummary }) {
  const select = useStore((s) => s.select);
  const selectedId = useStore((s) => s.selectedId);
  return (
    <section className="panel validation" aria-label="Validation">
      <h2>Layout</h2>
      <p className="muted">
        Slack remaining: X {f1(summary.slackX)} mm, Y {f1(summary.slackY)} mm · {summary.itemCount} item
        {summary.itemCount === 1 ? '' : 's'}
      </p>
      {summary.issues.length === 0 ? (
        <p className="ok-text">No problems.</p>
      ) : (
        <ul className="issues">
          {summary.issues.map((iss, i) => (
            <li key={i} className={iss.severity}>
              <button
                type="button"
                className={`issue ${iss.itemIds.includes(selectedId ?? '') ? 'current' : ''}`}
                disabled={!iss.itemIds.length}
                onClick={() => {
                  if (!iss.itemIds.length) return;
                  // Cycle through the involved items on repeated clicks.
                  const idx = iss.itemIds.indexOf(selectedId ?? '');
                  select(iss.itemIds[(idx + 1) % iss.itemIds.length]);
                }}
              >
                <span className="sev">{iss.severity === 'error' ? '✕' : '!'}</span> {iss.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
