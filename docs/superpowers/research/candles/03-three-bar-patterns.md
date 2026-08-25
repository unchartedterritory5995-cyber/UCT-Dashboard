# Three-Bar Candlestick Patterns — Authoritative Implementation Reference
**Researcher 03 of 10 · CANDLE column · target: executable Python over `bars[-3], bars[-2], bars[-1]`**
Compiled 2026-08-24 from TA-Lib C source, Bulkowski/thepatternsite, StockCharts ChartSchool, CandleScanner, Candlesticker, Investopedia, TradingView and Nison/Morris secondary quotation. Every rule below is stated as a predicate. Numbers are quoted from the source that gives them; where sources conflict, see §C.

---

## 0. NOTATION AND NORMALIZED PRIMITIVES (use these everywhere)

Index convention: `b1 = bars[-3]` (oldest), `b2 = bars[-2]` (middle/star), `b3 = bars[-1]` (newest, the bar being classified).

```python
body(k)      = abs(k.c - k.o)
rng(k)       = k.h - k.l
body_top(k)  = max(k.o, k.c)
body_bot(k)  = min(k.o, k.c)
upper(k)     = k.h - body_top(k)
lower(k)     = body_bot(k) - k.l
white(k)     = k.c >= k.o          # TA-Lib treats c == o as WHITE (+1)
black(k)     = not white(k)
body_pct(k)  = body(k) / rng(k)    # 0..1, guard rng == 0
```

Rolling baselines. **Critical: the window EXCLUDES the bar being tested.** TA-Lib's own comment:
> `/* add the current range and subtract the first range: this is done after the pattern recognition ... that means "compare with the previous candles" (it excludes the current candle) */`

```python
avg_body(k, n=10)  = mean(body(j)  for j in the n bars strictly before k)
avg_rng(k,  n=10)  = mean(rng(j)   for j in the n bars strictly before k)
avg_shadows(k, n=10) = mean(upper(j) + lower(j) for j in the n bars strictly before k)
```

### TA-Lib `TA_SetCandleSettings` defaults — the whole numeric backbone
Source: `src/ta_common/ta_global.c`, `TA_CandleDefaultSettings[]`.

| Setting | Range type | avgPeriod | factor | Executable threshold |
|---|---|---|---|---|
| `BodyLong` | RealBody | 10 | 1.0 | `body(k) > avg_body(k,10)` |
| `BodyVeryLong` | RealBody | 10 | 3.0 | `body(k) > 3 * avg_body(k,10)` |
| `BodyShort` | RealBody | 10 | 1.0 | `body(k) <= avg_body(k,10)` |
| `BodyDoji` | HighLow | 10 | 0.1 | `body(k) <= 0.10 * avg_rng(k,10)` |
| `ShadowLong` | RealBody | **0** | 1.0 | `shadow > body(k)` ← **no averaging; the bar's OWN body** |
| `ShadowVeryLong` | RealBody | **0** | 2.0 | `shadow > 2 * body(k)` |
| `ShadowShort` | Shadows | 10 | 1.0 | `shadow < 0.5 * avg_shadows(k,10)` ← **÷2, see below** |
| `ShadowVeryShort` | HighLow | 10 | 0.1 | `shadow < 0.10 * avg_rng(k,10)` |
| `Near` | HighLow | 5 | 0.2 | `NEAR(k) = 0.20 * avg_rng(k,5)` |
| `Far` | HighLow | 5 | 0.6 | `FAR(k)  = 0.60 * avg_rng(k,5)` |
| `Equal` | HighLow | 5 | 0.05 | `EQ(k)   = 0.05 * avg_rng(k,5)` |

The `TA_CANDLEAVERAGE` macro (`src/ta_func/ta_utility.h`):
```c
#define TA_CANDLEAVERAGE(SET,SUM,IDX) \
    ( TA_CANDLEFACTOR(SET) \
        * ( TA_CANDLEAVGPERIOD(SET) != 0.0 ? SUM / TA_CANDLEAVGPERIOD(SET) : TA_CANDLERANGE(SET,IDX) ) \
        / ( TA_CANDLERANGETYPE(SET) == TA_RangeType_Shadows ? 2.0 : 1.0 ) )
```
Two traps encoded here:
1. **`avgPeriod == 0` means "use THIS bar's own range", not "use zero".** That is why `ShadowLong` = "shadow longer than this candle's own real body" and `ShadowVeryLong` = "twice its own body". Getting this wrong silently breaks advance block.
2. **`Shadows` range type is divided by 2.** `ShadowShort` is therefore *half* the average of (upper+lower), i.e. the average one-sided shadow — not the average sum.

> ⚠️ **`BodyLong` and `BodyShort` have IDENTICAL defaults** (RealBody, 10, 1.0). So under TA-Lib defaults "1st candle is long" and "3rd candle is not short" are literally the same test, and `long ⟺ not short` with no gap between the two classes. Every TA-Lib comment saying *"3rd: longer than short"* is exactly *"3rd body > avg_body(10)"*. If your library defines LONG and SHORT with a gap (e.g. long > 1.3×avg, short < 0.6×avg), TA-Lib parity breaks and your match counts will differ materially.

### Gap predicates — the single most abused distinction in this family
```python
body_gap_up(a, b)    = body_bot(a) > body_top(b)    # TA_REALBODYGAPUP
body_gap_down(a, b)  = body_top(a) < body_bot(b)    # TA_REALBODYGAPDOWN
shadow_gap_up(a, b)  = a.l > b.h                    # TA_CANDLEGAPUP   -> a true window/island
shadow_gap_down(a, b)= a.h < b.l                    # TA_CANDLEGAPDOWN
```
`shadow_gap ⇒ body_gap`, never the reverse. Nearly every disagreement in §C reduces to *which of these two a source means by "gap"*.

### Penetration (the star-family battleground), as a fraction
TA-Lib measures penetration **from the CLOSE of `b1`**, not from the midpoint. Because `b1` is by construction black (morning) or white (evening), its close IS the body extreme in the trend direction. Therefore:

```python
# morning family: b1 is black, so b1.c == body_bot(b1)
pen_up = (b3.c - b1.c) / body(b1)
# evening family: b1 is white, so b1.c == body_top(b1)
pen_dn = (b1.c - b3.c) / body(b1)
```
`pen == 0.0` → closes at b1's close. `pen == 0.5` → **exactly the midpoint of b1's body**. `pen == 1.0` → closes at b1's open.

**TA-Lib default `optInPenetration = 0.3`** (confirmed in `ta_CDLMORNINGSTAR.c`, `ta_CDLEVENINGSTAR.c`, `ta_CDLMORNINGDOJISTAR.c`, `ta_CDLEVENINGDOJISTAR.c`, `ta_CDLABANDONEDBABY.c`: `if (optInPenetration == TA_REAL_DEFAULT) optInPenetration = 0.3;`).
**Bulkowski / StockCharts / CandleScanner / TradingView / thinkorswim all say 0.5 (midpoint).** ⇒ *Set `penetration = 0.5` to get textbook behaviour.* This is a one-constant fix and it is the highest-leverage decision in this whole document. (Nison himself gives no number — see §C1.)

### The four competing normalization schemes — pick one and be consistent
Every source that quantifies anything uses a different baseline. These are not interchangeable.

| | **TA-Lib** | **TradingView Pine** | **CandleScanner** | **thinkorswim** |
|---|---|---|---|---|
| "long body" | `body > mean(body, prev 10)` | `body > ema(body, 14)` | `rng > 0.70 × ema(H−L, prev 25)` | `body > mean(body, length)` |
| "short body" | `body <= mean(body, prev 10)` | `body < ema(body, 14)` | not a long line | `body < mean(body, length) × body_factor` |
| "doji" | `body <= 0.10 × mean(H−L, prev 10)` | `body <= 0.05 × rng(bar)` | `body <= 0.03 × rng(bar)` | `body < 0.05 × mean(body, length)` |
| "very short shadow" | `shadow < 0.10 × mean(H−L, prev 10)` | `shadow < 0.05 × rng(bar)` | *"shadows do not matter"* | — |
| "long shadow" | `shadow > body(bar)` | `shadow > 2.0 × body` (`C_Factor`) | `shadow > body` | `shadow > mean(body, length) × shadow_factor` |
| baseline | **simple mean, prior N** | **EMA, includes current** | **EMA of range, prior 25** | mean body, N |

Notes that matter:
- **TA-Lib normalizes against the previous 10/5 bars (current excluded); TradingView's EMA includes the current bar.** Same rule, different answers on the bar you are classifying.
- **CandleScanner measures "long" against the full high-low RANGE, not the body** — a long-shadowed small-bodied bar can be a "long line" for them and a short body for everyone else.
- **The doji tolerance spans 3% → 10%** and the *denominator changes too* (own range vs 10-bar avg range vs avg body). This is a ~3× spread on the single most collision-prone test in the family.
- CandleScanner is explicit that their 70% is arbitrary: *"The parameter value of 70 percent was **arbitrarily chosen** … CandleScanner allows the user to change this."*

**Recommendation for a 3,700-name daily screener:** use TA-Lib's scheme (prior-N simple means, range-relative doji) as the spine — it is the only one that is fully specified for *every* pattern in this family — and add TradingView's `body <= 0.05 × rng(bar)` as an **additional** doji clause. Range-relative beats absolute across a $3-to-$900 universe; prior-N-excluding-current keeps the classification of `bars[-1]` from depending on `bars[-1]`.

### Trend context — quantified, and what actually happens without it
Every TA-Lib CDL function carries the disclaimer *"while this function does not consider the trend"*. Bulkowski's Identification Guidelines put **"Price trend leading to the pattern"** in row 2 of every single table. StockCharts is the only source that quantifies it:

> *"for a pattern to qualify as a reversal pattern, there should be a prior trend to reverse… because candlesticks are short-term, it is usually best to consider the last **1-4 weeks** of price action."*
> Tests it offers: *"trading above its **20-day exponential moving average**"*; *"Each reaction peak and trough is higher than the previous"*; *"trading above a trend line."* And: *"Some traders may prefer shorter uptrends and qualify securities that are trading above their **10-day EMA**."*

TradingView's detector exposes the same idea as a three-way input: **SMA50** · **SMA50 + SMA200** (*"stronger trends"* only) · **No detection**.

**What happens without the trend — this is the important part.** It is not that the pattern fails; it is that it *changes class*. StockCharts, verbatim:
> *"Bearish reversal patterns within a downtrend would simply confirm existing selling pressure and could be considered **continuation patterns**."*

So an untrended morning star is not a false positive — it is a **continuation** reading. Model it that way:

```python
# measured at the bar BEFORE the pattern starts, so the pattern cannot manufacture its own context
ref      = bars[-4]
down_ctx = ref.c < ema(close, 20)[-4]
up_ctx   = ref.c > ema(close, 20)[-4]

# then, per match:
#   bullish pattern + down_ctx -> "reversal"     (the textbook signal)
#   bullish pattern + up_ctx   -> "continuation" (StockCharts' reclassification)
#   neither                    -> "unconfirmed"
```
Emit the pattern either way with `trend_context ∈ {reversal, continuation, unconfirmed}`. Never silently drop untrended matches — see §D-3 for the case (soldiers vs advance block) where the trend is the *only* thing distinguishing two opposite readings of identical geometry.

**Confirmation windows** (for a follow-through column, if you add one): StockCharts — *"bullish confirmation should come within **1 to 3 days** after the pattern."* Both StockCharts and Investopedia state the star and abandoned-baby patterns are **self-confirming** (*"do not require further bullish confirmation beyond the long white candlestick on the third day"*).

---

## A. SUMMARY TABLE — every pattern, one executable line

Bias: 🟢 bullish, 🔴 bearish. Class: R = reversal, C = continuation. "Bulk." = Bulkowski's *measured* behaviour, which frequently contradicts the theory (see §D-4).

| # | Pattern | Bias / Class (theory) | Bulk. measured | One-line executable rule (TA-Lib parity unless noted) |
|---|---|---|---|---|
| 1 | Morning Star | 🟢 R | R 78%, rank 12 | `black(b1) and LONG(b1) and body_gap_down(b2,b1) and SHORT(b2) and white(b3) and body(b3)>avg_body(b3) and pen_up >= P` |
| 2 | Evening Star | 🔴 R | R 72%, rank 4 | `white(b1) and LONG(b1) and body_gap_up(b2,b1) and SHORT(b2) and black(b3) and body(b3)>avg_body(b3) and pen_dn >= P` |
| 3 | Morning Doji Star | 🟢 R | R 76%, rank 25 | Morning Star with `b2` DOJI: `body(b2) <= 0.10*avg_rng(b2,10)` |
| 4 | Evening Doji Star | 🔴 R | R 71%, rank 30 | Evening Star with `b2` DOJI |
| 5 | Abandoned Baby Bottom | 🟢 R | R 70%, rank 9, freq 92/103 | Morning Doji Star **+ `shadow_gap_down(b2,b1)` + `shadow_gap_up(b3,b2)`** |
| 6 | Abandoned Baby Top | 🔴 R | R 69%, rank 64, freq 96/103 | Evening Doji Star **+ `shadow_gap_up(b2,b1)` + `shadow_gap_down(b3,b2)`** |
| 7 | Three White Soldiers | 🟢 R | R 82%, rank 32 | 3× white, rising closes, each opens inside/near prior body, all `upper < 0.10*avg_rng`, **no body far shorter than prior (`> prior − FAR`)** |
| 8 | Three Black Crows | 🔴 R | R 78%, rank 3 | 3× black, falling closes, each opens inside prior body, all `lower < 0.10*avg_rng`; **TA-Lib also reads a 4th bar** |
| 9 | Identical Three Crows | 🔴 R | R 79%, rank 24 | 3× black, falling closes, each opens **at prior close ± EQ**, all `lower` very short |
| 10 | Three Inside Up | 🟢 R | R 65%, rank 20 | `LONG(b1)` + `b2` short body strictly inside b1 + `b3` closes **above `b1.o`** |
| 11 | Three Inside Down | 🔴 R | R 60%, rank 56 | mirror of #10, `b3` closes **below `b1.o`** |
| 12 | Three Outside Up | 🟢 R | R 75%, rank 34 | `black(b1)` + `b2` white engulfs b1's body + `b3.c > b2.c` |
| 13 | Three Outside Down | 🔴 R | R 69%, rank 39 | `white(b1)` + `b2` black engulfs b1's body + `b3.c < b2.c` |
| 14 | Tri-Star Bullish | 🟢 R | R 60%, rank 28 | 3× doji, `body_gap_down(b2,b1)`, `body_bot(b3) > body_bot(b2)` |
| 15 | Tri-Star Bearish | 🔴 R | R 52%, rank 76 | 3× doji, `body_gap_up(b2,b1)`, `body_top(b3) < body_top(b2)` |
| 16 | Advance Block | 🔴 R | **C 64%**, rank 54 | 3× white rising, opens inside/near prior, `LONG(b1)`, **weakening: body shrinks past FAR and/or upper shadows grow past SHORT_SHADOW** |
| 17 | Deliberation (Stalled) | 🔴 R | **C 77%**, rank 93 | 3× white rising, `LONG(b1) and LONG(b2)`, `upper(b2)` very short, **`body(b3) < avg_body(b3)`** riding b2's shoulder |
| 18 | Unique Three River Bottom | 🟢 R | **C(bear) 60%**, rank 60 | `LONG` black b1, black b2 harami-inside b1 with `b2.l < b1.l`, small white b3 with `b3.o > b2.l` |
| 19 | Stick Sandwich | 🟢 R | **C(bear) 62%**, rank 14 | `black(b1)`, `white(b2)` with `b2.l > b1.c`, `black(b3)` with `b3.c ≈ b1.c ± EQ` |
| 20 | Upside Gap Two Crows | 🔴 R | **C(bull) 60%**, rank 74 | `LONG` white b1, short black b2 body-gapping up, black b3 engulfing b2's body but `b3.c > b1.c` |
| 21 | Two Crows | 🔴 R | R 54%, rank 61 | `LONG` white b1, black b2 body-gapping up, black b3 opening inside b2's body and closing inside b1's body |
| 22 | Three Stars in the South | 🟢 R | R 86%, rank **103/103**, n=9 | `LONG` black b1 with long lower shadow; smaller black b2 with higher low; tiny black marubozu b3 inside b2's range |
| 23 | Upside Gap Three Methods | 🟢 C | **R(bear) 59%**, rank 27 | 2× white with a gap between, black b3 opening inside b2's body and closing inside b1's body |
| 24 | Downside Gap Three Methods | 🔴 C | **R(bull) 62%**, rank 26 | 2× black with a gap between, white b3 opening inside b2's body and closing inside b1's body |
| 25 | Upside / Downside Tasuki Gap | 🟢/🔴 C | — | gap, then opposite-colour b3 opening inside b2's body and closing **into but not through** the gap; bodies near-equal |
| 26 | Gap Side-by-Side White Lines | 🟢/🔴 C | C 66%, rank 46 | gap, then two white bodies of near-equal size with near-equal opens, gap not filled |
| 27 | Collapsing Doji Star | 🔴 R | R 63%, rank 97, n=16 | white b1, doji b2 gapping below b1's **low**, black b3 gapping below the doji's low — no shadow overlap anywhere |

