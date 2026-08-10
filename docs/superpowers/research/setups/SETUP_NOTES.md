# Setup catalog — research notes (Phase G, pass 1)

**Date:** 2026-08-09 · **Branch:** `feat/phase-c-alerts` · **Scope:** RESEARCH + CATALOG ONLY.
Nothing in this directory is wired to anything. No product file was touched.

Read this file first; it is the guide to the two data files beside it.

- `setup_sources.json` — the source registry. Every source gets an id, a kind, and
  something that **resolves**: a URL, a book + chapter/page, a firm store + selector,
  or a firm code location.
- `setup_criteria.json` — the criteria. Every criterion names its setup, its
  measurable condition, its exact number, the source ids that publish that number,
  a short verbatim quote, an expressibility tag, and a confidence note.

---

## 0. The rule this catalog was built under

> **Every numeric literal in a concept must be published by one of its own citations.**

The owner's decision **extends the sources, not the discipline**. An external citation
is legitimate grounding *if it resolves*. What stays forbidden is an invented number.

Two consequences that shaped every entry below:

1. ⛔ **Where sources disagree, all of them are recorded with their own numbers and
   nothing is averaged.** An average is a number nobody published, which is exactly
   the thing the rule exists to prevent. Disagreements live in each criterion's
   `disagreement` array and are indexed in §6.
2. ⛔ **A criterion with no published number is named, not approximated.** Those are
   in §7 with what would have to be published to close them.

---

## 1. What the artifacts actually say — derived at runtime, not retyped

Measured on 2026-08-09 by parsing the files themselves:

| Artifact | Measurement |
|---|---|
| `app/src/constants/setupGroups.js` → `SETUP_GROUPS` | **32** setups — 26 Swing + 6 Intraday |
| `app/src/pages/modelbook/setupCatalog.js` → `SETUP_CATALOG` | **26** setups across 5 families |
| Names appearing **verbatim in both** | **15** |
| `app/src/pages/modelbook/setupPlaybooks.js` → `SETUP_PLAYBOOKS` | **9** authored playbooks |
| `engine/ast/starterScans.json` → `starters` | **1** grounded (`Classic Flag/Pullback`) |
| `engine/ast/starterScans.json` → `_ungrounded` | **31** refusing, each with a named reason |
| `engine/ast/conceptVocabulary.json` → `concepts` | **21** concepts |

⚠️ **The brief said "28 of 32 starters refuse" and "19 of 26 setups cannot be named".**
The artifacts on this branch say **31 of 32 refuse** and **1 is grounded**. I did not
restate the brief's numbers anywhere in the catalog — the files are the authority and
they are what a later pass will diff against. Flagging the gap rather than silently
adopting either number.

**The 11 catalog-only names** (in `setupCatalog.js`, absent from the taxonomy):
Bull Flag · Cup & Handle · 20 EMA Pullback · EMA Crossback · News/Earnings Gapper ·
High Volume Edge · Gap Support · U&R (Undercut & Rally) · Failed H&S / Rounded Top ·
ORB (Opening Range Break) · 30-Minute Pivot.

**The 17 taxonomy-only names** (in `setupGroups.js`, absent from the catalog):
High Tight Flag (Powerplay) · Classic Flag/Pullback · VCP · News Gappers ·
4B Setup (Stan Weinstein) · Failed H&S/Rounded Top · Classic U&R · HVC · Wick Play ·
News Failure · Red to Green · Opening Range Breakout · Opening Range Breakdown ·
Red to Green (Intraday) · Green to Red · 30min Pivot · Mean Reversion L/S.

⭐ Four of those pairs are the **same setup spelled differently** and will read as two
setups to any later wiring pass unless normalised:
`Classic U&R` ↔ `U&R (Undercut & Rally)` · `Failed H&S/Rounded Top` ↔ `Failed H&S / Rounded Top`
(differs only by spaces around the slash) · `30min Pivot` ↔ `30-Minute Pivot` ·
`Opening Range Breakout`/`Breakdown` ↔ `ORB (Opening Range Break)` (one catalog entry
covers both taxonomy directions). The catalog keys on the **taxonomy** name, per
`starterScans.json::_taxonomy`, and records the catalog spelling as an alias.

