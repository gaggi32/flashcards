// Files in the web version: an export is a download (or, where the browser
// has one, a native save dialog), an import is the browser's file picker.
// The page only ever sees files the user picked.

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

/** export_file's name rule: safe characters, at most 80, ends in .json. */
export function exportName(suggested: string): string {
  const name = [...suggested].filter((c) => /[A-Za-z0-9\-_. ]/.test(c)).slice(0, 80).join('').trim() || 'flashcards';
  return name.endsWith('.json') ? name : `${name}.json`;
}

type SavePicker = (opts: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ name: string; createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;

/** Resolves to where it went, as the user would put it, or null when cancelled. */
export async function saveFile(contents: string, suggestedName: string): Promise<string | null> {
  const name = exportName(suggestedName);
  const blob = new Blob([contents], { type: 'application/json' });
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: name,
        types: [{ description: 'Flashcards export', accept: { 'application/json': ['.json'] } }],
      });
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return handle.name;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      // Not allowed here (no user gesture left, a sandbox): download instead.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return `${name} in your downloads`;
}

/**
 * The browser's file picker. Must be called straight from the click (no
 * await before it), or the browser refuses to open it. Resolves to the file's
 * text, or null when cancelled.
 */
export function pickFile(kind: 'json' | 'text'): Promise<string | null> {
  return new Promise<string | null>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = kind === 'json' ? '.json,application/json' : '.txt,.csv,.tsv,.md,text/plain,text/csv';
    input.style.display = 'none';
    let done = false;
    const finish = () => {
      done = true;
      input.remove();
      window.removeEventListener('focus', onFocus);
    };
    // Older browsers send no "cancel": a picker closed without a file is
    // noticed when the page gets focus back and no change follows.
    const onFocus = () =>
      setTimeout(() => {
        if (!done && !input.files?.length) {
          finish();
          resolve(null);
        }
      }, 1000);
    input.addEventListener('cancel', () => {
      finish();
      resolve(null);
    });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      finish();
      if (!file) return resolve(null);
      if (file.size > MAX_IMPORT_BYTES) return reject('That file is over 50 MB.');
      file.text().then(resolve, () => reject('Could not read that file.'));
    });
    document.body.append(input);
    window.addEventListener('focus', onFocus);
    input.click();
  });
}
