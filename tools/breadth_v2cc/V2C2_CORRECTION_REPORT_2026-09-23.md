# Breadth V2c2 — Targeted Correction + Pre-Grind Acceptance (bounded)

Date 2026-09-23. Diagnostic + correction design only: **PRODUCTION UNTOUCHED · NO MERGE · NO CUTOVER**.
Frozen V2c artifact `ad8c157f…` untouched (re-verified). Parked runner not restarted.

Refs: start master = production = `d4e8dc327`. Correction `breadth/v2c-correction` @ `f51bf36b5`
(base `dbacc727e`). Validator `breadth/v2c-validation` @ `9fabd6a64` (base `4ef4f63f9`).
Merge design `breadth/v2c2-merge-design` @ `33971f689` (base `5a6d758aa`). All local, none pushed.

## Recommendation: STOPPED — METHODOLOGY DECISION REQUIRED
Every correction you ordered is implemented and independently proven on the bounded matrix. One
methodology fact surfaced that the gate list did not anticipate: **live UCT breadth (collector,
`BREADTH_DIVIDEND_BASIS=1`, yfinance auto_adjust) is on a DIVIDEND-adjusted basis; the provider
grouped series used by V2c2 is split-only.** On canonical PIT UCT this is a −1.2 pt (50-day) /
−1.9 pt (200-day) historical/live seam; recomputing the same sessions on the dividend basis removes it
(+0.04 / +0.23). Launching a 22-hour grind now would knowingly bake in a historical/live drift.

## Results
| gate | status | evidence |
|---|---|---|
| Dual-class | ✅ | one seam `breadth_ticker.canon` (provider '.' ; collector '-'→'.'); NYSE universe_count c/h 0.9871→0.9999, US 0.9924→0.9998; 18–96 US / 18–39 NYSE dual-class members per session now measured |
| Ticker reuse | ✅ | identity rule v3 (PIT details, ticker-change events, change-point bisection, price-continuity reorg test); 325 symbols; 2008-10-10 UCT 1,316→1,103 (−213; gap heuristic −209) — all sampled removals are different securities (ABX Barrick, AMR Corp, APP American Apparel, ALM an Alabama Power bond…) |
| PIT UCT | ✅ data / ⚠ value parity | live snapshots only from **2026-03-23** (2026-01-02…03-20 were back-filled 2026-03-22 and are add-only → excluded); 120 sessions reconstructed; membership matches; residual = dividend basis (F4) |
| Back-test semantics | ✅ | `uct_backtest` stored only in artifacts, not in `breadth_universes.UNIVERSES`; merge design refuses non-registry universes |
| F1 / F2 | ✅ exact | oracle exact; golden splits all REAL_ACTION |
| F5 | ✅ | pass_meta: "provider grouped-adjusted daily close (canonical daily close)"; no "official close" claim |
| Adjusted-data guard | ✅ | raw-arbitrated classes; independent re-derivation identical (609 names, 2,876 boundaries); old 190: 99 gone in one vintage, 77 provider defects, 14 unresolved → all withheld; worst withholding per session 2.54 % NASDAQ, 1.43 % US, 0.43 % UCT |
| Vintage | ✅ | all 10,506 files re-fetched 17:54:25–18:05:05Z 2026-09-23 with manifest; no split executed inside the window |
| Sessions | ✅ | rule calendar; every universe-session = 390 / 210 buckets except the 4 COVID circuit-breaker sessions (376 — real halts kept) |
| EMA | ✅ decided | canonical = pandas adjust=False; live impact over 60 sessions = 0.0 pt (0 flips); **not deployed** |
| Ratios | ✅ implemented | Monitor definition; full-window only; 35 metrics/universe |
| Body / precedence | ✅ | one list drives serving + rank + gate; 30 ordered-pair rails + per-source negative controls green |
| Oracle | ✅ | matrix 24,829/24,833 exact (4 = one float tie, CCH at exactly its EMA); PIT 4,187/4,187 |
| Attribution | ✅ | OTHER = 0 on 20 anchors (S0 = frozen, S6 = new) |

Open: F4 dividend basis; canonical UCT has no history before 2026-03-23 (presentation decision);
grind launcher + preflight pins for V2c2; refetch the grouped cache in one window immediately before
the grind.
