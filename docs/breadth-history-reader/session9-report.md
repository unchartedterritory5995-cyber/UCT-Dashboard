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

### D.3 M4's production number, re-confirmed as a BAND

Session 7 reported the pre-serialised response taking `encode_render` from **425.2 ms to
53.8 ms** at p50 on the deep path. That was a point estimate from a single window. Over
the 19 settled cold samples here:

| phase | n | min | **p50** | max |
|---|---|---|---|---|
| `encode_render` | 19 | 42.2 | **50.3** | 108.2 |
| `serialise` (M4 added this) | 19 | 60.0 | 72.4 | 115.2 |
| `derive` | 19 | 67.3 | 76.4 | 166.9 |
| `rf_materialise` | 19 | 42.3 | 57.7 | 143.8 |
| `post_reader_ms` | 19 | 119.6 | 133.7 | 848.6 |

✅ **M4 holds: 425.2 → 50.3 ms at p50, an 8.5x reduction (−88%).** The honest form is the
band — `encode_render` is **42.2–108.2 ms**, not "53.8 ms". On the warm path it is
4.7–9.7 ms (p50 **6.1**).

⭐ **And this is where the floor comes from.** `serialise` + `encode_render` + `derive` is
**~199 ms at p50**, against a total floor of 271 ms. **No I/O fix can touch it** — which
is why the fast samples in D.2 are flat regardless of how much SQLite re-read.

### D.4 Window B — the flag ON

**n = 30 settled** (20 `deep_cold`, 10 `warm_365`), `rf_pagecache = 1` on every sample,
**no deploy landed during the window** (watched, not assumed).

| `deep_cold` | OFF (n=19) | ON (n=20) | |
|---|---|---|---|
| p50 | 309.0 ms | **281.0 ms** | ×1.10 |
| **p90** | 3,052.0 ms | **842.0 ms** | **×3.62** |
| **max** | 11,382.4 ms | **1,257.7 ms** | **×9.05** |
| min | 271.0 ms | 243.0 ms | |
| `reconstructed_fetch` max | 9,072.9 ms | **975.6 ms** | ×9.30 |
| `rf_stmt_sum` max | 8,854.9 ms | **893.3 ms** | ×9.91 |
| **min `syscr`** | **1,669** | **182** | **×9.17** |
| min `amp` | 1.5x | **0.16x** | |
| max `read_bytes` | 187.51 MB | **0.00 MB** | |

**Scoring the predictions, which were committed before the flag was set:**

| | prediction | result |
|---|---|---|
| **P-B1** | min `amp` falls below the 1.5x floor | ✅ **1.5x → 0.16x.** Past the prediction: `amp` went *below 1*, because mapped pages are not counted in `rchar` at all |
| **P-B2** | min `syscr` collapses from 1,669 | ✅ **1,669 → 182.** The mmap discriminator, and the one figure contamination cannot fake — a background thread can only push `syscr` **up** |
| **P-B3** | p90 **and** max both improve > 3x | ✅ **p90 ×3.62, max ×9.05.** Both |
| **P-B4** | `warm_365` p50 stays put — the CONTROL | ⚠️ **INCONCLUSIVE — see below** |
| **P-B5** | `rf_rows` / `rf_bytes` identical | ✅ **4,529 and 4,523,328 in both arms** |

⭐ **And one thing predicted NOT to move, moved.** D.0 said *"`io_read_bytes` may not fall,
and that must not be read as failure — a major fault still fetches a cold page."* It fell
to **0.00 MB on all twenty samples**, from a 187.51 MB maximum. The caveat was wrong in
the conservative direction, which is the right direction for a caveat to be wrong in.

#### ⚠️ P-B4: the control moved, and that has to be said plainly

`warm_365` is a body-cache hit that never opens SQLite, so the flag cannot reach it.
It moved anyway: p50 **20.1 → 16.0 ms**, max **123.9 → 20.7 ms**.

**A control that moves is a control that did not control**, so the comparison does not get
to ignore it. Three pieces of evidence say the warm path itself is unchanged and the pod
was simply quieter during window B:

1. **The `syscr` floor is 79 in BOTH arms** — identical underlying work.
2. **The response is byte-for-byte the same size**: `decoded_bytes = 69,979` in both, and
   the priming read — a *real* SQLite read, `rf_pagecache` 0 in A and 1 in B — returned
   `rf_rows = 205` and `rf_bytes = 185,306` in **both arms, on the identical span**. That
   is a stronger identity check than the deep set, whose spans differ by design.
3. The OFF arm's warm outliers (123.9, 41.0, 37.2 ms) carry **ordinary** I/O counters
   (`syscr` 102 on the 123.9 ms sample), so they are **event-loop contention** on the
   single uvicorn process, not disk.

