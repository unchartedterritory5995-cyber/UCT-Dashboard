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
| `agent/duplicates.js` | Inside a multi-step request, an add of an indicator the chart already shows with the same settings is not added again. A hidden one is shown instead. | Every new chart already draws EMA 9/20 and SMA 50/200. See the owner decision below. |
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

1. **A single typed "add a 20 EMA" on a chart that already shows EMA 20 still adds a second one.** That behaviour
   is railed in `agentGateCIndicators`. The no-duplicate rule applies only inside multi-step requests, where the
   next step names the indicator. **Recommendation:** apply it to single commands too. Every new chart already
   draws EMA 9/20 and SMA 50/200, so "throw the 9 and 20 on my chart" stacks identical lines. This would need the
   Gate C tests updated.
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

- **Owner decision 1:** the no-duplicate rule for single adds.
- **Model path:** a compact "working set" in conversation memory for the steps a multi-step request leaves to the
  model.
- **Copies by position:** "make the copy on the right red". After a copy, copies are referents as a group only
  ("make them all green" covers the originals and every copy).
