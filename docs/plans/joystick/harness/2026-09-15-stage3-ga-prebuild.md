# Stage 3 (GA), pre-built and gated — 2026-09-15

> **The stage-3 PR now exists as a branch, measured, with zero NEW failures against baseline 10.**
> ⛔ It is **NOT OPENED**, and it must not be until `rollout.md` §3 c lands and boxes 1, 2 and 5 are
> ticked on evidence. **Patrick merges** — a member-facing rollout is never an agent's to merge.

| | |
|---|---|
| branch | **`launch/stage-3-ga`** — `3164cccac`, pushed |
| built on | `launch/stage-2-member-preview` @ **`2ae7e98aa`** (frozen, untouched) |
| master at the time | `79b4b2907` |
| local merge result gated | `2dfb5dcbe` — **discarded**, as the stage-2 pre-flight's was |

## 1 · ⭐ Why this branches off stage 2 and NOT off master

The task said *"a branch off master"*. Measured rather than assumed:

```
origin/master                         export const ROLLOUT_STAGE = 1
origin/launch/stage-2-member-preview  export const ROLLOUT_STAGE = 2
```

**A branch off master would have been a 1 → 3 diff**, and it would have swallowed stage 2's
widening inside a commit labelled "GA" — the one change in this programme that must arrive on its
own, with its own member-impact paragraph. The coherent branch point for a **2 → 3** delta is the
branch that performs the 2.

⚠️ **The merge order this implies, stated rather than left to be discovered.** `launch/stage-3-ga`
contains stage 2's commits. If stage 2 is **squash**-merged at §3 a (the method used for #137–#142),
master gains stage 2's *content* under a new sha that is not an ancestor of this branch. The
three-dot diff below is still correct, and `merge-tree` reports the merge clean **today**; re-run it
after §3 a lands, because that is the moment the ancestry changes.

## 2 · ⭐⭐ §2(b) IS ANSWERED — and stage 2 answered it

§3 d is conditional: *"Stage 3 PR per §1, **once §2(b) is answered**."* §2(b) asked whether
emptying `PREVIEW_MODES` at stage 3 would land two full fans together with the GA flip — *"which
**is** new member-visible behaviour"* — and recommended shipping `home` and `flow` on their own
increments first so GA stays copy-only.

**The recommendation was taken, one rung early.** Measured on this branch's parent:

```
PREVIEW_MODES on launch/stage-2-member-preview : 0 entries
```

The stage-2 commit flipped the final two in the same change as the widening and stated the one
member-visible consequence **in the diff** rather than leaving it to a screenshot — `home.wire`
inner → OUTER, `home.journal` outer → INNER.

⭐ So the two fans land with **stage 2**, not with GA, and §2(b)'s *"no new behaviour at stage 3"*
now holds **exactly as written**. The precondition §3 d names is met. ⛔ This does not unblock §3 c
(D-39), which is a separate condition and is **not** met — see §6.

## 3 · What actually changes, and what deliberately does not

| | |
|---|---|
| `ROLLOUT_STAGE` | **2 → 3** |
| the Settings card label | drops **"(preview)"** |
| **everything else** | **unchanged** |

⛔ **`unsetDefault()` and `cardVisible()` were NOT touched.** Both threshold at `>= 2`, so stage 3
resolves identically to stage 2 for every user — which is what GA means on this ladder. `STAGE_NAMES`
already carried `3: 'general availability'`; `exposureGate.test.js` already carried a stage-3
`STAGE_TABLE` row **and its `ROW_DIGESTS` entry**, recomputed 2026-09-13.

⭐ **Neither needed an edit, and neither got one.** Editing a pinned digest so it matches a product
change is the precise thing digests exist to prevent, and a stage-3 PR that touched `ROW_DIGESTS[3]`
would look exactly like a stage-3 PR that had to.

## 4 · ⛔ The new rail — because every existing rail passes a RENAME

`stageLadderAgreement.test.js` proves stages 2 and 3 agree on exposure. That is its job, and it is
also its blind spot: **a rung that renames itself and changes nothing passes every one of those
checks.** For a rung whose entire deliverable is copy, that is the failure that could ship.

The added block reads `JoystickSettingsCard.jsx`, **strips comments first** — the component says
*"live admin preview"* in one, which is history, not copy on a member's screen — and at stage ≥ 3
fails if the word still reaches the member. Two controls ride with it: one proving the file was
really read and the stripper did not eat the body, one planting the word and proving the scan can
still see it.

**Mutation-proved.** With `(preview)` put back:

```
× at stage 3 the card's member-facing copy says nothing about a preview
  AssertionError: ... expected [ 'preview' ] to deeply equal []
  Test Files  1 failed (1)       Tests  1 failed | 13 passed (14)
```

⭐ **And it was the ONLY thing that fired** — the exposure rails, the `PREVIEW_MODES` rail and both
controls stayed green. A rail that reds for its own reason and nothing else is the discriminating
kind. Restored by writing back captured bytes and re-checking the hash
(`34abbbe6e4787ec5`, 18,681 bytes) — **never `git checkout`**.

