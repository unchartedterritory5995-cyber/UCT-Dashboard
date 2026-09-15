# Breadth History Reader — Session 9 report

**Origin:** D-042 measured `/api/breadth-monitor?days=8000` at **54,923 ms cold** in
production. Sessions 0–8 instrumented the path, named the encoder, removed it, and split
the fetch. Session 9 builds and measures the **H1 page-cache fix**, investigates the
**query shape**, and puts a number on the **deploy gate**.

Prior records: `00-profile.md` (Sessions 0–8), `session7-report.md`, `session8-report.md`,
`docs/breadth/DECISIONS.md` (D-042 … D-048).

---

## 0. What was authorised, and what happened

| # | Authorisation | Gate | Outcome |
|---|---|---|---|
| **M7** | `docs/session8-record` → master | tests green | ✅ merged, `102c5b39a` |
| **M8** | `breadth/page-cache` → master | tests green | ✅ merged, `1571e2f87` |
| **V1** | set `BREADTH_OHLC_PAGECACHE` ON in Railway `web` | after window A | ✅ set 05:56Z, live 06:02Z, **confirmed in-process** |
| **E1** | two docs-only pushes for the gate contention test | outside windows and guard hours | see §E |

Nothing else was pushed. Workstream C's candidate is **built and not merged**, as
instructed; it is an OPEN QUESTION below.

⭐ All eight programme merges M1–M8 are landed and verified by ancestry
(`git merge-base --is-ancestor`), not by a branch name or a push log.

---

## A. State check

`BREADTH_OHLC_PAGECACHE` was **unset on every service** at the start of the session —
confirmed two independent ways, which is the standard this programme holds itself to:

1. `railway variables --service web --kv` listed only `BREADTH_DIVIDEND_BASIS`,
   `BREADTH_OHLC_PULL_SECS`, `BREADTH_OHLC_REMOTE`.
2. **Every sample of window A carried `rf_pagecache = 0`** — read off the request that
   was served, not off the config.

⛔ **A.4 (the Railway probe needing the dashboard) is the owner's and is not blocking.**
Nothing in this session depends on it.

---

## B. The H1 fix — what M8 actually shipped

`api/services/breadth_daily_ohlc.py`, behind one env flag, **default OFF**:

```python
_MMAP_BYTES = 67108864     # 64 MB against a 39.9 MB file; growth 0.24 MB/yr -> ~101 yrs
_CACHE_KIB  = -16000       # 16 MB, against the shipped default of -2000 (2 MB)

def _apply_pagecache(c):
    if not _pagecache_on():
        return
    c.execute(f"PRAGMA mmap_size={_MMAP_BYTES}")
    c.execute(f"PRAGMA cache_size={_CACHE_KIB}")
```

**15 rails** in `tests/test_breadth_pagecache_flag.py`. The load-bearing ones:

- ⛔ **The OFF state is the one that matters**, because a flag that quietly applies its
  change when off would make the A/B window measure the same thing twice and report
  "no difference" as evidence the change does nothing.
  `test_with_the_flag_off_the_connection_is_exactly_as_it_always_was` **reads both
  pragmas back off a real connection** — `mmap_size` is silently capped by
  `SQLITE_MAX_MMAP_SIZE` at compile time, so asserting the call was *made* would pass on
  a build where it does nothing.
- Every non-affirmative value (`""`, `0`, `false`, `off`, `no`, `maybe`) leaves it OFF:
  a typo in a Railway variable must not turn an unmeasured experiment on in production.
- `test_the_flag_changes_no_query_result` — same rows, same **order**, both ways.

Mutation-proved four ways (`mut_b5.py`): PRAGMAs fire when off · PRAGMAs never applied
when on · the affirmative test inverted · the statement counter stopped counting. Each
goes red on the rail written for it.

**Instrument additions (also M8):** `io_counters()` returns `(read_bytes, rchar, syscr)`;
per-statement `rf_stmts / rf_stmt_min / rf_stmt_max / rf_stmt_sum`; `rf_pagecache` and
`rf_conn_reused` stamped on every request. ⭐ `syscr` is what made §D's discriminator
possible and did not exist in Session 8.

---

## C. The query shape — BUILT, NOT MERGED (open question)

