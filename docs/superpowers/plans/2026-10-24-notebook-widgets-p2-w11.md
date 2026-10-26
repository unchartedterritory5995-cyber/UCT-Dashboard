# Notebook Widgets Phase 2, Wave 11 (Template Library, Sharing and Adoption) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship, dark behind `NOTEBOOK_WIDGETS_W11_ENABLED`, the template library: template slots for built widgets, routines and trackers in the existing journal-styles grammar; inline definition copies with id remap on use and adoption; ONE structure-only sharing reducer for widgets, routines, trackers and templates with a share preview and a canary rail; three new gallery item types; an adoption sheet with "pick yours" slots, suggested values and an immediate preview; the template routine/tracker reuse question with next-trading-day and trading-week binding; preview with my data on a template's detail; 27 official templates; the helpful 3-day rule and its 3rd-day prompt; and the Templates tab of My tools. At the end, the owner's 50-member test campaign over waves 8-11.

**Architecture:** A template is a journal style (`j2_journal_styles`). Phase 2 slots are block ids the existing regex already accepts (`built_<k>`, `routine_<k>`, `tracker_<k>`); the target lives in the block's settings (`{"ref": "shelf:<slug>"}`, `{"ref": "def:<uuid>"}`, `{"ref": "inline:<key>"}`, `{"template": "<key>", "bind": ...}`), reduced on every write by `journal_styles.slot_settings_of`. `compose` fills them create-only, last, under the existing slot budget and pool: a built slot runs its pinned plan through the wave 8 engine and becomes a `builtWidget` node; a routine or tracker slot becomes a W9 trader block bound to a day. Sharing never copies a stored row: `widget_engine/share.py` builds a NEW payload from an allowlist, turning every member value into a typed "pick yours" slot, and only text the author typed in the share preview travels. Adoption resolves every slot, then writes the member's own rows and rewrites every inline ref in ONE transaction. Official templates are firm-style gallery rows of a new `kind = 'official'`, seeded append-only, visible only while the library switch and wave 11 are on.

**Tech Stack:** React + TipTap + Vitest (`app/src`); FastAPI + sqlite + pytest (`api/`); Playwright (Python) for the campaign.

**Spec:** `docs/superpowers/specs/2026-10-24-notebook-widgets-phase2-design.md` (§1-§4.1, §5.8, §6.2 and §16.3 binding, §9, §10, §13 wave 11 row and its flag paragraph, §14, §16.7, §17), on top of `docs/superpowers/specs/2026-10-19-notebook-widgets-design.md`. Format and earlier interfaces: `docs/superpowers/plans/2026-10-24-notebook-widgets-p2-w7-w8.md`, `-w9.md`, `-w10.md`. Rulings R-1..R-37 (`.superpowers/sdd/2026-10-24-notebook-widgets-p2-w7-w8/progress.md`), W9-R1..R22 (`.superpowers/sdd/2026-10-24-notebook-widgets-p2-w9/progress.md`) and W10-R1..R12 (the wave 10 plan) carry over, notably R-1 anchors are hints, R-9 one build at a time, R-14 controller review of mechanical diffs, R-15 If-Match = `etag`, R-25 account names never public, R-26 a `builtWidget` frozen attr is public only as a bool, R-27 missing If-Match = 428, R-33 "plan" in copy only as "trading plan", W9-R3 `needed_version`, W9-R4 routines and trackers are trader blocks (no `KIND_WAVE`, no `BLOCK_KINDS` row), W9-R7 no zeros on the measure path, W9-R12 a template-key create restores a soft-deleted row, W9-R14 the error class is the status authority, W9-R15 cross-module reads through PUBLIC functions, W9-R18 an unresolved ref is one notice, W10-R5 shelf revisions are immutable and every placement pins `defRev`.

## Global Constraints

