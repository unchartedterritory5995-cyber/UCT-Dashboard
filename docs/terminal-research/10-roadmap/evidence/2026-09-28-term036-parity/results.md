# TERM-036 parity — yfinance vs Massive reference, run 2026-09-28

Command (repo root, MASSIVE_API_KEY from the engine's local .env, never printed):

    PYTHONPATH=. python tools/term036_corp_actions_parity.py --years 3

Exit 0 · **14 disagreements · 0 tickers not compared** (NVDA AAPL TSLA KO JNJ MO T, since 2023-09-28).
Raw output below, unreconciled, as the spec requires.

## Reading

| class | rows | cause | who is right |
|---|---|---|---|
| T 0.278 vs 0.2775 | 12 | yfinance rounds to 3 dp | **Massive** — AT&T declares $0.2775 |
| NVDA 0.004 vs 0.04 (2023-12, 2024-03) | 2 | yfinance is split-ADJUSTED (10:1 on 2024-06-10); Massive is AS-DECLARED | both, on different bases |

**Consequence of the NVDA class, per consumer:**
- `dividends_calendar` reads `gte=today` only ⇒ forward cards are unaffected.
- `earnings_estimates` chart D-markers read history ⇒ a pre-split dividend marker now labels the
  as-declared amount ($0.04), not the split-adjusted one on an adjusted price scale. ⚠️ Known,
  accepted-for-now display difference; open question whether markers should adjust by later splits.

Splits: 0 disagreements (NVDA 10:1, AAPL, TSLA agree).

⚠️ Instrument note: the tool as committed needs `PYTHONPATH=.` — without it every ticker reports
NOT COMPARED (exit 1), which is the honest failure mode, not a pass.

## Raw
```
TERM-036 parity since 2023-09-28: 14 disagreement(s), 0 ticker(s) not compared
  NVDA   dividends 2023-12-05  yfinance=       0.004  massive=        0.04
  NVDA   dividends 2024-03-05  yfinance=       0.004  massive=        0.04
  T      dividends 2023-10-06  yfinance=       0.278  massive=      0.2775
  T      dividends 2024-01-09  yfinance=       0.278  massive=      0.2775
  T      dividends 2024-04-09  yfinance=       0.278  massive=      0.2775
  T      dividends 2024-07-10  yfinance=       0.278  massive=      0.2775
  T      dividends 2024-10-10  yfinance=       0.278  massive=      0.2775
  T      dividends 2025-01-10  yfinance=       0.278  massive=      0.2775
  T      dividends 2025-04-10  yfinance=       0.278  massive=      0.2775
  T      dividends 2025-07-10  yfinance=       0.278  massive=      0.2775
  T      dividends 2025-10-10  yfinance=       0.278  massive=      0.2775
  T      dividends 2026-01-12  yfinance=       0.278  massive=      0.2775
  T      dividends 2026-04-10  yfinance=       0.278  massive=      0.2775
  T      dividends 2026-07-10  yfinance=       0.278  massive=      0.2775
```
