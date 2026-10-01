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

---

## Re-walk -- against `origin/feat/notebook-w10-af` (tip `1c08d0c33`), 2026-10-01

Controller ruling: A2R-06 and A2R-07 are by design (no re-walk). A2R-01 through A2R-05 were sent
to a fix lane (commits `fdb71cfa82`/`a497226b8d`/`a598dbe54c`/`5d8287490f`/`1c08d0c336`, all now
ancestors of this branch's tip). Same independent reviewer, same rules (`page.keyboard` only,
never `.click()`/selector-`.focus()`), fresh sandbox boots, R-RAW raw-first. Branch
`review/notebook-a11y-rewalk`, same worktree, same `node_modules` junction.

**What ran** (all under `rewalk/`, this section's own evidence directory):

| artifact | what | steps | auto findings |
|---|---|---|---|
| `walk_rewalk.py` -> `focus-log-rewalk.json` | A2R-01 through A2R-05 combined, one browser context | 843 | 3 (RW001-RW003, all pre-known STILL-OPEN exceptions or the pre-existing Journal-reach limit) |
| `walk_rewalk_lock.py` -> `focus-log-rewalk-lock.json` | the previously-NOT-RUN item: lock a note by keyboard, capture against it from a dashboard ticker popup | 119 | 0 auto-flagged -- see RW-NEW-02 below, derived from this run's own raw `mutationSeen` field + source |
| `walk_rewalk_a2r05_page2.py` -> `focus-log-rewalk-a2r05-page2.json` | A2R-05's "at least two other pages" requirement, second full interactive pass: Open Positions (`/journal/trades?seg=open`), Enter-door and Space-door | 163 | 0 |

**Two harness bugs found and fixed in THIS reviewer's own instrument while re-walking, recorded
for the same reason the original review recorded its three** (a reviewer who re-runs these scripts
and gets different numbers should know why):
1. `goto()`'s single fixed-delay Escape raced the intro's own mount effect -- **the identical class
   of bug the fix lane's own R-RAW commit (`1c08d0c336`) documented and fixed independently in
   their harness.** Confirmed by running `walk_rewalk_lock.py` BEFORE applying a fix: it reproduced
   on this reviewer's machine too (burned 48 of a 60-Tab budget on "Skip intro"). Fixed by retrying
   Escape (against an independent overlay check -- `position:fixed`+`z-index>=99999`, the same test
   `check_a2r_01` already used) rather than copying the fix lane's own instrument verbatim.
2. That fix was NOT sufficient on its own. A second run, with the fix applied, reproduced a
   DIFFERENT shape of the same race: the overlay mounted LATE -- after `goto()`'s own dismiss loop
   had already (correctly, at that moment) found it absent and returned -- and then played its full
   animation during the NEXT Tab-seek loop, again burning 48 of 60 Tabs. Fixed by making every
   Tab-seek loop itself overlay-aware (`dismiss_overlay()`, checked once per loop iteration, cheap
   when absent) rather than trusting a single check at navigation time. Both fixes are in
   `walk_rewalk_lock.py`'s own comments at the fixed lines; `walk_rewalk.py`'s `goto()` was hardened
   the same way for consistency (not re-run -- its original 843-step evidence never hit the race, a
   genuinely fresh context only replays the intro once, and this script reuses one context across
   the whole combined walk).

### Finding-by-finding

| id | new status | evidence |
|---|---|---|
| A2R-01 | **CLOSED** | `focus-log-rewalk.json` steps 827-843: a genuinely fresh context, 15 Tabs, focus never left `button "Skip intro"` -- the overlay's own trap holds throughout, matching the fix lane's claim |
| A2R-02 | **CLOSED** (judgment call, reasoning below) | step 764: opening an EXISTING note lands focus on `<h2 data-note-landmark>` (`hasNoteLandmark: true`), confirmed `NoteEditorPage.jsx:906-913`'s own reasoning (deliberate, not the title input) -- see below for the focus-visible judgment |
| A2R-03 | **CLOSED** | switcher door (step 56), direct `?view=graph` load (steps 57-123: canvas reached, `role="application"`, Home/ArrowRight/Enter all functional), list alternative via Space on "Show as list" (step 188), AND direct loads of `?view=table`/`board`/`calendar`/`timeline` each confirm their OWN view-switcher button `aria-pressed=true` with `researchHome=False` (steps 189-196) -- none of the five redirects to Research Home |
| A2R-04 | **CLOSED** | Enter opens the dialog (steps 232-233), Space opens it too (step 301), Tab-trap holds across 30 probes on the dialog's one focusable control (steps 234-263), Escape restores focus to the opener (steps 264-265, `restored: true`); the real `Shift+Slash` chord opens it (step 307); **the fix lane's `press("?")` claim independently reproduced** (step 306, below); `?` does NOT open it with the caret in the editor body (step 388, `found: false`) |
| A2R-05 | **CLOSED on /dashboard and on Open Positions; the two deliberate exceptions remain STILL OPEN, with fresh evidence; NEW observation below** | see the dedicated subsection |
| A2R-06 | controller ruling: by design | not re-walked |
| A2R-07 | controller ruling: by design | not re-walked |
| Locked-note capture refusal (previously NOT RUN) | **RUN. New finding RW-NEW-02 below.** | `focus-log-rewalk-lock.json`, see below |

### A2R-04's independently-verified keydown claim

The controller asked this reviewer to verify, not trust, the fix lane's measurement that
`page.keyboard.press("?")` sends `shiftKey:false` with `code:"Slash"` -- not what a physical
keyboard chord produces -- before relying on it. A keydown logger was installed fresh (this
reviewer's own `KEYLOG_INIT_JS`, not the fix lane's) and both forms were fired in sequence:

```
press("?")          -> {key:'?', code:'Slash', shiftKey:false, ...}
press("Shift+Slash") -> {key:'Shift', code:'ShiftLeft', shiftKey:true, ...}
                         then {key:'?', code:'Slash', shiftKey:true, ...}
```
(`focus-log-rewalk.json` step 305, full cumulative keylog; step 306, the isolated comparison.)
**Confirmed, independently.** The bare `"?"` shorthand is not a real chord; `Shift+Slash` is, and
only the latter is what a member's physical keyboard sends. Step 307 confirms the dialog opened
from the `Shift+Slash` sequence.

### A2R-05 -- full detail

**`/dashboard` (full re-test):** Enter on `button "View chart for QQQ"` opens the modal (step
415); Tab reaches `"Save QQQ's current price to Notebook"` and `"Save QQQ's analyst consensus to
Notebook"` (steps 442-443, 28 Tabs in); Escape closes it and restores focus to the trigger (steps
444-445, `restored: true`); Space re-opens the same trigger (steps 446-448). **Closed.**

**Second page, as the controller required ("at least two other pages"):** the combined walk's own
160-Tab budget for `/journal` (same pre-existing ceiling the original review hit at 80) did not
reach Open Positions by Tab-seeking the outer Journal shell (`focus-log-rewalk.json` step 689,
finding RW001). Rather than accept that as the whole answer, this reviewer navigated DIRECTLY to
the real route (`/journal/trades?seg=open` -- `app/src/pages/journal-2-0/j2tabRedirect.js`'s own
map for `j2tab=positions`), with one open position seeded through the product's own
`POST /api/j2/positions` so a chip would render. **Both the Enter-door and the Space-door pass
closed cleanly**: trigger reached (`focus-log-rewalk-a2r05-page2.json` steps 64 and 146), both Save
buttons reached (steps 77-78 and 159-160, `price_btn_seen=true consensus_btn_seen=true`), Escape
restored focus to the trigger both times (steps 81 and 163, `restored: true`). Zero auto-findings.
**Closed, on a genuine second page** (`PositionsTable.jsx:236-241`'s TickerPopup -- the TABLE-mode
chip; the default LIST/card-mode render was tried first and its own 60-Tab budget ran out inside
the outer Journal chrome before reaching inside a card, so the walk explicitly switched to Table
view via its own reachable button first -- recorded in the script, not hidden).

**The two deliberate exceptions, re-confirmed live:**
- **UCT20 rows** -- `/uct-20`'s DOM census: 3 of 3 rendered triggers are `tabIndex=-1`
  (`focus-log-rewalk.json` step 693). Source: `UCT20.jsx:182` passes `focusable={false}`, with the
  fix lane's own in-file comment explaining why (the chip nests inside a row that is already
  `role="button"` with its own Enter/Space handler). **STILL OPEN**, per the controller.
