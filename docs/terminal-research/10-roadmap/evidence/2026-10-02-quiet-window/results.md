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

## Attribution

Lane `lane/term-014-rss-episode`. Read-only against production: Railway deploy + HTTP logs for deployment
`db45b154` (the pod in the segment), one `HEAD`/`LIST` of the R2 snapshot objects. Nothing was written to
production. `/api/health/memory` + `/api/watchdog/stacks` could not be re-read afterwards (a new deploy,
`b8eb51a0`, was mid-boot and the edge returned 502); the per-minute `/api/health/memory` rows in `raw.jsonl`
are the memory evidence used here.

**Culprit: `api/services/data_sync.merge_snapshot` read the whole R2 base tarball into RAM
(`resp["Body"].read()`).** It is not a cache, and the ~30 min hold is not a TTL.

### Measured

- Deploy log, `[startup]` at 16:40:54Z: `bars.db FAILED integrity smoke probe (10.01s) -- pulling fresh
  snapshot from R2`, so the boot thread started `download_snapshot`, which streams to disk. At 16:40:55Z:
  `S3 periodic puller started (20-min cadence; mode=newer-wins-merge)`. Its first tick was due at about
  17:00:55Z.
- The `[mem] rss_mb` log line: 1,413.0 (17:00:53) → 3,589.2 (17:01:50) → 6,203.9 (17:02:50) → 8,813.5
  (17:03:56) → 9,322.5 (17:04:59). That is a linear ~2.5 GB/min for ~3 min starting right after 17:00:55,
  with the thread count flat (81-82).
- R2 `snapshots/1790930920.tar.gz` (the snapshot being pulled) is **8,332,085,147 bytes = 7,946 MiB**.
  The sampler's RssAnon rose from 1,107.4 MiB (17:00) to 9,021.1 MiB (17:05), **+7,914 MiB, which is 99.6%
  of the object size.** Earlier bases: 7.45-7.70 GiB (09-28 to 10-01).
- Release: 17:25:27Z `downloaded snapshot 1790930920` (the boot thread's streamed install finished). Then
  **17:34:41Z `[data_sync] merge extract/apply failed for snapshots/1790930920.tar.gz: database disk image
  is malformed`**, raised from `_merge_ohlcv_from` (the local `bars.db` was the corrupt one). `[mem]` went
  9,400.2 (17:33:50) → 1,726.3 (17:34:50). The release falls in the same minute the merge returned and
  dropped its `data` reference.
- No step in the logs repeats it: from 17:25 the sync marker equals the remote ts, so later 20-min ticks skip.
- HTTP logs 16:58-17:06Z (727 requests): no member request is unusual. The traffic is the Discord
  hot-chart renderer (`/r/chart` ×20, 401s on bars), one member session (notebook, SSE prices), and the
  sampler. The largest response was 329 KB (a JS asset). **The episode was not request-triggered.**
- None of the 26 registered `TTLCache`s moved (`cache.cache` stayed at 991-1000 of 1000; the others were
  flat). `memory_probe` only discovers `TTLCache` instances, so a function-local `bytes` was invisible to it.

### Correction to the TERM-014 section above

The per-job ledger in the final row (18:30Z) does NOT top out at 125 MB. It shows `company_news_fmp` max
**1,704.1 MB** (first seen in the 17:03 row, call 5) and `discord_chart_hot_warm` max **641.1 MB** (first
seen 17:02-17:03). Both jobs ran inside the 17:01-17:04 ramp. The ledger records process-RSS deltas, so a
job absorbs any growth that happens concurrently (inference: ~2.5 GB/min × each job's runtime is consistent
with both numbers). The original conclusion still holds: no scheduled job explains the episode. But the
125 MB figure came from a row taken before the spike.

### Inferred (not measured)

- The ~31 min hold is how long the merge took with the tarball referenced: `tarfile` extraction of a
  7.76 GiB gzip from a `BytesIO`, `PRAGMA integrity_check` on the extracted DB, then the `ATTACH` merge.
  The hold matches that sequence. It is not a TTL.
- 2026-09-29's "VmRSS 9.2 GB with malloc_trim releasing only 108 MB" fits the same mechanism (the 09-29
  base was 7.58 GiB). That is unverified, because the logs were not re-read.
