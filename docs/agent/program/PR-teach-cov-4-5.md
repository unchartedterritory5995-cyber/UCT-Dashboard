# PR packet B: teach-cov-4 + cov-4-wl + cov-5, combined into one PR (workflow V3)

> LOCAL / SIMULATED (BROWSER-MOCK-MODEL for runner counts). Packet written 2026-11-09.
> PR: `agent/pl/teach-cov-5` → `agent/pl/teach-cov-3` (packet A), retargeted to `master` as the stack below merges.
> **One failing constituent holds the whole PR.** It is never merged in part; a refused slice is fixed or reverted
> first.

## Constituents
| Slice | Head | Integrated range | Own (non-merge) commits | Own doc |
|---|---|---|---|---|
| teach-cov-4 | `dcc90c3578` | `8d93a1f0fd..dcc90c3578` | `6f2c852111`, `788ab98573`, `5e23b4e398`, `0497c1dc61`, `aba69e1ad5`, `23b444a832`, `87deb3ac56`, `62f4ee8d64`, `8a6f6432a6`, `9dc00c9442`, `c7211cfdfe`, `f7cb3b89c4`, `b9b0fd095d`, `4aeb7f875f`, `3cf493c555`, `821bcc75c1`, `39aa6ae2ea`, `0c734c40c5`, `648c84c2ca`, `81f532710c`, `6ea8c880bd`, `6ab5bea45f`, `0463bbe08a` | `PR-teach-cov-4.md` |
| teach-cov-4-wl | `6056e91cd4` | `dcc90c3578..6056e91cd4` | `630f8a2081`, `7152e8fc60`, `894b48b6d1`, `d2774db57e`, `d2d1eb41ca`, `7239234843` | `TEACH-WATCHLISTS-PAGE-DESIGN.md` |
| teach-cov-5 | `681c3acfd6` (+ this packet) | `6056e91cd4..681c3acfd6` | `44b4e20073` held-out; `a9fffcfbf8` guide; `9368047eb7`, `c47b1d0001` assignments; `c387b2ad53`, `14e4c69dc3`, `e853efc4d8`, `681c3acfd6` docs | `PR-teach-cov-5.md` |

## Evidence (SIMULATED)
- **cov-4:** 281 VERIFIED of 304.
  - Locked suite at `788ab98573` (`src/agent`): 1 failure, `agentBreadthSelection` F1→F2→F3. That is a known wall-clock limit (350 ms against 300) in a file this branch does not touch; the file passed 20/20 on its own right after.
  - Locked suite at `821bcc75c1`: no failures.
- **cov-4-wl:** joined at `6056e91cd4`.
  - Fresh full pass: 281 VERIFIED of 304, the same 23 failures as cov-4.
  - Join suite: 3 failed / 10,075 passed, all three the `src/pages/command` reds.
- **cov-5:**
  - Item 1: 9 hand assignments, all 9 VERIFIED.
  - Item 3: Chart Settings and drawing-menu routing. Held-out 15/18, with 3 KNOWN MISSES.
  - Clean full pass at `c47b1d0001`: **295 VERIFIED of 318**, the same 23 failures, none lost.
  - Locked suite at `c47b1d0001`: 3 failed / 9,832 passed, the same `src/pages/command` reds.
  - Bytes delta 0.

## cov-4-wl's Watchlists-page walkthroughs: REVERTED in this packet (`a7397ec6e3`)
- cov-4-wl added the "ask, then go to the Watchlists page" walkthroughs: `guide/pageWalk.js` and the `watchlistPage`
  family.
- The owner then chose to teach those controls inside the Charts widget. `/watchlists` redirects to Charts on master,
  and the page host branch stays unmerged.
- So the Lead decided to revert them rather than ship inert navigation scope. One labelled commit, `a7397ec6e3`,
  reverts:
  - `d2774db57e`: `pageWalkOffer`, `WATCHLIST_PAGE_ACTIONS`, the `watchlistPage` family, `useAgent`'s ask, Yes and
    landing hooks, and `pageWalk.js` (deleted);
  - `d2d1eb41ca` and the test part of `7239234843`: `agentGuideWatchlistsPage.test.jsx` (deleted) and its two rail
    edits;
  - `894b48b6d1`: the `guide.show` enum's `watchlistPage` entry, in `manifest.golden.json` and
    `section_b_requests.json`.
    - The goldens were regenerated afterwards with their own tools (`UPDATE_AGENT_GOLDEN=1`, `UPDATE_SAT1_REQUESTS=1`):
      no content change.
    - This removes the enum growth that was owed pytest.
- Kept as history: the design note and the unapplied patch.
- Related tests after the revert: 1151 passed (guide, contracts, Sat1 requests, AgentPanel, useAgent).
- Replaced by `agent/pl/teach-wl-widget` (its own PR), with the title menu (#1005) underneath.

## Owed before this PR merges (V1 / V4)
- One locked full suite on the combined head handed to AUDIT, quiet machine.
- One notebook-bytes delta on that head.
- One fresh full runner pass on that head, with a frozen cases file.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Dhm4qhJhGoto7iixuJEEzM

## On the combined head `966576e270` (master `18a3fee48a` via packet A; SIMULATED)
- **Merges:** packet A, carrying master `18a3fee48a` (#1005, #1006, #1008) and the `/screener` flake fix, was merged in
  as merge commits (`f890153194`, `7d37437af4`, `966576e270`). No conflicts.
- **Related tests** (guide, contracts, Sat1 requests, AgentPanel, useAgent): 1151 passed.
  - In one earlier run under load, `agentGuideWatchlistCreate` "Cancel on the form" failed once. It passed 45/45 when
    re-run alone.
- **Bytes:** 2,252,617 B, +9 B against master. That is packet A's minifier naming in the entry chunk; no text is added.
- **One locked full suite** at `966576e270`:
  - `Test Files 3 failed | 305 passed | 5 skipped (313)`, `Tests 4 failed | 9821 passed | 14 skipped (9839)`.
  - 3 are the pre-existing `src/pages/command` reds.
  - The 4th is `agentBreadthTiming` "well under 300 ms", a wall-clock limit under full-suite load. This branch does not
    touch that file, and it passed 2/2 when re-run alone right after.
