# Notebook P1: Journal Styles Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members pick a kind of note and get a note already laid out in that kind's journal style (outline + blocks + property defaults). They can build, duplicate, rename, default and soft-delete styles, save a note's setup as a style, and update an older note to the latest layout. Everything ships dark behind `NOTEBOOK_JOURNAL_STYLES_ENABLED` and is paid.

**Architecture:**
- **Server owns the facts.** A new service, `journal_styles.py`, holds styles, versions, defaults and the one composer that turns a style into a note body. A second service, `note_kinds.py`, holds built-in and member kinds.
- **Two doors only.** A styled note is made by the existing `POST /api/j2/notes` with a new optional `styleId` or `kindId`, so `createNoteViaApi` stays the single create door. "Update layout to vN" is one compare-and-set server write; the editor lands it with `settleNoteWrite` and `adoptServerCopy`, the same way version restore works.
- **Blocks are widget kinds.** In P1 the only buildable block is `chart`. The data model stores block ids that are widget ids, and the composer keeps a builder table, so P2 adds a kind by adding a catalog row and a builder. No P1 contract changes.
- **Every new surface is a lazy chunk.**

**Tech Stack:** FastAPI + SQLite (`auth.db`, `j2_` tables), React + Vite, TipTap 2 / ProseMirror, vitest + Testing Library, pytest, Python Playwright walk tools.

**Spec:** `docs/superpowers/specs/2026-10-11-notebook-journal-styles-design.md`, §P1.1–P1.7. Also read §1, §6, §7 (all six decisions taken as recommended) and §9. P0 shipped as #317/#318 and is on the base.

**Base:** `origin/master` `b4282b5d9d` (worktree `C:\Users\Patrick\uct-worktrees\notebook-p1`, branch `notebook-p1-styles`, a `notebook-*` name, so `hub/rule12Paths.test.js` scopes it correctly).

## P1.7 answer, found while writing this plan

The full write-up is Task 1's deliverable. In short, from the code at `b4282b5d9d`:

- **(a) The widget kind is open-ended at every layer.** The schema tables version the node TYPE `widgetEmbed` (level 0) and one attribute (`widgetEmbed.ta`, level 4), never the value of `widgetId`. The client node stores `widgetId` as a free string. The server indexes any non-empty `widgetId` string. **A new block kind needs no schema level.** The catch, railed in Task 2: an older bundle silently drops an *attribute* it does not declare (ProseMirror `create` keeps only declared attrs). So P2 block state must live inside the existing `params` JSON attribute, never in a new attribute. A new attribute would need a `NOTEBOOK_ATTR_SCHEMA` row and a level bump.
- **(b) An older bundle keeps the node and its data; nothing is dropped.** `resolveEmbedRender` returns `{kind: 'placeholder', reason: 'unknown-widget'}`. The self-archive only runs for `decision.kind === 'live'`, so the view never rewrites the node. The node type is always registered, so the next save writes the node back unchanged. **There is no data loss, so no emergency fix is needed.** The only gap is the copy: today's card says "widget type unavailable", not the spec's "needs a newer version — reload". Task 2 fixes the copy, adds a Reload control and rails the round trip before any block kind ships.
- **(c) The switch gates creating, never rendering.** The precedent is in the code: `widgetEmbed.ta` is "Registered unconditionally (the gate NOTEBOOK_CHART_PLAN_ENABLED only hides the doors)". P1 reads `NOTEBOOK_JOURNAL_STYLES_ENABLED` only at create doors: the router dependency, the `styleId`/`kindId` branch of `POST /api/j2/notes`, and client doors. The `builtin:note_kind` property definition, the note body and `GET /notes` never read it. Railed in Tasks 5 and 14.

**Tasks that depend on these answers:**
- Task 2 rests on (b).
- Tasks 6, 7 and 10 rest on (a): block ids are widget ids, a block is "present" when a `widgetEmbed` with that `widgetId` exists, and P2 state goes in `params`.
- Tasks 5, 9 and 14 rest on (c).

## Global Constraints

