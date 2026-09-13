# P2 — Auto T+1 Gap-Fill: Hardened Spec (v2)

**Owner:** Patrick end-to-end. New module `api/flow_gap_autofill.py` + ~6 lines in `main.py`. Zero edits to Ravi's files (`massive_*`, `live_massive_router.py`); zero edits to `flow_db.py`; `flow_router.py` untouched in the base design (one optional 3-line hardening patch, gated on Ravi's OK).
**Gates:** `FLOW_GAP_AUTOFILL_ENABLED` (default **0** — ships dark), `FLOW_GAP_AUTOFILL_DRY_RUN` (default **1** for week one), `FLOW_GAP_AUTOFILL_SKIP_BACKUP` (default 0).

---

## 1. Schedule — post-close, not 12:45 PM

| Fire (ET, native to the existing `BackgroundScheduler(timezone=America/New_York)`) | Purpose |
|---|---|
| **16:45 Mon–Fri** | Primary run for T-1 (and walk-back ≤5 trading days). Flat file published ~11:00 AM ET, so it is available; options close 16:15, so flow.db writes are ~zero. |
| **21:00 Mon–Fri** | Retry if 16:45 ended `no_file`/`failed`, and resume of any partially-completed run (via re-detection). |
| **08:00 Tue–Sat equivalent (Mon–Fri cron, fills prior day)** | Final pre-market retry; also the write-quietest slot if 16:45+21:00 both missed. |

Why not 12:45 PM (old spec): market hours = live WS worker writing every second on the same flow.db → (a) a second-connection SQLite backup restarts forever, (b) write-lock contention with the fill transaction, (c) users watch the CSV rebuild mid-session. The 16:45 slot costs ~4h of heal latency and removes all three. Job registration: `id='flow_gap_autofill_HHMM'`, `max_instances=1`, `replace_existing=True` — same idiom as `massive_flatfiles_worker.register_jobs`.

All scheduled work runs on APScheduler's worker threads; the **manual admin trigger endpoint spawns a `threading.Thread(daemon=True)` and returns `{run_id}` immediately** — never inline (the existing flatfiles manual route at main.py:2953 is the anti-pattern; do not copy it).

## 2. Detection (own implementation — no dependency on Ravi's router)

Reimplemented ~80 lines in `flow_gap_autofill.py` (the /worker-history logic is the model, its bugs are not):

- **Time:** `ZoneInfo("America/New_York")` everywhere. No UTC-4 constants. This removes P2's dependency on the 4 hardcoded UTC-4 sites in `live_massive_router.py` (that fix stays with Ravi as hygiene).
- **Calendar:** `trading_calendar.py` — skip non-trading days entirely; clamp session end to **13:00** on early-close days (kills the false 180-min gap class). Session = 09:30 → 16:00 (16:15 index tail noted as an accepted blind spot, see Limits).
- **Signal:** minute-buckets of `CreatedTime` for `CreatedDate = T-1 AND source='stocks'` (parse `H:MM:SS AM/PM`, 12 AM/PM edges tested). Zero-row minutes grouped into runs; a window = run of `>= FLOW_FILL_MIN_GAP_MINUTES` (default **2**) consecutive empty minutes. At the measured ~13 stocks-rows/min average, P(false zero-minute) ≈ e^-13; two consecutive ≈ never on normal days.
- **Modes:** 0 rows all day → `full_session` window (09:30–close). Empty minutes > 50% of session → also `full_session` (cleaner than 20 stitched windows; the degradation tradeoff flips when most of the day is missing anyway).
- **v1.5 (shadow only):** report minutes with counts < 10% of the day-median as "degraded-minute suspects" in Discord — **do not fill them** until we've sized the Class-B residual post-P1.
- Target date is always a completed past day → no live-day tail clamping needed (deletes the whole `scan_end` bug class).

## 3. Fill algorithm — delete-window-then-fill (decision, not option)

**Per-contract reconciliation is rejected.** Partial capture at a gap edge changes Volume, Premium, Type and the CreatedTime bucket of a burst, so matching live-partial ↔ flatfile-full events is fuzzy by construction; a false negative double-counts (inflated premium at every edge), a false positive drops a real print. Delete-window is deterministic and gives a provable invariant: **every second of a filled window is single-source.** Cost: with a ±60s margin and ~18 rows/min average (~130/min busy), each gap converts ~36–260 full-quality rows to flatfile quality, while a single 10-min gap recovers 150–1300+ rows that are otherwise gone forever (Massive OPRA does not replay). The 500ms sliding-gap aggregator means bursts span seconds; ±60s over-covers any edge-straddling burst.

