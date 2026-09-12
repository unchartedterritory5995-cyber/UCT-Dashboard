# Deploy notes — flow-worker weekend bundle (branch `perf/flow-date-scan`)

`api/flow_db.py` is on flow-worker's watch list, so this deploy RESTARTS the OPRA
consumer and gaps the tape permanently until the T+1 flat file. **After-hours or
weekend only.** (The Mon–Fri push freeze is rescinded — see CLAUDE.md, 2026-09-11.
The tape gap is a physical constraint, not the rescinded policy.)

Ship as part of a bundle; do not spend a tape gap on this alone.

## Checklist

- [ ] `railway variables --service flow-worker --set "FLOW_FAST_DATE_SCAN=1"`
- [ ] Verify a NEW BOOT (startup line stamped after the `--set`), not the CLI echo.
      `--kv` shows the service's config, not the running process's env.
- [ ] Confirm in-process: `os.environ.get("FLOW_FAST_DATE_SCAN")` over `railway ssh`.
- [ ] **Measure the roll-level effect from the ledger, not from a projection.**
      Read `rolls_steady[]` at `/api/flow/aggregate-health` and compare `prepare_ms`
      against the pre-flag baseline recorded 2026-09-11:

          prepare_ms   min 5,204  p50 6,199  max 9,228  mean 6,544   (n=25, flag OFF)

      Projected with the flag on: p50 ≈ 4,800 ms. **Projected, never measured** — the
      1.3461 s → 0.0050 s figure is measured on prod data directly, but its effect on
      a whole roll is arithmetic until this row is filled in.
      Measured p50 with flag ON: ______  (n=____, date ______)
- [ ] Exclude `rolls_startup[]`; a generation predating the process is
      `startup_catchup`, not a roll.
- [ ] Rollback: unset the var. It is a RUNTIME var on flow-worker (not a Vite
      build-time var), so unsetting + restart is sufficient — no rebuild needed.


---

# Bundle contents — ONE redeploy, ONE tape gap

| # | component | commit | ships as | rollback |
|---|---|---|---|---|
| 1 | date-scan (`_resolve_dates` loose index scan) | `535311c80` | code + **flag OFF** | unset `FLOW_FAST_DATE_SCAN` (no rebuild) |
| 2 | parts guard: "what was REQUESTED" | `f65e5ab67` | code, **always on** | `git revert f65e5ab67` |
| 3 | roll-ledger slot attribution | `7981a46c6` | code, **always on** | `git revert 7981a46c6` |
| 4 | `ORDER BY CreatedDate, id` (uncapped stream) | `47dccfd8b` | code, always on | `git revert 47dccfd8b` |

Components 2 and 3 are independently revertable and touch disjoint files
(`api/services/flow_aggregate.py` vs `api/flow_router.py`). Component 1 is a flag,
so it needs no revert to disable.

## Why this deploy is worth a tape gap
Component 2 is not an optimisation — it restores one that has never worked.
Measured on prod 2026-09-11: the preparer's pass 2 discarded **18,971,776 bytes of
nine valid frames every roll**, so the deferred `TICKER_DB`/`CONV` split and the 3b
raw fallback were never pre-warmed and the first member interaction after each
version roll paid a full ~5.8 s build. No member saw an error, which is why it ran
for 889 rolls unnoticed.

## Post-deploy verification (component 2)
- [ ] `/api/flow/aggregate-health` → `parts.entries` grows beyond
      `['bootstrap','TOP_PICKS']` to **10 entries** (bootstrap, TOP_PICKS,
      all_trades, all_directional, WATCH, ALL_SYMS, UOA_TRADES, darkPool,
      TICKER_DB, CONV). Cap is 24, so no eviction pressure.
- [ ] `build_failures` **stops incrementing** on each prepared roll. Sample the
      counter twice across ≥2 rolls; the pre-fix ratio was 885 failures per 889
      prepared.
