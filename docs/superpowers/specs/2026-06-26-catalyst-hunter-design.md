# Catalyst Hunter — Opus 4.8 Discovery Layer

**Date:** 2026-06-26
**Status:** Design approved — pending spec review
**Feature area:** Stock Catalysts (`api/services/catalyst/*`, `CatalystTable.jsx`)

## Problem

The Stock Catalysts board is **reactive**: discovery is anchored to the Massive
movers feed (big % gappers) plus deterministic feeds (earnings, RSS, tweets,
scanner) and a Perplexity "what's moving" search. Opus only *summarizes* what
those feeds already surfaced — it never goes *looking*.

Concrete coverage gaps:

- A stock up only 1–2% on a real catalyst slips past the movers feed.
- **Analyst upgrades/downgrades** are checked only as *enrichment on the
  already-selected top-20* (`engine._enrich_with_analyst_actions`) — an upgrade
  on a name that isn't already a big mover never enters the pool. (A discovery
  feed `analyst_actions.get_analyst_candidates()` exists but its breadth is
  limited to Finnhub/TheFly/wire.)
- News is general-market RSS, not comprehensive per-ticker — a mid-cap contract
  win at 7 AM is invisible.
- Nothing detects a catalyst **before** the stock reacts.

## Goal

Make catalyst discovery **complete and early**: surface every materially real
catalyst this morning — what's moving *and* what has news / upgrades / earnings /
M&A / FDA — **including names that haven't moved yet**, tagged so the operator
can scan movers first and pre-move catalysts second. The existing quality gate +
skeptical Opus grader still keep the displayed board clean.

Cost is explicitly **not** a constraint (Opus 4.8 = $5/$25 per MTok; daily caps
remain the backstop). Use Opus where it is uniquely strong: live web search +
multi-step reasoning about its own coverage.

## Non-goals

- Deeper per-row analysis (key levels / how-to-trade / bear case) — separate,
  deferred. This spec is discovery/coverage only.
- A board-level "morning read" synthesis — deferred.
- Replacing the deterministic feeds — the hunter is **additive**; the cheap
  feeds stay as a floor.
- Changing the display funnel's curation philosophy — gates + grade-C hiding
  stay; we widen *detection*, not the noise that reaches the screen.

## Architecture

### 1. The hunter — `api/services/catalyst/hunter.py` (new)

An Opus 4.8 agent that returns structured catalyst candidates.

- **Model:** `claude-opus-4-8` (via `engine._get_anthropic_client()`).
- **Tools:** server-side web search (`web_search_20260209`, dynamic filtering —
  supported on Opus 4.8). This is **net-new wiring** — synthesis does not use
  tools today.
- **Thinking:** adaptive (`{"type": "adaptive"}`), so it reasons about which
  categories it still needs to cover and searches again.
- **Output:** structured (`output_config.format` json_schema) → a list of
  `HunterHit` objects (schema below). No free-form prose to parse.
- **Loop:** a bounded agentic loop (web-search tool calls until the model
  finishes or a max-iteration cap), then a final structured answer. Handle
  `pause_turn` (server-tool iteration limit) by re-sending to continue, capped.

**Two modes:**

| Mode | When | Behavior |
|---|---|---|
| **Deep** | First pre-market run (6:00 ET) | Broad multi-category sweep across all US equities; establishes the full board. ~30–60s. |
| **Light** | Later pre-market runs (6:30–9:30 ET + 9:10/9:20 pre-open) | Fed the tickers already on today's board; prompted only for *new/changed* catalysts since the last hunt. Fast, focused. |

Mode is chosen by the caller (engine) based on whether a deep hunt has already
run today (a per-date flag, mirroring the desk/heal one-shot patterns).

**Categories swept** (prompt-enumerated): earnings (beat/miss/guidance),
analyst rating change + price-target change, M&A / takeover / strategic review,
FDA / regulatory (approval/CRL/trial data), major contract / customer win,
index inclusion/removal, secondary offering / dilution, halt / resumption,
other material company-specific news. Macro/sector-wide-only items are excluded
(same philosophy as the existing skeptical grader).

**HunterHit schema (structured output):**

```
{
  "ticker": "string (US-listed equity symbol)",
  "catalyst_type": "Earnings|Analyst|M&A|FDA|Guidance|Contract|Index|Offering|Halt|News",
  "headline": "string (one factual line, no hype)",
  "source_url": "string (the article/release the claim rests on)",
  "when": "string (approx ET time or 'pre-market' / 'overnight')",
  "moving_yet": "boolean (is the stock already reacting materially?)"
}
```

**Guardrails:**
- Fail-open: any exception → return `[]`, log, never break the refresh.
- Env-gated: `CATALYST_HUNTER_ENABLED` (default off until validated).
- Cost-logged via the existing `catalyst_cost_log` (model + tokens; web-search
  usage noted). Subject to the existing daily soft/hard caps — and the cap is
  now enforceable because `cost_guard._PRICING` carries `claude-opus-4-8`.
- Ticker sanity: drop non-`[A-Z.]{1,6}` symbols and anything not resolvable to a
  real US equity (reuse the snapshot/metadata enrichment already in `collect_all`
  to validate + price; unresolvable tickers fall out at the quality gate).

### 2. Wiring into the pipeline — `sources.collect_all()`

Add the hunter as a source so its hits merge into the candidate dict by ticker.
Each hunter-sourced candidate carries:

- `catalyst_type` (from the hit)
- `hunter_confirmed = True`
- `hunter_headline`, `hunter_source_url`, `hunter_when`
- `moving_yet` (from the hit)

If a ticker is already in the pool from another source, the hunter fields are
merged in (we keep the richest signal set).

