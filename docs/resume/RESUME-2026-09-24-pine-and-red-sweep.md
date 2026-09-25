# RESUME — Pine merge PR #184 + master red sweep

> **Written 2026-09-24 before a planned restart.** Everything below is committed
> and pushed. Nothing that matters is held only in a scratchpad.
>
> ⛔ **Read this file first.** It is the only artifact carrying BOTH programmes
> and the state each is in.

---

## 1. The two programmes

| | branch | HEAD | pushed | state |
|---|---|---|---|---|
| **A. Pine merge** | `merge/pine-up-to-master` | `526b5e2aa` | yes | **PR #184 OPEN — COMPLETE** |
| **B. Master red sweep** | `fix/master-red-sweep` | `a820438cb` | yes | **84/84 held under gate B; second wave classified every remaining red — see §3c** |

PR #184: https://github.com/unchartedterritory5995-cyber/UCT-Dashboard/pull/184

⭐ **A is DONE** — nothing owed unless review asks.
⭐ **B is where to resume.**

---

## 2. Programme A — the Pine merge (COMPLETE)

`origin/master` merged into `feat/pine-value-model`. Full record, with every
command that produced every number:

    docs/pine/MERGE-2026-09-23.md        (on branch merge/pine-up-to-master)

Gate evidence beside it, so the PR's cited numbers stay reproducible:

    docs/pine/gate-evidence/branch-baseline-7f091db26.{json,md}

Both gates VALID, `reconciles=true`:

```
merged  66ee91c41   1815 files   115 failed   117 cases
branch  7f091db26   1710 files    34 failed    36 cases
NEW vs branch ......................... 84
confirmed failing on pinned master .... 84   <- all of them
ATTRIBUTABLE TO THE MERGE .............  0
```

Two defects found and fixed, both interactions neither parent had:

1. **S4 x PACKET-AA** — master's parking block met the branch's expiry rail.
2. **GATE_READ_PATHS coverage** — a rail red on BOTH parents, naming paths the
   suite reads that the set did not list. Closing it TIGHTENS `C0`.

⚠️ If you re-gate, `gate_carry_over` is the authority:

    BASE=$(git merge-base origin/master HEAD)
    python tools/gate_carry_over.py <gated-sha> <landing-sha> "$BASE"

C4-Python is mandatory and never short-circuited by C0. Last run: 255 passed, exit 0.

---

## 3. Programme B — the master red sweep (RESUME HERE)

Branch `fix/master-red-sweep`, cut from master `451aed688`.
Worktree: `C:/Users/Patrick/uct-dashboard/.worktrees/master-fix`

### Fixed — 84 of 84, in seven commits (every one a TEST or HARNESS artifact; zero product code)

| commit | what | n |
|---|---|---|
| `521351f21` | TradeDetailPage + PositionDetailPage — AuthContext mock stubbed the HOOK, not the CONTEXT | 39 |
| `2c4cf75ff` | Watchlists.virtualized (same bug) · chartDrawDoor (useBreadthSymbols partial mock) · CotData.smoke (filter counted bootstrap calls) | 12 |
| `01a2ef403` | Screener.scanmount + Screener.door — a RENAME, and a write filter wider than its claim | 19 |
| `6e5bd692f` | FilterBand — #178's message claimed the deletion, the diff did not; completed it (`git rm` + the one `FilterRail` prop) | 6 |
| `9089356e3` | ScannerShell.review — the rail followed #163 to the door that exists (`ScreenerReviewOverlay`), same invariant | 4 |
| `5ac502a38` | surfaces/manifest — two routes undeclared · jsonFetcher rail — a TEST HARNESS (`marketIndicatorsHarness.jsx`) used raw `fetch().then(r=>r.json())`; routed through `jsonFetcher` (see §4) | 2 |
| `2a80003fc` | dailyFirstPaintAcceptance + dailyFirstPaintIncidental — WINDOW-DEPENDENT tests, not order-dependence and not a product bug (see §3b) | 1 (+2 more red on this tree) |
| *(no commit)* | `journal-2-0/lib/iteratorGlobalFloor.test.js` — ENVIRONMENTAL: it reads the BUILT `app/dist/assets` by design; `cd app && npm run build` → 9 passed. `dist/` is gitignored, so a fresh checkout reds it until built | 1 |

