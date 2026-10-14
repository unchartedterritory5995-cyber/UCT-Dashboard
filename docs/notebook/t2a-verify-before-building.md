# Tier 2 part A — verify before building (V1-V14)

Plan: Notebook P2 Tier 2 part A (`/plan` from a ticker, the alert chip, the screenshot tag).
Every citation in the plan's code map is a dated claim (written at `a5b5cfffba`). This file re-reads
each one on the base and records what it found. It changes no product code.

| | |
|---|---|
| Base (`git rev-parse origin/master` at worktree creation) | `4b2e5773c19d79a13818676c192b8709454a93d0` (`fix(bar_stream): keepalive pong timeout 10 s -> 30 s`, 2026-10-14) |
| Branch / worktree | `notebook-t2a-assists` at `C:\Users\Patrick\uct-worktrees\notebook-t2a` |
| Distance from the code map | `git rev-list --count a5b5cfffba..HEAD` = 2 commits; none touches `journal_styles.py`, `trader_blocks.py`, `plan_extract.py`, `api/routers/journal_two.py`, `SlashMenu.jsx`, `Sheet.jsx` or `indicator_alerts.py` (`git log --oneline a5b5cfffba..HEAD -- <those>` printed nothing) |
| `app/node_modules` | junction to `C:\Users\Patrick\uct-worktrees\_nb-shared-install\node_modules`; 377 entries counted before it was made and again after |

## Step 2 — the base test run, and its reds

Run from `$WT/app`, one tool call each, exit code captured and exited with.

| Run | Files | Totals line | Exit |
|---|---|---|---|
| the brief's command (`doorEnumeration`, `surfaceCoverage`, `keyListenerCensus`, `reachable`, `SlashMenu.test.jsx`) | 4 ran; `SlashMenu.test.jsx` does not exist (V3), so that filter matched nothing | `Test Files  4 passed (4)` / `Tests  78 passed (78)` | 0 |
| the four real SlashMenu files (`SlashMenu.blocks`, `.chartPlan`, `.items`, `.style` `.test.jsx`) | 4 | `Test Files  4 passed (4)` / `Tests  83 passed (83)` | 0 |

**Pre-existing reds at `4b2e5773c1`: none.** `reachable.test.js` is green on this base (17 tests), so
the `focusDivergence.js` red CLAUDE.md records is not present here.

## The answers

Format: **confirmed** or **differs**, then the quoted line with `file:line`, then what a later task
needs. Paths are repo-relative; `J/` = `app/src/pages/journal-2-0`, `B/` = `J/components/notebook`.

---

### V1 — `create_styled_note`, `compose`, the context and the budget — **confirmed**

- `api/services/journal_two/journal_styles.py:830` — `def create_styled_note(user_id: str, payload: dict, conn: sqlite3.Connection | None = None) -> tuple[dict, list]:`
  Returns `(note, skipped)`. `note` is the `create_note` dict (camelCase: `bodyJson`, `propertiesJson`, `styleId`,
  `styleVersion`, `kindId`).
- `:856` — `base = {k: payload[k] for k in ("title", "subtitle", "tags", "ticker", "folderId") if k in payload}`
  These five payload keys are the ONLY ones copied; a client `bodyJson` / `properties` is dropped
  (`tests/test_journal_styles_create.py:112`).
