# UCT Breadth History Reader — Session 8 report

Date: 2026-09-15 (UTC). Worktree `C:\Users\Patrick\uct-worktrees\breadth-history-reader`.

Both authorised merges landed, each to SUCCESS before the next, neither within 300 s of
another deploy, neither inside a window. **No Railway setting was changed and no cutover
happened.** `production` remains unwatched.

**Web copy:** https://claude.ai/artifact/XoHHRXDT8CKasTPRfRM285 — private, no member
identifiers on the page.

⛔ Results and interpretation are separated. A number without its instrument, its `n` and
its settled-status is not quoted as a result.

---

# A. State check

## A.1 — refs, deploy, and what landed between

| | |
|---|---|
| `origin/master` at open | `85e68247c` |
| `production` at open | `85e68247c` (fast-forwarded by the gate) |
| deploy at open | `85e68247c`, SUCCESS 03:02:53Z |
| commits since `baffee6cf` (M4) at open | **67** |

**Reader path across all 67 — byte-identical:**

| file | `baffee6cf` vs `85e68247c` |
|---|---|
| `breadth_monitor.py`, `breadth_daily_ohlc.py`, `breadth_timing.py`, `routers/breadth_monitor.py`, `breadth_numeric_migration.py`, `cache.py`, `single_flight.py` | **all IDENTICAL** |

Non-vacuity: **71 files changed**, of which **0 under `api/`**. The comparison can see a
difference; there was none on the reader path.

⭐ **Every one of those 67 went through the gate** — see §E.1. That is the first session
where the gate has governed other workstreams' pushes, not only mine.

## A.2 — the six Session 7 questions, with the 0.1 classification

| # | question | my recommendation | 0.1 class |
|---|---|---|---|
| **Q1** | Cache the gzipped bytes too? | **(a) No, not yet** — the route would own `Content-Encoding`, and an `identity` client must still get plain JSON. A correctness surface for ~60 ms on a path already 8× faster. | ⛔ **needs you** — member-visible (wire bytes) and a push |
| **Q2** | orjson? | **(a) No** — byte-identical today but emits `null` for NaN/±Inf where the route raises. | ⛔ **needs you** — (c) dependency-class decision. **Adopted as "declined", recorded in D-047** so it is not re-litigated |
| **Q3** | `reconstructed_fetch` next? | **(a) Profile the SQLite read itself** | ✅ **ADOPTED** — Workstream C. No push, no member change |
| **Q4** | GZip level | **(a) Keep level 5** | ⛔ **needs you** — (d) explicitly |
| **Q5** | E.3's probe | **(a) Check Railway's webhook log first** | ⛔ **needs you** — see A.4; it needs the dashboard |
| **Q6** | push `docs/session7-record` | **(a) Push and merge via the gate** | ✅ **ADOPTED** — M5 was authorised |

## A.3 — 0.3 answer: what does M4 cache?

**Pre-gzip bytes only.** The route returns `Response(content=body, media_type="application/json")`
and sets **no** `Content-Encoding` (grep count: 0); `_GZipSkipSSE(minimum_size=1000,
compresslevel=5)` still compresses on **every** request, warm included.

⭐ **So compression is NOT paid once per TTL and the level question is not moot.** Per 0.3
the level table is re-emitted (§C.5) and the decision is yours.

| | |
|---|---|
| key set | `breadth_history_body_{days}_{end or 'latest'}_{anchor}` — under the existing `breadth_history_` prefix, so every writer's `delete_prefix` already drops it |
| TTL | **300 s**, matching the row cache |
| bound | shared `TTLCache`, `_MAX_SIZE = 1000` app-wide |

⚠️ **Resident size in production is NOT measurable from outside.** The cache lives in the
running uvicorn process; `railway ssh` starts a *separate* Python, which cannot see it.
Expected from the local measurement: 4,958,766 B for a deep entry plus the row-cache
entry's 24,471,209 B, both live for 300 s. **Stated as an expectation, not a measurement.**

## A.4 — E.3 status: designed only, and it is NOT CLI-only

`railway add` **can** create a service and link a repo — but it has **no branch option**
(`-d/--database`, `-s/--service`, `-r/--repo`, `-i/--image`, `-v/--variables` only).
Pointing a service at `production` needs the dashboard, and a repo-linked service defaults
to the repo's default branch, which would **boot a second full copy of the app**.

