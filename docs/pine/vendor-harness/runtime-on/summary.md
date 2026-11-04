# Vendor harness — verdicts

Directories: `tests/fixtures/vendor/harness`

Lane: **runtime-on**. LANE MEASURED: runtime-on (gate OPEN, runtime lane reached 112, host refusals 112) · objects-only pane ARMED · runtime drew 35, declined 77

```
capture                                      symbol/tf        plots  verdict       first divergence / reason
-------------------------------------------- ---------------- ------ ------------- ----------------------------------------
adx-and-di-for-v4-rddt-1d-2026-09-27         NYSE:RDDT D      3      MATCH         all 4 items agree
    DI+                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    DI-                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    ADX                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 2.34e-15
    objects                                  MATCH         neither side draws an object
adx-and-di-for-v4-spy-1d-2026-10-03          AMEX:SPY 1D      3      MATCH         all 4 items agree
    DI+                                      MATCH         cmp 1800 ok 1221 warm 579/579 steady 0/1221 maxRel 0.00e+0
    DI-                                      MATCH         cmp 1800 ok 1221 warm 579/579 steady 0/1221 maxRel 0.00e+0
    ADX                                      MATCH         cmp 1800 ok 1221 warm 579/579 steady 0/1221 maxRel 2.55e-15
    objects                                  MATCH         neither side draws an object
all-chart-patterns-theeccentrictrader-spy-1d AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:module) [runtime declined: runtime:library]: importing another script pulls in code this engine never sees — the library `theEccentricTrader/PubLibSwing/3` is not in this engine's library registry, so its code cannot be compiled
artemis-oscillator-pro-rddt-1d-2026-09-28    NYSE:RDDT 1D     12     DIVERGE       1 of 14 compared items diverge
    VP Bull                                  MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 8.15e-16
    VP Bear                                  MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.18e-15
    VP Base                                  MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    DRM Oscillator                           MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 4.19e-15
    Signal Line                              MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 2.96e-15
    Bull Cross Dot                           MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 2.75e-15
    Bear Cross Dot                           MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.09e-15
    OB Level                                 MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    OS Level                                 MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Plot                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Plot                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Plot                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 88 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
artemis-oscillator-pro-spy-1d-2026-10-03     AMEX:SPY 1D      12     DIVERGE       DRM Oscillator: bar 29 t=1568727000 value vendor=84.50167017663489 ours=86.55383813483796
    VP Bull                                  MATCH         cmp 1800 ok 1780 warm 20/21 steady 0/1779 maxRel 1.51e-2
    VP Bear                                  MATCH         cmp 1800 ok 1781 warm 19/21 steady 0/1779 maxRel 1.85e-15
    VP Base                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    DRM Oscillator                           DIVERGE       cmp 1800 ok 1546 warm 29/29 steady 225/1771 maxRel 1.69e-1 — 225 steady-state bars disagree; first at bar 29 (value: vendor 84.50167017663489 vs ours 86.55383813483796) — a CONVERGING PREFIX: bars 29..253 differ with |err| falling 2.05e+0 → 9.56e-8, then all 1546 later bars agree (the recursive-state-seeded-at-the-window signature)
    Signal Line                              DIVERGE       cmp 1800 ok 1543 warm 36/36 steady 221/1764 maxRel 6.35e-2 — 221 steady-state bars disagree; first at bar 36 (value: vendor 79.49205372973621 vs ours 81.2856956274563) — a CONVERGING PREFIX: bars 36..256 differ with |err| falling 1.79e+0 → 9.56e-8, then all 1543 later bars agree (the recursive-state-seeded-at-the-window signature)
    Bull Cross Dot                           DIVERGE       cmp 1800 ok 1784 warm 3/37 steady 13/1763 maxRel 6.00e-2 — 13 steady-state bars disagree; first at bar 47 (value: vendor 54.11751285915002 vs ours 54.57613388997795) — scattered, last at bar 250
    Bear Cross Dot                           DIVERGE       cmp 1800 ok 1785 warm 3/37 steady 12/1763 maxRel 2.59e-2 — 12 steady-state bars disagree; first at bar 76 (value: vendor 92.09432360475196 vs ours 92.18600218411206) — scattered, last at bar 246
    OB Level                                 MATCH         cmp 1800 ok 1800 warm 0/129 steady 0/1671 maxRel 0.00e+0
    OS Level                                 MATCH         cmp 1800 ok 1800 warm 0/129 steady 0/1671 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  DIVERGE       5 object families differ (count or text); colours agree on 147 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
atr-bands-rddt-1d-2026-10-02                 NYSE:RDDT 1D     4      MATCH         all 5 items agree
    Upper ATR Band                           MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.21e-16
    Lower ATR Band                           MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.02e-16
    Upper Take-Profit Band                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Lower Take-Profit Band                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; no colour slot was paired, so no colour was graded; coordinates are NOT compared by v1
atr-bands-spy-1d-2026-10-03                  AMEX:SPY 1D      4      DIVERGE       Upper ATR Band: bar 3 t=1565357400 value vendor=304.8308920550607 ours=303.9227777777778
    Upper ATR Band                           DIVERGE       cmp 1800 ok 1760 warm 3/3 steady 37/1797 maxRel 4.42e-3 — 37 steady-state bars disagree; first at bar 3 (value: vendor 304.8308920550607 vs ours 303.9227777777778) — a CONVERGING PREFIX: bars 3..39 differ with |err| falling 9.08e-1 → 4.16e-7, then all 1760 later bars agree (the recursive-state-seeded-at-the-window signature)
    Lower ATR Band                           DIVERGE       cmp 1800 ok 1759 warm 3/3 steady 38/1797 maxRel 4.89e-3 — 38 steady-state bars disagree; first at bar 3 (value: vendor 278.4091079449393 vs ours 279.3172222222222) — a CONVERGING PREFIX: bars 3..40 differ with |err| falling 9.08e-1 → 2.77e-7, then all 1759 later bars agree (the recursive-state-seeded-at-the-window signature)
    Upper Take-Profit Band                   MATCH         cmp 1800 ok 1800 warm 0/3 steady 0/1797 maxRel 0.00e+0
    Lower Take-Profit Band                   MATCH         cmp 1800 ok 1800 warm 0/3 steady 0/1797 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; no colour slot was paired, so no colour was graded; coordinates are NOT compared by v1
atr-stepped-pdf-ma-loxx-rddt-1d-2026-10-03   NYSE:RDDT 1D     3      INCONCLUSIVE  2 of 5 items could not be compared
    ATR-Stepped, PDF MA                      MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.67e-16
    Long                                     INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    Short                                    INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         1 paint agree bar for bar
atr-support-and-resistance-rddt-1d-2026-09-2 NYSE:RDDT 1D     9      DIVERGE       1 of 11 compared items diverge
    Impulse Up                               MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Impulse Down                             MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    RSI Mid Line Support                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    RSI Mid Line Resistance                  MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    RSI Overbought                           MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    RSI Oversold                             MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Ran Previous High                        MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Ran Previous Low                         MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Moving Average                           MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  DIVERGE       2 object families differ (count or text); no colour slot was paired, so no colour was graded; coordinates are NOT compared by v1
    paints                                   MATCH         4 paints agree bar for bar
atr-support-and-resistance-spy-1d-2026-10-03 AMEX:SPY 1D      9      DIVERGE       RSI Mid Line Support: bar 15 t=1566912600 na vendor=na ours=1
    Impulse Up                               MATCH         cmp 1800 ok 1800 warm 0/15 steady 0/1785 maxRel 0.00e+0
    Impulse Down                             MATCH         cmp 1800 ok 1799 warm 1/15 steady 0/1785 maxRel 0.00e+0
    RSI Mid Line Support                     DIVERGE       cmp 1800 ok 1794 warm 2/15 steady 4/1785 maxRel 0.00e+0 — 4 steady-state bars disagree; first at bar 15 (na: vendor na vs ours 1) — scattered, last at bar 37
    RSI Mid Line Resistance                  DIVERGE       cmp 1800 ok 1794 warm 3/15 steady 3/1785 maxRel 0.00e+0 — 3 steady-state bars disagree; first at bar 16 (na: vendor na vs ours 1) — scattered, last at bar 38
    RSI Overbought                           MATCH         cmp 1800 ok 1800 warm 0/15 steady 0/1785 maxRel 0.00e+0
    RSI Oversold                             MATCH         cmp 1800 ok 1800 warm 0/15 steady 0/1785 maxRel 0.00e+0
    Ran Previous High                        MATCH         cmp 1800 ok 1800 warm 0/21 steady 0/1779 maxRel 0.00e+0
    Ran Previous Low                         MATCH         cmp 1800 ok 1799 warm 1/21 steady 0/1779 maxRel 0.00e+0
    Moving Average                           MATCH         cmp 1800 ok 1800 warm 0/200 steady 0/1600 maxRel 0.00e+0
    objects                                  DIVERGE       2 object families differ (count or text); no colour slot was paired, so no colour was graded; coordinates are NOT compared by v1
    paints                                   MATCH         4 paints agree bar for bar
atr-trailing-stop-by-ceyhun-rddt-1d-2026-10- NYSE:RDDT 1D     4      DIVERGE       1 of 6 compared items diverge
    Fast Trail                               MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.17e-16
    Slow Trail                               MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.66e-16
    BUY                                      MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    SELL                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 1 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 4 drawing steps (dropped: create:label ×2; pine:function)
    paints                                   MATCH         1 paint agree bar for bar
atr-trailing-stop-by-ceyhun-spy-1d-2026-10-0 AMEX:SPY 1D      4      DIVERGE       Slow Trail: bar 522 t=1630416600 na vendor=442.29385407918437 ours=na
    Fast Trail                               MATCH         cmp 1800 ok 1745 warm 55/255 steady 0/1545 maxRel 5.97e-5
    Slow Trail                               DIVERGE       cmp 1800 ok 694 warm 157/260 steady 949/1540 maxRel 5.39e-9 — 949 steady-state bars disagree; first at bar 522 (na: vendor 442.29385407918437 vs ours na) — scattered, last at bar 1719
    BUY                                      DIVERGE       cmp 1800 ok 1782 warm 4/261 steady 14/1539 maxRel 0.00e+0 — 14 steady-state bars disagree; first at bar 554 (na: vendor 1 vs ours na) — scattered, last at bar 1676
    SELL                                     DIVERGE       cmp 1800 ok 1780 warm 4/261 steady 16/1539 maxRel 0.00e+0 — 16 steady-state bars disagree; first at bar 531 (na: vendor 1 vs ours na) — scattered, last at bar 1717
    objects                                  DIVERGE       TradingView holds 1 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 4 drawing steps (dropped: create:label ×2; pine:function)
    paints                                   MATCH         1 paint agree bar for bar
atr-trailing-stoploss-rddt-1d-2026-09-27     NYSE:RDDT D      3      MATCH         all 5 items agree
    ATR Trailing Stoploss                    MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 2.80e-16
    BUY                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    SELL                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         1 paint agree bar for bar
atr-trailing-stoploss-spy-1d-2026-10-03      AMEX:SPY 1D      3      DIVERGE       ATR Trailing Stoploss: bar 15 t=1566912600 value vendor=283.7527150558059 ours=283.7708506752
    ATR Trailing Stoploss                    DIVERGE       cmp 1800 ok 1738 warm 15/15 steady 47/1785 maxRel 4.12e-2 — 47 steady-state bars disagree; first at bar 15 (value: vendor 283.7527150558059 vs ours 283.7708506752) — a CONVERGING PREFIX: bars 15..61 differ with |err| falling 1.81e-2 → 4.04e-7, then all 1738 later bars agree (the recursive-state-seeded-at-the-window signature)
    BUY                                      MATCH         cmp 1800 ok 1798 warm 2/16 steady 0/1784 maxRel 0.00e+0
    SELL                                     MATCH         cmp 1800 ok 1800 warm 0/16 steady 0/1784 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         1 paint agree bar for bar
auto-trendline-dojiemoji-rddt-1d-2026-10-02  NYSE:RDDT 1D     6      DIVERGE       1 of 7 compared items diverge
    HH                                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    LH                                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    LL                                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    HL                                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Crossed upper trendline                  MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Crossed lower trendline                  MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (line.delete)
auto-trendline-dojiemoji-spy-1d-2026-10-03   AMEX:SPY 1D      6      DIVERGE       1 of 7 compared items diverge
    HH                                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    LH                                       MATCH         cmp 1800 ok 1799 warm 1/522 steady 0/1278 maxRel 0.00e+0
    LL                                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    HL                                       MATCH         cmp 1800 ok 1794 warm 6/522 steady 0/1278 maxRel 0.00e+0
    Crossed upper trendline                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Crossed lower trendline                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (line.delete)
average-day-range-adr-pivots-rddt-1d-2026-09 NYSE:RDDT 1D     7      MATCH         all 8 items agree
    ADR 1 Resistance                         MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    ADR 1 Support                            MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    ADR 2 Resistance                         MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    ADR 2 Support                            MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MA 1                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MA 2                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MA 3                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 16 paired slots; coordinates are NOT compared by v1
average-day-range-adr-pivots-spy-1d-2026-10- AMEX:SPY 1D      7      MATCH         all 8 items agree
    ADR 1 Resistance                         MATCH         cmp 1800 ok 1800 warm 0/16 steady 0/1784 maxRel 0.00e+0
    ADR 1 Support                            MATCH         cmp 1800 ok 1800 warm 0/16 steady 0/1784 maxRel 0.00e+0
    ADR 2 Resistance                         MATCH         cmp 1800 ok 1800 warm 0/9 steady 0/1791 maxRel 0.00e+0
    ADR 2 Support                            MATCH         cmp 1800 ok 1800 warm 0/9 steady 0/1791 maxRel 0.00e+0
    MA 1                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MA 2                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MA 3                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 16 paired slots; coordinates are NOT compared by v1
black-scholes-option-pricing-model-w-greeks- AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:module) [runtime declined: runtime:library]: importing another script pulls in code this engine never sees — the library `loxx/loxxexpandedsourcetypes/4` is not in this engine's library registry, so its code cannot be compiled
btc-charlie-trader-xo-macro-trend-scanner-rd NYSE:RDDT 1D     5      MATCH         all 7 items agree
    Consolidated EMA                         MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    Fast EMA                                 MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 5.52e-16
    Slow EMA                                 MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 1.39e-15
    Bull                                     MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    Bear                                     MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         4 paints agree bar for bar; 4 paints neither side draws not graded (plot_14, plot_15, plot_16, plot_17)
btc-charlie-trader-xo-macro-trend-scanner-sp AMEX:SPY 1D      5      DIVERGE       Fast EMA: bar 12 t=1566480600 value vendor=290.8712121306582 ours=289.93294871794865
    Consolidated EMA                         MATCH         cmp 1800 ok 1800 warm 0/25 steady 0/1775 maxRel 0.00e+0
    Fast EMA                                 DIVERGE       cmp 1800 ok 1698 warm 12/12 steady 90/1788 maxRel 3.82e-3 — 90 steady-state bars disagree; first at bar 12 (value: vendor 290.8712121306582 vs ours 289.93294871794865) — a CONVERGING PREFIX: bars 12..101 differ with |err| falling 9.38e-1 → 3.28e-7, then all 1698 later bars agree (the recursive-state-seeded-at-the-window signature)
    Slow EMA                                 DIVERGE       cmp 1800 ok 1579 warm 25/25 steady 196/1775 maxRel 6.94e-3 — 196 steady-state bars disagree; first at bar 25 (value: vendor 293.6599313459245 vs ours 291.78095384615386) — a CONVERGING PREFIX: bars 25..220 differ with |err| falling 1.88e+0 → 3.13e-7, then all 1579 later bars agree (the recursive-state-seeded-at-the-window signature)
    Bull                                     MATCH         cmp 1800 ok 1797 warm 3/275 steady 0/1525 maxRel 0.00e+0
    Bear                                     MATCH         cmp 1800 ok 1798 warm 2/275 steady 0/1525 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         4 paints agree bar for bar; 4 paints neither side draws not graded (plot_14, plot_15, plot_16, plot_17)
candlestick-patterns-identified-update-1-17- NYSE:RDDT 1D     15     MATCH         all 16 items agree
    Doji                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bearish Harami                           MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bullish Harami                           MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bearish Engulfing                        MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bullish Engulfing                        MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Piercing Line                            MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bullish Belt                             MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bullish Kicker                           MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bearish Kicker                           MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Hanging Man                              MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Evening Star                             MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Morning Star                             MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Shooting Star                            MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Hammer                                   MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Inverted Hammer                          MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
candlestick-patterns-identified-update-1-17- AMEX:SPY 1D      15     MATCH         all 16 items agree
    Doji                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bearish Harami                           MATCH         cmp 1800 ok 1800 warm 0/5 steady 0/1795 maxRel 0.00e+0
    Bullish Harami                           MATCH         cmp 1800 ok 1799 warm 1/5 steady 0/1795 maxRel 0.00e+0
    Bearish Engulfing                        MATCH         cmp 1800 ok 1800 warm 0/5 steady 0/1795 maxRel 0.00e+0
    Bullish Engulfing                        MATCH         cmp 1800 ok 1800 warm 0/5 steady 0/1795 maxRel 0.00e+0
    Piercing Line                            MATCH         cmp 1800 ok 1800 warm 0/5 steady 0/1795 maxRel 0.00e+0
    Bullish Belt                             MATCH         cmp 1800 ok 1800 warm 0/11 steady 0/1789 maxRel 0.00e+0
    Bullish Kicker                           MATCH         cmp 1800 ok 1800 warm 0/5 steady 0/1795 maxRel 0.00e+0
    Bearish Kicker                           MATCH         cmp 1800 ok 1800 warm 0/5 steady 0/1795 maxRel 0.00e+0
    Hanging Man                              MATCH         cmp 1800 ok 1800 warm 0/5 steady 0/1795 maxRel 0.00e+0
    Evening Star                             MATCH         cmp 1800 ok 1800 warm 0/2 steady 0/1798 maxRel 0.00e+0
    Morning Star                             MATCH         cmp 1800 ok 1800 warm 0/2 steady 0/1798 maxRel 0.00e+0
    Shooting Star                            MATCH         cmp 1800 ok 1800 warm 0/1 steady 0/1799 maxRel 0.00e+0
    Hammer                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Inverted Hammer                          MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
cc-yata-rddt-1d-2026-09-27                   NYSE:RDDT D      54     INCONCLUSIVE  10 of 55 items could not be compared
    b9                                       INCONCLUSIVE   — UNMAPPED — vendor title "b9" is not unique in the study
    s9                                       INCONCLUSIVE   — UNMAPPED — vendor title "s9" is not unique in the study
    b9                                       INCONCLUSIVE   — UNMAPPED — vendor title "b9" is not unique in the study
    s9                                       INCONCLUSIVE   — UNMAPPED — vendor title "s9" is not unique in the study
    +                                        INCONCLUSIVE   — UNMAPPED — vendor title "+" is not unique in the study
    os13                                     INCONCLUSIVE   — UNMAPPED — vendor title "os13" is not unique in the study
    oa13                                     INCONCLUSIVE   — UNMAPPED — vendor title "oa13" is not unique in the study
    +                                        INCONCLUSIVE   — UNMAPPED — vendor title "+" is not unique in the study
    os13                                     INCONCLUSIVE   — UNMAPPED — vendor title "os13" is not unique in the study
    oa13                                     INCONCLUSIVE   — UNMAPPED — vendor title "oa13" is not unique in the study
    b1                                       MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    b2                                       MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    b3                                       MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    b4                                       MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    b5                                       MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    b6                                       MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    b7                                       MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    b8                                       MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    s1                                       MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    s2                                       MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    s3                                       MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    s4                                       MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    s5                                       MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    s6                                       MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    s7                                       MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    s8                                       MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Support                                  MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Resistance                               MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    sc1                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    sc2                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    sc3                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    sc4                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    sc5                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    sc6                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    sc7                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    sc8                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    sc9                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    sc10                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    sc11                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    sc12                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    sc13                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    bc1                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    bc2                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    bc3                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    bc4                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    bc5                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    bc6                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    bc7                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    bc8                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    bc9                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    bc10                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    bc11                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    bc12                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    bc13                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
cdc-btc-rainbow-road-spy-1d-2026-10-02       AMEX:SPY 1D      13     MATCH         all 14 items agree
    Lower Channel                            MATCH         cmp 1800 ok 1071 warm 729/730 steady 0/1070 maxRel 2.37e-15
    Upper Channel                            MATCH         cmp 1800 ok 1071 warm 729/730 steady 0/1070 maxRel 2.37e-15
    Plot                                     MATCH         cmp 1800 ok 1071 warm 729/730 steady 0/1070 maxRel 2.37e-15
    Plot                                     MATCH         cmp 1800 ok 1071 warm 729/730 steady 0/1070 maxRel 2.46e-15
    Plot                                     MATCH         cmp 1800 ok 1071 warm 729/730 steady 0/1070 maxRel 2.48e-15
    Plot                                     MATCH         cmp 1800 ok 1071 warm 729/730 steady 0/1070 maxRel 2.54e-15
    Plot                                     MATCH         cmp 1800 ok 1071 warm 729/730 steady 0/1070 maxRel 2.43e-15
    Plot                                     MATCH         cmp 1800 ok 1071 warm 729/730 steady 0/1070 maxRel 2.48e-15
    Plot                                     MATCH         cmp 1800 ok 1071 warm 729/730 steady 0/1070 maxRel 2.27e-15
    Plot                                     MATCH         cmp 1800 ok 1071 warm 729/730 steady 0/1070 maxRel 2.50e-15
    Plot                                     MATCH         cmp 1800 ok 1071 warm 729/730 steady 0/1070 maxRel 2.47e-15
    Plot                                     MATCH         cmp 1800 ok 1071 warm 729/730 steady 0/1070 maxRel 2.69e-15
    Plot                                     MATCH         cmp 1800 ok 1071 warm 729/730 steady 0/1070 maxRel 2.24e-15
    objects                                  MATCH         neither side draws an object
contraction-box-doji-lines-rddt-1d-2026-09-2 NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 82 paired slots; 96 slots on objects neither side draws not graded; coordinates are NOT compared by v1
contraction-box-doji-lines-spy-1d-2026-10-03 AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 182 paired slots; 102 slots on objects neither side draws not graded; coordinates are NOT compared by v1
cpr-with-mas-super-trend-vwap-by-guruprasadm NYSE:RDDT 1D     29     MATCH         all 30 items agree
    CP                                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    BC                                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    TC                                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    D-S1                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    D-S2                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    D-S3                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    D-R1                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    D-R2                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    D-R3                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    W-P                                      MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    W-S1                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    W-S2                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    W-S3                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    W-R1                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    W-R2                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    W-R3                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
     M-P                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    M-S1                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    M-S2                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    M-S3                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    M-R1                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    M-R2                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    M-R3                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    SMA                                      MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.75e-15
    EMA                                      MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.27e-15
    VWAP                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.96e-16
    SuperTrend                               MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.71e-16
    Up Arrow                                 MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Down Arrow                               MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
cpr-with-mas-super-trend-vwap-by-guruprasadm AMEX:SPY 1D      29     DIVERGE       EMA: bar 50 t=1571232600 value vendor=294.6560882897784 ours=293.88854117647065
    CP                                       MATCH         cmp 1800 ok 1799 warm 1/1 steady 0/1799 maxRel 0.00e+0
    BC                                       MATCH         cmp 1800 ok 1799 warm 1/1 steady 0/1799 maxRel 0.00e+0
    TC                                       MATCH         cmp 1800 ok 1799 warm 1/1 steady 0/1799 maxRel 0.00e+0
    D-S1                                     MATCH         cmp 1800 ok 1799 warm 1/1 steady 0/1799 maxRel 0.00e+0
    D-S2                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D-S3                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D-R1                                     MATCH         cmp 1800 ok 1799 warm 1/1 steady 0/1799 maxRel 0.00e+0
    D-R2                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D-R3                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    W-P                                      MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    W-S1                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    W-S2                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    W-S3                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    W-R1                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    W-R2                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    W-R3                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
     M-P                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    M-S1                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    M-S2                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    M-S3                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    M-R1                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    M-R2                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    M-R3                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    SMA                                      MATCH         cmp 1800 ok 1751 warm 49/50 steady 0/1750 maxRel 2.06e-15
    EMA                                      DIVERGE       cmp 1800 ok 1387 warm 50/50 steady 363/1750 maxRel 2.71e-3 — 363 steady-state bars disagree; first at bar 50 (value: vendor 294.6560882897784 vs ours 293.88854117647065) — a CONVERGING PREFIX: bars 50..412 differ with |err| falling 7.68e-1 → 3.94e-7, then all 1387 later bars agree (the recursive-state-seeded-at-the-window signature)
    VWAP                                     MATCH         cmp 1800 ok 1800 warm 0/960 steady 0/840 maxRel 1.98e-16
    SuperTrend                               MATCH         cmp 1800 ok 1509 warm 291/511 steady 0/1289 maxRel 8.28e-16
    Up Arrow                                 MATCH         cmp 1800 ok 1794 warm 6/512 steady 0/1288 maxRel 0.00e+0
    Down Arrow                               MATCH         cmp 1800 ok 1794 warm 6/512 steady 0/1288 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
cumulative-volume-delta-rddt-1d-2026-09-27   NYSE:RDDT D      4      MATCH         all 5 items agree
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 7.58e-16
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 8.08e-16
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 9.92e-16
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 6.55e-13
    objects                                  MATCH         neither side draws an object
cumulative-volume-delta-spy-1d-2026-10-03    AMEX:SPY 1D      4      DIVERGE       Plot: bar 14 t=1566826200 value vendor=36062522.09569172 ours=46187462.99823189
    Plot                                     DIVERGE       cmp 1800 ok 1656 warm 14/14 steady 130/1786 maxRel 3.40e-1 — 130 steady-state bars disagree; first at bar 14 (value: vendor 36062522.09569172 vs ours 46187462.99823189) — a CONVERGING PREFIX: bars 14..143 differ with |err| falling 1.01e+7 → 9.73e-2, then all 1656 later bars agree (the recursive-state-seeded-at-the-window signature)
    Plot                                     DIVERGE       cmp 1800 ok 1659 warm 14/14 steady 127/1786 maxRel 1.33e-1 — 127 steady-state bars disagree; first at bar 14 (value: vendor 48959168.06487557 vs ours 42888101.85414907) — a CONVERGING PREFIX: bars 14..140 differ with |err| falling 6.07e+6 → 8.97e-2, then all 1659 later bars agree (the recursive-state-seeded-at-the-window signature)
    Plot                                     DIVERGE       cmp 1800 ok 1643 warm 28/28 steady 129/1772 maxRel 3.29e-2 — 129 steady-state bars disagree; first at bar 28 (value: vendor 37873949.373707816 vs ours 39115138.34741836) — a CONVERGING PREFIX: bars 28..156 differ with |err| falling 1.24e+6 → 1.43e-1, then all 1643 later bars agree (the recursive-state-seeded-at-the-window signature)
    Plot                                     DIVERGE       cmp 1800 ok 1638 warm 14/14 steady 148/1786 maxRel 4.48e+0 — 148 steady-state bars disagree; first at bar 14 (value: vendor -12896645.969183855 vs ours 3299361.1440828145) — a CONVERGING PREFIX: bars 14..184 (with agreeing bars inside the run) differ with |err| falling 1.62e+7 → 4.41e-4, then all 1615 later bars agree (the recursive-state-seeded-at-the-window signature)
    objects                                  MATCH         neither side draws an object
deadband-hysteresis-filter-backquant-rddt-1d NYSE:RDDT 1D     1      MATCH         all 3 items agree
    DBHF                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.15e-16
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         1 paint agree bar for bar
delta-rsi-oscillator-strategy-rddt-1d-2026-1 NYSE:RDDT 1D     4      MATCH         all 5 items agree
    Buy                                      MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Sell                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Exit Long                                MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Exit Short                               MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
delta-rsi-oscillator-strategy-spy-1d-2026-10 AMEX:SPY 1D      4      INCONCLUSIVE  4 of 5 items could not be compared
    Buy                                      INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for value
    Sell                                     INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2
    Exit Long                                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3
    Exit Short                               INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4
    objects                                  MATCH         neither side draws an object
donchian-channels-rddt-1d-2026-09-28         NYSE:RDDT 1D     13     MATCH         all 14 items agree
    Basis                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Upper Donchian                           MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Upper Donchian | Inner                   MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Upper .786                               MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Upper Mid                                MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Upper.702                                MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Upper .382                               MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Lower .382                               MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Lower .702                               MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Lower Mid                                MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Lower .786                               MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Lower Donchian | Inner                   MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Lower Donchian                           MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
donchian-channels-spy-1d-2026-10-03          AMEX:SPY 1D      13     MATCH         all 14 items agree
    Basis                                    MATCH         cmp 1800 ok 1701 warm 99/101 steady 0/1699 maxRel 0.00e+0
    Upper Donchian                           MATCH         cmp 1800 ok 1701 warm 99/100 steady 0/1700 maxRel 0.00e+0
    Upper Donchian | Inner                   MATCH         cmp 1800 ok 1701 warm 99/101 steady 0/1699 maxRel 0.00e+0
    Upper .786                               MATCH         cmp 1800 ok 1800 warm 0/101 steady 0/1699 maxRel 0.00e+0
    Upper Mid                                MATCH         cmp 1800 ok 1701 warm 99/101 steady 0/1699 maxRel 0.00e+0
    Upper.702                                MATCH         cmp 1800 ok 1701 warm 99/101 steady 0/1699 maxRel 0.00e+0
    Upper .382                               MATCH         cmp 1800 ok 1800 warm 0/101 steady 0/1699 maxRel 0.00e+0
    Lower .382                               MATCH         cmp 1800 ok 1800 warm 0/101 steady 0/1699 maxRel 0.00e+0
    Lower .702                               MATCH         cmp 1800 ok 1701 warm 99/101 steady 0/1699 maxRel 0.00e+0
    Lower Mid                                MATCH         cmp 1800 ok 1701 warm 99/101 steady 0/1699 maxRel 0.00e+0
    Lower .786                               MATCH         cmp 1800 ok 1800 warm 0/101 steady 0/1699 maxRel 0.00e+0
    Lower Donchian | Inner                   MATCH         cmp 1800 ok 1701 warm 99/101 steady 0/1699 maxRel 0.00e+0
    Lower Donchian                           MATCH         cmp 1800 ok 1701 warm 99/100 steady 0/1700 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
dual-view-htf-candlestick-patterns-theultima NYSE:RDDT 1D     1      DIVERGE       1 of 2 compared items diverge
    HTF MA                                   MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 436 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (coll:diverged, guard:copy, guard:delete, guard:loop, loop:bounds)
dual-view-htf-candlestick-patterns-theultima AMEX:SPY 1D      1      DIVERGE       1 of 2 compared items diverge
    HTF MA                                   MATCH         cmp 1800 ok 1800 warm 0/12 steady 0/1788 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 272 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (coll:diverged, guard:copy, guard:delete, guard:loop, loop:bounds)
elliott-wave-3-finder-v2-rddt-1d-2026-09-28  NYSE:RDDT 1D     1      MATCH         all 3 items agree
    Plot                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 2.63e-12
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         2 paints agree bar for bar
elliott-wave-3-finder-v2-spy-1d-2026-10-03   AMEX:SPY 1D      1      DIVERGE       Plot: bar 35 t=1569418200 value vendor=2.0651745257055154 ours=4.193839773347918
    Plot                                     DIVERGE       cmp 1800 ok 1429 warm 35/35 steady 336/1765 maxRel 8.80e+0 — 336 steady-state bars disagree; first at bar 35 (value: vendor 2.0651745257055154 vs ours 4.193839773347918) — a CONVERGING PREFIX: bars 35..370 differ with |err| falling 2.13e+0 → 1.03e-8, then all 1429 later bars agree (the recursive-state-seeded-at-the-window signature)
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         2 paints agree bar for bar
ema-ribbon-trend-filter-strixedge-rddt-1d-20 NYSE:RDDT 1D     13     DIVERGE       1 of 15 compared items diverge
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
    Squeeze Release ◆                        MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 4.87e-16
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 73 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         2 paints agree bar for bar
ema-ribbon-trend-filter-strixedge-spy-1d-202 AMEX:SPY 1D      13     DIVERGE       Fast EMA: bar 8 t=1565962200 value vendor=288.6964448015961 ours=288.7897222222222
    Fast EMA                                 DIVERGE       cmp 1800 ok 1741 warm 8/8 steady 51/1792 maxRel 4.15e-4 — 51 steady-state bars disagree; first at bar 8 (value: vendor 288.6964448015961 vs ours 288.7897222222222) — a CONVERGING PREFIX: bars 8..58 differ with |err| falling 9.33e-2 → 3.26e-7, then all 1741 later bars agree (the recursive-state-seeded-at-the-window signature)
    Mid EMA                                  DIVERGE       cmp 1800 ok 1618 warm 21/21 steady 161/1779 maxRel 4.45e-3 — 161 steady-state bars disagree; first at bar 21 (value: vendor 291.65670369127855 vs ours 290.48060606060596) — a CONVERGING PREFIX: bars 21..181 differ with |err| falling 1.18e+0 → 2.80e-7, then all 1618 later bars agree (the recursive-state-seeded-at-the-window signature)
    Slow EMA                                 DIVERGE       cmp 1800 ok 1343 warm 55/55 steady 402/1745 maxRel 3.20e-3 — 402 steady-state bars disagree; first at bar 55 (value: vendor 295.292411734689 vs ours 294.3830454545455) — a CONVERGING PREFIX: bars 55..456 differ with |err| falling 9.09e-1 → 4.22e-7, then all 1343 later bars agree (the recursive-state-seeded-at-the-window signature)
    F×M ▲                                    MATCH         cmp 1800 ok 1799 warm 1/22 steady 0/1778 maxRel 0.00e+0
    F×M ▼                                    DIVERGE       cmp 1800 ok 1798 warm 0/22 steady 2/1778 maxRel 0.00e+0 — 2 steady-state bars disagree; first at bar 39 (na: vendor 298.455 vs ours na) — scattered, last at bar 40
    F×S ▲                                    MATCH         cmp 1800 ok 1798 warm 2/56 steady 0/1744 maxRel 0.00e+0
    F×S ▼                                    MATCH         cmp 1800 ok 1798 warm 2/56 steady 0/1744 maxRel 0.00e+0
    M×S ▲                                    MATCH         cmp 1800 ok 1799 warm 1/56 steady 0/1744 maxRel 0.00e+0
    M×S ▼                                    MATCH         cmp 1800 ok 1799 warm 1/56 steady 0/1744 maxRel 0.00e+0
    Squeeze Start                            DIVERGE       cmp 1800 ok 1793 warm 5/106 steady 2/1694 maxRel 4.25e-8 — 2 steady-state bars disagree; first at bar 140 (value: vendor 328.3724333221276 vs ours 328.37241936764167) — scattered, last at bar 176
    Squeeze Release ▲                        MATCH         cmp 1800 ok 1798 warm 2/106 steady 0/1694 maxRel 0.00e+0
    Squeeze Release ▼                        MATCH         cmp 1800 ok 1799 warm 1/106 steady 0/1694 maxRel 0.00e+0
    Squeeze Release ◆                        DIVERGE       cmp 1800 ok 1796 warm 3/106 steady 1/1694 maxRel 3.90e-8 — 1 steady-state bars disagree; first at bar 141 (value: vendor 325.5667575655706 vs ours 325.5667448796743) — scattered, last at bar 141
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 73 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         2 paints agree bar for bar
engulfingcandle-rddt-1d-2026-09-27           NYSE:RDDT D      2      MATCH         all 3 items agree
    bullish                                  MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    bearish                                  MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
engulfingcandle-spy-1d-2026-10-03            AMEX:SPY 1D      2      MATCH         all 3 items agree
    bullish                                  MATCH         cmp 1800 ok 1800 warm 0/16 steady 0/1784 maxRel 0.00e+0
    bearish                                  MATCH         cmp 1800 ok 1800 warm 0/16 steady 0/1784 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
extrapolated-pivot-connector-rddt-1d-2026-09 NYSE:RDDT 1D     2      MATCH         all 3 items agree
    Pivot High's                             MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Pivot Low's                              MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 10 paired slots; coordinates are NOT compared by v1
extrapolated-pivot-connector-spy-1d-2026-10- AMEX:SPY 1D      2      MATCH         all 3 items agree
    Pivot High's                             MATCH         cmp 1800 ok 1800 warm 0/200 steady 0/1600 maxRel 0.00e+0
    Pivot Low's                              MATCH         cmp 1800 ok 1800 warm 0/200 steady 0/1600 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 10 paired slots; coordinates are NOT compared by v1
fib-retracement-extrafibs-rddt-1d-2026-10-02 NYSE:RDDT 1D     0      INCONCLUSIVE  the vendor study ran with non-default inputs (Show 0.886 and 1.113 Fibs=true vs default false); v1 compares at default inputs only — re-capture at defaults
fib-retracement-rddt-1d-2026-10-02           NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 21 paired slots; coordinates are NOT compared by v1
fib-retracement-spy-1d-2026-10-03            AMEX:SPY 1D      0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 21 paired slots; coordinates are NOT compared by v1
fibonacci-dolphintradebot-rddt-1d-2026-10-02 NYSE:RDDT 1D     2      MATCH         all 3 items agree
    Chars                                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Chars                                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 21 paired slots; coordinates are NOT compared by v1
fibonacci-dolphintradebot-spy-1d-2026-10-02  AMEX:SPY 1D      2      MATCH         all 3 items agree
    Chars                                    MATCH         cmp 1800 ok 1798 warm 2/325 steady 0/1475 maxRel 0.00e+0
    Chars                                    MATCH         cmp 1800 ok 1798 warm 2/325 steady 0/1475 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 21 paired slots; coordinates are NOT compared by v1
fibonacci-pivot-points-cc-rddt-1d-2026-09-28 NYSE:RDDT 1D     7      MATCH         all 9 items agree
    PP                                       MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    R1                                       MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    R2                                       MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    R3                                       MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    S1                                       MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    S2                                       MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    S3                                       MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 14 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
fibonacci-pivot-points-cc-spy-1d-2026-10-03  AMEX:SPY 1D      7      MATCH         all 9 items agree
    PP                                       MATCH         cmp 1800 ok 1799 warm 1/1 steady 0/1799 maxRel 0.00e+0
    R1                                       MATCH         cmp 1800 ok 1799 warm 1/1 steady 0/1799 maxRel 0.00e+0
    R2                                       MATCH         cmp 1800 ok 1799 warm 1/1 steady 0/1799 maxRel 0.00e+0
    R3                                       MATCH         cmp 1800 ok 1799 warm 1/1 steady 0/1799 maxRel 0.00e+0
    S1                                       MATCH         cmp 1800 ok 1799 warm 1/1 steady 0/1799 maxRel 0.00e+0
    S2                                       MATCH         cmp 1800 ok 1799 warm 1/1 steady 0/1799 maxRel 0.00e+0
    S3                                       MATCH         cmp 1800 ok 1799 warm 1/1 steady 0/1799 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 14 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
fvg-trend-rddt-1d-2026-09-27                 NYSE:RDDT D      2      INCONCLUSIVE  1 of 4 items could not be compared
    fvgCounter                               MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Plot                                     INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         1 paint agree bar for bar
h3-alma-v4-rddt-1d-2026-10-02                NYSE:RDDT 1D     8      MATCH         all 9 items agree
    A00_bar_index_CONTROL                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A01_alma_close_9_085_6_RAW               MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 4.41e-16
    A02_reference_close_9_085_6_RAW          MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.61e-16
    A03_alma_MINUS_reference_MUST_BE_0       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.00e+0
    A04_high_20_MINUS_reference_MUST_BE_0    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.00e+0
    A05_low_14_05_2_MINUS_reference_MUST_BE_ MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.00e+0
    A06_offset_1_MINUS_reference_MUST_BE_0   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.00e+0
    A07_alma_is_na                           MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
h3-alma-v4-spy-1d-2026-10-02                 AMEX:SPY 1D      8      INCONCLUSIVE  8 of 9 items could not be compared
    A00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for value
    A01_alma_close_9_085_6_RAW               INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2
    A02_reference_close_9_085_6_RAW          INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3
    A03_alma_MINUS_reference_MUST_BE_0       INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4
    A04_high_20_MINUS_reference_MUST_BE_0    INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out5
    A05_low_14_05_2_MINUS_reference_MUST_BE_ INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out6
    A06_offset_1_MINUS_reference_MUST_BE_0   INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out7
    A07_alma_is_na                           INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out8
    objects                                  MATCH         neither side draws an object
h3-vwap-source-spy-1d-2026-10-02             AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:arity) [runtime declined: pine:arity]: the engine grammar declares a different signature for that name — `ta.vwap` was given a source this table cannot weigh: the session VWAP is carried for a price the bar itself holds (`close`, `open`, `high`, `low`, `hl2`, `hlc3`, `ohlc4`, `hlcc4`) — vwap() / vwapOf(series). A computed source can be `na` on a bar, and what TradingView's session sum does with an `na` term has not been measured. TO UNBLOCK: weigh a bar price, e.g. `ta.vwap(close)`
h3-vwap-source-spy-5-2026-10-02              AMEX:SPY 5       0      INCONCLUSIVE  refused on our side: member door refused (pine:arity) [runtime declined: pine:arity]: the engine grammar declares a different signature for that name — `ta.vwap` was given a source this table cannot weigh: the session VWAP is carried for a price the bar itself holds (`close`, `open`, `high`, `low`, `hl2`, `hlc3`, `ohlc4`, `hlcc4`) — vwap() / vwapOf(series). A computed source can be `na` on a bar, and what TradingView's session sum does with an `na` term has not been measured. TO UNBLOCK: weigh a bar price, e.g. `ta.vwap(close)`
heat-map-seasons-rddt-1d-2026-09-28          NYSE:RDDT 1D     1      DIVERGE       2 of 3 compared items diverge
    Plot                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 3.16e-14
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 34 paired slots; coordinates are NOT compared by v1
    paints                                   DIVERGE       1 paint differs (first: barcolor plot_0 "Bar Color" withheld (`barcolor`'s colour is an expression this door cannot carry yet))
heat-map-seasons-spy-1d-2026-10-03           AMEX:SPY 1D      1      DIVERGE       2 of 3 compared items diverge
    Plot                                     MATCH         cmp 1800 ok 1601 warm 199/200 steady 0/1600 maxRel 9.22e-13
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 34 paired slots; coordinates are NOT compared by v1
    paints                                   DIVERGE       1 paint differs (first: barcolor plot_0 "Bar Color" withheld (`barcolor`'s colour is an expression this door cannot carry yet))
high-low-open-mid-ranges-rddt-1d-2026-09-28  NYSE:RDDT 1D     7      MATCH         all 8 items agree
    plot_0                                   MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    plot_2                                   MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    plot_4                                   MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    plot_6                                   MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    plot_8                                   MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    plot_10                                  MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    plot_12                                  MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 1589 paired slots; 16 slots on objects neither side draws not graded; coordinates are NOT compared by v1
high-low-open-mid-ranges-spy-1d-2026-10-03   AMEX:SPY 1D      7      DIVERGE       1 of 8 compared items diverge
    plot_0                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_2                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_4                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_6                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_8                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_10                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_12                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 1584 paired slots; 16 slots on objects neither side draws not graded; coordinates are NOT compared by v1
htf-candle-footprint-cartel-console-rddt-1d- NYSE:RDDT 1D     0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       4 object families differ (count or text); colours agree on 12 paired slots; coordinates are NOT compared by v1
htf-candle-footprint-cartel-console-spy-1d-2 AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       4 object families differ (count or text); colours agree on 12 paired slots; coordinates are NOT compared by v1
htf-liquidity-dashboard-tfo-rddt-1d-2026-09- NYSE:RDDT 1D     0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 19 paired slots; 4 slots on objects neither side draws not graded; coordinates are NOT compared by v1
htf-liquidity-dashboard-tfo-spy-1d-2026-10-0 AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       TradingView holds 43 drawing object(s) at the last bar and our drawing is withheld by name (objects:off-listing) — the line drawings live in a `var` list, and on a chart that does not start at the symbol's listing the objects earlier bars put there are not knowable
ict-ipda-look-back-rddt-1d-2026-09-28        NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 20 paired slots; coordinates are NOT compared by v1
ict-ipda-look-back-spy-1d-2026-10-03         AMEX:SPY 1D      0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 20 paired slots; coordinates are NOT compared by v1
ict-killzones-pivots-tfo-rddt-1d-2026-09-28  NYSE:RDDT 1D     7      MATCH         all 8 items agree
    Chars                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Chars                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Chars                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Chars                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Chars                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Chars                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Chars                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 9 paired slots (6 theme-relative); coordinates are NOT compared by v1
ict-killzones-pivots-tfo-spy-1d-2026-10-03   AMEX:SPY 1D      7      MATCH         all 8 items agree
    Chars                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Chars                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Chars                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Chars                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Chars                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Chars                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Chars                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 9 paired slots (6 theme-relative); coordinates are NOT compared by v1
implied-volatility-suite-rddt-1d-2026-10-02  NYSE:RDDT 1D     1      MATCH         all 2 items agree
    Volatility Data                          MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.31e-14
    objects                                  MATCH         neither side draws an object
implied-volatility-suite-spy-1d-2026-10-02   AMEX:SPY 1D      1      MATCH         all 2 items agree
    Volatility Data                          MATCH         cmp 1800 ok 1436 warm 364/412 steady 0/1388 maxRel 7.12e-13
    objects                                  MATCH         neither side draws an object
inside-bar-range-mother-candle-breakoutbreak NYSE:RDDT 1D     2      MATCH         all 4 items agree
    Shapes                                   MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Shapes                                   MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 2 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         2 paints agree bar for bar
inside-bar-range-mother-candle-breakoutbreak AMEX:SPY 1D      2      DIVERGE       Shapes: bar 2 t=1565271000 na vendor=1 ours=na
    Shapes                                   DIVERGE       cmp 1800 ok 1799 warm 0/0 steady 1/1800 maxRel 0.00e+0 — 1 steady-state bars disagree; first at bar 2 (na: vendor 1 vs ours na) — scattered, last at bar 2
    Shapes                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 2 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         2 paints agree bar for bar
institutional-smc-order-flow-matrix-pro-rddt NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 92 paired slots; coordinates are NOT compared by v1
institutional-smc-order-flow-matrix-pro-spy- AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       TradingView holds 650 drawing object(s) at the last bar and our drawing is withheld by name (objects:off-listing) — the box drawings live in a `var` list, and on a chart that does not start at the symbol's listing the objects earlier bars put there are not knowable
k-clustering-rddt-1d-2026-09-28              NYSE:RDDT 1D     0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       3 object families differ (count or text); colours agree on 11 paired slots; coordinates are NOT compared by v1
k-clustering-spy-1d-2026-10-03               AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       3 object families differ (count or text); colours agree on 11 paired slots; coordinates are NOT compared by v1
kalman-price-filter-backquant-rddt-1d-2026-1 NYSE:RDDT 1D     1      MATCH         all 3 items agree
    Kalman                                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         1 paint agree bar for bar
keltner-center-of-gravity-channel-rddt-1d-20 NYSE:RDDT 1D     18     MATCH         all 19 items agree
    extra high line                          MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    outerhigh                                MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 4.21e-16
    innerhigh                                MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    coghigh                                  MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    coglow                                   MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    innerlow                                 MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    outerlow                                 MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 8.56e-16
    extra low line                           MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    Up Trend                                 MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    Down Trend                               MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    Support/Resistance Level                 MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    outhi                                    MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    inhi                                     MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    coghi                                    MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    cogl                                     MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    inlow                                    MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    outlow                                   MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    HMA                                      MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 6 paired slots; coordinates are NOT compared by v1
keltner-center-of-gravity-channel-spy-1d-202 AMEX:SPY 1D      18     DIVERGE       outerhigh: bar 272 t=1599053400 value vendor=358.2344426562594 ours=358.23444993065664
    extra high line                          MATCH         cmp 1800 ok 1800 warm 0/272 steady 0/1528 maxRel 0.00e+0
    outerhigh                                DIVERGE       cmp 1800 ok 1466 warm 272/272 steady 62/1528 maxRel 6.34e-8 — 62 steady-state bars disagree; first at bar 272 (value: vendor 358.2344426562594 vs ours 358.23444993065664) — a CONVERGING PREFIX: bars 272..333 differ with |err| falling 7.27e-6 → 7.34e-7, then all 1466 later bars agree (the recursive-state-seeded-at-the-window signature)
    innerhigh                                MATCH         cmp 1800 ok 1780 warm 20/21 steady 0/1779 maxRel 0.00e+0
    coghigh                                  MATCH         cmp 1800 ok 1780 warm 20/21 steady 0/1779 maxRel 0.00e+0
    coglow                                   MATCH         cmp 1800 ok 1780 warm 20/21 steady 0/1779 maxRel 0.00e+0
    innerlow                                 MATCH         cmp 1800 ok 1780 warm 20/21 steady 0/1779 maxRel 0.00e+0
    outerlow                                 DIVERGE       cmp 1800 ok 1464 warm 272/272 steady 64/1528 maxRel 6.99e-8 — 64 steady-state bars disagree; first at bar 272 (value: vendor 331.6455573437406 vs ours 331.64555006934336) — a CONVERGING PREFIX: bars 272..335 differ with |err| falling 7.27e-6 → 3.36e-7, then all 1464 later bars agree (the recursive-state-seeded-at-the-window signature)
    extra low line                           MATCH         cmp 1800 ok 1800 warm 0/272 steady 0/1528 maxRel 0.00e+0
    Up Trend                                 MATCH         cmp 1800 ok 1800 warm 0/522 steady 0/1278 maxRel 0.00e+0
    Down Trend                               MATCH         cmp 1800 ok 1800 warm 0/522 steady 0/1278 maxRel 0.00e+0
    Support/Resistance Level                 MATCH         cmp 1800 ok 1800 warm 0/522 steady 0/1278 maxRel 0.00e+0
    outhi                                    MATCH         cmp 1800 ok 1800 warm 0/272 steady 0/1528 maxRel 0.00e+0
    inhi                                     MATCH         cmp 1800 ok 1800 warm 0/272 steady 0/1528 maxRel 0.00e+0
    coghi                                    MATCH         cmp 1800 ok 1800 warm 0/21 steady 0/1779 maxRel 0.00e+0
    cogl                                     MATCH         cmp 1800 ok 1800 warm 0/21 steady 0/1779 maxRel 0.00e+0
    inlow                                    MATCH         cmp 1800 ok 1800 warm 0/272 steady 0/1528 maxRel 0.00e+0
    outlow                                   MATCH         cmp 1800 ok 1800 warm 0/272 steady 0/1528 maxRel 0.00e+0
    HMA                                      MATCH         cmp 1800 ok 1800 warm 0/80 steady 0/1720 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 6 paired slots; coordinates are NOT compared by v1
keltner-channels-bands-rddt-1d-2026-09-27    NYSE:RDDT D      7      MATCH         all 8 items agree
    Basis                                    MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 4.41e-16
    Upper 1                                  MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 4.78e-16
    Lower 1                                  MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 5.72e-16
    Upper 2                                  MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 4.49e-16
    Lower 2                                  MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 6.38e-16
    Upper 3                                  MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 5.38e-16
    Lower 3                                  MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 7.35e-16
    objects                                  MATCH         neither side draws an object
keltner-channels-bands-spy-1d-2026-10-03     AMEX:SPY 1D      7      DIVERGE       Basis: bar 20 t=1567603800 value vendor=290.98959343001377 ours=289.96133333333336
    Basis                                    DIVERGE       cmp 1800 ok 1628 warm 20/20 steady 152/1780 maxRel 3.91e-3 — 152 steady-state bars disagree; first at bar 20 (value: vendor 290.98959343001377 vs ours 289.96133333333336) — a CONVERGING PREFIX: bars 20..171 differ with |err| falling 1.03e+0 → 2.81e-7, then all 1628 later bars agree (the recursive-state-seeded-at-the-window signature)
    Upper 1                                  DIVERGE       cmp 1800 ok 1629 warm 20/20 steady 151/1780 maxRel 3.24e-3 — 151 steady-state bars disagree; first at bar 20 (value: vendor 295.06763428334295 vs ours 294.203379782553) — a CONVERGING PREFIX: bars 20..170 differ with |err| falling 8.64e-1 → 2.88e-7, then all 1629 later bars agree (the recursive-state-seeded-at-the-window signature)
    Lower 1                                  DIVERGE       cmp 1800 ok 1627 warm 20/20 steady 153/1780 maxRel 4.60e-3 — 153 steady-state bars disagree; first at bar 20 (value: vendor 286.9115525766846 vs ours 285.7192868841137) — a CONVERGING PREFIX: bars 20..172 differ with |err| falling 1.19e+0 → 2.72e-7, then all 1627 later bars agree (the recursive-state-seeded-at-the-window signature)
    Upper 2                                  DIVERGE       cmp 1800 ok 1630 warm 20/20 steady 150/1780 maxRel 2.58e-3 — 150 steady-state bars disagree; first at bar 20 (value: vendor 299.14567513667214 vs ours 298.44542623177256) — a CONVERGING PREFIX: bars 20..169 differ with |err| falling 7.00e-1 → 2.93e-7, then all 1630 later bars agree (the recursive-state-seeded-at-the-window signature)
    Lower 2                                  DIVERGE       cmp 1800 ok 1626 warm 20/20 steady 154/1780 maxRel 5.32e-3 — 154 steady-state bars disagree; first at bar 20 (value: vendor 282.8335117233554 vs ours 281.47724043489416) — a CONVERGING PREFIX: bars 20..173 differ with |err| falling 1.36e+0 → 2.63e-7, then all 1626 later bars agree (the recursive-state-seeded-at-the-window signature)
    Upper 3                                  DIVERGE       cmp 1800 ok 1632 warm 20/20 steady 148/1780 maxRel 1.95e-3 — 148 steady-state bars disagree; first at bar 20 (value: vendor 303.2237159900014 vs ours 302.6874726809922) — a CONVERGING PREFIX: bars 20..167 differ with |err| falling 5.36e-1 → 3.27e-7, then all 1632 later bars agree (the recursive-state-seeded-at-the-window signature)
    Lower 3                                  DIVERGE       cmp 1800 ok 1625 warm 20/20 steady 155/1780 maxRel 6.05e-3 — 155 steady-state bars disagree; first at bar 20 (value: vendor 278.75547087002616 vs ours 277.2351939856745) — a CONVERGING PREFIX: bars 20..174 differ with |err| falling 1.52e+0 → 2.52e-7, then all 1625 later bars agree (the recursive-state-seeded-at-the-window signature)
    objects                                  MATCH         neither side draws an object
linear-regression-channel-tradingfinder-exis NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 5 paired slots; coordinates are NOT compared by v1
linear-regression-channel-tradingfinder-exis AMEX:SPY 1D      0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 5 paired slots; coordinates are NOT compared by v1
liquidation-levels-rddt-1d-2026-09-28        NYSE:RDDT 1D     11     MATCH         all 12 items agree
    L1 Long                                  MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    L2 Long                                  MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    L3 Long                                  MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    L4 Long                                  MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    L5 Long                                  MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    L1 Short                                 MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    L2 Short                                 MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    L3 Short                                 MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    L4 Short                                 MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    L5 Short                                 MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    plot_20                                  MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 20 paired slots; coordinates are NOT compared by v1
liquidation-levels-spy-1d-2026-10-03         AMEX:SPY 1D      11     MATCH         all 12 items agree
    L1 Long                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L2 Long                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L3 Long                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L4 Long                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L5 Long                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L1 Short                                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L2 Short                                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L3 Short                                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L4 Short                                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L5 Short                                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_20                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 20 paired slots; coordinates are NOT compared by v1
liquidity-engulfing-candles-upslidedown-rddt NYSE:RDDT 1D     3      MATCH         all 4 items agree
    Strategy Signal                          MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Shapes                                   MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Shapes                                   MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
liquidity-engulfing-candles-upslidedown-spy- AMEX:SPY 1D      3      MATCH         all 4 items agree
    Strategy Signal                          MATCH         cmp 1800 ok 1800 warm 0/1 steady 0/1799 maxRel 0.00e+0
    Shapes                                   MATCH         cmp 1800 ok 1800 warm 0/1 steady 0/1799 maxRel 0.00e+0
    Shapes                                   MATCH         cmp 1800 ok 1800 warm 0/1 steady 0/1799 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
liquidity-heatmap-nephew-sam-rddt-1d-2026-09 NYSE:RDDT 1D     0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 3 paired slots; coordinates are NOT compared by v1
liquidity-heatmap-nephew-sam-spy-1d-2026-10- AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 3 paired slots; coordinates are NOT compared by v1
liquidity-pools-rddt-1d-2026-09-28           NYSE:RDDT 1D     2      MATCH         all 3 items agree
    Swing High                               MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Swing Low                                MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 364 paired slots; coordinates are NOT compared by v1
liquidity-pools-spy-1d-2026-10-03            AMEX:SPY 1D      2      DIVERGE       1 of 3 compared items diverge
    Swing High                               MATCH         cmp 1800 ok 1800 warm 0/8 steady 0/1792 maxRel 0.00e+0
    Swing Low                                MATCH         cmp 1800 ok 1799 warm 1/8 steady 0/1792 maxRel 0.00e+0
    objects                                  DIVERGE       3 object families differ (count or text); colours agree on 1010 paired slots; coordinates are NOT compared by v1
macd-shortlong-strategy-for-tradingview-inpu NYSE:RDDT 1D     6      MATCH         all 7 items agree
    Histogram Long                           MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 4.39e-12
    MACD Long                                MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 4.64e-12
    Signal Long                              MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.48e-12
    Histogram Short                          MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 6.84e-11
    MACD Short                               MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 6.86e-12
    Signal Short                             MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.34e-12
    objects                                  MATCH         neither side draws an object
macd-shortlong-strategy-for-tradingview-inpu AMEX:SPY 1D      6      DIVERGE       Histogram Long: bar 28 t=1568640600 value vendor=0.5299713397210886 ours=0.46583207113087655
    Histogram Long                           DIVERGE       cmp 1800 ok 1608 warm 28/28 steady 164/1772 maxRel 1.35e+1 — 164 steady-state bars disagree; first at bar 28 (value: vendor 0.5299713397210886 vs ours 0.46583207113087655) — a CONVERGING PREFIX: bars 28..191 differ with |err| falling 6.41e-2 → 1.08e-8, then all 1608 later bars agree (the recursive-state-seeded-at-the-window signature)
    MACD Long                                DIVERGE       cmp 1800 ok 1606 warm 19/19 steady 175/1781 maxRel 3.39e+0 — 175 steady-state bars disagree; first at bar 19 (value: vendor -0.35665092894447525 vs ours 0.21796449378018679) — a CONVERGING PREFIX: bars 19..193 differ with |err| falling 5.75e-1 → 1.09e-8, then all 1606 later bars agree (the recursive-state-seeded-at-the-window signature)
    Signal Long                              DIVERGE       cmp 1800 ok 1600 warm 28/28 steady 172/1772 maxRel 1.78e+1 — 172 steady-state bars disagree; first at bar 28 (value: vendor 0.7189778042864086 vs ours 1.0644045678428706) — a CONVERGING PREFIX: bars 28..199 differ with |err| falling 3.45e-1 → 1.05e-8, then all 1600 later bars agree (the recursive-state-seeded-at-the-window signature)
    Histogram Short                          DIVERGE       cmp 1800 ok 1598 warm 29/29 steady 173/1771 maxRel 1.65e+0 — 173 steady-state bars disagree; first at bar 29 (value: vendor 0.6615131593579868 vs ours 0.5190895142348377) — a CONVERGING PREFIX: bars 29..201 differ with |err| falling 1.42e-1 → 1.02e-8, then all 1598 later bars agree (the recursive-state-seeded-at-the-window signature)
    MACD Short                               DIVERGE       cmp 1800 ok 1595 warm 20/20 steady 185/1780 maxRel 6.05e+0 — 185 steady-state bars disagree; first at bar 20 (value: vendor -0.1469227421538335 vs ours 0.7422251042422658) — a CONVERGING PREFIX: bars 20..204 differ with |err| falling 8.89e-1 → 1.03e-8, then all 1595 later bars agree (the recursive-state-seeded-at-the-window signature)
    Signal Short                             DIVERGE       cmp 1800 ok 1590 warm 29/29 steady 181/1771 maxRel 2.48e+0 — 181 steady-state bars disagree; first at bar 29 (value: vendor 1.3637237362501018 vs ours 1.8969319551492394) — a CONVERGING PREFIX: bars 29..209 differ with |err| falling 5.33e-1 → 1.08e-8, then all 1590 later bars agree (the recursive-state-seeded-at-the-window signature)
    objects                                  MATCH         neither side draws an object
madrid-moving-average-ribbon-rddt-1d-2026-09 NYSE:RDDT 1D     18     MATCH         all 19 items agree
    MMA05                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 4.49e-16
    MMA10                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 6.29e-16
    MMA15                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 3.87e-16
    MMA20                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 4.41e-16
    MMA25                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.39e-15
    MMA30                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.57e-15
    MMA35                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.10e-15
    MMA40                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.47e-15
    MMA45                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.29e-15
    MMA50                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.26e-15
    MMA55                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 9.49e-16
    MMA60                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.99e-15
    MMA65                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.67e-15
    MMA70                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 2.14e-15
    MMA75                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.61e-15
    MMA80                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 7.06e-16
    MMA85                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 2.47e-15
    MMA90                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.97e-15
    objects                                  MATCH         neither side draws an object
madrid-moving-average-ribbon-spy-1d-2026-10- AMEX:SPY 1D      18     DIVERGE       MMA05: bar 5 t=1565703000 value vendor=290.97333269576046 ours=290.7273333333333
    MMA05                                    DIVERGE       cmp 1800 ok 1761 warm 5/5 steady 34/1795 maxRel 1.27e-3 — 34 steady-state bars disagree; first at bar 5 (value: vendor 290.97333269576046 vs ours 290.7273333333333) — a CONVERGING PREFIX: bars 5..38 differ with |err| falling 2.46e-1 → 3.80e-7, then all 1761 later bars agree (the recursive-state-seeded-at-the-window signature)
    MMA10                                    DIVERGE       cmp 1800 ok 1715 warm 10/10 steady 75/1790 maxRel 2.55e-3 — 75 steady-state bars disagree; first at bar 10 (value: vendor 289.91313113267717 vs ours 289.3094545454545) — scattered, last at bar 199
    MMA15                                    DIVERGE       cmp 1800 ok 1672 warm 15/15 steady 113/1785 maxRel 2.81e-3 — 113 steady-state bars disagree; first at bar 15 (value: vendor 289.6875400008538 vs ours 288.9735) — scattered, last at bar 201
    MMA20                                    DIVERGE       cmp 1800 ok 1627 warm 20/20 steady 153/1780 maxRel 3.91e-3 — 153 steady-state bars disagree; first at bar 20 (value: vendor 290.98959343001377 vs ours 289.96133333333336) — scattered, last at bar 203
    MMA25                                    DIVERGE       cmp 1800 ok 1579 warm 25/25 steady 196/1775 maxRel 6.94e-3 — 196 steady-state bars disagree; first at bar 25 (value: vendor 293.6599313459245 vs ours 291.78095384615386) — a CONVERGING PREFIX: bars 25..220 differ with |err| falling 1.88e+0 → 3.13e-7, then all 1579 later bars agree (the recursive-state-seeded-at-the-window signature)
    MMA30                                    DIVERGE       cmp 1800 ok 1533 warm 30/30 steady 237/1770 maxRel 8.50e-3 — 237 steady-state bars disagree; first at bar 30 (value: vendor 295.577167136527 vs ours 293.22915053763444) — a CONVERGING PREFIX: bars 30..266 differ with |err| falling 2.35e+0 → 3.43e-7, then all 1533 later bars agree (the recursive-state-seeded-at-the-window signature)
    MMA35                                    DIVERGE       cmp 1800 ok 1491 warm 35/35 steady 274/1765 maxRel 7.62e-3 — 274 steady-state bars disagree; first at bar 35 (value: vendor 295.92852367340953 vs ours 293.79985714285715) — a CONVERGING PREFIX: bars 35..308 differ with |err| falling 2.13e+0 → 3.56e-7, then all 1491 later bars agree (the recursive-state-seeded-at-the-window signature)
    MMA40                                    DIVERGE       cmp 1800 ok 1453 warm 40/40 steady 307/1760 maxRel 5.80e-3 — 307 steady-state bars disagree; first at bar 40 (value: vendor 295.2264121353205 vs ours 293.5951463414634) — a CONVERGING PREFIX: bars 40..346 differ with |err| falling 1.63e+0 → 3.68e-7, then all 1453 later bars agree (the recursive-state-seeded-at-the-window signature)
    MMA45                                    DIVERGE       cmp 1800 ok 1424 warm 45/45 steady 331/1755 maxRel 3.11e-3 — 331 steady-state bars disagree; first at bar 45 (value: vendor 294.32253387265916 vs ours 293.44768115942037) — a CONVERGING PREFIX: bars 45..375 differ with |err| falling 8.75e-1 → 3.73e-7, then all 1424 later bars agree (the recursive-state-seeded-at-the-window signature)
    MMA50                                    DIVERGE       cmp 1800 ok 1387 warm 50/50 steady 363/1750 maxRel 2.71e-3 — 363 steady-state bars disagree; first at bar 50 (value: vendor 294.6560882897784 vs ours 293.88854117647065) — a CONVERGING PREFIX: bars 50..412 differ with |err| falling 7.68e-1 → 3.94e-7, then all 1387 later bars agree (the recursive-state-seeded-at-the-window signature)
    MMA55                                    DIVERGE       cmp 1800 ok 1343 warm 55/55 steady 402/1745 maxRel 3.20e-3 — 402 steady-state bars disagree; first at bar 55 (value: vendor 295.292411734689 vs ours 294.3830454545455) — a CONVERGING PREFIX: bars 55..456 differ with |err| falling 9.09e-1 → 4.22e-7, then all 1343 later bars agree (the recursive-state-seeded-at-the-window signature)
    MMA60                                    DIVERGE       cmp 1800 ok 1296 warm 60/60 steady 444/1740 maxRel 3.95e-3 — 444 steady-state bars disagree; first at bar 60 (value: vendor 296.2398668324612 vs ours 295.1099371584699) — a CONVERGING PREFIX: bars 60..503 differ with |err| falling 1.13e+0 → 4.36e-7, then all 1296 later bars agree (the recursive-state-seeded-at-the-window signature)
    MMA65                                    DIVERGE       cmp 1800 ok 1246 warm 65/65 steady 489/1735 maxRel 5.06e-3 — 489 steady-state bars disagree; first at bar 65 (value: vendor 297.43999097197513 vs ours 295.9819020979021) — a CONVERGING PREFIX: bars 65..553 differ with |err| falling 1.46e+0 → 4.39e-7, then all 1246 later bars agree (the recursive-state-seeded-at-the-window signature)
    MMA70                                    DIVERGE       cmp 1800 ok 1199 warm 70/70 steady 531/1730 maxRel 6.09e-3 — 531 steady-state bars disagree; first at bar 70 (value: vendor 298.6584871646046 vs ours 296.8939416498993) — a CONVERGING PREFIX: bars 70..600 differ with |err| falling 1.76e+0 → 4.67e-7, then all 1199 later bars agree (the recursive-state-seeded-at-the-window signature)
    MMA75                                    DIVERGE       cmp 1800 ok 1149 warm 75/75 steady 576/1725 maxRel 7.03e-3 — 576 steady-state bars disagree; first at bar 75 (value: vendor 299.89701296657176 vs ours 297.8453157894736) — a CONVERGING PREFIX: bars 75..650 differ with |err| falling 2.05e+0 → 4.49e-7, then all 1149 later bars agree (the recursive-state-seeded-at-the-window signature)
    MMA80                                    DIVERGE       cmp 1800 ok 1101 warm 80/80 steady 619/1720 maxRel 7.63e-3 — 619 steady-state bars disagree; first at bar 80 (value: vendor 301.05577083754633 vs ours 298.81746141975304) — a CONVERGING PREFIX: bars 80..698 differ with |err| falling 2.24e+0 → 4.36e-7, then all 1101 later bars agree (the recursive-state-seeded-at-the-window signature)
    MMA85                                    DIVERGE       cmp 1800 ok 1053 warm 85/85 steady 662/1715 maxRel 7.89e-3 — 662 steady-state bars disagree; first at bar 85 (value: vendor 301.8475734907073 vs ours 299.52215595075234) — a CONVERGING PREFIX: bars 85..746 differ with |err| falling 2.33e+0 → 4.09e-7, then all 1053 later bars agree (the recursive-state-seeded-at-the-window signature)
    MMA90                                    DIVERGE       cmp 1800 ok 1007 warm 90/90 steady 703/1710 maxRel 8.10e-3 — 703 steady-state bars disagree; first at bar 90 (value: vendor 302.8041412680017 vs ours 300.40701953601945) — a CONVERGING PREFIX: bars 90..792 differ with |err| falling 2.40e+0 → 4.02e-7, then all 1007 later bars agree (the recursive-state-seeded-at-the-window signature)
    objects                                  MATCH         neither side draws an object
makuchaku039s-trade-tools-fair-value-gaps-rd NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 102 paired slots; coordinates are NOT compared by v1
makuchaku039s-trade-tools-fair-value-gaps-sp AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       1 object families differ (count or text); colours agree on 102 paired slots; coordinates are NOT compared by v1
market-structure-by-leviathan-rddt-1d-2026-0 NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 50 paired slots (16 theme-relative); coordinates are NOT compared by v1
market-structure-by-leviathan-spy-1d-2026-10 AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       3 object families differ (count or text); colours agree on 145 paired slots (41 theme-relative); coordinates are NOT compared by v1
mcclellan-indicators-rddt-1d-2026-09-28      NYSE:RDDT 1D     13     DIVERGE       Osc: bar 38 t=1715779800 na vendor=122.44137512554066 ours=na
    Osc                                      DIVERGE       cmp 632 ok 38 warm 0/0 steady 594/632 maxRel 0.00e+0 — 594 steady-state bars disagree; first at bar 38 (na: vendor 122.44137512554066 vs ours na) — persistent, last at bar 631
    MSI                                      MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MSI EMA                                  MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MSI Cross Up                             MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MSI Cross Down                           MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MSI RSI                                  MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    RSI Hook Down                            MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    RSI Hook Up                              MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MACD                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MACD Signal Line                         MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MACD Histogram                           MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MACD Cross Up                            MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MACD Cross Down                          MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         2 paints agree bar for bar
mcclellan-indicators-spy-1d-2026-10-03       AMEX:SPY 1D      13     DIVERGE       Osc: bar 39 t=1569936600 na vendor=-54.16950544433078 ours=na
    Osc                                      DIVERGE       cmp 1800 ok 0 warm 39/39 steady 1761/1761 maxRel 0.00e+0 — 1761 steady-state bars disagree; first at bar 39 (na: vendor -54.16950544433078 vs ours na) — persistent, last at bar 1799
    MSI                                      MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MSI EMA                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MSI Cross Up                             MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MSI Cross Down                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MSI RSI                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    RSI Hook Down                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    RSI Hook Up                              MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MACD                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MACD Signal Line                         MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MACD Histogram                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MACD Cross Up                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MACD Cross Down                          MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         2 paints agree bar for bar
momentum-volatility-scanner-rddt-1d-2026-09- NYSE:RDDT 1D     11     MATCH         all 12 items agree
    Momentum Line                            MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Momentum Area                            MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Momentum Histogram                       MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 3.75e-13
    Vol Upper                                MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 7.16e-13
    Vol Lower                                MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 7.16e-13
    Bullish Shift                            MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bearish Shift                            MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Extreme Bull                             MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Extreme Bear                             MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bull Divergence                          MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bear Divergence                          MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 25 paired slots; coordinates are NOT compared by v1
momentum-volatility-scanner-spy-1d-2026-10-0 AMEX:SPY 1D      11     DIVERGE       Momentum Histogram: bar 42 t=1570195800 value vendor=-18.25600740452319 ours=-15.179707286488267
    Momentum Line                            MATCH         cmp 1800 ok 1800 warm 0/42 steady 0/1758 maxRel 0.00e+0
    Momentum Area                            MATCH         cmp 1800 ok 1800 warm 0/42 steady 0/1758 maxRel 0.00e+0
    Momentum Histogram                       DIVERGE       cmp 1800 ok 1523 warm 42/42 steady 235/1758 maxRel 4.57e-1 — 235 steady-state bars disagree; first at bar 42 (value: vendor -18.25600740452319 vs ours -15.179707286488267) — a CONVERGING PREFIX: bars 42..292 (with agreeing bars inside the run) differ with |err| falling 3.08e+0 → 1.06e-8, then all 1507 later bars agree (the recursive-state-seeded-at-the-window signature)
    Vol Upper                                MATCH         cmp 1800 ok 1781 warm 19/20 steady 0/1780 maxRel 7.80e-11
    Vol Lower                                MATCH         cmp 1800 ok 1781 warm 19/20 steady 0/1780 maxRel 7.80e-11
    Bullish Shift                            DIVERGE       cmp 1800 ok 1798 warm 0/18 steady 2/1782 maxRel 0.00e+0 — 2 steady-state bars disagree; first at bar 23 (na: vendor na vs ours 1) — scattered, last at bar 26
    Bearish Shift                            DIVERGE       cmp 1800 ok 1799 warm 0/18 steady 1/1782 maxRel 0.00e+0 — 1 steady-state bars disagree; first at bar 41 (na: vendor 1 vs ours na) — scattered, last at bar 41
    Extreme Bull                             MATCH         cmp 1800 ok 1800 warm 0/18 steady 0/1782 maxRel 0.00e+0
    Extreme Bear                             MATCH         cmp 1800 ok 1800 warm 0/18 steady 0/1782 maxRel 0.00e+0
    Bull Divergence                          MATCH         cmp 1800 ok 1800 warm 0/23 steady 0/1777 maxRel 0.00e+0
    Bear Divergence                          MATCH         cmp 1800 ok 1800 warm 0/23 steady 0/1777 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 25 paired slots; coordinates are NOT compared by v1
multi-timeframe-supply-demand-zones-rddt-1d- NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; no colour slot was paired, so no colour was graded; 1008 slots on objects neither side draws not graded (16 of them hold a colour that differs); coordinates are NOT compared by v1
multi-timeframe-supply-demand-zones-spy-1d-2 AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       TradingView holds 504 drawing object(s) at the last bar and our drawing is withheld by name (objects:off-listing) — the box drawings live in a `var` list, and on a chart that does not start at the symbol's listing the objects earlier bars put there are not knowable
multicator-table-rddt-1d-2026-10-02          NYSE:RDDT 1D     28     DIVERGE       1 of 29 compared items diverge
    EMA1                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    EMA2                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    EMA3                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    SMA1                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    SMA2                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    SMA3                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    ParabolicSAR                             MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Basis                                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Upper                                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Lower                                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Conversion Line                          MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Base Line                                MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Lagging Span                             MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Leading Span A                           MATCH         cmp 611 ok 611 warm 0/0 steady 0/611 maxRel 0.00e+0
    Leading Span B                           MATCH         cmp 611 ok 611 warm 0/0 steady 0/611 maxRel 0.00e+0
    Kumo Cloud Upper Line                    MATCH         cmp 611 ok 611 warm 0/0 steady 0/611 maxRel 0.00e+0
    Kumo Cloud Lower Line                    MATCH         cmp 611 ok 611 warm 0/0 steady 0/611 maxRel 0.00e+0
    VWAP                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Supertrend                               MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Donchian High                            MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Donchian Low                             MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Keltner Upper                            MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Keltner Lower                            MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Keltner Basis                            MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    RSI bull div                             MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    RSI bear div                             MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    MACD bull div                            MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    MACD bear div                            MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 72 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (coll:diverged, coll:push)
multicator-table-spy-1d-2026-10-02           AMEX:SPY 1D      28     DIVERGE       1 of 29 compared items diverge
    EMA1                                     MATCH         cmp 1800 ok 1800 warm 0/50 steady 0/1750 maxRel 0.00e+0
    EMA2                                     MATCH         cmp 1800 ok 1800 warm 0/100 steady 0/1700 maxRel 0.00e+0
    EMA3                                     MATCH         cmp 1800 ok 1800 warm 0/200 steady 0/1600 maxRel 0.00e+0
    SMA1                                     MATCH         cmp 1800 ok 1800 warm 0/50 steady 0/1750 maxRel 0.00e+0
    SMA2                                     MATCH         cmp 1800 ok 1800 warm 0/100 steady 0/1700 maxRel 0.00e+0
    SMA3                                     MATCH         cmp 1800 ok 1800 warm 0/200 steady 0/1600 maxRel 0.00e+0
    ParabolicSAR                             MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Basis                                    MATCH         cmp 1800 ok 1800 warm 0/20 steady 0/1780 maxRel 0.00e+0
    Upper                                    MATCH         cmp 1800 ok 1800 warm 0/20 steady 0/1780 maxRel 0.00e+0
    Lower                                    MATCH         cmp 1800 ok 1800 warm 0/20 steady 0/1780 maxRel 0.00e+0
    Conversion Line                          MATCH         cmp 1800 ok 1800 warm 0/9 steady 0/1791 maxRel 0.00e+0
    Base Line                                MATCH         cmp 1800 ok 1800 warm 0/26 steady 0/1774 maxRel 0.00e+0
    Lagging Span                             MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Leading Span A                           MATCH         cmp 1775 ok 1775 warm 0/51 steady 0/1724 maxRel 0.00e+0
    Leading Span B                           MATCH         cmp 1775 ok 1775 warm 0/77 steady 0/1698 maxRel 0.00e+0
    Kumo Cloud Upper Line                    MATCH         cmp 1775 ok 1775 warm 0/77 steady 0/1698 maxRel 0.00e+0
    Kumo Cloud Lower Line                    MATCH         cmp 1775 ok 1775 warm 0/77 steady 0/1698 maxRel 0.00e+0
    VWAP                                     MATCH         cmp 1800 ok 1800 warm 0/960 steady 0/840 maxRel 0.00e+0
    Supertrend                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Donchian High                            MATCH         cmp 1800 ok 1800 warm 0/20 steady 0/1780 maxRel 0.00e+0
    Donchian Low                             MATCH         cmp 1800 ok 1800 warm 0/20 steady 0/1780 maxRel 0.00e+0
    Keltner Upper                            MATCH         cmp 1800 ok 1800 warm 0/20 steady 0/1780 maxRel 0.00e+0
    Keltner Lower                            MATCH         cmp 1800 ok 1800 warm 0/20 steady 0/1780 maxRel 0.00e+0
    Keltner Basis                            MATCH         cmp 1800 ok 1800 warm 0/20 steady 0/1780 maxRel 0.00e+0
    RSI bull div                             MATCH         cmp 1800 ok 1799 warm 1/270 steady 0/1530 maxRel 0.00e+0
    RSI bear div                             MATCH         cmp 1800 ok 1797 warm 3/270 steady 0/1530 maxRel 0.00e+0
    MACD bull div                            MATCH         cmp 1800 ok 1800 warm 0/282 steady 0/1518 maxRel 0.00e+0
    MACD bear div                            MATCH         cmp 1800 ok 1798 warm 2/282 steady 0/1518 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 72 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (coll:diverged, coll:push)
nadaraya-watson-rational-quadratic-kernel-no NYSE:RDDT 1D     2      INCONCLUSIVE  1 of 3 items could not be compared
    Rational Quadratic Kernel Estimate       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Alert Stream                             INCONCLUSIVE   — our side produced no column for this plot — the translator refused this plot (pine:block)
    objects                                  MATCH         neither side draws an object
opening-range-initial-balance-opening-price- NYSE:RDDT 1D     14     INCONCLUSIVE  11 of 15 items could not be compared
    Shapes                                   INCONCLUSIVE   — UNMAPPED — vendor title "Shapes" is not unique in the study
    OR Low                                   INCONCLUSIVE   — UNMAPPED — vendor title "OR Low" is not unique in the study
    OR Low                                   INCONCLUSIVE   — UNMAPPED — vendor title "OR Low" is not unique in the study
    Shapes                                   INCONCLUSIVE   — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE   — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE   — UNMAPPED — vendor title "Shapes" is not unique in the study
    IB Low                                   INCONCLUSIVE   — UNMAPPED — vendor title "IB Low" is not unique in the study
    IB Low                                   INCONCLUSIVE   — UNMAPPED — vendor title "IB Low" is not unique in the study
    Shapes                                   INCONCLUSIVE   — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE   — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE   — UNMAPPED — vendor title "Shapes" is not unique in the study
    Opening price                            MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    OR High                                  MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    IB High                                  MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
opening-range-initial-balance-opening-price- AMEX:SPY 1D      14     INCONCLUSIVE  11 of 15 items could not be compared
    Shapes                                   INCONCLUSIVE   — UNMAPPED — vendor title "Shapes" is not unique in the study
    OR Low                                   INCONCLUSIVE   — UNMAPPED — vendor title "OR Low" is not unique in the study
    OR Low                                   INCONCLUSIVE   — UNMAPPED — vendor title "OR Low" is not unique in the study
    Shapes                                   INCONCLUSIVE   — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE   — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE   — UNMAPPED — vendor title "Shapes" is not unique in the study
    IB Low                                   INCONCLUSIVE   — UNMAPPED — vendor title "IB Low" is not unique in the study
    IB Low                                   INCONCLUSIVE   — UNMAPPED — vendor title "IB Low" is not unique in the study
    Shapes                                   INCONCLUSIVE   — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE   — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE   — UNMAPPED — vendor title "Shapes" is not unique in the study
    Opening price                            MATCH         cmp 1800 ok 1800 warm 0/251 steady 0/1549 maxRel 0.00e+0
    OR High                                  MATCH         cmp 1800 ok 1800 warm 0/251 steady 0/1549 maxRel 0.00e+0
    IB High                                  MATCH         cmp 1800 ok 1800 warm 0/251 steady 0/1549 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
optimized-keltner-channels-sltp-strategy-for NYSE:RDDT 1D     5      DIVERGE       Plot: bar 0 t=1711027800 na vendor=0 ours=na
    Upper                                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 7.06e-16
    Basis                                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 6.00e-16
    Lower                                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 6.34e-16
    Plot                                     DIVERGE       cmp 636 ok 635 warm 0/0 steady 1/636 maxRel 0.00e+0 — 1 steady-state bars disagree; first at bar 0 (na: vendor 0 vs ours na) — scattered, last at bar 0
    Plot                                     DIVERGE       cmp 636 ok 635 warm 0/0 steady 1/636 maxRel 0.00e+0 — 1 steady-state bars disagree; first at bar 0 (na: vendor 0 vs ours na) — scattered, last at bar 0
    objects                                  MATCH         neither side draws an object
optimized-keltner-channels-sltp-strategy-for AMEX:SPY 1D      5      DIVERGE       Upper: bar 19 t=1567517400 value vendor=294.2404794881743 ours=294.8071391298554
    Upper                                    DIVERGE       cmp 1800 ok 1515 warm 19/19 steady 266/1781 maxRel 2.02e-3 — 266 steady-state bars disagree; first at bar 19 (value: vendor 294.2404794881743 vs ours 294.8071391298554) — a CONVERGING PREFIX: bars 19..284 differ with |err| falling 5.67e-1 → 3.51e-7, then all 1515 later bars agree (the recursive-state-seeded-at-the-window signature)
    Basis                                    DIVERGE       cmp 1800 ok 1731 warm 9/9 steady 60/1791 maxRel 8.05e-4 — 60 steady-state bars disagree; first at bar 9 (value: vendor 289.6770292436356 vs ours 289.4908888888889) — a CONVERGING PREFIX: bars 9..68 differ with |err| falling 1.86e-1 → 3.57e-7, then all 1731 later bars agree (the recursive-state-seeded-at-the-window signature)
    Lower                                    DIVERGE       cmp 1800 ok 1514 warm 19/19 steady 267/1781 maxRel 2.25e-3 — 267 steady-state bars disagree; first at bar 19 (value: vendor 286.25555493382626 vs ours 285.64892195534014) — a CONVERGING PREFIX: bars 19..285 differ with |err| falling 6.07e-1 → 3.33e-7, then all 1514 later bars agree (the recursive-state-seeded-at-the-window signature)
    Plot                                     MATCH         cmp 1800 ok 1550 warm 250/270 steady 0/1530 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1550 warm 250/270 steady 0/1530 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
options-max-pain-calculator-backquant-rddt-1 NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 87 paired slots; coordinates are NOT compared by v1
options-max-pain-calculator-backquant-spy-1d AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       6 object families differ (count or text); colours agree on 27 paired slots; coordinates are NOT compared by v1
pa-zigzag-fibonacci-fan-rddt-1d-2026-10-02   NYSE:RDDT 1D     9      MATCH         all 10 items agree
    zigzag                                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
     0.000                                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    -0.236                                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    -0.382                                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    -0.500                                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    -0.618                                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    -1.000                                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    -1.618                                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    -3.141                                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
pa-zigzag-fibonacci-fan-spy-1d-2026-10-03    AMEX:SPY 1D      9      DIVERGE        0.000: bar 253 t=1596720600 na vendor=295.27999999999986 ours=na
    zigzag                                   MATCH         cmp 1800 ok 1659 warm 141/253 steady 0/1547 maxRel 0.00e+0
     0.000                                   DIVERGE       cmp 1800 ok 1685 warm 112/253 steady 3/1547 maxRel 0.00e+0 — 3 steady-state bars disagree; first at bar 253 (na: vendor 295.27999999999986 vs ours na) — scattered, last at bar 255
    -0.236                                   DIVERGE       cmp 1800 ok 1685 warm 112/253 steady 3/1547 maxRel 0.00e+0 — 3 steady-state bars disagree; first at bar 253 (na: vendor 325.38896 vs ours na) — scattered, last at bar 255
    -0.382                                   DIVERGE       cmp 1800 ok 1685 warm 112/253 steady 3/1547 maxRel 0.00e+0 — 3 steady-state bars disagree; first at bar 253 (na: vendor 328.94552000000004 vs ours na) — scattered, last at bar 255
    -0.500                                   DIVERGE       cmp 1800 ok 1685 warm 112/253 steady 3/1547 maxRel 0.00e+0 — 3 steady-state bars disagree; first at bar 253 (na: vendor 331.82000000000005 vs ours na) — scattered, last at bar 255
    -0.618                                   DIVERGE       cmp 1800 ok 1685 warm 112/253 steady 3/1547 maxRel 0.00e+0 — 3 steady-state bars disagree; first at bar 253 (na: vendor 334.69448000000006 vs ours na) — scattered, last at bar 255
    -1.000                                   DIVERGE       cmp 1800 ok 1685 warm 112/253 steady 3/1547 maxRel 0.00e+0 — 3 steady-state bars disagree; first at bar 253 (na: vendor 344.0000000000001 vs ours na) — scattered, last at bar 255
    -1.618                                   DIVERGE       cmp 1800 ok 1685 warm 112/253 steady 3/1547 maxRel 0.00e+0 — 3 steady-state bars disagree; first at bar 253 (na: vendor 359.0544800000002 vs ours na) — scattered, last at bar 255
    -3.141                                   DIVERGE       cmp 1800 ok 1685 warm 112/253 steady 3/1547 maxRel 0.00e+0 — 3 steady-state bars disagree; first at bar 253 (na: vendor 396.15476000000035 vs ours na) — scattered, last at bar 255
    objects                                  MATCH         neither side draws an object
parabolic-sar-rddt-1d-2026-10-03             NYSE:RDDT 1D     1      MATCH         all 2 items agree
    Parabolic SAR                            MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 108 paired slots; coordinates are NOT compared by v1
pivot-point-supertrend-rddt-1d-2026-09-27    NYSE:RDDT D      8      MATCH         all 9 items agree
    PP SuperTrend                            MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 2.90e-16
    Buy                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 1.90e-16
    Sell                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Shapes                                   MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Shapes                                   MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
pivot-point-supertrend-spy-1d-2026-10-03     AMEX:SPY 1D      8      MATCH         all 9 items agree
    PP SuperTrend                            MATCH         cmp 1800 ok 1299 warm 501/755 steady 0/1045 maxRel 3.00e-11
    Buy                                      MATCH         cmp 1800 ok 1796 warm 4/756 steady 0/1044 maxRel 5.25e-12
    Sell                                     MATCH         cmp 1800 ok 1797 warm 3/756 steady 0/1044 maxRel 3.41e-12
    Shapes                                   MATCH         cmp 1800 ok 1800 warm 0/4 steady 0/1796 maxRel 0.00e+0
    Shapes                                   MATCH         cmp 1800 ok 1800 warm 0/4 steady 0/1796 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/254 steady 0/1546 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/254 steady 0/1546 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/254 steady 0/1546 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
pmax-explorer-rddt-1d-2026-10-02             NYSE:RDDT 1D     7      DIVERGE       1 of 8 compared items diverge
    Buy                                      INCONCLUSIVE   — UNMAPPED — vendor title "Buy" is not unique in the study
    Sell                                     INCONCLUSIVE   — UNMAPPED — vendor title "Sell" is not unique in the study
    Buy                                      INCONCLUSIVE   — UNMAPPED — vendor title "Buy" is not unique in the study
    Sell                                     INCONCLUSIVE   — UNMAPPED — vendor title "Sell" is not unique in the study
    plot_12                                  INCONCLUSIVE   — UNMAPPED — title "" could not be paired unambiguously
    Moving Avg Line                          MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 6.81e-16
    PMax                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 8.62e-16
    objects                                  DIVERGE       TradingView holds 1 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 2 drawing steps (dropped: create:label ×1; pine:request)
pmax-explorer-spy-1d-2026-10-02              AMEX:SPY 1D      7      DIVERGE       Moving Avg Line: bar 10 t=1566307800 value vendor=289.7930889863884 ours=288.8980045454545
    Buy                                      INCONCLUSIVE   — UNMAPPED — vendor title "Buy" is not unique in the study
    Sell                                     INCONCLUSIVE   — UNMAPPED — vendor title "Sell" is not unique in the study
    Buy                                      INCONCLUSIVE   — UNMAPPED — vendor title "Buy" is not unique in the study
    Sell                                     INCONCLUSIVE   — UNMAPPED — vendor title "Sell" is not unique in the study
    plot_12                                  INCONCLUSIVE   — UNMAPPED — title "" could not be paired unambiguously
    Moving Avg Line                          DIVERGE       cmp 1800 ok 1715 warm 10/10 steady 75/1790 maxRel 3.78e-3 — 75 steady-state bars disagree; first at bar 10 (value: vendor 289.7930889863884 vs ours 288.8980045454545) — a CONVERGING PREFIX: bars 10..84 differ with |err| falling 8.95e-1 → 3.18e-7, then all 1715 later bars agree (the recursive-state-seeded-at-the-window signature)
    PMax                                     DIVERGE       cmp 1800 ok 149 warm 512/512 steady 1139/1288 maxRel 4.35e-16 — 1139 steady-state bars disagree; first at bar 512 (na: vendor 434.22262153541857 vs ours na) — persistent, last at bar 1799
    objects                                  DIVERGE       TradingView holds 1 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 2 drawing steps (dropped: create:label ×1; pine:request)
poor-man039s-volume-profile-rddt-1d-2026-09- NYSE:RDDT 1D     0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 2 paired slots; coordinates are NOT compared by v1
poor-man039s-volume-profile-spy-1d-2026-10-0 AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 2 paired slots; coordinates are NOT compared by v1
position-size-calc-rddt-1d-2026-09-28        NYSE:RDDT 1D     0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 21 paired slots; coordinates are NOT compared by v1
position-size-calc-spy-1d-2026-10-03         AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 21 paired slots; coordinates are NOT compared by v1
position-size-calculator-rddt-1d-2026-09-28  NYSE:RDDT 1D     3      MATCH         all 4 items agree
    Entry                                    MATCH         cmp 612 ok 612 warm 0/0 steady 0/612 maxRel 0.00e+0
    TP                                       MATCH         cmp 612 ok 612 warm 0/0 steady 0/612 maxRel 0.00e+0
    SL                                       MATCH         cmp 612 ok 612 warm 0/0 steady 0/612 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 8 paired slots; coordinates are NOT compared by v1
position-size-calculator-spy-1d-2026-10-03   AMEX:SPY 1D      3      MATCH         all 4 items agree
    Entry                                    MATCH         cmp 1780 ok 1780 warm 0/20 steady 0/1760 maxRel 0.00e+0
    TP                                       MATCH         cmp 1780 ok 1780 warm 0/20 steady 0/1760 maxRel 0.00e+0
    SL                                       MATCH         cmp 1780 ok 1780 warm 0/20 steady 0/1760 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 8 paired slots; coordinates are NOT compared by v1
price-action-as-in-book-fibonacci-supportres NYSE:RDDT 1D     2      MATCH         all 3 items agree
    Pivot High                               MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Pivot Low                                MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 212 paired slots; coordinates are NOT compared by v1
price-action-as-in-book-fibonacci-supportres AMEX:SPY 1D      2      DIVERGE       1 of 3 compared items diverge
    Pivot High                               MATCH         cmp 1800 ok 1800 warm 0/15 steady 0/1785 maxRel 0.00e+0
    Pivot Low                                MATCH         cmp 1800 ok 1799 warm 1/15 steady 0/1785 maxRel 0.00e+0
    objects                                  DIVERGE       1 object families differ (count or text); colours agree on 514 paired slots; coordinates are NOT compared by v1
pro-trading-art-double-top-bottom-with-alert NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 35 paired slots; coordinates are NOT compared by v1
pro-trading-art-double-top-bottom-with-alert AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       3 object families differ (count or text); colours agree on 65 paired slots; coordinates are NOT compared by v1
probe-default-colour-v3-rddt-1d-2026-09-27   NYSE:RDDT D      3      MATCH         all 4 items agree
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Shapes                                   MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Chars                                    MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
probe-default-colour-v4-rddt-1d-2026-09-27   NYSE:RDDT D      3      MATCH         all 4 items agree
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Shapes                                   MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Chars                                    MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
probe-default-colour-v6-rddt-1d-2026-09-27   NYSE:RDDT D      3      MATCH         all 4 items agree
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Shapes                                   MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Chars                                    MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
probe-sparse-rows-rddt-1d-2026-09-27         NYSE:RDDT D      1      MATCH         all 2 items agree
    odd                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
qqe-signals-rddt-1d-2026-09-27               NYSE:RDDT D      2      MATCH         all 3 items agree
    QQE long                                 MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 1.37e-14
    QQE short                                MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 4.91e-15
    objects                                  MATCH         neither side draws an object
qqe-signals-spy-1d-2026-10-03                AMEX:SPY 1D      2      MATCH         all 3 items agree
    QQE long                                 MATCH         cmp 1800 ok 1781 warm 19/826 steady 0/974 maxRel 1.09e-13
    QQE short                                MATCH         cmp 1800 ok 1781 warm 19/826 steady 0/974 maxRel 1.54e-13
    objects                                  MATCH         neither side draws an object
r1-strategy-draws-indicator-rddt-1d-2026-10- NYSE:RDDT 1D     5      MATCH         all 6 items agree
    N01_bar_index_CONTROL                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    N02_fast                                 MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 8.38e-16
    N03_crosses_var                          MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    N04_lastCross_var                        MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    N05_cross_shape                          MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
r1-strategy-draws-rddt-1d-2026-10-02         NYSE:RDDT 1D     5      DIVERGE       N01_bar_index_CONTROL: bar 635 t=1790947800 na vendor=na ours=635
    N01_bar_index_CONTROL                    DIVERGE       cmp 636 ok 635 warm 0/0 steady 1/636 maxRel 0.00e+0 — 1 steady-state bars disagree; first at bar 635 (na: vendor na vs ours 635) — persistent, last at bar 635
    N02_fast                                 DIVERGE       cmp 636 ok 635 warm 0/0 steady 1/636 maxRel 8.38e-16 — 1 steady-state bars disagree; first at bar 635 (na: vendor na vs ours 145.65400000000002) — persistent, last at bar 635
    N03_crosses_var                          DIVERGE       cmp 636 ok 635 warm 0/0 steady 1/636 maxRel 0.00e+0 — 1 steady-state bars disagree; first at bar 635 (na: vendor na vs ours 19) — persistent, last at bar 635
    N04_lastCross_var                        DIVERGE       cmp 636 ok 635 warm 0/0 steady 1/636 maxRel 0.00e+0 — 1 steady-state bars disagree; first at bar 635 (na: vendor na vs ours 152.72) — persistent, last at bar 635
    N05_cross_shape                          MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
renko-candles-overlay-rddt-1d-2026-10-03     NYSE:RDDT 1D     0      MATCH         all 2 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 290 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
renko-candles-overlay-spy-1d-2026-10-03      AMEX:SPY 1D      0      INCONCLUSIVE  1 of 2 items could not be compared
    objects                                  INCONCLUSIVE  our object lane did not run: the run drew nothing
    paints                                   MATCH         1 paint agree bar for bar
request-realtime-alignment-spy-5-2026-10-01  AMEX:SPY 5       8      DIVERGE       R1_close_D_lookahead_ON: bar 0 t=1790605500 na vendor=765.61 ours=na
    R1_close_D_lookahead_ON                  DIVERGE       cmp 300 ok 0 warm 0/0 steady 300/300 maxRel 0.00e+0 — 300 steady-state bars disagree; first at bar 0 (na: vendor 765.61 vs ours na) — persistent, last at bar 299
    R2_close_D_lookahead_OFF                 DIVERGE       cmp 300 ok 0 warm 0/0 steady 300/300 maxRel 0.00e+0 — 300 steady-state bars disagree; first at bar 0 (na: vendor 771.35 vs ours na) — persistent, last at bar 299
    R3_DELTA_on_minus_off                    DIVERGE       cmp 300 ok 0 warm 0/0 steady 300/300 maxRel 0.00e+0 — 300 steady-state bars disagree; first at bar 0 (na: vendor -5.740000000000009 vs ours na) — persistent, last at bar 299
    R4_isrealtime                            MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    R5_islast                                MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    R6_chart_close                           MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    R7_prev_D_close_OFF                      DIVERGE       cmp 300 ok 0 warm 1/1 steady 299/299 maxRel 0.00e+0 — 299 steady-state bars disagree; first at bar 1 (na: vendor 767.18 vs ours na) — persistent, last at bar 299
    R8_bar_index_CONTROL                     INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    objects                                  MATCH         neither side draws an object
request-realtime-alignment-spy-5-b-2026-10-0 AMEX:SPY 5       8      DIVERGE       R1_close_D_lookahead_ON: bar 0 t=1790605500 na vendor=765.61 ours=na
    R1_close_D_lookahead_ON                  DIVERGE       cmp 301 ok 0 warm 0/0 steady 301/301 maxRel 0.00e+0 — 301 steady-state bars disagree; first at bar 0 (na: vendor 765.61 vs ours na) — persistent, last at bar 300
    R2_close_D_lookahead_OFF                 DIVERGE       cmp 301 ok 0 warm 0/0 steady 301/301 maxRel 0.00e+0 — 301 steady-state bars disagree; first at bar 0 (na: vendor 771.35 vs ours na) — persistent, last at bar 300
    R3_DELTA_on_minus_off                    DIVERGE       cmp 301 ok 0 warm 0/0 steady 301/301 maxRel 0.00e+0 — 301 steady-state bars disagree; first at bar 0 (na: vendor -5.740000000000009 vs ours na) — persistent, last at bar 300
    R4_isrealtime                            DIVERGE       cmp 301 ok 300 warm 0/0 steady 1/301 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 299 (value: vendor 1 vs ours 0) — scattered, last at bar 299
    R5_islast                                DIVERGE       cmp 301 ok 300 warm 0/0 steady 1/301 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 299 (value: vendor 1 vs ours 0) — scattered, last at bar 299
    R6_chart_close                           MATCH         cmp 301 ok 301 warm 0/0 steady 0/301 maxRel 0.00e+0
    R7_prev_D_close_OFF                      DIVERGE       cmp 301 ok 0 warm 1/1 steady 300/300 maxRel 0.00e+0 — 300 steady-state bars disagree; first at bar 1 (na: vendor 767.18 vs ours na) — persistent, last at bar 300
    R8_bar_index_CONTROL                     INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    objects                                  MATCH         neither side draws an object
reverse-stochastic-momentum-index-on-chart-r NYSE:RDDT 1D     7      MATCH         all 8 items agree
    Scale High                               MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.47e-15
    High Alert                               MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.03e-14
    Low Alert                                MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 8.93e-14
    Scale Low                                MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    SMI EQ Price                             MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.75e-15
    Signal Line Cross                        MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 5.36e-15
    Zero Line Cross                          MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.46e-13
    objects                                  MATCH         object counts and texts agree; colours agree on 2 paired slots; coordinates are NOT compared by v1
reverse-stochastic-momentum-index-on-chart-s AMEX:SPY 1D      7      DIVERGE       Scale High: bar 42 t=1570195800 value vendor=410.6119730675616 ours=400.4662248791874
    Scale High                               DIVERGE       cmp 1800 ok 1544 warm 42/42 steady 214/1758 maxRel 1.00e+0 — 214 steady-state bars disagree; first at bar 42 (value: vendor 410.6119730675616 vs ours 400.4662248791874) — a CONVERGING PREFIX: bars 42..255 differ with |err| falling 1.01e+1 → 4.00e-7, then all 1544 later bars agree (the recursive-state-seeded-at-the-window signature)
    High Alert                               DIVERGE       cmp 1800 ok 1539 warm 42/42 steady 219/1758 maxRel 1.00e+0 — 219 steady-state bars disagree; first at bar 42 (value: vendor 336.29996712923906 vs ours 325.00645187819003) — a CONVERGING PREFIX: bars 42..260 differ with |err| falling 1.13e+1 → 2.98e-7, then all 1539 later bars agree (the recursive-state-seeded-at-the-window signature)
    Low Alert                                DIVERGE       cmp 1800 ok 1544 warm 42/42 steady 214/1758 maxRel 1.00e+0 — 214 steady-state bars disagree; first at bar 42 (value: vendor 237.21729254480897 vs ours 224.39342121019348) — a CONVERGING PREFIX: bars 42..268 (with agreeing bars inside the run) differ with |err| falling 1.28e+1 → 1.79e-7, then all 1531 later bars agree (the recursive-state-seeded-at-the-window signature)
    Scale Low                                DIVERGE       cmp 1800 ok 1591 warm 42/42 steady 167/1758 maxRel 1.00e+0 — 167 steady-state bars disagree; first at bar 42 (value: vendor 162.9052866064864 vs ours 148.9336482091961) — a CONVERGING PREFIX: bars 42..276 (with agreeing bars inside the run) differ with |err| falling 1.40e+1 → 1.03e-7, then all 1523 later bars agree (the recursive-state-seeded-at-the-window signature)
    SMI EQ Price                             DIVERGE       cmp 1800 ok 1574 warm 42/42 steady 184/1758 maxRel 1.00e+0 — 184 steady-state bars disagree; first at bar 42 (value: vendor 296.81542315248697 vs ours 298.19828670475675) — a CONVERGING PREFIX: bars 42..225 differ with |err| falling 1.38e+0 → 4.01e-7, then all 1574 later bars agree (the recursive-state-seeded-at-the-window signature)
    Signal Line Cross                        DIVERGE       cmp 1800 ok 1546 warm 55/55 steady 199/1745 maxRel 1.00e+0 — 199 steady-state bars disagree; first at bar 55 (value: vendor 275.11093331588313 vs ours 275.86594173557364) — a CONVERGING PREFIX: bars 55..253 differ with |err| falling 7.55e-1 → 3.28e-7, then all 1546 later bars agree (the recursive-state-seeded-at-the-window signature)
    Zero Line Cross                          DIVERGE       cmp 1800 ok 1535 warm 42/42 steady 223/1758 maxRel 1.00e+0 — 223 steady-state bars disagree; first at bar 42 (value: vendor 286.758629837024 vs ours 274.69993654419176) — a CONVERGING PREFIX: bars 42..264 differ with |err| falling 1.21e+1 → 2.31e-7, then all 1535 later bars agree (the recursive-state-seeded-at-the-window signature)
    objects                                  MATCH         object counts and texts agree; colours agree on 2 paired slots; coordinates are NOT compared by v1
rolling-vwap-rddt-1d-2026-10-03              NYSE:RDDT 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:module) [runtime declined: runtime:library]: importing another script pulls in code this engine never sees — the library `PineCoders/ConditionalAverages/2` is not in this engine's library registry, so its code cannot be compiled
rolling-vwap-spy-1d-2026-10-03               AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:module) [runtime declined: runtime:library]: importing another script pulls in code this engine never sees — the library `PineCoders/ConditionalAverages/2` is not in this engine's library registry, so its code cannot be compiled
rsi-horizontal-resistance-levels-rddt-1d-202 NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 5 paired slots; coordinates are NOT compared by v1
rsi-horizontal-resistance-levels-spy-1d-2026 AMEX:SPY 1D      0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 5 paired slots; coordinates are NOT compared by v1
rsi-swing-indicator-rddt-1d-2026-09-28       NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 32 paired slots; 1 slot on objects neither side draws not graded; coordinates are NOT compared by v1
rsi-swing-indicator-spy-1d-2026-10-03        AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       3 object families differ (count or text); colours agree on 127 paired slots; coordinates are NOT compared by v1
rt1-na-test-v4-rddt-1d-2026-10-02            NYSE:RDDT 1D     6      INCONCLUSIVE  1 of 7 items could not be compared
    A00_bar_index_CONTROL                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A01_cmp_na_test                          MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A02_cross_na_test                        MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A03_float_nonzero_control                MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A04_history_na_test                      MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A05_na_bool_test                         INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
rt1-na-test-v5-rddt-1d-2026-10-02            NYSE:RDDT 1D     6      INCONCLUSIVE  1 of 7 items could not be compared
    A00_bar_index_CONTROL                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A01_cmp_na_test                          MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A02_cross_na_test                        MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A03_float_nonzero_control                MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A04_history_na_test                      MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A05_na_bool_test                         INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
rt1-na-test-v6-rddt-1d-2026-10-02            NYSE:RDDT 1D     5      MATCH         all 6 items agree
    A00_bar_index_CONTROL                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A01_cmp_na_test                          MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A02_cross_na_test                        MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A03_float_nonzero_control                MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A04_history_na_test                      MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
rt3-na-logic-rddt-1d-2026-10-02              NYSE:RDDT 1D     11     INCONCLUSIVE  4 of 12 items could not be compared
    B00_bar_index_CONTROL                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B01_naBool_or_true                       INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B02_not_naBool                           MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B03_naBool_and_true_CONTROL              MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B04_na_of_naBool_or_false                MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B05_na_of_not_naBool                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B06_naLiteral_or_true                    INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B07_not_naLiteral                        INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B08_naFloat_or_false                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B09_naFloat_or_true                      INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B10_not_naFloat                          MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
rt3-na-logic-v4-rddt-1d-2026-10-02           NYSE:RDDT 1D     11     INCONCLUSIVE  4 of 12 items could not be compared
    B00_bar_index_CONTROL                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B01_naBool_or_true                       INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B02_not_naBool                           MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B03_naBool_and_true_CONTROL              MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B04_na_of_naBool_or_false                MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B05_na_of_not_naBool                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B06_naLiteral_or_true                    INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B07_not_naLiteral                        INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B08_naFloat_or_false                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B09_naFloat_or_true                      INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B10_not_naFloat                          MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
rvol-rddt-1d-2026-09-27                      NYSE:RDDT D      2      MATCH         all 3 items agree
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
rvol-spy-1d-2026-10-03                       AMEX:SPY 1D      2      MATCH         all 3 items agree
    Plot                                     MATCH         cmp 1800 ok 1780 warm 20/37 steady 0/1763 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
sector-rotation-rddt-1d-2026-09-28           NYSE:RDDT 1D     1      DIVERGE       1 of 2 compared items diverge
    Current Symbol Percentage Change         MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.95e-16
    objects                                  DIVERGE       2 object families differ (count or text); no colour slot was paired, so no colour was graded; coordinates are NOT compared by v1
sector-rotation-spy-1d-2026-10-03            AMEX:SPY 1D      1      DIVERGE       1 of 2 compared items diverge
    Current Symbol Percentage Change         MATCH         cmp 1800 ok 1799 warm 1/1 steady 0/1799 maxRel 1.95e-16
    objects                                  DIVERGE       2 object families differ (count or text); no colour slot was paired, so no colour was graded; coordinates are NOT compared by v1
smt-divergence-ict-01-tradingfinder-smart-mo NYSE:RDDT 1D     0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       3 object families differ (count or text); no colour slot was paired, so no colour was graded; coordinates are NOT compared by v1
smt-divergence-ict-01-tradingfinder-smart-mo AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       3 object families differ (count or text); no colour slot was paired, so no colour was graded; coordinates are NOT compared by v1
sonarlab-order-blocks-aapl-1d-2026-10-02     NASDAQ:AAPL 1D   0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       TradingView holds 17 drawing object(s) at the last bar and our drawing is withheld by name (objects:off-listing) — the box drawings live in a `var` list, and on a chart that does not start at the symbol's listing the objects earlier bars put there are not knowable
sonarlab-order-blocks-brk-a-1d-2026-10-02    NYSE:BRK.A 1D    0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       TradingView holds 24 drawing object(s) at the last bar and our drawing is withheld by name (objects:off-listing) — the box drawings live in a `var` list, and on a chart that does not start at the symbol's listing the objects earlier bars put there are not knowable
sonarlab-order-blocks-rddt-1d-2026-10-02     NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 10 paired slots; coordinates are NOT compared by v1
sonarlab-order-blocks-spy-1d-2026-10-02      AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       TradingView holds 24 drawing object(s) at the last bar and our drawing is withheld by name (objects:off-listing) — the box drawings live in a `var` list, and on a chart that does not start at the symbol's listing the objects earlier bars put there are not knowable
supertrend-kivancozbilgic-rddt-1d-2026-10-02 NYSE:RDDT 1D     7      INCONCLUSIVE  1 of 8 items could not be compared
    Up Trend                                 MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.71e-16
    UpTrend Begins                           MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.50e-16
    Buy                                      MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.50e-16
    Down Trend                               MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.13e-16
    DownTrend Begins                         MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.08e-16
    Sell                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.08e-16
    plot_6                                   INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (fill-anchor))
    objects                                  MATCH         neither side draws an object
supertrend-strategy-rddt-1d-2026-10-02       NYSE:RDDT 1D     7      DIVERGE       1 of 9 compared items diverge
    Up Trend                                 MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.71e-16
    UpTrend Begins                           MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.50e-16
    Buy                                      MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Down Trend                               MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.13e-16
    DownTrend Begins                         MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.08e-16
    Sell                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    plot_6                                   INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (fill-anchor))
    objects                                  MATCH         neither side draws an object
    paints                                   DIVERGE       1 paint differs (first: barcolor plot_9 "Bar Color" withheld (`barcolor`'s colour is an expression this door cannot carry yet))
supertrend-strategy-spy-1d-2026-10-02        AMEX:SPY 1D      7      DIVERGE       1 of 9 compared items diverge
    Up Trend                                 MATCH         cmp 1800 ok 1619 warm 181/512 steady 0/1288 maxRel 3.50e-16
    UpTrend Begins                           MATCH         cmp 1800 ok 1794 warm 6/513 steady 0/1287 maxRel 3.50e-16
    Buy                                      MATCH         cmp 1800 ok 1800 warm 0/513 steady 0/1287 maxRel 0.00e+0
    Down Trend                               MATCH         cmp 1800 ok 1690 warm 110/512 steady 0/1288 maxRel 8.28e-16
    DownTrend Begins                         MATCH         cmp 1800 ok 1794 warm 6/513 steady 0/1287 maxRel 1.64e-16
    Sell                                     MATCH         cmp 1800 ok 1800 warm 0/513 steady 0/1287 maxRel 0.00e+0
    plot_6                                   INCONCLUSIVE  cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (fill-anchor))
    objects                                  MATCH         neither side draws an object
    paints                                   DIVERGE       1 paint differs (first: barcolor plot_9 "Bar Color" withheld (`barcolor`'s colour is an expression this door cannot carry yet))
support-and-resistance-multi-time-frame-rddt NYSE:RDDT 1D     6      DIVERGE       Resistance Weekly: bar 161 t=1731076200 na vendor=134.8 ours=na
    Resistance Daily                         MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Support Daily                            MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Resistance Weekly                        DIVERGE       cmp 636 ok 621 warm 0/0 steady 15/636 maxRel 1.23e-1 — 15 steady-state bars disagree; first at bar 161 (na: vendor 134.8 vs ours na) — scattered, last at bar 375
    Support Weekly                           DIVERGE       cmp 636 ok 633 warm 0/0 steady 3/636 maxRel 5.98e-2 — 3 steady-state bars disagree; first at bar 476 (na: vendor 127.705 vs ours na) — scattered, last at bar 509
    Resistance Monthly                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Support Monthly                          MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
support-and-resistance-multi-time-frame-spy- AMEX:SPY 1D      6      DIVERGE       Resistance Daily: bar 34 t=1569331800 na vendor=302.63 ours=na
    Resistance Daily                         DIVERGE       cmp 1800 ok 1742 warm 34/34 steady 24/1766 maxRel 0.00e+0 — 24 steady-state bars disagree; first at bar 34 (na: vendor 302.63 vs ours na) — scattered, last at bar 57
    Support Daily                            DIVERGE       cmp 1800 ok 1661 warm 34/34 steady 105/1766 maxRel 0.00e+0 — 105 steady-state bars disagree; first at bar 34 (na: vendor 281.72 vs ours na) — scattered, last at bar 138
    Resistance Weekly                        DIVERGE       cmp 1800 ok 1418 warm 175/175 steady 207/1625 maxRel 1.41e-1 — 207 steady-state bars disagree; first at bar 175 (na: vendor 339.08 vs ours na) — scattered, last at bar 1765
    Support Weekly                           DIVERGE       cmp 1800 ok 1627 warm 163/175 steady 10/1625 maxRel 4.68e-1 — 10 steady-state bars disagree; first at bar 645 (value: vendor 410.64 vs ours 218.26) — scattered, last at bar 1673
    Resistance Monthly                       DIVERGE       cmp 1800 ok 648 warm 735/735 steady 417/1065 maxRel 5.05e-2 — 417 steady-state bars disagree; first at bar 735 (na: vendor 479.98 vs ours na) — scattered, last at bar 1776
    Support Monthly                          DIVERGE       cmp 1800 ok 0 warm 735/735 steady 1065/1065 maxRel 0.00e+0 — 1065 steady-state bars disagree; first at bar 735 (na: vendor 218.26 vs ours na) — persistent, last at bar 1799
    objects                                  MATCH         neither side draws an object
support-and-resistance-rddt-1d-2026-10-02    NYSE:RDDT 1D     2      MATCH         all 3 items agree
    Plot                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Plot                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
support-and-resistance-spy-1d-2026-10-02     AMEX:SPY 1D      2      DIVERGE       Plot: bar 20 t=1567603800 na vendor=302.23 ours=na
    Plot                                     DIVERGE       cmp 1800 ok 1758 warm 20/20 steady 22/1780 maxRel 0.00e+0 — 22 steady-state bars disagree; first at bar 20 (na: vendor 302.23 vs ours na) — scattered, last at bar 41
    Plot                                     DIVERGE       cmp 1800 ok 1748 warm 20/20 steady 32/1780 maxRel 0.00e+0 — 32 steady-state bars disagree; first at bar 20 (na: vendor 281.72 vs ours na) — scattered, last at bar 51
    objects                                  MATCH         neither side draws an object
swing-highlow-zigzag-chartprime-rddt-1d-2026 NYSE:RDDT 1D     1      MATCH         all 2 items agree
    Plot                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 18 paired slots (3 theme-relative); 1 slot on objects neither side draws not graded; coordinates are NOT compared by v1
swing-highlow-zigzag-chartprime-spy-1d-2026- AMEX:SPY 1D      1      DIVERGE       1 of 2 compared items diverge
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  DIVERGE       1 object families differ (count or text); colours agree on 21 paired slots (3 theme-relative); coordinates are NOT compared by v1
syminfo-roster-aapl-1d-2026-09-30            NASDAQ:AAPL 1D   0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: `syminfo.type` is a Pine built-in this engine holds no VALUE for, though it holds its sibling `syminfo.ticker`: what kind of instrument the symbol is (`stock`, `fund`, `crypto`…). ⭐ MEASURED 2026-09-30 (`tests/fixtures/vendor/harness/syminfo-roster-*-1d-2026-09-30.json`, S6/S8): AAPL, BRK.B and F answer `stock`, SPY answers a 4-character type that is NOT `stock` (a fund), and our symbol store holds no stock-vs-fund fact for a listing — so an answer served per exchange would call SPY a stock. It is refused until the store can tell the two apart exactly, per instrument, never per exchange.
syminfo-roster-bitstamp-btcusd-1d-2026-09-30 BITSTAMP:BTCUSD  0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: `syminfo.type` is a Pine built-in this engine holds no VALUE for, though it holds its sibling `syminfo.ticker`: what kind of instrument the symbol is (`stock`, `fund`, `crypto`…). ⭐ MEASURED 2026-09-30 (`tests/fixtures/vendor/harness/syminfo-roster-*-1d-2026-09-30.json`, S6/S8): AAPL, BRK.B and F answer `stock`, SPY answers a 4-character type that is NOT `stock` (a fund), and our symbol store holds no stock-vs-fund fact for a listing — so an answer served per exchange would call SPY a stock. It is refused until the store can tell the two apart exactly, per instrument, never per exchange.
syminfo-roster-brk-b-1d-2026-09-30           NYSE:BRK.B 1D    0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: `syminfo.type` is a Pine built-in this engine holds no VALUE for, though it holds its sibling `syminfo.ticker`: what kind of instrument the symbol is (`stock`, `fund`, `crypto`…). ⭐ MEASURED 2026-09-30 (`tests/fixtures/vendor/harness/syminfo-roster-*-1d-2026-09-30.json`, S6/S8): AAPL, BRK.B and F answer `stock`, SPY answers a 4-character type that is NOT `stock` (a fund), and our symbol store holds no stock-vs-fund fact for a listing — so an answer served per exchange would call SPY a stock. It is refused until the store can tell the two apart exactly, per instrument, never per exchange.
syminfo-roster-f-1d-2026-09-30               NYSE:F 1D        0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: `syminfo.type` is a Pine built-in this engine holds no VALUE for, though it holds its sibling `syminfo.ticker`: what kind of instrument the symbol is (`stock`, `fund`, `crypto`…). ⭐ MEASURED 2026-09-30 (`tests/fixtures/vendor/harness/syminfo-roster-*-1d-2026-09-30.json`, S6/S8): AAPL, BRK.B and F answer `stock`, SPY answers a 4-character type that is NOT `stock` (a fund), and our symbol store holds no stock-vs-fund fact for a listing — so an answer served per exchange would call SPY a stock. It is refused until the store can tell the two apart exactly, per instrument, never per exchange.
syminfo-roster-spy-1d-2026-09-30             AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: `syminfo.type` is a Pine built-in this engine holds no VALUE for, though it holds its sibling `syminfo.ticker`: what kind of instrument the symbol is (`stock`, `fund`, `crypto`…). ⭐ MEASURED 2026-09-30 (`tests/fixtures/vendor/harness/syminfo-roster-*-1d-2026-09-30.json`, S6/S8): AAPL, BRK.B and F answer `stock`, SPY answers a 4-character type that is NOT `stock` (a fund), and our symbol store holds no stock-vs-fund fact for a listing — so an answer served per exchange would call SPY a stock. It is refused until the store can tell the two apart exactly, per instrument, never per exchange.
tradingview-alerts-to-mt4-mt5-forex-indices- NYSE:RDDT 1D     2      MATCH         all 3 items agree
    %K                                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.86e-15
    %D                                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.61e-15
    objects                                  MATCH         neither side draws an object
tradingview-alerts-to-mt4-mt5-forex-indices- AMEX:SPY 1D      2      MATCH         all 3 items agree
    %K                                       MATCH         cmp 1800 ok 1785 warm 15/17 steady 0/1783 maxRel 4.46e-15
    %D                                       MATCH         cmp 1800 ok 1783 warm 17/20 steady 0/1780 maxRel 1.16e-14
    objects                                  MATCH         neither side draws an object
tradingview-alerts-to-mt4-mt5-strategy-examp NYSE:RDDT 1D     2      MATCH         all 3 items agree
    %K                                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.86e-15
    %D                                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.61e-15
    objects                                  MATCH         object counts and texts agree; colours agree on 11 paired slots; coordinates are NOT compared by v1
tradingview-alerts-to-mt4-mt5-strategy-examp AMEX:SPY 1D      2      MATCH         all 3 items agree
    %K                                       MATCH         cmp 1800 ok 1785 warm 15/17 steady 0/1783 maxRel 4.46e-15
    %D                                       MATCH         cmp 1800 ok 1783 warm 17/20 steady 0/1780 maxRel 1.16e-14
    objects                                  MATCH         object counts and texts agree; colours agree on 11 paired slots; coordinates are NOT compared by v1
trend-duration-forecast-chartprime-rddt-1d-2 NYSE:RDDT 1D     1      MATCH         all 2 items agree
    HMA                                      MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 126 paired slots (22 theme-relative); coordinates are NOT compared by v1
trend-duration-forecast-chartprime-spy-1d-20 AMEX:SPY 1D      1      DIVERGE       1 of 2 compared items diverge
    HMA                                      MATCH         cmp 1800 ok 1745 warm 55/100 steady 0/1700 maxRel 0.00e+0
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 174 paired slots (22 theme-relative); coordinates are NOT compared by v1
trend-lines-supports-and-resistances-rddt-1d NYSE:RDDT 1D     2      DIVERGE       1 of 3 compared items diverge
    High Pivots                              MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Low Pivots                               MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 14 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 6 drawing steps (dropped: never carried: box.new, label.delete, label.new, line.delete, line.new, line.set_color, line.set_extend, line.set_style)
trend-lines-supports-and-resistances-spy-1d- AMEX:SPY 1D      2      DIVERGE       1 of 3 compared items diverge
    High Pivots                              MATCH         cmp 1800 ok 1800 warm 0/40 steady 0/1760 maxRel 0.00e+0
    Low Pivots                               MATCH         cmp 1800 ok 1800 warm 0/40 steady 0/1760 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 11 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 6 drawing steps (dropped: never carried: box.new, label.delete, label.new, line.delete, line.new, line.set_color, line.set_extend, line.set_style)
trend-targets-algoalpha-rddt-1d-2026-10-02   NYSE:RDDT 1D     5      DIVERGE       Baseline: bar 140 t=1728567000 na vendor=59.7746204320142 ours=na
    Bullish Rejection                        MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.95e-16
    Bearish Rejection                        MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 9.84e-14
    Baseline                                 DIVERGE       cmp 636 ok 554 warm 0/0 steady 82/636 maxRel 2.96e-4 — 82 steady-state bars disagree; first at bar 140 (na: vendor 59.7746204320142 vs ours na) — scattered, last at bar 221
    Bullish Trend Change                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 4.59e-15
    Bearish Trend Change                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 5.28e-11
    objects                                  MATCH         object counts and texts agree; colours agree on 15 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
trend-targets-algoalpha-spy-1d-2026-10-02    AMEX:SPY 1D      5      INCONCLUSIVE  6 of 7 items could not be compared
    Bullish Rejection                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for value
    Bearish Rejection                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2
    Baseline                                 INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3
    Bullish Trend Change                     INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4
    Bearish Trend Change                     INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out5
    objects                                  INCONCLUSIVE  our object lane did not run: withheld by name (runtime:objects-without-run) — This script's drawings are not drawn: its run computed nothing on this chart (runtime:warmup-never-converges), and its drawings belong to that run — drawn alone they would be a picture TradingView does not draw. Nothing is drawn rather than a guess.
    paints                                   MATCH         1 paint agree bar for bar
trendlines-rddt-1d-2026-09-27                NYSE:RDDT D      8      MATCH         all 9 items agree
    Pivot High                               MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Pivot Low                                MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Resistance Trendline                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Support Trendline                        MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Long Break                               MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Short Break                              MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 5 paired slots; 2 slots on objects neither side draws not graded; coordinates are NOT compared by v1
trendlines-spy-1d-2026-10-03                 AMEX:SPY 1D      8      DIVERGE       Resistance Trendline: bar 874 t=1674657000 na vendor=538.828275862069 ours=na
    Pivot High                               MATCH         cmp 1800 ok 1798 warm 2/115 steady 0/1685 maxRel 0.00e+0
    Pivot Low                                MATCH         cmp 1800 ok 1800 warm 0/115 steady 0/1685 maxRel 0.00e+0
    Resistance Trendline                     DIVERGE       cmp 1800 ok 1492 warm 287/365 steady 21/1435 maxRel 1.38e-15 — 21 steady-state bars disagree; first at bar 874 (na: vendor 538.828275862069 vs ours na) — scattered, last at bar 894
    Support Trendline                        DIVERGE       cmp 1800 ok 1042 warm 365/365 steady 393/1435 maxRel 1.50e-15 — 393 steady-state bars disagree; first at bar 365 (na: vendor 207.94327974276524 vs ours na) — scattered, last at bar 1439
    Long Break                               MATCH         cmp 1800 ok 1797 warm 3/366 steady 0/1434 maxRel 0.00e+0
    Short Break                              MATCH         cmp 1800 ok 1800 warm 0/366 steady 0/1434 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1798 warm 2/115 steady 0/1685 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/115 steady 0/1685 maxRel 0.00e+0
    objects                                  DIVERGE       1 object families differ (count or text); colours agree on 23 paired slots; coordinates are NOT compared by v1
twin-range-filter-rddt-1d-2026-10-02         NYSE:RDDT 1D     2      DIVERGE       Long: bar 177 t=1733236200 na vendor=1 ours=na
    Long                                     DIVERGE       cmp 636 ok 631 warm 0/0 steady 5/636 maxRel 0.00e+0 — 5 steady-state bars disagree; first at bar 177 (na: vendor 1 vs ours na) — scattered, last at bar 243
    Short                                    DIVERGE       cmp 636 ok 630 warm 0/0 steady 6/636 maxRel 0.00e+0 — 6 steady-state bars disagree; first at bar 171 (na: vendor 1 vs ours na) — scattered, last at bar 247
    objects                                  MATCH         neither side draws an object
twin-range-filter-spy-1d-2026-10-02          AMEX:SPY 1D      2      MATCH         all 3 items agree
    Long                                     MATCH         cmp 1800 ok 1781 warm 19/917 steady 0/883 maxRel 0.00e+0
    Short                                    MATCH         cmp 1800 ok 1782 warm 18/917 steady 0/883 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
ultimate-pivot-points-rddt-1d-2026-09-28     NYSE:RDDT 1D     3      MATCH         all 4 items agree
    PD_H                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    PD_L                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Pivot                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 102 paired slots; 51 slots on objects neither side draws not graded; coordinates are NOT compared by v1
ultimate-pivot-points-spy-1d-2026-10-03      AMEX:SPY 1D      3      MATCH         all 4 items agree
    PD_H                                     MATCH         cmp 1800 ok 1799 warm 1/1 steady 0/1799 maxRel 0.00e+0
    PD_L                                     MATCH         cmp 1800 ok 1799 warm 1/1 steady 0/1799 maxRel 0.00e+0
    Pivot                                    MATCH         cmp 1800 ok 1799 warm 1/1 steady 0/1799 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 102 paired slots; 51 slots on objects neither side draws not graded; coordinates are NOT compared by v1
vdubus-pattern-gen-v2-restored-refined-rddt- NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 122 paired slots; coordinates are NOT compared by v1
vdubus-pattern-gen-v2-restored-refined-spy-1 AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       3 object families differ (count or text); 1 object family differs in COLOUR (first: line.color of line #35 — vendor #ff9800ff, ours #ff980000, carriedDiffers); coordinates are NOT compared by v1
vold-market-breadth-rddt-1d-2026-09-28       NYSE:RDDT 1D     0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 2 paired slots; coordinates are NOT compared by v1
vold-market-breadth-spy-1d-2026-10-03        AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 2 paired slots; coordinates are NOT compared by v1
volume-profile-rddt-1d-2026-09-28            NYSE:RDDT 1D     0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       1 object families differ (count or text); no colour slot was paired, so no colour was graded; coordinates are NOT compared by v1
volume-profile-spy-1d-2026-10-03             AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       1 object families differ (count or text); no colour slot was paired, so no colour was graded; coordinates are NOT compared by v1
vw-arm-history-rddt-1d-2026-10-02            NYSE:RDDT 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:roundtrip) [runtime declined: runtime:statement]: the translator wrote formula text it could not read back, so it emitted none
vw-arm-history-spy-1d-2026-10-02             AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:roundtrip) [runtime declined: runtime:statement]: the translator wrote formula text it could not read back, so it emitted none
vw-array-na-spy-1d-2026-10-02                AMEX:SPY 1D      13     INCONCLUSIVE  13 of 14 items could not be compared
    N00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for value
    N01_min_with_na                          INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    N02_max_with_na                          INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    N03_sum_with_na                          INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    N04_avg_with_na                          INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    N05_min_all_na                           INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    N06_indexof_na                           INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2
    N07_includes_na                          INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3
    N08_indexof_of_min                       INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4
    N09_indexof_of_min_all_na                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out5
    N10_get_minus_one                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out6
    N11_vote_mixed_na                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out7
    N12_vote_all_na                          INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out8
    objects                                  MATCH         neither side draws an object
vw-bar-counters-rddt-15-2026-09-30           NYSE:RDDT 15     8      INCONCLUSIVE  1 of 9 items could not be compared
    C00_bar_index_CONTROL                    MATCH         cmp 16397 ok 16397 warm 0/0 steady 0/16397 maxRel 0.00e+0
    C01_var_n_plus_1                         MATCH         cmp 16397 ok 16397 warm 0/0 steady 0/16397 maxRel 0.00e+0
    C02_na_hist_seeded_counter               MATCH         cmp 16397 ok 16397 warm 0/0 steady 0/16397 maxRel 0.00e+0
    C03_var_compound                         MATCH         cmp 16397 ok 16397 warm 0/0 steady 0/16397 maxRel 0.00e+0
    C04_var_na_seed_counter                  MATCH         cmp 16397 ok 16397 warm 0/0 steady 0/16397 maxRel 0.00e+0
    C05_ta_cum_1                             INCONCLUSIVE  cmp 16397 ok 16397 warm 0/0 steady 0/16397 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C06_n1_minus_bar_index                   MATCH         cmp 16397 ok 16397 warm 0/0 steady 0/16397 maxRel 0.00e+0
    C07_n2_minus_bar_index                   MATCH         cmp 16397 ok 16397 warm 0/0 steady 0/16397 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-counters-rddt-1d-2026-09-30           NYSE:RDDT 1D     8      INCONCLUSIVE  1 of 9 items could not be compared
    C00_bar_index_CONTROL                    MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    C01_var_n_plus_1                         MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    C02_na_hist_seeded_counter               MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    C03_var_compound                         MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    C04_var_na_seed_counter                  MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    C05_ta_cum_1                             INCONCLUSIVE  cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C06_n1_minus_bar_index                   MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    C07_n2_minus_bar_index                   MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-counters-rddt-240-2026-09-30          NYSE:RDDT 240    8      INCONCLUSIVE  1 of 9 items could not be compared
    C00_bar_index_CONTROL                    MATCH         cmp 1262 ok 1262 warm 0/0 steady 0/1262 maxRel 0.00e+0
    C01_var_n_plus_1                         MATCH         cmp 1262 ok 1262 warm 0/0 steady 0/1262 maxRel 0.00e+0
    C02_na_hist_seeded_counter               MATCH         cmp 1262 ok 1262 warm 0/0 steady 0/1262 maxRel 0.00e+0
    C03_var_compound                         MATCH         cmp 1262 ok 1262 warm 0/0 steady 0/1262 maxRel 0.00e+0
    C04_var_na_seed_counter                  MATCH         cmp 1262 ok 1262 warm 0/0 steady 0/1262 maxRel 0.00e+0
    C05_ta_cum_1                             INCONCLUSIVE  cmp 1262 ok 1262 warm 0/0 steady 0/1262 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C06_n1_minus_bar_index                   MATCH         cmp 1262 ok 1262 warm 0/0 steady 0/1262 maxRel 0.00e+0
    C07_n2_minus_bar_index                   MATCH         cmp 1262 ok 1262 warm 0/0 steady 0/1262 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-counters-rddt-5-2026-09-30            NYSE:RDDT 5      8      DIVERGE       C01_var_n_plus_1: bar 250 t=1758811800 na vendor=251 ours=na
    C00_bar_index_CONTROL                    MATCH         cmp 20052 ok 20052 warm 0/0 steady 0/20052 maxRel 0.00e+0
    C01_var_n_plus_1                         DIVERGE       cmp 20052 ok 0 warm 250/250 steady 19802/19802 maxRel 0.00e+0 — 19802 steady-state bars disagree; first at bar 250 (na: vendor 251 vs ours na) — persistent, last at bar 20051
    C02_na_hist_seeded_counter               DIVERGE       cmp 20052 ok 0 warm 250/250 steady 19802/19802 maxRel 0.00e+0 — 19802 steady-state bars disagree; first at bar 250 (na: vendor 250 vs ours na) — persistent, last at bar 20051
    C03_var_compound                         DIVERGE       cmp 20052 ok 0 warm 250/250 steady 19802/19802 maxRel 0.00e+0 — 19802 steady-state bars disagree; first at bar 250 (na: vendor 251 vs ours na) — persistent, last at bar 20051
    C04_var_na_seed_counter                  DIVERGE       cmp 20052 ok 0 warm 250/250 steady 19802/19802 maxRel 0.00e+0 — 19802 steady-state bars disagree; first at bar 250 (na: vendor 250 vs ours na) — persistent, last at bar 20051
    C05_ta_cum_1                             INCONCLUSIVE  cmp 20052 ok 20052 warm 0/0 steady 0/20052 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C06_n1_minus_bar_index                   DIVERGE       cmp 20052 ok 0 warm 250/250 steady 19802/19802 maxRel 0.00e+0 — 19802 steady-state bars disagree; first at bar 250 (na: vendor 1 vs ours na) — persistent, last at bar 20051
    C07_n2_minus_bar_index                   DIVERGE       cmp 20052 ok 0 warm 250/250 steady 19802/19802 maxRel 0.00e+0 — 19802 steady-state bars disagree; first at bar 250 (na: vendor 0 vs ours na) — persistent, last at bar 20051
    objects                                  MATCH         neither side draws an object
vw-bar-counters-rddt-60-2026-09-30           NYSE:RDDT 60     8      INCONCLUSIVE  1 of 9 items could not be compared
    C00_bar_index_CONTROL                    MATCH         cmp 4417 ok 4417 warm 0/0 steady 0/4417 maxRel 0.00e+0
    C01_var_n_plus_1                         MATCH         cmp 4417 ok 4417 warm 0/0 steady 0/4417 maxRel 0.00e+0
    C02_na_hist_seeded_counter               MATCH         cmp 4417 ok 4417 warm 0/0 steady 0/4417 maxRel 0.00e+0
    C03_var_compound                         MATCH         cmp 4417 ok 4417 warm 0/0 steady 0/4417 maxRel 0.00e+0
    C04_var_na_seed_counter                  MATCH         cmp 4417 ok 4417 warm 0/0 steady 0/4417 maxRel 0.00e+0
    C05_ta_cum_1                             INCONCLUSIVE  cmp 4417 ok 4417 warm 0/0 steady 0/4417 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C06_n1_minus_bar_index                   MATCH         cmp 4417 ok 4417 warm 0/0 steady 0/4417 maxRel 0.00e+0
    C07_n2_minus_bar_index                   MATCH         cmp 4417 ok 4417 warm 0/0 steady 0/4417 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-counters-spy-1-2026-10-02             AMEX:SPY 1       8      DIVERGE       C01_var_n_plus_1: bar 250 t=1788201600 na vendor=12011 ours=na
    C00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    C01_var_n_plus_1                         DIVERGE       cmp 9300 ok 0 warm 250/250 steady 9050/9050 maxRel 0.00e+0 — 9050 steady-state bars disagree; first at bar 250 (na: vendor 12011 vs ours na) — persistent, last at bar 9299
    C02_na_hist_seeded_counter               DIVERGE       cmp 9300 ok 0 warm 250/250 steady 9050/9050 maxRel 0.00e+0 — 9050 steady-state bars disagree; first at bar 250 (na: vendor 12010 vs ours na) — persistent, last at bar 9299
    C03_var_compound                         DIVERGE       cmp 9300 ok 0 warm 250/250 steady 9050/9050 maxRel 0.00e+0 — 9050 steady-state bars disagree; first at bar 250 (na: vendor 12011 vs ours na) — persistent, last at bar 9299
    C04_var_na_seed_counter                  DIVERGE       cmp 9300 ok 0 warm 250/250 steady 9050/9050 maxRel 0.00e+0 — 9050 steady-state bars disagree; first at bar 250 (na: vendor 12010 vs ours na) — persistent, last at bar 9299
    C05_ta_cum_1                             DIVERGE       cmp 9300 ok 0 warm 0/0 steady 9300/9300 maxRel 1.00e+0 — 9300 steady-state bars disagree; first at bar 0 (value: vendor 11761 vs ours 1) — persistent, last at bar 9299
    C06_n1_minus_bar_index                   INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    C07_n2_minus_bar_index                   INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    objects                                  MATCH         neither side draws an object
vw-bar-counters-spy-30-2026-10-02            AMEX:SPY 30      8      DIVERGE       C01_var_n_plus_1: bar 250 t=1712842200 na vendor=13952 ours=na
    C00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    C01_var_n_plus_1                         DIVERGE       cmp 8300 ok 0 warm 250/250 steady 8050/8050 maxRel 0.00e+0 — 8050 steady-state bars disagree; first at bar 250 (na: vendor 13952 vs ours na) — persistent, last at bar 8299
    C02_na_hist_seeded_counter               DIVERGE       cmp 8300 ok 0 warm 250/250 steady 8050/8050 maxRel 0.00e+0 — 8050 steady-state bars disagree; first at bar 250 (na: vendor 13951 vs ours na) — persistent, last at bar 8299
    C03_var_compound                         DIVERGE       cmp 8300 ok 0 warm 250/250 steady 8050/8050 maxRel 0.00e+0 — 8050 steady-state bars disagree; first at bar 250 (na: vendor 13952 vs ours na) — persistent, last at bar 8299
    C04_var_na_seed_counter                  DIVERGE       cmp 8300 ok 0 warm 250/250 steady 8050/8050 maxRel 0.00e+0 — 8050 steady-state bars disagree; first at bar 250 (na: vendor 13951 vs ours na) — persistent, last at bar 8299
    C05_ta_cum_1                             DIVERGE       cmp 8300 ok 0 warm 0/0 steady 8300/8300 maxRel 1.00e+0 — 8300 steady-state bars disagree; first at bar 0 (value: vendor 13702 vs ours 1) — persistent, last at bar 8299
    C06_n1_minus_bar_index                   INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    C07_n2_minus_bar_index                   INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    objects                                  MATCH         neither side draws an object
vw-bar-origin-rddt-5-2026-10-02              NYSE:RDDT 5      11     DIVERGE       O03_bars_seen_by_a_var_counter: bar 250 t=1758811800 na vendor=251 ours=na
    O00_bar_index_CONTROL                    MATCH         cmp 20208 ok 20208 warm 0/0 steady 0/20208 maxRel 0.00e+0
    O01_last_bar_index                       MATCH         cmp 20208 ok 20208 warm 0/0 steady 0/20208 maxRel 0.00e+0
    O02_isfirst                              MATCH         cmp 20208 ok 20208 warm 0/0 steady 0/20208 maxRel 0.00e+0
    O03_bars_seen_by_a_var_counter           DIVERGE       cmp 20208 ok 0 warm 250/250 steady 19958/19958 maxRel 0.00e+0 — 19958 steady-state bars disagree; first at bar 250 (na: vendor 251 vs ours na) — persistent, last at bar 20207
    O04_bar_index_minus_counter_MUST_BE_MINU DIVERGE       cmp 20208 ok 0 warm 250/250 steady 19958/19958 maxRel 0.00e+0 — 19958 steady-state bars disagree; first at bar 250 (na: vendor -1 vs ours na) — persistent, last at bar 20207
    O05_bar_index_where_isfirst_was_true     DIVERGE       cmp 20208 ok 0 warm 250/250 steady 19958/19958 maxRel 0.00e+0 — 19958 steady-state bars disagree; first at bar 250 (na: vendor 0 vs ours na) — persistent, last at bar 20207
    O06_barssince_isfirst                    MATCH         cmp 20208 ok 20208 warm 0/0 steady 0/20208 maxRel 0.00e+0
    O07_first_bar_time_in_days               DIVERGE       cmp 20208 ok 1 warm 250/250 steady 19957/19958 maxRel 1.83e-2 — 19957 steady-state bars disagree; first at bar 251 (value: vendor 20353.5625 vs ours 20353.565972222223) — persistent, last at bar 20207
    O08_bar_index_mod_3                      MATCH         cmp 20208 ok 20208 warm 0/0 steady 0/20208 maxRel 0.00e+0
    O09_bar_index_gt_100                     MATCH         cmp 20208 ok 20208 warm 0/0 steady 0/20208 maxRel 0.00e+0
    O10_distance_MUST_BE_5                   MATCH         cmp 20208 ok 20208 warm 0/5 steady 0/20203 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-origin-rddt-60-2026-10-02             NYSE:RDDT 60     11     DIVERGE       O05_bar_index_where_isfirst_was_true: bar 0 t=1711038600 na vendor=0 ours=na
    O00_bar_index_CONTROL                    MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O01_last_bar_index                       MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O02_isfirst                              MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O03_bars_seen_by_a_var_counter           MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O04_bar_index_minus_counter_MUST_BE_MINU MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O05_bar_index_where_isfirst_was_true     DIVERGE       cmp 4431 ok 0 warm 0/0 steady 4431/4431 maxRel 0.00e+0 — 4431 steady-state bars disagree; first at bar 0 (na: vendor 0 vs ours na) — persistent, last at bar 4430
    O06_barssince_isfirst                    MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O07_first_bar_time_in_days               MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O08_bar_index_mod_3                      MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O09_bar_index_gt_100                     MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O10_distance_MUST_BE_5                   MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-origin-spy-1d-300-2026-10-02          AMEX:SPY 1D      11     DIVERGE       O02_isfirst: bar 0 t=1753450200 value vendor=0 ours=1
    O00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    O01_last_bar_index                       INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    O02_isfirst                              DIVERGE       cmp 300 ok 299 warm 0/0 steady 1/300 maxRel 0.00e+0 — 1 steady-state bars disagree; first at bar 0 (value: vendor 0 vs ours 1) — scattered, last at bar 0
    O03_bars_seen_by_a_var_counter           DIVERGE       cmp 300 ok 0 warm 250/250 steady 50/50 maxRel 0.00e+0 — 50 steady-state bars disagree; first at bar 250 (na: vendor 8428 vs ours na) — persistent, last at bar 299
    O04_bar_index_minus_counter_MUST_BE_MINU INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    O05_bar_index_where_isfirst_was_true     INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    O06_barssince_isfirst                    DIVERGE       cmp 300 ok 0 warm 0/0 steady 300/300 maxRel 1.00e+0 — 300 steady-state bars disagree; first at bar 0 (value: vendor 8177 vs ours 0) — persistent, last at bar 299
    O07_first_bar_time_in_days               DIVERGE       cmp 300 ok 0 warm 250/250 steady 50/50 maxRel 1.42e+0 — 50 steady-state bars disagree; first at bar 250 (value: vendor 8429.604166666666 vs ours 20294.5625) — persistent, last at bar 299
    O08_bar_index_mod_3                      INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    O09_bar_index_gt_100                     DIVERGE       cmp 300 ok 199 warm 0/0 steady 101/300 maxRel 0.00e+0 — 101 steady-state bars disagree; first at bar 0 (na: vendor 1 vs ours na) — scattered, last at bar 100
    O10_distance_MUST_BE_5                   MATCH         cmp 300 ok 295 warm 5/5 steady 0/295 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-origin-spy-1m-2026-10-02              AMEX:SPY 1M      11     DIVERGE       O05_bar_index_where_isfirst_was_true: bar 0 t=725898600 na vendor=0 ours=na
    O00_bar_index_CONTROL                    MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O01_last_bar_index                       MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O02_isfirst                              MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O03_bars_seen_by_a_var_counter           MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O04_bar_index_minus_counter_MUST_BE_MINU MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O05_bar_index_where_isfirst_was_true     DIVERGE       cmp 406 ok 0 warm 0/0 steady 406/406 maxRel 0.00e+0 — 406 steady-state bars disagree; first at bar 0 (na: vendor 0 vs ours na) — persistent, last at bar 405
    O06_barssince_isfirst                    MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O07_first_bar_time_in_days               MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O08_bar_index_mod_3                      MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O09_bar_index_gt_100                     MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O10_distance_MUST_BE_5                   MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-origin-spy-1w-2026-10-02              AMEX:SPY 1W      11     DIVERGE       O05_bar_index_where_isfirst_was_true: bar 0 t=727972200 na vendor=0 ours=na
    O00_bar_index_CONTROL                    MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O01_last_bar_index                       MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O02_isfirst                              MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O03_bars_seen_by_a_var_counter           MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O04_bar_index_minus_counter_MUST_BE_MINU MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O05_bar_index_where_isfirst_was_true     DIVERGE       cmp 1758 ok 0 warm 0/0 steady 1758/1758 maxRel 0.00e+0 — 1758 steady-state bars disagree; first at bar 0 (na: vendor 0 vs ours na) — persistent, last at bar 1757
    O06_barssince_isfirst                    MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O07_first_bar_time_in_days               MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O08_bar_index_mod_3                      MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O09_bar_index_gt_100                     MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O10_distance_MUST_BE_5                   MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bgcolor-barcolor-spy-1d-2026-10-02        AMEX:SPY 1D      1      DIVERGE       1 of 3 compared items diverge
    control                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   DIVERGE       1 paint differs (first: barcolor plot_3 "O4" withheld (an `offset` that is not a whole-number literal on `barcolor` has no capture (tools/visual_conformance/probes/vw-bgcolor-barcolor.pine)))
vw-bgcolor-v4-default-spy-1d-2026-10-02      AMEX:SPY 1D      1      MATCH         all 3 items agree
    control                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         3 paints agree bar for bar
vw-bool-cast-spy-1d-2026-09-28               AMEX:SPY 1D      10     MATCH         all 11 items agree
    B00_bar_index_CONTROL                    MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B09_x_CLASS_1na_2zero_3value             MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B01_and                                  MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B02_not                                  MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B03_or                                   MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B04_ternary_test                         MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B05_if_else                              MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B06_valuewhen_condition_arg              MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B07_corpus_time_membership_first_bar     MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B08_t_is_na_CONTROL                      MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bool-cast-spy-60-2026-09-28               AMEX:SPY 60      10     MATCH         all 11 items agree
    B00_bar_index_CONTROL                    MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B09_x_CLASS_1na_2zero_3value             MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B01_and                                  MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B02_not                                  MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B03_or                                   MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B04_ternary_test                         MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B05_if_else                              MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B06_valuewhen_condition_arg              MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B07_corpus_time_membership_first_bar     MATCH         cmp 20616 ok 20616 warm 0/1 steady 0/20615 maxRel 0.00e+0
    B08_t_is_na_CONTROL                      MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bool-cast-v4-spy-1d-2026-09-28            AMEX:SPY 1D      11     MATCH         all 12 items agree
    B00_bar_index_CONTROL                    MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B09_x_CLASS_1na_2zero_3value             MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B01_and                                  MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B02_not                                  MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B03_or                                   MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B04_ternary_test                         MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B05_if_else                              MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B06_valuewhen_condition_arg              MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B07_corpus_time_membership_first_bar     MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B10_iff_condition                        MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B08_t_is_na_CONTROL                      MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bool-cast-v4-spy-60-2026-09-28            AMEX:SPY 60      11     MATCH         all 12 items agree
    B00_bar_index_CONTROL                    MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B09_x_CLASS_1na_2zero_3value             MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B01_and                                  MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B02_not                                  MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B03_or                                   MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B04_ternary_test                         MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B05_if_else                              MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B06_valuewhen_condition_arg              MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B07_corpus_time_membership_first_bar     MATCH         cmp 20616 ok 20616 warm 0/1 steady 0/20615 maxRel 0.00e+0
    B10_iff_condition                        MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B08_t_is_na_CONTROL                      MATCH         cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-call-site-history-rddt-1d-2026-10-01      NYSE:RDDT 1D     21     INCONCLUSIVE  13 of 22 items could not be compared
    C01_highest10_cond                       INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for value
    C02_lowest10_cond                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2
    C03_sma3_cond                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3
    C04_ema3_cond                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4
    C05_local_x1_cond                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out5
    C06_bar_index1_cond                      MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    H01_param_src1_cond                      INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out7
    H02_local_x1_cond                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out8
    H03_sma3_cond                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out9
    H04_highest10_cond                       INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out10
    H05_bar_index1_cond                      INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out11
    H06_volume1_cond                         MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    D01_highest3_even                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out13
    D02_sma3_even                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out14
    D03_local_y1_even                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out15
    E01_highest10_every_bar                  MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    E02_lowest10_every_bar                   MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    E03_sma3_every_bar                       MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 1.32e-15
    E04_ema3_every_bar                       MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    E05_local_every_bar                      MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    E06_highest3_every_bar                   MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 48 paired slots; coordinates are NOT compared by v1
vw-call-site-history-spy-1d-2026-10-01       AMEX:SPY 1D      21     DIVERGE       E04_ema3_every_bar: bar 3 t=1565271000 value vendor=290.94265404261057 ours=290.07500000000005
    C01_highest10_cond                       INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for value
    C02_lowest10_cond                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2
    C03_sma3_cond                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3
    C04_ema3_cond                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4
    C05_local_x1_cond                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out5
    C06_bar_index1_cond                      INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    H01_param_src1_cond                      INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out7
    H02_local_x1_cond                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out8
    H03_sma3_cond                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out9
    H04_highest10_cond                       INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out10
    H05_bar_index1_cond                      INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out11
    H06_volume1_cond                         MATCH         cmp 1800 ok 1800 warm 0/1 steady 0/1799 maxRel 0.00e+0
    D01_highest3_even                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out13
    D02_sma3_even                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out14
    D03_local_y1_even                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out15
    E01_highest10_every_bar                  MATCH         cmp 1800 ok 1791 warm 9/10 steady 0/1790 maxRel 0.00e+0
    E02_lowest10_every_bar                   MATCH         cmp 1800 ok 1791 warm 9/10 steady 0/1790 maxRel 0.00e+0
    E03_sma3_every_bar                       MATCH         cmp 1800 ok 1798 warm 2/3 steady 0/1797 maxRel 1.40e-15
    E04_ema3_every_bar                       DIVERGE       cmp 1800 ok 1775 warm 3/3 steady 22/1797 maxRel 6.02e-3 — 22 steady-state bars disagree; first at bar 3 (value: vendor 290.94265404261057 vs ours 290.07500000000005) — a CONVERGING PREFIX: bars 3..24 differ with |err| falling 8.68e-1 → 4.14e-7, then all 1775 later bars agree (the recursive-state-seeded-at-the-window signature)
    E05_local_every_bar                      MATCH         cmp 1800 ok 1799 warm 1/1 steady 0/1799 maxRel 0.00e+0
    E06_highest3_every_bar                   MATCH         cmp 1800 ok 1798 warm 2/3 steady 0/1797 maxRel 0.00e+0
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 44 paired slots; coordinates are NOT compared by v1
vw-clock-close-tfchange-spy-1d-2026-09-28    AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `hour` with that argument. `hour(timenow)` -- this engine's answer for Pine's live wall clock, the newest fetched bar's own value -- translates, and so does `hour(time)`, which is this bar's own value. A different bar (`hour(time[1])`), a named timezone, and a computed timestamp are all real Pine and all currently refused as a function argument. TO UNBLOCK: read the bare `hour` (or `hour(time)`) for this bar's own value, or `hour(timenow)` for the newest fetched bar's.
vw-clock-close-tfchange-spy-1d-2026-09-28    AMEX:SPY 1W      0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `hour` with that argument. `hour(timenow)` -- this engine's answer for Pine's live wall clock, the newest fetched bar's own value -- translates, and so does `hour(time)`, which is this bar's own value. A different bar (`hour(time[1])`), a named timezone, and a computed timestamp are all real Pine and all currently refused as a function argument. TO UNBLOCK: read the bare `hour` (or `hour(time)`) for this bar's own value, or `hour(timenow)` for the newest fetched bar's.
vw-clock-vwap-spy-5-ext-2026-09-28           AMEX:SPY 5       15     INCONCLUSIVE  5 of 16 items could not be compared
    V00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    V01_year_time_minus_year_MUST_BE_0       MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    V02_month_time_minus_month_MUST_BE_0     MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    V03_dayofmonth_time_minus_bare_MUST_BE_0 MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    V04_dayofweek_time_minus_bare_MUST_BE_0  MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    V05_hour_time_minus_hour_MUST_BE_0       MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    V06_minute_time_minus_minute_MUST_BE_0   MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    V07_vwap_hlc3_minus_vwap_MUST_BE_0       INCONCLUSIVE  cmp 300 ok 300 warm 0/300 steady 0/0 maxRel 0.00e+0 — every compared bar is inside the warm-up region — nothing in steady state to judge
    V08_vwap_close_minus_vwap_CONTROL_NONZER INCONCLUSIVE  cmp 300 ok 191 warm 109/300 steady 0/0 maxRel 1.79e+1 — every compared bar is inside the warm-up region — nothing in steady state to judge
    V09_vwap_bare_RAW                        INCONCLUSIVE  cmp 300 ok 191 warm 109/300 steady 0/0 maxRel 9.78e-4 — every compared bar is inside the warm-up region — nothing in steady state to judge
    V10_vwap_hlc3_RAW                        INCONCLUSIVE  cmp 300 ok 191 warm 109/300 steady 0/0 maxRel 9.78e-4 — every compared bar is inside the warm-up region — nothing in steady state to judge
    V11_year_time_RAW                        MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    V12_dayofweek_time_RAW                   MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    V13_year_MUST_SPAN_TWO_VALUES            MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    V14_month_MUST_SPAN_SEVERAL_VALUES       MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-colour-components-spy-1d-2026-10-01       AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:colour-value) [runtime declined: runtime:colour]: a colour cannot be a value in a screened column — `color.r`: its components are served for a fixed colour (a Pine colour name, a `#RRGGBB` or `#RRGGBBAA` literal, `color.rgb` of literals, an `input.color` of one), for `color.new` of one with a literal transparency or a per-bar one that stays within 0-100, for a ternary of two such colours, for `color.from_gradient` between two fixed colours, and for `color.new(<that gradient>, <literal>)` — the colours the `vw-gradient` and `vw-colour-components` captures measured. This one is none of those (a gradient between gradients and a colour returned by a user function are measured and not served)
