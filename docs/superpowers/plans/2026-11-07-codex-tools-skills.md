# Codex tools and skills implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar la jerarquía de agentes y subagentes Codex, con sus tools registradas y las
skills cuya lectura completa está confirmada individualmente.

**Architecture:** Un lector externo consulta registros locales de Codex y devuelve solo metadatos.
Un analizador puro distingue declaraciones, llamadas y lecturas completas de skills. Otro modelo
reconstruye la familia de sesiones y la combina con el inventario de Herdr sin duplicar agentes.
Las raíces se vinculan automáticamente cruzando nombres de sesión, carpeta y actividad.
El panel combina `watchFolder` con avisos Node por archivo, procesa lo añadido y permite
seleccionar cada subagente. Un sondeo de respaldo recupera cambios perdidos.

**Tech Stack:** JavaScript ES modules, Node.js para el lector y los tests, GPUI y Herdr.

**Spec:** El contrato funcional de este documento recoge lo acordado sobre skills y propone
los detalles de tools, asociación y presentación para revisión antes de implementar.

**Estado:** Implementado y actualizado en el mod local. Verificación final: 68 tests aprobados,
checks nativos del panel y launcher aprobados, y Herdr sin errores registrados. Se comprobó la
vinculación automática de los dos agentes reales del proyecto, sin enlaces manuales guardados,
y el detalle individual de un subagente real. Los pasos siguientes
conservan la descripción del trabajo y los criterios de comprobación del plan.

## Contrato funcional

- Alcance: Codex local. Claude Code y máquinas remotas quedan para otra entrega.
- Los subagentes internos de Codex son parte central de esta entrega, aunque no tengan terminal
  propia ni aparezcan en el inventario de agentes de Herdr.
- Descubrir hijos y descendientes desde cada sesión raíz vinculada al space, con relaciones
  demostradas por metadatos de origen o resultados estructurados de creación de subagentes.
- Mostrar por subagente su identificador, padre, nombre o rol comunicado, estado observado,
  tools y skills. No generar nombres, roles ni estados que los registros no acrediten.
- Conservar hijos terminados durante la vida de la sesión raíz; el árbol representa la familia
  observada y no únicamente procesos activos. Distinguir estado histórico de estado actual.
- Las tools y skills pertenecen a la sesión donde ocurre la evidencia, sin sumarse al padre.
- El contexto heredado al crear un subagente no cuenta como una lectura suya de `SKILL.md`.
  Los eventos históricos copiados desde el padre tampoco cuentan como llamadas del hijo.
- Si un hijo está identificado pero falta su registro, mostrarlo con datos no disponibles.
  No afirmar que carece de tools o skills.
- Una skill está cargada cuando existe evidencia de lectura completa y correcta de su `SKILL.md`.
- No analizar si el agente sigue las instrucciones ni el resultado de su trabajo.
- Catálogos, menciones, intentos fallidos y lecturas parciales no confirman una carga.
- Lecturas cuya integridad no se puede demostrar quedan sin confirmar.
- Las tools se dividen en «Declaradas en la sesión» y «Utilizadas».
- Una declaración no acredita uso ni un inventario completo o actualmente vigente.
- Una llamada acredita intento de uso; no implica éxito de ejecución.
- Conservar namespace, nombre, número de llamadas y primera y última observación.
- Conservar para cada skill su ruta, nombre visible y primera y última carga confirmada.
- Deduplicar skills por ruta resuelta en la máquina y sesión, no solo por nombre.
- Cada registro visible debe conservar una referencia interna a su evidencia.
- «Sin evidencia» y «No disponible» son distintos de cero elementos confirmados.
- Actualizar al detectar cambios, sin esperar un intervalo fijo de diez segundos.
- La latencia depende de cuándo Codex escriba el registro; no se promete tiempo real estricto.

## Alternativas y decisión propuesta

1. Leer registros existentes: funciona con sesiones anteriores y no cambia cómo se inicia Codex.
   Depende del formato registrado y no permite confirmar todas las formas de lectura.
2. Instrumentar el arranque o las herramientas: puede mejorar la identificación y la cobertura,
   pero introduce configuración y solo cubre las sesiones instrumentadas.

Se propone comenzar con registros existentes y reconocer únicamente evidencias verificables.
Resolver automáticamente las raíces mediante `session_index.jsonl` y el contexto de Herdr.
La selección explícita queda como corrección opcional por nombre y proyecto.
No modificar el arranque de Codex ni instalar hooks en esta entrega.
Cada raíz detectada carga sus descendientes sin asociar manualmente cada subagente.
Descubrir esta familia es requisito de la primera entrega.

