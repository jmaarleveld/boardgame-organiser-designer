import { useState } from 'react';
import type { RaiseMode } from '../boxes/types';
import type { FinishResult } from '../model/finish';
import { useStore } from '../state/store';
import { NumberField } from './NumberField';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** Outcome line of a finishing action. */
function describe(result: FinishResult, done: (n: number) => string, nothing: string): string {
  const parts: string[] = [];
  if (result.changedIds.length) parts.push(done(result.changedIds.length));
  else if (!result.problems.length) parts.push(nothing);
  parts.push(...result.problems);
  return parts.join(' ');
}

/**
 * One-off layout actions (left column): flat bases for the items on the game
 * box floor, and "Flatten top" (raise every stack top to one height, without
 * lips) so the game board can rest on the insert. Each click is one undo step.
 */
export function FinishPanel() {
  const boxHeight = useStore((s) => s.project.settings.box.height);
  const hasItems = useStore((s) => s.project.items.length > 0);
  const flatBases = useStore((s) => s.flatBasesOnFloor);
  const flatten = useStore((s) => s.flattenTop);
  /** null = follow the game box height. */
  const [height, setHeight] = useState<number | null>(null);
  const [mode, setMode] = useState<RaiseMode>('type');
  const [message, setMessage] = useState<string | null>(null);
  const target = height ?? boxHeight;

  return (
    <section className="panel finish" aria-label="Finishing">
      <h2>Finishing</h2>
      <p className="muted">One-off edits of the current layout. Each is one undo step; run it again after changing the layout.</p>

      <div className="row">
        <button
          type="button"
          disabled={!hasItems}
          title="Remove the recess, plug or corner stops from the base of every item standing on the game box floor."
          onClick={() =>
            setMessage(describe(flatBases(), (n) => `Flat base on ${plural(n, 'item')}.`, 'Every item on the floor already has a flat base.'))
          }
        >
          Flat bases on the floor
        </button>
      </div>

      <h3>Flatten top</h3>
      <p className="muted">
        Raises the top item of every stack to this height and removes its lip, so the game board lies flat on the insert.
      </p>
      <div className="grid2">
        <NumberField label="Height" unit="mm" min={0.1} step={0.5} value={target} onChange={setHeight} />
        <label className="field" title="How the extra height is added.">
          <span className="field-label">Add height by</span>
          <span className="field-input">
            <select value={mode} onChange={(e) => setMode(e.target.value as RaiseMode)}>
              <option value="type">Per type</option>
              <option value="walls">Taller walls</option>
            </select>
          </span>
        </label>
      </div>
      <p className="muted">
        {mode === 'type'
          ? 'Item and flat card trays get taller walls, standing card trays a raised floor (as far as the cards allow), spacers and platforms grow.'
          : 'Every tray gets taller walls; standing cards stick out less. Spacers and platforms grow.'}
      </p>
      <div className="row">
        <button
          type="button"
          disabled={!hasItems}
          onClick={() =>
            setMessage(describe(flatten(target, mode), (n) => `Flattened ${plural(n, 'item')} to ${target} mm.`, `The top is already flat at ${target} mm.`))
          }
        >
          Flatten top
        </button>
      </div>
      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
