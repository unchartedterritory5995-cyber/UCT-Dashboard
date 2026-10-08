# Notebook finish program, lane A11Y: what was fixed and what still needs a person

Branch `feat/notebook-fin-a11y`, base `72715e8001` (the Notebook landing tip).
Input: the read-only review `R4-A11Y-MOBILE.md` (10 IMPORTANT, 16 MINOR), which was written
from code and never run.

This lane checked each finding against the code, recomputed every contrast figure from
`app/src/styles/tokens.css`, and fixed what it verified. Each fix has a vitest that asserts
the rendered page: role, name, where focus is after the action, which keys do what, and what
is announced. The tests were written first and seen to fail on the old code.

Nothing here was run in a browser, on a phone, or with a screen reader. That is by design:
a later browser walk and a person with NVDA and VoiceOver do that. The last column of each
table says exactly what they must confirm.

## 1. Contrast figures, recomputed

All of the review's figures were recomputed from the hex values in `tokens.css` and match.

| Pair | dark | oled | light |
|---|---|---|---|
| `--loss` on `--bg-surface` | 4.31 | 4.81 | 5.80 |
| `--loss` on `--bg-elevated` | 4.01 | 4.59 | 6.33 |
| `--danger-ink` on `--bg-surface` | 5.85 | 5.68 | 5.80 |
| `--danger-ink` on `--bg-elevated` | 5.44 | 5.42 | 6.33 |
| `--text-bright` on `#17171a` (old chip preview) | 16.69 | 16.69 | 1.08 |
| `--text-bright` on `#101013` (old replay panel) | 17.72 | 17.72 | 1.02 |
| `--text-bright` on `--bg-elevated` (new chip preview) | 15.39 | 17.62 | 19.35 |
| `--info` on `--bg-surface` | 7.12 | 7.94 | 6.62 |
| `#60a5fa` on `--bg-surface` (old chip dot) | 6.98 | 7.79 | 2.33 |
| `--ut-gold` next to `--text-muted` | 1.14 | 1.14 | 1.03 |
| `--bg` on `--accent` (new selected chip fill) | 10.24 | 11.31 | 6.23 |

The measured table for the whole Notebook, `docs/notebook/accessibility-contrast.md`, was
regenerated. It now covers 101 stylesheets and 1,147 pairs per theme, with 0 below their bar
in dark, oled and light.

## 2. IMPORTANT findings

