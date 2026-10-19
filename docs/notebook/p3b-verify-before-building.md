# P3b verify-before-building (Task 1)

Run 2026-10-17/18 in `C:\Users\Patrick\uct-worktrees\notebook-p3b`, branch `notebook-p3b-examples`.
Raw evidence is in `docs/notebook/evidence/p3b-verify-20261018-0000/` and was committed (`095a376365`, `0bd116b6c2`) before this summary was written (R-RAW).

Notation: `S/` is `api/services/journal_two/`, `J/` is `app/src/pages/journal-2-0/`. Every line number below was read from this tree (the P3a tip), and every quoted line is the file's own text. A premise of the plan that the tree contradicts is marked **DIFFERS**.

## Base reds, recorded as "pre-existing at 5524c27bd8"

Each file ran in its own call, with the log written to a file and the totals line read from it (`code=$?; tail; exit $code`). No run was judged through a pipe.

| File | Result | Verdict |
|---|---|---|
| `tests/test_public_note_payload.py` | 391 passed | green |
| `tests/test_style_library.py` | 39 passed | green |
| `tests/test_notebook_template_gallery.py` | 41 passed | green |
| `tests/test_j2_db_import_closure.py` | 2 passed | green |
| `tests/test_journal_two_account_purge.py` (the account purge test, found in V9) | 8 passed | green |
| vitest `src/components/admin/TemplateGalleryReviewPanel.test.jsx` | 15 passed | green |
| vitest `src/pages/journal-2-0/a11y/styleLibrary.a11y.test.jsx` | 5 passed | green |
| vitest `src/pages/journal-2-0/components/notebook/StyleLibrary.test.jsx` | 27 passed | green |
| vitest `src/pages/journal-2-0/components/notebook/styles/StyleLibraryDoors.test.jsx` | 31 passed | green |
| vitest `src/pages/journal-2-0/lib/styleLibraryFlag.test.js` | 4 passed | green |
| vitest `src/components/screener/reachable.test.js` | 17 passed | green |
| vitest `src/styles/tapFloor.test.js` | 5 passed | green |