vw-cond-window-extremes-rddt-1d-2026-10-02   NYSE:RDDT 1D     17     INCONCLUSIVE  7 of 18 items could not be compared
    X00_bar_index_CONTROL                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    X01_highest_bi_3_every_3rd               INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2
    X02_lowest_bi_3_every_3rd                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3
    X03_lowest_bi_5_every_2nd                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4
    X04_lowest_bi_3_up_bars                  INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out5
    X05_highest_neg_bi_3_up_bars             INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out6
    X06_lowest_3_onearg_every_3rd            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out7
    X07_highest_3_onearg_every_3rd           INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out8
    E01_highest_bi_3_every_bar               MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    E02_lowest_bi_3_every_bar                MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    E03_lowest_bi_5_every_bar                MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    E06_lowest_3_every_bar                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    E07_highest_3_every_bar                  MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    E08_low_CONTROL                          MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    E09_high_CONTROL                         MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    E10_up_bar_CONTROL                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    R01_bar_index_prev_run                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cond-window-extremes-spy-1d-2026-10-02    AMEX:SPY 1D      17     INCONCLUSIVE  12 of 18 items could not be compared
    X00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    X01_highest_bi_3_every_3rd               INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2
    X02_lowest_bi_3_every_3rd                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3
    X03_lowest_bi_5_every_2nd                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4
    X04_lowest_bi_3_up_bars                  INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out5
    X05_highest_neg_bi_3_up_bars             INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out6
    X06_lowest_3_onearg_every_3rd            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out7
    X07_highest_3_onearg_every_3rd           INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out8
    E01_highest_bi_3_every_bar               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    E02_lowest_bi_3_every_bar                INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    E03_lowest_bi_5_every_bar                INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    E06_lowest_3_every_bar                   MATCH         cmp 1800 ok 1798 warm 2/3 steady 0/1797 maxRel 0.00e+0
    E07_highest_3_every_bar                  MATCH         cmp 1800 ok 1798 warm 2/3 steady 0/1797 maxRel 0.00e+0
    E08_low_CONTROL                          MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E09_high_CONTROL                         MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E10_up_bar_CONTROL                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    R01_bar_index_prev_run                   INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    objects                                  MATCH         neither side draws an object