- [ ] `parts_rejected_missing` stays **0**. A non-zero value means a stream really
      is short a requested part — a different bug, and now a visible one.
- [ ] Confirm no OTHER counter changed meaning: `prepare.failed` still means
      "pass 1 raised" and was deliberately not widened.

## Post-deploy verification (component 3)
- [ ] `rolls_steady[]` entries carry `blocked_by` / `blocked_pass` /
      `blocked_held_ms`. Expect **null on most rolls** — 22 of 25 were unblocked
      pre-fix; a field populated on every roll would mean the snapshot is being
      read at the wrong moment.
- [ ] Collect a full RTH session Monday, then test the standing hypothesis: the
      4.4 / 8.2 / **15.2 s** handoff outliers are pass-2 lock hold plus something
      else. One tick was ~11.7 s (pass 1 ~6.2 s + pass 2 ~5.5 s), so ~3.5 s of the
      15.2 s roll is unexplained. `blocked_by` should name it — or show the slot
      was free, which kills the hypothesis outright.

## ⛔ Deploy window
`api/flow_db.py`, `api/flow_router.py` and `api/flow_worker_main.py` are all on
flow-worker's watch list, so this redeploys flow-worker and **gaps the OPRA tape
permanently until the T+1 flat file**. After-hours or weekend only. Separately,
the standing rule is **no master push of any kind Mon–Fri 09:00–16:00 ET**, docs
included — a master push redeploys web, worker, bars-api and flow-worker in
lockstep. (A CLAUDE.md line claims that window is rescinded; the owner has stated
it is wrong and will reconcile it. Treat the freeze as in force.)


---

# Component 4 — `ORDER BY CreatedDate, id` (owner-approved 2026-09-11)

## ⚠️ DECLARE THIS ONE-TIME SHIFT

Pinning the order changes which prints survive `tk.topTrades`' bounded reservoir.
Measured on the full 9/11/2026 session (94,931 rows, stocks, days=1):

| artifact | change |
|---|---|
| **SNDK bull premium `b`** | **39,337,073 → 38,700,216 (−636,857, −1.62%)** ← the one to explain |
| SNDK bear premium `r` | 41,624,783 → 41,245,393 (−379,390, −0.91%) |
| SNDK trade count `n` | 2,677 → 2,671 |
| DELL bull premium `b` | 24,163,137 → 24,173,737 (+10,600, +0.04%) |
| AAPL trade count `n` | 297 → 298 |
| `adCount` stocks\|All | 10,042 → 10,037 (−5, −0.05%) |
| `adCount` stocks\|Large | 7,124 → 7,119 (−5, −0.07%) |
| CONV | **AAPL 9/18 $335P enters at rank 198** (prem 709,975); 0 removed; 540 rows displace by exactly 1; AAPL `tickerHeat` 10 → 11 contracts, totalPrem +709,975 (+6.2%) |

**TOP_PICKS: zero rank changes and zero membership changes across all 8 variants.**
Only `adCount` moves. The member-visible TOP 10 table is unchanged.

Only 3 of 1,061 TICKER_DB symbols move at all. **SNDK −1.62% is the only change
large enough to need explaining to a member.**

## Scope: the UNCAPPED path only
`days >= FLOW_CSV_CAP_DAYS` (20) and all-data already carry
`ORDER BY CAST(Premium AS REAL) DESC LIMIT ?`, which IS their defined order — the
capped branch is untouched. So this affects days=1 and days=5 (and calendar picks
narrower than the cap). Cost there: **88 → 78 ms** at days=1, **556 → 610 ms** at
days=5. No `TEMP B-TREE` in any plan; `(CreatedDate, id)` is
`idx_flow_source_date_id`'s own key order.

⚠️ An earlier note implied days=20 would get faster under this change. It will
not — days=20 is capped and never reaches this branch.

