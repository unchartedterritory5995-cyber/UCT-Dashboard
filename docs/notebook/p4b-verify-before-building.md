# P4b verify before building (Task 1)

Plan: `docs/superpowers/plans/2026-10-18-notebook-p4b-layout-sharing.md`. Raw output (R-RAW, committed first in
`cfbce5d555`): `docs/notebook/evidence/p4b-verify-20261018T154050Z/`. Every line number below was read on the base.

Verdicts: **confirmed** (quote + `file:line`), **confirmed, drifted** (same shape, other lines), **DIFFERS** (the
shape is not what the plan says; the task text it changes is named, and the conflict is a row in the pre-flight
table at the end, with a proposed ruling). Nothing was fixed.

## Base

- Worktree `C:\Users\Patrick\uct-worktrees\notebook-p4b`, branch `notebook-p4b-layout-sharing`, base
  **`fe2d5fae5e008b754a7de38c4a8bad592da6541a`**, tree `9d6eb17ba02a23691df6746870a00c4b72718249`
  (`ancestry.txt`). `app/node_modules` is a junction (`Get-Item -Force`: `LinkType Junction`, target
  `_nb-shared-install\node_modules`, 377 entries).
- Ancestors, each its own call, exit 0: P3a `ecb377b641`, P4a `a512f220f7`. Also 0: the plan's write base
  `04778e0606` and #373 `4028fe61fe`.
- Master moved under the plan: `04778e0606..fe2d5fae5e` is 4 commits and touches **no** P4b file (`ancestry.txt`,
  the empty "P4b-file changes" list). During this run `origin/master` moved again to `a05610b416` (#394,
  `api/services/tsdr_lessons.py` and its test only; `master-moved.txt`). So every Fact below was read on code the
  plan's author also saw.
- Not landed: P3b (`origin/notebook-p3b-examples`, now **`3b5fe61557`**, 42 commits not on base, merge-base
  `04778e0606`) and P5 (`origin/notebook-p5-launch`, now **`f2c318561e`**, 3 commits not on base, same merge-base).
  `git merge-base --is-ancestor` exit 1 for both, against the base and against `a05610b416`.

## Base reds (pre-existing at fe2d5fae5e)

Each file ran in its own call (`cmd > log 2>&1; code=$?; tail; exit $code`), totals read from the log.

Vitest (`--maxWorkers=2`, from `app/`), 13 files: 12 green, 1 red.

