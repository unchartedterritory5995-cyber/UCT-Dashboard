# Lane FX — raw evidence for wk-7bd834b9f clauses 2b and 6c

Raw stdout captures from the actual sandbox runs (R-RAW), committed before the
interpretation in this lane's handback report. Every run used the real,
unmodified `tools/notebook_proof_walk.py` functions (`World`, `seed`,
`census_sweep`, `geometry_sweep`) called directly against a booted sandbox —
bypassing only `run_sweeps()`'s unconditional `axe.min.js` read (this
worktree's `app/node_modules` junction has no `axe-core` installed, and
neither `census_sweep` nor `geometry_sweep` themselves touch it).

## Item 1 — G-160 (OCR/text from images and docx), census sweep

- `item1-census-G160-ungated-misleading.log` — a FIRST run against a sandbox
  booted via `scripts/hub_sandbox_boot.py` directly, WITHOUT the
  `tools/notebook_proof_walk.py` `GATES` dict applied (that dict is normally
  set by `--boot`'s `os.environ.update(GATES)` before the sandbox subprocess
  is spawned, which inherits it). Missing `NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED`
  made every door read BROKEN ("the .docx never became a document") — an
  artifact of the reproduction setup, not evidence about the product.
- `item1-census-G160-correctly-gated.log` — the corrected run, GATES applied.
  Result: **desktop=WORKS, touch=WORKS, keyboard=WORKS** ("Tab x86 + Enter;
  document status ready"). See the handback report for why this closes the
  finding as instrument-caused (root-scoping, already fixed by `8d08da86f`).

## Item 2 — the skip link

- `item2-skiplink-elementFromPoint-probe.log` — `getBoundingClientRect()` +
  `document.elementFromPoint()` at the skip link's own on-screen position
  (unfocused, 390px, both the Notebook list page and the note editor). Both
  the app shell's own link and the Notebook's own portaled one sit entirely
  above `y=0`.

## Item 3 — FAB / orb / voice-widget occluders

- `item3-geometry-BEFORE.log` — targeted `geometry_sweep()` over
  nb-table/nb-board/nb-calendar/nb-timeline/nb-graph/nb-trash/nb-search/
  nb-note/ed-find/ed-property/nb-list/nb-tasks/settings, before any product
  change, with the real `hit`/`by` fields for every occluded control.
- `item3-geometry-AFTER.log` — the same targeted surfaces
  (nb-timeline/nb-search/ed-find/settings) after the `NotebookTab.module.css`
  and `ConnectedAppsCard.module.css` bottom-padding changes, rebuilt
  `app/dist`, fresh sandbox boot.
- `item3-scroll-mechanism-diagnostic.log` — `mainScrollHeight` vs
  `mainClientHeight` on `document.querySelector('main')` (the APP SHELL's own
  `<main id="main-content">`, `Layout.module.css`, the actual element
  `_geo_read()` scrolls — not `NotebookTab.module.css`'s same-named `.main`
  div) for nb-timeline @390, explaining why the AFTER measurement is
  unchanged: `_geo_read()`'s second reading is `scrollTop += clientHeight*0.8`
  (a FIXED relative hop from 0), not "scroll to the true end" — so padding
  added after the last real content does not move where that fixed hop lands
  for a control that is not at the tail of the scrollable region.
- `census-g160-correctly-gated.json` — the raw census.json for item 1,
  included here since it sits in the same sandbox run family.
