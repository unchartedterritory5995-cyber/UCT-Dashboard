# Notebook screen-reader pass -- the owner's script

Wave 8, lane 8A (A6). Written 2026-09-26 against `feat/notebook-w8` at `120aadf66`.
**The owner runs this; nothing here has been run on a real screen reader yet.**
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
  and write its version here before starting: `NVDA version: ________`
  (NVDA menu, Help, About). Firefox or Chrome; browse mode unless a step says focus mode.
- **VoiceOver on macOS Safari** (Cmd+F5), and **VoiceOver on iOS Safari** if an iPhone
  is at hand. Record: `macOS ____ / Safari ____ / iOS ____`.
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
| 1 | Open `/journal/notebook?view=all`. Press **Tab** once. | `"Skip to notes list"`, link -- the first thing the tab offers, visible only now | `tabs/NotebookTab.jsx:1414` | | |
| 2 | **Enter** on the skip link. | `"All notes"`, heading level 2 (visible while focused) | `tabs/NotebookTab.jsx:1565`, words at `tabs/NotebookTab.jsx:485` | | |
| 3 | Shift+Tab to the top of the sidebar, then Tab. | `"Hide folders panel"`, button; then `"Panel view"`, tab list, `"Show folders"`, tab, selected | `components/notebook/FolderSidebar.jsx:1260`, `:1265`, `:1273` | | |
| 4 | Tab to the **All notes** row. | `"All notes"` plus its count, button, **current** | `components/notebook/FolderSidebar.jsx:1641`, `:1638` | | |
| 5 | Tab to a folder with a subfolder; Tab to its disclosure. | the folder name, button; `"Expand <folder>"`, button, collapsed -- Enter says expanded | `components/notebook/FolderSidebar.jsx:640` | | |
| 6 | Enter on a folder row, then Tab along its row. | the folder name, button, **current**; then `"Rename <folder>"`, `"Add subfolder to <folder>"`, `"Delete <folder>"`, buttons | `components/notebook/FolderSidebar.jsx:679`, `:698`, `:705`, `:712` | | |
| 7 | Move to the tags (NVDA: **H** / **Tab**). | `"Tags"`, grouping; a tag row reads as button, current when selected; `"Expand tag <path>"` on a nested tag | `components/notebook/FolderSidebar.jsx:1811`, `:444`, `:541` | | |
| 8 | Move to saved views; open the section; select a view. | `"Expand Saved Views"`, button; the view's name, button, **current** once chosen | `components/notebook/FolderSidebar.jsx:286`, `:329` | | |
| 9 | Clear the view (All notes). Tab to the sort control, then the view switcher; **Space** on Table. | `"Sort notes"`, combo box, `Recently updated`; `"List view"`, toggle button, pressed; `"Table view"`, toggle button, not pressed -> pressed | `tabs/NotebookTab.jsx:1709`, `:1750-1751`; labels `lib/savedViewModes.js:24-25` | | |
| 10 | Back to List. Tab to the `SR pass` card, **Enter**. | focus lands IN the title field: `"Note title"`, edit, `SR pass` | `components/notebook/NoteCard.jsx:126`; `components/notebook/NoteEditorPage.jsx:3565` (focus rail `a11y/focusFlows.test.jsx`) | | |
| 11 | Tab, Tab ... through the note. | `"Subtitle"`, edit; `"Editor toolbar"`, tool bar; ... `"Note body"`, edit, multi line | `components/notebook/NoteEditorPage.jsx:3578`, `:3284`, `:1771` | | |
| 12 | In browse mode, **H** to the heading, then **T** to the table; arrow through two cells. | `Setup`, heading level 2; table with 3 rows and 3 columns; column headers `Sym`, `R` read with each cell | table extension `lib/tiptap.js:18` (TableHeader renders `<th>`) | | |
| 12b | Focus mode, caret in a table cell: **Tab** twice, then **Alt+F10** (Mac: **Option+F10**), then **Escape**. | Tab moves cell to cell (at the LAST cell it adds a row -- measured in the browser pass); Alt+F10 lands on the `"Table"` tool bar (first button `Add a row above`); Escape returns to the cell. This is the way out of a table: Ctrl+Home does NOT leave it | `components/notebook/TableToolbar.jsx:126`; listed in `components/ShortcutCheatSheet.jsx:84` | | |
| 13 | Focus mode in the body (NVDA **Insert+Space**). At the end of a line type **/** then **Down**. | the body becomes a combo box, expanded; `"Insert block"`, list; the active option read as you move (`Heading 1` ...) | `lib/comboboxWiring.js:26`; `components/notebook/SlashMenu.jsx:444`, `:29` | | |
| 14 | **Escape**. | the menu closes; you are still in `"Note body"` with the caret where it was (nothing else is said) | focus rail `a11y/focusFlows.test.jsx` ("Escape in the slash menu") | | |
| 15 | Type **[[** and a few letters of another note; **Down**, **Enter**. | `"Link to a note"`, list; the note titles as options; after Enter the chip reads as a button named for the note | `components/notebook/NoteLinkMenu.jsx:74`; `components/notebook/NoteLinkView.jsx:50` (loading / trashed wording) | | |
| 16 | **Ctrl+F** (Mac: **Cmd+F**). Type a word. | `"Find in note"`, search landmark; `"Find in note"`, search box (focus is in it); the match count is read | `components/notebook/NoteFindBar.jsx:198`, `:223` | | |
| 17 | **Ctrl+H** (Mac: **Cmd+Option+F**, appendix A). Tab to the replace field. **Escape**. | `"Hide replace"` / `"Show replace"`, button; `"Replace with"`, edit; Escape returns you to `"Note body"` | `components/notebook/NoteFindBar.jsx:206`, `:298`; `components/notebook/NoteEditorPage.jsx:556` (closeFind) | | |
| 18 | Tab to Ask; **Enter**. | `"Ask a question about this note"`, button, collapsed -> expanded; the panel `"Ask This note"`; focus in `"Your question about This note"`, edit | `components/notebook/AskPanel.jsx:300` (scope label `:33`), `:307`, `:325` | | |
| 19 | Ask something the note does not contain (e.g. `What is the dividend?`), **Enter**, wait. | the answer is read politely, without moving focus: `"I couldn't find that in this note."` | live region `components/notebook/AskPanel.jsx:357`; sentence `api/services/journal_two/ask_service.py:55` | | |
| 20 | Tab to `"Close Ask"`, **Enter**. | the panel closes and focus is back on `"Ask a question about this note"`, button | `components/notebook/AskPanel.jsx:320`; `components/notebook/NoteEditorPage.jsx:3140` | | |
| 21 | Leave the note (browser **Back**). Choose **Graph view**. Tab to `Show as list`, **Space**. | `"Graph view"`, toggle button; `"Show as list"`, toggle button, not pressed -> pressed; a table `"Notes in the graph, by title"` with `Note`, `Links`, `Linked notes` headers; each title a button | `lib/savedViewModes.js:28`; `components/notebook/NoteGraphView.jsx:537`, `:543` | | |
| 22 | **Space** again (back to the picture). Tab to the canvas; **Home**, then an **arrow**, then **Enter**. | `"Note graph: <n> notes, <m> links"`, application, then the key instructions; after Home: `"<title>, <n> links"`; the arrow names the next note; Enter opens it | `components/notebook/NoteGraphView.jsx:589`, `:591`, `:599`, `:603` (words `:518`) | | |
| 23 | From the list, Tab to `Save view`, **Enter**; then **Escape**. | `"Save view"`, dialog, focus IN `"Name"`, edit (you can type at once); Escape closes it and focus is back on `Save view`, button | `tabs/NotebookTab.jsx:1783`; `components/notebook/SavedViewEditor.jsx:36`, `:38`; `app/src/components/mobile/Sheet.jsx:98` | | |
| 24 | Open a note, Tab to `Delete`, **Enter**; confirm. | `"Delete this note?"`, dialog; after confirming you are on the NEXT note's card in the list (or on the list heading if it was the last) | `components/notebook/NoteEditorPage.jsx:3242`; `components/ConfirmModal.jsx:36`; focus rail `a11y/focusFlows.test.jsx` | | |
| 25 | **If the account has no notes:** open the Notebook home. **If the tour is on:** let it start. | `"Welcome to your Notebook"`, heading level 2. Tour: lane 8C's -- a stub at the time of writing; re-read `components/notebook/onboarding/NotebookTour.jsx` for its words before running | `components/notebook/ResearchHome.jsx:182`; `components/notebook/onboarding/NotebookTour.jsx:1` | | |
| 26 | **If sharing is on:** in a note, Tab to `Share`, **Enter**, Tab, **Escape**. | `Share`, button, has pop-up dialog, collapsed; `"Share this note"`, dialog; `"Share link address"`, edit; Escape returns focus to `Share` | lane 8B's `components/notebook/NoteShareControls.jsx:78`, `:86`, `:236` | | |
| 27 | Anywhere in the Journal: **?** | `"Keyboard Shortcuts"`, dialog; under Notebook, the graph rows (`Graph view: move to the nearest note in that direction` ...) | `components/ShortcutCheatSheet.jsx:139`, `:75` | | |

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
