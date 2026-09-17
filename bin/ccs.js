#!/usr/bin/env node
'use strict';
/*
 * claude-session-picker — a session picker for Claude Code.
 *
 * Lists your Claude Code sessions across every project, shows which ones are
 * open right now, and resumes the one you pick (`claude --resume <id>`) in the
 * folder it was started from.
 *
 * Read-only on Claude Code's data. Zero dependencies. Unofficial: it reads
 * undocumented local files, so a Claude Code update may change what it sees.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');

const VERSION = require('../package.json').version;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 256 * 1024; // bytes read from the head and the tail of a transcript

// ───────────────────────────── i18n ─────────────────────────────
const STR = {
  en: {
    help: `claude-session-picker ${VERSION} — pick a Claude Code session and resume it

Usage
  ccs                     interactive picker (all projects, newest first)
  ccs list                print the list and exit
  ccs open <id|prefix>    resume one session directly
  ccs pin <id|prefix> [label]   keep a session at the top, optionally renamed
  ccs unpin <id|prefix>

Options
  --here            only sessions started in the current folder (or below)
  --pinned          only pinned sessions
  --limit <n>       how many to show (default 20, 0 = all)
  --rc              add --remote-control when resuming
  --dry-run         print the command instead of running it
  --json            machine-readable output (with list)
  -i, --interactive force the picker when the terminal is not detected
                    (Git Bash / mintty on Windows needs this)
  --lang <en|ko>    interface language (default: from your locale)
  -- <args>         everything after -- is passed to claude as is
  -h, --help / -v, --version

In the picker:  number = resume · text = filter · p <n> = pin/unpin
                a = all/here · r = remote control on/off · q = quit`,
    noDir: (d) => `No Claude Code data found at ${d}. Run claude once, or set CLAUDE_CONFIG_DIR.`,
    noSessions: 'No sessions found.',
    header: (n, total, scope) => `Claude Code sessions — showing ${n} of ${total} (${scope})`,
    scopeAll: 'all projects', scopeHere: 'this folder', scopePinned: 'pinned',
    rcOn: 'remote control: on', rcOff: 'remote control: off',
    prompt: 'number / filter text / p <n> / a / r / q > ',
    openNow: 'open now', untitled: '(untitled)',
    legend: '★ pinned   ● open right now in another window',
    filter: (f) => `filter: "${f}" (empty line clears it)`,
    badNumber: 'No such number.',
    liveWarn: (who) => `This session is already open (${who}). Two windows writing one conversation can scramble it.`,
    liveAsk: 'Resume anyway? [y/N] ',
    cancelled: 'Cancelled.',
    running: (cmd, cwd) => `→ ${cmd}\n  in ${cwd}`,
    cwdMissing: (d) => `(original folder is gone: ${d} — starting from the current folder)`,
    noClaude: 'Could not find the `claude` command. Install Claude Code first: https://claude.com/claude-code',
    ambiguous: (p, n) => `"${p}" matches ${n} sessions. Use more characters.`,
    notFound: (p) => `No session matches "${p}".`,
    pinned: (t) => `Pinned: ${t}`, unpinned: (t) => `Unpinned: ${t}`,
    needId: 'Give a session id or its first few characters.',
    ago: { now: 'just now', m: (n) => `${n}m ago`, h: (n) => `${n}h ago`, d: (n) => `${n}d ago`, mo: (n) => `${n}mo ago` },
  },
  ko: {
    help: `claude-session-picker ${VERSION} — Claude Code 세션을 골라서 이어받기

사용법
  ccs                     대화형 선택기 (모든 프로젝트, 최근순)
  ccs list                목록만 출력하고 종료
  ccs open <id|앞글자>     세션 하나를 바로 이어받기
  ccs pin <id|앞글자> [이름]   맨 위에 고정 (이름을 붙일 수 있음)
  ccs unpin <id|앞글자>

옵션
  --here            지금 폴더(와 그 아래)에서 시작한 세션만
  --pinned          고정한 세션만
  --limit <n>       몇 개 보여줄지 (기본 20, 0 = 전부)
  --rc              이어받을 때 --remote-control 을 붙임
  --dry-run         실행하지 않고 명령만 출력
  --json            기계가 읽는 출력 (list 와 함께)
  -i, --interactive 터미널로 인식되지 않을 때 선택기를 강제로 띄움
                    (Windows 의 Git Bash / mintty 에서 필요)
  --lang <en|ko>    표시 언어 (기본: 시스템 언어)
  -- <인자>          -- 뒤는 그대로 claude 에 전달
  -h, --help / -v, --version

선택기 안에서:  번호 = 이어받기 · 글자 = 검색 · p <번호> = 고정/해제
               a = 전체/이 폴더 · r = 원격 제어 켜기/끄기 · q = 종료`,
    noDir: (d) => `${d} 에 Claude Code 데이터가 없습니다. claude 를 한 번 실행하거나 CLAUDE_CONFIG_DIR 을 지정하세요.`,
    noSessions: '세션이 없습니다.',
    header: (n, total, scope) => `Claude Code 세션 — ${total}개 중 ${n}개 표시 (${scope})`,
    scopeAll: '모든 프로젝트', scopeHere: '이 폴더', scopePinned: '고정',
    rcOn: '원격 제어: 켜짐', rcOff: '원격 제어: 꺼짐',
    prompt: '번호 / 검색어 / p <번호> / a / r / q > ',
    openNow: '지금 열려 있음', untitled: '(제목 없음)',
    legend: '★ 고정   ● 다른 창에서 지금 열려 있음',
    filter: (f) => `검색: "${f}" (빈 줄을 입력하면 해제)`,
    badNumber: '그런 번호가 없습니다.',
    liveWarn: (who) => `이 세션은 이미 열려 있습니다 (${who}). 같은 대화를 두 창에서 쓰면 기록이 엇갈릴 수 있습니다.`,
    liveAsk: '그래도 이어받을까요? [y/N] ',
    cancelled: '취소했습니다.',
    running: (cmd, cwd) => `→ ${cmd}\n  위치: ${cwd}`,
    cwdMissing: (d) => `(원래 폴더가 없습니다: ${d} — 현재 폴더에서 시작합니다)`,
    noClaude: '`claude` 명령을 찾지 못했습니다. 먼저 Claude Code 를 설치하세요: https://claude.com/claude-code',
    ambiguous: (p, n) => `"${p}" 로 시작하는 세션이 ${n}개입니다. 글자를 더 입력하세요.`,
    notFound: (p) => `"${p}" 에 해당하는 세션이 없습니다.`,
    pinned: (t) => `고정: ${t}`, unpinned: (t) => `고정 해제: ${t}`,
    needId: '세션 id 또는 앞 몇 글자를 주세요.',
    ago: { now: '방금', m: (n) => `${n}분 전`, h: (n) => `${n}시간 전`, d: (n) => `${n}일 전`, mo: (n) => `${n}달 전` },
  },
};

function detectLang(explicit) {
  if (explicit && STR[explicit]) return explicit;
  const env = process.env.CCS_LANG || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  let loc = env;
  try { if (!loc) loc = Intl.DateTimeFormat().resolvedOptions().locale; } catch { /* keep default */ }
  return /^ko/i.test(loc) ? 'ko' : 'en';
}

