# W6-T10-N evidence: reserved enum names, per version and case-sensitive

Branch `fix/pine-w6-t10-reserved-names`, built from `origin/master` `d0a29bbf24` (engine 30, W6-T10 landed).
Follow-up to review `W6-T10.md` (GO-WITH-NOTES @274cdbf0df), notes N1 and N3 and mutations Q2, Q6 and Q8.
Light phase only. No `mutate.py`, measure-pair or final-tip was run, and no heavy lock was taken.
Code commit: `26da4dc7af`. `SCRIPT_ENGINE_VERSION` was not edited.
**Engine bump: coordinator's call.** The only served change is that a v5 `enum footprint` and a v5 `enum volume_row`
now serve where they refused before. No v6 answer changes. The C18 object door is untouched, because `collectEnums` does
not run there.

## Authorities
- **Pine manual, *Enums*, Shadowing** (`https://www.tradingview.com/pine-script-docs/language/enums/`), read 2026-11-07.
  The page says: "enum types require unique names that do not match any built-in types or namespaces." It gives
  four enums as an example, named Syminfo, syminfo, polyline and ta, and says "The last three all cause a compilation error
  because their names match built-in namespaces". Its code comment reads: "Naming an enum "Syminfo" with a capital "S" works
  without an issue."
- **Pine manual, *Identifiers*** (`https://www.tradingview.com/pine-script-docs/language/identifiers/`), read 2026-11-07:
  "They are case-sensitive."
- **v6 reference**, extracted 2026-11-06 with `tools/pine_survey/pine_reference_extract.js --version 6`
  (sha256 `91084ea8ae9be69b...`).
- **v5 reference**, extracted 2026-11-06 with `--version 5` (sha256 `d95b5293ad9227c4...`, byte-equal to
  `_resume-2026-11-01/runs/w34-i6c/pine_v5_reference.json`). Both versions list the keyword `enum`.
- The derivation follows the review's rule. A name is reserved if it is the head of a dotted name among the variables,
  constants, functions or methods, or if it is a `types` entry (`chart.point` is covered by `chart`). The derivation script
  was a scratch file and is not committed. It produced:
  - v6: 51 namespaces and 20 types. Every type except the 7 type words is also a namespace. **That gives 58 names.**
  - v5: 49 namespaces and 18 types. **That gives 56 names.** The v5 list is the v6 list without `footprint` and
    `volume_row`. The v5 reference has 0 `footprint.*` or `volume_row.*` entries and no such types. The v6 reference has
    17 such entries and both types.
  - No reference text is committed. Only the name lists are.

## Case-sensitivity decision (N3 / Q6)
**Pine identifiers are case-sensitive, and the manual says so word for word.** The *Enums* page also gives the exact case
in question: `Syminfo` works and `syminfo` refuses. So `enum Color` is legal and serves, and `enum color` refuses. No
capture-queue row is needed.

The code was already case-sensitive (`Set.has(name)`). What was missing was a rail that pins it, which is why Q6
survived. The comment now forbids case-folding.

## What changed
- `ast/pineRuntimeFrontend.js`
  - `ENUM_RESERVED_NAMES` is split into `ENUM_RESERVED_NAMES_V5` (56 names) and `ENUM_RESERVED_NAMES_V6` (58 names).
    `ENUM_RESERVED_NAMES_V6` is built as the v5 set plus `footprint` and `volume_row`, so the shared names are written
    once.
  - `enumReservedNames(version)` returns the v5 set for v5. It returns the v6 set for v6 and for an unread version: the
    larger set, so an unknown version fails closed.
  - `collectEnums(stmts, version = null)`: the call site in `buildRuntimeIrLinked` now passes the lexed `version`.
  - N4 (cosmetic) is fixed: the constants now sit above `collectEnums`' JSDoc, not between the JSDoc and the function.
- `runtime/__tests__/w6Enum.test.js` adds two new `describe` blocks (rails below).
  ⚰️ r0 said here that "the `refused` helper takes a version". **It did not** (review W6-T10-N, B1). The edit that was
  meant to add the version matched nothing and failed silently, so every "v5" refusal row ran as v6. Fixed in r1, below.

## Rails (w6Enum: 260 tests, all pass)
- **Exact lists.** `V5_NAMES` (56) and `V6_NAMES` (58) are typed in the test from the reference derivation, never read
  from the engine. The engine's two sets must equal them exactly.
  - A name dropped from the engine fails a refusal row.
  - A name added to the engine fails the equality row.
- **Every reserved name refuses by name in its version**, with the reason "built-in type or namespace": 56 rows for v5
  and 58 rows for v6.
- **v5 `enum footprint` and v5 `enum volume_row` serve**: a declaration, a bound field, and `==` all run, and the output
  is exact (0 on all 8 bars).
