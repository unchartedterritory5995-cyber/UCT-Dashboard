# Capture queue: the last bit of `math.sin` (2026-11-21)

Filed for coordinator patrick-2b by the engine 92 train agent (coordinator ruling after the engine-92 regrade of both
harness snapshots). Probes only: no capture text is committed.

At engine 92 `vw-bi-asin-spy-1d-2026-11-19` grades DIVERGE on one item of nine: A5, the identity residual
`(math.sin(math.asin(0.999y)) - 0.999y) * 1e18`, is 0 on TradingView and -111 / -55 on our side (one ulp) on 123 of
8,511 bars, scattered. `math.asin` itself (A1, every bar, graded exactly) agrees with TradingView bit for bit, so the
ulp is `math.sin`'s or the round trip's. No committed capture grades `math.sin` directly. This row reads it alone;
every argument is a series, so TradingView's compile-time constant folding (Q-CF) cannot enter any row. It decides
between a fix of `math.sin` (engine-versioned) and a per-built-in withhold of `math.sin` by name; `math.asin` and
`math.toradians` are not withheld (their own values match TradingView bit for bit).

Probe runs with its inputs at their defaults, on the chart's own symbol, from the listing. A line that does not compile
is a reading: record the error text and the line. Not live. Read after the close.

Probe sha256 (first 16 hex, of the file as committed): `vw-bi-sin.pine` 0768353dd9dd528b.

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-BI-SIN-a | `tools/visual_conformance/probes/vw-bi-sin.pine` | AMEX:SPY 1D from the listing | no | every plot on every bar | whether `math.sin` agrees with TradingView in the last bit: S1 (a plain sin series, graded exactly), S2 / S3 (vw-bi-asin's A5 round trip and its value), S4-S6 (sin at pi, pi/2, pi/6 built from a series, scaled 1e18), S7 (sin of the asin probe's argument); then a fix of `math.sin`, or a withhold of `math.sin` by name until one |

## Answer (2026-11-22)

Captured 2026-11-21 (`vw-bi-sin-spy-1d-2026-11-21`, promoted with packet 91534afe4ebf), graded on the production lane:
8 of 9 plots MATCH on all 8,512 bars. S1 `math.sin(z)` maxRel 2.21e-16, S3 the round trip's own value 3.90e-16, S7
`math.sin(y)` 2.29e-16, and the S4-S6 amplified constant probes are exact. S2, the amplified round-trip residual, differs
on 123 bars (1.4%): TradingView 0, ours -111.02 = one ulp x 1e18.

So `math.sin` agrees with TradingView to within an ulp, and so does `math.asin`. Only their composition is one ulp off,
on 1.4% of bars, and only an amplified (`* 1e18`) or exact-equality check can see it. **Coordinator ruling: NO engine
change and NO withhold of `math.sin`.** Recorded as the named divergence
`tests/fixtures/vendor/divergences.json::transcendental-composition-differs-by-one-ulp` (status `confirmed`, scoped to
S2-style amplified checks), with this capture as its evidence. A future grade reads an S2-shaped delta of k ulps x the
amplifier against that row, not as a regression. Q-CF (compile-time constant folding) stays for a later engine unit.
