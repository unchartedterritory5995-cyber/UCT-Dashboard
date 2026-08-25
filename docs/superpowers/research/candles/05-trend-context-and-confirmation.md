# 05 — Prior-Trend Determination, Confirmation, and Context Validity

Researcher 05. Every claim below is traced to a fetched primary source (URLs in §F).
Where I add an engineering rule that no source states, it is marked **[HOUSE]** so it can be
rejected independently of the sourced material.

---

## (A) RECOMMENDED TREND-DETERMINATION RULE

### A.1 The one finding that should drive the design

Two peer-reviewed results, obtained 17 years apart, agree:

- Caginalp & Laurent (1998), on the entire S&P 500 1992–96:
  > "a three-day pattern itself without the correct trend is irrelevant as an indicator"

  and their measured lift is large. Conditional on *already being in a downtrend*, the base rate of
  their reversal event is **p₀ = 45.05%**; conditional on being in a downtrend **and** having the
  candle pattern, it is **p = 71.22%** (Z = 36.03). Up-to-down side: p₀ = 52.78% → p = 67.33%.
- But on *which* trend rule to use, the same paper says:
  > "one can vary the definition of trend without much change in the Z values, so that robustness is confirmed"
  > "A modification of the definition of moving average, e.g. from a three-day to a four-day moving average,
  > makes little difference, as does a similar change in the definition of the trend."

  and Lu, Chen & Hsu (2015, *J. Banking & Finance*), who tested three trend definitions
  (MA3, EMA10, Levy) head-to-head, concluded — as quoted by Tharavanij et al. (2017) —
  > "They find that the results do not depend on which definition of trend is used."

  Tharavanij et al. then chose EMA10 **"for its simplicity"**.

**Therefore: the PRESENCE of a trend gate matters enormously; the CHOICE of gate matters little.**
Do not burn a week optimizing the lookback. Ship a defensible gate, make it configurable, move on.

### A.2 Recommended rule (executable pseudocode)

```python
# --- Parameters (defaults; all configurable) ------------------------------
TREND_MA_PERIOD   = 10        # EMA of close.  Morris; Marshall/Young/Rose (EMA10)
TREND_MA_TYPE     = "EMA"     # Morris: exponential, explicitly, over simple
TREND_DEADZONE_ATR= 0.25      # [HOUSE] neutral band, in ATR(14) units
TREND_SLOPE_BARS  = 3         # MA must also be sloping the right way (Nison use #4; Morris)
TREND_MIN_BARS    = 40        # [HOUSE] warm-up: 3x EMA period + ATR14 + slope bars

def prior_trend(bars, i_pattern_last, pattern_len):
    """
    Returns "up" | "down" | "neutral" | "unknown".

    i_pattern_last : index of TODAY'S bar (the bar being labelled)
    pattern_len    : number of candle lines in the pattern (1, 2, 3, 5 ...)
    """
    f = i_pattern_last - (pattern_len - 1)   # index of the pattern's FIRST bar
    a = f - 1                                # anchor: the bar BEFORE the pattern starts

    if a < TREND_MIN_BARS:
        return "unknown"                     # never guess; see A.4

    ema      = ema_series(bars.close, TREND_MA_PERIOD)
    ema_a    = ema[a]                        # EMA through the bar BEFORE the pattern
    ema_prev = ema[a - TREND_SLOPE_BARS]
    atr_a    = atr_series(bars, 14)[a]

    # Morris: compare the MIDPOINT of the pattern's FIRST candle to the average
    mid = (bars.open[f] + bars.close[f]) / 2.0

    band = TREND_DEADZONE_ATR * atr_a        # [HOUSE] "clearly definable" (Nison)

    up   = (mid > ema_a + band) and (ema_a > ema_prev)
    down = (mid < ema_a - band) and (ema_a < ema_prev)

    if up:   return "up"
    if down: return "down"
    return "neutral"
```

Then, and only then:

```python
# hammer / hanging man share ONE geometry -> emit EXACTLY ONE name
if is_hammer_geometry(bar_today):
    t = prior_trend(bars, today, pattern_len=1)
    if   t == "down": label = "hammer"
    elif t == "up":   label = "hanging-man"
    else:             label = "long-lower-shadow"   # geometry-only, no directional claim

if is_inverted_hammer_geometry(bar_today):
    t = prior_trend(bars, today, pattern_len=1)
    if   t == "down": label = "inverted-hammer"
    elif t == "up":   label = "shooting-star"
    else:             label = "long-upper-shadow"   # geometry-only
```

### A.3 Why each parameter — with the citation

