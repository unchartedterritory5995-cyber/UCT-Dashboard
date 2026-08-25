# 08 — Precedence & Ambiguity: which pattern wins when several describe the same bar

Researcher 08. Assignment: the ARCHITECTURE question for a single-label `CANDLE` screener column.
All findings below are from pages fetched during this session; URLs in §g.

---

## THE ROOT-CAUSE FINDING (read this first)

Every platform that resolves this cleanly does so because it separates **two orthogonal axes** that the
current if/elif chain has fused into one:

| Axis | What it is | Cardinality per bar | Source of truth |
|---|---|---|---|
| **SHAPE** (single-bar morphology) | doji / marubozu / spinning top / plain candle, + size class | **exactly one, always** — a total partition of the OHLC space | CandleScanner "basic candles": *"Every single candlestick on the chart is classified as one and only one particular basic candle."* |
| **RELATION** (multi-bar pattern) | engulfing, harami, star, three-methods… | **zero or many** — sparse, and genuinely co-occurring | TA-Lib (one independent output series per pattern), StockCharts (one boolean clause per pattern) |

The reported defects are all one bug: a *shape* test (`doji`, `marubozu`, `spinning-top`) is sitting in
the same `elif` chain as *relation* tests (`engulfing`). Shape is universal and relation is sparse, so
the shape branches short-circuit the relation branches almost every time. Consequences named in the
brief follow mechanically:

- doji-that-is-also-an-engulfing → doji wins, because `body<0.10` is checked before the 2-bar tests;
- body/range in 0.35–0.85 with no engulfing → falls off the end, because the chain has **no total
  shape classifier** — it only has the extreme shapes (`<0.10`, `>0.85`, `<0.30`) and leaves the
  entire mid-band uncovered;
- hammer can never also be a bullish engulfing → because a single chain can only ever return one thing.

Also note a second latent bug in the current chain: `body < 0.10` (doji) and `body < 0.3`
(spinning-top) **overlap** — every doji satisfies the spinning-top test. It happens to work only
because of the ordering. CandleScanner explicitly warns this pair is the most-confused distinction in
the whole taxonomy. Any reordering silently breaks it. Shape branches must be *mutually exclusive by
construction*, not by luck of ordering.

---

## (a) Platform-by-platform: how multi-match is actually handled

