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
- Members see charts only after PR #1046 is merged and imported (the pod draws them from its own bars.db). A copy of
  that bars.db (2026-11-09) sits at `_study-resume/data/bars.db`: `python -m scripts.study.check_course_charts --bars
  <it>` resolves every course chart the way the server will and checks it (asof is a bar, the trade traded that day,
  the stop beyond the day's low) and prints each trade's outcome in the bars the member replays.

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
**Step 2 pilot:** Flat Base (SET.07), 19 charts, 4 with trades. **Step 2 rollout (2026-11-14):** batch 1 SET.08-15,
batch 2 SET.16-23, batch 3 SET.24-31, then SET.40-52; 510 live charts after batch 3, every one checked against the
bars copy. The intraday lessons (SET.32-34, 53, 54) wait for hourly course charts.

Rules every chart question follows (the validator enforces the starred ones):
- `asof` is the last day the member sees: the day before the breakout for "what is it / where is the pivot"
  questions, the buy day for trade questions. A trade (`chart.trade`) goes only on a buy-day chart.*
- The trade's entry and stop are the same numbers the question's words give.* Every number comes from the research
  dossier's table (docs/study/setups/research/NN-*.md), which was measured on the same bars.db the chart draws
  (split-adjusted), so the words and the chart agree.
- The ticker is not in the question, the story or the choices.* The chart badge shows it before the answer in a lesson
  (the owner, 2026-11-02 and 2026-11-08, "Yes"), so the words never say "Hidden ticker" (removed from 644 stories and
  questions on 2026-11-14). Whether course charts should hide it until the answer, so a famous winner does not give the
  outcome away, is for the owner to decide. A story shows only on a scenario.* A number is never
  cut between the story and the question* (2026-11-14: three were, "bought at 73." / "16 with the stop").
- The lines named in the words are the lines on the chart: the 9 and 20 EMA, the 50 and 200 SMA (D-021).
- `forward` is how many days the replay plays after the answer: the reveal carries the first 20 and the drill fetches
  the rest, up to the server's 60. Pick it so EVERY outcome the words name plays, after the stop too ("went on to
  26.4R", "later reached 5R without us"); a named outcome past day 60 is dropped from the words (2026-11-14: MU named
  5R over a 10-day replay; PANW named 26.4R over 40 days that peak at 23.2R; ESS named 14.9R on day 66).
- A trade is drawn only when its stop is within 6% of the entry; a wider real stop stays in the words, undrawn.
- Every course chart loads 200 bars of history ahead of its window (courses_lib WARMUP_BARS; the drill opens on
  `visible_bars`), so the 50 and 200-day averages are drawn from the first visible candle. Words that name the
  200-day need 200 bars by asof (check_course_charts fails it otherwise; "no 200-day yet" on a young stock is fine).
- The drill (2026-11-14 screen check): the replay starts when the verdict screen closes and the chart scrolls into
  view; the decision day and the trade's marks are counted from the session's reveal, which holds the whole replay.
- The chart draws only the 9/20 EMA and 50/200 SMA, plus the 4-day line of highs on Slingshot questions (SET.27; the
  overlay keys on the course skill `setup.slingshot` too since 2026-11-14). No AVWAP, trendline, box or neckline is
  drawn on a course chart: a question that needs one gives its price in the words. The HVE, Gap Support and Bear Gap
  overlays stay off course charts: they anchor on the chart's last day (or a gap date course items do not carry),
  and a course chart often ends on a later decision day.
- Run check_course_charts before committing a chart batch; it must report 0 failing. It also prints each drawn
  trade's outcome in the replay, after the stop too; `_study-resume/overbuild/chart_outcome_check.py` compares that
  with the words. A checker drops a chart the bars contradict with `"chart": null` in its fix.

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
