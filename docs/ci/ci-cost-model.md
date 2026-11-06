# CI cost model, 2026-11-06, after AUDIT's rulings

Reproduce: `python tools/ci_cost_model.py`. Inputs: `docs/ci/ci-cost-inputs.json`, from `tools/ci_cost_measure.py` and `tools/ci_cost_steps.py`.
These are forecasts. No month's actual cost is claimed. All rulings are applied and none is relaxed.

## Verdict

**$100/month is not met at the current pace.**

- **Cheapest compliant architecture:** one netcup VPS on a 24-month term, PC advisory, merge-candidate runs, Agent batches of 3, the `gate` split. **$131/month** at the Nov 1-5 pace, cash, before maintenance.
- **Exact limit:** it stays at or under $100 at **17.1 gates a day**. That is 11.5 gates on a 1-month VPS and 14.3 on 12 months.
- **The Nov 1-5 pace is 34.2 merges a day**, of which 25.4 are non-Agent gates that cannot be batched. Those alone cost about $120 with no Agent merges at all. Other teams adopting batching is not modelled as a saving.
- **So $100 depends on master pushes falling by about 40% or more**, to about 17 gates a day across everyone, batches included.
- **With maintenance, $100 is not reachable at any volume:** the $61 floor plus 3 h at the placeholder $25/h is $136.
- **At Nov-5 pace every day:** $161 with perfect batches, $177 at the replay's real batch size of 1.64.

## USD per month, cash, every ruling applied

| Month | A today | C no VPS | D AWS spot | 1 VPS, no batching, 1-mo | 1 VPS, batch 3, 1-mo | 12-mo | **24-mo** | 2 VPS, batch 3, 24-mo |
|---|---|---|---|---|---|---|---|---|
| Normal (Nov 1-5 mean, 34.2 merges/day) | 2,039 | 588 | 294 | 158 | 145 | 138 | **131** | 177 |
| October pace, no Agent merges (25.7/day) | 652 | 467 | 238 | 125 | 125 | 118 | **111** | 157 |
| Mixed (6 Nov-5 days) | 2,206 | 648 | 320 | 169 | 151 | 144 | **137** | 183 |
| Sustained busy (22 Nov-5 days) | 2,649 | 810 | 391 | 200 | 167 | 160 | **153** | 199 |
| Every day Nov 5 (54/day) | 2,871 | 890 | 427 | 215 | 175 | 168 | **161** | 207 |

A is today's setup, shown as the baseline; it does not follow the rulings. C and D use batches of 3 and keep the movable rails hosted, because the rulings name the VPS. The included allowance is **$12, inferred GitHub Free**.

## What $100 depends on

1 VPS, batch 3, 24-month, USD per month:

| Non-Agent gates/day | 0 Agent PRs | 9 Agent | 18 Agent | 29 Agent |
|---|---|---|---|---|
| 0 | 61 | 67 | 77 | 90 |
| 5 | 69 | 80 | 90 | 103 |
| 10 | 82 | 92 | 103 | 115 |
| 15 | 95 | 105 | 115 | 128 |
| 20 | 107 | 118 | 128 | 141 |
| 25 | 120 | 130 | 141 | 153 |
| 30 | 132 | 143 | 153 | 166 |

- **Real Nov 1-5 split:** 25.4 non-Agent gates a day (19.8 through a PR, 5.6 direct) and 8.8 Agent PRs (7.4 batchable, 1.4 never batched). Nov 5: 25 non-Agent, 29 Agent (23 batchable, 6 never batched).
- **Each extra gate a day** costs $2.10/month hosted; each extra merge-candidate run a day costs $0.41.

Gates a day at or under $100, cash:

| VPS term | All non-Agent | Nov mix, after batch 3 | Nov mix, merges | Share of Nov 1-5 volume |
|---|---|---|---|---|
| 1-month ($59.80) | 11.6 | 11.5 | 13.5 | 39% |
| 12-month ($52.77) | 14.4 | 14.3 | 16.7 | 49% |
| 24-month ($45.76) | 17.1 | 17.1 | 19.9 | 58% |

## Where the $131 goes

| Item | $/month |
|---|---|
| Gate job, verdict, promote | 50 |
| VPS, 24-month | 46 |
| Hosted rails | 21 |
| PC power | 18 |
| Fixed hosted: watcher, catch-up promotes, nightly plan, scheduled rails | 8 |
| Allowance | -12 |
| Artifact storage | 0.33 |

## Rulings as measured

| Ruling | Result |
|---|---|
| `gate` split | 8.75 to 6.18 hosted min per gate. M: 40 runs, each re-rounded |
| Rails to VPS | Wisdom, term018, optionsflow, notebook bytes, a11y, preference allow-list, flow-worker coverage, notebook budgets: 12.6 min per run leave hosted |
| Rails hosted | Vite build args, notebook latency, clock parity, indicators security: 2.26 min per run stay. **Clock-parity upside: about $0** |
| Merge-candidate run | Agent: heavy, on the VPS. Non-Agent PR: rails only, preference allow-list included. Direct push: none |
| Consolidation | **$0.** No eligible rails share an identical `on:` block |
| Batching | Agent only, up to 3 PRs per gate. Real replay on Nov 5: 1.64 at a 60-min hold |
| Watcher | $3.52/month at 15 min, $1.82 at 30 min. Model uses 15 min |

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

**One VPS carries a Nov-5 day at 15 min a job. At 20 min it is marginal:** 90-101% busy, the queue runs past midnight, and 2-3 gates would hit the 45-min cancel. Two VPS carry it cleanly for $46 more. The VPS job time is not measured yet.

The moved rails add about 19 h of light work on a second runner slot on a Nov-5 day, not counted above. `notebook budgets` readings are advisory, but they will read noisier on that shared slot.

## Risks to the number

| Case, 1 VPS, batch 3, 24-mo | Normal | Every day Nov 5 |
|---|---|---|
| $0.002/min on VPS minutes only | $211 | $281 |
| $0.002/min on VPS and PC, if PC checks run as Actions jobs | $362 | $474 |
| High power (225 W, $0.35/kWh) | $173 | $213 |
| Maintenance, 3 h at $25/h | $206 | $236 |

A 3-day VPS outage at Nov-5 pace, switched by hand, adds $78.

## Budget ceiling

**The hard ceiling is $220 net.** `tools/ci_cost_report.py` alerts at **50% ($110)** and **80% ($176)** of it, and separately at $75 against the $100 target.

- **What a hit looks like: fast zero-step failures.** Jobs fail in seconds, with no runner and no steps, and the annotation says the spending limit needs to be increased. It is the budget, not the code. Do not re-push to retry.
- **What it blocks:** gate, verdict and promote (run 42145747733). `web` deploys from `production` and five other services from `master`, so the back end can run ahead of `web`. Promote and verdict stay hosted, so a VPS does not avoid it.
- **Headroom:** an all-Nov-5 month is $92 net hosted, plus $78 for an outage: $170, under the 80% alert.
- **Until migration:** today's estimated rate is about $46/day, so $220 would last about 5 days.

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

- **PC capacity:** Nov 4 would be about 245 advisory suites, about 21 h of wall time on 2 slots at 10.4 min. That leaves almost no room, so superseded runs should be dropped.
- **PRs into `agent/int`:** 92 on Nov 1-3, none after. If that flow returns, those PRs need merge-candidate runs too.
- **Non-Agent PRs touching Agent paths** would need a heavy candidate run.
- **VPS job time on real hardware.**
