# Researcher 02 — ALL TWO-BAR CANDLESTICK PATTERNS

Authoritative reference for the CANDLE screener column. Every rule below is executable
against `bar[-2]` and `bar[-1]` only (plus rolling averages for size normalization).

**Research date:** 2026-08-24. All TA-Lib rules are quoted **verbatim from the C source**
(downloaded, not recalled). All Bulkowski / CandleScanner rules are quoted verbatim from the
live pages. Where a source was paraphrased by a summarizer rather than quoted, it is marked
`[paraphrase]`.

---

## 0. NOTATION & NORMALIZED QUANTITIES (use these everywhere)

```
bar[-2] = (o1, h1, l1, c1)          # the PRIOR bar
bar[-1] = (o2, h2, l2, c2)          # the NEWEST bar (the one being classified)

body(i)     = abs(c - o)
rng(i)      = h - l                          # full high-low range
bodyTop(i)  = max(o, c)
bodyBot(i)  = min(o, c)
upSh(i)     = h - bodyTop(i)
loSh(i)     = bodyBot(i) - l
white(i)    = c >  o                         # STRICT — see §TIE POLICY
black(i)    = c <  o                         # STRICT
doji_col(i) = c == o                         # third, explicit state

mid1        = (o1 + c1) / 2                  # midpoint of the PRIOR BODY  (NOT of the range)
pen         = penetration of bar[-1]'s close into bar[-2]'s body, as a FRACTION of body(1):
              bullish case (bar[-2] black):  pen = (c2 - c1) / body(1)
              bearish case (bar[-2] white):  pen = (c1 - c2) / body(1)
              pen = 0.5  <=>  c2 lands exactly on mid1
              pen = 1.0  <=>  c2 lands exactly on o1
```

Rolling normalizers — **TA-Lib's window EXCLUDES the bar being tested** (verbatim comment:
*"when avgPeriod is not 0, that means 'compare with the previous candles' (it excludes the
current candle)"*). Replicate that or your counts will not match TA-Lib.

```
avgBody10(i) = mean(body(k) for k in [i-10 .. i-1])          # TA_BodyLong / TA_BodyShort
avgRange10(i)= mean(rng(k)  for k in [i-10 .. i-1])          # TA_BodyDoji / TA_ShadowVeryShort
avgRange5(i) = mean(rng(k)  for k in [i-5  .. i-1])          # TA_Near / TA_Far / TA_Equal
ATR14        = Wilder ATR(14)                                 # for gap normalization (not TA-Lib)

LONG(i)   := body(i) >  1.0 * avgBody10(i)      # TA_BodyLong      factor 1.0, period 10, RealBody
VLONG(i)  := body(i) >  3.0 * avgBody10(i)      # TA_BodyVeryLong  factor 3.0
SHORT(i)  := body(i) <= 1.0 * avgBody10(i)      # TA_BodyShort     factor 1.0  (NOTE: same threshold
                                                #   as LONG — LONG and SHORT partition on `>` vs `<=`)
DOJI(i)   := body(i) <= 0.10 * avgRange10(i)    # TA_BodyDoji      factor 0.10, period 10, HighLow
VSHORT_SH(i) := upSh(i) < 0.10*avgRange10(i)  AND  loSh(i) < 0.10*avgRange10(i)
                                                # TA_ShadowVeryShort factor 0.10, period 10, HighLow
EQ(i)     := 0.05 * avgRange5(i)                # TA_Equal  factor 0.05, period 5, HighLow
NEAR(i)   := 0.20 * avgRange5(i)                # TA_Near
FAR(i)    := 0.60 * avgRange5(i)                # TA_Far
```

**Source for every default above:** TA-Lib `src/ta_common/ta_global.c`,
`TA_CandleDefaultSettings[]`, quoted verbatim in §SOURCES.

### GAP DEFINITIONS — two different things, do not conflate

TA-Lib defines **both** and uses them for **different patterns** (`src/ta_func/ta_utility.h`):

```c
#define TA_REALBODYGAPUP(IDX2,IDX1)   ( min(inOpen[IDX2],inClose[IDX2]) > max(inOpen[IDX1],inClose[IDX1]) )
#define TA_REALBODYGAPDOWN(IDX2,IDX1) ( max(inOpen[IDX2],inClose[IDX2]) < min(inOpen[IDX1],inClose[IDX1]) )
#define TA_CANDLEGAPUP(IDX2,IDX1)     ( inLow[IDX2]  > inHigh[IDX1] )
#define TA_CANDLEGAPDOWN(IDX2,IDX1)   ( inHigh[IDX2] < inLow[IDX1] )
```

- **BODY gap** (`REALBODYGAP`): bodies do not overlap; **shadows may overlap freely**.
  Used by: **doji star (bullish/bearish)**, and all star patterns.
  Bulkowski confirms independently for the bullish doji star: *"a doji ... that gaps below the
  prior candle's body. **The shadows can overlap**"*.
- **PRICE / SHADOW gap** (`CANDLEGAP`): the entire bars are disjoint, shadows included.
  Used by: **kicking**, **kicking by length**, **rising/falling window**.
- **OPEN-vs-shadow gap** (a third, weaker form, inline in the source, not a macro):
  `o2 < l1` or `o2 > h1` — only the OPEN must clear the prior shadow; the rest of bar[-1]
  may reach deep back into bar[-2].
  Used by: **piercing, dark cloud cover, on-neck, in-neck, thrusting**.

**Rule for the implementer:** star patterns → body gap. Kickers and windows → price gap.
Piercing/dark-cloud/neck family → open-vs-shadow gap. Getting this wrong changes hit
counts by roughly an order of magnitude on daily US equities (US stocks gap the body far more
often than they gap the whole bar).

### TIE POLICY (the thing the current implementation gets wrong)

Every rule below states strict (`<`, `>`) vs non-strict (`<=`, `>=`) explicitly.
Two structural principles, both taken from the sources:

1. **TA-Lib's colour test is `close >= open ? WHITE : BLACK`.** A doji (`c == o`) is
   therefore classified **WHITE**, not neutral. This is a real, load-bearing quirk: it means
   TA-Lib will **never** fire a bullish engulfing when bar[-2] is a doji (it needs bar[-2]
   BLACK), which directly contradicts **Nison's explicit doji exception**. Decide this
   deliberately; do not inherit it by accident.
2. **A double tie must not count as engulfing.** TA-Lib encodes this with an OR of two
   half-strict clauses (see §1). Bulkowski encodes the mirror rule for harami verbatim:
   *"The tops or bottoms of the bodies can be the same price, **but not both**."*

---

## (a) SUMMARY TABLE — one-line executable rule per pattern

`B` = bullish, `Br` = bearish, `R` = reversal, `C` = continuation.
"Trend" = prior-trend context the source requires.

