# Notebook wave 10 -- the proof instruments' evidence (lane 10E-1)

Raw records are committed BEFORE this interpretation (R-RAW). Every number below cites the raw
file it was read from; a clause this lane did not measure says so and is listed OPEN.

## What ran, on what

| run | tree measured | sweeps | record |
|---|---|---|---|
| evidence walk | `fd7d1f42d` (feat/notebook-w10 at dispatch; the walk tool at `f25aea389`, which changes no product file) | census, geometry, axe complete; silent **stopped by the controller's time-box** at its start; dead-click **not run** | `walk-fd7d1f42d/` (`run.json` first line = the sandbox integrity verdict; `census.json`, `geometry.json.gz` (+ `.sha256` of the plain file), `axe.json`, `integrity.md`, `first-line.txt`) |
| feature -> rail census | `fd7d1f42d` + this lane's ledger citations | -- | `rail-census-fd7d1f42d.json` |
| search recall | `fd7d1f42d` services, synthetic labelled set | -- | `../search-recall-set.json` (baseline block) |
| rails' mutation proofs | this branch | -- | `rails-mutation-fd7d1f42d.log`, `rails-mutation-scorecard-fold.log` |

⚠️ **The measured tree is not what ships.** `origin/master` carries wave 10 Phases I-II (#224);
`git diff --stat fd7d1f42d origin/master -- app/src api` lists 35 files (2,827 insertions, 356
deletions), including `notes.py`, `db.py`, `document_search.py` and `NoteEditorPage.jsx`. A
re-run on the merged tree is OPEN (see the lane report) unless a `walk-<merged sha>/` record
sits beside this one.

Sandbox: `C:\data-w10e1`, port 8215, booted by `scripts/hub_sandbox_boot.py` through
`tools/notebook_perf_harness.Sandbox`; armed gates as `GATES` in the walk (share links, publish,
onboarding, Ask insert, writing help, Compass notes tool, personal API, image/docx documents,
task reminders, email-in, OCR; no model keys).

## Clause by clause

### 2a -- every shipped feature does what it says on every path (the path census)

`walk-fd7d1f42d/census.json`: control VALID (a planted missing door read NO-DOOR, a planted door
that does nothing read BROKEN, on all three doors). 55 inventory rows x desktop / touch /
keyboard = 165 cells: **WORKS 110, N/A 30, NOT-DRIVEN 22, BROKEN 2, NO-DOOR 1.**

- **G-160 keyboard: BROKEN -- a real finding.** "Attach a file" is reached with Tab (x99) and
  holds focus, but neither Enter nor Space opens the file chooser. Read from source (not
  measured further): `NoteEditorPage.jsx`'s `ToolButton` acts on `onMouseDown` only and is
  defined inside the component body, so every toolbar ToolButton (Insert link, Insert image,
  Attach a file, B / I / H1 / H2 / lists / quote / code) is dead to Enter and Space; the text
  formats have keyboard shortcuts, the two inserts and the attachment have no keyboard door.
  (The same remount is why the instrument's first keyboard reach read "not reachable":
  `kb_reach` now re-resolves the locator each press.)
- **G-131 desktop: BROKEN in this run, WORKS in the two shake-outs before it** (shake12,
  shake13; scratch). The probe selects a word then clicks the colour control; under load the
  editor can read the native selection late. Classed as an instrument timing artefact until a
  re-run says otherwise -- NOT a product finding.
- **G-171 keyboard: NO-DOOR in this run, WORKS in shake13.** Same classification: re-run owed.
- NOT-DRIVEN (22) are doors the sandbox cannot exercise (no model key, no camera, no
  microphone, no third-party connector accounts, image upload per door) -- each cell's detail
  says which. N/A (30) are by design (a touch-only control on desktop, split view on a phone)
  or rulings (D4, D6, D10) -- each cell's detail names it.

### 2b -- with a rail (the feature -> rail census)

`rail-census-fd7d1f42d.json` read **RAILED 38, NOT-SHIPPED 11, UNLOCATED 3**: G-080, G-093 and
G-168 cited no implementing file. Commit `faa0f146d` adds the citations (no status changed);
the census then reads **RAILED 41, NOT-SHIPPED 11** and `tests/test_notebook_feature_rail_census.py`
holds it there. The control plants an unrailed row and an unlocatable one.

### 2c -- no dead clicks

**NOT MEASURED.** The dead-click sweep is built and its control was validated in the
shake-out (planted dead, dead-but-styled and live controls read DEAD / DEAD / LIVE), but the
evidence run was stopped by the time-box before it. `walk-fd7d1f42d/deadclick.json` is a record
of that stop (its control never ran, so it reads INVALID with every plant `None`), not a
measurement. OPEN.

### 5d -- no silent failures

**NOT MEASURED in the evidence run.** Its control ran and read VALID (planted swallowed
500 / offline read SILENT, planted honest 500 / offline read SENTENCE); the time-box stop then
ended the driver, so every read and write in `walk-fd7d1f42d/silent.json` is UNREACHED, and the
`findings: 0` that `run.json` carries for this sweep counts nothing. The shake-out (scratch, not
evidence) saw: favourite 500/offline SILENT; lock SENTENCE; the notes list and tasks SENTENCE;
the tasks view's side reads (folders, counts, favourites, recents, tags, saved views, property
definitions) SILENT; the journal shell printing the raw `Failed to load Journal 2.0 settings:`
error text. These are leads for the re-run, not findings. OPEN.