⛔ **Not zero-blast-radius, and not CLI-only. I did not run it.** It is a keyboard step for
you.

## A.5 — the intrusion picture, which decided how Section D was attempted

15 master pushes in the observed window:

| | |
|---|---|
| shortest interval | **206 s** |
| median interval | **836 s** (~14 min) |
| longest | 3,992 s |
| intervals under 900 s | **8 of 14** |

⭐ **A settled-window measurement needs ~30 clear minutes — 10 to settle plus 20 to
sample. The median gap between pushes is 14.** That is the operational fact that decided
Section D's budget, and it is why Session 7's window died twice.

---

# B. Workstream B — the cache label

## B.1 — what actually serves each span

Measured, not reasoned: the harness counts which tier answered and compares that to the
label, per the standing rule.

| span | request | served ACTUALLY | label before the fix |
|---|---|---|---|
| 90 | 1st | full read via `get_history` | `miss` ✅ |
| 90 | 2nd, 3rd | **body cache** | `hit` ✅ |
| 90 | body key evicted, plain still warm | **`get_history`'s own cache** | ⛔ **`miss` — the defect** |
| 365 / 8000 | 2nd, 3rd | body cache | `hit` ✅ |

⭐ **M4 had already masked most of it.** The bytes cache sits in front, so the mislabel now
only surfaces when the body entry is evicted and the plain one is not — which is exactly
why it needed a rail rather than a one-off fix.

**B.4:** `days=90` is **not** re-read every request. It is served warm; only the label was
wrong. No caching fix is owed.

## B.2 — the fix

`cache` now reports what served the request. A new **additive** `cache_tier` says which:
`body` | `deep` | `plain` | `miss`.

⭐ **Additive on purpose — no break.** `cache` keeps its hit/miss vocabulary so every
Session 5/6/7 log line still parses, and
`test_the_original_cache_field_still_reads_hit_or_miss` asserts it. The log line gains
`tier=`.

## B.3 — the rails, and their mutation proof

`tests/test_breadth_cache_label.py`, five tests, against the real route. Ground truth is a
counter on `_history_uncached` — **the label under test is never the evidence**.

| mutation | result |
|---|---|
| revert the `get_history` note (the original defect) | **RED** — 1 failed, 4 passed, names `test_the_delegated_window_reports_the_plain_tier_not_a_miss` |
| label a real read as a hit | **RED** — names `test_a_real_read_is_never_labelled_hit` |
| body-cache hit stops labelling itself | **RED** — names `test_a_request_served_from_a_cache_is_never_labelled_miss` |

Files restored byte-identically, shas verified, never via `git checkout`.

⚠️ **The first version of these rails read `breadth_timing.get()`** and every one failed
with `None`: the record is per-request and the middleware clears it, so a test's own
context has nothing. They read the **log** now.

---

# C. Workstream C — `reconstructed_fetch`

## C.1 — static facts, echoed before instrumenting

| | |
|---|---|
| table | `breadth_reconstructed_daily(date PK, metrics, ohlc_watermark, sentiment_watermark, built_at)` + `idx_brd_watermark` |
| rows / payload | **4,700** rows · `SUM(LENGTH(metrics))` **4,678,369 B** · avg **995 B/row** |
| DB file | **41,861,120 B** · page_size 4096 · 10,220 pages · on the Railway volume (`/data/breadth_daily_ohlc.db`) |
| query | `SELECT date, metrics FROM breadth_reconstructed_daily WHERE date IN (?…)`, **chunked at 400** → **12 statements** per deep read |
| plan | `SEARCH … USING INDEX sqlite_autoindex_… (date=?)` → **one PK seek per date, 4,700 per deep read** |
| connection | ⛔ **opened per call** — `sqlite3.connect(...)` every time, with `PRAGMA journal_mode=WAL` and `busy_timeout=3000` re-issued on each |
| `cache_size` | ⛔ **−2000 = 2 MB** page cache against a **41.9 MB** file |
| `mmap_size` | ⛔ **0** — every page read is a syscall, never a mapped access |
| `synchronous` | 2 (FULL) |
| writers | `build_reconstructed` / `rebuild_stale` (boot, `api/main.py:3461`), `_rebuild_after_write` (`breadth_ohlc_sync.py:301`), `rebuild_stale` from `breadth_sentiment_history.py:166`, and the migration's `backfill_reconstructed` |

