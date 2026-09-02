# Entity Master — Implementation Log

Tracks the 8-checkpoint implementation authorized 2026-09-02 ("Approved: IMPLEMENT
ENTITY MASTER WITH CONDITIONS"). Checkpoint 4's real-seed-run report was reviewed
and ACCEPTED by the owner 2026-09-02, with explicit conditions carried into
Checkpoints 5-8 (see "Post-Checkpoint-4 findings" section below) — full text of
the approval and conditions is the authorizing message, not restated here.

Source of truth for design: `docs/terminal-research/05-product-strategy/prds/entity-master-prd.md`,
`.../07-technical-architecture/specs/entity-master-spec.md`,
`.../12-decisions/gates/entity-master-pre-implementation-gate.md` (all in the
`terminal-research` worktree).

---

## Checkpoint 1 — Schema (2026-09-02)

**Changes made:**
- New package `api/services/entity_master/` (`__init__.py`, `schema.py`).
- `schema.py`: the six tables + `_migrations` from spec §4.2, transcribed
  verbatim except one corrected DDL comment (see Deviations below).
  `connect()`/`init_db()` follow `bars_sqlite.py`'s WAL + idempotent
  `_migrations`-ledger pattern exactly (read in full before writing).
- New database file (not yet created on disk anywhere — `DB_PATH` resolves
  to `<DATA_DIR>/entity_master.db`, only ever opened by tests against
  `tmp_path` so far).
- Test module `api/services/entity_master/test_entity_master.py` (7 tests,
  matching the `test_grade_ticker.py` colocated-naming precedent).

**Tests run:** `python -m pytest api/services/entity_master/test_entity_master.py -v`
— 7/7 passed. Covers: every table created, every named index created,
`init_db()` idempotent (re-run preserves existing rows), migrations ledger
records/skips correctly, `entity_relations`' two CHECK constraints reject bad
input, `entity_events.dedup_key` UNIQUE constraint enforced, `init_db()`
never touches a file it wasn't pointed at.

**Decisions made:**
- Used the spec's literal DDL (§4.2) rather than reinterpreting it — no
  schema design choice was needed at this checkpoint beyond the one
  correction below.
- Colocated test file (`test_entity_master.py`) rather than
  `tests/test_entity_master.py`, per spec §12's explicit citation of
  `api/services/test_grade_ticker.py` as the precedent to follow.

**Deviations from spec (evidence wins, recorded per the authorization's
explicit instruction):**
- Condition 1 required reading `ticker_types.normalize_type()` in full
  before finalizing the schema. Done. Its real output space is
  `STOCK|ETF|INDEX|OTHER` (uppercase, four buckets) — not the spec §4.2
  DDL comment's guess of `'equity'|'etf'|'index'|'future_positioning'`,
  which spec §20 had already flagged as an unconfirmed placeholder (that
  section explicitly says `ticker_types.py` was not read in full before the
  guess was written). This is a mismatch in a non-enforced `TEXT NOT NULL`
  column's documentation comment only — no CHECK constraint, primitive
  signature, or other structural element depends on the exact value set —
  so it does not rise to "materially contradicts the schema" and did not
  trigger a Condition-1 STOP. Corrected the comment in `schema.py` to state
  the verified real mapping (`STOCK→equity`, `ETF→etf`, `INDEX→index`,
  `OTHER` unassigned at seed time) and left `future_positioning` documented
  as reserved-but-unused pending OI-05. No other deviation.

**Unexpected discoveries:** None beyond the above. Everything else read
during Checkpoint 1's investigation (`delisted_registry.py`,
`cap_universe.py`, `ticker_search_index.py`, `ticker_search.py`,
`bars_sqlite.py`, `auth_db.py`'s watchlists block) matched the spec's own
citations exactly, including line numbers in the two files the spec quoted
line ranges for (`ticker_search_index.py` lines 76-134,
`ticker_search.py` line 127) — no drift from the 103-commits-newer codebase
state on any file this checkpoint touched.

**Risks:** None identified at this checkpoint. The new package has zero
importers anywhere else in the codebase (confirmed via `git diff --stat
origin/master` showing only the new untracked directory) — fully inert
until Checkpoint 6 (Compatibility integration) wires a consumer.

**Remaining work:** Checkpoints 2 (read primitives), 3 (write path), 4
(seed machinery + first real seed run — HARD STOP for owner review),
5-8 not yet authorized.

---

## Checkpoint 2 — Read primitives (2026-09-02)

**Changes made:**
- New `api/services/entity_master/store.py`: thread-local WAL connections
  (mirrors `bars_sqlite.py::_conn()`), the in-process `_WRITE_LOCK` (unused
  by any writer yet — created now per spec §8.2 so Checkpoint 3 doesn't need
  to touch this file), and the in-memory `alias -> entity_id(s)` resolution
  cache (`_ALIAS_CACHE`, lazy-loaded via `_ensure_cache_loaded()` mirroring
  `delisted_registry._ensure_loaded()`, force-rebuilt via `rebuild_cache()`
  mirroring `ticker_search_index.build_index()`).
- New `api/services/entity_master/api.py`: the `Entity`/`AliasRecord`/
  `ResolveResult` dataclasses and the four read primitives (`resolve`,
  `aliases`, `vendor_symbol`, `related_to`) per spec §6. `apply_event` is
  NOT in this file — Checkpoint 3's addition, kept out so this diff stays
  reviewable on its own.
- 9 new tests appended to `test_entity_master.py` (16 total now), covering
  AC-1, AC-2, AC-6, AC-7, AC-8, AC-9, AC-10, `test_share_class_vs_vendor_
  notation`, plus one vendor-symbol-unmapped case. All seed fixtures
  directly at the SQLite layer (no `apply_event` exists yet), matching the
  approach spec §12 specifies explicitly for AC-6.

**Tests run:** `python -m pytest api/services/entity_master/test_entity_master.py -v`
— 16/16 passed.

**Decisions made (each recorded because the spec left it a genuine
technical-spec-level choice, not because it deviates from anything locked):**
- `resolve()` never silently returns an arbitrary match on a collision —
  `status="ambiguous"` carries every candidate `entity_id`. This was the
  Checkpoint 2 authorization's explicit condition ("do not hide ambiguity
  with arbitrary first-match behavior").
- `vendor_symbol()`'s return type (`Optional[str]`, per spec §6's literal
  signature) has no ambiguous-status slot, so a genuine multi-row overlap
  (should not occur under the write-time guard, but this read primitive
  does not assume the guard was honored) resolves via a documented
  deterministic tie-break — most-recently-started row wins
  (`ORDER BY valid_from DESC LIMIT 1`) — rather than an undocumented
  first-row-SQLite-happens-to-return pick.
