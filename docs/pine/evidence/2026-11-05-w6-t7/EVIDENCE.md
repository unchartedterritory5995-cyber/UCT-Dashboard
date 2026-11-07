NEXT STEP: waiting for the coordinator's GO on measure-pair, then final-tip. The mutate.py batch is done (24/24 as expected).

# W6-T7 `matrix.*` on the runtime lane (lane w6-t7)

Base: origin/master f9651f47ee (engine 21; W6-T5 collections.js and W6-T6 `for … in` are in). Spec: W6-BREAKDOWN T7 and section 3
(origin/docs/pine-w6-breakdown @1889bbedd7). Worktree `C:/Users/Patrick/uct-worktrees/pine-dsk-w6t7`, branch
`feat/pine-w6-t7-matrix`. Logs: `C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/runs/w6-t7/`. Node 20.20.2 (`dsk/node20.sh`)
for every vitest run, `--maxWorkers=1`, after `ram_gate`.

**Engine bump: yes** (refusals become served values on the runtime pane; the coordinator bumps at landing).

## What changed
- New `runtime/matrices.js`: the matrix value (a Symbol-tagged `{rows, cols, cells, elem}`, `isMatrix`), the members
  (`buildMatrixFns`, handed `CollectionError` / `isUnfilled` so there is no import cycle), and `MATRIX_WRITES`.
- `runtime/collections.js`: the members join the ONE table (`ARRAY_FNS`, so one VM op, one admitter, one kind check);
  `kindOf` answers `'matrix'`; `producesArray` counts a matrix result; `ARRAY_WRITES` takes `MATRIX_WRITES`;
  `DOOR_GATED_ARRAY` lists the whole matrix family.
- `runtime/vm.js`: an `na` matrix argument is a named `CollectionError` stop (as an `na` array is); `heldNow` walks matrix
  cells, so the C7 collector withholds a family when it reaches a drawing held in a matrix.
- `runtime/vmState.js`: a matrix is encoded (shape and cells) and checkpointed (deep copy, aliasing kept).
- `ast/pineRuntimeFrontend.js`: `collectionKindOf` reads a held member's declared result (`matrix.row` is an array, not a
  matrix); comment at the method-form site. Admission, method forms and `callFamily` needed no change: T3a/T3b already
  route by the receiver's family, and the members are in the one table. No new per-slot flag.
- Queue: `docs/pine/capture-queue-2026-11-06-w6.md` W6-M1 (parsed QUEUED by `evidence_engine.py queue`; the committed
  `capture-queue.json` is not regenerated here, as in T5). Probe: `tools/visual_conformance/probes/vw-w6-matrix-members.pine`.

## Served (each rail quotes its v6 reference sentence)
`new` (rows/columns default 0; initial default `na` for float/int), `get`, `set`, `rows`, `columns`, `elements_count`,
`row` / `col` (new arrays), `add_row` / `add_col` (index 0..size, array of the stated size or any size on an empty matrix,
default `na` line), `remove_row` / `remove_col` (explicit index), `fill` / `submatrix` (ends exclusive, stated defaults),
`copy`, `min` / `max`, `avg` (provably float, or a whole mean), `sum` (matrix plus scalar, or same-size matrix). Method forms.

## Refused by name (W6-M1), each with a rail that reaches it
`new` with `na`, negative or fractional counts, or a sized non-float/int matrix with no initial value; any index outside
the matrix (negative included); `add_row`/`add_col` of the wrong length, past the size, or the default line on 0x0;
`remove_row`/`remove_col` with the index omitted (the stated default `matrix.rows()` is past the last row) or of the last
row/column; `fill`/`submatrix` ranges past, reversed or `na`; `min`/`max`/`avg` over an `na` cell or an empty matrix;
(review N1) a zero-length row or column added (`add_row` on k x 0, `add_col` on 0 x k, default or an empty array) and
an empty-range `submatrix`; `avg` of a possibly-int matrix with a fractional mean (its `series int` form); `sum` with `na`, of two sizes, or a
possibly-int matrix plus a fraction. Not in the table (`runtime:array` at build): `det`, `inv`, `pinv`, `rank`, `kron`,
`mult`, `eigen…`, `transpose`, `reshape`, `median`, `mode`, `sort`, `concat`, `swap_*`, `reverse`, `diff`, `pow`, `trace`, `is_*`.
`for … in` over a matrix keeps T6's W6-F1 refusal (`runtime:loop`).

## Review (GO-WITH-NOTES, `dsk/reviews/W6-T7.md`)
N1 fixed: the degenerate shapes stop by name (W6-M1; probe rows D01-D04, E09-E10; queue row extended), rails in
`w6Matrix.test.js` ("zero-length lines and empty submatrices"), each guard hand-mutated away and killed. N2-N4 noted, not changed.

## Findings for the coordinator
1. `matrix.sum` is matrix ADDITION in the reference (returns a matrix), not a reduction; served as such.
2. The `runtime:array` refusal sentence (`FE:213`) still reads "`matrix.*`, `map.*` or an `array.*` member it lacks".
   NOT edited: the C18 audit records the first 160 chars of the door's refusal message, so editing it would move the
   door's recorded output on every row that refuses a collection. Left for a coordinated change.