---

## 2. 🔴 The firm's own Model Book — what is actually there

This was to be the highest-weight source, so the state of it matters more than the
convenience of a positive finding.

**`/data/modelbook.db` (the dashboard-owned store named in the brief) holds no labelled
setups on this box.** Measured read-only:

| Table | Rows |
|---|---|
| `modelbook_stocks` | **20** (2024 ×10, 2025 ×10) |
| `modelbook_setups` | **0** |
| `modelbook_setup_examples` | **0** |
| `modelbook_catalysts` | **0** |
| `modelbook_year_recaps` | 36 |

The same is true of the worktree copy at `data/modelbook.db`. The production rows are
behind auth — `GET https://uctintelligence.com/api/modelbook/years` returns
`401 {"detail":"Not authenticated"}`, and signing in was out of bounds, so the
production Model Book is **unread this pass**. ⭐ That is the single biggest gap in
this catalog and the cheapest one to close: an authenticated export of
`modelbook_setups` + `modelbook_setup_examples` would add the firm's own entries and
stops on real charts, which outrank every external citation here.

### 2.1 What the firm HAS labelled, and where it really lives

The firm's labelled-setup evidence that *is* reachable is in the brain KB
(`C:\Users\Patrick\uct-intelligence\data\uct_intelligence.db`), and it is substantial:

| Store | Rows | What it is |
|---|---|---|
| `setup_templates` | **48** | the firm's setup definitions — entry triggers, stop methods, `max_stop_pct`, invalidation, RS/MA requirements |
| `setup_triggers` | **94** | **published triggers on real symbols with a real `entry_level` and `stop_level`**, plus outcome (`status`, `r_multiple`) |
| `model_examples` | **18** | charts the firm labelled with a setup type and a grade |
| `setup_performance` | **21** | measured win rate / expectancy per setup per regime |
| `knowledge_base` | 8,835 | attributed rules; 1,499 tagged `SETUP`, 2,302 `RULE`, 326 `SCREENING` |

⚠️ **`model_examples` is described in `CLAUDE.md` as "the uct_intelligence
`model_examples` table, which is unreachable on Railway"** — i.e. the dashboard's
Model Book was built to *replace* it. So there are two Model Books, the newer one is
empty locally and gated in production, and the older one is the one with the data.
That is a decision for the owner, not something this pass should resolve.

### 2.2 The firm's real entries and stops, turned into measurable criteria

`setup_triggers` is the strongest evidence in this exercise: 94 rows the firm
published pre-market with a level and a stop, on named symbols, with the outcome
recorded. Aggregated read-only (risk% = `(entry − stop) / entry × 100`):

| Setup (brain name) | n | risk% min | median | max | entry kind | stop kind | outcomes |
|---|---|---|---|---|---|---|---|
| Tight Flag | 26 | 2.56 | 4.52 | 5.01 | `prev_day_high` | `prev_day_low` | 5W / 9L / 11 open / 1 never |
| EMA Crossback | 15 | 0.07 | 4.01 | 5.00 | `ema_reclaim_21` | `ema_21_buffer` | 1W / 6L / 6 open / 2 never |
| EP | 15 | 2.50 | 5.00 | 5.02 | `prev_day_high` | `prev_day_low` \| `ema_21_buffer` | 3W / 6L / 4 open / 2 never |
| Stage 2 Momentum | 11 | 2.31 | 3.53 | 4.97 | `prev_day_high` | `ema_21_buffer` | 3W / 5L / 3 open |
| 20EMA Hold | 9 | 1.42 | 1.90 | 4.87 | `ema_reclaim_21` | `ema_21_buffer` | 3L / 2 open / 4 never |
| Mean Reversion | 4 | 0.00 | 4.70 | 5.00 | `ema_reclaim_21` | `ema_21_buffer` | 1W / 1L / 2 open |
| Flat Base | 3 | 2.78 | 3.71 | 4.95 | `base_high` | `ema_21_buffer` | 1 open / 2 never |
| HTF | 3 | 1.00 | 3.11 | 3.80 | `prev_day_high` | `prev_day_low` | 2L / 1 open |
| Stage 2 Breakout | 3 | 4.52 | 4.95 | 4.99 | `base_high` | `ema_21_buffer` | 2 open / 1 never |
| U&R | 2 | 3.00 | 3.00 | 3.00 | `undercut_reclaim` | `shelf_buffer` | 1W / 1 open |
| Red to Green | 1 | 3.00 | — | 3.00 | `prev_day_close_reclaim` | `prev_day_low` | 1W |
| VCP | 1 | 4.38 | — | 4.38 | `base_high` | `ema_21_buffer` | 1L |
| EMA Crossover | 1 | 4.71 | — | 4.71 | `ema_reclaim_21` | `ema_21_buffer` | 1 open |