⚠️ The capped path's `ORDER BY Premium DESC` still has an undefined TIE order.
Pre-existing, out of scope, and recorded here so it is not mistaken for fixed.

## ⛔ Instrument error to not repeat
The first CONV diff reported APPEARED=12 / DISAPPEARED=11. That was the
instrument: the identity key was DERIVED from "every non-measure field", which
swept in `tickerHeat` — itself an order-dependent aggregate. AAPL's heat changed,
so all of AAPL's rows matched nothing and counted as both new and gone at the same
rank. The real answer (1 appeared, 0 disappeared) needs an EXPLICIT contract key:
`(sym, exp, strike, cp, side, DTE, K)`. **A derived identity key silently includes
whatever the thing you are measuring also changes.**

## Correction for Monday's handoff reading
`_PREPARE_POLL_S` is **2 s**, not the 5 s quoted in earlier notes. One preparer
tick is ~11.7 s (pass 1 ~6.2 s + pass 2 ~5.5 s), so read `blocked_held_ms` against
a ~12 s tick plus up to 2 s of poll — not 5.

---

# ✅ MERGED AND VERIFIED — 2026-09-12 (weekend window)

Merged to master as **`a5173fe41`** (merge commit, no force). Deploy fan-out:

    web          SUCCESS
    flow-worker  SUCCESS   <- the inert-ship gate: NOT "SKIPPED"
    worker       SUCCESS
    bars-api     SUCCESS

`FLOW_FAST_DATE_SCAN=1` set on flow-worker afterwards. ⚠️ **`--set` AUTO-REDEPLOYED
flow-worker** (a second build at 03:07:37 for the same commit) — a third data point
for the "measured BOTH ways" note, matching `web` 2026-09-09, not `chart-renderer`
2026-08-30. That cost a second tape gap in the same window, which is the argument for
setting the variable in the SAME window as the merge rather than after it.

## Non-RTH checks — all measured

| check | result |
|---|---|
| flow-worker actually redeployed | **SUCCESS**, not SKIPPED |
| `FLOW_FAST_DATE_SCAN` in the RUNNING process | **`'1'`** — read in-process over `railway ssh`, not from `--kv` |
| `_resolve_dates` on the prod pod, flag OFF | **1.4227 s** |
| `_resolve_dates` on the prod pod, flag ON | **0.0028 s cold / 0.0010 s warm** — same pod, same day, same call |
| `parts_rejected_missing` exists | **yes**, reads **0** |
| `build_failures` | **0** (was 885 across 889 prepared rolls pre-fix) |
| parts cache contents | **10 entries** — bootstrap, TOP_PICKS, ALL_SYMS, CONV, TICKER_DB, UOA_TRADES, WATCH, all_directional, all_trades, darkPool |
| `builds` per prepare cycle | **2** (pass 1 + pass 2). Pre-fix: 1 build + 1 failure |
| tracebacks / `parts stream rejected` in logs | **0 / 0** |
| web `/api/health` uptime reset | confirmed (252 s) |

⭐ **The line that proves 6a end-to-end**, which could not exist before the fix
because pass 2 always returned `None`:

    [flow-prepare] first paint warmed ('stocks', 1, 'Last1') v=39819711 in 17503ms
    [flow-agg] parts built in 5357 ms :: stdout=18444KB gzip=518ms ::
        ALL_SYMS=2KB, CONV=64KB, TICKER_DB=293KB, UOA_TRADES=1KB,
        WATCH=397KB, all_directional=482KB, all_trades=1065KB, darkPool=0KB
    [flow-prepare] remainder warmed v=39819711 in 5963ms   <- NEW

## ⛔ NOT measured — RTH-dependent, Monday