```
run(target_date):                                  # all times ET via ZoneInfo
  guards: env gate; module Lock(non-blocking); manifest: skip if run for
          target_date with status in (completed, no_gaps) within 24h and not force
  run_id = insert flow_fill_runs(status='running', heartbeat)   # own txn
  windows = detect(target_date)                    # section 2
  if not windows: finish(run_id,'no_gaps'); bump-if-needed; report; return

  backup = sqlite3_backup(flow.db -> /data/flow_backups/flow-pre-{run_id}-{date}.db)
           # single-pass (pages=-1): consistent WAL snapshot, no writer blocking
           # on failure: abort run 'failed' + Discord, unless SKIP_BACKUP=1
  prune backups: keep 3 newest, delete >14 days

  gz = massive_flatfiles_worker._download(target_date)      # import, not copy
  if gz is None: finish(run_id,'no_file'); report; return   # retries at 21:00/08:00
  events = batch_process(sorted df, MIN_PREMIUM, MIN_VOLUME) # import; SAME env
           # thresholds logged; warn if != WS worker's
  rows   = [event_to_bbs_row(e, source, oi=..., mktcap=..., sector=...)   # reuse
            for e in events]      # OI via _load_oi_for_events(snap_date=T-1),
                                  # MktCap/Sector via _load_ticker_metadata (imports)
  index rows by sec_of_day(CreatedTime)

  for w in windows:                                # ONE txn per window
    lo, hi = w.start_min*60 - 60, w.end_min*60 + 60          # ±60s margin
    BEGIN IMMEDIATE
      victims = SELECT * FROM flow WHERE CreatedDate=? AND source IN ('stocks','indexes')
                AND id IN (python-side ids whose parsed CreatedTime in [lo,hi))
                # CreatedTime is TEXT 'H:MM:SS AM/PM' — not SQL-comparable;
                # ids resolved in Python (worker-history pattern), DELETE chunked IN(...)
      INSERT INTO flow_fill_archive SELECT (all cols + run_id, window_id, orig_id) FROM victims
      DELETE FROM flow WHERE id IN victims
      for row in rows where lo <= sec(row) < hi:            # BOTH sources
        dedup = FlowDB._make_dedup_key(row, src)             # imported static — never fork
        INSERT INTO flow (...) ; on IntegrityError -> skipped+=1
        else INSERT INTO flow_fill_inserted(run_id, window_id, lastrowid)
      UPDATE flow_fill_windows SET status='filled', counts...
    COMMIT                                          # crash before commit = clean rollback

  post-fill assertions (page on violation, still complete the run):
    re-detect(target_date) == []                    # gaps actually healed
    COUNT(*) == COUNT(DISTINCT dedup_key) for date  # no boundary dupes
  finish(run_id,'completed', version_before/after)
  bump_data_version()                               # SECTION 4 — MANDATORY
  discord_report(run)
```

**Transactions/locking:** FlowDB conventions already in place (WAL, `synchronous=NORMAL`, 30s busy timeout). `BEGIN IMMEDIATE` takes the write lock up front (no upgrade deadlock). Window txns are small (10-min gap ≈ 200–1300 rows + archive copies); inserts chunked `executemany`-style at 500. Post-close there is no live writer; the 30s timeout is the backstop, not the plan.

**Accepted degradation on backfilled rows** (verified from `event_to_bbs_row` + `_process_bytes`): `Side=''`, `Spot='0'`, `ImpliedVolatility='0'`, `Color` computed without day-cumulative volume (fewer YELLOW/MAGENTA); `OI`, `MktCap`, `Sector`, `Type`, `Weekly`, `Dte` are fully populated. Present-but-degraded ≫ absent.

## 4. THE CACHE-VERSION FIX (without this, P2 is invisible)

Verified trap: `_current_version()` = flow **row count** + `_FORCE_BUMP_OFFSET`·10M (`flow_router.py:86-96`). Delete-N/insert-M with N==M ⇒ version unchanged ⇒ the in-memory LRU serves the old gzip, `/api/flow/version` returns the old number so clients keep the old `?v=N`, and Cloudflare (max-age=300, **stale-while-revalidate=86400**) keeps the old edge entry. The fill "succeeds" and nobody ever sees it.

