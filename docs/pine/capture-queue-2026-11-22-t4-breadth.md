# Capture queue: track 4 breadth, TradingView's `USI:` spellings (2026-11-22)

Coordinator rulings 2026-11-22 (track 4, the data indicators need: breadth unit B0). Same procedure as
`docs/pine/capture-queue-2026-11-19-s4-data.md`: capture from the listing, keep the plotted values as full float64
text, record each capture's own `capturedAtUTC`. The probe is ours (licence `probe`), titled `UCTPROBE_`.

**Why.** Track 4 serves the `USI:` breadth spellings a member's script reads from UCT's own breadth data. Our counts
are over operating equity (common stock and ADRs); the exchanges' official counts also hold preferreds, funds and
other issues, so the values can never equal TradingView's. The series is served labelled as UCT breadth data and
graded as a substitution (MATCH_SUBSTITUTED or a named divergence), never claimed as TradingView's. Two facts are
licensed only by a capture:
- the **alignment**: whether a session's count is read on that session's chart bar or on the next one. TradingView's
  `SP:SPX` on a stock's daily chart reads the PREVIOUS session (Q-RS3, `requestWitnesses.json`), so nothing about a
  `USI:` spelling's alignment is assumed;
- the **size of the divergence** per spelling, so the member's sentence states it.

**When.** Before the open on a fresh load (`preopen`; a Sunday counts, no bar is forming). Any day.

## The rows

| id | probe | chart | question | live | phase |
|---|---|---|---|---|---|
| Q-T4-B1 | `vw-data-usi.pine` | AMEX:SPY 1D, NYSE:RDDT 1D | per spelling (U01-U18): the daily close TradingView serves on each chart bar; U01 vs U02 (`"D"` vs `timeframe.period`) and each row against our own session counts settle the alignment; U05/U06 vs U01/U03 and U09/U10 vs U07/U08 settle whether the short spellings are the exchange ones; U11 vs U01-U03 whether ADD is the difference; U19 the built-in Advance Decline Line's spread | no | preopen |
| Q-T4-B2 | `vw-data-usi.pine` | AMEX:SPY 1W, AMEX:SPY 1M | (added 2026-11-22 by B2) the same probe on a weekly and a monthly chart: U02 (`timeframe.period`) is the weekly / monthly read our resampler folds (`same-week` / `same-month` if Q-T4-B1 shows the same session, `previous-week` / `previous-month` if it shows the previous one), U01 (`"D"`) the daily read sampled at the period's last row (`week-last-row` / `month-last-row`); each breadth row's `periods.W` / `periods.M` block cites this row | no | preopen |

## By hand

- TradingView's built-in **Advance Decline Line** and **Advance/Decline Ratio** at their defaults on AMEX:SPY 1D
  (two captures; built-in captures are licence-held and stay local). They grade end to end once the `USI:` unit
  serves.

## What each answer moves

- Q-T4-B1 is the witness the breadth unit's `requestWitnesses.json` rows cite (B2). Its landing is one data edit: each row's `witness` + `captured`, and
  `pineBreadth.js::BREADTH_DAILY_ALIGNMENT` if the capture shows the previous session (it is `same-date` until then).
- Q-T4-B2 is the witness of each row's weekly and monthly block (B2); until it lands a weekly or monthly chart refuses a
  `USI:` read by name (`other-symbol:witness-timeframe`). A spelling with no witness is
  refused by name, never guessed. A spelling TradingView answers `na` on every bar is recorded as such and stays
  refused.
