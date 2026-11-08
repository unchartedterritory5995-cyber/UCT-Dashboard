# HONESTY-SWEEP: behaviour master served unbacked (desktop, 2026-11-07)

Branch `fix/pine-honesty-sweep-2026-11-07`, base `origin/master` @ `f38b65c55f`. Source: PR #938's "Unbacked served
behaviour" list. Rule: what the Pine reference or manual does not state exactly, and no capture witnesses,
refuses BY NAME, with a capture-queue row and a probe. Light phase only: no `mutate.py`, measure-pair or
final-tip. `SCRIPT_ENGINE_VERSION` NOT edited. **Engine bump: YES, needed** (item 1 changes member-door
drawings: see "Corpus impact").

Queue: `docs/pine/capture-queue-2026-11-07-honesty-sweep.md` (rows Q-HS1 to Q-HS6, `capture-queue.json`
regenerated: 6 new targets, `rowsNeedingProbe` unchanged at 3). Probes: `tools/visual_conformance/probes/vw-hs1-*`
to `vw-hs6-*` (written for this queue; no licence-held text). Rails:
`app/src/components/chart/engine/runtime/__tests__/honestySweep.test.js` (45 tests).

## Outcome per item

| # | item (review note) | backed? | outcome |
|---|---|---|---|
| 1 | door: `line.style_*` through a `switch` (W34-I6b N2) | NO | refused by name on both drawing lanes (Q-HS1) |
| 2 | v1-v3 bare `highestbars`/`lowestbars` sign (W34-I6c N2) | NO (v4 only) | refused by name in v1-v3 on every lane (Q-HS2) |
| 3 | T7 degenerate matrix shapes (W6-T7 N1) | NO | N1's three shapes were ALREADY refused on master (`e97fe3c1a5`, rails `w6Matrix.test.js` "zero-length lines and empty submatrices stop by name"); their three twins now refuse too (Q-HS3) |
| 4 | colour map keys (W6-T8 N2) | NO | `map.new<color, …>` stops by name (Q-HS4) |
| 5 | `array<int>` served by a float overload/parameter (W6-T9 N3) | NO | refused by name (Q-HS5) |
| 6 | wrap joined across a comment line (W34-I6a N2) | NO | refused by name for the `switch` arm join (Q-HS6) |

Skipped by brief: nested switch at indent 6/9 (lane I6a-N4).

### 1. An enum slot that can be `na`
The reference states only the named constants for `style` / `size` / `position` (e.g. `line.new`'s `style`:
"Possible values: line.style_solid, line.style_dotted, ..."). Master turned an `na` there into `""` (F4's TEXT rule,
captured for `text` only), and the renderer drew its own default (a solid line); a helper `switch` with no default
dropped the PROP, so `st(m) => switch m "A" => line.style_dashed` drew SOLID even when the member picked "A".
- Host object program (`ast/pine.js`): `textNodeOf`'s `na` branch under an enum walk, and `switchTextOf` for a
  default-less switch that can miss, record `pine:enum-na`; the create / setter / cell is dropped as `enum:na`
  (classified in `objectLoss.js`, PARTIAL), with `ENUM_NA_SENTENCE` in `createDropWhy` / `cellTextWhy`.
- Runtime lane's own drawings (`runtime/objectStore.js`, RT5): an `na` PASSED to an enum slot withholds the family
  by the same sentence (an omitted argument is unchanged). One sentence for both lanes: `engine/enumNaRule.js`.
- What stays served, by a stated rule: a default-less switch (or a `== label` ternary chain ending in `na`) whose
  arms cover every `options` value of the `input.string` it reads cannot miss. That rule existed for a top-level
  switch; it now also reads `options` passed positionally (`input.string(defval, title, options, ...)`, the v6
  reference signature) and follows the subject through a helper's parameter.

### 2. v1-v3 `highestbars` / `lowestbars`
W34-I6c's citation is the v4 reference (https://www.tradingview.com/pine-script-reference/v4/#fun_highestbars) and
the translator's vendor-measured re-route, both v4. No v1-v3 reference text is held (`docs/pine/pine-version-evolution.md`
item 9: the v3 manual was never machine-read), and no corpus script or capture is v1-v3 with a bare call. So
`legacyBarsSignUnstated` (`pine.js`, one authority) refuses v1-v3 in the Resolver (`pine:builtin`) and in the runtime
lane's `windowTarget` (`runtime:statement`), both with `LEGACY_BARS_SIGN_SENTENCE`. v4+ unchanged; a source with no
`//@version` is the formula box and is unchanged (recorded: Pine itself reads that as v1).

### 3. Degenerate matrix shapes
Already refused on master: N1's zero-length `add_row`/`add_col` and empty-range `submatrix`. Still served and
unstated, now stopping by name (W6-M1 sentence): a zero-length `matrix.row` of a k×0 matrix, `matrix.col` of a
0×k one, and `matrix.fill` of an empty area (a `from == to` range, or a 0×k matrix filled whole). Runtime pane only
(the object door refuses the matrix family). Not changed: a 0×k matrix keeping its column count (`matrix.new` rows /
columns "Optional. The default value is 0"; W6-M1 rows A01-A02 already ask whether 0×3 is "empty").

### 4. Colour map keys
REF lists `color` as a key type, but nothing states when two colours are the same key (master compared packed RGBA,
so transparency made a new key). `map.new<color, …>` now stops by name. `w6Map.test.js`'s primitive-key rail drops
its colour line (the stop is railed in `honestySweep.test.js`).