Branch `breadth/fetch-shape` at `7a79cc9d3`, behind `BREADTH_OHLC_FETCH_RANGE`,
default OFF. **37 insertions, 6 deletions, one file.**

**C.1 — the set is contiguous, measured at every span.** `asked == rows_in_range` at
90 (105/105), 365 (380/380) and 8000 (4700/4700), so "all rows between the first and last
asked date" *is* the asked set. C.5's stop-if-sparse branch does not fire. The Python-side
membership filter is kept regardless, so the shape stays correct if that ever changes.

**Why the shape is suspect.** `breadth_reconstructed_daily` is a rowid table with a TEXT
PRIMARY KEY, so every lookup is index-descent → rowid → table-descent: **two b-tree walks
per date, ~9,058 for a deep read.** `EXPLAIN` confirms it. And the chunk of 400 is a
hand-chosen constant, not a limit — SQLite 3.50.4 allows **32,766** variables, so the 12
statements could have been 1 all along.

**C.2 — and the warm number is unimpressive, which is the point.** LOCAL, warm, median
of 5: days=8000 **11.4 → 9.6 ms (1.19x)**, 365 0.5 → 0.3 (1.67x), 90 unchanged.

⭐ **Warm is exactly where the shape should not matter** — every page is already cached.
The case it is for is the **evicted** one, where 4,700 random descents each cost a fault
and one sequential walk does not. Session 8 established that case cannot be produced on
this box. **So the value of this change is UNPROVEN and it ships OFF.**

**C.3 — identity.** Row-for-row and key-order identical at all three spans, plus full-body
sha parity over **5,576,278 bytes** against a real `origin/master` worktree, with flip and
truncate controls both differing.

> **OPEN QUESTION — do not merge on the local number.** The production measurement that
> would decide it is a window with `BREADTH_OHLC_FETCH_RANGE` on, against §D's OFF arm, on
> the **cold** path. If the H1 fix already removes the tail (§D), this change may have
> nothing left to buy — in which case the right answer is to delete the branch, not to
> merge a second mechanism for a problem that is gone.

---

## D. The A/B window

### D.0 Method

Both arms: `days≈7350–7450` (a distinct span per sample, so every one is a forced cache
miss), settle floor **uptime ≥ 640 s**, and the arm read off `rf_pagecache` **on the
request** rather than from the filename or the config.

⛔ **Window A had to be run twice, and the reason is the programme's standing hazard.**
Another workstream deployed `587ee51b2` at **05:30:52Z** mid-window. The pod booted
05:32:36; sample 14 straddled the swap, and samples 14–20 plus the entire warm set ran at
uptime 95–411. **Twelve of 25 samples were void.** They are preserved
(`s9_a_contaminated.json`) rather than deleted, and the analyser now drops anything under
the settle floor and **counts what it dropped** — a window that loses samples to an
intrusion should degrade, not silently average a booting pod into the result.

The OFF arm was topped up on a settled pod with distinct cache keys: **n = 29 settled**
(19 `deep_cold`, 10 `warm_365`).

### D.1 The OFF baseline

| | n | p50 | p90 | max | min |
|---|---|---|---|---|---|
| `deep_cold` | 19 | **309.0** | **3,052.0** | **11,382.4** | 271.0 |
| `warm_365` | 10 | **20.1** | 49.3 | 123.9 | 11.5 |

`rf_rows = 4529` and `rf_bytes = 4,523,328` on **every** sample — identical work, a 42x
spread in time. `syscr` floor **1,669**; `amp` (rchar ÷ bytes returned) p50 1.5x, max
51.6x, with 5 of 19 samples above 10x.

### D.2 H3 vs H5 — and an instrument that had to be withdrawn first

Full working: `session9-window-b-predictions.md`, §1, including the withdrawal in place.

⛔ **`/proc/self/io` is PROCESS-wide, not request-scoped**, and that invalidated the first
reading of this window. Dividing each sample's block-device bytes by its own `rf_fetch`
gives the rate the storage would have had to deliver: Session 8's samples 18, 19, 3 and 2
imply **3,942 / 2,432 / 2,393 / 2,255 MB/s**. No volume delivers 3.9 GB/s. Those bytes
were another thread's — the breadth OHLC pull alone runs every 120 s.

