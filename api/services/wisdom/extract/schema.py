"""extract migrations (stream S-D). Names must start with "extract_". Additive only.

extract_001 is the CONTRACTS §3 request ledger. Beyond the contract's columns it
carries the fields the budget and the reaper need (segment_id, purpose, model,
estimates, actual cost, error_type, usage, counts-only report) — never a quote,
never a private value, never the model's raw output.

Status vocabulary for wisdom_extract_requests.status:
  submitting (row written, batches.create not yet confirmed) · submitted ·
  done · retry (waits for the next submit) · failed (terminal).

extract_002 adds two package-owned side tables:
  * wisdom_extract_segment_maps — the cue offsets inside a window, so a quote's
    char span maps back to the cue timestamp it was said at;
  * wisdom_extract_record_keys — the overlap dedupe key
    (source, version, extractor version, record_type, ticker, normalised quote),
    so the same statement read through two overlapping windows is stored once.
"""
from __future__ import annotations

MIGRATIONS: list[tuple[str, str]] = [
    ("extract_001_requests", """
CREATE TABLE IF NOT EXISTS wisdom_extract_requests (
  custom_id              TEXT PRIMARY KEY,
  batch_id               TEXT,
  source_id              TEXT NOT NULL,
  source_version         INTEGER NOT NULL,
  segment_ids_json       TEXT NOT NULL,
  extractor_version      TEXT NOT NULL,
  attempt                INTEGER NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL CHECK (status IN ('submitting','submitted','done','retry','failed')),
  error                  TEXT,
  segment_id             TEXT,
  purpose                TEXT NOT NULL DEFAULT 'extract' CHECK (purpose IN ('extract','audit')),
  model                  TEXT,
  est_input_tokens       INTEGER,
  est_output_tokens      INTEGER,
  est_cost_usd           REAL,
  actual_cost_usd        REAL NOT NULL DEFAULT 0,
  usage_json             TEXT,
  error_type             TEXT,
  records_written        INTEGER,
  report_json            TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_extract_requests_batch ON wisdom_extract_requests(batch_id, status);
CREATE INDEX IF NOT EXISTS ix_extract_requests_segment ON wisdom_extract_requests(segment_id, extractor_version, purpose);
CREATE INDEX IF NOT EXISTS ix_extract_requests_status ON wisdom_extract_requests(status, extractor_version);
"""),
    ("extract_002_segment_maps_record_keys", """
CREATE TABLE IF NOT EXISTS wisdom_extract_segment_maps (
  segment_id             TEXT PRIMARY KEY,
  cue_map_json           TEXT NOT NULL,
  segmenter_version      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wisdom_extract_record_keys (
  dedupe_key             TEXT PRIMARY KEY,
  record_id              TEXT NOT NULL,
  created_at             TEXT NOT NULL
);
"""),
]