⭐ **Read the entry/stop KINDS, not the risk numbers.** The kinds are the firm's own
*definition* of where a setup is entered, resolved by AST-able code
(`uct_intelligence/levels.py::SETUP_LEVEL_RULES`), and they are stable. The observed
risk percentages are a *distribution of outcomes of that rule against the tape* — they
are evidence about what the rule produced, not a threshold anybody published, and the
catalog records them as `observed`, never as a criterion. ⛔ The max clusters at ~5.0%
because the publisher gates on it, not because 5% is a rule.

⚠️ **`setup_performance` is a CLAIM, not a criterion.** It is subject to spec §1.6 and
to `conceptVocabulary.json::_no_numbers` (design §8.3 — what a published record may
SAY — is OPEN). It is recorded in `setup_criteria.json` under `firm_measured` with
`is_screening_criterion: false`, and **no percentage from it may reach a surface**.

### 2.3 Only three labelled charts carry a real entry and stop

Of the 18 `model_examples`, three have prices:

- **OSCR · U&R · 2026-07-28 · grade A** — entry 28.00, stop 27.65 (**1.25% risk**),
  outcome +12.14%, held 0 days, regime `normal`. Owner-flagged as a teaching example.
  Its note is the most precise thing in the whole corpus: *"reclaim of prev day low
  28.00 after a 27.65 undercut (09:55 flush, 10:25 reclaim, 1.25% risk, 9.7R to the
  close), then through prev day high 29.29 at 11:10 (4.4% risk, 1.6R) … The undercut
  cleared an 8-session 28.00 shelf, not just one day's low."*
  ⭐ **That sentence publishes the firm's own definition of a U&R shelf: 8 sessions.**
  It is the only place I found a firm number for "which prior low is prominent", and
  `starterScans.json` currently refuses `Classic U&R` for exactly that missing number.
- **NVDA · VCP · 2026-03-15 · grade A+** — entry 142.50, stop 135.00 (5.26% risk),
  target 170.00, +19.3% in 14 days, regime `Uptrend`. Note: *"Textbook VCP with 3 tight
  contractions."* ⭐ The count **3** is the firm's own, and it matches
  `screener/patterns.py::detect_patterns`, which emits `vcp` off exactly three
  ~10-bar swing ranges.
- The other 15 carry a grade and a prose read but no prices.

---

## 3. Firm code as a citation kind

Four firm code locations publish thresholds that resolve by AST and are already the
grounding kinds `conceptVocabulary.json` accepts (`filter_preset`, `starter_screen`,
`classifier`). They are the reason a criterion can be tagged `expressible` today.

