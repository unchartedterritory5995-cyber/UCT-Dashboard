# Capture queue: 2026-11-16, door robustness (a `var string` in a drawing text)

Same procedure as `docs/pine/capture-queue-2026-09-28.md`; capture from the listing (NYSE:RDDT 1D), and read
each table cell's and label's text from the chart model.

## FIRST: two scripts the per-bar lane now draws on capability evidence alone (capture the scripts themselves)

The member door now offers these two host-budget-refused scripts to the per-bar lane, and capability admission
(owner policy R1, `PINE_RUNTIME_CAPABILITY_ADMISSION=on`) ADMITS both, so a member whose pane is permitted sees
them drawn bar by bar with no capture of their own. Capture each script itself (no probe), from the listing; if
either grades DIVERGE on the runtime-on lane it goes on the committed kill list (coordinator ruling, 2026-11-16).
Both are reference-only sources (local sample cache, never committed), so the queue tool lists these rows as
naming no probe file; the session takes the source from the sample cache by its key.

| row | script (no probe) | charts | what it settles |
|---|---|---|---|
| Q-ROB8 | `reference:check-head-and-shouldersmask-man` (sha256 `7f75ae5de3275c54…`) | NYSE:RDDT 1D, AMEX:SPY 1D, from the listing | whether the per-bar lane's drawing of an admitted, never-captured script MATCHes |
| Q-ROB9 | `reference:multi-timeframe-vwap-v5` (sha256 `3a11805bfef806a1…`) | NYSE:RDDT 1D, AMEX:SPY 1D, from the listing | the same |

The drawing lane's text reader now reads a `var string` from its writes where that needs no bar-to-bar
memory (`pine.js::stringVarTextOf`): a seed that is text, a write on every bar, a write under a guard that is
the same on every bar of the chart, a write in both branches of an `if / else`. Two shapes are refused by
name (`pine:text-value`) until a capture says what TradingView shows:

| row | probe | what it settles |
|---|---|---|
| Q-ROB1 | `vw-rob1-var-string-text.pine` | C01, C02, L01: the text of a `var string` still holding the `na` it was declared with, in a table cell and in a label (F4's capture pins only a label created with `text = na`). Frees the two cells of `volume-pace-pressure-table` on a daily chart |
| Q-ROB4 | `vw-rob1b-var-string-guards.pine` | G01-G08: the `var string` shapes the drawing lane now SERVES whose only witness today is a licence-held capture (williams-r-rsi-ema-tendance-silver-wong s11, volume-pace-pressure-table s4-prove-drawn, both regraded MATCH locally; CI cannot reproduce them): a write under an input comparison at its default (true and false), sequential blocks over one input, a write under `timeframe.isminutes` on a daily chart (the seed), a write under an input bool, and a cell inside a block that never runs on a daily chart (absent). G05 (`timeframe.isdaily`) is refused as a latch today and settles whether to serve it. This committed capture replaces the licence-held witnesses |
| Q-ROB3 | `vw-rob3-v4-bgcolor-own-alpha.pine` | A1-A3: what a v4 `bgcolor` with no `transp` draws over a colour with its OWN alpha (`color.new(c, 50)`): the alpha, the 90 default, or both. Withheld today by name (`paint:v4-default-transp`); frees relative-strength-index-divergences-libertus's two backgrounds. A4 is the control. ⚠️ The chart MODEL does not settle it alone: the licence-held libertus capture (s11, RDDT 1D 2026-11-15) reads `styleState.transparency` 90 on both background rows AND palette colours at alpha 0.5, so how the two combine on screen needs this probe read with the pixels (or the renderer's composite) beside the model |
| Q-ROB2 | `vw-rob1-var-string-text.pine` | C03, L02: a `var string` written in a block that runs on some bars only (the latch). Not served by a text template at all today; the capture decides whether carrying it (a text column, or the run) is worth building. C04-C06 are the controls for the shapes that are served |

## The per-bar lane's drawing of mtf-key-levels (new by reach, not a changed drawing)

The member door now offers a host-budget-refused script to the per-bar lane, so the runtime-on harness grades
`mtf-key-levels-support-and-resistance-{rddt,spy}-1d-2026-11-14` for the first time: INCONCLUSIVE -> DIVERGE
(2 of 5 items). The script is NOT admitted for the pane (`capability_admitted`: missing `obj:table`,
`request-other`; the door says `runtime:not-yet-graded`), so no member sees this drawing. Each diverging item is
an engine defect of the per-bar lane, tracked here; the captures already exist, no probe is asked:

| row | probe | what it settles |
|---|---|---|
| Q-ROB5 | (existing capture `mtf-key-levels-support-and-resistance-rddt-1d-2026-11-14`) | `D-VWAP` (plot_0): 6 steady-state bars disagree in the 2nd decimal (first at bar 114: vendor 57.3, ours 57.29), persistent to bar 665; W-, M- and Y-VWAP agree on every bar. CAUSE (fixed 2026-11-16, `fix/pine-runtime-mtf-key-levels`): a daily bar is its own session and TradingView computes `(price * volume) / volume`, which can differ from the price in the last binary digit; the script's `ceil(x * 100) / 100` turned that into a cent |
| Q-ROB6 | (existing capture `mtf-key-levels-support-and-resistance-rddt-1d-2026-11-14`) | labels: TradingView 27, the per-bar lane 3. CAUSE (fixed 2026-11-16): the string-var text reader knew only `var string X`; an untyped `var X = "..."` is a string by its literal. Now 25 of 27. The 2 left are refused by name: the yearly-open label (`security(..., "12M", open)`, `pine:request`) and the W-VWAP label (its `if wvw` reads a v4 self-referencing weekly sum the host object pass cannot compute, `objects:not-computable`) |
| Q-ROB7 | (existing capture `mtf-key-levels-support-and-resistance-rddt-1d-2026-11-14`) | lines: 23 vs 22, and a line's y1 differs (first: vendor 103.2824, ours 101.27). CAUSE: the missing line is the yearly open's (the same `"12M"` request refusal); the y1 mismatch is a pairing shift after that gap, not a wrong price |

| not a capture | disposition | reason |
|---|---|---|
| Q-ROB5 | closed | fixed on 2026-11-16 (`dailySessionVwap` returns the one-bar session's quotient); its own capture and `h3-vwap-source-spy-1d-2026-10-02` witness the fix bit for bit |
| Q-ROB6 | engine-gap | 25 of 27 labels drawn since 2026-11-16; the 2 left need a 12M `request.security` and a computable self-referencing weekly sum, builds rather than TradingView readings |
| Q-ROB7 | engine-gap | the capture exists and grades the item DIVERGE; the missing line needs the same 12M `request.security` build, and the y1 mismatch follows from that gap |
