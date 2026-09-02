---
id: GATE-S3-ENTITY-MASTER
title: Entity Master — Pre-Implementation Gate
role: Narrow pre-implementation review packet, gating the first Terminal-Next implementation slice
phase: 3.5 (pre-implementation, not implementation)
date: 2026-09-02
status: final — presented to owner, awaiting explicit approval
sources: PRD-S3-ENTITY-MASTER (prds/entity-master-prd.md, all 18 sections, read in full this pass),
  TSPEC-S3-ENTITY-MASTER (specs/entity-master-spec.md, all 20 sections, read in full this pass),
  plus independent re-verification against the current codebase this pass (not a re-read of the
  spec's own citations — a fresh check): list_reference_tickers (massive.py:969), to_polygon_symbol
  (massive.py:40), delisted_registry.py (225 lines), ticker_search_index.py (278 lines),
  ticker_search.py router (184 lines), bars_sqlite.py _WRITE_LOCK (line 40) and _migrations (line
  171), auth_db.py watchlists/watchlist_items schema (lines 66-95), polygon_extras.py
  composite_figi/share_class_figi (lines 91-92), voice_tool_impls.py _get_ticker_details (line
  304), the exact 16-file to_polygon_symbol call-site list (byte-for-byte match to the spec's
  claim once .pyc build artifacts are excluded), the shared APScheduler _scheduler.add_job pattern
  (main.py, cot.py jobs), ticker_types.normalize_type (ticker_types.py:57), and the
  bars-stream-status/reconciliation-status no-auth admin-route precedent (routers/bars.py). No PRD
  or spec content was rewritten — no concrete defect was found in either document.
---

# Entity Master — Pre-Implementation Gate

No application code has been modified to produce this packet. No new research was opened. The PRD
and technical specification were read in full and independently re-verified against the current
codebase rather than trusted at face value; every claim below is either a direct restatement of
those two documents (cited by section) or a finding from this pass's own verification.

---

## 1. Why Entity Master First

**ORIGINAL TERMINAL VISION → USER WORKFLOWS → NEED FOR SHARED CONTEXT → ENTITY MASTER →
DOWNSTREAM SYSTEMS**, traced concretely:

The north star names "cross-security/contextual navigation," "watchlists," "alerts," and
"AI-assisted research" as capabilities to materially improve — not as independent features, but as
things a member does *across* surfaces in one session (load a security, read its fundamentals, set
an alert, ask the AI layer about it, see it on a watchlist a year later). Every one of those actions
today refers to the same instrument by a mutable ticker string, and the codebase already shows the
failure mode this causes: Model Book hand-curates `sector`/`industry` watermark columns per stock
per year specifically because a reused ticker (`SQ` = Square → Block) makes the live lookup return
the wrong company for a historical entry (PRD §3, item 1) — a symptom patched per-surface because
there is no shared identity underneath. `capability-ledger.md` row C3 independently confirms the
same gap from the context-propagation side: UCT's existing link-group mechanism carries a "hard
ceiling of four symbol-only groups" — a string, not an identity.

Entity Master is the fix at the root rather than the tenth per-surface patch: **one permanent
internal id, with the ticker as a dated alias**, so a rename, a delisting, or a share-class quirk
is represented once and every consumer inherits the correct behavior automatically.

**Systems that materially depend on it** (verified against the PRD's §15 dependency table and the
architecture's own boundary matrix — not asserted without a citation):

| System | Real dependency | Evidence |
|---|---|---|
| Global search / command (S2) | Depends on `resolve()` for typed-token resolution | PRD §15, product-architecture.md §8 boundary matrix |
| Context Bus (S4) | Entity ids are the typed `entity` payload kind | information-architecture.md §10.1; PRD §15 |
| Persistence (S5) | Every new saved object foreign-keys on entity id | product-architecture.md §3.2 rule 2; PRD §6.4 |
| Alerts (S7) | Scopes a trigger to a resolved entity | PRD §15 |
| Canonical Data Model (D2) | Every stored value keyed by entity id | product-architecture.md §5-D D2 |
| Provider Abstraction (D1) | Symbol translation calls route through S3's `vendorSymbol` | PRD §15 |
| AI/Research (I1) | Unambiguous resolution before any citation-bearing tool call — via S2/S3, never a private path | PRD §10, §15 |
| Applications generally (charts, fundamentals, news, etc.) | Any new stored reference foreign-keys on entity id | PRD §6.4 |

**What does NOT depend on it, stated explicitly so this isn't overclaimed:** market data streaming
(D3), caching (D4), the market clock (S11 — S3 *consumes* it, doesn't depend on its existence to
function, per spec §6's `as_of=None` design), and the shell/workspace (S1). Portfolio/risk (A14) and
screening (A9) are not blocked on S3 — they would benefit eventually but nothing in the PRD claims
they are gated on it today.

---

## 2. Exact Implementation Scope

**MUST BUILD NOW** (the smallest coherent foundation; without any one of these, the system does not
function as designed):
- The five-table schema (`entities`, `entity_aliases`, `entity_vendor_symbols`, `entity_figi`,
  `entity_relations`, `entity_events`, `_migrations`) — spec §4.2.
- The four read primitives (`resolve`, `aliases`, `vendor_symbol`, `related_to`) plus `apply_event`
  and the write-time no-collision guard — spec §6, §8.4.
- The in-memory resolution cache — spec §8.3 (this is what makes `resolve()` fast; without it the
  system technically works but misses its own performance target).
- The one-time backfill script (`scripts/entity_master_seed.py`) — spec §5.1. Without this, the
  store is empty and every other piece is untestable against real data shape.

**SHOULD BUILD NOW** (small, low-risk, and needed for the slice to be observably useful rather than
a service nobody calls yet):
- The two additive extensions to `ticker_search_index.py` and `/api/ticker-search`'s response shape
  (spec §2.2) — this is what lets the entity id start flowing into a real, already-shipped surface,
  which is the concrete proof this slice does something, not just a schema in a vacuum.
- The admin status/reconcile/event routes (spec §7.3-7.4) — the operational lever to inspect and
  correct the store without a hand-editing UI (explicitly out of scope, PRD §2).
- The reconciliation job (spec §10.2) — without it, the store goes stale the day after seeding,
  which defeats the point; it is narrowly scoped (delist/new-entity only, never rename) and already
  carries an explicit sunset condition (PRD §9.5.1, register item D15).

**DEFER** (real, but not required for this slice to be sound):
- **OpenFIGI fallback resolution** (spec §9.4). Massive's reference feed already covers the FIGI
  need for the equity/ETF population this slice targets first (PRD §9.1, confirmed this pass at
  `polygon_extras.py` lines 91-92); OpenFIGI only matters for indices and pre-2003 delisted names,
  a small population. Ship without it; the schema already has a nullable FIGI column, so adding the
  fallback later is a pure addition, not a migration.
- **Migrating any existing consumer** (`watchlist_items.sym`, journal_two's ticker columns, etc.) to
  entity-id foreign keys. Explicitly out of scope for this slice and for the system generally
  (PRD §16 item 6, spec §13) — new consumers use entity ids from day one; existing ones migrate
  opportunistically, later, when touched for an unrelated reason.
- **The FIGI-coverage-rate measurement** across the full seeded population (spec §20) — a day-1
  operational task to run *after* the first real seed, not a design gate before building.

**EXPLICIT NON-GOALS** (restated from PRD §16 and spec §19, unchanged, not reopened here): not a
pricing/fundamentals/data-quality system; not the universe/membership gate (`cap_universe.json`
stays authoritative for "is this in scope," S3 only answers "is this the same thing"); not the
market clock; not a licensed-identifier host (CUSIP is excluded by design); not a new search UI;
not a migration mandate; not an admin CRUD UI; not a multi-asset-class expansion by default (ships
type-tagged, widening later is a data change); not AI/LLM-backed; not a new internal microservice
(in-process Python module only, consistent with the single-uvicorn-process constraint); not a
redesign of any Terminal-Current or partner-owned file.

**This is a small, bounded slice.** It does not become a universal financial-instrument platform —
five tables, four read primitives, one write path, one seed script, one narrow interim job.

---

## 3. Current State → Target State

**CURRENT STATE** (verified by direct read this pass, not restated from memory):
- No internal permanent entity id exists anywhere in the codebase. Every candidate store —
  `cap_universe.py`, `delisted_registry.py`, `ticker_search_index.py`, `watchlist_items.sym`
  (confirmed: `auth_db.py` lines 78-85, `sym TEXT NOT NULL`, no entity FK) — is keyed on the mutable
  ticker string.
- `to_polygon_symbol()` (`massive.py:40`) is a real, working, single-purpose string rewrite
  (`BRK-B`→`BRK.B`) at exactly the Massive REST boundary — confirmed present in exactly 16 source
  files (verified this pass; the spec's own count matches byte-for-byte once build-artifact `.pyc`
  files are excluded from a naive grep).
- `delisted_registry.py` (225 lines, confirmed) already implements a partial, working "mark, don't
  erase" pattern for one consumer (the bars/chart path) — a distinct-key convention for reused
  tickers (`BSC-OLD`), a `[first_date, last_date]` clamp, seeded from a Massive census plus a
  manually-imported pre-2003 CSV.
- `ticker_search_index.py` (278 lines, confirmed) already builds a name-and-type-bearing index from
  the exact Massive endpoint (`list_reference_tickers`, `massive.py:969`, confirmed) the design
  specifies — but keyed by ticker string, rebuilt from scratch daily, not bitemporal.
- `polygon_extras.py` (confirmed, lines 91-92) shows Massive's reference response already carries
  `composite_figi`/`share_class_figi` — read today but discarded by every caller except one voice
  tool (`voice_tool_impls.py::_get_ticker_details`, confirmed at line 304).
- `/api/ticker-search` (`ticker_search.py`, 184 lines, confirmed) already merges three sources
  (index, breadth pseudo-tickers, delisted registry) with a working "a live ticker wins" precedence
  rule.
- **Known inconsistency this pass's own investigation surfaced** (not new to this packet — carried
  from Phase 3's D13 work, unrelated to S3 directly but illustrative of the same root problem this
  system solves): Compass can show two different words for "regime" in one conversation because two
  unrelated classifiers share a name — the general pattern of "no single identity/vocabulary
  authority" recurring across the estate (RG-32).

**TARGET STATE** (per the PRD/spec, restated concisely): a bitemporal entity store with one
permanent id per instrument, a dated alias table (never deletes, only closes), a per-vendor symbol
mapping table (replacing the one-function-per-vendor-pair pattern), a FIGI external mapping
(nullable, never the primary key), and typed relations for share-class and successor/predecessor
links — populated by a one-time backfill from data already in the repository, kept fresh by a
narrow interim reconciliation job pending D5's real corporate-action feed.

**THE GAP:** exactly the five items above — no identity layer exists; the pieces around it
(membership list, name index, delisted registry) are real and reusable, but nothing unifies them
into one addressable identity.

---

## 4. File / Component Impact Map

**CONFIRMED** (directly re-read this pass, independent of the spec's own citation):

*Reused, unmodified:*
- `api/services/cap_universe.py` (69 lines)
- `api/services/massive.py::list_reference_tickers()` (line 969) and `::to_polygon_symbol()` (line 40)
- `api/services/delisted_registry.py` (225 lines)
- `api/data/delisted_tickers.json`, `delisted_tickers_bulk.json`, runtime overlay file
- `api/services/polygon_extras.py` (FIGI fields, lines 91-92)
- `api/services/voice_tool_impls.py::_get_ticker_details` (line 304) — left unmodified
- `api/services/bars_sqlite.py` — `_WRITE_LOCK` (line 40) and `_migrations` (line 171) as **pattern
  references** (a copied idiom, not imported code — a new lock object, a new migrations table in a
  new file)
- `api/services/auth_db.py` `watchlists`/`watchlist_items` schema (lines 66-95) — cited as evidence
  of the current (unmigrated) state, not a component S3 touches

*Modified (small, additive):*
- `api/services/ticker_search_index.py` — extend `_collect_rows()` (lines 76-134) to retain
  `composite_figi`/`share_class_figi`/`cik`/`list_date`/`delisted_utc` and add one `entity_id` field
  per row
- `api/routers/ticker_search.py` — add `entity_id: string | null` to the response row shape (line
  127 docstring + 3 emit sites)

*New (confirmed via this pass's own check: `api/services/entity_master/` does not currently
exist):*
- `api/services/entity_master/api.py`, `schema.py`, `store.py`, `reconciliation.py` (new package)
- `scripts/entity_master_seed.py` (new, offline, admin-run)
- `api/routers/entity_master_admin.py` (new, `require_admin` for writes, no-auth for `GET /status`
  — confirmed precedent: `/api/admin/bars-stream-status` and `/api/admin/reconciliation-status` in
  `routers/bars.py` are genuinely no-auth by explicit design, verified this pass)
- One new SQLite file: `<DATA_DIR>/entity_master.db`

*Scheduling:* registers on the existing `_scheduler` (APScheduler) instance in `api/main.py` —
confirmed this pass: `_cot_service`'s jobs already register on this exact shared instance via
`_scheduler.add_job(...)`, no new scheduling mechanism needed.

**LIKELY / NOT INDEPENDENTLY VERIFIED** (named honestly, per the spec's own NOT INSPECTED section
and this pass's own scope):
- `api/ticker_types.py::normalize_type()` — confirmed to exist at line 57, but its exact output
  taxonomy (ETF vs. ETN vs. leveraged/inverse granularity) was not read in full by either the spec
  or this pass. **Action before schema finalization:** read this function's body once (a 15-minute
  task) to confirm S3's `entity_type` column can reuse its output space directly, per spec §20's own
  flag.
- The exact fraction of the eventual entity population that will carry a FIGI from Massive alone —
  genuinely unmeasured, requires a live seed run (deferred to §2 above by design).
- `api/services/journal_two/`'s `j2_*` ticker-string columns — not individually enumerated (not
  needed; nothing proposes migrating them).

**Database/schema changes:** one new file, zero changes to any existing database.
**Migrations:** none to existing stores; the new store's own `_migrations` table follows the
`bars.db` pattern for its own future schema evolution.
**APIs:** one modified response shape (additive field only), three new admin routes.
**Frontend consumers:** none required by this slice — `entity_id` flows into the search response but
no frontend component is required to read it yet (S4/Context Bus, which would consume it, doesn't
exist yet). This is intentional: the field is dormant-but-present, per spec §5.3 step 2.
**Deployment/Railway implications:** none identified — a new SQLite file under the existing
`DATA_DIR` volume, no new service, no new environment variable required for the MUST/SHOULD scope
(OpenFIGI, if built later, would need no API key — it's free and keyless).

---

## 5. Data Model

*(Summarized at review-detail; full DDL is spec §4.2, verified present and internally consistent
this pass.)*

| Object | Purpose | Canonical ID | Key fields | Uniqueness | Lifecycle | Provenance |
|---|---|---|---|---|---|---|
| **Entity** | The permanent identity of one instrument (company/issuer or instrument, not further split — see below) | `entity_id` (`ent_<ULID>`) | `entity_type`, `lifecycle_state`, `lifecycle_since` | PK | active → delisted → renamed-successor-exists; never deleted, never reused | `created_at`/`updated_at` only — the *facts about* an entity carry their own provenance via `entity_events` |
| **Alias** | A dated ticker string for an entity | surrogate int PK | `entity_id`, `alias`, `valid_from`, `valid_to` | app-enforced: no two entities may hold the same alias with overlapping valid windows | rows never delete; retiring closes `valid_to` | `source` column (seed vs. event-derived) |
| **Vendor symbol mapping** | A vendor's own notation for an entity, when it differs from the canonical alias | surrogate int PK | `entity_id`, `vendor`, `vendor_symbol`, dated | unique on `(entity_id, vendor, valid_from)` | dated, additive | `source` column |
| **FIGI mapping** | External, licensing-safe permanent identifier | `entity_id` (1:1) | `composite_figi`, `share_class_figi` | PK = entity_id | updated in place (a corroborating external fact, not history itself) | `source` (`massive_reference` or `openfigi`) |
| **Relation** | Typed link between entities | surrogate int PK | `entity_id`, `related_entity_id`, `kind` (successor/predecessor/share_class) | app + CHECK constraint (no self-relation) | additive | `source` column |
| **Event** | The append-only input log every identity change is applied through | surrogate int PK | `dedup_key` (idempotency), `event_type`, `payload_json` | `dedup_key` UNIQUE | append-only, never mutated | `source` (`d5`/`reconciliation`/`admin_manual`), `rejected_reason` when refused |

**COMPANY/ISSUER vs. SECURITY/INSTRUMENT vs. LISTING vs. SYMBOL vs. EXCHANGE vs. PROVIDER
IDENTIFIER — addressed only to the depth UCT actually needs, not Bloomberg-scale:** the schema does
**not** model a separate "company" object above "security" — one `entities` row represents one
tradeable instrument, and the `share_class` relation links siblings (`GOOG`/`GOOGL`) that share an
issuer without introducing an issuer-level table nobody asked for. This is a deliberate, justified
simplification: nothing in the PRD's six use cases needs an issuer object distinct from its
instruments, and adding one now would be exactly the "unnecessary Bloomberg-scale abstraction" the
gate packet's own instruction warns against. Exchange/venue is not a modeled entity either — it
travels as `primary_exchange` metadata on the seed input, not as a first-class relation, because no
use case requires querying "all entities on exchange X" through S3 itself. Provider identifiers are
the `entity_vendor_symbols` table, exactly as specified.

**The one genuinely deferred modeling decision, resolved by the spec, not left open:** the
`GOOG`/`GOOGL` share-class question is answered — **two entities, linked by relation**, not one
entity with two open aliases — because `aliases(entity, asOf=t)` is documented to return the single
alias valid at that time (spec §4.4), and two simultaneously-tradeable share classes need two
independently-resolvable identities. This is distinguished cleanly from `BRK-B`/`BRK.B`, which is
one entity with two *vendor notations*, not two entities. A required test fixture
(`test_share_class_vs_vendor_notation`, spec §12) locks this in before the code ships.

---

## 6. Identity / Resolution Behavior

Answered directly, per the PRD/spec, not paraphrased:

- **"What does AAPL refer to?"** `resolve("AAPL", asOf="now")` — an in-memory dict lookup, sub-10ms,
  returning the one entity whose alias table has `AAPL` valid today.
- **"What happens if a ticker changes?"** The old alias closes (`valid_to` set); a new alias opens
  on the same entity (a rename) or a new entity is created if the underlying company is
  discontinuous from the ticker's new holder (§6.3 invariant 3's distinction). Historical resolution
  (`asOf` in the past) still returns the correct entity for the period it was valid.
- **"What happens if two exchanges use the same symbol?"** Not modeled as a first-class case in this
  slice — the PRD's alias model is one global namespace per ticker string (U.S.-listed scope, per
  OI-05's current default), not exchange-scoped. If this becomes a real requirement, it is an
  alias-table addition (an exchange-qualified alias), not a schema rewrite — flagged here as a
  genuine scope boundary, not silently assumed away.
- **"How are provider-specific IDs reconciled?"** `vendorSymbol(entity, vendor)` — a stored,
  per-entity, per-vendor lookup, replacing `to_polygon_symbol()`'s single-purpose rewrite function
  with a general table any future vendor registers into.
- **"What becomes the stable internal identifier?"** `entity_id` (`ent_<ULID>`) — assigned once,
  never reused, never member-facing (the ticker alias is what members see).
- **"How does a news article attach to an entity/security?"** Not built by this slice — a future
  news-ingestion consumer would call `resolve()` at ingestion time and store the entity id, exactly
  as any new consumer does per §6.4's platform contract. This PRD does not modify the news pipeline.
- **"How does an event attach to it?"** Same pattern — a future Events/Calendar consumer resolves
  and stores the entity id; not built by this slice.
- **"How does a chart/fundamentals panel receive context?"** Via the Context Bus (S4), which is not
  built yet — S3's contract with it (entity id as the payload) is frozen by the architecture but not
  implemented until S4 exists. This slice does not wire any panel.
- **"How does global search return the correct object?"** `/api/ticker-search`'s existing merge
  logic is unchanged; it gains an `entity_id` field per result row so a future consumer (S2, not
  built yet) can key off identity instead of the ticker string — dormant until S2 exists.
- **"How does historical data survive symbol changes?"** This is explicitly **not** solved by this
  slice for existing data (bars, etc. stay ticker-keyed) — it is solved *going forward* for any new
  store that adopts entity-id foreign keys from day one (§6.4), and *for identity itself* (a
  historical roster resolving a since-renamed entity correctly), which is different from bars data
  surviving a rename (a separate, `data-architecture.md`-owned concern about adjustment policy, not
  S3's job).

**Intentionally deferred, named explicitly:** exchange/venue-qualified aliases (above); FIGI
coverage for non-Massive-covered entity types (OpenFIGI, §2); any migration of existing
ticker-keyed consumers (§2, §13.2).

---

## 7. Provider Interaction

**What Entity Master needs from Provider Abstraction now:** exactly one call,
`massive.list_reference_tickers()`, made directly (D1 does not exist as a system yet) — the same
call `ticker_search_index.py` already makes today. No new provider dependency is added.

**What interfaces/contracts should exist now:** the `vendor_symbol(entity_id, vendor)` primitive and
the `entity_vendor_symbols` table are the *interface* D1 will eventually sit behind — when D1 is
specified and built, S3's two call sites (the seed script and the reconciliation job) re-point
through D1's adapter instead of `massive.py` directly. This is a one-file change per call site, not
a redesign, because the interface (a stored, per-vendor symbol table) already exists independent of
who populates it.

**What belongs later in Provider Abstraction, deliberately not built here:** the anti-corruption
layer pattern itself (a generic per-vendor adapter with typed errors, rate-limit handling, and
failure taxonomy — Provider Abstraction's own full scope) is D1's system, not S3's. S3 does not
build a generic adapter framework; it makes exactly the two calls it needs (Massive reference data,
OpenFIGI fallback) directly, following the existing direct-call pattern every other module in this
codebase already uses.

**How Massive interacts with this first slice, per actual evidence:** `list_reference_tickers()`
already returns `composite_figi`, `share_class_figi`, `cik`, `list_date`, `delisted_utc`, `active` —
confirmed this pass — so no new Massive endpoint or field is required; the backfill and
reconciliation job read fields the existing call already returns and one current caller
(`ticker_search_index`) discards.

**Entity Master does not swallow Provider Abstraction:** confirmed by the scope boundary above — no
generic adapter, no typed error taxonomy, no rate-limit/retry framework is proposed inside
`entity_master/`. Those are explicitly D1's future business.

---

## 8. Migration / Compatibility

**Nothing that works today stops working.** This is the load-bearing compatibility property, and it
holds by construction, not by hope:
- `to_polygon_symbol()` and `delisted_registry.py`'s `_provider_alias` mechanism are **not**
  modified or removed — they keep serving their current 16+ call sites exactly as today. They are
  retired incrementally, per call site, only once each is migrated to call S3's primitives instead
  — never on S3's arrival.
- The two modified files (`ticker_search_index.py`, `ticker_search.py`) gain fields; nothing
  existing is removed, renamed, or reordered. A client reading the search API today and ignoring the
  new `entity_id` field behaves identically to today.
- No existing database table is altered. `watchlist_items.sym` and every other ticker-string-keyed
  column stay exactly as they are.
- No existing route changes shape or is removed.
- No existing frontend assumption breaks — no frontend code is required to change for this slice to
  ship.
- No provider call changes — the same Massive endpoint, already called today, is read more fully
  (more fields kept), not called differently.

**Rollback strategy:** because nothing existing is modified in a breaking way, rollback is simply
not deploying/registering the new package and routes — the two "modified" files' changes are
additive fields a rollback can also drop without touching any other code path. The new SQLite file
can be deleted with no effect on any other store.

**This is incremental migration by construction, not a flag-day rewrite** — consistent with the
PRD's own explicit rejection of a fiat migration (§13.2) and the `data-architecture.md` precedent it
cites (`bars.db`: "not migrated by fiat, it grew into the pattern").

---

## 9. User-Visible Value

Entity Master itself has no UI (§7.1 of the PRD is explicit about this), so the honest answer here
is: **this slice alone produces no member-visible change.** Its value is entirely in what it
unblocks, and that should be stated plainly rather than oversold:

- **Immediately after this slice ships:** nothing is different for a member. The `entity_id` field
  exists in the search API response but nothing reads it yet.
- **What it makes possible, once S2/S4/S5/S7 exist and consume it** (not part of this slice, but the
  reason this slice is first): consistent security context across Terminal modules (loading a
  security once and having every panel agree on what it is); reliable search that survives a rename
  (search for the old name of a company and still find it, correctly labeled); no more silent symbol
  mismatches (Model Book's hand-curated watermark workaround becomes unnecessary for new content);
  correct historical rosters (a delisted holding renders as delisted, not blank or wrong); cleaner AI
  grounding (an AI answer citing "this stock" always means one unambiguous instrument).

**I am not claiming user value from this slice in isolation** — the honest framing is: this is
necessary, invisible infrastructure whose payoff is realized by the systems built on top of it, and
those are not part of this gate's approval ask. If that framing is not acceptable — if foundational
work must show member-visible value on its own — this slice does not clear that bar and should not
be approved as a standalone deliverable.

---

## 10. Test & Acceptance Plan

Ten tests, one per PRD acceptance criterion, plus one for the spec's own share-class resolution —
all against synthetic fixtures, none touching `cap_universe.json`, `C:\data`, or any production file
(consistent with the repo's own `conftest.py` tripwire):

| Test | Covers | What it proves |
|---|---|---|
| `test_rename_resolves_correctly` | AC-1 | A ticker that changed hands resolves to the right entity at the right time, both before and after |
| `test_delisting_marks_never_erases` | AC-2 | Historical resolution survives a delisting; the alias row is never dropped |
| `test_alias_collision_rejected_at_write` | AC-3 | A write that would violate the core invariant is refused, verified by querying the table directly, not just trusting the return value |
| `test_vendor_symbol_matches_to_polygon_symbol` | AC-4 | A **differential** test against the real existing function — the new and old mechanisms can never silently drift apart, because the test compares them directly |
| `test_event_replay_is_idempotent` | AC-5 | Replaying the same event sequence twice produces byte-identical state |
| `test_ambiguous_is_distinguishable_and_logged` | AC-6 | A deliberately-constructed data defect is surfaced, never silently arbitrated |
| `test_cold_start_returns_not_found_never_raises` | AC-7 | An empty store never crashes a caller |
| `test_as_of_consistency_across_primitives` | AC-8 | All four primitives agree at the same points in time |
| `test_no_cusip_shaped_identifier` | AC-9 | Static check — the identifier scheme never touches CUSIP |
| `test_existing_consumers_unaffected_during_rollout` | AC-10 | A **regression guard**: `to_polygon_symbol`, `delisted_registry.resolve`, `ticker_search_index.search`, `cap_universe.symbols` all still pass their own existing test suites unmodified — proof this build breaks nothing already working |
| `test_share_class_vs_vendor_notation` | Spec §4.4 | The dual-class modeling decision is locked in by a real fixture, not just a design paragraph |

**Measurable acceptance for the slice as a whole:** all eleven tests pass; the seed script runs
against a local/dev environment idempotently (re-running produces no duplicate rows — verifiable
directly); `GET /api/admin/entity-master/status` returns real counts after a seed run; the existing
`/api/ticker-search` test suite (if one exists) continues to pass unmodified.

**Performance sanity check:** `resolve()` on the hot path should be sub-10ms — verifiable with a
simple timed loop against the seeded store, no production telemetry required (the PRD explicitly
declines to invent a harder number without measured data, §14).

---

## 11. Risks

Only material risks — not padded:

| Risk | Impact | Mitigation | Reversibility |
|---|---|---|---|
| **The reconciliation job's delist/new-entity-only scope gets silently expanded to attempt rename detection** (a real temptation once the job exists and someone wants "one more thing" from it) | Would produce incorrect rename inferences from ambiguous delist+list pairs, corrupting identity — the exact failure mode this system exists to prevent | The spec names this exclusion explicitly and repeatedly (§10.2); a one-line code comment plus this gate's own record makes the boundary hard to miss. No automated rail proposed — deliberately, per the spec's own reasoning (§12: don't build a guard for a defect that hasn't occurred) | High — the job is isolated, self-expiring, and easy to correct or retire outright |
| **Share-class modeling choice proves wrong once tested against more real dual-class names** (only `GOOG`/`GOOGL` and `BRK-A`/`BRK-B` were reasoned about explicitly) | A small set of entities would need re-modeling (merge two entities into one, or split one into two) | The relation-based design (§4.4) was chosen specifically because it's more reversible than the alternative — re-keying entities is more disruptive than adjusting a relation table. The required test fixture forces this to be validated before merge, not discovered in production | Medium — fixable, but touches real seeded data if discovered late; cheapest to catch via the required test before the first real seed run |
| **FIGI coverage turns out lower than assumed for non-equity types**, weakening the external-mapping story for indices/futures-positioning symbols | A larger-than-expected fraction of entities have no FIGI, reducing the value of FIGI as a cross-checking identifier for those types | Explicitly deferred and named as a day-1 measurement task (§2, §9.4) rather than assumed; OpenFIGI fallback exists as a designed, if deferred, answer | High — additive fix, no schema change needed |
| **Provider coupling to Massive's specific field names** (`composite_figi`, `share_class_figi`, `delisted_utc`) baked into the seed script before D1 exists | If D1's eventual adapter changes field naming, the seed script and reconciliation job need updating | Explicitly scoped as a known, accepted interim state (§7, §9.3 of the spec) — one file each, not a redesign, when D1 lands | High — isolated to two call sites |
| **Migration/coupling to unresolved licensing questions (OI-03)** | None found — verified explicitly this pass: PRD §11 states S3's own outputs (an id, an alias, a lifecycle state) carry no separate licensing gate, and this pass's re-read confirms the reasoning holds (identity metadata, not vendor-proprietary content) | N/A — not a real risk for this slice specifically | N/A |
| **Over-modeling** (the generic failure mode of foundational work) | Would slow this slice down and violate the anti-drift rule | Checked explicitly in §5 above — no issuer-level object, no exchange-as-entity, no premature Bloomberg-scale abstraction found in either document | N/A — already avoided, not a live risk |

---

## 12. Owner-Bound Questions

**No unresolved owner decision blocks Entity Master implementation.** Verified explicitly, not
assumed:

- **OI-03(a)/(b)** (Massive tier, FMP DDLA) — does not block. S3's own outputs carry no licensing
  gate (§11 above); this item only matters to systems that display vendor *content* fields, which
  S3 does not do.
- **OI-05** (asset-class scope) — does not block. The schema is type-tagged specifically so this
  question can stay open; widening later is a data change, not a rebuild.
- **OI-06** (observed desk morning) — does not block. Nothing in S3's design depends on the
  workspace or command-grammar decisions that item gates.
- **OI-08/OI-18** (Bloomberg/Gödel access) — does not block. Both are cited in the PRD/spec only as
  corroborating evidence for the mark-don't-erase pattern, never as a requirement source.
- **D-002/D-003** (licensing posture, decisiveness-for-two-audiences) — do not block. Neither
  concerns identity resolution.

**One thing this gate flags for the owner's attention, not as a blocker:** the PRD's own §12 records
a genuine finding — Massive's reference endpoint already carries FIGI fields, narrowing an open
question in `data-architecture.md` — and explicitly did not silently correct that upstream document
to avoid a second-authority defect. This is a housekeeping item for a future documentation pass, not
a decision needed before implementation.

---

## 13. Implementation Sequence

Small, reviewable, checkpoint-bounded slices — using the actual dependency shape (schema before
primitives before write-path before seed before extension), not a forced generic template:

1. **Schema + contracts.** `schema.py`, `api.py`'s type definitions (`Entity`, `AliasRecord`,
   `ResolveResult`, `ApplyResult`), the new `entity_master.db` file with migrations. *Checkpoint:*
   schema created, empty store, `test_cold_start_returns_not_found_never_raises` passes.
2. **Resolution layer (read primitives, in-memory cache).** `resolve`, `aliases`, `vendor_symbol`,
   `related_to` against a hand-seeded test fixture (not real data yet). *Checkpoint:*
   `test_rename_resolves_correctly`, `test_as_of_consistency_across_primitives`,
   `test_share_class_vs_vendor_notation` pass against synthetic fixtures.
3. **Write path (`apply_event`, the collision guard, the write lock).** *Checkpoint:*
   `test_alias_collision_rejected_at_write`, `test_event_replay_is_idempotent`,
   `test_ambiguous_is_distinguishable_and_logged` pass.
4. **Seed script**, run against a local/dev environment (never production in this checkpoint).
   *Checkpoint:* idempotent re-run verified; `GET /api/admin/entity-master/status` (built alongside,
   since it's how this checkpoint is verified) shows real counts; `figi_coverage_pct` measured for
   the first time.
5. **Provider mapping backfill** (the `vendor_symbol` derivation for hyphenated aliases).
   *Checkpoint:* `test_vendor_symbol_matches_to_polygon_symbol` (the differential test) passes
   against real seeded data, not just the synthetic fixture.
6. **Compatibility integration** — the two additive extensions (`ticker_search_index.py`,
   `/api/ticker-search`). *Checkpoint:* `test_existing_consumers_unaffected_during_rollout` passes;
   manual verification that the live `/api/ticker-search` endpoint still returns identical results
   plus the new field.
7. **Reconciliation job**, registered but validated in a dry-run/logging-only mode before being
   trusted to write. *Checkpoint:* one manual trigger via the admin route, output inspected by hand
   before the scheduled cadence is enabled.
8. **Validation** — full test suite green, protection rail re-verified (empty app diff outside this
   slice's own new/modified files, production health unaffected since nothing production-facing
   changed), a final read-through against this gate's own risk table.

Each numbered step is a natural commit boundary; step 4 is the first point real (not synthetic) data
enters the system and is the natural point for a check-in before proceeding further, if the owner
wants a mid-sequence look rather than only a final review.

---

## 14. Alignment Check

**"Does implementing Entity Master now move us materially closer to the UCT Terminal envisioned in
the original program?"**

Yes. It is the specific, named fix for a specific, evidenced failure class (identity fragmentation)
that blocks or degrades a large fraction of the north star's own capability list — cross-security
navigation, reliable search, correct historical rendering, trustworthy AI citation, and every future
watchlist/alert built on a stable reference. It is infrastructure the vision explicitly calls for
("provider abstraction where required to make the experience reliable" implies the identity layer
underneath it), not infrastructure invented for its own sake.

**"Are we building only the foundation necessary for that vision, or has Entity Master scope
expanded beyond what the Terminal currently needs?"**

No expansion found. §2's MUST/SHOULD/DEFER split is deliberately narrow: five tables, four
primitives, one seed script, one narrow interim job. No issuer-level object, no exchange-as-entity,
no multi-asset expansion, no new microservice, no admin UI, no migration mandate. The one place
scope could have crept — the interim reconciliation job — is explicitly boundary-limited (never
rename detection) and self-expiring (retires the day D5 ships). Nothing in this review found reason
to remove or defer anything further from the MUST/SHOULD scope already proposed.

---

## 15. Final Gate

# IMPLEMENT WITH CONDITIONS

**Exact scope authorized, if approved:** the MUST BUILD NOW and SHOULD BUILD NOW items in §2 —
schema, primitives, write path, in-memory cache, seed script, the two additive search extensions,
the admin routes, and the narrow reconciliation job. OpenFIGI fallback and any consumer migration
remain explicitly deferred, not part of this authorization.

**Conditions:**
1. Read `api/ticker_types.py::normalize_type()` in full before finalizing the `entity_type` schema
   choice (§4's one LIKELY item) — a 15-minute check, not a redesign, done as the first step of
   implementation sequence item 1.
2. The reconciliation job ships with the rename-exclusion comment and this gate's own record cited
   in it, so the boundary survives a future engineer who wasn't in this conversation.
3. Sequence item 4 (the first real seed run) is a natural checkpoint for the owner to look at actual
   output (`figi_coverage_pct`, entity counts) before proceeding to steps 5-7, if desired — not a
   mandatory pause, but flagged as the first point this stops being purely synthetic.
4. No step in the sequence touches production data or the production pod — all seed/test work
   targets a local/dev environment per the PRD/spec's own standing constraint.

**Expected checkpoints:** the eight steps in §13, each independently testable and each a natural
commit boundary.

**Explicitly out of scope for this authorization:** OpenFIGI integration, any migration of
`watchlist_items` or any other existing store, D5's real corporate-action feed (the reconciliation
job's interim substitute stays interim), and any system beyond S3 itself (S2/S4/S5/S7/D1/D2 remain
unimplemented, per Phase 3's own sequencing recommendation).

**What should follow Entity Master if this implementation succeeds:** per the Phase 3 exit report's
own sequencing logic — the Provider Abstraction Layer (D1) next, since the Entity Master's
reconciliation job and seed script already call Massive directly and would benefit immediately from
a real adapter boundary once D1 exists, and every other locked system's spec was written expecting
D1 to follow S3.
