---
id: TSPEC-S3-ENTITY-MASTER
title: Security / Symbol / Entity Master — Technical Specification
role: Phase 3 deliverable — technical specification for a LOCKED system (product-architecture.md
  S3; ARCHITECTURAL_DECISION_REGISTER.md D3), paired with PRD-S3-ENTITY-MASTER
phase: 3
group: technical-architecture
category: spec
scope: >
  Specification, not implementation, of HOW S3 — the Security/Symbol/Entity Master — is built
  against the real UCT codebase: reused components (exact file paths), modified components, new
  components, data contracts, API boundaries, provider adapters, identifier scheme, state
  management, persistence, caching, realtime/polling behavior, background jobs, AI/orchestration
  boundary, observability, error handling, permission/entitlement handling, testing strategy,
  migration implications, performance. Does not re-argue D3 (LOCKED) or restate the product
  requirements PRD-S3-ENTITY-MASTER already specifies — this document builds on both without
  repeating them, and cites them by section rather than re-deriving.
confidence: 🟡 overall — 🟢 wherever this document cites a fact re-verified against application
  source this pass; 🟡 wherever it proposes a concrete schema/algorithm not dictated verbatim by
  the PRD or the architecture (a technical-specification's proper job, per that phase's own
  instruction to make the concrete choices the PRD deferred); 🔴 on OI-05, OI-03(a)/(b), and the
  two open technical questions inherited from the PRD (share-class modeling test fixture outcome;
  FIGI coverage rate across the full entity population — a live-data measurement not performed
  this pass).
evidence_ceiling: >
  Inherits every ceiling of PRD-S3-ENTITY-MASTER, product-architecture.md, data-architecture.md
  and information-architecture.md unchanged (no observed desk morning — OI-06; no vendor contract
  seen — OI-03; no production telemetry; no measurement of FIGI coverage rate across the live
  entity population). Adds no new upstream-document correction. Every "reuse" or "modify"
  determination below is grounded in a file this pass re-read in full; every count of call sites is
  qualified by how it was measured (a `grep`/`Grep` file-count, not an AST call-site count — the
  PRD's cited "41 call sites / 15 modules" figure comes from `provider-master-ledger.md` row 1,
  not independently re-derived here; this pass's own file-level grep of `to_polygon_symbol` found
  it referenced in 16 files, a compatible but not identical measurement, noted where used).
sources: PRD-S3-ENTITY-MASTER (`prds/entity-master-prd.md`, all 18 sections) ·
  ARCHITECTURAL_DECISION_REGISTER.md (D3, LOCKED) · product-architecture.md (§5 S3 system block,
  §5-B.1 context model, §5-B.3 identity model, §8 boundary matrix, §10 reversibility ledger, D1/D5
  blocks) · data-architecture.md (§5 Symbol/Security/Entity Master, §6 Time Handling, §26 F-09
  integration) · information-architecture.md (§3.2-3.3 address space, §10 Context Channel, §12
  workflow chains) · capability-infrastructure-matrix.md (S3 row) · capability-ledger.md (rows A8,
  A9, C3) · GOVERNING_PRINCIPLES.md (§4, §5, §13, §14A) · READINESS_REVIEW_DAY1.md (§5, §7 D3) ·
  DAY_1_EXECUTIVE_SYNTHESIS.md / PHASE_2_INTEGRATION_SYNTHESIS.md (D3 framing) · application source
  read in full this pass: `api/services/cap_universe.py`, `api/services/delisted_registry.py`,
  `api/routers/ticker_search.py`, `api/services/ticker_search_index.py`,
  `api/services/polygon_extras.py`, `api/services/massive.py` (`to_polygon_symbol`,
  `list_reference_tickers`, and surrounding client), `api/services/ticker_meta.py` (partial —
  header + first 120 lines), `api/services/bars_sqlite.py` (partial — WAL/write-lock/`_migrations`
  sections), `api/services/auth_db.py` (partial — `watchlists`/`watchlist_items` schema),
  `api/services/voice_tool_impls.py` (partial — the `get_ticker_details` tool registration), and a
  `Grep` census of `to_polygon_symbol` call sites and `composite_figi`/`share_class_figi` reads
  across `api/`.
status: draft — Phase 3 deliverable, awaiting review
date: 2026-09-02
provisional_markers: OI-05 (asset-class scope — this spec's schema is type-tagged so widening is a
  data change, not a migration); OI-03(a)/(b) (bears on nothing in S3's own output per PRD §11 —
  carried here only because S9's entitlement gate, not S3, is where it would attach); the
  share-class modeling choice (resolved by this spec, §4.4, with the required test fixture named in
  §12); the FIGI-coverage-rate measurement (named as a day-1 operational task, §9.4, not performed
  this pass).
---

# Security / Symbol / Entity Master — Technical Specification

## 0. How to read this document

This is the technical specification paired with `PRD-S3-ENTITY-MASTER`. The PRD answers *what* S3
must do and *why*; this document answers *how*, against the actual UCT codebase, at the level of
concrete schema, module boundaries, and call sites. Per this phase's contract: specification, not
implementation — no application file is touched, edited, or created by this document. Every
"reuse"/"modify"/"new" determination below cites the exact file this pass re-read, not a
recollection of the PRD's own citations (though several are the same files, re-verified).

**What this document does not re-litigate.** D3 is LOCKED (`ARCHITECTURAL_DECISION_REGISTER.md`):
one internal permanent entity id, FIGI as the external mapping's *permanence property* (not
necessarily its exact code), tickers as a dated alias list, delist/rename marked never erased. The
PRD's use cases (UC-1 through UC-6), invariants (§6.3), primitive signatures (§8), acceptance
criteria (§17) and non-goals (§16) are inherited verbatim and cited by section number, not
restated. Where this document makes a concrete choice the PRD explicitly deferred (the entity-id
generation scheme, §9.3 of the PRD; the share-class modeling choice, §6.2/§18 of the PRD; the
storage engine, §6 "not a literal DDL" of the PRD), it says so and gives the reasoning.

---

## 1. Traceability — why this build, not a different one

