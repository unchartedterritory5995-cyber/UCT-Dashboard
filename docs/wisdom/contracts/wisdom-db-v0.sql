-- UCT Wisdom Loop — wisdom.db schema v0 (Wave 1 CONTRACT, owned by S-B; every stream builds against it)
-- Path: env WISDOM_DB_PATH, default /data/wisdom.db (repo-root conftest census pins it in tests).
-- Rules: ADDITIVE ONLY in Wave 1 (CREATE ... IF NOT EXISTS, ALTER ADD COLUMN guarded) — no drops.
-- Applied as migration core_001_base_v0 (api/services/wisdom/core/schema.py). FROZEN once applied on
-- production: every later change is a new additive core_NNN / <pkg>_NNN migration, never an edit here.
-- Times: ET ISO-8601 with offset ('2026-09-11T09:27:00-04:00'). JSON columns end in _json.
-- Private data (share counts, entry on OPEN positions) NEVER lands here — see wisdom-private-v0 below.
-- Status vocabulary shared across tables: provisional | confirmed | rejected | superseded.

PRAGMA journal_mode = WAL;

-- ── Sources & segments ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wisdom_sources (
  source_id              TEXT PRIMARY KEY,               -- sha256(stream|external_ref)[:24]
  stream                 TEXT NOT NULL CHECK (stream IN ('zoom_live','workshop','interview','education','discord','x','sunday_scans','sunday_scans_chart','zoom_frame','model_book','owner_feedback')),
  external_ref           TEXT NOT NULL,                  -- edu_videos:<id> | substack:<url> | substack_img:<url>#<n> | discord:<channel>:<msg> | x:<handle>:<id>
  version                INTEGER NOT NULL DEFAULT 1,
  supersedes_source_id   TEXT,
  home_pointer           TEXT,                           -- where the text lives today (education.db edu_videos.id=..., desk.db substack_posts.id=...)
  published_at_et        TEXT,
  recording_started_at_et TEXT,
  title                  TEXT,
  show                   TEXT,
  host_author_id         TEXT,
  guest_names_json       TEXT NOT NULL DEFAULT '[]',
  raw_r2_key             TEXT,                           -- wisdom/sources/<stream>/<source_id>/v<n>.txt.gz
  raw_sha256             TEXT NOT NULL,
  media_pointer          TEXT,                           -- youtube id / image url
  coverage_ratio         REAL,                           -- transcript span / media length; NULL = not measurable
  incomplete             INTEGER NOT NULL DEFAULT 0,     -- 1 when coverage_ratio < 0.98 (D10 threshold) or known-truncated
  published_check        TEXT,                           -- sunday_scans only: 'public_api_match' | 'mismatch' | 'unchecked'
  ingest_version         TEXT NOT NULL,
  ingested_at            TEXT NOT NULL,
  UNIQUE (stream, external_ref, raw_sha256)
);

CREATE TABLE IF NOT EXISTS wisdom_segments (
  segment_id             TEXT PRIMARY KEY,               -- sha256(source_id|version|ordinal)[:24]
  source_id              TEXT NOT NULL REFERENCES wisdom_sources(source_id),
  source_version         INTEGER NOT NULL,
  ordinal                INTEGER NOT NULL,
  kind                   TEXT NOT NULL CHECK (kind IN ('section','cue_window','message','image','frame')),
  path                   TEXT,                           -- 'TSDR''s Weekly Outlook & Watchlist > TWLO (Daily)'
  t_start_s              REAL,
  t_end_s                REAL,
  char_start             INTEGER,
  char_end               INTEGER,
  speaker_label          TEXT,                           -- raw label; never a member/attendee name (dropped at ingest)
  author_id              TEXT,                           -- normalised via wisdom_authors / aliases; NULL = attendee/unknown
  speaker_confidence     TEXT CHECK (speaker_confidence IN ('high','medium','low')),
  text                   TEXT NOT NULL,                  -- normalised text (speaker prefixes stripped; member quotes stripped for discord)
  text_sha256            TEXT NOT NULL,
  normalizer_version     TEXT NOT NULL,
  UNIQUE (source_id, source_version, ordinal)
);
CREATE INDEX IF NOT EXISTS ix_segments_source ON wisdom_segments(source_id, source_version);