- **Case, both ways, over every name.** Each reserved name with its first letter capitalized serves in its version:
  56 + 58 rows, exact output. The manual's own pair is railed too: `Syminfo` serves and `syminfo` refuses.
- **Near misses serve**: `colors`, `tas`, `COLOR`, `FLOAT`, `footprints`, `volumeRow`, `volume_rows`, `str_`, `Ta`.

## Runs
- Targeted set (the review's set): w6Enum, objectDoorGate, runtimeInputs and editorStatus.families, on Node 20.20.2.
  `Test Files 4 passed (4)`, `Tests 556 passed (556)`.
- Folders `engine/ast` and `engine/runtime` with `--maxWorkers=1`, on Node 20. **The run is incomplete.** Claude Code
  stopped it because the machine was low on memory (an OOM-pressure reap, not a test failure). By then 465 of 510 files
  had reported: 460 passed and 5 failed.
  - The 5 failed files hold 6 tests, and each ran 20 to 31 s, past the 15 s limit:
    - the four `*.measure` corpus censuses: objectLaneCensus (2 tests), guardProbe, objectLaneDrawerCensus and
      objectLaneCallSites;
    - `pineStrictCensus`.
  - The run was killed before the end-of-run summary, so the log holds no failure text. That these 6 are timeouts is
    inferred from the 20 to 31 s durations. It is not read from an error message.
  - These are the review's "known corpus-measure" timeout files. The review records pineStrictCensus as passing "this
    time", so it times out only sometimes. Re-run alone, it passed (1/1).
  - The run was not restarted, per the reap instruction. 45 files did not report, and the full folder pass remains
    unproved on this tip.
- Service suite, Node 24.13.1: `node --test --test-reporter=tap "services/pine_runtime/test/**/*.mjs"` gave
  `# tests 131 / # pass 131 / # fail 0`.

## Hand mutations
Method: copy the file, mutate it, run w6Enum, restore it by copy. The final `cmp` against the copy was equal. The script is
a scratch file and is not committed.

| id | mutation | result | note |
|---|---|---|---|
| C0 | control | SURVIVED (correct) | 260/260 |
| N1 | v5 reads the v6 list (N1 reintroduced) | KILLED | 2 failed: the v5 footprint/volume_row serve rows (r0 run; see r1) |
| N2 | drop `footprint` from v6 (the review's Q2) | KILLED | was SURVIVED in the review |
| N3 | drop a shared namespace (`xloc`) | KILLED | 3 failed. ⚰️ r0 read these as the equality row plus the v5 and v6 refusal rows. The "v5" row actually ran as v6 (B1). |
| N4 | add a legal name (`colors`) | KILLED | 3 failed |
| N5 | case-fold the check (the review's Q6) | KILLED | 116 failed; was SURVIVED in the review |
| N6 | call site does not pass `version` | KILLED | 2 failed |
| N7 | v6 reads the v5 list | KILLED | 2 failed |
| N8 | drop a type word (`string`) | KILLED | 3 failed |
| N9 | reserved `bad` set only if no earlier `bad` (the review's Q8) | SURVIVED | equivalent, see below |
| N10 | reserved check off | KILLED | 116 failed |

N9 is equivalent. A declaration with an earlier `bad` refuses either way, and only the reason text differs. No rail is
added for it.

## r1 (review W6-T10-N, NO-GO @0f0cf7009b, B1): the v5 rail was vacuous
- **Cause.** The test helper `refused` was `(src, re, o) => build(src, o)` and dropped the version argument. So all 56
  "v5 refuses" rows, and the manual's `syminfo` row, built a `//@version=6` script. The r0 edit meant to change the helper
  was a `str.replace` that matched nothing, and nothing asserted that it had matched.
- **Fix (tests only; no product code).** `refused` is now `(src, re, o, v) => build(src, o, v)`.
- **Guard row.** `refused` must not throw for v6 `enum footprint` and must throw for v5 `enum footprint`. That is the one
  shape whose answer differs by version, so a helper that ignores its version goes red.
- **Review N2 row.** A script with no version line reads the v6 list, so `enum footprint` refuses. This makes the
  "fails closed" comment a railed claim (it kills R4).
- **w6Enum: 262/262.**
- Targeted set (w6Enum, objectDoorGate, runtimeInputs, editorStatus.families), Node 20.20.2: `Test Files 4 passed (4)`,
  `Tests 558 passed (558)`.
- Service suite, Node 24.13.1: `# tests 131 / # pass 131 / # fail 0`.
- The folder run was not repeated. Review §5 ran it on this code (503/507 non-skipped files pass, and the only reds are the
  4 known `.measure` timeouts). r1 changes only the test file.

### Mutation table, re-run (same method; final `cmp` equal)
| id | mutation | result | failed |
|---|---|---|---|
| C0 | control | SURVIVED (correct) | 0 of 262 |
| N1 | v5 reads the v6 list | KILLED | 3 (2 serve rows + guard) |
| N2 | drop `footprint` from v6 | KILLED | 4 |
| N3 | drop `xloc` | KILLED | 3 (equality + real v5 + v6 refusal rows) |
| N4 | add `colors` | KILLED | 3 |
| N5 | case-fold the check | KILLED | 116 |
| N6 | call site does not pass `version` | KILLED | 3 |
| N7 | v6 reads the v5 list | KILLED | 3 |
| N8 | drop `string` | KILLED | 3 |
| N9 | reserved `bad` only if no earlier `bad` | SURVIVED | equivalent: only the reason text differs |
| N10 | reserved check off | KILLED | 118 |
| R1 | v5 reads an EMPTY set (reviewer's) | **KILLED** | 56; it SURVIVED at r0 |
| R2 | v5 drops `xloc` at use; the constant is untouched (reviewer's) | **KILLED** | 1; it SURVIVED at r0 |
| R3 | v5 reads only the 7 type words (reviewer's) | **KILLED** | 49; it SURVIVED at r0 |
| R4 | an unknown version (v4 or none) reads the v5 list (reviewer's) | **KILLED** | 1, by the no-version row |

## Heavy phase (review W6-T10-N: GO-WITH-NOTES @2f49d91d9d; lands as engine 32 after W6-T6-N1b's 31)
`SCRIPT_ENGINE_VERSION` was not edited here. The coordinator bumps it at landing.

### mutate.py
- Run: `parity-programme/scripts/mutate.py` under `heavy-mut.lock` (free, label `w6-t10n-mut`, 5.4 min), Node 20.20.2, tip `2f49d91d9d`.
- Mutation list: `_resume-2026-11-01/runs/w6-t10n/muts.json`. Tests: w6Enum and objectDoorGate.
- The final `cmp` against the saved front end was equal, and the worktree was clean afterwards.
- **14 of 16 killed.**
  - C0 (control) SURVIVED, as it should.
  - N9 (reserved `bad` set only if there is no earlier `bad`) SURVIVED. It is equivalent: it refuses either way, and only the reason
    text differs.
  - Killed: N1-N8, N10, R1-R4, and R5, a new mutant that runs `collectEnums` at the object door (killed by objectDoorGate).

### measure-pair, runtimes 0 and 1
- Tip `2f49d91d9d` vs base `pine-dsk-mpbase2`, detached at the merge-base `d0a29bbf24`.
- Run under `heavy-mp2.lock` with `ram_gate` (passed at once, free 10.4 GB), label `w6-t10n-mp`, 53.4 min.
- Scripts and logs: `_resume-2026-11-01/runs/w6-t10n/mpr/`. HEAD was checked before and after each side and never moved.

| | runtime 0 | runtime 1 |
|---|---|---|
| out | 395 rows, 0 differ | 395 rows, 0 differ |
| probe (C18) | 69 rows, 0 differ | 69 rows, 0 differ |
| audit TOTAL (tip = base) | MATCH 93, DIVERGE 103, INCONCLUSIVE 140 | MATCH 112, DIVERGE 107, INCONCLUSIVE 117 |
| harness | identical | identical |
| census | 967 rows, 3 differ | 967 rows, 1 differ |

**Every census mover is timeout jitter, and none involves an enum:**
- rt0 `committed:multi-timeframe-trend-indicator__fa4022ecf5` (v6, no `enum`): `steps[2].refusals` has 3 entries on one side
  and 2 on the other, all of them `pine:timeout`. This is wall-clock jitter.
- rt0 `committed:volatility-coil-edge-bullbyte__604f0fd1c6` (v6, no `enum`): drop head `reset@749: pine:timeout` vs
  `create@651: pine:timeout`. Both are timeouts; only the point where the 10 s budget ran out differs.
- rt0 `reference:mirage-liquidity-sweep-pro-willyalgotrader__238f0e26eb`: `create:label@882` is `pine:timeout` on one side and
  `pine:undefined` on the other. The `pine:timeout` side is budget jitter. The script uses no `enum`.
- rt1 `committed:multi-timeframe-trend-indicator__fa4022ecf5`: the base has `pine:timeout` at line 158 and the tip has it at
  line null. Same file, same guard, a different point where the budget ran out.

**No enum census mover was expected, and none appeared.** The branch changes only v5 `enum footprint` and v5
`enum volume_row`, and no corpus script declares either.

### Merge with origin/master
- Merged `36c7d9d27e` cleanly. Master is still engine 30.
- Rails after the merge: the targeted set (w6Enum, objectDoorGate, runtimeInputs, editorStatus.families), Node 20.20.2, gave
  `Test Files 4 passed (4)`, `Tests 558 passed (558)`.
- Service suite, Node 24.13.1: `# tests 139 / # pass 139 / # fail 0`. Master added 8 tests.
- Next step: final-tip, run by the coordinator.
