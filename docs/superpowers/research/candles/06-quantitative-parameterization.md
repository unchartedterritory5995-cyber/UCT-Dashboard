# 06 — Quantitative Parameterization of Candlestick Structure

**Researcher 06 of 10 · UCT Intelligence · CANDLE screener column**
Scope: turning prose candle definitions into shippable constants for ~3,700 US daily equity bars.
Method: read the TA-Lib C source and two independent ports; corroborated against Bulkowski,
StockCharts, CandleScanner, TradingView's built-in Pine, and the SEC minimum-increment rule.

---

## (a) The complete TA-Lib candle-settings table

### a.1 The table, verbatim from the C source

`src/ta_common/ta_global.c` — `TA_CandleDefaultSettings[]`
(https://github.com/TA-Lib/ta-lib/blob/main/src/ta_common/ta_global.c)

```c
const TA_CandleSetting TA_CandleDefaultSettings[] = {
    /* real body is long when it's longer than the average of the 10 previous candles' real body */
    { TA_BodyLong,        TA_RangeType_RealBody, 10, 1.0  },
    /* real body is very long when it's longer than 3 times the average of the 10 previous candles' real body */
    { TA_BodyVeryLong,    TA_RangeType_RealBody, 10, 3.0  },
    /* real body is short when it's shorter than the average of the 10 previous candles' real bodies */
    { TA_BodyShort,       TA_RangeType_RealBody, 10, 1.0  },
    /* real body is like doji's body when it's shorter than 10% the average of the 10 previous candles' high-low range */
    { TA_BodyDoji,        TA_RangeType_HighLow,  10, 0.1  },
    /* shadow is long when it's longer than the real body */
    { TA_ShadowLong,      TA_RangeType_RealBody,  0, 1.0  },
    /* shadow is very long when it's longer than 2 times the real body */
    { TA_ShadowVeryLong,  TA_RangeType_RealBody,  0, 2.0  },
    /* shadow is short when it's shorter than half the average of the 10 previous candles' sum of shadows */
    { TA_ShadowShort,     TA_RangeType_Shadows,  10, 1.0  },
    /* shadow is very short when it's shorter than 10% the average of the 10 previous candles' high-low range */
    { TA_ShadowVeryShort, TA_RangeType_HighLow,  10, 0.1  },
    /* when measuring distance between parts of candles or width of gaps */
    /* "near" means "<= 20% of the average of the 5 previous candles' high-low range" */
    { TA_Near,            TA_RangeType_HighLow,   5, 0.2  },
    /* "far" means ">= 60% of the average of the 5 previous candles' high-low range" */
    { TA_Far,             TA_RangeType_HighLow,   5, 0.6  },
    /* when checking if a candle equals another */
    /* "equal" means "<= 5% of the average of the 5 previous candles' high-low range" */
    { TA_Equal,           TA_RangeType_HighLow,   5, 0.05 }
};
```

### a.2 Independent confirmation (QuantConnect LEAN, C# port)

`Indicators/CandlestickPatterns/CandleSettings.cs`
(https://github.com/QuantConnect/Lean/blob/master/Indicators/CandlestickPatterns/CandleSettings.cs)

```csharp
{ CandleSettingType.BodyLong,        new CandleSetting(CandleRangeType.RealBody, 10, 1m)   },
{ CandleSettingType.BodyVeryLong,    new CandleSetting(CandleRangeType.RealBody, 10, 3m)   },
{ CandleSettingType.BodyShort,       new CandleSetting(CandleRangeType.RealBody, 10, 1m)   },
{ CandleSettingType.BodyDoji,        new CandleSetting(CandleRangeType.HighLow,  10, 0.1m) },
{ CandleSettingType.ShadowLong,      new CandleSetting(CandleRangeType.RealBody,  0, 1m)   },
{ CandleSettingType.ShadowVeryLong,  new CandleSetting(CandleRangeType.RealBody,  0, 2m)   },
{ CandleSettingType.ShadowShort,     new CandleSetting(CandleRangeType.Shadows,  10, 1m)   },
{ CandleSettingType.ShadowVeryShort, new CandleSetting(CandleRangeType.HighLow,  10, 0.1m) },
{ CandleSettingType.Near,            new CandleSetting(CandleRangeType.HighLow,   5, 0.2m) },
{ CandleSettingType.Far,             new CandleSetting(CandleRangeType.HighLow,   5, 0.6m) },
{ CandleSettingType.Equal,           new CandleSetting(CandleRangeType.HighLow,   5, 0.05m)}
```

Two independent implementations, byte-identical parameters. This table is the de-facto standard.

### a.3 Summary table

| # | Setting | RangeType | AvgPeriod | Factor | Effective threshold at bar *i* |
|---|---------|-----------|-----------|--------|-------------------------------|
| 0 | `BodyLong` | RealBody | 10 | 1.0 | `1.0 × mean(|C−O|)` over bars *i−10…i−1* |
| 1 | `BodyVeryLong` | RealBody | 10 | 3.0 | `3.0 × mean(|C−O|)` over *i−10…i−1* |
| 2 | `BodyShort` | RealBody | 10 | 1.0 | `1.0 × mean(|C−O|)` over *i−10…i−1* |
| 3 | `BodyDoji` | **HighLow** | 10 | 0.1 | `0.1 × mean(H−L)` over *i−10…i−1* |
| 4 | `ShadowLong` | RealBody | **0** | 1.0 | `1.0 × |C−O|` of **bar *i* itself** (intrinsic) |
| 5 | `ShadowVeryLong` | RealBody | **0** | 2.0 | `2.0 × |C−O|` of **bar *i* itself** (intrinsic) |
| 6 | `ShadowShort` | **Shadows** | 10 | 1.0 | `1.0 × mean(upper+lower)/2` over *i−10…i−1* |
| 7 | `ShadowVeryShort` | HighLow | 10 | 0.1 | `0.1 × mean(H−L)` over *i−10…i−1* |
| 8 | `Near` | HighLow | 5 | 0.2 | `0.2 × mean(H−L)` over *i−5…i−1* |
| 9 | `Far` | HighLow | 5 | 0.6 | `0.6 × mean(H−L)` over *i−5…i−1* |
| 10 | `Equal` | HighLow | 5 | 0.05 | `0.05 × mean(H−L)` over *i−5…i−1* |

`TA_AllCandleSettings = 11` is the sentinel used by `TA_RestoreCandleDefaultSettings`.

### a.4 The exact arithmetic

From `src/ta_func/ta_utility.h`
(https://github.com/TA-Lib/ta-lib/blob/main/src/ta_func/ta_utility.h):

```c
#define TA_REALBODY(IDX)      ( std_fabs( (double)inClose[IDX] - (double)inOpen[IDX] ) )
#define TA_UPPERSHADOW(IDX)   ( (double)inHigh[IDX] - ( inClose[IDX] >= inOpen[IDX] ? (double)inClose[IDX] : (double)inOpen[IDX] ) )
#define TA_LOWERSHADOW(IDX)   ( ( inClose[IDX] >= inOpen[IDX] ? (double)inOpen[IDX] : (double)inClose[IDX] ) - (double)inLow[IDX] )
#define TA_HIGHLOWRANGE(IDX)  ( (double)inHigh[IDX] - (double)inLow[IDX] )
#define TA_CANDLECOLOR(IDX)   ( inClose[IDX] >= inOpen[IDX] ? 1 : -1 )

#define TA_CANDLERANGE(SET,IDX) \
    ( TA_CANDLERANGETYPE(SET) == TA_RangeType_RealBody ? TA_REALBODY(IDX) : \
    ( TA_CANDLERANGETYPE(SET) == TA_RangeType_HighLow  ? TA_HIGHLOWRANGE(IDX) : \
    ( TA_CANDLERANGETYPE(SET) == TA_RangeType_Shadows  ? TA_UPPERSHADOW(IDX) + TA_LOWERSHADOW(IDX) : \
      0 ) ) )

#define TA_CANDLEAVERAGE(SET,SUM,IDX) \
    ( TA_CANDLEFACTOR(SET) \
        * ( TA_CANDLEAVGPERIOD(SET) != 0.0 ? SUM / TA_CANDLEAVGPERIOD(SET) : TA_CANDLERANGE(SET,IDX) ) \
        / ( TA_CANDLERANGETYPE(SET) == TA_RangeType_Shadows ? 2.0 : 1.0 ) \
    )
```

LEAN's port preserves both special cases exactly:

```csharp
defaultSetting.Factor
  * (defaultSetting.AveragePeriod != 0 ? sum / defaultSetting.AveragePeriod
                                       : GetCandleRange(type, tradeBar))
  / (defaultSetting.RangeType == CandleRangeType.Shadows ? 2.0m : 1.0m);
```

**Three things this one macro does that are easy to miss:**

1. **`AvgPeriod == 0` is not "no average" — it is "use the current bar's own range".**
   For `ShadowLong` / `ShadowVeryLong`, `TA_CANDLERANGE(SET, i)` with `RangeType_RealBody`
   evaluates to `|C_i − O_i|`. So the threshold is `1.0 ×` (or `2.0 ×`) the **current bar's
   real body**. These two settings are *deliberately intrinsic*, not relative.
2. **`RangeType_Shadows` carries an implicit `/2`.** The averaged quantity is
   `upper + lower` (the whole non-body portion), and the result is halved so the threshold
   has the units of *one* shadow. This is why the source comment reads "half the average of
   the 10 previous candles' **sum** of shadows". Implementers who omit the `/2` get a
   `ShadowShort` threshold that is 2× too permissive.
3. **The averaging window excludes the bar being classified.**

### a.5 Which bars are in the window — verified from `ta_CDLDOJI.c`

(https://github.com/TA-Lib/ta-lib/blob/main/src/ta_func/ta_CDLDOJI.c)

Priming:
```c
BodyDojiPeriodTotal  = 0;
BodyDojiTrailingIdx  = startIdx - BodyDoji_avgPeriod;
i = BodyDojiTrailingIdx;
while( i < startIdx ) { BodyDojiPeriodTotal += TA_CANDLERANGE(BodyDoji,i); i += 1; }
```
Main loop:
```c
do {
   if( fabs(inClose[i] - inOpen[i]) <= TA_CANDLEAVERAGE(BodyDoji,BodyDojiPeriodTotal,i) )
        outInteger[outIdx++] = 100;
   else outInteger[outIdx++] = 0;
   BodyDojiPeriodTotal += TA_CANDLERANGE(BodyDoji,i) - TA_CANDLERANGE(BodyDoji,BodyDojiTrailingIdx);
   i += 1;
   BodyDojiTrailingIdx += 1;
} while( i <= endIdx );
```

**The test at bar *i* runs BEFORE the sum is updated.** Therefore the window is
`[i − avgPeriod, i − 1]` — exactly `avgPeriod` bars, strictly prior, current bar excluded.
`TA_CDLDOJI_Lookback()` returns `BodyDoji_avgPeriod`, so the first 10 bars of any series
produce no output at all (not a `0` — no output).

For multi-bar patterns the average may be evaluated at an offset index. `CDLHAMMER` uses
`TA_CANDLEAVERAGE(Near, NearPeriodTotal, i-1)`, whose window is `[i−1−5, i−2]`.

### a.6 How real pattern functions compose these — verbatim conditions

These matter because they show the *shape* the CANDLE column should copy.

**`CDLDOJI`** — `/* Must have: open quite equal to close */`
```c
fabs(inClose[i] - inOpen[i]) <= TA_CANDLEAVERAGE(BodyDoji, BodyDojiPeriodTotal, i)
```
One term. No high-low ratio anywhere.

**`CDLMARUBOZU`** — `/* Must have: long real body; no or very short upper and lower shadow */`
```c
fabs(inClose[i]-inOpen[i]) > TA_CANDLEAVERAGE(BodyLong, BodyLongPeriodTotal, i)
&& (inHigh[i] - (max body edge)) < TA_CANDLEAVERAGE(ShadowVeryShort, ShadowVeryShortPeriodTotal, i)
&& ((min body edge) - inLow[i])  < TA_CANDLEAVERAGE(ShadowVeryShort, ShadowVeryShortPeriodTotal, i)
```
**Note what is absent: there is no `body/range > 0.85` term.** Marubozu = *long body* AND
*both shadows below an absolute (history-derived) threshold*. A tiny bar with no wicks is
**not** a marubozu in TA-Lib, because the first term fails.

**`CDLSPINNINGTOP`** — `/* Must have: small real body; shadows longer than the real body */`
```c
upperShadow(i) > fabs(inClose[i]-inOpen[i])
&& lowerShadow(i) > fabs(inClose[i]-inOpen[i])
&& fabs(inClose[i]-inOpen[i]) < TA_CANDLEAVERAGE(BodyShort, BodyPeriodTotal, i)
```
Two intrinsic terms + one relative term. Exactly the hybrid design.

**`CDLHAMMER`**
```c
fabs(inClose[i]-inOpen[i]) < TA_CANDLEAVERAGE(BodyShort,BodyPeriodTotal,i)          /* small rb */
&& lowerShadow(i) > TA_CANDLEAVERAGE(ShadowLong,ShadowLongPeriodTotal,i)            /* long lower shadow */
&& upperShadow(i) < TA_CANDLEAVERAGE(ShadowVeryShort,ShadowVeryShortPeriodTotal,i)  /* very short upper shadow */
&& min(inClose[i],inOpen[i]) <= inLow[i-1] + TA_CANDLEAVERAGE(Near,NearPeriodTotal,i-1)  /* rb near prior lows */
```
Note the *fourth* term: TA-Lib's hammer is **not a single-bar pattern**. It requires the body
to sit near the prior bar's low. A `lower_wick/range > 0.5` rule has no equivalent of this.

**`CDLLONGLINE`**
```c
fabs(inClose[i]-inOpen[i]) > TA_CANDLEAVERAGE(BodyLong,BodyPeriodTotal,i)
&& upperShadow(i) < TA_CANDLEAVERAGE(ShadowShort,ShadowPeriodTotal,i)
&& lowerShadow(i) < TA_CANDLEAVERAGE(ShadowShort,ShadowPeriodTotal,i)
```

**`CDLMATCHINGLOW`** — the canonical use of `Equal`, a two-sided band, never `==`:
```c
inClose[i] <= inClose[i-1] + TA_CANDLEAVERAGE(Equal, EqualPeriodTotal, i-1)
&& inClose[i] >= inClose[i-1] - TA_CANDLEAVERAGE(Equal, EqualPeriodTotal, i-1)
```

### a.7 The configuration API

`include/ta_defs.h`:
```c
typedef enum { TA_RangeType_RealBody = 0, TA_RangeType_HighLow = 1, TA_RangeType_Shadows = 2 } TA_RangeType;

typedef enum {
    TA_BodyLong = 0, TA_BodyVeryLong = 1, TA_BodyShort = 2, TA_BodyDoji = 3,
    TA_ShadowLong = 4, TA_ShadowVeryLong = 5, TA_ShadowShort = 6, TA_ShadowVeryShort = 7,
    TA_Near = 8, TA_Far = 9, TA_Equal = 10, TA_AllCandleSettings = 11
} TA_CandleSettingType;
```
```c
TA_RetCode TA_SetCandleSettings( TA_CandleSettingType settingType,
                                 TA_RangeType rangeType,
                                 int avgPeriod,
                                 double factor );
TA_RetCode TA_RestoreCandleDefaultSettings( TA_CandleSettingType settingType );
```
Documented semantics: *"a candle is compared based on `settingType` with the average of the
last `avgPeriod` candles' `rangeType` multiplied by `factor`."*

The `ta-lib-python` wrapper exposes this as a **process-global mutable** —
`talib/_common.pxi`:
```python
def _ta_set_candle_settings(settingtype, rangetype, avgperiod, factor):
    cdef TA_RetCode ret_code
    ret_code = lib.TA_SetCandleSettings(settingtype, rangetype, avgperiod, factor)
    _ta_check_success('TA_SetCandleSettings', ret_code)

class CandleSettingType(object):
    BodyLong, BodyVeryLong, BodyShort, BodyDoji, ShadowLong, ShadowVeryLong, \
    ShadowShort, ShadowVeryShort, Near, Far, Equal, AllCandleSettings = range(12)

class RangeType(object):
    RealBody, HighLow, Shadows = range(3)
```

> ⚠️ **Production hazard.** `TA_SetCandleSettings` writes into `TA_Globals->candleSettings`
> — a single process-wide array with no locking. If the nightly screener pass and a
> request-time handler share a process, one tuning call silently re-parameterizes every
> other caller. LEAN's port has the same defect (`DefaultSettings` is a static mutable
> `Dictionary`). **Do not use the global setter in the screener; carry the constants in
> your own module and pass them explicitly.**

---

## (b) RangeType semantics, precisely

### `TA_RangeType_RealBody` → `|close − open|`
The signed distance from open to close, absolute-valued. Used to answer *"is this body
long/short compared to how long bodies usually are on this name?"* — a like-for-like
comparison, which is why it is the right basis for `BodyLong`, `BodyVeryLong`, `BodyShort`.

### `TA_RangeType_HighLow` → `high − low`
The full bar range. Used as a **stable, non-collapsing price-scale denominator** for tests
whose subject is *near zero by construction*.

Why `BodyDoji` uses HighLow rather than RealBody — this is the subtle one:
a doji test asks *"is this body approximately zero?"*. If you normalized by the average
**body**, the denominator would be the very quantity you're calling near-zero. In a
consolidation with five small-bodied bars, `mean(|C−O|)` collapses toward zero, the
threshold collapses with it, and the sixth genuinely tiny body fails the test. The metric
eats itself. Anchoring to `mean(H−L)` gives a denominator that stays positive as long as
the stock trades at all. The same reasoning applies to `ShadowVeryShort` (a "no shadow"
test — normalizing by average shadow collapses during a run of marubozu).

### `TA_RangeType_Shadows` → `upperShadow + lowerShadow`
**This is the one implementers get wrong.** It is *not* "the longer shadow", *not* "either
shadow", and *not* `high − low`. It is `(H − L) − |C − O|` — the entire non-body portion
of the bar, both wicks summed into one number.

And it is the only RangeType that triggers the `/2.0` divisor in `TA_CANDLEAVERAGE`. The
chain for `ShadowShort` (RangeType=Shadows, avgPeriod=10, factor=1.0) is:

```
sum      = Σ_{j=i−10}^{i−1} ( upper_j + lower_j )
threshold = 1.0 × (sum / 10) / 2.0
          = mean over the last 10 bars of ((upper + lower) / 2)
          = the average length of a *single* shadow on this name
```

Then `CDLLONGLINE` compares *each* shadow separately against that per-shadow threshold.
If you drop the `/2`, every `ShadowShort` test becomes twice as easy to pass and
`CDLLONGLINE` / `CDLSHORTLINE` fire roughly 2–3× too often. **`Shadows` is the only
RangeType where the averaged quantity and the compared quantity have different units, and
the `/2` is the unit conversion.**

### Why the windows differ (10 vs 5 vs 0)

| Window | Settings | Reason |
|--------|----------|--------|
| **10** | all Body*, ShadowShort, ShadowVeryShort | Shape descriptors. Need enough history to be a stable notion of "typical for this name", short enough to track a volatility regime. |
| **5** | Near, Far, Equal | These measure *distances between price points across bars* (gap width, "body near prior low", "closes match"). A proximity judgment should reflect **current** volatility; a stale 10-day window makes yesterday's coil look "far" from today's expansion. |
| **0** | ShadowLong, ShadowVeryLong | Intentionally intrinsic. "Shadow longer than the body" is a *shape* statement about one candle, and it is the classical rule (StockCharts: *"the long shadow should be at least twice the length of the real body"*). Making it relative would be wrong. |

---

## (c) Self-referential vs. relative — worked comparison

Notation: `body = |C−O|`, `range = H−L`, `avgBody10 = mean(|C−O|)` over the 10 prior bars,
`avgHL10 = mean(H−L)` over the 10 prior bars.

Current screener rules under test:
- doji: `body/range < 0.10`
- marubozu: `body/range > 0.85`
- hammer: `lower_wick/range > 0.5`

TA-Lib equivalents:
- doji: `body <= 0.10 × avgHL10`
- marubozu: `body > 1.0 × avgBody10` AND `upper < 0.10 × avgHL10` AND `lower < 0.10 × avgHL10`
- hammer: `body < avgBody10` AND `lower > body` AND `upper < 0.10 × avgHL10` AND `min(O,C) ≤ low[i−1] + 0.20 × avgHL5[i−1]`

### Case 1 — the 2-tick microcap. Self-referential says MARUBOZU; correct answer is *nothing*.

| | |
|---|---|
| Bar | O = 2.10, H = 2.12, L = 2.10, C = 2.12 (a $2.11 stock, 2 ticks of travel) |
| History | `avgBody10 = 0.061`, `avgHL10 = 0.094` |
| body | 0.02 · range 0.02 · upper 0.00 · lower 0.00 |

- **`body/range` = 1.00 → "MARUBOZU"**, and it is the *most extreme possible* value, so any
  confidence score derived from the ratio maxes out.
- **TA-Lib:** `0.02 > 1.0 × 0.061`? **No.** Not a long body → not a marubozu → returns 0.

The self-referential rule labels a 2-tick nothing-bar as the strongest bullish continuation
candle in the vocabulary. The denominator (`range = 0.02`) is *smaller* precisely because
nothing happened, which is why the ratio is *larger*. **A fraction of the bar's own range
is the only normalizer whose denominator shrinks exactly when noise dominates — it
amplifies quantization noise instead of suppressing it.**

### Case 2 — the quiet day on a volatile name. Self-referential says NOTHING; correct answer is DOJI.

| | |
|---|---|
| Bar | O = 598.00, H = 599.00, L = 597.00, C = 598.60 |
| History | `avgHL10 = 12.00` (a $600 name that routinely travels $12) |
| body | 0.60 · range 2.00 |

- **`body/range` = 0.30 → not < 0.10 → "no pattern".**
- **TA-Lib:** threshold `0.10 × 12.00 = 1.20`; `0.60 ≤ 1.20` → **DOJI (100)**.

Classically TA-Lib is right: open and close are 0.10% apart on a name whose normal day is
2%. That is "virtually equal" by any reading of Nison or Morris. The fixed-fraction rule
missed it because the *whole bar* was small, and a ratio cannot tell "small body" from
"small bar".

### Case 3 — where they agree (the sanity check)

O = 12.00, H = 12.90, L = 11.50, C = 12.02; `avgHL10 = 0.40`, `avgBody10 = 0.18`.
`body/range` = 0.014 → doji. TA-Lib: `0.02 ≤ 0.10 × 0.40 = 0.04` → doji. Both correct.
When the bar's range is near its own historical norm, the two families coincide — which is
exactly why the flaw is invisible on liquid mid-caps and only shows up in the tails.

### Case 4 — the degenerate bar (the production bug)

O = H = L = C = 1.87, volume = 0. `avgHL10 = 0.05`.

| Implementation | Expression | Result |
|---|---|---|
| Fixed fraction | `body/range = 0/0` | `ZeroDivisionError`, or `0 <= 0.10 × 0` → **DOJI** |
| **TA-Lib `CDLDOJI`** | `0.0 <= 0.10 × 0.05 = 0.005` | **DOJI (100)** |
| **pandas-ta `cdl_doji`** | `0.0 < 0.01 × 10 × 0.05 = 0.005` | **DOJI** |
| **TradingView built-in Pine** | `C_Range > 0 and C_Body <= C_Range * 5/100` | **rejected** |

> **The single most important finding in this section: switching to TA-Lib's parameterization
> does NOT fix the 78-zero-range-doji bug.** TA-Lib has no `high > low` guard and no volume
> guard anywhere in `ta_func/`. Its doji comparison is `<=`, so `0 <= anything_positive` is
> always true. Of the four implementations examined, **only TradingView's guards it**, via
> `C_IsDojiBody = C_Range > 0 and ...`. The guard is yours to add (see §e).

### Which definitions REQUIRE the relative form, and which are genuinely intrinsic

**Require history (a fraction of the bar's own range is structurally wrong):**

| Concept | Why |
|---|---|
| long body / very long body — marubozu, long white/black day, belt hold, the engulfing body | "Long" is a comparative with no referent inside one bar |
| short body — spinning top, harami's second body, hammer's body | same |
| **doji body** | needs a price scale that does not collapse to zero; `avgHL` supplies it |
| very short / absent shadow — marubozu, ShadowVeryShort | same collapse problem in reverse |
| "near" / "far" — hammer near prior lows, star gaps, tri-star, abandoned baby | a distance between two bars needs a volatility unit |
| "equal" — tweezers, matching low, identical three crows | a tolerance is meaningless without a scale |
| "significant gap" (vs. a 1-tick gap) | a 1-tick gap is not a gap |

**Genuinely intrinsic to the single bar (no history needed, and making them relative would be wrong):**

| Concept | Expression |
|---|---|
| candle color | `C ≥ O` (note: TA-Lib calls an exactly flat bar **white**) |
| shadow longer than body | `lower > body`, `lower > 2×body` — TA-Lib's `ShadowLong`/`ShadowVeryLong` with `avgPeriod = 0` |
| both shadows exceed the body (spinning top) | `upper > body && lower > body` |
| body position within the range (dragonfly vs. gravestone vs. mid) | `(min(O,C) − L) / (H − L)` — a *position*, not a *size*; ratios are legitimate here |
| containment: inside bar, engulfing, harami | pure two-bar O/C comparisons |
| gap direction | `L[i] > H[i−1]` |
| open == low / close == high (strict marubozu) | tick-level equality, see §f |

**Design rule:** ratios of the bar to itself are correct for **position** questions ("where in
the range does the body sit?") and wrong for **magnitude** questions ("is this body long?").
The current column uses ratios for magnitude questions. That is the structural defect.

---

## (d) Volatility-normalization options and their failure modes

| # | Normalizer | Formula | Failure mode |
|---|---|---|---|
| 1 | **Fraction of own range** *(status quo)* | `body / (H−L)` | Scale-blind **and** size-blind. `0/0` on flat bars. Denominator shrinks with activity ⇒ **amplifies** quantization noise. A 2-tick bar and a 6% bar map to the same value. Cannot distinguish "small body" from "small bar". |
| 2 | **Rolling mean of the same quantity, N prior bars** *(TA-Lib)* | `body vs f × mean(body)_{N}` | (a) **Self-contamination in clusters** — 10 flat bars drive `mean(body)→0`; TA-Lib dodges this for the doji test only, by using HighLow. (b) **Mean is not robust**: one earnings gap inflates the denominator for N sessions and suppresses every "long body" call afterward. (c) Undefined for < N bars (new listings, post-IPO). (d) An unadjusted split injects a fake ±50% bar that poisons the window. |
| 3 | **ATR(14) multiples** | `body vs k × ATR14` | (a) Wilder's TR includes gaps, so gap-prone names get a systematically larger denominator and their *intraday* structure reads "short" — right for range questions, wrong for body questions. (b) Wilder smoothing (α = 1/14) lags a regime change by weeks. (c) Still an absolute dollar quantity ⇒ still needs a tick floor. (d) Garbage across an unadjusted split. |
| 4 | **σ of log returns × price** | `body vs k × σ_20 × C` | (a) **Path-blind** — close-to-close σ says nothing about intrabar travel; a name can have a 5% daily range and near-zero σ. (b) N = 20 makes σ outlier-dominated. (c) A name with many zero-return days drives σ → 0 ⇒ threshold → 0 ⇒ *everything* is "long". (d) Needs a floor. |
| 5 | **Percent of price** | `body / C` | **Volatility-blind**: 1% is enormous for a utility, noise for a biotech. But it is the *only* normalizer that composes cleanly with tick size (`tick/price` is computable), so it is an excellent **guard** and a poor **classifier**. At $1.00 one tick = 1.00%, so "body ≥ 1% of price" is satisfied by a single tick. |
| 6 | **Bollinger bandwidth** | `(upper−lower)/mid`, (20, 2) | (a) Close-based ⇒ path-blind like #4. (b) Already dimensionless, so you must multiply back by price to compare to a body — reintroducing the price scale you were trying to remove. (c) Squeezes toward zero in consolidation, i.e. exactly where quantization noise lives — the same amplification failure as #1. |
| 7 | **Tick counts** | `round(body / tick_size)` | Not a volatility measure at all — a *resolution* measure, and it must not be used as one. Also **state-dependent since 2025-11-03**: SEC Rule 612 now assigns NMS stocks ≥ $1.00 either a $0.01 or a $0.005 increment based on a trailing 3-month time-weighted average quoted spread ≤ $0.015, reassigned semi-annually; < $1.00 remains $0.0001; OTC is unregulated. **You cannot hard-code $0.01.** |
| 8 | **Rolling z-score of OHLC** *(pandas-ta `cdl_z`)* | `z = (x − μ_30)/σ_30`, `ddof=1` | Normalizes *levels*, not *geometry*. Tells you the bar is unusual; tells you nothing about whether it is a hammer. Useful as a companion "significance" score, useless as a classifier. |

**Conclusion: no single normalizer is sufficient.** Ship a two-layer design —
Layer 1 = **eligibility** in tick + liquidity units (§e), Layer 2 = **classification** in
relative units (#2, TA-Lib style), with an ATR cross-check (#3) demoting bars whose range
is trivial relative to their own volatility.

---

## (e) Low-price / low-liquidity guards — as executable preconditions

Context: a whole-market US screener includes $1–3 names where one tick is a large fraction
of the range, plus names that barely trade. The observed failure — 78 zero-range bars
labeled "doji", 55 with zero volume — is not a threshold-tuning problem. It is a **missing
precondition**. Add the preconditions first; the thresholds are second-order.

### The tick-size function (must be data-driven, not a constant)

```python
def tick_size(symbol: str, last_close: float) -> float:
    # SEC Rule 612 as amended Sept 2024, effective 2025-11-03.
    if last_close < 1.00:
        return 0.0001                       # sub-dollar NMS stocks
    if symbol in HALF_PENNY_TIER:           # assigned semi-annually by the listing exchange
        return 0.005
    return 0.01                             # default for NMS stocks >= $1.00
    # OTC / non-NMS: increment is unregulated -> treat tick as UNKNOWN and rely on the
    # dollar-volume gate instead of a tick gate.
```

`ticks(x) = int(round(x / tick_size))`.

### P0 — hard refusals. Emit `NULL`, never a label, never a `0`.

```python
if bar.high <= bar.low:                    return None   # zero-range: no candle geometry exists
if bar.volume is None or bar.volume <= 0:  return None   # carried-forward / synthetic print
if not (bar.high >= max(bar.open, bar.close) and
        bar.low  <= min(bar.open, bar.close)):  return None   # bar-integrity violation
if min(bar.open, bar.high, bar.low, bar.close) <= 0:    return None
if bar.date != latest_session_date:        return None   # stale bar is not "today's candle"
```

`high <= low` alone kills all 78. `volume <= 0` independently kills 55 of them and catches
the class of bar that is *nominally* non-flat but was never actually traded.

> ⚠️ **`0` must not be the "unknown" sentinel.** A `0` sorts and filters as though it were a
> measurement. Return `None`/`NULL` and render `—`. (This repo's own recorded lesson:
> *a `0` meaning "unknown" sorts and filters.*)

### P1 — resolution floor. Below this, the bar is a lattice, not a shape.

```python
MIN_RANGE_TICKS = 4          # see rationale
MIN_RANGE_PCT   = 0.005      # 0.5% of close
MIN_PRICE_CLASSIFY  = 1.00
MIN_PRICE_CONFIDENT = 3.00
MIN_DOLLAR_VOL_20D  = 1_000_000

if ticks(bar.high - bar.low) < MIN_RANGE_TICKS:        return None
if (bar.high - bar.low) < MIN_RANGE_PCT * bar.close:   return None
if bar.close < MIN_PRICE_CLASSIFY:                     return None
if dollar_vol_20d < MIN_DOLLAR_VOL_20D:                return None
```

**Why `MIN_RANGE_TICKS = 4`.** A bar's geometry has three parts — upper shadow, body,
lower shadow — that must sum to the range. With a range of `k` ticks, the reachable
`body/range` values are exactly `{0, 1/k, 2/k, …, 1}`. At `k = 1` the only values are 0 and
1: *every* bar is either a perfect doji or a perfect marubozu. At `k = 2`: {0, 0.5, 1}. At
`k = 3`: {0, ⅓, ⅔, 1}. **Every label below 4 ticks is an artifact of the price lattice, not
a statement about the market.** At `k = 4` there are 5 reachable ratios and at least one
degree of freedom left over after assigning one tick to each of body, upper, lower — the
minimum at which "long lower shadow with a small body and no upper shadow" is even
expressible.

**Why the 0.5%-of-close floor as well.** The tick floor alone lets a $600 stock through on
a 4-tick ($0.04) range — 0.007% of price, which is a data glitch, not a session. The two
floors catch opposite ends of the price distribution and you need both.

**On the minimum price.** Do not use the SEC's $5.00 penny-stock line as a hard cut — with a
$300M market-cap gate already in place, $5.00 removes legitimate small caps. Use `$1.00`
as the hard classification floor (below it the increment changes to $0.0001 and delisting
risk dominates) and `$3.00` as the floor for the *confident* tier. CandleScanner reports
the same shape of problem from the other direction: their default doji body allowance is
0–3% of the candle's own height, and they note *"increasing the size of the doji body is
necessary, primarily for values whose nominal price is greater than $20"* — i.e. a single
fixed fraction cannot serve both ends of the price range, and widening it to fit one end
causes Hammer / Hanging Man / Shooting Star to be swallowed as doji at the other.

### P2 — history floor (protects the denominator)

```python
AVG_PERIOD = 20
SPLIT_OUTLIER_LOG_RET = 0.5

window = [b for b in prior_bars[-AVG_PERIOD*2:]
          if b.volume > 0
          and b.high > b.low
          and abs(log(b.close / b.prev_close)) <= SPLIT_OUTLIER_LOG_RET]   # drop unadjusted splits
if len(window) < AVG_PERIOD:            return None   # not enough clean history
window = window[-AVG_PERIOD:]
```

Excluding zero-range and zero-volume bars from the averaging window is what prevents the
**doji-cluster degeneracy**: a halted or untraded name accumulates flat bars, the denominator
collapses, and then the first real bar is classified against a threshold of ~0.

### P3 — significance demotion (ATR cross-check)

```python
ATR_PERIOD = 14
MEANINGFUL_RANGE_ATR_MULT = 0.5

if (bar.high - bar.low) < MEANINGFUL_RANGE_ATR_MULT * atr14:
    # the bar is real but trivially small for this name:
    # allow  DOJI / SPINNING_TOP / SMALL_BODY  (these are *supposed* to be quiet)
    # forbid MARUBOZU / LONG_BODY / HAMMER / SHOOTING_STAR (these assert conviction)
    confident = False
```

This is the single guard that most directly kills the "$2 stock ticking one cent reads as a
marubozu" class — a marubozu is a *conviction* claim, and a bar covering less than half its
own ATR has no conviction to report. It also generalizes: the Candle-Range-Theory framing
(MQL5) uses the same idea with `LR ≥ 1.5 × ATR` / `SR ≤ 0.5 × ATR` on a 14-bar arithmetic
ATR, and reports that framing cutoffs in ATR units *"keeps CRT portable across symbols,
timeframes, and volatility regimes."*

### The composite precondition, one expression

```python
def eligible(bar, window, atr14, tick, dv20) -> Eligibility:
    if bar.high <= bar.low:                              return REFUSE("zero_range")
    if not bar.volume:                                   return REFUSE("zero_volume")
    if not bar_integrity(bar):                           return REFUSE("ohlc_violation")
    if bar.date != latest_session_date:                  return REFUSE("stale")
    if bar.close < 1.00:                                 return REFUSE("sub_dollar")
    if round((bar.high-bar.low)/tick) < 4:               return REFUSE("lattice")
    if (bar.high-bar.low) < 0.005 * bar.close:           return REFUSE("range_too_small_pct")
    if dv20 < 1_000_000:                                 return REFUSE("illiquid")
    if len(window) < 20:                                 return REFUSE("insufficient_history")
    confident = ((bar.high-bar.low) >= 0.5*atr14) and bar.close >= 3.00
    return OK(confident=confident)
```

Every `REFUSE` reason should be **counted and exposed** — an unexplained drop in the CANDLE
column's populated count is otherwise indistinguishable from a pipeline outage. (Recorded
lesson in this repo: *a refusal count is not a progress metric* — count them, but grade the
column by the code, not by the delta.)

---

## (f) Ties, rounding, and floating point

### What TA-Lib actually does

1. **No epsilon, anywhere.** Every comparison in `ta_func/` is a raw `double` relational
   operator. There is no `TA_EPSILON`, no `fuzzy_eq`, no ULP handling.
2. **`>=` on exact ties, and the tie is *white*.**
   `#define TA_CANDLECOLOR(IDX) ( inClose[IDX] >= inOpen[IDX] ? 1 : -1 )`
   A bar with `close == open` is **bullish/white** by convention. There is no neutral color.
   `TA_UPPERSHADOW` / `TA_LOWERSHADOW` use the same `>=`, so on a flat bar both shadows are
   measured from `close` and the arithmetic stays consistent — but the *color* is a pure
   convention, and any downstream "bullish candle" count inherits it.
3. **Equality between bars is never `==`. It is always a two-sided band.**
   Every "matching"/"equal" pattern routes through the `Equal` setting:
   `x <= y + band && x >= y − band` where `band = 0.05 × mean(H−L)` over the prior 5 bars.
   `CDLMATCHINGLOW`, `CDL3WHITESOLDIERS` (equal opens), `CDLIDENTICAL3CROWS`, tri-star and
   the tweezer-family all use this shape. **Copy this shape; never write `open == close` or
   `high == low` on a price float.**
4. **Boundary operator differs by pattern, and the choice is load-bearing.**
   `CDLDOJI` uses `<=` (inclusive). `CDLHAMMER`'s body test uses `<` (exclusive).
   `CDLMARUBOZU`'s body test uses `>` (exclusive). Because thresholds are derived from
   averages of real prices, exact boundary hits are not vanishingly rare on tick-quantized
   data — a name whose last 10 bodies were all exactly 1 tick gives a `BodyLong` threshold
   of exactly 1 tick, and today's 1-tick body sits precisely on it.
   **pandas-ta's `cdl_doji` uses `<` where TA-Lib uses `<=`:**
   `doji = body < 0.01 * factor * hl_range_avg` (factor default 10, length default 10,
   simple moving average). Same nominal definition, opposite answer on the boundary, and
   opposite answer on the fully degenerate window. If you claim TA-Lib parity, pick the
   operator deliberately and test the boundary.

### What LEAN does differently

The C# port stores prices as `decimal`, so exact equality is *representable* and the `>=`
tie convention is exact rather than accidental. Python `float`/`float64` OHLC arriving from
a JSON API does not have this property.

### Practitioner conventions for "equal", outside TA-Lib

| Source | "Equal" tolerance |
|---|---|
| TA-Lib `Equal` | `0.05 × mean(H−L)` over prior 5 bars |
| Bulkowski (doji) | *"opening and closing prices are within a few pennies of each other"* — an **absolute cents** tolerance |
| Tweezer practice (LuxAlgo / TrendSpider) | *"within a tight tolerance… usually within 0.1% to 0.3% on the daily timeframe"*; *"a tolerance of a tick or two, scaled to the instrument's volatility, is standard; demanding exact matches mostly filters out otherwise valid rejections"* |
| TradingView built-in | `C_ShadowEqualsPercent = 100.0` — shadows "equal" within 100% of each other (very loose, and it divides by `C_DnShadow`, which is **undefined when that shadow is zero**) |

Note that Bulkowski's "a few pennies" is an *absolute* tolerance — correct for a $30 stock,
absurd for a $2 stock (a few pennies is a 1.5% move) and absurd for a $900 stock (a few
pennies is unreachable). This is the third normalization family, and it fails at both ends.

### Recommended tie/tolerance policy

```python
# 1. Quantize once, at ingest. Do every equality and threshold test in integer ticks.
t = tick_size(symbol, close)
o_i, h_i, l_i, c_i = (int(round(x / t)) for x in (o, h, l, c))
# integers: `o_i == c_i` is now exact, total, and instrument-correct.

# 2. If you must stay in float, use a HALF-TICK absolute epsilon, never a relative one.
def price_eq(a, b, t):  return abs(a - b) <= 0.5 * t

# 3. Cross-bar "equal" band: the TA-Lib band with a hard tick floor.
equal_band = max(0.05 * mean_high_low_5, 1 * t)

# 4. Tie convention: declare it explicitly and keep it stable.
#    close == open  ->  color = DOJI/NEUTRAL for display, but WHITE for TA-Lib parity.
#    Pick one; do not let two call sites disagree.
```

**Why the tick floor on `equal_band` matters.** In a 5-day coil on a $2 stock,
`mean(H−L)` can be $0.04, so `0.05 × 0.04 = $0.002` — *one fifth of a tick*. The band is
then narrower than the price grid, "equal" degenerates to bit-identical, and no tweezer or
matching-low ever fires on exactly the instruments where coils are most common. The floor
is `max(band, 1 tick)`. The same floor belongs on `Near` (`max(0.20 × mean_HL_5, 1 tick)`).

### Splits and adjustment

An unadjusted split inside the averaging window creates a fake ±50% "range" bar that
inflates every threshold for `AVG_PERIOD` sessions and silently suppresses all long-body
detections afterward. Either (a) use adjusted bars consistently for both the classified bar
and the window, or (b) drop any window bar with `|log(close/prev_close)| > 0.5`. Do not mix
adjusted and unadjusted across the two — that is the "second authority over one value"
defect in a different costume.

---

## (g) RECOMMENDED PARAMETER SET — constants I would ship

Design: **TA-Lib-compatible factors, lengthened windows, plus a guard layer TA-Lib does not
have.** Every deviation from TA-Lib is listed with its reason so the choice is auditable.

### g.1 Classification constants

```python
# ---- averaging windows -------------------------------------------------------
AVG_PERIOD_SHAPE    = 20   # TA-Lib: 10. Bulkowski: 22 trading days. 20 = 1 month.
AVG_PERIOD_DISTANCE = 5    # TA-Lib: 5. UNCHANGED — proximity must track current vol.
ATR_PERIOD          = 14   # Wilder

# ---- factors (all TA-Lib defaults, unchanged) --------------------------------
BODY_LONG_FACTOR         = 1.00   # RealBody,  AVG_PERIOD_SHAPE
BODY_VERY_LONG_FACTOR    = 3.00   # RealBody,  AVG_PERIOD_SHAPE
BODY_SHORT_FACTOR        = 1.00   # RealBody,  AVG_PERIOD_SHAPE
BODY_DOJI_FACTOR         = 0.10   # HighLow,   AVG_PERIOD_SHAPE
SHADOW_LONG_FACTOR       = 1.00   # RealBody,  period 0  -> INTRINSIC (current bar's body)
SHADOW_VERY_LONG_FACTOR  = 2.00   # RealBody,  period 0  -> INTRINSIC (current bar's body)
SHADOW_SHORT_FACTOR      = 1.00   # Shadows,   AVG_PERIOD_SHAPE   (remember the /2)
SHADOW_VERY_SHORT_FACTOR = 0.10   # HighLow,   AVG_PERIOD_SHAPE
NEAR_FACTOR              = 0.20   # HighLow,   AVG_PERIOD_DISTANCE
FAR_FACTOR               = 0.60   # HighLow,   AVG_PERIOD_DISTANCE
EQUAL_FACTOR             = 0.05   # HighLow,   AVG_PERIOD_DISTANCE

ROBUST_AVERAGE = False  # flag-gated: median instead of mean for the Body* settings.
                        # Bulkowski uses a median-derived threshold (146% of the median of
                        # bars taller than the 5-day average). Ship mean for TA-Lib parity,
                        # A/B the median — one earnings gap otherwise poisons the mean for
                        # 20 sessions.
```

| Setting | RangeType | Period | Factor | Δ vs TA-Lib | Reason for Δ |
|---|---|---|---|---|---|
| BodyLong | RealBody | 20 | 1.00 | period 10→20 | Bulkowski measures against a **22-trading-day** average; 10 days is jumpy on daily equity data. |
| BodyVeryLong | RealBody | 20 | 3.00 | period only | Factor 3.0 is independently corroborated: Bulkowski's Long White Day = *"a body at least three times taller than the average body height over the last 2 or 3 weeks."* Two sources, same number. |
| BodyShort | RealBody | 20 | 1.00 | period only | |
| BodyDoji | HighLow | 20 | 0.10 | period only | Basis stays HighLow — see §b for why RealBody self-destructs here. |
| ShadowLong | RealBody | **0** | 1.00 | none | **Keep intrinsic.** |
| ShadowVeryLong | RealBody | **0** | 2.00 | none | Matches StockCharts: *"the long shadow should be at least twice the length of the real body."* |
| ShadowShort | Shadows | 20 | 1.00 | period only | The `/2` divisor is mandatory. |
| ShadowVeryShort | HighLow | 20 | 0.10 | period only | |
| Near | HighLow | 5 | 0.20 | none | |
| Far | HighLow | 5 | 0.60 | none | |
| Equal | HighLow | 5 | 0.05 | none, **+ 1-tick floor** | See §f. |

### g.2 Guard constants (this layer does not exist in TA-Lib)

```python
MIN_PRICE_CLASSIFY        = 1.00        # below: refuse (tick becomes $0.0001, delist risk)
MIN_PRICE_CONFIDENT       = 3.00        # below: label allowed, "confident" flag withheld
MIN_RANGE_TICKS           = 4           # lattice floor; see §e derivation
MIN_RANGE_PCT             = 0.005       # 0.5% of close; catches high-priced glitch bars
MIN_VOLUME                = 1           # strictly > 0
MIN_DOLLAR_VOL_20D        = 1_000_000
MIN_VALID_HISTORY_BARS    = 20          # == AVG_PERIOD_SHAPE
SPLIT_OUTLIER_LOG_RET     = 0.5         # drop such bars from averaging windows
MEANINGFUL_RANGE_ATR_MULT = 0.5         # below: forbid conviction labels
LARGE_RANGE_ATR_MULT      = 1.5         # optional "wide range bar" tag
EQUAL_FLOOR_TICKS         = 1           # equal_band = max(EQUAL_FACTOR*avgHL5, 1 tick)
NEAR_FLOOR_TICKS          = 1           # near_band  = max(NEAR_FACTOR*avgHL5,  1 tick)
PRICE_EPS_TICKS           = 0.5         # float equality epsilon if not quantizing
COLOR_TIE_IS_WHITE        = True        # TA-Lib parity for close == open
```

### g.3 Rewritten rules for the three current CANDLE labels

```python
body   = abs(c - o); upper = h - max(o, c); lower = min(o, c) - l
avgB   = mean_or_median(|C-O| over the 20 clean prior bars)
avgHL  = mean(H-L over the 20 clean prior bars)
avgHL5 = mean(H-L over the 5  clean prior bars)
avgSh  = mean(upper + lower over the 20 clean prior bars) / 2.0     # <-- the /2

DOJI      : body <= 0.10 * avgHL                                    # was: body/range < 0.10
MARUBOZU  : body >  1.00 * avgB
            and upper < 0.10 * avgHL
            and lower < 0.10 * avgHL
            and (h - l) >= 0.5 * atr14                              # was: body/range > 0.85
HAMMER    : body  <  1.00 * avgB
            and lower >  1.00 * body            # intrinsic, ShadowLong period 0
            and upper <  0.10 * avgHL
            and min(o, c) <= low[i-1] + max(0.20 * avgHL5[i-1], tick)   # was: lower/range > 0.5
```

Every one of these runs only after `eligible(...)` returns `OK`. Precedence when several
match: `MARUBOZU > LONG_BODY > HAMMER/SHOOTING_STAR > SPINNING_TOP > DOJI > NONE`
(most specific wins; doji is the residual, which is why an ungated doji absorbs every
degenerate bar).

### g.4 Free identity refusals to add to the nightly

Cheap, exact, and they fail loudly rather than silently — consistent with this repo's
existing identity rail:

```
h >= max(o, c)                     # else: bad bar
l <= min(o, c)                     # else: bad bar
h > l                              # else: no geometry
body + upper + lower == h - l      # to within 1 tick; else: arithmetic bug
volume > 0  whenever  h > l        # else: synthetic print
count(label == 'doji' and h == l) == 0     # the regression test for THIS bug
count(label is not None and volume == 0) == 0
```

---

## (h) SOURCES

**TA-Lib C source (primary)**
1. `TA_CandleDefaultSettings` table — https://github.com/TA-Lib/ta-lib/blob/main/src/ta_common/ta_global.c
2. `TA_CANDLEAVERAGE` / `TA_CANDLERANGE` / component macros — https://github.com/TA-Lib/ta-lib/blob/main/src/ta_func/ta_utility.h
3. `TA_CandleSettingType` / `TA_RangeType` enums — https://github.com/TA-Lib/ta-lib/blob/main/include/ta_defs.h
4. `ta_CDLDOJI.c` (window semantics, `<=` operator) — https://github.com/TA-Lib/ta-lib/blob/main/src/ta_func/ta_CDLDOJI.c
5. `ta_CDLHAMMER.c` — https://github.com/TA-Lib/ta-lib/blob/main/src/ta_func/ta_CDLHAMMER.c
6. `ta_CDLMARUBOZU.c` — https://github.com/TA-Lib/ta-lib/blob/main/src/ta_func/ta_CDLMARUBOZU.c
7. `ta_CDLSPINNINGTOP.c` — https://github.com/TA-Lib/ta-lib/blob/main/src/ta_func/ta_CDLSPINNINGTOP.c
8. `ta_CDLLONGLINE.c` — https://github.com/TA-Lib/ta-lib/blob/main/src/ta_func/ta_CDLLONGLINE.c
9. `ta_CDLMATCHINGLOW.c` (the `Equal` band) — https://github.com/TA-Lib/ta-lib/blob/main/src/ta_func/ta_CDLMATCHINGLOW.c
10. TA-Lib function index — https://ta-lib.org/functions/

**Ports and wrappers (independent confirmation)**
11. `ta-lib-python` `_common.pxi` — https://github.com/TA-Lib/ta-lib-python/blob/master/talib/_common.pxi
12. `ta-lib-python` docs index — https://ta-lib.github.io/ta-lib-python/doc_index.html
13. QuantConnect LEAN `CandleSettings.cs` — https://github.com/QuantConnect/Lean/blob/master/Indicators/CandlestickPatterns/CandleSettings.cs
14. QuantConnect LEAN `CandlestickPattern.cs` (`GetCandleAverage`, the `/2` and period-0 branches) — https://github.com/QuantConnect/Lean/blob/master/Indicators/CandlestickPatterns/CandlestickPattern.cs
15. pandas-ta `cdl_doji.py` (`body < 0.01 * factor * hl_range_avg`, factor 10, length 10) — https://github.com/twopirllc/pandas-ta (candles module; mirror read at https://github.com/MerlinR/Pandas-ta-fork/blob/master/pandas_ta/candles/cdl_doji.py)
16. pandas-ta `cdl_z.py` (rolling z-score, length 30, ddof 1) — https://github.com/MerlinR/Pandas-ta-fork/blob/master/pandas_ta/candles/cdl_z.py
17. pandas-ta `cdl_pattern` API reference — https://www.pandas-ta.dev/api/candle/
18. TradingView built-in "All Candlestick Patterns" base definitions (`C_BodyAvg = ema(C_Body, 14)`, `C_IsDojiBody = C_Range > 0 and ...`) — https://github.com/shunjizhan/all-candlestick-pattern-indicators/blob/main/all-patterns.pine

**Practitioner methodology**
19. Bulkowski, "Tall Candle Support and Resistance" — bodies *"more than twice as tall as the prior 22 trading day average"*; median-based 146% variant — https://thepatternsite.com/TallCandleSAR.html
20. Bulkowski, "Long White Day" — *"a body at least three times taller than the average body height over the last 2 or 3 weeks"* — https://thepatternsite.com/LongWhiteDay.html
21. Bulkowski, "Long Legged Doji" — *"opening and closing prices are within a few pennies of each other"* — https://thepatternsite.com/LongLegDoji.html
22. StockCharts ChartSchool, "Introduction to Candlesticks" — Nison on doji significance being relative to surrounding bodies; *"the long shadow should be at least twice the length of the real body"* — https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/introduction-to-candlesticks
23. Morris, *Candlestick Charting Explained* — *"there are no rigid rules, only guidelines, and it depends upon previous prices"*; *"requiring that the open and close be exactly equal would put too much of a constraint on the data"* — https://books.google.com/books/about/Candlestick_Charting_Explained.html?id=9ixGWeQ_qLkC

**The low-price / quantization problem**
24. CandleScanner, "The problem with doji candles (Part I)" — doji count vs. nominal price; default body 0–3% of candle height, adjustable to 5%; the widen-the-threshold trade-off that swallows Hammer / Hanging Man / Shooting Star — https://www.candlescanner.com/candlestick-patterns/the-problem-with-doji-candles-part-i/
25. MQL5 Article 9801, "Improved candlestick pattern recognition illustrated by the example of Doji" — replaces absolute thresholds with power/height metrics normalized by bar width — https://www.mql5.com/en/articles/9801
26. MQL5 Article 18911, "Candle Range Theory Tool" — ATR(14) arithmetic mean; `LR ≥ 1.5 × ATR`, `SR ≤ 0.5 × ATR`; *"framing these cutoffs in ATR units keeps CRT portable across symbols, timeframes, and volatility regimes"* — https://www.mql5.com/en/articles/18911

**Tick size / market microstructure**
27. Databento Microstructure Guide, "Sub-Penny Rule" — $0.01 for NMS ≥ $1.00, $0.0001 below $1.00, new $0.005 tier, OTC exempt — https://databento.com/microstructure/sub-penny-rule
28. Sidley, "SEC Adopts Rules Modifying Minimum Pricing Increments…" (Rule 612 amendment, TWAQS ≤ $0.015, semi-annual reassignment) — https://www.sidley.com/en/insights/newsupdates/2024/10/sec-adopts-rules-modifying-minimum-pricing-increments-access-fee-caps-and-order-transparency
29. Davis Polk, "Reg NMS resized" (effective 2025-11-03) — https://www.davispolk.com/insights/client-update/reg-nms-resized-sec-adjusts-tick-sizes-lowers-access-fees-and-accelerates

**Data quality / tolerance conventions**
30. Backtrex, "OHLC data quality for backtesting" — `High >= max(O,L,C)`, `Low <= min(O,H,C)`, zero prices are artifacts, zero-volume bars in an active session are suspicious — https://backtrex.com/en/blog/ohlc-data-quality-validation-backtesting-guide
31. LuxAlgo, "Tweezer Top/Bottom" — *"a tolerance of a tick or two, scaled to the instrument's volatility, is standard"* — https://www.luxalgo.com/library/concept/tweezer-top-bottom/
32. TrendSpider, "Tweezer Tops and Bottoms" — 0.1%–0.3% daily tolerance convention — https://trendspider.com/learning-center/tweezer-tops-and-bottoms-a-traders-guide/
33. Sarker et al., "A formal approach to candlestick pattern classification in financial time series," *Applied Soft Computing* — https://www.sciencedirect.com/science/article/abs/pii/S1568494619304818 *(abstract paywalled/403 at fetch time; cited as a pointer, not relied on for any number in this document)*
34. "Candlestick Pattern Recognition … Using Rule-Based Data Analysis Methods," *Computation* 12(7):132, MDPI — https://www.mdpi.com/2079-3197/12/7/132 *(403 at fetch time; pointer only)*

---

### Verification note

Every numeric parameter in §a is quoted from the TA-Lib C source **and** independently
confirmed in the QuantConnect LEAN C# port. Sources 33 and 34 returned HTTP 403 and were
**not** used to support any claim. The recommendations in §e and §g are my synthesis, not
quotations — the deviations from TA-Lib are individually justified and each is testable
against the 78-bar regression case.