-- ── Authors & aliases (§2.1, D3, D14) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wisdom_authors (
  author_id              TEXT PRIMARY KEY,               -- 'tsdr' | 'bracco' | 'manrav' | 'chartmaster' | 'guest:<slug>'
  display_name           TEXT NOT NULL,
  role                   TEXT NOT NULL CHECK (role IN ('owner','team','guest','candidate')),
  can_author_calls       INTEGER NOT NULL DEFAULT 0,     -- 1 ONLY for the four §2.1 authors
  discord_user_id        TEXT,
  x_handle               TEXT,
  status                 TEXT NOT NULL DEFAULT 'confirmed'
);
CREATE TABLE IF NOT EXISTS wisdom_author_aliases (
  alias                  TEXT PRIMARY KEY COLLATE NOCASE,
  author_id              TEXT NOT NULL REFERENCES wisdom_authors(author_id),
  alias_source           TEXT NOT NULL                   -- zoom_label | discord_display | substack_section | x_handle
);

-- ── Records (CALL · NEGATIVE_CALL · MENTION · PRINCIPLE · LEVEL · MARKET_SIGNAL) ─
CREATE TABLE IF NOT EXISTS wisdom_records (
  record_id              TEXT PRIMARY KEY,
  record_type            TEXT NOT NULL CHECK (record_type IN ('CALL','NEGATIVE_CALL','MENTION','PRINCIPLE','LEVEL','MARKET_SIGNAL')),
  segment_id             TEXT NOT NULL REFERENCES wisdom_segments(segment_id),
  source_id              TEXT NOT NULL,
  source_version         INTEGER NOT NULL,
  extractor_version      TEXT NOT NULL,
  record_hash            TEXT NOT NULL,                  -- idempotency: sha256(canonical json of the model record)
  author_id              TEXT,
  is_guest               INTEGER NOT NULL DEFAULT 0,
  stated_at_et           TEXT,
  stated_at_precision    TEXT CHECK (stated_at_precision IN ('minute','day','week')),
  event_at_text          TEXT,
  entity_id              TEXT,                           -- S3 entity id; NULL => cannot be CALL (enforced by writer)
  ticker                 TEXT,
  ticker_as_written      TEXT,
  ticker_as_heard        TEXT,
  tickers_json           TEXT NOT NULL DEFAULT '[]',
  entity_confidence      REAL,                           -- includes single-letter-ticker penalty
  direction              TEXT CHECK (direction IN ('long','short')),
  stance                 TEXT CHECK (stance IN ('watching','taking','in_it','added','trimmed','exited','stopped_out','hindsight','passed','avoid','no_view')),
  setup_name_raw         TEXT,
  vocab_id               TEXT,
  timeframe              TEXT,
  trigger_timeframe      TEXT,
  trigger_text           TEXT,
  entry                  REAL,                           -- stated entry on CLOSED/hindsight records only; open-position entry → private store
  entry_zone_lo          REAL,
  entry_zone_hi          REAL,
  stop                   REAL,
  stop_text              TEXT,
  targets_json           TEXT NOT NULL DEFAULT '[]',
  exit_price             REAL,                           -- stated exit on a closed / hindsight record (golden v1 request); open positions never
  exit_text              TEXT,
  levels_json            TEXT NOT NULL DEFAULT '[]',
  thesis                 TEXT,
  confidence_language_json TEXT NOT NULL DEFAULT '[]',
  reason                 TEXT,
  reason_class           TEXT CHECK (reason_class IN ('chart','liquidity','opportunity_cost','fundamental','none')),
  stated_outcome         TEXT CHECK (stated_outcome IN ('profit','loss','breakeven','stopped','still_holding')),
  stated_return_pct      REAL,
  hindsight              INTEGER NOT NULL DEFAULT 0,
  principle_key          TEXT,
  market_signal_json     TEXT,
  extraction_confidence  TEXT NOT NULL CHECK (extraction_confidence IN ('high','medium','low')),
  status                 TEXT NOT NULL DEFAULT 'provisional' CHECK (status IN ('provisional','confirmed','rejected','superseded')),
  superseded_by          TEXT,
  has_private            INTEGER NOT NULL DEFAULT 0,     -- 1 when a private-store row exists for this record
  created_at             TEXT NOT NULL,
  UNIQUE (segment_id, extractor_version, record_hash)
);
CREATE INDEX IF NOT EXISTS ix_records_ticker ON wisdom_records(ticker, stated_at_et);
CREATE INDEX IF NOT EXISTS ix_records_type ON wisdom_records(record_type, status);