⭐ Window A's Spearman of **+0.960** on `io_rchar` was luck: its quiet samples read
*exactly* 0.00 MB from the block device, so the counter was nearly clean in that window
and filthy in Session 8's. **An instrument reproduced its own blind spot, and the only
thing that caught it was dividing by a physical constant.** D-048 is **not** superseded.

**What survives is stronger for being on two independent windows.** Restricted to samples
where the request genuinely was doing I/O (`rf_fetch` > 100 ms):

`11.6 · 12.8 · 15.8 · 17.1 · 21.4 · 22.5 · 25.6 · 34.1 MB/s` (n = 8, S8 + S9-A pooled)

⛔ **That is H5 — per-seek latency on network-attached storage — and it excludes H3.**
Plan or connection variance would move `rf_stmts` or `rf_execute`: `rf_stmts` is **12 on
every sample of both windows without exception**, and `rf_execute` never exceeds 112 ms
against an `rf_fetch` of up to 36 s. 17 MB/s is not a local NVMe.

**Two regimes, one threshold.** `rf_stmt_sum` gives Pearson **+0.996** with Spearman only
**+0.629** — and that gap is the structure, not a weakness. The fast samples all sit at
`rf_stmt_sum` 8.9–14.8 ms while their totals span 271–394 ms: **below the threshold the
request is CPU-bound** and the ~280 ms floor is `derive` + `serialise` + `encode_render`,
which no I/O fix touches. Above it the fetch dominates absolutely (1,310 / 5,363 /
8,855 ms). That is D-048's two phenomena, stated in counters that can see them.

### D.3 Window B — the flag ON

*(to be completed — the predictions were committed before the flag was set)*

### D.4 Verdict on V1

*(to be completed)*

---

## E. The deploy gate

### E.1–E.3 What was already knowable without pushing anything

Predictions committed **before** any contention push:
`session9-gate-contention-predictions.md`.

⛔ **The mechanism has never been exercised.** Over **every run the workflow has had** —
36 runs, `2026-09-14 19:00:49Z` → `2026-09-15 05:10:55Z`, read from the Actions API — the
`master-deploy` concurrency group has queued **zero** runs behind another.

| quantity | measured over 36 runs |
|---|---|
| queue wait | **3–5 s** on 34 of 36 |
| the two exceptions | 13 s and 39 s, **neither with a predecessor running** — runner allocation |
| job execution | **93–136 s** |
| created → completed | **96–169 s**, median ≈ 130 s |

The closest two runs have ever come is **22 seconds** (`6b606990c` created 05:10:55;
`1571e2f87` completed 05:10:33). **That is the entire safety record of this mechanism** —
every green run to date is equally consistent with the concurrency block being absent.

### E.4 ⭐ And the gate does something NARROWER than its own header claims

The workflow states Railway's "Wait for CI" *holds the build*. The timings say otherwise:

- A Railway deploy's `createdAt` is the **push** time (`1571e2f87`'s deploy is stamped
  05:08:22; its gate run was created 05:08:23).
- The pod serving during window A **booted 05:12:55Z** — derived from `uptime 395` at
  `05:19:30Z` on the pod itself, not from a Railway field.
- That commit's gate run completed **05:12:53Z**.

**The cutover is 2 seconds after the gate passes, and a container build does not take 2
seconds.** Railway is **building concurrently with CI and holding only the cutover**.

⭐ **Confirmed again by an unplanned natural experiment the same hour.** The intrusion
that wrecked window A: push 05:30:52 + a ~104 s gate → pod booted **05:32:36**. Same
relationship, independently.

**Consequence.** Because a queued run still has to *execute*, the floor on the spacing
between two cutovers is `exec(B)` ∈ **[93, 136] s**, whatever the push interval. The gate
does not stop two builds overlapping — they already overlap. It **spaces the two traffic
swaps by at least one gate execution.**

⚠️ **That margin is not comfortable.** The incident this gate was installed for
(2026-09-14) served 502 for ~45 s and killed an in-flight request after **93 s**. A 93 s
floor against a ~93 s disruption window is a coin flip, not a guard.