- Member-facing names (spec §7.1): **"Journal styles"**, **"Kind of note"**, **"outline"** (today's template; "template" stays a search synonym) and **"block"**. "Preset" is an internal word only.
- Every new surface requires a paid plan (owner ruling 2026-10-06). New router routes take the router's own `require_paid` (402, sentence `"Journal styles require a paid plan"`). The `styleId`/`kindId` branch of `POST /api/j2/notes` checks the same predicate.
- Dark behind `NOTEBOOK_JOURNAL_STYLES_ENABLED`: an enablement gate, unset = OFF, carried on the auth payload as `notebook_journal_styles_enabled` and declared `dark` in `docs/feature_flags.json`. An off gate answers the one `404 {"detail": "Not found"}` before the session or body is read.
- The switch gates CREATING, never RENDERING (spec P1.7c). Rollback must never blank a note.
- Snapshot semantics (spec P1.3): editing a style never rewrites existing notes. Updating a note is an explicit, previewed action that only adds missing blocks and never removes or reorders the member's text.
- Schema: **zero schema-level bumps in P1.** No new node type and no new node attribute. `blocks_json` entries name widget ids, and block state rides `params`. If any task finds it needs a node type or attribute, it STOPS and reports. That would take the next level (5) in BOTH `lib/notebookSchema.js` and `notebook_schema.py` in a never-revert commit, which this plan does not authorise.
- Additive columns only (`j2_notes.style_id`, `style_version`, `kind_id`). Nothing reads them as required.
- ONE FACT IN TWO FILES gets a rail that PARSES the other file, the way `tests/test_notebook_schema_guard.py::_client_facts` imports the JS module through Node. This applies to the built-in kinds (`note_kinds.BUILTIN_NOTE_KINDS` ⇄ `lib/noteKinds.js`) and the block catalog (`journal_styles.BLOCK_KINDS` ⇄ `lib/journalBlocks.js`).
- New preference keys go into `api/routers/auth.py::_PREFERENCE_KEYS` in the same commit (`notebook_kind_mapping`).
- Note writes: every client call that advances a note's `updatedAt` lands it with `settleNoteWrite` before the next `fetch` (`lib/offline/doorEnumeration.test.js`, MODE `'fail'`).
- Every new surface is a lazy chunk. The Notebook first-open bytes (`python tools/notebook_perf_budgets.py --dist app/dist`) stay within the budget's `max` (2,260,793), and P1 adds at most **2,048 B** to the measured first-open closure (the flag module, one slash item, menu items). The before and after numbers are recorded in Task 15.
- Touch targets ≥ `var(--tap-min)` (44 px) at ≤1024 px (`styles/tapFloor.test.js`). Every control has an accessible name. Reorder works by keyboard (Move up / Move down buttons), not drag only.
- Breakpoints: only `@media (max-width: 640px)` and `@media (max-width: 1024px)`. Icons are `UIcon` names (`UICON_NAMES`); no emoji in UI.
- Every new `data-tour="x"` literal appears exactly once in its file (`tourAnchors.test.js`).
- Tests: `cd app && npx vitest run <explicit files>`. Backend pytest by NAMED FILES only, never `pytest tests/`. A run without a totals line is not a run. Never verify through a pipe or a trailing `echo`; capture the code and `exit $code`. `-t` is a regex: a filter that matches nothing exits 0.
- Run the suite in its own tool call and read the totals before committing.
- Commits: `git commit -F - -- <paths> <<'MSG'` (pathspec on the commit). Every message ends with exactly:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ`
- Write files with the line endings git stores (new files LF); run `python tools/check_repo_hygiene.py` before each commit.
- Never touch `C:\data`. Sandbox data dirs are passed from PowerShell or single-quoted. At most 3 agents.
- Mutation proofs restore by captured bytes (sha checked against `git cat-file blob HEAD:<path>`), never `git checkout --`.

## Review Focus

Five inputs the spec implies but no feature test exercises on its own. Each line names the owning task's test that pins it.

1. **A style whose outline links a member template that has since been deleted** must still make a note. It falls back to the style's inline outline, else an empty body, and never answers 500. Pinned in Task 7, `test_compose_falls_back_when_the_linked_template_is_gone`.
2. **A member's own kind with no style at all** (no member default, no built-in) must make a note with just the kind set, never 404. Pinned in Task 9, `test_kind_without_any_style_makes_a_note_with_only_the_kind`.
3. **A chart block when the note has no ticker** must not insert a broken chart. The block is left out, an instruction paragraph sits where it would have gone, and the response names it in `skippedBlocks`. Pinned in Task 7, `test_chart_block_without_ticker_leaves_an_instruction`.
4. **"Update layout" pressed while the editor holds unsaved typing, or after another tab saved** must write nothing over the member's words. The button waits for the save. A stale base answers 409 and shows "This note changed since you opened it. Nothing was added." Pinned in Task 14, `styleUpdate.staleBase` and `styleUpdate.waitsForSave`.
5. **The style a note records is deleted** (soft). The update offer disappears, the note renders unchanged, and Undo restores the style and its default. Pinned in Task 6, `test_delete_then_restore_keeps_default`, and Task 14, `styleUpdate.deletedStyleNoBanner`.

---

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `docs/notebook/p1-verify-before-building.md` (new) | P1.7 written finding | 1 |
| `B/WidgetEmbedView.jsx` + `.module.css` | "Needs a newer version — reload" card | 2 |
| `J/lib/widgetEmbedNode.unknownKind.test.js`, `B/WidgetEmbedView.unknownKind.test.jsx`, `tests/test_notebook_unknown_block_kind.py` (new) | (b) rails | 2 |
| `api/routers/auth.py` | `NOTEBOOK_FLAGS` row, `_PREFERENCE_KEYS` row | 3, 4 |
| `J/lib/offline/notebookFlags.js` | `FLAG_FALLBACKS` row | 3 |
| `docs/feature_flags.json` | ledger entry (dark) | 3 |
| `J/lib/journalStylesFlag.js` (new) | the one client gate + `STYLE_EVENT` | 3 |
| `api/services/journal_two/journal_styles.py` (new) | gate, catalog, store, composer, update planner | 3, 6, 7, 10 |
| `api/services/journal_two/note_kinds.py` (new) | built-in + member kinds, research-type mapping | 4 |
| `J/lib/noteKinds.js`, `J/lib/journalBlocks.js` (new) | client halves of the two facts | 4, 6 |
| `api/services/journal_two/db.py` | `j2_note_kinds`, `j2_journal_styles`, three `j2_notes` columns | 4, 6 |
| `api/services/journal_two/account_purge.py`, `docs/account-deletion-manifest.md` | purge both new tables | 4, 6 |
| `api/services/journal_two/note_properties.py`, `note_templates.py` | `builtin:note_kind` with per-member options | 5 |
| `B/PropertiesSection.jsx` | `note_kind` offered only while the switch is on | 5 |
| `api/services/journal_two/notes.py` | `style_stamp` on create/update, style keys on the note | 6, 7, 10 |
| `api/routers/notebook_journal_styles.py` (new), `api/main.py` | the router | 8, 10 |
| `tools/notebook_contract_fixtures.py`, `J/__fixtures__/contract/*` | contract fixtures | 8, 9, 10 |
| `api/routers/journal_two.py` | `styleId`/`kindId` on `POST /notes` | 9 |
| `J/lib/noteCreation.js`, `J/tabs/NotebookTab.jsx` | styled create through the one door; doors; lazy chunks | 9, 12, 13 |
| `J/lib/journalStyles.js`, `J/hooks/useJournalStyles.js` (new) | API client + offline cache | 11 |
| `B/styles/*` (new, all lazy) | KindSection, StylesManager, StyleEditor, StyleUpdateSheet, StyleUpdateBanner, SaveAsStyleForm | 12, 13, 14 |
| `B/TemplatePicker.jsx`, `B/TemplatePreview.jsx`, `B/NewNoteMenu.jsx` | kind section slot, `DocBody` export + block label, "From a style" | 12 |
| `src/pages/Settings.jsx`, `J/components/JournalStylesCard.jsx` (new) | Settings › Notebook door | 13 |
| `B/NoteMenuActions.jsx`, `B/NoteEditorPage.jsx`, `B/SlashMenu.jsx` | save-as-style, update banner, `/style` | 14 |
| `J/a11y/journalStyles.a11y.test.jsx` (new) | axe on the new surfaces | 13 |
| `tools/notebook_fin_walk.py`, `tools/notebook_fin_walk_features.py`, `tools/notebook_door_audit_doors.json` | walk steps and door rows | 15 |

`J` = `app/src/pages/journal-2-0`, `B` = `J/components/notebook`.

---

### Task 0: Worktree

**Files:** none (environment)

- [ ] **Step 1: Confirm the worktree and mark ownership**

```bash
git -C /c/Users/Patrick/uct-worktrees/notebook-p1 status --short --branch
cat /c/Users/Patrick/uct-worktrees/notebook-p1/.uct-session-owner 2>/dev/null || printf 'session: 016WSfoBTwnfA4irnCiBs3XZ\ncreated: 2026-10-11\n' > /c/Users/Patrick/uct-worktrees/notebook-p1/.uct-session-owner
```

Expected: `## notebook-p1-styles` and a clean tree.

- [ ] **Step 2: Junction an installed node_modules (PowerShell tool)**

```powershell
if (-not (Test-Path C:\Users\Patrick\uct-worktrees\notebook-p1\app\node_modules)) { New-Item -ItemType Junction -Path C:\Users\Patrick\uct-worktrees\notebook-p1\app\node_modules -Target C:\Users\Patrick\uct-worktrees\notebook-k\app\node_modules }
Get-Item C:\Users\Patrick\uct-worktrees\notebook-p1\app\node_modules -Force | Select-Object LinkType, Target
```

Expected: `LinkType Junction`. At removal use `cmd /c rmdir` only.

- [ ] **Step 3: Baseline the files this plan touches**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1/app
npx vitest run src/pages/journal-2-0/components/notebook/WidgetEmbedView.toolbarMore.test.jsx src/pages/journal-2-0/components/notebook/NewNoteMenu.test.jsx src/pages/journal-2-0/components/notebook/NoteMenuActions.test.jsx src/pages/journal-2-0/lib/offline/notebookFlags.serverDefaults.test.js src/pages/journal-2-0/lib/offline/doorEnumeration.test.js src/pages/journal-2-0/tabs/NotebookTab.templates.test.jsx > "$TEMP/p1-baseline.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python -m pytest tests/test_journal_two_note_templates_router.py tests/test_notebook_contract_fixtures.py tests/test_account_deletion_manifest.py tests/test_notebook_flag_parse.py -q > "$TEMP/p1-baseline-py.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Read both totals lines. Record any pre-existing red, by name, in the PR body. Pre-existing reds are not this plan's to fix.

---

### Task 1: P1.7 — verify before building, written down

No code changes. This task produces the committed finding that every later task cites. **Every quote must be re-read at write time.** For each row, run the grep shown, read the matched line's CONTENT, and confirm it says what the row claims. A line number that moved is updated. A claim the content no longer supports is STRUCK, and the task stops and reports (a citation you cannot quote is struck).

**Files:**
- Create: `docs/notebook/p1-verify-before-building.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the findings document. Tasks 2, 5, 6, 7, 9, 10 and 14 cite it by section (`§a`, `§b`, `§c`).

- [ ] **Step 1: Re-verify every citation**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
grep -n "  widgetEmbed: 0," app/src/pages/journal-2-0/lib/notebookSchema.js
grep -n "'widgetEmbed.ta': 4," app/src/pages/journal-2-0/lib/notebookSchema.js
grep -n '"widgetEmbed": 0,' api/services/journal_two/notebook_schema.py
grep -n '"widgetEmbed.ta": 4,' api/services/journal_two/notebook_schema.py
grep -n "required = max(required, NOTEBOOK_TYPE_SCHEMA.get(t, 0))" api/services/journal_two/notebook_schema.py
grep -n "widgetId: stringAttr('data-widget-id')," app/src/pages/journal-2-0/lib/widgetEmbedNode.jsx
grep -n "params: jsonAttr('data-params', {})," app/src/pages/journal-2-0/lib/widgetEmbedNode.jsx
grep -n "an older bundle silently DROPS an attr it does not know" app/src/pages/journal-2-0/lib/widgetEmbedNode.jsx
grep -n "Registered unconditionally (the gate NOTEBOOK_CHART_PLAN_ENABLED only" app/src/pages/journal-2-0/lib/widgetEmbedNode.jsx
grep -n "NEVER remove this extension from buildExtensions(): TipTap DROPS unknown" app/src/pages/journal-2-0/lib/widgetEmbedNode.jsx
grep -n 'widget_id = attrs.get("widgetId")' api/services/journal_two/notes.py
grep -n "if isinstance(widget_id, str) and widget_id:" api/services/journal_two/notes.py
grep -n "if (!meta) return { kind: hasImage ? 'image' : 'placeholder', reason: 'unknown-widget' }" app/src/pages/journal-2-0/lib/widgetEmbedCore.js
grep -n "const needsArchive = decision.kind === 'live'" app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx
grep -n "reason === 'unknown-widget' ? 'widget type unavailable'" app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx
grep -n "Validate STORED params (from a notebook doc). Unknown keys are tolerated" app/src/widgets/registry.js
grep -n "node.type.checkAttrs(node.attrs);" app/node_modules/prosemirror-model/dist/index.js
```

Expected at `b4282b5d9d`: notebookSchema.js `:79` and `:131`; notebook_schema.py `:78`, `:135` and `:200`; widgetEmbedNode.jsx `:117`, `:118`, `:126`, `:151` and `:7`; notes.py `:386` and `:387`; widgetEmbedCore.js `:387`; WidgetEmbedView.jsx `:467` and `:155`; registry.js `:1000`; prosemirror-model `:1531`. Every grep must print exactly one line. An empty result is a failed check, never a pass.

- [ ] **Step 2: Write the finding**

Write `docs/notebook/p1-verify-before-building.md` with this content. Line numbers are the ones Step 1 printed:

````markdown
# P1.7 — verify before building (journal styles)

Spec: `docs/superpowers/specs/2026-10-11-notebook-journal-styles-design.md` §P1.7. Measured at
`<git rev-parse HEAD>` on branch `notebook-p1-styles`. Every claim cites a line read at write time.

## §a — Is the `widgetEmbed` kind open-ended?

**Yes, at every layer. A new block kind needs no schema level.**

- The client schema table versions the node TYPE, not the widget kind:
  `app/src/pages/journal-2-0/lib/notebookSchema.js:79` — `  widgetEmbed: 0,`. The only
  attribute row is `:131` — `  'widgetEmbed.ta': 4,`.
- The server twin is the same: `api/services/journal_two/notebook_schema.py:78` —
  `    "widgetEmbed": 0,` and `:135` — `    "widgetEmbed.ta": 4,`. The level a body needs is computed
  from the node type (`:200` — `required = max(required, NOTEBOOK_TYPE_SCHEMA.get(t, 0))`),
  never from `attrs.widgetId`.
- The editor node stores the kind as a free string:
  `app/src/pages/journal-2-0/lib/widgetEmbedNode.jsx:117` — `widgetId: stringAttr('data-widget-id'),`.
- The save path indexes any non-empty string: `api/services/journal_two/notes.py:386-387` —
  `widget_id = attrs.get("widgetId")` / `if isinstance(widget_id, str) and widget_id:`.
- The registry tolerates unknown param keys by design: `app/src/widgets/registry.js:1000` —
  "Validate STORED params (from a notebook doc). Unknown keys are tolerated".

**The catch (binding on P2):** an older bundle drops an ATTRIBUTE it does not declare.
`widgetEmbedNode.jsx:126` — "an older bundle silently DROPS an attr it does not know". The
mechanism is ProseMirror's `NodeType.create`, which builds only declared attrs, followed by
`node.type.checkAttrs(node.attrs);` (`prosemirror-model/dist/index.js:1531`). So a block's member
state lives inside the existing `params` attribute (`widgetEmbedNode.jsx:118` —
`params: jsonAttr('data-params', {}),`), never in a new attribute. A new attribute would take a
`NOTEBOOK_ATTR_SCHEMA` row in both files and the next level, never-revert. Railed by
`app/src/pages/journal-2-0/lib/widgetEmbedNode.unknownKind.test.js` (CONTROL case).

## §b — What does an OLDER bundle do with an unknown kind?

**It keeps the node and every attribute it declares, renders a labelled card, and writes the node
back unchanged on the next save. No data loss.**

- The node type is always registered: `widgetEmbedNode.jsx:7` — "NEVER remove this extension
  from buildExtensions(): TipTap DROPS unknown node types at parse time … 'Unknown widget' is a
  VALUE-level state".
- An unknown kind takes the placeholder path:
  `app/src/pages/journal-2-0/lib/widgetEmbedCore.js:387` —
  `if (!meta) return { kind: hasImage ? 'image' : 'placeholder', reason: 'unknown-widget' }`.
- The view never writes it: the only automatic `updateAttributes` (the self-archive) requires a
  live render, `WidgetEmbedView.jsx:467` — `const needsArchive = decision.kind === 'live' && …`.
- **The gap is the words, not the data:** the card says `WidgetEmbedView.jsx:155` —
  `reason === 'unknown-widget' ? 'widget type unavailable' : …`. The spec wants "This block needs
  a newer version — reload". Task 2 of the P1 plan changes the copy, adds a Reload control and
  rails the round trip (client and server), ahead of any new kind. It is not a data-loss fix.

## §c — A switch gates CREATING blocks, never RENDERING them

The precedent is in the code: `widgetEmbedNode.jsx:151` — "Registered unconditionally (the gate
NOTEBOOK_CHART_PLAN_ENABLED only hides the doors)".

P1 reads `NOTEBOOK_JOURNAL_STYLES_ENABLED` (payload key `notebook_journal_styles_enabled`) ONLY in:

1. the router dependency of `api/routers/notebook_journal_styles.py` (one 404 for every route);
2. the `styleId`/`kindId` branch of `POST /api/j2/notes` (`api/routers/journal_two.py`);
3. client doors: the New note menu's "From a style", the kind section of the New note sheet, the
   Styles button, the Settings card, `/style`, "Save this note's setup as a style", the update
   banner, and offering `builtin:note_kind` in "Add property".

It is NEVER read by: the `widgetEmbed` node, the note body, `GET /api/j2/notes/{id}`, the
`builtin:note_kind` property definition, or the property resolve. With the switch off, a note made
from a style opens exactly as it was saved, its chart renders, and its Kind of note value still
shows. Rails: `tests/test_note_kind_property.py::test_note_kind_def_is_present_with_the_switch_off`
(Task 5) and `B/NoteEditorPage.styleUpdate.test.jsx` "a styled note renders with the switch off"
(Task 14).
````

- [ ] **Step 3: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/check_repo_hygiene.py
git add docs/notebook/p1-verify-before-building.md
git commit -F - -- docs/notebook/p1-verify-before-building.md <<'MSG'
docs(notebook): P1.7 verify-before-building finding (widget kinds open-ended, no data loss, switch gates creating)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 2: Unknown block kinds keep their data and say "needs a newer version"

Rests on Task 1 §b. Ships before any block kind exists, so every bundle built from here on meets P2's kinds with the right card.

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx` (`PlaceholderChip`, around `:138-158`)
- Modify: `app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.module.css` (append)
- Test: `app/src/pages/journal-2-0/lib/widgetEmbedNode.unknownKind.test.js` (new)
- Test: `app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.unknownKind.test.jsx` (new)
- Test: `tests/test_notebook_unknown_block_kind.py` (new)

**Interfaces:**
- Consumes: `editorSchema()` from `J/lib/tiptap.js`; `WidgetEmbedView` props `{node, selected, editor, updateAttributes}`; `notes.create_note`, `notes.get_note`, `notebook_schema.required_schema`.
- Produces: the card copy `UNKNOWN_BLOCK_SENTENCE = 'This block needs a newer version of the app. Reload to see it.'`, exported from `WidgetEmbedView.jsx`.

- [ ] **Step 1: Write the failing client tests**

`app/src/pages/journal-2-0/lib/widgetEmbedNode.unknownKind.test.js`:

```js
// P1.7(b) rail: a widget kind this bundle does not know survives the load/save round trip with
// every attribute the node declares -- params included -- and an UNDECLARED attribute does not.
// The control is why P2 keeps block state inside `params` (docs/notebook/p1-verify-before-building.md §a).
import { describe, it, expect } from 'vitest'
import { Node as PMNode } from '@tiptap/pm/model'
import { editorSchema } from './tiptap'

const FUTURE = {
  type: 'widgetEmbed',
  attrs: {
    v: 1, widgetId: 'checklistFromTheFuture', embedId: 'e-future-1', mode: 'snapshot',
    capturedAt: '2026-10-11T14:00:00Z', searchText: '[checklist: 1 of 1]',
    params: { items: [{ id: 'a', text: 'Base 5+ weeks', checked: true }], setup: 'VCP' },
  },
}
const doc = (...nodes) => ({ type: 'doc', content: nodes })
const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

describe('an unknown block kind in an older bundle', () => {
  it('round-trips with widgetId, params, embedId and searchText intact', () => {
    const back = PMNode.fromJSON(editorSchema(), doc(para('Plan'), FUTURE)).toJSON()
    const node = back.content.find((n) => n.type === 'widgetEmbed')
    expect(node.attrs.widgetId).toBe('checklistFromTheFuture')
    expect(node.attrs.params).toEqual(FUTURE.attrs.params)
    expect(node.attrs.embedId).toBe('e-future-1')
    expect(node.attrs.searchText).toBe('[checklist: 1 of 1]')
  })

  it('CONTROL: an undeclared attribute is dropped, so block state must live in params', () => {
    const withAttr = { ...FUTURE, attrs: { ...FUTURE.attrs, blockState: { ticks: 3 } } }
    const back = PMNode.fromJSON(editorSchema(), doc(withAttr)).toJSON()
    expect(back.content[0].attrs.blockState).toBeUndefined()
    expect(back.content[0].attrs.params).toEqual(FUTURE.attrs.params)
  })
})
```

`app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.unknownKind.test.jsx`:

```jsx
// P1.7(b): the card an older bundle shows for a block from a newer version. It names the block,
// says what to do, offers Reload, and never writes to the node.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@tiptap/react', async (orig) => ({ ...(await orig()), NodeViewWrapper: (props) => <div {...props} /> }))
vi.mock('../../lib/embedArchive', async (orig) => ({
  ...(await orig()),
  captureElementPng: vi.fn(async () => null),
  storeFallbackImage: vi.fn(async () => ({ url: '/x.png' })),
  kickSnapshotWarm: vi.fn(),
}))

import WidgetEmbedView, { UNKNOWN_BLOCK_SENTENCE } from './WidgetEmbedView'

const editor = () => ({ isEditable: true, storage: { uctJournalWidgets: { noteId: 'note-9' } }, on() {}, off() {} })
const FUTURE = {
  v: 1, widgetId: 'checklistFromTheFuture', embedId: 'e-future-1', mode: 'snapshot',
  capturedAt: '2026-10-11T14:00:00Z', searchText: '[checklist: 1 of 1]', params: { items: [] },
}

let RealIO
beforeAll(() => {
  RealIO = globalThis.IntersectionObserver
  globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb }
    observe() { this.cb([{ isIntersecting: true }], this) }
    unobserve() {}
    disconnect() {}
  }
})
afterAll(() => { globalThis.IntersectionObserver = RealIO })

describe('a block this bundle does not know', () => {
  it('shows the newer-version sentence, the block line and a Reload button', () => {
    render(<WidgetEmbedView node={{ attrs: FUTURE }} selected={false} editor={editor()} updateAttributes={vi.fn()} />)
    expect(UNKNOWN_BLOCK_SENTENCE).toBe('This block needs a newer version of the app. Reload to see it.')
    expect(screen.getByText(UNKNOWN_BLOCK_SENTENCE)).toBeTruthy()
    expect(screen.getByText('[checklist: 1 of 1]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(screen.queryByText('widget type unavailable')).toBeNull()
  })

  it('never writes to the node', async () => {
    const updateAttributes = vi.fn()
    render(<WidgetEmbedView node={{ attrs: FUTURE }} selected={false} editor={editor()} updateAttributes={updateAttributes} />)
    await new Promise((r) => setTimeout(r, 60))
    expect(updateAttributes).not.toHaveBeenCalled()
  })

  it('a known chart with no image keeps its own sentence (no regression)', () => {
    const chart = { ...FUTURE, widgetId: 'chart', params: { tf: 'D' } }   // missing symbol: invalid params
    render(<WidgetEmbedView node={{ attrs: chart }} selected={false} editor={editor()} updateAttributes={vi.fn()} />)
    expect(screen.getByText('snapshot image not captured yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
  })
})
```

- [ ] **Step 2: Write the failing server test**

`tests/test_notebook_unknown_block_kind.py`:

```python
"""P1.7(a)+(b), server half: a widget kind the server has never heard of is stored, read back and
indexed exactly like a known one, and needs schema level 0. A new block kind is therefore never a
schema decision (docs/notebook/p1-verify-before-building.md)."""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest

FUTURE = {"type": "widgetEmbed", "attrs": {
    "v": 1, "widgetId": "checklistFromTheFuture", "embedId": "e-future-1", "mode": "snapshot",
    "capturedAt": "2026-10-11T14:00:00Z", "searchText": "[checklist: 1 of 1]",
    "params": {"items": [{"id": "a", "text": "Base 5+ weeks", "checked": True}]}}}


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


def _body():
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Plan"}]}, FUTURE]}


def test_an_unknown_kind_needs_schema_level_zero():
    from api.services.journal_two import notebook_schema
    assert notebook_schema.required_schema(_body()) == 0


def test_an_unknown_kind_is_stored_read_back_and_indexed(db_path):
    from api.services import auth_db
    from api.services.journal_two import notes
    n = notes.create_note("u-future", {"title": "Plan", "bodyJson": _body()})
    got = notes.get_note("u-future", n["id"])
    node = next(x for x in got["bodyJson"]["content"] if x["type"] == "widgetEmbed")
    assert node["attrs"]["widgetId"] == "checklistFromTheFuture"
    assert node["attrs"]["params"] == FUTURE["attrs"]["params"]
    c = auth_db.get_connection()
    try:
        rows = c.execute("SELECT widget_id FROM j2_note_embeds WHERE note_id = ?", (n["id"],)).fetchall()
    finally:
        c.close()
    assert [r["widget_id"] for r in rows] == ["checklistFromTheFuture"]


def test_an_update_keeps_the_unknown_kind(db_path):
    from api.services.journal_two import notes
    n = notes.create_note("u-future", {"title": "Plan", "bodyJson": _body()})
    body = _body()
    body["content"].append({"type": "paragraph", "content": [{"type": "text", "text": "More"}]})
    notes.update_note("u-future", n["id"], {"bodyJson": body}, expected_updated_at=n["updatedAt"], client_schema=0)
    got = notes.get_note("u-future", n["id"])
    assert any(x.get("attrs", {}).get("widgetId") == "checklistFromTheFuture" for x in got["bodyJson"]["content"])
```

- [ ] **Step 3: Run the tests to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1/app
npx vitest run src/pages/journal-2-0/lib/widgetEmbedNode.unknownKind.test.js src/pages/journal-2-0/components/notebook/WidgetEmbedView.unknownKind.test.jsx > "$TEMP/p1-t2a.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: the round-trip file passes (it pins current, correct behaviour). The view file FAILS: `UNKNOWN_BLOCK_SENTENCE` is not exported and the old copy shows.

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python -m pytest tests/test_notebook_unknown_block_kind.py -q
```

Expected: 3 passed. These pin current, correct server behaviour. That is the point: the rail must exist before P2 relies on it.

- [ ] **Step 4: Change the card**

In `WidgetEmbedView.jsx`, add the export above `function PlaceholderChip`:

```jsx
/** P1.7(b): what an older bundle says about a block from a newer version. The node itself is
 *  kept and written back unchanged (docs/notebook/p1-verify-before-building.md §b). */
export const UNKNOWN_BLOCK_SENTENCE = 'This block needs a newer version of the app. Reload to see it.'
```

Replace the body of `PlaceholderChip` after the `shareView` branch (keep that branch exactly as it is):

```jsx
  if (reason === 'unknown-widget') {
    return (
      <div className={styles.placeholder} {...RENDER_UNAVAILABLE}>
        <span className={styles.placeholderLine}>{attrs.searchText || 'A block from a newer version of the app'}</span>
        <span className={styles.placeholderWhy}>{UNKNOWN_BLOCK_SENTENCE}</span>
        <button type="button" className={`btn btn-ghost ${styles.placeholderReload}`}
          onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
  return (
    <div className={styles.placeholder} {...RENDER_UNAVAILABLE}>
      <span className={styles.placeholderLine}>{attrs.searchText || '[widget]'}</span>
      <span className={styles.placeholderWhy}>snapshot image not captured yet</span>
    </div>
  )
```

`widgetEmbedStopEvent` already lets a BUTTON own its events (`widgetEmbedNode.jsx`, `isInput`), so the click reaches the button.

Append to `WidgetEmbedView.module.css`:

```css
.placeholderReload { align-self: flex-start; margin-top: 6px; }
@media (max-width: 1024px) {
  .placeholderReload { min-height: var(--tap-min); min-width: var(--tap-min); }
}
```

- [ ] **Step 5: Run the tests to see them pass**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1/app
npx vitest run src/pages/journal-2-0/lib/widgetEmbedNode.unknownKind.test.js src/pages/journal-2-0/components/notebook/WidgetEmbedView.unknownKind.test.jsx src/pages/journal-2-0/components/notebook/WidgetEmbedView.toolbarMore.test.jsx src/styles/tapFloor.test.js > "$TEMP/p1-t2b.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass.

- [ ] **Step 6: Mutation-prove the view rail**

Capture `WidgetEmbedView.jsx` bytes. Change `{UNKNOWN_BLOCK_SENTENCE}` inside the unknown branch to `widget type unavailable`. Re-run the view test: the first case must FAIL. Restore the captured bytes and check the sha.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.module.css app/src/pages/journal-2-0/lib/widgetEmbedNode.unknownKind.test.js app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.unknownKind.test.jsx tests/test_notebook_unknown_block_kind.py
git commit -F - -- app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.jsx app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.module.css app/src/pages/journal-2-0/lib/widgetEmbedNode.unknownKind.test.js app/src/pages/journal-2-0/components/notebook/WidgetEmbedView.unknownKind.test.jsx tests/test_notebook_unknown_block_kind.py <<'MSG'
feat(notebook): a block from a newer version says so and offers Reload; rail the unknown-kind round trip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 3: The switch — `NOTEBOOK_JOURNAL_STYLES_ENABLED`, end to end

**Files:**
- Modify: `api/routers/auth.py` (`NOTEBOOK_FLAGS`, before the closing `}` after the `COMPASS_NOTES_TOOL_ENABLED` row)
- Modify: `app/src/pages/journal-2-0/lib/offline/notebookFlags.js` (`FLAG_FALLBACKS`, before `notebook_door_guard`)
- Modify: `docs/feature_flags.json` (`flags`)
- Create: `api/services/journal_two/journal_styles.py` (the gate only; Task 6 grows it)
- Create: `app/src/pages/journal-2-0/lib/journalStylesFlag.js`
- Modify: `tests/test_notebook_flag_parse.py` (`_server_gates`)
- Test: `app/src/pages/journal-2-0/lib/journalStylesFlag.test.js` (new)

**Interfaces:**
- Produces (server): `journal_styles.FLAG = "NOTEBOOK_JOURNAL_STYLES_ENABLED"`, `journal_styles.enabled() -> bool` (per call, through `api.services.notebook_flags.flag_on(FLAG, False)`).
- Produces (client): `JOURNAL_STYLES_FLAG = 'notebook_journal_styles_enabled'`, `journalStylesEnabled() -> boolean`, `STYLE_EVENT = 'uct:notebook-journal-style'` from `J/lib/journalStylesFlag.js`. That module imports only `./offline/notebookFlags`, so a static import costs a few hundred bytes.

- [ ] **Step 1: Write the failing client test**

`app/src/pages/journal-2-0/lib/journalStylesFlag.test.js`:

```js
import { describe, it, expect, afterEach } from 'vitest'
import { latchNotebookFlags, __resetNotebookFlags, FLAG_FALLBACKS } from './offline/notebookFlags'
import { journalStylesEnabled, JOURNAL_STYLES_FLAG, STYLE_EVENT } from './journalStylesFlag'

afterEach(() => __resetNotebookFlags())

describe('the journal styles switch', () => {
  it('is OFF when the server never answered', () => {
    expect(FLAG_FALLBACKS[JOURNAL_STYLES_FLAG]).toBe(false)
    expect(journalStylesEnabled()).toBe(false)
  })
  it('is ON only when the payload says true', () => {
    latchNotebookFlags({ [JOURNAL_STYLES_FLAG]: true })
    expect(journalStylesEnabled()).toBe(true)
  })
  it('names its event', () => {
    expect(STYLE_EVENT).toBe('uct:notebook-journal-style')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1/app
npx vitest run src/pages/journal-2-0/lib/journalStylesFlag.test.js > "$TEMP/p1-t3a.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`app/src/pages/journal-2-0/lib/journalStylesFlag.js`:

```js
// Journal styles (spec P1.6): the ONE client gate, latched per tab like every Notebook flag.
// Server: NOTEBOOK_JOURNAL_STYLES_ENABLED (api/routers/auth.py NOTEBOOK_FLAGS), payload key
// below. ⛔ It gates CREATING (doors, the manager, /style, save-as-style, the update banner),
// never RENDERING a note that already holds a style's blocks (spec P1.7c).
import { notebookFlag } from './offline/notebookFlags'

export const JOURNAL_STYLES_FLAG = 'notebook_journal_styles_enabled'
export const journalStylesEnabled = () => notebookFlag(JOURNAL_STYLES_FLAG) === true
/** `/style` dispatches this on the editor's own DOM root; NoteEditorPage opens the style sheet. */
export const STYLE_EVENT = 'uct:notebook-journal-style'
```

In `notebookFlags.js` `FLAG_FALLBACKS`, before `notebook_door_guard: 'full',` add:

```js
  notebook_journal_styles_enabled: false, // P1: journal styles (kinds, styles, the manager) — absent ⇒ OFF
```

In `api/routers/auth.py` `NOTEBOOK_FLAGS`, after the `"COMPASS_NOTES_TOOL_ENABLED": False,` row, add:

```python
    # Notebook P1 (journal styles): kinds of note, journal styles, the manager, /style and the
    # update-layout action. The router's gate (journal_styles.enabled) reads it through flag_on per
    # request; the payload key is `notebook_journal_styles_enabled`. Gates CREATING, never rendering.
    "NOTEBOOK_JOURNAL_STYLES_ENABLED": False,  # enablement — unset means OFF (journal styles, P1)
```

`api/services/journal_two/journal_styles.py`:

```python
"""Journal styles (Notebook P1, spec §P1).

A journal style is a full setup for a kind of note: an outline, the blocks switched on (with their
settings) and the property values a new note starts with. This module is the ONE authority over
styles: the store, versions, defaults, the composer that turns a style into a note body, and the
"update layout" planner. The router is api/routers/notebook_journal_styles.py.

⛔ Dark behind NOTEBOOK_JOURNAL_STYLES_ENABLED, read PER CALL through the one Notebook flag parse.
⛔ The switch gates CREATING, never RENDERING (docs/notebook/p1-verify-before-building.md §c).
"""
from __future__ import annotations

from api.services.notebook_flags import flag_on

FLAG = "NOTEBOOK_JOURNAL_STYLES_ENABLED"


def enabled() -> bool:
    """The gate, read per call (default OFF)."""
    return flag_on(FLAG, False)
```

In `docs/feature_flags.json` under `"flags"`, add (edit as text and keep the file's own formatting; insert in the file's existing key order):

```json
    "NOTEBOOK_JOURNAL_STYLES_ENABLED": {
      "member_facing": {"label": "Journal styles", "where": "Notebook"},
      "status": "dark",
      "where": [],
      "note": "Notebook P1, 2026-10-11 (spec docs/superpowers/specs/2026-10-11-notebook-journal-styles-design.md §P1). Enablement gate for journal styles: kinds of note (built-in and the member's own), styles (outline + blocks + property defaults) with versions and one default per kind, the Styles manager, New note -> kind -> default style, Save this note's setup as a style, /style and the previewed Update layout action. Paid. Rides the auth payload (_access_payload) as notebook_journal_styles_enabled; the router answers one 404 while it is off. It gates CREATING only: notes already made from a style render unchanged with it off, and their Kind of note value still shows."
    },
```

In `tests/test_notebook_flag_parse.py`, add `from api.services.journal_two import journal_styles` to the import block beside the other `api.services.journal_two` imports. Then add this row to the dict in `_server_gates()`, after `"COMPASS_NOTES_TOOL_ENABLED": coach_chat_tools.notes_tool_enabled,`:

```python
        # Notebook P1: the journal styles service's own gate function.
        "NOTEBOOK_JOURNAL_STYLES_ENABLED": journal_styles.enabled,
```

- [ ] **Step 4: Run the rails**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1/app
npx vitest run src/pages/journal-2-0/lib/journalStylesFlag.test.js src/pages/journal-2-0/lib/offline/notebookFlags.serverDefaults.test.js src/pages/journal-2-0/lib/offline/notebookFlags.test.jsx src/context/authFlagPaths.test.js > "$TEMP/p1-t3b.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python -m pytest tests/test_notebook_flag_parse.py tests/test_feature_flag_ledger.py tests/test_flag_ledger_knobs.py tests/test_notebook_flag_table_form.py tests/test_hub_preview_flag.py -q > "$TEMP/p1-t3-py.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass. If a ledger rail asks for a field this entry lacks, add the field it names. Never relax the rail.

- [ ] **Step 5: Mutation-prove the default**

Capture `notebookFlags.js`. Set the new fallback to `true` and run `notebookFlags.serverDefaults.test.js`: it must FAIL by naming `notebook_journal_styles_enabled`. Restore by captured bytes.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/check_repo_hygiene.py
git add api/routers/auth.py app/src/pages/journal-2-0/lib/offline/notebookFlags.js docs/feature_flags.json api/services/journal_two/journal_styles.py app/src/pages/journal-2-0/lib/journalStylesFlag.js app/src/pages/journal-2-0/lib/journalStylesFlag.test.js tests/test_notebook_flag_parse.py
git commit -F - -- api/routers/auth.py app/src/pages/journal-2-0/lib/offline/notebookFlags.js docs/feature_flags.json api/services/journal_two/journal_styles.py app/src/pages/journal-2-0/lib/journalStylesFlag.js app/src/pages/journal-2-0/lib/journalStylesFlag.test.js tests/test_notebook_flag_parse.py <<'MSG'
feat(notebook): NOTEBOOK_JOURNAL_STYLES_ENABLED gate on the auth payload (dark, default OFF)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 4: Kinds of note — built-in constants, `j2_note_kinds`, the client mirror, the mapping offer

**Files:**
- Create: `api/services/journal_two/note_kinds.py`
- Create: `app/src/pages/journal-2-0/lib/noteKinds.js`
- Modify: `api/services/journal_two/db.py` (`_PHASE_2_ALTERS`: append before the closing `]` at `:2020`)
- Modify: `api/services/journal_two/account_purge.py` (`_DIRECT_USER_TABLES`, after `"j2_note_templates",`)
- Modify: `docs/account-deletion-manifest.md` (regenerated block only, `--write`)
- Modify: `api/routers/auth.py` (`_PREFERENCE_KEYS`: `"notebook_kind_mapping": _PREF_OPAQUE,`, in alphabetical place after `"notebook_getting_started"`)
- Test: `tests/test_note_kinds.py` (new)

**Interfaces:**
- Produces (server, `note_kinds`):
  - `NOTE_KIND_PROPERTY = "builtin:note_kind"`
  - `BUILTIN_NOTE_KINDS: tuple[dict, ...]`, each `{"id", "name", "icon"}`
  - `BUILTIN_KIND_IDS: frozenset[str]`, `MEMBER_KIND_PREFIX = "k_"`
  - `class KindValidationError(ValueError)`, `class KindInUse(KindValidationError)`
  - `list_kinds(user_id, conn=None) -> list[dict]`: each `{"id", "name", "icon", "builtin", "sortOrder"}`, built-ins first
  - `get_kind(user_id, kind_id, conn=None) -> dict | None`
  - `create_kind(user_id, name, icon=None, conn=None) -> dict`
  - `update_kind(user_id, kind_id, *, name=None, icon=None, sort_order=None, conn=None) -> dict | None`
  - `delete_kind(user_id, kind_id, conn=None) -> bool` (raises `KindInUse` while a live note or style uses it)
  - `kind_options(user_id, conn) -> list[dict]`: `[{"id", "label", "color": "gray"}]` for the property select
  - `RESEARCH_TYPE_TO_KIND: dict[str, str | None]`, `SECTOR_KIND_NAME = "Sector note"`
  - `mapping_offer(user_id, conn=None) -> dict | None`
  - `apply_mapping(user_id, exclude_note_ids, conn=None) -> list[dict]` (each `{"id", "updatedAt"}`)
- Produces (client): `BUILTIN_NOTE_KINDS` (frozen array of `{id, name, icon}`) and `kindIcon(kind) -> string`, from `J/lib/noteKinds.js`. The file has NO imports: it is imported by plain Node in the rail.

- [ ] **Step 1: Write the failing tests**

`tests/test_note_kinds.py`:

```python
"""Kinds of note (spec P1.1/P1.2): built-ins are code constants; a member's own kinds are rows.
ONE FACT IN TWO FILES: note_kinds.BUILTIN_NOTE_KINDS <-> app/src/pages/journal-2-0/lib/noteKinds.js,
pinned by importing the JS module through Node (the notebook_schema guard's method)."""
from __future__ import annotations

import importlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

CLIENT = Path("app/src/pages/journal-2-0/lib/noteKinds.js")


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


def _client_kinds() -> list[dict]:
    node = shutil.which("node")
    assert node, "node is not on PATH; this rail reads the client list the way the bundle does"
    js = (f"import({json.dumps(CLIENT.resolve().as_uri())}).then((m) => "
          "process.stdout.write(JSON.stringify(m.BUILTIN_NOTE_KINDS)))")
    r = subprocess.run([node, "--input-type=module", "-e", js], capture_output=True, timeout=120)
    assert r.returncode == 0, (r.stderr or b"").decode("utf-8", "replace")[:2000]
    return json.loads(r.stdout.decode("utf-8"))


def test_the_client_list_equals_the_server_list():
    from api.services.journal_two import note_kinds
    client = _client_kinds()
    assert len(client) == 8                                            # non-vacuity
    assert client == [dict(k) for k in note_kinds.BUILTIN_NOTE_KINDS]


def test_no_builtin_id_can_collide_with_a_member_id():
    from api.services.journal_two import note_kinds
    assert not any(k["id"].startswith(note_kinds.MEMBER_KIND_PREFIX) for k in note_kinds.BUILTIN_NOTE_KINDS)


def test_list_create_rename_delete(db_path):
    from api.services.journal_two import note_kinds as nk
    k = nk.create_kind("u1", "  Gap and go ", "bolt")
    assert k["id"].startswith("k_") and k["name"] == "Gap and go" and k["builtin"] is False
    ids = [x["id"] for x in nk.list_kinds("u1")]
    assert ids[:8] == [b["id"] for b in nk.BUILTIN_NOTE_KINDS] and ids[-1] == k["id"]
    assert nk.update_kind("u1", k["id"], name="Gap & go")["name"] == "Gap & go"
    assert nk.list_kinds("u2")[-1]["id"] == "watchlist_note"           # another member sees none of it
    assert nk.delete_kind("u1", k["id"]) is True
    assert nk.get_kind("u1", k["id"]) is None


def test_names_are_unique_against_builtins_and_each_other(db_path):
    from api.services.journal_two import note_kinds as nk
    with pytest.raises(nk.KindValidationError):
        nk.create_kind("u1", "trade PLAN")
    nk.create_kind("u1", "Swing")
    with pytest.raises(nk.KindValidationError):
        nk.create_kind("u1", "swing")
    with pytest.raises(nk.KindValidationError):
        nk.update_kind("u1", "trade_plan", name="Mine")


def test_a_kind_in_use_cannot_be_deleted(db_path):
    from api.services.journal_two import note_kinds as nk
    from api.services.journal_two import notes
    k = nk.create_kind("u1", "Swing")
    notes.create_note("u1", {"title": "x"}, properties={nk.NOTE_KIND_PROPERTY: k["id"]})
    with pytest.raises(nk.KindInUse) as e:
        nk.delete_kind("u1", k["id"])
    assert "1 note" in str(e.value)


def test_mapping_offer_and_apply(db_path):
    from api.services.journal_two import note_kinds as nk
    from api.services.journal_two import notes
    a = notes.create_note("u1", {"title": "a"}, properties={"builtin:research_type": "earnings_play"})
    b = notes.create_note("u1", {"title": "b"}, properties={"builtin:research_type": "sector_note"})
    c = notes.create_note("u1", {"title": "c"}, properties={"builtin:research_type": "long_thesis"})
    offer = nk.mapping_offer("u1")
    assert offer["total"] == 3
    assert {r["researchType"]: r["kindId"] for r in offer["rows"]}["earnings_play"] == "earnings"
    assert {r["researchType"]: r["createsKind"] for r in offer["rows"]}["sector_note"] is True
    done = nk.apply_mapping("u1", exclude_note_ids=[c["id"]])
    assert {d["id"] for d in done} == {a["id"], b["id"]}
    assert notes.get_note("u1", a["id"])["propertiesJson"][nk.NOTE_KIND_PROPERTY] == "earnings"
    sector = [k for k in nk.list_kinds("u1") if k["name"] == nk.SECTOR_KIND_NAME]
    assert len(sector) == 1
    assert notes.get_note("u1", b["id"])["propertiesJson"][nk.NOTE_KIND_PROPERTY] == sector[0]["id"]
    assert nk.mapping_offer("u1")["total"] == 1                         # c was excluded, still offered
```

`test_a_kind_in_use_cannot_be_deleted` and `test_mapping_offer_and_apply` need Task 5's per-member options to set a member kind. Mark both `@pytest.mark.xfail(strict=True, reason="needs Task 5: builtin:note_kind")` in this task. Task 5 removes the marks.

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python -m pytest tests/test_note_kinds.py -q
```

Expected: FAIL (module not found), with the two xfails reported as such once the module exists.

- [ ] **Step 3: Implement**

`app/src/pages/journal-2-0/lib/noteKinds.js`:

```js
// Kinds of note (spec P1.1). ⛔ ONE FACT IN TWO FILES with
// api/services/journal_two/note_kinds.py::BUILTIN_NOTE_KINDS; tests/test_note_kinds.py IMPORTS this
// module through Node and asserts equality. ⛔ NO IMPORTS in this file: plain Node must load it.
export const BUILTIN_NOTE_KINDS = Object.freeze([
  { id: 'trade_plan', name: 'Trade plan', icon: 'chart' },
  { id: 'daily_prep', name: 'Daily prep', icon: 'sun' },
  { id: 'weekend_prep', name: 'Weekend prep', icon: 'calendar' },
  { id: 'earnings', name: 'Earnings', icon: 'earnings' },
  { id: 'post_trade_review', name: 'Post-trade review', icon: 'check' },
  { id: 'weekly_review', name: 'Weekly review', icon: 'refresh' },
  { id: 'thesis', name: 'Thesis', icon: 'book' },
  { id: 'watchlist_note', name: 'Watchlist note', icon: 'eye' },
].map((k) => Object.freeze(k)))

/** A kind's icon, or 'document' when it has none. The caller checks UICON_NAMES before rendering. */
export const kindIcon = (kind) => (kind && typeof kind.icon === 'string' && kind.icon) || 'document'
```

`api/services/journal_two/note_kinds.py`:

```python
"""Kinds of note (Notebook P1, spec §P1.1/§P1.2).

Built-in kinds are CODE CONSTANTS (`BUILTIN_NOTE_KINDS`); a member's own kinds are rows of
`j2_note_kinds`. ⛔ ONE FACT IN TWO FILES with app/src/pages/journal-2-0/lib/noteKinds.js, pinned by
tests/test_note_kinds.py (which imports the JS module through Node).

Two facts, two places, never one restated:
  * `j2_notes.kind_id` is PROVENANCE: the kind a note was CREATED as (with style_id/style_version).
  * the `builtin:note_kind` property is the note's CURRENT kind, the one views, filters and boards
    group by. It is set at creation, editable like any select, and is the only thing grouping reads.

A kind in use (a live note's current kind, or a live style's kind) cannot be deleted: the member
moves those first. There is no soft delete for kinds, so there is never an orphaned value.
"""
from __future__ import annotations

import json
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection

NOTE_KIND_PROPERTY = "builtin:note_kind"
MEMBER_KIND_PREFIX = "k_"
MAX_KINDS_PER_MEMBER = 50
MAX_KIND_NAME_CHARS = 40
_ICON_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9]{0,39}$")

BUILTIN_NOTE_KINDS: tuple[dict, ...] = (
    {"id": "trade_plan", "name": "Trade plan", "icon": "chart"},
    {"id": "daily_prep", "name": "Daily prep", "icon": "sun"},
    {"id": "weekend_prep", "name": "Weekend prep", "icon": "calendar"},
    {"id": "earnings", "name": "Earnings", "icon": "earnings"},
    {"id": "post_trade_review", "name": "Post-trade review", "icon": "check"},
    {"id": "weekly_review", "name": "Weekly review", "icon": "refresh"},
    {"id": "thesis", "name": "Thesis", "icon": "book"},
    {"id": "watchlist_note", "name": "Watchlist note", "icon": "eye"},
)
BUILTIN_KIND_IDS = frozenset(k["id"] for k in BUILTIN_NOTE_KINDS)
_BUILTIN_BY_ID = {k["id"]: k for k in BUILTIN_NOTE_KINDS}

#: builtin:research_type option -> kind id; None = the member kind named SECTOR_KIND_NAME.
RESEARCH_TYPE_TO_KIND: dict[str, str | None] = {
    "long_thesis": "thesis", "short_thesis": "thesis", "earnings_play": "earnings",
    "watchlist_note": "watchlist_note", "sector_note": None,
}
SECTOR_KIND_NAME = "Sector note"


class KindValidationError(ValueError):
    pass


class KindInUse(KindValidationError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _builtin(k: dict, i: int) -> dict:
    return {"id": k["id"], "name": k["name"], "icon": k["icon"], "builtin": True, "sortOrder": i}


def _row(r: sqlite3.Row) -> dict:
    return {"id": r["id"], "name": r["name"], "icon": r["icon"], "builtin": False, "sortOrder": r["sort_order"]}


def _clean_name(raw: Any) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise KindValidationError("A kind of note needs a name.")
    name = " ".join(raw.split())
    if len(name) > MAX_KIND_NAME_CHARS:
        raise KindValidationError(f"A kind's name can be at most {MAX_KIND_NAME_CHARS} characters.")
    return name


def _clean_icon(raw: Any) -> str | None:
    if raw is None or raw == "":
        return None
    if not isinstance(raw, str) or not _ICON_RE.match(raw):
        raise KindValidationError("Choose an icon from the list.")
    return raw


def _taken(user_id: str, name: str, conn: sqlite3.Connection, *, except_id: str | None = None) -> bool:
    low = name.casefold()
    if any(k["name"].casefold() == low for k in BUILTIN_NOTE_KINDS):
        return True
    rows = conn.execute("SELECT id, name FROM j2_note_kinds WHERE user_id = ?", (user_id,)).fetchall()
    return any(r["name"].casefold() == low and r["id"] != except_id for r in rows)


def list_kinds(user_id: str, conn: sqlite3.Connection | None = None) -> list[dict]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_note_kinds WHERE user_id = ? ORDER BY sort_order, created_at, rowid",
            (user_id,)).fetchall()
        return [_builtin(k, i) for i, k in enumerate(BUILTIN_NOTE_KINDS)] + [_row(r) for r in rows]
    finally:
        if owned:
            conn.close()


def get_kind(user_id: str, kind_id: Any, conn: sqlite3.Connection | None = None) -> dict | None:
    if not isinstance(kind_id, str):
        return None
    if kind_id in _BUILTIN_BY_ID:
        i = [k["id"] for k in BUILTIN_NOTE_KINDS].index(kind_id)
        return _builtin(_BUILTIN_BY_ID[kind_id], i)
    owned = conn is None
    conn = conn or get_connection()
    try:
        r = conn.execute("SELECT * FROM j2_note_kinds WHERE id = ? AND user_id = ?", (kind_id, user_id)).fetchone()
        return _row(r) if r else None
    finally:
        if owned:
            conn.close()


def create_kind(user_id: str, name: Any, icon: Any = None, conn: sqlite3.Connection | None = None) -> dict:
    clean, ic = _clean_name(name), _clean_icon(icon)
    owned = conn is None
    conn = conn or get_connection()
    try:
        if _taken(user_id, clean, conn):
            raise KindValidationError(f"There is already a kind called {clean}.")
        n = conn.execute("SELECT COUNT(*) AS c FROM j2_note_kinds WHERE user_id = ?", (user_id,)).fetchone()["c"]
        if n >= MAX_KINDS_PER_MEMBER:
            raise KindValidationError(f"You can keep up to {MAX_KINDS_PER_MEMBER} kinds of note.")
        kid = MEMBER_KIND_PREFIX + uuid.uuid4().hex
        conn.execute("INSERT INTO j2_note_kinds (id, user_id, name, icon, sort_order, created_at)"
                     " VALUES (?, ?, ?, ?, ?, ?)", (kid, user_id, clean, ic, n, _now()))
        conn.commit()
        return get_kind(user_id, kid, conn)
    finally:
        if owned:
            conn.close()


def update_kind(user_id: str, kind_id: str, *, name: Any = None, icon: Any = None,
                sort_order: Any = None, conn: sqlite3.Connection | None = None) -> dict | None:
    if kind_id in BUILTIN_KIND_IDS:
        raise KindValidationError("Built-in kinds can't be changed. Make your own kind instead.")
    owned = conn is None
    conn = conn or get_connection()
    try:
        if get_kind(user_id, kind_id, conn) is None:
            return None
        sets, params = [], []
        if name is not None:
            clean = _clean_name(name)
            if _taken(user_id, clean, conn, except_id=kind_id):
                raise KindValidationError(f"There is already a kind called {clean}.")
            sets.append("name = ?"); params.append(clean)
        if icon is not None:
            sets.append("icon = ?"); params.append(_clean_icon(icon))
        if sort_order is not None:
            if isinstance(sort_order, bool) or not isinstance(sort_order, int):
                raise KindValidationError("sortOrder must be a whole number")
            sets.append("sort_order = ?"); params.append(sort_order)
        if sets:
            conn.execute(f"UPDATE j2_note_kinds SET {', '.join(sets)} WHERE id = ? AND user_id = ?",
                         (*params, kind_id, user_id))
            conn.commit()
        return get_kind(user_id, kind_id, conn)
    finally:
        if owned:
            conn.close()


def _uses(user_id: str, kind_id: str, conn: sqlite3.Connection) -> tuple[int, int]:
    notes_n = 0
    for r in conn.execute("SELECT properties_json FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL"
                          " AND properties_json IS NOT NULL", (user_id,)):
        try:
            if json.loads(r["properties_json"]).get(NOTE_KIND_PROPERTY) == kind_id:
                notes_n += 1
        except (TypeError, ValueError, AttributeError):
            continue
    styles_n = 0
    has_styles = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='j2_journal_styles'").fetchone()
    if has_styles:
        styles_n = conn.execute("SELECT COUNT(*) AS c FROM j2_journal_styles WHERE user_id = ? AND kind_id = ?"
                                " AND deleted_at IS NULL", (user_id, kind_id)).fetchone()["c"]
    return notes_n, styles_n


def delete_kind(user_id: str, kind_id: str, conn: sqlite3.Connection | None = None) -> bool:
    if kind_id in BUILTIN_KIND_IDS:
        raise KindValidationError("Built-in kinds can't be deleted.")
    owned = conn is None
    conn = conn or get_connection()
    try:
        if get_kind(user_id, kind_id, conn) is None:
            return False
        notes_n, styles_n = _uses(user_id, kind_id, conn)
        if notes_n or styles_n:
            parts = []
            if notes_n:
                parts.append(f"{notes_n} note{'s' if notes_n != 1 else ''}")
            if styles_n:
                parts.append(f"{styles_n} style{'s' if styles_n != 1 else ''}")
            raise KindInUse(f"This kind is used by {' and '.join(parts)}. Move them to another kind first.")
        conn.execute("DELETE FROM j2_note_kinds WHERE id = ? AND user_id = ?", (kind_id, user_id))
        conn.commit()
        return True
    finally:
        if owned:
            conn.close()


def kind_options(user_id: str, conn: sqlite3.Connection) -> list[dict]:
    """The `builtin:note_kind` select's options for THIS member: built-ins, then their own."""
    return [{"id": k["id"], "label": k["name"], "color": "gray"} for k in list_kinds(user_id, conn)]


def _unmapped(user_id: str, conn: sqlite3.Connection) -> list[tuple[str, str]]:
    out = []
    for r in conn.execute("SELECT id, properties_json FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL"
                          " AND properties_json IS NOT NULL ORDER BY created_at, rowid", (user_id,)):
        try:
            props = json.loads(r["properties_json"])
        except (TypeError, ValueError):
            continue
        rt = props.get("builtin:research_type") if isinstance(props, dict) else None
        if rt in RESEARCH_TYPE_TO_KIND and not props.get(NOTE_KIND_PROPERTY):
            out.append((r["id"], rt))
    return out


def _sector_kind(user_id: str, conn: sqlite3.Connection) -> dict | None:
    low = SECTOR_KIND_NAME.casefold()
    return next((k for k in list_kinds(user_id, conn) if k["name"].casefold() == low), None)


def mapping_offer(user_id: str, conn: sqlite3.Connection | None = None) -> dict | None:
    """The one-shot offer (spec P1.2): notes that carry a Research Type and no Kind of note, by type."""
    from api.services.journal_two import note_properties as np
    owned = conn is None
    conn = conn or get_connection()
    try:
        counts: dict[str, int] = {}
        for _nid, rt in _unmapped(user_id, conn):
            counts[rt] = counts.get(rt, 0) + 1
        if not counts:
            return None
        labels = {o["id"]: o["label"] for o in np._BUILTIN_BY_ID["builtin:research_type"]["options"]}
        sector = _sector_kind(user_id, conn)
        rows = []
        for rt in RESEARCH_TYPE_TO_KIND:
            if rt not in counts:
                continue
            target = RESEARCH_TYPE_TO_KIND[rt]
            kind = get_kind(user_id, target, conn) if target else sector
            rows.append({"researchType": rt, "researchTypeLabel": labels.get(rt, rt), "count": counts[rt],
                         "kindId": kind["id"] if kind else None,
                         "kindName": kind["name"] if kind else SECTOR_KIND_NAME,
                         "createsKind": kind is None})
        return {"total": sum(counts.values()), "rows": rows}
    finally:
        if owned:
            conn.close()


def apply_mapping(user_id: str, exclude_note_ids: Any = (), conn: sqlite3.Connection | None = None) -> list[dict]:
    """Set Kind of note from Research Type on every unmapped note not in `exclude_note_ids` (the
    client excludes notes holding unsent offline work). Each write goes through notes.update_note
    and moves that note's revision; the caller lands every returned {id, updatedAt}."""
    from api.services.journal_two import notes as notes_service
    skip = {x for x in (exclude_note_ids or []) if isinstance(x, str)}
    owned = conn is None
    conn = conn or get_connection()
    try:
        pending = [(nid, rt) for nid, rt in _unmapped(user_id, conn) if nid not in skip]
        if not pending:
            return []
        sector = _sector_kind(user_id, conn)
        if sector is None and any(RESEARCH_TYPE_TO_KIND[rt] is None for _nid, rt in pending):
            sector = create_kind(user_id, SECTOR_KIND_NAME, "globe", conn)
        done = []
        for nid, rt in pending:
            kind_id = RESEARCH_TYPE_TO_KIND[rt] or sector["id"]
            n = notes_service.update_note(user_id, nid, {"properties": {NOTE_KIND_PROPERTY: kind_id}}, conn=conn)
            if n is not None:
                done.append({"id": n["id"], "updatedAt": n["updatedAt"]})
        return done
    finally:
        if owned:
            conn.close()
```

In `db.py` `_PHASE_2_ALTERS`, before the closing `]` at `:2020`, add:

```python
    # Notebook P1 (journal styles): a member's own kinds of note (note_kinds.py). Built-in kinds
    # are code constants and have no row. ⛔ user-scoped: purged with the account
    # (account_purge._DIRECT_USER_TABLES). Names are unique per member, case-insensitive
    # (the service also refuses a built-in's name).
    """CREATE TABLE IF NOT EXISTS j2_note_kinds (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        name       TEXT NOT NULL,
        icon       TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    )""",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_j2_note_kinds_user_name"
    " ON j2_note_kinds(user_id, name COLLATE NOCASE)",
```

In `account_purge.py` `_DIRECT_USER_TABLES`, after `"j2_note_templates",`:

```python
    # Notebook P1 (journal styles): a member's own kinds of note (note_kinds.py).
    "j2_note_kinds",
```

Regenerate the manifest block:

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/account_deletion_manifest.py --write
```

In `api/routers/auth.py` `_PREFERENCE_KEYS`, add `"notebook_kind_mapping": _PREF_OPAQUE,` right after the `"notebook_getting_started": _PREF_OPAQUE,` row (with a one-line comment: `# Notebook P1: the Research Type -> Kind of note offer's answer ("dismissed").`).

- [ ] **Step 4: Run the tests**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python -m pytest tests/test_note_kinds.py tests/test_account_deletion_manifest.py tests/test_journal_two_account_purge.py -q > "$TEMP/p1-t4.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: pass, with 2 xfailed (strict).

- [ ] **Step 5: Mutation-prove the two-files rail**

Capture `noteKinds.js`. Rename `'Weekly review'` to `'Weekly Review'`. `test_the_client_list_equals_the_server_list` must FAIL. Restore by captured bytes.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/check_repo_hygiene.py
git add api/services/journal_two/note_kinds.py app/src/pages/journal-2-0/lib/noteKinds.js api/services/journal_two/db.py api/services/journal_two/account_purge.py docs/account-deletion-manifest.md api/routers/auth.py tests/test_note_kinds.py
git commit -F - -- api/services/journal_two/note_kinds.py app/src/pages/journal-2-0/lib/noteKinds.js api/services/journal_two/db.py api/services/journal_two/account_purge.py docs/account-deletion-manifest.md api/routers/auth.py tests/test_note_kinds.py <<'MSG'
feat(notebook): kinds of note (built-in constants + j2_note_kinds), client mirror rail, research-type mapping offer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 5: `builtin:note_kind` — a select over the member's kinds, always rendered, offered only while on

Rests on Task 1 §c: the definition is unconditional; only the "Add property" offer reads the switch.

**Files:**
- Modify: `api/services/journal_two/note_properties.py` (`BUILTIN_PROPERTY_DEFS` at `:72-109`; `list_property_defs` `:154`; `get_property_def` `:160-163`; `set_note_properties` `:430`)
- Modify: `api/services/journal_two/note_templates.py` (`_still_valid_properties`, `:81`)
- Modify: `app/src/pages/journal-2-0/components/notebook/PropertiesSection.jsx` (`hidden` memo, `:150-153`)
- Modify: `tests/test_note_kinds.py` (remove the two `xfail` marks)
- Test: `tests/test_note_kind_property.py` (new)
- Test: `app/src/pages/journal-2-0/components/notebook/PropertiesSection.noteKind.test.jsx` (new)

**Interfaces:**
- Consumes: `note_kinds.BUILTIN_NOTE_KINDS`, `note_kinds.kind_options`, `note_kinds.NOTE_KIND_PROPERTY`; `journalStylesEnabled()`.
- Produces: `note_properties._builtin_def(user_id: str, property_id: str, conn) -> dict | None`, the ONE way a built-in definition is read with member-specific options. Every built-in lookup that validates a value goes through it.

- [ ] **Step 1: Write the failing tests**

`tests/test_note_kind_property.py`:

```python
"""builtin:note_kind (spec P1.2): a select over the member's kinds, so views, filters and boards
group by kind. ⛔ The definition never reads the journal-styles switch (spec P1.7c): with it off a
note's Kind of note still validates and renders."""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


def _def(user_id):
    from api.services.journal_two import note_properties as np
    return next(d for d in np.list_property_defs(user_id) if d["id"] == "builtin:note_kind")


def test_note_kind_def_is_present_with_the_switch_off(db_path, monkeypatch):
    monkeypatch.delenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", raising=False)
    d = _def("u1")
    assert d["type"] == "select" and d["source"] == "user_set" and d["name"] == "Kind of note"
    assert [o["id"] for o in d["options"]][:2] == ["trade_plan", "daily_prep"]


def test_a_members_own_kind_is_an_option_for_them_only(db_path):
    from api.services.journal_two import note_kinds as nk
    k = nk.create_kind("u1", "Swing")
    assert k["id"] in [o["id"] for o in _def("u1")["options"]]
    assert k["id"] not in [o["id"] for o in _def("u2")["options"]]


def test_setting_and_rejecting_values(db_path):
    from api.services.journal_two import note_kinds as nk
    from api.services.journal_two import notes
    k = nk.create_kind("u1", "Swing")
    n = notes.create_note("u1", {"title": "x"})
    got = notes.update_note("u1", n["id"], {"properties": {"builtin:note_kind": k["id"]}})
    assert got["propertiesJson"]["builtin:note_kind"] == k["id"]
    with pytest.raises(notes.NoteValidationError):
        notes.update_note("u2", notes.create_note("u2", {"title": "y"})["id"],
                          {"properties": {"builtin:note_kind": k["id"]}})   # u1's kind is not u2's


def test_a_template_keeps_a_member_kind_value(db_path):
    from api.services.journal_two import note_kinds as nk
    from api.services.journal_two import note_templates, notes
    k = nk.create_kind("u1", "Swing")
    n = notes.create_note("u1", {"title": "x"}, properties={"builtin:note_kind": k["id"]})
    t = note_templates.create_from_note("u1", n["id"])
    assert note_templates.get_template("u1", t["id"])["properties"]["builtin:note_kind"] == k["id"]
```

`app/src/pages/journal-2-0/components/notebook/PropertiesSection.noteKind.test.jsx`: render `PropertiesSection` the way an existing PropertiesSection test does (read `PropertiesSection.templateReveal.test.jsx` and copy its fetch stub and providers). Stub `/api/j2/notes/n1/properties` to return two user_set selects with `value: null`: `builtin:thesis_status` and `builtin:note_kind` (options `[{id:'trade_plan',label:'Trade plan'}]`). Then assert:

```jsx
it('Add property offers Kind of note only while the switch is on', async () => {
  // switch OFF
  renderSection()
  fireEvent.click(await screen.findByRole('button', { name: /add property/i }))
  expect(screen.queryByRole('option', { name: 'Kind of note' }) || screen.queryByText('Kind of note')).toBeNull()
  cleanup()
  // switch ON
  latchNotebookFlags({ notebook_journal_styles_enabled: true })
  renderSection()
  fireEvent.click(await screen.findByRole('button', { name: /add property/i }))
  expect(screen.getByText('Kind of note')).toBeTruthy()
})

it('a note that already has a Kind of note shows it with the switch off', async () => {
  renderSection({ noteKindValue: 'trade_plan' })   // the stub returns value: 'trade_plan'
  expect(await screen.findByText('Kind of note')).toBeTruthy()
})
```

Write `renderSection({ noteKindValue = null } = {})` as a helper in the file. It installs the fetch stub with `builtin:note_kind` carrying `value: noteKindValue`, then renders `<PropertiesSection noteId="n1" updateNote={vi.fn()} />` inside the same providers the template-reveal test uses.

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python -m pytest tests/test_note_kind_property.py -q
```

Expected: FAIL (`StopIteration`, no such definition).

- [ ] **Step 3: Implement the server half**

In `note_properties.py`, add near the top imports:

```python
from api.services.journal_two.note_kinds import BUILTIN_NOTE_KINDS, NOTE_KIND_PROPERTY
```

Append to `BUILTIN_PROPERTY_DEFS` (after the `builtin:review_date` entry, so every existing position is unchanged):

```python
    # Notebook P1: the note's CURRENT kind (note_kinds.py). Static options are the built-in kinds;
    # `_builtin_def` adds the member's own. ⛔ Registered unconditionally (spec P1.7c).
    {
        "id": NOTE_KIND_PROPERTY, "name": "Kind of note", "type": "select", "source": "user_set",
        "options": [{"id": k["id"], "label": k["name"], "color": "gray"} for k in BUILTIN_NOTE_KINDS],
    },
```

Add after `is_builtin_property_id`:

```python
def _builtin_def(user_id: str, property_id: str, conn: sqlite3.Connection | None) -> dict[str, Any] | None:
    """A built-in definition as THIS member sees it. `builtin:note_kind`'s options are per member
    (built-in kinds + their own); every other built-in is the static entry. The one reader: a
    built-in lookup that validates a value must come through here, or a member's own kind is refused."""
    d = _BUILTIN_BY_ID.get(property_id)
    if d is None:
        return None
    out = dict(d)
    if property_id == NOTE_KIND_PROPERTY:
        from api.services.journal_two.note_kinds import kind_options
        if conn is None:
            owned = get_connection()
            try:
                out["options"] = kind_options(user_id, owned)
            finally:
                owned.close()
        else:
            out["options"] = kind_options(user_id, conn)
    return out
```

Then change three call sites:
- `list_property_defs` return becomes `return [_builtin_def(user_id, d["id"], conn) for d in BUILTIN_PROPERTY_DEFS] + [_def_row_to_dict(r) for r in rows]`
- `get_property_def`'s builtin branch becomes `return _builtin_def(user_id, property_id, conn)`
- in `set_note_properties`, `prop_def = _BUILTIN_BY_ID[property_id]` becomes `prop_def = _builtin_def(user_id, property_id, conn)`

In `note_templates.py` `_still_valid_properties`, `prop_def = np._BUILTIN_BY_ID[property_id]` becomes `prop_def = np._builtin_def(user_id, property_id, conn)`.

Remove the two `xfail` marks in `tests/test_note_kinds.py`.

- [ ] **Step 4: Implement the client half**

In `PropertiesSection.jsx` add `import { journalStylesEnabled } from '../../lib/journalStylesFlag'`. Change the `hidden` memo filter to:

```jsx
    () => properties.filter((p) => p.source === 'user_set' && !shown(p)
      // Notebook P1: Kind of note is OFFERED only while journal styles are on; a note that already
      // has one shows it either way (spec P1.7c -- the switch gates creating, never rendering).
      && (p.id !== 'builtin:note_kind' || journalStylesEnabled())),
```

- [ ] **Step 5: Run the tests, including the neighbours a new built-in can move**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python -m pytest tests/test_note_kind_property.py tests/test_note_kinds.py tests/test_journal_two_note_templates_router.py tests/test_journal_two_properties_router.py tests/test_notebook_template_gallery.py tests/test_sample_notebook.py -q > "$TEMP/p1-t5.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
python tools/notebook_contract_fixtures.py --check > "$TEMP/p1-t5-fx.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: pytest all pass. The fixture check exits 0, or names fixtures that changed only because a property-definitions list now carries `builtin:note_kind`. In that case read each named diff. If every change is that one new definition, run `python tools/notebook_contract_fixtures.py` and run the frontend tests that load those files (grep their names under `app/src`). Any other diff is a defect to stop on.

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1/app
npx vitest run src/pages/journal-2-0/components/notebook/PropertiesSection.noteKind.test.jsx src/pages/journal-2-0/components/notebook/PropertiesSection.templateReveal.test.jsx > "$TEMP/p1-t5b.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

- [ ] **Step 6: Mutation-prove the one reader**

Capture `note_properties.py`. Revert just the `set_note_properties` call site to `_BUILTIN_BY_ID[property_id]`. `test_setting_and_rejecting_values` must FAIL (a member kind refused). Restore by captured bytes.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/check_repo_hygiene.py
git add api/services/journal_two/note_properties.py api/services/journal_two/note_templates.py app/src/pages/journal-2-0/components/notebook/PropertiesSection.jsx tests/test_note_kinds.py tests/test_note_kind_property.py app/src/pages/journal-2-0/components/notebook/PropertiesSection.noteKind.test.jsx app/src/pages/journal-2-0/__fixtures__/contract
git commit -F - -- api/services/journal_two/note_properties.py api/services/journal_two/note_templates.py app/src/pages/journal-2-0/components/notebook/PropertiesSection.jsx tests/test_note_kinds.py tests/test_note_kind_property.py app/src/pages/journal-2-0/components/notebook/PropertiesSection.noteKind.test.jsx app/src/pages/journal-2-0/__fixtures__/contract <<'MSG'
feat(notebook): builtin:note_kind property over the member's kinds (always rendered, offered only while styles are on)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 6: The styles store — `j2_journal_styles`, versions, defaults, soft delete, built-in styles, the block catalog

Rests on Task 1 §a: `blocks_json[].block` is a widget id.

**Files:**
- Modify: `api/services/journal_two/journal_styles.py`
- Create: `app/src/pages/journal-2-0/lib/journalBlocks.js`
- Modify: `api/services/journal_two/db.py` (`_PHASE_2_ALTERS`, after Task 4's rows)
- Modify: `api/services/journal_two/notes.py` (`_row_to_note`, after the `"propertiesJson"` entry `:1416-1418`)
- Modify: `api/services/journal_two/account_purge.py`, `docs/account-deletion-manifest.md`
- Test: `tests/test_journal_styles_store.py` (new)

**Interfaces:**
- Produces (server, `journal_styles`):
  - `BLOCK_KINDS: tuple[dict, ...]` = `({"id": "chart", "settings": ({"key": "tf", "options": ("D", "W", "60", "15", "5"), "default": "D"},)},)`
  - `KNOWN_BLOCKS: frozenset[str]`
  - `BUILTIN_STYLES: dict[str, dict]`, keyed by kind id; each `{"name", "version", "outline", "blocks", "properties"}`
  - `builtin_style_id(kind_id) -> str` (`"builtin:<kind>"`)
  - `class StyleValidationError(ValueError)`, `class StyleNotFound(LookupError)`
  - `list_styles(user_id, conn=None) -> list[dict]`
  - `get_style(user_id, style_id, conn=None, *, full=True, include_deleted=False) -> dict | None`
  - `create_style(user_id, payload, conn=None) -> dict`
  - `create_style_from_note(user_id, note_id, name, kind_id=None, conn=None) -> dict | None`
  - `update_style(user_id, style_id, patch, conn=None) -> dict | None`
  - `delete_style(user_id, style_id, conn=None) -> dict | None`
  - `restore_style(user_id, style_id, conn=None) -> dict | None`
  - `set_default(user_id, style_id, conn=None) -> dict | None`
  - `default_style_for_kind(user_id, kind_id, conn) -> dict`
- Style dict (summary): `{"id", "name", "kindId", "builtin", "isDefault", "version", "outlineTemplateId", "hasOutline", "blocks": [{"block", "enabled", "settings"}], "properties", "sourceGalleryId", "sourceVersion", "createdAt", "updatedAt", "deletedAt"}`. `full=True` adds `"outlineBodyJson"`.
- Produces (client): `BLOCK_KINDS` (frozen `[{id, label, settings: [{key, label, options, default}]}]`) and `blockLabel(id) -> string`, from `J/lib/journalBlocks.js`. The file has NO imports.
- Produces (notes): `_row_to_note` gains `"styleId"`, `"styleVersion"`, `"kindId"` (each `None` when absent).

- [ ] **Step 1: Write the failing tests**

`tests/test_journal_styles_store.py`:

```python
"""The journal-styles store (spec P1.2). ⛔ ONE FACT IN TWO FILES: journal_styles.BLOCK_KINDS <->
app/src/pages/journal-2-0/lib/journalBlocks.js, pinned by importing the JS through Node."""
from __future__ import annotations

import importlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

CLIENT = Path("app/src/pages/journal-2-0/lib/journalBlocks.js")


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


def _client_blocks():
    node = shutil.which("node")
    assert node, "node is not on PATH"
    js = (f"import({json.dumps(CLIENT.resolve().as_uri())}).then((m) => "
          "process.stdout.write(JSON.stringify(m.BLOCK_KINDS)))")
    r = subprocess.run([node, "--input-type=module", "-e", js], capture_output=True, timeout=120)
    assert r.returncode == 0, (r.stderr or b"").decode("utf-8", "replace")[:2000]
    return json.loads(r.stdout.decode("utf-8"))


def test_the_client_block_catalog_equals_the_server_catalog():
    from api.services.journal_two import journal_styles as js
    client = _client_blocks()
    assert client                                                        # non-vacuity
    shape = lambda kinds: [(k["id"], [(s["key"], list(s["options"]), s["default"]) for s in k["settings"]])
                           for k in kinds]
    assert shape(client) == shape(js.BLOCK_KINDS)


def test_every_builtin_kind_has_a_builtin_style_and_its_blocks_are_known():
    from api.services.journal_two import journal_styles as js, note_kinds as nk
    assert set(js.BUILTIN_STYLES) == nk.BUILTIN_KIND_IDS
    for kind, s in js.BUILTIN_STYLES.items():
        assert s["outline"]["type"] == "doc" and s["version"] >= 1
        assert all(b["block"] in js.KNOWN_BLOCKS for b in s["blocks"]), kind


def _make(user="u1", **kw):
    from api.services.journal_two import journal_styles as js
    body = {"name": "My plan", "kindId": "trade_plan",
            "outlineBodyJson": {"type": "doc", "content": [{"type": "heading", "attrs": {"level": 2},
                                "content": [{"type": "text", "text": "Setup"}]}]},
            "blocks": [{"block": "chart", "enabled": True, "settings": {"tf": "W"}}], **kw}
    return js.create_style(user, body)


def test_create_list_get_and_owner_scope(db_path):
    from api.services.journal_two import journal_styles as js
    s = _make()
    assert s["version"] == 1 and s["builtin"] is False and s["blocks"][0]["settings"] == {"tf": "W"}
    ids = [x["id"] for x in js.list_styles("u1")]
    assert s["id"] in ids and "builtin:trade_plan" in ids
    assert js.get_style("u2", s["id"]) is None
    assert js.get_style("u1", s["id"])["outlineBodyJson"]["content"][0]["type"] == "heading"


def test_validation(db_path):
    from api.services.journal_two import journal_styles as js
    with pytest.raises(js.StyleValidationError):
        _make(name="  ")
    with pytest.raises(js.StyleValidationError):
        _make(kindId="nope")
    with pytest.raises(js.StyleValidationError):
        _make(blocks=[{"block": "chart", "enabled": True, "settings": {"tf": "2H"}}])
    with pytest.raises(js.StyleValidationError):
        _make(blocks=[{"block": "chart", "enabled": True, "settings": {}},
                      {"block": "chart", "enabled": False, "settings": {}}])
    with pytest.raises(js.StyleValidationError):
        _make(properties={"builtin:note_kind": "thesis"})                # the kind comes from kindId


def test_an_unknown_block_kind_is_kept_verbatim(db_path):
    s = _make(blocks=[{"block": "checklistFromTheFuture", "enabled": True, "settings": {"x": 1}}])
    assert s["blocks"] == [{"block": "checklistFromTheFuture", "enabled": True, "settings": {"x": 1}}]


def test_content_edits_bump_the_version_and_a_rename_does_not(db_path):
    from api.services.journal_two import journal_styles as js
    s = _make()
    assert js.update_style("u1", s["id"], {"name": "Renamed"})["version"] == 1
    assert js.update_style("u1", s["id"], {"blocks": []})["version"] == 2
    assert js.update_style("u1", s["id"], {"properties": {"builtin:confidence": "high"}})["version"] == 3


def test_one_default_per_kind_and_builtin_as_default(db_path):
    from api.services.journal_two import journal_styles as js
    a, b = _make(name="A"), _make(name="B")
    js.set_default("u1", a["id"])
    js.set_default("u1", b["id"])
    defaults = [s["id"] for s in js.list_styles("u1") if s["isDefault"] and s["kindId"] == "trade_plan"]
    assert defaults == [b["id"]]
    js.set_default("u1", "builtin:trade_plan")
    defaults = [s["id"] for s in js.list_styles("u1") if s["isDefault"] and s["kindId"] == "trade_plan"]
    assert defaults == ["builtin:trade_plan"]


def test_delete_then_restore_keeps_default(db_path):
    from api.services.journal_two import journal_styles as js
    s = _make()
    js.set_default("u1", s["id"])
    assert js.delete_style("u1", s["id"])["deletedAt"]
    assert s["id"] not in [x["id"] for x in js.list_styles("u1")]
    assert js.default_style_for_kind("u1", "trade_plan", None)["id"] == "builtin:trade_plan"
    back = js.restore_style("u1", s["id"])
    assert back["deletedAt"] is None and back["isDefault"] is True


def test_builtins_are_read_only(db_path):
    from api.services.journal_two import journal_styles as js
    with pytest.raises(js.StyleValidationError):
        js.update_style("u1", "builtin:trade_plan", {"name": "x"})
    with pytest.raises(js.StyleValidationError):
        js.delete_style("u1", "builtin:trade_plan")


def test_save_a_notes_setup_as_a_style(db_path):
    from api.services.journal_two import journal_styles as js, notes
    chart = {"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": "chart",
             "params": {"symbol": "NVDA", "tf": "60", "to": 1760000000}}}
    body = {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Setup"}]}, chart,
        {"type": "paragraph", "content": [{"type": "text", "text": "My words"}]}]}
    n = notes.create_note("u1", {"title": "NVDA plan", "bodyJson": body},
                          properties={"builtin:confidence": "high"})
    s = js.create_style_from_note("u1", n["id"], "From my note", "trade_plan")
    full = js.get_style("u1", s["id"])
    assert full["blocks"] == [{"block": "chart", "enabled": True, "settings": {"tf": "60"}}]
    texts = [c.get("content", [{}])[0].get("text") for c in full["outlineBodyJson"]["content"]]
    assert "{{block:chart}}" in texts and "My words" in texts
    assert full["properties"] == {"builtin:confidence": "high"}
    assert js.create_style_from_note("u2", n["id"], "x") is None          # not their note


def test_note_carries_style_keys(db_path):
    from api.services.journal_two import notes
    n = notes.create_note("u1", {"title": "x"})
    assert (n["styleId"], n["styleVersion"], n["kindId"]) == (None, None, None)
```

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python -m pytest tests/test_journal_styles_store.py -q
```

Expected: FAIL.

- [ ] **Step 3: Implement the client catalog**

`app/src/pages/journal-2-0/lib/journalBlocks.js`:

```js
// The blocks a journal style can switch on (spec P1.1/P1.2). A block id IS a widget id: a block
// is a widgetEmbed node with that widgetId (docs/notebook/p1-verify-before-building.md §a). P1 can
// build one block, the chart; P2 adds rows here AND in journal_styles.BLOCK_KINDS (with a builder).
// ⛔ ONE FACT IN TWO FILES, pinned by tests/test_journal_styles_store.py through Node. NO IMPORTS.
export const BLOCK_KINDS = Object.freeze([
  Object.freeze({
    id: 'chart',
    label: 'Chart of the note’s ticker',
    settings: Object.freeze([
      Object.freeze({ key: 'tf', label: 'Timeframe', options: Object.freeze(['D', 'W', '60', '15', '5']), default: 'D' }),
    ]),
  }),
])

const TF_WORDS = { D: 'Daily', W: 'Weekly', 60: '1 hour', 15: '15 minutes', 5: '5 minutes' }
export const tfWord = (tf) => TF_WORDS[tf] || String(tf)

/** A block's member-facing name; an id this bundle does not know reads as a newer-version block. */
export function blockLabel(id) {
  const k = BLOCK_KINDS.find((b) => b.id === id)
  return k ? k.label : `A block from a newer version (${id})`
}
```

- [ ] **Step 4: Implement the server store**

Append to `journal_styles.py` (below `enabled()`):

```python
import copy
import json
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import note_kinds

MAX_STYLES_PER_MEMBER = 200
MAX_STYLE_NAME_CHARS = 80
MAX_BLOCKS = 30
MAX_UNKNOWN_SETTINGS_BYTES = 4096
BLOCK_ID_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]{0,40}$")
BUILTIN_PREFIX = "builtin:"

# ⛔ ONE FACT IN TWO FILES with app/src/pages/journal-2-0/lib/journalBlocks.js (ids, settings keys,
# options, defaults). A block id IS a widget id. P2 adds a row here, the client row, and a builder.
BLOCK_KINDS: tuple[dict, ...] = (
    {"id": "chart", "settings": ({"key": "tf", "options": ("D", "W", "60", "15", "5"), "default": "D"},)},
)
KNOWN_BLOCKS = frozenset(k["id"] for k in BLOCK_KINDS)
_BLOCK_BY_ID = {k["id"]: k for k in BLOCK_KINDS}


class StyleValidationError(ValueError):
    pass


class StyleNotFound(LookupError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _h(text: str) -> dict:
    return {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": text}]}


def _p(text: str = "") -> dict:
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]} if text else {"type": "paragraph"}


def _ph(block: str) -> dict:
    return _p("{{block:%s}}" % block)


def _chart(tf: str = "D") -> dict:
    return {"block": "chart", "enabled": True, "settings": {"tf": tf}}


def _doc(*nodes: dict) -> dict:
    return {"type": "doc", "content": list(nodes)}


# One built-in style per built-in kind. Versions are bumped BY HAND when an outline here changes,
# which is what offers "update layout" to notes made from the older one.
BUILTIN_STYLES: dict[str, dict] = {
    "trade_plan": {"name": "Trade plan", "version": 1, "properties": {}, "blocks": [_chart("D")], "outline": _doc(
        _h("The setup"), _p("What is the pattern, and why now?"), _ph("chart"),
        _h("Entry, stop and target"), _p("Entry:"), _p("Stop:"), _p("Target:"),
        _h("Size and risk"), _p("How much am I risking, and is it within my rules?"))},
    "daily_prep": {"name": "Daily prep", "version": 1, "properties": {}, "blocks": [], "outline": _doc(
        _h("The market"), _p("What is the tape telling me today?"),
        _h("Names on my list"), _p("Which setups are closest to a trigger?"),
        _h("My plan"), _p("What will I do, and what will I not do?"))},
    "weekend_prep": {"name": "Weekend prep", "version": 1, "properties": {}, "blocks": [], "outline": _doc(
        _h("The week behind"), _p("What worked and what did not?"),
        _h("Leading groups"), _p("Where is the strength?"),
        _h("Next week's list"), _p("Which names, at which levels?"))},
    "earnings": {"name": "Earnings", "version": 1, "properties": {}, "blocks": [_chart("D")], "outline": _doc(
        _h("What the market expects"), _p("Consensus, and the move the options price in:"), _ph("chart"),
        _h("My view"), _p("What would surprise the market?"),
        _h("The plan around the report"), _p("Hold, trim, or wait?"))},
    "post_trade_review": {"name": "Post-trade review", "version": 1, "properties": {}, "blocks": [_chart("D")],
                          "outline": _doc(
        _h("What happened"), _p("Entry, exit and result:"), _ph("chart"),
        _h("Did I follow my plan?"), _p("Where did I follow it, and where did I not?"),
        _h("What I'd do differently"), _p())},
    "weekly_review": {"name": "Weekly review", "version": 1, "properties": {}, "blocks": [], "outline": _doc(
        _h("The numbers"), _p("Trades, wins, losses and the result:"),
        _h("Best and worst trade"), _p(), _h("One thing to change"), _p())},
    "thesis": {"name": "Thesis", "version": 1, "properties": {}, "blocks": [_chart("W")], "outline": _doc(
        _h("The thesis"), _p("Why will this stock go up (or down)?"), _ph("chart"),
        _h("What would prove me wrong"), _p(), _h("Catalysts"), _p())},
    "watchlist_note": {"name": "Watchlist note", "version": 1, "properties": {}, "blocks": [_chart("D")],
                       "outline": _doc(_h("Why it is on my list"), _p(), _ph("chart"),
                                       _h("The level I am waiting for"), _p())},
}


def builtin_style_id(kind_id: str) -> str:
    return BUILTIN_PREFIX + kind_id


def _member_default(user_id: str, kind_id: str, conn: sqlite3.Connection) -> str | None:
    r = conn.execute("SELECT id FROM j2_journal_styles WHERE user_id = ? AND kind_id = ? AND is_default = 1"
                     " AND deleted_at IS NULL", (user_id, kind_id)).fetchone()
    return r["id"] if r else None


def _builtin(user_id: str, kind_id: str, conn: sqlite3.Connection, *, full: bool) -> dict:
    s = BUILTIN_STYLES[kind_id]
    out = {"id": builtin_style_id(kind_id), "name": s["name"], "kindId": kind_id, "builtin": True,
           "isDefault": _member_default(user_id, kind_id, conn) is None, "version": s["version"],
           "outlineTemplateId": None, "hasOutline": True, "blocks": copy.deepcopy(s["blocks"]),
           "properties": dict(s["properties"]), "sourceGalleryId": None, "sourceVersion": None,
           "createdAt": None, "updatedAt": None, "deletedAt": None}
    if full:
        out["outlineBodyJson"] = copy.deepcopy(s["outline"])
    return out


def _row(r: sqlite3.Row, *, full: bool) -> dict:
    body = json.loads(r["outline_body_json"]) if r["outline_body_json"] else None
    out = {"id": r["id"], "name": r["name"], "kindId": r["kind_id"], "builtin": False,
           "isDefault": bool(r["is_default"]), "version": r["version"],
           "outlineTemplateId": r["outline_template_id"], "hasOutline": bool(body or r["outline_template_id"]),
           "blocks": json.loads(r["blocks_json"] or "[]"), "properties": json.loads(r["properties_json"] or "{}"),
           "sourceGalleryId": r["source_gallery_id"], "sourceVersion": r["source_version"],
           "createdAt": r["created_at"], "updatedAt": r["updated_at"], "deletedAt": r["deleted_at"]}
    if full:
        out["outlineBodyJson"] = body
    return out


def _clean_name(raw: Any) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise StyleValidationError("A journal style needs a name.")
    name = " ".join(raw.split())
    if len(name) > MAX_STYLE_NAME_CHARS:
        raise StyleValidationError(f"A style's name can be at most {MAX_STYLE_NAME_CHARS} characters.")
    return name


def _clean_kind(user_id: str, raw: Any, conn: sqlite3.Connection) -> str:
    if note_kinds.get_kind(user_id, raw, conn) is None:
        raise StyleValidationError("Choose a kind of note for this style.")
    return raw


def _clean_template(user_id: str, raw: Any, conn: sqlite3.Connection) -> str | None:
    if raw in (None, ""):
        return None
    if not isinstance(raw, str) or conn.execute(
            "SELECT 1 FROM j2_note_templates WHERE id = ? AND user_id = ?", (raw, user_id)).fetchone() is None:
        raise StyleValidationError("That outline is not one of your templates.")
    return raw


def _clean_outline(raw: Any) -> dict | None:
    if raw is None:
        return None
    from api.services.journal_two import notes as notes_service
    try:
        return notes_service._validate_body_json(raw)
    except notes_service.NoteValidationError as e:
        raise StyleValidationError(f"The outline could not be saved: {e}") from e


def _clean_blocks(raw: Any) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_BLOCKS:
        raise StyleValidationError(f"A style can hold up to {MAX_BLOCKS} blocks.")
    out, seen = [], set()
    for b in raw:
        if not isinstance(b, dict) or not isinstance(b.get("block"), str) or not BLOCK_ID_RE.match(b["block"]):
            raise StyleValidationError("Each block needs a valid block id.")
        bid = b["block"]
        if bid in seen:
            raise StyleValidationError("A style can hold each block once.")
        seen.add(bid)
        settings = b.get("settings") if b.get("settings") is not None else {}
        if not isinstance(settings, dict):
            raise StyleValidationError("A block's settings must be an object.")
        kind = _BLOCK_BY_ID.get(bid)
        if kind is None:
            if len(json.dumps(settings)) > MAX_UNKNOWN_SETTINGS_BYTES:
                raise StyleValidationError("That block's settings are too large.")
            clean = settings                                     # a newer version's block: kept verbatim
        else:
            allowed = {s["key"]: s for s in kind["settings"]}
            clean = {}
            for k, v in settings.items():
                spec = allowed.get(k)
                if spec is None or v not in spec["options"]:
                    raise StyleValidationError(f"{k} is not a setting this block accepts.")
                clean[k] = v
        out.append({"block": bid, "enabled": bool(b.get("enabled", True)), "settings": clean})
    return out


def _clean_properties(user_id: str, raw: Any, conn: sqlite3.Connection) -> dict:
    from api.services.journal_two import note_properties as np
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise StyleValidationError("properties must be an object")
    out = {}
    for pid, value in raw.items():
        if pid == note_kinds.NOTE_KIND_PROPERTY:
            raise StyleValidationError("A style's kind of note is set by the kind you choose.")
        if np.is_builtin_property_id(pid) and pid not in np.BUILTIN_USER_SET_IDS:
            raise StyleValidationError(f"{pid} is not a property a style can fill.")
        d = np.get_property_def(user_id, pid, conn=conn)
        if d is None or d.get("computed"):
            raise StyleValidationError(f"Unknown property: {pid}")
        try:
            v = np.validate_property_value(d, value)
        except np.PropertyValidationError as e:
            raise StyleValidationError(str(e)) from e
        if v is not None:
            out[pid] = v
    return out


def _load_row(user_id: str, style_id: str, conn: sqlite3.Connection, *, include_deleted=False):
    sql = "SELECT * FROM j2_journal_styles WHERE id = ? AND user_id = ?"
    if not include_deleted:
        sql += " AND deleted_at IS NULL"
    return conn.execute(sql, (style_id, user_id)).fetchone()


def get_style(user_id: str, style_id: Any, conn: sqlite3.Connection | None = None, *,
              full: bool = True, include_deleted: bool = False) -> dict | None:
    if not isinstance(style_id, str):
        return None
    owned = conn is None
    conn = conn or get_connection()
    try:
        if style_id.startswith(BUILTIN_PREFIX):
            kind = style_id[len(BUILTIN_PREFIX):]
            return _builtin(user_id, kind, conn, full=full) if kind in BUILTIN_STYLES else None
        r = _load_row(user_id, style_id, conn, include_deleted=include_deleted)
        return _row(r, full=full) if r else None
    finally:
        if owned:
            conn.close()


def list_styles(user_id: str, conn: sqlite3.Connection | None = None) -> list[dict]:
    """Built-in styles (in built-in kind order), then the member's live styles, oldest first."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        out = [_builtin(user_id, k["id"], conn, full=False) for k in note_kinds.BUILTIN_NOTE_KINDS]
        rows = conn.execute("SELECT * FROM j2_journal_styles WHERE user_id = ? AND deleted_at IS NULL"
                            " ORDER BY created_at, rowid", (user_id,)).fetchall()
        return out + [_row(r, full=False) for r in rows]
    finally:
        if owned:
            conn.close()


def create_style(user_id: str, payload: Any, conn: sqlite3.Connection | None = None) -> dict:
    if not isinstance(payload, dict):
        raise StyleValidationError("Send a style object.")
    owned = conn is None
    conn = conn or get_connection()
    try:
        name = _clean_name(payload.get("name"))
        kind = _clean_kind(user_id, payload.get("kindId"), conn)
        tpl = _clean_template(user_id, payload.get("outlineTemplateId"), conn)
        outline = _clean_outline(payload.get("outlineBodyJson"))
        blocks = _clean_blocks(payload.get("blocks"))
        props = _clean_properties(user_id, payload.get("properties"), conn)
        n = conn.execute("SELECT COUNT(*) AS c FROM j2_journal_styles WHERE user_id = ? AND deleted_at IS NULL",
                         (user_id,)).fetchone()["c"]
        if n >= MAX_STYLES_PER_MEMBER:
            raise StyleValidationError(f"You can keep up to {MAX_STYLES_PER_MEMBER} styles. Delete one first.")
        sid, now = uuid.uuid4().hex, _now()
        conn.execute(
            "INSERT INTO j2_journal_styles (id, user_id, name, kind_id, outline_template_id, outline_body_json,"
            " blocks_json, properties_json, is_default, source_gallery_id, source_version, version,"
            " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 1, ?, ?)",
            (sid, user_id, name, kind, tpl, json.dumps(outline) if outline else None,
             json.dumps(blocks), json.dumps(props), now, now))
        conn.commit()
        return get_style(user_id, sid, conn)
    finally:
        if owned:
            conn.close()


_CONTENT_KEYS = {"kindId": "kind_id", "outlineTemplateId": "outline_template_id",
                 "outlineBodyJson": "outline_body_json", "blocks": "blocks_json", "properties": "properties_json"}


def update_style(user_id: str, style_id: str, patch: Any, conn: sqlite3.Connection | None = None) -> dict | None:
    if isinstance(style_id, str) and style_id.startswith(BUILTIN_PREFIX):
        raise StyleValidationError("Built-in styles can't be changed. Duplicate it to make your own.")
    if not isinstance(patch, dict):
        raise StyleValidationError("Send a style object.")
    owned = conn is None
    conn = conn or get_connection()
    try:
        r = _load_row(user_id, style_id, conn)
        if r is None:
            return None
        sets, params, content_changed = [], [], False
        if "name" in patch:
            sets.append("name = ?"); params.append(_clean_name(patch["name"]))
        cleaned = {}
        if "kindId" in patch:
            cleaned["kindId"] = _clean_kind(user_id, patch["kindId"], conn)
        if "outlineTemplateId" in patch:
            cleaned["outlineTemplateId"] = _clean_template(user_id, patch["outlineTemplateId"], conn)
        if "outlineBodyJson" in patch:
            o = _clean_outline(patch["outlineBodyJson"])
            cleaned["outlineBodyJson"] = json.dumps(o) if o else None
        if "blocks" in patch:
            cleaned["blocks"] = json.dumps(_clean_blocks(patch["blocks"]))
        if "properties" in patch:
            cleaned["properties"] = json.dumps(_clean_properties(user_id, patch["properties"], conn))
        for key, value in cleaned.items():
            col = _CONTENT_KEYS[key]
            if r[col] != value:
                content_changed = True
            sets.append(f"{col} = ?"); params.append(value)
        if "kindId" in cleaned and cleaned["kindId"] != r["kind_id"]:
            sets.append("is_default = 0")                       # a default belongs to its old kind
        if content_changed:
            sets.append("version = version + 1")
        if not sets:
            return _row(r, full=True)
        sets.append("updated_at = ?"); params.append(_now())
        conn.execute(f"UPDATE j2_journal_styles SET {', '.join(sets)} WHERE id = ? AND user_id = ?",
                     (*params, style_id, user_id))
        conn.commit()
        return get_style(user_id, style_id, conn)
    finally:
        if owned:
            conn.close()


def set_default(user_id: str, style_id: str, conn: sqlite3.Connection | None = None) -> dict | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        s = get_style(user_id, style_id, conn, full=False)
        if s is None:
            return None
        conn.execute("UPDATE j2_journal_styles SET is_default = 0 WHERE user_id = ? AND kind_id = ?"
                     " AND is_default = 1", (user_id, s["kindId"]))
        if not s["builtin"]:
            conn.execute("UPDATE j2_journal_styles SET is_default = 1 WHERE id = ? AND user_id = ?",
                         (style_id, user_id))
        conn.commit()
        return get_style(user_id, style_id, conn)
    finally:
        if owned:
            conn.close()


def delete_style(user_id: str, style_id: str, conn: sqlite3.Connection | None = None) -> dict | None:
    """Soft delete (spec P1.4: with undo). Remembers whether it was the default, for restore."""
    if isinstance(style_id, str) and style_id.startswith(BUILTIN_PREFIX):
        raise StyleValidationError("Built-in styles can't be deleted.")
    owned = conn is None
    conn = conn or get_connection()
    try:
        r = _load_row(user_id, style_id, conn)
        if r is None:
            return None
        now = _now()
        conn.execute("UPDATE j2_journal_styles SET deleted_at = ?, default_before_delete = is_default,"
                     " is_default = 0, updated_at = ? WHERE id = ? AND user_id = ?", (now, now, style_id, user_id))
        conn.commit()
        return get_style(user_id, style_id, conn, include_deleted=True)
    finally:
        if owned:
            conn.close()


def restore_style(user_id: str, style_id: str, conn: sqlite3.Connection | None = None) -> dict | None:
    """Undo a delete. The default comes back only when no other style became the default meanwhile."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        r = _load_row(user_id, style_id, conn, include_deleted=True)
        if r is None or r["deleted_at"] is None:
            return get_style(user_id, style_id, conn) if r else None
        again = bool(r["default_before_delete"]) and _member_default(user_id, r["kind_id"], conn) is None
        conn.execute("UPDATE j2_journal_styles SET deleted_at = NULL, is_default = ?, default_before_delete = 0,"
                     " updated_at = ? WHERE id = ? AND user_id = ?", (1 if again else 0, _now(), style_id, user_id))
        conn.commit()
        return get_style(user_id, style_id, conn)
    finally:
        if owned:
            conn.close()


def default_style_for_kind(user_id: str, kind_id: str, conn: sqlite3.Connection | None) -> dict:
    """The member's default for the kind, else the built-in style, else a BLANK style (a member's
    own kind with no style): no outline, no blocks, and `id` None, so a note records only its kind."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        mine = _member_default(user_id, kind_id, conn)
        if mine:
            return get_style(user_id, mine, conn)
        if kind_id in BUILTIN_STYLES:
            return _builtin(user_id, kind_id, conn, full=True)
        return {"id": None, "name": "", "kindId": kind_id, "builtin": False, "isDefault": False, "version": None,
                "outlineTemplateId": None, "hasOutline": False, "blocks": [], "properties": {},
                "outlineBodyJson": None}
    finally:
        if owned:
            conn.close()


def create_style_from_note(user_id: str, note_id: str, name: Any, kind_id: Any = None,
                           conn: sqlite3.Connection | None = None) -> dict | None:
    """"Save this note's setup as a style" (spec P1.4). The SERVER reads the note: every block node
    becomes a block (with its settings) and a {{block:id}} placeholder where it stood; the rest of
    the body is the outline; the note's user-set property values (not its kind) are the defaults."""
    from api.services.journal_two import notes as notes_service
    owned = conn is None
    conn = conn or get_connection()
    try:
        note = notes_service.get_note(user_id, note_id, conn=conn)
        if note is None:
            return None
        blocks, seen = [], set()

        def strip(content: list) -> list:
            out = []
            for node in content:
                if isinstance(node, dict) and node.get("type") == "widgetEmbed":
                    bid = (node.get("attrs") or {}).get("widgetId")
                    if isinstance(bid, str) and BLOCK_ID_RE.match(bid) and bid not in seen and bid in KNOWN_BLOCKS:
                        seen.add(bid)
                        params = (node.get("attrs") or {}).get("params") or {}
                        spec = {s["key"]: s for s in _BLOCK_BY_ID[bid]["settings"]}
                        settings = {k: params[k] for k in spec if params.get(k) in spec[k]["options"]}
                        blocks.append({"block": bid, "enabled": True, "settings": settings})
                        out.append(_ph(bid))
                    continue                                    # every embed leaves the outline
                if isinstance(node, dict) and isinstance(node.get("content"), list):
                    node = {**node, "content": strip(node["content"])}
                out.append(node)
            return out

        outline = {"type": "doc", "content": strip((note.get("bodyJson") or {}).get("content") or [])}
        props = {k: v for k, v in (note.get("propertiesJson") or {}).items() if k != note_kinds.NOTE_KIND_PROPERTY}
        kind = kind_id or (note.get("propertiesJson") or {}).get(note_kinds.NOTE_KIND_PROPERTY) or note.get("kindId")
        return create_style(user_id, {"name": name if name else (note.get("title") or "My style"),
                                      "kindId": kind, "outlineBodyJson": outline, "blocks": blocks,
                                      "properties": props}, conn)
    finally:
        if owned:
            conn.close()
```

In `db.py` `_PHASE_2_ALTERS`, after Task 4's rows, add:

```python
    # Notebook P1 (journal styles, journal_styles.py): a member's styles. `blocks_json` is an ordered
    # list of {block, enabled, settings} where `block` IS a widget id; `version` bumps on every
    # content edit (outline, blocks, properties, kind) so notes made earlier can be offered an
    # update. Soft delete with undo (`deleted_at`, `default_before_delete`). ⛔ user-scoped: purged
    # with the account (account_purge._DIRECT_USER_TABLES).
    """CREATE TABLE IF NOT EXISTS j2_journal_styles (
        id                    TEXT PRIMARY KEY,
        user_id               TEXT NOT NULL,
        name                  TEXT NOT NULL,
        kind_id               TEXT NOT NULL,
        outline_template_id   TEXT,
        outline_body_json     TEXT,
        blocks_json           TEXT NOT NULL DEFAULT '[]',
        properties_json       TEXT NOT NULL DEFAULT '{}',
        is_default            INTEGER NOT NULL DEFAULT 0,
        default_before_delete INTEGER NOT NULL DEFAULT 0,
        source_gallery_id     TEXT,
        source_version        INTEGER,
        version               INTEGER NOT NULL DEFAULT 1,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL,
        deleted_at            TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_j2_journal_styles_user ON j2_journal_styles(user_id, deleted_at, created_at)",
    # ⛔ ONE default per (member, kind) is the INDEX's job, not a check's (the daily-note precedent).
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_j2_journal_styles_default"
    " ON j2_journal_styles(user_id, kind_id) WHERE is_default = 1 AND deleted_at IS NULL",
    # Notebook P1: what made a note -- additive, NULL for every existing note, read as optional.
    # `kind_id` is PROVENANCE (the kind it was created as); the CURRENT kind is the
    # builtin:note_kind property (note_kinds.py docstring).
    "ALTER TABLE j2_notes ADD COLUMN style_id TEXT",
    "ALTER TABLE j2_notes ADD COLUMN style_version INTEGER",
    "ALTER TABLE j2_notes ADD COLUMN kind_id TEXT",
```

In `notes.py` `_row_to_note`, after the `"propertiesJson": (...)` entry, add:

```python
        # Notebook P1 (journal styles): what made this note. None for every note made otherwise.
        "styleId": row["style_id"] if "style_id" in row.keys() else None,
        "styleVersion": row["style_version"] if "style_version" in row.keys() else None,
        "kindId": row["kind_id"] if "kind_id" in row.keys() else None,
```

In `account_purge.py`, after Task 4's `"j2_note_kinds",`, add `"j2_journal_styles",` with the comment `# Notebook P1: a member's journal styles (journal_styles.py).`. Then run `python tools/account_deletion_manifest.py --write`.

- [ ] **Step 5: Run the tests**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python -m pytest tests/test_journal_styles_store.py tests/test_note_kinds.py tests/test_account_deletion_manifest.py tests/test_notes_answer_is_the_committed_row.py -q > "$TEMP/p1-t6.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass.

- [ ] **Step 6: Mutation-prove two rails**

1. Capture `journalBlocks.js` and change `'60'` to `'1H'`. The catalog rail must FAIL. Restore.
2. Capture `db.py` and delete the `idx_j2_journal_styles_default` statement. Then add a store test that inserts two `is_default = 1` rows for one kind directly. The insert must raise `sqlite3.IntegrityError`. Write this test as `test_the_index_refuses_two_defaults` in the same file; it is green with the index and red without it. Restore.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/check_repo_hygiene.py
git add api/services/journal_two/journal_styles.py app/src/pages/journal-2-0/lib/journalBlocks.js api/services/journal_two/db.py api/services/journal_two/notes.py api/services/journal_two/account_purge.py docs/account-deletion-manifest.md tests/test_journal_styles_store.py
git commit -F - -- api/services/journal_two/journal_styles.py app/src/pages/journal-2-0/lib/journalBlocks.js api/services/journal_two/db.py api/services/journal_two/notes.py api/services/journal_two/account_purge.py docs/account-deletion-manifest.md tests/test_journal_styles_store.py <<'MSG'
feat(notebook): journal styles store (versions, one default per kind, soft delete, built-in styles, block catalog rail)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 7: The composer — outline → blocks at placeholders or after the first heading → property defaults

Rests on Task 1 §a. One composer, used by styled create (Task 9), preview (Task 8) and update layout (Task 10).

**Files:**
- Modify: `api/services/journal_two/journal_styles.py`
- Modify: `api/services/journal_two/notes.py` (`create_note`: new kwarg `style_stamp`; INSERT `:3302-3315`)
- Test: `tests/test_journal_styles_compose.py` (new)

**Interfaces:**
- Consumes: Task 6's store; `notes.create_note`.
- Produces:
  - `PLACEHOLDER_RE` (`^\{\{block:([a-zA-Z][a-zA-Z0-9_]{0,40})\}\}$`)
  - `BLOCK_BUILDERS: dict[str, Callable[[dict, dict], tuple[dict | None, str | None]]]`, where builder `(block, ctx) -> (node | None, reason | None)` and `ctx = {"ticker": str | None, "now": datetime}`
  - `SKIP_SENTENCES: dict[str, str]`
  - `compose(user_id, style, *, ticker, conn, now=None) -> dict` returning `{"bodyJson", "properties", "skipped", "styleId", "styleVersion", "kindId"}`
  - `latest_ticker(user_id, conn) -> str | None`
  - `preview(user_id, payload, conn=None) -> dict` returning `{"bodyJson", "properties", "skipped", "ticker", "tickerSource"}`
- Produces (notes): `create_note(..., style_stamp: tuple[str | None, int | None, str] | None = None)`, written in the same INSERT (internal, never read from the payload).

- [ ] **Step 1: Write the failing tests**

`tests/test_journal_styles_compose.py`:

```python
"""The one composer (spec P1.3): outline body -> block nodes where the outline marks them (a
paragraph that is exactly {{block:<id>}}), the rest after the first heading -> property defaults
-> the kind."""
from __future__ import annotations

import importlib
import os
import tempfile
from datetime import datetime, timezone

import pytest

NOW = datetime(2026, 10, 11, 14, 30, tzinfo=timezone.utc)


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


def _types(doc):
    return [n["type"] for n in doc["content"]]


def _text(node):
    return "".join(c.get("text", "") for c in node.get("content") or [])


def test_builtin_trade_plan_places_the_chart_at_its_placeholder(db_path):
    from api.services.journal_two import journal_styles as js
    s = js.get_style("u1", "builtin:trade_plan")
    out = js.compose("u1", s, ticker="NVDA", conn=None, now=NOW)
    body = out["bodyJson"]
    i = _types(body).index("widgetEmbed")
    assert _text(body["content"][i - 1]) == "What is the pattern, and why now?"
    attrs = body["content"][i]["attrs"]
    assert attrs["widgetId"] == "chart" and attrs["params"] == {"symbol": "NVDA", "tf": "D", "to": int(NOW.timestamp())}
    assert not any("{{block:" in _text(n) for n in body["content"])
    assert out["properties"] == {"builtin:note_kind": "trade_plan"}
    assert (out["styleId"], out["styleVersion"], out["kindId"]) == ("builtin:trade_plan", 1, "trade_plan")


def test_blocks_without_a_placeholder_go_after_the_first_heading(db_path):
    from api.services.journal_two import journal_styles as js
    s = js.create_style("u1", {"name": "x", "kindId": "thesis",
        "outlineBodyJson": {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "intro"}]},
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "H"}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "after"}]}]},
        "blocks": [{"block": "chart", "enabled": True, "settings": {"tf": "W"}}]})
    body = js.compose("u1", js.get_style("u1", s["id"]), ticker="AMD", conn=None, now=NOW)["bodyJson"]
    assert _types(body) == ["paragraph", "heading", "widgetEmbed", "paragraph"]


