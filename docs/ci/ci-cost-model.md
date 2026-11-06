# CI cost model, 2026-11-06

Reproduce: `python tools/ci_cost_model.py`. Inputs: `docs/ci/ci-cost-inputs.json`, from `tools/ci_cost_measure.py`.
These are forecasts. No month's actual cost is claimed.

## Verdict

**$100/month total is not met at October's volume (25.7 gate runs a day) under AUDIT's current rules.**

- Best case under those rules: B(b) with the `gate` job split, plus L1 and L2: **$174/month**. It fits $100 only at about 10 gates a day.
- Adding L3 reaches $116, or $102 on a 24-month VPS, and fits $100 at about 19 gates a day. L3 needs an AUDIT ruling.
- A sustained busy month is $166 even with every lever. No architecture modelled gets it to $100.
- All of those exclude maintenance. B(b) at 2.5 h/month adds $62 at the placeholder $25/h.
- Cost scales with master pushes. Each gate costs about 27 hosted minutes on top of the heavy jobs, even when those move off hosted.

## Results, USD per month, cash

| Architecture | Normal: as specified | Normal: L1+L2 | Normal: all levers | Mixed: all levers | Sustained busy: all levers | Maint h |
|---|---|---|---|---|---|---|
| A today after #877 | 1,392 | n/a | n/a | 1,684 (as specified) | 2,465 (as specified) | 0.5 |
| B(a) PC + 1 VPS, pre-merge check, whole `gate` | 425 | 188 | 130 | 146 | 191 | 3.0 |
| B(a) split, 1 VPS (**cannot carry Nov 5**) | 411 | 174 | 116 | 129 | 166 | 3.0 |
| B(a) split, 2 VPS | 470 | 234 | 176 | 189 | 225 | 3.0 |
| B(b) PC + VPS gate only, whole `gate` | 425 | 188 | 130 | 146 | 191 | 2.5 |
| **B(b) split** | 411 | 174 | **116** | 129 | 166 | 2.5 |
| C PC + hosted gate | 650 | 414 | 414 (L3 n/a) | 506 | 751 | 1.5 |
| D PC + AWS spot, split | 422 | 185 | 185 (L3 n/a) | 227 | 339 | 4.0 |

"Mixed" is 6 Nov-5 days and 24 normal days. "Sustained busy" is 22 Nov-5 days and 8 normal days.

**Variations on B(b) split, all levers, normal / sustained busy:**

| Variation | Normal | Sustained busy |
|---|---|---|
| 24-month VPS | $102 | $152 |
| 3-day VPS outage, manual fallback to hosted | $176 | $226 |
| $0.002/min self-hosted charge | $285 | $452 |
| High power (225 W, $0.35/kWh) | $147 | $213 |
| With maintenance at $25/h | $178 | $228 |

The included allowance is already taken off every row: **$12, inferred GitHub Free** from the 403 "Upgrade to GitHub Pro" on branch protection and rulesets. Pro would take $6 off.

**Levers beyond the architecture:**
- **L1:** PR rails leave hosted (72% of rail minutes).
- **L2:** nightly full-suite shards leave hosted.
- **L3:** master-push rails move to the VPS, except `vite build args`, `indicators security suite`, OCR and joystick. **Not on AUDIT's allowed list**, and several are `promotion-gate: yes`, so AUDIT may refuse it.

## VPS capacity, replaying the 54 real Nov 5 gate arrivals

| Case | Busy h/day | Queue wait p50 / p95 / max (min) | Result |
|---|---|---|---|
| (b) 1 VPS, 15 min | 13.5 | 0 / 14 / 21 | Carries it |
| (b) 1 VPS, 20 min | 18.0 | 0 / 21 / 34 | Carries it, 75% busy |
| (a) 1 VPS, 15 min | 27.0 | 45 / 105 / 120 | **Fails: over 24 h** |
| (a) 1 VPS, 20 min | 36.0 | 235 / 418 / 447 | **Fails: merges wait up to 7.5 h** |
| (a) 2 VPS, 20 min | 36.0 | 0 / 10 / 20 | Carries it, $60 more |

The replay assumes one pre-merge check per gate. L3 rails would add about 13 h/day of light work on Nov-5 volume, so they need a second runner slot. The timing check `notebook latency` should not share it.

## Measured against budget

