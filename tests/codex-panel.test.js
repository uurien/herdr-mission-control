import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildSpaceSnapshot, selectAgentId } from '../mods/mission-control/herdr-model.js';
import { buildCodexFamily } from '../mods/mission-control/codex-family-model.js';
import { createCodexSessionLoader } from '../mods/mission-control/codex-session-loader.js';
import { createCodexWatchController } from '../mods/mission-control/codex-watch-controller.js';
import { resolveNodeCommand } from '../mods/mission-control/codex-runtime.js';
const source = (await readFile(new URL('../mods/mission-control/main.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
let sequence = 0;
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; }
const flush = async () => { for (let i=0;i<20;i++) await Promise.resolve(); };
function element() {
  const proxy = new Proxy({}, { get(_target,key) {
    if (key === 'when') return (condition,fn) => { if (condition) fn(proxy); return proxy; };
    return () => proxy;
  } }); return proxy;
}
async function fixture() {
  const watchers=[], fileWatchers=[], timers=[], intervals=[], commands=[];
  const store = new Map();
  const host = { spaces:[{id:'space',machine:null,tabs:[]}], agents:[{address:'t1',space:'space',app:'codex',status:'working'}],
    terminals:[{address:'t1',state:'live',created_ms:1}], machines:[{name:null,layout:'ready'}], panes:[] };
  const cx = { spawn: fn => fn(cx), sleep: async()=>{}, notify(){}, timer:{ every(ms,fn){intervals.push({ms,fn});}, after(ms,fn){timers.push({ms,fn});} } };
  globalThis.__codexPanelDeps = { View:class{}, div:element, h_flex:element, v_flex:element,
    ...Object.fromEntries(['spaces','agents','terminals','machines','panes'].map(key=>[key,()=>host[key]])),
    appHome:()=>'/installed', props:()=>({spaceId:'space'}), run(){}, theme:()=>({}),
    exec:async (_command,args) => { if (args[1] === 'watch') { const d=deferred(); fileWatchers.push(d); return d.promise; } if (args[0] === '-p') return {code:0,stdout:'/usr/bin/node\n'}; commands.push(args); return {code:0,stdout:JSON.stringify(args[1]==='config' ?
      {watchRoot:'/codex/sessions'} : {watchRoot:'/codex/sessions',sessions:[],relations:[],candidates:[],candidatePage:0,candidatePages:1,discoveryCoverage:'complete'})}; },
    watchFolder:()=>{const item=deferred();watchers.push(item);return item.promise;},
    localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},
    buildSpaceSnapshot,selectAgentId,buildCodexFamily,createCodexSessionLoader,createCodexWatchController,resolveNodeCommand,
    agentDetail:element,agentRow:element,notice:element,STATUS:{working:{label:'working',color:'working'}} };
  const bindings = Object.keys(globalThis.__codexPanelDeps).join(',');
  const code=`const {${bindings}} = globalThis.__codexPanelDeps;\n${source}\n// ${sequence++}`;
  const Panel=(await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
  const panel=new Panel();panel.init({},cx);await flush();
  return {panel,cx,watchers,fileWatchers,timers,intervals,commands,host};
}

test('actual panel arms watch, refreshes on notifications, retries a failed watch and closes', async () => {
  const {panel,cx,watchers,timers,intervals,commands}=await fixture();
  const reads=()=>commands.filter(a=>a[1]==='snapshot').length;
  assert.equal(reads(),1);assert.equal(watchers.length,1);
  watchers[0].resolve(['/codex/sessions/new.jsonl']);await flush();
  assert.equal(reads(),1);assert.equal(timers[0].ms,150);
  timers.shift().fn(cx);await flush();assert.equal(reads(),2);
  watchers[1].reject(Error('watch failed'));await flush();assert.equal(panel.watchMode,'fallback');
  for(const timer of intervals)timer.fn(cx);await flush();
  assert.equal(panel.watchMode,'events');assert.equal(reads(),3);
  await panel.close();watchers[2].resolve(['/codex/sessions/after-close.jsonl']);await flush();
  assert.equal(reads(),3);assert.equal(timers.length,0);
});

test('candidate order stays fixed while the picker is open despite live snapshots', async () => {
  const {panel,cx}=await fixture();
  const agent=panel.baseModel().agents[0];
  panel.snapshot={candidates:[{sessionId:'first'},{sessionId:'second'}],candidatePage:0,candidatePages:1};
  panel.togglePicker(agent,cx);
  panel.snapshot={candidates:[{sessionId:'new'},{sessionId:'first'},{sessionId:'second'}],candidatePage:0,candidatePages:1};
  assert.deepEqual(panel.pickerCandidates.map(s=>s.sessionId),['first','second']);
  await panel.close();
});


test('file notifications refresh even when the directory watcher stays silent', async()=>{
  const {panel,fileWatchers,commands}=await fixture();
  assert.equal(fileWatchers.length,1);
  const before=commands.filter(a=>a[1]==='snapshot').length;
  fileWatchers[0].resolve({code:0,stdout:JSON.stringify({changed:true})});
  await flush();
  assert.equal(commands.filter(a=>a[1]==='snapshot').length,before+1);
  assert.equal(fileWatchers.length,2);
  await panel.close();
  fileWatchers[1].resolve({code:0,stdout:JSON.stringify({changed:true})});
  await flush();assert.equal(commands.filter(a=>a[1]==='snapshot').length,before+1);
});

test('automatic associations need no saved link and do not oscillate back to an unlinked query',async()=>{
  const {panel,cx,commands}=await fixture();
  const data={associations:[{terminal:'t1',sessionId:'auto-root',createdAt:1,method:'title_and_directory'}],
    sessions:[],relations:[],candidates:[],candidatePages:1,candidatePage:0};
  panel.snapshot=data;
  assert.equal(panel.bindings(panel.baseModel())[0]?.sessionId,'auto-root');
  const before=commands.length;panel.render(cx);await flush();
  assert.equal(panel.snapshot,data);assert.equal(commands.length,before);
  assert.deepEqual(panel.sessionQuery(panel.baseModel()).roots,[]);
  assert.equal(panel.sessionQuery(panel.baseModel()).agents[0].terminal,'t1');
  await panel.close();
});


test('renaming a terminal preserves the selected child while a new association query loads',async()=>{
  const {panel,cx,host}=await fixture();
  panel.snapshot={associations:[{terminal:'t1',sessionId:'root',createdAt:1,method:'title'}],
    sessions:[{sessionId:'root'},{sessionId:'child',parentSessionId:'root',observedStatus:'done'}],
    relations:[{parentSessionId:'root',childSessionId:'child'}]};
  panel.selectedId='codex:child';
  host.agents[0].title='Renamed root title';
  panel.render(cx);
  assert.equal(panel.selectedId,'codex:child');
  await flush();await panel.close();
});