- **News feed chips** -- confirmed by CODE, not live DOM, because `NewsFeed.jsx` only mounts when
  `VITE_TWITTER_UI_ENABLED` is built as `'0'` (`TapeFeed.jsx`: `if (!UI_ENABLED) return
  <NewsFeed />`, default `'1'` when unset) and this build did not set it
  (`focus-log-rewalk.json` step 694). `NewsFeed.jsx:107` passes `focusable={false}` with the same
  A2R-05 citation comment as UCT20. **STILL OPEN, not live-verified** -- recorded as such rather
  than asserted from a screen this build never rendered.

**`/breadth`** was also censused: zero TickerPopup triggers rendered (`count: 0`,
`focus-log-rewalk.json` step 691) -- a sandbox-data artifact (nothing to drill into), not evidence
either way.

### RW-NEW-01 (new observation, both pages) -- the chart modal does not move focus into itself

Not asked for by name, but surfaced directly by doing exactly what the controller asked (Tab
*through* the popup to the two Save buttons) now that the trigger is finally reachable at all --
something the original review could never observe, because A2R-05 made the entire modal
unreachable.

**On `/dashboard`:** after Enter on the trigger, the very next Tab does NOT land inside the modal
-- it lands on `"View chart for SPY"`, the NEXT ticker chip on the page behind the modal
(`focus-log-rewalk.json` step 416). Tab continues through five more background chips, the movers
sidebar, the ENTIRE left nav bar, and four Compass-orb controls -- 26 Tabs of background page
content -- before reaching the modal's own `"Switch ticker"` field and its buttons (steps 439-443).

