# Breadth History Reader — Session 11 report

**Origin:** D-042 measured `/api/breadth-monitor?days=8000` at **54,923 ms cold**. Session 9
measured the H1 fix at ×9.05 on the tail and turned it on; Session 10 proved the deploy
gate's queue serialises and priced p95 at n ≥ 59. Session 11 makes the measurement
**unattended** and builds the next reader fix **dark**.

**OWNER INPUT was not filled in** — all three lines were still bracket placeholders — so
**Workstream C (post-cutover verification) is skipped**, and C.1's stop condition is
independently confirmed below: Railway still deploys from `master`.

**No measurement windows** (0.1). Every number is from Session 9's two windows, a tool run
today, or a table in this report.

**Published page:** *(URL at the end)*

---

## THE HEADLINE

| | |
|---|---|
| **M11 merged** | `4a0995a52` — after the pre-push guard **refused it twice** |
| **M12 / M13 built, gated, HELD** | both branches pushed; the morning push window closed at 09:25 ET before either was ready |
| **The sampler runs unattended** | four refusals in code, **two of which fired for real** during the dry run |
| **The hot path is 8 files, not 169** | measured by execution — and that is what makes pooling survive 31 commits in a day |
| **One control caught three wrong cache designs** | and every other rail stayed green against all three |

---

## A. State check

### A.1 Where everything is

| | |
|---|---|
| `origin/master` at session start | `cb0949d8c` → **31 commits**, all discord-render, then M11 |
| master after M11 | `4a0995a52` (and moving — `569485a12`, `34904394e`, `86ee22800` landed during the session) |
| production deploy | SUCCESS, **`meta.branch = master`** — ⛔ C.1's stop condition: the cutover has not happened |
| `breadth/sampler` | pushed, **unmerged** (M12 held) |
| `breadth/resident-recon` | pushed, **unmerged** (M13 held) |
| `breadth/fetch-shape` | `7a79cc9d3` — SHELVED (D-050) |

**Reader-path byte identity across those 31 commits: IDENTICAL.** All 8 hot-path files carry
the same blob SHA at `30fd58aef` and at master. **Non-vacuity:** the same comparison sees the
4 `api/` files those commits *did* change — `discord_interactions.py`,
`discord_render/{commands,jobs_store,runtime}.py` — none of them hot.

**Flag ON confirmed from the instrument**, not the variable list: `days=7330`, forced miss →
`rf_pagecache = 1.0`, `rf_rows = 4529`, `rf_bytes = 4,523,328`, `rf_stmts = 12`.

### A.2 Session 10's open questions

| # | recommendation | class |
|---|---|---|
| 1 Wait-for-CI enabled? | **still open** — one dashboard reading, no CLI can see it | **needs the owner** |
| 2 Does a `GITHUB_TOKEN` push to `production` build? | **still open** — G-3, the only cutover blocker | **needs the owner** |
| 3 P-B4 warm control | **adopted** — the sampler takes a warm `days=365` read every 10th sample, flag-tagged, so the interleaved comparison accumulates without a window | adopted |
| 4 which half of the flag wins | **leave coupled** — nothing depends on it | adopted |
| 5 memory unmeasured | **fold into the sampler** rather than run a window for it | adopted |
| 6 quiet hour | **still open**, and now priced: n ≥ 59 | **needs the owner** |
| 7 why 11 of 20 need zero extra syscalls | **still open** — the eviction trigger | open |

### A.3(a) What is left in the deep-cold budget — ranked

