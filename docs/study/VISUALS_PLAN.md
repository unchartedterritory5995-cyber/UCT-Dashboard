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

## Open needs

- PR #1046 merged and imported, so the charts can be seen on the site (all this work is local until then).
- Each new chart is owner-approved before it goes live (D-007).
