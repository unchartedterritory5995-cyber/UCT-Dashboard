# Sandbox rehearsal results, lane R1f, 2026-09-30

**Method:** `rehearse.py` + `probe.py` in this directory (same method as R1's, R1b's, R1c's, R1d's
and R1e's). One data dir, seeded by the tip boot, on port 8167: the tip `a680b0d40` (control, seeds
the fixtures), `--through L13` (`s-L13`), `--through L12` (`s-L12`).

## Extraction

Every tree extracted with `git archive` and re-hashed file by file through a throwaway index;
IDENTICAL to its git tree in every run (`sandbox/extract-verify.log`):

- `s00-tip`: tree `143a76ebe0`, 18,908 files
- `s-L13`: tree `6d2896c741`, 18,907 files
- `s-L12`: tree `f9d4faefb8`, 18,896 files

## Boots -- all three CLEAN

The Notebook gates were set to production's armed values for every boot.

| step | pre-boot | +15s | +120s | shutdown | db files hashed |
|---|---|---|---|---|---|
| `s00-tip` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |
| `s-L13` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |
| `s-L12` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |

Full lines: `sandbox/s00-tip/sandbox-integrity.txt`, `sandbox/s-L13/sandbox-integrity.txt`,
`sandbox/s-L12/sandbox-integrity.txt` (and the `.md` logs behind each).

## L13's door: `POST /api/j2/notes/{id}/facts` with `factType=analyst_price_target_consensus`

The G-062 analyst-consensus capture door -- the same router both member-facing doors call
(SlashMenu's `/consensus` command and TickerPopup's "Save analyst consensus to Notebook" button),
exercised here with an explicit `value` (the walk's own G1 shape,
`tools/notebook_g62_consensus_walk.py`, bypassing only the FMP HTTP fetch). At the tip the type is
`active=True` in `fact_registry.FACT_TYPES` (the owner's 2026-09-25 FMP approval) and the call
returns 200 with `rightsClass=conditional`, `temporalMode=snapshot`, `source=fmp`; reverted, the
router's activation gate (`note_facts.create_fact_observation`) answers the pre-G-062 400.

| step | HTTP status | `active_at_this_step` | notes |
|---|---|---|---|
| tip | **200** | **True** | `rightsClass`/`temporalMode`/`source` all match (`rights_class_ok`/`temporal_mode_ok`/`source_ok` all `true`) |
| through `L13` | **400** | **False** | gone -- exactly at L13's own step (the type is inactive again) |
| through `L12` | **400** | **False** | still gone (L12 does not touch `fact_registry.py`) |

## The never-revert set and every earlier landing's door: unchanged at all three steps

- **The never-revert set** (three fixture notes, levels 0/1/2): `stored_keeps_marker` and
  `stored_has_typed` both `true` at the tip, through `L13` and through `L12`
  (`sandbox/<step>/probe.json` -> `editor`).
- **Every earlier landing's door** (`L1c_switcher_body_recall`, `L1b_admin_notebook_slo`,
  `L1a_unbuildable_body_at_create`, `h203_depth_cap_at_create`, `w9_batch_export_bogus_format`,
  `w8_share_links`, `w8_publish`, `9C_admin_notebook_soak`, `w7_personal_tokens`,
  `w6_note_templates`, `w5_switcher_door`) answers byte-for-byte identically (same status, same
  JSON-ness, same extra keys) at all three steps -- `sandbox/<step>/probe.json` -> `landings`.
- **L7's door** (`input[aria-label="Find in note"]`'s touch-tier `min-height`): **44px** at all
  three steps -- unaffected, since neither L13 nor L12 touches `NoteFindBar.jsx`.
- **L12's door** (`GET /api/j2/notes?sort=updated_asc`): `older_comes_first` is **True** at the tip
  and through `L13` (L12 itself still live at that step), **False** through `L12` (gone exactly at
  L12's own step, as R1e measured) -- `sandbox/<step>/probe.json` -> `L12_sort_updated_asc`.
- **L10's door** (the template-gallery `[data-template-card]` count): **27** at all three steps,
  reached one click through "All notes" at every step -- unaffected, since neither L13 nor L12
  touches `notebookTemplates.js` or `TemplatePicker.jsx`.
- A clean boot and a clean shutdown at every step (table above). Zero page errors
  (`sandbox/<step>/probe.json` -> `dom.page_errors`, `L10_template_gallery.page_errors`) at any step.

## Object-level verification below `L12` (not re-booted)

`python tools/notebook_rollback_chain.py --through wave5` (from the new tip, `a680b0d40`) builds
end to end, exit 0, tree-for-tree consistent with R1e's chain below `L12`
(`chain/chain-through-wave5.jsonl`). `--record-pins --through wave5` returns all **seven** pins
recorded at `599cd44f1` byte-identical (`chain/record-pins-output.json`) -- L13 introduces **zero**
new conflicts anywhere in the chain, so nothing below `L12` needed re-rehearsing on a sandbox (same
split R1c made for wave-8's `Support.jsx` rule, R1d made for L6, and R1e made for L9).

## What was NOT measured here

- In every boot, including the tip, the sandbox's background warm passes attempted real
  Finnhub/FMP calls, most of which were refused (no API key / local FMP budget exhausted in this
  sandbox). This comes from the launcher's warm pass, not the chain. Recorded, not investigated --
  same as every prior lane's rehearsal. It does not affect the G-062 door probe, which uses an
  explicit `value` (the same bypass the walk's own G1 check uses).
- Anything below `L12` (`L10` down to `wave5` + guards): unchanged rules and pins since R1e's
  2026-09-30 rehearsal; verified from objects only (`--record-pins --through wave5`, zero new
  conflicts), not booted.
