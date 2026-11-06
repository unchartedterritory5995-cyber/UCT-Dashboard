# CI cost model, 2026-11-06, after AUDIT's rulings

Reproduce: `python tools/ci_cost_model.py`. Inputs: `docs/ci/ci-cost-inputs.json`, from `tools/ci_cost_measure.py` and `tools/ci_cost_steps.py`.
These are forecasts. No month's actual cost is claimed. All rulings are applied and none is relaxed.

## Verdict

**$100/month is not met at the current pace, and batching Agent merges cannot fix that.**

- **Cheapest compliant architecture:** one netcup VPS on a 24-month term, PC advisory, merge-candidate runs, Agent batches of 3, the `gate` split. **$168/month** at the Nov 1-5 pace, cash, before maintenance.
- **Exact limit:** it stays at or under $100 at **11.4 gates a day**. That is 7.7 gates on a 1-month VPS and 9.6 on 12 months.
- **The Nov 1-5 pace is 25.4 non-Agent gates a day, which cannot be batched.** Those alone cost $150 with no Agent merges at all. Agent batching changes the bill by about $20 at that pace.
- **So $100 depends on non-Agent master pushes falling by more than half**, to about 11 gates a day across everyone, batches included.
- **With maintenance, $100 is not reachable at any volume:** the $61 floor plus 3 h at the placeholder $25/h is $136.
- **At Nov-5 pace every day:** $215 with perfect batches, $240 at the replay's real batch size of 1.64.

## USD per month, cash, every ruling applied

| Month | A today | C no VPS | D AWS spot | 1 VPS, no batching, 1-mo | 1 VPS, batch 3, 1-mo | 12-mo | **24-mo** | 2 VPS, batch 3, 24-mo |
|---|---|---|---|---|---|---|---|---|
| Normal (Nov 1-5 mean, 34.2 merges/day) | 2,039 | 588 | 294 | 202 | 182 | 175 | **168** | 214 |
| October pace, no Agent merges (25.7/day) | 652 | 467 | 238 | 157 | 157 | 150 | **143** | 189 |
| Mixed (6 Nov-5 days) | 2,206 | 648 | 320 | 220 | 192 | 185 | **178** | 223 |
| Sustained busy (22 Nov-5 days) | 2,649 | 810 | 391 | 267 | 216 | 209 | **202** | 248 |
| Every day Nov 5 (54/day) | 2,871 | 890 | 427 | 290 | 229 | 222 | **215** | 260 |

A is today's setup, shown as the baseline; it does not follow the rulings. C and D use batches of 3. The included allowance is **$12, inferred GitHub Free**. B(b) from the earlier model is gone: ruling 3 requires a merge-candidate run.

## What $100 depends on

1 VPS, batch 3, 24-month, USD per month:

| Non-Agent gates/day | 0 Agent PRs | 9 Agent | 18 Agent | 29 Agent |
|---|---|---|---|---|
| 0 | 61 | 73 | 89 | 108 |
| 5 | 76 | 92 | 107 | 127 |
| 10 | 95 | 110 | 126 | 146 |
| 15 | 113 | 129 | 145 | 165 |
| 20 | 132 | 148 | 164 | 184 |
| 25 | 151 | 167 | 183 | 202 |
| 30 | 170 | 186 | 202 | 221 |

- **Real Nov 1-5 split:** 25.4 non-Agent gates a day (19.8 through a PR, 5.6 direct) and 8.8 Agent PRs (7.4 batchable, 1.4 never batched). Nov 5: 25 non-Agent, 29 Agent (23 batchable, 6 never batched).
- **Non-Agent teams mostly use PRs:** 78% of their gates, so most get a merge-candidate run too. Ruling 5 describes them as pushing directly.
- **Each extra gate a day** costs $2.81/month hosted; each extra merge-candidate run a day costs $1.11.

Gates a day at or under $100, cash:

| VPS term | All non-Agent | Nov mix, after batch 3 | Nov mix, merges | Share of Nov 1-5 volume |
|---|---|---|---|---|
| 1-month ($59.80) | 7.7 | 7.7 | 9.0 | 26% |
| 12-month ($52.77) | 9.6 | 9.5 | 11.1 | 33% |
| 24-month ($45.76) | 11.4 | 11.4 | 13.3 | 39% |

## Where the $168 goes

| Item | $/month |
|---|---|
| Hosted rails, at merge candidate and on master | 59 |
| Gate job, verdict, promote | 50 |
| Fixed hosted: watcher, catch-up promotes, nightly plan, scheduled rails | 8 |
| Allowance | -12 |
| VPS, 24-month | 46 |
| PC power | 18 |
| Artifact storage | 0.33 |

**Hosted alone is $104 net, over $100 before the VPS is paid for.** $47 of the rail line is `notebook budgets`, `preference allow-list`, `flow-worker deploy coverage` and `indicators security suite`. AUDIT did not rule on them, so they stay hosted here. Even if all four moved, the total would be about $121.

## Rulings as measured

