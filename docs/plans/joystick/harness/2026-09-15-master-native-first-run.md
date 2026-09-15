# The first MASTER-NATIVE harness run — 2026-09-15

> **Both instruments and both subjects are now master's.** Every earlier run in this programme
> borrowed the lock and the sampler from an unmerged branch and said so. This one does not borrow
> anything, and that is the only thing that makes it a baseline rather than a rehearsal.

**master `edf888822`**, reached by two squash merges:

| PR | merge SHA | what landed |
|---|---|---|
| **#138** | `34904394e` | the gate box lock, the continuous sampler, the exit-code fix, the `VERDICT=` line |
| **#139** | `edf888822` | the surface-matrix generator emits `D1-a11y`; the baseline row comes back out |

---

## What was run, and under what

Both jobs ran **scoped**, wrapped by the continuous sampler, while this session **held master's own
box lock** (`C:\ProgramData\uct\gate-box.lock`). Sampling interval 3 s — derived for these short
subjects the same way the committed 20 s constant is derived for a six-shard gate: at least ten
samples inside the shortest thing that must not pass unseen.

```
VERDICT=CLEAR exit=0 samples=16 min_free_gb=6.46
ADMISSIBLE: YES
```

16 samples across the whole interval, **no foreign gate or vitest worker in any of them**.

### 3.4 · `tools/gate_box_sampler.py --self-check` — exit 0, PASS

Every verdict the sampler can return is reachable, and the precedence controls hold:

```
ok   CLEAR                    <- a quiet interval
ok   INCONCLUSIVE-CONTENDED   <- a gate appearing mid-interval
ok   INCONCLUSIVE-RESOURCE    <- free memory through the floor
ok   INCONCLUSIVE-UNOBSERVED  <- a snapshot that could not be taken
ok   INCONCLUSIVE-NO-SAMPLES  <- nobody looked
ok   contention outranks resource when both are true
ok   contention outranks an unobserved sample
ok   ...and decides it once the intruder is gone
ok   interval 20s <= shortest measured shard 274.29s / 10 = 27.4s
self-check: PASS
```

### 3.5 · `src/hub/surfaceMatrixIsCurrent.test.js` alone — exit 0

```
✓ surface-matrix.md matches the registry as it stands            591ms
✓ glass-acceptance-steps.md matches the registry as it stands    357ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  38.42s
```

⭐ **The second of those was RED on master until `edf888822`.** It is the rail another workstream
had to baseline because PR #137 hand-edited a generated artifact without updating its generator.
Green here, on master, with no branch in the picture — which is what closes that loop.

---

## The EXIT_* derivation rail, run from master

```
0  EXIT_NO_NEW                -> VERDICT=NO_NEW_FAILURES
1  EXIT_NEW_FAILURES          -> VERDICT=NEW_FAILURES
2  EXIT_INVALID               -> VERDICT=INVALID
3  EXIT_DID_NOT_RECONCILE     -> VERDICT=DID_NOT_RECONCILE
4  EXIT_LOCK_HELD             -> VERDICT=REFUSED-LOCK
unnamed: none
```

`1 passed, 46 deselected, 2351 warnings in 0.47s`

And the sampler's own table, also from master — `EXIT_UNOBSERVED` present:

```
0  CLEAR
3  INCONCLUSIVE-CONTENDED
4  INCONCLUSIVE-RESOURCE
5  INCONCLUSIVE-NO-SAMPLES
6  INCONCLUSIVE-UNOBSERVED
```

## The baseline on master

| | |
|---|---|
| `failures[]` | **10** |
| `#9 presentationSingleFormatter` | `provisional: true` — untouched |
| surface-matrix removal in `removals[]` | present (2 entries total) |
| the other workstream's `additions[]` record | intact (5 entries total) |
| surface-matrix still in `failures[]` | **no** |

## Wiring confirmed on master

```
tools/gate_box_lock.py       PRESENT
tools/gate_box_sampler.py    PRESENT
import gate_box_lock         1
gate_box_lock.release()      1   (in finally)
EXIT_LOCK_HELD               4
```

---

## ⚠️ One defect found while opening these PRs, not yet fixed

`docs/plans/joystick/harness/2026-09-14-gate-harness-pr-body.md` — now on master via #138 —
contains **two raw U+0001 bytes**, at the two places it means to write the text `\x01` and
`\u0001`. A patch script of mine wrote the control character itself instead of its escape.

⭐ It is only a doc, and it is *fittingly* the very byte class that caused the sampler crash that
document describes. The PR body posted to GitHub had them replaced with the visible escapes, so
what a reviewer reads is correct; the committed file is what is wrong. ⛔ Not fixed here because
this manifest's branch is scoped to the manifest — it is a one-line follow-up.

## What this manifest does NOT claim

⛔ **No full gate was run.** Nothing here says the suite is green; it says these two scoped
subjects are, on a box the sampler observed continuously and found clear. The lock protects only
runs that go through `scripts/gate_shards.py` — `2026-09-14-gate-lock-adoption.md` lists everything
that does not, and that list is unchanged by these merges.