| File | Result |
|---|---|
| `B/TemplateGallery.test.jsx` | 14 passed |
| `B/StyleLibrary.test.jsx` | 27 passed |
| `J/lib/pageLayouts.test.js` | 36 passed |
| `J/components/layout/PageLayoutEditor.test.jsx` | 36 passed |
| `J/components/layout/PageLayoutEditor.realSave.test.jsx` | 7 passed |
| `app/src/components/admin/TemplateGalleryReviewPanel.test.jsx` | 15 passed |
| `J/lib/notebookTelemetry.test.js` | 14 passed |
| `app/src/lib/swallowedFetch.census.test.js` (**the plan's `J/lib/...` path does not exist**) | 5 passed |
| `app/src/components/screener/reachable.test.js` | 17 passed |
| `app/src/pages/command/keyListenerCensus.test.js` | **2 failed**, 5 passed |
| `app/src/styles/tapFloor.test.js` | 5 passed |
| `J/a11y/styleLibrary.a11y.test.jsx` | 5 passed |
| `J/a11y/surfaceCoverage.test.js` | 13 passed |

Pytest (`-q`, one named file per call), 12 files (the brief's 11 plus `tests/test_notebook_flags.py`, which Task 2
runs): 10 green, 2 red.

| File | Result |
|---|---|
| `tests/test_style_library.py` | 39 passed |
| `tests/test_notebook_template_gallery.py` | 41 passed |
| `tests/test_page_layout_preference.py` | 42 passed |
| `tests/test_journal_two_account_purge.py` | 8 passed |
| `tests/test_notebook_contract_fixtures.py` | 11 passed |
| `tests/test_notebook_flag_parse.py` | **2 failed**, 312 passed |
| `tests/test_feature_flag_ledger.py` | 413 passed |
| `tests/test_notebook_switch_rehearsal.py` | **1 failed**, 24 passed |
| `tests/test_notebook_telemetry_events.py` | 17 passed |
| `tests/test_j2_telemetry_allowlist.py` | 14 passed |
| `tests/test_paywall_gate_free_tier.py` | 105 passed |
| `tests/test_notebook_flags.py` | 61 passed |

The reds, each with its first assertion line. None is in a file P4b touches; P5's own Task 1 recorded the same five
(`origin/notebook-p5-launch:docs/notebook/p5-verify-before-building.md:20-22`).

1. `keyListenerCensus.test.js:324` `RAW KEY LISTENER ADDED OUTSIDE THE REGISTRY` for
   `app/src/pages/admin/GoldReview.jsx: literal 1 > baseline 0` and
   `app/src/pages/traderArchive/ArchiveThumbs.jsx: literal 1 > baseline 0`; and `:343` `expected 113 to be 111`.
2. `test_notebook_flag_parse.py:254` (rail a) `tools/notebook_daily_prep_probe.py:282 NOTEBOOK_SETUPS_BOARD_ENABLED`
   and `:283 NOTEBOOK_CHART_PLAN_ENABLED` read with their own parse.
3. `test_notebook_flag_parse.py:316` (rail c) `tools/runtime_pane_smoke.py:234` and `:236` pass a non-payload name
   to `flag_on`.
4. `test_notebook_switch_rehearsal.py:105` `assert not ['NOTEBOOK_TERMINAL_LINKS_ENABLED']` (a gate with no probe
   and no reason).

**Every later P4b task reads "no NEW red against these five", never "green".**

## V1: the Facts F1-F28

`J` = `app/src/pages/journal-2-0`, `B` = `J/components/notebook`, `S` = `api/services/journal_two`.

**F1 confirmed.** `J/lib/pageLayouts.js:12` `export const LAYOUT_PREF = 'journal_page_layout'`; `:14`
`export const PHASES = Object.freeze(['premarket', 'market', 'postclose'])`; `:17-40` `PANELS` holds 9 `today`
rows (`coachStrip` ... `notices`) and 9 `trade` rows (`linkedNotes` ... `review`), each
`{ id, label, defaultShown }`. The plan's `LAYOUT_PANEL_IDS` (Task 3) matches both lists in order, and its rail
regexes match the source text (`today: Object.freeze([` ... `]),`; `id: '([A-Za-z]+)'`).

**F2 confirmed, drifted.** `:46-49` (plan `:42-49`, which includes the comment): `LAYOUT_VERSION = 1`,
`LAYOUT_MAX_ENTRIES = 40`, `LAYOUT_MAX_ID_LENGTH = 40`, `LAYOUT_MAX_BYTES = 16384`.

**F3 DIFFERS (one clause).** `normalizeList` `:80-99`, `normalizeLayout` `:115-138`, `resetPage` `:195-201`. Never
throws, keeps unknown ids in place, carries unknown fields (`:125-128`). But the missing registry ids are appended
**with their `defaultShown`, not hidden**: `:89-91` `for (const p of PANELS[page]) { if (!seen.has(p.id))
out.push({ id: p.id, shown: p.defaultShown }) }`. Every `trade` panel defaults shown (`:30-38`), and four `today`
panels do. Two smaller drifts: an unknown phase is carried only when it is a valid list (`:122-124`
`.filter(([k, v]) => !PHASES.includes(k) && validList(v))`), and a list is cut to 40 entries, unknown ids first
(`:92-97`). Changes R-P4b-9 and Task 7 (conflict **X2**).

**F4 confirmed.** `:9-10` "Nothing eager may import this module." Importers (non-test):
`PageLayoutEditor.jsx:28-30`, `TradeDetailPage.jsx:47`, `TodaySurface.jsx:52`. `pageLayouts.test.js:54` also
forbids any `import` in the module (`expect(layoutsSource).not.toMatch(/^\s*import\s/m)`).

**F5 confirmed, drifted.** `api/routers/auth.py:2829` `_PREFERENCE_KEYS = {`, `:2866`
`"journal_page_layout": "journal_page_layout",`; `_validate_page_layout` `:3158`, block `:3141-3218`, dispatched at
`:3233-3234`; refusal `:3155` `_PAGE_LAYOUT_REFUSAL = "That page layout could not be saved. Reset it and try
again."`. Shape only, never ids (`:3141-3146`).

**F6 confirmed.** `auth.py:271` `"JOURNAL_PAGE_LAYOUTS_ENABLED": False,`, `:272`
`"NOTEBOOK_STYLE_LIBRARY_ENABLED": False,`; `J/lib/offline/notebookFlags.js:80`
`journal_page_layouts_enabled: false,`, `:81` `notebook_style_library_enabled: false,`.

**F7 confirmed.** `PageLayoutEditor.jsx:58-125` (Editor and `save`), `:115` `const answer = await
setPrefMerged(LAYOUT_PREF, (prev) => withLists(normalizeLayout(prev), page, edits))`, `:116` `ok = answer?.ok ===
true`, `:145` `disabled={saving || readFailed}`, `:197-216` the default export. `PageLayoutEditorSlot.jsx:11`
`const PageLayoutEditor = lazyLeaf(() => import('./PageLayoutEditor'))`, `:29-37`. One more fact the plan does not
name: `:120` `if (ok) { onSaved?.(); onClose(); return }`, so **a Save closes the editor** (conflict **X10**).

**F8 confirmed.** `TodaySurface.jsx:112-115` (`customizing` state, `useJournalToast()`), `:237-268` (the header
row with Customize, the slot, `<JournalToast msg={toastMsg} .../>`). `TradeDetailPage.jsx:355-358`. The toast hook
holds a string (`JournalToast msg=`), not an action. Not in F8, and load-bearing for Task 8: the trade page has a
window key handler guarded on `customizing` only, `TradeDetailPage.jsx:434-445` `if (customizing) return` ...
`if (e.key === 'Escape') { navigate(-1); return }` (conflict **X9**).

**F9 confirmed.** `S/template_gallery.py:74` `LIBRARY_FLAG = "NOTEBOOK_STYLE_LIBRARY_ENABLED"`, `:77` `ITEM_TYPES =
("outline", "style")`, `:78` `TRADING_STYLES`, `:79` `SORTS`; `:135-137` `def library_enabled() -> bool:` ...
`return flag_on(LIBRARY_FLAG, False)`. `os` and `TRUTHY` are **not** imported (`:55-66`); Task 2 adds both.
Also: the whole router is gated first by `FLAG = "NOTEBOOK_TEMPLATE_GALLERY_ENABLED"` (`:68`, `:130-132`), see V4.

**F10 confirmed.** `:244-269`: the ALTER loop `:253-265` over `preview_json` ... `pending_at`, then `:266-268`
`CREATE UNIQUE INDEX IF NOT EXISTS idx_j2_template_gallery_style_source ... WHERE user_id IS NOT NULL AND
source_style_id IS NOT NULL`.

**F11 confirmed.** `_summary` `:482-546` (`:512` `"itemType"`, `:513` `"version"`, `:514` `"tradingStyle"`, `:517`
`"helpfulCount"`, `:522` `"authorHandle"`, author/admin block `:529-543` with `status`, `hasRevision`,
`revisionTitle`); `_LIST_COLUMNS` `:561-563`; `_check_select_shapes` `:588-603`, asserted at import `:603`.

**F12 confirmed, drifted.** `list_gallery` `:656-662` `if not library_enabled(): ... where.append("g.item_type =
'outline'")`; `_library_hides` `:691-694`; `admin_queue` `:1575` `outlines_only`; `author_page` `:1507`
`where = f"{_VISIBLE} AND g.user_id = ?"`; `feed` `:1557`; router `_require_library` `:97-103`. Omitted by the
plan: `use_template` `:1078-1089` checks only `_can_see`, so any visible row can be "used" (conflict **X8**).

**F13 confirmed.** `get_item` `:705-733` (`:718` `if row["item_type"] == "style":`, `:722` `out["payload"] =
_safe_listed(_listed_payload(row))`, admin `pendingRevision` `:726-729`); `_pending_revision` `:736-755`, payload
through `_safe_listed` at `:755`.

**F14 confirmed.** `publish_style` `:894-957` (held revision `:925-932`, replace in place `:933-941`, first publish
`:942-950`); `admin_act` approve `:1636-1665` (revision swap `:1639-1656`, `version = version + 1` at `:1654`),
reject keeps the listing `:1669-1677`. The swap reads `rev["payload"].get("outlineBodyJson")` (`:1644`), which a
`{page, lists}` payload answers with None, so the empty doc is used: fine for layouts.

**F15 confirmed.** `_listed_style_row` `:1128-1135`; `adopt_style` `:1190-1257`, one transaction, `INSERT OR IGNORE
INTO j2_template_gallery_uses` only `if row["user_id"] != user_id` (`:1238-1240`).

**F16 confirmed.** Router `:65-85` (rates and sentences), `:155-167` (`_daily_take`, `_give_back`), `:356-380`
(adopt: 30/hour + `NOTEBOOK_GALLERY_ADOPT_DAILY_CAP` 50, day given back on GalleryError, any Exception and None).

**F17 confirmed.** `:43-45` the literal-routes rule; `/styles` `:199`, `/updates` `:224-259`, `/feed` `:274`,
`/authors/...` `:281-307`, all above `GET /{gallery_id}` `:310`. `POST /layouts` and `GET /layouts/status` do not
collide with any existing path (no other two-segment GET; `POST ""` is not `POST /layouts`).

**F18 confirmed.** `J/lib/styleLibrary.js:21-24` `ITEM_TYPES`, `:26-33`, `:35-39`; `tests/test_style_library.py:156-
166` `_client_keys` and `test_the_client_lists_are_the_server_lists`. The test fixtures come from a shared module,
`tests/_style_library_helpers.py:21-41` (`conn`) and `:69-78` (`_row`), imported by name (`test_style_library.py:12`);
the plan's "copy the fixture body" differs from the repo's pattern (conflict **X17**).

**F19 confirmed, drifted.** Lazy doors `TemplatePicker.jsx:86`, `styles/LibraryDoor.jsx:13`. In
`B/TemplateGallery.jsx`: the export `:266`, `library_viewed` `:295-307`, the card switch `:392-401`
(`libraryOn && item.itemType === 'style' ? <StyleLibraryCard ...> : outlineCard(item)`), the type chips `:472-482`,
the message host `:432-448`. `initialType` is read once, at mount: `:276` `useState(() => (libraryOn &&
ITEM_TYPES.some((t) => t.key === initialType) ? initialType : ALL))` (conflict **X11**).

**F20 confirmed.** `B/StyleLibraryCard.jsx:14-17` (`:17` `import { ReportForm, PreviewLines } from
'./TemplateGallery'`), `:26-28` `refusalSentence`, adopt `:57-76` with `:66` ``onMessage?.({ tone: 'ok', text:
`Added "${name}" to your styles.${credit}` })``.

**F21 confirmed.** `B/styles/LibraryDoor.jsx:13` `lazyChunk(() => import('../TemplateGallery'))`, `:24-30` the
`Sheet` with `<TemplateGallery initialType="style" onBack=... backLabel="Close the library" />`.

**F22 confirmed.** `J/lib/notebookTelemetry.js:55-56`, schema `:168-174` `type: oneOf('all', 'outline', 'style')`;
server `api/routers/journal_two.py:222` `"library_viewed", "style_adopted",`, `:324-330`. In the closure:
`library_viewed` is in `assets/index-vHiP-i0E.js`, a first-open chunk (`closure-needles.txt`).

**F23 DIFFERS.** `_style_library(w)` `tools/notebook_contract_fixtures.py:1463`, `style_library(w)` `:2224-2226`,
but it is **no longer last**: the P2 Tier 3 builders follow it (`:2229` "Appended after every other builder").
Two more facts Task 6 needs: the sweeps cover every route by `route_table` (`:2091-2101`), and the flags-off sweep
turns **every** `FLAGS` row off (`:2109-2110` `for flag in FLAGS: w.p.setenv(flag, "0")`), so a switch outside
`FLAGS` is never on and its routes 404 in the signed-out sweep, which wants 401 (conflict **X6**).

**F24 confirmed.** `J/a11y/notebookSurfaces.js:58-59` (`StyleLibraryCard`, `AuthorView`), `:357-359`
(`ShareStyleForm`, `LibraryUpdateSheet`, `LibraryDoor`).

**F25 confirmed.** `S/account_purge.py:163-174` (`j2_template_gallery`, `_reports`, `_uses`, `j2_gallery_watches`,
`j2_gallery_helpful`, `j2_gallery_authors`), join pass `:338-346`.

**F26 confirmed.** `tools/notebook_switch_rehearsal.py:36`, `:185` `NOT_REHEARSED = {`, `:285` the style library
row; `:341-344` `not_rehearsed` prints "no rendered probe written" for a name with no row.

**F27 confirmed, drifted (P3b moved to `3b5fe61557`).** Read at the P3b tip: `S/template_gallery.py:79-83`
the `EXAMPLE_FLAG` comment and constant ("a `flag_on` call is for payload flags only, `notebook_flags.py`'s rule"),
`:89` `ITEM_TYPES = ("outline", "style", EXAMPLE_ITEM)`, `:91` `LISTED_ITEM_TYPES`, `:162-167` `example_enabled`
(`return library_enabled() and (os.environ.get(EXAMPLE_FLAG) or "").strip().lower() in TRUTHY`), `:647`
`_NEVER_LISTED`, `:739-748` `_library_hides`, `:750` `_can_see(row, viewer_id, is_admin, conn)` (**a fourth
parameter**), `:859` `_pending_revision`; router `:244` `"capabilities": {"exampleNotes": gallery.example_enabled()}`;
`TemplateGallery.jsx:502` chips over `LISTED_ITEM_TYPES`. Plan lines `:160-164`, `:736-761`, `:235`, `:501` are off.

**F28 confirmed.** `docs/notebook/perf-budgets.json:11` `"max": 2260793`. P3b's reading is on tree
`8e4dedc99875fd204c2b9ace4975abf164e2e0f4` (`p3b-bytes-20261018T122852Z/run.txt`); master's
`t3-bytes-20261018T035753Z/bytes.txt` reads `2,237,178 B across 61 JS chunks`. See V14.

## V2: P3b and P5 have not landed

`git merge-base --is-ancestor` exit 1 for `origin/notebook-p3b-examples` (`3b5fe61557`) and
`origin/notebook-p5-launch` (`f2c318561e`), against the base and against today's master (`ancestry.txt`,
`master-moved.txt`). No union is applied to Tasks 2-9; the union table is for whichever lands first, and the
P3b-side text it needs is quoted in F27. What each branch already changes in P4b's files (diff from merge-base
`04778e0606`):