Not three-bar (verified, do not put in this family): **Three-Line Strike** = 4 lines (TA-Lib `CDL3LINESTRIKE` lookback +3); **Concealing Baby Swallow** = 4 lines (Bulkowski: "Four."); **Two Black Gapping** = 2 lines (Bulkowski: "Two."); **Breakaway / Mat Hold / Rise-Fall Three Methods / Ladder Bottom** = 5 lines.

---

## B. DETAILED BLOCKS

Legend for each block: **Aliases/JP** · **Executable** · **Thresholds by source** · **Trend** · **Bias/Class**.

---

### 1–2. MORNING STAR / EVENING STAR
**Aliases / Japanese.** Morning star = *sankawa ake no myojyo* (三川明けの明星). Evening star = *sankawa yoi no myojyo* (三川宵の明星). "Three river" = *sankawa*. (CandleScanner; Candlesticker.)

**Executable (TA-Lib `CDLMORNINGSTAR`, verbatim condition):**
```c
if( TA_CANDLECOLOR(i-2) == -1 &&                                          /* black */
    TA_CANDLECOLOR(i) == 1 &&                                             /* white real body */
    TA_REALBODYGAPDOWN(i-1, i-2) &&                                       /* gapping down */
    inClose[i] > fma(fabs(inClose[i-2]-inOpen[i-2]), optInPenetration, inClose[i-2]) &&
    fabs(inClose[i-2]-inOpen[i-2]) > TA_CANDLEAVERAGE(BodyLong,...,i-2) &&   /* 1st: long  */
    fabs(inClose[i-1]-inOpen[i-1]) <= TA_CANDLEAVERAGE(BodyShort,...,i-1) && /* 2nd: short */
    fabs(inClose[i]-inOpen[i]) > TA_CANDLEAVERAGE(BodyShort,...,i) )         /* 3rd: not short */
```
Note `fma(a,b,c) == a*b + c`, so the penetration line is `b3.c > b1.c + body(b1)*P`.

```python
def morning_star(b1, b2, b3, P=0.5):
    return (black(b1) and body(b1) > avg_body(b1, 10)
            and body(b2) <= avg_body(b2, 10)          # "short"; SEE doji variant
            and body_top(b2) < body_bot(b1)           # BODY gap down
            and white(b3) and body(b3) > avg_body(b3, 10)
            and (b3.c - b1.c) / body(b1) >= P)
```
Evening star is the exact mirror: `white(b1)`, `body_gap_up(b2,b1)`, `black(b3)`, `(b1.c - b3.c)/body(b1) >= P`.

**Thresholds by source — the two live battlegrounds.**

*(a) How far must `b3` close into `b1`'s body?*

| Source | Requirement (verbatim) | As a fraction | Anchor |
|---|---|---|---|
| **TA-Lib** (default) | `close[i] > close[i-2] + body1 * 0.3` | **0.30** | b1's **close** |
| **Bulkowski** | "closes at least midway into the body of the first day" | **0.50** | b1's body midpoint |
| **StockCharts** (dictionary) | "closed above the midpoint of the body of the first day" | **0.50** | b1's body midpoint |
| **CandleScanner** | "the candle closes at least halfway up the body of the first line" | **0.50** | b1's body midpoint |
| **TradingView** (docs + Pine) | `C_BodyHi >= C_BodyMiddle[2]` | **0.50** | b1's body midpoint |
| **thinkorswim** | "its Close price is higher than the first candle's midpoint" | **0.50** | b1's body midpoint |
| **Nison** (candlecharts.com, verbatim) | "a white candlestick that **closes well into the first session's black real body**" | **no number given** | — |
| **Nison, as rendered by 2° sources** | ≥50%, "ideally beyond two thirds" / "preferably regaining 75%" | 0.50, pref. 0.66–0.75 | — |
| **candlesticker.com** | "must reach the **midpoint between the first day's opening price and the second day's lowest point**" | **different formula entirely** | spans b1.o → **b2.l** |
| **Investopedia** | no penetration rule; "closes near the middle of the first day" | qualitative | — |
| **StockCharts** (ChartSchool prose page) | "3. A long white candlestick." — **no penetration rule at all** | **0.00** | — |

⇒ Ship `P = 0.5`. **Six independent sources converge on the midpoint**; TA-Lib's 0.3 is the lone outlier and TA-Lib exposes it as a parameter precisely because it is not canonical. Surface `penetration_pct` on the match so a strict screen can demand 0.66. Ignore candlesticker's anchor — a threshold that depends on `b2.l` makes the rule sensitive to the star's shadow, which no other source intends.

*(b) Must there be a real GAP, and on which sides?*

| Source | Gap b1→b2 | Gap b2→b3 | Kind |
|---|---|---|---|
| **Nison** (candlecharts.com, verbatim) | **required** — "a small real body … that **gaps lower to form a star**" | **not mentioned** | real **BODY** gap ("gaps above the first real **body**") |
| **TA-Lib** | **required** | **not required** | BODY gap |
| **Bulkowski** (Morning Star) | required ("gaps below the prior body") | **required** ("gaps above the body of the second candle") | BODY gap ("ignore the shadows" — explicit on Evening Star) |
| **StockCharts** dictionary | required ("gapped down on the open") | **required** ("gapped up on the open") | open-based |
| **StockCharts** ChartSchool prose | required ("gaps below the close of the previous candlestick") | **not required** | close-based; note the "(body)" parenthetical on the Evening Star page — StockCharts disambiguating to BODY gap |
| **CandleScanner** | **required** ("there needs to be a gap between the first and the second body") | **not required** ("Some sources do not require a gap between the second and the third body") | BODY gap |
| **TradingView** (docs + Pine) | **required** (`C_BodyHi[1] < C_BodyLo[2]`) | **required** (`C_BodyHi[1] < C_BodyLo`) | BODY gap |
| **thinkorswim** | required ("gaps down from the first one") | **not required** | BODY gap |
| **Investopedia** | **not required** — no gap language at all | not required | — |
| **candlesticker.com** | required ("gaps in the direction of the downtrend") | **not required** ("does not explicitly require a gap on the downside") | — |

**Nison's actual position, settled.** His own site, verbatim: *"the second is a small real body (white or black) that **gaps lower to form a star**, and the third is a white candlestick that **closes well into the first session's black real body**."* So **Nison requires exactly one gap — the left one — because the gap is what makes the middle bar a star at all.** He specifies no right-side gap and no number. The common claim that "Nison requires gaps on both sides, western practice drops them" is **half wrong**: the two-sided requirement comes from **Bulkowski, StockCharts' dictionary, and TradingView**, not from Nison. What western practice actually drops is the *left* gap (Investopedia), and Nison himself is quoted as saying *"the lack of gaps … does not vitiate the power of this formation."*

**Explicit modern-relaxation statements (verbatim), for the record:**
- Investopedia: *"**Some traders allow for slight variation. There may be more than one doji, or gaps may not be present after the first or second candle.** But the overall psychology of the pattern should still be present."*
- Investopedia: *"**The evening star and morning star formations do not require the middle candle to be a doji, or to have gaps on either side.**"*
- StockCharts (general principle): *"A gap up would enhance the robustness … but **the essence of the reversal should not be lost without the gap**."*
- Practical: in 24h markets (FX, crypto) opening gaps essentially never occur, which is why every FX-oriented rendering drops them.

⇒ **Recommended:** require `body_gap_down(b2, b1)` — 9 of 10 sources including Nison, and it is what makes the middle bar a *star* (StockCharts: *"A candlestick that gaps away from the previous candlestick is said to be in **star position**"*). Do **not** require the second gap; expose it as `star_isolated: bool`. Requiring both gaps on US daily equities cuts the match count by roughly an order of magnitude and pushes you toward abandoned-baby frequency (293 in 4.7M candle lines).

*(c) TradingView's extra upper bound — nobody else has it.* The Pine source adds `C_BodyHi < C_BodyHi[2]`, i.e. **candle 3 must close BELOW candle 1's open**:
```pinescript
if C_LongBody[2] and C_SmallBody[1] and C_LongBody
    if C_DownTrend and C_BlackBody[2] and C_BodyHi[1] < C_BodyLo[2] and C_WhiteBody
       and C_BodyHi >= C_BodyMiddle[2] and C_BodyHi < C_BodyHi[2] and C_BodyHi[1] < C_BodyLo
        C_MorningStarBullish := true
```
This excludes the case where `b3` fully recovers `b1` — TradingView treats a full round-trip as *not* a morning star. **Do not adopt it.** A third candle that closes above `b1`'s open is the *strongest* version of the signal, and excluding it would silently drop the best instances. Worth knowing because it explains why TradingView's counts differ from everyone's.

**Trend.** Down (morning) / up (evening). TA-Lib: *"the user should consider that a morning star is significant when it appears in a downtrend, while this function does not consider the trend."* Without trend context a morning star inside an uptrend is just a pullback-and-resume — it is not a reversal signal and should not be labelled one.

**Bias / class.** Morning 🟢 reversal; Evening 🔴 reversal. TA-Lib emits +100 / −100 unconditionally.

---

### 3–4. MORNING DOJI STAR / EVENING DOJI STAR
**Aliases / JP.** *Ake no myojyo doji bike* / *yoi no myojyo doji bike*.

**Executable.** Identical to #1/#2 with the middle-bar test swapped:
```python
body(b2) <= 0.10 * avg_rng(b2, 10)      # BodyDoji  (NOT BodyShort)
```
TA-Lib `CDLMORNINGDOJISTAR` / `CDLEVENINGDOJISTAR` are byte-for-byte the star functions except `TA_CANDLEAVERAGE(BodyDoji,...)` replaces `TA_CANDLEAVERAGE(BodyShort,...)` for `i-1`. Same `optInPenetration = 0.3` default.

> ⚠️ **Doji does NOT strictly imply short.** `BodyDoji` = 0.10 × avg *range*; `BodyShort` = 1.00 × avg *body*. On US equities avg body ≈ 0.45–0.6 × avg range, so a doji is short ~always — but not by construction. If you implement "morning doji star ⊂ morning star" as an assertion, it will fire on low-volatility names. Test both independently and let the containment fall out.

**Thresholds by source.** Doji tolerance is the whole disagreement, and it is a **3× spread on two different denominators**:

| Source | Doji test | Denominator |
|---|---|---|
| **TA-Lib** | `body <= 0.10 * mean(H−L, prev 10)` | 10-bar avg **range** |
| **TradingView Pine** | `C_Body <= C_Range * 5.0/100` | the bar's **own range** |
| **CandleScanner** | *"we allow small doji body (**up to 3% of the overall candle height**)"* | the bar's **own range** |
| **thinkorswim** | *"If the body height of a candle is **less than 5% of this average**, it is considered a Doji"* | avg **body** height |
| **Bulkowski** | *"opening and closing prices are **within pennies** of each other"* | absolute |
| **StockCharts** | *"open and close … are **virtually equal**"* | qualitative |

TradingView additionally requires shadow symmetry for a true doji: `C_ShadowEquals` (`C_ShadowEqualsPercent = 100.0`), i.e. `C_Doji = C_IsDojiBody and C_ShadowEquals`.

⇒ An absolute "pennies" rule is meaningless across a $3 and a $900 stock. Use **both** a range-relative-to-recent and a range-relative-to-self clause:
```python
doji(b) = body(b) <= 0.10 * avg_rng(b,10) and body(b) <= 0.05 * rng(b)
```
The second clause stops a doji-by-10-bar-average from being declared on a bar that is itself a wide-range strong body — the single most common false doji on gap days.

**CandleScanner's structural discriminator (worth stealing).** Their Morning Doji Star page adds a clause that *positively excludes* abandoned baby: candle 2 must have *"the **high price above the previous candle low price**"*. Their note: *"If the doji's lower shadow drops below both the first and second candles' shadows, it becomes a **Bullish Abandoned Baby** pattern instead."* That is exactly the mutual-exclusion rule you want if you prefer disjoint labels over a containment ranking — see §D-1/D-2 for the alternative.

