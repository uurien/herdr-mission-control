import { div } from 'gpui-kit';
import { h_flex, v_flex } from 'gpui-base';
import { groupTools, toolGroupKey } from './codex-tool-groups.js';

function button(id, label, onClick, colors) {
  return div().id(id).px(10).py(7).rounded(6).bg(colors.surface).text_size(12)
    .cursor_pointer().hover(s => s.bg(colors.hover)).on_click((_event, cx) => onClick(cx)).child(label);
}
function section(label, colors) {
  return v_flex().gap(7).min_w(0)
    .child(div().text_size(12).text_color(colors.muted).child(label));
}
const dateLabel = value => value ? String(value).replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : '—';

function toolGroups(agent, kind, tools, colors, options) {
  const list = v_flex().gap(6).min_w(0);
  for (const group of groupTools(tools)) {
    const key = toolGroupKey(agent.id, kind, group.id);
    const expanded = Boolean(options.expandedToolGroups?.[key]);
    const detail = kind === 'used' ? ` · ${group.count} ${group.count === 1 ? 'llamada' : 'llamadas'}` : '';
    const row = v_flex().gap(8).min_w(0)
      .child(v_flex().id(`tool-group:${key}`).p(10).gap(3).rounded(6).bg(colors.surface)
        .cursor_pointer().hover(s => s.bg(colors.hover))
        .on_click((_event, cx) => options.onToggleToolGroup?.(key, cx))
        .child(h_flex().gap(8).items_center()
          .child(div().text_size(12).text_color(colors.muted).child(expanded ? '▾' : '▸'))
          .child(div().text_size(13).child(group.label)))
        .child(div().text_size(11).text_color(colors.muted)
          .child(`${group.tools.length} ${group.tools.length === 1 ? 'tool' : 'tools'}${detail}`)));
    if (expanded) {
      const contents = v_flex().pl(12).pb(5).gap(10).min_w(0);
      for (const tool of group.tools) {
        const name = kind === 'used' ? `${tool.name} · ${tool.count}` : tool.name;
        const item = v_flex().gap(3).min_w(0).child(div().text_size(12).child(name));
        if (kind === 'used') item.child(div().text_size(11).text_color(colors.muted)
          .child(`Última: ${dateLabel(tool.lastObservedAt)}`));
        contents.child(item);
      }
      row.child(contents);
    }
    list.child(row);
  }
  return list;
}

