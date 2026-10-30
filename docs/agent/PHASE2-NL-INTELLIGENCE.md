# UCT Agent Phase 2 — Natural-language intelligence (Workstream A)

Built overnight on 2026-10-29, on branch `feat/agent-p2-nl`. It is not merged or deployed.

Traders follow up the way they talk: "make the fast one green", "put those on my other charts", "do the same thing on
the others". They also ask for several things in one sentence. This workstream reads those **deterministically, with
no model call**. Every result is the same registry ops a typed command produces, so the same planner, policy,
receipts and Undo apply. There is **no second command engine**.

NL-1 stays off. The new readers run on the legacy path only, which is production's path today. When NL-1 is on,
the model reads every request, and it now gets `recent_indicators` to resolve the same references.

## What was built

| Module | What it reads | Notes |
|---|---|---|
| `agent/conversation.js` | Indicator references: "the first / second / last one", "the fast / slow one", "the 9", "the rsi", "it", "that indicator I just added", "the other one", "those", "them both". Chart sets: "my other charts", "the others", "the rest", "all of them", "both", "everywhere", a position, an ordinal or a symbol. Actions: colour, line style or width, remove, hide or show, a new length or type, pane size ("a little taller"), where it draws ("in its own pane", "under price"), copy onto charts, "do the same on …", "make … match / look like …". | References come from session memory and are **re-checked on the live chart every time**. A bare pronoun only counts while the last change was an indicator change. When something is genuinely ambiguous it asks locally ("Which one — EMA 9 or EMA 20?") with the indicators as choices. It never guesses. |
| `agent/compound.js` | One message with several steps. Each step's chart scope carries forward from earlier steps ("make the 9 green" means the four charts the request just set up). | The plan is read **in full before anything runs**: the request is cut at commas, "and" and "then" into the fewest clauses that each read as one step. If one clause cannot be read, the whole request goes to the model. Then it runs step by step on the live board. A step that is refused, fails, asks a question or needs approval **stops** the request, and the reply says what was and was not done. |
| `agent/memory.js` | A member message is one **turn**. Memory keeps the latest adding turn's **indicator set** (kept across restyling turns) and the turn's **mentions**. | It is bounded: 24 steps, 30-minute TTL, dropped on a board or layout change and on undo of a step. `forModel().recent_indicators` sends ids and legend names only. |
| `agent/duplicates.js` | Any add (typed, model-planned, or a step of a multi-step request) of an indicator the chart already shows with the same settings **reuses** the existing one: nothing is added, the reply says so, and memory points at that instance ("make it a 9" edits it). A hidden one is shown instead. | Every new chart already draws EMA 9/20 and SMA 50/200. An explicit copy ("add another 20 EMA", "a second RSI", "RSI again") is added through the same canonical Add to Chart. An approved card is never re-screened. |
| `fastPath.js` | "top left" without a hyphen. "make them all daily" (the pronoun belongs to "all"). "put the 9 and 20 ema on …" (the verb "put" carries over). | |
| `nl/lexicon.js` | `SHORT_FIXES` for the short words traders mistype ("ad teh 20 ema", "mak it green"). | They are used only when the corrected sentence parses into a safe, reversible action. |
| `api/services/uct_agent/turn.py` | The prompt says how `recent_indicators` and "my other charts" read. | The server's validation, approvals and limits are unchanged. |

## Limits (preserved, never raised)

- **Per step:** each step of a multi-step request is one request's worth of changes. `MAX_STEP_OPS` is the
  manifest's `maxOps` (12). A larger step stops the request before it runs and says why.
- **Per message:** at most 6 steps (`MAX_STEPS`). More than that is refused with the reason, and nothing changes.
- **Per follow-up:** at most 24 changes in one follow-up (`MAX_FOLLOW_OPS`), for example "do the same on the other
  charts" on a large board.
- **Policy:** removals, look copies and other guarded actions are still proposals, decided by `policy.decideMode`.
  Each step keeps its own receipt and Undo.

## Decisions to review

1. **Decided (owner, 2026-10-29): duplicates are reused.** A single typed "add a 20 EMA" on a chart that already
   shows EMA 20 now reuses it, and "add another 20 EMA" adds a second one. `agentGateCIndicators` was updated
   deliberately: the edit-and-undo conversation now uses a 21 EMA, and two new tests rail the reuse (same instance
   edited, Undo restores it) and the explicit copy.
2. **"Actually, make the 20 yellow instead" leaves the earlier colour change in place.** It applies the new change.
   "Instead" is not treated as a reversal; the member can say "undo".
3. **"Move that over there" goes to the model.** It is genuinely unclear where "there" is.
4. **"Put the 9 above the 20" (both on the price pane) is refused plainly.** UCT has no draw-order control, so the
   reply says so and offers its own pane instead.

## Tests

