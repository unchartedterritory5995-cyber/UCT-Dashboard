# The built-in VWAP served: Pine's anchored `ta.vwap` (train e95, unit 2, 2026-11-22)

Train e95, unit 2. Engine number: engine 95 (the coordinator numbers the train). Counts and verdicts only: no
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

## The hazard ruling (coordinator, 2026-11-22): an anchored VWAP is its own class, never a running total

The table declared both entries `lookback: "series"`, which made them running totals
(`barIndexShift.js::RUNNING_TOTAL_CALLS`). Two consequences, both wrong for a VWAP:

- off the listing the whole VWAP was withheld, named `running-total:window`, whose sentence ("adds up every bar since
  the first bar of the symbol's history") is false of it;
- it fed the additive-constant algebra (`ORIGIN_ATOM`), which would serve `vwapAnchor - vwapAnchor[n]` as if an unseen
  constant cancelled.

The truth: after the first anchor INSIDE the chart's window the sums reset, so every later bar is exact and does not
depend on how much history is loaded. Only the bars before it are unknown (TradingView carries a total from an earlier
anchor there; on a Session anchor that is the first partial session).

| part | where |
|---|---|
| The anchored sums are their own class, read off the manifest's own roster: out of `RUNNING_TOTAL_CALLS` and out of the additive-constant algebra (the pass reads them as any other call, fixed while their arguments do not move) | `barIndexShift.js::ANCHOR_RESET_CALLS`, Python twin `ast_bar_index_shift.ANCHOR_RESET_CALLS` |
| A requirement tag with a true sentence: `anchor_dependent` (accepted by the pane, refused by the screener, the sweep, an alert, a share and a listing, as every `series` entry must be). Not `window_dependent` (its sentence says every value moves with more history) and not `occurrence_dependent`; no pane badge (the per-bar withholding already says it on the chart) | `closedTable.json::_requirement_tags.anchor_dependent` |
| Off the listing, the bars before the first bar the anchor fires on this chart are withheld BY NAME, PER BAR (`vwap:before-first-anchor`), with every bar that reads them within the tree's reach, or every later bar under a value kept for good; it fails closed (every bar) under another series' request or over a recurrence's own value. ⛔ The anchor is read AS THIS CHART CAN KNOW IT (every mask applied): the built-in's own `na(src[1])` restart is true on this chart's bar 0 and false on TradingView's, so it is no known reset, and the bars until the first known anchor are withheld (found while building this rail: read raw, the built-in summed from bar 0 off the listing). From the listing nothing is named (TradingView is `na` there too) | `interpret.js::builtinWitnessMask` (`BUILTIN_WITNESS_CODES`, `firstAnchorBar`), Python twin `ast_interpret.builtin_witness_mask` |
| The code is a per-bar one (`PER_BAR_CLOCK_CODES`): the headless lane computes the script and the vendor harness grades those bars "not compared"; its sentence: "the VWAP starts at the first anchor shown on the chart" | `interpret.js::VWAP_BEFORE_FIRST_ANCHOR`, `CHART_CLOCK_WITHHELD` |
| The runtime lane: its warm-up curtain (two starts) already withholds those bars per run; a column the columnar lane blanks whole by the code declines by the same name | `pineRuntimeFrontend.js::BUILTIN_WITNESS_REFUSALS` |
| A screen that spells the table name itself is refused with the tag's own sentence | `pine.js::PINE_INEXPRESSIBLE.vwapAnchor` / `vwapAnchorDev` |

Rails (`vwapAnchored.test.js`, 7 more; `tests/test_vwap_anchor_parity.py`, 5 more): a chart starting mid-history is
served from its first in-window anchor bit for bit (the average and each band), the bars before it withheld by name in
the per-bar channel and never whole; `nz(vwap)` is withheld there, never drawn as 0; `nz(v) - nz(v[5])` reads no
running total, is withheld until its read reaches the anchor and is exact after; from the listing nothing is named;
the sentence is true and is not the running-total one; an anchor this chart cannot read on its first bar (the built-in's
`na(src[1])` restart) is no reset. Mutants VA9-VA14: put it back among the running totals (JS, Python); serve the bars
before the first anchor (JS, Python); read the anchor raw (JS, Python); VA15: the bar-index mask carries a threshold
forever under an anchored sum again.

⛔ **Found through the member door, and fixed in this unit:** the built-in's own `na(src[1])` restart is `isfirst` on the
host lane, a `bar-index:first-bar` threshold, and `barIndexMask` carried it FOREVER under any `series`-lookback call, so
the built-in drew NOTHING off the listing (600 of 600 reference bars blank). An anchored sum's memory ends at its next
reset, so the mask no longer carries a threshold past it (both lanes); the bars before the first known anchor are the
VWAP mask's. The built-in's shape on the reference daily bars now draws 598 of 600 bars, each its bar's hlc3 (rail:
`vwapAnchored.test.js`, "the built-in shape off the listing").

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

