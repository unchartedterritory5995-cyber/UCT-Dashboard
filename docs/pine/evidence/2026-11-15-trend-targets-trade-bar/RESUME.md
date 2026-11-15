# RESUME: trend-targets-algoalpha, the last trade drawn 3 bars late (PARKED 2026-11-15)

Branch `fix/pine-runtime-object-history-delete`. Parked for a PC restart. The cause and the
fix are proven on the two captures. The engine-number steps and the corpus before/after are NOT done.

## The bug (TradingView capture, NYSE:RDDT 1D from the listing, 666 bars, 2026-11-15)

On the runtime pane, the last trade's 5 lines and 5 labels stood at bar 656 with
"Entry ▸ 90.97" / SL 143.72. TradingView draws them at bar 653 with "Entry ▸ 134.70" / SL 175.70.
Every plot agreed, the trend-change shapes included. SPY 1D (8,507 bars) MATCHED.

## The cause (proven)

It is NOT the `line.delete(x[1])` / `line.set_x2` blocks, and NOT object ids. The per-bar run
draws this trade at 653 too: `runtime/objectLane.js::buildObjectLane` + `runObjectLane` gives
x1 653 and y 134.7.

- The runtime document (`memberPaneDefinition.js`, the runtime branch, `meta.lane: 'runtime'`)
  carries the HOST's object program (`objects: drawsObjects ? t.objects : null`). The run cannot own
  these drawings: `str.tostring(…, format.mintick)` on a mutable value refuses
  `runtime:call-text-state` in the objects-in-run build.
- So `ourSide.js::hostObjectsOf` → `objectColumns.js::objectReaderFor` evaluates that program's guard
  trees with the columnar `interpret`.
- The runtime document's `meta` lacked the Pine door's tree stamps: `recurrenceOrigin: 'pine'`,
  `pineVersion`, `doorVersion` and `naConditionFalse`. The `ast` document has them.
- With no stamp, `nativeRegistry.historyFromListingFor` and `varOriginAbsoluteFor` both answer false.
  Every `var` in the trees therefore ran as `accum(…, 250)`: a 250-bar window re-seeded on each bar,
  on the listing as off it, and no var-origin mask withheld anything.
- `trend` is a `var` latch over `ta.crossunder(tL, tL[1])`, and `tL` smooths a supertrend whose bands
  are recurrences. The windowed guards were therefore wrong:
  - `shortSignal` fired on 432 and 656, never on 653;
  - `longSignal` fired on 524 only and missed 310.
- TradingView's own bar colours put the flips at long 310 / 524 and short 432 / 653.

## The fix (in this branch)

`memberPaneDefinition.js::pineTreeStamps(t)` is one function that writes the four stamps. Both
documents use it:
- the `ast` document's meta, where the output is byte-identical: same keys, same order;
- the runtime document's meta, only when it carries the host program (`drawsObjects`).

With the stamps on RDDT, the guards fire long 310 / 524 and short 242 / 432 / 653. Bar 242 is the
first `trend` 0 → -1, before any colour change. The drawn trade equals TradingView's on both
captures: x1, x2 and y on all 5 lines, x, y and text on all 5 labels.
- RDDT: x1 653, x2 705.
- SPY: x1 8139, x2 8546.

## Rails (in this branch)

- `app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.trendTargetsTradeBar.test.js`
  has 7 cases:
  - geometry and texts against TradingView on both captures;
  - the whole capture grades MATCH on both;
  - the runtime document's meta equals `pineTreeStamps(t)`;
  - ⛔ a CONTROL: the same document with the stamps stripped opens the short on 656 and not on 653.
- The captures are committed as byte copies of the s28 run (sha256 a150988d… / 3e637c8b…), and
  `verify_capture.mjs` gives PASS. Licence MPL-2.0, so they are commit-eligible.
- On master (engine 57, unfixed) the rail is red with 4 failing cases.
- Mutant: I deleted only `...(drawsObjects ? pineTreeStamps(t) : {})` and the same 4 cases went red
  (656 vs 653, DIVERGE, meta.recurrenceOrigin undefined, [432, 656]). I restored the file from a saved
  copy, and `cmp` reported it byte-equal.

## Also done

- `tests/fixtures/runtime_documents/documents.json` was re-written on purpose with `RF_WRITE_FIXTURE=1`.
  The diff is exactly the four stamps, on the 2 of the 6 runtime documents that carry a host object
  program. After the re-write, `runtimeDocumentRoundTrip.test.js` gives 5/5.
- `vendorHarness.rt1RuntimeFallback`, `editorStatus` and `ConverseBox.p3ux` are green.
- `tests/test_runtime_document_round_trip.py` and `test_share_privacy.py` are green.
- `test_share_strips_run_reads.py::test_EVERY_route_is_classified` is red. It compares the router's
  route set and does not read this change's fixture. That points to a red already on master, but it is
  NOT confirmed on master yet: check it there.

## LEFT TO DO (in this order)

1. Corpus before/after, both lanes, over `tests/fixtures/vendor/harness`. Run the base under the heavy
   lock first; this session never got the lock in time. The change can only move runtime documents that
   carry a host object program (runtime-on lane). The production lane mints no runtime document, and the
   `ast` meta is byte-identical. Measure it anyway.
   - A faster first pass: a door census over every committed capture source (`memberPaneDefinition`, pane
     on and off, hash of the definition) to list which documents change. Then grade only those, before
     and after. A draft of that census was in scratch and is not committed.
2. Focused suites: `builder/memberPane/**`, `vendorHarness.rt1RuntimeFallback`,
   `runtimeDocumentRoundTrip`, and the editability sentence (`memberWords.conversationEditability` now
   says "imported" for a runtime document with host objects). Check the server: `decide_semantics` no
   longer stamps semantics 2 on such a saved runtime document. That is correct for Pine trees; note it in
   the PR.
3. ENGINE NUMBER, assigned at push = master + 1. Master was 57 at 22:15Z; open PRs claim 58. Steps:
   - add the line to `scriptEngineVersion.js`; the draft text is in the PR body;
   - `node tools/pine_runtime_host_parity.mjs --write`, then `--check`;
   - service_smoke re-record per commit 3ce7585ee3, using the launcher copy (`recordN.py`, REPO = this
     worktree, env PORT + throwaway secret + SYSTEMROOT only);
   - gate section 8 pytest list and `node --test services/pine_runtime/test/*.test.mjs`;
   - `evidence_engine.py regrade` after the bump (LICENSING.md 2c).
4. Saved runtime documents minted before this fix still lack the stamps. Decide whether the load path
   should upgrade them (`memberDocumentMigration` / `savedScriptUpgrade` covers only `kind: 'ast'`), or
   derive the Pine origin from `meta.lane === 'runtime' && meta.runtimeLanguage === 'pine'` in the
   readers.