| # | Verdict | What changed | Test | A person or the walk must confirm |
|---|---|---|---|---|
| I-1 | Verified. `--bg-surface-2` is defined nowhere, so the preview was near black in every theme. | The preview uses `--bg-elevated`. The chip dot's undefined `--color-info` becomes `--info`. | `ThesisChip.test.jsx`, `a11y/notebookContrast.test.js` | In the light theme, open a thesis chip on Positions and Holdings. The preview is light and readable. |
| I-2 | Verified, all five parts. | The door is chosen at the click from the live media query. At 1024px and under a click opens the shared `Sheet`. On desktop the preview is `position: fixed`, placed from the chip, so the table wrapper cannot clip it. It closes on Escape, on focus leaving, and on a pointerdown outside. Focus alone does not open a sheet on touch. | `ThesisChip.test.jsx` (touch sheet, fixed position, Tab order, outside pointerdown, Escape) | On a phone and a tablet: tap a chip, the sheet opens, tapping the backdrop closes it. On desktop: open the chip in the last row of Positions, nothing is cut off. Scroll the table sideways with it open, the preview follows. At a 1024px-wide window with a keyboard, Tab does not open anything and Enter opens the sheet. |
| I-3 | Verified. The chip button and its "Open note" link were inside the row link. | A Holdings row that carries a chip is a plain container. The link covers the row as a sibling and the chip sits above it. A row with no chip keeps the old markup, so flags-off output is unchanged. The chip's clicks and Enter/Space no longer reach its host row. | `HoldingsList.thesisChip.test.jsx` | In Holdings with VoiceOver on iOS: swipe reaches the row link, then the chip, then "Open note". Tapping anywhere else on the row still opens the position. The press effect and the hover tint still show. The joystick hub cursor still lands on the row. |
| I-4 | Verified. No focus move, no trap, no Escape, no scroll lock. `--surface-1` is defined nowhere. | The window is the shared `Sheet`. The panel follows the theme. The status row is live only while paused. Glyph characters are replaced with `UIcon` and the buttons are named by words. Autoplay does not start under reduced motion. The selected speed is filled, bold and check-marked. | `BarReplay.a11y.test.jsx` | Open "What happened next" from a note chart and the replay on a trade page. Focus is inside, Tab stays inside, Escape closes, focus returns to the Replay button. On Safari the button may not take focus on click, so check where focus returns there. With NVDA, pressing Play does not read a message per bar. In the light theme the panel is light. The chart canvas follows the theme too (round 2, section 5). On a phone it opens as a bottom sheet and clears the home indicator. |
| I-5 | Verified. Left, Right, Home and End were prevented in the search box. | From the search box only ArrowUp and ArrowDown move the target. The field points at the target card with `aria-activedescendant`, describes the keys, and a polite live region says which template Enter opens. Arrow keys between the cards are unchanged. | `TemplatePicker.searchCaret.test.jsx`, `TemplatePicker.searchKeyboardReach.test.jsx` | Type a word, press Left and Home, edit it. With NVDA and VoiceOver: on ArrowDown the screen reader says the new template name. See the open decision in section 6. |
| I-6 | Verified. No typed way to make or move a level. | The panel has "Add a level at price" (number, role, button). Each level's price is a number field with step keys. The role radios are one Tab stop with arrow keys. Nothing in `StockChart.jsx` or the drawing overlay changed. | `ChartPlanPanel.keyboardDoor.test.jsx` | Add a level by price with the keyboard only. A horizontal line appears on the chart at that price, the R:R and size numbers update, and "Arm alert at this level" works on it. Step a level with ArrowUp and watch the line move. Check the new line has the same look as a drawn one. With a screen reader the price field reads as a spin button with its value. |
| I-7 | Verified. 4.31:1 and 4.01:1 in the default dark theme. | The four stylesheet rules and four inline styles use `--danger-ink`. `--loss` is not changed. The contrast rail now reads six Journal-side stylesheets it never reached. It found one more failure, the Why prompt textarea border at 1.18:1, now `--field-edge`. | `a11y/notebookContrast.test.js` (three new cases and a control) | None beyond a look at an error message on the plan grade card in the dark theme. |
| I-8 | Verified, all three parts. | The dialog is described by "Step N of M", the body and the hint. The heading that takes focus on every step is described by the count and the hint, so both are read on each step. On touch the active anchor has a scroll margin. | `GenericTourEngine.announce.test.jsx` | With NVDA and VoiceOver: start a tour, each step reads its title and then "Step 2 of 5". On a waiting step it also reads "Do this to continue". On a phone, run a tour whose target starts below the fold: the target is visible above the card. The margin is 260px plus the safe area; a card with a long body may be taller, so check the longest step. |
| I-9 | Verified. | Edit moves focus into the text field. Save and Cancel move it to Edit. A status line that is always mounted says "Saved." | `WhyPrompt.focus.test.jsx` | With a screen reader: Save reads "Saved." once. |
| I-10 | Verified. | Each number has `aria-expanded` and, while open, `aria-controls`. Opening moves focus to the table heading. Close returns focus to the number. | `MyPlaybook.focus.test.jsx` | With a screen reader: pressing a number reads the table heading. Inside a "too few to judge" reveal, Close still returns to the number. |

## 3. MINOR findings

