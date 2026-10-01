# Notebook accessibility -- second reviewer's report

Ruling D-9B2 (wave 9, lane 9B). This reviewer built no part of the Notebook. Findings only --
nothing in product code, the gap ledger, or the brief's section 1 facts was edited. Raw record
committed first (R-RAW), this summary second, per `docs/notebook/a11y-second-review-brief.md`.

**Tip under review:** `46f54d80b577ad95becc06a739f9e54ee4f69e27` (master; the review branch's
own base -- `git merge-base review/notebook-a11y-second origin/master` resolves to this SHA, and
nothing besides this evidence directory was added on top of it).
**Browser:** Chromium (Playwright, headless), real `page.keyboard` input only -- no `.click()`,
no selector-driven `.focus()`.
**OS:** Windows 11 (the reviewer's box).
**Sandbox:** `scripts/hub_sandbox_boot.py`, local data dirs under the session scratchpad (never
`C:\data`), ports 8302-8305. Shared-data-root integrity **CLEAN** at every checkpoint on both
runs that produced the committed evidence (`integrity.md`, `integrity-supplement.md`).
**Accounts:** `a11y2-reviewer@local.dev` (paid), `a11y2-fresh@local.dev` (paid, zero notes, for
the first-run tour), `a11y2-sup@local.dev` (paid, for the supplementary checks) -- all
sandbox-only, created through the product's own signup + admin comp-access + verify-email doors.
**NVDA / VoiceOver:** not attempted. Sections 4a and 4b are the owner's; nothing here simulates
them.

## What ran

| artifact | what | steps | findings |
|---|---|---|---|
| `walk.py` -> `focus-log.json` | the main walk: List, Editor, Graph, Sheets/dialogs, note links, public pages (signed out), the TickerPopup trigger census, touch tier (390/820/320px), first-run tour | 1087 | 6 (F001-F006) |
| `walk_supplement.py` -> `focus-log-supplement.json` | two targeted re-checks: the Keyboard Shortcuts door (via its own labelled button, not a guess), the graph canvas with a wide budget | 43 | 2 (S001-S002) |

Three earlier attempts (`a11y2-run2`/`run3`, and the supplement's first pass) are **not** in the
committed record -- each found a bug in the walk instrument itself (a wrong note URL pattern, a
test order that let the editor's own table trap the probe, a touch context missing its session,
an overly-broad focus-name heuristic), and each bug is fixed in the committed `walk.py` /
`walk_supplement.py`, with the mechanism explained in that file's own comments at the fixed
line. Only the corrected, final runs' raw output is committed. This is disclosed because a
reviewer who re-runs `walk.py` and gets different numbers should know three earlier shapes of it
existed and why they are gone, not treat the committed one as the first attempt.

---

## Section 2 -- WCAG 2.2 AA map, with a verdict per success criterion

Verdict key: **PASS** (demonstrated by an actual keyboard step, cited) - **FAIL** (a finding
below) - **NOT CHECKED** (honestly not exercised this round, with the reason).

| SC | verdict | evidence |
|---|---|---|
| 1.1.1 Non-text content | NOT CHECKED | no systematic icon/alt audit this round; axe (support only, not primary) was not run by this reviewer |
| 1.3.1 Info and relationships | PASS (editor tables) / FAIL (published note link) | `focus-log.json` steps 199-208 (table toolbar reachable, header row present); finding A2R-06 below (a `[[` link degrades to inert generic text on a published page) |
| 1.3.2 Meaningful sequence | NOT CHECKED | split view / two-column layout not exercised |
| 1.3.4 Orientation | NOT CHECKED | no orientation-lock test run |
| 1.3.5 Identify input purpose | NOT CHECKED | sign-in autocomplete attributes not inspected |
| 1.4.1 Use of colour | NOT CHECKED | -- |
| 1.4.3 Contrast (minimum) | NOT CHECKED (out of this reviewer's instrument) | the brief scopes contrast to the CSS rail + the owner's screen-reader-adjacent browser pass; this walk is keyboard-focus only |
| 1.4.4 Resize text | NOT CHECKED | -- |
| 1.4.10 Reflow | **PASS** | `focus-log.json` step 1073: at 320 CSS px, `document.documentElement.scrollWidth === clientWidth === 320` -- no horizontal scroll, list surface |
| 1.4.11 Non-text contrast | PARTIAL, see A2R-01/A2R-02 | focus-ring presence recorded per step (`visibleIndicator`) throughout `focus-log.json`; every PASS cited below had `visibleIndicator: true` at the moment of the finding |
| 1.4.12 Text spacing | NOT CHECKED | -- |
| 1.4.13 Content on hover or focus | NOT CHECKED | tooltips/link previews not exercised this round |
| 2.1.1 Keyboard | **FAIL** (multiple) | A2R-03 (graph canvas), A2R-05 (TickerPopup trigger, app-wide), A2R-04 (Keyboard Shortcuts door) -- see findings table. **PASS** for: skip link (after intro dismiss), sidebar/folders/tags, view-mode switches, note card open, editor toolbar (full sweep, `focus-log.json` 133-147), Ask panel, More note actions + its 10 items, Export (as a menu item), Find/Replace, slash/emoji/`[[`/`@` menus, table create + Alt+F10 toolbar, Share/Save view/Templates/Delete dialogs, command palette, the `[[` note-link chip (step 791) |
| 2.1.2 No keyboard trap | **PASS** (dialogs tested) | Share (461-464), Save view (532-533), Templates (605-607), Delete (686-688) each confirmed Tab stays inside and Escape returns focus to the opener. Export menu's documented "Tab stays inside" contract was not contradicted (`in_menu` probe found no leak). Table Tab-capture is the documented known gap (see below), not re-litigated as a new trap |
| 2.1.4 Character key shortcuts | **PASS** | `/`, `:`, `[[`, `@` all fired only with the caret in the body (`focus-log.json` 237-245); none fired while focus was on a toolbar control (confirmed indirectly -- the slash/emoji/link/date tests only triggered after `E-reach-body` landed on the body) |
| 2.4.1 Bypass blocks | **FAIL** (minor) | A2R-01 -- the skip link is not literally first on a fresh load |
| 2.4.2 Page titled | NOT CHECKED | tab-title-per-note/view not inspected |
| 2.4.3 Focus order | **FAIL** (minor) + PASS elsewhere | A2R-02 (note open lands on an h2, not the documented title input); PASS for Share/Save view/Templates/Delete restore-to-opener (cited above) |
| 2.4.6 Headings and labels | NOT CHECKED | -- |
| 2.4.7 Focus visible | **PASS**, with one unresolved case | every cited PASS step above carries `visibleIndicator: true`; NOT CHECKED whether the h2 in A2R-02 has any visible indicator at all (screenshot shows none, but it may be an intentionally invisible SR-announcement target -- see A2R-02) |
| 2.4.11 Focus not obscured (minimum) | NOT CHECKED | -- |
| 2.5.1 / 2.5.2 Pointer gestures / cancellation | NOT CHECKED | touch pass was reachability-only (10 Tabs per viewport), not a gesture audit |
| 2.5.3 Label in name | NOT CHECKED | no systematic visible-vs-accessible-name diff run |
| 2.5.7 Dragging movements | NOT CHECKED | block-move/image-resize drag alternatives not exercised |
| 2.5.8 Target size (minimum) | NOT CHECKED | no geometry sweep this round |
| 3.2.1 / 3.2.2 On focus / On input | **PASS** (incidental) | no unexpected navigation was observed on any Tab stop across 1087 + 43 steps |
| 3.2.6 Consistent help | NOT CHECKED | -- |
| 3.3.1 / 3.3.3 Error identification / suggestion | NOT CHECKED | no error path (failed save, refused upload) was forced this round |
| 3.3.2 Labels or instructions | NOT CHECKED | -- |
| 3.3.7 Redundant entry | NOT CHECKED | -- |
| 3.3.8 Accessible authentication | NOT CHECKED | sign-in not walked (paid-only sandbox accounts were provisioned via API, not through the UI) |
| 4.1.2 Name, role, value | **FAIL** (one case) + PASS elsewhere | A2R-04's button half (the "Show keyboard shortcuts" button does not activate on Enter -- a role/value mismatch: it reports as a button and accepts focus, but produces no value change); PASS for the ~90 distinct controls named correctly throughout the editor sweep (`focus-log.json` 133-234) |
| 4.1.3 Status messages | NOT CHECKED (conclusively) | the Ask panel's answer and the capture toast were not confirmed as `role=status`/`aria-live` this round -- the capture button could not be reached (see below) to test it |

## Section 3 -- the keyboard-only walk: coverage

| surface | covered | notes |
|---|---|---|
| **L** list | yes | skip link, sidebar, folders/tags/saved views, view-mode switcher, bulk-select approach |
| **S** sidebar | yes | folders, tags (as part of the list walk) |
| **E** editor | yes | title/subtitle/tags, full toolbar, Ask, Find/Replace, slash/emoji/link/date menus, table create + toolbar + the documented Tab-in-table + Shift+Tab-out, More note actions (10 items), History panel, Export (as a menu item) |
| **H** sheets/dialogs | yes | Share, Save view, Templates, Delete confirmation, command palette, Keyboard Shortcuts (failed to open -- see findings) |
| **P** public pages | yes | share link and published page, both signed out |
| **Touch tier** | partial | 390px and 820px: 10 Tabs each, reachability only, not a full re-walk; 320px reflow: full PASS check |
| **First-run tour** | yes | fresh zero-note account; tour steps reachable, Skip tour / Next both work |
| **Locked-note capture refusal** | **NOT RUN** | the trigger (TickerPopup's consensus-capture button) could not be reached within budget -- see below |
| **Links in notes** | yes | the `[[` chip is reachable and has the correct name; Ctrl/Cmd+click and plain-click behavior is a pointer-mode question the brief itself frames that way, recorded as out of the keyboard tally |
| **Template gallery** | yes | opens, traps, restores |
| **"Note too long for one PNG"** | **N/A on this tree** | grepped `app/src/pages/journal-2-0/**` for "too long for one", "one image", "exceeds... PNG" and variants -- zero hits; not merged yet |
| **Analyst-consensus capture button** | partial | the button's own accessible name and position were never reached live (Open Positions tab not activated within 80 Tabs from `/journal`, confirmed twice); but the DOM census (A2R-05) demonstrates the TRIGGER CLASS it depends on (TickerPopup, `as=button` default) is unreachable on 12 of 12 rendered instances on `/dashboard`, and code review (below) explains why |

---

## Findings table

| id | WCAG SC | surface | steps (keys) | expected | seen | severity | known gap? | evidence |
|---|---|---|---|---|---|---|---|---|
| A2R-01 | 2.4.1 | L, fresh page load | Tab (first, immediately after a genuine full navigation to `/journal/notebook?view=all`) | `tabs/NotebookTab.jsx:1471` "Skip to notes list" is the first focusable element | the cinematic intro animation's own "Skip intro" button is first; the Notebook's own skip link is reachable only after dismissing it (one more Tab/Escape) | minor | new | `focus-log.json` step 2, `screenshots/0002-L-skiplink-intro-first.png` |
| A2R-02 | 2.4.3 | E, opening a note | Enter on a note card (900ms settle) | focus lands IN the title field (`screen-reader-pass.md` step 10, `NoteEditorPage.jsx:3565`: role=textbox, name "Note title") | focus is on an `<h2>` reading "SR pass" -- not the title `<input>` (confirmed by source: the real input has `aria-label="Note title"`, which did not appear) | minor | new | `focus-log.json` step 132, `screenshots/0132-E-open-title-focus.png` |
| A2R-03 | 2.1.1 | L, graph canvas | Tab x70 from `/journal/notebook?view=graph` (main walk), repeated at Tab x160 (supplement, more than a full double-cycle of the page) | the canvas (`role="application"`, `tabIndex={0}`, `NoteGraphView.jsx:670-672`) reachable by Tab | never reached in either run; the full page cycles through every chrome control and wraps back to the top without ever landing on an `application` role or a name containing "Note graph" | **blocker** | new | `focus-log.json` step 398, `screenshots/0398-G-canvas-not-reached.png`; `focus-log-supplement.json` steps 7-166, `screenshots/sup-0166-graph-not-reached.png` |
| A2R-04 | 2.1.1 / 4.1.2 | H, Keyboard Shortcuts ("?") | (a) Tab to the explicit "Show keyboard shortcuts" button, Enter; (b) a bare "?" key press from a settled, non-input focus | either door opens `ShortcutCheatSheet` (role=dialog, "Keyboard Shortcuts") | **neither door opens it.** (a): the button is reached, carries a visible focus ring (screenshot), Enter produces zero DOM change -- `dialogCount: 0` before and after. (b): the bare key also produces `dialogCount: 0`. A keyboard-only member cannot open this dialog by any means tested | **blocker** | new | `focus-log-supplement.json` steps 38-40 (button door) and 41-43 (bare key), `screenshots/sup-0039-SUP-shortcuts.png` (visibly focused, no dialog) |
| A2R-05 | 2.1.1 | app-wide (reached via Notebook's own "analyst consensus" feature) | DOM census on `/dashboard`: `querySelectorAll('[role="button"][aria-label^="View chart for"]')` | every ticker chip that opens `TickerPopup`'s chart (and, inside it, the Notebook's "Save `<SYM>`'s analyst consensus to Notebook" button) is reachable by Tab | **12 of 12** rendered triggers on `/dashboard` are `<div role="button" tabindex="-1">` -- not in the tab order and not activatable by Enter/Space even if it were, because `<Tag>` (default `span`) carries no `onKeyDown`. Source: `TickerPopup.jsx` -- `role="button"` and `aria-label` are set (218-238) but no `tabIndex` and no key handler; the default `as` prop is `'span'`. Of 37 call sites app-wide, 26 pass no `as="button"` override, so this reproduces on ~70% of the surfaces that render a ticker chip, including inside Notebook notes that reference a ticker | **blocker** | new | `focus-log.json` step 794, `screenshots/0794-DOM-check-unreachable.png`; code: `app/src/components/TickerPopup.jsx:218-238`, call-site census via `grep -rn "<TickerPopup" app/src` |
| A2R-06 | 1.3.1 | P, published page, a note containing a `[[` link | open a note containing a `[[` link to another note; publish it; read it signed out | the reference survives as something a reader can use -- the live NodeView resolves the current title and renders a navigable chip when the member views it | on the **published, signed-out** page the same content renders as the literal, generic, non-interactive text "linked note" (not even the real target's title, and not a link) -- confirmed in source: `noteLinkNode.jsx:44-50`, `renderHTML()`'s own comment: *"Static fallback for contexts that don't mount the React node view (paste-out, HTML export outside this app)"* -- the published-page renderer is evidently one of those contexts | major | new | `screenshots/0806-P-publish-nav.png` (page title "Note with an outgoing link", body reads "See linked note for context." -- generic, not the real linked title "Linked target note"); code: `app/src/pages/journal-2-0/lib/noteLinkNode.jsx:44-50` |
| A2R-07 | 2.1.1 | E, editor chrome | Tab x60, seeking a standalone "Export" button (the `role="menu"` control `NoteExportControls.jsx` documents) | a standalone Export control with `aria-label="Export this note as"` reachable in the editor chrome, separate from "More note actions" | not found in 60 Tabs; "Export" IS reachable as item 8 of 10 inside "More note actions" (confirmed, step 684/156) -- this may be the current, intended consolidation (code review did not settle which of `NoteExportControls.jsx`'s two render paths is live for this account/plan), recorded as an open question for the controller rather than asserted as broken | minor | new (uncertain -- flag for controller) | `focus-log.json` steps 175-235 (not reached) and 156/684 (reachable inside the menu) |

### PASS rows (a representative census, not an exhaustive list -- every step is in `focus-log.json`)

| id | WCAG SC | surface | steps | result |
|---|---|---|---|---|
| P-01 | 2.1.2 / 2.4.3 | H, Share dialog | Enter on Share -> Tab -> Tab -> Escape | opens (role=dialog, "Share this note"), Tab stays inside (Close -> "Share link address"), Escape returns focus to Share button | `focus-log.json` 461-464 |
| P-02 | 2.1.2 / 2.4.3 | H, Save view dialog | Enter on Save view -> Escape | **focus lands directly in the Name field** ("e.g. Active Theses" textbox) on open -- matches the documented contract exactly; Escape restores focus to the Save view button | `focus-log.json` 532-533 |
| P-03 | 2.1.2 / 2.4.3 | H, Templates gallery | Enter on Templates -> Tab -> Escape | opens (role=dialog, "New note" -- the Sheet's own `title` prop, confirmed correct against source), Tab reaches Close, Escape restores focus | `focus-log.json` 605-607 |
| P-04 | 2.1.2 / 2.4.3 | H, Delete confirmation | Enter on Delete (inside More note actions) -> Tab -> Escape | opens, Tab reaches Delete, Escape cancels and restores focus to the Delete trigger | `focus-log.json` 686-688 |
| P-05 | 2.1.1 | E, More note actions | Tab x7 from note open -> Enter -> Tab x9 | the menu (position 7 in the chrome cluster) opens and all 10 items -- Duplicate, Lock, Archive, Save as template, Open a note beside, PNG, Print, Export, Delete, Version history -- are each individually reachable and named | `focus-log.json` 141-158 |
| P-06 | 2.1.1 | E, Ask panel | Tab to Ask -> Enter -> Tab -> type -> Enter -> Tab -> Enter | opens with focus in the question field, accepts typed input, submits, and "Close Ask" is reachable and returns focus to the Ask trigger | `focus-log.json` 133-140 |
| P-07 | 2.1.1 / 2.1.4 | E, slash / emoji / `[[` / `@` menus | `/`, ArrowDown, Escape; `:`, Escape; `[[Linked`, ArrowDown, Escape; ` @`, ArrowDown, Escape | each menu opens and Escape returns the caret to "Note body" every time, with no stray key leakage to the chrome | `focus-log.json` 237-245 |
| P-08 | 2.1.1 | E, Find/Replace | Ctrl+F -> type -> Ctrl+H -> Tab -> Escape | Ctrl+F opens a real `searchbox` named "Find in note"; Ctrl+H reveals the Replace row; Escape returns focus to "Note body" | `focus-log.json` 246-249 |
| P-09 | 2.1.1 | E, table create + toolbar | `/table`, Enter, Tab, Tab, Alt+F10, Escape, Shift+Tab, Shift+Tab | table inserts; Alt+F10 area and the documented Shift+Tab-twice exit both produced DOM movement consistent with the documented contract (see the caveat under A2R-07/known gaps -- this reviewer's own instrument cannot distinguish caret position from `document.activeElement` inside one contenteditable region, so this is recorded as a PASS on the documented exit mechanism working, not a full table-navigation proof) | `focus-log.json` 250-256 |
| P-10 | 2.1.1 | E, note link chip | Tab x92 from a direct note URL | the `[[` chip to "Linked target note" is reached, correctly named, role=button | `focus-log.json` step 791 |
| P-11 | 1.4.10 | L, 320 CSS px | resize to 320x800, read `scrollWidth`/`clientWidth` | `320 === 320` -- no horizontal scroll | `focus-log.json` 1073 |
| P-12 | 2.1.1 | H, command palette | Ctrl+K -> Tab -> Escape | opens with focus in the search combobox, Tab stays inside (single field), Escape closes | `focus-log.json` 690-692 |

### NOT RUN (named, with the reason -- never left blank)

| surface | reason |
|---|---|
| Section 4a NVDA, Section 4b VoiceOver | belong to the owner per the brief; not attempted, not simulated |
| Locked-note capture refusal message (`captureTargets.js:105-106`, "... is locked -- ... captured to your inbox until you unlock it") | the trigger (the analyst-consensus button, which this reviewer pointed at a pre-locked note via `localStorage['uct.jw.lastNote']`) could not be reached -- the Open Positions tab was not activated within 80 Tabs from `/journal` in two attempts; the underlying reachability defect is independently proven by A2R-05 |
| 4.1.3 Status messages for the capture toast | same blocker as above |
| Contrast, colour-only meaning, target size, text spacing, orientation, redundant entry, consistent help, error identification | out of this reviewer's instrument this round -- the brief scopes contrast/geometry work to the CSS rail and the real-browser axe sweep (`docs/notebook/proof/`), not the keyboard walk; recorded NOT CHECKED rather than guessed |
| A full touch-tier re-walk at 390/820 | time-boxed to a 10-Tab reachability sample per viewport; a full re-walk (view-mode switches, bulk select, drag alternatives) was not attempted |

---

## Cross-check against the gap ledger and `accessibility.md`

- **G-168** (this ledger row) already records: machine rails DONE; a prior, **non-independent**
  keyboard pass (wave 10 lane 10E-2 -> F4 -> K2, `docs/notebook/evidence/a11y-second-review-2026-09-27/`
  and `a11y-f4-keyboard-2026-09-27/`, `a11y-k2-keyboard-2026-09-28/`) found issues and fixed some;
  "seven steps still FAIL" as of its last recorded re-walk. **This review is the first INDEPENDENT
  second-reviewer pass the ledger calls for (ruling D-9B2)** -- the 10E-2/F4/K2 lineage was built
  by the same team shipping the feature, which is exactly what the brief says this review exists
  to be different from. This reviewer did not reconcile the findings above against 10E-2's seven
  remaining FAILs item-by-item (that lineage's raw JSON was not opened in full) -- the controller
  should diff them; none of A2R-01 through A2R-07 are named in `accessibility.md`'s "Known gaps"
  section as it reads today, so **all are marked "new"** above rather than assumed identical to an
  unread prior finding.
- **`docs/notebook/accessibility.md` known gaps** (read in full before this walk): the graph
  canvas's *light-theme colour* problem is recorded there -- this review's A2R-03 is a
  **different, more severe** claim (the canvas is not *reachable at all* by keyboard, independent
  of theme) and does not overlap with the recorded gap; recorded as new rather than a
  restatement. The table-Tab-ownership gap, the Support-page focus-outline gap, and the "delete
  lands on Research home" gap were all either out of this walk's scope (Support page is
  explicitly not Notebook CSS) or not re-triggered (no note was deleted from "All notes" this
  round) -- neither confirmed nor contradicted.

## Severity key (restated from the brief)

*blocker* = a task cannot be completed by keyboard at all (A2R-03, A2R-04, A2R-05 are all this
tier -- a graph that cannot be opened, a help dialog that cannot be opened, and a chart/capture
button that cannot be reached). *major* = possible with a workaround a member would not find
(A2R-06). *minor* = everything else (A2R-01, A2R-02, A2R-07).

## What this reviewer could not do, and why

- NVDA and VoiceOver -- explicitly the owner's, per the brief; not attempted.
- A full contrast/geometry/target-size pass -- out of scope for the keyboard walk (the brief
  routes that to the CSS rail and the real-browser axe sweep); recorded as NOT CHECKED rather
  than inferred from axe's own prior PASS (axe is support, never the finding, per the brief).
- The analyst-consensus capture flow end-to-end (including the locked-note refusal message and
  its status-region behaviour) -- blocked upstream by A2R-05's reachability failure; this is
  recorded as NOT RUN rather than guessed at, and the controller has the independent DOM evidence
  for the root cause regardless.
- A full second re-walk of every surface at 390px/820px -- time-boxed to a reachability sample.
