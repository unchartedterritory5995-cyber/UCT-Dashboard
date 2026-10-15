# Notebook screen-reader pass -- the owner's script

Wave 8, lane 8A (A6). Written 2026-09-26 against `feat/notebook-w8` at `120aadf66`.
**NVDA half RUN 2026-10-09 (NVDA 2026.2, Chromium, production, the smoke account) by `tools/notebook_nvda_pass.py` -- see "Result" below the table. The VoiceOver half has NOT been run: no Mac and no iPhone were at hand.**
Every expected announcement is quoted from the source that produces it, with
`file:line` (paths under `app/src/pages/journal-2-0/` unless they start with `app/`
or `api/`). If a line has moved, the quote is what to look for -- and a quote that
no longer exists in the file is itself a finding.

## Preconditions -- read before step 1

- **Target URL, one of:**
  - the sandbox: `python scripts/hub_sandbox_boot.py` (pass the data dir from
    PowerShell or single-quoted), `app/dist` rebuilt from the tip under test, and a
    **paid** account on that data dir (every Notebook route redirects a free account); or
  - production, signed in as the smoke account through
    `python tools/smoke_login_link.py` (prints a one-use link, valid minutes).
  - ⛔ **Never a typed password on a mirrored phone** (CLAUDE.md, "HOW A LIVE DEVICE
    SIGNS IN"). A BrowserStack Live device signs in with the link, nothing else.
- **NVDA on Windows** (free, nvaccess.org). NVDA is **not installed on this box**
  (checked 2026-09-26: no `C:\Program Files*\NVDA`). Install the current stable release
  and write its version here before starting: `NVDA version: 2026.2` (filled 2026-10-09)
  (NVDA menu, Help, About). Firefox or Chrome; browse mode unless a step says focus mode.
- **VoiceOver on macOS Safari** (Cmd+F5), and **VoiceOver on iOS Safari** if an iPhone
  is at hand. Record: `macOS ____ / Safari ____ / iOS ____`. **Not available this pass (2026-10-09): no Mac, no iPhone.**
- ⚠️ **Whether BrowserStack Live exposes VoiceOver is NOT verified.** A Live session is
  a screen mirror; nobody has checked that VoiceOver speech or its rotor reach the
  operator through it. Do not record a VoiceOver result from Live unless you actually
  heard it; write "not verifiable on Live" instead.
- **A note to read.** Before step 10, create a note titled `SR pass` with: a line
  `## Setup` (a level-2 heading), one paragraph, and a table from `/table`
  (3 x 3, header row) with `Sym`, `R` in the header. Keep the account with at
  least three notes, one folder with a subfolder, one tag and one saved view.
- Columns: **PASS** = heard what the Expected column says (wording may differ in
  punctuation only); **FAIL** = anything else; **Notes** = what you actually heard.

## Steps

| # | Keys | Expected announcement (quoted from source) | Source | PASS / FAIL | Notes |
|---|---|---|---|---|---|
| 1 | Open `/journal/notebook?view=all`. Press **Tab** once. | `"Skip to notes list"`, link -- the first thing the tab offers, visible only now | `tabs/NotebookTab.jsx:1414` | **PASS** | r7. Heard the window, the document, then `clickable Skip to notes list link`. |
| 2 | **Enter** on the skip link. | `"All notes"`, heading level 2 (visible while focused) | `tabs/NotebookTab.jsx:1565`, words at `tabs/NotebookTab.jsx:485` | **PASS** | r7. `All notes heading level 2` after a Compass hint (`Meet Compass ...`) that the home also announces. |
| 3 | Shift+Tab to the top of the sidebar, then Tab. | `"Hide folders panel"`, button; then `"Panel view"`, tab list, `"Show folders"`, tab, selected | `components/notebook/FolderSidebar.jsx:1260`, `:1265`, `:1273` | **PASS** | r7. `Hide folders panel button`, `Panel view tab control`, `Show folders tab selected`. |
| 4 | Tab to the **All notes** row. | `"All notes"` plus its count, button, **current** | `components/notebook/FolderSidebar.jsx:1641`, `:1638` | **PASS** | r7. `Folders tree view level 1 All notes 2 button current`. |
| 5 | Tab to a folder with a subfolder; Tab to its disclosure. | the folder name, button; `"Expand <folder>"`, button, collapsed -- Enter says expanded | `components/notebook/FolderSidebar.jsx:640` | **PASS** | r7, keys differ from the script: the sidebar is a roving TREE (`lib/useTreeRoving.js`); its buttons are tabIndex -1, so Tab never reaches a disclosure. With NVDA in focus mode, Down walked `Unfiled, 2 of 5`, `Archived, 3 of 5`, `Trash, 4 of 5`, `SR folder collapsed 5 of 5 level 1`; Right said `expanded`. ⚠️ Focus lands on a BUTTON inside the treeitem, so NVDA does not enter focus mode by itself (Insert+Space was needed; in browse mode the arrows never reached the tree -- r3). |
| 6 | Enter on a folder row, then Tab along its row. | the folder name, button, **current**; then `"Rename <folder>"`, `"Add subfolder to <folder>"`, `"Delete <folder>"`, buttons | `components/notebook/FolderSidebar.jsx:679`, `:698`, `:705`, `:712` | **PASS** | r7, keys differ from the script: Enter said `selected`; the row's actions are not Tab stops but a menu on Shift+F10: `Rename 1 of 4`, `Add subfolder 2 of 4`, `Delete 3 of 4`; Escape returned to `SR folder expanded 5 of 5 level 1`. |
| 7 | Move to the tags (NVDA: **H** / **Tab**). | `"Tags"`, grouping; a tag row reads as button, current when selected; `"Expand tag <path>"` on a nested tag | `components/notebook/FolderSidebar.jsx:1811`, `:444`, `:541` | **PASS** | r7. `#srpass 1 button` (the tag row, with its count). |
| 8 | Move to saved views; open the section; select a view. | `"Expand Saved Views"`, button; the view's name, button, **current** once chosen | `components/notebook/FolderSidebar.jsx:286`, `:329` | **PASS** | r7. The section opens expanded, so its disclosure reads `Collapse Saved Views button expanded`; then `SR view button`. |
| 9 | Clear the view (All notes). Tab to the sort control, then the view switcher; **Space** on Table. | `"Sort notes"`, combo box, `Recently updated`; `"List view"`, toggle button, pressed; `"Table view"`, toggle button, not pressed -> pressed | `tabs/NotebookTab.jsx:1709`, `:1750-1751`; labels `lib/savedViewModes.js:24-25` | **PASS** | r7, keys differ from the script: `Notes list tools` is one Tab stop (a tool bar); Right moved `Sort notes combo box Recently updated` -> `List view toggle button pressed` -> `Table view toggle button not pressed`; Space said `pressed`. NVDA entered focus mode by itself on the combo box. |
| 10 | Back to List. Tab to the `SR pass` card, **Enter**. | ⚰️ CORRECTED 2026-10-01 (A2R-02, second a11y review) -- this said focus lands IN the title field; it does not, for an EXISTING note, deliberately ("Final-review fix I-1"). Focus lands on the note's own HEADING: `SR pass`, heading level 2 (sr-only, named by the title) -- NOT `"Note title"`, edit. The pane carries a visible gold ring for it (`.notePane:has([data-note-landmark]:focus-visible)`, `NotebookTab.module.css:107`). Only a BRAND-NEW note (just created, never one reopened from the list) focuses the title field instead. | `components/notebook/NoteCard.jsx:126`; `components/notebook/NoteEditorPage.jsx:906-916`, `:3498` (the landmark); `:4174` (`aria-label="Note title"`, the new-note case only) (focus rail `a11y/focusFlows.test.jsx`) | **PASS** | r8. `List view toggle button pressed`, the card `SR pass ... button`, Enter: `SR pass heading level 2` (the A2R-02 correction holds). |
| 11 | Tab, Tab ... through the note. | `"Subtitle"`, edit; `"Editor toolbar"`, tool bar; ... `"Note body"`, edit, multi line | `components/notebook/NoteEditorPage.jsx:3578`, `:3284`, `:1771` | **PASS** | r8. Order heard: Add to Favorites, Ask, Find in note, Share, Folder, Ticker, Writing help, Outline, More note actions, `Editor toolbar tool bar` (ONE stop), Note title, `Subtitle edit`, Tags, Add a tag, Add property, Suggest values, then a `Table tool bar` of TWELVE Tab stops (Add a row above ... Delete table), then `Note body section multi line editable`. 29 Tabs from the heading to the body. ⚠️ Finding F2 below. |
| 12 | In browse mode, **H** to the heading, then **T** to the table; arrow through two cells. | `Setup`, heading level 2; table with 3 rows and 3 columns; column headers `Sym`, `R` read with each cell | table extension `lib/tiptap.js:18` (TableHeader renders `<th>`) | **PASS** | r7. H: `Note body ... heading level 2 Setup`; T: `table with 3 rows and 3 columns row 1 column 1 Sym`; arrows: `column 2 R`, `column 3`. |
| 12b | Focus mode, caret in a table cell: **Tab** twice, then **Alt+F10** (Mac: **Option+F10**), then **Escape**. | Tab moves cell to cell (at the LAST cell it adds a row -- measured in the browser pass); Alt+F10 lands on the `"Table"` tool bar (first button `Add a row above`); Escape returns to the cell. This is the way out of a table: Ctrl+Home does NOT leave it | `components/notebook/TableToolbar.jsx:126`; listed in `components/ShortcutCheatSheet.jsx:84` | **PASS** | r7. Tab, Tab moved cells (`row 3 Note column 3 late`); Alt+F10: `Table tool bar`; Escape returned to the cell. |
| 13 | Focus mode in the body (NVDA **Insert+Space**). At the end of a line type **/** then **Down**. | the body becomes a combo box, expanded; `"Insert block"`, list; the active option read as you move (`Heading 1` ...) | `lib/comboboxWiring.js:26`; `components/notebook/SlashMenu.jsx:444`, `:29` | **PASS** | r7. `slash`, `Insert block list`, `Heading 1 Big section heading 1 of 32`, Down: `Heading 2 ...`. |
| 14 | **Escape**. | the menu closes; you are still in `"Note body"` with the caret where it was (nothing else is said) | focus rail `a11y/focusFlows.test.jsx` ("Escape in the slash menu") | **PASS** | r7. `Note body section multi line editable`, nothing else. |
| 15 | Type **[[** and a few letters of another note; **Down**, **Enter**. | `"Link to a note"`, list; the note titles as options; after Enter the chip reads as a button named for the note | `components/notebook/NoteLinkMenu.jsx:74`; `components/notebook/NoteLinkView.jsx:50` (loading / trashed wording) | **PASS** | r7, with two notes on the account: `Link to a note list`, `SR pass 1 of 2`, `SR target note 2 of 2`; Enter returned to `Note body`. ⚠️ The trigger needs a space or a line start before `[[` (after the `/` row 13 leaves, `/[[SR` opened nothing -- r5) and the menu closes on a space inside the query (`SR tar` -- r3). Type letters without a space. |
| 16 | **Ctrl+F** (Mac: **Cmd+F**). Type a word. | `"Find in note"`, search landmark; `"Find in note"`, search box (focus is in it); the match count is read | `components/notebook/NoteFindBar.jsx:198`, `:223` | **PASS** | r7. `Find in note search landmark`, `Find in note edit`, then the count as each letter lands (`s 1/6`, `t 1/2`, `o 1/1`). |
| 17 | **Ctrl+H** (Mac: **Cmd+Option+F**, appendix A). Tab to the replace field. **Escape**. | `"Hide replace"` / `"Show replace"`, button; `"Replace with"`, edit; Escape returns you to `"Note body"` | `components/notebook/NoteFindBar.jsx:206`, `:298`; `components/notebook/NoteEditorPage.jsx:556` (closeFind) | **PASS** | r7, keys differ from the script: Ctrl+H showed the replace row (DOM: `Hide replace` x1, `Replace with` x1), but from the find box it is SIX Tabs away (Match case, Whole word, Previous match, Next match, Close find, then `Replace with edit`, `Replace button`); Escape: `Note body`. |
| 18 | Tab to Ask; **Enter**. | `"Ask a question about this note"`, button, collapsed -> expanded; the panel `"Ask This note"`; focus in `"Your question about This note"`, edit | `components/notebook/AskPanel.jsx:300` (scope label `:33`), `:307`, `:325` | **PASS** | r7. `Ask a question about this note button collapsed` -> `expanded`, `Ask This note dialog`, `Your question about This note edit`. |
| 19 | Ask something the note does not contain (e.g. `What is the dividend?`), **Enter**, wait. | the answer is read politely, without moving focus: `"I couldn't find that in this note."` | live region `components/notebook/AskPanel.jsx:357`; sentence `api/services/journal_two/ask_service.py:55` | **PASS** | NVDA spoke `I couldn't find that in this note.` in EVERY run (its log: 02:43:55, 02:51:47, 03:01:28, 03:06:18, 03:10:52 CT), once as the focused answer block is read. ⚰️ Graded FAIL for seven runs by a grader that could not read a double-quoted string -- see "The instrument fault" below; withdrawn 04:20 CT. |
| 20 | Tab to `"Close Ask"`, **Enter**. | the panel closes and focus is back on `"Ask a question about this note"`, button | `components/notebook/AskPanel.jsx:320`; `components/notebook/NoteEditorPage.jsx:3140` | **PASS** | r7. `Close Ask button`, then `Ask a question about this note button collapsed`. |
| 21 | Leave the note (browser **Back**). Choose **Graph view**. Tab to `Show as list`, **Space**. | `"Graph view"`, toggle button; `"Show as list"`, toggle button, not pressed -> pressed; a table `"Notes in the graph, by title"` with `Note`, `Links`, `Linked notes` headers; each title a button | `lib/savedViewModes.js:28`; `components/notebook/NoteGraphView.jsx:537`, `:543` | **PASS** | r7 (after a reload). `Graph view toggle button`, `Show as list toggle button not pressed` -> `pressed`, the list's table. |
| 22 | **Space** again (back to the picture). Tab to the canvas; **Home**, then an **arrow**, then **Enter**. | `"Note graph: <n> notes, <m> links"`, application, then the key instructions; after Home: `"<title>, <n> links"`; the arrow names the next note; Enter opens it | `components/notebook/NoteGraphView.jsx:589`, `:591`, `:599`, `:603` (words `:518`) | **PASS** | r7. `Note graph: 2 notes, 1 link` + the key instructions (`application`); Home: `SR pass, 1 link`. |
| 23 | From the list, Tab to `Save view`, **Enter**; then **Escape**. | `"Save view"`, dialog, focus IN `"Name"`, edit (you can type at once); Escape closes it and focus is back on `Save view`, button | `tabs/NotebookTab.jsx:1783`; `components/notebook/SavedViewEditor.jsx:36`, `:38`; `app/src/components/mobile/Sheet.jsx:98` | **PASS** | r7. `Save view button`, `Save view dialog`, `Name edit` (focus in it); Escape: back on `Save view button`. |
| 24 | Open a note, Tab to `Delete`, **Enter**; confirm. | `"Delete this note?"`, dialog; after confirming you are on the NEXT note's card in the list (or on the list heading if it was the last) | `components/notebook/NoteEditorPage.jsx:3242`; `components/ConfirmModal.jsx:36`; focus rail `a11y/focusFlows.test.jsx` | **PASS** | r7, keys differ from the script: Delete sits inside `More note actions button collapsed` (a disclosure), not on the Tab path. `Delete button`, Enter: `Delete this note? dialog`, `Cancel button`, `Delete button`; after confirming, focus landed on `Research home heading level 2` (the note was opened by URL, not from the list, so the next-card landing was not exercised). |
| 25 | **If the account has no notes:** open the Notebook home. **If the tour is on:** let it start. | `"Welcome to your Notebook"`, heading level 2. Tour: lane 8C's -- a stub at the time of writing; re-read `components/notebook/onboarding/NotebookTour.jsx` for its words before running | `components/notebook/ResearchHome.jsx:182`; `components/notebook/onboarding/NotebookTour.jsx:1` | **PASS** | r7. `Welcome to your Notebook heading level 2`. The tour DID start in r3/r5 (`Folders and tags dialog STEP 2 OF 3 Your folders, tags and saved views live here ...`). |
| 26 | **If sharing is on:** in a note, Tab to `Share`, **Enter**, Tab, **Escape**. | `Share`, button, has pop-up dialog, collapsed; `"Share this note"`, dialog; `"Share link address"`, edit; Escape returns focus to `Share` | lane 8B's `components/notebook/NoteShareControls.jsx:78`, `:86`, `:236` | **NOT RUN** | NOT RUN on purpose: it mints a public share link for a note on the smoke account. Owner's step. |
| 27 | Anywhere in the Journal: **?** | `"Keyboard Shortcuts"`, dialog; under Notebook, the graph rows (`Graph view: move to the nearest note in that direction` ...) | `components/ShortcutCheatSheet.jsx:139`, `:75` | **PASS** | r8. The page saw `?/Slash+shift`; `Keyboard Shortcuts dialog`, `Close button`, the Notebook rows (`Go to Notebook g THEN n` ...). (r6/r7 FAILED this row because the driver sent a zero scan code, so `KeyboardEvent.code` was empty -- a driver fault, fixed in r8.) |

## Result -- NVDA 2026.2, 2026-10-09, production, the smoke account

**26 PASS · 0 FAIL · 1 NOT RUN** (the table above; row 26 is the NOT RUN). ⚰️ This read **26 · 1 · 1**
for about an hour, with row 19 as the FAIL and a "defect F1" under it, until the grader was found to be
deaf to apostrophes (below). The VoiceOver half was
not run: no Mac and no iPhone were at hand, and a BrowserStack Live mirror has never been shown to
carry VoiceOver speech (precondition above), so it is recorded as **not available**, not as passed.

**How it was run, honestly.** `tools/notebook_nvda_pass.py` drove the 27 rows with real OS key
events into a headed Chromium signed in as `smoke@uctintelligence.internal`, with the fixtures the
preconditions ask for made through the API (the `SR pass` note with its `## Setup` heading, a
paragraph and a 3 x 3 table with `Sym`, `R` headers; an `SR target note`; `SR folder` with `SR
subfolder`; the tag `srpass`; the saved view `SR view`) and removed in `finally` (0 active notes, 0
SR folders, 0 SR views left after every run). **The ear is NVDA's own input/output log** (`-m
--log-level=12`), where every utterance is a `Speaking [...]` line: a row PASSES when every quoted
phrase of its Expected column was spoken in that row's window. It measures what NVDA SAID, not what a
listener would understand; the Notes column quotes the speech. The run of record is
`evidence/screen-reader/nvda-2026-10-09-r7.json` (full), with rows 10, 11 and 27 re-checked in
`...-r8-rows-10-11-27.json` after two driver faults (below). r1-r6 are kept as the driver's history;
each `.speech.log` beside a record is NVDA's speech for that window (lines carrying an `@` dropped).

**Findings, in order of weight.**

- **F1 -- WITHDRAWN. "The Ask answer is never spoken (row 19)" was the grader's fault, not the
  product's.** It was written here as a DEFECT with a mechanism read from `AskPanel.jsx` (a live
  region mounted together with its text), fixed twice (#295 an sr-only announcer, #296 a deferred
  write), each fix "verified still failing" on production by the same grader, and both fixes
  reverted (#297) once NVDA's own log was read directly: the sentence was spoken in every run,
  the untouched code included, as NVDA read the answer block that takes focus when the answer is
  done. The two fixes had added a second, duplicate announcement (r9/r10 logs: the sentence twice,
  600 ms apart). **The instrument fault** is in the next section. What stays true from the
  investigation, measured on a local page with NVDA (`scratchpad/fin/live_region_probe.py`, all
  apostrophe-free sentences, so the ear was sound there): a pre-existing polite region written once
  IS spoken; a region that arrives already holding its text is NOT; a pre-existing region held
  `aria-busy` through a stream and released at the end is NOT. The production panel is spoken
  because focus moves to the answer, not because of its `aria-live`.
- **F2 -- the Table tool bar is twelve Tab stops (row 11).** From the note heading, Tab reaches the
  body on the 29th press: ... Suggest values with Compass, then `Add a row above`, `Add a row
  below`, `Delete this row`, `Add a column to the left`, `Add a column to the right`, `Delete this
  column`, two sort buttons, narrower, wider, `Header row`, `Delete table`, then `Note body`. The
  Editor toolbar two stops earlier is ONE Tab stop (a tool bar with arrow roving). The two toolbars
  disagree, and the twelve stand between the properties row and the body on every note with a table.
- **F3 -- the folder tree needs NVDA focus mode, and does not trigger it (rows 5, 6).** The sidebar
  is a roving tree (`lib/useTreeRoving.js`): arrows move, Right expands, Shift+F10 opens the row's
  menu (`Rename`, `Add subfolder`, `Delete`). All of it worked in focus mode. But focus lands on a
  BUTTON inside the treeitem, so NVDA stays in browse mode by itself and the arrows go to its review
  cursor instead (r3: Down read `A`, `notes`). A member who does not know Insert+Space cannot reach a
  folder's disclosure or its actions by keyboard. (The `Notes list tools` tool bar, row 9, is fine:
  its first control is a combo box, which NVDA does switch for.)
- **F2 and F3 FIXED, 2026-10-09 (#300, live from the 08:50 CT pod).** F2: `TableToolbar.jsx` runs
  `useToolbarRoving`, one Tab stop with arrow roving, Escape back to the cell, Alt+F10 to the stop
  (rail `TableToolbar.oneStop.test.jsx`). F3: `lib/useTreeRoving.js` moves focus that arrives on a
  button or link inside a tree row onto the `[role="treeitem"]` itself, so the focused element is the
  treeitem whatever put focus there (rails in `FolderSidebar.tree.test.jsx`, `useTreeRoving.test.jsx`,
  `focusFlows`, `deleteFocusFallback`). ⚠️ A correction to F3's wording above: on master the Tab stop
  was ALREADY the treeitem; what put focus on the button in rows 4-6 was this driver's own
  `focus_role("button", "All notes")`, a programmatic focus of the kind an assistive technology or a
  pointer press also produces. The fix covers every such path, and the finding stands for those paths,
  not for a plain Tab. **Re-check on production (r12, `nvda-2026-10-09-r12-post300.json`): row 4
  PASS** -- the All notes button was focused programmatically and NVDA said `Folders tree view, level 1,
  All notes`, i.e. the focused element was the treeitem and NVDA was in focus mode with no Insert+Space.
  Rows 5, 6 and 11 were INCONCLUSIVE in r12 and r13 (the owner's TC2000 window took the OS
  foreground mid-sequence both times and the guard withheld the keys, as designed after r1), then
  **re-run clean on the owner's "RUN IT" at ~11:25 CT: r14 rows 4, 5, 6 PASS; r15 rows 10, 11 PASS**
  (`nvda-2026-10-09-r14-post300.json`, `-r15-post300.json`; fixtures removed 0/0/0 both runs).
  Measured: row 4 `activeElement` role `treeitem` after the button was focused; row 5 arrows moved
  `Unfiled 2 of 5`, `Archived 3 of 5`, `Trash 4 of 5`, `SR folder collapsed 5 of 5` with NO
  Insert+Space, focus role `treeitem` before and after; row 6 Shift+F10 read `Rename 1 of 4`,
  `Add subfolder 2 of 4`, `Delete 3 of 4`; row 11 **18 Tabs from the heading to the body, was 29**,
  `Table tool bar` spoken once, then `Note body`. r14's rows 10/11 FAILED for a driver reason only
  (under `--only` the list was still filtered to the SR folder, so the test note was not on screen);
  the driver now clears the folder filter before opening the note, and r15 is the measurement.
  ⚠️ Teardown: quit NVDA with `& 'C:\Program Files\NVDA\nvda.exe' -q` from PowerShell (a Git Bash
  path call answers "Permission denied", and `Stop-Process` from a bash-spawned shell was "Access is
  denied"); r15's NVDA kept narrating the owner's desktop until another session killed it. Next run
  should start NVDA with `--config-path` pointing at a config whose synth is `silence`: the level-12
  log still carries every `Speaking [...]` line, and nothing is read aloud at the desk.
- **F4..F7 -- the script's keys predate the product** (rows 5, 6, 9, 17, 24): "Tab to its
  disclosure" / "Tab along its row" (tree), "Tab to the view switcher" (tool bar), "Tab to the
  replace field" (six Tabs: Match case, Whole word, Previous match, Next match, Close find, then
  `Replace with`), "Tab to Delete" (inside `More note actions`). Each row PASSES on the sounds once
  the right keys are used; the Notes column carries the keys. Row 15's `[[` needs a space or a line
  start before it and closes on a space inside the query.

**The instrument fault, and why it survived seven runs.** NVDA logs a speech sequence as a Python
list repr. A string is written with single quotes -- unless it contains an apostrophe, when Python
writes it with double quotes: `"I couldn't find that in this note."`. The grader's regex read
single-quoted strings only, so every utterance with an apostrophe was invisible to it, and the one
sentence this pass most needed to hear has an apostrophe in its second word. The blind spot was
consistent, so it looked like a stable product fact: the same row failed the same way every time,
the DOM probe showed the sentence present, and the story ("mounted with its text, so never a
change") was a real live-region mechanism that happened not to be the one in play. What broke the
spell was a diagnostic whose control sentences had no apostrophes and were "spoken" while the real
sentence, written by hand into the same node, was "not" -- a difference the product could not have
produced. ⭐ The ear now reads both quote styles and `tests/test_notebook_nvda_pass.py` pins the exact
line that fooled it. The rule it leaves behind: **walk the ear against its own blind-spot list before
grading, and a finding that only one instrument can see is a census of one** (the same shape as the
quantised-instrument and own-blind-spot lessons in CLAUDE.md).

**The re-grade run (r11, 04:34 CT, the reverted code #297 live, the fixed ear):** row 19 PASS -- the
sentence spoken, twice (once as the focused answer block is read, once from the block's own
`aria-live`; a double announcement that was there before any fix and is noted, not ruled on); 26
PASS, 1 NOT RUN, and one FAIL that is the driver's: row 12's **H** said `no next heading` because
row 11's Tabs had left NVDA's browse cursor BELOW the heading, in the table; **T** still found the
table. r7 passed the row from above. `nvda-2026-10-09-r11-regraded-post297.json`.

**Driver faults found on the way, kept because the next runner will hit them.** (1) `SendInput`
types into the OS foreground window, and `page.bring_to_front()` does not change it: r1 typed seven
minutes of keys into another browser. The tool now verifies, before EVERY key, that the window
carrying its run nonce is Playwright's own browser and is `GetForegroundWindow()`; otherwise no key
and INCONCLUSIVE. (2) Arrows, Insert, Home and End need `KEYEVENTF_EXTENDEDKEY` or they arrive as
numpad keys, which NVDA's desktop layout binds to its review cursor and swallows (r4/r5). (3) A zero
scan code reaches the page as an empty `KeyboardEvent.code`; the Journal's `?` matches on
`code: "Slash"` (r6/r7 failed row 27 for that reason, r8 passed it).

## Steps 28-38 -- Journal styles (P1) and the trader blocks (P2)

Added 2026-10-13 (Notebook P2b, task 15 step 1) on `notebook-p2b-nvda`. **NOT RUN YET**: these rows are
written and the driver has a step for each; the run (NVDA muted) is the integrator's, before the flag is
armed. They are kept out of the table above so the 2026-10-09 result record still describes exactly
the rows it ran.

- **The switch.** Every surface below exists only while `NOTEBOOK_JOURNAL_STYLES_ENABLED` is on for the
  server under test (`api/routers/auth.py` `NOTEBOOK_FLAGS`, unset means OFF). The client learns it from
  the auth payload: key `notebook_journal_styles_enabled` on `/api/auth/me` (`_notebook_flags`, merged by
  `_access_payload`), latched as a boolean by `lib/offline/notebookFlags.js` and read by
  `lib/journalStylesFlag.js`. `tools/notebook_nvda_pass.py` reads the same key from its own `/api/auth/me`
  and, when it is absent or anything but `true`, records every row here **NOT RUN** with the reason
  `journal styles switch is off on <base>`, and makes none of the fixtures below.
- **The blocks.** With the switch on, the tool asks the server which blocks it serves (`blockKinds` on
  `GET /api/j2/journal-styles`, `api/routers/notebook_journal_styles.py` `list_styles_endpoint`). A row
  whose block is not served (a P2a-only build has no `myRules`, `prepWire` or `tradeReview`) is **NOT RUN**
  with the reason `server lacks P2b blocks (...)`, never FAIL, and its fixtures are not made. Row 32 needs
  `myRules` too: the rule's Before entry switch shipped with it.
- **Fixtures**, made by the tool through the API the first time a row needs them (never through the
  slash menu), and removed in its `finally`: one note per block, each holding the block node in
  `bodyJson` with the keys of `trader_blocks._node` (`SR block checklist`, `SR block stamps`,
  `SR block sizing`, `SR block prep`, `SR block rules`, `SR block review`; trashed); the style `SR style`
  (the chart, then the pre-entry checklist; soft-deleted, the manager's own Delete); the rule
  `SR rule wait for the first hour` in the account the browser selects, switched to Before entry
  (`POST /api/j2/accounts/{account}/rules`, then `PUT /api/j2/trader-blocks/rules/{id}`; dismissed with
  `POST /api/j2/rules/{id}/dismiss`, the rules API's only removal); and, only when the account has no
  closed trade for the review picker, a manual `ZZZT` trade (`POST /api/j2/trades`; hard-deleted with
  `DELETE /api/j2/trades/{id}`). So each run leaves one soft-deleted style and one dismissed rule. The
  record carries `left_sr_styles`, `left_sr_rules`, `left_sr_trades`.
- **Run them alone:** `python tools/notebook_nvda_pass.py --out <file> --nvda-log <log> --only 28,29,30,31,32,33,34,35,36,37,38`.
  Each row opens its own page; none depends on an earlier one. The ear is narrowed: the page (and
  dialog) is set up, NVDA settles, the window is marked, then the control is focused. Row 28 is the one
  exception in order: the Styles button is focused FIRST and its own `opens dialog` (it carries
  `aria-haspopup="dialog"`) is let finish, THEN the window is marked and Enter pressed, so `dialog` can
  only come from the dialog itself.
- **The Expected column is the grade.** Each cell holds exactly the phrases the tool requires, one per
  backtick span, in its order (`P1P2_ROWS` in the tool); `tests/test_notebook_nvda_pass.py` reads this
  table and fails on any difference. A phrase is a case-insensitive substring of the row's speech.

| # | Keys | Expected announcement (quoted from source) | Source | PASS / FAIL | Notes |
|---|---|---|---|---|---|
| 28 | Open `/journal/notebook?view=all`. Focus **Styles**, let NVDA finish, then **Enter**. | `Journal styles`, `dialog` | the door `tabs/NotebookTab.jsx:2467-2469`; the title `components/notebook/styles/StylesManager.jsx:242`; `role="dialog"` named by its title `app/src/components/mobile/Sheet.jsx:261`, `:267` | **NOT RUN YET** | The listening window opens after the button's focus has been spoken: its `aria-haspopup="dialog"` (`NotebookTab.jsx:2467`) is spoken `opens dialog` and would satisfy `dialog` by itself (the self-check fails if the order regresses). |
| 29 | In the manager, **Enter** on `Edit SR style`; focus the second block row's move-up control. | `Move Pre-entry checklist up`, `button` | `components/notebook/styles/StyleEditor.jsx:282` (`` `Move ${label} up` ``); label `lib/journalBlocks.js:17`; the opener `components/notebook/styles/StylesManager.jsx:319` | **NOT RUN YET** | Name corrected from "Move up": that is the button's `title` tooltip (`:282`), not its accessible name. The first row's move-up is disabled, so the row is the style's second block. |
| 30 | Same; focus the chart row's timeframe select. | `Timeframe for Chart of the note’s ticker`, `combo box` | `components/notebook/styles/StyleEditor.jsx:276` (`` `${s.label} for ${label}` ``); `lib/journalBlocks.js:10` (`Chart of the note’s ticker`), `:12` (`Timeframe`) | **NOT RUN YET** | The apostrophe is TYPOGRAPHIC (U+2019), not ASCII, so Python's repr keeps NVDA's single quotes around it; the ear reads both quote styles anyway, and its self-check walks this exact name. |
| 31 | Open the note `SR block checklist`; focus `Change setup`. | `Pre-entry checklist grouping Pre-entry checklist for`, `Change setup` | the block's group `components/notebook/blocks/BlockNodeView.jsx:76` (`role="group"`, named by the block); label `lib/journalBlocks.js:17`; inside it a second group `components/notebook/blocks/PreEntryChecklistBlock.jsx:98-99` (`Pre-entry checklist for SR setup`), which holds the button `:111-115` | **NOT RUN YET** | Graded on the two groups ADJACENT, outer then inner, as NVDA speaks focus ancestors in one announcement: the inner group's name contains the outer's, so `Pre-entry checklist` plus `grouping` alone would pass with the block's own group gone. ⚠️ If NVDA ever splits the two ancestors across two utterances, this row FAILs with both visible in its speech (a ` / ` between them), not silently. `Change setup` is focused rather than `Remove Pre-entry checklist` (`BlockNodeView.jsx:80`) because its own name does not carry the phrase. |
| 32 | Same note; focus the rule's check box. | `SR rule wait for the first hour`, `check box`, `not checked` | `components/notebook/blocks/PreEntryChecklistBlock.jsx:102-105` (the label wraps the box and the item's words); the item `lib/blocks/checklistItems.js` (`checklistItems`: an active rule with `beforeEntry`) | **NOT RUN YET** | The item is the run's own rule. The setup `SR setup` is not one of the account's setups, so the block also says `SR setup is no longer one of your setups.` (`:94`). |
| 33 | Open the note `SR block stamps`; focus the switch. | `Stamp prices as I write`, `switch` | `components/notebook/blocks/PriceStampsBlock.jsx:24`; `role="switch"` `app/src/components/ui/Switch.jsx:44` | **NOT RUN YET** | Disabled, so unfocusable, while the switch is off (`:24`); the gate above keeps the row from running then. |
| 34 | Open the note `SR block sizing`; focus **Entry**. | `Entry`, `spin button` | `components/notebook/blocks/PositionSizingBlock.jsx:98-99` | **NOT RUN YET** | Two corrections. Role: `<input type="number">` is a spin button (HTML-AAM), not "edit"; NVDA's exact wording for it is unmeasured here. Owner: the "trade plan entry field" is the Position sizing block's, which the built-in Trade plan style composes (`api/services/journal_two/journal_styles.py:131-137`). |
| 35 | Same note; focus **Setup grade**. | `Setup grade`, `combo box` | `components/notebook/blocks/PositionSizingBlock.jsx:108-109` | **NOT RUN YET** | |
| 36 | Open the note `SR block prep`; focus **Capture now**. | `Capture now`, `button` | `components/notebook/blocks/PrepCapture.jsx:52-54` (in `components/notebook/blocks/PrepWireBlock.jsx`) | **NOT RUN YET** | Never pressed: a capture reads the market and writes a snapshot into the note. The note's block has no snapshot (the uncaptured shape), so the button reads `Capture now`, not `Capture again`. |
| 37 | Open the note `SR block rules`; focus the rule's **Edit**. | `Edit`, `SR rule wait for the first hour`, `button` | `components/notebook/blocks/MyRulesBlock.jsx:110` (`` `'${rule.label}'` ``), `:149` (`` `Edit ${name}` ``) | **NOT RUN YET** | The full name is `Edit 'SR rule wait for the first hour'`: the rule's words in ASCII single quotes, so NVDA's log writes it double-quoted (the shape the first ear was deaf to). Graded on the three phrases in the Expected cell, not on the quote characters, which NVDA's punctuation level may drop. |
| 38 | Open the note `SR block review`; focus the trade picker. | `Trade to review`, `combo box` | `components/notebook/blocks/TradeReviewBlock.jsx:67-68` | **NOT RUN YET** | The picker exists only with at least one closed trade (`:63`); the tool makes the `ZZZT` trade when the account has none. |

### Rows 39-41 -- the alert chip and the screenshot tag (Notebook P2 Tier 2 part A)

Added 2026-10-14 (Task 11). They run in Task 12's NVDA pass, and **only while the switches are on in the
sandbox**: `tools/notebook_nvda_pass.py` reads `notebook_smart_chips_enabled` (rows 39-41) and
`notebook_image_docx_documents_enabled` (row 41) from its own `/api/auth/me` the same way it reads the
journal styles key, and a missing or non-boolean key records the row **NOT RUN** with the reason
`smart chips switch is off on <base> (...)`, making no fixture. Row 41 also needs an OCR engine on the
server: with none (`ocrUnavailable` on the note's documents) it is **NOT RUN**, never FAIL.

- **Fixtures**, made through the API the first time a row needs them: the note `SR alert chip` (rows 39
  and 40) and the note `SR screenshot tag` (row 41), both trashed in the tool's `finally`. Row 41 pastes
  `tools/fixtures/chart-header-nvda-1d.png` (`python tools/gen_chart_header_fixture.py` makes it) through
  the OS clipboard and a real Ctrl+V, never a synthetic event. It leaves an uploaded image attached to a
  trashed note and that image's OCR'd document row, because the product has no hard delete for either.
- **Run them alone:** `python tools/notebook_nvda_pass.py --out <file> --nvda-log <log> --base <sandbox> --only 39,40,41`.
- **Graded phrases avoid the characters NVDA may speak as words.** NVDA's symbol level can say "plus" for the
  `+` of Alt+Enter, "dollar" for the `$` and a name (or nothing) for the middle dot, so the Expected cells hold
  phrases without them (`Enter to set it` survives "Alt plus Enter to set it"). The full sentence is quoted
  from the source below, and the **Notes** column records what was actually heard.
- **Row 39 is graded for "once".** The tool counts the occurrences of `Alert suggestion` in the row's window and
  FAILS a row that spoke it twice or not at all (`grade(..., once=...)`); typing is echoed by NVDA, but the
  phrase `Alert suggestion` comes only from the live region.

| # | Keys | Expected announcement (quoted from source) | Source | PASS / FAIL | Notes |
|---|---|---|---|---|---|
| 39 | Open the note `SR alert chip`, click into the body, **End**, type `alert me if NVDA closes below 120`, wait for the chip. | `Alert suggestion`, `NVDA closes below`, `Enter to set it`, `Escape to dismiss` | the polite status `components/notebook/AlertPhraseMenu.jsx:142`; its text `AlertPhraseMenu.jsx:91` (`` `Alert suggestion: ${words}. Press Alt+Enter to set it, or Escape to dismiss.` ``); the chip `AlertPhraseMenu.jsx:144` (`role="toolbar" aria-label={ALERT_MENU_LABEL}`, `:29`) | **NOT RUN YET** | The full sentence is `Alert suggestion: NVDA closes below $120.00 (daily). Press Alt+Enter to set it, or Escape to dismiss.` The status line is DERIVED from the offer, so it is spoken once per offer and goes quiet when the caret moves inside the sentence (`AlertPhraseMenu.test.jsx`, "speaks once per offer"); this row measures that with a real screen reader. |
| 40 | Same note, chip showing: **Alt+Enter**; then **Escape**. | `Set an alert`, `dialog`, `Note body` | the key `lib/alertPhraseOffer.js:90-93` (`Enter` with `altKey` dispatches `ALERT_OFFER_EVENT`); the sheet `components/notebook/TextAlertSheet.jsx:104` (`title="Set an alert"`, `labelledByTitle`); the dialog named by its title `app/src/components/mobile/Sheet.jsx:261`, `:267`, `:285`; Escape returns focus `AlertPhraseMenu.jsx:164` (`editor?.commands?.focus?.()`) and the body's name `components/notebook/NoteEditorPage.jsx:2605` (`'aria-label': 'Note body'`) | **NOT RUN YET** | Two claims in one row: focus lands INSIDE the sheet on Alt+Enter, and Escape returns it to the body. The tool records both from the DOM beside the speech. `labelledByTitle` was added in Task 11: without it the dialog had no accessible name (the a11y rail `smartChips.a11y.test.jsx` found it). |
| 41 | Open the note `SR screenshot tag`; paste the fixture screenshot; wait for the chip; focus its button. | `Tag NVDA`, `Daily`, `button` | the chip `components/notebook/ScreenshotTagOffer.jsx:81` (`role="toolbar" aria-label={SCREENSHOT_OFFER_LABEL}`, `:18`); its button's words `ScreenshotTagOffer.jsx:20-24` (`offerWords`: `Tag ${symbol} · ${timeframe.label}`) and `:82-84`; its dismiss `:86` (`aria-label="Dismiss screenshot tag"`) | **NOT RUN YET** | The button reads `Tag NVDA · Daily`; only the words around the middle dot are graded. A note that already has a different ticker reads `Tag image NVDA · Daily` instead (`offerWords`), which this fixture does not exercise (the note has no ticker). |

## Appendix A -- the Mac-only chords, on a real Mac

Read from source; never retyped from memory. On a Mac, `Mod` is Cmd and `Alt` is Option.

| Chord | What it should do | Source | PASS / FAIL | Notes |
|---|---|---|---|---|
| **Cmd+Option+F** (in a note) | opens find WITH the replace row (Ctrl+H would delete a character on a Mac) | `lib/platform.js:35` `replaceChordKeys()` -> `['Cmd', 'Option', 'F']` | | |
| **Cmd+Option+L** (caret inside a code block) | focuses the code block's language picker; outside a code block the key passes through | `lib/codeBlockNode.js:183` (`'Mod-Alt-l'`) | | |
| **Cmd+Option+D** (anywhere in the Notebook) | opens today's daily note -- read by the physical key, so Option's `∂` must not be typed into the note | `lib/dailyNote.js:38`, `:42` `isDailyShortcut` | | |

## Appendix B -- lane D's I3: the touch grip, on real phones

Real **Android Chrome** and **iOS Safari**, through BrowserStack Live, signed in as the
smoke account with the login link (never a typed password). Owed since wave 6
(OPEN-ITEMS, lane D I3): the fix is proven only for jsdom's synthetic event sequence.

1. Open a note with at least three paragraphs; tap into the second paragraph.
2. The grip appears beside that block, visibly (touch shows it for the caret's block):
   named `"Move this block"` (`lib/blockHandle.js:30`).
3. **Tap the grip once.** Expected: the `"Move block"` menu (`lib/blockHandle.js:31`)
   opens and STAYS open -- the tap's own blur must not hide the grip before the tap
   lands (`lib/blockHandle.js:347`).
4. Choose **Move up**. Expected: the paragraph moves above the first one.

| Device | Browser | Menu stayed open on one tap? | Move up worked? | Notes |
|---|---|---|---|---|
| Android (model: ____ ) | Chrome ____ | | | |
| iPhone (model: ____ ) | Safari ____ | | | |