| # | Verdict | What changed | Test | A person or the walk must confirm |
|---|---|---|---|---|
| M-1 | Verified. | The count is a polite live region. A tick on the focused step moves focus to the card heading. When the last step is done a polite status says so. | `GettingStartedList.announce.test.jsx` | Finish a step with a screen reader on: the new count is read. |
| M-2 | Verified. | The offer card hands focus to the page heading before it answers. A tour started from the offer returns focus there. | `TourOfferPrompt.focus.test.jsx` | Choose "Not now" by keyboard: focus is on the page heading. Take the tour and close it: same. |
| M-3 | Verified. | The explainer has a polite status, mounted empty and filled a moment later. | `GenericTourEngine.announce.test.jsx` | A screen reader announces the note when it appears. "Got it" is now the first Tab stop (round 2, section 5). |
| M-4 | Verified. | Report, Unpublish and "Keep it" give focus to a sensible control. Feature and Unfeature name the template. | `TemplateGallery.focus.test.jsx` | After a successful Unpublish the row leaves the list. Check where focus is then. |
| M-5 | Verified. | Add and Remove fill a status line that is always mounted. After Remove, focus goes to the next row, else the row before, else the ticker field. | `researchMinors.a11y.test.jsx` | None beyond a keyboard pass. |
| M-6 | Verified. | "Reading your plan" is a status. Picking a plan returns focus to Re-link and a mounted status says which plan was linked. | `journalMinors.a11y.test.jsx` | None beyond a keyboard pass. |
| M-7 | Verified. | Use and Dismiss move focus to the Setup picker. Dismiss names its tag. | `researchMinors.a11y.test.jsx` | None beyond a keyboard pass. |
| M-8 | Verified. | Entry context: the reason is text beside "Not available", and the late badge is followed by the day. Find similar: the scale is in the caption. Unplanned chip: the reason follows it as screen-reader text (the chip keeps its title for a mouse). | `journalMinors.a11y.test.jsx`, `researchMinors.a11y.test.jsx` | On a phone the entry context rows still fit with the reason beside the value. |
| M-9 | Verified. | Discipline window and replay speed: filled, bold, check-marked. Thesis chip: the status is a word beside the distance. `--color-info` is gone. | `journalMinors.a11y.test.jsx`, `BarReplay.a11y.test.jsx`, `ThesisChip.test.jsx` | At 390px the chip with a status word still fits its cell in Positions and Holdings. |
| M-10 | Verified. | My Playbook links are underlined at rest. The Setups board note link is underlined in its own colour. | `MyPlaybook.focus.test.jsx`, `researchMinors.a11y.test.jsx` | In the light theme the Setups board note link has a visible underline. |
| M-11 | Verified. | The My Playbook root is a labelled `section`. | `MyPlaybook.focus.test.jsx` | A screen reader's landmark list shows one main. |
| M-12 | Verified. | The three buttons use `btn btn-secondary`. | `journalMinors.a11y.test.jsx` | They look like the app's buttons. |
| M-13 | Verified. The hook ran at mount, not at the click. | The layout is decided when the sheet opens, from the live media query. | `researchMinors.a11y.test.jsx` | On a phone the visual playbook opens full screen. |
| M-14 | Verified. | Each link is named "Replay the <title> tour". The visible word is unchanged. The tours walk's selector was made non-exact to match. | `Support.notebook.test.jsx` | None. |
| M-15 | Verified. | Home and End move to the ends of the action group. | `BulkActionBar.rovingGroup.test.jsx` | None. |
| M-16 | Verified in part. See below. | See below. | See below. | See below. |

M-16 item by item:

- Filter result counts. Fixed for the visual playbook (test in `researchMinors.a11y.test.jsx`)
  and the transcript find box (its own test was added in round 2).
- Statuses mounted with their text. Fixed for the gallery, My Playbook and the fingerprint
  plan message: each region is mounted from the start and refilled. A new `PoliteStatus`
  component does this for hidden announcements.
- Fixed ids. `why-prompt-text`, `plan-grade-title`, `entry-context-title`,
  `before-after-title`, `discipline-title` and `similar-title` now come from `useId`.
  `board-title` and `vp-regime-why` were left: each belongs to a surface that renders once.
- Admin review queue. Hide and Dismiss name the template, and queue items are headings.
- Before and after. The fills drawn on the charts are written out under the plan line.
- Literal colours. The gold, green and red literals in the named rules of
  `BarReplay.module.css`, `SetupsBoard.module.css`, `PassedSetups.module.css`,
  `TemplatePicker.module.css` and `EntryContextCard.module.css` are tokens now.