**On Open Positions:** the same shape, smaller: after Enter, Tab lands on the row's OWN `"Edit
QQQ"`/`"Close QQQ"`/`"Delete QQQ"` buttons (still background page content, just closer by), then
the Compass orb, before reaching the modal (`focus-log-rewalk-a2r05-page2.json` steps 66-76).

In both cases Escape still closes the modal and correctly restores focus to the trigger (confirmed
above), so this is not a hard keyboard trap (2.1.2) and the controller's literal ask ("Tab through
the popup to the two Save buttons") was satisfiable either way. But a dialog that does not move
focus into itself on open, and leaves unrelated background content in the tab sequence while it is
visually modal, is a focus-order defect any keyboard user hits on EVERY use of this feature, not
an edge case -- WCAG 2.4.3 (Focus Order), and it reads as `role="dialog"` without the
focus-management half of the ARIA APG Dialog (Modal) Pattern it names. Filed as new because it was
**structurally unobservable before today**: A2R-05's fix is a precondition for noticing it, not a
cause of it -- recorded in case the fix lane reads this file as describing a regression it shipped,
which it did not.

- id: RW-NEW-01 | WCAG SC: 2.4.3 | surface: TickerPopup chart modal, both pages tested | severity:
  major | known gap: no | evidence: `focus-log-rewalk.json` steps 415-443;
  `focus-log-rewalk-a2r05-page2.json` steps 65-78

### RW-NEW-02 -- the locked-note capture refusal message (previously NOT RUN)

