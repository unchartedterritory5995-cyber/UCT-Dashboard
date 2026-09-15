# UCT Breadth History Reader — Session 7 report

Date: 2026-09-14 / 15 (UTC). Worktree `C:\Users\Patrick\uct-worktrees\breadth-history-reader`.

**All four authorised merges landed, each to SUCCESS before the next started, none inside a
sampling window, none within 300 s of another deploy.** No Railway setting was changed and
Wait-for-CI was not toggled. `production` was created — authorised by E.1 — and is
**unwatched**; Railway still watches `master`.

**Web copy:** https://claude.ai/artifact/7Apv6j7DsZUmVJqtrHhooQ — private, no member
identifiers on the page.

⛔ Results and interpretation are separated throughout. A number without its instrument,
its `n` and its settled-status is not quoted as a result.

---

# A. State check

## A.1 — master and production at the start

| | |
|---|---|
| `origin/master` at open | **`1216958ed`** — unmoved from the Session 6 close |
| production deploy | `1216958ed`, SUCCESS 2026-09-14T22:09:17Z |
| commits since `1216958ed` | **0** |

No byte-identity re-check was owed at open. **Four separate intrusions followed** and each
one got the check — see the log in §E.2.

## A.2 — the three branches

| branch | ahead | behind | fast-forwardable |
|---|---|---|---|
| `docs/session6-record` | 2 | 0 | ✅ |
| `breadth/phase-instrument` | 2 | 0 | ✅ |
| `breadth/deploy-gate-v2` | 1 | 0 | ✅ |

**Zero file overlap between the three**, so no merge could conflict and no rebase was owed.
All three were later merged forward as master moved under them; each merge was clean and
each branch's gate was re-run afterwards.

## A.3 — the three instrument defects

**Fixed in `e4f5ac4c8`** (on `breadth/phase-instrument`), verified from the committed
source, not from memory:

| defect | fix, verified | rail |
|---|---|---|
| `gzip_send` in `POST_PHASES`, never reported | `POST_PHASES = ("route_tail", "encode_render")`, `SEND_PHASES = ("gzip_send",)`, its own log line with `total_with_send_ms` | `test_the_send_phase_is_reported_on_its_own_line…` |
| `.1f` masking real µs work | `_PHASE_FLOOR_MS`, `_phase_ms` → `<0.001`, `_phase_dur` for the header | `test_a_sub_millisecond_phase_does_not_round_away_to_zero` |
| `merge_rows` hand-rolled `__enter__`/`__exit__` | now a `with` block | ⚠️ **NONE — this was the gap** |

⚠️ **The M2 gate requires a rail per defect and defect 3 did not have one.** Session 6
fixed it and mutation-proved only the other two, so the fix was unprotected. Closed in
**`8e60507f8`** with two tests that are deliberately not duplicates:

- `test_a_phase_whose_body_raises_still_records_its_span` — establishes the guarantee, and
  **says in its own docstring that it does NOT detect the defect**: `phase()` was never
  broken, the call site bypassed it, so reinstating the pair leaves this green. Taking it
  for the detector would be a rail that cannot fail.
- `test_the_reader_wraps_its_phases_in_with_blocks_not_a_manual_pair` — the detector, an
  **AST** walk. ⭐ AST for a specific reason: the fix's own comment contains the words
  `__enter__` and `__exit__` because it explains why they are not used, so a text search
  matches its own justification and fails the correct code. An AST cannot see a comment.

**Mutation-proved:** reinstating the hand-rolled pair (located by content, never a typed
line number) → `1 failed, 17 passed`, naming the structural rail. File restored
byte-identically, sha verified, never via `git checkout`.

## A.4 — QUESTION A.a: is the cache-hit encode cost paid on every warm request?

**RESULT: yes.** `get_history_deep` does `cache.set(ck, out)` where `out` is the list of
row **dicts**, so every warm request re-ran `jsonable_encoder` + `json.dumps` over the
whole payload. Measured locally through the real route, n=5 per span:

| span | cache label | warm total (median) | `encode_render` | encode as % of total |
|---|---|---|---|---|
| 90 | ⚠️ `miss` | **31.8 ms** | 19.4 | 61.0 % |
| **365** | `hit` | **77.2 ms** | 55.4 | 71.8 % |
| **8000** | `hit` | **573.9 ms** | 563.2 | **98.1 %** |