## 4. Where a fix differs from what the review or the brief suggested

- **I-5, the search box pattern.** The brief asked for a listbox with options. The field keeps
  its `searchbox` role and the cards stay buttons. Reason: turning the cards into options
  inside a listbox removes them from the Tab order, and `TemplatePicker.gallery.test.jsx` pins
  that every card is reachable by Tab. `aria-activedescendant` and `aria-controls` are valid
  on a searchbox. A polite live region also says the target, so the announcement does not
  depend on how a screen reader treats that pairing.
- **I-5, three existing tests changed.** `TemplatePicker.searchKeyboardReach.test.jsx` pressed
  ArrowRight, ArrowLeft, Home and End on the search box and expected the target to move. Those
  tests encoded the defect. They now press ArrowUp and ArrowDown. Type-to-search and
  Enter-to-pick are untouched and their tests are unchanged.
- **I-2, the desktop preview is not portaled.** It is `position: fixed` in place. That keeps
  "Open note" next in the Tab order without a hand-built focus order. A fixed element is only
  clipped by an ancestor that is transformed or filtered. The two host stylesheets were read
  and have no such rule on a row, a cell or a card.
- **I-8 and the base tour.** Round 1 fixed `GenericTourEngine` only. Round 2 applied the same
  fix to `NotebookTour.jsx` (section 5). Round 1 said the base tour was pinned byte for byte.
  That was wrong: `baseTour.zeroDrift.test.jsx` pins its steps, copy and key, not its markup.
- **Other existing tests edited, each for one line.** `MyPlaybook.test.jsx` waited for the
  status region and now waits for its text. `TemplateGallery.test.jsx` named the admin button
  "Hide template" and now names "Hide template Reported one".

## 5. Round 2: what was listed as not fixed, and what happened to it

The controller ruled on the two open decisions (I-5: keep buttons with
`aria-activedescendant`; I-4: the bottom-sheet replay stands, the older trade replay
included) and asked for the four items below.

| Item | What changed | Test | A person or the walk must confirm |
|---|---|---|---|
| Positions phone card | The card was `role="button"` with the chip and Edit, Close and Delete inside it. It is a named group now ("AAPL position"). Its primary action is a real button on the title, with the old accessible name. The chip and the three actions are its siblings. A tap anywhere on the card still opens it. The hub carrier attribute stays on the card, and the card keeps `tabIndex -1` so the delete-focus fallback can land on it. Broker and option rules are untouched. | `PositionsTable.nesting.test.jsx`, `PositionsTable.phone.test.jsx` | On a phone with VoiceOver: swipe reaches the title button, the chip, then each action, one at a time. A tap on the card body still opens the chart. The title button is 44px tall and the card height is the same as before (the button has a negative margin to keep it). The joystick hub cursor still outlines the whole card. After deleting a position, focus lands on the next card. |
| Desktop Positions row | Checked, no change needed. The row is a focusable `row` with no interactive role, and no control in it is nested in another. The chip does not open the row by click or by Enter. | `PositionsTable.nesting.test.jsx` | None. |
| Base tour (`NotebookTour.jsx`) | The dialog is described by "Step N of M" and then the body. The heading that takes focus on every step is described by the count. The touch scroll margin moved to `NotebookTour.module.css`, which both tours load. | `NotebookTour.announce.test.jsx` | With NVDA and VoiceOver, each base tour step reads its title and then "Step 2 of 8". On a phone, a base tour target is visible above the card. |
| Replay chart colours | A token choice in Notebook code (`BarReplay.jsx` owns its own lightweight-charts instance). The background, axis text, grid, borders, candles and default line colour are read from the theme tokens when the chart is created. Nothing was needed from `StockChart.jsx`. | `BarReplay.theme.test.jsx` | In the light theme, open a replay: the chart is light, candles are the theme's green and red, the grid is faint. In dark and oled the grid is now the `--border` colour, a little stronger than before. Switch theme with the window open: it applies the next time it opens. |
| Passive explainer Tab order | The note goes into a slot at the start of the page, so "Got it" is the first Tab stop instead of the last. It is `position: fixed`, so it looks the same. Its announcement ends with "Got it closes this note." | `GenericTourEngine.announce.test.jsx` | From the top of a page showing the note, the first Tab lands on "Got it", before the skip links. Confirm that order is acceptable. |
| Transcript find count | Its own test now. | `SaveTranscriptPassage.test.jsx` | None. |

