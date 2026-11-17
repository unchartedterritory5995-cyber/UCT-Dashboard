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
batch 2 SET.16-23, batch 3 SET.24-31, then SET.40-52: all 37 daily setup lessons, 696 live charts, every one checked
against the bars copy (check_course_charts: 0 failing). The intraday lessons (SET.32-34, 53, 54) wait for hourly course
charts: the server holds about 3 months of intraday bars for about 30 tickers, and its forward horizon knows D/W/M only.
**Step 3 built 2026-11-15** (below).

Rules every chart question follows (the validator enforces the starred ones):
- `asof` is the last day the member sees: the day before the breakout for "what is it / where is the pivot"
  questions, the buy day for trade questions. A trade (`chart.trade`) goes only on a buy-day chart.*
- The trade's entry and stop are the same numbers the question's words give.* Every number comes from the research
  dossier's table (docs/study/setups/research/NN-*.md), which was measured on the same bars.db the chart draws
  (split-adjusted), so the words and the chart agree.
- The ticker is not in the question, the story or the choices.* A course chart keeps its ticker off the badge until the
  answer (`prompt_json.chart.hide_ticker`; the reveal names it), so a famous winner (NVDA 2023) does not give the
  outcome away: decided 2026-11-14 on the owner's "you make a judgement call". Other lesson charts show the ticker
  before the answer (the owner, 2026-11-02 and 2026-11-08, "Yes"). The words never say "Hidden ticker" (removed from
  644 stories and questions on 2026-11-14). A story shows only on a scenario.* A number is never
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
4. ~~Reject the 5 approved size items retired on 2026-11-12~~ DONE 2026-11-15, on the owner's word instead: "Put them
   back in the review list for us to go over" (the 5 approved ones moved to draft, logged; the other 7 were drafts).
5. **Fill the intraday and index course charts** after every import that adds or changes one (they arrive as misses):
   `railway ssh --service web -- /opt/venv/bin/python scripts/study/fill_course_charts.py --dry-run`, then without
   `--dry-run`; it prints each failing chart's reasons and stores only the ones that pass (`--kind intraday|index` does
   one kind; `fill_course_intraday.py` is the old name for the intraday half). After the 2026-11-16 change of the
   intraday warm-up (60 to 200 bars), run it once with `--kind intraday --refresh` so every stored intraday chart is
   re-fetched with the longer history.
6. **A question that just got a chart goes back to review** if it was already approved (the import keeps an approval
   when only the content changes): `scripts/study/back_to_review.py --bank-chart-source index --reason "..."`
   (study_store.fix with the lesson text unchanged; only approved items move; `--dry-run` first).

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

**Built 2026-11-15.** `scripts/study/calc_visuals.py` draws the card at bank build (`prompt_json.visual`):
282 of the 661 live computed questions without a chart get one, in nine kinds (a price ladder, a move, back to even,
the size inputs, a bar's range, a quote, a slice of a whole, a record's wins and losses, an option at expiry). The
slices cover the 1%-of-volume ceiling and, from the second pass, a part of a whole (a win rate, the stocks above their
50-day, an order's share of the day: its slice draws only after the answer, since before it would show the answer);
moves cover a volume multiple ("4 times average"); ladders cover a midpoint, a level a stated percent under a peak, and
the dollars between two named prices (a spread's cost, slippage, a short's loss) with the share count under them.
The drill (`app/src/pages/study/ui/CalcCard.jsx`, logic in `calcCard.js`) draws it under the question and story, with
the answer slot reading "?"; once the verdict screen closes the slot fills from the reveal's `facts.calc.result`, the
picture completes (the level asked for and the R steps on the ruler, the part of a move, the payoff line) and the
working line prints under it ("50 + 3 × (50 − 47.5) = 57.50"). The slot and the working line end on the key's own
words when the key states the scored number ("$57.50", "0.70", "Made $120"), so the card agrees with the choice
picked. Every other computed question gets the working line alone after the answer. Checked on real screens (phone
390 and desktop 1440, the hub sandbox) on 2026-11-15: 16 targets covering every kind, before the answer, under the
verdict screen (nothing fills there) and after it. The rules the builder keeps (tests/test_study_calc_visuals.py):
- the card holds the question's inputs only, never the result (it rides in the prompt, which a member gets first);
- every number on it is stated in the question's own words (question, story, fill sentence; never the choices, which
  hold the answer), so a stop "three cents under the low" gets no card rather than an unstated price;
- a shape is drawn only when its roles are certain (`a + 3 * (a - b)` is an entry and a stop, and the words must name
  "3R"); a percent between two prices names no roles unless the expression does ("consensus", "entry"), so "how far
  above the 9 EMA" is never drawn as a start and an end.
- a percent the words do not state is the rule being tested ("1% of volume", "4% over the pivot", the monthly loss
  limit), so such a question gets no card: the card would hand over the method.
The card adds no words or numbers to a question, so a re-import at the same version keeps every approval
(study_store.upsert_items). The remaining 379 computed questions are generic expressions whose roles a shape cannot
fix ("(a - b) / c" for an ATR depth) or rule questions as above; a writer pass could give each one an explicit
`visual`, checked the same way.

