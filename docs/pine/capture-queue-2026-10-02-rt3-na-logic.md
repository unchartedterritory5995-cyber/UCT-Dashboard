# Capture queue — 2026-10-02 RT3, `or` / `not` over an `na` operand (v4, v5)

Branch `pine/rt3-runtime-walls`. One new probe
(`tools/visual_conformance/probes/rt3-na-logic.pine`, never compiled), for the parent session to run
on the live TradingView rig with `tools/vendor_harness/tv_capture.js` — same procedure as
`docs/pine/capture-queue-2026-09-28.md`.

## Why

RT3 reads an `na` CONDITION as false from v4 (`interpret.js::pineBool`, `naConditionIsFalse`): a
`?:` test and an `if` take the else branch, as the two committed v4 captures show (`qqe-signals`,
`pivot-point-supertrend`, RDDT 1D). What no capture separates is the v4/v5 LOGICAL operators over an
`na` operand:

- `na or true` is `true` if Pine reads the `na` operand as false, and `na` (so false wherever it is
  tested) if a v4/v5 bool carries `na` through `or`;
- `not na` is `true` under the first reading and `na` under the second.

`and` needs no capture: either reading gives a value every condition reads as false. So the runtime
lane keeps the shared eager `logical` for v4/v5 and COUNTS an `or` / `not` over an operand it cannot
prove is 0/1 (`lowerIr.js::naTestsOf`); the member door declines such a script by name
(`runtime:na-test`). The one corpus script on that row is `cc-yata` (v5; its own RDDT 1D capture
grades identically under both readings, so it cannot settle the rule). v6 is settled without a
capture: its bools are never `na`.

## Q-NL

| # | capture | settles |
|---|---|---|
| Q-NL-a | `rt3-na-logic.pine` as written (v5), NYSE:RDDT **1D**, full history, market closed | v5: `or` / `not` over an na bool and an na number |
| Q-NL-b | line 1 `//@version=4`, `indicator(` → `study(`, `ta.sma(` → `sma(` | v4 (float truthiness era) |

Read, on bars 0..18 (where `warm` and `w` are `na`): rows `B01`, `B02`, `B06`, `B07`, `B08`, `B09`,
`B10` are `1` if the `na` operand reads as false and `2` if `na` propagates through the operator;
`B04` / `B05` are `1` exactly when the result itself is `na`. `B00` and `B03` are controls (`B03`
must be `2` on bars 0..18 under either reading). From bar 19 every row has a real operand.

## What lands when it is captured

If both versions read the `na` operand as false: drop the `or` / `not` count for v4/v5 in
`lowerIr.js` (the BINARY and UNARY arms), coerce the operands with `asCondition` as v6 already does,
and re-pin `naCondition.test.js` and `vendorHarness.rt1RuntimeFallback.test.js` (cc-yata then
reaches its next wall). If `na` propagates: keep the shared `logical`/`!` for v4/v5 and drop the
count (the propagation is then this engine's answer too). Either way the decline goes away.