- `:858-861` — `note = notes_service.create_note(` / `user_id, base, conn, properties=composed["properties"], captured_properties="keep",` / `style_stamp=(composed["styleId"], composed["styleVersion"], composed["kindId"]))` — one insert.
- `:739-740` — `def compose(user_id: str, style: dict, *, ticker: str | None, conn: sqlite3.Connection | None,` / `now: datetime | None = None, mode: str = "create") -> dict:`
- `:746-747` — `ctx = {"ticker": ticker, "now": now or datetime.now(timezone.utc), "memo": {}, "mode": mode,` / `"user_id": user_id}`
- `:748,751` — `if mode == "create":` ... `_tb.start_budget(ctx["memo"])` — **the budget starts in create mode only.**
- `:823` — `return {"bodyJson": doc, "properties": props, "skipped": skipped,` (+ `"styleId"`, `"styleVersion"`, `"kindId"`).
- Builders: `:688-689` — `BLOCK_BUILDERS: dict[str, Callable[[dict, dict], tuple[dict | None, str | None]]] = {` / `"chart": _build_chart, **_tb.BUILDERS}`; called at `:772` — `node, reason = builder(b, ctx)`.
- The budget: `api/services/journal_two/trader_blocks.py:34` — `PREP_CREATE_BUDGET_S = 3.0`; `:52` — `def start_budget(memo: dict) -> dict:`; `:55` — `memo.setdefault(_DEADLINE, time.monotonic() + PREP_CREATE_BUDGET_S)`; `:65` — `def _spend(memo: Any) -> None:` (raises `BudgetSpent`, `:47`).
- The route: `api/routers/journal_two.py:3586` — `if payload.get("styleId") is not None or payload.get("kindId") is not None:` ... `:3596` — `return {"note": _servable_note(n), "skippedBlocks": skipped}`.
- The member's default for a kind: `journal_styles.py:576` — `def default_style_for_kind(user_id: str, kind_id: str, conn: sqlite3.Connection | None) -> dict:`
  (member default, else the built-in, else a blank style).
- The built-in Trade plan: `:131` — `"trade_plan": {"name": "Trade plan", "version": 2, "properties": {},` with blocks
  `[_chart("D"), _blk("preEntryChecklist"), _blk("positionSizing"), _blk("marketcontext")]` (`:132`), outline
  `:134` — `_h("The setup"), _ph("marketcontext"), _p("What is the pattern, and why now?"), _ph("chart"),`.
  The first heading is "The setup"; a marketcontext placeholder follows it directly.

**For the `/plan` task (not a mismatch, a constraint):** `compose` has no hook for extra content. `_build_chart` writes
`"annotations": []` (`journal_styles.py:682`) and `build_position_sizing` writes only
`{"grade", "regimeId", "regimeAsOf"}`. Plan lines, the sizing `entry`/`stop` and the "Price when planned"
paragraph must therefore come from a new ctx key read by those builders, or a post-compose pass over
`composed["bodyJson"]` before `create_note`. `_after_first_heading(content)` (`:710`) is the existing index helper for "under the first heading".
Whichever is chosen, `payload` keys are whitelisted at `:856`, so the new inputs cannot ride the payload from the client.

### V2 — `j2_notes` columns and the sample filter — **confirmed**

- `api/services/journal_two/db.py:426` — `body_json       TEXT NOT NULL DEFAULT '{"type":"doc","content":[]}',`
- `:1933` — `"ALTER TABLE j2_notes ADD COLUMN properties_json TEXT",` (nullable)
- `:434` — `ticker          TEXT,`; `:1856` — `"ALTER TABLE j2_notes ADD COLUMN deleted_at TEXT",`; `:1871` — `"ALTER TABLE j2_notes ADD COLUMN archived_at TEXT",`; `:436` — `import_source   TEXT,`.
- `api/services/journal_two/sample_marker.py:42` — `NOT_SAMPLE_SQL = "{alias}import_source IS NOT '" + SAMPLE_SOURCE + "'"`
- `:45` — `def not_sample_sql(alias: str = "") -> str:` — `alias` is `""` or a plain identifier (`"n"`); the fragment is `n.import_source IS NOT 'sample'` (`IS NOT`, never `!=`, so a NULL `import_source` is kept).
- A working "newest live non-sample note with a ticker" read to copy: `journal_styles.py:870-872` (`latest_ticker`) — `"SELECT ticker FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL AND ticker IS NOT NULL"` ... `+ sample_marker.not_sample_sql()` ... `" ORDER BY updated_at DESC, rowid DESC LIMIT 1"`.
  Another reader also filters `n.archived_at IS NULL` (`setups_board.py:_candidate_notes`); R-T2A-1 says "live", so decide whether archived counts.
- Note-level search: `j2_notes_fts` indexes `title` and `body_plain` only (`db.py:538-541`).

### V3 — the slash menu's test file — **differs**

There is no `B/SlashMenu.test.jsx`. `B/SlashMenu.blocks.test.jsx:1` says so: `// Notebook P2a Task 12: the slash menu's P2a rail (there is no SlashMenu.test.jsx; pre-flight N6).`
The real files: `SlashMenu.blocks.test.jsx`, `SlashMenu.chartPlan.test.jsx`, `SlashMenu.items.test.jsx`, `SlashMenu.style.test.jsx`.

