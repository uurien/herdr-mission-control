import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, machines, panes, props, run, spaces, terminals, theme } from "herdr";
import { buildSpaceSnapshot, selectAgentId } from "./herdr-model.js";
import { agentDetail, agentRow, notice, STATUS } from "./ui.js";

export default class MissionControl extends View {
  init(_props, cx) {
    this.spaceId = props()?.spaceId ?? null;
    this.width = 1000;
    this.selectionKey = `selection:${this.spaceId}`;
    this.selectedId = localStorage.getItem(this.selectionKey);
    this.clockNeeded = false;
    cx.timer.every(30000, cx => { if (this.clockNeeded) cx.notify(); });
  }

  select(id, cx) {
    this.selectedId = id;
    localStorage.setItem(this.selectionKey, id);
    cx.notify();
  }

  render() {
    const colors = theme();
    const model = buildSpaceSnapshot(this.spaceId, {
      spaces: spaces(), agents: agents(), terminals: terminals(), panes: panes(), machines: machines(),
    });
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
      .child(div().child(`${model.agents.length} agentes · ${model.helperCount} helpers incluidos`));
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
      agent => run("terminal.peek", { terminal: agent.terminal }), wide));
    return root.child(body).child(div().px(24).py(10).flex_none()
      .border_t(1).border_color(colors.border).text_size(11).text_color(colors.muted)
      .child("Solo este space · Estado mostrado por Herdr · Actividad del tab, no tiempo individual"));
  }
}
