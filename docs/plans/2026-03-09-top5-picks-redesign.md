# Top 5 Actionable Setups — Redesign
**Date:** 2026-03-09
**Status:** Approved

## Problem

The current Top 5 Picks draws from a limited candidate pool (UCT20 leaders + premarket gappers + sustained leaders) and produces templated output that lacks depth and specificity. Stock selection is the primary gap — the scanner output (HTF, 20EMA/50SMA pullbacks, remounts) exists in `wire_data["candidates"]` but is not fed into the picks generation at all.

## Goals

1. Dramatically widen the candidate universe — every setup the engine identifies should be eligible
2. Cross-confirm candidates appearing in multiple buckets (UCT20 + scanner + earnings = strong signal)
3. Ground the AI's selection and writing in actual UCT KB rules for the relevant setup types
4. Produce a formal analyst brief per pick: narrative paragraph + 4 structured fields

---

## Candidate Universe

All sources are deduplicated into a single ranked pool before AI selection.

| Source | Max Candidates | Key Data |
|--------|---------------|----------|
| Scanner PULLBACK_MA (HTF, 20EMA, 50SMA pullbacks) | 30 | score, ADR%, pattern_type, ema_distance_pct, days_in_pattern, vol_acc_ratio, pole_pct |
| Scanner REMOUNT | 8 | score, candle_score, signal chips |
| Scanner GAPPER | 7 | gap%, volume ratio, news headline |
| UCT20 leaders | 20 | setup_type, score, confidence_tier, regime_fit |
| Earnings gappers (BMO/AMC) | all today | gap%, beat/miss, EPS surprise%, verdict |
| News catalyst gappers (Finviz movers) | top 10 | pct change, headline |
| Sustained leaders (3+ sessions in UCT20) | all | consecutive_days |
| Analyst upgrades (today) | all | from/to rating, price target |

**Cross-confirmation tagging:** Each candidate accumulates source tags. A stock appearing in `UCT20 + PULLBACK_MA + SUSTAINED` receives higher priority than a single-source candidate.

**Pre-filter before AI:** Remove LOW_ADR, EXTENDED (>8% above EMA), and candidates with no clear setup signal. Cap pool at top 40 by composite quality score.

---

## KB Injection

Before the Claude call:
1. Survey the candidate pool for represented setup types (HTF, EP, VCP, REMOUNT, PULLBACK_MA, GAPPER, etc.)
2. Query UCT KB (`api.get_knowledge()`) for each present setup type — pull rules, entry criteria, failure modes, trader frameworks
3. Cap total KB injection at ~1,500 chars
4. Inject as grounding context so Claude writes against actual UCT methodology

---

## AI Call

**Model:** `claude-sonnet-4-6`
**Single call** (no two-stage pipeline)
**Max tokens:** 2,000 (up from 1,200)
**Timeout:** 60s (up from 45s)

**System prompt:** UCT Intelligence formal analyst. Deep methodology grounding. Selects based on: setup quality, regime fit, volume confirmation, catalyst strength, cross-source confirmation.

**Inputs provided:**
- Full candidate pool (top 40 with unified data cards)
- KB excerpts for represented setup types
- Regime context: phase, distribution days (SPY/QQQ), trend score, VIX, breadth %, exposure %
- Today's date + market session context

**Task:** Select 5 best candidates, rank by conviction, write a formal analyst brief for each.

---

## Output Format Per Pick

```
[N]  TICKER  ·  Setup Type  ·  [CONVICTION]  ·  SOURCE_TAGS

[3–5 sentence formal analyst narrative covering: what the stock is doing
technically, what makes the setup compelling, volume context, which UCT
framework/trader methodology it aligns with, and why the timing is right
given the current regime.]

Entry Zone   |  [specific price level or trigger condition]
Stop         |  [specific price level — base low / EMA / structure — + % distance from entry]
Target       |  [R-target or % upside range]
Invalidation |  [what would kill the trade before or after entry]
```

**Conviction levels:**
- `HIGH` (green) — A+ setup, strong volume, regime-aligned, multi-source confirmation
- `MEDIUM` (amber) — solid setup, one or two caveats
- `WATCH` (muted) — valid but needs a trigger or regime improvement

---

## Implementation Scope

### 1. `morning_wire_engine.py` — `generate_top_picks()`
- Add `candidates` parameter (scanner output from `_uct_candidates`)
- Build unified candidate pool from all 8 sources
- Dedup + cross-tag + pre-filter logic
- KB lookup for represented setup types
- Rewrite system prompt and user prompt template
- Increase max_tokens to 2,000, timeout to 60s
- Update output HTML template to new format (narrative + 4 fields)

### 2. `morning_wire_engine.py` — call site
- Pass `candidates=_uct_candidates` into `generate_top_picks()`

### 3. `ut_morning_wire_template.html` / dashboard CSS
- Update `.rd-pick` card styles for new layout (narrative block + field rows)
- Add source tag chips (small pills: UCT20, HTF, EARNINGS GAP, etc.)

---

## What Does NOT Change
- Engine run frequency (daily at 7:35 AM ET)
- Single Claude call (no two-stage pipeline)
- Placement in the Morning Wire rundown
- Period buttons, chart, other rundown sections
