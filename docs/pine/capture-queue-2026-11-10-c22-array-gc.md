# Capture queue: W-C22-DEL, does the collector spare lines and labels held in an array? (2026-11-10)

Branch `fix/pine-c22-withheld-deletes` (r6). Source: review W-C22-DEL r5 NO-GO (`dsk/reviews/W-C22-DEL.md`).
Rails: `app/src/components/chart/engine/__tests__/objectCollectorWithheld.test.jsx`,
`app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.o1Sonarlab.test.js`.
Procedure: `docs/pine/capture-queue-2026-09-28.md`. The owner runs every capture; no builder opens TradingView.
The probe was not compiled on TradingView when it was written. A runtime or compile error is itself a reading:
record its text and the line or bar it names.

The rule for BOXES held only in a `var` array is witnessed (`sonarlab-order-blocks-spy-1d-2026-10-02`: they are
collected like any other box; `objectPool.js` C7). For LINES and LABELS it is not, and the Pine reference states
no container exemption either way, so both lanes withhold the family where the collector reaches one.

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| Q-C22-1 | `tools/visual_conformance/probes/vw-c22-array-gc.pine` rows A00-A02 | AMEX:SPY 1D | whether TradingView's collector spares lines and labels held only in a `var` array (the end state of `line.all` / `label.all` at cap 5) | the host object lane and the runtime lane withhold the line / label family by name where the collector reaches an array-held object (`withheldBy['objects:collector-all']`; the runtime store's "held in an array or a user type") |
