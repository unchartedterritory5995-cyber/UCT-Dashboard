# E2: corporate events in the engine (track 4, 2026-11-22)

Track 4 (the data indicators need), unit E2, on the coordinator's rulings of 2026-11-22. A member's Pine script that
calls `request.earnings`, `request.dividends` or `request.splits` on its chart's own symbol is now served, on both
lanes, placed on the chart's bars as TradingView places them (E0) and supplied from UCT's own event data (E1). Engine
number: NUMBER PENDING (train e95).

This document holds counts, dates and verdicts only. Every TradingView value stays in the local capture store, and
every UCT event value stays in the local held supply (licensed vendor data, never committed).

## What is served, and how

| part | where |
|---|---|
| The parse rewrite: each call becomes an event read, one series per field and per `gaps` x `lookahead` pairing | `app/src/components/chart/engine/ast/pine.js::eventAsSecurity` |
| The read's ticker, its static refusals, the placement, the earnings window | `app/src/components/chart/engine/pineEvents.js` |
| The bind's decision (both lanes ask it) | `otherSymbols.js::eventDecision` |
| The supply: one door per chart symbol, never `/api/bars` | `eventSupply.js` (`GET /api/pine/events/<symbol>`), `useSecondarySources.js` (`EVENTS_KEY`) |
| The witness rows (`kind: "event"`, D and W, E0's captures) | `requestWitnesses.json` |
| The capability | `request-events` (`api/services/pine_capabilities.py`, detector v3), history-only, row pending (not admitted) |

The placement (E0, R1 and R2): an event is stamped at its date's session close. `lookahead_on` reads it on the first
bar closing at or after that instant, `lookahead_off` on the first bar opening after it. A date that is not a
session lands both reads on the next session. `gaps_on` reads the value on that bar and `na` elsewhere; `gaps_off`
carries it.

## Withheld by name, never `na`

| case | rule | the member's words |
|---|---|---|
| a bar before UCT's record of the family | `knownFrom` (E1) | "Not drawn before <date>: UCT's record of <SYM>'s <family> starts there, so whether an earlier one landed on those bars is not known here." |
| a bar an OLDER event could reach | E1's `knownFrom` is our first held event, not a coverage start: a bar is known only where every event that can land on it is dated on or after it (or where our own event lands, the newest there); under `gaps_off`, from our first event's bar on | the same sentence |
| earnings before 2003-01-01 | `EARNINGS_WINDOW_FROM` (ruling 1 below, moved by ruling (c) on W-E3) | "Not drawn before <date>: UCT draws <SYM>'s earnings from 2003-01-01 on, after TradingView's earnings history begins, so whether an earlier report landed on those bars, or carries into them, is not known here." |

Both lanes carry the code `other-symbol:event-before-record` per bar: the host lane in each plot's per-bar channel
(and the strip's sentence), the runtime lane on its known-from depth record (the headless lane reports those bars
under the code).

**Measured, the older-event rule.** With `gaps_off` and `lookahead_off`, TradingView reads the dividend or split
BEFORE our record on the bar of our first event's date: AAPL and JPM dividends, NVDA's splits (one bar each). That
bar now reads as withheld, not `na`. A record whose `knownFrom` lies before its first event (a true coverage start,
ruling (1)) reads `na` from `knownFrom` to the first event, as TradingView prints it; both are railed.

## Refused by name

`earnings.standardized`, `dividends.net` (`other-symbol:event-field`); another symbol's events
(`other-symbol:event-symbol`); a non-USD currency (`other-symbol:event-currency`); a `gaps`, `lookahead`, field or
symbol argument not written as a constant (`other-symbol:event-argument`); a monthly chart (W-E2) or an intraday
chart (no report time of day held) (`other-symbol:event-timeframe`); the door dark for the member: "earnings data is
not available on this chart yet" (`other-symbol:event-not-available`); a family UCT holds nothing of
(`other-symbol:event-none`); the engine's internal event name written by a script (`other-symbol:event-spelling`).

## Rulings applied (coordinator, 2026-11-22)

1. **The earnings window.** TradingView's first report on each witnessed symbol: AAPL 2001-07-17, JPM 2001-07-18,
   NVDA 2001-08-14, MU 2000-01-14. UCT holds 61, 61, 7 and 62 reports before 2001 (quarterly back to 1985) and two
   each in the first half of 2001 that TradingView does not show. Earnings were drawn from 2001-09-01 on, to be
   re-derived when the W-E3 coverage captures landed. **Moved to 2003-01-01 by ruling (c) on W-E3** (next section).
2. **Misplaced earnings, two named vendor-record classes** (from TradingView's first report on, D charts):
   - A. 1-2 day date offsets (report day against the next or previous day; no time of day held): 6 reports
     (AAPL 2, JPM 3, MU 1).
   - B. weeks-off dates or missing quarters (one source carries a different record): 18 reports (AAPL 5, JPM 3,
     MU 7, NVDA 3), mostly 2001-2006.
   Earnings grade DIVERGE or SUBSTITUTED ("UCT earnings data"), never MATCH.
3. **A fund reads `na`.** On a chart whose store class is ETF, an earnings read is `na` on every bar (the SPY 1D
   witness); the vendor's one stray SPY row (2005-02-15) never draws.

Further named divergences (later units):
- **GE splits:** the vendor lists two spin-off adjustments as splits (2023-01-04 and 2024-04-02), which TradingView
  does not list.
- **SPY dividends:** the vendor rounds distributions to three decimals, and lacks two (2004-11-15, 2006-12-15).
- **O dividends:** the vendor's amounts before the 2004 split are split-adjusted, where TradingView's are as declared.

## W-E3: the coverage captures, and the earnings cut moved (ruling (c), 2026-11-22)

Twelve captures (`t4-we3-2026-11-22`, rig-clean): `vw-data-earnings` and `vw-data-dividends` on NYSE:KO, NASDAQ:COST,
NYSE:TSM (an ADR), NASDAQ:META, NYSE:RDDT, NASDAQ:CASS, 1D. Our side is production's E1 answer of 2026-11-22, a held
record (`record_event_supply.py`). The captures and the record stay local; this names derived dates and counts only.

**TradingView's first report is per symbol** (its data vendor's coverage), not one date:

| symbol | TradingView's first report (E01) | against the old cut 2001-09-01 |
|---|---|---|
| COST | 1999-12-09 | before |
| MU, AAPL, JPM, NVDA (E0) | 2000-01-14, 2001-07-17, 2001-07-18, 2001-08-14 | before |
| KO | 2001-10-18 | the first report after it |
| CASS | 2002-02-01 | **after** (our late-2001 report drew where TradingView draws `na`) |
| TSM | 2002-04-25 | **after** (two late-2001 reports the same way) |
| META, RDDT (listed after the cut) | the listing bar (2012-05-18, 2024-03-21) | a report from before the listing, carried onto bar 0 |

**Ruling (c): the cut is 2003-01-01**, after every witnessed start (the latest is TSM's, 2002-04-25). The two errors are
not alike: withholding a report TradingView draws is honest (named, a lost MATCH chance); drawing a report TradingView
does not is wrong. Our own record cannot set a per-symbol start: it starts earlier than TradingView on every symbol
witnessed (KO, COST 1985; CASS 1995; TSM 1998; META 2011; RDDT 2020). Every new earnings capture re-checks the cut: a
TradingView first report after it, on a symbol listed before it, goes to the coordinator first.

**Re-graded at 2003-01-01** (both lanes give the same verdict on every row): every earnings capture stays DIVERGE by the
named vendor-record classes (values and dates, never MATCH, as ruled). Below 2003-01-01 nothing is compared now, and
no bar after the cut draws a report TradingView lacks because of the cut. CASS's first divergence moved from a late-2001
report TradingView does not show (bar 854) to a 2003 value difference (bar 1076); TSM's from late 2001 (bar 1018) to a
2003 report placed on another day (bar 1330).

**A report from before the listing, on the listing bar (META, RDDT).** E2 carries the latest prior report onto bar 0
under `gaps_on`, as TradingView does (R3): RDDT's `gaps_on` / `lookahead_on` and `gaps_off` / `lookahead_on` plots
MATCH on all 671 bars, bar 0 included. Under `lookahead_off`, RDDT's listing-day report (dated 2024-03-21, the listing
day) lands on bar 0 on TradingView and on bar 1 on ours: 2 bars on `gaps_on`, 1 on `gaps_off`. That is class A (no time
of day held: TradingView stamps that report before the open), not a listing rule. META's bar 0 differs by value only
(TradingView 0.10 / 0.12 against our 0.1182): its record holds another pre-listing report.

**knownFrom per family, ours against TradingView's first event:**

| symbol | dividends: ours (knownFrom) / TradingView first | |
|---|---|---|
| COST | 2004-05-06 / 2004-05-06 | MATCH on all four gross plots, **special dividends included** (the 2023-12-27 $15 special is a `dividends.gross` row on both sides) |
| META | 2024-02-21 / 2024-02-21 | MATCH on all four gross plots |
| CASS | 2004-03-03 / 1996-07-02 | every compared bar agrees; TradingView's 31 earlier events are withheld by name |
| KO | 2003-06-11 / 1975-03-11 | earlier events withheld by name; one ex-date one day apart (TradingView 2003-09-11, ours 09-12): DIVERGE on 2 bars |
| TSM (ADR) | 2004-06-14 / 2004-06-14 | **ADR currency: both sides USD per ADR, and TradingView's amounts are 0.79-0.80 of ours on 42 of 45 events, consistent with the 21% Taiwan withholding: TradingView's `dividends.gross` for this ADR reads after that tax** (one event 0.75; the first, 2004, 0.33). A named vendor-record divergence on every event: DIVERGE |
| RDDT | none / none | refused by name (`other-symbol:event-none`) |

Earnings `knownFrom` (ours): KO 1985-09-30, COST 1985-08-31, CASS 1995-03-31, TSM 1998-03-11, META 2011-03-31,
RDDT 2020-12-31; every one before TradingView's first, so `knownFrom` = max(ours, the cut) = the cut for the four listed
before it, and the bars before the listing are none for META and RDDT.

## Grade diff: the local event captures, both lanes

The E0 probe captures (25, `s4-closed-retake-2026-11-20`) and TradingView's built-in VWAP at its event anchors (7,
`s4-vwap-anchors-retake3-2026-11-21`), graded with OUR side fed production's E1 answer for each symbol (a held local
record, `tools/vendor_harness/record_event_supply.py`). "Before" is the parse as it was (the rewrite off).