The five vitest files in the P3a-added set are the five test files `git diff --diff-filter=A f2e816e042..HEAD` lists under `app/src` (P3a's base is `f2e816e042`). **All twelve named files are green; none of the plan's named files is a base red.**

The known master reds that are NOT in the named set were run for the three that Task 2 or the flag census would touch, so a later task compares against them rather than against green:

| File | Result | Rows |
|---|---|---|
| `tests/test_notebook_flag_parse.py` | 2 failed, 290 passed | `test_NO_notebook_flag_is_read_outside_the_one_parse` (`tools/notebook_daily_prep_probe.py:282 NOTEBOOK_SETUPS_BOARD_ENABLED`, `:283 NOTEBOOK_CHART_PLAN_ENABLED`), `test_every_flag_on_call_names_a_payload_flag` (three strays in `tools/runtime_pane_smoke.py:234,236`) |
| `tests/test_notebook_switch_rehearsal.py` | 1 failed, 24 passed | `test_every_notebook_gate_is_rehearsed_or_carries_a_reason`: `assert not ['NOTEBOOK_TERMINAL_LINKS_ENABLED']` |
| vitest `src/pages/command/keyListenerCensus.test.js` | 2 failed, 5 passed | `app/src/pages/admin/GoldReview.jsx: literal 1 > baseline 0`, `app/src/pages/traderArchive/ArchiveThumbs.jsx: literal 1 > baseline 0`, and `expected 113 to be 111` |

Not run (not in the named set, recorded as "known, not re-measured here"): `test_user_definitions_auth`, `test_review_drafts` (trader_blocks caller rail), `test_notebook_bridges_pin_the_root`, `test_address_space`.

## V1. Base SHA and P3a's merge SHA — confirmed, with a movement to know about

- Base SHA: **`5524c27bd89fdd47ff25943483b63c7bc9dc8787`** (`git rev-parse HEAD` at the start of this task; `5524c27bd8 docs(notebook): the P3a arming packet (P3a final I-3, I-4b, M-12, M-13)`).
- `git merge-base --is-ancestor 5524c27bd8 HEAD` exits **0**.
- **P3a merge SHA: not yet merged; filled at P3b's landing merge.** P3a is branch `notebook-p3a-library`; its merge-base with `origin/master` is `f2e816e04229b6b3cf750cd097cbd99d18faf0fe`, 30 commits behind `5524c27bd8`.
- **The P3a branch has moved since this worktree was cut:** `notebook-p3a-library` (and `origin/notebook-p3a-library`) now read `41548ccbd1f13256e3579a3036070501cef8bbe1`, one commit ahead of `5524c27bd8` (`git rev-list --count 5524c27bd8..41548ccbd1` is 1, and `5524c27bd8` is its ancestor). That commit is docs only: `docs/notebook/p3a-arming.md | 16 insertions, 8 deletions`. The base is unaffected; recorded so a later "is P3a on the base" check names the right tip.
- `origin/master` is `f419acdafb0724a9b922ca1c458e0c36e07ed499`, 124 commits ahead of `5524c27bd8`. The ruling is that this tree is based on the P3a tip, not on master (P3b-R1).

## V2. `public_note_payload.reduce` — confirmed; two DIFFERS in the node names, and the image row is the big one

`S/public_note_payload.py`:

```
1119: def reduce(
1120:     body: Any,
1121:     *,
1122:     mode: str,
1123:     owner_id: str,
1124:     note_id: str,
1125:     attachment_base: str,
1126:     facts: Mapping[str, Mapping[str, Any]] | None = None,
1127:     note_links: Mapping[str, tuple[str, str]] | None = None,
1128: ) -> dict:
137: MODES = ("share", "publish", "gallery")
1136:     if mode not in MODES:
```

So the signature is `reduce(body, *, mode, owner_id, note_id, attachment_base, facts=None, note_links=None) -> dict`. All of `mode`, `owner_id`, `note_id`, `attachment_base` are required keywords.

**How `gallery` mode is branched.** There is no `if mode == "gallery"` fork at the top. The mode selects a COLUMN of the policy table: `1064:     action = policy[ctx.mode]`. Five more places read `ctx.mode == "gallery"` (or `gallery=True`): `_attr_policy(*, gallery: bool)` at `:764` (a stricter attribute table), `_kept_urls` at `:930-931`, the in-app address scrub `strict=ctx.mode == "gallery"` at `:1097`, the email scrub at `:1098`, and `_one_of(False) if gallery else _v_bool` for `taskItem.checked` at `:771`. The gallery caller is `S/template_gallery.py:324-331`:

```
324: def sanitize_body(body: Any, owner_id: str) -> dict:
328:     image proxy, so no attachment address is ever rewritten -- and gallery mode drops
329:     every image whatever its address."""
330:     return public.reduce(body, mode="gallery", owner_id=owner_id or "", note_id="",
331:                          attachment_base="", facts={}, note_links={})
```

**NODE_POLICY rows** (`NODE_POLICY` starts at `:261`):

```
272:     "taskItem": {"share": "keep", "publish": "keep", "gallery": "task"},
291:     "imageCaption": {"share": "keep", "publish": "keep", "gallery": "drop"},
292:     "linkPreview": {"share": "keep", "publish": "keep", "gallery": "keep"},   # the member's external link card
293:     "webEmbed": {"share": "keep", "publish": "keep", "gallery": "keep"},      # an allowlisted external embed
294:     "image": {"share": "image", "publish": "image", "gallery": "drop"},
295:     "imageFigure": {"share": "figure", "publish": "figure", "gallery": "drop"},
296:     "attachmentChip": {"share": "drop", "publish": "drop", "gallery": "drop"},  # file attachments never leave
```

Gallery handling of the two kept ones: `taskItem` is kept with `checked` forced to `False` (`:1093-1095`, `out["attrs"] = {**attrs, "checked": False}`); `linkPreview` is kept but its image is nulled (`:930-931`, `return {**node, "attrs": {**attrs, "image": None}}     # gallery: no image of any kind`).

**DIFFERS (names).** The plan's "linkCard" is not a node type anywhere in `app/src` or `api` (`grep -rn linkCard` over both, `.js/.jsx/.py`, finds nothing). The node is **`linkPreview`**. The plan's "figure" is not a node type either: the node is **`imageFigure`** (`J/lib/imageFigureNode.js:47`, `name: 'imageFigure'`), and `figure` is only an ACTION name in the policy value (`"share": "figure"`).

**DIFFERS (what the plan can rely on) — plan-breaking for any example note that carries an image.** In `gallery` mode `image`, `imageFigure` and `imageCaption` are all `"drop"`, and `linkPreview` loses its image. So a gallery copy of a note **cannot carry a picture of any kind through `reduce`**, whatever its address. If P3b's example notes are meant to show pictures, the existing gallery reducer will remove them; the sanitizer P3b writes needs either a new mode (which must be added to `MODES` AND to all 50 `NODE_POLICY` rows (counted by script over `:261` to the closing brace), since `policy[ctx.mode]` is a plain index and a missing column is a `KeyError`) or its own image rule, and `tests/test_public_note_payload.py` pins the table.

## V3. A pasted image's `src`, its stored file, its document id — confirmed, with one wrinkle

- `S/notes.py:5641` builds the stored `src`: `f"/api/j2/notes/attachments/{user_id}/{note_id}/{sub}/{new_id}{ext}"` (`sub` is `"hero"` or `"inline"`; `new_id` is `hashlib.sha256(data).hexdigest()[:32]`, so an identical upload lands on the same path).
- **The URL does not mirror the disk path.** The file is written at `S/notes.py:5626`: `target_dir = _ATTACHMENT_ROOT / user_id / "notes" / note_id / sub`. The URL has no `notes` segment; the disk path does. The reader reconstructs it at `S/notes.py:5764`: `rel = Path(user_id) / "notes" / note_id / sub`, served by `api/routers/journal_two.py:3962` (`@router.get("/notes/attachments/{user_id_param}/{note_id}/{sub}/{filename}")`, 403 unless `user["id"] == user_id_param`).
- `attachment_root` (`S/attachment_root.py:39-44`):
  ```
  44:     return Path(os.environ.get("DATA_DIR", "/data")) / "j2_attachments"
  ```
  after `J2_ATTACHMENT_ROOT` (`:41-43`). Reads fall back to `LEGACY_ATTACHMENT_ROOT` (`:36`, `Path(__file__).resolve().parents[3] / "data" / "j2_attachments"`) via `read_candidates_with_roots` (`:80`). `S/notes.py:119` binds it once at import: `_ATTACHMENT_ROOT = _attachment_root()`.
- `_ATTACHMENT_PREFIX` is `S/public_note_payload.py:158`: `_ATTACHMENT_PREFIX = "/api/j2/notes/attachments/"`. `reduce` rewrites this note's own prefix at `:1139`: `raw = json.dumps(doc).replace(f"{_ATTACHMENT_PREFIX}{owner_id}/{note_id}/", attachment_base)`. A gallery call passes `note_id=""` and `attachment_base=""`, which makes that replace a no-op for any real note.
- **The document id is NOT derivable from the `src`.** An image has a document row only when `NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED` is on (`S/document_extraction.py:120-128`, `image_docx_documents_enabled()` returns `flag_on(IMAGE_DOCX_GATE, False)`). The row is made at `S/document_extraction.py:1340-1345`: `create_document(user_id, note_id, url, _IMAGE_DOC_NAME, source_kind=SOURCE_KIND_IMAGE)` (`SOURCE_KIND_IMAGE = "attachment_image"` at `:63`, `_IMAGE_DOC_NAME = "Image"` at `:115`), and only for a `url` containing `/inline/`. Its id is `doc_id = uuid.uuid4().hex` (`:1082`), a random value. The lookup key is `(note_id, attachment_url)` (`UNIQUE(note_id, attachment_url)`, `S/db.py:1133`), read by `get_document_by_attachment(user_id, note_id, attachment_url)` (`S/document_extraction.py:1129`). With the flag off, a pasted image has no document id at all.

## V4. `document_text_state` / `page_transcript` for an image document — confirmed

An image document is extracted as exactly **one empty page** (`S/document_extraction.py:1213-1214`, `if kind == SOURCE_KIND_IMAGE:` then `result = ([""], 1) if probe_image(data) else None`), and OCR fills that page. So `pages_total` is 1 for an image.

`S/document_ocr.py:467` `def document_text_state(conn, user_id: str, document_id: str) -> dict[str, Any]` returns `{"exists": False}` (`:485`) for an unknown or foreign id, else (`:505-525`):

```
"exists": True, "status": doc["status"], "pages_total": total, "pages_with_text": with_text,
"pages_from_ocr": ocr_pages, "pages_awaiting_ocr": awaiting, "ocr_unavailable": bool(...),
"pages_unreadable": max(0, unreadable), "text_complete": total > 0 and with_text == total,   # :524
"ocr_jobs": jobs,                                                                              # :525
```

`S/document_ocr.py:927` `def page_transcript(user_id: str, document_id: str, page_number: int, *, conn=None) -> dict[str, Any] | None` returns `None` (`:962`) for a missing or foreign document or a trashed note, else (`:965-973`) `{"document_id", "page_number", "name", "text_origin", "text", "available": bool(text.strip())}`. `text_origin` is `"ocr"` for OCR text (`ORIGIN_OCR = "ocr"`, `:62`). A page whose OCR the usability gate rejected reports `text: ""` and `available: False`.

## V5. `trader_blocks.BLOCK_IDS` and `BUILDERS` — confirmed, with a count the plan should not assume

`S/trader_blocks.py:23`: `BLOCK_IDS = ("preEntryChecklist", "priceStamps", "positionSizing",` continuing `"myRules", "prepWire", "prepEarnings", "prepMovers", "prepLevels", "tradeReview")` — **nine ids**.

`BUILDERS` (`:136`, extended at `:158`, `:562`, `:902`) has **ten keys**, one more than `BLOCK_IDS`: the extra is `marketcontext` (`:562`: `BUILDERS["marketcontext"] = build_market_context`), which `BLOCK_IDS`'s comment at `:19-21` says is deliberately not one of the trader blocks. The prep ids come from `:638`: `PREP_BLOCK = {"wire": "prepWire", "earnings": "prepEarnings", "movers": "prepMovers", "levels": "prepLevels"}`.

Empty params per id, measured by calling each builder with `{'settings': {}}` and `ctx = {'now': ..., 'mode': 'update'}` (the `update` mode reads nothing, so these are the no-read, unstamped nodes; every node is a `widgetEmbed` with `attrs.widgetId` = the id):

| id | `attrs.params` |
|---|---|
| `preEntryChecklist` | `{'setup': '', 'includeRules': 'yes', 'requireAll': 'no', 'checked': []}` |
| `priceStamps` | `{'on': 'no'}` |
| `positionSizing` | `{'grade': 'A'}` |
| `myRules` | `{'which': 'active'}` |
| `tradeReview` | `{'tradeId': ''}` |
| `marketcontext` | `{'uncaptured': True, 'fields': 'all'}` |
| `prepWire`, `prepEarnings`, `prepMovers`, `prepLevels` | `{}` |

In `create` mode, `positionSizing` adds `regimeId`/`regimeAsOf` when the pod holds a breadth payload, and `marketcontext`, `prep*` read data under the 3.0 s budget (`PREP_CREATE_BUDGET_S`, `:36`). An example note must build them in `update` mode or it stamps today's market.

## V6. Where broker institution names are stored for a member — confirmed

`j2_broker_accounts.brokerage_name` (`S/db.py:1407`: `brokerage_name        TEXT,`), one row per `(user_id, snaptrade_account_id)` (`UNIQUE`, `:1421`). It is written from `summarize_account` (`S/broker/connections.py:170`: `institution = raw.get("institution_name") or raw.get("brokerage")`, falling back through `brokerage_authorization.brokerage.name`, `:172-177`) into `"brokerage_name": institution or meta.get("brokerage_name"),` (`:188`); written by the connect insert at `:426-436` (`INSERT INTO j2_broker_accounts`) and refreshed by the update at `:370-376` (`SET brokerage_name = ?`). A second place a name lands is the linked `j2_accounts` row's `name` (`"name": raw.get("name") or institution or "Brokerage account"`, `:192`), and `account_number_masked` is the masked tail only (`_mask_number`, `:154-164`, `••` plus the last four). There is no separate institutions table. `S/template_gallery.py` and `S/public_note_payload.py` do not read either column.

## V7. P3a's gallery service — confirmed, with a name and a `capabilities` answer

All in `S/template_gallery.py` unless noted.

- **`publish_style`** (`:894`): `def publish_style(user_id: str, style_id: Any, *, title: Any, description: Any, category: Any, trading_style: Any, conn: sqlite3.Connection | None = None) -> dict | None:`. Returns `None` when `not library_enabled()` (`:902`) or the style is not the member's. First publish makes a `pending` row; again while pending or rejected replaces it in place; again while approved holds the new version in `pending_json` (`:925`: `if existing and existing["status"] == "approved":`, then `:929` `"UPDATE j2_template_gallery SET pending_json = ?, pending_at = ?, review_note = NULL,"`). Route: `POST /styles` (`api/routers/notebook_template_gallery.py:199`).
- **Held revisions:** `pending_json` / `pending_at`; the reviewer reads one through `_pending_revision` (`:736`), which returns `{"version", "title", "description", "category", "tradingStyle", "payload"}`. `admin_act` approves it when `row["pending_json"]` is set (`:1639`).
- **DIFFERS (name): there is no `withdraw` function.** The author's take-down is **`unpublish(user_id: str, gallery_id: str, conn: sqlite3.Connection | None = None) -> bool`** (`:1008`), route `DELETE /{gallery_id}` (`api/routers/notebook_template_gallery.py:336`). It deletes the gallery row and its reports, uses, watches and helpful votes (`:1009-1012` docstring), then rings each watcher once (`:1042`, `_ring(watcher, item["title"], WITHDRAW_NOTICE.format(...), ...)`). The word "withdraw" appears only in the notice constant `WITHDRAW_NOTICE`.
- **`get_item`** (`:705`): `def get_item(viewer_id: str, gallery_id: str, *, is_admin: bool = False, conn=None) -> dict | None`. The payload is `_summary(...)` (keys: `id, title, description, category, author, firm, featured, usedBy, itemType, version, tradingStyle, trendingCount, helpfulCount, helpedByMe, authorHandle, listedAt, updatedAt, mine, preview, propertyCount`, plus `status, hidden, reviewNote, createdAt, sourceStyleId, hasRevision, revisionTitle` for the author and admins, plus `openReports` for admins) plus `bodyJson` and `propertyDefs`, and for a style item `payload` (`:722`).
- **Admin preview:** an admin reads a held revision on this same single-row read, `S/template_gallery.py:726-729`:
  ```
  726:             if is_admin:
  727:                 rev = _pending_revision(row)
  728:                 if rev is not None:
  729:                     out["pendingRevision"] = rev
  ```
  (admins only; a member, the author included, never receives it). The client is `app/src/components/admin/TemplateGalleryReviewPanel.jsx` (its `openPreview` at `:162` calls `getGalleryTemplate`). A member's Preview composes the listed `payload` through the journal styles preview door (`previewLibraryStyle`, `J/lib/styleLibrary.js:175`, which POSTs `api/routers/notebook_journal_styles.py:147` `/journal-styles/preview`).
- **`capabilities`: the list response has NO `capabilities` field today.** `api/routers/notebook_template_gallery.py:191`: `    return {"templates": items, "viewer": {"admin": _is_admin(user)}}`. `grep -n capabilities` over the router and `S/template_gallery.py` finds nothing. P3b's `exampleNotes` is therefore a NEW top-level key, not an extension of an existing one. The list response is also a recorded contract fixture (`template-gallery.list`, used by `J/components/notebook/StyleLibrary.test.jsx:21`, held current by `tests/test_notebook_contract_fixtures.py` per that file's header), so adding the key means regenerating the fixture with `tools/notebook_contract_fixtures.py`.
- The `style_payload` step runs the outline through the gallery reducer (`:827`, `"outlineBodyJson": sanitize_body(outline, user_id) if outline else None`), so a style's outline loses every image (V2).

