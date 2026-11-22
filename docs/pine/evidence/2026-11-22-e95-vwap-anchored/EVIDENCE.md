# The built-in VWAP served: Pine's anchored `ta.vwap` (train e95, unit 2, 2026-11-22)

Train e95, unit 2. Engine number: NUMBER PENDING (the coordinator numbers the train). Counts and verdicts only: no
licence-held script is named, every TradingView value stays in the local capture store, and TradingView's built-in
source is never committed (it is held locally and named here by its sha256 only).

## The defect

TradingView's built-in VWAP reads `[_vwap, _stdevUpper, _] = ta.vwap(src, isNewPeriod, 1)` inside an `if` block. Both
lanes refused it: the host lane at the destructure (`pine:tuple`, seen by the member as `pine:reassign` on
`vwapValue := _vwap`), the runtime lane at the call (`runtime:call-windowed-state`). Neither lane had an anchored VWAP
at all: only the session VWAP (`ta.vwap`, `ta.vwap(source)`).

## The change

| part | where |
|---|---|
| One accumulator, TradingView's published `computeVWAP`: sums from each bar the anchor fires, `na` before the first, an `na` term poisoning the sums to the next reset; the average and the standard deviation the bands are drawn from | `interpret.js::vwapAnchorAccumulate` (`CARRIED2.vwapAnchorPine` / `vwapAnchorDevPine`, and the columns `FN.vwapAnchor` / `vwapAnchorDev` driving the same step) |
| The table entries (lookback `series`), listed among the names added after saved documents | `closedTable.json` |
| The Python twin, operation for operation | `api/services/ast_interpret.py::_vwap_anchor_col` |
| `ta.vwap(source, anchor)` and the band leg (an internal call with a space in its name, so no script can spell it); a source that is not a bar price is refused by name (the one-argument form's rule) | `pine.js::Resolver.anchoredVwapTree`, `VWAP_DEV_CALL` |
| `[vwap, upper, lower] = ta.vwap(source, anchor, stdev_mult)`: the bands are `vwap ± stdev × mult` | `pine.js::PINE_TUPLE_BUILTINS.vwap` (both lanes take these trees) |
| The runtime lane's own kernel for an anchor or source the run computes | `pineRuntimeFrontend.js::RUNTIME_STATE_KERNELS` (`ta.vwap` arity 1 and 2, the band leg) |
| A hand-added built-in (no Pine in its capture) is graded on its published source, held locally at the full census population's sha256; the row is stamped `sourceHeld`, and a run without the source names it "source-held", never MATCH or DIVERGE (coordinator ruling F1) | `vendorHarness/builtinSource.js`, `ourSide.js`, `storeHeld.js`, `vendorHarness.corpus.test.js`, `tools/vendor_harness/store_held.py` |
| A capture's settings are numbered on the source our side ran; a declaration's `timeframe =` adds TradingView's two trailing inputs ("Timeframe", "Wait for timeframe closes"), dropped at their defaults, refused by name when moved | `vendorHarness/captureInputs.js` |

The held source for `STD;VWAP` is pinned at sha256 `670d21c04b7d81b5ec5dfd0d614386628b8e020a1f2e12514a9ae83b77bb1541`.

## What the member sees

Before: TradingView's built-in VWAP, pasted, did not draw ("a name that is reassigned later cannot be folded").
After: it draws its line and its three band pairs at the Session anchor (its default), matching TradingView on every
compared bar where the chart starts at the symbol's listing.

## Rails and mutants

- `engine/__tests__/vwapAnchored.test.js` (6): both lanes bit for bit against the published body written out by hand,
  the 3-value form, sums from the reset (not the series start), `na` before the first anchor, a computed source
  refused by name, the one-argument session VWAP untouched.
- `tests/test_vwap_anchor_parity.py` (5): the Python twin is the published body bit for bit (RDDT and a 6,000-bar
  synthetic series near 1e4 x 1e8), `na` rules, and JS == Python through `tools/ast_conformance.py`.
- `vendorHarness/builtinSource.test.js` (7) and `tests/test_store_held_source.py` (3): the held source at its pin only,
  the `sourceHeld` stamp, "source-held" naming, the declaration's timeframe pair.
- Mutants `ci/mutants/e95-vwap-anchored.json`, VA1-VA8 (sums never reset after the first anchor, JS and Python; sums
  from 0 so a value is drawn before the first anchor; the runtime kernel dropped; bands from the average; a held
  source at other bytes graded; a moved timeframe setting dropped; a source-held row read as store-held).

## Grade diff (train integration: master + #2465 + #2466 + #2474, before and after this unit)

TradingView's built-in VWAP pasted as Pine, Session anchor (its default): 6 captures (4 symbols, 1D), both lanes
identical.

| | before | after |
|---|---|---|
| captures | 6 INCONCLUSIVE (`pine:reassign`) | **4 MATCH** (7 of 7 plots each), 2 INCONCLUSIVE |

- **0 MATCH lost.**
- The 2 INCONCLUSIVE rows are charts that do not start at the listing: the built-in's own no-volume guard
  (`if barstate.islast and ta.cum(volume) == 0 runtime.error(...)`) reads a running total, which is withheld by name
  there (`running-total:window`), so every plot is. Its refinement (a `cum` of a non-negative series that is above 0 is
  above 0 from the listing too) touches the bar-index mask machinery and is its own unit.

**The 7 event-anchor rows** (`s4-vwap-anchors-retake3-2026-11-21`, Anchor Period = Earnings, Dividends, Splits) are
graded on the held source now (past `pine:character` and the input numbering) and stay INCONCLUSIVE on a named wall:
the anchor is a `switch` on a text input, reduced at translate time to its default arm, so it is no member setting
and the moved setting cannot be set. Serving it is the next unit (a `switch` on an enum input as a live knob, with the
rule that an arm the knob does not pick never withholds or refuses the chart).

CENSUS_AND_GRADE_PENDING

## Findings outside this unit

- The no-volume guard above (`running-total:window` on charts not from the listing).
- A `switch` on a text input is no member setting (above).
