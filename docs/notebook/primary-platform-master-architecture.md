# UCT Notebook — Primary-Platform Master Architecture Spec

**Status:** Phase Two. Defines *how* every capability in `primary-platform-master-product-spec.md` gets built. Every design decision below either (a) extends an idiom already proven elsewhere in this codebase — cited by file — or (b) is explicitly marked as new architecture, with the alternatives considered. Nothing here invents infrastructure that already exists.

---

## 1. Governing Information Architecture

Every fact Notebook touches resolves into exactly one of three buckets:

1. **A member's own authored prose/tags/folders** — native, mutable, owned by Notebook.
2. **A link/reference to another surface's live authoritative state** — never duplicated.
3. **A frozen, timestamped, object-level-provenanced snapshot** of what another surface showed at a point in time — captured once, never silently rewritten.

This is not a new design — it is the generalization of five independently-arrived-at instances of the identical discipline already present in this codebase: chart embeds (frozen-at-insert), `j2_trades`/`j2_positions.context_at_entry` (a JSON snapshot of market context at trade entry), watchlist/scanner embeds (explicitly snapshot rather than re-run live), the `widgetEmbed` attrs bag (object-level provenance), and the entity layer's CONFIRMED/STORED/SUGGESTED split. Every architecture decision below is checked against this model before being specified, not designed fresh per capability.

---

## 2. Core Notebook Foundation

Current quality bar, verified directly, with the Stage-A build list against each:

| Element | Status | Stage-A action |
|---|---|---|
| Editor (TipTap WYSIWYG) | Genuinely rich, proven | None |
| Folders / navigation | Real, but the sidebar leaf-row bug (P0-2) | Fix (see §3) |
| Note creation | Fast | None |
| Search-as-you-type | Real, fast, correctly engineered (250ms debounce) | None |
| Autosave | Indefinite retry-with-backoff, visible status — stronger than typically credited | None (P1-10 adds a local draft safety net on top) |
| Trash / undo-delete | Absent | Build (P0-1) |
| Version history | Absent | Build (P1-6, Stage B) |
| Quick-switch / command palette | Absent | Not scheduled — real gap, no evidence yet it blocks the beachhead persona |
| Breadcrumbs | Absent | Not scheduled |
| Multi-tab / split view | Absent | Not scheduled |
| Find-in-note | Browser Ctrl+F only | Not scheduled; revisit if long-note/many-embed performance complaints surface |
| Attachments | Image-only (no generic file/PDF path) | Not scheduled for Stage A; revisit demand in Stage B |
| Export | Disk-streaming, concurrency-limited, hardened against a prior OOM incident | None — genuine strength, must not regress |

**Ranking discipline:** rank by actual beachhead-workflow frequency, not by "what a mature notebook has." Quick-switch/breadcrumbs/split-view are real gaps versus serious competitors but unproven to matter for the trader beachhead's actual daily loop (capture → write → link → retrieve) — do not build ahead of evidence.

---

## 3. Trust / Recovery Foundation

### 3.1 Trash / undo-delete (P0-1)

**Schema:** add `deleted_at TEXT` to `j2_notes`. A "Deleted notes" filtered view (`WHERE deleted_at IS NOT NULL`). Restore = `deleted_at = NULL`. Hard-purge sweep (scheduled job, 30-day retention) does the real `DELETE`, which — unchanged — fires the existing `j2_notes_fts` `AFTER DELETE` trigger correctly.
**Folder-delete interaction:** `delete_folder` already re-parents notes rather than cascading a delete (confirmed, positive finding) — preserve this; a folder delete must never bypass the trash.
**API:** `DELETE /api/j2/notes/{id}` becomes soft (sets `deleted_at`); new `POST /api/j2/notes/{id}/restore`; `GET /api/j2/notes?deleted=true` for the trash view.
**Deletion-purge interaction:** `account_purge.py`'s `j2_notes` DELETE already covers soft-deleted rows (they're still real rows with `user_id`) — no change needed there.

### 3.2 Folder-sidebar correctness (P0-2)

**Root cause:** `NotebookTab.jsx`'s `allNotes` (used to build folder leaf rows) is one global page of 100, sorted by title across the entire unfiled library — not a per-folder fetch.
**Fix:** apply the exact pattern already proven in the same file for `unfiledTotalFromServer` — a cheap `limit:1`-shaped server COUNT per folder, rather than deriving counts from the client-side page. New endpoint or query param: `GET /api/j2/notes/folder-counts` returning `{folder_id: count}` in one request (avoid N+1).

### 3.3 Version history (P1-6, Stage B)

