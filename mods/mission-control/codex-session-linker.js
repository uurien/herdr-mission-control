const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const directory = value => {
  const p = String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:/i.test(p) ? p.toLowerCase() : p;
};
function titleKeys(value) {
  const title = normalize(value);
  const plain = title.replace(/\s+\|\s+[^|]*$/, '').replace(/^codex\s*[:·-]\s*/, '');
  if (['codex', 'codex-cli', 'terminal', 'shell'].includes(plain)) return [];
  return [...new Set([title, plain])].filter(s => s && !['codex', 'codex-cli', 'terminal', 'shell'].includes(s));
}
function score(agent, candidate, siblings, now) {
  const sameDirectory = Boolean(directory(agent.cwd)) && directory(agent.cwd) === directory(candidate.cwd);
  const agentNames = titleKeys(agent.title);
  const candidateNames = titleKeys(candidate.title);
  if (agentNames.some(a => candidateNames.includes(a))) {
    return { score: sameDirectory ? 120 : 100, method: sameDirectory ? 'title_and_directory' : 'title' };
  }
  if (sameDirectory && agentNames.some(a => /(?:…|\.\.\.)$/.test(a) && a.replace(/[…\.]+$/, '').length >= 12 &&
      candidateNames.some(c => c.startsWith(a.replace(/[…\.]+$/, ''))))) return { score: 95, method: 'title_and_directory' };
  if (!sameDirectory) return null;
  // A different specific name is contradictory evidence, not a reason to pick the latest file.
  if (agentNames.length && candidateNames.length) return null;
  const project = siblings.filter(c => directory(c.cwd) === directory(agent.cwd));
  if (project.length === 1) return { score: 60, method: 'unique_directory' };
  const since = Number.isFinite(agent.createdAt) ? agent.createdAt - 2000 : now - 300000;
  const active = project.filter(c => c.lastActiveAt >= since && c.lastActiveAt <= now + 300000);
  if (active.length === 1 && active[0].sessionId === candidate.sessionId) return { score: 70, method: 'directory_and_activity' };
  return null;
}

/** Rank human-readable names and context, then enforce a one-to-one assignment.
 * Explicit user links are reserved; tied evidence remains unresolved for a later refresh. */
export function resolveSessionLinks({ agents = [], candidates = [], reserved = [], now = Date.now() }) {
  const used = new Set(reserved);
  const proposals = []; const issues = [];
  for (const agent of agents) {
    const eligible = candidates.filter(c => !used.has(c.sessionId) &&
      ((!c.parentSessionId && !c.hasParentEvidence) || agent.isHelper));
    const names = titleKeys(agent.title);
    const namedElsewhere = candidates.some(c => !eligible.includes(c) &&
      names.some(name => titleKeys(c.title).includes(name)));
    const ranked = eligible.map(c => ({ candidate: c, match: score(agent, c, eligible, now) }))
      .filter(c => c.match && (!namedElsewhere || c.match.method.startsWith('title')))
      .sort((a, b) => b.match.score - a.match.score);
    if (!ranked.length || ranked[1]?.match.score === ranked[0].match.score) {
      issues.push({ terminal: agent.terminal, reason: ranked.length ? 'ambiguous' : 'not_found' }); continue;
    }
    proposals.push({ terminal: agent.terminal, createdAt: agent.createdAt ?? null,
      sessionId: ranked[0].candidate.sessionId, ...ranked[0].match });
  }
  const associations = [];
  for (const proposal of proposals) {
    const competitors = proposals.filter(p => p.sessionId === proposal.sessionId && p.terminal !== proposal.terminal);
    if (competitors.some(p => p.score >= proposal.score)) {
      issues.push({ terminal: proposal.terminal, reason: 'ambiguous' }); continue;
    }
    const { score: _score, ...association } = proposal;
    associations.push(association);
  }
  return { associations, issues };
}
