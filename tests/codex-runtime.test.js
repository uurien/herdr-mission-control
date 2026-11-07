import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveNodeCommand } from '../mods/mission-control/codex-runtime.js';

test('uses Node directly when the application environment can find it', async () => {
  const calls=[];
  const result=await resolveNodeCommand(async (...args)=>{calls.push(args);return {code:0,stdout:'/usr/bin/node\n'};});
  assert.equal(result,'/usr/bin/node');assert.equal(calls.length,1);
});

test('resolves an nvm Node through the user login shell when Core PATH cannot find it', async () => {
  const calls=[];
  const result=await resolveNodeCommand(async (...args)=>{
    calls.push(args);if(calls.length===1)throw Error('spawn_failed');
    return {code:0,stdout:'shell startup message\n/home/user/.nvm/versions/node/v24/bin/node\n'};
  });
  assert.equal(result,'/home/user/.nvm/versions/node/v24/bin/node');
  assert.equal(calls[1][0],'/bin/sh');
  assert.ok(!calls[1][1].join(' ').includes('SKILL.md'));
});

test('unavailable Node yields a stable error without exposing shell output', async () => {
  await assert.rejects(resolveNodeCommand(async()=>({code:127,stdout:'private startup text'})),
    error=>error.code==='node_unavailable'&&!JSON.stringify(error).includes('private'));
});
