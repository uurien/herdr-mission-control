# Herdr Mission Control

A native monitor for Codex and Claude Code agents in the space containing the panel.
This first release uses only Herdr data, without hooks or simulated data.

It shows the program, reported title, status, terminal, tab, and helpers registered in Core.
Select a row to see its details; **Ver terminal en Herdr** (View terminal in Herdr) opens its
terminal.
Helpers listed in both the agent and terminal inventories appear only once.

Tools, skills, and internal provider subagents are planned for the next release.
Tab activity does not represent accumulated agent time. The status may read **Sin estado**
(No reported status) when the program does not report one, even if Herdr identifies the process.
The panel currently uses Spanish labels.

## Files

- `mods/mission-control/main.js`: panel content.
- `mods/mission-control/herdr-model.js`: space membership, inventory, and parent relationships.
- `mods/mission-control/ui.js`: native list and detail components.
- `mods/mission-control/mod.json`: mod name and initial placement.
- `mods/mission-control-launcher/`: sidebar button that opens the panel.
- `layouts/mission-control.json`: a custom Herdr layout containing that button.

## Open from Herdr

In the `mission-control` layout, click **Mission Control** at the bottom left, above **Settings**.
It opens a tab associated with the selected space. Closing the tab leaves the sidebar button in
place.
Switching spaces does not change the context of an existing panel. Selection is preserved when
reloading the same panel instance.

Tabs from the earlier Hello world version have no space context: close them and reopen from the
button.

If you switch layouts, return to `mission-control` through Settings or cycle through layouts with
`Cmd+Shift+L` on macOS. The original Herdr layout remains available.

## Check the mods

Run from the project root. No dependency installation is required:

```sh
npm test
herdr-app check mods/mission-control
herdr-app check mods/mission-control-launcher
```

## Install and open

Herdr loads mods from `~/.config/herdr-app/mods/`. For a first installation, make sure the
destination
names do not already exist, then copy both mods and the custom layout:

```sh
cp -R mods/mission-control ~/.config/herdr-app/mods/
cp -R mods/mission-control-launcher ~/.config/herdr-app/mods/
cp layouts/mission-control.json layouts/mission-control.svg ~/.config/herdr-app/layouts/
herdr-app do layout.switch --name mission-control
```

The last command activates the layout with the sidebar button. Setting `place: "none"` in the mods
lets the layout control their placement. Open the panel with the button so the launcher passes the
space ID to it.

To update an existing installation with project changes:

```sh
cp mods/mission-control/*.js ~/.config/herdr-app/mods/mission-control/
cp mods/mission-control-launcher/main.js ~/.config/herdr-app/mods/mission-control-launcher/
```

Herdr reloads a mod when its installed file is saved. To check for errors:

```sh
herdr-app status
```

To uninstall, close the panel tab and switch back to the original layout. Then remove the installed
`mods/mission-control` and `mods/mission-control-launcher` directories, along with
`layouts/mission-control.json` and `layouts/mission-control.svg`, from `~/.config/herdr-app`.
The project source remains in this directory.

## License

[MIT](LICENSE), copyright © 2026 Ugaitz Urien.