## C.2 — the instrument

`reconstructed_fetch` splits into **`rf_open` · `rf_pragma` · `rf_execute` · `rf_fetch` ·
`rf_materialise`**, plus `rf_rows`, `rf_bytes`, `rf_busy_retries`, and a per-request
`/proc/self/io` delta (`read_bytes`, `rchar`).

⭐ **`read_bytes` is the H1 discriminator and it is confirmed readable in production.**
`read_bytes` counts bytes from the block device; `rchar` includes the page cache. Climbing
`read_bytes` = real disk; flat `read_bytes` with climbing `rchar` = page cache served it
and the time went elsewhere; both flat = it was not reading at all.

⛔ `io_counters()` returns `None` — reported **`unreadable`** — where `/proc/self/io` does
not exist. Never a zero pair.

### The controls, and what each one honestly established

| control | verdict | why |
|---|---|---|
| (iii) warm — every fetch phase still reports | **PASS** | 0 absent of 5; rows 4,529; bytes 4,523,328 |
| (i) cold — read_bytes > 0, execute/fetch rise | **INCONCLUSIVE** | ⚠️ Windows has no `drop_caches`, and `shutil.copy2` **writes** the file straight into the page cache. The control cannot create its precondition. A FAIL here would blame the instrument for the platform. |
| (ii) locked — lock wait visible | **DEMONSTRATED SEPARATELY** | ⚠️ A standalone probe with `locking_mode=EXCLUSIVE` + a real `UPDATE` blocked a read for **5,051 ms**, so lock wait *is* observable. In the route path `_ensure_init()` runs DDL **before** the instrumented region and absorbs the block first, so the split cannot attribute it. |

⚠️ **`rf_busy_retries` has a stated blind spot:** with `busy_timeout=3000` SQLite waits
*inside* the C call, so ordinary contention never reaches Python and is charged to
`rf_execute`. The counter detects **severe** contention (past the timeout), not any
contention. That is documented at the counter, not just here.

⚰️ **Control (ii) v1 reported the instrument blind when it was not.** `BEGIN EXCLUSIVE`
does not block a WAL reader — that is what WAL is *for* — and `CREATE TABLE IF NOT EXISTS`
on an existing table is a no-op that takes no lock at all. The control held nothing.

## C.3 — the M6 gate

| condition | result |
|---|---|
| parity EXACT across 90/365/8000 vs a real `origin/master` worktree, flip + truncate controls | ✅ sha `7695923c…`, **5,576,278 bytes**, sides distinct (`golden` vs `fetch-instrument`) |
| memory transient not above current | ✅ **59.4 MB** vs the golden's **60.6 MB** |
| every new phase/counter has a non-vacuity control | ✅ control (iii); (i) and (ii) limits declared above |
| the cache-label fix has a rail that goes red without it | ✅ three mutations, each naming its rail |
| flow-worker classified, traced not assumed | ✅ `docs/breadth/flow-worker-strand-fetch-instrument.md` — **INERT** |
| controls (a)(b)(c) green | ✅ reader 97.5 %, post 98.7 % |

**Merged as `47e1516b5`, deploy SUCCESS 03:46:47Z.** Scoped suite 141 passed (136 after
the master merge).

## C.4 — local reproduction: **neither mechanism reproduces it**

⛔ LOCAL, labelled.

| attempt | n | min | median | max | **swing** |
|---|---|---|---|---|---|
| baseline | 5 | 43.3 | 48.9 | 53.2 | **1.2×** |
| (a) page-cache pressure | 5 | 42.6 | 44.9 | 65.3 | **1.5×** |
| (b) concurrent writer | 5 | 44.1 | 49.5 | 85.3 | **1.9×** |
| *production, Session 7* | 22 | 59.3 | 91.2 | 2,974.5 | **50.2×** |

⭐ **The writer committed 460,569 times during its window and moved the read by 1.9×.**
That is strong evidence **against H2**: in WAL a writer does not block this reader, even
at ~10,000 commits/second.

## C.5 — where the time actually goes

| reading | `rf_open` | `rf_pragma` | `rf_execute` | `rf_fetch` | **`rf_materialise`** | total |
|---|---|---|---|---|---|---|
| LOCAL warm | 0.58 | 0.62 | 3.6 | 19.4 | **234.2** | 260.0 |
| LOCAL cold-ish | 0.57 | 0.77 | 3.6 | 22.8 | **102.9** | 132.3 |
| **PRODUCTION**, 1 smoke (unsettled, n=1) | 0.1 | 0.2 | 1.7 | 7.5 | **44.7** | 54.8 |

