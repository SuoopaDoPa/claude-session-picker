'use strict';
// All data here is synthetic. The tests point CLAUDE_CONFIG_DIR at a temp folder,
// so they never touch (or depend on) the real ~/.claude of whoever runs them.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'ccs.js');
const ID_A = '11111111-1111-4111-8111-111111111111'; // small, has custom title
const ID_B = '22222222-2222-4222-8222-222222222222'; // large (> head+tail chunks), title only at the end
const ID_C = '33333333-3333-4333-8333-333333333333'; // no titles, first prompt only
const ID_D = '33333333-4444-4444-8444-444444444444'; // shares a prefix with C

const line = (o) => JSON.stringify(o) + '\n';
const user = (id, cwd, text, extra = {}) => line({ type: 'user', sessionId: id, cwd, gitBranch: 'main', message: { role: 'user', content: text }, ...extra });

function makeWorld() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-test-'));
  const claude = path.join(root, 'claude');
  const projA = path.join(root, 'work', 'alpha');
  const projB = path.join(root, 'work', 'beta');
  fs.mkdirSync(projA, { recursive: true });
  fs.mkdirSync(projB, { recursive: true });
  const pdirA = path.join(claude, 'projects', 'alpha-slug');
  const pdirB = path.join(claude, 'projects', 'beta-slug');
  fs.mkdirSync(pdirA, { recursive: true });
  fs.mkdirSync(pdirB, { recursive: true });
  fs.mkdirSync(path.join(claude, 'sessions'), { recursive: true });

  fs.writeFileSync(path.join(pdirA, `${ID_A}.jsonl`),
    user(ID_A, projA, '<command-name>/clear</command-name>') + // wrapper lines are not prompts
    user(ID_A, projA, 'Add a CSV export to the orders page') +
    line({ type: 'ai-title', sessionId: ID_A, aiTitle: 'CSV export for orders' }) +
    line({ type: 'custom-title', sessionId: ID_A, customTitle: 'Orders export' }) +
    line({ type: 'pr-link', prNumber: 7, prUrl: 'https://example.invalid/pr/7' }));

  // > 600 KB so that neither the head nor the tail chunk covers the middle.
  const filler = line({ type: 'assistant', sessionId: ID_B, message: { role: 'assistant', content: 'x'.repeat(2000) } });
  fs.writeFileSync(path.join(pdirB, `${ID_B}.jsonl`),
    user(ID_B, projB, 'Investigate the flaky login test') +
    line({ type: 'ai-title', sessionId: ID_B, aiTitle: 'Early title' }) +
    filler.repeat(320) +
    line({ type: 'ai-title', sessionId: ID_B, aiTitle: 'Flaky login test fixed' }));

  fs.writeFileSync(path.join(pdirB, `${ID_C}.jsonl`),
    user(ID_C, path.join(root, 'gone'), 'side task', { isSidechain: true }) +
    user(ID_C, path.join(root, 'gone'), '한글 제목도 잘리는지 확인하는 아주 긴 첫 요청 문장입니다'));
  fs.writeFileSync(path.join(pdirB, `${ID_D}.jsonl`), user(ID_D, projB, 'Another one'));

  // Things that must be ignored.
  fs.writeFileSync(path.join(pdirB, 'agent-abc.jsonl'), user('x', projB, 'subagent transcript'));
  fs.writeFileSync(path.join(pdirB, `${ID_A.replace(/1/g, '9')}.jsonl`), '');

  const now = Date.now() / 1000;
  fs.utimesSync(path.join(pdirA, `${ID_A}.jsonl`), now - 60, now - 60);
  fs.utimesSync(path.join(pdirB, `${ID_B}.jsonl`), now - 7200, now - 7200);
  fs.utimesSync(path.join(pdirB, `${ID_C}.jsonl`), now - 86400 * 3, now - 86400 * 3);
  fs.utimesSync(path.join(pdirB, `${ID_D}.jsonl`), now - 86400 * 40, now - 86400 * 40);
  return { root, claude, projA, projB, cfg: path.join(root, 'cfg', 'config.json') };
}