Per the north star: TERMINAL-NEXT differentiates by combining UCT's existing estate with a small
number of load-bearing platform primitives, not by building new infrastructure for its own sake.
S3 is one of exactly two systems the Readiness Review calls "the clearest infrastructure gaps"
(`READINESS_REVIEW_DAY1.md` §5) — grounded in code this pass confirms the gap is real (no file
anywhere in `api/services/` assigns a permanent id; every candidate store — `cap_universe.py`,
`delisted_registry.py`, `ticker_search_index.py`, `watchlist_items.sym` — is keyed on the mutable
ticker string) and confirms the gap is *narrow*, not a rebuild: three of the four building blocks
(a membership list, a name/type index fed from the exact vendor endpoint the design specifies, a
mark-don't-erase delisted registry) already exist, work, and need extension rather than
replacement. This spec is the "give the existing estate a spine" thesis (`product-architecture.md`
§1.1) applied literally: **new** is a thin identity layer; **reuse** is everything underneath it.

North-star capabilities this build serves directly (inherited from the PRD, §1, not re-derived):
market/security discovery (extends `/api/ticker-search`, A8), cross-security/contextual navigation
(the Context Bus's entity-id payload, once S4 exists), data provenance/freshness (identity as the
precondition for a citation), AI-assisted research (a tool-layer resolution step, never a private
I1→S3 edge), watchlists/alerts (an entity-id foreign key any future saved object can use),
provider abstraction (`vendorSymbol()` replacing one vendor's rewrite function with a general
stored mapping).

---

## 2. Component inventory — reuse, modify, new

*(File paths verified by direct read this pass, not by memory or by trusting the PRD's own
citations a second time.)*

### 2.1 Reused as-is (no code change required)

| Component | File | What S3 reuses it for |
|---|---|---|
| Cap-universe loader | `api/services/cap_universe.py` (69 lines, read in full) | `symbols()` is the membership-list seed input for §5.1's backfill (PRD §5.2 "the existing universe gate as a *membership* input only, never an identity source" — this module's own docstring already states the same discipline: "Never raises... every caller is expected to treat 'empty' as 'cannot answer'"). `etf_symbols()` seeds the ETF portion of the entity population. Neither function is modified — S3 calls them exactly as `ticker_search_index.py` already does (line 127-132). |
| Delisted registry's seed files | `api/data/delisted_tickers.json`, `api/data/delisted_tickers_bulk.json`, plus the runtime overlay at `<DATA_DIR>/delisted_tickers_overlay.json` | The initial delisted-entity population for S3's one-time backfill (§5 below). `delisted_registry.py`'s own header (lines 1-21, read in full) already documents the two source classes (Massive `active=false` census; pre-2003 CSV imports) — S3's seed script reads the same three files `delisted_registry._ensure_loaded()` does (lines 88-129), through `delisted_registry.all_entries()`, not by re-parsing the JSON. |
| Massive reference-tickers client | `api/services/massive.py::list_reference_tickers()` (lines 969-997, read in full) | The single provider call S3's backfill and reconciliation job both use. Confirmed this pass: the raw `results` dicts this function returns already carry `composite_figi`, `delisted_utc`, `list_date`, `cik` (per its own docstring, line 972, and independently confirmed live in `polygon_extras.get_ticker_details()` lines 82-111, which reads `composite_figi`/`share_class_figi` off the *single-ticker* variant of the same reference endpoint). **S3 does not add a new Massive call** — it reads fields the existing call already returns and that one caller (`ticker_search_index._collect_rows()`) currently discards. |
| `voice_tool_impls.py::_get_ticker_details` | `api/services/voice_tool_impls.py` lines 304-313, 2382-2393 | Confirmed this pass as the "one voice tool" the PRD's GAP finding #5 names: it calls `polygon_extras.get_ticker_details(ticker)`, which is where `composite_figi`/`share_class_figi` are read today. Left unmodified — S3's FIGI backfill reads the same underlying Massive field via `list_reference_tickers()`, not by calling this tool. |
| `to_polygon_symbol()` | `api/services/massive.py` lines 40-52 | Kept, unmodified, exactly per PRD §13.2 step 4: "retired incrementally... continue to serve their current call sites correctly until each is migrated." A `Grep` census this pass found the name referenced in 16 files under `api/` (`volume_live.py`, `theme_index.py`, `screener/darkpool_agg.py`, `scan_volume.py`, `scatter.py`, `polygon_options.py`, `nhnl_live.py`, `massive.py` itself, `journal_two/excursion_engine.py`, `journal_two/broker/snaptrade_adapter.py`, `index_constituents.py`, `implied_backfill.py`, `bars_fetch_test.py`, `bars_fetch.py`, `routers/live_prices.py`, `routers/bars.py`) — a file-level count, narrower than the PRD's cited "41 call sites / 15 modules" (`provider-master-ledger.md` row 1, an AST-level call count this pass did not re-derive); both counts describe the same real, wide fan-out and neither is disturbed by this build. |
| `delisted_registry.resolve()` / `._provider_alias` | `api/services/delisted_registry.py` lines 132-142, 105-129 | Kept, unmodified, per PRD §13.2 step 4. S3's alias model *subsumes* this mechanism's purpose (§4.3 below) but the running code stays live until each of its callers (the bars-serve path, `/api/ticker-search`) is migrated to call S3's `resolve()` instead. |
| `GET /api/ticker-search` merge order and precedence rules | `api/routers/ticker_search.py` (184 lines, read in full) | The three-source merge (index → breadth pseudo-tickers → delisted registry) and its "a live ticker sharing a symbol wins" rule (lines 170-183) are reused verbatim; S3 adds one field to the index's row shape (§7.1) rather than touching the merge logic. |
| `ticker_meta` cache | `api/services/ticker_meta.py` (header + lines 1-120 read) | Stays the source for company name/sector/logo display metadata, per PRD §9.4 and §6.5 ("no sector/industry classification... those belong to A3/A7's canonical schemas"). S3 never reads or writes this cache. |
| `bars.db`'s `_migrations` pattern | `api/services/bars_sqlite.py` lines 171-193, read in full | The concrete migration-table shape (`_migrations(name TEXT PRIMARY KEY, applied_at INTEGER)`, one `(name, sql)` tuple list run once each) is the pattern S3's own schema-versioning copies (§6.2), not a shared table — S3 gets its own `_migrations` table in its own database file, per the "never `auth.db` as a home for new tables" rule (`product-architecture.md` §5-B.8, TD-13). |
| Single-writer serialization pattern | `api/services/bars_sqlite.py` lines 31-40 (`_WRITE_LOCK`), read in full | The concrete precedent for S3's own in-process write lock (§8.2) — "reads stay lock-free (WAL allows concurrent readers); this only orders writers." Copied as a pattern, not imported as code (a different database file, a different lock object). |

### 2.2 Modified (small, additive changes to an existing file)