### The base tour and the pins

- **No test pinned the base tour's markup byte for byte.** `baseTour.zeroDrift.test.jsx` pins
  the eight steps, their order, anchors, copy and the preference key. It passes unchanged.
  What changed in the rendered card: one `id` on the progress line and two
  `aria-describedby` values. No text, step or order changed.
- **The flags-off parity rail, `tools/notebook_w14_flagsoff_parity.py`, was run twice.**
  It renders 40 cases with the wave-14 switch off and compares them with the wave-13 landing
  (`b06ec4fd85`).
  - On the landing tip it read 40 identical (its recorded evidence file).
  - On this branch it reads **36 identical, 4 differ, VERDICT: DIFFERS**, before and after the
    base tour change. The base tour change adds no difference, and the rail could not show one
    either way: **no case in the capture has the tour card on screen** (0 of 40 in both
    passes).
  - All four differing cases are Notebook Home with every capability flag on. The whole
    difference, in each, is one element from round 1 (M-5): the always-mounted
    `<p role="status" data-passed-status="">` in Passed setups. It is there only when
    `notebook_passed_setups_enabled` is on. Every case with the capability flags off is
    identical.
  - So this is an intended difference in a wave-13 surface, not a flags-off leak. But the rail
    is binary and it is red now. The owner should either accept it or move the rail's base.
    This lane did not edit the tool and put its evidence file back as it was.

### Still not fixed

- **Line and marker colours that callers pass to the replay.** `ChartPlanPanel.jsx`
  (`ROLE_COLOR`) and `TradeReplay.jsx` pass fixed literals for entry, stop, target and exit.
  The gold entry line is about 2.2:1 on the light chart. `ChartPlanPanel.jsx` is the file
  lane FE is editing, so this lane left its constants alone.
- **Row removed after Unpublish.** Focus is returned to the Unpublish button. When the list
  refreshes and the row goes, focus can still be lost.
- **`board-title` and `vp-regime-why`** are still fixed ids (one instance per page).

## 5b. Round 3: sideways scrolling on a phone, measured in a real browser

A browser walk found five screens scrolling sideways at 390 px and one control under the 44 px
floor. Overflow is a layout fact, so this round was measured in Chromium, before and after, on
a sandbox built from this branch (`npm run build`, `scripts/hub_sandbox_boot.py`, port 8135,
data dir `C:/data-fin-a11y`, a paid sandbox member).

Tool: `tools/notebook_fin_a11y_overflow_walk.py`. Raw rows:
`docs/notebook/evidence/fin-a11y/before/walk.json` and `.../after/walk.json`. Each run boots
twice: OFF (no capability variable set) and ON (transcript capture, plus entry context so the
card is on screen, plus earnings prep and the trade canvas so the research header is at its
fullest). Widths 390, 820, 1280. 30 measurements a run.

**How the page width is read.** This app does not scroll the document. The shell is
`overflow: hidden` and an inner `<main>` scrolls. So `document.documentElement.scrollWidth`
equals the window width whatever the page does. The number that says "the page scrolls
sideways" is the page scroller's own `scrollWidth` against its `clientWidth`. Both are
recorded. The tool's first run read only the document and reported no overflow anywhere; its
raw output is kept in `evidence/fin-a11y/first-run-document-only/` for that reason.

