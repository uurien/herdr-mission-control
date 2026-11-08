import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeCodexSession, createSessionState, consumeSessionEvent, sessionSummary } from '../mods/mission-control/codex-session-model.js';

const time = '2026-11-07T10:00:00.000Z';
export function event(type, payload, ordinal) { return { timestamp: time, type, payload, ...(ordinal == null ? {} : { ordinal }) }; }
export function meta(id = 'root', extra = {}) { return event('session_meta', { id, session_id: 'family', cwd: '/repo', timestamp: time, ...extra }, 0); }
export function call(id, name, args, ordinal) { return event('response_item', { type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) }, ordinal); }
export function output(id, result, ordinal) { return event('response_item', { type: 'function_call_output', call_id: id, output: JSON.stringify(result) }, ordinal); }
const ok = text => ({ exit_code: 0, output: text, original_token_count: 6 });

test('declarations are separate from usage and retain namespaces', () => {
  const result = analyzeCodexSession([meta(), event('response_item', { type: 'additional_tools', tools: [
    { type: 'namespace', name: 'functions', tools: [{ type: 'function', name: 'exec_command' }] },
  ] }), call('a', 'exec_command', { cmd: 'pwd' }), call('a', 'exec_command', { cmd: 'pwd' }), call('b', 'exec_command', { cmd: 'pwd' })]);
  assert.equal(result.sessionId, 'root');
  assert.equal(result.sharedSessionId, 'family');
  assert.deepEqual(result.tools.declared.map(t => t.name), ['functions.exec_command']);
  assert.equal(result.tools.used[0].count, 2);
  assert.equal(result.skills.length, 0);
});

test('only a successful complete literal SKILL.md read confirms loading', () => {
  const result = analyzeCodexSession([meta(),
    call('a', 'exec_command', { cmd: 'cat /skills/good/SKILL.md' }), output('a', ok('whole skill')),
    call('b', 'exec_command', { cmd: 'head /skills/partial/SKILL.md' }), output('b', ok('partial')),
    call('c', 'exec_command', { cmd: 'cat /skills/failed/SKILL.md' }), output('c', { exit_code: 1, output: 'error' }),
    call('d', 'exec_command', { cmd: 'cat /skills/truncated/SKILL.md' }), output('d', ok('Warning: truncated output\n...')),
    call('e', 'exec_command', { cmd: 'cat /skills/pending/SKILL.md' }),
    event('response_item', { type: 'message', content: [{ text: 'SKILL.md /skills/catalog/SKILL.md' }] }),
  ]);
  assert.deepEqual(result.skills.map(s => s.path), ['/skills/good/SKILL.md']);
  assert.equal(result.skills[0].name, 'good');
  assert.ok(result.skills[0].evidence);
});

test('deduplicates by resolved path, never by display name; rejects unsafe shell syntax', () => {
  const result = analyzeCodexSession([meta(),
    ...['cat ../a/SKILL.md', 'cat /a/SKILL.md', 'cat /b/a/SKILL.md', 'cat "$SKILL"', 'cat /c/SKILL.md | head', 'cat /d/SKILL.md && echo done']
      .flatMap((cmd, i) => [call(String(i), 'exec_command', { cmd }), output(String(i), ok('skill'))]),
  ]);
  assert.deepEqual(result.skills.map(s => s.path), ['/a/SKILL.md', '/b/a/SKILL.md']);
  assert.equal(result.skills[0].count, 2);
});

test('accepts only a single statically verifiable exec wrapper; never evaluates JavaScript', () => {
  const code = 'text(await tools.exec_command({cmd:"cat /skills/wrapped/SKILL.md",max_output_tokens:3000}));';
  const result = analyzeCodexSession([meta(),
    event('response_item', { type: 'custom_tool_call', call_id: 'a', name: 'exec', input: code }),
    event('response_item', { type: 'custom_tool_call_output', call_id: 'a', output: [
      { type: 'text', text: 'Script completed\nWall time 0.1 seconds' },
      { type: 'text', text: JSON.stringify(ok('full skill')) },
    ] }),
    event('response_item', { type: 'custom_tool_call', call_id: 'b', name: 'exec', input: 'if (false) { ' + code + ' }' }),
    output('b', ok('nothing')),
  ]);
  assert.deepEqual(result.skills.map(s => s.path), ['/skills/wrapped/SKILL.md']);
  assert.equal(result.tools.used.find(t => t.name === 'exec').count, 2);
});

test('uses thread id and ordinal boundary; inherited events cannot load skills for a child', () => {
  const result = analyzeCodexSession([
    meta('child', { parent_thread_id: 'root', subagent_history_start_ordinal: 5 }),
    meta('root'), call('same', 'exec_command', { cmd: 'cat /parent/SKILL.md' }, 2), output('same', ok('parent'), 3),
    call('own', 'exec_command', { cmd: 'cat /child/SKILL.md' }, 5), output('own', ok('child'), 6),
  ]);
  assert.equal(result.sessionId, 'child');
  assert.equal(result.parentSessionId, 'root');
  assert.deepEqual(result.skills.map(s => s.path), ['/child/SKILL.md']);
  assert.equal(result.tools.used[0].count, 1);
});

test('child inheritance without a provable boundary is explicitly partial', () => {
  const result = analyzeCodexSession([meta('child', { parent_thread_id: 'root', forked_from_id: 'root' }),
    call('a', 'exec_command', { cmd: 'cat /parent/SKILL.md' }), output('a', ok('parent'))]);
  assert.equal(result.coverage, 'partial');
  assert.equal(result.skills.length, 0);
});

