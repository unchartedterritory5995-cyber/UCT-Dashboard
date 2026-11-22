# Legacy semantics (B1, B2, B3, B5, B7): `n`, v1 `barssince`, the ytc chain, version-aware object defaults, two runtime gaps

Branch `fix/pine-engine-legacy-semantics`, cut from `origin/master` `fc6dea95ce` (engine 55), master `d067c1c1b8` (engine 57) merged in. Engine-output
change: `SCRIPT_ENGINE_VERSION` takes master + 1 at merge; until then the branch keeps 55 and the history
line says NUMBER PENDING. B4 (the colour reader) is on its own branch, `fix/pine-engine-colour-reader`,
stacked on #1330 (engine 58), because it builds on that PR's palette work and #1330 is not merged.

## B1 — `n` is the bar index in v1-v3

**Witness.** S17 captured our probes `vw-ternary-arm-legacy-v1/v2/v3` and `vw-cs2-bool-na-v1/v3`, which
read the bar index as `n`; S18 re-took them with `cum(1) - 1` in its place (`-cum`). TradingView's
columns are identical bar for bar (the rail asserts it for the ternary probes). All ten captures and
probes are committed here, byte-equal to `data/pine-captures-s13-s14` `7f82fba3f1`. Every `n` probe was
refused `pine:undefined`; the v3 reference names `n` "Bar index", v4 renamed it `bar_index`.

**Change.** `pine.js::legacyBarIndexTokens`, applied once inside `lexPine` (the lex both lanes read), turns
every bare `n` into the `bar_index` token in v2/v3 and in a pragma-less source that declares `study(`
(`pineV1Declared`: v1; the formula box declares nothing and keeps its vocabulary). A script that binds its
own `n` (assignment, `:=` or a compound assignment, a function parameter, a `for` counter, a tuple part)
is left alone. A dotted `x.n` is one token and never touched. The Python lane interprets the trees the
translator makes, so it reads the `barindex` leaf with no change of its own.

**Measured.** Host lane: the three ternary `n` probes draw every column with 0 mismatches against
TradingView, equal to their `-cum` re-takes. `vw-cs2-bool-na-v1/v3`: the `n` and `-cum` probes draw the
same columns on both lanes, and the bar-index control is TradingView's on both (the remaining
`bool-na` mismatches are the same with `cum(1) - 1` and are not this change's: PROBES-NEXT item 9). The
runtime lane still declines the ternary probes (`runtime:conditional-history`, the COND-TA hold, owned
elsewhere).

## B2 — v1's one-argument `barssince(condition)`

**Witness.** S18 `vw-ternary-arm-legacy-v1-cum` (no pragma, `study(`), column `E_barssince`. The v1
reference: `barssince(condition)`, one parameter. The engine routed a bare one-argument `barssince` to
Pine's unbounded count for v1-v4 sources with a pragma only; a pragma-less source was read as the formula
box and refused `pine:arity` ("barssince was given 1 argument").

**Change.** The Resolver carries `pineV1` (the lex's `v1Declared`, all three Resolver construction sites
of `translatePine` and both of the runtime front end), and the re-route asks it too. `pineVersion` stays
`null`, so every other rule that reads `null` as the formula box is unchanged. The formula box's
`barssince(cond)` still refuses `pine:arity` (rail).

**Measured.** `E_barssince`: 0 mismatches over 666 bars, the count reaching past any capped window.

## B3 — G7, ytc-swing-highs-lows bar 46: a function's history inside a block, by version

**Witness.** Our probe `vw-fn-history-in-if` (committed at v2, v3, v4 and v5 with its four captures,
NYSE:RDDT 1D from the listing): `f2() => high[2]` and `f1() => high[1]` called only in an `if` every
third bar, with the three candidate readings plotted beside them (`high[2]` EVERY BAR, `high[3]` CARRY,
`high[6]` SKIP).
- s22 v3 and s23 v2: **CARRY** on 221 of 221 call bars. The function keeps its own copy of `high`; the
  copy advances every bar and repeats its last value on bars the call does not run. Before the first
  call it has no history: `na` at bar 2, where the chart has a value.
- s23 v4 and s22 v5: **EVERY BAR** on 222 of 222, the chart's own history, what this engine always read.
- s24: v1 cannot express an `if` at all (TradingView: "no viable alternative at input 'if'"), so the
  map is final: v2 and v3 CARRY, v4 and v5 EVERY BAR, v1 not applicable.
- s24 `vw-fn-history-in-tern-v1` / `-v3` (committed): the same calls in a TERNARY arm
  (`a = t ? f2() : 0.0`) read EVERY BAR at v1 and at v3, 222 of 222 each. A ternary arm is not a block;
  CARRY is a property of calls inside an `if` block at v2/v3 only.

