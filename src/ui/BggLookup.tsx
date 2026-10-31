import { useEffect, useRef, useState } from 'react';
import type { BggBoxVersion, BggSearchResult } from '../services/contracts';
import { useServices } from '../integration';
import { useStore } from '../state/store';
import { NumberField } from './NumberField';

const f1 = (v: number | undefined) => (v === undefined ? '?' : (Math.round(v * 10) / 10).toString());

/**
 * BoardGameGeek lookup: search → pick game → pick version → apply (outer
 * dimensions minus a cardboard deduction per side). Disabled without a BGG client.
 */
export function BggLookup() {
  const { bgg } = useServices();
  const setBoxSize = useStore((s) => s.setBoxSize);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BggSearchResult[] | null>(null);
  const [versions, setVersions] = useState<BggBoxVersion[] | null>(null);
  const [game, setGame] = useState<BggSearchResult | null>(null);
  const [deduction, setDeduction] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!bgg) {
    return (
      <button type="button" disabled title="BoardGameGeek lookup is not available">
        Fetch from BoardGameGeek
      </button>
    );
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Fetch from BoardGameGeek
      </button>
    );
  }

  const withAbort = async <T,>(fn: (s: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError(null);
    try {
      return await fn(ac.signal);
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      if (abortRef.current === ac) setBusy(false);
    }
  };

  const search = async () => {
    if (!query.trim()) return;
    setGame(null);
    setVersions(null);
    const r = await withAbort((s) => bgg.search(query.trim(), s));
    if (r) setResults(r);
  };

  const pick = async (g: BggSearchResult) => {
    setGame(g);
    const v = await withAbort((s) => bgg.versions(g.id, s));
    if (v) setVersions(v);
  };

  const apply = (v: BggBoxVersion) => {
    const d = 2 * deduction;
    setBoxSize({
      ...(v.widthMm ? { width: Math.round((v.widthMm - d) * 10) / 10 } : {}),
      ...(v.depthMm ? { depth: Math.round((v.depthMm - d) * 10) / 10 } : {}),
      ...(v.heightMm ? { height: Math.round((v.heightMm - d) * 10) / 10 } : {}),
    });
    setOpen(false);
  };

  return (
    <div className="bgg">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          type="search"
          placeholder="Game name"
          aria-label="BoardGameGeek search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          Search
        </button>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close BoardGameGeek lookup">
          ×
        </button>
      </form>
      <NumberField
        label="Cardboard per side"
        unit="mm"
        min={0}
        step={0.5}
        value={deduction}
        onChange={setDeduction}
        title="Subtracted twice from each outer dimension"
      />
      {busy && <p className="muted">Loading…</p>}
      {error && <p className="error-text">{error}</p>}
      {!game && results && (
        <ul className="bgg-list">
          {results.length === 0 && <li className="muted">No results.</li>}
          {results.slice(0, 30).map((r) => (
            <li key={r.id}>
              <button type="button" className="link" onClick={() => void pick(r)}>
                {r.name}
                {r.yearPublished ? ` (${r.yearPublished})` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
      {game && versions && (
        <>
          <p className="muted">
            {game.name} —{' '}
            <button type="button" className="link" onClick={() => setGame(null)}>
              back
            </button>
          </p>
          <ul className="bgg-list">
            {versions.length === 0 && <li className="muted">No versions with dimensions.</li>}
            {versions.map((v) => {
              const has = v.widthMm || v.depthMm || v.heightMm;
              return (
                <li key={v.versionId}>
                  <button type="button" className="link" disabled={!has} onClick={() => apply(v)}>
                    {v.name}: {f1(v.widthMm)} × {f1(v.depthMm)} × {f1(v.heightMm)} mm
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