def test_no_heading_puts_blocks_first_and_disabled_placeholders_vanish(db_path):
    from api.services.journal_two import journal_styles as js
    s = js.create_style("u1", {"name": "x", "kindId": "thesis",
        "outlineBodyJson": {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "{{block:chart}}"}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "words"}]}]},
        "blocks": [{"block": "chart", "enabled": False, "settings": {}}]})
    body = js.compose("u1", js.get_style("u1", s["id"]), ticker="AMD", conn=None, now=NOW)["bodyJson"]
    assert _types(body) == ["paragraph"] and _text(body["content"][0]) == "words"


def test_chart_block_without_ticker_leaves_an_instruction(db_path):
    from api.services.journal_two import journal_styles as js
    out = js.compose("u1", js.get_style("u1", "builtin:thesis"), ticker=None, conn=None, now=NOW)
    assert "widgetEmbed" not in _types(out["bodyJson"])
    assert any(_text(n) == js.SKIP_SENTENCES["needs-ticker"] for n in out["bodyJson"]["content"])
    assert out["skipped"] == [{"block": "chart", "reason": "needs-ticker"}]


def test_an_unknown_block_is_skipped_and_named(db_path):
    from api.services.journal_two import journal_styles as js
    s = js.create_style("u1", {"name": "x", "kindId": "thesis", "outlineBodyJson": {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "{{block:futureThing}}"}]}]},
        "blocks": [{"block": "futureThing", "enabled": True, "settings": {}}]})
    out = js.compose("u1", js.get_style("u1", s["id"]), ticker="AMD", conn=None, now=NOW)
    assert out["skipped"] == [{"block": "futureThing", "reason": "unknown-block"}]
    assert _types(out["bodyJson"]) == ["paragraph"]                     # never an empty doc