⭐ **Every one so far was a TEST artifact, not a product defect — and that was
MEASURED each time, never assumed.** Twice the wrong call would have hidden a real
bug (a duplicate fetch, a duplicate store write), so the actual requests were
dumped before any filter was narrowed.

### Remaining — none of the 84. What is still OWED

1. **Closing gate B** — the full six-shard gate on `fix/master-red-sweep` (clean tree, one
   gate at a time, never commit while it runs), classified BY NAME against the merged
   failing set with `classify.sh`. Any case red here and not in the merged-failing set was
   introduced by the sweep and must be zero. `iteratorGlobalFloor` needs `app/dist` built first.
2. **A PR for the sweep only with the owner's say-so** — "Do not open PRs to master
   without telling me."
3. **The plain-language summary** the owner asked for at the end.

### 3b. ⚰️ dailyFirstPaint — the note this file used to carry was WRONG

This file said: *"ALREADY SHOWN LOAD-SENSITIVE — passes alone, and fails a DIFFERENT
case each run (CASE A vs CASE B). Do NOT 'fix' it; it is order-dependence."* That was
an inherited label, and on this tree it was false: NC-B, NC-C (Acceptance) and CASE B
(Incidental) failed **identically across three solo runs**, and identically on the merge
worktree (master through `877dd173c`) — so not load, not order, not the 10-commit window.

**Measured cause — the WALL CLOCK.** Both files derive every fixture from
`expectedDailyTailForPaintET()` and read the real clock. After the bell (weekday 16:00 ET →
midnight, same ET day) the product DEFERS a today-dated daily cache to the network's sealed
close **by design** (`isDailyTodayCloseProvisionalForPaint`, `a663b0d67` 2026-09-02, the
no-flicker fix, railed with a pinned clock in `marketSession.dailypaint.test.js`). The tests
assume the cache paints first, were committed at **14:26 ET** (inside RTH, `81b12873f`) and
were green there — and red every day from 16:00 ET. Same tree, same code:

    real clock 18:12 ET ............ NC-B, NC-C, CASE B red   (control, 3 solo runs)
    clock pinned 14:26 ET today .... 18/18 and 5/5 green
    clock pinned 18:12 ET on the author's own day (2026-09-22) ... the same reds

**Fix (test-only):** `app/src/testing/pinnedWallClock.js` pins the clock to a STATED RTH
instant (shifted, still advancing — a frozen clock hangs the polling harness); both files
pin to Tue 2026-09-22 14:26 ET, each carries a by-name rail that the pin is load-bearing,
and Acceptance gained an **AFTER THE BELL** case that asserts the deferral at the level the
member sees it. Mutation-proved three ways (pin neutralised ×2, after-bell retarget made a
no-op). ⚠️ Noted, not changed: the Acceptance D-rows are `report()`ed, never asserted — the
matrix is printed, only its COUNT and the negative controls are rails. A follow-up, not a
red-sweep change (asserting them would add latency-sensitive reds under gate load).

### 3c. Gate B and the second wave — every remaining red on the sweep tree, classified

**Gate B** (`docs/plans/joystick/gate-runs/2026-09-24T18-04-13.*`, on `7e723f67a`): VALID —
tree hash unchanged start→end, 1,722 files reconcile, 24,296 tests, **38 red cases in 30
files**. Compared BY NAME against the merged tree's failing set (`d614a040f`, 120 cases):
**0 of the 87 cases the sweep targeted were still red**, 8 red here and not there, 32 shared.
⚠️ The manifest's own "NEW failures: 50" is against its stale joystick baseline
(`1216958ed`); the master deploy gate does not judge the vitest suite at all (promotion
control, secret scan, four scoped pytest rails, hygiene — all run locally on this branch and
green), so that number blocks nothing.

**Three lanes** (worktrees `.worktrees/sweep-lane-1..3`, branches `sweep/lane-1..3`,
protocol: test-only, single-file runs, report product questions instead of touching them)
took the 38; the integrator re-ran every touched file in its own tree before each merge.

