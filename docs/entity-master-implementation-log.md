# Entity Master — Implementation Log

Tracks the 8-checkpoint implementation authorized 2026-09-02 ("Approved: IMPLEMENT
ENTITY MASTER WITH CONDITIONS"). Currently authorized through Checkpoint 4
(first real seed run), which is a hard stop pending owner review.

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
