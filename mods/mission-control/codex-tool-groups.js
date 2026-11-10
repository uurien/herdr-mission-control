const PROVIDER_LABELS = {
  functions: 'Funciones', collaboration: 'Colaboración', context7: 'Context7',
  playwright: 'Playwright', cua_repl: 'CUA', node_repl: 'Node REPL', clock: 'Reloj', web: 'Web',
};
const CONTEXT7_NAMES = { query_docs: 'query-docs', resolve_library_id: 'resolve-library-id' };

function toolIdentity(tool) {
  if (tool.server && tool.tool) return { provider: tool.server, name: tool.tool };
  const name = String(tool.name || 'unknown');
  const mcp = /^mcp__(.+?)(?:__|\.)(.+)$/.exec(name);
  if (mcp) return { provider: mcp[1], name: mcp[2] };
  const dot = name.indexOf('.');
  return dot >= 0 ? { provider: name.slice(0, dot), name: name.slice(dot + 1) } :
    { provider: 'functions', name };
}
function observed(a, b, latest) {
  const first = Date.parse(a); const second = Date.parse(b);
  if (!Number.isFinite(first)) return b || a || null;
  if (!Number.isFinite(second)) return a;
  return (latest ? first >= second : first <= second) ? a : b;
}

/** Display-only grouping. Aliases aggregate existing counts; source records stay untouched. */
export function groupTools(tools) {
  const groups = new Map();
  for (const tool of tools) {
    const identity = toolIdentity(tool);
    const provider = identity.provider;
    const name = provider === 'context7' ? CONTEXT7_NAMES[identity.name] || identity.name : identity.name;
    if (!groups.has(provider)) groups.set(provider, {
      id: provider, label: PROVIDER_LABELS[provider] || provider, count: 0, entries: new Map(),
    });
    const group = groups.get(provider);
    const previous = group.entries.get(name);
    const count = Number.isFinite(tool.count) && tool.count >= 0 ? tool.count : 0;
    group.count += count;
    group.entries.set(name, {
      name, count: (previous?.count || 0) + count,
      firstObservedAt: observed(previous?.firstObservedAt, tool.firstObservedAt, false),
      lastObservedAt: observed(previous?.lastObservedAt, tool.lastObservedAt, true),
    });
  }
  return [...groups.values()].map(({ entries, ...group }) => ({
    ...group, tools: [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)),
  })).sort((a, b) => a.label.localeCompare(b.label));
}

export function toolGroupKey(agentId, section, provider) {
  return JSON.stringify([agentId, section, provider]);
}
