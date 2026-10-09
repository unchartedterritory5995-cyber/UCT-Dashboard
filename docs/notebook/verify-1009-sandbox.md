# verify-1009: the Notebook items fin-walk did not walk, walked in a local sandbox

Branch `feat/notebook-verify-sbx-1009`, from `origin/master` `1a9a460ab3`. Frontend built from that
tree (`app/dist`). Never production.

- Tools: `tools/notebook_fin_walk.py --config verify` (the orchestrator; config `verify` arms the
  `keyedai` switch set and lets the two model keys through, port 8143) and the new steps module
  `tools/notebook_verify_walk.py`. Started through the key helper. Real Chromium through Playwright,
  1280x800 and 390x844 (touch, `is_mobile`).
- Raw evidence, committed before this file (R-RAW, `3ad088a5f1`):
  `docs/notebook/evidence/verify-1009/sbx/verify/` (`walk.json`, `shots/`, `sandbox-verify.log`,
  `integrity-verify.md`, `project-child-390.log`). Every row named below is a step in `walk.json`.
- One boot, 66 steps: 52 PASS, 7 FAIL, 1 NOT RUN, 6 INFO (the counts are `walk.json`'s; what each FAIL
  means is below).
- Integrity, first line of the boot: `SANDBOX INTEGRITY: CLEAN -- pre-boot (baseline) CLEAN, post-boot
  (+15s) CLEAN, post-prewarm (+120s) CLEAN, shutdown CLEAN; 62 db files hashed; stop: graceful (rc 0)`.
  A development boot held earlier on the same port was also CLEAN at all four checkpoints; its
  evidence is not committed and its data dir was removed. Port 8143 was free afterwards, and the
  sandbox data dirs (`C:\data-verify-sbx`, `C:\data-verify-sbx-dev`) were removed.
- Model use: 6 Ask questions in the committed run (2 from the document sheet, 4 long-note). The
  development runs sent none (`VERIFY_NO_MODEL=1` stops before the question). `STOCK_BRIEF_ENABLED=0`.
- Key scan of the evidence for `sk-`, `sk-ant-`, `Authorization`, `Bearer`: no key. The only `sk-`
  matches are the words `ask-`, `task-` and `disk-`.

## Results

| # | item | 1280 | 390 | evidence (step in `walk.json`) |
|---|---|---|---|---|
| 1a | bulk trash | PASS | PASS | `1 bulk trash`: Move to Trash on top at its centre, both notes leave the list, Undo on top |
| 1a' | bulk trash that empties the notebook | FAIL-PRODUCT (minor) | FAIL-PRODUCT (minor) | `1 bulk trash (all of the member's notes)`, finding P1 |
| 1b | folder delete | PASS | PASS | `1 folder delete` |
| 1c | saved view delete, notes list | PASS | PASS | `1 saved view delete` |
| 1c | saved view delete, Research Home | PASS | PASS | same |
| 1c | saved view delete, beside an open note | PASS | NOT RUN: no door by design | same; the folders panel is hidden at 640 px and below while a note is open (`NotebookTab.module.css`, `.wrap[data-note-open] .sidebarSlot`) |
| 1d | version restore | PASS | PASS | `1 version restore` |
| 1e | gallery unpublish | PASS | PASS | `1 gallery unpublish` |
| 2 | sample chart plan: role buttons and Arm alert | PASS | PASS | `2 sample chart plan` |
| 3 | published page, signed out | PASS (all 7 survive) | PASS (all 7 survive) | `3 published page` |
| 4 | thesis chip sheet on touch | n/a | PASS | `4 thesis chip sheet` |
| 5 | Ask from a Word file's own preview sheet | PASS | PASS | `5 ask from a document's sheet` |
| 6 | chart block drag with the mouse | see below: UNSETTLED for a hand; one mouse path works | n/a (mouse) | `6 chart block drag`, finding P2 |
| 7 | long-note Ask, Research Home | PASS, PASS | PASS, PASS | `7 long-note ask` |

