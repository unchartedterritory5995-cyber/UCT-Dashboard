# CANDLE column research — 04: CONTINUATION patterns + everything 4 bars or longer

Researcher 04 of 10. Scope: continuation structure and any pattern needing 4+ bars, plus the
US-equity swing-trader compression vocabulary (inside bar, NR4/NR7, outside bar, coiling).

Every rule below is written to be transcribed into Python against arrays `O,H,L,C` indexed
oldest→newest, with the bar under classification at index `i = -1`.

---

## 0. SHARED PRIMITIVES — implement these ONCE

All the TA-Lib-derived rules below are expressed against these. TA-Lib's own macros are in
`src/ta_func/ta_utility.h`; the defaults are in `src/ta_common/ta_global.c`
(`TA_RestoreCandleDefaultSettings`). Both were read verbatim for this document.

```python
body(i)      = abs(C[i] - O[i])
rng(i)       = H[i] - L[i]
btop(i)      = max(O[i], C[i])
bbot(i)      = min(O[i], C[i])
upsh(i)      = H[i] - btop(i)
losh(i)      = bbot(i) - L[i]

# *** TA-Lib colour convention: a doji (C == O) counts as WHITE. ***
color(i)     = +1 if C[i] >= O[i] else -1     # TA_CANDLECOLOR
white(i)     = color(i) == +1
black(i)     = color(i) == -1

# Trailing means EXCLUDE the current bar. TA-Lib accumulates the sum over the
# `avgPeriod` bars BEFORE i and only then evaluates the pattern. Getting this
# off-by-one wrong shifts every "long"/"short" test.
avg_body(i, n)   = mean(body[i-n : i])         # bars i-n .. i-1
avg_rng(i, n)    = mean(rng[i-n : i])
avg_shsum(i, n)  = mean((upsh+losh)[i-n : i])

# real-body gaps (TA_REALBODYGAPUP / DOWN) — NOT shadow gaps
rb_gap_up(a, b)   = bbot(a) > btop(b)
rb_gap_down(a, b) = btop(a) < bbot(b)
# true window / shadow gap (TA_CANDLEGAPUP / DOWN)
gap_up(a, b)      = L[a] > H[b]
gap_down(a, b)    = H[a] < L[b]
```

### TA-Lib candle-settings defaults, translated (verbatim from `ta_global.c`)

`TA_CANDLEAVERAGE(SET, SUM, IDX) = factor * (avgPeriod != 0 ? SUM/avgPeriod : range(IDX)) / (rangeType==Shadows ? 2 : 1)`

| Setting | rangeType | avgPeriod | factor | Executable threshold |
|---|---|---|---|---|
| `BodyLong` | RealBody | 10 | 1.0 | `body(i) > avg_body(i,10)` |
| `BodyVeryLong` | RealBody | 10 | 3.0 | `body(i) > 3 * avg_body(i,10)` |
| `BodyShort` | RealBody | 10 | 1.0 | `body(i) < avg_body(i,10)` |
| `BodyDoji` | HighLow | 10 | 0.1 | `body(i) < 0.10 * avg_rng(i,10)` |
| `ShadowLong` | RealBody | 0 | 1.0 | `shadow > 1.0 * body(i)` (own bar, no average) |
| `ShadowVeryLong` | RealBody | 0 | 2.0 | `shadow > 2.0 * body(i)` (own bar) |
| `ShadowShort` | Shadows | 10 | 1.0 | `shadow < 0.5 * avg_shsum(i,10)` (÷2 for Shadows) |
| `ShadowVeryShort` | HighLow | 10 | 0.1 | `shadow < 0.10 * avg_rng(i,10)` |
| `Near` | HighLow | 5 | 0.2 | `dist <= 0.20 * avg_rng(i,5)` |
| `Far` | HighLow | 5 | 0.6 | `dist >= 0.60 * avg_rng(i,5)` |
| `Equal` | HighLow | 5 | 0.05 | `dist <= 0.05 * avg_rng(i,5)` |

> **⚠ TRAP — `BodyLong` and `BodyShort` have IDENTICAL defaults.** Both are
> `RealBody / 10 / 1.0`. So in stock TA-Lib "long" means `body > 10-bar avg body` and "short"
> means `body < 10-bar avg body`: they PARTITION the space with no dead zone. Roughly 55–60%
> of bars are "short" and 40–45% are "long" on real equity data. If you want the classical
> visual meaning you must widen the gap yourself (e.g. long = `>1.3×`, short = `<0.6×`) —
> but then you no longer match TA-Lib output, and your pattern counts will drop sharply.

### Recommended additional normalizers (not in TA-Lib, needed for a screener)

```python
atr14(i)            # Wilder ATR of the 14 bars ending at i-1
body_ratio(i)  = body(i) / rng(i)          if rng(i) > 0 else 0
rng_atr(i)     = rng(i) / atr14(i)
gap_atr(a,b)   = (bbot(a) - btop(b)) / atr14(a)
```

Use `rng_atr` rather than raw ranges anywhere you want price-scale independence across
3,700 tickers. `body/range` is the only fully scale-free single-bar shape metric.

---

## (a) SUMMARY TABLE — one-line executable rule per pattern

`N` = bars the detector must look at (incl. any lookback needed for the averages, which adds
10 for BodyLong/Short and 5 for Near/Equal, and 14 for ATR).

### Classical Japanese continuation family

