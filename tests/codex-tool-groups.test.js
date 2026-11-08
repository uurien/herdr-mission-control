import assert from 'node:assert/strict';
import test from 'node:test';
import { groupTools, toolGroupKey } from '../mods/mission-control/codex-tool-groups.js';

test('groups MCP receipts and native namespaces under readable provider names', () => {
  const groups = groupTools([
    { name: 'playwright.browser_tabs', server: 'playwright', tool: 'browser_tabs', count: 2 },
    { name: 'playwright.browser_snapshot', server: 'playwright', tool: 'browser_snapshot', count: 3 },
    { name: 'context7.query-docs', count: 5 },
    { name: 'context7.resolve-library-id', count: 3 },
    { name: 'mcp__cua_repl.js', count: 19 },
    { name: 'collaboration.spawn_agent', count: 1 },
    { name: 'exec', count: 144 }, { name: 'wait', count: 2 },
  ]);
  const playwright = groups.find(g => g.id === 'playwright');
  assert.equal(playwright.label, 'Playwright');
  assert.equal(playwright.count, 5);
  assert.deepEqual(playwright.tools.map(t => t.name), ['browser_snapshot', 'browser_tabs']);
  assert.equal(groups.find(g => g.id === 'context7').tools.length, 2);
  assert.equal(groups.find(g => g.id === 'functions').count, 146);
  assert.equal(groups.find(g => g.id === 'cua_repl').label, 'CUA');
  assert.equal(groups.find(g => g.id === 'cua_repl').tools[0].name, 'js');
  assert.equal(groups.reduce((n, g) => n + g.count, 0), 179);
});

test('merges known Context7 name aliases while preserving call counts and timestamps', () => {
  const tools = [
    { name: 'mcp__context7__query_docs', count: 2, firstObservedAt: '2026-11-07T10:00:00Z', lastObservedAt: '2026-11-07T11:00:00Z' },
    { name: 'context7.query-docs', server: 'context7', tool: 'query-docs', count: 3, firstObservedAt: '2026-11-08T10:00:00Z', lastObservedAt: '2026-11-08T11:00:00Z' },
  ];
  const before = JSON.stringify(tools);
  const group = groupTools(tools)[0];
  assert.equal(group.tools.length, 1);
  assert.equal(group.tools[0].name, 'query-docs');
  assert.equal(group.count, 5);
  assert.equal(group.tools[0].firstObservedAt, tools[0].firstObservedAt);
  assert.equal(group.tools[0].lastObservedAt, tools[1].lastObservedAt);
  assert.equal(JSON.stringify(tools), before);
});

test('keeps distinct unknown tools and provider names, including hyphens vs underscores', () => {
  const groups = groupTools([{ name: 'mcp__my_server__read-file', count: 1 },
    { name: 'mcp__my_server__read_file', count: 2 }, { name: 'functions.exec', count: 3 }]);
  assert.equal(groups.find(g => g.id === 'my_server').tools.length, 2);
  assert.equal(groups.find(g => g.id === 'functions').tools[0].name, 'exec');
});

test('expansion identities distinguish agent and declared/used sections', () => {
  assert.notEqual(toolGroupKey('one', 'used', 'context7'), toolGroupKey('two', 'used', 'context7'));
  assert.notEqual(toolGroupKey('one', 'used', 'context7'), toolGroupKey('one', 'declared', 'context7'));
});