⭐ **`rf_materialise` is 75–90 % of the phase on every reading taken so far**, production
included — 4,529 `json.loads` calls over 4.5 MB. **That is H4, not I/O.**

### Hypotheses: what the data supports and excludes

| | status | discriminating observation |
|---|---|---|
| **H1** page-cache eviction | ⚠️ **still open** | `io_read_bytes` per request. Readable in production (first sample: 9,498,624 B, but on a 41-second-old pod, so boot-dominated). Needs Section D's settled samples. |
| **H2** lock/busy wait | ⛔ **effectively excluded** | 460,569 concurrent commits → 1.9×, not 50×. WAL readers do not block on writers. `rf_busy_retries` 0 on every sample. |
| **H3** connection/plan variance | ⚠️ **open, and C.1 makes it plausible** | A **fresh connection per call** with `PRAGMA journal_mode=WAL` re-issued each time, a **2 MB** page cache and **no mmap**. `rf_open` + `rf_pragma` are <1 ms when quiet — the question is whether they stay that way under load. |
| **H4** row materialisation | ⭐ **supported — it dominates every reading** | `rf_materialise` 75–90 % of the phase. But it should be *constant* at ~4,529 rows, so it explains the **magnitude**, not yet the **variance**. |

⚠️ **The honest position: the split has relocated the cost but not yet explained the
swing.** H4 owns the level; the 50× is still unattributed between H1 and H3, and Section D
is what separates them.

## C.6 — ranked fix proposals (proposed, not built)

| # | proposal | removes | costs | the measurement that would prove it |
|---|---|---|---|---|
| **1** | **`PRAGMA mmap_size` + a larger `cache_size` on the reader connection** | the syscall-per-page pattern and most of the 2 MB-cache thrash | ~4 lines, env-var reversible, **byte-identical by construction** (no query change) | `io_read_bytes` falls and `rf_fetch` falls, on the same settled window |
| **2** | **Reader connection reuse** (a per-thread connection instead of per call) | `rf_open` + `rf_pragma` per request, and the repeated WAL-mode handshake | thread-affinity care; a connection outliving a request is a new lifetime to get wrong | `rf_open`/`rf_pragma` → absent; no change elsewhere |
| **3** | **Process-resident materialised copy** of the table (4,700 × ~995 B ≈ **4.7 MB** as JSON, ~24 MB as dicts) | the read **entirely** | a new writer/invalidation path — the thing this programme has most often got wrong; and the dict form is the 24 MB the bytes cache just displaced | `reconstructed_fetch` → absent; memory +4.7 MB measured |
| **4** | Writer scheduling change | nothing, on this evidence | — | ⛔ **not proposed** — H2 is excluded |

⛔ **Nothing was built.** Proposal 1 meets C.6's four criteria (<40 lines, env-reversible,
byte-identical, cheap) **except the fourth**: the diagnosis does not yet support it
unambiguously, because H1 is still open. Building it now would be fixing the hypothesis I
find most plausible rather than the one the data names. **It is an OPEN QUESTION.**

---

# D. The after-window — n=20 reached, and the diagnosis breaks open

**Attempt 1 was killed** by the session's third intrusion (`154c50f71`, 03:48:25Z), 189 s
into the settle clock. **Attempt 2 ran clean** on set (i): uptime 661 → 1,395, monotonic.
A fourth restart landed during set (iv), so its 9 samples are excluded and listed.

| | |
|---|---|
| collected | 45 |
| settled and kept | **36** |
| excluded | **9** — all `members_90`, each listed by id, ts and uptime |
| set (i) | **n=20 — the target, met** |

## D.1 — after vs Session 7's B.5 (the only permitted comparison)

**RESULTS.** Deep cold, n=20 settled both sides.

| field | BEFORE p50 / p95 | AFTER p50 / p95 | p50 change |
|---|---|---|---|
| `total_ms` | 728.6 / 3,093.2 | **430.1** / 3,511.8 | **−41 %** |
| `reader_ms` | 219.6 / 2,564.7 | 260.9 / 2,792.4 | +19 % |
| `post_reader_ms` | 470.0 / 729.9 | **159.9** / 719.6 | **−66 %** |
| **`encode_render`** | 425.2 / 702.5 | **53.8** / 234.8 | **−87 %** |

