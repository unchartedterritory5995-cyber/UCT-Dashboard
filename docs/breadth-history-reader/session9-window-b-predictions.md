# D.0 — what the H1 fix will do, written BEFORE the flag is set

**Status: PREDICTION. Nothing here is an observation of Window B.** Committed before
`BREADTH_OHLC_PAGECACHE` is set on `web` (authorisation V1), so the predictions cannot
be reshaped to fit the result. D.1–D.4 record the outcome beside this file without
editing it.

Session 9, Workstream D. The arm under test is `mmap_size = 67108864` (64 MB) plus
`cache_size = -16000` (16 MB), against the shipped defaults `mmap_size = 0` and
`cache_size = -2000` (2 MB).

---

## 1. What Window A measured (flag OFF), and why it changes the diagnosis

**n = 13 settled cold samples**, `days≈7438–7450`, every one a forced cache miss, every
one `rf_pagecache = 0` (read off the request, and independently confirmed by
`railway variables --kv`: the variable is unset). Sorted by logical bytes read:

| i | total ms | `rf_stmt_sum` | `rf_stmt_max` | `rchar` MB | **amp** = rchar/returned | `read_bytes` MB | **block-dev %** | `syscr` |
|---|---|---|---|---|---|---|---|---|
| 4 | 300.8 | 8.9 | 1.0 | 6.80 | **1.5x** | 0.00 | 0.0% | 1,669 |
| 12 | 281.1 | 12.0 | 2.1 | 6.80 | 1.5x | 0.00 | 0.0% | 1,669 |
| 13 | 289.4 | 10.6 | 1.2 | 6.80 | 1.5x | 0.00 | 0.0% | 1,669 |
| 10 | 309.0 | 12.6 | 2.3 | 6.80 | 1.5x | 0.00 | 0.0% | 1,669 |
| 11 | 304.4 | 14.8 | 3.1 | 6.96 | 1.5x | 0.00 | 0.0% | 1,709 |
| 7 | 312.0 | 10.6 | 1.2 | 9.47 | 2.1x | 0.05 | 0.5% | 2,323 |
| 6 | 316.0 | 10.8 | 1.3 | 16.39 | 3.6x | 0.70 | 4.3% | 4,011 |
| 5 | 309.5 | 11.8 | 1.5 | 25.69 | 5.7x | 0.59 | 2.3% | 6,283 |
| 9 | 394.2 | 10.5 | 1.1 | 29.36 | 6.5x | 0.01 | 0.0% | 7,182 |
| 1 | 506.6 | 47.4 | 5.5 | 53.37 | 11.8x | 2.84 | 5.3% | 13,053 |
| 8 | 1,733.1 | 1,309.8 | 247.2 | 99.33 | 22.0x | 20.52 | 20.7% | 24,149 |
| 3 | 8,327.7 | 5,363.1 | 2,770.4 | 122.21 | 27.0x | 90.80 | **74.3%** | 10,552 |
| 2 | **11,382.4** | 8,854.9 | 1,792.8 | 233.60 | **51.6x** | 187.51 | **80.3%** | 16,469 |

`rf_rows = 4529` and `rf_bytes = 4,523,328` on **all thirteen** — identical work, a
40x spread in time.

### ⛔ WITHDRAWN BEFORE IT WAS EVER USED — and the withdrawal is the finding

**The first version of this section claimed D-048 was superseded.** On Window A alone,
`io_rchar` ranks time almost perfectly:

| predictor | Pearson | **Spearman** | Pearson minus the largest point |
|---|---|---|---|
| `io_rchar` | +0.936 | **+0.960** | +0.819 |
| `io_read_bytes` | +0.982 | +0.933 | +0.999 |
| `rf_stmt_sum` | +0.996 | +0.597 | +0.998 |

Spearman **0.960** against Session 8's 0.504 on the same counter looked like the missing
piece: "Session 8 measured the wrong counter, the ordinary range is explained after all."