vw-deadband-ticks-aapl-1d-2026-09-28         NASDAQ:AAPL 1D   5      INCONCLUSIVE  1 of 7 items could not be compared
    DBHF                                     MATCH         cmp 11534 ok 11534 warm 0/0 steady 0/11534 maxRel 0.00e+0
    D00_bar_index_CONTROL                    MATCH         cmp 11534 ok 11534 warm 0/0 steady 0/11534 maxRel 0.00e+0
    D01_mintick                              INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    D02_base_tau                             MATCH         cmp 11534 ok 11534 warm 0/0 steady 0/11534 maxRel 0.00e+0
    D03_dbhf                                 MATCH         cmp 11534 ok 11534 warm 0/0 steady 0/11534 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         1 paint agree bar for bar
vw-deadband-ticks-brk-a-1d-2026-09-28        NYSE:BRK.A 1D    5      DIVERGE       1 of 7 compared items diverge
    DBHF                                     INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for value
    D00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2
    D01_mintick                              INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    D02_base_tau                             INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3
    D03_dbhf                                 INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4
    objects                                  MATCH         neither side draws an object
    paints                                   DIVERGE       1 paint differs (first: barcolor plot_0 "Bar Color" notDrawn)
vw-deadband-ticks-spy-1d-2026-09-28          AMEX:SPY 1D      5      INCONCLUSIVE  1 of 7 items could not be compared
    DBHF                                     MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    D00_bar_index_CONTROL                    MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    D01_mintick                              INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    D02_base_tau                             MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    D03_dbhf                                 MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         1 paint agree bar for bar