The deep-vs-light decision and "tickers already on the board" list are passed
from the engine into `collect_all` (or the hunter reads today's stored board
directly via `store.get_for_date`).

### 3. Gate change — `filters.is_real_catalyst`

Today a not-moving name passes only on `earnings_just_reported` / `scanner_setup`
/ `analyst_meta`. Add: **a `hunter_confirmed` candidate passes** (a hunter hit IS
a confirmed hard catalyst), even at 0% gap / normal volume.

`filters.quality_gate` (price ≥ floor, liquidity, market-cap, float, equity-only)
is **unchanged** — early catalysts still must be on a tradeable, liquid name.
This is the deliberate boundary: we relax "is it moving?", never "is it junk?".

### 4. Scoring — `scoring.py`

Add a confirmed-catalyst component so a pre-move name ranks onto the displayed
board instead of sinking to ~0 (current score is gap-dominated). Per-category
weights, env-overridable (`CATALYST_SCORE_W_HUNTER_<TYPE>`):

- M&A, FDA → high (these are decisive even at 0% move)
- Earnings, Guidance, Analyst → medium
- Contract, Index, Offering, Halt, News → low–medium

A moving name keeps its gap/volume score and simply gets the bonus on top, so
movers still outrank flat catalysts by default — but a high-conviction pre-move
catalyst (e.g. confirmed M&A, halted) can still surface.

### 5. Tagging + display

**Backend (`tagging.py`):** existing tag taxonomy (Earnings/Catalyst/Gapper/News)
is unchanged for sorting/quotas; `catalyst_type` is carried alongside for display.

**`moving_yet` → `pre_move` flag:** a candidate is `pre_move` when
`hunter_confirmed` and `abs(gap_pct) < CATALYST_PRE_MOVE_GAP` (default ~2%).

**Frontend (`CatalystTable.jsx`):**
- A **`PRE-MOVE`** chip on rows that are confirmed-but-flat (distinct from the
  normal mover rows), so movers scan first / early catalysts second.
- A small **catalyst-type glyph** per row (📊 Earnings · ⬆/⬇ Analyst · 🤝 M&A ·
  💊 FDA · 📈 Guidance · 📄 Contract · …). Per the no-generic-emoji rule, use the
  branded `UIcon` set, not system emoji.
- Citations popover already exists (`thesis_sources`); `hunter_source_url` feeds it.

### 6. Synthesis — unchanged

`synthesize.synthesize_ticker` already runs on Opus 4.8. It receives the richer
`catalyst_type` + `hunter_headline` + source so the 2–3 sentence thesis and the
grade are accurate. The skip-if-stable hash already keys on the signal set, so a
hunter-added signal correctly triggers (re)synthesis.

### 7. Analyst-actions hardened floor (approach C)

Make upgrades/downgrades robust independent of the hunt: keep
`sources._pull_analyst_actions` as a first-class discovery source (it already
is) and ensure it's broad — confirm Finnhub coverage and, if thin, widen the
window/sources. The hunter is the breadth engine; this is the deterministic
safety net for the one category called out as most important.

## Cadence (scheduler — `api/main.py`)

No new cron. The hunter runs **inside `engine.run_refresh`**, which the existing
premarket crons already fire (6:00–9:30 every 30m + 9:10/9:20 pre-open). The
engine decides deep (first run of the day) vs light (subsequent) from the
per-date flag. AMC burst (4–4:30 PM) runs light hunts too (after-hours
catalysts). Gated by `CATALYST_HUNTER_ENABLED`.

## Failure modes

- Hunter raises / web search errors → `[]`, refresh proceeds on the other 8
  sources (no regression vs today).
- Hunter hallucinates a ticker → fails snapshot/metadata resolution → dropped at
  the quality gate (no price = untradeable).
- Hunter over-reports flat names → quality gate + grade-C hiding cull them;
  scoring keeps movers ranked above marginal pre-move rows.
- Cost runaway → existing daily soft ($8) / hard ($15) caps; hunter honors
  `may_synthesize`/equivalent budget check before running.

## Testing

- `hunter.py`: pure parsing/validation of the structured output (schema coercion,
  bad-ticker drop, mode selection) with the Anthropic call mocked.
- `filters.is_real_catalyst`: hunter-confirmed + 0% gap → passes; junk still
  fails quality_gate.
- `scoring.py`: per-category bonus applied; mover still outranks flat catalyst at
  equal type.
- `sources.collect_all`: hunter hits merge by ticker; fields carried.
- Frontend: `CatalystTable` renders PRE-MOVE chip + type glyph; no regression on
  existing rows.

## Env vars

- `CATALYST_HUNTER_ENABLED` (default `0` until validated)
- `CATALYST_HUNTER_MODEL` (default `claude-opus-4-8`)
- `CATALYST_HUNTER_MAX_ITERATIONS` (web-search loop cap, default ~8)
- `CATALYST_PRE_MOVE_GAP` (default `2.0`)
- `CATALYST_SCORE_W_HUNTER_<TYPE>` per-category bonus weights
- (reuses existing `CATALYST_COST_CAP_DAILY` / `_HARD_CAP`)

## Rollout

1. Build behind `CATALYST_HUNTER_ENABLED=0`; ship dark.
2. Enable in prod; watch `catalyst_cost_log` + the 8:15 PM coverage audit for a
   few mornings to measure the lift in caught catalysts and the false-positive
   rate on pre-move rows.
3. Tune category weights + `CATALYST_PRE_MOVE_GAP` from evidence.

## Future (out of scope here)

- Per-row deep analysis (levels / how-to-trade / bear case).
- Board-level morning-read synthesis.
- Feed hunter "missed mover" findings back into auto-tuning.
