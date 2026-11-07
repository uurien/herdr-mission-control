/** Serializes snapshots. Filesystem events invalidate immediately, even during a read. */
export function createCodexSessionLoader({ execute, now = () => Date.now() }) {
  let revision = 0; let dirty = true; let closed = false;
  let desired = null; let result = null; let pending = null;
  async function drain() {
    do {
      dirty = false;
      const version = revision; const request = desired;
      let next;
      try {
        const data = await execute({ roots: request.roots, agents: request.agents, page: request.page });
        if (data.errorCode) throw { code: data.errorCode };
        next = { status: 'ready', identity: request.key, data, errorCode: null, observedAt: now() };
      } catch (error) {
        const code = ['too_large', 'unsupported', 'node_unavailable'].includes(error?.code) ? error.code : 'unreadable';
        next = { status: 'unavailable', identity: request.key, data: null, errorCode: code, observedAt: now() };
      }
      if (closed) return { status: 'closed' };
      if (version === revision && request.key === desired.key) result = next;
      else dirty = true;
    } while (dirty);
    return result;
  }
  return {
    load(roots, { force = false, page = 0, agents = [] } = {}) {
      if (closed) return Promise.resolve({ status: 'closed' });
      const ids = [...new Set(roots)].sort();
      const probes = [...agents].sort((a, b) => a.terminal.localeCompare(b.terminal));
      const key = JSON.stringify({ roots: ids, agents: probes, page });
      if (desired?.key !== key || force) { desired = { roots: ids, agents: probes, page, key }; revision++; dirty = true; }
      if (pending) return pending;
      if (!dirty && result) return Promise.resolve(result);
      // drain starts synchronously so callers can safely invalidate immediately after load.
      pending = drain().finally(() => { pending = null; });
      return pending;
    },
    invalidate() { if (!closed) { revision++; dirty = true; } },
    close() { closed = true; revision++; },
  };
}
