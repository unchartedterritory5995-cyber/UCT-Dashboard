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
| 19 | Ask something the note does not contain (e.g. `What is the dividend?`), **Enter**, wait. | the answer is read politely, without moving focus: `"I couldn't find that in this note."` | live region `components/notebook/AskPanel.jsx:357`; sentence `api/services/journal_two/ask_service.py:55` | **FAIL** | r2, r3, r5, r6, r7 -- FIVE runs, the same: NVDA echoed the typed question and then said NOTHING of the answer, while the DOM held `I couldn't find that in this note.` in a `aria-live=polite`, `aria-busy=false` element. ⚠️ DEFECT, finding F1 below. |
| 20 | Tab to `"Close Ask"`, **Enter**. | the panel closes and focus is back on `"Ask a question about this note"`, button | `components/notebook/AskPanel.jsx:320`; `components/notebook/NoteEditorPage.jsx:3140` | **PASS** | r7. `Close Ask button`, then `Ask a question about this note button collapsed`. |
| 21 | Leave the note (browser **Back**). Choose **Graph view**. Tab to `Show as list`, **Space**. | `"Graph view"`, toggle button; `"Show as list"`, toggle button, not pressed -> pressed; a table `"Notes in the graph, by title"` with `Note`, `Links`, `Linked notes` headers; each title a button | `lib/savedViewModes.js:28`; `components/notebook/NoteGraphView.jsx:537`, `:543` | **PASS** | r7 (after a reload). `Graph view toggle button`, `Show as list toggle button not pressed` -> `pressed`, the list's table. |
| 22 | **Space** again (back to the picture). Tab to the canvas; **Home**, then an **arrow**, then **Enter**. | `"Note graph: <n> notes, <m> links"`, application, then the key instructions; after Home: `"<title>, <n> links"`; the arrow names the next note; Enter opens it | `components/notebook/NoteGraphView.jsx:589`, `:591`, `:599`, `:603` (words `:518`) | **PASS** | r7. `Note graph: 2 notes, 1 link` + the key instructions (`application`); Home: `SR pass, 1 link`. |
| 23 | From the list, Tab to `Save view`, **Enter**; then **Escape**. | `"Save view"`, dialog, focus IN `"Name"`, edit (you can type at once); Escape closes it and focus is back on `Save view`, button | `tabs/NotebookTab.jsx:1783`; `components/notebook/SavedViewEditor.jsx:36`, `:38`; `app/src/components/mobile/Sheet.jsx:98` | **PASS** | r7. `Save view button`, `Save view dialog`, `Name edit` (focus in it); Escape: back on `Save view button`. |
| 24 | Open a note, Tab to `Delete`, **Enter**; confirm. | `"Delete this note?"`, dialog; after confirming you are on the NEXT note's card in the list (or on the list heading if it was the last) | `components/notebook/NoteEditorPage.jsx:3242`; `components/ConfirmModal.jsx:36`; focus rail `a11y/focusFlows.test.jsx` | **PASS** | r7, keys differ from the script: Delete sits inside `More note actions button collapsed` (a disclosure), not on the Tab path. `Delete button`, Enter: `Delete this note? dialog`, `Cancel button`, `Delete button`; after confirming, focus landed on `Research home heading level 2` (the note was opened by URL, not from the list, so the next-card landing was not exercised). |
| 25 | **If the account has no notes:** open the Notebook home. **If the tour is on:** let it start. | `"Welcome to your Notebook"`, heading level 2. Tour: lane 8C's -- a stub at the time of writing; re-read `components/notebook/onboarding/NotebookTour.jsx` for its words before running | `components/notebook/ResearchHome.jsx:182`; `components/notebook/onboarding/NotebookTour.jsx:1` | **PASS** | r7. `Welcome to your Notebook heading level 2`. The tour DID start in r3/r5 (`Folders and tags dialog STEP 2 OF 3 Your folders, tags and saved views live here ...`). |
| 26 | **If sharing is on:** in a note, Tab to `Share`, **Enter**, Tab, **Escape**. | `Share`, button, has pop-up dialog, collapsed; `"Share this note"`, dialog; `"Share link address"`, edit; Escape returns focus to `Share` | lane 8B's `components/notebook/NoteShareControls.jsx:78`, `:86`, `:236` | **NOT RUN** | NOT RUN on purpose: it mints a public share link for a note on the smoke account. Owner's step. |
| 27 | Anywhere in the Journal: **?** | `"Keyboard Shortcuts"`, dialog; under Notebook, the graph rows (`Graph view: move to the nearest note in that direction` ...) | `components/ShortcutCheatSheet.jsx:139`, `:75` | **PASS** | r8. The page saw `?/Slash+shift`; `Keyboard Shortcuts dialog`, `Close button`, the Notebook rows (`Go to Notebook g THEN n` ...). (r6/r7 FAILED this row because the driver sent a zero scan code, so `KeyboardEvent.code` was empty -- a driver fault, fixed in r8.) |

## Result -- NVDA 2026.2, 2026-10-09, production, the smoke account

**26 PASS · 1 FAIL · 1 NOT RUN** (the table above; row 26 is the NOT RUN). The VoiceOver half was
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

- **F1 -- DEFECT. The Ask answer is never spoken (row 19).** Five runs (r2, r3, r5, r6, r7), the
  same: NVDA echoed the typed question and said nothing of the answer, while the DOM held
  `I couldn't find that in this note.` in the answer element with `aria-live="polite"` and
  `aria-busy="false"`. Mechanism, read from `components/notebook/AskPanel.jsx:401-403`: the element
  is rendered as `{answer && <div aria-live="polite" aria-busy=...>}`, so the live region is MOUNTED
  together with its first text and no change ever happens inside an existing live region; a screen
  reader announces changes, not arrivals. Fix shape: keep an always-present (empty) polite region in
  the panel and write the finished answer into it, or mount the region before the stream starts.
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
- **F4..F7 -- the script's keys predate the product** (rows 5, 6, 9, 17, 24): "Tab to its
  disclosure" / "Tab along its row" (tree), "Tab to the view switcher" (tool bar), "Tab to the
  replace field" (six Tabs: Match case, Whole word, Previous match, Next match, Close find, then
  `Replace with`), "Tab to Delete" (inside `More note actions`). Each row PASSES on the sounds once
  the right keys are used; the Notes column carries the keys. Row 15's `[[` needs a space or a line
  start before it and closes on a space inside the query.

**Driver faults found on the way, kept because the next runner will hit them.** (1) `SendInput`
types into the OS foreground window, and `page.bring_to_front()` does not change it: r1 typed seven
minutes of keys into another browser. The tool now verifies, before EVERY key, that the window
carrying its run nonce is Playwright's own browser and is `GetForegroundWindow()`; otherwise no key
and INCONCLUSIVE. (2) Arrows, Insert, Home and End need `KEYEVENTF_EXTENDEDKEY` or they arrive as
numpad keys, which NVDA's desktop layout binds to its review cursor and swallows (r4/r5). (3) A zero
scan code reaches the page as an empty `KeyboardEvent.code`; the Journal's `?` matches on
`code: "Slash"` (r6/r7 failed row 27 for that reason, r8 passed it).

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
