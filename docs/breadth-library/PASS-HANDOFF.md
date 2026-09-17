# COMBINED HISTORICAL PASS — durable handoff

⚠️ **This job runs ~40 hours and will outlive any one session. Recovery must be boring.**

## Identity

| | |
|---|---|
| artifact | `/data/_audit/breadth_replacement_v1.db` **on the worker pod** |
| log | `/data/_audit/pass.log` |
| methodology | `rth-1m-composites-v1` (also stamped in `pass_meta`) |
| code | landed on master; `pass_meta.commit` carries the exact HEAD |
| launched | 2026-09-16 ~04:55 UTC, PID 4051, detached via `nohup` |
| legs | **1:** `uct+us` 2008-01-02→2010-12-31 · **2:** all four 2011-01-03→2026-09-11 |

⛔ NASDAQ/NYSE start at **2011** deliberately: before that the provider returns no
`primary_exchange` for names that were unambiguously Nasdaq-listed, so an earlier venue
universe would be fiction.

## How to check on it

```bash
railway ssh --service worker "tail -5 /data/_audit/pass.log"
railway ssh --service worker "sqlite3 /data/_audit/breadth_replacement_v1.db \
  'SELECT status, COUNT(*) FROM pass_checkpoint GROUP BY status'"
```

## How to resume it

⭐ **Just run it again.** Completed sessions are skipped via `pass_checkpoint`
(`done` and `missing_source` both count as complete; `failed` stays retryable), and
re-running a committed session is idempotent on `(universe, date, metric)`. Proven:
`skipped_existing: 4`, **0 duplicates**.

The exact command is the same one that launched it — `breadth_combined_pass.run()` with
the same artifact path and the same two legs.

⚠️ **A worker redeploy kills the process.** Nothing restarts it automatically. The
artifact and checkpoint survive on the volume, so resuming loses at most one session.

## Expected

~4,679 sessions · **~32.8 s/session → ~42 h** · peak RSS **2.67 GB** against a **32 GB**
pod limit · ~84 GB streamed (never retained) · artifact ~85 MB.

## ⛔ What must NOT happen

Production cutover is **not authorised**. The artifact is isolated by construction —
`open_artifact` refuses both an absent path and the production store — and production's
fingerprint was `6fbdd16e160808d6` / 353,962 rows before the mini passes and identical
after.