- **P3b** (69 files): `S/template_gallery.py` (+929), `api/routers/notebook_template_gallery.py`, `S/account_purge.py`,
  `TemplateGallery.jsx` (+61), `styleLibrary.js` (+137), `TemplateGalleryReviewPanel.jsx` (+89),
  `notebookSurfaces.js` (+9), `notebookTelemetry.test.js` (pin moved to `LISTED_ITEM_TYPES`), `tests/test_style_library.py`,
  `tests/test_notebook_template_gallery.py`, `tools/notebook_contract_fixtures.py` (adds
  `"NOTEBOOK_EXAMPLE_NOTES_ENABLED"` to `FLAGS`), `tools/notebook_switch_rehearsal.py`, `docs/feature_flags.json`,
  and the list fixtures (`template-gallery.list*.json`, +3 lines each for `capabilities`). It also makes a reject
  name the reviewed version (`P3b-F-R4`, `test_style_library.py` diff: `admin_act(..., "reject", note=...,
  reviewed_updated_at=rev["updatedAt"], ...)`).
- **P5** (so far 10 files, +60): `auth.py` `NOTEBOOK_FLAGS` row `NOTEBOOK_STARTER_PACKS_ENABLED` (a payload flag),
  `notebookFlags.js`, `docs/feature_flags.json`, `tools/notebook_contract_fixtures.py` (+2), `tools/notebook_fin_walk.py`,
  `tools/notebook_switch_rehearsal.py`, two flag tests. Planned (its verify doc): firm style rows
  (`seed_firm_templates`, C3/C4/C5), three new telemetry events (C7, "20 names"), tours with a `library-types`
  anchor on the chip row and `library-adopt` in `StyleLibraryCard.jsx` (C11), and up to **+1,500 B** of first-open
  bytes (`p5-verify-before-building.md:234`, ceiling `2,240,064 B`).