// ───────────────────────────── paths & config ─────────────────────────────
function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}
function configFile() {
  return process.env.CCS_CONFIG || path.join(os.homedir(), '.config', 'claude-session-picker', 'config.json');
}
function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    return { pins: {}, ...c };
  } catch { return { pins: {} }; }
}
function saveConfig(cfg) {
  const f = configFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n');
}

// ───────────────────────────── transcript scanning ─────────────────────────────
function readChunk(file, start, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, start);
    return buf.toString('utf8', 0, n);
  } finally { fs.closeSync(fd); }
}

/** Parse JSON lines, tolerating a cut-off first and/or last line. */
function parseLines(text, { dropFirst = false, dropLast = false } = {}) {
  const lines = text.split('\n');
  if (dropFirst) lines.shift();
  if (dropLast) lines.pop();
  const out = [];
  for (const line of lines) {
    if (!line || line[0] !== '{') continue;
    try { out.push(JSON.parse(line)); } catch { /* partial or foreign line */ }
  }
  return out;
}

function promptText(rec) {
  if (!rec || rec.type !== 'user' || rec.isMeta || rec.isSidechain || rec.isCompactSummary) return null;
  let c = rec.message && rec.message.content;
  if (Array.isArray(c)) c = c.filter((x) => x && x.type === 'text').map((x) => x.text).join(' ');
  if (typeof c !== 'string') return null;
  c = c.trim();
  if (!c || c[0] === '<') return null; // tool results, command wrappers, reminders
  return c.replace(/\s+/g, ' ');
}

