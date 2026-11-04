# Trade Exchange News — permanent retention, backups, integrity, recovery

Owner decision 2026-10-31 (Trade Exchange authorized indefinite storage): **every Trade
Exchange headline and every original delivery record is kept forever.** Nothing deletes
by age, by count, or by whether anyone bookmarked it.

## 1. Where the records live

| Copy | What | Kept | Protects against |
|---|---|---|---|
| **R2 journal** `uct-trade-exchange-news` / `trade-exchange-news/v1/events/<event_id>.json` | one object per DELIVERY, exactly as received — repeats and graphic-only posts included | **forever** (no lifecycle rule on `events/`; never add one) | loss of the web volume or the database |
| **SQLite** `/data/trade_exchange_news.db` (web volume) | `headlines` (what members browse, `seq` order) + `deliveries` (one row per delivery, with the exact original bytes in `record_json`) | **forever** (no prune exists in the code) | — it is the queryable copy |
| **Nightly snapshot** `store_backups/trade_exchange_news/<stamp>.db.gz.enc` (the `DATA_SYNC_BUCKET`) | a consistent, integrity-checked, encrypted copy of the SQLite file + a manifest of per-table row counts | newest 14 nights (`STORE_BACKUP_KEEP`) | a corrupt or lost database: restore in minutes instead of a full rebuild |

Snapshots rotate; **originals never do** — any snapshot can be lost and the journal still
holds every delivery. Only in-memory caches are bounded (`archive.py`: newest 5,000 rows,
64 days / 60,000 rows of day pages, 20,000 derivations); evicting them never touches a row.

## 2. What runs automatically

| When | What | Alerts (ops Discord) |
|---|---|---|
| every ingest | store → publish (unchanged); the R2 PUT is the receiver's, confirmed by web's repair pass | — |
| every 30 s | recovery scan (journal → SQLite) + repair pass (SQLite → journal) | recovery failing 10+ min; deliveries unconfirmed in R2 10+ min; resolved notices |
| 03:05 ET nightly | `store_backup` snapshot of `trade_exchange_news` (online backup API; `integrity_check` before upload; fail-closed encryption) | via the integrity check below (stale/missing snapshot) |
| 15 min after every web boot, then 04:30 ET daily | `integrity.py` — ledger accounting, R2-vs-ledger merge, `quick_check`, newest snapshot age | **any problem** |

The integrity check's unit is the **delivery**: a repeat collapsed onto an earlier
headline is still a delivery in R2 and in `deliveries`, so it is never reported missing.
It repairs only by **adding**: R2 deliveries missing from SQLite are re-ingested through
the normal recovery path; SQLite deliveries missing from R2 are re-armed so the repair
pass PUTs their exact original bytes back.

Check it: `GET /api/admin/trade-exchange-news` → `integrity` (last report),
`ops_alerts` (active conditions, recent alerts), `retention.retired_env_set`.
Run it now: `POST /api/admin/trade-exchange-news/integrity` (admin).

## 3. Recovery procedures

⛔ Every procedure below writes a NEW file first and swaps it in only with web stopped.
Nothing deletes the old database: it is moved aside to `*.pre-restore-<stamp>`.

### A. Database corrupt or lost, a recent snapshot exists (minutes)
1. Rehearse (owner machine, private key): `python tools/store_restore.py --rehearse --store trade_exchange_news`
   → must print PASS (integrity_check, schema digest, every table count = manifest).
2. Restore to a LOCAL file (the private key never leaves the owner's machine,
   `docs/runbooks/backup-encryption.md`):
   `python tools/store_restore.py --restore <KEY> --to D:estore	rade_exchange_news.db --private-key ...`
   (it rehearses the object again first and refuses unless that passes).
3. Stop the web service (Railway dashboard), put the restored file on the volume as
   `/data/trade_exchange_news.db` after moving the old file and its `-wal`/`-shm` aside.
