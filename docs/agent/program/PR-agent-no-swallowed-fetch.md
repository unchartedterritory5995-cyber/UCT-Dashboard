# PR: the Agent no longer swallows a failed read (TERM-033, pl-grid)

Branch `agent/pl/agent-no-swallowed-fetch`, based on origin/master `292983f4bc`. This closes AUDIT's bar on the four Agent `.catch(() => null)` sites. In each one a failed read became the same `null` as an empty answer.

## What changes for the member

| Site | Before | After |
|---|---|---|
| `capabilities/stock.js:81` stock.profile statements (c1f2dc5047) | When the read threw, the statements were silently left out. The profile looked the same as when the kind isn't served. | The profile says: "Financial statements: I couldn't read NVDA's financial statements from UCT's data gateway right now; no statement figure is stated." The cause is logged. When the kind isn't served (`null`), the profile is unchanged. |
| `capabilities/calendar.js:43` `request()` (7da587746c) | Every failure (HTTP error, network, unreadable body) became `null`. The cause was lost, and nothing was logged. | `request()` returns a tagged result: `{ ok: true, body }` or `{ ok: false, why }`. The answer says "I couldn't load UCT's calendar for NVDA right now (HTTP 503), so I can't say when it reports." The week view says the same "for that week". A failed week can never read as "No reports". Every failure is logged with its URL and cause. |
| `capabilities/scanRefine.js:90` state write (574afbfea6) | A failed PUT was ignored without a word. Switching to another chat and back then refined the OLDER copy on the server. | The failure is logged, and the chat is marked as unsaved. Restoring an unsaved chat reports `LAST_SCREEN_FAILED` instead of returning the older copy. |
| `capabilities/scanRefine.js:96` state read | A failed GET looked exactly like "no last screen" ("Which screen should I narrow?"). | The failure is logged and reported as `LAST_SCREEN_FAILED`. The refinement says: "I couldn't read this chat's last screen back from UCT, so I'm starting fresh: run the screen again first, …". The next refinement reads again. A successful read with nothing stored still asks the plain question. |

There is also a fifth file. `testing/agent/acceptance/lib.mjs` is the dev-only acceptance rig, which is never bundled, and it had two `res.clone().json().catch(() => null)` reads. Both now use a named sentinel, `PASS_THROUGH`, under the census's own named-sentinel rule. Behaviour is unchanged: a body that isn't JSON is handed back as the real response. I changed it so that the census lists no Agent offender at all.

`screener.js` changed in 13 lines. `ensureLast` maps `LAST_SCREEN_FAILED` to `cache.unreadConv`. The refine guard picks `LAST_SCREEN_UNREAD` for that chat. `setLast` clears the marker, and so does `_resetScreenerCache`, which stands in for a reload.

## Changed files (`git diff --stat origin/master...HEAD`, before this doc)

- `app/src/agent/agentNoSwallowedFetch.test.js` (new, 50 lines)
- `app/src/agent/agentPageCalendar.test.jsx` (24 lines)
- `app/src/agent/agentScanRefine.test.jsx` (33 lines)
- `app/src/agent/capabilities/calendar.js` (28 lines)
- `app/src/agent/capabilities/marketDataFacts.js` (9 lines)
- `app/src/agent/capabilities/scanRefine.js` (29 lines)
- `app/src/agent/capabilities/screener.js` (13 lines)
- `app/src/agent/capabilities/stock.js` (5 lines)
- `app/src/testing/agent/acceptance/lib.mjs` (13 lines)

Totals: 9 files changed, 181 insertions(+), 23 deletions(-). The census baseline is not edited: it stays at 0, shrink-only.

## Results

All runs used `python ../tools/agent_suite_lock.py run --who pl-grid -- powershell -File <scratch>\pl-grid\bn.ps1 node node_modules/vitest/vitest.mjs run <scope>`, from `app/`, at BelowNormal. The runs were SCOPED.

- **Rails first** (commit `4058fdfe23`, tests only, on master code):
  - Scope: `agentNoSwallowedFetch`, `agentPageCalendar`, `agentScanRefine`, `lib/swallowedFetch.census`.
  - Result: `Test Files 4 failed (4)`, `Tests 5 failed | 19 passed (24)`.
  - The 5 failures are: the stock case, the calendar case, the two scanRefine cases, and the census.