**Fix, two mandatory layers + one optional:**
1. **Post-fill bump:** every mutating run (completed or rolled_back) calls `flow_router.bump_data_version()` — the exact pattern main.py already uses at 5 admin call sites. Effect: `+10M` version, in-memory cache cleared, next client `/version` poll re-fetches with a new `?v` → CF miss → fresh build. Import defensively: `bump = getattr(flow_router, 'bump_data_version', None)` (dangling-import playbook).
2. **Boot-time re-bump:** `_FORCE_BUMP_OFFSET` is process-local — **any deploy resets it to 0**, and version returns to plain row-count, which can equal a pre-fill value still cached at the edge/browser inside the 24h s-w-r window. On module init (startup registration), if the manifest shows any completed fill in the last 24h → call `bump_data_version()` once. Version becomes row_count+10M ≠ any pre-fill URL.
3. **Optional hardening (one-line OK from Ravi):** change `_current_version()` to `COUNT(*) + MAX(id) + offset·10M`. `MAX(id)` is monotonic under AUTOINCREMENT (ids never reused), so any delete+insert changes the version **persistently** with no bump choreography. ~3 lines in `flow_router.py`; layers 1–2 remain correct without it.

## 5. Manifest schema (lives IN flow.db — same-transaction atomicity with the fill)

```sql
CREATE TABLE IF NOT EXISTS flow_fill_runs (
  run_id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_date TEXT NOT NULL,            -- 'M/D/YYYY', matches flow.CreatedDate
  status TEXT NOT NULL,                 -- running|completed|no_gaps|no_file|failed|rolled_back
  mode TEXT NOT NULL DEFAULT 'windows', -- windows|full_session|dry_run
  started_at TEXT NOT NULL, finished_at TEXT, heartbeat_at TEXT,
  backup_path TEXT, min_premium REAL, min_volume INTEGER,
  windows_found INTEGER DEFAULT 0, rows_deleted INTEGER DEFAULT 0,
  rows_inserted INTEGER DEFAULT 0, rows_skipped_dupe INTEGER DEFAULT 0,
  version_before INTEGER, version_after INTEGER, error TEXT);

CREATE TABLE IF NOT EXISTS flow_fill_windows (
  window_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES flow_fill_runs(run_id),
  gap_start_min INTEGER, gap_end_min INTEGER,   -- detected gap (minutes-of-day)
  start_sec INTEGER NOT NULL, end_sec INTEGER NOT NULL,  -- incl. ±60s margin
  status TEXT NOT NULL,                          -- pending|filled|failed
  deleted_count INTEGER DEFAULT 0, inserted_count INTEGER DEFAULT 0,
  skipped_dupe_count INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS flow_fill_inserted (
  run_id INTEGER NOT NULL, window_id INTEGER NOT NULL, flow_id INTEGER NOT NULL,
  PRIMARY KEY (run_id, flow_id));

CREATE TABLE IF NOT EXISTS flow_fill_archive (      -- full copies of DELETED rows
  archive_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL, window_id INTEGER NOT NULL, orig_id INTEGER NOT NULL,
  source TEXT, /* …all 22 flow CSV columns… */ dedup_key TEXT, orig_created_at TEXT);
```
Tables are namespaced `flow_fill_*`, created by our module's init; the `flow` table itself is never ALTERed. Archive pruned at 30 days.

**Rollback** (`POST /api/flow-gap-fill/rollback/{run_id}`, admin, thread-spawned): refuse runs > 7 days old (prune_expired interplay); one txn per window: delete ids in `flow_fill_inserted`, re-insert `flow_fill_archive` rows; mark run `rolled_back`; `bump_data_version()`.

## 6. Failure handling

| Failure | Behavior |
|---|---|
| Flatfile 404 at 16:45 | run `no_file`; 21:00 + 08:00 retries; Discord warn on final miss |
| Backup fails | abort run `failed` + Discord (override: `SKIP_BACKUP=1`) |
| Crash / deploy-kill mid-window | txn rolls back; run left `running`; next fire marks stale-heartbeat (>30 min) runs `failed` and starts fresh; filled windows no longer detect → automatic resume of only the remainder |
| Scheduler double-fire / manual overlap | `max_instances=1` + module Lock + manifest same-day guard + dedup_key no-op floor |
| Post-fill assertion fails (residual gap or dupe keys) | complete the run, **page** (Discord @here), auto-suggest rollback command |
| DB error mid-run | run `failed` with error text; nothing half-applied (per-window atomicity) |

