# Journal A+ — P1b Trade Page + Import + Verdict Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship P1's visible wins: the unified closed-trade detail page (chart markers, executions provenance, tags, notes, screenshots, Compass post-mortem, keyboard prev/next), competitor CSV import presets with dedupe, optional time-of-day capture, the honest no-stop display contract, the pre-trade verdict embedded in Add Trade (with verdict→trade attachment), and the public /compare page + "no credits, ever" Compass badge.

**Architecture:** The Trade page is a standalone lazy route (`/journal-2-0/trade/:id`) following the existing `PositionDetailPage` pattern (App.jsx:170-173); it reads the full trade list + a new single-trade endpoint, builds its own chart markers, and hosts the new `j2_trade_attachments` side table keyed by P1a's `trade_ref` scheme. TradesTable equity rows navigate to it; the drawer remains for option rows. CSV presets extend the existing `detect_format`/`parse_with_mapping` chain; dedupe reuses the broker external_id mechanism with a `csv:` prefix.

**Tech Stack:** React (lazy routes via `lazyWithRetry`), CSS modules (camelCase, `var(--gain)/var(--loss)/var(--ut-gold)` tokens, NO emoji — UIcon/gold SVG only), SWR, FastAPI + SQLite, vitest + pytest colocated.

## Global Constraints

- **DEPENDS ON P1a** (merged first): `timeutil.py`, `trade_refs.py`, telemetry endpoint, attachments backup job, FilterSpec (for /trades pagination envelope), stamping columns.
- Isolated worktree off origin/master; never `git add -A`; `grep -c broker_sync api/main.py` ≥ 7 before push; deploys ≥4:20 PM ET.
- Serialized trade fields are camelCase and exact: `originalStop` (not stop), `mistakeTags`/`emotionTags`, net P&L convention `trade.pnlDollarNet ?? trade.pnlDollar`. `entryDate`/`exitDate` may be date-only OR full ISO — always handle both.
- Option rows in TradesTable carry strategy ids, NOT j2_trades ids — the Trade page and every new trades endpoint are equity-only; gate on `trade.isOption` in the FE.
- Blank stop is stored as `original_stop == entry_price` (deliberate sentinel; r_multiple NULL). This plan changes DISPLAY only, never storage.
- Verdict endpoint params are snake_case (`entry_price`, `stop_price`); trades endpoints are camelCase. Both gates on the verdict must be kept: FE `useIsPaid()` + BE `_require_compass_enabled`/`_reject_unified_for_per_trade`.
- Modals use the shared ModalShell.module.css pattern (backdrop/Escape/backdrop-click) — not Sheet.
- Attachment uploads: ≤5MB, MIME set `{png,jpg,jpeg,gif,webp}`, owner-checked FileResponse serving, path-traversal guard — copy calendar.py:964-982.
- New lazy routes MUST use `import lazy from './utils/lazyWithRetry'` (App.jsx:7), not React.lazy.
- AddTradeModal.test.jsx:39 asserts `payload.contextAtEntry` equals `{}` — Task 6 legitimately changes that; update the assertion in the same commit.

---

### Task 1: Single-trade endpoint with broker provenance

**Files:**
- Modify: `api/routers/journal_two.py` (new GET route near list_trades :255)
- Modify: `api/services/journal_two/trades.py` (new `get_trade_detail`)
- Test: `api/services/journal_two/test_trade_detail.py`

**Interfaces:**
- Produces: `GET /api/j2/trades/{trade_id}` → `{"trade": <_row_to_trade dict>, "tradeRef": "ext:..|id:..", "brokerActivities": [{...}] }`. 404 when not found / wrong user / (option strategy ids are simply not in j2_trades → natural 404). `brokerActivities` (source='broker' rows only): rows from `j2_broker_activities` matching the trade's symbol whose timestamp falls within `[entry_date - 1d, exit_date + 1d]`, labeled best-effort ("matched by symbol + holding window") — NOT a claim of exact fill lineage.

- [ ] **Step 1: Failing test**

