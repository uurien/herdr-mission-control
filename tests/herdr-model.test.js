import assert from "node:assert/strict";
import test from "node:test";
import { buildSpaceSnapshot, selectAgentId } from "../mods/mission-control/herdr-model.js";

function host() {
  return {
    spaces: [
      { id: "sp-a", name: "A", folder: "/repo", machine: null, active: true,
        tabs: [{ id: "tab-a", name: "Codex", working_since: 1000 }] },
      { id: "sp-b", name: "B", folder: "/repo", machine: null, active: false,
        tabs: [{ id: "tab-b", name: "Claude", working_since: null }] },
    ],
    agents: [
      { address: "t1", space: "sp-a", tab: "tab-a", status: "working", app: "codex",
        title: "Título comunicado", program: { name: "Codex", key: "codex", agent: true } },
      { address: "t2", space: "sp-b", tab: "tab-b", status: "blocked", app: "claude-code",
        title: "", program: { name: "Claude Code", key: "claude", agent: true } },
    ],
    terminals: [
      { address: "t1", state: "live", parent: null, created_ms: 10,
        labels: { "herdr.space": "sp-a", "herdr.tab": "tab-a" },
        status: "working", report: { app: "codex", state: "working" } },
      { address: "t2", state: "live", parent: null, created_ms: 20,
        labels: { "herdr.space": "sp-b", "herdr.tab": "tab-b" },
        status: "blocked", report: { app: "claude-code", state: "blocked" } },
    ],
    panes: [],
    machines: [{ name: null, layout: "ready" }],
  };
}

test("scope uses the panel's space even when folders match and focus changes", () => {
  const snapshot = host();
  snapshot.spaces[0].active = false;
  snapshot.spaces[1].active = true;
  const model = buildSpaceSnapshot("sp-a", snapshot);
  assert.deepEqual(model.agents.map(a => a.id), ["t1"]);
  assert.equal(model.space.name, "A");
  assert.equal(model.agents[0].title, "Título comunicado");
  assert.deepEqual(model.counts, { working: 1, blocked: 0, done: 0, idle: 0, error: 0, unknown: 0 });
});

test("missing context never falls back to the active space", () => {
  for (const id of [null, "missing"]) {
    const model = buildSpaceSnapshot(id, host());
    assert.equal(model.availability, "missing");
    assert.deepEqual(model.agents, []);
  }
});

test("a helper without pane inherits confirmed space and tab from its parent", () => {
  const snapshot = host();
  snapshot.terminals.push({ address: "t3", parent: "t1", state: "live", labels: {},
    status: "working", report: { app: "claude-code" }, name: "reviewer", created_ms: 30 });
  const model = buildSpaceSnapshot("sp-a", snapshot);
  assert.deepEqual(model.agents.map(a => [a.id, a.parentId, a.depth]), [
    ["t1", null, 0], ["t3", "t1", 1],
  ]);
  assert.equal(model.agents[1].provider, "claude");
  assert.equal(model.agents[1].tab.name, "Codex");
  assert.equal(model.helperCount, 1);
});

test("helper listed in both sources appears once and keeps the displayed agent status", () => {
  const snapshot = host();
  snapshot.terminals.push({ address: "t3", parent: "t1", state: "live", status: "done", labels: {} });
  snapshot.agents.push({ address: "t3", space: "sp-a", tab: "tab-a", app: "codex", status: "idle" });
  const model = buildSpaceSnapshot("sp-a", snapshot);
  assert.equal(model.agents.length, 2);
  assert.equal(model.agents.find(a => a.id === "t3").status, "idle");
});

test("explicit helper labels in another space override inherited membership", () => {
  const snapshot = host();
  snapshot.terminals.push({ address: "t3", parent: "t1", state: "live", status: "idle",
    report: { app: "codex" }, labels: { "herdr.space": "sp-b", "herdr.tab": "tab-b" } });
  assert.deepEqual(buildSpaceSnapshot("sp-a", snapshot).agents.map(a => a.id), ["t1"]);
  const other = buildSpaceSnapshot("sp-b", snapshot).agents.find(a => a.id === "t3");
  assert.equal(other.parentId, null);
  assert.equal(other.unresolvedParent, true);
});