## V3: `user_preferences`, and reading one key through a passed connection (DIFFERS)

- DDL `api/services/auth_db.py:236-243`: `CREATE TABLE IF NOT EXISTS user_preferences ( id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL, pref_key TEXT NOT NULL, pref_value TEXT, UNIQUE(user_id, pref_key) );`.
- The readers open their OWN connection and take none: `api/services/auth_service.py:1631-1641`
  `def get_user_preferences(user_id: str) -> dict:` / `conn = get_connection()` / `SELECT pref_key, pref_value FROM
  user_preferences WHERE user_id = ?`; the writer `:1644-1652` upserts `ON CONFLICT(user_id, pref_key)`.
- `journal_page_layout` is not a workspace board key (`api/services/workspace_doc_store.py:96-124`), so
  `user_preferences` is its only store (`auth.py:3280-3316`, `set_user_preference` at `:3314`).
- So `publish_layout` reads `SELECT pref_value FROM user_preferences WHERE user_id = ? AND pref_key = ?` on the
  passed `conn`. **Task 4's `_save_pref` names columns that do not exist** (`(user_id, key, value)`) and supplies no
  `id` (conflict **X1**).

## V4: no rail requires a gallery switch to be a payload flag (confirmed, with a fourth switch)

P3b has not landed, so the rule is read where it lives today:
- `api/services/notebook_flags.py:31-35` "⛔ `flag_on` IS FOR THE PAYLOAD'S FLAGS ONLY. Every literal
  `flag_on("NAME", …)` call must name a row of `auth.NOTEBOOK_FLAGS` (rail (c) ...)".
- `tests/test_notebook_flag_parse.py:18-21` rail (a) forbids an `os.environ.get` of a name **in** `NOTEBOOK_FLAGS`
  (`:250-253` `for line, name in rs if name in names`); `:26-30` rail (c), `:314-315` `if name not in names`.
- So `NOTEBOOK_LAYOUT_SHARING_ENABLED` read with `os.environ.get` + `TRUTHY` and kept out of `NOTEBOOK_FLAGS`
  passes both, and `flag_on("NOTEBOOK_LAYOUT_SHARING_ENABLED", ...)` would fail rail (c). `flag_on(PAGE_LAYOUTS_FLAG,
  False)` is right (a payload flag; rail (c) sees literals only, `:292`, and the name is a row anyway). R-P4b-10's
  idiom is the one P3b uses (F27). No rail forbids it; Task 2 is not stopped.
- Drift: the gallery router is gated first by `NOTEBOOK_TEMPLATE_GALLERY_ENABLED`
  (`notebook_template_gallery.py:90-94`, router dependency `:109`), so layout sharing works only with **four**
  switches on, not three. That flag is `armed` on web (`docs/feature_flags.json`: "ARMED on web 2026-10-08").
  Changes Task 10's arming precondition (conflict **X14**).
- `tools/notebook_fin_walk.py:79` `WAVE_FLAGS` refuses a non-payload name (`:500-503` `not a NOTEBOOK_FLAGS gate`),
  so the new switch must not be added there (P3b did not).

## V5: how a server-only switch is declared (confirmed)

- Ledger: P3b's entry (`origin/notebook-p3b-examples:docs/feature_flags.json`, inserted after
  `JOURNAL_TIER3_ENABLED`): `"member_facing": { "label": ..., "where": "Notebook" }, "status": "dark", "where":
  ["web"], "note": "P3b. Server-only (no client fallback row); ... Arm: railway variables --service web --set ...
  Rollback: 0; ..."`. Task 2's entry has the same keys. `test_feature_flag_ledger.py` passes P3b's (413 passed here).
- Rehearsal: P3b's `NOT_REHEARSED` row `"NOTEBOOK_EXAMPLE_NOTES_ENABLED": "dark (P3b): ... server-only, NOT on the
  auth payload (so no payload key to verify) ... waits for the owner's arming"`. Task 2's row has the same shape.
- Contract tool: P3b adds the switch to `FLAGS` (`tools/notebook_contract_fixtures.py` diff: `+ "NOTEBOOK_EXAMPLE_NOTES_ENABLED",`).
  Task 2 / Task 6 must do the same (X6).

## V6: every clause that decides whether a row's TYPE is visible (confirmed, one gap)

| Function | Gate | Type clause |
|---|---|---|
| `set_helpful` `:1454-1480` | `:1461` `if not library_enabled() ...: return None` (any type) | `:1467` `_can_see(row, user_id, False)`, through `_library_hides` |
| `report` `:1419-1446` | none | `:1430` `if row is None or row["status"] != "approved" or row["hidden"] or _library_hides(row):` |
| `author_page` `:1492-1520` | `:1499` `if not library_enabled(): return None` | none: `:1507` `{_VISIBLE} AND g.user_id = ?` |
| `feed` `:1548-1562` | `:1551` `if not library_enabled(): return []` | none: `:1557` `{_VISIBLE} AND g.user_id IN (...)` |
| `admin_queue` `:1567-1606` | none | `:1575` `outlines_only = "" if library_enabled() else " AND g.item_type = 'outline'"` |
| `admin_act` `:1609-1708` | none | `:1633` `if row is None or _library_hides(row): return None` |
| `admin_report_act` `:1711-1737` | none | `:1726` `_library_hides(target)` |
| `list_gallery` `:618-683` | `:633`, `:656` | `:639`, `:656-662` |
| `get_item` / `use_template` | none | `_can_see` (`:713`, `:1088`) |
| `unpublish` `:1008-1046` | none, on purpose (always possible) | none |