| Choice | Why | Source |
|---|---|---|
| **EMA, not SMA** | Morris: *"After conducting numerous tests on vast amounts of data, a short term exponential smoothing of the data was determined to best identify the short term trend."* and *"Because of the math of calculating the exponential average it will ALWAYS reverse direction immediately after crossing the price data … Always – every time, no exceptions!"* | Morris (StockCharts) |
| **10 periods** | Morris: *"The exponential period of 10 days seemed to work as well as any, especially when you recall that candlesticks have a short term orientation."* Independently, Marshall/Young/Rose (2006) use EMA10 and it is one of the three definitions Lu/Chen/Hsu found interchangeable. 10 trading days also sits inside StockCharts' *"last 1-4 weeks of price action"* window and Morris's *"one to seven days"* horizon. | Morris; MYR 2006; StockCharts |
| **Anchor at the pattern's FIRST bar** | Morris: *"the data is in an uptrend if the first day of a candle pattern is above the 10-day exponential average."* Caginalp & Laurent condition **every one** of their 8 patterns on *"The first day of the pattern, t\*+1, belongs to a downtrend in the sense of Definition 3.1."* TradingView's shipped library does the same via offsets (`C_UpTrend[1]` for 2-bar, `C_DownTrend[4]` for 5-bar). | Morris; C&L 1998; TradingView |
| **Body MIDPOINT of that bar** | Morris, verbatim: *"When you write code for things like this you actually have to say what part of the candlestick is above the average; I used the midpoint."* | Morris |
| **MA evaluated at f-1, not f** | **[HOUSE]**. For a 1-bar pattern, `f` == today; an EMA that includes today's close is partly *made of* the bar it is judging. Shifting one bar removes the self-reference. TradingView does **not** do this (`C_DownTrend := close < sma50` on the same bar) — a stated, deliberate divergence. |
| **Slope agreement** | Morris: *"the main determinant of trend is the direction of the moving average itself."* Nison lists slope as use #4 of a moving average: *"Watching the slope of the moving average."* | Morris; Nison ch.13 |
| **±0.25·ATR neutral band** | **[HOUSE]**, but it discharges Nison's own requirement, which he states as a hard criterion for engulfing patterns: *"The market has to be in a clearly definable uptrend or downtrend, even if the trend is short term."* Every shipped implementation found (TradingView, Morris, MYR, TA-Lib-consumers) is **binary** — a bar 0.01% above its average is declared an uptrend and a "hanging man" is printed with full confidence. That is manufactured certainty. |
| **`unknown` on short history** | **[HOUSE]**. An EMA10 is not converged in 10 bars; ATR14 needs 14. Recent IPOs/spin-offs in a 3,700-name universe will otherwise get confident garbage labels. |

### A.4 Four-state output, not two

Emit `up / down / neutral / unknown` and store the trend state **as its own column** next to the
label. A `neutral` is not a failure — it is the honest answer for a bar sitting on its average,
and it is the state that keeps hammer/hanging-man from being a coin flip. Critically: `neutral`
and `unknown` must be *distinct from each other and from `down`*. Do not encode either as 0/empty
in a numeric column — an "unknown" that sorts and filters as a value is a silent lie.

### A.5 Runner-up methods (in the order I'd fall back)

1. **Caginalp & Laurent (1998) — MA3 monotone-over-6.** Nearly co-primary; the only rule with a
   published effect size attached to it.
   > "The three-day moving average at time t is defined by: Mavg(t) = 1/3{P(t-2) + P(t-1) + P(t)} where
   > P(t) denotes the closing price on day t. **Definition 3.1** A point t is said to be in a downtrend if
   > Mavg(t-6) > Mavg(t-5) > … > Mavg(t) with at most one violation of the inequalities. Uptrend is
   > defined analogously."
   > "The time period of six days corresponds to two lengths of the basic patterns."

   Strengths: non-parametric except the timescale; the "at most one violation" tolerance is exactly
   the flexibility a rigid monotone test lacks; **it is natively three-state** (a bar that satisfies
   neither is neither) so it needs no house dead-zone. Weakness: rejects a lot of bars — which is
   arguably correct behaviour, but will noticeably shrink the count of "hammer" labels.
   *If you want the most defensible rule rather than the most conventional one, use this.*

2. **TradingView's shipped rule** — verbatim from the built-in *All Candlestick Patterns* Pine source:
   ```pine
   var trendRule1 = "SMA50"
   var trendRule2 = "SMA50, SMA200"
   var trendRule  = input(trendRule1, "Detect Trend Based On", options=[trendRule1, trendRule2, "No detection"])
   if trendRule == trendRule1
       priceAvg     = sma(close, 50)
       C_DownTrend := close < priceAvg
       C_UpTrend   := close > priceAvg
   if trendRule == trendRule2
       sma200 = sma(close, 200), sma50 = sma(close, 50)
       C_DownTrend := close < sma50 and sma50 < sma200
       C_UpTrend   := close > sma50 and sma50 > sma200
   ```
   Use this **only if the product goal is that our CANDLE column agrees with what a user sees in
   TradingView.** It is 50 bars for a pattern Morris says is a 1–7 day phenomenon; it will call a
   stock 3% off its all-time high "in a downtrend" the day it dips under the 50-day. It is a parity
   rule, not a correctness rule. Worth exposing as `TREND_RULE="tradingview"`.

3. **StockCharts ChartSchool** — three alternatives offered, user's choice:
   > "The security is trading below its 20-day exponential moving average (EMA)."
   > "Each reaction peak and trough is lower than the previous."
   > "The security is trading below its trend line."
   > "Defining criteria will depend on your trading style and personal preferences."
   Plus the scoping rule: *"because candlesticks are short-term, it is usually best to consider the
   last 1-4 weeks of price action."*

