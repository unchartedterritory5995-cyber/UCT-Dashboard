# Stock Catalysts — Curator (swing-trader/news-desk selection brain)

**Date:** 2026-07-23
**Status:** shipped flag-gated (`CATALYST_CURATOR_ENABLED`), default OFF in code.

## Problem

The catalyst list decides its 20 rows with an additive score + a rigid
10/5/3/2 category quota. Two failure modes:

1. **The biggest raw % move can win even when it's untradeable** (a low-float
   penny pump), while a moderate mover with a real story gets buried.
2. **The quota force-fills to 20**, padding quiet days with nothing-burgers.

No additive formula captures "a swing trader wouldn't care about this" — the
regional-bank-earnings fix (2026-07-22) was one rule patched onto that formula,
and there are a hundred more blind spots. The owner's steer: *"it can't be all
systematic — it has to be seen through the eyes of a swing trader and news
specialist to identify what stocks and what catalysts are viable."*

## Approach

Put a **judgment layer at the front of selection**. The 8 sources + cheap gates
stop being the decision-maker and become a *net* that assembles a clean,
affordable candidate pool. On top sits an LLM curator that reads the pool *with
each name's real signals attached* and, like a desk head doing morning triage,
decides which names are genuinely worth attention and ranks them — cutting the
noise, keeping a quality floor, never padding.

### Pipeline (before → after)

```
Before: sources → gates → tag → additive score → quota(10/5/3/2) → Opus theses
After:  sources → gates → tag → additive score (rough pre-sort only)
                → CURATOR (Sonnet 5, judgment) → Opus theses (unchanged)
```

The curator **replaces** `selection.select_top_12` when enabled; everything
downstream (enrichment, Opus synthesis, grade-C hide, storage, alerts, UI) is
untouched. The order the curator returns *is* the display rank order.

## Rubric (baked into the curator's system prompt)

- **Keep:** hard company catalysts (M&A/FDA/guidance/contracts/index/halts),
  earnings that actually MOVED, Street-moving analyst actions, clean
  momentum/technical thrust even without a headline.
- **Cut hard:** micro-cap / sub-$5 / low-float penny pumps — untradeable no
  matter the %.
- **Otherwise:** rank by genuine swing-trade relevance (catalyst conviction ×
  tradeability × how cleanly it's moving). No rule for every noise type — a
  name moving on nothing just ranks low.
- **Count:** target ~15–20, quality floor. Cut nothing-burgers; allowed to come
  up short; NEVER pad to a number.

## Module — `api/services/catalyst/curator.py`

`curate(scored, *, market_date) -> list[dict]`:

1. Flag off / empty pool → `selection.select_top_12` (identical current behavior).
2. Over the daily hard cost cap (`cost_guard.may_synthesize`) → mechanical fallback.
3. Pre-sort `scored` by existing score, take the top `CATALYST_CURATOR_POOL` (40).
4. **Skip-if-stable:** fingerprint the pool (ticker + move + signal counts + tag);
   an unchanged fingerprint reuses the prior curated order with no re-bill.
5. Sonnet 5 call with the rubric + a compact per-candidate signal block
   (price/gap/vol/cap/sector/industry/tag + earnings/analyst/hunter/scanner
   one-liners + top 2 tweets + top 2 headlines).
6. Parse `{"picks":[{ticker,keep,rank,catalyst_type,why}]}` (reuses
   `synthesize._parse_json_response` — fence/prose tolerant).
7. Map back by ticker, drop `keep:false`, order by `rank`, cap to
   `CATALYST_CURATOR_TARGET` (20). Any pool name the model failed to mention is
   **kept as a safety net** (never silently dropped). Stamp `curator_*` fields
   and record verdicts for the explainer.

**Safety — `curate()` NEVER raises and never returns blank when the pool is
non-empty.** Flag off, cost cap, empty/bad JSON, an all-cut response, or any
exception → `selection.select_top_12`. The tile can't break or go dark.

## Cost

One Sonnet 5 call per refresh over ~40 candidates (skip-if-stable makes an
unchanged pool free), recorded to `catalyst_cost_log` under the existing
$8 soft / $15 hard daily caps. Opus still writes the theses on the survivors →
net cost ≈ flat (we synthesize ~the same count, just better-chosen names).

## Env vars

- `CATALYST_CURATOR_ENABLED` — master flag (default OFF in code; set `1` in
  Railway to go live; unset = instant rollback to the mechanical quota).
- `CATALYST_CURATOR_MODEL` (default `claude-sonnet-5`).
- `CATALYST_CURATOR_POOL` (40) — candidates handed to the LLM.
- `CATALYST_CURATOR_TARGET` (20) — soft ceiling on kept names.
- `CATALYST_CURATOR_MAX_TOKENS` (2000).

## Audit

`GET /api/catalysts/explain/{sym}` now returns a `curator` block
(`{keep, rank, why, catalyst_type}`) — how the judgment layer ranked or cut a
name in the last run — so the owner can eyeball its eye every morning.

## Tests

`tests/test_catalyst_curator.py` (12, LLM mocked): flag gating, cost-cap
fallback, bad-JSON/exception/all-cut fallbacks, rank+cut mapping, unmentioned-
name safety net, target cap, skip-if-stable reuse vs re-bill on a changed pool,
and the explain verdict surface.

## Rollout

Ship flag-gated; set `CATALYST_CURATOR_ENABLED=1` in Railway after deploy
(owner's "flip on with fallback" choice). Tune the rubric from live mornings;
roll back by unsetting the flag.