**`api/services/screener/filters.py::FILTERS`** — the firm's own labelled thresholds:
`rs_rank` Over 70/80/90 · `uct_composite` Over 80/90 · `rsi14` <30 / 40–60 / >70 ·
`vol_ratio` Over 1.5× / Over 2× · `adr_pct` Over 4% / Over 8% · `gap_pct` Up >3% /
Down >3% · `dist_52w_high_pct` Within 5% · `pct_vs_ema20` Within 2% ·
`close_position` Top third (>0.66) / Bottom third (<0.33) · `inside_bar_run` 2+ ·
`higher_lows_run` 3+ · `pullback_depth_pct` Shallow (<10%) / Deep (>20%) ·
`consecutive_up` 3+ · market-cap tiers (200B/10B/2B/300M) · price Over $10/$50, Under $20 ·
`avg_volume_30d` Over 1M / Over 5M · `beta` < 1.

**`api/services/screener/candles.py`** — classifier constants:
`wide_bar` = range > **1.5 × ATR14** · `narrow_bar` = range < **0.5 × ATR14** ·
`tight_consolidation` = CV of the last **10** closes < **2.5%** ·
`nr7` = narrowest of the last **7** · `pullback_depth_pct` measured from the
**20**-bar high · hammer = lower wick > **0.5**, body < **0.35**, upper wick < **0.15**
(shooting star mirrored) · doji body < **0.1** · marubozu body > **0.85**.
⭐ Those wick ratios are the firm's own published answer to "what is a wick play",
and `starterScans.json` refuses `Wick Play` today only because no *preset* exists on
`upper_wick_pct`/`lower_wick_pct` — the classifier numbers are right there.

**`api/services/screener/patterns.py::detect_patterns`** — flat base = last **20**
closes inside an **8%** band with price ≥ **95%** of the band high; VCP = three
consecutive ~**10**-bar swing ranges each smaller than the last; bull flag = a
**>20%** run over bars −25→−10 then a pullback of **0 < x < 10%**; 52-week window
= **252** bars. ⛔ All of these land in `screener_rows.patterns`, a TEXT column
`closedTable.json` excludes — which is why they cannot be screened on today.

**`C:\Users\Patrick\uct-intelligence\scripts\scanner_candidates.py`** — the firm's
production scanner gates: `LOW_ADR` at `adr_pct < 4.0` · `EXTENDED` at
`ema_distance_pct > 8.0` · `NO_MOMENTUM` at `pole_pct < 20.0` · WATCH needs
`avg_body_pct <= 0.45` ("no wide swings") and `pole_pct >= 15.0` · the 7-criterion
candle score with its EMA-proximity bands **0.5 / 2 / 4 / 6%**, tightness bands
**<0.30 / <0.40**, close-CV bands **<2.5% / <4%**, and pole bands **≥40 / ≥20 / ≥10%**.

**`C:\Users\Patrick\uct-intelligence\uct_intelligence\levels.py`** — `SETUP_LEVEL_RULES`
maps each template to `(entry_kind, stop_kind)`; `STOP_ATR_COEFF = 0.25`,
`BASE_LOOKBACK = 20`. `trigger_quality.py::THRESHOLDS` publishes
`default_max_stop_pct = 8.0`, `proximity_atr_mult = 1.5`,
`confluence_full_touches = 4`.

---

## 4. Expressibility — the build queue

Every criterion carries one of four tags, measured against `closedTable.json` as it stands on
this branch: 5 series, 15 operators, ~29 functions, 54 scalars, a bounded backward offset
`expr[n]` (`n ≥ 1`, literal, unchained, no forward form), and 65 screener columns of which 11
are excluded (8 because they are TEXT).

⚠️ **THE TABLE MOVED UNDER THIS CATALOG WHILE IT WAS BEING WRITTEN.** A concurrent Phase-G
agent edited `closedTable.json` mid-pass and the function count went 28 → 29 (`accum` was
declared). ⭐ **That cost nothing, and the reason is the point:** the gate in §10 re-derives the
declared names *from the table* on every run rather than checking against a roster typed here.
The tilde above is deliberate — **count it, do not quote it.** A hand-typed number in this
sentence would already have been wrong within the hour.

| Tag | Meaning |
|---|---|
| `expressible` | writable **today** with a declared scalar/function and a number one of its own citations publishes |
| `needs-preset` | the column exists and the number is published *externally*, but no firm `filter_preset` carries it — a one-line preset unblocks it |
| `needs-column` | the measurement is not a declared scalar (or is TEXT); needs a new nightly column |
| `needs-engine` | the grammar cannot state it at all |

