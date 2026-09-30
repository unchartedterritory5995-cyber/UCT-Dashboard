# Sandbox rehearsal results, lane R1d, 2026-09-29

**Method:** `rehearse.py` + `probe.py` in this directory (same method as R1's, R1b's and R1c's).
Three targets, one data dir `C:\data-w10r1d` on port 8239: the tip `8d08da86f` (control, seeds
the fixtures), `--through L7` (`s-L7`), `--through L6` (`s-L6`).

## Extraction

Every tree extracted with `git archive` and re-hashed file by file through a throwaway index;
IDENTICAL to its git tree in every run (`sandbox/extract-verify.log`):

- `s00-tip`: tree `db9171d4e5`, 17,261 files
- `s-L7`: tree `c8a0240fd2`, 17,261 files
- `s-L6`: tree `bbf49d3aab`, 17,260 files

## Boots -- all three CLEAN

One data dir, seeded by the tip boot, so every rolled-back server read data the tip had written
(the way a real rollback does). The Notebook gates were set to production's armed values for
every boot.

| step | pre-boot | +15s | +120s | shutdown | db files hashed |
|---|---|---|---|---|---|
| `s00-tip` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |
| `s-L7` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |
| `s-L6` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |

Full lines: `sandbox/s00-tip/sandbox-integrity.txt`, `sandbox/s-L7/sandbox-integrity.txt`,
`sandbox/s-L6/sandbox-integrity.txt` (and the `.md` logs behind each).

## L7's door: `input[aria-label="Find in note"]`'s touch-tier `min-height` (clause 6c)

Measured at 820px viewport width (the same width the fix's own commit message measured). The
Find bar is opened via `button[aria-label="Find in note"]` in the note header before reading the
input's bounding box.

| step | rendered height (px) |
|---|---|
| tip | **44** |
| through `L7` | **18** (gone -- exactly at L7's own step) |
| through `L6` | 18 (still gone -- L6 does not touch this file) |

## L6: no door -- ships zero `app/` or `api/` files, verified as a non-regression

L6's own diff (`git diff --stat 3fb184cdf^..3fb184cdf`) touches only `docs/`, `tests/` and
`tools/` paths -- rollback-chain tooling, rehearsal evidence for L4/L5, a restore-drill fix, and
proof-walk evidence. There is no product surface to check narrower than "did anything else
break", so this lane relies on the shared checks below, run at every step regardless of the
specific landing:

- **The never-revert set** (three fixture notes, levels 0/1/2): `stored_keeps_marker` and
  `stored_has_typed` both `true` at the tip, through `L7` and through `L6`
  (`sandbox/<step>/probe.json` -> `editor`).
- **Every earlier landing's door** (`L1c_switcher_body_recall`, `L1b_admin_notebook_slo`,
  `L1a_unbuildable_body_at_create`, `h203_depth_cap_at_create`, `w9_batch_export_bogus_format`,
  `w8_share_links`, `w8_publish`, `9C_admin_notebook_soak`, `w7_personal_tokens`,
  `w6_note_templates`, `w5_switcher_door`) answers byte-for-byte identically (same status, same
  JSON-ness, same extra keys) at all three steps -- `sandbox/<step>/probe.json` -> `landings`.
- A clean boot and a clean shutdown at every step (table above).

## The step-2 check list, inside each tree

- schema diff against the tip (`notebookSchema.js`, `notebook_schema.py`, both rails): **EMPTY**
  in all three trees.
- `pytest tests/test_notebook_schema_guard.py -q`: **17 passed** in all three.
- vitest (`--maxWorkers=2`, the runbook's list, now including `a11y/targetFloors.test.js` for
  L7's own rail): **314 passed** at the tip, **306 passed** through `L7` and through `L6` (the
  8-test difference is L7's own new tap-floor assertions, which do not exist in a tree that
  predates L7 -- expected, not a regression).

## Mutation proof

`mutations-r1d.py` mutates the COMMITTED tool (`tools/notebook_rollback_chain.py` at HEAD after
this lane's own commit), runs the test that should catch it, and restores by content hash
verified against `git cat-file blob HEAD:<path>`. All three killed; full log `mutations-r1d.log`:

| mutation | test | verdict |
|---|---|---|
| drop `L7` from `CHAIN` | `test_the_chain_names_every_notebook_landing_up_to_MEASURED_AT` | RED (killed) |
| tamper the new wave-5 `CommandPalette.jsx` pin | `test_rebuilding_from_MEASURED_AT_reproduces_the_rehearsed_trees` | RED (killed) |
| remove the TERM-038 (`8393002716`) `REVIEWED_NOT_LANDINGS` ruling | `test_every_commit_since_the_previous_measurement_is_in_CHAIN_or_reviewed` | RED (killed) |

Every restore verified byte-identical to `git cat-file blob HEAD:tools/notebook_rollback_chain.py`
before the next mutation ran.

## What was NOT measured here

- L4's and L5's own doors -- already covered by lane R1c's rehearsal at this same depth; not
  re-measured by this lane.
- Anything below `L5` (`L4` down to `wave5` + guards) -- unchanged rules and pins since R1c's
  2026-09-29 rehearsal, except the one new rule this lane added
  (`RULES["2c3ed3093"]["app/src/components/CommandPalette.jsx"]`), which fires at wave 5's own
  step, deep in the chain; verified from objects only (the chain build enforces the pin on every
  run and the full `--through wave5` build was run end to end, exit 0 -- see
  `chain/chain-through-wave5.jsonl`), not booted on a sandbox, the same split R1c made for its own
  wave-8 `Support.jsx` rule.
- In every boot, including the tip, the sandbox attempted real Anthropic calls, which were
  refused for credit balance (the launcher's warm pass, not the chain). Recorded, not
  investigated -- same as every prior lane's rehearsal.

# Round 2, 2026-09-29: L8 #255 (landed mid-lane)

**Method:** `rehearse_round2.py` in this directory. Its own data dir/port
(`C:\data-w10r1d-2` : 8240), so it never collides with round 1's boots. Two targets: the new tip
`s01-tip2` (`6f563c158`, includes L8 + the dark Fundamentals V5 work `cd9ecc833`; control, seeds
its own fixtures) and `s-L8` (`--through L8`).

## Extraction

- `s01-tip2`: tree `0ed7636cc4`, 17,292 files
- `s-L8`: tree `54d8421f3b`, 17,292 files

Both re-hashed IDENTICAL to their git trees (`sandbox/extract-verify-round2.log`).

## Boots -- both CLEAN

| step | pre-boot | +15s | +120s | shutdown | db files hashed |
|---|---|---|---|---|---|
| `s01-tip2` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |
| `s-L8` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |

## L8: no door -- ships zero `app/` or `api/` files, verified as a non-regression

Same treatment as L6 in round 1. `s01-tip2` reproduces round 1's tip exactly:

- L7's door (`input[aria-label="Find in note"]`): **44px** at `s01-tip2`, matching round 1's
  `s00-tip` reading exactly.
- Every earlier landing's probe (`landings` in `probe.json`) byte-identical to round 1's `s00-tip`.

`s-L8` (L8 reverted) is byte-identical to `s01-tip2` on every shared probe: `landings` dict equal
key-for-key, L7's door still 44px (unaffected -- L8 does not touch that file), and the never-revert
set's `stored_keeps_marker`/`stored_has_typed` both `true` for all three fixture notes. L8 has no
door of its own to lose, so identical output IS the expected, correct result.

## Object-level verification (not re-booted below L8)

`python tools/notebook_rollback_chain.py --through wave5 --from origin/master` builds end to end,
exit 0, tree-for-tree consistent with round 1's chain below L6 (`chain/chain-through-wave5.jsonl`,
regenerated from the new tip). `--record-pins --through wave5` returns all sixteen pins recorded
at `8d08da86f` byte-identical (`chain/record-pins-output-round2.json`) -- L8 and `cd9ecc833`
introduce zero new conflicts anywhere in the chain, so nothing below `L8` needed re-rehearsing on
a sandbox.