4. **Bulkowski swing-structure.** He does not use a moving average; he locates the pivot the move
   came from and reads the direction off it:
   > "To find the trend peak or valley, I found the lowest valley and highest peak within plus or minus
   > 10 days (21 days total) each, before the outside day…" (and *"The 10-day peak or valley number tends
   > to find major turning points."*)
   > "To find the trend peak or valley, I found the lowest valley and highest peak within plus or minus
   > 5 bars (11 bars total), before the upside weekly reversal…"
   > "I found all peaks at least 5 days apart and all valleys at least 5 days apart."
   Also, for a lighter trending check: *"I compared today's high price with the high prices of 2 and 3
   days ago. This helped to assure the tall candle was at or near a minor high."*
   In at least one study he used regression: *"I used linear regression, so it may be difficult to
   identify the trend visually"* (5-bar inbound trend).

5. **Levy (1971)** — the definition Lu/Chen/Hsu tested alongside MA3 and EMA10: a 6-day percentage
   price slope, compared against the mean of closing-price changes over the most recent **131** days;
   uptrend when the slope exceeds **6×** the average change. Included for completeness; expensive
   (131-bar window) for no measured benefit.

6. **Linear-regression slope over N bars.** No candlestick authority specifies N. Bulkowski used a
   5-bar LR in one study. Treat as unsourced for our purposes.

### A.6 Two production traps not in any source **[HOUSE]**

- **Adjusted vs unadjusted price basis.** The EMA and the OHLC geometry must come from the *same*
  adjustment basis. Computing the EMA from split/dividend-adjusted closes while testing candle
  geometry on raw OHLC will silently flip the trend state across every dividend date.
- **Pattern length must match the detector.** `pattern_len` in `prior_trend()` must be the same
  constant the geometry detector uses, or the anchor bar drifts. TradingView keeps these in sync by
  declaring `C_HammerBullishNumberOfCandles = 1`, `C_MorningStarBullishNumberOfCandles = 3`, etc.
  next to each detector. Copy that discipline — one constant per pattern, consumed by both.

---

## (B) PATTERN → REQUIRED CONTEXT

Legend for **Required**: **DOWN** / **UP** = the pattern is invalid (or is a different pattern)
without that prior trend. **EITHER** = valid in both, but its *meaning* (bullish/bearish) is set by
the trend. **NONE** = no trend requirement in any source found.

**Renamed?** = the same geometry carries a *different name* under the opposite trend. These are the
cases where the current geometry-only screener is emitting a factually wrong label, not merely an
unqualified one.

### B.1 Single-bar

| Pattern | Required | Renamed under opposite trend | Sources |
|---|---|---|---|
| Hammer | **DOWN** | → **Hanging Man** | Nison; Bulkowski ("Downward"); TA-Lib; TradingView; StockCharts; Thinkorswim |
| Hanging Man | **UP** | → **Hammer** | same |
| Inverted Hammer | **DOWN** | → **Shooting Star** | Nison; TA-Lib; TradingView; StockCharts |
| Shooting Star | **UP** | → **Inverted Hammer** | Bulkowski ("Upward"); TA-Lib; TradingView; StockCharts |
| Takuri line | **DOWN** | (hammer family) | Bulkowski; TA-Lib: *"takuri must be considered relatively to the trend"* |
| Doji (plain) | **EITHER** | → **Northern Doji** (in an uptrend) / **Southern Doji** (in a downtrend) | Bulkowski names them by trend; TA-Lib CDLDOJI has no trend note at all |
| Dragonfly Doji | **EITHER** | meaning flips | Bulkowski: *"After an upward price trend, the stock must break out downward from this doji"* |
| Gravestone Doji | **EITHER** | meaning flips | TA-Lib: no note; Bulkowski by trend |
| Long-legged Doji / Rickshaw Man / High Wave | NONE | — | TA-Lib: no trend note |
| Marubozu (white/black), Closing Marubozu | NONE | — | TA-Lib: no trend note; TradingView: no trend gate |
| Spinning Top (white/black) | NONE | — | TA-Lib; TradingView |
| Belt Hold | NONE | — | TA-Lib: no trend note |
| Long Line / Short Line | NONE | — | TA-Lib |
| Long Lower Shadow / Long Upper Shadow | NONE | — | TradingView: no trend gate (`C_DnShadow > C_Range*75%`) |
| Long Black Day | **EITHER** | continuation vs reversal reading flips | Bulkowski: *"look for the candle in a rising price trend (a continuation)"* |

### B.2 Two-bar

| Pattern | Required | Notes / sources |
|---|---|---|
| Bullish Engulfing | **DOWN** | TA-Lib: *"an engulfing must appear in a downtrend if bullish or in an uptrend if bearish, while this function does not consider it"*; Nison criterion #1: *"The market has to be in a clearly definable uptrend or downtrend, even if the trend is short term."* |
| Bearish Engulfing | **UP** | Bulkowski: "Upward"; TradingView `C_UpTrend` |
| Bullish Harami / Harami Cross | **DOWN** | TradingView `C_DownTrend[1]`; TA-Lib notes it for HARAMICROSS (not for HARAMI — an inconsistency in TA-Lib) |
| Bearish Harami / Harami Cross | **UP** | TradingView `C_UpTrend[1]` |
| Piercing Line | **DOWN** | TA-Lib; TradingView `C_DownTrend[1]`; StockCharts |
| Dark Cloud Cover | **UP** | TA-Lib; TradingView `C_UpTrend[1]` |
| Tweezer Top | **UP** | TradingView `C_UpTrend[1]` |
| Tweezer Bottom | **DOWN** | ⚠ **TradingView's shipped code requires `C_UpTrend[1]` here — a bug.** Do not port it. |
| Doji Star (bullish) | **DOWN** | TradingView `C_DownTrend`; TA-Lib: *"a doji star is bullish when it appears…"* |
| Doji Star (bearish) | **UP** | TradingView `C_UpTrend` |
| Above the Stomach | **DOWN** | Bulkowski (best bullish reversal in his 8-best study) |
| Homing Pigeon | **DOWN** | TA-Lib |
| On-Neck / In-Neck / Thrusting | **DOWN** | TA-Lib (bearish continuations); TradingView `C_DownTrend` for On-Neck |
| Rising Window (gap up) | **UP** | TradingView `C_UpTrend[1]` — continuation |
| Falling Window (gap down) | **DOWN** | TradingView `C_DownTrend[1]` — continuation |
| Counterattack Lines | **EITHER (in a trend)** | TA-Lib: *"counterattack is significant in a trend"* |
| Separating Lines | **EITHER (in a trend)** | TA-Lib |
| Matching Low | NONE | TA-Lib: no note |
| Kicking / Kicking by Length | NONE | TA-Lib: no note (the gap carries the signal) |
| Hikkake | NONE | TA-Lib: no note |