⛔ **It does not rescue the deep result, it just fails to threaten it.** The warm drift is
×1.26; the deep tail moved ×9.05 with a mechanism-specific discriminator (`syscr`) that
moved ×9.17 in lockstep. A quieter pod cannot manufacture that.

#### What remains, and what it tells us

The ON arm still has a tail — 826 / 986 / 1,258 ms — with `rf_fetch` of 453 / 607 / 879 ms
and **low** `syscr` (733 / 824). So those reads were served by **page faults that still had
to fetch cold pages**: the syscall amplification is gone, the storage latency is not.
That is H5, undiminished and now isolated — **it was never what the flag was aimed at.**

### D.5 Verdict on V1 — **KEEP ON**

**The flag stays set on `web`.** Measured, on identical work, with every prediction
committed in advance: the deep-read tail falls **×9.05**, p90 **×3.62**, the mmap
discriminator confirms the mechanism is the one claimed, correctness is unchanged, and the
warm path is provably identical. The one ambiguous result (P-B4) moves in the *improving*
direction and is explained without the flag.

⚠️ **Two things this does NOT establish, stated as plainly as the win:**

1. ⛔ **Which half did it.** `mmap_size` and `cache_size` ship as one flag and one A/B
   cannot decompose two coupled changes. The evidence *leans* mmap — `syscr` collapsing
   9x is mmap's signature specifically, and `cache_size` would not touch it — but "leans"
   is the honest word. Separating them is a second experiment, not a conclusion.
2. ⛔ **Memory is unmeasured.** The pod reads `rss_mb = 2,340.6` at uptime 1,674 s with the
   flag on, and **no OFF-arm RSS baseline was captured**, so there is nothing to compare it
   to. D.0 said in advance this window could not answer it, and it did not. ⚠️ 64 MB of
   mapping plus 16 MB of page cache **per connection**, on a module that opens a connection
   per call, is a real question — mitigated but not closed by the fact that mapped pages
   are file-backed and evictable rather than heap.

> ⛔ **AND KEEPING IT ON IS COUPLED TO §F.1.** The flag is currently **invisible to the
> feature-flag ledger** and cannot be given a row without turning the master gate red. A
> live production flag that no rail can see is the precondition of the `DESK_PUBLIC_SHOWS`
> incident. The blast radius here is far smaller — SQLite pragmas, not paid content on the
> open internet — which is why the recommendation is *keep it on and rename it*, not *turn
> it off*. **The rename needs an authorised merge and is the first thing Session 10 should
> do.**

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

### E.4 ⛔ Does Railway actually wait for the gate? TWO observations, OPPOSITE signs

The workflow's header rests its whole claim on one sentence: *"Railway's 'Wait for CI'
holds the build until the run for that commit passes — so two pushes three minutes apart
become two builds in sequence."* **If that is false, the concurrency group serialises the
CHECKS and nothing else, and the gate does not protect against stacked deploys at all.**

Boot times derived from the pod's own `uptime` (not from any Railway field), against gate
completion read from the Actions API:

| commit | gate completed | pod booted | boot − gate |
|---|---|---|---|
| `6b606990c` | 05:12:53Z | 05:12:55Z (uptime 395 @ 05:19:30Z) | **+2 s — after** |
| `587ee51b2` | 05:32:54Z | 05:32:36Z (uptime 95 @ 05:34:11Z) | **−18 s — BEFORE** |

⛔ **The second deploy cut over eighteen seconds before its own gating check finished.**
That is not compatible with "Wait for CI holds the build".

⚰️ **AND THE DRAFT OF THIS SECTION CLAIMED THE OPPOSITE, ON THE SAME TWO DEPLOYS.** It
read: *"Confirmed again by an unplanned natural experiment — push 05:30:52 + a ~104 s gate
→ pod booted 05:32:36. Same relationship, independently."* The **~104 s was never
measured**; it was the median gate duration, substituted for the real one. The real gate
took **121 s**, which moves the predicted cutover to 05:32:56 and turns a "confirmation"
into an 18-second contradiction. ⭐ **One measured number destroyed a conclusion that two
paragraphs of reasoning had already accepted** — and the reasoning was mine, in this
document, an hour old.

**Session 8 independently found the same direction:** 8 deploys started **99–141 s before**
their checks finished. So of the observations this programme has, **nine point to Railway
not waiting and one points to it waiting** — and the one is within 2 s, which is equally
consistent with coincidence.

> ⛔ **OPEN QUESTION, AND IT IS THE LOAD-BEARING ONE FOR THE 2026-09-14 MITIGATION.**
> Is *Wait for CI* actually enabled on the `web` service? **This cannot be answered from
> the CLI** — `railway deployment list` carries only `status` and `createdAt`, with no
> field for a CI hold. It needs the Railway **dashboard**, which is A.4 and is the
> owner's.
>
> **If it is off,** the gate is checks-only: the runs serialise, the deploys do not, and
> two pushes 20 s apart still stack exactly as they did on 2026-09-14. The mitigation
> installed after that incident would then be **decorative** — and, worse, it reads as
> coverage, which is the failure mode this repo names most often.

