# P3a verify-before-building (Task 1)

Run 2026-10-17 in `C:\Users\Patrick\uct-worktrees\notebook-p3a`, branch `notebook-p3a-library`.
Base (V1): `f2e816e04229b6b3cf750cd097cbd99d18faf0fe`, `origin/master`, "Merge pull request #368 ... fix/focus-small-loose-ends".
The plan's tree `b7aff58874` is an ancestor of the base, 8 commits behind it. **None of the 12 files this task cites changed in those 8 commits** (`evidence/p3a-verify-20261017/v-files-changed-since-b7aff58874.txt`, every count 0). So every line number below is the plan's own, and every "differs" is a plan error, not drift.

Raw evidence is in `docs/notebook/evidence/p3a-verify-20261017/` and was written before this summary (R-RAW).

Verdict key: **confirmed** (quote + file:line), **confirmed (now at :N)** (pure line drift), **DIFFERS** (shape differs; names the plan text that changes).

## Base reds, recorded as "pre-existing at f2e816e042"

Step 2, with the plan's commands verbatim.

Vitest (`base-vitest.log`): 5 files ran, 4 passed, 1 failed. `Test Files 1 failed | 4 passed (5)`, `Tests 2 failed | 79 passed (81)`.
- **The named file `src/components/admin/TemplateGalleryReviewPanel.test.jsx` does not exist.** The panel is `app/src/components/admin/TemplateGalleryReviewPanel.jsx`; it is covered by `app/src/pages/journal-2-0/a11y/templateGallery.a11y.test.jsx` (5 tests, passed: `base-vitest-admin-panel-a11y.log`) and by `TemplateGallery.test.jsx` "lets an admin approve, reject with a reason, hide a reported one and unhide". Later tasks should use `templateGallery.a11y.test.jsx` where they meant a review-panel test.
- RED `src/pages/command/keyListenerCensus.test.js` (2 of 7):
  - `no file holds MORE raw key listeners than its baseline`: `AssertionError: RAW KEY LISTENER ADDED OUTSIDE THE REGISTRY.` Offenders: `app/src/pages/admin/GoldReview.jsx: literal 1 > baseline 0` and `app/src/pages/traderArchive/ArchiveThumbs.jsx: literal 1 > baseline 0`.
  - `the baseline sits at or under the stated CEILING, and the CEILING is tight`: `expected 113 to be 111`.
  - Neither file is Notebook. **Global Constraints name this rail as one that "must stay green"; it is red on the base, so Tasks 9-11 must compare against these two rows, not against green.**
- Green: `NoteEditorPage.styleChunks.test.js` (4), `TemplateGallery.test.jsx` (12), `doorEnumeration.test.js` (41), `reachable.test.js` (17).

Pytest, the plan's eight files (`base-pytest.log`): all eight files exist. `2 failed, 453 passed`.
- RED `tests/test_notebook_flag_parse.py::test_NO_notebook_flag_is_read_outside_the_one_parse`: `tools/notebook_daily_prep_probe.py:282  NOTEBOOK_SETUPS_BOARD_ENABLED` and `:283  NOTEBOOK_CHART_PLAN_ENABLED`.
- RED `tests/test_notebook_flag_parse.py::test_every_flag_on_call_names_a_payload_flag`: three strays in `tools/runtime_pane_smoke.py:234,236` naming `VITE_PINE_RUNTIME_PANE_ENABLED`.
- Both are `tools/` files that are not Notebook's. **Task 2 Step 4 says "Expected: all PASS" for this file. It cannot: two tests are red before Task 2 starts.**

Pytest, the other rails later tasks run (`base-pytest-extra-rails.log`): `tests/test_feature_flag_ledger.py`, `tests/test_visibility_flag_ledger.py`, `tests/test_notebook_switch_rehearsal.py`, `tests/test_account_deletion_manifest.py`: `1 failed, 467 passed`.
- RED `tests/test_notebook_switch_rehearsal.py::test_every_notebook_gate_is_rehearsed_or_carries_a_reason`: `assert not ['NOTEBOOK_TERMINAL_LINKS_ENABLED']` (no rehearsal reason written). See V1.