| File | What it covers |
|---|---|
| `agentConversationP2.test.jsx` | 24 conversations through the real panel, asserting **board outcomes** and **zero model calls**. Groups: R (references), S (chart sets, including "make them all green" after a copy), M (multi-step: the flagship, stop-and-say, nothing half-run, the step limit, per-step Undo), G (guards: stale reference, a pronoun after a chart change, nothing invented, typos, "above the 20"). |
| `agentConversationUnits.test.js` | 30 unit tests: memory turns, sets, mentions, undo and TTL; words; chart sets; the planner. |
| `testing/panelHarness.jsx` | The shared harness. The real panel over a fixture board, with the model stubbed by a visible sentinel. |

The full Agent suite on this branch is 1653 passed, 0 failed. The Python Agent tests are 663 passed.

## Try it (admin, Charts)

1. "Throw the 9 and 20 on my chart", then "Make the fast one green", then "Actually, make the 20 yellow instead".
2. On a four-chart board: "add the 9 and 20 ema to the top left chart", then "Now put those on my other charts".
3. "Create four daily charts for SPY, QQQ, NVDA and TSLA, put the 9 and 20 EMA on all of them, make the 9 green and
   20 yellow, and put RSI in its own pane."
4. "Put RSI under price and make it a little taller".

## Next

- **Model path:** a compact "working set" in conversation memory for the steps a multi-step request leaves to the
  model.
- **Copies by position:** "make the copy on the right red". After a copy, copies are referents as a group only
  ("make them all green" covers the originals and every copy).

## Live acceptance corrections (2026-10-29)

Three failures from the owner's authenticated production test. Regression tests: `agentAcceptanceP2.test.jsx` (D1, D2)
and `agentGuideTarget.test.jsx` (D3).

| Defect | Root cause | Fix |
|---|---|---|
| D1 "throw the 9 and 20 ema on my chart. make the fast one green and the other one yellow" → "I don't know that indicator" | The multi-step reader did not cut at a sentence boundary, so the request went to the model. The model's context carried the indicator catalog only after add/put/apply/insert/load/plot, so it planned without catalog ids. The colour look routed only as "make the 9 green". "The other one" ignored the one named earlier in the same instruction. | `compound.js` cuts at `. ! ?`. The catalog is sent whenever the message names an indicator (the routing group's own words) or uses a placing verb. A colour or line look in an indicator message routes `indicatorSetup`. `conversation.js` passes what an earlier part named (`taken`). A model add naming a built-in instead of its id ("ema" + period 9) resolves through the instant path's own readers (`canonicalIndicatorAdds`). |
| D2 "open daily charts for AAPL MSFT NVDA, each with a 50sma" → "There isn't enough open space…" | The grid reader needed a count or a layout word. "Each with a 50sma" read as nothing, so the request went to the model. The model's plan (new charts plus an indicator on each) was not the grid shape `screenChartGrid` converts. | "Charts for <tickers>" is a grid. "Open" asks for new charts (the existing one is kept). "Each with X" is "add X to all of them" on the grid's charts. "50sma" reads as "50 sma". A model plan whose extra ops target the new charts becomes the grid, then those ops on the charts now showing their tickers (`runCompound`, same execute and policy). The grid's Undo compares an ADDED chart by what it draws, so an indicator added then undone on it no longer blocks that Undo. |
| D3 "Show me how to change the timeframe" highlighted the whole toolbar row | `data-guide="chart.timeframe"` sat on `ChartTfBar`'s root, and `ChartPane` renders the row's other controls as its children. | A non-shrinking group around the timeframe buttons and ⌄ carries the target. `rectOf` clips the ring to an overflow-hidden ancestor. Verified in the real workspace (agent-harness): one or two charts, the panel open and closed, several widths, the selected chart, Next/Back/Done. |

Note for Indicators (not changed here): the Indicators interface's own Undo of an add leaves bookkeeping in the stored
settings (a tombstone, renumbered ids, `preset: "custom"`), also on master for a plain "add rsi" → "undo". Nothing
the member sees differs.

### Final live acceptance (2026-10-29): lowercase tickers in a chart grid

"open daily charts for aapl msft nvda, each with a 50sma" (one BRCB daily chart on the board) answered "UCT Agent
returned something unreadable".

- **Root cause.** The chart-grid reader (`multiChart.js`) took only tickers typed in capitals or with `$`. With
  lowercase tickers it read nothing, the multi-step planner had no grid step, and the request went to the model.
- **What the server did.** It refused the model's reply (`_unreadable` → 400) before any plan reached the browser, so
  nothing on the board changed. The `uct_agent unreadable: <reason>` log line from that time records which shape check
  failed.
- **Fix.** `gridTickers` also takes lowercase words in a grid sentence:
  - only words left once the sentence's own words are removed;
  - at most four letters, so a company name like "apple" stays with the model;
  - only words that pass the shared N4 rule `plainSymbolWord`: not a word UCT knows or a typo of one, not a short typo
    such as "teh", not a pronoun.
- **Existence check.** The ticker search in `chartGrid.set` prepare still decides whether each ticker exists. An
  unknown one refuses the whole grid by name, and nothing changes.
- **Tests.** Regression tests in `agentAcceptanceP2.test.jsx`, under "the tickers typed in lowercase". Verified in the
  real workspace (agent-harness): an equal 2×2 with no model call, and one Undo restored the single chart.