⚠️ **Two shapes are flagged, never approximated** — per the brief and per
`starterScans.json`'s own refusals:

- **Multi-bar SEQUENCE.** "Three successively shallower pullbacks" is the reason VCP
  was retired. The bounded offset makes `close[1]` sayable, but a *sequence of swing
  ranges* is not a fixed-offset expression. Everything of this shape is tagged
  `needs-column` (a per-pattern 0/1 column), never `needs-engine`, because the firm
  already **detects** it in `patterns.py` — the blocker is that the answer lands in a
  TEXT column.
- **Pattern-shape geometry.** Trendline breaks, wedge convergence, cup depth, H&S
  necklines. Nothing in the table names a trendline or a slope. Tagged `needs-engine`.

### 4.1 🔴 The bounded offset is newer than most of `starterScans.json`'s refusals

`_no_offset` was rewritten on 2026-08-09 (`291c9d8a`) to admit `expr[n]`, but **five
ungrounded reasons still say the closed table has no bar-offset node** — `Kicker
Candle`, `Oops Reversal`, `Remount`, `HVC`, `Classic U&R`. Those reasons are **stale**,
and the consequence is bigger than a wording fix:

| Was refused as | Now sayable as | What still blocks it |
|---|---|---|
| `Remount` — "saying where it was yesterday needs a bar offset" | `close[1] < sma(close,50)[1] && close > sma(close,50)` | **nothing** — no threshold needed |
| `Kicker Candle` — "'yesterday's high' cannot be named" | `open > close[1] && close > high[1]` | only "closes weak" if you want that half |
| `Oops Reversal` — "'below the prior day's LOW' … cannot be named" | `open < low[1] && close > low[1]` | nothing; the gap-down size is optional |
| `Red to Green` — "the sweep evaluates the LAST CONFIRMED bar" | `open < close[1] && close > close[1]` | the **cadence** objection stands; the vocabulary one does not |
| `Classic U&R` — "the reclaim is a two-bar relationship" | `low < lowest(low,8)[1] && close > lowest(low,8)[1]` | which N — and **the firm published 8** (§2.3, OSCR) |

⚠️ **Do NOT write these against the boolean scalars.** `above_50sma[1]` parses, but a
scalar is *one number per symbol* held identical at every bar (`closedTable.json::_scalars`),
so offsetting it is a no-op and `above_50sma[1] == above_50sma` always. The offset is
only meaningful over the five bar-field series and expressions built from them — which
is why the rewrites above use `sma(close,50)`, not `above_50sma`.

🔴 **One question this raises belongs to the owner, and the catalog does not answer it:
is the bar count inside `expr[n]` a "numeric literal" that needs its own citation?**
`close > close[1]` contains no threshold at all — it is a pure structural statement —
but it does contain the token `1`. If offsets count, `Red to Green` needs somebody to
publish "one bar". If they do not, four setups above become expressible with **zero**
new presets. Every affected criterion in `setup_criteria.json` carries
`stale_refusal: true` and `offset_literal_question: true` so the decision is visible
rather than assumed. **This is the highest-leverage finding in the pass.**

### 4.2 Every `expressible` formula in this catalog was PARSED, not read

The repo's own rule — *"An example formula is a CLAIM about the table and must be
PARSED, not read; three spec examples in this phase did not parse."* — applies to a
catalog as much as to a spec. So the candidate formulas were run through the **shipped**
parser before being recorded:

```
cd app && npx vitest run --root ../.superpowers/sdd/phase-g --environment node
→ Test Files 1 passed · Tests 24 passed
```

Probe: `.superpowers/sdd/phase-g/_parse_probe.test.js` (throwaway; delete with this
directory). **18 formulas parse**, including every rewrite in §4.1.

⭐ **The control is what makes the probe worth anything, and it caught two things:**

