# Hosted-only CI options, 2026-11-06

Reproduce: `python tools/ci_cost_hosted.py`. Same measured inputs as `docs/ci/ci-cost-model.md`. Forecasts, not bills.
Rules held: the PC is advisory only; the named merge-candidate set runs once per PR or Agent batch, on hosted; the gate, verdict, promote and every rail stay hosted. Nothing is relaxed.

## Verdict

**No hosted-only option fits under $200/month, at the normal pace or at Nov-5 pace.**

- **Rails and merge-candidate runs alone cost $196/month at the normal pace,** with no gate runs at all. Rails run on every master push and every candidate: $131. Agent candidates: $54. They are mandatory and stay hosted, so every gate run pushes the total over.
- **Cheapest hosted-only option with little owner setup:** gate coalescing at N=120 plus GitHub Pro, **$344 normal, $505 at Nov-5 pace: $144 and $305 over.** It costs a 75-min median promotion latency.
- **Cheapest of all:** add Blacksmith for the shards: $281 normal, $413 Nov 5, still $81 and $213 over. It needs the repo moved into an organisation.
- **The VPS design** (`ci-cost-model.md`: one 1-month VPS, $145 normal, $175-191 at Nov-5 pace) **is the only modelled design under $200.** Fitting with hosted only would need an AUDIT ruling that moves rails off per-push runs, which this brief rules out.

## Real spend since #877

Nov 6 03:30Z to 21:40Z (18.2 h), census of every job: **3,608 billed minutes, $21.65 gross, about $29/day, about $860/month at that rate.** This is an 18-hour rate, not a month's cost. No budget stops occurred in that window.

| Workflow | Runs | Billed min | $ |
|---|---|---|---|
| agent ci | 41 (28 skipped) | 1,106 | 6.64 |
| master deploy gate | 16 | 1,068 | 6.41 |
| full suite (report-only) | 1 | 379 | 2.27 |
| indicators security suite | 22 | 180 | 1.08 |
| term018 guards | 66 | 179 | 1.07 |
| wisdom rails | 66 | 154 | 0.92 |
| notebook bytes | 55 | 147 | 0.88 |
| notebook budgets | 55 | 112 | 0.67 |
| preference allow-list | 55 | 102 | 0.61 |
| flow-worker deploy coverage | 36 | 64 | 0.38 |
| vite build args | 55 | 56 | 0.34 |
| promote to production | 18 | 36 | 0.22 |

- **Volume was below normal:** 16 gates in 18.2 h is about 21 a day, against the Nov 1-5 mean of 29-34. Only 13 `agent ci` runs did real work: the path filter and push discipline worked.
- **Cross-check:** without `agent ci` and the nightly suite, it ran 2,800 hosted min/day at about 21 gates. Variant a models about 3,200 at 29 gates. The two agree, so the hosted-only figures below are grounded in real runs.

## Options

USD/month total: GitHub, third party, PC power and storage. The $12 inferred Free allowance is taken off.

| Option | Normal | Every day Nov 5 | Promotion latency, Nov 5 p50 / p90 | Owner must |
|---|---|---|---|---|
| a Hosted, PC advisory, candidate runs, batch 3 | 584 | 886 | 26 / 42 min | Nothing beyond AUDIT's queue |
| a at the real batch size, 1.64 | 646 | 1,076 | same | same |
| b Coalesce gate, N=30 | 557 | 835 | 33 / 46 min | Nothing |
| b N=60 | 448 | 630 | 51 / 76 min | Nothing |
| b N=120 | 346 | 507 | 78 / 129 min | Nothing |
| c Tree reuse, 30-min window | 556 | 786 | unchanged | Nothing |
| d Blacksmith for the shards | 460 | 697 | unchanged or faster (vendor claim) | Create an org, move the repo, install the app |
| e GitHub Pro | 582 | 884 | unchanged | Upgrade the plan, set protection |
| **b N=120 + e** | **344** | **505** | 78 / 129 min | Upgrade the plan |
| b N=120 + d + e | 281 | 413 | 78 / 129 min | Org move, app, plan |
| Floor: rails and candidates, no gate | 196 | 373 | n/a | n/a |

## Option notes

### a. Hosted, PC advisory, merge-candidate runs

- **Effect:** Agent push runs leave hosted. The gate per merge (73.7 min), rails per push (14.9 min) and candidates (Agent 77.8 min, non-Agent PR 14.9 min) stay.
- **Dev speed:** a candidate adds about 16 min (p50) before a merge.
- **Reliability and security:** unchanged from today.

### b. Gate coalescing

- **Effect:** the gate runs on the master tip at most once per N minutes. AUDIT's range fix keeps every commit scanned, and promotion happens only on a green tip.
- **Gate runs per day:** 31 / 29 / 20 / 12 at the normal pace for N = 0 / 30 / 60 / 120. On Nov 5: 50 / 45 / 25 / 13.
- **N=30 saves little:** today's serial queue already coalesces, because the gate wall time is 23 min (p50).
- **Reliability:** one red commit holds every commit coalesced with it, so a fix waits a window too.
- **Rails do not coalesce:** they keep running per push, and that is most of the floor.

### c. Tree reuse