| # | Pattern | Bars | Bias | One-line executable rule (TA-Lib semantics unless noted) |
|---|---|---|---|---|
| 1 | Rising Three Methods | 5 | Bull cont. | white(-5) long; -4,-3,-2 all black & short with falling closes and each body OVERLAPPING [L(-5),H(-5)]; white(-1) long, O(-1)>C(-2), C(-1)>C(-5) |
| 2 | Falling Three Methods | 5 | Bear cont. | exact mirror of #1 with colours flipped and "rising" closes |
| 3 | Mat Hold | 5 | Bull cont. | white(-5) long; **real-body gap UP** to black short(-4); -3,-2 short, bodies dip below C(-5) but ≤50% into body(-5), falling body tops; white(-1) with O(-1)>C(-2) and C(-1) > max(H(-4),H(-3),H(-2)) |
| 4 | Upside Tasuki Gap | 3 | Bull cont. | rb_gap_up(-2,-3); white(-2); black(-1) with O(-1) inside body(-2), C(-1) < O(-2) **but** C(-1) > btop(-3) (gap stays open); \|body(-2)-body(-1)\| < 0.2·avg_rng(-2,5) |
| 5 | Downside Tasuki Gap | 3 | Bear cont. | mirror of #4 |
| 6 | Upside gap side-by-side white lines | 3 | Bull cont. | rb_gap_up(-2,-3) **and** rb_gap_up(-1,-3); white(-2) and white(-1); bodies near-equal (±0.2·avg_rng5); opens equal (±0.05·avg_rng5) |
| 7 | Downside gap side-by-side white lines | 3 | Bear cont. | same as #6 but rb_gap_**down** on both — still two WHITE candles |
| 8 | Upside Gap Three Methods | 3 | Bull cont. | white(-3), white(-2), rb_gap_up(-2,-3); black(-1) opens strictly inside body(-2) and closes strictly inside body(-3) → **gap is CLOSED** (this is the tasuki's twin) |
| 9 | Downside Gap Three Methods | 3 | Bear cont. | mirror of #8 |
| 10 | Three-Line Strike (bullish) | 4 | **Disputed** | white(-4,-3,-2) with C rising, each opening within/near prior body (±Near); black(-1) opens > C(-2) and closes < O(-4) |
| 11 | Three-Line Strike (bearish) | 4 | **Disputed** | mirror of #10 |
| 12 | Breakaway, bullish | 5 | **Reversal** | black(-5) long; rb_gap_down(-4,-5); H/L(-3) both < H/L(-4); H/L(-2) both < H/L(-3); black(-2); white(-1) with O(-4) < C(-1) < C(-5) |
| 13 | Breakaway, bearish | 5 | **Reversal** | mirror of #12 |
| 14 | Ladder Bottom | 5 | Bull reversal | black(-5,-4,-3) with strictly falling opens AND closes; black(-2) with upsh(-2) > 0.10·avg_rng(-2,10); white(-1) with O(-1)>O(-2) and C(-1)>H(-2) |
| 15 | Concealing Baby Swallow | 4 | Nominal bull rev. (**measured bear cont.**) | four black; -4,-3 marubozu (both shadows < 0.10·avg_rng10); rb_gap_down(-2,-3) but upsh(-2) > 0.10·avg_rng10 and H(-2) > C(-3); H(-1)>H(-2) and L(-1)<L(-2) |
| 16 | Separating Lines | 2 | Continuation | colours opposite; \|O(-1)-O(-2)\| ≤ 0.05·avg_rng(-2,5); body(-1) long; belt-hold (white ⇒ losh tiny; black ⇒ upsh tiny) |
| 17 | On-Neck | 2 | Bear cont. | black long(-2); white(-1); O(-1) < L(-2); \|C(-1) - L(-2)\| ≤ 0.05·avg_rng(-2,5) |
| 18 | In-Neck | 2 | Bear cont. | black long(-2); white(-1); O(-1) < L(-2); C(-2) ≤ C(-1) ≤ C(-2) + 0.05·avg_rng(-2,5) |
| 19 | Thrusting | 2 | Bear cont. | black long(-2); white(-1); O(-1) < L(-2); C(-1) > C(-2)+Equal **and** C(-1) ≤ C(-2) + 0.5·body(-2) |
| 20 | Hikkake | 3 (+3 confirm) | Either | inside(-2) vs (-3); then bull if H(-1)<H(-2) **and** L(-1)<L(-2); bear if H(-1)>H(-2) and L(-1)>L(-2). Confirm within 3 bars by C > H(inside) / C < L(inside) |
| 21 | Modified Hikkake | 4 (+3 confirm) | Reversal | nested inside bars (-3 in -4, -2 in -3); bull needs C(-3) ≤ L(-3)+Near **and** H/L(-1) both below H/L(-2); bear mirrored |
| 22 | High Wave | 1 | Neutral / indecision | body(-1) < avg_body(-1,10) **and** upsh(-1) > 2·body(-1) **and** losh(-1) > 2·body(-1) |

### Swing-trader compression family (non-canonical, US equity screener vocabulary)

| # | Pattern | Bars | Bias | One-line executable rule |
|---|---|---|---|---|
| 23 | Inside Bar / Inside Day | 2 | Continuation 62% | `H[-1] < H[-2] and L[-1] > L[-2]` (strict) |
| 24 | Inside-bar run (n-bar) | 2..k | Compression | count of consecutive trailing bars all contained in the same mother bar |
| 25 | Coiling / nested inside run | 3+ | Compression | H strictly monotone-decreasing AND L strictly monotone-increasing over the last k bars (k ≥ 2 inside bars) |
| 26 | NR4 | 4 | Compression | `rng(-1) < min(rng(-2), rng(-3), rng(-4))` |
| 27 | NR7 | 7 | Compression | `rng(-1) < min(rng(-2)..rng(-7))` |
| 28 | NR7-2 | 8 | Compression | NR7 at `-2` **and** `rng(-1) < min(rng(-2)..rng(-8))` |
| 29 | ID/NR4 (Crabel; Raschke "Street Smarts") | 4 | Coiled breakout | `inside(-1) and NR4(-1)` |
| 30 | ID/NR7 | 7 | Coiled breakout | `inside(-1) and NR7(-1)` |
| 31 | Crabel 2-Bar NR | 21 | Compression | 2-day range `max(H[-1],H[-2]) - min(L[-1],L[-2])` is the smallest of any 2-day window in the prior 20 sessions |
| 32 | HV-squeeze (Connors/Raschke) | 100 | Coiled breakout | `HV(6)/HV(100) < 0.50` AND (inside day OR NR4) |
| 33 | Narrow-range vs ATR | 15 | Compression | `rng(-1) / atr14(-1) <= 0.5` (tunable) |
| 34 | Multi-day tight coil | k+14 | Compression | `(max(H[-k:]) - min(L[-k:])) / atr14(-1) <= 1.5` for k = 4..10 |
| 35 | Tight closes / VCP pocket | 5..15 | Bull compression | `abs(pct_change(C, 5)) <= 4%` and 15-bar realised-volatility rank in the bottom decile |
| 36 | Outside Bar / Outside Day | 2 | Either | `H[-1] > H[-2] and L[-1] < L[-2]` |
| 37 | Bullish Outside Reversal | 2 | Bull reversal | outside bar AND `C[-1] > H[-2]` |
| 38 | Bearish Outside Reversal | 2 | Bear reversal | outside bar AND `C[-1] < L[-2]` |
| 39 | 3-Bar Play | 3 | Bull cont. | wide-range impulse bar closing in the top 20% of its range; inside bar; then `H[-1] > H[-2]` |

---

## (b) DETAILED BLOCK PER PATTERN

---

### 1 / 2. RISING THREE METHODS · FALLING THREE METHODS

**Names.** Rising Three Methods (bullish); Falling Three Methods (bearish).
Japanese: *uwa banare sanpoo hatsu oshi* is the closely-related **Upside Gap Three Methods**;
the three-methods family generically is *sanpoo* ("three methods"). Aliases: "rising three",
"bullish three method formation". TA-Lib: `CDLRISEFALL3METHODS` (both directions in one call).

**Bias.** Bullish continuation / bearish continuation.

**Prior trend: REQUIRED.** Bulkowski's identification guideline is explicit: "Price trend
leading to the pattern: Upward." TA-Lib does NOT test it. Without a trend the pattern is just
"big bar, three small bars, big bar" — which is an ordinary chop signature, not a flag.

**Executable (TA-Lib `CDLRISEFALL3METHODS`, verbatim logic):**

```python
s = color(-5)                     # +1 -> rising, -1 -> falling
# 1. colour alternation: long, 3 opposite, long
color(-5) == -color(-4) and color(-4) == color(-3) == color(-2) and color(-2) == -color(-1)
# 2. containment: ONLY a PART of each middle body must overlap bar1's HIGH-LOW range
bbot(-4) < H[-5] and btop(-4) > L[-5]
bbot(-3) < H[-5] and btop(-3) > L[-5]
bbot(-2) < H[-5] and btop(-2) > L[-5]
# 3. the three middles walk against the trend (CLOSES only; bar -4 vs -5 is unconstrained)
s*C[-3] < s*C[-4]  and  s*C[-2] < s*C[-3]
# 4. the final bar
s*O[-1] > s*C[-2]        # opens beyond the last small close
s*C[-1] > s*C[-5]        # closes beyond the FIRST candle's CLOSE (not its high)
# 5. sizes
body(-5) > avg_body(-5,10)                    # long
body(-4) < avg_body(-4,10)                    # short
body(-3) < avg_body(-3,10)
body(-2) < avg_body(-2,10)
body(-1) > avg_body(-1,10)                    # long
# output: 100*s
```

**BATTLEGROUND 1 — RANGE or BODY containment?** Four sources, four answers:

| Source | Containment test | Strictness |
|---|---|---|
| **TA-Lib** (`ta_CDLRISEFALL3METHODS.c`, comment: "a part of the real body must be within 1st range") | `bbot(k) < H[-5] and btop(k) > L[-5]` | **Loosest.** Requires only body/range *overlap*. Almost always true. |
| **Bulkowski** | "three small candles that trend lower but **close within the high-low range** of the first candle" | Only the CLOSE inside `[L(-5), H(-5)]` |
| **StockCharts ChartSchool** | "three small body days, each **fully contained within the range of the high and low** of the first day" | **Strictest.** `H[k] <= H[-5] and L[k] >= L[-5]` — whole bar, shadows included |
| **thinkorswim pattern library** | "short and, as a group, form a short-term downtrend, **closing within the first candle's body**" | Close inside `[bbot(-5), btop(-5)]` |

**RESOLUTION for our screener:** ship the StockCharts/Nison reading — every middle bar fully
inside bar 1's high-low range — and expose the loose TA-Lib reading only if you need
TA-Lib parity. Rationale: the swing-trader value of the pattern IS the tight containment.
TA-Lib's overlap test is so weak it admits pullbacks that break bar 1's low by 90%, which is
not a flag by any reading. Recommended:

```python
CONTAIN_STRICT = all(H[k] <= H[-5] and L[k] >= L[-5] for k in (-4,-3,-2))
```

**BATTLEGROUND 2 — how many middle candles?** TA-Lib's own comment says *"ideally they should
be three but two or more than three are ok too"* — and then the code **hard-codes exactly
three** ("here only patterns with 3 small candles are considered"). Nison's text (via
secondary sources) accepts 2 or more. Bulkowski, StockCharts and thinkorswim all fix it at 5
candle lines / 3 middles.
**RESOLUTION:** implement the canonical 5-bar form as `RISING_3_METHODS`, and if you want the
generalised form add a SEPARATE column value (e.g. `RISING_N_METHODS`) with an explicit
middle-count `m` in `{2,3,4,5}`. Do not silently widen the canonical name — you would break
comparability with every other tool the user cross-checks against.

**BATTLEGROUND 3 — must the middles be DOWN candles?**

- TA-Lib: **yes, all three must be black** (colour alternation is a hard condition), *plus*
  the closes must fall.
- Bulkowski: "Candles 2 and 4 are black, **but day 3 can be any color**."
- thinkorswim: no colour requirement at all — just "short" bodies forming a downtrend.

**RESOLUTION:** require falling *closes* (all sources agree the group trends against the
trend) but allow the MIDDLE of the three to be either colour, matching Bulkowski. That is
the only reading backed by measured statistics. TA-Lib's all-black rule costs you real
patterns; thinkorswim's colourless rule admits three up-candles that merely have lower
closes, which is incoherent.

**BATTLEGROUND 4 — final close threshold.** TA-Lib and Bulkowski: above the **close** of
candle 1. StockCharts: "the fifth day closes at a **new high**" (i.e. above `H[-5]`, and by
implication above the highest high of the pattern). Many web summaries say "above the high of
the first candle." The `close > C[-5]` version fires ~3× more often.
**RESOLUTION:** use `C[-1] > C[-5]` for the pattern flag (TA-Lib + Bulkowski agree, and
Bulkowski's 74% continuation statistic was measured on that definition), and expose
`C[-1] > max(H[-5..-2])` as a separate "confirmed" strength bit.

**Measured behaviour (Bulkowski, 4.7M candle lines):**

| | Rising 3 Methods | Falling 3 Methods |
|---|---|---|
| Theory | bullish continuation | bearish continuation |
| Measured | **bullish continuation 74%** | **bearish continuation 71%** |
| Sample | 102 | 64 |
| Frequency rank | 88 / 103 | 91 / 103 |
| Overall perf rank | 94 / 103 | 89 / 103 |
| Best 10-day move | -5.10% (bull mkt, down breakout) | 4.58% |

Note the split personality: the pattern *direction* is reliable (74% / 71%) but the
*performance* rank is near the bottom (94 / 89 of 103). It tells you where price goes, not
how far.

---

### 3. MAT HOLD

**Names.** Mat Hold. Aliases: "rising three methods variation", "mat-hold pattern".
TA-Lib: `CDLMATHOLD(open, high, low, close, penetration=0.5)`.
**Bullish only** in both TA-Lib and Bulkowski (TA-Lib comment: "mat hold is always bullish").
Some vendors publish a "bearish mat hold" — it is not canon and TA-Lib will never emit one.

**Prior trend: REQUIRED** — Bulkowski: "Price trend leading to the pattern: Upward."

**Executable (TA-Lib `CDLMATHOLD`, `pen = 0.5` default):**

```python
white(-5) and black(-4) and white(-1)
rb_gap_up(-4, -5)                                  # bbot(-4) > btop(-5): a REAL BODY gap up
bbot(-3) < C[-5] and bbot(-2) < C[-5]              # bars 3&4 dip into bar 1's body
bbot(-3) > C[-5] - body(-5)*pen                    # but no deeper than `pen` of bar 1's body
bbot(-2) > C[-5] - body(-5)*pen
btop(-3) < O[-4]                                   # falling body tops (bars 2..4)
btop(-2) < btop(-3)
O[-1] > C[-2]
C[-1] > max(H[-4], H[-3], H[-2])                   # above the highest REACTION-DAY high
body(-5) > avg_body(-5,10)                         # bar 1 long
body(-4) < avg_body(-4,10)                         # bars 2,3,4 short
body(-3) < avg_body(-3,10)
body(-2) < avg_body(-2,10)
# output: +100
```

Note: bars 3 and 4 (`-3`, `-2`) have **no colour constraint** in TA-Lib. Only bar 2 must be
black. Bar 5 need **not** be long (unlike rising three methods).

**⭐ THE EXACT MAT-HOLD vs RISING-THREE-METHODS DISCRIMINATOR**

The literature waffles ("mat hold looks similar" — Bulkowski). The code does not. Three hard
structural differences, in decreasing order of decisiveness:

| Discriminator | Rising Three Methods | Mat Hold |
|---|---|---|
| **① Gap between bar 1 and bar 2** | **None required.** Bar 2 is an ordinary black bar starting inside/at bar 1. | **MANDATORY real-body gap UP**: `bbot(-4) > btop(-5)`. This is the single decisive test. |
| **② Depth of the pullback** | Bodies need only OVERLAP bar 1's high-low range — the pullback may sink through most of bar 1. | Bodies must stay **within 50% of bar 1's body measured down from `C[-5]`** (`penetration`). The pullback is SHALLOW and held high — hence "hold". |
| **③ Final-bar threshold** | `C[-1] > C[-5]` — beat the first candle's close. | `C[-1] > max(H[-4],H[-3],H[-2])` — beat the highest high of the whole reaction. Strictly harder. |

Secondary: R3M requires all three middles to be the **opposite** colour and bar 5 to be
**long**; mat hold requires neither.

**One-line discriminator to code:**
```python
if rb_gap_up(-4, -5) and black(-4):   candidate is MAT_HOLD
else:                                 candidate is RISING_3_METHODS
```
**Precedence:** evaluate MAT_HOLD **first**, then RISING_3_METHODS. They are *not*
provably mutually exclusive (a bar 1 with a tall upper shadow can satisfy R3M's loose
overlap test while also gapping), so an explicit priority is required or you will
double-label. Mat hold is the more specific pattern and should win.

**BATTLEGROUND — the `penetration` parameter and the final threshold.** Three different final
thresholds in circulation:

| Source | Pullback depth limit | Bar-5 close must exceed |
|---|---|---|
| TA-Lib | `bbot(k) > C[-5] - 0.5*body(-5)` (`penetration` default **0.5**) | `max(H[-4],H[-3],H[-2])` — the three reaction days only |
| Bulkowski | "their bodies remain **above the low of the first day**" (≈ penetration measured to `L[-5]`, i.e. effectively 1.0+ and anchored on the low, not the close) | "the **high of the prior four candles**" — includes `H[-5]` |
| thinkorswim | "closing within the first candle's **body**" | "closes above the **second candle's Open** price" — far looser |

Spread: Bulkowski's rule is looser on depth but tighter on the final close; thinkorswim's is
looser on both. **RESOLUTION:** ship TA-Lib's `penetration = 0.5` (it is the only numerically
specified value and it encodes the "held" semantics) with the TA-Lib final threshold. Note
that TA-Lib's `CDLMATHOLD(..., penetration=0)` in the Python wrapper defaults the arg to
`0` at the Python layer — passing `0` makes the depth test `bbot(k) > C[-5]`, which is
*stricter* than intended and kills nearly all hits. **Always pass `penetration=0.5`
explicitly** if you call TA-Lib.