export function codexDetail(agent, colors, options = {}) {
  const root = v_flex().gap(16).min_w(0);
  if (options.remote) return root.child(div().text_size(12).text_color(colors.muted)
    .child('Tools y skills: disponibles solo para Codex local.'));
  const data = agent.sessionData;
  root.child(section('SESIÓN CODEX', colors)
    .child(div().text_size(11).child(agent.sessionId || 'Sesión sin vincular · Detección automática')));
  const linkLabels = { title_and_directory: 'Detectada por nombre y carpeta', title: 'Detectada por nombre',
    unique_directory: 'Detectada por proyecto', directory_and_activity: 'Detectada por proyecto y actividad',
    manual: 'Vinculación corregida manualmente' };
  if (linkLabels[agent.linkMethod]) root.child(div().text_size(11).text_color(colors.muted).child(linkLabels[agent.linkMethod]));
  if (!agent.sessionId) root.child(div().text_size(12).text_color(colors.muted)
    .child(options.associationIssue === 'ambiguous' ?
      'Varias coincidencias. La detección se reintentará con nueva actividad.' : 'Buscando la sesión por nombre, proyecto y actividad…'));
  if (agent.terminal && options.onPicker) {
    root.child(button('codex-session-picker', 'Corregir vinculación',
      cx => options.onPicker(agent, cx), colors));
    if (agent.linkMethod === 'manual') root.child(button('codex-session-unlink', 'Usar vinculación automática',
      cx => options.onBind(agent, null, cx), colors));
  }
  if (options.pickerOpen) {
    const picker = section('Selecciona la sesión de esta terminal', colors);
    picker.child(div().text_size(11).text_color(colors.muted)
      .child('Elige por nombre y proyecto si necesitas corregir la detección automática.'));
    if (options.linkError) picker.child(div().text_size(12).text_color(colors.blocked).child(options.linkError));
    for (const candidate of options.candidates || []) {
      picker.child(v_flex().id(`link-${candidate.sessionId}`).p(8).gap(3).rounded(5)
        .bg(colors.surface).cursor_pointer().hover(s => s.bg(colors.hover))
        .on_click((_e, cx) => options.onBind(agent, candidate.sessionId, cx))
        .child(div().text_size(12).child(candidate.name || candidate.sessionId))
        .child(div().text_size(10).child(candidate.sessionId))
        .child(div().text_size(11).text_color(colors.muted).child(candidate.cwd || 'Directorio no comunicado'))
        .child(div().text_size(10).text_color(colors.muted).child(dateLabel(candidate.createdAt)))
        .when(Boolean(candidate.parentSessionId), p => p.child(div().text_size(10).child(`Hijo de ${candidate.parentSessionId}`))));
    }
    if (!options.candidates?.length) picker.child(div().text_size(12)
      .child(options.pickerLoading ? 'Cargando sesiones…' : 'No hay sesiones legibles en esta página.'));
    const pages = h_flex().gap(8).flex_wrap();
    if (options.page > 0) pages.child(button('codex-page-prev', 'Anteriores', cx => options.onPage(options.page - 1, cx), colors));
    if (options.page + 1 < options.pages) pages.child(button('codex-page-next', 'Siguientes', cx => options.onPage(options.page + 1, cx), colors));
    picker.child(pages);
    root.child(picker);
  }
  if (options.onRefresh) root.child(button('codex-refresh', 'Actualizar registros', cx => options.onRefresh(cx), colors));
  if (options.readerStatus === 'unavailable') root.child(div().text_size(12).text_color(colors.blocked)
    .child(options.readerError === 'too_large' ? 'La familia supera el límite de metadatos del lector.' :
      options.readerError === 'node_unavailable' ? 'Node.js no está disponible en el entorno ni en el shell de inicio.' :
      'Lectura no disponible. Comprueba Node.js y la instalación del lector.'));
  else if (options.readerStatus === 'loading') root.child(div().text_size(11).text_color(colors.muted).child('Actualizando registros…'));
  if (!agent.sessionId) return root;
  if (!data) return root.child(div().text_size(12).text_color(colors.muted)
    .child('Registro de esta sesión no disponible. No se pueden confirmar sus tools ni skills.'));
  if (data.coverage === 'partial') root.child(div().text_size(12).text_color(colors.blocked)
    .child(data.diagnostics?.includes('inheritance_boundary_unknown') ?
      'Cobertura parcial: no se puede separar la actividad propia del historial heredado.' :
      'Cobertura parcial del historial. Se muestran solo evidencias confirmadas.'));
  if (options.discoveryCoverage && options.discoveryCoverage !== 'complete' || options.diagnostics?.length) {
    root.child(div().text_size(11).text_color(colors.muted).child('Descubrimiento de familia incompleto; pueden faltar subagentes.'));
  }
  const declared = section('Tools declaradas en la sesión', colors);
  declared.child(div().text_size(11).text_color(colors.muted).child('Las declaraciones no garantizan un inventario completo o vigente.'));
  declared.child(toolGroups(agent, 'declared', data.tools.declared, colors, options));
  if (!data.tools.declared.length) declared.child(div().text_size(12).text_color(colors.muted).child('Sin declaraciones registradas.'));
  root.child(declared);
  const used = section('Tools utilizadas', colors);
  used.child(div().text_size(11).text_color(colors.muted).child('Intentos de llamada, independientemente del resultado.'));
  used.child(toolGroups(agent, 'used', data.tools.used, colors, options));
  if (!data.tools.used.length) used.child(div().text_size(12).text_color(colors.muted).child('Sin llamadas confirmadas en el historial analizado.'));
  root.child(used);
  const skills = section(`Skills cargadas · ${data.skills.length}`, colors);
  for (const skill of data.skills) {
    const key = JSON.stringify([agent.id, skill.path]);
    const expanded = Boolean(options.expandedSkills?.[key]);
    const row = v_flex().gap(6).min_w(0)
      .child(h_flex().id(`skill:${key}`).py(9).gap(8).items_center().min_w(0)
        .cursor_pointer().hover(s => s.bg(colors.hover))
        .on_click((_event, cx) => options.onToggleSkill?.(key, cx))
        .child(div().text_size(11).text_color(colors.muted).child(expanded ? '▾' : '▸'))
        .child(div().flex_1().min_w(0).text_size(12).child(skill.name))
        .child(div().flex_none().text_size(11).text_color(colors.muted)
          .child(`${skill.count} ${skill.count === 1 ? 'lectura' : 'lecturas'}`)));
    if (expanded) row.child(v_flex().pl(18).pb(10).gap(4).min_w(0)
      .child(div().text_size(11).text_color(colors.muted).child(skill.path))
      .child(div().text_size(11).text_color(colors.muted).child(`Primera: ${dateLabel(skill.firstObservedAt)}`))
      .child(div().text_size(11).text_color(colors.muted).child(`Última: ${dateLabel(skill.lastObservedAt)}`)));
    skills.child(row);
  }
  if (!data.skills.length) skills.child(div().text_size(12).text_color(colors.muted)
    .child('Sin cargas confirmadas en el historial analizado.'));
  return root.child(skills);
}