How they build an editor:
- `B/SlashMenu.items.test.jsx:300` — `editor = new Editor({ element: el, extensions: buildExtensions(), content })` with `import { Editor } from '@tiptap/core'` and `import { buildExtensions } from '../../lib/tiptap'`.
- `B/SlashMenu.blocks.test.jsx:248` — `ed = new Editor({ element: el, extensions: buildExtensions(),`; imports `EditorContent` from `@tiptap/react`, `render` from `@testing-library/react`.
- jsdom needs `Range.prototype.getClientRects` / `getBoundingClientRect` stubs (`SlashMenu.blocks.test.jsx:19-20`).
- A recording chain for `command({ editor, range })`: `SlashMenu.blocks.test.jsx:34` `chainOf(log)` (`focus`, `deleteRange`, `insertWidgetEmbed`, `run`).
- Flags are latched with `latchNotebookFlags({ ... })` / `__resetNotebookFlags()` from `J/lib/offline/notebookFlags`.

### V4 — `price_stamp_quote` — **confirmed** (one extra key)

- `api/services/journal_two/trader_blocks.py:433` — `def price_stamp_quote(sym: str, now: datetime | None = None) -> dict | None:`
- `:454` — `return {"price": v["price"], "changePct": v["changePct"], "source": field["source"], "asOf": field["asOf"]}`; `None` when the quote is missing.
- `asOf` is an ISO-8601 UTC string ending in `Z` (`_iso`, `trader_blocks.py:78` — `def _iso(dt: datetime) -> str:` returning `dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")`; a closed row is dated by the session close via `_epoch_iso`, `:466`).
  The ET text ("Oct 14, 10:31 AM ET") must be built by the task from this; `_et_clock(now)` gives only the time.
- `source` is `q.get("source") or ("last close" if closed else "live price")` (`:488`), so the dated line reads "live price" or "last close", and for a closed row `asOf` is that session's close, not the capture time.
- **It takes no memo and does not spend the budget.** `:447` makes one live read, `live_prices.get_live_prices(tickers=sym)`. R-T2A-2's "inside the create's read budget" needs the caller to call `trader_blocks._spend(memo)` first and treat `BudgetSpent` as "leave the line out".

### V5 — the router test harness — **confirmed** (file name differs from the glob)

There is no `tests/test_notebook_journal_styles*.py` besides `tests/test_notebook_journal_styles_router.py`, which tests the styles router only (`app.include_router(r.router)` for `api.routers.notebook_journal_styles`). Styled create is tested through the notes router in **`tests/test_journal_styles_create.py`**. Neither uses a shared fixture: each file defines its own, identically.
- `tests/test_journal_styles_create.py:16` — `def db_path(monkeypatch):` (temp sqlite file, `monkeypatch.setenv("AUTH_DB_PATH", tmp.name)`, `importlib.reload(auth_db)`, `auth_db.init_db()`).
- `:32` — `def client(db_path, monkeypatch):` — `monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")` (`:33`), `from api.routers import journal_two`, `app.include_router(journal_two.router)`, `TestClient(app)`, `c.app_ref = app`.
- `:43` — `def _as(client, uid="u1", plan="pro"):` — `client.app_ref.dependency_overrides[authmw.get_current_user] = lambda: {"id": uid, "role": "member", "plan": plan}` with `from api.middleware import auth_middleware as authmw`.
- Flag off: `monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "0")` (`:58`, `:142`) — answers `404 {"detail": "Not found"}`. Free plan: `402 "Journal styles require a paid plan"` (`:138-148`).
- A session with no plan in it: override `get_current_user` with `{"id": "u9", "role": "member"}` and `monkeypatch.setattr(authmw, "get_user_plan", lambda uid: "pro")` (`:150-157`).
- The gate itself: `api/routers/notebook_journal_styles.py:72-75` `_require_enabled()` and `journal_styles.py:31-33` `def enabled() -> bool:` → `flag_on(FLAG, False)` (default OFF).
- The conftest `tests/conftest.py` re-pins `AUTH_DB_PATH` per test (`_isolate_auth_db`), and the local `db_path` fixture overrides it after; `api/services/journal_two/conftest.py` stubs `ticker_meta.get_ticker_meta` for that directory only.