## V1. Base SHA and the Part B flag rows — confirmed, with one DIFFERS (Task 2)

Base SHA: above. `git log -S NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED --oneline` (`v1-git-log-S.txt`) puts the switch in `9281a84a07 feat(notebook): NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED switch (dark)`.

That commit's `git show --stat` touched ten files:
`api/routers/auth.py`, `api/services/journal_two/earnings_followup.py` (the service's `enabled()`), `app/.../lib/earningsFollowupFlag.js`, `app/.../lib/earningsFollowupFlag.test.js`, `app/.../lib/offline/notebookFlags.js`, `docs/feature_flags.json`, `tests/test_notebook_flag_parse.py`, `tests/test_notebook_flags.py`, `tools/notebook_contract_fixtures.py`, `tools/notebook_fin_walk.py`.

Quoted rows:
- `api/routers/auth.py:267` `    "NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED": False,  # enablement (Tier 2 part B: earnings follow-up notice + card)` (the `NOTEBOOK_FLAGS` table).
- `app/src/pages/journal-2-0/lib/offline/notebookFlags.js:79` `  notebook_earnings_followup_enabled: false, // Tier 2 part B: the earnings follow-up card and job — absent ⇒ OFF`.
- `tests/test_notebook_flags.py` `NOTEBOOK_KEYS`: `"notebook_earnings_followup_enabled",`.
- `tests/test_notebook_flag_parse.py` `_server_gates()`: `"NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED": earnings_followup.enabled,`. A gate with no module function yet may use a lambda: `"NOTEBOOK_PUBLISH_ENABLED": lambda: notebook_flags.flag_on("NOTEBOOK_PUBLISH_ENABLED", False),`.
- `tools/notebook_contract_fixtures.py:85` `    "NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED",` (`FLAGS`, opens at `:71`).

**DIFFERS (Task 2).** Four corrections to Task 2's text, in order of cost:
1. **The reset helper is `__resetNotebookFlags`, not `__resetNotebookFlagsForTests`** (`notebookFlags.js:192` `export function __resetNotebookFlags() {`). The Task 2 test imports a name that does not exist. Task 2 itself says to use the real name; this is it. `latchNotebookFlags(payload)` (`:130`) and `notebookFlag(key)` (`:162`) are as the test assumes, and a non-boolean `'yes'` leaves nothing latched (`flagPresent` requires a boolean), so the helper reads `false`.
2. **`tools/notebook_switch_rehearsal.py` is missing from Task 2's file list.** `tests/test_notebook_switch_rehearsal.py::test_every_notebook_gate_is_rehearsed_or_carries_a_reason` builds its name set from `capability_table()` (every `NOTEBOOK_FLAGS` key) and fails on any name with no probe and no reason (`not_rehearsed` returns `"no rendered probe written"`). Adding the flag to `NOTEBOOK_FLAGS` in Task 2 adds a second member to the failing set. Part B hit this and fixed it afterwards in `0404ac3a9b tools(notebook): the switch-rehearsal census names a reason for the follow-up gate ...` (`tools/notebook_switch_rehearsal.py`, +12 lines, a `NOT_REHEARSED` row). Task 2 should add a `NOT_REHEARSED["NOTEBOOK_STYLE_LIBRARY_ENABLED"]` reason and run `tests/test_notebook_switch_rehearsal.py`.
3. **`tools/notebook_fin_walk.py` `WAVE_FLAGS`** (`:79`) got the follow-up flag in Part B (`:92` `    "NOTEBOOK_EARNINGS_FOLLOWUP_ENABLED",`). It is the walk's own list; add the library flag there too, or Task 11's walk cannot arm it.
4. **Task 2 Step 4's "Expected: all PASS" is false** for `tests/test_notebook_flag_parse.py` (two base reds above) and for the rehearsal rail. Compare against the base reds.

Also: the `_server_gates()` row for this flag cannot name `template_gallery.library_enabled` until Task 3 defines it. Use the lambda form until then (or add the row in Task 3).

## V2. `ensure_gallery_schema` — confirmed

`api/services/journal_two/template_gallery.py:183-203`. It is a **single `if`**, not a loop, so Task 3's "replace the single `preview_json` ALTER with a loop" matches the base:
```
192:    columns = {r[1] for r in conn.execute("PRAGMA table_info(j2_template_gallery)")}
193:    if "preview_json" not in columns:
194:        conn.execute("ALTER TABLE j2_template_gallery ADD COLUMN preview_json TEXT")
195:    conn.commit()
```
The seed runs after (`:196-199`), then `fill_missing_previews`. `ensure_gallery_schema` is called from `db.py:2214`, **before** the `_PHASE_2_ALTERS` loop (`db.py:2218`); it must not rely on that loop.
Table shape worth knowing for Task 3/4: `body_json TEXT NOT NULL` (`:132`), `category TEXT NOT NULL` (`:131`), and `CATEGORIES = ("trade_plan", "journal", "research", "review")` (`:71`). A style row must still carry a body string and one of those four categories; `_clean_category` (`:319-322`) raises `"Pick a category: trade plan, journal, research or review."` for anything else.

## V3. `_SELECT_LIST` and its assert — confirmed

```
417:_SELECT = (
418:    "SELECT g.*, u.display_name AS author_display,"
425:_SELECT_LIST = _SELECT.replace(
426:    "SELECT g.*,",
427:    "SELECT g.id, g.user_id, g.kind, g.title, g.description, g.category, g.property_defs_json,"
428:    " g.status, g.review_note, g.hidden, g.featured, g.listed_at, g.created_at, g.updated_at,"
429:    " g.preview_json,")
430:assert "g.*" not in _SELECT_LIST and "body_json" not in _SELECT_LIST
431:_VISIBLE = "g.status = 'approved' AND g.hidden = 0"
```
`"payload_json"` does not contain the substring `body_json`, so the existing assert would not catch it; Task 3's extended assert is needed.

## V4. `publish`'s update branch — confirmed

`template_gallery.py:552-560` (the plan's `:548-570` brackets it):
```
552:        if existing:
553:            gid = existing["id"]
554:            conn.execute(
555:                "UPDATE j2_template_gallery SET title = ?, description = ?, category = ?,"
556:                " body_json = ?, property_defs_json = ?, status = 'pending', review_note = NULL,"
557:                " reviewed_by = NULL, reviewed_at = NULL, featured = 0, listed_at = NULL,"
558:                " updated_at = ?, preview_json = ? WHERE id = ?",
```
Lookup is by `(user_id, source_template_id)` (`:548-551`). Outline items keep this reset (R-P3-6).

## V5. `admin_act`'s approve branch — confirmed

`template_gallery.py:735` `def admin_act(admin_id: str, gallery_id: str, action: Any, *, note: Any = "",` / `:736 reviewed_updated_at: Any = None,`. The approve branch:
```
760:        if action == "approve":
761:            if not isinstance(reviewed_updated_at, str) or not reviewed_updated_at:
762:                raise GalleryConflict(APPROVE_STALE_SENTENCE)
763:            cur = conn.execute(
764:                "UPDATE j2_template_gallery SET status = 'approved', review_note = NULL, reviewed_by = ?,"
765:                " reviewed_at = ?, listed_at = COALESCE(listed_at, ?), updated_at = ?"
766:                " WHERE id = ? AND updated_at = ?",
767:                (admin_id, now, now, now, gallery_id, reviewed_updated_at))
768:            if cur.rowcount != 1:
769:                conn.rollback()
770:                raise GalleryConflict(APPROVE_STALE_SENTENCE)
```
The guard is the `WHERE ... AND updated_at = ?`. Note: a held revision (R-P3-3) must move `updated_at` when `pending_json` is written, or the reviewer's `updatedAt` cannot name the revision. Task 4's text should say so (it is implied by `pending_at`, not by the guard).

## V6. `journal_styles` — confirmed, with two notes that change Task 5

- `journal_styles.py:43` `MAX_STYLES_PER_MEMBER = 200` (message `:427` `f"You can keep up to {MAX_STYLES_PER_MEMBER} styles. Delete one first."`); `:48` `BUILTIN_PREFIX = "builtin:"`.
- `BUILTIN_STYLES` (`:137`) keys: `trade_plan, daily_prep, weekend_prep, earnings, earnings_followup, post_trade_review, weekly_review, thesis, watchlist_note` — the same nine ids as `note_kinds.BUILTIN_NOTE_KINDS` (checked by running both).
- `_clean_kind` (`:235-238`): `if _nk().get_kind(user_id, raw, conn) is None: raise StyleValidationError("Choose a kind of note for this style.")`. **It accepts the member's own kinds too**, so R-P3-9's "built-in only" is a check Task 4 must add itself (V7).
- `_clean_properties` (`:316-345`): rejects `builtin:note_kind` (`:330-331` `if pid == _nk().NOTE_KIND_PROPERTY: raise ...`) and any builtin id not in `BUILTIN_USER_SET_IDS`; **drops** a stale member property silently (`:335-336`). **`BUILTIN_USER_SET_IDS` includes `builtin:note_kind`** (V8), so Task 4's "only built-in user-set property defaults" must also exclude `NOTE_KIND_PROPERTY` or `create_style` refuses the adopted payload.
- `_clean_blocks` (`:274-304`): an unknown block id is kept verbatim (`:294` `clean = settings   # a newer version's block: kept verbatim`), up to `MAX_BLOCKS = 30`. Task 4's "blocks verbatim" therefore passes unknown blocks through to the adopter; decide if the payload builder should drop blocks not in `BLOCK_KINDS`.
- `get_style(..., full=True)` shape (`_row`, `:213-223`; builtin `:201-210`): keys `id, name, kindId, builtin, isDefault, version, outlineTemplateId, hasOutline, blocks, properties, sourceGalleryId, sourceVersion, createdAt, updatedAt, deletedAt` and, when full, `outlineBodyJson` (**None when the style points at `outlineTemplateId`**, so Task 4's "outline inlined from the style or its template" is real work).
- `update_style` (`:446-502`): **a content change bumps `version`** — `:491-492` `if content_changed: sets.append("version = version + 1")`; a name-only change does not (`name` is not in `_CONTENT_KEYS`, `:442`). It touches no `source_*` column.
- **`create_style` writes `source_gallery_id` and `source_version` as NULL and takes neither from the payload** (`:429-432` `... is_default, source_gallery_id, source_version, version, ... VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 1, ?, ?)`). Task 5's text already does the follow-up `UPDATE j2_journal_styles SET source_gallery_id = ?, source_version = ?` (plan `:1107`), so this is confirmed, not a differs. The columns exist at `db.py:2047-2048` inside the `CREATE TABLE IF NOT EXISTS j2_journal_styles`.
- **DIFFERS (Task 5).** The plan adds a `source_block_ids` column to `j2_journal_styles` and says "add the ALTER beside `db.py:2047-2048` in the same shape". `db.py:2047-2048` are columns inside a `CREATE TABLE IF NOT EXISTS`; editing that statement does **nothing on a database where the table exists** (production, armed 2026-10-14). The working shape is a separate list entry after the CREATE, in `_PHASE_2_ALTERS` (`db.py:1621`, closes `:2097`), like `db.py:2061` `"ALTER TABLE j2_notes ADD COLUMN style_id TEXT",`; the loop at `db.py:2218-2225` ignores "duplicate column". So: `"ALTER TABLE j2_journal_styles ADD COLUMN source_block_ids TEXT"` placed after `db.py:2057`. How P1 added the two source columns: in the original CREATE (`d4eb6d37db feat(notebook): journal styles store ...`), never by ALTER.

## V7. `note_kinds.get_kind` — confirmed

`note_kinds.py:122-135`: `if kind_id in _BUILTIN_BY_ID:` returns the built-in dict (`"builtin": True`); otherwise it queries `j2_note_kinds WHERE id = ? AND user_id = ?` (`"builtin": False`). Built-ins are told by id: `note_kinds.py:53` `BUILTIN_KIND_IDS = frozenset(k["id"] for k in BUILTIN_NOTE_KINDS)` and `:54` `_BUILTIN_BY_ID = {k["id"]: k for k in BUILTIN_NOTE_KINDS}`. Nine ids (`:43-51`): `trade_plan, daily_prep, weekend_prep, earnings, earnings_followup, post_trade_review, weekly_review, thesis, watchlist_note`. Use `kind_id in note_kinds.BUILTIN_KIND_IDS` (not a DB read) for R-P3-9.

## V8. `note_properties` — confirmed (now at :127 / :132)

- `note_properties.py:127` `BUILTIN_USER_SET_IDS = frozenset(d["id"] for d in BUILTIN_PROPERTY_DEFS if d["source"] == "user_set")` (plan range `:73-126` ends one line early).
- The user-set ids: `builtin:thesis_status`, `builtin:confidence`, `builtin:research_type`, `builtin:review_date`, and **`builtin:note_kind`** (`:112-115`, `"source": "user_set"`). `builtin:regime_at_write` is `captured` (`:118-124`) and is not in the set.
- `note_properties.py:132` `def is_builtin_property_id(property_id: str) -> bool:` / `:133` `return isinstance(property_id, str) and property_id.startswith("builtin:")`.

## V9. `journal_styles.preview` — confirmed

`journal_styles.py:919-955`. With `{"style": {...}}` it builds a transient style (`:937-942`):
```
937:            style = {"id": None, "builtin": False, "version": None, "name": _clean_name(draft.get("name") or "Draft"),
938:                     "kindId": _clean_kind(user_id, draft.get("kindId"), conn),
939:                     "outlineTemplateId": _clean_template(user_id, draft.get("outlineTemplateId"), conn),
940:                     "outlineBodyJson": _clean_outline(draft.get("outlineBodyJson")),
941:                     "blocks": _clean_blocks(draft.get("blocks")),
942:                     "properties": _clean_properties(user_id, draft.get("properties"), conn)}
```
then `compose(..., mode="create")` and returns `{"bodyJson", "properties", "skipped", "ticker", "tickerSource", "mode"}`. It writes nothing (the docstring says so and no INSERT/UPDATE is on the path); it reads the viewer's own latest note's ticker (`latest_ticker`). Route: `api/routers/notebook_journal_styles.py:147` `@router.post("/journal-styles/preview")` -> `preview_endpoint`. Client: `app/src/pages/journal-2-0/lib/journalStyles.js:85` `export const previewJournalStyle = (body) => call(`${STYLES_URL}/preview`, { method: 'POST', body })`. **Note for Task 9:** that route is gated by `NOTEBOOK_JOURNAL_STYLES_ENABLED`, not the library switch, so a library-on / styles-off viewer cannot preview a style item through it.

## V10. `add_alert` and the notice line — signature confirmed; **DIFFERS (Task 7)** on the line

Signature, `api/services/alerts.py:382-390`:
```
def add_alert(
    alert_type: str,
    title: str,
    message: str,
    severity: str | None = None,
    data: dict | None = None,
    user_id: str | None = None,
    channels: dict | None = None,
) -> dict:
```
One extra trailing optional (`channels`), so the plan's call is valid. A private alert (`user_id` set) never fires Discord (`alerts.py` `fires_discord` branch: `if user_id is not None: ... channels[CHANNEL_DISCORD] = CHANNEL_SKIPPED`) and is durably copied (`alert_durability.should_persist`: private and not `document_arrival`).

**DIFFERS (Task 7).** `app/src/pages/journal-2-0/lib/notices.js` (which `NoticesBox.jsx:18` imports) recognises exactly three alert types by `a.type ===` — `REMINDER = 'notebook_task_reminder'`, `FILL = 'notebook_entry_context_new_fill'`, `FOLLOWUP = 'notebook_earnings_followup'` (`:13-15`, branches `:26-37`) — and silently skips any other. A `notebook_style_library` alert (Task 7's `LIBRARY_NOTICE_SOURCE`) reaches the bell but **never appears in the Notices box** until Task 7 adds a fourth branch to `notices.js` and a case in `notices.test.js`. It also keeps links narrow on purpose (`:34-37` follows only an href that `startsWith(FOLLOWUP_LINK)`); the new branch should do the same for `/journal/notebook?styles=1&libraryUpdate=`. Task 7's file list does not name `notices.js`, `notices.test.js` or a `__fixtures__/notices.*.json` capture. Bytes: `notices.js` is **not** in the first-open closure (its constants `notebook_entry_context_new_fill` and `/journal/notebook?followup=` are in no first-open chunk), so the change is free under R-P3-5.
Also: `?styles=1` is consumed by `NotebookTab.jsx:432-437`, which deletes only `styles` (`p.delete('styles')`), so a `libraryUpdate` param survives for the lazy `StylesManager` to read; no eager-file edit is needed for that link.

## V11. `account_purge` — confirmed

- `api/services/journal_two/account_purge.py:161-163`: `    "j2_template_gallery",` / `    "j2_template_gallery_reports",` / `    "j2_template_gallery_uses",` inside `_DIRECT_USER_TABLES = (` (`:32`).
- The indirect-join block is `:326-343` (the plan's `:330-345`): `about_their_templates = {` ... `"DELETE FROM j2_template_gallery_reports WHERE gallery_id IN (SELECT id FROM j2_template_gallery WHERE user_id = ?)"` and the same for `_uses`, run **before** the direct loop at `:346` `for table in _DIRECT_USER_TABLES:`.
- Manifest: generated, never hand-edited. `docs/account-deletion-manifest.md:22-23` `python tools/account_deletion_manifest.py --write` / `--check`. Rail: `tests/test_account_deletion_manifest.py` (passes on the base). Task 7 should run it, not only `test_journal_two_account_purge.py`.

## V12. Contract fixtures and sweeps — confirmed

- `tools/notebook_contract_fixtures.py:1310` `def template_gallery(w: World) -> None:`; routes it records are under `base = "/api/j2/template-gallery"` (`:1314`).
- The sweeps are `sweep.signed-out.json` (every route must answer 401) and `sweep.flags-off.json` (every route 404 with every `FLAGS` entry at "0", before the session is read) (`:1933-1962`); both list the gallery's nine routes (`DELETE/GET/PATCH/POST /api/j2/template-gallery...`). **Every new route Tasks 3-6 add appears in both files and must answer 401 signed-out and 404 flags-off**, so `NOTEBOOK_STYLE_LIBRARY_ENABLED` must be in `FLAGS` (`:71-86`) or the flags-off sweep answers differently.
- `shared_constants` (`:1963-1976`) writes `constants.template-gallery` from `template_gallery.CATEGORIES / REPORT_REASONS`; `GalleryPublishForm.test.jsx:75` reads it with `contractBody('constants.template-gallery')`. Task 3's `TRADING_STYLES`/`SORTS` pairing is parse-based (plan `:460`), which is fine; adding the new tuples to that builder is optional.

## V13. `TemplateGallery.jsx` and its mount — confirmed (different line ranges)

The plan's `:89-160` is `GalleryCard`; the view chips are at `:327-335`.
- `TemplateGallery.jsx:89` `function GalleryCard({ item, isAdmin, busy, onPreview, onUse, onChanged, onMessage }) {`.
- `:242` `export default function TemplateGallery({ onBack, onUseNow, busy = false }) {`; state `:245-251` (`view`, `query`, `category`, `sort`, `preview`, `message`, `using`).
- View chips `:327-335`: `{[['browse', 'Browse'], ['mine', 'Your submissions'], ...(isAdmin ? [['review', 'Review queue']] : [])]` rendered as `aria-pressed` chips. Browse: category chips from `GALLERY_CATEGORIES` (`:368-376`) and a `GALLERY_SORTS` select (`:377-382`), lists via `useTemplateGallery({ ...filters, section: 'picks' })` and `useTemplateGallery(filters)` (`:255-257`); `filters = { q: query, category, sort }`. Server `SORTS = ("newest", "most_used")` (`template_gallery.py:72`).
- `openPreview` `:282-291`: `getGalleryTemplate(item.id)` then `setPreview({ ...base, body: full.bodyJson, onUse: () => use(item) })`; `use` copies via `copyGalleryTemplate` (`:262-280`). A style item has no `bodyJson`, so Task 9 changes this path.
- Mount: `TemplatePicker.jsx:86` `const TemplateGallery = lazyChunk(() => import('./TemplateGallery'))`; `:242-254` renders `<TemplateGallery onBack={() => { setCommunity(false); setBackToDoor(true) }} onUseNow={onPickMember} busy={busy} />` inside `<Suspense>` when `galleryOn && community`; the door is `:333-345` (`data-community-gallery-door`, "Browse the community gallery").
- The review panel is `<TemplateGalleryReviewPanel onMessage={setMessage} />` (`:409`), for `view === 'review' && isAdmin`.

## V14. `KindSection` and `StylesManager` — **DIFFERS (Tasks 9, 10, plan text for R-P3-7)**

- `KindSection` is in `StyleSurfaces.js`: `components/notebook/styles/StyleSurfaces.js` exports exactly `KindSection`, `StyleHost`, `SaveStyleDoor` (`export { default as KindSection } from './KindSection'` etc.), reached through `styles/lazyStyles.js` `loadStyle(name)`. Props: `KindSection.jsx:36` `export default function KindSection({ onCreate, busy = false, autoFocusFirst = false }) {`.
- **`StylesManager` is NOT in `StyleSurfaces.js`.** It is its own dynamic import, `app/src/pages/journal-2-0/tabs/NotebookTab.jsx:146` `const StylesManager = lazyDialog(() => import('../components/notebook/styles/StylesManager'), 'journal styles')` — the second of the two `import()`s `NoteEditorPage.styleChunks.test.js` pins. Props: `StylesManager.jsx:42` `export default function StylesManager({ open, onClose, blockedNoteIds = [] }) {`. The plan's V14 line "(`styles/lazyStyles.js` -> `StyleSurfaces.js`)" is true for `KindSection` only. For Task 10's "Community" button in the manager, the gallery import must be `lazyChunk(() => import('../TemplateGallery'))` from inside `styles/StylesManager.jsx`; that is an `import()` of a non-`styles/` module, so the rail (which counts `import()`s *of `styles/` modules*) is untouched.
- **DIFFERS (Task 10): `B/styles/StyleUpdateSheet.jsx` already exists.** Task 10 lists it as `(new)` (plan File map row 10 and `:1601`). It is the P1 "Update layout" sheet, imported by `styles/StyleHost.jsx:18` (`import StyleUpdateSheet, { StyleChooser } from './StyleUpdateSheet'`), mocked in `StyleHost.settle.test.jsx:8`, and pinned by `NoteEditorPage.styleChunks.test.js:49` (`expect(host).toMatch(/from '\.\/StyleUpdateSheet'/)`). Creating a file of that name would overwrite it. Task 10's library "update my copy" sheet needs another name (for example `LibraryUpdateSheet.jsx`), and the a11y rows (`:1667`) and the controller's naming follow.
- The styles directory also already holds `StyleHost`, `SaveStyleDoor`, `SaveAsStyleForm`, `StyleEditor`, `StyleUpdateBanner`, `offerApplied.js`, `styleErrors.js`, `outlineText.js`.

## V15. Telemetry — confirmed, with one DIFFERS (Task 11)

- `notebookTelemetry.js` is in the first-open closure: `note_open_ms`, `dictation_used` and `switcher_used` all appear in `assets/index-DuCWD7PS.js`, a chunk of the 61-chunk closure (`v15-v10-closure-membership.txt`). So the two new names and their schemas cost first-open bytes, as R-P3-5 assumes.
- Client `NOTEBOOK_EVENTS` (`notebookTelemetry.js:35-52`) holds 15 names, from `NOTE_OPEN_MS: 'note_open_ms'` to `BULK_USED: 'bulk_used'`; `CORE_ACTION_EVENTS` is at `:59`; `EVENT_SCHEMAS` is at `:85` (`export const EVENT_SCHEMAS = Object.freeze({`, first entry `note_open_ms: { ms: num, source: oneOf(...), cached: bool }`).
- Server: `api/routers/journal_two.py:162` `_J2_TELEMETRY_EVENTS = {` (closes `:219`); `:239` `_NOTEBOOK_PROP_SCHEMAS: dict[str, dict[str, Any]] = {` with `"note_open_ms": {"ms": "num", "source": (...), "cached": "bool"}`. `tests/test_notebook_telemetry_events.py` PARSES the client file and pins both sides (it passes on the base).
- **DIFFERS (Task 11).** Task 11's file list names `notebookTelemetry.js`, `journal_two.py` and the a11y file only. Two more rails apply to a new event:
  - `notebookTelemetry.test.js:109` `it('every wave-10 event carries at least one core action (none is an orphan)'` (names its list) and `:94-107` (every `CORE_ACTION_EVENTS` value must be a known event): a new event needs a `CORE_ACTION_EVENTS` entry (this table is in the closure too — count it in the +400 B).
  - The F3 derivation (`docs/notebook/parity-scorecard.md`, G-170 row, via `tools/telemetry_rail_asserts.mjs`): every event must have a call-site rail whose `expect(...)` chain the event reaches. Each new event needs an asserting test at its door.

## V16. First-open closure on the base — MEASURED

`cd app && npm run build` (53 s, `v16-build.log`), then `python tools/notebook_perf_budgets.py --dist app/dist` (`v16-bytes.txt`, verbatim):
```
bytes.notebook_first_open: 2,259,916 B across 61 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)
VERDICT: PASS -- within every budget checked
```
**2,259,916 B**, as the plan expected. Headroom to the budget is 877 B. R-P3-5's ceiling for P3a is therefore **2,260,316 B** (tip + 400 B). Roots: `src/pages/journal-2-0/JournalLayout.jsx` and `src/pages/journal-2-0/surfaces/NotebookSurface.jsx`.
In the same measurement, `TemplateGallery-2ivW6sfa.js` (the `data-template-community-gallery` marker) is **outside** the closure, as R-P3-7 assumes.

## Rulings the controller must make before Task 2

| # | Item | Plan text that changes |
|---|---|---|
| 1 | V1 | Task 2: reset helper is `__resetNotebookFlags`; add `tools/notebook_switch_rehearsal.py` (NOT_REHEARSED reason) and `tools/notebook_fin_walk.py` (`WAVE_FLAGS`) to the file list; replace "Expected: all PASS" with "no new reds against the base reds" (two in `test_notebook_flag_parse.py`, one in `test_notebook_switch_rehearsal.py`); `_server_gates()` row waits for Task 3 or uses a lambda. |
| 2 | V6 | Task 5: `source_block_ids` needs a separate `ALTER` list entry after `db.py:2057` in `_PHASE_2_ALTERS`, not an edit beside `db.py:2047-2048`. Task 4: exclude `builtin:note_kind` from the property defaults; decide on unknown block ids. |
| 3 | V10 | Task 7: add a `notices.js` branch (+ `notices.test.js`, + a captured fixture) for `notebook_style_library`; otherwise the Notices box never shows it. |
| 4 | V14 | Task 10 (and the File map row): `StyleUpdateSheet.jsx` already exists; pick another name. R-P3-7 / V14 wording: `StylesManager` is a separate lazy import (`NotebookTab.jsx:146`), not part of `StyleSurfaces.js`. |
| 5 | V15 | Task 11: add `CORE_ACTION_EVENTS` entries and an asserting call-site test per new event. |
| 6 | Step 2 | The Global Constraints list `keyListenerCensus.test.js` as "must stay green"; it is red on the base (`GoldReview.jsx`, `ArchiveThumbs.jsx`; census 113 vs ceiling 111), and `src/components/admin/TemplateGalleryReviewPanel.test.jsx` does not exist (use `a11y/templateGallery.a11y.test.jsx`). |
