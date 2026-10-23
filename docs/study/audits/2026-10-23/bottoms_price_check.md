# Bottoms price check: the 17 regime.bottoms holds (2026-10-23)

Audit B (`docs/study/audits/2026-10-21/auditB_summary.md` §4) held 17 signpost items until
their date and note were checked on real bars. This is that check. The records it produced are
`bottoms_batch2.py` (tag `bottoms-batch2 2026-10-23`, appended to
`docs/study/corrections/regime.bottoms.jsonl`).

## Method

1. **Yahoo:** daily bars from yfinance 1.2.0 (`history(interval="1d", auto_adjust=False)`):
   SPY with ^GSPC as a cross-check, QQQ and ^IXIC for 2002, ^VIX, and CL=F. A helper session
   measured each asof bar and the 5 sessions either side. Raw CSVs and per-item tables stayed in
   that session's scratchpad (`bottoms_check/`).
2. **The shipped chart:** every number in a kept note was then re-read on the chart the item
   actually ships, the pod's `study_bars` snapshot (read-only; scratchpad `pod_bottoms_bars*.py`).
   The notes quote those numbers, not Yahoo's.
3. **Definitions (Audit B):**
   - Capitulation: a big down day, on volume well above normal, after a run of red days.
   - News Failure: undercuts the prior low, then reverses and closes green.
   - Follow-Through Day: a few sessions after the low, a hard rally on heavier volume than the
     day before.
4. **Not measured:**
   - Any news clause: CPI, the US downgrade, jobs and Powell, circuit-breaker halts.
   - Breadth and exchange volume.

   So no news clause and no "record volume" claim survives in a kept note.

## Results on the shipped chart (all SPY, 120 bars ending at asof)

| id | bottom | signpost | asof | cc% | v/prev | v/avg20 | other | verdict |
|---|---|---|---|---|---|---|---|---|
| si_c2c8c906e852 | 2022 Rate Bear | News Failure | 2022-10-13 | +2.64 | 1.91 | 1.51 | opened 349.21 below the 10-11 low 355.71; low 348.11 to close 365.97 = +5.1% | KEEP |
| si_8824aded5eb6 | 2022 Rate Bear | FTD | 2022-11-10 | +5.50 | 1.80 | 1.46 | session 20 after the low; 2022-10-21 already qualified (Yahoo: SPY +2.43% on 1.48x) | CUT |
| si_553b9a890157 | COVID Crash | Capitulation | 2020-03-12 | -9.57 | 1.53 | 2.13 | close position 0.02; heaviest volume of the chart | KEEP |
| si_94495d8da54e | COVID Crash | FTD | 2020-03-26 | +5.84 | 0.86 | 0.90 | lighter volume than the day before | CUT |
| si_e1c2559e50cb | Christmas Eve Low | Capitulation | 2018-12-21 | -2.62 | 1.01 | 1.98 | lowest close of the chart; 7th straight down close | KEEP |
| si_a37391a802da | Christmas Eve Low | FTD | 2019-01-04 | +3.35 | 0.99 | 0.87 | lighter volume (^GSPC 1.10x, but the chart is SPY) | CUT |
| si_9d2e9f0dbbbf | 2016 Double Bottom | Capitulation | 2016-01-20 | -1.28 | 1.47 | 1.79 | closed above its open (+0.34%) after an up day | CUT |
| si_85520092d6ac | 2016 Double Bottom | News Failure | 2016-02-11 | -1.30 | 1.48 | 1.15 | closed red; low 181.09 above the January low 181.02 | CUT |
| si_e8febf0f81b0 | 2016 Double Bottom | FTD | 2016-02-17 | +1.63 | 1.13 | 0.78 | 3 sessions after the 02-11 closing low 182.86 | KEEP |
| si_f57df1bb386c | 2011 Crisis Low | Capitulation | 2011-08-08 | -6.51 | 1.07 | 2.71 | close position 0.03; heaviest volume of the chart | KEEP |
| si_7f5d712143b3 | 2011 Crisis Low | News Failure | 2011-10-04 | +2.19 | 1.26 | 1.52 | low 107.43 under the August low (Yahoo 110.27) and the 10-03 low 109.81; +4.6% off the low | KEEP |
| si_28c4e2396923 | 2011 Crisis Low | FTD | 2011-10-10 | +3.34 | 0.74 | 0.74 | lighter volume | CUT |
| si_07141dea361c | Generational Low | Capitulation | 2008-11-20 | -7.42 | 1.46 | 1.74 | flush checks out, but the chart carries bad bars (below) | CUT (bad bars) |
| si_2f527b374a59 | Generational Low | FTD | 2009-03-12 | +3.95 | 1.15 | 0.99 | FTD checks out, but the chart carries bad bars (below) | CUT (bad bars) |
| si_3b80b6bc1543 | Dot-Com Bottom | Capitulation | 2002-07-23 | -2.74 | 0.95 | 1.78 | lowest close of the chart; 4th straight down close | KEEP |
| si_24d4b19957f4 | Dot-Com Bottom | News Failure | 2002-10-09 | -2.82 | 1.01 | 1.47 | no undercut, no reversal; the undercut came 10-10 (low 77.07) | CUT |
| si_2c5cf5fe2b7e | Dot-Com Bottom | FTD | 2002-10-15 | +4.81 | 2.03 | 1.34 | 3 sessions after the 10-10 low 77.07 | KEEP |

**Totals:** 8 kept, 9 cut.

## Two more findings

- **"Record volume" claims:**
  - 2020-03-12 ranks 108th in SPY's history to that date.
  - 2018-12-21 ranks 20th among SPY December sessions.
  - 2008-11-20 is below the 2008-10-10 bar on its own chart.
  - So all three were removed.
- **Volatility Peak note for 2011-08-08:** it said "VIX spiked above 48". On Yahoo the high and
  the close were both exactly 48.00. That note sits in the item's signpost timeline, which
  learners never see; it is recorded here for when the catalog is reworked.

## Bad bars in the firm's SPY history (not a Study bug; report to the bars owner)

| date | stored O/H/L/C | Yahoo O/H/L/C |
|---|---|---|
| 2008-09-29 | 119.18 / 121.18 / **11.85** / 111.38 | 119.14 / 119.34 / 110.97 / 111.38 |
| 2008-11-07 | 91.65 / 94.00 / **53.15** / 93.86 | 91.65 / 94.00 / 90.50 / 93.86 |

**Where they appear:**
- Study's snapshots carry them for si_07141dea361c, si_2f527b374a59 and the rejected
  si_93fd1ef89b1b / si_ce815e25338a.
- No approved item shows them: a scan of every study_bars snapshot for wicks below 0.75x or
  above 1.33x the body found these two, plus two real prints (LCID 2026-07-14 low 2.37 on
  155.8M shares, and XRPN 2026-10-02 high 53.00), both confirmed on Yahoo.
- The snapshots were cut from the pod's bars store, so the firm's own SPY daily chart for 2008
  likely shows the same two wicks.
