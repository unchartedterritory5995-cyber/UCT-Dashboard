# My Playbook — user-built playbook/modelbook (7th Model Book section)

**Date:** 2026-07-12 · **Status:** approved (owner) + refined via 6-agent recon/critique workflow
**Branch:** `feat/byo-playbook` (worktree from `origin/master` @ `26726c1f`)

## What it is

Every member gets their own playbook builder inside Model Book — the same creative
toolset the firm used to build its library: sections of their own design, rich
TipTap write-ups, date-framed annotated charts with entry/stop/target + grades,
and links into their Journal 2.0 Notebook. Private in v1. Product goal:
retention via user-created content ("build so you can't leave").

## Product decisions (locked with owner)

- Lives **in Model Book** as the 7th hub option (not in Journal/Notebook).
- User gets their **own mini-hub** of self-created sections (mirrors the firm's hub).
- Notebook connection = **link existing j2 notes** to entries + same TipTap editor feel.
- **Private v1**; schema stays sharing-ready but NO sharing code.

## Refinements from the critique workflow

1. **Card label: "My Playbook"** (noun, matches hub pattern; internal view key stays
   `builder`). Blurb: *"Your own setups — charted, annotated, written in your words.
   Build your book the way the firm built theirs."*
2. **7th card renders as a full-width band beneath the firm's 3×2 grid**
   (`grid-column: 1 / -1`), styled as "your bench vs the firm's gallery" — solves the
   orphan-row problem and visually separates user space from firm content. Card shows a
   live count badge when the user has content ("4 entries · 11 charts").
3. **No physical seeded rows.** Cold-start = (a) mini-hub shows *ghost suggestion
   cards* ("My Setups", "Trades That Taught Me", "Market Studies") rendered from code —
   tapping one creates that section; (b) "+ New entry" opens a **template picker**
   (mirrors `app/src/pages/journal-2-0/lib/notebookTemplates.js`): *Setup definition*,
   *Trade recipe*, *Blank*; (c) **"Add to my playbook"** button on each firm Setup
   Library detail page → creates a pre-titled, scaffolded entry (the highest-leverage
   activation feature).
4. **Drop `is_public` columns** — v2 sharing will use share tokens/slugs (community.py
   precedent); a bare boolean invites the wrong model. Adding columns later is a
   one-line entry in the ALTER list.
5. **Keep freehand annotations AND the Setup/Result flip** (result dates +
   `result_drawings_json`) — it's the firm's most impressive teaching interaction and
   the same component already handles it — but with hard server-side caps (below).
6. **Cut from v1:** custom-bars upload (admin CSV tooling for delisted tickers),
   free-hex accent colors (fixed enum rotation instead), inline image upload inside
   entries (charts ARE the images; Notebook links cover the rest), per-link CRUD
   (replace-set semantics instead), drag-reorder UI (keep `sort_order` columns).
7. **Positioning copy** (resolves Notebook overlap): *"Notebook is where you think day
   to day — your Playbook is the reference manual of setups you'd trade again."*
   Shipped in the builder empty state; note chips labeled "From my Notebook".
8. **Gating v1 = `get_current_user` only** (matches how Notebook itself is gated;
   free/trial users can build — that's the activation thesis). Hard per-user caps are
   the abuse ceiling. Future flip documented: gate WRITES with the
   `community.py:58` `is_paid_user` idiom, leave reads open ("your playbook is
   waiting" resubscribe lever).

## Data model (auth.db, j2_ idiom)

New module `api/services/user_playbook/db.py` mirroring `journal_two/db.py`:
`_UPB_SCHEMA` executescript + `_UPB_ALTERS` try/except list + `ensure_schema(conn)`,
hooked into `auth_db.init_db()` immediately after the j2 hook (auth_db.py:864-869).
IDs are TEXT uuid4 hex (j2 idiom). All tables `user_id TEXT NOT NULL` + user-scoped
indexes. Cascades DECLARED inside the upb_ family only (PRAGMA foreign_keys=ON is
already set on every auth.db connection).

```sql
upb_sections(
  id TEXT PK, user_id TEXT NOT NULL,
  title TEXT NOT NULL, blurb TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT 'gold',          -- server-validated enum: gold|green|blue|red|purple|teal
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER, updated_at INTEGER
)
upb_entries(
  id TEXT PK, user_id TEXT NOT NULL,
  section_id TEXT NOT NULL REFERENCES upb_sections(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body_json TEXT NOT NULL DEFAULT '',           -- TipTap doc JSON (validated dict, type=='doc')
  body_plain TEXT NOT NULL DEFAULT '',          -- server-extracted (reuse extract_plain_text)
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER, updated_at INTEGER
)
upb_charts(
  id TEXT PK, user_id TEXT NOT NULL,
  entry_id TEXT NOT NULL REFERENCES upb_entries(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL, timeframe TEXT NOT NULL DEFAULT 'D',   -- D|W|M
  year INTEGER,                                  -- calendar-year fallback frame when no label_date
  label_date TEXT, frame_start_date TEXT,
  result_start_date TEXT, result_end_date TEXT,  -- ISO YYYY-MM-DD, regex-validated
  entry_price REAL, stop_price REAL, target_price REAL,
  grade TEXT,                                    -- A+|A|B|C|F or NULL
  notes TEXT,
  scale_mode TEXT NOT NULL DEFAULT 'arith',      -- arith|log
  drawings_json TEXT, result_drawings_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER, updated_at INTEGER
)
upb_note_links(
  id TEXT PK, user_id TEXT NOT NULL,
  entry_id TEXT NOT NULL REFERENCES upb_entries(id) ON DELETE CASCADE,
  note_id TEXT NOT NULL,                         -- SOFT ref to j2_notes (NO FK — j2 delete won't know)
  title_snapshot TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  UNIQUE(entry_id, note_id)
)
```

Indexes: `(user_id)` on sections; `(user_id, section_id)` on entries;
`(user_id, entry_id)` on charts and note_links.

## Validation & caps (constants block at top of service — MUST ship in v1)

```
MAX_SECTIONS_PER_USER = 30        MAX_ENTRIES_PER_USER = 300
MAX_CHARTS_PER_ENTRY  = 10        MAX_NOTE_LINKS_PER_ENTRY = 10
MAX_TITLE_CHARS = 300             MAX_BLURB_CHARS = 500
MAX_BODY_JSON_BYTES = 1_000_000   # notes.py encode-and-measure idiom, after dict/type=='doc' check
MAX_DRAWINGS_BYTES = 200_000      MAX_DRAWING_OBJECTS = 200
MAX_NOTES_CHARS = 5_000           # upb_charts.notes
ACCENTS = {gold, green, blue, red, purple, teal}
GRADES = {A+, A, B, C, F}         TIMEFRAMES = {D, W, M}
_ISO_DATE = ^\d{4}-\d{2}-\d{2}$   SYMBOL = upper().strip(), ^[A-Z0-9.\-]{1,16}$
year 1900-2100
```

- `_validate_drawings(raw)`: `json.loads` → must be list → `len(list) ≤ MAX_DRAWING_OBJECTS`
  → serialized UTF-8 bytes ≤ `MAX_DRAWINGS_BYTES`. Used by EVERY drawings write.
- `_validate_body_json`: copy `journal_two/notes.py:95-110` exactly (dict, `type=='doc'`, ≤1MB).
- Row caps enforced by `COUNT(*)` preflight → 400 with a friendly message.
- Validation errors: `UpbValidationError(ValueError)` → HTTP 400 in the router
  (mirror `journal_two.py:1333-1334`).

## REST surface (`api/routers/user_playbook.py`, prefix `/api/upb`)

All endpoints `Depends(get_current_user)`; every service function takes `user_id`
first; every SQL statement includes `AND user_id = ?` (the `notes.py:216-217` idiom).
Nested mutations resolve ownership through the row's own `user_id` column (never bare id).

- `GET  /api/upb/overview` → `{sections:[{id,title,blurb,accent,sort_order,entry_count,chart_count,updated_at}], totals:{sections,entries,charts}}` (hub badge + mini-hub in one call)
- `POST /api/upb/sections` · `PUT /api/upb/sections/{id}` · `DELETE /api/upb/sections/{id}`
- `GET  /api/upb/sections/{id}/entries` → lean rows: `{id,title,snippet(body_plain≤200),chart_count,note_link_count,updated_at}`
- `POST /api/upb/sections/{id}/entries` (title + optional body_json)
- `GET  /api/upb/entries/{id}` → entry + `charts[]` + `note_links[{noteId,title,live}]`
  (liveness via one `LEFT JOIN j2_notes ON id AND user_id` — no N+1; dead links render
  as tombstone chips)
- `PUT  /api/upb/entries/{id}` — **partial patch via `model_dump(exclude_unset=True)`**
  (load-bearing: annotate-save PUTs only the drawings field; without exclude_unset it
  nulls everything else)
- `DELETE /api/upb/entries/{id}`
- `POST /api/upb/entries/{id}/charts` · `PUT /api/upb/charts/{id}` · `DELETE /api/upb/charts/{id}`
- `PUT  /api/upb/entries/{id}/note-links` — replace-set: body `{note_ids:[...]}` capped at 10;
  each id ownership-checked `SELECT 1 FROM j2_notes WHERE id=? AND user_id=?`
  (the folder-check idiom, notes.py:256-258); stores `title_snapshot` at link time
- `POST /api/upb/clone-setup` — body `{setup_name}` (must match the frontend
  `setupCatalog.js` names); finds-or-creates the user's "My Setups" section, creates an
  entry pre-titled with the setup name and a scaffold body ("When I trade this" /
  "My entry criteria" / "My mistakes" headings as TipTap JSON built server-side from
  plain heading+paragraph nodes)

Register in `api/main.py` next to the other routers.

## Frontend architecture

```
app/src/pages/modelbook/builder/
  BuilderView.jsx          # mini-hub of sections (+ ghost suggestions) → section → entry
  BuilderView.module.css
  UpbEntryPage.jsx         # entry detail: title, editor, charts, note links
  UpbRichEditor.jsx        # thin TipTap wrapper (see Editor)
  upbTemplates.js          # entry templates (mirrors notebookTemplates.js pattern)
app/src/pages/modelbook/shared/
  ChartExampleKit.jsx      # TickerSearchInput + ExampleForm + ExampleBlock, parameterized
  ChartExampleKit.module.css
```

### Hub integration (3 touches, per recon)
1. Append `{ view: 'builder', label: 'My Playbook', blurb, available: true }` to
   `MB_HUB_OPTIONS` (ModelBook.jsx:31-38). `MB_VIEW_LABELS`, `?view=builder` deep-link
   validation, gold live styling, and cascade animation all derive automatically.
2. Render branch `if (view === 'builder') return <BuilderView onExit={() => setView('hub')} />`
   inserted BEFORE the coming-soon catch-all (between ModelBook.jsx:2113 and :2116).
3. CSS: the 7th card gets `grid-column: 1 / -1` + a distinct "yours" treatment
   (full-width band beneath the firm grid). Count badge fed by `GET /api/upb/overview`
   (SWR; render nothing while null — test mock returns `{data:null}`).

### BuilderView
- Mini-hub screen reuses the hub card recipe (map with `style={{'--i': i}}`,
  hubCard/hubCardLive classes — copy the `.hubCard*` block into the builder module css).
  User sections render as live cards; below them, ghost suggestion cards (dimmed,
  "Tap to start") for up to 3 suggested section names the user hasn't created;
  plus "+ New section" (title-only inline create; accent auto-assigned round-robin;
  blurb editable later from the section header).
- Section screen: entry cards (title, snippet, chart count, updated). "+ New entry"
  opens the template picker.
- Empty state sells it: positioning copy + ghost cards + "Add to my playbook" hint
  pointing at the firm's Setups library.
- Phone: copy the years-library pattern verbatim — `useIsPhone()` + `mobileView`
  pane-switch state + '‹ Back' buttons. CSS breakpoints 640/1024 only.
- NO `useNavigate`/`Link` imports (ModelBook.test.jsx mocks react-router-dom with ONLY
  `useLocation` — the whole test file fails otherwise). `onExit` prop only.
- NO window-level key listeners (ModelBook's global keydown stays active in every view
  and intercepts arrows; scope any keyboard handling to focused containers).

### Entry page (UpbEntryPage)
- Title input + UpbRichEditor + Charted Examples column + "From my Notebook" chips row.
- Note link picker: modal listing `GET /api/j2/notes?sort=updated&q=` (render id/title/
  folder/updatedAt only). Chip href = `/journal?j2tab=notebook&note=<id>` (works under
  BOTH J2 shells; never hardcode the v5 path). Dead links → tombstone chip.
- Layout echoes the firm's Setup Library detail: write-up left, charts right (desktop);
  stacked on phone.

### Editor (UpbRichEditor)
- Imports `buildExtensions` + `extractPlainText` from `journal-2-0/lib/tiptap.js`
  (plain module, no J2 coupling — community already established the cross-import
  precedent). Do NOT mount NoteEditorPage (hard-wired to /api/j2/notes autosave).
- Re-implement only the ~80-line autosave core: **latest-callback refs re-pointed every
  render** (the `feedback_tiptap_onupdate_stale_closure` lesson — NoteEditorPage.jsx:41-47,
  135, 210-216), 800ms debounce, save-on-unmount, retry backoff.
- `useEditor` keyed on `[entry?.id]` + one-shot setContent effect wrapped in try/catch
  (NoteEditorPage.jsx:107-136,141-158 hardening).
- Keep the full `buildExtensions()` set (incl. VideoTimestamp — chips round-trip
  losslessly, clicks harmlessly no-op). SlashMenu 'Image' fires
  `uct:notebook-open-image-picker`; the builder does NOT listen → hide/omit the Image
  slash item for this surface (no inline upload in v1).
- Render read-only states with the same editor `editable={false}` (never
  `generateHTML` — if any future HTML-string render ships (v2 sharing, emails), it MUST
  route through a ported `community/lib/renderBody.js` `sanitizeNode`).

### ChartExampleKit (the crown jewel — parameterized clone of SetupsView.jsx:342-807)
- `TickerSearchInput` (150ms debounce, `/api/ticker-search?q=&limit=8`, onMouseDown
  preventDefault) — copy as-is.
- `ExampleForm`: symbol + ticker search, timeframe D/W/M, label_date (auto-fills year),
  frame_start_date, result_start/end dates, entry/stop/target, grade, scale_mode, notes.
  POST vs PUT switched on `initial?.id`.
- `ExampleBlock`: the exact StockChart prop recipe from SetupsView.jsx:752-802
  extracted into a `buildExampleChartProps(ex, {view, annotating, draft})` helper.
  Parameterized by `{endpoints, canEdit}` instead of isAdmin. v1 consumes it in the
  builder only; migrating SetupsView onto it is a follow-up (don't destabilize the
  live admin surface in this ship).
- Framing logic: no label_date → calendar-year frame from `year`; with label_date →
  start = frame_start_date || label_date−120d, end = label_date; Result view →
  result dates + `keepBarsAfterExit` + `instantFrameFlip`.
- **Load-bearing gotchas (all from recon — do not skip):**
  - `NO_PRICE_LINES` module-level stable empty array (fresh `[]` per render re-runs
    setData mid-zoom → background-chart flash).
  - `onWatermarkCommit` must be wired to a NO-OP stub — omitting it lets a stray
    watermark drag write the user's GLOBAL chart_settings.
  - `boundHrays` render-time `rightBoundTime` injection (hrays streak to the right
    edge without it).
  - Draft annotations passed as `annotations={draft}` while annotating;
    `frozen/hideCrosshair/hideLegend` flip false in annotate mode.
  - Wire `onAnnotationsMigrate` (fold into draft while annotating; PUT directly when
    viewing as owner) — legacy volume-pane re-anchoring, not optional.
  - Do NOT cargo-cult `colorByNetChange` (dead prop, zero hits in StockChart).
  - Setup candle highlight: use WHITE `#ffffff` (matches Setup Library).
  - Annotate save = partial `PUT {[activeField]: JSON.stringify(draft)}` where
    activeField = `result_drawings_json` in Result view else `drawings_json`.
- Delisted tickers: plain `/api/bars` (30-year daily window covers 2008 charts for
  still-listed names); an empty chart for a dead ticker is accepted v1 behavior.

### "Add to my playbook" (firm Setup Library integration)
One button on SetupsView's detail stage (visible to all logged-in users):
`POST /api/upb/clone-setup {setup_name}` → navigate the user to Model Book's builder
view (in-page `setView` via a callback prop or a `?view=builder` link) with the new
entry opened. Keep the touch to SetupsView minimal (one button + handler).

## Tests

- **Backend (`tests/test_user_playbook.py`):** CRUD happy paths; **cross-user 403/404**
  (user B GET/PUT/DELETE user A's section/entry/chart/link ids — the test class the
  modelbook suite structurally lacks); cascade (section delete → entries → charts/links);
  caps (row counts, body bytes, drawings bytes/objects); note-link ownership +
  liveness after note delete; clone-setup find-or-create; partial-patch semantics.
- **Frontend (`ModelBook.test.jsx` + new `BuilderView.test.jsx`):** hub renders 7th
  card (existing 'coming soon' assertions still pass — 3 dim cards remain); builder
  tests set `mockMbView='builder'` per test; SWR mock extended for `/api/upb/*` keys;
  BuilderView renders safely with null data.

## Ops riders

- Add upb row/byte counts to an existing admin status endpoint (auth.db growth is
  user-driven at blob size for the first time).
- Verify `AUTHDB_BACKUP_ENABLED=1` in Railway (module ships dark, default '0') — this
  feature grows the DB the backup job gzips.
- When the account-deletion executor ships (T1 backlog), include all four upb_ tables.

## v1 exclusions (explicit)

Sharing/community gallery (v2 = share tokens + sanitizeNode render) · j2_trades
auto-stats · Notebook-side back-links · custom-bars upload · inline image upload ·
drag reorder UI · accent color picker (enum rotation only) · Compass integration
(future: "you've traded this setup 4× — add it to your playbook").
