import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, appHome, exec, machines, panes, props, run, spaces, terminals, theme, watchFolder } from "herdr";
import { buildSpaceSnapshot, selectAgentId } from "./herdr-model.js";
import { buildCodexFamily } from "./codex-family-model.js";
import { createCodexSessionLoader } from "./codex-session-loader.js";
import { createCodexWatchController } from "./codex-watch-controller.js";
import { resolveNodeCommand } from "./codex-runtime.js";
import { agentDetail, agentRow, notice, STATUS } from "./ui.js";

export default class MissionControl extends View {
  init(_props, cx) {
    this.spaceId = props()?.spaceId ?? null;
    this.width = 1000;
    this.selectionKey = `selection:${this.spaceId}`;
    this.selectedId = localStorage.getItem(this.selectionKey);
    this.clockNeeded = false;
    this.closed = false;
    this.links = {};
    this.readerStatus = "loading";
    this.snapshot = null;
    this.page = 0;
    this.pickerId = null;
    this.pickerCandidates = [];
    this.pickerPage = 0;
    this.pickerPages = 1;
    this.pickerLoading = false;
    this.watchRoot = null;
    this.watching = false;
    this.fileWatching = false;
    this.fileWatchMode = "starting";
    this.watchMode = "starting";
    this.linkError = null;
    this.requestedRoots = null;
    this.readerPath = `${appHome()}/mods/mission-control/codex-session-reader.mjs`;
    this.cacheKey = `panel-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    this.runtimeReady = resolveNodeCommand(exec).then(command => { this.nodeCommand = command; return command; });
    this.loader = createCodexSessionLoader({ execute: async ({ roots, agents: probes, page }) => {
      const node = await this.runtimeReady;
      if (this.closed) throw { code: "unreadable" };
      const result = await exec(node, [this.readerPath, "snapshot", "--roots", JSON.stringify(roots),
        "--agents", JSON.stringify(probes),
        "--cache-key", this.cacheKey, "--page", String(page)]);
      let data;
      try { data = JSON.parse(result.stdout); } catch { throw { code: "unreadable" }; }
      if (result.code !== 0) throw { code: data.errorCode || "unreadable" };
      return data;
    } });
    this.updates = createCodexWatchController({
      invalidate: () => this.loader.invalidate(), refresh: cx => this.refresh(cx),
    });
    cx.timer.every(30000, cx => { if (this.clockNeeded) cx.notify(); });
    cx.timer.every(30000, cx => {
      if (this.closed) return;
      if (!this.watching && this.watchRoot) this.startWatch(this.watchRoot, cx);
      if (!this.fileWatching && this.snapshot?.watchRoot) this.startFileWatch(cx);
      this.updates.reconcile(cx);
    });
    cx.spawn(async cx => {
      try {
        const node = await this.runtimeReady;
        if (this.closed) return;
        const config = await exec(node, [this.readerPath, "config"]);
        if (this.closed) return;
        const data = JSON.parse(config.stdout);
        if (data.watchRoot) this.startWatch(data.watchRoot, cx);
      } catch { this.watchMode = "fallback"; }
      if (!this.closed) this.refresh(cx);
    });
  }

  baseModel() {
    return buildSpaceSnapshot(this.spaceId, {
      spaces: spaces(), agents: agents(), terminals: terminals(), panes: panes(), machines: machines(),
    });
  }

  linkKey(agent) {
    return `codex-link:${this.spaceId}:${agent.terminal}:${agent.createdAt ?? "unconfirmed"}`;
  }

  manualBindings(model) {
    if (model.space?.machine) return [];
    const roots = [];
    for (const agent of model.agents) {
      if (agent.provider !== "codex") continue;
      const key = this.linkKey(agent);
      if (!(key in this.links)) this.links[key] = agent.createdAt != null ? localStorage.getItem(key) : null;
      if (this.links[key]) roots.push({ terminal: agent.terminal, sessionId: this.links[key], method: "manual" });
    }
    return roots;
  }

  sessionQuery(model) {
    const manual = this.manualBindings(model);
    const fixed = new Set(manual.map(a => a.terminal));
    return {
      roots: manual.map(a => a.sessionId).sort(),
      agents: model.space?.machine ? [] : model.agents.filter(a => a.provider === "codex" && !fixed.has(a.terminal))
        .map(a => ({ terminal: a.terminal, title: a.title || "", cwd: a.cwd || model.space?.folder || null,
          createdAt: a.createdAt, isHelper: a.isHelper })).sort((a, b) => a.terminal.localeCompare(b.terminal)),
    };
  }

  bindings(model) {
    const manual = this.manualBindings(model);
    const fixed = new Set(manual.map(a => a.terminal));
    const automatic = (this.snapshot?.associations || []).filter(link => !fixed.has(link.terminal) &&
      model.agents.some(a => a.provider === "codex" && a.terminal === link.terminal && a.createdAt === link.createdAt));
    return [...manual, ...automatic];
  }

  refresh(cx) {
    if (this.closed) return;
    const model = this.baseModel();
    if (!model.space || model.space.machine || model.availability !== "ready") return;
    const query = this.sessionQuery(model);
    const { roots } = query;
    const signature = JSON.stringify(query);
    // Keep the last family visible during a name/context refresh, including child selection.
    // Request identity below prevents an older query from replacing the new result.
    this.requestedRoots = signature;
    this.readerStatus = "loading";
    const page = this.page;
    cx.spawn(async cx => {
      const result = await this.loader.load(roots, { page, agents: query.agents });
      if (this.closed || result.status === "closed" || this.requestedRoots !== signature) return;
      this.readerStatus = result.status;
      this.readerError = result.errorCode;
      if (result.data) {
        this.snapshot = result.data;
        if (this.pickerLoading && result.data.candidatePage === this.page) {
          this.captureCandidates();
          this.pickerLoading = false;
        }
        if (result.data.watchRoot && !this.watching) this.startWatch(result.data.watchRoot, cx);
        if (result.data.watchRoot && !this.fileWatching) this.startFileWatch(cx);
      }
      cx.notify();
    });
  }

  startWatch(root, cx) {
    if (this.closed || this.watching) return;
    this.watchRoot = root;
    this.watching = true;
    this.watchMode = "events";
    cx.spawn(async cx => {
      try {
        while (!this.closed) {
          await watchFolder(root);
          if (this.closed) break;
          this.updates.changed((ms, callback) => cx.timer.after(ms, callback));
        }
      } catch {
        this.watching = false;
        this.watchMode = "fallback";
        if (!this.closed) cx.notify();
      }
    });
  }

  startFileWatch(cx) {
    if (this.closed || this.fileWatching) return;
    this.fileWatching = true;
    this.fileWatchMode = "events";
    cx.spawn(async cx => {
      try {
        while (!this.closed) {
          const node = await this.runtimeReady;
          if (this.closed) break;
          const result = await exec(node, [this.readerPath, "watch", "--cache-key", this.cacheKey]);
          if (this.closed) break;
          const event = JSON.parse(result.stdout);
          if (result.code !== 0 || event.errorCode) throw Error("watch_unavailable");
          if (event.changed) {
            this.loader.invalidate();
            await cx.sleep(150);
            if (this.closed) break;
            this.refresh(cx);
            // Wait for the same snapshot before rearming against its saved baseline.
            const query = this.sessionQuery(this.baseModel());
            await this.loader.load(query.roots, { page: this.page, agents: query.agents });
          }
        }
      } catch {
        this.fileWatchMode = "fallback";
        if (!this.closed) cx.notify();
      } finally { this.fileWatching = false; }
    });
  }

  bindSession(agent, sessionId, cx) {
    const native = this.baseModel().agents.find(a => a.terminal === agent.terminal);
    if (!native) return;
    const other = this.manualBindings(this.baseModel()).find(r => r.sessionId === sessionId && r.terminal !== native.terminal);
    if (other) { this.linkError = "Esta sesión ya está vinculada a otra terminal de este space."; cx.notify(); return; }
    const key = this.linkKey(native);
    this.links[key] = sessionId || null;
    if (native.createdAt != null) {
      if (sessionId) localStorage.setItem(key, sessionId);
      else localStorage.removeItem(key);
    }
    this.selectedId = sessionId ? `codex:${sessionId}` : native.id;
    this.pickerId = null;
    this.linkError = null;
    this.loader.invalidate();
    this.refresh(cx);
    cx.notify();
  }

  captureCandidates() {
    this.pickerCandidates = this.snapshot?.candidates || [];
    this.pickerPage = this.snapshot?.candidatePage || 0;
    this.pickerPages = this.snapshot?.candidatePages || 1;
  }

  togglePicker(agent, cx) {
    this.pickerId = this.pickerId === agent.id ? null : agent.id;
    this.captureCandidates();
    this.pickerLoading = false;
    cx.notify();
  }

  async close() {
    this.closed = true;
    this.updates.close();
    this.loader.close();
    if (this.nodeCommand) {
      try { await exec(this.nodeCommand, [this.readerPath, "cleanup", "--cache-key", this.cacheKey]); }
      catch { /* Cleanup is best-effort within Herdr's 250 ms close budget. */ }
    }
  }

  select(id, cx) {
    this.selectedId = id;
    localStorage.setItem(this.selectionKey, id);
    cx.notify();
  }

  render(cx) {
    const colors = theme();
    const base = this.baseModel();
    const bindings = this.bindings(base);
    const rootSignature = JSON.stringify(this.sessionQuery(base));
    if (rootSignature !== this.requestedRoots) this.refresh(cx);
    const family = buildCodexFamily({ roots: bindings, herdrAgents: base.agents,
      sessions: this.snapshot?.sessions || [], relations: this.snapshot?.relations || [],
    });
    const model = { ...base, agents: family.nodes.map(node => ({ ...node,
      linkMethod: bindings.find(b => b.terminal === node.terminal)?.method || null,
    })) };
    const mapped = bindings.find(r => r.terminal === this.selectedId);
    if (mapped) this.selectedId = `codex:${mapped.sessionId}`;
    this.selectedId = selectAgentId(model, this.selectedId);
    const selected = model.agents.find(a => a.id === this.selectedId);
    this.clockNeeded = Boolean(selected?.workingSince);
    const wide = this.width >= 760;

    const root = v_flex().id("mission-control-root").size_full().min_h(0)
      .bg(colors.background).text_color(colors.foreground)
      .on_size_change((size, cx) => {
        if ((size.width >= 760) !== (this.width >= 760)) {
          this.width = size.width;
          cx.notify();
        }
      });
    if (!model.space) {
      return root.child(notice("Space no disponible",
        "Abre Mission Control desde el botón lateral del space que quieras consultar.", colors));
    }

    const context = [model.machine || "Este equipo", model.space.branch, model.space.folder]
      .filter(Boolean).join(" · ");
    const summary = h_flex().gap(16).flex_wrap().text_size(12)
      .child(div().child(`${base.agents.length} agentes · ${model.helperCount} helpers · ` +
        `${family.nodes.filter(a => a.isInternal).length} subagentes internos`));
    for (const [state, count] of Object.entries(model.counts)) {
      if (count) summary.child(div().text_color(colors[STATUS[state].color] ?? colors.muted)
        .child(`${count} ${STATUS[state].label.toLowerCase()}`));
    }
    root.child(v_flex().p(24).gap(9).flex_none().border_b(1).border_color(colors.border)
      .child(div().text_size(11).text_color(colors.muted).child("MISSION CONTROL"))
      .child(div().text_size(23).child(model.space.name))
      .child(div().text_size(12).text_color(colors.muted).child(context))
      .when(model.availability === "ready", element => element.child(summary)));

    if (model.availability !== "ready") {
      return root.child(notice(
        model.availability === "loading" ? "Conectando con la máquina" : "Máquina no disponible",
        "Herdr todavía no puede confirmar el inventario de este space.", colors));
    }
    if (!model.agents.length) {
      return root.child(notice("Sin agentes de Codex o Claude Code",
        "No hay agentes identificados en este space. Las terminales de shell no se cuentan como agentes.", colors));
    }

    let list = v_flex().gap(4).p(16).min_w(0);
    list = wide ? list.flex_1().min_h(0).overflow_y_scrollbar() : list.w_full().flex_none();
    list.child(div().px(12).pb(10).text_size(12).text_color(colors.muted).child("Agentes de este space"));
    for (const agent of model.agents) {
      list.child(agentRow(agent, agent.id === this.selectedId, (id, cx) => this.select(id, cx), colors));
    }
    const body = wide ? h_flex().flex_1().min_h(0) : v_flex().flex_1().min_h(0).overflow_y_scrollbar();
    body.child(list).child(agentDetail(selected, model, colors,
      agent => { if (agent.terminal) run("terminal.peek", { terminal: agent.terminal }); }, wide, {
        readerStatus: this.readerStatus, readerError: this.readerError,
        associationIssue: this.snapshot?.associationIssues?.find(a => a.terminal === selected?.terminal)?.reason,
        remote: Boolean(model.space?.machine),
        discoveryCoverage: this.snapshot?.discoveryCoverage,
        diagnostics: [...(this.snapshot?.diagnostics || []), ...family.diagnostics],
        pickerOpen: this.pickerId === selected?.id,
        candidates: this.pickerLoading ? [] : this.pickerCandidates,
        page: this.pickerPage, pages: this.pickerPages, pickerLoading: this.pickerLoading,
        linkError: this.linkError,
        onPicker: (agent, cx) => this.togglePicker(agent, cx),
        onBind: (agent, id, cx) => this.bindSession(agent, id, cx),
        onPage: (page, cx) => { this.page = page; this.pickerLoading = true; this.refresh(cx); cx.notify(); },
        onRefresh: cx => { if (this.pickerId) this.pickerLoading = true; this.updates.reconcile(cx); },
        onSelect: (id, cx) => this.select(id, cx),
      }));
    return root.child(body).child(div().px(24).py(10).flex_none()
      .border_t(1).border_color(colors.border).text_size(11).text_color(colors.muted)
      .child("Solo este space · " + (this.fileWatchMode === "events"
        ? "Actualización al cambiar los registros · Respaldo cada 30 s"
        : "Sondeo de respaldo cada 30 s") + " · Estados internos observados en el registro"));
  }
}