| Ruling | Result |
|---|---|
| 1 `gate` split | 8.75 to 6.18 hosted min per gate. M: 40 runs, each re-rounded. The step averages 2.5 min |
| 2 Rails to VPS | 8.7 min per run leave hosted; 6.17 min stay. **Clock-parity upside: about $0**, no master runs on Nov 5 |
| 3 Merge-candidate run | Agent: heavy, on the VPS. Non-Agent PR: rails only. Direct push: none |
| 4 Consolidation | **$0.** No two eligible rails have the same `on:` block, so none qualify. Not allowed, for scale: 3.1 min saved if all three eligible rails fired together |
| 5 Batching | Up to 3 PRs per gate. Real replay on Nov 5: 1.64 at a 60-min hold |
| 6 Watcher | $3.52/month at 15 min, $1.82 at 30 min. Model uses 15 min. The one-shot step adds seconds; modelled as nothing |
| 7 Secret-scan fix | Ignored, as instructed |

## Nov 5 capacity on one VPS, merge-candidate runs included

Replay of the 54 real arrivals. Merge-candidate runs are heavy for Agent PRs only.

| Case | Gates + candidates | Busy h | Queue wait p95 / max (min) | Gates over 45 min | Agent merge p95 (min) |
|---|---|---|---|---|---|
| 1 VPS, 15 min, no hold | 53 + 28 | 20.2 | 15 / 34 | 0 | 49 |
| 1 VPS, 15 min, 60-min hold | 45 + 20 | 16.2 | 21 / 30 | 0 | 105 |
| 1 VPS, 20 min, no hold | 49 + 24 | 24.3 | 40 / 54 | 3 | 111 |
| 1 VPS, 20 min, 60-min hold | 45 + 20 | 21.7 | 40 / 52 | 2 | 131 |
| 2 VPS, 20 min, no hold | 53 + 28 | 27.0 | 3 / 17 | 0 | 40 |
| 2 VPS, 20 min, 60-min hold | 45 + 20 | 21.7 | 0 / 16 | 0 | 100 |

**One VPS carries a Nov-5 day at 15 min a job. At 20 min it is marginal:** 90-101% busy, the queue runs past midnight, and 2-3 gates would hit the 45-min cancel. Two VPS carry it cleanly for $46 more. The VPS gate time is not measured yet, so this decides whether one is enough. The movable rails add about 13 h of light work a day on a second runner slot, not counted above.

## Risks to the number

| Case, 1 VPS, batch 3, 24-mo | Normal | Every day Nov 5 |
|---|---|---|
| $0.002/min on VPS minutes only | $236 | $317 |
| $0.002/min on VPS and PC, if PC checks run as Actions jobs | $387 | $510 |
| High power (225 W, $0.35/kWh) | $210 | $267 |
| Maintenance, 3 h at $25/h | $243 | $290 |

A 3-day VPS outage at Nov-5 pace, switched by hand, adds $72.

## Budget ceiling

A stop fails gate, verdict and promote in seconds (run 42145747733). `web` deploys from `production` and five other services from `master`, so the back end can run ahead of `web`. Promote and verdict stay hosted, so a VPS does not avoid it.

**Set the hard ceiling at $220 net after migration:** an all-Nov-5 month's hosted $146 plus the $72 outage. The current limit should stay above today's run rate until cutover. A $100 ceiling would stop deploys around day 29 at the normal pace, and about day 21 at Nov-5 pace. Alert at $75, which the tool already does. Hold the $100 target by alerts and by cutting pushes, not by the ceiling.

## Measured evidence

- **Spend:** 55,947 billed min, $335.68 gross, Nov 1 to Nov 6 04:37Z. Heavy workflows in full, rails 1-in-3.
- **Budget stops, confirmed by annotation:** Nov 4 from 17:38Z (about $170 estimated, limit unknown) and Nov 6 from 01:08Z ($322 estimated). The second reads 3% high against $312, so no correction is applied.
- **#877:** only 1.46 h of runs since 03:30Z, not extrapolated. Replay on Nov 5 suggests an 18% cut, not 60-75%.
- **Storage:** 29,937 artifacts, 1.8 GB, $0.33/month.

## Assumptions

M = measured, P = published, E = estimate.

| Item | Value | Tag |
|---|---|---|
| Heavy jobs, verdict, promote | 61.7, 1.0, 2.24 min | M |
| Merge counts by kind | From commit subjects and files on Nov 1-5 | M. `agent/**` branches only; never-batched is matched by branch word and changed path |
| Rail frequency at a candidate | Same as on a master push | E |
| Agent candidate on hosted (C) | 62.9 min | M |
| Linux 2-core | $0.006/min | P |
| VPS | €52.00, €45.89, €39.79 at 1.15 USD/EUR, incl. 19% VAT | P price, E rate |
| Heavy job on VPS | 15-20 min | E |
| Advisory suites on PC | 123 a day, 8.1 min, 120 W (range 80-225 W) | M count and time, E power |
| Rail on PC | 30 W | E |
| Electricity | $0.1816/kWh (EIA, Aug 2026) | P; owner's rate unknown |
| Watcher | 27 runs a weekday, 1 min each | E |
| AWS spot | $0.203/h, $0.005/h IPv4, 3 min boot, 5% rerun | P third-party, memory, E |
| Maintenance | 1 VPS 3 h, 2 VPS 4 h, C 1.5 h, D 4 h | E, excludes the build |
| Months | 30 days at the mean daily rate | E |

## Not modelled

- **PC capacity:** Nov 4 would be about 245 advisory suites, over 40 h of work on 2 slots at 10.4 min. Superseded runs must be dropped; advisory runs cannot all complete.
- **PRs into `agent/int`:** 92 on Nov 1-3, none after. If that flow returns, those PRs need merge-candidate runs too.
- **Non-Agent PRs touching Agent paths** would need a heavy candidate run.
- **VPS gate time on real hardware.**
