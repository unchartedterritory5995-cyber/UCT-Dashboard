# Master integration + regression certification — 2026-09-08/09

Branch `fix/mobile-legend-legacy-state`. **Two** master integrations were performed.
Nothing deployed; no feature work; no R5 measurement.

**Read the last section first — everything above it is the trail, not the state.**

| stage | merge | verdict |
|---|---|---|
| §1–§8 certification @ pin `f139ad8ce` | `5fa3d6209` | ⛔ NOT_SHIP_READY — one branch-owned regression (§7) |
| MOB-09 blocker closeout | `ace13811f` | ✅ LOCAL_SHIP_READY |
| Release-tip reconciliation @ tip `068629ed5` | `94569640b` | ✅ RELEASE_READY = YES |
| **Final 3-commit reconciliation @ tip `2d8373449`** | **`34b8dabb7`** | ✅ **FINAL_RELEASE_READY = YES** |

`_certify-master-pin` = `f139ad8ce` (historical, retained) ·
`_release-tip` = `068629ed5` (this cycle).
Earlier verdicts are preserved verbatim as the correction trail — three diagnoses
in this document were wrong and were overturned by measurement, and the record of
that is worth more than a tidy summary.

---

## 1 · Integration #1 — master @ `4682abd8a`

| | |
|---|---|
| merge-base | `9c6078503` |
| master side | `4682abd8a` (180 commits) |
| our side | `228fbcb74` (51 commits) |
| result | `93cd64ac2` |

Conflict surface — the only files touched by **both** sides: `.gitignore`,
`app/src/components/StockChart.jsx` (master 7 commits · ours 4),
`app/src/pages/Watchlists.jsx` (master 1 · ours 1). Both code files gained lines
against **each** parent (`StockChart.jsx` +98/−49 vs master-side, +236/−22 vs
ours) — the shape a union resolution makes; a resolution that dropped one side
would show a near-zero diff against the other.

Baseline measured then: conflict-owner targeted suite `3 failed | 7,971 passed`
pre-merge → `3 failed | 8,115 passed` post-merge — same three, zero new.

⚠️ **Honesty note.** The exact scope of those two runs was not preserved in any
surviving artifact and could not be reproduced verbatim. Rather than claim
continuity with a scope that cannot be reconstructed, §5 defines the gate
explicitly and **supersedes** those figures.

## 2 · The late-master delta, and why a second merge was required

During integration #1's regression, `origin/master` advanced five commits to
`f139ad8ce`.

⭐ **Two of the five carried no new content.** `cb8f75fc4`'s *second parent is
`4682abd8a`* — the commit already merged — so its 79-file diff-against-first-parent
was the Notebook Wave N/O body we already had; `f139ad8ce` is its merge node. The
real delta was **10 files / 3 commits**.

| # | commit | files | mobile/chart/review? | class | risk if omitted |
|---|---|---|---|---|---|
| 1 | `388dce5a7` perf(company-panel) | 9 | **No** — desktop dock only | SAFE_TO_FOLLOW_AFTER_SHIP | none material |
| 2 | `cb8f75fc4` merge | — | — | UNRELATED (already integrated) | n/a |
| 3 | `fef053564` seed-live RTH-only | 1 (+9/−1) | **Yes — same file** | SAFE_TO_FOLLOW_AFTER_SHIP | user-visible divergence only |
| 4 | `0b67963c6` fix(panel-prewarm) | 3 | **No** — backend | SAFE_TO_FOLLOW_AFTER_SHIP | none material |
| 5 | `f139ad8ce` merge | — | — | UNRELATED (merge node) | n/a |

Reachability was **measured**: `ChartDetailDock`'s only importers are
`chartDock.js`, its width test and `ChartWidget.jsx`; nothing under
`pages/charts/mobile/**` or `pages/charts/review/**` references the dock, and
`MobileChartsApp.jsx:56` records that the phone shell composes on `StockChart`
directly — *"never ChartWidget"*. The prewarm job adds no route and changes no
response shape, and is default-OFF (`PANEL_PREWARM_ENABLED`) ⇒ **no data/API
contract risk**. #1 and #4 must move together (#4 fixes #1's OOM: ~13 MB
RSS/symbol, ≈48 GB across the 3,742-name universe against a 32 GB container).

### ⛔ Why the second merge was mandatory

**On content alone the answer was "don't chase master."** None of the five is
materially required: two are backend perf behind a default-OFF flag, one was
already integrated, one is a merge node, and the StockChart fix is a cosmetic
after-hours flash that is *master's current production behaviour*, not a
regression this branch introduces.

**The ship mechanism decided it.** Shipping here is `push origin <branch>:master`,
never forced. Measured: `git merge-base --is-ancestor origin/master HEAD` →
**false**. That push is rejected as non-fast-forward. There is no non-force way to
ship a branch that does not contain master's tip, and the alternative — merging
this branch into master from the other side — is the same merge with untested code
landing directly on master. Merging **into this branch** is the only path that gets
the result regression-tested before it reaches production.

### 2.1 · The StockChart.jsx delta — same file, disjoint semantics

```js
- if (_px && isSaneLivePrice(_px, lastBarRef.current?.close, lastServerCloseRef.current)) {
+ if (_px && !_snap.ext_session && isSaneLivePrice(_px, lastBarRef.current?.close, lastServerCloseRef.current)) {
```

Outside 09:30–16:00 ET `_effLivePrice` returns the **extended-hours** price, but a
daily candle is settled at the 4pm close. The seed painted today's candle at the
post-market price, then the fetch's settled close corrected it ~0.25s later. The
guard skips the seed in an extended session. **This branch carried the unguarded
version**, so the defect was live here.

**Overlap verdict: same file, no semantic contact.**

- Our four StockChart commits are MOB-05 drawing-bound alerts, the insecure-origin
  `uid` fix, and MOB-06′ clear-all / repeat / presentation.
- Our hunks sit at lines ~6, 3928–4733, 15194, 15621; master's at ~7031 —
  **≈2,300 lines from our nearest hunk.**
- Our diff contains **zero** occurrences of `SEED_LIVE`, `_effLivePrice`,
  `ext_session`, `getLivePriceStoreSnapshot`, `isSaneLivePrice`,
  `lastServerCloseRef`, `day_open/high/low`.
- `git merge-tree --write-tree` predicted a clean auto-merge; the real merge
  matched — **zero conflicts, exactly the 10 predicted files.**

## 3 · Integration #2 — verification

| check | result |
|---|---|
| merge completed, no unresolved conflicts | ✅ clean tree, 10 files, `git ls-files -u` empty |
| repo-wide conflict-marker scan | ✅ clean (`app/src`, `api`, `tests`, `docs`) |
| frozen pin `f139ad8ce` is an ancestor of HEAD | ✅ **0 behind the pin** |
| `origin/master` is an ancestor of HEAD | ⚠️ **no** — master moved again during certification |
| SEED_LIVE guard present exactly once | ✅ line 7041, inside `_seedLiveEnabled()` |
| master's guard preserved verbatim | ✅ `git diff _certify-master-pin HEAD -- StockChart.jsx` shows no `ext_session` line |