def test_compose_falls_back_when_the_linked_template_is_gone(db_path):
    from api.services import auth_db
    from api.services.journal_two import journal_styles as js, note_templates, notes
    n = notes.create_note("u1", {"title": "t", "bodyJson": {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "from template"}]}]}})
    t = note_templates.create_from_note("u1", n["id"])
    s = js.create_style("u1", {"name": "x", "kindId": "thesis", "outlineTemplateId": t["id"],
        "outlineBodyJson": {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "inline"}]}]}})
    assert _text(js.compose("u1", js.get_style("u1", s["id"]), ticker=None, conn=None, now=NOW)["bodyJson"]["content"][0]) == "from template"
    note_templates.delete_template("u1", t["id"])
    assert _text(js.compose("u1", js.get_style("u1", s["id"]), ticker=None, conn=None, now=NOW)["bodyJson"]["content"][0]) == "inline"


def test_property_defaults_drop_a_property_deleted_since(db_path):
    from api.services.journal_two import journal_styles as js, note_properties as np
    p = np.create_property_def("u1", "Setup", "select", [{"label": "VCP"}])
    s = js.create_style("u1", {"name": "x", "kindId": "thesis",
                               "properties": {p["id"]: p["options"][0]["id"], "builtin:confidence": "high"}})
    np.delete_property_def("u1", p["id"])
    out = js.compose("u1", js.get_style("u1", s["id"]), ticker=None, conn=None, now=NOW)
    assert out["properties"] == {"builtin:confidence": "high", "builtin:note_kind": "thesis"}


def test_create_note_writes_the_style_stamp_in_one_insert(db_path):
    from api.services.journal_two import notes
    n = notes.create_note("u1", {"title": "x"}, style_stamp=("builtin:thesis", 1, "thesis"))
    assert (n["styleId"], n["styleVersion"], n["kindId"]) == ("builtin:thesis", 1, "thesis")


def test_preview_uses_the_members_latest_ticker(db_path):
    from api.services.journal_two import journal_styles as js, notes
    notes.create_note("u1", {"title": "x", "ticker": "CRWD"})
    out = js.preview("u1", {"styleId": "builtin:watchlist_note"})
    assert out["ticker"] == "CRWD" and out["tickerSource"] == "latest-note"
    assert any(n["type"] == "widgetEmbed" for n in out["bodyJson"]["content"])
```

`np.delete_property_def(user_id, property_id, conn=None) -> bool` is the module's own delete (`note_properties.py:302`).

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python -m pytest tests/test_journal_styles_compose.py -q
```

Expected: FAIL (`compose` not defined).

- [ ] **Step 3: Implement `style_stamp` on create**

In `notes.create_note`, add the keyword parameter `style_stamp: tuple[str | None, int | None, str] | None = None` after `properties`. Add to the docstring: "`style_stamp` is INTERNAL too (journal styles, P1): `(style_id, style_version, kind_id)` written in the same insert." Change the INSERT to:

```python
        stamp = style_stamp or (None, None, None)
        conn.execute(
            """
            INSERT INTO j2_notes (
                id, user_id, account_id, folder_id, title, subtitle,
                body_json, body_plain, hero_image_url, first_image_url, ticker, tags,
                created_at, updated_at, daily_date, properties_json,
                style_id, style_version, kind_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id, user_id, account_id, folder_id, title, subtitle,
                json.dumps(body_json), body_plain, hero, first_image, ticker,
                json.dumps(tags), now, now, daily_date, properties_json,
                stamp[0], stamp[1], stamp[2],
            ),
        )
```

- [ ] **Step 4: Implement the composer**

Append to `journal_styles.py`:

```python
from typing import Callable

PLACEHOLDER_RE = re.compile(r"^\{\{block:([a-zA-Z][a-zA-Z0-9_]{0,40})\}\}$")
SKIP_SENTENCES = {
    "needs-ticker": "Add a ticker to this note, then type /chart to add the chart.",
}


def _build_chart(block: dict, ctx: dict) -> tuple[dict | None, str | None]:
    """A chart of the note's ticker, frozen at `now` (the frozen-means-anchored rule of
    widgetEmbedCore.buildWidgetEmbedAttrs). No searchText, like sample_examples._chart_embed:
    the client never re-derives it and search does not need it for a fresh chart."""
    ticker = ctx.get("ticker")
    if not ticker:
        return None, "needs-ticker"
    now = ctx["now"]
    tf = (block.get("settings") or {}).get("tf") or "D"
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "chart", "embedId": uuid.uuid4().hex, "mode": "snapshot",
        "params": {"symbol": ticker, "tf": tf, "to": int(now.timestamp())},
        "capturedAt": now.isoformat().replace("+00:00", "Z"),
        "annotations": [], "caption": None, "layout": {"width": "full", "height": None}, "fallback": None,
    }}, None


#: block id -> builder. ⛔ Every id in BLOCK_KINDS has a builder (railed); P2 adds both together.
BLOCK_BUILDERS: dict[str, Callable[[dict, dict], tuple[dict | None, str | None]]] = {"chart": _build_chart}


def _plain(node: Any) -> str:
    return "".join(c.get("text", "") for c in (node.get("content") or [])
                   if isinstance(c, dict) and c.get("type") == "text") if isinstance(node, dict) else ""


def _placeholder_kind(node: Any) -> str | None:
    if not isinstance(node, dict) or node.get("type") != "paragraph":
        return None
    m = PLACEHOLDER_RE.match(_plain(node).strip())
    return m.group(1) if m else None


def _after_first_heading(content: list) -> int:
    for i, n in enumerate(content):
        if isinstance(n, dict) and n.get("type") == "heading":
            return i + 1
    return 0


def _outline_doc(user_id: str, style: dict, conn: sqlite3.Connection) -> dict:
    if style.get("builtin"):
        return copy.deepcopy(BUILTIN_STYLES[style["kindId"]]["outline"])
    tid = style.get("outlineTemplateId")
    if tid:
        r = conn.execute("SELECT body_json FROM j2_note_templates WHERE id = ? AND user_id = ?",
                         (tid, user_id)).fetchone()
        if r and r["body_json"]:
            try:
                body = json.loads(r["body_json"])
                if isinstance(body, dict) and body.get("type") == "doc":
                    return body
            except (TypeError, ValueError):
                pass
    body = style.get("outlineBodyJson")
    if isinstance(body, dict) and body.get("type") == "doc":
        return copy.deepcopy(body)
    return {"type": "doc", "content": []}


def _valid_defaults(user_id: str, raw: dict, conn: sqlite3.Connection) -> dict:
    """The style's property values that still fit a property the member has (note_templates'
    rule): a deleted or changed property is left out, never a failed create."""
    from api.services.journal_two import note_properties as np
    out = {}
    for pid, value in (raw or {}).items():
        if pid == note_kinds.NOTE_KIND_PROPERTY:
            continue
        d = np.get_property_def(user_id, pid, conn=conn)
        if d is None or d.get("computed"):
            continue
        try:
            v = np.validate_property_value(d, value)
        except np.PropertyValidationError:
            continue
        if v is not None:
            out[pid] = v
    return out


def compose(user_id: str, style: dict, *, ticker: str | None, conn: sqlite3.Connection | None,
            now: datetime | None = None) -> dict:
    owned = conn is None
    conn = conn or get_connection()
    try:
        ctx = {"ticker": ticker, "now": now or datetime.now(timezone.utc)}
        doc = _outline_doc(user_id, style, conn)
        enabled: dict[str, dict] = {}
        disabled: set[str] = set()
        for b in style.get("blocks") or []:
            if b.get("enabled"):
                enabled.setdefault(b["block"], b)
            else:
                disabled.add(b["block"])
        skipped: list[dict] = []
        placed: set[str] = set()

        def note_skip(bid: str, reason: str) -> None:
            if {"block": bid, "reason": reason} not in skipped:
                skipped.append({"block": bid, "reason": reason})

        def build(b: dict) -> list[dict]:
            builder = BLOCK_BUILDERS.get(b["block"])
            if builder is None:
                note_skip(b["block"], "unknown-block")
                return []
            node, reason = builder(b, ctx)
            if node is None:
                note_skip(b["block"], reason)
                return [_p(SKIP_SENTENCES[reason])] if reason in SKIP_SENTENCES else []
            return [node]

        def walk(content: list) -> list:
            out = []
            for node in content:
                bid = _placeholder_kind(node)
                if bid is not None:
                    if bid in enabled:
                        out.extend(build(enabled[bid]))
                        placed.add(bid)
                    elif bid not in disabled:
                        note_skip(bid, "unknown-block")
                    continue
                if isinstance(node, dict) and isinstance(node.get("content"), list):
                    node = {**node, "content": walk(node["content"])}
                out.append(node)
            return out

        doc["content"] = walk(doc.get("content") or [])
        rest: list[dict] = []
        for bid, b in enabled.items():
            if bid not in placed:
                rest.extend(build(b))
        if rest:
            i = _after_first_heading(doc["content"])
            doc["content"][i:i] = rest
        if not doc["content"]:
            doc["content"] = [{"type": "paragraph"}]
        props = _valid_defaults(user_id, style.get("properties") or {}, conn)
        props[note_kinds.NOTE_KIND_PROPERTY] = style["kindId"]
        return {"bodyJson": doc, "properties": props, "skipped": skipped,
                "styleId": style.get("id"), "styleVersion": style.get("version"), "kindId": style["kindId"]}
    finally:
        if owned:
            conn.close()


def latest_ticker(user_id: str, conn: sqlite3.Connection) -> str | None:
    r = conn.execute("SELECT ticker FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL AND ticker IS NOT NULL"
                     " AND ticker != '' ORDER BY updated_at DESC, rowid DESC LIMIT 1", (user_id,)).fetchone()
    return r["ticker"] if r else None


def preview(user_id: str, payload: Any, conn: sqlite3.Connection | None = None) -> dict:
    """A read-only compose for the live preview (spec P1.4), with the member's OWN data: their ticker
    (asked for, else their latest note's) and their property definitions. Writes nothing.
    `payload` is {"styleId"} for a saved style, or {"style": {...}} for an unsaved draft."""
    from api.services.journal_two import notes as notes_service
    if not isinstance(payload, dict):
        raise StyleValidationError("Send a style to preview.")
    owned = conn is None
    conn = conn or get_connection()
    try:
        if payload.get("styleId") is not None:
            style = get_style(user_id, payload["styleId"], conn)
            if style is None:
                raise StyleNotFound(payload["styleId"])
        else:
            draft = payload.get("style")
            if not isinstance(draft, dict):
                raise StyleValidationError("Send a style to preview.")
            style = {"id": None, "builtin": False, "version": None, "name": _clean_name(draft.get("name") or "Draft"),
                     "kindId": _clean_kind(user_id, draft.get("kindId"), conn),
                     "outlineTemplateId": _clean_template(user_id, draft.get("outlineTemplateId"), conn),
                     "outlineBodyJson": _clean_outline(draft.get("outlineBodyJson")),
                     "blocks": _clean_blocks(draft.get("blocks")),
                     "properties": _clean_properties(user_id, draft.get("properties"), conn)}
        asked = notes_service._validate_ticker(payload.get("ticker")) if payload.get("ticker") else None
        ticker = asked or latest_ticker(user_id, conn)
        out = compose(user_id, style, ticker=ticker, conn=conn)
        return {"bodyJson": out["bodyJson"], "properties": out["properties"], "skipped": out["skipped"],
                "ticker": ticker, "tickerSource": "asked" if asked else ("latest-note" if ticker else None)}
    finally:
        if owned:
            conn.close()
```