## V8. P3a's client components — confirmed, with a DIFFERS on location and on "item page"

**DIFFERS (location).** `J/components/notebook/library/` does not exist (`ls` fails). P3a put the library UI in three places: `J/components/notebook/styles/` (the Styles manager side), `J/components/notebook/StyleLibraryCard.jsx`, and the already-lazy gallery `J/components/notebook/TemplateGallery.jsx` / `AuthorView.jsx`.

**DIFFERS (no style item page).** There is no component that is a "style item page". A style item is a card (`StyleLibraryCard`) in the gallery list and the author page; "Preview" opens the generic `TemplatePreview` sheet through `openStylePreview` (`TemplateGallery.jsx:356`, `setPreview({ ...base, body: out?.bodyJson || null })`); an author has `AuthorView`. The reviewer's surface is `TemplateGalleryReviewPanel`.

Signatures (one line each):

| Component | File:line | Props |
|---|---|---|
| `ShareStyleForm` | `J/components/notebook/styles/ShareStyleForm.jsx:50` | `export default function ShareStyleForm({ style, onShared, onClose })` |
| `StylesManager` | `J/components/notebook/styles/StylesManager.jsx:74` | `export default function StylesManager({ open, onClose, blockedNoteIds = [] })`; it renders `<ShareStyleForm style={sharing} onClose={() => setSharing(null)} ...>` at `:518` |
| `StyleLibraryCard` | `J/components/notebook/StyleLibraryCard.jsx:32` | `export default function StyleLibraryCard({ item, onPreview, onAdopted, onOpenAuthor, onMessage, busy = false })` |
| `TemplateGallery` | `J/components/notebook/TemplateGallery.jsx:266` | `export default function TemplateGallery({ onBack, onUseNow, busy = false, initialType = '', backLabel = 'Back to templates' })` |
| `GalleryCard` | `J/components/notebook/TemplateGallery.jsx:105` | `export function GalleryCard({ item, isAdmin, busy, onPreview, onUse, onChanged, onMessage })` |
| `AuthorView` | `J/components/notebook/AuthorView.jsx:15` | `export default function AuthorView({ handle, onBack, onMessage, onPreview, onAdopted, renderOutline, busy = false })` |
| `TemplatePreview` | `J/components/notebook/TemplatePreview.jsx:121` | `({ open, onClose, title, subtitle, body, onUse, busy = false, loading = false, loadError = null, showUse = true, useLabel = 'Use this template' })` |
| `LibraryUpdateSheet` | `J/components/notebook/styles/LibraryUpdateSheet.jsx:42` | `({ styleId, onClose, onApplied })` |
| `LibraryDoor` | `J/components/notebook/styles/LibraryDoor.jsx:15` | `({ label, className, disabled = false })` |