CREATE TABLE IF NOT EXISTS wisdom_field_provenance (
  record_id              TEXT NOT NULL REFERENCES wisdom_records(record_id),
  field                  TEXT NOT NULL,
  segment_id             TEXT NOT NULL,
  char_start             INTEGER,
  char_end               INTEGER,
  t_start_s              REAL,
  t_end_s                REAL,
  bbox_json              TEXT,
  extractor_version      TEXT NOT NULL,
  confidence             TEXT,
  PRIMARY KEY (record_id, field)
);

CREATE TABLE IF NOT EXISTS wisdom_stt_corrections (
  correction_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id             TEXT NOT NULL,
  record_id              TEXT,
  kind                   TEXT NOT NULL CHECK (kind IN ('ticker_alias','price_scale','word_alias','speaker_alias')),
  raw_value              TEXT NOT NULL,
  normalized_value       TEXT,                           -- NULL when no unambiguous match (raw kept, confidence lowered)
  rule                   TEXT NOT NULL,
  bar_date               TEXT,
  created_at             TEXT NOT NULL
);

-- ── Charts (D13) ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wisdom_chart_images (
  image_id               TEXT PRIMARY KEY,               -- sha256 of image bytes
  source_id              TEXT NOT NULL,
  segment_id             TEXT,
  origin                 TEXT NOT NULL CHECK (origin IN ('sunday_scans','zoom_frame')),
  public_url             TEXT,
  r2_key                 TEXT,
  width                  INTEGER,
  height                 INTEGER,
  label_text             TEXT,                           -- nearest earlier short line ('SPY (Daily)')
  label_ticker           TEXT,
  label_timeframe        TEXT,
  frame_t_s              REAL,
  vision_json            TEXT,                           -- drawn levels/trendlines/annotations as read
  vision_model           TEXT,
  vision_version         TEXT,
  linked_record_id       TEXT,
  status                 TEXT NOT NULL DEFAULT 'provisional',
  created_at             TEXT NOT NULL
);

