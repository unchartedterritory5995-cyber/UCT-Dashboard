# Capture queue — 2026-10-02 O1, drawing-only scripts (Q-O1a, Q-O1b)

Branch `pine/o1-drawing-only`. Same procedure as `docs/pine/capture-queue-2026-09-28.md`
(visibility gate, **Create new ▸ Indicator**, "Add to chart" binding gate, `__uctVH.capture({...})`,
chunks, `verify_capture.mjs --assemble`). Nothing O1 serves is waiting on these captures; they turn
arguments from Pine semantics into vendor rails.

## What O1 serves, and what grades it today

**G7** — `[x =] cond ? f(…) : na`, a drawing helper as the THEN arm of `?:` whose ELSE arm is `na`
and whose bound value nothing reads, is read as `if cond` + `f(…)`. Argued from Pine: `?:` runs only
the arm it picks (witnessed for a value read by
`options-max-pain-calculator-backquant-rddt-1d-2026-09-28`, C18), and takes the ELSE arm on an `na`
test (RT1's two captures), which is what `if` does with `na`. The same equivalence
`emitTernaryCreate` already carries for a built-in `<family>.new`. Rails:
`ast/o1DrawingOnly.test.js` (same program, two spellings; four refusals kept),
`vendorHarness.o1FibRetracement.test.js` (`fib-retracement` on NYSE:RDDT 1D vendor bars, every
object held to its Pine semantics computed independently from the bars — NOT a capture of the
script).

## The captures

| # | capture | settles | what it would move |
|---|---|---|---|
| Q-O1a | `tools/visual_conformance/probes/vw-ternary-draw-helper.pine` on NYSE:RDDT 1D (from the listing) | T01: one label per UP bar from a helper in a ternary arm (labels, count and ids); I01: the `if` spelling on DOWN bars beside it; T02: a `var`-line helper called every third bar holds ONE line, at the last third bar; T03: a bare ternary statement under a test that is `na` on bar 0 draws nothing there | G7 graded by the vendor for helpers, not only for `<family>.new` |
| Q-O1b | `corpus/committed/fib-retracement__8XcLscnekw.pine` on NYSE:RDDT 1D, twice: default inputs, and `Show 0.886 and 1.113 Fibs` ON | default: 7 lines + 7 labels (the ternary calls never run); ExtraFibs on: 8 + 8 (`Fib886` / `LFib886` run), the 1.113 pair still absent (`FIBS == 1`) | the first member-door script O1 attached gets a vendor verdict (objects family MATCH / DIVERGE) |
| Q-O1c | `corpus/committed/sonarlab-order-blocks__0df0d45ee6.pine` on NYSE:RDDT 1D (from the listing) and AMEX:SPY 1D | the boxes TradingView holds: 5 on RDDT by the engine and by `vendorHarness.o1Sonarlab`'s step-by-step reference; and `sens = input.int(28)` / `sens /= 100` read as 0.28 (an `int` taking a fractional `/=` is not witnessed — at 0 the RDDT picture is unchanged, the AAPL and BRK.A ones are not) | G2a + G2b graded by the vendor; the int-division reading settled |
| Q-O1d | `auto-trendline-dojiemoji__c21f83602c.pine` and `pa-zigzag-fibonacci-fan__2001.pine` on NYSE:RDDT 1D | G8's two attaching scripts: their plots (and the first one's trendlines) against TradingView, beyond "equals the two-line spelling" and pa-zigzag's host = runtime agreement | the two G8 attaches graded |
