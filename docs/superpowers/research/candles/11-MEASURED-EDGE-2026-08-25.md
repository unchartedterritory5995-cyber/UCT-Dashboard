# What our candle labels are actually worth — measured on our own tape

**Run 2026-08-25, revised the same day after an adversarial audit.**
`api/services/screener/candle_backtest.py` + `tools/candle_backtest_run.py`.

```
# entry defaults to `open` — the trustworthy convention
python tools/candle_backtest_run.py --workers 18 --min-dates 50
python tools/candle_backtest_run.py --workers 18 --min-dates 50 --since 20150101
# `--entry close` is KNOWN CONTAMINATED and prints a warning; it exists only to
# reproduce the bid-ask artifact deliberately, because the comparison IS the finding.
python tools/candle_backtest_run.py --workers 18 --min-dates 50 --entry close
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

### Out-of-sample, under the corrected convention

Of the 32 open-entry survivors, re-measured on 2015-2026 only:
**17 hold direction and significance · 14 keep sign but lose significance · 1 flips.**

The 10 that hold most strongly — these are the trustworthy set:

| label | 1976-2026 | 2015-2026 |
|---|---|---|
| `char:gap-down-filled` | +0.315% (t 12.0) | +0.287% (t 6.0) |
| `char:no-supply` | −0.176% (t −9.7) | −0.100% (t −3.3) |
| `char:flat-bar` | +0.171% (t 8.6) | +0.190% (t 5.3) |
| `white-marubozu` | +0.165% (t 8.7) | +0.127% (t 3.9) |
| `bullish-belt-hold` | +0.254% (t 7.6) | +0.224% (t 4.2) |
| `gravestone-doji` | +0.242% (t 6.5) | +0.261% (t 3.1) |
| `char:no-trade` | −0.381% (t −6.3) | −0.693% (t −6.9) |
| `bearish-engulfing` | −0.151% (t −6.2) | −0.094% (t −2.2) |
| `hikkake-bear-confirmed` | −0.118% (t −5.6) | −0.074% (t −2.4) |
| `marubozu` | +0.055% (t 5.1) | +0.039% (t 2.0) |

⚠️ `white-marubozu` is one of the four labels that FLIPPED when the entry moved,
so its sign here is opposite to the close-entry table above. That is the point:
the open-entry number is the one to trust.

⚠️ `char:no-trade` is a data-quality label, not a tradeable one — a session that
never traded, followed by underperformance. Real, but not a setup.

### Price floor, under the corrected entry

Excluding sub-$5 bars: of the 32 survivors, **16 hold direction and Bonferroni
significance, 16 keep their sign, and ZERO flip.** So the surviving effects are
not carried by penny stocks — but they do SHRINK, in several cases by half
(`char:gap-down-filled` +0.315 → +0.108, `gravestone-doji` +0.242 → +0.072).
The ones that barely move are the ones to trust most: `char:no-supply` −0.176 →
−0.143, `bullish-belt-hold` +0.254 → +0.198, `bearish-belt-hold` −0.185 → −0.143.

⭐ Zero sign flips across the price floor is the cleanest robustness result in
this file — and worth contrasting with the entry-convention test, where four
labels flipped. That is what a genuine-but-small effect looks like versus an
artifact.

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
