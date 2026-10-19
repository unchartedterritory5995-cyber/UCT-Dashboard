# Section A trading vocabulary — metric verification and the seven questions (2026-10-13)

**Status:**
- **Section A is NOT enabled** (owner, 2026-10-13: verification first).
- Section B numeric thresholds stay disabled.
- Nothing in Gate B or Gate C turns on a new vocabulary meaning. The only existing one stays as shipped: "strongest" ranks by RS Rank and refuses when ranks are missing.

**How it was verified:**
- Read-only, against the code and a local copy of the Screener data (`C:\data\screener.db`).
- Snapshot 2026-10-13, 3,665 rows; 90.7% of rows are as of the latest completed session.
- Counts, coverage and pass/fail only; no market values.

| Concept | Verdict | UCT definition (code) | Coverage (local copy) |
|---|---|---|---|
| strong / weak = rank by RS Rank | ⚠ Code verified; **production coverage unverified** | `rs_weighted_return.py:47-110`: weighted daily-close return (3 months ×0.40; 6 months, 1 month and 1 week ×0.20). `rs_ranking.py:214-226`: percentile 1–99 over $300M+ market cap plus the UCT20; nightly; ties not handled; no rank under 64 bars | **0 / 3,665 (0%)** |
| above / below an MA | ⚠ Verified, with an ambiguity | `technicals.py:524-537`: (close − MA)/MA × 100, daily, rounded 0.01; live overlay only when `SCREENER_LIVE_TIER_ENABLED` | `pct_vs_ema20` 98.9%, `pct_vs_sma20` 99.0%, `above_50sma` 98.9%; sign checks PASS |
| new 52-week high | ⚠ Verified, with a definition choice | `technicals.py:604-610`: intraday high ≥ the highest high of the last 252 sessions (ties count) | 99.9%; 110 flagged, 27 of them closed at the high |
| Basis | ✅ Verified | Nightly, from daily bars; each row as of its `bars_asof` | 342 rows (9.3%) lag ≥ 1 session |

## The seven questions — proposed defaults and what each would change
| # | Question | Owner direction / proposed default | What implementing it changes |
|---|---|---|---|
| 1 | Is RS Rank populated in production? | **Verify before enabling.** No authorized read-only diagnostic I can reach reports per-field coverage: every Screener route needs a paid session and `snapshot-status` reports only row freshness. **Owner check (free, instant):** in the admin Agent, "show me my strongest stocks". It either shows ranked rows, or says the ranking is unavailable or how many rows lack a rank. | If populated: strong/weak (sort only, no threshold) can be enabled. If not: the vocabulary stays off and RS Rank population becomes a Screener/data task. |
| 2 | "Above the 20": EMA20 or SMA20? | **EMA20** for an unspecified 20 (owner, 2026-10-13), unless the member or established context says SMA. The reply states "20-day EMA". | Maps to `pct_vs_ema20 > 0` / `< 0`. The same rule as the approved MA defaults, so a 20 means the same thing everywhere. |
| 3 | "Above the 200"? | **Not supported, and never claimed** (owner). `pct_vs_sma200` exists in the data but not in the Screener catalog. The Agent says the Screener has no 200-day filter, and may offer the 50 (`above_50sma`) only as an alternative the member chooses. | Real support needs the Screener team to add `pct_vs_sma50` / `pct_vs_sma200` to `FILTERS`. That is outside Agent scope. |
| 4 | New 52-week high: intraday or close? | **Intraday high by default** (owner), matching UCT's `new_52w_high`. Requests that name the close ("closing high", "closed at a new high") are distinguished: today there is **no catalog field** for a close-based high, so the Agent says so rather than substituting the intraday one. | The default maps to `new_52w_high = 1`, described as "intraday high at or above the prior 52-week (252-session) high, latest completed session". A close-based field would be a Screener addition. |
| 5 | Rows lagging the latest session? | **Proposed:** keep them, but label the result "data as of <latest session>; N names have older data". Never drop them silently. | Uses the existing `bars_asof` / `asOf`; presentation only. Needs owner OK. |
| 6 | IPOs with fewer than 252 sessions as "new 52-week highs"? | **Proposed:** keep UCT's definition (a since-listing high counts), and say so when such names appear. | Changing it would be a Screener definition change (Indicators/Screener owners), not an Agent mapping. |
| 7 | Is the live tier on in production? | **Proposed:** describe MA answers as "as of the latest completed session" unless the screen response says the live overlay applied. | Read from the response (`live` state on `snapshot-status`). No claim of "live" without it. |

**Next step after your answers:**
- Section A is implemented as data (concept → field + operator, no numeric thresholds other than the sign for above/below).
- The approved concepts get an **Assumptions** line in the reply.
- It ships behind the same gates as everything else.