The original evidence (scratch only, the ytc script is licence-held): S18 `vw-ytc-bar46-decompose-cum`
and the original script's two captures (run store s4 / s1). TradingView marks a swing high at bar 46
that no lane drew; a local simulation found every reading but CARRY leaves that one bar wrong, and CARRY
leaves none. The probe was written to settle it on 222 bars, and it did.

**Change.** `pine.js::chartOffsetFunctions` names the top-level functions whose body reads a chart series
(`open` … `ohlc4`, not bound by the function) at an offset; `callsInBlocks` finds the first call to one
inside an `if` / `else` / `for` / `while` / `switch` block. At v2 and v3 (`CARRY_VERSIONS`):
- the runtime lane rewrites each such function (`legacyCarryStatements`): the series becomes a body
  local (`__uct_carry_high = high`, then `:=` so it is a slot, not a macro) and the offset read reads it.
  A body local's history belongs to its call site and holds on the bars the site does not run (the VM's
  held cell), which is CARRY exactly, and a site called every bar sees the chart's series unchanged;
- the host lane reads every bar and cannot keep a per-site copy, so it refuses
  `pine:fn-history-in-block` by name, naming the call.
At v1 both lanes refuse a block call by the same name (TradingView does not compile one). A call in a
ternary arm is never rewritten (`callsInBlocks` sees blocks only), so both lanes read it every bar at
every version. One function called both in a block and in an arm at v2/v3 would need two readings of
one body; that mix is not captured, and the runtime lane refuses it by name
(`callsInConditionalArms`, after a `?` or inside `iff(`; the host lane already refuses any v2/v3 block
call). v4+ is unchanged on both lanes.

Also fixed on the way, because the rewrite reached it: `runtime/ir.js` validated a function body's
`HIST` slot against the TOP-LEVEL frame rather than the body's own (frame-relative, through the call
site's `historyBase`); a body local's history read in a second function failed validation. The bug was
reproduced at v5 before the change.

**Measured.** Runtime lane: all seven columns equal TradingView on all 666 bars at v2, v3, v4 and v5,
and on both s24 ternary captures (`vendorHarness.b3FnHistoryInBlock.test.js`). Host lane: v4, v5 and
both ternary captures all seven columns; v2 and v3 refused by name. Mutants, 6 of 6 killed: CARRY
dropped (every bar read at v2/v3), v2 removed from `CARRY_VERSIONS`, the host refusal widened to v4,
v1 let through, the block-and-arm guard removed, a ternary arm counted as a block. The ytc decomposition (run store, `max_bars_back` stripped, S1: it changes nothing) on the
runtime lane: CHAIN 0 mismatches over 666 bars, bar 46 = 1.

## B5 — every object default colour is a name, at the script's version

**Witness.** `inside-bar-boxes-rddt-1d-2026-11-14` (committed; //@version=4; `box.new` sets `bgcolor`
only): all 52 borders are `#2196F3`, v4's `color.blue`. We drew `#2962FF` (v5/v6 blue) because
`objectRenderState.js::OBJECT_DEFAULTS` spelled each default colour as a hex for every version. The
script draws in the runtime lane (the host lane refuses it `pine:reassign`).

**Change.** `objectDefaults.js::NAMED_OBJECT_DEFAULTS` states each default by its Pine NAME (line / label
`color.blue`, label text `color.white`, box border `color.blue`, box fill and linefill `color.blue` at 80
transparency) and `namedObjectDefaults(version)` resolves them through `pinePalette.js`, the one palette.
`OBJECT_DEFAULTS` is that resolution at the base (v6), so its exported spellings are unchanged; a rail
asserts no hex is typed in it any more. `objectDefaultsFor(version)` lays the names at the version under
the witnessed per-version slots (C37's `VERSION_DEFAULTS`, unchanged). Only v4 moves (v4 is the one
drawing version whose `color.blue` differs): border, line, label (already witnessed), and the box fill /
linefill hue.

**Measured.** Runtime lane (`VITE_PINE_RUNTIME_PANE_ENABLED`): every paired border agrees by the version's
default (`agreeByDefault`, 0 differ); with the version resolution reverted the rail goes red.

## B6 — "we draw where TradingView errors": MEASURED, NOT REPRODUCED ON MASTER

