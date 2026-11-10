import { createReadStream } from 'node:fs';
import { open, opendir, stat, readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { SESSION_MODEL_VERSION, createSessionState, consumeSessionEvent, sessionSummary } from './codex-session-model.js';
import { waitForSessionChanges } from './codex-session-watch.mjs';
import { resolveSessionLinks } from './codex-session-linker.js';

const MAX_LINE = 16 * 1024 * 1024;
const digest = value => createHash('sha256').update(value).digest('hex');
export const createReaderCache = () => ({ version: 1, files: {}, historicalRelations: [] });
const partial = (state, code) => { state.partial = true; if (!state.diagnostics.includes(code)) state.diagnostics.push(code); };

async function filesUnder(dir, diagnostics) {
  const files = [];
  try {
    for await (const entry of await opendir(dir)) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...await filesUnder(full, diagnostics));
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(full);
    }
  } catch { diagnostics.add('unreadable'); }
  return files;
}
async function firstLine(file) {
  let pending = Buffer.alloc(0);
  for await (const chunk of createReadStream(file, { highWaterMark: 16384 })) {
    pending = Buffer.concat([pending, chunk]);
    const end = pending.indexOf(10);
    if (end !== -1) {
      const text = pending.subarray(0, end).toString('utf8');
      const row = JSON.parse(text);
      if (row.type !== 'session_meta' || typeof row.payload?.id !== 'string') throw Error('unsupported');
      return { row, hash: digest(text) };
    }
    if (pending.length > MAX_LINE) throw Error('unsupported');
  }
  throw Error('unsupported');
}
async function tailHash(file, offset) {
  if (!offset) return '';
  const handle = await open(file, 'r');
  try {
    const start = Math.max(0, offset - 4096);
    const buffer = Buffer.alloc(offset - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    return digest(buffer.subarray(0, bytesRead));
  } finally { await handle.close(); }
}
async function updateFile(file, info, entry, stats) {
  const unchanged = entry && entry.state?.version === SESSION_MODEL_VERSION &&
    entry.ino === info.ino && entry.size === info.size && entry.mtime === info.mtimeMs;
  if (unchanged) return entry;
  const first = await firstLine(file);
  if (!entry || entry.state?.version !== SESSION_MODEL_VERSION || entry.ino !== info.ino ||
      info.size < entry.offset || entry.firstHash !== first.hash ||
      entry.tailHash !== await tailHash(file, entry.offset)) {
    entry = { ino: info.ino, firstHash: first.hash, meta: first.row.payload,
      offset: 0, state: createSessionState(), tailHash: '' };
    // Do not persist base instructions or any other raw metadata.
    entry.meta = { id: first.row.payload.id,
      parent: first.row.payload.parent_thread_id || first.row.payload.source?.subagent?.thread_spawn?.parent_thread_id || null,
      name: first.row.payload.agent_nickname || first.row.payload.source?.subagent?.thread_spawn?.agent_nickname || null,
      isSubagent: Boolean(first.row.payload.source?.subagent || first.row.payload.thread_source === 'subagent'),
      cwd: first.row.payload.cwd || null, createdAt: first.row.payload.timestamp || first.row.timestamp };
  }
  let pending = Buffer.alloc(0); let position = entry.offset; let skipping = false;
  if (info.size > entry.offset) {
    for await (const chunk of createReadStream(file, { start: entry.offset, end: info.size - 1, highWaterMark: 65536 })) {
      stats.bytesRead += chunk.length;
      pending = Buffer.concat([pending, chunk]);
      let end;
      while ((end = pending.indexOf(10)) !== -1) {
        const line = pending.subarray(0, end);
        position += end + 1; pending = pending.subarray(end + 1);
        if (!skipping && line.length <= MAX_LINE) {
          try { consumeSessionEvent(entry.state, JSON.parse(line.toString('utf8')), `${file}:${entry.state.line + 1}`); }
          catch { partial(entry.state, 'invalid_event'); }
        } else partial(entry.state, 'oversize_event');
        skipping = false; entry.offset = position;
      }
      if (pending.length > MAX_LINE) {
        position += pending.length; pending = Buffer.alloc(0); skipping = true;
        partial(entry.state, 'oversize_event');
      }
    }
  }
  entry.incomplete = entry.offset < info.size;
  entry.tailHash = await tailHash(file, entry.offset);
  entry.size = info.size; entry.mtime = info.mtimeMs;
  return entry;
}

async function sessionNames(home, baseline) {
  const names = new Map();
  const file = path.join(home, 'session_index.jsonl');
  try {
    const info = await stat(file);
    baseline[file] = { ino: info.ino, size: info.size, mtime: info.mtimeMs };
    const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (typeof row.id !== 'string' || typeof row.thread_name !== 'string' || !row.thread_name.trim()) continue;
        const previous = names.get(row.id);
        if (!previous || String(row.updated_at || '') >= previous.updatedAt) {
          names.set(row.id, { title: row.thread_name, updatedAt: String(row.updated_at || '') });
        }
      } catch { /* Ignore incomplete or unsupported index records. */ }
    }
  } catch { /* Names are optional; directory/activity matching remains available. */ }
  return names;
}