### B.3 Three-bar

| Pattern | Required | Notes / sources |
|---|---|---|
| Morning Star / Morning Doji Star | **DOWN** | TA-Lib; TradingView `C_DownTrend`; Nison |
| Evening Star / Evening Doji Star | **UP** | TA-Lib; TradingView `C_UpTrend` |
| Bullish Abandoned Baby | **DOWN** | TradingView `C_DownTrend[2]`; TA-Lib |
| Bearish Abandoned Baby | **UP** | TradingView `C_UpTrend[2]` |
| Three Inside Up | **DOWN** | TA-Lib; C&L definition ties day t*+1 to a downtrend |
| Three Inside Down | **UP** | TA-Lib; C&L |
| Three Outside Up | **DOWN** | TA-Lib uses the strongest wording of any: *"a three outside up **must** appear in a downtrend"* |
| Three Outside Down | **UP** | TA-Lib |
| Three White Soldiers | **DOWN** | TA-Lib: *"significant when it appears in downtrend"*; C&L: first day in a downtrend; Bulkowski: *"in a downward price trend"*. ⚠ **TradingView gates it with NO trend at all.** |
| Three Black Crows | **UP** | TA-Lib: *"after a mature advance or at high levels"*; Bulkowski: *"in a rising price trend"*. ⚠ TradingView: no trend gate. |
| Identical Three Crows | **UP** | TA-Lib |
| Tri-Star (bullish) | **DOWN** | TradingView `C_DownTrend[2]`; TA-Lib has no note |
| Tri-Star (bearish) | **UP** | TradingView `C_UpTrend[2]` |
| Three Stars in the South | **DOWN** | TA-Lib |
| Advance Block | **UP** | TA-Lib |
| Stalled Pattern (Deliberation) | **UP** | TA-Lib |
| Two Crows | **UP** | TA-Lib |
| Upside Gap Two Crows | **UP** | TA-Lib |
| Stick Sandwich | **DOWN** | TA-Lib |
| Unique Three River Bottom | **DOWN** | TA-Lib has no note; Nison describes it as a bottom |
| Upside Tasuki Gap | **UP** | TradingView `C_UpTrend`; TA-Lib: *"significant when it appears in a trend"* |
| Downside Tasuki Gap | **DOWN** | TradingView `C_DownTrend` |
| Side-by-Side White Lines | **EITHER (in a trend)** | TA-Lib |
| Three-Line Strike (bull/bear) | **EITHER (same direction as its first 3 candles)** | TA-Lib: *"significant when it appears in a trend in the same direction of…"* |

### B.4 Four- and five-bar

| Pattern | Required | Notes / sources |
|---|---|---|
| Rising Three Methods | **UP** | TradingView `C_UpTrend[4]`; Bulkowski: *"begins with a tall white candle in a rising price trend"* |
| Falling Three Methods | **DOWN** | TradingView `C_DownTrend[4]` |
| Mat Hold | **UP** | Bulkowski: *"look for the pattern in a rising price trend"*. TA-Lib has **no** trend note. |
| Bullish Breakaway | **DOWN** | TA-Lib: *"breakaway is significant in a trend opposite to the last candle"* |
| Bearish Breakaway | **UP** | TA-Lib; Bulkowski: *"Begin with an uptrend leading to the start of the candle."* |
| Concealing Baby Swallow | **DOWN** | TA-Lib; Bulkowski: *"begin with a downward price trend"* |
| Ladder Bottom | **DOWN** | TA-Lib |
| Up/Downside Gap Three Methods | **EITHER (in a trend)** | TA-Lib |
| Collapsing Doji Star | **UP** | Bulkowski: *"a three-line pattern with an uptrend leading to the start of the candlestick"* |
| Rise/Fall Three Methods (TA-Lib) | NONE in TA-Lib | ⚠ TA-Lib's CDLRISEFALL3METHODS has no trend note even though the pattern is definitionally a continuation |

### B.5 TA-Lib is not trend-qualified — verified, not assumed

I downloaded the TA-Lib C sources and inspected all 61 `ta_CDL*.c` files:

