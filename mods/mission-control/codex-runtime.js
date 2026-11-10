/** Resolve once, so nvm/mise installations work even when Core has a minimal PATH. */
export async function resolveNodeCommand(execute) {
  for (const [command, args] of [
    ['node', ['-p', 'process.execPath']],
    ['/bin/sh', ['-c', 'exec "${SHELL:-/bin/sh}" -lic \'node -p process.execPath\'']],
  ]) {
    try {
      const result = await execute(command, args);
      const lastLine = result.stdout?.trim().split(/\r?\n/).at(-1);
      if (result.code === 0 && lastLine && (/^\//.test(lastLine) || /^[a-z]:[\\/]/i.test(lastLine))) return lastLine;
    } catch { /* Try the user's login shell before declaring Node unavailable. */ }
  }
  throw { code: 'node_unavailable' };
}
