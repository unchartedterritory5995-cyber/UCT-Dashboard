# UCT RS vs Deepvue — fixture set 2 (Deepvue half), measured 2026-11-08

**Method.** 21 names (megacaps, leaders, laggards, one 2025 listing: NVDA AAPL MSFT AMZN META GOOGL TSLA AVGO PLTR AMD NFLX LLY JPM XOM COST INTC NKE PFE BA CRWD CRCL). Deepvue's own "DV - Relative Strength Line" indicator table (1M · 3M · 6M · 9M · 12M ranks, 1-99) read from the owner's Deepvue account in the browser on 2026-11-08 (last close 2026-11-06). Ours: production `rs_rating_history` for session 2026-11-06 (`ibd`, `fast`, `m1`, `m3`, `m6`, `m12`), read-only from the web pod. Raw values and the computation are in `2026-11-08-deepvue-parity.py`. MarketSurge was not measured (no subscription).

**Finding 1 — Deepvue's "12M" behaves as an IBD-style weighted rating, and ours orders stocks identically to it.** Our IBD-style rating vs Deepvue 12M: Spearman 1.00 on 21 names; MAE 7.9; within 10 points on 12 of 21.

**Finding 2 — the gap is a level offset that depends on strength, not disagreement.** Where Deepvue rates a stock 75+, ours is within ~1 point on average (AAPL 82/83, MSFT 79/81, XOM 80/82, AMD 92/92, LLY 89/89, CRWD 95/94, PFE 74/78). Below 75, ours reads ~11 points lower (NVDA 34/47, GOOGL 25/39, AVGO 17/31, BA 18/32). Cause: universe. Deepvue ranks against the whole US market (thousands of small, weak stocks below the median), we rank against UCT's ~3,400-name liquid universe excluding ETFs, so a lagging large cap sits higher in Deepvue's percentile than in ours. For the use the rating exists for (finding leaders at 80/90+) the two agree.

**Component ranks.** 1M: Spearman 1.00, ours 8 points lower on average (same universe effect), all 21 within 10. 6M: Spearman 0.94. 3M: 0.86. Our plain 12-month return rank (`m12`) vs Deepvue 12M: 0.79 — as expected, since Deepvue's 12M is the weighted rating, not a plain 12-month return rank.

**What we publish.** "Ranks stocks in the same order as Deepvue's RS rating; at 75 and above within about a point, lower ratings run about 11 points below because UCT ranks against a liquid universe rather than every listed stock." No target asserted; MarketSurge comparison still not measured.
