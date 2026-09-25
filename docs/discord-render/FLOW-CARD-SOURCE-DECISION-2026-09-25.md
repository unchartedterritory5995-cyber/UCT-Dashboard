# `/flow` card data source — the decision packet (2026-09-25)

**Decision owner:** Patrick, with Ravi (the Options Flow page and `live_massive_router.py`
are his surface). **Written by:** the 2026-09-24/25 flow session. **Status:** OPEN.

## The question in one sentence

Should the Discord `/flow` card be derived from the Options Flow page's own product
(one authority, exact parity), or keep its own rollup with gates aligned to the page's?

## What is true today (measured, production, evidence files cited)

Shipped 2026-09-24/25 on master (`74beea1d2`, `f7194160b`):

- single-ticker lookups no longer apply market-wide cap floors (DELL 0 → 16 contracts);
- an empty window widens 1 → 5 → 20 → all and says so on the card and in the reply;
- a 2 s date scan and a 4 s planner miss were removed from every single-ticker call.

The card and the page are still **two derivations of one tape** (`flow.db`):

| | the CARD (`/api/live/massive/ticker-flow`) | the PAGE (`/api/flow/ticker-product/{sym}`) |
|---|---|---|
| classifier | `live_massive_router._row_to_alert` + `_build_by_contract` rollup | `processFlowData` (`app/src/pages/optionsFlow/flowCompute.js`), run server-side by the `flow-facts` Node bundle |
| which prints count | MAGENTA/YELLOW only; WHITE only ≥ $500K (SQL) and then dropped under $1M (`premium_override.min_premium`) | every print; `premiumFilter` has no floor below $500B market cap |
| blank-side SWEEP | presumed ask-side and given a direction (`sweep_empty_side_as_ask`) | left side-less unless the rescue rule fires |
| per-contract floors | none for a single ticker (since 9/24) | none |
| direction rules | side letters, heavy-block de-direction, deep-ITM guard, lottery drop, spread-leg drop | its own side rules, `_rescuedBlock`, `isDeep`, ML handling, dominance gate |
| window | server-side, trading days ending today | full history, scoped at render time by `_scopeAllDirectional` |

**Post-deploy parity run, 2026-09-24 ~21:35 CT, 1-day window** (`evidence/flow-parity/2026-09-24-days1-postdeploy-74beea1d2.json`):

| ticker | card | page | direction |
|---|---|---|---|
| DELL | 16 contracts, BULL 2.58M / 114K | 108 prints, BULL 7.84M / 3.81M | AGREE |
| BP | 1 contract, NEUTRAL (all unclassified) | 14 prints, BULL 446K / 201K | AGREE (neutral is not a contradiction) |
| ASTS | widened to 5 d, BULL | BULL | AGREE |
| PLTR | 12 contracts, BEAR 2.67M / 3.69M | 187 prints, BEAR 4.32M / 8.22M | AGREE (was BULL vs BEAR before the floor fix) |
| AMD | 75 contracts, BULL | 82 prints, BULL | AGREE |
| NVDA | 18 contracts | page cannot derive: "too big to derive within budget" | INCONCLUSIVE |

Direction agrees on every derivable name. Magnitudes differ by 2–4× because of the
print-admission rules above. The blank-sweep presumption is the one mechanism still able to
flip a net direction on a thin day: on DELL all 9 of the card's sided contracts were prints the
page left side-less.

Instrument: `python tools/flow_card_parity_audit.py --symbols DELL,PLTR --days 1 --widen`
(needs `SMOKE_EMAIL` / `SMOKE_PASSWORD`). `--self-check` proves it can fail.

## Option A — derive the card FROM the page product (recommended)

**Principle.** One authority. The card shows what a member would see if they opened the page,
scoped to the same dates, summed the same way. No second classifier to drift.

**Data path.**

1. The Discord job (both the pre-V2 `run_flow_card_job` and the V2 `adapters/flow.py`) asks
   flow-worker for a **windowed page product**: a new
   `GET /api/flow/ticker-product/{sym}?source=&window_days=N` that runs the SAME `flow-facts
   search` derivation over the ticker's rows **restricted to the last N trading days** (SQL on
   `CreatedDate`, using `idx_flow_created_symbol`), returning `{all_directional, TICKER_DB}`
   exactly as today's product does. Cache identity `(sym, source, version, window_days)`.