- **`prepare_ms` steady-state, and therefore the roll-level effect of the date scan.**
  `rolls_steady[]` is **0** and `rolls_startup[]` is **1**: the Saturday tape is quiet,
  so no steady-state roll has occurred. The ~6.2 s p50 baseline (n=25) still has no
  post-flag counterpart. **The component is measured (1.4227 s → 0.0028 s); the roll is
  not.** Do not quote a roll-level improvement until this row is filled.

      Measured p50 with flag ON: ______  (n=____, date ______)

- **"No new exceptions across ≥5 rolls."** Zero exceptions observed, but only ONE
  prepare cycle has run. Five rolls needs an active tape.
- Cold first paint via the browser rig · handoff attribution (`blocked_by` /
  `blocked_pass` / `blocked_held_ms`) over a full session.

⚠️ One number worth watching Monday, recorded because it is not yet explained: the
first prepare after the *bundle* boot took **110,929 ms**, while the first prepare
after the *flag* boot took **17,503 ms** (pass 1 5,005 ms + cold CSV ~12.5 s; pass 2
5,357 ms). Both are cold-boot cycles. The gap is unattributed — likely the OPRA
consumer restarting concurrently — and is not evidence about steady state either way.

---

# Cold-first-paint rig procedure (written 2026-09-12, BEFORE first use)

Written ahead of the run so it is repeatable and so its traps are known in advance
rather than discovered inside the measurement. **Not yet executed** — it needs a live
tape.

## ⛔ BLOCKER TO RESOLVE BEFORE THE RUN: there is no synthetic MEMBER account

The measurement is specified as a **member-role session, not admin**. The only
synthetic production account is `smoke@uctintelligence.internal`, and it is **admin
by construction**: `api/routers/auth.py` promotes from `ADMIN_EMAILS` at signup
(`:205-211`) and RE-promotes at login (`:253-257`), and no endpoint sets a role. So
it cannot be demoted, and every automated sign-in is an admin sign-in.

That matters because it is exactly the caveat already recorded against the bootstrap
key trace: *"measured on an ADMIN session; a plain member may render fewer regions, so
a member-only trace could reveal deferrable keys."* An admin cold paint may render
MORE than a member's and is therefore a pessimistic-but-not-equivalent number.

Three options, all owner calls:
1. Provision a second synthetic account NOT in `ADMIN_EMAILS`, via the same pod-side
   `create_user` + `comp_user_access` path the smoke account used — one production
   write, needs an explicit allow. ⛔ Door B (flipping `COMING_SOON_MODE`) stays
   permanently refused.
2. Run as the admin smoke account and **label every number "admin session"**, with the
   render-surface caveat stated beside it.
3. Skip item 8 and leave cold paint unmeasured.

**Do not silently pick (2).** An admin number presented as a member number is the
defect this runbook exists to prevent.

## Procedure

Preconditions, each asserted before measuring — an unasserted one is an INCONCLUSIVE
run, never a pass:
- **Tab VISIBLE and focused.** ⛔ A hidden tab never loads Options Flow at all:
  `shouldFetchVersion` gates on `visibilityState === 'visible'`, so dataVersion never
  resolves, ZERO `/api/flow/*` fire, and the page sits at `contentLen 244`. A hidden
  tab also clamps timers and defers render.
- Viewport PINNED (the left `NavBar` does not exist below 1025px).
- Cache cleared between runs; state the throttling profile explicitly (none / Fast 3G
  / 4x CPU) — a number without its profile is not comparable to anything.
- Opt-in/opt-out per-browser keys ABSENT, not `'0'` — a key left behind by an earlier
  run reads identically to the default today and inverts after a flip.

Record per run:
- time to **first content**, measured with a **MutationObserver**, never a timer —
  a timer is throttled and the state SEQUENCE goes wrong under load. This is the
  instrument error that once had byte reductions reported while members still saw a
  full-page spinner.
- bytes on the wire (transferSize) — ⛔ via a **streaming `PerformanceObserver`**, not
  `getEntriesByType('resource')`, which caps at 250 entries and DROPS. It once
  reported "no raw arrays fetched" during a run where they were.