## Global Constraints

- Mantener el alcance del space y la selección existentes.
- Vincular raíces automáticamente por nombre y contexto, según la corrección expresa del usuario.
- Las correcciones explícitas tienen prioridad; los empates quedan pendientes, sin elección al azar.
- No incorporar al space una sesión hija cuya ascendencia hasta una raíz vinculada no se pruebe.
- No usar la dirección de terminal como identidad de un subagente interno: puede no tener una.
- No contar como subagente nuevo cada reactivación del mismo identificador de sesión.
- No ejecutar comandos ni código extraídos de los registros.
- No enviar prompts, argumentos, resultados completos ni instrucciones de skills a la UI.
- No reabrir el archivo actual para atribuir su contenido a una lectura histórica.
- No considerar completo un resultado truncado, pendiente o de formato desconocido.
- Node.js 22.7 o posterior es una dependencia del lector; validar disponibilidad al arrancar.
- Sin nuevas dependencias de paquetes en esta entrega.
- Una vigilancia de carpeta y avisos por archivo, acotados a 20 segundos y 4096 registros por panel.
- Sondeo de respaldo cada 30 segundos; ninguna suscripción inicia nuevas consultas tras el cierre.
- Agrupar ráfagas durante 150 ms; los eventos nuevos invalidan la caché inmediatamente.
- No instalar cambios en `~/.config/herdr-app` como parte de escribir o revisar este plan.

## Review Focus

- Dos agentes del mismo proyecto: mantener la asociación individual y rechazar ambigüedad.
- Resultados diferidos: correlacionar llamada, sesión de ejecución y resultado final.
- Tools anidadas dentro de `exec`: separar evidencia estructurada de texto que parece una llamada.
- Rotación, compactación y cambios de formato: declarar cobertura parcial sin inventar ausencias.
- Cambio de selección durante una consulta: nunca presentar datos del agente anterior.
- Contexto heredado o historial duplicado: no atribuir al hijo las acciones previas del padre.
- Descendencia parcial o contradictoria: conservar identidad sin fabricar padres ni estados.
- Eventos perdidos, escrituras partidas y cambios durante una lectura: recuperar sin duplicar.

## Archivos y responsabilidades

- Crear `mods/mission-control/codex-session-reader.mjs`: acceso a archivos y salida JSON limitada.
- Crear `mods/mission-control/codex-session-watch.mjs`: notificaciones por archivo sin daemon.
- Crear `mods/mission-control/codex-session-model.js`: análisis puro y evidencias.
- Crear `mods/mission-control/codex-session-loader.js`: consultas, caché y estado asíncrono.
- Crear `mods/mission-control/codex-watch-controller.js`: invalidación y agrupación de eventos.
- Crear `mods/mission-control/codex-runtime.js`: localizar Node en el entorno o shell de inicio.
- Crear `mods/mission-control/codex-session-linker.js`: asociación automática y control de empates.
- Crear `mods/mission-control/codex-family-model.js`: relaciones de sesiones y árbol combinado.
- Modificar `mods/mission-control/main.js`: cargar familias de las raíces Codex del space.
- Modificar `mods/mission-control/ui.js`: árbol, detalle individual y estados de cobertura.
- Crear `tests/codex-session-model.test.js` y `tests/codex-session-reader.test.js`.
- Crear `tests/codex-family-model.test.js`: jerarquía, atribución y deduplicación con Herdr.
- Crear `tests/codex-session-loader.test.js` para concurrencia y caché con un ejecutor falso.
- Añadir fixtures sintéticas bajo `tests/fixtures/codex/`, sin conversaciones reales.
- Actualizar `README.md`: semántica, requisitos, límites y copia del nuevo lector al instalar.

## Task 1: Verificar formatos y asociación con la sesión

**Files:** fixtures y tests del analizador; notas de evidencia en este documento.

**Interfaces:** definir las entradas normalizadas `SessionIdentity`, `ToolDeclaration`,
`ToolCall`, `ToolResult`, `FileReadEvidence` y `SessionRelation`.
Cada entrada conserva `sessionId`, referencia al archivo y posición del evento.
Una relación conserva `parentSessionId`, `childSessionId`, tipo de evidencia y referencia.