| Component | File | Change | Why additive, not a rewrite |
|---|---|---|---|
| `ticker_search_index._collect_rows()` | `api/services/ticker_search_index.py` lines 76-134 | Extend the two fetch loops (lines 100-121) to retain `composite_figi`, `share_class_figi`, `cik`, `list_date`, `delisted_utc` from the raw Massive row instead of discarding everything but `ticker`/`name`/`type`/`primary_exchange` (`_put()`'s current signature, lines 84-98, only accepts `sym, name, asset_type, exch`). Also add one field per row: `entity_id`, resolved at build time by calling S3's `resolve(sym, asOf="now")` once per row (§7.1). | The row shape (`{sym, name, name_lc, type, exch}`) gains fields; nothing existing is removed, renamed, or reordered. `search()` (lines 240-278) and its ranking algorithm are untouched — the PRD's own §7.2 is explicit that this is "additive... without a redesign of the search index's ranking or merge logic." The daily rebuild cadence (`_REFRESH_TTL`, line 36, 26h) already re-fetches `list_reference_tickers()` for every row; the added fields cost nothing new on the provider side, only a few more dict keys read out of a response already in memory. |
| `GET /api/ticker-search` response row shape | `api/routers/ticker_search.py` line 127 (docstring) and the three emit sites (lines 109, 163-164, 177-181) | Add `entity_id: string \| null` to every emitted row (live index rows carry it from the index build; breadth pseudo-tickers and delisted rows carry `null` until S3's backfill covers those kinds too, §5.3). | Purely additive per the same PRD §7.2 contract; the merge order, the precedence rule, and every existing field are unchanged. A client that ignores the new field behaves exactly as today. |

### 2.3 New components required

| Component | Proposed location | Responsibility |
|---|---|---|
| Entity Master service package | `api/services/entity_master/` (new package, mirroring the `journal_two/` and `broker/` package precedent already in this codebase) | Owns the SQLite store, the four primitives (`resolve`, `aliases`, `vendor_symbol`, `related_to`), the event-application API, and the in-memory resolution cache. Detailed in §§4-8. |
| Entity Master schema module | `api/services/entity_master/schema.py` | `_SCHEMA` DDL string + `_migrations` list, following the `bars_sqlite.py` pattern (§2.1 above) and the `auth_db.py` `_SCHEMA`/`_PHASE_2_ALTERS` naming convention this codebase already uses (per `CLAUDE.md`'s Broker Sync and Journal 2.0 sections, which name that exact pattern for `db.py`'s `_J2_SCHEMA`/`_PHASE_2_ALTERS`). |
| Backfill/seed script | `scripts/entity_master_seed.py` (new, offline, admin-run — mirrors the existing `scripts/enumerate_delisted` precedent `delisted_registry.py`'s own header names, line 29) | One-shot (idempotent, re-runnable) population of the entity/alias/FIGI/vendor-symbol tables from `cap_universe.symbols()`, `list_reference_tickers()`, and `delisted_registry.all_entries()`. Never runs against production automatically; an admin or a scheduled job triggers it explicitly (§10). |
| Reconciliation job (interim D5 stopgap, explicitly authorized by PRD §9.5.1) | `api/services/entity_master/reconciliation.py` | A scheduled job that re-reads `list_reference_tickers(active=True)` and diffs it against the stored alias table to synthesize `new_entity` and `delisted` events only — **never `rename`**, which stays D5's job (§10.2). Named and retired the day D5 ships, per PRD §9.5.1's sunset condition — not S3's permanent design. |
| Admin status/ops routes | `api/routers/entity_master_admin.py` (new, `require_admin`, mirrors `api/routers/cot.py`'s `/status`/`/reseed` shape and `modelbook.py`'s admin-gated write routes) | `GET /status` (row counts, last build/reconcile time, ambiguous-alias count), `POST /reconcile` (manual trigger, mirrors `POST /api/cot/reseed`), `POST /event` (manual/admin identity-change event submission — the interim hand lever before D5 exists, mirrors `delisted_registry.add_entry()`'s `persist=True` pattern). |

**What is explicitly NOT a new component.** Per PRD §16 and §5.5: no new search UI (§2.2 above is
the entire frontend-adjacent footprint — one new field, zero new components); no admin UI for
hand-editing entity records (the admin routes above are an ops lever, not a CRUD screen — no
`EntityAdminPanel.jsx` is proposed); no replacement for `cap_universe.json`, `ticker_meta_cache`,
or `delisted_registry.py`'s data files (all three are read, none is rewritten); no new vendor
integration beyond OpenFIGI as a fallback resolver (§9.4), which is a free, keyless HTTP call, not
a paid contract.

---

## 3. Entity identifier scheme (resolves PRD §9.3)

**Decision: a ULID-based opaque internal id, string-encoded as `ent_<26-char Crockford-base32
ULID>`** (e.g. `ent_01J8Y6K3QZXG7VN5R2WQXF9C4H`).

**Why not FIGI-as-primary-key.** PRD §9.2/§11 already forecloses this for entities Massive does
not cover (indices, some delisted pre-2003 names) — a primary key that is sometimes absent cannot
be primary. FIGI is stored as `entity_figi.composite_figi`/`.share_class_figi`, nullable, per §4.4
below.

**Why not a UUIDv4 or an auto-increment integer.** Both are valid per the PRD's only three
constraints (§9.3: UCT-internal or free, never reused, never member-facing) — the choice between
them is genuinely a technical-specification call, made here for two concrete reasons grounded in
this codebase's own conventions: (1) every other new-ish store in this repo that generates its own
opaque ids uses a string primary key, not an integer (`watchlists.id TEXT PRIMARY KEY`,
`watchlist_items.id TEXT PRIMARY KEY` — `auth_db.py` lines 66-85, read this pass), so a string id
is the path of least friction for every future FK column; (2) a ULID is lexicographically sortable
by creation time with no coordination, which makes `entity_events` replay-ordering (AC-5's
idempotency requirement) and any future "entities created since t" admin query free — a property a
random UUIDv4 does not have and an auto-increment integer only has within one SQLite file, not
across a future multi-file/multi-service topology. No new dependency is required: a 26-line
pure-Python ULID generator (timestamp + crypto-random payload, Crockford base32 encode) is
sufficient and needs no package addition. The `ent_` prefix is a defensive-typing convention (like
this codebase's own `pgxdet::`/`ref_tickers_` cache-key prefixes in `polygon_extras.py`/
`massive.py`) so a malformed id is visually distinguishable from a ticker string in a log line.

**Test for AC-9 (no licensing-restricted identifier).** The primary key is never a CUSIP, is never
derived from a CUSIP-shaped input, and the schema (§4) has no column named or shaped like a CUSIP.
A one-line static check (`grep -ri cusip api/services/entity_master/`) returning nothing is the
review-time verification the PRD's AC-9 asks for.

---

## 4. Data contracts — concrete schema

*(The PRD deliberately specifies invariants, not DDL, "this section specifies WHAT the model must
represent... not a literal DDL" — PRD §6. This section is that DDL, one level down.)*

### 4.1 Storage engine and file

**One new SQLite database, `<DATA_DIR>/entity_master.db`**, WAL mode, following the `bars.db`/
`cot.db`/`catalysts.db` per-domain-database convention already established in this codebase (every
one of those is its own file under `DATA_DIR`, never a table added to `auth.db` — the explicit rule
`product-architecture.md` §5-B.8 states and `CLAUDE.md`'s own "never `auth.db`" pattern for
`journal_two` confirms). Rejected alternative: a table inside `auth.db` — rejected per that same
rule (`TD-13`: "~110 tables, one write lock, no migration framework").

### 4.2 DDL

```sql
CREATE TABLE IF NOT EXISTS entities (
    entity_id       TEXT PRIMARY KEY,          -- ent_<ULID>
    entity_type     TEXT NOT NULL,              -- 'equity' | 'etf' | 'index' | 'future_positioning'
    lifecycle_state TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'delisted' | 'renamed_successor_exists'
    lifecycle_since TEXT,                       -- ISO date the state last changed; NULL while active-since-creation
    created_at      TEXT NOT NULL,              -- ISO 8601 UTC
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_aliases (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id       TEXT NOT NULL REFERENCES entities(entity_id),
    alias           TEXT NOT NULL,              -- the ticker string, always upper-cased
    valid_from      TEXT NOT NULL,               -- ISO date
    valid_to        TEXT,                        -- ISO date, NULL = open-ended (currently valid)
    source          TEXT NOT NULL,               -- 'seed:cap_universe' | 'seed:massive_reference'
                                                   -- | 'seed:delisted_registry' | 'event:<event_id>'
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alias_lookup ON entity_aliases(alias, valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_alias_entity ON entity_aliases(entity_id);

CREATE TABLE IF NOT EXISTS entity_vendor_symbols (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id       TEXT NOT NULL REFERENCES entities(entity_id),
    vendor          TEXT NOT NULL,               -- 'massive' | 'fmp' | ... (D1's adapter registry keys)
    vendor_symbol   TEXT NOT NULL,
    valid_from      TEXT NOT NULL,
    valid_to        TEXT,
    source          TEXT NOT NULL,               -- 'derived:dot_notation' | 'event:<event_id>' | 'seed:...'
    created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_symbol_lookup
    ON entity_vendor_symbols(entity_id, vendor, valid_from);

CREATE TABLE IF NOT EXISTS entity_figi (
    entity_id        TEXT PRIMARY KEY REFERENCES entities(entity_id),
    composite_figi   TEXT,
    share_class_figi TEXT,
    source           TEXT NOT NULL,              -- 'massive_reference' | 'openfigi'
    updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_figi_composite ON entity_figi(composite_figi);

CREATE TABLE IF NOT EXISTS entity_relations (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id           TEXT NOT NULL REFERENCES entities(entity_id),
    related_entity_id   TEXT NOT NULL REFERENCES entities(entity_id),
    kind                TEXT NOT NULL,           -- 'successor' | 'predecessor' | 'share_class'
    valid_from          TEXT NOT NULL,
    source              TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    CHECK (kind IN ('successor', 'predecessor', 'share_class')),
    CHECK (entity_id != related_entity_id)
);
CREATE INDEX IF NOT EXISTS idx_relation_entity ON entity_relations(entity_id, kind);

CREATE TABLE IF NOT EXISTS entity_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    dedup_key       TEXT NOT NULL UNIQUE,        -- caller-supplied idempotency key (AC-5)
    entity_id       TEXT REFERENCES entities(entity_id),  -- NULL for a 'new_entity' event pre-assignment
    event_type      TEXT NOT NULL,               -- 'new_entity' | 'alias_added' | 'alias_retired'
                                                   -- | 'delisted' | 'renamed' | 'relation_added'
    payload_json    TEXT NOT NULL,               -- typed per event_type, see §4.3
    source           TEXT NOT NULL,              -- 'd5' | 'reconciliation' | 'admin_manual'
    applied_at      TEXT NOT NULL,
    rejected_reason TEXT                          -- non-NULL when the write was refused (§8.4 / PRD §13.1)
);
CREATE INDEX IF NOT EXISTS idx_events_entity ON entity_events(entity_id);

CREATE TABLE IF NOT EXISTS _migrations (
    name        TEXT PRIMARY KEY,
    applied_at  INTEGER
);
```

**Why an application-level uniqueness check, not a SQL constraint, for PRD invariant 6.3.1 ("no
alias collision at a point in time").** SQLite has no native range-overlap exclusion constraint
(unlike PostgreSQL's `EXCLUDE USING gist`). The invariant — no two entities may hold the same
`alias` with overlapping `[valid_from, valid_to)` windows — is enforced at the write boundary
(§8.4) by a query against `idx_alias_lookup` before every insert, inside the single-writer lock
(§8.2), the same shape as `bars_sqlite.py`'s own write-serialization rationale ("reads stay
lock-free... this only orders writers, which SQLite was going to serialize anyway").

### 4.3 Event payload shapes (the D5 → S3 input contract, PRD §4 UC-6)

Each `entity_events.payload_json` is one of:

```
new_entity:      {entity_type, initial_alias, initial_alias_valid_from, cik?, composite_figi?}
alias_added:      {entity_id, alias, valid_from}
alias_retired:     {entity_id, alias, valid_to}
delisted:          {entity_id, lifecycle_since}
renamed:           {entity_id, old_alias, old_alias_valid_to, new_alias, new_alias_valid_from}
relation_added:    {entity_id, related_entity_id, kind}
```

This is the typed contract PRD §15 names as what D5 needs from S3 ("Typed identity-change events...
as the authoritative trigger"). D5 itself is out of this document's scope (a separate, not-yet-
specified Phase-3 system); this contract is what D5's specification, when it is written, must
target. Until D5 exists, the reconciliation job (§10.2) and the admin manual-event route (§2.3)
are the only two producers.

### 4.4 The share-class modeling choice (resolves PRD's deferred open question)

**Decision: two entities, linked by a `share_class` relation — not one entity with two aliases.**

Reasoning, grounded in the schema above and PRD §6.2's own framing: a class-share pair (`GOOG`/
`GOOGL`, `BRK-A`/`BRK-B`) trades as two distinct, simultaneously-listed instruments with two
distinct FIGIs when Massive assigns them (`composite_figi` is per-ticker in the raw reference
response; `share_class_figi` is the shared-parent field — confirmed this pass in
`polygon_extras.py` lines 91-92, which reads both as separate, co-present fields on one ticker's
detail response, implying each class share has its *own* `composite_figi` and a common
`share_class_figi`). Two simultaneously-*valid* aliases on **one** entity would violate PRD
invariant 6.3.1 read literally only if the invariant meant "one alias per entity at a time" — it
does not; it means "one entity per alias at a time," which two entities each holding one alias
satisfies cleanly, while one entity holding two simultaneously-open aliases does not map to
`aliases(entity, asOf=t)`'s documented singular return ("the single alias valid at that time" —
PRD §8's `aliases` primitive signature). The two-entity model also composes correctly with
`entity_figi` (one row per entity, one `composite_figi` per row — exactly matching Massive's own
per-ticker FIGI shape) and lets `vendorSymbol(entity, vendor)` stay a pure per-entity, per-vendor
lookup with no "which alias did you mean" ambiguity inside a single entity's row.

**The `BRK-B`→`BRK.B` case is different and is NOT modeled as two entities.** This is one entity,
one canonical alias (`BRK-B`), with two *vendor notations* for the same instrument (`entity_
vendor_symbols` rows for `massive`→`BRK.B` and, say, `fmp`→`BRK-B`) — exactly the case PRD §6.2's
table already separates ("a (entity, vendor, vendor-native-symbol) row, dated where a vendor's own
notation... has changed independently of the canonical alias"). The two cases look similar (both
involve a hyphen/dot) but are structurally different: `GOOG`/`GOOGL` are two *tradeable, separately
quoted* instruments; `BRK-B`/`BRK.B` are one instrument written two ways by two vendors. The schema
already carries both without a third table.

**Required test fixture** (per PRD §18): a synthetic dual-class fixture with two entities
(`GOOG`-alias entity, `GOOGL`-alias entity), one `share_class` relation between them, and one
single-class dual-notation entity (`BRK-B` canonical alias, `massive`→`BRK.B` vendor row) — see
§12's test plan, which names this fixture explicitly as `test_share_class_vs_vendor_notation`.

---

## 5. Migration / seed plan (concrete version of PRD §13.2)

### 5.1 One-time backfill (`scripts/entity_master_seed.py`)

1. **Read** `cap_universe.symbols()` (the ~3,742-symbol active-equity membership list) and
   `cap_universe.etf_symbols()` (the ~100-symbol curated ETF list) — both via the existing loader,
   no new file parsing.
2. **Read** `massive.list_reference_tickers(active=True, market="stocks")` and `market="indices"` —
   the same two calls `ticker_search_index._collect_rows()` already makes (lines 101-121) — and
   retain every field the raw response carries (not just the four `ticker_search_index` keeps
   today): `ticker`, `name`, `type`, `primary_exchange`, `cik`, `composite_figi`,
   `share_class_figi`, `list_date`, `delisted_utc`.
3. **Read** `delisted_registry.all_entries()` for the seed + bulk + overlay delisted population.
4. **Assign one entity per distinct instrument.** For each symbol present in step 1 or 2 and
   `active`, create one `entities` row (`entity_type` from the Massive `type` field via the
   existing `ticker_types.normalize_type()` helper `ticker_search_index.py` already imports at line
   106) plus one open-ended `entity_aliases` row (`valid_from` = the Massive `list_date` if present,
   else a floor date, `valid_to` = NULL). For each delisted record from step 3, create one entity
   with `lifecycle_state='delisted'` and a **closed** alias row (`valid_to` = the record's
   `delisted_date`), keyed by the registry's own `ticker` field — including its reused-symbol
   distinct-key convention (`BSC-OLD`), which becomes this entity's canonical alias string exactly
   as it is today, so no existing behavior anywhere that already keys off `BSC-OLD` breaks.
5. **Populate `entity_figi`** for every entity whose Massive row carried a non-null
   `composite_figi`.
6. **Populate `entity_vendor_symbols`** by deriving, for every entity whose canonical alias
   contains a hyphen, a `massive`→`alias.replace('-', '.')` row — replicating `to_polygon_symbol()`'s
   transform as *data* rather than a function, per data-architecture.md §5.4's own recommendation
   ("not a special-case rewrite function per vendor pair"). This is what makes AC-4 (functional
   parity with `to_polygon_symbol`) true by construction: the same rule, applied once at seed time,
   for every hyphenated alias, not hand-enumerated per dual-class name.
7. **Idempotency.** Re-running the script against an already-seeded database must not duplicate
   rows — every insert is `INSERT ... WHERE NOT EXISTS` (a live alias already covering that symbol)
   rather than a blind append, matching PRD §14's "re-running the seed must not duplicate or
   corrupt existing rows" performance/completeness requirement.

This step is an **offline/background job**, never a request-path operation (PRD §14) — it is a
manually-triggered script (or a one-time admin route call), not a scheduled job, since it should
run exactly once per environment.

### 5.2 What does NOT change on day one

Per PRD §13.2 and this spec's §2: `cap_universe.json`, `ticker_meta_cache`,
`delisted_tickers*.json`, `to_polygon_symbol()`, and `delisted_registry.py`'s runtime behavior are
untouched. `watchlist_items.sym` (confirmed this pass, `auth_db.py` lines 78-85: `sym TEXT NOT
NULL`, no entity FK) and every other existing ticker-string-keyed store stay exactly as they are —
this spec does not propose a migration for them, per the explicit non-goal (PRD §16 item 6) and
`data-architecture.md` §4.5's own precedent for D2 ("migrating an existing SQLite file to the
canonical schema only when it is touched for an unrelated reason... the `bars.db` precedent").

### 5.3 Rollout order

1. Ship the schema + primitives + backfill script, unwired to any consumer. Verifiable in
   isolation via the test suite (§12).
2. Extend `ticker_search_index._collect_rows()` and the `/api/ticker-search` response (§2.2) —
   additive, dormant until a future consumer reads the new field (S4 does not exist yet).
3. Start the reconciliation job (§10.2) so the store does not go stale between the one-time seed
   and D5's eventual existence.
4. When S4 (Context Bus) is specified and built, its `publish()` payload's `entity` field is
   sourced from S3's `resolve()`. When S5 (Persistence) is specified and built, its new saved-
   object schemas FK on `entity_id`. Neither is this document's to specify (S3's contract with
   both is already frozen by `product-architecture.md` §5's boundary matrix, restated in PRD §5.4).

---

## 6. The primitives — concrete signatures and implementation shape

Per PRD §8's illustrative signatures, implemented concretely:

```python
# api/services/entity_master/api.py

from dataclasses import dataclass
from typing import Literal, Optional

@dataclass(frozen=True)
class Entity:
    entity_id: str
    entity_type: str
    lifecycle_state: str
    lifecycle_since: Optional[str]

@dataclass(frozen=True)
class AliasRecord:
    alias: str
    valid_from: str
    valid_to: Optional[str]

@dataclass(frozen=True)
class ResolveResult:
    status: Literal["resolved", "not_found", "ambiguous"]
    entity: Optional[Entity] = None
    candidates: tuple[str, ...] = ()   # entity_ids, populated only when status == "ambiguous"


def resolve(alias: str, as_of: str | None = None) -> ResolveResult: ...
def aliases(entity_id: str, as_of: str | None = None) -> list[AliasRecord]: ...
def vendor_symbol(entity_id: str, vendor: str, as_of: str | None = None) -> Optional[str]: ...
def related_to(entity_id: str, kind: Literal["successor", "predecessor", "share_class"]) -> list[Entity]: ...
def apply_event(event_type: str, payload: dict, dedup_key: str, source: str) -> "ApplyResult": ...
```

**Why a typed `ResolveResult` dataclass rather than raising an exception for `NotFound`/
`Ambiguous`.** Matches this codebase's own dominant idiom for a "never raise, return a sentinel"
service (`delisted_registry.resolve()` returns `Optional[dict]`, never raises;
`cap_universe.symbols()` "Never raises... a missing or malformed file yields an empty set" — its
own docstring, line 11-12). `Ambiguous` specifically is a defect signal (PRD §8), so it is
distinguishable from `NotFound` by a status field a caller pattern-matches on, never by exception
type (an exception-based design would make `Ambiguous` look like a crash rather than a queryable,
loggable outcome — the wrong shape for something S12 must be able to alert on, PRD §13.1).

**`as_of=None` semantics.** Per PRD §8 ("a caller that omits `asOf` gets 'as of right now'"), `None`
resolves to the current UTC date at call time — S3 has no dependency on S11 (Session & Market
Clock) existing yet, since "as of right now" for a *date-granularity* bitemporal query (aliases are
dated, not timestamped to the minute — PRD §6.2's `AliasRecord` shape is `(ticker, valid_from,
valid_to)`, dates) does not need session-state precision. This is a deliberate scope-narrowing:
`product-architecture.md` §5's S3 dependency line ("S11... for `asOf` semantics where a query needs
'as of right now'") is satisfied by a plain UTC-date read until S11 itself exists; the day S11
ships, `as_of=None`'s resolution swaps from `datetime.utcnow().date()` to a call into S11's
`sessionState(now)`-derived date with zero change to any caller's contract.

---

## 7. API boundaries

### 7.1 In-process Python module (primary boundary)

S3's primitives are a plain importable Python module (`api.services.entity_master.api`), called
directly by anything running inside the web pod's single uvicorn process — matching this
codebase's own dominant pattern (`cap_universe`, `delisted_registry`, `ticker_meta`,
`ticker_search_index` are all imported, never HTTP-called, by their in-process consumers).
**No new internal HTTP service is created.** This also matches `CLAUDE.md`'s standing architecture
fact: "the web pod is ONE uvicorn process... do NOT multi-worker the web pod" — an in-process
module is the only boundary shape consistent with that constraint, and per §5-B.8's boundary
matrix, S3 is called by S2/S4/S5/S7/D1/D5/Applications, none of which are separate services today
either.

### 7.2 `GET /api/ticker-search` (modified, §2.2)

Row shape gains `entity_id: string | null`. No new endpoint; no version bump; no breaking change.

### 7.3 `GET /api/admin/entity-master/status` (new)

```
{
  "entities": <int>, "aliases": <int>, "delisted": <int>,
  "figi_coverage_pct": <float>,           -- entities with a non-null composite_figi / total
  "ambiguous_count": <int>,               -- PRD §13.1's defect signal, surfaced for S12
  "last_seed_at": <iso ts | null>,
  "last_reconcile_at": <iso ts | null>
}
```
No-auth read (mirrors `GET /api/admin/bars-stream-status`'s and `GET /api/admin/reconciliation-
status`'s existing no-auth-diagnostic convention in this codebase — a deliberate choice those two
routes already make, reused here rather than inventing a third auth posture for the same kind of
endpoint).

### 7.4 `POST /api/admin/entity-master/reconcile` and `POST /api/admin/entity-master/event` (new)

`require_admin`-gated (mirrors `modelbook.py`'s write-route gating and `cot.py`'s `POST /reseed`).
The `event` route is the manual override lever — the same shape as `delisted_registry.add_entry()`
— for an admin to submit one identity-change event by hand before D5 exists to submit it
automatically.

---

## 8. State management, persistence, caching

### 8.1 Persistence

SQLite, `entity_master.db`, WAL mode — per §4.1. Every write is additive (PRD invariant 6.3.4: "no
update-in-place on a historical fact") — an `alias_retired` event issues an `UPDATE
entity_aliases SET valid_to = ?` on the *specific still-open* row (the one mutable field an
"append-only" bitemporal store is allowed to touch: closing the open end of a range is not
rewriting history, it is dating its boundary — the same shape `delisted_registry`'s own
`[first_date, last_date]` clamp already uses), never a delete and never a rewrite of `valid_from`.

### 8.2 Write serialization

One in-process `threading.Lock()` (`api/services/entity_master/store.py::_WRITE_LOCK`), directly
modeled on `bars_sqlite.py`'s `_WRITE_LOCK` (§2.1 above) — reads are lock-free (WAL), writes queue
in-process. S3's write volume is orders of magnitude lower than `bars.db`'s (identity-change
events are rare — renames/delistings/new-listings, not per-tick data), so no further optimization
(a queue, a batching layer) is warranted; this is explicitly *not* over-engineered relative to the
actual write rate, per the anti-drift rule against "architecture for architecture's sake."

### 8.3 In-memory resolution cache (the sub-10ms performance requirement, PRD §14)

A single in-process dict, `alias → entity_id` for every currently-**open** (`valid_to IS NULL`)
alias, rebuilt from the SQLite store after every write (never partially patched — a full rebuild,
because the write rate is low and a rebuild of ~15-20K rows is sub-millisecond, the same order of
magnitude `ticker_search_index.py`'s own `_BY_SYM` dict rebuild already demonstrates for a
comparably-sized structure, lines 153-157/184-187). `resolve(alias, as_of="now")` hits this dict
directly; `resolve(alias, as_of=<a past date>)` falls through to a SQLite query against
`idx_alias_lookup` (a historical lookup is rare — audit/roster-rendering paths, not the hot
autocomplete path — so it does not need the same cache treatment). This mirrors
`ticker_search_index.py`'s own two-tier shape (`_INDEX`/`_BY_SYM` in memory, `_SNAP_PATH` on disk,
rebuilt via `build_index()`) closely enough that the pattern is a genuine reuse of a proven idiom
in this codebase, not a new design.

**No per-user or per-request cache** — matches the standing platform rule
(`product-architecture.md` §5-B.8: "a per-user server cache — D-11 §7.3 'by design — do not add
one'"). S3's answers do not vary per user.

### 8.4 The write-time invariant guard (AC-3, "no alias collision on write")

Inside `_WRITE_LOCK`, before committing an `alias_added`/`new_entity`/`renamed` event: query
`entity_aliases WHERE alias = ? AND (valid_to IS NULL OR valid_to > ?) AND valid_from < ?` (the
standard interval-overlap predicate) for any row belonging to a *different* entity. A hit rejects
the write with `rejected_reason` stamped on the `entity_events` row (PRD §13.1: "Rejected at the
write boundary with a named reason, not silently accepted") rather than raising — `apply_event()`
returns a typed `ApplyResult(accepted: bool, reason: str | None)`, the same "never raise, return a
sentinel" idiom as §6 above.

---

## 9. Provider adapters

### 9.1 Massive (`D1`'s eventual adapter surface; today, `api/services/massive.py` directly)

S3 does not itself add a new provider dependency. It calls the existing
`massive.list_reference_tickers()` (§2.1) for the reference feed and, for the FIGI fallback,
OpenFIGI (§9.4) — both already inside PRD §9's contract. Per PRD §5.4/§9.5 and
`product-architecture.md`'s boundary matrix, S3 does not poll a vendor on its own read path; all
provider calls happen inside the seed script (§5.1) and the reconciliation job (§10.2), both
off-request-path background work.

### 9.2 `to_polygon_symbol()` vs. `vendor_symbol()` — coexistence, not a fork

Both exist simultaneously during the migration window (PRD §13.2 step 4). `to_polygon_symbol()`
remains a **pure string transform** with no lookup — it will keep working correctly for any
ticker, including one S3 has not yet backfilled, because it derives the dot form algorithmically
rather than from a stored table. `vendor_symbol()` is a **stored, per-entity lookup** — it returns
`None` for an entity with no `entity_vendor_symbols` row (a valid outcome per PRD §8's table, "this
vendor has never carried this entity... not an error"), which means a caller migrating from
`to_polygon_symbol(ticker)` to `vendor_symbol(entity_id, "massive")` must handle a `None` by falling
back to `to_polygon_symbol()` during the transition window, not treat it as a failure. This
fallback rule is the concrete mechanic behind PRD §13.2's "existing... call sites continue to
function exactly as today for any call site not yet migrated" (AC-10).

### 9.3 D1 (Provider Abstraction) — not built yet

D1 does not exist as a system in this codebase (per `product-architecture.md` §4.2, it is a "new"
system alongside S3, not yet specified). S3's dependency on D1 (PRD §5.3, "D1 — for vendor-sourced
facts") is satisfied today by calling `massive.py` directly, exactly as `ticker_search_index.py`
already does — when D1's own technical specification lands, S3's seed script and reconciliation
job re-point their one call site (`list_reference_tickers`) through D1's adapter instead of
`massive.py` directly, a one-file change, not a redesign.

### 9.4 OpenFIGI fallback resolver (new, but a free keyless HTTP call, not a vendor contract)

Per PRD §9.2, used only for entities Massive's reference feed does not carry a FIGI for (an index,
a delisted pre-2003 name imported via CSV). Implementation: a bounded, best-effort HTTP client
following the exact defensive shape `polygon_extras.py`'s `_safe_get()` already demonstrates
(timeout, `raise_for_status`, caught and logged, never propagated onto a request path — because
this call happens only inside the seed script and the reconciliation job, never inside `resolve()`
itself). **Day-1 operational task, not performed this pass:** measuring what fraction of the seeded
entity population ends up with *no* FIGI from either source (Massive or OpenFIGI) — the PRD's own
open question (§18), carried here as a task for whoever runs the seed script for the first time,
not resolved by this document.

---

## 10. Background jobs

### 10.1 One-time seed (§5.1) — manual trigger, not scheduled

Run once per environment via `scripts/entity_master_seed.py` or the admin `POST /reconcile` route
(which is idempotent and safe to also use as the first run, since step 7's idempotency rule makes
"seed" and "reconcile" the same operation at different points in the store's lifetime).

### 10.2 Reconciliation job — scheduled, narrow scope

`api/services/entity_master/reconciliation.py`, registered in `api/main.py`'s existing APScheduler
instance (the same scheduler `cot.py`, `tweet_cleanup.py`, and the desk-session jobs already use —
no new scheduling mechanism). Proposed cadence: **daily**, piggybacked on the same 26-hour rhythm
`ticker_search_index.py`'s own `_REFRESH_TTL` already uses for the identical underlying provider
call (line 36) — reusing an existing cadence rather than inventing a new polling interval avoids a
second, uncoordinated hit on the same Massive endpoint. Each run: re-fetch
`list_reference_tickers(active=True)`, diff against currently-open aliases, and for every symbol
whose `active` flag flipped to `false` since the last run, synthesize a `delisted` event (§4.3)
with `source='reconciliation'`; for every symbol newly present, synthesize a `new_entity` event.
**This job does not detect renames** (a rename is a `delisted`+`new_entity` pair from this feed's
perspective alone, indistinguishable from an unrelated delisting followed by an unrelated new
listing without a corporate-action signal) — rename detection is explicitly D5's job (PRD §9.5,
"the ongoing feed, not a one-time seed"); this reconciliation job is a deliberately narrow bridge
that keeps the *lifecycle-state* and *new-listing* halves of PRD UC-6 working before D5 exists, not
a substitute for D5's full scope. This scoping is named explicitly so a future engineer does not
mistake the reconciliation job for "D5 already done" — it is not.

### 10.3 No realtime/streaming, no polling on the read path

Per PRD §13.1 ("D1 adapter unreachable... it does not block on a live vendor call for
`resolve`/`aliases`/`vendorSymbol`"): every S3 read is a local SQLite/in-memory-dict read. No SSE,
no WebSocket, no client-facing polling loop is part of this system.

---

## 11. AI / orchestration boundary

Per PRD §10 and `product-architecture.md` §5.4/§7 ("I1 reaches entity resolution only through a
registered tool that itself calls S2/S3, never a private path"): **S3 exposes no new AI tool of its
own.** The correct integration point, concretely, is inside an existing or future *registered tool
implementation* — e.g., `voice_tool_impls.py::_get_ticker_details` (§2.1 above) is exactly this
shape: it is a registered-tool function that calls an application service
(`polygon_extras.get_ticker_details`) before returning to the model. A future tool needing
unambiguous identity would import `entity_master.api.resolve()` the same way this tool imports
`polygon_extras`, inside the tool's own implementation — never inside I1's reasoning loop and never
as a new tool named something like `resolve_entity` that the model calls directly (that would be
the private-path anti-pattern the architecture forbids). S2 (Command, Search & Navigation), which
`product-architecture.md`'s boundary matrix names as the intended front door for this
("S2... `/ask` door... resolves it through S3"), does not exist yet as a system; until it does, any
tool implementation that needs entity resolution calls S3 directly, exactly as it would call any
other application-layer service today — this is consistent with the boundary matrix's
"Applications ● S3" edge (tool implementations are application-layer code, not I1 itself calling
S3).

---

## 12. Testing strategy

Mapped to PRD §17's ten acceptance criteria, one test module: `api/services/entity_master/
test_entity_master.py` (colocated with its service, matching this codebase's existing
`api/services/test_grade_ticker.py` precedent). Every fixture is synthetic — no test touches
`cap_universe.json`, `C:\data`, or any production file (per `GOVERNING_PRINCIPLES.md` §4's
protection rail and the repo-root `conftest.py` tripwire already governing this exact class of
risk).

| Test | Covers | Shape |
|---|---|---|
| `test_rename_resolves_correctly` | AC-1 | Seed E1 with `SQ` valid `[D1,D2)`, `XYZ` valid `[D2,∞)`; assert `resolve("SQ", D1+1)`, `resolve("XYZ", D1+1)==NotFound`, post-D2 flip. |
| `test_delisting_marks_never_erases` | AC-2 | Seed a delisting; assert historical `resolve` still works, `aliases()` never drops the closed row, lifecycle state flips with the right date. |
| `test_alias_collision_rejected_at_write` | AC-3 | Attempt an overlapping-alias event; assert `ApplyResult.accepted is False` and no row was written (query the table directly to confirm, not just trust the return value). |
| `test_vendor_symbol_matches_to_polygon_symbol` | AC-4 | For a seeded `BRK-B` entity, assert `vendor_symbol(e, "massive") == to_polygon_symbol("BRK-B")` byte-for-byte — a **differential** test against the real existing function, not a hand-typed expected string, so the two can never silently drift apart. |
| `test_event_replay_is_idempotent` | AC-5 | Apply a (list → rename → delist) event sequence twice via the same `dedup_key`s; assert byte-identical resulting table contents (row counts, no duplicate `entity_aliases` rows). |
| `test_ambiguous_is_distinguishable_and_logged` | AC-6 | Seed directly at the SQLite layer (bypassing `apply_event`'s guard, as PRD §17 AC-6 specifies) to construct a genuine collision; assert `resolve()` returns `status="ambiguous"`, distinct from both a resolved entity and `NotFound`, and that the admin status route's `ambiguous_count` reflects it. |
| `test_cold_start_returns_not_found_never_raises` | AC-7 | Against a freshly-created, empty `entity_master.db`, assert every primitive returns its documented empty/`NotFound` outcome, never an exception. |
| `test_as_of_consistency_across_primitives` | AC-8 | One bitemporal fixture; assert `resolve`/`aliases`/`vendor_symbol`/`related_to` all agree at two named points in time. |
| `test_no_cusip_shaped_identifier` | AC-9 | Static: `grep`-equivalent assertion over the schema module's column names and the entity-id generator's output shape; a review-time check, not a runtime one, run as a test so it is enforced continuously. |
| `test_existing_consumers_unaffected_during_rollout` | AC-10 | Import `to_polygon_symbol`, `delisted_registry.resolve`, `ticker_search_index.search`, `cap_universe.symbols` and assert each still behaves exactly as its own pre-existing test suite already asserts (a smoke check that S3's presence changed nothing about their public behavior — not a new set of assertions, a guard that the old ones still pass). |
| `test_share_class_vs_vendor_notation` | §4.4 | The required dual-class fixture: two entities (`GOOG`/`GOOGL`) linked `share_class`, plus one `BRK-B` entity with a derived `massive`→`BRK.B` vendor row; assert `related_to` and `vendor_symbol` each answer correctly and do not conflate the two cases. |

**Not proposed:** an AST-sweep rail (in the style of `test_no_shadowed_definitions.py` or
`registry.test.js`) guarding "no second identity store ever gets built beside this one." The PRD's
own anti-drift discipline cautions against manufacturing rails for problems not yet observed
(`lesson_a_rail_can_be_green_alone_and_red_in_company` and neighboring lessons); this system is new
enough that no second-authority defect has occurred to guard against yet. If a future audit finds a
second ticker-string-to-identity mapping being built somewhere, that is the moment to add such a
rail — not before.

---

## 13. Migration implications (summary; detail in §5)

No existing store is migrated by this build. `watchlist_items.sym`, `journal_two`'s ticker-string
columns, and every other existing ticker-keyed table are untouched — S3 ships alongside them, ready
for the *next* new store to foreign-key on `entity_id` from its first commit (PRD §6.4), per
`data-architecture.md` §4.5's "scope to new classes first" precedent already adopted for D2 and
extended here to S3 for the identical reasoning.

---

## 14. Performance considerations

| Operation | Target (PRD §14) | How this design meets it |
|---|---|---|
| `resolve(alias, "now")` | Sub-10ms | In-memory dict lookup (§8.3) — O(1), no I/O, same order of magnitude as `ticker_search_index.py`'s already-proven sub-10ms substring scan over a comparably-sized structure. |
| `resolve(alias, <past date>)` | No target set by the PRD | One indexed SQLite query (`idx_alias_lookup`), off the hot autocomplete path — acceptable per PRD §14's own "no numeric target... in the absence of production telemetry." |
| `aliases(entity)` | No target set | One indexed query (`idx_alias_entity`), bounded by one entity's alias count (typically 1-3 rows). |
| Bulk seed | No latency requirement, only idempotency | §5.1, an offline script. |
| Reconciliation job | No latency requirement, async | §10.2, daily background job, off any member-facing request path. |
| In-memory cache rebuild | Not explicitly targeted, but must not stall a write | Full rebuild after each write; at ~15-20K rows this is sub-millisecond in Python (the same shape `ticker_search_index.build_index()` already performs at a comparable row count with no observed request-path impact — that job runs entirely off the request path too). |

No new capacity-envelope number is asserted beyond what the PRD already declines to invent (PRD
§14: "no invented number... S3's read path is a lookup against an in-memory-or-locally-cached
store, not a fan-out concern"). This spec's cache design is exactly that lookup.

---

## 15. Observability

`GET /api/admin/entity-master/status` (§7.3) is the artifact-first status endpoint, following the
platform-wide "read the artifact, never a proxy" discipline this codebase's own `CLAUDE.md`
repeatedly enforces elsewhere (the Desk session-audit lesson, the flag-ledger's `flag_ledger_
audit.py`, `bars-stream-status`). `ambiguous_count > 0` is the one condition that should be
alertable — per PRD §13.1, an `Ambiguous` resolution is a defect, not a normal outcome, and must be
"logged/alertable so the defect is fixed at the data layer." This spec does not wire that alert
into S12 (Rollout, Cohort & Observability) because S12 is not yet built as a system; the status
endpoint's `ambiguous_count` field is what a future S12 integration reads, exactly as
`ambiguous_count` is designed as a queryable field precisely so nothing has to change about S3
when S12 arrives to consume it.

---

## 16. Error handling (summary; detail in §6, §8.4, PRD §8/§13)

Every primitive returns a typed sentinel, never raises, per §6's dataclass design and this
codebase's dominant "never raise onto a request path" idiom (`cap_universe.py`,
`delisted_registry.py`, `polygon_extras.py`'s `_safe_get()` pattern all share this shape).
`Ambiguous` and `NotFound` are distinguishable by a `status` field, never by exception type or by a
shared empty-list return (PRD §8's own table: "a caller renders 'unknown symbol,' never a blank
result" for `NotFound`; a defect-alertable state for `Ambiguous`). A write that would violate the
no-collision invariant is rejected with a named `rejected_reason`, never silently dropped or
silently accepted (§8.4).

---

## 17. Permission / entitlement handling

Per PRD §11 ("S3's own outputs... carry no separate licensing gate — they are UCT-internal
identifiers and dated tickers, not vendor-proprietary content"), **no entitlement check exists
inside `resolve`/`aliases`/`vendor_symbol`/`related_to`** — every caller, regardless of the calling
member's tier, gets the same identity answer, because identity is not the thing being gated (the
*other* fields on a Massive/FMP reference row — name, sector, market cap — are S9's business via D2
and S8, not S3's, exactly as the PRD states). The only permission surface in this build is
operational: the admin routes (§7.3-7.4) are `require_admin`-gated, matching every other
admin-only write route in this codebase (`modelbook.py`, `cot.py`'s `/reseed`,
`admin_twitter.py`).

---

## 18. Dependencies (technical, restating PRD §15 at the code level)

| Dependency | Direction | Concrete form today |
|---|---|---|
| Massive reference feed | S3 depends on it | `massive.list_reference_tickers()`, called directly (D1 does not exist yet, §9.3) |
| OpenFIGI | S3 depends on it (fallback only) | A new, bounded, keyless HTTP client (§9.4) |
| `cap_universe.py` | S3 depends on it (seed input only) | `symbols()`/`etf_symbols()`, unmodified |
| `delisted_registry.py` | S3 depends on it (seed input only) | `all_entries()`, unmodified |
| `ticker_search_index.py` | S3 modifies it | §2.2 |
| `to_polygon_symbol()` | Coexists, not a dependency either direction | §9.2 |
| APScheduler instance in `api/main.py` | S3 depends on it | Registers the reconciliation job (§10.2), the same scheduler instance every other periodic job in this codebase already shares |
| D5 (Reference & Corporate-Actions Data) | Future: S3 will depend on it | Not built yet; §4.3's event contract is what it will target; §10.2's reconciliation job is the interim bridge |
| S2 / S4 / S5 / S7 / D1 / D2 | Future: each will depend on S3 | Not built yet; none is blocked on S3's existence — each was designed against S3's *contract* (PRD §8), which this spec implements exactly, so any of them can be built against this module today without waiting on the others |

---

## 19. Explicit non-goals (inherited from PRD §16, not re-derived)

Everything PRD §16 lists (not a data-quality system, not the universe gate, not the market clock,
not a licensed-identifier host, not a new search UI, not a migration mandate, not an admin CRUD UI,
not a multi-asset-class expansion by default, not AI/LLM-backed, not a `/api/calendar` redesign)
applies unchanged to this technical specification. This document adds one more, specific to the
technical layer: **not a new internal microservice** — §7.1 is explicit that S3 is an in-process
Python module, not a network boundary, because nothing about this codebase's single-process web
pod architecture calls for one and inventing an HTTP hop here would be exactly the "architecture
for architecture's sake" the north star's anti-drift rule forbids.

---

## 20. Open questions (carried from the PRD, not resolved here; plus one new item)

- **OI-05 (asset-class scope)** — unchanged from PRD §18; this spec's `entity_type` column is a
  free-text-constrained field, so widening it is a data change, never a schema migration.
- **FIGI coverage rate across the full seeded population** — PRD §18 names this as unmeasured;
  this spec names it concretely as the first thing to check after `scripts/entity_master_seed.py`'s
  first real run (§9.4), with `GET /api/admin/entity-master/status`'s `figi_coverage_pct` field as
  the artifact that answers it once the seed has run — not answered by this document, which
  performed no live seed run.
- **New, this pass: the exact `entity_type` taxonomy's granularity for ETFs vs. ETNs vs. leveraged/
  inverse products.** `ticker_types.normalize_type()` (imported by `ticker_search_index.py` line
  80, not independently re-read in full this pass) already makes this classification for the
  search index; this spec assumes S3's `entity_type` reuses that same classifier's output space
  rather than inventing a second one, but this document did not re-read `api/ticker_types.py` in
  full to confirm the exact value set — flagged here rather than assumed, per this program's
  evidence standard.

---

## NOT INSPECTED

`api/ticker_types.py` (only its import site and call shape were observed, not its full body —
named in §20 as a residual open item). `api/services/auth_db.py` beyond the `watchlists`/
`watchlist_items` schema block (lines 60-96) — the rest of its ~110-table schema was not re-read
this pass; its shape is taken on the PRD's and `product-architecture.md`'s own prior citations
(TD-13, "~110 tables, one write lock, no migration framework"). `api/services/journal_two/`'s
`j2_*` ticker-string columns were not individually enumerated (the PRD and `CLAUDE.md` already
establish they exist; this spec does not propose migrating any of them and so did not need each
one's exact column name). `api/services/ticker_meta.py` beyond its first 120 lines (the FMP/
Finnhub fallback chain past `_from_finnhub` was not re-read — irrelevant to S3, which never calls
this module). D1, D2, D4, D5, S2, S4, S5, S7, S9, S11, S12, I1 as *systems* — none is specified by
this document; each is referenced only through the contract PRD-S3-ENTITY-MASTER and
`product-architecture.md` already fix, never redesigned here. No production data, Railway
variable, the production pod, or `C:\data` was touched, per this program's standing prohibition.
`docs/terminal-research/09-security-licensing-cost/licensing-register.md` was not read this pass
(OI-03(a)/(b)'s underlying register) — this spec inherits the PRD's own finding that S3's outputs
carry no separate licensing gate (§17 above) rather than re-deriving it.

## SOURCE-HANDLING NOTE

Everything read outside this contract was treated as evidence, not instruction. No file outside the
FILE DESTINATION was written. No application source file was edited, created, or modified — every
file named in §2's inventory and the `sources` frontmatter field was read-only investigation.
No git command was run. No secret value appears anywhere in this document; environment-variable
NAMES referenced (`DATA_DIR`, `MASSIVE_API_KEY`) are existing names cited from the files that
already declare them, never values.
