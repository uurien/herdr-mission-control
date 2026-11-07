import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodexWatchController } from '../mods/mission-control/codex-watch-controller.js';

test('invalidates immediately and groups a burst into one 150ms refresh', () => {
  let invalidations = 0; let refreshes = 0; const scheduled = [];
  const controller = createCodexWatchController({ invalidate: () => invalidations++, refresh: () => refreshes++ });
  const schedule = (ms, run) => scheduled.push({ ms, run });
  controller.changed(schedule); controller.changed(schedule); controller.changed(schedule);
  assert.equal(invalidations, 3);
  assert.equal(refreshes, 0);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 150);
  scheduled[0].run({});
  assert.equal(refreshes, 1);
});

test('reconciliation refreshes without file events and closing suppresses scheduled work', () => {
  let refreshes = 0; const scheduled = [];
  const controller = createCodexWatchController({ invalidate() {}, refresh: () => refreshes++ });
  controller.reconcile({});
  assert.equal(refreshes, 1);
  controller.changed((ms, run) => scheduled.push(run));
  controller.close(); scheduled[0]({}); controller.reconcile({}); controller.changed(() => assert.fail());
  assert.equal(refreshes, 1);
});
