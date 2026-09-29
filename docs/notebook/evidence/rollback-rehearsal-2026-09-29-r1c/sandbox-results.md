# Sandbox rehearsal results, lane R1c, 2026-09-29

**Method:** `rehearse.py` + `probe.py` in this directory (same method as lane R1's and R1b's).
Three targets, one data dir `C:\data-w10r1c` on port 8238: the tip `0812b5ec3` (control, seeds
the fixtures), `--through L5` (`s-L5`), `--through L4` (`s-L4`).

## Extraction

Every tree extracted with `git archive` and re-hashed file by file through a throwaway index;
IDENTICAL to its git tree in every run (`sandbox/extract-verify.log`):

- `s00-tip`: tree `ee8c22f5c1`, 17,102 files
- `s-L5`: tree `edccdb85a0`, 17,101 files
- `s-L4`: tree `b0fb6d0b56`, 17,096 files

## Boots — all three CLEAN

One data dir, seeded by the tip boot, so every rolled-back server read data the tip had written
(the way a real rollback does). The Notebook gates were set to production's armed values for
every boot.

| step | pre-boot | +15s | +120s | shutdown | db files hashed |
|---|---|---|---|---|---|
| `s00-tip` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |
| `s-L5` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |
| `s-L4` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |

Full lines: `sandbox/s00-tip/sandbox-integrity.txt`, `sandbox/s-L5/sandbox-integrity.txt`,
`sandbox/s-L4/sandbox-integrity.txt` (and the `.md` logs behind each).

## L4's door: `button[data-format-toggle]` (D3P, the phone format disclosure)

Always mounted in the DOM (hidden above 640px by CSS only), so its count is a clean door at any
viewport.

| step | count |
|---|---|
| tip | 1 |
| through `L5` | 1 (unchanged — L5 does not touch this door) |
| through `L4` | **0** (gone, exactly at L4's own step) |

## L5: not a door — behaviour preserved (a pure query optimisation)

`GET /api/j2/notes/backlinks?symbol=R1CBACKLINK` — same shape, same value, at every step. (The
seeded `$R1CBACKLINK` mention was not detected into `j2_note_mentions` by this fixture's plain
paragraph text — `count: 0` at every step — which is itself part of the proof: the SAME `0` at
the tip, through `L5` and through `L4` shows the endpoint's answer did not move.)

| step | status | keys | count | notes_len |
|---|---|---|---|---|
| tip | 200 | count, notes, symbol | 0 | 0 |
| through `L5` | 200 | count, notes, symbol | 0 | 0 |
| through `L4` | 200 | count, notes, symbol | 0 | 0 |

## The never-revert set (schema guard) — unaffected at this depth

Three fixture notes (level 0 text-only, level 1 `highlight` mark, level 2 `tableOfContents`
node) opened in the served editor, typed into, read back, at every step:

| step | level-2 declared schema | PUT status | stored keeps marker | stored has typed |
|---|---|---|---|---|
| tip | 2 | 200 | true | true |
| through `L5` | 2 | 200 | true | true |
| through `L4` | 2 | 200 | true | true |

Same for the level-0 and level-1 notes (`sandbox/<step>/probe.json`, `editor.n0`/`editor.n1`).
Neither L5 nor L4 touches the schema, so this is expected and confirmed unchanged.

## Every earlier landing's door — still present (correct: L5/L4 revert nothing below them)

`w8_share_links`, `w8_publish`, `9C_admin_notebook_soak`, `w7_personal_tokens`,
`w6_note_templates`, `w5_switcher_door`, `L1b_admin_notebook_slo`, `L1c_switcher_body_recall` all
answer identically (same status, same JSON-ness) at the tip, through `L5` and through `L4` —
`sandbox/<step>/probe.json` → `landings`.

## The step-2 check list, inside each tree

- schema diff against the tip (`notebookSchema.js`, `notebook_schema.py`, both rails): **EMPTY**
  in all three trees.
- `pytest tests/test_notebook_schema_guard.py -q`: **17 passed** in all three.
- vitest (`--maxWorkers=2`, the runbook's list): **272 passed** in all three — the same count as
  lane R1b's at `L2` depth, since neither L5 nor L4 changes that list's file set.

## What was NOT measured here

- L2's own door (`NoteMoreMenu`'s "More note actions" button) — already covered by lane R1b's
  rehearsal at this same depth; not re-measured by this lane.
- Anything below `L4` (`L1c` down to `wave5` + guards) — unchanged rules and pins since R1b's
  2026-09-29 rehearsal; not re-booted here. The one new rule this lane added
  (`caf6d1b9e` / `Support.jsx`) fires at wave 8's own step, four deep; it is verified from
  objects only (the chain build enforces the pin on every run), not booted, the same split R1b
  made for its own wave-5 test-file rule.
- In every boot, including the tip, the sandbox attempted real Anthropic calls, which were
  refused for credit balance (the launcher's warm pass, not the chain). Recorded, not
  investigated — same as every prior lane's rehearsal.

## Note on the mid-lane disk-exhaustion refusal

This rehearsal was attempted twice. The first attempt hit a machine-wide `C:` drive at **0 bytes
free** (confirmed by `Get-Volume`) partway through extracting the third tree, and was reported as
a refusal rather than worked around (`sandbox/BLOCKED-disk-exhaustion.md` has the full account —
kept as the record of what happened, not edited to hide it). Free space returned on its own
(another session's cleanup, not this lane's) to 142 GB; the extraction scratch directory this
lane had built was ALSO found deleted by an unrelated concurrent session's own startup cleanup
(`ENOENT` reading this lane's own background-task output, with the harness's own message
identifying the cause). Both times, this lane rebuilt only its own scratch state and touched
nothing belonging to another worktree or session. The results above are the completed,
successful re-run.