### 1. Confirm buttons: the top element at their own centre

The check, for every confirm: scroll it into view, read `document.elementFromPoint` at the centre
of the button, then press it (a tap at 390) and read the server's answer. Every row also records
where the floating buttons sit (voice orb, joystick, Log) and whether any overlaps the button. None
did, at either width.

- **Bulk trash** has no confirm dialog. That is by design (`components/ConfirmModal.jsx` header): the
  bar's Move to Trash acts at once and leaves a "Moved 2 notes to the Trash." notice with Undo.
  Both buttons are on top at both widths. `POST /api/j2/notes/batch` 200, and both notes leave the
  list.
- **Folder delete**: the dialog is `Delete folder "Verify folder <w>"?`. Its Delete is on top at
  both widths, and the folder is gone from `GET /api/j2/note-folders`.
- **Saved view delete**: one dialog, `Delete view "<name>"?`, opened from the folders panel's
  "Delete <name>" button, with the panel beside the notes list, beside Research Home, or beside an
  open note. Delete is on top in all three places at 1280 and in the two that exist at 390, and the
  view is gone from `GET /api/j2/saved-views`.
- **Version restore**: More note actions, then Version history, then Restore this version. The
  `Restore this version?` dialog's Restore is on top. The note's stored body holds the version-one
  words again, and the History sheet says "Restored. What this note said a moment ago is still saved
  right here in History." (screenshot). The `said` field is null in the committed run because the
  walker read the line before it rendered (an instrument timing gap); the development run read the
  same sentence.
- **Gallery unpublish**: the member saved a template and shared it, and the sandbox admin approved it
  (`PATCH /api/j2/template-gallery/admin/items/<id>` 200). Then the member went to Templates, then
  Browse the community gallery, then Your submissions, then "Unpublish <title>". That opens an inline
  confirm row, not a modal: "Take "Verify gallery <w>" out of the gallery?" with Unpublish and Keep
  it. Unpublish is on top, the screen says "Unpublished ... Copies other members made are theirs and
  stay.", and the template is no longer listed.

### 2. The sample chart plan

The member added the sample notebook and opened "Trade plan: example -- AAPL pullback". Show
toolbar, then Plan. The panel lists three lines, which are stored as entry 180, stop 170 and target
205.

- **Role buttons.** On the entry line the walk pressed Target, then None, then Entry. After each
  press the button read `aria-checked=true` and the stored annotation's role changed to match.
  Autosave did this through `PUT /api/j2/notes/<id>`, with `POST /api/j2/chart-plan/size` re-sizing
  after each press.
- **Arm alert at this level**, on the stop row. `POST /api/j2/chart-plan/alerts` returned 200.
  - The server stored `{sym: AAPL, direction: below, target_price: 170.0, drawing_id: nb:ex-plan:ex-plan-stop, is_active: 1}`.
  - The panel said "Alert armed: AAPL below 170.00. It follows the line if you move it.", and the row
    now shows "Alert armed".
  - Same at both widths. The Arm button was on top at its centre.

### 3. The published-note page

The note held a heading, bold, italic, a link, a bullet list, a 2x2 table with header cells, and a
task list (one item checked, one not). The walk pressed Share, then Publish this note, which gave
`/p/<slug>`. It then opened that page in a fresh, signed-out context, where `/api/auth/me` returned
401.

- **Everything survived at both widths:** the H2, `<strong>`, `<em>`, the link (`target=_blank
  rel=noreferrer`), both list items, the table with TH and TD cells, and both task items with
  `data-checked` true and false.
- The public payload's top-level nodes match the stored note's: bulletList, heading, paragraph,
  table, taskList.
- Observation, not a finding: on the public page the two task checkboxes are not `disabled`. Whether a
  visitor's click changes them was not walked.

### 4. The thesis chip sheet on touch (390)

Setup:
- An IBM note with a chart holding entry 200, stop 190 and target 230, `builtin:thesis_status`
  active, and an open IBM position.