vw-default-param-spy-1d-2026-10-02           AMEX:SPY 1D      16     INCONCLUSIVE  1 of 17 items could not be compared
    D00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    D01_number_omitted                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D02_number_written                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D03_negative_omitted                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D04_negative_written                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D05_bool_omitted                         MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D06_bool_written                         MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D07_string_omitted                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D08_string_written                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D09_na_omitted                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D10_na_written                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D11_two_defaults_none_given              MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D12_two_defaults_written                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D13_two_defaults_first_given             MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D14_two_defaults_first_given_written     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D15_pairs_that_differ_MUST_BE_0          MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-fn-series-history-rddt-1d-2026-09-30      NYSE:RDDT 1D     4      MATCH         all 5 items agree
    E01_local_every_bar                      MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    E02_param_every_bar                      MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    E03_sma_every_bar                        MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 1.32e-15
    E04_highest_every_bar                    MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 50 paired slots; coordinates are NOT compared by v1
vw-forin-collections-2-rddt-1d-2026-10-02    NYSE:RDDT 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:reassign) [runtime declined: runtime:loop]: a name that is reassigned later cannot be folded into one expression — `G01` — and the fold stopped before it, at line 46: a Pine block spans several statements and this engine stores a single expression — `for`
vw-forin-collections-rddt-1d-2026-10-01      NYSE:RDDT 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:reassign) [runtime declined: runtime:loop]: a name that is reassigned later cannot be folded into one expression — `F01` — and the fold stopped before it, at line 63: a Pine block spans several statements and this engine stores a single expression — `for`
vw-getter-history-2-spy-1d-2026-10-02        AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:drawing) [runtime declined: pine:drawing]: a drawing object paints on a chart and answers with no number — `line.get_y1`
vw-getter-history-spy-1d-2026-10-01          AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:drawing) [runtime declined: runtime:object-op]: a drawing object paints on a chart and answers with no number — `line.get_y1`
vw-gradient-edges-spy-1d-2026-10-02          AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:colour-value) [runtime declined: pine:colour-value]: a colour cannot be a value in a screened column — `color.from_gradient`
vw-gradient-spy-1d-2026-09-30                AMEX:SPY 1D      23     INCONCLUSIVE  23 of 24 items could not be compared
    G00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    G01_v                                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    G02_g1_r                                 INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    G03_g1_g                                 INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    G04_g1_b                                 INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    G05_g1_t                                 INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    G06_w                                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    G07_g2_r_clamp                           INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    G08_g2_g_clamp                           INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    G09_g2_b_clamp                           INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    G10_g2_t_clamp                           INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    G11_g3_r_new30                           INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    G12_g3_g_new30                           INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    G13_g3_b_new30                           INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    G14_g3_t_new30                           INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    G15_g4_t_interp_0_to_100                 INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    G16_g4_r                                 INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    G17_new_red_70p5_t                       INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    G18_new_red_70p5_r                       INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    G19_new_0064C8_70p5_t                    INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    G20_new_0064C8_70p4_t                    INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    G21_cA_t_CONTROL                         INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    G22_drawn_in_g1                          INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    objects                                  MATCH         neither side draws an object