**Ahead/behind:** `0 behind / 53 ahead` of the frozen pin; **14 behind / 54 ahead**
of live `origin/master` at time of writing.

### Master's continued movement — triaged, not merged

Master advanced a further 9 commits (→ `526637158`). Per the freeze they were
**assessed but not merged**: all are backend Perplexity cost-spike fixes plus
chore/packaging (`perplexity_search.py`, `catalyst/**`, `news_catalysts/**`,
`nixpacks.web.toml`). **Zero intersection** with any branch-owned file. No
correctness/security/data-contract blocker ⇒ freeze held.

## 4 · Targeted regression around the merge delta

| set | result |
|---|---|
| merge delta + live-price + drawing alerts + MOB-06′ (15 files) | **154 passed** |
| mobile shell + review session (19 files) | **235 passed** |
| backend `test_panel_prewarm` + `test_startup_fingerprint` | **21 passed** |

The backend was in scope for the first time here: integration #1 had no backend
delta; integration #2 brought `api/main.py`, `api/services/panel_prewarm.py` and
`tests/test_panel_prewarm.py`. No `C:\data` tripwire fired.

## 5 · Full regression gate (authoritative, post-`5fa3d6209`)

Run in slices — see §7. Together these cover **all of `app/src/**`**.

| slice | files | tests | failures |
|---|---|---|---|
| `components/chart/engine` | 2F / 158P (160) | 2F / 3,888P / 4S | `manifestProse`, `pine.blindCorpus` |
| `components/chart/builder` | 1F / 45P (46) | 1F / 1,581P | `ImportBox.thinkscript` |
| `components/chart` (rest) | 98P | 1,790P | — |
| `components` research-kit + research | 47P / 1S (48) | 869P / 5S | — |
| `components` tiles·mobile·video·screener † | 1F / 52P (53) | 1F / 497P | `reachable.test.js` |
| `components` remainder | 63P (64) | 532P / 12S | — |
| `pages/charts` | 83P | 857P | — |
| `pages/journal-2-0` | 211P | 2,189P | — |
| `pages` (rest) | 1F / 286P (287) | 2F / 3,167P | `ThemeTrackerPage.chartmount` ×2 |
| `hooks·lib·utils·context·widgets·testing·routes·constants` | 1F / 76P (77) | 1F / 907P | `pollingSites.rail` |
| **TOTAL (frontend)** | | **16,277 passed · 7 failed · 21 skipped** | |
| **backend (targeted)** | | **21 passed** | |

† one file excluded — `VideoDockSlot.returns.test.jsx`, §7.

## 6 · Failure attribution — empirical, not inferred

**Merge-introduced failures: ZERO.** Every failure was reproduced on clean
`origin/master` @ `f139ad8ce` in a separate worktree, or proven to predate the merge.

| # | file | cases | attribution | established by |
|---|---|---|---|---|
| 1 | `chart/engine/ast/manifestProse.test.js` | 1 | **MASTER-OWNED** | fails identically on clean master |
| 2 | `chart/engine/ast/pine.blindCorpus.test.js` | 1 | **MASTER-OWNED** | fails identically on clean master |
| 3 | `chart/builder/ImportBox.thinkscript.test.jsx` | 1 | **MASTER-OWNED** | fails identically on clean master |
| 4 | `components/screener/reachable.test.js` | 1 | **MASTER-OWNED** | clean master reports the **identical 18-module list**; none branch-owned |
| 5 | `pages/ThemeTrackerPage.chartmount.test.jsx` | 2 | **MASTER-OWNED** | fails identically on clean master |
| 6 | `hooks/pollingSites.rail.test.js` | 1 | **MIXED** — master's rail, one branch-owned offender | below |

