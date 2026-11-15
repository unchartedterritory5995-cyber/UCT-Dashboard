# Study visuals: every question gets a visual (plan, 2026-11-14)

The owner, reviewing setup questions on 2026-11-14: "a visual along with it to see would be nice. Using our tick by
tick with live lessons. Build this it is critical. Visual for all lessons really." Asked to choose, he picked **a chart
plus a replay after the answer** for the visual type, and for scope: "Would prefer all of them to have some sort of
visual representation or example or card or lesson to enhance the experience and the lesson and teaching."

## What exists today (measured 2026-11-14)

- A course question may carry `chart: {sym, asof, window, forward}`; the importer resolves the bars on the pod
  (`bars_sqlite.get_bars_before`) and the drill player draws them with the house chart look and setup overlays
  (gap support, HVE, go signal, slingshot, bear gap). Only **82 of 5,012** live questions use it (72 setup, 9 history).
- The reveal shows the bars after `asof` all at once ("forward bars land at once"): round 17 replaced the old
  run-on, which the owner called ugly. The games (Trade Story, Daily Chart, Draw It) already replay bars.
- The setup cards hold **440 winners, 244 failures, 176 near-misses, 20 owner-graded, 27 UCT-named and 10 owner
  model** examples, each with ticker, date and the dossier's measured numbers (entry, stop, outcome).
- No price bars on this PC: charts can only be drawn on the pod, so the owner sees them on the site's review screen
  after PR #1046 is merged and imported.

## The visual for each kind of question

| Kind of question | Visual | Count (approx.) |
|---|---|---|
| A setup decision (buy, wait, pass, where the stop goes) | the real example's daily chart up to the decision, the setup overlay, then the replay after the answer | most of 2,660 setup questions |
| A setup definition or rule ("tight at the end", "flat ceiling") | a real example chart with that feature highlighted | setup and vocabulary questions |
| Market basics, orders, risk math (bid/ask, sizing, R) | a small **card**: a quote board, an order ticket, a position-size card, an R ladder | about 1,300 |
| Options | the payoff diagram (the Options Payoff game's component) or the Greeks card | 416 |
| History and breadth | the index chart of the episode | about 200 |
| Psychology and process | a short scenario card (the trade, the feeling, the rule) | about 300 |

## Build order

1. **Replay after the answer (app).** In the drill player, after the answer the bars after `asof` play forward bar by
   bar at a steady pace with Skip and Replay buttons, the trade's entry/stop drawn on, and it stops at the last bar.
   It is a finite animation driven by the adaptive frame loop (no endless animation; CLAUDE.md speed rules).
   Phone and desktop. Tests, then a real-screen check.
2. **Setup charts (content), lesson by lesson.** For each setup scenario: pick the card example that fits (a winner,
   a failure or a near-miss), rewrite the story to that example's real numbers (from the dossier, never invented),
   attach `chart`, keep the ticker hidden until the answer. A writer and a cold checker per lesson; the validator
   and the example rules (legible chart, liquid name, MUST WORK for a winner) apply. Every chart goes to the owner
   for keep / keep with a note / cut on the site's review screen (his example rule, D-007).
3. **Cards for non-chart questions (app + content).** A `visual` field with a few card kinds (quote board, order
   ticket, size card, R ladder, payoff, scenario card) rendered by small components, then attached per lesson.
4. **Options payoff and Greeks visuals; history charts.**

Step 1 and step 2 go first; step 2 runs in parallel with the owner's review, lesson by lesson, setups first (his
"core first" order).

## Status and what the 2026-11-14 check found

**Step 1 is built** (DrillPlayer): the replay after the answer, Skip and Replay, the replay clock; a course question
whose chart ends on the buy day carries its trade (`chart.trade: {entry, stop}`, from the research), drawn after the
answer as the entry and stop lines with 3R and 5R as marks on the ruler, and BOUGHT / 3R / 5R / STOPPED landing only
when the replay reaches their day; a course chart with no trade marks its DECISION DAY once the bars after it play.
**Step 2 pilot:** Flat Base (SET.07), 19 charts, 4 with trades.

Rules every chart question follows (the validator enforces the starred ones):
- `asof` is the last day the member sees: the day before the breakout for "what is it / where is the pivot"
  questions, the buy day for trade questions. A trade (`chart.trade`) goes only on a buy-day chart.*
- The trade's entry and stop are the same numbers the question's words give.* Every number comes from the research
  dossier's table (docs/study/setups/research/NN-*.md), which was measured on the same bars.db the chart draws
  (split-adjusted), so the words and the chart agree.
- The ticker is not in the question, the story or the choices.* A story shows only on a scenario.* A number is never
  cut between the story and the question* (2026-11-14: three were, "bought at 73." / "16 with the stop").
- The lines named in the words are the lines on the chart: the 9 and 20 EMA, the 50 and 200 SMA (D-021).

## After the merge (pod steps, in order)

1. Import the bank (the usual import). Course charts resolve through `bars_sqlite.get_bars_before`; a miss is
   reported, never fetched.
2. The owner approves the charted questions on the site's review screen (D-007).
3. **Fill the replay within the day** for the approved charts:
   `railway ssh --service web -- /opt/venv/bin/python scripts/study/fill_replay_intraday.py --max-minutes 25`
   (repeat until "left": 0). It picks up approved course charts by itself (`study_store.intraday_candidates`: any
   approved daily chart item with a symbol). Without it the replay runs day by day; charts before 2003-09-10 always
   do (the provider's intraday floor).
4. Reject the 5 approved size items retired on 2026-11-12 (corrections/size.house_rule.jsonl).

## How the owner approves charts with less work

Every setup card has its examples drawn as images (44 setups, about 24 each:
`_study-resume/scratchpad/setups/<card>/final/`, the ticker, buy, stop and R marks on them, for his eyes only). The
chat review (`chat_review.py next`) prints the matching image for each charted question, and it is sent with the
question. An example he approves once can back every question that uses it, so the approvals scale with the
examples (about 18 per setup), not with the questions.

## Step 3, made concrete (cards for non-chart questions)

- Draw a card from the question's own `calc` when it has one, never from hand-typed numbers: `shares_from_risk`
  (44 live) -> the size card; `r_multiple` (33) and the R-level `arith` forms -> the R ruler; `pct_change` (50),
  `drawdown_pct` (30), `gain_to_recover` -> a move bar; `option_breakeven`, `option_payoff`, `vertical_payoff`,
  `intrinsic`, `extrinsic` -> the payoff diagram (the Options Payoff game's drawing). About 220 questions get a card
  with no new content work; the 588 generic `arith` ones are mapped by expression where the shape is known.
- Before the answer the card shows only what the question gives; after it, the card fills in the answer (the same
  way the chart replays after the answer).

## Open needs

- PR #1046 merged and imported, so the charts can be seen on the site (all this work is local until then).
- Each new chart is owner-approved before it goes live (D-007).