**The second half, 2026-11-15 evening: cards written by hand.** A question whose expression no shape can read may carry
its own `visual`, held to the same contract by `calc_visuals.written_problems` (and so by unit_problems and gen_courses):
a known kind with its fields, the inputs only, every number on it (labels, title and unit included) stated in the words,
never the result. Writers wrote 321 across 112 lessons and cold checkers fixed 73 (labels that hinted at the answer,
a percent with no base, yields drawn on a price ruler, a method in a title such as "delta times move") and dropped 6.
596 of the 661 computed questions now carry a card; the 65 left are the rule questions above and a few where nothing
honest fits. A written card may name itself (`title`) and give a plain number its unit (`find.as: "num"`, `unit`).
A spread's payoff is drawn by each leg's own side (a credit spread written sold-leg-first drew upside down before).

## Step 4: what the data allows (checked 2026-11-15)

- **Options:** the computed options questions (breakeven, intrinsic and time value, payoff, spreads) carry the payoff
  card above. A conceptual options question has no numbers to draw.
- **History charts (built 2026-11-15):** the bars hold no index series, only the funds (SPY from 1995, QQQ from 1999,
  DIA, IWM, the sector funds), so a history question is charted on its fund only when its question, story and choices
  quote no index LEVEL (a fund prints about a tenth of the S&P 500; the explanation after the answer may keep the
  levels, as History Detective does, since the answer names the fund). 15 questions in F7.01-F7.09 carry one (SPY, XLE,
  KRE), each checked against the bars and its outcome confirmed in the closes. More wait for an index series.
- **Index history charts (built 2026-11-16):** a chart may name an index itself (courses_lib.INDEX_SERIES: SPX, IXIC,
  NDX, DJI, RUT; IXIC, never COMP, which is a listed stock), from Yahoo's daily history, the source the app's index
  charts already use. The import never reads bars.db for them (`source: "index"`); fill_course_charts.py fetches each
  on the pod, checks it and stores only a pass. The server never tops their replay up from bars.db, and the replay's
  intraday fill skips them (adjustment_basis "index level"). What the history allows, measured: real candles only from
  1983-07 (SPX), 1990-04 (IXIC), 1986-10 (NDX), 1987-09 (RUT), 1992-01 (DJI), and the OPEN is only the prior close on
  most S&P 500 days before 2008 (and a quarter of 2012-13), Nasdaq 100 days before 2000 and Russell days before 2007, so
  the checker refuses a chart showing closes-only days, more than one stale open in ten, or a copied row (the Russell's
  2024-07-19 repeats the prior day's open and high). The Russell's and the Nasdaq 100's volume there is another index's
  (92.5% and 80% of days), so those charts carry no volume. 84 candidates (live questions naming an index and a year)
  went to four writers and three cold checkers: 18 charted (SPX 9, IXIC 8, RUT 1) in F1.02, F6.07, F7.01-F7.05, F7.07 and
  F7.08; 5 specs corrected by the checkers (a replay that ended on a bounce the words say failed, a window that cut off
  the peak the question names so a wrong choice looked right, a replay that answered the next question, a copied row);
  the rest skipped with reasons (conceptual, before real candles, total-return figures a price chart would contradict,
  outcomes past the 60-day replay). The writers also found that FRED's NASDAQCOM rows from 2003-01-22 to 2004-08-06
  often hold the day's high or low, not the close: F7.03 q21 had called two of them closes, and now cites AP and
  CNN/Money closing reports (its key, May 2, 2003, is unchanged).
- **Intraday lessons (built 2026-11-15):** a course chart may be `tf` 5/15/30/60 with `asof` "YYYY-MM-DD HH:MM" New
  York, the START of its last visible bar on the regular session's grid (courses_lib.intraday_asof_problem). The bank
  passes the server that bar's unix time and `rth: true`, so the import keeps the regular session only (bars.db holds
  04:00-20:00). The examples' bars come from the provider, which the pod's bars.db mostly lacks, so the import stores
  them as misses and **scripts/study/fill_course_intraday.py fetches each one on the pod, runs check_bars (the daily
  checks, per bar) and stores only a chart that passes**. 48 charts in the five lessons, every one checked against the
  provider's bars on the pod BEFORE it shipped (a read-only run; two META charts whose stop sat inside the provider's
  candle were dropped), and a cold checker reconciled the words with the real bars (TSLA's stop a candle earlier, VIAV's
  first candle green, AAPL's fill bar trading 1R over the buy). The drill marks a DECISION BAR on an intraday chart.
  2026-11-16: the warm-up ahead of an intraday window is 200 bars (was 60), so the member's 200-period average has a
  value from the first candle (the screen check found its legend empty; D-021: the 9 and 20 EMA with the 50 and 200
  SMA); the provider holds that history for all 48 charts (a read-only check on the pod). The intraday axis gets a
  five-character label slot and half hours read "10:30", so the times stay between the day marks on a phone after the
  replay.

## Open needs

- PR #1046 merged and imported, so the charts can be seen on the site (all this work is local until then).
- Each new chart is owner-approved before it goes live (D-007).
