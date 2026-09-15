# E.2 — the contention test, predicted BEFORE the pushes

**Status: PREDICTION. Nothing here is an observation.** Committed before either test push,
so the predictions cannot be reshaped to fit the result. E.3 records the outcome beside
this file without editing it.

Session 10, Workstream E, authorisation **E2**. This is the alternative adopted in
decision 0.5 after Session 9 declined to contend the queue with real master pushes.

---

## E.1 — the mechanism, and the proof that no deploy can result

**What is being tested:** whether `concurrency: group: master-deploy` in
`.github/workflows/master-deploy-gate.yml` actually serialises runs. Over its entire
history — **39 runs to date** — it has never queued one behind another, so the property is
a configuration reading and not a measurement.

**How a throwaway branch reaches the same queue.** For a `push` event GitHub evaluates the
workflow file **as it exists on the pushed ref**. So adding `gate-test/**` to
`on.push.branches` **on the test branch only** makes the gate run there — with no change to
master's copy, and therefore no third master push. The `concurrency` block is in the same
file and its group name is the literal `master-deploy`, not a branch expression, so the
test runs join **the same queue master promotions use.** That is the point.

### The four independent reasons no deploy can result

| # | mechanism | evidence |
|---|---|---|
| 1 | Railway `web` builds from **master only** | all **20** sampled deploys carry `meta.branch = 'master'` |
| 2 | 211 heads exist on the remote and **none** has ever produced a deploy | `git ls-remote --heads origin` = 211 |
| 3 | **Promotion is filtered to master.** `promote-production.yml` triggers on `workflow_run` with `branches: [master]`, so a gate run completing on `gate-test/**` cannot fire it | the trigger block itself |
| 4 | the gate workflow contains **no promotion step at all** — it is checks only | the workflow file |

⭐ **Reason 3 is stronger than the dry-run guard the brief suggested.** The brief asked for
a guard plus a rail proving the promotion step is inert on the test branch. It is inert
*structurally*: the promotion lives in a different workflow whose trigger already excludes
every branch but master. A guard added on top would be a second authority over a property
the trigger already owns — and a rail for it would be testing my guard rather than
GitHub's filter.

### Deliberate deviation: no synthetic slow marker

E.2 suggested pushing A with a *"slow marker (~7 min gate)"*. **Not doing that**, and the
reason is footprint. The concurrency group is shared with real master promotions, so every
second the test occupies the queue is a second a real master push would wait. The natural
gate duration is **96–169 s** across 39 runs, against a planned gap of **~15 s** — an order
of magnitude of margin, so A is certainly still running when B is created and a synthetic
delay would buy queue occupancy without buying certainty.

⚠️ **Stated plainly: this test does occupy the shared queue for the length of two gate
runs.** It is run at ~05:00 ET, and the last master push before it was 08:56Z.

### Other workflows that will fire on the test pushes

`wisdom-rails.yml` triggers on **every** push with no path filter, so it will run. It
deploys nothing. Every other workflow is path-filtered and the test branch deliberately
touches only `.github/workflows/master-deploy-gate.yml` and a marker file, matching none of
them.

---

## E.2 — the predictions

Two pushes to **one** throwaway branch, **~15 s apart**. Push A and push B differ only in a
one-line marker file.

**P-E1 — the discriminator.** Run B's **queue wait** (job `started_at` − run `created_at`)
jumps from the **3–5 s** baseline to roughly `gate_total(A) − 15 s`, i.e. **80–155 s**.
→ *Falsified if* B's queue wait is under 10 s.

**P-E2 — ordering.** Run B's job start is **at or after** run A's job completion. Never
before.

**P-E3 — no cancellation.** Both runs reach a terminal conclusion and **neither is
`cancelled`**. The group declares `cancel-in-progress: false`, so A must survive B's
arrival.
→ *If A is `cancelled`,* the result is **INCONCLUSIVE for serialisation** and a separate,
worse finding: the group would be cancelling the older run, which the workflow header calls
"exactly backwards".

**P-E4 — zero deploys.** The Railway `web` deployment list has the **same count and the
same newest entry** before and after. Checked both sides.

**P-E5 — the runs are in the same group as master.** Both runs appear under the
`master deploy gate` workflow, and their `concurrency` is the literal `master-deploy`.
→ *If the runs do not appear at all,* the branch pattern did not take effect and the test
is **INCONCLUSIVE**, not negative.

## What each outcome means

| result | reading |
|---|---|
| P-E1 confirmed | **The group serialises.** Go/no-go moves to "C.2.i + keyboard steps only" |
| P-E1 falsified (B starts immediately) | The group does **not** serialise — the gate's stated mechanism fails at its first real test, and the design needs a change (proposed, not built) |
| A cancelled | INCONCLUSIVE for serialisation; a separate defect |
| runs absent | INCONCLUSIVE — the trigger pattern, not the group |

⛔ **What this still cannot settle.** Serialising the *checks* is not the same as spacing
the *deploys*. Session 9 measured three deploys cutting over 2 s after, 18 s before and 2 s
before their own gating check, and Session 8 found eight more starting 99–141 s before
theirs — so even a confirmed P-E1 leaves "does Railway wait for CI" open. That is C.2.i,
and it is a dashboard question.
