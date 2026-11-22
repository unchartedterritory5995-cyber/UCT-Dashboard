# E0: where TradingView places earnings, dividends and splits (track 4, 2026-11-22)

Track 4 (the data indicators need), unit E0, on the coordinator's rulings of 2026-11-22. This files the S4-2
placement captures and the built-in VWAP anchor captures as witness evidence. It commits **derived dates and
placements only**. Every plotted value (EPS figures, dividend amounts, prices) is TradingView's data and stays in
the local capture store. The one number a row carries is a split's ratio, which is the corporate action itself.

- Derived by: `tools/vendor_harness/event_witness.py derive`
- Re-proved without any capture by: `event_witness.py check` and `tests/test_t4_event_witness.py`
- The derived document: [`placements.json`](placements.json)

## The captures

| run | captures | what | licence |
|---|---:|---|---|
| `s4-closed-retake-2026-11-20` (local) | 25 | 20 placement probes (`vw-data-earnings` / `-dividends` / `-splits`), 3 of our anchor probe (`vw-data-vwap-anchors`), 2 `vw-data-earnings-future`. Taken 2026-11-20 about 22:00Z, after the close, no bar forming; verify PASS on every one | probe (ours) |
| `s4-vwap-anchors-retake3-2026-11-21` (local) | 7 | TradingView's built-in VWAP with Anchor Period = Earnings / Dividends / Splits, on NASDAQ:AAPL 1D, NYSE:JPM 1D, and AAPL 60 (Earnings) | held: only derived dates leave the PC |

Symbols in the placement probes:
- 1D: AAPL, JPM, NVDA, MU, O, SPY, TSLA, GE;
- 1W: AAPL, JPM, NVDA;
- 60: AAPL, JPM. The 60-minute chart is extended hours, from 2021-01-04.

Each capture's sha256 is in `placements.json`.

## The placement rules, each re-proved by count

A *read* is one probe row: `gaps_on` or `gaps_off`, with `lookahead_on` or `lookahead_off`.

| rule | what TradingView does | held |
|---|---|---|
| R1, D and W | `lookahead_on` places an event on the bar of its date. `lookahead_off` places it on the **next** chart bar: the next session on 1D, the next week on 1W | 1,603 of 1,606 events |
| R1, the named exception | an event dated on a non-session day lands **both** reads on the first session after it. The bar before is more than one calendar day earlier: three old dividends, JPM 1984-12-03 and 1985-06-10, O 1996-12-23, each a Monday | 3 of 3 |
| R1, two records | JPM 1984-09-10: one on-read, and off-reads on that Monday and on the Tuesday. The vendor holds two records, one dated on the weekend and one on the Monday. Both on-reads land on Monday | 1, named |
| R2 | a `gaps_off` read is the `gaps_on` read of the same lookahead, carried forward. It is `na` before the first event (AAPL earnings first appear 2001-07-17 on a chart from 1980) | 0 mismatching bars, every carried row of every capture |
| R3, intraday (60) | both lookaheads land on the bar holding the event (JPM's report on its 06:00 ET bar, AAPL's on 16:00 to 17:00 ET). The chart's first bar carries the latest event before it, under `gaps_on` | 50 of 50; first-bar carry on both 60m captures and in the anchor probe for all three families |
| V0 | our anchor probe flags exactly the placement probe's event bars, per family | AAPL 1D, JPM 1D, AAPL 60 |
| V1 | the built-in VWAP restarts exactly on the event bars. For earnings that is the union of `earnings.actual` and `earnings.standardized`, which the built-in reads together | 570 of 570 events, 0 restarts off an event (2 bars where an unchanged VWAP equals hlc3 are recorded, not counted as restarts) |

The model that fits every row on D and W: an event is stamped at its date's session close. `lookahead_on` reads it
on the first bar closing at or after that instant; `lookahead_off` on the first bar opening after it.

## What the fields carry (counts and dates only)

- **`earnings.actual`**: 102 reports from 2001 on AAPL, JPM and NVDA; 108 on MU.
  - It is split-adjusted to today's share basis and is TradingView's "as reported" figure.
  - On the ETF (SPY) it is `na` on every bar.
- **`earnings.estimate`**: 99 or 100 reports per stock.
- **`earnings.standardized`**: a different series with more reports (AAPL 132, from 1994), 8 to 30 of them on bars
  where `actual` is `na`. The built-in VWAP's Earnings anchor reads it, so its anchors are the union.
- **`dividends.gross`**: present on every dividend (SPY's 136 distributions included). It is **as declared**,
  never split-adjusted: gross never equals net on any bar where both exist.
- **`dividends.net`**: split-adjusted, and present only up to the symbol's latest split:
  - AAPL to 2020-08-07, before the 2020-08-31 split;
  - NVDA to 2024-03-05, before 2024-06-10.
  E1 refuses it by name.
- **`splits`**: numerator = new shares, denominator = old. Forward: NVDA 2024-06-10 10:1, 2007-09-11 3:2. Reverse:
  GE 2021-08-02 1:8.
- **`earnings.future_*`**: all four compile under v6 and are non-`na` on every bar of both charts. E1 refuses them
  by name: the next report's time and values are not held.

## What E1 and E2 build on this

- **E2's event alignment** is R1 and R2 on D and W charts, from the chart's own event list. Intraday (R3) comes
  later, dividends and splits first. Earnings stay refused intraday until a report's time of day is held.
- **Monthly charts** are not witnessed yet (W-E2, queued with the rig).
- **The built-in VWAP's anchor rows** grade once the grader grades at the captured inputs (its own PR).