**Schema (new):** `j2_note_versions(id, note_id, user_id, body_json, body_plain, title, subtitle, created_at)`, one row per save (or debounced — see performance note below), FK-shaped to `user_id` directly (a lesson from the account-deletion finding: **every new table in this program declares `user_id` as a real column from day one**, and is added to `account_purge._DIRECT_USER_TABLES` in the same commit that creates it — this is now a structural requirement, not a suggestion, given what happened when it wasn't).
**Write path:** on `update_note`, insert a version row before overwriting, capped (e.g., keep last 50 versions or 30 days, whichever is smaller, to bound storage growth = note-count × edit-frequency × note-size).
**Restore:** `POST /api/j2/notes/{id}/versions/{version_id}/restore` — copies the version's content back as the current row (itself creating a new version, so restore is never destructive).
**Read:** `GET /api/j2/notes/{id}/versions` for a diff-capable history view.

### 3.4 Account-deletion purge — DONE, live in production

`api/services/journal_two/account_purge.py` (merged to `master`, deployed, commit `dd66bbb59`). Purges every table in the Journal 2.0/Notebook family (direct `user_id` ownership: one DELETE each; two indirectly-owned tables — `j2_option_legs` via `strategy_id`, `j2_broker_member_stale_notify` via `broker_account_id` — via explicit join-deletes) plus the on-disk attachment tree (`attachment_root()/<user_id>`, both primary and legacy roots, covering notes and trade-screenshot attachments uniformly since both nest under one per-user directory by construction). Wired into both account-deletion endpoints in `auth.py`, ahead of the existing broker-only purge and the generic FK-discovery cascade. Full manifest: `docs/account-deletion-manifest.md`.

**Structural requirement going forward:** any new `j2_*` table MUST be added to `account_purge._DIRECT_USER_TABLES` (or, if indirectly owned, given an explicit join-delete) in the same commit that creates it. This is now enforced by convention, not by a database-level FK (SQLite `ALTER TABLE ADD FOREIGN KEY` isn't supported on existing tables without a full rebuild, which is out of this program's bounded scope) — the regression rail (`tests/test_journal_two_account_purge.py`) is schema-driven off `account_purge.py`'s own table list, so a table added to the schema but not to that list is silently missed by the test too. **Recommend a lightweight CI check** (out of this program's immediate scope, flagged for the platform team): diff `journal_two/db.py`'s table list against `account_purge._DIRECT_USER_TABLES` ∪ the documented indirect/excluded set, fail if a new table isn't accounted for either way.

### 3.5 Encryption at rest (P1-7, gated on a design spike)

**The conflict:** `j2_notes.body_plain` feeds `j2_notes_fts` directly via `AFTER INSERT/UPDATE` triggers (`db.py`). Naive column-level encryption makes the plaintext unavailable to SQLite's own FTS5 tokenizer.
**Design-spike options to evaluate (not yet decided):**
- (a) Decrypt-at-read-time server-side, keep FTS5 indexing the plaintext server-side only (never sent to a client encrypted) — simplest, but the "encrypted at rest" claim only covers the on-disk bytes, not memory; verify this still satisfies the actual trust/compliance goal before committing.
- (b) Whole-database-file encryption (SQLCipher-style) — FTS5 operates on decrypted pages in the page cache, so search keeps working unmodified; UNVERIFIED whether this codebase's current SQLite build/version supports this without a driver change. **First deliverable of the spike: answer this question.**
**Key management:** reuse the existing `crypto_box.py` (Fernet, versioned keys) pattern already proven for connector tokens — this part is not the hard part and needs no new design.

---

## 4. Entity / Mention Architecture

**Already shipped (verified, not re-designed):**
- `buzz_extract.py`'s four-tier matcher (`cashtag > alias > exact > contextual`) with curated `HOUSE_VOCAB`/`TICKER_DESPITE_LOWERCASE`/`WORD_FORMS` exception lists, corpus-derived from real usage — reused verbatim by `enrichment.py`'s `scan_notes_for_tickers()`.
- `j2_note_embeds(note_id, user_id, position, widget_id, symbol, timeframe, trade_ref, mode, captured_at)` — the stored join table, already a rebuildable projection off note bodies.
- `GET /notes/backlinks?symbol=` — the reverse-index read.

**Model: CONFIRMED / STORED / SUGGESTED, three tiers, already converged on organically — formalize as policy:**
- **CONFIRMED** — `j2_notes.ticker`, one explicit author choice per note.
- **STORED (derived-then-committed)** — `j2_note_embeds.symbol`, written when a member accepts a widget embed. De facto "confirmed by action."
- **SUGGESTED** — the mention scanner's output, offered, never auto-committed.

