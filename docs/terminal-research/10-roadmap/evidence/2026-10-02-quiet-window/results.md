# Quiet window 2026-10-02: results (TERM-007 / 014 / 017)

Raw rows: `raw.jsonl` (16:00Z-17:59Z) and `part2/raw.jsonl` (18:00Z-18:30Z), committed before this summary
(`4a6efeba87`). Owner-authorised ("do it now"); the Pine and Notebook sessions held master pushes.

## The clean segment

- One web pod booted 16:41Z (11:41 CT). The segment runs to 18:30Z at **uptime 109.5 min**, with no uptime
  decrease, over 110 one-minute samples. That meets the >=104 min requirement.
- Earlier cuts in the raw file (uptime going down) are recorded deploys, not part of the segment:
  the Pine `cf5e38d5d2` deploy, the owner's flag `--set` (deploy `94d46235`, 16:08Z), and the Notebook
  #266/#265 merges (~16:41Z).
- ⚠️ The open (13:30Z) is NOT in the segment: the window began after the open. Heavy-job coverage comes from
  the jobs that ran inside it (ledger below), not from a declared heavy-job slot.

## TERM-017: event-loop lag

- Final per-check histogram, 1,306 checks: **p50 <= 1 ms, p90 <= 10 ms, p99 <= 25 ms**.
- Median of the last-lag samples: 0.2 ms.
- **One stall of 7,744.8 ms**, first visible in the sample at 12:21 CT (17:21Z). This sampler records the
  running max, not the call stack. `/api/watchdog/stacks` (admin) is the instrument that names it, and it was
  not read during the window.

## TERM-014: RSS

- 874 MB at boot, rising to ~1.9 GB by 12:01 CT. Then **+7.4 GB in about 2 minutes (12:02-12:04 CT), reaching
  9.3-9.5 GB**, held about 31 minutes, and **released at once at 12:35 CT** (to 1.54 GB). End of segment:
  1,525 MB.
- The split is `RssAnon` (anonymous heap), not `RssFile` page cache: first sample 763 / 111 MB, last
  1,467 / 57 MB. The page-cache theory from 09-29 does not explain this spike.
- **No scheduled job explains it.** In the per-job RSS ledger the largest single delta is
  `company_news_fmp` max 125.4 MB (total 139.3 MB over 3 calls). Every other job is smaller.
- A linear slope over the segment is meaningless here (the spike dominates it). Report it as an episode, not
  a rate.

## Lead (NOT a finding)

Anonymous memory that jumps about 7.4 GB in 2 minutes, outside any scheduled job, holds for about 30
minutes and is then released all at once is the signature of a **request-triggered build into an in-memory
cache with a ~30-minute TTL**. Next step: list the web caches with TTL 1500-2100 s and the requests served
16:59-17:05Z (Railway HTTP logs), and read `/api/watchdog/stacks` the next time max_lag jumps.
Unmeasured: which request, and which cache.