## 5 · The gate

Run on the **local merge result** (`origin/master` + `launch/stage-3-ga`), tree clean, under the
machine-wide box lock, sampler wrapped:

```
merge-tree --write-tree     exit 0, 0 conflicts, tree af7931ad6
                            merge-base 4fb4f9daf, 575 behind, 27 files (three-dot)

the stage ladder, exposure gate, framing rail and the byte-compared artifacts
  Test Files  8 passed (8)
       Tests  106 passed (106)                                 exit 0

npm run test:hub   (the whole hub subset)
  Test Files  1 failed | 88 passed (89)
       Tests  1 failed | 1168 passed (1169)                    exit 1

VERDICT=CLEAR exit=0 samples=12 min_free_gb=8.39                ADMISSIBLE
```

**The one failure is `src/styles/tapFloor.test.js` — baseline entry #9 of 10.** `failures[]` holds
ten; nothing outside them failed. **Zero NEW.**

⭐ **The test count reconciles, and that is the check worth keeping.** The stage-2 pre-flight
measured **1166** tests across 89 files on the same subset. This run reads **1169** across **89** —
**exactly +3**, which is the three cases added in §4, in a file that already existed so the file
count could not move. A subset that quietly ran fewer files would fail in the flattering direction;
this one accounts for every test it gained.

`glass-acceptance-steps.md` sha256 (LF-normalised) **`51ce69db2aa297fed8aa4e139bea4c8a`** —
byte-identical to the stage-2 pre-flight's measurement, which is the expected answer:
`hub_surface_matrix.mjs` never reads `ROLLOUT_STAGE`, so a stage move cannot move the artifact.
`surfaceMatrixIsCurrent.test.js` is what proves it rather than this sentence.

### ⚰️ The first attempt was VOID, and it is recorded rather than dropped

An earlier run of the same rails, 14:05, came back **`VERDICT=INCONCLUSIVE-CONTENDED exit=3
samples=17 min_free_gb=5.39 first_seen=2026-09-15T14:05:18 pid=53420 kind=vitest intruders=39`**.
Its rails were green — 78 and 23 passing, both exit 0 — and **it is still not a measurement.**

⛔ It was not retried into load. Ground truth confirmed the sampler was right: pid 53420 was another
session's `vitest.mjs run src/components/chart/engine src/components/chart/builder
src/components/chart/pane` with 13 workers, beside a `pytest test_render_e2e`, a wisdom-loop pytest,
a pine `boot_rig.py` and a discord-render soak job. The box cleared on its own ~5 minutes later and
the run above is the one that counts.

⚠️ **And the near-miss is the instructive half.** A throwaway probe read `x.get("cmdline")` and
printed thirteen intruders with blank command lines, which reads exactly like a sampler
misclassifying idle processes. The field is **`command_line`**. The broken instrument was mine, and
`tools/gate_box_sampler.py` had carried the right value all along — one field name away from filing
a defect against a tool that was working.

## 6 · ⛔ What this does NOT mean

- **§3 c is NOT met.** D-39 (chip under the Journal FAB, 6 pairs at 360/375/430) is ruled **fix
  before stage 3**, and it is held pending Patrick's bug list. A gated branch is not a met condition.
- **Boxes 1, 2 and 5 are NOT ticked.** Glass is unjudged; nothing here touches that.
- **This is not the post-merge gate.** `stage-2-verification.md` §2 requires the six-shard gate on
  the **actual merge commit**, `VERDICT=` as arbiter, a CLEAR sampler and file reconciliation. This
  is a pre-flight at the hub-subset tier on a tree that will never be deployed. It lowers the odds
  of a surprise; it replaces nothing.
- **Stage 2 has not merged.** `2ae7e98aa` is untouched and still frozen.

## 7 · ⚠️ One measurement worth carrying forward — `git show` is not how you read stored endings

R-2 requires writing a file with **the endings git already stores**. The helper used here decided
that by running `git show HEAD:<path>` from a Python subprocess and testing for a CRLF pair. It
answered **LF** for all five files. `git cat-file blob` says they are **uniformly CRLF**:

```
app/src/hub/rolloutStage.js                      parent  87/87  CRLF   mine 100/100 CRLF
app/src/hub/stageLadderAgreement.test.js         parent 151/151 CRLF   mine 205/205 CRLF
app/src/pages/settings/JoystickSettingsCard.jsx  parent 370/370 CRLF   mine 370/370 CRLF
```

⭐ **The commit is correct anyway** — `core.autocrlf=true` supplied the CRLF at `git add` time, the
diff is **86 insertions / 13 deletions** rather than a whole-file rewrite,
`tools/check_repo_hygiene.py` reports clean, and every file's CR count moved by exactly the number
of lines added. **But it is correct by luck, not by design**, and the next run should not inherit
the luck: read stored endings with **`git cat-file blob`**, never with a CRLF test over `git show`.

⚠️ This narrows the provenance rule rather than contradicting it. `git show <sha>:<file>` remains
the right way to ask what a committed file **says**; it is not the way to ask what bytes it **ends
its lines with**.