⚠️ **A sub-finding the harness only caught because it recorded rather than asserted:**
`days=90` lies entirely inside the collector range, so `_history_deep_uncached` **returns
`get_history(...)` without ever writing the deep cache key**. The deep reader therefore
reports `cache=miss` on *every* `days=90` request while `get_history`'s own cache serves it
warm. The label is wrong; the cost is tiny. My first version of the harness **asserted**
`cache == "hit"` and aborted — which would have hidden it.

⚠️ **A correction to the question's arithmetic.** The ≈690 ms it infers comes from applying
the local 93 % ratio to production's post-reader **max** (742.1). Against the **median**
(433.0) it implies ≈403 ms — and §B measures the real answer: **425.2 ms p50**.

---

# B. Workstream B — the production BEFORE

## B.1 Protocol, as run

Settled := `/api/health uptime_seconds ≥ 600`, never `/proc/uptime`. Distinct `days=` per
cold sample (no two share a cache key); the warm set deliberately reuses **one** key. ~35 s
cadence (20 s for the warm set, so n=10 fits inside the 300 s TTL). `railway logs` streamed
to `logs/session7-baseline.log` every 5 samples.

## B.2 ⚠️ The window was contaminated, and here is exactly how much

Another workstream deployed **`8e6f892a7` at 23:54:23Z**, mid-window. Pod uptime fell
**1,236 → 54**.

| | |
|---|---|
| samples collected | **56** |
| settled and kept | **37** |
| excluded (unsettled) | **19** — run 1 samples 17–35, every one listed by id, set, timestamp and uptime in the analysis output |

⭐ **Sample 17's health read returned `None`** — the instrument could not read uptime at the
exact moment of the restart. That is recorded as its own fact, not folded into "unsettled".

**Re-verification before run 2 opened**, as the discipline requires:

| file | `5ea008844` vs `8e6f892a7` |
|---|---|
| `breadth_monitor.py`, `breadth_daily_ohlc.py`, `breadth_timing.py`, `routers/breadth_monitor.py`, `cache.py` | **all IDENTICAL** |

Non-vacuity: **17 files did change** — the comparison can see a difference; it found none
on the reader path.

## B.3 / B.4 Results — settled samples only

### Set (i) — days≈7,835–7,880 cold, **n=22**, uptime 643–1,236

| field | min | p50 | mean | p95 | max | sd |
|---|---|---|---|---|---|---|
| `total_ms` | 547.6 | **728.6** | 1,072.0 | 3,093.2 | 3,933.1 | 869.8 |
| `reader_ms` | 158.4 | 219.6 | 564.4 | 2,564.7 | 3,197.9 | 824.1 |
| `post_reader_ms` | 376.8 | 470.0 | 507.6 | 729.9 | 877.6 | 123.8 |
| `encode_render` | 349.8 | **425.2** | 470.5 | 702.5 | 865.1 | 126.7 |
| `reconstructed_fetch` | 59.3 | 91.2 | 370.0 | 1,353.1 | 2,974.5 | **674.9** |
| `derive` | 68.1 | **79.8** | 82.0 | 99.4 | 123.5 | **12.1** |
| `numeric_fetch` | 5.8 | 9.7 | 22.9 | 76.9 | 157.5 | 34.8 |
| `wall_ms` | 779.0 | 998.2 | 1,404.8 | 3,909.2 | 4,337.4 | 956.2 |

p95(`total_ms`) rests on order statistics 20..22 → **95 % CI [1,893.8, 3,933.1] ms**.

**Outliers, reported both ways** (the prompt asked): two samples exceed 3× the running
median of 728.6 — i=1 (3,156.3) and i=9 (3,933.1). **Without them: n=20, p50 721.5,
p95 1,432.4, max 1,893.8.**

⚠️ i=1 is the first request after settle, and it is the only sample where `merged_dates`
is non-trivial (**1,399.8 ms** against ~0.01 ms everywhere else) — its own cache was cold.
That is a distinct, explainable cause, not a random tail.

### Set (ii) — days=365 **WARM**, n=10, uptime 868–1,058 — never measured in production before

| field | min | p50 | p95 | max | sd |
|---|---|---|---|---|---|
| `total_ms` | 55.1 | **74.7** | 352.6 | 525.7 | 142.6 |
| `encode_render` | 39.3 | **50.8** | 57.4 | 58.2 | **6.2** |
| `reader_ms` | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |

Without the single outlier (i=9, 525.7): n=9, p50 72.3, p95 135.1.

