---
id: s7-price-level-f6-build-record
unit: CP3
packet: s7-price-level-pre-implementation-gate
merges-after: D4 CP4'
status: UNSIGNED
---

# F-S7-6 fix — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-18)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  809a6447f
SCOPE APPROVED:   CP3 -- a bug fix within CP3's own already-approved scope (F-S7-6). No new checkpoint, no new authorization; the dark sweep stays fully dark.
```

> **F-S7-6 — the dark sweep's price resolver cannot price a UCT breadth
> pseudo-ticker.** Scope is `api/services/alert_taxonomy/price_level_projection.py`
> and `tests/test_alert_taxonomy_price_level_projection.py`, as enumerated by
> `git show --stat` of this unit's commit. This is a bug fix WITHIN CP3's
> already-approved, already-live scope (owner approval line 2, 2026-09-12) —
> not a new checkpoint, no new authorization needed; the dark sweep continues
> to write only comparison bookkeeping, never delivery.

⛔ **Collision proof:** `grep -rohE "F-S7-[0-9]+" docs/terminal-research/` tops
out at F-S7-5. **F-S7-6 free.**

## 1 · The finding

Filed by a read-only investigation dispatched this session (worktree-isolated,
production-verified via `railway ssh --service web`, per the new R-FORKS
standing rule) while gathering evidence for the S7 price-level flip decision
(Card 6). Live production showed the dark sweep's own heartbeat reporting
`projected=12` (12 armed predicates in the admin `rollout:s7-dark` cohort) while
`price_level_comparison_spans` held only **10** rows — two admin-cohort
predicates were structurally invisible to the comparison report, not merely
zero-count.

**Root cause, read at the call site.** Both missing predicates are on symbol
`UCTA5`, a UCT-breadth pseudo-ticker ("% of Stocks Above 5-Day MA",
`api/services/breadth_symbols.py::_ROWS`), not a real security. The dark
sweep's price resolver, `price_level_projection._prices_for()`, tries only (1)
the shared `live_px1_*` cache and (2) a direct Massive batch-snapshot fetch —
and Massive has no quote for a pseudo-ticker, so it always missed. The REAL
legacy alert checker (`api/routers/live_prices.py`) already knows how to price
a breadth pseudo-ticker via `breadth_symbols.latest_quotes()`, but that value
is injected straight into the request's own response dict and is **never
written into the shared `live_px1_*` cache** — so the dark sweep's independent
resolver had no path to it either. A real capability gap in the new
evaluator's absorption of the legacy price-resolution path, not a design or
schedule choice.

## 2 · The fix

`_prices_for()` gains a breadth-symbol resolution step between the cache
lookup and the Massive fallback: for every still-missing symbol that
`breadth_symbols.is_breadth_symbol()` recognizes, resolve it via
`breadth_symbols.latest_quotes()` — mirroring exactly what `live_prices.py`'s
real endpoint already does for the same symbol. A symbol `latest_quotes` can't
price still falls through to `missing`, reported honestly rather than
substituted or dropped.

## 3 · Controls

```
python -m pytest tests/test_alert_taxonomy_price_level_projection.py
                 tests/test_alert_taxonomy_event_proximity_projection.py -q
                                                                54 passed, 0 failed
```

Three new tests:
- `test_prices_for_resolves_a_breadth_pseudo_ticker_via_breadth_symbols` — the
  fix itself; also asserts Massive is NEVER consulted for a recognized breadth
  symbol.
- `test_prices_for_still_reports_a_breadth_symbol_with_no_quote` — a breadth
  symbol `latest_quotes` can't price is still reported `missing`, never
  substituted.
- `test_prices_for_MUTATION_without_the_breadth_path_a_pseudo_ticker_is_lost` —
  the pre-fix behavior, named as a mutation-shaped control.

**Mutation ladder (load-bearing arm, run against the real production code, not
just the control test):** reverted the actual fix in
`price_level_projection.py` (removed the breadth-symbol resolution block
entirely) → `test_prices_for_resolves_a_breadth_pseudo_ticker_via_breadth_symbols`
went RED. Restored → full 36-test file green again.

## 4 · Files

```
api/services/alert_taxonomy/price_level_projection.py    +18/-1 lines: breadth-symbol
                                                            resolution step + import
tests/test_alert_taxonomy_price_level_projection.py       +62 lines: 3 new tests
```

## 5 · Validators

```
ast.parse                                                        OK
scoped pytest, 2 files                                           54 passed, 0 failed
mutation ladder (1 arm, load-bearing)                            confirmed RED then restored
```

## 6 · What this does NOT fix, named rather than silently left

- The other 9 armed predicates' zero-outcome readings are NOT a plumbing
  defect — independently verified against live yfinance quotes as genuine
  true negatives (the armed condition simply has not become true).
- `legacy:08d68edb-d4b`'s ~2178 `legacy_only` count is NOT 2178 distinct
  disagreements — it is one-minute dark-sweep ticks where a stateless legacy
  level-test was true, following a single real crossing event
  (2026-09-10) that happened BEFORE the comparison window opened
  (2026-09-14). Under the packet's own "no replay, ever, forward-only" ruling,
  the new evaluator's silence here is designed behavior, not a bug — see the
  rewritten Card 6.
- None of the 10 armed predicates exercises the trendline/anchor-rewrite
  machinery (F-S7-2/F-S7-3) — that code path has zero dark-period coverage
  from this data. Not fixed here; recorded as a real gap in Card 6.

## 7 · Drafted ledger row — NOT written

| 126 | `<this commit>` | 2026-09-18 | PRODUCT | 1 | F-S7-6: the S7 price-level dark sweep's price resolver had no path to a UCT breadth pseudo-ticker's quote (Massive has none; the shared live-price cache never carries one), silently making any predicate armed on one structurally invisible to the comparison report (heartbeat `projected=12` vs 10 actual spans). Fixed by resolving breadth pseudo-tickers via `breadth_symbols.latest_quotes`, mirroring what the real legacy alert checker already does. Found by a read-only, worktree-isolated investigation dispatched for the S7 flip decision. |
