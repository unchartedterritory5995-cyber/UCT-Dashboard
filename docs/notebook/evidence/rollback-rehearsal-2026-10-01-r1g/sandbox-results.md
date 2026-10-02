# Sandbox rehearsal results, lane R1g, 2026-10-01

**Method:** `rehearse.py` + `probe.py` in this directory (same method as R1's, R1b's, R1c's,
R1d's, R1e's and R1f's). One data dir, seeded by the tip boot, on port 8242 (first try, port
8231, collided with another session's sandbox independently bound there in the same 8230-8250
band -- the identity proof refused to write and named the mismatch; see "Port collision" below):
the tip `0e7d0561a` (control, seeds the fixtures), `--through L14` (`s-L14`), `--through L13`
(`s-L13`).

## Extraction

Every tree extracted with `git archive` and re-hashed file by file through a throwaway index;
IDENTICAL to its git tree in every run (`sandbox/extract-verify.log`):

- `s00-tip`: tree `e9826c35a1`, 19,024 files
- `s-L13`: tree `d3eecb898c`, 19,016 files
- `s-L14`: tree `fc5d68bd07`, 19,017 files (one more than `s-L13`: the "ours" rule keeps
  `tests/test_tools_pin_the_root.py` at `s-L14`; the revert one step further, at `s-L13`, removes
  it along with the rest of L13's and the rest of the chain's own files)

## Port collision, and why it is recorded rather than hidden

The first `s-L14` boot attempt, on port 8231, failed: another session had independently bound a
hub sandbox to the same port in the same window. The identity proof caught it immediately and
wrote nothing --

> `http://127.0.0.1:8231 is a hub sandbox, but not the one that writes
> ...\r1g-sandbox\t\s-L14\docs\plans\joystick\sandbox-runs\2026-10-01T11-32-19.md: it answers
> identity 5ef2e678fd63... and the log names 4e4605536a2b... (its own log is
> C:\Users\Patrick\uct-worktrees\notebook-w10-ty3\docs\plans\joystick\sandbox-runs\...)`

-- while this lane's OWN uvicorn process failed its own bind with `[Errno 10048]` (the port was
already taken) and shut down cleanly. `shared data root CLEAN (62 db files byte-identical)` at
that shutdown confirms nothing was touched. Moved to port 8242; re-extracted `s-L14` (its first
extraction had been built against the pre-fix chain, before the `tests/test_tools_pin_the_root.py`
rule existed -- see "A mid-lane correction" below) and re-ran clean.

## A mid-lane correction: the first chain build was wrong, and was not used

`chain-through-wave5.jsonl` was built once, before the `tests/test_tools_pin_the_root.py`
conflict was found (see `docs/notebook/wave5-rollback.md`'s history entry), with `MEASURED_AT`
left at `0e7d0561a` and no rule for that file. That build, and the `s-L14` tree extracted from
it, were discarded before any boot used them -- `extract-verify.log` holds only the entries for
the trees that were actually booted (`s00-tip`, `s-L13`, and the SECOND, correct `s-L14`
extraction, tree `fc5d68bd07`).

## Boots -- all three CLEAN

The Notebook gates were set to production's armed values for every boot.

| step | pre-boot | +15s | +120s | shutdown | db files hashed |
|---|---|---|---|---|---|
| `s00-tip` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |
| `s-L14` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |
| `s-L13` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |

Full lines: `sandbox/s00-tip/sandbox-integrity.txt`, `sandbox/s-L14/sandbox-integrity.txt`,
`sandbox/s-L13/sandbox-integrity.txt` (and the `.md` logs behind each).

## L14's doors

### Door 1 -- a locked note refuses all three append doors

`POST /api/j2/notes/{id}/embeds`, `POST /api/j2/notes/{id}/facts/{fact_id}/insert`,
`POST /api/j2/notes/{id}/excerpts` (a real widgetEmbed attrs payload, a real price fact, a real
pypdf-built one-page PDF uploaded as the excerpt's source document -- the same shapes
`api/services/journal_two/test_notes.py::EMBED_ATTRS` and
`tests/test_journal_two_facts_router.py::test_insert_endpoint_refuses_a_locked_note` use), on a
note locked via `PATCH /api/j2/notes/{id}/lock {"locked": true}`.

| step | embeds | facts insert | excerpts | all three refused |
|---|---|---|---|---|
| tip | **423** | **423** | **423** | **true** |
| through `L14` | 200 | 200 | 200 | false |
| through `L13` | 200 | 200 | 200 | false |

Exactly ruling 149's shape: at the tip a locked note refuses every append door; reverted (L14
gone), none of the three checks the lock at all and each takes the capture silently.

