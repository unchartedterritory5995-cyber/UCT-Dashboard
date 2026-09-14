---
id: WISDOM-LOOP-RUNBOOK-W1
title: UCT Wisdom Loop — operations runbook (Wave 1)
status: draft
generated: 2026-09-13
authority: >
  Operational companion to docs/wisdom/CONTRACTS.md. Where this file and the
  contract disagree, the contract wins and this file is the thing to fix. Names
  here are quoted from the code: api/services/wisdom/registry.py (jobs),
  api/services/wisdom/core/flags.py (gates), each package's jobs.py (slots).
---

# Wisdom Loop runbook

Everything in the Wisdom Loop ships **dark**. Every gate defaults off, nothing
member-visible changes without the owner's flag flip (W1 §0.4c), and every kill
switch is read **per run or per request**, so turning one off takes effect on the
next tick without a deploy.

⛔ **Never read a flag's state from this file or from `docs/feature_flags.json`.**
The ledger records intent; `railway variables --service web --kv` records config;
only the running process proves state (CLAUDE.md "`railway variables --set` —
measured BOTH ways").

---

## 1. Where to look first

| Question | Door |
|---|---|
| Is every job alive, and when did it last succeed? | `/admin/wisdom` → **Jobs**, or `GET /api/admin/wisdom/core/status` |
| What did the last run of a job return? | `GET /api/admin/wisdom/core/runs?job_id=<id>` |
| Which chain step failed, and why? | `/admin/wisdom` → **Jobs** → *Chains — last runs*; table `wisdom_chain_steps` |
| Is capture healthy? | `/admin/wisdom` → **Capture health**; table `wisdom_capture_runs` |
| What does the owner need to rule on? | `/admin/wisdom` → **Queue** |
| What did the loop cost? | `/admin/wisdom` → **Budget & flags**; table `wisdom_batches` |
| The weekly report | `/admin/wisdom` → **Reports**; table `wisdom_reports` |

All `/api/admin/wisdom/*` routes are `require_admin`; ruling on a queue item is
`require_owner` (§6). Machine routes live under `/api/internal/wisdom/*` behind the
`PUSH_SECRET` bearer.

**Reading wisdom.db on production** (read-only, the `railway ssh` recipe from CLAUDE.md —
`/opt/venv/bin/python`, never bare `python3`; pass the script base64-encoded):

```sh
# from C:\Users\Patrick\uct-worktrees\wisdom-loop (the Railway-linked directory)
railway ssh --service web -- echo <base64 script> "|" base64 -d "|" /opt/venv/bin/python
# script: import sqlite3; c = sqlite3.connect("file:/data/wisdom.db?mode=ro", uri=True); ...
```

⛔ Never run a heavy script on the web pod (OOM ⇒ member outage). Heavy work is PC-side under
`python C:\Users\Patrick\uct-clips\tools\heavy_lock.py run --label <label> -- <command>`.

---

## 2. Jobs

Every job is registered **unconditionally** (CONTRACTS §0 ruling 8) and runs only through
`registry.run_job`, which applies, in order: the master switch `WISDOM_INGEST_ENABLED` →
the job's own kill switch → the trading-day check → the durable claim
`wisdom_job_claims(job_id, due_key)` → the run → a `wisdom_job_runs` row + a heartbeat upsert.

**Heartbeat:** one row per job in `wisdom_job_heartbeats`, written on EVERY run including skips
(`last_status = skipped`, reason in `last_error`). `last_ok_at` only moves on success.

**Pages** (via `chart_health_alerts.emit(..., "critical")`, which pages the admin Discord):

| Page key | Meaning |
|---|---|
| `wisdom_job_failed:<job_id>` | the run raised (for a chain: at least one step failed, after every step ran) |
| `wisdom_job_missed:<job_id>` | an ENABLED job has not succeeded for 2 × `expected_every_s` (non-trading days excluded for trading-day jobs); once per episode, cleared by the next ok |
| `wisdom_capture_p1:<dataset>` | a dataset captured `zero` / `missing` rows on a trading day (S-A) |

**Catch-up:** `wisdom_core_catchup` runs every 300 s and re-runs a cron slot the in-memory
scheduler never fired (a deploy across the minute) or that failed more than 30 min ago, within the
job's `catch_up_grace_s`. The durable claim makes it safe to overlap the scheduler.

### 2.1 Roster (CONTRACTS §5; ET)

| job_id | slot | due_key | grace | kill switch (besides the master) | owner stream |
|---|---|---|---|---|---|
| `wisdom_core_catchup` | every 300 s | — | — | `WISDOM_INGEST_ENABLED` | skeleton |
| `wisdom_core_watchdog` | every 300 s | — | — | `WISDOM_INGEST_ENABLED` | skeleton |
| `wisdom_capture_detections` | daily 00:17 | date | 6 h | `WISDOM_CAPTURE_ENABLED` | S-A |
| `wisdom_capture_morning` | daily 05:43 | date | 6 h | `WISDOM_CAPTURE_ENABLED` | S-A |
| `wisdom_capture_themes` | daily 06:13 | date | 6 h | `WISDOM_CAPTURE_ENABLED` | S-A |
| `wisdom_capture_tweets` | hourly :29 | hour | 6 h | `WISDOM_CAPTURE_ENABLED` | S-A |
| `wisdom_capture_eod` | mon-fri 16:52 | session | 6 h | `WISDOM_CAPTURE_ENABLED` | S-A |
| `wisdom_capture_late` | mon-fri 17:34 | session | 6 h | `WISDOM_CAPTURE_ENABLED` | S-A |
| `wisdom_sources_discord_listener` | minute 13,28,43,58 | quarter-hour | — | `WISDOM_DISCORD_LISTENER_ENABLED` | S-C |
| `wisdom_daily_chain` | mon-fri 18:47, trading days only | session | 4 h | `WISDOM_INGEST_ENABLED` (each step's package checks its own) | S-F |
| `wisdom_extract_reap` | minute 16,46 | — | — | `WISDOM_EXTRACT_ENABLED` | S-D |
| `wisdom_weekly_chain` | sun 19:52 | ISO week (`2026-W38`) | 24 h | `WISDOM_INGEST_ENABLED` (+ per step) | S-F |
| `wisdom_monthly_packet` | first Sunday (day 1-7 AND sun) 20:22 | month (`2026-10`) | 24 h | `WISDOM_INGEST_ENABLED` | S-F |

⚠️ The capture/sources/extract rows are the CONTRACT; confirm each against that package's
`jobs.py` after its merge — the registry's `/api/admin/wisdom/core/status` lists what is actually
registered, with its trigger and switch state.

### 2.2 The chains (`api/services/wisdom/publish/chain.py`)

Each step calls ONE public function of the package that owns the work, as `fn(ctx)`:

| chain | order |
|---|---|
| daily | `capture.run_all` → `sources.run_daily` → *(STT/alias pass, inside extraction)* → `extract.run_daily` → `evals.run_daily` (context → outcomes → replay) → `publish.retrieval.refresh` → `publish.adapters.run_daily` (Brain KB and every consumer, each flag-gated; dark previews when off) → `publish.level_alerts.score_silently` → `publish.lookalike.score_silently` → one observation-log line per stream (`wisdom_observation_log`) |
| weekly | `sources.run_weekly_sunday_scans` → `evals.reconcile_weekly` → `core.vocab.refresh_candidates` → contradictions refresh (`publish.chain.contradictions_refresh`) → `publish.adapters.refresh_voice_profile` (skipped while `WISDOM_VOICE_PROFILE_ENABLED` is off) → `publish.report.run_weekly` → `extract.run_weekly_audit` |
| monthly | `publish.report.build_monthly_packet` |

Every step writes its own `wisdom_chain_steps` row: `ok` · `failed` · `not_available` (module or
function not built — named in `reason`) · `skipped` (with reason). **One failing step never stops
the rest.** A chain with any `failed` step raises after the last step, so the registry records the
run as failed and pages. A re-run for the same due_key skips steps already `ok` for that slot (dry
runs never count), so only the failed and unfinished work repeats. `not_available` is not a failure:
Wave 1 ships chains before some packages exist.

### 2.3 When a job pages

| Page | Do this |
|---|---|
| `wisdom_job_failed:wisdom_daily_chain` / `weekly_chain` / `monthly_packet` | Open **Jobs → Chains**, read the failed step's `reason`. Fix or switch off that package's flag. Catch-up re-runs the slot (only unfinished steps) every 30 min inside the grace window; after it, see §5.1. |
| `wisdom_job_failed:<package job>` | `GET /api/admin/wisdom/core/runs?job_id=<id>` → `error`. The package's own section of CONTRACTS §6 names its public function; rerun on demand once fixed (§5.1). |
| `wisdom_job_missed:<job_id>` | The job is enabled but has not succeeded for two periods. Check the heartbeat's `last_status`: `skipped` with a reason (switch off, not a trading day) means config, not an outage; `failed` means read the run; no heartbeat at all means the scheduler never registered it (boot log `[startup] wisdom jobs:`). |
| `wisdom_capture_p1:<dataset>` | A dataset had zero/missing rows on a trading day. Compare its row count with `trailing_median` on **Capture health**; a source that changed shape or a vendor outage is the usual cause. Data that was not captured is gone — the archive exists because these sources overwrite or purge (D12). Record the gap in the ledger. |

**Kill a job without a deploy:** unset or set `0` on its switch (or the master switch for all of
them). The next tick sees it. A running step finishes; the next one checks again.

---

## 3. Flags

All declared in `api/services/wisdom/core/flags.py` (`GATES`), all default OFF, all `dark` in
`docs/feature_flags.json`. Nothing outside `flags.py` reads a `WISDOM_*_ENABLED` variable.

| Env | Kind | Who flips | What it gates | Rollback |
|---|---|---|---|---|
| `WISDOM_INGEST_ENABLED` | internal (master) | integrator | every Wisdom job | unset → every job skips next tick |
| `WISDOM_CAPTURE_ENABLED` | internal | integrator | S-A capture jobs | unset |
| `WISDOM_X_BACKFILL_ENABLED` | internal (paid) | integrator, with the cost line in LEDGER | S-A paid X backfill | unset; spend stops at the next page |
| `WISDOM_VOCAB_AUTOPROMOTE_ENABLED` | internal | integrator | S-B candidate auto-promotion (≥ 3 team uses) | unset; promoted rows stay and are vetoable in the queue |
| `WISDOM_DISCORD_LISTENER_ENABLED` | internal | integrator | S-C listener + backfill | unset |
| `WISDOM_SOURCES_INGEST_ENABLED` | internal | integrator | S-C transcripts / Sunday Scans ingest | unset |
| `WISDOM_EXTRACT_ENABLED` | internal (paid) | integrator | S-D batch submit/reap | unset; in-flight batches stay in `wisdom_batches` and resume when re-armed |
| `WISDOM_VISION_ENABLED` | internal (paid, D13 cost gate) | integrator after the 50-image gate | S-D chart images | unset |
| `WISDOM_EXTRACT_AUDIT_ENABLED` | internal (paid) | integrator | S-D weekly 50-segment audit | unset |
| `WISDOM_OUTCOMES_ENABLED` | internal | integrator | S-E outcomes | unset |
| `WISDOM_CONTEXT_SNAPSHOT_ENABLED` | internal | integrator | S-E context snapshots | unset |
| `WISDOM_REPLAY_ENABLED` | internal | integrator | S-E CALL-REPLAY | unset |
| `WISDOM_METRICS_ENABLED` | internal | integrator | S-E metrics + grounding eval | unset |
| `WISDOM_RETRIEVAL_INDEX_ENABLED` | internal | integrator | S-F FTS refresh | unset |
| `WISDOM_WEEKLY_REPORT_ENABLED` | internal (admin Discord only) | integrator | delivery of the weekly report embed | unset; reports are still built and stored |
| `WISDOM_BRAINKB_PUBLISH_ENABLED` | **member-visible** | **owner** | Brain KB publish | unset; KB rows keep `active=0` semantics, never deleted |
| `ASKAI_WISDOM_RETRIEVAL_ENABLED` | **member-visible** (cohort `wisdom-askai`) | **owner** | Ask-AI Wisdom block | unset |
| `WISDOM_DESK_MARKERS_ENABLED` | **member-visible** | **owner** | desk ticker markers | unset |
| `WISDOM_BADGES_ENABLED` | **member-visible** | **owner** | "UCT said" badges | unset |
| `WISDOM_PV_EXAMPLES_ENABLED` | **member-visible** | **owner** (Pattern Intelligence Lab is paused: drafts only) | Pattern Vision examples | unset |
| `WISDOM_MODELBOOK_DRAFTS_ENABLED` | **member-visible** | **owner** | Model Book drafts | unset |
| `WISDOM_VOICE_PROFILE_ENABLED` | **member-visible** | **owner** | weekly voice-profile refresh | unset; the chain step skips |
| `WISDOM_DOSSIER_ENABLED` | **member-visible** | **owner** | AI dossier lines | unset |
| `WISDOM_LEVEL_ALERTS_ENABLED` | **member-visible** (D20) | **owner**, and only after the D20 gate | level-reached alerts | unset; also hard-gated in code on replay n ≥ 100 AND ≥ 14 days silent scoring |
| `WISDOM_LOOKALIKE_ENABLED` | **member-visible** (D20) | **owner**, same D20 gate | "looks like" list | unset; same code gate |

Kill switches that default ON (no ledger row): `DESK_TRANSCRIPT_COVERAGE_GUARD_DISABLED`,
`DESK_VTT_ARCHIVE_DISABLED` (S-C, read in `desk_session_insights.py`) — see §7.

Non-gate knobs: `WISDOM_DB_PATH` (default `/data/wisdom.db`), `WISDOM_PRIVATE_DB_PATH`,
`WISDOM_PRIVATE_KEY`, `WISDOM_EXTRACT_MODEL` (`claude-opus-5`), `WISDOM_EXTRACT_EFFORT` (`high`),
`WISDOM_EXTRACT_BUDGET_USD` (`120`), `WISDOM_EXTRACT_LLM_TIMEOUT_SECS`,
`WISDOM_BADGES_LOOKBACK_DAYS` (`10`).

**Flipping a flag (procedure):**
1. `railway variables --service web --set "WISDOM_X_ENABLED=1"` from the linked directory.
2. Watch for a NEW boot (a startup line stamped after the set); only if none in ~3 min,
   `railway redeploy --service web --yes`. A flip is a restart either way — one master merge or
   restart at a time, `web` SUCCESS before the next.
3. Confirm in the running process (`os.environ.get` over `railway ssh`), not from `--kv`.
4. In the SAME docs push: set the flag's `docs/feature_flags.json` entry to `armed`, name the
   service in `where`, and put the flip timestamp in the note.

⛔ Member-visible flags are the owner's. An integrator never flips one.

---

## 4. R2 prefixes

Every Wisdom object lives under `wisdom/` and is written through `core/r2.put_immutable`: an
existing key with the same bytes is a no-op, different bytes raise `R2ImmutableConflict`, and
**there is no delete function**. No existing pruner reaches `wisdom/`.

| Prefix | Written by | Content |
|---|---|---|
| `wisdom/context/<as_of YYYY-MM-DD>/<family>.json.gz` | S-A capture | the daily archive of every family that would otherwise be overwritten or purged (D12) |
| `wisdom/sources/<stream>/<source_id>/v<n>.txt.gz` | S-C sources | raw source text per version (`wisdom_sources.raw_r2_key`) |
| `wisdom/sources/zoom_vtt/<sha24(meeting_uuid)>/<recording_file_id>.vtt` | S-C, inside `desk_session_insights.py` | the raw Zoom VTT, archived BEFORE any cloud trash (§7) |
| chart images (`wisdom_chart_images.r2_key`) | S-D vision (D13) | confirm the key layout against S-D's writer after its merge; it must start with `wisdom/` |

Monitoring size: `list_prefix("wisdom/...")` from a PC-side script; the W1 report asks for R2 size
and projected monthly cost after 7 days of capture.

---

## 5. Recovery

### 5.1 Re-run a slot

- **A failed slot inside its grace window:** do nothing — catch-up re-runs it every 30 min
  (for a chain, only the steps not yet `ok` for that slot).
- **On demand:** `POST /api/admin/wisdom/core/jobs/<job_id>/run?dry_run=false&force=true`
  (admin). `force` bypasses the switches and the trading-day check but **not** the claim: a slot
  whose claim is `ok` is skipped as "already done".
- **A slot that succeeded and must run again** (e.g. a package shipped a fix for bad output):
  first inspect with `?dry_run=true` (no claim, no heartbeat, steps recorded with `dry_run=1`).
  Then set that claim's `status` to `failed` — a single `UPDATE wisdom_job_claims SET status =
  'failed' WHERE job_id = ? AND due_key = ?` over `railway ssh`, recorded in the ledger — and run
  on demand. For a chain, also mark the step rows you want repeated: `UPDATE wisdom_chain_steps
  SET status = 'failed' WHERE chain = ? AND due_key = ? AND step IN (...)`. ⛔ Never DELETE a
  claim, run or step row; they are the audit trail.

### 5.2 Resume an extraction batch (S-D)

Batches are `wisdom_batches` rows with `status` and `checkpoint_json`; `wisdom_extract_reap`
(minute 16, 46) collects results and persists state every tick. Requests are keyed by
`custom_id = "wx_" + sha256(source_id|source_version|segment_ids|extractor_version)[:40]`, so
re-submitting is idempotent. To resume after a stop: re-arm `WISDOM_EXTRACT_ENABLED`; the next reap
tick continues from the checkpoint. A budget stop (`estimate(pending + next) + actual >
WISDOM_EXTRACT_BUDGET_USD`) is resumed only by raising the knob deliberately, with the reason in
the ledger. Confirm command names against `extract/batch.py` after S-D's merge.

### 5.3 Rebuild the retrieval index (S-F2)

The index is FTS5 `wisdom_segments_fts` inside wisdom.db (no embeddings; paid transcripts do not
go to a third-party embedding API). `publish.retrieval.refresh(ctx)` runs in the daily chain while
`WISDOM_RETRIEVAL_INDEX_ENABLED` is on. A full rebuild is a PC-side or on-demand run of the
retrieval module's rebuild entry point (confirm its name after S-F2's merge); the index is derived
data and can always be rebuilt from `wisdom_segments`.

### 5.4 Re-ingest a source version (S-C → S-D)

Sources are immutable and versioned: `UNIQUE(stream, external_ref, raw_sha256)`. A changed raw
text becomes version n+1 with `supersedes_source_id`; extraction is keyed by
`(source_id, source_version, extractor_version)`, so the new version is extracted on the next
`extract.run_daily`, and records of the old version are marked `superseded`, never deleted. To
force one source: run the sources package's single-source ingest for that `external_ref` (S-C),
then let the daily chain (or an on-demand `wisdom_daily_chain` dry run first) pick it up.

### 5.5 A wisdom.db migration failed

`store.init_db()` logs `[wisdom] migration <name> FAILED; not recorded, will retry next boot` and
continues with the others. Read the boot log for the name; migrations are additive only in Wave 1,
so the fix is a new migration, never an edit to an applied one or to `wisdom-db-v0.sql`.

---

## 6. The owner's veto workflow (W1 §0.3)

Owner judgment is a **veto, not a gate**: provisional records keep flowing, and the questions that
need the owner land in the review queue.

1. `/admin` → *Admin Tools* → **Open Wisdom Admin** (`/admin/wisdom`) → **Queue**.
2. Tabs come from the server: `golden`, `vocabulary`, `contradictions`, `attribution`,
   `extraction_audit`, `drafts`, `sources`, `capture`, `authors`, each with its open count.
3. Pick an item: **Old**, **New**, **Evidence** and the **Recommended** ruling.
4. Write a note (optional; **required** to *Resolve* a contradiction — it is the ruling), then
   **Accept** (the proposal stands), **Veto** (it does not), or **Resolve** (handled another way).
5. Every ruling is an append-only `wisdom_review_actions` row with the actor and the note.

Rules the code enforces:

- **Owner only.** `POST /api/admin/wisdom/publish/queue/{item_id}/action` is `require_owner` — the
  first address in `ADMIN_EMAILS`. Any other admin (team, smoke account, contractor) gets 403 and
  the page says *"Only the owner can rule on queue items."* Reading the queue is admin-wide.
- **Decided once.** A second ruling on the same item answers 409; a double click writes one row.
- **Never re-asked.** An item's id is its tab + subject + proposed value, so a job re-enqueueing a
  vetoed proposal gets the decided item back. A different proposal is a new item — that is also how
  a mistaken ruling is corrected (there is no reopen in Wave 1; never edit the actions table).
- **Golden-set growth.** Accepting or vetoing a `golden`, `extraction_audit` or `attribution` item
  records a `wisdom_golden_candidates` row with the label that stands (a veto of a proposal with no
  prior label records `{"no_record": true}`), `verified_by = owner`. The golden harness (S-D) adopts
  candidates into `wisdom_golden` under its own gate; `GET /api/internal/wisdom/publish/golden-candidates`
  (`PUSH_SECRET`) serves them to the PC-side harness.
- **Contradictions** are never resolved by the extractor (W1 §3.4). The weekly chain queues every
  principle/record pair linked `contradicts`, sources side by side with a recommended ruling; until
  ruled, Ask-AI presents both with dates.
- **Bulk import** of a prepared queue file: `python tools/wisdom/publish_queue_import.py --db <path>
  [--file data/wisdom/golden/review-queue-v1.jsonl] [--dry-run]` — explicit `--db`, bad lines
  reported by number only.

---

## 7. The Zoom deletion guard (S-C, `api/services/desk_session_insights.py`)

- **No Zoom cloud recording is trashed until its stored transcript covers ≥ 98 % of the video's
  duration** (W1 §2.2; `incomplete = 1` below 0.98). The guard is ON by default; the kill switch
  `DESK_TRANSCRIPT_COVERAGE_GUARD_DISABLED=1` turns it off and must never be set casually — a
  recording trashed with a truncated transcript is unrecoverable once Zoom's trash empties.
- **The raw VTT is archived to R2 before any trash** (`wisdom/sources/zoom_vtt/...`); kill switch
  `DESK_VTT_ARCHIVE_DISABLED=1`.
- **If a recording is already truncated:** recover it from the Zoom portal trash, re-run the
  transcript via `tools/wisdom/sources_zoom_transcript_repair.py` (PC-side, dry-run by default; it
  posts the transcript ONLY to `POST /api/education/videos/{id}/insights-store`), and verify
  coverage through the cue endpoint before the guard releases the cloud copy.
- Never touch `zoom_cleaned` from Wisdom code (CONTRACTS §0 ruling 25).

---

## 8. Cost controls

| Control | Where | Behaviour |
|---|---|---|
| Extraction budget cap | `WISDOM_EXTRACT_BUDGET_USD` (default `120` = $80 × 1.5), S-D `extract/budget.py` | hard stop when `estimate(pending + next) + actual_to_date > cap`; estimates from `messages.count_tokens`, actuals from usage × 0.5 batch discount including cache reads/writes |
| Spend ledger | `wisdom_batches` (`cost_usd_estimate`, `cost_usd_actual`, `budget_cap_usd`) | the one ledger for Wisdom LLM spend (NOT `llm_batch.py`, NOT `narrative_cost_guard`) |
| Weekly visibility | WEEKLY WISDOM REPORT → *Cost actuals*; `/admin/wisdom` → **Budget & flags** | this week and to date, batches, pending estimates, cap and its source |
| Paid switches | `WISDOM_EXTRACT_ENABLED`, `WISDOM_VISION_ENABLED` (after the 50-image gate), `WISDOM_EXTRACT_AUDIT_ENABLED`, `WISDOM_X_BACKFILL_ENABLED` | unset = spend stops at the next tick |
| Owner line | W1 estimates: $30–80 once for the back catalog, < $15/month ongoing; $100/month surface-before-building | any estimate above the line goes to the owner before the flag is armed |

R2 storage and TwitterAPI.io spend are **not** recorded in wisdom.db; the weekly report says so
rather than printing zero.

---

## 9. The weekly report

- Built every Sunday 19:52 ET by the weekly chain (`publish.report.run_weekly`) and stored in
  `wisdom_reports` (`kind = weekly`, `variant = final`); a dry run stores `variant = preview`.
- Sections: calls, principles, contradictions (side by side, recommended ruling), capture health,
  metrics with n (0/0 prints 0/0), extractor, review queue by tab, cost actuals, **D16b: deferred**,
  scheduled gates, jobs.
- Delivered to the admin Discord webhook (`discord_notify._send_webhook`) **only** when
  `WISDOM_WEEKLY_REPORT_ENABLED` is on and the run is not a dry run, **once per week**. The embed
  carries counts and ratios only, never source text.
- Preview on demand: `/admin/wisdom` → **Reports** → *Generate preview* (a daemon thread), or
  PC-side `python tools/wisdom/publish_report_preview.py --db <copy of wisdom.db> --out <file.md>`.
- First scheduled report: Sunday 2026-09-20 after Sunday Scans publishes (W1 §9.1).
- The monthly recognition packet (first Sunday 20:22 ET) is stored dark and never delivered; every
  proposal waits for the owner's gate line.

⛔ **D16b is deferred.** No Wisdom job, report or route reads, matches, reconciles or searches
Journal, J2, Notebook or broker-fill data (W1 Part 10).
