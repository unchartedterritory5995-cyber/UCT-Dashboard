# PR packet A: teach-cov-1 + cov-2 + cov-3, combined into one PR (workflow V3)

> LOCAL / SIMULATED (BROWSER-MOCK-MODEL for runner counts). Packet written 2026-11-09.
> PR: `agent/pl/teach-cov-3` → `agent/pl/teach-ship-5-runner`, retargeted to `master` once the ship-4+5 PR merges.
> **One failing constituent holds the whole PR.** It is never merged in part; a refused slice is fixed or reverted
> first. Packet B (cov-4, cov-4-wl, cov-5) stacks on this one.

## Constituents
| Slice | Head | Integrated range | Own (non-merge) commits | Own doc |
|---|---|---|---|---|
| teach-cov-1 | `e58c741f42` | `9f20da0b78..e58c741f42` | `42a07b210f`, `15f1235016`, `7242cf36e9`, `0caa73b04c`, `a99dfa1335`, `cfd9dce566`, `786b115b46`, `9eb3a86819` | `PR-teach-cov-1.md` |
| teach-cov-2 | `1e52e1f682` | `e58c741f42..1e52e1f682` | `aca5984473`, `ead5b546f5`, `591acd2919`, `810765e977` | `PR-teach-cov-2.md` |
| teach-cov-3 | `8d93a1f0fd` | `1e52e1f682..8d93a1f0fd` | `c674b8348f`, `95968037f7`, `75584651ec`, `4fb05f4cef`, `84301acf19`, `3cc135ec35`, `b904e34d5a`, `74861fcece`, `a401e03a75`, `943f4305fc`, `dcd8687387`, `9053d7591b`, `c52d54e941`, `f6190514de`, `6591631d3d`, `ca13b05fc1`, `fe0a699e9b` | `PR-teach-cov-3.md` |

- The heads are the joined heads: TEACH-STACK-JOIN-PLAN step 2, merge commits only, no rebase. Each slice merged the
  one below it, so the AUDIT-reviewed commit ids are unchanged.
- Each slice's own doc has its behaviour, files and held-out sets. The commits are listed in the order
  `git log --no-merges` gives them, newest first.

## Evidence (from each slice's doc; SIMULATED)
- **cov-1:** watchlist and scanner rows, plus the new `scan` given. Browser single run: 26/27, and the one runner miss
  was fixed. The held-out set is in its doc.
- **cov-2:** 245 VERIFIED of 284 cases (was 222 of 263). None lost.
- **cov-3:** 270 VERIFIED of 298 cases (was 245 of 284). None lost.
  - Locked suite at `4fb05f4cef` (`src/agent`): 1 file / 3 tests failed. These were the 3 held-out cov-3 KNOWN MISSES, failing because the held-out file asserted what it named.
  - The next commit records them as misses, asserting both ways; that file then passes 21/21. Every other file passed.
- **Every slice:** its held-out set was committed before its routing change. Misses are recorded both ways in
  `knownMisses.json`.

## Owed before this PR merges (V1 / V4)
- One locked full suite on the combined head handed to AUDIT, quiet machine.
- One notebook-bytes delta on that head.
- One fresh full runner pass on that head, with a frozen cases file.
- The three `src/pages/command` reds are pre-existing on master.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Dhm4qhJhGoto7iixuJEEzM

## On the combined head `0e650af360` (SIMULATED)
- **Master merged in** (Lead's decision): one merge commit of `origin/master` `5c78b4b74a` (which includes #1005 and
  #1006). No conflicts.
- **Related tests** (`src/agent/agentGuide*`, `src/agent/guide`, `src/agent/contract`, `agentContracts`): 1026 passed.
- **Notebook bytes:** 2,252,617 B on this head against 2,252,608 B on master. **+9 B**, verdict PASS against budget
  2,260,793 B.
  - The 9 bytes are all in the shared entry chunk (`index`, 563,679 → 563,688).
  - A string-literal diff of that chunk finds no added text, and the lazy-chunk names it references are identical. So
    the difference is minifier identifier naming (more exports in the guide modules shift some mangled names to longer
    ones). No content reaches first open.
  - The packet gate says "≤ 0 for anything that reaches first-open", so this is listed for the Lead's call.
- **One locked full suite** (`src/agent`, `src/pages/command`; quiet machine; BelowNormal):
  - `Test Files 2 failed | 302 passed | 5 skipped (309)`, `Tests 3 failed | 9777 passed | 14 skipped (9794)`.
  - The 3 failures are pre-existing master reds: `src/pages/command/keyListenerCensus` ×2 and `shortcutRegistry`
    DrillPlayer ×1.
  - `src/agent` is all green.

## Re-merged on master `18a3fee48a` (#1008 ship-4+5 merged): head `c4b9ac161f` (SIMULATED)
- `77cbbdf4ee`: one merge commit of `origin/master` `18a3fee48a`. No conflicts.
- `c4b9ac161f`: the `/screener` "where do I change the filters?" test now waits for the card's text with `waitFor`, as
  its neighbours do. The assertion is unchanged; it had flaked once under full-suite load.
- **Related tests:** 1026 passed.
- **Bytes:** 2,252,617 B, +9 B against master, from the same minifier naming in the entry chunk as above.
- **One locked full suite** at `c4b9ac161f`:
  - `Test Files 2 failed | 302 passed | 5 skipped (309)`, `Tests 3 failed | 9777 passed | 14 skipped (9794)`.
  - The 3 failures are the pre-existing `src/pages/command` reds. `src/agent` is all green.
