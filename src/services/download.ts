export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadArrayBuffer(buf: ArrayBuffer, fileName: string, mime = 'model/stl'): void {
  downloadBlob(new Blob([buf], { type: mime }), fileName);
}

/** Turn a free-form name into a safe file name stem. */
export function safeFileName(name: string, fallback = 'insert'): string {
  const s = name.trim().replace(/[^\w\- .]+/g, '_').replace(/\s+/g, '-');
  return s || fallback;
}