### 5. A collection of `int` where `float` is declared
The lane has one number type, so `f(array<float> id)` / `method m(array<float> id)` ran on an `array<int>`.
The written number word now rides BESIDE the type descriptor (`typeDescriptor.js`, a WeakMap on identity; every
`num` keeps its `{kind:'num'}` shape), and the user-call lowering refuses (`runtime:function` / `runtime:udt-method`,
"… (Q-HS5)") when both words are written and differ, in arrays, matrices and maps. A scalar `int` to a `float`
parameter is unchanged (Pine converts it). Residual, recorded: an untyped initialiser (`a = array.new_int(0)`, no
declared type) carries no word and keeps its binding.

### 6. A wrap across a comment-only line
The manual's rule ("each wrapped line after the first can use any indentation length except multiples of four")
speaks of indentation only. A `switch` arm joined by W34-I6a across a comment-only line now refuses
`runtime:block-value` "… (Q-HS6)" (runtime pane; the door never joined). Recorded, NOT changed: the shared lexer
joins an ordinary expression wrap across a comment-only line on every lane (probe row W03 asks), and a wrap across
a BLANK line is joined too; both pre-date I6a.

## Corpus impact (corpus/committed, 266 scripts, member-door translation `memberInputTranslation` +
`probeObjectRuntime`, door build and pane build; tip vs `origin/master` sources swapped in and restored by copy)
Door and pane BUILD results: 0 changes (items 2-6 change no corpus build). Object program: 9 scripts change, all item 1:
- withheld (`enum:na`, 2 lines): `swing-points-and-liquidity-by-leviathan` (helper switch over an input named like
  the helper; master drew those lines SOLID where the default input is "Dotted").
- now SERVED by the covered-options rule, previously a dropped prop drawn with the default: `market-structure-by-leviathan`
  (4 lines; its BOS input defaults to "Dashed", which master drew solid), `linear-regression-channel-tradingfinder-existing-trend-lines`
  (5 `extend`), `heikin-ashi-true-strength-index-and-optimized-trend-tracker-erebor` (4 cell sizes),
  `smart-money-volume-activity-algoalpha` (5), `smoothed-gaussian-trend-filter-algoalpha` (9).
- shape only (an unreachable `na` tail no longer emitted; same drawing): `atr-support-and-resistance`,
  `high-low-open-mid-ranges`, `ict-turtle-soup-flux-charts`.
C18 probe set (`_resume-2026-11-01/audit/zzAuditC18Probe.measure.test.js`): none of its 36 probes uses any item's
construct (no enum slot, switch, method, matrix, map or v1-v3 source), so no change is expected there; measure-pair
should confirm. Item 3 corpus: the two matrix scripts using `row`/`fill` refuse earlier at build (`runtime:library`).

## Runs (node 20.20.2 unless noted, `--maxWorkers=1`)
- `honestySweep.test.js` 45/45; with `objectLoss.test.js` 61/61.
- Full `engine/ast` + `engine/runtime` under `heavy-final6.lock` (free RAM 11.2 GB): 514 files, 8442 passed,
  11 skipped, 7 failed. 2 were `objectLoss.test.js` (the drop calls written as ternaries; fixed: literal calls and
  an `enum:na` row, then green). 5 are `.measure` timeouts (`guardProbe`, `objectLaneCallSites`, `objectLaneCensus` x2,
  `objectLaneDrawerCensus`, 17-21 s against the 15 s default): they time out identically with master's sources
  swapped in, so not this lane.
- Service suite on node 24.13.1 (`node --test --test-reporter=tap "services/pine_runtime/test/**/*.mjs"`): 139/139.
- `node tools/pine_runtime_host_parity.mjs --host node --check`: HP-1 GREEN, 166/166.
- `evidence_engine.py queue --check`: PASS. Python queue rails: 62 passed; `test_queue_dispositions.py::
  test_the_committed_dispositions_are_exactly_the_reviewed_rows` fails identically on master's queue JSON
  (`capture-queue-2026-11-06-w6-t6#object door`), not this lane.

## Hand mutations (copy, exact replace, run `honestySweep.test.js`, restore by copy, `cmp` same: all 19)
| id | mutation | result |
|---|---|---|
| M1 | `na` under an enum walk served as `""` again | KILLED (8) |
| M2 | an uncovered default-less switch no longer marks `na` | KILLED (2) |
| M3 | positional `options` not read | KILLED (1) |
| M4 | the covered `na` tail not pruned | KILLED (1) |
| M5 | coverage not followed through a helper's parameter | KILLED (2) |
| M6 | the enum arm ignores `enumNaSeen` | KILLED (10) |
| M7 | a setter drop named `update:props` | KILLED (1) |
| M8 | a cell's `enum:na` not withheld | KILLED (1) |
| M9 | the runtime store does not withhold on `na` | KILLED (2) |
| M10 | v1-v3 bound off (`<= 0`) | KILLED (9) |
| M11 | the runtime `windowTarget` check removed | KILLED (3) |
| M12 | zero-length `matrix.row` served | KILLED (1) |
| M13 | zero-length `matrix.col` served | KILLED (1) |
| M14 | empty `matrix.fill` served | KILLED (1) |
| M15 | colour key served | KILLED (1) |
| M16 | number-word conflict always false | KILLED (4) |
| M17 | the word not recorded | KILLED (4) |
| M18 | `wrapComment` not marked | KILLED (2) |
| M19 | the comment-line test never matches | KILLED (2) |