```python
# api/services/journal_two/test_trade_detail.py
import sqlite3
from api.services.journal_two import db as j2db
from api.services.journal_two.trades import get_trade_detail


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,"
        " entry_price, entry_date, exit_price, exit_date, original_stop, created_at)"
        " VALUES ('t1','u1','p1','NVDA','Long',10,100,'2026-04-01T14:30:00Z',110,"
        "'2026-04-03T18:00:00Z',95,'2026-01-01')"
    )
    return conn


def test_returns_trade_and_ref():
    conn = _conn()
    out = get_trade_detail("u1", "t1", conn=conn)
    assert out["trade"]["symbol"] == "NVDA"
    assert out["tradeRef"] == "id:t1"
    assert out["brokerActivities"] == []


def test_wrong_user_is_none():
    conn = _conn()
    assert get_trade_detail("u2", "t1", conn=conn) is None
```

- [ ] **Step 2: Run to fail** — `python -m pytest api/services/journal_two/test_trade_detail.py -q` → ImportError

- [ ] **Step 3: Implement**

```python
# in api/services/journal_two/trades.py (bottom, near list_trades_for_user)
def get_trade_detail(user_id: str, trade_id: str,
                     conn: sqlite3.Connection | None = None) -> dict | None:
    from api.services.journal_two.trade_refs import trade_ref_for_row
    own = conn is None
    if own:
        conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_trades WHERE user_id = ? AND id = ?",
            (user_id, trade_id),
        ).fetchone()
        if row is None:
            return None
        trade = _row_to_trade(row)
        activities: list[dict] = []
        if ("source" in row.keys() and row["source"] == "broker"
                and trade.get("entryDate") and trade.get("exitDate")):
            lo = str(trade["entryDate"])[:10]
            hi = str(trade["exitDate"])[:10] + "~"  # '~' sorts after any ISO char
            try:
                acts = conn.execute(
                    "SELECT id, activity_type, symbol, units, price, trade_date"
                    " FROM j2_broker_activities"
                    " WHERE user_id = ? AND symbol = ? AND trade_date >= ? AND trade_date <= ?"
                    " ORDER BY trade_date ASC LIMIT 50",
                    (user_id, row["symbol"], lo, hi),
                ).fetchall()
                activities = [dict(a) for a in acts]
            except sqlite3.OperationalError:
                activities = []  # older DBs / column drift: provenance is best-effort
        return {"trade": trade, "tradeRef": trade_ref_for_row(row),
                "brokerActivities": activities}
    finally:
        if own:
            conn.close()
```

**Implementer check:** read the actual `j2_broker_activities` column names in db.py (:~460s) before writing the SELECT — the test above only covers the empty case; add one broker-row test seeding a matching activity with the real column list.

