# Stock Catalysts — Coverage & Precision Pass (2026-06-15)

## Goal

Make the Stock Catalysts tile **the go-to morning spot** for new/sudden headlines
and price movements — by improving the **backend**, not the UI. Two objectives,
held in tension:

1. **Miss nothing notable.** Any headline, event, or price/group move a trader
   prepping for the open would notice should reach the candidate pool so it *can*
   rank (the tile still shows the curated top 20).
2. **Spend no row on junk.** Never surface something un-actionable. The user's
   sharpest definition of junk: **untradeable** names (illiquid / low-float /
   penny).

The tile UI is unchanged this pass. A dedicated `/catalysts` destination is
explicitly deferred to a future session.

## Decisions (locked with user 2026-06-15)

- **Shape:** keep the existing curated tile; improve backend coverage + precision.
- **Analyst-actions sourcing:** free / already-paid only — wire push + Finnhub
  (per-candidate), auto-upgrade to TheFly only if `THEFLY_API_KEY` is set. No new
  paid subscription.
- **Tradeability gate:** moderate + **fail-open** — add a float check, keep
  fail-open on missing data, log every rejection for evidence-based tuning.

## Current state (verified by code read, not docs)

- 8 parallel sources in `api/services/catalyst/sources.py`: Massive movers,
  batch snapshot, earnings (EW+Finnhub), tweets (curated+search), RSS,
  UCT scanner, Perplexity discovery (3 queries), dollar-volume gap scan
  (top-15 capped).
- `api/services/catalyst/filters.py::quality_gate()` already drops untradeable
  junk: `quote_type==EQUITY`, price ≥ `CATALYST_MIN_PRICE` ($3), dollar-volume ≥
  `CATALYST_MIN_DOLLAR_VOL` ($5M/day, ADV-preferred), market-cap ≥
  `CATALYST_MIN_MARKET_CAP` ($300M). **Fail-open on missing data.** Missing lever:
  **float / shares-outstanding**.
- `filters.py::is_real_catalyst()` keeps momentum-only gappers on purpose
  (move+volume, not news) — consistent with user keeping "big move, no catalyst".
- Analyst actions already half-wired: `engine.get_analyst_actions()` returns
  `{upgrades, downgrades, pt_changes}` from `wire_data["analyst_actions"]`
  (each: `ticker, action, firm, from_rating, to_rating, price_target`).
  Wire sources it from **AlphaVantage + TheFly** via `thefly.fetch_all(...)` at
  the 7:35 AM ET run (push lands ~7:43 AM). Finnhub `/stock/upgrade-downgrade`,
  `/stock/recommendation`, `/stock/price-target` are already used elsewhere
  (`earnings_estimates.py`, `call_recap.py`, `earnings_enrichment.py`).
- Tile already supports an `Analyst` type (📈) and `Sector-wide` (🏭) in
  `TYPE_ICONS` — **no frontend change needed**.
- `api/services/catalyst/coverage_audit.py` + `/admin/catalyst-coverage` already
  measures "big movers caught vs missed".

## Workstream 1 — Analyst actions as a first-class catalyst

**Why:** the single biggest *reliable* miss. Upgrades/downgrades/PT-changes are a
top morning-mover category; today they only surface if they happen to appear in
generic news/tweets/Perplexity.

**New source** `_pull_analyst_actions()` in `sources.py`:

- **Discovery seed (market-wide):** call `engine.get_analyst_actions()`; every
  ticker with an upgrade/downgrade/PT-change today enters the pool carrying
  `analyst_meta = {action, firm, from_rating, to_rating, price_target}`. This is
  the wire-pushed AV+TheFly set; available once the wire lands (~7:43 AM ET).
- **TheFly direct (optional):** if `THEFLY_API_KEY` is set, also call
  `thefly_news.get_squawks(category="analyst", count=50)` for market-wide
  intraday analyst calls. Graceful no-op without a key (already the wrapper's
  behavior).

**Per-candidate enrichment** (catches analyst-driven gappers *before* the wire
lands, and adds detail for synthesis): for pool candidates lacking `analyst_meta`,
fetch Finnhub `/stock/upgrade-downgrade` (most recent, today/yesterday only) +
optionally `/stock/price-target`. Bounded to the selected top-N to control calls
(reuse the existing per-top-candidate enrichment pattern in `engine.py`). Cache
per (ticker, day).

**Tagging / typing:** keep the 4-tag taxonomy; analyst-driven rows get
`catalyst_type="Analyst"` (already iconned). Add a small selection guarantee so
analyst movers always get representation:
- Add `CATALYST_QUOTA_ANALYST` (default 2) OR, simpler, ensure at least N
  analyst-typed rows survive selection by pre-reserving them in
  `selection.py`. **Chosen:** a min-reserve in selection (no new top-level tag —
  analyst rows still carry one of the existing tags, e.g. `Catalyst`/`News`),
  so the tile's tag chips are unchanged. Env: `CATALYST_MIN_ANALYST_ROWS=2`.

**Synthesis:** pass `analyst_meta` into the `synthesize.py` prompt so the thesis
reads e.g. *"Upgraded to Overweight at Morgan Stanley; PT raised to $X from $Y."*
Counts as a real source signal (so it does not trip the "no clear catalyst"
guard) and contributes to `catalyst_at` via the action timestamp when present.

