/** Schedule with the current GPUI callback context; never retain a cx for later use. */
export function createCodexWatchController({ invalidate, refresh }) {
  let scheduled = false; let closed = false;
  return {
    changed(schedule) {
      if (closed) return;
      invalidate();
      if (scheduled) return;
      scheduled = true;
      schedule(150, cx => { scheduled = false; if (!closed) refresh(cx); });
    },
    reconcile(cx) { if (!closed) { invalidate(); refresh(cx); } },
    close() { closed = true; },
  };
}
