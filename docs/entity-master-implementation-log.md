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