export async function readSnapshot({ home, roots = [], agents = [], cache = createReaderCache(), page = 0 }) {
  const dir = path.join(home, 'sessions');
  const diagnostics = new Set();
  const stats = { bytesRead: 0 };
  const files = await filesUnder(dir, diagnostics);
  const existing = new Set(files);
  for (const file of Object.keys(cache.files)) if (!existing.has(file)) delete cache.files[file];
  const indexed = new Map();
  cache.watchBaseline = {};
  for (const file of files) {
    try {
      const info = await stat(file);
      cache.watchBaseline[file] = { ino: info.ino, size: info.size, mtime: info.mtimeMs };
      const first = cache.files[file] && cache.files[file].ino === info.ino &&
        cache.files[file].size === info.size && cache.files[file].mtime === info.mtimeMs ? null : await firstLine(file);
      // Unselected sessions only need their first record, not their conversations.
      let entry = cache.files[file];
      if (first && (!entry || entry.firstHash !== first.hash || entry.ino !== info.ino || info.size < entry.offset)) {
        const p = first.row.payload; const spawn = p.source?.subagent?.thread_spawn;
        entry = { ino: info.ino, firstHash: first.hash, offset: 0, state: createSessionState(), tailHash: '',
          meta: { id: p.id, parent: p.parent_thread_id || spawn?.parent_thread_id || null,
            name: p.agent_nickname || spawn?.agent_nickname || p.agent_path || null,
            isSubagent: Boolean(p.source?.subagent || p.thread_source === 'subagent'),
            cwd: p.cwd || null, createdAt: p.timestamp || first.row.timestamp } };
      }
      if (!entry) continue;
      cache.files[file] = entry;
      const copies = indexed.get(entry.meta.id) || [];
      copies.push({ file, info, entry }); indexed.set(entry.meta.id, copies);
    } catch { diagnostics.add('unreadable'); }
  }
  const relations = [...(cache.historicalRelations || [])];
  for (const [id, copies] of indexed) {
    if (copies.length !== 1) { diagnostics.add('ambiguous'); continue; }
    const { entry, file } = copies[0];
    if (entry.meta.parent) relations.push({ parentSessionId: entry.meta.parent, childSessionId: id, evidence: `${file}:1` });
  }
  const names = await sessionNames(home, cache.watchBaseline);
  const ancestry = new Map();
  for (const relation of relations) {
    const parents = ancestry.get(relation.childSessionId) || new Set();
    parents.add(relation.parentSessionId); ancestry.set(relation.childSessionId, parents);
  }
  const candidates = [...indexed.entries()].filter(([, copies]) => copies.length === 1)
    .map(([id, copies]) => ({ sessionId: id,
      parentSessionId: ancestry.get(id)?.size === 1 ? [...ancestry.get(id)][0] : null,
      hasParentEvidence: Boolean(ancestry.get(id)?.size || copies[0].entry.meta.isSubagent),
      title: names.get(id)?.title || null,
      name: copies[0].entry.meta.name || names.get(id)?.title || null,
      cwd: copies[0].entry.meta.cwd, createdAt: copies[0].entry.meta.createdAt,
      lastActiveAt: copies[0].info.mtimeMs }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const resolved = resolveSessionLinks({ agents, candidates, reserved: roots });
  const accepted = new Set([...roots.filter(id => typeof id === 'string'),
    ...resolved.associations.map(a => a.sessionId)]);
  const processed = new Set(); const sessions = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const rel of relations) if (accepted.has(rel.parentSessionId) && !accepted.has(rel.childSessionId)) {
      accepted.add(rel.childSessionId); changed = true;
    }
    for (const id of accepted) {
      if (processed.has(id)) continue;
      processed.add(id);
      const copies = indexed.get(id);
      if (!copies) { diagnostics.add('not_found'); continue; }
      if (copies.length !== 1) { diagnostics.add('ambiguous'); continue; }
      const { file, info } = copies[0];
      try {
        const entry = await updateFile(file, info, cache.files[file], stats);
        cache.files[file] = entry;
        const summary = sessionSummary(entry.state);
        summary.name ||= names.get(id)?.title || null;
        if (entry.incomplete) { summary.coverage = 'partial'; summary.diagnostics = [...summary.diagnostics, 'incomplete_line']; }
        sessions.push(summary);
        relations.push(...summary.relations);
        // A spawn result may identify a child before its file or metadata appears.
        for (const rel of summary.relations) if (accepted.has(rel.parentSessionId) && !accepted.has(rel.childSessionId)) {
          accepted.add(rel.childSessionId); changed = true;
        }
      } catch { diagnostics.add('unreadable'); }
    }
  }
  const pageSize = 20;
  // Relationships are historical evidence. Losing a file must not erase a known child.
  cache.historicalRelations = [...new Map(relations.map(r =>
    [JSON.stringify([r.parentSessionId, r.childSessionId]), r])).values()];
  return { watchRoot: files.length || !diagnostics.has('unreadable') ? dir : null,
    associations: resolved.associations, associationIssues: resolved.issues,
    candidates: candidates.slice(page * pageSize, (page + 1) * pageSize),
    candidatePage: page, candidatePages: Math.max(1, Math.ceil(candidates.length / pageSize)),
    sessions, relations: cache.historicalRelations.filter(r => accepted.has(r.parentSessionId) && accepted.has(r.childSessionId)),
    diagnostics: [...diagnostics], discoveryCoverage: diagnostics.has('unreadable') ? 'unavailable' :
      diagnostics.size ? 'partial' : 'complete', stats };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
  const home = process.env.CODEX_HOME || path.join(homedir(), '.codex');
  if (args[0] === 'config') {
    let watchRoot = null;
    try { if ((await stat(path.join(home, 'sessions'))).isDirectory()) watchRoot = path.join(home, 'sessions'); } catch { /* fallback retries discovery */ }
    process.stdout.write(JSON.stringify({ home, watchRoot })); return;
  }
  if (!['snapshot', 'cleanup', 'watch'].includes(args[0])) throw Error('unsupported');
  const roots = JSON.parse(option('--roots', '[]'));
  if (!Array.isArray(roots) || roots.some(id => typeof id !== 'string' || id.length > 200)) throw Error('unsupported');
  const agents = JSON.parse(option('--agents', '[]'));
  if (!Array.isArray(agents) || agents.length > 256 || agents.some(a => !a ||
      typeof a.terminal !== 'string' || a.terminal.length > 200 ||
      typeof a.title !== 'string' || a.title.length > 4096 ||
      a.cwd != null && typeof a.cwd !== 'string')) throw Error('unsupported');
  const key = option('--cache-key', 'default');
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(key)) throw Error('unsupported');
  const cacheDir = path.join(tmpdir(), `herdr-codex-${process.getuid?.() ?? 'user'}`);
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  const cachePath = path.join(cacheDir, `${key}.json`);
  if (args[0] === 'cleanup') { await rm(cachePath, { force: true }); return; }
  let cache = createReaderCache();
  try { const saved = JSON.parse(await readFile(cachePath, 'utf8')); if (saved.version === 1 && saved.files) cache = saved; } catch { /* first call or invalid cache */ }
  if (args[0] === 'watch') {
    const result = await waitForSessionChanges({ home, baseline: cache.watchBaseline || null });
    process.stdout.write(JSON.stringify(result)); return;
  }
  const page = Math.max(0, Math.floor(Number(option('--page', '0')) || 0));
  const snapshot = await readSnapshot({ home, roots, agents, cache, page });
  const nextPath = `${cachePath}.${process.pid}.tmp`;
  await writeFile(nextPath, JSON.stringify(cache), { mode: 0o600 });
  await rename(nextPath, cachePath);
  const json = JSON.stringify(snapshot);
  if (Buffer.byteLength(json) > 512 * 1024) throw Error('too_large');
  process.stdout.write(json);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    const code = ['unsupported', 'too_large'].includes(error.message) ? error.message : 'unreadable';
    process.stdout.write(JSON.stringify({ errorCode: code })); process.exitCode = 1;
  });
}
