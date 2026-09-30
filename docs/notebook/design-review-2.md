# Notebook design re-review -- UCT against Notion, Evernote and Obsidian (wave 10, lane DR-R)

Clause 6a of the 10/10 plan (`docs/notebook/NOTEBOOK-10-OF-10-PLAN.md`:28: "a design review
against the three competitors signs off each surface"), under ruling R-14 as amended by
Amendment 1 (2026-09-27). This is the RE-review the first review's own text called for: the
first review (`docs/notebook/design-review.md`, lane 10E-2, captures at tree fa6710394) did
NOT sign off, naming findings D-1..D-6. Reviewed 2026-09-29 on tree `ef55d6025` (evidence
committed at `4b193a18e`) by lane DR-R, an agent session that built no wave-10 product code.
**This is the re-reviewer's record; the owner countersigns it in the same place the first
review left for that.** Until then the clause still reads *reviewed, not signed off*.

## What this review is, and what it is not

**The UCT half is hands-on, on THIS tree, same as the first review's own method.** Every
surface below was opened in a fresh sandbox booted for this review alone (never shared with
another lane), with the first review's own production-armed flag set, no model key
(`docs/notebook/proof/e2-d9e887ca0/e2_sandbox.py::FLAGS`, carried over verbatim into
`docs/notebook/proof/drr-instrument/drr_walk.py::FLAGS`), at **390, 820 and 1200 CSS px**, 390
and 820 with touch emulation. It reuses the first review's own measured facts -- page-level
horizontal overflow, targets under 24px (44px on the touch widths), the visible headings
(`OVERFLOW_JS`/`TARGETS_JS`, carried over verbatim from the first review's own instrument,
`docs/notebook/evidence/a11y-second-review-2026-09-27/kbd_lib.py`) -- and adds two things the
first review could not have, because they did not exist yet: a re-derivation of D-1..D-6
fresh at this tree (never assumed closed from a commit message alone), and coverage of all
**seven** view modes by name (list/table/board/calendar/graph/timeline/tasks -- timeline and
tasks shipped after the first review). Record and images:
`docs/notebook/proof/drr-ef55d6025/` (`record.json`, `detail.json`, one PNG per surface and
width in `shots/`; `docs/notebook/proof/drr-instrument/drr_walk.py` and `drr_detail.py`
reproduce them read-only against a fresh sandbox).

**The competitor half is PUBLISHED MATERIAL ONLY -- not hands-on sessions, same limit as the
first review, for the same reason (Amendment 1: no purchase, no sign-in, no install).** Most
quotes below are the first review's own (`docs/notebook/proof/e2-d9e887ca0/design/
competitor-capture.jsonl`, 17 pages, all 200, 2026-09-27) where they still describe the
surface under review; new quotes fetched fresh today (2026-09-29, headless fetch) are cited
inline with their own URL and date. Quotations are verbatim, at most 13 words; no third-party
image is copied into this repository.

**What a hands-on session would still have shown that this cannot** -- the first review's own
list, unchanged by this re-review, because Amendment 1's limits did not change:

* **Empty and first-run states behind a login** for the COMPETITORS specifically -- this
  review DID exercise UCT's own first-run states (a never-visited member, see D-2 below), but
  Notion/Evernote/Obsidian's onboarding remains help-page-only.
* **Paid-tier-only surfaces** on the competitor side (Evernote Personal/Professional, Notion
  Plus/Business AI, Obsidian Sync/Publish).
* **Real density and rhythm at 390/820/1200** for the competitors -- still no measured
  side-by-side; UCT's own numbers below have no competitor column for the same reason.
* **Motion, latency and focus behaviour**, and **native mobile apps**, on the competitor side.

Cost if wrong, same as the first review's own words: 6a may score partial where a
logged-in-only surface matters; a later hands-on pass on the competitor side can upgrade this
record.

## Surfaces, one verdict each

Verdict key, unchanged from the first review: **AT PARITY** (UCT does what the published
competitors do, at a comparable level of polish), **BEHIND** (a named, fixable design gap),
**AHEAD** (UCT does something the published material says the competitors do not).

### 1. The notes list and sidebar (folders, tags, saved views, Trash, Archived)

UCT (`drr-list-1200.png`, `-820`, `-390`): Recents, Add thesis starter views, All notes /
Unfiled / Archived / Trash, a nested folder ("Research") with its own edit/add/remove/publish
row-actions, tags with counts ("#ai 1", "#swing 1"). Zero horizontal overflow at any width
(`overflow_px: 0` on every `list` row, `record.json`). Zero sub-24px targets at 1200
(`targets_lt_24: 6` is the row-selection checkboxes, folded into D-8 below, not a sidebar
navigation defect) except that same checkbox family.

Competitors (first review's own quotes, still current): Notion's sidebar, *"The Notion
sidebar allows you to:"* organise pages, with favourites and teamspaces
(notion.com/help/navigate-with-the-sidebar, 2026-09-27); Obsidian's file explorer, *"Create,
delete, and rename files and folders."* and *"Move files and folders with drag and drop."*
(obsidian.md/help/plugins/file-explorer, 2026-09-27); Evernote, *"pin notes to a notebook, to
Home, and add them to shortcuts"* (help.evernote.com AI Assistant article, G-023, 2026-09-26).

**Verdict: AT PARITY at 820 and 1200.** D-1 and D-2 (the first-run overlap that put this
surface BEHIND at 390 in the first review) are CLOSED -- see the closure table. At 390 the
list is now clean on its own first screen (`drr-list-390.png`): header, one dismissible
in-flow "Meet Compass" card, tabs, folder/search icons, Recents, All notes -- no overlap, no
folder panel ahead of the note list. **D-7 below is a NEW, narrower BEHIND on the SAME width**
for the other six view modes, not this one.

### 2. The editor

UCT (`drr-editor-1200.png`): title, subtitle, tags, evidence and properties (Ticker, Sector,
Industry, Theme, Thesis Status, Review Date, "+ Add property", "Suggest values") below **two**
toolbar rows (favourite / Ask / Find / Share / folder / ticker / Writing help / Outline / More;
then Font/Size/B/I/color/H1/H2/lists/quote/code/link/image/attach) plus one dismissible
"speak instead of type" tip -- never a third permanent row. `DELETE IS NOT ON SCREEN`
(`d3_editor_rows.editor.delete_on_screen: null`, `detail.json`): it lives inside "More note
actions", **last of 10 items** (`delete_is_last: true`), never a red control among the first
things a member sees. Re-measured fresh at this tree with lane K2's OWN instrument JS
(`docs/notebook/proof/drb-instrument/drb_d3_measure.py::MEASURE_JS`, imported and run
unmodified), not merely cited from an old capture.

Competitors (first review's own quotes, still current): Notion's editing model is blocks with
a hover handle -- *"⋮⋮ icon: This appears in the left margin whenever you hover over a"* block
(notion.com/help/writing-and-editing-basics, 2026-09-27); its page actions sit behind
shortcuts, *"Use cmd/ctrl + F to search inside a page."* (notion.com/help/keyboard-shortcuts).
Evernote documents version history, *"Note history allows you to view and restore older
versions of a note."* (G-002).

**Verdict: AT PARITY**, no longer "at parity on capability, behind on density" -- D-3 is
CLOSED (see closure table). Notion and Evernote keep page-level actions in a menu and
formatting in the flow of writing; UCT now does the same.

### 3. Views (list, table, board, calendar, graph, timeline, tasks)

UCT now ships **seven** view modes (`app/src/pages/journal-2-0/lib/savedViewModes.js`), up
from the first review's own count -- timeline and tasks shipped after fa6710394.

* **Table** (`drr-table-1200.png`): Title/Ticker/Updated/Thesis Status/Review Date columns,
  sortable, values rendered correctly for every seeded note (a live `$NVDA` chip, a colored
  status pill, an ISO review date).
* **Board** (`drr-board-1200.png`): groups by Thesis Status into **5** columns (Watching /
  Active / Invalidated / Closed / "No value" for a note with the property unset --
  `board_state.columns: 5`, all three widths), a per-card status `<select>`. At 1200 the 4th
  and 5th columns are cut (`scrollWidth 1348` vs `clientWidth 786`) -- see D-5's closure
  below, CLOSED with a real scroll cue.
* **Calendar** (`drr-calendar-1200.png`): Month grid keyed on a date property (defaulted to
  "Review Date", the only date-type property), a seeded note placed on its date, an
  "1 more in other months" counter for the note dated outside the visible month -- exactly the
  "never drop an undated/out-of-range note silently" behaviour `CLAUDE.md` documents for this
  view, independently confirmed rather than taken on faith.
* **Graph** (`drr-graph-1200.png`): 6 nodes, a bounded force layout, a "Show as list" twin
  (`app/src/pages/journal-2-0/components/notebook/NoteGraphView.jsx:618`, confirmed present).
  **Not independently confirmed by this walk: a real note-to-note EDGE.** This walk's own
  attempt to create one by typing `[[Beta thesis AMD` timed out on the link-suggestion menu
  twice (`seed_link_task.link_inserted: false`, `graph_link_retry.clicked: false`,
  `detail.json`) -- an instrument limitation of this walk (a role/name-matching issue against
  the suggestion list), not a measurement that the feature is broken; the capability itself
  (`j2_note_links`, `get_note_graph`) is unchanged product code the first review already
  scored AT PARITY on documentation alone. Recorded as NOT INDEPENDENTLY CONFIRMED rather than
  silently assumed either way.
* **Timeline** (`drr-timeline-1200.png`): Place-by / Group-by / Week-Month-Quarter, folder
  lanes. Functions (switches cleanly, no overflow); see D-9 below for a named UX gap and D-8
  for its own toolbar's target sizes.
* **Tasks** (`drr-tasks-1200.png`): correct empty-state copy, *"No open tasks. Add a checklist
  to any note and its items show up here."* **Not independently confirmed by this walk: a
  populated list.** This walk's own seeded checklist (typed into "Trade checklist -- AMD add")
  was not observed to have synced before the page navigated on -- the same class of
  instrument gap as the graph edge above, not a reproduction of a product failure.

Competitors (first review's own quotes, still current, plus one fresh for Timeline): Notion,
*"Table: Tables allow you to see your database pages as rows, with every"* property a column,
and *"Board: This view groups your items by property."*
(notion.com/help/views-filters-and-sorts, 2026-09-27); *"Calendar view displays your items
based on their \`Date\` property."* (same page, fetched 2026-09-29); *"Use your database to
plot project milestones on a timeline so you can"* (Notion Timeline, same page, 2026-09-29).
Obsidian Bases, *"Each base can have several views with different layouts such as tables and"*
cards; the graph, *"Graph view is a core plugin that lets you visualize the relationships
between the notes in your vault."* and, for the local scope, *"A local Graph view shows you
notes connected to the active note."* (obsidian.md/help/plugins/graph, fetched 2026-09-29).
Notion's Checkbox property, *"Use a checkbox to indicate whether a condition is true or
false."* (notion.com/help/database-properties, 2026-09-29) is Notion's nearest equivalent to a
Tasks view (a property on a database row, not a cross-database Tasks surface); Evernote's own
Tasks, *"Tasks live inside your notes, so there's no need to interrupt your flow"* (evernote.com/
features/tasks, fetched 2026-09-29), likewise live inside individual notes rather than roll up
across a notebook the way UCT's Tasks view does.

**Verdict: AT PARITY on capability across all seven modes** -- UCT's Timeline and Tasks views
have no clean Notion/Evernote/Obsidian equivalent as a CROSS-NOTE view (Notion's nearest is a
per-database Timeline; neither competitor ships a cross-notebook checklist rollup), which
reads as **AHEAD on breadth of view types**, held to AT PARITY here because this walk could
not independently confirm either new view populated with real data (see above). D-7, D-8 and
D-9 below name fixable gaps within this surface; none of them changes the AT-PARITY capability
verdict. The keyboard gap the first review carried into the accessibility review (a Table row
opening only on a mouse click, A2R-02) was not re-tested here -- out of this review's scope.

### 4. Templates

UCT (`drr-templates-1200.png`): a browsable gallery, **25** built-in templates
(`builtin_card_count: 25` at all three widths), search ("thesis"/"mistake log" narrow
correctly per lane DR-C's own D-4 evidence, `drc-473e77955`), category chips, "Preview" opens
a read-only render, "Use this template" creates the note. This is lane DR-C's build on this
same tree (`473e77955`, "a browsable gallery + breadth (D-4) -- 9 -> 25 built-ins,
search/category filters, read-only preview") re-confirmed fresh here: the gallery still opens,
still shows 25 cards, at all three widths, on a different sandbox and a different seeded
account than DR-C's own run.

Competitors (first review's own quotes, still current): Notion's gallery, *"Personal
Productivity24813 templates"* and *"Project Management10142 templates"*
(notion.com/templates, 2026-09-27); Evernote's gallery, *"Create the perfect template for your
needs and start using it."* (evernote.com/templates); Obsidian, *"Templates is a core plugin
that lets you insert pre-defined snippets of text"* (obsidian.md/help/plugins/templates).

**Verdict: AT PARITY with Obsidian's core model, still BEHIND Notion and Evernote on raw
COUNT** (24,813 / an open gallery vs. 25) **but no longer BEHIND on KIND** -- D-4 is CLOSED:
the first review's finding was "no browsable gallery at all"; that gap is gone. The count gap
is real and named rather than hidden: Notion and Evernote's galleries are member-submitted and
open-ended, UCT's is curated and fixed at 25. D-8 below names a target-floor gap on this
surface's own "Preview" buttons and selection checkboxes.

### 5. Share and publish

UCT (`drr-share-publish-1200.png`): opened through a "Share" button that sits in the editor's
own toolbar (not behind "More"), a real share link created and copied
(`http://127.0.0.1:8391/share/n/...`, "It never expires."/"Revoke link" -- "It stops working
immediately."), a real published page (`http://127.0.0.1:8391/p/...`, "A published page can be
read by anyone with its address, without signing in. Search engines are asked not to index
it."), and a "Publish folder 'Research'" door ("Publishes up to 500 notes in this folder and
the folders inside it. A note added later appears when you update the page in Settings.").
Both doors were exercised through the app's OWN endpoints during seeding
(`POST /notes/{id}/share` -> 200, `POST /publish/notes/{id}` -> 200, `seed.share_status` /
`seed.publish_status`, `record.json`) and then visited in a real browser at all three widths,
never merely asserted from the seed call's status code.

Competitors (first review's own quotes, still current): Notion, *"Publish an unlimited number
of pages to the web."* (notion.com/help/public-pages-and-web-publishing); Obsidian Publish,
*"Obsidian Publish is a cloud-based hosting service that lets you publish your notes"*
(obsidian.md/help/publish, a paid add-on).

**Verdict: AT PARITY**, arguably ahead on CLARITY of copy (the plain-language expiry/revocation
sentences beside each control) -- not claimed as AHEAD because the first review's own rule
("claimed only where the page says so, never from silence") cuts the other way here: neither
competitor's help page states its copy is LESS clear, so silence proves nothing either way.
Zero sub-24px targets on this surface at 1200 (`targets_lt_24: 0`, every width).

### 6. Search

UCT: a sidebar search tab ("Search notes") with its own input ("Search your notes"), and the
global Ctrl+K command palette (`drr-search-palette-1200.png`) mixing SECURITIES (AMD, AMDA,
AMDI, ADL with company names) and NOTES ("Trade checklist -- AMD add", "Beta thesis AMD",
"Alpha thesis NVDA -- In note text", two tagged "Recent") in one ranked list, with a footer
legend (`↑↓ navigate · ↵ open · Ctrl/⌘+↵ ask AI · Esc close`).

**"Best matches" (`role="group" aria-label="Best matches"`) did NOT fire in this walk's own
sidebar-search capture** (`best_matches_present: false`, all three widths) -- read against the
source rather than reported as a gap: it is gated to show *"only when two or more kinds have
hits"* (notes / documents / excerpts / reviews; `FolderSidebar.jsx`, wave 10 R-5 clause 13b),
and this walk's seed data held notes only, so a query hitting exactly one kind correctly fell
through to the plain per-kind results instead. Not re-tested with mixed content in this pass.

Competitors (first review's own quotes, still current): Evernote, *"that match is highlighted
both in the note list"* (G-014) and *"Searches for notes created on or after the date
specified."* (G-013); Notion, *"Use cmd/ctrl + P or cmd/ctrl + K to open search"* (keyboard
shortcuts).

**Verdict: AT PARITY**, arguably AHEAD on the unified security+note ranking in one palette --
held to AT PARITY for the same silence-proves-nothing reason as surface 5. D-8 below names a
target-floor gap on this surface's own result-row checkboxes (visible through the palette's
dimmed backdrop, not palette-native controls).

### 7. Phone (390)

UCT (`drr-list-390.png`, `drr-phone-cold-note-url-390.png`): zero horizontal overflow at any
surface and width (`overflow_px: 0` on every row in `record.json`, all three widths); a cold
`GET /journal/notebook?note=<id>` navigation (never an in-app route change) opens straight into
the note, title visible, the SAME first screen a click-through would show
(`title_input_visible: true`) -- D-1's own condition, re-derived fresh rather than assumed
closed.

**Verdict: BEHIND on a new, narrower finding (D-7) than the first review's D-1/D-2.** D-1 and
D-2 are CLOSED (see the closure table): the Journal chrome no longer owns the first ~300px
ahead of the note list, and the "Meet Compass" card is in-flow and dismissible rather than
overlaying content. D-7 is a different phone-only gap this walk found on the SAME width, on
the other six view modes, not the list or the editor.

## D-1 .. D-6 closure -- fresh evidence, not assumed

| id | first review's finding | status | fix commit(s) | this review's fresh evidence |
|---|---|---|---|---|
| D-1 | phone: the Journal chrome + a `?note=` URL showing the folder panel, not the note, on the first screen | **CLOSED** | `f4cec49be` (#242, lane L2, "phone Journal header + deep links") | `drr-phone-cold-note-url-390.png`: a cold `?note=` navigation opens the note directly, `title_input_visible: true`, heading = the note's own title, not a folder panel |
| D-2 | the "Meet Compass" first-run card overlays page content (list rows at 390, the editor's evidence area at 1200) until dismissed | **CLOSED** | `a48db73e9` (#228, F5 items 1-2, "lives in the page flow and waits for the tour"); mechanism `732e86c27` (F5 round 1, "shows only while the compass button it names is on screen") | `drr-list-390.png`, `drr-list-1200.png` (an already-provisioned account): the card sits IN FLOW above the tab row, pushing content down rather than covering it, with a working "Got it" dismiss. A SEPARATE never-visited member at 1200 (`drr-d2-coachmark-1200.png`) shows the ONBOARDING TOUR ("STEP 1 OF 5") instead of the coachmark -- the two first-run overlays are sequenced, never stacked, which is stronger than the first review's own finding required |
| D-3 | up to 5 rows of controls above the title at 1200; a red Delete among the first controls on every note | **CLOSED** | `f4cec49be` (#242, lane K2 folded into L2, "editor header (D-3)") | `drr-editor-1200.png` + lane K2's OWN measurement JS re-run fresh (`drb_d3_measure.py::MEASURE_JS`): `rows_above_title: 3` (2 real toolbar rows + 1 dismissible voice tip), `delete_on_screen: null`, Delete is item 10 of 10 inside "More note actions" and `delete_is_last: true` |
| D-4 | no browsable template gallery; competitors publish thousands (Notion) or a gallery (Evernote) | **CLOSED** (breadth gap remains, see surface 4) | `473e77955` (lane DR-C, this tree, "a browsable gallery + breadth (D-4) -- 9 -> 25 built-ins, search/category filters, read-only preview") | `drr-templates-390/820/1200.png`, `builtin_card_count: 25` at every width, re-confirmed on a different account/sandbox than DR-C's own run |
| D-5 | the board's 4th column is cut with no visible scroll affordance | **CLOSED** | `7bd834b9f` (#251, lane L4, "board scroll cue (D5)") | `drr-board-390/820/1200.png` + `board_state`: `cue: "true"` at every width; at 1200 `scrollWidth 1348` vs `clientWidth 786` (the 4th/5th columns genuinely cut) WITH the cue firing -- the gap the first review named ("no visible affordance") is gone even though the cut itself is unchanged (5 columns cannot all fit at any of these widths by design) |
| D-6 | 23 targets under 24px on the editor at 1200 (formatting row B/I/H1, rename pencils) | **CLOSED on the editor specifically** | across F5 / D3P / L3 / K2 / WK / WK2; two of the concrete fixes: `7bd834b9f` (#251, "layout floors (L3)"), `8d08da86f` (#254, "clause 6c", the Find-in-note input) | `drr-editor-1200.png`: `targets_lt_24: 0` on the editor at 1200 (`record.json`), the structural rail `app/src/pages/journal-2-0/a11y/targetFloors.test.js` measured at 39 tests today (not re-quoted from an old count). **D-8 below is the SAME class of finding, on OTHER surfaces the first review's D-6 never named** |

## New findings (this review's own; nothing was changed)

| id | surface | width | finding | evidence |
|---|---|---|---|---|
| D-7 | table, board, calendar, graph | 390 | Switching away from List view (via the view-mode icon row) leaves the folder/tag tree panel expanded and stacked full-width ABOVE the view's own content. The view's actual rows/columns/grid are reduced to a sliver at the very bottom of the screen, further covered by the fixed Log-Trade button and the voice-orb cluster. List view itself (the default landing) and Tasks view (reached by its own `?view=tasks` URL rather than the icon row) do NOT show this. Reproduced independently across four view modes; does not reproduce at 820 or 1200, where the folder panel stays in its own side column (`drr-board-820.png`, `drr-board-1200.png` clean). | `drr-table-390.png`, `drr-board-390.png`, `drr-calendar-390.png`, `drr-graph-390.png` vs. `drr-list-390.png`, `drr-tasks-390.png` |
| D-8 | list, table, board, templates, search, timeline | 1200 | The SAME target-floor class the first review's D-6 closed on the editor is present, unaudited, on six other surfaces at 1200 (desktop, non-touch): the 16x16px row-selection checkbox ("Select \<note title\>") on List/Table/Templates/Search-result rows; the board's 216x18px note-title link inside each card (18px tall); the templates gallery's 76x21px "Preview \<template\>" buttons (21px tall); and ALL EIGHT of the Timeline toolbar's own controls (the Place-by/Group-by selects at 22px tall; Week/Month/Quarter/Previous month/Next month/Today at 20-21px tall). WCAG 2.5.8 carries a spacing exception the first review flagged as "to be checked one by one" for its own D-6 targets; the same one-by-one check has never been run for these. | `record.json` (`targets_lt_24` per surface) + `detail.json` (`targets_1200`, named elements); screenshots `drr-list-1200.png`, `drr-table-1200.png`, `drr-board-1200.png`, `drr-templates-1200.png`, `drr-search-sidebar-1200.png`, `drr-timeline-1200.png` |
| D-9 | timeline | 1200 (not re-tested at 390/820 due to the D-7 layout issue obscuring the grid there) | Timeline's Month view opens positioned at day 1 of the current calendar month rather than scrolled or paged to today. A manual "Today" control exists in the toolbar, but a notebook whose most recent activity is at the end of the month (this walk's six notes, all updated on day 29) shows two entirely empty folder lanes across the visible days-1-8 window on first open, with no indication that dated content exists later in the same month. | `drr-timeline-1200.png` |

## What this review did not re-test

Out of scope, carried over from the first review or newly out of scope for this pass, named so
the gap is not read as covered: the accessibility review's own keyboard findings (A2R-02 and
others, a separate document); a populated Graph edge and a populated Tasks list (this walk's
own seeding did not land in time to observe either -- see surface 3); "Best matches" with
mixed-kind content (surface 6); the competitor side hands-on (unchanged Amendment 1 limit).

## Sign-off

| surface | reviewer (lane DR-R, 2026-09-29) | owner countersign |
|---|---|---|
| list and sidebar | at parity at 820/1200; at parity at 390 (D-1, D-2 closed); D-7 affects the OTHER view modes at 390, not this one | |
| editor | at parity (D-3 closed) | |
| views | at parity on capability across all seven modes; D-7 (phone, non-list modes), D-8 (target floors), D-9 (timeline default position) named | |
| templates | at parity with Obsidian; behind Notion/Evernote on raw count only (D-4 closed on kind); D-8 target-floor gap named | |
| share and publish | at parity | |
| search | at parity; D-8 target-floor gap named (background rows, not the palette itself) | |
| phone | at parity on list/editor (D-1, D-2 closed); behind on D-7 (other view modes) | |

**Overall: does this review sign off every surface? NO, not unconditionally.** Every surface
the first review put BEHIND is now AT PARITY or closed on the finding as originally worded.
This review is not a rubber stamp on top of that: it found three NEW, named, fixable gaps
(D-7, D-8, D-9) that the first review's narrower scope (editor-only for target floors,
six-view-mode notebook for D-7's view-switch layout) could not have found. None of the three
is a design gap this review would call disqualifying on its own -- D-7 is phone-only and
limited to non-default view modes, D-8 is the same fixable class the product has already
closed once elsewhere, D-9 is a one-line default-position fix -- but "fixable and minor" is a
description for the owner to confirm, not a verdict this reviewer is positioned to assign
itself.

## D-7 / D-8 / D-9 follow-up (wave 10, lane DR-F, 2026-09-29)

Fixed on `feat/notebook-w10-drf` at `d165ab9f1` (a merge/PR from this branch would carry a new
tip -- read the tip this document sits at, not this literal sha, if it has moved). Evidence:
`docs/notebook/proof/drf-d165ab9f1/` (`record.json`, one PNG per surface/width in `shots/`,
the sandbox integrity log); reproduces read-only against a fresh sandbox via
`docs/notebook/proof/drf-instrument/drf_walk.py`.

**D-7** (`app/src/pages/journal-2-0/tabs/NotebookTab.jsx` -- the `CONTENT_FIRST_PHONE_MODES`
effect, ~line 452; `NotebookTab.module.css` phone block; `FolderSidebar.module.css` phone
block): every `VIEW_MODES` entry except `list` now collapses the folder/tag tree at phone
width, the same `sidebarOpen` the desktop toggle already owns -- List's own landing is
untouched. Extended to `tasks` too (not just the four D-7 named): it is reached through the
SAME icon row, and reproduced identically once tested via the button rather than only via its
`?view=tasks` URL. A second, live-measured defect surfaced fixing this: `width: 0` alone left
a ~450px empty gap above the toolbar (a 0-width flex item, in a COLUMN container, still
reports the height its content wraps to at one character per line) -- closed with an explicit
`height: 0`. Rails: `NotebookTab.phoneNote.test.jsx` (13 new tests, rendered + structural,
mutation-proved). Before/after: `drr-board-390.png` (original review) vs.
`drf-d7-board-390.png` (fixed) -- the WATCHING column and its card are now on the first
screen with the toggle reachable, not a folder tree with a sliver of content at the bottom.

**D-8** (`NoteCard.module.css`, `NotesTableView.module.css`, `NoteBoardView.module.css`,
`TemplatePicker.module.css`, `NoteTimelineView.module.css`): a 24px WCAG 2.5.8 floor added to
the base rule of each of the six named targets -- none qualified for the spacing/equivalent
exception (checked one by one: the checkbox's wrapper is a bigger POINTER hit area but is not
an independently reachable equivalent control for a keyboard/AT user; the board title and the
Preview button are each the ONLY way to reach their function). Existing 44px touch-tier floors
are unchanged. Rails: 5 new describe blocks in `a11y/targetFloors.test.js` (14 new tests, each
with its own control), mutation-proved together. Before/after `targets_lt_24` at 1200:
list 6->0, table 7->0, board 3->0, templates (12 pre-existing, unmeasured as its own D-8 row
before this pass)->0, search-sidebar 6->0, timeline 8->0 (`record.json` rows `d8-*`).

**D-9** (`app/src/pages/journal-2-0/lib/timeline.js::timelineFocusBucketKey`;
`NoteTimelineView.jsx`): on initial render and on a real range change (zoom, Previous/Next,
Today -- keyed on the window's own bounds, never on `notes` alone), the axis now scrolls
today's own bucket into view, or -- when the member has paged away and today is outside the
window -- the bucket holding the most recent placed activity; an empty window scrolls nowhere.
Rails: `lib/timeline.test.js` (5 new tests on the pure function) +
`NoteTimelineView.test.jsx` (5 new tests asserting `scrollIntoView` is called on the DOM node
carrying today's own `data-bucket-key`), mutation-proved. Live confirmation:
`drf-d9-timeline-month-1200.png` -- Sep 2026 scrolled to days 24-30, today's (Sep 30 ET)
column showing all six seeded notes, `today_in_view.inView: true` in `record.json`.

**Graph edge / Tasks list, independently confirmed.** Seeded through the app's own API doors
(a `PUT .../notes/{id}` carrying a `noteLink` node and a `taskList`/`taskItem` node in
`bodyJson` -- the exact shapes `notes.py`'s link/embed sync and `note_tasks.extract_tasks`
already parse, not a new door), then polled `GET /api/j2/notes/graph` and
`GET /api/j2/notes/tasks` until each reflected the seed (both landed near-instantly: 0.0s to
first poll, both endpoints read live off `bodyJson`/`j2_note_links`, no cache to wait out).
Both then confirmed rendering in the browser: `drf-confirm-graph-1200.png` (legend "6 notes 1
link 4 unlinked", a visible edge line between the Beta-thesis-AMD and Alpha-thesis-NVDA
nodes) and `drf-confirm-tasks-1200.png` ("NO DATE (2)", both seeded checklist items listed
under "Trade checklist -- AMD add"). **Neither surface has a rendering defect** -- DR-R's own
"not independently confirmed" was correctly hedged, not a symptom of a broken product; its own
seeding attempt (typing `[[query` into the editor) is what could not complete in time.

⚠️ **A separate, real, NOT-fixed finding surfaced investigating that:** typing `[[Beta thesis
AMD` into the editor reaches the link-suggestion popup and does fire a search
(`GET /notes?q=Beta` -- confirmed via `docs/notebook/proof/drf-instrument/drf_debug_link.py`,
raw console/network capture in `docs/notebook/proof/drf-d165ab9f1/link-menu-debug/`), but the
editor's own autosave `PUT` fires concurrently and the popup is gone
(`popupPresent: false`) by the time a result would have rendered -- DR-R's own two timeouts
against this same menu were the first evidence of it, misread there as an instrument
limitation. It reproduces on demand, is scoped to the `[[` suggestion menu specifically (this
lane's own task-checklist typing, with no popup in the way, persisted correctly), and is
**out of this lane's brief** (D-7/D-8/D-9 plus the two confirmations) -- named here rather than
silently worked around, for whoever picks up the `[[` menu next.