- which parts came from cache vs were built (`X-Flow-Part` + the ledger's `builds`
  delta across the run).
- `X-Flow-Version` on the served parts vs `/api/flow/version` at the moment of paint —
  a mismatch means a stale-but-honest serve, which is a different reading from a
  current one.

Run **at least five times, positioned against the roll cycle**: immediately after a
version roll, mid-cycle, and just before the next roll. The post-roll run is the
worst case and is the one that decides whether decisions (a)/(b) reopen.

Then **warm re-entry** separately, and compare against UCT20 on DOM commits and bytes
— the standing claim is that warm re-entry BEATS UCT20 on both, and it should be
re-confirmed rather than assumed.

⛔ Report median AND worst case. A median alone hides the post-roll case, which is the
one a member hits after every 60 s roll during RTH.


## ✅ Rig account provisioned + dry-run results (2026-09-12, quiet tape)

### The synthetic MEMBER account
`member-smoke@uctintelligence.internal` — id `6b0e42a8-bd35-4358-833d-0ba4ef6c728a`.
Exists so cold paint is measured as a MEMBER sees it; the admin smoke account may
render more regions, so an admin number is not a member number. Monday's runs use
this account; the admin smoke account is a **labelled secondary comparison only**.

| | |
|---|---|
| role | **`member`** — verified in the DB and across **two** HTTP logins |
| plan / status | `pro` / `comped`, no Stripe ids · `paid_equiv: true` · trial inactive |
| `email_verified` | 1 — set via the app's own `create_email_verification` + `verify_email_token` |
| `/api/flow/aggregate` | **200** for `part=bootstrap` and `part=TOP_PICKS` |
| credentials | `MEMBER_SMOKE_EMAIL` / `MEMBER_SMOKE_PASSWORD` in the user environment |

⭐ **The role survives a second login, which is the whole point.** `auth.py` re-promotes
from `ADMIN_EMAILS` at EVERY login (`:253-257`), so "member at creation" proves nothing
on its own. The address is not in `ADMIN_EMAILS` (4 entries, confirmed), so it stays a
member. Re-check this if `ADMIN_EMAILS` is ever edited.

⛔ **A MEMBER DOES NOT SKIP EMAIL VERIFICATION — an admin does.** The account was
created unverified and every page load bounced to `/verify-pending`, with the
verification mail sent to a deliberately unroutable `.internal` address that can never
receive it. The admin smoke account never hit this because admins bypass the gate.
Provisioning: backup first (`/data/backups/auth-2026-09-12T040750Z-pre-member-smoke.db`,
`quick_check ok`, 27 users), then a set-difference check — `ids_added` exactly one,
`ids_removed` empty, 27 → 28.

### Dry run — the rig works end to end. **Every number below is quiet-tape, NOT a measurement.**

    first content   median 9,718 ms   worst 9,744 ms   n=3   (detected_via=mutation)
    flow wire       5,514,327 B per load
    flow requests   3: version, aggregate (no part=), data?days=1
    observer        attached=True     tab visible     role=member

⛔ **~9.3 s of that ~9.7 s is the cinematic intro**, which plays on EVERY page load and
gates content. It is excluded from the *detector* (a naive body-text threshold marked
the intro itself as first content — a flattering ~470 ms that had nothing to do with
Options Flow) but it still gates the wall clock on a DIRECT load.
⭐ **This reframes cold paint:** a direct load (bookmark, refresh, post-deploy reload)
is intro-dominated, so shaving the flow pipeline is invisible there. In-app navigation
does NOT replay the intro — that is the path the earlier 74–117 ms figures measured.
**Monday must measure BOTH and report them separately**; the rig currently does the
direct-load path only.
⚠️ Do NOT dismiss the intro with Escape. Tried: the rendered body dropped from 4,402
chars to 540 and a duplicated aggregate+data round appeared. It disturbs the app rather
than skipping an overlay.

