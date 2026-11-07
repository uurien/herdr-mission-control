import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSessionLinks } from '../mods/mission-control/codex-session-linker.js';
const candidate=(sessionId,title,cwd='/repo',extra={})=>({sessionId,title,cwd,parentSessionId:null,lastActiveAt:10000,...extra});
const agent=(terminal,title,cwd='/repo',extra={})=>({terminal,title,cwd,createdAt:9000,...extra});

test('matches session names despite terminal project decoration and shared working directories',()=>{
  const result=resolveSessionLinks({agents:[agent('t1','Consultar skills y tools cargadas | repo'),agent('t2','Arranca dos agentes | repo')],
    candidates:[candidate('root1','Consultar skills y tools cargadas'),candidate('root2','Arranca dos agentes')],now:10000});
  assert.deepEqual(result.associations.map(r=>[r.terminal,r.sessionId]),[['t1','root1'],['t2','root2']]);
  assert.equal(result.associations[0].method,'title_and_directory');
});

test('uses directory to resolve identical session names across projects',()=>{
  const result=resolveSessionLinks({agents:[agent('t1','Build the dashboard')],
    candidates:[candidate('one','Build the dashboard','/other'),candidate('two','Build the dashboard','/repo')],now:10000});
  assert.equal(result.associations[0].sessionId,'two');
});

test('generic terminal names can match a unique project session or a unique recent active record',()=>{
  const result=resolveSessionLinks({agents:[agent('t1','codex','/only'),agent('t2','Codex','/busy')],
    candidates:[candidate('only','Real session title','/only'),candidate('old','Old task','/busy',{lastActiveAt:1000}),candidate('active','New task','/busy')],now:10000});
  assert.deepEqual(result.associations.map(r=>r.sessionId),['only','active']);
  assert.equal(result.associations[1].method,'directory_and_activity');
});

test('ambiguous matches and competing terminals do not reuse one session',()=>{
  const tied=resolveSessionLinks({agents:[agent('t1','Same specific task')],
    candidates:[candidate('one','Same specific task'),candidate('two','Same specific task')],now:10000});
  assert.equal(tied.associations.length,0);assert.equal(tied.issues[0].reason,'ambiguous');
  const competition=resolveSessionLinks({agents:[agent('t1','Same specific task'),agent('t2','Same specific task')],
    candidates:[candidate('one','Same specific task')],now:10000});
  assert.equal(competition.associations.length,0);
});

test('explicit manual associations reserve sessions and internal children are not mistaken for roots',()=>{
  const result=resolveSessionLinks({agents:[agent('t1','Named root task')],reserved:['manual'],
    candidates:[candidate('manual','Named root task'),candidate('child','Named root task','/repo',{parentSessionId:'parent'})],now:10000});
  assert.equal(result.associations.length,0);
});

test('contradictory names do not fall back to an unrelated session simply because the folder matches',()=>{
  const result=resolveSessionLinks({agents:[agent('t1','Different named work')],
    candidates:[candidate('old','A completely different task')],now:10000});
  assert.equal(result.associations.length,0);
});

test('a distinctive truncated title can match uniquely with directory confirmation',()=>{
  const result=resolveSessionLinks({agents:[agent('t1','Implement automatic session… | repo')],
    candidates:[candidate('root','Implement automatic session association')],now:10000});
  assert.equal(result.associations[0].sessionId,'root');
});

test('a generic Codex title with project decoration still permits context matching',()=>{
  const result=resolveSessionLinks({agents:[agent('t1','Codex | repo')],candidates:[candidate('root','Human session name')],now:10000});
  assert.equal(result.associations[0]?.sessionId,'root');
});