4. Start web. Recovery resumes from the snapshot's newest delivery (minus 10 min) and
   re-ingests everything the journal holds after it; the integrity check 15 min later
   confirms the ledger equals the journal (and re-ingests anything older it finds).

### B. No usable snapshot, or the volume is new and empty (full rebuild from R2)
1. Anywhere with the repo and web's R2 credentials (`TXN_JOURNAL_*`):
   `python tools/txn_rebuild_from_r2.py --to /tmp/txn-rebuilt.db`
   — lists every delivery, replays them in event-id order through the same ingest web uses,
   then verifies (every journal object is a delivery, accounting is exact, integrity_check ok).
   Exit 0 = PASS. It refuses to overwrite a file and refuses the live data directory.
2. Stop web; move the rebuilt file to `/data/trade_exchange_news.db` (move any old file aside); start web.
3. Browsers see a new epoch and reload once (by design). Bookmarks / links must use
   `event_id` (stable across rebuilds), never `seq`.

### C. Web boots on an empty volume and nobody acts
Recovery fills the last `TXN_BOOT_RECOVERY_WINDOW_HOURS` (192) at once, so live News works;
15 minutes later the integrity check finds every older delivery missing, **alerts**, and
re-ingests up to 5,000 per run (daily). For a large archive run B instead of waiting.

## 4. Protecting the archive

* No code path deletes: `tests/test_trade_exchange_news_retention.py` fails on any
  `DELETE FROM headlines|deliveries`, `DROP`, `TRUNCATE`, or `delete_object` in News code.
* `tools/txn_preflight.py` fails if any enabled lifecycle rule would expire the events prefix.
* Recommended (owner, Cloudflare dashboard — not done by code): an **R2 bucket lock rule**
  on prefix `trade-exchange-news/v1/events/` with indefinite retention, so even a leaked
  credential or an operator mistake cannot delete or overwrite an original.
* The R2 tokens are scoped to this one bucket. Web's token must keep write access (the repair pass).

## 5. Retired settings

`TXN_HISTORY_MAX_AGE_HOURS`, `TXN_HISTORY_MAX_ITEMS`, `TXN_JOURNAL_RETENTION_HOURS` are read
by nothing since permanent retention shipped. The admin status names any still set; remove
them from the web service at a convenient deploy.

## 6. Future improvement — automated, resumable full-history recovery (not built yet)

Today an EMPTY database gets the last 8 days at boot, then the integrity check restores
older history at most 5,000 deliveries per run (once ~15 min after boot, then daily), or an
operator runs procedure A/B. Proposed design so no case needs many days or a person:

1. **A background backfill task**, started when the integrity check (or boot) finds the
   ledger far behind the journal. It walks the journal OLDEST→NEWEST in pages of ~1,000 ids
   and ingests missing deliveries through the normal pipeline at a throttled rate (e.g.
   200/s, yielding to live ingest — the single writer keeps live headlines first).
2. **Resumable cursor** in `state.backfill_cursor` (the last event id fully processed),
   written after each page. A restart resumes from it; ids already in the ledger are skipped
   by the existing idempotency check, so a repeated page is harmless.
3. **Snapshot first when available**: if a nightly snapshot exists, restore it automatically
   into a side file, verify it (integrity_check + manifest), and swap it in at boot before
   the pipeline opens — then the backfill only covers the snapshot→now tail. (Needs the
   decryption key on the server, which today is deliberately owner-only; until that policy
   changes, backfill from the journal is the automatic path.)
4. **Progress and alerts**: admin status shows `{cursor, done, remaining, rate, eta}`; an
   OPS alert on start, on stall (no progress 15 min), and on completion.
5. **Order honesty**: backfilled rows keep receipt time; ingest time set to receipt time (as
   the rebuild tool does) so history is not flagged "delayed"; browsers see no epoch change.

Estimated cost: one LIST per 1,000 deliveries + one GET each; ~350k objects (1 year) ≈ 30 min
at 200/s.
