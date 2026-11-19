# Capture queue: what a last-bar-only drawing block draws while the newest bar is forming (2026-11-19)

Coordinator ruling 2026-11-19 (the script lane's hold). Same procedure as
`docs/pine/capture-queue-2026-09-28.md`: capture from the listing, keep the plotted values as full float64 text,
record each capture's own `capturedAtUTC`, and keep the objects (labels with their bar, price and text; the table's
cells). The probe is `vw-lastbar-forming.pine`, our probe (licence `probe`).

**Why.** The engine refuses `barstate.islast`-gated drawing on a FORMING newest bar (`pane:forming-ungraded`;
`realtime-state` is closed-bar history only), because no committed capture grades it. On 2026-11-19 that refusal
made one in three of the script assistant's recipes undrawable during a session, so the script lane stays at
admin. The script contract is moving off last-bar reads, but last-bar drawing is one of the most common Pine idioms
in published scripts, so the engine should serve it wherever TradingView's picture is known. These rows are that
witness: the last-bar label's bar, price and text, the table cell's text, and where the
`barstate.islastconfirmedhistory` label sits, in each state the newest bar can be in.

**When.** On a FORMING bar, read the objects and the plot values on ONE tick, or capture twice and keep the pair
whose newest row did not change.

| id | probe | chart | question | live | phase |
|---|---|---|---|---|---|
| Q-LASTBAR-a | `vw-lastbar-forming.pine` | AMEX:SPY 1D, NYSE:RDDT 1D | during regular hours, the newest daily bar forming: the last-bar label (bar, price, text) and the table cells against F07, and the bar of the `LCH` label | yes | insession |
| Q-LASTBAR-b | `vw-lastbar-forming.pine` | AMEX:SPY 5 | during regular hours on an intraday chart: the same objects on a forming 5-minute bar | yes | insession |
| Q-LASTBAR-c | `vw-lastbar-forming.pine` | AMEX:SPY 1D, NYSE:RDDT 1D | the next morning before the open, a fresh load: the same objects on a FINISHED newest bar (the control the engine already serves) | no | preopen |
