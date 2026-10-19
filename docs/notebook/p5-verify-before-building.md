# P5 verify-before-building (Task 1)

**HEADROOM OK.** First-open closure **2,238,564 B** across 61 JS chunks, budget **2,260,793 B** (`docs/notebook/perf-budgets.json:11` `"max": 2260793,`): headroom **22,229 B**. R-P5-10's ceiling for P5 is therefore **2,240,064 B** (base + 1,500 B). The plan's "about 25 KB" has drifted by 2,767 B since Tier 3's reading (2,235,797 B); it is still far above the 2,000 B stop line.

Run id `20261018T150502Z`, worktree `C:\Users\Patrick\uct-worktrees\notebook-p5`, branch `notebook-p5-launch`. Raw outputs: `docs/notebook/evidence/p5-verify-20261018T150502Z/`, committed before this document in `5cabdf4af0` (R-RAW). `J` = `app/src/pages/journal-2-0`, `ON` = `J/components/notebook/onboarding`, `S` = `api/services/journal_two`. Every line below was read at the base in V1. Nothing was changed.

Verdict key: **confirmed** (quote + file:line), **confirmed, drifted** (same shape, new line numbers; old and new given), **DIFFERS** (the shape changed; the plan text that must change is named, and the conflict is in the pre-flight table).

## Step 1: the worktree

Done by the controller; re-checked read-only (`evidence/.../step1-junction.txt`, `v1-ancestors.txt`).

- `app\node_modules`: `LinkType=Junction Target=C:\Users\Patrick\uct-worktrees\_nb-shared-install\node_modules shared_entries=377 through_link=377`.
- `.uct-session-owner`: `session: 61625d99-f8db-4269-a728-231c08d3da11`, `created: 2026-10-18`.

## Step 2: base reds

Each file ran alone (`run-one-file.sh`; pytest by named file, vitest by named file with `--maxWorkers=2`). Exit codes and totals: `evidence/.../results-index.txt` and `totals.txt`. Every log has a totals line.

**Vitest, 15 files, 14 green, 1 red:** `tourRegistry` 70, `tourAnchors` 38, `tourReachability` 22, `tourEligibility.realRegistry` 8, `learnTours` 18, `capabilityList` 14, `notebookTelemetry` 14, `reachable` 17, `tapFloor` 5, `notebookFlags` 20, `styleLibraryFlag` 4, `journalStylesFlag` 4, `CapabilityPreview` 13, `ResearchHome.welcome` 22, all passed. `keyListenerCensus`: **2 failed**, 5 passed (run because Task 5 Step 4 names it).

**Pytest, 12 files, 10 green, 2 red:** `test_notebook_telemetry_events` 17, `test_j2_telemetry_allowlist` 14, `test_notebook_template_gallery` 41, `test_style_library` 39, `test_style_library_adopt` 57, `test_preference_key_validation` 27, `test_notebook_flags` 61, `test_notebook_flag_table_form` 11, `test_feature_flag_ledger` 413, `test_visibility_flag_ledger` 24, all passed. `test_notebook_flag_parse`: **2 failed**, 312 passed. `test_notebook_switch_rehearsal`: **1 failed**, 24 passed.

The five reds, all on the known base list (the same five P3a recorded at `f2e816e042`):

| File | Test | What it reads |
|---|---|---|
| `tests/test_notebook_flag_parse.py` | `test_NO_notebook_flag_is_read_outside_the_one_parse` | `tools/notebook_daily_prep_probe.py:282  NOTEBOOK_SETUPS_BOARD_ENABLED`, `:283  NOTEBOOK_CHART_PLAN_ENABLED` |
| `tests/test_notebook_flag_parse.py` | `test_every_flag_on_call_names_a_payload_flag` | `tools/runtime_pane_smoke.py:234,236` `VITE_PINE_RUNTIME_PANE_ENABLED` |
| `tests/test_notebook_switch_rehearsal.py` | `test_every_notebook_gate_is_rehearsed_or_carries_a_reason` | `assert not ['NOTEBOOK_TERMINAL_LINKS_ENABLED']` |
| `app/src/pages/command/keyListenerCensus.test.js` | `no file holds MORE raw key listeners than its baseline` | `app/src/pages/admin/GoldReview.jsx: literal 1 > baseline 0`, `app/src/pages/traderArchive/ArchiveThumbs.jsx: literal 1 > baseline 0` |
| `app/src/pages/command/keyListenerCensus.test.js` | `the baseline sits at or under the stated CEILING` | `expected 113 to be 111` |

None is Notebook code. Later tasks compare against these five rows, never against green.

The "flag tests" were taken as P3a Task 2's set: `test_notebook_flags.py`, `test_notebook_flag_parse.py`, `test_notebook_flag_table_form.py`, `test_feature_flag_ledger.py`, `test_visibility_flag_ledger.py`, `test_notebook_switch_rehearsal.py`, and the client `notebookFlags.test.jsx`, `styleLibraryFlag.test.js`, `journalStylesFlag.test.js`. F1, F8 and F11 name no rail.

## Step 3: V1 to V12

### V1: base SHA and the three ancestors — confirmed

`HEAD=04778e06061191747bd00b881a5f227af570df6e` = `origin/master` ("Merge pull request #392 from unchartedterritory5995-cyber/notebook-t3"). `git merge-base --is-ancestor <sha> HEAD`, each exit code captured before anything else ran (`v1-ancestors.txt`):

- P3a's merge `ecb377b6414e3aa43f3dcfd6862ddd3d8f56e982` "Merge pull request #391 from unchartedterritory5995-cyber/notebook-p3a-library": exit 0.
- P4a's merge `a512f220f75fcfb3e89fb78595e183a00317eb90` "Merge pull request #388 from unchartedterritory5995-cyber/notebook-p4a-layouts": exit 0.
- #373 `4028fe61fe03372329e5e60bb42895225fa1ee09` "Merge pull request #373 from unchartedterritory5995-cyber/notebook-lazy-screenshot": exit 0.
- Control: `is-ancestor HEAD HEAD~1`: exit 1, so the check can fail.

### V2: F1 and F2 (tour entries, steps, copy)