| warm days=365, n=10 | BEFORE p50 | AFTER p50 |
|---|---|---|
| `total_ms` | 74.7 | **17.8** (−76 %) |
| `encode_render` | 50.8 | **5.8** (−89 %) |

⭐ **M4's saving is now a production number, not a local one: `encode_render` p50 425.2 →
53.8 ms.** The local prediction was 8.3× on the warm path; production delivered **8.8×**
on warm `encode_render` and 7.9× on the cold one.

⚠️ **`reader_ms` rose 19 % at p50 and that is not a regression from anything shipped** —
the reader is byte-identical across both windows. It is the same volatility §D.2 is about,
sampled on a different day.

### p95 CI overlap

| | BEFORE | AFTER |
|---|---|---|
| p95 `total_ms` CI | [1,893.8, 3,933.1] | **[1,009.5, 41,263.8]** |

⛔ **They overlap, and the after-interval is enormous** because of one 41-second sample.
**Excluding the two outliers above 3× the running median: n=18, p50 405.5, p95 793.0,
max 1,009.5** — which does *not* overlap the before-band's p95 CI. Both are reported; the
outlier is the subject of §D.2, not noise to be dropped.

## D.2 — ⭐ C.5: what the counters say, and it is decisive for the tail

Per settled cold sample, ordered by `reconstructed_fetch`:

| i | recon_fetch | rf_execute | rf_fetch | rf_materialise | **io_read_bytes** | busy |
|---|---|---|---|---|---|---|
| 12 | 55.1 | 1.8 | 6.6 | 45.7 | 1,568,768 | 0 |
| 2 | 63.7 | 1.8 | 6.6 | 53.8 | 14,880,768 | 0 |
| 18 | 71.6 | 2.4 | 8.0 | 60.1 | 31,539,200 | 0 |
| 20 | 173.0 | 7.7 | 95.4 | 66.6 | 77,824 | 0 |
| 8 | 682.0 | 6.1 | 608.0 | 65.2 | 7,069,696 | 0 |
| **13** | **31,819.8** | **10,312.4** | **21,098.5** | 319.7 | **540,057,600** | 0 |

**Sample 13 read 540,057,600 bytes from the block device in one request.** The whole DB
file is **41,861,120 bytes** — that is **12.9× the entire file**, for a query that returns
4.5 MB.

⭐ **That is page-cache thrashing, and it is not an inference.** Twelve chunked statements,
4,700 PK seeks, a **2 MB** page cache and **mmap_size=0** against a 41.9 MB file: pages are
read, evicted, and read again. **H1 is confirmed for the tail.**

The split confirms it from the other side — across the 577× swing:

| | ratio |
|---|---|
| `rf_execute` | **5,729×** |
| `rf_fetch` | **3,197×** |
| `rf_materialise` | 7.0× |
| `derive` (pure CPU) | 2.5× |

The I/O-bound halves move by thousands; the CPU halves barely move.

### ⚠️ But the tail is not the whole story, and the two correlations say so

| | |
|---|---|
| Pearson r(`io_read_bytes`, `reconstructed_fetch`) | **0.994** |
| **Spearman (rank) r** | **0.260** |

⛔ **The Pearson figure is carried entirely by sample 13.** By rank the relationship is
weak, and the group medians confirm it: fast samples (<100 ms, n=9) read a median of
**2,121,728 B**; slow ones (≥100 ms, n=11) read **5,054,464 B** — a 2.4× difference across
a 3–12× time difference. Sample 20 took 173.0 ms having read **77,824 bytes**.

**Verdict, stated at the precision the data supports:**

| hypothesis | status |
|---|---|
| **H1** page-cache eviction | ⭐ **CONFIRMED for the extreme tail** — 540 MB read, 12.9× the file, 31.8 s. **Not established for the ordinary 3–12× range**: rank correlation 0.26 and a 173 ms sample that read 78 KB. |
| **H2** lock/busy wait | ⛔ **EXCLUDED.** `rf_busy_retries` = 0 on all 20; 460,569 local concurrent commits moved it 1.9×; WAL readers do not block on writers. |
| **H3** connection/plan variance | ⚠️ **OPEN, and now the leading candidate for the ordinary range** — it is what is left once H1 explains only the tail and H2 is out. |
| **H4** row materialisation | ⭐ **owns the LEVEL, not the variance** — 45.7–109.6 ms across almost the whole range (7× only in the extreme), i.e. the floor of every read. |

