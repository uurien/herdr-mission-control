import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodexSessionLoader } from '../mods/mission-control/codex-session-loader.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('file invalidation bypasses cache immediately and coalesces concurrent loads', async () => {
  let count = 0;
  const loader = createCodexSessionLoader({ execute: async () => ({ sessions: [], version: ++count }), now: () => 1 });
  const a = await loader.load(['root']);
  const b = await loader.load(['root']);
  assert.equal(a.data.version, b.data.version);
  loader.invalidate();
  await Promise.all([loader.load(['root']), loader.load(['root'])]);
  assert.equal(count, 2);
});

test('events during an in-flight read cause a second read with no fixed interval', async () => {
  const first = deferred(); let count = 0;
  const loader = createCodexSessionLoader({ execute: async () => ++count === 1 ? first.promise : { version: count } });
  const pending = loader.load(['root']);
  loader.invalidate();
  first.resolve({ version: 1 });
  const final = await pending;
  assert.equal(final.data.version, 2);
  assert.equal(count, 2);
});

test('root change during a query never publishes the old roots as the new family', async () => {
  const first = deferred(); const calls = [];
  const loader = createCodexSessionLoader({ execute: async request => {
    calls.push(request.roots); return calls.length === 1 ? first.promise : { root: request.roots[0] };
  } });
  const old = loader.load(['old']);
  const current = loader.load(['new']);
  first.resolve({ root: 'old' });
  assert.equal((await current).data.root, 'new');
  assert.equal((await old).data.root, 'new');
});

test('close suppresses results and stops further queries', async () => {
  const request = deferred(); let count = 0;
  const loader = createCodexSessionLoader({ execute: () => { count++; return request.promise; } });
  const pending = loader.load(['root']); loader.close(); request.resolve({ version: 1 });
  assert.equal((await pending).status, 'closed');
  await loader.load(['root']);
  assert.equal(count, 1);
});

test('fallback or manual invalidation retries an unavailable reader', async () => {
  let count = 0;
  const loader = createCodexSessionLoader({ execute: async () => { if (++count === 1) throw Error('private filesystem path'); return { sessions: [] }; } });
  const failed = await loader.load(['root']);
  assert.equal(failed.status, 'unavailable');
  assert.equal(failed.errorCode, 'unreadable');
  assert.ok(!JSON.stringify(failed).includes('private'));
  loader.invalidate();
  assert.equal((await loader.load(['root'])).status, 'ready');
});

test('changes to terminal title or directory invalidate an otherwise identical automatic-link query',async()=>{
  let count=0;
  const loader=createCodexSessionLoader({execute:async request=>({version:++count,title:request.agents[0].title})});
  await loader.load([],{agents:[{terminal:'t1',title:'Old title',cwd:'/repo'}]});
  const result=await loader.load([],{agents:[{terminal:'t1',title:'New title',cwd:'/repo'}]});
  assert.equal(result.status,'ready');assert.equal(result.data.title,'New title');assert.equal(count,2);
});