| Screen at 390 px | Before (page scroller) | Widest element | After |
|---|---|---|---|
| Research workspace, flags off | 390 / 390 | none | 390 / 390 |
| Research workspace, ON | **763** / 390 | the "Save from a transcript" button, ending at 763 ("Earnings prep" ended at 582, "Plan this trade" at 450) | 390 / 390 |
| Closed trades | **534** / 390 (both boots) | `.toolbarRight`, a no-wrap row of four buttons | 390 / 390 |
| Trade page | **470** / 390 (both boots) | the header's action group, an inline-styled no-wrap span, ending at the Research button | 390 / 390 |
| Help | **406** / 390 (both boots) | the page header, from -16 to 406 | 390 / 390 |
| Position page (entry context card) | 390 / 390 | none | 390 / 390 |

At 820 and 1280 every screen fit, before and after. After the fixes: 0 of 30 measurements
wider than the window.

**The research workspace with flags off read 390 in this sandbox, not the 450 the walk
reported.** With every switch off its header holds Ask, New note and New thesis, and that fit.
The walk's 450 is exactly where "Plan this trade" ended in the ON boot here, so its "flags
off" state most likely had the trade canvas on. The fix does not depend on which buttons are
present: the row wraps.

**The saved "why" Edit control:** 21.8 x 44 px at 390 and 820 before, **44 x 44** at both
after. At 1280 it is 21.8 x 19.2, unchanged (the floor is for the touch tier).

What changed (CSS only, except one class name):

| Screen | Change | File |
|---|---|---|
| Research workspace | `.headerActions` wraps and may shrink (it was `flex-shrink: 0`, no wrap). On a phone it starts from the left. | `TickerResearchWorkspace.module.css` |
| Closed trades | `.toolbarRight` wraps at 640 px and under. | `TradeJournalTab.module.css` |
| Trade page | The header's action group was `style={{ display: 'inline-flex' }}` on a span. It is a class now (`.headActions`) that wraps, and takes its own row at 640 px and under. | `TradeDetailPage.jsx`, `TradeDetailPage.module.css` |
| Help | The header's negative margin comes from `--page-pad-x`. The phone rule changed the page padding to 12 px and left the variable at 28 px, so the header was 16 px wider than the page on each side. The phone rule now sets both variables. One declaration, additive. | `Support.module.css` |
| Why prompt | `.linkBtn` has `min-width: var(--tap-min)` beside its `min-height` at 1024 px and under. | `WhyPrompt.module.css` |

All media queries are the canonical 640 and 1024. No layout is decided by a JavaScript media
hook.

Regression rail: `app/src/pages/journal-2-0/a11y/phoneOverflow.test.js` (11 tests). jsdom
cannot see overflow, so it holds the rule that fixed each screen: the row wraps, the Help
variables equal the padding (with a desktop control), the floor has both dimensions.

Sandbox record: three walks ran. Integrity (the shared data root, 62 database files hashed
at each checkpoint) was CLEAN at every checkpoint that was taken. In the second walk's OFF
boot the launcher did not exit gracefully within 120 s and was force-stopped, so that boot has
no shutdown checkpoint and the tool marked it INCOMPLETE (its pre-boot, +15 s and +120 s
checkpoints were CLEAN). Every other boot stopped gracefully. The port was confirmed free
after each run. The sandbox data dir `C:/data-fin-a11y` was left in place.

A person or the device walk must confirm: on a real phone, the four screens no longer scroll
sideways; the wrapped rows look intended (research header buttons on two or three lines,
closed trades buttons on two lines, trade page actions on their own row under the symbol);
and the Help header still spans the full width with no gap at either edge.

## 6. Decisions

Ruled by the controller: I-5 keeps buttons with `aria-activedescendant`. I-4's bottom-sheet
replay stands, the older trade replay included.

Still open:

1. The flags-off parity rail reads DIFFERS because of the Passed setups status line
   (section 5). Accept it, or move the rail's base commit.
2. The passive explainer is now the first Tab stop on the page, ahead of the skip links.
3. The fixed line colours callers pass to the replay (section 5).

## 7. Tests

Run from `app/`, named files only, `--maxWorkers=2`. Logs are in the lane's scratchpad.
These are the round 2 totals (the final state of the branch).

