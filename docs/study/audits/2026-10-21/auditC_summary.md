# Audit C: spot.fixtures, family.fixtures, vocab.chart, walk.method

Audit date 2026-10-21. Read-only on `C:\Users\pgosz\uct-worktrees\study-import` (branch `feat/study-screen-feedback-hub`, HEAD `12c46bf8a2`).
Verdicts: `auditC_verdicts.jsonl`, one line per in-scope item. **277 lines = 277 in-scope items** (every item in the four segments is `draft`; none approved). The script asserts the id sets match exactly.

## Counts per segment

| Segment | In scope | keep | fix | cut | Left for the owner |
|---|---|---|---|---|---|
| spot.fixtures | 132 | 0 | 39 | 93 | 39 |
| family.fixtures | 42 | 0 | 5 | 37 | 5 |
| vocab.chart | 78 | 8 | 21 | 49 | 29 |
| walk.method | 25 | 7 | 2 | 16 | 9 |
| **Total** | **277** | **15** | **67** | **195** | **82** |

All 82 surviving items, with the proposed fix applied, pass the importer's own checks (`api/services/study_import.py`: voice, number grounding, question length, walk-through shape). Fixes by field: spot `lesson_text` 39 · vocab `choices` 15 · vocab `lesson_text` 6 · family `q` 5 · walk `steps` 2.

## What was verified

- **Every spot and family item (174)** against its source fixture: the file exists; it is positive or negative (no edge file is used); the key equals `expected.fires` (spot) or the skill_map family (family); the reveal quote is the fixture note verbatim; the embedded bars are identical to the fixture's bars, bar for bar; the ticker is not in the question or choices. **All 174 pass.** I also re-ran the real detector code on each fixture's bars: **it agrees with the label in all 174**, and every positive triggers on the last bar.
- **Each positive against the firm's own setup card** (`app/src/pages/modelbook/setupCatalog.js`, aligned "with the firm's playbook docs" on 2026-06-10). The course outline says the same things, but it came in the same AI-session commit (2ba1d76435) as the presenter brief, so I cite the card. Checks were computed from the embedded bars: close against the prior high, open against the prior low, close direction and position, MA stacking, trend.
- **Vocab:** each term against `chart_words.json` (definition, note, house formula, source quote), against `research/definitions.json` where it has an entry, against the finder rule in `find_term_examples.py`, and against the screener's real formulas (`api/services/screener/candles.py`). **The vocab bars are not embedded.** They are a spec resolved on the pod from bars.db, so I could not see any vocab chart. Distractor checks use the repo's own evidence instead: the finder picked the same stock and day for another word, or the same stock has a nearby example of a related word.
- **Walk:** every step is a verbatim fragment of the brief (after dedash and markdown strip). The longest step is 19 words. Content was checked against the owner's rulings in `docs/study/corrections/*.jsonl`, `docs/study/sizing_rule.md` and the live product.

## Items per setup (spot and family), before → after the cap

Cap: at most 3 positives that the firm's card also calls the setup · 1 per near-miss reason · 1 "quiet session" per setup, on a chart no other kept item uses.

| Setup | Spot before → after | Why cut | Family before → after |
|---|---|---|---|
| Capitulation | 14 → 6 | 7 duplicate, 1 contradictory (NFLX) | n/a (no family) |
| Gap Support | 18 → 7 | 7 duplicate, 4 not the first test | 6 → 1 |
| Go Signal | 16 → 0 | 16: not the firm's Go Signal | 6 → 0 |
| High Volume Edge | 14 → 4 | 5 duplicate, 5 down close or closed at the low | 6 → 1 |
| Kicker Candle | 20 → 9 | 8 duplicate, 3 close under the prior high | 6 → 1 |
| Launchpad | 16 → 0 | 6 positives not stacked, 10 negatives with nothing to contrast | 6 → 0 |
| Oops Reversal | 18 → 8 | 6 duplicate, 4 conflict with the card | 6 → 1 |
| Slingshot | 16 → 5 | 6 duplicate, 5 bear-market bounces | 6 → 1 |

## Items per chart word (vocab), before → after the cap

Cap: 3 per word, 2 per face for the two-sided words. One chart teaches one word.