3. A method-form initialiser (`c = m.copy()`, `r = m.row(0)`) does not type its binding (same as arrays today:
   `b = a.copy()` then `b.push()` refuses `runtime:expression-statement`). T9 (member chains). The name form works.
4. A v6 `for` whose bound reads `matrix.rows(m)` refuses `runtime:loop` when the body writes the matrix (fail closed,
   the existing bound guard); v5 runs.
5. No hostParity / canary case uses a matrix (grepped `services/pine_runtime`, `__fixtures__/hostParity`).

## Rails (red on master, green on the tip)
- New `runtime/__tests__/w6Matrix.test.js` (51 tests after review N1; 47 at f15cc651fb). Against master f9651f47ee's four engine sources
  (`runs/w6-t7/redmaster.log`): `46 failed | 1 passed` (the 1 is the door-gated check, vacuous on master; the roster
  test covers it).
- `objectDoorGate.test.js` + W6-T7 block (18 shapes x 3 + control): the door draws master's answer (refused, nothing
  drawn), the pane builds every shape, the door build refuses with master's exact guard and sentence. Master's answers
  measured with master's sources in place (`runs/w6-t7/door-master.json` vs `door-tip.json`: identical).
- Repointed (their "not held" matrix member is now served): `arrays.test.js` control and `functionBodyBlockValue.test.js`
  specimen and `w6TypeDescriptor.test.js` (x2) now use `matrix.det`.
- Regression, 25 files, 834 tests passed (`runs/w6-t7/t3.out`).

## Hand mutations (`runs/w6-t7/handmut.log`; tests w6Matrix + objectDoorGate)
| mutation | result |
|---|---|
| M00 no-op comment (control, twice) | SURVIVED |
| M01 `matrix.row` hands back the row (a view) (spec: col/row a view) | KILLED |
| M02 `add_row` keeps the caller's array | KILLED |
| M03 out of range answers `na` (spec) | KILLED |
| M04 `na` row count served as 0 | KILLED |
| M05 `avg` of possibly-int with fractional mean served | KILLED |
| M06 `sum` possibly-int + fraction served | KILLED |
| M07 `remove_row` with no index removes the last row | KILLED |
| M08 door gate drops the matrix family | KILLED (objectDoorGate) |
| M09 `kindOf` does not answer matrix | KILLED |
| M10 VM `na`-collection stop for arrays only | KILLED |
| M11 checkpoint shares rows | KILLED |
| M12 `collectionKindOf` ignores the declared result | KILLED |
| M13 `add_row` declared as writing nothing | KILLED (declaration + v6 bound behaviour rail) |
| M14 `add_row` of the wrong length served | KILLED |
| M15 `min`/`max`/`avg` skip `na` cells | KILLED |
| M16 `fill` to_column inclusive | KILLED |
| M17 `encodeState` cannot encode a matrix | KILLED |
| M18 first attempt was a syntax error (invalid); M18b default `na` for every type | KILLED |
| M19 `heldNow` skips matrix cells | KILLED |
| N1a `add_row` zero-length guard removed (review N1) | KILLED |
| N1b `add_col` zero-length guard removed | KILLED |
| N1c `submatrix` empty-range guard removed | KILLED |
| N1d `submatrix` guard checks rows only | KILLED |
| M00 control (N1 run) | SURVIVED |

## mutate.py batch (coordinator GO; tip e97fe3c1a5; lock `dsk/heavy-mut.lock`, 8.6 min; `runs/w6-t7/mutjob.log`)
`mutate.py` (copied as `runs/w6-t7/mutate1.py` with `--maxWorkers=1`), one mutation per call, free RAM checked >= 4000 MB before each
(lowest 9305 MB). Tests: w6Matrix + objectDoorGate. Mutations `runs/w6-t7/muts.json` = the hand set above (M01-M19, N1a-N1d).
Result: M00 control SURVIVED; all 23 others KILLED; tree clean after.

## Not yet run (heavy; each waits for the coordinator's GO)
- measure-pair (expect 0 C18 diffs, `adx-and-di-for-v4` unmoved; movers per spec:
  `one-sided-gaussian-support-resistance-rate-loxx` attach, plus `supertrend-cluster-zeiierman` with W4); final-tip and
  ready-check (merge origin/master first).

## Measure-pair (coordinator, 2026-11-06)
Tip f2445b11e1 vs base f9651f47ee (merge-base), runs/w6-t7/mp-all.log.
- runtime 0: out 395 rows, 0 differ (C18 clean); probe 69/0; census 967 rows, 15 differ, all movers toward
  attachment: 12 matrix examples (avg/col/columns/fill/get/max/min/row/rows/set, types:matrix) plus
  one-sided-gaussian-support-resistance-rate-loxx.
- runtime 1: out 395/0 (C18 clean); probe 69/0; census 21 differ. These are matrix examples attaching or moving first wall
  (median/mode reach further), plus first-wall moves on committed scripts from runtime:expression-statement /
  call-text-state / loop to runtime:array (a later wall).
- harness: identical on both runtimes.
Master merged afterwards (3e3541c88b, clean). Targeted rails on the merged tree: 5 files, 315/315.