⭐ **`encode_render` is the floor and it is rock-steady (sd 6.2).** Everything above it in
`total_ms` is queueing: on i=9, `post_reader_ms` was 525.7 while `encode_render` was
50.6 — a **475 ms residual** that is threadpool/event-loop wait, not work.

### Set (iii) — days=365 cold, n=5, uptime 1,078–1,223

`total_ms` min 75.8 · p50 131.7 · max 221.6. `reader_ms` p50 28.6.

## B.3 answer — which reader phase carries the volatility?

**It is ONE phase, and it is not CPU.** Across a **20.2× swing in `reader_ms`**
(158.4 → 3,197.9 ms), all within a settled window:

| phase | ratio, slowest sample / fastest |
|---|---|
| `reconstructed_fetch` | **50.2×** (59.3 → 2,974.5 ms) |
| `numeric_fetch` | 9.8× |
| **`derive`** | **1.0×** (76.8 → 77.2 ms) |

⛔ **`derive` does not move.** It is pure CPU over 4,703 rows × 80 keys. If the single
uvicorn worker were starved of CPU, `derive` would scale with everything else. It is flat
across the entire range.

**INTERPRETATION: the residual volatility inside a settled window is SQLite read latency on
the Railway volume for `breadth_reconstructed_daily` — volume I/O, not vCPU contention.**
That refines Session 2 rather than overturning it: the 30× between a settled read and a
post-boot read is contention; the 20× *within* a settled window is one table's I/O.

## B.3 answer — does production `encode_render` match the local band?

**No — production is faster.** Local measured 525.5–544.1 ms cold (and 583 ms warm);
production p50 is **425.2 ms** cold and **50.8 ms** at days=365 warm. Production is roughly
**20 % faster than this box** on the same phase.

⭐ Worth carrying: this programme's rule is "no local number quoted as a production
improvement", and the direction here is the *flattering* one — a local prediction of the
saving would have **understated** it. The rule holds regardless of direction.

## B.5 — THE BEFORE

**These are the only numbers Section D may be compared to:** deep cold n=22
p50 `total_ms` **728.6**, p95 **3,093.2** (CI [1,893.8, 3,933.1]); warm days=365 n=10
p50 **74.7**; cold days=365 n=5 p50 **131.7**. Deployed commit `5ea008844` / `8e6f892a7`
(reader path identical).

---

# C. Workstream C — the pre-serialised response

## C.1 The chain, traced before any code was written

```
route returns dict
  -> FastAPI serialize_response        (no response_model on this route)
  -> fastapi.encoders.jsonable_encoder  <-- 302.7 ms at days=8000
  -> starlette JSONResponse.render      <-- 209.8 ms
       json.dumps(content, ensure_ascii=False, allow_nan=False,
                  indent=None, separators=(",", ":")).encode("utf-8")
  -> _GZipSkipSSE(minimum_size=1000, compresslevel=5)   <-- holds response.start
  -> BreadthTimingMiddleware (outermost)
```

**The function producing the 64 %: `fastapi.encoders.jsonable_encoder`.** For this payload
it does nothing but walk **376,240 values that are already `str`/`int`/`float`/`None`** —
4,703 rows × 80 keys.

