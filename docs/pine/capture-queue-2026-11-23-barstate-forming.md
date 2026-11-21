# Capture queue: Q-BSF, `realtime-state` on a FORMING newest bar (2026-11-23)

Coordinator ruling 2026-11-21 (track 1a, the forming-bar witnesses).

**The rule these rows are aimed at.** `realtime-state` is served for closed-bar history only (`scope:
closed-bar-history`, `rollout_gate.PINE_CAPABILITY_FORMING_UNGRADED`). No capture grades it on a forming newest bar,
so the member door refuses it by name there. Lifting that scope takes the family rule, graded on a FORMING newest bar:
at least 2 captures of at least 2 scripts, at least 1 of them community, each MATCH with the runtime pane on.
- Our probe `vw-barstate-forming.pine` gives the captures.
- Row Q-BSF-c gives the community script.

**When.** Monday 2026-11-23, regular hours, the newest bar forming. Two moments:
- Q-BSF-a from 14:45Z.
- Q-BSF-b from 18:30Z, on another symbol.
- One capture each, read on one tick.

So a stale read cannot pass twice. The queue has one `insession` phase per probe and chart, so the second moment
takes another symbol rather than a second phase. Not after the close: a fresh load then has no forming bar (RS
RATING L11).

**Not here: `varip`.** It stays closed-bar. Grading its updates inside a forming bar needs tick replay, which the rig
does not have.

| id | probe | chart | question | live | phase |
|---|---|---|---|---|---|
| Q-BSF-a | `vw-barstate-forming.pine` | AMEX:SPY 1D, AMEX:SPY 5 (extended hours OFF) | first moment in regular hours, the newest bar forming: F01-F06 on the newest bar (expected isconfirmed 0, isrealtime 1, islast 1, ishistory 0, islastconfirmedhistory 0; islastconfirmedhistory 1 on the bar before), F07's na on the newest bar against close on every confirmed bar, and every historical bar's columns | yes | insession |
| Q-BSF-b | `vw-barstate-forming.pine` | NASDAQ:QQQ 1D, NASDAQ:QQQ 5 (extended hours OFF) | the same questions at the second moment, about four hours after Q-BSF-a | yes | insession |
| Q-BSF-c | `reference:visualizing-behaviors-of-barstate-variables__obOGTMd2LJ` | AMEX:SPY 5 (extended hours OFF) | the community witness: each barstate column on the newest forming bar and the islast labels, in regular hours | yes | insession |