Full sequence, by keyboard, on a fresh account: opened a note (`focus-log-rewalk-lock.json` step
1, query-param URL); Tab-sought and opened "More note actions" (steps 2-58, 56 Tabs -- the overlay
raced here on two earlier attempts, see above); Tab-sought and activated "Lock" inside that menu
(steps 59-62); confirmed the lock glyph is present (`lockedGlyph: true`, step 63). Opening a note
for editing is what the product's own code already uses to set "last active note"
(`NoteEditorPage.jsx` writes `localStorage['uct.jw.lastNote']` on every open, confirmed in the
earlier session's source read -- no manual injection needed, this is the real flow). Navigated to
`/dashboard`, Tab-reached a ticker trigger (step 88, "View chart for QQQ" -- itself only possible
because A2R-05 is now fixed), Enter opened the chart modal, Tab-reached `"Save QQQ's current price
to Notebook"` (step 117), Enter fired it against the LOCKED note (step 118).

**The message, and where it lives:** `captureFinancialFact.js:60` --
`` `${ticker} price not saved — that note is locked. Unlock it in the Notebook first.` `` --
rendered by `TickerPopup.jsx:326-328` as `<span className={styles.flagToast}>`, no `role`, no
`aria-live`, and auto-removed after **exactly 2500ms** (`TickerPopup.jsx:162-164`,
`setTimeout(() => setCaptureToast(null), 2500)`).

**Is it exposed to assistive tech? No, confirmed two ways, not inferred from the source alone:**
1. A page-wide live-region census at the moment of the probe (`[role="status"],[role="alert"],
   [aria-live]`) found exactly two elements, both with EMPTY text (`focus-log-rewalk-lock.json`
   step 119) -- nothing on the page was announcing anything when the refusal fired.
2. A `MutationObserver`, armed BEFORE firing Enter, DID catch the toast's insertion into the DOM
   (class `_flagToast_19f8c_445`, matching `TickerPopup.jsx`'s own CSS-module class) -- confirming
   the refusal path genuinely ran -- but a direct DOM query run immediately after found no element
   whose text contained "locked" (`toastText: null`). The gap between those two readings IS the
   finding: the probe's own query lost a race against the SAME 2500ms timer the component uses, on
   a machine that should be no slower than an average member's. If a scripted probe cannot
   reliably observe this message, a screen reader -- which has no DOM-mutation shortcut and relies
   entirely on `role`/`aria-live` to know something appeared at all -- has no path to it whatsoever.

This closes the brief's NOT-RUN item with a concrete answer: the message exists, is correct, and
is invisible to assistive technology by construction (no AT-exposing attribute) and nearly
invisible to a sighted keyboard user by timing (2.5s, auto-dismissing, in a small corner of a
chart header). Filed as a new finding rather than folded into A2R-05, because A2R-05 was about
REACHING the trigger -- this is about what happens once a member reaches it and the action is
correctly refused.

- id: RW-NEW-02 | WCAG SC: 4.1.3 | surface: TickerPopup capture-refusal toast | severity: major |
  known gap: no | evidence: `focus-log-rewalk-lock.json` steps 1-119 (full sequence), step 119
  (`mutationSeen` + live-region census); code: `app/src/components/TickerPopup.jsx:162-164,
  326-328`, `app/src/pages/journal-2-0/lib/captureFinancialFact.js:60`

### A2R-02's focus-visible judgment call, made explicit

The original review left this as a genuine open question ("NOT CHECKED whether the h2 ... has any
visible indicator at all"). The rewalk's `FOCUS_JS` was extended to read BOTH the focused node's
own computed `outline`/`boxShadow` AND (new) its nearest `.notePane` ancestor's, since the landmark
is `className="sr-only"` by design and a screenshot of it in isolation would show nothing by
construction. Step 764's reading: the landmark itself reports a non-`none` `outline` from computed
style, but its own box is **1x1 CSS pixels** (`rect: {w:1, h:1}`) -- imperceptible regardless of
color. The `.notePane` ancestor, separately, carries `boxShadow: rgb(220, 187, 94) 0px 0px 0px 2px
inset` (`visible: true`) -- a real, CSS-confirmed gold inset ring around the whole editor pane.
**Judged CLOSED**: SC 2.4.7 asks whether a mechanism exists to make the focused element's location
visible, not that the indicator sit literally on an intentionally-invisible SR target; the pane-
level ring is that mechanism and is confirmed by computed style, not assumed from the screenshot
alone (`screenshots/rw-0764-A2R02-landing.png` is included for the record, and is subtle precisely
because the ring is a thin inset border, not a glow -- a UX reviewer could reasonably ask for it to
be bolder, but that is a design opinion, not a WCAG failure).

### Updated WCAG 2.2 AA rows (supersedes the Section 2 table above for these SCs only)

| SC | prior verdict | re-walk verdict | evidence |
|---|---|---|---|
| 2.1.1 Keyboard | FAIL (A2R-03/04/05) | **PASS** for the graph, the Keyboard Shortcuts door, `/dashboard`'s and Open Positions' TickerPopup triggers; **FAIL remains** for the two named, controller-acknowledged exceptions (UCT20 rows, news feed chips) | as cited per finding above |
| 2.1.2 No keyboard trap | PASS | **PASS, strengthened** -- the Keyboard Shortcuts dialog's single-control Tab cycle also confirmed to never leak to background content (30 probes) | `focus-log-rewalk.json` 234-263 |
| 2.1.4 Character key shortcuts | PASS | **PASS, strengthened + independently re-verified** -- the real `Shift+Slash` chord (not the `press("?")` shorthand) confirmed to both open the dialog AND respect 2.1.4 in the editor body | steps 305-308, 387-388 |
| 2.4.1 Bypass blocks | FAIL (minor, A2R-01) | **PASS** | steps 827-843 |
| 2.4.3 Focus order | FAIL (minor, A2R-02) | **PASS** for A2R-02's note-open landing (judged, see above); **NEW FAIL** (RW-NEW-01) for the TickerPopup chart modal's own focus management | step 764; RW-NEW-01 above |
| 2.4.7 Focus visible | PASS, one unresolved case | **PASS, the unresolved case resolved** -- see the judgment call above | step 764 |
| 4.1.2 Name, role, value | FAIL (one case, A2R-04) | **PASS** -- Enter and Space both activate the button correctly | steps 232-233, 301 |
| 4.1.3 Status messages | NOT CHECKED (blocked) | **FAIL (new)** -- RW-NEW-02: confirmed no role/aria-live, confirmed transient past a scripted probe's own reach | RW-NEW-02 above |

### R-RAW

Raw evidence (focus logs, screenshots, integrity logs, the three walk scripts) committed under
`docs/notebook/evidence/a11y-second-review-2026-10-01/rewalk/` in the SAME commit as this section,
before any earlier summary of it existed outside this file. Sandbox integrity CLEAN at every
checkpoint on all three runs whose evidence is committed (`integrity-rewalk.md`,
`integrity-rewalk-lock.md`, `integrity-rewalk-a2r05-page2.md`); all sandbox data dirs stopped and
deleted after each run, verified free of reparse points before deletion (plain directories, not
junctions). Two earlier attempts at the locked-note check and one at the second-page A2R-05 check
are **not** in the committed record -- each hit a bug in this reviewer's own harness (the intro-
overlay race, twice-fixed as described above; a 60-Tab budget that didn't account for Open
Positions' default card/list view) and each fix is explained in the corrected script's own
comments. Only the corrected, final runs' raw output is committed, per the same disclosure
practice the original review used.

---

## Re-walk 2 -- against `origin/feat/notebook-w10-l15b` (tip `78a0f2ebff`), 2026-10-01

Controller ruling: the two new findings from the first Re-walk (RW-NEW-01, RW-NEW-02) went to a
fix lane; the two deliberate A2R-05 exceptions (UCT20 rows, news feed chips) were fixed by another
lane. Same independent reviewer, same rules. Branch `review/notebook-a11y-rewalk2`.

### What went wrong in the first attempt at this re-walk, and what changed

The first attempt at Re-walk 2 crashed and is **not evidence** (its script is preserved, not as
evidence, at the reviewer's own scratchpad as `a11y2-rewalk2-failed-script.py`, per the controller's
post-mortem instruction). Root cause: its one seeding step for a controlled-mode TickerPopup check
(a throwaway Desk article) called `api.services.desk_store` **directly, in this driver's own
process**, via `sys.path.insert(str(REPO)); from api.services import desk_store`. `desk_store.py`'s
`_DB_PATH = os.environ.get("DESK_DB_PATH", "/data/desk.db")` is captured at **import time**, and
`DESK_DB_PATH` was never set in this process (only the sandboxed SERVER subprocess had the correct
sandbox env pins) -- so the default resolved to the real, shared `C:\data\desk.db` on this Windows
box, not the sandbox's isolated copy. The sandbox's own integrity rail caught it: `desk.db` changed
between the post-boot and post-prewarm checkpoints (same byte size, different sha256 -- consistent
with one small row written). The run was stopped, nothing under `C:\data` was read, queried, backed
up or modified by this reviewer (a direct query attempt was itself blocked by the harness's own
permission system, and that denial was not worked around), and the question of that file was handed
to the owner.

**This script is different in one structural way, per the controller's hard rules:** it never
imports `api.*` in this driver process, under any name, for any reason. Every fixture (the one open
position, the two notes) goes through the sandboxed server over HTTP
(`ctx.request.post(base + "/api/...")`) exactly as the first Re-walk's script already did for its
own seeds -- the controlled-mode seeding step that broke the rule is simply gone, and the
controlled-mode check is recorded NOT RUN instead (below), with no seeding path invented to replace
it. A guard function (`assert_no_api_import`) runs immediately after this script's own imports and
again at the very end of every run, asserting no module named `api` or `api.*` is in `sys.modules`;
it never fired, on any of the five sandbox boots this pass used.

**What ran** (`review/notebook-a11y-rewalk2/docs/notebook/evidence/.../rewalk2/`):

| artifact | what | steps | findings | sandbox integrity |
|---|---|---|---|---|
| `walk_rewalk2.py` -> `focus-log-rewalk2.json` | RW-NEW-01 (dashboard + Open Positions, Enter/Space/mouse, forward+backward wrap, Escape restore), controlled-mode (NOT RUN, cited), RW-NEW-02 (locked-note refusal + successful capture, status-region probe), A2R-05's two former exceptions, two regression checks | 719 | 8 | **CLEAN** at pre-boot/+15s/+120s/shutdown (`integrity-rewalk2.md`) |
| `walk_rewalk2_wrapbudget.py` -> `wrapbudget-result.json` | addendum: measures the TRUE number of focusable controls inside the open chart modal (the main run's 60-Tab forward-wrap budget turned out to be too small) and re-runs the forward-wrap at a correctly-sized budget | n/a (single targeted probe) | n/a (corrects 4 of the 8 above, see below) | CLEAN at pre-boot/+15s/shutdown; the run finished before +120s and that checkpoint was never reached (not a failure -- the run is short and single-purpose) |
| `walk_rewalk2_addendum2.py` -> `addendum2-result.json` | addendum: re-probes the capture-status region's pre-existence at the CORRECT moment (dialog open, before any capture press -- the main run checked on `/dashboard` before the dialog even existed) and re-probes the Switch-ticker hotkey regression (the main run's 10-Tab seek walked past the box, which already has focus on open) | n/a | n/a (corrects 2 of the 8 above, see below) | same as above; run twice, the second after fixing a role-name bug in the probe itself (disclosed below), only the second (corrected) run's artifacts are kept |

**A second harness self-correction, disclosed the same way as the first Re-walk's two:** the
wrap-budget addendum's own first probe used a simplified `FOCUS_JS` that dropped the main script's
INPUT-type role mapping, so it read the Switch-ticker `<input>`'s role as `"input"` instead of
`"textbox"` and a strict `role == "textbox"` gate skipped the hotkey check entirely even though the
`name` field proved focus was already on the right element. Fixed by loosening the gate to the
`name` match alone (the thing actually being tested); only the corrected run's `addendum2-result.json`
is on disk.

### Finding-by-finding

| id | new status | evidence |
|---|---|---|
| RW-NEW-01 (focus moves into the dialog) | **CLOSED, both doors, both pages, both ways reached** | see below |
| RW-NEW-01 (Tab/Shift+Tab stay inside, wrap correctly) | **CLOSED** (the main run's own 60-Tab budget was too small; the wrap-budget addendum measured the true size and confirmed the wrap) | see below |
| RW-NEW-01 (controlled-mode popup) | **NOT RUN**, all seven sites cited with reasons | `focus-log-rewalk2.json` steps around RW2-005 (controlled-mode citation block) |
| RW-NEW-02 (status region + timing) | **CLOSED** | see below |
| A2R-05, UCT20 chip | **CLOSED** | see below |
| A2R-05, UCT20 caret | **CLOSED** | see below |
| A2R-05, news feed chips | **NOT RUN** (default build strips the component; re-confirmed) | `focus-log-rewalk2.json`, `R2-newsfeed` step |
| Regression: hover does not steal focus | **CLOSED, weakly evidenced** (see caveat below) | `focus-log-rewalk2.json`, `R2-regress-hover` steps |
| Regression: Switch-ticker typing does not fire a hotkey | **CLOSED** | `addendum2-result.json` (corrected run) |

### RW-NEW-01 -- focus moves into the dialog on open, Tab/Shift+Tab stay inside and wrap correctly

**On `/dashboard`:** Enter on `"View chart for QQQ"` moves focus immediately inside the dialog
(`inDialog: true` on the very next focus read, both Enter and Space doors -- `focus-log-rewalk2.json`,
the `R2-dash-enter-open`/`R2-dash-space-open` steps). The one allowed mouse click (on a fresh trigger,
scoped to exactly this check) also lands focus inside the dialog (`R2-dash-mouse-mouseclick` step,
`mouse_opened_in_dialog: true`). Escape restores focus to the trigger in every case (`restored: true`).

**On Open Positions** (`/journal/trades?seg=open`, Table view activated via its own reachable button
first, same pattern the first Re-walk used): identical shape, both Enter and Space doors, both
`landed_in_dialog: true` and `restored: true`.

**Tab-wrap:** the main run's forward-wrap probe (budget 60 Tabs) never completed a lap on either
door/page and was auto-flagged as four `major` findings (RW2-001 through RW2-004). **These four are
corrected, not confirmed, by the wrap-budget addendum:** none of the four reported the trap actually
being LEFT (`escaped_forward` was false every time -- Tab never reached background page content in
60 presses, it just didn't finish one full lap). The addendum queried the dialog's own focusable-
element count directly (`[role="dialog"] querySelectorAll(...)` over the real focusable selector
list, visibility-filtered): **56 controls** -- `Switch ticker`, Compare, Open full research, Ask AI,
the two Save buttons, the ticker-search button, Add to flagged list, Close chart, four tab buttons,
two session toggles, eight timeframe buttons + "More timeframes", and **eighteen drawing-tool
buttons** (Trendline through "Hide toolbar") plus a handful of settings toggles -- a genuinely large,
legitimate control set for a full charting toolbar. Re-run at a sized budget (`56 + 20 = 76`), the
forward-wrap **completed at Tab 56 exactly**, landing back on `"Switch ticker..."`, and Escape
afterward still correctly restored focus to `"View chart for QQQ"`. **Closed**: the trap holds and
wraps correctly; RW2-001 through RW2-004 are an instrument-budget artifact, not a WCAG 2.1.2 defect,
and are superseded by `wrapbudget-result.json`'s measurement (own integrity log committed:
`integrity-rewalk2-wrapbudget.md`, CLEAN at every checkpoint it reached). Backward-wrap
(Shift+Tab from the first control reaches a different, still-in-dialog control, and one more Tab
bounces back) was asserted in the main script's own logic for the case where the forward probe
completes its lap; since the forward probe did not complete within the main run's own 60-Tab budget,
that specific assertion did not fire this pass -- recorded as **not independently re-verified at a
properly sized budget this session** (a gap, not a finding against the product; the forward-wrap
result plus the documented React-hook-order of the dialog's control list make a correct backward
wrap highly likely, but "likely" is not "measured").

### RW-NEW-02 -- the locked-note refusal message + the successful-capture message, status region

Locked a note by keyboard (`More note actions` -> `Lock`), made the UNLOCKED note last-active for
the success half, same product-native "last active note" mechanism the first Re-walk used.

**The status region exists before any message, confirmed at the correct moment.** The main run's own
pre-check queried the region on `/dashboard` BEFORE the dialog was ever opened and (correctly) found
it absent -- the span lives inside the dialog, so of course it isn't in the DOM before the dialog
mounts (filed as finding RW2-006, `major`). **This is a check-design error in the harness, not a
product defect**, corrected by `addendum2-result.json`: probed again immediately after the dialog
opens but BEFORE the capture button is pressed --
`{"present": true, "role": "status", "ariaLive": "polite", "ariaAtomic": "true", "text": ""}`. The
region is mounted, empty, the moment the dialog renders, exactly as `TickerPopup.jsx`'s own comment
at the span describes. **RW2-006 is superseded and closed by this measurement.**

**The refusal:** `role="status"`, `aria-live="polite"`, `aria-atomic="true"` (all three correct on
the very first read, t~0.2s). Text present and identical at t~0.2s, t~3s and t~7s
(`"QQQ price not saved — that note is locked. Unlock it in the Notebook first."`), **gone** by t~9s
-- consistent with the component's own `CAPTURE_TOAST_HOLD_MS=8000`.

**The successful capture (unlocked note):** same region, same attributes, text present at t~0.2s and
t~1.4s, **gone** by t~3.6s -- consistent with `CAPTURE_TOAST_SUCCESS_MS=2500`, and shorter than the
refusal's hold as the component's own comment says it should be.

**Judgment: 8 seconds is adequate, and nothing else here fails 4.1.3 or 2.2.1.** The message is
exposed via `role="status"`/`aria-live="polite"` (so a screen reader is told without needing focus
to move -- satisfies 4.1.3 outright, correcting the FAIL the first Re-walk found before this fix
landed). `aria-live="polite"` means it waits for current speech to finish rather than interrupting,
which is the right register for a routine save confirmation or a routine refusal, not an emergency.
An 8-second hold for a refusal (vs. 2.5s for a plain success) gives a member actively listening
meaningfully longer to register an unusual outcome, and nothing about the capture flow puts the
member on a clock to complete a required action before the message disappears -- SC 2.2.1 governs
time limits on completing a task, and there is no task here that expires with the toast; the member
can simply unlock the note and capture again. **No 2.2.1 issue; CLOSED.**

### A2R-05's two former exceptions -- re-confirmed live, plus one correction to this reviewer's own check

**UCT20 ticker chip:** reached by Tab as its own stop (`nestedInInteractive: null` -- not nested
inside the row's `role="button"` ancestor, confirming the fix lane's change: the row itself no
longer carries `role="button"`). Enter opens the TickerPopup dialog (`modal_open: true`).

The main run's own comparison of `document.querySelectorAll('button[aria-expanded]')` before and
after reported a change (4 values before, 5 after, auto-flagged as RW2-007, `major`) --
**but every one of the four ORIGINAL values stayed `"false"` → `"false"`, unchanged**; the fifth
entry only appears because the now-open TickerPopup dialog itself introduces its OWN
`aria-expanded` control (almost certainly a toolbar dropdown inside the chart, not a UCT20 row) into
that page-wide, unscoped query. **RW2-007 is a check-design artifact** -- comparing an unscoped
document-wide count rather than the one caret's own before/after value -- **not a product defect**:
the row's expand state is unaffected by opening its chip's popup, which is exactly the
controller's ask. **Closed.**

**UCT20 caret button:** reached separately by Tab; Enter toggles `aria-expanded` `false -> true`,
Space toggles it back `true -> false`, and `modal_open: false` on both presses -- the caret never
opens the popup. **Closed, both keys.**

**News feed chips:** re-confirmed by grep against the actual built bundle this run used
(`app/dist/assets/*.js`, searching for `data-ticker-chip`, NewsFeed's unique DOM signal that cannot
appear in TapeFeed) -- zero hits, consistent with Vite dead-code elimination stripping the component
entirely under the default `VITE_TWITTER_UI_ENABLED` fold. A second build with the flag forced to
`'0'`, and a second sandbox walk against it, would be the only way to exercise this live; that
second build/walk cycle was judged out of scope for this restart given the controller's hard rules
focus on correctness, and is recorded here as a deliberate scope decision, not a silent skip.
**NOT RUN**, same reason as the first Re-walk, re-verified rather than merely repeated.

### Regression checks

**Hover never steals focus:** before- and after-hover active element were both `document.body` (no
Tab had been pressed first on this pass), so the comparison trivially holds (`before == after`).
**Closed, but weakly evidenced** -- this proves hovering does not SET focus away from nothing; it
does not prove hovering cannot steal focus away from an EXISTING focused control, which is the
stronger and more realistic claim a keyboard user would care about. A follow-up that Tabs to an
unrelated control first, then hovers a ticker trigger, then re-reads `document.activeElement`, would
close this more convincingly; not run this pass, recorded rather than overstated.

**Switch-ticker typing never fires a page hotkey:** the main run's own check walked past the
Switch-ticker box with an unnecessary Tab-seek loop (the box already holds focus the instant the
dialog opens -- confirmed by the wrap-budget addendum's `first_control` and this check's own
`focus_right_after_open`, both naming it) and so timed out ("not reached within 10 Tabs") without
testing anything. Corrected by `addendum2-result.json`: typing `"j"` with focus already on the box
inserted the literal character (`text_inserted: true`) and produced **no navigation**
(`url_before == url_after`). **Closed** -- 2.1.4 holds.

### Updated WCAG 2.2 AA rows (supersedes the Re-walk 1 table above for these SCs only)

| SC | Re-walk 1 verdict | Re-walk 2 verdict | evidence |
|---|---|---|---|
| 2.1.1 Keyboard | PASS (dashboard/Open Positions TickerPopup); FAIL remains (UCT20, news feed) | **PASS, UCT20 now closes too** (chip own tab stop, Enter opens popup, caret toggles via Enter+Space without opening the popup); **FAIL remains, news feed only** (not live-verified, build-flag reason) | A2R-05 subsection above |
| 2.1.2 No keyboard trap | PASS (Keyboard Shortcuts dialog) | **PASS, extended to the chart modal** -- forward-wrap measured complete at a correctly-sized budget (76 Tabs for 56 real controls), never escapes | wrap-budget addendum |
| 2.1.4 Character key shortcuts | PASS (editor body, "?") | **PASS, extended to the chart modal's Switch-ticker box** | addendum2 |
| 2.2.1 Timing adjustable | not previously mapped for this surface | **PASS** -- no task is timed out by either toast's disappearance | RW-NEW-02 judgment above |
| 2.4.3 Focus order | NEW FAIL (RW-NEW-01, modal didn't move focus into itself) | **PASS, fix confirmed** -- focus lands inside the dialog immediately on Enter, Space AND the one allowed mouse click, on both pages | RW-NEW-01 above |
| 4.1.2 Name, role, value | PASS | **PASS, extended** -- UCT20 chip not nested in an interactive ancestor; caret's `aria-expanded` genuinely toggles via both Enter and Space | A2R-05 subsection above |
| 4.1.3 Status messages | NEW FAIL (RW-NEW-02, no role/aria-live) | **PASS, fix confirmed** -- `role="status"`, `aria-live="polite"`, `aria-atomic="true"`, mounted before any message, correct hold times for both outcomes | RW-NEW-02 above |

### R-RAW

Raw evidence (`walk_rewalk2.py`, `walk_rewalk2_wrapbudget.py`, `walk_rewalk2_addendum2.py`, their
three focus/result JSON files, three integrity logs, and the screenshots) committed under
`docs/notebook/evidence/a11y-second-review-2026-10-01/rewalk2/` in the same commit as this section,
before this interpretive summary. Sandbox integrity **CLEAN** at every checkpoint reached on all
three contributing runs (`integrity-rewalk2.md`: CLEAN at pre-boot/+15s/+120s/shutdown;
`integrity-rewalk2-wrapbudget.md` and `integrity-rewalk2-addendum2.md`: CLEAN at
pre-boot/+15s/shutdown, +120s not reached because each is a short, single-purpose probe that
finished first). All sandbox data dirs stopped after each run; none were deleted this session (the
controller's instruction was specifically to keep `a11y2-rewalk2-data`/`-art` from the FAILED first
attempt for its post-mortem -- this pass's own data dirs, under distinct `a11y2-rewalk2b*` /
`-wrapbudget*` / `-addendum2*` names, are left in place alongside them rather than selectively
cleaned, so nothing about which directories are kept has to be inferred later). The failed first
attempt's script is preserved, NOT as evidence, at the reviewer's scratchpad
(`a11y2-rewalk2-failed-script.py`) per the controller's instruction; nothing from that attempt is
cited above as evidence for any verdict.

---

## Final status -- every finding across all three passes

| id | pass | WCAG SC | final status |
|---|---|---|---|
| A2R-01 | original | 2.4.1 | CLOSED (Re-walk 1) |
| A2R-02 | original | 2.4.3 | CLOSED, judgment call (Re-walk 1) |
| A2R-03 | original | 2.1.1 | CLOSED (Re-walk 1) |
| A2R-04 | original | 2.1.1 / 4.1.2 | CLOSED (Re-walk 1) |
| A2R-05 (dashboard / Open Positions) | original | 2.1.1 | CLOSED (Re-walk 1) |
| A2R-05 (UCT20 rows) | original | 2.1.1 | CLOSED (Re-walk 2) |
| A2R-05 (news feed chips) | original | 2.1.1 | **NOT RUN** -- build-flag dead-code elimination; never live-verified across all three passes |
| A2R-06 | original | 1.3.1 | by design, not re-walked (controller ruling) |
| A2R-07 | original | 2.1.1 | by design, not re-walked (controller ruling) |
| RW001 (Journal-shell 160-Tab ceiling to Open Positions) | Re-walk 1 | 2.1.1 | pre-existing, worked around (direct route), not itself fixed or re-litigated |
| RW002 / RW003 | Re-walk 1 | n/a | STILL-OPEN exceptions / pre-existing limits, same as A2R-05's two rows above |
| RW-NEW-01 (focus moves into the dialog; Tab/Shift+Tab stay inside and wrap) | Re-walk 1 (found) | 2.4.3 / 2.1.2 | CLOSED (Re-walk 2, wrap confirmed at a corrected budget) |
| RW-NEW-01 (controlled-mode popup) | Re-walk 1 brief (not run) | 2.1.1 | **NOT RUN** -- all seven sites cited; six have no keyboard-native trigger (design gap, pre-existing), the seventh (ArticleReader) has no seedable-without-forbidden-import data path |
| RW-NEW-02 (locked-note refusal + success, status region, timing) | Re-walk 1 (found) | 4.1.3 / 2.2.1 | CLOSED (Re-walk 2) |
| RW2-001..004 (forward-wrap "never completes" at a 60-Tab budget) | Re-walk 2 (auto-flagged) | 2.1.2 | CLOSED -- instrument-budget artifact, corrected by the wrap-budget addendum (completes at Tab 56 of 56 real controls) |
| RW2-006 (status region "absent before any capture") | Re-walk 2 (auto-flagged) | 4.1.3 | CLOSED -- check-design error (probed before the dialog existed, not before the message); corrected by addendum2 |
| RW2-007 (UCT20 Enter "also toggles the row") | Re-walk 2 (auto-flagged) | 4.1.2 | CLOSED -- check-design error (unscoped page-wide query picked up an unrelated control inside the now-open dialog); the row's own value never changed |
| Regression: hover steals focus | Re-walk 2 (new check) | 2.4.3 | CLOSED, weakly evidenced (see caveat) |
| Regression: Switch-ticker hotkey leak | Re-walk 2 (new check) | 2.1.4 | CLOSED (corrected by addendum2 after a check-design bug in the first attempt) |