**F1 — confirmed.**
- `ON/tourRegistry.js:50` `export const ENTRY_FIELDS = Object.freeze(['flag', 'id', 'load', 'replayable', 'title'])`.
- `:63` `export const OPTIONAL_FIELDS = Object.freeze(['requires', 'start'])`.
- `:122` `export function assembleRegistry(...lists) {`; `:164` `export const TOUR_REGISTRY = assembleRegistry([BASE_ENTRY], TRACK_TOURS)`.
- `ON/tours/index.js:78-87`: `import { TOURS as b1CoreTours } from './b1Core'` ... `export const TRACK_TOURS = Object.freeze([` ... `...b3ResearchTours,`. One import and one spread per track.
- Worth knowing for Task 7: a PATH start's pathname must be in `START_ROUTES` (`:70-75`: `NOTEBOOK_ROOT, '/journal/notebook/setups', '/journal/trades', '/journal-2-0/playbook'`). `?view=all` is a query on `NOTEBOOK_ROOT`, so it is allowed.

**F2 — confirmed (steps), DIFFERS on the copy rail's address.**
- `ON/tours/b1TemplateGallery.steps.js:16-21`: `export const STEPS = Object.freeze([` / `Object.freeze({ id: 'templates', anchor: 'templates', file: TAB, waitFor: 'template-gallery-door' }),` / `step('door', 'template-gallery-door', PICKER),` ... `:23` `export const COPY = Object.freeze({`.
- `ON/tourRegistry.test.js:111` `const [lo, hi, kind] = entry.replayable ? [3, 6, 'a replayable tour'] : [1, 2, 'a replayable:false explainer']`, applied to every tour at `:124-132`. Confirmed at `:115-147`.
- The no-em-dash / no-`!` rule is **not** in `tourRegistry.test.js`. It is per track: `ON/tours/b1Core.test.jsx:84` `expect(text, `${id}.${k}`).not.toMatch(/[—–!]/)`. `b2Trading.test.jsx:78` and `b3Research.test.jsx:76` forbid only dashes. Task 7's `b4Styles.test.jsx` must carry the b1Core form (with `!`).

### V3: F3 and F4 (anchors, waitFor, count rails)

**F3 — confirmed.**
- `ON/tourAnchors.test.js:112-126`: `it.each(TOUR_REGISTRY.map((t) => [t.id]))(` / `'tour %s: every step\'s anchor appears EXACTLY once in its named file',` / `expect(n, ...).toBe(1)`.
- `ON/GenericTourEngine.jsx:313-331`: the waitFor effect; `:327` `const owner = steps.findIndex((s, j) => j > index && s.anchor === step.waitFor)`. `:322` `if (!anchorFor(step.anchor)) requestReveal(step.waitFor)` is the drawer reveal. `:515` `{step.waitFor && <p id={waitId} className={own.waiting} role="status">Do this to continue, or choose Next to skip it.</p>}`.

**F4 — confirmed. The counts have not moved since the plan.**
- `ON/tourReachability.test.jsx:125` `expect(OTHER_TOURS).toHaveLength(21)`; `:126` `expect(OTHER_TOURS.filter((t) => !t.replayable).map((t) => t.id)).toEqual(['note-resurfaces'])`.
- `ON/tourEligibility.realRegistry.test.js:59` `expect(expected).toHaveLength(20)        // 21 registered tours (B1 8 with P0.10's voice notes, B2 6, B3 7) less the explainer`. `:22-24` every tour flag must be a `FLAG_FALLBACKS` key.
- `ROUTE_OF_FILE` `:34-59`; the lazy-dialog form is `:46` `'components/notebook/TemplatePicker.jsx': () => false,            // a picker open: behind a click`.
- One more rail holds a floor, not a count: `ON/tourRegistry.test.js:119` `expect(budgeted.length).toBeGreaterThanOrEqual(20)` (stays green at 23).
- **Note for Task 7 (C10).** The World filter checks only steps before the first `waitFor` target (`:65-72`), and `'tabs/NotebookTab.jsx': onNotebook` (`:47`) is true on any `/journal/notebook` (`:32` `const onNotebook = (l) => l.pathname === '/journal/notebook'`), Research Home included. So this rail cannot tell a NotebookTab list-header anchor that is on screen from one that is not.

### V4: F5 and F6 (Learn groups, capability lines)

**F5 — confirmed.**
- `ON/learnTours.js:37` `export const LEARN_GROUPS = Object.freeze(['Basics', 'Writing and capture', 'Trading', 'Research'])`.
- `:40-48` `export const GROUP_OF = Object.freeze({` with 21 rows. `'template-gallery'` sits under `'Basics'` (`:41`).
- `ON/learnTours.test.js:177` `expect(LEARN_GROUPS).toEqual(['Basics', 'Writing and capture', 'Trading', 'Research'])`; `:182-189` every replayable id has a row; `:191-197` no stale row.
- Bytes: `learnTours.js` is **outside** the first-open closure (`v11-v12-closure-markers.json`: "Writing and capture" only in `learnTours-DK1Zh1JK.js`), so the two `GROUP_OF` rows cost no first-open bytes.

**F6 — confirmed.**
- `ON/capabilityList.js:19` `export const CAPABILITY_PREVIEW = Object.freeze([` ... `:100` `])`; `:115` `export function armedCapabilities(flag = notebookFlag) {`.
- `ON/capabilityList.test.js:25-30` flag must fall back to false; `:32-41` ids and flags unique; `:43-51` no `—`, no `!`, `expect(c.line.length, c.id).toBeLessThanOrEqual(120)`.
- Neither `journal-styles` nor `style-library` is an existing id. Task 8's two lines measure 99 and 100 characters. Both flags are `FLAG_FALLBACKS` rows that fall back to false (`J/lib/offline/notebookFlags.js:77` `notebook_journal_styles_enabled: false,`; `:81` `notebook_style_library_enabled: false,`).
- Lazy: confirmed ("What your Notebook can do" only in `capabilityList-CFHeAvnw.js`, outside the closure).

### V5: F7 (telemetry)

