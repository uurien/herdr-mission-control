import path from 'node:path';

// Parse a deliberately small literal grammar. Never evaluate source from a rollout.
function literal(source) {
  let i = 0;
  const ws = () => { while (/\s/.test(source[i] ?? '') && i < source.length) i++; };
  function value(depth = 0) {
    if (depth > 12) throw Error('depth');
    ws();
    const c = source[i++];
    if (c === '"' || c === "'") {
      let result = '';
      while (i < source.length) {
        const ch = source[i++];
        if (ch === c) return result;
        if (ch === '\\') {
          const next = source[i++];
          const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '\\': '\\', '"': '"', "'": "'", '/': '/' };
          if (next === 'u') {
            const hex = source.slice(i, i + 4);
            if (!/^[\da-f]{4}$/i.test(hex)) throw Error('escape');
            result += String.fromCharCode(parseInt(hex, 16)); i += 4;
          } else if (Object.hasOwn(escapes, next)) result += escapes[next];
          else throw Error('escape');
        } else result += ch;
      }
      throw Error('string');
    }
    if (c === '{') {
      const result = Object.create(null);
      ws();
      while (source[i] !== '}') {
        ws(); let key;
        if (source[i] === '"' || source[i] === "'") key = value(depth + 1);
        else { const m = /^[a-zA-Z_$][\w$]*/.exec(source.slice(i)); if (!m) throw Error('key'); key = m[0]; i += key.length; }
        ws(); if (source[i++] !== ':') throw Error('colon');
        result[key] = value(depth + 1); ws();
        if (source[i] !== ',') break;
        i++; ws();
      }
      if (source[i++] !== '}') throw Error('object');
      return result;
    }
    i--;
    const token = /^(?:-?\d+(?:\.\d+)?|true|false|null)\b/.exec(source.slice(i));
    if (!token) throw Error('literal');
    i += token[0].length; return JSON.parse(token[0]);
  }
  try { const result = value(); ws(); return i === source.length ? result : null; }
  catch { return null; }
}

export function wrappedExec(input) {
  if (typeof input !== 'string' || input.length > 65536) return null;
  const match = /^\s*(?:\/\/[^\n]*\n)?\s*text\(\s*await\s+tools\.(exec_command|write_stdin)\(\s*([\s\S]*)\s*\)\s*\)\s*;?\s*$/.exec(input);
  if (!match) return null;
  const args = literal(match[2]);
  return args && typeof args === 'object' ? { name: match[1], args } : null;
}

export function skillReadPaths(cmd, cwd) {
  if (typeof cmd !== 'string' || /[\n\r`$;|<>*?(){}\[\]\\]/.test(cmd)) return [];
  const commands = [[]];
  let token = ''; let quote = null; let started = false;
  const push = () => { if (started) commands.at(-1).push(token); token = ''; started = false; };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) { if (c === quote) quote = null; else token += c; started = true; }
    else if (c === '"' || c === "'") { quote = c; started = true; }
    else if (c === '#' && !started || c === '~' && !started) return [];
    else if (/\s/.test(c)) push();
    else if (c === '&') {
      if (cmd[i + 1] !== '&') return [];
      push(); commands.push([]); i++;
    } else { token += c; started = true; }
  }
  if (quote) return [];
  push();
  const paths = [];
  for (const args of commands) {
    if (!['cat', '/bin/cat', '/usr/bin/cat'].includes(args.shift())) return [];
    if (args[0] === '--') args.shift();
    if (!args.length || args.some(a => !a || a.startsWith('-'))) return [];
    for (const file of args) if (path.basename(file) === 'SKILL.md') {
      if (!path.isAbsolute(file) && !cwd) return [];
      paths.push(path.resolve(cwd || '/', file));
    }
  }
  return paths;
}

export function unwrapResults(output) {
  if (Array.isArray(output)) {
    return output.flatMap(unwrapResults);
  }
  if (output && typeof output === 'object') {
    if (['text', 'input_text', 'output_text'].includes(output.type)) return unwrapResults(output.text);
    if (output.status === 'fulfilled') return unwrapResults(output.value);
    if (output.status === 'rejected') return [];
    return [output];
  }
  if (typeof output !== 'string') return [];
  try { return unwrapResults(JSON.parse(output)); } catch { /* Native text envelopes below. */ }
  const running = /Script running with cell ID\s+(\S+)/.exec(output);
  if (running) return [{ cell_id: running[1] }];
  const shell = /^.*?Process exited with code (\d+)\s*\n(?:Final output|Output):\s*\n([\s\S]*)$/s.exec(output);
  if (shell) return [{ exit_code: Number(shell[1]), output: shell[2], truncated: /truncat/i.test(output.split(/(?:Final output|Output):/)[0]) }];
  return [];
}

export function unwrapResult(output) {
  const results = unwrapResults(output);
  return results.find(x => x?.exit_code != null || x?.session_id != null || x?.agent_id || x?.id) ??
    results.find(x => x?.cell_id) ?? null;
}

// Native successful && chains prove that every literal command ran. Keep shell
// interpretation deliberately narrow; parsed_cmd alone does not prove execution.
export function commandSkillPaths(item, fallbackCwd) {
  const argv = item.command;
  if (!Array.isArray(argv) || argv.length !== 3 ||
      !['sh', 'bash', 'zsh', 'dash', 'ksh'].includes(path.basename(argv[0])) ||
      !['-c', '-lc'].includes(argv[1]) || typeof argv[2] !== 'string') return [];
  const commands = [[]];
  let token = '', quote = null, started = false;
  const push = () => { if (started) commands.at(-1).push(token); token = ''; started = false; };
  const script = argv[2];
  for (let i = 0; i < script.length; i++) {
    const c = script[i];
    if (quote) {
      if (c === quote) quote = null;
      else { if (c === '\\' || (quote === '"' && /[$`]/.test(c))) return []; token += c; }
      started = true;
    } else if (c === '"' || c === "'") { quote = c; started = true; }
    else if (/[\n\r`$;|<>*?(){}\[\]\\#~]/.test(c)) return [];
    else if (/\s/.test(c)) push();
    else if (c === '&') {
      if (script[++i] !== '&') return [];
      push(); commands.push([]);
    } else { token += c; started = true; }
  }
  if (quote) return [];
  push();
  const paths = [], cwd = item.cwd || fallbackCwd;
  for (const args of commands) {
    const executable = args[0];
    if (!executable || !['cat', 'pwd', 'ls', 'rg', 'sed', 'head', 'tail', 'echo'].includes(path.basename(executable)) ||
        (executable.includes('/') && !['/bin', '/usr/bin'].includes(path.dirname(executable)))) return [];
    if (path.basename(executable) !== 'cat') continue;
    const files = args.slice(args[1] === '--' ? 2 : 1);
    if (!files.length || files.some(f => !f || f.startsWith('-'))) return [];
    for (const file of files) if (path.basename(file) === 'SKILL.md') {
      if (!path.isAbsolute(file) && !cwd) return [];
      paths.push(path.resolve(cwd || '/', file));
    }
  }
  return [...new Set(paths)];
}

export function completeRead(result, maxTokens, exactOutput = false) {
  if (!result || result.exit_code !== 0 || typeof result.output !== 'string' ||
      result.session_id != null || result.truncated || result.is_truncated || result.output_truncated) return false;
  if (!exactOutput && /truncated (?:output|content)|output (?:was |has been )?truncated|\.\.\.\s*\d+ (?:tokens|characters) truncated/i.test(result.output)) return false;
  if (Number.isFinite(maxTokens) && result.original_token_count > maxTokens) return false;
  return true;
}
