import { useEffect, useMemo, useRef, useState } from 'react';
import type { BggBoxVersion, BggClient, BggSearchResult } from './contracts';
import { createBggClient } from './bgg';
import './BggLookup.css';

export interface BggLookupProps {
  /** Called with INNER dimensions (outer minus deductions), in mm. */
  onPick(dims: { widthMm: number; depthMm: number; heightMm: number }): void;
  /** Optional client override (defaults to createBggClient()). */
  client?: BggClient;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

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
    run((s) => bgg.search(query, s), (r) => {
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

  return (
    <div className="bgg-lookup">
      <form className="bgg-row" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <input type="text" value={query} placeholder="Search BoardGameGeek…" onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" disabled={busy || !query.trim()}>Search</button>
      </form>
      <div className="bgg-row bgg-deductions">
        <label>Cardboard per side (mm)
          <input type="number" min={0} step={0.5} value={side} onChange={(e) => setSide(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label>Lid/base (mm)
          <input type="number" min={0} step={0.5} value={lid} onChange={(e) => setLid(Math.max(0, Number(e.target.value) || 0))} />
        </label>
      </div>
      {busy && <p className="bgg-note">Loading…</p>}
      {error && <p className="bgg-error">{error}</p>}
      {results.length > 0 && !versions && (
        <ul className="bgg-list">
          {results.map((g) => (
            <li key={g.id}>
              <button type="button" disabled={busy} onClick={() => void pickGame(g)}>
                {g.name}{g.yearPublished ? ` (${g.yearPublished})` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
      {versions && (
        <>
          <div className="bgg-row">
            <strong>{gameName}</strong>
            <button type="button" onClick={() => setVersions(null)}>Back</button>
          </div>
          {versions.length === 0 && <p className="bgg-note">No versions listed for this game.</p>}
          <ul className="bgg-list">
            {versions.map((v) => {
              const i = inner(v);
              return (
                <li key={v.versionId}>
                  <button type="button" disabled={!i} onClick={() => i && onPick(i)}>
                    {v.name}
                    <span className="bgg-dims">
                      {i
                        ? `Outer ${v.widthMm} x ${v.depthMm} x ${v.heightMm} mm, inner ${i.widthMm} x ${i.depthMm} x ${i.heightMm} mm`
                        : 'No complete dimensions on BGG'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="bgg-note">BGG data is community-entered and may be missing or inaccurate. BGG reports outer box size; deductions give an estimate of the inner size.</p>
    </div>
  );
}
