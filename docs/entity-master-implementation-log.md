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

### Finding A — CORRECTED during Checkpoint 7 (2026-09-02): the stale file
### is `cap_universe.json`, NOT `delisted_tickers_bulk.json`

**The paragraphs originally here (visible in this file's own git history,
commit `b78382f63`) reached the wrong diagnosis.** They are not restated —
this section replaces them, per the same "correct in place, don't silently
edit history" discipline this codebase's own `CLAUDE.md` uses. What follows
is the verified account, established while building Checkpoint 7's
reconciliation job and running its required dry run against real data.

**What actually happened.** Checkpoint 4's real seed run found 123 tickers
where `delisted_registry` (via `delisted_tickers_bulk.json`) disagreed with
Entity Master's own seeded "active" state. The original write-up assumed
the disagreement meant the delisted-registry file was stale, using `AL`
(Air Lease Corp) as the example — reasoning that because `AL` appears in
`cap_universe.symbols()`, it must be currently live. **That inference was
never independently checked against Massive's own data, and it was wrong.**

**Direct verification (Checkpoint 7), querying Massive's live API
directly** (`GET /v3/reference/tickers?ticker=AL&active=false`):
```json
{"ticker": "AL", "name": "Air Lease Corporation", "active": false,
 "delisted_utc": "2026-04-09T00:00:00Z", ...}
```
Massive's OWN authoritative data says `AL` has been delisted since
2026-04-09 — the **exact date** `delisted_tickers_bulk.json` already had.
Systematically re-checked all 101 of the original 123 collision-tickers
that came from `cap_universe.symbols()` specifically: **99 exact date
matches against Massive's live `active=false` data, 2 with a one-day
(timezone-rounding) difference, zero found to be genuinely still active.**
`delisted_tickers_bulk.json` was accurate for every one of these.

