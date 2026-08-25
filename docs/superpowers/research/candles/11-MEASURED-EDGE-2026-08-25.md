# What our candle labels are actually worth — measured on our own tape

**Run 2026-08-25, revised the same day after an adversarial audit.**
`api/services/screener/candle_backtest.py` + `tools/candle_backtest_run.py`.

```
python tools/candle_backtest_run.py --workers 18 --min-dates 50 --entry open   # ← the trustworthy one
python tools/candle_backtest_run.py --workers 18 --min-dates 50                # close entry, contaminated
python tools/candle_backtest_run.py --workers 18 --min-dates 50 --since 20150101
python tools/candle_backtest_run.py --workers 18 --min-dates 50 --min-price 5
```

| | |
|---|---|
| observations | **18,848,061** labelled bar-observations |
| cells | 82,048 (date × same-day-move) |
| tickers | 4,277, including delisted — no survivorship filter |
| span | 1976-12-17 → 2026-08-21 |
| labels tested | 121 |

---

## ⚠️ READ THIS FIRST — the first version of this document was substantially wrong

The initial run reported a clean, striking finding: **every long-lower-wick shape
bearish, every long-upper-wick shape bullish, 8 of 8, all Bonferroni-significant,
holding out-of-sample and above $5.** It survived four controls.

**It was largely a microstructure artifact**, and the audit that found it is the
most valuable thing in this file.

### The bid-ask bounce
Forward returns were measured from the labelled bar's **own close** — which puts
that close in *both* the label and the return denominator. A long-**lower**-wick
bar closes near its **high**, more often at the **ask**; a long-**upper**-wick bar
closes near its **low**, at the **bid**. Bid-ask bounce alone produces exactly the
reported pattern.

Re-measuring from the **next open** — a different print, and the only entry a
member could actually take:

| shape | close entry | | next-open entry | | verdict |
|---|---:|---:|---:|---:|---|
| | exc5d | t | exc5d | t | |
| gravestone-doji | +0.931 | 24.5 | **+0.242** | 6.5 | survives |
| inverted-hammer | +0.541 | 18.3 | **+0.138** | 4.8 | survives |
| inverted-umbrella | +0.388 | 14.2 | +0.046 | 1.7 | **gone** |
| shooting-star | +0.220 | 7.2 | −0.061 | −2.0 | **FLIPS** |
| hammer | −0.198 | −6.9 | +0.109 | 3.8 | **FLIPS** |
| hanging-man | −0.386 | −14.6 | **−0.094** | −3.6 | survives |
| umbrella | −0.463 | −18.2 | −0.064 | −2.5 | **gone** |
| dragonfly-doji | −0.666 | −18.3 | +0.165 | 4.5 | **FLIPS** |

**3 of 8 survive. 3 flip sign. 2 vanish.** The coherent "the wick determines
direction" story does not survive, and what remains does not form a pattern.

Across all 59 close-entry survivors, the **median effect retained at open entry is
32%** — roughly **two thirds of the measured excess sat in the close-to-next-open
window**, which is exactly where microstructure noise lives.

### The other hole: a contaminated control
The ATR used to bucket a bar's same-day move **included that bar's own true
range**, so a long-wick bar inflated its own denominator and was compared against
milder movers. Proven with a probe: an identical close lands in bucket 4 or 6
depending only on the bar's range. **Fixed (ATR now lagged) — and it changed
nothing**: 8 of 8 held, nothing flipped. A real bug with negligible impact, worth
recording because the opposite was equally possible.

---

## The trustworthy result (next-open entry)

| | count |
|---|---:|
| Bonferroni survivors (\|t\| > 3.53), **close entry** | 59 *(not trustworthy)* |
| Bonferroni survivors, **next-open entry** | **32** |
| in both | 26 — of which **22 agree on direction, 4 flip** |
| largest surviving effect | **0.79% over 5 sessions, gross** |

Strongest survivors: `char:gap-down-filled` +0.315 (t=12.0) · `char:no-supply`
−0.176 (t=−9.7) · `bullish-belt-hold` +0.254 (t=7.6) · `gravestone-doji` +0.242
(t=6.5) · `bearish-belt-hold` −0.185 (t=−6.3) · `bearish-engulfing` −0.151
(t=−6.2) · `bullish-harami` +0.187 (t=6.0).

**This is the picture the literature predicts.** Duvinage/Mazza/Petitjean: 5 of 83
rules survive costs. Marshall/Young/Rose: none on the Dow. A handful of tiny,
sub-0.3% gross effects is what an honest measurement of candlestick labels looks
like — and it is why the CANDLE column ships **descriptive, with no score**.

---

## Data integrity — checked, not assumed

Over 1.24M consecutive-bar pairs: 2:1 split signature **0.23 per 10k** (~150×
below what unadjusted prices would show, so bars.db **is** split-adjusted) · **zero**
self-contradicting bars · extreme moves 0.08 per 10k, already winsorized.

## The four controls

1. **Date-matched base rate** — excess over what the same sessions did anyway.
2. **Same-day-move matching in ATR units** — without it the whole thing was
   short-term mean reversion. ATR is **lagged**.
3. **Date clustering** — significance from `n_dates`, never `n_instances`.
4. **Winsorization ±50%** — `gravestone-doji` first read +6.0% at t=1.48; a huge
   mean beside a tiny t is an outlier report. Clipped: +0.93% at t=24.5.

Plus, now, **entry at the next open** as the microstructure control — the one that
overturned the headline.

---

## Reusable lessons

1. **Compute what the number would be by accident.** Three times in this project a
   result was an artifact wearing a costume: the T+1 base rate, the mean-reversion
   inversion, and now the bid-ask bounce.
2. **If a measurement uses a price in both the label and the return, it is not a
   measurement.** The tell is an effect that lives entirely in the first session.
3. **A huge mean beside a small t-statistic is an outlier report.**
4. **The more beautiful the finding, the harder to audit it.** "8 of 8, perfectly
   consistent, opposite the textbook" was exactly the shape that should have
   invited more suspicion, not less.