### 🔴 OPEN, and possibly the biggest finding: the member took the LEGACY path
The three flow requests were `version`, `aggregate` **without `part=`** (whole-D), and
`data?days=1` — **the 5.5 MB raw tape**. Not `part=bootstrap` + `part=TOP_PICKS`.
All four build-time flags ARE set on web (`VITE_FLOW_PARTS=1`, `VITE_FLOW_DEFER_TAPE=1`,
`VITE_FLOW_SERVER_TOPPICKS=1`, `VITE_FLOW_SERVER_SEARCH=1`), and the parts were warm
(10 cached entries at the current version), so a cold-build fallback does not explain it.
**If members are on the whole-D + tape path, the entire first-paint optimisation is not
reaching them** — 5.5 MB instead of ~161 KB. NOT chased further tonight: characterising
it means reading the client, and it needs an RTH session to see whether it also holds
under a live tape. **Top candidate for Monday's item 11.**

### ✅ RESOLVED — it was the BUILD, not the client (2026-09-12)

`Dockerfile.web` carried **zero `ARG` declarations**. It builds the web service —
the build log says `load build definition from Dockerfile.web` — and a Docker stage
inherits nothing: Railway offers each service variable to the build as a BUILD ARG,
and an undeclared build arg is dropped without an error. So every `VITE_*` was
undefined during `npm run build`, `USE_PARTS` folded to `false`, and the whole parts
path was tree-shaken out of the bundle. Nine variables were set on `web`, eight to
the literal `1`, and **all nine were ineffective**.

⛔ **READ THE BUILD LOG, NOT THE BUILD CONFIG.** Three separate config surfaces
disagree about how `web` builds, and two of them are wrong:

| surface | says | true? |
|---|---|---|
| `railway.json` → `build.builder` | `NIXPACKS` | no — dashboard overrides it |
| Railway API → `serviceInstance.builder` | `RAILPACK` | no — a dashboard `dockerfilePath` overrides it |
| the deployment's own build log | `Dockerfile.web` | **yes** |

⚰️ This cost a live retraction: the finding was briefly walked back on the strength
of `railway.json`'s `NIXPACKS`, which would have left the defect in place. The
artifact is the authority; a builder field is a claim about a build.

⭐ **The cheapest proof that a variable does not reach a build: change it and watch
the bundle hash.** Four `VITE_*` were changed on `web` and the rebuilt entry chunk
came back **byte-identical** (`index-VW7Dk9Ft.js` before and after). A build whose
output cannot move when its inputs move is not reading those inputs.

#### Since when — a BOUND, not a date

| when | what |
|---|---|
| 2026-09-07 19:19 ET | `55359ed75` ships the parts client — commit subject says **"(flag off)"** |
| 2026-09-08 21:53 ET | `af80e0b91` replaces the nixpacks build with `Dockerfile.web`; every `VITE_*` goes dark |
| 2026-09-12 | measured on the deployed bundle; fix shipped |

**Members have been on whole-D + the full tape continuously since 2026-09-08 21:53 ET
at the latest.** Whether the parts path was ever live in the ~26 h before that is
**not recoverable**: the flag went in deliberately OFF, and the CLI exposes no
variable history.

⛔ **And the ledger cannot answer it either — `docs/feature_flags.json` contains no
`VITE_` entries at all.** It tracks the server-side `FLOW_*` family and has a
structural blind spot for exactly the class that just failed silently: build-time
frontend flags. Recorded as a follow-up, deliberately NOT fixed in this push.

#### Member impact

