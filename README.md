# claude-session-picker

A session picker for [Claude Code](https://claude.com/claude-code). It lists your sessions from **every project**, newest first, marks the ones that are **open right now**, and resumes the one you pick — in the folder it was started from.

[한국어 설명서](README.ko.md)

```
Claude Code sessions — showing 5 of 42 (all projects) · remote control: off

  1 ★ Release checklist                          shop-api       just now  9f2c1a7e
  2  ●Fix flaky login test                       shop-web       12m ago   41b0d3c2
  3   CSV export for orders                      shop-api       2h ago    c7e55a10
  4   Upgrade to Node 22                         infra          3d ago    08ad91f4
  5   Spike: search ranking                      shop-web       2mo ago   e3b7720d

  ★ pinned   ● open right now in another window

number / filter text / p <n> / a / r / q >
```

## Why

`claude --resume` shows sessions for the folder you are in. When you work across several repositories, worktrees, or a desktop app plus terminals, the session you want is somewhere else and you end up hunting for an ID.

It also guards against a quiet failure: **resuming a conversation that is still open in another window**. Two processes appending to one transcript can scramble it. `claude-session-picker` checks Claude Code's live-session registry and asks before it lets you do that.

## Install

Requires Node.js 18 or newer and the `claude` command. No dependencies.

```bash
npm install -g github:SuoopaDoPa/claude-session-picker
```

Or run it without installing:

```bash
npx github:SuoopaDoPa/claude-session-picker
```

## Use

```bash
ccs                      # pick from all projects
ccs --here               # only sessions started in this folder or below
ccs --rc                 # resume with --remote-control
ccs list --json          # for scripts
ccs open 41b0            # resume directly by id or unique prefix
ccs pin 9f2c "Release checklist"   # keep on top, with your own label
ccs open 41b0 -- --model opus      # anything after -- goes to claude
```

In the picker: a **number** resumes · any **text** filters · `p 3` pins or unpins · `a` switches all / this folder · `r` toggles remote control · `q` quits.

| Option | Meaning |
|---|---|
| `--here` | Only sessions whose starting folder is the current folder or below it |
| `--pinned` | Only pinned sessions |
| `--limit <n>` | How many rows (default 20, `0` = all) |
| `--rc` | Add `--remote-control` when resuming |
| `--dry-run` | Print the command and the folder, run nothing |
| `--json` | Machine-readable list |
| `-i`, `--interactive` | Force the picker when the terminal is not detected |
| `--lang <en\|ko>` | Interface language (default: your locale) |

**Git Bash on Windows:** mintty does not look like a terminal to Node, so plain `ccs` prints the list and exits. Use `ccs -i`, or run it from Windows Terminal, PowerShell or cmd.

## What it reads and writes

| | |
|---|---|
| Reads | `~/.claude/projects/*/*.jsonl` (titles, starting folder, branch, PR link) and `~/.claude/sessions/*.json` (which sessions are open). Only the first and last 256 KB of each transcript, so large histories stay fast. |
| Writes | Only its own `~/.config/claude-session-picker/config.json` (your pins). It never modifies Claude Code's files. |
| Sends | Nothing. No network access. |

Environment: `CLAUDE_CONFIG_DIR` (where Claude Code keeps its data), `CCS_CONFIG` (pin file), `CCS_LANG`, `CCS_CLAUDE_BIN` (path to the `claude` executable).

Titles come from, in order: your pin label, the session's custom title, Claude's generated title, the first prompt.

## Limits

- **Unofficial.** These files are Claude Code internals, not a documented interface. An update can change them; if the list looks wrong after an update, please open an issue with your Claude Code version.
- The "open right now" mark relies on process IDs. After a crash a stale entry can linger until that PID is reused or the file is cleaned up, so you may see a warning for a session that is not really open. It errs on the side of asking.
- Sessions of the Claude desktop app appear when their transcripts are stored in the same place; the app's own sidebar groups are not read.

## Development

```bash
npm test     # node --test, synthetic data only — never touches your real ~/.claude
```

## License

MIT
