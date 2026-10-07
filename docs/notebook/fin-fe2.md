# Finish program, lane FE2: the acceptance walk's frontend failures

Branch `feat/notebook-fin-fe2`, cut from the integrated landing tip `419ab9fb91`, with lane DATA2
(`origin/feat/notebook-fin-data2`, `ad1b876d2e`) merged in. Source: `docs/notebook/fin-walk.md` on
`origin/feat/notebook-fin-walk`. Each item was verified first, given a failing test, fixed, and
mutation-checked. No file under `api/` was edited.

## Not fixed, or not what the walk said

- **P3 is not a defect.** See below. No product change; the rule is now pinned by a test.
- **A member's own folder reused by the sample cannot be told apart (round 2).** A `foldersOlder`
  row is `{id, name, sentence}` and nothing else. An older example folder and a member's own
  folder the seed reused look the same. The confirmation therefore says the neutral
  `The folder "NAME" was left in place.` for every such row and does not print the server's
  "older example folder" sentence. A flag on the row (for example `memberOwned`) would let the
  client say "your own folder was left untouched".
- **Bulk Move to Trash has no confirm dialog.** The header comment in `ConfirmModal.jsx` lists it,
  but the product trashes at once and shows "Moved 2 notes to the Trash." with Undo. The sweep
  measured the bar's own button instead. The comment was left as it is.
- **The Insights "Reviews" box needs one trade.** With no trades the Insights tab shows its empty
  state and no sections, so the box cannot be reached. The browser check seeded one closed trade.
- **A second floating button was seen and left alone.** On a phone the Journal's gold "Log" button
  stays drawn above the open confirm (visible in `V390_note_delete.png`). It does not overlap the
  Cancel or Delete buttons. It is not a Notebook control.
- **Tour cards do not lock the page.** A walkthrough card points at the page, so it keeps the
  floating buttons. In the walk the Formulas tour's Next was tappable at all three widths.
- **Find similar from the tagged-charts list.** A sample chart listed there still has a "Find more
  like this" button; pressing it now shows the server's "never matched" sentence.

## What was found and done

| Item | Verdict | Commit | Change |
|---|---|---|---|
| P1 confirm under the voice orb | Confirmed | `a02175fa4a` | `ConfirmModal` and `UnsentTrashDialog` lock the page while open (`lib/useBodyScrollLock.js`), the same lock `Sheet` takes. |
| P3 explainer never showed | By design; the walk's reading was early | `3fcc0629b6` | A test of the rule. No product change. |
| P5 controls under 44 px wide | Confirmed | `380cb32522` | Width floors at 1024 px and below. |
| P6 Formulas tour opens on "Step 2 of 5" | Confirmed | `6c6c33bf05` | The counter counts the steps shown, for every tour. |
| P7 honesty when a prerequisite is off | Confirmed | `370128228a`, `32e918229d` | The draft, the Insights box and the board say what is missing. |
| P9 Example card promises a match | Confirmed | `1db9ba65e5`, `32e918229d` | No door on an example; the sheet shows the server's sentence. |
| P8 folders kept after "Remove it" (frontend half) | Built to DATA2's payload | `32e918229d` | The confirmation adds each kept folder's sentence. |

### P1. Why the orb was on top, and why the fix is a lock

The voice orb and the feedback button are shared chrome and were not changed. Both already hide
when a sheet is open: they read `document.body.style.overflow === 'hidden'`
(`hooks/useScrollLocked.js`), which `Sheet` sets. The Notebook's confirm is hand-rolled
(`components/ConfirmModal.jsx`) and never locked the page, so both buttons stayed, and the orb
drew over the dialog.