**What holds regardless of the answer.** The gate's *checks* are genuinely serialised and
genuinely server-side, which is more than the pre-push hook could offer — `--no-verify`
cannot reach them. That much is real. **The deploy-spacing property is not established,
and this report does not claim it.**

### E.5 ⛔ The authorisation and its own push discipline are in conflict — NOT resolved here

**E1 authorises "two docs-only pushes for the gate contention test". The push discipline
attached to the same session says "one at a time; each to SUCCESS; ≥300 s apart".**

Those cannot both be satisfied. A gate run lasts **96–169 s**, so two pushes 300 s apart
**cannot** contend the queue — the first run is always finished before the second is
created. That is not a hypothetical: it is the exact configuration already observed
**37 times**, including the 206 s pair Session 8 reported and a 152 s pair that still
missed by 22 seconds.

⛔ **So the test as specified is impossible, and the interval that would make it work is
forbidden by the discipline that accompanies it.** This session did **not** pick one. The
20 s interval written into E.3 §3 was drafted before that conflict was noticed, and it is
**withdrawn** rather than executed, for two reasons:

1. It contradicts an explicit standing instruction, and an authorisation's *purpose* does
   not licence overriding its *conditions*.
2. Its downside is member-facing **and §E.4 makes it worse, not better**. The draft
   reasoning here assumed the gate would hold the second cutover. §E.4 now shows that is
   unestablished and the evidence leans against it — so a deliberate 20 s pair is not a
   low-risk confirmation of a working guard, it is a **fair chance of reproducing the
   2026-09-14 502 on purpose**, on a live site, to learn something a dashboard setting
   would say for free.

**What was done instead:** the two authorised docs-only pushes were made **within the
discipline** (≥300 s apart), and their queue waits recorded as a further non-contended
baseline. They confirm the absence of queueing; they cannot demonstrate its presence.

> **DECISION FOR THE OWNER.** To actually exercise the concurrency group, one of the two
> constraints has to give. The cheapest safe option is **not** a production push at all:
> push two commits to a **throwaway branch** with the workflow's `on.push.branches`
> temporarily including it, which exercises the same `concurrency: master-deploy` group
> with **no deploy attached**. That answers "does it queue?" at zero member risk, and it
> is the recommendation.

### E.6 Cutover go/no-go — **NO-GO stands, and now with a number**

The cutover question is whether this programme can move to a regime where changes are
measured in production windows. The blocker is not the code; it is that **a window cannot
survive the deploy cadence.**

Measured from the 37 master pushes in the gate's entire history
(2026-09-14 19:00:49Z → 2026-09-15 05:30:53Z, **10.5 hours**):

| inter-push gap | value |
|---|---|
| minimum | **152 s** |
| p25 | 394 s |
| **median** | **723 s (12.1 min)** |
| p75 | 1,389 s |
| maximum | 3,992 s |

A window needs **~26 minutes** of quiet: 640 s to settle plus ~15 minutes to sample.

| quiet needed | share of gaps that long |
|---|---|
| ≥15 min | 42% |
| ≥25 min | **22%** |
| ≥30 min | **19%** |

⭐ **So roughly one window in five survives — and Window A was destroyed on its first
attempt, which is the expected outcome, not bad luck.** This is the same operational
constraint Session 8 recorded as "median gap 836 s", now measured over a longer span and
against the actual window requirement.

**Three ways forward, and they are not equivalent:**

1. **Shorten the window.** The settle floor is the expensive half (640 s of the 26 min).
   It exists because Session 7 measured 17,480 ms three minutes after boot against 224 ms
   settled — it is not padding and should not be cut on convenience.
2. **Accept per-sample filtering and a longer elapsed time.** Implemented this session:
   the analyser drops unsettled samples and *counts* what it dropped, so an intrusion now
   costs samples rather than the whole window. n accumulates across attempts.
3. **Agree a quiet hour.** The only option that makes a window reliable rather than
   probable, and it is a scheduling decision, not an engineering one.

⛔ **NO-GO stands.** Option 2 alone makes measurement *possible*; it does not make a
30-minute window *available*.

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
3. **Is "Wait for CI" actually enabled on `web`?** (§E.4) — **the highest-value question
   in this report.** Nine observations say Railway does not wait for the gate; one says it
   does, by 2 seconds. If it does not, the mitigation installed after the 2026-09-14
   outage serialises checks and nothing else, and two close pushes still stack. Answerable
   only from the Railway dashboard (A.4, the owner's) — one look, not an experiment.
4. **`_ensure_init()` absorbs a lock block** before the instrumented region, so the fetch
   split still cannot attribute lock wait. Recorded as a standing blind spot.