function scanSession(file) {
  const st = fs.statSync(file);
  if (!st.size) return null;
  const id = path.basename(file, '.jsonl');
  const whole = st.size <= CHUNK;
  const head = parseLines(readChunk(file, 0, Math.min(CHUNK, st.size)), { dropLast: !whole });
  const tail = whole ? head : parseLines(readChunk(file, st.size - CHUNK, CHUNK), { dropFirst: true });

  const s = { id, file, size: st.size, mtime: st.mtimeMs, cwd: null, branch: null,
    customTitle: null, aiTitle: null, firstPrompt: null, lastPrompt: null, pr: null };

  for (const r of head) {
    if (!s.cwd && typeof r.cwd === 'string') { s.cwd = r.cwd; s.branch = r.gitBranch || null; }
    if (!s.firstPrompt) s.firstPrompt = promptText(r);
    if (s.cwd && s.firstPrompt) break;
  }
  const latest = (recs) => {
    for (const r of recs) {
      if (r.type === 'custom-title' && r.customTitle) s.customTitle = r.customTitle;
      else if (r.type === 'ai-title' && r.aiTitle) s.aiTitle = r.aiTitle;
      else if (r.type === 'last-prompt' && r.lastPrompt) s.lastPrompt = String(r.lastPrompt).replace(/\s+/g, ' ');
      else if (r.type === 'pr-link' && r.prUrl) s.pr = r.prUrl;
      if (typeof r.gitBranch === 'string' && r.gitBranch) s.branch = r.gitBranch;
    }
  };
  latest(head);
  if (!whole) latest(tail); // later records win
  if (!s.cwd && !s.firstPrompt && !s.customTitle && !s.aiTitle) return null; // not a conversation
  return s;
}

function listSessions() {
  const root = path.join(claudeDir(), 'projects');
  let dirs;
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()); }
  catch { return null; }
  const out = [];
  for (const d of dirs) {
    let files;
    try { files = fs.readdirSync(path.join(root, d.name)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl') || !UUID_RE.test(f.slice(0, -6))) continue;
      try { const s = scanSession(path.join(root, d.name, f)); if (s) out.push(s); } catch { /* unreadable */ }
    }
  }
  return out;
}

// ───────────────────────────── live sessions ─────────────────────────────
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}
function liveSessions() {
  const dir = path.join(claudeDir(), 'sessions');
  const map = new Map();
  let files;
  try { files = fs.readdirSync(dir); } catch { return map; }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!j || !j.sessionId || !Number.isInteger(j.pid)) continue;
      if (!pidAlive(j.pid)) continue;
      const list = map.get(j.sessionId) || [];
      list.push({ pid: j.pid, name: j.name || null, status: j.status || null, entrypoint: j.entrypoint || null });
      map.set(j.sessionId, list);
    } catch { /* stale or foreign file */ }
  }
  return map;
}

