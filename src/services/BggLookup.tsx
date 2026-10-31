import { useEffect, useMemo, useRef, useState } from 'react';
import type { BggBoxVersion, BggClient, BggSearchResult } from './contracts';
import { createBggClient } from './bgg';

export interface BggLookupProps {
  /** Called with INNER dimensions (outer minus deductions), in mm. */
  onPick(dims: { widthMm: number; depthMm: number; heightMm: number }): void;
  /** Optional client override (defaults to createBggClient()). */
  client?: BggClient;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * BoardGameGeek lookup: search → pick game → pick version. BGG reports OUTER
 * box dimensions; a cardboard deduction per side (width/depth) and a lid/base
 * deduction (height) turn them into an inner-size estimate. Styled with the
 * shared classes from src/ui/app.css.
 */
export default function BggLookup({ onPick, client }: BggLookupProps) {
  const bgg = useMemo(() => client ?? createBggClient(), [client]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BggSearchResult[]>([]);
  const [versions, setVersions] = useState<BggBoxVersion[] | null>(null);
  const [gameName, setGameName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState(2);
  const [lid, setLid] = useState(4);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function run<T>(fn: (signal: AbortSignal) => Promise<T>, ok: (v: T) => void) {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError(null);
    try {
      const v = await fn(ac.signal);
      if (!ac.signal.aborted) ok(v);
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === ac) setBusy(false);
    }
  }

  const search = () =>
    run((s) => bgg.search(query.trim(), s), (r) => {
      setResults(r);
      setVersions(null);
      if (r.length === 0) setError('No games found.');
    });

  const pickGame = (g: BggSearchResult) =>
    run((s) => bgg.versions(g.id, s), (v) => {
      setGameName(g.name);
      setVersions(v);
    });

  const inner = (v: BggBoxVersion) =>
    v.widthMm && v.depthMm && v.heightMm
      ? {
          widthMm: Math.max(r1(v.widthMm - 2 * side), 1),
          depthMm: Math.max(r1(v.depthMm - 2 * side), 1),
          heightMm: Math.max(r1(v.heightMm - lid), 1),
        }
      : null;

  const num = (label: string, value: number, set: (n: number) => void, title: string) => (
    <label className="field" title={title}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="number"
          min={0}
          step={0.5}
          value={value}
          onChange={(e) => set(Math.max(0, Number(e.target.value) || 0))}
        />
        <span className="unit">mm</span>
      </span>
    </label>
  );

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
          value={query}
          placeholder="Game name"
          aria-label="BoardGameGeek search"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" disabled={busy || !query.trim()}>
          Search
        </button>
      </form>
      <div className="grid2">
        {num('Cardboard / side', side, setSide, 'Subtracted twice from the outer width and depth')}
        {num('Lid + base', lid, setLid, 'Subtracted once from the outer height')}
      </div>
      {busy && <p className="muted">Loading…</p>}
      {error && <p className="error-text">{error}</p>}
      {results.length > 0 && !versions && (
        <ul className="bgg-list">
          {results.slice(0, 50).map((g) => (
            <li key={g.id}>
              <button type="button" className="link" disabled={busy} onClick={() => void pickGame(g)}>
                {g.name}
                {g.yearPublished ? ` (${g.yearPublished})` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
      {versions && (
        <>
          <div className="row">
            <strong className="muted">{gameName}</strong>
            <button type="button" className="link" onClick={() => setVersions(null)}>
              back
            </button>
          </div>
          {versions.length === 0 && <p className="muted">No versions listed for this game.</p>}
          <ul className="bgg-list">
            {versions.map((v) => {
              const i = inner(v);
              return (
                <li key={v.versionId}>
                  <button type="button" className="link" disabled={!i} onClick={() => i && onPick(i)}>
                    {v.name}
                    <span className="bgg-dims">
                      {i
                        ? `outer ${r1(v.widthMm!)} × ${r1(v.depthMm!)} × ${r1(v.heightMm!)} → inner ${i.widthMm} × ${i.depthMm} × ${i.heightMm} mm`
                        : 'no complete dimensions on BGG'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="muted bgg-note">
        BGG data is community-entered and reports the outer box size; the deductions give an inner-size estimate.
      </p>
    </div>
  );
}