- **Census, compared at the offender level against master:**
  - master `292983f4bc` (this branch's base before the re-merge), 6 files: `agent/capabilities/calendar.js 0->1`, `agent/capabilities/scanRefine.js 0->2`, `agent/capabilities/stock.js 0->1`, `pages/breadth/drill/longHistory.js 0->1`, `pages/journal-2-0/tabs/NotebookTab.jsx 0->1`, `testing/agent/acceptance/lib.mjs 0->2`.
  - this head, 2 files: `pages/breadth/drill/longHistory.js 0->1`, `pages/journal-2-0/tabs/NotebookTab.jsx 0->1`. Both are non-Agent and were already red on master. They aren't touched here, and their owners are outside the Agent.
- **Fix** (commit `165f6c0938`):
  - Scope: 48 files, every Agent test that names `stock.profile`, `calendar.day`/`nextReport`, `screener.run` or `lastScreen`, plus the census.
  - Result: `Test Files 1 failed | 47 passed | 1 skipped (49)`, `Tests 1 failed | 1166 passed | 2 skipped (1169)`.
  - The one failure is the census and its two non-Agent files. The skips are pre-existing in-file skips: `agentLiveCapture`, and one case in `agentScreenerSortCoverage`.
- **Mutations: 4 of 4 killed.** Each was killed by its own site's test, and the files were restored with `git checkout` after each run.
  - MS: `stock.js` swallows to `null` again. 1 failed, the stock case.
  - MC: a failed week becomes an empty week. 1 failed, the calendar case.
  - MR1: a failed write isn't marked. 1 failed, the "FAILED write" case.
  - Set A was MS, MC and MR1, run together over three separate files: `Tests 3 failed | 16 passed (19)`.
  - MR2: a failed read returns `null`. `Tests 1 failed | 10 passed (11)`, the "server unreachable" case.

## Re-check after merging origin/master `75421184a3` (head `84cdd31037`, pl-widget)

The merge was clean. Runs were vitest under node, BelowNormal, ≤25 files, **no lock**. Each log prints the `node_modules` LinkType (a Junction to `C:\w\pl-mc-fw\app\node_modules`), the SHA and the tree state first. The logs are in `docs/agent/program/evidence/agent-no-swallowed-fetch/`.

- **Focused, 23 files:** `agentNoSwallowedFetch`, `agentScanRefine`, `agentPageCalendar`, the census, and 19 stock / screener tests that import the changed capabilities. Result: `Test Files 1 failed | 22 passed (23)`, `Tests 1 failed | 431 passed | 1 skipped (433)`. The one failure is the census (`focused-head.txt`).
- **Census offenders, head vs master at the same SHA** (`census-print.test.js.txt`, the census's own regex and comment strip, copied into the tree for the run only):
  - master `75421184a3` (the same SHA as the merged head's master), 7 files / 9 sites (calendar 1, scanRefine 2, stock 1, StockChart 1, longHistory 1, NotebookTab 1, acceptance/lib.mjs 2): `agent/capabilities/calendar.js 0->1`, `agent/capabilities/scanRefine.js 0->2`, `agent/capabilities/stock.js 0->1`, `components/StockChart.jsx 0->1`, `pages/breadth/drill/longHistory.js 0->1`, `pages/journal-2-0/tabs/NotebookTab.jsx 0->1`, `testing/agent/acceptance/lib.mjs 0->2`.
  - this head, 3 files / 3 sites (StockChart 1, longHistory 1, NotebookTab 1): `components/StockChart.jsx 0->1`, `pages/breadth/drill/longHistory.js 0->1`, `pages/journal-2-0/tabs/NotebookTab.jsx 0->1`. All three are on master's list, and this PR touches none of them. `StockChart.jsx` is NEW on master since `292983f4bc` (it came with the merge). It is not an Agent file.
- **No new swallow in the diff:** `git diff origin/master...HEAD` has 0 added CODE lines matching `.catch(() => null | undefined | {})`. The 6 added lines that match are comments or this doc. The two added `.catch(` lines are `catch(e => fundamentalsUnread(sym, e))` and `catch(() => PASS_THROUGH)`.
- **Mutants, re-run** (`mutants.json`, each a whole-line replace applied alone, then `git checkout`). Kill set: `agentNoSwallowedFetch`, `agentScanRefine` and `agentPageCalendar`, 19 tests. **5 of 5 killed:**

| mutant | change | result | killed by |
|---|---|---|---|
| MS | `stock.js`: `.catch(() => null)` again | 1 failed / 19 | the stock "read throws" case |
| MC | `calendar.js`: a failed week returns `{ days: {} }` | 1 failed / 19 | the calendar UNAVAILABLE case |
| MR1 | `scanRefine.js`: the write ends in `.catch(() => null)` | 2 failed / 19 | "server unreachable", "a FAILED write is not silently lost" |
| MR2 | `scanRefine.js`: a failed read returns `null` | 1 failed / 19 | "server unreachable" |
| MA (AUDIT's) | `restoreLastScreen` returns `null` in place of `LAST_SCREEN_FAILED` (both returns) | 2 failed / 19, agentScanRefine red | "server unreachable", "a FAILED write is not silently lost" |

## Notes for AUDIT

1. **One existing test was rewritten.** The `agentScanRefine` test "the server unreachable" asserted the swallowed outcome: after a 500, it expected "Which screen should I narrow?". It now asserts the starting-fresh sentence, both logs, and that no scan ran on a guess.
2. **The calendar's sentence was already honest.** Before the fix, a failure said "I couldn't read the calendar right now", which was never "no reports". What the fix adds: the cause in the sentence, the log, a tagged result in place of `null`, and a rail that a failed week never reads as an empty one.
3. **Remaining limit on scanRefine:** the unsaved marker lives in memory for the session. After a failed write, a full page reload forgets the marker. The server's older copy would then be restored and refined. The failure was still logged when it happened. Closing this needs a persisted marker. Per the shared-origin localStorage rule, that marker must use an exact key. I've left it as a follow-up for the Lead to decide.
4. **Logging:** each warning carries the cause, the symbol or URL, and the chat. None of them carries a market value.
5. **Lint:** eslint on the 9 changed source and test files, 0 problems. **Not run here:** the full suite and the build. The Lead schedules the full suite.
6. **Known; reload case (AUDIT-accepted residual):** the scanRefine "unsaved" marker is in memory only. After a reload, a failed save leaves the server's OLDER screen as the one that gets refined. That is the same stale-copy bug, now only after a reload, and the console warn line is its only trace. There is no persisted marker now. The owner-approved follow-up PR persists it under an exact localStorage key.