| verdict | cases | what it is |
|---|---|---|
| **FIXED** (test-only, mutation-proved, integrated) | 8 | graphRuntime ×3 (port of the merge branch's ceiling-aware re-take; holds on master — the grammar commits #153..#170 grew `mid_engagement__22` to a 13,009-node plot over the 2,048 ceiling) · Layout.routeSuspense + Layout.pageTracking (NavBar mocks dropped the real `NAV_ITEMS` that `surfaces/pageTitle.js` reads since S1 CP2 `8baca199b`) · pine.tupleBuiltins (probe moved to `ta.percentrank`, supertrend as its own CONTROL) · carriedState (`ta.valuewhen` is admitted since #166 `d67e2fddb`; assert what it computes) · reachable (R-29 recorded PENDING in `AWAITING_A_DECISION`) |
| **NEEDS-CORPUS** (environmental, by licence) | 17 | `tests/fixtures/pine_oos` withholds **29 of 59** scripts by its own `.gitignore` ("licence does not contemplate redistribution; re-fetch from the manifest URL and verify against `sha256_source`") and `tests/fixtures/oos2_parity` withholds all ten. Every red count reconciles exactly to the absent files (paramIds 299 vs >300, oosMeasuredBaseline 30 vs >50, history/capability census 129 vs >150, recurrenceSteps/visualDemand/objectDemand 30 vs 59, documentSize/graphSize buildable 8/7 vs >10, visualParitySet 5 of 10, objectLadder ENOENT ×2). The sources are 30 `www.tradingview.com/script/...` pages; **no checkout on this box has them**, 14 of 30 have sha-verifiable copies elsewhere on the box, 16 need a browser re-fetch. ⚠️ Once present, `oos-measured-baseline.json` (pinned on a 30-file checkout) goes red with `added=29` until regenerated with `OOS_MEASURED_WRITE=1` — an owner-ruled artifact. Floors are RIGHT; do not widen them. |
| **PRODUCT-BUG-SUSPECTED** (reported, untouched) | 4 | pineBoxSuggestVoice ×3 + ImportBox.thinkscript: since `e855f62cd` (#145) `pine.js:8048` `if (isBindFoldableLength(resolved)) { out.push(resolved); continue }` runs BEFORE the `pine:window` refusal, and `parse.js:302 bindFoldableWindow` answers `{foldable:true, max:27.5}` for a literal `num` — so `plot(ta.wma(close, 27.5))` leaves the door as "translates" with NO offer, then `evaluateFormula` refuses ("a window must be a whole-number literal … got 27.5"). The old door refusal carried `suggest hma(close, 55)` (`windowSuggestion`, still present, now unreached). Member-facing. One-line fix at 8048 (do not defer a literal that is not a usable window; `usableWindowBound` already answers null for 27.5) — **owner's call**. |
| **PRODUCT-CONTRACT** (reported, untouched; instrument fixed) | 1 | BuilderSheet.pine "the SAVED DOCUMENT is byte-identical to the same formula typed by hand": the finder took the first POST (import telemetry, `indicatorTelemetry.js:21`) and threw a TypeError — fixed by keying on `USER_DEFINITIONS_KEY` (measured wire: GET, telemetry ×2, save). With the save found, the diff is additions-only (paramManifest, scanPlot, sources, a second `signal` plot; `compute.fn` sha identical). Its sibling case celebrates those knobs. Ruling needed: is a Pine-authored document "one object" with a typed one? Left RED on purpose rather than widening `toEqual`. |
| **BRANCH-SHAPE** | 1 | hub/rule12Paths: fires because this change set touches `app/src/hub/sections/chartDrawDoor.test.jsx` (and the gate manifests under `docs/plans/joystick/`) AND two `journal-2-0` test files. Green on master (empty diff). A rail-scoping ruling for its owner; a PR split would not cure it while gate manifests live under the joystick prefix. |
| **lane 2's cluster** | 7 | **FIXED 10** (all ports or stale assertions overtaken by master's own commits; each mutation-proved): stockChartWiring (port of the merge re-take's `paints()` predicate, re-measured here — the one series after the engine block is the invisible future-axis whitespace series; 451aed688's gap-run series are minted inside the binder's bind pass, so NOT a window regression) · controlDoorCensus (ledgers `testing/scan/scanHarness.jsx`, on master since `a974dd77a` 9/21) · memberPaneGate (ledger says `armed` since `c2c048653` 9/18 — the test expected `dark`; ⚠️ `memberPaneGate.js` header still says nothing renders a member's Pine, product-docs drift, reported) · ChartDrawingOverlay.surfaces (text-distance probe read the checkout's CRLF; normalised, span NOT widened) · Layout.routeSuspense + Layout.pageTracking (NavBar mocks keep the real `NAV_ITEMS` that `surfaces/pageTitle.js` reads since S1 CP2) · formulaLibrary.route (ruling holds; the READER broke when `307d7e2fb` moved `FREE_PAGES` to `constants/freePages.js` — now read at its home and AuthGuard's consumption proved) · Login.totp ×2 (`finishLogin()` routes on `paid_equiv` since `307d7e2fb`; fixtures without it were FREE members landing on `/morning-wire`, correct product behaviour) · usePreferences.additionsOnly (declares the two opaque-key call sites master added: `BreadthChartsV2.jsx` `breadth_charts_state`, `useColumnPresets.js` `screener_column_presets` — ⚠️ a NEW member-preference key with no other declaration). **OWNER-DECISION 1**: pollingSites.rail — NOT load-sensitive (red alone ×2): 13 new bare `useSWR refreshInterval` sites in 9 files landed 9/03–9/23, each needing a bare-vs-`useMobileSWR` ruling the rail forbids silencing; phone-reachable ones: `chart/useBoundDrawingAlerts.js` (60s, via StockChart), `floor2/hooks/useFloor.js` ×5 (10–30s), `hooks/useFilingWatch.js` (30s, TickerHubSheet/TickerPopup); admin-only: ChatModerationPanel, CompassHealthPanel, ThemeEngineHealthPanel, PatternAdmin ×2; plus `useWatchlistIntelligence.js` (120s), `pages/OpenFlow.jsx` (120s). 
|

### 3d. What is still owed

1. ✅ **Gate C ran** (`docs/plans/joystick/gate-runs/2026-09-24T18-59-50.*`, on `a25c8a77a`,
   18:38–19:01 CT): VALID — tree hash unchanged start→end, 1,722 files reconcile, 24,304 tests,
   **24 red cases in 17 files**. By name against gate B: **0 NEW, 16 FIXED**; the 24 that remain
   are exactly the classified set — 17 NEEDS-CORPUS, 5 product (4 fractional-window + 1
   contract), rule12 (branch-shape), pollingSites (owner decision). Nothing the second wave
   touched regressed anything. Gate B → C on this branch: 38 → 24 red cases; master's own
   reds before the sweep: 84 targeted + these.
2. **Your rulings**: the `pine.js:8048` fractional-window bypass (member-facing); the
   BuilderSheet document contract; rule12's scoping; whether to re-fetch the 30 withheld
   TradingView scripts on the rig (and regenerate the OOS baseline sidecar under
   `OOS_MEASURED_WRITE=1`).
3. **A PR only with your say-so.** Master moved 2 docs/flags/tools commits under the branch
   with zero file overlap — merges clean, no rebase.

### 3e. Owner walkthrough — what only you can do, in order

1. **Say "open the PR"** (or open it yourself): base `master`, head `fix/master-red-sweep`,
   body prepared in the session scratchpad as `PR-BODY-red-sweep.md`. `gh` is not
   authenticated on this box and `GITHUB_PERSONAL_ACCESS_TOKEN` is invalid — either run
   `gh auth login` in a normal terminal / replace the token at github.com/settings/tokens
   (scopes `repo`, `read:org`) and restart Claude Code, or the agent opens it through the
   browser as it did for #184. Merging is the usual "deploy" + member-impact call: this is
   test-only plus the four product files above, so the member impact is nil.
2. **Rule on the fractional-window bug** (member-facing, since #145): say "fix it" and the
   agent changes ONE line at `pine.js:8048` (do not defer a literal `num` that is not a usable
   window — `usableWindowBound` already answers null for `27.5`), adds a rail, and the four
   red cases in `pineBoxSuggestVoice` / `ImportBox.thinkscript` go green. Or leave it to the
   pine programme.
3. **Rule on the BuilderSheet contract**: which sibling case is right — "the saved document
   is byte-identical to the typed one" or "the author's lengths arrive as FIELDS". One of
   the two tests changes; no product code either way unless you want the door to strip the
   knobs.
4. **`rule12Paths` scoping** (hub rail owner): decide whether gate manifests under
   `docs/plans/joystick/gate-runs/` and `fix/`-family branches should count as a joystick
   change set. Green on master regardless.
5. **The withheld corpus** (optional): on the rig's browser, re-fetch the 30 `local-only`
   scripts named in `tests/fixtures/pine_oos/MANIFEST.json` from their `source_url`, verify
   each against `sha256_source`, then run the OOS baseline with `OOS_MEASURED_WRITE=1` to
   regenerate `oos-measured-baseline.json`. 17 census cases go green on that checkout only.
6. **13 bare polling sites**: for each row in §3c's lane-2 cell, say bare or `useMobileSWR`;
   the agent then declares them in `pollingSites.rail.test.js` with your reason.


---

## 4. ✅ jsonFetcher — RESOLVED, and it was NOT a product bug

`src/utils/jsonFetcher.test.js` said *"these surfaces hand a NON-OK body to their consumer
as if it were data"*. Read before touching anything: the surface it named was
`src/testing/marketIndicators/marketIndicatorsHarness.jsx` — a TEST HARNESS, not a member
surface — with three raw `fetch(url).then(r => r.json())` sites. Each already had a `.catch`;
they were routed through `jsonFetcher(url)` (which throws on non-OK) in `5ac502a38`. No
member-facing code handed an error body to a consumer. The rail was right to fire; the
offender was ours.

---

## 5. Environment — what survives a restart

| path | state |
|---|---|
| `.worktrees/vite-arg-fix` | merge branch — KEEP |
| `.worktrees/master-fix` | red sweep — KEEP, carries `.uct-session-owner` |
| `.claude/worktrees/pine-value-model` | the baseline branch — KEEP |
| `.worktrees/master-check` | already removed cleanly; junction detached, target verified intact |

⛔ **`.worktrees/master-fix/app/node_modules` IS A DIRECTORY JUNCTION** pointing at
`.worktrees/vite-arg-fix/app/node_modules`. It survives a restart. If you ever
remove it, use `cmd /c rmdir <link>` with **NO `/s`** — `Remove-Item -Recurse`
and `rm -rf` FOLLOW the junction and destroy the real `node_modules`. This repo
has a graveyard entry for exactly that. Verify first:

    Get-Item <link> -Force | Select-Object LinkType, Target

The scratchpad holds gate logs and probe scripts and is session-scoped — it MAY
BE LOST. Nothing needed to resume lives only there; the gate manifests are
committed under `docs/plans/joystick/gate-runs/`.

⚠️ Untracked and deliberately left alone: `.claude/worktrees/pine-value-model`
holds two gate-run artifacts from the baseline gate plus one pre-existing
`sandbox-runs` file that is NOT mine. Leave that third one where it is.

---

## 6. Two things blocked on you

1. **`gh` is not authenticated.** The device flow timed out twice when run as a
   background task. Run `gh auth login` in a NORMAL terminal where you can watch
   the countdown, or set a real `GH_TOKEN`.
2. ⛔ **`GITHUB_PERSONAL_ACCESS_TOKEN` is set but INVALID** — 25 characters, and
   `gh auth status` rejects it. That is also why the `github` MCP server fails at
   startup with "Authorization header is badly formatted". Replace it at
   github.com/settings/tokens (scopes `repo`, `read:org`) and restart Claude Code.

---

## 7. Standing method — keep using it

- **0-NEW against a MEASURED baseline, compared by failing TEST NAME**, never counts.
- **Mutation-prove every rail**: revert exactly its layer, watch it red, restore
  from captured bytes with sha256 re-verified — never `git checkout --`.
- **Measure before narrowing a filter.** A count that looks like a test artifact
  can be a duplicate write. Dump the actual requests first.
- ⭐ **An absence is only evidence if the instrument could have seen a presence.**
  A truncated Testing Library DOM dump nearly produced a wrong diagnosis here.
- **One gate at a time on this box**, and never commit while a gate runs — it
  refuses itself for TREE DRIFT, correctly.