-- ── Principles & tests (D15) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wisdom_principles (
  principle_key          TEXT PRIMARY KEY,
  statement              TEXT NOT NULL,
  category               TEXT NOT NULL,
  author_id              TEXT,
  is_guest               INTEGER NOT NULL DEFAULT 0,
  coined_by              TEXT,
  canonical              INTEGER,                        -- NULL provisional, 1 canonical (owner), 0 non-canonical
  first_seen_at          TEXT,
  times_reinforced       INTEGER NOT NULL DEFAULT 0,
  empirical_claim        INTEGER NOT NULL DEFAULT 0,
  testable_claim         TEXT,
  status                 TEXT NOT NULL DEFAULT 'provisional'
);
CREATE TABLE IF NOT EXISTS wisdom_principle_support (
  principle_key          TEXT NOT NULL,
  record_id              TEXT NOT NULL,
  relation               TEXT NOT NULL CHECK (relation IN ('states','reinforces','qualifies','contradicts')),
  PRIMARY KEY (principle_key, record_id)
);
CREATE TABLE IF NOT EXISTS wisdom_test_specs (
  test_id                TEXT PRIMARY KEY,
  principle_key          TEXT NOT NULL,
  hypothesis             TEXT NOT NULL,
  population             TEXT NOT NULL,
  window_start           TEXT,
  window_end             TEXT,
  metric                 TEXT NOT NULL,
  control                TEXT NOT NULL,
  method_version         TEXT NOT NULL,
  registered_at          TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wisdom_test_results (
  test_id                TEXT NOT NULL,
  run_id                 TEXT NOT NULL,
  n                      INTEGER NOT NULL,
  effect                 REAL,
  ci_lo                  REAL,
  ci_hi                  REAL,
  date_range             TEXT,
  verdict                TEXT NOT NULL CHECK (verdict IN ('supported','not_supported','insufficient_data','inconclusive')),
  method_version         TEXT NOT NULL,
  computed_at            TEXT NOT NULL,
  PRIMARY KEY (test_id, run_id)
);

-- ── Outcomes & context (D11) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wisdom_outcomes (
  record_id              TEXT NOT NULL,
  methodology_version    TEXT NOT NULL,
  anchor_session         TEXT,
  anchor_price           REAL,
  anchor_rule            TEXT,
  ret_1 REAL, ret_3 REAL, ret_5 REAL, ret_10 REAL, ret_20 REAL,
  mfe_pct                REAL,
  mae_pct                REAL,
  stop_hit               INTEGER,                        -- NULL when no stop stated
  stop_hit_session       TEXT,
  target_hit             INTEGER,
  target_hit_session     TEXT,
  same_bar_ambiguity     INTEGER NOT NULL DEFAULT 0,
  resolved_with_intraday INTEGER NOT NULL DEFAULT 0,
  n_sessions_available   INTEGER NOT NULL DEFAULT 0,
  reconciliation         TEXT CHECK (reconciliation IN ('agrees','disagrees','unverifiable')),
  unverifiable_reason    TEXT,
  computed_at            TEXT NOT NULL,
  PRIMARY KEY (record_id, methodology_version)
);
CREATE TABLE IF NOT EXISTS wisdom_context_snapshots (
  record_id              TEXT NOT NULL,
  snapshot_version       TEXT NOT NULL,
  as_of_et               TEXT NOT NULL,
  fields_json            TEXT NOT NULL,                  -- {field: {value, source, retrieved_at}} ; missing = null, never backfilled
  completeness           REAL NOT NULL,                  -- populated fields / defined fields
  created_at             TEXT NOT NULL,
  PRIMARY KEY (record_id, snapshot_version)
);

-- ── Vocabulary (§3) ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wisdom_vocab (
  vocab_id               TEXT PRIMARY KEY,
  name                   TEXT NOT NULL UNIQUE,
  kind                   TEXT NOT NULL CHECK (kind IN ('setup','level','market_signal')),
  status                 TEXT NOT NULL CHECK (status IN ('candidate','approved','retired')),
  coined_by              TEXT,
  definition             TEXT,
  definition_locator     TEXT,
  aliases_json           TEXT NOT NULL DEFAULT '[]',
  evidence_count         INTEGER NOT NULL DEFAULT 0,
  version                TEXT NOT NULL,
  approved_by            TEXT,
  approved_at            TEXT
);
CREATE TABLE IF NOT EXISTS wisdom_vocab_maps (
  list_name              TEXT NOT NULL,                  -- setupGroups.js | setupCatalog.js | desk_SETUP_TAXONOMY | pv_FOCUSED_SETUPS | voice_chart_vision | curriculum_glossary | pattern_engine
  external_name          TEXT NOT NULL,
  vocab_id               TEXT,                           -- NULL = unmapped (reported)
  mismatch               INTEGER NOT NULL DEFAULT 0,
  note                   TEXT,
  PRIMARY KEY (list_name, external_name)
);
CREATE TABLE IF NOT EXISTS wisdom_vocab_candidates (
  raw_name               TEXT PRIMARY KEY COLLATE NOCASE,
  first_record_id        TEXT,
  independent_uses       INTEGER NOT NULL DEFAULT 0,
  team_author_uses       INTEGER NOT NULL DEFAULT 0,
  defining_locator       TEXT,
  status                 TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','promoted','vetoed'))
);
CREATE TABLE IF NOT EXISTS wisdom_ticker_aliases (
  alias                  TEXT PRIMARY KEY COLLATE NOCASE,
  scope                  TEXT NOT NULL CHECK (scope IN ('asr','company_name','slang','crypto_vehicle')),
  ticker                 TEXT NOT NULL,
  entity_id              TEXT,
  approved               INTEGER NOT NULL DEFAULT 0,
  evidence_locator       TEXT
);

-- ── Golden & review (§2.4, §0.3) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wisdom_golden (
  gid                    TEXT PRIMARY KEY,
  golden_version         TEXT NOT NULL,
  locator                TEXT NOT NULL,                  -- quote-free pointer
  expected_json          TEXT NOT NULL,                  -- label(s); lives only in prod/gitignored data
  status                 TEXT NOT NULL CHECK (status IN ('confirmed','provisional','rejected')),
  verification           TEXT NOT NULL,                  -- text-only | text+bars | text+positions | text+bars+positions
  verified_by            TEXT NOT NULL,                  -- auto | owner
  evidence_json          TEXT NOT NULL DEFAULT '{}',
  split                  TEXT NOT NULL CHECK (split IN ('dev','test')),
  author_id              TEXT,
  record_type            TEXT NOT NULL,
  created_at             TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wisdom_review_queue (
  item_id                TEXT PRIMARY KEY,
  tab                    TEXT NOT NULL CHECK (tab IN ('golden','vocabulary','contradictions','attribution','extraction_audit','drafts','sources','capture','authors')),
  subject_ref            TEXT NOT NULL,
  summary                TEXT NOT NULL,
  old_json               TEXT,
  new_json               TEXT,
  evidence_json          TEXT NOT NULL DEFAULT '{}',
  recommendation         TEXT,
  status                 TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','vetoed','resolved')),
  created_at             TEXT NOT NULL,
  resolved_at            TEXT,
  resolved_by            TEXT
);
CREATE TABLE IF NOT EXISTS wisdom_review_actions (
  action_id              INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id                TEXT NOT NULL,
  actor                  TEXT NOT NULL,
  action                 TEXT NOT NULL,
  note                   TEXT,
  created_at             TEXT NOT NULL
);

-- ── Jobs, capture, batches, metrics, publishing ──────────────────────────────
CREATE TABLE IF NOT EXISTS wisdom_job_heartbeats (   -- one row per job, upserted on EVERY run (skips included)
  job_id                 TEXT PRIMARY KEY,
  last_beat_at           TEXT,
  last_status            TEXT CHECK (last_status IS NULL OR last_status IN ('ok','skipped','failed','running')),
  last_ok_at             TEXT,
  last_error             TEXT,
  beats                  INTEGER NOT NULL DEFAULT 0,
  consecutive_failures   INTEGER NOT NULL DEFAULT 0,
  alerted_at             TEXT                            -- watchdog page stamp; cleared by the next ok beat
);
CREATE TABLE IF NOT EXISTS wisdom_job_runs (
  run_id                 TEXT PRIMARY KEY,
  job_id                 TEXT NOT NULL,
  due_key                TEXT,
  started_at             TEXT NOT NULL,
  finished_at            TEXT,
  status                 TEXT NOT NULL CHECK (status IN ('ok','failed','running')),
  forced                 INTEGER NOT NULL DEFAULT 0,
  dry_run                INTEGER NOT NULL DEFAULT 0,
  result_json            TEXT,
  error                  TEXT
);
CREATE INDEX IF NOT EXISTS ix_job_runs_job ON wisdom_job_runs(job_id, started_at);
CREATE TABLE IF NOT EXISTS wisdom_job_claims (         -- durable (job, slot) claim: two pods never both do one slot
  job_id                 TEXT NOT NULL,
  due_key                TEXT NOT NULL,
  claimed_at             TEXT NOT NULL,
  finished_at            TEXT,
  status                 TEXT NOT NULL CHECK (status IN ('running','ok','failed')),
  PRIMARY KEY (job_id, due_key)
);
CREATE TABLE IF NOT EXISTS wisdom_migrations (
  name                   TEXT PRIMARY KEY,
  applied_at             TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wisdom_capture_runs (
  run_id                 TEXT NOT NULL,
  dataset                TEXT NOT NULL,
  session_date           TEXT NOT NULL,
  started_at             TEXT NOT NULL,
  finished_at            TEXT,
  status                 TEXT NOT NULL CHECK (status IN ('ok','failed','skipped_holiday','unreachable')),
  row_count              INTEGER,
  bytes                  INTEGER,
  r2_key                 TEXT,
  trailing_median        REAL,
  health                 TEXT CHECK (health IN ('ok','low','zero','missing','holiday')),
  error                  TEXT,
  PRIMARY KEY (run_id, dataset)
);
CREATE TABLE IF NOT EXISTS wisdom_discord_state (
  channel_id             TEXT PRIMARY KEY,
  forward_cursor         TEXT,
  backfill_before        TEXT,
  backfill_done          INTEGER NOT NULL DEFAULT 0,
  last_poll_at           TEXT,
  last_ok_at             TEXT,                           -- stamped on every successful fetch, empty pages included
  last_status            INTEGER,                        -- last HTTP status
  blocked_until          TEXT,                           -- 401/403 back-off; never retried every tick
  last_error             TEXT,
  messages_seen          INTEGER NOT NULL DEFAULT 0,
  messages_kept          INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS wisdom_batches (
  batch_id               TEXT PRIMARY KEY,
  kind                   TEXT NOT NULL,                  -- extract | vision | audit
  extractor_version      TEXT NOT NULL,
  model                  TEXT NOT NULL,
  submitted_at           TEXT NOT NULL,
  status                 TEXT NOT NULL,
  request_count          INTEGER NOT NULL,
  cost_usd_estimate      REAL,
  cost_usd_actual        REAL,
  budget_cap_usd         REAL NOT NULL,
  checkpoint_json        TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS wisdom_metrics (
  metric_run_id          TEXT NOT NULL,
  metric                 TEXT NOT NULL,                  -- uct_see_rate_any | uct_see_rate_topn | uct_see_rate_setup | false_positive_rate | outcome_weighted_see_rate | grounding_* | extractor_* | capture_health
  slice_json             TEXT NOT NULL DEFAULT '{}',     -- {setup, author, stream, month, status}
  numerator              INTEGER NOT NULL,
  denominator            INTEGER NOT NULL,               -- 0/0 renders '0/0', never a percentage
  value                  REAL,                           -- NULL when denominator = 0
  method_version         TEXT NOT NULL,
  computed_at            TEXT NOT NULL,
  notes                  TEXT
);
CREATE INDEX IF NOT EXISTS ix_metrics_metric ON wisdom_metrics(metric, computed_at);
CREATE TABLE IF NOT EXISTS wisdom_publish_log (
  consumer               TEXT NOT NULL,
  record_ref             TEXT NOT NULL,
  action                 TEXT NOT NULL,                  -- export | would_publish | published | archived
  flag                   TEXT NOT NULL,
  flag_state             TEXT NOT NULL,
  at                     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wisdom_eval_runs (
  run_id                 TEXT PRIMARY KEY,
  kind                   TEXT NOT NULL,
  extractor_version      TEXT,
  method_version         TEXT NOT NULL,
  n                      INTEGER NOT NULL,
  metrics_json           TEXT NOT NULL,
  created_at             TEXT NOT NULL
);

-- ═════════════════════════════════════════════════════════════════════════════
-- wisdom-private-v0 — SEPARATE FILE: env WISDOM_PRIVATE_DB_PATH, default /data/wisdom_private.db
-- Import-banned from every member-facing module (rail). Sensitive values Fernet-encrypted via
-- api/services/crypto_box.py with key env WISDOM_PRIVATE_KEY (D16a). Content-stream data ONLY;
-- NO Journal / J2 / Notebook / broker data, ever (Part 10).
-- CREATE TABLE IF NOT EXISTS wisdom_private_positions (
--   record_id        TEXT PRIMARY KEY,   -- wisdom_records.record_id
--   field            TEXT NOT NULL,      -- size_shares | open_entry
--   value_enc        TEXT NOT NULL,      -- crypto_box ciphertext (key-id prefixed)
--   source_locator   TEXT NOT NULL,
--   created_at       TEXT NOT NULL
-- );