- No note schema change. Template slots produce nodes the schema already holds: `builtWidget` (a `widgetEmbed` snapshot kind, wave 8) and `routine` / `tracker` (trader blocks, wave 9). `PLACEHOLDER_RE`, `BLOCK_ID_RE` (`journal_styles.py:52`, `:780`) and `components/notebook/styles/outlineText.js` do not change. A task that finds it needs a node, mark or attr change in `lib/notebookSchema.js` or `notebook_schema.py` stops and comes back to the owner.
- First-open bytes: budget **2,260,793 B**, never raised (last recorded 2,178,133 B at Task 9.1; wave 10's readings are in its commits). Gate: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist` must print `VERDICT: PASS`. It runs in every task that touches an eager file, named per task (11.1, 11.14, 11.18, 11.21). The share preview, the adoption sheet, the Template library section, the Templates tab, the prompt line body and `lib/templateLibrary.js` are lazy; eager additions are limited to the flag rows, six `SNAPSHOT_BLOCK_LABELS` rows, the slot-family branch in `blockLabel`, and one guarded dynamic import in `NoteEditorPage.jsx`. A lazy task that finds itself importing into an eager file stops and moves that line into the next eager task.
- Wave 11 flag: `NOTEBOOK_WIDGETS_W11_ENABLED`, default `False`, read per request through `notebook_widgets_wave_on(11)`. Payload key `notebook_widgets_w11_enabled`, latched per tab. Wired in ONE commit (Task 11.1). Rollback is `=0`, never a delete. With the flag off: every new route answers the `public.not_found()` 404; the three new item types are absent from every gallery read; official templates are absent; `served_style` hides every slot of the three families and its placeholder, and `update_style` keeps them on save (the existing `_hidden_slots_at` rule); `compose` drops them (no node, no skip line); adopting a listed style that holds a family slot answers `ADOPT_UNSUPPORTED_SENTENCE`; Helpful behaves exactly as in wave 10; the Templates tab says `"Templates are coming soon."` (the existing `COMING_SOON.templates`). Stored styles, definitions, routines, trackers, credits, use-days and listings are kept and reappear when the flag is switched back on.
- Slot families also need their own waves: a `built_<k>` slot is hidden while wave 8 is off or while its plan needs a dark wave (`uses_tools` and wave 9 off, `uses_wave10` and wave 10 off); a `routine_<k>` or `tracker_<k>` slot is hidden while wave 9 is off. One function decides (`journal_styles._slot_wave_off`).
- ⛔ Sharing is structure only, through ONE reducer (`widget_engine/share.py`, ruling W11-R1). No stored member text travels: names, descriptions, formula field names, routine item text, tracker names and units travel only as the author's `edits` from the share preview, and numbers only when listed in `keep` (ruling W11-R6). No member value, account name, filter value, id, routine text, tracker value or day state ever survives a share; the canary rail (Task 11.4) proves it for every kind.
- ⛔ Live state never enters a note. A template's routine and tracker blocks hold only `{routineId|trackerId, day, bind, display}`; opening, ticking, answering the 3rd-day prompt and opening a template's detail produce ZERO `docChanged` transactions and ZERO note PUTs. `lib/offline/doorEnumeration.test.js` and `lib/blocks/blockDoors.test.js` stay green with no new exception.
- Day binding (spec §6.2, §16.3; ruling W11-R14): at instantiation, `note-day` is the new note's day (`dailyDate` when it is one, else the note's created ET day); `next-trading-day` is `trading_days.next_session_after(note_day)`; `week` is the last session of the Monday-to-Sunday week containing the note's day (so a Saturday or Sunday review binds the week just ended), labelled `"For the week of <Mon D>"` from that week's Monday. "Follow today" (`bind: 'today'`) is never a template value; a slot that names it is refused.
- Ownership: `user_id` from the session only. A `def:`, `routine:` or `tracker:` ref is validated as the member's own at FILL time (`WHERE id = ? AND user_id = ?`); a ref that does not resolve for the current member (foreign, unknown, deleted) is one sentence in the note (`"This widget is not in your account."`, `"This routine is not in your account."`, `"This tracker is not in your account."`), never a read of another member's row (W9-R18). Every adoption answer naming a row is checked the same way (`"That choice isn't in your account."`).
- Plans: a definition created by adoption is stored with `v = plan.needed_version(plan)` (W9-R3); a shared or seeded plan newer than the server is refused with `"This widget was made with a newer version of the app. Reload to use it."`. Every placement a template makes pins `defRev` (W10-R5, §16.1): shelf refs carry the revision the template was made with; `def:` refs carry the member's revision at save; adoption copies start at revision 1.
- ⛔ Released shelf files and released official template rows never change (W10-R5, R-P5-4): to change an official template, add a `-v2` row and retire the `-v1` one. Railed against `origin/master` (Task 11.10); the rail FAILS, never skips, when git or `origin/master` cannot be read.
- Public pages: nothing new is public. Notes made from templates hold ordinary `builtWidget`, `routine` and `tracker` nodes, so the wave 8 rules (share off by default, R-25 account labels, R-26 frozen as bool) and the wave 9 neutral line apply unchanged. Author credit uses the gallery's opaque handle only (R-P3-2); an email-looking or empty display name reads `"A UCT member"` (`ANONYMOUS_AUTHOR`).
- Rates (in-process slowapi, ⚠️ per-process state): the share preview and preview with my data share the existing `notebook-gallery-preview` scope (60/hour); publishing shares the existing publish scope (10/hour); adoption, use and helpful-prompt writes take the existing gallery write scope; the journal-styles archive routes take that router's existing scope. Request bodies at most 16 KB (`16 * 1024`) on the new gallery routes, depth 16 (`json_depth`).
- Errors: `{"detail": {"code": str, "message": str}}`; every 200 and every error `Cache-Control: no-store`. New codes: `unresolved` (400), `not_yours` (400), `own_words` (400), `helpful_days` (409), `adopted` (400), `count_cap` (409, the stores' own sentences). Refusals are `share.ShareError(tool_errors.ToolError)` and `template_library.LibraryError(tool_errors.ToolError)`; the router never matches sentences (W9-R14).
- Every number shown goes through `notebook_widgets._num`: NaN or Infinity becomes `null`. ⛔ No zeros (W9-R7): no card, preview or line shows `0`, `$0`, `0%`, `"Used by 0 traders"` or `"(0)"`; an unused item's card reads `"New"`.
- Member words: Widget, Routine, Tracker, Template. "definition", "shelf", "slot", "payload", "reducer", "plan" (except "trading plan", R-33), "scope" and "journal style" never appear in UI copy. The section is titled "Template library". No emoji; icons are `UIcon` names. Every touch target is at least 44 px (`styles/tapFloor.test.js`).
- New tables carry `user_id`, are created by `db.ensure_schema` (statements appended to `_PHASE_2_ALTERS`), are listed in `account_purge._DIRECT_USER_TABLES`, are covered by a tombstone-replay test (`account_tombstones.replay_on_db`), and `docs/account-deletion-manifest.md` is regenerated with `python tools/account_deletion_manifest.py --write`.
- Repo rules: run tests in their own tool call, read the totals line, then commit in a separate call. Backend: `python -m pytest <named files> -q`, never a directory. Frontend: `cd app && npx vitest run <paths>`. Files are LF. Run `python tools/check_repo_hygiene.py` before each commit. Commit with `git commit -F - <<'MSG'` ... `MSG`, the message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, with an explicit pathspec (other agents work in the same worktree). Push the branch after each task. Never create scratch worktrees or junctions (the 7.6 incident); measure in place. Never `git checkout` a file to undo a mutation probe (restore by SHA).

### Rulings made by this plan (W11-R1..R14)

- **W11-R1 (one reducer, one module).** The reducer and its siblings live in `api/services/journal_two/widget_engine/share.py` (`share_plan`, `share_routine`, `share_tracker`, `share_template`, `resolve_plan`), not in `plan.py`: it must reduce routines, trackers and templates too, and `plan.py` stays the pure validator. Nothing else in the repo builds a shared payload; a rail asserts every gallery write of the four kinds goes through it.
- **W11-R2 (slot refs).** `built_<k>` settings: `{"ref": "shelf:<slug>" | "def:<uuid4>" | "inline:<key>", "defRev": int >= 1, "range": {"token": <RANGE_TOKENS>}}` (`defRev` required for `shelf:` and `def:`, absent for `inline:`; `range` optional). `routine_<k>`: exactly one of `{"ref": "routine:<uuid4>"}`, `{"template": "<key>"}`, `{"inline": "<key>"}`, plus `bind` in `("note-day", "next-trading-day", "week")` (default `"note-day"`) and `display` in `("items", "pnl")` (default `"items"`). `tracker_<k>`: the same with `{"ref": "tracker:<uuid4>" | "checkin:mood" | "checkin:focus"}` and `display` in `("chart", "pnl")` (default `"chart"`). `<k>` is 1-2 lowercase letters or digits, `<key>` is 1-8. A member's own style holds `def:`, `routine:` and `tracker:` refs; only shared payloads and official seeds hold `inline:` and `template` refs; adoption rewrites every one of them in the same transaction.
- **W11-R3 (`KNOWN_BLOCKS` is a prefix test).** `KNOWN_BLOCKS` becomes an instance of `class _KnownBlocks(frozenset)` whose `__contains__` also answers True for `SLOT_ID_RE` matches, so every existing `bid in KNOWN_BLOCKS` site (`journal_styles`, `template_gallery._safe_listed`, `style_payload`, `starter_packs`) accepts the families with no call-site change; iteration is unchanged. One authority, railed by a test over every module that names it.
- **W11-R4 (official templates).** The 27 templates of spec §10, item for item, ship as gallery rows `kind = 'official'`, `item_type = 'style'`, ids `firm_style_id(seed_key)`, seed keys `uct-template-<slug>-v1`, author label `"UCT"`, with a new `template_group` column. They are visible only while the library switch AND wave 11 are on (independent of starter packs). Using one adopts it ONCE (the member's newest live copy with that `source_gallery_id` is reused) and makes the note from the copy, so the copy is the member's template in My tools and the helpful count reads its notes.
- **W11-R5 (pick markers).** In a shared plan, each stripped value is `{"pick": "p<n>"}` in its place (a filter value, `accounts`, a `ref`, a `prop`); a stripped formula literal is the field token `[#p<n>]`. A payload's `slots` list types each id with one of the ten §16.7 types (`setup`, `tag`, `symbol`, `account`, `property`, `folder`, `note_kind`, `routine`, `tracker`, `number`) and says whether "Any" (drop the filter) is allowed. Values of closed enums (side, result, weekday, hour and hold buckets, regime, the routine-history day states) are structure and stay. A text literal in a formula that is not an enum value refuses the share with `"Field 1 uses your own words. Change that part before sharing."` (its field number).
- **W11-R6 (only what the author types travels).** The reducer keeps no stored member text. The share preview PREFILLS the name, description, formula field names, routine item text, tracker name and unit, so the author sees exactly what will travel, and only what comes back as `edits` is shared. A template's outline (headings and prompts) is the template's structure, shared as P3a already does through `sanitize_body` (which strips every embed, mention, link and image); it is shown in the preview and is outside the canary, except anything `sanitize_body` must strip.
- **W11-R7 (credit).** A new table `j2_gallery_credits` snapshots `(author handle, item title)` for every copy at adoption. The credit reads `"Based on <label>'s <title>"`; `<label>` is `"UCT"` for official and firm rows, the author's gallery display label while their `j2_gallery_authors` row exists, and the line becomes `"Based on a former member's <title>"` once it does not. A withdrawn listing keeps its credit (the snapshot).
- **W11-R8 (helpful 3-day rule).** While wave 11 is on, marking Helpful on a `style`, `widget_definition`, `routine` or `tracker` item needs use on 3 different days; `outline` and `page_layout` items are unchanged. Days are ET calendar days (`trading_days.et_day_of`), never `substr(created_at, 1, 10)` (a UTC day; the spec's SQL is replaced on that one point by the repo's day rule). Templates count distinct ET days of the member's live notes whose `style_id` is one of their copies of the item; the three tool types read `j2_gallery_use_days`.
- **W11-R9 (the prompt's answer).** The 3rd-day line's answer is stored in a new table `j2_gallery_helpful_prompts (user_id, item_id, answer, answered_at)`, `answer` in `("yes", "not_really", "dismissed")`; "Yes" also marks Helpful. The line is shown once per (member, item), only on a note made on the member's 3rd-or-later use day, never on the author's own item.
- **W11-R10 (the Templates tab is the member's styles).** My tools Templates lists the member's own `j2_journal_styles` rows. `j2_journal_styles` gains `archived_at TEXT`; an archived template is hidden from TemplatePicker, the kind section and default choice (archiving the default clears `is_default`), keeps every note's style stamp, and is restored from the Archived filter. "Delete permanently" is only from Archived, needs the name typed, and calls the existing soft `delete_style`; Recently deleted lists 30 days and then refuses restore (rows are never hard-deleted here: notes' style stamps and Update layout read them).
- **W11-R11 (use-days).** `INSERT OR IGNORE INTO j2_gallery_use_days (user_id, item_id, day)` with the ET day, only for a copy whose `source_gallery_id` is set and whose author is not the member: on a `/run` of an adopted widget's definition (lane `run` only), a tick or skip on an adopted routine, a log on an adopted tracker. Never on a preview, an example or a public render.
- **W11-R12 (preview with my data).** `POST /api/j2/template-gallery/{gallery_id}/preview-mine` runs at most 8 widget cards through the examples lane (`run.run_plans_batch`), as the viewer, only for the viewer's own data, with each pick slot at its suggested value or "Any"; routine and tracker slots preview as their item list or kind, never day state. Cached per `(gallery id, version, viewer, ET day, answers hash)` for 300 s. A member with fewer than 5 trades sees the Sample data cards (the wave 8 rule, labelled).
- **W11-R13 (template-made routines and trackers).** Creation is unique on `(user_id, source_template_key)` (W9-R12 restore applies): `tpl:<template key>` for an official template's routine or tracker, `gal:<gallery id>:<inline key>` for a member-shared one. The template's title is stored in the tool's settings as `fromTemplate` (at most 80 characters) and My tools reads `"From template: <fromTemplate>"`. Deleting the note never deletes the tool.
- **W11-R14 (day binding twins).** The server (`tool_binding.py`) and the client (`lib/blocks/toolDays.js`, wave 9) compute the bound day and the search text from ONE vector file, `tests/fixtures/toolBindingVectors.json`, read by both; neither re-derives the other's answer.

## Review Focus

1. **A share that leaks.** A widget, routine, tracker and template whose every stored field carries the canary `zzq-canary-7f3a` and the number `987654.321`: names, descriptions, formula names, formula literals, filter values, `accounts`, property, folder and kind ids, routine and tracker ids and item ids, item text, tracker unit, an account named `zzq-canary-7f3a Fidelity`, a tag `\u007aZQ-CANARY-7F3A` (escaped and case-shifted), and the template's slot settings. With empty `edits` and `keep`, neither `json.dumps(payload)` nor `json.dumps(payload, ensure_ascii=False)` contains the canary in any case or the number in any format (`987654.321`, `987,654.32`, `9.87654321e5`). Owned by Tasks 11.4 and 11.8.
2. **The same template used twice at once.** Two tabs press Use on Pre-market prep within 50 ms; a double-click on Use; one tab creates the routine while the other picks "Use your Morning routine". One routine exists, one style copy exists, two notes exist, both notes' routine blocks name the same routine id, and nothing 500s. Owned by Tasks 11.6, 11.8 and 11.12.
3. **Binding at calendar edges.** Night-before prep made Sunday 2026-11-22 at 21:00 ET (binds Mon 11-23), on Wed 2026-11-25 (binds Fri 11-27, skipping Thanksgiving, the half day is a session), and at 23:30 ET on Thu 11-26 (04:30 UTC Fri; still binds Fri 11-27); Weekend swing review made Sat 2026-10-24 (binds Fri 10-23, "For the week of Oct 19") and in a week whose Friday is a holiday (binds the Thursday). The server and the client agree on every vector. Owned by Tasks 11.2 and 11.14.
4. **Refs that do not resolve.** A hand-made style naming member B's definition, routine and tracker ids; the member's own definition deleted 31 days ago; an archived routine; a listing withdrawn while the adoption sheet is open; an author who deleted their account. The note shows the slot's sentence, no other member's row is read (a spy proves it), the archived routine renders its read-only block, the adoption answers the 404, and the credit reads "Based on a former member's …". Owned by Tasks 11.5, 11.6 and 11.8.
5. **Flags off and a thin account.** Wave 11 off with styles holding family slots (hidden, kept on save, back on re-arm); wave 10 off with Goal setting placed (its W10 slot hidden, the rest fills); a member with no trades, no setups and no routines opening Setup study (the setup slot has no suggestion and "Any" is not offered for it, so the preview card says `"Pick a setup to see this widget."`, never a zero) and with 3 trades (Sample data, labelled). Owned by Tasks 11.3, 11.9, 11.10 and 11.17.

## Order, lanes and parallel work

The owner asked for more simultaneous work. Concurrency cap: 5 agents while available memory stays above about 4 GB (the wave 9 ledger's measured rule); builds stay one at a time (R-9). Every lane commits with pathspecs.

- **Task 11.1 first** (controller, R-14, in `nbw-p2-impl`; it runs a build).
- **Backend, `nbw-p2-be`** (only `api/`, `tests/`, `docs/account-deletion-manifest.md`, plus the one client file named in Task 11.7; zero first-open bytes). Wave 10's backend merge must have landed first.
  - Start together (disjoint files): **11.2** (`trading_days.py`, new `tool_binding.py`, the vector file), **11.3** (`journal_styles.py` grammar only), **11.4** (new `widget_engine/share.py`), **11.7** (`template_gallery.py` DDL and type tables, `db.py`, `account_purge.py`, `lib/styleLibrary.js`). Four agents.
  - Lane S (slots, `journal_styles.py` owner): **11.3 → 11.5 → 11.6 → 11.13**. 11.5 and 11.6 add new modules (`slot_fill.py`, `template_tools.py`) and the `compose` / `create_style_from_note` branches; 11.13 adds archive to the store after them.
  - Lane G (gallery, `template_gallery.py` owner): **11.7 → 11.8 → 11.10 → 11.11**. 11.8 needs 11.4 and 11.6.
  - Lane P (preview): **11.9** after 11.4 and 11.5, in parallel with 11.8 (new modules `gallery_suggest.py`, `template_preview.py`, and `run.py`'s one new function).
  - **11.12** (routers) last, after 11.8-11.11 and 11.13.
- **Merge** `feat/notebook-widgets-p2-be` into `feat/notebook-widgets-p2` after 11.12 (the R-7 pattern), with the backend suites of Task 11.21 Step 1 green.
- **Frontend, `nbw-p2-impl`** (one `npm run build` at a time). Lazy tasks run vitest only and may run concurrently on disjoint files; eager tasks are serialized. Wave 9's Tasks 9.12-9.19 and wave 10's frontend must have landed (11.17 and 11.19 consume `toolsCrud.js`, `toolDays.js`, `RoutinesTab.jsx`, `TrackersTab.jsx`).
  - Lazy, concurrent: **11.15**, **11.17**, then **11.16** (after 11.17: its Use opens the adoption sheet) and **11.19** (after 11.15: its Share action opens the share preview). They code against the backend shapes in this plan and mock `fetch` until the merge.
  - Eager, serialized: **11.1 → 11.14 → 11.18.**
- Tasks **11.20** and **11.21** last.

---

### Task 11.1: Flag wiring in every place

**Files:**
- Modify: `api/routers/auth.py` (`NOTEBOOK_FLAGS`, after the W10 row)
- Modify: `app/src/pages/journal-2-0/lib/offline/notebookFlags.js` (`FLAG_FALLBACKS`, after the W10 row)
- Modify: `app/src/pages/journal-2-0/lib/notebookWidgetsFlags.js` (`WAVES`)
- Modify: `docs/feature_flags.json` (after the `NOTEBOOK_WIDGETS_W10_ENABLED` entry)
- Modify: `tests/test_notebook_flags.py` (pins)
- Test: `tests/test_notebook_flags.py`, `tests/test_notebook_flag_table_form.py`, `tests/test_notebook_flag_parse.py`, `app/src/pages/journal-2-0/lib/notebookWidgetsFlags.test.js`

**Interfaces:**
- Produces: `"NOTEBOOK_WIDGETS_W11_ENABLED": False,  # enablement — unset means OFF (notebook widgets, wave 11)`; `notebook_widgets_w11_enabled: false, // notebook widgets, wave 11 — absent ⇒ OFF`; `WAVES = Object.freeze([1, 2, 3, 4, 5, 6, 8, 9, 10, 11])`; `widgetsWaveOn(11)`; server `notebook_widgets_wave_on(11)` (generic reader, no change).
- The ledger entry: `member_facing: {label: "Template library, sharing and adopting widgets, routines and trackers", where: "Notebook"}`, `status: "dark"`, `where: ["web"]`, a note naming this plan, "read per request through notebook_widgets_wave_on(11)", "needs NOTEBOOK_STYLE_LIBRARY_ENABLED and NOTEBOOK_JOURNAL_STYLES_ENABLED (both armed)", "with the flag off template slots are hidden and kept, official templates and the three new library types are absent, and every stored template, copy, credit and listing is kept", the arm line `railway variables --service web --set NOTEBOOK_WIDGETS_W11_ENABLED=1` (the owner's) and the rollback `=0` (never a delete; a delete does not restart the process).
- ⚠️ Deviation from spec §13, on purpose: wave 11 has no new snapshot kind, so no `KIND_WAVE` row lands; `_slot_wave_off`'s family coverage lands in Task 11.3 with the families themselves (the W10 precedent).

- [ ] **Step 1: Write the failing tests.** Add `notebook_widgets_w11_enabled` to the pinned list. In `notebookWidgetsFlags.test.js`: `widgetsWaveOn(11)` is false unlatched and true once latched; `widgetsWaveOn(7)` and `widgetsWaveOn(12)` are always false.
- [ ] **Step 2:** Run `python -m pytest tests/test_notebook_flags.py tests/test_notebook_flag_table_form.py tests/test_notebook_flag_parse.py -q` and `cd app && npx vitest run src/pages/journal-2-0/lib/notebookWidgetsFlags.test.js`. Expected: FAIL.
- [ ] **Step 3:** Add the four rows in one change.
- [ ] **Step 4:** Run both commands. Expected: PASS.
- [ ] **Step 5:** Bytes (two eager files): `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`. Expected: `VERDICT: PASS`.
- [ ] **Step 6:** Commit: `feat(notebook): dark release flag for notebook widgets wave 11`.

### Task 11.2: Day binding and search text, server twin and shared vectors

**Files:**
- Modify: `api/services/journal_two/trading_days.py` (two functions)
- Create: `api/services/journal_two/tool_binding.py` (pure: no I/O beyond `trading_days`)
- Create: `tests/fixtures/toolBindingVectors.json`
- Test: `tests/test_trading_days.py`, `tests/test_tool_binding.py` (new), `tests/test_tool_binding_vectors.py` (new)

**Interfaces:**
- Produces in `trading_days.py`: `et_day_of(ts: str) -> str | None` (the ET calendar date of an ISO timestamp through `zoneinfo("America/New_York")`; a bare `YYYY-MM-DD` is returned as is; anything else None; ⛔ NOT `timeutil.compute_trading_day_et`, whose UTC-midnight rule would date a note made at `00:00:00Z` on the UTC day); `last_session_of_week(d: date) -> date` (the last session in the Monday-to-Sunday week containing `d`; a week with none answers `session_on_or_before(<that Sunday>)`).
- Produces in `tool_binding.py`:
  - `BINDS = ("note-day", "next-trading-day", "week")`, `KINDS = ("routine", "tracker")`.
  - `note_day(*, daily_date: str | None, created_at: str | None, now: datetime) -> str`: `daily_date` when it is a valid `YYYY-MM-DD`, else `et_day_of(created_at)`, else `today_et(now)`.
  - `bind_day(note_day: str, bind: str) -> str`: `note-day` → `note_day`; `next-trading-day` → `next_session_after(note_day)`; `week` → `last_session_of_week(note_day)`. Raises `ValueError` for any other `bind` (a template never binds `today`).
  - `week_monday(day: str) -> str` (from the date parts, no time zone).
  - `for_day_label(day: str, bind: str) -> str`: `"For Tue Oct 27"`; for `week`, `"For the week of Oct 19"` from `week_monday(day)` (the W9 client's `forDayLabel` words, exactly).
  - `search_text(kind: str, name: str, day: str, bind: str) -> str`: `"[routine: Pre-market routine · For Tue Oct 27]"`, `"[tracker: Sleep · For the week of Oct 19]"` (the W9 client's `toolSearchText`, exactly).
- The vector file (version 1, LF): `bind` cases (≥ 20: every row of Review Focus 3, a horizon day past 2028-12-31 counting weekdays, a half day, a Monday after Good Friday 2027-03-29, New Year's Day 2027-01-01), `label` cases (≥ 10), `search` cases (≥ 8, including a name with `·`, `]` and an emoji), and `note_day` cases (≥ 6: a daily date wins; `2026-10-28T03:30:00Z` gives `2026-10-27`; `2026-10-28T00:00:00Z` gives `2026-10-27`).

- [ ] **Step 1: Write the failing tests:**
  - `tests/test_tool_binding_vectors.py`: `test_bind_vectors`, `test_label_vectors`, `test_search_vectors`, `test_note_day_vectors`, `test_every_bind_appears_in_three_vectors` (non-vacuity count).
  - `tests/test_tool_binding.py`: `test_today_is_refused_for_a_template`, `test_week_on_saturday_binds_the_friday_before`, `test_week_with_a_friday_holiday_binds_thursday` (2026-07-03 is the observed Independence Day holiday: a Sat 2026-07-04 note binds Thu 2026-07-02), `test_next_trading_day_skips_thanksgiving`, `test_midnight_utc_note_dates_to_the_et_day`.
  - `tests/test_trading_days.py`: `test_et_day_of_bare_date_and_iso`, `test_last_session_of_week_all_holiday_week_falls_back`.
- [ ] **Step 2:** Run `python -m pytest tests/test_tool_binding.py tests/test_tool_binding_vectors.py tests/test_trading_days.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement. Commit the vector file FIRST in its own commit (`test(notebook): shared day-binding vectors`) so Task 11.14 can start, then the modules.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): template day binding and search text with shared vectors`.

### Task 11.3: Slot instance ids, `slot_settings_of` and the prefix `KNOWN_BLOCKS`

**Files:**
- Modify: `api/services/journal_two/journal_styles.py` (`SLOT_ID_RE`, `SLOT_FAMILIES`, `_KnownBlocks`, `slot_settings_of`, `_clean_blocks`, `_slot_wave_off`, `CREATE_ONLY_BLOCKS`, `SNAPSHOT_SLOT_KINDS`)
- Test: `tests/test_journal_styles_slots.py` (new), `tests/test_journal_styles_store.py`, `tests/test_journal_styles_compose.py`, `tests/test_journal_styles_schema.py`, `tests/test_starter_packs.py`, `tests/test_style_library_adopt.py`

**Interfaces:**
- Produces:
  - `SLOT_FAMILIES = ("built", "routine", "tracker")`; `SLOT_ID_RE = re.compile(r"^(built|routine|tracker)_[a-z0-9]{1,2}$")`; `INLINE_KEY_RE = re.compile(r"^[a-z0-9]{1,8}$")`; `slot_family(block_id: str) -> str | None`.
  - `class _KnownBlocks(frozenset)` with `__contains__(x)` = `frozenset.__contains__(self, x) or (isinstance(x, str) and SLOT_ID_RE.match(x) is not None)`; `KNOWN_BLOCKS = _KnownBlocks(<today's members>)` (W11-R3).
  - `SNAPSHOT_SLOT_KINDS` gains, in this order after the six: `"myRiskLeftToday"`, `"myGamePlan"`, `"myTiltCheck"`, `"myRevengeClean"`, `"myPropFirm"`, `"myAlertsFired"` (wave 10 kinds; `_slot_wave_off` reads their `KIND_WAVE` 10, and the loop that writes `SKIP_SENTENCES` covers them). `myPlanVsActual` is not a slot (it needs a trade pick).
  - `slot_settings_of(family: str, settings: Any) -> dict` (W11-R2 shapes exactly; raises `StyleValidationError` with): `S_SLOT_REF = "Pick a widget for this spot."` (no ref, a bad prefix, a `shelf:` id that is not in `shelf.examples()` order, a `def:` that is not a uuid4, a bad inline key), `S_SLOT_REV = "This widget's version couldn't be read."` (missing or non-integer `defRev` where required, or `defRev` on an inline ref), `S_SLOT_RANGE = "That date range isn't available."` (a `range` that is not `{"token": t}` with `t` in `plan.RANGE_TOKENS`), `S_SLOT_TOOL = "Pick a routine or tracker for this spot."` (none or more than one of `ref` / `template` / `inline`, a bad id, a `template` key not in `template_tools` (validated lazily once Task 11.6 lands; until then any `[a-z0-9_]{1,40}` key)), `S_SLOT_BIND = "Pick the day this block is for."` (`today` or anything outside `BINDS`), `S_SLOT_DISPLAY = "That display isn't available."`. Unknown keys are dropped. Defaults are written explicitly (`bind`, `display`).
  - `_clean_blocks`: a family id is reduced through `slot_settings_of` (not `_nw.settings_of`, which keeps only short `SETTING_KEYS` strings); the "each block id once" rule is unchanged, so a template holds several widgets by holding several instance ids.
  - `_slot_wave_off(block_id, settings=None)`: a family id is hidden while `notebook_widgets_wave_on(11)` is off; a routine or tracker family also while wave 9 is off; a built family also while wave 8 is off, and, when `settings` names a `shelf:` ref, while its pinned revision's plan needs a dark wave (`uses_tools` and wave 9 off, `uses_wave10` and wave 10 off; the plan is read through `shelf.revision(id, rev)`). `def:` and `inline:` plans are checked at fill time (Task 11.5) because reading them needs the database. Every existing caller passes the block's settings where it has them (`served_style`, `_hidden_slots_at`, `compose`, `_plan`).
  - `CREATE_ONLY_BLOCKS` is a `_KnownBlocks`-style set that answers True for every family id (slots fill only when a note is made, IR-S11).
- ⛔ Built-in styles (`BUILTIN_STYLES`) do not change and their versions are not bumped.

- [ ] **Step 1: Write the failing tests** (`tests/test_journal_styles_slots.py`):
  - `test_family_ids_pass_the_unchanged_regexes` (`built_a`, `routine_1`, `tracker_zz` match `BLOCK_ID_RE` and `PLACEHOLDER_RE` as `{{block:built_a}}`; `built_abc`, `built_A`, `widget_a` are not family ids).
  - `test_known_blocks_prefix_test_reaches_every_module`: for each module that names `KNOWN_BLOCKS` (found by an AST scan of `api/services/journal_two/*.py`, with a non-vacuity floor of 3 modules), the name it imports is the `_KnownBlocks` instance and `"built_a" in it` is True.
  - `test_slot_settings_shapes` (one case per sentence above, plus unknown keys dropped and defaults written).
  - `test_today_bind_refused_with_sentence`.
  - `test_style_holds_two_built_slots_and_one_each_of_routine_tracker`.
  - `test_slot_wave_off_matrix` (W8, W9, W10, W11 each off alone; a `shelf:` ref whose pinned revision needs wave 10).
  - `test_served_style_hides_family_slots_and_placeholders_when_w11_off` and `test_update_style_keeps_hidden_family_slots` (the `_hidden_slots_at` rule).
  - `test_dedicated_kinds_are_slots_with_skip_sentences` (each of the six has its `widget-failed:` and `widget-preview:` sentence from `KIND_TITLE`).
  - `tests/test_starter_packs.py` and `tests/test_style_library_adopt.py` stay green unchanged (the prefix test accepts nothing they did not accept before for their own block ids).
- [ ] **Step 2:** Run `python -m pytest tests/test_journal_styles_slots.py tests/test_journal_styles_store.py tests/test_journal_styles_compose.py tests/test_journal_styles_schema.py tests/test_starter_packs.py tests/test_style_library_adopt.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): template slot ids for widgets, routines and trackers in the style grammar (dark)`.

### Task 11.4: The sharing reducer and its canary rail

**Files:**
- Create: `api/services/journal_two/widget_engine/share.py` (pure: no I/O, no clock; callers pass the rows)
- Test: `tests/test_widget_share.py` (new), `tests/test_widget_share_canary.py` (new), `tests/test_widget_share_resolve.py` (new)

**Interfaces:**
- Consumes: `plan.validate_plan`, `plan.summary`, `plan.default_name`, `plan.needed_version`, `sources.CATALOG` (field types and enum values), `widget_formula.compile_formula` / `display` (wave 10).
- Produces:
  - `SLOT_TYPES = ("setup", "tag", "symbol", "account", "property", "folder", "note_kind", "routine", "tracker", "number")`; `TYPE_LABELS = {"setup": "Setup", "tag": "Tag", "symbol": "Symbol", "account": "Account", "property": "Property", "folder": "Folder", "note_kind": "Kind of note", "routine": "Routine", "tracker": "Tracker", "number": "Number"}`; `MAX_SLOTS = 20`; `PICK_TOKEN_RE = re.compile(r"\[#p(\d{1,2})\]")`; `CANARY_SAFE_KEYS` (the closed set of plan keys whose values are structure: `v`, `source`, `view`, `display`, `sort`, `compare`, `split.by`, `split.then`, `measures[].key`, `measures[].agg`, `filters[].field`, `filters[].op`, `range.token`).
  - `class ShareError(ToolError)` (status 400; codes `own_words`, `adopted`, `invalid`, `unresolved`, `not_yours`).
  - `@dataclass(frozen=True) class Shared: payload: dict; slots: tuple[dict, ...]; kept: tuple[str, ...]; not_shared: tuple[str, ...]` (`not_shared`: member sentences of what was left out, for the preview, e.g. `"Your account is left out; people pick their own."`).
  - `share_plan(plan: dict, *, catalog, edits: dict | None = None, keep: Iterable[str] = (), slot_start: int = 1) -> Shared`: builds a NEW dict by walking `CANARY_SAFE_KEYS` and the typed values only. Filter values on `setup`, `tag`, `symbol`, `folder`, `kind`, `property`, `routine` / `tracker` refs and a one-account `accounts` become `{"pick": "p<n>"}` with their slot type (`any: True` for filters, `any: False` for refs and a `property_sum` prop); numeric filter values become `number` slots unless their path (`"filters/<i>/values/<j>"`) is in `keep`; enum filter values stay (W11-R5); free-text filter values and fixed dates are dropped (the filter goes, a fixed range becomes `{"token": "last_90d"}`); `target` numbers are dropped unless kept (`"display/target"`). Formulas: names become `"Field 1"`..`"Field n"` unless `edits["formulas"][id]` names them; numeric literals become `[#p<n>]` number slots (`any: False`) unless their path `"formulas/<id>/<char offset>"` is in `keep`; a text literal that is not an enum value of the field it is compared with raises `ShareError("own_words", "Field <n> uses your own words. Change that part before sharing.")`. The name is `edits["name"]` or `plan.default_name`; the description is `edits["description"]` or `plan.summary` with no count. Every edit string is trimmed, at most 80 characters for names and 280 for descriptions (`"A name can be at most 80 characters."`, `"A description can be at most 280 characters."`).
  - `share_routine(routine: dict, *, edits: dict | None = None) -> Shared`: `{"name": edits["name"] or "Routine with <n> items", "items": [{"text": t, "negative": bool}]}` for exactly the `edits["items"]` texts (at most 25, each at most 200); no ids, no schedule history, no ticks, no `suggest` numbers unless kept (`"items/<i>/suggest"`), no settings except the done share and the schedule kind (`"every"`, `"weekdays"` with the weekday list, `"traded"`). No items in `edits` raises `ShareError("invalid", "Pick at least one item to share.")`.
  - `share_tracker(tracker: dict, *, edits: dict | None = None) -> Shared`: `{"name": edits["name"] or "<Kind> tracker", "kind": kind, "unit": edits["unit"] or None, "days": "trading"|"any"}` (`<Kind>` from `"Yes / no"`, `"Number"`, `"1-5 scale"`, `"Duration"`); never a value.
  - `share_template(style: dict, *, definitions: Mapping[str, dict], routines: Mapping[str, dict], trackers: Mapping[str, dict], edits: dict | None = None, keep: Iterable[str] = ()) -> Shared`: `definitions` / `routines` / `trackers` are the member's own rows keyed by the slot's ref (the caller has already checked ownership and refused adopted ones); each `def:` slot becomes `inline:<k>` with `payload["definitions"] = [{"key", "plan", "name", "description"}]` reduced by `share_plan` (slot ids numbered across the template so one answer can fill several widgets, `slot_start` threads them); `shelf:` refs stay with their `defRev`; `routine:` / `tracker:` refs become `{"inline": <k>}` with `payload["routines"]` / `payload["trackers"]` reduced by `share_routine` / `share_tracker` (edits keyed by slot id); `template` refs stay; `checkin:*` refs stay; `bind` and `display` stay; `range` stays as a token. The outline is NOT this function's (the caller runs `sanitize_body`, W11-R6). `payload["format"] = 2`.
  - `resolve_plan(plan: dict, slots: Sequence[dict], answers: Mapping[str, Any], *, catalog) -> dict`: substitutes each answer (`{"any": true}` drops the filter or turns `accounts` to all, only where `any` is True; a number answer replaces `[#pN]` with its plain decimal text; a text answer is the value). An unanswered slot raises `ShareError("unresolved", "Pick a value for each choice, or Any.")`; a number slot answered with a non-number raises `ShareError("invalid", "Type a number for <Label>.")`. The result is validated by `plan.validate_plan` and contains no `{"pick": …}` and no `[#p` (railed). Ownership of answered ids is the CALLER's (Task 11.8), with `"That choice isn't in your account."`.
  - `has_unresolved(obj: Any) -> bool` (total; finds a pick marker or token anywhere).
- ⛔ `share.py` imports no database module and never reads `user_id`; a test walks its AST.

- [ ] **Step 1: Write the failing tests:**
  - `tests/test_widget_share_canary.py`: `test_canary_never_survives_a_widget_share`, `test_canary_never_survives_a_routine_share`, `test_canary_never_survives_a_tracker_share`, `test_canary_never_survives_a_template_share` (each plants `CANARY = "zzq-canary-7f3a"`, an upper-cased copy, a `\u`-escaped copy and `987654.321` in every stored field of the Review Focus 1 list, with empty `edits` and `keep`; asserts against `json.dumps(payload)` and `json.dumps(payload, ensure_ascii=False)`, case-insensitively, and the number in its three formats); `test_only_edited_text_and_kept_numbers_travel` (with `edits` naming the canary in `name` and `keep` naming one threshold path, exactly those two appear and nothing else); `test_canary_rail_has_teeth` (a planted reducer that copies `plan["filters"]` verbatim makes each of the four tests red: run through the same assertion helper on a monkeypatched `share_plan`).
  - `tests/test_widget_share.py`: `test_values_become_typed_slots` (one case per type), `test_enum_values_are_structure`, `test_fixed_dates_become_last_90_days`, `test_formula_names_become_field_n`, `test_formula_numeric_literal_becomes_token_unless_kept`, `test_formula_text_literal_refuses_own_words`, `test_template_def_refs_become_inline_and_slot_ids_are_shared`, `test_shelf_and_template_refs_stay`, `test_routine_share_needs_items_and_drops_ids`, `test_tracker_share_never_carries_a_value`, `test_name_defaults_to_generated`, `test_share_module_reads_no_database` (AST: no import of `sqlite3`, `db`, `auth_db`, `get_connection`; non-vacuity control on a planted snippet).
  - `tests/test_widget_share_resolve.py`: `test_resolve_each_type_and_any`, `test_any_refused_where_not_allowed`, `test_unresolved_refused`, `test_number_slot_needs_a_number`, `test_resolved_plan_validates_and_has_no_marker`, `test_resolve_round_trip_preserves_needed_version` (a v3 formula plan stays v3; a v1 plan stays v1).
- [ ] **Step 2:** Run `python -m pytest tests/test_widget_share.py tests/test_widget_share_canary.py tests/test_widget_share_resolve.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Mutation proof (by hand, restored by SHA): make `share_plan` keep `filters[].values`; the canary tests go red; restore.
- [ ] **Step 6:** Commit: `feat(notebook): one structure-only sharing reducer for widgets, routines, trackers and templates`.

### Task 11.5: Built slots: save as template, pinned fill and inline copies

**Files:**
- Create: `api/services/journal_two/slot_fill.py`
- Modify: `api/services/journal_two/journal_styles.py` (`BLOCK_BUILDERS` rows for the built family through `slot_fill.build_built_slot`; `compose`'s deferred branch takes family slots; `create_style_from_note` turns `builtWidget` nodes into `built_<k>` slots; `slot_skip_sentence`)
- Test: `tests/test_slot_fill_built.py` (new), `tests/test_journal_styles_slots.py`, `tests/test_journal_styles_compose.py`, `tests/test_journal_styles_create.py`

**Interfaces:**
- Consumes: Task 11.3; `widget_definitions.resolve_for_run(user_id, def_id, def_rev, conn=)`; `shelf.revision(id, rev)` (wave 10); `run.run_plan(user_id, plan, settings, lane="run", def_id=, def_rev=)`; `plan.uses_tools`, `plan.uses_wave10`.
- Produces in `slot_fill.py`:
  - `class SlotCtx(TypedDict)`: `user_id`, `now`, `note_day`, `fill_widgets`, `definitions` (`{key: plan}` for `inline:` refs, set by the caller of a use or adoption, else `{}`), `answers`, `choices`, `conn`.
  - `build_built_slot(block: dict, ctx: dict) -> tuple[dict | None, str | None]`: resolves the ref: `shelf:` → `shelf.revision(id, defRev)` (an unknown revision → reason `slot-missing:<id>`); `def:` → `widget_definitions.resolve_for_run(user_id, uuid, defRev)` (None for foreign, unknown or deleted → reason `slot-missing:<id>`; a plan needing a dark wave → no node and no line, like `_slot_wave_off`); `inline:` → `ctx["definitions"][key]` (absent → `slot-missing:<id>`). Runs it through `run.run_plan(..., lane="run")` with `settings = {"range": settings["range"]}` when set; builds the node `{"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": "builtWidget", "embedId": uuid4().hex, "mode": "snapshot", "params": <the run payload plus defId, defRev and the frozen def ("def" when its JSON is at most 4 KB, else "defRef": {"defId", "defRev"}), the client's builtRefreshParams rule>, "capturedAt": payload["asOf"], "annotations": [], "caption": None, "layout": {"width": "full", "height": None}, "fallback": None}}`. `share` is never set (default off). A run that raises answers `widget-failed:<id>`. A preview (`fill_widgets` False) reads nothing and answers `widget-preview:<id>`.
  - `slot_title(block: dict, ctx: dict) -> str`: a shelf entry's name, an inline definition's `name`, the member's definition's name (owned read), else `"Widget"`.
- Produces in `journal_styles.py`:
  - `slot_skip_sentence(block: dict, reason: str, ctx: dict) -> str | None`: `slot-missing:*` → `"This widget is not in your account."` (built), `"This routine is not in your account."`, `"This tracker is not in your account."`; `widget-failed:*` → `"<title> couldn't load. Type / to add it again."`; `widget-preview:*` → `"<title> fills in with your own data when you make a note."` (the existing wording, unchanged for the snapshot kinds). `compose`'s `place()` uses it for family slots, `SKIP_SENTENCES` for the rest.
  - `create_style_from_note`: a `builtWidget` node becomes `{"block": "built_<k>", "enabled": True, "settings": {"ref": "def:<defId>", "defRev": <defRev>}}` (or `shelf:<slug>` with its `defRev`, `1` when absent, W10-R5) at its place, `<k>` assigned `a`, `b`, … `z`, `a1` … in document order; `range` is kept when the node's viewer `range` is a token; `accountId` and `filter` are dropped (the member's viewer values). A node with no `defId` is left out with reason `"not-a-style-block"`. Routine and tracker nodes are Task 11.6's.
- ⛔ The slot path keeps the deadlock rule (`journal_styles.py:892-900`): `build_built_slot` runs inside the slot pool's task and calls `run_plan` synchronously, which takes the engine's own admission gate, never a second pool.

- [ ] **Step 1: Write the failing tests** (`tests/test_slot_fill_built.py`):
  - `test_save_as_template_turns_built_widgets_into_slots_in_place` (two widgets, one shelf, one member definition at revision 3; ids `built_a`, `built_b`; `accountId` and `filter` gone; `range` token kept).
  - `test_fill_runs_the_pinned_revision` (the member saves revision 4 after the style was made; the note runs revision 3).
  - `test_fill_node_shape_matches_the_client_insert` (keys equal to `builtRefreshParams`' output on the same payload, read from a fixture the wave 8 client test also reads; `def` vs `defRef` at 4 KB).
  - `test_foreign_def_ref_is_a_sentence_and_reads_nothing_foreign` (a style naming member B's id: the sentence, and a spy on `widget_definitions` sees only `user_id = A` queries).
  - `test_deleted_def_31_days_is_a_sentence`.
  - `test_def_needing_wave10_while_off_is_dropped_silently`.
  - `test_inline_ref_reads_ctx_definitions_only`.
  - `test_preview_reads_nothing_and_names_the_widget` (`fill_widgets=False`).
  - `test_slot_budget_still_bounds_a_slow_built_slot` (a patched slow `run_plan` past `SLOT_BUDGET_S` answers `widget-failed`).
  - `test_update_layout_never_offers_a_family_slot` (create-only).
- [ ] **Step 2:** Run `python -m pytest tests/test_slot_fill_built.py tests/test_journal_styles_slots.py tests/test_journal_styles_compose.py tests/test_journal_styles_create.py tests/test_widget_definitions.py tests/test_widget_run.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): widgets in templates: saved as pinned slots and filled with the member's own data`.

### Task 11.6: Routine and tracker slots: the reuse question, the unique key and binding

**Files:**
- Create: `api/services/journal_two/template_tools.py`
- Modify: `api/services/journal_two/slot_fill.py` (`build_tool_slot`)
- Modify: `api/services/journal_two/journal_styles.py` (`BLOCK_BUILDERS` rows for the two families; `compose` passes `note_day`, `answers`, `choices`; `create_style_from_note` for `routine` / `tracker` nodes; `create_styled_note` and `apply_style_update` compute `note_day`)
- Modify: `api/services/journal_two/routines.py`, `api/services/journal_two/trackers.py` (`create(..., source_gallery_id=None)`; `_clean_settings` accepts `fromTemplate`)
- Test: `tests/test_slot_fill_tools.py` (new), `tests/test_template_tools.py` (new), `tests/test_routines_store.py`, `tests/test_trackers_store.py`, `tests/test_journal_styles_compose.py`

**Interfaces:**
- Consumes: Task 11.2 (`tool_binding.note_day`, `bind_day`, `search_text`); Task 11.3; `routines.create`, `routines.get`, `routines.list_routines`, `trackers.create`, `trackers.get`, `trackers.list_trackers` (wave 9, public functions only, W9-R15).
- Produces in `template_tools.py`:
  - `ROUTINE_TEMPLATES: dict[str, dict]`, each `{"name", "items": [{"text", "negative", "suggest"}]}`; four keys DERIVE from `routines.STARTERS` (one authority): `premarket_routine` ← `premarket`, `preentry_checks` ← `preentry`, `eod_review` ← `eod`, `rules_i_keep` ← `rules`. New, exactly:
    - `night_before` "Night-before prep": "Build tomorrow's watchlist", "Mark levels on my top names", "Check tomorrow's earnings and economic calendar", "Set tomorrow's max loss", "Write my plan for the open".
    - `tilt_reset` "Tilt reset": "Step away from the screen for 10 minutes", "Write what happened in one line", "Check my room under my daily loss limit", "Decide: done for the day, or one A+ setup only".
    - `weekly_review_routine` "Weekly review": "Review every trade of the week", "Tag setups and mistakes", "Update my playbook", "Set one goal for next week".
    - `swing_weekend` "Weekend swing review": "Review every open position and its stop", "Check earnings dates for my holdings", "Build next week's watchlist", "Set my risk for next week".
    - `morning_routine` "Morning routine": "Up with time to prep before the bell", "Exercise or a walk", "Read the morning wire", "Review my rules".
    - `consistency_30` "30-day consistency": "Followed my trading plan", "Stayed under my daily loss limit" (suggest `under_daily_loss_limit`), "Logged every trade", "No revenge trades" (negative, suggest `no_revenge`).
  - `TRACKER_TEMPLATES: dict[str, dict]`: `sleep` `{"name": "Sleep", "kind": "duration", "unit": None}`, `energy` `{"name": "Energy", "kind": "scale"}`, `exercise` `{"name": "Exercise", "kind": "yesno"}`, `plan_followed` `{"name": "Followed my trading plan", "kind": "yesno"}`.
  - `template_key(kind, *, template: str | None = None, gallery_id: str | None = None, inline: str | None = None) -> str` (`tpl:<template>` or `gal:<gallery_id>:<inline>`, at most 64, W11-R13).
  - `best_match(user_id, kind, wanted: dict, *, conn) -> dict | None`: the member's non-archived routine (tracker) whose name or items best match `wanted` (score = shared lower-cased word tokens of the name, plus shared item texts for routines; same kind required for trackers; ties to the newest `updatedAt`; score 0 → None).
  - `class LibraryError(ToolError)`; `S_CHOOSE_ROUTINE = "Choose a routine for each routine in this template."`, `S_CHOOSE_TRACKER = "Choose a tracker for each tracker in this template."`.
- Produces in `slot_fill.py`:
  - `tool_questions(style: dict, *, user_id, conn, inline_routines=None, inline_trackers=None) -> list[dict]`: one per unresolved routine or tracker slot (`template` or `inline`, in outline order): `{"slot": "routine_a", "kind": "routine", "createName": "Pre-market routine", "use": {"id", "name"} | None}` where `use` is `best_match`. A `ref` slot asks nothing.
  - `build_tool_slot(block: dict, ctx: dict) -> tuple[dict | None, str | None]`: `ref` → the member's own routine (tracker) by `get` (None → `slot-missing`; an archived one is placed and renders its read-only state; `checkin:*` always resolves); `template` / `inline` → `ctx["choices"][slot]`: `{"use": "<id>"}` (owned, else `ShareError("not_yours", "That choice isn't in your account.")`) or `{"create": True}` → `routines.create(name=, items=, schedule={"kind": "every"}, settings={"fromTemplate": ctx["template_title"][:80]}, source_template_key=template_key(...), source_gallery_id=ctx.get("gallery_id"))` (unique key: a second create returns the first, W9-R12 restores a soft-deleted one); a missing choice raises `LibraryError(S_CHOOSE_ROUTINE)`. The node: `{"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": "routine"|"tracker", "embedId", "mode": "snapshot", "params": {"routineId"|"trackerId": id, "day": bind_day(ctx["note_day"], bind), "bind": bind, "display": display}, "searchText": search_text(kind, name, day, bind), "annotations": [], "caption": None, "layout": {"width": "full", "height": None}, "fallback": None}}` (the attrs the W9 client insert writes; railed against its fixture). A preview reads nothing and answers `"<name> goes here, for the day of your note."` (`next-trading-day`: `"… for the next trading day."`; `week`: `"… for the trading week."`).
  - `remember_choices(user_id, style_id, choices: dict, created: dict, *, conn) -> None`: rewrites the member's own style's `template` / `inline` slots to `{"ref": "routine:<id>"}` (tracker alike), keeping `bind` and `display`, in the caller's transaction ("the choice is remembered for that template").
- `create_styled_note` gains `answers` and `choices` in its payload, passes `note_day = tool_binding.note_day(daily_date=None, created_at=<now>, now=now)`, and calls `remember_choices` before the note insert in ONE transaction; `apply_style_update` on an empty note passes the note's own day (`dailyDate`, else its created ET day).
- `create_style_from_note`: a `routine` / `tracker` node becomes `{"block": "routine_<k>", "settings": {"ref": "routine:<routineId>", "bind": <the node's bind when it is one of BINDS, else "note-day">, "display": <display>}}` (a node bound `today` saves as `note-day`; Follow today is never a template default).

- [ ] **Step 1: Write the failing tests:**
  - `tests/test_template_tools.py`: `test_four_templates_derive_from_starters` (moving a starter's item moves the template), `test_new_routine_templates_exact`, `test_tracker_templates_exact`, `test_template_key_shape_and_64_cap`, `test_best_match_name_and_items_and_ties`, `test_best_match_never_reads_another_member`.
  - `tests/test_slot_fill_tools.py`: `test_questions_only_for_unresolved_slots`, `test_create_is_unique_across_two_uses` (two creates with the same key in two threads: one routine), `test_create_restores_a_soft_deleted_template_routine` (W9-R12), `test_use_choice_must_be_owned`, `test_missing_choice_refused_with_sentence`, `test_choice_remembered_on_the_style`, `test_node_attrs_match_the_client_insert`, `test_next_trading_day_and_week_binding_in_the_note` (the Review Focus 3 cases), `test_archived_ref_placed_read_only`, `test_foreign_ref_sentence_and_no_foreign_read`, `test_from_template_setting_written`, `test_follow_today_node_saves_as_note_day`, `test_open_and_fill_touch_no_tick_rows` (no `j2_routine_ticks` or `j2_tracker_values` write).
  - `tests/test_routines_store.py` / `tests/test_trackers_store.py`: `test_create_records_source_gallery_id`, `test_from_template_setting_round_trips_and_is_80_max`.
- [ ] **Step 2:** Run `python -m pytest tests/test_template_tools.py tests/test_slot_fill_tools.py tests/test_routines_store.py tests/test_trackers_store.py tests/test_journal_styles_compose.py tests/test_journal_styles_slots.py tests/test_routines_isolation.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): routines and trackers in templates, asked once, created once, bound to the note's day`.

### Task 11.7: Gallery item types, use-days, credits and the official-row rule (storage)

**Files:**
- Modify: `api/services/journal_two/template_gallery.py` (`ITEM_TYPES`, `TOOL_ITEM_TYPES`, `_hidden_item_types`, `_hidden_styles` / `_library_hides` / `_hidden_styles_sql`, `_author_label`, `ensure_gallery_schema`'s column list, `_HELD_KEY_COLUMNS`)
- Modify: `app/src/pages/journal-2-0/lib/styleLibrary.js` (`ITEM_TYPES`, lazy file; the ONE-FACT-IN-TWO-FILES commit)
- Modify: `api/services/journal_two/db.py` (`_PHASE_2_ALTERS`: three tables)
- Modify: `api/services/journal_two/account_purge.py` (`_DIRECT_USER_TABLES`)
- Modify: `docs/account-deletion-manifest.md` (regenerated)
- Test: `tests/test_style_library.py`, `tests/test_gallery_item_types_w11.py` (new), `tests/test_firm_style_seed.py`, `tests/test_journal_two_account_purge.py`, `tests/test_account_tombstones.py`, `tests/test_account_deletion_manifest.py`, `tests/test_gallery_rows_carry_kind.py`

**Interfaces:**
- `ITEM_TYPES = ("outline", "style", EXAMPLE_ITEM, LAYOUT_ITEM, "widget_definition", "routine", "tracker")`; client `ITEM_TYPES` gains, in the same order, `{ key: 'widget_definition', label: 'Widgets' }`, `{ key: 'routine', label: 'Routines' }`, `{ key: 'tracker', label: 'Trackers' }` (parsed by `tests/test_style_library.py`). `TOOL_ITEM_TYPES = ("widget_definition", "routine", "tracker")`. They use category `"review"`, `body_json` `{}` and `payload_json` the reduced payload (spec §9).
- `_hidden_item_types()` adds the three while `not (library_on and notebook_widgets_wave_on(11))`.
- Official rows (W11-R4): `_hidden_styles()` answers one of `"all"`, `"firm"`, `"official"`, `"firm+official"`, `""` (official hidden while wave 11 is off; firm while starter packs are off); `_library_hides` and `_hidden_styles_sql` both branch on that one answer; `_author_label` answers `FIRM_AUTHOR` (`"UCT"`) for `kind in ("firm", "official")`.
- Columns (the existing ALTER loop): `source_tool_id TEXT` (with `CREATE UNIQUE INDEX IF NOT EXISTS idx_j2_template_gallery_tool_source ON j2_template_gallery(user_id, item_type, source_tool_id) WHERE user_id IS NOT NULL AND source_tool_id IS NOT NULL`), `template_group TEXT`. `_HELD_KEY_COLUMNS = ("source_style_id", "source_page", "source_tool_id")`.
- Tables (`_PHASE_2_ALTERS`):
  - `j2_gallery_use_days (user_id TEXT NOT NULL, item_id TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (user_id, item_id, day))`.
  - `j2_gallery_credits (user_id TEXT NOT NULL, tool_kind TEXT NOT NULL, tool_id TEXT NOT NULL, gallery_id TEXT NOT NULL, author_handle TEXT, title TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (user_id, tool_kind, tool_id))`, `tool_kind` in `("widget", "routine", "tracker", "template")`.
  - `j2_gallery_helpful_prompts (user_id TEXT NOT NULL, item_id TEXT NOT NULL, answer TEXT NOT NULL, answered_at TEXT NOT NULL, PRIMARY KEY (user_id, item_id))`.
  - A column comment on `j2_gallery_watches.style_id` (in `_DDL`'s comment block): "for a widget, routine or tracker item, the adopter's copy id (spec §9)".
- Purge: the three tables by name in `_DIRECT_USER_TABLES` (deviation, additive: `j2_gallery_credits` and `j2_gallery_helpful_prompts` are not in spec §9's list; the house rule lists every new `user_id` table). Gallery listings of the new types live in `j2_template_gallery`, whose purge rows already exist.

- [ ] **Step 1: Write the failing tests** (`tests/test_gallery_item_types_w11.py`):
  - `test_item_types_equal_in_both_files` (in `tests/test_style_library.py`, unchanged: it now sees seven).
  - `test_tool_types_hidden_while_w11_off_and_listed_when_on` (list, `GET /{id}`, Helpful, report, author page: each answers as absent while off).
  - `test_official_rows_one_rule_two_renderings` (in `tests/test_firm_style_seed.py`'s equality rail, extended over the 2 x 2 x 2 switch states of library, starter packs and wave 11, and over every row kind).
  - `test_official_author_label_is_uct`.
  - `test_tool_source_unique_per_author_and_type`.
  - `test_purge_rail_derives_the_new_tables_from_the_schema` (the existing schema-derived rail names the three; a misspelled name fails by name), `test_tombstone_replay_for_each_new_table`.
- [ ] **Step 2:** Run `python -m pytest tests/test_gallery_item_types_w11.py tests/test_style_library.py tests/test_firm_style_seed.py tests/test_gallery_rows_carry_kind.py tests/test_journal_two_account_purge.py tests/test_account_tombstones.py tests/test_account_deletion_manifest.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement; regenerate the manifest with `python tools/account_deletion_manifest.py --write`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit (one commit, both `ITEM_TYPES` files): `feat(notebook): widget, routine and tracker library types, use days, credits and the official-row rule (dark)`.

### Task 11.8: Share, publish and adopt services

**Files:**
- Modify: `api/services/journal_two/template_gallery.py` (`share_preview`, `publish_tool`, `style_payload`, `publish_style`, `_safe_listed`, `_adopt_listed_row`, `adopt_tool`, `use_library_template`, `credit_for`, `_ring_update_watchers`, `update_tool`)
- Modify: `api/services/journal_two/widget_engine/run.py` (ONE line: the use-day hook after a lane `run` run of a definition with `source_gallery_id`)
- Modify: `api/services/journal_two/routines.py`, `api/services/journal_two/trackers.py` (the use-day hook in `_write_day` / `set_value`, ONE call each)
- Test: `tests/test_gallery_share_w11.py` (new), `tests/test_gallery_adopt_w11.py` (new), `tests/test_gallery_credit_w11.py` (new), `tests/test_style_library_adopt.py`, `tests/test_widget_share_canary.py`

**Interfaces:**
- Consumes: Tasks 11.4 (`share.*`), 11.5 (`slot_fill.build_built_slot`), 11.6 (`slot_fill.tool_questions`, `build_tool_slot`, `remember_choices`, `template_key`), 11.7; `widget_definitions.create(..., source_gallery_id=, source_version=)`; `routines.create`, `trackers.create` (Task 11.6 signature); `journal_styles.create_style`, `create_styled_note`.
- Produces:
  - `share_preview(user_id, kind: Literal["widget","routine","tracker","template"], tool_id: str, *, edits=None, keep=(), conn=None) -> dict`: `{"travels": <the reduced payload>, "slots": [...], "kept": [...], "notShared": [...], "prefill": {name, description, formulas: {id: name}, items: [text], unit}}` (`prefill` is the ONLY place stored text appears, and only to its owner). Ownership: the member's own live row, else None (404). An adopted copy (`source_gallery_id` set and the source not the member's own) raises `ShareError("adopted", "This <widget|routine|tracker|template> came from the library, so it can't be shared again.")`; a template holding a slot whose ref is an adopted copy raises `ShareError("adopted", "This template holds something from the library, so it can't be shared yet.")`. Nothing is written.
  - `publish_tool(user_id, kind, tool_id, *, title, description, edits, keep, conn=None) -> dict | None`: reduces through `share.*` (W11-R1), writes with `_write_held_or_replaced(key_column="source_tool_id", item_type=<the type>, category="review", body={}, payload=<reduced>)` (pending; a held revision while approved, R-P3-3), mints the author handle, answers `_summary(...)`. Library or wave 11 off → None.
  - `style_payload` (used by `publish_style`): for a style holding family slots, reads the member's own definitions, routines and trackers named by its refs (owned only; an unresolved ref is left out and counted in `droppedSlots`), runs `share.share_template(...)`, and adds `definitions`, `routines`, `trackers`, `slots`, `format: 2` to the payload. `publish_style` gains `edits` and `keep`.
  - `_safe_listed` passes `definitions`, `routines`, `trackers`, `slots` (each a list of dicts; anything else becomes `[]`) and `format`.
  - `_adopt_listed_row(..., answers=None, choices=None)`: when the payload holds family slots: wave 11 off → `GalleryError(ADOPT_UNSUPPORTED_SENTENCE)`; every slot answered, else `ShareError("unresolved", …)`; answered ids owned, else `ShareError("not_yours", …)`; each inline definition resolved with `share.resolve_plan` and created with `widget_definitions.create(user_id, name, plan, source_gallery_id=row["id"], source_version=version, conn=conn)`; each inline routine or tracker per `choices` (create with `template_key(gallery_id=…, inline=…)`, or use the member's own); every `inline:` / `inline` ref in the copy rewritten to `def:<new id>` with `defRev: 1`, `routine:<id>`, `tracker:<id>`; credits written (`j2_gallery_credits`, one row per created copy and one for the style); all in the ONE transaction that already holds the copy, the use count and the watch (P3a-FIN-R1). A count cap (`S_CAP` of the store) rolls everything back with the store's own sentence and code `count_cap`.
  - `adopt_tool(user_id, gallery_id, *, answers=None, notify=False, conn=None) -> dict | None`: a listed `widget_definition` → a new definition (resolved plan); `routine` → `routines.create(name=<payload name>, items=<payload items>, schedule=<payload schedule kind>, settings={"doneShare": <payload>}, source_gallery_id=gid)`; `tracker` → `trackers.create(name, kind, unit, settings={"days": …}, source_gallery_id=gid)`. Use count, watch (`style_id` = the copy id) and credit in one transaction. Answers `{"kind", "id", "credit"}`.
  - `use_library_template(user_id, gallery_id, *, answers=None, choices=None, payload: dict, conn=None) -> dict`: for a listed style (official or member): the member's newest live copy with that `source_gallery_id` (W11-R4), else `_adopt_listed_row(...)`; then `journal_styles.create_styled_note(user_id, {**payload, "styleId": copy_id, "choices": choices}, conn)`; answers `{"note", "skipped", "style", "credit", "created": {"routines": [...], "trackers": [...], "widgets": [...]}}`. A second Use reuses the copy and asks only for what the copy does not yet remember.
  - `credit_for(user_id, tool_kind, tool_id, *, conn) -> str | None`: W11-R7 exactly; `None` for a member's own work.
  - `_ring_update_watchers` generalized to the four item types (the copy table chosen by `item_type`; the link `"/journal/notebook?tools=<kind>&libraryUpdate=<copy id>"` for tools).
  - `update_tool(user_id, copy_kind, copy_id, *, answers=None, conn=None) -> dict | None`: takes the listed version (never `pending_json`, the `_listed_payload` rule): a widget copy gets a NEW revision through `widget_definitions.update(...)` (placements keep their pinned `defRev`; wave 8's "Updated version available" offers it), a routine copy gets the new items through `routines.update` (renames and removals apply from today forward, W9), a tracker copy gets the new name and unit (a kind change refuses with `trackers.S_KIND_FIXED`); advances the watch's `notified_version`.
  - Use-day hook `record_use_day(user_id, item_id, *, now, conn) -> None` (W11-R11): `INSERT OR IGNORE` with `trading_days.today_et(now)`; called by `run.run_plan` after a lane `run` success when the definition has `source_gallery_id`, by routine tick and skip writes and by tracker logs when the tool has `source_gallery_id`; never for the author's own item.

- [ ] **Step 1: Write the failing tests:**
  - `tests/test_gallery_share_w11.py`: `test_preview_writes_nothing_and_prefills_only_for_owner`, `test_publish_goes_through_the_reducer` (a spy on `share.share_plan` / `share_routine` / `share_tracker` / `share_template` is called for each kind; a rail scans `template_gallery.py` for any other writer of `item_type` in `TOOL_ITEM_TYPES`), `test_published_tool_is_pending_then_held_when_approved`, `test_adopted_copy_refused_with_sentence`, `test_template_holding_an_adopted_widget_refused`, `test_template_payload_inline_definitions_and_shared_slot_ids`, `test_canary_never_reaches_payload_json_on_disk` (the Task 11.4 canary planted in real rows, published, then `SELECT payload_json, body_json, preview_json, title, description` read back and scanned).
  - `tests/test_gallery_adopt_w11.py`: `test_adopt_widget_creates_rev_one_copy_with_source`, `test_adopt_routine_and_tracker_copies`, `test_unresolved_refused_and_nothing_written`, `test_foreign_answer_refused_and_nothing_written`, `test_template_adopt_rewrites_every_inline_ref_in_one_transaction` (a failure injected after the second definition rolls back the copy, both definitions, the routine, the credit, the use and the watch), `test_count_cap_rolls_back_with_store_sentence`, `test_use_reuses_the_copy_and_asks_only_unremembered`, `test_two_uses_at_once_one_copy_one_routine_two_notes` (two threads), `test_adopt_while_w11_off_unsupported`, `test_update_tool_new_revision_placements_unchanged`, `test_update_reads_listed_never_pending`, `test_use_day_recorded_once_per_et_day_and_never_for_author` (a tick at 23:30 ET and one at 00:30 ET the next day: two days).
  - `tests/test_gallery_credit_w11.py`: `test_credit_based_on_handle_title`, `test_credit_official_is_uct`, `test_credit_former_member_after_author_purge` (the author purged through `account_purge.purge_user_rows`), `test_credit_survives_withdrawn_listing`, `test_credit_never_an_email`.
- [ ] **Step 2:** Run `python -m pytest tests/test_gallery_share_w11.py tests/test_gallery_adopt_w11.py tests/test_gallery_credit_w11.py tests/test_style_library_adopt.py tests/test_style_library.py tests/test_style_library_notices.py tests/test_widget_share_canary.py tests/test_widget_definitions.py tests/test_routines_store.py tests/test_trackers_store.py tests/test_widget_run.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): share, publish and adopt widgets, routines, trackers and templates through one reducer`.

### Task 11.9: Suggested values and preview with my data

**Files:**
- Create: `api/services/journal_two/gallery_suggest.py`
- Create: `api/services/journal_two/template_preview.py`
- Modify: `api/services/journal_two/widget_engine/run.py` (`run_plans_batch` beside `run_examples`)
- Test: `tests/test_gallery_suggest.py` (new), `tests/test_template_preview.py` (new), `tests/test_widget_run.py`

**Interfaces:**
- Consumes: Task 11.4 (`share.resolve_plan`, `SLOT_TYPES`); Task 11.5 (`slot_fill.slot_title`); `shelf.revision`; `run.wants_sample`, `run.SAMPLE_BELOW` (5), `run.MAX_EXAMPLES` (8).
- Produces in `gallery_suggest.py`:
  - `suggest(user_id: str, types: Iterable[str], *, conn) -> dict[str, dict | None]`: the member's most-used value per type, each one bounded query (`LIMIT 5001` on an indexed order, newest first, flagged trades included for "most used", `ANALYTICS_INCLUDED_SQL` not applied): `setup` / `tag` / `symbol` from the closed trades scan; `account` the account id with the most trades (`{id, name}`, the member's own name, never public); `property` the member's most-filled number `user_set` property; `folder` the folder with the most live notes; `note_kind` the most used kind; `routine` the routine with the newest tick; `tracker` the tracker with the newest value; `number` always None. Each answer `{"value", "label"}` or None.
- Produces in `run.py`:
  - `run_plans_batch(user_id: str, cards: list[tuple[str, dict]], *, now=None) -> dict`: at most `MAX_EXAMPLES` (else `PlanError(S_TOO_MANY_EXAMPLES)`); each card through the `example` lane (admission, deadline, sample rule, cache, single-flight exactly as `run_examples`); answers `{"cards": [{"key", "payload"} | {"key", "code", "message"}]}`.
- Produces in `template_preview.py`:
  - `CACHE_TTL_S = 300`; `_CACHE = TTLCache(max_size=500)` (⚠️ per-process, named in CLAUDE.md by Task 11.21).
  - `preview_mine(user_id: str, gallery_id: str, *, answers: dict | None = None, now=None, conn=None) -> dict | None` (None when the item is not visible to the member): `{"slots": [{"id", "type", "label", "any", "suggested": {value, label} | None, "value"}], "cards": [{"slot": "built_a", "title", "payload" | "sentence", "sample": bool}], "tools": [{"slot", "kind", "name", "items" | "trackerKind", "bind", "forDayLabel"}], "questions": <slot_fill.tool_questions output>}`. Each pick slot uses `answers[id]`, else its suggestion, else `{"any": true}` when allowed; a card whose plan still has an unresolved `any: False` slot is `{"sentence": "Pick a <label lowercase> to see this widget."}` and is not run. Built slots: `shelf:` at its pinned revision, `inline:` resolved, a member template's `def:` only for the template's own author previewing it (owned read), else the sentence `"This widget is not in your account."`. Cached by `(gallery_id, version, user_id, et_day, sha256(canonical answers))` for 300 s (W11-R12). List endpoints never call it.
- ⛔ No day state: `tools` carry names, items and the bound-day label only; no `j2_routine_ticks` or `j2_tracker_values` read (a spy proves it).

- [ ] **Step 1: Write the failing tests:**
  - `tests/test_gallery_suggest.py`: `test_most_used_per_type`, `test_no_data_answers_none_never_zero`, `test_bounded_scan_5001`, `test_second_member_never_crosses` (member B's setups never suggested to A, with B's rows present), `test_number_never_suggested`.
  - `tests/test_template_preview.py`: `test_preview_runs_at_most_8_cards_through_example_lane`, `test_fewer_than_5_trades_gets_sample_cards_labelled`, `test_any_false_slot_without_value_is_a_sentence_not_a_run`, `test_routine_slots_preview_items_without_day_state`, `test_cache_key_includes_answers_and_et_day`, `test_cache_hit_runs_nothing`, `test_not_visible_item_is_none`, `test_foreign_def_ref_in_member_template_is_a_sentence` (a non-author previewing a member template whose payload somehow kept a `def:` ref).
  - `tests/test_widget_run.py`: `test_run_plans_batch_cap_and_lanes`.
- [ ] **Step 2:** Run `python -m pytest tests/test_gallery_suggest.py tests/test_template_preview.py tests/test_widget_run.py tests/test_widget_engine_isolation.py tests/test_sample_never_feeds_real_numbers.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): suggested values and a template preview with the member's own data`.

### Task 11.10: The official templates

**Files:**
- Create: `api/services/journal_two/template_library_seed.json`
- Create: `api/services/journal_two/template_library.py` (`load_library_seed`, `seed_template_library`, `GROUPS`)
- Modify: `api/services/journal_two/template_gallery.py` (ONE call in `ensure_gallery_schema`, in its own `try` beside `seed_firm_styles`; list reads accept `group=`)
- Test: `tests/test_template_library_seed.py` (new), `tests/test_firm_style_seed.py`

**Interfaces:**
- `GROUPS = (("night_before", "The night before"), ("before_open", "Before the open"), ("during_day", "During the day"), ("after_close", "After the close"), ("weekly_monthly", "Weekly / monthly"), ("playbook", "Playbook"), ("mindset", "Mindset"), ("challenges", "Challenges"), ("habits", "Habits"))`.
- Seed row: `{"seedKey": "uct-template-<slug>-v1", "slug", "title", "group", "kindId", "category", "description", "blocks": [...], "sections": [{"heading", "prompt", "blocks": [ids]}], "definitions": [{"key", "plan", "name", "description"}], "slots": [...]}`. `seed_template_library(conn)` INSERTs OR IGNOREs each row as `kind = 'official'`, `item_type = 'style'`, `status = 'approved'`, `featured = 1`, `version = 1`, `template_group = group`, `payload_json = {kindId, outlineBodyJson, blocks, properties: {}, definitions, routines: [], trackers: [], slots, format: 2}` with the outline from `_outline_from_sections` (per section: a level-2 heading, the prompt paragraph, then one `{{block:<id>}}` paragraph per block id), `body_json` the outline, `preview_json` its preview. Returns rows added (0 after the first boot). A failure is logged, never raised (the P5 row 27 rule).
- At import, `load_library_seed()` checks every row: the seed key shape and uniqueness; `group` in `GROUPS`; `kindId` in `note_kinds.BUILTIN_KIND_IDS`; `category` in `CATEGORIES`; every block passes `journal_styles._clean_blocks`; every `shelf:` ref's pinned `(id, defRev)` exists in the shelf `MANIFEST.json` (W10-R5); every inline plan validates against `sources.CATALOG` with its picks resolved to suggestions-free placeholders (`share.resolve_plan` with each `any: True` slot as Any and each `any: False` slot as a typed dummy); every `template` key is in `template_tools`; every block id appears in exactly one section. A broken seed fails the import (boot), never a member's card.
- The 27 rows, spec §10 item for item (blocks in order; `b` = a built slot `{"ref": "shelf:<slug>", "defRev": <rev>}` with an optional `range` token; `r` = a routine slot `{"template": <key>, "bind": <bind>}`; `t` = a tracker slot):

| # | slug | title | group | kindId / category | description | blocks |
|---|---|---|---|---|---|---|
| 1 | night-before-prep | Night-before prep | night_before | daily_prep / research | Tomorrow's watchlist and levels, set the night before. | `prepLevels`, `prepEarnings`, `routine_a` r `night_before` `next-trading-day` |
| 2 | pre-market-prep | Pre-market prep | before_open | daily_prep / research | The wire, your names reporting, your levels and your pre-market routine. | `prepWire`, `marketcontext`, `myWatchlistToday`, `myNamesReporting`, `prepLevels`, `routine_a` r `premarket_routine` `note-day` |
| 3 | game-plan | Game plan | before_open | daily_prep / research | Today's read, your room under your loss limit and your rules. | `myGamePlan`, `myRiskLeftToday`, `myRules`, `routine_a` r `rules_i_keep` `note-day` |
| 4 | earnings-day-prep | Earnings day prep | before_open | earnings / research | Your names reporting today and your plan around each report. | `myNamesReporting`, `prepEarnings`, `marketcontext`, `chart` |
| 5 | watchlist-review | Watchlist review | before_open | watchlist_note / research | Your list today, the names moving and the levels you are waiting for. | `myWatchlistToday`, `prepMovers`, `prepLevels` |
| 6 | mid-day-risk-check | Mid-day and risk check | during_day | daily_prep / research | Today's P&L, open risk and room left under your daily loss limit. | `myRiskLeftToday`, `myPositionsRisk`, `myTiltCheck` |
| 7 | trade-plan-one-idea | Trade plan (one idea) | during_day | trade_plan / trade_plan | One idea: the setup, entry, stop, target and size. | `chart`, `preEntryChecklist`, `positionSizing`, `marketcontext`, `routine_a` r `preentry_checks` `note-day` |
| 8 | end-of-day-recap | End-of-day recap | after_close | post_trade_review / review | Today's trades, the rules you kept, your mistakes and tomorrow's list. | `built_a` b `recent-trades` r1 `today`, `built_b` b `daily-pnl-bars` r1, `myRulesCheck`, `myMistakes`, `routine_a` r `eod_review` `note-day` |
| 9 | tag-todays-trades | Tag today's trades | after_close | post_trade_review / review | Today's trades, one row each, to tag setup, mistakes and emotions. | `built_a` inline `a` (closed trades, range `today`, view list, measures `net_pnl`, `total_r`, sort newest), `myMistakes` |
| 10 | trade-post-mortem | Trade post-mortem | after_close | post_trade_review / review | One trade: what happened, whether you kept your trading plan, what you'd change. | `tradeReview`, `chart`, `myRules` |
| 11 | mistake-log-entry | Mistake log entry | after_close | post_trade_review / review | One mistake, what caused it and the rule that would have stopped it. | `myMistakes`, `myRulesCheck` |
| 12 | tilt-reset | Tilt reset | after_close | post_trade_review / review | A short reset after a loss: what happened, your room left and your next step. | `myTiltCheck`, `myRiskLeftToday`, `routine_a` r `tilt_reset` `note-day` |
| 13 | weekly-review | Weekly review | weekly_monthly | weekly_review / review | Your week's numbers, rules kept, recurring mistakes and one thing to change. | `built_a` b `weekly-scorecard` r1, `built_b` b `equity-curve` r1 `this_week`, `myRulesCheck`, `myMistakes`, `routine_a` r `weekly_review_routine` `week` |
| 14 | weekend-swing-review | Weekend swing review | weekly_monthly | weekend_prep / research | Open positions, stops and earnings next week, with your routine for the trading week. | `myPositionsRisk`, `prepEarnings`, `built_a` b `weekly-scorecard` r1, `routine_a` r `swing_weekend` `week` |
| 15 | monthly-review | Monthly review | weekly_monthly | weekly_review / review | This month's results, the curve, the best trades and your symbols. | `built_a` b `month-in-review` r1, `built_b` b `equity-curve` r1 `this_month`, `built_c` b `best-trades` r1 `this_month`, `built_d` b `performance-by-symbol` r1 `this_month` |
| 16 | quarterly-edge-review | Quarterly edge review | weekly_monthly | weekly_review / review | Where your edge came from this quarter: expectancy, time of day, hold time and R. | `built_a` b `expectancy` r1 `this_quarter`, `built_b` b `pnl-by-time-of-day` r1 `this_quarter`, `built_c` b `pnl-by-hold-time` r1 `this_quarter`, `built_d` b `r-multiple-distribution` r1 `this_quarter` |
| 17 | year-in-review | Year in review | weekly_monthly | weekly_review / review | Your year: the curve, the drawdown, the best trades and your weekdays. | `built_a` b `equity-curve` r1 `ytd`, `built_b` b `max-drawdown` r1 `ytd`, `built_c` b `best-trades` r1 `ytd`, `built_d` b `pnl-by-weekday` r1 `ytd` |
| 18 | goal-setting | Goal setting | weekly_monthly | weekly_review / review | Your goals for the period and the numbers they rest on. | `built_a` b `goals-progress` r1, `built_b` b `win-rate` r1, `built_c` b `expectancy` r1 |
| 19 | setup-study | Setup study | playbook | thesis / research | Your own stats on one setup: trades, win rate, expectancy and when it works. | `built_a` inline `a` (closed trades, filter `setup in [pick p1]`, measures `trades`, `win_rate`, `expectancy_r`, view number, range `last_12m`), `built_b` inline `b` (same filter, split `hour_et`, measure `net_pnl`, view bar, range `last_12m`); slot `p1` type `setup`, `any: false` |
| 20 | new-setup-idea | New setup idea | playbook | thesis / research | A new setup: what it is, its rules and how you'll test it. | `chart`, `myRules` |
| 21 | rules-review | Rules review | playbook | weekly_review / review | Your rules, how often you kept them and what keeping them was worth. | `myRules`, `myRulesCheck`, `built_a` b `process-vs-results` r1, `routine_a` r `rules_i_keep` `note-day` display `pnl` |
| 22 | options-trade-plan | Options trade plan | playbook | trade_plan / trade_plan | One options trade: strategy, max loss, IV and expiry. | `chart`, `preEntryChecklist`, `marketcontext` |
| 23 | pre-session-check-in | Pre-session check-in | mindset | daily_prep / research | Sleep, mood and focus before the session, and how they compare with your P&L. | `moodCheckIn`, `tracker_a` t template `sleep` `note-day`, `tracker_b` t ref `checkin:mood` display `pnl`, `tracker_c` t ref `checkin:focus` display `pnl` |
| 24 | prop-firm-challenge | Prop-firm challenge tracker | challenges | daily_prep / research | Room left under your daily loss and max drawdown limits, and today's risk. | `myPropFirm`, `myRiskLeftToday`, `built_a` b `equity-curve` r1, `routine_a` r `rules_i_keep` `note-day` |
| 25 | consistency-30 | 30-day consistency challenge | challenges | weekly_review / review | Thirty trading days of the same routine, and how those days compare with your P&L. | `routine_a` r `consistency_30` `note-day` display `pnl`, `myRevengeClean`, `built_a` b `daily-pnl-bars` r1 |
| 26 | morning-routine | Morning routine | habits | daily_prep / research | Your morning routine, ticked every trading day. | `routine_a` r `morning_routine` `note-day`, `tracker_a` t template `sleep` `note-day` |
| 27 | trading-day-trackers | Trading-day tracker set | habits | daily_prep / research | Sleep, energy, exercise and whether you kept your trading plan, once a day. | `tracker_a` t `sleep`, `tracker_b` t `energy`, `tracker_c` t `exercise`, `tracker_d` t `plan_followed` (all `note-day`) |

  Section headings and prompts are written in the seed per row (two to four sections each, plain words, no emoji, "trading plan" never bare "plan", R-33); each block id sits under the heading it serves.
- ⛔ Released rows are append-only (R-P5-4): `test_released_rows_never_change` reads `git show origin/master:api/services/journal_two/template_library_seed.json` and compares each released row's canonical-JSON SHA-256 (`shelf.canonical_hash`); the file absent on master means none are released yet. It FAILS (never skips) when git or `origin/master` cannot be read, naming `git fetch origin master`.

- [ ] **Step 1: Write the failing tests** (`tests/test_template_library_seed.py`): `test_twenty_seven_rows_in_spec_order_and_groups`, `test_seed_validates_at_import` (one broken copy per check in a tmp file raises naming the row), `test_every_pinned_shelf_revision_exists`, `test_every_inline_plan_validates`, `test_seed_is_idempotent_and_never_undoes_an_admin_hide`, `test_official_rows_hidden_while_w11_off`, `test_official_rows_listed_by_group`, `test_every_row_fills_on_the_sample_book_without_a_500` (compose in create mode for a member with the sample book loaded as real rows, then for a brand-new member: every slot is a node or a sentence, none is a zero), `test_no_bare_plan_word_in_seed_copy` (R-33 sweep), `test_released_rows_never_change`.
- [ ] **Step 2:** Run `python -m pytest tests/test_template_library_seed.py tests/test_firm_style_seed.py tests/test_gallery_item_types_w11.py tests/test_widget_shelf_files.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): 27 official templates in the template library (dark)`.

### Task 11.11: The helpful 3-day rule and the 3rd-day prompt

**Files:**
- Modify: `api/services/journal_two/template_gallery.py` (`set_helpful`, `use_days`, `helpful_prompt`, `answer_helpful_prompt`)
- Test: `tests/test_gallery_helpful_w11.py` (new), `tests/test_style_library_social.py`

**Interfaces:**
- Consumes: Task 11.2 (`trading_days.et_day_of`), Task 11.7 tables.
- Produces:
  - `HELPFUL_DAYS = 3`; `S_HELPFUL_DAYS = "You can mark this helpful after using it on 3 different days."`; `HELPFUL_RULE_TYPES = ("style", "widget_definition", "routine", "tracker")`.
  - `use_days(user_id, row, *, conn) -> int`: for `style`, the distinct ET days (`et_day_of(created_at)`) of the member's live notes whose `style_id` is one of their copies of the item (`SELECT id FROM j2_journal_styles WHERE user_id = ? AND source_gallery_id = ?`, then `SELECT created_at FROM j2_notes WHERE user_id = ? AND style_id IN (…) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 400`); for the three tool types, `SELECT COUNT(*) FROM j2_gallery_use_days WHERE user_id = ? AND item_id = ?` (W11-R8).
  - `set_helpful(..., on=True)`: while wave 11 is on and the type is in `HELPFUL_RULE_TYPES`, `use_days < 3` raises `GalleryConflict` carrying code `helpful_days` and `S_HELPFUL_DAYS`; unmarking is always allowed; outline and layout items are unchanged; wave 11 off: exactly the wave 10 behaviour.
  - `helpful_prompt(user_id, note_id, *, conn) -> dict`: `{"show": False}` unless: wave 11 on; the note is the member's, live, with a `style_id` whose style has a `source_gallery_id` of a visible approved item not authored by the member; the member has not marked it and has no `j2_gallery_helpful_prompts` row for it; `use_days >= 3`; and this note's ET day is among the member's 3rd-or-later use days. Then `{"show": True, "itemId", "title", "line": "Was <title> helpful?"}`.
  - `answer_helpful_prompt(user_id, gallery_id, answer, *, conn) -> dict`: `answer` in `("yes", "not_really", "dismissed")` (else `GalleryError("Choose yes, not really or dismiss.")`); writes the prompt row (`INSERT OR IGNORE`, once); `yes` also marks Helpful through `set_helpful` in the same transaction. Answers `{"answer", "helpful": bool, "count": int}`.
- ⛔ Neither function touches `j2_notes` beyond the bounded read; the prompt never writes the note.

- [ ] **Step 1: Write the failing tests** (`tests/test_gallery_helpful_w11.py`): `test_style_needs_three_et_days` (notes at 2026-10-20T03:30Z, 2026-10-20T23:00Z and 2026-10-21T14:00Z are ET days 10-19, 10-20, 10-21: allowed; two notes on one ET day across UTC midnight count once), `test_tool_types_read_use_days`, `test_outline_and_layout_unchanged`, `test_unmark_always_allowed`, `test_w11_off_behaves_as_wave10`, `test_prompt_only_on_third_day_note` (the notes of day 1 and 2 answer `show: False`; day 3 and day 4 answer `show: True` until answered), `test_prompt_never_for_own_item_or_after_answer`, `test_yes_marks_helpful_once`, `test_not_really_and_dismissed_store_only`, `test_prompt_reads_no_other_member_notes`.
- [ ] **Step 2:** Run `python -m pytest tests/test_gallery_helpful_w11.py tests/test_style_library_social.py tests/test_style_library.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): helpful after three days of use, and a one-time prompt on the third`.

### Task 11.12: Routes: the wave 11 gate on every new door

**Files:**
- Modify: `api/routers/notebook_template_gallery.py`
- Modify: `api/routers/notebook_journal_styles.py` (Task 11.13's store calls)
- Test: `tests/test_gallery_router_w11.py` (new), `tests/test_notebook_template_gallery.py`, `tests/test_notebook_journal_styles_router.py`, `tests/test_user_definitions_auth.py`

**Interfaces:**
- Consumes: Tasks 11.8-11.11 and 11.13.
- Produces in `notebook_template_gallery.py` (each new route behind `_require_w11` (the `public.not_found()` 404 while `notebook_widgets_wave_on(11)` is off, read per request) and the library switch; declared BEFORE `/{gallery_id}` so the literal paths win; bodies at most 16 KB and depth 16):
  - `POST /share/preview` `{kind, id, edits?, keep?}` → `share_preview` (scope `notebook-gallery-preview`, 60/hour).
  - `POST /tools` `{kind, id, title, description?, edits, keep?}` → `publish_tool` (the publish scope, 10/hour).
  - `POST /styles` (existing) passes `edits` and `keep` when wave 11 is on.
  - `GET /library` `?group=` → the official rows (approved, visible), by `GROUPS` order, each `_summary` plus `group`, `contains: [<widget, routine and tracker names>]`, `inYourTemplates: bool` (the member holds a live copy).
  - `POST /{gallery_id}/preview-mine` `{answers?}` → `preview_mine` (scope `notebook-gallery-preview`).
  - `POST /{gallery_id}/adopt-tool` `{answers?, notify?}` → `adopt_tool`.
  - `POST /{gallery_id}/use-template` `{answers?, choices?, ticker?, title?}` → `use_library_template` (the gallery write scope).
  - `POST /{gallery_id}/adopt` (existing) passes `answers` and `choices` when wave 11 is on.
  - `POST /tools/updates/{kind}/{copy_id}` `{answers?}` → `update_tool`.
  - `GET /notes/{note_id}/helpful-prompt` and `POST /{gallery_id}/helpful-prompt` `{answer}`.
  - `POST /{gallery_id}/helpful` (existing) answers 409 `{"code": "helpful_days", "message": S_HELPFUL_DAYS}`.
  - `_summary` gains, for every item: `contains` (names from the reduced payload), `usedBy` (the existing distinct-use count; the client words `0` as `"New"`), `updatedAt`, and, for the viewer's copies, `credit`.
- Produces in `notebook_journal_styles.py` (W11 gated): `GET /journal-styles?view=live|archived|deleted` (absent `view` is exactly today's answer), `POST /journal-styles/{id}/archive`, `/unarchive`, `/duplicate`, `POST /journal-styles/{id}/delete` `{typedName}`, `GET /journal-styles/{id}/used-in`.
- Errors: every `ShareError` / `LibraryError` / store `ToolError` answered from its class (`status`, `code`, `sentence`, W9-R14); every 200 and error `Cache-Control: no-store`; the router's 402 sentence stays the gallery's own.

- [ ] **Step 1: Write the failing tests** (`tests/test_gallery_router_w11.py`): `test_every_new_route_404_when_w11_off` (enumerated from the router's `.routes` against a recorded list of the new paths, non-vacuity count at least 12), `test_flag_read_per_request`, `test_literal_paths_beat_the_id_route`, `test_body_over_16kb_and_deep_body_refused`, `test_error_codes_from_classes` (`unresolved`, `not_yours`, `own_words`, `adopted`, `helpful_days`, `count_cap`), `test_preview_and_share_preview_share_the_60_per_hour_scope`, `test_publish_rate_10_per_hour`, `test_every_response_no_store`, `test_unpaid_402`, `test_library_lists_by_group_with_in_your_templates`, `test_summary_fields_for_cards`, `test_two_use_template_requests_at_once` (the Review Focus 2 case through HTTP); journal-styles: `test_view_param_absent_is_unchanged`, `test_archive_routes_404_when_w11_off`.
- [ ] **Step 2:** Run `python -m pytest tests/test_gallery_router_w11.py tests/test_notebook_template_gallery.py tests/test_notebook_journal_styles_router.py tests/test_user_definitions_auth.py -q`. Expected: FAIL (plus the known `PER_ROUTER` screener red, read by name).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS except the known red.
- [ ] **Step 5:** Commit: `feat(notebook): wave 11 routes for sharing, adopting, using and previewing templates (dark)`.

**Merge point.** After 11.12 (with 11.10, 11.11 and 11.13 in): merge `feat/notebook-widgets-p2-be` into `feat/notebook-widgets-p2`; run every backend suite named in Task 11.21 Step 1; push.

### Task 11.13: Templates in My tools: archive, duplicate, used in, credit (server)

**Files:**
- Modify: `api/services/journal_two/journal_styles.py` (`archive_style`, `unarchive_style`, `duplicate_style`, `style_used_in`, `list_styles(view=)`, `delete_style_typed`)
- Modify: `api/services/journal_two/db.py` (`_PHASE_2_ALTERS`: `ALTER TABLE j2_journal_styles ADD COLUMN archived_at TEXT`)
- Test: `tests/test_journal_styles_archive.py` (new), `tests/test_journal_styles_store.py`

**Interfaces:**
- Produces (W11-R10):
  - `list_styles(user_id, conn=None, *, view: Literal["picker","live","archived","deleted"] = "picker")`: `"picker"` is today's answer minus archived rows (every existing caller passes nothing and gets it); `"live"` adds `usedIn` (one grouped `COUNT(*)` over `j2_notes` for the member's style ids, live notes only, sample notes excluded) and `credit` (`template_gallery.credit_for`, else the existing adopt credit read from the gallery row, else None) and `fromLibrary: bool`; `"archived"`; `"deleted"` lists rows deleted within 30 days (`RECENTLY_DELETED_DAYS = 30`).
  - `archive_style(user_id, style_id, *, conn=None) -> dict | None` (sets `archived_at`; clears `is_default`; a built-in id refuses with `StyleValidationError("Built-in templates can't be archived.")`); `unarchive_style`; `duplicate_style(user_id, style_id) -> dict` (`"<name> copy"`, 80 max; family slot refs copied as they are; no provenance; the 200 cap's sentence); `style_used_in(user_id, style_id) -> list[{id, title, updatedAt}]` (at most 100).
  - `delete_style_typed(user_id, style_id, typed_name) -> dict | None`: only an archived style (`"Archive this template before deleting it."`), only when `typed_name == name` (`"Type the template's name exactly to delete it."`), then the existing `delete_style`. `restore_style` on a row deleted more than 30 days ago refuses with `"This template was deleted more than 30 days ago."`.
- ⛔ Archived rows stay readable by `get_style` (notes' Update layout and style stamps keep working).

- [ ] **Step 1: Write the failing tests** (`tests/test_journal_styles_archive.py`): `test_picker_view_hides_archived_and_is_default_for_every_caller`, `test_archive_clears_default_and_kind_falls_back`, `test_used_in_counts_live_notes_only_and_never_another_members`, `test_credit_on_adopted_copy`, `test_duplicate_copies_slots_without_provenance`, `test_delete_needs_archived_and_typed_name`, `test_restore_refused_after_30_days`, `test_archived_style_still_composes_update_layout`.
- [ ] **Step 2:** Run `python -m pytest tests/test_journal_styles_archive.py tests/test_journal_styles_store.py tests/test_journal_styles_update.py tests/test_notebook_journal_styles_router.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): archive, duplicate and used-in for templates`.

### Task 11.14: Client slot labels, the binding twin rail and the six snapshot-slot labels

**Files:**
- Modify: `app/src/pages/journal-2-0/lib/journalBlocks.js` (`SNAPSHOT_BLOCK_LABELS` six rows; `blockLabel` family branch)
- Create: `app/src/pages/journal-2-0/lib/templateSlots.js` (lazy; imported only by the styles chunk, the share preview and the adoption sheet)
- Modify: `app/src/pages/journal-2-0/components/notebook/styles/StyleEditor.jsx`, `styles/KindSection.jsx` (block rows read `slotLabel`)
- Create: `app/src/pages/journal-2-0/lib/blocks/toolDays.vectors.test.js`
- Test: `lib/journalBlocks.test.js`, `lib/templateSlots.test.js`, `lib/blocks/toolDays.vectors.test.js`, `styles/KindSection.test.jsx`, `styles/StylesManager.test.jsx`

**Interfaces:**
- Consumes: Task 11.2's vector file at `tests/fixtures/toolBindingVectors.json` (read with `fs.readFileSync` in the test only); wave 9's `lib/blocks/toolDays.js` (`forDayLabel`, `toolSearchText`, `noteDayOf`, `weekMonday`).
- Produces:
  - `SNAPSHOT_BLOCK_LABELS` gains `myRiskLeftToday: 'Risk left today'`, `myGamePlan: 'Pre-market game plan'`, `myTiltCheck: 'Tilt check'`, `myRevengeClean: 'Revenge trades'`, `myPropFirm: 'Prop-firm rules'`, `myAlertsFired: 'Alerts that fired'` (equal to `KIND_TITLE`, railed by `tests/test_journal_styles_compose.py`'s agreement test).
  - `blockLabel(id)`: `built_<k>` → `'Widget'`, `routine_<k>` → `'Routine'`, `tracker_<k>` → `'Tracker'` (the regex `^(built|routine|tracker)_[a-z0-9]{1,2}$`, twin of `SLOT_ID_RE`), before the "newer version" fallback.
  - `templateSlots.js`: `SLOT_ID_RE`, `slotFamily(id)`, `slotLabel(block, names = {})` (`'Widget: Equity curve'`, `'Routine: Pre-market routine'`, `'Tracker: Sleep'`; `'Widget'` when the name is unknown), `bindWords(bind)` (`'For the day of the note'`, `'For the next trading day'`, `'For the trading week'`), `TYPE_LABELS` (the server's ten, same words).
- Bytes: `journalBlocks.js` is eager (six rows and one branch); everything else lazy.

- [ ] **Step 1: Write the failing tests:** `toolDays.vectors.test.js` (`bind_vectors_match_server`, `label_vectors`, `search_vectors`, `note_day_vectors`: the client computes `bind_day` with a test-local helper over `toolDays` functions and must equal every vector; ⛔ the client has no `bindDay` export in phase 2, the server binds at instantiation, so the helper lives in the test), `journalBlocks.test.js` `family_ids_label_and_six_new_slot_labels`, `templateSlots.test.js` (`slot_label_with_and_without_names`, `bind_words_exact`, `regex_twin_of_server` read from `journal_styles.py` source text), `KindSection.test.jsx` `style_with_built_slot_shows_widget_name`.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/lib/journalBlocks.test.js src/pages/journal-2-0/lib/templateSlots.test.js src/pages/journal-2-0/lib/blocks/toolDays.vectors.test.js src/pages/journal-2-0/components/notebook/styles` and `python -m pytest tests/test_journal_styles_compose.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both commands. Expected: PASS.
- [ ] **Step 5:** Bytes: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`. Expected: `VERDICT: PASS`; record the total in the commit message.
- [ ] **Step 6:** Commit: `feat(notebook): template slot labels on the client and the shared day-binding rail`.

### Task 11.15: The share preview

**Files:**
- Create: `app/src/pages/journal-2-0/lib/templateLibrary.js` (lazy; every wave 11 call, `{ok, data} | {ok: false, code, message}`, never throws)
- Create: `app/src/pages/journal-2-0/components/notebook/library/SharePreviewSheet.jsx`, `library/openSharePreview.js`, `library/library.module.css`
- Modify: `app/src/pages/journal-2-0/components/notebook/styles/ShareStyleForm.jsx` (a style holding family slots opens the share preview instead of the plain form while `widgetsWaveOn(11)`)
- Test: `library/SharePreviewSheet.test.jsx`, `lib/templateLibrary.test.js`, `src/styles/tapFloor.test.js`

**Interfaces:**
- Consumes: Task 11.12 routes (`POST /share/preview`, `POST /tools`, `POST /styles`); Task 11.14 `templateSlots.js`; `components/mobile/Sheet.jsx`.
- Produces in `templateLibrary.js`: `GALLERY = '/api/j2/template-gallery'`; `sharePreview(kind, id, {edits, keep})`, `publishTool(kind, id, body)`, `publishTemplate(styleId, body)`, `libraryList(group)`, `previewMine(galleryId, answers)`, `adoptTool(galleryId, body)`, `useTemplate(galleryId, body)`, `adoptTemplate(galleryId, body)`, `updateTool(kind, copyId, body)`, `helpfulPrompt(noteId)`, `answerHelpfulPrompt(galleryId, answer)`; offline → `{ok: false, code: 'offline'}` with no request; a 404 → `{ok: false, code: 'unavailable'}` (`"Not available right now."`).
- `openSharePreview({kind, id, onDone}) -> close()` (one at a time, its own root).
- `SharePreviewSheet`: title `"Share to library"`; heading `"What will be shared"`; the prefilled Name and Description fields (`"Name"`, `"Description"`, 80 and 280 caps, the server's sentences beside the field); for widgets, each formula field's name field (`"Field 1"` placeholder) and each numeric value as a switch `"Share this number (<value>)"` (off by default); for routines, each item as a checked row the author can untick or edit; for trackers, Name and Unit; for templates, each held widget, routine and tracker listed by name with the same controls; the line `"People who use it pick their own: <Setup, Account, …>"` from `slots`; the `notShared` sentences under `"Not shared"`; a read-only rendering of `travels` labelled `"Exactly what travels"` (names and structure in plain words, never JSON); the button `"Send for review"`; on success `"Sent. UCT reviews every item before it's listed."`. Server refusals (`own_words`, `adopted`) show their sentence at the top and disable Send. Every edit re-asks the server preview, debounced 600 ms, at most one in flight.
- ⛔ The sheet never constructs the payload itself: what it shows as travelling is the server's answer.

- [ ] **Step 1: Write the failing tests:** `prefill_shown_and_only_edits_sent` (the request body's `edits` equals the fields' values; nothing else from the row), `number_switch_off_by_default_and_keep_sent_when_on`, `routine_untick_removes_item`, `adopted_refusal_disables_send`, `own_words_sentence_names_field`, `what_travels_is_the_server_answer` (a mocked server answer differing from the fields is what renders), `debounce_one_in_flight`, `offline_no_request`, `success_sentence_exact`, `keyboard_only_and_44px`, `templateLibrary_never_throws`.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/library src/pages/journal-2-0/lib/templateLibrary.test.js src/styles/tapFloor.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): share preview showing exactly what travels`.

### Task 11.16: Library cards, the Template library section and template detail with my data

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/TemplateGallery.jsx` (`GalleryCard` for the three types and the new summary fields)
- Modify: `app/src/pages/journal-2-0/components/notebook/StyleLibraryCard.jsx`
- Modify: `app/src/pages/journal-2-0/components/notebook/TemplatePicker.jsx` (a lazy `TemplateLibrarySection` above "Your templates" while `widgetsWaveOn(11)`)
- Create: `library/TemplateLibrarySection.jsx`, `library/TemplateDetailSheet.jsx`
- Test: `library/TemplateLibrarySection.test.jsx`, `library/TemplateDetailSheet.test.jsx`, `TemplateGallery.test.jsx`, `TemplatePicker.gallery.test.jsx`, `StyleLibrary.test.jsx`

**Interfaces:**
- Consumes: Tasks 11.12 (`GET /library`, `preview-mine`, summary fields), 11.15 (`templateLibrary.js`), 11.17 (`openAdoptSheet`).
- Card (every library item): the title; `"For: <description>"`; `"Contains: <names>"` (at most 4, then `"and <n> more"`); `"Used by <n> traders"` (`n >= 1`; `"New"` otherwise); `"Updated <Mon D>"`; the author label; the existing Helpful count; a type chip `"Template"`, `"Widget"`, `"Routine"`, `"Tracker"`. ⛔ A list card never calls `preview-mine`; it keeps the sentence `"Fills in with your own data when you make a note."`.
- `TemplateLibrarySection`: heading `"Template library"`; one group per `GROUPS` label in order, each a row of cards; a card's button `"Preview"` opens `TemplateDetailSheet`; `"In your templates"` badge when `inYourTemplates`. The section reuses the picker's search box and category chips (a search matches title, description and `contains`). Arrow-key and Tab behaviour of the existing cards is unchanged (the `.gallery.test.jsx` rails).
- `TemplateDetailSheet` (signed-in member only): the outline preview (existing `TemplatePreview`), then `previewMine(galleryId)` cards rendered by the lazy built views (`BuiltWidgetEmbed`'s read-only body), each labelled `"Sample data"` when `sample`; routine and tracker slots as their name, items and `bindWords`; slot sentences as given; one "Use this template" button opening `openAdoptSheet({galleryId, kind: 'template'})`. A rate refusal reads `"Too many previews in an hour. Try again later."` (the existing preview scope's sentence, from the server).

- [ ] **Step 1: Write the failing tests:** `card_fields_and_new_instead_of_zero`, `list_cards_never_call_preview_mine` (a fetch spy), `groups_in_order_and_search_matches_contains`, `detail_calls_preview_mine_once_and_labels_sample`, `routine_slot_preview_has_no_day_state`, `use_opens_adopt_sheet`, `picker_unchanged_when_w11_off` (the existing picker snapshot), `existing_card_keyboard_rails_green`.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/library src/pages/journal-2-0/components/notebook/TemplateGallery.test.jsx src/pages/journal-2-0/components/notebook/TemplatePicker.gallery.test.jsx src/pages/journal-2-0/components/notebook/StyleLibrary.test.jsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): template library section, richer library cards and a template preview with your data`.

### Task 11.17: The adoption sheet

**Files:**
- Create: `library/AdoptSheet.jsx`, `library/openAdoptSheet.js`, `library/SlotPicker.jsx`
- Test: `library/AdoptSheet.test.jsx`, `library/SlotPicker.test.jsx`, `src/styles/tapFloor.test.js`

**Interfaces:**
- Consumes: Task 11.12 (`preview-mine`, `adopt-tool`, `adopt`, `use-template`); wave 9 `lib/toolsCrud.js` (`listTools('routine'|'tracker')`), wave 8 `lib/builtWidgets.js` (`loadVocabulary(field)` for the value lists of setup, tag, symbol, account, property, folder, kind).
- `openAdoptSheet({galleryId, kind: 'template'|'widget'|'routine'|'tracker', editor?, onDone}) -> close()`.
- `AdoptSheet`: heading `"Make it yours"`; on open ONE `previewMine` call; the preview renders immediately with each slot at its suggestion or "Any"; one row per slot `"<Label>: <value>"` (`"Any <label lowercase>"` for Any) with a Change control opening `SlotPicker` (the member's values from `loadVocabulary`, routines and trackers from `listTools`, a number input for `number`, and "Any <label lowercase>" only where `any`); each change re-runs `previewMine(galleryId, answers)` (debounced 600 ms, one in flight); for each routine or tracker question, two radio rows `"Use your <name>"` (pre-selected when `use` is set) and `"Create <createName> from the template"`; the button `"Use"` (one tap accepts every suggestion) sends `answers` and `choices`; a template's Use makes the note and navigates to it (`useTemplate`, the picker's one creation door); a tool's Use adopts it and says `"Added to My tools."`. Errors: `unresolved` / `not_yours` / `count_cap` show the server's sentence at the slot or at the top; Use is disabled while any `any: false` slot has no value, with `"Pick a value for each choice, or Any."` beside it. The credit line `"Based on <label>'s <title>"` sits under the heading.
- ⛔ Opening or changing slots writes nothing (no POST other than `preview-mine`).

- [ ] **Step 1: Write the failing tests:** `opens_with_one_preview_and_suggested_values`, `one_tap_use_sends_suggestions`, `any_only_where_allowed`, `number_slot_needs_number`, `change_reruns_preview_debounced`, `routine_question_preselects_best_match`, `create_choice_sent`, `server_sentences_shown_verbatim`, `no_write_before_use` (fetch spy), `template_use_navigates_to_new_note`, `credit_line_exact_and_former_member`, `keyboard_only_390_and_44px`.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/library src/styles/tapFloor.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): adoption sheet with pick-yours choices and an immediate preview`.

### Task 11.18: Helpful after three days, and the 3rd-day line

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx` (ONE guarded dynamic import: when `note.styleId && widgetsWaveOn(11)`, `import('./library/HelpfulPromptLine')`)
- Create: `library/HelpfulPromptLine.jsx`
- Modify: `TemplateGallery.jsx` / `StyleLibraryCard.jsx` (Helpful's `helpful_days` refusal)
- Test: `library/HelpfulPromptLine.test.jsx`, `NoteEditorPage.helpfulPrompt.test.jsx` (new), `TemplateGallery.test.jsx`, `lib/offline/doorEnumeration.test.js`

**Interfaces:**
- Consumes: Task 11.12 (`GET /notes/{id}/helpful-prompt`, `POST /{id}/helpful-prompt`, Helpful's 409).
- `HelpfulPromptLine({noteId})`: one `helpfulPrompt(noteId)` on mount; `show: true` renders one line above the note body, `"Was <title> helpful?"` with buttons `"Yes"` and `"Not really"` and a `"Dismiss"` icon button (`UIcon` `close`, aria-label "Dismiss"); any answer hides the line at once (optimistic) and posts it; a failed post shows nothing (the line stays hidden; it is a courtesy). ⛔ No editor transaction, no note PUT, no outbox entry.
- Helpful button: a 409 `helpful_days` shows `"You can mark this helpful after using it on 3 different days."` under it; the button stays enabled.
- Bytes: `NoteEditorPage.jsx` is eager (one condition and one dynamic import); the line is lazy.

- [ ] **Step 1: Write the failing tests:** `line_shows_only_when_server_says_show`, `answers_post_and_hide`, `dismiss_posts_dismissed`, `no_doc_change_and_no_note_put` (an editor spy and a fetch spy across mount and each answer), `not_requested_without_style_or_w11_off`, `helpful_days_sentence_under_button`, `doorEnumeration` stays green with no new exception.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/library/HelpfulPromptLine.test.jsx src/pages/journal-2-0/components/notebook/NoteEditorPage.helpfulPrompt.test.jsx src/pages/journal-2-0/components/notebook/TemplateGallery.test.jsx src/pages/journal-2-0/lib/offline/doorEnumeration.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Bytes: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`. Expected: `VERDICT: PASS`; record the total and the remaining headroom in the commit message.
- [ ] **Step 6:** Commit: `feat(notebook): helpful after three days of use, with a one-time question on the third (dark)`.

### Task 11.19: My tools: the Templates tab, credits and Share to library

**Files:**
- Modify: `myTools/MyToolsSheet.jsx`, `myTools/myToolsLib.js` (the Templates tab stops showing "Coming soon" while `widgetsWaveOn(11)`)
- Create: `myTools/TemplatesTab.jsx`
- Modify: `myTools/WidgetsTab.jsx`, `myTools/RoutinesTab.jsx`, `myTools/TrackersTab.jsx` (the credit line; "Share to library"; "Update from the library")
- Modify: `myTools/UsedInList.jsx` (takes `kind: 'template'`)
- Test: `myTools/TemplatesTab.test.jsx`, `myTools/MyToolsSheet.test.jsx`, `myTools/WidgetsTab.test.jsx` (or its existing file), `myTools/RoutinesTab.test.jsx`, `myTools/TrackersTab.test.jsx`, `src/styles/tapFloor.test.js`

**Interfaces:**
- Consumes: Task 11.12 journal-styles routes (`view`, `archive`, `unarchive`, `duplicate`, `delete`, `used-in`), Task 11.15 (`openSharePreview`), Task 11.17 (`openAdoptSheet` for updates with new slots), the existing lazy style editor opener (`styles/lazyStyles.js`).
- Templates tab rows: name; the kind of note (`KIND_TITLE`-style kind names from `noteKinds`); `"Used in <N> notes"` (opens `UsedInList` for the template; `"Not in any note"` at 0); last edited; the credit (`"Based on <label>'s <title>"` / `"Based on a former member's <title>"`) for copies. Row actions in `ContextPopover`: Open (the style editor), Rename (`PUT /journal-styles/{id}`), Duplicate, Share to library (`openSharePreview({kind: 'template', id})`; absent for copies from the library), Archive (`"It stays in your <N> notes. New notes can't use it until you restore it."`). Filters Active, Archived (Restore, "Delete permanently" with the name typed, `DeleteConfirm`) and Recently deleted (Restore, `"Kept until <Mon D>"`). Built-in templates are not listed (they are not the member's). Phone: rows 56 px.
- Widgets, Routines and Trackers rows gain the credit line for copies, "Share to library" (own work only) and, when the server marks `updateAvailable`, "Update from the library" (`updateTool`; when the new version has unanswered slots, `openAdoptSheet` in update mode). Routines and trackers made from a template read `"From template: <settings.fromTemplate>"` (W11-R13; replaces wave 9's `sourceTemplateKey` read).
- `COMING_SOON.templates` stays for wave 11 off.

- [ ] **Step 1: Write the failing tests:** `templates_rows_used_in_kind_and_credit`, `archive_sentence_with_count`, `delete_only_from_archived_with_typed_name`, `recently_deleted_kept_until`, `share_action_opens_preview_and_absent_for_copies`, `coming_soon_when_w11_off`, `tools_rows_show_credit_and_share`, `from_template_reads_setting`, `update_from_library_calls_update_or_opens_sheet`, the tap-floor rail.
- [ ] **Step 2:** Run `cd app && npx vitest run src/pages/journal-2-0/components/notebook/myTools src/styles/tapFloor.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notebook): My tools Templates tab, library credits and sharing from every tab`.

### Task 11.20: Browser walk

- [ ] **Step 1:** On a local sandbox (`scripts/hub_sandbox_boot.py` with the census pins, the data dir passed explicitly, never `C:\data`, a paid walk account) with `NOTEBOOK_WIDGETS_W8_ENABLED=1`, `W9`, `W10` and `W11` `=1`, at 1200, 820 and 390 px:
  - TemplatePicker → Template library → Pre-market prep → Preview: cards with my data; Use → "Create Pre-market routine from the template" → Use: the note has the prep blocks, two widgets filled, the routine bound to today; tick one item; reload: the note shows no unsaved change;
  - use Pre-market prep again: no routine question; one routine in My tools, "From template: Pre-market prep";
  - Night-before prep on the sandbox clock set to Sunday 21:00 ET: the routine reads "For Mon Nov 23"; Weekend swing review on Saturday: "For the week of Oct 19";
  - Setup study with a member who has setups (suggested), then with a brand-new member ("Pick a setup to see this widget.", Use disabled until picked);
  - save a note holding two built widgets, a routine and a tracker as a template; Share to library → read "What will be shared" → switch one number on → Send for review; approve as admin; adopt as a second member with pick-yours changes; the credit line on the copy;
  - share a widget, a routine and a tracker from My tools; adopt each as the second member;
  - Helpful refused before day 3; the 3rd-day line on the third ET day's note; Yes; the count rises once;
  - My tools Templates: rename, duplicate, archive (gone from the picker), restore, delete permanently with the typed name, Recently deleted;
  - share the note made from a template and open the link in a private window: built widgets show the account line (share off), routines and trackers the neutral line;
  - set `NOTEBOOK_WIDGETS_W11_ENABLED=0`, reload: the library section, the new types and the Templates tab are gone ("Templates are coming soon."), the made notes are unchanged, a style holding slots opens in the editor without them and saving it keeps them; set it back: everything returns;
  - at 390 px also with the keyboard open in a slot's number input and in the share preview's Name field.
- [ ] **Step 2:** VoiceOver on iOS Safari 17 (BrowserStack Live) for the adoption sheet, the share preview and the 3rd-day line, by the operator who ran it.
- [ ] **Step 3:** Save the raw evidence to `docs/notebook/evidence/<run-id>/` and commit it before writing any summary (R-RAW).

### Task 11.21: Wave 11 verification, the 50-member test campaign (waves 8-11), and ship dark

**Files:**
- Create: `tools/notebook_campaign/seed_members.py`, `tools/notebook_campaign/personas.json`, `tools/notebook_campaign/run_campaign.py` (Playwright, Python; no README: the w9 ledger and this plan are the record)
- Create: `docs/notebook/evidence/<run-id>/defects.jsonl` and the raw per-persona evidence
- Modify: `CLAUDE.md` (the single-process list), `docs/feature_flags.json` (on arming only)

- [ ] **Step 1:** Backend, by name: `python -m pytest tests/test_tool_binding.py tests/test_tool_binding_vectors.py tests/test_trading_days.py tests/test_journal_styles_slots.py tests/test_journal_styles_store.py tests/test_journal_styles_compose.py tests/test_journal_styles_create.py tests/test_journal_styles_update.py tests/test_journal_styles_schema.py tests/test_journal_styles_archive.py tests/test_widget_share.py tests/test_widget_share_canary.py tests/test_widget_share_resolve.py tests/test_slot_fill_built.py tests/test_slot_fill_tools.py tests/test_template_tools.py tests/test_gallery_item_types_w11.py tests/test_gallery_share_w11.py tests/test_gallery_adopt_w11.py tests/test_gallery_credit_w11.py tests/test_gallery_suggest.py tests/test_template_preview.py tests/test_template_library_seed.py tests/test_gallery_helpful_w11.py tests/test_gallery_router_w11.py tests/test_style_library.py tests/test_style_library_adopt.py tests/test_style_library_notices.py tests/test_style_library_review.py tests/test_style_library_social.py tests/test_firm_style_seed.py tests/test_starter_packs.py tests/test_gallery_rows_carry_kind.py tests/test_notebook_template_gallery.py tests/test_notebook_journal_styles_router.py tests/test_widget_definitions.py tests/test_widget_definitions_router.py tests/test_widget_run.py tests/test_widget_engine_isolation.py tests/test_widget_shelf_files.py tests/test_routines_store.py tests/test_trackers_store.py tests/test_routines_isolation.py tests/test_routines_router.py tests/test_public_note_payload.py tests/test_sample_never_feeds_real_numbers.py tests/test_journal_two_account_purge.py tests/test_account_tombstones.py tests/test_account_deletion_manifest.py tests/test_notebook_flags.py tests/test_notebook_flag_table_form.py tests/test_notebook_flag_parse.py tests/test_user_definitions_auth.py -q`. Expected: all PASS except the known `test_user_definitions_auth.py` `PER_ROUTER` screener red; totals line recorded.
- [ ] **Step 2:** Frontend, chunked: `cd app && npx vitest run src/pages/journal-2-0/components/notebook/library src/pages/journal-2-0/components/notebook/myTools src/pages/journal-2-0/components/notebook/styles src/pages/journal-2-0/components/notebook/TemplateGallery.test.jsx src/pages/journal-2-0/components/notebook/TemplatePicker.gallery.test.jsx src/pages/journal-2-0/components/notebook/StyleLibrary.test.jsx src/pages/journal-2-0/components/notebook/NoteEditorPage.helpfulPrompt.test.jsx src/pages/journal-2-0/components/notebook/blocks src/pages/journal-2-0/lib/blocks src/pages/journal-2-0/lib/journalBlocks.test.js src/pages/journal-2-0/lib/templateSlots.test.js src/pages/journal-2-0/lib/templateLibrary.test.js src/pages/journal-2-0/lib/builtWidgets.test.js src/pages/journal-2-0/lib/notebookWidgetsFlags.test.js src/widgets src/styles src/pages/journal-2-0/lib/offline/doorEnumeration.test.js src/components/screener/reachable.test.js`. Expected: all PASS (the known reds `reachable.test.js` expired parking note and `offlineNeverStoresComputed.test.js`'s two screener tests, read by name); totals recorded.
- [ ] **Step 3:** Bytes: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`. Expected: `VERDICT: PASS` under 2,260,793 B; record the total.
- [ ] **Step 4: The owner's 50-member test campaign (plan of record, w9 ledger), over waves 8-11, locally only.**
  - Setup: boot the local sandbox with `scripts/hub_sandbox_boot.py` and the census pins, the data dir passed explicitly, never `C:\data`; flags `NOTEBOOK_WIDGETS_W8_ENABLED`..`W11` `=1` locally only. ⛔ Production stays dark; only smoke@ and bench@ ever sign in to prod. Heavy steps take `uct-clips/tools/heavy_lock.py`.
  - `seed_members.py --data-dir <dir> --seed 20261024` creates the 50 members below, each with its data shape, deterministically (fixed seed, fixed clock per persona), and prints a census line per member (trades, strategies, notes, routines, trackers, styles, accounts).
  - `personas.json` holds, per persona, its scripts (step lists the runner executes), its viewports and its expected sentences. `run_campaign.py --run-id <id> [--persona Pnn] [--viewport 1200|820|390] [--keyboard]` runs each persona in its own browser context at 1200, 820 and 390 px, once with the pointer and once keyboard-only, and collects per run: console errors, failed requests (status ≥ 400 not expected by the script), horizontal overflow, touch targets under 44 px, axe findings (serious and critical), timings (first paint of the note, each sheet open, each preview), and a screenshot per step. Concurrency runs open two contexts on the same member.
  - The 50 personas:

| # | Persona and data shape | What the script exercises |
|---|---|---|
| P01 | Brand-new, no trades | builder examples on Sample data, every empty sentence, no zeros anywhere |
| P02 | 4 trades | the under-5 Sample data rule in builder, gallery and template previews |
| P03 | 12 trades, one account | small-sample badges (under 20), coverage lines |
| P04 | 300 trades, 3 accounts | accounts split, R-25 "Account N" on a shared note |
| P05 | 5,600 trades | "Based on your newest 5,000 trades", the too-long sentence, busy |
| P06 | Date-only broker imports | hour and hold-time fields "need times", tilt "needs times" |
| P07 | No stops on any trade | R coverage "R known on N of M", placeholder stops never 0% |
| P08 | Flagged trades mixed in | flag, never hide: lists label them, aggregates exclude them |
| P09 | Keyboard-only builder at 390 with the keyboard open | every builder step, sticky summary, focus return |
| P10 | Screen-reader proxy | axe on every sheet, table alternatives for every view |
| P11 | One widget in 20 notes | Update all vs Save as new, version history, restore |
| P12 | Hostile text (the fuzz corpus in names, tags, setups) | builder, share, nothing raises, nothing renders raw |
| P13 | Daily pre-market routine across Thanksgiving week | holiday off day, half day session, consistency words |
| P14 | Two devices on one routine day plus a third tab | concurrent ticks all survive, no note write or fork |
| P15 | Goes offline mid-tick | rollback, offline sentence, Retry |
| P16 | Strict mode with skipped days | consistency with skips, never "0 of" |
| P17 | Renames and removes items, changes the schedule | past days unchanged, history kept |
| P18 | 30 trackers, every kind, edge values | refusals with sentences, no stored bad value |
| P19 | Check-ins only | mood and focus trackers read-only |
| P20 | Reminder at 15:45 ET on the half day | one bell item at 12:45 ET, none late |
| P21 | Ticks at 23:30 ET and 8 sessions back | the window sentence, ET day not UTC |
| P22 | Archived and deleted routines, trackers and widgets | read-only blocks, Restore, Recently deleted |
| P23 | Builder over routine history and trading days | "routine done" split, footnotes |
| P24 | 150 ticks in a minute | the 429 sentence, nothing lost |
| P25 | Formula power user (5 fields, every function) | broken then fixed, keyboard only |
| P26 | Options-heavy, 500 strategies, no equity trades | options source, day P&L incl. options |
| P27 | Notes-heavy, 5,000 notes, 20 properties | notes source, property filters and sums |
| P28 | Prop-firm challenger with a breach day | prop-firm rules, risk left today |
| P29 | Tilt-prone day trader | tilt check, revenge clean days |
| P30 | Swing trader, dates only | hold-minutes sentence |
| P31 | No account size, no limits | calculator and risk-left sentences |
| P32 | Hostile formula text | formula refusals, nothing reaches SQL |
| P33 | Every shelf placement at revision 1 | "Updated version available", applied only on click |
| P34 | Template author with canary values everywhere | save as template, share preview, nothing private on the listing |
| P35 | Adopter with rich data | suggested values, pick yours, Use, credit |
| P36 | Adopter with no data | Any defaults, "Pick a setup to see this widget.", Sample data, no zeros |
| P37 | Night-before preparer | Sunday night, the eve of Thanksgiving, 23:30 ET binding |
| P38 | Weekend reviewer | Saturday and holiday-Friday week binding, "For the week of" |
| P39 | Two tabs press Use at once, then a double-click | one copy, one routine, two notes |
| P40 | Has a matching Morning routine | "Use your Morning routine" pre-selected, remembered |
| P41 | Uses a template on 3 ET days across UTC midnight | Helpful refused then allowed, the 3rd-day line once |
| P42 | Adopted from an author who then deletes their account | "Based on a former member's …" |
| P43 | Withdrawn listing mid-adopt; hand-made foreign ids; a widget deleted 31 days ago | 404, slot sentences, no foreign read |
| P44 | Templates tab manager | rename, duplicate, archive the default, restore, delete permanently, Recently deleted |
| P45 | Admin reviewer | approves widget, routine, tracker and template items; a held revision; watchers told once |
| P46 | Flag flipper | W11, W10, W9, W8 off one at a time with reloads: snapshots kept, "Not available right now.", nothing lost, all back on re-arm |
| P47 | Unpaid member | the 402 sentence on every paid route |
| P48 | Logged-out viewer | shared, published, gallery and example pages of template-made notes: account and neutral lines only, no values |
| P49 | Phone-only member at 390 | every sheet, tap floor, segmented tabs |
| P50 | Tablet at 820 on a throttled network with a saturated pool and full caps (100 widgets, 30 routines) | busy and cap sentences, timings |

  - Failure states every applicable persona forces at least once: offline, busy (pool saturated), rate (429), too long, flag off mid-session, 402, 409 and 428 conflicts, a foreign id, an archived tool, a deleted author, a withdrawn listing.
  - Defects: every finding is a line in `docs/notebook/evidence/<run-id>/defects.jsonl` (`{"id": "D-W11-nnn", "persona", "viewport", "keyboard", "steps", "expected", "actual", "evidence", "severity", "status", "fixSha", "retest"}`). Each defect is fixed test-first (the failing test named in the fix commit `fix(notebook): D-W11-nnn <what>`), then re-tested by re-running its persona at its viewport (`retest` records the run and the result). None is closed without a retest. After the last fix, the full campaign runs once more end to end; it must record zero open defects and zero serious or critical axe findings.
  - Commit the raw evidence (R-RAW) before any summary; the summary is a table of personas x viewports x pass/fail with the defect ids.
- [ ] **Step 5:** In the same branch, add to `CLAUDE.md`'s single-process list (the per-process state paragraph): `template_preview._CACHE` (300 s, per-process), and the gallery preview scope now shared with the share preview and preview with my data (60/hour), in-process only. Commit: `docs: single-process note for the template preview cache`.
- [ ] **Step 6:** Open a PR to master with the member-impact paragraph "Nothing changes for members: the template library, sharing and adopting widgets, routines and trackers, and the Templates tab ship switched off." Merge, deploy, verify the new boot by the `/api/health` uptime reset and `tools/hub_nav_smoke.py --auth`.
- [ ] **Step 7:** Arming is the owner's flip, after waves 8-10 are armed: report `railway variables --service web --set NOTEBOOK_WIDGETS_W11_ENABLED=1` and its rollback `=0` (never a delete). When armed, update `docs/feature_flags.json` (`status: armed`, the service, the flip time) in the same docs push.

---

## Scan for conflicts

| Tasks | Shared file or interface | How it is kept safe |
|---|---|---|
| 11.2 → 11.6, 11.14 | `tool_binding.py`, `tests/fixtures/toolBindingVectors.json` | 11.2 commits the vectors first; 11.6 imports, 11.14 only reads them; a vector change is an 11.2 follow-up that reruns both twins |
| 11.3 → 11.5 → 11.6 → 11.13 | `journal_styles.py` | sequential in Lane S; 11.5 and 11.6 put their logic in new modules (`slot_fill.py`, `template_tools.py`) and add only builder rows and branches here |
| 11.3 vs `template_gallery.py`, `starter_packs.py` | `KNOWN_BLOCKS` membership | the `_KnownBlocks` subclass changes no call site; `test_known_blocks_prefix_test_reaches_every_module` and the starter-pack and adopt suites run in 11.3 |
| 11.4 → 11.8, 11.9 | `share.*` contract, slot shapes, sentences | one pure module owns them; consumers import, never copy; the canary rail runs in 11.8's suite too |
| 11.5, 11.6 | `slot_fill.py` | 11.5 creates it (built slots); 11.6 adds the tool functions after it |
| 11.6 vs wave 9 | `routines.py`, `trackers.py` (`create` gains `source_gallery_id`; `fromTemplate` setting) | additive keyword and one settings key; `test_routines_store.py`, `test_trackers_store.py`, `test_routines_isolation.py` in the run |
| 11.7 → 11.8 → 11.10 → 11.11 | `template_gallery.py` | sequential in Lane G; 11.10's only edit there is one seeder call |
| 11.7 vs 11.13 | `db.py` `_PHASE_2_ALTERS` | 11.13 runs after 11.7; each appends its own statements |
| 11.7 | `ITEM_TYPES` in `template_gallery.py` and `lib/styleLibrary.js` | ONE commit, the only client file the backend lane touches (lazy, no build); `tests/test_style_library.py` parses both |
| 11.8 vs wave 8, 9 | `run.py`, `routines._write_day`, `trackers.set_value` | one hook call each (`record_use_day`); `tests/test_widget_run.py`, `tests/test_routines_store.py`, `tests/test_trackers_store.py` in the run |
| 11.9 vs 11.8 | `run.py` | 11.9 adds `run_plans_batch` beside `run_examples`; 11.8 adds one line in `run_plan`; different functions, pathspec commits, the second rebases on the first |
| 11.10 vs wave 10 | `widget_engine/shelf/MANIFEST.json` | read only; pinned revisions railed against it; the seed is append-only, railed against `origin/master` |
| 11.12 | `notebook_template_gallery.py`, `notebook_journal_styles.py` | last in the backend; literal paths declared before `/{gallery_id}` |
| backend → frontend | the merge point after 11.12 | frontend tasks mock `fetch` against this plan's shapes until the merge |
| 11.1, 11.14, 11.18 | `notebookWidgetsFlags.js`, `notebookFlags.js`, `journalBlocks.js`, `NoteEditorPage.jsx` (eager) | serialized eager chain 11.1 → 11.14 → 11.18; each runs the bytes gate |
| 11.15 → 11.16, 11.17, 11.19 | `lib/templateLibrary.js`, `library/library.module.css` | 11.15 creates them; later tasks add only their own calls and classes |
| 11.17 → 11.16, 11.19 | `openAdoptSheet` | 11.17 defines; 11.16 and 11.19 consume |
| 11.16 vs wave 7 | `TemplatePicker.jsx` (lazy chunk) | one lazy section behind `widgetsWaveOn(11)`; the picker's keyboard rails run in 11.16 |
| 11.19 vs 9.18 | `RoutinesTab.jsx`, `TrackersTab.jsx`, `MyToolsSheet.jsx` | 11.19 after 9.18; additive row lines and actions |
| 11.14, 11.18, 11.21 | `npm run build` into `app/dist` | one build at a time in `nbw-p2-impl` (R-9) |
| 11.21 campaign fixes vs every wave | any file a defect needs | one defect, one test-first commit with a pathspec, the persona re-run recorded; the full re-run last |