For at least four days, every member loading Options Flow fetched whole-day aggregate
plus the entire raw tape — about **5.5 MB where the parts path costs ~161 KB gz** —
and the first-paint work behind `FLOW_BOOTSTRAP_ENABLED` and `FLOW_PREPARE_ENABLED`
reached nobody. flow-worker was building the parts cache correctly and serving it
correctly the whole time; **no browser was asking for it.** Nothing failed while this
was true: a flag read as `=== '1'` is false when undefined, so the suite stayed green
and `/api/health` stayed 200. The same build miss also kept the COMING SOON holding
page from rendering (the public marketing funnel was open while the backend refused
every signup — reported separately, NOT changed by this deploy) and kept the Massive
bars push feed from ever subscribing, so every chart ran on the Finnhub poll.

#### The rail

`tests/test_dockerfile_vite_build_args.py` + `.github/workflows/vite-build-args.yml`.
The required set is **derived** from `app/src/**` — never typed — so the tenth flag is
covered the day it lands. Mutation-proved in-repo before shipping: drop one `ARG`
→ RED naming exactly it; drop one `ENV` export → RED naming exactly it; restore → 3
passed. Restored by re-inserting the line, never `git checkout`.

⚠️ `ENV VITE_X=$VITE_X` turns an unpassed arg into `""` rather than leaving it absent,
so **every one of the 17 read sites was checked** for a case where `''` and `undefined`
differ. Three use `??` or `!== '0'` — `VITE_CATALYST_UI_ENABLED`,
`VITE_TWITTER_UI_ENABLED`, `VITE_GRID_WARM_ENABLED` — and all three evaluate
identically under both. Re-check this if a read site ever starts distinguishing them.

### ⛔ Credential hygiene — a sentinel is SHAPED like the secret, never IS the secret

When a scan needs a non-vacuity control — proof it can actually see a match before its
zeros mean anything — **build the control from a value shaped like the secret, not from
the secret.** On 2026-09-12 a credential sweep proved itself with
`git hash-object -w --stdin <<< "sentinel-$PW-sentinel"`, which wrote a loose object
**containing the live credential** into the object store: the check for a planted
credential planted one. It was removed and verified absent, but the right control never
creates the exposure it is testing for.

⭐ The control is still mandatory — a scan that cannot demonstrate a hit is not
evidence of absence. Generate a decoy of the same length and alphabet, plant that, and
assert the scan finds it.

### ⚰️ The first attempt FAILED the build in 14 seconds — and the rail passed over it

`1f99a950b` was pushed at 09:32:47 ET and web went **FAILED** at 09:33, with a build
log containing one line: `scheduling build on Metal builder`. No build ran. Members
were never affected — Railway serves the last SUCCESS on failure — and the fan-out was
otherwise exactly right (flow-worker, worker, bars-api all **SKIPPED**).

The cause was in the patch, not in Railway. The `ENV` block had been generated with a
literal backslash+`n` pair where a line continuation belonged, so all seventeen exports
sat on **one physical line**:

    ENV VITE_CATALYST_UI_ENABLED=$VITE_CATALYST_UI_ENABLED \n    VITE_CHART_RENDER_TOKEN=...

⛔ **The generator was corrupted by the shell, not by Python.** A heredoc collapsed the
doubled backslash in `" \<newline>    "` down to a single one, leaving backslash+`n`.
Anything that emits a backslash through a heredoc on this box must build it as
`chr(92)` — including a test's own needle, or the same collapse corrupts the check.

⭐ **AND THE RAIL PASSED.** `test_each_declared_arg_is_also_exported_to_the_build`
asserts the substring `NAME=$NAME` is present, and it is present on a single broken
line exactly as on seventeen good ones. **A substring assertion is blind to the syntax
around it.** `test_the_env_block_is_physically_well_formed` now checks the physical
shape — no literal backslash+`n` anywhere, one line per ARG, every line but the last
ending in a continuation and the last not — and is mutation-proved by reintroducing
this exact mangling: it goes RED while the substring test stays green, which is the
whole point.

### ✅ AFTER-STATE — verified on the deployed artifact (2026-09-12, `705ee710d`)

