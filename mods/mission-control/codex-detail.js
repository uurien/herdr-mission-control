import { div } from 'gpui-kit';
import { h_flex, v_flex } from 'gpui-base';

function button(id, label, onClick, colors) {
  return div().id(id).px(10).py(7).rounded(6).bg(colors.surface).text_size(12)
    .cursor_pointer().hover(s => s.bg(colors.hover)).on_click((_event, cx) => onClick(cx)).child(label);
}
function section(label, colors) {
  return v_flex().gap(7).min_w(0)
    .child(div().text_size(12).text_color(colors.muted).child(label));
}
const dateLabel = value => value ? String(value).replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : '—';

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
  for (const tool of data.tools.declared) declared.child(div().text_size(12).child(tool.name));
  if (!data.tools.declared.length) declared.child(div().text_size(12).text_color(colors.muted).child('Sin declaraciones registradas.'));
  root.child(declared);
  const used = section('Tools utilizadas', colors);
  used.child(div().text_size(11).text_color(colors.muted).child('Intentos de llamada, independientemente del resultado.'));
  for (const tool of data.tools.used) used.child(v_flex().gap(2)
    .child(div().text_size(12).child(`${tool.name} · ${tool.count}`))
    .child(div().text_size(10).text_color(colors.muted).child(`Última: ${dateLabel(tool.lastObservedAt)}`)));
  if (!data.tools.used.length) used.child(div().text_size(12).text_color(colors.muted).child('Sin llamadas confirmadas en el historial analizado.'));
  root.child(used);
  const skills = section('Skills cargadas', colors);
  for (const skill of data.skills) skills.child(v_flex().gap(3)
    .child(div().text_size(13).child(`${skill.name} · ${skill.count} lectura(s)`))
    .child(div().text_size(11).text_color(colors.muted).child(skill.path))
    .child(div().text_size(10).text_color(colors.muted).child(`Primera: ${dateLabel(skill.firstObservedAt)}`))
    .child(div().text_size(10).text_color(colors.muted).child(`Última: ${dateLabel(skill.lastObservedAt)}`)));
  if (!data.skills.length) skills.child(div().text_size(12).text_color(colors.muted)
    .child('Sin cargas confirmadas en el historial analizado.'));
  return root.child(skills);
}