| Word (finder concept) | Before → after |
|---|---|
| Trending | 6 → 3 |
| In a downtrend | 6 → 3 |
| Coiled | 6 → 2 |
| Higher lows | 6 → 3 |
| Inside day | 6 → 3 |
| Gapping (up / down) | 12 → 4 (2 + 2) |
| Heavy volume | 6 → 3 |
| Near its highs (near / new highs) | 12 → 4 (2 + 2) |
| At the 20 EMA | 6 → 2 |
| Pullback (shallow / deep) | 12 → 2 (2 + 0) |

## Main patterns (most important first)

**1. The labels are right by the detector, but for six setups the detector is not the firm's setup.** The firm's own card says "no" to many detector "yes" charts. That gives a yes/no item two defensible answers.
- **Go Signal (22 items, all cut):** the detector reads a daily *footprint* of an intraday entry: weak open, sweep of support, strong close. Its own docstring says "the real trigger is on the 30/65-minute chart, which the daily bar cannot see". The card is a different setup: "a catalyst gap digests into the 9 EMA, then one wide candle engulfs the pullback and closes above the catalyst high".
- **Launchpad (22, all cut):** **0 of 6** positives have the 9 > 20 > 50 > 200 stack the card ("on top of a stacked cluster") and the course ("without stacked, rising MAs is explicitly NOT a Launchpad") require. 5 of 6 close under the 200-day. The detector only tests that the EMA8, EMA21 and SMA50 converge.
- **Kicker:** 3 of 6 positives close under the prior high (two are red days). The card and the course title say "the trap that closes above yesterday's high".
- **Oops:** 3 of 6 positives never open below the prior low (the card: "a gap below the prior day's low"). The negative `neg_closed_back_under_AAPL_20220713` gapped under the low and closed back above it, a textbook Oops by the card.
- **HVE:** 4 of 6 positives are down closes; the detector calls the level "resistance". One more (AMZN 2025-10-31) closed at the very low of its range. The card is a LONG setup "closing strong".
- **Slingshot:** 5 of 6 positives are 2022 bear-market bounces, with a falling 50-day and down 11-26% over the chart. The card says "A strong uptrend pulls back".
- **Gap Support:** the detector's own `first_test` flag is false on 4 of 6 positives. The card says "the FIRST controlled pullback".

→ Owner ruling needed, setup by setup: is the firm's definition the card or the detector? Rebuild Go Signal and Launchpad chart items only after that ruling.

**2. Four of these detectors are INTERNAL:** launch pad, gap support, capitulation and go signal (`registry.INTERNAL_PATTERN_IDS`: "internal until the owner rules them public"). Study would show members setups the owner has not released. Kept Gap Support and Capitulation items say so in their reason. Also, "Capitulation" is not a setup in the firm's setup catalog. The firm uses the word for a Bottoms signpost (market-wide climactic selling), yet the question says "the firm's Capitulation setup".

**3. Every spot lesson is a one-line template, for example:** "Capitulation: the firm's detector does not fire on the last bar of this chart. a wide flush under the band on heavy volume, but out of nowhere (no prior cascade)". That breaks the standing rule that every lesson is a full explanation. The 39 kept spot items each carry a full proposed lesson: the verdict, the firm's rule, why this chart passes or fails, and the entry and stop or what to wait for. Every number in them is already in the item's facts. Long term, `gen_fixtures.py` should build these from a per-detector rule text carried in `reveal_json` (for example a `rule` key) so the importer can ground the thresholds.

**4. Heavy duplication in the fixture set.**
- Each setup has four "ordinary session" negatives on one date. The same 2022-10-11 charts are reused by five setups, and 2023-03-02 and 2023-07-21 are shared too.
- Every near-miss reason has an AAPL/MSFT pair with an identical note.
- Some charts sit one session apart with opposite answers: Gap Support AMZN 11-17 (no) and 11-18 (yes); Capitulation NFLX 04-19 (no) and 04-22 (yes). The NFLX yes only fires by borrowing a cascade that the NFLX no says is missing, so the pair contradicts itself.

**5. Family items never name the setup.** "Which family does this setup belong to?" makes the member guess the setup first. A gap-support or slingshot chart also reads as Momentum & Trend, and a kicker reads as a reversal. The answer is also identical six times per setup. Proposed fix: name the setup in `q`, keep one item per setup, and use the proposed lesson in the reason field (each current lesson is one line). The 5 kept family charts are also kept spot charts, because they are the only card-clean positives.