1. **`parseFormula` RETURNS `{ok:false, guard}` — it does not throw.** The first
   version of the probe asserted `toThrow()` and therefore reported *"refuses"* for
   inputs the parser happily accepted. Asserting the **guard name** fixed it:
   `close[1][2]` → `canonicalise:offset-chained` · `close[-1]` →
   `canonicalise:offset-forward` · `close[n]` → `canonicalise:offset-literal` ·
   `sector == "Technology"` → `canonicalise:node`.
2. 🔴 **`adx(high, low, close, 14) > 25` and `obv(close, volume) > 0` both PARSE.**
   The parser is grammar-only; the closed table's *name* check belongs to the linter.
   So **"it parses" is not evidence that a name is declared**, and this catalog's
   `expressible` tag is decided against `closedTable.json`'s declarations, never
   against the probe. Worth knowing before anyone builds a "does this scan work?"
   check on `parseFormula` alone — it would green-light `adx` and `obv`, both of which
   `_functions_excluded` refuses by name and for stated reasons.

---

## 5. Coverage against the 32 — measured, not asserted

Counted out of `setup_criteria.json` at compile time. **279 criteria** across the 32 setups
plus the universal filters; **110 are `expressible` today**, and every one of those was parsed
*and* had each of its names checked against `closedTable.json`'s declarations.

| Tag | Count | What it means |
|---|---:|---|
| `expressible` | **110** | writable today, with a number one of its own citations publishes |
| `needs-preset` | **34** | column exists, number published externally, no firm preset carries it |
| `needs-engine` | **57** | grammar cannot state it — geometry, or a multi-bar sequence |
| `needs-column` | **31** | needs a new nightly column (or the answer lands in a TEXT column) |
| `needs-cadence` | **26** | correct vocabulary, wrong clock — intraday against a daily sweep |

**19 of the 32 setups now carry three or more expressible criteria.**
**Seven carry none:** Parabolic Long · Failed H&S/Rounded Top · News Failure ·
Opening Range Breakdown · Red to Green (Intraday) · Green to Red · 30min Pivot.

⭐ **Best covered:** Mean Reversion L/S (9 expressible of 12) · Classic U&R (8 of 12) ·
Launchpad (7 of 9) · Parabolic Short (7 of 13) · 4B (7 of 13) · Oops Reversal (7 of 10) ·
2B Reversal (6 of 7) · Kicker Candle (6 of 9).
⭐ **Best sourced is not one of the famous names.** **Pradeep Bonde publishes literal scan
syntax**, which makes the Episodic-Pivot / momentum-burst family the strongest external
evidence in the whole exercise.

---

## 6. Where sources disagree — the index

**31 criteria carry a `disagreement` block holding 62 additional published numbers.** Nothing
was averaged. The ones a build decision turns on:

1. 🔴 **`4B` means "much too soon to consider buying."** Weinstein's own sub-stage table makes
   the bottoming buy `4B-` (4B-minus). The firm ships a long setup under the label that means
   the opposite — and **neither label is in the 1988 book**; the sub-stages are from his
   Global Trend Alert newsletter.
2. 🔴 **The high tight flag's most-quoted statistic is retracted.** "69% average rise, 0%
   failure" is superseded by its own author's 39% / 15% / rank 30 of 39 — and both pages are
   live on thepatternsite.com today.
3. 🔴 **Minervini's 30% vs 25% above the 52-week low is a conflict between his own two books.**
   The firm's KB has already picked 25%; screeners overwhelmingly encode 30%.
4. 🔴 **Weinstein's Stage-2 breakout volume has ten published numbers and none is the book's.**
   A targeted text search found no multiple in the book at all.
5. 🔴 **Breakout volume is a SIGN conflict, not a magnitude one.** IBD requires +40–50%;
   Bulkowski measured the opposite over n>8,000 — high-volume breakouts fail *more* (14% vs 5%).
6. 🔴 **Wick ratios use three incompatible measurement bases** — ratio-to-body, fraction-of-range,
   comparison-to-a-rolling-average. They cannot be reconciled. Any wick criterion needs a
   `basis` field or every hammer scan silently disagrees with every other one.
