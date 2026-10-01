# Sandbox rehearsal results, lane R1e, 2026-09-30

**Method:** `rehearse.py` + `probe.py` in this directory (same method as R1's, R1b's, R1c's and
R1d's). One data dir, seeded by the tip boot, on port 8241: the tip `599cd44f1` (control, seeds
the fixtures), `--through L12` (`s-L12`), `--through L10` (`s-L10`). L9 ships zero `app/`/`api/`
files (the tool's own coverage for L6/L7/L8) -- not booted, verified as conflict-free from objects
only, the same split R1c made for wave-8's `Support.jsx` rule and R1d made for L6.

## Extraction

Every tree extracted with `git archive` and re-hashed file by file through a throwaway index;
IDENTICAL to its git tree in every run (`sandbox/extract-verify.log`):

- `s00-tip`: tree `760df67ef6`, 18,790 files
- `s-L12`: tree `4c25a25226`, 18,779 files
- `s-L10`: tree `9e8e8cc226`, 18,772 files

## Boots -- all three CLEAN

The Notebook gates were set to production's armed values for every boot.

| step | pre-boot | +15s | +120s | shutdown | db files hashed |
|---|---|---|---|---|---|
| `s00-tip` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |
| `s-L12` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |
| `s-L10` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |

Full lines: `sandbox/s00-tip/sandbox-integrity.txt`, `sandbox/s-L12/sandbox-integrity.txt`,
`sandbox/s-L10/sandbox-integrity.txt` (and the `.md` logs behind each).

## L12's door: `GET /api/j2/notes?sort=updated_asc`

Two notes created ~1.2s apart via the member's own door; the request asks for the five most
recently touched notes sorted `updated_asc`. At the tip the OLDER note (created first) comes
first; before L12, an unrecognized `sort` value silently falls back to `updated_at DESC`
(`api/services/journal_two/notes.py`'s `.get(sort, ...)` default), so the NEWER note comes first
instead.

| step | `older_comes_first` | index of older note | index of newer note |
|---|---|---|---|
| tip | **True** | 3 | 4 |
| through `L12` | **False** (gone -- exactly at L12's own step) | 1 | 0 |
| through `L10` | False (still gone -- L10 does not touch `notes.py`) | 1 | 0 |

(The older/newer note's absolute list position shifts between runs because each boot's probe
also creates the `L12_sort_updated_asc` fixtures alongside the seeded never-revert notes and the
prior run's trashed door-check notes -- the RELATIVE order, older-before-newer, is the door.)

## L10's door: the template gallery's card count

The Notebook's bare-root landing (`ResearchHome.jsx`, an L10 file) requires one click on
"All notes" before the "Templates" button is reachable; before L10 that extra screen does not
exist and the Templates button is reachable directly (`sandbox/<step>/probe.json` ->
`L10_template_gallery` -> `templates_button_count_direct`). Once open, `[data-template-card]`
is counted.

| step | reached via | `[data-template-card]` count |
|---|---|---|
| tip | one click through "All notes" (ResearchHome present) | **27** (25 built-ins + "Blank note" + the "My Playbook" pointer card, `notebookTemplates.js`'s `TEMPLATES` array measured at 25 entries) |
| through `L12` | one click through "All notes" (ResearchHome still present -- L12 does not touch it) | 27 (unaffected -- L12 does not touch `notebookTemplates.js` or `TemplatePicker.jsx`) |
| through `L10` | one click through "All notes" | **11** (gone -- exactly at L10's own step: 9 pre-gallery built-ins + the same two bonus cards) |

## The never-revert set and every earlier landing's door: unchanged at all three steps

- **The never-revert set** (three fixture notes, levels 0/1/2): `stored_keeps_marker` and
  `stored_has_typed` both `true` at the tip, through `L12` and through `L10`
  (`sandbox/<step>/probe.json` -> `editor`).
- **Every earlier landing's door** (`L1c_switcher_body_recall`, `L1b_admin_notebook_slo`,
  `L1a_unbuildable_body_at_create`, `h203_depth_cap_at_create`, `w9_batch_export_bogus_format`,
  `w8_share_links`, `w8_publish`, `9C_admin_notebook_soak`, `w7_personal_tokens`,
  `w6_note_templates`, `w5_switcher_door`) answers byte-for-byte identically (same status, same
  JSON-ness, same extra keys) at all three steps -- `sandbox/<step>/probe.json` -> `landings`.
- **L7's door** (`input[aria-label="Find in note"]`'s touch-tier `min-height`): **44px** at all
  three steps -- unaffected, since neither L12 nor L10 touches `NoteFindBar.jsx`.
- A clean boot and a clean shutdown at every step (table above).

## Object-level verification below `L10` (not re-booted)

`python tools/notebook_rollback_chain.py --through wave5` (from the new tip, `599cd44f1`) builds
end to end, exit 0, tree-for-tree consistent with R1d's chain below `L8`
(`chain/chain-through-wave5.jsonl`). `--record-pins --through wave5` returns all **sixteen** pins
recorded at `8d08da86f` byte-identical (`chain/record-pins-output.json`) -- L9, L10 and L12
introduce **zero** new conflicts anywhere in the chain, so nothing below `L10` needed
re-rehearsing on a sandbox (same split R1c made for wave-8's `Support.jsx` rule and R1d made for
L6 and, in round 2, everything below L8).

## L9: no door -- ships zero `app/` or `api/` files, verified as a non-regression

L9's own diff (`git diff --stat 89390fb85^..89390fb85`) touches only `tests/` paths -- the
rollback tool's own coverage for L6/L7/L8. There is no product surface to check narrower than "did
anything else break"; the shared checks above (the never-revert set, every earlier landing's door,
L7's door, a clean boot) cover it, run at every step regardless of the specific landing.

## What was NOT measured here

- In every boot, including the tip, the sandbox attempted real Anthropic calls, which were refused
  for credit balance (the launcher's warm pass, not the chain). Recorded, not investigated -- same
  as every prior lane's rehearsal.
- Anything below `L10` (`L9` down to `wave5` + guards): unchanged rules and pins since R1d's
  2026-09-29 rehearsal; verified from objects only (`--record-pins --through wave5`, zero new
  conflicts), not booted.