⭐ **Six of the seven cases were predicted BY NAME before the gate ran**, which is
what makes this a measurement rather than a post-hoc story. The seventh (#4) was
not predicted and was therefore given the full three-way treatment before labelling.

### #4 `reachable.test.js` — the one that was not predicted
18 modules are built and reachable from no route: `floor2/main.jsx`,
`lib/chatStreamManager.js`, `pages/charts/widgets/DockFundamentals.jsx`,
13× `pages/community/**`, `pages/optionsFlow/flowBootstrap.js`. **None is
branch-owned.** `DockFundamentals.jsx` sits in dock code master's `388dce5a7`
touched, so it was checked specifically: it had **no importer at the pre-merge tip
`93cd64ac2` either** — already orphaned, not merge-orphaned. Clean master produces
the identical list.

### #5 `ThemeTrackerPage.chartmount` — master broke its own test
`ThemeTrackerPage.jsx`, the test, and `ChartPane.jsx` are byte-identical to master,
and the test mocks `StockChart` outright. Its header asserts *"the page auto-opens
the FIRST theme on load (see ThemeTrackerPage's firstThemeTicker effect)"* — **there
is no `firstThemeTicker` effect**; `openTheme` initialises to `null` and the rendered
DOM shows the group collapsed (`▸`). The test landed in `7adfdda2b`; master's
theme-tracker rework (`4efb085c3` → `2940f557b` → `0b7570df4`, 2026-09-06) removed
the auto-open afterwards. Red on master since 9/6.

### #6 `pollingSites.rail` — branch-owned debt, pre-existing
Clean master already fails this rail with two offenders — `floor2/hooks/useFloor.js`
(5) and `hooks/useWatchlistIntelligence.js` (1). This branch adds a third:
**`components/chart/useBoundDrawingAlerts.js`**, a bare `useSWR` with
`refreshInterval: 60000`. Branch-only (absent from master) and byte-identical
between `93cd64ac2^1` and `93cd64ac2` ⇒ predates the merge. Ours to fix, **not merge
fallout**. Checked and cleared: the merge's new dock code adds no offender —
`DockProfile.jsx` uses the approved `useMobileSWR` wrapper, and the rail counts a
site only when the callee binds to the default export of `'swr'`.

## 7 · ⛔ BRANCH-OWNED REGRESSION — `VideoDockSlot.returns.test.jsx` spins forever

**This is the ship blocker, and it is ours.**

`app/src/components/video/VideoDockSlot.returns.test.jsx` (a **master-owned test
file, unmodified by this branch**) never completes on this branch. Measured
four ways:

| tree | result |
|---|---|
| clean master `f139ad8ce` | ✅ **passes, 6 tests, 13.9s** |
| merge base `9c6078503` | ✅ **passes, 6 tests, 1.72s** |
| our pre-merge tip `228fbcb74` | ⛔ **hangs** (>240s, killed) |
| integration #1 `93cd64ac2` | ⛔ **hangs** (>300s, killed) |
| integration #2 `5fa3d6209` | ⛔ **hangs** (>420s, killed) |

**`git bisect` over our 51 commits (6 steps, automated) names the cause:**

> **`ecfec4a2c` — fix(chart): MOB-09 — a highwatermark must not claim what the
> server never received**
> (`useTracingsSync.js`, `hooks/usePreferences.js`, + its test)

**Mechanism, read from the diff.** `setPref` now returns whether the write landed,
and `flushPush` advances `lastPushedRef`/`writeHW` **only on a confirmed `true`**.
In a test whose `fetch` stub does not serve `/api/auth/preferences` with an ok
response, the write never confirms, the highwatermark never advances, and the
adopt/push cycle re-enters instead of settling.

⚠️ **Two corrections to earlier statements in this session, both material:**
1. It is **not** master-owned. It passes on master and at the merge base. My
   initial reading — "master-owned, the long-standing full-suite hang" — was
   wrong, and the clean-master run is what disproved it.
2. It is **not** an import/transform stall. Vitest prints a file's line only on
   completion, so "stuck at `RUN`" is equally consistent with a runtime spin,
   which is what the bisect shows. "Stalls at import" was an over-read of the
   absence of output.

**Scope of the production risk is NOT established, and is not claimed here.**
`flushPush` is debounced off drawing-store changes, not self-retrying on a timer,
so this is *not* demonstrably an unbounded production retry loop. What is measured
is the test spin. Given this repo's own history — the 2026-07-01 524 outage caused
by unthrottled writes on the auth path — a push that never settles against
`/api/auth/preferences` deserves a bounded-retry decision from the owner before
ship, not a shrug.

**It also explains the "full suite hangs" note** carried in earlier artifacts as an
unexplained pre-existing condition. Every stalled run recorded there was on this
branch. ⭐ **The control that turns this from suspicion into measurement:** the
identical slice with only this file excluded completes **in seconds** — 53 files,
498 tests.

## 8 · Verdict

# ⛔ NOT_SHIP_READY

**One blocker, and it is branch-owned:** `ecfec4a2c` (MOB-09) makes a master-owned
test spin forever. It is not a merge artifact, not master's debt, and not
cosmetic — it is the reason the full suite could never be run in one process. A
test that cannot terminate would block any CI pipeline, and the underlying
"write never settles" path touches the endpoint implicated in a prior production
outage.

**Everything else is ready.** The branch merges master cleanly, preserves master's
SEED_LIVE fix verbatim, introduces **zero** regressions across 16,277 frontend
tests plus the backend targeted set, and all 7 failing cases are master-owned —
six predicted by name in advance, the seventh reproduced byte-for-byte on clean
master.

### To reach SHIP_READY
1. **Fix `ecfec4a2c`'s settle behaviour** so a failed prefs write terminates
   (bounded retry, or advance-with-explicit-dirty-flag). Re-run
   `VideoDockSlot.returns.test.jsx` — it must pass, and the un-excluded slice must
   complete. *This is the only blocker.*
2. Optionally clear the branch-owned polling site (`useBoundDrawingAlerts.js`).
   Non-functional; does not gate a release.
3. **Catch-up merge is a required step of ship itself.** `origin/master` moved 14
   commits during certification and is moving ~14 per 2 hours, so this cannot be
   waited out. Never resolve it with `--force`: that would revert master's live
   Perplexity cost-spike fix.
4. After the catch-up merge, re-run §4's targeted set plus the `chart` and
   `charts` slices — the only ones the delta can reach. A full re-gate is not
   warranted unless it touches `StockChart.jsx` or another conflict owner.

---

# MOB-09 RELEASE BLOCKER CLOSEOUT — 2026-09-09

Scope: the single release blocker from §7/§8 above. No deploy, no catch-up merge,
no R5, no feature work. `_certify-master-pin` still held at `f139ad8ce`.
Branch tip for this closeout: merge `5fa3d6209` + 4 working-tree files (below).

## C1 · The correction trail (preserved deliberately)

Three statements in this session were wrong and were corrected by measurement.
They are kept because each one cost a wrong turn, and the third is the whole
reason the fix looks the way it does.

| # | claim | how it was disproved |
|---|---|---|
| 1 | "The hanging test is master-owned pre-existing debt." | It **passes on clean master in 13.9s** and at the merge base in 1.72s. Branch-owned. |
| 2 | "It stalls at import/transform." | Vitest prints a file line only on completion, so "stuck at `RUN`" proves nothing. CPU sampling showed **100% pegged, RSS flat** — a runtime spin. |
| 3 | "The revalidation (`mutate()`) is the loop." | Replacing it with a local, no-request rollback (`mutate(fn, false)`) **still spun indefinitely**. The driver is ANY cache write on the failure path. |

## C2 · Measured root cause

`useTracingsSync` is mounted only by `ChartsWorkspace` and is **not in the failing
test's tree**. The loop is reached as
`VideoDockSlot → TickerPopup → StockChart → usePreferences`.

The test's fetch stub ends in a catch-all `Promise.resolve({ ok: false })`, so every
preferences POST fails. `ecfec4a2c` made that branch write to the shared SWR cache.
Every such write re-renders all consumers; `prefs` is rebuilt as a fresh object on
every render (`usePreferences.js:98`, unmemoized), so `prefs`-keyed effects re-fire
and write again. A **rollback** is the worst available shape, because it restores
the exact value that provoked the write — the cycle cannot converge even in
principle.

`git bisect` over the branch's 51 commits (6 steps, automated) named `ecfec4a2c`.

## C3 · Final implementation — one line of behaviour change for the blocker

**`usePreferences.setPref`** — comments stripped, the entire net diff is:

```diff
-        mutate()
```

removed from the **non-ok branch only**. The failure is still reported, by the
RETURN VALUE, which is MOB-09's actual requirement.

⚠️ **The `catch` (thrown fetch) branch KEEPS its revert.** Removing it too was
over-broad: that revert predates MOB-09, has shipped for a long time, and carries
its own contract test (`usePreferences.test.js` — *"still reverts on failure"*,
which drives `fetch` to **throw**). It is also not the spin path — the hang came
from `{ok:false}`, which resolves and never reaches `catch`. **This was caught by
the gate, not by review** (see C6).

**`useTracingsSync`** — `lastAttemptedRef` + `dirtyRef`; the stamp is monotonic
across *attempts* (not just confirmed pushes) so "is this the newest attempt?" is
answerable; the durable mark moves **forward only**; the dirty flag is set/cleared
only by the newest attempt; one retry on the unmount edge. **No timer, no polling,
nothing self-scheduled.**

## C4 · Mutation evidence

Every rail was proven able to go red, with a clean-file control before and after.
Restores were byte-snapshot + `os.replace` (never `git checkout`), each verified
byte-identical.

| mutation | rails reddened |
|---|---|
| A · restore the revalidation (bare `mutate()`) | 2 (no-follow-up-request · leaves-optimistic-value) |
| B · restore a local rollback (`mutate(fn,false)`) | 1 (leaves-optimistic-value) — **the form that still spun** |
| C · leave the store subscription registered through teardown | 1 (after-unmount-nothing-fires) |
| D · drop the dirty retry on unmount | 1 (stays-DIRTY) |
| E · drop the forward-only guard | 1 (late-older-confirmation) |

⭐ **One rail was VACUOUS on first draft** — it sampled the request count *after*
`setPref`, by which time the revalidation had already fired, so it passed against
the real bug. The mutation check is what exposed it; it now takes its baseline
before the write and a `⛔ NON-VACUITY` control asserts the counter can see a
request it is not looking for.

## C5 · Unmount-retry safety — answered by test, not by argument

| question | answer | proven by |
|---|---|---|
| where initiated | cleanup of the subscribe effect in `useTracingsSync` | code |
| firing condition | `pushTimerRef.current \|\| dirtyRef.current` | code |
| max requests | **1 per unmount edge** | `the dirty retry is ONE request per mount` |
| can React cleanup run it more than once | deps are `[schedulePush, flushPush]`; three re-renders while dirty fire **zero** extra pushes — edge-bound, not render-bound | same test |
| can it write React state after unmount | no — it writes refs + `localStorage` only; no `setState`, so no post-unmount update warning | code + green run |
| can it re-register a subscription/effect | no — `flushPush` never calls `schedulePush` | `after unmount NOTHING further fires` |
| can it resurrect the sync loop | no — post-teardown store changes **and** 120s of clock produce zero requests | same test (mutation C reddens it) |
| page closing / request never completes | fire-and-forget; nothing awaits it and no durable mark is advanced without confirmation | code + C3 |
| dirty state on abort/navigation | `dirtyRef` dies with the component. Cross-reload retry rides hydrate's existing `hasLocalTracingContent() → schedulePush()` path, so the document is re-offered on the next load | code |
| repeated route transitions | 1 attempt per transition, user-driven. **Stated honestly: this is bounded by user action, not by a cap** — rapid route toggling yields one request per toggle. No self-scheduled retry exists | `a server that stays down does NOT spin` |

## C6 · A regression I introduced, and the gate caught it

The first post-fix gate showed the `rest` slice at **2 failures where certification
had 1**: `usePreferences.test.js > "still serialises, still updates the cache
optimistically, still reverts on failure"`. Cause: I had stripped the revert from
the `catch` branch as well. Restored (C3); that suite is green at 21 tests and the
blocker test still settles.

⭐ Worth recording plainly: **review did not catch this — the regression gate did.**
It is exactly the class of thing a "smallest correction" instinct produces, and the
only reason it did not ship is that the slice totals were compared against a
previously measured baseline rather than eyeballed.

## C7 · Final regression gate (post-fix, 10 slices)

| slice | files | tests | failures |
|---|---|---|---|
| `components/chart/engine` | 2F / 158P (160) | 2F / 3,888P / 4S | `manifestProse`, `pine.blindCorpus` |
| `components/chart/builder` | 1F / 45P (46) | 1F / 1,581P | `ImportBox.thinkscript` |
| `components/chart` (rest) | 98P | 1,796P | — |
| `components` research-kit + research | 47P / 1S (48) | 869P / 5S | — |
| `components` tiles·mobile·video·screener **(nothing excluded)** | 1F / 53P (54) | 1F / 503P | `reachable.test.js` |
| `components` remainder | 64P | 544P | — |
| `pages/charts` | 83P | 857P | — |
| `pages/journal-2-0` | 211P | 2,189P | — |
| `pages` (rest) | 1F / 286P (287) | 2F / 3,167P | `ThemeTrackerPage.chartmount` ×2 |
| `hooks·lib·utils·context·widgets·testing·routes·constants` | 1F / 76P (77) | 1F / 911P | `pollingSites.rail` |
| **TOTAL** | **1,128 files** | **16,321 tests — 16,305 passed · 7 failed · 9 skipped** | |

**Runtime 723s (12.1 min).** Every slice ran to completion and reported a summary.
No hangs, no timeouts, no worker crashes, no forced terminations, no open-handle
stalls. Exit codes are 0 or 1, and every 1 is attributable to a named test failure.

⚠️ **One unhandled error, in `components` remainder:** `No "LineType" export is
defined on the "lightweight-charts" mock`, from `StockChart.smoke.test.jsx`.
**MASTER_OWNED** — that test file is byte-identical to `f139ad8ce` and untouched by
this branch; the `_ovLineType` line is master's (`8f7a3aeff`, 2026-06-24); and the
same error appears **twice** in the pre-fix log of that slice versus **once** now.
An incomplete `vi.mock` in a master-owned test; not this blocker's, and not made
worse by it.

## C8 · Failure attribution — all 7 cases

Identical to the pre-fix certification: **same 5 files, same 7 cases, no new ones.**

| file | cases | classification | evidence |
|---|---|---|---|
| `chart/engine/ast/manifestProse.test.js` | 1 | **MASTER_OWNED** | reproduced on clean `origin/master` worktree |
| `chart/engine/ast/pine.blindCorpus.test.js` | 1 | **MASTER_OWNED** | reproduced on clean master |
| `chart/builder/ImportBox.thinkscript.test.jsx` | 1 | **MASTER_OWNED** | reproduced on clean master |
| `components/screener/reachable.test.js` | 1 | **MASTER_OWNED** | clean master reports the **identical 18-module list**; none branch-owned; `DockFundamentals` already unimported at `93cd64ac2` |
| `pages/ThemeTrackerPage.chartmount.test.jsx` | 2 | **MASTER_OWNED** | reproduced on clean master; master's 2026-09-06 rework deleted the `firstThemeTicker` auto-open the test asserts |
| `hooks/pollingSites.rail.test.js` | 1 | **MASTER rail + PRE_EXISTING_BRANCH_DEBT** | clean master already fails with `useFloor.js` + `useWatchlistIntelligence.js`; our third offender `useBoundDrawingAlerts.js` is byte-identical across `93cd64ac2^1..93cd64ac2` ⇒ predates both merges |

**INTRODUCED_BY_MOB09_FIX: 0.** (One was introduced mid-work and removed before
this run — see C6.) **UNKNOWN: 0.**

## C9 · MOB-09 semantic invariant — restated and re-proved

> **The invariant.** The tracings highwatermark is a claim about what the SERVER
> has durably received. It may advance only on a write the server actually
> confirmed; it must never advance on an unchecked or failed request, because the
> adopt gate is a strict `server.updatedAt > hw` and a falsely-advanced mark pins
> the device forever — the server holds the user's drawings and the browser will
> not take them. The two failure directions are not symmetric: failing to advance
> costs one redundant adopt, advancing wrongly costs the user their drawings,
> silently and permanently.

| requirement | satisfied by | test |
|---|---|---|
| server-confirmed progress advances | `if (ok) { if (updatedAt > lastPushedRef.current) … writeHW }` | `…and DOES move when the push is confirmed` |
| failed writes not falsely marked durable | mark untouched unless `ok` | `the highwatermark does NOT move when the push is not confirmed` |
| newer local state not lost to an in-flight write | debounced push re-exports the **current** store on each flush; stamp monotonic across attempts | `debounces a push on any change made after hydration` |
| older confirmations cannot regress newer progress | forward-only guard | `a LATE confirmation from an OLDER push cannot walk the mark backwards` (mutation E) |
| retryability survives failure | explicit `dirtyRef` + unmount edge + hydrate re-push | `an unconfirmed push stays DIRTY` (mutation D) |
| successful convergence settles | dirty cleared by the newest attempt on `ok` | `a later successful retry CONVERGES` |

The healing clause (`serverHasContentWeLack`) and the never-move-backwards-while-
healing rule are untouched.

## C10 · Hygiene

No debug logging, no `debugger`, no `.only`/`.skip`/`fit`/`fdescribe` added, no
timers or intervals introduced, no new `flushPush`/`schedulePush` call sites beyond
the unmount edge, no recursive retry, no broad cache invalidation, no stray
`.mut`/`.restore`/snapshot artifacts in the repo.

**Working tree (4 modified, 1 untracked) — nothing unrelated:**

```
 M app/src/components/chart/useTracingsSync.js          (+39)
 M app/src/components/chart/useTracingsSync.test.js     (+142)
 M app/src/hooks/usePreferences.js                      (+47, net code: -1 line)
 M app/src/hooks/usePreferences.writeConfirmation.test.js (+64)
?? docs/mobile-review-phase-2026-09/04-master-integration-and-regression.md
```

Backend untouched (`api/`, `tests/` unchanged), so the backend gate is not required
for this fix; the merge's own backend result (21 passed) stands from §4.
**The changes are uncommitted** — this closeout certifies the working tree.

## C11 · Verdict

# ✅ LOCAL_SHIP_READY = YES

- 10-slice gate terminated normally — no hangs, timeouts, worker crashes or forced
  terminations; 16,305 / 16,321 passed in 12.1 min.
- **Zero regressions introduced by this fix.** The 7 remaining failures are the
  same 7 the pre-fix certification recorded, each attributed empirically.
- The former hanging test is demonstrably settled: **3 consecutive runs, 3s / 3s /
  2s, 6/6 each**, against >420s-and-killed before.
- The unmount retry is bounded (1 per unmount edge), edge-bound not render-bound,
  cannot write React state after unmount, and cannot resurrect the loop — each
  proven by a mutation-checked test.
- MOB-09's invariant holds in full, with the stale-acknowledgement direction now
  gated where it previously was not.

⛔ **This is LOCAL readiness only.** `origin/master` has continued to move and is
NOT contained. The release-tip reconciliation against whatever master is at that
moment remains a separate controlled step, and shipping still requires it because
`push origin <branch>:master` is a non-fast-forward until then. Never `--force`.

---

# FINAL RELEASE-TIP RECONCILIATION — 2026-09-09

Not deployed. Not pushed. No force. No R5, no feature work.
`_certify-master-pin` still `f139ad8ce` (historical). New pin `_release-tip` =
the tip captured **once** for this cycle.

- **Release tip: `068629ed5`**
- **Final merge: `94569640b`**
- **0 behind / 55 ahead** of both the captured tip and live `origin/master`
- `git merge-base --is-ancestor origin/master HEAD` → **TRUE**

## R1 · The 47-commit delta

44 content commits + 3 merges, 113 files.

| group | n | subsystem | class |
|---|---|---|---|
| Notebook **Wave P** — OCR pipeline, Tesseract adapter, web-only build boundary (`Dockerfile.web`, `railway.web.json`), frozen certification corpus, Ask provenance/citation | ~30 | Notebook / packaging | REQUIRED_FOR_RELEASE *(mechanically — see R3)* · UNRELATED semantically |
| **Perplexity cost-spike** — durable daily budget, `cost_surface` labels, redeploy-reset guards | 3 | backend catalyst/news | **REQUIRED_FOR_RELEASE** — live production fix |
| **charts: earnings strip** in the widget dock + FY-label fix | 2 | `pages/charts/widgets/**` | SAFE_FOLLOW_ON |
| **flow**: EOD cream cron catch-up, then dropping the first-run bootstrap | 2 | backend flow | UNRELATED |
| chore diagnostic workflow — added **and** removed | 4 | CI | UNRELATED (net ≈ zero) |
| `.gitattributes` — OCR corpus is bytes | 1 | repo config | UNRELATED, scoped |

## R2 · Semantic overlap map — measured, not inferred

⚰️ **A naive `9c6078503..HEAD` overlap reports 36 shared files and is WRONG.**
That range includes everything master handed us *through* our own two merges.
Measured from the real merge base `f139ad8ce`: our side 130 files, master's 113,
and they share **exactly one — `.gitignore`**, appended by both.

Contact with the release surface, by reading the diffs:

| surface | contact |
|---|---|
| StockChart / chart rendering | **none** |
| `usePreferences` / auth preferences | **none** |
| `useTracingsSync` / drawings persistence | **none** |
| watchlists / review workflow | **none** |
| mobile chart shell | **none** directly — but see `Sheet.jsx` below |
| layouts / workspaces | **none** |
| alerts | **none** |
| scanner / screener review entry | **none** |
| backend/API contracts mobile consumes | **none** — no changed `api/` file serves preferences, auth, watchlists, bars, drawings or scan/review |

⭐ **The one real neighbour, found by reading rather than by filename:**
`app/src/components/mobile/Sheet.jsx` (`c225e22c5`) gains an **additive**
`bodyClassName` prop defaulting to `''`. **Ten files in our surface consume
`Sheet`** — nine mobile sheets plus `ReviewFeed.jsx` — so it was treated as a
first-class regression target, not waved through as "additive".

**Test/fixture changes relevant to certification:** master adds
`chartEarningsStripModel.test.js`, extends `chartDock.width.test.js`, and adds 9
notebook test files. These *raise* the gate's counts; §R6 accounts for the growth
exactly.

## R3 · Conflicts and resolutions

`git merge-tree --write-tree` predicted a clean auto-merge; the real merge matched.

| file | ours | theirs | resolution |
|---|---|---|---|
| `.gitignore` | `+tools/review_feed_probe_out/` | `+` Wave-P output dirs and the local earnings-strip design harness | **auto-merged, both retained** — append-only at different offsets, no semantic choice to make |

No other file conflicted. Nothing was resolved wholesale as "ours" or "theirs";
there was nothing to choose between.

⛔ **Why every commit in the delta is REQUIRED_FOR_RELEASE mechanically, whatever
its content:** shipping is `push origin <branch>:master`, never forced, which
demands the branch CONTAIN master. A branch missing these would either be
rejected or — if forced — **revert master's live Perplexity cost fix**. That is
the concrete harm of omission, and it is why this merge is not optional.

## R4 · Invalidation analysis (scope declared before running)

| tier | scope | why |
|---|---|---|
| **A** directly-overlapped | `pages/charts/widgets`, `pages/journal-2-0/{components/notebook,lib}`, 13 backend test files | master changed/added these tests |
| **B** semantic neighbours | `components/mobile`, `pages/charts/mobile`, `pages/charts/review` | every `Sheet.jsx` consumer |
| **C** our owned surface | MOB-09 set, `VideoDockSlot`, drawing-bound alerts, MOB-06′, screener/scanner entry | the release's own subject |
| **D** backend | ask/OCR, catalyst, perplexity, flow/cream, prewarm, startup fingerprint | contracts changed (none mobile-facing) |
| **E** full 10-slice gate | **run** | `Sheet.jsx` is shared infrastructure reaching our surface, the delta adds ~11 frontend test files, and the gate is the directly comparable artifact |

## R5 · Results

| set | result |
|---|---|
| **B+C** Sheet consumers · mobile shell · review · MOB-09 · blocker · alerts · MOB-06′ | **44 files / 450 passed** |
| **A** master's new tests (widgets, notebook) + screener entry | 168 files / 1,997 — 1 failure (`reachable.test.js`) |
| **D** backend | **467 passed**, no `C:\data` tripwire |
| **A′** blocker re-check ×3 | **3s / 3s / 3s, 6/6 each** |

## R6 · Full 10-slice gate — directly comparable to certification

| slice | files | tests | failures |
|---|---|---|---|
| `components/chart/engine` | 2F / 158P (160) | 2F / 3,888P / 4S | `manifestProse`, `pine.blindCorpus` |
| `components/chart/builder` | 1F / 45P (46) | 1F / 1,581P | `ImportBox.thinkscript` |
| `components/chart` (rest) | 98P | 1,796P | — |
| `components` research-kit + research | 47P / 1S (48) | 869P / 5S | — |
| `components` tiles·mobile·video·screener | 1F / 53P (54) | 1F / 503P | `reachable.test.js` |
| `components` remainder | 64P | 544P | — |
| `pages/charts` | **84P** | **894P** | — |
| `pages/journal-2-0` | **215P** | **2,258P** | — |
| `pages` (rest) | 1F / 286P (287) | 2F / 3,167P | `ThemeTrackerPage.chartmount` ×2 |
| `hooks·lib·utils·…` | 1F / 76P (77) | 1F / 911P | `pollingSites.rail` |
| **TOTAL** | **1,133 files** | **16,427 — 16,411 passed · 7 failed · 9 skipped** | |

**699s (11.7 min).** Every slice completed and printed a summary. No hangs, no
timeouts, no worker crashes, no forced terminations, no open-handle stalls.

**Comparison with the pre-reconciliation certification:**

| | certification | after catch-up | Δ |
|---|---|---|---|
| files | 1,128 | 1,133 | **+5** |
| tests | 16,321 | 16,427 | **+106** |
| passed | 16,305 | 16,411 | **+106** |
| failed | **7** | **7** | **0** |
| skipped | 9 | 9 | 0 |

⭐ **The entire +5/+106 is master's own new tests, accounted for exactly:**
`pages/charts` +1 file / +37 tests (`chartEarningsStripModel.test.js` and the
extended `chartDock.width.test.js`); `pages/journal-2-0` +4 files / +69 tests
(Wave-P notebook suites). **No slice lost a test, and no slice gained a failure.**

⚠️ One unhandled error persists in `components` remainder — the `LineType`
`vi.mock` gap in `StockChart.smoke.test.jsx`. **MASTER_OWNED**, unchanged by this
merge (already documented in the closeout).

## R7 · Failure attribution

Same 5 files, same 7 cases as both prior runs. **Zero new.**

| file | cases | classification | evidence |
|---|---|---|---|
| `chart/engine/ast/manifestProse.test.js` | 1 | **MASTER_OWNED** | reproduced on clean master worktree |
| `chart/engine/ast/pine.blindCorpus.test.js` | 1 | **MASTER_OWNED** | reproduced on clean master |
| `chart/builder/ImportBox.thinkscript.test.jsx` | 1 | **MASTER_OWNED** | reproduced on clean master |
| `components/screener/reachable.test.js` | 1 | **MASTER_OWNED** | list re-read after the merge: **identical 18 modules**, so master's 113 new/changed files added nothing unreachable |
| `pages/ThemeTrackerPage.chartmount.test.jsx` | 2 | **MASTER_OWNED** | reproduced on clean master; master's 2026-09-06 rework deleted the `firstThemeTicker` auto-open the test asserts |
| `hooks/pollingSites.rail.test.js` | 1 | **MASTER rail + PRE_EXISTING_BRANCH_DEBT** | clean master fails with `useFloor.js` + `useWatchlistIntelligence.js`; our third offender `useBoundDrawingAlerts.js` is byte-identical across `93cd64ac2^1..93cd64ac2` |

**INTRODUCED_BY_CATCHUP_MERGE: 0 · INTRODUCED_BY_MOBILE_BRANCH: 0 · UNKNOWN: 0.**

## R8 · Blocker and master-behaviour checks

| check | result |
|---|---|
| MOB-09 blocker still closed | ✅ `useTracingsSync` 16/16, `writeConfirmation` 10/10, `usePreferences` 21/21 |
| `VideoDockSlot.returns` still settles | ✅ **3 consecutive runs, 3s each, 6/6** |
| SEED_LIVE `!_snap.ext_session` guard | ✅ present exactly once |
| Perplexity durable budget / `cost_surface` | ✅ present (24 references) |
| earnings-strip files | ✅ both present |
| `Sheet.bodyClassName` | ✅ present |
| Wave-P OCR service | ✅ present |
| every `_release-tip` commit contained | ✅ **YES** |

**No current-master behaviour was lost.** Nothing from the delta was overridden;
the merge added only.

## R9 · Safe to fast-forward into master?

**Mechanically: yes.** `origin/master` is an ancestor of HEAD, the branch is 0
behind, and `push origin fix/mobile-legend-legacy-state:master` would fast-forward
without force. ⚠️ That is true **as of tip `068629ed5`** — master moves several
commits an hour, so the check must be re-run immediately before any push, and a
non-fast-forward rejection then means "catch up again", never "force".

# RELEASE_READY = YES

- Ordinary merge, no rebase, no force; conflicts: one append-only file,
  auto-merged with both sides retained.
- 16,411 / 16,427 passing in 11.7 min; **the same 7 failures as certification**,
  each attributed empirically, none introduced by the catch-up.
- The MOB-09 blocker stays closed and the formerly hanging test settles in 3s.
- Every commit of the captured release tip is contained; no master behaviour lost,
  including the live Perplexity cost fix.

⛔ Held per instruction: **not deployed, not pushed, no R5, no feature work**, and
`_certify-master-pin` retained at `f139ad8ce`.

## R10 · Addendum — master moved again during Phase 4 (NOT chased)

Recorded immediately after the verdict so this document does not overstate itself.
By the time the gate finished, `origin/master` was **3 commits past the captured
tip** (`2d8373449`, `9c998f311`, `a37cd5062`). Per the freeze rule they were
triaged, **not merged** — none is a security, correctness or data-contract
emergency.

⭐ **But they are not like the other 47, and the next cycle should expect real
work.** For the first time in this reconciliation they touch files this branch
owns:

- `app/src/components/StockChart.module.css` — ours too
- `app/src/pages/screener/shell/VirtualResults.jsx` — ours too
- `app/src/pages/screener/shell/ResultCards.jsx`
- `app/src/components/screener/reachable.test.js` — **the rail this document has
  attributed three times**; its 18-module list may legitimately change

They also land `app/src/hub/**` — a **gated mobile navigation joystick hub**
(~40 files, `2d8373449`). That is a new mobile surface arriving beside this
branch's mobile review workflow, and whether the two interact is a product
question for the owner, not something to resolve inside a merge.

⇒ **`RELEASE_READY = YES` is asserted at tip `068629ed5`, which is the tip this
cycle certified.** A push at this moment would be rejected as non-fast-forward
(behind 3). The next catch-up is a genuine reconciliation with overlap, not the
zero-contact merge this one turned out to be — and it must never be resolved with
`--force`.

---

# FINAL 3-COMMIT RELEASE RECONCILIATION — 2026-09-09

Not deployed. Not pushed. No force. No R5. No hub/review convergence work.
Pins retained: `_certify-master-pin` = `f139ad8ce` · `_release-tip` = `068629ed5`.

- **Frozen release target: `_release-tip-final` = `2d8373449`**
- **Final merge: `34b8dabb7`**
- **0 behind / 58 ahead** of the frozen target · working tree **clean**

## F1 · The 3 commits

| commit | subject | code surface | gated | changes prod behaviour | overlap class |
|---|---|---|---|---|---|
| `a37cd5062` | Wave P housekeeping — the upload refusal a member could not act on | `journal_two/notes.py`, `NoteEditorPage.jsx` + tests | n/a | yes, notebook upload only | **E · UNRELATED** |
| `9c998f311` | Wave P post-closure — 32 GB correction, Wave Q packet | docs only | n/a | no | **E · UNRELATED (docs)** |
| `2d8373449` | hub: preview — navigation-only joystick hub (mobile, gated) | `hub/**` (new), `Layout`, `App`, `AuthContext`, `UIcon`, `auth.py`, + 4 owned files | **yes ×3** | yes, behind gates | **A + B + D** |

Per-file classification for the four owned files:

| file | class | detail |
|---|---|---|
| `screener/shell/VirtualResults.jsx` | **A · DIRECT_CODE_OVERLAP** | both sides rewrote the same signature line — the only conflict |
| `screener/shell/ResultCards.jsx` | **B · SEMANTIC_PRODUCT_OVERLAP** | `scrollToIndex` seam for a future hub cursor over a list our review session already navigates |
| `components/StockChart.module.css` | **C · SHARED_INFRASTRUCTURE_ONLY** | same file, disjoint selectors (`.goLivePill` vs our `.volXtra`) |
| `components/screener/reachable.test.js` | **D · TEST_ONLY** | rail; list grew by master's own new orphan |

## F2 · Hub / review product overlap

Answered from code, not assumption.

**What it is:** a navigation-only corner joystick for one-handed touch navigation.
It adds **no route and no backend endpoint**; it replaces the voice orb and the
feedback "?" when active.

**Gated three ways, all of which must pass** (`hub/useHubActive.js`):
1. server kill switch `HUB_PREVIEW_ENABLED`, read **per request** so a rollback
   needs no redeploy — default ON, so an unset variable is "not killed";
2. a per-user `joystick_hub.enabled` pref that, when unset, resolves to
   **admin only**;
3. capability + viewport: `backdrop-filter`, `visualViewport`, and
   `(max-width: 1023px) and (pointer: coarse)`.

**Mounting:** `Layout.jsx`, as a sibling of `<main>` inside `HubProvider`. There
is **no route suppression** — it is intended to appear on `/charts`, and its own
comments record device measurements there (Pixel 8, Galaxy S24, iPhone 15 Pro).

⭐ **It cannot appear inside the review workflow, and that is structural rather
than incidental:** `--z-modal` is **1000**, `--z-hub-open` is **401**, and
`ReviewFeed` renders through `Sheet`, which owns `--z-modal`. Master's own
`hubZIndex.test.js` asserts the same ordering (`modals and toasts above the open
hub`). While the feed is open it correctly covers the hub; the hub can never draw
over the feed.

**Spatial coexistence on the chart shell is already reconciled by master:**
`.goLivePill` moved `right: 86px → 118px` because the hub's 84px pad occupies
`right: 24px…108px`, with `hubChipCollision.test.js` asserting the two hit rects
never intersect at 375px and 430px.

### Verdict: `HUB_AND_REVIEW_COMPATIBLE_WITH_SHARED_NAV`

## F3 · ⏸️ DEFERRED_PRODUCT_ARCHITECTURE — future hub cursor vs review session cursor

**Status: NOT_CURRENTLY_ACTIVE · Release impact: NONE · Future risk:
TWO_CURSOR_MODELS_OVER_ONE_LIST**

This is recorded as an open collision, **not** as something this release resolved.

Master has deliberately added `scrollToIndex` seams to **both** `VirtualResults`
and `ResultCards` for a future shared hub cursor (its own comments cite
joystick-hub spec §2d / exception (d), and say *"Nothing consumes it yet; this
only opens the door"*).

The mobile review workflow **already owns** ordered-set navigation: session
creation, current index, next/prev, return-to-list, source ordering, and
review/feed state.

⛔ **Before any future hub phase controls scanner / screener / watchlist list
position, a product+architecture decision must define ONE source of truth for:**

1. current symbol / index
2. the ordered result set
3. next / previous semantics
4. scroll position
5. selection state
6. route / navigation ownership
7. behaviour when hub navigation occurs **during an active review session**

Nothing is to be built, and no compatibility code written speculatively, until
that decision exists. There is no current release conflict because nothing
consumes the seams.

## F4 · Merge and the one conflict

`git merge-tree` predicted the conflict; the real merge produced exactly it.

| file | ours | theirs | resolution |
|---|---|---|---|
| `VirtualResults.jsx` | dropped `liveSortOn` — the live re-sort moved **up** to `ScannerShell` so every renderer shares one display order and "Review charts" can publish the order on screen | wrapped in `forwardRef`, exposed `scrollToIndex` | **both intents kept**: master's `forwardRef` seam in full, with **our** prop list. Restoring `liveSortOn` would reintroduce a dead parameter implying this component still sorts; `ScannerShell` no longer passes it (verified), so master's list would also be inert. A merge note in the file records this. |
| `StockChart.module.css` | added `.volXtra` (MOB-06′ phone volume) | moved `.goLivePill` right 86→118px | auto-merged; **selector-disjoint**, no semantic choice |
| `.gitignore` | — | — | auto-merged |

Post-merge: no unresolved conflicts, repo-wide marker scan clean,
`git merge-base --is-ancestor _release-tip-final HEAD` → **TRUE**, behind **0**,
working tree clean.

## F5 · ⚠️ Certification-scope correction (not a regression)

The 10-slice gate used through certification claimed to cover all of
`app/src/**`. It did not. Three areas were **never** in it:

- `src/styles` (3 test files)
- `src/__tests__` (1)
- three root-level files (`App.test.jsx`, `innerHtmlIdentity.test.js`,
  `routePrefetch.test.js`)

`src/hub` (15 files) is new from master and would have been a fourth gap.

⭐ **This is a scope correction, not a regression.** Nothing broke; a set of tests
was never being run. The final gate adds an eleventh **`gapfill`** slice covering
all four, so the release gate genuinely covers `app/src/**`. Three failures it
surfaces are pre-existing master-owned debt that no prior gate could have seen —
which is precisely the argument for closing the gap rather than quietly keeping
the smaller, prettier number.

## F6 · Final 11-slice gate

| slice | files | tests | failures |
|---|---|---|---|
| `components/chart/engine` | 2F / 158P (160) | 2F / 3,888P / 4S | `manifestProse`, `pine.blindCorpus` |
| `components/chart/builder` | 1F / 45P (46) | 1F / 1,581P | `ImportBox.thinkscript` |
| `components/chart` (rest) | 98P | 1,796P | — |
| `components` research-kit + research | 1F / 46P / 1S (48) | 1F / 868P / 5S | `EarningsResearchModal.themeIsland` |
| `components` tiles·mobile·video·screener | 1F / 53P (54) | 1F / 503P | `reachable.test.js` |
| `components` remainder | 64P | 544P | — |
| `pages/charts` | 84P | 894P | — |
| `pages/journal-2-0` | 2F / 213P (215) | 2F / 2,257P | `rawErrorSurface`, `CaptureHost` *(flaky)* |
| `pages` (rest) | 1F / 286P (287) | 2F / 3,167P | `ThemeTrackerPage.chartmount` ×2 |
| `hooks·lib·utils·…` | 1F / 76P (77) | 1F / 911P | `pollingSites.rail` |
| **`gapfill`** (hub · styles · __tests__ · root) | 3F / 19P (22) | 3F / 290P | `tapFloor`, `tokens.reachable`, `sourcesAreText` |
| **TOTAL** | **1,155 files** | **16,721 — 16,699 passed · 13 failed · 9 skipped** | |

**≈19.8 min.** All 11 slices ran to completion and printed a summary. **No hangs,
no timeouts, no worker crashes, no forced terminations, no open-handle stalls.**

⚰️ **Two "crash markers" my first scan reported were my own false positives** —
the grep matched the word *forced* inside test names in `engine` and `pagesRe`.
Reported here rather than quietly dropped, because a scan that over-reports is
the same class of instrument error as one that under-reports.
`pagesRe` took 489s (vs 172s) purely from 19-worker contention, not a stall.

## F7 · Failure attribution — every case measured

| file | cases | classification | evidence |
|---|---|---|---|
| `chart/engine/ast/manifestProse.test.js` | 1 | **MASTER_OWNED** | reproduced on clean master |
| `chart/engine/ast/pine.blindCorpus.test.js` | 1 | **MASTER_OWNED** | reproduced on clean master |
| `chart/builder/ImportBox.thinkscript.test.jsx` | 1 | **MASTER_OWNED** | reproduced on clean master |
| `research/EarningsResearchModal.themeIsland.test.js` | 1 | **MASTER_OWNED** *(new)* | reproduced on clean `2d8373449`. Cause is legible in the message: the hub added `--hub-glass-tint`, `--hub-glass-tint-strong`, `--hub-rim` to `tokens.css` and the modal's theme island pins every theme-variant token |
| `components/screener/reachable.test.js` | 1 | **MASTER_OWNED** | **re-measured, not carried forward**: list grew 18 → **19**, the new entry being master's own `app/src/hub/contracts.js`; clean `2d8373449` reports the **identical 19** |
| `pages/ThemeTrackerPage.chartmount.test.jsx` | 2 | **MASTER_OWNED** | reproduced on clean master; master's 2026-09-06 rework deleted the `firstThemeTicker` auto-open the test asserts |
| `hooks/pollingSites.rail.test.js` | 1 | **MASTER rail + PRE_EXISTING_BRANCH_DEBT** | clean master fails with `useFloor.js` + `useWatchlistIntelligence.js`; our third offender `useBoundDrawingAlerts.js` predates both merges |
| `journal-2-0/rawErrorSurface.test.js` | 1 | **MASTER_OWNED** *(newly visible)* | reproduced on clean `2d8373449`, both isolated and across the full 215-file slice |
| `styles/tapFloor.test.js` | 1 | **MASTER_OWNED** *(scope correction)* | reproduced on clean master; never covered by any prior gate |
| `styles/tokens.reachable.test.js` | 1 | **MASTER_OWNED** *(scope correction)* | reproduced on clean master |
| `__tests__/sourcesAreText.test.js` | 1 | **MASTER_OWNED** *(scope correction)* | reproduced on clean master |
| `notebook/CaptureHost.test.jsx` | 1 | **FLAKY — not a regression** | fails only under 19-worker contention. Passes **isolated on our branch** (18/18) and passes across the **full `pagesJ2` slice on our branch**, which then matches clean master's slice result exactly (1 failure, `rawErrorSurface`) |

**INTRODUCED_BY_FINAL_CATCHUP: 0 · INTRODUCED_BY_MOBILE_BRANCH: 0 · UNKNOWN: 0.**

Reproducible failures: **12**, every one master-owned (one mixed). The 13th is a
load-dependent flake, classified as such rather than forced into a category.

## F8 · Blocker and coexistence status

| check | result |
|---|---|
| MOB-09 blocker | ✅ closed — `usePreferences` 21 · `writeConfirmation` 10 · `useTracingsSync` 16 = **47 passed** |
| `VideoDockSlot.returns` settles | ✅ **3 consecutive runs, 3s each, 6/6** |
| hub / review coexistence | ✅ z-separated (`--z-modal` 1000 > `--z-hub-open` 401); hub tests pass; review + feed + mobile shell pass |
| targeted regression (hub · screener · review · mobile · MOB-09) | ✅ 88 files / 1,095 tests, only `reachable.test.js` |
| `_release-tip-final` contained | ✅ **behind 0 / ahead 58** |
| working tree | ✅ clean |
| fast-forward into master without force | ✅ **possible at `2d8373449`** — re-verify immediately before any push |

## F9 · Remaining known debt (complete)

1. `useBoundDrawingAlerts.js` — bare `useSWR` polling site (**ours**, pre-existing, non-functional).
2. Eleven master-owned test failures listed in F7, four of which the scope correction newly exposed.
3. `StockChart.smoke.test.jsx` `LineType` `vi.mock` gap — master-owned unhandled error.
4. `CaptureHost.test.jsx` — load-dependent flake.
5. ⏸️ **F3 deferred product architecture** — hub cursor vs review session cursor.

# FINAL_RELEASE_READY = YES

- 11 slices, all terminated normally; 16,699 / 16,721 passing.
- **Zero failures introduced by this catch-up or by the mobile branch.** Twelve
  reproducible failures, all master-owned; the thirteenth is a measured flake.
- The one conflict was resolved semantically, preserving both sides' intent.
- MOB-09 stays closed; the formerly hanging test settles in 3s.
- Hub and review coexist by construction, and the future cursor collision is
  recorded as deferred rather than silently absorbed.
- The branch can fast-forward into master without force at `2d8373449`.

⛔ Held: not deployed, not pushed, no R5, no hub/review convergence work, no
chasing of master commits past the frozen target.