| # | Pattern | Bias | R/C | Trend | One-line executable rule (bar[-2]=1, bar[-1]=2) |
|---|---------|------|-----|-------|--------------------------------------------------|
| 1 | Bullish engulfing (*tsutsumi*) | B | R | down | `black(1) and white(2) and ((c2>=o1 and o2<c1) or (c2>o1 and o2<=c1))` |
| 2 | Bearish engulfing (*tsutsumi*) | Br | R | up | `white(1) and black(2) and ((o2>=c1 and c2<o1) or (o2>c1 and c2<=o1))` |
| 3 | Bullish harami (*harami*) | B | R | down | `black(1) and LONG(1) and white(2) and SHORT(2) and bodyTop(2)<=o1 and bodyBot(2)>=c1 and not(both ends tie)` |
| 4 | Bearish harami (*harami*) | Br | R | up | `white(1) and LONG(1) and black(2) and SHORT(2) and bodyTop(2)<=c1 and bodyBot(2)>=o1 and not(both ends tie)` |
| 5 | Bullish harami cross (*harami yose sen*) | B | R | down | rule 3 with `SHORT(2)` → `DOJI(2)` (containment convention: see §5) |
| 6 | Bearish harami cross (*harami yose sen*) | Br | R | up | rule 4 with `SHORT(2)` → `DOJI(2)` |
| 7 | Piercing line (*kirikomi*) | B | R | down | `black(1) and LONG(1) and white(2) and LONG(2) and o2<l1 and c2<o1 and pen>0.5` |
| 8 | Dark cloud cover (*kabuse*) | Br | R | up | `white(1) and LONG(1) and black(2) and o2>h1 and c2>o1 and pen>0.5` |
| 9 | Tweezer top (*kenukitenjo*) | Br | R | up | `abs(h2-h1) <= TOL` (TOL: see §9 — the single largest tolerance argument) |
| 10 | Tweezer bottom (*kenukizoko*) | B | R | down | `abs(l2-l1) <= TOL` |
| 11 | Bullish kicker / kicking | B | R | **none** | `black(1) and LONG(1) and VSHORT_SH(1) and white(2) and LONG(2) and VSHORT_SH(2) and l2>h1` |
| 12 | Bearish kicker / kicking | Br | R | **none** | `white(1) and LONG(1) and VSHORT_SH(1) and black(2) and LONG(2) and VSHORT_SH(2) and h2<l1` |
| 13 | Bullish counterattack / meeting lines (*deaisen*) | B | R | down | `black(1) and LONG(1) and white(2) and LONG(2) and abs(c2-c1)<=EQ` **+ gap-down open (see §13)** |
| 14 | Bearish counterattack / meeting lines (*deaisen*) | Br | R | up | `white(1) and LONG(1) and black(2) and LONG(2) and abs(c2-c1)<=EQ` **+ gap-up open** |
| 15 | On-neck line (*atekubi*) | Br | **C** | down | `black(1) and LONG(1) and white(2) and o2<l1 and abs(c2-l1)<=EQ` |
| 16 | In-neck line (*irikubi*) | Br | **C** | down | `black(1) and LONG(1) and white(2) and o2<l1 and c1<=c2<=c1+EQ` |
| 17 | Thrusting line (*sashikomi*) | Br | **C** | down | `black(1) and LONG(1) and white(2) and o2<l1 and c2>c1+EQ and c2<=mid1` (i.e. `0<pen<=0.5`) |
| 18 | Bullish separating lines (*iki chigai sen*) | B | **C** | **up** | `black(1) and white(2) and abs(o2-o1)<=EQ and LONG(2) and loSh(2)<0.10*avgRange10` |
| 19 | Bearish separating lines (*iki chigai sen*) | Br | **C** | **down** | `white(1) and black(2) and abs(o2-o1)<=EQ and LONG(2) and upSh(2)<0.10*avgRange10` |
| 20 | Matching low (*niten zoko*) | B (theory) | R | down | `black(1) and black(2) and abs(c2-c1)<=EQ` |
| 21 | Homing pigeon (*shita banare kobato gaeshi*) | B | R | down | `black(1) and LONG(1) and black(2) and SHORT(2) and o2<o1 and c2>c1` |
| 22 | Descending hawk (*kakouchu no taka*) | Br | R | up | `white(1) and LONG(1) and white(2) and SHORT(2) and o2>o1 and c2<c1` |
| 23 | Last engulfing top | Br | R | **up** | **geometry of #1** occurring in an UPTREND |
| 24 | Last engulfing bottom | B | R | **down** | **geometry of #2** occurring in a DOWNTREND |
| 25 | Bullish doji star (*doji bike*) | B | R | down | `black(1) and LONG(1) and DOJI(2) and bodyTop(2) < bodyBot(1)` (**BODY** gap down) |
| 26 | Bearish doji star (*doji bike*) | Br | R | up | `white(1) and LONG(1) and DOJI(2) and bodyBot(2) > bodyTop(1)` (**BODY** gap up) |
| 27 | Above the stomach | B | R | down | `black(1) and white(2) and o2>=mid1 and c2>=mid1` |
| 28 | Below the stomach | Br | R | up | `white(1) and bodyTop(2)<=mid1` (2nd colour not required — Bulkowski) |
| 29 | Two black gapping | Br | **C** | down | `black(1) and black(2) and gap-down into bar[-2] and h2<h1` |
| 30 | Inverted hammer (2-line) | B (theory) | R | down | `black(1) and LONG(1) and c1 near l1 and SHORT(2) and not DOJI(2) and upSh(2) tall and loSh(2)~0 and o2<c1` |
| 31 | Shooting star (2-line) | Br | R | up | `white(1) and SHORT(2) and upSh(2)>=3*body(2) and loSh(2)~0 and body-gap up` (2nd any colour) |
| 32 | Rising window | B | **C** | up | `l2 > h1` (pure price gap) |
| 33 | Falling window | Br | **C** | down | `h2 < l1` (pure price gap) |
| 34 | Matching high (mirror of #20) | Br | R | up | `white(1) and white(2) and abs(c2-c1)<=EQ` — **not in TA-Lib**, no Bulkowski stats |

---

## (b) DETAILED BLOCK PER PATTERN

### 1 & 2. BULLISH / BEARISH ENGULFING

**Names.** Engulfing pattern; *tsutsumi* (包み, "to wrap/engulf"); "outside bar" in Western TA
(not identical — the outside bar uses high/low, engulfing uses the BODY).
Extended form = three outside up / three outside down.

**TA-Lib `ta_CDLENGULFING.c` — verbatim:**
```c
if( ((inClose[i] >= inOpen[i]) ? 1 : -1) == 1 && ((inClose[i-1] >= inOpen[i-1]) ? 1 : -1) == -1 &&
    (inClose[i] >= inOpen[i-1] && inOpen[i] <  inClose[i-1] ||
     inClose[i] >  inOpen[i-1] && inOpen[i] <= inClose[i-1])   /* white engulfs black */
 || ((inClose[i] >= inOpen[i]) ? 1 : -1) == -1 && ((inClose[i-1] >= inOpen[i-1]) ? 1 : -1) == 1 &&
    (inOpen[i] >= inClose[i-1] && inClose[i] <  inOpen[i-1] ||
     inOpen[i] >  inClose[i-1] && inClose[i] <= inOpen[i-1]) ) /* black engulfs white */
{
   if( inOpen[i] != inClose[i-1] && inClose[i] != inOpen[i-1] )
        outInteger[outIdx++] = colour(i) * 100;   /* strict engulf */
   else outInteger[outIdx++] = colour(i) *  80;   /* one end matches — Greg Morris's case */
}
```

Executable, decomposed:

```python
# BULLISH ENGULFING
opposite_colour = black(1) and white(2)                  # TA-Lib: colour(1) == -colour(2)
engulfs = (c2 >= o1 and o2 <  c1) or (c2 >  o1 and o2 <= c1)   # >=1 end STRICT
strict  = (o2 != c1) and (c2 != o1)                      # 100 if strict, 80 if one end ties
# BEARISH ENGULFING  — mirror
opposite_colour = white(1) and black(2)
engulfs = (o2 >= c1 and c2 <  o1) or (o2 >  c1 and c2 <= o1)
```

- **Prior body must be opposite-coloured?** **YES** in every source except that they differ on
  the doji case.
  - *Nison* (3 criteria, verbatim from the book's framing): (1) *"the market has to be in a
    clearly definable uptrend or downtrend, even if the trend is short term"*; (2) *"the second
    real body must engulf the prior real body (**it does not need to engulf the shadows**)"*;
    (3) *"the second real body ... should be the opposite colour of the first real body"* —
    **with the explicit exception**: *"if the first real body ... is so small it is almost a
    doji, or is a doji ... a doji engulfed by a very large white real body can be a bottom
    reversal."*
  - *TA-Lib*: opposite colour REQUIRED, and because its colour test is `c >= o ? white : black`,
    a doji is WHITE — so **TA-Lib cannot fire a bullish engulfing on a doji bar[-2]**, directly
    contradicting Nison's exception. (It CAN fire a bearish engulfing on a doji bar[-2].)
  - *CandleScanner*: bar[-2] *"can be any black basic candle, appearing both as a long or a
    short line. **It can even be a doji candle, except the Four-Price Doji**"*.
- **Must shadows be engulfed?** **NO** — unanimous. Nison: *"it does not need to engulf the
  shadows"*. Bulkowski (bullish): *"**Ignore the shadows**."* Bulkowski (bearish):
  *"Shadows are unimportant."*
- **Minimum size of the ENGULFED body?** No source sets a floor on bar[-2]'s body.
  CandleScanner explicitly allows it to be a doji. **But CandleScanner requires bar[-1] to be a
  LONG LINE** (*"The second line is any white candle appearing as a long line"*), and Bulkowski's
  bullish wording requires the second to be *"a **taller** white one"*. TA-Lib imposes **no size
  test at all** on either bar — this is TA-Lib's biggest false-positive source for engulfing.
- **Bulkowski — Identification Guidelines, verbatim:**
  - Bullish: *"Number of candle lines: Two. Price trend leading to the pattern: **Downward**.
    Look for two candles in a downward price trend. The first is a black candle followed by a
    taller white one. The white candle should have a close above the prior open and an open
    below the prior close. In other words, the body of the white candle should engulf or overlap
    the body of the black candle. Ignore the shadows."*
  - Bearish: *"Price trend leading to the pattern: **Upward**. ... The first candle is white and
    the second is black. The body of the black candle is taller and **overlaps** the candle of
    the white body. Shadows are unimportant."*
  - Note Bulkowski's own asymmetry: bullish says "engulf **or overlap**", bearish says "overlaps".
    Read strictly this is looser than TA-Lib; his charts show full engulfment. **Recommend
    implementing full body containment with the half-strict tie rule.**
- **Prior trend.** Required by Nison, Bulkowski, CandleScanner, StockCharts. **TA-Lib does not
  apply it** and says so verbatim: *"The user should consider that an engulfing must appear in a
  downtrend if bullish or in an uptrend if bearish, while this function does not consider it."*
  Without trend context the geometry is **ambiguous, not merely weaker**: the identical geometry
  in the opposite trend is **last engulfing top / bottom**, which Bulkowski measured as
  *continuing the prior trend* (68% / 65%) — i.e. the opposite sign. See §23/§24.
- **Bias / class.** Bullish engulfing = bullish reversal; bearish engulfing = bearish reversal.
- **Bulkowski stats.** Bullish: tested bullish reversal **63%**, frequency rank 12, overall
  performance rank **84/103** (*"the post breakout performance can be dreadful"*).
  Bearish: tested bearish reversal **79%**, frequency rank 11, overall performance rank **91/103**.
  Both are *frequent and directionally honest but poor performers* — worth surfacing in the UI.

---

### 3 & 4. BULLISH / BEARISH HARAMI

**Names.** Harami (孕み, "pregnant"); the second bar is the "unborn baby". Western analogue:
inside bar (but harami is BODY-inside-BODY, an inside bar is range-inside-range).
Extended = three inside up / three inside down.

**TA-Lib `ta_CDLHARAMI.c` — verbatim:**
```c
if( fabs(inClose[i-1]-inOpen[i-1]) > TA_CANDLEAVERAGE(BodyLong,...,i-1) )        /* 1st: long */
 if( fabs(inClose[i]-inOpen[i])   <= TA_CANDLEAVERAGE(BodyShort,...,i) )         /* 2nd: short */
  if( max(inClose[i],inOpen[i]) <  max(inClose[i-1],inOpen[i-1]) &&
      min(inClose[i],inOpen[i]) >  min(inClose[i-1],inOpen[i-1]) )   -> ±100
  else if( max(inClose[i],inOpen[i]) <= max(inClose[i-1],inOpen[i-1]) &&
           min(inClose[i],inOpen[i]) >= min(inClose[i-1],inOpen[i-1]) ) -> ±80
/* sign = -colour(i-1) : the 2nd candle's colour is NOT tested */
```

**CRITICAL TA-Lib QUIRK:** `CDLHARAMI` **does not test bar[-1]'s colour at all**. The sign comes
only from bar[-2]. Consequences: TA-Lib's "bullish harami" **includes the homing pigeon**
(black-inside-black) and its "bearish harami" **includes the descending hawk**
(white-inside-white). Every human source requires the second body to be the **opposite** colour:
- Bulkowski bullish: *"a **white** candle should be nestled within the body of the prior candle"*.
- Bulkowski bearish: *"a tall white candle followed by a small **black** one"*.
- CandleScanner bullish: `First candle: black body / Second candle: white body`.
- StockCharts: *"A two-day pattern that has a small body day completely contained within the
  range of the previous body, and **is the opposite color**."*

**Tie rule — Bulkowski, verbatim and unambiguous:**
- Bullish: *"The tops or bottoms of the bodies **can be the same price, but not both**."*
- Bearish: *"Either the tops of the bodies or the bottoms (**or both**) must be a different price."*

This matches TA-Lib's ±100 / ±80 split exactly (100 = both ends strict, 80 = one end ties).
A double tie is not a harami in any source.

**Containment: body-in-body or range-in-body?** TA-Lib and CandleScanner: **body in body**.
StockCharts says *"contained within the range of the previous **body**"* — also body.
(Only the harami CROSS diverges — see §5.)

**Prior trend.** Required by all human sources; TA-Lib explicitly disclaims it.

**Bulkowski stats — the theory/reality gap is severe:**
- Bullish harami: theoretical bullish reversal; **tested bullish reversal 53%** (near random).
  Frequency 25, performance rank 38.
- Bearish harami: theoretical bearish reversal; **tested BULLISH CONTINUATION 53%** — i.e. it
  measured the *opposite* of its label. Frequency 26, performance rank 72.

---

### 5 & 6. HARAMI CROSS

**Names.** Harami cross; *harami yose sen* (寄せ線, "harami with a doji line"); "petrifying pattern".

**TA-Lib `ta_CDLHARAMICROSS.c`:** identical to `CDLHARAMI` with `BodyShort` replaced by
`BodyDoji` on bar[-1]. Same ±100/±80 tie handling, same "2nd candle's colour untested" quirk,
same **body-in-body** containment.

**THE CONTAINMENT CONVENTION IS A THREE-WAY DISAGREEMENT** (this is the real battleground for
this pattern, more than the doji threshold):

| Source | What must be inside what |
|---|---|
| TA-Lib | doji **BODY** inside bar[-2] **BODY** |
| CandleScanner | doji **INCLUDING BOTH SHADOWS** inside bar[-2] **BODY** — verbatim: *"the candle (including shadows) is engulfed by the previous candle's body"* |
| Bulkowski (bullish) | doji inside bar[-2]'s **HIGH-LOW RANGE** — verbatim: *"a doji that fits within the **high-low price range** of the prior day"* |
| Bulkowski (bearish) | *"a doji appears that is **inside (including the shadows) the trading range** of the white candle"* |

CandleScanner is the **strictest** (h2 and l2 both inside body1); Bulkowski is the **loosest**
(h2/l2 inside h1/l1). TA-Lib sits in between. **Consequence: harami cross is a strict subset of
harami under TA-Lib and CandleScanner, but under Bulkowski it is NEITHER a subset nor a superset**
— a doji whose shadows sit inside the prior range but whose body sits outside the prior body is a
Bulkowski harami cross and not a Bulkowski harami.

CandleScanner additionally requires *"a doji candle **with two shadows**"* (excludes dragonfly /
gravestone / four-price doji) and *"appears on as a long line"* for bar[-2].

**Doji threshold.** TA-Lib: `body(2) <= 0.10 * avgRange10`. Bulkowski: *"opening and closing
prices are **within pennies** of each other"* (an absolute, price-level-dependent test — do NOT
port literally to a $3,700-ticker universe; use the normalized form).

**Bulkowski stats — both measured backwards:**
- Bullish harami cross: theoretical bullish reversal; **tested BEARISH CONTINUATION 55%**.
  Frequency 47, performance rank 50.
- Bearish harami cross: theoretical bearish reversal; **tested BULLISH CONTINUATION 57%**.
  Frequency 45, performance rank 80.

---

### 7. PIERCING LINE (PIERCING PATTERN) — *kirikomi*

**THE PENETRATION BATTLEGROUND. Verdict: the sources CONVERGE on strictly greater than 50%,
and additionally on an upper bound almost everyone forgets.**

**TA-Lib `ta_CDLPIERCING.c` — verbatim:**
```c
if( colour(i-1) == -1 &&                                              /* 1st: black  */
    fabs(inClose[i-1]-inOpen[i-1]) > TA_CANDLEAVERAGE(BodyLong,...,i-1) &&  /* long  */
    colour(i)   ==  1 &&                                              /* 2nd: white  */
    fabs(inClose[i]-inOpen[i])   > TA_CANDLEAVERAGE(BodyLong,...,i) &&      /* long  */
    inOpen[i]  <  inLow[i-1]  &&                                      /* open below prior LOW  */
    inClose[i] <  inOpen[i-1] &&                                      /* close within prior body */
    inClose[i] >  fma(fabs(inClose[i-1]-inOpen[i-1]), 0.5, inClose[i-1]) )  /* ABOVE midpoint */
  outInteger[outIdx++] = 100;
```
`fma(body, 0.5, c1)` = `c1 + 0.5*body` = **mid1**. The comparison is `>` — **STRICT**.
So `pen == 0.500000` exactly does **NOT** fire in TA-Lib. Both bodies must be LONG.

**The upper bound.** `inClose[i] < inOpen[i-1]` — the close must stay **strictly below the prior
open** (`pen < 1.0`). If it reaches or exceeds `o1`, the structure is a **bullish engulfing**, not
a piercing line. Three sources state this independently:
- TA-Lib: the `inClose[i] < inOpen[i-1]` clause above.
- Bulkowski, verbatim: *"a white one that opens below the black candle's low and **closes between
  the midpoint of the black body and opening price**."*
- CandleScanner, verbatim: *"the closing above the midpoint of the prior candle's body / the
  closing **below the previous opening**."*

**Executable canonical form:**
```python
piercing = ( black(1) and LONG(1)
         and white(2) and LONG(2)
         and o2 < l1                     # STRICT open-vs-shadow gap down (see disagreement below)
         and c2 < o1                     # STRICT upper bound — else it is an engulfing
         and (c2 - c1) / (o1 - c1) > 0.5 )   # STRICT — pen > 0.5, tie at exactly 0.5 does NOT fire
```

**Where sources disagree — the OPEN, not the penetration:**

| Source | Open requirement | Penetration | Tie at 50% |
|---|---|---|---|
| TA-Lib | `o2 < l1` STRICT | `pen > 0.5` | does NOT fire |
| Nison | below the prior **low**; *"should push **more than halfway** into the black real body"* | `pen > 0.5` | does not fire |
| Bulkowski | *"opens below the black candle's low"* | *"closes between the midpoint ... and opening price"* | ambiguous, reads as `>` |
| CandleScanner | *"the opening **below or equal** of the prior low"* — NON-strict | *"above the midpoint"* | does NOT fire |
| TradingView | *"opens below the **low** of the prior candle, creating a gap"*; first candle *"has a larger than average body"* | *"closes above the midpoint"* | does not fire |
| **StockCharts ChartSchool** | *"The white candlestick must open **below the previous close**"* | *"close above the midpoint of the black candlestick's body"* | — |
| **StockCharts Pattern Dictionary** | *"The next day **opens at a new low**"* | *"then closes above the midpoint of the body of the first day"* | — |

**StockCharts contradicts itself** between its two own pages (previous *close* vs a *new low*).
The overwhelming weight — Nison, Bulkowski, TA-Lib, CandleScanner, TradingView — is
**below the prior LOW**. Use that. (`below the prior close` inflates the hit rate several-fold and
merges piercing with "above the stomach".)

**Nison's reason for the strict 50%, verbatim in substance:** *"the reason for less latitude with
the bullish piercing pattern is the fact that the Japanese have three other patterns called the
on-neck, the in-neck, and the thrusting pattern that have the same basic formation as the piercing
pattern, but which are viewed as **bearish** signals since the white real body gets **less than
halfway** into the black's real body."* — i.e. the 50% line is not a strength grading, it is the
**boundary between a bullish pattern and three bearish ones**. Implement it as a partition.

**Prior trend.** Required (downtrend) by Nison, Bulkowski, CandleScanner, TradingView (optional
SMA50 / SMA50+SMA200 filter). TA-Lib disclaims it verbatim.

**Bias / class.** Bullish reversal. **Bulkowski:** tested bullish reversal **64%**, frequency rank
40, **overall performance rank 13/103** — one of the best-performing two-bar patterns he measured.

---

### 8. DARK CLOUD COVER — *kabuse* ("to get covered / hang over")

**TA-Lib `ta_CDLDARKCLOUDCOVER.c` — verbatim:**
```c
/* Greg Morris wants the close to be below the midpoint of the previous real body ...
 * the penetration of the first real body is specified with optInPenetration */
optInPenetration = 0.5;                                    /* DEFAULT */
if( colour(i-1) == 1 &&                                              /* 1st: white */
    fabs(inClose[i-1]-inOpen[i-1]) > TA_CANDLEAVERAGE(BodyLong,...,i-1) &&  /* long */
    colour(i) == -1 &&                                               /* 2nd: black */
    inOpen[i]  > inHigh[i-1] &&                                      /* open above prior HIGH */
    inClose[i] > inOpen[i-1] &&                                      /* close within prior body */
    inClose[i] < inClose[i-1] - fabs(inClose[i-1]-inOpen[i-1]) * optInPenetration )
  outInteger[outIdx++] = -100;
```

**Asymmetry vs piercing, note it:** TA-Lib requires **LONG(1) only** for dark cloud, but
**LONG(1) AND LONG(2)** for piercing. There is no stated reason; it is an inconsistency in the
library. Decide deliberately (recommend requiring LONG(1) for both, and treating LONG(2) as an
optional strength grade).

**Executable canonical form:**
```python
dark_cloud = ( white(1) and LONG(1)
           and black(2)
           and o2 > h1                    # STRICT open above prior HIGH
           and c2 > o1                    # STRICT lower bound — else it is a bearish engulfing
           and (c1 - c2) / (c1 - o1) > 0.5 )   # STRICT; == 0.5 does NOT fire
```

**Disagreements:**

| Source | Open requirement | Close requirement |
|---|---|---|
| TA-Lib | `o2 > h1` STRICT | `< c1 - 0.5*body1` STRICT, **and** `> o1` |
| Bulkowski | *"an opening price above the top of the white candle (**an opening price above the prior high**)"* | *"a close below the **mid point of the white body**"* |
| Nison | *"opens above the high of the previous candle"*; *"closes well into the white candlestick's real body — **preferably more than halfway**"* | more than halfway |
| CandleScanner | *"the opening **above or equal** of the prior high"* — deliberately relaxed: *"The classic definition ... requires a price gap ... CandleScanner relaxes this condition allowing second's candle opening price to **be equal to** the previous candle's high **because it increases the number of found patterns**"* | *"the closing below the midpoint of the prior candle"* **and** *"the closing **above the previous opening**"* |
| TradingView | *"opens above the high of the prior candle, creating a gap"*; first candle *"larger than average body"* | *"closes below the midpoint of the first candle"* |
| TrendSpider | *"Opens above the previous candle's high (gap-up)"* — mandatory | *"close below the midpoint of the prior bullish candle's **range**"* ← **RANGE, not body. Outlier.** |
| **StockCharts** | *"The black candlestick must open **above the previous close**"* | *"close below the midpoint of the white candlestick's body"* |

Two distinct conflicts: (i) **open above prior HIGH** (5 sources) vs **above prior CLOSE**
(StockCharts alone); (ii) midpoint of the **BODY** (6 sources) vs midpoint of the **RANGE**
(TrendSpider alone). Use **prior HIGH** and **body midpoint**.

**The `c2 > o1` lower bound** is stated by TA-Lib and CandleScanner and is what keeps dark cloud
cover and bearish engulfing mutually exclusive. Nison/Bulkowski/StockCharts omit it — under their
wording, a bearish engulfing that gaps above the prior high **also is** a dark cloud cover.
**Recommend including the bound** (mutual exclusivity is worth more in a single-label column).

**Prior trend.** Uptrend, required by all human sources. TA-Lib verbatim: *"the user should
consider that a dark cloud cover is significant when it appears in an uptrend, while this function
does not consider it."*

**Bias / class.** Bearish reversal. **Bulkowski:** tested bearish reversal **60%**,
frequency rank 46, overall performance rank **22/103**.

---

### 9 & 10. TWEEZER TOP / TWEEZER BOTTOM — *kenukitenjo* / *kenukizoko*

**Not implemented in TA-Lib at all.** There is no `CDLTWEEZER*`. Every threshold is yours to pick,
which makes this the loosest-defined pattern in the set.

**Core rule.** Tweezer top: two adjacent bars with matching **HIGHS** in an uptrend.
Tweezer bottom: two adjacent bars with matching **LOWS** in a downtrend.
Colours are **not** constrained by CandleScanner, Bulkowski, or LuxAlgo.

**TOLERANCE — the whole argument, three incompatible conventions:**

| Source | Tolerance for "matching" |
|---|---|
| **CandleScanner** | **EXACT EQUALITY**, verbatim: *"the high price **equal to** the previous high price"*. Also: both candles *"any candle **except the Four-Price Doji**"*, *"any color"*. And it is an **N-line** pattern: *"Every subsequent day: ... the high price equal to the previous high price"* — the run extends. |
| **Bulkowski (top)** | *"two adjacent candlesticks with **the same (or nearly the same)** high price"* — band, unquantified |
| **Bulkowski (bottom)** | *"two candles sharing the same low price"* — reads as exact; his own top page says "nearly the same". **Bulkowski is internally inconsistent between his own top and bottom pages.** |
| **LuxAlgo** | *"a tolerance of **a tick or two, scaled to the instrument's volatility**, is standard"*; *"exact matches"* not required; *"Opposite colors ... are **not mandatory**. The defining element is the matched extreme."* |

**Recommended executable form** (ATR-normalized, because exact equality across 3,700 tickers is
dominated by tick-size artifacts and low-priced names):

```python
TOL = 0.05 * ATR14          # ~a tick or two on a normal name; tune on real hit counts
tweezer_top    = uptrend   and abs(h2 - h1) <= TOL
tweezer_bottom = downtrend and abs(l2 - l1) <= TOL
```
Do **not** use a fixed percentage of price: a $2 stock and a $900 stock need different bands, and
`0.1% of price` on a $2 name is below the tick. ATR normalizes both.

**LuxAlgo's warning is worth honouring:** *"Require a preceding directional move; matched highs
inside a flat range are routine noise."* Without a trend filter this pattern fires constantly on
range-bound names.

**Bias / class.** Theoretically tweezer top = bearish reversal, bottom = bullish reversal.
**Bulkowski measured both essentially backwards and near-random:**
- Tweezer top: **tested BULLISH CONTINUATION 56%**, frequency 35, performance rank **81/103**.
  He calls both the 56% and 44% figures *"near random"*.
- Tweezer bottom: **tested BEARISH CONTINUATION 52%**, frequency 39, performance rank 44.

**Recommendation: if the CANDLE column must be short, tweezers are the first patterns to drop.**

---

### 11 & 12. KICKER / KICKING

**Names.** Kicker, kicking pattern. TA-Lib ships two variants: `CDLKICKING` and
`CDLKICKINGBYLENGTH` (identical geometry; only the sign convention differs).

**TA-Lib `ta_CDLKICKING.c` — verbatim conditions:**
```c
colour(i-1) == -colour(i) &&                                            /* opposite candles */
fabs(inClose[i-1]-inOpen[i-1]) > TA_CANDLEAVERAGE(BodyLong,...,i-1) &&  /* 1st marubozu: long body */
upperShadow(i-1) < TA_CANDLEAVERAGE(ShadowVeryShort,...,i-1) &&
lowerShadow(i-1) < TA_CANDLEAVERAGE(ShadowVeryShort,...,i-1) &&
fabs(inClose[i]-inOpen[i])     > TA_CANDLEAVERAGE(BodyLong,...,i)   &&  /* 2nd marubozu */
upperShadow(i)   < TA_CANDLEAVERAGE(ShadowVeryShort,...,i) &&
lowerShadow(i)   < TA_CANDLEAVERAGE(ShadowVeryShort,...,i) &&
( colour(i-1)==-1 && inLow[i]  > inHigh[i-1]        /* black then white -> upside PRICE gap   */
||colour(i-1)== 1 && inHigh[i] < inLow[i-1] )       /* white then black -> downside PRICE gap */
-> outInteger = colour(i) * 100;
```

- **The gap is a full PRICE gap** (`l2 > h1` / `h2 < l1`), **not** a body gap. Bulkowski agrees:
  *"a tall black marubozu candle followed by an **upward gap** then a tall white marubozu candle."*
- **Marubozu is enforced numerically:** both shadows `< 0.10 * avgRange10`. Not "no shadow" —
  a 10%-of-average-range tolerance. Requiring literally zero shadows finds almost nothing.
- **`CDLKICKING` signs by the SECOND candle's colour. `CDLKICKINGBYLENGTH` signs by the colour of
  whichever marubozu has the LONGER body** — verbatim: *"the longer of the two marubozu determines
  the bullishness or bearishness of this pattern."* Pick one; do not ship both under one label.

**Prior trend: NOT REQUIRED — this is the exception in the whole set.**
Bulkowski, verbatim, for both variants: *"Price trend leading to the pattern: **None required**."*
TA-Lib's comment block for kicking is the only one in the family that contains **no** "the user
should consider ... trend" disclaimer. The gap itself is the signal.

**Is a kicker also an engulfing? NO — they are mutually exclusive.** Proof: a bullish kicker
requires `l2 > h1 >= o1`, hence `o2 >= l2 > o1 > c1` (bar[-2] is black so `o1 > c1`).
Bullish engulfing requires `o2 <= c1`. Contradiction. The widespread claim that a kicker is a
"gapping engulfing" is **false**. Same for the bearish side.

**Bias / class.** Bullish/bearish reversal. **Bulkowski measured them as nearly useless despite
their dramatic appearance:**
- Bullish kicking: tested bullish reversal **53%**, frequency rank **100/103** (very rare),
  overall performance rank **96/103**.
- Bearish kicking: tested bearish reversal **54%**, frequency rank **102/103**,
  overall performance rank **102/103** — his third-worst pattern.

---

### 13 & 14. COUNTERATTACK LINES / MEETING LINES — *deaisen* (出会い線, "lines that meet")

**Names.** Counterattack lines; meeting lines; *deaisen* / *deai sen*. Bulkowski and CandleScanner
file it as "meeting lines"; TA-Lib as `CDLCOUNTERATTACK`. Same pattern.

**TA-Lib `ta_CDLCOUNTERATTACK.c` — verbatim:**
```c
colour(i-1) == -colour(i) &&                                            /* opposite candles */
fabs(inClose[i-1]-inOpen[i-1]) > TA_CANDLEAVERAGE(BodyLong,...,i-1) &&  /* 1st long */
fabs(inClose[i]-inOpen[i])     > TA_CANDLEAVERAGE(BodyLong,...,i)   &&  /* 2nd long */
inClose[i] <= inClose[i-1] + TA_CANDLEAVERAGE(Equal,...,i-1) &&         /* equal closes */
inClose[i] >= inClose[i-1] - TA_CANDLEAVERAGE(Equal,...,i-1)
-> outInteger = colour(i) * 100;
```

**TA-Lib IS MISSING THE DEFINING FEATURE.** The pattern's entire meaning is that bar[-1]
**gaps hard in the direction of the trend at the open** and then claws all the way back to the
prior close. TA-Lib requires **no gap whatsoever** — only opposite colours, two long bodies, and
equal closes. Sources that state the gap:
- chart-formations.com, verbatim: bullish *"gaps down to open well away from the real body of the
  first candlestick"*; bearish *"gaps well up on its open to open well above the real body of the
  first candlestick"*.
- Nison (via summary): *"the market **gaps sharply lower (higher) on the opening** and then closes
  unchanged from the prior session's close."*

**Recommended executable form (WITH the gap — do not copy TA-Lib here):**
```python
# BULLISH counterattack (downtrend)
bull_counterattack = ( black(1) and LONG(1) and white(2) and LONG(2)
                   and o2 < c1                      # gap down at the open, below the prior body
                   and abs(c2 - c1) <= EQ )         # closes back at the prior close
# BEARISH counterattack (uptrend) — mirror with o2 > c1
```
Grade the gap: `gap_atr = (c1 - o2) / ATR14`; sources say "well away", so `gap_atr >= 0.5` is a
defensible strength floor.

**Equal-close tolerance.** TA-Lib: `EQ = 0.05 * avgRange5`. chart-formations: *"the same, **or
nearly the same**, close"* / *"close at, or very close to the same level"*. CandleScanner:
*"the closing price is **equal to** the previous closing price"* (exact). Bulkowski bearish is
openly exasperated: *"The closes of the two candles should be 'near' one another, **whatever that
means**."* Use TA-Lib's `EQ`.

**How it differs from piercing / dark cloud.** Same two-bar shape, but the second close stops **at**
the prior close instead of pushing **into** the prior body. chart-formations: *"less reliable than
the Piercing Line and the Dark Cloud Cover patterns"* because *"the second candlestick ... does not
penetrate the real body of the previous candlestick."*

**Prior trend.** Required (down for bullish, up for bearish). TA-Lib verbatim: *"the user should
consider that counterattack is significant in a trend, while this function does not consider it."*

**Bias / class.** Reversal. **Bulkowski:** bullish meeting lines tested bullish reversal **56%**,
frequency 72, **performance rank 18/103**; bearish meeting lines tested **BULLISH CONTINUATION
51%** (backwards, coin-flip), frequency 63, **performance rank 16/103**. Rare but strong movers.

---

### 15, 16, 17. THE NECK / THRUSTING FAMILY — one partition, four outcomes

All three share the **same skeleton**: `black(1) and LONG(1) and white(2) and o2 < l1`.
They differ **only** in where `c2` lands. Together with the piercing line and the bullish engulfing
they form a **clean, mutually exclusive partition of the close** — implement them as one function
with a cascade, not as five independent predicates.

```
c2 ≈ l1                          ->  ON-NECK      (bearish continuation)
c1 <= c2 <= c1 + EQ              ->  IN-NECK      (bearish continuation)
c1 + EQ < c2 <= mid1             ->  THRUSTING    (bearish continuation)   0 < pen <= 0.5
mid1 < c2 < o1                   ->  PIERCING     (BULLISH reversal)       0.5 < pen < 1
c2 >= o1                         ->  BULLISH ENGULFING (with a gap-down open)
```

Nison's rationale, verbatim in substance: the on-neck, in-neck and thrusting patterns *"have the
same basic formation as the piercing pattern, but ... are viewed as **bearish** signals since the
white real body gets **less than halfway** into the black's real body."*

#### 15. ON-NECK LINE — *atekubi*

**TA-Lib `ta_CDLONNECK.c` — verbatim:**
```c
colour(i-1) == -1 && fabs(inClose[i-1]-inOpen[i-1]) > TA_CANDLEAVERAGE(BodyLong,...,i-1) &&
colour(i)   ==  1 && inOpen[i] < inLow[i-1] &&
inClose[i] <= inLow[i-1] + TA_CANDLEAVERAGE(Equal,...,i-1) &&
inClose[i] >= inLow[i-1] - TA_CANDLEAVERAGE(Equal,...,i-1)   -> -100
```
The close matches the prior **LOW** (not the prior close), within `EQ`.

- **Bulkowski, verbatim:** *"a white candle has a close that **matches (or nearly matches) the
  prior low**."*
- **CandleScanner disagrees on the OPEN:** *"the opening price **below the previous closing
  price**"* — not below the prior low. That is materially looser than TA-Lib/Bulkowski.
  CandleScanner also caps bar[-1]'s shadows: *"its upper and lower shadows length cannot exceed
  more than twice the body length."*
- **Bias / class:** bearish **continuation**. Bulkowski: tested bearish continuation **56%**,
  frequency 70, **performance rank 33/103**.

#### 16. IN-NECK LINE — *irikubi*

**TA-Lib `ta_CDLINNECK.c` — verbatim:**
```c
... same skeleton ...
inClose[i] <= inClose[i-1] + TA_CANDLEAVERAGE(Equal,...,i-1) &&   /* close slightly into prior body */
inClose[i] >= inClose[i-1]                                        /* NON-STRICT lower bound */
-> -100
```
Note the asymmetry: the lower bound is `>= c1` (non-strict — an exact tie with the prior close
**does** fire in-neck), the upper bound is `<= c1 + EQ`.

- **Bulkowski, verbatim:** *"a white candle opens below the black day's low, but **closes just into
  the body** of the black candle."*
- **CandleScanner gives a HARD NUMBER that conflicts with TA-Lib's EQ:** *"the closing price is
  slightly above the previous closing price (**up to 15% of the first line body**)."*
  TA-Lib's band is `0.05 * avgRange5` (a fraction of *market* range); CandleScanner's is
  `0.15 * body(1)` (a fraction of *this pattern's own* body). On a long bar[-2] CandleScanner's
  band is far wider. Also CandleScanner uses *"opening price below the previous **closing**
  price"*, not below the prior low.
- **Bias / class:** bearish **continuation**. Bulkowski: tested bearish continuation **53%**,
  frequency 62, **performance rank 17/103**.
- CandleScanner note: *"Visually the Bullish Meeting Lines pattern is similar to the In Neck ...
  The main difference is ... in the length of the second line's body. In the case of the In Neck
  pattern, the second candle's body is shorter."* — the two genuinely co-fire; see §(d).

#### 17. THRUSTING LINE — *sashikomi*

**TA-Lib `ta_CDLTHRUSTING.c` — verbatim:**
```c
... same skeleton ...
inClose[i] >  inClose[i-1] + TA_CANDLEAVERAGE(Equal,...,i-1) &&   /* STRICTLY above in-neck's band */
inClose[i] <= fma(fabs(inClose[i-1]-inOpen[i-1]), 0.5, inClose[i-1])  /* <= midpoint, NON-STRICT */
-> -100
```
**This is where the 50% tie is decided:** thrusting's upper bound is `<= mid1` (non-strict) and
piercing's lower bound is `> mid1` (strict). So `pen == 0.5` exactly is a **THRUSTING LINE**, not a
piercing line. TA-Lib's own comment says the `Equal` clause exists *"to differentiate it from
in-neck"*. The partition is airtight — use it.

- **Bulkowski, verbatim:** *"a white candle that opens below the prior low but closes **near but
  below the midpoint** of the black candle's body."*
- **CandleScanner:** `opening below the prior low` / `closing above the previous candle's closing`
  / `closing below the midpoint of the previous candle's body`; both lines must be **long lines**.
- **Nison's caveat, quoted inside TA-Lib's own comment block:** thrusting *"could be even bullish
  'when coming in an uptrend or occurring twice within several days' (Steve Nison says), while this
  function does not consider the trend."* So the sign is trend-dependent.
- **Bias / class:** theoretically bearish **continuation**. Bulkowski: **tested BULLISH REVERSAL
  57%** (*"near random"*), frequency 56, **performance rank 15/103**.

---

### 18 & 19. SEPARATING LINES — *iki chigai sen* ("lines that move in opposite directions")

**TA-Lib `ta_CDLSEPARATINGLINES.c` — verbatim:**
```c
colour(i-1) == -colour(i) &&                                     /* opposite candles */
inOpen[i] <= inOpen[i-1] + TA_CANDLEAVERAGE(Equal,...,i-1) &&    /* SAME OPEN, within EQ */
inOpen[i] >= inOpen[i-1] - TA_CANDLEAVERAGE(Equal,...,i-1) &&
fabs(inClose[i]-inOpen[i]) > TA_CANDLEAVERAGE(BodyLong,...,i) && /* belt hold: long body */
( colour(i)==1  && lowerShadow(i) < TA_CANDLEAVERAGE(ShadowVeryShort,...,i)      /* bullish: no lower shadow */
||colour(i)==-1 && upperShadow(i) < TA_CANDLEAVERAGE(ShadowVeryShort,...,i) )    /* bearish: no upper shadow */
-> outInteger = colour(i) * 100;
```
Bar[-1] must be a **belt hold** (long body opening at its own extreme). TA-Lib puts **no size
requirement on bar[-2]**; Bulkowski and CandleScanner both require bar[-2] to be a long line too.

**THE TREND DIRECTION IS COUNTER-INTUITIVE — get it right:**
- **Bullish** separating lines: **black** bar[-2], **white** bar[-1], in an **UPTREND**.
  Bulkowski verbatim: *"Look for a tall black candle in an **upward** price trend followed by a
  tall white candle. The two candles share a common opening price."* CandleScanner agrees:
  `Trend prior to the pattern: uptrend`, `First candle: a candle in an uptrend, black body`.
- **Bearish** separating lines: **white** bar[-2], **black** bar[-1], in a **DOWNTREND**.
  Bulkowski verbatim: *"Look for a tall white candle in a **downward** price trend followed by a
  tall black candle."*
  ⚠️ **CandleScanner's bearish page contradicts itself**: its header metadata says
  `Trend prior to the pattern: uptrend` while its construction list says
  `First candle: a candle in a **downtrend**, white body` and its prose says *"a white candle
  appearing as a long line **in a downtrend**"*. The header is a typo on their page. Trust
  Bulkowski + CandleScanner's own construction list: **downtrend**.

The logic: bar[-2] is a counter-trend candle; bar[-1] reopens at the same price and resumes the
trend, so the counter-trend move is erased. Hence **CONTINUATION**, not reversal.

**Bias / class.** **Continuation** — the only reversal-vs-continuation call in this set that
several popular sites get backwards. **Bulkowski's numbers are unusually good and directionally
correct:**
- Bullish separating lines: tested bullish continuation **72%**, frequency 76, performance rank 36,
  best 10-day rank **4/103**.
- Bearish separating lines: tested bearish continuation **63%**, frequency 82, performance rank 40,
  best 10-day rank **5/103**.
Both are rare (CandleScanner: *"The pattern is very rare"*).

**Relationship to the kicker.** Adjacent but **disjoint**: separating lines share the open
(`o2 ≈ o1`); the kicker requires a full price gap (`l2 > h1`), which forces `o2 > o1`.

---

### 20. MATCHING LOW — *niten zoko* ("two-day bottom")

**TA-Lib `ta_CDLMATCHINGLOW.c` — verbatim:**
```c
colour(i-1) == -1 && colour(i) == -1 &&                          /* both black */
inClose[i] <= inClose[i-1] + TA_CANDLEAVERAGE(Equal,...,i-1) &&  /* same close */
inClose[i] >= inClose[i-1] - TA_CANDLEAVERAGE(Equal,...,i-1)
-> 100
```
TA-Lib imposes **no size test at all** and no shadow test — the loosest function in the family.

**The name is a trap: it matches on the CLOSES, not the LOWS.** Bulkowski spells it out verbatim:
*"find a black body with a **close (not the low)** that matches the prior close."* Anyone
implementing "matching low" from the name alone will build the wrong thing.

**CandleScanner is far stricter** and adds two conditions nobody else has:
`First candle: black body, **no lower shadow**, appears as a long line` /
`Second candle: black body, **the opening price is below the previous opening price**,
the closing price is at the level of the previous closing price, **no lower shadow**`.
Their prose: *"Having two candles without lower shadows in a row (i.e. Closing Black Marubozu or
Black Marubozu), closing at the same price, is an unusually rare situation."*
Under CandleScanner "matching low" and "matching close" coincide (no lower shadow ⇒ close = low);
under TA-Lib they do not.

**Bias / class.** Theoretically bullish reversal (the repeated close is support).
**Bulkowski: tested BEARISH CONTINUATION 61%** — backwards. Frequency 58,
**overall performance rank 8/103** — his best-ranked pattern in this whole set for post-breakout
movement, despite pointing the "wrong" way.

**Mirror pattern: MATCHING HIGH** (`white(1) and white(2) and abs(c2-c1) <= EQ`, bearish, uptrend).
It exists in the literature but has **no TA-Lib function and no Bulkowski statistics.** Ship it
only as an unranked extra, clearly marked.

---

### 21. HOMING PIGEON — *shita banare kobato gaeshi*

**TA-Lib `ta_CDLHOMINGPIGEON.c` — verbatim:**
```c
colour(i-1) == -1 && colour(i) == -1 &&                                  /* both black */
fabs(inClose[i-1]-inOpen[i-1]) > TA_CANDLEAVERAGE(BodyLong,...,i-1) &&   /* 1st long  */
fabs(inClose[i]-inOpen[i])    <= TA_CANDLEAVERAGE(BodyShort,...,i)  &&   /* 2nd short */
inOpen[i]  < inOpen[i-1] &&                                              /* STRICT */
inClose[i] > inClose[i-1]                                                /* STRICT */
-> 100
```
Both containment inequalities are **STRICT** — no ties allowed on either end (unlike harami,
which allows one).

- **Bulkowski, verbatim:** *"The first day should be a tall black body followed by a small black
  body that fits inside the body of the prior day."*
- **CandleScanner:** `First candle: a candle in a downtrend, black body / Second candle: black
  body, candle's body engulfed by the prior candle's body`; *"The length of the candles shadows
  does not matter."* Classified as *"belonging to the **harami patterns family**"*.
- **Prior trend:** downtrend, required by Bulkowski and CandleScanner; TA-Lib disclaims it.
- **Bias / class.** Theoretically bullish reversal. **Bulkowski: tested BEARISH CONTINUATION 56%**
  — backwards. Frequency 34, **overall performance rank 21/103**.

**Subset relation (important):** because `CDLHARAMI` does not test bar[-1]'s colour, **every
homing pigeon is also a TA-Lib "bullish harami"** (subject to the strict-vs-tie difference). Under
Bulkowski / CandleScanner / StockCharts — all of which require the harami's second body to be the
**opposite** colour — homing pigeon and bullish harami are **disjoint**. Pick a convention and
apply it to both patterns consistently.

---

### 22. DESCENDING HAWK — *kakouchu no taka*

The **bearish mirror of the homing pigeon**, and the pattern most likely to be missing from an
implementation because **TA-Lib has no `CDLDESCENDINGHAWK`** and **Bulkowski does not cover it**
(it is absent from his 103-pattern alphabet).

```python
descending_hawk = ( white(1) and LONG(1)
                and white(2) and SHORT(2)
                and o2 > o1 and c2 < c1 )     # strict both ends, mirroring homing pigeon
```

- **CandleScanner, verbatim:** *"First candle: a candle in an uptrend, white body, appears as a
  long line. Second candle: white body, candle's body engulfed by the prior candle's body."*
  *"**Shadows do not matter** in regard to both candles."*
  *"The Descending Hawk is a two-line **bearish reversal** pattern belonging to the **harami
  patterns family**."* *"The Descending Hawk appears in an uptrend predicting its reversal."*
- **Candlesticker, verbatim:** *"This pattern features a small white candlestick enclosed within a
  preceding, relatively longer white candlestick. The first day's white candlestick, either normal
  or long, completely engulfs the smaller white candlestick on the following day. The market is
  currently defined by a dominant upward trend."* Confirmation level: *"the lower of either the
  last closing price or the midpoint of the previous white candlestick."*
- **Bias / class.** Bearish reversal, uptrend required. **No performance statistics exist from any
  tested source** — mark it unranked.
- Same subset caveat as homing pigeon: it is a TA-Lib "bearish harami" but not a
  Bulkowski/CandleScanner bearish harami.

---

### 23 & 24. LAST ENGULFING TOP / LAST ENGULFING BOTTOM

**These are the single most important patterns for the current implementation, because they are
GEOMETRICALLY IDENTICAL to engulfing and differ ONLY by prior trend — and they point the opposite
way.**

- **Last engulfing TOP** = the geometry of a **bullish** engulfing (black then engulfing white)
  occurring in an **UPTREND**. Bearish reversal.
- **Last engulfing BOTTOM** = the geometry of a **bearish** engulfing (white then engulfing black)
  occurring in a **DOWNTREND**. Bullish reversal.

**CandleScanner states the identity explicitly, verbatim:**
> *"The description of the Last Engulfing Top is **precisely the same** as of the Bullish Engulfing
> pattern **except for the trend requirement**. The Bullish Engulfing appears within a downtrend,
> whereas the Last Engulfing Top occurs within an uptrend."*
> *"Definition of the Last Engulfing Bottom is **exactly the same** as of the Bearish Engulfing
> pattern **except the trend requirement**."*

**Bulkowski, verbatim:**
- Last engulfing top: *"Price trend leading to the pattern: **Upward**. Look for a black candle
  followed by a white candle that overlaps the prior black candle's body. The white candle should
  have a body above the prior candle's top and below the prior candle's bottom."*
- Last engulfing bottom: *"Price trend leading to the pattern: **Downward**. Look for a white
  candle on the first day in a downward price trend followed by a black candle that engulfs the
  body of the white candle ... **Ignore the shadows**."*

**Bulkowski's measured outcomes make the mislabel expensive:**

| Geometry | In the "correct" trend | In the opposite trend |
|---|---|---|
| black → engulfing white | **Bullish engulfing**: bullish reversal 63%, freq 12, rank 84 | **Last engulfing top**: theoretical bearish reversal, **tested BULLISH CONTINUATION 68%**, freq 14, rank 79 |
| white → engulfing black | **Bearish engulfing**: bearish reversal 79%, freq 11, rank 91 | **Last engulfing bottom**: theoretical bullish reversal, **tested BEARISH CONTINUATION 65%**, freq 13, rank 48 |

Frequency ranks 12/14 and 11/13 are nearly the same — meaning **roughly half of all engulfing
geometries in the wild are actually last-engulfing patterns.** A trend-blind detector is therefore
labelling something close to a coin flip of two opposite patterns under one name.

CandleScanner adds a useful sequencing note: *"The ideal setup is where we deal with both patterns
on the chart; first having a Bullish Engulfing (price rises), and after a while a Last Engulfing
Top."* and *"If a Last Engulfing Bottom appears alone, that is, it is not preceded by a Bearish
Engulfing pattern, a downtrend is likely to be continued."*

---

### 25 & 26. BULLISH / BEARISH DOJI STAR — *doji bike*

**TA-Lib `ta_CDLDOJISTAR.c` — verbatim (this IS a two-bar function):**
```c
fabs(inClose[i-1]-inOpen[i-1]) > TA_CANDLEAVERAGE(BodyLong,...,i-1) &&   /* 1st: long real body */
fabs(inClose[i]-inOpen[i])    <= TA_CANDLEAVERAGE(BodyDoji,...,i)   &&   /* 2nd: doji */
( colour(i-1)== 1 && min(inOpen[i],inClose[i]) > max(inOpen[i-1],inClose[i-1])   /* white then gap UP  */
||colour(i-1)==-1 && max(inOpen[i],inClose[i]) < min(inOpen[i-1],inClose[i-1]) ) /* black then gap DOWN */
-> outInteger = -colour(i-1) * 100;
```

**The gap is a BODY gap** (`TA_REALBODYGAPUP/DOWN` semantics, inlined) — **shadows may overlap.**
Bulkowski confirms independently: *"a doji ... that gaps below the prior candle's body. **The
shadows can overlap**, but the doji's shadows should not be unusually long, whatever that means."*
For the bearish version: *"price gaps higher and the body remains above the prior body ... The
shadows on the doji should be comparatively short."*

**Naming inversion warning.** TA-Lib's sign convention is `-colour(bar[-2])`, i.e. a **black**
first candle + gap-down doji returns **+100 (bullish)**. TA-Lib's own comment concedes the label is
context-dependent: *"it's defined bullish when the long candle is white and the star gaps up,
bearish when the long candle is black and the star gaps down; the user should consider that a doji
star is bullish when it appears in an uptrend and it's bearish when it appears in a downtrend, **so
to determine the bullishness or bearishness of the pattern the trend must be analyzed**."*
Read carefully: that sentence contradicts the code's sign. **Do not inherit TA-Lib's sign here** —
derive the sign from the trend, per Bulkowski (bullish doji star = downtrend + black + gap-down
doji; bearish doji star = uptrend + white + gap-up doji).

**CandleScanner:** bullish = `black body` then `a doji candle` with `a body below the first
candle's body` (body gap, confirming); bearish = mirror.

**Bias / class.** Reversal (a warning of exhaustion; usually needs a third bar to become a
morning/evening doji star). **Bulkowski measured both backwards:**
- Bullish doji star: **tested BEARISH CONTINUATION 64%**, frequency 53, performance rank 49.
- Bearish doji star: **tested BULLISH CONTINUATION 69%**, frequency 43, performance rank 51.

---

### 27 & 28. ABOVE THE STOMACH / BELOW THE STOMACH  *(missing from the assignment list)*

Bulkowski-catalogued two-bar patterns with **no TA-Lib function**, and among his better performers.

- **Above the stomach** — verbatim: *"Price trend leading to the pattern: Downward. ... The first
  candle is black and the second white. The white candle should **open and close at or above the
  mid point of the black candle's body**."*
  → `black(1) and white(2) and o2 >= mid1 and c2 >= mid1`  (note **`>=`**, non-strict, in his text)
  Bullish reversal; **tested bullish reversal 66%** (directionally correct, unlike most of the set),
  frequency 32, performance rank 31.
- **Below the stomach** — verbatim: *"Look for a tall white candle followed by a candle that has a
  body below the middle of the white candle. **Pictures show the second candle as black, but the
  guidelines I saw did not mention this as a requirement.**"*
  → `white(1) and LONG(1) and bodyTop(2) <= mid1`  (second colour deliberately unconstrained)
  Bearish reversal; **tested bearish reversal 60%**, frequency 38, performance rank 59.

Note above-the-stomach is **disjoint from both piercing and bullish engulfing**: both of those
require `o2` below the whole prior body, while above-the-stomach requires `o2 >= mid1`.

---

### 29. TWO BLACK GAPPING  *(missing from the assignment list)*

Bulkowski, verbatim: *"Price trend leading to the pattern: Downward. Look for a price gap followed
by two black candles. The second black candle should have a **high below the prior candle's high**."*
→ `gap-down into bar[-2]` (a three-bar dependency for the gap, two-bar for the rest) and
`black(1) and black(2) and h2 < h1`.
Bearish **continuation**; **tested bearish continuation 68%**, frequency 29,
**overall performance rank 10/103** — one of his strongest. Include it if the gap reference bar is
available; otherwise mark it as needing bar[-3].

### 30. INVERTED HAMMER (2-line)  *(missing from the assignment list)*

Bulkowski treats the inverted hammer as a **two-line** pattern, verbatim: *"Look for a tall black
candle with a close near the day's low followed by a short candle with a tall upper shadow and
little or no lower shadow. The second candle **cannot be a doji** (opening and closing prices
cannot be within pennies of each other) and **the open on the second candle must be below the prior
candle's close**."* Downtrend. Theoretical bullish reversal; **tested BEARISH CONTINUATION 65%**,
frequency 61, **overall performance rank 6/103** — his best-ranked pattern here.

### 31. SHOOTING STAR (2-line)  *(missing from the assignment list)*

Bulkowski, verbatim: *"Look for two candles in an upward price trend. The first candle is white
followed by a small bodied candle with an **upper shadow at least three times the height of the
body**. The candle has no lower shadow or a very small one and **there is a gap between the prices
of the two bodies**. The second candle can be any color."* → **body gap**, `upSh(2) >= 3*body(2)`.
Bearish reversal; **tested BULLISH CONTINUATION 61%**, frequency 51, performance rank 52.

### 32 & 33. RISING / FALLING WINDOW  *(missing from the assignment list)*

The pure two-bar price gap — Japanese *ku*. Bulkowski, falling window, verbatim:
*"Find a pattern in which **yesterday's low is above today's high**."* → `h2 < l1`.
Rising window is the mirror: `l2 > h1`. Bearish/bullish **continuation**.
Falling window: **tested bearish continuation 67%**, frequency 23,
**overall performance rank 7/103** — the strongest two-bar structure Bulkowski measured, and the
cheapest to compute. Strongly recommend including both.

---

## (c) SOURCES DISAGREE — every numeric conflict

### C1. Piercing / dark cloud penetration depth — RESOLVED, near-unanimous

| Source | Piercing | Dark cloud | Tie at exactly 50% |
|---|---|---|---|
| TA-Lib | `c2 > c1 + 0.5*body1` (STRICT) | `c2 < c1 - 0.5*body1` (STRICT), `optInPenetration` default **0.5** | **does NOT fire** either |
| Nison | *"more than halfway"* | *"preferably more than halfway"* | does not fire |
| Greg Morris | (via TA-Lib comment) *"Greg Morris wants the close to be below the midpoint of the previous real body"* | same | — |
| Bulkowski | *"closes between the midpoint ... and opening price"* | *"a close below the mid point of the white body"* | ambiguous |
| CandleScanner | *"above the midpoint"* + *"below the previous opening"* | *"below the midpoint"* + *"above the previous opening"* | does not fire |
| TradingView | *"closes above the midpoint"* | *"closes below the midpoint"* | — |
| StockCharts | *"close above the midpoint of the black candlestick's body"* | *"close below the midpoint of the white candlestick's body"* | — |

**Verdict: `pen > 0.5`, strict, everywhere. The 50% tie belongs to THRUSTING (bearish), not
piercing** — because TA-Lib's thrusting upper bound is `<= mid1` (non-strict) while piercing's
lower bound is `> mid1` (strict). This is the cleanest tie-break available and it is the one
TA-Lib actually ships.
**Spread: none on the number, total on the tie** — most non-TA-Lib sources never address it.

### C2. THE BIGGEST DISAGREEMENT — the OPEN requirement for piercing / dark cloud

| Source | Piercing open | Dark cloud open |
|---|---|---|
| TA-Lib | `o2 < l1` **STRICT** | `o2 > h1` **STRICT** |
| Nison | below the prior **LOW** | above the prior **HIGH** |
| Bulkowski | *"opens below the black candle's **low**"* | *"an opening price **above the prior high**"* |
| TradingView | *"opens below the **low** of the prior candle, creating a gap"* | *"opens above the **high** of the prior candle, creating a gap"* |
| CandleScanner | *"the opening **below or equal** of the prior low"* — **NON-strict** | *"the opening **above or equal** of the prior high"* — **NON-strict, deliberately relaxed**: *"...because it increases the number of found patterns"* |
| **StockCharts ChartSchool** | *"must open **below the previous close**"* | *"must open **above the previous close**"* |
| **StockCharts Pattern Dictionary** | *"opens at a **new low**"* | *"opens at a **new high**"* |

**This is the single largest source disagreement in the entire two-bar set.** "Below the prior
close" versus "below the prior low" is not a tuning parameter — on daily US equities it changes the
population by roughly an order of magnitude, because a lower open is routine while a gap below the
whole prior bar is not. **StockCharts contradicts itself between its own two pages.**
6 of 7 sources say LOW/HIGH. **Use LOW/HIGH.**
Secondary spread: **strict** (TA-Lib, and implied by Nison/Bulkowski/TradingView's word "gap")
vs **non-strict** (CandleScanner, openly a recall-boosting relaxation). Recommend strict, with
`o2 == l1` optionally graded as a weaker "relaxed" hit.

### C3. Harami cross containment — three-way, unresolvable by majority

| Source | Rule |
|---|---|
| TA-Lib | doji **body** ⊂ bar[-2] **body** |
| CandleScanner | doji **including shadows** ⊂ bar[-2] **body** (strictest) |
| Bulkowski (bull) | doji ⊂ bar[-2] **high-low range** (loosest) |
| Bulkowski (bear) | doji *"inside (including the shadows) the trading range"* |

Consequence already noted: whether harami cross ⊂ harami depends on which you pick.
**Recommend TA-Lib's body-in-body**, for consistency with plain harami.

### C4. In-neck close band — a hard numeric conflict

- **TA-Lib:** `c1 <= c2 <= c1 + 0.05*avgRange5`  (a fraction of *market* range)
- **CandleScanner:** *"slightly above the previous closing price (**up to 15% of the first line
  body**)"* → `c1 < c2 <= c1 + 0.15*body1`  (a fraction of *this pattern's* body)

These are different quantities, not different constants. On a long bar[-2] CandleScanner's band is
several times wider. **Recommend `c1 <= c2 <= c1 + min(0.05*avgRange5, 0.15*body1)`** if you want
both satisfied, or TA-Lib's alone for reproducibility against `talib.CDLINNECK`.

### C5. Tweezer tolerance — no agreement at all

- **CandleScanner:** exact equality (`h2 == h1`), and it is an N-line pattern that extends.
- **Bulkowski (top):** *"the same (or nearly the same) high price"*; **(bottom):** *"sharing the
  same low price"* — **inconsistent with his own top page.**
- **LuxAlgo:** *"a tolerance of a tick or two, scaled to the instrument's volatility"*; explicitly
  not exact; opposite colours **not** required.
- **TA-Lib:** no implementation whatsoever.

**Spread: from 0 to ~0.05·ATR.** Recommend `abs(h2-h1) <= 0.05*ATR14` and flag the choice as a
tunable. Exact equality on a 3,700-ticker daily universe is dominated by tick-size artifacts.

### C6. Dark cloud midpoint of BODY vs RANGE

Six sources say **body midpoint** (`(o1+c1)/2`). **TrendSpider alone** says *"below the midpoint of
the prior bullish candle's **range**"* (`(h1+l1)/2`). Use the body. On a long-shadowed bar the two
differ materially.

### C7. Second-candle colour in HARAMI

TA-Lib does **not** test it (so homing pigeon and descending hawk are swept in);
Bulkowski, CandleScanner and StockCharts all **require the opposite colour**.
**Spread: TA-Lib's harami population is strictly larger.** Recommend requiring opposite colour and
reporting homing pigeon / descending hawk as their own labels.

### C8. Counterattack gap

TA-Lib requires **no gap**; Nison and chart-formations require a **sharp gap** in the trend
direction — it is the pattern's whole point. **TA-Lib is simply wrong here.** Add the gap.

### C9. Engulfing: minimum body size

TA-Lib: **none on either bar** (a 1-tick body can "engulf"). CandleScanner: bar[-1] must be a
**long line** (its quantitative definition: candle **range** > **70% of an EMA(25) of the
high-low range**; *"A candle which spans more than 70 percent of this volatility value is regarded
as a long line"*, parameter *"arbitrarily chosen"*, recommended band **65–80%**).
Bulkowski: bar[-1] must be *"taller"*. **Recommend `LONG(2)` at minimum.**

### C10. Engulfing: the doji first bar

Nison **explicitly allows** it (his stated exception to the colour rule).
TA-Lib **structurally forbids** it on the bullish side (doji classified as white).
CandleScanner **allows any doji except the four-price doji**.
**Recommend following Nison/CandleScanner**: treat `c1 == o1` as colour-neutral and admissible on
both sides, excluding the four-price doji (`h1 == l1`).

### C11. Separating lines trend direction

Bulkowski and CandleScanner's construction lists agree (bullish → uptrend, bearish → downtrend),
but **CandleScanner's own bearish page header says "uptrend"**, contradicting its own body text.
Numerous secondary sites also mislabel these as reversals. **They are continuation patterns.**

---

## (d) SUBSET / CO-FIRE MATRIX

### Strict subsets (A ⊂ B: every A is also a B)

| Subset | Superset | Under which convention | Notes |
|---|---|---|---|
| Harami cross | Harami | TA-Lib, CandleScanner | **Not** under Bulkowski (different containment reference — §C3). Under TA-Lib it holds *in practice*, not by construction: `BodyDoji = 0.10·avgRange10` vs `BodyShort = 1.0·avgBody10`; since avg body ≈ 0.5–0.7 × avg range, doji ⇒ short essentially always, but a pathological all-marubozu window could break it. **Assert it, don't assume it.** |
| Homing pigeon | "Bullish harami" | **TA-Lib only** | TA-Lib's harami ignores bar[-1]'s colour. Disjoint under Bulkowski/CandleScanner/StockCharts. |
| Descending hawk | "Bearish harami" | **TA-Lib only** | Same mechanism. |
| Last engulfing top | Bullish engulfing *geometry* | all | Identical geometry; **only** the trend differs. Not a subset of the *pattern* — a trend-disjoint twin. |
| Last engulfing bottom | Bearish engulfing *geometry* | all | Same. |
| Kicking by length | Kicking | TA-Lib | Identical predicate; only the output sign rule differs. |
| Matching low (CandleScanner) | Matching low (TA-Lib) | — | CandleScanner adds no-lower-shadow + `o2 < o1`. |
| Tweezer bottom (CandleScanner, exact) | Tweezer bottom (ATR band) | — | Tolerance nesting. |

### Mutually exclusive by construction (cannot co-fire) — proofs

| Pair | Why |
|---|---|
| **Kicker ↔ engulfing** | Bullish kicker: `o2 >= l2 > h1 >= o1 > c1`. Bullish engulfing needs `o2 <= c1`. Contradiction. (The common claim that a kicker is a "gap engulfing" is **false**.) |
| **Piercing ↔ dark cloud** | Opposite colours on both bars. |
| **Piercing ↔ thrusting ↔ in-neck ↔ on-neck ↔ bullish engulfing** | A partition of `c2` over the same skeleton — see §15–17. Airtight under TA-Lib's strict/non-strict boundaries. **(One leak: see the on-neck/in-neck overlap below.)** |
| **Dark cloud ↔ bearish engulfing** | Only if you keep TA-Lib/CandleScanner's `c2 > o1` bound. **Drop that bound (Nison/Bulkowski/StockCharts wording) and they DO co-fire.** |
| **Doji star ↔ harami cross** | Doji star needs a body **gap**; harami cross needs the body **inside**. Disjoint. |
| **Kicker ↔ separating lines** | Separating lines needs `o2 ≈ o1`; kicker forces `o2 > o1` by a full bar. |
| **Above the stomach ↔ piercing / bullish engulfing** | Above-the-stomach needs `o2 >= mid1`; the other two need `o2 < l1 < c1 < mid1`. |
| **Harami ↔ engulfing** | Containment runs in opposite directions; a double tie (identical bodies) is excluded by both. |
| **Rising window ↔ falling window** | Trivially. |

### Genuine co-fires (must be resolved by an explicit precedence order)

| Pair | When |
|---|---|
| **On-neck ↔ in-neck** | **A real TA-Lib overlap.** On-neck fires for `c2 ∈ l1 ± EQ`; in-neck for `c2 ∈ [c1, c1+EQ]`. If `c1 - l1 <= EQ` — i.e. bar[-2] has almost no lower shadow (a closing black marubozu) — **both fire.** Precedence: on-neck (the more bearish reading). |
| **In-neck ↔ counterattack** | In-neck's close band `[c1, c1+EQ]` is **inside** counterattack's `|c2-c1| <= EQ`. TA-Lib's counterattack adds `LONG(2)`, which in-neck does not require — so **any long-bodied in-neck also fires `CDLCOUNTERATTACK`**. CandleScanner names this collision explicitly (*"Visually the Bullish Meeting Lines pattern is similar to the In Neck ... the second candle's body is shorter"*). Precedence: in-neck if `o2 < l1`, else counterattack. |
| **Matching low ↔ homing pigeon** | Both black. Homing pigeon needs `c2 > c1` strictly; matching low needs `|c2-c1| <= EQ`. Both hold when `0 < c2-c1 <= EQ`. Precedence: matching low (the tighter, rarer condition). |
| **Tweezers ↔ almost everything** | Tweezers constrain **only one extreme** (`h2≈h1` or `l2≈l1`) and no body relation at all. A tweezer top freely co-fires with bearish engulfing, bearish harami, dark cloud cover, descending hawk… **Treat tweezers as a MODIFIER/flag, not as a mutually-exclusive label.** This is the biggest co-fire surface in the set. |
| **Windows ↔ kicker / doji star** | A rising window (`l2 > h1`) is implied by every bullish kicker. Precedence: kicker (far more specific). |
| **Engulfing ↔ separating lines** | Only in the degenerate case where bar[-2]'s body is smaller than `EQ`. Precedence: separating lines. |
| **Harami ↔ tweezers** | Common (an inside bar often shares an extreme). Modifier again. |
| **Two black gapping ↔ falling window** | Two black gapping contains a gap; if that gap is between bar[-2] and bar[-1], falling window co-fires. |

### Recommended single-label precedence (most specific → least)

```
1. kicker  →  2. separating lines  →  3. counterattack  →  4. on-neck  →  5. in-neck
→ 6. thrusting → 7. piercing / dark cloud → 8. engulfing (trend-split into last-engulfing)
→ 9. doji star → 10. harami cross → 11. homing pigeon / descending hawk → 12. harami
→ 13. matching low → 14. above/below the stomach → 15. window → 16. tweezers (modifier)
```

---

## (e) SOURCES

1. **TA-Lib C source — `CDLENGULFING`, `CDLHARAMI`, `CDLHARAMICROSS`, `CDLPIERCING`,
   `CDLDARKCLOUDCOVER`, `CDLKICKING`, `CDLKICKINGBYLENGTH`, `CDLCOUNTERATTACK`, `CDLONNECK`,
   `CDLINNECK`, `CDLTHRUSTING`, `CDLSEPARATINGLINES`, `CDLMATCHINGLOW`, `CDLHOMINGPIGEON`,
   `CDLDOJISTAR`** — `https://raw.githubusercontent.com/TA-Lib/ta-lib/main/src/ta_func/ta_CDL<NAME>.c`
   (all 15 downloaded and quoted verbatim, 2026-08-24)
2. **TA-Lib candle settings defaults** — `https://raw.githubusercontent.com/TA-Lib/ta-lib/main/src/ta_common/ta_global.c`
   (`TA_CandleDefaultSettings[]`: BodyLong RealBody/10/1.0 · BodyVeryLong RealBody/10/3.0 ·
   BodyShort RealBody/10/1.0 · BodyDoji HighLow/10/0.1 · ShadowLong RealBody/0/1.0 ·
   ShadowVeryLong RealBody/0/2.0 · ShadowShort Shadows/10/1.0 · ShadowVeryShort HighLow/10/0.1 ·
   Near HighLow/5/0.2 · Far HighLow/5/0.6 · Equal HighLow/5/0.05)
3. **TA-Lib candle macros** — `https://raw.githubusercontent.com/TA-Lib/ta-lib/main/src/ta_func/ta_utility.h`
   (`TA_CANDLECOLOR`, `TA_CANDLERANGE`, `TA_CANDLEAVERAGE`, `TA_REALBODYGAPUP/DOWN`,
   `TA_CANDLEGAPUP/DOWN`)
4. **Thomas Bulkowski — thepatternsite.com** (Encyclopedia of Candlestick Charts, 103 patterns;
   Identification Guidelines + tested performance for 32 pages):
   `/Candles2.html` (two-line index) · `/BullEngulfing.html` · `/BearEngulfing.html` ·
   `/HaramiBull.html` · `/HaramiBear.html` · `/HaramiCrossBull.html` · `/HaramiCrossBear.html` ·
   `/Piercing.html` · `/DarkCloudCover.html` · `/Thrusting.html` · `/OnNeck.html` · `/InNeck.html` ·
   `/KickingBull.html` · `/KickingBear.html` · `/MeetingLinesBull.html` · `/MeetingLinesBear.html` ·
   `/SeparateLinesBull.html` · `/SeparateLinesBear.html` · `/MatchingLow.html` ·
   `/HomingPigeon.html` · `/LastEngulfTop.html` · `/LastEngulfBottom.html` · `/DojiStarBull.html` ·
   `/DojiStarBear.html` · `/TweezersTop.html` · `/TweezersBottom.html` · `/AboveStomach.html` ·
   `/BelowStomach.html` · `/TwoBlackGapping.html` · `/HammerInv.html` · `/ShootingStar2.html` ·
   `/FallingWindow.html` · `/CandleAlphabet.html`
5. **CandleScanner** — `https://www.candlescanner.com/candlestick-patterns/<slug>/`
   (construction lists, Japanese names, forecast, trend; 26 pages: bullish-engulfing,
   bearish-engulfing, bullish-harami, bearish-harami, bullish-harami-cross, bearish-harami-cross,
   piercing, dark-cloud-cover, thrusting, on-neck, in-neck, matching-low, homing-pigeon,
   descending-hawk, tweezers-top, tweezers-bottom, last-engulfing-top, last-engulfing-bottom,
   bullish-doji-star, bearish-doji-star, bullish-meeting-lines, bearish-meeting-lines,
   bullish-separating-lines, bearish-separating-lines) plus
   `https://www.candlescanner.com/candlestick-patterns/long-and-short-lines/` (the quantitative
   long-line definition: >70% of an EMA(25) of the high-low range)
6. **StockCharts ChartSchool** —
   `https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/candlestick-bullish-reversal-patterns` ·
   `.../candlestick-bearish-reversal-patterns` ·
   `.../candlestick-pattern-dictionary`
   (**note the internal contradiction on the piercing/dark-cloud open — §C2**)
7. **TradingView built-in candlestick patterns (support solutions)** —
   `https://www.tradingview.com/support/solutions/43000592558-piercing-bullish/` ·
   `https://www.tradingview.com/support/solutions/43000592563/` (Dark Cloud Cover — Bearish);
   includes their `Detect Trend Based On` options (SMA50 / SMA50+SMA200 / no detection)
8. **Steve Nison, "Japanese Candlestick Charting Techniques"** — the three engulfing criteria and
   the doji exception; the *"more than halfway"* piercing/dark-cloud rule and the on-neck/in-neck/
   thrusting rationale. Quoted via web sources (candlecharts.com and 1library.net returned
   404/403); Greg Morris's midpoint requirement and the "80" one-end-match case are quoted
   **directly from TA-Lib's own comment blocks**, which cite both authors by name.
9. **chart-formations.com** — `https://www.chart-formations.com/candlestickpatterns/meetinglinespattern` ·
   `.../darkcloudcoverpattern` (the counterattack GAP requirement TA-Lib omits)
10. **TrendSpider Learning Center** — `https://trendspider.com/learning-center/dark-cloud-cover-a-traders-guide/`
    (the outlier "midpoint of the **range**" reading — §C6)
11. **LuxAlgo Library** — `https://www.luxalgo.com/library/concept/tweezer-top-bottom/`
    (tweezer tolerance; colours not mandatory; trend-context warning)
12. **Candlesticker** — `https://www.candlesticker.com/Pattern.aspx?lang=en&Pattern=2208`
    (Bearish Descending Hawk, second source)

*Investopedia (`/terms/p/piercingpattern.asp`, `/terms/d/darkcloud.asp`) blocked all fetch attempts
and is NOT cited; nothing in this document rests on it.*

---

## (f) DEFECTS IN THE CURRENT ENGULFING RULE

The rules under review:
```
bullish-engulfing: c > o AND o <= min(prev_o, prev_c) AND c >= max(prev_o, prev_c)
bearish-engulfing: c < o AND o >= max(prev_o, prev_c) AND c <= min(prev_o, prev_c)
```

**D1 — A DOUBLE TIE FIRES. (correctness bug)**
`o == prev_c` **and** `c == prev_o` simultaneously satisfies both non-strict bounds, so **two
candles with identical bodies are reported as engulfing.** Every source rejects this. TA-Lib
encodes the rejection with an OR of two half-strict clauses; Bulkowski states the mirror rule for
harami verbatim (*"can be the same price, but not both"*). **Fix:** require at least one end
strict — `(c >= prev_o and o < prev_c) or (c > prev_o and o <= prev_c)`.

**D2 — NO OPPOSITE-COLOUR REQUIREMENT. (the largest false-positive source)**
Because `min`/`max` erase bar[-2]'s colour, a **white** bar engulfing a smaller **white** bar is
reported as a *bullish engulfing*, and a black engulfing a black as a *bearish engulfing*. That
structure is not *tsutsumi* in any source — Nison's criterion #3 requires the opposite colour, and
TA-Lib, Bulkowski, CandleScanner and StockCharts all require it. A white-engulfs-white bar pair is
closer to a **rising-window / belt-hold continuation** than to a reversal. **Fix:** require
`black(prev)` for bullish, `white(prev)` for bearish — with Nison's doji exception handled
explicitly (D3), not implicitly.

**D3 — THE DOJI CASE IS DECIDED BY ACCIDENT.**
When `prev_o == prev_c`, `min == max`, so the rule reduces to `o <= prev_c <= c` and fires on **any**
white bar spanning the doji's price — including a 1-tick body. Nison *does* allow a doji first bar,
but only when it is *"engulfed by a **very large** white real body."* The current rule inherits the
permission and drops the size qualifier. It also fires on a **four-price doji** (`h==l==o==c`),
which CandleScanner explicitly excludes. **Fix:** admit `c1 == o1` deliberately, exclude
`h1 == l1`, and pair it with D4.

**D4 — NO SIZE FLOOR ON EITHER BAR. (noise on 3,700 tickers)**
A 1-cent body "engulfing" a 0-cent body satisfies the rule. Across ~3,700 daily bars this will fire
constantly on illiquid and low-priced names and swamp the real signals. TA-Lib shares this defect;
**CandleScanner and Bulkowski do not** (CandleScanner: bar[-1] must be a *long line*, quantitatively
range > 70% of an EMA(25) of range; Bulkowski: *"a **taller** white one"*). **Fix:** require at
minimum `LONG(2)` (`body(2) > avgBody10`), and consider `body(2) >= 1.2 * body(1)`.

**D5 — NO PRIOR-TREND CONTEXT, AND THE PATTERN IS NOT MERELY WEAKER WITHOUT IT — IT IS THE WRONG
NAME. (the most expensive defect)**
The identical geometry in the opposite trend is **last engulfing top / last engulfing bottom**, and
Bulkowski measured those as *continuing* the prior trend (68% / 65%), i.e. the opposite sign of what
the column reports. Their frequency ranks (14 and 13) sit right beside plain engulfing's (12 and 11),
so **roughly half the geometries the column labels "engulfing" are the oppositely-signed pattern.**
Nison's criterion #1 makes the trend part of the *definition*: *"the market has to be in a clearly
definable uptrend or downtrend."* TA-Lib's own comment concedes the omission.
**Fix:** add a cheap trend gate (TradingView ships exactly this choice — close vs SMA50, or
SMA50 vs SMA200; a 5–10 bar slope is also defensible) and emit **four** labels where there is
currently one: `bullish-engulfing`, `bearish-engulfing`, `last-engulfing-top`,
`last-engulfing-bottom`. Where the trend is indeterminate, emit the geometry with an explicit
`no-trend` qualifier rather than guessing.

**D6 — SHADOWS ARE CORRECTLY IGNORED. (not a defect — keep it)**
The rule compares bodies only. That is right, and unanimous: Nison *"it does not need to engulf the
shadows"*; Bulkowski *"Ignore the shadows"* / *"Shadows are unimportant."* Do not "improve" this
into a high/low comparison — that would build an **outside bar**, a different pattern.

**D7 — TWO PATTERNS ARE NOT A CANDLE COLUMN.**
Engulfing ranks **84/103** (bullish) and **91/103** (bearish) in Bulkowski's post-breakout
performance — i.e. the two patterns the column currently knows are among the *worst* performers he
measured, while cheap two-bar structures the column omits rank far higher: **falling window 7**,
**matching low 8**, **two black gapping 10**, **piercing 13**, **thrusting 15**, **bearish meeting
lines 16**, **in-neck 17**, **bullish meeting lines 18**, **homing pigeon 21**, **dark cloud cover 22**.
The falling/rising window in particular is a two-line comparison (`h2 < l1`) with **no averages, no
thresholds and no tie ambiguity** — the cheapest possible addition and the strongest measured.

**D8 — NO PRECEDENCE MODEL.**
A single-label column needs a documented order. Today, with only two patterns, the question is
hidden; the moment piercing, thrusting, on-neck, in-neck, counterattack and tweezers are added, the
co-fires in §(d) become live. Ship the precedence list in §(d) alongside the detectors, and treat
**tweezers as a modifier flag, never as a competing label.**
