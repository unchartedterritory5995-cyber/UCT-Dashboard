# Wave 14, lane W14-B1: seven core-capability tours

Branch `feat/notebook-w14-b1`, from `3c50c50013` (the finished W14-0 lane). Spec:
`docs/notebook/WAVE-14-PLAN.md` sections 4.2 (rows 2 to 8), 5, 6 and 11 (controller
defaults D1 to D8). Contract: the AUTHORING CONTRACT and ANCHOR RULE at the top of
`app/src/pages/journal-2-0/components/notebook/onboarding/tours/index.js`. No new flag,
no engine change: every tour is data walked by `GenericTourEngine.jsx`, gated by its
capability's own flag (D5).

| commit | what |
|---|---|
| `35dc86af2e` | the track, fifteen anchors, the two rail adjustments, the per-tour tests and the axe check |
| (this doc) | the lane record |

## 1. The tours

All paths under `app/src/pages/journal-2-0/`. "Visible when" is the condition under
which a step's anchor is on screen; a step whose anchor is not on screen when the tour
opens is skipped (anchor rule), so the step count a member sees can be lower.

| tour id | flag | start | steps | anchor files |
|---|---|---|---|---|
| `writing-help` | `notebook_writing_help_enabled` | none (an open note) | 4: `writing-help`, `note-body`, `writing-help`, `note-body` | `components/notebook/NoteEditorPage.jsx` |
| `image-docx-import` | `notebook_image_docx_documents_enabled` (not on the payload, see 3.1) | none (an open note) | 3: `note-toolbar`, `note-scan` (touch tier), `search` (existing base anchor) | `NoteEditorPage.jsx`, `components/notebook/FolderSidebar.jsx` |
| `publish-share` | `notebook_publish_enabled` (see 2) | none (an open note) | 4, all on `note-share` | `components/notebook/NoteShareControls.jsx` |
| `task-reminders` | `notebook_task_reminders_enabled` (not on the payload, see 3.1) | `/journal/notebook?view=tasks` | 3: `tasks-list`, `tasks-group` (once a task exists), `tasks-tick` | `components/notebook/NoteTasksView.jsx` |
| `template-gallery` | `notebook_template_gallery_enabled` | none (the notes list) | 4: `templates`, `template-gallery-door` (picker open), `templates`, `templates` | `tabs/NotebookTab.jsx`, `components/notebook/TemplatePicker.jsx` |
| `meaning-search` | `notebook_semantic_search_enabled` (not on the payload, see 3.1) | none (sidebar showing) | 3: `search` (existing base anchor), `search-count` (a search with results), `search` | `FolderSidebar.jsx` |
| `formulas-rollups` | `notebook_formulas_enabled` | none (an open note) | 5: `properties-add-empty` / `properties-add` (one of the two branches renders), `computed-value`, `computed-edit` (once a computed property exists), `properties-add` | `components/notebook/PropertiesSection.jsx` |

Files the lane owns: `components/notebook/onboarding/tours/b1Core.js` (seven thin
entries, each `load()` a dynamic import) and one `b1*.steps.js` per tour
(`b1WritingHelp`, `b1ImageDocx`, `b1Publish`, `b1TaskReminders`, `b1TemplateGallery`,
`b1MeaningSearch`, `b1Formulas`). `tours/index.js` gained one import and one spread.

### 1.1 Anchors added to capability components (one attribute per line, nothing else)

| file | anchors |
|---|---|
| `NoteEditorPage.jsx` | `writing-help` (the Writing help button), `note-toolbar` (the editor toolbar row), `note-scan` (Scan), `note-body` (the editor content wrapper) |
| `NoteShareControls.jsx` | `note-share` (the Share button) |
| `NoteTasksView.jsx` | `tasks-list` (header), `tasks-group` (a group heading), `tasks-tick` (the "open its note" line) |
| `TemplatePicker.jsx` | `template-gallery-door` (Browse the community gallery) |
| `PropertiesSection.jsx` | `properties-add-empty`, `properties-add` (the two Add property branches), `computed-value`, `computed-edit` |
| `tabs/NotebookTab.jsx` | `templates` (the Templates button) |
| `FolderSidebar.jsx` | `search-count` (the notes search count line) |

Where an attribute was added to an element whose opening tag ended on the same line,
the `>` moved to the new line; no other text in those files changed. Reused, not
added: the base tour's `search` anchor (two B1 tours). Fifteen anchors for 26 steps (the code commit message says thirteen; fifteen is the count):
see 4.1 for why several steps share one.

