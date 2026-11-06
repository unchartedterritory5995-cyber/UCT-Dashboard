# VPS verification, 2026-11-06

Workload: one x64 job at 8 vCPU, 15-20 min, up to 54 times a day, serially. That is up to 18 h/day of near-continuous CPU, so sustained CPU decides this more than list price. ARM is refused.

Prices come from provider pages read through a text fetcher on 2026-11-06. Confirm in the order form before buying; nothing was ordered. "Unverified" means the provider's page did not state it.

## Ranking

| Rank | Plan | Price, monthly equivalent | CPU | RAM / disk | Term and setup | US | Sustained-CPU terms |
|---|---|---|---|---|---|---|---|
| **1** | **netcup RS 2000 G12.5** | €46.81 (1-month), €40.70 (12), €34.60 (24), incl. 19% VAT; Manassas +€5.19 | 8 dedicated, AMD EPYC 9645, x64 | 16 GB / 256 GB NVMe | 1, 12 or 24 months; setup €0.00 | Manassas | "A root server has guaranteed CPU performance." No fair-use limit stated |
| 2 | Contabo Cloud VDS M | €68.00, or €54.40 on 24 months (see note) | 8 dedicated, EPYC 7282, 2.8 GHz | 32 GB / 240 GB NVMe | 1 month minimum; no setup fee | 3 US sites; per-plan availability and fee unverified | Contabo terms clause 9 lets it restrict "extensive computing power" |
| 3 | Contabo Cloud VPS Plus 8 | About €28 | 8 vCPU EPYC; a Contabo blog says Performance VPS cores are "guaranteed", host shared. Not confirmed for this plan | 24 GB / 450 GB NVMe | Term unverified | US page lists it | As above |
| 4 | Hetzner CCX33 | €141.49 US, €138.99 EU, excl. VAT | 8 dedicated AMD | 32 GB / 240 GB NVMe | Hourly with monthly cap; no setup fee mentioned | Ashburn, Hillsboro | None stated. **Over budget alone** |
| 5 | OVH VPS-4 | "Starting at $23.37/month" | 8 vCore; model and shared/dedicated unverified | 24 GB / 200 GB NVMe | Commitment, setup unverified | Third party says Vint Hill and Hillsboro; unverified | Unverified |
| 6 | Hetzner CPX42 / CPX41 | €69.99 EU (CPX42); €120.99 US (CPX41) | 8 shared AMD; page says "low to medium CPU usage" | 16 GB / 320 GB (EU), 240 GB (US) | Hourly | CPX41 only | Wrong fit by Hetzner's own description |
| 7 | Hetzner CX43 | €16.49 | 8 shared x86 | 16 GB / 160 GB | Hourly | **Not listed in US** | As above |
| 8 | Contabo Cloud VPS 8 | €14.00 or €11.20 (see note) | 8 shared; Contabo says performance "can vary with neighboring tenant load" | 24 GB / 300 GB SSD or 150 GB NVMe | 1 month minimum | US Central listed | As Contabo above |

## Why netcup is first

- **Stable under sustained load:** vpsbenchmarks' endurance run on the smaller RS 1000 G12 (same EPYC 9645) showed 0.00% steal and a 3.08% coefficient of variation.
- **Contabo's shared plans vary far more:** a Sep 2026 run on Cloud VPS 18 showed 0.00% steal but a 30.72% coefficient of variation, with throughput dropping about 32% during the run. Neither run is the exact 8-vCPU plan.
- **Steal alone misses this:** Contabo's zero-steal run still swung by about a third, so measure throughput, not just steal.
- **RAM fits:** the benchmark's suite peak was 5.74 GB at 8 workers and 3.21 GB at 4. 16 GB holds that plus the runner, but this is a Windows measurement and Linux with containers is unmeasured.

## Recommended

**netcup RS 2000 G12.5, Manassas, 1-month term first: €52.00/month (€46.81 + €5.19), about $60 at an assumed 1.15 USD/EUR.** Benchmark it, then move to a longer term only if it holds. The 30-day satisfaction guarantee is for first-time orders.

| Term | EUR/month incl. VAT, Manassas | USD/month at 1.15 | Commitment |
|---|---|---|---|
| 1 month | 52.00 | 59.80 | None |
| 12 months | 45.89 | 52.77 | About €551 |
| 24 months | 39.79 | 45.76 | About €955 |

Source: <https://www.netcup.com/en/server/root-server/rs-2000-g12-ip-iv-12m> and <https://www.netcup.com/en/server/root-server>

## Open points to confirm

- **netcup prices:** I read them as VAT-inclusive at 19%, because 34.60 + 12.21 = 46.81 and the 12-month 40.70 fits the published 13% saving. The price for a US customer may differ. The page's "24M EU" label and whether the +€5.19 is monthly are unverified; the model assumes monthly.
- **netcup stock:** the page warns provisioning may be delayed.
- **Contabo VDS M:** the page showed €68.00 and €54.40 labelled incl. and excl. VAT, but the ratio is exactly the 20% 24-month discount, so I read them as list and 24-month prices. Other Contabo pages disagree (€59.02). Unverified.
- **Contabo Cloud VPS 8:** the page's €14.00 and €11.20 are unclear, and it says both 12- and 24-month for the same rate. US fee unverified.
- **Hetzner:** every plan page showed "currently unavailable", which may be a fetch artifact. USD prices were not shown.
- **Other sources:** the Contabo shared-CPU and OVH details partly come from third parties, as marked.

## Sources

- netcup: <https://www.netcup.com/en/server/root-server>
- netcup endurance: <https://www.vpsbenchmarks.com/trials/netcup_performance_trial_23Jul2026/endurance_runs/last>
- Contabo VDS: <https://contabo.com/en-us/vds/>
- Contabo VPS: <https://contabo.com/en-us/vps/> and <https://contabo.com/en-us/vps-usa>
- Contabo terms: <https://contabo.com/en/legal/terms-and-conditions/>
- Contabo CPU lines: <https://contabo.com/blog/vps-to-vds-upgrade-path/>
- Contabo endurance: <https://www.vpsbenchmarks.com/trials/contabo_performance_trial_08Sep2026/endurance_runs>
- Hetzner: <https://www.hetzner.com/cloud/general-purpose/>, <https://www.hetzner.com/cloud/regular-performance/>, <https://www.hetzner.com/cloud/cost-optimized/>
- OVH: <https://us.ovhcloud.com/vps/>
