import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

export const STATUS = {
  working: { label: "Trabajando", color: "working" },
  blocked: { label: "Necesita atención", color: "blocked" },
  done: { label: "Respuesta lista", color: "done" },
  idle: { label: "Inactivo", color: "idle" },
  error: { label: "Error comunicado", color: "blocked" },
  unknown: { label: "Sin estado", color: "dim" },
};

export function statusBadge(status, colors) {
  const info = STATUS[status] ?? STATUS.unknown;
  return h_flex().gap(6).items_center().flex_none()
    .text_size(12).text_color(colors[info.color] ?? colors.muted)
    .child(div().size(6).rounded(3).bg(colors[info.color] ?? colors.muted))
    .child(info.label);
}

export function agentRow(agent, selected, onSelect, colors) {
  const name = agent.providerName || agent.name;
  const secondary = [agent.terminal, agent.tab?.name].filter(Boolean).join(" · ");
  return div().pl(Math.min(agent.depth, 6) * 18).w_full().child(
    v_flex().id(`agent-${agent.id}`).p(12).gap(6).rounded(8)
      .bg(selected ? colors.selected : colors.background)
      .cursor_pointer().hover(style => style.bg(selected ? colors.selected : colors.hover))
      .on_click((_event, cx) => onSelect(agent.id, cx))
      .child(h_flex().gap(10).items_center().flex_wrap()
        .child(div().flex_1().min_w(0).text_size(14).child(name))
        .child(statusBadge(agent.status, colors)))
      .child(div().text_size(12).text_color(colors.muted)
        .child(agent.title || "Sin título comunicado"))
      .child(div().text_size(11).text_color(colors.dim).child(secondary))
      .when(agent.isHelper, element => element.child(
        div().text_size(11).text_color(colors.muted)
          .child(agent.unresolvedParent ? "Helper · padre no resuelto" : `Helper de ${agent.parentId}`))),
  );
}

function field(label, value, colors) {
  return v_flex().gap(3).min_w(0)
    .child(div().text_size(11).text_color(colors.muted).child(label))
    .child(div().text_size(13).child(value || "—"));
}

function tabActivity(agent) {
  if (!agent.workingSince || !Number.isFinite(agent.workingSince)) return "—";
  const elapsed = Date.now() - agent.workingSince;
  if (elapsed < 0) return "No disponible";
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "Trabajando desde hace menos de 1 min";
  if (minutes < 60) return `Trabajando desde hace ${minutes} min`;
  return `Trabajando desde hace ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function agentDetail(agent, model, colors, onOpen, wide) {
  let panel = v_flex().gap(20).p(22).bg(colors.chrome).flex_none();
  panel = wide
    ? panel.w(320).min_h(0).overflow_y_scrollbar().border_l(1).border_color(colors.border)
    : panel.w_full().border_t(1).border_color(colors.border);
  if (!agent) return panel.child(div().text_color(colors.muted).child("Selecciona un agente"));
  const parent = model.agents.find(a => a.id === agent.parentId);
  const children = model.agents.filter(a => a.parentId === agent.id);
  return panel
    .child(v_flex().gap(8)
      .child(div().text_size(11).text_color(colors.muted).child("AGENTE SELECCIONADO"))
      .child(div().text_size(19).child(agent.providerName || agent.name))
      .child(statusBadge(agent.status, colors)))
    .child(field("Título comunicado", agent.title, colors))
    .child(field("Terminal", agent.terminal, colors))
    .child(field("Pestaña de origen", agent.tab?.name, colors))
    .when(Boolean(parent), p => p.child(field("Agente padre", `${parent.providerName || parent.name} · ${parent.terminal}`, colors)))
    .when(agent.unresolvedParent, p => p.child(field("Agente padre", "No resuelto por Herdr", colors)))
    .when(children.length > 0, p => p.child(field("Helpers registrados", children.map(a => a.terminal).join(", "), colors)))
    .child(field("Proceso actual", agent.process, colors))
    .child(field("Directorio del proceso", agent.cwd, colors))
    .child(field("Actividad del tab", tabActivity(agent), colors))
    .child(div().id("open-agent-terminal").px(12).py(9).rounded(6)
      .bg(colors.surface).text_size(12).cursor_pointer()
      .hover(style => style.bg(colors.hover))
      .on_click(() => onOpen(agent))
      .child("Ver terminal en Herdr"));
}

export function notice(title, description, colors) {
  return v_flex().gap(10).p(24)
    .child(div().text_size(17).child(title))
    .child(div().text_size(13).text_color(colors.muted).child(description));
}
