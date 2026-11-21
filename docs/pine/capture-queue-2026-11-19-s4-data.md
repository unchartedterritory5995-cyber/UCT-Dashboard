# Capture queue: Pine data unit S4, where TradingView places earnings, dividends and splits (2026-11-19)

Coordinator rulings 2026-11-19 (Pine data unit S4, unit S4-2). Same procedure as
`docs/pine/capture-queue-2026-09-28.md`: capture from the listing, keep the plotted values as full float64 text,
and record each capture's own `capturedAtUTC`. Every probe below is ours (licence `probe`), titled `UCTPROBE_`.

**Why.** The data unit serves `request.earnings`, `request.dividends` and `request.splits` from UCT's own data
(the families and the licence rows they rest on are `app/src/components/chart/engine/pineDataCatalog.json`, S4-0).
The repo holds no reference sentence for these three calls, so WHICH BAR each event lands on, for each `gaps` /
`lookahead` pairing and on each timeframe, is licensed only by these captures. Nothing about the placement is
assumed. Values:
- dividends and splits are facts (a cash amount, a ratio), so our side should equal TradingView's, and the rows
  pin the basis (a dividend as declared or divided by the splits after it) and which side is the numerator;
- earnings figures come from another provider than TradingView's, so their values are substituted: the grade
  feeds the capture's own values to our side, grades the placement exactly, and the member is told the figures
  are UCT earnings data.

**When.** Before the open, on a fresh load (`preopen`): every bar settled, none forming, so the placement on the
newest bar is not a question of whether TradingView runs it as a realtime bar. Any weekday.

## The rows

| id | probe | chart | question | live | phase |
|---|---|---|---|---|---|
| Q-S4-E1 | `vw-data-earnings.pine` | NASDAQ:AAPL 1D, NYSE:JPM 1D | on which daily bar each report lands for E01-E04 (an after-the-close reporter beside a before-the-open one: the report day's bar, or the next?), and what E05 / E06 carry | no | preopen |
| Q-S4-E2 | `vw-data-earnings.pine` | NASDAQ:NVDA 1D, NASDAQ:MU 1D | the same on a January and an August fiscal year; is NVDA's EPS before 2024-06-10 on today's share basis? | no | preopen |
| Q-S4-E3 | `vw-data-earnings.pine` | AMEX:SPY 1D | the control: an ETF has no reports; does the series read `na` on every bar? | no | preopen |
| Q-S4-E4 | `vw-data-earnings.pine` | NASDAQ:AAPL 1W, NYSE:JPM 1W | on a weekly chart, which week a report lands in (the week containing the report day?) | no | preopen |
| Q-S4-E5 | `vw-data-earnings.pine` | NASDAQ:AAPL 60, NYSE:JPM 60 | on an hourly chart, which bar an after-the-close and a before-the-open report land on | no | preopen |
| Q-S4-E6 | `vw-data-earnings-future.pine` | NASDAQ:AAPL 1D, NYSE:JPM 1D | what `earnings.future_*` hold (does the probe compile under v6 at all?) | no | preopen |
| Q-S4-D1 | `vw-data-dividends.pine` | NASDAQ:AAPL 1D, NYSE:JPM 1D, AMEX:SPY 1D, NASDAQ:NVDA 1D, NYSE:O 1D | on which bar each dividend lands (the ex-date's?) for D01-D04; whether AAPL's and NVDA's amounts before their splits are as declared or divided by the splits after them; whether D05 / D06 (net) equal gross on every US row; a monthly payer (O) beside quarterly ones and an ETF's distributions | no | preopen |
| Q-S4-D2 | `vw-data-dividends.pine` | NASDAQ:AAPL 1W | on a weekly chart, which week a dividend lands in | no | preopen |
| Q-S4-S1 | `vw-data-splits.pine` | NASDAQ:NVDA 1D, NASDAQ:AAPL 1D, NASDAQ:TSLA 1D, NYSE:GE 1D | on which bar each split lands (the execution date's?) for S01-S06, and which side is the numerator for a forward split (NVDA 10-for-1, AAPL 4-for-1, TSLA 3-for-1) and a reverse one (GE 1-for-8, 2021-08-02) | no | preopen |
| Q-S4-S2 | `vw-data-splits.pine` | NASDAQ:NVDA 1W | on a weekly chart, which week a split lands in | no | preopen |
| Q-S4-V1 | `vw-data-vwap-anchors.pine` | NASDAQ:AAPL 1D, NYSE:JPM 1D, NASDAQ:AAPL 60 | a VWAP anchored on each event family (V01-V03) and the anchor bars (V04-V06): the values a member's script draws from the placement | no | preopen |

**What each answer moves.**
- Q-S4-E1..E5, Q-S4-D1..D2 and Q-S4-S1..S2 are the placement witnesses the data unit's event projection is built
  on (`requestWitnesses.json` rows of kind `event`, S4-3). A row with no witness is refused by name, never guessed.
- Q-S4-E6 measures what the refusal of `earnings.future_*` refuses.
- Q-S4-V1 grades a member-shaped script end to end once S4-3 and S4-4 land.

## By hand: the built-in VWAP and Black-Scholes at moved settings

The queue holds no shape for a moved setting, so these are taken by hand and graded at the settings they were
taken at (`vendorHarness/captureInputs.js`). Each is a script the S4-1 unit reads at its default without any
data; these show what it draws when a member moves the setting to a data anchor.
- TradingView's built-in VWAP (`data-id` `STD;VWAP`, dialog search "VWAP", listed as "Volume-weighted average
  price"), `Anchor Period` = Earnings, then Dividends, then Splits, each on NASDAQ:AAPL 1D and NYSE:JPM 1D (six
  captures), and Earnings on NASDAQ:AAPL 60. ⚰️ Not the search "Volume Weighted Average Price": it lists only
  community scripts, and the 2026-11-20 rows that used it stopped by name. The row names the id only; the batch
  reads the search from `BUILTIN_SEARCH` (`tools/vendor_harness/batch_capture.py`).
- `black-scholes-option-pricing-model-w-greeks-loxx__12d143e9b2` with `Adjust for Dividends?` on and
  `Automatically Calculate Yearly Dividend Yield?` on (its default), on NASDAQ:AAPL 1D and NYSE:JPM 1D. Its own
  wall today is its library import (`pine:library-denied`), so this grades only once that library is served.