7. 🔴 **The Oops win rate is an artifact of the exit.** 98.6% with the bailout (win/loss ratio
   **0.05**, average loser held 59 days) vs 50.5% without it (ratio 1.36) — same entry.
8. **Launchpad's moving averages differ three ways** — the firm's own playbook (8/21/30/50),
   Deepvue (21/50/65), the TC2000 scan (8/20/50). The MA set is upstream of the band.
9. **EP's gap threshold is a FAMILY, not a value.** Bonde deliberately runs four parallel scans
   (≥8/10/20/30%); Qullamaggie publishes ≥10%; Morales' BGU 5%.
10. **Flat base is two different patterns** — IBD (≥5 weeks, ≤15%) vs Bulkowski (≥65 *days*, no
    depth cap, longer is better). His statistics do not apply to IBD's pattern.

---

## 7. What could not be pinned down

**15 criteria carry `value: null`** with a named reason. The ones that matter:

- 🔴 **A listing-date / days-since-IPO column.** Every other IPO Base criterion is measurable;
  without this one nothing can tell a first base from a fourth. A single-column blocker.
- 🔴 **Minervini's Power Earnings Gap has no published numeric definition anywhere**, and the
  attribution is contested (@traderstewie vs Minervini). A finding, not a search failure.
- 🔴 **Kell publishes no numbers.** Two Kell-bylined articles read in full contain the MA periods
  and nothing else — Wedge Pop, Wedge Drop, EMA Crossback, Base n' Break, Reversal Extension and
  Exhaustion Extension are qualitative at source.
- 🔴 **Slingshot is the least-sourced of the 32.** Three firm KB rows name it; none defines it; no
  external source exists. The firm's own two artifacts even disagree on the window (3 vs 4).
- 🔴 **Weinstein's 4B- qualifying criteria** exist only inside two YouTube videos whose caption
  tracks return zero-length.
- **Green to Red has zero sources** — no firm artifact and no external one.
- **A news / catalyst / earnings-surprise column.** Blocks Episodic Pivot, News Gappers, News
  Failure, Go Signal and PEG — five setups, one column family.
- **Crabel's own statistics.** The book is out of print; every Crabel *performance* number in
  circulation is a third-party backtest.
- **The IBD/O'Neil lane is thin because investors.com and investopedia.com are host-blocked.**
  MarketSmith Hong Kong turned out to be the reliable open IBD-family primary and carried most of
  it, but the cup's `+$0.10` pivot never surfaced from a primary source for the cup itself.

---

## 8. Ranked: what a member most wants that we cannot yet express

Ranked by **setups unblocked × cheapness of the change.**

| # | What is missing | Unblocks | Change required |
|---|---|---:|---|
| 1 | **A ruling on whether the bar count in `expr[n]` needs its own citation** | 6+ | ⭐ **Zero code — an owner decision.** If offsets are structural, Red to Green, Oops Reversal, Kicker Candle, Remount and Wedge Pop's trigger become expressible with **no new presets at all**. |
| 2 | **Presets on columns that already exist** — `chg_pct_1m` (30/50) · `gap_pct` (±0.7, 10) · `close_position` (0.75) · `dist_52w_high_pct` (20) · the two wick columns · `body_pct` (0.45) · `chg_pct_1d` (4/10/20) | ~10 | ⭐ **One line each in `filters.py`.** 34 criteria wait on nothing else. The highest work-to-value ratio in the catalog. |
| 3 | **Per-pattern 0/1 columns for what the firm ALREADY detects nightly** — `vcp`, `flat_base`, `bull_flag`, `breakout_52w`, `golden_cross` | 3+ | The detection exists in `patterns.py` and lands in a TEXT column `closedTable.json` excludes. **A column problem, not a formula problem.** |
| 4 | **A news / earnings-date / EPS-surprise column** | 5 | The largest *data* gap. Amphibian Trading's published PEG screen (surprise ≥ 20%) shows what it would buy. |
| 5 | **A listing-date column** | 1 | Small — and it is the whole of IPO Base. |
| 6 | **An intraday cadence for the sweep** | 6 | All six Intraday setups. ⚠️ And the evidence says build the **5-minute** opening range, not the 30-minute one: 30-min was the worst of four tested (Sharpe 0.21 vs 2.81). |
| 7 | **A float column** | 2 | Bonde's EP thresholds (<25M ideal, <10M best) are unusable without it. |
| 8 | **Swing-point / trendline geometry** | 6 | ⛔ The real `needs-engine` wall: Wedge Pop/Drop, Failed H&S, cup depth, necklines, triangles. Lo–Mamaysky–Wang publishes the machine-implementable spec (shoulders within **1.5%**, rectangle tops within **0.75%**, a 38-day rolling window with a mandatory **d=3** detection lag) — that is what such a column would implement. |
| 9 | **A cross-symbol series** (RS against an index) | 2 | Mansfield RS and Connors' VIX filter both need it. |
| 10 | **String literals** | — | `sector == "Technology"` is the exclusion a member will feel; `closedTable.json` already says so. Out of scope here. |

