# Study levels programme: entries, stops and sell rules, from every source we have

The owner, 2026-11-06, on what Hard mode and the drill still wait on him for (entry and stop levels per setup, sell rules,
moves inside each day): "We will have to work through the entire brain system knowledge base content examples pattern rec
internet avilable information and studies and everything to further inform and enhance the question and answers and
explanations and examples".

Nothing in this folder reaches a member. Every rule that ships is one the owner ruled on, and every number it puts on a
chart is computed from the bars by that rule (no runtime AI; no model writes a market fact).

## What is waiting on him

| setup | entry | stop | sell rules |
|---|---|---|---|
| Kicker | **ruled**: over the red day's high, or the day-2 30-minute opening range (2026-11-02) | **ruled**: under the Kicker candle's low, at most 3.5%, usually less | open |
| Oops Reversal | open | open | open |
| Gap Support | open | open | open |
| High Volume Edge | open | open | open |
| Slingshot | open (his note: "Meant to be used to enter PEGS mostly") | open | open |
| Launchpad | open | open | open |
| Bear gap (short) | open | open | open |

Moves inside each day on the run-on (his batch-5 ask) need intraday bars the bank does not carry for these dates; drawing
them without data would invent prices, so that waits on a data source, not a ruling.

## The sources, and where each stands

| source | what it gives | status |
|---|---|---|
| His rulings (`docs/study/audits/2026-10-24/owner_verdicts.jsonl`, the bank lessons) | the authority on every line | collected: levels ruled for the Kicker only |
| The brain's setup templates (uct-intelligence `data/setup_templates_staging.json`, 34 templates) | entry triggers, stop methods, max stop %, profit targets, adds, invalidation, hold time, common mistakes, by trader (Kell, TSDR, Bracco, Minervini) | read: full templates for Kicker, Gap Support (Open Bull Gap Support), High Volume Edge (HVC), Oops Reversal; none for Slingshot, Launchpad, Bear gap |
| The brain's knowledge base, worked examples and setup performance (on the web pod: `<DATA_DIR>/brain`) | trader passages on entries, stops, trims, adds; model examples with entry, stop, target, outcome; win rates and expectancy by regime | `pod_kb_levels.py` (read-only) is ready for the owner to run with `!` |
| The video lesson library (#tsdr, #bracco) and the Trader Archive | the traders' own words; the knowledge base is distilled from them | reached through the knowledge base first; transcripts if a rule needs the original |
| The pattern engine (`api/services/pattern_engine/detectors/uct/*`) | each detector's entry and stop | in the evidence below |
| The bank's own examples (`docs/study/bank/spot.setups.json`, `spot.bear_gaps.json`) | how each candidate rule behaves on his chosen charts over 60 sessions | `measure_rules.py` → `evidence.md` |
| Outside research (originators, educators, studies) | published entries, stops, trims, statistics, with citations | `external_research.md` |

## The method

1. **Dossier per setup**: the candidate entry, stop, trim and trail rules side by side, each with its sources (his words
   first) and its line in `evidence.md`.
2. **His rulings on the workbench shell**, one setup per piece: pick or edit each line; stored verbatim in
   `owner_verdicts.jsonl` the same day.
3. **Encode the ruled rules** as pure functions over the bars (like `hardMode.culmination`), with rails.
4. **Into the product**: the entry and stop drawn on the reveal and named in the coach card ("How to trade it": entry,
   stop, risk, and the culmination in R); new questions (where is the entry? where is the stop?); Hard mode's third step
   (name it, enter it, stop it) and Draw-it, which have waited on exactly these rulings.

Order: the Kicker first (his rulings exist; encode and show them), then Oops Reversal, Gap Support and High Volume Edge
(the brain has full templates), then Slingshot, Launchpad and the Bear gap (the least material; his input matters most).