**The actually-stale file is `api/data/cap_universe.json`.** `git log`
shows it was last touched 2026-07-20, and additively ("add 32
live-but-uncharted tickers, 3710→3742" — not a full membership prune). `AL`
delisted 2026-04-09, before that July touch, so an additive-only update
never dropped it. **Entity Master's own seed script (Checkpoint 4) is what
inherited this staleness**: it trusted `cap_universe.symbols()` membership
as "active" for any symbol without independently checking Massive's own
`active` flag, so ~101 tickers `cap_universe.json` still lists (but Massive
has actually delisted) got seeded as active entities — a genuine defect in
THIS build's own seed logic, not a downstream consumer's problem to fix.

**`delisted_registry.is_delisted()` excluding these tickers from
`theme_index.py`/`theme_performance.py`/`engine.py`'s holdings filters
(the "confirmed downstream impact" the original write-up flagged) is
CORRECT behavior, not a defect** — those tickers are genuinely delisted.
There is no product bug to report here after all; `RG-33` in the
`terminal-research` worktree has been corrected in place (commit
`633691038`) rather than left standing.

**Reconciliation's dry run independently confirms the corrected diagnosis
and demonstrates its own value.** Of the real dry run's 131 proposed
delistings (detail in Checkpoint 7 below): 101 exactly match the
originally-flagged collision set, and **30 more are tickers delisted
SINCE `delisted_tickers_bulk.json`'s 2026-08-09 generation that neither
static file knows about yet** — reconciliation, reading only live Massive
data, is demonstrably more current than either.

**Can Entity Master or its reconciliation path be fooled by ANY stale
legacy dataset (`cap_universe.json`, `delisted_tickers_bulk.json`, or
otherwise)?** No, by construction:
- The **seed script** (Checkpoint 4) reads `cap_universe.symbols()` and
  `delisted_registry.all_entries()` only during the one-time backfill, and
  — regardless of which file happens to be stale — always checks
  `em_api.resolve(ticker, ...)` against already-created entities before
  writing, so a collision is skipped, never silently applied incorrectly.
  This protection worked as designed both times (Checkpoint 4's original
  123 collisions, and this corrected understanding of them).
- The **reconciliation job** (Checkpoint 7, below) never reads
  `cap_universe.py` OR `delisted_registry.py` **at all** — its only input is
  a fresh, live call to `massive.list_reference_tickers(active=True)` at
  RUN TIME. This is what makes it capable of CORRECTING the staleness
  either static file introduces, rather than being fooled by it — confirmed
  by `test_reconciliation_never_imports_delisted_registry` (AST-based) and
  by `reconciliation.py` having no `cap_universe` import either.
- **No new code was added to "fix" either legacy file.** Per the owner's
  explicit instruction, that remains out of Entity Master's scope — the
  reconciliation job corrects ENTITY MASTER's own store going forward; it
  is not a substitute for refreshing `cap_universe.json` or scheduling
  `tools/enumerate_delisted.py`, which are separate, narrowly-scoped
  follow-ups for a normal operations session (per `RG-33`'s corrected
  entry).

**Lesson recorded for this build's own record:** a symbol's presence in a
membership list is not itself evidence of current trading status —
independently check the provider's own status field before asserting
staleness of a DIFFERENT file. This mistake and its correction are both
left visible (this section, and `RG-33`) rather than the wrong version
being quietly edited away.

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

## Checkpoint 5 — Provider mapping (2026-09-02)

**Boundary (explicit, per the authorization):** Entity Master owns the
canonical mapping FROM an entity TO a provider's symbol for that provider —
enough for any caller to resolve a provider record back to canonical
identity. It does NOT own provider routing, request construction, response
normalization, rate limiting, or failover — that is the not-yet-built
Provider Abstraction Layer's (D1) job, untouched here. `vendor` is an
opaque string key Entity Master does not validate against a fixed list,
since owning that list is D1's job too (spec §4.2's own comment: "D1's
adapter registry keys").

### Grounded findings (not invented — each cites the code that proves it)

- **Massive**: the only provider needing an `entity_vendor_symbols` row
  today, and only for hyphenated aliases (class shares) — already built in
  Checkpoint 4, real-run-verified against 14 live names, byte-identical to
  `to_polygon_symbol()`.
- **FMP: no mapping needed, confirmed, not assumed.** `massive.py`'s own
  docstring (line 50, re-read this checkpoint): "storage/cache keys and the
  FMP/yfinance fallbacks keep the canonical hyphen form." `fmp_bulk.py`'s
  own symbol handling is a bare `str(r.get("symbol") or "").upper()` — no
  hyphen/dot transform anywhere. `vendor_symbol(entity_id, "fmp")`
  legitimately returns `None` for every entity, always — a valid outcome
  (spec §9.2), pinned by a new test
  (`test_fmp_vendor_has_no_mapping_by_design_and_returns_none`) so this
  reads as an intentional finding, not an unfinished feature, to the next
  engineer.
- **No other provider is in scope.** Per spec §9.1, S3's only other
  provider touch-point is OpenFIGI (FIGI fallback), explicitly out of
  scope per Condition 5. yfinance/Finnhub were checked for a comparable
  hyphen-rewrite need and found to have none (same "keeps canonical hyphen
  form" citation covers yfinance explicitly; Finnhub is not used for
  ticker-shaped lookups anywhere in the reference-data path Entity Master
  touches).

### A real gap found and fixed: silent conflict handling

Testing "conflicting provider IDs" (an explicit Checkpoint 5 validation
item) surfaced that the ORIGINAL `upsert_vendor_symbol`/`upsert_figi`
(written in Checkpoint 3) each silently did something different on a
genuine value conflict at the same key: `vendor_symbol` used
`ON CONFLICT DO NOTHING` (silently dropped a corrected/different value
with zero record it was ever attempted); `entity_figi` used
`ON CONFLICT DO UPDATE` (silently overwrote, also with zero record).
Neither matches this system's own stated design principle (§8.4's write
guard: "never silently accepted or dropped"). Fixed:

- `entity_vendor_symbols` (a DATED HISTORY table): a conflicting value at
  the same `(entity_id, vendor, valid_from)` is now REJECTED — the
  original is kept, and the caller receives `MappingResult(written=False,
  conflict=True)`. A genuine correction must use a NEW `valid_from`
  (dating the change), matching spec §8.1's "no update-in-place on a
  historical fact" — verified to still succeed cleanly
  (`test_vendor_symbol_correction_via_new_valid_from_is_allowed`).
- `entity_figi` (a CURRENT-SNAPSHOT table, no history, PK on `entity_id`):
  overwriting on a new value remains correct — that is the table's whole
  point — but the caller now receives `MappingResult(written=True,
  changed=True)` so a genuine update is distinguishable from a no-op
  re-run, rather than both looking identical.

