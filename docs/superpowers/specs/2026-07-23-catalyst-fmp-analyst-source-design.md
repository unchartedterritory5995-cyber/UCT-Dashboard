# Stock Catalysts — FMP analyst source (rating changes)

**Date:** 2026-07-23
**Status:** built; flag-gated `CATALYST_FMP_ANALYST_ENABLED` (default on). Roadmap
item 2 of source-completeness (after options flow).

## Why

The catalyst engine's only analyst signal was Finnhub + the wire. FMP's
`grades-latest-news` is a **market-wide feed of the freshest upgrades /
downgrades / initiations** off the Street (TheFly-sourced) — broader, fresher
coverage that surfaces analyst-driven names the wire missed.

## Availability (verified live on the pod)

The old `stable/upgrades-downgrades` 404s on our plan, but the newer endpoints
all return 200 with real data: `grades-latest-news`, `price-target-news`,
`grades-consensus`, `price-target-consensus`. `grades-latest-news` **ignores the
symbol param** and returns the latest rating changes market-wide — exactly the
"surface" feed we want. Row shape: `{symbol, publishedDate, newsTitle, newGrade,
previousGrade, gradingCompany, action, priceWhenPosted}`.

## Design (zero new plumbing beyond a merge)

`sources._pull_fmp_analyst()` (source #10) fetches `grades-latest-news?limit=100`,
keeps only **genuine rating changes** (action ∈ upgrade/downgrade/initiate, OR a
changed grade — routine PT-reiterations dropped), newest-per-symbol wins, and maps
each onto the existing **`analyst_meta`** shape `{action, firm, from_rating,
to_rating, price_target, at, source}`.

Because it produces `analyst_meta`, it reuses everything already built for the
Finnhub/wire analyst source:
- `tagging` → `Catalyst`; `filters.is_real_catalyst` → analyst branch **surfaces**
  a fresh-upgrade name even before it moves; `scoring` → `ANALYST_ACTION` bonus.
- `curator._candidate_block` + `synthesize` already render the analyst line, so
  the curator ranks/keeps on it and the thesis cites the upgrade.

**Merge:** in `collect_all`, `analyst_meta = results["analyst"].get(t) or
results["fmp_analyst"].get(t)` — the Finnhub/wire source wins on a conflict; FMP
fills the gap + adds names it missed. FMP tickers join the universe (surface).

## Env / safety

- `CATALYST_FMP_ANALYST_ENABLED` (1) · `CATALYST_FMP_ANALYST_LIMIT` (100) ·
  `CATALYST_FMP_ANALYST_TIMEOUT` (8s). Needs `FMP_API_KEY` (already set).
- Fail-soft: disabled / no key / any error => `{}` (no signal, like the other
  sources). One market-wide call per refresh, bounded 8s, in the collect_all
  thread pool (scheduler thread, off the request path).

## Tests

`tests/test_catalyst_fmp_analyst.py` (6): disabled / no-key / fail-soft; keeps
rating changes + drops reiterations; newest-per-symbol; keeps a bare grade change.
Full catalyst suite green.

## Next (roadmap remainder)

Brain setup-grading (Brain pack IS installed on the pod — `/data/brain` +
`brain_service.setup_winrate/lookup_playbook/find_historical_analogs`), then
Finviz/AV news. Plus the deferred **options-flow** light-up (worker
`top-conviction` perf fix, after-hours flow-worker deploy).