### 6b -- 390 / 820 / 1200 geometry

`walk-fd7d1f42d/geometry.json.gz`: control VALID (a 1400 px element, a 20 px target at <= 1024
and a covered control each found at every width). 54 surface x width cells measured.
Occlusion behind an open modal (a sheet, a dialog, the tour layer) is expected and discounted
(the record keeps it with `by_modal: true`). What remains, triaged:

- **Named finding 1 -- CONFIRMED: the voice first-run hint blocks the editor.** On a new
  member's first note, the hint `New: speak instead of type. Tap the mic ...` covers
  **Add a tag to this note** at 1200, and the formatting row (Font family, Text size, B,
  lists, quote, code, Insert link) at 820 and 390 (`nb-note-first-run` cells).
- **Named finding 2 -- CONFIRMED: the tour card sits over Meet Compass.** On a first visit
  (`nb-first-run`), Meet Compass's **Got it** is covered by the tour card
  (`div._card... "STEP 1 OF 3"`) at 390, 820 and 1200.
- **Named finding 3 -- STATED, not failed: the Journal tab strip scrolls sideways at 390.**
  The record lists Insights and Compass as `reachable_in_scroller` at 390 (reached by a
  sideways swipe of the strip), which is the intended design.
- **New: at 390 the "Skip to notes list" / "Skip to note" link is what a tap on Today and
  Trades hits** (`occluded ... by div._wrap "Skip to notes list"`, hit
  `a._skipLink`) on every Notebook surface at 390. A skip link that intercepts taps while
  visually hidden would make two Journal tabs untappable on a phone; the screenshot has not
  been read -- CONFIRM before fixing.
- **New: Meet Compass covers Unfiled / Archived / Trash at 390** on a first note.
- **New: at 390 the Notebook's `main` is wider than the viewport** on 11 surfaces
  (list, table, board, calendar, timeline, search, bulk, templates, import, saved view,
  publish folder): a horizontal page scroll.
- **Tap targets under 44 px at <= 1024**, most frequent: the "?" help button, the sidebar's
  Daily / Sample notebook rows, the note header's Folder and Ticker selects, row select
  checkboxes, task checkboxes, table header sort buttons, "Clear search", "Search filters",
  "Close insert panel", the importer's Connect Roam / Connect Craft / "How do I get my export
  file?".
