---
id: WISDOM-LOOP-CONTRACTS-W1
title: UCT Wisdom Loop — Wave 1 build contracts (integrator-owned)
status: current
generated: 2026-09-13
authority: >
  This file wins over PROGRAM-MANIFEST.md §4 (schema), §8 (flags) and §11 (waves) wherever they
  differ. The manifest is being brought into line; until it is, build against THIS file.
---

# Wave 1 build contracts

Every Wave 1 stream builds against the names, signatures, tables, flags and slots below. If a
stream needs something that is not here, it stops that piece, writes the request into its final
report, and keeps building everything else. **It does not invent a second name for a thing that
already has one.**

The owner's Wave 1 text (rulings D1–D20, owner tasks, metric definitions, Definition of Done)
is kept verbatim in the gitignored copy
`C:\Users\Patrick\uct-worktrees\wisdom-loop\data\wisdom\WAVE1-PROMPT-v2.0.md`. Section numbers
below (`W1 §x.y`) point into it.

---

## 0. Resolved contradictions (from the 2026-09-13 understand pass)

The understand pass found 29 places where the manifest, the schema contract and the subsystem
maps disagreed. Each is settled here once.

| # | Question | Ruling | Why |
|---|---|---|---|
| 1 | Schema authority | `docs/wisdom/contracts/wisdom-db-v0.sql` | It is the later, owner-ruled model (W1 §4.1). Manifest §4 table names are retired. |
| 2 | Record types | `CALL · NEGATIVE_CALL · MENTION · PRINCIPLE · LEVEL · MARKET_SIGNAL` in `wisdom_records`; chart evidence lives in `wisdom_chart_images` | W1 §4.1 |
| 3 | CALL authors | Four: `tsdr`, `bracco`, `manrav`, `chartmaster` (`docs/wisdom/authors.json`). Ravi = team, never CALL | W1 §2.1 |
| 4 | Stream enum | Contract enum. No `owner_trade` / `owner_note` | D16b deferred (W1 Part 10) |
| 5 | Incomplete / deletion threshold | coverage `< 0.98` | W1 §2.2 |
| 6 | Wave scope | Everything in W1 Part 8 streams is built in W1, dark | W1 Part 8, §9.1 |
| 7 | Private store | File `WISDOM_PRIVATE_DB_PATH` (default `/data/wisdom_private.db`), key env `WISDOM_PRIVATE_KEY` (retired-key env `WISDOM_PRIVATE_KEYS_V1`), content-stream private fields ONLY | W1 §0.4d, Part 10 |
| 8 | Job registration | Register every job unconditionally; each run re-reads its kill switch (off takes effect next tick, no deploy) | a flag-gated registration cannot be turned off without a deploy |
| 9 | main.py hooks | Integrator-owned, landed in the skeleton, never edited by a stream (§2) | merge hotspot |
| 10 | R2 write path | Wisdom-owned `core/r2.py` over `data_sync._client()`: `head_object` → refuse overwrite → `put_object` → log failures. Never `put_bytes` (swallows), never a delete | immutability |
| 11 | Batch client / ledger | Wisdom-owned client + `wisdom_batches`. NOT `llm_batch.py` (shared ledger, 24 h abandonment, no timeout injection) | §9 |
| 12 | Extraction cost ledger | `wisdom_batches` in wisdom.db, NOT `narrative_cost_guard` in auth.db | auth.db is the hot DB |
| 13 | D20 alert type | Built as a Wisdom-internal silent scorer; NOT registered with S7 in W1 (a new S7 type trips `test_alert_taxonomy_filing_watch_parity._EXPECTED` and `CP3_SIGNED`; reusing `price-level` pollutes S7's dark comparison). S7 registration is a W5/W6 item needing the S7 owner's CP3 | §12 |
| 14 | Machine-to-machine auth | `/api/internal/wisdom/<pkg>/*`, one `Depends` named exactly `require_push_secret` per router module (copied from `api/routers/scan_live.py:65-89`) | route census classes it `worker` |
| 15 | Badges route / frontend flag | `GET /api/admin/wisdom/publish/badges` (`require_admin`), server flag only; NO `VITE_*`, NO `api/routers/auth.py` edit, NO `CatalystTable.jsx` edit in W1 | render-loop class (CLAUDE.md H14); auth.py has an unmerged edit elsewhere |
| 16 | Flag ledger field | `note` (≥ 20 chars for dark) | `tests/test_feature_flag_ledger.py` |
| 17 | `UNGUARDED_SHARED_LITERAL_SITES` | exactly 8 — add none | `tests/test_shared_data_root_guard.py:633-646` |
| 18 | Census scope | `api/` only. `tools/wisdom/**` takes explicit `--db`/`--out` paths and never defaults to `/data` | `conftest.py:163-173` |
| 19 | Heartbeat shape | single row per job (`wisdom_job_heartbeats`, upsert) + `wisdom_job_runs` ledger + `wisdom_job_claims` durable claims | repo idiom; bounded growth |
| 20 | Discord cursor | `wisdom_discord_state` gains `last_ok_at`, `last_status`, `blocked_until`, `last_error` | quiet channel ≠ dead poller; 403 back-off |
| 21 | Golden size | ≥ 100 | W1 §2.4 |
| 22 | Grounding set size | 30 questions | W1 §6.4 |
| 23 | Brain KB sync semantics | UPDATE in place on changed content, INSERT new, `active=0` on superseded. Never DELETE | D18 "never delete"; stable KB ids |
| 24 | Ticker-mentions consumer | StockChart desk markers only; there is no TickerPopup Desk tab | measured |
| 25 | Zoom pipeline ownership | The owner is the Desk owner and W1 §2.2 assigns the fix: S-C edits `desk_session_insights.py` (guard + pairing + VTT archive). Never touch `zoom_cleaned` from Wisdom code | W1 §2.2 |
| 26 | Capture schedule | Slots in §5; nothing in 00:40–05:00 ET except the pre-prune detections read; no minute in the avoid list | measured scheduler map |
| 27 | Double-fire | Every job claims `(job_id, due_key)` durably before doing work | per-container scheduler lock |
| 28 | Outcome bars | web `bars_sqlite` read-only for the cap universe; anything else `unverifiable` with a named reason | OOM class |
| 29 | Paths in W1 Part 8 (`lib/wisdom/...`, `ci/`) | map to repo convention: `api/services/wisdom/<pkg>/`, `tools/wisdom/`, `tests/test_wisdom_*.py`, `.github/workflows/wisdom-rails.yml` | the census and every rail key on `api/` |

Two owner-text conflicts that code cannot settle, recorded for the report:

- W1 §2.4 asks golden verification against "the Sunday Scans positions table". That table is the
  positions section INSIDE each Sunday Scans issue (content stream), not the Journal. Allowed.
- W1 §4.6 asks "temperature 0". Claude Opus 5 rejects every sampling parameter (400). Determinism
  comes from a fixed prompt + schema + `extractor_version`, and the golden gate measures run-to-run
  drift instead.

---

## 1. Layout and ownership

```
api/services/wisdom/
  __init__.py            skeleton
  registry.py            skeleton (JobSpec, jobs, schema, routers)       integrator
  core/                  skeleton + S-B
    store.py ids.py timeutil.py flags.py heartbeat.py r2.py authors.py owner.py   (skeleton)
    private.py entities.py aliases.py stt.py vocab.py bans.py schema.py jobs.py   (S-B)
  capture/               S-A   jobs.py schema.py families/*.py health.py
  sources/               S-C   jobs.py schema.py discord.py zoom.py sunday_scans.py transcripts.py
  extract/               S-D   jobs.py schema.py segmenter.py prompt.py batch.py writer.py golden.py budget.py
  evals/                 S-E   jobs.py schema.py bars_asof.py outcomes.py context.py replay.py metrics.py grounding.py
  publish/               S-F   jobs.py schema.py review.py report.py retrieval.py adapters/*.py level_alerts.py lookalike.py
api/routers/wisdom_core.py wisdom_capture.py wisdom_sources.py wisdom_extract.py wisdom_evals.py wisdom_publish.py
tools/wisdom/<pkg>_*.py            one-off and PC-side scripts (explicit paths; no test_*.py here)
tests/test_wisdom_<pkg>_*.py
app/src/pages/admin/wisdom/*       S-F only (+ its App.jsx route and Admin.jsx link, same commit)
docs/wisdom/methodology/*.md       S-E (metrics), S-D (extraction), S-A (capture)
data/wisdom/**                     gitignored working data (golden labels, samples, prompt copy)
```

**A stream edits only its own rows above.** Shared files are integrator-only:
`api/main.py`, `docs/feature_flags.json`, `docs/wisdom/{PROGRAM-MANIFEST,LEDGER,CONTRACTS,RUNBOOK,SESSION-STATE}.md`,
`docs/wisdom/contracts/*`, `api/services/wisdom/registry.py`, `api/services/wisdom/core/flags.py`.
A stream that needs a change there puts the exact diff in its final report.

Existing files a stream may edit (and only that stream):

| File | Stream | Scope |
|---|---|---|
| `api/services/desk_session_insights.py` + `tests/test_desk_session_insights.py` | S-C | coverage guard, transcript↔MP4 pairing/stitching, raw VTT → R2 before trash |
| `api/routers/ai_search.py`, `api/services/ai_search_log.py`, `api/services/ai_search_eval/runner.py`, `app/src/pages/charts/widgets/AiSearchWidget.jsx` | S-F | flag-gated Wisdom retrieval block only |
| `api/services/ai_search_dossier.py` | S-F | flag-gated `_wisdom_lines` only |
| `api/services/ticker_mentions.py` | S-F | flag-gated provider, gated OUTSIDE the per-symbol cache |
| `app/src/App.jsx`, `app/src/pages/Admin.jsx` | S-F | one lazy route + one link card |
| `.github/workflows/wisdom-rails.yml` (new) | S-B | the ban rails in CI |

**Never edit:** `app/src/pages/journal-2-0/**`, `**/lib/offline/**`, `OptionsFlow.jsx`,
`docs/discord-render/**`, `services/chart_renderer/**`, `app/src/pages/BreadthCharts.jsx`,
`app/src/pages/breadth/PresetRow.jsx`, `app/src/pages/breadth/MetricReadout.jsx`,
`api/services/alert_taxonomy/**`, `api/services/data_sync.py`, `api/services/llm_batch.py`,
`api/services/buzz_*.py`, `api/services/tweet_store.py`, `api/services/zoom_client.py`,
`api/routers/auth.py`, `api/services/auth_db.py`, every flow-worker watched file
(header of `api/flow_worker_main.py`), `docs/runbooks/deploy-windows.md`,
`app/src/components/tiles/CatalystTable.jsx`, `app/src/hub/**`.

Imports are one-way: Wisdom may import existing modules read-only; no existing module may import
`api.services.wisdom` except the S-F adapter sites listed above, and none of those may be
flow-worker reachable (`python tools/flow_worker_watch_coverage.py` must stay OK).

---

## 2. Skeleton contract (lands before the streams start)

### 2.1 Registry — `api/services/wisdom/registry.py`

```python
PACKAGES = ("core", "capture", "sources", "extract", "evals", "publish")

@dataclass(frozen=True)
class JobSpec:
    job_id: str                                   # "wisdom_<pkg>_<name>", unique
    fn: Callable[["JobContext"], dict]            # returns a JSON-able summary; may raise (registry catches)
    trigger: dict                                 # {"kind": "cron", "day_of_week": ..., "hour": ..., "minute": ...}
                                                  # | {"kind": "interval", "seconds": N}
    enabled: Callable[[], bool]                   # the job's kill switch — a core.flags function
    expected_every_s: int                         # watchdog pages after 2 missed periods while enabled
    trading_days_only: bool = False
    due_key: Callable[[datetime], str | None] | None = None   # durable claim key, e.g. session date
    catch_up_grace_s: int = 0                     # >0: the core catch-up tick runs a missed due_key within this

@dataclass
class JobContext:
    job_id: str
    now_et: datetime
    due_key: str | None
    force: bool
    dry_run: bool
    run_id: str
    def log(self, msg: str) -> None: ...          # appended to the run's result_json["log"] (bounded)
```

- Each package's `jobs.py` exposes `JOBS: list[JobSpec]` (may be empty).
- Each package's `schema.py` exposes `MIGRATIONS: list[tuple[str, str]]`, names `"<pkg>_NNN_<slug>"`,
  applied once each, in PACKAGES order then list order. **Additive DDL only.**
- Each `api/routers/wisdom_<pkg>.py` exposes `router` (prefix `/api/admin/wisdom/<pkg>`) and optionally
  `internal_router` (prefix `/api/internal/wisdom/<pkg>`).
- `registry.run_job(job_id, *, force=False, dry_run=False, now=None) -> dict` — never raises. Order:
  ingest master switch + `spec.enabled()` (skipped when `force`) → trading-day check → durable claim
  `INSERT OR IGNORE wisdom_job_claims(job_id, due_key)` (already `ok` → skip) → run → `wisdom_job_runs`
  row + heartbeat upsert → on failure `chart_health_alerts.emit(f"wisdom_job_failed:{job_id}", "critical", ...)`.
  A skipped run still beats, with `last_status='skipped'`.
- `registry.register_jobs(scheduler) -> list[str]` — one `add_job` per spec with `timezone=ET`,
  `max_instances=1`, `replace_existing=True`, `coalesce=True`, `misfire_grace_time` 3600 (cron) / 60
  (interval), `id=spec.job_id`, calling `run_job`. Local imports of the trigger classes inside the function.
- Core ships two jobs: `wisdom_core_catchup` (interval 300 s: runs due-but-unclaimed `catch_up_grace_s`
  jobs) and `wisdom_core_watchdog` (interval 300 s: pages `wisdom_job_missed:<job_id>` when an enabled job's
  `last_ok_at` is older than `2 × expected_every_s`, once per miss episode, stamped in `alerted_at`).

### 2.2 main.py hooks (integrator, skeleton commit)

1. Lifespan, unconditional, before the scheduler lock: `registry.init_stores()` in its own try/except.
2. Inside `if acquire_scheduler_lock():`, its own try/except, near `register_screener_jobs(_scheduler)`:
   `registry.register_jobs(_scheduler)` and one `[startup] wisdom jobs: …` print.
3. After the last `app.include_router(...)`: `for _r in wisdom_registry.routers(): app.include_router(_r)`.

### 2.3 Store — `core/store.py`

```python
def db_path() -> str                                   # os.environ.get("WISDOM_DB_PATH", "/data/wisdom.db"), per call
def connect(db_path: str | None = None, *, for_request: bool = False) -> sqlite3.Connection
    # makedirs; timeout 5; WAL; synchronous=NORMAL; busy_timeout 2000 if for_request else 5000; Row factory
def init_db(db_path: str | None = None) -> list[str]  # base DDL + every package MIGRATIONS; returns names applied now
@contextmanager
def write(db_path: str | None = None) -> Iterator[sqlite3.Connection]   # WRITE_LOCK + BEGIN IMMEDIATE + commit/rollback + close
@contextmanager
def read(db_path: str | None = None, *, for_request: bool = False) -> Iterator[sqlite3.Connection]
WRITE_LOCK: threading.Lock
```

Base DDL = `docs/wisdom/contracts/wisdom-db-v0.sql`, read from the repo at init (the image copies the
whole repo). A failed migration is logged loudly, not recorded, and does not stop later ones.

### 2.4 Small core modules (skeleton)

- `core/ids.py`: `sha24(*parts) -> str` (sha256 of `"|".join(map(str, parts))`, hex[:24]); `sha256_bytes(b) -> str`.
- `core/timeutil.py`: `ET`; `now_et()`; `iso_et(dt)`; `is_trading_day(d: date) -> bool` (weekday and not
  `bars_fetch._is_nyse_holiday`; the table only covers 2025–2027, so dates outside it return
  `None`-safe weekday answers and callers mark holiday-awareness `unknown`); `session_for(dt) -> date`
  (pre-09:30 → prior session).
- `core/flags.py`: one explicit function per gate (§4). Nothing else reads a `WISDOM_*_ENABLED` variable.
- `core/heartbeat.py`: `beat(conn, job_id, status, *, error=None)`; `job_health(conn) -> list[dict]`.
- `core/r2.py`: `put_immutable(key, data: bytes, content_type) -> dict` (`{"key","sha256","bytes","created": bool}`;
  existing key with same sha → `created=False`; different sha → raises `R2ImmutableConflict`); `get(key) -> bytes | None`;
  `list_prefix(prefix) -> Iterator[dict]` (paginator). Keys MUST start with `wisdom/`. No delete function exists.
- `core/authors.py`: `load_authors()`, `load_discord_sources()` from `docs/wisdom/*.json`; `author_for_alias(label) -> str | None`
  (case-insensitive exact); `author_for_discord_user(user_id) -> str | None`; `CALL_AUTHORS = frozenset(...)` derived from the file.
- `core/owner.py`: `require_owner` dependency = `require_admin` + email equals the FIRST entry of `ADMIN_EMAILS`
  (precedent `api/routers/render_panels.py:423-440`). A second admin gets 403. Owner-private data is only ever
  returned through `require_owner` routes.

---

## 3. Tables added beyond the contract

Base contract changes (skeleton edits `wisdom-db-v0.sql`, not yet applied anywhere, so still additive):
- `wisdom_job_heartbeats(job_id PK, last_beat_at, last_status, last_ok_at, last_error, beats, consecutive_failures, alerted_at)`
- `wisdom_job_runs(run_id PK, job_id, due_key, started_at, finished_at, status, forced, dry_run, result_json, error)`
- `wisdom_job_claims(job_id, due_key, claimed_at, finished_at, status, PK(job_id, due_key))`
- `wisdom_migrations(name PK, applied_at)`
- `wisdom_discord_state` + `last_ok_at`, `last_status`, `blocked_until`, `last_error`

Package-owned tables (created by that package's `schema.py`):

| Package | Tables |
|---|---|
| capture | `wisdom_capture_datasets` (dataset registry: family, cadence, as_of rule, r2 prefix) — `wisdom_capture_runs` already in base |
| sources | `wisdom_discord_messages` (message_id PK, channel_id, author_id, created_at, segment_id, legacy_classified INTEGER) |
| extract | `wisdom_extract_requests` (custom_id PK, batch_id, source_id, source_version, segment_ids_json, extractor_version, attempt, status, error) |
| evals | `wisdom_replay_hits` (record_id, level, source, as_of, rank, setup_raw, vocab_id, PK(record_id, level, source)) |
| publish | `wisdom_drafts`, `wisdom_reports`, `wisdom_level_crosses`, `wisdom_lookalike_scores`, `wisdom_kb_rows`, `wisdom_segments_fts` (FTS5) |

---

## 4. Flags — declared once, in the skeleton, read only through `core/flags.py`

All default OFF, status `dark` in `docs/feature_flags.json`. **Streams never edit that file.**

| Function | Env | Consumer |
|---|---|---|
| `ingest_enabled()` | `WISDOM_INGEST_ENABLED` | master switch for every Wisdom job |
| `capture_enabled()` | `WISDOM_CAPTURE_ENABLED` | S-A capture jobs |
| `x_backfill_enabled()` | `WISDOM_X_BACKFILL_ENABLED` | S-A paid X backfill |
| `vocab_autopromote_enabled()` | `WISDOM_VOCAB_AUTOPROMOTE_ENABLED` | S-B |
| `discord_listener_enabled()` | `WISDOM_DISCORD_LISTENER_ENABLED` | S-C listener + backfill |
| `sources_ingest_enabled()` | `WISDOM_SOURCES_INGEST_ENABLED` | S-C transcripts / Sunday Scans ingest |
| `extract_enabled()` | `WISDOM_EXTRACT_ENABLED` | S-D batch submit/reap |
| `vision_enabled()` | `WISDOM_VISION_ENABLED` | S-D chart images (D13 cost gate) |
| `extract_audit_enabled()` | `WISDOM_EXTRACT_AUDIT_ENABLED` | S-D weekly 50-segment audit |
| `outcomes_enabled()` | `WISDOM_OUTCOMES_ENABLED` | S-E |
| `context_snapshot_enabled()` | `WISDOM_CONTEXT_SNAPSHOT_ENABLED` | S-E |
| `replay_enabled()` | `WISDOM_REPLAY_ENABLED` | S-E CALL-REPLAY |
| `metrics_enabled()` | `WISDOM_METRICS_ENABLED` | S-E metrics + grounding eval |
| `retrieval_index_enabled()` | `WISDOM_RETRIEVAL_INDEX_ENABLED` | S-F FTS refresh |
| `weekly_report_enabled()` | `WISDOM_WEEKLY_REPORT_ENABLED` | S-F |
| `brainkb_publish_enabled()` | `WISDOM_BRAINKB_PUBLISH_ENABLED` | S-F (member-visible when on) |
| `askai_retrieval_enabled()` | `ASKAI_WISDOM_RETRIEVAL_ENABLED` | S-F (cohort `wisdom-askai`) |
| `desk_markers_enabled()` | `WISDOM_DESK_MARKERS_ENABLED` | S-F |
| `badges_enabled()` | `WISDOM_BADGES_ENABLED` | S-F |
| `pv_examples_enabled()` | `WISDOM_PV_EXAMPLES_ENABLED` | S-F (drafts only while the Pattern Intelligence Lab is paused) |
| `modelbook_drafts_enabled()` | `WISDOM_MODELBOOK_DRAFTS_ENABLED` | S-F |
| `voice_profile_enabled()` | `WISDOM_VOICE_PROFILE_ENABLED` | S-F |
| `dossier_enabled()` | `WISDOM_DOSSIER_ENABLED` | S-F |
| `level_alerts_enabled()` | `WISDOM_LEVEL_ALERTS_ENABLED` | S-F D20 (also hard-gated in code) |
| `lookalike_enabled()` | `WISDOM_LOOKALIKE_ENABLED` | S-F D20 (also hard-gated in code) |

Kill switches that default ON are named `*_DISABLED` and need no ledger row:
`DESK_TRANSCRIPT_COVERAGE_GUARD_DISABLED`, `DESK_VTT_ARCHIVE_DISABLED` (S-C, read in `desk_session_insights.py`).

Non-gate knobs (no ledger row): `WISDOM_DB_PATH`, `WISDOM_PRIVATE_DB_PATH`, `WISDOM_PRIVATE_KEY`,
`WISDOM_EXTRACT_MODEL` (default `claude-opus-5`), `WISDOM_EXTRACT_EFFORT` (default `high`),
`WISDOM_EXTRACT_BUDGET_USD` (default `120` = $80 × 1.5), `WISDOM_EXTRACT_LLM_TIMEOUT_SECS`,
`WISDOM_BADGES_LOOKBACK_DAYS` (default 10).

Member-visible flags (`brainkb`, `askai`, `desk_markers`, `badges`, `pv_examples`, `modelbook_drafts`,
`voice_profile`, `dossier`, `level_alerts`, `lookalike`) are the owner's to flip (W1 §0.4c). Ingest-side
flags are internal and are armed by the integrator after the merges, in one variable change.

---

## 5. Schedule (ET). Avoid minutes :00 :07 :11 :20 :23 :37 :41, */5, */10, and 00:40–05:00

| job_id | trigger | due_key | notes |
|---|---|---|---|
| `wisdom_core_catchup` | interval 300 s | — | skeleton |
| `wisdom_core_watchdog` | interval 300 s | — | skeleton |
| `wisdom_capture_detections` | cron daily 00:17 | date | before the 00:40 `patterns_prune`; read-only URI |
| `wisdom_capture_morning` | cron daily 05:43 | date | screener rows + Finviz artifact (after the 05:00 sweep) |
| `wisdom_capture_themes` | cron daily 06:13 | date | hash-on-change |
| `wisdom_capture_tweets` | cron hourly :29 | hour | official accounts, before the 03:00 cleanup |
| `wisdom_capture_eod` | cron mon-fri 16:52 | session | wire, candidates, RS, street, breadth intraday, GEX (or named gap) |
| `wisdom_capture_late` | cron mon-fri 17:34 | session | catalysts (after 17:00 final hunt), Pattern Vision verdicts |
| `wisdom_sources_discord_listener` | cron minute 13,28,43,58 | quarter-hour | the 15-minute heartbeat |
| `wisdom_daily_chain` | cron mon-fri 18:47 | session | W1 Part 7 daily chain, each step its own run row (owned by S-F orchestration module, steps call each package's public function) |
| `wisdom_extract_reap` | cron minute 16,46 | — | short tick, persists state |
| `wisdom_weekly_chain` | cron sun 19:52 | ISO week | W1 Part 7 weekly chain incl. report |
| `wisdom_monthly_packet` | cron sun day 1-7 20:22 | month | W6-format proposal packet (dark) |

`catch_up_grace_s`: capture jobs 6 h, daily chain 4 h, weekly 24 h.

---

## 6. Package contracts

### 6.1 S-A capture
- Every family reader returns `{"family","as_of","captured_at","source","rows","payload","gaps": {name: reason}}` and never raises.
- R2 key `wisdom/context/<as_of YYYY-MM-DD>/<family>.json.gz` via `core.r2.put_immutable`; one
  `wisdom_capture_runs` row per (run, dataset) with `row_count`, `bytes`, `trailing_median` (last 10 non-holiday
  sessions), `health` = `ok` | `low` (< 0.5 × median) | `zero` | `missing` | `holiday`. `zero`/`missing` on a
  trading day → `chart_health_alerts.emit("wisdom_capture_p1:<dataset>", "critical", …)`.
- Families and readers: capture-sources map (understand pass) §recommended_contract, minus GEX on web (asyncio
  loop hazard): GEX records a named gap with what was tried and the cost of the flow-worker alternative.
- Public: `capture.run_family(name, *, as_of=None, dry_run=False) -> dict`; `capture.health_table(conn, days=10) -> list[dict]`.

### 6.2 S-B schema, rails, entities
- `core/private.py`: `private_db_path()`; `PrivateBox = CryptoBox("WISDOM_PRIVATE_KEY")`; `put_private(record_id, field, value, source_locator) -> bool`
  (False and nothing stored when the key is absent — never plaintext); `get_private(record_id) -> list[dict]`.
- `core/entities.py`: `resolve(ticker_or_alias, as_of) -> dict | None` via `entity_master.api.resolve`; single-letter penalty; crypto → ETF map.
- `core/aliases.py` + `core/stt.py`: `apply_aliases(text) -> (text, corrections)`; `normalize_price(raw, ticker, session_date) -> (value | None, correction)`.
- `core/vocab.py`: seeds `wisdom_vocab` from `docs/wisdom/vocabulary/setup-vocabulary-v0.draft.json` (32 approved per W1 §3.1) and `wisdom_vocab_maps` from the six lists + pattern-engine ids + ENGINE setup strings, mismatches per W1 §3.3.
- Rails (stdlib AST, run in `.github/workflows/wisdom-rails.yml` AND by the integrator before every merge):
  1. Substack/Sunday-Scans-publisher import ban. 2. Journal/J2/Notebook/broker ban (imports, SQL table-name
  constants, `journal-2-0`/`lib/offline` paths). 3. Private-store import ban (allowlist: `core/private.py`,
  `extract/writer.py`, `api/routers/wisdom_core.py` owner routes). 4. Off-limits paths diff rail, branch-identity-checked
  (fires only on `feat/wisdom-loop` and `wisdom/*`). Each with a comment control, a docstring control, a planted-violation
  control and a files-scanned floor. Plus the property test (seeded random records; no private value ever reaches
  wisdom.db or any publish adapter output) and the vocabulary CI check (a new setup-name constant with no map row fails by name).

### 6.3 S-C sources
- Discord: REST only (no `wss://` under `api/`), UA `DiscordBot (https://uctintelligence.com, 1.0)`, allowlist =
  `core.authors`; non-author messages dropped before any write; quoted/replied member text stripped; 401/403 →
  `blocked_until = now + 1 h`; ≤ 5 pages per channel per tick; backfill resumable via `backfill_before`; reconcile the
  7,766 legacy classified messages by message id (`legacy_classified=1`, no re-classification of those).
- Zoom: pairing + coverage guard + VTT archive in `desk_session_insights.py`; R2 key
  `wisdom/sources/zoom_vtt/<sha24(meeting_uuid)>/<recording_file_id>.vtt`; a multi-TRANSCRIPT regression test.
  `tools/wisdom/sources_zoom_transcript_repair.py` (PC-side, explicit, dry-run default) rebuilds one video's transcript
  via `POST /api/education/videos/{id}/insights-store` with `transcript` ONLY.
- Sunday Scans: desk.db read-only through `desk_store`; the ingestion query requires `published_at > 0`; public-URL diff
  sets `published_check`; unsigned sections → `tsdr`, `attribution_source="D4 ruling"`.
- Transcripts: education.db read-only through `education_service.get_transcript_cues` (never a hand regex); coverage
  from cue span / YouTube length; `incomplete=1` below 0.98.

### 6.4 S-D extraction and golden
- Batch: own client `anthropic.Anthropic(api_key=..., timeout=llm_timeouts.seconds("WISDOM_EXTRACT_LLM_TIMEOUT_SECS", llm_timeouts.OFFLINE_JOB))`;
  `output_config={"format": {"type": "json_schema", "schema": <extraction-output-v0>}, "effort": ...}`; no sampling params,
  no prefill; `custom_id = "wx_" + sha256(source_id|source_version|segment_ids|extractor_version)[:40]`; meta = pointers only.
- Budget: hard stop when `estimate(pending + next) + actual_to_date > WISDOM_EXTRACT_BUDGET_USD`; estimates from
  `messages.count_tokens`; actuals from usage × 0.5 batch discount incl. cache reads/writes.
- Golden gate: a version may run on the catalog only when its dev-split metrics are recorded in `wisdom_eval_runs` and
  no per-type precision or recall regressed versus the previous accepted version (first version: thresholds recorded as baseline).
- Golden set v1: ≥ 100, stratified by type and author, labelled from source text by a labeller that never sees the extractor
  prompt; `data/wisdom/golden/golden-v1.jsonl` (gitignored) + quote-free `docs/wisdom/golden/golden-v1.provenance.json`;
  dev/test split = `"dev"` when `int(sha256(gid)[:8], 16)` is even, else `"test"` (as built in golden v1). Consumers read
  each record's stored `split` field and never recompute it.

### 6.5 S-E evals
- Outcomes per manifest §7.3; bars via `bars_sqlite.get_bars_before/get_bars_since`, read-only; same-bar stop+target →
  `same_bar_ambiguity=1` unresolved unless 5-minute bars exist.
- CALL-REPLAY sources and top-N per the eval-inputs map; levels (a) any, (b) top-N, (c) setup via `wisdom_vocab_maps`.
- `wisdom_metrics` rows: `numerator`, `denominator`, `value` NULL when denominator is 0. Metric names:
  `uct_see_rate_any`, `uct_see_rate_topn`, `uct_see_rate_setup`, `false_positive_rate`, `outcome_weighted_see_rate`,
  `grounding_faithfulness`, `grounding_citation_validity`, `grounding_coverage`, `extractor_precision`, `extractor_recall`,
  `capture_health`. `slice_json` keys: `setup`, `author`, `stream`, `month`, `status` (confirmed | provisional | combined).
- Scripts under `tools/wisdom/evals_*.py` call the same package functions the jobs call.

### 6.6 S-F admin and publish
- Admin page `/admin/wisdom` (admin cohort): review queue by tab, metrics with n beside every rate, capture health, job
  heartbeats, budget, flag states. `useSWR(key, jsonFetcher)`, no `refreshInterval`, UIcon only.
- Every adapter: flag off → writes `wisdom_publish_log(action='would_publish')` previews only and changes nothing in the consumer.
- Brain KB: `GET /api/internal/wisdom/publish/kb-export` + `tools/wisdom/publish_kb_sync.py` (dry-run default, backup first,
  one `BEGIN IMMEDIATE`, UPDATE/INSERT/`active=0`, never DELETE, `--db` explicit). Not scheduled while dark.
- Retrieval: FTS5 `wisdom_segments_fts` inside wisdom.db (no embeddings — paid transcripts do not go to a third-party
  embedding API; W4 can revisit with the owner). Ask-AI block after the brain block, one-arg `_grounded_system` kept, cohort via
  a ContextVar, `'wisdom'` added to `_PACK_TOOL_ALIAS`/`no_twin`, `GROUNDING_LABELS`, `_LIVE_SOURCES`, salt suffix.
- D20: `level_alerts.py` silent scorer into `wisdom_level_crosses`; `lookalike.py` into `wisdom_lookalike_scores`; both refuse
  to deliver unless the flag is on AND `replay_baseline_n >= 100` AND the silent-scoring window ≥ 14 days (checked in code).
- Weekly report: `wisdom_reports` row + admin Discord embed (`discord_notify._send_webhook`) when enabled; dry-run preview today.
  Sections include Contradictions and "D16b: deferred".
- `docs/wisdom/RUNBOOK.md` draft (jobs, flags, kill switches, recovery, cost controls) in the final report; integrator commits it.

---

## 7. Tests every stream runs by name before reporting done

```
python -m pytest tests/test_wisdom_*.py \
  tests/test_feature_flag_ledger.py tests/test_shared_data_root_guard.py tests/test_no_shadowed_definitions.py \
  tests/test_cross_module_imports_resolve.py tests/test_llm_timeout_census.py tests/test_d3_realtime_topology_rail.py \
  tests/test_admin_guard_registered.py tests/test_exposed_routes_gated.py tests/test_health_routes_admin_gated.py -q
```

plus the stream's own touched suites (e.g. `tests/test_desk_session_insights.py`, `tests/test_ai_search_*.py`), and for S-F
`cd app && npx vitest run <its test files> src/components/screener/reachable.test.js src/utils/jsonFetcher.test.js src/hooks/pollingSites.rail.test.js src/styles --maxWorkers=2`.
A run counts only with its totals line. Never `pytest tests/` unscoped. One test run at a time on this box.

---

## 8. Integration protocol

1. A stream finishes on its own branch `wisdom/w1-<letter>-<slug>` with every commit tested and a final report:
   files, tests + totals lines, rails, open requests for shared files, and what it could not do.
2. The integrator reads the diff against W1 Part 4 and §0.4, re-runs the tests, applies shared-file requests, writes the ledger rows,
   and merges into `feat/wisdom-loop`.
3. Master merges: S-B → S-A → S-C → S-D → S-E → S-F, one at a time, each after `git fetch` + rebase, the flow-worker coverage
   classification, a check of other programs' in-flight merges, and outside 17:50–18:30 ET and ±3 min of an odd ET hour;
   the next waits for Railway `web` SUCCESS verified by `/api/health` uptime reset.