- The note's levels were projected by a child process that calls the app's own
  `note_levels.project_note` (in production the awareness scan's resurface pass does this; see
  `project-child-390.log`).

What the walk saw:
- The row carries a chip named "Thesis note: Active, +16.3% above stop. Open preview.".
- A tap opens a bottom sheet named "IBM thesis 390", showing ACTIVE, Entry $200.00, Stop $190.00
  and Target $230.00.
- Close is on top and shuts the sheet.
- Tapped again, the sheet's "Open note" opens the thesis note.

### 5. Ask from a Word document's own preview sheet

How the file got into the note:
- The .docx (one unique sentence: "The Quillmoor ferry terminal reopens on April 14 after the
  dredging survey.") went in through the member's attachments route.
- The walk then put an `attachmentChip` node in the note body, in the shape the editor's own upload
  inserts (`NoteEditorPage.jsx`). The attachments route alone shows nothing in the body, which is why
  fin-walk 8.4 had nothing to click.

The member's path to a Word file's sheet is Notebook search:
1. Search notes, then "Search your notes", then "Quillmoor dredging".
2. The document hit "quillmoor-memo.docx · p.1" opens the sheet "Preview of quillmoor-memo.docx",
   which carries "Ask a question about this document".

Asked "When does the Quillmoor ferry terminal reopen?". At both widths the answer was "The Quillmoor
ferry terminal reopens on April 14, after the dredging survey [1].", with one chip, "Source 1:
quillmoor-memo.docx · p.1". No invented facts.

Control (INFO): clicking the Word chip in the note body downloads the file and opens no sheet. That is
by design: only a PDF chip opens the sheet (`NoteEditorPage.jsx`).

### 6. Chart block drag with the mouse (1280)

The note was a chart, then Paragraph A, then Paragraph B. Each attempt used a fresh note, and the
stored order was read after it:

| attempt | stored order after | moved? |
|---|---|---|
| A: pointer down on the chart body, 30 moves, up (fin-walk F3's gesture) | widgetEmbed, paragraph, paragraph | no |
| A2: pointer down on the chart body, one move to Paragraph B, up | widgetEmbed, paragraph, paragraph | no |
| A3: as A2, with the chart's top in view first and 10 pointer steps | widgetEmbed, paragraph, paragraph | no |
| B: `locator.drag_to` from the chart body to Paragraph B | paragraph, widgetEmbed, paragraph | **yes** (landed between A and B) |
| C: `page.drag_and_drop` from the chart body to Paragraph B | paragraph, widgetEmbed, paragraph | **yes** (landed between A and B) |
| D: the block grip ("Move this block", `draggable=true`): pointer down, moves, up | widgetEmbed, paragraph, paragraph | no |
| E: `locator.drag_to` from the block grip to Paragraph B | widgetEmbed, paragraph, paragraph | no |
| F: click the block grip, then Move down (its menu) | paragraph, widgetEmbed, paragraph | **yes** |

Plainly:
- **Under Playwright's drag API the chart body moves; a hand-written down/move/up does not.** The two
  send nearly the same input (`frames.js dragAndDrop`: move, down, move, up), and I could not find
  the difference. So whether a person's mouse drag on the chart body moves it is still not settled by
  a synthetic pointer. It needs one check by hand.
- **The block grip does not move the chart by dragging**, by either method, including the one that
  moves it from the body.
- **A mouse path that moves it does exist:** click the grip, then Move down.

See P2.

### 7. The long-note Ask (K1)

Setup: the 1,878-character "PLTR deep dive" (`KA.LONG_PARAS`), plus the two CRWD notes from the
earlier walk. On Research Home, Ask: "What have I written about PLTR: the entry, the stop, the risks,
and my final rule for the trade?".

All four runs (1280 twice, 390 twice) gave:
- entry 26.35 and stop 24.85
- both risks: the Army contract and budget timing, and stock-based compensation near 20 percent
- the final rule, "No adds until the stock closes above 28 for two days in a row"
- 9 to 11 citation chips, all "Source 1: PLTR deep dive"

No "couldn't find", no "cut off", and no invented number or name. **The K1 fix holds in the browser.**
Two of the 390 answers added a sentence about search coverage ("my search covered 3 notes total...").
It is true, but it is extra.

## PRODUCT findings

### P1. Trashing the last notes starts the first-run tour on top of the Undo notice (MINOR)

Steps:
1. A member whose notebook holds exactly two notes opens the notes list, ticks both, and presses
   Move to Trash.
2. The notes go to the Trash (`POST /api/j2/notes/batch` 200), and the notice "Moved 2 notes to the
   Trash. Undo" shows.
3. At the same moment the first-run Notebook tour ("STEP 1 OF 5 Folders and tags") opens as a modal.

Its layer covers the Undo button: `elementFromPoint` at Undo's centre returns `DIV._layer_1i6x5_7`,
at 1280 (Undo at 708,750) and at 390 (256,651). The member cannot press Undo until they press Skip
tour. After that, Undo is on top again.

Evidence:
- `walk.json` steps "1 bulk trash (all of the member's notes)", including
  `modal_dialogs_open_after_trash`.
- Screenshots `verify-1280-1-bulk-trash-all-of-the-member-s-notes--1280-both-notes-leave-the-list-no-confirm-dialog-72f36ae5.png`
  and the 390 equivalent.

Why: the tour auto-starts whenever the note count is known and zero and the tour is neither done nor
dismissed. An emptied notebook meets that test, which reads it as a new member.

Suspect: `app/src/pages/journal-2-0/components/notebook/onboarding/NotebookTour.jsx` (the auto-start
condition, header lines 10-13) and `NotebookTourGate.jsx` (`hasAnyNotes` / `notesKnown`).

### P2. The chart block's grip does not move it by dragging, and can sit off-screen (MINOR, needs one hand check)

- **(a) Dragging the grip does nothing.** The grip "Move this block" (`lib/blockHandle.js`, title
  "Drag to move — or Alt+Shift+↑ / ↓") is `draggable=true`. Dragging it to below Paragraph B left
  the stored order unchanged, both with a hand-written pointer sequence and with `locator.drag_to`.
  The same `drag_to` from the chart's body did move the chart. Clicking the grip and choosing Move
  down moves it.
  - Suspect: the grip's `dragstart` (sets a NodeSelection plus `view.dragging`) for an atom
    `widgetEmbed` (`lib/widgetEmbedNode.jsx`, `draggable: true`, `widgetEmbedStopEvent`).
- **(b) The grip can be placed off-screen.** It is placed beside a block's top edge (`place()`). When
  a tall chart's top is scrolled above the window, hovering the chart puts the grip at y = -27, off
  screen. In the probe, the chart's box was (414, -29, 778, 572). With the chart's top in view, the
  grip is at y = 172.
  - Evidence: step "where the chart's grip sits when the chart's top edge is scrolled above the
    window".

Both are judged from the stored order and the grip's own box, but by a synthetic browser. Because the
hand-written pointer drag and the body `drag_to` disagree for reasons I could not find, this should be
confirmed with a real mouse before anyone fixes it.

## INSTRUMENT notes (walker defects, not product)

- **Folder delete, `dialog_still_open: 1`.** That count is not filtered to visible elements. The
  screenshots show the dialog closed and the folder gone.
- **Version restore, `said: null`.** The walker read the status line before it rendered (see 1d).
- **fin-walk F3's FAIL.** It came from gesture A. Hand-written pointer drags never move the chart
  here, while Playwright's drag API does, so F3's single gesture was not a sufficient test.
- **Setup through the member's own API rather than the page.** Recorded with request and response in
  `walk.json` `api_writes`: notes, folders, saved views, the template, the gallery submission, the
  sample notebook, the IBM position, and the docx attachment plus its chip. The note-level projection
  for item 4 ran in a child process under the launcher's sandbox env.