**Measured behaviour (Bulkowski):** theory bullish continuation, measured **bullish
continuation 78%**; sample 52; frequency rank 93/103; overall perf rank 86/103; best 10-day
move -7.21% (bull market, down breakout).

---

### 4 / 5. UPSIDE TASUKI GAP · DOWNSIDE TASUKI GAP

**Names.** Upside Tasuki Gap (Japanese: *uwa banare tasuki*); Downside Tasuki Gap (*shita
banare tasuki*). "Tasuki" = the cord used to tie back kimono sleeves. TA-Lib: `CDLTASUKIGAP`
(both directions).

**Bias.** Upside = bullish continuation; downside = bearish continuation.

**Prior trend: REQUIRED.** TA-Lib says so explicitly and then declines to test it: *"the user
should consider that tasuki gap is significant when it appears in a trend, while this function
does not consider it."*

**Executable (TA-Lib `CDLTASUKIGAP`, upside branch):**

```python
rb_gap_up(-2, -3)                    # bbot(-2) > btop(-3): REAL BODY gap
white(-2) and black(-1)
O[-1] < C[-2] and O[-1] > O[-2]      # bar 3 opens strictly inside bar 2's body
C[-1] < O[-2]                        # and closes below bar 2's body...
C[-1] > btop(-3)                     # ...but NOT below bar 1's body top -> GAP STAYS OPEN
abs(body(-2) - body(-1)) < 0.20 * avg_rng(-2, 5)     # "near the same" size
# output: +100
```
Downside branch: mirror every inequality (`rb_gap_down(-2,-3)`, `black(-2)`, `white(-1)`,
`O[-2] > O[-1] > C[-2]`, `C[-1] > O[-2]`, `C[-1] < bbot(-3)`), output `-100`.

**⭐ BATTLEGROUND — must the gap remain UNFILLED?**
**YES — unanimously, and it is the pattern's whole point.** Every source enforces it:
- TA-Lib: `C[-1] > max(C[-3], O[-3])` — the third candle must close *inside the gap*, above
  bar 1's body.
- StockCharts: "closes in the gap between the first two days **but does not close the gap**."
- Bulkowski: "the black candle **does not close the gap** if you ignore the shadows."
- CandleScanner: "the third candle does not close the price gap between the first and second
  lines."

**And there is a named pattern for the filled case:** if the third candle closes *through* the
gap and into bar 1's body, it is **UPSIDE GAP THREE METHODS** (`CDLXSIDEGAP3METHODS`), a
different — and per CandleScanner statistically weaker — bullish continuation pattern.
Detect and label both; never let a filled tasuki fall through as "no pattern".

**BATTLEGROUND — body gap or shadow gap?**
- **TA-Lib: real-BODY gap** (`bbot(-2) > btop(-3)`). Shadows may overlap freely.
- **CandleScanner: shadow gap** — "White body with the **low above the prior high**."
- **Bulkowski: shadow gap** — "a gap between the **shadows** of the two candles."
- StockCharts: "gapped above" — unqualified, reads as a body gap in context.

The shadow-gap reading is ~3–5× rarer on US equities. **RESOLUTION:** use the body gap for
detection (TA-Lib parity, more hits), and record `true_window = L[-2] > H[-3]` as a strength
flag. Bulkowski's 704-sample statistic was measured on the shadow-gap definition, so do not
quote his 57% against a body-gap detector without that caveat.

**⚠ TA-Lib-only condition nobody else imposes:** the near-equal-body test
`|body(-2) - body(-1)| < 0.2·avg_rng(-2,5)`. Nison, Bulkowski, StockCharts and TradingView all
omit it. It is a significant additional filter — expect it to reject roughly half the
otherwise-qualifying setups. Decide deliberately; do not inherit it by accident.

**Measured behaviour (Bulkowski, 4.7M lines):**

| | Upside Tasuki Gap | Downside Tasuki Gap |
|---|---|---|
| Theory | bullish continuation | bearish continuation |
| Measured | **bullish continuation 57%** (near random) | **BULLISH REVERSAL 54%** (i.e. it fails as a bearish continuation) |
| Sample | 704 | not stated on page (freq rank 68) |
| Frequency rank | 74 / 103 | 68 / 103 |
| Overall perf rank | **5 / 103** | 23 / 103 |
| Best 10-day move | -9.20% (bear mkt, down breakout), 10-day perf rank 2 | +4.69% (bear mkt, up breakout) |

Note the sharp asymmetry: the *upside* tasuki has a top-5 performance rank but a coin-flip
direction; the *downside* tasuki resolves against its textbook direction more often than
with it. CandleScanner's independent S&P-500 20-year test corroborates the weakness:
upside tasuki 141 occurrences, only 50.35% "high efficiency" over 10 candles; downside tasuki
164 occurrences, 40.25% over 10 candles.

---

### 6 / 7. SIDE-BY-SIDE WHITE LINES (upside gap & downside gap)

**Names.** Upside Gap Side-by-Side White Lines; Downside Gap Side-by-Side White Lines.
Aliases: "gap side-by-side white lines". TA-Lib: `CDLGAPSIDESIDEWHITE` (both).

**Bias.** Upside gap variant = **bullish** continuation. Downside gap variant = **bearish**
continuation — *even though both of its signal candles are white.* This trips people up
constantly: two white candles after a downside gap mean short-covering that failed to close
the window, so the downtrend stands.

**Prior trend: REQUIRED** — TA-Lib comment says so and does not test it.

**Executable (TA-Lib `CDLGAPSIDESIDEWHITE`):**

```python
up   = rb_gap_up(-2, -3)   and rb_gap_up(-1, -3)     # BOTH candles gap from bar 1's body
down = rb_gap_down(-2, -3) and rb_gap_down(-1, -3)
(up or down)
white(-2) and white(-1)
# bodies "near the same"
body(-1) >= body(-2) - 0.20*avg_rng(-2,5)
body(-1) <= body(-2) + 0.20*avg_rng(-2,5)
# opens "equal"
O[-1] >= O[-2] - 0.05*avg_rng(-2,5)
O[-1] <= O[-2] + 0.05*avg_rng(-2,5)
# output: +100 if up else -100
```

**Note:** TA-Lib places **no colour constraint on bar 1**. Bulkowski does: white for the
bullish variant, black for the bearish variant. Bulkowski's bearish version also requires
"the closing prices of both white candles must remain below the body of the black candle"
— an explicit "the window is not closed" test that TA-Lib gets for free from
`rb_gap_down(-1,-3)`.

Also note: the "gap does not close" condition is enforced structurally — TA-Lib requires
*both* white candles to gap from bar 1's body, so the second white candle cannot have
crawled back through the window.

**Measured behaviour (Bulkowski):**

| | Bullish (upside gap) | Bearish (downside gap) |
|---|---|---|
| Theory | bullish continuation | bearish continuation |
| Measured | **bullish continuation 66%** | **bearish continuation 56%** (near random) |
| Sample | 984 | "too small to get an accurate gauge" |
| Frequency rank | 73 / 103 | 86 / 103 |
| Overall perf rank | 46 / 103 | 29 / 103 |
| Best 10-day move | -6.07% (bear mkt, down breakout), 10-day rank 17 | +7.86% (bear mkt, up breakout) |

The bullish variant at 66% with n=984 is one of the few continuation patterns in this family
with both a decent hit rate and a usable sample. Ship it.

---

### 8 / 9. UPSIDE & DOWNSIDE GAP THREE METHODS

**Names.** Upside Gap Three Methods (*uwa banare sanpoo hatsu oshi*); Downside Gap Three
Methods. TA-Lib: `CDLXSIDEGAP3METHODS`. Part of the tasuki family — the variant where the
window IS closed.

**Bias.** Upside = bullish continuation; downside = bearish continuation.

**Executable (TA-Lib, verbatim):**

