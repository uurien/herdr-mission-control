import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

// Exercise the actual component builders; GPUI itself is checked by herdr-app check.
const builder = `
function div() {
  const data = { children: [], _id: null, click: null };
  const element = new Proxy(data, { get(target, key) {
    if (key === 'child') return item => { target.children.push(item); return element; };
    if (key === 'when') return (condition, fn) => { if (condition) fn(element); return element; };
    if (key === 'id') return id => { target._id = id; return element; };
    if (key === 'on_click') return fn => { target.click = fn; return element; };
    if (Object.hasOwn(target, key)) return target[key];
    return () => element;
  } });
  return element;
}
const h_flex = div, v_flex = div;
`;
const detailSource = (await readFile(new URL('../mods/mission-control/codex-detail.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export function codexDetail', 'function codexDetail');
const uiSource = (await readFile(new URL('../mods/mission-control/ui.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '');
const ui = await import(`data:text/javascript;base64,${Buffer.from(builder + detailSource + uiSource).toString('base64')}`);
function textOf(element) {
  return typeof element === 'string' ? element : (element?.children || []).map(textOf).join('\n');
}
function ids(element) {
  if (!element || typeof element !== 'object') return [];
  return [element._id, ...element.children.flatMap(ids)];
}
const colors = {};
const data = { tools: { declared: [{ name: 'functions.exec' }], used: [{ name: 'exec', count: 2 }] }, skills: [{ name: 'test-skill', path: '/s/SKILL.md', count: 1 }], coverage: 'complete' };

test('internal child shows its own tools and skills and no fictional terminal action', () => {
  const parent = { id: 'parent', name: 'Parent' };
  const child = { id: 'child', parentId: 'parent', name: 'Reviewer', provider: 'codex', sessionId: 'thread', status: 'done', isInternal: true, historicalStatus: true, sessionData: data };
  const rendered = ui.agentDetail(child, { agents: [parent, child] }, colors, () => assert.fail(), true, { onSelect() {} });
  assert.ok(textOf(rendered).includes('test-skill'));
  assert.ok(textOf(rendered).includes('Estado observado'));
  assert.ok(ids(rendered).includes('select-agent-parent'));
  assert.ok(!ids(rendered).includes('open-agent-terminal'));
  assert.ok(!ids(rendered).includes('codex-session-picker'));
});

test('unlinked terminal offers explicit session linking, not an empty skills inventory', () => {
  const root = { id: 't1', terminal: 't1', provider: 'codex', status: 'working' };
  const rendered = ui.agentDetail(root, { agents: [root] }, colors, () => {}, false, { onPicker() {} });
  assert.ok(ids(rendered).includes('codex-session-picker'));
  assert.ok(textOf(rendered).includes('Sesión sin vincular'));
  assert.ok(!textOf(rendered).includes('Sin cargas confirmadas'));
});

test('automatic associations explain the match and make manual selection an optional correction',()=>{
  const root={id:'root',terminal:'t1',provider:'codex',status:'working',sessionId:'thread',linkMethod:'title_and_directory',sessionData:data};
  const rendered=ui.agentDetail(root,{agents:[root]},colors,()=>{},true,{onPicker(){}});
  assert.ok(textOf(rendered).includes('Detectada por nombre y carpeta'));
  assert.ok(textOf(rendered).includes('Corregir vinculación'));
  assert.ok(!textOf(rendered).includes('Desvincular sesión'));
});