- [ ] Inspeccionar una muestra limitada de registros de Codex CLI y de la aplicación.
  Registrar versiones observadas y estructura, sin copiar contenido privado a fixtures.
- [ ] Verificar si Herdr o el proceso proporcionan un identificador de sesión contrastable
  con `session_meta`. La carpeta y la proximidad temporal solo ayudan a buscar candidatos.
- [ ] Cruzar títulos de Herdr con nombres de `session_index.jsonl`, usando carpeta y actividad
  para resolver contexto. La selección manual es solo una corrección opcional.
- [ ] Mantener las correcciones explícitas por identidad de terminal y creación. Las asociaciones
  automáticas se recalculan con las nuevas evidencias y no se guardan como overrides manuales.
- [ ] Crear fixtures para `additional_tools` con namespaces, llamadas normales y custom,
  resultados, consultas pendientes, truncación y llamadas envueltas en `exec`.
- [ ] Inspeccionar metadatos de sesiones hijas y llamadas de creación, espera, reactivación
  y cierre. Verificar nombres y esquemas observados, sin asumir que una llamada tuvo éxito.
- [ ] Crear fixtures de padre, hijo y nieto; hijo sin registro; creación fallida; reactivación;
  hijo con historial heredado; hijo expuesto también como helper de Herdr.
- [ ] Fijar cómo se distingue la ejecución propia del hijo de su historial heredado en los
  formatos observados. Si falta evidencia, marcar atribución parcial y no confirmar esas cargas.
- [ ] Fijar una tabla de formatos soportados para lecturas completas. Empezar por llamadas
  estructuradas de lectura y comandos literales simples verificables, como `cat` de una ruta.
  Rechazar composición, expansiones o sintaxis que no se pueda interpretar con certeza.
- [ ] Comprobar cómo se demuestra finalización, salida correcta y ausencia de truncación,
  incluidos límites del resultado enviado al modelo. No basta con código de salida cero.
- [ ] Si el formato no permite demostrarlo, marcarlo como no verificable. No sustituir el
  criterio acordado por una heurística ni prometer cobertura de esa forma de lectura.

**Entregable:** contrato de evidencia comprobado y fixtures sintéticas revisables.

## Task 2: Analizador puro de tools y skills

**Files:** `codex-session-model.js`, sus tests y fixtures.

**Interfaces:** `analyzeCodexSession(events, identity)` devuelve
`{ sessionId, coverage, tools, skills, diagnostics }`.
`tools` contiene `{ declared, used }`; `skills` solo cargas confirmadas.
`coverage` distingue `partial` y `complete` para el historial procesado; no acredita
que el inventario de tools esté completo. `diagnostics` contiene códigos, nunca contenido.

- [ ] Escribir tests de declaraciones anidadas y nombres con namespace; comprobar que declarar
  una tool no incrementa su contador de uso y que una llamada sin declaración sigue visible.
- [ ] Escribir tests de correlación por `call_id`, deduplicación de representaciones del mismo
  evento y resultados posteriores. Comprobar que dos llamadas reales cuentan dos veces.
- [ ] Escribir tests de skill leída completamente, fallo, lectura parcial, salida truncada,
  resultado pendiente, mera mención y catálogo. Solo la lectura completa produce una skill.
- [ ] Añadir casos de dos rutas con igual nombre, ruta relativa con cwd conocido, cwd desconocido,
  lectura repetida y cambio posterior del archivo. No unir rutas cuya identidad sea incierta.
- [ ] Añadir casos de tools dentro de `exec`: contar únicamente llamadas internas demostrables.
  No deducir llamadas ejecutadas buscando nombres en JavaScript, comentarios o cadenas.
- [ ] Añadir tests de llamadas con igual `call_id` en sesiones diferentes y de contexto heredado:
  ninguna llamada ni lectura del padre aumenta los contadores o las cargas del hijo.
- [ ] Ejecutar `node --test tests/codex-session-model.test.js` y comprobar los fallos esperados.
- [ ] Implementar el analizador sin acceso a disco ni ejecución de comandos.
- [ ] Repetir el comando y exigir todos los tests aprobados.

## Task 3: Jerarquía de subagentes y combinación con Herdr

**Files:** `codex-family-model.js`, sus tests y fixtures.

