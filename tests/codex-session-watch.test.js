import assert from 'node:assert/strict';
import test from 'node:test';
import { open, mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { watch } from 'node:fs';
import { waitForSessionChanges } from '../mods/mission-control/codex-session-watch.mjs';
async function fixture(t) {
  const home=await mkdtemp(path.join(tmpdir(),'codex-watch-test-'));
  await mkdir(path.join(home,'sessions'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const file=path.join(home,'sessions','root.jsonl');await writeFile(file,'{}\n');
  return {home,file};
}

test('per-file watch detects appended data while the writer keeps the descriptor open', async t => {
  const {home,file}=await fixture(t);
  const writer=await open(file,'a');t.after(()=>writer.close());
  // Isolate the file event: a directory watcher may report earlier fixture creation events.
  const watchFile=(file,options,callback)=>options.recursive ? {on(){},close(){}} : watch(file,options,callback);
  const result=await waitForSessionChanges({home,timeoutMs:2000,onReady:()=>writer.write('{}\n'),watchFile});
  assert.equal(result.changed,true);
});

test('detects a snapshot-to-watch gap after arming; file replacement also invalidates', async t=>{
  const {home,file}=await fixture(t);const before=await stat(file);
  await writeFile(file,'{}\n{}\n');
  const result=await waitForSessionChanges({home,timeoutMs:2000,
    baseline:{[file]:{size:before.size,mtime:before.mtimeMs,ino:before.ino}},
    watchFile:()=>({on(){},close(){}})});
  assert.equal(result.changed,true);
});

test('timeout and cancellation close all watchers without inventing a change', async t=>{
  const {home}=await fixture(t);
  let closed=0;
  const watchFile=()=>({on(){},close(){closed++;}});
  assert.deepEqual(await waitForSessionChanges({home,timeoutMs:30,watchFile}),{changed:false});
  assert.equal(closed,2);
  const abort=new AbortController();
  const result=await waitForSessionChanges({home,timeoutMs:2000,signal:abort.signal,onReady:()=>abort.abort(),watchFile});
  assert.equal(result.cancelled,true);
});
