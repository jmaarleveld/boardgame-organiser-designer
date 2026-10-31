import type { BggBoxVersion, BggClient, BggSearchResult } from './contracts';
import { childrenNamed, parseXml, type XmlNode } from './xml';

const INCH_MM = 25.4;
const MAX_RETRIES = 3;

function inchesToMm(v: string | undefined): number | undefined {
  const n = v === undefined ? NaN : parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * INCH_MM * 10) / 10;
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface BggOptions {
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
}

export function parseSearch(xml: string): BggSearchResult[] {
  const root = parseXml(xml);
  const items = root.children.flatMap((c) => childrenNamed(c, 'item'));
  const out: BggSearchResult[] = [];
  for (const it of items) {
    const id = parseInt(it.attrs.id ?? '', 10);
    if (!Number.isFinite(id)) continue;
    const nameNode = childrenNamed(it, 'name').find((n) => n.attrs.type === 'primary') ?? childrenNamed(it, 'name')[0];
    const year = parseInt(childrenNamed(it, 'yearpublished')[0]?.attrs.value ?? '', 10);
    out.push({ id, name: nameNode?.attrs.value ?? `#${id}`, ...(Number.isFinite(year) ? { yearPublished: year } : {}) });
  }
  return out;
}

export function parseVersions(xml: string): BggBoxVersion[] {
  const root = parseXml(xml);
  const thing = root.children.flatMap((c) => (c.name === 'item' ? [c] : childrenNamed(c, 'item')))[0];
  if (!thing) return [];
  const gameName = childrenNamed(thing, 'name').find((n) => n.attrs.type === 'primary')?.attrs.value;
  const versionsNode: XmlNode | undefined = childrenNamed(thing, 'versions')[0];
  const out: BggBoxVersion[] = [];
  for (const v of versionsNode ? childrenNamed(versionsNode, 'item') : []) {
    const versionId = parseInt(v.attrs.id ?? '', 10);
    if (!Number.isFinite(versionId)) continue;
    const vName = childrenNamed(v, 'name').find((n) => n.attrs.type === 'primary')?.attrs.value ?? '';
    const val = (tag: string) => childrenNamed(v, tag)[0]?.attrs.value;
    const label = gameName && vName ? `${gameName} - ${vName}` : vName || gameName || `Version ${versionId}`;
    const ver: BggBoxVersion = { versionId, name: label };
    const w = inchesToMm(val('width'));
    const d = inchesToMm(val('length'));
    const h = inchesToMm(val('depth'));
    if (w !== undefined) ver.widthMm = w;
    if (d !== undefined) ver.depthMm = d;
    if (h !== undefined) ver.heightMm = h;
    out.push(ver);
  }
  return out;
}

export function createBggClient(baseUrl = '/api/bgg', opts: BggOptions = {}): BggClient {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const retryDelay = opts.retryDelayMs ?? 1500;

  async function getXml(path: string, signal?: AbortSignal): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(`${baseUrl}${path}`, { signal });
      if (res.status === 429) throw new Error('BoardGameGeek rate limit reached (HTTP 429). Please wait a moment and try again.');
      if (res.status === 202) {
        if (attempt >= MAX_RETRIES) throw new Error('BoardGameGeek is still preparing the response (HTTP 202). Try again shortly.');
        await abortableDelay(retryDelay, signal);
        continue;
      }
      if (!res.ok) throw new Error(`BoardGameGeek request failed (HTTP ${res.status}).`);
      return res.text();
    }
  }

  return {
    async search(query, signal) {
      const q = query.trim();
      if (!q) return [];
      return parseSearch(await getXml(`/search?query=${encodeURIComponent(q)}&type=boardgame`, signal));
    },
    async versions(gameId, signal) {
      return parseVersions(await getXml(`/thing?id=${encodeURIComponent(String(gameId))}&versions=1`, signal));
    },
  };
}
