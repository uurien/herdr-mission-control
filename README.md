# Herdr Mission Control

Monitor nativo de los agentes de Codex y Claude Code del space que contiene el panel.
Esta primera entrega utiliza únicamente datos de Herdr, sin hooks ni datos simulados.

Muestra programa, título comunicado, estado, terminal, pestaña y helpers registrados en Core.
Seleccionar una fila muestra su detalle; **Ver terminal en Herdr** abre esa terminal.
Los helpers no se duplican entre la lista de agentes y la de terminales.

Las tools, skills y subagentes internos de los proveedores se incorporarán en la siguiente entrega.
La actividad del tab no representa tiempo acumulado del agente. El estado puede aparecer como
**Sin estado** si el programa no lo comunica, aunque Herdr identifique el proceso.

## Archivos

- `mods/mission-control/main.js`: contenido del panel.
- `mods/mission-control/herdr-model.js`: pertenencia al space, inventario y parentesco.
- `mods/mission-control/ui.js`: elementos nativos de la lista y el detalle.
- `mods/mission-control/mod.json`: nombre y ubicación inicial del mod.
- `mods/mission-control-launcher/`: botón para abrir el panel desde la barra lateral.
- `layouts/mission-control.json`: copia personal del layout de Herdr con ese botón.

## Abrir desde Herdr

En el layout `mission-control`, pulsar **Mission Control** abajo a la izquierda, encima de
**Settings**. Abre una pestaña asociada al space seleccionado. Cerrar la pestaña conserva el botón.
Cambiar de space no cambia el contexto de un panel ya abierto. La selección se conserva al
recargar la misma instancia del panel.

Las pestañas del Hello world anterior no tienen contexto: cerrarlas y abrir el panel desde el botón.

Si se cambia de layout, volver a `mission-control` desde Settings o recorrer los layouts con
`Cmd+Shift+L` en macOS. El layout original de Herdr también sigue disponible.

## Comprobar el mod

Desde la raíz de este proyecto, sin instalar dependencias:

```sh
npm test
herdr-app check mods/mission-control
herdr-app check mods/mission-control-launcher
```

## Instalar y abrir

Herdr carga los mods desde `~/.config/herdr-app/mods/`. Para una primera instalación, comprobar
que los nombres de destino no existan y copiar los dos mods y el layout personal:

```sh
cp -R mods/mission-control ~/.config/herdr-app/mods/
cp -R mods/mission-control-launcher ~/.config/herdr-app/mods/
cp layouts/mission-control.json layouts/mission-control.svg ~/.config/herdr-app/layouts/
herdr-app do layout.switch --name mission-control
```

El último comando activa el layout con el botón. `place: "none"` en los mods deja que el layout
decida dónde se muestran. Usar el botón para que el launcher pase el ID del space al panel.

Para actualizar una instalación propia con cambios del proyecto:

```sh
cp mods/mission-control/*.js ~/.config/herdr-app/mods/mission-control/
cp mods/mission-control-launcher/main.js ~/.config/herdr-app/mods/mission-control-launcher/
```

Herdr recarga el mod al guardar el archivo instalado. Para revisar errores:

```sh
herdr-app status
```

Para retirar la prueba, cerrar su pestaña y volver al layout original. Después, eliminar las
carpetas instaladas `mods/mission-control` y `mods/mission-control-launcher`, y los archivos
`layouts/mission-control.json` y `layouts/mission-control.svg` dentro de `~/.config/herdr-app`.
El código del proyecto permanece aquí.

## Licencia

[MIT](LICENSE), copyright © 2026 Ugaitz Urien.
