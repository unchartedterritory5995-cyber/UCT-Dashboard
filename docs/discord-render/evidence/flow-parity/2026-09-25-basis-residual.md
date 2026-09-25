# Derivation-basis residual vs the page's full-history product (2026-09-25, production, after hours)

One session displayed (9/25). `=` exact, `~` same direction, `X` direction differs; number = gross premium basis/page.

| name | page (full) net | 1 | 5 | 20 | 60 | 90 | 120 | 180 |
|---|---|---|---|---|---|---|---|---|
| MSTR | BEAR 1,400,429/2,723,281 | X1.918 | X1.86 | ~1.474 | ~1.026 | =1.0 | =1.0 | =1.0 |
| CRWV | BULL 1,403,061/814,597 | ~1.576 | ~1.544 | ~1.485 | ~1.018 | ~1.018 | ~1.018 | =1.0 |
| RKLB | BULL 1,312,140/126,390 | ~1.347 | ~1.347 | ~1.315 | ~1.01 | ~1.01 | =1.0 | =1.0 |
| COIN | BEAR 750,916/1,120,136 | ~1.276 | ~1.261 | ~1.244 | =1.0 |  |  |  |
| GME | BULL 1,673,371/1,097,763 | ~1.099 | ~1.071 | ~1.018 | ~1.005 | =1.0 | =1.0 | =1.0 |
| BP | BULL 62,275/0 | =1.0 | =1.0 | =1.0 | =1.0 |  |  |  |
| APP | BULL 587,372/26,350 | ~1.02 | ~1.02 | ~1.02 | =1.0 |  |  |  |
| LLY | BEAR 0/244,050 | =1.0 | =1.0 | =1.0 | =1.0 |  |  |  |
| KO | BULL 15,408/0 | =1.0 | =1.0 | =1.0 | =1.0 |  |  |  |
| F | BULL 81,656/0 | =1.0 | =1.0 | =1.0 | =1.0 |  |  |  |
| IONQ | BULL 366,680/127,612 | =1.0 | =1.0 | =1.0 | =1.0 |  |  |  |
| XOM | BEAR 0/565,325 | =1.0 | =1.0 | =1.0 | =1.0 |  |  |  |
| JPM | BULL 648,595/118,400 | =1.0 | =1.0 | =1.0 | =1.0 |  |  |  |
| UNH | BULL 116,599/0 | =1.0 | =1.0 | =1.0 | =1.0 |  |  |  |

DELL, PLTR, ASTS, SOFI, HOOD: the page's own server product declined (budget), so no full reference;
the basis endpoint derives their whole history in 1.8-6.4 s. NVDA, TSLA, SPY, QQQ exceed 48 MB even at
60 sessions; their basis is picked by rows (NVDA 20, SPY 7, QQQ 9, AMD 37 sessions under 150K rows).
Scripts: scratchpad residual2.py / basis_sizes.py / probe_counts.py (this session).