Route (place BEFORE any conflicting parametric routes; FastAPI matches in order — `/trades/import/preview` must stay reachable, so register this AFTER the import routes or use the literal-prefix rule; verify with the app's route table):

```python
@router.get("/trades/{trade_id}")
def get_trade_route(trade_id: str, user: dict = Depends(get_current_user)):
    out = trades_service.get_trade_detail(user["id"], trade_id)
    if out is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    return out
```

- [ ] **Step 4: Route-order regression test** — add to test file: import preview endpoints still resolve (FastAPI: static paths win over `{trade_id}` regardless of order in modern versions — still assert `import_preview` route exists by checking `router.routes` paths). Run full: `python -m pytest api/services/journal_two/ -q` → PASS.

- [ ] **Step 5: Commit** — `git add api/services/journal_two/trades.py api/services/journal_two/test_trade_detail.py api/routers/journal_two.py && git commit -m "feat(j2): single-trade endpoint with best-effort broker provenance"`

---

### Task 2: Trade attachments (screenshots) backend

**Files:**
- Modify: `api/services/journal_two/db.py` (append `_PHASE_2_ALTERS`)
- Create: `api/services/journal_two/trade_attachments.py`
- Modify: `api/routers/journal_two.py` (3 routes)
- Test: `api/services/journal_two/test_trade_attachments.py`

**Interfaces:**
- Schema: `CREATE TABLE IF NOT EXISTS j2_trade_attachments (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, trade_ref TEXT NOT NULL, filename TEXT NOT NULL, label TEXT, created_at TEXT NOT NULL)` + `CREATE INDEX IF NOT EXISTS idx_j2_trade_att_ref ON j2_trade_attachments(user_id, trade_ref)` (new table → goes in `_PHASE_2_ALTERS` as CREATE statements, matching how indexes are added there).
- Produces: `save_trade_attachment(user_id, trade_ref, upload) -> dict` (`{id, url, label, createdAt}`), `list_trade_attachments(user_id, trade_ref, conn=None) -> list[dict]`, `delete_trade_attachment(user_id, attachment_id) -> bool` (removes row + file), `serve_trade_attachment_path(user_id, trade_ref_dir, filename) -> Path | None`.
- Storage: `<_ATTACHMENT_ROOT>/<user_id>/trades/<ref_dir>/<uuid4hex>.<ext>` where `ref_dir = trade_ref.replace(':', '_')` (refs contain `:` — not filesystem-safe on Windows). URL: `/api/j2/trades/attachments/{user_id}/{ref_dir}/{filename}`. Validation constants copied from calendar.py:908-933 (5MB, png/jpg/jpeg/gif/webp). Routes: `POST /api/j2/trades/{trade_id}/attachments` (resolves trade → ref via `trade_ref_for_row`), `GET /api/j2/trades/attachments/{user_id}/{ref_dir}/{filename}` (owner 403, traversal guard), `DELETE /api/j2/trades/attachments/{attachment_id}`.
- **Backup coverage:** files land under `_ATTACHMENT_ROOT`, so P1a's backup job already tars them. **Ship gate:** `J2_ATTACHMENT_BACKUP_ENABLED=1` set on Railway BEFORE this ships (Task 10 checklist).

- [ ] **Step 1: Failing tests** — mirror `test_notes.py`/`test_calendar.py` attachment tests (tmp `J2_ATTACHMENT_ROOT` via monkeypatch, fake UploadFile with png bytes): save→list→url roundtrip; 6MB reject; wrong-MIME reject; delete removes row+file; `serve_trade_attachment_path` rejects `../` traversal; ref_dir sanitization (`ext:bk:abc` → `ext_bk_abc`).
- [ ] **Step 2: Run to fail**, then implement per the interface above — copy the exact validation/`write_bytes`/traversal-guard shapes from calendar.py:908-982 and the serve-route owner-403 from journal_two.py:1111-1127.
- [ ] **Step 3: Run** — `python -m pytest api/services/journal_two/test_trade_attachments.py -q` → PASS
- [ ] **Step 4: Commit** — `git add api/services/journal_two/db.py api/services/journal_two/trade_attachments.py api/services/journal_two/test_trade_attachments.py api/routers/journal_two.py && git commit -m "feat(j2): trade screenshots side table + endpoints (trade_ref keyed)"`

---

### Task 3: Trade page — route, component, chart, prev/next

**Files:**
- Create: `app/src/pages/journal-2-0/components/trade/TradeDetailPage.jsx` (+ `.module.css`, `.test.jsx`)
- Create: `app/src/pages/journal-2-0/components/trade/tradePageModel.js` (+ `.test.js`) — pure helpers
- Modify: `app/src/App.jsx` (lazy import + route `/journal-2-0/trade/:id`)
- Modify: `app/src/pages/journal-2-0/tabs/TradeJournalTab.jsx:406-409` (equity 'open' → navigate; options keep drawer)

**Interfaces:**
- Consumes: Task 1 endpoint; Task 2 attachments API; `useTradeReview(accountId)` + `TradeReviewCard` (props verified: `{review,isLoading,onFeedback,onRegenerate,onForget}`); `StockChart` props `{sym, tf, markers, priceLines, entryDate, exitDate, liveUpdates:false, showDrawingTools:false}`; `TagChipPicker {available,selected,onChange}`; `PATCH /api/j2/trades/{id}` (accepts originalStop/setup/notes/mistakeTags/emotionTags); P1a telemetry (`trade_page_open`).
- Produces: `tradePageModel.js` exports — `outcomeModel(trade)` → `{netPnl, pnlPct, r, rLabel, holdLabel, noStop}` where `noStop = trade.rMultiple == null && Number(trade.originalStop) === Number(trade.entryPrice)` and `rLabel = noStop ? 'R: — (no stop logged)' : ...`; `buildTradeMarkers(trade, tf)` → `{markers, priceLines}` for THIS trade only (entry+exit arrows, exit color by result Win/Loss/BE + entry/stop priceLines — adapt the shapes from `useJ2ChartMarkers.js:60`, which returns markers for every trade in a symbol and therefore cannot be used directly); `neighborIds(trades, filters, currentId)` → `{prevId, nextId}` using `applyFilters` from `hooks/useJ2Filters` with `filtersFromSearchParams` so the page honors the SAME URL filter params the table linked with.

**Page layout (spec §4 order — a page, not an ingredients list):**
1. Outcome header: symbol + side badge + result badge; net P&L (`pnlDollarNet ?? pnlDollar`, `money()`), P&L% (`percent()`, fraction convention), R (or the no-stop label + a gold "Add stop" inline button → number input → PATCH originalStop), hold time, exit-efficiency slot rendering `—` with title "Excursion analysis coming — computed nightly from intraday bars" (P2 fills it).
2. Chart card: `StockChart` with TF pills `5m/30m/1h/D/W` (copy PositionDetailPage TF_TABS :34-40), markers from `buildTradeMarkers`, `entryDate/exitDate` props to center the holding window, `liveUpdates={false}`. Below the chart, the excursion legend placeholder (same copy as above). Date-only trades ("no 'T'" in entryDate): default tf 'D' and show caption "daily chart — no execution times logged" + link to add times (Task 5's fields only cover NEW trades; the caption links to notes).
3. The story: setup select (settings.setups, PATCH like the table's inline tagging), `TagChipPicker` ×2 for mistakeTags/emotionTags (available from settings; PATCH on change), notes textarea (PATCH on blur), screenshots strip (Task 4 FE).
4. Executions: `<details>` collapsed — for broker trades list `brokerActivities` rows (type/units/price/date) + caption "matched by symbol + holding window — the broker record is the source of truth"; manual trades show entry/exit rows from the trade itself.
5. Compass post-mortem: paid-gated (useIsPaid) `TradeReviewCard` + generate button via `useTradeReview(accountId)` — port the block from TradeDrawer.jsx:160-204.
6. Prev/next: header ‹ › buttons + keyboard j/k + ArrowLeft/ArrowRight (copy MiniMonthNav.jsx:22-35 window-keydown pattern INCLUDING the input/textarea/contentEditable guard), Esc → `navigate(-1)`. Buttons navigate to `/journal-2-0/trade/{id}` preserving `location.search`.

- [ ] **Step 1: Write failing model tests** (`tradePageModel.test.js`): `outcomeModel` no-stop detection (stop==entry+null R → noStop true; distinct stop → false), net P&L fallback order, `neighborIds` respects filters + order and returns nulls at ends, `buildTradeMarkers` emits 2 markers with exit color by result.
- [ ] **Step 2: Run to fail** — `cd app && npx vitest run src/pages/journal-2-0/components/trade/tradePageModel.test.js`
- [ ] **Step 3: Implement `tradePageModel.js`**, run to pass.
- [ ] **Step 4: Build the page component** — data: `useSWR('/api/j2/trades/' + id)` for the detail payload + `useJ2Trades()` for neighbors + `useJ2SelectedAccount()`; fire telemetry `POST /api/j2/telemetry {event:'trade_page_open'}` once per mount (fetch, fire-and-forget). Loading: `SkeletonLine` header pattern from PositionDetailPage:166-171; missing id → styles.missing paragraph. Back link `← Trade Journal` → `/journal?j2tab=journal` + preserved search. isOption ids will 404 → render missing state (the table never links them). CSS module: copy PositionDetailPage.module.css conventions (.page/.header/.section/.sectionTitle, pos/neg via `var(--gain)/var(--loss)`).
- [ ] **Step 5: Route + table wiring** — App.jsx: `const J2TradeDetailPage = lazy(() => import('./pages/journal-2-0/components/trade/TradeDetailPage'))` + `<Route path="/journal-2-0/trade/:id" element={<J2TradeDetailPage />} />` next to :173 (FREE_PAGES already covers `/journal*` prefix — AuthGuard.jsx:86; NavBar/MoreSheet untouched, no nav item). TradeJournalTab.jsx:406-409:

```jsx
onRowAction={(action, trade) => {
  if (action !== 'open') return
  if (trade.isOption) { setDrawerTrade(trade); return }
  navigate(`/journal-2-0/trade/${trade.id}${location.search}`)
}}
```

(`useNavigate`/`useLocation` from react-router-dom; drawer stays mounted for option rows — the "quick-peek" demotion is complete when equity rows stop using it.)
- [ ] **Step 6: Component tests** (`TradeDetailPage.test.jsx`, mock fetch/SWR like PositionDetailPage.test.jsx does): renders outcome header from a fixture trade; no-stop trade shows "R: — (no stop logged)" + Add stop; excursion placeholder text present; keyboard ArrowRight navigates to nextId (mock navigate); executions collapsed by default.
- [ ] **Step 7: Run** — `npx vitest run src/pages/journal-2-0/components/trade/ && npx vitest run src/pages/journal-2-0/tabs/TradeJournalTab.test.jsx` → PASS (update the tab test for the navigate behavior). `npm run build` → success (manualChunks stays object-form — do not touch vite.config).
- [ ] **Step 8: Commit** — `git add app/src/pages/journal-2-0/components/trade/ app/src/App.jsx app/src/pages/journal-2-0/tabs/TradeJournalTab.jsx && git commit -m "feat(j2): unified closed-trade detail page (flagship, P1 scope)"`

---

### Task 4: Screenshots UI on the Trade page

**Files:**
- Create: `app/src/pages/journal-2-0/components/trade/TradeScreenshots.jsx` (+ test)
- Modify: `TradeDetailPage.jsx` (mount in the story section)

**Interfaces:** props `{tradeId, tradeRef}`; GET list via `useSWR('/api/j2/trades/attachments?...')`— no: list comes from the Task 1 detail payload? Keep independent: add `GET /api/j2/trades/{trade_id}/attachments` list route in Task 2 (returns `{attachments:[...]}`) and consume it here with SWR + mutate on upload/delete. Upload: hidden file input + drag-drop + **paste** (`onPaste` reading `e.clipboardData.files`) → `POST /api/j2/trades/{trade_id}/attachments` FormData{file}; thumbnails grid (aspect-ratio 16/9 cover) → click opens a simple lightbox (fixed overlay, Esc/backdrop close, ModalShell classes); delete ✕ per thumbnail → DELETE endpoint; errors surface inline ("Too large (max 5MB)"). Fire telemetry `screenshot_added`.

- [ ] **Step 1: Failing test** — renders empty-state copy ("Paste or drop a chart screenshot"), upload calls fetch with FormData, delete mutates list.
- [ ] **Step 2: Implement + pass** — `npx vitest run src/pages/journal-2-0/components/trade/TradeScreenshots.test.jsx`
- [ ] **Step 3: Commit** — `git add app/src/pages/journal-2-0/components/trade/ api/routers/journal_two.py && git commit -m "feat(j2): trade screenshots UI (paste/drag/lightbox)"`

---

### Task 5: Optional time-of-day on Add Trade + server ET combine

**Files:**
- Modify: `app/src/pages/journal-2-0/components/AddTradeModal.jsx` (fields :33-45, payload :121-136, date inputs :262-295)
- Modify: `api/services/journal_two/trades.py` (`_validate_manual_trade_payload` :309-331)
- Test: extend `AddTradeModal.test.jsx` + `api/services/journal_two/test_trading_day_stamping.py`

**Interfaces:**
- FE payload gains `entryTimeEt: 'HH:MM' | null`, `exitTimeEt: 'HH:MM' | null` (two optional `<input type="time">` beside the date inputs, helper text: "optional — unlocks time-of-day analytics and exit-quality tracking").
- BE contract: when `exitTimeEt`/`entryTimeEt` present, combine `date + time` as an **ET-local** datetime → convert to UTC ISO for storage (`datetime.fromisoformat(f"{d}T{t}").replace(tzinfo=ET).astimezone(UTC).isoformat()` using `timeutil.ET/UTC`); absent → existing `T00:00:00+00:00` date-only convention unchanged. `hour_et` then stamps the real ET hour via the existing Task-P1a stamping (no extra work — `compute_hour_et` sees a non-midnight timestamp).

- [ ] **Step 1: Failing BE test** — manual create with `{"exitDate":"2026-04-19","exitTimeEt":"10:30", ...}` stores exit_date `2026-04-19T14:30:00+00:00` (EDT) and stamps `hour_et == 10`, `trading_day_et == '2026-04-19'`.
- [ ] **Step 2: Implement server combine** in `_validate_manual_trade_payload` (both entry and exit; validate `HH:MM` with a regex, 400 on garbage; reject time-without-date is impossible — date always present).
- [ ] **Step 3: FE fields + payload** — two time inputs (blank default), include in onSave payload only when non-empty. Update AddTradeModal.test.jsx payload assertions.
- [ ] **Step 4: Run both** — `python -m pytest api/services/journal_two/test_trading_day_stamping.py -q` and `npx vitest run src/pages/journal-2-0/components/AddTradeModal.test.jsx` → PASS
- [ ] **Step 5: Commit** — `git add app/src/pages/journal-2-0/components/AddTradeModal.jsx app/src/pages/journal-2-0/components/AddTradeModal.test.jsx api/services/journal_two/trades.py api/services/journal_two/test_trading_day_stamping.py && git commit -m "feat(j2): optional ET time-of-day capture on manual trades"`

*(No-stop display contract: covered by Task 3's outcomeModel — storage untouched per Global Constraints. TradesTable already renders R blank when rMultiple is null; no table change needed.)*

---

### Task 6: Verdict embed in Add Trade + verdict→trade attachment

**Files:**
- Modify: `app/src/pages/journal-2-0/components/AddTradeModal.jsx` (footer)
- Modify: `app/src/pages/journal-2-0/components/AddPositionModal.jsx` (:504-531 — add the same contextAtEntry attachment)
- Test: extend both modal test files

**Interfaces:**
- Replicate AddPositionModal's footer verdict block (:504-531) into AddTradeModal: `usePreTradeVerdict(accountId)` + `<PreTradeVerdictCard verdict isLoading error />` + "Check with Compass" button, `useIsPaid()` gated. Payload (snake_case): `runVerdict({symbol, side, shares:Number(shares), entry_price:Number(entryPrice), stop_price:Number(originalStop), setup: setupVal || undefined})`. AddTradeModal's stop is OPTIONAL → button disabled without `originalStop` + hint "add a stop to check with Compass" (title attr).
- **Attachment (closes the designed-but-never-built loop):** both modals change `contextAtEntry: {}` → `contextAtEntry: verdict?.verdict_id ? { compass_verdict_id: verdict.verdict_id, compass_verdict_label: verdict.label } : {}`. The create path persists `context_at_entry` JSON verbatim (trades.py) — no schema change. AddTradeModal needs `accountId` — it currently receives only `settings/onSave/onClose/accountName`; thread `accountId` as a new prop from TradeJournalTab (which has `selectedAccountId`).
- Fire telemetry `verdict_embed_run` on each run.

- [ ] **Step 1: Failing tests** — AddTradeModal: paid user sees "Check with Compass" (mock useIsPaid true); button disabled with blank stop; after a mocked verdict run, submitted payload carries `contextAtEntry.compass_verdict_id`. Update the `:39` `contextAtEntry {}` assertion to cover both branches. AddPositionModal: same attachment assertion.
- [ ] **Step 2: Implement both modals**, run: `npx vitest run src/pages/journal-2-0/components/AddTradeModal.test.jsx src/pages/journal-2-0/components/AddPositionModal.test.jsx` → PASS
- [ ] **Step 3: Commit** — `git add app/src/pages/journal-2-0/components/AddTradeModal.jsx app/src/pages/journal-2-0/components/AddPositionModal.jsx app/src/pages/journal-2-0/components/*.test.jsx app/src/pages/journal-2-0/tabs/TradeJournalTab.jsx && git commit -m "feat(j2): pre-trade verdict embed in Add Trade + verdict->trade attachment"`

---

### Task 7: Competitor CSV presets + import dedupe

**Files:**
- Modify: `api/services/journal_two/csv_import.py` (`detect_format` :106, new `parse_tradezella`, header maps)
- Modify: `api/services/journal_two/trades.py` (`bulk_insert_trades` — CSV fingerprints) + `api/routers/journal_two.py:435-470` (confirm passes source="csv" and preview reports dupes)
- Create: `api/services/journal_two/test_csv_presets.py` + golden sample files `api/services/journal_two/csv_samples/{tradezella.csv,tradervue.csv,tradersync.csv}`
- Modify: `app/src/pages/journal-2-0/components/ImportCsvModal.jsx` (preview shows "N duplicates will be skipped"; "Switch from TradeZella/Tradervue/TraderSync" hint row on the drop step)

**Interfaces:**
- **Presets:** extend `detect_format(headers)` with `'tradezella' | 'tradervue' | 'tradersync'` signatures. **First implementation step is research:** find each product's current CSV export header row (their docs/help pages; the golden sample files encode the answer and are committed so format drift becomes a failing test, not a silent break). Each parser maps to the pre-matched trade-dict shape (camelCase, per csv_import.py:258-271), **preserving execution timestamps** when the export has them (full ISO into entryDate/exitDate — trading_day_et/hour_et then stamp real values) and mapping their strategy/setup/tag columns → `setup` (+ spill extra tags into `notes` suffix `[tags: ...]` — J2 tag libraries are per-account settings; do NOT auto-create settings entries in v1).
- **Dedupe (fixes the re-import-doubles-everything gap):** in the CONFIRM path only (preview stays write-free), before `bulk_insert_trades`, stamp each trade dict missing an `externalId` with `csv:` + the broker fingerprint recipe (sha1 of symbol|side|entryDate|exitDate|shares|entryPrice|exitPrice + per-batch ordinal — port `assign_external_ids` from broker/reconstruct.py:38-49 with prefix `csv:`). `bulk_insert_trades`' existing (user_id, external_id) skip then dedupes across re-imports automatically; return `{"imported": n, "skipped": m}` already carries the count → surface in the modal ("42 imported, 3 duplicates skipped"). Preview gains a dry-run dupe count: confirm-shape fingerprints checked against the DB (SELECT count of existing external_ids) WITHOUT writing.
- Confirm also passes `source="csv"` to bulk_insert_trades (regime stamping: current behavior stamps the batch — keep; only source=='broker' nulls regime).
- Fire telemetry `import_preset_used` (FE, on confirm success when format was a preset).

- [ ] **Step 1: Golden samples + failing tests** — commit the three sample files (5-10 rows each, real header rows, synthetic data); tests: `detect_format` recognizes each; `parse_tradezella(...)` emits valid pre-matched dicts with preserved timestamps; confirm-path double-import of the same sample yields `imported N, skipped N` on the second run.
- [ ] **Step 2: Run to fail**, implement parsers + fingerprint stamping, run to pass: `python -m pytest api/services/journal_two/test_csv_presets.py api/services/journal_two/ -q`
- [ ] **Step 3: FE hints + dupe count** — drop-step subtitle: "Exports from TradeZella, Tradervue, and TraderSync are detected automatically." Preview step renders `preview.duplicates` when > 0; confirm toast includes skipped count. `npx vitest run src/pages/journal-2-0/components/ImportCsvModal.test.jsx` (extend) → PASS
- [ ] **Step 4: Commit** — `git add api/services/journal_two/csv_import.py api/services/journal_two/csv_samples/ api/services/journal_two/test_csv_presets.py api/services/journal_two/trades.py api/routers/journal_two.py app/src/pages/journal-2-0/components/ImportCsvModal.jsx && git commit -m "feat(j2): TradeZella/Tradervue/TraderSync import presets + re-import dedupe"`

---

### Task 8: /compare page + "no credits, ever" badge

**Files:**
- Create: `app/src/pages/Compare.jsx` (+ `Compare.module.css`)
- Modify: `app/src/App.jsx` (public route block, before the AuthGuard Route at :145 — the `/terms` pattern :141)
- Modify: `app/src/pages/journal-2-0/tabs/CompassTab.jsx` (badge in header) + `app/src/pages/journal-2-0/components/CompassChat.jsx` (badge near the input)

**Interfaces:**
- Route: `<Route path="/compare" element={<Compare />} />` — public block, NOT FREE_PAGES (that's the logged-in free-tier list; leave AuthGuard/NavBar/MoreSheet untouched). Lazy via lazyWithRetry.
- Content (Landing.jsx dark/gold conventions, `track()` from `utils/landingTrack.js` for CTA clicks): hero "The journal that coaches before the trade." · comparison table — rows: AI coaching (UCT: **Unlimited — no credits, ever** / TradeZella: 500-1,000 credits/mo / TraderSync: 5-60 msgs/day by tier / Tradervue: none) · broker data (broker-mirror: "your journal is an exact mirror — we never curate") · honesty ("we label approximations and tell you when data is insufficient") · price row (competitors $288-$835/yr; UCT's current $20/mo positioning from Landing.jsx:425) · a "Why no tick replay?" section: *"coaching before the trade beats replaying after it"* + verdict screenshot placeholder · CTA → `/signup` (+ "Switch in 30 minutes — import your TradeZella history" → /signup). NO emoji anywhere; gold SVG check/cross marks.
- Badge: small `UnlimitedBadge` inline component (gold outline pill, text "Unlimited · no credits, ever") — render in CompassTab header and above CompassChat input. Keep it text+CSS (no new icon assets needed).

- [ ] **Step 1: Build page + route**, snapshot-light test (`Compare.test.jsx`: renders the table headline + no emoji regex `/[\u{1F300}-\u{1FAFF}]/u` absent).
- [ ] **Step 2: Badge into the two Compass surfaces** (pure JSX/CSS; CompassTab uses inline styles today — add the badge with module CSS to start the inline-style retirement, don't refactor the rest).
- [ ] **Step 3: Run + build** — `npx vitest run src/pages/Compare.test.jsx && npm run build` → PASS
- [ ] **Step 4: Commit** — `git add app/src/pages/Compare.jsx app/src/pages/Compare.module.css app/src/pages/Compare.test.jsx app/src/App.jsx app/src/pages/journal-2-0/tabs/CompassTab.jsx app/src/pages/journal-2-0/components/CompassChat.jsx && git commit -m "feat: public /compare page + unlimited-AI badge on Compass"`

---

### Task 9: Zero-data + broker-less walkthrough gates

- [ ] **Step 1: Broker-less WITH data** — seed a manual account (existing seeding scripts or the UI): add 3 manual trades (one date-only, one with times, one no-stop) → walk Trade page (chart, tags PATCH, screenshot upload, no-stop label + Add stop), import a TradeZella golden sample, run the verdict embed. Everything renders honest states; console clean.
- [ ] **Step 2: Fresh zero-data account** — new user, zero trades: Trade Journal empty state unchanged; `/journal-2-0/trade/garbage` renders the missing state (not a crash); /compare renders logged-out.
- [ ] **Step 3: Mobile spot-check** — `python tools/mobile_audit.py --routes /journal` **from PowerShell (NOT Git Bash — path-mangling gotcha)**; Trade page at 390px: no horizontal overflow (page is single-column sections; chart card `overflow-x` contained).
- [ ] **Step 4: Fix anything found, commit fixes individually.**

---

### Task 10: Full-suite gate + ship checklist

- [ ] **Step 1:** `python -m pytest api/services/journal_two/ -q` green (vs. baseline) · `cd app && npm test` green · `npm run build` green.
- [ ] **Step 2:** Railway env (check vars FIRST per standing feedback): set `J2_ATTACHMENT_BACKUP_ENABLED=1` on the WEB service; confirm `DATA_SYNC_*` present. Screenshots do not ship without this.
- [ ] **Step 3:** `grep -c broker_sync api/main.py` ≥ 7. Ship ≥4:20 PM ET: `git push origin <branch>:master`.
- [ ] **Step 4: Deploy verify (chunk-grep recipe):** curl `https://uctintelligence.com/` → index chunk names → grep the TradeDetailPage chunk for a unique marker (`no stop logged`) and the Compare chunk (`no credits, ever`). Cloudflare vs origin per the deploy-verify playbook.
- [ ] **Step 5: Prod smoke:** open a real closed trade's page (live Robinhood book), upload one screenshot, confirm it serves; trigger `POST /api/j2/admin/attachments-backup` (admin) once and verify the R2 object exists; run one TradeZella-sample import on a scratch account → re-import → skipped counts.
- [ ] **Step 6: Announce** — this is the "Trade pages, screenshots, and bring your TradeZella history" release (spec §9).

---

## Self-review notes (already applied)

- Spec §4 coverage: layout order ✓, P1 excursion placeholder ✓, multi-leg = explicitly out (equity-only page; option rows keep the drawer — the spec's stated interim), j/k prev/next ✓, share/trade-card PNG = P5 (spec).
- No-stop contract: display-layer only (storage sentinel preserved per code reality; spec §3 allowed "null / sentinel + display contract").
- Type consistency: `trade_ref` shapes from P1a Task 6 consumed by Task 2 storage paths (`ref_dir` sanitization documented); FilterSpec pagination envelope (P1a Task 8) is additive and useJ2Trades keeps reading `data?.trades`; `outcomeModel`'s no-stop predicate matches the trades.py:333-337 sentinel.
- Gaps deliberately deferred: import dry-run mapping-confidence UI (spec §8's full import flow) — preview+dupe-count ships now, the richer flow lands with P3's trust work.