**Why not fully automatic:** recall-over-precision is correct for `/buzz` (a public board — a missed mention costs nothing, a false one is cheap noise); wrong once a tag is auto-committed to a personal note (a missed suggestion costs nothing, a wrong confirmed tag is a small but real annoyance). Confirmed/hybrid for anything persisted; suggested/recall-biased for the detection pass feeding it.

**Storage model: stored join, never a graph.** A live-rescanned index would drift under universe churn (delistings, renames, reused tickers — UCT's own Model Book feature independently hit this exact problem for SQ→Block, WTW→Willis Towers Watson). A committed join is temporally stable by construction. Reprocessing is already bounded (`_SCAN_MAX_NOTES = 20_000`, honest `truncated` flag) and off the event loop (sync route, thread-pool-offloaded).

**Remaining build (P0-3):**
- **Sector/industry/earnings-window join:** read-time join of `j2_note_embeds.symbol ∪ j2_notes.ticker` against the existing 24h ticker-metadata cache (`ticker_meta`/`catalyst/ticker_metadata.py`) — **never a fresh `yfinance` call per ticker per note**, matching the codebase's own launch-hardening discipline against unbounded per-request external calls.
- **Theme-membership join:** the same P0 item, widened at near-zero incremental cost, joining `themes_taxonomy.json`'s existing curated theme data.
- **Persist SUGGESTED mentions:** a lightweight `source='mention'` row (sibling table or a flag on the existing embed-shaped table) written whenever a note is saved, independent of whether the member ever opens the chart-embed offer — closes the "three paragraphs about NVDA with no embed gets zero backlink coverage" gap.
- **Class-share cashtag fix:** `buzz_extract._CASHTAG` accepts a dot separator only; add hyphen as an equivalent, canonicalize on read against whichever convention the join target (`cap_universe.json`, hyphenated) expects — mirror `massive.to_polygon_symbol()`'s existing normalization-at-one-boundary pattern.

**Explicitly out of scope:** foreign listings, options symbols, private companies/sectors as linkable entities (no unambiguous lexical signal exists — a strictly harder NLP problem). **Untested risk to close before Stage B:** the false-positive suite proves precision for swing-trading vocabulary only; run it against fundamental-analyst register (ROIC/EBIT/FCF/WACC/CAGR/DCF) before broadening this persona's reliance on it.

---

## 5. Temporal Content Contract

Every financial content type declares one of four states:

| State | Meaning | Applies to |
|---|---|---|
| **LIVE** | Ambient only, never persisted as a Notebook object | Current quotes shown in-app (nothing to capture — captured content becomes SNAPSHOT or LIVE+SNAPSHOT by definition) |
| **SNAPSHOT** | Frozen payload at capture time, explicit "as of" stamp, never re-fetched | Reported financials/fundamentals, watchlist/scanner results (full-list freeze — re-running would silently change which tickers even appear), analyst estimates/ratings (new capture path, P0-4) |
| **LIVE + ORIGINAL SNAPSHOT** | A frozen anchor with an explicit, visually distinct live-refresh opt-in | Charts (frozen anchor date + optional live toggle, capped 3/note; per-timeframe reconstruction ceiling — intraday timeframes past a fetch ceiling are genuinely frozen, daily+ legitimately re-fetch by design) |
| **REFERENCE-ONLY** | Re-fetches by a date parameter — correct only when the underlying source has a genuine point-in-time query | Calendar embeds reviewing a **past** day |

**Governing test, applied to every future content type before it's built:** a block is safe to re-fetch live only when the underlying source has a genuine point-in-time query (a date parameter that answers historically) — not merely because the source still exists. Watchlist/scanner/themes/breadth/news/aisearch/profile all fail this test and are correctly SNAPSHOT for exactly that reason.

**Known live bug to fix (bundled into P0-4):** the Calendar embed's `reconstructable: true` is unconditional — correct for REFERENCE-ONLY (backward-looking review) but currently misapplied to the LIVE+ORIGINAL-SNAPSHOT case (a note captured *before* an event resolves). Fix: gate `reconstructable` on whether the captured date is in the future relative to `capturedAt`; a forward-looking capture falls back to a payload freeze of the day's row, matching every other widget's default.

**The append-only fact ledger (shared prerequisite for P0-4's revision-indicator fast-follow and P1-2/P1-3):** `(ticker, metric, value, observed_at, source)`, populated whenever a SNAPSHOT-typed capture happens. Not needed to stop embeds from re-fetching (the per-embed frozen payload already does that) — needed specifically to answer "what changed since I captured this" as a queryable diff, which the thesis changelog (P1-3) and the revision-count UI both need.

---

## 6. Provenance Contract

**Granularity: object-level, on the mechanism that inserts content — not block-level prose tagging, not citation-level inline markup, not a single note-level field.** Already the house idiom, three independent instances:
1. `j2_note_embeds`/`widgetEmbed` attrs — `mode` (`'snapshot'|'live'`), `captured_at`, `caption` (free text, explicitly the member's own words) vs. everything else (system-captured).
2. `j2_chat_messages.role` (`CHECK IN ('user','assistant','tool','summary')`).
3. `modelbook_catalysts.source` (`'ai'|'manual'`).
4. Note-level: `j2_notes.import_source`/`import_key`/`import_hash`/`imported_at` — already exists for imported content.

**Extension needed (small, not a new system):**
- **Quoted external excerpt:** a `quote`/`externalExcerpt` TipTap mark or node, structurally identical to `widgetEmbed`, carrying `{sourceUrl, sourceTitle, capturedAt}` — stamped automatically by a future capture mechanism that knows a source URL (the bookmarklet Experiment, §8 of the product spec), never a manual "tag this" button. Until that capture mechanism exists, this stays documented, not built.
- **AI synthesis:** stamped for free the moment Ask My Notebook lets a member insert an answer into a note — a node attrs bag (`{aiOrigin: {model, sourceNoteIds, insertedAt}}`), mirroring `widgetEmbed`'s shape. Build as part of that feature, not a separate project.

**Rejected:** citation-level inline markup in the note body (fights the "quick jot" UX principle, no existing infra, Business-tier-only in the one competitor that ships it). Citations belong inside an *Ask My Notebook answer itself* — an answer-rendering concern (see §8), not a note-editing one.

**Broken source URLs:** no active link-checking (no evidence any research pass asked for it); the stored `sourceTitle` text must render even if the URL later 404s, so the excerpt stays legible without its live link.

---

## 7. Search Architecture

**Current state, verified:** `j2_notes_fts` is a standalone (non-external-content) FTS5 virtual table, porter-stemmed prefix matching, **one global table shared by every user's notes**, `user_id` stored `UNINDEXED`. Query-time scoping is correct (`MATCH` narrows via FTS5's inverted index first, `user_id` predicate filters after) — but this means **search latency for one member's query is a function of platform-wide notes matching that term, not that member's own library size.** Tag/ticker exact-match already work. No date-range filter, no fuzzy/typo tolerance, no OCR/attachment-content search, `snippet()`/`highlight()` unused anywhere (free, currently-unclaimed).

**Evolution strategy — ordered stages, not one oversized build:**

| Stage | Work | Gated on |
|---|---|---|
| 0 | Benchmark read-path latency at 5k/20k/100k *global* (platform-wide, not per-user) rows; add date-range filter; wire `snippet()`/`highlight()` | Nothing — do first, cheap |
| 1 | Entity-anchored retrieval riding the entity layer (§4) — ticker/sector/earnings-window/date without vectors | Entity layer (P0-3) |
| 2 | Ask Current Note (P0-5) | Nothing new |
| 3 | Ask Notebook (P1-2), lexical+entity basis only | Stage 1 + fact ledger |
| 4 | Semantic/vector layer, additive only, never silently replacing lexical | Usage telemetry showing lexical+entity actually fails a measurable fraction of real queries (specifically: cross-thematic queries with no shared vocabulary or named entity) |
| 5 | Fuzzy/typo tolerance, OCR/attachment-content indexing | Usage data specifically implicating these as a retention risk |

**Entity metadata + existing FTS5 most likely solves the majority of real trader retrieval jobs — vectors are the last stage, not the second**, per Phase One's search-strategy finding.

---

## 8. AI Architecture — three levels, explicit design

### 8.1 Ask Current Note (P0-5)

**Tenant isolation:** none needed beyond the existing `get_note(user_id, note_id)` ownership check (`WHERE id = ? AND user_id = ?`) — no cross-row retrieval, structurally no leak surface.
**Pattern:** copy `ai_search_personal.py`'s `assemble() → SYNTH_SYSTEM() → synthesize()` shape verbatim (private context assembly → grounded synthesis prompt → stream). **Do not copy the Freshness Firewall clause** ("the LIVE DESK figures are authoritative — never override a live number with a stale personal one") — Notebook needs the opposite contract: a note's stated fact is a historical claim that must never be silently corrected by newer data.
**Cost/latency:** reuse `ai_search_personal.py`'s `reserve_synth`/`refund_synth` pattern (atomic per-user daily cap + global hard cap, reserved before the call, refunded on failure, durable ledger surviving a redeploy).
**Observability:** log query text, note id, model, latency, cost — never note *content* to any external log/call, mirroring the existing stated invariant.

### 8.2 Ask Notebook (P1-2, Stage B)

**Tenant isolation — the load-bearing design decision:** candidates must be selected by `user_id` **before** any similarity computation ever runs, never filtered from a shared ranked list afterward. **Never reuse `brain_kb_service.py`'s pattern** (a single shared in-memory matrix, `search()` confirmed to take no `user_id` parameter at all — independently re-verified this session) — that shape is fine for a firm-wide KB with no user boundary and is exactly wrong for personal notes.
Two safe alternatives, prefer (a): (a) build the candidate matrix from a `WHERE user_id = ?` row fetch at query time — feasible at realistic per-user note counts (hundreds to low thousands), never load another user's vectors into process memory at all; (b) a metadata-filtered vector store with `user_id` as a mandatory (never post-hoc) filter predicate.
**Deletion propagation:** DELETE can be a synchronous DB trigger (no external call needed) — mirror the existing `j2_notes_fts` `AFTER DELETE` trigger exactly. INSERT/UPDATE (embedding calls) cannot run inside a trigger — needs an async reindex queue.
**Edit/reindex correctness:** reuse `brain_kb_service.reindex()`'s incremental content-hash pattern verbatim (skip unchanged, re-embed changed, delete removed), scoped to `user_id`.
**Citations:** use FTS5's own `snippet()`/`highlight()` for the matched span — confirmed unused anywhere in this codebase today, strictly better than `brain_kb_service`'s flat 900-char-excerpt pattern.
**Single-process operational constraint (new, not in Phase Zero/One):** "per-user-keyed" must not silently become "every active user's matrix held resident in the one shared process." At even modest scale (100 concurrent active users × 1,000 notes × a 1536-dim float32 embedding) this is several hundred MB of shared-process heap before any other overhead, scaling with concurrent *active* users, not total users. **Design constraint, stated up front:** LRU-evict or load-on-demand per user — never "hold everyone's matrix."

### 8.3 Ask Notebook + UCT (Experiment, legally gated)

Mixing personal notes with FMP/Massive-sourced content in one synthesized answer puts the AI_RETRIEVAL_ALLOWED boundary directly on the critical path. **Not scheduled until the external legal/data-rights review resolves** — this is a gating fact, not a priority ranking.

### 8.4 Cross-cutting architectural constraint — Compass integration (all three levels)

Compass already ships Pre-Trade Verdict, Per-Trade Post-Mortem, discipline scoring, tilt intervention — 28+ tools across voice and text. A second, disconnected AI surface risks a member facing three uncoordinated systems answering "should I trust this trade" (Ask My Notebook, Compass, a hypothetical Trading-Journal review). **Mitigation, required, not optional:** expose note retrieval as tools inside Compass's existing registry (`voice_tool_impls.py`/`coach_chat_tools.py`), mirroring the already-proven `brain_service` facade pattern used for the brain-pack bridge — a different pair of surfaces solving the identical reconciliation problem, already shipped, directly reusable.

### 8.5 Citation-verification UI (cross-cutting requirement)

Given this codebase's own §11 principle ("an unexplained 'AI match' reads as untrustworthy magic") and the Notion-Research-Mode citation bar it's benchmarked against, citation verification needs its own explicit, independently testable acceptance criterion — a click-a-citation-jump-to-source affordance — not an implicit property of "grounded/cited." Ship this as its own sub-deliverable of Ask My Notebook, at whichever level it first ships.

---

## 9. Save-to-Notebook Architecture

**Already the correct architecture, ratify rather than redesign:** common content envelope (`buildWidgetEmbedAttrs()` — `{v, widgetId, params, capturedAt, mode, annotations, searchText}`) + thin per-widget adapters (`sendCaptureToJournal()`, called identically by all 9 widget doors) + a destination registry (`CAPTURE_TARGETS` — `note`/`newNote`/`inbox`/`copyChartLink`, fully built and tested).

**The one real gap:** the destination registry's `targetsFor()` has zero callers outside its own test. **Fix:** wire it onto the 9 existing capture buttons as an optional picker (default stays one-click Quick Save — never force a modal on the common path). Add a comment/annotation field to the envelope. Complete the `tradeRef` attribute's wiring (schema-ready — `notes.py`/`widgetEmbedCore.js` both accept it — confirm whether any current frontend writer populates it; if not, wire `TradeDrawer`/`AddPositionModal` to set it).

**Future capture sources (Stage B+):** filings, transcript excerpts, news, screener/scanner results (currently NOT among the 9 confirmed capture-door widgets, despite being used as the flagship trading-journal-moat example — wire this door explicitly, don't assume it exists). Each new source is a thin adapter into the same envelope — no architectural change needed.

---

## 10. Targeted Financial Capture (Experiment, bookmarklet-first)

**Not a general clipper.** Destination plumbing already exists and is source-agnostic: `POST /api/j2/inbox` accepts an arbitrary `widgetId` + `params` + `searchText` + `fallbackUrl` — architecturally identical to how Notion's/Evernote's own clippers work (same-origin session auth, no separate API-key flow). Ticker-tagging-from-free-text reuses `/buzz`'s already-curated extractor (§4). EDGAR filings are already a first-class UCT object (`api/routers/filings.py`).

**Validation-first build:** a bookmarklet (zero manifest, zero store review) capturing page URL + selected text + a guessed ticker into the existing inbox endpoint. Only after real usage signal (20+ members, repeat use within 30 days) does a maintained browser extension become worth its ongoing Manifest V3/cross-browser maintenance cost.

---

## 11. Trading Journal Integration Design

**Rejected: a new Trading Journal object model inside Notebook.** A complete, superior analog already ships:

| Proposed Notebook-owned piece | Existing production equivalent |
|---|---|
| Position (derived) | `j2_positions`, broker-synced via SnapTrade, holdings-as-truth reconciliation |
| Entry/Exit records | `j2_trades`, FIFO-reconstructed |
| Catalyst/mistake tags | `setup`/`mistake_tags`/`emotion_tags` on `j2_trades` |
| Chart snapshots | Already embeds in `TradeDrawer` with entry/exit/stop/target lines |
| Post-exit Review note | `j2_trade_reviews` — AI-written, idempotent, cited |
| Trade-time rationale | `j2_verdicts` — structured GO/HOLD/SKIP/entry/stop/target/factors/paragraph |
| Discipline/rule-break detection | `j2_interventions` — 4 live cooldown-gated tilt rules |

`j2_notes` and `j2_trades`/`j2_positions` are **structurally separate schemas with no foreign key between them** — this is a real linking decision, not a "same thing, question moot" case.

**Architecture: a thin link layer.** A `trade_ref`/`position_ref` pointer on a note (or its structured properties, §12) resolving to a real `j2_trades.id`/`j2_positions.id`. Cross-navigation UI both directions. The only genuinely missing piece with no existing analog: a Thesis note authored *before* a trade opens, referenced by the trade at entry time — build only that.

**Cross-reference to §8.4:** the "Review note" ask is very likely already satisfied by `j2_trade_reviews`' existing AI post-mortem — confirm this before building anything new here, and if a gap remains, extend Compass's existing output rather than building a parallel Notebook-side review mechanism.

---

## 12. Thesis Model

**Rejected: a new first-class `j2_theses` table** — would contradict the Core UX principle that every structural concept is opt-in scaffolding on a plain note, never a mandatory form.

**Architecture: note + tag + read-time diff view.**
- Classification: a `tags` entry (`"thesis"`), reusing the exact convention already shipped for `quote` (`SaveQuoteButton` tags notes `["quote"]`) — no new mechanism.
- Substantive fields (assumptions, evidence, opposing evidence, catalysts, risks, invalidation conditions): ordinary TipTap body content, optionally templated via the already-shipped 8 trader templates.
- Structured rationale: **cite `j2_verdicts` as an evidence source** (Compass's Pre-Trade Verdict output — regime, setup, entry/stop/target, factors, paragraph, already tool-sourced and timestamped) rather than re-deriving the same kind of judgment independently inside Notebook.
- "What changed since I last opened this": a read-time diff query against the append-only fact ledger (§5) — no new storage, a query over existing snapshot rows.
- AI analysis over theses: a `tags`-filtered slice of the same Ask My Notebook retrieval index (§8.2), not a second pipeline.

---

## 13. Per-Ticker Research Surface

**Verified: no dedicated per-ticker/company page exists anywhere in UCT today** (checked, not assumed). The closest surfaces are contextual modals: `TickerPopup` (5-tab chart modal, reused across 12+ components), `EarningsResearchModal`, `ModelBook` (curated, historical, admin-authored).

**Architecture:** a Notebook-side dynamic reverse-index query view — architecturally identical to the existing `SavedScreensPanel` → `ScanResults`/`CoverageLine` pattern (a view over rows, never a stored per-scan/per-ticker object). Filters `j2_notes`/`j2_note_embeds` by `ticker`/`symbol`, plus the entity/theme joins from §4. **Launches INTO existing modals for live content** (`TickerPopup`/`EarningsResearchModal`) rather than re-fetching/re-rendering fundamentals or chart data natively inside Notebook — the same discipline already applied to individual embeds (§5), extended to a Notebook-native aggregation view.

**If a real company page is ever built** (a separate initiative, out of this program's scope): the correct relationship is Company Page → embeds a "notes about this ticker" panel sourced FROM Notebook's reverse-index — never the reverse. Notebook's honest promise stays "everything *I've written or saved*," not "everything about NVDA" generally — that job belongs to whichever surface owns live ticker data.

---

## 14. UCT Surface Ownership Map

**Governing rule:** *a capability's live, writeable, authoritative state belongs to exactly one surface — the one whose backend owns the write path and freshness/recompute logic. Every other surface may only (1) link/embed back to the owning surface, or (2) capture a frozen, timestamped snapshot. No second surface may re-implement the owning surface's computation or storage of the same fact.*

Before adding any capability to Notebook: **"Does Notebook already own the freshest, most authoritative write path for this data?"** If no — link or snapshot only. If yes — it's native (applies only to a note's own authored prose, tags, folders, and personal thesis reasoning).

| Surface | Owns natively | Notebook may only... |
|---|---|---|
| **NOTEBOOK** | Note prose/body, personal tags/folders, authored thesis text, frozen snapshots captured from elsewhere | — |
| **TERMINAL** (`/calendar`) | Earnings/calendar data, per-ticker earnings depth | Link/embed a frozen snapshot (existing capture door) |
| **SCREENER/SCANNER** | Scan definitions, live evaluation, coverage semantics | Embed a frozen result snapshot; never re-run a scan live inside an old note |
| **COMPANY PAGE** | Doesn't exist today (verified) | N/A until built; if built, Notebook feeds it, never the reverse |
| **PORTFOLIO** | Current holdings/broker truth | Reference by id + a live embed/link; never a second "position" row |
| **TRADING JOURNAL** (Journal 2.0 + Compass) | Trades, P&L, broker-synced state, AI coaching/verdicts/reviews/interventions | Link a thesis note to a trade/position by id; never re-implement any part of it — the load-bearing case for the whole rule |

---

## 15. Performance / Scale

**Verified strengths (do not regress):** honest pagination/counting (`LIMIT`/`OFFSET`, true `SELECT COUNT(*)`, never derived from a loaded page — `tag_counts` was explicitly fixed for this exact bug once already). Export streams to disk with bounded peak memory + a platform-wide concurrency-of-1 semaphore + lease/sweep logic, built specifically after a prior OOM incident. The enrichment-scan endpoint is a correctly sync (thread-pool-offloaded) route with an honest `truncated: true` contract at 20,000 notes.

**Thresholds, sharper than "at scale" (concrete, not vague):**
- **Folder-sidebar bug (§3.2):** trigger axis is per-folder, not per-library — realistically member-visible at the **1,000-note tier** for a trader with one running catch-all folder, not only at 50,000+.
- **FTS5 read cost:** function of **platform-wide** notes matching a search term (the global shared table + `UNINDEXED` post-filter), not per-user note count — a different risk axis than the per-user tiers a naive read might assume. Verified as a mechanism; the actual latency number is not yet measured (Stage 0 of §7).
- **Export's unbounded `fetchall()`:** real, but already the sole thing standing behind a hardened, disk-streaming, concurrency-limited pipeline — bites only at the 50,000+-notes-for-one-user tier. Lower urgency than the two above.

**New finding, no prior mention:** Notebook schema initialization runs synchronously inside the app's async `lifespan()` on the single shared event loop. Today idempotent and already-run (no live risk) — but the **next** Notebook schema/index migration requiring a full FTS rebuild would block the entire event loop for every user, including health checks, for as long as the rebuild takes, and the blast radius grows with total platform notes at whatever future date it ships. **Requirement for every future migration touching `j2_notes_fts` at scale: run as a background job**, matching the pattern this codebase already uses elsewhere (brain-pack reindexing), never inline in `lifespan()`.

**Note-count tiers (per-user), integrating the above:**

| Tier | Folder-sidebar | Export `fetchall()` | FTS5 read cost |
|---|---|---|---|
| 100 | Invisible | Trivial | Governed by platform-wide term frequency at every tier |
| 1,000 | **Visible now** if one folder > 100 | Trivial | " |
| 10,000 | Visible for any organized user | Real but single-flight, gated | " |
| 50,000+ | Visible | Meaningful single memory spike, correctly scoped | " |
| 100,000 | Visible | Same shape, more extreme; no per-account cap exists | " |

**Platform-wide axis (orthogonal, arguably more important):** media/attachment storage and the global FTS index scale with aggregate platform activity, not any one user's tier. Production anchor: 78.42GB volume, 63.57GB free, attachments currently negligible (~6MB total) — non-issue today, becomes real only if attachment adoption grows substantially platform-wide. The volume is shared with 20+ other SQLite DBs on a single-replica pod, not budgeted separately for Notebook.

**Ask Notebook's specific constraint:** see §8.2 — per-user-keyed embedding matrices must be LRU-evicted/load-on-demand, scoped to concurrently *active* users, never held resident for every user simultaneously.

---

## 16. Offline Strategy

**Full offline editing: lean toward Do-Not-Build, sharper than "P1/P2 pending validation."** UCT is a live, streaming, always-on-connectivity product by architecture (SSE prices, WebSocket bars, a regime engine) — roughly 90% of what makes UCT UCT is useless offline regardless of what Notebook does, a structurally different starting point from Obsidian's writers-on-a-train audience. Stays Experiment/Validate-First, revisit only with real evidence a serious fraction of the beachhead persona needs it.

**What actually ships (P1-9, P1-10):**
- **Read-only offline cache of recently-viewed notes** — a lightweight PWA cache-first GET for already-viewed note bodies. No conflict resolution needed (read-only). Use case: checking a thesis note pre-market on a spotty connection.
- **Local draft safety net** — periodic localStorage/IndexedDB snapshot of in-progress editor content, restored on reload if the last autosave never landed. Near-free, closes the one real gap the current retry-with-backoff design leaves open (closed tab/crash during a pending save).

**Trust answer for Obsidian switchers specifically: lead with the already-shipped, verified round-trip export, not offline.** Export is done and proven; offline is unbuilt and a structurally weaker fit for this product than for a pure-local tool.

---

## 17. Collaboration Strategy

**Current state:** one read-only, sanitized, flag-gated (default OFF) public share link. No comments, mentions, multiplayer, guest permissions, team workspace concept anywhere.

**Segmented need:** individual trader — none beyond current. Independent analyst — minimal (the existing read-only link, once the data-rights review resolves, covers occasional one-way sharing). Portfolio manager — thin (external LP sharing is a broadcast use case the link already covers; internal back-and-forth would want comments, not clearly the beachhead's dominant workflow). Investment club — the one segment with a qualitatively different (genuinely multi-author) need, not the stated beachhead. Research team/professional org — real enterprise-shaped needs, correctly excluded near-term.

**The dependency Phase Zero didn't name:** there is no team/organization-account concept anywhere in UCT's auth system (subscriptions/sessions are strictly per-individual-user). **Even the lightest sharing feature (one colleague, one comment) requires defining an account/team boundary primitive first** — a foundational product/billing decision, not a P2 UI increment. State this explicitly so a future validation effort doesn't discover the prerequisite midway through what looked like a UI-sized task.

---

## 18. Migration Trust

The migration/connector engine is already certified (closed, separate program). Do not reopen conversion engineering. Only specify additional member-facing trust UX where it creates real retention/switching value: a migration receipt, reconciliation view, source-provenance display, spot-check flow, history log — all presentation-layer work surfacing already-tracked per-item outcome data the closed engine produced, not new engineering. **Flag for review:** this item currently sits in the P1 list with no benchmark-task mapping (product spec §9) — worth confirming it belongs on the Notebook-platform roadmap at all versus being a holdover from the closed program.

---

## 19. Mobile / Responsive

No dedicated mobile Notebook work is scheduled in Stage A. Mobile capture is a confirmed gap (product spec benchmark #12), never explicitly triaged (unlike the web clipper, which got a deliberate, argued Do-Not-Build ruling). **Scope explicitly in Stage B**, using this codebase's existing mobile system as the default toolkit (canonical breakpoints in `app/src/styles/breakpoints.js`, `Sheet.jsx` for any new modal/drawer, `useLongPress`/`ContextPopover` for touch interactions) rather than inventing new mobile primitives. A native app should not be assumed necessary without evidence — the existing responsive-web system already reaches phone/tablet/desktop for the rest of the product.

---

## 20. Security / Privacy Invariants

Non-negotiable, cross-cutting, apply to every capability above:

- **Tenant isolation:** every query scoped by `user_id` server-side before any data leaves the database boundary — never a post-hoc filter on a shared result set (the exact `brain_kb_service.py` anti-pattern this program exists to avoid repeating, §8.2).
- **AI-index isolation:** per-user-keyed embedding candidates selected before similarity computation, never after ranking.
- **Attachment isolation:** already correct by construction — one per-user directory root (`attachment_root()/<user_id>`), verified during the account-deletion work.
- **Deletion propagation:** any new table MUST be added to `account_purge.py`'s coverage in the same commit that creates it (§3.4) — this is now a hard, structural requirement given the defect this program found and fixed.
- **Export/share-link authorization:** unchanged, already correct (owner-only reads, flag-gated share links).
- **Cross-user leakage is a hard failure** for any of the above — no exceptions, no "acceptable rate."
- **AI_RETRIEVAL_ALLOWED boundary:** any capability that would surface FMP/Massive-sourced content inside an AI-synthesized answer alongside personal notes inherits the external legal review's gate (§8.3) — this is a hard stop, not a priority call, until that review resolves.
