# Capture queue — 2026-10-02 H1, trailing stops whose reset test reads the stop (Q-H1a, Q-H1b)

Branch `pine/h1-host-walls`. One new probe,
`tools/visual_conformance/probes/vw-ratchet-stops.pine`, for the parent session to run on the live
TradingView rig with `tools/vendor_harness/tv_capture.js` — same procedure as
`docs/pine/capture-queue-2026-09-28.md` (visibility gate, **Create new ▸ Indicator**, "Add to chart"
binding gate, `__uctVH.capture({...})`, chunks, `verify_capture.mjs --assemble`).

## What H1 serves, and what grades it today

H1 serves a SWITCHED recurrence whose reset test reads its own state (the ratchet:
`up := close[1] > up1 ? max(up, up1) : up`) through the RANGE window
(`interpret.js::RANGE_TOP`), and a helper's own `x = init` / `x := f(x[1])` recurrence
(`Resolver.finalLocalOf`). One committed capture grades the first:
`pivot-point-supertrend-rddt-1d-2026-09-27` — from the listing every bar matches, and behind the
curtain 130 / 130 drawn bars match; `qqe-signals-rddt-1d-2026-09-27` grades both label plots from the
listing (every label TradingView's, none missing) and is withheld whole behind the curtain
(`vendorHarness.h1Ratchet.test.js`). Every other newly served script (supertrend-explorer,
supertrend-strategy, atr-trailing-stop-by-ceyhun, pmax-explorer, twin-range-filter, and the community
`04-ut-bot-alerts` / `05-chandelier-exit`) is held
to the engine's OWN listing run (`ratchetServedScripts.test.js`: 0 bars disagree, 0 published the
listing withholds) — an internal reading of Pine, not TradingView's. The plateau rule for pivots
(`vendorHarness.h1PivotTies.test.js`) rests on one left-tie witness (RDDT bars 473/474) and two
right-tie captures.

## The captures

| # | capture | settles | what it would move |
|---|---|---|---|
| Q-H1a | `vw-ratchet-stops` on AMEX:SPY 1D (a long history — NOT from the listing) | R01–R05 against TradingView on every bar the curtain publishes: the classic supertrend's two stops and its direction, a helper's stop, a range filter whose test nests two state reads | grades the curtain path itself (no committed capture reaches it except one script past bar 500); turns the listing-run rails into vendor rails |
| Q-H1b | `vw-ratchet-stops` on NYSE:RDDT 1D (from the listing) | R01–R07 from bar 0, and R06/R07 on every plateau RDDT prints: a tie on the left pivots, a tie on the right does not, on more than the one left-tie witness | the plateau rule's evidence widens from one bar to every tie in 630 bars |

R00 is the bar-index control the harness reads to prove the series starts where the capture says.
Nothing is refused waiting on these captures; they upgrade the evidence behind what is served.