2. The card builder maps page rows → card contracts:

   | card field | from the page row |
   |---|---|
   | `cp`, `strike`, `exp` | `CP`, `K`, `E` (`E` is year-less or 2-digit; normalise as `tools/flow_card_parity_audit._mdy` does) |
   | `premium`, `volume` | Σ `P`, Σ `V` over the window's rows for that contract — the page's own `_scopedByContract` re-sum |
   | `direction`, `bull_premium`, `bear_premium` | Σ `P` by `D` ∈ {BULL, BEAR}; net per contract as the page's `_netD` |
   | `spot`, `dte`, `moneynessPct` | `Spot`, `DTE`, `pctFromSpot` |
   | `oi`, `oiSeries`, `entry/now/perf` | unchanged: the existing live enrichment (`massive_oi_snapshots.fetch_price_oi_for_contracts`, `oi_snapshots.get_history`) |
   | `grade` | none on the page; drop the column or map `confirmed` → a chip |
   | net bar | Σ bull / Σ bear over the scoped rows, exactly the page's summary cards; "unclassified" = prints with no `D` |

3. Widening (1 → 5 → 20 → all) stays: it is a loop over `window_days`.

**The blocker, and the answer to it.** The page's server derivation refuses head names
("too big to derive within budget": 48 MB / 20 s CSV materialisation, added after an NVDA build
held a lane 7.5 minutes at 11 GB RSS). The page itself derives those in the browser. A Discord
job cannot. The **windowed** derivation is the answer: NVDA's 1-day tape is ~3.5K rows, 5-day
~18K, both trivially inside budget. ⚠️ A windowed derivation is **close to but not identical to**
the page's full-history result, because `processFlowData`'s contract-level rules (the rescue rule's
`_contractPrem` dominance gate, `consMap`) see only the window's rows. State that on the card
("window-scoped") and measure the residual with the parity tool before flipping.

**Fallback.** If the derivation declines (bundle unavailable, over budget, timeout), fall back to
today's rollup **and label the card** ("rollup fallback") — a degraded delivery, never a silent
second truth. Never fall back on `ok: false` from the derivation itself.

**Flag.** `DISCORD_FLOW_CARD_SOURCE=page|rollup` on web and flow-worker, default `rollup` until
the parity tool reads AGREE with a magnitude ratio inside a stated band on a 20-name sweep.

**Cost.** ~1 day: the windowed endpoint (partner file `api/flow_router.py`, Node bundle unchanged),
the mapper + card changes (`api/flow_ticker_card.py`, `api/routers/discord_interactions.py`,
`api/services/discord_render/adapters/flow.py`), rails for the mapper on a fixture product, and
the parity tool extended to compare page-vs-page-windowed as well.

**What this needs from Patrick and Ravi.** Ravi's agreement that a windowed derivation on
flow-worker is acceptable load (it is bounded by the same lane lock the search product uses) and
that the card may show the page's numbers verbatim; Patrick's call on the grade column.

## Option B — keep the rollup, align its gates

**Changes.** For `only_ticker` lookups: drop the colour gate (admit WHITE prints); let
`_row_to_alert` keep WHITE rows below `premium_override.min_premium` on that path; make the
blank-side sweep presumption match the page's rule (side-less unless rescued); keep the per-contract
floors off.

**Cost.** ~half a day, but every change is inside Ravi's classifier, and the result is still two
classifiers. The parity tool would show smaller gaps; it cannot show zero, and a direction flip
on a thin day remains possible whenever the two side rules disagree on a large print.

**When B is right.** If Ravi does not want the Discord card reading his derivation directly, or
if the windowed-vs-full-history residual in A turns out to be larger than the gap B closes.

## Recommendation

A, behind the flag, measured with the parity tool before the flip. B only if Ravi vetoes A.

## Not in either option

- The V2 render path flip (`DISCORD_RENDER_V2_ENABLED`) and its gate ledger — a separate program
  (`docs/discord-render/LEDGER.md`, owner pack v7).
- The 3 s ack miss under no load (C-02): event-loop starvation on web, not a card question.