**Interfaces:** `buildCodexFamily({ roots, sessions, relations, herdrAgents })` devuelve
`{ nodes, roots, diagnostics }`. Cada nodo conserva `id`, `sessionId`, `parentId`,
`terminal`, `origin`, `observedStatus`, `statusObservedAt`, `coverage`, `tools` y `skills`.
La identidad interna es `codex:<sessionId>`; `terminal` puede ser null.
`origin` distingue `herdr`, `codex` y `both`. `roots` contiene solo las sesiones vinculadas al
space; los agentes Herdr aún sin sesión permanecen visibles con su identidad existente.

- [ ] Escribir tests de raíz, hijo y nieto, y dos raíces del mismo proyecto en distintos spaces.
  Solo los descendientes demostrados de las raíces solicitadas entran en el árbol.
- [ ] Escribir tests de creación fallida, respuesta pendiente, hijo sin registro, padre ausente,
  ciclos y padres contradictorios. Una solicitud de creación no equivale a un hijo confirmado.
- [ ] Escribir tests de hijo reactivado y de hijo también registrado como helper de Herdr:
  aparece una vez cuando hay identidad compartida demostrada; no fusionar por nombre o carpeta.
- [ ] Escribir tests de estado final observado, espera con timeout y silencio posterior:
  ni el timeout ni el silencio acreditan que un hijo haya terminado o siga activo.
- [ ] Escribir tests de datos por nodo: una skill leída solo por el nieto no aparece en el padre,
  y las tools del hijo no se atribuyen a la raíz. No agregar contadores de toda la familia.
- [ ] Ejecutar `node --test tests/codex-family-model.test.js` y comprobar los fallos esperados.
- [ ] Implementar el árbol y la deduplicación conservando la evidencia de cada relación.
  Relaciones contradictorias quedan diagnosticadas, sin escoger un padre por recencia.
- [ ] Repetir el comando y exigir todos los tests aprobados.

## Task 4: Lector local y asociación automática

**Files:** `codex-session-reader.mjs` y `codex-session-reader.test.js`.

**Interfaces:** CLI `node codex-session-reader.mjs config` devuelve el directorio vigilable.
`node codex-session-reader.mjs snapshot --roots '["ID"]' --agents '[]' --cache-key KEY` devuelve
candidatos paginados, sesiones normalizadas y relaciones confirmadas de las raíces solicitadas.
`--roots` reserva las correcciones explícitas; `--agents` aporta terminal, título, cwd y creación.
La respuesta incluye asociaciones automáticas y las familias de sus raíces desde la primera lectura.
`node codex-session-reader.mjs cleanup --cache-key KEY` borra solo la caché temporal de ese panel.
`node codex-session-reader.mjs watch --cache-key KEY` espera como máximo 20 segundos a un cambio,
comparando tamaños, fechas e inodos con el snapshot anterior tras registrar los watchers.
Errores con códigos estables: `not_found`, `ambiguous`, `unreadable`, `unsupported`.
Respetar `CODEX_HOME` y, por defecto, `~/.codex`; nunca aceptar una ruta arbitraria desde la UI.

- [ ] Escribir tests usando directorios temporales: sesiones en la misma carpeta, ID duplicado,
  archivo ausente, acceso fallido, JSONL con última línea incompleta y formato desconocido.
- [ ] Añadir tests de compactación, archivo sustituido y contenido añadido entre consultas.
  Reiniciar el cursor cuando cambie el archivo; no duplicar observaciones ya procesadas.
- [ ] Añadir tests de descubrimiento de hijos fuera de la carpeta del padre, descendientes
  creados después de la consulta inicial e hijos finalizados. No buscar solo en el cwd raíz.
- [ ] Añadir tests de un hijo identificado sin archivo y otro con formato ilegible: devolver
  nodos con cobertura no disponible sin perder el resto de la familia.
- [ ] Ejecutar `node --test tests/codex-session-reader.test.js` y comprobar los fallos esperados.
- [ ] Implementar lectura por streaming y caché de eventos normalizados por sesión.
  No usar `readTextFile` para cargar registros enteros: Herdr lo limita a 1 MiB.
- [ ] Mantener cursores por archivo para procesar líneas nuevas; retener una última línea
  incompleta hasta su finalización. Reiniciar al truncarse o sustituirse el archivo.
- [ ] Añadir pruebas de notificación con descriptor de escritura abierto, carrera entre snapshot
  y registro del watcher, timeout y cancelación con cierre de todos los handles.
- [ ] Indexar metadatos de sesiones y relaciones, y actualizar el índice al refrescar familias.
  Analizar contenido solo para raíces vinculadas y descendientes confirmados. No excluir hijos
  por cwd diferente, falta de terminal propia o terminación previa.