vw-h4-loops-rddt-1d-2026-10-03               NYSE:RDDT 1D     4      MATCH         all 5 items agree
    L1 wsum(close, a+b)                      MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    L2 seeded filter                         MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    L3 sum of last n closes                  MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    L3 n                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-h4-loops-spy-1d-2026-10-03                AMEX:SPY 1D      4      MATCH         all 5 items agree
    L1 wsum(close, a+b)                      MATCH         cmp 1800 ok 1526 warm 274/274 steady 0/1526 maxRel 0.00e+0
    L2 seeded filter                         MATCH         cmp 1800 ok 1526 warm 274/274 steady 0/1526 maxRel 0.00e+0
    L3 sum of last n closes                  MATCH         cmp 1800 ok 1526 warm 274/274 steady 0/1526 maxRel 0.00e+0
    L3 n                                     MATCH         cmp 1800 ok 1526 warm 274/274 steady 0/1526 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-input-tf-text-v5-spy-1d-2026-10-01        AMEX:SPY 1D      19     INCONCLUSIVE  19 of 20 items could not be compared
    I00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    I01_len_D                                INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I02_D_eq_D                               INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I03_D_eq_1D                              INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I04_len_W                                INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I05_W_eq_W                               INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I06_W_eq_1W                              INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I07_len_M                                INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I08_M_eq_M                               INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I09_M_eq_1M                              INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I10_len_60                               INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I11_60_eq_60                             INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I12_len_240                              INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I13_240_eq_240                           INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I14_len_1D                               INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I15_1D_eq_1D                             INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I16_1D_eq_D                              INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I17_len_empty                            INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I18_empty_eq_timeframe_period            INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         object counts and texts agree; colours agree on 20 paired slots; coordinates are NOT compared by v1