- Rails: `tapFloor`, `tokens.reachable`, `themeIslands`, the Notebook contrast rail, surface
  and aria coverage, target floors, the tour registry, anchors, reachability and lazy rails,
  `baseTour.zeroDrift`, `Sheet.test.jsx`, `components/screener/reachable.test.js`.
  Result: 20 files passed, 1 failed; 348 tests passed, 1 failed, 1 skipped.
  The one failure is in `reachable.test.js`: a parking note for five chart-engine files
  expired on 2026-10-06, the day of this run. This lane did not touch that file or those
  modules.
- Touched components, part 1 (includes the Positions tests): 34 files, 376 tests, all passed.
- Touched components, base tour and the a11y surface suites, part 2: 53 files, 454 tests, all
  passed.
- Round 3 unit run (the overflow rail, tap floor, tokens, contrast, target floors, and the
  tests of the five files touched): 17 files, 232 tests passed, 1 skipped.
- Round 3 browser walk: before, 7 of 30 measurements wider than the window; after, 0 of 30.
- `tools/notebook_w14_flagsoff_parity.py`: 36 identical, 4 differ (see section 5).

New test files: `ThesisChip.test.jsx` (extended), `HoldingsList.thesisChip.test.jsx`,
`BarReplay.a11y.test.jsx`, `BarReplay.theme.test.jsx`, `TemplatePicker.searchCaret.test.jsx`,
`ChartPlanPanel.keyboardDoor.test.jsx`, `GenericTourEngine.announce.test.jsx`,
`NotebookTour.announce.test.jsx`, `TourOfferPrompt.focus.test.jsx`, `WhyPrompt.focus.test.jsx`,
`MyPlaybook.focus.test.jsx`, `GettingStartedList.announce.test.jsx`,
`TemplateGallery.focus.test.jsx`, `researchMinors.a11y.test.jsx`,
`journalMinors.a11y.test.jsx`, `PositionsTable.nesting.test.jsx`.

Existing tests edited on purpose, each named in its commit: three 13Q-5 search-box key tests,
one My Playbook status wait, one gallery admin button name, one Help replay link name, and two
Positions phone tests that asserted `role="button"` on the card.

## 8. Commits, one surface each

| Commit | Surface | Findings |
|---|---|---|
| `64e4ed62e1` | Thesis chip, Holdings row | I-1, I-2, I-3, M-9 |
| `d038bbf223` | Bar replay | I-4, M-9 |
| `258ad0c7ac` | Template picker search | I-5 |
| `33e1f529eb` | Chart plan levels | I-6 |
| `619f123bb0` | Loss ink and the contrast rail | I-7 |
| `fde51c6f3d` | Tours and the tour offer | I-8, M-2, M-3 |
| `559f28e69c` | Why prompt | I-9 |
| `6bc86172d7` | My Playbook | I-10, M-10, M-11, M-16 |
| `10b0d60085` | Get started list | M-1 |
| `9cbe3aeaf5` | Community gallery, admin review queue | M-4, M-16 |
| `cb5c30b38d` | Research surfaces | M-5, M-7, M-8, M-10, M-13, M-16 |
| `e4ba9b121b` | Trade page and Insights cards | M-6, M-8, M-9, M-12, M-16 |
| `9818cc26be` | Help walkthroughs | M-14 |
| `83568a12d2` | Bulk action bar | M-15 |

| `51bd784f14` | Round 1 docs, regenerated contrast table, lint | |
| `ec016d8f35` | Positions phone card | round 2, item 1 |
| `fffec74ffe` | Base tour | round 2, item 2 |
| `bb35f63360` | Replay chart colours | round 2, item 3 |
| `65393413b9` | Passive explainer Tab order | round 2, item 4 |
| `7a7d75f229` | Transcript count test | round 2, item 4 |

| `21db9ae95f` | Round 2 docs | |

Round 3's commits follow those: the walk tool and the "before" evidence, one commit per
screen, then the rail, the "after" evidence and this file.
