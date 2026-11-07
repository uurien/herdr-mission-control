const PROVIDER_NAMES = { codex: "Codex", claude: "Claude Code" };
const STATES = new Set(["working", "blocked", "done", "idle", "error"]);

function statusWord(value) {
  const word = typeof value === "string" ? value : value?.state;
  return STATES.has(word) ? word : "unknown";
}

function providerFor(agent, terminal) {
  const values = [agent?.app, terminal.report?.app, terminal.status?.app,
    agent?.program?.key, agent?.program?.name, terminal.program?.key, terminal.program?.name];
  for (const value of values) {
    const name = String(value ?? "").toLowerCase();
    if (["codex", "codex-cli"].includes(name)) return "codex";
    if (["claude", "claude-code", "claude code"].includes(name)) return "claude";
  }
  return null;
}

// App addresses are machine-qualified; labels and local parent addresses are not.
function qualify(address, reference) {
  if (!reference || reference.includes("/")) return reference || null;
  const slash = address.indexOf("/");
  return slash < 0 ? reference : address.slice(0, slash + 1) + reference;
}

/** Resolve only the requested space, independently of the window's current focus. */
export function buildSpaceSnapshot(spaceId, host) {
  const space = (host.spaces ?? []).find(s => s.id === spaceId);
  const counts = { working: 0, blocked: 0, done: 0, idle: 0, error: 0, unknown: 0 };
  if (!space) {
    return { space: null, machine: null, agents: [], unresolved: [], counts,
      helperCount: 0, availability: "missing" };
  }

  const machine = (host.machines ?? []).find(m => m.name === (space.machine ?? null));
  const records = new Map();
  for (const terminal of host.terminals ?? []) {
    if (terminal.address) records.set(terminal.address, { terminal, agent: null });
  }
  for (const agent of host.agents ?? []) {
    if (!agent.address) continue;
    const record = records.get(agent.address) ?? { terminal: { address: agent.address } };
    record.agent = agent;
    records.set(agent.address, record);
  }

  const membership = new Map();
  function locate(address, seen = new Set()) {
    if (membership.has(address)) return membership.get(address);
    const record = records.get(address);
    if (!record || seen.has(address)) return null;
    const { terminal, agent } = record;
    const labels = terminal.labels ?? {};
    const ownSpace = agent?.space || qualify(address, labels["herdr.space"]);
    const ownTab = agent?.tab || qualify(address, labels["herdr.tab"]);
    if (ownSpace) {
      const result = { spaceId: ownSpace, tabId: ownTab };
      membership.set(address, result);
      return result;
    }
    const parent = qualify(address, terminal.parent);
    const result = parent ? locate(parent, new Set([...seen, address])) : null;
    membership.set(address, result);
    return result;
  }

  const included = new Map();
  for (const [address, { terminal, agent }] of records) {
    if (terminal.state && terminal.state !== "live") continue;
    const provider = providerFor(agent, terminal);
    const parent = qualify(address, terminal.parent);
    if (!provider && !parent) continue;
    // Known unsupported providers are outside v0; unidentified helpers stay visible.
    if (!provider && (agent?.app || terminal.report?.app || terminal.status?.app)) continue;
    const location = locate(address);
    if (location?.spaceId !== space.id) continue;
    const tab = (space.tabs ?? []).find(t => t.id === location.tabId) ?? null;
    const pane = (host.panes ?? []).find(p => p.terminal === address);
    const providerName = PROVIDER_NAMES[provider] ?? null;
    const name = terminal.name || agent?.program?.name || terminal.program?.name ||
      providerName || "Agente no identificado";
    included.set(address, {
      id: address, terminal: address, provider, providerName, name,
      title: agent?.title || terminal.title || "",
      status: statusWord(agent ? agent.status : terminal.status ?? terminal.report),
      tab, parentId: parent, unresolvedParent: false, isHelper: Boolean(parent),
      depth: 0, source: "herdr", createdAt: terminal.created_ms ?? null,
      workingSince: tab?.working_since ?? null,
      cwd: terminal.foreground?.cwd || pane?.cwd || terminal.cwd || null,
      process: terminal.foreground?.name || null,
      pinned: agent?.pinned ?? false,
    });
  }

  // A missing ancestor must not invalidate a child's confirmed direct parent.
  for (const agent of included.values()) {
    if (agent.parentId && !included.has(agent.parentId)) {
      agent.parentId = null;
      agent.unresolvedParent = true;
    }
  }
  const cyclic = new Set();
  for (const agent of included.values()) {
    const path = [];
    let current = agent.id;
    while (current) {
      const repeated = path.indexOf(current);
      if (repeated !== -1) {
        for (const id of path.slice(repeated)) cyclic.add(id);
        break;
      }
      path.push(current);
      current = included.get(current)?.parentId;
    }
  }
  for (const id of cyclic) {
    included.get(id).parentId = null;
    included.get(id).unresolvedParent = true;
  }
  const agents = [];
  function append(parentId, depth) {
    for (const agent of included.values()) {
      if (agent.parentId !== parentId) continue;
      agent.depth = depth;
      agents.push(agent);
      append(agent.id, depth + 1);
    }
  }
  append(null, 0);
  for (const agent of agents) counts[agent.status]++;
  return {
    space, machine: space.machine ?? null, agents, counts,
    helperCount: agents.filter(a => a.isHelper).length,
    unresolved: agents.filter(a => a.unresolvedParent).map(a => a.id),
    availability: machine?.layout ?? (space.machine ? "unavailable" : "ready"),
  };
}

export function selectAgentId(model, savedId) {
  return model.agents.some(a => a.id === savedId) ? savedId : model.agents[0]?.id ?? null;
}