- **42 of 61** mention the trend at all; **41 of 61** carry an explicit caveat that the function does
  not test it, e.g. verbatim from `ta_CDLHAMMER.c`:
  > `outInteger is positive (1 to 100): hammer is always bullish;`
  > `the user should consider that a hammer must appear in a downtrend, while this function does not consider it`

  and `ta_CDLHANGINGMAN.c`:
  > `the user should consider that a hanging man must appear in an uptrend, while this function does not consider it`
- **Zero** CDL functions compute a moving average of price. The only `TA_MA*` token appearing in any
  `ta_CDL*.c` is `TA_MAX_INDEX`. All lookback in these functions goes to `TA_CANDLEAVERAGE(...)`, which
  averages **body and shadow sizes** (BodyLong, BodyShort, BodyDoji, ShadowLong, ShadowVeryShort,
  Near, Far, Equal) — i.e. *size normalisation*, never direction.
- The 19 files that never mention trend: `CDL3BLACKCROWS, CDLBELTHOLD, CDLCLOSINGMARUBOZU, CDLDOJI,
  CDLHIGHWAVE, CDLHIKKAKE, CDLIDENTICAL3CROWS, CDLKICKING, CDLKICKINGBYLENGTH, CDLLONGLEGGEDDOJI,
  CDLLONGLINE, CDLMARUBOZU, CDLMATCHINGLOW, CDLMATHOLD, CDLRICKSHAWMAN, CDLRISEFALL3METHODS,
  CDLSHORTLINE, CDLSPINNINGTOP, CDLTRISTAR`.

**Consequence, stated plainly: TA-Lib's `CDLHAMMER` and `CDLHANGINGMAN` will both return non-zero on
the same bar, because they are the same geometric test with opposite signs and neither looks left.**
Any pipeline that consumes TA-Lib and prints the function name as the pattern name is guaranteed to
mislabel roughly the fraction of hammers that occur in uptrends. The trend gate has to live in *our*
code, and it has to be *exclusive* (exactly one name per bar).

---

## (C) CONFIRMATION

### C.1 Who requires it, and what it means numerically

| Source | Required? | Numeric definition | Window |
|---|---|---|---|
| **StockCharts ChartSchool** | **Yes, always** | *"a gap up, long white candlestick or high volume advance"* (bullish); *"a gap down, long black candlestick, or high volume decline"* (bearish) | *"Because candlestick patterns are short-term and usually effective for only 1 or 2 weeks, bullish confirmation should come within 1 to 3 days after the pattern."* / *"bearish confirmation should come within 1-3 days."* |
| **Nison — hanging man** | **Yes, emphatically**: *"It is especially important that you wait for bearish confirmation with the hanging man."* | *"One method of bearish confirmation would be for the next day's open to be under the hanging man's real body."* Also: *"a black real body day, with a lower close after a hanging-man day, can be another method."* | next session |
| **Nison — inverted hammer** | **Yes**: *"It is important to wait for bullish verification on the session following the inverted hammer."* | *"Verification could be in the form of the next day opening above the inverted hammer's real body. The larger the gap the stronger the confirmation. A white candlestick with higher prices can also be another form of confirmation."* | next session |
| **Nison — hammer** | Situational | *"a white candlestick which closed higher than the close of hammer 4 might have been viewed as a confirmation"* | next session |
| **Nison — doji stars** | Yes | *"it is important to wait for confirmation in the next session or two with doji stars."* | 1–2 sessions |
| **Bulkowski** | Replaces "confirmation" with a **breakout** | *"A close above the top of a candle represents an upward breakout. Similarly, a close below the bottom of the candle pattern is a downward breakout."* He then measures *"from the close of the day the candle pattern ended (not the breakout)"*. In the *Encyclopedia* he tested **three** confirmation methods — closing price, candle colour, opening gap — and reports **opening-gap confirmation works best**. | breakout, whenever it comes |
| **Caginalp & Laurent** | **No** — deliberately | Their 8 three-day patterns are the *"no confirmation necessary"* class; they enter at the close of the pattern's last day and measure `P(t*+3) vs avg(P(t*+4..t*+6))`. | none |
| **Jönsson (2016)** | Both tested | Confirmation for a hammer = `close[t+2] > close[t+1]`; entry at the **open of the following day**, with and without confirmation. | 1 day |

### C.2 What an unconfirmed same-day label may honestly assert

A screener labelling today's bar for 3,700 tickers cannot wait for tomorrow. This is not a defect to
be papered over — it is a constraint that determines what the column is *allowed to say*.

**A same-day, unconfirmed label MAY assert:**
- The geometry: "today's bar has hammer geometry" — fully determined by today's OHLC.
- The context: "the prior trend, measured at the pattern's first bar, was down" — fully determined by
  bars already closed.
- The *name*, therefore, is legitimately "hammer" rather than "hanging man". **Naming is a
  same-day-decidable problem.** This is the whole reason the trend gate is worth building: it fixes
  something that can actually be fixed today.
- An unconditional base rate, if it is labelled as one. Bulkowski's measured rates (from >4.7M candle
  lines) are the citable ones: hammer acts as a bullish reversal **60%**; shooting star as a bearish
  reversal **59%** (which he calls *"near random"* — *"this candle looks better than it performs"*);
  hanging man acts as a bullish **continuation 59%** of the time, ranking 87th of 103; northern doji
  broke upward 10,214 times (51%) vs downward 9,786 (49%).

**A same-day, unconfirmed label MAY NOT assert:**
- "Reversal", "bullish signal", "bearish signal", "confirmed", or any forward-looking claim. Under
  StockCharts' own rule the pattern is not yet a signal: *"Without confirmation, these patterns would
  be considered neutral and merely indicate a potential support level at best."*