- [ ] Paginar candidatos a 20 por página. Si una familia supera 512 KiB, devolver `too_large`
  explícito; no descartar silenciosamente skills o tools.
- [ ] Comprobar que stdout contiene solo JSON y no filtra conversaciones ni argumentos.
- [ ] Repetir los tests y exigir todos aprobados.

## Task 5: Integración asíncrona, árbol y detalle individual

**Files:** loader, sus tests, `main.js` y `ui.js`.

**Interfaces:** `createCodexSessionLoader({ execute, now })` produce
`load(roots, { force, page })`, `invalidate()` y `close()`.
`load` devuelve `{ status, identity, data, errorCode, observedAt }`.
Estados: `loading`, `ready`, `unlinked`, `unavailable`, `unsupported`.
`execute(args)` lo adapta `main.js` mediante `herdr.exec`, sin construir comandos de shell.
`identity` identifica la consulta de raíces vinculadas y página; `data` contiene sus familias.
La selección de un nodo
interno usa `codex:<sessionId>`, sin exigir dirección de terminal.

- [ ] Escribir tests de invalidación por cambios, consultas simultáneas, fallo del lector,
  cambio de agente durante consulta y sustitución de sesión con la misma terminal.
- [ ] Verificar eventos durante consultas, agrupación de ráfagas, fallo del watcher, recuperación
  por sondeo y cierre del panel sin consultas posteriores.
- [ ] Añadir tests de nuevo descendiente tras refresco, selección de hijo que termina y
  respuesta tardía tras cambiar de space. Mantener la selección de un hijo histórico existente.
- [ ] Ejecutar `node --test tests/codex-session-loader.test.js` y comprobar los fallos esperados.
- [ ] Implementar el loader; cachear por máquina, terminal, creación y sesión.
- [ ] Registrar la vigilancia antes de la lectura inicial mediante `watchFolder` y `cx.spawn`.
  Vigilar todo el directorio de sesiones para descubrir hijos y subdirectorios nuevos.
- [ ] Tras el snapshot inicial, armar avisos por archivo con Node. Cada aviso invalida la caché,
  agrupa escrituras durante 150 ms y espera al snapshot actualizado antes de rearmarse.
  Comprobar cambios ocurridos en ese intervalo mediante las firmas del snapshot.
- [ ] Invalidar y agrupar cambios durante 150 ms; repetir la consulta si llegan eventos mientras
  está ejecutándose. No retrasar una invalidación por una caché de tiempo.
- [ ] Consultar al abrir y reconciliar cada 30 segundos como respaldo. Reintentar vigilancia
  fallida en ese ciclo, sin bucles de error continuos. Cancelar suscripciones al cerrar.
  Los hijos deben descubrirse sin seleccionar antes a su padre. Un resultado atrasado solo
  actualiza la identidad solicitada y nunca la selección actual.
- [ ] Mostrar hijos y descendientes anidados, seleccionables, con nombre o ID y estado observado.
  Distinguir visualmente los subagentes internos y los helpers de terminal sin duplicar nodos.
  Conservar el contador existente de helpers Herdr y añadir el de subagentes internos confirmado.
- [ ] Mostrar «Tools declaradas en la sesión», «Tools utilizadas» y «Skills cargadas».
  Para skills mostrar nombre, ruta y hora de la evidencia; no analizar su aplicación.
- [ ] Mostrar el método de detección automática y botón de corrección opcional con nombres legibles.
  Reintentar coincidencias pendientes con nueva actividad; permitir volver al modo automático.
- [ ] En el detalle de cada hijo mostrar padre, ID de sesión, cobertura, tools y skills propias.
  Ofrecer «Ver terminal en Herdr» solo si el nodo tiene una terminal acreditada. Cuando no la
  tenga, permitir navegar al padre sin inventar una terminal para el hijo.
- [ ] Distinguir «Sin cargas confirmadas en el historial analizado» de «Sesión sin vincular»,
  «Lectura no disponible» y «Cobertura parcial». En agentes no Codex indicar alcance pendiente.
- [ ] Ejecutar los tests del loader y `npm test`; exigir todos aprobados.

## Task 6: Verificación nativa y documentación

**Files:** `README.md` y ajustes necesarios en los archivos anteriores.

