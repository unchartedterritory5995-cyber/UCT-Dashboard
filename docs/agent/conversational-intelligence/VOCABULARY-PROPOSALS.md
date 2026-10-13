# Trading vocabulary v1 — proposals for owner review (Phase 1B)

**Rules.**
- Only concepts marked **approve-now** would expand deterministically.
- Everything else stays behind the review gate (off) until the owner signs off on its definition and numbers.
- Expanded screens always show an **Assumptions** line ("Interpreted *strong* as: ranked by RS Rank").
- Fields are the existing screener catalogue fields; no new calculations.

## A. Threshold-free (proposed approve-now)

| Concept | Words | Expansion | Assumption shown |
|---|---|---|---|
| strong / strongest / relative strength / leaders | strong, strongest, RS, relative strength, leaders, leading | sort `rs_rank` desc (no cut-off) | "ranked by RS Rank" |
| weak / weakest / laggards | weak, weakest, laggards, lagging | sort `rs_rank` asc | "ranked by RS Rank, lowest first" |
| above / below the N-day MA (N ∈ 20, 50, 200) | above/below/over/under the 20/50/200 | `pct_vs_{ema20,sma50,sma200} > 0` / `< 0` | "20 = 20-day EMA; 50/200 = SMA" (field availability decides the type) |
| at a new 52-week high | new high(s), 52-week high | `new_52w_high` true | — |

## B. Need owner numbers (review gate, OFF)

| Concept | Proposed default for review | Trading implication | Alternatives |
|---|---|---|---|
| strong (as a *filter*, e.g. "strong semis") | `rs_rank ≥ 80` | Top quintile; the common CAN SLIM-style cut | ≥ 70 (wider), ≥ 90 (leaders only) |
| near a moving average | within ±2% of it (`|pct_vs_X| ≤ 2`) | "In the buy zone" at the MA | ±1% (tight), ±3% (volatile names) |
| pullback (to the 20) | `rs_rank ≥ 70` AND `0 ≤ pct_vs_ema20 ≤ 3` AND `ema20_rising` | A strong name in an uptrend, near support; excludes broken trends | Measure from the 10 or 50; require a % off the high (`dist_52w_high_pct` −5…−15) |
| uptrend / trend | `pct_vs_sma50 > 0` AND `pct_vs_sma200 > 0` | A classic stage-2 proxy, without an MA-stack field | Add `ema20_rising`; require 50 > 200 (needs a field) |
| breakout | `new_52w_high` (or `starter_52w_breakout`), volume ≥ 1.5× average | A base breakout on volume | 1.4× / 2× volume; 20-day high instead of 52-week |
| holding up / outperforming | RS Rank change vs index over **1 month** > 0 | Doesn't fall with the market | 1 week / 3 months; a relative-return field vs SPY (if present) |
| momentum (as a filter) | top RS Rank decile + `ema20_rising` | Persistent strength | Pure 1-month return ranking |
| consolidation / tight | ADR% ≤ 4 and within 10% of the 52-week high | A tight base near highs | 15%, ADR ≤ 3 |
| weakness / breaking down | `pct_vs_sma50 < 0` AND `rs_rank ≤ 30` | Lagging and below trend | Below the 200 instead |

## C. Default MA type for bare numbers ("put the 9 and 20 on")

Proposal: **EMA** for 8, 9, 10, 20 and 21, and **SMA** for 50, 100, 150 and 200. This matches the screener fields and common UCT chart templates, and the Assumption line says which was used. Alternative: EMA for everything, or ask once and remember (per member).

## Decision request
1. Approve section A as written (or strike items).
2. For each section B row: approve the default, pick an alternative, or keep it gated.
3. Choose the MA rule in section C.