```python
color(-3) == color(-2)                     # bars 1 & 2 same colour
color(-2) == -color(-1)                    # bar 3 opposite
bbot(-2) < O[-1] < btop(-2)                # bar 3 opens STRICTLY inside bar 2's body
bbot(-3) < C[-1] < btop(-3)                # bar 3 closes STRICTLY inside bar 1's body
(white(-3) and rb_gap_up(-2,-3)) or (black(-3) and rb_gap_down(-2,-3))
# output: color(-3) * 100
```

**Discriminator vs Tasuki gap:** identical setup for bars 1–2; the difference is entirely in
bar 3's close. `C[-1]` inside the **gap** (above `btop(-3)`) ⇒ **TASUKI**. `C[-1]` inside
**bar 1's body** ⇒ **GAP THREE METHODS**. Mutually exclusive by construction.

**CandleScanner statistics (S&P 500, 20 years, 2.2M candlesticks):** 112 occurrences (0.02%
— their rarest pattern); 34.82% high efficiency over 5 candles, 48.22% over 10.
CandleScanner flags a real ambiguity: bars 2–3 alone may form a bearish reversal pattern, so
the signal is internally contradictory and needs confirmation (a close above bar 2's close).

---

### 10 / 11. THREE-LINE STRIKE (bullish & bearish) — ⭐ THE BIGGEST DISAGREEMENT

**Names.** Three-Line Strike; Bullish/Bearish Three-Line Strike. Aliases: "3-line strike",
"three-line strike reversal". TA-Lib: `CDL3LINESTRIKE`.

**Executable (TA-Lib `CDL3LINESTRIKE`, verbatim):**

```python
color(-4) == color(-3) == color(-2)          # three same-colour "soldiers"/"crows"
color(-1) == -color(-2)                      # 4th opposite
# each opens within OR NEAR the previous real body  (Near = 0.20 * avg_rng(idx,5))
bbot(-4) - 0.20*avg_rng(-4,5) <= O[-3] <= btop(-4) + 0.20*avg_rng(-4,5)
bbot(-3) - 0.20*avg_rng(-3,5) <= O[-2] <= btop(-3) + 0.20*avg_rng(-3,5)
# bullish variant (three white):
white(-2) and C[-2] > C[-3] > C[-4] and O[-1] > C[-2] and C[-1] < O[-4]
# bearish variant (three black):
black(-2) and C[-2] < C[-3] < C[-4] and O[-1] < C[-2] and C[-1] > O[-4]
# output: color(-2) * 100   -->  +100 for the THREE-WHITE variant
```

Note the fourth candle **completely erases** the three preceding bars: it closes beyond the
*open* of the first of the three.

**⭐⭐ REVERSAL OR CONTINUATION? RECORD BOTH.**

| Authority | Reading |
|---|---|
| **TA-Lib** | Signs it as **CONTINUATION**: output is `color(-2)*100`, so three white candles + a big black candle yields **+100 (bullish)**. Comment: *"3-line strike is significant when it appears in a trend **in the same direction of the first three candles**."* |
| **Classical candle theory / Nison lineage** | Continuation. The engulfing 4th candle is a one-day washout inside an intact trend. |
| **Bulkowski, measured** | **The opposite.** Bullish 3-line strike acts as a **BEARISH REVERSAL 65% of the time** (theory said bullish continuation). Bearish 3-line strike acts as a **BULLISH REVERSAL 84% of the time** (theory said bearish continuation). |

**The exact numbers (Bulkowski, 4.7M candle lines):**

| | Bullish 3-Line Strike | Bearish 3-Line Strike |
|---|---|---|
| Prior trend required | Upward | Downward |
| Theory | bullish continuation | bearish continuation |
| **Measured** | **bearish reversal 65%** | **bullish reversal 84%** |
| Sample | **69** | **85** |
| Frequency rank | 95 / 103 | 94 / 103 |
| **Overall perf rank** | **2 / 103** | **1 / 103** |
| Best 10-day move | **+16.91%** (bear mkt, up breakout) | **-8.81%** (bull mkt, down breakout) |
| % meeting price target | — | 80% (bull mkt, down breakout) |

Bulkowski's own explanation for the bullish case: *"price closes near the bottom of the
candlestick pattern and all a reversal has to do is post a close below the bottom."* That is
a mechanical artefact of where the pattern leaves price, not a market insight — and it is why
he flags the small sample: **69 and 85 patterns**, which is far too few to trust. He says so
explicitly on the bearish page: *"the statistics and conclusions may change with additional
samples."*

**RESOLUTION for the CANDLE column.** Do not pick a side and hide the other. Emit the label
with the TA-Lib sign convention (`THREE_LINE_STRIKE_BULL` for the three-white form) so the
name matches every other tool, and carry a separate metadata field recording Bulkowski's
measured reversal tendency. Concretely: **name the pattern by its shape, not by a
directional bet.** The one thing you must NOT do is emit `+1 bullish` and let a downstream
scoring model treat it as a buy signal — the only measured evidence points the other way,
however thin it is. Also weight it near zero in any aggregate score: n=69 with a frequency
rank of 95 means our 3,700-name universe will see roughly **one bullish 3-line strike every
20 trading days across the ENTIRE universe** (see §Frequency reality check).

---

### 12 / 13. BREAKAWAY (bullish & bearish) — 5 bars

**Names.** Bullish Breakaway, Bearish Breakaway. TA-Lib: `CDLBREAKAWAY`.

**⚠ Bias: this is a REVERSAL pattern, not a continuation pattern**, despite appearing on many
vendors' "continuation" lists. TA-Lib: *"breakaway is significant in a trend opposite to the
last candle."* Bulkowski: theoretical behaviour = bullish/bearish **reversal**. Included here
because it is a 5-bar pattern in our scope.

**Prior trend: REQUIRED.** Bullish breakaway needs a *downtrend*; bearish needs an *uptrend*.

**Executable (TA-Lib `CDLBREAKAWAY`, verbatim):**

```python
color(-5) == color(-4) == color(-2)      # bars 1, 2, 4 same colour; bar 3 unconstrained
color(-2) == -color(-1)                  # bar 5 opposite
body(-5) > avg_body(-5, 10)              # bar 1 long

# BULLISH branch (bar 1 black -> output +100):
black(-5)
rb_gap_down(-4, -5)                      # bar 2's body gaps below bar 1's body
H[-3] < H[-4] and L[-3] < L[-4]          # bar 3: LOWER high AND LOWER low
H[-2] < H[-3] and L[-2] < L[-3]          # bar 4: LOWER high AND LOWER low
C[-1] > O[-4] and C[-1] < C[-5]          # bar 5 closes INSIDE the body gap

# BEARISH branch (bar 1 white -> output -100): mirror all of the above.
# output: color(-1) * 100
```

**BATTLEGROUND — bar 3's requirement.** TA-Lib requires **both a lower high and a lower low**
(bullish case). Bulkowski requires only *"a candle of any color but it should have a lower
close."* TA-Lib's version is materially stricter and is a large part of why the pattern is so
rare. Bulkowski notes the guidelines are "stringent, eliminating many that might otherwise
qualify."

Also: TA-Lib requires bar 4 to be the same colour as bars 1–2, matching Bulkowski ("Day four
is a black candle with a lower close"). Both agree bar 5 must close *inside the body gap*.

**Measured behaviour (Bulkowski):**

| | Bullish Breakaway | Bearish Breakaway |
|---|---|---|
| Prior trend | Downward | Upward |
| Theory | bullish reversal | bearish reversal |
| Measured | **bullish reversal 59%** (near random) | **bearish reversal 63%** (89% in a bear market, rank 2) |
| Sample | 41 | 36 |
| Frequency rank | 97 / 103 | 98 / 103 |
| Overall perf rank | 45 / 103 | **11 / 103** |
| Best 10-day move | -5.79% (bear mkt, down breakout) | +6.66% (bull mkt, up breakout) |

Samples of 41 and 36 — treat every percentage above as anecdote, not statistic.

---

### 14. LADDER BOTTOM — 5 bars

**Names.** Ladder Bottom. Japanese lineage: *hashigo gaeshi* ("ladder reversal") is the name
usually cited, though it is not consistently attested in English sources — do not put it in
user-facing copy without verification. TA-Lib: `CDLLADDERBOTTOM`. **Bullish only.**

**Bias.** Bullish reversal. Prior trend: **downtrend REQUIRED** (TA-Lib says so, does not test).

**Executable (TA-Lib `CDLLADDERBOTTOM`, verbatim):**

```python
black(-5) and black(-4) and black(-3)
O[-5] > O[-4] > O[-3]                     # strictly lower OPENS
C[-5] > C[-4] > C[-3]                     # strictly lower CLOSES
black(-2)
upsh(-2) > 0.10 * avg_rng(-2, 10)         # bar 4 has a NON-trivial upper shadow
white(-1)
O[-1] > O[-2]                             # bar 2 is black, so O[-2] IS its body top
C[-1] > H[-2]                             # closes above bar 4's HIGH
# output: +100
```

Note `O[-1] > O[-2]`: since bar `-2` is black, its open is its body top, so this is exactly
"opens above the prior candle's body" — a body gap up.

**Disagreement:** Bulkowski requires the first three to be **tall** black candles ("The first
three days should be tall black candles"); TA-Lib imposes **no size requirement** at all.
That is a meaningful spread — adding `body(k) > avg_body(k,10)` for k in (-5,-4,-3) will cut
hits substantially and moves you toward Bulkowski's measured population.

**Measured behaviour (Bulkowski):** theory bullish reversal; measured **bullish reversal 56%**
(barely better than random); sample **451**; frequency rank 80/103; overall perf rank 41/103;
best 10-day move -7.07% (bear market, down breakout). 451 is one of the larger samples in this
family, so the 56% is comparatively trustworthy — and it says the pattern is close to noise.

---

### 15. CONCEALING BABY SWALLOW — 4 bars

**Names.** Concealing Baby Swallow. Japanese: *kotsubame tsutsumi*. TA-Lib:
`CDLCONCEALBABYSWALL`. **Bullish only** per TA-Lib.

**Bias.** Nominally bullish reversal. **Measured: bearish continuation 75%** — on a sample of
FOUR. Prior trend: downtrend required.

**Executable (TA-Lib `CDLCONCEALBABYSWALL`, verbatim):**

```python
black(-4) and black(-3) and black(-2) and black(-1)
# bars 1 & 2 are marubozu: both shadows very short
losh(-4) < 0.10*avg_rng(-4,10) and upsh(-4) < 0.10*avg_rng(-4,10)
losh(-3) < 0.10*avg_rng(-3,10) and upsh(-3) < 0.10*avg_rng(-3,10)
rb_gap_down(-2, -3)                        # bar 3's body gaps down
upsh(-2) > 0.10*avg_rng(-2,10)             # bar 3 HAS an upper shadow
H[-2] > C[-3]                              # ...that reaches into bar 2's body
H[-1] > H[-2] and L[-1] < L[-2]            # bar 4 engulfs bar 3 INCLUDING SHADOWS
# output: +100
```

**Measured behaviour (Bulkowski):** theory bullish reversal; measured **bearish continuation
75%**; sample **4 out of 4.7 million candle lines**; frequency rank **103/103 (dead last)**;
overall perf rank 101/103. Bulkowski's own verdict: *"This candlestick is probably one you can
ignore because you will see only a handful in your lifetime."* His performance rank is
depressed partly by an artefact — the measure uses four market/direction categories and this
pattern appeared in only two, so zeros were substituted in.

**RECOMMENDATION:** implement it for completeness (it is cheap), but expect **~0.003 hits per
day** across 3,700 tickers — roughly one every 4½ years. Do NOT surface any directional bias
for it; there is no statistical basis for either reading.

---

### 16–19. TWO-BAR CONTINUATION PATTERNS THE ASSIGNMENT LIST MISSES

These are canonical *continuation* patterns and belong in the CANDLE vocabulary even though
they are only 2 bars. Rules verbatim from TA-Lib.

**16. Separating Lines** (`CDLSEPARATINGLINES`) — continuation, either direction. Japanese:
*iki chigai sen*.
```python
color(-2) == -color(-1)
abs(O[-1] - O[-2]) <= 0.05 * avg_rng(-2, 5)          # SAME OPEN (Equal)
body(-1) > avg_body(-1, 10)                          # long belt-hold body
(white(-1) and losh(-1) < 0.10*avg_rng(-1,10)) or \
(black(-1) and upsh(-1) < 0.10*avg_rng(-1,10))       # no shadow on the trend side
# output: color(-1) * 100
```
TA-Lib note: *"significant when coming in a trend and the belt hold has the same direction of
the trend."*

**17. On-Neck** (`CDLONNECK`) — **bearish continuation** in a downtrend.
```python
black(-2) and body(-2) > avg_body(-2,10)
white(-1) and O[-1] < L[-2]
abs(C[-1] - L[-2]) <= 0.05 * avg_rng(-2, 5)          # closes AT the prior LOW
# output: -100
```

**18. In-Neck** (`CDLINNECK`) — bearish continuation.
```python
black(-2) and body(-2) > avg_body(-2,10)
white(-1) and O[-1] < L[-2]
C[-2] <= C[-1] <= C[-2] + 0.05*avg_rng(-2,5)         # closes just barely into the prior body
# output: -100
```

**19. Thrusting** (`CDLTHRUSTING`) — bearish continuation.
```python
black(-2) and body(-2) > avg_body(-2,10)
white(-1) and O[-1] < L[-2]
C[-1] > C[-2] + 0.05*avg_rng(-2,5)                   # further in than in-neck
C[-1] <= C[-2] + 0.5*body(-2)                        # but not past the MIDPOINT
# output: -100
```
Thrusting / in-neck / on-neck form a strict ladder by how far the white candle claws back:
`on-neck` (to the low) ⊂ `in-neck` (a hair into the body) ⊂ `thrusting` (up to the midpoint)
⊂ `piercing` (past the midpoint — a *reversal*). Implement the ladder in that order; they are
mutually exclusive by their close thresholds. TA-Lib records Nison's caveat that thrusting
"could be even bullish when coming in an uptrend or occurring twice within several days."

---

### 20. HIKKAKE — 3 bars + up to 3 confirmation bars

**Names.** Hikkake (Japanese verb 引っ掛ける *hikkakeru*, "to trick / ensnare"). Aliases —
explicitly rejected by the originator but widely used: "inside day false breakout", "fakey
pattern", "inside bar false breakout". TA-Lib: `CDLHIKKAKE`.

**Origin.** Created by **Daniel L. Chesler, CMT**, published in *Active Trader* magazine,
April 2004. The Japanese name was chosen in consultation with Yohey Arakawa, Associate
Professor of Japanese, Tokyo University of Foreign Studies. It is **not** classical Japanese
candlestick canon — it is a modern Western pattern with a Japanese name.

**Bias.** Either. TA-Lib: *"hikkake could be both a reversal or a continuation pattern"*
(unlike the modified hikkake, which is a reversal).

**Prior trend: NOT required.** This is one of the few patterns in this document that stands
without a trend — the setup is a compression + failed break, which is meaningful in any
context. That makes it far more valuable in a screener than the rare Japanese continuation
patterns.

**Executable (TA-Lib `CDLHIKKAKE`, verbatim, with the confirmation state machine):**

```python
# --- pattern bar, at index j ---
inside      = H[j-1] < H[j-2] and L[j-1] > L[j-2]        # STRICT inside bar
bull_break  = H[j]   < H[j-1] and L[j]   < L[j-1]        # bar 3 breaks DOWN  -> BULLISH
bear_break  = H[j]   > H[j-1] and L[j]   > L[j-1]        # bar 3 breaks UP    -> BEARISH
if inside and (bull_break or bear_break):
    result = +100 if bull_break else -100
    saved_high, saved_low = H[j-1], L[j-1]               # the INSIDE bar's extremes
    countdown = 3                                        # bars j+1, j+2, j+3
    emit(result)
# --- confirmation on a later bar k ---
elif countdown > 0 and ((result > 0 and C[k] > saved_high) or
                        (result < 0 and C[k] < saved_low)):
    emit(result + 100*sign(result))                      # +-200
    countdown = 0
```

**⚠ THE DIRECTION IS COUNTER-INTUITIVE AND IMPLEMENTERS GET IT BACKWARDS.**
A **BULLISH** hikkake is a **DOWNSIDE** false break: bar 3 makes a *lower high and lower low*
than the inside bar, trapping shorts, and is then confirmed by a close **above** the inside
bar's high. The trap fires against the direction of bar 3. EarnForex's independent write-up of
Chesler's rules matches TA-Lib exactly on this point:
*"Bullish Hikkake: Bar 2 has a lower low AND lower high than Bar 1 (the inside bar);
confirmation — within the next 3 bars price breaks above Bar 1's high."*

**Confirmation window: 3 bars — unanimous** (TA-Lib `cd=4` decremented at the end of the
pattern bar's own iteration ⇒ bars `j+1, j+2, j+3`; EarnForex/Chesler: "within the next 3
bars"). TA-Lib's note: *"if confirmation and a new hikkake come at the same bar, only the new
hikkake is reported."*

**For a CANDLE column classifying the NEWEST bar, you must decide which state you report:**
- newest bar completes the *setup* → `HIKKAKE_BULL_SETUP` / `HIKKAKE_BEAR_SETUP` (±100)
- newest bar *confirms* a setup from 1–3 bars ago → `HIKKAKE_BULL_CONFIRMED` (±200)
These are different tradeable states and should be different column values. A screener that
collapses them loses the entire point of the pattern.

**Trading rules (Chesler / EarnForex):** entry = stop order at the inside bar's high (bull) or
low (bear); stop-loss = bar 2's low (bull) or high (bear); targets at 1×/2×/3× the stop
distance. EarnForex's honest caveat, worth carrying: the pattern *"is far from being a
bullet-proof pattern"* — roughly half the formations in their GBP/USD daily sample never
triggered at all.

---

### 21. MODIFIED HIKKAKE — 4 bars + up to 3 confirmation bars

**Names.** Modified Hikkake. TA-Lib: `CDLHIKKAKEMOD`.
**Bias: REVERSAL** — TA-Lib is explicit that this differs from the plain hikkake:
*"modified hikkake is a reversal pattern, while hikkake could be both a reversal or a
continuation pattern, so bullish (bearish) modified hikkake is significant when appearing in a
downtrend (uptrend)."* **Prior trend: REQUIRED** (opposite to the signal).

**Executable (TA-Lib `CDLHIKKAKEMOD`, verbatim):**

```python
# --- pattern bar at index j ---
H[j-2] < H[j-3] and L[j-2] > L[j-3]      # bar 2 inside bar 1
H[j-1] < H[j-2] and L[j-1] > L[j-2]      # bar 3 inside bar 2   <-- NESTED inside bars
# BULLISH:
H[j] < H[j-1] and L[j] < L[j-1] and C[j-2] <= L[j-2] + 0.20*avg_rng(j-2, 5)
#   ^ bar 4 breaks down          ^ AND bar 2 closed NEAR ITS LOW
# BEARISH:
H[j] > H[j-1] and L[j] > L[j-1] and C[j-2] >= H[j-2] - 0.20*avg_rng(j-2, 5)
result = +100 if bull else -100
pattern_high, pattern_low = H[j-1], L[j-1]     # the THIRD bar's extremes (innermost)
# confirmation within 3 bars: C > pattern_high (bull) / C < pattern_low (bear) -> +-200
```

**Difference from plain hikkake, precisely:** (1) a second nested inside bar is required —
this is a genuine 2-bar coil, not a single inside bar; (2) the *first* inside bar must have
closed near the extreme opposite the eventual signal (`C[j-2]` near its LOW for a bullish
setup); (3) confirmation is measured against the **innermost** bar's extremes, not the outer
inside bar's. This makes the modified form materially rarer and materially tighter.

---

### 22. HIGH WAVE — 1 bar, but the CONSOLIDATION-RUN building block

**Names.** High Wave; High Wave Candle. Japanese: *takane nochiai ashi*. TA-Lib: `CDLHIGHWAVE`.

**Executable (TA-Lib `CDLHIGHWAVE`, verbatim):**
```python
body(-1) < avg_body(-1, 10)                   # short body
upsh(-1) > 2.0 * body(-1)                     # ShadowVeryLong: avgPeriod=0 -> own real body
losh(-1) > 2.0 * body(-1)
# output: color(-1)*100
```
**⚠** TA-Lib's own comment: *"outInteger is positive when white or negative when black;
**it does not mean bullish or bearish.**"* Do NOT map the sign to a direction. A high wave
is an indecision bar.

**The screener-relevant use is the RUN, not the single bar.** A cluster of high-wave bars is
the classic "market has lost its bearings" consolidation. Executable run definition:
```python
high_wave_run(k) = all(is_high_wave(i) for i in range(-k, 0))       # k >= 3
```
Also useful and cheaper: `spinning_top_run` = k consecutive bars with `body_ratio < 0.30`.

---

## (c) SOURCES DISAGREE — every numeric conflict

Ordered by how much damage getting it wrong does.

| # | Question | Positions | Numeric spread | Recommended resolution |
|---|---|---|---|---|
| **D1** | **Three-line strike: reversal or continuation?** | TA-Lib signs it as CONTINUATION (`+100` for three-white). Classical theory: continuation. **Bulkowski measured: bullish form is a BEARISH REVERSAL 65% (n=69); bearish form is a BULLISH REVERSAL 84% (n=85).** | 65% vs 0% — a total inversion. Perf rank 2 and 1 of 103; best 10-day moves +16.91% / -8.81%. | Name by SHAPE (TA-Lib convention) so it matches other tools; carry the measured reversal tendency as separate metadata; weight ≈ 0 in any aggregate score (n=69/85 is not a statistic). |
| **D2** | **Rising 3 Methods: middles inside the RANGE or the BODY, and how tightly?** | TA-Lib: body merely **overlaps** `[L₁,H₁]`. Bulkowski: **close** inside `[L₁,H₁]`. StockCharts: **whole bar** inside `[L₁,H₁]`. thinkorswim: **close** inside bar 1's **body**. | 4 distinct tests; the loosest (TA-Lib) admits pullbacks that break bar 1's low by ~90%, the strictest admits none. Hit-count ratio between extremes ≈ 5–10×. | Ship StockCharts/Nison: `H[k] <= H₁ and L[k] >= L₁` for all three middles. Expose TA-Lib's loose test only behind a `talib_parity` flag. |
| **D3** | **Rising 3 Methods: how many middle candles?** | TA-Lib **comment**: "ideally three but two or more than three are ok too". TA-Lib **code**: exactly 3. Bulkowski / StockCharts / thinkorswim: exactly 3. Nison (secondary): 2 or more. | Strictly 3 vs 2–5. | Canonical name = exactly 3. If you want the generalisation, use a DIFFERENT column value with an explicit middle count. |
| **D4** | **Rising 3 Methods: must the middles be black?** | TA-Lib: all 3 must be black (hard). Bulkowski: candles 2 and 4 black, **day 3 any colour**. thinkorswim: no colour requirement. | 3 black vs 2-of-3 black vs 0. | Bulkowski: require falling closes for all three, allow the MIDDLE one to be either colour. |
| **D5** | **Rising 3 Methods: what must bar 5 close above?** | TA-Lib + Bulkowski: `C₁` (the first candle's **close**). StockCharts: "closes at a **new high**". Web consensus: bar 1's **high**. | `C₁` fires ≈3× more than `max(H)`. | Use `C[-1] > C[-5]` for the flag (this is the definition Bulkowski's 74% was measured on); expose `C[-1] > max(H[-5:-1])` as a strength bit. |
| **D6** | **Mat hold: pullback depth limit** | TA-Lib: `penetration = 0.50` of bar 1's body, measured down from `C₁`. Bulkowski: bodies stay "above the **low** of the first day" (≈1.0+, anchored on `L₁`). thinkorswim: "within the first candle's body". | 0.5 vs ~1.0+ vs undefined. | Use TA-Lib's 0.5 — it is the only specified number and it encodes "held". **And pass it explicitly:** the TA-Lib Python wrapper's signature is `CDLMATHOLD(o,h,l,c, penetration=0)`, and `0` makes the test far stricter than the C default of 0.5. |
| **D7** | **Mat hold: bar 5 close threshold** | TA-Lib: `> max(H₂,H₃,H₄)`. Bulkowski: "> the **high of the prior four candles**" (includes `H₁`). thinkorswim: "> the **second candle's Open**". | Three different bars. thinkorswim's is dramatically looser. | TA-Lib's `max(H₂,H₃,H₄)`. |
| **D8** | **Tasuki gap: body gap or shadow gap (window)?** | TA-Lib: **body** gap (`bbot₂ > btop₁`). Bulkowski: "a gap between the **shadows**". CandleScanner: "low above the prior high" = **shadow**. StockCharts: unqualified. | Shadow gap is 3–5× rarer on US equities. | Body gap for detection (TA-Lib parity); record `true_window = L₂ > H₁` as a strength flag. **Do not quote Bulkowski's n=704 / 57% against a body-gap detector.** |
| **D9** | **Tasuki gap: must the gap stay unfilled?** | **UNANIMOUS YES.** TA-Lib enforces `C₃ > btop₁`; StockCharts "does not close the gap"; Bulkowski "does not close the gap if you ignore the shadows"; CandleScanner explicit. | No conflict. | Enforce it — and route the FILLED case to `UPSIDE/DOWNSIDE GAP THREE METHODS`, do not drop it. |
| **D10** | **Tasuki gap: near-equal body sizes?** | TA-Lib **requires** `\|body₂ - body₃\| < 0.20·avg_rng(5)`. Nison, Bulkowski, StockCharts, TradingView: silent. | Rejects roughly half of otherwise-qualifying setups. | Decide deliberately. Recommend keeping it (TA-Lib parity) but logging both counts once so you know the cost. |
| **D11** | **Breakaway: what must bar 3 do?** | TA-Lib: **lower high AND lower low** (bullish). Bulkowski: any colour, only a **lower close**. | TA-Lib's is far stricter — a large part of why n=41. | TA-Lib's H/L test. Bulkowski himself calls the guidelines "stringent". |
| **D12** | **Ladder bottom: must the first three black candles be TALL?** | Bulkowski: "**tall** black candles". TA-Lib: no size test at all. | Adding `body > avg_body(10)` × 3 cuts hits substantially. | Add the size test — it moves you onto the population Bulkowski's 451-sample 56% was measured on. |
| **D13** | **Concealing baby swallow: bullish or bearish?** | TA-Lib: always `+100` (bullish). Theory: bullish reversal. Bulkowski measured: **bearish continuation 75%** — on **n = 4**. | 75% on n=4 is not evidence of anything. | Emit no directional bias. Rank 103/103 frequency; expect ~1 hit every 4½ years on a 3,700-name universe. |
| **D14** | **Inside bar: strict or inclusive inequalities?** | Bulkowski: "lower high and higher low" (strict) and explicitly excludes a four-price doji as the second bar. TA-Lib hikkake: strict. Many retail sources: `<=` / `>=`. | On low-priced / thin US names, equal highs or lows are common; strict drops them. | Strict `<` / `>`, plus Bulkowski's four-price-doji exclusion (`O==H==L==C`). Add a `loose_inside` variant only if the user asks. |
| **D15** | **NR4/NR7: strict `<` or `<=` against the prior minimum?** | StockCharts' published scan uses `Range < 1 day ago Min(6, Range)` — **strict**. Bulkowski: "must have a **smaller** range" — strict. Retail implementations vary. | Ties are common on 1-cent-range penny names; `<=` inflates counts. | Strict `<`. Also guard `rng > 0` to exclude halted / four-price-doji bars. |
| **D16** | **Colour of a doji** | TA-Lib: `C >= O` ⇒ **WHITE**. Most narrative sources treat a doji as neither. | Silently changes every colour-alternation test. | Match TA-Lib (`>=`) for parity, and separately exclude bars with `body_ratio < 0.05` from any pattern where colour is load-bearing. |
| **D17** | **`BodyLong` vs `BodyShort` thresholds** | TA-Lib defaults make them the **same number** (`avg_body(10)`), so "long" and "short" partition all bars with no gap. Classical usage implies a visible gap. | ~55–60% of bars are "short", 40–45% "long" under TA-Lib defaults. | Keep TA-Lib defaults for parity. If you retune, retune BOTH and re-measure every pattern's hit count — do not change one side. |

### ⚠ Frequency reality check — the finding that should drive product design

Bulkowski's counts are per **4.7 million candle lines**. Our universe produces
**~3,700 new candle lines per trading day**. Expected hits per day across the ENTIRE universe:

| Pattern | Bulkowski count | **Expected hits/day on 3,700 tickers** | ≈ one every |
|---|---|---|---|
| Concealing baby swallow | 4 | **0.003** | 1,160 trading days |
| Bearish breakaway | 36 | 0.028 | 35 days |
| Bullish breakaway | 41 | 0.032 | 31 days |
| Mat hold | 52 | 0.041 | 24 days |
| Falling three methods | 64 | 0.050 | 20 days |
| Bullish three-line strike | 69 | 0.054 | 18 days |
| Bearish three-line strike | 85 | 0.067 | 15 days |
| Rising three methods | 102 | 0.080 | 12 days |
| Ladder bottom | 451 | 0.355 | 3 days |
| Upside tasuki gap | 704 | 0.554 | 2 days |
| Side-by-side white lines (bull) | 984 | **0.775** | ~1.3 days |
| — | — | — | — |
| **NR7** | — | **~500** (≈1/7 of bars) | every day, hundreds |
| **NR4** | — | **~900** (≈1/4 of bars) | every day, hundreds |
| **Inside day** | — | **~400–550** (10–15% of bars) | every day, hundreds |

StockCharts corroborates the bottom block: *"a daily scan of US stocks will often return
hundreds of stocks with NR7 days."*

**Implication:** the classical Japanese continuation family will render the CANDLE column
**empty on almost every ticker, almost every day**. Building it is still correct — it is
cheap, it is what the name promises, and rarity is exactly what makes a hit interesting — but
the *swing-trader-facing* value of this whole assignment lives in section (d). Ship both; do
not let a stakeholder judge the feature by how many rising-three-methods hits appear on
day one. And carry `sample_n` alongside every pattern so nobody builds a scoring model on
Bulkowski's n=4 and n=41 rows.

---

## (d) SWING-TRADER COMPRESSION VOCABULARY

Not classical Japanese candlestick canon. Primary source is **Toby Crabel, *Day Trading with
Short Term Price Patterns and Opening Range Breakout*, Traders Press, 1990** (out of print),
which is where NR4, NR7 and the inside-day statistics originate. Every downstream
source in this section attributes to Crabel: StockCharts ChartSchool, Bulkowski, Trading
Setups Review, Oxford Strat, and Connors & Raschke.

### D-1. Inside Bar / Inside Day

```python
def inside(i):
    return H[i] < H[i-1] and L[i] > L[i-1] and not four_price_doji(i)

def four_price_doji(i):
    return O[i] == H[i] == L[i] == C[i]
```
**Source:** Bulkowski, *Inside Days* — "the second day has a lower high and higher low... The
price bar fits inside the prior day's range." He explicitly excludes a four-price doji as the
second bar. Crabel's definition is the same.

**Bias: continuation.** Bulkowski: *"Trade with the trend since the pattern acts as a
continuation 62% of the time."*
**Statistics (Bulkowski, small-pattern set of 23):** overall rank **10/23**; average rise
10% (bull/up 11%); break-even failure rate 32% (bull, up breakout); measure-rule success 80%
(bull/up), 72% (bull/down), 74% (bear/up), 77% (bear/down); win rates 57% (bull/up), 43%
(bull/down), 46% (bear/up), 54% (bear/down).
**Trading rules (Bulkowski):** wait for a close beyond the top or bottom of the pattern; enter
at the next open; target = 2× pattern height added to the top; stop one cent below the bottom.

### D-2. Inside-bar RUN (2-bar / 3-bar inside runs)

Two distinct definitions in circulation — implement BOTH, they answer different questions:

```python
# (a) MOTHER-BAR containment: how many trailing bars are inside the same mother bar?
def inside_run_mother(i):
    m = i - 1                      # candidate mother bar
    k = 0
    while H[i-k] < H[m] and L[i-k] > L[m]:
        k += 1
        m = i - k - 1 if False else m     # mother stays fixed
    return k                        # k>=1 -> inside bar; k>=2 -> "double inside"

# (b) NESTED / COILING: each bar inside its IMMEDIATE predecessor
def coil_run(i):
    k = 0
    while H[i-k] < H[i-k-1] and L[i-k] > L[i-k-1]:
        k += 1
    return k                        # strictly monotone H down, L up
```

Definition (a) is the standard "double inside bar" / "triple inside bar" of price-action
trading: *"Multiple inside bars nested within a single Mother Bar — a double or triple inside
bar setup — indicate extreme energy coil."* Definition (b) is the stricter "coiling inside
bars" reading: *"2 or more inside bars within the same mother bar structure, each inside bar
smaller than the previous and within the high-to-low range of the previous bar."*

**Recommended column values:** `INSIDE_BAR` (k=1), `INSIDE_2` (k=2), `INSIDE_3PLUS` (k>=3),
plus a separate boolean `COILING` for definition (b). Stop placement is the whole reason
the distinction matters: with (a) the risk bar is the MOTHER bar; with (b) it is the
immediately preceding bar, which is much tighter.

### D-3. NR4 and NR7 (Crabel)

```python
NR4(i) = rng(i) > 0 and rng(i) < min(rng(i-1), rng(i-2), rng(i-3))
NR7(i) = rng(i) > 0 and rng(i) < min(rng(i-1) .. rng(i-6))
```
**Definitions (Bulkowski, verbatim):**
- NR4: *"The most recent bar must have a smaller high-low price range than the prior three
  bars (four bars, total)."*
- NR7: *"The NR7 is based on the high-low price range that is the smallest of the prior six
  days (seven days total)."*

**StockCharts' published scan syntax (verbatim) — note it is strictly `<`:**
```
[Range < 1 day ago Min (6, Range)]      # NR7
and [today's high < yesterday's high]   # (their scan also requires an inside day)
and [today's low > yesterday's low]
```

**Philosophy (StockCharts, attributing Crabel):** *"a volatility expansion often follows a
volatility contraction"* — the same premise as a Bollinger Band squeeze.

**Bulkowski's NR7 statistics** (bull market, up breakout): success rate **57%** winning
trades; failure rate **46%** (fail to move 5% in the breakout direction); average rise **7%**;
measure-rule success **43%**; performance rank **11/23** among small patterns. Trading rules:
buy/short at the open the day after a close beyond the pattern; stop 7% away or a penny beyond
the pattern extreme; average hold 14–31 calendar days.

**Bulkowski's NR4 statistics:** bull/up — failure rate 46%, average rise **7%**, win rate
**58%**, measure-rule success 55%. Bull/down — failure 48%, average drop -6%, win rate 44%.
Bear/up — failure 37%, average rise 8%. Bear/down — failure 28%, average drop **-12%**.
Overall rank **7/23** — better than NR7's 11/23.

**Time limit (Bulkowski, NR7):** the signal is abandoned if there is no breakout within
**7 CALENDAR days** (not trading days); then restart the count.

**NR7-2** (Bulkowski): *"a more potent version... It occurs when the next day is also shorter
than any of the prior seven."*
```python
NR7_2(i) = NR7(i-1) and rng(i) < min(rng(i-1) .. rng(i-7))
```

### D-4. ID/NR4 and ID/NR7 — the double compression

```python
ID_NR4(i) = inside(i) and NR4(i)
ID_NR7(i) = inside(i) and NR7(i)
```
**Source:** Crabel; popularised by Linda Bradford Raschke & Laurence Connors, *Street Smarts:
High Probability Short-Term Trading Strategies* (1995).
**Rules (Trading Setups Review, restating Crabel/Raschke):** *"Find an inside bar with the
smallest range out of the last four bars. Place a buy stop order above the high of the bar...
Place a stop-loss order at the opposite end of the ID/NR4 bar."* Cancel unfilled orders if the
next bar does not trigger.
**Bias: directionally NEUTRAL.** ID/NR4 is a *coil*, not a direction. Emitting it as bullish
or bearish is a category error — the breakout picks the side. Pair it with a separate trend
column.

### D-5. Connors/Raschke historical-volatility squeeze

From *Street Smarts* and Connors & Raschke, "Historical Volatility and Pattern Recognition",
*Technical Analysis of Stocks & Commodities* V.14:8 (338–341), August 1996:

```python
HV(n, i) = stdev(log(C/C.shift(1)), n) * sqrt(252)     # annualised
squeeze(i) = HV(6, i) / HV(100, i) < 0.50
signal(i)  = squeeze(i) and (inside(i) or NR4(i))
```
The published thresholds, verbatim: *"Historical volatility ratio of 6-period to 100-period is
less than 0.50 (50%)"*, *"Inside Range day and smallest range day out of the last 4 must
occur"*, and *"Breakouts happen above the NR4 day's high or below the low on the following
day."*
Raschke's framing: *"When the six-day historical volatility drops below half the 100-day
reading and an inside day or NR4 occurs, an explosive move is imminent."*

This is the highest-value single addition for a swing-trading screener in this entire
document: it is cheap (two stdevs), it has a published numeric threshold, and unlike the
Japanese continuation patterns it will actually return names.

### D-6. Crabel 2-Bar NR

```python
def two_bar_nr(i, lookback=20):
    r2 = lambda k: max(H[k], H[k-1]) - min(L[k], L[k-1])
    return r2(i) < min(r2(k) for k in range(i-lookback, i))
```
**Definition (Oxford Strat, restating Crabel):** *"the narrowest range from high to low of any
two day period relative to any two day period within the previous 20 market days."*
Crabel's own entry is an Opening Range Breakout: buy stop at `Open + Stretch`, sell stop at
`Open - Stretch`, where `Stretch = 2 × the 10-period average of intraday noise`. For a daily
EOD screener, substitute a break of the 2-bar range.

**Crabel's headline contraction-vs-expansion result** (cited widely from the book): cumulative
gross profits on trades in the direction of the move off the open were **$710,000 on 7,313
contraction-pattern trades** vs **$102,000 on 7,524 expansion-pattern trades** — a ~7× edge
for trading contractions over expansions. This is the empirical basis for prioritising this
whole family.

### D-7. Range-vs-ATR narrow range (scale-free, our own)

Crabel's NR4/NR7 are *rank* tests — they say "narrowest of N" but not "how narrow." On a
3,700-name universe you also want an absolute measure:
```python
narrow_vs_atr(i, f=0.5)  = rng(i) <= f * atr14(i)
coil_k(i, k, f=1.5)      = (max(H[i-k+1:i+1]) - min(L[i-k+1:i+1])) <= f * atr14(i)
```
`coil_k(i, 5, 1.5)` — five bars whose combined range is under 1.5 ATR — is a good executable
proxy for the "tight multi-day consolidation" a swing trader means by "coiling", and it is
robust where NR7 is not (NR7 fires on a quiet bar inside an otherwise wild week).

### D-8. VCP / "tight closes" (Minervini lineage)

The VCP has **no formal mathematical definition** in any source consulted — its authors
describe it illustratively. The published *screener* thresholds, which are executable:
- **Minervini "Power Play" screen:** 6-month price change **> 85%**; 15-day price change
  between **-15% and +5%**.
- **Deepvue "Tight Range" screen:** RMV (relative measured volatility) 15-day **< 10**;
  5-day percentage change between **-4% and +4%**.
- Structure (illustrative, NOT a rule): **2 to 6 contractions**, each shallower than the last
  — the commonly quoted example progression is **~18% → ~12% → ~6%**, or **15% → 10% → 5%**;
  volume dries up into each contraction and expands on the breakout.
- Daily-bar signature: *"3–5 consecutive days of extremely narrow price range with negligible
  volume."*

**Honest recommendation:** implement the *tight-range pocket* only —
`abs(pct_change(C, 5)) <= 4%` combined with `rng_atr` in the bottom decile over 15 bars —
and label it `TIGHT_RANGE`, **not** `VCP`. Claiming VCP detection from a candle column would
be overselling: the pattern is defined by multi-week contraction structure and volume, which
is out of scope for an OHLC candle classifier.

### D-9. Outside Bar / Outside Day and the Outside-Day Reversal

```python
outside(i)        = H[i] > H[i-1] and L[i] < L[i-1] and not four_price_doji(i-1)
bull_outside_rev(i) = outside(i) and C[i] > H[i-1]
bear_outside_rev(i) = outside(i) and C[i] < L[i-1]
```
**Source:** Bulkowski, *Outside Days* — *"a higher high and lower low on the second day. The
price bar fits outside the prior day's range."* He excludes a four-price doji as the FIRST
bar (note: opposite bar from the inside-day exclusion).

**Prior trend: NOT required** — Bulkowski explicitly: no required prior trend, though uptrends
precede it 53% of the time (i.e. essentially coin-flip).

**Statistics (Bulkowski):** overall rank **6/23** — the best-performing pattern in the
compression/expansion family. Bull/up: average gain **10%**, failure rate **32%**,
measure-rule success **82%**, win rate **58%**, average hold 29 days. Bull/down: average
decline **-8%**, failure rate 40%, measure-rule success 73%. Bear/up: **11%** gain, 28%
failure. Bear/down: **-16%** decline, 21% failure. Continuations outperform reversals
marginally (10% vs 9%).
**Trading rules:** enter on a close beyond the two-day range; stop a penny beyond the opposite
extreme; target = 2× pattern height.

The `bull_outside_rev` / `bear_outside_rev` variants above (close beyond the *prior* bar's
extreme) are the swing-trader "outside reversal day" and are strictly stronger than a plain
outside bar — an outside bar that closes mid-range is noise, not a signal. Emit them as
distinct column values.

### D-10. 3-Bar Play

```python
impulse = rng(-3) >= 1.5*atr14(-3) and (C[-3] - L[-3]) / rng(-3) >= 0.80   # closes top 20%
rest    = inside(-2)
go      = H[-1] > H[-2]
```
A three-bar continuation with an explicit role per bar — impulse, rest, resolution. Stop sits
just below the inside bar's low for a long. On a daily chart this is the ordinary
"gap-up day then inside day then breakout" swing entry. Mirror for shorts.

---

## PRIOR-TREND GATING — required for the whole continuation family

TA-Lib tests the prior trend for **none** of these patterns and says so, pattern by pattern
(*"the user should consider that X is significant when it appears in a trend, while this
function does not consider it"* — repeated verbatim in `CDLTASUKIGAP`, `CDL3LINESTRIKE`,
`CDLGAPSIDESIDEWHITE`, `CDLBREAKAWAY`, `CDLLADDERBOTTOM`, `CDLCONCEALBABYSWALL`,
`CDLXSIDEGAP3METHODS`, `CDLSEPARATINGLINES`, `CDLONNECK`, `CDLINNECK`, `CDLTHRUSTING`).
Bulkowski's identification guidelines, by contrast, name a required prior trend for **every
single one** of them.

**Consequence: if you ship raw TA-Lib output you are shipping patterns stripped of the
context that gives them meaning, and Bulkowski's percentages will not transfer** — his
populations were trend-gated, yours would not be.

Two executable gates, cheap and robust:

```python
# CHEAP (thinkorswim style: "trend setup = number of preceding candles to check")
def uptrend_before(start_idx, n=5):
    return C[start_idx] > C[start_idx - n]

# ROBUST — recommended
def uptrend_before(start_idx, n=20):
    sma = SMA(C, 50)
    return C[start_idx] > sma[start_idx] and sma[start_idx] > sma[start_idx - n]
```
Apply the gate to the bar **immediately preceding the pattern's first bar** (`start_idx =
i - N` where `N` is the pattern length), not to the newest bar — the newest bar is part of
the pattern and would contaminate the test.

Patterns that do **NOT** need a trend gate: `HIKKAKE` (either direction by construction),
`OUTSIDE_BAR` (Bulkowski: no required prior trend), and the entire compression family
(inside bar, NR4, NR7, ID/NR4, coils) — those are volatility states, not directional claims.

---

## (e) SOURCES

**Primary implementation source — TA-Lib C, read verbatim (not from memory):**
1. `ta_CDLRISEFALL3METHODS.c` — https://raw.githubusercontent.com/TA-Lib/ta-lib/main/src/ta_func/ta_CDLRISEFALL3METHODS.c
2. `ta_CDLMATHOLD.c` — https://raw.githubusercontent.com/TA-Lib/ta-lib/main/src/ta_func/ta_CDLMATHOLD.c
3. `ta_CDLTASUKIGAP.c` — https://raw.githubusercontent.com/TA-Lib/ta-lib/main/src/ta_func/ta_CDLTASUKIGAP.c
4. `ta_CDLGAPSIDESIDEWHITE.c` — https://raw.githubusercontent.com/TA-Lib/ta-lib/main/src/ta_func/ta_CDLGAPSIDESIDEWHITE.c
5. `ta_CDL3LINESTRIKE.c` — https://raw.githubusercontent.com/TA-Lib/ta-lib/main/src/ta_func/ta_CDL3LINESTRIKE.c
6. `ta_CDLBREAKAWAY.c` — https://raw.githubusercontent.com/TA-Lib/ta-lib/main/src/ta_func/ta_CDLBREAKAWAY.c
7. `ta_CDLLADDERBOTTOM.c` — https://raw.githubusercontent.com/TA-Lib/ta-lib/main/src/ta_func/ta_CDLLADDERBOTTOM.c
8. `ta_CDLCONCEALBABYSWALL.c` — https://raw.githubusercontent.com/TA-Lib/ta-lib/main/src/ta_func/ta_CDLCONCEALBABYSWALL.c
9. `ta_CDLHIKKAKE.c` — https://raw.githubusercontent.com/TA-Lib/ta-lib/main/src/ta_func/ta_CDLHIKKAKE.c
10. `ta_CDLHIKKAKEMOD.c` — https://raw.githubusercontent.com/TA-Lib/ta-lib/main/src/ta_func/ta_CDLHIKKAKEMOD.c
11. `ta_CDLXSIDEGAP3METHODS.c` — https://raw.githubusercontent.com/TA-Lib/ta-lib/main/src/ta_func/ta_CDLXSIDEGAP3METHODS.c
12. `ta_CDLSEPARATINGLINES.c`, `ta_CDLONNECK.c`, `ta_CDLINNECK.c`, `ta_CDLTHRUSTING.c`, `ta_CDLHIGHWAVE.c` — same directory
13. **Candle settings defaults** — `ta_global.c`, `TA_RestoreCandleDefaultSettings()` — https://raw.githubusercontent.com/TA-Lib/ta-lib/main/src/ta_common/ta_global.c
14. **Candle macros** (`TA_CANDLEAVERAGE`, `TA_CANDLERANGE`, `TA_CANDLECOLOR`, `TA_REALBODYGAPUP/DOWN`) — https://raw.githubusercontent.com/TA-Lib/ta-lib/main/src/ta_func/ta_utility.h
15. TA-Lib Python function list & signatures (incl. `penetration` defaults) — https://ta-lib.github.io/ta-lib-python/func_groups/pattern_recognition.html

**Thomas Bulkowski — thepatternsite.com (statistics, identification guidelines):**
16. Rising Three Methods — https://thepatternsite.com/Rising3Methods.html
17. Falling Three Methods — https://thepatternsite.com/Falling3Methods.html
18. Mat Hold — https://thepatternsite.com/MatHold.html
19. Upside Tasuki Gap — https://thepatternsite.com/UpsideTasukiGap.html
20. Downside Tasuki Gap — https://thepatternsite.com/DownsideTasukiGap.html
21. Bullish Three-Line Strike — https://thepatternsite.com/ThreeLineStrikeBull.html
22. Bearish Three-Line Strike — https://www.thepatternsite.com/ThreeLineStrikeBear.html
23. Bullish Side by Side White Lines — https://www.thepatternsite.com/SidebySideWhiteLinesBull.html
24. Bearish Side by Side White Lines — https://www.thepatternsite.com/SidebySideWhiteLinesBear.html
25. Bullish Breakaway — https://www.thepatternsite.com/BullBreakaway.html
26. Bearish Breakaway — https://www.thepatternsite.com/BearBreakaway.html
27. Ladder Bottom — https://www.thepatternsite.com/LadderBottom.html
28. Concealing Baby Swallow — https://www.thepatternsite.com/ConcealBaby.html
29. NR7 — https://www.thepatternsite.com/nr7.html
30. NR4 — https://thepatternsite.com/NR4.html
31. Inside Days — https://thepatternsite.com/InsideDays.html
32. Outside Days — https://thepatternsite.com/OutsideDays.html

**StockCharts ChartSchool:**
33. Candlestick Pattern Dictionary — https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/candlestick-pattern-dictionary
34. Narrow Range Day NR7 (Crabel attribution + scan syntax) — https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/narrow-range-day-nr7

**thinkorswim Learning Center pattern library (a second independent implementation):**
35. RisingThreeMethods — https://toslc.thinkorswim.com/center/reference/Patterns/candlestick-patterns-library/bullish-only/RisingThreeMethods
36. MatHold — https://toslc.thinkorswim.com/center/reference/Patterns/candlestick-patterns-library/bullish-only/MatHold

**CandleScanner (Japanese names + independent S&P-500 20-year statistics):**
37. Upside Tasuki Gap — https://www.candlescanner.com/candlestick-patterns/upside-tasuki-gap/
38. Downside Tasuki Gap — https://www.candlescanner.com/candlestick-patterns/downside-tasuki-gap/
39. Upside Gap Three Methods — https://www.candlescanner.com/candlestick-patterns/upside-gap-three-methods/

**Hikkake (Chesler lineage):**
40. EarnForex, Hikkake Chart Pattern (bar-by-bar rules, Chesler / *Active Trader* Apr 2004) — https://www.earnforex.com/guides/hikkake-chart-pattern/

**Crabel / Raschke compression lineage:**
41. Trading Setups Review, Inside Day NR4 (ID/NR4) — https://www.tradingsetupsreview.com/inside-daynr4/
42. Oxford Strat, Toby Crabel 2-Bar NR Pattern — https://oxfordstrat.com/trading-strategies/toby-crabel-narrow-range-1/
43. CryptoDataDownload, Connors/Raschke inside-day + HV-ratio strategy (HV6/HV100 < 0.50) — https://www.cryptodatadownload.com/blog/posts/inside-contraction-historical-volatility-strategy/
44. Connors & Raschke, "Historical Volatility and Pattern Recognition", *Technical Analysis of Stocks & Commodities* V.14:8 (338–341), Aug 1996 — https://traders.com/Documentation/FEEDbk_docs/1996/08/Abstracts0896/Connorsabst.html
45. Toby Crabel, *Day Trading with Short Term Price Patterns and Opening Range Breakout*, Traders Press, 1990 — **PRIMARY SOURCE for NR4/NR7/ID, out of print.** All statistics above reach us via #34, #41, #42 and Bulkowski's independent re-measurement (#29–#32); the book itself was not obtainable online. Flagged as a second-hand citation.

**VCP / tight-range screening thresholds:**
46. Deepvue, Volatility Contraction Pattern screener thresholds — https://deepvue.com/screener/volatility-contraction-pattern/

**Books referenced through secondary sources (not directly obtainable online):**
47. Steve Nison, *Japanese Candlestick Charting Techniques* — the "two or more than three
    middle candles" allowance for rising three methods, and the thrusting-in-an-uptrend
    caveat quoted inside TA-Lib's own `ta_CDLTHRUSTING.c` comment.
48. Gregory L. Morris, *Candlestick Charting Explained* — https://archive.org/details/candlestickchart0000morr_u1p9 (borrow-only; not read for this document).
49. Linda Bradford Raschke & Laurence Connors, *Street Smarts: High Probability Short-Term
    Trading Strategies*, 1995 — ID/NR4 and the HV-ratio squeeze, via #41, #43, #44.
