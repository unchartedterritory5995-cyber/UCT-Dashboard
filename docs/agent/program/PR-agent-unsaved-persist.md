# PR: an unsaved screen survives a reload (follow-up to #1033, pl-widget)

Branch `agent/pl/agent-unsaved-persist`, stacked on #1033 at `e21244ac97`. Merge it right after #1033. The owner approved the plan, and so did the Lead.

## What changes for the member

#1033 kept the "this chat's newest screen was not saved" marker in memory only. So after a reload, a failed save left the server's OLDER screen as the one that got refined. Now:

- **This browser keeps the screen that failed to save.** It sits under ONE exact localStorage key, `uct.agent.unsavedScreens.v1`, as `{ [chat id]: { at, cause, screen } }`. The screen is the same slim shape the server would have stored.
- **The member is asked before anything is refined.** On such a chat, the first refinement answers: "This chat's newest screen (N conditions) wasn't saved to UCT, so UCT still holds an older one. Say “refine it” to save this browser's copy again and narrow it, or run a new screen to start fresh." Nothing is scanned, and the older copy is never used. The sentence gives a count of conditions only, never a value.
- **"Refine it" saves first, then narrows.** The next refinement saves this browser's copy to UCT again FIRST. Only after that save succeeds does it narrow that newer screen, and the entry is removed. If the save fails again, nothing is narrowed, the member is told, and the entry is kept.
- **Starting fresh** (any new screen whose save succeeds) removes this chat's entry, by its exact id. Other chats' entries stay.

## Storage rules (shared origin: memory rule "shared-origin localStorage, exact keys")

- **Exact key only.** The code reads, writes and removes `uct.agent.unsavedScreens.v1` and nothing else. It never calls `key()`, `length` or `clear()`, so a peer's key is never touched, even one with a similar name.
- **Capped at 20 chats.** The oldest `at` goes first.
- **Every storage call is wrapped in try/catch.**
  - A READ error fails closed: `LAST_SCREEN_FAILED`, so the refinement starts fresh (`LAST_SCREEN_UNREAD`). An unreadable record may be hiding a newer screen than the server's, so the older copy is never refined on a guess.
  - The tradeoff: a browser that blocks storage entirely gets "start fresh" after a reload, rather than the server's copy.
  - A WRITE error (quota, access) is logged (`this browser could not keep the unsaved screen (…)`) and never breaks the answer. The in-memory marker from #1033 still covers the rest of the session.
- **Lookup order in `restoreLastScreen`:** the stored entry first, then #1033's in-memory set, then the server.

## Changed files (`git diff --stat e21244ac97...HEAD -- app`, before this doc)

```
 app/src/agent/agentScanRefine.test.jsx         |   8 +-
 app/src/agent/agentUnsavedScreen.rail.test.jsx | 164 +++++++++++++++++++++++++
 app/src/agent/capabilities/scanRefine.js       |  78 +++++++++++-
 app/src/agent/capabilities/screener.js         |  31 ++++-
 4 files changed, 273 insertions(+), 8 deletions(-)
```

Product code: `scanRefine.js` (the store, the retry, the two sentences) and `screener.js` (`cache.unsaved`, `settleUnsaved` in `specFor`, one early return in `ensureLast`).

**`agentScanRefine` changed in two places:**
- Its `beforeEach` clears the exact key.
- "the server unreachable" removes the record before the reload. It still tests #1033's read-failure path, which is unchanged.
- "a FAILED write is not silently lost" now expects the question, not "starting fresh", because this browser holds the newer screen. It still asserts that the older copy is never refined.

## Results (LOCAL, vitest + jsdom, scripted fetch, invented data; BelowNormal, ≤25 files, no lock; logs in `docs/agent/program/evidence/agent-unsaved-persist/`, each with the LinkType header)

- **Rail first** (`16adf9194d`, test only, on #1033's `e21244ac97`): `Tests 8 failed (8)`. The main case is a failed save, then a simulated reload (module state emptied, localStorage kept), then "narrow that to tech". On #1033 the older copy was refined (`rail-red-e21244ac97.txt`).
- **After the fix** (`7d1250fb57`): the rail + agentScanRefine, `Tests 19 passed (19)` (`unsaved-green2.txt`).
- **Focused, 25 files:**
  - Scope: the rail, `noRegexLookbehind`, and #1033's 23 (its rails, the census, and the stock / screener tests).
  - Result: `Test Files 1 failed | 24 passed (25)`, `Tests 1 failed | 445 passed | 1 skipped (447)` (`focused-7d1250fb57.txt`).
  - The one failure is the census: the same 3 non-Agent files as #1033's head (StockChart.jsx, longHistory.js, NotebookTab.jsx; AUDIT has accepted them). This PR adds no `.catch(() => …)` and no lookbehind. Grep of the added lines: 0.
- **Mutants: 4 of 4 killed** (`mutants.json`; each a whole-line replace applied alone, run over the rail + agentScanRefine, then `git checkout`):

| mutant | change | result |
|---|---|---|
| U1 | drop the localStorage read (`entry = null`) | 4 failed / 19 (the reload case, "refine it", retry fails, and agentScanRefine's chat-switch case) |
| U2 | remove by a PREFIX scan over `key(i)` | 1 failed / 19 (exact key only) |
| U3 | a read error fails OPEN (`{ ok: true, map: {} }`) | 1 failed / 19 (access error: the older copy got refined) |
| U4 | the write is not caught (quota) | 1 failed / 19 (quota error) |

- **eslint** on the 4 changed source and test files: 0 problems. **Not run:** the full suite and the build. The Lead schedules them.