- **Effect:** the gate's Agent shards reuse a candidate result only when the merge tree equals the tested tree.
- **That needs no other master push between candidate start and merge.** Measured on Nov 1-5 Agent merges: 98% within a 15.9-min window, 66% at 30 min, and 11% at 60 min, where batching holds push merges.
- **Saving:** small ($28 normal), because Agent gates are only 13% of gate runs.
- **Conflicts with b:** a coalesced tip rarely equals any candidate's tree.
- **Security:** the reuse key must be the tree hash, and the result must come from a hosted run.

### d. Blacksmith

- **Price:** $0.004/min for 2 vCPU x64, same per-vCPU rate at every size; 3,000 free 2-vCPU min per org per month. Source: <https://docs.blacksmith.sh/blacksmith-runners/pricing>, <https://www.blacksmith.sh/pricing>.
- **Blockers:**
  - **Organisations only, not personal repos.** This repo is user-owned, so the owner must create an org and transfer the repo. That touches Railway, apps, secrets and URLs. Not little setup.
  - **Ubuntu 26.04 unverified:** only `ubuntu-2204` and `ubuntu-2404` labels were seen, while hosted `ubuntu-latest` began moving to 26.04 on Oct 19.
- **Security:**
  - **A third party runs our code** with whatever secrets and token those jobs get.
  - **Any non-GitHub runner label can be impersonated.** A repo-admin token holder can register a self-hosted runner with the label `blacksmith-2vcpu-ubuntu-2404` and receive those jobs. Every worker holds such a token. So a required check that runs on a third-party label is not independent of the workers.

### e. GitHub Pro

- **Price:** $4/month, unverified (third-party page; GitHub's page did not show Pro).
- **Allowance:** $18 included compute against $12, so $6 more.
- **Net cost effect:** about -$2/month.
- **What it unlocks:**
  - The repo's own API told us branch protection and rulesets need "GitHub Pro or make this repository public", so Pro unlocks protection on this private repo.
  - **That can require the merge-candidate checks before a PR merges into master. It cannot require the post-push gate:** the gate runs after the merge, and promotion stays the deploy control.
  - Requiring PRs would also stop direct pushes: 5.6 a day, plus `merge_all.py`. Those would become PRs, adding candidate runs.

## Gaps

- **Unverified prices and claims:** the Pro price, Blacksmith's speed claim and its 26.04 image.
- **Real-anchor volume:** below normal, and the window is 18 hours.
- **Merge-candidate rail set:** assumed to match the master rail set.
- **Tree-reuse window:** depends on real review-to-merge times, which were not measured.

## After AUDIT's ruling of Nov 6 (coalescing 30/60, strict reuse, no managed runners)

**Still no fit. The best hosted-only case is $467/month at the normal pace and $649 at Nov-5 pace: $267 and $449 over $200.**

Setup versus test time, measured from real job steps (`tools/ci_cost_setup.py`; 100 gate shards and 10 runs per rail):

| Job | Checkout s | Install s | Toolchain s | Test s | Total s | Billed min |
|---|---|---|---|---|---|---|
| Gate Agent shard | 29 | 10 | 13 | 673 | 730 | 13 |
| Equivalence rail | 29 | 9 | 14 | 2 | 60 | 1 |

- **Dependency caching saves nothing measurable.** `npm ci` already takes about 10 s per shard, with the setup-node npm cache warm, and setup is 56 s of a 730-s shard.
- **Fewer, larger shards:** 4 to 2 shards saves 4 billed min per heavy run (52 to 48) and adds about 11 min of wall time. 3 shards saves 1 min.

Best case, cumulative (USD/month total, $12 Free allowance or $18 with Pro):

| Step | Normal | Nov 5 | Gap normal / Nov 5 |
|---|---|---|---|
| a, nightly daily on hosted (as today) | 653 | 954 | +453 / +754 |
| b coalesce 30 min market hours, 60 off-hours | 551 | 749 | +351 / +549 |
| + c strict tree reuse | 546 | 735 | +346 / +535 |
| + dependency caching | 546 | 735 | no change |
| + 2 shards instead of 4 | 528 | 709 | +328 / +509 |
| + Pro | 526 | 707 | +326 / +507 |
| **+ nightly weekly** | **467** | **649** | **+267 / +449** |
| Floor: same, no gate runs | 201 | 371 | +1 / +171 |

- **Dev speed:**
  - Coalescing at 30/60 gives gate runs of 23 a day normal and 30 on Nov 5.
  - Promotion latency on Nov 5 is 45 / 75 / 79 min (p50 / p90 / max), up from 26 / 42 / 45. Normal p50 is 38 min.
  - With 2 shards it is 58 / 86 / 91 min on Nov 5.
- **Reuse is rare once coalescing is on:** 16% of Agent gates. Strict proof needs no other master push from the candidate's start to the gate's start, about 46 min. Without coalescing it is 66%.
- **Why it cannot fit:** the mandatory rails, run per push and per candidate, plus the candidate runs, already cost $201 at the normal pace with no gate runs at all.
- **Rail checkouts (not ruled):** checkout is 75-83 s of term018, wisdom and flow-worker's 1.5-2.2 min. A shallow or sparse checkout would cut term018 from 3 to 2 billed min, wisdom from 2 to 1, flow-worker from 2 to 1 and notebook bytes from 3 to 2. That is about $45/month at most. It does not close the gap.