// ───────────────────────────── presentation ─────────────────────────────
function charWidth(cp) {
  return (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || cp >= 0x1f300 ? 2 : 1;
}
function fit(text, width) {
  let w = 0, out = '';
  for (const ch of text) {
    const cw = charWidth(ch.codePointAt(0));
    if (w + cw > width - 1) { out += '…'; w += 1; break; }
    out += ch; w += cw;
  }
  return out + ' '.repeat(Math.max(0, width - w));
}
function ago(ms, t) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return t.ago.now;
  if (m < 60) return t.ago.m(m);
  if (m < 1440) return t.ago.h(Math.floor(m / 60));
  if (m < 43200) return t.ago.d(Math.floor(m / 1440));
  return t.ago.mo(Math.floor(m / 43200));
}
function titleOf(s, cfg, t) {
  return cfg.pins[s.id] || s.customTitle || s.aiTitle || s.firstPrompt || s.lastPrompt || t.untitled;
}
function isUnder(child, parent) {
  if (!child) return false;
  const norm = (p) => { const r = path.resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
  const rel = path.relative(norm(parent), norm(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function select(all, cfg, opts, filterText, t) {
  let rows = all;
  if (opts.pinned) rows = rows.filter((s) => s.id in cfg.pins);
  if (opts.here) rows = rows.filter((s) => isUnder(s.cwd, process.cwd()));
  if (filterText) {
    const q = filterText.toLowerCase();
    rows = rows.filter((s) => `${titleOf(s, cfg, t)} ${s.cwd || ''} ${s.branch || ''} ${s.id}`.toLowerCase().includes(q));
  }
  rows = rows.slice().sort((a, b) => ((b.id in cfg.pins) - (a.id in cfg.pins)) || (b.mtime - a.mtime));
  const total = rows.length;
  if (opts.limit > 0) rows = rows.slice(0, opts.limit);
  return { rows, total };
}

function render(rows, total, cfg, live, opts, filterText, t) {
  const cols = Math.max(60, Math.min(process.stdout.columns || 100, 140));
  const scope = opts.pinned ? t.scopePinned : opts.here ? t.scopeHere : t.scopeAll;
  const lines = ['', `${t.header(rows.length, total, scope)} · ${opts.rc ? t.rcOn : t.rcOff}`];
  if (filterText) lines.push(t.filter(filterText));
  lines.push('');
  const projW = 18, ageW = 9, fixed = 4 + 2 + projW + 1 + ageW + 1 + 8;
  const titleW = Math.max(20, cols - fixed);
  rows.forEach((s, i) => {
    const mark = (s.id in cfg.pins ? '★' : ' ') + (live.has(s.id) ? '●' : ' ');
    const proj = s.cwd ? path.basename(s.cwd) || s.cwd : '?';
    lines.push(`${String(i + 1).padStart(3)} ${mark}${fit(titleOf(s, cfg, t), titleW)}${fit(proj, projW)} ${fit(ago(s.mtime, t), ageW)} ${s.id.slice(0, 8)}`);
  });
  if (!rows.length) lines.push(`  ${t.noSessions}`);
  lines.push('', `  ${t.legend}`, '');
  return lines.join('\n');
}

// ───────────────────────────── launching claude ─────────────────────────────
function findClaude() {
  if (process.env.CCS_CLAUDE_BIN) return process.env.CCS_CLAUDE_BIN;
  if (process.platform !== 'win32') return 'claude';
  const r = spawnSync('where', ['claude'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const found = r.stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return found.find((p) => /\.exe$/i.test(p)) || found.find((p) => /\.(cmd|bat)$/i.test(p)) || null;
}
const winQuote = (a) => (/^[\w.:\\/=@-]+$/.test(a) ? a : `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`);

function resume(session, opts, t) {
  const args = ['--resume', session.id];
  if (opts.rc) args.push('--remote-control');
  args.push(...opts.passthrough);
  let cwd = process.cwd();
  if (session.cwd && fs.existsSync(session.cwd)) cwd = session.cwd;
  else if (session.cwd) console.log(t.cwdMissing(session.cwd));
  console.log(t.running(['claude', ...args].join(' '), cwd));
  if (opts.dryRun) return Promise.resolve(0);

  const bin = findClaude();
  if (!bin) { console.error(t.noClaude); return Promise.resolve(127); }
  let child;
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    const line = [bin, ...args].map(winQuote).join(' ');
    child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { cwd, stdio: 'inherit', windowsVerbatimArguments: true });
  } else {
    child = spawn(bin, args, { cwd, stdio: 'inherit' });
  }
  return new Promise((resolve) => {
    child.on('error', (e) => { console.error(e.code === 'ENOENT' ? t.noClaude : String(e)); resolve(127); });
    child.on('exit', (code) => resolve(code == null ? 1 : code));
  });
}

// ───────────────────────────── commands ─────────────────────────────
function parseArgs(argv) {
  const o = { cmd: null, words: [], interactive: false, here: false, pinned: false, limit: 20, rc: false, dryRun: false, json: false, lang: null, passthrough: [], help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { o.passthrough = argv.slice(i + 1); break; }
    else if (a === '--here') o.here = true;
    else if (a === '--pinned') o.pinned = true;
    else if (a === '--rc' || a === '--remote-control') o.rc = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--json') o.json = true;
    else if (a === '-i' || a === '--interactive') o.interactive = true;
    else if (a === '--limit') o.limit = Math.max(0, parseInt(argv[++i], 10) || 0);
    else if (a === '--lang') o.lang = argv[++i];
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (!o.cmd && ['list', 'open', 'pin', 'unpin'].includes(a)) o.cmd = a;
    else o.words.push(a);
  }
  return o;
}

function resolveId(all, prefix, t) {
  if (!prefix) return { error: t.needId };
  const p = prefix.toLowerCase();
  const hits = all.filter((s) => s.id.toLowerCase().startsWith(p));
  if (hits.length === 1) return { session: hits[0] };
  return { error: hits.length ? t.ambiguous(prefix, hits.length) : t.notFound(prefix) };
}

/**
 * Line reader that never drops input. `rl.question` only sees a line that arrives
 * while a question is pending, so piped or pasted multi-line input loses every
 * line after the first. Here lines queue up and are handed out one per call;
 * when the input ends, pending and later calls get 'q'.
 */
function makeAsker(rl) {
  const queue = [];
  let waiting = null;
  let closed = false;
  rl.on('line', (l) => { if (waiting) { const w = waiting; waiting = null; w(l.trim()); } else queue.push(l.trim()); });
  rl.on('close', () => { closed = true; if (waiting) { const w = waiting; waiting = null; w('q'); } });
  return (q) => new Promise((res) => {
    process.stdout.write(q);
    if (queue.length) res(queue.shift());
    else if (closed) res('q');
    else waiting = res;
  });
}

async function confirmLive(ask, session, live, t, canAsk) {
  const holders = live.get(session.id);
  if (!holders) return true;
  console.log(t.liveWarn(holders.map((h) => h.name || `pid ${h.pid}`).join(', ')));
  if (!canAsk) return false;
  return /^y(es)?$/i.test(await ask(t.liveAsk));
}

async function interactive(all, cfg, opts, t) {
  const rl = readline.createInterface({ input: process.stdin });
  const ask = makeAsker(rl);
  let filterText = '';
  try {
    for (;;) {
      const live = liveSessions();
      const { rows, total } = select(all, cfg, opts, filterText, t);
      console.log(render(rows, total, cfg, live, opts, filterText, t));
      const a = await ask(t.prompt);
      if (/^(q|quit|exit)$/i.test(a)) return 0;
      if (a === '') { filterText = ''; continue; }
      if (/^a$/i.test(a)) { opts.here = !opts.here; continue; }
      if (/^r$/i.test(a)) { opts.rc = !opts.rc; continue; }
      const pin = /^p\s*(\d+)(?:\s+(.+))?$/i.exec(a);
      if (pin) {
        const s = rows[parseInt(pin[1], 10) - 1];
        if (!s) { console.log(t.badNumber); continue; }
        if (s.id in cfg.pins && !pin[2]) { const was = titleOf(s, cfg, t); delete cfg.pins[s.id]; console.log(t.unpinned(was)); }
        else { cfg.pins[s.id] = pin[2] || titleOf(s, cfg, t); console.log(t.pinned(cfg.pins[s.id])); }
        saveConfig(cfg);
        continue;
      }
      if (/^\d+$/.test(a)) {
        const s = rows[parseInt(a, 10) - 1];
        if (!s) { console.log(t.badNumber); continue; }
        if (!(await confirmLive(ask, s, live, t, true))) { console.log(t.cancelled); continue; }
        rl.close();
        return resume(s, opts, t);
      }
      filterText = a;
    }
  } finally { rl.close(); }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const t = STR[detectLang(opts.lang)];
  if (opts.version) { console.log(VERSION); return 0; }
  if (opts.help) { console.log(t.help); return 0; }

  const all = listSessions();
  if (all === null) { console.error(t.noDir(claudeDir())); return 1; }
  const cfg = loadConfig();

  if (opts.cmd === 'pin' || opts.cmd === 'unpin') {
    const r = resolveId(all, opts.words[0], t);
    if (r.error) { console.error(r.error); return 1; }
    if (opts.cmd === 'pin') { cfg.pins[r.session.id] = opts.words.slice(1).join(' ') || titleOf(r.session, cfg, t); console.log(t.pinned(cfg.pins[r.session.id])); }
    else { console.log(t.unpinned(titleOf(r.session, cfg, t))); delete cfg.pins[r.session.id]; }
    saveConfig(cfg);
    return 0;
  }

  if (opts.cmd === 'open') {
    const r = resolveId(all, opts.words[0], t);
    if (r.error) { console.error(r.error); return 1; }
    const live = liveSessions();
    if (live.has(r.session.id) && !opts.dryRun) {
      const rl = readline.createInterface({ input: process.stdin });
      const ok = await confirmLive(makeAsker(rl), r.session, live, t, Boolean(process.stdin.isTTY));
      rl.close();
      if (!ok) { console.log(t.cancelled); return 1; }
    }
    return resume(r.session, opts, t);
  }

  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const wantList = opts.cmd === 'list' || opts.json || (!tty && !opts.interactive);
  if (wantList) {
    const live = liveSessions();
    const { rows, total } = select(all, cfg, opts, opts.words.join(' '), t);
    if (opts.json) {
      console.log(JSON.stringify(rows.map((s) => ({
        id: s.id, title: titleOf(s, cfg, t), cwd: s.cwd, branch: s.branch, pr: s.pr,
        lastActivity: new Date(s.mtime).toISOString(), sizeBytes: s.size,
        pinned: s.id in cfg.pins, openNow: live.has(s.id),
      })), null, 2));
    } else console.log(render(rows, total, cfg, live, opts, opts.words.join(' '), t));
    return 0;
  }
  return interactive(all, cfg, opts, t);
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(e && e.stack ? e.stack : e); process.exitCode = 1; });