test('correlates pending process output and successful spawn results; failed spawns produce no child', () => {
  const result = analyzeCodexSession([meta(),
    call('read', 'exec_command', { cmd: 'cat /skills/delayed/SKILL.md' }),
    output('read', { session_id: 42, output: '' }),
    call('poll', 'write_stdin', { session_id: 42, chars: '' }), output('poll', ok('full skill')),
    call('spawn', 'spawn_agent', { task_name: 'review' }), output('spawn', { agent_id: 'child' }),
    call('bad', 'spawn_agent', { task_name: 'failed' }), output('bad', { error: 'failed' }),
  ]);
  assert.deepEqual(result.skills.map(s => s.path), ['/skills/delayed/SKILL.md']);
  assert.deepEqual(result.relations.map(r => r.childSessionId), ['child']);
});

test('incremental state retains only metadata and pending read evidence, never prompts or output', () => {
  const state = createSessionState();
  for (const row of [meta(), call('a', 'exec_command', { cmd: 'cat /skills/good/SKILL.md' }), output('a', ok('SECRET SKILL CONTENT')),
    call('prompt', 'spawn_agent', { message: 'SECRET USER PROMPT' })]) consumeSessionEvent(state, row, 'file:1');
  const serialized = JSON.stringify(state);
  assert.ok(!serialized.includes('SECRET'));
  assert.equal(sessionSummary(state).skills.length, 1);
});

test('confirms consecutive full cat reads only when the entire chain succeeds without truncation', () => {
  const result = analyzeCodexSession([meta(),
    call('a', 'exec_command', { cmd: 'cat /first/SKILL.md && cat "/second skill/SKILL.md"' }), output('a', ok('both complete')),
    call('b', 'exec_command', { cmd: 'cat /bad/SKILL.md && echo done' }), output('b', ok('ambiguous')),
    call('c', 'exec_command', { cmd: 'cat /failed/SKILL.md && cat /missing/SKILL.md' }), output('c', { exit_code: 1, output: 'first only' }),
  ]);
  assert.deepEqual(result.skills.map(s => s.path), ['/first/SKILL.md', '/second skill/SKILL.md']);
});

test('relative reads use the actual execution workdir, not the thread cwd', () => {
  const result = analyzeCodexSession([meta(),
    call('a', 'exec_command', { cmd: 'cat SKILL.md', workdir: '/actual' }), output('a', ok('full skill')),
    call('b', 'exec_command', { cmd: 'cat SKILL.md', workdir: 'ambiguous-relative-workdir' }), output('b', ok('unknown identity')),
  ]);
  assert.deepEqual(result.skills.map(s => s.path), ['/actual/SKILL.md']);
});

test('shell comments and tilde expansion cannot confirm fictional file paths', () => {
  const result = analyzeCodexSession([meta(),
    call('a', 'exec_command', { cmd: 'cat /actual/SKILL.md # /never-read/SKILL.md' }), output('a', ok('actual only')),
    call('b', 'exec_command', { cmd: 'cat ~/skills/SKILL.md' }), output('b', ok('expanded path unknown')),
  ]);
  assert.deepEqual(result.skills, []);
});

function mcp(id, server, tool, ordinal, extra = {}) {
  return event('event_msg', { type: 'item_completed', item: {
    type: 'McpToolCall', id, server, tool, arguments: { query: 'PRIVATE QUERY' },
    status: 'completed', result: { content: 'PRIVATE RESULT' }, ...extra,
  } }, ordinal);
}

test('counts real structured Context7 and Playwright calls inside exec wrappers', () => {
  const rows = [meta()];
  for (const [i, server, tool] of [[1, 'context7', 'resolve-library-id'], [2, 'context7', 'query-docs'], [3, 'playwright', 'browser_tabs']]) {
    rows.push(event('response_item', { type: 'custom_tool_call', call_id: `outer-${i}`, name: 'exec', input: 'text(await tools.some_tool({}));' }));
    rows.push(mcp(`exec-${i}`, server, tool));
  }
  const result = analyzeCodexSession(rows);
  assert.deepEqual(result.tools.used.filter(t => t.name !== 'exec').map(t => [t.name, t.count]), [
    ['context7.resolve-library-id', 1], ['context7.query-docs', 1], ['playwright.browser_tabs', 1],
  ]);
  assert.equal(result.tools.used.find(t => t.name === 'exec').count, 3);
  assert.equal(result.tools.declared.length, 0);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('deduplicates MCP receipts by event id and counts failed attempts', () => {
  const result = analyzeCodexSession([meta(), mcp('one', 'context7', 'query-docs'),
    mcp('one', 'context7', 'query-docs'), mcp('two', 'context7', 'query-docs', null, { status: 'failed' })]);
  assert.equal(result.tools.used[0]?.name, 'context7.query-docs');
  assert.equal(result.tools.used[0]?.count, 2);
});

test('MCP receipts respect child history boundaries and do not infer calls from source text', () => {
  const result = analyzeCodexSession([meta('child', { parent_thread_id: 'root', subagent_history_start_ordinal: 5 }),
    mcp('parent', 'context7', 'query-docs', 2), mcp('child', 'playwright', 'browser_tabs', 6),
    event('response_item', { type: 'custom_tool_call', call_id: 'code', name: 'exec', input: 'if (false) { await tools.mcp__context7__query_docs({}); }' }, 7)]);
  assert.deepEqual(result.tools.used.map(t => t.name), ['playwright.browser_tabs', 'exec']);
});

test('direct call and MCP receipt sharing an id count once in either order', () => {
  const direct = call('same', 'mcp__context7__query_docs', {});
  for (const events of [[direct, mcp('same', 'context7', 'query-docs')], [mcp('same', 'context7', 'query-docs'), direct]]) {
    const result = analyzeCodexSession([meta(), ...events]);
    assert.equal(result.tools.used.reduce((n, t) => n + t.count, 0), 1);
  }
});
