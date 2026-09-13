"""publish migrations (stream S-F). Names must start with "publish_". Additive only.

MIGRATIONS = this stream's own ``publish_NNN_*`` list, then the publish adapters'
list (stream S-F2, ``api.services.wisdom.publish.adapters.schema.MIGRATIONS``)
when that module exists. The adapters package is built in parallel, so it is
looked up with ``importlib.util.find_spec`` and its absence is not an error.

Tables owned here (CONTRACTS §3 publish row, the review/report/chain half):
  wisdom_reports            weekly report + monthly packet, one row per (kind, period, variant)
  wisdom_chain_steps        one row per step of every daily/weekly/monthly chain run
  wisdom_golden_candidates  golden-set growth from owner review actions
  wisdom_observation_log    the daily chain's one line per stream

The other publish tables in CONTRACTS §3 (wisdom_drafts, wisdom_level_crosses,
wisdom_lookalike_scores, wisdom_kb_rows, wisdom_segments_fts) belong to the
adapters / retrieval / D20 modules and are created by the adapters' schema.
"""
from __future__ import annotations

import importlib
import importlib.util
import logging

log = logging.getLogger(__name__)

ADAPTERS_SCHEMA_MODULE = "api.services.wisdom.publish.adapters.schema"

OWN_MIGRATIONS: list[tuple[str, str]] = [
    ("publish_001_reports", """
CREATE TABLE IF NOT EXISTS wisdom_reports (
  report_id              TEXT PRIMARY KEY,               -- sha24(kind|period_key|variant)
  kind                   TEXT NOT NULL CHECK (kind IN ('weekly','monthly_packet')),
  period_key             TEXT NOT NULL,                  -- ISO week '2026-W38' | month '2026-09'
  variant                TEXT NOT NULL CHECK (variant IN ('preview','final')),
  generated_at           TEXT NOT NULL,
  run_id                 TEXT,
  markdown               TEXT NOT NULL,
  report_json            TEXT NOT NULL,
  delivery_status        TEXT NOT NULL DEFAULT 'not_sent',  -- not_sent | sent | skipped
  delivery_note          TEXT,
  delivered_at           TEXT,
  UNIQUE (kind, period_key, variant)
);
CREATE INDEX IF NOT EXISTS ix_reports_kind ON wisdom_reports(kind, generated_at);
"""),
    ("publish_002_chain_steps", """
CREATE TABLE IF NOT EXISTS wisdom_chain_steps (
  chain_run_id           TEXT NOT NULL,                  -- the registry run_id of the chain job
  chain                  TEXT NOT NULL CHECK (chain IN ('daily','weekly','monthly')),
  due_key                TEXT,
  ordinal                INTEGER NOT NULL,
  step                   TEXT NOT NULL,
  target                 TEXT NOT NULL,                  -- the module.attr the step calls
  status                 TEXT NOT NULL CHECK (status IN ('ok','failed','not_available','skipped')),
  reason                 TEXT,
  dry_run                INTEGER NOT NULL DEFAULT 0,
  started_at             TEXT NOT NULL,
  finished_at            TEXT NOT NULL,
  result_json            TEXT,
  PRIMARY KEY (chain_run_id, step)
);
CREATE INDEX IF NOT EXISTS ix_chain_steps_due ON wisdom_chain_steps(chain, due_key, step);
CREATE INDEX IF NOT EXISTS ix_chain_steps_started ON wisdom_chain_steps(chain, started_at);
"""),
    ("publish_003_golden_candidates", """
CREATE TABLE IF NOT EXISTS wisdom_golden_candidates (
  candidate_id           TEXT PRIMARY KEY,               -- sha24('golden_candidate'|item_id)
  item_id                TEXT NOT NULL UNIQUE,           -- one decided review item -> at most one candidate
  action_id              INTEGER NOT NULL,
  tab                    TEXT NOT NULL,
  subject_ref            TEXT NOT NULL,
  verdict                TEXT NOT NULL CHECK (verdict IN ('accepted','vetoed')),
  record_type            TEXT,
  author_id              TEXT,
  locator                TEXT,                           -- quote-free pointer
  expected_json          TEXT NOT NULL,                  -- the label that stands after the ruling
  rejected_json          TEXT,                           -- the label the ruling turned down
  split                  TEXT NOT NULL CHECK (split IN ('dev','test')),
  verified_by            TEXT NOT NULL,                  -- owner | reviewer
  actor                  TEXT NOT NULL,
  note                   TEXT,
  created_at             TEXT NOT NULL,
  promoted_gid           TEXT                            -- set by the golden harness when it adopts the row
);
"""),
    ("publish_004_observation_log", """
CREATE TABLE IF NOT EXISTS wisdom_observation_log (
  chain_run_id           TEXT NOT NULL,
  chain                  TEXT NOT NULL,
  due_key                TEXT,
  stream                 TEXT NOT NULL,
  line                   TEXT NOT NULL,
  dry_run                INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL,
  PRIMARY KEY (chain_run_id, stream)
);
CREATE INDEX IF NOT EXISTS ix_observation_log_due ON wisdom_observation_log(chain, due_key);
"""),
]


def module_available(name: str) -> bool:
    """find_spec for a dotted name whose PARENT package may not exist yet.

    importlib.util.find_spec imports the parents of a dotted name and raises
    ModuleNotFoundError when one is missing, rather than returning None."""
    try:
        return importlib.util.find_spec(name) is not None
    except (ModuleNotFoundError, ValueError):
        return False


def adapter_migrations() -> list[tuple[str, str]]:
    if not module_available(ADAPTERS_SCHEMA_MODULE):
        return []
    try:
        mod = importlib.import_module(ADAPTERS_SCHEMA_MODULE)
    except Exception:
        log.exception("[wisdom] %s failed to import; its migrations are not applied", ADAPTERS_SCHEMA_MODULE)
        return []
    return [(str(name), sql) for name, sql in getattr(mod, "MIGRATIONS", [])]


def compose(own: list[tuple[str, str]], adapters: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Own list first, then the adapters'. A name already taken is skipped LOUDLY:
    wisdom_migrations records by name, so a duplicate would silently never apply."""
    out = list(own)
    taken = {name for name, _ in own}
    for name, sql in adapters:
        if name in taken:
            log.error("[wisdom] publish adapters migration %r duplicates an existing name (skipped)", name)
            continue
        taken.add(name)
        out.append((name, sql))
    return out


MIGRATIONS: list[tuple[str, str]] = compose(OWN_MIGRATIONS, adapter_migrations())
