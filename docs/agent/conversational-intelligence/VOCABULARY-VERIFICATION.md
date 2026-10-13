# Section A trading vocabulary — metric verification (2026-10-13)

The owner approved Section A **only after the underlying metrics and semantics are verified**.

**How it was verified:**
- Read-only, against the code and a local copy of the Screener data (`C:\data\screener.db`).
- Snapshot 2026-10-13, 3,665 rows; 90.7% of rows are as of the latest completed session (2026-10-12).
- Only counts, coverage and pass/fail are recorded here; no market values.

**Outcome:** the definitions are sound, but each concept has a caveat that needs an owner answer. **No new vocabulary was enabled in Gate C**, and Section B stays off.

| Concept | Verdict | UCT definition (code) | Data coverage (local) | Recommended mapping |
|---|---|---|---|---|
| strong / weak = rank by RS Rank | ⚠ **Code verified; data NOT verifiable locally** | `rs_weighted_return.py:47-110`: an IBD-style weighted return on daily closes (3 months ×0.40; 6 months, 1 month and 1 week ×0.20 each; missing terms renormalised; no 3-month term → no rank). `rs_ranking.py:214-226`: percentile 1–99 over a universe of $300M+ market cap plus the UCT20. Nightly only, never live. Ties are not handled. | **`rs_rank` is 0% populated (0 / 3,665)** in the local copy | strong → sort `rs_rank` descending; weak → ascending. No filter. Unranked names (new listings with fewer than 64 bars) are never called weak. The existing "strongest" path already does this and refuses when the returned rows have no rank values. |
| above / below a moving average | ⚠ Verified, with an ambiguity | `technicals.py:524-537`: (close − MA)/MA × 100 on daily closes, rounded to 0.01. The EMA20 is seeded over a 400-bar window. Live overlay only when `SCREENER_LIVE_TIER_ENABLED` is on (off by default). | `pct_vs_ema20` 98.9%, `pct_vs_sma20` 99.0%, `pct_vs_sma50` 98.9%, `above_50sma` 98.9%, `pct_vs_sma200` 96.8%. Finite: PASS. `above_50sma` agrees with the sign of `pct_vs_sma50` on every row: PASS (0 mismatches). | 20 EMA → `pct_vs_ema20` > 0 / < 0; 20 SMA → `pct_vs_sma20`; 50 → `above_50sma` = 1 / 0. **200 → no catalog field** (`pct_vs_sma200` exists in the data but not in `FILTERS`), so refuse or ask. A value of exactly 0.00 (1–6 rows) is neither above nor below. |
| new 52-week high | ⚠ Verified, with a definition choice | `technicals.py:604-610`: `new_52w_high` = 1 when today's intraday high ≥ the highest high of the last 252 sessions (today included, ties count). Fewer than 252 bars → the whole history. Nightly only. | 99.9% populated; 0/1 boolean: PASS. Flagged: 110 rows; of those, 27 also **closed** at the high. | "new 52-week high" → `new_52w_high` = 1, described as "an intraday high at or above the prior 252-session high, latest completed session". Breadth's NH/NL wording ("trading above") differs slightly. |
| Price and timeframe basis | ✅ Verified | All of these are computed from daily bars in the nightly build (~03:00 ET), so each row is as of its own `bars_asof`. | 342 rows (9.3%) lag one or more sessions | Results say "latest completed session". Stale rows: owner question 5. |

## Owner questions (decisions, not engineering)
1. **RS Rank in production.** Is it populated? The local copy has none, and production can't be read from here. Section A's strong/weak depends on it.
2. **"Above the 20".** EMA20 or SMA20? Both fields exist. (Proposed: EMA, consistent with the approved MA defaults, and stated in the reply.)
3. **"Above the 200".** Should `pct_vs_sma50` / `pct_vs_sma200` be added to the Screener catalog? That is the Screener team's change; today the Agent would have to refuse.
4. **"New 52-week high".** Intraday high, as the code does (110 names today), or close-based (27)?
5. **Lagging rows.** Should rows behind the latest session be excluded or labelled?
6. **Recent IPOs.** Should names with fewer than 252 sessions count as "new 52-week highs"?
7. **Live tier.** Is it on in production? That decides whether "above the 20" may be described as live.

**Until these are answered**, the Agent keeps its existing behaviour:
- "strongest" ranks by RS Rank and refuses when the ranking is missing;
- every other vocabulary word reaches the model, which is told to use UCT's saved and starter screens and never to invent criteria.

Nothing new is switched on.