**Bulkowski measured.** Morning doji star: bullish reversal **76%**, rank 25, freq 78. Evening doji star: bearish reversal **71%**, rank 30, freq 81. Both outperform their plain-star cousins on reversal rate — the doji middle really does carry information.

**Trend / bias.** Down→🟢 R; Up→🔴 R.

---

### 5–6. ABANDONED BABY (BULLISH / BEARISH)
**Aliases / JP.** *Sute go* (捨て子, "abandoned child"). Bullish = abandoned baby bottom; bearish = abandoned baby top. Western analogue: island reversal.

**Executable (TA-Lib `CDLABANDONEDBABY`, bullish branch):**
```c
fabs(C[i-2]-O[i-2]) > BodyLong(i-2) &&                      /* 1st: long          */
fabs(C[i-1]-O[i-1]) <= BodyDoji(i-1) &&                     /* 2nd: doji          */
fabs(C[i]-O[i])   > BodyShort(i)   &&                       /* 3rd: not short     */
TA_CANDLECOLOR(i-2) == -1 && TA_CANDLECOLOR(i) == 1 &&
C[i] > fma(fabs(C[i-2]-O[i-2]), optInPenetration, C[i-2]) &&
(inHigh[i-1] < inLow[i-2]) &&                               /* SHADOW gap down    */
(inLow[i]    > inHigh[i-1])                                 /* SHADOW gap up      */
```

**Q: does the gap have to be a SHADOW gap (a true island)? — YES. Unanimous.**
- TA-Lib comment: *"upside (downside) gap between the first candle and the doji **(the shadows of the two candles don't touch)**"*, implemented as `TA_CANDLEGAPUP/DOWN`, i.e. `low > high` / `high < low`.
- StockCharts dictionary: *"The shadows on the Doji must **completely gap** below or above the shadows of the first and third day."*
- StockCharts ChartSchool: *"A doji that gaps below the **low** of the previous candlestick"* … *"A long white candlestick that gaps above the **high** of the doji."*
- Bulkowski (bullish): *"a doji should appear that gaps below the two adjacent candle **shadows**"*; (bearish): *"a doji whose **lower shadow** remains above the prior candle's **high**"*.
- CandleScanner: island, no shadow contact.

Cross-checks: **TradingView Pine** — `low[2] > high[1] and high[1] < low` (true shadow gaps, and note it applies **no penetration test at all**). **CandleScanner** — *"the doji candle gaps below the shadows of the candle lines on either side"*, also with **no penetration requirement**. **thinkorswim** and **Investopedia** agree. So TA-Lib is the *only* source that additionally demands a 0.3 penetration on the third bar; everyone else considers the two island gaps sufficient.

**How rare does that make it?** This is the point of the question, and the numbers are stark:
- Bulkowski, bullish: **293 instances in 4.7 million candle lines** ≈ **0.006%**; frequency rank **92 of 103**.
- Bulkowski, bearish: frequency rank **96 of 103**; he warns *"some of the statistics use fewer than 20 samples."*
- Investopedia, bearish: *"approximately **50 times over the past two decades on S&P 500 stocks**."* — i.e. ~2.5/year across 500 names.
- On a 3,700-ticker daily universe you should expect roughly **0 to 1 abandoned babies on a typical day**, and long stretches of zero. A CANDLE column that reports abandoned babies daily is broken.
⇒ Ship it, but treat the daily count as a **canary**: if this fires more than ~2×/day across 3,700 names, your gap predicate has degraded from shadow-gap to body-gap.

**Performance.** Bullish: reversal **70%**, overall rank **9**, and rank **1** for bear-market down breakouts. Bearish: reversal **69%**, but overall rank only **64** — the bullish side is by far the better signal. Investopedia adds a forward base rate for the bearish version: *"price trends lower over the next 20 days about **65%** of the time, with a **median return of −3.00%**."*

**Naming provenance.** Investopedia: *"**Steve Nison is credited with first publishing this name in the popular press in 1991**."* Japanese *sute go* (捨て子).

**⚠️ Relaxation warning.** Investopedia explicitly sanctions dropping the very thing that defines the pattern: *"the doji **may not gap below the close of the first candle**, instead opening near the prior close and staying there. Sometimes there are two or three dojis before the price makes its upward move. This would be acceptable to some traders."* **Do not implement that.** A no-gap abandoned baby is a morning doji star, and conflating them destroys the only signal that distinguishes a 0.006%-frequency pattern from a 1-in-10,000 one.

**Containment.** Abandoned Baby ⊂ Morning/Evening Doji Star (proof in §D-1). Rank it strictly above.

**Trend / bias.** Down→🟢 R; Up→🔴 R. StockCharts: *"Further bullish confirmation is not required"* — this is one of the few patterns the sources treat as self-confirming.

---

### 7. THREE WHITE SOLDIERS
**Aliases / JP.** *Aka sanpei* (赤三兵, "three red soldiers"); *sanpei*. Also "three advancing white soldiers", "three marching soldiers".

**Executable (TA-Lib `CDL3WHITESOLDIERS`, verbatim structure):**
```python
def three_white_soldiers(b1, b2, b3):
    return (
      white(b1) and white(b2) and white(b3)
      # (1) no / very short upper shadow on ALL THREE
      and upper(b1) < 0.10*avg_rng(b1,10)
      and upper(b2) < 0.10*avg_rng(b2,10)
      and upper(b3) < 0.10*avg_rng(b3,10)
      # (2) consecutively higher closes
      and b3.c > b2.c and b2.c > b1.c
      # (3) each opens WITHIN OR NEAR the previous white body
      and b2.o > b1.o and b2.o <= b1.c + NEAR(b1)
      and b3.o > b2.o and b3.o <= b2.c + NEAR(b2)
      # (4) NOT FAR SHORTER than the prior candle  <-- the advance-block discriminator
      and body(b2) > body(b1) - FAR(b1)
      and body(b3) > body(b2) - FAR(b2)
      # (5) 3rd body not short
      and body(b3) > avg_body(b3,10)
    )
```

**Q: how much may each open pull back into the prior body?**
The TA-Lib rule is a **two-sided sandwich**, and both sides matter:
- **Lower bound:** `open[k] > open[k-1]`. The open may pull back arbitrarily deep into the prior body — down to (but not past) the prior *open*. So a pullback of up to **100% of the prior body** is legal.
- **Upper bound:** `open[k] <= close[k-1] + NEAR(k-1)` where `NEAR = 0.20 * avg_rng(5)`. So the open may also gap *above* the prior close by up to 20% of the recent average range. That is the "**or near**" in *"opens within or near the previous white real body."*

Source spread on the same question:
- **Bulkowski:** *"bodies that overlap (an opening price within the prior candle's body)"* — within only, no "near" allowance, no upper tolerance.
- **StockCharts:** *"Each should open within the previous body, and the close should be near the high of the day."*
- **CandleScanner:** *"opening price within the previous candle's body and closing price above the previous close."* Allowed candle types: *"Long White Candle, White Candle, White Marubozu, Opening White Marubozu and Closing White Marubozu"* — doji and spinning tops **prohibited**.
- **TradingView Pine:** `open < close[1] and open > open[1]` — strictly inside the prior body, **no `+NEAR` tolerance**.
- **TA-Lib:** within-or-near as above, ±NEAR.
- **Morris (via Wikipedia):** *"each should open above the previous day's open, **ideally in the middle price range of that previous day**"* — a *preference* for a shallower pullback than TA-Lib allows.
- **CandleScanner, on the historical stricter rule they deliberately dropped:** *"In the past, some authors required that the opening price of the second and the third line should be located **at least halfway up** of the previous candle's body height."*

⇒ TA-Lib's `+NEAR` is a genuine relaxation that admits small gap-ups; TradingView rejects them. It is defensible (a gap-up soldier is *more* bullish, not less). Expose it as a flag; default to allowing it. If you want Morris's stricter reading, add `open[k] >= body_mid(k-1)`.

**Q: how large may the upper shadows be before it becomes advance block / deliberation?**

| Source | Max upper shadow, all three bars |
|---|---|
| **TA-Lib** | `upper(k) < 0.10 * avg_rng(k, 10)` (`ShadowVeryShort`) |
| **TradingView Pine** | `C_Range * 5.0/100 > C_UpShadow` — **5% of that bar's own high-low range** |
| **Bulkowski / StockCharts** | qualitative — "close near the high of the day" |
| **Investopedia** | *"These candlesticks should **not have very long shadows**"* |
| **CandleScanner** | **no shadow rule** — they explicitly dropped it: *"Others required that the closing prices shall be located near the candle's high, that is that the candles should have **very short shadows**"* (listed among relaxed historical variants) |

This is the shadow half of the three-way discriminator. Use TA-Lib's `0.10 * avg_rng(10)`; it is the version that is expressed in the same units as the advance-block test it has to be compared against.

**Q: body size?** TA-Lib encodes the doctrinal split in a comment: *"**Greg Morris wants them to be long, Steve Nison doesn't**; anyway they should not be short."* Implemented as `body(b3) > avg_body(b3,10)` (not-short) with the note *"if you want them to be long use TA_SetCandleSettings on BodyShort."* Bulkowski, StockCharts, TradingView (`C_LongBody and C_LongBody[1] and C_LongBody[2]`), thinkorswim and CandleScanner all say **long/tall**, i.e. they side with Morris 5-to-1.
⇒ Offer a `require_long_bodies` flag. With TA-Lib defaults `long == not short` (§0), so the flag only bites once you widen the LONG threshold — at which point default it **on**, since that is the 5-source majority.

**⚠️ Q: what must each candle CLOSE above? Three incompatible rules are in live use.**

| Source | Third-candle close rule |
|---|---|
| **TA-Lib / TradingView / thinkorswim / CandleScanner** | `close[k] > close[k-1]` — above the **prior close** |
| **Investopedia** (opening definition) | *"a **close that exceeds the previous candle's high**"* |
| **Investopedia** (its own comparison section, two screens later) | *"the **close occurs above the previous candlestick's close**"* |
| **StockCharts / Bulkowski** | *"close should be near the **high of the day**"* — a statement about the bar itself, not about the prior bar |

Investopedia contradicts itself on the same page. **Use `close[k] > close[k-1]`** (4 sources, and it is what "consecutively higher closes" means everywhere else). The "exceeds the previous candle's **high**" reading is dramatically stricter — combined with the very-short-upper-shadow rule it approximates requiring each bar to gap up, and will cut hit rate by roughly an order of magnitude.

**Trend.** Down (it is a bottom reversal). TA-Lib: *"significant when it appears in downtrend."* Bulkowski: *"Price trend leading to the pattern: Downward."*
⚠️ Three white soldiers appearing *after* a long advance is the classic exhaustion trap — that is precisely the configuration the Japanese literature calls advance block. Without trend context you will mislabel exhaustion as accumulation.

**Bias / class.** 🟢 reversal. Bulkowski measured: **bullish reversal 82%** (the highest reversal rate in this family), overall rank 32, freq 67.

---

### 8. THREE BLACK CROWS
**Aliases / JP.** *Sanba garasu* (三羽烏, "three-winged crows"); also *sanba garasu*.

**Executable — and TA-Lib reads a FOURTH bar. This is a real gotcha.**
```c
/* ta_CDL3BLACKCROWS.c — lookback is +3, not +2 */
TA_CANDLECOLOR(i-3) == 1 &&          /* a WHITE candle BEFORE the three crows */
TA_CANDLECOLOR(i-2) == -1 && TA_CANDLECOLOR(i-1) == -1 && TA_CANDLECOLOR(i) == -1 &&
inOpen[i-1] < inOpen[i-2] && inOpen[i-1] > inClose[i-2] &&   /* 2nd opens within 1st black body */
inOpen[i]   < inOpen[i-1] && inOpen[i]   > inClose[i-1] &&   /* 3rd opens within 2nd black body */
inHigh[i-3] > inClose[i-2] &&                                /* 1st black closes under prior high */
inClose[i-2] > inClose[i-1] && inClose[i-1] > inClose[i] &&  /* three declining */
lower(i-2) < ShadowVeryShort && lower(i-1) < ShadowVeryShort && lower(i) < ShadowVeryShort
```
I verified the lookback directly: `CDL3BLACKCROWS` returns `+ 3`, whereas `CDLIDENTICAL3CROWS`, `CDLMORNINGSTAR`, `CDL3WHITESOLDIERS`, `CDLTASUKIGAP`, `CDLGAPSIDESIDEWHITE`, `CDLSTICKSANDWICH` and `CDLTRISTAR` all return `+ 2`. **If your engine slices exactly three bars for the whole family, three black crows will silently diverge from TA-Lib.** Either pass 4 bars or drop the `inHigh[i-3] > inClose[i-2]` clause and document the divergence.

Note the asymmetry: three black crows requires each open **strictly inside** the prior body (`> close`, `< open`), with **no `+NEAR` tolerance** — unlike three white soldiers, which grants `+NEAR`. TA-Lib is not symmetric here.

**Thresholds by source.**
- TA-Lib: shadows — *"each candle must have no or very short **lower** shadow"* (`< 0.10*avg_rng(10)`); **no body-length requirement at all**.
- Bulkowski: *"three **tall** black candles … Candles 2 and 3 should open within the body of the prior candle, and all three should close near their lows, making new lows along the way."*
- StockCharts: *"three consecutive **long** black bodies where each day closes at or near its low and opens within the body of the previous day."*
- CandleScanner: *"three black candles appearing as **long lines**, each closing at a new low"*, and explicitly notes the historical stricter rules — *"such as candles opening halfway down the prior candle or very short lower shadows"* — are *"nowadays … rejected by most of the traders."*
- Investopedia: *"long, real bodies and **short, or nonexistent, shadows**. **If the shadows are stretching out**, then it may simply indicate a minor shift in momentum."*
- TradingView Pine: `C_3BCrw_ShadowPercent = 5.0` on the **lower** shadow — `C_Range * 5.0/100 > C_DnShadow`, plus `C_LongBody` on all three.
- thinkorswim: *"all the three candles are long and bearish; Each candle's Open price is within the previous candle's body; Each candle's Close price is lower than that of the previous candle."*

⇒ **TA-Lib and the narrative sources disagree in opposite directions**: TA-Lib demands very short lower shadows but **no long bodies**; Bulkowski/StockCharts/Investopedia/TradingView/thinkorswim/CandleScanner all demand **long bodies**. On shadows, only CandleScanner drops the rule. Recommend: require **long bodies** (`body(k) > avg_body(k,10)` on all three — 6-to-1 majority, TA-Lib is the sole outlier) **and** keep the very-short-lower-shadow rule, because "closes at or near its low" (StockCharts) and "very short lower shadow" (TA-Lib) are the same statement said twice.

