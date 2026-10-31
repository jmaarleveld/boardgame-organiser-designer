import { listBoxTypes } from '../boxes/registry';
import { useStore } from '../state/store';
import { BOX_TYPE_MIME } from './dnd';

export function Palette() {
  const addItem = useStore((s) => s.addItem);
  const types = listBoxTypes();
  return (
    <section className="panel palette" aria-label="Box types">
      <h2>Add box</h2>
      {types.length === 0 && <p className="muted">No box types registered.</p>}
      <ul>
        {types.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className="palette-item"
              draggable
              title="Click to add, or drag onto the top view"
              onClick={() => addItem(t.id)}
              onDragStart={(e) => {
                e.dataTransfer.setData(BOX_TYPE_MIME, t.id);
                e.dataTransfer.setData('text/plain', t.name);
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <span className="palette-name">{t.name}</span>
              <span className="palette-desc">{t.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