function run(w, args, opts = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8', cwd: opts.cwd || w.root,
    env: { ...process.env, CLAUDE_CONFIG_DIR: w.claude, CCS_CONFIG: w.cfg, CCS_LANG: 'en', ...(opts.env || {}) },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const json = (w, args, opts) => JSON.parse(run(w, ['list', '--json', ...args], opts).out);

test('lists sessions newest first with the best available title', () => {
  const w = makeWorld();
  const rows = json(w, []);
  assert.deepStrictEqual(rows.map((r) => r.id), [ID_A, ID_B, ID_C, ID_D]);
  assert.strictEqual(rows[0].title, 'Orders export');              // custom title beats AI title
  assert.strictEqual(rows[0].pr, 'https://example.invalid/pr/7');
  assert.strictEqual(rows[1].title, 'Flaky login test fixed');     // latest title found in the tail of a big file
  assert.ok(rows[2].title.startsWith('한글 제목도'));                // sidechain line skipped, first real prompt used
  assert.strictEqual(rows[0].cwd, w.projA);
});

test('--here keeps only sessions started in or below the current folder', () => {
  const w = makeWorld();
  assert.deepStrictEqual(json(w, ['--here'], { cwd: w.projA }).map((r) => r.id), [ID_A]);
  assert.strictEqual(json(w, ['--here'], { cwd: path.join(w.root, 'work') }).length, 3);
});

test('--limit, text filter', () => {
  const w = makeWorld();
  assert.strictEqual(json(w, ['--limit', '2']).length, 2);
  assert.deepStrictEqual(json(w, ['login']).map((r) => r.id), [ID_B]);
});

test('pin puts a session on top with its label; unpin undoes it', () => {
  const w = makeWorld();
  assert.strictEqual(run(w, ['pin', '3333-4', 'x']).code, 1);       // not a prefix
  assert.strictEqual(run(w, ['pin', ID_D.slice(0, 13), 'Old', 'but', 'gold']).code, 0);
  let rows = json(w, []);
  assert.strictEqual(rows[0].id, ID_D);
  assert.strictEqual(rows[0].title, 'Old but gold');
  assert.strictEqual(rows[0].pinned, true);
  assert.deepStrictEqual(json(w, ['--pinned']).map((r) => r.id), [ID_D]);
  assert.strictEqual(run(w, ['unpin', ID_D]).code, 0);
  rows = json(w, []);
  assert.strictEqual(rows[0].id, ID_A);
});

test('open resolves a unique prefix, refuses an ambiguous one', () => {
  const w = makeWorld();
  const ok = run(w, ['open', '1111', '--rc', '--dry-run', '--', '--model', 'opus']);
  assert.strictEqual(ok.code, 0);
  assert.match(ok.out, new RegExp(`claude --resume ${ID_A} --remote-control --model opus`));
  assert.ok(ok.out.includes(w.projA));                               // runs in the session's own folder
  const amb = run(w, ['open', '33333333', '--dry-run']);
  assert.strictEqual(amb.code, 1);
  assert.match(amb.err, /matches 2 sessions/);
  assert.match(run(w, ['open', 'ffff', '--dry-run']).err, /No session matches/);
});

test('falls back to the current folder when the original one is gone', () => {
  const w = makeWorld();
  const r = run(w, ['open', ID_C, '--dry-run']);
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /original folder is gone/);
});

test('flags a session that a live process has open, ignores dead ones', async () => {
  const w = makeWorld();
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'ignore' });
  try {
    fs.writeFileSync(path.join(w.claude, 'sessions', `${sleeper.pid}.json`),
      JSON.stringify({ pid: sleeper.pid, sessionId: ID_B, name: 'beta-window', status: 'idle' }));
    fs.writeFileSync(path.join(w.claude, 'sessions', '999999.json'),
      JSON.stringify({ pid: 999999, sessionId: ID_A, name: 'ghost' }));
    const rows = json(w, []);
    assert.strictEqual(rows.find((r) => r.id === ID_B).openNow, true);
    assert.strictEqual(rows.find((r) => r.id === ID_A).openNow, false);
    // Non-interactive open of a live session must not go ahead silently.
    const r = run(w, ['open', ID_B], { env: { CCS_CLAUDE_BIN: process.execPath } });
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /already open \(beta-window\)/);
  } finally { sleeper.kill(); }
});