**Trend / bias.** Up. 🔴 reversal. Bulkowski measured: bearish reversal **78%**, **overall rank 3 of 103** — one of the strongest patterns in the entire encyclopedia. Worth ranking highly in the CANDLE column.

---

### 9. IDENTICAL THREE CROWS
**Aliases / JP.** *Doji sanba garasu* (同事三羽烏) — "doji" here means *identical/same*, **not** a doji candle. Do not let the name leak into your doji test.

**Executable (TA-Lib `CDLIDENTICAL3CROWS`, 3 bars only):**
```python
black(b1) and black(b2) and black(b3)
and lower(b1) < 0.10*avg_rng(b1,10)
and lower(b2) < 0.10*avg_rng(b2,10)
and lower(b3) < 0.10*avg_rng(b3,10)
and b1.c > b2.c and b2.c > b3.c                     # three declining
and abs(b2.o - b1.c) <= EQ(b1)                      # opens AT the prior close
and abs(b3.o - b2.c) <= EQ(b2)                      # EQ = 0.05 * avg_rng(5)
```
The single discriminator vs three black crows: **three black crows opens *inside* the prior body; identical three crows opens *at* the prior close (±EQ).** Structurally identical three crows is the degenerate boundary case of three black crows where the pullback into the prior body goes to zero.

**Thresholds by source.**
- TA-Lib: *"each candle after the first must open **at or very close to** the prior candle's close"*, tolerance = `Equal` = **5% of avg_rng(5)**. This is the only source that quantifies "very close".
- Bulkowski: *"three tall black candles, the last two opening near the prior candle's close. **Some sources require each candle to be similar in size, but this one is rare enough without that restriction.**"* — explicit rejection of an equal-body-size rule.
- CandleScanner: *"opening at or near the prior close"*, tolerance unquantified; rarity **0.01% of S&P 500 bars over 20 years**.

**Bulkowski measured.** Bearish reversal **79%**, overall rank **24**, frequency rank **83**, n = 921 (he flags this as under his 20,000-sample preference).

**Containment.** Under TA-Lib's own definitions these two are **mutually exclusive**, not nested: three black crows needs `open[k] < open[k-1] AND open[k] > close[k-1]` (strictly inside), identical three crows needs `open[k] ≈ close[k-1]`. Since `EQ > 0` the boundary can overlap by a hair; rank identical three crows **above** three black crows and short-circuit.

**Trend / bias.** Up. 🔴 reversal.

---

### 10–11. THREE INSIDE UP / THREE INSIDE DOWN
**Aliases / JP.** Harami + confirmation. Created by **Greg Morris** — Bulkowski: *"a bullish harami with a confirming candle as the third day, according to Morris who created this candle pattern."* CandleScanner concurs: *"introduced by Gregory Morris as an extension of the Bullish Harami, confirming that pattern."* Japanese base name *harami* (はらみ, "pregnant").

**Executable (TA-Lib `CDL3INSIDE`, both directions in one function):**
```python
inside   = (body_top(b2) < body_top(b1)) and (body_bot(b2) > body_bot(b1))   # STRICT both ends
long1    = body(b1) > avg_body(b1,10)
short2   = body(b2) <= avg_body(b2,10)
up       = white(b1) is False and white(b3) and b3.c > b1.o     # b1 black -> THREE INSIDE UP
down     = white(b1) and black(b3) and b3.c < b1.o              # b1 white -> THREE INSIDE DOWN
signal   = long1 and short2 and inside and (up or down)
```
TA-Lib's output sign is `-TA_CANDLECOLOR(i-2) * 100`: black `b1` ⇒ +100 (up), white `b1` ⇒ −100 (down).

**The `b3` rule is a real disagreement.**

| Source | Third-candle requirement |
|---|---|
| **TA-Lib** | Opposite colour to `b1` **and** `close` beyond `b1`'s **OPEN** (`b3.c < b1.o` down / `b3.c > b1.o` up) — a full round-trip of the first body |
| **Bulkowski** (three inside up) | *"a white candle that closes above the **prior close**"* — i.e. above `b2.c`, colour required white |
| **Bulkowski** (three inside down) | *"The last day must close **lower**, but **can be any color**"* |
| **Investopedia** | *"a green (up) candle that **closes above the close of the second candle**"* — above `b2.c`, colour required |
| **CandleScanner** | *"the closing price is **above the previous closing price**"* — above `b2.c` |
| **thinkorswim** | same as Investopedia, plus `b2` must be "short" by the body-factor test |

⇒ TA-Lib is markedly stricter than everyone (beyond `b1.o`, i.e. a full round-trip of the first body, vs merely beyond `b2.c`) and additionally colour-locks the third bar. Bulkowski is asymmetric between his own up and down variants. **Recommend TA-Lib's rule** — it is the only one that makes the pattern meaningfully stronger than the bare harami it contains, and it is what every TA-Lib-derived library emits. Note this strictness is also why Bulkowski's numbers (65%/60%) look mediocre: he is measuring the *loose* version.

**Inside-body tolerance — Bulkowski and CandleScanner agree exactly, and it is worth adopting:**
- Bulkowski: *"The tops or bottoms of the two bodies can be the same price, **but not both**."*
- CandleScanner: *"The opening price of the second line may be equal to the first candle's closing price. The closing price of the second line may be equal to the opening price of the first candle. **These two situations cannot happen at the same time.**"*

TA-Lib uses strict `<` and `>` on both ends, so it **rejects** the one-end-matching case — the same case its own `CDLHARAMI` accepts at grade 80. A deliberate, documented asymmetry inside TA-Lib, and the reason the containment in §D-1 holds only for harami grade 100.

**Shadows are irrelevant here — say so explicitly in code comments.** CandleScanner: *"The shadows do not matter in the case of this pattern."* StockCharts, on the harami position generally: *"The second candlestick's shadows (high/low) **do not have to be contained within the first**, though it is preferable if they are."* ⇒ **Body-to-body containment only.** Do not test `b2.h < b1.h and b2.l > b1.l`. CandleScanner also **prohibits a doji** as `b2` (that would be a harami *cross*, a different pattern).

**Measured.** Three inside up: bullish reversal **65%**, rank 20, freq 33. Three inside down: bearish reversal **60%**, rank 56, freq 33 — both are common and only modestly better than a coin flip. Rank them below the star family.

**Trend / bias.** Down→🟢 R; Up→🔴 R.

---

### 12–13. THREE OUTSIDE UP / THREE OUTSIDE DOWN
**Aliases / JP.** Engulfing + confirmation. Also Morris. Japanese base *tsutsumi* (包み, "engulfing"): *tsutsumi age* / *tsutsumi sage*.

**Executable (TA-Lib `CDL3OUTSIDE` — note: NO body-length test at all):**
```python
up   = white(b2) and black(b1) and b2.c > b1.o and b2.o < b1.c and b3.c > b2.c
down = black(b2) and white(b1) and b2.o > b1.c and b2.c < b1.o and b3.c < b2.c
```
`CDL3OUTSIDE` is the shortest function in the family (17 KB vs 56 KB for advance block) — it has **no `TA_CANDLEAVERAGE` calls whatsoever**, therefore **no warm-up period and no rolling state**. It will fire on bar 3 of a series. If your engine assumes every 3-bar pattern needs 10+ bars of history, you will under-report this one.

**Thresholds by source.**
- TA-Lib: engulfing must be **strict on both ends** (`>` and `<`), excluding the one-end-matching case that `CDLENGULFING` scores 80.
- Bulkowski (up): *"a white candle opens below the prior body and closes above it, too. The last day is a candle in which price closes **higher**."* No colour requirement on `b3`.
- StockCharts (engulfing): *"does not require the entire range (high and low) to be engulfed, **just the open and close**."* — body engulfing, not range engulfing. Important: do **not** test `b2.h > b1.h and b2.l < b1.l`.

**Measured.** Three outside up: bullish reversal **75%**, rank 34, freq 21. Three outside down: bearish reversal **69%**, rank 39, freq **21** — these are among the *most common* patterns in the encyclopedia. Expect high daily counts; do not treat a large match count as a bug.

**Containment.** Strictly contains the engulfing pattern (§D-1). Must outrank it.

**Trend / bias.** Down→🟢 R; Up→🔴 R.

---

### 14–15. TRI-STAR (BULLISH / BEARISH)
**Aliases / JP.** *Santen boshi* (三点星, "three star points"). Bearish tri-star JP: *santen boshi*.

**Executable (TA-Lib `CDLTRISTAR`):**
```c
fabs(C[i-2]-O[i-2]) <= BodyDoji(i-2) &&
fabs(C[i-1]-O[i-1]) <= BodyDoji(i-2) &&      /* NOTE: index i-2, see quirk */
fabs(C[i]  -O[i])   <= BodyDoji(i-2) )
{
   out = 0;
   if( TA_REALBODYGAPUP(i-1,i-2)   && max(O[i],C[i]) < max(O[i-1],C[i-1]) ) out = -100;  /* bearish */
   if( TA_REALBODYGAPDOWN(i-1,i-2) && min(O[i],C[i]) > min(O[i-1],C[i-1]) ) out = +100;  /* bullish */
}
```
Two things to copy carefully:
1. **Only ONE gap is required.** `b2` must body-gap away from `b1`. `b3` is only required to be *retraced back toward* `b2` (`not higher than b2` for bearish, `not lower than b2` for bullish) — it does **not** have to gap. Bulkowski agrees: *"The middle doji has a body below the other two"* / *"above the other two"* — a positional statement, not a two-gap statement.
2. **TA-Lib quirk:** all three doji tests pass index `i-2` to `TA_CANDLEAVERAGE`. Harmless with defaults (`BodyDoji.avgPeriod = 10 ≠ 0`, so the IDX argument is unused), but it becomes a live bug if anyone sets `BodyDoji.avgPeriod = 0`. Do not replicate the quirk; use the correct per-bar index.

**⚠️ But TA-Lib is alone on the one-gap reading.** Three sources require the middle doji to gap away from **both** neighbours:
- **TradingView Pine:** `C_TriStarBullish = C_3DojisBullish and C_DownTrend[2] and C_BodyGapDnBullish[1] and C_BodyGapUpBullish` — two body gaps.
- **thinkorswim:** *"the **second Doji gaps down from the first and the third candles**"* (bullish) / *"gaps up from the first and the third candles"* (bearish).
- **Investopedia:** first doji, *"the **second doji gaps in the direction of the prevailing trend**"*, and the third *"opens in the opposite direction of the trend"*; *"The shadows on each doji are usually **shallow**."*

Against: **TA-Lib** (one gap) and **Bulkowski** / **CandleScanner** (positional only — *"a body below the prior body"* / *"a body above the prior body"*; CandleScanner adds *"**The shadows do not matter**"*, confirming BODY gaps).
⇒ Three consecutive doji is already rare; demanding two gaps on top makes it near-nonexistent. **Default to TA-Lib's one gap**, expose `both_gaps: bool`.

**Thresholds by source.** Everything else hinges on the doji tolerance (§B-3/4 table: 3%→10%, three different denominators) — three consecutive *strict* doji is vanishingly rare, so implementations quietly loosen it. Bulkowski found tri-star frequency rank 79 (bull) / 77 (bear), i.e. rare but not abandoned-baby rare, which implies his doji test is looser than his own "within pennies". CandleScanner excludes only the Four-Price Doji (`O=H=L=C`).

**Measured — and this matters.** Bullish tri-star: reversal **60%**, rank 28 (Bulkowski notes 60% is *"close to random, 50%"*). Bearish tri-star: reversal **52%**, rank **76** — statistically indistinguishable from a coin flip. **Rank tri-star LOW.** It is visually dramatic and analytically near-worthless.

**Trend / bias.** Down→🟢 R; Up→🔴 R.

---

### 16. ADVANCE BLOCK
**Aliases / JP.** *Sakizumari* (先詰まり, "blocked/jammed ahead"). (CandleScanner.)

**Executable (TA-Lib `CDLADVANCEBLOCK`, decomposed — this is the densest condition in the library):**
```python
# --- shared "three rising white candles" skeleton (IDENTICAL to 3WS) ---
base = (white(b1) and white(b2) and white(b3)
        and b3.c > b2.c and b2.c > b1.c
        and b2.o > b1.o and b2.o <= b1.c + NEAR(b1)
        and b3.o > b2.o and b3.o <= b2.c + NEAR(b2)
        and body(b1) > avg_body(b1,10)                      # 1st: LONG real body
        and upper(b1) < 0.5*avg_shadows(b1,10))             # 1st: short upper shadow

# --- the "weakening" disjunction: ANY ONE of four ---
w1 = body(b2) < body(b1) - FAR(b1) and body(b3) < body(b2) + NEAR(b2)
     # blocked at the 2nd; the 3rd fails to carry the advance
w2 = body(b3) < body(b2) - FAR(b2)
     # blocked at the 3rd
w3 = (body(b3) < body(b2) and body(b2) < body(b1)
      and (upper(b3) > 0.5*avg_shadows(b3,10) or upper(b2) > 0.5*avg_shadows(b2,10)))
     # progressively smaller bodies AND some upper shadow
w4 = body(b3) < body(b2) and upper(b3) > body(b3)
     # 3rd has a LONG upper shadow (ShadowLong: avgPeriod 0 -> its OWN body)

advance_block = base and (w1 or w2 or w3 or w4)
```
TA-Lib's own comment for these four branches, verbatim: *"( 2 far smaller than 1 && 3 not longer than 2 ) advance blocked with the 2nd, 3rd must not carry on the advance / 3 far smaller than 2 advance blocked with the 3rd / ( 3 smaller than 2 && 2 smaller than 1 && (3 or 2 not short upper shadow) ) advance blocked with progressively smaller real bodies and some upper shadows / ( 3 smaller than 2 && 3 long upper shadow ) advance blocked with 3rd candle's long upper shadow and smaller body."*

