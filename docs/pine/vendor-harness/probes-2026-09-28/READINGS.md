# Capture-queue probes — live TradingView readings, 2026-09-28

Eight captures from the owner's TradingView session (layout `01f1AcIj`, RTH, full history
loaded until it stopped growing twice). Each capture verified with
`tools/vendor_harness/verify_capture.mjs` (schema + FNV-1a receipt + source sha256):
8/8 `VERDICT: PASS`. Files: `tests/fixtures/vendor/harness/vw-*-2026-09-28.json`.

| capture | probe source (commit, sha256 prefix) | bars | first bar |
|---|---|---|---|
| vw-var-seed-spy-1d | `82c710f24` `49d04985` | 8,473 | 1993-01-29 (SPY listing) |
| vw-bool-cast-spy-1d / -60 | `db3691055` `26c9010d` | 8,473 / 20,616 | listing / 2015-01-02 |
| vw-bool-cast-v4-spy-1d / -60 | `db3691055` `ee75392f` | 8,473 / 20,616 | listing / 2015-01-02 |
| vw-deadband-ticks-spy / aapl / brk-a 1d | `6353cbb48` `e915aecd` | 8,473 / 11,534 / 11,335 | listing each |

The grade summaries beside this file are the corpus harness run on each owning branch:
`grade-integration-a07c83fe7.md` (var-seed + bool-cast + this branch's harness),
`grade-host-walls-5-e9da3a863.md` (#240, legacy bare `valuewhen`),
`grade-mintick-6353cbb48.md` (#238).

## Q-V1 — `var` on bar 0 (#239, `pine/var-seed-na`) — SETTLED, the shipped rule holds

The member door refuses this probe (`pine:state` — row V04 is an unbounded running total, by
design), so it was read from the vendor's own columns. Every row is constant over all 8,473
bars, which is what the probe was built for (bar 0's answer is carried forever):

| row | shipped rule | alternative | TradingView |
|---|---|---|---|
| V01 `a := … a[1]` (var) | na | 7 | **na** ×8473 |
| V02 `b := … b` (bare, CONTROL) | 7 | 7 | **7** ×8473 |
| V03 `nz(c[1], 3)` | 3 | 7 | **3** ×8473 |
| V04 mixed, bar 0 takes the history arm | na | a count from 7 | **na** ×8473 |
| V05 no `var`, `e[1]` | na | 7 | **na** ×8473 |
| V06 `f[2]` unguarded | na | a smoothed close | **na** ×8473 |

`x[1]` on bar 0 is `na` and does not read the initializer. `varSeedOf` is right.

## Q-B1 / Q-B2 — implicit bool cast (`db3691055`, on #237's line) — SETTLED, v4 = v5

B01 `and` · B02 `not` · B03 `or` · B04 ternary · B05 if/else · B06 `valuewhen` condition, and
(v4 only) B10 `iff`: **MATCH on every bar, both timeframes, both versions** (8,473 × 1D,
20,616 × 60m). The v4 probe needed #240's legacy bare-`valuewhen` translation to run at all
(refused on the integration tree without it). Q-B2's question — does v4 carry the v5 rule —
is answered yes, so `implicitBoolCastApplies` keeps v4 and v5.

## Mintick (#238, `pine/mintick`) — value CONFIRMED; the probe's filter is walled elsewhere

D01 `syminfo.mintick` = **0.01 on every bar** for AMEX:SPY, NASDAQ:AAPL and NYSE:BRK.A (the
symbol metadata says `minmov 1 / pricescale 100` for all three, BRK.A at ~$758k included);
D02 base τ = **0.1** (10 ticks). That is exactly the branch's `tick_size` table
(NASDAQ / NYSE / NYSE Arca 1/100).

⚠️ The member door still refuses the probe, **not** on mintick: `dbhf` is a `var` seeded `na`
and reassigned only inside `if`/`else if`, which the translator cannot fold (`pine:state`).
The corpus script's consumer is the runtime lane (per `b39f35495`), so this is a member-door
wall of its own, not a gap in #238. D03 `dbhf` could not be compared through this harness.

## NEW — Q-T1: `time(tf, session, "GMT-4")` on a DAILY chart is always `na` on our side

Found by the bool-cast probes' B07/B08 rows (`t = time(timeframe.period, "0930-1000:1234567",
"GMT-4")`, B08 = `na(t) ? 1 : 0`):

- **60m: MATCH** on all 20,616 bars.
- **1D: DIVERGE**, identically in v4 and v5. TradingView answers `t` = in-session on
  EDT days and `na` on EST days — a daily bar's time is its 09:30 America/New_York open, which
  is 09:30 GMT-4 only under daylight time. Ours answers `na` on every daily bar.
  First divergence bar 45, t=734016600 = 1993-04-05, the first session after the 1993 DST
  change; 5,308 of 8,473 bars disagree (the EDT share), B07 34 scattered (the first EDT bar of
  each year).

So the engine's session membership does not evaluate against the daily bar's open time.
Not fixed here — queued. Any corpus script using `time(…, session)` as a condition on a daily
chart is affected.