web **SUCCESS** (`2a4c16b4`), and flow-worker / worker / bars-api all **SKIPPED** —
`Dockerfile.web` is on no other service's watch list, so the OPRA tape was untouched.
`/api/health` uptime 36 s; entry chunk moved `index-VW7Dk9Ft.js` → `index-cZA22Jfk.js`.

⭐ **That hash move is the cleanest proof the fix worked.** Before it, four `VITE_*`
were changed on Railway and the rebuilt entry chunk came back **byte-identical**. A
build whose output cannot move when its inputs move is not reading those inputs; now
it moves.

#### First paint, measured on the wire as a browser asks for it

| | on the wire (gzip) | decoded |
|---|---|---|
| `part=bootstrap` | 128,188 B (125.2 KB) | 975,017 B |
| `part=TOP_PICKS` | 41,533 B (40.6 KB) | 246,056 B |
| **first paint total** | **169,721 B (165.7 KB gz)** | |

Against the **5,514,328 B** the pre-fix session pulled: a **32× reduction**. Both
responses carry `X-Flow-Part`.

#### Rig, direct load (path A), member account

`part=bootstrap` + `part=TOP_PICKS` are the two un-versioned first-paint requests, and
**`data?days=1` is gone** — the raw tape is replaced by four versioned deferred parts
(`CONV`, `TICKER_DB`, `all_directional`, `all_trades`) that land after paint. Session
wire 2,119,080 B including that remainder, stable across all three runs.

⚠️ `first_content` median **9,890 ms** — and it is **NOT a page number**. It is a
QUIET-TAPE run (the label rides on every row), and ~9.3 s of it is the intro animation
on the direct-load path. Do not quote it. The path-B (in-app navigation) number, which
is the one without the intro, still does not exist — see the rig runbook.

⚠️ Run 1 of the first attempt showed `data?days=1` present and only 339 KB of wire,
where runs 2 and 3 showed the deferred parts and no tape. Recorded rather than tidied
away: the first-visit shape differs from the steady state, and Monday should expect it.

#### Admin control

`role=admin`, 2 runs: **identical** — same 7 requests, same parts, same 2,119,080 B.
So the load path is a property of the BUILD, not of the account.

#### ⛔ An instrument error worth carrying: a minified bundle has no identifiers

The pre-fix evidence was reported as five absent markers. **Three of them could never
have matched**: `REQUIRED_PARTS`, `planBundle` and `fetchPartsBundle` are IDENTIFIERS,
and esbuild renames every one. Only string literals survive. The finding was correct
but stood on one valid leg, not four:

| needle | before | after | valid? |
|---|---|---|---|
| `TOP_PICKS` | 0 | 4 | ✅ a string literal in `SERVER_TOPPICKS_PARTS` |
| `bootstrap` | 1 | 7 | ✅ string literal |
| `&part=` | 1 | 2 | ✅ template fragment from `partUrlFrom` |
| `part=bootstrap` | 0 | 0 | ❌ never emitted — the URL is built as `&part=${...}` |
| `REQUIRED_PARTS`, `planBundle`, `fetchPartsBundle` | 0 | 0 | ❌ identifiers, renamed |

⭐ **When probing a minified bundle, the needle must be a STRING the source emits, or
a structural fold you can read.** The decisive pre-fix evidence was always the folds —
`ComingSoon` bound to nothing, `useRealtimeBars` minified to a dead effect holding
`!1` — and the token's value going 0 → 14 occurrences across the fix.

#### The rig died mid-verification, and that is now fixed

Run 1 measured the fix working and then the rig raised `UnicodeEncodeError` on
`\u2318` in the page's own body text: a Windows console is cp1252 and the rig prints
what it reads. It lost runs 2 and 3 and **would have taken Monday's RTH session with
it.** `sys.stdout.reconfigure(errors="backslashreplace")` at import, for stdout and
stderr both — one global fix rather than a guard per print site, because the next
print site is the one you forget.
