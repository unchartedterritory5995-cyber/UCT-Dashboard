"""capture migrations (stream S-A). Names must start with "capture_". Additive only.

wisdom_capture_runs lives in the base contract (docs/wisdom/contracts/wisdom-db-v0.sql).
This package owns exactly one table beside it, the dataset REGISTRY
(docs/wisdom/CONTRACTS.md §3): one row per D12 dataset holding its static
description and the three pieces of state a capture needs between runs —

  * the watermark window for the delta-shaped datasets (detections,
    detection_outcomes, vision), so a re-run of the same as_of reads the SAME
    window instead of an empty one (an empty re-run would read as a zero-row
    P1 page for a dataset that was captured fine);
  * last_sha256 / last_r2_key for hash-on-change datasets (themes), so an
    unchanged taxonomy writes no new object;
  * last_as_of for the admin table.

The static columns are re-synced from api/services/wisdom/capture/families on
every run, so the code stays the one authority and this row is a mirror.
"""
from __future__ import annotations

MIGRATIONS: list[tuple[str, str]] = [
    (
        "capture_001_datasets",
        """
        CREATE TABLE IF NOT EXISTS wisdom_capture_datasets (
          dataset          TEXT PRIMARY KEY,
          family           TEXT NOT NULL,
          job_id           TEXT NOT NULL,
          cadence          TEXT NOT NULL,
          as_of_rule       TEXT NOT NULL,
          r2_prefix        TEXT NOT NULL,
          session_shaped   INTEGER NOT NULL DEFAULT 0,
          pages_on         TEXT NOT NULL DEFAULT 'zero,missing',
          watermark        INTEGER,
          window_lo        INTEGER,
          window_as_of     TEXT,
          last_sha256      TEXT,
          last_r2_key      TEXT,
          last_as_of       TEXT,
          updated_at       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_wisdom_capture_runs_dataset_session
          ON wisdom_capture_runs(dataset, session_date);
        """,
    ),
]