⭐ **The headline for the next session: the 50× is TWO phenomena, not one.** A rare,
catastrophic page-cache collapse (H1) sitting on top of an ordinary 3–12× variation that
H1 does not explain — and underneath both, a constant ~50–110 ms of `json.loads` that no
amount of I/O tuning will touch.

---

# E. Workstream E — the gate

## E.1 — the observation log, and the first real stacked-push test

**Fifteen master pushes**, ten of them with a promotion run:

| master SHA | whose | gate finished | promotion started | lag |
|---|---|---|---|---|
| `57e5131a3` | mine (M3) | 00:24:39 | 00:24:41 | **+2 s** |
| `e8f7c72a0` | other | 00:28:03 | 00:28:05 | **+2 s** |
| `3879b7369` | other | 01:01:18 | 01:01:20 | +2 s |
| `9b29b46d8` | other | 01:50:34 | 01:50:35 | +1 s |
| `d91ebaca2` | other | 02:01:56 | 02:01:57 | +1 s |
| `6d246b758` | other | 02:24:59 | 02:25:01 | +2 s |
| `7ac0e0aee` | other | 02:38:20 | 02:38:23 | +3 s |
| `baffee6cf` | mine (M4) | 02:44:54 | 02:44:56 | +2 s |
| `789a6bab5` | other | 02:53:33 | 02:53:35 | +2 s |
| `85e68247c` | other | 03:05:05 | 03:05:06 | +1 s |

⭐ **Every promotion starts 1–3 s after its gating check completes — including seven
pushes that are not mine.** Wait-for-CI started eight consecutive deploys **99–141 s
before** their checks finished. The mechanism does what the toggle did not, and it now
governs the whole repo, not one workstream.

### The stacked-push question, answered precisely

**Two pushes arrived 206 s apart** — `57e5131a3` at 00:22:28 and `e8f7c72a0` at 00:25:54,
inside the audit's 300 s window.

⚠️ **The concurrency group was NOT contended, and I will not claim it was.** The first
gate finished at 00:24:39 and the second push arrived 75 s later, so the two runs were
sequential by timing, not by queueing. **The serialisation mechanism remains unproven
under actual contention** — what is proven is that a 206 s gap did not produce two
overlapping promotions.

## E.2 — not run

Per A.4 the Railway-trigger verification needs the dashboard. **Design only**, restated:

| option | cost | blast radius | what confirms it |
|---|---|---|---|
| **(a)** Railway's webhook delivery log, if the GitHub App exposes one | free | **zero** | a delivery recorded for the `production` ref |
| (b) throwaway service watching `production`, no domain/volume/vars, deleted after | one service-hour | low, **but the CLI cannot set its branch** — it would default to master and boot a second app | a deployment appears on it at the next promotion |
| (c) repoint `web` | — | ⛔ that **is** the cutover | — |

⭐ **Partly settled for free in Session 7**: M4's promotion pushed `production` with the
workflow's `GITHUB_TOKEN` and the branch moved, so the push works and needs no deploy key.
Only the *build trigger* is unverified.

## E.3 — cutover go/no-go as it stands

| # | step | state | owner |
|---|---|---|---|
| 1 | `production` exists on origin | ✅ **verified** — created Session 7, fast-forwarded by the gate twice | — |
| 2 | the gate promotes only after gating checks pass | ✅ **verified** — 10 promotions, +1–3 s each | — |
| 3 | fast-forward only, never forced | ✅ **verified** — `production` an ancestor of master at every check | — |
| 4 | the gate serialises two contended pushes | ⚠️ **UNPROVEN** — never contended | — |
| 5 | branch protection on `production` | ❌ not done | 👑 browser + org-admin |
| 6 | Actions token allowed through protection | ❌ not done | 👑 browser + org-admin |
| 7 | `RAILWAY_TOKEN` repo secret | ❌ not done | 👑 browser |
| 8 | a token push to `production` triggers a Railway build | ❌ **unverified** | 👑 needs the dashboard to create the probe |
| 9 | Railway `web` watched branch → `production` | ❌ not done | 👑 browser |
| 10 | Wait-for-CI OFF | ❌ not done | 👑 browser |