**Discord report per run:** target date · mode · windows (times, deleted/inserted/dupes each) · thresholds · version before→after · backup path · duration · assertion results · v1.5 degraded-minute suspects.

## 7. Ownership & wiring (smallest touch)

- **New (Patrick):** `api/flow_gap_autofill.py` — detection, fill, manifest, backup, rollback, Discord, plus its own `APIRouter` (`/api/flow-gap-fill/status|run|rollback`, admin-gated writes).
- **Imports only (no edits):** `flow_db.FlowDB/COLUMNS/_make_dedup_key`; `massive_flatfiles_worker._download/MIN_PREMIUM/MIN_VOLUME/_load_oi_for_events/_load_ticker_metadata`; `massive_processor.batch_process/event_to_bbs_row/is_index_source`; `flow_router.bump_data_version` (via getattr).
- **main.py (+~6 lines, shared file, additive):** inside the existing `acquire_scheduler_lock()` block right after `massive_flatfiles_worker.register_jobs(...)`: `try: from api import flow_gap_autofill; flow_gap_autofill.register_jobs(_scheduler); except Exception: log` — and one `app.include_router(flow_gap_autofill.router)` next to the flow routers. `@app.on_event` style only; no `lifespan=`.
- **Ravi needs to say yes to exactly two things:** (1) delete-window decision (this doc's §3 is the argument), (2) optionally the 3-line `_current_version()` hardening in flow_router.py.

## 8. Known limits (accepted, documented)

- Index prints 16:00–16:15 aren't scanned (detection is stocks/09:30–16:00); windows detected from stocks are filled for both sources, so only a *standalone* index-tail gap is missed. Rare: same process feeds both.
- Class-B degraded minutes (partial, non-zero) are reported (v1.5 shadow) but not auto-filled in v1.
- Filled rows carry high rowids → out of chronological order in the un-ORDERed CSV; verify UI tolerance in AT-9 before deciding anything (client fix would be Ravi's `OptionsFlow.jsx`).
- Two genuinely distinct events with identical (date, time-second, sym, type, vol, price, cp, strike, exp, premium) collapse to one row — pre-existing platform-wide dedup semantics, unchanged by P2.

## 9. Acceptance tests

Unit (temp flow.db, `FLOW_DB_PATH` override; no network — fake events list injected in place of `_download`/`batch_process`):
- **AT-1 detection:** full day minus 10:05–10:14 → exactly one window [10:05,10:15); min_gap honored; early-close day (13:00) produces no false afternoon window; all-empty day → `full_session`; DST-transition date parses correctly.
- **AT-2 both-sources fill:** stocks-detected window deletes+fills `indexes` rows in the same window too.
- **AT-3 boundary dedup:** live partial (Vol=100) at 10:04:58 + flatfile full (Vol=150) same burst → exactly one surviving row (flatfile's); `COUNT(*) == COUNT(DISTINCT dedup_key)` for the date.
- **AT-4 margin correctness:** live row at 10:03:59 (outside lo=10:04:00) untouched; identical flatfile event outside window not inserted.
- **AT-5 cache version:** deleted==inserted run → `_current_version()` differs pre/post; `_RESPONSE_CACHE` cleared; boot-re-bump fires when a completed run is <24h old and not otherwise.
- **AT-6 crash resume:** exception injected post-DELETE pre-COMMIT → flow table byte-identical; second run completes only the remaining window.
- **AT-7 rollback:** fill → rollback → flow rows equivalent to pre-fill (modulo id/created_at); version bumped; run `rolled_back`; rollback of an 8-day-old run refused.
- **AT-8 idempotency:** immediate re-fire → `no_gaps`, zero writes, ≤1 extra bump.

Prod acceptance (supervised):
- **AT-9 first live run:** week-one `DRY_RUN=1` reports match the known 7/6 windows (16 windows ≥2 min); then one supervised real run: backup file passes `PRAGMA integrity_check`; `curl /api/flow/version` changes; OptionsFlow UI shows filled minutes for the target day (and renders them in acceptable order); Discord report received; post-fill re-detection empty.
- **AT-10 quiet-day no-op:** on a gap-free day the job exits `no_gaps` without downloading the flat file (zero S3 cost, zero writes).

---
## Risk appendix

**P2-R1** (high×critical): CACHE-VERSION TRAP: cache invalidation version = flow row count (_current_version in flow_router.py:86-96). A delete-N/insert-M fill with N==M leaves the version unchanged, so the in-memory LRU (_RESPONSE_CACHE), client ?v=N cache-busting, and the Cloudflare edge (max-age=300, stale-while-revalidate=86400) all keep serving the PRE-fill CSV. P2 silently does nothing user-visible.
- Mitigation: Call flow_router.bump_data_version() after every mutating run (established pattern — main.py already does this at 5 admin call sites). Because _FORCE_BUMP_OFFSET is process-local and resets to 0 on every deploy, add a boot-time re-bump: flow_gap_autofill init checks its manifest and re-calls bump_data_version() once if any fill completed in the last 24h (the CF s-w-r window). Optional 3-line hardening in flow_router.py (needs Ravi's one-line OK): version = COUNT(*) + MAX(id) + offset — MAX(id) is monotonic under AUTOINCREMENT so any delete+insert changes it persistently.
- Verify: Acceptance test AT-5: fill with deleted==inserted, assert _current_version() differs pre/post and _RESPONSE_CACHE was cleared. Prod: curl /api/flow/version before/after the first supervised run; confirm the OptionsFlow page shows the filled minutes after one version poll cycle.

**P2-R2** (high×high): Running the fill at T+1 12:45 PM ET (current spec) collides with live market-hours writes to the same flow.db: (a) SQLite backup from a second connection restarts whenever another connection writes — with the WS worker flushing every second the 774MB backup may never complete; (b) delete+insert write-txn contends with the live writer; (c) users watching the live flow page see a mid-session version bump + full CSV rebuild.
- Mitigation: Move the run to T+1 16:45 ET (post options close 16:15; the flat file publishes ~11:00 AM ET so availability is not a constraint), retry 21:00 ET, final retry next-day 08:00 ET pre-market. At 16:45 write traffic is ~zero: single-pass WAL backup gets a consistent snapshot, and BEGIN IMMEDIATE txns face no contention (FlowDB already has WAL + 30s timeout as backstop).
- Verify: Run-start guard logs the live worker's last_event_age; assert no SQLITE_BUSY in the first two weeks of runs; backup duration logged < 60s.

**P2-R3** (high×high): Boundary double-count: a burst partially captured live at a gap edge has different Volume/Premium than the flatfile's full aggregation → different dedup_key → both rows survive → inflated premium/UOA at every gap edge. Conversely, per-contract reconciliation requires fuzzy matching (partial capture changes Volume, Premium, Type, and CreatedTime bucketing) whose false negatives double-count and false positives drop real events.
- Mitigation: Delete-window-then-fill with ±60s margin, chosen over per-contract reconciliation. Aggregation is a 500ms sliding-gap per contract (massive_processor.py:222), so bursts span seconds; ±60s deterministically removes every possibly-partial live row. Cost: ~36-260 full-quality rows per gap degraded to Side=''/Spot='0' (avg tape rate ~18 rows/min, busy ~130/min) vs recovering 150-1300+ rows per 10-min gap. Invariant: every second of a filled window is single-source.
- Verify: AT-3: synthetic partial live event (Vol=100) + flatfile full event (Vol=150) at the gap edge → exactly one surviving row. Global post-fill assertion: COUNT(*) == COUNT(DISTINCT dedup_key) for the target date.

**P2-R4** (medium×high): Job dies mid-fill (deploy kill — evening deploys are the house norm after P4, exactly when the fill runs — or crash): half-filled day, manifest inconsistent, or a window deleted but not refilled.
- Mitigation: Per-window atomicity: archive+delete+insert+manifest-window-update in ONE SQLite transaction (BEGIN IMMEDIATE). Crash rolls back the in-flight window completely. Resume is automatic: the next scheduled fire (21:00 / 08:00) re-detects gaps — already-filled windows have rows and no longer detect; a stale 'running' run (heartbeat > 30 min) is marked failed and a fresh run proceeds.
- Verify: AT-6: inject an exception after DELETE, before COMMIT → flow table byte-identical to pre-run; re-run completes the window.

**P2-R5** (medium×high): Irreversible fills: the current spec's manifest records only inserted rowids — reversal of a delete-window fill ALSO requires restoring the deleted live rows, otherwise a bad run permanently destroys full-quality live data.
- Mitigation: flow_fill_archive table stores complete copies of every deleted row (all 22 columns + dedup_key + orig id) keyed by run/window, written in the same transaction as the delete. Rollback endpoint = delete inserted ids, re-insert archived rows, bump version. Plus a pre-run whole-file backup via the sqlite3 backup API to /data/flow_backups/ (774MB today; 80GB volume; keep 3, prune >14d); abort the run if backup fails unless FLOW_GAP_AUTOFILL_SKIP_BACKUP=1.
- Verify: AT-7: fill → rollback → flow rows equivalent to pre-fill (modulo id/created_at); backup file exists and opens with PRAGMA integrity_check.

**P2-R6** (medium×medium): Half-days and holidays: scanning to 16:00 on a 1:00 PM early close manufactures a false 180-minute 'gap' → the job deletes nothing (no rows there) but blind-inserts nothing either (flatfile also empty) — noisy at best; on holidays the flatfile 404s and burns retries. The DST bug class (live_massive_router hardcodes UTC-4 at 4 sites) breaks any reused detection code in November.
- Mitigation: Detection is REIMPLEMENTED in flow_gap_autofill.py (not imported from Ravi's router): ZoneInfo('America/New_York') for all time math, trading_calendar.py for skip-nontrading-days and early-close clamp (13:00 sessions). P2 no longer depends on fixing Ravi's UTC-4 sites.
- Verify: AT-1 includes an early-close-day case (session clamped, no false window) and a DST-transition date case; unit test asserts no 'utcnow + 4h' pattern anywhere in the module.

**P2-R7** (low×medium): Filter drift: fill events are produced with MASSIVE_MIN_PREMIUM/MASSIVE_MIN_VOLUME read at import; if these ever diverge from the WS worker's thresholds, the fill inserts rows the live worker would never have written (or misses ones it would), making filled windows statistically inconsistent with live windows.
- Mitigation: Import MIN_PREMIUM/MIN_VOLUME from api.massive_flatfiles_worker (same env, same process as the WS worker today) and log both values in the run manifest; warn to Discord if flatfiles and WS thresholds differ.
- Verify: Run report includes the thresholds; grep the first prod run's Discord message.

**P2-R8** (medium×medium): Scheduler double-fire / same-day re-run inserts a second fill or thrashes: e.g. 16:45 run still in flight at 21:00, or a manual admin trigger during a scheduled run.
- Mitigation: Four layers: APScheduler max_instances=1 + shared job id; module-level non-blocking threading.Lock; manifest guard (skip target_date if a completed/no_gaps run exists within 24h unless force); and natural idempotency — re-detection finds no gaps in filled windows, and dedup_key UNIQUE makes identical re-inserts silent no-ops.
- Verify: AT-8: fire the job twice back-to-back → second run status no_gaps, zero rows written, version bumped at most once.

**P2-R9** (low×low): Rollback of an old run resurrects expired contracts that prune_expired (runs on every /upload, 7-day buffer) has since deleted from the rest of the table, corrupting date-consistency; archive table grows unbounded.
- Mitigation: Rollback endpoint refuses runs older than 7 days; flow_fill_archive pruned at 30 days; auto-fill scope is T-1 only (walk-back limited to ≤5 trading days, inside the prune buffer).
- Verify: Unit test: rollback of an 8-day-old run returns 409; archive prune covered in AT suite.

**P2-R10** (medium×medium): Detection blind spots: worker-history logic counts only source='stocks' zero-write minutes, so index-only gaps are invisible, and Class-B DEGRADED minutes (partial capture, some rows written) are never detected or healed.
- Mitigation: v1: detect on stocks (13+ rows/min average makes zero-minutes a near-perfect signal) but fill BOTH sources for every detected window (same process died, both feeds gapped). v1.5 (shadow mode first): flag 'severe-dip' minutes (< 10% of day-median rate) in the Discord report WITHOUT filling, to size the degraded-minute problem before automating it.
- Verify: AT-2 covers both-sources fill; shadow-mode dip report reviewed after one week against known Class-B windows from 7/6.

**P2-R11** (low×low): Filled rows are appended with high rowids, so stream_csv (no ORDER BY) serves them out of chronological order within the day; if OptionsFlow.jsx assumes time-ordered rows, filled prints render at the wrong position.
- Mitigation: No server change (avoids touching Ravi's read path). Acceptance test eyeballs the UI for a filled day; if the UI mis-renders, fix the client sort (OptionsFlow.jsx is partner-owned — flag to Ravi) rather than the CSV.
- Verify: AT-9 manual UI check on the first supervised fill.