New `MappingResult` dataclass (`api.py`) replaces the previous `None`
return on `set_vendor_symbol`/`set_figi`. 7 new tests (46 total):
identical-repeat no-op, conflict-rejected, correction-via-new-valid_from,
FIGI-change-detected, canonical-identity-stability-under-repeated-
provider-writes, provenance-round-trips, and the FMP-no-mapping-by-design
finding above.

### Checklist against the authorization's explicit items

| Item | Status |
|---|---|
| Massive mappings | Built (Checkpoint 4), validated, real-data-verified |
| FMP mappings where applicable | Investigated; not applicable, grounded finding recorded |
| Other approved current-provider mappings | None in scope beyond Massive (OpenFIGI explicitly excluded) |
| Missing provider IDs | `None` return, tested since Checkpoint 2 |
| Conflicting provider IDs | Gap found and fixed this checkpoint (above) |
| Repeated mapping writes | Idempotent on identical value; tested |
| Canonical identity stability | New test proves entity_id/alias/lifecycle_state never move under provider-mapping writes, including a rejected conflict |
| Mapping provenance | `source` field verified round-trip readable |

**Tests run:** `python -m pytest api/services/entity_master/ scripts/test_entity_master_seed.py -q` — 46/46 passed.

**No identifier guarantee was invented.** Every mapping behavior here is
grounded in an existing, re-read source file (`massive.py`, `fmp_bulk.py`)
or in this build's own already-verified real-data run — nothing about FMP,
yfinance, or any other provider's symbol conventions was assumed without a
citation.

---

## Checkpoint 6 — Compatibility integration (2026-09-02)

**Scope, per spec §2.2 (the only two "Modified" components in the whole
technical spec):** `api/services/ticker_search_index.py::_collect_rows()`/
`build_index()`/`_load_snapshot()`/`search()`, and `GET /api/ticker-search`'s
three emit sites. Nothing else was touched. Per the authorization's "do not
migrate unrelated consumers just because Entity Master now exists," calendar,
news, watchlists, journal_two, and every other ticker-string-keyed store are
category **C** below — deliberately untouched.

### Changes made

- `_collect_rows()`: each row gains `composite_figi`/`share_class_figi`/
  `cik`/`list_date`/`delisted_utc` (retained from the raw Massive row,
  available for a future consumer, not yet exposed through `search()`) and
  `entity_id` (resolved via `entity_master.api.resolve()`, best-effort,
  wrapped so an Entity Master failure degrades to `entity_id: None` for
  every row rather than blanking the index — matches this file's own
  pre-existing "a build failure keeps the prior index" discipline).
- `build_index()`/`_load_snapshot()`: the disk snapshot format gained one
  key (`"eid"`); an OLD snapshot on disk (written before this checkpoint)
  loads exactly as before with `entity_id=None`, never a `KeyError`.
- `search()`: every returned row gains `entity_id`. The ranking algorithm
  itself — buckets, priority tiebreak, sort order — is byte-for-byte
  unchanged; verified by a dedicated test that checks ranking ORDER, not
  just the new field's presence.
- `GET /api/ticker-search`: `entity_id` added to all three emit sites
  (live/index rows carry a real value or `None`; breadth pseudo-tickers and
  delisted rows carry `None`, per spec §2.2's own note — the delisted
  branch COULD now resolve a real value, since Checkpoint 4's seed already
  backfilled delisted entities, but this was deliberately deferred to keep
  this checkpoint's diff minimal and spec-literal rather than expanding
  scope beyond the exact citation).
- 11 new tests (`api/services/test_ticker_search_entity_master_integration.py`):
  entity_id attached/absent correctly, extra fields retained, additive
  shape unchanged, ranking unaffected, snapshot round-trip (new and OLD
  format), Entity-Master-unavailable degradation, and three router-level
  tests (one per row-shape branch).

### A real bug found and fixed during real-data verification

