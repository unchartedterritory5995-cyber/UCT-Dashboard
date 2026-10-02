# Sandbox rehearsal results, lane R1h, 2026-10-01

**Method:** `rehearse.py` + `probe.py` in this directory (same method as R1's through R1g's). One
data dir, seeded by the tip boot, on port 8500 (the 8500-8520 band this lane was given, never
8077): the tip `b529c8a78` (control, seeds the fixtures -- this is L15's own commit, the
MEASURED_AT this lane recorded, since nothing trails it in the measured window), `--through L15`
(`s-L15`), `--through L14` (`s-L14`).

## Extraction

Every tree extracted with `git archive` and re-hashed file by file through a throwaway index;
IDENTICAL to its git tree in every run (`sandbox/extract-verify.log`):

- `s00-tip`: tree `7b0fd87e5e`, 19,578 files
- `s-L15`: tree `a25311e3ae`, 19,569 files
- `s-L14`: tree `fad23ce055`, 19,562 files

## Boots -- all three CLEAN

The Notebook gates were set to production's armed values for every boot.

| step | pre-boot | +15s | +120s | shutdown | db files hashed |
|---|---|---|---|---|---|
| `s00-tip` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |
| `s-L15` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |
| `s-L14` | CLEAN | CLEAN | CLEAN | CLEAN | 62 |

Full lines: `sandbox/s00-tip/sandbox-integrity.txt`, `sandbox/s-L15/sandbox-integrity.txt`,
`sandbox/s-L14/sandbox-integrity.txt` (and the `.md` logs behind each).

## L15's doors

### Door 1 -- `/journal/notebook?view=graph` renders the graph view, not Research Home

A2R-03: `viewAll` used to check only `viewParam === 'all' || viewParam === 'tasks'`, so every
other `VIEW_MODES` id (table/board/calendar/graph/timeline) fell through to `isHome` and the URL
rendered Research Home instead. Checked in a real browser against the real served bundle:
`canvas[role="application"]` (the graph canvas, `NoteGraphView.jsx:670`) vs
`h2:has-text("Research home")` (`NotebookTab.jsx`'s `paneHeading`).

| step | graph canvas | Research Home heading | graph view active |
|---|---|---|---|
| tip | **present (1)** | absent (0) | **true** |
| through `L15` | absent (0) | **present (1)** | false |
| through `L14` | absent (0) | **present (1)** | false |

### Door 2 -- a real Shift+/ keypress opens the Keyboard Shortcuts dialog

A2R-04: `useHotkeys` v5 matches a hotkey string against `event.code` (the physical key), not
`event.key`. `'shift+/'` parses to the literal token `/`, which a real Shift+/ keydown's
`code:"Slash"` never equals, so the chord was unreachable from any real keyboard.
`'shift+slash'` names the physical key the matcher expects. Checked by having Playwright
synthesize the real chord (`page.keyboard.press("Shift+/")`, which carries `code:"Slash",
key:"?", shiftKey:true` -- exactly a US keyboard's own event) on `/journal/notebook` with focus
blurred first, and looking for `div[role="dialog"]` titled "Keyboard Shortcuts".

| step | dialog opens on Shift+/ |
|---|---|
| tip | **true** |
| through `L15` | false |
| through `L14` | false |

### Door 3 -- TickerPopup's trigger carries `tabIndex=0` and a key handler

A2R-05: the trigger used to render `<Tag role="button">` with no `tabIndex` and no key handler --
reachable by mouse only on 26 of 37 call sites (every one that does not pass `as="button"`).
FuturesStrip's index-grid tiles (`as="div"`, `FuturesStrip.jsx:154`) are one such site, mounted
unconditionally on `/dashboard` with no live-market-data dependency (the symbol grid is static;
only the price/sparkline numbers are live) -- the IWM tile was used. Checked in a real browser:
the DOM `tabindex` attribute, and whether a synthesized Enter (after `.focus()`) actually opens
the chart dialog (`div[role="dialog"]`) -- not the attribute alone.

| step | `tabindex` | Enter opens the chart dialog |
|---|---|---|
| tip | **"0"** | **true** |
| through `L15` | null (absent) | false |
| through `L14` | null (absent) | false |

### Door 4 -- the PNG export size guard and its refusal message

Checked differently from doors 1-3 -- see the module docstring in `probe.py` and the rule comment
in `rehearse.py::png_guard` for the full reasoning. Reverting L15 removes the guard
(`pickSafeScale`/`HARD_MAX_CANVAS_DIM_PX`/`TOO_LONG_FOR_PNG_MESSAGE`) ENTIRELY -- the squash's own
first sub-commit is what introduces any size check at all -- so the pre-L15 `exportNoteAsPng` has
none and calls the rasterizer directly; triggering that path for real, on a note tall enough to
need the guard, means letting the browser attempt a genuine, unguarded, multi-hundred-megapixel
canvas allocation, precisely the failure this landing fixes. Not reproduced three times against
this box's own memory budget (CLAUDE.md's repeated OOM history). Instead: the literal refusal
text (`"...too long for one PNG image..."`, plain ASCII, survives minification unaltered as a
string literal) was searched in the BUILT `app/dist/assets/*.js` output for each extracted tree,
right after `prepare()`, never over a live click.

| step | assets scanned | message present | found in |
|---|---|---|---|
| tip | 357 | **true** | `NotebookFlagGate-CssHds9m.js` |
| through `L15` | 357 | false | -- |
| through `L14` | 357 | false | -- |

Raw: `sandbox/s00-tip/png-guard-dist-check.json`, `sandbox/s-L15/png-guard-dist-check.json`,
`sandbox/s-L14/png-guard-dist-check.json`.

## The never-revert set and every earlier landing's door: unchanged at all three steps

- **The never-revert set** (three fixture notes, levels 0/1/2): `stored_keeps_marker` and
  `stored_has_typed` both `true` at the tip, through `L15` and through `L14`
  (`sandbox/<step>/probe.json` -> `editor`).
- **Every earlier landing's door** (`L1c_switcher_body_recall`, `L1b_admin_notebook_slo`,
  `L1a_unbuildable_body_at_create`, `h203_depth_cap_at_create`, `w9_batch_export_bogus_format`,
  `w8_share_links`, `w8_publish`, `9C_admin_notebook_soak`, `w7_personal_tokens`,
  `w6_note_templates`, `w5_switcher_door`) answers byte-for-byte identically (same status, same
  JSON-ness, same extra keys) at all three steps -- `sandbox/<step>/probe.json` -> `landings`.
