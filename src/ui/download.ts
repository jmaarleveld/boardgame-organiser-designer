/** Trigger a browser download for a Blob (UI-local helper). */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFileName(name: string, fallback = 'insert'): string {
  const s = name.trim().replace(/[^\w\- .]+/g, '_').replace(/\s+/g, '-');
  return s || fallback;
}
