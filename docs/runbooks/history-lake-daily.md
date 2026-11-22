# History lake: the daily refresh

**Why.** The lake (`/api/hist`, R2 `uct-bars-snapshots/hist/`) was published once on 2026-11-16 with data
through Fri 11-13, and nothing extended it. A chart joins lake history to its server bars; on 11-17 the
1m server bars of AAPL / NVDA started Mon ~12:30 ET, so Monday's premarket and morning were in neither.
The BarStore now refuses to join across such a hole (#1735), but deep history then comes from the slower
server window. The lake has to end where the vendor's last published day ends.

**What runs.** `tools/history_lake/daily.py` (docstring has every step), started by the Task Scheduler
entry **UCT History Lake Daily** through `D:\uct-history\tools\run_daily.cmd` (a copy of
`tools/history_lake/run_daily.cmd`), which exports `tools/history_lake` from `origin/master` first.
Several runs a day are harmless: with no new vendor day it only writes its status.

One run: download new vendor day files -> fold into `packs-7` (build.py --packs, below-normal priority,
shared heavy lock) the days after the tree's newest day, any HOLE (a listed day never folded, e.g. a
failed download) and any of the newest 10 held days whose file the vendor REWROTE (its size differs from
the one folded) -> refresh the split reference -> publish every tree's indexes and upload, packs rebuilt by
this run always sent (`--force-since`) -> read SPY's live index back from the bucket and require it to
reach the newest day -> only then write `D:\uct-history\daily-state.json` (`published_through`).
A run whose publish failed leaves `published_through` behind the build ledger, so the next run publishes
again even with nothing new to fold.

**Schedule.** Massive's day files usually appear ~00:00-01:10 ET, but are documented complete only by
~11:00 ET the next day, and a file can be rewritten later. Runs at **00:30, 06:30, 10:30 and 15:30 CT**:
the night run makes the lake current before premarket, the 10:30 run refolds a day the vendor completed
or rewrote after the early copy.

**Read it.** `D:\uct-history\daily-status.json` (`ok`, `step`, `days`, `reason`, `exit`) and
`D:\uct-history\daily.log`. Exit 0 = published or current; 1 = a step failed; 3 = the lake is more than
one trading day behind and nothing new could be folded (the vendor has not published, or the download failed).

**Recover.** Each run backs up the packs it rewrites to `D:\uct-history\backup-<stamp>\` (kept 7 days)
with the tree's `ledger.json`. To undo a bad day: copy the backup's packs and ledger back into
`D:\uct-history\packs-7\`, then rerun the publish step (or the whole job). An interrupted upload is
resumed by rerunning: packs already in the bucket at their size are skipped, except this run's rebuilt ones.

**When the year changes.** Days keep folding into `packs-7` (a tree is only a directory). January
downloads cover the previous year too.