| Platform | Surface | Multi-match behaviour | Ordering / ranking | Evidence |
|---|---|---|---|---|
| **TradingView — Screener** *(closest analogue to the target column)* | one `Candlestick Pattern` column | **Shows ALL, in one cell.** *"When multiple patterns occur simultaneously, the Screener displays them from left to right in order of signal strength."* Renders as coloured candle miniatures; *"The column displays up to four miniatures, with a counter such as '+3' collapsing the rest."* Hover reveals the full list. | Published 3-tier: **Strong (12) / Medium (14) / Weak (18)** across 44 patterns. *"strong patterns like engulfing or three white soldiers appear first, while weaker single-candle signals like spinning tops come last."* | TV support 43000752737; TV blog 59644 |
| **TradingView — chart indicators** | one indicator per pattern under Technicals → Patterns | Each is a separate indicator; add several and several labels appear. Blue = bullish, red = bearish, grey = both. | none | TV support 43000584462 |
| **Thinkorswim / Schwab** | `CandlestickPatterns` study library, split into *Bearish and Bullish*, *Bearish Only*, *Bullish Only* | **One study per pattern**, each emitting its own plots (Engulfing emits a "Bearish" plot and a "Bullish" plot). Multiple studies ⇒ multiple independent marks. No arbitration layer exists. | none | toslc Engulfing + library index |
| **StockCharts** | Advanced Scan Workbench predefined clauses | **Independent booleans.** 24 candlestick clauses, all of form `[Bullish Engulfing is true]`, operators `is / is not / = / !=`. Each evaluated independently; a bar can satisfy many. No single-label surface at all. | none | help.stockcharts.com scan-syntax-predefined-patterns |
| **TrendSpider** | chart auto-labels + scanner, 100+ patterns (core, Rob Smith's The Strat, Bulkowski, Newsome) | **Shows all selected.** *"All candlestick patterns that you have selected will show up on the chart."* Multi-timeframe mode adds *more* labels (e.g. weekly hammer plotted on the daily). Documentation is silent on overlap/crowding. | none documented | help.trendspider.com; trendspider.com blog |
| **Barchart** | 17 patterns, **one screener page per pattern** | A stock simply appears on every list it qualifies for. There is no per-symbol label column to arbitrate. | none | barchart.com/investing-ideas/candlestick-patterns |
| **Finviz** | Screener → Technical → `Candlestick` filter, **11 values** | One value selectable per query. Critically: **all 11 values are single-bar SHAPES** — Long Lower Shadow, Long Upper Shadow, Hammer, Inverted Hammer, Spinning Top White, Spinning Top Black, Doji, Dragonfly Doji, Gravestone Doji, Marubozu White, Marubozu Black. **No engulfing, no harami, no stars.** Finviz sidesteps multi-match by only ever asking about shape. | none | finviz-screener API docs |
| **Investing.com** | Technical → Candlestick Patterns table | **One ROW per (symbol, pattern, timeframe).** A symbol appears many times. Observed live on the page: Tesla with *Three Outside Up (1W)* **and** *Bullish Engulfing (1W)* — i.e. the containing pattern and the contained pattern are both emitted as separate rows. 30+ patterns, last 70 candles, 15m–1M. | Published reliability: **strong / medium / weak**, filterable, shown as stars. | investing.com/technical/candlestick-patterns; investing.com blog 137 |
| **MetaStock** | Greg Morris' Japanese Candle Pattern Recognition add-on (bundled free from v20) | Each signal carries a **probability rating** of success; the add-on's differentiator is that probability, not arbitration. | probability per signal | metastock.com thirdparty 3pc-add-jcpr |
| **CandleScanner** | 104 patterns: **20 basic candles + 84 patterns** (10 one-line, 36 two-line, 28 three-line, 3 four-line, 7 five-line) | **The only platform with an explicit single-label rule — and only on the shape axis:** *"Every single candlestick on the chart is classified as one and only one particular basic candle."* The 84 multi-line patterns are reported separately and may co-occur. | Trend-validity gate (below) is the de-facto filter | candlescanner.com basic-candles + intro PDF |
| **TA-Lib** *(the reference implementation everyone copies)* | 61 `CDL*` functions | **Sidesteps the problem entirely: one independent integer output series per pattern**, value ∈ {−100, 0, +100}. `CDLDOJI`, `CDLENGULFING`, `CDLHARAMI`, `CDLHARAMICROSS`, `CDL3OUTSIDE` all fire on the same bar with no cross-talk. Containment is re-implemented **inline** in each function — `CDL3OUTSIDE` open-codes the engulfing test rather than calling `CDLENGULFING`. | none | ta-lib.github.io pattern_recognition; ta_CDL3OUTSIDE.c |

### What this means for a single-label column

**No mainstream platform ships a single-label candlestick column with a documented precedence chain.**
The industry answer is one of exactly three:

1. **Emit everything, independently** (TA-Lib, StockCharts, thinkorswim, TrendSpider, Barchart, Investing.com);
2. **Emit everything in one cell, ordered by a published strength tier, truncated with "+N"** (TradingView Screener) — the only real single-column precedent, and it is *ordered multi-label*, not single-label;
3. **Restrict the vocabulary to shapes only, where single-label is provably well-defined** (Finviz's 11 values; CandleScanner's basic candles).

⇒ A one-label column is an invention, not a convention. It must be built as *ranked multi-match with a
rendered head*, or it will keep losing information the way the current chain does. Do not build a
chain that discards the losers — build a ranker that keeps them.

---

## (b) The CONTAINMENT / SUBSET list

Notation: `A ⊃ B` = every A contains a B (A is longer / stricter and swallows B).
"Same-window" = specialisation by an extra constraint on the same bars.
"Extension" = a longer bar window whose prefix *is* the shorter pattern.

### B1. Same-window specialisations (X is a Y with one extra constraint)

| Specialisation | Generic | The extra constraint | Evidence |
|---|---|---|---|
| Harami Cross ⊂ Harami | Harami | 2nd line is a **doji** rather than a small body | StockCharts: *"A two-day pattern that's similar to the Harami. The difference is that the last day is a Doji."* TA-Lib ships both `CDLHARAMI` and `CDLHARAMICROSS`. |
| Morning Doji Star ⊂ Morning Star | Morning Star | middle line is a **doji** rather than a spinning top | StockCharts: *"similar to the Morning Star"*; Nison: *"If the middle portion of this candlestick pattern is a doji instead of a spinning top, it is an evening doji star."* |
| Evening Doji Star ⊂ Evening Star | Evening Star | same, bearish | as above |
| Abandoned Baby ⊂ Morning/Evening Doji Star | doji star | shadows must **not overlap** on either side (true island) | Nison: *"the same as a Western island top or bottom in which the island session is also a doji"* |
| Tri-Star ⊂ Morning/Evening Star | star | **all three** lines are doji | TA-Lib `CDLTRISTAR` |
| Long-Legged Doji ⊂ High Wave | High Wave | body is a **doji** instead of a small real body | Nison: *"If the real body is a doji instead of a small real body, it is a long-legged doji."* |
| Rickshaw Man ⊂ Long-Legged Doji | Long-Legged Doji | body sits at the **middle** of the range | TA-Lib `CDLRICKSHAWMAN` |
| Takuri ⊂ Dragonfly Doji ⊂ Doji | Doji | very long lower shadow / lower shadow only | TA-Lib: *"Takuri (Dragonfly Doji with very long lower shadow)"* |
| Gravestone Doji ⊂ Doji | Doji | upper shadow only | StockCharts dictionary |
| Four-Price Doji ⊂ Doji | Doji | **no shadows at all** (O=H=L=C); also a degenerate marubozu | CandleScanner basic candles |
| Opening/Closing Marubozu ⊂ Marubozu-family | Marubozu | exactly **one** shadow shaved instead of both | CandleScanner; TA-Lib has `CDLMARUBOZU` **and** `CDLCLOSINGMARUBOZU` |
| **Marubozu ⊂ Belt Hold** *(note the direction!)* | Belt Hold | belt-hold needs *"long white (black) real body — no or very short lower (upper) shadow"*; a full marubozu satisfies it automatically | TA-Lib `ta_CDLBELTHOLD.c` |
| Kicking ⊂ (two opposite-colour Marubozu + gap) | — | both lines must be marubozu | TA-Lib `CDLKICKING` |
| Kicking-by-length ⊂ Kicking | Kicking | adds a tiebreak on which marubozu is longer | TA-Lib `CDLKICKINGBYLENGTH` |
| Identical Three Crows ⊂ Three Black Crows | Three Black Crows | each opens at the prior close | TA-Lib `CDLIDENTICAL3CROWS` |
| Homing Pigeon ⊂ Harami | Harami | both bodies the **same** colour (black) | CandleScanner two-line list |
| Descending Hawk ⊂ Harami | Harami | both bodies white | CandleScanner two-line list |
| Last Engulfing Bottom/Top ⊂ Engulfing | Engulfing | identical geometry, **opposite prior trend** | CandleScanner two-line list |
| High Wave ⊂ Spinning Top | Spinning Top | on a **long line**, a shadow ≥ **3×** the body | CandleScanner §1.3.3 |
| Hanging Man ≡ Hammer *(shape-identical)* | — | disambiguated **only** by prior trend | Nison: same line, *"during a downtrend, it becomes a bullish hammer"*, *"during an uptrend… a bearish hanging man"* |
| Shooting Star ≡ Inverted Hammer *(shape-identical)* | — | same, mirrored | StockCharts dictionary |
| Dragonfly Doji ≈ Hammer with zero body | Hammer | *"In practice they encode the same lower-shadow rejection, and many scanners treat the dragonfly as the limiting case of the hammer."* | LuxAlgo library |

### B2. Extensions (longer window whose prefix is a complete shorter pattern)

| Longer | Contains | Evidence |
|---|---|---|
| **Three Outside Up ⊃ Bullish Engulfing** (bars 1–2) | Engulfing | TA-Lib `CDL3OUTSIDE`: *"first: black (white) real body — second: white (black) real body that engulfs the prior real body — third: candle that closes higher (lower) than the second candle"*; the engulfing test is **open-coded inline** |
| **Three Outside Down ⊃ Bearish Engulfing** | Engulfing | as above |
| **Three Inside Up ⊃ Bullish Harami** (bars 1–2) | Harami | TA-Lib `CDL3INSIDE`: *"first candle: long white (black) real body — second candle: short real body totally engulfed by the first — third candle: …"* |
| **Three Inside Down ⊃ Bearish Harami** | Harami | as above |
| Morning/Evening Star ⊃ a spinning-top-or-doji **shape** on the middle bar | shape | definitional |
| Morning/Evening Star ⊃ Rising/Falling **Window** (the gap into the star) | Window | TradingView ships Rising/Falling Window as standalone patterns |
| Tasuki Gap (3) ⊃ Rising/Falling Window (bars 1–2) | Window | TA-Lib `CDLTASUKIGAP` |
| Three-Line Strike (4) ⊃ Three White Soldiers / Three Black Crows (bars 1–3) **and** ⊃ an Engulfing (bars 3–4) | two patterns at once | TA-Lib `CDL3LINESTRIKE`; Bulkowski's **#1 overall performer** |
| Upside Gap Two Crows (3) ⊃ a Bearish Engulfing (bars 2–3) | Engulfing | StockCharts dictionary: *"gap, small black body, larger engulfing black body"* |
| Rising/Falling Three Methods (5) ⊃ a long white/black **shape** on bar 1 ⊃ harami-like containment of bars 2–4 inside bar 1 | shape + harami | StockCharts dictionary |
| Mat Hold (5) ⊃ Rising Three Methods geometry | Three Methods | TA-Lib `CDLMATHOLD` |
| Concealing Baby Swallow (4) ⊃ two Black Marubozu (bars 1–2) | Marubozu | TA-Lib `CDLCONCEALBABYSWALL` |
| Stick Sandwich (3) ⊃ Matching Low geometry (equal closes) | Matching Low | StockCharts dictionary |
| Ladder Bottom (5) ⊃ a three-black-crows-like opening run | Three Black Crows | TA-Lib `CDLLADDERBOTTOM` |

### B3. NOT containment — genuinely independent co-occurrence

These are the cases that a precedence *chain* cannot express at all, only a *ranker* can:

- **Hammer (shape) × Bullish Engulfing (relation).** Orthogonal axes. A long-lower-shadow bar that
  also engulfs yesterday is *both*, fully and correctly. No taxonomy in the literature makes these
  mutually exclusive. This is the brief's third defect and it is unfixable inside one if/elif.
- **Doji (shape) × Harami Cross (relation) × Three Inside Up (relation).** All three true at once.
- **Marubozu (shape) × Three White Soldiers (relation).** Routine.
- **Opposite-direction collisions:** bar N can be a *hanging man* (bearish, shape+trend) and
  simultaneously the closing bar of a *bullish engulfing*. No platform documents an answer for this.

### B4. Threshold collisions (not real containment — artefacts of sloppy cutoffs)

- `body<0.10` (doji) vs `body<0.30` (spinning top) — **overlapping predicates in the current code**.
- Doji tolerance vs Hammer: with a doji tolerance of 3% of range, a 2%-body bar with a huge tail is
  classified a *dragonfly doji* and the *hammer* is silently lost. CandleScanner names this the single
  easiest mistake: *"It is easy to mix them up when a spinning top has a very small body, which looks
  on the chart as if the open and close prices are equal."*
- Marubozu vs Belt Hold vs Opening/Closing Marubozu — three nested thresholds on the same shadow.

---

## (c) Stated ranking principles from the literature and the platforms

1. **Published 3-tier strength is the industry ordering.** TradingView Screener and Investing.com
   *independently* converge on **strong / medium / weak**. TradingView's assignment across 44 patterns
   (full table below) is the single most usable published ranking for this build.

2. **TradingView's tiering, in structure:**
   - **STRONG (12)** — Abandoned Baby (both), **Engulfing (both)**, Evening Star, Morning Star,
     Falling/Rising Three Methods, Kicking (both), Three Black Crows, Three White Soldiers.
   - **MEDIUM (14)** — Harami (both), **Harami Cross (both)**, Dark Cloud Cover, Piercing,
     Doji Star (both), **Evening Doji Star, Morning Doji Star**, Tri-Star (both),
     Rising/Falling Window, Upside/Downside Tasuki Gap, Tweezer Top/Bottom.
   - **WEAK (18)** — **Doji, Dragonfly Doji, Gravestone Doji, Hammer, Hanging Man, Inverted Hammer,
     Shooting Star, Marubozu (both), Spinning Top (both), Long Upper/Lower Shadow**, On Neck.
   ⇒ **Every single-bar shape is WEAK. Every 3-bar and 5-bar pattern except the doji-star variants is
   STRONG. Engulfing and Kicking are the only 2-bar STRONGs.** This is close to "more bars ⇒ stronger",
   and it flatly contradicts the current chain's ordering, which puts shapes *first*.

3. **⚠️ The counterexample that breaks a naive "prefer the more specific" rule.** TradingView rates
   **Morning Star STRONG but Morning Doji Star MEDIUM**; **Evening Star STRONG but Evening Doji Star
   MEDIUM**. The *more specific* pattern is rated *weaker*. Specificity and reliability are not the
   same axis and must not be collapsed into one comparator.

4. **Bulkowski** (`Encyclopedia of Candlestick Charts`, thepatternsite.com): **103 candlesticks**, each
   with **three separate ranks — reversal rate, frequency, and overall performance**. His top-10 overall
   performers: three-line strike bearish (84%), three-line strike bullish (65%), three black crows
   (78%), evening star (72%), upside Tasuki gap (57%), inverted hammer (65%), matching low (61%),
   abandoned baby bullish (70%), two black gapping (68%), breakaway bearish (63%).
   ⇒ **Nine of the ten are 3-bar or longer.** Independent corroboration of the bar-count/strength link.
   ⚠️ But frequency and performance are *independent* ranks: Bullish Kicking is frequency rank **100/103**
   yet performance rank only **96/103** — rare does **not** imply reliable. Do not build "rarity ⇒
   precedence" into the policy.

5. **Nison — precedence is by CONTEXT, not by geometry.** The hammer/hanging-man pair is the canonical
   statement: identical line, opposite meaning, decided *only* by prior trend. Nison's variant language
   is consistently "X is Y with a doji instead of a small body", which is a **specialisation lattice**,
   not a priority list. Nison publishes **no** tie-break for co-occurring patterns.

6. **CandleScanner — the trend gate acts as the real arbitrator.** Documented: a bearish reversal
   pattern is **rejected outright** unless a qualifying uptrend precedes it (their example: an uptrend
   must last ≥3 candles, measured against a 10-period MA). *"despite the fact that bearish reversal
   candle pattern occurred, ultimately it is not recognized as a valid one — the uptrend lasted only for
   one candle."* ⇒ Most multi-match collisions dissolve before ranking, because one of the candidates
   fails its trend precondition. **This is the highest-leverage and least-implemented idea in the whole
   research.**

7. **CandleScanner — size class is VOLATILITY-RELATIVE, not a fixed body/range ratio.** Documented
   default: long/short line = candle **total height including shadows** vs **70% of an exponential
   average of the last 25 candles' high-low range**; sane band 65–80%. Explicitly notes that raising
   the parameter yields more short lines and *changes how many patterns are found*.

8. **Documented literature disagreement worth knowing.** CandleScanner calls out Greg Morris directly:
   Morris's "long day / short day" refers **only to body height**, whereas CandleScanner uses the whole
   candle including shadows — *"This is a surprising approach, because that would mean that the candle
   with a small body and with very long shadows would be considered as constituting a short day."*
   The current code's `body/range` ratios follow Morris; the size *qualifier* should follow CandleScanner.

9. **Morris's own answer is "filtering", not precedence** — his contribution is candle-pattern filtering
   (confirm the candle with an independent indicator / location), i.e. *reduce* the match set with
   context rather than *rank* it. MetaStock's Morris add-on ships a **probability rating per signal**.

10. **Practitioner-level statement of the exact defect class:** Pine-script guidance on building
    multi-pattern detectors names as a top mistake *letting labels stack on the same bar without
    priority rules*, and *using contradictory thresholds so multiple exclusive patterns always fire* —
    i.e. both halves of the current bug are recognised failure modes in the wild.

---

## (d) RECOMMENDED PRECEDENCE POLICY

### d.1 The architecture

Replace the chain with **classify → collect → gate → rank → render**. Never discard a match during
classification; discard only at render time, and keep the full set on the row.

```
CandleResult = {
  shape:        str          # ALWAYS populated — one of the 20 basic candles
  shape_size:   'long'|'short'
  primary:      str          # what the CANDLE column shows
  secondary:    str | None   # the qualifier
  all_matches:  [Match]      # every match, ranked — what FILTERS query
  strength:     'strong'|'medium'|'weak'
  direction:    'bullish'|'bearish'|'neutral'
  extra_count:  int          # for a "+N" affordance
}
Match = { name, bars, tier, direction, specificity, contains:[names] }
```

### d.2 Stage 1 — SHAPE: a total, mutually-exclusive classifier (never returns None)

```python
def classify_shape(bar, ema25_range):
    rng   = bar.high - bar.low
    body  = abs(bar.close - bar.open)
    upper = bar.high - max(bar.open, bar.close)
    lower = min(bar.open, bar.close) - bar.low
    white = bar.close > bar.open

    if rng == 0:
        return 'four-price-doji', 'short'

    # CandleScanner's documented rule: WHOLE candle height vs 70% of EMA25(range).
    # NOT body/range. Tunable 0.65-0.80.
    size = 'long' if rng > 0.70 * ema25_range else 'short'

    b, u, l = body / rng, upper / rng, lower / rng
    DOJI = 0.03      # CandleScanner: "body length up to 3% of the whole candle length"
    NIL  = 0.03      # "no or very short" shadow, TA-Lib belt-hold sense

    # --- branch 1: doji family (body ~ 0) ---------------------------------
    if b <= DOJI:
        if u <= NIL and l <= NIL:  return 'four-price-doji', size
        if u <= NIL:               return 'dragonfly-doji',  size
        if l <= NIL:               return 'gravestone-doji', size
        if size == 'long':         return 'long-legged-doji', size
        return 'doji', size

    # --- branch 2: marubozu family (>=1 shadow shaved, body > that shadow) -
    if u <= NIL and l <= NIL:
        return ('white-marubozu' if white else 'black-marubozu'), size
    if u <= NIL:   # top shaved
        return ('closing-white-marubozu' if white else 'opening-black-marubozu'), size
    if l <= NIL:   # bottom shaved
        return ('opening-white-marubozu' if white else 'closing-black-marubozu'), size

    # --- branch 3: spinning top family (some shadow LONGER than the body) --
    if max(u, l) > b:
        if size == 'long' and max(u, l) >= 3 * b:  return 'high-wave', size
        if l > b and u <= b:  return 'long-lower-shadow', size   # hammer/hanging-man SHAPE
        if u > b and l <= b:  return 'long-upper-shadow', size   # shooting-star SHAPE
        return ('white-spinning-top' if white else 'black-spinning-top'), size

    # --- branch 4: plain candle (body >= both shadows) ---------------------
    # THIS BRANCH IS THE FIX for "body 0.35-0.85 gets no label at all".
    if white:  return ('long-white-candle' if size == 'long' else 'short-white-candle'), size
    return     ('long-black-candle'  if size == 'long' else 'short-black-candle'),  size
```

Branches are ordered **most-constrained first** and each `return`s, so they are exclusive by
construction rather than by luck. Coverage is total: every bar exits somewhere.

Note the deliberate choice: **hammer / hanging-man / shooting-star / inverted-hammer are NOT shapes.**
They require prior trend (Nison), so they are emitted at stage 2 as trend-qualified one-line *patterns*
that outrank the bare `long-lower-shadow` shape. CandleScanner makes exactly this split — they are in
its "one-line patterns" list, not its "basic candles" list.

### d.3 Stage 2 — RELATIONS: collect all, do not stop at the first

Run every 1-bar-trend-qualified, 2-bar, 3-bar, 4-bar and 5-bar test independently (TA-Lib style, one
predicate per pattern) and append every hit whose **last bar is the bar being labelled**. Never `elif`.

### d.4 Stage 3 — TREND GATE (CandleScanner's rule, applied before ranking)

```python
def trend_ok(m, bars):
    if m.kind == 'bullish-reversal':  return downtrend_for(bars, n=3, ma=10)
    if m.kind == 'bearish-reversal':  return uptrend_for(bars,   n=3, ma=10)
    if m.kind.endswith('continuation'): return trend_agrees(bars, m.direction)
    return True
matches = [m for m in matches if trend_ok(m, bars)]
```
This kills most collisions before any precedence question arises, and it is the only step in this whole
policy that is *documented practice* rather than invention. It also resolves hammer-vs-hanging-man and
last-engulfing-vs-engulfing for free, since those pairs differ only by prior trend.

### d.5 Stage 4 — SUBSUMPTION (the containment list from §b, applied as data not code)

```python
# Data table, derived from §b. Keys are the container, values what it swallows.
SUBSUMES = {
  'three-outside-up':   ['bullish-engulfing'],
  'three-outside-down': ['bearish-engulfing'],
  'three-inside-up':    ['bullish-harami', 'bullish-harami-cross'],
  'three-inside-down':  ['bearish-harami', 'bearish-harami-cross'],
  'three-line-strike':  ['three-white-soldiers','three-black-crows',
                         'bullish-engulfing','bearish-engulfing'],
  'upside-gap-two-crows':['bearish-engulfing'],
  'abandoned-baby':     ['morning-doji-star','evening-doji-star',
                         'morning-star','evening-star','doji-star'],
  'morning-doji-star':  ['morning-star','doji-star'],
  'evening-doji-star':  ['evening-star','doji-star'],
  'tri-star':           ['morning-star','evening-star','doji-star'],
  'mat-hold':           ['rising-three-methods'],
  'concealing-baby-swallow': ['black-marubozu'],
  'stick-sandwich':     ['matching-low'],
  'ladder-bottom':      ['three-black-crows'],
  'identical-three-crows':['three-black-crows'],
  'kicking-by-length':  ['kicking'],
  'white-marubozu':     ['bullish-belt-hold'],   # marubozu ⊂ belt-hold, see §b1
  'black-marubozu':     ['bearish-belt-hold'],
  'harami-cross':       ['harami'],
  'homing-pigeon':      ['bullish-harami'],
  'descending-hawk':    ['bearish-harami'],
  'takuri':             ['dragonfly-doji'],
  'dragonfly-doji':     ['doji'],
  'gravestone-doji':    ['doji'],
  'long-legged-doji':   ['doji','high-wave'],
  'rickshaw-man':       ['long-legged-doji'],
  'high-wave':          ['spinning-top'],
}

def subsume(matches):
    survivors = list(matches)
    for m in matches:
        for swallowed in SUBSUMES.get(m.name, []):
            other = find(survivors, swallowed)
            if other is None: continue
            # ⚠️ THE ONE EXCEPTION, and it is real:
            # keep the swallowed pattern as PRIMARY when it is strictly stronger.
            # (morning-doji-star MEDIUM subsumes morning-star STRONG.)
            if TIER[other.name] > TIER[m.name]:
                other.qualifier = m.name        # "morning-star (doji)"
                survivors.remove(m)
            else:
                m.contains.append(other.name)
                survivors.remove(other)
    return survivors
```

### d.6 Stage 5 — RANK the survivors

```python
TIER = {'strong': 3, 'medium': 2, 'weak': 1}   # seed from the TradingView 44 (§c.2)

def rank_key(m):
    return (
      TIER[m.tier],              # 1. published reliability tier      (TradingView / Investing.com)
      m.bars,                    # 2. more bars = more confirmation   (Bulkowski top-10: 9/10 are 3+)
      m.specificity,             # 3. more constrained name wins ties (harami-cross > harami)
      -BULKOWSKI_PERF[m.name],   # 4. overall performance rank 1..103, deterministic tiebreak
      m.name,                    # 5. alphabetical — determinism, never a coin flip
    )

ranked  = sorted(relations, key=rank_key, reverse=True)
primary = ranked[0].name if ranked else shape
secondary = pick_qualifier(ranked, shape)
```

**Ordering rationale (bar-count vs specificity vs reliability, §4 of the brief).** The three axes are
put in this order because the platforms and the data say so, not by taste:

- **Reliability first**, because it is the only axis two independent commercial vendors publish
  (TradingView, Investing.com) and the only one that is measured rather than structural. TradingView
  *explicitly* orders its multi-pattern cell by it.
- **Bar count second**, because it is a *proxy* for reliability that fills the gaps where no tier is
  published, and Bulkowski's measured top-10 is 9/10 three-bars-or-longer. A longer pattern's extra
  bars are literally confirmation bars — the third bar of a three-outside-up is a close beyond the
  engulfing, which is what a discretionary trader would wait for anyway. Crucially there is **no
  lag cost**: the longer pattern still *completes on today's bar*, so preferring it never delays a
  signal, it only adds evidence.
- **Specificity third and never first**, because §c.3 proves specificity and reliability can point
  opposite ways (morning-doji-star is more specific *and* weaker).
- **Rarity is deliberately NOT an axis.** Bulkowski's Bullish Kicking is frequency-rank 100/103 and
  performance-rank 96/103. Rare ≠ good. A "rare 5-bar continuation beats a reliable 1-bar structure"
  ordering would be wrong; the policy above prefers the 5-bar pattern because 5-bar continuations are
  tiered *strong*, not because they are rare.

### d.7 Cases where this policy gives a debatable answer — stated honestly

1. **Hammer that is also a bullish engulfing.** Policy → `bullish-engulfing` (STRONG beats WEAK), with
   `hammer` as the qualifier. A discretionary trader looking at a two-ATR tail into a major support
   would call the hammer the story. The qualifier mitigates but does not settle it. *This is the single
   most common contested case and it will be visible daily.*
2. **Doji that completes a three-inside-up.** Policy → `three-inside-up`. But the doji is the entire
   reason the harami is a *harami cross*, and the doji is the reversal information. Mitigated by
   rendering `three-inside-up (doji)`.
3. **Direction conflict across windows.** Bar N closes a 5-bar *rising three methods* (bullish
   continuation, STRONG) and simultaneously is the second bar of a *bearish engulfing* (STRONG).
   Policy → tier tie, more bars wins → bullish. A human would very likely read the fresher 2-bar
   reversal as dominant. **Recommend logging both and, if a fourth axis is ever added, making it
   recency (shorter window = fresher) rather than rarity.** Flagged as a known-weak spot.
4. **Hanging man vs hammer.** Entirely determined by the trend definition (n bars vs a 10-MA). Whenever
   the mechanical trend test disagrees with the eye, the label flips to its opposite. *No single label
   is defensible here* — this is Nison's own position, and it is a limit of the column, not a bug.
5. **Marubozu vs belt hold.** The containment runs *backwards* from intuition (marubozu ⊂ belt-hold).
   The table above forces `white-marubozu` to win, which is right — but note it is the SHORTER,
   more-specific name beating the longer-tiered one, an exception to the general shape of the rule.
6. **Dragonfly doji vs hammer at the tolerance boundary.** With `DOJI = 0.03`, a bar with a 2%-of-range
   body and a huge lower tail becomes a `dragonfly-doji` (WEAK, neutral shape) and the *hammer*
   (trend-qualified, bullish) is never even evaluated because the doji branch consumed the shape.
   **Recommend tightening the dragonfly branch specifically**: emit `dragonfly-doji` only when
   `body <= 0.01 * range`, and let 0.01–0.03 fall through to `long-lower-shadow` so the hammer test
   can run. LuxAlgo's *"many scanners treat the dragonfly as the limiting case of the hammer"* supports
   preferring the hammer reading.
7. **Doji tolerance on a high-priced stock.** A 5-cent body on a $400 name is visually a doji and
   arithmetically a spinning top. Tolerance must be a fraction of **range**, never of price, and it
   should be documented on the column, because it changes counts materially (CandleScanner says so
   explicitly about its own thresholds).
8. **The trend gate is a second authority over the trend.** If the screener already has a trend/score
   column, the gate must consume *that* value rather than re-deriving a 10-MA. Re-deriving creates two
   authorities over one number that will disagree in the tails.

---

## (e) Should the column ever show more than one label? — YES, one primary + one qualifier

**What platforms actually do:** the only real single-column precedent, TradingView's Screener, shows
**up to four** patterns per cell ordered by strength with a **"+3"-style counter** for the rest, and
reveals the full list on hover. Investing.com emits one row per pattern, so a symbol simply appears
several times. Nobody who ships a candlestick surface throws matches away.

**Recommendation:**

- **Column renders:** `primary` · `qualifier` — e.g. `bullish-engulfing (hammer)`,
  `three-inside-up (doji)`, `morning-star (doji)`. Append the qualifier **only when it carries
  information** — a named shape (doji / hammer / marubozu / dragonfly / high-wave) or a subsumed
  pattern. Never append `(white candle)`; that is noise.
- **Plus a "+N" affordance** when `len(all_matches) > 2`, matching TradingView's idiom, with the full
  ranked list on hover/expand. Information-theoretically this is the right trade: the head of the
  ranking carries most of the signal, the tail is cheap to defer, and nothing is destroyed.
- **Plus a separate `candle_strength` column** (`strong`/`medium`/`weak`) — both TradingView and
  Investing.com publish exactly this 3-tier scheme, so it is a familiar, sortable, filterable scalar.
  Keep it as a tier, not a fabricated 0–100 score. If a numeric sort key is wanted, use Bulkowski's
  overall-performance rank (1–103) and label it as such — **do not present any of it as a probability**;
  Bulkowski's numbers are measured against his own breakout-and-confirmation rules, not against
  "next bar up".
- **⛔ The filter must query `all_matches`, not `primary`.** If "screen for hammer" runs against the
  rendered primary, every hammer that was also an engulfing silently disappears from the result set —
  the exact defect being fixed, reintroduced one layer up. This is the highest-risk part of the build.

---

## (f) The "no pattern" case — a complete descriptive taxonomy DOES exist, so never show a dash

**Does a complete fallback taxonomy exist in the literature? Yes, and it is published twice over.**

1. **CandleScanner's 20 "basic candles"** are a documented *total partition* of single-bar space:
   *"Every single candlestick on the chart is classified as one and only one particular basic candle."*
   Four exhaustive branches — different open/close with two short shadows (6 names: short/plain/long ×
   white/black), marubozu (6), spinning tops (3 incl. high wave), doji (5) — and CandleScanner states
   plainly that *"Most of them are not patterns as such, but they can often play an important role in
   the assessment of the current situation of the market"*, and that *"Basic candles are components of
   more complex patterns."* That is precisely the role wanted here: a floor, not a signal.

2. **Finviz already ships this exact idea in a competing screener.** Its entire `Candlestick` filter
   vocabulary — all 11 values — is single-bar shape: Long Lower Shadow, Long Upper Shadow, Hammer,
   Inverted Hammer, Spinning Top White/Black, Doji, Dragonfly Doji, Gravestone Doji, Marubozu
   White/Black. Not one relational pattern. The market precedent for "describe the bar" is established.

3. **StockCharts ChartSchool** supplies the missing vocabulary for the mid-band the current code drops:
   **Long Body / Long Day** (*"large price move from open to close"*) and **Short Body / Short Day**
   (*"small price move from open to close"*), plus **Long Shadows** as a named class.

**Policy: the CANDLE column is never empty and never a dash.**

```
primary = ranked[0].name if ranked else shape      # shape is guaranteed non-null
```

with the shape names rendered in trader-legible form: `long-white`, `short-black`, `white-marubozu`,
`black-spinning-top`, `high-wave`, `long-lower-shadow`, `doji`, `dragonfly-doji`, …

Two design notes:

- **`long-` / `short-` must be volatility-relative**, per CandleScanner: total candle height vs
  **70% of EMA25(high−low)**, tunable 0.65–0.80. A fixed body/range constant will call a quiet
  0.6-body bar "long" in a calm tape and a violent one "short" in a wild tape. Note the documented
  disagreement: **Greg Morris measures "long day" by body only; CandleScanner by the whole candle
  including shadows.** Follow CandleScanner for the size qualifier — Morris's version calls a bar with
  a tiny body and enormous shadows a "short day", which is plainly wrong about volatility.
- **`wide-range-up` is a *different* fact from `long-white`** and worth a separate boolean rather than
  a label: range vs ATR is a volatility statement, body vs shadows is a structure statement. Folding
  them into one string loses the distinction. Keep the shape label structural; put range-vs-ATR in its
  own numeric column where it can be filtered.

**Result:** essentially 100% of rows get a meaningful structural description, ~5–15% of rows get a
named multi-bar pattern as the primary, and the two never compete — because the shape is the floor,
not a rival.

---

## (g) SOURCES

**Platform documentation**
1. TradingView — Candlestick Pattern in Screener (multi-match ordering, 44-pattern strength table) — https://www.tradingview.com/support/solutions/43000752737-candlestick-pattern-in-screener/
2. TradingView Blog — Screener goes visual with candlestick patterns ("up to four miniatures… '+3'", ordering by strength) — https://www.tradingview.com/blog/en/candlestick-patterns-in-screener-59644/
3. TradingView — Automatic candlestick pattern detection (chart indicators, label colours) — https://www.tradingview.com/support/solutions/43000584462-candlestick-patterns/
4. Thinkorswim/Schwab Learning Center — Engulfing (per-pattern study, separate Bullish/Bearish plots) — https://toslc.thinkorswim.com/center/reference/Patterns/candlestick-patterns-library/bearish-and-bullish/Engulfing
5. Thinkorswim/Schwab Learning Center — Candlestick Patterns Library index (three groups) — https://toslc.thinkorswim.com/center/reference/Patterns/candlestick-patterns-library
6. StockCharts — Scan Syntax: Predefined Patterns (24 independent boolean clauses) — https://help.stockcharts.com/scanning-and-alerts/scan-writing-resource-center/scan-syntax-reference/scan-syntax-predefined-patterns
7. StockCharts ChartSchool — Candlestick Pattern Dictionary (harami cross / morning doji star / evening doji star "similar to…" wording; Long Body, Short Body, Long Shadows) — https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/candlestick-pattern-dictionary
8. TrendSpider — Auto-Recognized Traditional Candlestick Pattern Definitions (100+ patterns; core + The Strat + Bulkowski + Newsome) — https://help.trendspider.com/kb/automated-technical-analysis/auto-recognized-traditional-candlestick-pattern-definitions
9. TrendSpider — Utilizing the Candlestick Pattern Recognition Feature ("All candlestick patterns that you have selected will show up on the chart") — https://trendspider.com/blog/utilizing-the-candlestick-pattern-recognition-feature-trendspider-user-guide/
10. Barchart — Candlestick Patterns (17 patterns, one screener per pattern) — https://www.barchart.com/investing-ideas/candlestick-patterns
11. Finviz screener filter reference — the 11 `candlestick` values, all single-bar shapes — https://github.com/knicola/finviz-screener/blob/master/docs/API.md
12. Investing.com — Candlestick Patterns table (one row per symbol×pattern×timeframe; Tesla showing Three Outside Up AND Bullish Engulfing on 1W; star reliability) — https://www.investing.com/technical/candlestick-patterns
13. Investing.com Blog — "What Does the Chart Say?" (30+ configurations, 70-candle lookback, "a measure of reliability (strong, medium, or weak)") — https://www.investing.com/blog/what-does-the-chart-say-find-out-with-candlestick-patterns-137
14. MetaStock — Greg Morris' Japanese Candle Pattern Recognition add-on (probability rating per signal) — https://www.metastock.com/products/thirdparty/?3pc-add-jcpr=

**CandleScanner (the only vendor documenting single-label resolution)**
15. CandleScanner — Basic Candles (*"Every single candlestick on the chart is classified as one and only one particular basic candle."*) — https://www.candlescanner.com/candlestick-patterns/basic-candles/
16. CandleScanner — Patterns supported (104 = 20 basic + 84; 10/36/28/3/7 by line count; note one CandleScanner page states 106 = 20+86, the PDF and the counts add to 104) — https://www.candlescanner.com/candlestick-patterns/patterns-supported-by-candlescanner/
17. CandleScanner — Two-Line Patterns (36; harami/harami-cross/homing-pigeon/descending-hawk, engulfing/last-engulfing) — https://www.candlescanner.com/candlestick-patterns/two-line-patterns/
18. CandleScanner — *A Very Brief Introduction to Candlestick Patterns* PDF (long/short line = 70% of EMA25 range including shadows; the Morris body-only disagreement; the trend-validity gate and its 3-candle/10-MA example; the four basic-candle branches; doji-vs-spinning-top confusion warning) — https://www.candlescanner.com/wp-content/uploads/2018/02/Introduction-to-Candlestick-Patterns.pdf

**Reference implementation**
19. TA-Lib — Pattern Recognition function list (61 `CDL*` functions, **one independent integer output series each**) — https://ta-lib.github.io/ta-lib-python/func_groups/pattern_recognition.html
20. TA-Lib source `ta_CDL3OUTSIDE.c` (engulfing test open-coded inline, no cross-call) — https://github.com/TA-Lib/ta-lib/blob/main/src/ta_func/ta_CDL3OUTSIDE.c
21. TA-Lib source `ta_CDL3INSIDE.c` ("second candle: short real body totally engulfed by the first") — https://github.com/TA-Lib/ta-lib/blob/main/src/ta_func/ta_CDL3INSIDE.c
22. TA-Lib source `ta_CDLBELTHOLD.c` ("long white (black) real body — no or very short lower (upper) shadow") — https://github.com/TA-Lib/ta-lib/blob/main/src/ta_func/ta_CDLBELTHOLD.c

**Literature**
23. Bulkowski — Candlestick pattern index (103 candlesticks; three ranks: reversal rate, frequency, overall performance) — https://thepatternsite.com/CandleEntry.html
24. Bulkowski — Top 10 Performing Candlesticks — https://thepatternsite.com/CandlePerformers.html
25. Bulkowski — Three Outside Up (freq rank 24, perf rank 34, 75% reversal; definition is engulfing + confirming close) — https://www.thepatternsite.com/ThreeOutsideUp.html
26. Bulkowski — Bullish Kicking (frequency rank 100/103, performance rank 96/103 — rare ≠ reliable) — https://thepatternsite.com/KickingBull.html
27. Nison / CandleCharts — pattern definitions (hammer≡hanging man by trend; *"If the middle portion… is a doji instead of a spinning top, it is an evening doji star"*; *"If the real body is a doji instead of a small real body, it is a long-legged doji"*; abandoned baby = island with a doji) — https://candlecharts.com/candlestick-patterns/
28. Greg Morris — *Candlestick Charting Explained* (89 patterns; the "candle pattern filtering" concept; body-only definition of long/short day) — https://archive.org/details/candlestickchart0000morr_u1p9
29. LuxAlgo Library — Dragonfly Doji (*"In practice they encode the same lower-shadow rejection, and many scanners treat the dragonfly as the limiting case of the hammer."*) — https://www.luxalgo.com/library/concept/dragonfly-doji/
30. Pineify — building a multi-pattern candlestick indicator (names "letting labels stack on the same bar without priority rules" and "contradictory thresholds so multiple exclusive patterns always fire" as standard failure modes) — https://pineify.app/resources/blog/candlestick-patterns-indicator-tradingview-pine-script
