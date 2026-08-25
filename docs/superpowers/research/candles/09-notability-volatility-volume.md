# Researcher 09 — Notability: Volatility, Volume, Gaps, Position, and a Complete Descriptive Fallback Vocabulary

Scope: what makes a daily bar **notable** rather than merely **shaped**. Classical Japanese geometry answers "which pattern is this"; this document answers "what did this bar DO, and was it remarkable" — and supplies a fallback naming scheme so that a bar with no classical pattern still earns an honest, informative label instead of a dash.

All thresholds below are cited. Where sources disagree, both numbers are given and a recommendation is made for this screener.

---

## 0. Notation used throughout

Given the current daily bar and `N` prior bars:

```
O, H, L, C            = open, high, low, close of the current bar
PC, PH, PL            = prior bar close, high, low
R    = H - L                                   # "spread" in VSA language; the bar's range
TR   = max(H - L, |H - PC|, |L - PC|)          # true range (Wilder) — includes the gap
ATR14= Wilder-smoothed 14-period average of TR # note: Wilder RMA, not SMA
B    = |C - O|                                 # body
UW   = H - max(O, C)                           # upper wick / shadow
LW   = min(O, C) - L                           # lower wick / shadow
CLV  = (C - L) / R          for R > 0          # Close Location Value, 0.0 .. 1.0
body_pct = B / R            for R > 0
r_hl = R  / ATR14                              # geometric range in ATRs (no gap)
r_tr = TR / ATR14                              # notability range in ATRs (with gap)
AVGV = SMA(volume, 50) computed over the PRIOR 50 bars, today EXCLUDED
rvol = volume / AVGV
gap      = O - PC
gap_pct  = (O - PC) / PC
gap_atr  = (O - PC) / ATR14
```

Two range denominators are in circulation and they are **not** interchangeable:
- **ATR-based** (`R / ATR14`) — the repo's existing `wide_bar`/`narrow_bar` use this.
- **Mean-of-range-based** (`R / SMA(H-L, 21)`) — Bulkowski's wide-ranging-day test uses "three times the one-month average" of the high-low range, i.e. an SMA of `H-L`, *not* an ATR of `TR`. Because ATR ≥ mean(H−L) whenever gaps exist, a "3× ATR" test is strictly harder than Bulkowski's "3× one-month average range". Do not port his 3.0 onto an ATR denominator without re-deriving it.

---

# (a) Range / volatility characterization of a single bar

## a.1 The conventions in use

| Convention | Formula | Source tradition |
|---|---|---|
| ATR multiple | `R / ATR14` or `TR / ATR14` | Wilder; universal in modern screeners |
| Multiple of average spread | `R / SMA(H−L, n)` | VSA (Tom Williams), Bulkowski |
| Percent of price | `R / C` (a.k.a. daily range %), or `ATR14 / C` = "ATRP" | Fidelity / Schwab / TradingView ATR education — "compare a stock's ATR as a percentage of its share price" |
| Ordinal / rank | narrowest or widest range in the last N bars | Crabel (NR4, NR7, WR7) |
| Percentile of range | `percentrank(R, 100)` | practitioner extension of Crabel |
| Band-relative | Bollinger BandWidth = `(UB − LB) / MB × 100`; Keltner uses ATR channels | Bollinger / StockCharts |

## a.2 Named range classes and their published thresholds

**Wide Range Bar (WRB) / Wide Ranging Day**

- **Bulkowski, Wide Ranging Day Upside Reversal** — identification guidelines, verbatim:
  - "Look for the pattern in a short-term down trend."
  - "Look for an unusually tall price bar. **For testing, I used a high-low range on the reversal day that was at least three times the one-month average.**"
  - "The close must be within 25% of the intraday high."
  - "The pattern is composed of one bar."
  - Downside mirror (WRDDR): short-term **up** trend, close within 25% of the intraday **low**.
  - Reported bull-market stats for the upside variant: 56% win rate over 2,903 trades, avg winner $717.71 / avg loser $745.71, 27-calendar-day median hold.
- **VSA numeric convention** (the VSA reference PDF gives explicit multipliers, which most VSA prose omits):
  - **Wide Spread Bar (WRB): spread > 1.8 × average spread**
  - **Narrow Spread Bar (NRB): spread < 0.8 × average spread**
  - **Average spread: 0.8 – 1.8 ×**
- **Existing repo code**: wide = `R > 1.5 × ATR14`, narrow = `R < 0.5 × ATR14`.

**Recommendation for this screener — a 5-band, MECE range ladder on `r = TR / ATR14`:**

| Band | Rule | Label fragment | Provenance |
|---|---|---|---|
| Ultra-wide / expansion | `r ≥ 3.0` | "Range Expansion" | Bulkowski's 3× (loosened denominator noted above) |
| Wide | `1.8 ≤ r < 3.0` | "Wide Range" | VSA WRB = 1.8× |
| Above-normal | `1.3 ≤ r < 1.8` | (no fragment; used for scoring only) | interpolation; keeps the repo's 1.5 inside a band rather than as a cliff |
| Normal | `0.8 ≤ r < 1.3` | (none) | VSA average spread |
| Narrow | `0.5 ≤ r < 0.8` | "Quiet" | VSA NRB = 0.8× |
| Ultra-narrow / compression | `r < 0.5` | "Compression" | repo's existing 0.5 |

Keep the repo's `1.5` as the *alerting* threshold if it is already surfaced elsewhere, but the *label* boundary should be 1.8 so that "Wide Range Bar" means what VSA and Bulkowski mean by it.

## a.3 Range CONTRACTION — the ordinal (Crabel) tests

Crabel's tests are **scale-free ordinals**, not multiples, and that is their virtue: they work identically on a $3 stock and a $900 stock, and they need no ATR.

- **NR4** = "the narrowest range in four days". **NR7** = "the narrowest range in seven days" (Toby Crabel, *Day Trading with Short Term Price Patterns & Opening Range Breakout*, 1990, via StockCharts ChartSchool).
- Range is measured as **absolute high minus low**, not percentage: Crabel noted that over 4–7 bars "the difference between the absolute range and percentage range is negligible".
- StockCharts scan syntax for NR7: `[Range < 1 day ago Min(6, Range)]`.
- **NR7ID / "double compression"**: NR7 that is *also* an inside day — `H < PH AND L > PL` — Crabel's strongest compression signal.
- **Philosophy**: "a volatility expansion often follows a volatility contraction" — StockCharts explicitly ties NR7 to the Bollinger Band Squeeze premise.
- **Raschke & Connors, *Street Smarts* (1995), historical-volatility filter**: when **6-day historical volatility drops below half the 100-day reading** and an inside day or NR4 occurs, an explosive move is imminent. This is the cleanest published *continuous* contraction test and is worth computing alongside the ordinal one.
- **Bollinger BandWidth**: `((UpperBand − LowerBand) / MiddleBand) × 100`. StockCharts is explicit that there is **no universal numeric squeeze threshold** — "BandWidth values should be gauged relative to prior BandWidth values over a period of time", with an **8–12 month lookback** to establish each security's own range. This is a direct argument for using a **percentile rank** rather than a fixed number in a 3,700-ticker screener.

**Recommendation**: compute all three — `NR7` (ordinal), `WR7` (widest range in 7, the mirror), and `range_pctile_100 = percentrank(TR, 100)`. The percentile is the cross-sectionally fair measure; the ordinal is the one traders recognize by name.