- [ ] Actualizar instalación: copiar también `.mjs`, comprobar disponibilidad de Node.js y
  explicar la asociación de sesión, los estados de cobertura y el criterio de skill cargada.
- [ ] Ejecutar `npm test`, `herdr-app check mods/mission-control` y
  `herdr-app check mods/mission-control-launcher`; exigir código de salida cero.
- [ ] Probar en Herdr con dos Codex en el mismo directorio: seleccionar cada uno, cambiar de
  space, cargar una skill, repetir su lectura y ejecutar una tool. Verificar que no se mezclan.
- [ ] Crear un hijo y un nieto desde una raíz Codex vinculada. Leer una skill solo en el hijo
  y ejecutar una tool solo en el nieto. Comprobar descubrimiento y atribución individuales.
- [ ] Finalizar y reactivar un hijo; comprobar que conserva identidad e historial sin duplicarse.
  Verificar también hijo sin registro y subagente sin terminal propia.
- [ ] Probar sesión ilegible y lector ausente: el inventario de agentes debe seguir funcionando.
- [ ] Medir detección desde escritura en disco hasta actualización; distinguirla del tiempo
  anterior a que Codex escriba. Probar watcher, respaldo, escrituras partidas y cierre del panel.
- [ ] Revisar visualmente listas largas, ancho reducido y los estados asíncronos. El check de
  Herdr solo valida la descripción inicial y no sustituye esta prueba.
- [ ] Verificar líneas Markdown de hasta 100 caracteres, salvo enlaces y tablas.
- [ ] Revisar diff y registrar por separado limitaciones observadas y comprobaciones pendientes.

## Fuera de alcance

Hooks, modificaciones de Codex, evaluación del uso de skills, contenido de conversaciones,
inventario global del equipo, garantías sobre todas las formas posibles de leer archivos,
sesiones remotas y soporte de Claude Code.
Los subagentes internos de Codex y sus descendientes sí están incluidos en la primera entrega.

## Evidencia y decisiones durante la implementación

- `session_meta.id` identifica el hilo; `session_id` puede ser común a padre e hijos.
- `parent_thread_id` y `source.subagent.thread_spawn.parent_thread_id` prueban relaciones.
- Los historiales paginados con `subagent_history_start_ordinal` permiten excluir registros
  heredados anteriores a ese ordinal. Si falta un límite verificable, la atribución es parcial.
- El contrato de identidad e historial está descrito también en los
  [tipos de Codex](https://github.com/openai/codex/blob/main/codex-rs/thread-store/src/types.rs).
- Se usa un proceso Node por snapshot y una espera acotada por notificación; no un daemon.
- La caché temporal conserva solo cursores y metadatos normalizados, sin contenido de conversación.
- Se admiten lecturas literales con `cat`, también cadenas compuestas exclusivamente de `cat`
  unidas por `&&`, si todo el resultado termina correctamente y sin truncación.
- Los wrappers dinámicos y resultados repartidos entre varios fragmentos no confirman cargas.
- El árbol usa la identidad `codex:<id de hilo>`. El contexto heredado nunca se suma al hijo.
- La lista del selector se mantiene estable mientras está abierto, aunque lleguen nuevos registros.
- La resolución inicial de Node consulta el shell de inicio si Herdr Core no lo encuentra en PATH.
  Se comprobó con una instalación nvm; no cambia archivos de configuración del shell.
- El borrado de caché al cerrar es de mejor esfuerzo: un proceso lector ya iniciado puede acabar
  después del callback de cierre y dejar metadatos temporales. No se conservan conversaciones.
- La medición nativa detectó que `watchFolder` no notificaba los append continuos en esta
  instalación macOS. Se añadió `fs.watch` por archivo: la prueba mantuvo abierto el descriptor
  de escritura y confirmó el aviso. Las esperas cierran todos sus handles tras aviso o timeout.
- Una espera Node ya iniciada puede terminar hasta 20 segundos después del cierre del panel.
- Medición en la aplicación: 191 ms entre escritura del registro y snapshot de metadatos.
- Corrección posterior solicitada: el usuario descarta exigir enlaces manuales. Las raíces se
  detectan por nombres del índice, carpeta y actividad, con asignación uno a uno y sin empates.
- La consulta de caché incluye el contexto de cada terminal. El índice de nombres también se vigila.
- Los descendientes siguen requiriendo relaciones estructuradas; el nombre solo vincula terminales
  con sesiones candidatas y no fabrica relaciones padre-hijo.