Every Notebook confirm goes through `ConfirmModal` (a note's Delete, a folder's and a saved view's
Delete, bulk Move to Trash, a version restore, a position's Delete) or `UnsentTrashDialog`. Both
now lock and restore exactly what was there. `components/floatingChromeClear.test.jsx` proves the
lock, proves it is the signal the real hook reads, and holds a census: every `aria-modal` dialog
the Notebook draws itself either locks or is named with its reason (the two tour engines).

### P3. The resurfacing explainer shows once per member, counted from when it appears

The design (`wave14-w14-c1.md`, section f): shown once per member; any row in `notebook_tours`
means seen. The engine writes a `started` row the moment the explainer appears, not when "Got it"
is pressed.

Hiding Get started does not suppress it. A declined offer for another tour does not either. What
happened in the walk: it opened the sheet, counted explainers as soon as the sheet's text was
there (before the explainer's file had loaded), pressed Escape, and from then on that member had
been shown it. Its three later checks used the same member.

`onboarding/RegistryToursGate.explainer.test.jsx` holds each half with the real gate, engine and
registry entry. In the browser, a member with Get started hidden and a dismissed row for another
tour saw the explainer 0.5 s after the sheet, at all three widths, and not on the second open.

A choice for the controller, not made here: whether "shown" should be counted at "Got it" instead.
Today a member who closes the sheet within a second has spent their one showing.

### P5. Measured after the fix (820 and 390 px, touch)

| Control | Before | After |
|---|---|---|
| Chart block toolbar: Hide toolbar, Chart settings, Remove embed | 34 x 44 | 44 x 44 |
| Half, Sync | 39 and 43 x 44 | 44 x 44 |
| All 17 controls in the toolbar | | none under 44 in either direction |
| Reporting soon symbol link ("AMD research") | 41 x 44 | 44 x 44 |
| Template picker family chip "All" | 37 x 44 | 44 x 44 |

The toolbar stays inside its block (it wraps; 188 px tall at 390) and the page has no sideways
scroll. The 37 px "All" the walk listed is the template picker's chip, not a Reporting soon control.

### P6. The counter

`GenericTourEngine.jsx` now keeps the set of steps it passed over. A passed step is in neither
number. The Formulas tour on a note with properties reads Step 1 of 4, 2 of 4, 3 of 4, 4 of 4
(browser, all three widths). If a later step turns out not to be there, the total drops when it
is passed. An older test that pinned "Step 3 of 3" after a skipped step now reads "Step 2 of 2".

### P7, P8, P9. The server says why; the client shows it

- Review draft: `disciplineOmitted.sentence` is printed under a Discipline record heading. The
  Insights box stops promising the discipline record while plan grading is off, and says why.
  An earlier rail pinned "the section is left out entirely"; it now pins the sentence.
- Setups board: the empty state prints `planDrawing.sentence` when a plan cannot be drawn.
- Find similar: status `example` renders `neverMatched.sentence`. A card with
  `similarNeverMatched` shows "Examples are not matched against the day's names." and no button.
- Sample removal: each folder in `foldersKept` adds its sentence to "The sample notes are in Trash."

An older answer without a field falls back to the client's own plain wording.
`serverSaysWhy.finFe2.test.jsx` reads the regenerated contract fixtures. They were recorded with
the switches on, so the "off" cases set only the fields DATA2's record names. P7 and P9 were
checked in a browser in round 2 (below).

## Browser

`tools/notebook_fin_fe2_walk.py`, port 8133, every wave switch on, one fresh paid member per
width. Evidence: `docs/notebook/evidence/fin-fe2/walk-final-32e918229d/` (23 rows PASS, sandbox
integrity CLEAN, port free before and after). Runs 1 to 4 are kept; the failed rows in runs 1 to 3
were the instrument.

| | 1280 | 820 | 390 |
|---|---|---|---|
| P1 voice button before the dialog / while it is open | 2 / 0 | 1 / 0 | 1 / 0 |
| P1 top element at the centre of Delete is the button | yes | yes | yes |
| P1 a tap on Delete deletes the note (GET answers 404) | yes | yes | yes |
| P3 explainer shows, then not on the second open | yes | yes | yes |
| P5 boxes (table above) | not a touch width | pass | pass |
| P6 Step 1 of 4 through Step 4 of 4 | yes | yes | yes |

At 390 the bottom-right corner held the voice button before the dialog and the Delete button
while it was open. The walk's own before picture is
`fin-walk/8852a2a8c0/c1/shots/c1-390-note-CRUD-crud-driver-exception-.png`. No control build with
the fix removed was run this time.

## Round 2

DATA2's final tip (`627a9a9ff3`) is merged. Commits: `11dcf4c5d9` (the `foldersOlder` wording),
`eeccbdf6a2` (a defect the sweep found, below).

### A saved view's Delete did nothing on Research Home (found by the sweep, fixed)

At 390 px a tap on a saved view's Delete button reached the button (touch, mouse and a scripted
click all did) and no dialog appeared. Cause: `NotebookTab.jsx` rendered that confirm inside the
notes-list branch only. The folders panel, with its saved views, is also shown beside Research
Home and beside an open note. There the button set the state and nothing was drawn. It is not a
phone-only defect and it is the same on `origin/master` (`isHome` branch at `NotebookTab.jsx:1964`,
the confirm at `:2217`). Fix: the confirm and its error line sit above the three branches.
Test first in `tabs/NotebookTab.test.jsx` ("on Research Home the Delete button opens the same
confirm"): red with no dialog, green after the move. Evidence of the dead button:
`evidence/fin-fe2/sweep-run3-11dcf4c5d9/` (`walk.json`, `view_before.png`).

### The sweep at 390 px, touch (`tools/notebook_fin_fe2_sweep.py --config sweep`)

Evidence: `docs/notebook/evidence/fin-fe2/sweep-final-eeccbdf6a2/`. 7 rows PASS, sandbox integrity
CLEAN, port 8133 free after. Every wave switch on, one fresh paid member. For each door the walker
read the confirm button's box, asked the page for the top element at its centre, tapped that
point, then asked the product's API whether the thing happened. The voice button count was 0
while each dialog was open.

| Door | Confirm button box | Top element at its centre | Done, per the API or the page |
|---|---|---|---|
| Sample "Remove it" (no dialog) | 73 x 44 | the button | "The sample notes are in Trash."; 0 active sample notes |
| Bulk Move to Trash (no dialog) | 120 x 44 | the button | "Moved 2 notes to the Trash." with Undo; both gone from the list |
| Folder Delete | 84 x 44 at 284,786 | the button | folder gone |
| Saved view Delete (after the fix) | 84 x 44 at 284,786 | the button | view gone |
| Version restore | 91 x 44 at 277,786 | the button | the note reads its first version again |
| Gallery Unpublish (inside its sheet) | 76 x 44 | the button | "Unpublished ..." message |

Runs 2 and 3 are kept. Their three "not reached" rows were: no bulk dialog exists, the saved view
defect above, and the instrument looking for a "History" button whose name is "Version history".

### P7 and P9 at 390 px (`--config off`)

Evidence: `docs/notebook/evidence/fin-fe2/off-final-eeccbdf6a2/`. 7 rows PASS, integrity CLEAN.
Review drafts, setups board and find similar on; plan grading, chart plan and the fingerprint off.

- A daily review draft: under "Discipline record" it reads "Plan grading is switched off, so this
  draft has no discipline record." No "Plan rate" line.
- The Insights box: "... The discipline record is left out: it comes from plan grading, which is
  not switched on for your account."
- The setups board: "No open setups yet. Drawing a plan on a chart is switched off, so no new
  setup can be added here yet." No "Draw an entry line" step.
- Example cards (2): "Examples are not matched against the day's names." and no Find-more button.
- The find-similar sheet opened on an example: "This chart is an example, so it is never matched.
  Tag a chart of your own to find names like it." (answer status `example`).

### Round 2 gates

- Build, then the byte gate: `bytes.notebook_first_open: 2,203,265 B across 56 JS chunks
  (budget 2,260,793 B)`, PASS.
- `npx vitest run src/pages/journal-2-0/a11y src/styles/tapFloor.test.js
  src/pages/journal-2-0/components/notebook/onboarding <the two finFe2 tests>
  FolderSidebar.test.jsx ConfirmModal.test.jsx --maxWorkers=2`:
  `Test Files 95 passed (95)`, `Tests 1131 passed | 1 skipped (1132)`.
- `tabs/NotebookTab.test.jsx`, `a11y/deleteFocusFallback.test.jsx`,
  `components/floatingChromeClear.test.jsx`: `Test Files 3 passed (3)`, `Tests 65 passed (65)`.

## Gates

- Build, then `python tools/notebook_perf_budgets.py --dist app/dist`:
  `bytes.notebook_first_open: 2,203,053 B across 56 JS chunks (budget 2,260,793 B)`, PASS.
- `npx vitest run <named files and directories> --maxWorkers=2` (the whole `a11y/` directory,
  `styles/tapFloor.test.js`, the whole `onboarding/` directory, and every test this lane wrote or
  touched): `Test Files 105 passed (105)`, `Tests 1177 passed | 1 skipped (1178)`.
- Every fix was mutation-checked: the fix broken, a failing test seen, the bytes written back,
  `git diff` compared.
