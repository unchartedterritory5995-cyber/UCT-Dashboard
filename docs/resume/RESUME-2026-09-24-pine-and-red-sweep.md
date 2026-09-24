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
| **B. Master red sweep** | `fix/master-red-sweep` | `2a80003fc` | yes | **ALL 84 ADDRESSED — closing six-shard gate still owed** |

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