vw-input-tf-text-v6-spy-1d-2026-10-01        AMEX:SPY 1D      19     INCONCLUSIVE  19 of 20 items could not be compared
    I00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    I01_len_D                                INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I02_D_eq_D                               INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I03_D_eq_1D                              INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I04_len_W                                INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I05_W_eq_W                               INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I06_W_eq_1W                              INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I07_len_M                                INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I08_M_eq_M                               INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I09_M_eq_1M                              INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I10_len_60                               INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I11_60_eq_60                             INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I12_len_240                              INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I13_240_eq_240                           INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I14_len_1D                               INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I15_1D_eq_1D                             INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I16_1D_eq_D                              INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I17_len_empty                            INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I18_empty_eq_timeframe_period            INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         object counts and texts agree; colours agree on 20 paired slots; coordinates are NOT compared by v1
vw-int-array-avg-neg-spy-1d-2026-10-01       AMEX:SPY 1D      5      INCONCLUSIVE  6 of 6 items could not be compared
    A00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for value
    A01_avg_n1_n2                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2
    A02_avg_n2_n3                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3
    A03_avg_0_n1                             INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4
    A04_avg_n3_n4                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out5
    objects                                  INCONCLUSIVE  our object lane did not run: withheld by name (runtime:objects-without-run) — This script's drawings are not drawn: its run computed nothing on this chart (runtime:warmup-never-converges), and its drawings belong to that run — drawn alone they would be a picture TradingView does not draw. Nothing is drawn rather than a guess.
