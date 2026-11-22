# N-15: setup_knowledge SETUP rows that resolve to no template (for the sync-format owner)

Since this change the Agent withholds a team-playbook SETUP row whose tags resolve to no setup template (owner N3: presence is not approval, default-deny). Identifiers and counts only, no content. Real snapshot (Brain Pack 2026-11-01).

| | Rows |
|---|---|
| setup_knowledge rows | 98 |
| SETUP rows | 42 |
| SETUP served (tied to an admitted team template) | 8 |
| SETUP withheld: tied only to excluded third-party templates | 14 |
| SETUP withheld: tags resolve to no template | 20 |
| non-SETUP rows (principles, market reads, frameworks), served as before | 56 |

## Unresolved setup ids (the leading tag the sync writes)
`day1_day2`, `delayed_earnings`, `engulfing`, `flow_call_buy`, `flow_call_write`, `flow_dark_pool`, `flow_put_buy`, `flow_put_write`, `gap_support`, `index_0dte`, `inside_day`, `launch_pad`, `leveraged_theme`, `option_selling`, `pullback_ma`, `reversal_candle`, `slingshot`, `support_level`, `thesis`, `trendline_break`

## How a row resolves
The sync (`uct-intelligence/scripts/setup_knowledge_kb_sync.py`) writes tags as: setup id, aliases, family, `setup_knowledge`. The Agent matches the setup id and aliases (every tag except the last two), normalised to lowercase words, against each setup template's name and aliases in the same pack. A row resolves when at least one tag equals a template name or alias.

## Notes for the owner of the sync format
- `launch_pad` likely means the `Launchpad` template. The row's tags ("launch pad", "MA launch pad", …) do not equal the template's name or aliases word for word. An alias on either side would resolve it. The Agent does not guess.
- Most of the others (the `flow_*` ids, `index_0dte`, `option_selling`, `leveraged_theme`, `thesis`, `day1_day2`) have no template at all. They stay withheld unless a team-authored template or an owner ruling covers them.
- `gap_support`, `inside_day`, `pullback_ma`, `slingshot`, `trendline_break`, `reversal_candle`, `engulfing`, `support_level` and `delayed_earnings` are ledger setups without an engine template. They would need one, or an explicit mapping.
- To serve a row: give it a tag equal to an **admitted** (team-origin) template's name or alias. A third-party template does not count.
