# E.3 — what the gate contention test will show, written BEFORE the pushes

**Status: PREDICTION. Nothing in this file is an observation.** It is committed before
E.1/E.2 are pushed so that the predictions cannot be written to fit the result. E.5
records what actually happened, beside this, without editing it.

Session 9, Workstream E. Authorisation **E1** — two docs-only pushes to master for the
purpose of contending the `master-deploy` concurrency group.

---

## 1. Why a deliberate test is needed at all

`.github/workflows/master-deploy-gate.yml` serialises master deploys. Its own header
states the mechanism it relies on:

> GitHub queues runs in one concurrency group, and Railway's "Wait for CI" holds the
> build until the run for that commit passes — so two pushes three minutes apart become
> two builds in sequence, never a swap inside somebody's request.

⛔ **That sentence has never been exercised.** Measured over **every** run the workflow
has had — **36 runs**, `2026-09-14 19:00:49Z` → `2026-09-15 05:10:55Z`, read from the
Actions API — **the concurrency group has queued exactly zero runs behind another.**

| quantity | measured over 36 runs |
|---|---|
| queue wait before the job starts | **3–5 s** on 34 of 36 |
| the two exceptions | 13 s and 39 s — **neither had a predecessor still running**, so both are runner allocation, not the group |
| job execution | **93–136 s** |
| created → last job completed | **96–169 s**, median ≈ 130 s |

And the closest any two runs have ever come:

| new run created | predecessor completed | margin |
|---|---|---|
| `6b606990c` 05:10:55 | `1571e2f87` 05:10:33 | **22 s** |
| `5e88b38c4` 03:25:11 | `07cd3319c` 03:23:35 | 96 s |
| `7707b2241` 21:30:12 | `decb1a03c` 21:29:28 | 44 s |

⭐ **Twenty-two seconds is the entire safety record of this mechanism.** The gate has
never queued anything, so "runs execute strictly one at a time" is a configuration
reading, not a measurement — every green run to date is equally consistent with the
concurrency block being absent.

## 2. What the timings say the gate actually does

The protective mechanism is **not** the one the header describes, and the difference
decides whether the gate is worth keeping.

Correlating the 20 most recent `web` deploys against their gate runs by commit SHA:

- A Railway deploy record's `createdAt` is the **push** time, not the build start —
  `1571e2f87`'s deploy is stamped 05:08:22 and its gate run was created 05:08:23.
- The pod that is serving now (`6b606990c`) **booted at 05:12:55Z** — derived from
  `uptime 395` at `05:19:30Z` on the live pod, not from a Railway field.
- Its gate run completed at **05:12:53Z**.

⭐ **The cutover happens 2 seconds after the gate passes** — and a container build does
not take 2 seconds. So Railway is **building concurrently with CI and holding only the
cutover**. That matches Session 8's promotion reading (+1–3 s after the gating check)
and it contradicts the header's "holds the build".

**Consequence, and this is the load-bearing derivation:**

```
cutover(X) ≈ push(X) + gate_total(X)                 when X's run is not queued
cutover(B) ≈ cutover(A) + exec(B)                    when B's run IS queued behind A
```

Because a queued run still has to *execute*, the floor on the spacing between two
cutovers is **exec(B) ∈ [93, 136] s**, whatever the push interval. The gate does not
prevent two builds from overlapping — they already overlap — it **spaces the two
traffic swaps by at least one gate execution.**

⚠️ **That is a narrower guarantee than the workflow claims, and the margin is not
comfortable.** The incident this gate was installed for (2026-09-14, `7705c2d3b` then
`9e2b93805` 173 s later) served 502 for ~45 s and killed an in-flight request after
93 s. A floor of 93 s against a disruption window of up to 93 s is a coin flip, not a
guard. **If the predictions below hold, the gate is real but its margin should be
stated in the runbook as ~95 s, not as "never a swap inside somebody's request".**

## 3. The predictions

Two docs-only commits, pushed **Δ ≈ 20 s apart** — chosen because it is comfortably
below the 96 s floor on gate duration, so run B is created while run A is certainly
still executing. Call them A and B.

**P1 — the discriminator, and it needs no Railway access.** Run B's queue wait jumps
from the 3–5 s baseline to **roughly `gate_total(A) − Δ`, i.e. 75–150 s**.
→ *Falsified if* B's queue wait is under 10 s. That would mean the two runs executed
concurrently and `concurrency.group` is not doing what the file says.

**P2 — ordering.** Run B's job start is **at or after** run A's job completion, within a
few seconds. Never before.

**P3 — no cancellation.** Both runs reach `success`. Neither is `cancelled`.
→ *Falsified if* A is cancelled — that is `cancel-in-progress` behaving as `true`,
which the header calls "exactly backwards", and it would mean the older push is
abandoned wearing a green check.

**P4 — cutover spacing.** The two pod boots are **93–136 s apart**, not Δ apart. Measured
from the pod's own `uptime`, not from a Railway status field.
→ *Falsified if* the boots are ~20 s apart. That is the stacked-deploy failure, and it
would mean the gate does not protect against it at all.

**P5 — deploy A is not killed mid-cutover.** `/api/health` answers 200 across the whole
window. A's deploy record ending as `REMOVED` is **not** a failure signal here: every
superseded deploy in the list reads `REMOVED`, including 19 of the 20 sampled, so that
field cannot distinguish "retired normally" from "killed in flight".

## 4. What this test cannot settle, stated in advance

- ⛔ **It cannot prove the gate would have stopped the 2026-09-14 incident.** That push
  pair was 173 s apart, which is *longer* than a gate run, so run B would never have
  queued. The gate's protection against that specific interval comes from nothing more
  than gate B's own duration delaying B's cutover — the same 130 s, by a different
  route.
- ⛔ **It says nothing about `--no-verify`.** The gate's advantage over the pre-push hook
  is that it runs server-side; that property is structural and is not what is being
  measured here.
- ⚠️ **One trial.** Two pushes establish that the group *can* queue, not a distribution.
  P1's 75–150 s band is wide on purpose.

## 5. Risk accepted, and why this hour

If P1 is falsified — the runs execute concurrently — the two cutovers land ~20 s apart
and members get the 2026-09-14 failure again: a few tens of seconds of 502. That is the
risk of the test, and it is the same risk the gate exists to remove, which is why the
question cannot be answered by reading the configuration.

It is bounded deliberately: **docs-only commits** (web restart only, no worker, no
flow-worker), **overnight ET** (the 05:00–06:00Z hour is ~01:00 ET, the lowest-traffic
window of the week), **outside every sampling window**, and with the rollback being
nothing at all — a bad swap self-heals on the next boot.

⛔ **Not inside Window A or Window B.** Execution order puts E.1/E.2 after both, for the
same reason a deploy inside a sampling window destroys the sample.
