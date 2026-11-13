# flow-worker: deploys are MANUAL, and how to recover flow.db

**Read this before you change ANY file the flow-worker runs** (the options tape, Live Flow,
Options Flow, gap-fill, OI snapshots: `api/massive_*`, `api/flow_*`, `api/live_massive_router.py`,
`api/weekly_flow.py`, `api/confluence_flow.py`, `api/oi_snapshots.py`, `api/dealer_positioning.py`,
`api/alpha_gold_eod.py`, `railway.json`, `requirements.txt`, ...; the full list is the service's
Watch Paths in Railway).

## ⛔⛔ The rule (owner decision 2026-11-12)

**flow-worker AUTO DEPLOY IS DISABLED in Railway** (flow-worker → Settings → Source → "Auto deploy
is disabled"). A push or a merged PR no longer restarts it. Your change goes live only when
someone deploys it by hand, and that is done **outside market hours only**.

Why: on 2026-11-11/12 `flow.db` (11 GB, the live options tape) corrupted five times. Three of the
five followed a flow-worker deploy: during the swap Railway pulled the volume from the
**still-running** old container (every disk call returned `disk I/O error` for 11 s to 11 min,
with no shutdown first), and a half-finished write damaged the newest pages. The worst one was
triggered by an unrelated security PR (#1139) that happened to touch a flow-worker file at
11:29 ET: live writes failed from 11:52 to 13:28 ET. Before this change, flow-worker deployed at
PUSH time, without waiting for the master deploy gate, so any session could restart it mid-session.

## How to deploy flow-worker (by hand)

1. **When:** after 16:15 ET and before 07:45 ET on a trading day, or any time on a weekend.
   Also avoid the gap-fill minutes (16:35, 16:45, 21:00, 08:00, 08:15 ET) and the nightly
   integrity check (03:30 ET).
2. **How:** Railway dashboard → project `luminous-recreation` → `flow-worker` →
   Command palette (Ctrl/Cmd+K) → **"Deploy latest commit"**. (`railway redeploy --service
   flow-worker` re-runs the CURRENT image; it does not pick up new code.)
3. **Verify** within 5 minutes:
   - logs show `[massive-ws] write-profile:` lines and no `DB write failed`;
   - no `disk I/O error` lines after the swap;
   - the canary logs `[flow-canary] ok max_id=...` with max_id rising.
4. If anything looks wrong, read the recovery section below before doing anything else.

Do NOT re-enable auto deploy. If you believe it must change, that is the owner's call.

## Signals that flow.db is damaged

- `[massive-ws] DB write failed: database disk image is malformed` (live tape not saved)
- `[flow-canary] ⛔ flow.db READ FAILED ... THIS IS THE ONSET`
- `[flow-canary] ⛔ NO NEW flow rows for N checks during market hours` (write stall)
- `[flow-canary] ⛔ flow-worker volume LOW` (free space under 15 GB)
- the Open Flow board stuck on "computing", Live Flow not advancing

## ⭐ Self-repair (since 2026-11-13): the worker restores the newest backup on its own

`api/flow_db_autorestore.py`. On 2026-11-13 page 1 of flow.db was overwritten at 07:35 ET (no deploy,
no second writer; 7th damage in 5 days). The canary only logged it, and the tape stayed dead until a
person restored the 01:44 UTC backup at 09:30:40 ET. Now:

* **The canary posts the onset to Discord** (it used to only log it).
* **Two fatal canary failures in a row** (unreadable file, malformed image, I/O error; ~10 min at
  `FLOW_CANARY_SEC=300`) **and** a fresh direct check that also fails → the newest `flow-pre-*.db`
  backup that reads cleanly is COPIED in (the backup stays), the damaged file is moved to
  `flow.db.corrupt-auto-<UTC stamp>` (KEPT), and the copy is swapped in. Writes resume without a
  restart. Discord gets what it did and which days to re-fill.
* Guards: once per 6 h (`/data/.flow_autorestore_last`), refuses without disk room for the copy,
  never deletes anything. Kill switch `FLOW_AUTO_RESTORE_ENABLED=0`.
* **A verified backup every weeknight at 22:15 ET** (`flow-pre-nightly-YYYY-MM-DD.db`): written to a
  temp name, `quick_check` on the COPY, then it replaces the old one (one backup kept). Refuses when
  the live file does not read cleanly. Off switch `FLOW_NIGHTLY_BACKUP_ENABLED=0`.
* The gap-fill's rollback snapshot now refuses to prune anything when the live file does not read
  cleanly, so a damaged file can never displace the only good backup.

**After a self-repair:** rows written after the backup are missing. Run the gap-fill for each day
since the backup was taken (status endpoint shows `last_result`), after the close.

## ⛔⛔ ROOT CAUSE (found 2026-11-13): two write-ahead logs. RESTART AFTER EVERY SWAP.

On 11/13 the worker's PID 1 held `/data/flow.db-wal (deleted)` while its other connections wrote
to a NEW `flow.db-wal`. Two logs for one database is the textbook SQLite corruption, and it
explains all 8 damages: each followed a moment when the file was swapped under a running process
(the "no restart needed" swaps below renamed the live -wal/-shm; long-lived connections kept
writing into the renamed log) or two containers held the volume during a deploy/restart (the old
process, believing it held the LAST connection, checkpointed and deleted the WAL the new one was
using). The damage surfaced hours later, which is why some looked deploy-free.

Fixed in code (`api/flow_db_guard.py`): an anchor connection held for the process life (SQLite
never deletes the WAL while any connection in the process is open), `os._exit` after shutdown
(a dying container never deletes the WAL), a tripwire in every canary tick (a handle to a deleted
flow.db/-wal/-shm → Discord + clean restart), and the self-repair restarts after its swap.
**Rule for people: after ANY manual swap of flow.db, restart flow-worker** (`railway restart
--service flow-worker --yes`), and never inspect flow.db with plain file I/O inside the worker.

## Recovery (the swap itself; then RESTART flow-worker, see above)

Scripts: `tools/flow_db_recovery/stepA_rebuild_and_swap.py`, `stepB_restore_history.py`.
Production writes need the owner's OK.

1. **Check, read-only:** `PRAGMA quick_check(40)` with `mode=ro` (about 18 s on 11 GB; a larger
   number can RAISE instead of listing). Map each `Tree N` to `sqlite_master.rootpage`.
2. **Step A** (rebuild and swap): run it with `MODE = "dry"` first, read the plan, then
   `"swap"`. Set `TAG` to a new damaged-copy name. If `max(id)` is unreadable, set `FLOOR` above
   the last `max_id` the canary logged: new rows must never reuse an old id, because Step B puts
   history back under the ORIGINAL ids.
3. **Step B** (restore history): set `SRC` to the damaged copy. Run it DETACHED on the pod
   (`setsid -f nohup ...`; plain `nohup` dies with the ssh session). It copies newest-first,
   skips unreadable id spans (logged), and pauses itself under 10 GB free. Watch the disk:
   the WAL grew 6.9 GB in 7 minutes during a copy before `journal_size_limit` was set.
4. **Gaps** in the tape (minutes when writes failed) heal from Massive's flat files through the
   gap-fill jobs (16:35 / 16:45 / 21:00 ET and 08:00 / 08:15 ET next day). They need room for a
   rollback snapshot (database size + 10 GB free) or they refuse, by design.

How to send a script to the pod (Git Bash):

```sh
MSYS_NO_PATHCONV=1 railway ssh --service flow-worker echo "$(base64 -w0 path/to/script.py)" "|" base64 -d "|" timeout 450 /opt/venv/bin/python
```

## Disk

The flow-worker volume was resized 100 → 150 GB on 2026-11-12 (live, no restart). The owner
asked to KEEP the damaged copies (`/data/flow.db.damaged-*`, `corrupt*`, `/data/kept-by-owner/`):
do not delete them without asking. Gap-fill snapshots: keep 1, pruned before a new one, never
written without the free-space floor (`api/flow_gap_autofill.py`, 2026-11-12).

Incident record: owner memory `incident_flow_db_disk_full_2026_11_12`.