### Door 2 -- the public share/publish pages skip the intro

A signed-out, never-provisioned browser context (no member or admin cookie) loading
`/share/n/<token>` and `/p/<slug>` (fake token/slug -- `App.jsx`'s `INTRO_SKIP_PREFIXES` check is
pure pathname-prefix matching, so neither route needs a real note). The
`div[role="dialog"][aria-label="Welcome"]` selector is the same one
`tools/notebook_perf_harness.py::_INTRO_DIALOG_SEL` already uses to find and dismiss
`IntroAnimation`.

| step | `/share/n/:token` | `/p/:slug` | skip working | control: signed-out `/dashboard` |
|---|---|---|---|---|
| tip | absent | absent | **true** | **intro shown** |
| through `L14` | **shown** | **shown** | false | intro shown |
| through `L13` | **shown** | **shown** | false | intro shown |

The control proves the instrument can see the intro when nothing skips it, at every step --
"absent" on the two public routes at the tip is a fact about the route, not about a browser that
can never show it. Checked against the real served bundle in a real browser (R1f's probe pattern
never greps a built JS file's text -- confirmed by reading every probe back to R1's own -- so this
is "checked" in the sense the pattern supports: the actual compiled output's runtime behaviour,
not its minified source text).

## The never-revert set and every earlier landing's door: unchanged at all three steps

- **The never-revert set** (three fixture notes, levels 0/1/2): `stored_keeps_marker` and
  `stored_has_typed` both `true` at the tip, through `L14` and through `L13`
  (`sandbox/<step>/probe.json` -> `editor`).
- **Every earlier landing's door** (`L1c_switcher_body_recall`, `L1b_admin_notebook_slo`,
  `L1a_unbuildable_body_at_create`, `h203_depth_cap_at_create`, `w9_batch_export_bogus_format`,
  `w8_share_links`, `w8_publish`, `9C_admin_notebook_soak`, `w7_personal_tokens`,
  `w6_note_templates`, `w5_switcher_door`) answers byte-for-byte identically (same status, same
  JSON-ness, same extra keys) at all three steps -- `sandbox/<step>/probe.json` -> `landings`.
- **L7's door** (`input[aria-label="Find in note"]`'s touch-tier `min-height`): **44px** at all
  three steps.
- **L12's door** (`GET /api/j2/notes?sort=updated_asc`): `older_comes_first` is **True** at the
  tip, through `L14` (L12 and L13 both still live at that step) and through `L13` (L12 alone
  still live) -- `sandbox/<step>/probe.json` -> `L12_sort_updated_asc`. Unaffected, since neither
  L14 nor L13's revert touches L12's own sort code.
- **L10's door** (the template-gallery `[data-template-card]` count): **27** at all three steps.
- **L13's door** (`POST /api/j2/notes/{id}/facts` with `factType=analyst_price_target_consensus`):
  **200**, `active_at_this_step=true` at the tip and through `L14` (L13 itself still live at that
  step); **400**, `active_at_this_step=false` through `L13` (gone exactly at L13's own step, as
  R1f measured) -- `sandbox/<step>/probe.json` -> `L13_analyst_consensus_capture`.
- A clean boot and a clean shutdown at every step (table above). Zero page errors
  (`sandbox/<step>/probe.json` -> `dom.page_errors`, the two new door probes' own `page_errors`)
  at any step.

## Object-level verification below `L13` (not re-booted)

`python tools/notebook_rollback_chain.py --through wave5` (from the new tip, `c75bf6ea0`) builds
end to end, exit 0, tree-for-tree consistent with R1f's chain below `L13`
(`chain/chain-through-wave5.jsonl`). `--record-pins --through wave5` returns the seven pins
recorded at `a680b0d40` byte-identical, plus the one new pin for L14's own rule -- nothing below
`L13` needed re-rehearsing on a sandbox (same split R1c made for wave-8's `Support.jsx` rule, R1d
made for L6, R1e made for L9, and R1f made for everything below L12).

## What was NOT measured here

- In every boot, including the tip, the sandbox's background warm passes attempted real
  Finnhub/FMP calls, most of which were refused (no API key / local FMP budget exhausted in this
  sandbox). This comes from the launcher's warm pass, not the chain. Recorded, not investigated --
  same as every prior lane's rehearsal. It does not affect either L14 door probe, which use the
  product's own endpoints with no external-vendor dependency.
- Anything below `L13` (`L12` down to `wave5` + guards): unchanged rules and pins since R1f's
  2026-09-30 rehearsal; verified from objects only (`--record-pins --through wave5`, the seven
  carried pins byte-identical), not booted.
