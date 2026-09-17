# claude-session-picker

[Claude Code](https://claude.com/claude-code) 세션 선택기입니다. **모든 프로젝트**의 세션을 최근순으로 보여 주고, **지금 열려 있는 세션**을 표시하며, 고른 세션을 원래 시작했던 폴더에서 이어받습니다.

[English](README.md)

```
Claude Code 세션 — 42개 중 5개 표시 (모든 프로젝트) · 원격 제어: 꺼짐

  1 ★ 릴리스 점검표                              shop-api       방금      9f2c1a7e
  2  ●로그인 테스트 흔들림 수정                  shop-web       12분 전   41b0d3c2
  3   주문 CSV 내보내기                          shop-api       2시간 전  c7e55a10
  4   Node 22 올리기                             infra          3일 전    08ad91f4
  5   검색 순위 실험                             shop-web       2달 전    e3b7720d

  ★ 고정   ● 다른 창에서 지금 열려 있음

번호 / 검색어 / p <번호> / a / r / q >
```

## 왜 만들었나

`claude --resume` 은 지금 있는 폴더의 세션만 보여 줍니다. 저장소가 여러 개이거나, 워크트리를 쓰거나, 데스크톱 앱과 터미널을 오가며 일하면 찾는 세션이 다른 곳에 있어서 ID 를 뒤지게 됩니다.

조용히 나는 사고 하나도 막아 줍니다. **다른 창에 아직 열려 있는 대화를 또 이어받는 것**입니다. 두 프로세스가 한 기록 파일에 쓰면 대화가 엇갈릴 수 있습니다. `claude-session-picker` 는 Claude Code 의 실행 중 세션 등록부를 확인해서, 그런 경우 먼저 묻습니다.

## 설치

Node.js 18 이상과 `claude` 명령이 필요합니다. 의존 패키지는 없습니다.

```bash
npm install -g github:SuoopaDoPa/claude-session-picker
```

설치 없이 바로 실행:

```bash
npx github:SuoopaDoPa/claude-session-picker
```

## 사용법

```bash
ccs                      # 모든 프로젝트에서 고르기
ccs --here               # 이 폴더(와 그 아래)에서 시작한 세션만
ccs --rc                 # --remote-control 을 붙여 이어받기
ccs list --json          # 스크립트용
ccs open 41b0            # id 또는 앞 몇 글자로 바로 이어받기
ccs pin 9f2c "릴리스 점검표"   # 맨 위에 고정하고 내 이름 붙이기
ccs open 41b0 -- --model opus  # -- 뒤는 그대로 claude 에 전달
```

선택기 안에서: **번호** = 이어받기 · **글자** = 검색 · `p 3` = 고정/해제 · `a` = 전체/이 폴더 · `r` = 원격 제어 켜기/끄기 · `q` = 종료.

| 옵션 | 뜻 |
|---|---|
| `--here` | 시작 폴더가 현재 폴더이거나 그 아래인 세션만 |
| `--pinned` | 고정한 세션만 |
| `--limit <n>` | 몇 줄 보여줄지 (기본 20, `0` = 전부) |
| `--rc` | 이어받을 때 `--remote-control` 추가 |
| `--dry-run` | 명령과 폴더만 출력하고 실행하지 않음 |
| `--json` | 기계가 읽는 목록 |
| `-i`, `--interactive` | 터미널로 인식되지 않을 때 선택기를 강제로 띄움 |
| `--lang <en\|ko>` | 표시 언어 (기본: 시스템 언어) |

**Windows 의 Git Bash:** mintty 는 Node 에게 터미널로 보이지 않아서, 그냥 `ccs` 를 치면 목록만 찍고 끝납니다. `ccs -i` 를 쓰거나 Windows Terminal·PowerShell·cmd 에서 실행하세요.

## 무엇을 읽고 쓰나

| | |
|---|---|
| 읽기 | `~/.claude/projects/*/*.jsonl` (제목·시작 폴더·브랜치·PR 링크), `~/.claude/sessions/*.json` (열려 있는 세션). 기록 파일마다 앞뒤 256KB 만 읽어서 기록이 커도 빠릅니다. |
| 쓰기 | 자기 설정 파일 `~/.config/claude-session-picker/config.json` (고정 목록) 하나뿐. Claude Code 의 파일은 절대 고치지 않습니다. |
| 전송 | 없음. 네트워크를 쓰지 않습니다. |

환경 변수: `CLAUDE_CONFIG_DIR` (Claude Code 데이터 위치), `CCS_CONFIG` (고정 목록 파일), `CCS_LANG`, `CCS_CLAUDE_BIN` (`claude` 실행 파일 경로).

제목은 다음 순서로 정합니다: 내가 붙인 고정 이름 → 세션의 사용자 지정 제목 → Claude 가 만든 제목 → 첫 요청 문장.

## 한계

- **비공식 도구입니다.** 읽는 파일들은 Claude Code 의 내부 형식이지 공개된 규격이 아닙니다. 업데이트로 바뀔 수 있습니다. 업데이트 뒤 목록이 이상하면 Claude Code 버전과 함께 이슈를 남겨 주세요.
- "지금 열려 있음" 표시는 프로세스 번호에 기대고 있습니다. 비정상 종료 뒤에는 묵은 항목이 남아, 실제로는 닫힌 세션에 경고가 뜰 수 있습니다. 헷갈릴 때는 묻는 쪽으로 동작합니다.
- 데스크톱 앱의 세션도 기록 파일이 같은 곳에 있으면 보입니다. 앱 사이드바의 그룹은 읽지 않습니다.

## 개발

```bash
npm test     # node --test, 합성 데이터만 사용 — 실제 ~/.claude 는 건드리지 않음
```

## 라이선스

MIT