- Anything Nison conditions on the next session — a hanging man or an inverted hammer printed today
  is, by Nison's text, explicitly *not yet* actionable.
- Any performance number lifted from Bulkowski **as if it applied to today's bar**, because his
  reversal/continuation rates are conditioned on a *breakout having occurred* (a close outside the
  pattern's range). Quoting "60%" next to an unbroken-out bar is a category error.

### C.3 Recommended shape for the column **[HOUSE]**

Two fields, not one:

- `candle` — the name. Same-day, geometry + prior-trend. Never revised.
- `candle_status` ∈ {`provisional`, `confirmed`, `failed`} — `provisional` on the pattern day;
  resolved on the next bar's data by whichever rule is configured:
  - **closing-price rule** (Bulkowski's breakout): bullish confirmed iff `close[t+1] > high[t..t-n+1]`;
    bearish iff `close[t+1] < low[t..t-n+1]`.
  - **opening-gap rule** (Nison; and Bulkowski's best-performing of the three): bullish iff
    `open[t+1] > max(open[t], close[t])`; bearish iff `open[t+1] < min(open[t], close[t])`.
    Cheapest and earliest — available at the open, one full bar ahead of a close-based rule.
  - **candle-colour rule**: bullish iff `close[t+1] > open[t+1]`; bearish iff `close[t+1] < open[t+1]`.
  - Expire to `failed` if unresolved after **3 bars** (StockCharts' 1–3 day window).

This makes the honest claim mechanically enforceable: a screen for "confirmed hammers" filters on
`candle_status='confirmed'`, and a screen run at 03:00 on today's bar can only ever return
`provisional` rows — which is the truth.

---

## (D) TREND STRENGTH / EXTENSION ("after a *prolonged* advance")

### D.1 No authority gives a number. This must be said out loud.

Every reference to trend *extension* found in the primary sources is qualitative:

- Nison: *"An island after a prolonged uptrend is bearish"*; *"If the engulfing pattern appears after a
  protracted or very fast move. A protracted trend increases the chance that potential buyers are
  already long… A fast move makes the market overextended and vulnerable to profit taking."*;
  *"During a prolonged uptrend…"*; *"the three white candlesticks of the advance block pattern arose
  after the market had already sustained an extended advance"*; *"especially at the heels of a sharp
  advance"*.
- TA-Lib: *"3 black crows is significant when it appears after a mature advance or at high levels"* —
  and, like everything else in TA-Lib, does not test it.
- StockCharts: nothing beyond *"the last 1-4 weeks of price action"*.

So the premise in the brief — *"a hammer 1% off the highs is not the same as a hammer after a 30%
slide"* — is correct and universally agreed, and **no source quantifies it**. Anything we implement
here is house-defined and must be kept **out of the pattern NAME** (in a separate column), so the
name stays reproducible against TradingView / TA-Lib / Bulkowski.

### D.2 Measurable proxies that DO have a source behind them

1. **Position in the 12-month price range, in thirds.** Bulkowski reports this per pattern as a
   standard table entry, e.g. *"Bearish engulfing candles that appear within a third of the yearly low
   perform best"*; shooting stars *"within a third of the yearly low perform best"*; the same for
   northern doji (Encyclopedia p.250). Computable in one pass:
   `pos = (close - min(low,252)) / (max(high,252) - min(low,252))`, bucket `<1/3 / 1/3–2/3 / >2/3`.
   Ship this as `candle_yearly_range_third`.
2. **Side of the 50-day moving average at the breakout.** Bulkowski, *Encyclopedia*: when the breakout
   from a candle is **below** the 50-trading-day moving average, performance is better than above.
   Note this is a *different* MA, used for a *different* purpose (location/extension) than the EMA10
   used for direction. Do not collapse them into one field.
3. **Persistence, via C&L.** `SMA3` monotone over 6 bars with ≤1 violation does not just say "price is
   on the right side of a line" — it says the move has been *going on* for ~6–8 bars. It is the only
   sourced persistence test with a published effect size. If a single "is this trend real" boolean is
   wanted, this is the one to use.
4. **Consecutive up/down closes, distance from the MA in ATRs, % from the 20-day extreme.**
   No candlestick authority found for any of these. **[HOUSE]** if used, and out of the name.

### D.3 Evidence *against* one obvious idea

Do **not** gate the label on an oscillator. Lu, Shiu & Liu (2012) and the follow-up literature find
that filtering candlestick patterns by Stochastic %D, RSI, or MFI **does not increase profitability
nor prediction accuracy**. An "RSI < 30 required for a hammer" rule would be an unsourced restriction
with published evidence against it.

---

## (E) SOURCES DISAGREE

1. **Lookback spread: 3 to 200 bars.**
   3 (C&L SMA3, over a 6-day window) · 5 (Jönsson SMA5 over 6 days; Bulkowski peaks ±5) ·
   10 (Morris EMA10; Marshall/Young/Rose EMA10) · ±10 = 21 bars (Bulkowski, outside days) ·
   20 (StockCharts EMA20; Thinkorswim's `length` default context) · 50 and 50/200 (TradingView) ·
   131 (Levy's average-change window). Candle-specific median ≈ **10**.
   **Resolution:** Lu/Chen/Hsu (2015) tested MA3 vs EMA10 vs Levy and found *"the results do not
   depend on which definition of trend is used"*; C&L independently found their Z-values robust to
   changing the MA length and the trend rule. **Pick 10 and stop arguing.** The 50/200 rule is an
   outlier justified by platform parity, not by evidence.

2. **Presence vs choice of the gate — the sharpest disagreement, and it is only apparent.**
   C&L: *"a three-day pattern itself without the correct trend is irrelevant as an indicator"*
   (45.05% → 71.22%). Same paper, two pages later: the trend definition barely matters. These are
   consistent — *having* a gate is what buys the lift; *tuning* it buys nothing. This is the single
   most actionable sentence in this document.

3. **Where the trend is anchored.**
   Morris & C&L: at the **first bar of the pattern**. TradingView: at the first bar for multi-bar
   patterns (`[1]`, `[2]`, `[4]`) but **at the pattern bar itself** for 1-bar patterns. TA-Lib:
   nowhere. Thinkorswim: a `trend setup` parameter = *"The number of preceding candles to check if the
   trend exists"* — i.e. anchored *before* the pattern, over a configurable window, defaults undocumented.

4. **MA type.** Morris argues hard for exponential (*"it will ALWAYS reverse direction immediately
   after crossing the price data"*). C&L, StockCharts (peaks/troughs) and TradingView all use simple.
   No measured difference reported anywhere.

5. **Binary vs three-state.** Every implementation found is binary — TradingView, Morris, MYR, TOS.
   Nison's own text demands *"a clearly definable uptrend or downtrend"*, which a binary rule cannot
   express. Nobody ships the neutral state. This is a gap in the literature, not a conflict — and it
   is where our implementation can be *better* than the platforms rather than merely equal.

6. **Rename vs re-meaning.** Nison / StockCharts / TradingView / Thinkorswim: the wrong trend gives
   the pattern a **different name**. TA-Lib: never renames — `CDLHAMMER` and `CDLHANGINGMAN` are
   separate functions that fire on the same bar. Bulkowski: names it once and reports how often it
   behaves *opposite* to the name (hanging man = bullish continuation 59% of the time).

7. **Confirmation.** StockCharts: mandatory, 1–3 days, unconfirmed = *neutral*.
   Nison: mandatory for hanging man / inverted hammer / doji stars; optional elsewhere.
   C&L: unnecessary for 3-day patterns, by design.
   Bulkowski: not "confirmation" at all — a breakout (close outside the pattern range), measured from
   the pattern's last close, with **opening-gap** confirmation the best of the three he tested.

8. **Shipped platform code contains real errors.** TradingView's built-in library gates **Tweezer
   Bottom** — a bullish reversal — on `C_UpTrend[1]`, and applies **no trend test at all** to Three
   White Soldiers or Three Black Crows, despite gating almost everything else. Read platform source
   before copying it; do not treat "TradingView does it this way" as authority without opening the file.

9. **Does any of this predict returns?** C&L (1998, S&P 500): strongly yes, Z=36, 0.9% over a two-day
   hold. Marshall/Young/Rose (2006, DJIA): no value. Tharavanij et al. (2017, Thailand): *"Most
   patterns showed no statistical significance regardless of trend definition."* Jönsson (2016,
   OMXS30): *"the eight candlestick patterns cannot be used effectively as trend reversal indicators."*
   Bulkowski's own 4.7M-line data has many patterns at 51/49.
   **Implication for scope:** the trend gate makes the CANDLE column *correct*. It does not make it
   *predictive*, and the column should not be marketed as if it were.

---

## (F) SOURCES

Primary, all fetched (not recalled):

1. **Steve Nison, _Japanese Candlestick Charting Techniques_** (full text PDF, 330pp) —
   https://dl.kohanfx.com/pdf/stevie-nison-candlestick-(KohanFx.com).pdf
   Hammer/hanging man three criteria; engulfing criterion #1 (*"clearly definable uptrend or
   downtrend, even if the trend is short term"*); hanging-man and inverted-hammer confirmation;
   ch.13 moving-average uses (price vs MA, MA as S/R, envelopes, **slope**, dual-MA); *"the 65-day
   moving average (which I find useful for many markets)"* for an intermediate-term uptrend.

2. **Greg Morris, "Candlestick Analysis – Trend Determination", StockCharts (2016-02-24)** —
   https://articles.stockcharts.com/article/articles-dancing-2016-02-candlestick-analysis--trend-determination/
   The single most code-ready statement from any authority: 10-day EMA, first day of the pattern,
   body midpoint. Also *"Japanese candlestick analysis is short term analysis (one to seven days in
   my opinion)"* and *"that is what I used 25+ years ago to do all the testing."*

3. **Thomas Bulkowski, thepatternsite.com** —
   https://thepatternsite.com/Hammer.html · https://thepatternsite.com/HangingMan.html ·
   https://thepatternsite.com/ShootingStar.html · https://thepatternsite.com/BearEngulfing.html ·
   https://thepatternsite.com/NorthernDoji.html · https://thepatternsite.com/MinorHiLow.html ·
   https://thepatternsite.com/OutsideDays.html · https://www.thepatternsite.com/WeeklyRevsUpside.html ·
   https://thepatternsite.com/CandleCPBkout.html
   "Price trend leading to the pattern" field on every pattern page; peak/valley methodology
   (±5, ±10 bars; peaks ≥5 days apart); yearly-price-range thirds; 50-day MA finding.

4. **Bulkowski, "Top 10 Candles That Work", _Technical Analysis of Stocks & Commodities_ 29:6** —
   https://www.fidelity.com/bin-public/060_www_fidelity_com/documents/Top10CandlesWork_620095.pdf
   *"I decided to measure the price move from the close of the day the candle pattern ended (not the
   breakout) to one, three, five, and 10 trading days into the future."* 4.7M candle lines.

5. **Bulkowski, "The Eight Best-Performing Candles", _TASC_ 29:11** —
   https://www.fidelity.com/bin-public/060_www_fidelity_com/documents/EightBestCandles.pdf
   *"Definitions and methodology… A close above the top of a candle represents an upward breakout.
   Similarly, a close below the bottom of the candle pattern is a downward breakout."*

6. **TA-Lib C source, all 61 `ta_CDL*.c` files** —
   https://github.com/TA-Lib/ta-lib/tree/main/src/ta_func
   (e.g. https://raw.githubusercontent.com/TA-Lib/ta-lib/main/src/ta_func/ta_CDLHAMMER.c ,
   .../ta_CDLHANGINGMAN.c). Verified by inspection: 41/61 carry an explicit "does not consider the
   trend" caveat; **zero** compute a price moving average.

7. **TradingView built-in "All Candlestick Patterns" Pine source** —
   https://github.com/shunjizhan/all-candlestick-pattern-indicators/blob/main/all-patterns.pine
   `Detect Trend Based On: SMA50 | SMA50, SMA200 | No detection`; per-pattern trend offsets; the
   Tweezer Bottom bug.

8. **StockCharts ChartSchool** —
   https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/introduction-to-candlesticks ·
   .../candlestick-bullish-reversal-patterns · .../candlestick-bearish-reversal-patterns
   20-day EMA / reaction peaks and troughs / trend line; 1–4 weeks of price action; confirmation
   within 1–3 days; *"Without confirmation, these patterns would be considered neutral."*

9. **Thinkorswim Learning Center** —
   https://toslc.thinkorswim.com/center/reference/Patterns/candlestick-patterns-library/bullish-only/Hammer ·
   .../bearish-only/HangingMan · https://toslc.thinkorswim.com/center/howToTos/thinkManual/charts/Patterns/Candlestick-Pattern-Editor
   Parameters: `length`, **`trend setup` = "The number of preceding candles to check if the trend
   exists"**, `body factor`, `shadow factor`. Defaults not published.

10. **Caginalp, G. & Laurent, H. (1998), "The predictive power of price patterns", _Applied
    Mathematical Finance_ 5(3-4):181-205** —
    https://tradingwithrayner.com/wp-content/uploads/2014/11/The-Predictive-Power-of-Price-Patterns.pdf
    (abstract: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=932984)
    Definition 3.1; *"a three-day pattern itself without the correct trend is irrelevant"*;
    45.05% → 71.22%, Z=36.03; 0.9% over a ~2-day hold; robustness to the trend definition.

11. **Lu, T.-H., Chen, Y.-C. & Hsu, Y.-C. (2015), "Trend definition or holding strategy: What
    determines the profitability of candlestick charting?", _J. Banking & Finance_** —
    https://www.sciencedirect.com/science/article/abs/pii/S0378426615002678
    Three trend definitions (MA3 / EMA10 / Levy) × four holding strategies. Result: profitability is
    driven by the **exit** rule, not the trend definition.

12. **Tharavanij, P., Siraprapasiri, V. & Rajchamaha, K. (2017), "Profitability of Candlestick
    Charting Patterns in the Stock Exchange of Thailand", _SAGE Open_** —
    https://journals.sagepub.com/doi/full/10.1177/2158244017736799
    Verbatim formulas for MA3, EMA10 and Levy; CL vs MYR exit rules; *"They find that the results do
    not depend on which definition of trend is used"*; EMA10 chosen *"for its simplicity."*

13. **Marshall, B., Young, M. & Rose, L. (2006), "Candlestick technical trading strategies: Can they
    create value for investors?", _J. Banking & Finance_** —
    https://www.sciencedirect.com/science/article/abs/pii/S0378426605002116
    Source of the EMA10 trend definition used throughout the later literature; finds no value on DJIA.

14. **Jönsson, M. (2016), "The Predictive Power of Candlestick Patterns", Lund University** —
    https://lup.lub.lu.se/luur/download?func=downloadFile&recordOId=8877738&fileOId=8877838
    SMA5 monotone over 6 days with one allowed violation, explicitly *"a middle ground between the
    ten-day moving average that Marshall et al. (2006) employs and the three-day moving average
    employed by Caginalp and Laurent (1998)"*; entry at the open of the day after the pattern, with
    and without confirmation.

15. **Lu, T.-H., Shiu, Y.-M. & Liu, T.-C. (2012), "Profitable candlestick trading strategies — the
    evidence from a new perspective", _Review of Financial Economics_ 21(2):63-68** —
    https://onlinelibrary.wiley.com/doi/10.1016/j.rfe.2012.02.001
    Filtering candle patterns by %D / RSI / MFI does not improve profitability or accuracy.

*Not obtainable:* Investopedia (WebFetch blocked for the domain — its hammer/hanging-man material is
fully covered by StockCharts and Nison above, so nothing is missing from the analysis).
