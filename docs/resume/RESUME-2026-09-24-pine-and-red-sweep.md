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
| **B. Master red sweep** | `fix/master-red-sweep` | `01a2ef403` | yes | **IN PROGRESS — 70 of 84 fixed, 14 left** |

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

### Fixed so far — 70 of 84, in three commits

| commit | what | n |
|---|---|---|
| `521351f21` | TradeDetailPage + PositionDetailPage — AuthContext mock stubbed the HOOK, not the CONTEXT | 39 |
| `2c4cf75ff` | Watchlists.virtualized (same bug) · chartDrawDoor (useBreadthSymbols partial mock) · CotData.smoke (filter counted bootstrap calls) | 12 |
| `01a2ef403` | Screener.scanmount + Screener.door — a RENAME, and a write filter wider than its claim | 19 |

⭐ **Every one so far was a TEST artifact, not a product defect — and that was
MEASURED each time, never assumed.** Twice the wrong call would have hidden a real
bug (a duplicate fetch, a duplicate store write), so the actual requests were
dumped before any filter was narrowed.

### Remaining — 14

    cd C:/Users/Patrick/uct-dashboard/.worktrees/master-fix/app
    npx vitest run src/pages/screener/shell/FilterBand.test.jsx       src/pages/screener/shell/ScannerShell.review.test.jsx       src/utils/jsonFetcher.test.js src/surfaces/manifest.test.js       src/pages/journal-2-0/lib/iteratorGlobalFloor.test.js       src/components/dailyFirstPaintIncidental.test.jsx

| n | file | what is known |
|---|---|---|
| 6 | `screener/shell/FilterBand.test.jsx` | not yet diagnosed |
| 4 | `screener/shell/ScannerShell.review.test.jsx` | fails on missing `[data-testid="review-charts"]` |
| 1 | `utils/jsonFetcher.test.js` | ⛔ **LOOK HERE FIRST — see section 4** |
| 1 | `surfaces/manifest.test.js` | likely master's new research FlowTab route needs a declaration |
| 1 | `journal-2-0/lib/iteratorGlobalFloor.test.js` | not yet diagnosed |
| 1 | `components/dailyFirstPaintIncidental.test.jsx` | ⭐ **ALREADY SHOWN LOAD-SENSITIVE** — passes alone, and fails a DIFFERENT case each run (CASE A vs CASE B). Do NOT "fix" it; it is order-dependence |

---

## 4. ⛔ THE ONE THAT MAY BE A REAL PRODUCT BUG

`src/utils/jsonFetcher.test.js` fails with:

> "these surfaces hand a NON-OK body to their consumer as if it were data."

This is the ONLY remaining failure whose wording describes something a MEMBER
would see — an error response rendered as content. If it is real, **the fix is in
product code, not in the test**, and it is a decision to land rather than a
cleanup.

⛔ Do not make this pass by narrowing a filter without first reading what the
named surfaces actually do with a non-OK response.

⚠️ CLAUDE.md records `jsonFetcher` / `pollingSites` as rails that fire ONLY in
the FULL suite, so isolation may not reproduce it.

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