**6. Vocab is ambiguous by construction.** `find_term_examples.py` takes the first six mega-caps in its candidate list, newest bar first. It never checks whether the other 12 words are also true on the chosen bar.
- 16 items have a distractor that the firm's own finder picked as true on that exact bar. MSFT 2026-10-19 is the chart for 7 items with 7 different right answers.
- The 6 "shallow pullback" charts are exactly the 6 "near its highs" charts.
- "Deep pullback" (20% or more off the 60-bar high) has no uptrend test, while the definition says "in an uptrend". All 6 are cut: most sit within weeks of the same stock's downtrend or gap-down example.
- The kept items' choice fixes swap likely-true distractors for words the key's own formula rules out. That makes some items easy. It is a stopgap until the finder is fixed.

**7. Four chart-word definitions are inaccurate.** Each is fixed once in `chart_words.json`, and the item-level lesson fixes carry the corrected text.
- **Coiled:** says "the spread of its last ten closes is under 2.5% of price"; the screener tests the coefficient of variation (standard deviation over the mean). It fired on 5 of 6 mega-caps on the same day, so the owner should confirm the charts look coiled.
- **Higher lows:** the screener's `higher_lows_run` counts consecutive *daily* higher lows; the finder used rising *swing* lows.
- **Gapping:** "leaving empty space on the chart" is not guaranteed by an open 3% or more from the prior close. "Power Earnings Gap" is earnings-only.
- **Near its highs:** "everyone who owns it is in profit" is false up to 5% under the high.

**8. Walk-throughs: 9 of 25 survive.** All steps are verbatim and short.
- 10 cut as model jargon: presenter instructions ("repeat correctly on camera", "Say it that way every time"), course mechanics (sizing gate, specialization contract, playbook defense, field week, seven-field journal), and invented names (THE LOOP, permission band, five-field card).
- 3 cut because they contradict the owner: the drawdown protocol (his ladder is −6% → 10% max, −8% → 8%, −10% → 5%, per `sizing_rule.md` §4), heat stated as a hard cap (his 2026-10-19 ruling: a tool flag, "you decide"), and an extra Overweight rung on the size ladder.
- 4 cut as duplicates.
- Kept: the Exposure Rating (minus the band step), the scanner, the setup catalog, sizing (the worked example and the app's cap table), management, and the four entry types (the Morning Wire's own). "A list / B list" is kept with a caution: no owner prose in the repo confirms it.

## Source-level fixes recommended (one change fixes many items)

1. `scripts/study/gen_fixtures.py`: a full per-detector lesson (the 39 proposed lessons are the pattern); carry the rule text in `reveal_json`; name the setup in the family question; one family item per setup; one quiet session per setup, on charts no other setup uses.
2. `scripts/study/find_term_examples.py`: evaluate all 13 rules on each chosen bar; use only words whose rule is false there as distractors; prefer bars where the target is the only true word; add the uptrend gate to the deep face; spread picks past the first six names; align "higher lows" with the screener or the definition.
3. `docs/study/terms/chart_words.json`: the four definition corrections (exact before and after text is in the vocab reasons).
4. `scripts/study/gen_walkthroughs.py`: `lesson_text` is the last step, often a fragment ("Is capped at 10% ...", "That every trade and every lesson maps onto."). Drop presenter-instruction sentences at the source.

## Not verified (honest limits)

- **The visual.** No chart was seen. The owner must still see every surviving chart item in the firm's own chart look.
- **Vocab bars.** They are on the pod, so remaining distractors are unverified. A pod-side run of the 13 finder rules on the 29 kept bars would settle it.
- **The Exposure Rating's inputs** (breadth, distribution days, MA structure). They are computed in the morning-wire engine, which is not in this checkout.
- **Owner judgement calls on the kept charts:** whether NVDA 2023-05-25 "closes strong" (it closed mid-range after a 26% gap), whether AMZN 2022-08-10 is a "strong uptrend", and whether the coiled charts look coiled.

## Files

- `auditC_verdicts.jsonl`: the 277 verdicts.
- `auditC_build.py`: the build script (all decisions and proposed text).
- `auditC_verify_fx.py`, `auditC_fx_verify.json`: the fixture and detector re-run results.
- `auditC_pos_detail.py`, `auditC_cards.py`, `auditC_lp.py`, `auditC_negs.py`, `auditC_gs.py`: the card checks.
- `auditC_vocab.py`, `auditC_vocab_items.json`, `auditC_vocab_debug.json`: the vocab analysis.
- `auditC_walk.py`: the verbatim-step check.
