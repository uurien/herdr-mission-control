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
const groupingImport = `import { groupTools, toolGroupKey } from '${new URL('../mods/mission-control/codex-tool-groups.js', import.meta.url).href}';\n`;
const ui = await import(`data:text/javascript;base64,${Buffer.from(groupingImport + builder + detailSource + uiSource).toString('base64')}`);
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

function findById(element, id) {
  if (!element || typeof element !== 'object') return null;
  if (element._id === id) return element;
  for (const child of element.children) { const found = findById(child, id); if (found) return found; }
  return null;
}

test('provider groups collapse long tool lists and expand without mixing declared and used sections', () => {
  const root = { id: 'root', sessionId: 'thread', provider: 'codex', status: 'working', sessionData: {
    tools: { declared: [{ name: 'mcp__context7__query_docs' }, { name: 'mcp__context7__resolve_library_id' }],
      used: [{ name: 'context7.query-docs', count: 5 }, { name: 'context7.resolve-library-id', count: 3 }] }, skills: [],
  } };
  const expandedToolGroups = {};
  const usedKey = JSON.stringify(['root', 'used', 'context7']);
  const options = { expandedToolGroups, onToggleToolGroup: key => { expandedToolGroups[key] = !expandedToolGroups[key]; } };
  const render = () => ui.agentDetail(root, { agents: [root] }, colors, () => {}, true, options);
  const closed = render();
  assert.ok(textOf(closed).includes('Context7'));
  assert.ok(textOf(closed).includes('8 llamadas'));
  assert.ok(!textOf(closed).includes('query-docs'));
  const toggle = findById(closed, `tool-group:${usedKey}`);
  assert.ok(toggle);
  toggle.click({}, {});
  const open = render();
  assert.ok(textOf(open).includes('query-docs · 5'));
  assert.ok(textOf(open).includes('resolve-library-id · 3'));
  assert.ok(!expandedToolGroups[JSON.stringify(['root', 'declared', 'context7'])]);
  findById(open, `tool-group:${usedKey}`).click({}, {});
  assert.ok(!textOf(render()).includes('query-docs'));
});

test('skill rows hide metadata and expand independently by agent and full path', () => {
  const first = { name: 'same-name', path: '/project/skills/same-name/SKILL.md', count: 1,
    firstObservedAt: '2026-11-07T14:34:00.000Z', lastObservedAt: '2026-11-07T14:34:00.000Z' };
  const second = { ...first, path: '/personal/skills/same-name/SKILL.md', count: 2 };
  const root = { id: 'root', sessionId: 'thread', provider: 'codex', sessionData: {
    ...data, skills: [first, second],
  } };
  const expandedSkills = {};
  const options = { expandedSkills, onToggleSkill: key => { expandedSkills[key] = !expandedSkills[key]; } };
  const render = (agent = root) => ui.agentDetail(agent, { agents: [agent] }, colors, () => {}, true, options);
  const closed = render();
  assert.ok(textOf(closed).includes('1 lectura'));
  assert.ok(textOf(closed).includes('2 lecturas'));
  assert.ok(!textOf(closed).includes('lectura(s)'));
  assert.ok(!textOf(closed).includes(first.path));
  assert.ok(!textOf(closed).includes('Primera:'));
  const key = JSON.stringify(['root', first.path]);
  findById(closed, `skill:${key}`).click({}, {});
  const opened = render();
  assert.ok(textOf(opened).includes(first.path));
  assert.ok(textOf(opened).includes('2026-11-07 14:34:00 UTC'));
  assert.ok(!textOf(opened).includes(second.path));
  assert.ok(!textOf(render({ ...root, id: 'child' })).includes(first.path));
  findById(opened, `skill:${key}`).click({}, {});
  assert.ok(!textOf(render()).includes(first.path));
});