`author_page` returning None while the library is off breaks Task 3's vanish test (conflict **X3**).
`use_template` is the gap (X8).

## V7: the schema runs on boot and the ALTER loop adds columns (confirmed)

`S/db.py:2227` `def ensure_schema(conn` ... `:2244-2245` `from api.services.journal_two.template_gallery import
ensure_gallery_schema` / `ensure_gallery_schema(conn)`; `init_db` (`auth_db.py:656`) calls `_migrate_journal_v2` (`:846`), which calls `ensure_schema` (`:1054-1055`).
The loop `template_gallery.py:253-265` reads `PRAGMA table_info` and `ALTER TABLE ... ADD COLUMN` for a missing
name; `tests/test_style_library.py:28-68` proves it on a legacy table. Adding `("source_page", "TEXT")` is the same
move.

## V8: the swallowed-fetch census has no "404 means off" concept (DIFFERS in premise, harmless)

The rail is `app/src/lib/swallowedFetch.census.test.js` (not `J/lib/`). It counts one literal shape:
`:18` `const SWALLOW_RE = /\.catch\(\s*\(\s*\)\s*=>\s*(?:null|undefined)\s*\)/g`, in code only, against a
shrink-only baseline (`:58-63`). It accepts nothing and forbids nothing else. So `useLayoutSharingStatus` must read
the 404 as an explicit branch on `err.status === 404` (the `call` helper already sets `err.status`,
`styleLibrary.js:64-66`) and must never write `.catch(() => null)`. Fix the path in the plan's Global Constraints
and Tasks 7-8 (X12).

## V9: `usePreferences()` (confirmed)

`app/src/hooks/usePreferences.js:253` `export default function usePreferences(enabled = true)`; `:403` `return {
prefs, setPref, setPrefMerged, loading: isLoading, readFailed: _lastReadOk === false }`. `setPrefMerged` `:362-399`
runs the updater inside the SWR mutate (`:366-382`, `current = parsePref(base[key], undefined)`), returns
`undefined` when the updater returns `undefined` (`:385`), and otherwise `queueWrite(... postPref ...)`, whose
answer is `{ ok: true }` (`:137`), `{ ok: false, conflict: true }` (`:123`, `:145`) or `{ ok: false }` (`:148`);
a thrown POST resolves `undefined` (`:395-398`). So "only `{ok: true}` is a success" is the right test, and a
capture taken inside the updater sees the exact layout the write merges into.

## V10: the admin review panel's chunk (DIFFERS in route, conclusion holds)

`TemplateGalleryReviewPanel.jsx` has exactly one importer, and it is not the admin page:
`B/TemplateGallery.jsx:42` `import TemplateGalleryReviewPanel from '../../../../components/admin/TemplateGalleryReviewPanel'`
(rendered `:550` for the Review queue view). `App.jsx:201` `const Admin = lazy(() => import('./pages/Admin'))` does
not reach it. The gallery is lazy and outside the closure (`closure-membership.txt`: `NOT_IN_CLOSURE TemplateGallery`,
`NOT_IN_CLOSURE TemplateGalleryReviewPanel`, `NOT_IN_CLOSURE pageLayouts`). So importing `pageLayouts.js` into the
panel adds no first-open bytes; it lands in the gallery's lazy graph. Task 8's wording should say "the lazy gallery
chunk", not "the admin route".

## V11: the Customize buttons and slots (confirmed)

Today, `TodaySurface.jsx:240-268`:

```jsx
const header = pageLayoutsEnabled() && !zeroData ? (
  <div className={styles.headRow}>
    {scopeNote}
    <button type="button" className={styles.customizeBtn} onClick={() => setCustomizing(true)}>
...
{customizing && (
  <PageLayoutEditorSlot page="today" initialPhase={session} onClose={() => setCustomizing(false)}
    onSaved={() => setToastMsg('Layout saved.')} />
)}
<JournalToast msg={toastMsg} style={TOAST_STYLE} />
```

Trade page, `TradeDetailPage.jsx:969-974` (the button inside `styles.navBtns`, before Previous / Next) and
`:1026-1033` (the slot with `page="trade"`, then `<JournalToast msg={layoutMsg} style={LAYOUT_TOAST_STYLE} />`).
The door goes beside each slot. Existing tests to run in Task 8: `TodaySurface.layout.test.jsx`,
`TradeDetailPage.layout.test.jsx`, `a11y/pageLayouts.a11y.test.jsx`, `a11y/pageLayoutsTrade.a11y.test.jsx`.

## V12: TemplateGallery's shared pieces, and AuthorView (confirmed, drifted)

