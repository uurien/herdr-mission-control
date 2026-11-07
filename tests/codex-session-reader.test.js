import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readSnapshot, createReaderCache } from '../mods/mission-control/codex-session-reader.mjs';
const meta = (id, extra = {}) => ({ ordinal: 0, type: 'session_meta', timestamp: '2026-11-07T10:00:00Z', payload: { id, session_id: 'family', cwd: '/same', ...extra } });
const row = (type, payload, ordinal = 1) => ({ type, payload, ordinal, timestamp: '2026-11-07T10:00:01Z' });
const lines = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n';
async function fixture(t) {
  const home = await mkdtemp(path.join(tmpdir(), 'codex-reader-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(path.join(home, 'sessions/2026/11'), { recursive: true });
  return { home, file: name => path.join(home, 'sessions/2026/11', name + '.jsonl') };
}

test('indexes first thread identity, discovers descendants and keeps roots isolated', async t => {
  const { home, file } = await fixture(t);
  await writeFile(file('root'), lines([meta('root')]));
  await writeFile(file('child'), lines([meta('child', { parent_thread_id: 'root', subagent_history_start_ordinal: 1 }), meta('root')]));
  await writeFile(file('grand'), lines([meta('grand', { source: { subagent: { thread_spawn: { parent_thread_id: 'child' } } }, subagent_history_start_ordinal: 1 })]));
  await writeFile(file('other'), lines([meta('other')]));
  const snapshot = await readSnapshot({ home, roots: ['root'], cache: createReaderCache() });
  assert.deepEqual(snapshot.sessions.map(s => s.sessionId).sort(), ['child', 'grand', 'root']);
  assert.equal(snapshot.candidates.length, 4);
  assert.ok(snapshot.relations.some(r => r.childSessionId === 'child' && r.parentSessionId === 'root'));
});

test('reads appended complete lines incrementally, then completes an unfinished final line', async t => {
  const { home, file } = await fixture(t); const cache = createReaderCache();
  const call = row('response_item', { type: 'function_call', call_id: 'a', name: 'exec_command', arguments: JSON.stringify({ cmd: 'cat /good/SKILL.md' }) });
  const result = JSON.stringify(row('response_item', { type: 'function_call_output', call_id: 'a', output: JSON.stringify({ exit_code: 0, output: 'PRIVATE SKILL CONTENT' }) }, 2));
  await writeFile(file('root'), lines([meta('root'), call]) + result.slice(0, 50));
  const first = await readSnapshot({ home, roots: ['root'], cache });
  assert.equal(first.sessions[0].skills.length, 0);
  assert.equal(first.sessions[0].coverage, 'partial');
  await appendFile(file('root'), result.slice(50) + '\n');
  const second = await readSnapshot({ home, roots: ['root'], cache });
  assert.equal(second.sessions[0].skills.length, 1);
  assert.equal(second.sessions[0].tools.used[0].count, 1);
  assert.equal(second.sessions[0].coverage, 'complete');
  assert.ok(second.stats.bytesRead < (await (await import('node:fs/promises')).stat(file('root'))).size);
});

test('cache and stdout data contain no prompts or skill content', async t => {
  const { home, file } = await fixture(t); const cache = createReaderCache();
  await writeFile(file('root'), lines([meta('root'), row('response_item', { type: 'message', content: 'SECRET PROMPT' })]));
  const snapshot = await readSnapshot({ home, roots: ['root'], cache });
  assert.ok(!JSON.stringify({ cache, snapshot }).includes('SECRET PROMPT'));
});

test('replacement resets cursors and ambiguity is explicit', async t => {
  const { home, file } = await fixture(t); const cache = createReaderCache();
  await writeFile(file('root'), lines([meta('root')]));
  await readSnapshot({ home, roots: ['root'], cache });
  await writeFile(file('root'), lines([meta('replacement')]));
  const changed = await readSnapshot({ home, roots: ['replacement'], cache });
  assert.equal(changed.sessions[0].sessionId, 'replacement');
  await writeFile(file('duplicate'), lines([meta('replacement')]));
  const duplicate = await readSnapshot({ home, roots: ['replacement'], cache });
  assert.equal(duplicate.sessions.length, 0);
  assert.ok(duplicate.diagnostics.includes('ambiguous'));
});

test('missing roots and missing session directory return unavailable, not empty healthy data', async t => {
  const { home } = await fixture(t);
  const snapshot = await readSnapshot({ home, roots: ['absent'], cache: createReaderCache() });
  assert.ok(snapshot.diagnostics.includes('not_found'));
  await rm(path.join(home, 'sessions'), { recursive: true });
  const missing = await readSnapshot({ home, roots: [], cache: createReaderCache() });
  assert.equal(missing.discoveryCoverage, 'unavailable');
});

test('confirmed historical children remain unavailable nodes when their logs disappear or corrupt', async t => {
  const { home, file } = await fixture(t); const cache = createReaderCache();
  await writeFile(file('root'), lines([meta('root')]));
  await writeFile(file('child'), lines([meta('child', { parent_thread_id: 'root', subagent_history_start_ordinal: 1 })]));
  await writeFile(file('broken'), lines([meta('broken', { parent_thread_id: 'root', subagent_history_start_ordinal: 1 })]));
  const initial = await readSnapshot({ home, roots: ['root'], cache });
  assert.equal(new Set(initial.relations.filter(r => r.parentSessionId === 'root').map(r => r.childSessionId)).size, 2);
  await rm(file('child'));
  await writeFile(file('broken'), 'invalid metadata\n');
  const refreshed = await readSnapshot({ home, roots: ['root'], cache });
  assert.deepEqual(refreshed.relations.map(r => r.childSessionId).sort(), ['broken', 'child']);
  assert.equal(refreshed.sessions.length, 1);
  assert.ok(refreshed.diagnostics.includes('not_found'));
  assert.ok(refreshed.diagnostics.includes('unreadable'));
  assert.notEqual(refreshed.discoveryCoverage, 'complete');
});

test('auto-links named sessions across the full index and loads their families in the first snapshot',async t=>{
  const {home,file}=await fixture(t);
  for(let i=0;i<25;i++)await writeFile(file('root'+i),lines([meta('root'+i)]));
  await writeFile(file('child'),lines([meta('child',{parent_thread_id:'root24',subagent_history_start_ordinal:1})]));
  await writeFile(path.join(home,'session_index.jsonl'),lines([
    {id:'root24',thread_name:'Old name',updated_at:'2026-01-01T00:00:00Z'},
    {id:'root24',thread_name:'Automatic session association',updated_at:'2026-11-07T00:00:00Z'},
  ]));
  const snapshot=await readSnapshot({home,agents:[{terminal:'t1',title:'Automatic session association | same',cwd:'/same',createdAt:1}],cache:createReaderCache(),page:1});
  assert.equal(snapshot.associations[0].sessionId,'root24');
  assert.deepEqual(snapshot.sessions.map(s=>s.sessionId).sort(),['child','root24']);
  assert.equal(snapshot.sessions.find(s=>s.sessionId==='root24').name,'Automatic session association');
  assert.ok(snapshot.candidates.every(s=>s.sessionId!=='root24')||snapshot.candidates.find(s=>s.sessionId==='root24').name==='Automatic session association');
});

test('spawn-confirmed children without parent metadata cannot auto-link as ordinary roots',async t=>{
  const {home,file}=await fixture(t);const cache=createReaderCache();
  await writeFile(file('root'),lines([meta('root'),
    row('response_item',{type:'function_call',call_id:'spawn',name:'spawn_agent',arguments:'{}'}),
    row('response_item',{type:'function_call_output',call_id:'spawn',output:JSON.stringify({agent_id:'child'})},2)]));
  await writeFile(file('child'),lines([meta('child')]));
  await writeFile(path.join(home,'session_index.jsonl'),lines([{id:'child',thread_name:'Review unique child',updated_at:'2026-11-07T00:00:00Z'}]));
  await readSnapshot({home,roots:['root'],cache});
  const result=await readSnapshot({home,agents:[{terminal:'t2',title:'Review unique child',cwd:'/same'}],cache});
  assert.deepEqual(result.associations.map(a=>a.sessionId),[]);
  assert.equal(result.candidates.find(c=>c.sessionId==='child').parentSessionId,'root');
});