Rebuilding the index against the REAL Checkpoint-4 database (not a
synthetic fixture) surfaced a genuine defect, not in the integration code
above but in the **seed script's own entity-assignment logic**:
Massive's reference feed returns class-share tickers in DOT notation
(`BRK.B`), while `cap_universe`/this codebase's canonical form is HYPHEN
(`BRK-B`) — stated outright in `massive.py`'s own `to_polygon_symbol()`
docstring ("storage/cache keys ... keep the canonical hyphen form"). The
seed script's `active_symbols = set(universe) | set(ref_rows.keys())`
treated these as two DIFFERENT strings, so **13 of cap_universe's 14
hyphenated symbols got seeded as TWO separate entities each** for one real
instrument (confirmed: `BRK-B` and `BRK.B` resolved to different
`entity_id`s). This was NOT caught by Checkpoint 4's own validation
(which checked collision/rejection/duplicate counts, but never
cross-checked a symbol against its own dot-notation twin) — it surfaced
only because Checkpoint 6 rebuilt the search index against real data and
a human-legible symptom (BRK-B's search row had a blank `name`) prompted
inspection.

**Fixed at the root** (`scripts/entity_master_seed.py::_massive_reference_rows()`):
any dot-containing Massive ticker is now re-keyed to its hyphen-equivalent
BEFORE the union with `cap_universe`, so the two sources coalesce onto one
canonical key. The row retains `_massive_native_ticker` (Massive's own
exact string) so the vendor-symbol derivation step uses that directly
(`source="massive_reference"`) instead of re-deriving it via a
`.replace("-",".")` transform (`source="derived:dot_notation"`, kept as
the fallback for a hyphenated symbol with no matching Massive row at all —
confirmed real case: `CWEN-A`).

**Real data was re-seeded** (`_local_seed_data/entity_master.db` deleted
and regenerated) to correct the 13 duplicate entities before Checkpoint 7
built on top of it. Second real run: **26,600 entities created** (13 fewer
than the first run's 26,613 — exactly the fixed duplicate count),
**141 vendor-symbol rows** (up from 14 — the fix also picked up
class-share tickers Massive tracks that aren't in cap_universe's $300M+
screen, a strictly more complete outcome), 0 rejected/ambiguous/
normalization-anomaly, 8.8s. All 13 known dual-class pairs spot-checked:
hyphen form resolves to one real entity, dot form correctly `not_found`
(never itself a canonical alias). 2 new regression tests
(`test_massive_dot_form_and_cap_universe_hyphen_form_merge_to_one_entity`,
`test_hyphenated_symbol_with_no_massive_dot_row_still_gets_derived_mapping`).

**This is separate from, and unrelated to, Finding A** (the stale
`delisted_tickers_bulk.json`) — that finding is about a pre-existing file
this build only reads; this one is a genuine bug in code THIS build wrote
in Checkpoint 4, now fixed and re-verified.

### Consumer classification (as required)

| Consumer | Status | Why |
|---|---|---|
| `ticker_search_index.py` / `GET /api/ticker-search` | **B — compatibility bridge** | Carries `entity_id` additively; the merge logic, ranking, and every existing field are untouched. No caller is required to read the new field. |
| `to_polygon_symbol()` | **C — intentionally still legacy** | Coexists per spec §9.2; a pure string transform, still correct for any ticker Entity Master hasn't backfilled. Not migrated. |
| `delisted_registry.py` (+ its 3 data files) | **C — intentionally still legacy** | Entity Master's alias model subsumes its PURPOSE, but the running code (bars-serve path, the delisted branch of `/api/ticker-search`) stays live until each caller is migrated — not this build's scope (spec §2.1). |
| `cap_universe.py` | **C — intentionally still legacy** | Pure seed input, unmodified, per spec §2.1. |
| `watchlist_items.sym`, `journal_two`'s ticker-string columns, every other existing ticker-keyed store | **C — intentionally still legacy** | Explicit non-goal (spec §13, PRD §16 item 6): "No existing store is migrated by this build." |
| Calendar, news, fundamentals, alerts, frontend security/entity context | **C — intentionally still legacy** | Never touched, never in scope for this build — the entire authorized integration surface is the one row above. |

**Nothing is category A** ("now Entity-Master-native") yet, by design —
the spec's own rollout order (§5.3) puts full-consumer migration after S4
(Context Bus) exists, which is outside this build. Checkpoint 6's job was
to make Entity Master *reachable* without a flag day, not to convert any
consumer to depend on it.

**Tests run:** `python -m pytest api/services/entity_master/ scripts/test_entity_master_seed.py api/services/test_ticker_search_entity_master_integration.py -q` — 59/59 passed, both before and after the dot/hyphen fix (before: fixture-based tests didn't exercise the real-data collision at all, which is exactly why it wasn't caught until real data was rebuilt against — recorded as a testing-methodology lesson, not just a code fix).

---
