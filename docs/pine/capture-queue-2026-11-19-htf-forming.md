# Capture queue: a weekly or monthly read on the chart's newest bar, in every state that bar can be in (2026-11-19)

Coordinator ruling 2026-11-19 (the request family's HTF-forming design). Same procedure as
`docs/pine/capture-queue-2026-09-28.md`: capture from the listing, keep the plotted values as full float64 text, and
record each capture's own `capturedAtUTC`. The probe is `vw-request-htf-forming.pine`, our probe (licence `probe`).

**Why.** With look-ahead off, `request.security` returns "the last confirmed values on historical bars and the most
recent developing values on realtime bars" (Other timeframes and data). So a weekly or monthly read on the newest
bar depends on whether TradingView runs that bar as a REALTIME bar. RS RATING L11 measured when it does: always in
session; after the close only if the chart has ticked since it loaded; never on a fresh overnight load. The
committed captures hold only FINISHED newest bars:
- `vw-request-htf-alignment-spy-1d-2026-10-02` (after the close, isrealtime 1): the monthly close with look-ahead
  off is the month so far;
- `vw-request-htf-alignment-{spy,qqq}-1d-2026-11-18` (a fresh pre-market load, isrealtime 0): the weekly and
  monthly closes with look-ahead off are the last confirmed periods, and with look-ahead on the period so far.

No committed capture holds a FORMING newest bar of a daily chart reading a week or a month. Today the engine:
- draws the developing period there with look-ahead off;
- withholds it with look-ahead on, on the runtime lane (`request:htf-lookahead-forming-unmeasured`);
- withholds the look-ahead-off read on a finished newest bar inside a forming period (two TradingView answers,
  depending on whether the chart has ticked since it loaded).

The rows also witness what may be drawn FROM such a read on the newest bar:
- `x[1]` reads the bar before, which is settled;
- `nz(x)`, `na(x) ? x[1] : x`, a window over x and a running total of x read x on the newest bar itself;
- `close` reads no request at all.

**When.** Take every row on a Tuesday, Wednesday or Thursday that is NOT the month's last session, so that the
newest bar's week and month are both still forming. On a FORMING bar, read the bar rows and the plot values on ONE
tick, or capture twice and keep the pair whose newest row did not change. The in-session probe
`vw-htf-window-sites-spy-1d-2026-11-16` read a weekly close of 743.35 against a captured daily row of 743.34.

| id | probe | chart | question | live |
|---|---|---|---|---|
| Q-HTF-FORM-a | `vw-request-htf-forming.pine` | AMEX:SPY 1D, NYSE:RDDT 1D | during regular hours, the newest daily bar forming: F01-F05 on the newest bar (the period so far, for look-ahead off and on?), F06-F11 there, and F13 / F14 | yes |
| Q-HTF-FORM-b | `vw-request-htf-forming.pine` | AMEX:SPY 1D, NYSE:RDDT 1D | after the close, on a chart LEFT OPEN across the close (no reload), captured 5 and 30 minutes after the close: is the newest bar still realtime (F13), and is F02 the month so far? | yes |
| Q-HTF-FORM-c | `vw-request-htf-forming.pine` | AMEX:SPY 1D, NYSE:RDDT 1D | after the close, a FRESH load (a new tab or a reload), 30 minutes after the close: does the newest bar read realtime without a tick, and which F01 / F02 does it show? | yes |
| Q-HTF-FORM-d | `vw-request-htf-forming.pine` | AMEX:SPY 1D, NYSE:RDDT 1D | the next morning before the open, a fresh load: F13 = 0, F01 / F02 the last confirmed periods, F06 (the settled `x[1]`) on the newest bar | no |
| Q-HTF-FORM-e | `vw-request-htf-forming.pine` | AMEX:SPY 5 | during regular hours: a weekly and a monthly read on an intraday chart, whose newest bar is always inside its week | yes |
| Q-HTF-FORM-f | `vw-request-htf-forming.pine` | AMEX:SPY 1W | during regular hours, the newest weekly bar forming: the monthly read (F02 / F04) on a weekly chart; F01 / F03 are the chart's own period | yes |

**What each answer moves.**
- Q-HTF-FORM-a grading F03 / F04 MATCH on the forming bar serves the look-ahead-on read there (engine number: yes).
- Q-HTF-FORM-b / -c say whether a member's chart after the close can be read as one state or must stay withheld.
- Q-HTF-FORM-d witnesses, on a finished newest bar, `x[1]` (F06: withheld today on both lanes, as the plot's whole
  tree reads the merge) and a plot that reads no request (F11: withheld today on the runtime lane, which blanks every
  column of the run on that bar).
- Q-HTF-FORM-e / -f carry the rule to the intraday and weekly charts.
