# Compact skills implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this change inline.

**Goal:** Apply the approved compact skill list from `work/skill-options.html`.

**Architecture:** Keep detection unchanged. Render one collapsible row per skill, using the
existing native components. Store expansion in the panel, keyed by agent ID and full skill path.

**Tech stack:** Native Herdr GPUI components and JavaScript.

**Spec:** Approved conversation design: name and read count visible; path and dates on expansion.
The compact list was chosen over origin groups, a selector and a table. Only `SKILL.md` loads
are represented. No additional files or read evidence are introduced.

## Constraints and review focus

- Identical skill names at different paths must remain independent.
- Switching agents must not transfer expanded state.
- Refreshes must preserve expansion; closing and reopening a row must hide its metadata.
- Use singular/plural read labels and retain the full path in expanded details.
- Preserve the existing empty state and detection behavior.

## Task: Compact native rows

**Files:** `codex-detail.js`, `main.js`, `tests/codex-ui.test.js`, and `README.md`.

- [x] Add a component regression for default-hidden metadata, independent expansion and collapse.
- [x] Run the regression and confirm failure before changing the component.
- [x] Add `expandedSkills` and `onToggleSkill` panel options. Key by `[agent.id, skill.path]`.
- [x] Show a chevron, skill name and correctly pluralized count in a compact row. Reveal the
  full path and dates below the row when expanded. Add the total skill count to the heading.
- [x] Run the full test suite and both native mod checks; review the resulting change.
- [x] Update the installed mod, commit the explicit changed files and push the existing PR branch.

Validation: 87 tests pass; both native mod checks pass; installed Herdr reports no errors.
