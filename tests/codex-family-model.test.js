import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCodexFamily } from '../mods/mission-control/codex-family-model.js';
const agent = (id, extra = {}) => ({ id, terminal: id, provider: 'codex', providerName: 'Codex', name: 'Codex', status: 'working', depth: 0, parentId: null, createdAt: 1, ...extra });
const session = (id, parentSessionId = null, extra = {}) => ({ sessionId: id, parentSessionId, coverage: 'complete', tools: { declared: [], used: [] }, skills: [], ...extra });
const relation = (parentSessionId, childSessionId) => ({ parentSessionId, childSessionId, evidence: 'test:1' });

test('builds root, child and grandchild without admitting another project root', () => {
  const result = buildCodexFamily({ roots: [{ terminal: 't1', sessionId: 'root' }],
    herdrAgents: [agent('t1')], sessions: [session('root'), session('child'), session('grand'), session('other')],
    relations: [relation('root', 'child'), relation('child', 'grand'), relation('other', 'foreign')] });
  assert.deepEqual(result.nodes.map(n => [n.id, n.depth]), [['codex:root', 0], ['codex:child', 1], ['codex:grand', 2]]);
  assert.equal(result.nodes[1].terminal, null);
  assert.equal(result.nodes[1].parentId, 'codex:root');
});

test('missing child logs remain visible as unavailable, with no invented tools or state', () => {
  const result = buildCodexFamily({ roots: [{ terminal: 't1', sessionId: 'root' }], herdrAgents: [agent('t1')],
    sessions: [session('root')], relations: [relation('root', 'missing')] });
  const child = result.nodes[1];
  assert.equal(child.coverage, 'unavailable');
  assert.equal(child.status, 'unknown');
  assert.equal(child.sessionData, null);
});

test('merges a confirmed helper once and remaps its terminal identity', () => {
  const result = buildCodexFamily({ roots: [{ terminal: 't1', sessionId: 'root' }, { terminal: 't2', sessionId: 'child' }],
    herdrAgents: [agent('t1'), agent('t2', { parentId: 't1', isHelper: true }), agent('t3', { provider: 'claude' })],
    sessions: [session('root'), session('child')], relations: [relation('root', 'child'), relation('root', 'child')] });
  assert.deepEqual(result.nodes.map(n => n.id), ['codex:root', 'codex:child', 't3']);
  assert.equal(result.nodes[1].origin, 'both');
  assert.equal(result.nodes[1].terminal, 't2');
});

test('rejects conflicting parents and cycles rather than choosing a recent relationship', () => {
  const result = buildCodexFamily({ roots: [{ terminal: 't1', sessionId: 'root' }], herdrAgents: [agent('t1')],
    sessions: [session('root')], relations: [relation('root', 'conflict'), relation('other', 'conflict'),
      relation('root', 'cycle'), relation('cycle', 'root')] });
  assert.deepEqual(result.nodes.map(n => n.id), ['codex:root']);
  assert.ok(result.diagnostics.includes('conflicting_parent'));
  assert.ok(result.diagnostics.includes('cyclic_parent'));
});

test('own data never propagates up the family and completed children remain selectable', () => {
  const root = session('root');
  const child = session('child', 'root', { observedStatus: 'done', skills: [{ path: '/child/SKILL.md' }] });
  const result = buildCodexFamily({ roots: [{ terminal: 't1', sessionId: 'root' }], herdrAgents: [agent('t1')],
    sessions: [root, child], relations: [relation('root', 'child')] });
  assert.equal(result.nodes[0].sessionData.skills.length, 0);
  assert.equal(result.nodes[1].sessionData.skills.length, 1);
  assert.equal(result.nodes[1].status, 'done');
  assert.equal(result.nodes[1].historicalStatus, true);
});