test('resume really launches the claude binary with the right arguments and folder', () => {
  const w = makeWorld();
  const script = path.join(w.root, 'fake-claude.js');
  const log = path.join(w.root, 'launched.json');
  fs.writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify({argv: process.argv.slice(2), cwd: process.cwd()})); process.exit(7);`);
  // A stand-in for the claude command: a .cmd shim on Windows (the npm-install shape), a shell script elsewhere.
  let bin;
  if (process.platform === 'win32') {
    bin = path.join(w.root, 'fake-claude.cmd');
    fs.writeFileSync(bin, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  } else {
    bin = path.join(w.root, 'fake-claude');
    fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    fs.chmodSync(bin, 0o755);
  }
  const r = run(w, ['open', ID_A, '--rc', '--', '--append-system-prompt', 'two words'], { env: { CCS_CLAUDE_BIN: bin } });
  assert.strictEqual(r.code, 7, r.err);                              // the child's exit code is passed through
  const seen = JSON.parse(fs.readFileSync(log, 'utf8'));
  assert.deepStrictEqual(seen.argv, ['--resume', ID_A, '--remote-control', '--append-system-prompt', 'two words']);
  assert.strictEqual(fs.realpathSync(seen.cwd), fs.realpathSync(w.projA));
});

test('help, version, missing data folder, Korean', () => {
  const w = makeWorld();
  assert.match(run(w, ['--version']).out, /^\d+\.\d+\.\d+/);
  assert.match(run(w, ['--help']).out, /interactive picker/);
  assert.match(run(w, ['--help', '--lang', 'ko']).out, /대화형 선택기/);
  const none = run(w, ['list'], { env: { CLAUDE_CONFIG_DIR: path.join(w.root, 'nope') } });
  assert.strictEqual(none.code, 1);
  assert.match(none.err, /No Claude Code data found/);
  const table = run(w, ['list']).out;
  assert.match(table, /showing 4 of 4 \(all projects\)/);
  assert.match(table, /Orders export/);
});

function pick(w, input, args = []) {
  const r = spawnSync(process.execPath, [CLI, '-i', '--dry-run', ...args], {
    encoding: 'utf8', cwd: w.root, input,
    env: { ...process.env, CLAUDE_CONFIG_DIR: w.claude, CCS_CONFIG: w.cfg, CCS_LANG: 'en' },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('picker: filter, then resume by number; r toggles remote control', () => {
  const w = makeWorld();
  const r = pick(w, 'login\nr\n1\n');
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /filter: "login"/);
  assert.match(r.out, new RegExp(`claude --resume ${ID_B} --remote-control`));
});

test('picker: p <n> pins and unpins; bad number is reported; input ending quits cleanly', () => {
  const w = makeWorld();
  let r = pick(w, 'p 4 Keep me\n99\n');
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /Pinned: Keep me/);
  assert.match(r.out, /No such number/);
  assert.strictEqual(json(w, [])[0].title, 'Keep me');
  r = pick(w, 'p 1\nq\n');
  assert.match(r.out, /Unpinned: Keep me/);
  assert.strictEqual(json(w, [])[0].id, ID_A);
});

test('picker: asks before resuming a session that is open elsewhere', () => {
  const w = makeWorld();
  fs.writeFileSync(path.join(w.claude, 'sessions', `${process.pid}.json`),
    JSON.stringify({ pid: process.pid, sessionId: ID_A, name: 'other-window' }));
  const no = pick(w, '1\nn\nq\n');
  assert.match(no.out, /already open \(other-window\)/);
  assert.match(no.out, /Cancelled/);
  assert.doesNotMatch(no.out, /claude --resume/);
  const yes = pick(w, '1\ny\n');
  assert.match(yes.out, new RegExp(`claude --resume ${ID_A}`));
});