## Census and grade (the train before this unit vs the train with it: master + #2465 + #2466 + #2474, both lanes)

Measured after the hazard ruling and both fixes it surfaced (the known anchor, the bounded bar-index mask), local,
under the heavy lock.

**Census** (the 37 corpus rows that call `ta.vwap` with more than one argument, member door):

| lane | served in full | attached | refused |
|---|---|---|---|
| production | 1 -> 3 | 0 -> 3 | 36 -> 31 |
| runtime-on | 1 -> 3 | 0 -> 4 | 36 -> 30 |

**0 served -> refused, 0 attached -> refused, on either lane.**

**Grade diff** (25 VWAP captures; production lane):

| | before | after |
|---|---|---|
| verdicts | 25 INCONCLUSIVE | 4 MATCH, 2 DIVERGE, 19 INCONCLUSIVE |

- **0 MATCH lost.**
- TradingView's built-in VWAP at its default (Session) anchor, 6 captures on 4 symbols, 1D: **4 MATCH** (all 8 items
  each), and the 2 rows that the earlier grade left INCONCLUSIVE (charts the hazard ruling was about) now compare
  **every compared bar equal** (14,544 and 8,507 bars, every plot), with 1 bar per plot withheld by name and not
  compared; they stay INCONCLUSIVE only for that bar. The built-in's no-volume guard (`ta.cum(volume) == 0`) does not
  withhold them.
- **2 rows move INCONCLUSIVE -> DIVERGE, and the divergence is the EVENTS supply, not the VWAP.** UCT's own probe
  `vw-data-vwap-anchors` (AAPL 1D, JPM 1D), refused whole before (the 2-argument `ta.vwap`), now draws: the
  Splits-anchored VWAP MATCHES (9,930 bars, AAPL), the Dividends-anchored one agrees on every compared bar (3,592 and
  5,759) with the rest withheld by name, and the Earnings-anchored one diverges because ITS ANCHOR does: the probe's
  own plot of the earnings anchor bar (`not na(request.earnings(...))`, no VWAP in it) differs from TradingView on 12
  scattered bars on each symbol (AAPL: TradingView 1 / ours 0; JPM: TradingView 0 / ours 1), consistent with a report
  placed on the neighbouring daily bar. Those 12 anchors carry into 473 (AAPL) and 368 (JPM) VWAP bars. This is the
  E2 event engine's daily placement (#2465), seen now because the probe translates: named for the coordinator.
- **Runtime-on lane** (the 21 non-strategy VWAP captures, train before vs after, local under the heavy lock; the 4
  strategy captures stop this harness on its own guard, "STRATEGY BROKER NEVER RAN", and are graded on the
  production lane above): 21 INCONCLUSIVE -> **4 MATCH, 2 DIVERGE, 15 INCONCLUSIVE**, row for row the production
  lane's moves. **0 MATCH lost.** The same 4 built-in captures MATCH (all 8 items each); the JPM built-in row compares
  every compared bar equal (14,544) with 1 bar per plot withheld by name; the 2 DIVERGE rows are UCT's own probe and
  diverge on the EARNINGS anchor only (AAPL: 473 VWAP bars from 12 earnings-anchor bars placed on a neighbouring
  daily bar; the Splits VWAP MATCHES, the Dividends one agrees on every compared bar), E2's named placement, not the
  VWAP. The 60m probe is refused by name intraday (`other-symbol:event-timeframe`).

**The 7 event-anchor rows of the built-in** (Anchor Period = Earnings, Dividends, Splits) stay INCONCLUSIVE on a named
wall: the anchor is a `switch` on a text input, reduced at translate time to its default arm, so it is no member
setting and the moved setting cannot be set ("Anchor Period" is not a setting of our document). Serving it is unit 2b.

## Findings outside this unit

- The earlier draft named the built-in's no-volume guard (`ta.cum(volume) == 0`) as what kept 2 rows INCONCLUSIVE.
  Measured after the ruling it is not: those rows compare every compared bar equal. (What did blank the built-in off
  the listing was `isfirst` carried forever under the anchored sum, fixed above.)
- The E2 daily earnings placement (12 anchor bars on each of AAPL and JPM 1D, above): for #2465.
- A `switch` on a text input is no member setting (above): unit 2b.
- (4a) On bar 0 the host lane draws `timeframe.change(...)` as `na` where the run draws 0 (named in #2474's evidence;
  not changed here). For an anchor it is the safe side: an unknown anchor is no known reset.
- (4b) `var int len = input(14)` builds on the runtime lane in isolation; 5 corpus rows declare a `var` numeric input,
  to be measured through the member door.
- (4c) The 60m earnings probe's `time_close` reads `na` (a capture-side observation; the E2 event engine refuses
  events intraday, so no served value depends on it today).