`ShareStyleForm` sends exactly `{styleId, title, description, category, tradingStyle}` (`J/lib/styleLibrary.js:123`, `shareStyle`); its header says so. The library's client helpers are in `J/lib/styleLibrary.js` (`ITEM_TYPES :21`, `TRADING_STYLES :26`, `LIBRARY_SORTS :35`, `shareStyle :123`, `adoptStyle :133`, `previewLibraryStyle :175`).

## V9. The account purge's direct and indirect tables for gallery rows — confirmed

The module is `S/account_purge.py`; the test is **`tests/test_journal_two_account_purge.py`** (the gallery case is `test_account_purge_removes_library_rows_and_keeps_copies`, `:436`). Its manifest is built generically off the live schema, so a new table with no purge entry fails `test_every_manifest_table_is_purged_and_the_control_user_is_untouched` (`:282`).

**Direct** (`_DIRECT_USER_TABLES`, deleted `WHERE user_id = ?`): `account_purge.py:161` `"j2_template_gallery",` (author column), `:162` `"j2_template_gallery_reports",`, `:163` `"j2_template_gallery_uses",` (the member's own reports and use records), `:167` `"j2_gallery_watches",`, `:171` `"j2_gallery_helpful",`, `:172` `"j2_gallery_authors",`.

**Indirect** (run first, "while the parent rows they key off of still exist", `account_purge.py:341-364`): rows OTHER members hold about the leaving author's items, joined through `j2_template_gallery`: `j2_template_gallery_reports` and `j2_template_gallery_uses` by `gallery_id IN (SELECT id FROM j2_template_gallery WHERE user_id = ?)`, `j2_gallery_watches` the same, `j2_gallery_helpful` by `item_id IN (...)`.

**Keyed by two ids** (`:376-378`): `j2_gallery_follows`, `DELETE ... WHERE follower_id = ?` plus `DELETE ... WHERE author_id = ?`.

A restore replays this through `purge_user_rows` (`account_tombstones.replay_on_db`), so a table P3b adds for example notes has to be in one of these three passes or the restore path leaves it behind. Copies other members already made are theirs and stay (the test name says so).

## V10. First-open closure on the base — MEASURED

Build: `cd app && npm run build` (exit 0, `✓ built in 37.84s`). Then, from the worktree root, `python tools/notebook_perf_budgets.py --dist app/dist`, exit 0. The raw output (`evidence/p3b-verify-20261018-0000/notebook_perf_budgets.raw.txt`), verbatim:

```
bytes.notebook_first_open: 2,260,246 B across 61 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)
VERDICT: PASS -- within every budget checked
```

**Headroom to the budget is 547 B** (2,260,793 - 2,260,246). It is the same reading P3a's arming packet records for its post-fix-round tip (`docs/notebook/p3a-arming.md:76`: "**2,260,246 B** across 61 chunks"), which is consistent: this tree is that tip. P3a's own ceiling was 2,260,316 B (`:77`); the same packet says the landing merge with master brings #373's lazy screenshot load, "about 24 KB lighter" (`:77-78`), which is measured on a different tree than this one and is not counted here. The budget file is `docs/notebook/perf-budgets.json:11` (`"max": 2260793,`, `"baseline": 2153137` at `:9`).

On this tree, **any eager change in the first-open closure costs against 547 B**; anything that lives only in the lazy gallery/styles chunks does not. P3a's own V-notes found `notebookTelemetry.js` and `notebookFlags.js` are in the closure (a new flag key or telemetry event name costs bytes); `notices.js` is not.

## What V1-V10 show is wrong in the plan

1. **Images cannot pass the gallery reducer (V2).** `image`, `imageFigure`, `imageCaption` are `"drop"` in gallery mode and `linkPreview.image` is nulled, so an example note with a picture is stripped. The plan's "pasted image" path (V3, V4) is real but is unreachable through `sanitize_body`.
2. **"linkCard" and "figure" are not node types (V2).** They are `linkPreview` and `imageFigure`.
3. **There is no `withdraw` (V7).** It is `unpublish`, `DELETE /{gallery_id}`.
4. **The list response has no `capabilities` (V7).** `exampleNotes` is a new top-level key and changes a recorded contract fixture.
5. **`J/components/notebook/library/` does not exist and there is no style item page (V8).**
6. **An image's document id is not derivable from its `src` (V3).** It exists only with `NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED` on, and is looked up by `(note_id, attachment_url)`.
7. **547 B of first-open headroom (V10).** Not a plan error, a constraint the plan has to design inside.
8. **`BUILDERS` has ten keys, `BLOCK_IDS` nine (V5).**
9. **P3a's branch tip moved to `41548ccbd1`, one docs-only commit past this base (V1).**