- `B/TemplateGallery.jsx:48` `export function PreviewLines({ lines })`; `:62` `export function ReportForm({ item,
  onDone, onCancel })` (`onDone(text)` with the server's own already-reported sentence, `:75-77`); `:105` `export
  function GalleryCard({ item, isAdmin, busy, onPreview, onUse, onChanged, onMessage })`.
- The message host `:432-448`: state `:280` `const [message, setMessage] = useState(null) // { tone, text, made? }`;
  renders `message.text` and, when `message.made && onUseNow`, one button. No `action` field yet (Task 7 adds it).
- `B/AuthorView.jsx:15` `export default function AuthorView({ handle, onBack, onMessage, onPreview, onAdopted,
  renderOutline, busy = false })`; card branch `:86-89` `item.itemType === 'style' ? <StyleLibraryCard ... /> :
  (renderOutline ? renderOutline(item) : null)`.
- The trading-style row already shows for every type but `outline` (`:483` `libraryOn && itemType !== 'outline'`).

## V13: an enum value outside the schema becomes 'other', on both sides (confirmed)

Client `notebookTelemetry.js:192` `out[key] = typeof v === 'string' && spec.values.has(v) ? v : OTHER` (and
`:89` `const OTHER = 'other'`); the event is still sent. Server `api/routers/journal_two.py:361` `out[key] = v if
isinstance(v, str) and v in spec else "other"`. Both enums are pinned to `ITEM_TYPES`, not typed:
`notebookTelemetry.test.js:132-133` `expect([...EVENT_SCHEMAS.library_viewed.type.values].sort()).toEqual(['all',
...ITEM_TYPES.map((t) => t.key)].sort())` and `tests/test_notebook_telemetry_events.py:226`
`assert set(_NOTEBOOK_PROP_SCHEMAS["library_viewed"]["type"]) == {"all", *template_gallery.ITEM_TYPES}`. So the
moment Task 3 adds `page_layout` to `ITEM_TYPES`, both rails red until the enum gains it (conflict **X4**), and the
Task 9 fallback "drop the literal" cannot pass them unless the pins change (X4).

## V14 (measured): the first-open closure on the base

- `cd app && npm run build`: exit 0 (`npm-run-build.log`, last line `BUILD EXIT: 0`).
- `python tools/notebook_perf_budgets.py --dist app/dist`: exit 0,
  **`bytes.notebook_first_open: 2,238,573 B across 61 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)`**,
  `VERDICT: PASS` (`notebook_perf_budgets.txt`; attribution in `notebook_perf_budgets.json`).
- Tree: `9d6eb17ba02a23691df6746870a00c4b72718249` (base `fe2d5fae5e`). **Headroom 22,220 B.**
- Closer to master's `2,237,178 B` (+1,395 B) than to P3b's `2,260,246 B` (-21,673 B). #373 (`4028fe61fe`) is an
  ancestor (exit 0), which is what separates the two readings. P5 measured `22,229 B` of headroom on its own base
  (its C17), consistent with this.
- **R-P4b-13's base is 2,238,573 B**: target +0 B, ceiling +40 B, i.e. at most **2,238,613 B** on a tree with no
  other landing. If P5 lands first it may add up to 1,500 B; Task 10 then compares against this figure plus P5's
  own measured delta, never against the budget (X20).

## Pre-flight table

### Pairs of tasks that share a file or an interface

| # | Producer → consumer | What passes | Verdict |
|---|---|---|---|
| A1 | T2 → T3, T4, T5 | `layout_sharing_enabled()` feeds `_hidden_item_types()`, `publish_layout`, `adopt_layout`, `layout_status` | Agree |
| A2 | T2 → T6 | the switch must be on inside the contract tool | **Conflict X6**: Task 6 does not add it to `FLAGS` |
| A3 | T3 → T4, T5 | `page_layout_share` (registry, `validate_layout_payload`, `safe_layout`), `source_page`, the index, `_hidden_item_types` | Agree |
| A4 | T3 → T7 | server and client `ITEM_TYPES` gain `page_layout`; `capabilities.layoutSharing`; `layoutPage` | **Conflict X4**: the telemetry enum pins red from T3 until T7; `StyleLibrary.test.jsx:155` (chips == every `ITEM_TYPES` label) reds once T7 filters the chip (X21) |
| A5 | T3 → T6 | the list answer gains `capabilities`, which moves every committed `template-gallery.list*.json` | **Conflict X6**: T6's "no earlier fixture changed, else STOP" fires by construction; `test_notebook_contract_fixtures.py` is red from T3 to T6 |
| A6 | T4 ↔ T5 | `get_item` returning a layout `payload` | **Conflict X5**: T4's held-revision test reads `listed["payload"]`, which T5 builds |
| A7 | T4 → T8 | `POST /layouts` `{template, droppedPanels}`; `GET /layouts/status` `{shared: {today, trade}}` with `status`, `version`, `hasRevision` (author summary, `:529-543`) | Agree |
| A8 | T5 → T7 | `POST /{id}/adopt-layout` `{version}` → `{layout, version, credit}` | Agree |
| A9 | T4, T5 → T6 | every new route needs a recorded 2xx and both sweeps (`test_notebook_contract_fixtures.py:138-162`) | Agree (sweeps are derived from `route_table`, no hand list) |
| A10 | T7 → T8 | `replaceLists` (replaces the editor's `withLists`, whose argument is `[{phase, list}]`, not a `lists` object); `useLayoutSharingStatus`; `shareLayout` | Agree; the editor converts its `edits` array |
| A11 | T7 → T8 | `LayoutLibraryDoor` opens `<TemplateGallery initialType="page_layout">` | **Conflict X11**: `initialType` is fixed at mount, and with sharing off a `?type=page_layout` list is a 400 that carries no `capabilities` |
| A12 | T7 ↔ T9 | the `library_viewed` literal is the only first-open byte; T9's fallback drops it | **Conflict X4** (the fallback cannot pass the pins) |
| A13 | T8 → T9 | a11y rows for `ShareLayoutForm`, `LayoutLibraryDoor`, the four gallery files | Agree |
| A14 | T1 → T9, T10 | the bytes base 2,238,573 B | Agree; see X20 for a P5 landing |
| A15 | T5 ↔ T7 | "Use this layout" vs the outline "Use template" door on the same row | **Conflict X8**: `POST /{id}/use` accepts a layout row today |

### Each task against its own text

| Task | Verdict |
|---|---|
| T1 | Consistent. |
| T2 | Consistent. Its test file sets three switches; the router-level gallery switch is a fourth, not needed by these unit cases. |
| T3 | **Inconsistent with the code (X3)**: the vanish test indexes `author_page(...)["items"]`, which is `None` when the library switch is the one off. Otherwise consistent (the `_row` helper's 15 columns and 10 binds agree). |
| T4 | **Inconsistent (X1, X5)**: `_save_pref`'s columns, and the held-revision test needs T5's `get_item` branch. Its nothing-to-share test expects `PAGE_SENTENCE` with an unreadable row saved, so the page is checked before the row is parsed; say so in `layout_payload`. |
| T5 | Consistent; misses `use_template` (X8). |
| T6 | **Inconsistent (X6, X7)**: "sharing off with the other two on" is not what the flags-off sweep does, the switch is not in `FLAGS`, "register last" is no longer `style_library`, and the fixture STOP fires. |
| T7 | **Inconsistent with the code (X2, X21)**: "appended hidden" vs `defaultShown`; `StyleLibrary.test.jsx` is in its run list but not its file list. `LOAD_FAILED` lives in the lazy editor (X16). |
| T8 | **Inconsistent with the code (X9, X10, X15)**: test 3 assumes the editor stays open after Save; the trade page's key handler; `lazyChunk` vs the editor slot's `lazyLeaf` rule. |
| T9 | **Inconsistent (X4)**: the fallback contradicts the derived pins. |
| T10 | Consistent, but its arming precondition names two switches where four apply (X14). |

### Conflicts between the plan and the current code, with proposed rulings

| # | Plan says | The code says | Proposed ruling |
|---|---|---|---|
| X1 | T4 `_save_pref`: `INSERT OR REPLACE INTO user_preferences (user_id, key, value)` | `auth_db.py:236-242` columns `id, user_id, pref_key, pref_value`, `UNIQUE(user_id, pref_key)` | `_save_pref` writes `(id, user_id, pref_key, pref_value)` with `uuid4().hex` and `ON CONFLICT(user_id, pref_key) DO UPDATE SET pref_value = excluded.pref_value` (the `set_user_preference` statement, `auth_service.py:1648-1650`). `publish_layout` reads `SELECT pref_value ... WHERE user_id = ? AND pref_key = 'journal_page_layout'` on the passed `conn`. T5's count query (`SELECT COUNT(*) FROM user_preferences WHERE user_id = 'member'`) is already right. |
| X2 | F3, R-P4b-9, T7 test 2: missing registry panels "appended hidden by `normalizeLayout`"; `review` expected `{shown: false}` | `pageLayouts.js:89-91` appends with `defaultShown`; every trade panel defaults shown | `applySharedPage` appends each registry panel a shared list lacks itself, **hidden**, before `normalizeLayout` (a shared layout that omits a panel means "not part of this layout"). Keep T7's assertion. Reword R-P4b-9 and F3. In practice a saved list holds all nine (the editor normalizes before saving), so this bites only hand-built or short shared lists. |
| X3 | T3 vanish test: `author_page("v", handle, conn=conn)["items"]` for every switch | `:1499` `if not library_enabled(): return None` | Read `(gallery.author_page(...) or {"items": []})["items"]`, and assert `is None` explicitly for the library-off case. Same care for `feed` (`[]`, `:1551`). |
| X4 | T7 adds `'page_layout'` to `library_viewed.type`; T9 may drop it | `notebookTelemetry.test.js:132-133` and `test_notebook_telemetry_events.py:226` pin the enum to `{'all', *ITEM_TYPES}` | Move the two enum edits (client `notebookTelemetry.js:169`, server `journal_two.py:325`) into **T3**, the commit that adds the item type, and add both rails to T3's run. T9's fallback, if ever needed, must also re-point both pins to the chip-visible types (P3b already re-points the client pin to `LISTED_ITEM_TYPES`); the cheaper fallback is to keep the schema and accept `'page_layout'` arriving as `'other'`, which costs 0 B. The measured cost of the literal is ~14 B against 22,220 B of headroom, so the fallback is unlikely. |
| X5 | T4 test reads `get_item(...)["payload"]`; T5 builds that branch | `get_item:718` handles `style` only | Move `get_item`'s `page_layout` branch (`out["payload"] = safe_layout(...)`) and `_pending_revision`'s layout branch into **T4**. T5 keeps adopt. |
| X6 | T6: add each route to the sweeps; flags-off is "sharing off with the other two on"; STOP if an earlier fixture changes | Sweeps derive from `route_table`; flags-off turns every `FLAGS` row off (`:2109-2110`); a switch outside `FLAGS` stays unset, so the layout routes answer 404 in the signed-out sweep, which raises (`:2098-2100`); T3's `capabilities` moves the list fixtures | T6 adds `"NOTEBOOK_LAYOUT_SHARING_ENABLED"` to `FLAGS` (P3b's precedent); drop "add each route" and the "sharing off, two on" wording (both sweeps are derived). The STOP rule becomes: no earlier fixture's ids or times move; the `capabilities` key (+3 lines in each `template-gallery.list*.json`, as P3b) is expected and named in the commit. Note in T3-T5 that `test_notebook_contract_fixtures.py` is red until T6 regenerates. |
| X7 | F23, T6: `_style_library` is registered last; register the layout builder "after style_library" | Tier 3 builders follow it (`:2229`) | Register `layout_library` at the very end of the file, after the Tier 3 builders (and after P3b's `example_notes` if landed). |
| X8 | Not in the plan | `use_template` `:1078-1089` copies any row `_can_see` allows; `TemplateGallery.jsx:392-401` renders a non-style row as a `GalleryCard` with "Use template"; a layout row would become an empty template and count a use | T5: `use_template` returns None for a `page_layout` row (the one 404), with a test; T7's `LibraryCard` dispatch removes the client door. (P5's C3 found the same door for styles with the library off.) |
| X9 | T8: one `findingLayouts` state per page | `TradeDetailPage.jsx:434-445` window keydown guarded on `customizing` only: Escape navigates back and the arrows change the trade under an open library sheet | T8 adds `findingLayouts` to that guard and its dependency list, with a test (Escape in the library sheet closes the sheet and does not navigate). No new listener, so `keyListenerCensus` is unchanged. |
| X10 | T8 test 3: "an unsaved toggle disables Share; Save, then Share is enabled" | `PageLayoutEditor.jsx:120` a confirmed Save closes the editor | Test 3 becomes: toggle → Share disabled with the hint; Save (the sheet closes); reopen Customize → Share enabled. |
| X11 | T7/T8: `initialType` accepts `page_layout` only while `layoutSharing`; the door opens the gallery at Page layouts | `TemplateGallery.jsx:276` reads `initialType` once, at mount, before any list answer; with sharing off, `?type=page_layout` is a 400 (no `capabilities` in an error) | Accept `page_layout` at mount when it is in `ITEM_TYPES`; read `layoutSharing` from the list answer; when an answer says false (or the typed list errors with 400 and the untyped one says false), reset the type to All. `LayoutLibraryDoor` is only reachable after a 200 from `/layouts/status`, so the reset is the stale-tab case. Test both. |
| X12 | Global Constraints and T7/T8: `J/lib/swallowedFetch.census.test.js`; "the census's explicit 404 branch" | `app/src/lib/swallowedFetch.census.test.js:18` counts `.catch(() => null|undefined)` only | Correct the path. `useLayoutSharingStatus` maps `err.status === 404` to `off: true` explicitly and never swallows. |
| X13 | V10: the panel is reached through the lazy admin route | Its only importer is `TemplateGallery.jsx:42` | No task change beyond wording; the byte conclusion holds (`closure-membership.txt`). |
| X14 | R-P4b-10, T10: effective while the library and page layouts are on | The router-level gate `NOTEBOOK_TEMPLATE_GALLERY_ENABLED` (`notebook_template_gallery.py:90-94`) | T10's arming packet lists four switches in its precondition (the gallery one is already armed); R-P4b-10's sentence names it. No code change: `layout_sharing_enabled()` need not read it, the router already does. |
| X15 | T8: `LayoutLibraryDoor` loads the gallery with `lazyChunk(...)` | `PageLayoutEditorSlot.jsx:4-6`: on these pages it is `lazyLeaf`, never `lazyChunk`, because a second chunk failure reloads the page | Use `lazyLeaf(() => import('../notebook/TemplateGallery'))` with a load boundary like the slot's (`:15-26`), same specifier, so the chunk is still shared. |
| X16 | T7: Use is disabled "with P4a's `LOAD_FAILED` sentence" | `LOAD_FAILED` is exported by the lazy `PageLayoutEditor.jsx:34`; a different `LOAD_FAILED` by `PageLayoutEditorSlot.jsx:13` | Move the editor's sentence into `pageLayouts.js` (it has no imports, so the `:54` rail holds) and import it from both the editor and `AdoptLayoutSheet`, so the gallery chunk does not pull in the editor module. |
| X17 | T3/T5: copy the `conn` fixture body; copy `_client_keys` | `tests/_style_library_helpers.py` is the shared module, imported by name (its docstring says so) | Import `conn` and `_row` from `tests._style_library_helpers`, or add the layout helpers there; keep `_client_keys` by import from `tests.test_style_library` (T3 already allows it). Either way, no copy. |
| X18 | F27 lines for P3b | P3b tip is `3b5fe61557`; `_can_see` takes `conn`; a reject names the reviewed version | At the merge: every P4b call to `_can_see` passes `conn`; every P4b `admin_act(..., "reject", ...)` in tests and the review panel passes `reviewed_updated_at`. |
| X19 | (none) | `tools/notebook_fin_walk.py:500-503` refuses a non-payload name in `WAVE_FLAGS` | Do not add the switch there; the P4b walk is its own tool. |
| X20 | R-P4b-13: +0 B over Task 1's figure | Base 2,238,573 B; P5 may land first with up to +1,500 B (its ceiling 2,240,064 B) | T9 compares against 2,238,573 B on the P4b branch. T10's landing re-measure compares against 2,238,573 B plus the measured delta of whatever landed since (P5's own evidence), and records both. |
| X21 | T7 run list includes `StyleLibrary.test.jsx`; its file list does not | `StyleLibrary.test.jsx:155` expects the chip row to equal `['All', ...ITEM_TYPES.map((t) => t.label)]` | Add `StyleLibrary.test.jsx` to T7's files; the expectation becomes the chip-visible types for the capability in that fixture. |

## Expected union-merge points with P3b and P5

Whichever lands second merges master first and keeps both sides. Concrete points, read from both branches:

| File | P3b side | P5 side | P4b side | Resolution |
|---|---|---|---|---|
| `S/template_gallery.py` constants | `EXAMPLE_FLAG`, `EXAMPLE_ITEM`, `ITEM_TYPES = ("outline", "style", EXAMPLE_ITEM)`, `LISTED_ITEM_TYPES`, `example_enabled` (`:79-91`, `:162-167`) | firm style seed (planned) | `LAYOUT_SHARING_FLAG`, `PAGE_LAYOUTS_FLAG`, `layout_sharing_enabled`, `LAYOUT_ITEM` | `("outline", "style", EXAMPLE_ITEM, LAYOUT_ITEM)`; `LISTED_ITEM_TYPES` keeps `page_layout`; imports `os` and `TRUTHY` once (P3b already imports `TRUTHY, flag_on`, `:70`) |
| `list_gallery` | `LISTED_ITEM_TYPES` check, `_NEVER_LISTED` (`:682`, `:693`) | none planned (P5 C3) | `_hidden_item_types` check, `_type_visible_clause()` | both clauses ANDed; the hidden-type check after P3b's listed check |
| `_library_hides`, `_can_see`, `_pending_revision`, `get_item` | example branches; `_can_see(..., conn)` | none planned | `page_layout` through `_hidden_item_types`; `safe_layout` | P3b's example branch first, then the type rule; pass `conn` (X18) |
| `author_page`, `feed`, `admin_queue` | `_NEVER_LISTED`; `outlines_only = f" AND {_NEVER_LISTED}"` (`:2400`) | none planned | `_type_visible_clause()` | ANDed |
| `use_template` | unchanged | unchanged (P5 C3 leaves it) | refuses `page_layout` (X8) | P4b's guard |
| router list endpoint | `"capabilities": {"exampleNotes": ...}` (`:244`) | none | `"layoutSharing": ...` | one dict, both keys |
| `J/lib/styleLibrary.js` | `example_note` row, `LISTED_ITEM_TYPES`, `exampleNotes` | none | `page_layout` row last, `layoutSharing`, `shareLayout`, `adoptLayout`, `useLayoutSharingStatus` | server order; both capability fields |
| `B/TemplateGallery.jsx` | chips and `initialType` read `LISTED_ITEM_TYPES` (`:303`, `:502`) | `data-tour="library-types"` on the chip row (planned) | chip hidden unless `layoutSharing`; `LibraryCard`; message `action` | chips = `LISTED_ITEM_TYPES` filtered by capability; keep P5's anchor |
| `B/StyleLibraryCard.jsx` | unchanged | `library-adopt` anchor (planned, C11) | unchanged (dispatch moves to `LibraryCard`) | P5's anchor stays on the style card |
| `TemplateGalleryReviewPanel.jsx` | example branch (+89) | none | `LayoutReviewDetails` | separate branches; reject passes the token (X18) |
| telemetry (`notebookTelemetry.js`, `journal_two.py`, both pins) | client pin → `LISTED_ITEM_TYPES` | three new events, "20 names" (C7) | `'page_layout'` in `library_viewed.type` | all lines kept; pins derive from the listed types |
| `tools/notebook_contract_fixtures.py` `FLAGS` and builders | `"NOTEBOOK_EXAMPLE_NOTES_ENABLED"`, `example_notes` builder | `"NOTEBOOK_STARTER_PACKS_ENABLED"` (+2) | `"NOTEBOOK_LAYOUT_SHARING_ENABLED"`, `layout_library` builder | every row; builders in landing order at the end; regenerate once on the landing tree |
| `tools/notebook_switch_rehearsal.py` `NOT_REHEARSED` | example row | starter packs row | layout sharing row | all rows |
| `docs/feature_flags.json` | example entry after `JOURNAL_TIER3_ENABLED` | starter packs entry | layout sharing entry | all entries |
| `J/a11y/notebookSurfaces.js` | +9 rows | tours (planned) | the layout rows | all rows |
| `S/account_purge.py` | +35 | none | none (purge by `user_id` already covers layouts) | P3b's side |
| bytes | +0 by its own rule | up to +1,500 B | +0 to +40 B | re-measure on the landing tree (X20) |