| lane | before | after |
|---|---|---|
| production | 32 INCONCLUSIVE | 2 MATCH, 11 DIVERGE, 19 INCONCLUSIVE |
| runtime-on | 32 INCONCLUSIVE | 2 MATCH, 11 DIVERGE, 19 INCONCLUSIVE |

- **MATCH:** AAPL and TSLA splits, every plot (7 of 7 each).
- **DIVERGE (11), each a named vendor-record divergence:** earnings on AAPL, JPM (1D, 1W), MU, NVDA (rulings 1-2);
  O and SPY dividends; GE splits. On the two 60-minute earnings captures, the event plots are refused by name
  (intraday) and the one diverging plot is the probe's own `time_close` control, which reads `na` on our side on the
  extended-hours grid: pre-existing, newly visible now that the script attaches.
- **INCONCLUSIVE (19):** coverage (bars where TradingView draws a value are withheld by name: AAPL, JPM dividends;
  NVDA splits), the refused fields (`dividends.net`, `earnings.standardized`), `earnings.future_*`, and the built-in
  VWAP and our anchor probe, which stay refused by walls outside E2 (`ta.vwap` with an anchor argument, and a
  character the built-in's source holds).
- Plots: 0 MATCH before, 48 after. **0 MATCH lost.**

## Census diff: the event-reading corpus rows, both lanes

20 scripts (the 15 corpus scripts that read events, TradingView's built-in VWAP among them; one more that spells a
legacy event symbol; TradingView's three reference examples; one script that matched the search only by name),
through the member door before and after, both lanes, with the promoted library store: **0 served -> refused,
0 refused -> served.** The three reference examples now attach and refuse their plots by name (they read another
symbol's events, and `dividends.net`). One community script that threw at bind before (`Cannot read properties of
undefined`) now refuses its plots by name. The census measures one closed daily bar
with no event supply, so a script whose events are its only wall shows here as attached and waiting; what it draws
is the local grade above.

## Rails and mutants

- `app/src/components/chart/engine/requestEvents.test.js`: the rewrite, the static refusals, the internal name
  (never fetched), the four pairings on both lanes, the weekly placement, float32, the timeframe and door refusals,
  the per-bar words on both lanes, the earnings window, the fund, E1's own record shape, and the runtime lane's
  named-read routing (the corpus anchor idiom).
- `app/src/components/chart/engine/eventSupply.test.js`: one ask per symbol; 200, 202, 404, failure and abort; the
  events key never reaches the bars door.
- `ci/mutants/t4-e2-events.json`: 15 mutants (EV1-EV15), run by `tools/ci_mutant_runner.py` (byte-identical restores).
