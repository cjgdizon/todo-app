/** Saves text as a file through the browser's download, without involving a server. */
export function downloadFile(fileName: string, mimeType: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A byte order mark makes Excel read a CSV as UTF-8 instead of guessing a legacy code page. */
export const UTF8_BOM = String.fromCharCode(0xfeff);
