# Finish program, lane FE2: the acceptance walk's frontend failures

Branch `feat/notebook-fin-fe2`, cut from the integrated landing tip `419ab9fb91`, with lane DATA2
(`origin/feat/notebook-fin-data2`, `ad1b876d2e`) merged in. Source: `docs/notebook/fin-walk.md` on
`origin/feat/notebook-fin-walk`. Each item was verified first, given a failing test, fixed, and
mutation-checked. No file under `api/` was edited.

## Not fixed, or not what the walk said

- **P3 is not a defect.** See below. No product change; the rule is now pinned by a test.
- **The sweep of other Notebook confirms was not completed in a browser.** Only "Delete this note?"
  was tapped. The walker never reached the bulk Move to Trash confirm (it could not find the row
  checkbox), and folder Delete, saved view Delete and version restore were not opened. They go
  through the same component, so they inherit the fix by construction, not by measurement.
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
the switches on, so the "off" cases set only the fields DATA2's record names. None of P7, P8 or P9
was checked in a browser.

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

## Gates

- Build, then `python tools/notebook_perf_budgets.py --dist app/dist`:
  `bytes.notebook_first_open: 2,203,053 B across 56 JS chunks (budget 2,260,793 B)`, PASS.
- `npx vitest run <named files and directories> --maxWorkers=2` (the whole `a11y/` directory,
  `styles/tapFloor.test.js`, the whole `onboarding/` directory, and every test this lane wrote or
  touched): `Test Files 105 passed (105)`, `Tests 1177 passed | 1 skipped (1178)`.
- Every fix was mutation-checked: the fix broken, a failing test seen, the bytes written back,
  `git diff` compared.