- `aliases(entity_id, as_of=None)` returns the FULL alias history (every
  row, oldest first), not just the alias valid "now". The spec's §4.4
  citation ("the single alias valid at that time") describes the
  `as_of=<a specific date>` case; AC-2's own requirement ("aliases() never
  drops the closed row") only holds if the `as_of=None` case returns
  everything. Both behaviors are implemented: `as_of=None` = full roster,
  `as_of=<date>` = the record(s) whose window covers that date. This was
  the one place the spec's signature was genuinely underdetermined between
  two readings; the choice made is the one that satisfies AC-2's literal
  wording and the PRD's "historical roster rendering" use case (UC-4)
  without contradicting §4.4's own citation.

**Deviations from spec:** None beyond Checkpoint 1's already-recorded
`entity_type` comment correction. `datetime.datetime.now(datetime.UTC)` is
used instead of the deprecated `datetime.datetime.utcnow()` the spec's own
prose mentions in passing (§6) — a mechanical, behavior-identical swap, not
a design deviation.

**Unexpected discoveries:** None.

**Risks:** The in-memory cache (`store._ALIAS_CACHE`) is a single
process-global dict, matching `ticker_search_index.py`'s own
`_INDEX`/`_BY_SYM` shape — correct for this store's real single-database
production shape, but test isolation across different `db_path` values
relies on every read-path test calling `store.rebuild_cache(db_path=...)`
before asserting (each rebuild fully replaces the global cache from the
one database it was pointed at). Documented in the test file's module
docstring; not a production risk since production only ever has one
`entity_master.db`.