- The 7.7 s event-loop stall (~17:20-17:21Z) is **not attributed**. Logs at 17:20:26-17:20:56 show
  calendar rebuilds and `Calendar date-integrity failed: database is locked`, but nothing in them names a
  loop-blocking frame. The ~1.9 s latency on every request at 17:04:03Z is plausibly the final join/copy of
  the 7.76 GiB `read()`, but that is unproven.
- Separate risk, not fixed here: the web `bars.db` was malformed at boot, and `bars` CRASH tracebacks
  (`database disk image is malformed`) continued after 17:33Z. The boot pull and the periodic merge also
  pulled the same snapshot at the same time.

### Caches with TTL 1500-2100 s on the web path (AST scan of `api/**`, not memory)

Derived by a throwaway AST scan of `api/**` (not committed). It evaluated numeric constants, `a*b`,
`timedelta(...)`, and env-default literals in assignments, keywords, comparisons, and call arguments,
found 208 hits in [1500, 2100], and was then filtered to cache/TTL uses:

| Cache | Holds (per key) | Keys a burst can create | Worst-case resident |
|---|---|---|---|
| `services.cache.cache` (shared TTLCache, max 1000): `chart_news` 1800, `engine` earnings/candidates 1800, `research/snapshot` 1800, `theme_index` 1800, `schwab_router` narrative 1800 | news lists / wire-derived dicts / snapshot dicts, ~1 KB-1 MB | capped at 1000 (LRU) | ≤ ~1 GB in theory; measured flat at 991-1000 entries through the episode |
| `sec_filings` / `fundamentals` / `insider_clusters` / `voice_deep_research` TTLCaches (1800, max 1000 each) | per-ticker JSON, KB | ≤ 1000 each | tens of MB; `sec_filings` 150→446 entries during the episode |
| `routers/calendar` month (1800) + week cards (1800 future) | month bucket dict / card payload, ~100 KB-1 MB | one per (year, month) or week requested | single-digit MB |
| `confluence_screen._CACHES` (1800) | ranked board per lookback window | ≤ 4 (`_ALLOWED_DAYS`) | < 10 MB |
| `discord_chart_context._cache` (1800) | ≤ 180-char line per ticker | unbounded dict, one per ticker | ~200 B × tickers: KB |
| `journal_two/broker/partner_health._cache` (1800) | one health dict | 1 | KB |

None of these can hold 7.4 GB, and none changed size during the episode.

### Fix (this lane)

`merge_snapshot` and `apply_delta` now decompress and extract while the body downloads
(`_extract_tar_stream`, `tarfile` mode `r|gz`). The body is never asked for more than
`_STREAM_READ_BYTES` = 8 MiB per read. Extraction and the newer-wins merge are unchanged: members see the
same bars, and resident memory no longer scales with the snapshot. A `merge start <key> (<bytes>, streamed)`
log line now names the next pull when it begins.

Rails, in `tests/test_data_sync_bounded_reads.py`: the real merge doors run against a body that refuses
an unbounded read and logs every request size (with the bound shrunk to 512 B over a 64 KiB incompressible
fixture), and an AST rail allowlists every no-argument `*body*.read()` in `data_sync`. Mutation results
(each restored with the editor):

| Mutation | Result |
|---|---|
| M1: restore the whole-body read in `merge_snapshot` | merge rail + AST rail red |
| M2: drop the upper clamp in `_BoundedReader` | both merge rails red (10,240-byte requests) |
| M3: whole-body read in `apply_delta` | delta rail red; the AST rail was blind to `body.read()` and was strengthened, then red too |
