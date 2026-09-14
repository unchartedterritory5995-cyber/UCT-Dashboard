"""evals migrations (stream S-E). Names must start with "evals_". Additive only.

evals_001  wisdom_replay_hits      — CONTRACTS §3: one row per (record, level, source) that HIT.
evals_002  wisdom_replay_checks    — every (record, source) verdict, hit | miss | unproven, with its
                                     reason. The hit table alone cannot tell "UCT did not see it"
                                     from "we cannot prove what UCT saw that day", and the metric
                                     denominators need exactly that difference.
evals_003  wisdom_outcomes.horizons_json — the per-horizon detail (return, MFE/MAE, the session
                                     each horizon closed on, why a horizon is null). The base table
                                     carries one MFE/MAE pair; methodology §7.3 asks for one per horizon.
"""
from __future__ import annotations

MIGRATIONS: list[tuple[str, str]] = [
    ("evals_001_replay_hits", """
CREATE TABLE IF NOT EXISTS wisdom_replay_hits (
  record_id              TEXT NOT NULL,
  level                  TEXT NOT NULL CHECK (level IN ('any','topn','setup')),
  source                 TEXT NOT NULL,
  as_of                  TEXT NOT NULL,                  -- the UCT session judged, YYYY-MM-DD
  rank                   INTEGER,
  setup_raw              TEXT,
  vocab_id               TEXT,
  PRIMARY KEY (record_id, level, source)
);
CREATE INDEX IF NOT EXISTS ix_replay_hits_asof ON wisdom_replay_hits(as_of);
"""),
    ("evals_002_replay_checks", """
CREATE TABLE IF NOT EXISTS wisdom_replay_checks (
  record_id              TEXT NOT NULL,
  source                 TEXT NOT NULL,
  method_version         TEXT NOT NULL,
  as_of                  TEXT NOT NULL,
  verdict                TEXT NOT NULL CHECK (verdict IN ('hit','miss','unproven')),
  rank                   INTEGER,
  top_n                  INTEGER,                        -- NULL: the source has no display rank
  setup_raw              TEXT,
  vocab_id               TEXT,
  reason                 TEXT,
  checked_at             TEXT NOT NULL,
  PRIMARY KEY (record_id, source, method_version)
);
CREATE INDEX IF NOT EXISTS ix_replay_checks_record ON wisdom_replay_checks(record_id, method_version);
"""),
    ("evals_003_outcome_horizons", """
ALTER TABLE wisdom_outcomes ADD COLUMN horizons_json TEXT;
"""),
]