vw-int-array-avg-spy-1d-2026-09-30           AMEX:SPY 1D      17     INCONCLUSIVE  18 of 18 items could not be compared
    A00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for value
    A01_int_avg_1_2                          INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2
    A02_int_avg_1_1_2                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3
    A03_int_avg_1_2_2                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4
    A04_int_avg_2_3                          INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out5
    A05_int_avg_n1_n2                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out6
    A06_int_avg_n1_n1_n2                     INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out7
    A07_int_avg_n1_n2_n2                     INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out8
    B01_float_avg_1_2_CONTROL                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out9
    B02_float_avg_1_1_2_CONTROL              INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out10
    B03_float_avg_1_2_2_CONTROL              INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out11
    D01_int_avg_1_2_times_2                  INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out12
    D02_int_avg_1_1_2_times_3                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out13
    D03_int_avg_1_2_2_times_3                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out14
    P01_var_push_avg_1_2                     INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out15
    P02_var_push_avg_1_1_2                   INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out16
    P03_var_push_avg_2_2_1                   INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out17
    objects                                  INCONCLUSIVE  our object lane did not run: withheld by name (runtime:objects-without-run) — This script's drawings are not drawn: its run computed nothing on this chart (runtime:warmup-never-converges), and its drawings belong to that run — drawn alone they would be a picture TradingView does not draw. Nothing is drawn rather than a guess.
vw-int-div-assign-spy-1d-2026-10-02          AMEX:SPY 1D      6      INCONCLUSIVE  4 of 7 items could not be compared
    D00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    D01_input_int_div_assign                 MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    D02_int_literal_div_assign               INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    D03_int_literal_over_int                 INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    D04_input_int_over_int                   MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    D05_int_reassigned_quotient              INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-library-import-rddt-1d-2026-10-02         NYSE:RDDT 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:module) [runtime declined: runtime:library]: importing another script pulls in code this engine never sees — the library `TradingView/ta/7` is not in this engine's library registry, so its code cannot be compiled
vw-loop-in-block-spy-1d-2026-10-02           AMEX:SPY 1D      9      INCONCLUSIVE  10 of 10 items could not be compared
    L00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for value
    L01_close_CONTROL                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2
    L02_m_below_loop                         INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3
    L03_m_no_loop                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4
    L04_acc_loop_written                     INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out5
    L05_d_from_loop_total                    INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out6
    L06_e_above_loop                         INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out7
    L07_w_below_while                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out8
    L08_k_else_arm                           INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out9
    objects                                  INCONCLUSIVE  our object lane did not run: the run drew nothing (runtime:warmup-never-converges: this script is drawn bar by bar from its first bar, and this chart's history does not start at the symbol's first bar. Run from two different first bars, its values never came to agree, so what it would show here depends on where the chart begins, which TradingView does not share. Nothing is drawn rather than a guess. TO UNBLOCK: a chart whose loaded history reaches the listing (a daily chart of a symbol listed within the bars it loads) draws it.)
vw-lower-tf-1-30-spy-1d-2026-10-02           AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:request) [runtime declined: lower-tf:unwitnessed]: this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `30` is not one of them. Below the chart's own timeframe: lower-tf:unwitnessed: `30` below a D chart reads intraday bars, and no committed capture shows TradingView answering that timeframe on that chart period — probe `tools/visual_conformance/probes/vw-lower-tf.pine` (Q-L1 in `docs/pine/capture-queue-2026-09-30-lower-tf.md`) with a row at this timeframe, on this chart period, beside TradingView's own intraday bars of the symbol at that timeframe. ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-lower-tf-1-30-spy-1m-2026-10-02           AMEX:SPY 1M      0      INCONCLUSIVE  refused on our side: member door refused (pine:request) [runtime declined: lower-tf:unwitnessed]: this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `30` is not one of them. Below the chart's own timeframe: lower-tf:unwitnessed: `30` below a D chart reads intraday bars, and no committed capture shows TradingView answering that timeframe on that chart period — probe `tools/visual_conformance/probes/vw-lower-tf.pine` (Q-L1 in `docs/pine/capture-queue-2026-09-30-lower-tf.md`) with a row at this timeframe, on this chart period, beside TradingView's own intraday bars of the symbol at that timeframe. ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-lower-tf-cava-1d-2026-10-02               NYSE:CAVA 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:request) [runtime declined: lower-tf:store-unmeasured]: this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-lower-tf-rddt-1d-2026-09-30               NYSE:RDDT 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:request) [runtime declined: lower-tf:store-unmeasured]: this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-lower-tf-spy-1d-2026-09-30                AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:request) [runtime declined: lower-tf:store-unmeasured]: this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-lower-tf-spy-1m-2026-10-02                AMEX:SPY 1M      0      INCONCLUSIVE  refused on our side: member door refused (pine:request) [runtime declined: lower-tf:store-unmeasured]: this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-lower-tf-spy-1w-2026-09-30                AMEX:SPY 1W      0      INCONCLUSIVE  refused on our side: member door refused (pine:request) [runtime declined: lower-tf:store-unmeasured]: this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-mbb-auto-spy-1d-2026-09-30                AMEX:SPY 1D      4      INCONCLUSIVE  4 of 5 items could not be compared
    M00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    M01_k                                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    M02_close_at_k                           INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    M03_close_at_k_is_na                     INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    objects                                  MATCH         neither side draws an object
vw-mintick-arkk-1d-2026-10-02                CBOE:ARKK 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-bac-pl-1d-2026-10-02              NYSE:BAC/PL 1D   0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-dfliw-1d-2026-10-02               NASDAQ:DFLIW 1D  0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-grrrw-1d-2026-10-02               NASDAQ:GRRRW 1D  0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-imo-1d-2026-10-02                 AMEX:IMO 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-qqq-1d-2026-10-02                 NASDAQ:QQQ 1D    0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-xlk-1d-2026-10-02                 AMEX:XLK 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-yhnau-1d-2026-10-02               NASDAQ:YHNAU 1D  0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-ne-na-spy-1d-2026-09-30                   AMEX:SPY 1D      12     INCONCLUSIVE  10 of 13 items could not be compared
    Q00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    Q01_x_is_na                              INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    Q02_x_ne_close                           INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    Q03_x_eq_close                           INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    Q04_x_ne_x                               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    Q05_x_eq_x                               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    Q06_i_ne_1                               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    Q07_i_eq_1                               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    Q08_x_gt_0                               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    Q09_not_x_eq_close                       INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    Q10_na_var_ne_close                      MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q11_na_var_eq_close                      MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-object-gc-a-spy-1d-2026-09-28             AMEX:SPY 1D      4      MATCH         all 5 items agree
    A00_bar_index_CONTROL                    MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    A01_isconfirmed                          MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    A02_islast                               MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    A03_O2_created_this_bar                  MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 194 paired slots; 132 slots on objects neither side draws not graded; coordinates are NOT compared by v1
vw-object-gc-a-spy-1d-2026-09-28             AMEX:SPY 1W      4      DIVERGE       A01_isconfirmed: bar 1757 t=1790602200 value vendor=0 ours=1
    A00_bar_index_CONTROL                    MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    A01_isconfirmed                          DIVERGE       cmp 1758 ok 1757 warm 0/0 steady 1/1758 maxRel 0.00e+0 — 1 steady-state bars disagree; first at bar 1757 (value: vendor 0 vs ours 1) — persistent, last at bar 1757
    A02_islast                               MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    A03_O2_created_this_bar                  MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 189 paired slots; 129 slots on objects neither side draws not graded; coordinates are NOT compared by v1
vw-object-gc-b-spy-1d-2026-09-28             AMEX:SPY 1D      3      MATCH         all 4 items agree
    B00_bar_index_CONTROL                    MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B01_isconfirmed                          MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B02_islast                               MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 326 paired slots; coordinates are NOT compared by v1
vw-object-gc-b-spy-1d-2026-09-28             AMEX:SPY 1W      3      DIVERGE       B01_isconfirmed: bar 1757 t=1790602200 value vendor=0 ours=1
    B00_bar_index_CONTROL                    MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    B01_isconfirmed                          DIVERGE       cmp 1758 ok 1757 warm 0/0 steady 1/1758 maxRel 0.00e+0 — 1 steady-state bars disagree; first at bar 1757 (value: vendor 0 vs ours 1) — persistent, last at bar 1757
    B02_islast                               MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 324 paired slots; coordinates are NOT compared by v1
vw-object-gc-c-spy-1d-2026-09-28             AMEX:SPY 1D      4      MATCH         all 5 items agree
    C00_bar_index_CONTROL                    MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    C01_isconfirmed                          MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    C02_islast                               MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    C03_bar_index_mod3                       MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 38 paired slots; coordinates are NOT compared by v1
vw-object-gc-c-spy-1d-2026-09-28             AMEX:SPY 1W      4      DIVERGE       C01_isconfirmed: bar 1757 t=1790602200 value vendor=0 ours=1
    C00_bar_index_CONTROL                    MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    C01_isconfirmed                          DIVERGE       cmp 1758 ok 1757 warm 0/0 steady 1/1758 maxRel 0.00e+0 — 1 steady-state bars disagree; first at bar 1757 (value: vendor 0 vs ours 1) — persistent, last at bar 1757
    C02_islast                               MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    C03_bar_index_mod3                       MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 51 paired slots; coordinates are NOT compared by v1
vw-object-gc-d-spy-1d-2026-09-28             AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:collection) [runtime declined: pine:collection]: an array, a matrix or a map is outside the expression grammar this engine runs — `label.all` is read as an array here and nothing in this script creates it, so there are no slots to read
vw-object-gc-d-spy-1d-2026-09-28             AMEX:SPY 1W      0      INCONCLUSIVE  refused on our side: member door refused (pine:collection) [runtime declined: pine:collection]: an array, a matrix or a map is outside the expression grammar this engine runs — `label.all` is read as an array here and nothing in this script creates it, so there are no slots to read
vw-offset-na-spy-1d-2026-09-30               AMEX:SPY 1D      6      INCONCLUSIVE  5 of 7 items could not be compared
    E00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    E01_e_is_na                              INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    E02_close_at_e                           INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    E03_close_at_e_is_na                     INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    E04_close_1_CONTROL                      MATCH         cmp 300 ok 299 warm 1/1 steady 0/299 maxRel 0.00e+0
    E05_close_at_e_eq_close                  INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    objects                                  MATCH         neither side draws an object
vw-once-ta-helper-rddt-1d-2026-10-02         NYSE:RDDT 1D     1      MATCH         all 2 items agree
    V00_close_CONTROL                        MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 28 paired slots; coordinates are NOT compared by v1
vw-once-ta-helper-spy-1d-2026-10-02          AMEX:SPY 1D      1      MATCH         all 2 items agree
    V00_close_CONTROL                        MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 28 paired slots; coordinates are NOT compared by v1
vw-other-symbol-rddt-1d-2026-09-30           NYSE:RDDT 1D     8      DIVERGE       O05_BRKB_bare: bar 0 t=1711027800 na vendor=413.78 ours=na
    O00_bar_index_CONTROL                    MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    O01_chart_close                          MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    O02_SPY_bare                             MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    O03_AMEX_SPY                             MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    O04_bare_eq_amex                         MATCH         cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    O05_BRKB_bare                            DIVERGE       cmp 634 ok 300 warm 0/0 steady 334/634 maxRel 0.00e+0 — 334 steady-state bars disagree; first at bar 0 (na: vendor 413.78 vs ours na) — scattered, last at bar 333
    O06_NYSE_BRKB                            DIVERGE       cmp 634 ok 300 warm 0/0 steady 334/634 maxRel 0.00e+0 — 334 steady-state bars disagree; first at bar 0 (na: vendor 413.78 vs ours na) — scattered, last at bar 333
    O07_brkb_bare_eq_nyse                    DIVERGE       cmp 634 ok 300 warm 0/0 steady 334/634 maxRel 1.00e+0 — 334 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 333
    objects                                  MATCH         object counts and texts agree; colours agree on 2 paired slots; coordinates are NOT compared by v1
vw-ratchet-stops-rddt-1d-2026-10-02          NYSE:RDDT 1D     8      DIVERGE       R03_trend: bar 0 t=1711027800 na vendor=1 ours=na
    R01_up                                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.71e-16
    R02_dn                                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.13e-16
    R03_trend                                DIVERGE       cmp 636 ok 635 warm 0/0 steady 1/636 maxRel 0.00e+0 — 1 steady-state bars disagree; first at bar 0 (na: vendor 1 vs ours na) — scattered, last at bar 0
    R04_local_stop                           MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.62e-16
    R05_range_filter                         MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.90e-16
    R06_pivot_high                           MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    R07_pivot_low                            MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    R00_bar_index_CONTROL                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-ratchet-stops-spy-1d-2026-10-02           AMEX:SPY 1D      8      DIVERGE       R05_range_filter: bar 331 t=1606314600 value vendor=356.2919159625885 ours=356.29188381957533
    R01_up                                   MATCH         cmp 1800 ok 1640 warm 160/260 steady 0/1540 maxRel 1.39e-3
    R02_dn                                   MATCH         cmp 1800 ok 1643 warm 157/260 steady 0/1540 maxRel 1.99e-4
    R03_trend                                MATCH         cmp 1800 ok 1509 warm 291/511 steady 0/1289 maxRel 0.00e+0
    R04_local_stop                           MATCH         cmp 1800 ok 1641 warm 159/260 steady 0/1540 maxRel 1.28e-3
    R05_range_filter                         DIVERGE       cmp 1800 ok 1353 warm 331/331 steady 116/1469 maxRel 2.05e-6 — 116 steady-state bars disagree; first at bar 331 (value: vendor 356.2919159625885 vs ours 356.29188381957533) — a CONVERGING PREFIX: bars 331..446 differ with |err| falling 3.21e-5 → 4.19e-7, then all 1353 later bars agree (the recursive-state-seeded-at-the-window signature)
    R06_pivot_high                           MATCH         cmp 1800 ok 1800 warm 0/4 steady 0/1796 maxRel 0.00e+0
    R07_pivot_low                            MATCH         cmp 1800 ok 1799 warm 1/4 steady 0/1796 maxRel 1.00e+0
    R00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    objects                                  MATCH         neither side draws an object
