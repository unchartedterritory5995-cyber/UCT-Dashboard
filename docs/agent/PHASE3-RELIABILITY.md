# UCT Agent Phase 3: Undo, receipts and reliability (Workstream 4)

## A. The Indicators Undo residue: handed off, fixed by Indicators

The residue was reproduced field by field and traced to `undoIndicatorMutation`, which undoes an `add` with the remove
writer. The full handoff is in `PHASE3-INDICATORS-HANDOFF.md`: exact fields, cause, expected restoration and suggested
tests.

- **Indicators' fix:** draft PR **#517** (`fix/indicators-exact-undo`), in their own `agentMutations.js`. The Undo token
  stays opaque, so no Agent change is needed.
- **No Agent workaround:** the Agent never writes indicator state around the mutation interface.
- **Agent-owned and kept:** the grid's own Undo compares only what IT writes back on a reused chart (WS2,
  `PHASE3-WORKSPACE.md`).
- **After #517 lands:** the Agent's drawn-equality assertions after an indicator Undo can be tightened to stored
  equality (`agentAcceptanceP2.test.jsx`).

## B. Multi-step rollback: "undo all of that"

**Before:** "slap the 9/20 on all four" made 8 changes, and "undo" took back one at a time. There was no way to take
back a whole request.

**Now:** "undo all of that", "undo everything you just did", "take it all back" and "undo that whole request" take back
every change the LAST request committed.
- **Which changes:** the session memory's last turn, the same set "do the same on the others" repeats.
- **Order:** newest first.
- **How:** each through the same `doUndo`, with its own refusals (protected layout, another board, changed since).
  Undo never reaches past the last request.
- **On refusal:** the first change that can't be undone stops the sequence, and the member hears exactly how much was
  done: "Took back 5 of the 8 changes from your last request, then stopped (above) — the other 3 are still in place."
  The reason for the stop is the refusal just above it.
- **Single change:** this is the ordinary Undo.

**Verified:**
- the four-chart 9/20 adds (all 8 back);
- the composed workspace (grid, watchlist rail and four RSI back to the original single chart; 5 changes);
- a hand-edited EMA in between (5 of 8, then it stops).

**Exact restoration of stored state.** A chart the grid ADDED is compared by what it draws, because its Undo removes the
whole chart. Everything else is compared exactly. Once Indicators #517 lands, indicator Undo restores stored settings
exactly too.

## C. Receipts

**One chart changed on a board of several now names the chart:** "Chart (TSLA): Changed symbol to AMD", "Chart (SPY):
Switched timeframe to Weekly". Before, it said only "Changed symbol to AMD".
- A change on several charts already named each one.
- A one-chart board is unchanged.
- The label is the chart as it was before the change, so it identifies the chart the member saw.

**Already present (Phase 2) and unchanged:**
- "already there — not added again";
- "Done N of M steps, then stopped at …: why. Not done: …";
- proposals for what needs approval;
- the Undo button on every receipt.

## D. Failure recovery

**The model's unreadable reply** (WS1, `PHASE3-CONVERSATION.md`) gets a specific sentence: too long to plan, a step's
details didn't fit, or the plan was incomplete. Each says "nothing was changed".

**Success is never reported before execution is confirmed.** This is the existing runtime rule (land → receipt), and is
unchanged. The tests cover:
- a refusal mid-way ("Took back 5 of the 8…");
- a refused grid ("no room for a Watchlist on the right…");
- refused corrections and swaps.

Each states that nothing, or exactly what, changed.

## Tests

- **`agentReliabilityP3.test.jsx`:** 12 tests.
  - the whole-request Undo phrases, and that "undo" alone stays one change;
  - 9/20 on four charts taken back in one request;
  - a composed workspace back exactly;
  - an edit in between stops it, with an exact account;
  - a single change;
  - receipts naming the chart, and not naming it on one chart.