**Scoring:** add `W_ANALYST_ACTION` (default ~12, env-overridable) when
`analyst_meta` present, so a clean upgrade with a modest gap still ranks.

## Workstream 2 — Tradeability gate hardening

**Why:** the user's one clear junk definition — untradeable (illiquid / low-float
/ penny).

**Extend `quality_gate()` in `filters.py`:**

- **Float / shares-outstanding check (new lever):** read `float_shares` /
  `shares_outstanding` from yfinance via the existing `ticker_metadata` cache
  (add fields to the metadata fetch + cache schema). Drop names whose
  **float < `CATALYST_MIN_FLOAT` (default 5,000,000 shares)** — the classic
  low-float pump signature — *only when float data is present* (fail-open on
  missing). Prefer float; fall back to shares-outstanding when float is absent.
- **Keep** existing price/dollar-volume/market-cap lines and the fail-open
  philosophy. Dollar-volume stays the primary line (ADV-based).
- **Rejection logging:** every gate drop records `{ticker, reason, price,
  dollar_vol, float, market_cap, ts}` to a lightweight rolling log (reuse the
  catalysts DB — a `catalyst_gate_rejections` table, capped/rolling, or extend
  the existing cost/telemetry pattern). Exposed read-only at
  `/admin/catalyst-rejections` for tuning. This is the evidence loop: we tune
  `CATALYST_MIN_*` from what's actually being dropped/kept, not by guessing.

All thresholds env-tunable; no redeploy needed to adjust on Railway.

## Workstream 3 — "Notable move / group move" coverage net + audit

**Why:** guarantee nothing notable is excluded *before* ranking.

- **Notable-move detector (broaden discovery):** generalize the gap-scan into a
  comprehensive net over the liquid universe snapshot — admit any name with
  `|move| ≥ CATALYST_NOTABLE_MOVE_PCT` (default 4%) **OR** dollar-volume surge ≥
  `CATALYST_NOTABLE_DOLLARVOL` (default $25M and ≥2× ADV). Remove/raise the hard
  top-15 cap that currently truncates the pool (`CATALYST_GAPSCAN_TOP_GAP`) — the
  quality gate trims junk and selection still curates the top 20, so a larger
  pool only *adds* coverage, it doesn't bloat the tile. Keep a sane safety cap
  (e.g. 150) to bound cost.
- **Group/sector co-move:** you already compute `sector_momentum_count` +
  `sector_contexts`. Ensure that when ≥`CATALYST_GROUP_MIN` (default 3) liquid
  names in a sector/industry move together, the cluster's leaders are admitted to
  the pool even if an individual name is just under the single-name move
  threshold (sympathy movers a trader would notice). Surfaces via the existing
  sector banner; leaders get `catalyst_type="Sector-wide"` (🏭, already iconned).
- **Coverage audit extension:** extend `coverage_audit.py` to grade three nets,
  not one:
  1. big single-name movers caught vs missed (existing),
  2. analyst actions caught vs missed (new — diff wire/Finnhub analyst set vs
     surfaced set),
  3. sector clusters caught vs missed (new).
  Expose at `/admin/catalyst-coverage`. **Run it** after deploy to validate the
  net has no holes; iterate thresholds from the report.

## Guardrails / non-goals

- Tile UI unchanged. No new nav page. (`/catalysts` destination deferred.)
- Skip-if-stable hashing + daily cost caps untouched. New analyst enrichment
  reuses the bounded per-top-candidate pattern and caches per (ticker, day) so it
  does not blow the cost cap.
- Fail-open everywhere metadata may be missing — never suppress a legit fresh
  name for lack of cached float/cap data.
- Momentum-only gappers (move+volume, no headline) remain eligible — the user did
  *not* flag those as junk.
- No ML / no screenshots — all gates remain deterministic + env-tunable.

## Testing

- `filters.py`: unit tests for the float lever — drops low-float when float
  present, fail-open when absent, interaction with price/$-vol/cap lines.
- `sources.py`: `_pull_analyst_actions()` shapes wire + Finnhub + TheFly inputs
  into candidates with `analyst_meta`; degrades cleanly when each source is
  empty / key absent.
- `selection.py`: min-analyst-reserve guarantees ≥N analyst rows when available,
  never backfills junk to hit it.
- `scoring.py`: analyst-action weight applied iff `analyst_meta` present.
- `coverage_audit.py`: the three-net grading returns caught/missed correctly on
  fixtures.
- Backend test suite stays green; no frontend test changes expected.

## Open verification items (do during implementation)

- Confirm `wire_data["analyst_actions"]` is actually present in the live push and
  its typical count/freshness (the wire warns when AV returns 0 — rate-limited
  days may be thin; Finnhub per-candidate is the backstop).
- Confirm `ticker_metadata` yfinance fetch can supply `floatShares` /
  `sharesOutstanding` cheaply (it already pulls sector/market_cap/ADV).
- Run `/admin/catalyst-coverage` pre- and post-change to quantify the coverage
  lift and tune thresholds.

## Rollout

Backend-only; ships behind the existing env-tunable knobs (all new thresholds
have safe defaults). Commit + push to master (Railway) per the user's standing
preference. Run the coverage audit after deploy; user verifies the morning tile.
