# Herdr Mission Control

A native monitor for Codex and Claude Code agents in the space containing the panel.
The agent inventory comes from Herdr. Local Codex session records add tools, skills and internal
subagents, without hooks or simulated activity. Node.js 22.7 or newer is required; validated with
Node.js 24. The panel resolves Node from the application environment or the user's login shell,
including nvm installations, once at startup.

It shows the program, reported title, status, terminal, tab, and helpers registered in Core.
Select a row to see its details; **Ver terminal en Herdr** (View terminal in Herdr) opens its
terminal.
Helpers listed in both the agent and terminal inventories appear only once.

Tab activity does not represent accumulated agent time. The status may read **Sin estado**
(No reported status) when the program does not report one, even if Herdr identifies the process.
The panel currently uses Spanish labels.

## Codex tools, skills and subagents

Local Codex sessions link automatically. The reader compares Herdr's terminal titles with session
names in `session_index.jsonl`, using the directory to distinguish projects. Generic Codex titles
can use a unique project session or a uniquely active record since that terminal started. Two
terminals never automatically claim the same session, and equal matches remain pending until more
evidence arrives. The detail explains how the session was detected.

There is no required UUID selection. **Corregir vinculación** optionally selects a session by its
readable name and project. Explicit corrections take priority and are remembered for the terminal's
creation identity when Herdr provides one. **Usar vinculación automática** clears that override.
The candidate list stays fixed while the picker is open; use **Actualizar registros** or change
pages to refresh it deliberately. The underlying thread ID is `session_meta.id`; `session_id` can
be shared by an entire family.

The panel discovers confirmed children and descendants of linked threads, including ones without
their own terminal. Select a child to see its own data. Completed children remain in the tree;
their status is the last state observed in the record, not a claim that the process is still live.
Only nodes with a confirmed terminal offer **Ver terminal en Herdr**.

- **Tools declaradas en la sesión**: recorded tool declarations, not necessarily a complete or
  currently available inventory.
- **Tools utilizadas**: recorded call attempts and counts, regardless of execution success.
- **Skills cargadas**: confirmed complete successful reads of `SKILL.md`, with path and timestamps.
  Catalog entries, mentions, partial reads and failed calls do not count. Application of a skill's
  instructions and the quality of the agent's work are not evaluated.

MCP calls recorded as structured completion events appear as `server.tool`, such as
`context7.query-docs` or `playwright.browser_tabs`, including calls made inside `exec`.
The outer `exec` is counted separately. Tool names mentioned in scripts or output do not prove a
call. An analyzer update rebuilds older cached histories so previously missed calls can reappear.
Both tool lists are grouped into collapsible provider sections, such as Playwright, Context7,
Colaboración and Funciones. Headers show distinct tool totals and, for used tools, total calls.
Expand a provider to see local tool names, individual counts and last-call times. Expansion is
kept separately for each agent and list while the panel stays open.
Skills use compact collapsible rows: the name and read count stay visible, while the full path
and first/last read timestamps appear on expansion. Expansion is independent for each agent and
skill path, including skills with the same name installed in different directories.

Supported skill evidence includes literal `cat` reads, including chains of `cat` joined with `&&`,
through recorded `exec_command` calls. A single literal `text(await tools.exec_command({...}));`
wrapper is also supported. Native command receipts recover reads inside parallel or multi-call
wrappers when the successful command's full output matches the delivered output by SHA-256.
Literal `&&` chains can include `cat`, `pwd`, `ls`, `rg`, `sed`, `head`, `tail` and `echo`;
only complete `cat` reads confirm skill loads. Text blocks and fulfilled parallel-result envelopes
are recognized. Hashes and paths are retained, without command output or skill contents.
Scripts with dynamic commands, arbitrary JavaScript, pipelines, range reads and partial output
across process polls are not inferred to be full reads. Truncated output is rejected.
Other reading methods can be added once their full-read evidence has been verified.

Inherited history does not count as the child's own calls or skill loads. If the record lacks a
verifiable inheritance boundary, the child's activity is marked as partial rather than attributed
speculatively. Missing or unreadable records are distinct from no confirmed loads.

Updates follow notifications on individual Codex records and the sessions directory, grouping
bursts for 150 ms. File watches detect appended data even when Codex keeps a record open.
A 30-second reconciliation recovers missed events and retries failed watching. This avoids
a fixed polling delay during normal operation, but still depends on when Codex writes its records.
Closing the panel stops further refreshes. The footer indicates when fallback polling is active.
File watches run in bounded requests of up to 20 seconds, within Herdr's execution timeout; an
already-started request may finish after closing the panel. No background daemon is installed.
Watching more than 4096 records falls back to reconciliation.

The reader respects `CODEX_HOME`, defaulting to `~/.codex`. Incremental cursors and normalized
metadata are cached per panel in the OS temporary directory; prompts, tool arguments, tool outputs
and skill contents are not retained there or returned to the panel. Close attempts to remove the
cache; shutdown or a reader already in flight may leave it in the temporary directory.
Responses over 512 KiB fail
explicitly instead of silently omitting evidence. Candidate sessions are paginated.

Claude Code session details and remote Codex records are not supported yet; their Herdr inventory
continues to work.

## Files

- `mods/mission-control/main.js`: panel content.
- `mods/mission-control/herdr-model.js`: space membership, inventory, and parent relationships.
- `mods/mission-control/ui.js`: native list and detail components.
- `mods/mission-control/codex-detail.js`: tools, skills and session selection components.
- `mods/mission-control/codex-tool-groups.js`: provider grouping and display-name aliases.
- `mods/mission-control/codex-session-reader.mjs`: local Node.js reader and metadata cache.
- `mods/mission-control/codex-session-watch.mjs`: bounded file notifications and gap detection.
- `mods/mission-control/codex-session-model.js`: tool calls, declarations and skill evidence.
- `mods/mission-control/codex-read-evidence.js`: conservative full-read recognition.
- `mods/mission-control/codex-family-model.js`: confirmed thread hierarchy and Herdr deduplication.
- `mods/mission-control/codex-session-loader.js`: serialized snapshots and invalidation.
- `mods/mission-control/codex-session-linker.js`: automatic name/context matching and conflicts.
- `mods/mission-control/codex-watch-controller.js`: event batching and fallback refresh.
- `mods/mission-control/codex-runtime.js`: Node.js resolution, including login-shell installations.
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
cp mods/mission-control/*.mjs ~/.config/herdr-app/mods/mission-control/
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