Add to `tests/test_journal_styles_store.py`:

```python
def test_every_catalogued_block_has_a_builder():
    from api.services.journal_two import journal_styles as js
    assert set(js.BLOCK_BUILDERS) == js.KNOWN_BLOCKS
```

- [ ] **Step 5: Run the tests**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python -m pytest tests/test_journal_styles_compose.py tests/test_journal_styles_store.py tests/test_journal_two_note_templates_router.py -q > "$TEMP/p1-t7.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass.

- [ ] **Step 6: Mutation-prove placement**

Capture `journal_styles.py`. In `compose`, replace `i = _after_first_heading(doc["content"])` with `i = len(doc["content"])`. `test_blocks_without_a_placeholder_go_after_the_first_heading` must FAIL. Restore by captured bytes.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/check_repo_hygiene.py
git add api/services/journal_two/journal_styles.py api/services/journal_two/notes.py tests/test_journal_styles_compose.py tests/test_journal_styles_store.py
git commit -F - -- api/services/journal_two/journal_styles.py api/services/journal_two/notes.py tests/test_journal_styles_compose.py tests/test_journal_styles_store.py <<'MSG'
feat(notebook): the one journal-style composer (placeholders, after-first-heading, chart block, defaults) + preview

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 8: The router — styles, kinds, preview, mapping offer — with contract fixtures

**Files:**
- Create: `api/routers/notebook_journal_styles.py`
- Modify: `api/main.py` (import beside `notebook_template_gallery_router` `:117`; `include_router` beside `:9642`)
- Modify: `tools/notebook_contract_fixtures.py` (`FLAGS`, `build_app`, a new `@builder def journal_styles(w)` before `sweeps`)
- Create: `app/src/pages/journal-2-0/__fixtures__/contract/journal-styles.*.json`, `note-kinds.*.json` (generated, never hand-written)
- Test: `tests/test_notebook_journal_styles_router.py` (new)

**Interfaces:**
- Consumes: Tasks 4, 6 and 7 services.
- Produces the routes. All take the router's gate, then a session (401), then the paid plan (402):

| Method + path | Body | 200 answer |
|---|---|---|
| `GET /api/j2/journal-styles` | — | `{"kinds": [...], "styles": [...], "blockKinds": ["chart"]}` |
| `POST /api/j2/journal-styles` | `{name, kindId, outlineTemplateId?, outlineBodyJson?, blocks?, properties?}` or `{fromNoteId, name?, kindId?}` | `{"style": {...full}}` |
| `POST /api/j2/journal-styles/preview` | `{styleId}` or `{style: {...}}`, `ticker?` | `{"bodyJson", "properties", "skipped", "ticker", "tickerSource"}` |
| `GET /api/j2/journal-styles/{style_id}` | — | `{"style": {...full}}` |
| `PUT /api/j2/journal-styles/{style_id}` | patch | `{"style": {...full}}` |
| `DELETE /api/j2/journal-styles/{style_id}` | — | `{"ok": true, "style": {...}}` |
| `POST /api/j2/journal-styles/{style_id}/restore` | — | `{"style": {...full}}` |
| `POST /api/j2/journal-styles/{style_id}/default` | — | `{"style": {...full}}` |
| `GET /api/j2/note-kinds` | — | `{"kinds": [...]}` |
| `POST /api/j2/note-kinds` | `{name, icon?}` | `{"kind": {...}}` |
| `PUT /api/j2/note-kinds/{kind_id}` | `{name?, icon?, sortOrder?}` | `{"kind": {...}}` |
| `DELETE /api/j2/note-kinds/{kind_id}` | — | `{"ok": true}`; 409 `{"detail": "<in use sentence>"}` |
| `GET /api/j2/note-kinds/mapping-offer` | — | `{"offer": {...} \| null}` |
| `POST /api/j2/note-kinds/mapping-offer` | `{excludeNoteIds: [...]}` | `{"notes": [{id, updatedAt}], "count": n}` |

Errors: `StyleValidationError` / `KindValidationError` → 400 with the sentence. Not found → 404 `{"detail": "Not found"}`. `KindInUse` → 409.

The spec lists `GET/POST/PUT/DELETE /api/j2/note-kinds`. PUT and DELETE take the id in the path, the same way styles do.

`preview`, `restore` and `mapping-offer` are additions the spec's surfaces need: the live preview of unsaved edits, Undo on delete, and the P1.2 one-shot offer.

- [ ] **Step 1: Write the failing router tests**

`tests/test_notebook_journal_styles_router.py`:

```python
"""The journal-styles router: gate (404 before anything), session (401), plan (402), then the
service. Path-shadow rail: every route resolves to THIS router in api.main:app."""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def client(db_path, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    from api.routers import notebook_journal_styles as r
    app = FastAPI()
    app.include_router(r.router)
    c = TestClient(app)
    c.app_ref = app
    yield c
    app.dependency_overrides.clear()


def _as(client, uid="u1", plan="pro"):
    user = {"id": uid, "role": "member", "plan": plan}
    client.app_ref.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    client.app_ref.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def test_gate_off_is_one_404_before_the_session(client, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "0")
    assert client.get("/api/j2/journal-styles").status_code == 404
    assert client.post("/api/j2/note-kinds", json={"name": "x"}).status_code == 404


def test_signed_out_is_401_and_free_is_402(client):
    assert client.get("/api/j2/journal-styles").status_code == 401
    _as(client, plan="free")
    r = client.get("/api/j2/journal-styles")
    assert r.status_code == 402 and r.json()["detail"] == "Journal styles require a paid plan"


def test_list_create_get_update_default_delete_restore(client):
    _as(client)
    listing = client.get("/api/j2/journal-styles").json()
    assert listing["blockKinds"] == ["chart"] and len(listing["kinds"]) == 8
    s = client.post("/api/j2/journal-styles", json={"name": "Mine", "kindId": "trade_plan",
                    "blocks": [{"block": "chart", "enabled": True, "settings": {"tf": "D"}}]}).json()["style"]
    assert client.get(f"/api/j2/journal-styles/{s['id']}").json()["style"]["name"] == "Mine"
    assert client.put(f"/api/j2/journal-styles/{s['id']}", json={"blocks": []}).json()["style"]["version"] == 2
    assert client.post(f"/api/j2/journal-styles/{s['id']}/default").json()["style"]["isDefault"] is True
    assert client.delete(f"/api/j2/journal-styles/{s['id']}").json()["ok"] is True
    assert client.get(f"/api/j2/journal-styles/{s['id']}").status_code == 404
    assert client.post(f"/api/j2/journal-styles/{s['id']}/restore").json()["style"]["isDefault"] is True


def test_errors_carry_sentences(client):
    _as(client)
    r = client.post("/api/j2/journal-styles", json={"name": "x", "kindId": "nope"})
    assert r.status_code == 400 and r.json()["detail"] == "Choose a kind of note for this style."
    assert client.put("/api/j2/journal-styles/builtin:thesis", json={"name": "x"}).status_code == 400
    assert client.get("/api/j2/journal-styles/nope").status_code == 404


def test_kinds_and_in_use(client):
    _as(client)
    k = client.post("/api/j2/note-kinds", json={"name": "Swing", "icon": "bolt"}).json()["kind"]
    client.post("/api/j2/journal-styles", json={"name": "S", "kindId": k["id"]})
    r = client.delete(f"/api/j2/note-kinds/{k['id']}")
    assert r.status_code == 409 and "1 style" in r.json()["detail"]


def test_preview(client):
    _as(client)
    r = client.post("/api/j2/journal-styles/preview", json={"styleId": "builtin:thesis", "ticker": "nvda"})
    assert r.status_code == 200 and r.json()["ticker"] == "NVDA"


def test_every_route_resolves_to_this_router_in_the_real_app():
    from api import main
    from api.routers import notebook_journal_styles as r
    own = {(m, rt.path) for rt in r.router.routes for m in rt.methods}
    assert len(own) >= 14                                               # non-vacuity
    seen = {}
    for rt in main.app.routes:
        for m in getattr(rt, "methods", None) or ():
            key = (m, getattr(rt, "path", ""))
            if key in own and key not in seen:
                seen[key] = rt.endpoint.__module__
    assert set(seen) == own
    assert set(seen.values()) == {"api.routers.notebook_journal_styles"}
```

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python -m pytest tests/test_notebook_journal_styles_router.py -q
```

Expected: FAIL (no module).

- [ ] **Step 3: Implement the router**

`api/routers/notebook_journal_styles.py`:

```python
"""Journal styles (Notebook P1) routes. Service: api/services/journal_two/journal_styles.py and
note_kinds.py. Client: app/src/pages/journal-2-0/lib/journalStyles.js.

The rules (the template gallery router's):
  * THE GATE IS A ROUTER DEPENDENCY: NOTEBOOK_JOURNAL_STYLES_ENABLED off answers the one 404 for
    every route before the session, the plan or the body is read.
  * Every route takes this router's own `require_paid` (402, one sentence).
  * The body is read inside the dependency chain (`paid_body`), never as a FastAPI body parameter,
    so a malformed body can never answer 422 ahead of the gate.
  * `POST /api/j2/notes/{note_id}/apply-style-update` lives here too (Task 10): a path with one more
    segment than journal_two's `/notes/{note_id}` routes, so it cannot be shadowed (railed).
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import request_body_cap as body_cap
from api.services.journal_two import journal_styles as js
from api.services.journal_two import note_kinds as nk

MAX_BODY_BYTES = 512_000
NOT_FOUND = "Not found"
PAID_SENTENCE = "Journal styles require a paid plan"


def _require_enabled() -> None:
    if not js.enabled():
        raise HTTPException(status_code=404, detail=NOT_FOUND)


router = APIRouter(prefix="/api/j2", tags=["journal-2-0", "notebook-journal-styles"],
                   dependencies=[Depends(_require_enabled)])


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail=PAID_SENTENCE)
    return user


async def paid_body(request: Request, _user: dict = Depends(require_paid)) -> dict[str, Any]:
    raw = await body_cap.read_capped_body(request, MAX_BODY_BYTES, "Request too large")
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail="Send a JSON object")
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Send a JSON object")
    return data


def _bad(e: Exception) -> HTTPException:
    if isinstance(e, nk.KindInUse):
        return HTTPException(status_code=409, detail=str(e))
    return HTTPException(status_code=400, detail=str(e))


def _found(value: Any) -> Any:
    if value is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return value


# ── styles ───────────────────────────────────────────────────────────────────────────

@router.get("/journal-styles")
def list_styles_endpoint(user: dict = Depends(require_paid)) -> dict[str, Any]:
    return {"kinds": nk.list_kinds(user["id"]), "styles": js.list_styles(user["id"]),
            "blockKinds": [k["id"] for k in js.BLOCK_KINDS]}


@router.post("/journal-styles")
def create_style_endpoint(body: dict = Depends(paid_body), user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        if body.get("fromNoteId") is not None:
            s = js.create_style_from_note(user["id"], body["fromNoteId"], body.get("name"), body.get("kindId"))
            return {"style": _found(s)}
        return {"style": js.create_style(user["id"], body)}
    except (js.StyleValidationError, nk.KindValidationError) as e:
        raise _bad(e)


@router.post("/journal-styles/preview")
def preview_endpoint(body: dict = Depends(paid_body), user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        return js.preview(user["id"], body)
    except js.StyleNotFound:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    except js.StyleValidationError as e:
        raise _bad(e)


@router.get("/journal-styles/{style_id}")
def get_style_endpoint(style_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    return {"style": _found(js.get_style(user["id"], style_id))}


@router.put("/journal-styles/{style_id}")
def update_style_endpoint(style_id: str, body: dict = Depends(paid_body),
                          user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        return {"style": _found(js.update_style(user["id"], style_id, body))}
    except js.StyleValidationError as e:
        raise _bad(e)


@router.delete("/journal-styles/{style_id}")
def delete_style_endpoint(style_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        return {"ok": True, "style": _found(js.delete_style(user["id"], style_id))}
    except js.StyleValidationError as e:
        raise _bad(e)


@router.post("/journal-styles/{style_id}/restore")
def restore_style_endpoint(style_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    return {"style": _found(js.restore_style(user["id"], style_id))}


@router.post("/journal-styles/{style_id}/default")
def default_style_endpoint(style_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    return {"style": _found(js.set_default(user["id"], style_id))}


# ── kinds ────────────────────────────────────────────────────────────────────────────

@router.get("/note-kinds")
def list_kinds_endpoint(user: dict = Depends(require_paid)) -> dict[str, Any]:
    return {"kinds": nk.list_kinds(user["id"])}


@router.get("/note-kinds/mapping-offer")
def mapping_offer_endpoint(user: dict = Depends(require_paid)) -> dict[str, Any]:
    return {"offer": nk.mapping_offer(user["id"])}


@router.post("/note-kinds/mapping-offer")
def apply_mapping_endpoint(body: dict = Depends(paid_body), user: dict = Depends(require_paid)) -> dict[str, Any]:
    exclude = body.get("excludeNoteIds") or []
    if not isinstance(exclude, list):
        raise HTTPException(status_code=400, detail="excludeNoteIds must be a list")
    done = nk.apply_mapping(user["id"], exclude)
    return {"notes": done, "count": len(done)}


@router.post("/note-kinds")
def create_kind_endpoint(body: dict = Depends(paid_body), user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        return {"kind": nk.create_kind(user["id"], body.get("name"), body.get("icon"))}
    except nk.KindValidationError as e:
        raise _bad(e)


@router.put("/note-kinds/{kind_id}")
def update_kind_endpoint(kind_id: str, body: dict = Depends(paid_body),
                         user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        return {"kind": _found(nk.update_kind(user["id"], kind_id, name=body.get("name"), icon=body.get("icon"),
                                              sort_order=body.get("sortOrder")))}
    except nk.KindValidationError as e:
        raise _bad(e)


@router.delete("/note-kinds/{kind_id}")
def delete_kind_endpoint(kind_id: str, user: dict = Depends(require_paid)) -> dict[str, Any]:
    try:
        if not nk.delete_kind(user["id"], kind_id):
            raise HTTPException(status_code=404, detail=NOT_FOUND)
    except nk.KindValidationError as e:
        raise _bad(e)
    return {"ok": True}
```

`body_cap.read_capped_body(request, limit, sentence) -> bytes` is the gallery router's reader (`api/services/request_body_cap.py:102`).

In `api/main.py`, beside the gallery router import:

```python
from api.routers import notebook_journal_styles as notebook_journal_styles_router
```

and beside `app.include_router(notebook_template_gallery_router.router)`:

```python
app.include_router(notebook_journal_styles_router.router)
```

- [ ] **Step 4: Run the router tests**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python -m pytest tests/test_notebook_journal_styles_router.py -q > "$TEMP/p1-t8a.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass.

- [ ] **Step 5: Add the contract fixtures**

In `tools/notebook_contract_fixtures.py`:
- Add `"NOTEBOOK_JOURNAL_STYLES_ENABLED",` to `FLAGS`.
- In `build_app()`, add `notebook_journal_styles` to the `from api.routers import (...)` list and `notebook_journal_styles.router` to the include tuple.
- Add this builder before `def sweeps` (decorated with `@builder`):

```python
@builder
def journal_styles(w: World) -> None:
    """Journal styles (Notebook P1): styles, kinds, preview, the mapping offer."""
    from api.services.journal_two import notes as notes_service
    who = w.member("styles", "Sam Styles")
    empty = w.member("styles-empty", "Erin Empty")
    base, kinds = "/api/j2/journal-styles", "/api/j2/note-kinds"
    c = w.conn()
    try:
        notes_service.create_note(who, {"title": "NVDA plan", "ticker": "NVDA"}, c)
        notes_service.create_note(who, {"title": "Old earnings note"}, c,
                                  properties={"builtin:research_type": "earnings_play"})
        src = notes_service.create_note(who, {"title": "Setup to save", "ticker": "AMD", "bodyJson": doc(
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Setup"}]},
            chart_block("AMD", [], embed_id="emb-styles-1"), para("My words"))}, c)
    finally:
        c.close()
    w.as_user(empty)
    w.record("journal-styles.list.empty", "GET", base, case="empty", expect=200,
             note="A member with no styles of their own: the eight built-in styles and kinds.")
    w.as_user(who)
    made = w.record("journal-styles.create", "POST", base, case="success", expect=200, json_body={
        "name": "My trade plan", "kindId": "trade_plan",
        "outlineBodyJson": doc({"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Setup"}]},
                               para("{{block:chart}}"), para("Entry:")),
        "blocks": [{"block": "chart", "enabled": True, "settings": {"tf": "W"}}],
        "properties": {"builtin:confidence": "high"}})
    sid = made["style"]["id"]
    w.record("journal-styles.create.bad-kind", "POST", base, case="error", expect=400,
             json_body={"name": "x", "kindId": "nope"})
    w.record("journal-styles.create.from-note", "POST", base, case="success", expect=200,
             json_body={"fromNoteId": src["id"], "name": "From my note", "kindId": "trade_plan"})
    # Recorded AFTER two member styles exist, so the client tests that load it see a kind with
    # built-in AND own styles (KindSection's "Choose another style", journalStyles.stylesOfKind).
    w.record("journal-styles.list", "GET", base, case="success", expect=200,
             note="Built-in styles plus two of the member's own Trade plan styles; no member default yet.")
    w.record("journal-styles.get", "GET", f"{base}/{sid}", case="success", expect=200)
    w.record("journal-styles.get.builtin", "GET", f"{base}/builtin:thesis", case="success", expect=200)
    w.record("journal-styles.get.not-found", "GET", f"{base}/nope", case="error", expect=404)
    w.record("journal-styles.update", "PUT", f"{base}/{sid}", case="success", expect=200,
             json_body={"blocks": [{"block": "chart", "enabled": False, "settings": {"tf": "W"}}]})
    w.record("journal-styles.update.builtin", "PUT", f"{base}/builtin:thesis", case="error", expect=400,
             json_body={"name": "x"})
    w.record("journal-styles.update.unknown-block", "PUT", f"{base}/{sid}", case="success", expect=200,
             json_body={"blocks": [{"block": "futureBlock", "enabled": True, "settings": {"a": 1}}]},
             note="A block from a newer version is kept verbatim.")
    w.record("journal-styles.preview", "POST", f"{base}/preview", case="success", expect=200,
             json_body={"styleId": "builtin:trade_plan"}, note="No ticker asked: the member's latest note's.")
    w.record("journal-styles.preview.draft", "POST", f"{base}/preview", case="success", expect=200,
             json_body={"style": {"name": "Draft", "kindId": "thesis", "blocks": []}, "ticker": "crwd"})
    w.record("journal-styles.default", "POST", f"{base}/{sid}/default", case="success", expect=200)
    w.record("journal-styles.default.builtin", "POST", f"{base}/builtin:trade_plan/default", case="success",
             expect=200, note="Making a built-in the default clears the member's own default.")
    w.record("journal-styles.delete", "DELETE", f"{base}/{sid}", case="success", expect=200)
    w.record("journal-styles.restore", "POST", f"{base}/{sid}/restore", case="success", expect=200)
    w.record("note-kinds.list", "GET", kinds, case="success", expect=200)
    kind = w.record("note-kinds.create", "POST", kinds, case="success", expect=200,
                    json_body={"name": "Gap and go", "icon": "bolt"})
    kid = kind["kind"]["id"]
    w.record("note-kinds.create.duplicate", "POST", kinds, case="error", expect=400, json_body={"name": "trade plan"})
    w.record("note-kinds.update", "PUT", f"{kinds}/{kid}", case="success", expect=200, json_body={"name": "Gap & go"})
    w.record("note-kinds.update.builtin", "PUT", f"{kinds}/thesis", case="error", expect=400, json_body={"name": "x"})
    w.client.post(base, json={"name": "Uses the kind", "kindId": kid})
    w.record("note-kinds.delete.in-use", "DELETE", f"{kinds}/{kid}", case="error", expect=409)
    spare = w.client.post(kinds, json={"name": "Spare"}).json()["kind"]["id"]
    w.record("note-kinds.delete", "DELETE", f"{kinds}/{spare}", case="success", expect=200)
    w.record("note-kinds.mapping-offer", "GET", f"{kinds}/mapping-offer", case="success", expect=200)
    w.record("note-kinds.mapping-offer.apply", "POST", f"{kinds}/mapping-offer", case="success", expect=200,
             json_body={"excludeNoteIds": []})
    w.as_user(who, FREE)
    w.record("journal-styles.list.free-plan", "GET", base, case="error", expect=402)
    w.as_user(MEMBER)
```

- [ ] **Step 6: Generate and check the fixtures**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/notebook_contract_fixtures.py > "$TEMP/p1-t8-gen.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
python -m pytest tests/test_notebook_contract_fixtures.py tests/test_notebook_journal_styles_router.py -q > "$TEMP/p1-t8b.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
git status --short app/src/pages/journal-2-0/__fixtures__/contract
```

Expected: new `journal-styles.*`, `note-kinds.*` files; `sweep.signed-out.json` and `sweep.flags-off.json` gain the new routes (401 and 404). Read the sweep diffs: the only changes must be the added routes. Pytest all pass, including `test_every_route_has_a_pinned_answer_and_both_sweeps`.

- [ ] **Step 7: Mutation-prove the gate**

Capture the router. Remove `dependencies=[Depends(_require_enabled)]`. `test_gate_off_is_one_404_before_the_session` must FAIL. So must the contract rail (the flags-off sweep). Restore.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/check_repo_hygiene.py
git add api/routers/notebook_journal_styles.py api/main.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_notebook_journal_styles_router.py
git commit -F - -- api/routers/notebook_journal_styles.py api/main.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_notebook_journal_styles_router.py <<'MSG'
feat(notebook): journal styles + kinds router (gated, paid), preview, mapping offer, contract fixtures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 9: Styled create through the one door — `POST /api/j2/notes {styleId | kindId}`

Rests on Task 1 §c: only this branch reads the switch, and a create without `styleId`/`kindId` is byte-identical to today's.

**Files:**
- Modify: `api/routers/journal_two.py` (`create_note_endpoint`, `:3563-3572`)
- Modify: `api/services/journal_two/journal_styles.py` (`create_styled_note`)
- Modify: `app/src/pages/journal-2-0/lib/noteCreation.js` (`createNoteViaApi`)
- Modify: `app/src/pages/journal-2-0/tabs/NotebookTab.jsx` (`createNote` `:1623`: pass `styleId`, `kindId`; offline sentence)
- Modify: `tools/notebook_contract_fixtures.py` (the `journal_styles` builder: a second app for `POST /api/j2/notes`)
- Test: `tests/test_journal_styles_create.py` (new)
- Test: `app/src/pages/journal-2-0/lib/noteCreation.styled.test.js` (new)

**Interfaces:**
- Consumes: `compose`, `default_style_for_kind`, `get_style` (Tasks 6, 7); `notes.create_note(..., properties=, style_stamp=)`.
- Produces (server): `journal_styles.create_styled_note(user_id, payload, conn=None) -> tuple[dict, list[dict]]` returning `(note, skipped)`. The endpoint answers `{"note": ..., "skippedBlocks": [...]}`. Without `styleId`/`kindId` it answers `{"note": ...}` exactly as today.
- Produces (client): `createNoteViaApi({..., styleId, kindId})`. Each key is sent only when truthy. A styled create sends no `bodyJson` and no `properties` (the server composes both in one insert), so there is no follow-up PUT and no second revision. A failed response throws an `Error` that now carries `.status`.

- [ ] **Step 1: Write the failing tests**

`tests/test_journal_styles_create.py`:

```python
"""Styled create rides the existing create route (spec P1.3: never a second way to make a note)."""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


@pytest.fixture
def client(db_path, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    from api.routers import journal_two
    app = FastAPI()
    app.include_router(journal_two.router)
    c = TestClient(app)
    c.app_ref = app
    yield c
    app.dependency_overrides.clear()


def _as(client, uid="u1", plan="pro"):
    client.app_ref.dependency_overrides[authmw.get_current_user] = lambda: {"id": uid, "role": "member", "plan": plan}


def test_a_plain_create_is_unchanged(client):
    _as(client, plan="free")
    r = client.post("/api/j2/notes", json={"title": "plain"})
    assert r.status_code == 200 and set(r.json()) == {"note"}


def test_kind_makes_a_note_in_the_default_style(client):
    _as(client)
    r = client.post("/api/j2/notes", json={"kindId": "trade_plan", "ticker": "NVDA"})
    assert r.status_code == 200
    n = r.json()["note"]
    assert (n["styleId"], n["styleVersion"], n["kindId"]) == ("builtin:trade_plan", 1, "trade_plan")
    assert n["propertiesJson"]["builtin:note_kind"] == "trade_plan"
    assert any(x["type"] == "widgetEmbed" for x in n["bodyJson"]["content"])
    assert r.json()["skippedBlocks"] == []


def test_style_id_wins_and_records_its_version(client):
    _as(client)
    from api.services.journal_two import journal_styles as js
    s = js.create_style("u1", {"name": "Mine", "kindId": "thesis", "properties": {"builtin:confidence": "low"},
                               "blocks": [{"block": "chart", "enabled": True, "settings": {}}]})
    js.update_style("u1", s["id"], {"blocks": []})                    # a content change: v1 -> v2
    n = client.post("/api/j2/notes", json={"styleId": s["id"], "title": "T"}).json()["note"]
    assert (n["styleId"], n["styleVersion"]) == (s["id"], 2)
    assert n["propertiesJson"] == {"builtin:confidence": "low", "builtin:note_kind": "thesis"}


def test_kind_without_any_style_makes_a_note_with_only_the_kind(client):
    _as(client)
    from api.services.journal_two import note_kinds as nk
    k = nk.create_kind("u1", "Swing")
    n = client.post("/api/j2/notes", json={"kindId": k["id"]}).json()["note"]
    assert (n["styleId"], n["styleVersion"], n["kindId"]) == (None, None, k["id"])
    assert n["propertiesJson"] == {"builtin:note_kind": k["id"]}


def test_gate_off_and_free_plan_refuse_a_styled_create(client, monkeypatch):
    _as(client, plan="free")
    r = client.post("/api/j2/notes", json={"kindId": "thesis"})
    assert r.status_code == 402 and r.json()["detail"] == "Journal styles require a paid plan"
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "0")
    _as(client)
    assert client.post("/api/j2/notes", json={"kindId": "thesis"}).status_code == 404


def test_unknown_style_and_kind(client):
    _as(client)
    assert client.post("/api/j2/notes", json={"styleId": "nope"}).status_code == 404
    r = client.post("/api/j2/notes", json={"kindId": "nope"})
    assert r.status_code == 400 and r.json()["detail"] == "Choose a kind of note."
```

`app/src/pages/journal-2-0/lib/noteCreation.styled.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createNoteViaApi } from './noteCreation'

afterEach(() => vi.restoreAllMocks())

describe('createNoteViaApi with a style', () => {
  it('sends styleId/kindId, no bodyJson or properties, and makes ONE request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ note: { id: 'n1', updatedAt: 'x' }, skippedBlocks: [] }),
    })
    const note = await createNoteViaApi({ kindId: 'trade_plan', ticker: 'NVDA' })
    expect(note.id).toBe('n1')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(sent).toEqual({ title: '', ticker: 'NVDA', kindId: 'trade_plan' })
  })
  it('a refusal carries its status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 402, json: async () => ({}) })
    await expect(createNoteViaApi({ styleId: 's1' })).rejects.toMatchObject({ status: 402 })
  })
})
```

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python -m pytest tests/test_journal_styles_create.py -q
```

Expected: FAIL (`styleId` is ignored today).

- [ ] **Step 3: Implement the server**

Append to `journal_styles.py`:

```python
def create_styled_note(user_id: str, payload: dict, conn: sqlite3.Connection | None = None) -> tuple[dict, list]:
    """A note made from a style (styleId) or from a kind's default style (kindId), composed here and
    written in ONE insert: body, property values and the style stamp."""
    from api.services.journal_two import notes as notes_service
    owned = conn is None
    conn = conn or get_connection()
    try:
        style_id, kind_id = payload.get("styleId"), payload.get("kindId")
        if style_id is not None:
            if not isinstance(style_id, str) or not style_id.strip():
                raise StyleValidationError("styleId must be text")
            style = get_style(user_id, style_id.strip(), conn)
            if style is None:
                raise StyleNotFound(style_id)
        else:
            if note_kinds.get_kind(user_id, kind_id, conn) is None:
                raise StyleValidationError("Choose a kind of note.")
            style = default_style_for_kind(user_id, kind_id, conn)
        ticker = notes_service._validate_ticker(payload.get("ticker"))
        composed = compose(user_id, style, ticker=ticker, conn=conn)
        base = {k: payload[k] for k in ("title", "subtitle", "tags", "ticker", "folderId") if k in payload}
        base["bodyJson"] = composed["bodyJson"]
        note = notes_service.create_note(
            user_id, base, conn, properties=composed["properties"],
            style_stamp=(composed["styleId"], composed["styleVersion"], composed["kindId"]))
        return note, composed["skipped"]
    finally:
        if owned:
            conn.close()
```

Replace `create_note_endpoint` in `api/routers/journal_two.py`:

```python
def _styled_create_allowed(user: dict) -> None:
    """Journal styles (P1): the ONLY place POST /notes reads the switch or the plan, and only when a
    styleId/kindId is sent -- every other create is exactly what it was (spec P1.7c)."""
    from api.middleware import auth_middleware as authmw
    from api.services.journal_two import journal_styles
    if not journal_styles.enabled():
        raise HTTPException(status_code=404, detail="Not found")
    planned = user if "plan" in user else {**user, "plan": authmw.get_user_plan(user["id"])}
    if not authmw.is_paid_user(planned):
        raise HTTPException(status_code=402, detail="Journal styles require a paid plan")


@router.post("/notes")
def create_note_endpoint(
    payload: dict[str, Any] | None = Depends(_json(dict[str, Any] | None)),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    payload = payload or {}
    if payload.get("styleId") is not None or payload.get("kindId") is not None:
        _styled_create_allowed(user)
        from api.services.journal_two import journal_styles
        try:
            n, skipped = journal_styles.create_styled_note(user["id"], payload)
        except journal_styles.StyleNotFound:
            raise HTTPException(status_code=404, detail="Not found")
        except (journal_styles.StyleValidationError, NoteValidationError) as e:
            raise HTTPException(status_code=400, detail=str(e))
        return {"note": _servable_note(n), "skippedBlocks": skipped}
    try:
        n = notes_service.create_note(user["id"], payload)
    except NoteValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"note": _servable_note(n)}
```

- [ ] **Step 4: Implement the client**

In `noteCreation.js`, change the signature and body:

```js
export async function createNoteViaApi({ title = '', subtitle, bodyJson, tags, ticker, folderId, properties, styleId, kindId } = {}) {
  const res = await fetch('/api/j2/notes', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      ...(subtitle ? { subtitle } : {}),
      ...(bodyJson ? { bodyJson } : {}),
      ...(tags && tags.length ? { tags } : {}),
      ...(ticker ? { ticker } : {}),
      ...(folderId ? { folderId } : {}),
      // Journal styles (P1): the server composes body + properties + the style stamp in ONE insert.
      ...(styleId ? { styleId } : {}),
      ...(kindId ? { kindId } : {}),
    }),
  })
  if (!res.ok) {
    const err = new Error(`Could not create note (${res.status})`)
    err.status = res.status
    throw err
  }
```

Leave the rest of the function as it is. The properties PUT runs only when `properties` is passed, which a styled create never does.

In `NotebookTab.jsx` `createNote`, add `styleId, kindId` to the destructured parameters and pass them to `createNoteViaApi({ ..., styleId, kindId })`. Change the catch to:

```jsx
    } catch (e) {
      console.error('[notebook] create note failed', e)
      setActionError(typeof navigator !== 'undefined' && navigator.onLine === false
        ? "You're offline. A new note needs a connection; nothing was saved."
        : "Couldn't create that note. Nothing was saved.")
    }
```

Also change the `blank` computation passed to `openNote` so a styled note opens in its body: `blank: !title && !bodyJson && !styleId && !kindId`.

- [ ] **Step 5: Add the styled-create fixtures**

In `tools/notebook_contract_fixtures.py`, give `World.record` an optional `client=None` keyword: `res = (client or self.client).request(method, path, **kwargs)`. At the end of the `journal_styles` builder, before switching back to `MEMBER`, add:

```python
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import journal_two
    notes_app = FastAPI()
    notes_app.include_router(journal_two.router)
    notes_app.dependency_overrides = w.app.dependency_overrides      # the same session as the main app
    notes_client = TestClient(notes_app)
    w.as_user(who)
    w.record("notes.create.kind", "POST", "/api/j2/notes", case="success", expect=200, client=notes_client,
             json_body={"kindId": "trade_plan", "ticker": "NVDA"})
    w.record("notes.create.styled", "POST", "/api/j2/notes", case="success", expect=200, client=notes_client,
             json_body={"styleId": "builtin:thesis", "title": "Thesis"},
             note="No ticker: the chart block is left out and an instruction stands where it was.")
    w.record("notes.create.styled.not-found", "POST", "/api/j2/notes", case="error", expect=404,
             client=notes_client, json_body={"styleId": "nope"})
    w.as_user(who, FREE)
    w.record("notes.create.styled.free-plan", "POST", "/api/j2/notes", case="error", expect=402,
             client=notes_client, json_body={"kindId": "thesis"})
```

The `journal_two` router is deliberately NOT in `build_app()`. Its routes are not gated by this flag, so they belong in neither sweep.

- [ ] **Step 6: Run everything this touches**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/notebook_contract_fixtures.py > "$TEMP/p1-t9-gen.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
python -m pytest tests/test_journal_styles_create.py tests/test_notebook_contract_fixtures.py tests/test_journal_two_note_templates_router.py -q > "$TEMP/p1-t9.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1/app
npx vitest run src/pages/journal-2-0/lib/noteCreation.styled.test.js src/pages/journal-2-0/tabs/NotebookTab.templates.test.jsx src/pages/journal-2-0/tabs/NotebookTab.test.jsx > "$TEMP/p1-t9b.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass.

- [ ] **Step 7: Mutation-prove the one-insert rule**

Capture `journal_styles.py`. In `create_styled_note`, drop `properties=composed["properties"]`. `test_kind_makes_a_note_in_the_default_style` must FAIL. Restore.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/check_repo_hygiene.py
git add api/routers/journal_two.py api/services/journal_two/journal_styles.py app/src/pages/journal-2-0/lib/noteCreation.js app/src/pages/journal-2-0/tabs/NotebookTab.jsx tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_journal_styles_create.py app/src/pages/journal-2-0/lib/noteCreation.styled.test.js
git commit -F - -- api/routers/journal_two.py api/services/journal_two/journal_styles.py app/src/pages/journal-2-0/lib/noteCreation.js app/src/pages/journal-2-0/tabs/NotebookTab.jsx tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_journal_styles_create.py app/src/pages/journal-2-0/lib/noteCreation.styled.test.js <<'MSG'
feat(notebook): styled create through POST /api/j2/notes {styleId|kindId} (one insert, gated, paid)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 10: "Update layout to vN" — the planner and the one compare-and-set write

Rests on Task 1 §a: a block is present when a `widgetEmbed` with its `widgetId` is in the body.

**Files:**
- Modify: `api/services/journal_two/journal_styles.py` (`plan_style_update`, `apply_style_update`)
- Modify: `api/services/journal_two/notes.py` (`update_note`: new kwarg `style_stamp`, applied just before `if not sets:` `:3756`)
- Modify: `api/routers/notebook_journal_styles.py` (the route)
- Modify: `tools/notebook_contract_fixtures.py` (the `journal_styles` builder)
- Test: `tests/test_journal_styles_update.py` (new)

**Interfaces:**
- Produces: `POST /api/j2/notes/{note_id}/apply-style-update`, body `{styleId?, baseUpdatedAt?, dryRun?}`.
  - `dryRun: true` → `{"plan": Plan}`, writes nothing.
  - otherwise → `{"note": ..., "plan": Plan}`.
  - 409 `{"detail": "This note changed since you opened it. Nothing was added."}` when `baseUpdatedAt` is stale.
  - 400 `"This note was not made from a style."`; 404 for a note or style that does not exist (including a deleted style).
- `Plan = {"styleId", "styleName", "fromVersion": int | None, "toVersion": int, "switching": bool, "insertsOutline": bool, "add": [{"block", "label"}], "skipped": [{"block", "reason"}], "upToDate": bool}`. `label` is the client's to render via `blockLabel(block)`; the server sends the id only, as `"label": None`.
- `journal_styles.plan_style_update(user_id, note_id, *, style_id=None, conn=None) -> dict`
- `journal_styles.apply_style_update(user_id, note_id, *, style_id=None, expected_updated_at=None, conn=None) -> tuple[dict, dict]`
- `notes.update_note(..., style_stamp: tuple[str, int] | None = None)` (internal).

**Rules (spec P1.3):**
- Missing = enabled blocks of the target style with no `widgetEmbed` of that `widgetId` in the note.
- Missing blocks go after the first heading. Nothing is removed or reordered.
- `switching` (a `styleId` different from the note's own) also sets the note's `builtin:note_kind` to the target's kind. The outline is inserted only when the note body is empty.
- The style stamp (`style_id`, `style_version`) is written in the same UPDATE as the body.
- The body is read RAW from the row, never `get_note`'s served body, which can be the withheld placeholder of an over-deep note.

- [ ] **Step 1: Write the failing tests**

`tests/test_journal_styles_update.py`:

```python
"""Update layout (spec P1.3): adds missing blocks only, never removes or reorders the member's text,
one compare-and-set write with the style stamp in it."""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


def _note_from_v1(user="u1"):
    from api.services.journal_two import journal_styles as js
    s = js.create_style(user, {"name": "Mine", "kindId": "thesis", "blocks": [],
        "outlineBodyJson": {"type": "doc", "content": [
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Thesis"}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "prompt"}]}]}})
    n, _ = js.create_styled_note(user, {"styleId": s["id"], "ticker": "NVDA"})
    from api.services.journal_two import notes
    body = n["bodyJson"]
    body["content"].append({"type": "paragraph", "content": [{"type": "text", "text": "MY WORDS"}]})
    n = notes.update_note(user, n["id"], {"bodyJson": body}, client_schema=4)
    js.update_style(user, s["id"], {"blocks": [{"block": "chart", "enabled": True, "settings": {"tf": "W"}}]})
    return s, n


def test_plan_names_the_missing_block_and_versions(db_path):
    from api.services.journal_two import journal_styles as js
    s, n = _note_from_v1()
    p = js.plan_style_update("u1", n["id"])
    assert (p["fromVersion"], p["toVersion"], p["switching"], p["upToDate"]) == (1, 2, False, False)
    assert p["add"] == [{"block": "chart", "label": None}]


def test_apply_adds_after_the_heading_keeps_every_word_and_stamps(db_path):
    from api.services.journal_two import journal_styles as js
    s, n = _note_from_v1()
    before = [x for x in n["bodyJson"]["content"]]
    note, plan = js.apply_style_update("u1", n["id"], expected_updated_at=n["updatedAt"])
    after = note["bodyJson"]["content"]
    assert after[1]["type"] == "widgetEmbed" and after[1]["attrs"]["params"]["tf"] == "W"
    assert [x for x in after if x["type"] != "widgetEmbed"] == before           # nothing removed or moved
    assert (note["styleId"], note["styleVersion"]) == (s["id"], 2)
    assert js.plan_style_update("u1", n["id"])["upToDate"] is True


def test_a_stale_base_writes_nothing(db_path):
    from api.services.journal_two import journal_styles as js, notes
    s, n = _note_from_v1()
    with pytest.raises(notes.NoteConflictError):
        js.apply_style_update("u1", n["id"], expected_updated_at="2000-01-01T00:00:00+00:00")
    assert notes.get_note("u1", n["id"])["styleVersion"] == 1


def test_switching_sets_the_kind_and_an_empty_note_gets_the_outline(db_path):
    from api.services.journal_two import journal_styles as js, notes
    n = notes.create_note("u1", {"title": "empty", "ticker": "AMD"})
    note, plan = js.apply_style_update("u1", n["id"], style_id="builtin:watchlist_note",
                                       expected_updated_at=n["updatedAt"])
    assert plan["switching"] is True and plan["insertsOutline"] is True
    assert note["propertiesJson"]["builtin:note_kind"] == "watchlist_note"
    assert note["bodyJson"]["content"][0]["type"] == "heading"


def test_a_note_not_made_from_a_style_needs_a_style_id(db_path):
    from api.services.journal_two import journal_styles as js, notes
    n = notes.create_note("u1", {"title": "x"})
    with pytest.raises(js.StyleValidationError):
        js.plan_style_update("u1", n["id"])


def test_route_dry_run_apply_and_409(db_path, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    from api.routers import notebook_journal_styles as r
    app = FastAPI()
    app.include_router(r.router)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "u1", "role": "member", "plan": "pro"}
    c = TestClient(app)
    s, n = _note_from_v1()
    url = f"/api/j2/notes/{n['id']}/apply-style-update"
    assert c.post(url, json={"dryRun": True}).json()["plan"]["toVersion"] == 2
    stale = c.post(url, json={"baseUpdatedAt": "2000-01-01T00:00:00+00:00"})
    assert stale.status_code == 409 and stale.json()["detail"] == "This note changed since you opened it. Nothing was added."
    ok = c.post(url, json={"baseUpdatedAt": n["updatedAt"]})
    assert ok.status_code == 200 and ok.json()["note"]["styleVersion"] == 2
```

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python -m pytest tests/test_journal_styles_update.py -q
```

Expected: FAIL.

- [ ] **Step 3: Add `style_stamp` to `update_note`**

Add the keyword parameter `style_stamp: tuple[str, int] | None = None` to `update_note`, after `client_schema`. Add to the docstring: "`style_stamp` is INTERNAL (journal styles, P1): `(style_id, style_version)` written in the SAME UPDATE as the body; never read from a PUT." Immediately before `if not sets:`, add:

```python
        if style_stamp is not None:
            sets.append("style_id = ?"); params.append(style_stamp[0])
            sets.append("style_version = ?"); params.append(style_stamp[1])
```

- [ ] **Step 4: Implement the planner and the write**

Append to `journal_styles.py`:

```python
CONFLICT_SENTENCE = "This note changed since you opened it. Nothing was added."


def _present(content: list) -> set[str]:
    found, stack = set(), list(content or [])
    while stack:
        n = stack.pop()
        if not isinstance(n, dict):
            continue
        if n.get("type") == "widgetEmbed" and isinstance((n.get("attrs") or {}).get("widgetId"), str):
            found.add(n["attrs"]["widgetId"])
        if isinstance(n.get("content"), list):
            stack.extend(n["content"])
    return found


def _is_empty(content: list) -> bool:
    return all(isinstance(n, dict) and n.get("type") == "paragraph" and not _plain(n).strip()
               and not n.get("content") for n in content or [])


def _raw_note(user_id: str, note_id: str, conn: sqlite3.Connection) -> tuple[sqlite3.Row, dict] | None:
    r = conn.execute("SELECT * FROM j2_notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
                     (note_id, user_id)).fetchone()
    if r is None:
        return None
    try:
        body = json.loads(r["body_json"] or '{"type":"doc","content":[]}')
    except (TypeError, ValueError):
        body = {"type": "doc", "content": []}
    return r, body


def _plan(user_id: str, row: sqlite3.Row, body: dict, style_id: str | None, conn: sqlite3.Connection):
    target_id = style_id or row["style_id"]
    if not target_id:
        raise StyleValidationError("This note was not made from a style.")
    style = get_style(user_id, target_id, conn)
    if style is None:
        raise StyleNotFound(target_id)
    switching = target_id != row["style_id"]
    content = body.get("content") or []
    have = _present(content)
    add, skipped = [], []
    for b in style["blocks"]:
        if not b.get("enabled") or b["block"] in have:
            continue
        if b["block"] not in BLOCK_BUILDERS:
            skipped.append({"block": b["block"], "reason": "unknown-block"})
        elif b["block"] == "chart" and not row["ticker"]:
            skipped.append({"block": "chart", "reason": "needs-ticker"})
        else:
            add.append(b)
    plan = {"styleId": style["id"], "styleName": style["name"],
            "fromVersion": None if switching else row["style_version"], "toVersion": style["version"],
            "switching": switching, "insertsOutline": switching and _is_empty(content),
            "add": [{"block": b["block"], "label": None} for b in add], "skipped": skipped,
            "upToDate": (not switching and not add and row["style_version"] == style["version"])}
    return style, add, plan


def plan_style_update(user_id: str, note_id: str, *, style_id: str | None = None,
                      conn: sqlite3.Connection | None = None) -> dict:
    owned = conn is None
    conn = conn or get_connection()
    try:
        got = _raw_note(user_id, note_id, conn)
        if got is None:
            raise StyleNotFound(note_id)
        return _plan(user_id, got[0], got[1], style_id, conn)[2]
    finally:
        if owned:
            conn.close()


def apply_style_update(user_id: str, note_id: str, *, style_id: str | None = None,
                       expected_updated_at: str | None = None,
                       conn: sqlite3.Connection | None = None) -> tuple[dict, dict]:
    from api.services.journal_two import notes as notes_service
    owned = conn is None
    conn = conn or get_connection()
    try:
        got = _raw_note(user_id, note_id, conn)
        if got is None:
            raise StyleNotFound(note_id)
        row, body = got
        style, add, plan = _plan(user_id, row, body, style_id, conn)
        patch: dict[str, Any] = {}
        if plan["insertsOutline"]:
            patch["bodyJson"] = compose(user_id, style, ticker=row["ticker"], conn=conn)["bodyJson"]
        elif add:
            ctx = {"ticker": row["ticker"], "now": datetime.now(timezone.utc)}
            nodes = [BLOCK_BUILDERS[b["block"]](b, ctx)[0] for b in add]
            new = copy.deepcopy(body)
            i = _after_first_heading(new.setdefault("content", []))
            new["content"][i:i] = [n for n in nodes if n is not None]
            patch["bodyJson"] = new
        if plan["switching"]:
            patch["properties"] = {note_kinds.NOTE_KIND_PROPERTY: style["kindId"]}
        note = notes_service.update_note(user_id, note_id, patch, conn=conn,
                                         expected_updated_at=expected_updated_at, client_schema=None,
                                         style_stamp=(style["id"], style["version"]))
        if note is None:
            raise StyleNotFound(note_id)
        return note, plan
    finally:
        if owned:
            conn.close()
```

Add the route to `notebook_journal_styles.py`. The path has one more segment than any journal_two `/notes/{note_id}/...` POST, so it is unshadowed (Task 8's rail covers it):

```python
@router.post("/notes/{note_id}/apply-style-update")
def apply_style_update_endpoint(note_id: str, body: dict = Depends(paid_body),
                                user: dict = Depends(require_paid)) -> dict[str, Any]:
    """Previewed update (spec P1.3). dryRun -> the plan, nothing written. Otherwise ONE compare-and-
    set write; the client lands the returned note with settleNoteWrite and adoptServerCopy."""
    from api.services.journal_two import notes as notes_service
    style_id = body.get("styleId")
    base = body.get("baseUpdatedAt")
    try:
        if body.get("dryRun"):
            return {"plan": js.plan_style_update(user["id"], note_id, style_id=style_id)}
        note, plan = js.apply_style_update(user["id"], note_id, style_id=style_id,
                                           expected_updated_at=base if isinstance(base, str) and base else None)
    except js.StyleNotFound:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    except js.StyleValidationError as e:
        raise _bad(e)
    except notes_service.NoteConflictError:
        raise HTTPException(status_code=409, detail=js.CONFLICT_SENTENCE)
    from api.routers.journal_two import _servable_note
    return {"note": _servable_note(note), "plan": plan}
```

- [ ] **Step 5: Fixtures for the route**

In the `journal_styles` builder (before the free-plan record), add:

```python
    mine = w.client.post(base, json={"name": "Grows", "kindId": "thesis", "blocks": []}).json()["style"]
    c = w.conn()
    try:
        from api.services.journal_two import journal_styles as _js
        n, _ = _js.create_styled_note(who, {"styleId": mine["id"], "ticker": "NVDA"}, c)
    finally:
        c.close()
    w.client.put(f"{base}/{mine['id']}", json={"blocks": [{"block": "chart", "enabled": True, "settings": {"tf": "D"}}]})
    url = f"/api/j2/notes/{n['id']}/apply-style-update"
    w.record("notes.apply-style-update.dry-run", "POST", url, case="success", expect=200, json_body={"dryRun": True})
    w.record("notes.apply-style-update.stale", "POST", url, case="error", expect=409,
             json_body={"baseUpdatedAt": "2000-01-01T00:00:00+00:00"})
    w.record("notes.apply-style-update", "POST", url, case="success", expect=200,
             json_body={"baseUpdatedAt": n["updatedAt"]})
```

- [ ] **Step 6: Run**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/notebook_contract_fixtures.py > "$TEMP/p1-t10-gen.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
python -m pytest tests/test_journal_styles_update.py tests/test_notebook_journal_styles_router.py tests/test_notebook_contract_fixtures.py tests/test_notes_cas_is_atomic.py tests/test_notes_answer_is_the_committed_row.py -q > "$TEMP/p1-t10.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass. The route table now has one more route; the sweeps include it (401, 404).

- [ ] **Step 7: Mutation-prove "never removes"**

Capture `journal_styles.py`. In `apply_style_update`, replace `new["content"][i:i] = [...]` with `new["content"] = [...]`. `test_apply_adds_after_the_heading_keeps_every_word_and_stamps` must FAIL. Restore.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/check_repo_hygiene.py
git add api/services/journal_two/journal_styles.py api/services/journal_two/notes.py api/routers/notebook_journal_styles.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_journal_styles_update.py
git commit -F - -- api/services/journal_two/journal_styles.py api/services/journal_two/notes.py api/routers/notebook_journal_styles.py tools/notebook_contract_fixtures.py app/src/pages/journal-2-0/__fixtures__/contract tests/test_journal_styles_update.py <<'MSG'
feat(notebook): update layout to vN (adds missing blocks only, one compare-and-set write with the style stamp)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 11: Client data layer — the API, the hook, the offline cache

Spec P1.6 says "applying offline uses the cache and queues through the outbox like any create". **No create is queued through the outbox today.** The outbox holds only `sendNoteUpdate` PUTs (`useOutboxDrain.js:101`, `export async function sendNoteUpdate(entry)`), and `createNoteViaApi` is a plain `fetch` (`noteCreation.js:22`). Building an offline create queue is a new write door with temporary ids. It is out of P1's scope and against the integrity rule's spirit.

P1 therefore does this:
- Styles and kinds are cached in the offline DB's `meta` store (no `DB_VERSION` bump), so the manager and the kind section read offline.
- Creating a note offline is refused with a plain sentence (Task 9).

This deviation is recorded in the PR body for the owner.

**Files:**
- Create: `app/src/pages/journal-2-0/lib/journalStyles.js`
- Create: `app/src/pages/journal-2-0/hooks/useJournalStyles.js`
- Test: `app/src/pages/journal-2-0/lib/journalStyles.test.js` (new)

**Interfaces:**
- Consumes: the contract fixtures from Tasks 8–10; `openNotebookDb`, `getMeta`, `putMeta`, `offlineStorageAvailable` (`lib/offline/notebookDb.js`); `offlineEnabled` (`lib/offline/offlineFlag.js`); `getCurrentAccountId` (`lib/offline/currentAccount.js`); `settleNoteWrite` (`lib/offline/settleNoteWrite.js`). Not `useDurableNote`: importing it takes a Web Lock (see the header of `settleNoteWrite.js`).
- Produces (`lib/journalStyles.js`):
  - `STYLES_URL = '/api/j2/journal-styles'`, `STYLES_CACHE_KEY = 'journal-styles:v1'`
  - `fetchJournalStyles(): Promise<{kinds, styles, blockKinds, fromCache?: true}>`
  - `getJournalStyle(id)`, `createJournalStyle(body)`, `updateJournalStyle(id, patch)`, `deleteJournalStyle(id)`, `restoreJournalStyle(id)`, `setDefaultJournalStyle(id)`, `previewJournalStyle(body)`
  - `createKind(body)`, `updateKind(id, patch)`, `deleteKind(id)`, `getMappingOffer()`, `applyMappingOffer(excludeNoteIds)` (settles every returned note)
  - `planStyleUpdate(noteId, {styleId})`, `applyStyleUpdate(noteId, {styleId, baseUpdatedAt})` (settles the returned note)
  - `defaultStyleFor(payload, kindId) -> style | null`, `stylesOfKind(payload, kindId) -> style[]`
  - Each refusal throws `Error(detail)` with `.status`.
- Produces (`hooks/useJournalStyles.js`): `useJournalStyles() -> {data, error, isLoading, mutate}` (SWR on `STYLES_URL`, fetcher `fetchJournalStyles`).

- [ ] **Step 1: Write the failing tests**

`app/src/pages/journal-2-0/lib/journalStyles.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import listFixture from '../__fixtures__/contract/journal-styles.list.json'
import applyFixture from '../__fixtures__/contract/notes.apply-style-update.json'
import mappingApply from '../__fixtures__/contract/note-kinds.mapping-offer.apply.json'

vi.mock('./offline/settleNoteWrite', () => ({ settleNoteWrite: vi.fn(async () => 'rev') }))
import { settleNoteWrite } from './offline/settleNoteWrite'
import {
  fetchJournalStyles, applyStyleUpdate, applyMappingOffer, defaultStyleFor, stylesOfKind, createJournalStyle,
} from './journalStyles'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
afterEach(() => { vi.restoreAllMocks(); settleNoteWrite.mockClear() })

describe('journal styles client', () => {
  it('reads the list in the server contract shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok(listFixture.body))
    const data = await fetchJournalStyles()
    expect(data.kinds.length).toBe(8)
    expect(defaultStyleFor(data, 'thesis').id).toBe('builtin:thesis')
    expect(stylesOfKind(data, 'trade_plan').some((s) => !s.builtin)).toBe(true)
  })

  it('lands the update-layout write before returning', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok(applyFixture.body))
    const out = await applyStyleUpdate('n1', { baseUpdatedAt: 'x' })
    expect(settleNoteWrite).toHaveBeenCalledWith(applyFixture.body.note.id, applyFixture.body.note)
    expect(out.note.styleVersion).toBe(applyFixture.body.note.styleVersion)
  })

  it('lands every note the mapping offer changed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok(mappingApply.body))
    await applyMappingOffer([])
    expect(settleNoteWrite).toHaveBeenCalledTimes(mappingApply.body.notes.length)
  })

  it('a refusal carries the server sentence and status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 400, json: async () => ({ detail: 'Choose a kind of note for this style.' }) })
    await expect(createJournalStyle({ name: 'x' })).rejects.toMatchObject({ status: 400, message: 'Choose a kind of note for this style.' })
  })

  it('falls back to the cached copy when the network is down', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const cached = { ...listFixture.body, fromCache: true }
    const data = await fetchJournalStyles({ readCache: async () => listFixture.body })
    expect(data).toEqual(cached)
  })
})
```

- [ ] **Step 2: Run to see it fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1/app
npx vitest run src/pages/journal-2-0/lib/journalStyles.test.js > "$TEMP/p1-t11a.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL (no module).

- [ ] **Step 3: Implement**

`app/src/pages/journal-2-0/lib/journalStyles.js`:

```js
// Journal styles (Notebook P1): the client for api/routers/notebook_journal_styles.py, shapes pinned
// by the contract fixtures. Imported ONLY by lazy chunks and the hook (never on first open).
// ⛔ Two calls move a note's revision (update layout, the mapping offer); each LANDS what it moved
// with settleNoteWrite before returning (lib/offline/doorEnumeration.test.js).
// Offline (spec P1.6): the list is cached in the offline DB's `meta` store and read back when the
// network fails. Creating offline is refused by the create door (NotebookTab), never queued.
import { settleNoteWrite } from './offline/settleNoteWrite'
import { openNotebookDb, getMeta, putMeta, offlineStorageAvailable } from './offline/notebookDb'
import { offlineEnabled } from './offline/offlineFlag'
import { getCurrentAccountId } from './offline/currentAccount'

export const STYLES_URL = '/api/j2/journal-styles'
export const STYLES_CACHE_KEY = 'journal-styles:v1'
const KINDS_URL = '/api/j2/note-kinds'

async function call(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method, credentials: 'include',
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err = new Error(data.detail || `${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

async function withDb(fn) {
  const accountId = getCurrentAccountId()
  if (!accountId || !offlineEnabled() || !offlineStorageAvailable()) return undefined
  let db
  try {
    db = await openNotebookDb(accountId)
    return await fn(db)
  } catch {
    return undefined
  } finally {
    try { db?.close() } catch { /* already closed */ }
  }
}

export const readCachedStyles = () => withDb((db) => getMeta(db, STYLES_CACHE_KEY))
const writeCachedStyles = (payload) => withDb((db) => putMeta(db, STYLES_CACHE_KEY, payload))

export async function fetchJournalStyles({ readCache = readCachedStyles } = {}) {
  try {
    const data = await call(STYLES_URL)
    writeCachedStyles(data)
    return data
  } catch (e) {
    if (e?.status) throw e                        // the server answered: a refusal is not "offline"
    const cached = await readCache()
    if (cached) return { ...cached, fromCache: true }
    throw e
  }
}

export const getJournalStyle = (id) => call(`${STYLES_URL}/${encodeURIComponent(id)}`)
export const createJournalStyle = (body) => call(STYLES_URL, { method: 'POST', body })
export const updateJournalStyle = (id, patch) => call(`${STYLES_URL}/${encodeURIComponent(id)}`, { method: 'PUT', body: patch })
export const deleteJournalStyle = (id) => call(`${STYLES_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const restoreJournalStyle = (id) => call(`${STYLES_URL}/${encodeURIComponent(id)}/restore`, { method: 'POST' })
export const setDefaultJournalStyle = (id) => call(`${STYLES_URL}/${encodeURIComponent(id)}/default`, { method: 'POST' })
export const previewJournalStyle = (body) => call(`${STYLES_URL}/preview`, { method: 'POST', body })
export const createKind = (body) => call(KINDS_URL, { method: 'POST', body })
export const updateKind = (id, patch) => call(`${KINDS_URL}/${encodeURIComponent(id)}`, { method: 'PUT', body: patch })
export const deleteKind = (id) => call(`${KINDS_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const getMappingOffer = () => call(`${KINDS_URL}/mapping-offer`)

export async function applyMappingOffer(excludeNoteIds = []) {
  const out = await call(`${KINDS_URL}/mapping-offer`, { method: 'POST', body: { excludeNoteIds } })
  for (const n of out.notes || []) await settleNoteWrite(n.id, n)
  return out
}

export const planStyleUpdate = (noteId, { styleId } = {}) =>
  call(`/api/j2/notes/${encodeURIComponent(noteId)}/apply-style-update`, {
    method: 'POST', body: { dryRun: true, ...(styleId ? { styleId } : {}) },
  })

export async function applyStyleUpdate(noteId, { styleId, baseUpdatedAt } = {}) {
  const out = await call(`/api/j2/notes/${encodeURIComponent(noteId)}/apply-style-update`, {
    method: 'POST', body: { ...(styleId ? { styleId } : {}), ...(baseUpdatedAt ? { baseUpdatedAt } : {}) },
  })
  await settleNoteWrite(out.note.id, out.note)
  return out
}

export const stylesOfKind = (payload, kindId) => (payload?.styles || []).filter((s) => s.kindId === kindId)
export const defaultStyleFor = (payload, kindId) => stylesOfKind(payload, kindId).find((s) => s.isDefault) || null
```

`app/src/pages/journal-2-0/hooks/useJournalStyles.js`:

```js
// Journal styles list (P1). Used by lazy chunks only. Revalidates on focus like the property defs.
import useSWR from 'swr'
import { STYLES_URL, fetchJournalStyles } from '../lib/journalStyles'

export default function useJournalStyles({ enabled = true } = {}) {
  return useSWR(enabled ? STYLES_URL : null, () => fetchJournalStyles(), {
    revalidateOnFocus: true, shouldRetryOnError: false,
  })
}
```

- [ ] **Step 4: Run, including the door rail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1/app
npx vitest run src/pages/journal-2-0/lib/journalStyles.test.js src/pages/journal-2-0/lib/offline/doorEnumeration.test.js > "$TEMP/p1-t11b.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: pass. `doorEnumeration.test.js` derives the door routes from the routers. If it reads the new router's apply route as a door, the settle in `applyStyleUpdate` satisfies it. If it reports the route as un-derivable, read its ledger comment and register the route the way that file says, never by weakening its MODE.

- [ ] **Step 5: Mutation-prove the settle**

Capture `journalStyles.js`. Delete the `await settleNoteWrite(out.note.id, out.note)` line. The "lands the update-layout write" test must FAIL; check whether `doorEnumeration.test.js` also goes red and record which. Restore.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/lib/journalStyles.js app/src/pages/journal-2-0/hooks/useJournalStyles.js app/src/pages/journal-2-0/lib/journalStyles.test.js
git commit -F - -- app/src/pages/journal-2-0/lib/journalStyles.js app/src/pages/journal-2-0/hooks/useJournalStyles.js app/src/pages/journal-2-0/lib/journalStyles.test.js <<'MSG'
feat(notebook): journal styles client + hook; offline cache in the meta store; every revision landed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 12: New note → pick a kind → its default style; "Choose another style" with a live preview

**Files:**
- Create: `app/src/pages/journal-2-0/components/notebook/styles/KindSection.jsx` + `KindSection.module.css`
- Modify: `app/src/pages/journal-2-0/components/notebook/TemplatePicker.jsx` (new optional prop `kindSection`, rendered above the search)
- Modify: `app/src/pages/journal-2-0/components/notebook/TemplatePreview.jsx` (export `DocBody`; `widgetEmbed` renders a block line)
- Modify: `app/src/pages/journal-2-0/components/notebook/NewNoteMenu.jsx` (`onFromStyle`)
- Modify: `app/src/pages/journal-2-0/components/notebook/ResearchHome.jsx` (pass `onFromStyle`)
- Modify: `app/src/pages/journal-2-0/tabs/NotebookTab.jsx` (lazy `KindSection`, handlers, `kindSection` at both TemplatePicker mounts `:2572`, `:2762`)
- Test: `app/src/pages/journal-2-0/components/notebook/styles/KindSection.test.jsx` (new)
- Test: `app/src/pages/journal-2-0/components/notebook/NewNoteMenu.test.jsx` (extend)

**Interfaces:**
- Consumes: `useJournalStyles`, `defaultStyleFor`, `stylesOfKind`, `previewJournalStyle` (Task 11); `BUILTIN_NOTE_KINDS`, `kindIcon` (Task 4); `UICON_NAMES` (`components/ui/UIcon.jsx`); `TemplatePreview`.
- Produces:
  - `KindSection({ onKind(kindId), onStyle(styleId), busy })`, the default export of `styles/KindSection.jsx`
  - `NewNoteMenu` prop `onFromStyle` (an item appears only when the prop is passed)
  - `TemplatePicker` prop `kindSection` (a React node or `null`)
  - `DocBody({ body })`, a named export of `TemplatePreview.jsx`

- [ ] **Step 1: Write the failing tests**

`styles/KindSection.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import listFixture from '../../../__fixtures__/contract/journal-styles.list.json'
import previewFixture from '../../../__fixtures__/contract/journal-styles.preview.json'
import KindSection from './KindSection'

afterEach(() => vi.restoreAllMocks())
const ok = (body) => ({ ok: true, status: 200, json: async () => body })

function renderSection(props = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
    ok(String(url).endsWith('/preview') ? previewFixture.body : listFixture.body))
  const onKind = vi.fn()
  const onStyle = vi.fn()
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <KindSection onKind={onKind} onStyle={onStyle} busy={false} {...props} />
  </SWRConfig>)
  return { onKind, onStyle }
}

describe('New note: pick a kind', () => {
  it('lists every kind and one press makes a note of that kind', async () => {
    const { onKind } = renderSection()
    const group = await screen.findByRole('group', { name: 'Start from a kind of note' })
    expect(within(group).getAllByRole('button', { name: /^New / }).length).toBe(listFixture.body.kinds.length)
    fireEvent.click(within(group).getByRole('button', { name: 'New Trade plan' }))
    expect(onKind).toHaveBeenCalledWith('trade_plan')
  })

  it('Choose another style lists that kind’s styles, previews one with my data, and uses it', async () => {
    const { onStyle } = renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Choose another style for Trade plan' }))
    const list = screen.getByRole('list', { name: 'Styles for Trade plan' })
    const mine = within(list).getAllByRole('listitem').find((li) => !/Built-in/.test(li.textContent))
    fireEvent.click(within(mine).getByRole('button', { name: /^Preview / }))
    expect(await screen.findByText(new RegExp(`Shown with ${previewFixture.body.ticker}`))).toBeTruthy()
    fireEvent.click(within(mine).getByRole('button', { name: /^Use / }))
    expect(onStyle).toHaveBeenCalled()
  })

  it('every kind button is at least the touch floor on touch (class carries it)', async () => {
    renderSection()
    const btn = await screen.findByRole('button', { name: 'New Trade plan' })
    expect(btn.className).toMatch(/kindBtn/)
  })
})
```

Extend `NewNoteMenu.test.jsx` with:

```jsx
it('lists "From a style" only when a handler is passed', () => {
  const { rerender } = render(<NewNoteMenu onBlank={() => {}} onFromOutline={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
  expect(screen.queryByRole('menuitem', { name: /From a style/ })).toBeNull()
  const onFromStyle = vi.fn()
  rerender(<NewNoteMenu onBlank={() => {}} onFromOutline={() => {}} onFromStyle={onFromStyle} />)
  fireEvent.click(screen.getByRole('menuitem', { name: /From a style/ }))
  expect(onFromStyle).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1/app
npx vitest run src/pages/journal-2-0/components/notebook/styles/KindSection.test.jsx src/pages/journal-2-0/components/notebook/NewNoteMenu.test.jsx > "$TEMP/p1-t12a.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL.

- [ ] **Step 3: Export `DocBody` and render a block line**

In `TemplatePreview.jsx`: add `import { blockLabel, tfWord } from '../../lib/journalBlocks'`. Add this case to `Block`'s switch before `default:`:

```jsx
    case 'widgetEmbed': {
      const p = node.attrs?.params || {}
      const what = node.attrs?.widgetId === 'chart' && p.symbol
        ? `Chart · ${p.symbol} · ${tfWord(p.tf)}` : blockLabel(node.attrs?.widgetId)
      return <div className={styles.blockLine} data-block={node.attrs?.widgetId || ''}>{what}</div>
    }
```

Change `function DocBody` to `export function DocBody`. Add to `TemplatePreview.module.css`:

```css
.blockLine { margin: 8px 0; padding: 10px 12px; border: 1px dashed var(--border); border-radius: 8px; color: var(--text-muted); font-size: 13px; }
```

`--border` and `--text-muted` are the tokens `TemplatePreview.module.css` already uses (`:22`, `:8`); `styles/tokens.reachable.test.js` fails on an undefined token.

- [ ] **Step 4: Implement `KindSection`**

`styles/KindSection.jsx`:

```jsx
// Notebook P1 (spec P1.4): New note -> pick a kind -> its default style applies; "Choose another
// style" shows the others with a live preview rendered with the member's own data (their ticker).
// Lazy chunk (NotebookTab lazyView). Creates nothing itself: onKind/onStyle go to createNote.
import { useState } from 'react'
import UIcon, { UICON_NAMES } from '../../../../../components/ui/UIcon'
import useJournalStyles from '../../../hooks/useJournalStyles'
import { defaultStyleFor, stylesOfKind, previewJournalStyle } from '../../../lib/journalStyles'
import { kindIcon } from '../../../lib/noteKinds'
import TemplatePreview from '../TemplatePreview'
import styles from './KindSection.module.css'

const icon = (k) => (UICON_NAMES.includes(kindIcon(k)) ? kindIcon(k) : 'document')

export default function KindSection({ onKind, onStyle, busy = false }) {
  const { data, error, isLoading } = useJournalStyles()
  const [openKind, setOpenKind] = useState(null)
  const [preview, setPreview] = useState(null)   // {style, loading, body, ticker, error}

  if (isLoading) return <p className={styles.status} role="status">Loading kinds of note…</p>
  if (error || !data) return <p className={styles.status} role="alert">Couldn't load your journal styles.</p>

  const showPreview = async (style) => {
    setPreview({ style, loading: true })
    try {
      const out = await previewJournalStyle({ styleId: style.id })
      setPreview({ style, loading: false, body: out.bodyJson, ticker: out.ticker })
    } catch (e) {
      setPreview({ style, loading: false, error: e.message || "Couldn't build the preview." })
    }
  }

  return (
    <section className={styles.wrap} aria-labelledby="kind-section-h">
      <h3 id="kind-section-h" className={styles.h}>Start from a kind of note</h3>
      {data.fromCache && <p className={styles.status}>You're offline. These are your saved styles; a new note needs a connection.</p>}
      <div role="group" aria-label="Start from a kind of note" className={styles.grid}>
        {data.kinds.map((k) => {
          const def = defaultStyleFor(data, k.id)
          return (
            <div key={k.id} className={styles.kind}>
              <button type="button" className={styles.kindBtn} disabled={busy} aria-label={`New ${k.name}`}
                onClick={() => onKind(k.id)}>
                <UIcon name={icon(k)} size={16} gold={false} />
                <span className={styles.kindName}>{k.name}</span>
                <span className={styles.kindStyle}>{def ? def.name : 'No style yet'}</span>
              </button>
              <button type="button" className={styles.another} aria-expanded={openKind === k.id}
                aria-label={`Choose another style for ${k.name}`}
                onClick={() => setOpenKind(openKind === k.id ? null : k.id)}>
                Choose another style
              </button>
              {openKind === k.id && (
                <ul className={styles.list} aria-label={`Styles for ${k.name}`}>
                  {stylesOfKind(data, k.id).map((s) => (
                    <li key={s.id} className={styles.row}>
                      <span className={styles.rowName}>{s.name}{s.builtin ? ' · Built-in' : ''}{s.isDefault ? ' · Default' : ''}</span>
                      <button type="button" className={styles.rowBtn} aria-label={`Preview ${s.name}`} onClick={() => showPreview(s)}>Preview</button>
                      <button type="button" className={styles.rowBtn} disabled={busy} aria-label={`Use ${s.name}`} onClick={() => onStyle(s.id)}>Use</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
      {preview && (
        <TemplatePreview open onClose={() => setPreview(null)} title={preview.style.name}
          subtitle={preview.ticker ? `Shown with ${preview.ticker}, from your notes.` : 'Add a ticker to see the chart block.'}
          body={preview.body} loading={preview.loading} loadError={preview.error}
          onUse={() => { const id = preview.style.id; setPreview(null); onStyle(id) }} busy={busy} />
      )}
    </section>
  )
}
```

`styles/KindSection.module.css`:

```css
.wrap { margin: 0 0 16px; }
.h { font-size: 14px; margin: 0 0 8px; }
.status { font-size: 13px; color: var(--text-muted); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
.kind { display: flex; flex-direction: column; gap: 4px; }
.kindBtn { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 8px; align-items: center; text-align: left; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: inherit; cursor: pointer; }
.kindName { font-weight: 600; }
.kindStyle { grid-column: 2; font-size: 12px; color: var(--text-muted); }
.another, .rowBtn { background: none; border: none; color: var(--accent); cursor: pointer; font-size: 12px; text-align: left; padding: 4px 0; }
.list { list-style: none; margin: 0; padding: 0; }
.row { display: flex; gap: 8px; align-items: center; padding: 4px 0; }
.rowName { flex: 1; font-size: 13px; }
@media (max-width: 1024px) {
  .kindBtn, .another, .rowBtn { min-height: var(--tap-min); }
  .rowBtn { min-width: var(--tap-min); }
}
@media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
```

Every token above (`--border`, `--text-muted`, `--accent`, `--tap-min`) is defined in `app/src/styles/tokens.css`.

- [ ] **Step 5: Wire the doors**

`NewNoteMenu.jsx`: add the prop `onFromStyle = null` and an item. The item is written as its own element so its tour anchor is a literal:

```jsx
    onFromStyle && { key: 'style', label: 'From a style', run: onFromStyle, icon: 'sliders' },
```

and in the render map, before the voice branch:

```jsx
          {items.map((it) => (it.key === 'style' ? (
            <button key={it.key} type="button" role="menuitem" className={styles.item}
              data-tour="new-note-style" onClick={run(it.run)}>
              <UIcon name={it.icon} size={14} gold={false} /> {it.label}
            </button>
          ) : it.key === 'voice' ? (
```

(The rest of the existing ternary stays.)

`TemplatePicker.jsx`: add `kindSection = null` to the props and render `{kindSection}` as the first child inside the picker's root, above the search row.

`NotebookTab.jsx`:

```jsx
import { journalStylesEnabled } from '../lib/journalStylesFlag'
const KindSection = lazyView(() => import('../components/notebook/styles/KindSection'), 'kinds of note')
```

Inside the component:

```jsx
  const stylesOn = journalStylesEnabled()
  // createNote already seeds the ticker from app focus (`const seededTicker = ticker || focusSymbol || null`),
  // so a chart block gets the symbol the member was just charting.
  const kindSection = stylesOn ? (
    <KindSection busy={creating}
      onKind={(kindId) => createNote({ kindId })}
      onStyle={(styleId) => createNote({ styleId })} />
  ) : null
```

Pass `kindSection={kindSection}` to BOTH `<TemplatePicker .../>` mounts. To ResearchHome add `onFromStyle={stylesOn ? () => setPickerOpen(true) : null}`, and forward it in `ResearchHome.jsx` to `<NewNoteMenu ... onFromStyle={onFromStyle} />` (add `onFromStyle = null` to ResearchHome's props).

- [ ] **Step 6: Run**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1/app
npx vitest run src/pages/journal-2-0/components/notebook/styles/KindSection.test.jsx src/pages/journal-2-0/components/notebook/NewNoteMenu.test.jsx src/pages/journal-2-0/components/notebook/TemplatePicker.gallery.test.jsx src/pages/journal-2-0/tabs/NotebookTab.templates.test.jsx src/pages/journal-2-0/tabs/NotebookTab.lazyViews.test.js src/components/screener/reachable.test.js src/styles/tapFloor.test.js src/styles/tokens.reachable.test.js > "$TEMP/p1-t12b.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass. `reachable.test.js` sees `KindSection` through the lazy edge. If a `tourAnchors` rail exists under another path, run it too (`grep -rln "tourAnchors" app/src --include=*.test.*`).

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/components/notebook/styles/KindSection.jsx app/src/pages/journal-2-0/components/notebook/styles/KindSection.module.css app/src/pages/journal-2-0/components/notebook/styles/KindSection.test.jsx app/src/pages/journal-2-0/components/notebook/TemplatePicker.jsx app/src/pages/journal-2-0/components/notebook/TemplatePreview.jsx app/src/pages/journal-2-0/components/notebook/TemplatePreview.module.css app/src/pages/journal-2-0/components/notebook/NewNoteMenu.jsx app/src/pages/journal-2-0/components/notebook/NewNoteMenu.test.jsx app/src/pages/journal-2-0/components/notebook/ResearchHome.jsx app/src/pages/journal-2-0/tabs/NotebookTab.jsx
git commit -F - -- app/src/pages/journal-2-0/components/notebook/styles/KindSection.jsx app/src/pages/journal-2-0/components/notebook/styles/KindSection.module.css app/src/pages/journal-2-0/components/notebook/styles/KindSection.test.jsx app/src/pages/journal-2-0/components/notebook/TemplatePicker.jsx app/src/pages/journal-2-0/components/notebook/TemplatePreview.jsx app/src/pages/journal-2-0/components/notebook/TemplatePreview.module.css app/src/pages/journal-2-0/components/notebook/NewNoteMenu.jsx app/src/pages/journal-2-0/components/notebook/NewNoteMenu.test.jsx app/src/pages/journal-2-0/components/notebook/ResearchHome.jsx app/src/pages/journal-2-0/tabs/NotebookTab.jsx <<'MSG'
feat(notebook): New note -> kind -> default style; Choose another style with a preview of my own data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 13: The Styles manager — Notebook › Styles and Settings › Notebook

**Files:**
- Create: `B/styles/StylesManager.jsx` + `.module.css` (lazy)
- Create: `B/styles/StyleEditor.jsx` (imported by the manager)
- Create: `B/styles/outlineText.js` (pure: outline text ⇄ doc)
- Create: `app/src/pages/journal-2-0/components/JournalStylesCard.jsx` (Settings card, renders `null` while off)
- Modify: `app/src/pages/journal-2-0/tabs/NotebookTab.jsx` ("Styles" button beside Import `:2410-2420`; `?styles=1` deep link; lazy dialog)
- Modify: `app/src/pages/Settings.jsx` (`card('journalStyles', <JournalStylesCard />)` after `card('personalApi', ...)` `:2442`)
- Test: `B/styles/outlineText.test.js`, `B/styles/StylesManager.test.jsx`, `J/a11y/journalStyles.a11y.test.jsx` (new)

**Interfaces:**
- Consumes: Task 11's client; `useJ2PropertyDefs` (default export, `/api/j2/property-defs`); `getTemplate`/`TEMPLATES` from `J/lib/notebookTemplates.js`; the member-templates list the TemplatePicker already uses (read `B/MemberTemplates.jsx` and reuse its fetch; do not add a second one); `usePreferences` (`app/src/hooks/usePreferences.js`, default export, returns `{ prefs, setPref, setPrefMerged, loading }`) for `prefs.notebook_kind_mapping` / `setPref('notebook_kind_mapping', 'dismissed')`; `Sheet` (`components/mobile/Sheet.jsx`).
- Produces:
  - `StylesManager({ open, onClose, blockedNoteIds = [] })`, a lazy dialog
  - `StyleEditor({ style, kinds, onSaved, onCancel })`
  - `outlineTextToDoc(text) -> doc` and `docToOutlineText(doc) -> string`. Lines starting `## ` become level-2 headings; `{{block:id}}` lines stay as placeholder paragraphs; blank lines become empty paragraphs; anything else is a paragraph.
  - `JournalStylesCard()` with a link to `/journal/notebook?styles=1`
  - Door `data-tour="journal-styles"` on the Styles button.

**Manager behaviour (spec P1.4):**
- **List by kind.** Each style row shows its name, a "Default" badge and "v{version}", with buttons Edit (or "Duplicate to edit" for a built-in), Duplicate, Set as default, Delete.
- **Delete** is soft. A toast-line in the manager reads "Style deleted." with an **Undo** button (`restoreJournalStyle`), kept until the next action or close.
- **Kinds sub-list:** add a kind (name + icon select from `UICON_NAMES`), rename and delete own kinds; the in-use sentence comes from the server.
- **Mapping offer:** when `getMappingOffer()` returns an offer and the preference `notebook_kind_mapping` is not `"dismissed"`, show "You have N notes with a Research Type. Set their Kind of note to match?" with [Set kinds] (`applyMappingOffer(blockedNoteIds)`) and [Not now] (writes the preference).
- **Editor** fields:
  - Name.
  - Kind (select).
  - Outline picker, radio: "No outline" / "One of my templates" (select) / "Write it here" (textarea using `outlineText`, plus "Start from a built-in outline", which copies `docToOutlineText(TEMPLATES[x].build({}))`).
  - Blocks: one `<li>` per block with a checkbox (`aria-label="Use {label}"`), a timeframe select for chart, **Move up** / **Move down** buttons (`aria-label="Move {label} up"`, disabled at the ends) and a drag handle (`draggable`, `onDragStart`/`onDragOver`/`onDrop` reorder the same array). Unknown ids render "A block from a newer version" with the checkbox disabled and are kept. An "Add a block" select lists the catalog kinds not yet present.
  - Property defaults: one select per user-set `select` property definition (built-in and own, excluding `builtin:note_kind`), first option "Leave empty".
  - **Live preview:** `previewJournalStyle({style: draft})`, debounced 400 ms, rendered with `DocBody`, captioned "Shown with {ticker}, from your notes." or "Add a ticker to a note to see the chart block."
  - Save calls `createJournalStyle` or `updateJournalStyle`; Cancel discards.

- [ ] **Step 1: Write the failing tests**

`B/styles/outlineText.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { outlineTextToDoc, docToOutlineText } from './outlineText'

describe('outline text', () => {
  it('turns lines into headings, placeholders and paragraphs, and back', () => {
    const text = '## The setup\nWhat is the pattern?\n{{block:chart}}\n\n## Risk'
    const doc = outlineTextToDoc(text)
    expect(doc.content.map((n) => n.type)).toEqual(['heading', 'paragraph', 'paragraph', 'paragraph', 'heading'])
    expect(doc.content[2].content[0].text).toBe('{{block:chart}}')
    expect(docToOutlineText(doc)).toBe(text)
  })
  it('an empty text is an empty doc', () => {
    expect(outlineTextToDoc('')).toEqual({ type: 'doc', content: [] })
  })
})
```

`B/styles/StylesManager.test.jsx`: render `<StylesManager open onClose={vi.fn()} />` inside `SWRConfig` with a fetch stub keyed by URL and method. It serves `journal-styles.list.json` for `GET /api/j2/journal-styles`, `journal-styles.get.json` for `GET .../{id}`, `journal-styles.delete.json` / `journal-styles.restore.json` for those calls, `journal-styles.preview.draft.json` for preview, `note-kinds.mapping-offer.json` for the offer, and `{propertyDefs: []}` for `/api/j2/property-defs`. Mock `app/src/hooks/usePreferences` to return `{ prefs: {}, setPref: vi.fn(), setPrefMerged: vi.fn(), loading: false }`. Cases:

```jsx
it('lists styles under their kind with the default badge', async () => { /* heading "Trade plan", a row with "Default" */ })
it('Delete then Undo restores the style', async () => {
  // press Delete on a member style -> "Style deleted." -> Undo -> the restore call was made and the row is back
})
it('reorders blocks with Move up/Move down and keeps an unknown block', async () => {
  // open the style from journal-styles.update.unknown-block.json's body (stub GET to it), add Chart via
  // "Add a block", press "Move Chart of the note’s ticker up", assert the list order changed; the
  // newer-version row's checkbox is disabled
})
it('the mapping offer applies and passes the blocked note ids', async () => {
  // render with blockedNoteIds={['n-blocked']}; press "Set kinds"; the POST body is {excludeNoteIds:['n-blocked']}
})
```

Write each case body in full in the file. The comments above name exactly what each asserts; the assertions use `screen.findByRole`/`getByRole` by accessible name and check the stubbed fetch's recorded calls.

`J/a11y/journalStyles.a11y.test.jsx`:

```jsx
import { describe, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { installFetch, Providers } from './fixtures'
import { axeSurface } from './surface'
import listFixture from '../__fixtures__/contract/journal-styles.list.json'
import getFixture from '../__fixtures__/contract/journal-styles.get.json'
import previewFixture from '../__fixtures__/contract/journal-styles.preview.json'
import KindSection from '../components/notebook/styles/KindSection'
import StylesManager from '../components/notebook/styles/StylesManager'

vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: () => {}, setPrefMerged: () => {}, loading: false }),
}))

describe('journal styles surfaces (P1)', () => {
  axeSurface('kind-section', async () => {
    installFetch([[/^\/api\/j2\/journal-styles$/, listFixture.body], [/\/preview$/, previewFixture.body]])
    render(<Providers><KindSection onKind={() => {}} onStyle={() => {}} /></Providers>)
    await screen.findByRole('group', { name: 'Start from a kind of note' })
  })
  axeSurface('styles-manager', async () => {
    installFetch([[/^\/api\/j2\/journal-styles$/, listFixture.body],
      [/^\/api\/j2\/journal-styles\/[^/]+$/, getFixture.body], [/\/preview$/, previewFixture.body],
      [/mapping-offer$/, { offer: null }], [/property-defs$/, { propertyDefs: [] }]])
    render(<Providers><StylesManager open onClose={() => {}} /></Providers>)
    await screen.findByRole('heading', { name: 'Journal styles' })
  })
})
```

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1/app
npx vitest run src/pages/journal-2-0/components/notebook/styles/outlineText.test.js src/pages/journal-2-0/components/notebook/styles/StylesManager.test.jsx src/pages/journal-2-0/a11y/journalStyles.a11y.test.jsx > "$TEMP/p1-t13a.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL.

- [ ] **Step 3: Implement `outlineText.js`**

```js
// Notebook P1: the style editor writes an outline as text. A line starting "## " is a heading; a line
// that is exactly {{block:id}} is a block placeholder; an empty line is an empty paragraph.
const PH = /^\{\{block:[a-zA-Z][a-zA-Z0-9_]{0,40}\}\}$/
const text = (n) => (n.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('')

export function outlineTextToDoc(src) {
  const lines = String(src || '').split('\n')
  if (lines.length === 1 && lines[0] === '') return { type: 'doc', content: [] }
  return {
    type: 'doc',
    content: lines.map((line) => {
      if (line.startsWith('## ')) {
        return { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: line.slice(3) }] }
      }
      if (!line.trim()) return { type: 'paragraph' }
      return { type: 'paragraph', content: [{ type: 'text', text: PH.test(line.trim()) ? line.trim() : line }] }
    }),
  }
}

export function docToOutlineText(doc) {
  return (doc?.content || []).map((n) => {
    if (n.type === 'heading') return `## ${text(n)}`
    if (n.type === 'paragraph') return text(n)
    return text(n)
  }).join('\n')
}
```

- [ ] **Step 4: Implement the manager, the editor and the card**

Build `StylesManager.jsx` and `StyleEditor.jsx` to the behaviour above, using:
- `Sheet` with `title="Journal styles"`, `labelledByTitle`, `variant="auto"`, `maxWidth={960}`;
- the Task 11 client calls by name;
- native controls (`<select>`, `<input type="checkbox">`, `<textarea>`) with visible `<label>`s;
- the block list as an `<ol aria-label="Blocks in this style">`.

`StylesManager.module.css` gives every button `min-height: var(--tap-min)` (and icon buttons `min-width`) inside `@media (max-width: 1024px)`, and stacks list and editor in one column at `@media (max-width: 640px)`.

`JournalStylesCard.jsx`:

```jsx
// Settings › Notebook door to the Styles manager (spec P1.4). Renders nothing while journal styles are off.
import { Link } from 'react-router-dom'
import TileCard from '../../../components/TileCard'
import { journalStylesEnabled } from '../lib/journalStylesFlag'

export default function JournalStylesCard() {
  if (!journalStylesEnabled()) return null
  return (
    <TileCard icon="sliders" title="Journal styles">
      <p>Set up how each kind of note starts: its outline, its blocks and the properties it fills.</p>
      <Link to="/journal/notebook?styles=1" className="btn btn-ghost">Open journal styles</Link>
    </TileCard>
  )
}
```

The `TileCard` import path is the one `PersonalApiCard.jsx:3` uses (`import TileCard from '../../../components/TileCard'`).

In `Settings.jsx`: `import JournalStylesCard from './journal-2-0/components/JournalStylesCard'`, then `card('journalStyles', <JournalStylesCard />),` after `card('personalApi', <PersonalApiCard />),`.

In `NotebookTab.jsx`:

```jsx
const StylesManager = lazyDialog(() => import('../components/notebook/styles/StylesManager'), 'journal styles')
```

```jsx
  const [stylesOpen, setStylesOpen] = useState(() => searchParams.get('styles') === '1')
  useEffect(() => {
    if (searchParams.get('styles') !== '1') return
    setStylesOpen(true)
    setSearchParams((prev) => { const p = new URLSearchParams(prev); p.delete('styles'); return p }, { replace: true })
  }, [searchParams, setSearchParams])
```

In the list header beside the Import button:

```jsx
            {stylesOn && (
              <button type="button" className={styles.importBtn} onClick={() => setStylesOpen(true)}
                aria-haspopup="dialog" data-tour="journal-styles">
                <UIcon name="sliders" size={16} gold={false} />
                <span className={styles.actionLabel}>Styles</span>
              </button>
            )}
```

and once, beside the other lazy dialogs:

```jsx
      {stylesOn && <StylesManager open={stylesOpen} onClose={() => setStylesOpen(false)} blockedNoteIds={[...(blockedNoteIds || [])]} />}
```

`blockedNoteIds` is the name NotebookTab already passes to ResearchHome (`blockedNoteIds={blockedNoteIds}`). Use the same variable.

- [ ] **Step 5: Run**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1/app
npx vitest run src/pages/journal-2-0/components/notebook/styles/outlineText.test.js src/pages/journal-2-0/components/notebook/styles/StylesManager.test.jsx src/pages/journal-2-0/a11y/journalStyles.a11y.test.jsx src/pages/journal-2-0/a11y/ariaCoverage.test.js src/pages/journal-2-0/tabs/NotebookTab.test.jsx src/pages/Settings.sharingCard.test.js src/components/screener/reachable.test.js src/styles/tapFloor.test.js src/styles/tokens.reachable.test.js > "$TEMP/p1-t13b.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass. If `ariaCoverage.test.js` asks every surface to be covered by a recipe, the two `axeSurface` ids above are the coverage. Register them the way that file's own header says.

- [ ] **Step 6: Mutation-prove keyboard reorder**

Capture `StyleEditor.jsx`. Make the Move up handler a no-op. The reorder test must FAIL. Restore.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/components/notebook/styles app/src/pages/journal-2-0/components/JournalStylesCard.jsx app/src/pages/journal-2-0/tabs/NotebookTab.jsx app/src/pages/Settings.jsx app/src/pages/journal-2-0/a11y/journalStyles.a11y.test.jsx
git commit -F - -- app/src/pages/journal-2-0/components/notebook/styles app/src/pages/journal-2-0/components/JournalStylesCard.jsx app/src/pages/journal-2-0/tabs/NotebookTab.jsx app/src/pages/Settings.jsx app/src/pages/journal-2-0/a11y/journalStyles.a11y.test.jsx <<'MSG'
feat(notebook): Journal styles manager (kinds, styles, blocks with keyboard reorder, outline, live preview) + Settings door

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 14: Inside a note — "Save this note's setup as a style", the update banner, `/style`

Rests on Task 1 §c: with the switch off a styled note renders and nothing here appears.

**Files:**
- Create: `B/styles/StyleUpdateSheet.jsx` (lazy), `B/styles/StyleUpdateBanner.jsx` (lazy), `B/styles/SaveAsStyleForm.jsx` (lazy)
- Modify: `B/NoteMenuActions.jsx` (a "Save this note's setup as a style" button beside "Save as template", `:206`)
- Modify: `B/NoteEditorPage.jsx` (lazy banner under the title; `STYLE_EVENT` listener beside the `CANVAS_EVENT` one `:3636-3650`; the sheet; `adoptServerCopy` `:967` on apply)
- Modify: `B/SlashMenu.jsx` (`/style` item after "Transcript passage"; `TRADING_BLOCKS` gains `'Journal style'`)
- Test: `B/NoteEditorPage.styleUpdate.test.jsx` (new), `B/SlashMenu.style.test.jsx` (new), `B/NoteMenuActions.saveAsStyle.test.jsx` (new)

**Interfaces:**
- Consumes: `planStyleUpdate`, `applyStyleUpdate`, `createJournalStyle`, `useJournalStyles` (Task 11); `journalStylesEnabled`, `STYLE_EVENT` (Task 3); NoteEditorPage's `adoptServerCopy`, `lastSavedRef`, `sendPendingEdits`; NoteMenuActions' `onBeforeTemplate`.
- Produces:
  - `StyleUpdateSheet({ open, onClose, noteId, styleId = null, baseUpdatedAt, waitForSave, onApplied(note) })`. `styleId` null = update to the note's own style's latest; a value = switch (from `/style`).
  - `StyleUpdateBanner({ note, latestVersion, onOpen })`
  - `SaveAsStyleForm({ note, onBeforeSave, onDone })`

**Rules:**
- **The banner** shows only while the switch is on, the note has a `styleId`, and the style is in `useJournalStyles().data.styles` with `version > note.styleVersion`. A deleted style is not in the list, so no banner shows. Words: "This note uses {style name} v{note.styleVersion}. Update layout to v{latest}?" with [Review update].
- **The sheet** loads `planStyleUpdate`. It lists what will be added (`blockLabel`) and what will be left out (with the skip reason in words), and says "Nothing in your note is removed or moved." Apply is disabled while the editor has unsent work. It awaits `waitForSave()` (the editor's `sendPendingEdits`), then calls `applyStyleUpdate(noteId, {styleId, baseUpdatedAt: lastSavedRef.current.updatedAt})`, which lands the write. Then `onApplied(note)` runs, and the editor calls `adoptServerCopy(note)`.
- **A 409** shows "This note changed since you opened it. Nothing was added." and keeps the sheet open with a [Check again] that reloads the plan.
- **`upToDate`** shows "This note already has the latest layout." with Close only.
- **`/style`** dispatches `STYLE_EVENT`. The editor opens a small style chooser: a `Sheet` titled **"Choose a journal style"**, listing the member's styles grouped by kind from `useJournalStyles`. Picking one opens `StyleUpdateSheet` with that `styleId` (a switch).
- **Save as style:** `onBeforeTemplate()` first (send pending edits; if it answers false, show "Some words are still saving. Try again in a moment." and stop). Then show a text field labelled **"Style name"** (defaults to the note title), a select labelled **"Kind of note"** (defaults to the note's Kind of note), and a button **"Save style"**, which calls `createJournalStyle({fromNoteId, name, kindId})`. Words on success: "Saved as the style “{name}”."
- **Accessible names are a contract with the walk (Task 15):** the banner button is **"Review update"**, the sheet's write button is **"Apply"**, its retry is **"Check again"**, and the More-menu button is **"Save this note's setup as a style"**.

- [ ] **Step 1: Write the failing tests**

`B/NoteEditorPage.styleUpdate.test.jsx`. Copy the editor render harness from `NoteEditorPage.moreMenu.test.jsx` (its mocks and providers). Stub fetch for `/api/j2/notes/n1` (a note with `styleId: 's1'`, `styleVersion: 1`, `updatedAt: 'u1'`, a body with a heading), `/api/j2/journal-styles` (list containing `{id: 's1', name: 'Weekend prep', version: 3, kindId: 'weekend_prep', ...}`), and `/apply-style-update` (`notes.apply-style-update.dry-run.json` body for dry run, `notes.apply-style-update.json` for apply). Cases (named for the Review Focus):

```jsx
it('styleUpdate.banner: offers the update with both versions', async () => {
  latchNotebookFlags({ notebook_journal_styles_enabled: true })
  renderEditor()
  expect(await screen.findByText('This note uses Weekend prep v1. Update layout to v3?')).toBeTruthy()
})
it('styleUpdate.waitsForSave: Apply waits for the editor to send pending words, then lands and adopts', async () => {
  // type into the editor, open the sheet, press Apply: the PUT of the pending body is made BEFORE the
  // apply-style-update POST (assert call order on the fetch spy); then the editor shows the added block
})
it('styleUpdate.staleBase: a 409 writes nothing and says so', async () => {
  // stub apply -> [409, {detail: 'This note changed since you opened it. Nothing was added.'}]
  // the sentence renders; the editor body is unchanged; Check again re-requests the plan
})
it('styleUpdate.deletedStyleNoBanner: a note whose style is gone shows no banner', async () => {
  // list without s1 -> no "Update layout" text anywhere
})
it('a styled note renders with the switch off, and no banner or /style shows', async () => {
  // flag not latched; the note body (heading + a chart widgetEmbed) renders; no banner text
})
```

Write every case body in full, using the harness's own helpers.

`B/SlashMenu.style.test.jsx`:

```jsx
import { describe, it, expect, afterEach } from 'vitest'
import { ITEMS, blockItemGroup } from './SlashMenu'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { STYLE_EVENT } from '../../lib/journalStylesFlag'

afterEach(() => __resetNotebookFlags())
const item = () => ITEMS.find((i) => i.title === 'Journal style')

describe('/style', () => {
  it('is a Trading item available only while journal styles are on', () => {
    expect(item()).toBeTruthy()
    expect(blockItemGroup(item())).toBe('trading')
    expect(item().available({})).toBe(false)
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    expect(item().available({})).toBe(true)
  })
  it('dispatches the style event on the editor root', () => {
    const seen = []
    const dom = { dispatchEvent: (e) => seen.push(e.type) }
    const chain = { focus: () => chain, deleteRange: () => chain, run: () => true }
    item().command({ editor: { chain: () => chain, view: { dom } }, range: { from: 1, to: 2 } })
    expect(seen).toEqual([STYLE_EVENT])
  })
})
```

`B/NoteMenuActions.saveAsStyle.test.jsx`: render `NoteMenuActions` as `NoteMenuActions.test.jsx` does, with the switch on and `onBeforeTemplate` resolving `true`. Press "Save this note's setup as a style", type a name into "Style name", press "Save style". Assert the POST body is `{fromNoteId: <note id>, name: <typed>, kindId: <default>}` and that "Saved as the style “<typed>”." renders. A second case: `onBeforeTemplate` resolves `false`, the sentence "Some words are still saving. Try again in a moment." renders, and no POST is made. A third case: with the switch off, the button is absent.

- [ ] **Step 2: Run to see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1/app
npx vitest run src/pages/journal-2-0/components/notebook/NoteEditorPage.styleUpdate.test.jsx src/pages/journal-2-0/components/notebook/SlashMenu.style.test.jsx src/pages/journal-2-0/components/notebook/NoteMenuActions.saveAsStyle.test.jsx > "$TEMP/p1-t14a.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: FAIL.

- [ ] **Step 3: Implement**

`SlashMenu.jsx`: add `import { STYLE_EVENT, journalStylesEnabled } from '../../lib/journalStylesFlag'`. After the "Transcript passage" item, add:

```jsx
  {
    // Notebook P1: /style -- switch this note to a journal style (previewed; adds missing blocks only,
    // never removes or moves the member's text). Dark behind notebook_journal_styles_enabled, and
    // dispatched on this editor's own DOM root like /canvas.
    title: 'Journal style',
    description: 'Switch this note to one of your journal styles — previewed first',
    keywords: ['style', 'layout', 'preset', 'kind', 'outline'],
    available: () => journalStylesEnabled(),
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      editor.view.dom.dispatchEvent(new CustomEvent(STYLE_EVENT, { bubbles: true }))
    },
  },
```

Change `TRADING_BLOCKS` to `new Set(['Trade-plan canvas', 'Transcript passage', 'Journal style'])`.

In `NoteEditorPage.jsx`:
- Three lazy imports through the file's existing lazy helper (`lazyLeaf`, as used for `EmbedBlockActions` in `WidgetEmbedView.jsx`; check NoteEditorPage's own helper name with `grep -n "lazyLeaf\|lazyChunk\|React.lazy" NoteEditorPage.jsx | head`): `StyleUpdateBanner`, `StyleUpdateSheet`, and a `StyleChooser` (a small component inside `StyleUpdateSheet.jsx`, exported as `StyleChooser`).
- State `styleSheet` (`null | {styleId: string | null}`) and `chooserOpen`.
- Add a `STYLE_EVENT` listener next to the `CANVAS_EVENT` one, with the same add/remove pattern: `const onStyle = () => { if (journalStylesEnabled()) setChooserOpen(true) }`.
- Render `{journalStylesEnabled() && note?.styleId && <StyleUpdateBanner note={note} onOpen={() => setStyleSheet({ styleId: null })} />}` under the title block.
- Render the sheet with `baseUpdatedAt={lastSavedRef.current?.updatedAt}`, `waitForSave={sendPendingEdits}`, `onApplied={(n) => { adoptServerCopy(n); setStyleSheet(null) }}`.
- `StyleUpdateBanner` reads `useJournalStyles()` itself, and renders `null` when the style is absent or not newer.

`NoteMenuActions.jsx`: next to the "Save as template" control, add a lazy `SaveAsStyleForm` behind a button "Save this note's setup as a style". It renders only while `journalStylesEnabled()` and passes `onBeforeSave={onBeforeTemplate}`. The form's kind select reads `useJournalStyles()` for kinds.

Build `StyleUpdateSheet.jsx` and `StyleUpdateBanner.jsx` to the Rules above, with `Sheet`, buttons `min-height: var(--tap-min)` at ≤1024 px (module CSS), and every sentence exactly as written there.

- [ ] **Step 4: Run, including the editor's neighbours**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1/app
npx vitest run src/pages/journal-2-0/components/notebook/NoteEditorPage.styleUpdate.test.jsx src/pages/journal-2-0/components/notebook/SlashMenu.style.test.jsx src/pages/journal-2-0/components/notebook/NoteMenuActions.saveAsStyle.test.jsx src/pages/journal-2-0/components/notebook/NoteMenuActions.test.jsx src/pages/journal-2-0/components/notebook/NoteEditorPage.moreMenu.test.jsx src/pages/journal-2-0/lib/offline/doorEnumeration.test.js src/pages/journal-2-0/lib/notebookSchema.rail.test.js src/components/screener/reachable.test.js src/styles/tapFloor.test.js > "$TEMP/p1-t14b.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Expected: all pass. `notebookSchema.rail.test.js` passing proves no node type was added (the Global Constraint). Also run the SlashMenu suite that pins the bare-`/` list (`grep -rln "groupedSlashItems\|SLASH_GROUPS" app/src --include=*.test.*`) and accept only the one added Trading row.

- [ ] **Step 5: Mutation-prove the save-before-apply order**

Capture `StyleUpdateSheet.jsx`. Remove the `await waitForSave()` call. `styleUpdate.waitsForSave` must FAIL. Restore.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/check_repo_hygiene.py
git add app/src/pages/journal-2-0/components/notebook/styles app/src/pages/journal-2-0/components/notebook/NoteMenuActions.jsx app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx app/src/pages/journal-2-0/components/notebook/NoteEditorPage.styleUpdate.test.jsx app/src/pages/journal-2-0/components/notebook/SlashMenu.style.test.jsx app/src/pages/journal-2-0/components/notebook/NoteMenuActions.saveAsStyle.test.jsx
git commit -F - -- app/src/pages/journal-2-0/components/notebook/styles app/src/pages/journal-2-0/components/notebook/NoteMenuActions.jsx app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx app/src/pages/journal-2-0/components/notebook/NoteEditorPage.styleUpdate.test.jsx app/src/pages/journal-2-0/components/notebook/SlashMenu.style.test.jsx app/src/pages/journal-2-0/components/notebook/NoteMenuActions.saveAsStyle.test.jsx <<'MSG'
feat(notebook): save a note's setup as a style, previewed Update layout banner, /style switch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 15: Walk steps at 1280/820/390, door-audit rows, the bytes check

**Files:**
- Modify: `tools/notebook_fin_walk.py` (`WAVE_FLAGS` `:78-86`: add `"NOTEBOOK_JOURNAL_STYLES_ENABLED"`)
- Modify: `tools/notebook_fin_walk_features.py` (`ORDER` `:35-37`: add `"styles"` before `"discover"`; a `styles()` step registered with `run("styles", styles)` before `run("discover", discover)`)
- Modify: `tools/notebook_door_audit_doors.json` (two rows)
- Create: `docs/notebook/evidence/fin-walk/<tip>/c2/` (walk record) and `docs/notebook/evidence/door-audit-<stamp>/` (audit record)

**Interfaces:**
- Consumes: from `notebook_fin_walk` as `C`: `C.step(pg, inst, feature, name, verdict, **evidence)`, `C.goto(pg, base, path, wait=...)`, `C.new_ctx(browser, vp, storage=None)`, `C.Inst(ctx, cfg, vp)`, `C.vis_loc(loc, timeout)`. Within `run_c2`: `ctx`, `inst`, `pg`, `M`, `base`, `browser`, `cfg`.
- Produces walk features `styles.new-from-kind`, `styles.manager`, `styles.save-as-style`, `styles.update-layout`, `styles.slash-style`, `styles.unknown-block` and `styles.coverage`. Each runs at 1280, and `styles.new-from-kind` and `styles.manager` also run at 820 and 390.

- [ ] **Step 1: Write the walk step**

In `run_c2`, before `def discover():`, add:

```python
    # ── Notebook P1: journal styles, at 1280 / 820 / 390 ──────────────────────────────────
    def styles():
        state = ctx.storage_state()

        def at(vp):
            if vp == "1280":
                return pg, inst, None
            c = C.new_ctx(browser, vp, storage=state)
            return c.new_page(), C.Inst(c, cfg, vp), c

        for vp in ("1280", "820", "390"):
            p, i, c = at(vp)
            try:
                C.goto(p, base, "/journal/notebook?view=all", wait="main")
                p.get_by_role("button", name=re.compile(r"^New note$")).first.click()
                group = p.get_by_role("group", name="Start from a kind of note")
                C.vis_loc(group, 15000)
                before = len(C.notes_list(ctx, base))
                group.get_by_role("button", name="New Trade plan").click()
                C.vis_loc(p.locator(".ProseMirror").first, 20000)
                body = p.locator(".ProseMirror").first.inner_text()
                after = len(C.notes_list(ctx, base))
                box = group.evaluate("g => { const b = g.querySelector('button'); const r = b.getBoundingClientRect(); return {h: r.height, w: r.width} }") if vp != "1280" else None
                ok = after == before + 1 and "The setup" in body and (vp == "1280" or (box and box["h"] >= 44))
                C.step(p, i, "styles.new-from-kind", f"New note -> Trade plan makes a note in the Trade plan style ({vp})",
                       "PASS" if ok else "FAIL", notes_before=before, notes_after=after, first_button=box)
                C.goto(p, base, "/journal/notebook?styles=1", wait="main")
                dlg = p.get_by_role("dialog", name="Journal styles")
                C.vis_loc(dlg, 15000)
                inside = dlg.evaluate("d => { const r = d.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= -1 }")
                C.step(p, i, "styles.manager", f"Settings/deep link opens the Styles manager inside the viewport ({vp})",
                       "PASS" if inside else "FAIL", inside=inside)
            finally:
                if c is not None:
                    c.close()

        # 1280 only: save as style, update layout, /style, and an unknown block's card
        r = M.post(base + "/api/j2/notes", data={"title": "Walk source", "ticker": "NVDA", "kindId": "thesis"})
        src = r.json()["note"]
        C.goto(pg, base, f"/journal/notebook?note={src['id']}", wait=".ProseMirror")
        pg.get_by_role("button", name="More note actions").first.click()
        pg.get_by_role("button", name="Save this note's setup as a style").click()
        pg.get_by_label("Style name").fill("Walk style")
        pg.get_by_role("button", name="Save style").click()
        saved = C.vis_loc(pg.get_by_text("Saved as the style “Walk style”."), 10000)
        C.step(pg, inst, "styles.save-as-style", "More -> Save this note's setup as a style creates the style",
               "PASS" if saved else "FAIL", saved=saved)
        listing = M.get(base + "/api/j2/journal-styles").json()
        mine = next((s for s in listing["styles"] if s["name"] == "Walk style"), None)
        n = M.post(base + "/api/j2/notes", data={"styleId": mine["id"], "ticker": "NVDA"}).json()["note"] if mine else None
        if mine:
            M.put(base + f"/api/j2/journal-styles/{mine['id']}", data={"blocks": [{"block": "chart", "enabled": False, "settings": {}}]})
            M.put(base + f"/api/j2/journal-styles/{mine['id']}", data={"blocks": [{"block": "chart", "enabled": True, "settings": {"tf": "W"}}]})
        C.goto(pg, base, f"/journal/notebook?note={n['id']}", wait=".ProseMirror")
        banner = C.vis_loc(pg.get_by_text(re.compile(r"Update layout to v\d+\?")), 15000)
        if banner:
            pg.get_by_role("button", name="Review update").click()
            pg.get_by_role("button", name="Apply").click()
            pg.wait_for_timeout(2500)
        got = M.get(base + f"/api/j2/notes/{n['id']}").json()["note"]
        conflicted = [x for x in C.notes_list(ctx, base) if "(conflicted copy)" in (x.get("title") or "")]
        ok = banner and got.get("styleVersion") == (mine or {}).get("version", 0) + 2 and not conflicted
        C.step(pg, inst, "styles.update-layout", "The banner's Review update -> Apply adds the block, stamps the version, forks nothing",
               "PASS" if ok else "FAIL", style_version=got.get("styleVersion"), conflicted=len(conflicted))
        ed = pg.locator(".ProseMirror").first
        ed.click()
        pg.keyboard.press("Control+End")
        pg.keyboard.press("Enter")
        pg.keyboard.type("/style", delay=40)
        pg.keyboard.press("Enter")
        chooser = C.vis_loc(pg.get_by_role("dialog", name=re.compile("Choose a journal style")), 10000)
        C.step(pg, inst, "styles.slash-style", "/style opens the style chooser", "PASS" if chooser else "FAIL", opened=chooser)
        future = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "x"}]},
                  {"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": "walkFutureBlock", "params": {"a": 1},
                   "searchText": "[future block]"}}]}
        fb = M.post(base + "/api/j2/notes", data={"title": "Future block", "bodyJson": future}).json()["note"]
        C.goto(pg, base, f"/journal/notebook?note={fb['id']}", wait=".ProseMirror")
        card = C.vis_loc(pg.get_by_text("This block needs a newer version of the app. Reload to see it."), 10000)
        pg.wait_for_timeout(3000)
        kept = any(x.get("attrs", {}).get("widgetId") == "walkFutureBlock"
                   for x in M.get(base + f"/api/j2/notes/{fb['id']}").json()["note"]["bodyJson"]["content"])
        C.step(pg, inst, "styles.unknown-block", "A block from a newer version shows the card and is still in the saved note",
               "PASS" if card and kept else "FAIL", card=card, kept=kept)
        want = {"styles.new-from-kind", "styles.manager", "styles.save-as-style", "styles.update-layout",
                "styles.slash-style", "styles.unknown-block"}
        seen = {s.get("feature") for s in C.REC["steps"] if s.get("config") == cfg}
        C.step(None, inst, "styles.coverage", "every journal-styles feature left a row", "PASS" if want <= seen else "FAIL",
               missing=sorted(want - seen), shot=False)
    run("styles", styles)
```

`C.notes_list(ctx, base)` takes the browser context (`notebook_fin_walk.py:362`, `def notes_list(ctx, base: str) -> list[dict]`); the per-viewport contexts share the main member's session, so counting through `ctx` counts the same notes. The accessible names used here ("Style name", "Save style", "Choose a journal style", "Review update", "Apply") must match Task 13/14's components exactly; fix the component, never the walk, when they differ from the Rules' wording.

- [ ] **Step 2: Add the door-audit rows**

Append to `tools/notebook_door_audit_doors.json` (edit as text; keep the file's formatting):

```json
  {
    "feature": "Journal styles manager (P1)",
    "audit_row": 54,
    "path": "/journal/notebook?view=all",
    "steps": [],
    "target": {"role": "button", "name": "Styles"},
    "viewports": ["1280", "390"],
    "flag": "NOTEBOOK_JOURNAL_STYLES_ENABLED",
    "note": "A P1 door, numbered after the 2026-10-11 audit's 53 rows."
  },
  {
    "feature": "New note from a style (P1)",
    "audit_row": 55,
    "path": "/journal/notebook",
    "steps": [{"click": "button|More ways to start a note"}],
    "target": {"role": "menuitem", "name": "From a style"},
    "viewports": ["1280", "390"],
    "flag": "NOTEBOOK_JOURNAL_STYLES_ENABLED",
    "note": "Research Home's New note caret."
  }
```

"Save this note's setup as a style" gets no door row: the audit's only seed is `find_similar` (`tools/notebook_door_audit.py:120`, `SEEDS = ("find_similar",)`), so it cannot open a note. The walk step `styles.save-as-style` measures that door in a real browser instead.

- [ ] **Step 3: Run the pure rails**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python -m pytest tests/test_notebook_door_audit.py -q
python tools/notebook_door_audit.py --self-check
```

Expected: pass; self-check exit 0.

- [ ] **Step 4: Build, bytes, sandbox and walk c2 (PowerShell for the data dir)**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1/app
npm run build > "$TEMP/p1-build.log" 2>&1; code=$?; echo "BUILD EXIT: $code"; exit $code
```

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/notebook_perf_budgets.py --dist app/dist --json "$TEMP/p1-bytes-after.json" > "$TEMP/p1-bytes.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

Then measure the base. In the gate worktree from Task 16 Step 1, or a detached worktree of `b4282b5d9d` with the same `node_modules` junction, run `npm run build` and the same command into `p1-bytes-before.json`. Expected: exit 0 on both, and after − before ≤ 2,048 B. Record both numbers and the delta in the PR body. A larger delta means a P1 module reached the first-open closure; find it from the tool's chunk list and make it lazy before landing.

```powershell
python tools/notebook_fin_walk.py --config c2 --data-root 'C:\Users\Patrick\AppData\Local\Temp\nb-p1-walk' --port 8132 --out 'C:\Users\Patrick\uct-worktrees\notebook-p1\docs\notebook\evidence\fin-walk\<tip>\c2' --tip <tip>
```

Expected: 0 FAIL. Diff verdicts against the latest committed c2 record (`docs/notebook/evidence/fin-walk/a93a693b8b/c2/walk.json`). Any step that passed there and fails now is a regression to fix before landing.

- [ ] **Step 5: Door audit against the same sandbox**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/notebook_door_audit.py --base http://127.0.0.1:8132 --doors tools/notebook_door_audit_doors.json --out docs/notebook/evidence
```

Expected: exit 0. Rows 54 and 55 are EASY or OK at 1280 and 390, and no row is HIDDEN.

- [ ] **Step 6: Commit the walk change and evidence**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python tools/check_repo_hygiene.py
git add tools/notebook_fin_walk.py tools/notebook_fin_walk_features.py tools/notebook_door_audit_doors.json docs/notebook/evidence
git commit -F - -- tools/notebook_fin_walk.py tools/notebook_fin_walk_features.py tools/notebook_door_audit_doors.json docs/notebook/evidence <<'MSG'
test(notebook): P1 journal styles walk steps (1280/820/390) and door rows; evidence (0 FAIL, 0 HIDDEN)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
MSG
```

---

### Task 16: Exit bar — six-shard gate from a gate worktree, Python rails on the landing tree, report

- [ ] **Step 1: A gate worktree with a `notebook-*` branch name** (a gate never shares a tree with an implementer)

```bash
SHA=$(git -C /c/Users/Patrick/uct-worktrees/notebook-p1 rev-parse HEAD)
git -C /c/Users/Patrick/uct-worktrees/notebook-p1 worktree add -b notebook-p1-gate /c/Users/Patrick/uct-worktrees/notebook-p1-gate "$SHA"
printf 'session: 016WSfoBTwnfA4irnCiBs3XZ\ncreated: 2026-10-11\n' > /c/Users/Patrick/uct-worktrees/notebook-p1-gate/.uct-session-owner
```

```powershell
New-Item -ItemType Junction -Path C:\Users\Patrick\uct-worktrees\notebook-p1-gate\app\node_modules -Target C:\Users\Patrick\uct-worktrees\notebook-k\app\node_modules
Get-Item C:\Users\Patrick\uct-worktrees\notebook-p1-gate\app\node_modules -Force | Select-Object LinkType, Target
```

- [ ] **Step 2: Print free memory and agent count; then gate**

```powershell
(Get-Counter '\Memory\Available MBytes').CounterSamples.CookedValue
```

Expected: ≥ 8,000 MB available and no other gate running. Otherwise wait.

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1-gate
python scripts/gate_shards.py --shards 6 --out docs/notebook/gate-runs/p1-landing > "$TEMP/p1-gate.log" 2>&1; code=$?; echo "GATE EXIT: $code"; exit $code
```

Read the manifest under `docs/notebook/gate-runs/p1-landing/`: the totals line, the file-count reconciliation, and `GATE EXIT`. An `INVALID-*.md` is the environment, never a verdict about the branch. Classify any NEW failure by running it alone on the branch and on `b4282b5d9d`.

- [ ] **Step 3: Python rails on the landing tree** (C4-python: this branch touches `api/`, `tools/` and `tests/`)

Merge `origin/master` into the branch first if it moved (one merge, no rebase). Then run, on that tree:

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p1
python -m pytest tests/test_notebook_unknown_block_kind.py tests/test_note_kinds.py tests/test_note_kind_property.py tests/test_journal_styles_store.py tests/test_journal_styles_compose.py tests/test_notebook_journal_styles_router.py tests/test_journal_styles_create.py tests/test_journal_styles_update.py tests/test_notebook_contract_fixtures.py tests/test_notebook_flag_parse.py tests/test_feature_flag_ledger.py tests/test_account_deletion_manifest.py tests/test_journal_two_note_templates_router.py tests/test_journal_two_properties_router.py tests/test_notebook_template_gallery.py tests/test_notebook_schema_guard.py tests/test_notes_cas_is_atomic.py tests/test_notes_answer_is_the_committed_row.py tests/test_notebook_door_audit.py -q > "$TEMP/p1-py-landing.log" 2>&1; code=$?; echo "EXIT: $code"; exit $code
```

```bash
python tools/gate_carry_over.py --help
```

Read `--help`, then run the carry-over check the way it prints, against the gated tree and the landing tree. UNKNOWN is never a pass; a C1–C3 failure means re-gate.

- [ ] **Step 4: PR body and report**

Open the PR from `notebook-p1-styles` (one master merge at a time, `web` SUCCESS before any other push). The body says:
- what shipped;
- that it ships DARK;
- the P1.7 finding (link the doc);
- the two spec deviations, with their reasons: the offline create queue that does not exist (Task 11), and the three added endpoints (preview, restore, mapping-offer);
- the bytes before, after and delta;
- the walk and door-audit numbers;
- that the NVDA pass on the style editor (spec §6) runs at ARMING against production with `tools/notebook_nvda_pass.py` (it drives production with the smoke account, and P1 is dark until armed). It is recorded as owed, never as passed;
- that the typing-latency re-measure with blocks present (spec §6) belongs to P2, because P1 adds no block kind beyond the existing chart.

The body ends with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016WSfoBTwnfA4irnCiBs3XZ
```

After merge, verify the deploy by its artifact: the `railway deployment list` meta commitHash, then uptime ≥ 730 s, then `python tools/hub_nav_smoke.py --auth`, then `git merge-base --is-ancestor <merge sha> origin/production`. H15: a failing smoke means roll back first; INCONCLUSIVE is not FAILED. Arming `NOTEBOOK_JOURNAL_STYLES_ENABLED` is a separate, later step under the owner's standing go, with the ledger updated in the same docs push.

- [ ] **Step 5: Clean up the session's worktrees** (only those `.uct-session-owner` names)

```powershell
cmd /c rmdir C:\Users\Patrick\uct-worktrees\notebook-p1-gate\app\node_modules
```

```bash
git -C /c/Users/Patrick/uct-worktrees/notebook-p1 worktree remove /c/Users/Patrick/uct-worktrees/notebook-p1-gate
```

---

## Self-review (done at write time)

**Spec coverage:**
- P1.1 concepts and words → Global Constraints, Tasks 4, 12, 13.
- P1.2 data model:
  - `j2_note_kinds` → Task 4.
  - `j2_journal_styles` with the unique partial default index → Task 6.
  - `j2_notes.style_id/style_version/kind_id` → Task 6 (columns) and Tasks 7 and 10 (stamped in one write).
  - `builtin:note_kind` → Task 5.
  - The research_type mapping offer → Task 4 (service), Task 8 (routes), Task 13 (UI).
- P1.3 apply through `createNoteViaApi` with a server-composed outline, block placeholders and after-first-heading → Tasks 7 and 9. Snapshot semantics → Task 6 (versions; editing never touches notes). "Update layout to vN", previewed, adds only → Tasks 10 and 14.
- P1.4 surfaces:
  - New note → kind → default, plus "Choose another style" with a live preview → Task 12.
  - The manager (create, duplicate, rename, default, soft delete with undo; block list toggle, drag and up/down, per-block settings; outline picker; live preview with the member's own data) → Task 13.
  - Settings › Notebook → Task 13.
  - "Save this note's setup as a style" → Task 14.
  - `/style` → Task 14. "Each block appears in the Trading group": P1's only block, the chart, is already a Trading capture item (`groupedSlashItems` puts widget captures first). New blocks are P2's.
- P1.5 API → Tasks 8–10, each endpoint with contract fixtures. Additions: preview, restore, mapping-offer, and item paths for kinds.
- P1.6 rules:
  - Paid → Tasks 8 and 9.
  - The dark flag → Task 3.
  - Offline: cache → Task 11; queue → resolved as refusal, see the deviation in Task 11.
  - `_PREFERENCE_KEYS` → Task 4.
- P1.7 → Tasks 1 and 2 (and §c rails in Tasks 5 and 14).
- §6:
  - Lazy chunks and the bytes check → Tasks 12–15.
  - Accessibility (44 px, names, keyboard reorder) → Tasks 12–14; axe in Task 13.
  - NVDA → owed at arming (Task 16, reason given).
  - Typing baseline → P2 (reason given).
  - Purge and manifest → Tasks 4 and 6.
- Walk at 1280/820/390, the door audit and the exit bar → Tasks 15 and 16.

**Placeholders:** none of the forbidden forms remain. The lookups first left as commands were resolved at write time and are now cited by line:
- `delete_property_def` (`note_properties.py:302`);
- `read_capped_body` (`request_body_cap.py:102`);
- the tokens `--border`, `--text-muted` and `--accent`;
- `usePreferences`' return shape (`usePreferences.js:385`);
- `TileCard`'s path (`PersonalApiCard.jsx:3`);
- the door audit's `SEEDS` (`notebook_door_audit.py:120`).

One lookup remains as an explicit command with a no-contract fallback: NoteEditorPage's own lazy-import helper name (Task 14).

The test bodies in Tasks 13 and 14 that are described by their assertions must be written in full by the step that names them. The plan states exactly what each asserts.

**Type consistency:**
- `style_stamp` is `(style_id, style_version, kind_id)` on `create_note` (Task 7) and `(style_id, style_version)` on `update_note` (Task 10). Both are internal, both are stated.
- `compose(...) -> {bodyJson, properties, skipped, styleId, styleVersion, kindId}` is consumed unchanged by Tasks 9 and 10.
- `Plan` (Task 10) is consumed by Task 11's `planStyleUpdate`/`applyStyleUpdate` and Task 14's sheet.
- `KindSection({onKind, onStyle, busy})` matches NotebookTab's wiring (Task 12).
- `journalStylesEnabled`, `STYLE_EVENT` and `JOURNAL_STYLES_FLAG` keep the same names in Tasks 3, 5, 12, 13 and 14.
- `NOTE_KIND_PROPERTY = "builtin:note_kind"` is used everywhere server side.
- `BLOCK_KINDS` has the same name on both sides, railed.

**Review Focus:** each of the five lines names its owning test, and each test is written in its task (Tasks 6, 7, 9 and 14).