## a.4 Range EXPANSION and the "trend day"

- ATR education (Fidelity / Schwab / TradingView): "an expanding ATR indicates increased volatility... the range of each bar getting larger"; ATR is a *strength-of-move* measure and is explicitly directionless — it must be paired with close-location to say anything.
- The practitioner "**trend day**" (Crabel / Raschke lineage): a wide-range bar that opens near one extreme and closes near the other, with little retracement. Executable: `r_tr ≥ 1.5 AND CLV ≥ 0.85 AND (O − L)/R ≤ 0.25` for an up trend day (mirror for down).

---

# (b) Volume confirmation, including the full VSA bar taxonomy

## b.1 Relative Volume (RVOL) — definition and thresholds

**StockCharts ChartSchool, Relative Volume (RVOL)**:
- Formula, verbatim: **"RVOL = current volume / average volume over the look-back period"**.
- **Default lookback = 50 periods, SMA** (period and MA type configurable).
- Thresholds, verbatim / near-verbatim:
  - RVOL 1.0 = current volume equals average.
  - "An RVOL of **1.1** may not be worth acting on."
  - "Many day traders focus on RVOL exceeding **2.0** before taking positions."
  - **"Anything over 4.0 is considered a volume spike and not a typical RVOL value."** Values of 4.0+ at an overbought/oversold extreme may signal reversal.
- **RVOL-TOD** (time-of-day) compares intraday volume to average volume *at that time of day*. Irrelevant for an EOD daily column — the plain daily RVOL is the right one here.

Broker/practitioner banding (TradingSim, Warrior Trading, altFINS) is consistent:
- 1.5–2.0 = elevated interest (earnings, upgrades, sector rotation)
- 2.0–3.0 = a catalyst is present
- ≥ 3.0 = strong interest and reliable liquidity