### E.5 The contention observation

*(to be completed)*

### E.6 Cutover go/no-go

*(to be completed)*

---

## F. Findings that are not about breadth

### F.1 ⛔ The flag ledger structurally cannot see this flag

`BREADTH_OHLC_PAGECACHE` — now **set to 1 on production `web`** — has no row in
`docs/feature_flags.json`, and **cannot be given one**. `is_gate()` in
`api/services/feature_flag_index.py` is:

```python
return any(m in name for m in _GATE_MARKERS) or name.endswith("_ON")
```

The name carries no `ENABLED`/`DISABLE` marker and does not end `_ON`, so the AST index
does not list it among its 284 gates (verified by running the derivation). Adding a row
anyway would be classified as **rot** by
`test_the_ledger_does_not_describe_gates_that_no_longer_exist` and would **turn the master
deploy gate red**.

⚰️ **This is the `DESK_PUBLIC_SHOWS` shape exactly** — the source file's own comment
records it: *two independent reasons, `is_gate()` false for it and the ledger rail only
asking about gates*, which together let a wildcard publish 27 paid sessions for 25 days.
`BREADTH_OHLC_FETCH_RANGE` (§C) is invisible for the same reason.

> **OPEN QUESTION, and it is coupled to D.4.** If V1's verdict is *keep ON*, the flag
> must become visible to the ledger first, and the cheapest correct fix is a **rename to
> `BREADTH_OHLC_PAGECACHE_ENABLED`** (one constant, one env var, no behaviour change).
> "Keep the flag on" and "make the flag visible" are **one decision, not two** — leaving
> it on while invisible re-creates the exact precondition of the 2026-08-19 leak.

### F.2 Instrument failures found this session

Every one of these produced a *plausible* answer before it was caught.

| # | What it reported | What was true |
|---|---|---|
| 1 | `io_rchar` ranks request time at Spearman +0.960 | `/proc/self/io` is **process-wide**; caught by dividing by a physical constant (3.9 GB/s) |
| 2 | "no boot in ~200 s → staged" | `railway variables --set` **did** auto-redeploy `web` — after **~4–5 minutes**. CLAUDE.md's "~3 minutes then redeploy" would also have been too short, and would have stacked a redeploy on an auto-redeploy |
| 3 | `--set` "returned NOTHING — treat as failed" | It had **already succeeded**. The emptiness rule is about **reads**; a write that prints nothing is a normal success. The guard failed in the safe-looking direction while production had already changed |
| 4 | `railway redeploy` → "No linked project found" — and the run carried on | The CLI resolves its project from the **cwd**; it was run from the scratchpad. ⭐ *"An empty result is a failed invocation"* is **necessary and not sufficient** — an **error** is also non-empty. Check the return code |
| 5 | Window A: 25 samples, all "fine" | A foreign deploy landed mid-window; 12 were measured on a booting pod. Only the per-sample `uptime` caught it |
| 6 | Window B: started sampling immediately | The settle wait lives in the **wrapper**, not in `s9_window.py`; the relaunch reproduced the script and not the wrapper. Killed after 2 samples and restarted |
| 7 | Harness "exit code 0" | A `FileNotFoundError` traceback (`logs/` did not exist). **The wrapper's status is not a verdict** — third sighting in this repo |
| 8 | Analyser died mid-report | `UnicodeEncodeError` on cp1252: one `⛔` in an output line. Fixed at the **stream**, not by deleting the character |

⭐ The common shape in 1, 3, 4 and 7: **a check that answers the wrong question confidently.**
The fix is never to soften the check — it is to ask what the instrument could not have seen.

---

## Open questions

1. **Merge the range-scan shape?** (§C) — needs a production cold measurement, and may be
   moot if the H1 fix removes the tail.
2. **Rename the flag so the ledger can see it?** (§F.1) — coupled to D.4's verdict.
3. **Is the gate's ~95 s spacing floor good enough?** (§E.4) — against a measured ~93 s
   disruption window. If not, the lever is making the gate *slower*, which the workflow
   header explicitly argues against.
4. **`_ensure_init()` absorbs a lock block** before the instrumented region, so the fetch
   split still cannot attribute lock wait. Recorded as a standing blind spot.
