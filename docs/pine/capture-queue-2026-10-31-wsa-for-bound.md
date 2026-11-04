# Capture queue — 2026-10-31 P3 WS-A, the Pine 6 `for` bound (Q-A1)

Branch `feat/pine-p3-wsa`. One new probe, `tools/visual_conformance/probes/vw-v6-for-bound.pine`,
for the parent session to run on the live TradingView rig with `tools/vendor_harness/tv_capture.js`
(same procedure as `docs/pine/capture-queue-2026-09-28.md`).

## What is refused, and why a capture is what lifts it

| refused as | what is unknown |
|---|---|
| `runtime:loop` — "Pine 6 re-reads a `for` loop's `to` bound before every pass, and the body writes `<name>` / changes an array / writes a field / … — not yet captured" | how many passes a v6 `for` runs when its body moves its own `to` bound: grows, shrinks below the counter, counting down; and whether the `by` step is re-read too |

`docs/pine/PHASE3-RUNTIME-PLAN.md` 3.5 / 3.6 item 3. The docs (v6 migration guide, "Dynamic `for`
loop boundaries"; `docs/pine/pine-version-evolution.md` row 60) say the bound is re-evaluated before
every pass. No committed capture witnesses it, so under standing ruling 2 the lane serves only the
case where both rules agree (no pass can move the bound: `pineRuntimeFrontend.js::forBoundMovedBy`)
and refuses the rest by name. v5 and below keep the read-once rule, which is what the lane runs.

Measured 2026-10-31 over the 974 census inputs (direct front-end sweep, master vs branch): the guard
fires on **0** scripts, and no served output changes. A first cut tracked array writes as one heap and
refused `committed:strong-start-rvol-dashboard` (bound reads `toks`, body pushes to `out`); arrays are
now told apart when every binding of both names is a fresh constructor (`isFreshArrayName`), and a
name that can share an array (`b = a`, a parameter, a tuple, a field) still counts as the same array.

## The capture

| # | capture | settles | what it would move |
|---|---|---|---|
| Q-A1 | `vw-v6-for-bound` on AMEX:SPY 1D | L02 (name bound grows: 4 read-once / 6 re-read), L03 (array bound grows: 2 / 6), L04 (bound shrinks below the counter: 4 / 1), L05 (counting down: 6 / 3), L06 (is `by` re-read: 10 / 4) | a per-pass bound in `lowerIr.js` STMT.FOR for v6 (re-lower `to` inside the loop test), after which the `forBoundMovedBy` refusal is lifted |

## Also uncaptured, served on the documented reading (Q-A2, review L3)

| # | shape | what the lane serves | what no capture shows |
|---|---|---|---|
| Q-A2 | a value arm (or a function body) whose LAST line is a `:=`, a compound assignment (`n += 1`) or a declaration (`y = x * 2`) | the value that line bound (the function-body rule, PHASE3 §16, applied in every value position) | that TradingView yields the bound value in a value ARM too, not only as a function's last line |
| Q-A3 | Pine 6 `if` / `switch` in value position with no matching arm whose value is a `bool` | refused by name (`runtime:block-value`, "a v6 bool is never `na`") | the v6 value (documented: `false`); serving it needs a bool type on the value |
