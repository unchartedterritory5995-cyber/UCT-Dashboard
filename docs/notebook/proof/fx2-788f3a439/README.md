# Wave 10, lane FX2 -- the three items WK3's proof walk left, resolved

Raw records committed BEFORE this interpretation (R-RAW). Every number below cites the raw
file it was read from. Base: `feat/notebook-w10-fx2` at `788f3a439` (WK3's `wk3-e6d1e93f7`
tip + L10). This lane's mandate (`docs/notebook/proof/wk3-e6d1e93f7/README.md`, "Product
defects / open questions" #1-#3): G-171's keyboard door, the 12 dead-click findings, and
`save-template`/`trash-note`'s silent-probe NO-WRITE. For each: reproduced, decided
PRODUCT or PROBE with evidence, fixed the product where it was the product.

## Item 1 -- G-171 keyboard: "not reached with Tab in 220 presses"

**Verdict: PROBE, not product.** `item1-g171-keyboard/repro1-timeline-and-tabwalk.json`.

The tour ALREADY implements correct WAI-ARIA dialog focus management
(`NotebookTour.jsx`): focus moves to the title the instant the dialog opens, Tab is trapped
inside the card, Escape/Skip/Done return focus to the invoker. Measured live, fresh account,
no product change:

- `timeline_before_any_tab`: ResearchHome's OWN "Welcome to your Notebook" heading (a plain
  `<h2>`, not the tour) is visible at **t=386ms**. The tour DIALOG (role=dialog, same text,
  portaled) does not appear until **t=1074ms** -- a ~690ms gap (the tour's chunk is
  lazy-loaded, `NotebookTourGate.jsx`, plus its own 300ms `AUTO_START_DELAY_MS`).
- `race`: `tour.count()`/`skip.count()` read straight from Playwright at the exact moment
  the walk's own `f_first_run` (`tools/notebook_proof_walk.py:3336`) considers the heading
  "visible" -- **both 0**. `get_by_text("Welcome to your Notebook").first` resolves to
  ResearchHome's heading (earlier in DOM order than the portaled dialog), which renders
  before the tour has had any chance to open. The walk's `if skip.count(): use(...dismiss)`
  branch is therefore skipped on this race, and it proceeds straight to
  `use(pg, door, btn(pg, "Add a sample notebook"))`.
- `tab_walk_without_dismiss`: pressing Tab from there walks the app's OWN nav (Charts,
  Morning Wire, ... 14 presses) before reaching the Notebook; at press 15 the tour has
  finished its async open and grabbed focus (`active_text: "Welcome to your Notebook"`); from
  press 16 onward focus cycles **Skip tour <-> Next forever** (`dialog_open: true` for the
  rest of the budget) -- exactly the WAI-ARIA-correct modal trap, and exactly why "Add a
  sample notebook" is never reached: it sits BEHIND the now-open modal.
- `dialog_correct_path`: waiting for the DIALOG itself (not the heading text) instead:
  `active_on_open: "H2:Welcome to your Notebook"`, one Tab -> `"BUTTON:Skip tour"`, Enter on
  Skip closes it (`dialog_closed_after_enter_on_skip: true`), and "Add a sample notebook" is
  then reached in **19** ordinary tabs.

**Why desktop/touch doors "worked" on the same race**: their `click`/`tap` on "Add a sample
notebook" (2.6s / 21.3s in the committed WK3 census) fires fast enough to land BEFORE the
tour's async open in most runs -- `"tour shown: False"` in both cells of
`docs/notebook/proof/wk3-d5ca882b9/census.json` row G-171 confirms the same race, just won on
the fast doors and lost on keyboard's slower per-press round trips.