test("an unidentified helper remains visible without inventing its provider or state", () => {
  const snapshot = host();
  snapshot.terminals.push({ address: "t3", parent: "t1", state: "live", status: null, labels: {}, name: "worker" });
  const helper = buildSpaceSnapshot("sp-a", snapshot).agents.find(a => a.id === "t3");
  assert.equal(helper.provider, null);
  assert.equal(helper.status, "unknown");
  assert.equal(helper.name, "worker");
});

test("an explicitly identified but silent Claude process is included, a plain shell is not", () => {
  const snapshot = host();
  snapshot.terminals.push(
    { address: "t3", state: "live", labels: { "herdr.space": "sp-a" }, status: null,
      program: { key: "claude", name: "Claude Code", agent: true } },
    { address: "t4", state: "live", labels: { "herdr.space": "sp-a" }, status: null,
      program: { key: "shell", name: "zsh", agent: false } },
  );
  assert.deepEqual(buildSpaceSnapshot("sp-a", snapshot).agents.map(a => a.id), ["t1", "t3"]);
});

test("finished terminals do not remain active agents", () => {
  const snapshot = host();
  snapshot.terminals[0].state = "finished";
  assert.deepEqual(buildSpaceSnapshot("sp-a", snapshot).agents, []);
});

test("an unreported unsupported root is excluded even when agents lists it", () => {
  const snapshot = host();
  snapshot.agents.push({ address: "t3", space: "sp-a", app: null,
    program: { key: "pi", name: "Pi", agent: true } });
  assert.deepEqual(buildSpaceSnapshot("sp-a", snapshot).agents.map(a => a.id), ["t1"]);
});

test("a missing ancestor does not discard a confirmed direct parent", () => {
  const snapshot = host();
  snapshot.terminals.push(
    { address: "t3", parent: "missing", state: "live", labels: { "herdr.space": "sp-a" } },
    { address: "t4", parent: "t3", state: "live", labels: {} },
  );
  const model = buildSpaceSnapshot("sp-a", snapshot);
  assert.equal(model.agents.find(a => a.id === "t3").unresolvedParent, true);
  assert.equal(model.agents.find(a => a.id === "t4").parentId, "t3");
  assert.equal(model.agents.find(a => a.id === "t4").depth, 1);
});

test("remote IDs and bare parent/space labels are qualified by machine", () => {
  const snapshot = host();
  snapshot.spaces.push({ id: "vps/sp-a", name: "Remote", machine: "vps", folder: "/repo",
    tabs: [{ id: "vps/tab-a", name: "Remote tab" }] });
  snapshot.machines.push({ name: "vps", layout: "ready" });
  snapshot.terminals.push(
    { address: "vps/t1", state: "live", parent: null, labels: { "herdr.space": "sp-a", "herdr.tab": "tab-a" }, report: { app: "codex" }, status: "working" },
    { address: "vps/t3", state: "live", parent: "t1", labels: {}, report: { app: "codex" }, status: "idle" },
  );
  const model = buildSpaceSnapshot("vps/sp-a", snapshot);
  assert.deepEqual(model.agents.map(a => [a.id, a.parentId]), [["vps/t1", null], ["vps/t3", "vps/t1"]]);
  assert.equal(model.agents[1].tab.id, "vps/tab-a");
});

test("cyclic parents do not recurse indefinitely or produce a fabricated tree", () => {
  const snapshot = host();
  snapshot.terminals.push(
    { address: "t3", parent: "t4", state: "live", labels: { "herdr.space": "sp-a" }, status: "working" },
    { address: "t4", parent: "t3", state: "live", labels: { "herdr.space": "sp-a" }, status: "working" },
  );
  const model = buildSpaceSnapshot("sp-a", snapshot);
  assert.equal(model.agents.length, 3);
  assert.ok(model.agents.filter(a => a.id !== "t1").every(a => a.parentId === null && a.unresolvedParent));
});

test("unavailable machines retain identity but are not shown as an empty healthy space", () => {
  const snapshot = host();
  snapshot.machines[0].layout = "unavailable";
  const model = buildSpaceSnapshot("sp-a", snapshot);
  assert.equal(model.availability, "unavailable");
  assert.equal(model.space.name, "A");
});

test("selection is restored only when the saved agent belongs to the current space", () => {
  const model = buildSpaceSnapshot("sp-a", host());
  assert.equal(selectAgentId(model, "t2"), "t1");
  assert.equal(selectAgentId(model, "t1"), "t1");
  assert.equal(selectAgentId({ agents: [] }, "t1"), null);
});