- **L7's door** (`input[aria-label="Find in note"]`'s touch-tier `min-height`): **44px** at all
  three steps.
- **L12's door** (`GET /api/j2/notes?sort=updated_asc`): `older_comes_first` is **True** at all
  three steps -- neither L15's nor L14's revert touches L12's own sort code.
- **L10's door** (the template-gallery `[data-template-card]` count): **27** at all three steps.
- **L13's door** (`POST /api/j2/notes/{id}/facts` with `factType=analyst_price_target_consensus`):
  **200**, `active_at_this_step=true` at all three steps -- unaffected by either revert.
- **L14's two doors -- the hinge of this lane's result.** Both stay ACTIVE at the tip AND through
  `L15` (L14 itself is still live at that step), and flip to their pre-L14 state ONLY once the
  chain reaches through `L14`:
  | L14 door | tip | through `L15` | through `L14` |
  |---|---|---|---|
  | locked note refuses all 3 append doors (423) | **true** | **true** | false (200, no refusal) |
  | public share/publish routes skip the intro | **true** (skip working) | **true** | false (intro shown) |
  | control: signed-out `/dashboard` sees the intro | true | true | true |

  Exactly R1g's own s-L13 measurement, reproduced one step further down the chain.
- A clean boot and a clean shutdown at every step (table above). Zero page errors
  (`sandbox/<step>/probe.json` -> `dom.page_errors`, and each of L15's three behavioural door
  probes' own `page_errors`) at any step.

## Object-level verification below `L14` (not re-booted)

`python tools/notebook_rollback_chain.py --through wave5` (from the new tip, `b529c8a786`) builds
end to end, exit 0, tree-for-tree consistent with R1g's chain below `L14`
(`chain/chain-through-wave5.jsonl`). `--record-pins --through wave5` returns all eight pins
recorded at `c75bf6ea0` byte-identical -- nothing below `L14` needed re-rehearsing on a sandbox
(same split every prior lane from R1c on has made for the chain below its own new top step).

## What was NOT measured here

- In every boot, including the tip, the sandbox's background warm passes attempted real
  Finnhub/FMP/logo-provider calls; the log shows the ticker-logo prewarm finishing with
  `warmed=846 skipped=2694 failed=100` -- some external calls succeed (real internet access),
  others fail for lack of a configured key/budget in this sandbox. This comes from the
  launcher's warm pass, not the chain. Recorded, not investigated -- same as every prior lane's
  rehearsal; it does not affect any of the four door probes, which use only the product's own
  endpoints and static/local fixtures.
- The PNG export size guard's refusal path (door 4) was checked against the built bundle's own
  text rather than by clicking PNG export on an oversized note and letting the browser actually
  attempt the canvas allocation -- see door 4's own section above for the full reasoning. This is
  the one door in this lane's rehearsal checked differently from the "real browser, real served
  bundle" method the other three (and every door back to R1's own) use.
- Anything below `L14` (`L13` down to `wave5` + guards): unchanged rules and pins since R1g's
  2026-10-01 rehearsal; verified from objects only (`--record-pins --through wave5`, all eight
  pins byte-identical), not booted.
