# KN-1 — Trading-knowledge kinds for UCT Agent (contract)

Owner: agent-kn. Integrator: AUDIT. Design: PR #723. Implementation: PR #735 (`agent/kn/knowledge-poc`).
Every knowledge answer is an MD-1 DataEnvelope served through `gateway.read()`; nothing here changes MD-1, SC-1, STEP-1, ADR-005 or F-16.

## Gates
`UCT_AGENT_DATA=1` · the kind in `UCT_AGENT_DATA_KINDS` · `UCT_AGENT_KNOWLEDGE=1` (default off; while off, `gateway.enabled_kinds` drops the knowledge kinds, so `/api/agent/config` never advertises them) · `require_admin_dark`.

## Kinds
| Kind | Params | Data |
|---|---|---|
| `knowledge.search` | `question` ≤ 400 chars, `k` 1–3, `category?`, `include_dated?` | `passages[] {kb_id, title, category, trader, source, licence, epoch, updated_at, excerpt ≤ 500, dated?, as_of_post?, scrubbed?}`, `method: "fts"` |
| `setup.playbook` | `setup` (name or alias) | template fields (description, ideal_regime, entry_triggers, stop_methods, max_stop_pct, profit_logic, invalidation, common_mistakes, family, origin_trader), `aliases`, `resolved_by`, `licence: firm_curated`, `link`; `criteria[]` ONLY for entries reviewed in `docs/agent/knowledge/setup-criteria.json` |
| `setup.record` | `setup`, `regime?` ALL/GREEN/YELLOW/ORANGE/RED | `engine`, `triggers`, `team_archive?`, `caution` — see below |

### setup.record
- `engine` = the brain's logged trades for the setup × regime; `triggers` = published setup triggers resolved after the fact. Shape `{label, label_text, n, wins, losses, win_rate_pct, win_rate_ci95 [lo, hi] (Wilson 95%), method, n_min, expectancy? | expectancy_r?, avg_gain_pct?, avg_loss_pct?, sample_start?, sample_end?, updated_at?}`. **Engine and trigger outcomes have no fixed horizon** (each trade's own exit).
- `team_archive` (only with `WISDOM_ARCHIVE_ENABLED`): `{label, n, win_rate_20d_pct, win_rate_20d_ci95, edge_z, method, scope}` — **20-session horizon**, all market conditions. Never averaged with engine figures.
- Labels: `insufficient_sample` (n < 30 or no usable win count: no figure), `stale_record` (refresh > 14 days or undated: figure withheld), `descriptive_uncontrolled`, `measured_edge_controlled` (archive |z| ≥ 3 only), `not_proven`.
- Consumers surface n, the interval, the label and the `caution` sentence verbatim. "proven edge" / "guarantee" never appear (tested).

## Measurables
The closed list of `measurable` ids used by `setup-criteria.json`. A setup analyzer (e.g. `chart.describeSetup`) computes them from served bars; ids not marked v1 are REQUESTED and evaluate as "not measured" until implemented.

| id | meaning | unit | in v1 |
|---|---|---|---|
| `close_vs_sma20` | (close − SMA20) / SMA20 × 100 | pct | yes |
| `close_vs_sma50` | (close − SMA50) / SMA50 × 100 | pct | yes |
| `pct_from_52w_high` | (close − 52-week high) / 52-week high × 100 (≤ 0) | pct | yes |
| `range_pct_10` | (max high − min low) over the last 10 sessions / min low × 100 | pct | yes |
| `rel_volume_50d` | session volume / 50-session average volume | x | yes |
| `sma50_above_sma200` | SMA50 > SMA200 | bool | yes (trend flag) |
| `sma50_rising` | SMA50 today > SMA50 20 sessions ago | bool | yes (trend flag) |
| `sma200_rising` | SMA200 today > SMA200 20 sessions ago | bool | yes (trend flag) |
| `close_vs_sma150` | as above, SMA150 | pct | requested |
| `close_vs_sma200` | as above, SMA200 | pct | requested |
| `close_vs_ema10` | as above, EMA10 | pct | requested |
| `close_vs_sma30w` | close vs 30-week SMA, weekly bars | pct | requested |
| `rel_volume_weekly_10w` | week volume / 10-week average | x | requested |
| `adr_pct_20` | mean of (high − low) / low × 100 over 20 sessions | pct | requested |
| `gap_pct` | (open − prior close) / prior close × 100 | pct | requested |
| `prior_run_pct_40d` / `prior_run_pct_60d` | max close over the window / min low before it − 1, × 100 | pct | requested |
| `close_vs_gap_day_low` | (close − low of the gap day) / gap-day low × 100 | pct | requested |
| `undercut_reclaim_sessions` | sessions from the close below a support level to the close back above it | sessions | requested |
| `stop_distance_pct` | (entry − stop) / entry × 100 for a proposed plan | pct | plan input, not a bar measure |

Rules for analyzers: evaluate a condition only when its `measurable` is computed and its `value` is not null; report each as `met` / `not met` / `not measured` with the evidence value; conditions with `basis: interpreted` are said to be UCT's reading of the template, with their `assumptions`; `blocked` conditions are reported as not available, with their reason. Never infer a missing value.