**Thresholds by source.**
- **TA-Lib:** as above. `FAR = 0.60 × avg_rng(5)`, `NEAR = 0.20 × avg_rng(5)`, `ShadowShort = 0.5 × avg_shadows(10)`, `ShadowLong = the bar's own body`.
- **Bulkowski:** *"three white candles … price opens within the body of the previous candle. **The height of the shadows grow taller on the last two candles.**"* — Bulkowski's rule is **shadow-growth only**, with *no* body-shrinkage requirement. He states the contrast explicitly: *"the deliberation has requirements on body height, but none on the upper shadow like the advance block."*
- **CandleScanner:** *"Each subsequent candle body … is shorter than the previous one"* and *"The shadows of the second and third line should be longer than the one of the first line."* Requires confirmation: *"the market closing below the first candle's body after formation … Without this close below the first line, the pattern is considered false."* Rarity: **0.16% of S&P 500 bars over 20 years.** Note their base criteria are otherwise **byte-identical to Three White Soldiers** — the shrink + shadow rules are the entire discriminator, and they give **no numeric threshold** for either.
- **Investopedia** — the four characteristics, verbatim: *"The price action has displayed an upward trend… **Three white candles appear that have progressively shorter real bodies.** The **open of the second and third candles lie within the real body of the previous candles** respectively. The **upper shadows of the three candles gradually become taller—especially the shadow of the last candle**."*
- **thinkorswim:** *"The second candle's body is smaller than that of the first candle, and the third candle's body is smaller than that of the second candle; **Both second and third candles have long upper shadows**."* Parameterized by `body factor` (*"Each of the last two candles cannot have body height greater than that of the previous candle multiplied by this factor"*) and `shadow factor` (*"A shadow is considered long if its length exceeds the average body height multiplied by this factor"*).

⇒ Five sources, three emphases: **TA-Lib = body-shrink OR shadow-growth** (4-way OR); **Bulkowski = shadow-growth only**; **CandleScanner / Investopedia / thinkorswim = body-shrink AND shadow-growth** (and all three require the shrink to be *monotonic across all three bars*, which TA-Lib requires only in branches w3/w4). TA-Lib's disjunction is the superset — use it as the default and expose a `strict` mode that ANDs monotonic shrink with shadow growth.

**Confirmation / invalidation — Investopedia is the only source that quantifies these, and they are directly usable:**
- Confirmed: *"the bearish reversal is **confirmed when the first subsequent price bar trades through the midpoint of the first candle's real body**."*
- Invalidated: *"This technical pattern is violated, signaling bullish continuation, if the security **continues to gain ground and trades above the third candle shadow**."*
- Caveat: *"its reliability as a reversal signal is **low** without supplementary analysis."* — which matches Bulkowski's measurement below.

**Trend / bias / class.** Up. Theoretically 🔴 **reversal** — but see the measured result.
**⚠️ Bulkowski measured it as a BULLISH CONTINUATION 64% of the time**, overall rank 54, freq 65. The theory is wrong more often than it is right. Emit it with `theory_bias = bearish_reversal` and `measured_bias = bullish_continuation` rather than a single sign, or you will hand users a bearish flag on a pattern that goes up two times in three.

---

### 17. DELIBERATION / STALLED PATTERN
**Aliases / JP.** *Shian boshi* (思案星, "deliberation star"). TA-Lib name: `CDLSTALLEDPATTERN`. Also "stalled pattern".

**Executable (TA-Lib `CDLSTALLEDPATTERN`):**
```python
white(b1) and white(b2) and white(b3)
and b3.c > b2.c and b2.c > b1.c                       # consecutive higher closes
and body(b1) > avg_body(b1,10)                        # 1st: LONG
and body(b2) > avg_body(b2,10)                        # 2nd: LONG
and upper(b2) < 0.10*avg_rng(b2,10)                   # 2nd: very short upper shadow
and b2.o > b1.o and b2.o <= b1.c + NEAR(b1)           # 2nd opens within/near 1st body
and body(b3) < avg_body(b3,10)                        # 3rd: SMALL body   <-- the discriminator
and b3.o >= b2.c - body(b3) - NEAR(b2)                # 3rd "rides on the shoulder" of the 2nd
```
TA-Lib comment: *"third candle: small white that gaps away or **'rides on the shoulder'** of the prior long real body (= it's at the upper end of the prior real body)."* Note the shoulder test has **no upper bound** — the third bar may gap up arbitrarily far and still qualify.

**Thresholds by source.**
- **TA-Lib:** first TWO bodies must be long; third must be short. Shadow rule applies only to `b2` (very short upper).
- **Bulkowski:** *"The first two are **tall bodied** candles but the third has a **small body that opens near the second day's close**."* Plus *"Each candle opens and closes higher than the previous one."* Identical in substance to TA-Lib.
- **CandleScanner:** third candle *"appears as a short line and can be one of the following: **Short White Candle or White Spinning Top**"*; opens *"slightly lower or higher than candle 2's close"*; closes above candle 2's close. Behavioural note worth surfacing: *"It rarely happens that a price drop immediately follows a Deliberation pattern. The market usually 'deliberates' during **2-4 candles** following a pattern."*
- **thinkorswim:** *"The first and the second candles are long and bullish; **All the three candles have consequently higher Open prices**; The Open and Close prices of the second candle are greater than those of the first candle; The third candle is **short and either gaps up from the second candle or has about the same Close price**."*
- **Huntraders:** *"The share opens close to the second day's closing on the third day"*; the third day is *"a short white candle, a Spinning Top, or a Star with a gap in the trend's direction"*; *"the weakness of the trend becomes clear **only on the third day**."*

> ⚠️ **The `b2` open rule differs between deliberation and its two cousins, and it is easy to miss.** CandleScanner states deliberation's second candle opens *"**above the previous opening price**"*, whereas three white soldiers and advance block both say *"within the previous **body**"*. TA-Lib papers over this — it uses the same `open[i-1] > open[i-2] and open[i-1] <= close[i-2] + NEAR` clause for all three. Follow TA-Lib for consistency; the divergence is a documentation artifact, not a real distinction (opening above the prior *open* is the lower half of "within the prior body" anyway).

**Trend / bias / class.** Up. Theoretically 🔴 reversal.
**⚠️ Bulkowski measured it as a BULLISH CONTINUATION 77% of the time** — and it is his **worst-ranked pattern in this entire family at rank 93 of 103**, yet paradoxically *"ranking 2nd as a bullish continuation pattern."* Same handling as advance block: report theory and measurement separately.

---

### 18. UNIQUE THREE RIVER BOTTOM
**Aliases / JP.** *Sankawa soko zuka* (三川底築, "three river bottom"). (CandleScanner.)

**Executable (TA-Lib `CDLUNIQUE3RIVER`):**
```python
black(b1) and black(b2) and white(b3)
and body(b1) > avg_body(b1,10)          # 1st: LONG black
and b2.c > b1.c and b2.o <= b1.o        # 2nd: harami-ish inside 1st body (note <=, not <)
and b2.l < b1.l                         # 2nd: LOWER LOW than the 1st   <-- the signature
and b3.o > b2.l                         # 3rd opens not lower than the 2nd's low
and body(b3) < avg_body(b3,10)          # 3rd: SHORT white
```
TA-Lib comment: *"third candle: small white candle with open not lower than the second candle's low, **better if its open and close are under the second candle's close**"* — that stronger clause is described but **not implemented**.

**Thresholds by source.**
- TA-Lib: as above; note `b2.o <= b1.o` **allows equality**, so the "harami" here is not a strict TA-Lib harami.
- **CandleScanner adds a hard numeric rule TA-Lib lacks:** the second candle's *"lower shadow is at least **twice** longer than the body"* (one of the only explicit numeric ratios in their entire encyclopedia), and the third candle's *"body located **below** the prior body"* with *"the low price above the prior low price."*
- **Bulkowski:** *"a tall bodied black candle … another black body rests inside the prior body, but the **lower shadow is below the prior day's low**. The last day is a short bodied white candle that **remains below the body of the prior candle**."*
- **thinkorswim:** *"The second candle is bearish, has a **long lower shadow** and its **body is completely inside the previous candle's body**; The second candle's **Low price is less than that of the first candle**; The third candle is **small and bullish**, its **Close price is lower than that of the second candle**."*

⇒ Bulkowski, CandleScanner and thinkorswim all require `b3` to sit **below** `b2`; TA-Lib only requires `b3.o > b2.l`. **Adopt the stricter version:** `body_top(b3) < body_bot(b2)` — TA-Lib's own comment says it is "better", and the loose version admits a lot of noise. Also adopt CandleScanner's `lower(b2) >= 2*body(b2)`.

> ⚠️ **The easiest rule in this whole document to get backwards.** Candle 2 is a **body-harami but a range-breakout** (body inside `b1`, but `low` *below* `b1.low`), and candle 3 is **bullish yet closes BELOW candle 2's close**. Both clauses read like typos and both are correct. A naive "bullish reversal ⇒ third candle closes higher" assumption breaks this pattern.

**Trend / bias / class.** Down. Theoretically 🟢 reversal.
**⚠️ Bulkowski measured it as a BEARISH CONTINUATION 60% of the time**, rank 60, freq 89. Another sign-flip. Rare enough (freq 89) that the sample is thin.

---

### 19. STICK SANDWICH
**Aliases / JP.** *Gyakusashi niten zoko* (逆差し二天底, "matching low double bottom"). TA-Lib: `CDLSTICKSANDWICH`.

**Executable (TA-Lib):**
```python
black(b1) and white(b2) and black(b3)
and b2.l > b1.c                                  # 2nd trades ONLY above the 1st close
and abs(b3.c - b1.c) <= EQ(b1)                   # 1st and 3rd close equal, EQ = 0.05*avg_rng(5)
```
Remarkably permissive — **no body-length test on any bar**, no requirement that `b3` engulf `b2`.