s20 recorded two of our probes as errors on TradingView: `vw-hs3-matrix-degenerate` (RE10074 on bar 0 at
`matrix.fill` of a 0x3 matrix) and `vw-w6-matrix-members` (CE10123, `na()` of a v6 `bool`). Through the
harness with the runtime pane on, master `fc6dea95ce` draws neither: the first stops at R01 (`matrix.row`
of a 2x0 matrix, the W6-M1 named stop), the second at V01 (`matrix.min` over an `na` cell, W6-M1), and the
run draws nothing, as TradingView does. Both are refused by name today, with the W6-M1 sentence rather than
TradingView's own error text. Not changed here.

## B7 — two runtime-lane gaps (s20)

- `vw-array-na-rddt-1d-2026-11-15` (our probe, committed here): the run computed all thirteen columns, but
  the member door skipped N01-N05 because the HOST had hidden them as `hiddenReason: 'constant'` (they read
  no bar). That is the host's screening judgement, not the author's; TradingView draws each line. The
  runtime door now carries a `constant` row (an author-hidden row is still skipped): all 13 columns equal
  TradingView on all 666 bars (`vendorHarness.b7RuntimeGaps.test.js`).
- signal-follow-through-ledger, AMEX:SPY 1D (s20, the corpus script's capture stays in the run store): the
  run stopped at its last bar on `array.median` over 161 whole bar counts (`provablyFloat`), where
  TradingView prints "15". An odd count's median is one of the array's elements, so no fraction is turned
  into an int: served. An even count still stops by name (`w6ArrayMembers.test.js`).
- Mutants: the door's `constant` exception removed, the median's `provablyFloat` restored: 2 of 2 killed.

## Rails and mutants

- `__tests__/vendorHarness/vendorHarness.legacySemantics.test.js` (B1, B2): the lex cell by cell
  (v1/v2/v3 rewritten, v4/v5 and the formula box not, five shadowing shapes not, dotted names not); the
  ternary `n` probes on the host lane, 0 mismatches and equal to `-cum`; TradingView's two takes equal;
  v1 `barssince`; the formula box keeps `pine:arity`; bool-na `n` equal to `-cum` on both lanes.
  Mutants, 6 of 6 killed: v3 excluded, `=` shadowing ignored, parameter shadowing ignored, v1 never
  declared, the v1 re-route dropped, the rewrite dropped.
- `__tests__/vendorHarness/vendorHarness.b5ObjectDefaults.test.js` (B5): the capture's 52 borders; the
  defaults by version; no hex in `OBJECT_DEFAULTS`; the runtime lane's borders. Mutant (the version
  resolved at the base) killed.

- `__tests__/vendorHarness/vendorHarness.b3FnHistoryInBlock.test.js` (B3): the six captures are our
  probes; TradingView's own columns (CARRY at v2/v3, EVERY BAR at v4/v5 and in ternary arms); the runtime
  lane on all seven columns x 666 bars at v2-v5 and both ternary captures; the host lane at v4, v5 and the
  ternary captures, refusing v2/v3 by name; v1 block calls and a block-plus-arm mix refused by name.
  Mutants, 6 of 6 killed (listed under B3). 25 tests.
- `__tests__/vendorHarness/vendorHarness.b7RuntimeGaps.test.js` (B7) and `runtime/__tests__/w6ArrayMembers.test.js`:
  mutants 2 of 2 killed (listed under B7).
- `__tests__/vendorHarness/vendorHarness.c37ObjectColours.test.js` (unchanged rail, kept green): v1-v3 and
  unknown versions stay at the base palette; it went red on the first B5 cut (v3 resolved at its own
  palette) and B5 now resolves names only at v4-v6.

## Tests run

Branch head before this record: `f9240dcc1e` (origin/master `d067c1c1b8`, engine 57, merged in).

- Part B sweep (the legacy-affected engine files, `builder/memberPane`, the B-rails and C37), sharded 3
  ways, `--maxWorkers` per the RAM rule: shard 1 34 files / 645 passed (3 skipped), shard 2 34 files /
  1213 passed (1 skipped), shard 3 35 files / 890 passed. 0 failed.
- Python: `test_queue_dispositions`, `test_evidence_engine`, `test_ast_conformance`, `test_ast_interpret`:
  231 passed, 5 skipped.
- `evidence_engine.py queue --check`: PASS.
- ytc decomposition (run store, licence-held, scratch only): runtime lane 17 of 17 columns 0 mismatches,
  CHAIN bar 46 = 1; host lane refuses `pine:fn-history-in-block`.

**Not run here (the landing train's, by the coordinator's process):** the before/after census and the
vendor harness run, `SCRIPT_ENGINE_VERSION` (this branch keeps master's 57 and the history line says
NUMBER PENDING), host parity `--write` / `--check`, the service smoke re-record, and section 8.

