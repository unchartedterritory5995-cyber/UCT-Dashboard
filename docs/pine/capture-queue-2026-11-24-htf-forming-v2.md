# Capture queue: Q-HTF-FORM v2, the same questions in shapes both lanes grade (2026-11-24)

Coordinator ruling 2026-11-19 (Q-HTF-FORM probe v2). The questions, the procedure and the "When" rule are those of
`docs/pine/capture-queue-2026-11-19-htf-forming.md`. Capture from the listing, keep the plotted values as full float64
text, and record each capture's own `capturedAtUTC`. The probe is `vw-request-htf-forming-v2.pine`, our probe
(licence `probe`).

**Why a v2.** v1's captures, rows a / e / f in session and row c after the close on 2026-11-19, are valid TradingView
data, but neither lane could grade them:
- the host lane refused v1's unbounded running total (F10, `pine:state`);
- the runtime lane refused its weekly `bar_index` (F12, `runtime:unbound`): a request expression binds no `bar_index`
  and no `time`.

v2 changes only those plots and adds one:
- F10 re-seeds each week (`timeframe.change("W")`), so it is still `var` state carrying x, now bounded;
- F12 reads the week's OPEN, which still says which week the read is;
- F16 adds `math.sum(nz(F01), 5)`, a summed window.

Measured 2026-11-19 with `tools/pine_coverage/run_language_probe.py`: the host lane installed v2 (17 plots, loss
clean), and the runtime lane compiled it (17 outputs, 7 requests). v1 and its captures stay, for when the engine
admits the unbounded shape.

**When.** As v1: every in-session row on a Tuesday, Wednesday or Thursday that is NOT the month's last session.
- 2026-11-24 (Tuesday) takes rows a / e / f in regular hours and row c 30 minutes or more after the close.
- Row d is the next morning before the open, 2026-11-25.
- 2026-11-26 is Thanksgiving, and November's last session is 2026-11-28.
- Row b needs a chart left open across the close; the batch harness loads every chart fresh, so b is not batched.

| id | probe | chart | question | live | phase |
|---|---|---|---|---|---|
| Q-HTF-FORM2-a | `vw-request-htf-forming-v2.pine` | AMEX:SPY 1D, NYSE:RDDT 1D | during regular hours, the newest daily bar forming: F01-F05 on the newest bar (the period so far, for look-ahead off and on?), F06-F11 and F16 there, and F13 / F14 | yes | insession |
| Q-HTF-FORM2-c | `vw-request-htf-forming-v2.pine` | AMEX:SPY 1D, NYSE:RDDT 1D | after the close, a FRESH load, 30 minutes after the close: does the newest bar read realtime without a tick, and which F01 / F02 does it show? | yes | postclose-fresh |
| Q-HTF-FORM2-d | `vw-request-htf-forming-v2.pine` | AMEX:SPY 1D, NYSE:RDDT 1D | the next morning before the open, a fresh load: F13 = 0, F01 / F02 the last confirmed periods, F06 (the settled `x[1]`) and F10 / F16 on the newest bar | no | preopen |
| Q-HTF-FORM2-e | `vw-request-htf-forming-v2.pine` | AMEX:SPY 5 | during regular hours: a weekly and a monthly read on an intraday chart, whose newest bar is always inside its week | yes | insession |
| Q-HTF-FORM2-f | `vw-request-htf-forming-v2.pine` | AMEX:SPY 1W | during regular hours, the newest weekly bar forming: the monthly read (F02 / F04) on a weekly chart; F01 / F03 are the chart's own period | yes | insession |

**What each answer moves.** The same as v1's rows. On top of that, F10 and F16 witness what a bounded state and a
summed window over a forming weekly read show on the newest bar, on both lanes.