### V6 — `read_note_plan` and property-named levels — **differs**

- `api/services/journal_two/plan_extract.py:445-447` — `def read_note_plan(body_json: Any, properties_json: Any = None,` / `prop_defs: Iterable[dict[str, Any]] | None = None,` / `symbol: str | None = None) -> PlanReading:`
- `:420` — `for d in prop_defs or []:` inside `_property_levels`. **With `prop_defs=None`, a number property named "Stop" or "Entry" is silently skipped**; chart, canvas and text shapes still read. `chart_plan.py:84` passes `None, None` on purpose (`read_note_plan(block_doc(a), None, None, symbol)`).
- So **yes, property-named levels need `prop_defs`**, and the call shape in the V table (`read_note_plan(body, props, None, sym)`) drops them.
- How the styles code gets defs today: it does not. `journal_styles.py` calls `np.get_property_def(user_id, pid, conn=conn)` one id at a time (`journal_styles.py:318`, `:345`). The loader other readers use is `api/services/journal_two/note_properties.py:179` — `def list_property_defs(user_id: str, conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:` (wrapped, returning `[]` on any error, as `plan_grading._prop_defs` `:157` and `setups_board._prop_defs`). Load it ONCE per `/plan`, not per scanned note.
- Precedence: `:80` — `NOTE_SHAPES: tuple[str, ...] = ("chart", "canvas", "properties", "text")`; `:78` — `PRICE_ROLES: tuple[str, ...] = ("entry", "stop", "target")`; `:76` — `PLAN_ROLES: tuple[str, ...] = ("entry", "stop", "target", "shares")`.
- `PlanReading.value(name)` (`:178`) returns the number only for `state == "ok"`; a contradiction (two different stops) is `unreadable` and `value()` is `None`.
- **`names_any_level` (`:183`) is not "names any of the three"**: it tests `PLAN_ROLES`, which includes `shares`. A note naming only shares would stop the R-T2A-1 scan. The "stop at the first note that names any of the three" test must be `any(r.role(x).state != STATE_ABSENT for x in PRICE_ROLES)` (or `value(x) is not None`, which also skips unreadable ones; pick one and say which).
- `plan_annotation`: `:509` — `def plan_annotation(role: str, price: float, drawing: dict[str, Any] | None = None) -> dict[str, Any]:` returns `{"type": "horizontal", "role": role, "price": float(price)}` (drawing fields merged); raises `ValueError` for a non-price role.
- Read-back: `_chart_levels` (`:319`) reads `attrs.annotations` from every `widgetEmbed` whose `params.symbol` is absent or equals the symbol, so a chart written by `/plan` with `plan_annotation` lines is read as shape `chart` by the next `/plan`. It does NOT read the sizing block's `params.entry` / `params.stop`.
- Caution for the provenance and price lines: `_text_levels` reads any `<label>: <number>` paragraph whose label `classify_label` maps to a role (`:121-146`: `stop`, `target`, `entry`, `shares` words). "Price when planned: $182.40" classifies to `None` (safe). A provenance line shaped `"Entry and stop from your Oct 12 note: ..."` followed by a leading number would classify as `stop` — keep it prose with no `label: number` shape.

### V7 — the sizing block's node and `searchText` — **confirmed**

- `app/src/widgets/registry.js:886-893` — `positionSizing: blockManifest('Position sizing', [` (`:886`) with `params` keys `entry` (number), `stop` (number), `grade` (enum `A`/`A+`/`B`, default `A`), `accountSize` (number), `regimeId` (enum `green`/`amber`/`orange`/`red`), `regimeAsOf` (string).
- `:301` — `plainText: () => line,` and `:893` — `], '[position sizing]'),`: **the plain text is a constant that ignores params.** Server side, `trader_blocks._node` (`:82`) stamps `"searchText": js._BLOCK_BY_ID[block_id]["search"]` and `journal_styles.py:60` has `{"id": "positionSizing", "search": "[position sizing]", ...}`. Search reads that attr verbatim (`note_citation_text.py:116` — `"widgetEmbed": lambda a: (a.get("searchText") if isinstance(a.get("searchText"), str)`). Setting `entry` / `stop` therefore needs no `searchText` change (S20 holds: the line is the same for every params value).
- Server node attrs (`trader_blocks.py:82-91`; `:86` has `"capturedAt": _iso(ctx["now"]), "annotations": [], "caption": None,`): `{"type": "widgetEmbed", "attrs": {"v": 1, "widgetId": block_id, "embedId": uuid.uuid4().hex, "mode": "snapshot", "params": params, "capturedAt": _iso(ctx["now"]), "annotations": [], "caption": None, "layout": {"width": "full", "height": None}, "fallback": None, "searchText": ...}}`.
- `build_position_sizing` (`trader_blocks.py:106`) puts `{"grade": ..., "regimeId": ..., "regimeAsOf": ...}` in `params`; adding `entry` / `stop` numbers is within the declared schema (zero schema bump).