## 2. Publish and share: which flag gates

**`notebook_publish_enabled`.** The Share button renders when either
`j2_share_links_enabled` or `notebook_publish_enabled` is on, and inside its sheet each
section shows only under its own flag. A tour gated on one flag must not describe the
other's section (no step may point at anything behind another flag), so the gate decides
the copy:

* Publishing is the larger-consequence action: it makes a note readable on the open web
  without a sign-in, it can take a whole folder (up to 500 notes) with it, and taking it
  down lives in two places (the sheet and Settings > Sharing & publishing). That is what
  a member most needs walked through before pressing the button.
* A share link is one self-describing button (Create link, Copy link, Revoke) with its
  own caption, and needs no tour to be safe.
* With publish on, the anchored button is guaranteed present (paid member, note open),
  and every step's claim is true. The copy never mentions share links. The title keeps
  the plan's "Publish and share a note": the steps cover sharing a published page's
  address.

If the owner arms share links without publish, this tour stays dark. A share-link tour
would be a second, small entry on `j2_share_links_enabled`; not built here.

## 3. Starts, and what a member can actually reach

### 3.1 Three flags are not on the auth payload

`notebook_image_docx_documents_enabled`, `notebook_task_reminders_enabled` and
`notebook_semantic_search_enabled` are server-only today: none is in
`lib/offline/notebookFlags.js` `FLAG_FALLBACKS` or `api/routers/auth.py`
`NOTEBOOK_FLAGS`, so `notebookFlag()` answers `null` for them and these three tours never
open, whatever Railway says. That is the fail-closed direction and the contract's rule
(the flag is a `notebookFlag()` key of the capability's own flag), so it is left that
way rather than plumbed from this lane: plumbing is a payload change in two shared files
with per-capability polarity (task reminders is a kill switch, unset = ON; the other two
are enablement gates) and its own rails. `b1Core.test.jsx` proves each stays closed even
when a payload claims the key is on; once the keys are plumbed, the same test switches
to its on/off branch on its own.

### 3.2 Starts

Only `task-reminders` declares a `start` (`/journal/notebook?view=tasks`, the Tasks
view; NotebookTab rewrites `?view=tasks` to `?view=all` after applying it, and the
engine navigates once). The others have no `start` the contract can express:

* `writing-help`, `image-docx-import`, `publish-share`, `formulas-rollups` live in an
  OPEN NOTE, and a note's path is member-specific. The nearest in-Notebook start would
  be the Notebook root, which is what an absent `start` already means, so none is
  declared. Consequence, stated rather than hidden: a Replay from Help lands on the
  root, finds no editor anchor within `START_WAIT_MS`, and closes with nothing
  recorded. These tours run when opened while a note is open (W14-C's "offer once"
  trigger, or a future Replay that keeps the current note).
* `template-gallery` and `meaning-search` start at the Notebook root, where the
  Templates button and the sidebar search are; the default is right.
* The plan's "the Import door" start for image/docx is not where the capability lives:
  `ImportWizard` imports Notion/Evernote/markdown exports, and an image or Word file
  becomes a searchable document through the editor's Insert image / Attach a file /
  Scan controls. The tour points there.

## 4. Design constraints found in the engine (not changed)

### 4.1 A step can only show if its anchor is on screen when the tour opens

`GenericTourEngine` computes `availableSteps` ONCE, at open, and the card is modal
(`aria-modal`, Tab trapped). So a step whose anchor sits behind a click (the Writing
help preview, the Share sheet, the template picker, a formula editor) can never be
shown: the member cannot open it during the tour, and the step list is already frozen.
Every B1 step therefore points at something on the tour's own screen. Where a
capability's detail lives behind one button, several steps point at that button and
explain what is behind it (Writing help, Share, Templates). Steps whose anchor appears
only with data (`tasks-group`, `search-count`, `computed-value`, `computed-edit`,
`template-gallery-door`) are kept because they are on screen exactly when the member is
in the situation they explain, and are skipped otherwise.

### 4.2 `display: contents` elements are never "on screen"

The editor's format runs (`.formatRun`) are `display: contents`, so they have no box
and `isOnScreen` is false for them. `ToolButton` does not forward attributes. Insert
image and Attach a file therefore have no anchorable element of their own without a
code change; the image/docx tour anchors the toolbar row and names the two buttons in
its copy.

### 4.3 Tiers

* `note-scan`: the touch tier only (hidden above 1024 px; behind Format on a phone),
  so desktop skips it. Its copy says "On a phone or tablet".
* `search` / `search-count`: the sidebar is beside the note on desktop and tablet; on a
  phone with a note open it is hidden, so those steps skip.
* Everything else renders on every tier.

## 5. Tests and rails

| rail | proves |
|---|---|
| `tours/b1Core.test.jsx` | the seven ids and flags; each in `TRACK_TOURS` and `TOUR_REGISTRY`; per tour: `load()` gives 3 to 6 `{id, anchor, file}` steps, copy keys equal step ids, a title and body each, no em dash / en dash / exclamation mark, unique step ids; gated by its own flag through the real `makeRegistryToursGate` (flag off: nothing; flag on: the tour opens, as a CONTROL that the gate can open; unplumbed flag: stays closed under a payload claiming it is on) |
| `tours/b1Core.a11y.test.jsx` | the real `task-reminders` entry and copy through `GenericTourEngine` and 8A's axe harness, first and last step, zero violations |
| `tourAnchors.test.js` (registry half, from W14-0) | every B1 step's anchor appears exactly once in its named file, by AST |
| `tourRegistry.test.js` | wiring of `tours/index.js` by AST; registry shape |

Two W14-0 rails were adjusted, each minimally:

* `tourAnchors.test.js`, the base tour's orphan check ("every `data-tour` in those files
  belongs to a step") read only the base tour's anchors, so ANY registered tour
  anchoring in `NoteEditorPage.jsx`, `FolderSidebar.jsx`, `NotebookTab.jsx` or
  `ResearchHome.jsx` failed it. It now accepts an anchor some registered tour names
  (loaded at module top) and still refuses one nobody reads. Other W14-B slices will hit
  the same check; this is the shared fix.
* `tourRegistry.test.js`'s shape check required exactly five keys, contradicting the
  contract's optional `start`, so the first tour with a `start` failed it. It now ignores
  `start` (the type and location of `start` are already railed by `assembleRegistry`).

### 5.1 Mutation proof

Removed `data-tour="tasks-tick"` from `NoteTasksView.jsx`, ran
`tourAnchors.test.js`:

```
× tour task-reminders: every step's anchor appears EXACTLY once in its named file
AssertionError: task-reminders step remind: data-tour="tasks-tick" appears 0 times in
components/notebook/NoteTasksView.jsx — a renamed or removed anchor rots this tour silently
Tests  1 failed | 23 passed (24)        exit 1
```

Restored by re-applying the original text; `sha256sum -c` against the pre-mutation
capture: `OK`; rerun `Tests 24 passed (24)`.

### 5.2 Runs

Targeted (`--maxWorkers=2`): onboarding + `Support.notebook.test.jsx` `16 files, 176
passed`; the B1 tests `48 passed`; the touched capability components (NoteTasksView,
PropertiesSection, NoteShareControls, TemplatePicker, FolderSidebar, NoteEditorPage
toolbar / phoneFormat / writingHelp / headerFits) `21 files, 334 passed`.

Full, `npx vitest run src/pages/journal-2-0 src/pages/Support --maxWorkers=2` at
`35dc86af2e`, exit 1:

```
 Test Files  1 failed | 610 passed (611)
      Tests  1 failed | 7702 passed | 1 skipped (7704)
   Duration  1284.56s
```

The one red is `lib/iteratorGlobalFloor.test.js` "every built asset is clear":
`AssertionError: app/dist/assets missing` (it asks for `npm run build`). This worktree has no
`app/dist` (it was created with `node_modules` linked and never built); the rail reads
built output and refuses to pass with none. It is not a B1 failure and not a timeout;
on a built tree it is the same rail W14-0 passed. No build was run here, to keep load
off the shared box. Every other file, including all of `notebook/onboarding`, passed.

## 6. Open

1. **Plumb three flags to the client** (`notebook_image_docx_documents_enabled`,
   `notebook_task_reminders_enabled` with kill-switch polarity,
   `notebook_semantic_search_enabled`) or these tours never show; image/docx and task
   reminders are armed today.
2. **Editor tours are not replayable from Help** (3.2). Needs either a Replay that keeps
   the open note, or W14-C's in-context offer.
3. **Steps behind a click cannot be shown** (4.1). If the owner wants walkthroughs that
   go inside a sheet (the Writing help preview, the Share sheet, the gallery), the engine
   needs to re-read available steps on Next and not trap the page; an engine change, out
   of this lane.
4. **Plan 5.4's per-tour entry in `a11y/notebookSurfaces.js`** is not added; this lane
   carries one representative axe test, as briefed.
5. **No real-browser walk** (plan 6.2) in this lane.