**Volume dry-up (VDU)** — Kacher & Morales (*In the Trading Cockpit with the O'Neil Disciples*), via TradingSim: **"the VDU candle must be less than 50% of the average volume"**, occurring during consolidation near short-term moving averages. This is the only widely-published *low*-volume numeric threshold.

**Pocket Pivot** — same authors: "a positive (green) closing price on volume that exceeds any prior negative (red) closing bar for at least 10 bars", with the additional requirement that price is still **inside the base** (no breakout yet). Executable:
```
pocket_pivot = (C > PC) AND volume > max(volume[i] for i in 1..10 where C[i] < C[i+1])
```

**Climax volume** — practitioner consensus (TradingSim, Zeiierman): **3× to 10× the average volume at the end of a move**, marking exhaustion/short-term reversal.

**VSA volume bands** (the VSA reference PDF, explicit multipliers):
- **Low volume: < 0.7 × average**
- **High volume: > 1.8 × average**
- **Ultra-high volume: > 3.0 × average**

**Recommendation — a 5-band, MECE volume ladder on `rvol` (denominator = SMA50 of prior volume, today excluded):**

| Band | Rule | Label fragment |
|---|---|---|
| Climactic | `rvol ≥ 4.0` | "on Climactic Volume" |
| Ultra-high | `3.0 ≤ rvol < 4.0` | "on Huge Volume" |
| Heavy | `1.8 ≤ rvol < 3.0` | "on Heavy Volume" |
| Average | `0.7 ≤ rvol < 1.8` | *(no fragment)* |
| Light | `0.5 ≤ rvol < 0.7` | "on Light Volume" |
| Dried up | `rvol < 0.5` | "on Dried-Up Volume" |

## b.2 Does volume change a pattern's validity, its name, or only its strength?

All three, depending on tradition — this matters for the column's design:

1. **Classical Japanese candlesticks**: volume is **not** part of the pattern definition. It changes *strength* only. Bulkowski's candlestick statistics are computed without volume conditions.
2. **Western chart-pattern theory (StockCharts, Bulkowski gaps)**: volume changes **validity**. A breakaway gap "accompanied by an increase in volume is a significant development"; without the volume it is more likely a common/area gap. So volume moves a bar *between* categories.
3. **VSA / Wyckoff**: volume changes the **name**. The identical geometry is a *different named bar* depending on volume. A narrow-spread up bar closing weak is a **No Demand** bar on low volume and something else entirely on high volume. A wide-spread up bar closing on its low is an **Upthrust** on high volume and a **Pseudo Upthrust** on low volume. This is the single most useful property for our purpose: **VSA gives us a vocabulary in which volume is load-bearing for the label, not a footnote.**

VSA's core axiom, **Effort vs Result**: "HIGH volume should produce LARGE price move (effort = result). When effort doesn't equal result = anomaly = professional activity." That axiom is exactly a *notability* detector: it fires when the volume/range relationship is off-diagonal.

VSA's reading order, verbatim from the LuxAlgo concept page: **"Background first, bar second is the VSA reading order."** Neither No-Demand nor No-Supply is actionable standalone: "no-supply after strength = bullish test signal; no-demand after weakness = bearish rally-to-sell signal; either in a vacuum = meaningless." For a screener column this means every VSA label must carry its trend context or it is a lie.

## b.3 VSA close-position convention

From the VSA reference PDF:
- **Up close** = close in the **upper 30%** of the bar (`CLV ≥ 0.70`)
- **Down close** = close in the **lower 30%** of the bar (`CLV ≤ 0.30`)
- **Middle close** = `0.30 < CLV < 0.70`

Corroborating, from the TradingView Closing Range indicator: closing range is expressed 0–100%, "a stock that closes on the high would display 100%, a stock that closes on the low would display 0%"; the script's **default bullish threshold is 50%**, with **40%** offered as a looser alternative — "even if a stock closes down for the day, if the closing range is greater than 40%, that is still considered a sign of strength."

*(Note: that script's write-up states the formula as `(High − Close)/(High − Low)`, which is inverted relative to its own 0%/100% description. The correct and universally used form is `CLV = (Close − Low)/(High − Low)`. Use the latter.)*

## b.4 THE VSA BAR TAXONOMY — executable definitions

Common preconditions (used below):
```
avg_spread = SMA(H-L, 20) over prior bars      # VSA compares to average spread, not ATR
wide   = R > 1.8 * avg_spread
narrow = R < 0.8 * avg_spread
vhigh  = rvol > 1.8
vultra = rvol > 3.0
vlow   = rvol < 0.7
up_close   = CLV >= 0.70
down_close = CLV <= 0.30
mid_close  = 0.30 < CLV < 0.70
uptrend    = C > SMA(C, 30)   # or SMA5 > SMA10 per the TradingView VSA study's filters
downtrend  = C < SMA(C, 30)
```

| VSA bar | Executable rule | Context required | Meaning |
|---|---|---|---|
| **Upthrust (UT)** | `H > max(H[1..n])` (breaks a prior high / resistance) `AND down_close AND vhigh AND wide` — ideally `C ≤ prior_resistance` | at resistance or the top of a trading range, after an up move | Breakout buyers supplied liquidity into which large operators sold. Bearish. |
| **Pseudo Upthrust** | Same geometry as UT but `rvol < 0.7` | near resistance | Weaker version — no professional supply demonstrated; a warning, not a signal. |
| **Reverse Upthrust / Spring (bullish mirror)** | `L < min(L[1..n])` `AND up_close AND vhigh AND wide` | at support, in a downtrend or range low | Stop-run below support then reclaim. Wyckoff calls it a **Spring**. |
| **No Demand (ND)** | `C > PC` (up bar) `AND narrow AND volume < volume[1] AND volume < volume[2]` | in an uptrend / after a rally, or into resistance | Rally not accompanied by professional buying. **Critical**: the volume test is *below **both** of the last two bars*, not merely below average — "Volume below one prior bar happens constantly and proves nothing." |
| **No Supply (NS)** | `C < PC` (down bar) `AND narrow AND volume < volume[1] AND volume < volume[2]` | in a downtrend / after a selloff, near support | Sellers exhausted. Bullish only *after* demonstrated strength. |
| **Stopping Volume (SV)** | `C < PC` or a down-bar open `AND vultra (≥3×) AND wide AND CLV ≥ 0.50` (close in the upper half/third) | after a sustained decline | Heavy selling absorbed; buyers pushed the close back up. "Demand has entered, not that it has won." Confirmation = next bar narrow, lower volume, holds above the SV low. |
| **Selling Climax (SC)** | `wide (often r_tr ≥ 2.5) AND vultra AND L < min(L[1..20]) AND CLV ≥ 0.50` | end of a sustained decline | Wyckoff SC: "widening spread and selling pressure usually climaxes and heavy or panicky selling by the public is being absorbed by larger professional interests at or near a bottom. **Often price will close well off the low.**" |
| **Buying Climax (BC)** | `wide AND vultra AND H > max(H[1..20]) AND CLV ≤ 0.50` | end of a sustained advance | Wyckoff BC: "heavy or urgent buying by the public being filled by professional interests at prices near a top", with "marked increases in volume" and "marked increases in price spread". |
| **Shakeout (SO) / Spring** | `L < min(L[1..20]) AND C > L[1..20] min AND C back inside the prior range` | inside a trading range | Wyckoff: "takes price below the low of the TR and then reverses" to close within the TR. **Low volume is the *preferred* variant** for signal validity (a low-volume spring means there was no supply to shake out). |
| **Test Bar** | `L < L[1] (probes lower) AND vlow AND narrow AND C ≥ midpoint AND C ≥ PC` | after a Spring/SC, inside accumulation | Wyckoff ST: "significantly diminished" volume *and* spread, stopping "at or above the same price level as the SC". A successful test = higher low on lesser volume. |
| **Effort Without Result (churn / squat)** | `vhigh (rvol ≥ 1.8) AND r_tr ≤ 0.8 AND mid_close` — big effort, no range | anywhere, most meaningful at an extreme | The effort/result anomaly itself. Very high volume producing almost no net movement = two-sided transfer = a likely turning point. |
| **Result Without Effort** | `r_tr ≥ 1.8 AND rvol ≤ 0.7` | anywhere | A big move on nobody's participation — a vacuum move, low-conviction, frequently retraced. |
| **Sign of Strength (SOS)** | `C > PC AND wide AND rvol > 1.0 AND up_close` | after a TR / LPS | Wyckoff: "a price advance on increasing spread and relatively higher volume". |
| **Sign of Weakness (SOW)** | `C < PC AND wide AND rvol > 1.0 AND down_close` and price at/below the TR's lower boundary | after distribution | Wyckoff: "increased spread and volume" on a down-move to (or slightly past) the lower TR boundary. |
| **Last Point of Supply (LPSY)** | `narrow AND C > PC AND small gain AND vlow` after an SOW | after a SOW | Wyckoff: a "feeble rally" — narrow spread showing "considerable difficulty advancing". |
| **Automatic Rally (AR)** | first strong up bar after an SC, `rvol` moderate (lighter than the climax) | immediately after SC | Defines the upper boundary of the new trading range. |

Additional VSA events named in Tom Williams' software and in the TradingView VSA study (Supply Coming In, End of a Rising Market, Bag Holding) are variants of the above and are not worth separate labels in a screener column.

---

# (c) Gaps

## c.1 The numeric definition of a gap — two different things, both needed

**Chart gap** (the classical, chartist definition — Bulkowski, verbatim): a gap occurs when "today's high is below yesterday's low (bearish gap), or **today's low is above yesterday's high** (bullish gap)." StockCharts states the same: an up gap forms when "the low price... must be higher than the high price of the previous day." A chart gap is *by construction* still open at the close of the gap day.

**Opening gap** (the trading definition): `O vs PC`. This is what "gapped up 6%" means colloquially, and it is the one that can be *filled intraday*.

**Both must be computed.** They answer different questions:
```
chart_gap_up   = L > PH
chart_gap_down = H < PL
open_gap_up    = O > PC
open_gap_down  = O < PC
open_gap_pct   = (O - PC) / PC
open_gap_atr   = (O - PC) / ATR14
gap_filled     = (open_gap_up  and L <= PC) or (open_gap_down and H >= PC)
```

**Size thresholds.** No source gives a single canonical number; the practical ones in use:
- Screener convention (Trade-Ideas "Gap in Percentage"): a *percentage* gap filter, user-set; 2% and 4% are the common day-trading defaults.
- ATR-normalized (recommended for a 3,700-name universe, since a 2% gap in a utility and in a biotech are not the same event): **notable gap = `|open_gap_atr| ≥ 0.5`**; **large gap = `≥ 1.0 ATR`**.
- Bulkowski on size: "Often very tall gaps will be exhaustion gaps. That makes sense because traders want to take profits after a large gap, which causes price to reverse and fill the gap."

## c.2 The gap taxonomy with Bulkowski's closure statistics

Bulkowski's five types are **area/common, breakaway, continuation (measuring/runaway), exhaustion, ex-dividend**. StockCharts uses the same four plus island reversal. Bulkowski's bull-market statistics (the discriminating data):

| Gap type | Where | Volume | Closes within a week | Median days to close | Discriminator |
|---|---|---|---|---|---|
| **Area / common / pattern** | inside congestion, trendless | returns to normal within a day or two | **85% up / 90% down** | ~3–4 days | No new highs/lows follow the gap |
| **Breakaway** | exits a consolidation, starts a new trend | high on the gap day, often continuing several days | **1% up / 1% down** | **89 days up / 84 days down** | Trend actually starts; best performance near yearly highs (bull) or lows (bear) |
| **Continuation / measuring / runaway** | mid-trend, straight-line advance/decline | usually high | **8% up / 15% down** | 45 days up / 25 days down | Price makes new highs/lows *without* closing the gap; marks ≈ the halfway point of the move |
| **Exhaustion** | at a trend ending | high volume, "often notably tall" | **60% up / 66% down** | **6 days up / 5 days down** | Price consolidates or reverses instead of continuing; may be followed by violent reversal |
| **Ex-dividend** | any | normal | usually same day | 0 | Price drops by the dividend amount |

**Island reversal**: a compact cluster of bars isolated on *both* sides by gaps — an exhaustion gap in, a breakaway gap out in the opposite direction. Executable for a one-bar island: `chart_gap_up on bar t AND chart_gap_down on bar t+1` (island top), i.e. `L[t] > H[t-1] AND H[t+1] < L[t]`.

**The classification honesty problem.** Breakaway vs continuation vs exhaustion **cannot be distinguished on the gap day itself** — every one of Bulkowski's discriminators is a statement about what happens *after* the gap. StockCharts is explicit: exhaustion is "often the first signal of the end of that move", knowable only in hindsight; and "if you see a breakaway gap followed by another gap that does not close in a day or two, then it's probably a continuation gap."

**Consequence for a same-day screener column: do not print "Breakaway Gap" or "Exhaustion Gap" on the gap day.** Print what is measurable — direction, size, whether it filled, and where it closed. The proposed labels in section (f) do exactly this. A separate *retrospective* column may classify gaps 5+ bars later.

## c.3 Gap-fill statistics (index-level, for calibration only)

- SPY, 6-month sample: 59% of gap-ups filled, 69% of gap-downs filled.
- ES futures, all gap types: **68–72% same-session fill**.
- NQ 2015–2025, 2,791 days: gap-downs fill 62.2% vs gap-ups 58.8%.
- Fill probability is strongly **inversely** related to gap size: gaps of 0.5–0.99% fill 59.35% on day 1 and 74.32% within two days; gaps of 1.0–1.99% fill 46.74% on day 1 and 57.22% within two days; large gaps show fill rates in the single digits.
- Timing: 80%+ of same-day fills complete by noon ET.

Caveat: these are **index** numbers. Single-stock gaps are overwhelmingly news-driven and fill far less often. Use them for the *shape* of the relationship (bigger gap → less likely to fill), not for the absolute levels.

## c.4 How a gap interacts with the candle it opens

The most useful gap-plus-candle composites, all executable same-day:

```
gap_and_go_up    = open_gap_up   and not gap_filled and C >= O and CLV >= 0.60
gap_up_faded     = open_gap_up   and C < O and CLV <= 0.40           # bearish exhaustion bar
gap_up_filled    = open_gap_up   and L <= PC                          # sellers erased the gap intraday
green_to_red     = open_gap_up   and C < PC                           # gapped up and closed RED
gap_and_go_down  = open_gap_down and not gap_filled and C <= O and CLV <= 0.40
gap_down_faded   = open_gap_down and C > O and CLV >= 0.60           # bullish exhaustion bar
red_to_green     = open_gap_down and C > PC                           # gapped down and closed GREEN
```

The Trading Setups Review **Exhaustion Bar** definition maps exactly onto two of these:
- *Bullish exhaustion bar*: "opens with a gap down. Then, it works its way up to close near its top", gap **unfilled**, high volume.
- *Bearish exhaustion bar*: "opens with a gap up before moving down to close as a bearish bar", gap unfilled, high volume.

---

# (d) Position within the recent range

## d.1 Close position *within the bar*

- `CLV = (C − L) / R`. VSA thirds: up-close ≥ 0.70, down-close ≤ 0.30 (see b.3).
- Closing-range practitioner thresholds: **≥ 50% default bullish, ≥ 40% "still a sign of strength" even on a down day**.
- **Top/bottom decile**: `CLV ≥ 0.90` = "closed on the high"; `CLV ≤ 0.10` = "closed on the low". This is the strongest single-bar strength statement available and deserves its own label fragment.
- Bulkowski's wide-ranging-day reversal uses **"within 25% of the intraday high"**, i.e. `CLV ≥ 0.75` — a useful middle threshold.

## d.2 Position relative to recent structure

| Measure | Executable | Convention / threshold | Source |
|---|---|---|---|
| New 20-day high / low | `H > max(H[1..20])` / `L < min(L[1..20])` | 20 is the Turtle/Raschke standard | Raschke & Connors, *Street Smarts* |
| New 52-week high / low | `H > max(H[1..252])` / `L < min(L[1..252])` | — | universal |
| Near 52-week high | `C ≥ 0.95 × max(H[1..252])` | **within 5%** is the common screener default; **within 10%** the looser momentum-screen default | momentum-screen convention; George & Hwang (2004) established 52-week-high proximity as a momentum factor |
| Minervini Trend Template | `C within 25% of the 52-week high` **and** `C ≥ 1.30 × 52-week low`, plus `C > MA50 > MA150 > MA200`, MA200 rising ≥1 month, RS rating > 70 | 25% / 30% | Minervini trend template |
| Closed above/below a prior swing | `C > swing_high[k]` where `swing_high` = a fractal/pivot high (`H[i] > H[i±1..±k]`), k = 2 or 3 | k=2 is the standard "3-bar pivot" | market-structure convention |
| Distance from a moving average, in ATRs | `(C − MA) / ATR14` | **Overextended**: ≥ 1.5 ATR(10) from the 8-EMA (Roger Scott "150% ATR rule"); ≥ 3 ATR above the 90-day MA; > 7 ATR above the MA50 = "too extended historically to swing trade" | practitioner ATR-overextension conventions |
| Percent from a moving average | `(C − MA50)/MA50` | 10%/20% common | universal |
| Position within the N-day range | `(C − min(L[1..N])) / (max(H[1..N]) − min(L[1..N]))` — i.e. a Stochastic %K over the *bar structure* | 0.0–1.0; ≥0.8 upper fifth, ≤0.2 lower fifth | Lane's %K applied to structure |

**Recommendation**: compute `pos20 = (C − min(L[1..20])) / (max(H[1..20]) − min(L[1..20]))` and `pos252` likewise. These two scalars are the cheapest way to give *every* bar an honest positional statement, and they never fail to compute (except on short history).

---

# (e) Western / practitioner reversal-bar vocabulary (outside the Japanese canon)

These are the names a US swing-trading screener needs that classical candlestick theory does not supply.

### e.1 Key Reversal Day

Two traditions, and the difference matters:

- **Loose (industry-standard, InvestingAnswers / TradingMarkets):** "In an uptrend, a key reversal day occurs when prices hit a **new high** and then **close near the previous day's lows**. In a downtrend, prices hit a new low, but close near the previous day's highs." Also called a *one-day reversal*. "The greater the price range and volume on the day that this occurs, the more reliable the signal."
  ```
  key_reversal_down_loose = H > max(H[1..20]) and C < PL + 0.25*(PH-PL)
  key_reversal_up_loose   = L < min(L[1..20]) and C > PH - 0.25*(PH-PL)
  ```
- **Strict (Bulkowski, "Key Reversal, Downtrend"), verbatim:** the pattern "is composed of two bars", occurs "in a short-term downtrend", and requires **all three** of: "today's close above the prior day's high, today's open below the prior day's close, and today's low is below the prior day's low." Stats: overall rank 3/23, 43% failure rate (bull market, up breakouts), average rise 7%, 69% hit the price target.
  ```
  key_reversal_up_strict = (C > PH) and (O < PC) and (L < PL)      # + downtrend context
  key_reversal_dn_strict = (C < PL) and (O > PC) and (H > PH)      # + uptrend context
  ```
- **Trading Setups Review's "key reversal bar"** is a third, even stricter form: bullish = "opens **below the low** of the previous bar and closes **above its high**" (a full gap-and-engulf).

**Recommendation:** ship Bulkowski's strict form under the name "Key Reversal", and the loose form under "Reversal Day". Do not conflate them.

### e.2 Outside Day / Outside Reversal

```
outside_day       = H > PH and L < PL
outside_rev_up    = outside_day and C > PH
outside_rev_down  = outside_day and C < PL
outside_indecisive= outside_day and PL <= C <= PH
```
Trading Setups Review: "range must exceed that of the previous bar with a higher high and a lower low." Note the distinction from a Japanese **engulfing** pattern, which compares **bodies** (`O`/`C`), not **extremes** (`H`/`L`). An outside day is a *range* statement; engulfing is a *body* statement. They frequently disagree, and a screener that treats them as synonyms will mislabel bars.

### e.3 Two-Bar Reversal

"A strong bearish bar followed by a bullish bar" closing in opposite directions (and the mirror). Executable, with strength conditions added:
```
two_bar_rev_up = (C[1] < O[1]) and CLV[1] <= 0.25 and (C > O) and CLV >= 0.75 and C > (H[1]+L[1])/2
```
The tradeable level is the extreme of the pair (buy above the highest point of the two bars; sell below the lowest).

### e.4 Red-to-Green / Green-to-Red

The **prior close** is the reference line every intraday participant watches.
```
red_to_green = O < PC and C > PC        # opened red, closed green
green_to_red = O > PC and C < PC        # opened green, closed red
```
Practitioner framing: R2G squeezes shorts and creates FOMO buying; G2R traps longs and triggers stops. "The first cross of the day matters most and sets the daily tone. Volume confirms the move — low-volume crosses often fail." On a daily EOD column, the *full-day* version (open on one side of PC, close on the other) is the honest one, and it is one of the most information-dense two-value comparisons available.

### e.5 Failed Breakout / Turtle Soup

Raschke & Connors, *Street Smarts* (1995) — a fade of a failed N-day breakout:
- Market makes a new **20-bar low** (or high).
- **The previous 20-bar extreme was made at least 3–4 bars earlier** (this qualifier is the whole edge; without it you are fading a fresh trending breakout).
- The close of the new extreme must be **at or below** (for longs) the previous 20-bar low.
- Entry: a buy stop the next bar at the previous 20-bar low ("Turtle Soup Plus One" waits one bar).

Same-day-observable version for a screener:
```
failed_breakout_up   = H > max(H[1..20]) and C < max(H[2..21])   # poked out, closed back inside
failed_breakout_down = L < min(L[1..20]) and C > min(L[2..21])
```

### e.6 Undercut & Reclaim (U&R) / Shakeout

O'Neil-lineage swing-trading vocabulary: price "breaks below a key level (a 20-day low, the 50-day SMA, a prior swing low) triggering stop-losses and fear selling, and then reverses sharply back above the level." The undercut **is** the shakeout — it removes weak hands with tight stops; "the faster the reclaim, the stronger the signal", ideally on increased volume, with the stop at the new swing low.
```
undercut_reclaim = L < min(L[1..20]) and C > min(L[1..20]) and C > PC
ma_reclaim_50    = L < MA50 and C > MA50 and PC < MA50   # reclaimed a lost MA
```
This is the *bullish* twin of the Turtle Soup fade and of the Wyckoff **Spring**; all three describe the same geometry with different provenance. Pick one name and stick to it (recommend "Undercut & Reclaim" for equities, "Spring" only when a trading range has been identified).

### e.7 Exhaustion Bar

Two definitions, both in use:
- **Gap-based (Trading Setups Review, Webull):** bullish = "opens with a gap down, then works its way up to close near its top", the gap remains **unfilled**, on **high volume**. Bearish mirror.
- **Size-based (2ndSkies):** "a bar that is much larger than the previous price action and ideally the largest bar in the move", at/near a key level, after several impulsive bars in one direction.

Merged executable form:
```
exhaustion_bar_bull = (open_gap_down or r_tr >= 2.0) and CLV >= 0.75 and rvol >= 2.0 and L < min(L[1..20])
exhaustion_bar_bear = (open_gap_up   or r_tr >= 2.0) and CLV <= 0.25 and rvol >= 2.0 and H > max(H[1..20])
```

### e.8 Wide-Range-Bar Reversal (Bulkowski WRDUR / WRDDR)

```
wrb_reversal_up   = downtrend_short_term and R >= 3.0 * SMA(H-L, 21) and CLV >= 0.75
wrb_reversal_down = uptrend_short_term   and R >= 3.0 * SMA(H-L, 21) and CLV <= 0.25
```
Note again: Bulkowski's denominator is `SMA(H−L, ~21)`, **not** ATR.

### e.9 Pivot / hook reversal, pin bar

- **Pinocchio bar / pin bar** (Trading Setups Review): "long and distinct tail" on one end, rejected from a level. Executable: `LW >= 2*B and LW >= 0.55*R and UW <= 0.15*R` (bullish pin). This is geometrically identical to the Japanese hammer; the Western name adds the *level-rejection* requirement.
- **Reversal bar** (loosest form): bullish "goes below the low of the previous bar before closing higher" — `L < PL and C > PC`. Bearish: `H > PH and C < PC`. Cheap, common, and a good low-tier fallback.
- **Three-bar reversal**: bar1 bearish; bar2 lower high *and* lower low; bar3 bullish with a higher low that **closes above bar 2's high**. Mirror for bearish.

### e.10 Inside Day / Compression

Trading Setups Review: an inside bar "must stay completely within the range of the bar immediately before it" — `H < PH and L > PL`. Combined with NR7 this gives Crabel's **NR7ID** double compression.

---

# (f) THE PROPOSED COMPLETE FALLBACK VOCABULARY

## f.1 Design principle

The taxonomy is a **strict priority cascade**: an ordered list of predicates `P1 … Pn` evaluated against the bar's feature vector, first match wins, with `Pn ≡ TRUE`. This construction is **mutually exclusive by evaluation order** and **collectively exhaustive by the terminal `TRUE`**. The intellectual work is not in proving those two properties — it is in guaranteeing that the *terminal* tiers still produce an **informative** name rather than a shrug. Section f.4 shows that they do.

The label has a **head** (what the bar did — one of the mutually exclusive classes below) and up to two **suffix fragments** (close-location and volume). Suffixes are drawn from MECE ladders and are therefore themselves single-valued.

```
LABEL = HEAD [", " CLOSE_FRAGMENT] [" " VOLUME_FRAGMENT]
```

Example rendered cells:
- `Gap Up & Go, closed on the high, on Heavy Volume`
- `Upthrust at 20-Day High, on Climactic Volume`
- `Wide Range Down Bar, closed on the low, on Huge Volume`
- `Quiet Up Bar, mid-range close, on Dried-Up Volume`
- `Inside Day (NR7), on Dried-Up Volume`

## f.2 The suffix ladders (each MECE, each total)

**CLOSE_FRAGMENT** on `CLV` (undefined when `R = 0` → fragment omitted, head is `Flat Bar`):

| CLV | fragment |
|---|---|
| ≥ 0.90 | closed on the high |
| 0.70 – 0.90 | closed strong |
| 0.55 – 0.70 | closed upper-half |
| 0.45 – 0.55 | closed mid-range |
| 0.30 – 0.45 | closed lower-half |
| 0.10 – 0.30 | closed weak |
| < 0.10 | closed on the low |

**VOLUME_FRAGMENT** on `rvol` (omitted entirely when volume is unavailable — see f.5):

| rvol | fragment |
|---|---|
| ≥ 4.0 | on Climactic Volume |
| 3.0 – 4.0 | on Huge Volume |
| 1.8 – 3.0 | on Heavy Volume |
| 0.7 – 1.8 | *(none — average)* |
| 0.5 – 0.7 | on Light Volume |
| < 0.5 | on Dried-Up Volume |

## f.3 The HEAD cascade — 30 labels, strict priority order

Evaluate top to bottom; first match wins. Tier 0 is a guard; tiers 1–5 are ordered by *information density*, i.e. by how surprising the event is.

### Tier 0 — degenerate guards (must be first, or later tiers divide by zero)

| # | HEAD label | Rule |
|---|---|---|
| 0.1 | `No Trade` | `volume == 0` or the bar is missing |
| 0.2 | `Flat Bar` | `R == 0` (halted / limit / one-price day) |

### Tier 1 — Gap is the story (measurable same day; no forward-looking gap type is named)

| # | HEAD label | Rule (`g = open_gap_atr`, notable when `|g| ≥ 0.5` or `|gap_pct| ≥ 0.02`) |
|---|---|---|
| 1.1 | `Island Reversal Top` | `chart_gap_up[1] and chart_gap_down[0]` |
| 1.2 | `Island Reversal Bottom` | `chart_gap_down[1] and chart_gap_up[0]` |
| 1.3 | `Gap Up & Go` | notable up gap, `not gap_filled`, `C ≥ O`, `CLV ≥ 0.60` |
| 1.4 | `Gap Up, Reversed` | notable up gap, `not gap_filled`, `C < O`, `CLV ≤ 0.40` — the bearish exhaustion bar |
| 1.5 | `Gap Up, Filled` | notable up gap, `L ≤ PC`, `C ≥ PC` |
| 1.6 | `Gap Up → Closed Red` | notable up gap, `C < PC` — green-to-red with a gap |
| 1.7 | `Gap Down & Go` | notable down gap, `not gap_filled`, `C ≤ O`, `CLV ≤ 0.40` |
| 1.8 | `Gap Down, Reversed` | notable down gap, `not gap_filled`, `C > O`, `CLV ≥ 0.60` — the bullish exhaustion bar |
| 1.9 | `Gap Down, Filled` | notable down gap, `H ≥ PC`, `C ≤ PC` |
| 1.10 | `Gap Down → Closed Green` | notable down gap, `C > PC` — red-to-green with a gap |
| 1.11 | `Gap Up, Stalled` | notable up gap, none of the above (mid-range close, gap intact) |
| 1.12 | `Gap Down, Stalled` | notable down gap, none of the above |

### Tier 2 — Structural failure / reclaim at a known level (highest-value non-Japanese class)

| # | HEAD label | Rule |
|---|---|---|
| 2.1 | `Failed Breakout` | `H > max(H[1..20])` and `C < max(H[2..21])` — Turtle Soup up-side |
| 2.2 | `Undercut & Reclaim` | `L < min(L[1..20])` and `C > min(L[2..21])` and `C > PC` |
| 2.3 | `Upthrust` | `H > max(H[1..20])` and `CLV ≤ 0.30` and `rvol ≥ 1.8` and `r_tr ≥ 1.3` |
| 2.4 | `Spring / Shakeout` | `L < min(L[1..20])` and `CLV ≥ 0.70` and `r_tr ≥ 1.3` |
| 2.5 | `Reclaimed the 50-Day` | `L < MA50 and C > MA50 and PC < MA50` |
| 2.6 | `Lost the 50-Day` | `H > MA50 and C < MA50 and PC > MA50` |

### Tier 3 — Named reversal bars

| # | HEAD label | Rule |
|---|---|---|
| 3.1 | `Key Reversal Up` | `C > PH and O < PC and L < PL` (Bulkowski strict) |
| 3.2 | `Key Reversal Down` | `C < PL and O > PC and H > PH` |
| 3.3 | `Outside Reversal Up` | `H > PH and L < PL and C > PH` |
| 3.4 | `Outside Reversal Down` | `H > PH and L < PL and C < PL` |
| 3.5 | `Outside Day, Unresolved` | `H > PH and L < PL` (closed between the prior extremes) |
| 3.6 | `Reversal Day Up` | `L < min(L[1..10]) and C > PC and CLV ≥ 0.70` |
| 3.7 | `Reversal Day Down` | `H > max(H[1..10]) and C < PC and CLV ≤ 0.30` |
| 3.8 | `Red to Green` | `O < PC and C > PC` (no gap requirement met above) |
| 3.9 | `Green to Red` | `O > PC and C < PC` |

### Tier 4 — Volume/range anomalies (VSA), when nothing structural fired

| # | HEAD label | Rule |
|---|---|---|
| 4.1 | `Selling Climax` | `r_tr ≥ 2.0 and rvol ≥ 3.0 and CLV ≥ 0.50 and C < PC` |
| 4.2 | `Buying Climax` | `r_tr ≥ 2.0 and rvol ≥ 3.0 and CLV ≤ 0.50 and C > PC` |
| 4.3 | `Stopping Volume` | `rvol ≥ 3.0 and r_tr ≥ 1.3 and CLV ≥ 0.50 and C < PC` |
| 4.4 | `Churn (Effort, No Result)` | `rvol ≥ 1.8 and r_tr ≤ 0.8 and 0.30 < CLV < 0.70` |
| 4.5 | `Vacuum Move` | `r_tr ≥ 1.8 and rvol ≤ 0.7` — result without effort |
| 4.6 | `No Demand` | `C > PC and r_hl < 0.8·avg_spread and volume < volume[1] and volume < volume[2]` |
| 4.7 | `No Supply` | `C < PC and r_hl < 0.8·avg_spread and volume < volume[1] and volume < volume[2]` |
| 4.8 | `Test Bar` | `L < L[1] and rvol ≤ 0.7 and r_hl < 0.8·avg_spread and CLV ≥ 0.50 and C ≥ PC` |
| 4.9 | `Pocket Pivot` | `C > PC and volume > max(down-day volume over prior 10 bars)` |

### Tier 5 — Terminal descriptive partition (the true fallback; every remaining bar lands here)

Head = `RANGE_WORD` × `DIRECTION_WORD`, plus the compression specials. Direction is taken from the **close vs prior close** (the trader's definition of up/down day), not from the body colour — but the body colour is surfaced through the close fragment.

| # | HEAD label | Rule |
|---|---|---|
| 5.1 | `Inside Day (NR7)` | `H < PH and L > PL and R == min(R[0..6])` — Crabel double compression |
| 5.2 | `Inside Day` | `H < PH and L > PL` |
| 5.3 | `Compression Bar (NR7)` | `R == min(R[0..6])` |
| 5.4 | `Range Expansion Up` | `r_tr ≥ 3.0 and C > PC` |
| 5.5 | `Range Expansion Down` | `r_tr ≥ 3.0 and C < PC` |
| 5.6 | `Wide Range Up Bar` | `1.8 ≤ r_tr < 3.0 and C > PC` |
| 5.7 | `Wide Range Down Bar` | `1.8 ≤ r_tr < 3.0 and C < PC` |
| 5.8 | `Trend Day Up` | `1.3 ≤ r_tr < 1.8 and CLV ≥ 0.85 and (O − L) ≤ 0.25·R` |
| 5.9 | `Trend Day Down` | `1.3 ≤ r_tr < 1.8 and CLV ≤ 0.15 and (H − O) ≤ 0.25·R` |
| 5.10 | `Up Bar` | `C > PC` (any remaining range band ≥ 0.8) |
| 5.11 | `Down Bar` | `C < PC` (any remaining range band ≥ 0.8) |
| 5.12 | `Quiet Up Bar` | `0.5 ≤ r_tr < 0.8 and C > PC` |
| 5.13 | `Quiet Down Bar` | `0.5 ≤ r_tr < 0.8 and C < PC` |
| 5.14 | `Dead Bar` | `r_tr < 0.5` and `|C − PC| / ATR14 < 0.1` — near-zero range and near-zero net change |
| 5.15 | `Unchanged` | `C == PC` (terminal `TRUE` for the direction split) |

*(5.12/5.13 must be evaluated before 5.10/5.11 in the implementation; the table is grouped for readability, the shipped order is: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.14, 5.12, 5.13, 5.10, 5.11, 5.15.)*

## f.4 Proof sketch: mutual exclusivity and exhaustiveness

**Mutual exclusivity.** The classifier is `for (predicate, label) in CASCADE: if predicate(bar): return label`. Exactly one `return` executes per bar. Any two labels are therefore mutually exclusive **by construction**, regardless of whether their predicates overlap logically. Overlap is not a correctness bug in this design; it is the priority ordering doing its job (e.g. a bar that is both an Upthrust and a Wide Range Down Bar is correctly reported as the Upthrust, the strictly more informative of the two).

**Exhaustiveness.** Let `D` be the feature space of a bar: `(O,H,L,C,V, PC,PH,PL, ATR14, AVGV, history)`. Partition `D` first by the Tier-0 guards:
- `V = 0` or bar missing → 0.1. `R = 0` → 0.2. Everything else has `R > 0`, so `CLV`, `body_pct`, `r_hl`, `r_tr` are all defined.

For the remainder, tiers 1–4 are *optional* refinements — no bar is required to match any of them. Exhaustiveness therefore reduces to showing that **Tier 5 alone is total** over `{R > 0, V > 0}`. Tier 5 partitions on two independent coordinates:

- **Direction** `d = sign(C − PC) ∈ {+1, −1, 0}` — total by trichotomy of the reals. `d = 0` is caught by 5.15 `Unchanged`, which is the terminal predicate.
- **Range band** `r_tr ∈ [0, ∞)` split at `{0.5, 0.8, 1.3, 1.8, 3.0}` into six half-open intervals `[0,0.5) [0.5,0.8) [0.8,1.3) [1.3,1.8) [1.8,3.0) [3.0,∞)` — total and disjoint by construction of half-open intervals over a non-negative real.

Enumerate the 6 × 3 = 18 cells and check each has a label:

| `r_tr` band | `d = +1` | `d = −1` | `d = 0` |
|---|---|---|---|
| `[3.0, ∞)` | 5.4 Range Expansion Up | 5.5 Range Expansion Down | 5.15 Unchanged |
| `[1.8, 3.0)` | 5.6 Wide Range Up Bar | 5.7 Wide Range Down Bar | 5.15 |
| `[1.3, 1.8)` | 5.8 Trend Day Up **or** 5.10 Up Bar | 5.9 Trend Day Down **or** 5.11 Down Bar | 5.15 |
| `[0.8, 1.3)` | 5.10 Up Bar | 5.11 Down Bar | 5.15 |
| `[0.5, 0.8)` | 5.12 Quiet Up Bar | 5.13 Quiet Down Bar | 5.15 |
| `[0, 0.5)` | 5.14 Dead Bar **or** 5.12 | 5.14 **or** 5.13 | 5.15 / 5.14 |

Every cell is non-empty, so Tier 5 is total. Cells with two entries are resolved by the shipped evaluation order given above (Trend Day before Up/Down Bar; Dead Bar before Quiet). Compression specials 5.1–5.3 sit above the partition and only ever *pre-empt* a cell, never leave one uncovered. ∎

**Informativeness.** The concern with a terminal partition is that it degenerates into "a restatement of the numbers". Two properties prevent that here:
1. Every terminal head is a **term of art with independent provenance** — Range Expansion (Crabel), Wide Range Bar (Bulkowski / VSA WRB), Trend Day (Crabel/Raschke), Quiet Bar (VSA NRB), Inside Day and NR7 (Crabel), Compression (Bollinger squeeze lineage). None is invented for this document.
2. The two suffix fragments add the **two facts a trader asks next** — where it closed and on what participation. `Quiet Down Bar, closed strong, on Dried-Up Volume` is a genuine, actionable statement (a no-supply-shaped bar in a consolidation) and no part of it is a number.

**Cardinality**: 2 (guards) + 12 (gap) + 6 (structure) + 9 (reversal) + 9 (VSA) + 15 (terminal) = **53 heads** × up to 7 close fragments × up to 6 volume fragments. Every one of the ~3,700 daily rows resolves to exactly one head.

## f.5 Notability score — for ranking, and for deciding when a head is worth showing

The cascade always produces a label; a companion **notability score** lets the column sort and lets the UI grey out unremarkable bars without ever printing a dash:

```
notability = max(
    |r_tr − 1.0| / 1.0,                       # range surprise
    |log(max(rvol, 0.05))| / log(3.0),        # volume surprise, symmetric for dry-up and spikes
    |open_gap_atr| / 0.5,                     # gap surprise
    |2*CLV − 1|,                              # close-extremity surprise
    2.0 if (new 20-day high or low) else 0.0  # structural surprise
)
```
Tier-1 through Tier-4 heads should be shown regardless of score. Tier-5 heads with `notability < 0.5` may render in a muted style — but they still render.

## f.6 Implementation notes and traps

1. **RVOL denominator must exclude today.** `volume / SMA(volume, 50)` computed *inclusive* of today deflates its own denominator: a genuine 10× day computes as ≈ 5.6×. Use `AVGV = mean(volume[1..50])`.
2. **`rvol` must be NULL, never 0 or 1.0, when it cannot be computed** (zero volume, < 50 bars of history, a non-volume instrument). A `0` that means "unknown" sorts to the extreme of every volume filter and silently contaminates the column.
3. **`r_hl` vs `r_tr`.** ATR14 is an average of **true** range (gap-inclusive). Comparing a bar's `H − L` to it systematically understates gap days — the very days most worth naming. Use `r_tr` for notability/range bands and `r_hl` only for *shape* (body/wick proportions).
4. **VSA compares to `SMA(H−L, 20)`, not ATR.** The 1.8/0.8 multipliers were calibrated on average *spread*. Keep a separate `avg_spread` series for the VSA tier or the No-Demand/No-Supply bars will fire at the wrong rate.
5. **Price-adjustment basis must be identical across the bar and its history.** An unadjusted prior close against a split-adjusted open manufactures a fake 50% gap and a fake 52-week-low break. Every gap and every N-day-extreme test must read from one adjusted series.
6. **Do not name forward-looking gap types on the gap day.** Breakaway / continuation / exhaustion are all defined by subsequent price action (see c.2). Naming them same-day is a fabrication.
7. **No-Demand / No-Supply require the two-bar volume test**, not "below average" — the LuxAlgo/VSA point that below-one-prior-bar "happens constantly and proves nothing". And both require a trend background; without it the label is meaningless ("background first, bar second").
8. **Crabel's ordinal tests need `min(R[0..6])` inclusive of today** (today must *be* the narrowest of the seven). StockCharts writes it as `Range < 1 day ago Min(6, Range)` — strict inequality against the prior six, which resolves ties in favour of *not* firing.
9. **Sub-dollar and illiquid names.** `R/ATR` explodes when ATR14 → 0 (a stock that has not moved in weeks). Floor the denominator: `ATR14_safe = max(ATR14, 0.01 * C, tick_size)`.

---

# (g) SOURCES

1. Bulkowski, "Wide Ranging Day Upside Reversal" (identification guidelines, 3× one-month average range, close within 25% of the high) — https://thepatternsite.com/WRDUR.html
2. Bulkowski, "Wide Ranging Day Downside Reversal" — https://thepatternsite.com/WRDDR.html
3. Bulkowski, "Price Gaps" (gap definition, five gap types, closure percentages and median days-to-close) — https://thepatternsite.com/gaps.html
4. Bulkowski, "Gauging Gaps" (gap size vs exhaustion) — https://thepatternsite.com/GaugingGaps.html
5. Bulkowski, "Key Reversal, Downtrend" (strict three-condition definition, performance stats) — https://thepatternsite.com/KRD.html
6. StockCharts ChartSchool, "Narrow Range Day NR7" (Crabel attribution, NR4/NR7 definitions, scan syntax, contraction→expansion premise) — https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/narrow-range-day-nr7
7. StockCharts ChartSchool, "Relative Volume (RVOL)" (formula, 50-period default, 1.1 / 2.0 / 4.0 thresholds, RVOL-TOD) — https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-volume-rvol
8. StockCharts ChartSchool, "Gaps and Gap Analysis" (common/breakaway/runaway/exhaustion, volume requirements, gap-fill behaviour) — https://chartschool.stockcharts.com/table-of-contents/chart-analysis/gaps-and-gap-analysis
9. StockCharts ChartSchool, "The Wyckoff Method: A Tutorial" (PS, SC, AR, ST, Spring, Test, SOS, LPS, BC, UT, UTAD, SOW, LPSY with spread/volume/close characteristics) — https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial
10. StockCharts ChartSchool, "Bollinger BandWidth" (BandWidth formula, The Squeeze, relative-not-absolute threshold, 8–12 month lookback) — https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/bollinger-bandwidth
11. Volume Spread Analysis reference PDF (the explicit VSA numeric bands: WRB > 1.8× avg spread, NRB < 0.8×, high volume > 1.8×, ultra-high > 3×, low < 0.7×, up/down close = upper/lower 30%; upthrust, pseudo upthrust, no demand, no supply, stopping volume, reverse upthrust, test, effort vs result) — https://silo.tips/download/volume-spread-analysis-vsa
12. LuxAlgo Library, "No-Demand / No-Supply Bars" (executable definitions, the two-prior-bar volume test, "background first, bar second") — https://www.luxalgo.com/library/concept/no-demand-no-supply-bars/
13. Trends and Breakouts, "Volume Spread Analysis" (stopping volume, no demand, no supply, upthrust, climactic action with spread/close/volume conditions and confirmation bars) — https://trendsandbreakouts.com/volume-spread-analysis
14. Take Profit Trader, "Volume Spread Analysis — Tom Williams VSA Guide" (effort vs result axiom, spring/upthrust/no-demand/no-supply/stopping-volume/test definitions, Master the Markets attribution) — https://takeprofitapp.com/en/learn/volume-spread-analysis-vsa
15. TradingView, "Volume Spread Analysis — Educational (VSA Study)" (the VSA event roster: SV, SC, SO, NS, ND, BC, UT, SCI, EoRM, Test; detection inputs) — https://www.tradingview.com/script/26PIlOnx-Volume-Spread-Analysis-Educational-VSA-Study/
16. Trading Setups Review, "10 Price Action Bar Patterns You Must Know" (reversal bar, key reversal bar, exhaustion bar, pin bar, two-bar reversal, three-bar reversal, inside bar, outside bar, NR7 — with rules) — https://www.tradingsetupsreview.com/10-price-action-bar-patterns-must-know/
17. Oxford Strategies, "Turtle Soup Plus One" (Raschke & Connors *Street Smarts* rules: 20-bar extreme, prior extreme ≥ 3 bars earlier, close at/below the old breakout, entry and ATR-based exits) — https://oxfordstrat.com/trading-strategies/turtle-soup-plus-1/
18. TurtleTrader, "Linda Bradford Raschke" (Street Smarts provenance; the 6-day vs 100-day historical-volatility contraction filter) — https://www.turtletrader.com/trader-raschke/
19. TradingSim, "VDU and Pocket Pivots" (VDU < 50% of average volume; pocket pivot = up day whose volume exceeds any down-day volume in the prior 10 bars; Kacher & Morales attribution) — https://www.tradingsim.com/blog/vdu-and-pocket-pivots
20. TradingSim, "Relative Volume (RVOL): Trading Indicator Guide" (RVOL banding 1.5–2.0 / 2.0–3.0 / 3.0+) — https://www.tradingsim.com/blog/relative-volume-rvol
21. TradingView, "Closing Range" indicator (closing range 0–100%, 50% default bullish threshold, 40% looser "still a sign of strength") — https://www.tradingview.com/script/3DFjWWkF-Closing-Range/
22. InvestingAnswers, "Key Reversal" (the loose industry definition: new extreme then close near the prior day's opposite extreme; range and volume amplify reliability) — https://investinganswers.com/dictionary/k/key-reversal
23. FT.WTF, "Undercut and Rally Setup Explained in Swing Trading" (undercut of a 20-day low / 50-SMA / 65-EMA, the shakeout mechanic, reclaim speed, stop placement) — https://www.ft.wtf/p/undercut-and-rally-setup-explained
24. Bullish Bears, "Red to Green Move Stocks" (R2G / G2R definitions relative to the prior close, the squeeze/trap mechanic, volume confirmation) — https://bullishbears.com/red-to-green-move-stocks/
25. 2ndSkies Trading, "Climax, Exhaustion and Reversal Bars" (size-based exhaustion-bar definition: largest bar of the move, at a key level, after impulsive bars) — https://2ndskiestrading.com/price-action-forex-trading-climax-exhaustion-reversal-bars/
26. Fidelity Learning Center, "Average True Range (ATR)" (TR definition, 14-day default, ATR as a percentage of share price, directionless/strength-of-move framing) — https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr
27. The Trading Pub / Roger Scott, "The 150% ATR Rule" (overextension = 150% of ATR(10) from the 8-EMA) — https://thetradingpub.com/roger-scott/my-exact-method-to-determine-if-stocks-are-overextended-the-150-atr-rule/
28. Finer Market Points, "Mark Minervini's Stock Screener: Trend Template Criteria" (within 25% of the 52-week high, ≥ 30% above the 52-week low, MA stack, RS > 70) — https://www.finermarketpoints.com/post/mark-minervini-s-stock-screener-what-indicators-and-criteria-does-he-use
29. TradingStats, "Gap Fill Strategy: 2,791 Days of NQ Data (2015–2025)" (68–72% same-session fill, gap-down 62.2% vs gap-up 58.8%, fill rate falls sharply with gap size) — https://tradingstats.net/gap-fill-strategy/
30. Trade That Swing, "S&P 500 (SPY) Gap Fill Strategy and Statistics" (SPY 59% up-gap / 69% down-gap fill; fill rates by gap-size bucket) — https://tradethatswing.com/sp-500-spy-es-gap-fill-strategy-and-statistics/
