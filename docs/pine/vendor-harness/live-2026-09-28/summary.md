# Vendor harness — verdicts

Directories: `../../../../AppData/Local/uct-vendor-batch/runs/ext-2026-09-28/captures`

```
capture                                      symbol/tf        plots  verdict       first divergence / reason
-------------------------------------------- ---------------- ------ ------------- ----------------------------------------
artemis-oscillator-pro-rddt-1d-2026-09-28    NYSE:RDDT 1D     12     DIVERGE       VP Bull: bar 19 t=1713447000 na vendor=50 ours=na
    VP Bull                                  DIVERGE       cmp 632 ok 631 warm 0/0 steady 1/632 maxRel 8.15e-16 — 1 steady-state bars disagree; first at bar 19 (na: vendor 50 vs ours na) — scattered, last at bar 19
    VP Bear                                  DIVERGE       cmp 632 ok 631 warm 0/0 steady 1/632 maxRel 1.18e-15 — 1 steady-state bars disagree; first at bar 19 (na: vendor 40.08191730469555 vs ours na) — scattered, last at bar 19
    VP Base                                  DIVERGE       cmp 632 ok 0 warm 0/0 steady 632/632 maxRel 0.00e+0 — 632 steady-state bars disagree; first at bar 0 (color: vendor 50 vs ours 50) — persistent, last at bar 631
    DRM Oscillator                           MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 4.19e-15
    Signal Line                              MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 2.96e-15
    Bull Cross Dot                           MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 2.75e-15
    Bear Cross Dot                           MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.09e-15
    OB Level                                 MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    OS Level                                 MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Plot                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Plot                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Plot                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  DIVERGE       5 object families differ (count or text); coordinates are NOT compared by v1
dual-view-htf-candlestick-patterns-theultima NYSE:RDDT 1D     1      DIVERGE       1 of 2 compared items diverge
    HTF MA                                   INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    objects                                  DIVERGE       TradingView holds 436 drawing object(s) at the last bar and our script has no drawing program
elliott-wave-3-finder-v2-rddt-1d-2026-09-28  NYSE:RDDT 1D     1      MATCH         all 2 items agree
    Plot                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 2.63e-12
    objects                                  MATCH         neither side draws an object
ema-ribbon-trend-filter-strixedge-rddt-1d-20 NYSE:RDDT 1D     13     DIVERGE       1 of 14 compared items diverge
    Fast EMA                                 MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 3.66e-16
    Mid EMA                                  MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.02e-15
    Slow EMA                                 MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 9.49e-16
    F×M ▲                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    F×M ▼                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    F×S ▲                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    F×S ▼                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    M×S ▲                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    M×S ▼                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Squeeze Start                            MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 8.06e-16
    Squeeze Release ▲                        MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Squeeze Release ▼                        MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Squeeze Release ◆                        INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    objects                                  DIVERGE       2 object families differ (count or text); coordinates are NOT compared by v1
extrapolated-pivot-connector-rddt-1d-2026-09 NYSE:RDDT 1D     2      DIVERGE       1 of 3 compared items diverge
    Pivot High&#039;s                        INCONCLUSIVE   — UNMAPPED — no plot on our side is titled "Pivot High&#039;s"
    Pivot Low&#039;s                         INCONCLUSIVE   — UNMAPPED — no plot on our side is titled "Pivot Low&#039;s"
    objects                                  DIVERGE       TradingView holds 6 drawing object(s) at the last bar and our script has no drawing program
fibonacci-pivot-points-cc-rddt-1d-2026-09-28 NYSE:RDDT 1D     7      MATCH         all 8 items agree
    PP                                       MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    R1                                       MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    R2                                       MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    R3                                       MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    S1                                       MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    S2                                       MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    S3                                       MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; coordinates are NOT compared by v1
heat-map-seasons-rddt-1d-2026-09-28          NYSE:RDDT 1D     1      DIVERGE       1 of 2 compared items diverge
    Plot                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 3.16e-14
    objects                                  DIVERGE       3 object families differ (count or text); coordinates are NOT compared by v1
high-low-open-mid-ranges-rddt-1d-2026-09-28  NYSE:RDDT 1D     7      DIVERGE       1 of 8 compared items diverge
    plot_0                                   INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    plot_2                                   INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    plot_4                                   INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    plot_6                                   INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    plot_8                                   INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    plot_10                                  INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    plot_12                                  INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    objects                                  DIVERGE       5 object families differ (count or text); coordinates are NOT compared by v1
ict-killzones-pivots-tfo-rddt-1d-2026-09-28  NYSE:RDDT 1D     7      DIVERGE       1 of 8 compared items diverge
    Chars                                    INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    Chars                                    INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    Chars                                    INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    Chars                                    INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    Chars                                    INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    Chars                                    INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    Chars                                    INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    objects                                  DIVERGE       2 object families differ (count or text); coordinates are NOT compared by v1
inside-bar-range-mother-candle-breakoutbreak NYSE:RDDT 1D     2      DIVERGE       Shapes: bar 2 t=1711373400 na vendor=1 ours=na
    Shapes                                   DIVERGE       cmp 632 ok 590 warm 0/0 steady 42/632 maxRel 0.00e+0 — 42 steady-state bars disagree; first at bar 2 (na: vendor 1 vs ours na) — scattered, last at bar 626
    Shapes                                   DIVERGE       cmp 632 ok 598 warm 0/0 steady 34/632 maxRel 0.00e+0 — 34 steady-state bars disagree; first at bar 13 (na: vendor 1 vs ours na) — persistent, last at bar 631
    objects                                  MATCH         object counts and texts agree; coordinates are NOT compared by v1
institutional-smc-order-flow-matrix-pro-rddt NYSE:RDDT 1D     0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       4 object families differ (count or text); coordinates are NOT compared by v1
liquidation-levels-rddt-1d-2026-09-28        NYSE:RDDT 1D     11     DIVERGE       L1 Long: bar 0 t=1711027800 color vendor=42.45366666666666 ours=42.45366666666666
    L1 Long                                  DIVERGE       cmp 632 ok 0 warm 0/0 steady 632/632 maxRel 0.00e+0 — 632 steady-state bars disagree; first at bar 0 (color: vendor 42.45366666666666 vs ours 42.45366666666666) — persistent, last at bar 631
    L2 Long                                  DIVERGE       cmp 632 ok 0 warm 0/0 steady 632/632 maxRel 0.00e+0 — 632 steady-state bars disagree; first at bar 0 (color: vendor 46.083818181818174 vs ours 46.083818181818174) — persistent, last at bar 631
    L3 Long                                  DIVERGE       cmp 632 ok 0 warm 0/0 steady 632/632 maxRel 0.00e+0 — 632 steady-state bars disagree; first at bar 0 (color: vendor 48.15819047619048 vs ours 48.15819047619048) — persistent, last at bar 631
    L4 Long                                  DIVERGE       cmp 632 ok 0 warm 0/0 steady 632/632 maxRel 0.00e+0 — 632 steady-state bars disagree; first at bar 0 (color: vendor 49.500431372549016 vs ours 49.500431372549016) — persistent, last at bar 631
    L5 Long                                  DIVERGE       cmp 632 ok 0 warm 0/0 steady 632/632 maxRel 0.00e+0 — 632 steady-state bars disagree; first at bar 0 (color: vendor 49.96556435643564 vs ours 49.96556435643564) — persistent, last at bar 631
    L1 Short                                 DIVERGE       cmp 632 ok 0 warm 0/0 steady 632/632 maxRel 0.00e+0 — 632 steady-state bars disagree; first at bar 0 (color: vendor 62.4195 vs ours 62.4195) — persistent, last at bar 631
    L2 Short                                 DIVERGE       cmp 632 ok 0 warm 0/0 steady 632/632 maxRel 0.00e+0 — 632 steady-state bars disagree; first at bar 0 (color: vendor 55.76422222222222 vs ours 55.76422222222222) — persistent, last at bar 631
    L3 Short                                 DIVERGE       cmp 632 ok 0 warm 0/0 steady 632/632 maxRel 0.00e+0 — 632 steady-state bars disagree; first at bar 0 (color: vendor 52.962 vs ours 52.962) — persistent, last at bar 631
    L4 Short                                 DIVERGE       cmp 632 ok 0 warm 0/0 steady 632/632 maxRel 0.00e+0 — 632 steady-state bars disagree; first at bar 0 (color: vendor 51.41791836734693 vs ours 51.41791836734693) — persistent, last at bar 631
    L5 Short                                 DIVERGE       cmp 632 ok 0 warm 0/0 steady 632/632 maxRel 0.00e+0 — 632 steady-state bars disagree; first at bar 0 (color: vendor 50.9240202020202 vs ours 50.9240202020202) — persistent, last at bar 631
    plot_20                                  INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    objects                                  DIVERGE       TradingView holds 10 drawing object(s) at the last bar and our script has no drawing program
liquidity-engulfing-candles-upslidedown-rddt NYSE:RDDT 1D     3      MATCH         all 4 items agree
    Strategy Signal                          MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Shapes                                   MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Shapes                                   MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
liquidity-pools-rddt-1d-2026-09-28           NYSE:RDDT 1D     2      DIVERGE       Swing High: bar 44 t=1716471000 color vendor=66.15 ours=66.15
    Swing High                               DIVERGE       cmp 632 ok 586 warm 0/0 steady 46/632 maxRel 0.00e+0 — 46 steady-state bars disagree; first at bar 44 (color: vendor 66.15 vs ours 66.15) — scattered, last at bar 625
    Swing Low                                DIVERGE       cmp 632 ok 587 warm 0/0 steady 45/632 maxRel 0.00e+0 — 45 steady-state bars disagree; first at bar 11 (color: vendor 44 vs ours 44) — scattered, last at bar 623
    objects                                  DIVERGE       3 object families differ (count or text); coordinates are NOT compared by v1
madrid-moving-average-ribbon-rddt-1d-2026-09 NYSE:RDDT 1D     18     DIVERGE       MMA05: bar 4 t=1711546200 color vendor=55.82000000000001 ours=55.82000000000001
    MMA05                                    DIVERGE       cmp 632 ok 4 warm 0/0 steady 628/632 maxRel 4.49e-16 — 628 steady-state bars disagree; first at bar 4 (color: vendor 55.82000000000001 vs ours 55.82000000000001) — persistent, last at bar 631
    MMA10                                    DIVERGE       cmp 632 ok 9 warm 0/0 steady 623/632 maxRel 6.29e-16 — 623 steady-state bars disagree; first at bar 9 (color: vendor 51.761 vs ours 51.761) — persistent, last at bar 631
    MMA15                                    DIVERGE       cmp 632 ok 14 warm 0/0 steady 618/632 maxRel 3.87e-16 — 618 steady-state bars disagree; first at bar 14 (color: vendor 49.529333333333334 vs ours 49.529333333333334) — persistent, last at bar 631
    MMA20                                    DIVERGE       cmp 632 ok 19 warm 0/0 steady 613/632 maxRel 4.41e-16 — 613 steady-state bars disagree; first at bar 19 (color: vendor 47.362 vs ours 47.362) — persistent, last at bar 631
    MMA25                                    DIVERGE       cmp 632 ok 24 warm 0/0 steady 608/632 maxRel 1.39e-15 — 608 steady-state bars disagree; first at bar 24 (color: vendor 46.343199999999996 vs ours 46.3432) — persistent, last at bar 631
    MMA30                                    DIVERGE       cmp 632 ok 29 warm 0/0 steady 603/632 maxRel 1.57e-15 — 603 steady-state bars disagree; first at bar 29 (color: vendor 46.277 vs ours 46.277000000000015) — persistent, last at bar 631
    MMA35                                    DIVERGE       cmp 632 ok 34 warm 0/0 steady 598/632 maxRel 1.10e-15 — 598 steady-state bars disagree; first at bar 34 (color: vendor 46.68942857142857 vs ours 46.689428571428586) — persistent, last at bar 631
    MMA40                                    DIVERGE       cmp 632 ok 39 warm 0/0 steady 593/632 maxRel 1.47e-15 — 593 steady-state bars disagree; first at bar 39 (color: vendor 48.105000000000004 vs ours 48.10500000000002) — persistent, last at bar 631
    MMA45                                    DIVERGE       cmp 632 ok 44 warm 0/0 steady 588/632 maxRel 1.29e-15 — 588 steady-state bars disagree; first at bar 44 (color: vendor 49.28044444444444 vs ours 49.28044444444446) — persistent, last at bar 631
    MMA50                                    DIVERGE       cmp 632 ok 49 warm 0/0 steady 583/632 maxRel 1.26e-15 — 583 steady-state bars disagree; first at bar 49 (color: vendor 49.9802 vs ours 49.9802) — persistent, last at bar 631
    MMA55                                    DIVERGE       cmp 632 ok 54 warm 0/0 steady 578/632 maxRel 9.49e-16 — 578 steady-state bars disagree; first at bar 54 (color: vendor 50.77527272727273 vs ours 50.77527272727274) — persistent, last at bar 631
    MMA60                                    DIVERGE       cmp 632 ok 59 warm 0/0 steady 573/632 maxRel 1.99e-15 — 573 steady-state bars disagree; first at bar 59 (color: vendor 51.744166666666686 vs ours 51.744166666666686) — persistent, last at bar 631
    MMA65                                    INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    MMA70                                    INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    MMA75                                    INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    MMA80                                    INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    MMA85                                    INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    MMA90                                    INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    objects                                  MATCH         neither side draws an object
mcclellan-indicators-rddt-1d-2026-09-28      NYSE:RDDT 1D     13     DIVERGE       Osc: bar 38 t=1715779800 na vendor=122.44137512554066 ours=na
    Osc                                      DIVERGE       cmp 632 ok 38 warm 0/0 steady 594/632 maxRel 0.00e+0 — 594 steady-state bars disagree; first at bar 38 (na: vendor 122.44137512554066 vs ours na) — persistent, last at bar 631
    MSI                                      INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    MSI EMA                                  INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    MSI Cross Up                             INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    MSI Cross Down                           INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    MSI RSI                                  INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    RSI Hook Down                            INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    RSI Hook Up                              INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    MACD                                     INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    MACD Signal Line                         INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    MACD Histogram                           INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    MACD Cross Up                            INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    MACD Cross Down                          INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    objects                                  MATCH         neither side draws an object
momentum-volatility-scanner-rddt-1d-2026-09- NYSE:RDDT 1D     11     DIVERGE       1 of 12 compared items diverge
    Momentum Line                            INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    Momentum Area                            INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    Momentum Histogram                       MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 3.75e-13
    Vol Upper                                MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 7.16e-13
    Vol Lower                                MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 7.16e-13
    Bullish Shift                            MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bearish Shift                            MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Extreme Bull                             MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Extreme Bear                             MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bull Divergence                          MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bear Divergence                          MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  DIVERGE       2 object families differ (count or text); coordinates are NOT compared by v1
position-size-calculator-rddt-1d-2026-09-28  NYSE:RDDT 1D     3      DIVERGE       Entry: bar 0 t=1711027800 na vendor=0 ours=na
    Entry                                    DIVERGE       cmp 632 ok 612 warm 0/0 steady 20/632 maxRel 0.00e+0 — 20 steady-state bars disagree; first at bar 0 (na: vendor 0 vs ours na) — scattered, last at bar 19
    TP                                       DIVERGE       cmp 632 ok 612 warm 0/0 steady 20/632 maxRel 0.00e+0 — 20 steady-state bars disagree; first at bar 0 (na: vendor 0 vs ours na) — scattered, last at bar 19
    SL                                       DIVERGE       cmp 632 ok 612 warm 0/0 steady 20/632 maxRel 0.00e+0 — 20 steady-state bars disagree; first at bar 0 (na: vendor 0 vs ours na) — scattered, last at bar 19
    objects                                  DIVERGE       2 object families differ (count or text); coordinates are NOT compared by v1
price-action-as-in-book-fibonacci-supportres NYSE:RDDT 1D     2      DIVERGE       Pivot High: bar 45 t=1716557400 color vendor=66.15 ours=66.15
    Pivot High                               DIVERGE       cmp 632 ok 606 warm 0/0 steady 26/632 maxRel 0.00e+0 — 26 steady-state bars disagree; first at bar 45 (color: vendor 66.15 vs ours 66.15) — scattered, last at bar 626
    Pivot Low                                DIVERGE       cmp 632 ok 609 warm 0/0 steady 23/632 maxRel 0.00e+0 — 23 steady-state bars disagree; first at bar 24 (color: vendor 37.35 vs ours 37.35) — scattered, last at bar 619
    objects                                  MATCH         object counts and texts agree; coordinates are NOT compared by v1
reverse-stochastic-momentum-index-on-chart-r NYSE:RDDT 1D     7      DIVERGE       1 of 8 compared items diverge
    Scale High                               MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.47e-15
    High Alert                               MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.03e-14
    Low Alert                                MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 8.93e-14
    Scale Low                                MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    SMI EQ Price                             MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.75e-15
    Signal Line Cross                        MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 5.36e-15
    Zero Line Cross                          MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.46e-13
    objects                                  DIVERGE       TradingView holds 1 drawing object(s) at the last bar and our script has no drawing program
sector-rotation-rddt-1d-2026-09-28           NYSE:RDDT 1D     1      DIVERGE       1 of 2 compared items diverge
    Current Symbol Percentage Change         MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.95e-16
    objects                                  DIVERGE       1 object families differ (count or text); coordinates are NOT compared by v1
smt-divergence-ict-01-tradingfinder-smart-mo NYSE:RDDT 1D     0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       3 object families differ (count or text); coordinates are NOT compared by v1
trend-duration-forecast-chartprime-rddt-1d-2 NYSE:RDDT 1D     1      DIVERGE       1 of 2 compared items diverge
    HMA                                      MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  DIVERGE       5 object families differ (count or text); coordinates are NOT compared by v1
trend-lines-supports-and-resistances-rddt-1d NYSE:RDDT 1D     2      DIVERGE       1 of 3 compared items diverge
    High Pivots                              INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    Low Pivots                               INCONCLUSIVE  cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved
    objects                                  DIVERGE       TradingView holds 14 drawing object(s) at the last bar and our script has no drawing program
ultimate-pivot-points-rddt-1d-2026-09-28     NYSE:RDDT 1D     3      DIVERGE       PD_H: bar 475 t=1770906600 color vendor=152.44 ours=152.44
    PD_H                                     DIVERGE       cmp 632 ok 631 warm 0/0 steady 1/632 maxRel 0.00e+0 — 1 steady-state bars disagree; first at bar 475 (color: vendor 152.44 vs ours 152.44) — scattered, last at bar 475
    PD_L                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Pivot                                    DIVERGE       cmp 632 ok 631 warm 0/0 steady 1/632 maxRel 0.00e+0 — 1 steady-state bars disagree; first at bar 139 (color: vendor 71.33 vs ours 71.33) — scattered, last at bar 139
    objects                                  DIVERGE       3 object families differ (count or text); coordinates are NOT compared by v1

TOTAL 25 captures — MATCH 3 · DIVERGE 22 · INCONCLUSIVE 0
```

## Not comparable (0)