- **Leads that need a screenshot before they count** (the instrument cannot tell a control
  scrolled under a sticky header from one covered by a mis-stacked layer): the slash menu's
  Bullet list / Numbered list options under the properties row (`ed-slash`, every width);
  "Clear search" under the search input's wrapper (every width); "Code block language" under
  the editor toolbar at 820 / 1200; sidebar rows under the Journal header at 390.
- **Not the Notebook's:** the voice orb cluster's tucked-right position reads as overflow on
  most surfaces (app chrome, by design).

### 9b -- axe in a real browser, every surface x three themes

`walk-fd7d1f42d/axe.json`: axe-core 4.13.0 (the repo's exact pin), tags `wcag2a`, `wcag2aa`,
`wcag21a`, `wcag21aa`, `wcag22aa` (the last is where `target-size` lives), run in a real Chromium on every walk surface that carries the axe sweep (43
surfaces, the `notebookSurfaces.js` manifest entries each one covers are listed per run) x
dark / oled / light -- signed-out pages once, in their default theme: **123 runs, all
MEASURED, the requested theme applied on every one** (`theme_applied`). Control VALID in all
three themes: a planted low-contrast paragraph and a planted nameless button were reported
each time (`controls.rows`).

**116 runs PASS; 7 fail, on three findings:**

| rule | where | themes | the node | detail |
|---|---|---|---|---|
| `target-size` (2.5.8) | Notebook search: the **Search filters** toggle (`nb-search`) | dark, oled, light | `button._searchFilterToggle` | 22 x 22 px, spacing 22 px; 24 px required |
| `scrollable-region-focusable` | the document preview (`doc-preview`) | dark, oled, light | `div._scroll` | a scrolling region a keyboard user cannot focus or scroll |
| `color-contrast` (1.4.3) | the capture dialog (`capture-dialog`) | light only | `p._hint` "Your own words -- saved as a note." | 4.12:1 (`#74777a` on `#f4f5f6`, 11 px); 4.5:1 required |

Not violations, recorded as axe `incomplete` (axe could not decide; a person must):
`color-contrast` on 33 runs (text over layered or translucent backgrounds) and
`aria-prohibited-attr` on 9.

**Wave 10D's three accessible names are CONFIRMED, not re-reported:** WritingHelpPanel
(`ed-writing-help`), NoteOutline (`ed-outline`) and TextColorMenu (`ed-color`) each PASS in
dark, oled and light, with axe scoped to the opened panel itself (`root: [data-proof-popup]`).

⚠️ The measured tree is `fd7d1f42d`, before master's #224; `NoteEditorPage.jsx` and other
product files differ on master, so a re-run on the merged tree is owed before these rows are
cited as what ships.

### 13c -- measured recall on a labelled set

`docs/notebook/search-recall-set.json` (synthetic: 100 notes, 43 labelled queries; baseline
recorded on `fd7d1f42d`), measured through the search box's own service call
(`notes.list_and_count_notes(q=..., sort="relevance")`) and the switcher's
(`notes.switcher_search`):

| reader | recall@10 | MRR@10 |
|---|---:|---:|
| search box | 0.8837 | 0.8837 |
| switcher (titles) | 0.4147 | 0.4651 |

The search box misses exactly the 3 paraphrase queries and 2 typo queries (keyword search has
no meaning or fuzz). The control plants a ranker regression (the match expression cut to the
first three letters of the first term) that must fall below the baseline -- it does
(`tests/test_notebook_search_recall.py`, mutation-proved).

## Evernote cells (the controller's research)

`evernote-evidence-2026-09-26.jsonl` (byte copy, sha256 `a1420ffc...`): 9 verbatim quotes are
cited in the scorecard tool as browser-read sources (G-001/002/003/013/014/015/023/025 read
PARITY vs Evernote; G-005 cites its quote and stays NOT-VERIFIED because the UCT side is
unconfirmed); the 40 paraphrases are a labelled PARAPHRASE cell kind that can never carry
AHEAD / PARITY / BEHIND. The scorecard itself is NOT rewritten (see the lane report: OPEN).
