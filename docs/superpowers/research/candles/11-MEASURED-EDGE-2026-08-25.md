# What our candle labels are actually worth — measured on our own tape

**Run 2026-08-25.** `api/services/screener/candle_backtest.py` +
`tools/candle_backtest_run.py`. Reproduce with:

```
python tools/candle_backtest_run.py --workers 18 --min-dates 50 --out result.json
python tools/candle_backtest_run.py --workers 18 --min-dates 50 --since 20150101   # era check
python tools/candle_backtest_run.py --workers 18 --min-dates 50 --min-price 5      # price check
```

| | |
|---|---|
| observations | **18,852,257** labelled bar-observations |
| cells | 81,935 (date × same-day-move) |
| tickers | 4,277, including delisted — no survivorship filter |
| span | 1976-12-17 → 2026-08-21 (~50 years, many regimes) |
| labels tested | 121 (66 candle structures + 55 bar characters) |
| runtime | 942s on 18 cores |

---

## The four controls, and why each exists

**This is where the truth is.** A backtest that reports a raw hit rate is worse
than no backtest — it hands a member a number that *looks* like evidence. Three
of these four were added because the measurement lied without them.

### 1. Date-matched base rate
Every figure is an **excess** over what the same sessions did anyway. Straight
from the T+1 lesson: bullish patterns "confirmed" 59.9% of the time, which
looked like edge until the universe's own opening-gap rate on those same days
turned out to be 59%.

### 2. Same-day-move matching, in ATR units
🔴 **Without it the first full run was pure mean reversion.** Every bearish
label measured positive and every bullish label negative — a clean inversion
across the board. `black-marubozu` +0.53%, `white-marubozu` −0.38%. That is not
a candle effect: a black marubozu means the stock *fell hard today*, and stocks
that fall hard bounce. Date-matching controls for what the MARKET did and does
nothing about what the STOCK did. Bars are now compared against bars that moved
the same amount, on the same day, in ATR units.

### 3. Date clustering
4,000 hammers on one morning are **one market doing one thing**. The per-date
mean excess is computed first; the score and its standard error come from the
spread *across dates*. `n_dates` is the honest sample size. A test pins that a
thousandfold increase in instances does not move the t-statistic.

### 4. Winsorization at ±50%
🔴 **The tell:** `gravestone-doji` first reported **+6.0% excess with t = 1.48**.
A huge mean beside a negligible t is a handful of sub-dollar names that went up
2,000% in a week. Clipped, it is **+0.93% at t = 24.5** — the outliers were not
the signal, they were *drowning* it. `tweezer-bottom` went from +13.2% to +0.13%.
The universe base rate is clipped by the same rule in the same pass.

---

## Results

Bonferroni over 121 tests → significance at **|t| > 3.53**.

| | count |
|---|---:|
| naive \|t\| > 1.96 | 38 *(≈6 expected by chance)* |
| **Bonferroni survivors** | **60** |
| …that hold direction + significance in 2015-2026 | **42** |
| …that keep sign but lose significance out-of-sample | 17 |
| …that **flip** (flagged, do not use) | **1** — `char:gap-down-closed-green` |
| Bonferroni survivors above $5 | 50 (45 in both sets, **45 of 45 agree on direction**) |

---

## The finding: it is the wick, and it runs opposite to the textbook

Every long-**lower**-wick shape measures **bearish**. Every long-**upper**-wick
shape measures **bullish**. Eight of eight, all Bonferroni-significant.

| shape | textbook | excess 5d | t | 2015+ | ≥$5 |
|---|---|---:|---:|:--:|:--:|
| gravestone-doji | bearish | **+0.931%** | +24.5 | ✅ | ✅ |
| inverted-hammer | bullish | +0.509% | +17.4 | ✅ | ✅ |
| inverted-umbrella | neutral | +0.386% | +14.1 | ✅ | ✅ |
| shooting-star | bearish | +0.206% | +6.8 | ✅ | ✅ |
| hammer | bullish | −0.183% | −6.3 | ✅ | ✅ |
| hanging-man | bearish | −0.376% | −14.4 | ✅ | ✅ |
| umbrella | neutral | −0.449% | −17.5 | ✅ | ✅ |
| dragonfly-doji | bullish | **−0.648%** | −17.8 | ✅ | ✅ |

**8 of 8 hold in 2015-2026. 8 of 8 hold above $5.** Six of the eight run
*opposite* to the classical reading.

Plainly: **conditional on the same daily move, the bar that touched a higher
high did better afterwards, and the bar that touched a lower low did worse.**
The marubozu pair shows the same inversion (`black-marubozu` +0.385% t=19.6,
`white-marubozu` −0.364% t=−19.2).

---

## What this does NOT say

- ⚠️ **Association, not mechanism.** A plausible reading is that the intraday
  extreme carries momentum information the close does not; another is residual
  mean-reversion the move-bucket did not fully absorb. This measurement cannot
  separate them.
- ⚠️ **Not a strategy.** No costs, no slippage, no sizing, no stops, entry at the
  labelled close. Effects are **0.2–0.9% over five sessions, gross**. The
  literature is consistent that most such edges do not survive costs —
  Duvinage/Mazza/Petitjean: 5 of 83 rules; Marshall/Young/Rose: none on the Dow.
- ⚠️ **Not permission to score the column.** Per the standing owner rule the
  CANDLE column stays descriptive with no strength number. This tells *us* which
  labels deserve emphasis; it does not put a forecast in front of a member.
- ⚠️ **One label flips out-of-sample** (`char:gap-down-closed-green`) and 17 more
  weaken. Treat the 42 that hold as the trustworthy set.

---

## Reusable lessons

1. **Compute what the number would be by accident, before believing it.** Twice
   in this project a result was the base rate wearing a costume.
2. **A huge mean beside a small t-statistic is an outlier report, not a finding.**
3. **Controls need controls.** Every "should be zero" test here is paired with
   one proving the measurement can still detect a real effect.
4. **Cross-sectional data is not independent.** One tape is one observation.
