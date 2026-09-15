# Stage-2 merge result, pre-flighted — 2026-09-15

> **The merge Patrick has not made yet was built locally, measured, and thrown away.** No branch was
> pushed, `launch/stage-2-member-preview` is untouched at `2ae7e98aa`, and nothing was merged. What
> this buys is knowing the answer *before* he is asked for the one action only he can take.

**master `65899a8f7`** · frozen branch `2ae7e98aa` · local merge result `278337d1f` (discarded)

## 1 · It still merges clean

| | |
|---|---|
| merge-base | `4fb4f9daf` |
| behind master | **574 commits** |
| `git merge-tree --write-tree` | **exit 0, 0 conflicts** |
| files stage 2 changes (three-dot) | **26** |

⚠️ **Four files overlap** with what master changed since the base — `CLAUDE.md`, `closure.md`,
`glass-acceptance-steps.md`, `rollout.md`. Git auto-merges all four. Being behind by 574 commits is
not drift; **no rebase is required and `2ae7e98aa` is not rewritten.**

## 2 · ⭐ The generated artifact survives the merge — checked, not assumed

This was the real risk, and it is not obvious. `glass-acceptance-steps.md` is **generated** and
**byte-compared** by `src/hub/surfaceMatrixIsCurrent.test.js`. After a stage-2 merge the three
inputs come from different sides:

* `registry.js` — the **frozen branch's** (stage 2: `PREVIEW_MODES` emptied)
* `tools/hub_surface_matrix.mjs` — **master's** (emits `D1-a11y` since `edf888822`)
* the artifact — a **three-way merge** of both

The frozen branch's artifact carries the pre-rename `| D1 |`; master's carries `| D1-a11y |`. If the
merge had kept the branch's line, the rail would have gone **red on master the moment stage 2
landed** — the exact failure that cost this programme a baseline row and a fix PR two days ago.

It does not. Measured on the real merge result:

```
committed artifact sha256: 51ce69db2aa297fed8aa4e139bea4c8a
regenerated       sha256: 51ce69db2aa297fed8aa4e139bea4c8a
IDENTICAL (LF-normalised): True
```

`surface-matrix.md`, the other byte-compared artifact, is identical below its marker too.

## 3 · The merge result passes §2's own criterion

Run on the local merge result, scoped, under the box lock, sampler **CLEAR**:

```
the two rails 0.1 names + the artifact rail
  Test Files  3 passed (3)
       Tests  21 passed (21)                                    exit 0

npm run test:hub   (the whole hub subset)
  Test Files  1 failed | 88 passed (89)
       Tests  1 failed | 1165 passed (1166)                     exit 1

VERDICT=CLEAR exit=0 samples=19 min_free_gb=8.29     ADMISSIBLE
```

`stage-2-verification.md` §2 predicts exactly this:

> *"`npm run test:hub` — 89 files / 1166 tests; only `styles/tapFloor.test.js` may fail.*
> ***PASS:** only the `tapFloor` baseline entry fails.*
> ***STOP:** anything else fails → the merge picked up something the branch gate did not see."*

**89 files, 1166 tests, exactly one failure, and it is `tapFloor`** — which is one of the ten
baseline entries on master. That is the documented PASS, matched down to the counts.

⛔ **This is a pre-flight, NOT the post-merge gate.** §2's own addition still requires the gate to
run against the **actual merge commit** once it exists, with `VERDICT=` as arbiter, a CLEAR sampler
and file reconciliation. A local merge is the same tree but not the same commit, and the thing the
baseline is compared against is a commit. Nothing here substitutes for that.

## 4 · What it does not tell you

⛔ Nothing about **glass**. Boxes 1 and 2 remain ☐, §5A is unjudged, and the exposure change this
merge makes — `home.wire` inner→OUTER, `home.journal` OUTER→inner — is a member-visible layout move
that no local suite can see. jsdom performs no layout.

⭐ The value of this document is narrow and worth stating plainly: **the mechanical half of the
stage-2 merge is de-risked.** What remains is the half that always did — a real finger on real
glass, and Patrick's hand on the merge button.
