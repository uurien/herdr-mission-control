/** Only confirmed thread IDs connect Herdr terminals to a Codex family. No cwd heuristics. */
export function buildCodexFamily({ roots = [], sessions = [], relations = [], herdrAgents = [] }) {
  const diagnostics = new Set();
  const sessionMap = new Map(sessions.map(s => [s.sessionId, s]));
  const parents = new Map();
  const names = new Map();
  for (const r of [...relations, ...sessions.filter(s => s.parentSessionId).map(s => ({
    childSessionId: s.sessionId, parentSessionId: s.parentSessionId,
  }))]) {
    if (!r.parentSessionId || !r.childSessionId) continue;
    const choices = parents.get(r.childSessionId) || new Set();
    choices.add(r.parentSessionId); parents.set(r.childSessionId, choices);
    if (r.name) names.set(r.childSessionId, r.name);
  }
  const blocked = new Set();
  for (const [id, choices] of parents) if (choices.size > 1) {
    blocked.add(id); diagnostics.add('conflicting_parent');
  }
  for (const id of parents.keys()) {
    const visited = [];
    let current = id;
    while (current && !blocked.has(current)) {
      const repeated = visited.indexOf(current);
      if (repeated !== -1) {
        visited.slice(repeated).forEach(x => blocked.add(x)); diagnostics.add('cyclic_parent'); break;
      }
      visited.push(current); current = parents.get(current)?.values().next().value;
    }
  }
  const terminals = new Map(herdrAgents.map(a => [a.terminal, a]));
  const linked = new Map();
  for (const r of roots) if (terminals.has(r.terminal) && r.sessionId) {
    if (linked.has(r.sessionId)) { diagnostics.add('duplicate_link'); continue; }
    linked.set(r.sessionId, terminals.get(r.terminal));
  }
  const accepted = new Set(linked.keys());
  let changed = true;
  while (changed) {
    changed = false;
    for (const [child, choices] of parents) if (!blocked.has(child) && !accepted.has(child) &&
        accepted.has(choices.values().next().value)) { accepted.add(child); changed = true; }
  }
  const nodes = new Map();
  const remapped = new Map();
  for (const id of accepted) {
    const native = linked.get(id);
    const data = sessionMap.get(id);
    const parent = !blocked.has(id) ? parents.get(id)?.values().next().value : null;
    const nodeId = `codex:${id}`;
    if (native) remapped.set(native.id, nodeId);
    nodes.set(nodeId, { ...native,
      id: nodeId, sessionId: id, terminal: native?.terminal || null,
      name: data?.name || names.get(id) || id,
      provider: 'codex', providerName: native ? 'Codex' : 'Subagente Codex',
      parentId: parent && accepted.has(parent) ? `codex:${parent}` : native?.parentId || null,
      origin: native ? 'both' : 'codex', isInternal: !native, isHelper: native?.isHelper || false,
      title: data?.role || data?.name || native?.title || '',
      status: native?.status || data?.observedStatus || 'unknown', historicalStatus: !native,
      statusObservedAt: data?.statusObservedAt || null,
      coverage: data?.coverage || 'unavailable', sessionData: data || null,
      cwd: native?.cwd || data?.cwd || null, createdAt: native?.createdAt || data?.createdAt || null,
      depth: 0,
    });
  }
  for (const a of herdrAgents) if (!remapped.has(a.id)) nodes.set(a.id, { ...a, origin: 'herdr' });
  for (const node of nodes.values()) if (remapped.has(node.parentId)) node.parentId = remapped.get(node.parentId);
  const ordered = [];
  const visited = new Set();
  function append(id, depth) {
    if (visited.has(id)) return;
    visited.add(id);
    const node = nodes.get(id); node.depth = depth; ordered.push(node);
    for (const child of nodes.values()) if (child.parentId === id) append(child.id, depth + 1);
  }
  for (const n of nodes.values()) if (!n.parentId || !nodes.has(n.parentId)) append(n.id, 0);
  for (const n of nodes.values()) if (!visited.has(n.id)) append(n.id, 0);
  return { nodes: ordered, roots: [...linked.keys()].map(id => `codex:${id}`), diagnostics: [...diagnostics] };
}