---

## 9. What was swept, and what was not

**~275–450 distinct sources examined across six parallel sweeps**; ~100 registered in
`setup_sources.json`; the rest rejected with reasons recorded there.

⚠️ **The ~1,000-source target was not met, and the reason is mechanical.** The session's
**WebSearch budget (200/200)** and **subagent budget (200/200)** were both exhausted mid-run.
One sweep planned a six-way domain partition and had to collapse it into a single sequential
thread; others lost the ability to route around blocked hosts. Workarounds that did land:
raw-HTML pulls via PowerShell, `r.jina.ai` as a reader proxy, and `curl` plus a local PDF text
extractor — which is what unlocked the five academic papers.

**Deep:** Bulkowski · StockCharts ChartSchool · Qullamaggie · Stockbee · TraderLion ·
MarketSmith HK · the Zarattini/Concretum papers · Lo–Mamaysky–Wang · TA-Lib source · Connors.
**Thin or absent:** investors.com and Investopedia (both host-blocked outright), the textbook
layer (Edwards & Magee, Kirkpatrick & Dahlquist, the CMT curriculum), broker education
(Fidelity/Recognia, Schwab, IBKR), and the official screener vendors.

🔴 **One hazard that would silently corrupt a later pass — caught in the act.** A
fetch-and-summarise tool **fabricated a detailed component table** for a page that contains no
table (a 532-character stub wrapping a Google Sheets iframe), and mislabelled a metric's
polarity on a second page. Everything marked `resolved: reported` in `setup_sources.json` rode
that path and **should be re-pulled as raw HTML before it grounds a shipped starter**; the six
marked `resolved: verified` were fetched and read back by the compiler here. For a product whose
promise is *"a member can open the source and check"*, a summariser that invents a plausible
table is the exact failure that kills it.

---

## 10. The gate

```
cd app && npx vitest run --root ../.superpowers/sdd/phase-g --environment node
→ Test Files 2 passed · Tests 141 passed
```

Two throwaway probes sit beside the catalog (delete them with it):

- `_parse_probe.test.js` — the rewrites in §4.1, plus refusal controls that assert the **guard
  name** (`canonicalise:offset-chained`, `-forward`, `-literal`, `canonicalise:node`).
- `_catalog_formulas.test.js` — **every one of the 114 `formula` fields in
  `setup_criteria.json` is parsed by the shipped parser**, and every name used by an
  `expressible` one is checked against `closedTable.json`'s declarations. Two controls: one
  asserting the catalog is non-empty, one proving the declaration check can fail.

⭐ **The second control is the load-bearing one.** Without it the check passes for the wrong
reason, because `parseFormula` is grammar-only — which is exactly how a "does this scan work?"
check built on the parser alone would green-light `adx` and `obv`, both of which
`_functions_excluded` refuses by name.
