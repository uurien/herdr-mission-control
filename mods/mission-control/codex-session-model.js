import path from 'node:path';
import { wrappedExec, skillReadPaths, unwrapResult, completeRead } from './codex-read-evidence.js';

export function createSessionState() {
  return { version: 1, identity: null, cwd: null, boundary: null, attribution: true,
    partial: false, diagnostics: [], declared: {}, used: {}, skills: {}, pending: {},
    processes: {}, seen: {}, relations: {}, status: 'unknown', statusAt: null, line: 0 };
}
const baseName = name => String(name || '').split('.').at(-1);
const parseArgs = raw => { try { return typeof raw === 'string' ? JSON.parse(raw) : raw || {}; } catch { return {}; } };
const mark = (s, code) => { s.partial = true; if (!s.diagnostics.includes(code)) s.diagnostics.push(code); };

function observation(map, key, at, evidence, extra = {}) {
  const old = map[key];
  map[key] = old ? { ...old, count: old.count + 1, lastObservedAt: at } :
    { ...extra, count: 1, firstObservedAt: at, lastObservedAt: at, evidence };
}
function declare(s, tools, prefix, at, evidence) {
  for (const tool of tools ?? []) {
    if (!tool || typeof tool !== 'object') continue;
    const name = tool.name || tool.function?.name;
    if (!name) continue;
    const full = prefix ? `${prefix}.${name}` : name;
    if (tool.type === 'namespace') declare(s, tool.tools, full, at, evidence);
    else observation(s.declared, full, at, evidence, { name: full });
  }
}
function finish(s, candidate, result, at, evidence) {
  if (!candidate || !result) return;
  if (candidate.kind === 'spawn') {
    const id = result.agent_id || result.id;
    if (typeof id === 'string' && !result.error) s.relations[id] = {
      parentSessionId: s.identity.id, childSessionId: id, evidence, name: candidate.name || null,
    };
    return;
  }
  if (candidate.kind !== 'read') return;
  if (result.cell_id != null) { s.processes[`cell:${result.cell_id}`] = candidate; return; }
  if (result.session_id != null && result.exit_code == null) {
    s.processes[`process:${result.session_id}`] = { ...candidate, hadPartialOutput: candidate.hadPartialOutput || Boolean(result.output) }; return;
  }
  // A split output cannot be proven complete from its final chunk alone.
  if (candidate.hadPartialOutput || !completeRead(result, candidate.maxTokens)) return;
  for (const file of candidate.paths) observation(s.skills, file, at, evidence, {
    path: file, name: path.basename(path.dirname(file)),
  });
}

export function consumeSessionEvent(s, row, evidence = null) {
  const line = s.line++;
  const p = row?.payload;
  if (!p || typeof p !== 'object') return;
  const at = row.timestamp ?? null;
  evidence ??= `line:${line + 1}`;
  if (row.type === 'session_meta') {
    // Later session_meta records can be copied from the parent. Only the first is identity.
    if (s.identity) return;
    const id = p.id;
    if (typeof id !== 'string' || !id) { mark(s, 'unsupported_identity'); return; }
    const spawn = p.source?.subagent?.thread_spawn;
    const parent = p.parent_thread_id || spawn?.parent_thread_id || null;
    s.identity = { id, sharedSessionId: p.session_id || id, parentSessionId: parent,
      name: p.agent_nickname || spawn?.agent_nickname || p.agent_path || spawn?.agent_path || null,
      role: spawn?.agent_role || null, createdAt: p.timestamp || at, cwd: p.cwd || null };
    s.cwd = p.cwd || null;
    s.boundary = Number.isSafeInteger(p.subagent_history_start_ordinal) ? p.subagent_history_start_ordinal : null;
    s.attribution = !parent || s.boundary != null;
    if (!s.attribution) mark(s, 'inheritance_boundary_unknown');
    if (parent) s.relations[id] = { parentSessionId: parent, childSessionId: id, evidence };
    if (s.attribution && s.boundary == null) declare(s, p.dynamic_tools, '', at, evidence);
    return;
  }
  if (!s.identity) { mark(s, 'missing_identity'); return; }
  if (s.boundary != null && (!Number.isSafeInteger(row.ordinal) || row.ordinal < s.boundary)) return;
  if (!s.attribution) return;
  if (row.type === 'compacted') { mark(s, 'compacted_history'); return; }
  if (row.type === 'turn_context') { s.cwd = p.cwd || s.cwd; return; }
  if (row.type === 'event_msg') {
    const status = { task_started: 'working', task_complete: 'done', turn_aborted: 'unknown' }[p.type];
    if (status) { s.status = status; s.statusAt = at; }
    return;
  }
  if (row.type !== 'response_item') return;
  if (p.type === 'additional_tools') { declare(s, p.tools, '', at, evidence); return; }
  if (p.type === 'compaction') { mark(s, 'compacted_history'); return; }
  if (p.type === 'function_call' || p.type === 'custom_tool_call') {
    if (!p.call_id || s.seen[p.call_id]) return;
    s.seen[p.call_id] = true;
    const name = p.namespace ? `${p.namespace}.${p.name}` : String(p.name || 'unknown');
    observation(s.used, name, at, evidence, { name });
    let inner = { name: baseName(name), args: parseArgs(p.arguments ?? p.input) };
    if (inner.name === 'exec') inner = wrappedExec(p.input ?? p.arguments);
    if (!inner) return;
    const { args } = inner;
    if (inner.name === 'exec_command') {
      const cwd = args.workdir == null ? s.cwd :
        typeof args.workdir === 'string' && path.isAbsolute(args.workdir) ? args.workdir : null;
      const paths = skillReadPaths(args.cmd, cwd);
      if (paths.length) s.pending[p.call_id] = { kind: 'read', paths, maxTokens: args.max_output_tokens };
    } else if (inner.name === 'write_stdin' && !args.chars) {
      const key = `process:${args.session_id}`;
      if (s.processes[key]) { s.pending[p.call_id] = s.processes[key]; delete s.processes[key]; }
    } else if (inner.name === 'wait') {
      const key = `cell:${args.cell_id}`;
      if (s.processes[key]) { s.pending[p.call_id] = s.processes[key]; delete s.processes[key]; }
    } else if (inner.name === 'spawn_agent') {
      s.pending[p.call_id] = { kind: 'spawn', name: args.task_name || null };
    }
    return;
  }
  if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
    const candidate = s.pending[p.call_id];
    delete s.pending[p.call_id];
    finish(s, candidate, unwrapResult(p.output), at, evidence);
  }
}

export function sessionSummary(s) {
  return { sessionId: s.identity?.id || null, ...s.identity,
    coverage: s.partial ? 'partial' : 'complete', diagnostics: s.diagnostics,
    tools: { declared: Object.values(s.declared), used: Object.values(s.used) },
    skills: Object.values(s.skills), relations: Object.values(s.relations),
    observedStatus: s.status, statusObservedAt: s.statusAt };
}
export function analyzeCodexSession(events) {
  const state = createSessionState();
  for (const row of events) consumeSessionEvent(state, row);
  return sessionSummary(state);
}
