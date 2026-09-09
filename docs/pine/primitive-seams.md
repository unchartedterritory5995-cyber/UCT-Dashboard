# Where a chart primitive may be attached

**Measure it, don't quote it.** The authoritative register is
`app/src/components/chart/engine/__tests__/primitiveGate.test.js` — it derives every
`attachPrimitive` call site from `StockChart.jsx` by source sweep and fails by name on a
new one. This page explains the rule; the test enforces it. Do not restate the list here.

## The rule

There are exactly two places a Lightweight Charts primitive may be attached:

1. **Inside `chart/engine/binder.js`** — the indicator engine's single renderer seam. It
   opens with the lands-dark contract: *flag off ⇒ `sync` returns having made ZERO calls
   of any kind*, proved by `binder.test.js`.
2. **In `StockChart.jsx`, as declared chart chrome** — listed by name with a reason in
   `CHART_CHROME`.

**All new Pine primitives go in `chart/engine/`, behind the flag.** No exceptions.

## Why the chrome stays outside the flag

The ten primitives `StockChart.jsx` attaches today are **not indicator output**. They are
the watermark, session shading on the price and volume panes, swing labels, level zones,
previous-day levels, and the earnings / split / dividend / IPO badges. Every one shipped
before the indicator engine existed.

Putting them under the engine flag would mean that turning the Pine engine off also
removes the watermark and the earnings badges from every chart in the product. That is not
what the lands-dark contract promises. **It is a promise about the indicator engine, not a
promise that nothing draws.**

## What the gate actually protects

The drawing layer R2 builds is roughly a dozen more primitives. The cheapest way to lose
the lands-dark contract is to attach one of them next to the watermark, because that is
where the existing examples are — and it would look right in review, because the file is
full of neighbours doing exactly that.

The gate fails by name in that case, and it has been seen to fail: a planted
`pineBoxPrimitiveRef` attach site was reported by name, and a planted dead register entry
was reported by name in the other direction. A register that only fails one way rots into
fiction; a gate nobody has watched fire is not a gate.

## The two seams, and the one that should close

`binder.js` describes itself as *the only file in the engine that touches
lightweight-charts*, and within `engine/` that is true and now tested. The chrome
primitives live one directory up in `chart/`, outside that contract. That split is
deliberate for the chrome — but it means **an engineer reading the codebase sees two
patterns and no signpost saying which one applies to them.** This page and the gate are
that signpost.