Composition of three flag-ON samples (Session 9's window B):

| phase | p50 (281.7 ms) | p90 (986.2 ms) | flat? |
|---|---|---|---|
| **`reconstructed_fetch`** | **62.3** | **671.8 (68%)** | no — this *is* the tail |
| — `rf_fetch` | 8.5 | **607.1** | no |
| — `rf_materialise` | 50.8 | 54.4 | **yes** |
| `derive` | 76.1 | 80.7 | yes |
| `serialise` | 66.5 | 73.7 | yes |
| `encode_render` | 49.7 | 47.6 | yes |
| `numeric_fetch` | 6.2 | 55.5 | no |

**Ranked, and the resident copy IS the top candidate:**

1. **`rf_fetch`** — 8.5 ms at p50, **607.1 ms at p90**. The only phase that moves with the
   tail. The resident copy removes it entirely. ⭐ **Nothing else on the list is worth
   doing first, because nothing else is more than ~80 ms at p90.**
2. `rf_materialise` (48.0 p50, flat) — removable only at 5.06× wire; see D.
3. `derive` (70.5 p50, flat, range 63.5–90.8) — pure CPU, a floor item.
4. `serialise` (63.3) and `encode_render` (46.4) — already reduced ×8.5 by M4.

**The floor no I/O fix can reach: ~235 ms at p50** (measured phase medians), against an
observed minimum total of 243.0 ms.

### A.3(b) H3 vs H5 — closed

| arm | extra read syscalls | `rf_fetch` | **ms per syscall** |
|---|---|---|---|
| OFF | 8,883 | 5,304.1 | **0.597** |
| OFF | 14,800 | 8,742.7 | **0.591** |
| ON | 551 | 452.8 | **0.822** |
| ON | 642 | 879.2 | **1.369** |

⭐ **The per-operation cost got *worse*; the count fell ~20×.** That is H5's model exactly —
time = seek count × per-seek latency — with the flag attacking the first term only.
**H5 is closed.** ⚠️ Unexplained residual: 11 of 20 settled cold reads need **zero** extra
syscalls and the rest need 551–642.

### A.4 Tagging a sample with the deployed SHA

⛔ **`/api/health` does not expose it** (keys: `status`, `wire_date`, `uptime_seconds`,
`thread_count`, `rss_mb`) **and M12 cannot add it**: the endpoint lives at
`api/main.py:7940`, and `api/main.py` **is on the measured hot path**, which M12's own gate
forbids touching.

**Chosen:** the sampler resolves the SHA **locally** from `railway deployment list --json`
— it runs on this box beside the linked worktree — cached, and re-resolved only when the
pod's uptime goes backwards (a new boot) or after an hour.

**Noted and not chosen:** `GET /api/discord/render-health` already returns
`commit: RAILWAY_GIT_COMMIT_SHA[:12]`, PUSH_SECRET-gated. Zero code change — but it belongs
to another programme and would couple this sampler to their endpoint's stability.

---

## B. The sampler

### B.1 The refusals, which are the product

⛔⛔ **Sampler load is production load.** Five refusals, each a rail, each driven in **both**
directions — a test that only checks "it refused" passes against a sampler that refuses
everything forever, which is the failure that looks like safety and produces no data.

| refusal | why |
|---|---|
| inside 09:25–16:05 ET | the push-guard window; a deep read costs the single uvicorn process real work |
| `uptime < 600` | Session 7 measured 17,480 ms three minutes after boot against 224 ms settled |
| daily cap 60 | a runaway loop is a self-inflicted load test |
| kill-switch file | one file, removable by anyone, no deploy |
| `uptime_unknown` | ⛔ a failed health probe must not read as a settled pod |

⛔ **The clock comes from `zoneinfo`, never `TZ=` or local time.** Measured today:
`TZ=America/New_York date` in Git Bash returned **12:38** while UTC was also 12:38 — the box
is on **Central**, and `TZ=` did not apply. The real answer was **08:41 ET**. The push guard
and this refusal window both hang off that clock.

### B.2 Poolability — enforced in the report, not assumed

Two samples pool only when **every hot-path file's blob is identical** between their SHAs
**and** every pooled flag matches (`rf_pagecache`, and `rf_resident` once D ships).

⭐ **The hot path is measured by EXECUTION: 8 files, not the 169 the import closure
reaches.** That choice is load-bearing — 31 commits landed on master today and the pool
survived all of them; on the import set it would have shattered continuously and never
reached n = 59.

```
api/main.py                          api/services/breadth_daily_ohlc.py
api/middleware/admin_guard.py        api/services/breadth_monitor.py
api/routers/breadth_monitor.py       api/services/breadth_timing.py
api/services/cache.py                api/services/single_flight.py
```

⚠️ **Stated limit:** measured with `require_paid` overridden, so the auth chain is excluded.
Auth runs before the handler's own timer, so it cannot move the Server-Timing phases — it
can move client-side `wall_ms`.

⛔ The pool-split discriminator is **derived**, not an offset: ask git which commit last
touched a hot file and compare it with its own parent. A first version used `30fd58aef~1`
and silently compared the rename against its own sibling, proving nothing.

### B.5 The dry run — three attempts, two samples, one real refusal

```json
{"ts_utc":"2026-09-15T13:06:15Z","sha":"4a0995a52","uptime_s":674,"kind":"deep_cold",
 "span":7299,"status":200,"ok":true,"wall_ms":3909.4,"wire_bytes":681974}
   timing: total 3599.7  reader 3258.9  reconstructed_fetch 2748.8  rf_fetch 2650.0
           rf_materialise 76.3  encode_render 62.4  rf_pagecache 1.0  io_syscr 73487

{"ts_utc":"2026-09-15T13:06:51Z","sha":"4a0995a52","uptime_s":730,"kind":"deep_cold",
 "span":7298,"status":200,"ok":true,"wall_ms":582.7,"wire_bytes":681974}
   timing: total 351.4  reader 204.3  reconstructed_fetch 80.2  rf_fetch 12.8
           rf_materialise 57.4  encode_render 49.4  rf_pagecache 1.0  io_syscr 1020

{"ts_utc":"2026-09-15T13:07:26Z","uptime_s":null,"ok":false,"refused":"uptime_unknown"}
```

⭐ **The third line is the point.** Another workstream's deploy swapped the pod mid-run,
`/api/health` 502'd, and the sampler **refused rather than sampling a swapping pod** — the
control firing in production, not in a fixture.

And the report script on those samples:

```
POOL 1   n=2   flags {'rf_pagecache': 1.0}
  SHAs pooled (1, hot path byte-identical): 4a0995a52
              total_ms  n=2  min=351.4  p50=1975.5  p95=3437.3  max=3599.7  sd=2296.9
  P(true p95 lies ABOVE the worst read seen) = 0.95^2 = 0.902
  ⛔ p95 NOT estimable: n=2, need 59 (57 more on this pool)
```

### B.6 The header is sufficient — no log dependency

`Server-Timing` carries **32 fields**, including every phase the windows used (`post_reader`
is `post` there). **`gzip_send` is the sole exception and is structurally unavailable:** it
is measured at `http.response.start`, after its own response's header exists.

### ⛔ Where the pool file lives, and how to read it

`logs/breadth-samples.jsonl` — **gitignored** (`/logs/`), so it never churns the repo and
never reaches GitHub. One JSON object per line; failures and refusals are rows too.

**To read it:** `python tools/breadth_sampler_report.py` prints a one-screen summary.
⚠️ **It is not readable from a phone today** — it is a local file on this box. If phone
access matters, the cheapest option is for a session to publish the report output as a
private page; that is an OPEN QUESTION rather than something built on assumption.

---

## C. Post-cutover verification — **skipped**

OWNER INPUT was not filled in, and Railway's deployment list independently confirms the
stop condition: every deploy still carries `meta.branch = master`. Nothing was pushed for C.

---

## D. The resident copy — built dark

`BREADTH_RESIDENT_RECON_ENABLED`, default OFF, set on no service, ledger row from birth.

### D.1 Design

- **Held:** `{date: metrics JSON STRING}`, module-level, one per process.
- **Built:** lazily, on first use. ⭐ It costs **nothing** at boot, and the first request
  pays **46 ms** instead of the ~62 ms `reconstructed_fetch` it replaces — so it is cheaper
  than the fetch even on the very first call.
- **Writer:** `build_reconstructed()` (`breadth_daily_ohlc.py:425`), via `_rebuild_after_write`
  and `rebuild_stale`; `purge_reconstructed` deletes.
- **Invalidated:** `PRAGMA data_version` on a **long-lived probe connection**.

### D.2/D.3 ⛔ The two requirements conflict, and the measurement decides

| resident form | bytes | vs wire | D.3 bound (≤2×) | removes |
|---|---|---|---|---|
| **JSON strings** | **5,214,625** | **1.15×** | **PASSES** | `rf_fetch` |
| parsed dicts | 22,909,972 | 5.06× | **FAILS** | `rf_fetch` + `rf_materialise` |

The parse **is** `rf_materialise` (44.9 ms full-table vs 48.0 measured). ⭐ At p90 the split
is `rf_fetch` **607.1 ms** against `rf_materialise` **54.4 ms**, so the strings capture
**~90% of the tail win for 23% of the memory**. Lifting the bound is an OPEN QUESTION.

**Resulting floor with the flag ON:** p50 ~219 ms, p90 ~314 ms (from A.3's composition).

### D.4 ⛔⛔ The stale-read control caught three wrong designs

| # | design | why it was wrong |
|---|---|---|
| 1 | `data_version` on a **per-call** connection | measured: a fresh connection returned **2, 2, 2** across two external writes while a long-lived one returned **2, 3, 4** |
| 2 | `COUNT+3×MAX` signature alone | `built_at` has **second** resolution |
| 3 | two-stage, signature as authority | "version moved, signature unchanged ⇒ another table" — but the signature cannot **prove** this table didn't change |

⭐⭐ **A cheap check may only ever say "definitely nothing changed". The moment it says
"something changed", the expensive answer must be the rebuild — not a second guess.**

**Shipped:** `data_version` alone, long-lived probe connection. Unchanged ⇒ exact (the
pragma cannot miss a commit). Changed *or unknown* ⇒ rebuild.

### D.5 Gate and LOCAL numbers

**Parity EXACT three ways** — golden(master) / flag OFF / flag ON, all `sha256 7695923c…`
over **5,576,278 bytes** across 90/365/8000. 483 breadth + 198 ledger tests green.

**LOCAL warm, n=7: 84.6 → 66.9 ms (×1.26)**, build 11.2 ms. ⚠️ **LOCAL and WARM** — warm is
where this change matters least, and the tail it targets cannot be produced on this box.

⛔ **Flipping it starts a NEW sampler pool**, because `rf_resident` is a pooled flag.

---

## KEYBOARD STEPS FOR THE OWNER

1. **Read one toggle** — Railway → `web` → Settings → Source. Is **Wait for CI** ON or OFF?
   *Record it before changing anything.* No CLI can see this. *(carried from Session 10)*
2. **The C.2.i probe** — runbook §C.2.i. ⛔ **Stop if inherited shared variables cannot be
   removed**: a booted second copy can take `MASSIVE_API_KEY` and knock flow-worker off a
   tape that does not replay. *(carried from Session 10)*
3. **Authorise the two held merges, or leave them for the next window.** Both are gated and
   pushed: `breadth/sampler` (M12) and `breadth/resident-recon` (M13). They need a push
   window outside 09:25–16:05 ET, ≥300 s apart, each to SUCCESS.
4. **Decide the quiet hour, or decline.** Without it the sampler is the *only* route to
   n ≥ 59, and it is throttled to 60 samples/day outside RTH.

---

## OPEN QUESTIONS

1. ⚠️ **Wait-for-CI, and G-3** — unchanged from Session 10, still the cutover blockers.
2. ⚠️ **Flip the resident copy?** Decided on sampler data. Flipping starts a new pool.
3. ⚠️ **Raise the 2× memory bound to 5.06× to also remove `rf_materialise`?** That buys a
   flat ~48 ms at p50 and ~54 ms at p90 — real, but the tail is already 90% covered.
4. ⚠️ **Sampler cap (60/day) and cadence (≥35 s)** — proposed, not owner-set. At 60/day
   outside RTH, one pool reaches n = 59 in **one clean day** if no hot-path commit lands.
5. ⚠️ **The pool file is not phone-readable.** Local and gitignored by design.
6. ⚠️ **Why do 11 of 20 settled cold reads need zero extra syscalls?** Eviction trigger
   unidentified.
7. ⚠️ **Nothing member-visible changed this session.** M13 is dark; M12 is a tool.

---

## PROPOSED SESSION 12

1. **Push M12 and M13** in the first available window, then **S1** (Task Scheduler), then
   let the sampler run unattended for a day.
2. **Read the first real pool** — if n ≥ 59 on one SHA set and flag state, p95 reopens under
   0.1 and the 1 s bar gets an answer instead of a confidence interval.
3. **Do not build anything new until the pool reports.** The resident copy's flip is the
   next decision and it is a *measurement* decision.
4. **If the owner's keyboard steps come back**, the cutover is one sitting (runbook §C.3).