⛔ **It does not replicate, and the reason kills the counter rather than the window.**
Dividing each sample's block-device bytes by its own `rf_fetch` gives the rate the
storage would have had to deliver:

| window | sample | `rf_fetch` ms | `read_bytes` MB | **implied MB/s** |
|---|---|---|---|---|
| S8 | 18 | 8.0 | 31.54 | **3,942** |
| S8 | 19 | 7.4 | 17.99 | **2,432** |
| S8 | 3 | 14.3 | 34.22 | **2,393** |
| S8 | 2 | 6.6 | 14.88 | **2,255** |

**No volume delivers 3.9 GB/s**, and this one demonstrably runs at a fiftieth of that.
Those bytes were never this request's. `/proc/self/io` is **process-wide**, so a delta
taken across a request collects every other thread's I/O in the same interval — the
breadth OHLC pull alone runs every 120 s (`BREADTH_OHLC_PULL_SECS`).

⭐ **Window A's 0.960 was luck, not insight.** Its quiet samples happened to have
`io_read_bytes` of *exactly* 0.00 — nothing else was running — so the counter was nearly
clean in that window and filthy in Session 8's. **An instrument reproduced its own blind
spot, and the only thing that caught it was dividing by a physical constant.**

⭐ **So D-048 STANDS. The "two phenomena" reading is not superseded** — and this file
records the withdrawal rather than quietly deleting the claim, because a prediction
document that edits away its own wrong premise is worth nothing.

**What survives, and it is stronger for being on two independent windows:** restrict the
rate to samples where the request genuinely was doing I/O (`rf_fetch` > 100 ms, so its own
work dominates the interval) and both windows agree —

`11.6 · 12.8 · 15.8 · 17.1 · 21.4 · 22.5 · 25.6 · 34.1 MB/s` (n = 8, S8 and S9-A pooled)

⛔ **That is H5's signature on two windows, and it still excludes H3.** `rf_stmts` is
**12 on every sample of both windows** and `rf_execute` never exceeds 112 ms against an
`rf_fetch` of up to 36 s: plan and connection variance are not what moves this.

⚠️ **The only per-request signals are the phase timings** — `rf_fetch`, `rf_stmt_sum`,
`rf_stmt_max`. Nothing else in the record can be attributed to the request that carried
it. Where an io counter and a phase timing disagree, **the phase timing wins.**

### The two regimes, read off the phase timings rather than the counters

`rf_stmt_sum` gives Pearson **+0.996** but Spearman only **+0.597**, and that gap is the
actual structure. The nine fast samples all sit at `rf_stmt_sum` 8.9–14.8 ms while their
totals range 281–394 ms: below the I/O threshold the request is **CPU-bound** and the
~280 ms floor is `derive` + `serialise` + `encode_render`, which the fetch does not
touch. Above it, the fetch dominates absolutely — 1,310 / 5,363 / 8,855 ms.

**Two regimes, one threshold** — which is D-048's two phenomena, stated in the counters
that can actually see them.

### ⭐ And amplification alone is cheap — the halves MULTIPLY

Samples 5, 6 and 9 read **3.6x–6.5x** more logical bytes than they returned and cost
**309–394 ms**, barely above the 281 ms floor. Their block-device fraction is 0–4.3%:
those re-reads were served from the OS page cache at memory speed.

The time only leaves the floor when the re-reads stop being free:

```
cost  ~  (how many times SQLite re-reads a page)  x  (how often that misses the OS
          page cache)  x  (what a block-device read costs here)
             cache_size                mmap_size / eviction        storage latency
```

The third term is the pooled 11.6–34.1 MB/s band above — **network-volume speed, not a
local NVMe**, which is what this pod actually has. The first two are what the flag moves.

⚠️ The amplification figures in this section are subject to the same process-wide
contamination as everything else from `/proc/self/io`. They are quoted because Window A's
quiet samples read **exactly 0.00 MB** from the block device, which is the signature of an
uncontaminated interval — not because the counter is trustworthy in general.

## 2. The predictions