vw-request-htf-alignment-spy-1d-2026-10-02   AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:request) [runtime declined: runtime:request]: this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-request-htf-alignment-spy-5-2026-10-02    AMEX:SPY 5       0      INCONCLUSIVE  refused on our side: member door refused (pine:request) [runtime declined: runtime:request]: this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-request-htf-alignment-spy-60-2026-10-02   AMEX:SPY 60      0      INCONCLUSIVE  refused on our side: member door refused (pine:request) [runtime declined: runtime:request]: this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-rt5-arm-draw-block-history-rddt-1d-2026-1 NYSE:RDDT 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:drawing) [runtime declined: pine:drawing]: a drawing object paints on a chart and answers with no number — `label.new`
vw-rt6-runtime-colour-rddt-1d-2026-10-03     NYSE:RDDT 1D     7      DIVERGE       C01_var_colour: bar 0 t=1711027800 color vendor=#ffffffff ours=#c9a84cff
    K00_bar_index_CONTROL                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    C01_var_colour                           DIVERGE       cmp 636 ok 0 warm 0/0 steady 636/636 maxRel 0.00e+0 — 636 steady-state bars disagree; first at bar 0 (color: vendor #ffffffff vs ours #c9a84cff at value 50.44) — persistent, last at bar 635
    C02_new_var_40                           DIVERGE       cmp 636 ok 0 warm 0/0 steady 636/636 maxRel 0.00e+0 — 636 steady-state bars disagree; first at bar 0 (color: vendor #ffffff99 vs ours #c9a84cff at value 50.44) — persistent, last at bar 635
    C03_new_na_base                          DIVERGE       cmp 636 ok 0 warm 0/0 steady 636/636 maxRel 0.00e+0 — 636 steady-state bars disagree; first at bar 0 (color: vendor #00000099 vs ours #c9a84cff at value 50.44) — persistent, last at bar 635
    C04_new_na_transp                        DIVERGE       cmp 636 ok 0 warm 0/0 steady 636/636 maxRel 0.00e+0 — 636 steady-state bars disagree; first at bar 0 (color: vendor #ff525200 vs ours #c9a84cff at value 50.44) — persistent, last at bar 635
    C05_rgb_na                               DIVERGE       cmp 636 ok 0 warm 0/0 steady 636/636 maxRel 0.00e+0 — 636 steady-state bars disagree; first at bar 0 (color: vendor #000000ff vs ours #c9a84cff at value 50.44) — persistent, last at bar 635
    C06_cond_or_na                           MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   DIVERGE       1 paint differs (first: barcolor plot_12 "B01_var_barcolor" withheld (`barcolor`'s colour is an expression this door cannot carry yet))
vw-rt6-runtime-colour-spy-1d-2026-10-03      AMEX:SPY 1D      7      DIVERGE       C01_var_colour: bar 0 t=1565098200 color vendor=#33ff00ff ours=#c9a84cff
    K00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    C01_var_colour                           DIVERGE       cmp 1800 ok 0 warm 0/0 steady 1800/1800 maxRel 0.00e+0 — 1800 steady-state bars disagree; first at bar 0 (color: vendor #33ff00ff vs ours #c9a84cff at value 287.8) — persistent, last at bar 1799
    C02_new_var_40                           DIVERGE       cmp 1800 ok 0 warm 0/0 steady 1800/1800 maxRel 0.00e+0 — 1800 steady-state bars disagree; first at bar 0 (color: vendor #33ff0099 vs ours #c9a84cff at value 287.8) — persistent, last at bar 1799
    C03_new_na_base                          DIVERGE       cmp 1800 ok 0 warm 0/0 steady 1800/1800 maxRel 0.00e+0 — 1800 steady-state bars disagree; first at bar 0 (color: vendor #00000099 vs ours #c9a84cff at value 287.8) — persistent, last at bar 1799
    C04_new_na_transp                        DIVERGE       cmp 1800 ok 0 warm 0/0 steady 1800/1800 maxRel 0.00e+0 — 1800 steady-state bars disagree; first at bar 0 (color: vendor #ff525200 vs ours #c9a84cff at value 287.8) — persistent, last at bar 1799
    C05_rgb_na                               DIVERGE       cmp 1800 ok 0 warm 0/0 steady 1800/1800 maxRel 0.00e+0 — 1800 steady-state bars disagree; first at bar 0 (color: vendor #000000ff vs ours #c9a84cff at value 287.8) — persistent, last at bar 1799
    C06_cond_or_na                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   DIVERGE       1 paint differs (first: barcolor plot_12 "B01_var_barcolor" withheld (`barcolor`'s colour is an expression this door cannot carry yet))
vw-rt7-empty-reduce-fixnan-spy-1d-2026-10-04 AMEX:SPY 1D      11     MATCH         all 12 items agree
    E00_bar_index_CONTROL                    MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    E01_max_empty                            MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    E02_min_empty                            MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    E03_sum_empty                            MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    E04_avg_empty                            MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    E05_sum_all_na                           MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    E06_avg_all_na                           MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    F00_x_CONTROL                            MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    F01_fixnan                               MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    F02a_fixnan_in_fn                        MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    F02b_fixnan_in_fn_second_site            MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-runtime-error-spy-1d-2026-09-30           AMEX:SPY 1D      2      DIVERGE       1 of 3 compared items diverge
    E00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    E01_close_CONTROL                        MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    objects                                  DIVERGE       2 object families differ (count or text); no colour slot was paired, so no colour was graded; coordinates are NOT compared by v1
vw-ternary-draw-helper-rddt-1d-2026-10-02    NYSE:RDDT 1D     1      MATCH         all 2 items agree
    R00                                      MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 1009 paired slots; coordinates are NOT compared by v1
vw-tf-period-spy-1d-2026-09-30               AMEX:SPY 1D      12     INCONCLUSIVE  9 of 13 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_len_period                           INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T02_eq_D                                 INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T03_eq_1D                                INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T04_eq_W                                 INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T05_eq_1W                                INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T06_eq_M                                 INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T07_eq_1M                                INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T08_multiplier                           INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T09_isdaily                              MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    T10_isweekly                             MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    T11_ismonthly                            MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 2 paired slots; coordinates are NOT compared by v1
vw-tf-period-spy-1m-2026-09-30               AMEX:SPY 1M      12     INCONCLUSIVE  10 of 13 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_len_period                           INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2
    T02_eq_D                                 INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3
    T03_eq_1D                                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4
    T04_eq_W                                 INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out5
    T05_eq_1W                                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out6
    T06_eq_M                                 INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out7
    T07_eq_1M                                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out8
    T08_multiplier                           INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T09_isdaily                              MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    T10_isweekly                             MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    T11_ismonthly                            MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  INCONCLUSIVE  our object lane did not run: objectReaderFor returned null
vw-tf-period-spy-1w-2026-09-30               AMEX:SPY 1W      12     INCONCLUSIVE  10 of 13 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_len_period                           INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2
    T02_eq_D                                 INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3
    T03_eq_1D                                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4
    T04_eq_W                                 INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out5
    T05_eq_1W                                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out6
    T06_eq_M                                 INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out7
    T07_eq_1M                                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out8
    T08_multiplier                           INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T09_isdaily                              MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    T10_isweekly                             MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    T11_ismonthly                            MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  INCONCLUSIVE  our object lane did not run: objectReaderFor returned null
vw-theme-colours-spy-1d-2026-10-01           AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:colour-value) [runtime declined: pine:colour-value]: a colour cannot be a value in a screened column — `color.r`: its components are served for a fixed colour (a Pine colour name, a `#RRGGBB` or `#RRGGBBAA` literal, `color.rgb` of literals, an `input.color` of one), for `color.new` of one with a literal transparency or a per-bar one that stays within 0-100, for a ternary of two such colours, for `color.from_gradient` between two fixed colours, and for `color.new(<that gradient>, <literal>)` — the colours the `vw-gradient` and `vw-colour-components` captures measured. This one is none of those (a gradient between gradients and a colour returned by a user function are measured and not served)
vw-time-close-tf-bitstamp-btcusd-1d-2026-09- BITSTAMP:BTCUSD  0      INCONCLUSIVE  refused on our side: member door refused (pine:function) [runtime declined: pine:function]: this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-eurusd-1d-2026-10-02        FX:EURUSD 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:function) [runtime declined: pine:function]: this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-fx-eurusd-1d-2026-10-01     FX:EURUSD 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:function) [runtime declined: pine:function]: this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-spy-15-2026-10-02           AMEX:SPY 15      0      INCONCLUSIVE  refused on our side: member door refused (pine:function) [runtime declined: pine:function]: this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-spy-1d-2026-09-30           AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:function) [runtime declined: pine:function]: this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-spy-1d-full-2026-10-01      AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:function) [runtime declined: pine:function]: this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-spy-1d-full-2026-10-02      AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:function) [runtime declined: pine:function]: this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-spy-1m-2026-10-01           AMEX:SPY 1M      0      INCONCLUSIVE  refused on our side: member door refused (pine:function) [runtime declined: pine:function]: this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-spy-1m-2026-10-02           AMEX:SPY 1M      0      INCONCLUSIVE  refused on our side: member door refused (pine:function) [runtime declined: pine:function]: this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-spy-1w-2026-10-01           AMEX:SPY 1W      0      INCONCLUSIVE  refused on our side: member door refused (pine:function) [runtime declined: pine:function]: this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-spy-1w-2026-10-02           AMEX:SPY 1W      0      INCONCLUSIVE  refused on our side: member door refused (pine:function) [runtime declined: pine:function]: this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-session-spy-1d-2026-09-28            AMEX:SPY D       0      INCONCLUSIVE  refused on our side: member door refused (pine:function) [runtime declined: pine:function]: this Pine function maps to nothing the engine grammar declares — `time(<timeframe>, <session>)`: `"2000-0000"` wraps past midnight (or spans the whole day). The capture read `"2000-0000"` as `na` on every bar it holds, but none of those bars opens after 20:00, so it cannot say whether such a window is empty or runs to midnight — and the two answer differently on a 24-hour symbol.
vw-time-session-spy-60-ext-2026-09-28        AMEX:SPY 60      0      INCONCLUSIVE  refused on our side: member door refused (pine:function) [runtime declined: pine:function]: this Pine function maps to nothing the engine grammar declares — `time(<timeframe>, <session>)`: `"2000-0000"` wraps past midnight (or spans the whole day). The capture read `"2000-0000"` as `na` on every bar it holds, but none of those bars opens after 20:00, so it cannot say whether such a window is empty or runs to midnight — and the two answer differently on a 24-hour symbol.
vw-time-session-spy-60-rth-2026-09-28        AMEX:SPY 60      0      INCONCLUSIVE  refused on our side: member door refused (pine:function) [runtime declined: pine:function]: this Pine function maps to nothing the engine grammar declares — `time(<timeframe>, <session>)`: `"2000-0000"` wraps past midnight (or spans the whole day). The capture read `"2000-0000"` as `na` on every bar it holds, but none of those bars opens after 20:00, so it cannot say whether such a window is empty or runs to midnight — and the two answer differently on a 24-hour symbol.
vw-time-tf-bitstamp-btcusd-1d-2026-09-30     BITSTAMP:BTCUSD  0      INCONCLUSIVE  refused on our side: member door refused (pine:input-kind) [runtime declined: pine:input-kind]: this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15 defaults would carry as numbers; the 5 that are expressions are item (c)'s — and the IR lane has no path for them yet, nor does any IR result reach a pane while ruling D2 stands. 6 reach a column, under the threshold
vw-time-tf-eurusd-1d-2026-10-02              FX:EURUSD 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:input-kind) [runtime declined: pine:input-kind]: this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15 defaults would carry as numbers; the 5 that are expressions are item (c)'s — and the IR lane has no path for them yet, nor does any IR result reach a pane while ruling D2 stands. 6 reach a column, under the threshold
vw-time-tf-fx-eurusd-1d-2026-10-01           FX:EURUSD 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:input-kind) [runtime declined: pine:input-kind]: this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15 defaults would carry as numbers; the 5 that are expressions are item (c)'s — and the IR lane has no path for them yet, nor does any IR result reach a pane while ruling D2 stands. 6 reach a column, under the threshold
vw-time-tf-rddt-1d-2026-10-02                NYSE:RDDT 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:input-kind) [runtime declined: pine:input-kind]: this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15 defaults would carry as numbers; the 5 that are expressions are item (c)'s — and the IR lane has no path for them yet, nor does any IR result reach a pane while ruling D2 stands. 6 reach a column, under the threshold
vw-time-tf-spy-1-2026-10-02                  AMEX:SPY 1       0      INCONCLUSIVE  refused on our side: member door refused (pine:input-kind) [runtime declined: pine:input-kind]: this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15 defaults would carry as numbers; the 5 that are expressions are item (c)'s — and the IR lane has no path for them yet, nor does any IR result reach a pane while ruling D2 stands. 6 reach a column, under the threshold
vw-time-tf-spy-15-2026-10-01                 AMEX:SPY 15      0      INCONCLUSIVE  refused on our side: member door refused (pine:input-kind) [runtime declined: pine:input-kind]: this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15 defaults would carry as numbers; the 5 that are expressions are item (c)'s — and the IR lane has no path for them yet, nor does any IR result reach a pane while ruling D2 stands. 6 reach a column, under the threshold
vw-time-tf-spy-1d-2026-09-28                 AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:input-kind) [runtime declined: pine:input-kind]: this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15 defaults would carry as numbers; the 5 that are expressions are item (c)'s — and the IR lane has no path for them yet, nor does any IR result reach a pane while ruling D2 stands. 6 reach a column, under the threshold
vw-time-tf-spy-1d-full-2026-10-01            AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:input-kind) [runtime declined: pine:input-kind]: this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15 defaults would carry as numbers; the 5 that are expressions are item (c)'s — and the IR lane has no path for them yet, nor does any IR result reach a pane while ruling D2 stands. 6 reach a column, under the threshold
vw-time-tf-spy-1d-full-2026-10-02            AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:input-kind) [runtime declined: pine:input-kind]: this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15 defaults would carry as numbers; the 5 that are expressions are item (c)'s — and the IR lane has no path for them yet, nor does any IR result reach a pane while ruling D2 stands. 6 reach a column, under the threshold
vw-time-tf-spy-1m-2026-10-01                 AMEX:SPY 1M      0      INCONCLUSIVE  refused on our side: member door refused (pine:input-kind) [runtime declined: pine:input-kind]: this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15 defaults would carry as numbers; the 5 that are expressions are item (c)'s — and the IR lane has no path for them yet, nor does any IR result reach a pane while ruling D2 stands. 6 reach a column, under the threshold
vw-time-tf-spy-1m-2026-10-02                 AMEX:SPY 1M      0      INCONCLUSIVE  refused on our side: member door refused (pine:input-kind) [runtime declined: pine:input-kind]: this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15 defaults would carry as numbers; the 5 that are expressions are item (c)'s — and the IR lane has no path for them yet, nor does any IR result reach a pane while ruling D2 stands. 6 reach a column, under the threshold
vw-time-tf-spy-1w-2026-10-01                 AMEX:SPY 1W      0      INCONCLUSIVE  refused on our side: member door refused (pine:input-kind) [runtime declined: pine:input-kind]: this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15 defaults would carry as numbers; the 5 that are expressions are item (c)'s — and the IR lane has no path for them yet, nor does any IR result reach a pane while ruling D2 stands. 6 reach a column, under the threshold
vw-time-tf-spy-1w-2026-10-02                 AMEX:SPY 1W      0      INCONCLUSIVE  refused on our side: member door refused (pine:input-kind) [runtime declined: pine:input-kind]: this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15 defaults would carry as numbers; the 5 that are expressions are item (c)'s — and the IR lane has no path for them yet, nor does any IR result reach a pane while ruling D2 stands. 6 reach a column, under the threshold
vw-time-tf-spy-240-2026-10-02                AMEX:SPY 240     0      INCONCLUSIVE  refused on our side: member door refused (pine:input-kind) [runtime declined: pine:input-kind]: this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15 defaults would carry as numbers; the 5 that are expressions are item (c)'s — and the IR lane has no path for them yet, nor does any IR result reach a pane while ruling D2 stands. 6 reach a column, under the threshold
vw-time-tf-spy-30-2026-10-02                 AMEX:SPY 30      0      INCONCLUSIVE  refused on our side: member door refused (pine:input-kind) [runtime declined: pine:input-kind]: this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15 defaults would carry as numbers; the 5 that are expressions are item (c)'s — and the IR lane has no path for them yet, nor does any IR result reach a pane while ruling D2 stands. 6 reach a column, under the threshold
vw-time-tf-spy-5-2026-10-01                  AMEX:SPY 5       0      INCONCLUSIVE  refused on our side: member door refused (pine:input-kind) [runtime declined: pine:input-kind]: this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15 defaults would carry as numbers; the 5 that are expressions are item (c)'s — and the IR lane has no path for them yet, nor does any IR result reach a pane while ruling D2 stands. 6 reach a column, under the threshold
vw-time-tf-spy-5-ext-2026-10-02              AMEX:SPY 5       0      INCONCLUSIVE  refused on our side: member door refused (pine:input-kind) [runtime declined: pine:input-kind]: this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15 defaults would carry as numbers; the 5 that are expressions are item (c)'s — and the IR lane has no path for them yet, nor does any IR result reach a pane while ruling D2 stands. 6 reach a column, under the threshold
vw-time-tf-spy-60-2026-09-28                 AMEX:SPY 60      0      INCONCLUSIVE  refused on our side: member door refused (pine:input-kind) [runtime declined: pine:input-kind]: this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15 defaults would carry as numbers; the 5 that are expressions are item (c)'s — and the IR lane has no path for them yet, nor does any IR result reach a pane while ruling D2 stands. 6 reach a column, under the threshold
vw-type-word-names-spy-1d-2026-10-02         AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:type) [runtime declined: runtime:call-undeclared-builtin-state]: a user-defined type is outside the node shapes this engine stores — `color.r`
vw-var-seed-spy-1d-2026-09-28                AMEX:SPY 1D      7      MATCH         all 8 items agree
    V00_bar_index_CONTROL                    MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    V01_history_never_fires                  MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    V02_bare_never_fires_CONTROL             MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    V03_nz_guarded_history                   MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    V04_mixed_bar0_takes_history_arm         MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    V05_plain_history_never_fires            MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    V06_mixed_two_lag_unguarded              MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
w4-cross-round-spy-1d-2026-09-30             AMEX:SPY 1D      16     INCONCLUSIVE  10 of 17 items could not be compared
    X00_bar_index                            INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    X01_crossover_close_sma5                 MATCH         cmp 300 ok 295 warm 5/6 steady 0/294 maxRel 0.00e+0
    X02_crossunder_close_sma5                MATCH         cmp 300 ok 295 warm 5/6 steady 0/294 maxRel 0.00e+0
    X03_cross_EITHER_DIRECTION               MATCH         cmp 300 ok 295 warm 5/6 steady 0/294 maxRel 0.00e+0
    X04_rising3                              MATCH         cmp 300 ok 297 warm 3/3 steady 0/297 maxRel 0.00e+0
    X05_falling3                             MATCH         cmp 300 ok 297 warm 3/3 steady 0/297 maxRel 0.00e+0
    X06_round_2p5_HALF_UP_OR_EVEN            INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    X07_round_3p5_THE_SAME_QUESTION          INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    X08_round_neg2p5_WHICH_WAY               INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    X09_round_negHalf_IS_IT_MINUS_ZERO       INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    X10_round_close_2dp                      MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    X11_sign_of_zero                         INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    X12_mintick                              INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    X13_pointvalue                           INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    X14_in_seconds_D                         INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    X15_tf_multiplier                        INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
wyckoff-accumulation-distribution-rddt-1d-20 NYSE:RDDT 1D     8      INCONCLUSIVE  8 of 10 items could not be compared
    The Selling Climax                       INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    Automatic Rally                          INCONCLUSIVE   — our side produced no column for this plot — the translator refused this plot (pine:state)
    the Secondary Test                       INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    The Buying Climax                        INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    Automatic Reaction                       INCONCLUSIVE   — our side produced no column for this plot — the translator refused this plot (pine:state)
    The Secondary Test                       INCONCLUSIVE   — our side produced no column for this plot — the translator refused this plot (pine:state)
    pivotHigh                                INCONCLUSIVE   — our side produced no column for this plot — the translator refused this plot (pine:state)
    pivotLow                                 INCONCLUSIVE   — our side produced no column for this plot — the translator refused this plot (pine:state)
    objects                                  MATCH         object counts and texts agree; colours agree on 36 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
wyckoff-accumulation-distribution-spy-1d-202 AMEX:SPY 1D      8      DIVERGE       1 of 10 compared items diverge
    The Selling Climax                       INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    Automatic Rally                          INCONCLUSIVE   — our side produced no column for this plot — the translator refused this plot (pine:state)
    the Secondary Test                       INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    The Buying Climax                        INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    Automatic Reaction                       INCONCLUSIVE   — our side produced no column for this plot — the translator refused this plot (pine:state)
    The Secondary Test                       INCONCLUSIVE   — our side produced no column for this plot — the translator refused this plot (pine:state)
    pivotHigh                                INCONCLUSIVE   — our side produced no column for this plot — the translator refused this plot (pine:state)
    pivotLow                                 INCONCLUSIVE   — our side produced no column for this plot — the translator refused this plot (pine:state)
    objects                                  INCONCLUSIVE  our object lane did not run: withheld by name (runtime:calc-bars-count) — this script runs on its last 1000 bars only (`calc_bars_count = 1000`), and this chart holds 1800; its drawings from a run over every bar would be a different picture. Nothing is drawn rather than a guess.
    paints                                   DIVERGE       1 paint differs (first: barcolor plot_0 "Bar Color" notDrawn)
zero-lag-ma-trend-levels-chartprime-spy-1d-2 AMEX:SPY 1D      4      DIVERGE       Plot: bar 30 t=1568813400 value vendor=300.9372486430757 ours=299.9784825859117
    Plot                                     DIVERGE       cmp 1800 ok 1670 warm 30/30 steady 100/1770 maxRel 4.28e-3 — 100 steady-state bars disagree; first at bar 30 (value: vendor 300.9372486430757 vs ours 299.9784825859117) — a CONVERGING PREFIX: bars 30..131 (with agreeing bars inside the run) differ with |err| falling 9.59e-1 → 3.58e-7, then all 1668 later bars agree (the recursive-state-seeded-at-the-window signature)
    Plot                                     DIVERGE       cmp 1800 ok 1675 warm 15/15 steady 110/1785 maxRel 2.81e-3 — 110 steady-state bars disagree; first at bar 15 (value: vendor 289.6875400008538 vs ours 288.9735) — a CONVERGING PREFIX: bars 15..124 differ with |err| falling 7.14e-1 → 3.41e-7, then all 1675 later bars agree (the recursive-state-seeded-at-the-window signature)
    plot_8                                   DIVERGE       cmp 1800 ok 1798 warm 1/31 steady 1/1769 maxRel 1.68e-4 — 1 steady-state bars disagree; first at bar 50 (value: vendor 295.46368668099973 vs ours 295.4140020102604) — scattered, last at bar 50
    plot_10                                  DIVERGE       cmp 1800 ok 1798 warm 0/31 steady 2/1769 maxRel 5.13e-10 — 2 steady-state bars disagree; first at bar 39 (na: vendor na vs ours 296.79022696496173) — scattered, last at bar 40
    objects                                  DIVERGE       3 object families differ (count or text); colours agree on 58 paired slots; coordinates are NOT compared by v1
zero-lag-ma-trend-levels-rddt-1d-2026-09-27  NYSE:RDDT D      4      MATCH         all 5 items agree
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 4.96e-16
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 3.87e-16
    plot_8                                   MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 4.91e-16
    plot_10                                  MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 4.95e-16
    objects                                  MATCH         object counts and texts agree; colours agree on 55 paired slots (13 theme-relative); 15 slots on objects neither side draws not graded; coordinates are NOT compared by v1

TOTAL 336 captures — MATCH 108 · DIVERGE 108 · INCONCLUSIVE 120
WITHOUT OBJECT COLOUR (the verdict before C44; colour graded on 115 captures) — MATCH 108 · DIVERGE 108 · INCONCLUSIVE 120
CHANGED BY OBJECT COLOUR (0): none
WITHOUT PAINTS (the verdict before B1; paints graded on 41 captures) — MATCH 109 · DIVERGE 103 · INCONCLUSIVE 124
CHANGED BY PAINTS (5): supertrend-strategy-rddt-1d-2026-10-02 INCONCLUSIVE → DIVERGE; supertrend-strategy-spy-1d-2026-10-02 INCONCLUSIVE → DIVERGE; vw-bgcolor-barcolor-spy-1d-2026-10-02 MATCH → DIVERGE; vw-deadband-ticks-brk-a-1d-2026-09-28 INCONCLUSIVE → DIVERGE; wyckoff-accumulation-distribution-spy-1d-2026-10-02 INCONCLUSIVE → DIVERGE
```

## Runtime declines by code (77)

- `pine:input-kind` 18
- `pine:builtin` 15
- `pine:function` 14
- `lower-tf:store-unmeasured` 5
- `runtime:library` 5
- `runtime:request` 3
- `lower-tf:unwitnessed` 2
- `pine:arity` 2
- `pine:collection` 2
- `pine:colour-value` 2
- `pine:drawing` 2
- `runtime:loop` 2
- `runtime:statement` 2
- `runtime:call-undeclared-builtin-state` 1
- `runtime:colour` 1
- `runtime:object-op` 1

## Not comparable (0)

