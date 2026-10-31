/** Tiny tolerant XML parser: elements, attributes, text. Enough for BGG responses. */
export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function parseTag(body: string): { name: string; attrs: Record<string, string> } {
  let i = 0;
  const n = body.length;
  while (i < n && !/\s/.test(body[i])) i++;
  const name = body.slice(0, i);
  const attrs: Record<string, string> = {};
  while (i < n) {
    while (i < n && /\s/.test(body[i])) i++;
    const start = i;
    while (i < n && body[i] !== '=' && !/\s/.test(body[i])) i++;
    const key = body.slice(start, i);
    while (i < n && /\s/.test(body[i])) i++;
    if (!key) break;
    if (body[i] !== '=') { attrs[key] = ''; continue; }
    i++;
    while (i < n && /\s/.test(body[i])) i++;
    const q = body[i];
    if (q === '"' || q === "'") {
      const end = body.indexOf(q, i + 1);
      const stop = end < 0 ? n : end;
      attrs[key] = decodeEntities(body.slice(i + 1, stop));
      i = stop + 1;
    } else {
      const s2 = i;
      while (i < n && !/\s/.test(body[i])) i++;
      attrs[key] = decodeEntities(body.slice(s2, i));
    }
  }
  return { name, attrs };
}

/** Parse an XML string; returns a synthetic root whose children are the top-level elements. */
export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt < 0) { top.text += decodeEntities(src.slice(i)); break; }
    if (lt > i) top.text += decodeEntities(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      i = e < 0 ? src.length : e + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9);
      top.text += src.slice(lt + 9, e < 0 ? src.length : e);
      i = e < 0 ? src.length : e + 3;
    } else {
      // find closing '>' respecting quotes
      let j = lt + 1;
      let q = '';
      while (j < src.length && (q || src[j] !== '>')) {
        if (q) { if (src[j] === q) q = ''; } else if (src[j] === '"' || src[j] === "'") q = src[j];
        j++;
      }
      let body = src.slice(lt + 1, j);
      i = j + 1;
      if (body[0] === '?' || body[0] === '!') continue;
      if (body[0] === '/') {
        const name = body.slice(1).trim();
        const idx = stack.map((s) => s.name).lastIndexOf(name);
        if (idx > 0) stack.length = idx;
        continue;
      }
      const selfClose = body.endsWith('/');
      if (selfClose) body = body.slice(0, -1);
      const { name, attrs } = parseTag(body.trim());
      const node: XmlNode = { name, attrs, children: [], text: '' };
      top.children.push(node);
      if (!selfClose) stack.push(node);
    }
  }
  return root;
}

export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => c.name === name);
}
