import { watch } from 'node:fs';
import { opendir, stat } from 'node:fs/promises';
import path from 'node:path';

async function sessionFiles(dir, out = []) {
  for await (const entry of await opendir(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await sessionFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
    if (out.length > 4096) throw { code: 'watch_limit' };
  }
  return out;
}

/** Bounded long-poll: macOS uses kqueue for files, FSEvents for recursive directories.
 * Each invocation releases all handles on change, timeout, failure or cancellation. */
export async function waitForSessionChanges({ home, baseline = null, timeoutMs = 20000, signal, onReady, watchFile = watch }) {
  const root = path.join(home, 'sessions');
  const files = await sessionFiles(root);
  try {
    const index = path.join(home, 'session_index.jsonl');
    if ((await stat(index)).isFile()) files.push(index);
  } catch { /* Session names may not have an index yet. */ }
  return new Promise((resolve, reject) => {
    const handles = [];
    let timer = null; let done = false;
    const finish = (result, error = null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      for (const handle of handles) handle.close();
      if (error) reject({ code: 'watch_unavailable' }); else resolve(result);
    };
    const changed = () => finish({ changed: true });
    const aborted = () => finish({ changed: false, cancelled: true });
    try {
      // Directory events discover new descendants. File watches catch append-only writers.
      for (const file of [root, ...files]) {
        const handle = watchFile(file, { recursive: file === root }, changed);
        handle.on('error', error => finish(null, error));
        handles.push(handle);
      }
      if (signal?.aborted) { aborted(); return; }
      signal?.addEventListener('abort', aborted, { once: true });
      timer = setTimeout(() => finish({ changed: false }), Math.max(1, Math.min(timeoutMs, 20000)));
      (async () => {
        if (baseline) {
          if (files.length !== Object.keys(baseline).length) { changed(); return; }
          for (const file of files) {
            if (done) return;
            const info = await stat(file); const before = baseline[file];
            if (!before || info.ino !== before.ino || info.size !== before.size || info.mtimeMs !== before.mtime) {
              changed(); return;
            }
          }
        }
        if (!done) await onReady?.();
      })().catch(error => finish(null, error));
    } catch (error) { finish(null, error); }
  });
}