**Thresholds by source.**
- **TA-Lib:** "equal" = `Equal` setting = **5% of avg_rng(5)**. Only source that quantifies it.
- **StockCharts:** *"The closing prices of the two black bodies must be **equal**."* — literally equal.
- **Bulkowski:** *"a black candle that closes **at or near** the close of the first day."* Tolerance acknowledged, unquantified.
- **thinkorswim:** *"The third candle is bearish again and its **Close price is equal to that of the first candle**"*; also constrains `b2`: *"its **Open price is higher than the first candle's Close price**"* (equivalent to TA-Lib's `b2.l > b1.c`, but weaker — it constrains the open, not the low).

⇒ On real US equity data, exact-equal closes are common enough at round numbers that a 0-tolerance rule still fires; but 5% of avg range is the sensible default. Do **not** use a percentage-of-price tolerance — it does not scale across a $3 and a $900 stock.

**⚠️ Two structural conflicts on this pattern.**
1. **Is there a bearish version?** **Investopedia alone** claims a symmetric pair: *"a **bearish** sandwich to run green-red-green, and a **bullish** sandwich to run red-green-red."* TA-Lib (`outInteger is always positive … stick sandwich is always bullish`), StockCharts (*"A **bullish** reversal pattern"*) and Bulkowski all treat it as **bullish-only**. ⇒ Implement bullish-only. If you want the mirror, name it something else; do not emit "bearish stick sandwich" as though it were standard.
2. **Investopedia states no equal-close requirement at all** — the defining constraint in every other source — and instead says *"the inside candlestick will be shorter and… will be **completely engulfed by the outside sticks**."* That is a different pattern. Ignore it.
3. **CandleScanner has no Stick Sandwich page**; it is absent from their complete 28-pattern three-line list (verified). So this pattern rests on TA-Lib + StockCharts + Bulkowski.

**Trend / bias / class.** Down. Theoretically 🟢 reversal.
**⚠️ Bulkowski measured it as a BEARISH CONTINUATION 62% of the time** — yet its **overall performance rank is 14**, one of the best in the family. The pattern *works*; it just works in the opposite direction from its name. This is the single most important sign-flip in the set because rank 14 means people will act on it.

---

### 20. UPSIDE GAP TWO CROWS
**Aliases / JP.** *Shita banare niwa garasu* (下離れ二羽烏, "gapping down two crows" — the Japanese names the gap from the crows' perspective). (CandleScanner.)

**Executable (TA-Lib `CDLUPSIDEGAP2CROWS`):**
```python
white(b1) and body(b1) > avg_body(b1,10)           # 1st: LONG white
and black(b2) and body(b2) <= avg_body(b2,10)      # 2nd: SHORT black
and body_bot(b2) > body_top(b1)                    # BODY gap up
and black(b3)
and b3.o > b2.o and b3.c < b2.c                    # 3rd engulfs 2nd's body (both black!)
and b3.c > b1.c                                    # ...but still closes ABOVE the 1st close
```
The defining tension: `b3` engulfs `b2` yet the **gap is not filled** (`b3.c > b1.c`). If `b3.c <= b1.c` the gap has closed and this is no longer the pattern.

**Thresholds by source.** TA-Lib, Bulkowski, StockCharts and CandleScanner all agree on the structure. StockCharts adds *"The gap remains above the first day after the close"* and *"a body larger than the second day"*. Bulkowski: *"a close that remains above the close of the first candle."* No numeric conflict.

**Trend / bias / class.** Up. Theoretically 🔴 reversal.
**⚠️ Bulkowski measured it as a BULLISH CONTINUATION 60% of the time**, rank 74 (poor), freq 75.

---

### 21. TWO CROWS
**Aliases / JP.** *Niwa garasu* (二羽烏, "two crows"). **Despite the name this is a THREE-line pattern** — Bulkowski: *"Number of candle lines: Three."* TA-Lib `CDL2CROWS` lookback +2. The "two" counts only the black candles.

**Executable (TA-Lib `CDL2CROWS`):**
```python
white(b1) and body(b1) > avg_body(b1,10)     # 1st: LONG white
and black(b2) and body_bot(b2) > body_top(b1)  # 2nd: black, BODY gap up
and black(b3)
and b3.o < b2.o and b3.o > b2.c              # 3rd opens WITHIN the 2nd body
and b3.c > b1.o and b3.c < b1.c              # 3rd closes WITHIN the 1st body
```
Contrast with upside gap two crows: **two crows requires `b3` to open *inside* `b2`'s body and close *inside* `b1`'s body** (**the gap is filled**); **upside gap two crows requires `b3` to open *above* `b2`'s open (engulfing) and close *above* `b1`'s close** (**the gap is not filled**). They are mutually exclusive, and the filled-vs-unfilled gap is the whole distinction — encode it as a single comparison and the pair can never collide.

**Thresholds by source.** TA-Lib requires no body-size test on `b2` or `b3`. Bulkowski matches TA-Lib exactly in substance. thinkorswim: *"The second candle is bearish and **gaps up from the first candle**; The third candle is bearish and has the **Open price inside the second candle's body** and the **Close price inside the first candle's body**."*

**Gap kind — CandleScanner gives the explicit ruling, and it applies to this whole sub-family:**
> *"We assume that it is enough if the gap appears only between the first and the second body. **The shadows do not need to gap.**"*

⇒ BODY gap. This is the general rule for everything in the crow family; **abandoned baby is the sole shadow-gap exception** in this document (plus collapsing doji star and Bulkowski's window variant of gap-three-methods).

**Trend / bias / class.** Up. 🔴 reversal. Bulkowski measured: bearish reversal **54%** — essentially random. Rank low.

---

### 22. THREE STARS IN THE SOUTH
**Aliases / JP.** *Kyoku no santen boshi* (南の三ツ星 / 極の三点星). (CandleScanner.)

**Executable (TA-Lib `CDL3STARSINSOUTH`):**
```python
black(b1) and black(b2) and black(b3)
and body(b1) > avg_body(b1,10)                     # 1st: LONG
and lower(b1) > body(b1)                           # 1st: LONG lower shadow (ShadowLong = own body!)
and body(b2) < body(b1)                            # 2nd: smaller
and b2.o > b1.c and b2.o <= b1.h                   # opens higher than 1st close, within 1st range
and b2.l < b1.c and b2.l >= b1.l                   # trades below 1st close but not below 1st low
and lower(b2) > 0.10*avg_rng(b2,10)                # 2nd HAS a lower shadow (closes off its low)
and body(b3) < avg_body(b3,10)                     # 3rd: small
and lower(b3) < 0.10*avg_rng(b3,10)                # 3rd: marubozu (both shadows very short)
and upper(b3) < 0.10*avg_rng(b3,10)
and b3.l > b2.l and b3.h < b2.h                    # 3rd engulfed by 2nd's RANGE
```
Note `lower(b1) > body(b1)` uses `ShadowLong` whose `avgPeriod == 0` — the threshold is the **bar's own real body**, not a rolling average. This is the clearest place the §0 trap bites.

**Thresholds by source.** TA-Lib is the only fully quantified source. Bulkowski: *"a tall black candle with a long lower shadow … The second day should be similar to the first day, but smaller and with a **higher low**. The last day is a **black marubozu that squeezes inside the high-low range of the prior day**."* CandleScanner: C1 *"long lower shadow"*, C2 *"the opening below the prior opening"* + *"the closing below or at the prior closing"* + *"the low above the prior low"*, C3 *"a **marubozu** candle with black body"* that *"is located within the prior candle"*. thinkorswim adds one clause the others omit: *"The first candle has a long lower shadow **and no upper shadow**."*

⚠️ Note CandleScanner's C2 rule (*"opening **below** the prior opening"*) conflicts with TA-Lib's (`b2.o > b1.c and b2.o <= b1.h`, i.e. opening **above** the prior close). Both describe "the second bar opens inside the first bar's lower region", but they bound it from opposite ends. TA-Lib's is the tighter and more implementable pair.

**Measured — read the caveat.** Bulkowski: bullish reversal **86%** (the highest number in this document) but **overall performance rank 103 of 103**, frequency rank 99, and **n = 9**. He states the analysis is *"likely wrong"* due to sample size. **Do not let the 86% reach a user-facing tooltip.** Emit the pattern; suppress the statistic.

**Trend / bias.** Down. 🟢 reversal.

---

### 23–24. UPSIDE / DOWNSIDE GAP THREE METHODS
**Aliases / JP.** *Uwa banare sanpoo hatsu oshi* (上放れ三法初押し) / *shita banare sanpoo hatsu modori*. TA-Lib: `CDLXSIDEGAP3METHODS` (one function, both directions).

**Executable (TA-Lib):**
```python
same_color = white(b1) == white(b2)
opposite   = white(b2) != white(b3)
gap = (body_bot(b2) > body_top(b1)) if white(b1) else (body_top(b2) < body_bot(b1))
b3_in_b2 = body_bot(b2) < b3.o < body_top(b2)      # 3rd OPENS within 2nd body
b3_in_b1 = body_bot(b1) < b3.c < body_top(b1)      # 3rd CLOSES within 1st body
signal = same_color and opposite and gap and b3_in_b2 and b3_in_b1     # sign = color(b1)
```

**Battleground: body gap vs window.**
- **TA-Lib:** *"upside (downside) gap between the first and the second **real bodies**"* — `TA_REALBODYGAPUP/DOWN`.
- **Bulkowski (Upside Gap 3 Methods):** *"There should be a gap between them, **including between the shadows**."* (Downside): *"The second candle should have a gap between them (**shadows do not overlap**)."* — a **true window**.
- **thinkorswim:** *"The first and the second candles are long and bullish and continue the uptrend; The second candle **gaps up** from the first one; The third candle is bearish and its **body covers the gap** between the two previous candles."* — note the added requirement that **both** of the first two bodies be **long**, which TA-Lib omits entirely.
⇒ Bulkowski requires a window; TA-Lib requires only a body gap. Bulkowski's frequency ranks (85 and 84 of 103) reflect the stricter rule. **Recommend the body gap for the default match and expose `window: bool`**, because a body-gap-only version on daily US equities will over-fire relative to Bulkowski's counts. Add thinkorswim's `LONG(b1) and LONG(b2)` — TA-Lib's version with no body test at all will fire on trivially small bodies.

**⚠️ Do not confuse with the FIVE-bar Rising/Falling Three Methods.** StockCharts defines those separately: *"A long white body is followed by **three small body days**, each fully contained within the range of the high and low of the first day. **The fifth day** closes at a new high."* Different pattern, different bar count, confusingly similar name. TA-Lib keeps them apart as `CDLXSIDEGAP3METHODS` (3 bars) vs `CDLRISEFALL3METHODS` (5 bars).

**⚠️ Also adjacent: the Tasuki gaps (§B-25), where the gap is NOT closed.** Gap-three-methods = `b3` **fills** the gap (closes inside `b1`'s body). Tasuki = `b3` closes **into but not through** the gap. Same three-bar shape, opposite conclusion. StockCharts on Upside Tasuki: *"closes in the gap between the first two days but **does not close the gap**."*

**Trend / bias / class.** Theoretically continuation (up→🟢 C, down→🔴 C).
**⚠️ Bulkowski measured BOTH as reversals**: upside gap three methods acts as a **bearish reversal 59%** (rank 27); downside gap three methods acts as a **bullish reversal 62%** (rank 26). Both theory signs are inverted by the data. Both rank well (26–27), so the *inverted* signal is the tradeable one.

---

### 25. UPSIDE / DOWNSIDE TASUKI GAP
**Aliases / JP.** *Uwa banare tasuki* / *shita banare tasuki* (たすき, the cord used to tie back sleeves). TA-Lib: `CDLTASUKIGAP`.

**Executable (TA-Lib, upside branch):**
```python
body_bot(b2) > body_top(b1)                     # window up between b1 and b2 (BODY gap)
and white(b2) and black(b3)
and b2.o < b3.o < b2.c                          # 3rd opens within the 2nd body
and b3.c < b2.o and b3.c > body_top(b1)         # closes below 2nd body, INSIDE the gap (not through)
and abs(body(b2) - body(b3)) < NEAR(b2)         # the two bodies are near the same size
```
The near-equal-body clause (`NEAR = 0.20 × avg_rng(5)`) is TA-Lib-specific and comes straight from the comment: *"the size of two real bodies should be near the same."* StockCharts states only *"closes in the gap between the first two days, but **does not close the gap**"* — the essential clause.

**Trend / bias / class.** In-trend. Up→🟢 **continuation**; down→🔴 continuation. One of the few genuine continuation patterns in the three-bar family.

---

### 26. GAP SIDE-BY-SIDE WHITE LINES
**Aliases / JP.** *Narabi aka* (並び赤, "side-by-side red"). TA-Lib: `CDLGAPSIDESIDEWHITE`.

**Executable (TA-Lib):**
```python
gap_up   = body_bot(b2) > body_top(b1) and body_bot(b3) > body_top(b1)
gap_down = body_top(b2) < body_bot(b1) and body_top(b3) < body_bot(b1)
white(b2) and white(b3)
and abs(body(b3) - body(b2)) <= NEAR(b2)        # near the same size
and abs(b3.o - b2.o) <= EQ(b2)                  # about the same open
signal = (+100 if gap_up else -100) if (gap_up or gap_down) else 0
```
**Sign trap:** TA-Lib returns **−100 for the downside variant even though both candles are white.** The sign encodes *the direction of the trend being continued*, not the colour of the candles. A downside-gap side-by-side white lines is a **bearish continuation**. If you map "TA-Lib negative ⇒ bearish candle structure" you will mislabel it.

**Measured.** Bulkowski (bullish side): bullish continuation **66%**, rank 46, freq 73.

**Trend / bias / class.** In-trend continuation, both directions.

---

### 27. COLLAPSING DOJI STAR
**Aliases / JP.** No TA-Lib function exists — this one is Bulkowski-only, and worth adding because it completes the doji-island family.

**Executable (from Bulkowski's guidelines):**
```python
white(b1)
and body(b2) <= 0.10*avg_rng(b2,10)      # doji
and b2.h < b1.l                          # doji gaps below b1's LOW  (shadow gap)
and black(b3)
and b3.h < b2.l                          # b3 gaps below the doji's LOW (shadow gap)
```
Bulkowski: *"None of the shadows on the three candles should overlap, so there should be gaps surrounding the doji."*

**Measured.** Bearish reversal **63%**, overall rank **97**, frequency rank **101**, **n = 16 in 4.7M candle lines**. Even rarer than abandoned baby. Include for completeness; never surface the statistic.

**Trend / bias.** Up. 🔴 reversal.

---

## C. SOURCES DISAGREE — every numeric conflict, in priority order

| # | Question | TA-Lib | Bulkowski | StockCharts | CandleScanner | Nison / others | **Recommendation** |
|---|---|---|---|---|---|---|---|
| **C1** ⭐ | **Star: penetration of `b3` into `b1`'s body** | **0.30**, anchored on `b1.c` | **0.50** ("at least midway") | **0.50** (dictionary) / **none** (prose page) | **0.50** ("at least halfway up") | Nison: **no number** ("well into"); TradingView **0.50**; thinkorswim **0.50**; candlesticker: **different anchor** (`b1.o` → `b2.l` midpoint); Investopedia: none | **Use 0.50.** Six sources converge on the midpoint; TA-Lib's 0.3 is the lone outlier and is a tunable, not a canon. Expose `penetration_pct`. |
| **C2** | **Star: gap between `b2` and `b3`** | **not required** | **required** (body gap) | required (dictionary) / not required (prose) | **not required** ("some sources do not require") | **Nison: not required**; TradingView: **required**; thinkorswim: not required; Investopedia: not required | **Not required.** Expose `star_isolated: bool`. Requiring it collapses match counts ~10×. |
| **C3** | **Star: gap between `b1` and `b2`** | required (BODY) | required (BODY, "ignore the shadows") | required | required (BODY) | **Nison: required** — the gap *is* what forms the star; Investopedia: **not required** | **Required, BODY gap.** 9 of 10 sources incl. Nison. |
| **C3b** | **Star: is there an UPPER bound on `b3`'s close?** | no | no | no | no | **TradingView Pine: YES** — `C_BodyHi < C_BodyHi[2]` (b3 must close *below* b1's open) | **No upper bound.** A full recovery is the strongest form of the signal, not a disqualifier. TradingView is alone here. |
| **C4** | **Abandoned baby: shadow gap or body gap** | **SHADOW** (`low>high`) | **SHADOW** | **SHADOW** ("completely gap … shadows") | SHADOW | TradingView **SHADOW**; thinkorswim **SHADOW**; Investopedia **SHADOW** | **SHADOW — unanimous.** Non-negotiable; it is the only thing separating it from morning/evening doji star. |
| **C4b** | **Abandoned baby: is a penetration test also required?** | **yes, 0.30** | no | no | **no** | TradingView: **no**; thinkorswim: no | **No.** TA-Lib is alone in adding one; the two island gaps are the pattern. |
| **C5** | **3WS: max open pull-back into prior body** | down to prior **OPEN** (100% of body), plus **+NEAR** above prior close | *"within the prior candle's body"* — no upper tolerance | *"open within the previous body"* | *"within the previous candle's body"* | — | **TA-Lib's ±**: `prior.o < open <= prior.c + 0.20*avg_rng(5)`. The `+NEAR` admits small gap-ups, which are more bullish, not less. |
| **C6** | **3WS: max upper shadow** | `< 0.10*avg_rng(10)` (hard) | "close near the high" (qualitative) | "close should be near the high" | not specified | — | **`< 0.10*avg_rng(10)`.** Only quantified rule; it is also half the advance-block discriminator. |
| **C7** | **3WS: must bodies be LONG?** | **not short** — comment: *"Greg Morris wants them to be long, Steve Nison doesn't"* | **"three tall white candles"** | **"three consecutive long white bodies"** | long lines; doji/spinning tops **prohibited** | not required | Default **not-short** (TA-Lib/Nison); flag `require_long`. With TA-Lib defaults these coincide (§0). |
| **C8** | **3 black crows: long bodies required?** | **no body test at all** | **"three tall black candles"** | **"three consecutive long black bodies"** | **"long lines"** | — | **Require long bodies** (3 of 4). TA-Lib is the outlier here. |
| **C9** | **3 black crows: very short lower shadows?** | **required** | "close near their lows" | "closes at or near its low" | *"nowadays such constraints are rejected by most of the traders"* | — | Keep as `strict` variant. "Closes near its low" ≡ "very short lower shadow", so it is not really contested — only CandleScanner drops it. |
| **C10** | **3 black crows: how many bars?** | **FOUR** (reads `high[i-3]`, `color[i-3]`) | three | three | three | three | **Pass 4 bars** for TA-Lib parity, or drop the `high[i-3] > close[i-2]` clause and document. |
| **C11** | **3 inside up/down: what must `b3` do?** | opposite colour **and** close beyond `b1`'s **OPEN** | up: white, close above **prior close**; down: **any colour**, close lower | — | confirms the harami | — | **TA-Lib.** Strictest, most standard, and the only version that beats the contained harami. |
| **C12** | **Harami inside-ness: may one end match?** | **no** (`CDL3INSIDE` strict both ends) — but `CDLHARAMI` allows it (scores 80) | **"tops or bottoms can be the same price, but not both"** | "completely contained" | — | — | Strict both ends for 3-inside; note TA-Lib's own internal inconsistency with `CDLHARAMI`. |
| **C13** | **Up/downside gap three methods: gap kind** | **BODY** gap | **WINDOW** ("including between the shadows" / "shadows do not overlap") | — | — | — | Default **BODY**, expose `window: bool`. Bulkowski's frequency ranks (84–85) assume the window. |
| **C14** | **Stick sandwich: "equal" closes tolerance** | **`0.05 * avg_rng(5)`** | "at or near" | **"must be equal"** | — | — | **`0.05 * avg_rng(5)`.** Never a % of price. |
| **C15** | **Identical 3 crows: "very close" tolerance** | **`0.05 * avg_rng(5)`** | "near the prior candle's close"; explicitly **rejects** an equal-size rule | — | "at or near", unquantified | — | **`0.05 * avg_rng(5)`.** Do not add a same-size-bodies rule. |
| **C16** | **Unique 3 river: where must `b3` sit?** | only `b3.o > b2.l` (loose); comment says stricter is *"better"* | **body entirely below `b2`'s body** | — | **body below prior body**, plus `lower(b2) >= 2*body(b2)` | — | **Strict:** `body_top(b3) < body_bot(b2)`. TA-Lib's own comment endorses it. |
| **C17** | **Advance block: shadow-growth or body-shrink?** | **either** (4-way OR) | **shadow-growth only** — *"no requirements on body height"* | — | **both** (AND) | — | **TA-Lib's OR** — it is the superset and captures both readings. |
| **C18** ⭐ | **Doji tolerance** | `body <= 0.10*avg_rng(prev 10)` | "within **pennies**" | "virtually equal" | **`<= 0.03 * rng(bar)`** | TradingView **`<= 0.05*rng(bar)`** + shadow symmetry; thinkorswim **`< 0.05 * avg_body`** | **Range-relative, and use two clauses:** `body <= 0.10*avg_rng(10) and body <= 0.05*rng(bar)`. A 3×-spread on two different denominators — see §0. |
| **C19** | **Tri-star: one gap or two?** | **ONE** (`b2` gaps; `b3` only retraces toward `b2`) | positional only ("middle doji below/above the other two") | — | positional; *"shadows do not matter"* → BODY | **TradingView: TWO**; **thinkorswim: TWO**; Investopedia: implies two | **One gap** (default), `both_gaps: bool` flag. Three consecutive doji is already rare; two gaps makes it near-nonexistent. |
| **C20** ⭐ | **Does the pattern need a prior trend, and what happens without it?** | **"this function does not consider the trend"** — every function | **row 2 of every table**, "Downward"/"Upward" | **quantified**: last **1-4 weeks**; 20-day EMA (or 10-day for shorter); without it the pattern *"could be considered **continuation patterns**"* | required | TradingView: SMA50 / SMA50+SMA200 / off; thinkorswim: `trend setup` = N preceding candles | **Compute it, attach it, do not gate on it silently.** Missing trend ⇒ reclassify as *continuation*, not discard. See §0 and §D-3. |
| **C21** ⭐ | **3WS: what must each candle close above?** | `close[k] > close[k-1]` | "close near the **high of the day**" | "close near the high of the day" | `> previous close` | **Investopedia contradicts ITSELF**: *"close that exceeds the previous candle's **high**"* vs *"close occurs above the previous candlestick's **close**"*; TradingView/thinkorswim: `> prior close` | **`close[k] > close[k-1]`.** The "exceeds prior high" reading approximates requiring a gap-up on every bar and cuts hit rate ~10×. |
| **C22** | **3WS: max upper shadow** | `< 0.10 * avg_rng(prev 10)` | qualitative | qualitative | **rule dropped entirely** ("rejected") | TradingView **`< 0.05 * rng(bar)`**; Investopedia "not very long" | **TA-Lib's `0.10*avg_rng(10)`** — same units as the advance-block test it must be compared against. |
| **C23** | **3WS: may `b_k` open ABOVE the prior close (small gap up)?** | **yes**, up to `+NEAR` | no | no | no | **TradingView: no** (`open < close[1]`); Morris: prefers mid-range of prior bar | **Yes** (TA-Lib), flag it. A gap-up soldier is more bullish, not less. |
| **C24** | **Stick sandwich: does a BEARISH version exist?** | **no** ("always positive") | no | **no** ("A bullish reversal pattern") | **no page at all** | **Investopedia: YES** (green-red-green) | **Bullish only.** Investopedia is alone, and also drops the equal-close rule that defines the pattern. |
| **C25** | **Advance block: monotonic shrink required across all three?** | **no** — 4-way OR, only branches w3/w4 need monotonic | no (shadow rule only) | — | **yes** | **Investopedia: yes**; **thinkorswim: yes** | **TA-Lib's OR by default** (superset), `strict` mode ANDs monotonic shrink + shadow growth. |
| **C26** | **Three inside: what must `b3` close beyond?** | `b1.o` (full round-trip) | `b2.c` (up) / just "lower" any colour (down) | — | `b2.c` | Investopedia `b2.c`; thinkorswim `b2.c` | **`b1.o` (TA-Lib).** Only version that beats the harami it contains; but know that Bulkowski's 65%/60% measure the *loose* version. |
| **C27** | **Three inside/outside: must SHADOWS be contained?** | no (body only) | no | **no** — *"shadows do not have to be contained within the first, though preferable"* | **no** — *"the shadows do not matter"* | no | **Body-to-body only.** Never test `b2.h < b1.h and b2.l > b1.l`. |
| **C28** | **Unique 3 river: which way does `b3` close?** | not constrained vs `b2.c` | below `b2`'s body | — | body below prior body | **thinkorswim: `b3.c` < `b2.c`** (bullish candle, lower close) | **`body_top(b3) < body_bot(b2)`.** Counter-intuitive and correct. |
| **C29** | **"long body" baseline** | mean(body, prev 10) | "tall" | "long" | **0.70 × EMA(H−L, prev 25)** — a **RANGE**, not a body | TradingView **EMA(body,14)** incl. current bar; thinkorswim mean(body,N) | **TA-Lib's prior-N simple mean of BODY.** CandleScanner's range-based "long line" admits long-shadowed small bodies — a different concept wearing the same word. |

### C-extra: where the sources disagree with *themselves*
- **StockCharts, morning star.** The ChartSchool prose page says the third bar is merely *"A long white candlestick"* — no gap, no penetration. The Pattern Dictionary on the same site says *"a long-bodied white candle that **gapped up on the open and closed above the midpoint** of the body of the first day."* Two incompatible definitions under one masthead. Cite the dictionary; it is the operational one.
- **Investopedia, three white soldiers.** Its opening definition says the close *"exceeds the previous candle's **high**"*; its own comparison section two screens later says the close *"occurs above the previous candlestick's **close**"*. These differ by roughly an order of magnitude in hit rate. (See C21.)
- **TA-Lib, engulfing containment.** `CDLENGULFING` and `CDLHARAMI` both award 80 when one body end matches; `CDL3OUTSIDE` and `CDL3INSIDE` reject that case outright. So a 3-outside-up can fail on bars that `CDLENGULFING` scores 80 — the containment in §D-1 holds only for the =100 grade.
- **TA-Lib, `BodyLong` vs `BodyShort`.** Identical defaults make "long" and "not short" the same predicate, which makes several comments ("1st: long", "3rd: longer than short") describe one threshold in two vocabularies.
- **TA-Lib, `CDLTRISTAR` index.** All three doji tests pass `i-2` to `TA_CANDLEAVERAGE`. Inert under defaults (`BodyDoji.avgPeriod = 10 ≠ 0`), live bug if anyone sets it to 0.
- **CandleScanner, "long line".** Their own page concedes the 70% threshold *"was **arbitrarily chosen**"* and is user-tunable — so their per-pattern "appears as a long line" language carries no fixed numeric meaning.

### C-extra 2: coverage gaps — what each source simply does not have
Useful when you are deciding how much weight a "consensus" carries.
- **Investopedia has NO page** for: two crows, upside gap two crows, three stars in the south, unique three river bottom, identical three crows, deliberation/stalled, morning doji star, evening doji star, upside/downside gap three methods. (Verified 404 on every slug variant plus their own site search.) So for 9 of 27 patterns, "Investopedia says" is not available at all.
- **TradingView's Pine "All Candlestick Patterns" source has NO implementation** for: advance block, deliberation, three inside up/down, three outside up/down, identical three crows, upside gap two crows, two crows, three stars in the south, unique three river bottom. (Verified against two independent mirrors.)
- **CandleScanner has no Stick Sandwich page** (absent from their complete 28-pattern three-line list).
- **thinkorswim covers all nine that Investopedia lacks**, and is the only non-TA-Lib source that states *parameterized* definitions (`length`, `body factor`, `shadow factor`, `trend setup`). It is the best cross-check on TA-Lib.
- **Morris's literal "Rules of Recognition" could not be retrieved** — the mirrored PDF exceeds fetch limits and Google Books returns no body text. Morris's positions in this document are attributed via TA-Lib's in-source comments (which name him directly on soldiers and stars) and via CandleScanner/Bulkowski crediting him with three-inside and three-outside. If literal Morris text is needed, the book is the only path.

---

## D. CONTAINMENT MATRIX

### D-1. Three-bar patterns that STRICTLY CONTAIN a shorter pattern
Rank the container **above** the contained; emit the longer name and suppress the shorter. Verified against TA-Lib source, not asserted from names.

| 3-bar pattern | Bars | Strictly contains | Proof / caveat |
|---|---|---|---|
| **Three Inside Up** | b1,b2 | **Bullish Harami** (grade 100) | `CDL3INSIDE` requires `LONG(b1)`, `SHORT(b2)`, `body_top(b2) < body_top(b1)`, `body_bot(b2) > body_bot(b1)` — the exact `CDLHARAMI` =100 clause. **Caveat:** harami =80 (one end matching) is *excluded* by 3-inside. |
| **Three Inside Down** | b1,b2 | **Bearish Harami** (grade 100) | same |
| **Three Inside Up/Down** | b1,b2 | **Harami Cross**, iff `body(b2) <= BodyDoji` | Doji ⊄ Short by construction (§B-3/4); test independently. |
| **Three Outside Up** | b1,b2 | **Bullish Engulfing** (grade 100) | `CDL3OUTSIDE` up-branch is `white(b2) and black(b1) and b2.c > b1.o and b2.o < b1.c` — the strict `CDLENGULFING` bullish clause. **Caveat:** engulfing =80 excluded. |
| **Three Outside Down** | b1,b2 | **Bearish Engulfing** (grade 100) | same |
| **Morning Doji Star** | b1,b2 | **Bullish Doji Star** (`CDLDOJISTAR` +100) | `CDLDOJISTAR` bullish = `LONG(b1) and black(b1) and DOJI(b2) and body_gap_down(b2,b1)`. Morning doji star adds exactly those and more. Exact containment. |
| **Evening Doji Star** | b1,b2 | **Bearish Doji Star** (`CDLDOJISTAR` −100) | same, mirrored |
| **Abandoned Baby Bottom** | b1,b2,b3 | **Morning Doji Star** (whole pattern) | Abandoned baby = morning doji star + `shadow_gap_down(b2,b1)` + `shadow_gap_up(b3,b2)`; and `shadow_gap ⇒ body_gap`, so every clause of morning doji star is implied. **Strict superset in constraints ⇒ strict subset in matches.** |
| **Abandoned Baby Top** | b1,b2,b3 | **Evening Doji Star** (whole pattern) | same |
| **Abandoned Baby (either)** | b1,b2 | **Doji Star** | transitively |
| **Morning Star** | b1,b2 | *(star position only — no named 2-bar TA-Lib pattern unless `b2` is a doji)* | If `b2` is a doji, Morning Star and Morning Doji Star **both** fire. See D-2. |
| **Upside/Downside Tasuki Gap** | b1,b2 | **Rising / Falling Window** (Bulkowski 2-line) | The gap IS the window. No TA-Lib 2-bar equivalent. |
| **Gap Side-by-Side White Lines** | b1,b2 | **Rising / Falling Window** | same |
| **Up/Downside Gap Three Methods** | b1,b2 | **Rising / Falling Window** (only in Bulkowski's window variant) | TA-Lib's body-gap version does **not** contain a window. |
| **Three-Line Strike** (4-bar) | b1..b3 | **Three White Soldiers / Three Black Crows** | `CDL3LINESTRIKE`'s first three bars are the soldiers/crows skeleton — but its "opens within/near" uses a **two-sided ±NEAR**, unlike `CDL3WHITESOLDIERS`. **NOT** a strict containment. Do not assert it. |

**Explicitly NOT containments** (checked, and each is a plausible mistake):
- **Upside Gap Two Crows ⊅ Bearish Engulfing.** `b3` engulfs `b2`, but both are **black**; `CDLENGULFING` requires opposite colours. It is a same-colour body engulf, which is not the engulfing pattern.
- **Unique Three River Bottom ⊅ Harami.** `CDLUNIQUE3RIVER` allows `b2.o == b1.o` and imposes **no short-body test** on `b2`; `CDLHARAMI` requires strict containment and `SHORT(b2)`. Overlapping, not nested — TA-Lib's own comment calls `b2` a "harami candle" loosely.
- **Identical Three Crows ⊄ Three Black Crows.** Opens *at* the prior close vs *inside* the prior body — near-disjoint, not nested (see D-2).
- **Morning Doji Star ⊄ Morning Star.** `BodyDoji` (0.10 × avg *range*) and `BodyShort` (1.00 × avg *body*) are different thresholds. Almost always nested in practice, never guaranteed.
- **Tri-Star ⊅ Doji Star.** `CDLDOJISTAR` needs a **long** first body; tri-star's first bar is a doji.

### D-2. Same-three-bars collisions — patterns that can fire TOGETHER
These are not containments; they are ambiguities that need an explicit precedence rule.

| Colliding set | Can co-fire? | Discriminator / precedence |
|---|---|---|
| Morning Star ↔ Morning Doji Star | **Yes**, whenever `b2` is both doji and short | Emit **Morning Doji Star** (rank 25 vs 12 on performance, but 76% vs 78% reversal — the doji is the more specific claim). |
| Morning Doji Star ↔ Abandoned Baby Bottom | **Yes** (abandoned baby always also satisfies MDS) | Emit **Abandoned Baby** — strict subset, and freq rank 92 makes it far more informative. |
| Three White Soldiers ↔ Advance Block | **No, by construction** for AB branches w1/w2 — they are the exact logical negation of 3WS's two "not far shorter" tests. Practically no for w3/w4. | See D-3. |
| Three White Soldiers ↔ Deliberation | **No** — `body(b3) > avg_body` (3WS) vs `body(b3) < avg_body` (deliberation). Exact negation. | — |
| **Advance Block ↔ Deliberation** | **YES — these genuinely overlap.** | Deliberation adds `LONG(b2)` and `SHORT(b3)`; advance block branch w2 (`body(b3) < body(b2) − FAR`) is satisfiable simultaneously. **Precedence: Deliberation** (its conditions are strictly more specific: it pins both `b1` and `b2` as long *and* `b3` as short). |
| Two Crows ↔ Upside Gap Two Crows | **No** — two crows needs `b3.c` inside `b1`'s body; upside gap two crows needs `b3.c > b1.c`. Disjoint. | — |
| Three Black Crows ↔ Identical Three Crows | Boundary only (within `EQ`) | Emit **Identical Three Crows** (rank 24 vs 3 — but it is the more specific structure; alternatively emit both and let rank decide). |
| Three Outside Up ↔ Three Inside Up | **No** — engulfing (`b2` outside `b1`) vs harami (`b2` inside `b1`). | — |
| Tasuki Gap ↔ Up/Downside Gap Three Methods | **Nearly**: both are gap + opposite-colour `b3`. Tasuki requires `b3.c` to stay **inside the gap**; gap-three-methods requires `b3.c` to land **inside `b1`'s body** (gap filled). Disjoint. | — |

### D-3. THE ADVANCE BLOCK / DELIBERATION / THREE WHITE SOLDIERS DISCRIMINATOR
All three are *three rising white candles*. They share an identical skeleton in TA-Lib:
```python
white(b1) and white(b2) and white(b3) and b3.c > b2.c > b1.c
and b2.o > b1.o and b2.o <= b1.c + NEAR(b1)
and b3.o > b2.o and b3.o <= b2.c + NEAR(b2)
```
(Deliberation drops the `b3.o` clause and substitutes the shoulder test.) Everything else is **degree**, and TA-Lib quantifies it exactly:

| Measurement | Three White Soldiers | Advance Block | Deliberation |
|---|---|---|---|
| `body(b2)` vs `body(b1)` | **`> body(b1) − FAR(b1)`** | **`< body(b1) − FAR(b1)`** (branch w1) or `< body(b1)` (w3) | `body(b1)` and `body(b2)` both `> avg_body(10)` (both LONG) |
| `body(b3)` vs `body(b2)` | **`> body(b2) − FAR(b2)`** | **`< body(b2) − FAR(b2)`** (w2), or `< body(b2)` with shadow evidence (w3/w4) | — |
| `body(b3)` absolute | **`> avg_body(b3,10)`** (not short) | not constrained directly | **`< avg_body(b3,10)`** (SHORT) ← *the deliberation signature* |
| `upper(b1)` | `< 0.10 * avg_rng(b1,10)` | `< 0.5 * avg_shadows(b1,10)` (looser: "a short shadow is accepted too for more flexibility") | not constrained |
| `upper(b2)` | `< 0.10 * avg_rng(b2,10)` | may exceed `0.5*avg_shadows(b2,10)` (w3) | **`< 0.10 * avg_rng(b2,10)`** (very short) |
| `upper(b3)` | `< 0.10 * avg_rng(b3,10)` | may exceed `0.5*avg_shadows` (w3) or exceed **`body(b3)`** (w4, `ShadowLong`) | not constrained |
| `b3.o` placement | `> b2.o` and `<= b2.c + NEAR(b2)` | same | **`>= b2.c − body(b3) − NEAR(b2)`**, no upper bound ("rides on the shoulder") |

**`FAR = 0.60 × avg_rng(prev 5)` is the single number that separates soldiers from advance block.**
A body that shrinks by **less** than 60% of the recent average daily range → still a soldier.
A body that shrinks by **more** than 60% of the recent average daily range → the advance is blocked.
Note it is scaled by *range*, not by the prior body — so on a wide-range name a soldier may shrink a lot in absolute terms and still qualify.

**`avg_body(10)` on `b3` is the single number that separates deliberation from both others.** Deliberation is the case where the advance does not merely slow — the third candle collapses to a short line while the first two stay long.

Decision order for the CANDLE column:
```
if deliberation_conditions:      -> "Deliberation"        # most specific (pins b1, b2 long AND b3 short)
elif advance_block_conditions:   -> "Advance Block"
elif three_white_soldiers:       -> "Three White Soldiers"
```

**Do not gate on trend, but do attach it.** All three are the *same shape*; only the prior trend tells you whether three rising candles are a bottom reversal (soldiers, after a decline) or an exhaustion warning (advance block / deliberation, after an advance). Bulkowski's tables put trend in row 2 for all three, and the trends are **opposite**: soldiers = "Downward", advance block and deliberation = "Upward". A shape-only classifier will label bottoming action as exhaustion roughly as often as it gets it right.

### D-4. Sign-flip warnings (theory vs Bulkowski's measurement)
Nine patterns in this family behave **opposite to their textbook label** in Bulkowski's data. Emit `theory_bias` and `measured_bias` as separate fields.

| Pattern | Theory | Measured | Rate | Perf. rank |
|---|---|---|---|---|
| Advance Block | bearish reversal | **bullish continuation** | 64% | 54 |
| Deliberation | bearish reversal | **bullish continuation** | 77% | 93 |
| Stick Sandwich | bullish reversal | **bearish continuation** | 62% | **14** ← acts on it |
| Unique Three River Bottom | bullish reversal | **bearish continuation** | 60% | 60 |
| Upside Gap Two Crows | bearish reversal | **bullish continuation** | 60% | 74 |
| Upside Gap Three Methods | bullish continuation | **bearish reversal** | 59% | 27 |
| Downside Gap Three Methods | bearish continuation | **bullish reversal** | 62% | 26 |
| Concealing Baby Swallow (4-bar) | bullish reversal | **bearish continuation** | 75% | 101 |
| Three Stars in the South | bullish reversal | bullish reversal | 86% | **103**, n=9 — statistic is noise |

---

## E. IMPLEMENTATION CHECKLIST (distilled)

1. `penetration = 0.5`, not TA-Lib's 0.3 (six sources vs one). Expose `penetration_pct` on every star match.
2. Abandoned baby uses **shadow** gaps (`low > high`); everything else in the star and crow families uses **body** gaps. Expect ~0–1 abandoned babies per day across 3,700 names; a higher rate means the predicate has degraded to a body gap.
3. Rolling baselines **exclude the current bar** and are simple means of the **previous 10** (bodies/ranges) or **previous 5** (Near/Far/Equal). Do not substitute an EMA that includes the current bar (TradingView does; it changes the answer on the bar you are classifying).
4. `ShadowLong` / `ShadowVeryLong` have `avgPeriod = 0` → the threshold is the **bar's own real body**, not a rolling average.
5. `Shadows` range type is **divided by 2** — `ShadowShort` is the mean *one-sided* shadow.
6. `BodyLong` and `BodyShort` share a threshold under TA-Lib defaults. If you widen LONG, re-audit every pattern that says "3rd: longer than short" — and turn `require_long_bodies` **on** for three white soldiers and three black crows, where the source majority is 5-to-1 and 6-to-1 against TA-Lib.
7. `CDL3BLACKCROWS` needs **4 bars**. Every other pattern here needs 3. `CDL3OUTSIDE` needs **no warm-up at all** (zero `TA_CANDLEAVERAGE` calls).
8. TA-Lib treats `close == open` as **white** (`TA_CANDLECOLOR` returns +1 on `>=`). A flat bar is a white bar.
9. Doji needs **two** clauses: `body <= 0.10*avg_rng(10)` **and** `body <= 0.05*rng(bar)`. The one-clause version declares doji on wide-range gap days.
10. Ranking: abandoned baby > doji-star variant > plain star; three-outside > engulfing; three-inside > harami; identical-three-crows > three-black-crows; deliberation > advance block > three white soldiers.
11. Trend is **not** a gate — it is a *classifier*. Bullish pattern + uptrend = continuation (StockCharts), not a rejection. Attach `trend_context`, never drop silently.
12. Nine patterns behave **opposite** to their textbook label in Bulkowski's data (§D-4). Emit `theory_bias` and `measured_bias` separately. Stick sandwich (rank 14, acts bearish) is the one people will actually trade on.
13. Never surface a Bulkowski statistic with n < 100 (three stars in the south n=9, collapsing doji star n=16, bearish abandoned baby "<20 samples").
14. Body-to-body containment only for three-inside/three-outside — **never** test whether shadows are contained. All four sources that address it agree.

---

## F. SOURCES

**Primary — executable**
1. TA-Lib C source, candlestick functions — https://github.com/TA-Lib/ta-lib/tree/main/src/ta_func
   (`ta_CDLMORNINGSTAR.c`, `ta_CDLEVENINGSTAR.c`, `ta_CDLMORNINGDOJISTAR.c`, `ta_CDLEVENINGDOJISTAR.c`, `ta_CDLABANDONEDBABY.c`, `ta_CDL3WHITESOLDIERS.c`, `ta_CDL3BLACKCROWS.c`, `ta_CDLIDENTICAL3CROWS.c`, `ta_CDL3INSIDE.c`, `ta_CDL3OUTSIDE.c`, `ta_CDL3STARSINSOUTH.c`, `ta_CDLADVANCEBLOCK.c`, `ta_CDLSTALLEDPATTERN.c`, `ta_CDLUNIQUE3RIVER.c`, `ta_CDLSTICKSANDWICH.c`, `ta_CDLUPSIDEGAP2CROWS.c`, `ta_CDL2CROWS.c`, `ta_CDLTRISTAR.c`, `ta_CDLXSIDEGAP3METHODS.c`, `ta_CDLTASUKIGAP.c`, `ta_CDLGAPSIDESIDEWHITE.c`, `ta_CDL3LINESTRIKE.c`, `ta_CDLENGULFING.c`, `ta_CDLHARAMI.c`, `ta_CDLHARAMICROSS.c`, `ta_CDLDOJISTAR.c`)
2. TA-Lib candle settings defaults — https://github.com/TA-Lib/ta-lib/blob/main/src/ta_common/ta_global.c (`TA_CandleDefaultSettings[]`)
3. TA-Lib candle macros — https://github.com/TA-Lib/ta-lib/blob/main/src/ta_func/ta_utility.h (`TA_CANDLEAVERAGE`, `TA_CANDLERANGE`, `TA_REALBODYGAPUP/DOWN`, `TA_CANDLEGAPUP/DOWN`)

4. **TradingView "All Candlestick Patterns" Pine source** — https://github.com/shunjizhan/all-candlestick-pattern-indicators/blob/main/all-patterns.pine
   (`C_Len = 14`, `C_ShadowPercent = 5.0`, `C_DojiBodyPercent = 5.0`, `C_Factor = 2.0`, `C_ShadowEqualsPercent = 100.0`; exact conditions for morning/evening star, doji star variants, 3WS, 3BC, abandoned baby, tri-star, Tasuki)

**Primary — statistical / definitional**
5. Thomas Bulkowski, thepatternsite.com (*Encyclopedia of Candlestick Charts*) — index: https://www.thepatternsite.com/CandleEntry.html
   Pattern pages used: MorningStar, EveningStar, MorningDojiStar, EveningDojiStar, AbandonBabyBull, AbandonBaby, ThreeWhiteSoldiers, ThreeBlackCrows, Identical3Crows, ThreeInsideUp, ThreeInsideDown, ThreeOutsideUp, ThreeOutsideDown, TriStarBull, TriStarBear, AdvanceBlock, Deliberation, Unique3RiverBottom, StickSandwich, UpGapTwoCrows, TwoCrows, ThreeStarsSouth, UpGap3Methods, DownGap3Methods, SidebySideWhiteLinesBull, CollapseDojiStar, ConcealBaby, TwoBlackGapping
   (e.g. https://www.thepatternsite.com/MorningStar.html , https://thepatternsite.com/AdvanceBlock.html , https://thepatternsite.com/Deliberation.html)
6. StockCharts ChartSchool — Candlestick Pattern Dictionary, Bullish/Bearish Reversal Patterns, Introduction to Candlesticks. Full corpus: https://chartschool.stockcharts.com/llms-full.txt ; site: https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts (any page + `.md` returns clean source)
7. **thinkorswim Learning Center — Candlestick Patterns Library** — https://toslc.thinkorswim.com/center/reference/Patterns/candlestick-patterns-library
   The only non-TA-Lib source with *parameterized* definitions (`length`, `body factor`, `shadow factor`, `trend setup`). Covers the nine patterns Investopedia lacks: AdvanceBlock, Deliberation, IdenticalThreeCrows, TwoCrows, UpsideGapTwoCrows, ThreeStarsInTheSouth, UniqueThreeRiverBottom, MorningDojiStar/EveningDojiStar, Upside/DownsideGapThreeMethods.
8. CandleScanner pattern encyclopedia — https://www.candlescanner.com/candlestick-patterns/ and https://www.candlescanner.com/patterns-dictionary/
   Global tolerance machinery: https://www.candlescanner.com/candlestick-patterns/long-and-short-lines/ (70% of 25-bar EMA of H−L) · https://www.candlescanner.com/candlestick-patterns/doji-2/ (3% of candle height) · https://www.candlescanner.com/candlestick-patterns/scanner-settings/
   Pattern pages: morning-star, evening-star, morning-doji-star, bullish-/bearish-abandoned-baby, three-white-soldiers, three-black-crows, identical-three-crows, advance-block, deliberation, unique-three-river-bottom, three-stars-in-the-south, two-crows, upside-gap-two-crows, bullish-/bearish-tri-star, three-inside-up/-down, three-outside-up
9. Investopedia — /terms/m/morningstar.asp, /terms/e/eveningstar.asp, /terms/b/bearish-abandoned-baby.asp, /terms/t/three-inside-updown.asp, /terms/t/three-outside-updown.asp, /terms/t/tri-star.asp, /terms/a/advance-block.asp, /terms/s/stick-sandwich.asp, three white soldiers, three black crows (11 pages fetched; 9 patterns verified absent)
10. Candlesticker pattern database (Japanese names, Nison-derived) — https://www.candlesticker.com/Pattern.aspx?lang=en&Pattern=3101 (morning star) and `Pattern=3201` (evening star)

**Primary — doctrinal**
11. **Steve Nison, via his own site** — https://www.candlecharts.com/candlestick-patterns/ — verbatim morning-star and evening-star definitions ("gaps lower **to form a star**", "closes **well into** the first session's black real body"). Settles the gap question: **one gap, left side, body-to-body, no number.**
12. Greg Morris, *Candlestick Charting Explained* — via TA-Lib source comments (which name him directly on soldiers and stars) and CandleScanner/Bulkowski attribution of three-inside and three-outside to Morris. Also https://en.wikipedia.org/wiki/Three_white_soldiers ("ideally in the middle price range of that previous day").
13. TradingView official docs — https://www.tradingview.com/support/solutions/43000583787-morning-star-bullish/ , /43000583793-three-white-soldiers-bullish/ , /43000583792-three-black-crows-bearish/ , /43000584462-automatic-candlestick-pattern-detection/
14. Huntraders — https://huntraders.com/candlestick-patterns/bearish-deliberation-candle (deliberation detail)