**Go/no-go: NO-GO**, on steps 4 and 8 alone — and 5–10 are all yours.

---

# F. Record

| item | where | status |
|---|---|---|
| F.1 | **D-047** (pre-serialised bytes, the 4.9× cache inversion, orjson declined with the reason, the gzip table) and **D-048** (the `reconstructed_fetch` interim record) | ✅ |
| F.2 | Session 8 in `00-profile.md` | ✅ |
| F.3 | false-instrument appendix — five more (cache-label, control-(c) threshold, the `merge_rows` AST near-miss, the cold-cache control, the lock control v1) | ✅ |
| F.4 | committed on `docs/session8-record`, **not merged** | ✅ |

---

# OPEN QUESTIONS FOR YOU

**Q1 — `reconstructed_fetch` fix.** §D.2 changed the answer I would have given before the
window ran. H1 is **confirmed for the tail** (540 MB read, 12.9× the file) and the fix for
it — `mmap_size` + a larger `cache_size` — is <40 lines, env-reversible and byte-identical
by construction. It does **not** address the ordinary 3–12× range, which is now H3's.
- **(a) Build proposal 1 on a branch, gated, and let me bring you the measurement**
  *(recommended)* — the diagnosis now supports it unambiguously for the failure mode that
  actually hurts, and the change is its own clean experiment.
- (b) Build proposals 1 **and** 2 (connection reuse) together — 2 also attacks H3, but two
  changes in one window make the measurement ambiguous.
- (c) Go straight to proposal 3 (process-resident copy) and remove the read entirely —
  biggest win, biggest new invalidation surface.
- (d) Nothing yet; re-sample first to see how often the tail occurs.

**Q1b — the floor nobody has attacked yet.** `rf_materialise` is 45–110 ms on almost every
sample: **4,529 `json.loads` calls over 4.5 MB, per deep read.** No I/O tuning touches it.
- **(a) Open it as its own line of work in Session 9** *(recommended)* — a stored shape
  that does not need re-parsing.
- (b) Leave it until the I/O work lands.

**Q2 — GZip level** (re-emitted per 0.3; the body cache holds pre-gzip bytes, so this is
still live).
- **(a) Keep level 5** *(recommended)* — level 6 costs +41.7 ms for −2.0 %; level 9 costs
  +86.7 ms for −13.4 %.
- (b) Move to 9.
- (c) Correct the in-code comment only — it claims "<3 %", measured −13.4 %.

**Q3 — cache the gzipped bytes?** It would make Q2 moot and take warm deep from ~62 ms to
~1 ms.
- **(a) Not yet** *(recommended)* — the route would own `Content-Encoding` and an
  `identity` client must still get plain JSON.
- (b) Build it with an identity-encoding rail.

**Q4 — E.2's probe.** Railway's webhook log is free and zero-risk; the service probe needs
the dashboard.
- **(a) You check the webhook log** *(recommended)*.
- (b) You create the throwaway service and I observe the next promotion.
- (c) Defer until cutover day.

**Q5 — the gate's unproven case.** It has never had two contended pushes.
- **(a) Leave it** *(recommended)* — 10 clean promotions is good evidence, and a
  deliberate contention test means two pushes inside one gate run.
- (b) Run a deliberate two-push test (two docs-only commits, the first with a slow marker).

**Q6 — `docs/session8-record`.** Committed, not merged.
- **(a) Merge it with the next push** *(recommended)*.
- (b) Hold it.

---

# PROPOSED SESSION 9

Build proposal 1 — `mmap_size` and a larger `cache_size` on the reader connection, behind
an env var, byte-identical by construction — and measure it against this session's
after-band, because the diagnosis now names the failure it fixes: a request that read
**12.9× the whole database file** through a 2 MB page cache. That is one clean experiment
with a reversible switch. Alongside it, open the second line this window exposed:
`rf_materialise` is **45–110 ms on every sample** and is untouched by any I/O change —
4,529 `json.loads` calls per deep read is the floor under everything, and a stored shape
that does not need re-parsing attacks it directly. Keep the two apart so each has its own
measurement. And carry forward the question this session could not answer: the ordinary
3–12× variation is now H3's by elimination, and connection reuse is the cheap probe for
it. None of the three needs a member-visible change, and all three are measurable against
the band in §D.1.
