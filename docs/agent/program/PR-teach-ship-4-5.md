# PR packet: teach-ship-4 + teach-ship-5, combined into one PR (workflow V3)

> LOCAL / SIMULATED (BROWSER-MOCK-MODEL for runner counts). Packet written 2026-11-09.
> PR: `agent/pl/teach-ship-5-runner` → `master`. It carries both slices: ship-5 is stacked on ship-4.
> **One failing constituent holds the whole PR.** If either slice is refused, the PR waits until it is fixed or
> dropped by a revert commit; it is never merged in part.

## Constituents
| Slice | Head | Integrated range | Own (non-merge) commits | Own doc |
|---|---|---|---|---|
| teach-ship-4 (layouts: Rename and Version history ring the member's own layout) | `0f3154c96f` | `a23b623fdd..0f3154c96f` (ship-3 `a23b623fdd` is in master via #998) | `15c5fa00e0` fix; `abe34e437e`, `04a48b88bc`, `79723646a6`, `13e19fecb3` docs | `PR-teach-ship-4.md` |
| teach-ship-5 (the visual-teaching browser runner, givens, status; one product line in `controls.js`) | `9f20da0b78` | `0f3154c96f..9f20da0b78` | `cfe8321aea`, `3495ddae90`, `2faa9ef92e`, `e603936b25` test; `8ef8b49271`, `9cd881d6e0`, `3897afe367`, `cd0cca0e88`, `44f641d513`, `c973331c88`, `22d46332d9`, `da083a7687`, `eddf82a426`, `9a689f56b7`, `a371108d3a` docs | `PR-teach-ship-5.md` |

The merge commits in the range are the stack's restacks and joins: masters `25f049554f` and `de373f4b20`, the lifecycle
rails, the six-chart rail, the notebook-bytes fix, and TEACH-STACK-JOIN-PLAN step 1. No rebase was used, so every
commit id AUDIT reviewed is unchanged.

## What the PR does (from each slice's own doc)
- **ship-4:** the layout bar's Rename and Version history steps ring one of the member's OWN layouts by name (read from
  `host.layouts.snapshot()`, read only). With none, they say so. Product: `capabilities/guide.js` (`mineOnly`),
  `guide/actions.js`.
- **ship-5:** test tooling and docs: `testing/agent/guide/` (`teach.mjs`, `given.mjs`, `status.mjs`, cases, expected,
  one run file) and `CHARTS_TEACH_STATUS.md`. Product: one line in `guide/controls.js` (the library's Delete row
  ignores prebuilt, template and global wording).
- Neither slice touches useAgent, deixis or runtime. ship-4 reads the host and writes nothing.

## Evidence so far
- **AUDIT:** both slices ACCEPTED 11-08.
- **Post-restack locked suite** on ship-5 `9a689f56b7` (ship-2..5 on master `25f049554f`): recorded in each slice's doc.
- **Browser runner:** the coverage branches stacked on this lineage carry it. The latest clean pass is teach-cov-5
  `c47b1d0001`: 295 VERIFIED of 318.

## On the combined head `66b79052ca` (SIMULATED)
- **Master merged in** (Lead's decision): `66b79052ca` = one merge commit of `origin/master` `8500e084ac` into this
  branch.
  - Both sides kept, with no conflicts. The diff over master is only ship-4 and ship-5's own files.
- **Related tests** (`src/agent/agentGuide*`, `src/agent/guide`, `src/agent/contract`, `agentContracts`): 921/921.
- **Notebook bytes:** 2,252,608 B on this head, the same as master `b554908dda`. **Delta 0**, verdict PASS.
- **One locked full suite** (`src/agent`, `src/pages/command`; quiet machine; BelowNormal):
  - `Test Files 2 failed | 295 passed | 5 skipped (302)`, `Tests 3 failed | 9672 passed | 6 skipped (9681)`.
  - The 3 failures are pre-existing master reds: `src/pages/command/keyListenerCensus` ×2 and `shortcutRegistry`
    DrillPlayer ×1. This PR touches neither.
  - `src/agent` is all green.
- **Still open:** whether raw run files (`runs/*.results.json`) belong in the repo is the owner's call (from
  PR-teach-ship-5).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Dhm4qhJhGoto7iixuJEEzM
