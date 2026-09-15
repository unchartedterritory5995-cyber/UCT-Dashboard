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

### ⭐ The finding Session 8 could not make, and it corrects D-048

Session 8 reported Pearson **0.994** against Spearman **0.260** on `io_read_bytes` and
concluded H1 owned the tail but not the ordinary range. It had only one I/O counter.
With `rchar` and `syscr` added by M8, the same relationship is monotonic:

| predictor | Pearson | **Spearman** | Pearson minus the largest point |
|---|---|---|---|
| `io_rchar` | +0.936 | **+0.960** | +0.819 |
| `io_read_bytes` | +0.982 | **+0.933** | +0.999 |
| `rf_stmt_sum` | +0.996 | +0.597 | +0.998 |

⭐ **Spearman 0.960, not 0.260.** The ordinary range is not unexplained after all —
Session 8 was measuring the wrong counter. **D-048's "H1 confirmed for the tail, not the
range" is superseded**, and "H3 leading by elimination" with it.

### ⭐ But amplification alone is cheap — the two halves MULTIPLY

Samples 5, 6 and 9 read **3.6x–6.5x** more logical bytes than they returned and cost
**309–394 ms**, barely above the 281 ms floor. Their block-device fraction is 0–4.3%:
those re-reads were served from the OS page cache at memory speed.

The time only leaves the floor when the re-reads stop being free:

```
cost  ~  (how many times SQLite re-reads a page)  x  (how often that misses the OS
          page cache)  x  (what a block-device read costs here)
             cache_size                mmap_size / eviction        storage latency
```

And that last term is measurable. Block-device bytes against `rf_fetch` on the four
slowest samples gives **~15.8–21.4 MB/s** — a tight band, three of four within 20%.

⛔ **That band is H5's signature and it excludes H3.** Plan or connection variance would
move `rf_stmts` or `rf_execute`; `rf_stmts` is **12 on every sample without exception**
and `rf_execute` never exceeds 112 ms against an `rf_fetch` of up to 36 s. **17 MB/s is
also not a local NVMe** — it is a network-attached volume, which is what the pod has.

## 2. The predictions

Same harness, same spans, same settle floor (uptime ≥ 640 s), `rf_pagecache` asserted
to be **1** on every sample or the window is void.

**P-B1 — amplification collapses.** The working set at the floor is 6.80 MB against a
new 16 MB SQLite cache, so the re-reads should largely stop. Median `amp` falls to
**≈1.0–1.5x**, and **no sample exceeds 10x**.
→ *Falsified if* two or more samples exceed 10x.

**P-B2 — the discriminator, and it is `syscr`, not bytes.** `mmap_size > 0` makes SQLite
read pages by **page fault, not by `read()`**. Faulted pages do not increment `rchar` and
do not increment `syscr` at all. So **`io_syscr` collapses from its 1,669 floor toward a
few hundred**, and `rchar` collapses with it.
→ *Falsified if* `syscr` stays at or above ~1,600 on the fast samples. That would mean
the PRAGMA was accepted and reported but is not actually mapping — the exact failure the
rail `test_with_the_flag_on_both_pragmas_are_actually_in_effect` reads back off a real
connection to catch, here checked in production instead of in a test.

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