**Probe fix, handed to the controller (lane WK4 owns `tools/notebook_proof_walk.py`, not
edited here)**: `f_first_run` (`:3336-3351`) should WAIT for the tour dialog itself (e.g.
`tour.wait_for(state="visible", timeout=1500)`, tolerating a timeout as "did not auto-open
this run") before deciding whether to dismiss it, instead of taking an instantaneous
`skip.count()` snapshot right after the (page-owned, not tour-owned) heading text resolves.

**Rail** (regression guard for the product behaviour the race obscured, since none existed):
`NotebookTour.test.jsx` -- "FX2: opening the tour moves focus into itself, and ONE Tab
reaches Skip tour". Mutation-proved: commented out `titleRef.current?.focus()` -> RED;
restored, `git diff --stat` empty (byte-identical to HEAD) before AND after the mutation
check.

## Item 2 -- 12 dead clicks, all "click the already-active control"

**Verdict: PRODUCT, fixed.** `item2-a11y-tree-before/`, `item2-a11y-tree-after/`.

`CONTROLS_JS`'s `current` clause (`tools/notebook_proof_walk.py:512-514`) credits a re-click
as a deliberate no-op only when `aria-pressed="true"` sits inside a
`[role=group|radiogroup|tablist|toolbar]` ancestor, or `aria-selected` in a tablist. The
seven view-mode buttons already carried correct `aria-pressed` (a prior fix) but sat in a
bare `<div>` -- so the SAME gap that fooled the walk also fools a screen reader: "pressed" /
"not pressed" on seven identical-sounding buttons with no signal they are one related set.

- `item2-a11y-tree-before/a11ytree.json`: every view button's `closest_group_role: null`.
  `Updated` header's `aria_sort: null` (same for every header).
- `item2-a11y-tree-after/a11ytree.json`, same live sandbox, fixed build: every view button
  now `closest_group_role: "group"`, `closest_group_label: "View"`. `Save view` (a sibling
  action, not a view toggle) correctly stays OUTSIDE the group
  (`closest_group_role: null`) in both readings. `Updated` header's `aria_sort: "descending"`;
  `Title`/`Ticker` stay unset (only the active sort column carries it).

**Fix**: `NotebookTab.jsx` -- the seven view buttons wrapped in a labelled
`role="group" aria-label="View"` (`.viewModeGroup { display: contents }` in
`NotebookTab.module.css`, so it adds no box and the existing flex-wrap fit guard,
`NotebookTab.viewSwitcherFits.test.js`, still sees the same flat list). No keyboard
behaviour change -- each button was already an independent Tab stop firing on Enter/Space
(the WAI-ARIA "group of toggle buttons" pattern), so the fix is the missing group role, not
new navigation logic. `ResponsiveTable.jsx` gained an optional per-column `ariaSort` field
(spread onto the `<th>` only when a caller sets it -- every pre-existing caller is
byte-unaffected), and `NotesTableView.jsx` wires it from the SAME `sort` state the chevron
already reads (`titleActive`/`updatedActive`), on the header CELL, never the button inside
it (WAI-ARIA's own placement for this semantic).

**"Today" (x2) -- verdict: BY DESIGN, left unchanged, per the mandate's own carve-out.**
`NoteCalendarView.jsx`'s and `NoteTimelineView.jsx`'s "Today" buttons `setCursor`/`setAnchor`
to navigate the visible period to today; there is no "pressed/selected" state to expose --
it is a navigation action, not a toggle, and re-clicking it when already centred on today is
correctly a no-op (nothing to move to). This is the mandate's own named example ("If a
re-click is genuinely meant to do something, e.g. Today re-centres, say so and leave it").

**Rails**: `NotebookTab.test.jsx` (view-group + CONTROLS_JS-mirroring predicate + Save-view
stays a sibling), `NotesTableView.test.jsx` + `ResponsiveTable.test.jsx` (aria-sort, default
+ flipped + undefined-sort + a non-vacuity CONTROL that every pre-existing caller stays
attribute-free). Mutation-proved: all four touched product files reverted to
`git cat-file blob HEAD:<path>` -> 8 new tests RED, the other 79 pre-existing tests in the
same three files stayed GREEN (proving the mutation didn't collaterally break anything else);
restored via `os.replace` from a captured copy, sha256-verified byte-identical, suite green
again (87/87).

## Item 3 -- save-template / trash-note: reached, no captured write

### save-template -- verdict: PROBE, not product.

`item3-save-template/repro1-save-template-two-step.json`. `NoteMenuActions.jsx`'s "Save as
template" button (`:196-207`) does not save anything -- it reveals an inline naming FORM with
its OWN, differently-named "Save template" submit button (`:219`); the actual
`POST /api/j2/note-templates` fires only on that second click (`submitTemplate`, `:154-168`;
confirmed live by an existing test, `NoteMenuActions.test.jsx:95`). The silent probe's
`_act_more_menu_click("Save as template")` (`tools/notebook_proof_walk.py:2302-2315`, used by
`WRITE_ACTIONS` `:2351`) performs exactly ONE click -- opens the menu, clicks the FIRST
button -- and never reaches the second. Measured: `after_first_click_only.writes_seen: []`,
`template_name_input_visible: true`, `submit_button_visible: true`;
`after_second_click_submit.writes_seen`: one `POST /api/j2/note-templates`.

**Probe fix, handed to the controller**: `_act_more_menu_click`'s save-template call site (or
a dedicated action) needs a second click on the "Save template" submit button after the
first reveals the form -- the same two-step shape `f_save_template` (the CENSUS's own
function, `:3149-3150`) already drives correctly for door-reachability purposes, just not
reused by the silent probe's `WRITE_ACTIONS` entry.

### trash-note -- verdict: PRODUCT, fixed. A real false-positive, not a design choice.

Reproducing the probe's EXACT click sequence in isolation (a plain one-paragraph note)
captured the DELETE cleanly (`item3-trash-note-before/repro1-trash-note-isolated-context.json`).
Reproducing it with the SAME shared browser context the real walk's `WRITE_ACTIONS` loop uses
(`W.page()` caches one context per account+mode; save-template's page runs first, same as the
real loop's tuple order) still captured the DELETE
(`item3-trash-note-before/repro2-shared-context-with-save-template-first.json`) -- ruling out
context-sharing as the cause. Running the WALK'S OWN, unmodified `s_ed_delete` +
`_act_confirm_delete` functions directly, but with the seed's actual RICH body (tables, code,
math, callouts, task lists -- what `s_note` really uses, not a plain paragraph), reproduced it:
`item3-trash-note-diagnostic/repro3-real-walk-functions-rich-body.json` -- `writes: []`,
`dialogs_now: 1`, and the page text is the `UnsentTrashDialog`: *"This note has words the
server doesn't have yet... Not on the server yet: the note's text."* -- on a note that was
**never edited**, immediately after opening it.

**Root cause, isolated per node type**
(`item3-trash-note-diagnostic/repro4-BEFORE-per-construct-isolation.json`): a plain paragraph
or a heading never triggers it; a table, code block, block-math node, callout or task list
**always** does. `unsentInEditor()` (`NoteEditorPage.jsx`) compared
`editorRef.current.getJSON()` (the LIVE editor's own serialization) against the RAW server
JSON it loaded on open, and two separate editor-level transforms make those differ for
content that was never touched:
1. **Attribute defaults** -- ProseMirror's schema fills in every declared attribute default
   (a table cell's `colspan`/`rowspan`/`colwidth`/`align`) on `getJSON()`, which a minimally
   specified server JSON never carried.
2. **TrailingNode** -- StarterKit's `TrailingNode` extension appends an empty paragraph via
   `appendTransaction` whenever the doc's last node is not already one (measured: every one
   of the five affected node types was the LAST node in its test doc); that plugin hook fires
   on the editor's own initial content-load transaction, never on a bare schema parse.

Confirmed by instrumented comparison (temporary debug logging, removed before the final
diff): for a code block, `cur.bodyJson` carried a trailing `{"type":"paragraph"}` the raw
server JSON lacked; for a table, `cur.bodyJson`'s cell also carried
`{"colspan":1,"rowspan":1,"colwidth":null,"align":null}` the raw JSON lacked. Both are
editor housekeeping, never a member's edit.

**Fix** (`NoteEditorPage.jsx`): `canonicalBodyJson()` round-trips the SERVER side through
`editorRef.current.schema.nodeFromJSON(json).toJSON()` (fixes #1; never throws, falls back to
the raw value on any parse failure -- never a new failure mode, only a narrower one).
`stripTrailingEmptyParagraph()` normalizes away exactly one empty trailing paragraph,
symmetrically on both sides, rather than re-deriving TrailingNode's own "which node types
need one" rule as a second copy (a second copy drifts the moment the editor's own config
changes). **Never changes what counts as a real edit**: a paragraph the member actually typed
into is never "empty" by this test, so it is never stripped.

**Verified fixed, live, all 7 constructs**
(`item3-trash-note-after/repro4-AFTER-per-construct-isolation.json`): `unsent_dialog_shown:
false` for plain, heading, table, codeBlock, blockMath, callout, taskList alike.

**Rail**: `NoteEditorPage.unsentTrash.test.jsx` -- four new cases (table, codeBlock, callout,
taskList; a never-edited note with each trashes at once, CLEAN verdict, no typing), alongside
all 10 pre-existing cases in the same file (typed-word detection, Send-first, Trash-anyway,
door-guard mode, refused deletes -- every one of them still passing, proving the fix narrows
the false-positive without touching the real detection). Mutation-proved: `NoteEditorPage.jsx`
reverted to `git cat-file blob HEAD:<path>` -> the 4 new tests RED (`expected [] to deeply
equal ['DELETE']`), the 10 pre-existing tests stayed GREEN; restored via `os.replace`,
sha256-verified byte-identical, suite green again (14/14).

**Also verified against the REAL, unmodified instrument** (not just my own repro scripts):
`item3-real-walk-silent-sweep/silent.json`, `tools/notebook_proof_walk.py --sweeps silent
--only save-template,trash-note` run BEFORE the fix -- `writes: []` / `"NO-WRITE"` for both
actions, matching WK3's original finding exactly (not re-run after the fix, since that would
mean editing/re-invoking the controller's own instrument's evidence trail beyond this lane's
mandate; the product-level repro4 AFTER run plus the dedicated vitest rail are the fix's own
evidence).

## Sandbox integrity

Every run above: `SANDBOX IDENTITY: ok=True`, graceful shutdown, shared-data-root CLEAN at
every checkpoint (pre-boot / post-boot(+15s) / shutdown; the shorter ad hoc runs used
`--no-hold`, so no post-prewarm(+120s) checkpoint was taken for those -- the walk's own
`--boot` run below did take one). Full launcher logs:
`docs/plans/joystick/sandbox-runs/2026-09-30T{00-03-45,00-09-21,00-21-52,00-25-59,00-31-55,
00-48-22,00-56-01,00-58-15,01-00-57}.md`. Per-item `integrity.md`/`sandbox-integrity.md`
copies sit beside each item's own evidence above.

## Refused / not completed

The `item3-real-walk-silent-sweep` run's evidence path
(`docs/plans/joystick/sandbox-runs/...`) note: `tools/notebook_proof_walk.py` was invoked
read-only (as designed, `--boot` owning its own sandbox) -- it was never edited; the probe
fixes above are named for the controller/lane WK4 to apply. `pg.accessibility.snapshot()` is
not exposed on this Playwright version's `Page` object (an early attempt in the item-2 a11y
capture script); dropped in favour of the raw-DOM `role`/`aria-*`/`closest()` read already
shown above, which is what `CONTROLS_JS` itself reads.