⚠️ **Two corrections to earlier sessions' assumptions, found by reading the stack rather
than recalling it:** production GZip is **`compresslevel=5`**, not 9 (Session 6's split
measured level 9 and so overstated gzip's share); and the compression happens **inside**
`encode_render`, because starlette's `GZipResponder` holds `http.response.start` until the
body is compressed.

## C.2 Design, and QUESTION C.a

The route renders once and caches the **bytes**; `get_history_deep` is untouched, so
`/series` and every other caller keep their rows.

**C.a — should the cache store bytes?** Measured, deep-walked with an id() seen-set
(⛔ `sys.getsizeof` on a list of 4,703 dicts reports the pointer array and none of the
dicts):

| span | dict (deep) | JSON bytes | gzip-5 bytes |
|---|---|---|---|
| 90 | 630,570 | 146,173 | 23,138 |
| 365 | 2,123,328 | 471,039 | 69,946 |
| **8000** | **24,471,209** | **4,958,766** | 667,077 |

⭐ **RECOMMENDATION, IMPLEMENTED: cache the JSON bytes.** It is **4.9× smaller** than
caching the dicts at days=8000 — it buys the encode saving *and reduces* the resident cost.
This **inverts the risk I flagged at the end of Session 6** ("the cache stores ~5 MB per
span instead of a dict tree — needs a measured memory bound"). The dict tree was the
expensive option all along.

Cache is `TTLCache`, `_MAX_SIZE = 1000` app-wide, TTL 300 s. The body key is
`breadth_history_body_…` — deliberately under the **existing `breadth_history_` prefix**,
so every writer that already calls `delete_prefix` drops it. No new invalidation site, and
no way to serve a stale Monitor after a collector push.

⚠️ **Caching the gzipped bytes as well is NOT implemented** — it would take warm from
~62 ms to ~1 ms, but the route would have to own `Content-Encoding`, and a client sending
`Accept-Encoding: identity` must still get plain JSON. Proposed, not taken (see Q1).

**C.b — orjson or stdlib?** Both measured byte-identical on all three spans.

| | days=8000 | byte-identical | NaN / ±Inf |
|---|---|---|---|
| current (`jsonable_encoder` + render) | 512.6 ms | — | **raises** |
| stdlib, same arguments | **113.0 ms** | ✅ | **raises** |
| orjson | **43.2 ms** | ✅ | ⛔ **emits `null`** |

⛔ **stdlib implemented; orjson proposed, not taken.** orjson is **already a declared
dependency** (`requirements.txt:80`, in use by `api/routers/bars.py`), so it is not an
addition — but it turns a 500 into a plausible wrong number on a data edge. ⭐ **stdlib's
byte-identity is structural** (same function, same arguments, so it holds for values nobody
thought to test); **orjson's is empirical** (matches today's data, diverges on a known
edge). A parametrised rail pins the refusal.

**No double-compression, proved:** with `Accept-Encoding: identity` the route sets no
`Content-Encoding`, the body is plain JSON (471,139 B), the gzip path decodes to the same
bytes, and the decoded body is not itself a gzip stream.
⚠️ **My first version of this control was vacuous** — httpx sets `Accept-Encoding` itself,
so "no gzip accepted" was still asking for gzip. Re-run with an explicit header.

## C.3 Memory bound — the limit is met

One measurement per process; `GetProcessMemoryInfo` with `restype`/`argtypes` set and a
failed call raising (false instrument #1).

| | golden | pre-serialised | verdict |
|---|---|---|---|
| peak over baseline, cold | **61.4 MB** | **61.4 MB** | equal — **limit met** |
| peak over baseline incl. warm | 68.0 MB | **63.4 MB** | new path **4.6 MB lower** |
| resident growth after warm | 54.5 MB | 59.0 MB | +4.5 MB |

The resident delta is the cached body (4.7 MB), which reconciles exactly.

## C.4 Parity — EXACT

| | |
|---|---|
| sha256, both sides | `7695923c7e80d3abe7ca9a8692af3f6adf9295a8369ad033520d65f49b57cc6d` |
| bytes compared | **5,576,278** across spans 90 / 365 / 8000 |
| golden | a real `git worktree` at `origin/master` (re-run three times as master moved; final golden `7ac0e0aee`) |
| per-span sha | all three match individually |
| controls | flip one byte → differs ✅ · truncate one byte → differs ✅ |
| side detection | `golden` vs `preserialised`, derived from source |

**Headers**, both sides, cold and warm, days=365 and 8000: `content-type: application/json`,
`content-encoding: gzip`, `vary: Accept-Encoding`, `Server-Timing` present, no
`Content-Length`. **Unchanged.**

## C.5 GZip level table — measured, not changed

days=8000 body, 4,958,867 B uncompressed:

| level | compress ms | bytes out | vs level 5 size | vs level 5 time |
|---|---|---|---|---|
| 1 | 28.7 | 1,287,614 | +93.0 % | −32.7 ms |
| 3 | 46.4 | 800,161 | +19.9 % | −15.0 ms |
| **5 (production)** | **61.4** | **667,150** | — | — |
| 6 | 103.1 | 654,066 | −2.0 % | +41.7 ms |
| 9 | 148.1 | 577,542 | **−13.4 %** | +86.7 ms |

days=365: level 5 = 70,012 B in 6.1 ms · level 1 = 131,418 B in 2.0 ms · level 9 =
61,350 B in 10.0 ms.

⚠️ **The in-code comment justifying level 5 says level 9 gives a "<3% size gain". Measured,
it is −13.4 %.** The choice still looks right — +86.7 ms of shared event loop per deep
request is a lot — but the stated reason is wrong and should be corrected or dropped.

## C.6 Local before/after profile ⛔ LOCAL

| | before | after | |
|---|---|---|---|
| days=8000 **warm** | 508.3 ms | **61.2 ms** | **8.3×** |
| days=8000 cold | 827.8 ms | **382.5 ms** | 2.2× |
| days=365 **warm** | 50.7 ms | **10.0 ms** | 5.1× |
| days=365 cold | 176.2 ms | 148.9 ms | 1.2× |

`encode_render`, days=8000: **544.1 → 43.9 ms** cold, **504.1 → 58.7 ms** warm.

⭐ **The work did not vanish — it was renamed and moved.** `serialise` is a new named POST
phase (79.1 ms cold at 8000, 10.2 at 365) and reads **`absent`** on a cache hit, because
the route genuinely does not serialise then. **What remains inside `encode_render` is the
GZip compression** (61.4 ms measured at level 5, matching the 43.9–58.7 observed).

## C.7 Controls and rails

Ten new rails in `tests/test_breadth_preserialised.py`; scoped suite **126 passed**.

| control | result |
|---|---|
| (a) every phase > 0 on a deep cache=miss, none absent | **PASS** |
| (b) sums within 10 % — reader 97.8 % (residual 3.2 ms), post 98.7 % (residual 1.5 ms) | **PASS** |
| (c) cache hit: reader phases absent, post-reader non-trivial | **PASS** *(after the rule was corrected — below)* |

⚠️ **Control (c) FAILED first, and the rule was wrong, not the code.** It required
`post_reader_ms > 50` — a threshold calibrated in Session 6 against a **586 ms** warm path.
The change took warm to **37 ms**, so *the improvement failed the control built to measure
it*. A magnitude was never what (c) tests. It now tests the structure — reader phases
**absent**, at least one post phase present and non-zero — and **still passes on the golden**
(569.9 ms warm), so it is not a rule tuned to accept only the new code.

⚠️ **A declared contract change:** `get_breadth_history` now returns a `Response`, not a
dict. The one direct caller (`api/main.py::_breadth`) discards the value, but
`tests/test_breadth_history_direct_call.py` read it; those assertions now decode the body
and their subject is unchanged. ⭐ That file also surfaced a second thing: without clearing
the body cache between cases, its second test hit the first's entry, the service was never
called, and the capture came back **empty** — a test that had silently stopped exercising
its own subject. The fixture now clears it both ways.

## C.8 Flow-worker — ADDITIVE, INERT, no redeploy

`docs/breadth/flow-worker-strand-preserialised.md`. Traced by AST closure walk:
**`api/routers/breadth_monitor.py` is not in flow-worker's import closure at all.** The one
reachable change is `POST_PHASES`, a tuple read only by `finish()`, `server_timing()` and
`phase_residual()` — all middleware-driven, and flow-worker mounts no middleware.

## C.9 M4 gate — every condition met

| condition | result |
|---|---|
| body byte-identical across 90/365/8000 vs a real origin/master worktree, flip/truncate controls | ✅ |
| memory bound measured and within C.3's limit | ✅ 61.4 = 61.4 cold; warm 4.6 MB lower |
| flow-worker classified | ✅ INERT |
| controls (a)(b)(c) re-run green | ✅ |

**Merged as `baffee6cf`, deploy SUCCESS 02:45:15Z.**

---

# D. The after-window — NOT REACHED, and why

**RESULT: n = 0 settled samples. p95 is NOT ESTIMABLE. Nothing is claimed from it.**

The brief is explicit: *"If the after-window cannot reach n=15 on set (i) in this session,
report what n it reached and mark p95 as not estimable — do not stretch."* This is that
report.

## The cause is not a measurement failure

The window needs a pod settled ≥ 600 s. **Another workstream deployed four times during
this session**, each restarting the pod:

| time | commit | effect on this session |
|---|---|---|
| 23:15:49Z | `3fa362e46` | before the B window; handled |
| 23:54:23Z | `8e6f892a7` | ⚠️ **restarted the pod mid-B-window** — 19 samples excluded |
| 02:51:20Z | `789a6bab5` | reset the D settle clock |
| 03:02:53Z | `85e68247c` | ⚠️ **landed 20 s before the clock ran out**, resetting it again |

⛔ **Every one was handled by the standing rule** — wait for SUCCESS, re-verify the reader
path byte-identical with a non-vacuity count, then proceed. The pre-serialised change was
confirmed still live in each deployed commit (`baffee6cf` an ancestor of `85e68247c`;
`routers/breadth_monitor.py` and `breadth_timing.py` IDENTICAL; 71 other files changed as
the control).

⭐ **This is worth recording as an operational fact, not an excuse.** A settled-window
measurement requires ten clear minutes of the shared pod, and on a day when another
workstream is pushing every ~10 minutes, that window may simply not exist. The
promoted-branch gate serialises *correctness*; it does not reserve *quiet*.

## What IS on the record: one smoke request, labelled

⛔ **Unsettled. n=1. Not a measurement, and not comparable to §B.5's before-band.**

| days=7600 | wall | `total_ms` | `serialise` | `encode_render` |
|---|---|---|---|---|
| cold | 673.2 | 439.8 | 96.5 | 51.0 |
| **warm** | 291.4 | **72.2** | **absent** | 57.9 |

Bodies byte-identical between the two reads. It shows the **mechanism** behaving as
designed in production — `serialise` present on a cold read, `absent` (not 0.0) on a warm
one, which is the saving. It is not a performance result.

## What Session 8 must do instead

Re-run the identical window — same sets, same n, same cadence — on a pod that has been
quiet for ten minutes. The BEFORE band in §B.5 stands unchanged and is still the only thing
an after-window may be compared to.

---

# E. Workstream E — the gate, observed

## E.1 — does the workflow create `production`?

**No, by explicit design.** From the workflow on master:

> `Does 'production' exist on origin?` → `git ls-remote --exit-code --heads origin production`
> → when absent: `::notice title=Nothing promoted::origin/production does not exist yet — the
> gate ran and passed, but there is no branch to advance.`

and in its header: *"Creating `production` is an owner step, on purpose: a workflow that
creates the branch it deploys from could point production at [the wrong thing]."*

Per E.1's instruction, `production` was therefore created **by hand as an exact copy of
master**: **`7ac0e0aeef0ad993584c4eff0267e566eb49c386`**.

## E.2 — the observation log

| merge | master SHA | gate start → finish | promotion start → finish | production after |
|---|---|---|---|---|
| **M1** docs/session6-record | `a6cfa511d` | 23:26:08 → 23:28:17 | *(gate not yet on master)* | — |
| **M2** phase-instrument | `5ea008844` | 23:32:59 → 23:35:07 | *(gate not yet on master)* | — |
| **M3** deploy-gate-v2 | `57e5131a3` | 00:22:28 → **00:24:39** | **00:24:41** → 00:25:05 | *(absent — "Nothing promoted")* |
| **M4** preserialised | `baffee6cf` | 02:42:38 → **02:44:54** | **02:44:56** → 02:45:20 | **`baffee6cf`** ✅ |

⭐ **The promotion starts 2 seconds AFTER the gating check completes, on both runs.**
Compare Wait-for-CI, which started eight consecutive deploys **99–141 s BEFORE** their
checks finished. The mechanism does what the toggle did not, and the evidence is a
timestamp on a durable branch rather than a claim.

**Checks that gated vs advised on M4:** `master deploy gate` (🔒 gate, 2m16s), `wisdom
rails` (🔒 gate, 36 s), `flow-worker deploy coverage` (📋 advisory, 21 s, exits 0).
`production` fast-forwarded `7ac0e0aee → baffee6cf`, verified an ancestor of master —
never forced.

## ⚠️ Intrusions during this session — four of them

| when | commit(s) | reader path re-verified? |
|---|---|---|
| 23:15Z | `3fa362e46` (+2) | ✅ 5 files IDENTICAL, 16 changed as control |
| 23:54Z | `8e6f892a7` | ✅ 5 files IDENTICAL, 17 changed — **this one restarted the pod mid-window** |
| 00:25Z | `e8f7c72a0` (+6) | ✅ 5 files IDENTICAL, 28 changed |
| 02:2xZ | chart-settings series | ✅ covered by the same check |

⛔ **Every one was handled by the stated rule** — wait for SUCCESS, re-verify byte-identity
with a non-vacuity count, then proceed. None of them changed a reader-path file.

## E.3 — the unverified step, and what this session settled of it

**Partly answered for free.** M4's promotion pushed `production` with the workflow's
`GITHUB_TOKEN` and **the branch moved** — so the *push* works and needs no deploy key. What
remains unknown is whether that push **triggers a Railway build**, which cannot be observed
while Railway watches `master`.

**Cheapest safe verification, proposed (design only — it needs the dashboard):**

| option | cost | blast radius | what confirms it |
|---|---|---|---|
| **(a) throwaway Railway service** in the same project, watching `production`, no domain, no volume, no env vars, deleted after | one service-hour | ⭐ **zero** — no domain, no volume, nothing points at it; it cannot serve a member | a deployment appears on it for the next promotion → confirmed. None within ~5 min → refuted |
| (b) Railway's webhook delivery log, if the GitHub App exposes one | free | zero | a delivery recorded for the `production` ref |
| (c) flip `web` to `production` and watch | free | ⛔ **that IS the cutover** | — not a test |

⚠️ **Creating a service requires the Railway dashboard — the CLI cannot create one.** So
(a) is **design only** this session and is 👑. (b) should be looked at first because it is
free and needs no new resource.

## E.4 — cutover checklist, re-emitted cleanly

| # | step | owner | needs a browser / org-admin? |
|---|---|---|---|
| 1 | ~~create `production` on origin~~ | — | ✅ **DONE** this session — `7ac0e0aee`, now `baffee6cf` |
| 2 | branch protection on `production`: block force-push and delete; **no PR requirement** (it breaks the fast-forward push); restrict pushes to the Actions app | 👑 | **browser + org-admin** |
| 3 | allow the Actions token through that protection | 👑 | **browser + org-admin** |
| 4 | add `RAILWAY_TOKEN` as a repo secret (for the deploy wait) | 👑 | **browser** |
| 5 | verify a `GITHUB_TOKEN` push to `production` triggers a Railway build (E.3) | me, after 👑 creates the probe service | **browser to create the service** |
| 6 | Railway `web`: watched branch `master` → `production` | 👑 | **browser** |
| 7 | Railway `web`: Wait-for-CI **OFF** | 👑 | **browser** |

**Rollback of the cutover:** point Railway's watched branch back to `master`. Nothing else
— the workflow promoting to an unwatched branch is inert.

**Rollback of a bad commit:** revert on master, promoted forward —
`git revert --no-edit <bad-sha>` then `git push origin HEAD:master`. ⛔ A manual reset of
`production` is silently undone by the next fast-forward.

---

# F. Record

| item | where | status |
|---|---|---|
| F.1 heading normalisation (Q2) | `DECISIONS.md` — 46 entries at `###`, 0 at `##`; D-045's sub-headings demoted to `####` | ✅ merged in M1 |
| F.2 cap closure (Q4) | **D-046** — the n=20 numbers, the CI, and the UI-maximum argument | ✅ merged in M1 |
| F.3 Session 7 write-up | `00-profile.md` | ✅ committed |
| F.4 false-instrument appendix | five more entries, incl. control (c)'s own threshold | ✅ committed |
| F.5 fragments re-emitted | below | ✅ |

⚠️ **A declared deviation:** the prompt puts F.2 at step 9, after all four merges. I wrote
it at step 2 so it could ride M1 — M1 was the only authorised vehicle for a `DECISIONS.md`
change this session, and F.2 would otherwise have sat unmerged. Same file, same branch,
same gate.

## F.5 — re-emitted fragments

### The Session 6 W2 stats table, in full

| deep, n=20 | min | p50 | p90 | p95 | max | mean | sd |
|---|---|---|---|---|---|---|---|
| client wall | 796.2 | 980.8 | 1,560.2 | 1,749.7 | 1,897.7 | 1,105.0 | 316.7 |
| server `total_ms` | 526.9 | 696.3 | 1,224.5 | 1,429.0 | 1,496.4 | 785.0 | 281.2 |
| `reader_ms` | 144.2 | 209.7 | 631.8 | 998.8 | 1,000.4 | 316.7 | 258.2 |
| `post_reader_ms` | 377.6 | 433.0 | 549.1 | 581.5 | 742.1 | 468.3 | 89.4 |

| shallow, n=5 | min | p50 | p95 | max | mean | sd |
|---|---|---|---|---|---|---|
| client wall | 258.8 | 301.4 | 603.3 | 675.2 | 366.1 | 174.2 |
| `reader_ms` | 90.9 | 101.6 | 373.9 | 434.6 | 169.9 | 148.9 |
| `post_reader_ms` | 24.0 | 27.2 | 52.2 | 58.2 | 32.6 | 14.4 |

95 % CI for the true p95 of client wall: **[1,540.0 ms, 1,897.7 ms]**.

### The Session 6 W1 controls table

| control | requirement | `normal` | `expensive` |
|---|---|---|---|
| (a) | every phase > 0 on a deep `cache=miss`; none absent | PASS — 0 absent, 0 zero | PASS |
| (b) | sums within 10 % of `reader_ms` and `post_reader_ms`, residual explained | PASS — reader 97.0 % (7.5 ms), post 99.5 % (3.0 ms) | PASS — reader 99.9 % (2.9 ms), post 98.5 % (1.8 ms) |
| (c) | cache hit: reader cheap, post-reader non-trivial | PASS — reader 0.0 with all nine absent, post 586.8 | PASS — 0.0 / 72.4 |

### Session 6 open question 5, in full

> **Q5 — `--gate-audit` (4.6). Build the CONFIRMED-ungated detector, or let Workstream 4
> obsolete it?**
> - **(a) Let W4 obsolete it** *(recommended)* — `production`'s git log answers it with no
>   GitHub API.
> - (b) Build it anyway as a transitional check, once G-2 lands.

**Settled as DEFERRED (Q5, Session 7 §0) — do not build.** ⭐ And this session produced the
evidence that (a) was right: `production`'s log now carries the promotion, and the gate/
promotion timestamps in §E.2 answer "was this deploy gated" with no GitHub API call at all.

### The cutover checklist

See §E.4 above — re-emitted there in full, with owner and browser/org-admin marked per step.

---

# OPEN QUESTIONS FOR YOU

**Q1 — cache the GZIPPED bytes too?** Warm days=8000 would go from ~62 ms to ~1 ms, because
GZip is all that is left in `encode_render`.
- **(a) No, not yet** *(recommended)* — the route would have to own `Content-Encoding`, and
  a client sending `Accept-Encoding: identity` must still get plain JSON. That is a second
  cache entry and a correctness surface, for ~60 ms on a path that is already 8× faster.
- (b) Yes, behind the same byte-identity gate, with an identity-encoding rail.

**Q2 — orjson?** Byte-identical on all three spans, 2.6× faster again, already a declared
dependency — but it emits `null` for NaN/±Inf where the route now raises.
- **(a) No** *(recommended)* — the divergence is silent and turns a 500 into a wrong number.
- (b) Yes, and accept the NaN→null semantics as an improvement, documented in DECISIONS.
- (c) Yes, but only with an explicit finite-check before serialising.

**Q3 — `reconstructed_fetch` is now the top cost and the whole volatility (50.2× vs
`derive`'s 1.0×). What next?**
- **(a) Profile the SQLite read itself** *(recommended)* — page cache, index use, row size,
  and whether the Railway volume's latency is the floor.
- (b) Cache `reconstructed_for_dates` results separately (the rows change only when the
  builder runs).
- (c) Leave it — the pre-serialised response already moved the member-visible number.

**Q4 — the GZip level.** You asked for the table to decide from; it is in §C.5. Level 5 is
production today.
- **(a) Keep level 5** *(recommended)* — level 6 costs +41.7 ms for −2.0 %; level 9 costs
  +86.7 ms for −13.4 %.
- (b) Move to 9 and accept +86.7 ms per deep request for 89 KB less on the wire.
- (c) Correct the in-code comment only (it claims "<3%", measured −13.4 %).

**Q5 — E.3's probe service.** Creating a Railway service needs the dashboard.
- **(a) Check Railway's webhook delivery log first** *(recommended)* — free, zero blast
  radius, may answer it outright.
- (b) Create the throwaway service (👑), confirm, delete.
- (c) Defer until you are ready to cut over anyway.

**Q6 — `docs/session7-record` is committed but not pushed.** Same question as last session.
- **(a) Push and merge via the gate** *(recommended)*.
- (b) Hold it for Session 8.

---

# PROPOSED SESSION 8

Take `reconstructed_fetch` — it is now both the largest reader phase and the entire source
of the 20× volatility, and `derive`'s flatness has already ruled out CPU, so the question
is narrow and answerable: **is the Railway volume's read latency the floor, or is the query
doing more work than it needs to?** Profile the SQLite read directly (page cache, index
use, row size, and a controlled comparison against the same query on a local copy of the
same file), then decide between a separate cache for `reconstructed_for_dates` and a
storage-shape change — measured, one heavy lane at a time, as before. Alongside it, close
E.3 the cheap way (Railway's webhook log) so the cutover checklist has no unverified step
left, and re-run the n≈20 window once more to give the pre-serialised response a settled
production band of its own rather than a single window's worth.