- **Spend:** 55,947 billed minutes, $335.68 gross, Nov 1 to Nov 6 04:37Z (full job data for heavy workflows, 1-in-3 for rails).
- **Budget stops, both confirmed by annotation ("spending limit needs to be increased"):**
  - Nov 4 from 17:38Z, about 100 jobs, at $170 estimated. The limit then is unknown.
  - Nov 6 from 01:08Z, 43 jobs, at $322 estimated.
- **Calibration:** $322 against $312 ($300 budget plus $12 allowance) reads 3% high, or 7% high against $300. No correction applied. The old 1.5× error came from pricing every run at about 76 min; the real `agent ci` mean is 36 min, because cancelled and skipped runs are cheap.
- **#877 effect:** only 1.46 h of runs since 03:30Z (160 runs, 1,475 min), some on branches that predate it. Too little to measure, and not extrapolated. Replay on the Nov 5 shape: 19,028 to about 15,700 min, **an 18% cut, not the PR's 60-75%**.
  - Only 20.7% of 552 pushes would have been skipped (an upper bound, tip commit only).
  - The `post` leg removal saves 8.1% of `agent ci`.
  - Superseded rails are about 7% of rail runs.
  - The new push-discipline rule is not modelled.
- **Linear run rate from Nov 1:** $1,927 net. That is a pre-#877 rate, not a forecast of the fix.
- **Artifacts:** 29,937 at 1.8 GB, about $0.33/month. **Cache:** 10.8 GB; only billed if the limit is raised.

## Budget ceiling and hard stops

A stop does not save the deploy. It fails the gate, verdict and promote within seconds, as run 42145747733 shows. The catch-up crons would fail too. `web` deploys from `production`, but five other services deploy from `master`, so **a stop can leave the back end ahead of `web`**. Promote, verdict and the gate job stay hosted in every architecture, so a VPS does not avoid this.

**Recommendation:**
- **Until migration:** today's estimated rate is about $46/day, so a $300 ceiling would last about 6.5 days. Keep it high enough to reach cutover.
- **After migration:** keep the hard ceiling at **$150 net**. That covers the sustained busy month's hosted spend ($84) plus a 3-day manual fallback ($60). The $100 target is enforced by alerts, not the ceiling: the tool alerts at $75 forecast or spend.
- **Check on a stop:** whether a hard stop also blocks self-hosted jobs is unverified.

## Assumptions

M = measured, P = published, E = estimate.

| Item | Value | Tag |
|---|---|---|
| Heavy jobs per gate (4 shards, equivalence rail, Pine) | 61.7 min | M, 52 runs from Nov 5 |
| `gate` job, verdict | 8.9, 1.0 min | M |
| Split saves | 3 min per gate | M 2.8 min, rounded by E |
| Master rails, promote | 14.9, 2.4 min per gate | M |
| Normal day | Oct mean 25.7 gates; Nov 5 mix scaled to it | M counts, E shape |
| Busy day | Nov 5: 54 gates | M |
| Filter skip, `post` saving | 20.7%, 8.1% | M replay |
| Cancel saving | 7% of runs × half their minutes | M × E |
| Linux 2-core | $0.006/min, rounded up per job | P |
| VPS | €52.00/month, about $60 at 1.15 USD/EUR | P price, E rate |
| Gate on VPS | 15-20 min; costs use 20 | E, see benchmark |
| PC advisory suite | 8.1 min | M |
| PC power above idle | 120 W base, 80-225 W | E, sampler saw about 2.2 of 8 threads busy |
| Rail on PC | 30 W | E |
| Electricity | $0.1816/kWh (EIA, Aug 2026), high $0.35 | P, E; owner's rate unknown |
| AWS spot | $0.203/h c7a.2xlarge, $0.005/h IPv4, 3 min boot, 5% rerun | P third-party, memory, E |
| Maintenance | 0.5-4 h/month at $25/h | E, excludes the one-off build |
| Outage | 3 days at busy volume, manual switch | E |

## Not modelled

- **Watchdog:** assumed to add no hosted time. A hosted step that waits on the VPS job would add 20 min per gate, about **$93/month** at normal volume. It must not poll inside a billed job.
- **Reruns of failed gates** are in the measured Nov 5 data, but only for hosted timings.
- **VPS gate time on real hardware** is unmeasured.
- **Agent CI volume** in a normal month is assumed to follow the gate count; October had no `agent ci`.