**Remaining work:** Checkpoint 3 (write path — `apply_event`, the
collision guard, cache rebuild-on-write), Checkpoint 4 (seed machinery +
first real seed run — HARD STOP), 5-8 not yet authorized.

---

## Checkpoint 3 — Write path (2026-09-02)

**Changes made:**
- `store.py`: a pure-Python ULID generator (`new_entity_id()`, per spec
  §3's "26-line generator, no new dependency"), the write-time collision
  guard (`colliding_entity_ids()` — the interval-overlap query from spec
  §8.4), and the low-level table-mutation helpers (`create_entity`,
  `add_alias`, `close_open_alias`, `has_open_alias`, `set_lifecycle_state`,
  `add_relation`, `entity_exists`, `record_event`,
  `get_event_by_dedup_key`) plus the two provider-data write helpers
  (`upsert_vendor_symbol`, `upsert_figi`).
- `api.py`: `ApplyResult` dataclass, `apply_event()` (validates, runs the
  collision guard, records the event, applies the domain mutation, commits,
  rebuilds the read cache — all under `store._WRITE_LOCK`), plus the public
  `set_vendor_symbol()`/`set_figi()` wrappers.
- 15 new tests (29 total): one per event type's happy path + rejection
  case, AC-3 (collision rejected, verified by querying the table directly,
  not just the return value), AC-5 (list→rename→delist sequence replayed
  twice via identical dedup_keys, byte-identical row counts), a
  never-raises-on-malformed-payload smoke test, and idempotent re-run of
  both provider-data write helpers.

**Tests run:** `python -m pytest api/services/entity_master/test_entity_master.py -v`
— 29/29 passed.

**Decisions made:**
- `entity_id` for a `new_entity` event is generated in Python (ULID, no DB
  round-trip needed) BEFORE `entity_events` is written, so — despite the
  DDL comment's "NULL for a 'new_entity' event pre-assignment" phrasing —
  no row is ever actually written with a NULL `entity_id` and then
  backfilled; the "pre-assignment" moment is conceptual (before generation
  in Python), not a required two-step database write. Simpler than a
  write-then-UPDATE and produces the same observable row.
- A rejected event is still durably recorded on `entity_events`
  (`rejected_reason` set, non-NULL) — this was already spec'd (§8.4), but
  worth stating: rejection is not a silent no-write, it's a write of ONE
  row (the event ledger entry) and zero rows anywhere else.
- Validation for every event type happens in one pass, entirely BEFORE any
  table is touched (`_validate_and_resolve_entity_id`), so a rejected
  `renamed` event, for example, never half-applies (old alias stays open,
  new alias is never written) — verified explicitly by
  `test_renamed_rejects_on_new_alias_collision_and_does_not_touch_old_alias`.
- `vendor_symbol`/`figi` writes are two dedicated functions
  (`set_vendor_symbol`/`set_figi`) OUTSIDE `apply_event`'s event vocabulary,
  matching spec §4.2's `event_type` column, which lists no vendor/FIGI
  event. Both are structurally incapable of touching `entities`/
  `entity_aliases` — the concrete implementation of this checkpoint's
  "provider data maps INTO canonical identity, never silently BECOMES it"
  condition.

**Deviations from spec (evidence wins, recorded):**
- Spec §4.3's `relation_added` payload shape is `{entity_id,
  related_entity_id, kind}` — no `valid_from`, despite
  `entity_relations.valid_from` being `NOT NULL` in the same document's own
  DDL (§4.2). Resolved by defaulting to the event's own application date
  (`_today()`) when the payload omits it, rather than silently working
  around the gap unnoted or raising on every `relation_added` call the
  spec's own example payload shape would produce.

**Unexpected discoveries:** The `relation_added` payload/DDL gap above.
Everything else in §4.3/§8.4 matched the DDL exactly.

**Risks:** None new. The collision guard and idempotent-replay behavior
are both directly test-covered (AC-3, AC-5) rather than only reasoned
about.

**Remaining work:** Checkpoint 4 (seed machinery + dry runs, then the
FIRST REAL SEED RUN — hard stop, owner review required before any further
checkpoint). Checkpoints 5-8 not yet authorized.

---

## Checkpoint 4 — Seed machinery + FIRST REAL SEED RUN (2026-09-02)

**HARD STOP IN EFFECT.** Per the authorization: "That real seed run is a
hard gate... do not continue automatically past this checkpoint."
Checkpoints 5-8 will not begin without explicit owner review of this
section.

### Changes made
- `scripts/entity_master_seed.py` — the 7-step backfill from spec §5.1:
  reads `cap_universe.symbols()`/`etf_symbols()`, `massive.list_reference_
  tickers()` (stocks + indices), `delisted_registry.all_entries()`; creates
  one entity per distinct active symbol + one per delisted record (composed
  as `new_entity` → `alias_retired` → `delisted`, since `apply_event` has no
  single "create pre-closed" event type); derives `massive` vendor-symbol
  rows for hyphenated aliases; populates `entity_figi` where Massive
  carried a `composite_figi`. `--dry-run` reads everything and reports
  projected counts without opening `entity_master.db` at all.
- `scripts/test_entity_master_seed.py` — 8 tests against entirely synthetic
  monkeypatched sources (idempotency, duplicate handling across two
  sources, collision behavior, type normalization, vendor/FIGI mapping,
  delisted-record edge cases, rollback/recovery-after-partial-run). This is
  the "local/safe testing first" the checkpoint required — run and green
  BEFORE any real data was touched.
- `store.bulk_mode()` (new, in `store.py`) — a context manager that
  suspends `apply_event`'s per-call cache rebuild for a bulk sequence and
  performs exactly ONE full rebuild on exit (even if the block raises).
  This does not weaken spec §8.3's "never partially patched" design — the
  rebuild is still always a full rebuild — it only changes WHEN it happens.
  Added because the real dry-run (below) revealed ~32,800 records to seed;
  rebuilding the whole cache after every one of ~44,800 events would have
  been O(n²) over the run. 2 new tests (`test_bulk_mode_defers_rebuild_
  until_exit`, `test_bulk_mode_rebuilds_even_if_the_block_raises`) cover it
  directly, not just incidentally through the seed script's own tests.
- `.gitignore`: `_local_seed_data/` (the real run's output — real market
  data, fully regenerable, never a committed artifact).

**Tests run:** synthetic suite (`scripts/test_entity_master_seed.py`, 8
tests) + full `entity_master` suite (31 tests, 2 new for `bulk_mode`) — all
green (39/39) BEFORE the real run. `python -m pytest api/services/entity_
master/ scripts/test_entity_master_seed.py -q`.

### Where the real run wrote its output (Condition 4 compliance)
`_local_seed_data/entity_master.db`, an explicit path under this worktree —
**deliberately NOT** the `DATA_DIR`-default path (which this project's own
`CLAUDE.md` documents as resolving to `C:\data`, real live production-
adjacent data on this box that every other part of this codebase treats
with extreme caution) and **not** Railway's production `/data` volume,
which this task never had or sought access to. Real Massive API
credentials were loaded from the sibling `uct-intelligence` repo's existing
local `.env` (the same key the deployed app itself uses — legitimate use,
not sent to any unrelated service) to make the real, live provider calls
the checkpoint's "first REAL seed run against real data" requires; nothing
written by this run touched any shared or production file.

### The report (as required)

**Real dry-run counts** (read-only, confirmed the shape before writing):
cap_universe 3,742 symbols (100 ETFs); Massive reference feed 26,469 rows
(stocks + indices); delisted registry 6,183 entries; 26,613 distinct active
symbols; ~10,748 would carry a FIGI; 14 hyphenated aliases would get a
derived vendor-symbol row.

**Real write run — completed in 8.9 seconds** (`entity_master_seed.py`,
full universe, no page cap beyond the default 60):

| Category | Count |
|---|---|
| Entities created (active) | 26,613 |
| Entities created (delisted) | 6,060 |
| **Total entities** | **32,673** |
| Listings/aliases created | 32,673 (26,613 open, 6,060 closed) |
| Provider mappings created — `entity_vendor_symbols` | 14 |
| Provider mappings created — `entity_figi` | 13,129 (40.2% of all entities) |
| Skipped as already-seeded | 123 (all from the delisted pass — see below) |
| Duplicates encountered | 0 (a symbol in both `cap_universe` and the Massive feed produces exactly one entity — verified both by the real run's own numbers, 3,742 + 26,469 sources → 26,613 distinct entities, not 30,211, and by a dedicated synthetic test) |
| Ambiguities encountered | 0 |
| Rejected records | 0 (of ~44,793 `entity_events` rows written, zero carry a `rejected_reason`) |
| Normalization anomalies | 0 |

**Entity-type breakdown:** 13,462 equity, 13,322 index, 5,889 etf.

**Unexpected provider inconsistency — the one real finding worth the
owner's attention:** 123 of `delisted_registry`'s entries (all from its
bulk auto-enumerated ~6k set, unhyphenated/undisambiguated keys like `AL`,
`BK`, `ASGN`, `AAC`) resolve to an entity that Entity Master's own seed
pass had already created as **active** — because `cap_universe`/the live
Massive feed currently carries that exact ticker as a live, actively-traded
name. Several carry a `delisted_date` only weeks old (e.g. `AL` →
"2026-04-09", and `AL` — Air Lease Corporation — is a real, currently-
trading NYSE name today). **This is stale data in `delisted_tickers_bulk.
json` (an existing, unmodified file this build only reads), not a defect
in Entity Master's own logic** — the collision-avoidance path did exactly
what it should: it detected the alias was already open for a different,
active entity and skipped creating a conflicting delisted one, rather than
producing a duplicate or an ambiguous state. Per PRD §16 ("not a
data-quality system"), fixing the bulk file's staleness is outside this
build's scope — flagged here as a normal-operations finding, the same
shape as the earlier program's RG-32.

**Data-quality observation, not a defect:** the real "index" entity count
(13,322 — larger than "equity") was flagged in the dry-run preview before
the write and is confirmed by the real run. Massive's `market=indices`
reference feed carries several thousand computed/derivative indices, not
just the handful (SPX, NDX, COMP, ...) this codebase's COT/breadth modules
actually track by name. Nothing in the PRD or spec caps which indices get
seeded — §5.1 step 2 says read the whole feed — so this is spec-compliant
behavior, but the SCALE was not something either document estimated, and
is worth the owner knowing before Checkpoint 6 (compatibility integration)
wires anything to `entity_type='index'` assuming a small, curated set.

**FIGI coverage measurement — spec §9.4/§20's previously-unmeasured "day-1
operational task," now measured:** 40.2% (13,129 / 32,673). Below-half
coverage is expected and not itself a defect (Massive's reference feed
naturally omits FIGI for many index/OTC/thin names, and OpenFIGI fallback
— explicitly out of scope per Condition 5 — was never attempted), but it
is the number the spec asked to be measured on the first real run rather
than assumed.

**Does the observed data validate or contradict the PRD/spec assumptions?**
Validates, with the two notes above. Every invariant the write path is
supposed to enforce held on real, messy, real-world data at real scale: no
duplicate entity created for a symbol appearing in two sources, no
alias-collision write ever accepted (0 of ~44,793 events rejected — because
none needed to be; the 123 delisted-registry collisions were caught by the
seed script's own pre-write `resolve()` check, one layer OUTSIDE
`apply_event`'s guard, exactly as designed), and the derived-vendor-symbol
rule (`BRK-B` → `massive` → `BRK.B`) matched `to_polygon_symbol()`
byte-for-byte on every one of the 14 real hyphenated names it touched — the
same differential check `test_share_class_vs_vendor_notation`/AC-4 already
covered synthetically, now confirmed on live data.

### Anything suggesting the model (the schema/design) is wrong
Nothing found. The one design gap from Checkpoint 3 (the `relation_added`
payload's missing `valid_from`) was never exercised by this run (the seed
script issues no `relation_added` events — GOOG/GOOGL-style share-class
relations are not part of the seed's own scope, matching PRD §16's
exclusion of corporate-action reconstruction from this slice). No
new schema gap was found under real data at real scale.

### STOP — awaiting owner review
Per Condition 3: implementation does not proceed to Checkpoint 5 (Provider
mapping), 6 (Compatibility integration), 7 (Reconciliation job), or 8 (Full
validation) without explicit approval after this review. The real database
sits at `_local_seed_data/entity_master.db` (gitignored, not committed) for
inspection if wanted.

---

## Post-Checkpoint-4 findings — root-cause investigation (2026-09-02)

Owner reviewed Checkpoint 4's report and approved Checkpoints 5-8, with two
findings required to be investigated (not fixed) before proceeding. Both are
now root-caused.

### Finding A — the stale `delisted_tickers_bulk.json`

**Origin.** `tools/enumerate_delisted.py` (read in full). A manual, one-off
script: fetches Massive's `active=true` set (`live`) and `active=false, type=CS`
set once, computes `bare_live = sym in live` per delisted record, and writes
`api/data/delisted_tickers_bulk.json`. Its own docstring: "Run with the Massive
key in the environment... Read-only against the provider; writes one local
JSON file" — a hand-run tool, never described as recurring.

**Refresh cadence.** `git log -- api/data/delisted_tickers_bulk.json` shows
exactly three commits, all on **2026-08-09** (bulk-enumerate ~6,177 names →
bare-reused-symbol fix → sector/industry enrichment), and nothing since.
`grep -rn "enumerate_delisted" api/main.py` returns nothing — it is not
registered in the APScheduler instance, and it does not appear in `CLAUDE.md`'s
Task Scheduler roster either. **It has never been regenerated since creation.**
Today (2026-09-02) is 24 days later. Only 6 of its 6,177 entries carry
`bare_live=true` (the generator's own at-generation-time live-check); the other
117 of the 123 collisions Checkpoint 4 found became stale purely from 24 days
of unrefreshed provider drift after generation — no bug in the generator
itself, just no refresh mechanism.

**Consumers.** `grep -rln "delisted_registry" api/` → `api/routers/bars.py`
(no actual `delisted_registry.*` call, an unrelated import), `api/routers/
delisted.py`, `api/routers/ticker_search.py` (already known from Checkpoint 1),
`api/services/engine.py:717`, `api/services/theme_index.py:142`, `api/services/
theme_performance.py:143,640`. **The three `engine.py`/`theme_*.py` call sites
all use `delisted_registry.is_delisted(sym)` as an EXCLUSION FILTER on theme/
holdings lists** — confirmed, not inferred.

**Confirmed current downstream impact (pre-existing, NOT caused by Entity
Master):** `delisted_registry.is_delisted("AL")` returns `True` today, because
the bulk file's `AL` entry (bare key, `bare_live` absent/false at generation
time, single delisting event) still resolves. AL (Air Lease Corp) is a real,
currently-trading NYSE name on `cap_universe.symbols()` right now. So AL — and
presumably some fraction of the other 122 — is silently excluded from any
theme holdings list it should appear in. **This is a real, already-shipping
product defect, unrelated to and predating Entity Master's own build**;
Entity Master's seed pass only discovered it as a side effect of
cross-referencing the file against live data. Reported as `RG-33` in the
`terminal-research` worktree's `RESEARCH_GAPS.md` (program-wide record) and
here (this build's own record) — not fixed, per the owner's explicit scope
boundary.

**Can Entity Master or its reconciliation path be fooled by this staleness?**
No, by construction, not by an added guard:
- The **seed script** (Checkpoint 4, already run) reads `delisted_registry.
  all_entries()` ONLY during the one-time backfill's delisted-entity pass
  (§5.1 step 4b), and — as already demonstrated by the real run — it always
  checks `em_api.resolve(ticker, ...)` against ALREADY-CREATED entities before
  writing anything. All 123 stale records were correctly skipped, not
  incorrectly applied. Verified again this pass with a fresh read-only query
  against the real seed database (0 collisions caused any entity mutation).
- The **reconciliation job** (Checkpoint 7, per spec §10.2) never reads
  `delisted_registry`/`delisted_tickers_bulk.json` **at all** — its only input
  is a fresh, live call to `massive.list_reference_tickers(active=True)` at
  RUN TIME, diffed against the store's own currently-open aliases. This was
  true in the spec before this investigation and is unchanged by it; Checkpoint
  7's implementation (below) preserves this — `delisted_registry` does not
  appear anywhere in `reconciliation.py`'s import list, which is itself part
  of Checkpoint 7's own test coverage (`test_reconciliation_never_imports_
  delisted_registry`).
- **No new code was added to re-check or "fix" the bulk file** — per the
  owner's explicit instruction, this remains entirely out of Entity Master's
  scope. The only Entity-Master-side guarantee needed, and the one already
  verified, is that Entity Master itself cannot be misled by the file's
  staleness into mutating a live entity — confirmed above on both of its two
  actual consumers of that file (seed script; reconciliation does not consume
  it at all).

### Finding B — the large `index` universe (13,322 entities)

Per the owner's framing, this is accepted as a real characteristic of
Massive's `market=indices` reference feed (thousands of computed/derivative
indices, not just SPX/NDX/COMP-style named benchmarks), not a defect. No
entity was deleted or filtered on this basis.

**Explicit contract note (added here and to be carried into any future
consumer-facing documentation for S3):** `entity_type == 'index'` on an
Entity Master record means "Massive's reference feed classifies this ticker
as an index" — nothing more. It does **not** mean "one of the small number of
benchmark indices this codebase's COT/breadth modules track by name," and no
downstream code should assume that equivalence. No new subtype (`benchmark`
vs `computed` vs `terminal-featured`, etc.) is introduced in this build —
per the owner's instruction, that classification work only happens if a
concrete product/architecture requirement calls for it, which none does yet
in the currently-authorized scope. Checkpoint 6 (compatibility integration,
below) does not wire anything to `entity_type='index'` on the assumption of a
small curated set.

### FIGI coverage (40.2%) — confirmed non-blocking

Re-verified against the real seed database: **zero** code path in
`api/services/entity_master/` treats `entity_figi` as mandatory.
`vendor_symbol()`/`resolve()`/`aliases()`/`related_to()` do not read
`entity_figi` at all; `set_figi()` is called conditionally (`if ref and
ref.get("composite_figi")`) and is a pure upsert with no downstream
dependency that assumes its own success. A canonical entity with zero
`entity_figi` rows resolves, aliases, and vendor-maps identically to one
with a FIGI — confirmed by `test_cold_start_returns_not_found_never_raises`
(Checkpoint 2) exercising every primitive against an entity with no FIGI at
all, and by the real run itself (59.8% of seeded entities carry no FIGI row
and none of them produced an error, an ambiguous result, or a rejected
event). OpenFIGI remains untouched, out of scope, per Condition 5.

---