Same harness, same spans, same settle floor (uptime ≥ 640 s), `rf_pagecache` asserted
to be **1** on every sample or the window is void.

⛔ **Every io prediction below is stated on the window's MINIMUM, never its median.**
Contamination only ever *adds* another thread's bytes and syscalls, so the minimum across
a window is the least-contaminated estimate of what this request alone costs — and it is
the only io statistic the withdrawal above leaves standing. Window A's floor is
reproducible to the byte: `rchar` **6,796,047 / 6,796,048 / 6,796,049** and `syscr`
**1,669** on three separate samples.

**P-B1 — amplification collapses at the floor.** The floor working set is 6.80 MB against
a new 16 MB SQLite cache, so the re-reads should stop being needed at all.
**min(`amp`) falls below 1.5x** — the OFF floor — toward ~1.0x.
→ *Falsified if* min(`amp`) is still ≈1.5x, i.e. the floor did not move.

**P-B2 — the discriminator, and it is `syscr`, not bytes.** `mmap_size > 0` makes SQLite
read pages by **page fault, not by `read()`**. Faulted pages increment neither `rchar` nor
`syscr`. So **min(`io_syscr`) collapses from 1,669 to a few hundred or lower.**
→ *Falsified if* min(`syscr`) stays at or above ~1,600. That would mean the PRAGMA was
accepted and read back as set but is not actually mapping — the production version of
what `test_with_the_flag_on_both_pragmas_are_actually_in_effect` checks off a real
connection.

⭐ **P-B2 is the one prediction contamination cannot fake.** A background thread can only
push `syscr` **up**; nothing it does can push the window's minimum below the floor this
request needs. So a collapse in the minimum is attributable to the flag and to nothing
else.

⚠️ **`io_read_bytes` may NOT fall**, and that must not be read as failure. A major fault
still fetches from the block device; mmap changes *how* the page arrives, not whether a
cold page must be fetched. P-B2 is about `syscr`; P-B3 is about time.

**P-B3 — the tail goes.** `deep_cold` **p90 and max both improve by more than 3x**
(Window A: p90 1,733 ms, max 11,382 ms). The 8–11 s samples do not recur.
→ *Falsified if* max stays above ~4,000 ms.

**P-B4 — the warm path is the control and must NOT move.** `warm_365` is a body-cache
hit that never opens SQLite (`absent_phases` lists every `rf_*`). Its median stays in the
**12–17 ms** band Window A measured.
→ *If warm_365 moves, something other than the flag changed* and the whole comparison is
suspect, not improved.

**P-B5 — correctness is unchanged.** Byte-identical response for the same span.
`rf_rows = 4529` and `rf_bytes = 4,523,328` exactly as in Window A.
→ *Any change here voids the experiment and the flag comes straight back off*, whatever
the timings say.

## 3. Stated in advance: what this cannot settle

- ⛔ **It cannot separate `mmap_size` from `cache_size`.** They ship as one flag and are
  measured as one arm. If the result is good, "which half did it" is an OPEN QUESTION,
  not a finding — P-B1 and P-B2 are designed to give evidence on it (amp is cache_size's
  lever, syscr is mmap's), but two coupled changes in one arm cannot be decomposed by
  one A/B.
- ⛔ **It cannot rule out a memory cost.** 16 MB of page cache per connection and a 64 MB
  mapping on a pod that opens a connection per call is a footprint question this window
  does not measure.
- ⚠️ **`/proc/self/io` is PROCESS-wide, not request-scoped.** Window A proved it the hard
  way: the three samples taken across another workstream's deploy reported `rchar` of
  **55.5 GB, 14.3 GB and 1.6 GB** — the boot prewarmers' I/O, not this query's. On a
  settled pod at 01:30 ET the request dominates, but the attribution is approximate and
  the phase timings (`rf_stmt_sum`, `rf_stmt_max`) are the sounder signal.
- ⚠️ **n ≈ 20 per arm, one hour, one pod.** A band, not a distribution.