**F7 — DIFFERS (Task 6's count). Shape confirmed, lines drifted.**
- Names: plan `J/lib/notebookTelemetry.js:35-51` → now **`:39-57`**. `:39` `export const NOTEBOOK_EVENTS = Object.freeze({` ... `:55` `LIBRARY_VIEWED: 'library_viewed',` / `:56` `STYLE_ADOPTED: 'style_adopted',`. That is **17 names** (P3a added two).
- `CORE_ACTION_EVENTS`: plan `:59-77` → now **`:65-83`**. `:84-87` says P3a's events are deliberately not rows: `// ⛔ P3a's `library_viewed` and `style_adopted` are NOT rows above (Task 11). ... a row added here reds that rail`. This agrees with R-P5-8 ("None of the three is a `CORE_ACTION_EVENTS` member").
- `oneOf`: plan `:79-82` → now `:92` `const oneOf = (...values) => ({ type: 'enum', values: new Set(values) })`.
- `EVENT_SCHEMAS`: plan `:85-158` → now **`:95-175`**, last entry `:172-174` `style_adopted: { notify: bool, },`.
- Client pin: `J/lib/notebookTelemetry.test.js:23-27` sorts and pins the 17 names (`'ask_used', ... 'writing_help_used',`). **Task 6's "now has 18 names" is wrong: it will be 20** (C7).
- Orphan rail `:110-116` names its own list of wave-10 events. New events need no core row.
- Server: `tests/test_notebook_telemetry_events.py:29-32` reads the names; `:80-89` `assert _server_schemas() == client`. **The schema parser is one line per prop**: `:65` `m = re.match(r"^    ([a-zA-Z_]+): (num|bool|oneOf\((.*)\)),?$", line)`. A `block_used.kind` `oneOf(...)` wrapped over two lines would not parse.
- Forbidden keys: plan `:223-232` → now **`:260-269`**, `for forbidden in ("title", "body", "bodyJson", "query", "q", "text", "question",` / `"content", "patch", "subtitle", "name", "url"):`. Neither `kind` nor `via` is on it. (`:215-227` is P3a's library-events test; `:303` is now `def test_counts_cover_both_windows_zero_fill_and_count_members(db):`.)
- Server allowlist `api/routers/journal_two.py:162` `_J2_TELEMETRY_EVENTS = {` (closes `:223`, `"library_viewed", "style_adopted",` at `:222`); schemas `:243` `_NOTEBOOK_PROP_SCHEMAS: dict[str, dict[str, Any]] = {`.
- Admin count: `api/routers/client_errors.py:108-110` imports `_J2_TELEMETRY_EVENTS` and returns `notebook_telemetry.event_counts(_J2_TELEMETRY_EVENTS)`. It derives from the allowlist, so Task 6 needs **no** `client_errors.py` edit.
- `S/test_telemetry.py` exists (`api/services/journal_two/test_telemetry.py`).
- Bytes: `notebookTelemetry.js` is in the closure (marker `conflict_forked` found in 2 closure chunks).

### V6: F8 and F9 (event call sites, firm seed)

**F8 — confirmed, drifted.**
- `J/lib/noteCreation.js`: plan `:30,44-45,55-61` → now **`:32`** `export async function createNoteViaApi({`, **`:47-48`** `...(styleId ? { styleId } : {}),` / `...(kindId ? { kindId } : {}),`, **`:59-64`** `if (!res.ok) {` ... `throw err`. Tier 3 added `isCopy` (`:52`). Callers that pass `kindId` include `lib/planCreate.js` and `lib/followupCreate.js`, so their creates count as `style_applied` `'new_note'`. This is in the closure (marker found).
- `styles/StyleHost.jsx:69-87` confirmed: `:69` `const finish = (applied, plan) => {`. **Its dirty branch returns early** (`:70` `if (api.dirty().length) {` ... `:75` `return true`) before the `plan?.switching` notice at `:83-85` (C9).
- `J/lib/journalStyles.js:80` `export const createJournalStyle = (body) => call(STYLES_URL, { method: 'POST', body })`. Callers: `StyleEditor.jsx:171`, `StylesManager.jsx:224` (duplicate), `SaveAsStyleForm.jsx:72`. **This file is lazy** (`/mapping-offer` only in `styleErrors-BMhSp8JO.js`), so the `style_created` call site costs no first-open bytes.
- `J/lib/widgetEmbedNode.jsx:177` `insertWidgetEmbed: (widgetId, capture, extra) => ({ chain }) =>` confirmed. It is in the closure. Its callers: `SlashMenu.jsx:43` (`.insertWidgetEmbed(id).run()`), `SlashMenu.jsx:334` (`insertWidgetEmbed('marketcontext', params)`), `NoteEditorPage.jsx:596` (a capture). The registry already reaches the closure through `widgetEmbedCore.js:6-8` (`from '../../../widgets/registry'`).

**F9 — confirmed in shape, every line drifted. DIFFERS on what the count rails count (C4) and on a required column (C5).**
- The seed index: plan `:151` → now `S/template_gallery.py:177-178` `"CREATE UNIQUE INDEX IF NOT EXISTS idx_j2_template_gallery_seed"` / `" ON j2_template_gallery(seed_key) WHERE seed_key IS NOT NULL",`.
- `ensure_gallery_schema`: plan `:183` → now `:244`. It ALTERs the P3a columns in a loop (`:254-265`: `item_type`, `payload_json`, `version`, `trading_style`, `source_style_id`, `pending_json`, `pending_at`). The seed is `:270-273` `try:` / `seed_firm_templates(conn)` / `except Exception as e:  # noqa: BLE001 -- never crash startup over a seed` / `print(f"[template-gallery] firm seed skipped: ...")`.
- `load_seed`: plan `:223` → now `:297-299`, `return list(data.get("templates") or [])`. The `v` is never read, as the plan says.
- `seed_firm_templates`: plan `:228-245` → now `:302-319`. The INSERT names no `item_type`, so a row defaults to `'outline'`.
- `category` is required: `:157` `category            TEXT NOT NULL,`, and `CATEGORIES = ("trade_plan", "journal", "research", "review")` (`:73`). Task 3's seed shape and table carry no category (C5).
- `style_payload`: plan "P3a `:671-720`" → now **`:827-883`**. Its rules: built-in kind only (`:858-859`); outline inlined, then `sanitize_body(outline, user_id)` (`:878`); only `KNOWN_BLOCKS` blocks (`:879-880`); `builtin:note_kind` skipped (`:870-871`). `MAX_BODY_BYTES = 200_000` (`:106`) is enforced by `publish_style` (`:916`).
- The count rail: `tests/test_notebook_template_gallery.py:489` `assert 4 <= len(seeds) <= 6` reads `load_seed()` only. But **`:496-498` and `:685-688` count every `kind = 'firm'` row against `len(seeds)`**: `n = conn.execute("SELECT COUNT(*) FROM j2_template_gallery WHERE kind = 'firm'").fetchone()[0]` / `assert n == len(seeds)`, and `assert left == 0 and firm == len(svc.load_seed()) and b_copies == 1` (C4). `tests/test_j2_db_import_closure.py:69` `assert seeded > 0` stays green, and its `:66` `assert "firm seed skipped" not in out` means the style seed must not import `fastapi`/`starlette` (`:25` `BLOCKED = ("fastapi", "starlette")`).
- The `_style_library_helpers.py:33` fixture empties the table (`c.execute("DELETE FROM j2_template_gallery")`), so the style-library rails do not see seeded rows.
- Not measured: whether `sanitize_body` returns Task 3's heading-plus-empty-paragraph outline unchanged. Task 3 test 3 will answer it. No `api.**` module was imported outside pytest on this box.

### V7: F10, F11 and F12

**F10 — confirmed, drifted.**
- `api/routers/auth.py:2829` `_PREFERENCE_KEYS = {`. Plan `:2870` is now `:2882` `"notebook_getting_started": _PREF_OPAQUE,`; that precedent is OPAQUE. A named validator follows P4a's precedent: `:2866` `"journal_page_layout": "journal_page_layout",`, dispatched at `:3233-3234` `elif schema == "journal_page_layout":` / `_validate_page_layout(value)`.
- Client-writer rail: `tests/test_preference_key_validation.py:69` `_CALL = re.compile(r"\b(?:setPref|setPrefMerged|deletePref)\s*\(\s*([A-Za-z0-9_$'\"]+)")`; the test is `:228-256`. The `shaped` dict is `:251` `shaped = {"joystick_hub": "{}", "indicator_templates": "[]", "journal_page_layout": '{"version": 1}'}`. Task 4 adds a fourth entry there.
- Nothing records a first use of styles: `notebook_starter` appears nowhere in `auth.py`.

**F11 — confirmed.**
- `J/tabs/NotebookTab.jsx:85` `import { OTHER_TOURS } from '../components/notebook/onboarding/tourRegistry'`.
- `app/src/components/Layout.jsx:12` `import { OTHER_TOURS } from '../pages/journal-2-0/components/notebook/onboarding/tourRegistry'`.
- Closure membership, by marker string in the built chunks (`v11-v12-closure-markers.json`):
  - In the closure: `tourRegistry.js`, the `b1Core.js` entries, `notebookTelemetry.js`, `notebookFlags.js` `FLAG_FALLBACKS`, `noteCreation.js`, `widgetEmbedNode.jsx`, `NotebookTab.jsx`, `widgets/registry.js`.
  - Outside the closure: `learnTours.js`, `capabilityList.js`, `journalStyles.js`, `StyleHost`/`KindSection` (`StyleSurfaces` chunk), `StylesManager`, `TemplateGallery`, `StyleLibraryCard`, `LibraryDoor`, `journalBlocks.js`, `TodaySurface`.

**F12 — confirmed, one drift.**
- `S/note_kinds.py:43-51` holds the nine ids, `trade_plan` ... `watchlist_note`; `:53` `BUILTIN_KIND_IDS = frozenset(k["id"] for k in BUILTIN_NOTE_KINDS)`.
- `TRADING_STYLES`: plan "P3a `template_gallery.py:75-76`" → now `S/template_gallery.py:78` `TRADING_STYLES = ("swing", "day", "prop", "options", "earnings", "long_term")`. Every pack key is a trading style.

### V8: the list-header Styles button at 390 px — VISIBLE, icon-only, not behind a menu

- `J/tabs/NotebookTab.jsx:2509-2514` (unchanged since the map): `{stylesOn && (` / `<button type="button" className={styles.importBtn} onClick={() => setStylesOpen(true)} aria-haspopup="dialog">` / `<UIcon name="sliders" size={16} gold={false} />` / `<span className={styles.actionLabel}>Styles</span>`.
- Phone branch, `J/tabs/NotebookTab.module.css:466` `@media (max-width: 640px) {`:
  - `:527-529`: "Phone pass: Import / Export / Today / Templates show their icon only ... The words stay in the DOM, visually hidden, so each button keeps its name."
  - `.actionLabel` is visually hidden (`:530-538`, `clip-path: inset(50%);`).
  - `:539-544` `.newWrap :is(.importBtn, .exportBtn, .templatesBtn) {` gives `min-width: var(--tap-min, 44px);`. `:446-457` gives `.importBtn` `min-height: var(--tap-min, 44px)` at `<=1024`.
  - `.newWrap` wraps (`:225` `flex-wrap: wrap;`). No rule hides `.importBtn`.
- **So no phone anchor is needed** and the `b1ImageDocx` precedent (`ON/tours/b1ImageDocx.steps.js:14-20`, two phone-only `waitFor` steps) does not apply. Step 1 anchors on the button itself at every width.
- ⛔ **But the button is not on the page the plan starts the tour on.** The header lives in the list branch only. `NotebookTab.jsx:2329` `) : isHome ? (` renders `ResearchHome`, and the toolbar starts at `:2357-2362` (`<div className={styles.toolbar} role="toolbar" aria-label="Notes list tools"`). `:701` `const isHome = !noteId && !hasActiveFilters && !viewAll && !isTrashView`, and `:700` sets `viewAll` for `view=all`. R-P5-7's start `/journal/notebook` lands on Research Home, where the Styles button does not exist (C10). The template-gallery tour hit the same problem and fixed it: `ON/tours/b1Core.js:60-61` `// its door is in the notes list's header (W14-Q1 S6: from Home it never opened)` / `start: '/journal/notebook?view=all',`.

### V9: P3a's `adopt_style` — DIFFERS (Task 4, R-P5-2)

`S/template_gallery.py:1190-1191`:
```
def adopt_style(user_id: str, gallery_id: Any, *, notify: bool = False,
                conn: sqlite3.Connection | None = None) -> dict | None:
```
- **What it returns** (`:1248-1250`): `{"style": js.get_style(user_id, style["id"], conn), "notify": bool(notify), "credit": f"Based on {_author_label(row)}'s {row['title']}"}`. It returns None when the item is not a listed style (`:1207-1209`). For a firm row the credit reads "Based on UCT's ..." (`FIRM_AUTHOR = "UCT"`, `:116`).
- ⛔ **It refuses with the library switch off** (`:1200-1201`: `if not library_enabled():` / `return None`). R-P5-2's "It does NOT need the library switch" and Task 4 test 8 ("The library switch has no effect on install") are false if install calls it as it stands (C1).
- It raises `GalleryConflict(ADOPT_NEEDS_STYLES_SENTENCE)` when journal styles are off (`:1202-1203`).
- It raises `GalleryError(ADOPT_UNSUPPORTED_SENTENCE)` for a non-built-in kind (`:1215-1218`). This is the "unbuildable row" `skipped` case.
- A `StyleValidationError` from `create_style` becomes `GalleryError` (`:1234-1237`). That includes the per-member style cap, so a member at the cap would see their rows land in `skipped`.
- **A `conn` parameter exists, but it cannot share a caller's transaction.** It ends with `conn.commit()` (`:1247`), and on any exception it runs `if conn.in_transaction:` / `conn.rollback()` (`:1251-1254`), which rolls back whatever the caller had written before. R-P5-2's "per firm row inside one transaction" cannot be built on it unchanged (C2). The pieces underneath can: `js.create_style(..., provenance=(...), commit=False)` (`:1226-1233`) already writes the copy uncommitted.
- A repeat adopt makes another copy (docstring `:1196-1197`: "A repeat adopt makes another copy (the member's choice)"). Install's `alreadyHad` check has to be its own `source_gallery_id` lookup, as Task 4 says.
- A firm row records a use. `row["user_id"]` is NULL, so `:1238-1240` `INSERT OR IGNORE INTO j2_template_gallery_uses` runs.

### V10: `list_gallery` and `_library_hides` on a firm style row — DIFFERS (Task 3, R-P5-1)

- `S/template_gallery.py:656-659`, inside `list_gallery` (`:618`): `if not library_enabled():` / `if item_type == "style" or trading_style:` / `raise GalleryError("Unknown item type.")` / `where.append("g.item_type = 'outline'")`. With the library off, **every** style row is filtered out, firm or member. With it on, `:660-662` filters only by the requested type. So a firm style row (approved, featured) is listed exactly when the library switch is on.
- `:691-694` `def _library_hides(row: sqlite3.Row) -> bool:` ... `return row["item_type"] == "style" and not library_enabled()`. It is used by `_can_see` (`:697-702`), which gates `get_item` (`:713`) and `use_template` (`:1088`).
- **The interaction.** A firm style row becomes visible only through `library_enabled()`. There is no firm exemption, and nothing reads `kind` here. R-P5-1 wants the rows shown when either switch is on. That would show style rows in a gallery whose client renders a style card only with the library on: `J/components/notebook/TemplateGallery.jsx:392` `const card = (item) => (libraryOn && item.itemType === 'style' ? (` ... `) : outlineCard(item))`. Starter-packs-on with library-off would render a firm style as an outline card whose "Use template" calls `use_template` and copies the style row into `j2_note_templates` (`:1099-1100`) (C3).

### V11: P4a's merge against P5's eager edits — no collision

- P4a (`a512f220f7`) changed, under `J`: `surfaces/TodaySurface.jsx` (+107), the five `surfaces/today/panels/*`, `tabs/CalendarTab.jsx`, `lib/pageLayoutsFlag.test.js`, and `tabs/NotebookTab.jsx`. The NotebookTab change was two lines, the `DAILY_TEMPLATE_MISSING` import (`:47`) and `setActionError(DAILY_TEMPLATE_MISSING)` (`~:1878`), far from the Styles button at `:2509-2514`.
- `TodaySurface` is **outside** the first-open closure ("Loading your day" only in `TodaySurface-g_tAOOgk.js`).
- `TodaySurface.jsx:22-58` directly imports none of P5's eager files (`noteCreation.js`, `notebookTelemetry.js`, `widgetEmbedNode.jsx`, `tours/*`, `tourRegistry.js`).
- Its one note door is `surfaces/today/panels/TodayNotePanel.jsx:26` `import { DAILY_TEMPLATE_MISSING, DAILY_TEMPLATE_PREF, openDailyNote } from '../../../lib/dailyNote'`. That path does not call `createNoteViaApi` and sends no `styleId`/`kindId`, so it can fire no `style_applied`.
- P4a's two shared-list neighbours touch P5 only as adjacent text: `notebookFlags.js:80` `journal_page_layouts_enabled: false,` (Task 2 adds a row near it) and `auth.py:2866` plus the `shaped` dict at `tests/test_preference_key_validation.py:251` (Task 4 adds an entry). No line both sides change.

### V12: first-open closure and headroom — MEASURED

`cd app && npm run build` (`v12-build.log`, `EXIT: 0`), then `python tools/notebook_perf_budgets.py --dist app/dist` (`v12-bytes.txt`, verbatim):
```
bytes.notebook_first_open: 2,238,564 B across 61 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)
VERDICT: PASS -- within every budget checked
```
- Budget file `docs/notebook/perf-budgets.json`: `:9` `"baseline": 2153137,`, `:11` `"max": 2260793,`, `:12` `"max_rule": "floor(baseline * 1.05)"`. Roots `:6-7`: `src/pages/journal-2-0/JournalLayout.jsx`, `src/pages/journal-2-0/surfaces/NotebookSurface.jsx`. The budget file was read, not written.
- **Headroom = 2,260,793 − 2,238,564 = 22,229 B.** P5's ceiling under R-P5-10 = **2,240,064 B**.
- What P5 will add to the closure (from the membership above):
  - Task 2's `FLAG_FALLBACKS` row.
  - Task 6's three names, three schemas (`block_used.kind` is a 13-literal enum, C8), and the call-site code in **`noteCreation.js` and `widgetEmbedNode.jsx`, both eager** (R-P5-10's list omits these; C16).
  - Task 7's two thin entries and one import plus spread in `tours/index.js`, and the `data-tour="styles-button"` attribute in `NotebookTab.jsx`.
- Free: `learnTours.js`, `capabilityList.js`, `journalStyles.js`, `StyleHost`, `KindSection`, `StylesManager`, `TemplateGallery`, `StyleLibraryCard`.

## Pre-flight table

### A. Pairs of tasks that share a file or an interface

| # | Tasks | One produces / the other consumes | Found |
|---|---|---|---|
| A1 | 2 → 4 | Task 2 adds `NOTEBOOK_STARTER_PACKS_ENABLED` to `auth.py NOTEBOOK_FLAGS` and a `_server_gates()` lambda. Task 4 swaps the lambda for `starter_packs.enabled`. | Agree. |
| A2 | 2 → 3 | Task 3's visibility rule calls `starter_packs.enabled()`, which Task 4 creates. | **Conflict, C6.** Task 3 runs before the module exists. |
| A3 | 2 → 5 | Task 2's `J/lib/starterPacksFlag.js` `starterPacksEnabled()` and the `FLAG_FALLBACKS` row. Task 5's offer and link read them. | Agree. |
| A4 | 2 → 7, 8 | Tours and capability lines ride the styles and library flags. `tourEligibility.realRegistry.test.js:22-24` and `capabilityList.test.js:25-30` need both flags in `FLAG_FALLBACKS`, falling back false. | Agree (`notebookFlags.js:77,81`). |
| A5 | 3 → 4 | Task 3 seeds firm rows (`item_type='style'`, `trading_style=<pack>`, P3a payload `{kindId, outlineBodyJson, blocks, properties}`). Task 4 reads them "in seed order" and adopts each. | Payload shape agrees: `_safe_listed` (`S/template_gallery.py:1155-1176`) reads exactly those four keys. "Seed order" is undefined, since every row of one seed shares one `now` timestamp; propose `ORDER BY rowid` or the seed-key order. Adopting through `adopt_style` fails with the library off: **C1, C2**. |
| A6 | 3 ↔ existing rails | Task 3 adds 15 `kind='firm'` rows. The outline seed rails count `kind='firm'` rows. | **Conflict, C4.** |
| A7 | 4 ↔ 5 | `S/starter_packs.py` `PACKS` ↔ `J/lib/starterPacks.js` `PACKS` (one fact in two files; Task 4 test 10 parses the JS). | Agree. The JS is an array of `{key,label}` objects, so the parse must read `key:'...'`, not a string list. |
| A8 | 4 ↔ 5 | `install` returns `{installed:[{styleId,title}], alreadyHad:[title], skipped:[{title, reason}]}` (corrected at landing, P5-FIN-R3: each skipped row carries the server's reason). Task 5 shows "Added", "Already had", "Skipped" with the reason. | Agree. |
| A9 | 4 ↔ 5 | Task 4 adds `notebook_starter_pack` to `_PREFERENCE_KEYS` and to `shaped`. Task 5's `writeStarterPackState` is the client writer. | Agree. The writer must call `setPrefMerged` with a literal or a `const` key in its own file, or the `_CALL`/`_LOCAL_CONST` scan (`test_preference_key_validation.py:69-71`) cannot resolve it. |
| A10 | 4 ↔ 6 | Install writes styles server-side (no `createJournalStyle`), so no `style_created` fires for the three new styles. | Consistent with R-P5-8 ("editor, duplicate, from_note"). Worth an owner note: pack installs are uncounted, apart from the `j2_template_gallery_uses` row adopt records. |
| A11 | 5, 6, 7 | All three edit `styles/StylesManager.jsx`: Task 5 adds the offer and link, Task 6 adds `via` on duplicate (`:224`), Task 7 adds `styles-manager`, `styles-kinds`, `styles-new`. | Agree in content. Run them in task order; each task re-reads the file. |
| A12 | 5, 7 | Task 5 edits `KindSection.jsx`. Task 7 puts no anchor in it. | Agree. |
| A13 | 6 ↔ 10 | Task 6 fires `style_applied` from `createNoteViaApi`. Task 10's walk step 7 reads `style_applied >= 1` after creating from "Swing trade plan". | Agree (a style create carries `styleId`). |
| A14 | 6, 7 ↔ 10 | Task 10's bytes ceiling is V12 + 1,500 = 2,240,064 B. Tasks 2, 6 and 7 spend it. | Fits (headroom 22,229 B). R-P5-10's itemisation misses Task 6's eager call-site code: **C16**. |
| A15 | 7 ↔ 3/4 | The Community library tour ends on an Adopt button, which a firm row also shows (library on). | Agree. The Adopt button is not in `TemplateGallery.jsx`: **C11(c)**. |
| A16 | 2 ↔ 11 | Task 11's arming packet checks Task 2's payload key `notebook_starter_packs_enabled`. | Agree. |

### B. Is each task consistent with itself?

| Task | Tests vs. code, files created vs. touched | Found |
|---|---|---|
| 2 | "Same file set and steps as P3a Task 2" plus three corrections. | **C14.** It omits `tools/notebook_fin_walk.py` `WAVE_FLAGS` (P3a V1 note 3; P4a added a row there). Its expected results must be "no new reds against the base", because 2 reds in `test_notebook_flag_parse.py` and 1 in `test_notebook_switch_rehearsal.py` exist before it starts. |
| 3 | Case 6 ("either switch on, they show") vs. the visibility code; case 7 (count rail green) vs. the 15 new `kind='firm'` rows; the seed shape vs. a NOT NULL column. | **C3, C4, C5, C6.** Its file list has `tests/test_firm_style_seed.py` (new) and `template_gallery.py`, and must add `tests/test_notebook_template_gallery.py` as modified (C4). The block settings in its table all validate against `journal_styles._clean_blocks` (`S/journal_styles.py:276-306`) and `BLOCK_KINDS` (`:53-80`): every `tf`, `grade`, `fields`, `which`, `on`, `includeRules`, `requireAll` value is a declared option. |
| 4 | Test 8 (library switch has no effect) vs. `adopt_style`'s library gate; "one transaction" vs. `adopt_style`'s own commit; test 4 (corrupt kindId → skipped) vs. code; Review Focus 3 "kind or block". | **C1, C2, C13.** Test 4 agrees with the code (`GalleryError(ADOPT_UNSUPPORTED_SENTENCE)`). The "block" half of RF3 does not: `_safe_listed` drops an unknown block silently (`:1172-1173`), so that row installs. The file list misses the contract sweeps for the new route: **C15**. |
| 5 | "The Styles manager's empty state" and "the Styles manager footer" vs. `StylesManager.jsx`. | **C12.** Neither exists. Step 4 should also run `KindSection.test.jsx` and `StylesManager.test.jsx` (both exist) beside `tapFloor`, `reachable`, `keyListenerCensus` and the client-writer rail, and compare `keyListenerCensus` against its 2 base reds. |
| 6 | "Exact name list now has 18 names"; "`oneOf` over the 12 `BLOCK_KINDS` ids"; "`StyleHost.finish` fires per `plan.switching`". | **C7** (it will be 20), **C8** (13 ids; 10 are `block: true`), **C9** (finish returns early on a dirty editor). Its `client_errors.py` "(if its list is separate)": it is not, so no edit is needed. Its call-site tests ("a `/chart` insert of a non-block widget fires nothing") agree with the `block === true` gate. |
| 7 | Steps (R-P5-7) vs. where the anchors are; ROUTE_OF_FILE entries vs. the files the steps name; "`library-adopt` in TemplateGallery.jsx". | **C10, C11.** The count edits (21→23, 20→22) agree with today's rails (V3). `ROUTE_OF_FILE` keys are `journal-2-0`-relative paths: `'components/notebook/styles/StylesManager.jsx'`, `'components/notebook/TemplateGallery.jsx'`, and `'components/notebook/StyleLibraryCard.jsx'` if C11(c) is taken. All three are `() => false`. |
| 8 | Two entries vs. `capabilityList.test.js`. | Agree. Lengths 99 and 100, both ≤ 120. Unique ids. Both flags fall back false. No `—` and no `!`. |
| 9 | Two docs, no code. | Agree. |
| 10 | Walk at 1280/820/390; bytes ≤ V12 + 1,500. | Agree. The ceiling is 2,240,064 B. Walk step 5 (Journal styles tour) only works with C10 taken; step 6 needs C11(a)/(b). |
| 11 | Same as P3a Task 12. | Agree. |

### C. Conflicts between the plan and the current code (17), each with a proposed ruling

| # | Plan text | Current code | Proposed ruling |
|---|---|---|---|
| C1 | R-P5-2 and Task 4: install "reuses P3a's `adopt_style`", and "does NOT need the library switch"; test 8. | `adopt_style` returns None while `library_enabled()` is false (`S/template_gallery.py:1200-1201`). | Extract the body of `adopt_style` after its two gates into a private `_adopt_listed_row(conn, user_id, row, *, notify, commit)`. `adopt_style` keeps its library and styles gates and calls it with `commit=True`. `starter_packs.install` checks its own two switches and calls it with `commit=False`. One body, so every rule an adopt obeys still holds. Test 8 then holds. |
| C2 | R-P5-2: "calls `adopt_style` (P3a) per firm row inside one transaction". | `adopt_style` commits (`:1247`) and rolls back the caller's connection on any error (`:1251-1254`). | The same helper with `commit=False`. Install wraps each row in a `SAVEPOINT` so a `GalleryError` row is released into `skipped` without rolling back earlier rows, then commits once. Mutation-prove by dropping the savepoint: test 4 must then lose the two good rows. |
| C3 | R-P5-1 and Task 3 "Visibility": firm style rows hidden unless `starter_packs.enabled() or library_enabled()`; Task 3 case 6. | Visibility is the library switch alone (`:656-659`, `:691-694`). With the library off, the client renders a style row as an outline card whose Use copies it into templates (`TemplateGallery.jsx:392`, `use_template` `:1078-1100`). | **Leave `list_gallery` and `_library_hides` unchanged.** Install reads the rows directly and does not need them listed. R-P5-1's starter switch gates the offer and the endpoint only. Task 3 case 6 becomes: library off ⇒ no firm style row listed and `get_item` not found, whatever the starter switch; library on ⇒ listed (as UCT picks, `featured=1`). **Superseded in part by P5-AUD-1 (Task 5b):** the library, journal styles and gallery are armed in production, so a firm style row now lists only while BOTH the library switch and `NOTEBOOK_STARTER_PACKS_ENABLED` are on, in every read path, by one rule (`template_gallery._hidden_styles`); `=0` hides them again. |
| C4 | Task 3: "does NOT add these rows to `load_seed()`, so the outline count rail stays at 4-6". | `tests/test_notebook_template_gallery.py:496-498` and `:685-688` compare **all** `kind = 'firm'` rows to `len(load_seed())`, so 15 new rows red both. | Task 3 edits those two queries to `... WHERE kind = 'firm' AND item_type = 'outline'` and adds the file to its list. Its own new test asserts the 15 style rows. `test_j2_db_import_closure.py:69` (`> 0`) needs nothing. |
| C5 | Task 3's seed shape and table name no category. | `category TEXT NOT NULL` (`:157`), one of `CATEGORIES` (`:73`). Every outline seed carries one (`test_notebook_template_gallery.py:506`). | Add a `"category"` to each seed row from its kind: `trade_plan` → `trade_plan`; `daily_prep`, `weekend_prep`, `earnings`, `watchlist_note` → `research`; `post_trade_review`, `weekly_review`, `earnings_followup` → `review`. The owner can swap any. Task 3 test 2 asserts `category in CATEGORIES`. |
| C6 | Task 3 calls `starter_packs.enabled()`; Task 4 creates `S/starter_packs.py`. | The module does not exist at Task 3. | Moot under C3. If C3 is declined, Task 3 reads `notebook_flags.flag_on("NOTEBOOK_STARTER_PACKS_ENABLED", False)` until Task 4. |
| C7 | Task 6: "The exact name list now has 18 names". | 17 names today (`notebookTelemetry.js:39-57`; pin `notebookTelemetry.test.js:23-27`). | 20 names. Edit the pinned list by adding the three, sorted. |
| C8 | R-P5-8 and Task 6: `kind` is "a `oneOf` over the 12 `BLOCK_KINDS` ids". | 13 ids (`journalBlocks.js:8`, node read: `chart,...,tradeReview,moodCheckIn,marketcontext,reminder`). Tier 3 added `moodCheckIn` (`S/journal_styles.py:73`). Only 10 are `block: true` in `widgets/registry.js` (`:877-915`). | `oneOf` the 13 `BLOCK_KINDS` ids in `BLOCK_KINDS` order, on **one line** (the server parser is single-line, `test_notebook_telemetry_events.py:65`). Pin it against both `BLOCK_KINDS` lists. Add one assertion that every `block: true` registry id is in it, so a new block cannot be sent as `other`. `chart`, `marketcontext` and `reminder` stay in the enum but cannot fire from the `block === true` gate; record that. |
| C9 | Task 6: `StyleHost.finish` fires `'switch'` or `'update'` per `plan.switching`. | `finish` returns at `:75` on a dirty editor, before the notice (`:83-85`). | Fire once at the top of `finish`, before the dirty branch. The write has landed in both branches. Task 6 adds a dirty-editor case. |
| C10 | R-P5-7: Journal styles tour start `/journal/notebook`. | That URL is Research Home (`NotebookTab.jsx:701`, `:2329`). The Styles button is only in the list branch (`:2357-2362`, `:2509-2514`). `tourReachability`'s `onNotebook` cannot catch it (`:32`, `:47`). | Start `'/journal/notebook?view=all'` (the `b1Core.js:60-61` precedent). `b4Styles.test.jsx` asserts the start string so a revert reds. Phone: no extra anchor (V8). |
| C11 | R-P5-7: the Community library tour, `templates` (waitFor door) → door → `library-types` → `library-adopt` "in TemplateGallery.jsx". | (a) The door renders only while `templateGalleryEnabled()` (`TemplatePicker.jsx:157`, `:333`). (b) The gallery opens only on a click of the door, so step 3 is behind a second click; without a `waitFor` it is waited for, then skipped. (c) Adopt is in `StyleLibraryCard.jsx:118-121`, not `TemplateGallery.jsx`. | (a) The entry carries `requires: ['notebook_template_gallery_enabled']`. (b) Step 2 gets `waitFor: 'library-types'` (two-waitFor precedent: `b1ImageDocx.steps.js:16,18`). (c) `library-adopt` goes in `StyleLibraryCard.jsx`, with a `ROUTE_OF_FILE` entry. *Alternative:* start the tour from P3a's own door, the Styles manager's "Community" button (`StylesManager.jsx:368`, `LibraryDoor.jsx:19-20`), which needs no template-gallery switch but one more `waitFor`. |
| C12 | Task 5 and R-P5-5: the offer "in the Styles manager's empty state"; a `Starter packs` link "in the Styles manager footer". | The manager always lists the nine built-in kinds with built-in styles (`StylesManager.jsx:394-401`); it has no empty state and no footer. | Show the offer at the top of the list column (above "New style", `:361-365`) while R-P5-5 holds. Put the quiet `Starter packs` link in the row beside "New style" and "Community" (`:362-373`). |
| C13 | Review Focus 3 and Task 4: "a firm style row whose kind **or block** a future release removes ... install skips that row". | A removed kind raises (`:1215-1218`) and is skipped. A removed block is dropped silently by `_safe_listed` (`:1172-1173`), and the row installs without it. A member at the 200-style cap gets a `GalleryError` too, read as `skipped`. | Keep the code. RF3 and test 4 name the kind only; a dropped block is the adopt rule, recorded. Give the style-cap refusal its own sentence in the response (not "skipped"), or document it. |
| C14 | Task 2: three corrections from the P3a ledger. | `tools/notebook_fin_walk.py` `WAVE_FLAGS` gained a row in P3a and in P4a (P4a diffstat `tools/notebook_fin_walk.py | 2 +`). The base reds above exist before Task 2. | Add `tools/notebook_fin_walk.py` (`WAVE_FLAGS`) to Task 2's file list. Its expected results read "no new reds against the five base rows". |
| C15 | Task 4: one new route; the file list names the router and `auth.py`. | Every route is in `__fixtures__/contract/sweep.signed-out.json` and `sweep.flags-off.json`, railed by `tests/test_notebook_contract_fixtures.py` (P3a V12). `/journal-styles/{style_id}/restore` and `/default` share the path depth (`notebook_journal_styles.py:11-12`). | Add the sweep regeneration (`tools/notebook_contract_fixtures.py`) and that test to Task 4. Declare the new route before the `{style_id}` routes. |
| C16 | R-P5-10 lists what grows the closure: tour entries, `data-tour`, event names and schemas, one `FLAG_FALLBACKS` row. | `noteCreation.js` and `widgetEmbedNode.jsx` are in the closure (V12), so Task 6's two call sites and their imports are first-open bytes too. | Add them to R-P5-10's list. The +1,500 B ceiling stands, and the measured headroom covers it many times over. |
| C17 | R-P5-10: "With PR #373 merged, headroom is about 25 KB." | 22,229 B (V12). | Record 22,229 B as the base. It is not a stop (> 2,000 B). |

**Not a conflict, recorded so nobody looks again:**
- `CAPABILITY_PREVIEW`, `LEARN_GROUPS` and the tour counts (21/20) are as the plan says.
- `GROUP_OF` and `capabilityList.js` are lazy.
- The admin telemetry list is derived.
- `_PREFERENCE_KEYS` takes a named-validator row on the P4a precedent.
- One documentation item: Task 4's new rate-limit scope (10/hour in-process, 5/day durable) belongs in `CLAUDE.md`'s single-process list beside P3a's three gallery scopes, as P3a did.