### V8 — the image node, `alt`, and whether note search reads it — **confirmed; the answer is "no"**

- Node type name: `image`. `J/lib/resizableImage.jsx:117` — `export const ResizableImage = Image.extend({` (TipTap's `Image`, name `image`); wired at `J/lib/tiptap.js:236` — `ResizableImage.configure({ inline: false, allowBase64: false }),`. Server schema: `api/services/journal_two/notebook_schema.py:62` — `"image": 0,`.
- Attrs: `J/lib/resizableImage.jsx:29` — `const { src, alt, width } = node.attrs` (TipTap's own `src`, `alt`, `title`, plus `width`, `align` added at `:119-132`). **`alt` is an existing attribute; setting it is not a schema change.**
- An image can also sit in an `imageFigure` (content `image imageCaption`, `J/lib/imageFigureNode.js:47`).
- **Search does not read `alt`.** `api/services/journal_two/notes.py:220` — `#   · every other leaf (image, rule, fact, noteLink, askCitation) reads as "".` and `note_citation_text.py:38` — `(`_ATOM_TEXT`); a block leaf that reads as nothing (image, rule, fact)`. Checked by running it: `extract_plain_text({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hello"}]},{"type":"image","attrs":{"src":"/x.png","alt":"NVDA daily chart"}}]})` returned `'hello'`.
- Consequence for R-T2A-8: its "Cost if wrong" clause is now a fact. A member searching notes for "daily" will NOT find a note by its screenshot's `alt`. The `alt` serves screen readers only. This is the plan's own question (V8) answered; the controller should rule whether that is acceptable or whether the tag should also write somewhere search reads (a caption via `imageFigure`, which is a text block, would be searched).

### V9 — the documents list and the page text route — **confirmed**

- `api/routers/journal_two.py:4001-4002` — `@router.get("/notes/{note_id}/documents")` / `def list_note_documents_endpoint(`; router prefix `/api/j2` (`:70`), so `GET /api/j2/notes/{note_id}/documents`. `:4078` — `return {"documents": out}`.
- Each document (`:4054-4075`): `id`, `attachmentUrl`, `name`, `status`, `pageCount`, `createdAt`, `processedAt`, `pagesTotal`, `pagesWithText`, `pagesFromOcr`, `pagesAwaitingOcr`, `ocrUnavailable`, `pagesUnreadable`, `textComplete` (`:4068` — `"textComplete": bool(st.get("text_complete")),`), `sourceKind`, `kind` (`pdf | image | docx | xlsx | web`), `capturePassages`.
- `status` values (`document_extraction.py:161-164`): `"pending"`, `"ready"`, `"processing_failed"`, `"no_text"`.
- Client hook: `J/hooks/useNoteDocuments.js:21` — `documents: data?.documents ?? [],`; it returns `{ documents, isLoading, error, refresh }` over SWR with `revalidateOnFocus: false`.
- An image attachment's URL is `/api/j2/notes/attachments/{userId}/{noteId}/inline/{hash}.{png|jpg|gif|webp}` and `B/documentKind.js` `documentKindFromHref(href)` returns `'image'` for it (`DOCUMENT_KIND_IMAGE`). `parseAttachmentHref` and `fetchDocumentRow({ href, documentId, signal })` are the existing helpers to match an `image` node's `src` to its document row.
- Page text: `:4083-4084` — `@router.get("/notes/documents/{document_id}/pages/{page_number}/text")` / `def document_page_text_endpoint(`, body `{"documentId", "pageNumber", "name", "textOrigin", "text", "available"}`.
  **It answers 404 (not an empty 200) when no page row exists yet** (`document_ocr.py:961` — `if row is None:` → `return None`), so a screenshot poll must treat 404 as "not read yet" and use `status` / `pagesWithText` from the list as the progress signal.

### V10 — any existing `Alt-Enter` binding — **confirmed: none**

`grep -rn "altKey" app/src` (non-test) and `grep -rn "Alt-Enter\|'Alt-\|\"Alt-\|Mod-Alt\|Alt+Enter" app/src` found no binding on Alt+Enter. The editor's Alt bindings are `J/lib/blockHandle.js:454` — `'Alt-Shift-ArrowUp': () => moveBlock(this.editor, -1),` (and `ArrowDown`) and `J/lib/codeBlockNode.js:217` — `'Mod-Alt-l'`. No `Alt-Enter` in `@tiptap/*`, `prosemirror-commands` or `prosemirror-keymap` under `app/node_modules` (grep returned nothing).
- Two handlers explicitly IGNORE Alt+Enter (so they cannot clash): `B/ChartPlanLevelControls.jsx:192` — `if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return` and `J/lib/blocks/priceStamps.js:51` — `if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false`.
- The chart's Alt chords are keyed on `event.code` letters, not Enter: `app/src/components/chart/keyboardShortcuts.js:409-411` — `if (event.altKey) {` / `const map = event.shiftKey ? ALT_SHIFT_TOOL : ALT_TOOL;` / `return map[event.code] || null;`, and `StockChart.jsx:8734` only matches `INDICATOR_CHORDS` with `modifier === 'alt'`. A chart embed's handler does not take `Enter`.

### V11 — `components/mobile/Sheet.jsx` — **confirmed**

- `app/src/components/mobile/Sheet.jsx:48-52` — `export default function Sheet({` / `open,` / `onClose,` / `variant = 'auto',` / `title,`; also `footer`, `children`, `dismissOnBackdrop = true`, `lockScroll = true`, `maxWidth = 520`, `ariaLabel`, `labelledByTitle = false`, `className`, `bodyClassName`, `zIndex`. `variant` is `'auto' | 'modal' | 'bottom-sheet' | 'fullscreen'`; `title` is a string or node with a sticky header and a 44 px close button.
- Focus return: `:130` — `restoreFocusRef.current = opener && opener !== document.body && !panelRef.current?.contains(opener)` (the opener is read DURING RENDER via `openerAtRender`, so a child's `autoFocus` cannot replace it); on close `:193` — `if (el && typeof el.focus === 'function') el.focus()`. So focus goes back to whatever held focus when `open` flipped true. For the chip → sheet flow that is the editor's contenteditable only if focus was still there at that render.
- It adds ONE `document` keydown listener of its own, capture phase (`:171` — `document.addEventListener('keydown', onKey, true)`), handling Escape and Tab for the topmost sheet only (`:146`). That listener is pre-existing in `Sheet.jsx`; a new sheet built on it adds none.

### V12 — `GET /api/indicator-alerts/catalog` and the create payload — **confirmed**

- `close` is an address: `api/services/indicator_alert_evaluator.py:385` — `PRICE_ADDRESSES: tuple[str, ...] = ("close",)`. Its conditions: `:756` — `"close": _OSCILLATOR_CONDITIONS,` and `:648-653` — `_OSCILLATOR_CONDITIONS` = `above`, `below`, `cross_above`, `cross_below`, each `"needs_threshold": True`. So `close` lists `below` and `above` (and the two crossings). The catalog route is `api/routers/indicator_alerts.py:135` (`@router.get("/catalog")`) → `{"catalog": alert_catalog(user_id), "refusals": ...}`; the label for `close` is `"Price (Close)"` (`indicator_alert_evaluator.py:800`).
- Payload: `api/routers/indicator_alerts.py:55-80` `class AlertCreate(BaseModel):` — `sym: str`, `indicator: str`, `condition: Optional[str] = None`, `threshold: Optional[float] = None`, `trigger_policy: Optional[str] = None`, `tf: str`, `params`, `instance_id`, `scope`. `POST /api/indicator-alerts` is `:270`. Valid `tf` keys (`:113`) — `{"1","5","15","30","60","D","W","M"}`.
- The mode: `indicator_alert_evaluator.py:141` — `ALERT_EVAL_MODE = "closed"         # "forming" | "closed"`, env override `ALERT_EVAL_MODE_ENV` (`:185`); a pod override reaches R-T2A-5's "closed-bar by default" claim.
- The creator: `app/src/hooks/useIndicatorAlerts.js:186` — `export async function createIndicatorAlert(payload) {`; resolves `{ ok: true, id }` (`:206`) or `{ ok: false, error }` (`:200`, `:213`); the error is the server's own `detail` sentence when it is a string. Never throws.
- Refusals the sheet will see as `error`: the per-member count cap (`ias.MAX_ALERTS_PER_USER`) and `ias.refusal_for(...)` shape gates, both `400` with sentences.
- The other lane (R-T2A-5 "any other verb"): `app/src/pages/terminal/alertCommand.js` `setAlert(plan, { fetcher })` with `plan = { sym, price, direction? }` posts `{ sym, target_price: price, direction }` to `/api/watchlist-alerts` and throws an `Error` with `.memberText`; `MAX_DISTANCE` is `app/src/pages/terminal/alertModel.js:7` — `export const MAX_DISTANCE = 10` and is re-exported from `alertCommand.js`.

### V13 — `editor.storage.uctJournalWidgets.notify(text, tone)` — **confirmed** (a success tone is accepted)

- `B/NoteEditorPage.jsx:2477` — `notify: (message, tone = 'error') => setUploadToast({ message, tone }),` (inside `ed.storage.uctJournalWidgets = { ... }`, assigned in `onCreate`, `:2465`).
- It renders through `Toast` (`B/NoteEditorPage.jsx:4281-4284`, `components/Toast.jsx:6` — `export default function Toast({ message, tone = 'info', onDismiss }) {`), with classes `tone_success`, `tone_error`, `tone_info` (`components/Toast.module.css:23,27,31`). The same file already raises success toasts, e.g. `:1997` — `setUploadToast({ message: 'Voice note added to this note. Undo takes it back out.', tone: 'success' })`.
- Callers use optional chaining, `editor.storage?.uctJournalWidgets?.notify?.(` (`B/SlashMenu.jsx:322`), so a missing `notify` (a read-only view, a test editor) is a no-op.
- One toast at a time, auto-dismiss at 4 s (`Toast.jsx`: "single in-flight toast, auto-dismiss 4s"): a second `notify` replaces the first.

### V14 — the first-open closure on the base — **confirmed; headroom 15,104 B**

`cd app && npm run build` (exit 0, `built in 34.24s`), then `python tools/notebook_perf_budgets.py --dist app/dist` (exit 0):
```
bytes.notebook_first_open: 2,245,689 B across 61 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)
VERDICT: PASS -- within every budget checked
```
Headroom = 2,260,793 - 2,245,689 = **15,104 B**. The plan's allowance for this work is +4,096 B, which fits with 11,008 B to spare. The budget is `docs/notebook/perf-budgets.json` → `notebook_first_open` (`roots`: `JournalLayout.jsx`, `surfaces/NotebookSurface.jsx`; `baseline` 2,153,137). The closure is already +92,552 B above its baseline, so the margin is the budget's ceiling, not the baseline.

---

## Differs, and the plan text each one changes

1. **V3.** `SlashMenu.test.jsx` does not exist. Any plan step, test list or Step-2 command naming it should name
   `SlashMenu.items.test.jsx` (item matching, `new Editor({ element, extensions: buildExtensions(), content })`) and/or
   `SlashMenu.blocks.test.jsx` (block insert with a fetch stub and `latchNotebookFlags`).
2. **V6 (call shape).** `read_note_plan(body, props, None, sym)` skips property-named levels (`plan_extract.py:420`). To honour R-T2A-1
   ("the member's own entry, stop and target") the lookup must pass `note_properties.list_property_defs(user_id, conn=conn)`,
   loaded once per `/plan`.
3. **V6 (stop test).** R-T2A-1's "stop at the first that names any of the three" is not `PlanReading.names_any_level`, which also counts `shares`
   (`plan_extract.py:183`). The scan test must be over `PRICE_ROLES`.
4. **V8 (ruling input).** Note search does not read an image's `alt`. R-T2A-8's cost clause ("a member searching notes for 'daily' finds the
   alt only if search reads it") resolves to "does not find it". The controller rules whether `alt`-only is acceptable.
