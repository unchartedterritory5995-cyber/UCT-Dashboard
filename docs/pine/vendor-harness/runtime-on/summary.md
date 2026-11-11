# Vendor harness — verdicts

Directories: `tests/fixtures/vendor`

Lane: **runtime-on**. LANE MEASURED: runtime-on (gate OPEN, runtime lane reached 106, host refusals 106) · objects-only pane ARMED · runtime drew 38, declined 68

```
capture                                      symbol/tf        plots  verdict       first divergence / reason
-------------------------------------------- ---------------- ------ ------------- ----------------------------------------
adx-and-di-for-v4-rddt-1d-2026-09-27         NYSE:RDDT D      3      MATCH         all 4 items agree
    DI+                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    DI-                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    ADX                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 2.34e-15
    objects                                  MATCH         neither side draws an object
adx-and-di-for-v4-spy-1d-2026-10-03          AMEX:SPY 1D      3      MATCH         all 4 items agree
    DI+                                      MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    DI-                                      MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    ADX                                      MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.55e-15
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
artemis-oscillator-pro-spy-1d-2026-10-03     AMEX:SPY 1D      12     DIVERGE       1 of 14 compared items diverge
    VP Bull                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 8.03e-16
    VP Bear                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.85e-15
    VP Base                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    DRM Oscillator                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.61e-15
    Signal Line                              MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.26e-15
    Bull Cross Dot                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.26e-15
    Bear Cross Dot                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 7.26e-16
    OB Level                                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    OS Level                                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 608 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
atr-bands-rddt-1d-2026-10-02                 NYSE:RDDT 1D     4      MATCH         all 5 items agree
    Upper ATR Band                           MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.21e-16
    Lower ATR Band                           MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.02e-16
    Upper Take-Profit Band                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Lower Take-Profit Band                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; no colour slot was paired, so no colour was graded; coordinates are NOT compared by v1
atr-bands-spy-1d-2026-10-03                  AMEX:SPY 1D      4      MATCH         all 5 items agree
    Upper ATR Band                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.21e-16
    Lower ATR Band                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.19e-16
    Upper Take-Profit Band                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Lower Take-Profit Band                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; no colour slot was paired, so no colour was graded; coordinates are NOT compared by v1
atr-stepped-pdf-ma-loxx-rddt-1d-2026-10-03   NYSE:RDDT 1D     3      INCONCLUSIVE  2 of 5 items could not be compared
    ATR-Stepped, PDF MA                      MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.67e-16
    Long                                     INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    Short                                    INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         1 paint agree bar for bar
atr-support-and-resistance-rddt-1d-2026-09-2 NYSE:RDDT 1D     9      INCONCLUSIVE  1 of 11 items could not be compared
    Impulse Up                               MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Impulse Down                             MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    RSI Mid Line Support                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    RSI Mid Line Resistance                  MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    RSI Overbought                           MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    RSI Oversold                             MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Ran Previous High                        MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Ran Previous Low                         MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Moving Average                           MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  INCONCLUSIVE  our lines, boxes are withheld by name (objects:not-carried: No line or box is shown on this chart: the script makes them in steps this chart can't follow yet, so none are drawn here, though TradingView may draw some.); every other object family's counts and texts agree
    paints                                   MATCH         4 paints agree bar for bar
atr-support-and-resistance-spy-1d-2026-10-03 AMEX:SPY 1D      9      INCONCLUSIVE  1 of 11 items could not be compared
    Impulse Up                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Impulse Down                             MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    RSI Mid Line Support                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    RSI Mid Line Resistance                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    RSI Overbought                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    RSI Oversold                             MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Ran Previous High                        MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Ran Previous Low                         MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Moving Average                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  INCONCLUSIVE  our lines, boxes are withheld by name (objects:not-carried: No line or box is shown on this chart: the script makes them in steps this chart can't follow yet, so none are drawn here, though TradingView may draw some.); every other object family's counts and texts agree
    paints                                   MATCH         4 paints agree bar for bar
atr-trailing-stop-by-ceyhun-rddt-1d-2026-10- NYSE:RDDT 1D     4      DIVERGE       1 of 6 compared items diverge
    Fast Trail                               MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.17e-16
    Slow Trail                               MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.66e-16
    BUY                                      MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    SELL                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 1 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 4 drawing steps (dropped: create:label ×2; pine:function)
    paints                                   MATCH         1 paint agree bar for bar
atr-trailing-stop-by-ceyhun-spy-1d-2026-10-0 AMEX:SPY 1D      4      DIVERGE       1 of 6 compared items diverge
    Fast Trail                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.04e-16
    Slow Trail                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.19e-16
    BUY                                      MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    SELL                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 1 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 4 drawing steps (dropped: create:label ×2; pine:function)
    paints                                   MATCH         1 paint agree bar for bar
atr-trailing-stoploss-rddt-1d-2026-09-27     NYSE:RDDT D      3      MATCH         all 5 items agree
    ATR Trailing Stoploss                    MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 2.80e-16
    BUY                                      MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    SELL                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         1 paint agree bar for bar
atr-trailing-stoploss-spy-1d-2026-10-03      AMEX:SPY 1D      3      MATCH         all 5 items agree
    ATR Trailing Stoploss                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.19e-16
    BUY                                      MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    SELL                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
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
    LH                                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    LL                                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    HL                                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
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
    ADR 1 Resistance                         MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    ADR 1 Support                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    ADR 2 Resistance                         MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    ADR 2 Support                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
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
btc-charlie-trader-xo-macro-trend-scanner-sp AMEX:SPY 1D      5      MATCH         all 7 items agree
    Consolidated EMA                         MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Fast EMA                                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 4.77e-16
    Slow EMA                                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.35e-15
    Bull                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bear                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
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
    Bearish Harami                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bullish Harami                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bearish Engulfing                        MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bullish Engulfing                        MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Piercing Line                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bullish Belt                             MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bullish Kicker                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bearish Kicker                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Hanging Man                              MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Evening Star                             MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Morning Star                             MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Shooting Star                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
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
    Lower Channel                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.37e-15
    Upper Channel                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.41e-15
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.44e-15
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.49e-15
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.48e-15
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.54e-15
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.46e-15
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.49e-15
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.48e-15
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.50e-15
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.55e-15
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.69e-15
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.44e-15
    objects                                  MATCH         neither side draws an object
contraction-box-doji-lines-rddt-1d-2026-09-2 NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 82 paired slots; 96 slots on objects neither side draws not graded; coordinates are NOT compared by v1
contraction-box-doji-lines-spy-1d-2026-10-03 AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       1 object families differ (count or text); colours agree on 208 paired slots; 102 slots on objects neither side draws not graded; coordinates are NOT compared by v1
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
cpr-with-mas-super-trend-vwap-by-guruprasadm AMEX:SPY 1D      29     MATCH         all 30 items agree
    CP                                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    BC                                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    TC                                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D-S1                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D-S2                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D-S3                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D-R1                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
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
    SMA                                      MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.06e-15
    EMA                                      MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.36e-15
    VWAP                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.98e-16
    SuperTrend                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.18e-16
    Up Arrow                                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Down Arrow                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
cumulative-volume-delta-rddt-1d-2026-09-27   NYSE:RDDT D      4      MATCH         all 5 items agree
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 7.58e-16
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 8.08e-16
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 9.92e-16
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 6.55e-13
    objects                                  MATCH         neither side draws an object
cumulative-volume-delta-spy-1d-2026-10-03    AMEX:SPY 1D      4      MATCH         all 5 items agree
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 8.13e-16
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 7.24e-16
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 9.90e-16
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 3.69e-13
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
    Buy                                      INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for value (runtime:limit)
    Sell                                     INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2 (runtime:limit)
    Exit Long                                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3 (runtime:limit)
    Exit Short                               INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4 (runtime:limit)
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
    Basis                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Upper Donchian                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Upper Donchian | Inner                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Upper .786                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Upper Mid                                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Upper.702                                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Upper .382                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Lower .382                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Lower .702                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Lower Mid                                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Lower .786                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Lower Donchian | Inner                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Lower Donchian                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
dual-view-htf-candlestick-patterns-theultima NYSE:RDDT 1D     1      DIVERGE       1 of 2 compared items diverge
    HTF MA                                   MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 436 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (coll:diverged, guard:copy, guard:delete, guard:loop, loop:bounds)
dual-view-htf-candlestick-patterns-theultima AMEX:SPY 1D      1      DIVERGE       1 of 2 compared items diverge
    HTF MA                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 272 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (coll:diverged, guard:copy, guard:delete, guard:loop, loop:bounds)
elliott-wave-3-finder-v2-rddt-1d-2026-09-28  NYSE:RDDT 1D     1      MATCH         all 3 items agree
    Plot                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 2.63e-12
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         2 paints agree bar for bar
elliott-wave-3-finder-v2-spy-1d-2026-10-03   AMEX:SPY 1D      1      MATCH         all 3 items agree
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.57e-11
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
ema-ribbon-trend-filter-strixedge-spy-1d-202 AMEX:SPY 1D      13     DIVERGE       1 of 15 compared items diverge
    Fast EMA                                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 4.20e-16
    Mid EMA                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.04e-15
    Slow EMA                                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.39e-15
    F×M ▲                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    F×M ▼                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    F×S ▲                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    F×S ▼                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    M×S ▲                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    M×S ▼                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Squeeze Start                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 9.46e-16
    Squeeze Release ▲                        MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Squeeze Release ▼                        MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Squeeze Release ◆                        MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.64e-16
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 73 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         2 paints agree bar for bar
engulfingcandle-rddt-1d-2026-09-27           NYSE:RDDT D      2      MATCH         all 3 items agree
    bullish                                  MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    bearish                                  MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
engulfingcandle-spy-1d-2026-10-03            AMEX:SPY 1D      2      MATCH         all 3 items agree
    bullish                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    bearish                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
extrapolated-pivot-connector-rddt-1d-2026-09 NYSE:RDDT 1D     2      MATCH         all 3 items agree
    Pivot High's                             MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Pivot Low's                              MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 10 paired slots; coordinates are NOT compared by v1
extrapolated-pivot-connector-spy-1d-2026-10- AMEX:SPY 1D      2      MATCH         all 3 items agree
    Pivot High's                             MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Pivot Low's                              MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
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
    Chars                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Chars                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
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
    PP                                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    R1                                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    R2                                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    R3                                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    S1                                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    S2                                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    S3                                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
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
h3-alma-v4-spy-1d-2026-10-02                 AMEX:SPY 1D      8      MATCH         all 9 items agree
    A00_bar_index_CONTROL                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    A01_alma_close_9_085_6_RAW               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 5.30e-16
    A02_reference_close_9_085_6_RAW          MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.66e-16
    A03_alma_MINUS_reference_MUST_BE_0       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.00e+0
    A04_high_20_MINUS_reference_MUST_BE_0    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.00e+0
    A05_low_14_05_2_MINUS_reference_MUST_BE_ MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.00e+0
    A06_offset_1_MINUS_reference_MUST_BE_0   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.00e+0
    A07_alma_is_na                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
h3-vwap-source-spy-1d-2026-10-02             AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:arity) [runtime declined: pine:arity]: the engine grammar declares a different signature for that name — `ta.vwap` was given a source this table cannot weigh: the session VWAP is carried for a price the bar itself holds (`close`, `open`, `high`, `low`, `hl2`, `hlc3`, `ohlc4`, `hlcc4`) — vwap() / vwapOf(series). A computed source can be `na` on a bar, and what TradingView's session sum does with an `na` term has not been measured. TO UNBLOCK: weigh a bar price, e.g. `ta.vwap(close)`
h3-vwap-source-spy-5-2026-10-02              AMEX:SPY 5       0      INCONCLUSIVE  refused on our side: member door refused (pine:arity) [runtime declined: pine:arity]: the engine grammar declares a different signature for that name — `ta.vwap` was given a source this table cannot weigh: the session VWAP is carried for a price the bar itself holds (`close`, `open`, `high`, `low`, `hl2`, `hlc3`, `ohlc4`, `hlcc4`) — vwap() / vwapOf(series). A computed source can be `na` on a bar, and what TradingView's session sum does with an `na` term has not been measured. TO UNBLOCK: weigh a bar price, e.g. `ta.vwap(close)`
heat-map-seasons-rddt-1d-2026-09-28          NYSE:RDDT 1D     1      DIVERGE       2 of 3 compared items diverge
    Plot                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 3.16e-14
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 34 paired slots; coordinates are NOT compared by v1
    paints                                   DIVERGE       1 paint differs (first: barcolor plot_0 "Bar Color" withheld (`barcolor`'s colour is an expression this door cannot carry yet))
heat-map-seasons-spy-1d-2026-10-03           AMEX:SPY 1D      1      DIVERGE       2 of 3 compared items diverge
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.00e-12
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
high-low-open-mid-ranges-spy-1d-2026-10-03   AMEX:SPY 1D      7      MATCH         all 8 items agree
    plot_0                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_2                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_4                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_6                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_8                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_10                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_12                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 1588 paired slots; 16 slots on objects neither side draws not graded; coordinates are NOT compared by v1
htf-candle-footprint-cartel-console-rddt-1d- NYSE:RDDT 1D     0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       1 object families differ (count or text); colours agree on 12 paired slots; coordinates are NOT compared by v1
htf-candle-footprint-cartel-console-spy-1d-2 AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       1 object families differ (count or text); colours agree on 12 paired slots; coordinates are NOT compared by v1
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
    Volatility Data                          MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 7.12e-13
    objects                                  MATCH         neither side draws an object
inside-bar-range-mother-candle-breakoutbreak NYSE:RDDT 1D     2      MATCH         all 4 items agree
    Shapes                                   MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Shapes                                   MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 2 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         2 paints agree bar for bar
inside-bar-range-mother-candle-breakoutbreak AMEX:SPY 1D      2      MATCH         all 4 items agree
    Shapes                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Shapes                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 2 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         2 paints agree bar for bar
institutional-smc-order-flow-matrix-pro-rddt NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 92 paired slots; coordinates are NOT compared by v1
institutional-smc-order-flow-matrix-pro-spy- AMEX:SPY 1D      0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 1105 paired slots; coordinates are NOT compared by v1
k-clustering-rddt-1d-2026-09-28              NYSE:RDDT 1D     0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 11 paired slots; coordinates are NOT compared by v1
k-clustering-spy-1d-2026-10-03               AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 11 paired slots; coordinates are NOT compared by v1
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
keltner-center-of-gravity-channel-spy-1d-202 AMEX:SPY 1D      18     MATCH         all 19 items agree
    extra high line                          MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    outerhigh                                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.17e-16
    innerhigh                                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    coghigh                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    coglow                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    innerlow                                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    outerlow                                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.22e-16
    extra low line                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Up Trend                                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Down Trend                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Support/Resistance Level                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    outhi                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    inhi                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    coghi                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    cogl                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    inlow                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    outlow                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    HMA                                      MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
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
keltner-channels-bands-spy-1d-2026-10-03     AMEX:SPY 1D      7      MATCH         all 8 items agree
    Basis                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.09e-16
    Upper 1                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 5.95e-16
    Lower 1                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.25e-16
    Upper 2                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.35e-16
    Lower 2                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 7.86e-16
    Upper 3                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.30e-16
    Lower 3                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 8.09e-16
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
    Strategy Signal                          MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Shapes                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Shapes                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
liquidity-heatmap-nephew-sam-rddt-1d-2026-09 NYSE:RDDT 1D     0      INCONCLUSIVE  1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our labels are withheld by name (objects:not-carried: No label is shown on this chart: the script makes them in steps this chart can't follow yet, so none are drawn here, though TradingView may draw some.); every other object family's counts and texts agree
liquidity-heatmap-nephew-sam-spy-1d-2026-10- AMEX:SPY 1D      0      INCONCLUSIVE  1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our labels are withheld by name (objects:not-carried: No label is shown on this chart: the script makes them in steps this chart can't follow yet, so none are drawn here, though TradingView may draw some.); every other object family's counts and texts agree
liquidity-pools-rddt-1d-2026-09-28           NYSE:RDDT 1D     2      MATCH         all 3 items agree
    Swing High                               MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Swing Low                                MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 364 paired slots; coordinates are NOT compared by v1
liquidity-pools-spy-1d-2026-10-03            AMEX:SPY 1D      2      MATCH         all 3 items agree
    Swing High                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Swing Low                                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 1512 paired slots; coordinates are NOT compared by v1
macd-shortlong-strategy-for-tradingview-inpu NYSE:RDDT 1D     6      MATCH         all 7 items agree
    Histogram Long                           MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 4.39e-12
    MACD Long                                MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 4.64e-12
    Signal Long                              MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.48e-12
    Histogram Short                          MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 6.84e-11
    MACD Short                               MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 6.86e-12
    Signal Short                             MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.34e-12
    objects                                  MATCH         neither side draws an object
macd-shortlong-strategy-for-tradingview-inpu AMEX:SPY 1D      6      MATCH         all 7 items agree
    Histogram Long                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 5.70e-10
    MACD Long                                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.04e-10
    Signal Long                              MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 4.71e-11
    Histogram Short                          MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.31e-9
    MACD Short                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 7.77e-11
    Signal Short                             MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.03e-11
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
madrid-moving-average-ribbon-spy-1d-2026-10- AMEX:SPY 1D      18     MATCH         all 19 items agree
    MMA05                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 4.44e-16
    MMA10                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.74e-16
    MMA15                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 5.59e-16
    MMA20                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.09e-16
    MMA25                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.35e-15
    MMA30                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.79e-15
    MMA35                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.14e-15
    MMA40                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.75e-15
    MMA45                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.22e-15
    MMA50                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.36e-15
    MMA55                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.39e-15
    MMA60                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.01e-15
    MMA65                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.77e-15
    MMA70                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.51e-15
    MMA75                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.19e-15
    MMA80                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.37e-15
    MMA85                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.78e-15
    MMA90                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 3.02e-15
    objects                                  MATCH         neither side draws an object
makuchaku039s-trade-tools-fair-value-gaps-rd NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 102 paired slots; coordinates are NOT compared by v1
makuchaku039s-trade-tools-fair-value-gaps-sp AMEX:SPY 1D      0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 102 paired slots; coordinates are NOT compared by v1
market-structure-by-leviathan-rddt-1d-2026-0 NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 50 paired slots (16 theme-relative); coordinates are NOT compared by v1
market-structure-by-leviathan-spy-1d-2026-10 AMEX:SPY 1D      0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 853 paired slots (251 theme-relative); coordinates are NOT compared by v1
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
momentum-volatility-scanner-spy-1d-2026-10-0 AMEX:SPY 1D      11     MATCH         all 12 items agree
    Momentum Line                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Momentum Area                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Momentum Histogram                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 9.23e-12
    Vol Upper                                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 7.80e-11
    Vol Lower                                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 7.80e-11
    Bullish Shift                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bearish Shift                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Extreme Bull                             MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Extreme Bear                             MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bull Divergence                          MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bear Divergence                          MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 25 paired slots; coordinates are NOT compared by v1
multi-timeframe-supply-demand-zones-rddt-1d- NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; no colour slot was paired, so no colour was graded; 1008 slots on objects neither side draws not graded (16 of them hold a colour that differs); coordinates are NOT compared by v1
multi-timeframe-supply-demand-zones-spy-1d-2 AMEX:SPY 1D      0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; no colour slot was paired, so no colour was graded; 1008 slots on objects neither side draws not graded (12 of them hold a colour that differs); coordinates are NOT compared by v1
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
    EMA1                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    EMA2                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    EMA3                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    SMA1                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    SMA2                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    SMA3                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    ParabolicSAR                             MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Basis                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Upper                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Lower                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Conversion Line                          MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Base Line                                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Lagging Span                             MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Leading Span A                           MATCH         cmp 1775 ok 1775 warm 0/0 steady 0/1775 maxRel 0.00e+0
    Leading Span B                           MATCH         cmp 1775 ok 1775 warm 0/0 steady 0/1775 maxRel 0.00e+0
    Kumo Cloud Upper Line                    MATCH         cmp 1775 ok 1775 warm 0/0 steady 0/1775 maxRel 0.00e+0
    Kumo Cloud Lower Line                    MATCH         cmp 1775 ok 1775 warm 0/0 steady 0/1775 maxRel 0.00e+0
    VWAP                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Supertrend                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Donchian High                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Donchian Low                             MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Keltner Upper                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Keltner Lower                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Keltner Basis                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    RSI bull div                             MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    RSI bear div                             MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MACD bull div                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MACD bear div                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 72 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (coll:diverged, coll:push)
nadaraya-watson-rational-quadratic-kernel-no NYSE:RDDT 1D     2      INCONCLUSIVE  1 of 3 items could not be compared
    Rational Quadratic Kernel Estimate       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.59e-16
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
    Opening price                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    OR High                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    IB High                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
optimized-keltner-channels-sltp-strategy-for NYSE:RDDT 1D     5      MATCH         all 6 items agree
    Upper                                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 7.06e-16
    Basis                                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 6.00e-16
    Lower                                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 6.34e-16
    Plot                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Plot                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
optimized-keltner-channels-sltp-strategy-for AMEX:SPY 1D      5      MATCH         all 6 items agree
    Upper                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 7.01e-16
    Basis                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.86e-16
    Lower                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.94e-16
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
options-max-pain-calculator-backquant-rddt-1 NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 87 paired slots; coordinates are NOT compared by v1
options-max-pain-calculator-backquant-spy-1d AMEX:SPY 1D      0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 115 paired slots; coordinates are NOT compared by v1
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
pa-zigzag-fibonacci-fan-spy-1d-2026-10-03    AMEX:SPY 1D      9      MATCH         all 10 items agree
    zigzag                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
     0.000                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    -0.236                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    -0.382                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    -0.500                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    -0.618                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    -1.000                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    -1.618                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    -3.141                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
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
    PP SuperTrend                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.19e-16
    Buy                                      MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.80e-16
    Sell                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.68e-16
    Shapes                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Shapes                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
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
pmax-explorer-spy-1d-2026-10-02              AMEX:SPY 1D      7      DIVERGE       1 of 8 compared items diverge
    Buy                                      INCONCLUSIVE   — UNMAPPED — vendor title "Buy" is not unique in the study
    Sell                                     INCONCLUSIVE   — UNMAPPED — vendor title "Sell" is not unique in the study
    Buy                                      INCONCLUSIVE   — UNMAPPED — vendor title "Buy" is not unique in the study
    Sell                                     INCONCLUSIVE   — UNMAPPED — vendor title "Sell" is not unique in the study
    plot_12                                  INCONCLUSIVE   — UNMAPPED — title "" could not be paired unambiguously
    Moving Avg Line                          MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 7.05e-16
    PMax                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 7.60e-16
    objects                                  DIVERGE       TradingView holds 1 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 2 drawing steps (dropped: create:label ×1; pine:request)
poor-man039s-volume-profile-rddt-1d-2026-09- NYSE:RDDT 1D     0      INCONCLUSIVE  1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our labels are withheld by name (objects:not-computable: No label is shown on this chart: whether and where the script draws them depends on values this chart can't work out here, so none are drawn rather than a guess.); every other object family's counts and texts agree
poor-man039s-volume-profile-spy-1d-2026-10-0 AMEX:SPY 1D      0      INCONCLUSIVE  1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our labels are withheld by name (objects:not-computable: No label is shown on this chart: whether and where the script draws them depends on values this chart can't work out here, so none are drawn rather than a guess.); every other object family's counts and texts agree
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
    Entry                                    MATCH         cmp 1780 ok 1780 warm 0/0 steady 0/1780 maxRel 0.00e+0
    TP                                       MATCH         cmp 1780 ok 1780 warm 0/0 steady 0/1780 maxRel 0.00e+0
    SL                                       MATCH         cmp 1780 ok 1780 warm 0/0 steady 0/1780 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 8 paired slots; coordinates are NOT compared by v1
price-action-as-in-book-fibonacci-supportres NYSE:RDDT 1D     2      MATCH         all 3 items agree
    Pivot High                               MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Pivot Low                                MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 212 paired slots; coordinates are NOT compared by v1
price-action-as-in-book-fibonacci-supportres AMEX:SPY 1D      2      MATCH         all 3 items agree
    Pivot High                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Pivot Low                                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 516 paired slots; coordinates are NOT compared by v1
pro-trading-art-double-top-bottom-with-alert NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 35 paired slots; coordinates are NOT compared by v1
pro-trading-art-double-top-bottom-with-alert AMEX:SPY 1D      0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 510 paired slots; coordinates are NOT compared by v1
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
    QQE long                                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.09e-13
    QQE short                                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.54e-13
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
renko-candles-overlay-spy-1d-2026-10-03      AMEX:SPY 1D      0      MATCH         all 2 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 288 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
request-realtime-alignment-spy-5-2026-10-01  AMEX:SPY 5       8      INCONCLUSIVE  5 of 9 items could not be compared
    R1_close_D_lookahead_ON                  INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (request:other-timeframe) — nothing is drawn for it
    R2_close_D_lookahead_OFF                 INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (request:other-timeframe) — nothing is drawn for it
    R3_DELTA_on_minus_off                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (request:other-timeframe) — nothing is drawn for it
    R4_isrealtime                            MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    R5_islast                                MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    R6_chart_close                           MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    R7_prev_D_close_OFF                      INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (request:other-timeframe) — nothing is drawn for it
    R8_bar_index_CONTROL                     INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    objects                                  MATCH         neither side draws an object
request-realtime-alignment-spy-5-b-2026-10-0 AMEX:SPY 5       8      DIVERGE       R4_isrealtime: bar 299 t=1790884200 value vendor=1 ours=0
    R1_close_D_lookahead_ON                  INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (request:other-timeframe) — nothing is drawn for it
    R2_close_D_lookahead_OFF                 INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (request:other-timeframe) — nothing is drawn for it
    R3_DELTA_on_minus_off                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (request:other-timeframe) — nothing is drawn for it
    R4_isrealtime                            DIVERGE       cmp 301 ok 300 warm 0/0 steady 1/301 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 299 (value: vendor 1 vs ours 0) — scattered, last at bar 299
    R5_islast                                DIVERGE       cmp 301 ok 300 warm 0/0 steady 1/301 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 299 (value: vendor 1 vs ours 0) — scattered, last at bar 299
    R6_chart_close                           MATCH         cmp 301 ok 301 warm 0/0 steady 0/301 maxRel 0.00e+0
    R7_prev_D_close_OFF                      INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (request:other-timeframe) — nothing is drawn for it
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
reverse-stochastic-momentum-index-on-chart-s AMEX:SPY 1D      7      MATCH         all 8 items agree
    Scale High                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 8.04e-16
    High Alert                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 8.86e-16
    Low Alert                                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.85e-13
    Scale Low                                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.66e-13
    SMI EQ Price                             MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.00e-15
    Signal Line Cross                        MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.00e-15
    Zero Line Cross                          MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.48e-15
    objects                                  MATCH         object counts and texts agree; colours agree on 2 paired slots; coordinates are NOT compared by v1
rolling-vwap-rddt-1d-2026-10-03              NYSE:RDDT 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:module) [runtime declined: runtime:library]: importing another script pulls in code this engine never sees — the library `PineCoders/ConditionalAverages/2` is not in this engine's library registry, so its code cannot be compiled
rolling-vwap-spy-1d-2026-10-03               AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:module) [runtime declined: runtime:library]: importing another script pulls in code this engine never sees — the library `PineCoders/ConditionalAverages/2` is not in this engine's library registry, so its code cannot be compiled
rsi-horizontal-resistance-levels-rddt-1d-202 NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 5 paired slots; coordinates are NOT compared by v1
rsi-horizontal-resistance-levels-spy-1d-2026 AMEX:SPY 1D      0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 5 paired slots; coordinates are NOT compared by v1
rsi-swing-indicator-rddt-1d-2026-09-28       NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 32 paired slots; 1 slot on objects neither side draws not graded; coordinates are NOT compared by v1
rsi-swing-indicator-spy-1d-2026-10-03        AMEX:SPY 1D      0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 150 paired slots; coordinates are NOT compared by v1
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
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
sector-rotation-rddt-1d-2026-09-28           NYSE:RDDT 1D     1      INCONCLUSIVE  1 of 2 items could not be compared
    Current Symbol Percentage Change         MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.95e-16
    objects                                  INCONCLUSIVE  our lines, boxes are withheld by name (objects:collector-all, objects:not-carried: No box is shown on this chart: the script makes them in steps this chart can't follow yet, so none are drawn here, though TradingView may draw some.); every other object family's counts and texts agree
sector-rotation-spy-1d-2026-10-03            AMEX:SPY 1D      1      INCONCLUSIVE  1 of 2 items could not be compared
    Current Symbol Percentage Change         MATCH         cmp 1800 ok 1799 warm 1/1 steady 0/1799 maxRel 1.95e-16
    objects                                  INCONCLUSIVE  our lines, boxes are withheld by name (objects:collector-all, objects:not-carried: No box is shown on this chart: the script makes them in steps this chart can't follow yet, so none are drawn here, though TradingView may draw some.); every other object family's counts and texts agree
smt-divergence-ict-01-tradingfinder-smart-mo NYSE:RDDT 1D     0      INCONCLUSIVE  1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our lines, labels are withheld by name (objects:not-computable: No line or label is shown on this chart: whether and where the script draws them depends on values this chart can't work out here, so none are drawn rather than a guess.); every other object family's counts and texts agree
smt-divergence-ict-01-tradingfinder-smart-mo AMEX:SPY 1D      0      INCONCLUSIVE  1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our lines, labels are withheld by name (objects:not-computable: No line or label is shown on this chart: whether and where the script draws them depends on values this chart can't work out here, so none are drawn rather than a guess.); every other object family's counts and texts agree
sonarlab-order-blocks-aapl-1d-2026-10-02     NASDAQ:AAPL 1D   0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       TradingView holds 17 drawing object(s) at the last bar and our drawing is withheld by name (objects:off-listing) — the box drawings live in a `var` list, and on a chart that does not start at the symbol's listing the objects earlier bars put there are not knowable
sonarlab-order-blocks-brk-a-1d-2026-10-02    NYSE:BRK.A 1D    0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       TradingView holds 24 drawing object(s) at the last bar and our drawing is withheld by name (objects:off-listing) — the box drawings live in a `var` list, and on a chart that does not start at the symbol's listing the objects earlier bars put there are not knowable
sonarlab-order-blocks-rddt-1d-2026-10-02     NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 10 paired slots; coordinates are NOT compared by v1
sonarlab-order-blocks-spy-1d-2026-10-02      AMEX:SPY 1D      0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 48 paired slots; coordinates are NOT compared by v1
supertrend-kivancozbilgic-rddt-1d-2026-10-02 NYSE:RDDT 1D     7      INCONCLUSIVE  1 of 8 items could not be compared
    Up Trend                                 MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.71e-16
    UpTrend Begins                           MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.50e-16
    Buy                                      MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.50e-16
    Down Trend                               MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.13e-16
    DownTrend Begins                         MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.08e-16
    Sell                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.08e-16
    plot_6                                   INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (fill-anchor))
    objects                                  MATCH         neither side draws an object
supertrend-strategy-rddt-1d-2026-10-02       NYSE:RDDT 1D     7      INCONCLUSIVE  1 of 9 items could not be compared
    Up Trend                                 MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.71e-16
    UpTrend Begins                           MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.50e-16
    Buy                                      MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Down Trend                               MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.13e-16
    DownTrend Begins                         MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.08e-16
    Sell                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    plot_6                                   INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (fill-anchor))
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         1 paint agree bar for bar
supertrend-strategy-spy-1d-2026-10-02        AMEX:SPY 1D      7      INCONCLUSIVE  1 of 9 items could not be compared
    Up Trend                                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.18e-16
    UpTrend Begins                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.99e-16
    Buy                                      MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Down Trend                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.89e-16
    DownTrend Begins                         MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.86e-16
    Sell                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_6                                   INCONCLUSIVE  cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (fill-anchor))
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         1 paint agree bar for bar
support-and-resistance-multi-time-frame-rddt NYSE:RDDT 1D     6      DIVERGE       Resistance Weekly: bar 161 t=1731076200 na vendor=134.8 ours=na
    Resistance Daily                         MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Support Daily                            MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Resistance Weekly                        DIVERGE       cmp 636 ok 621 warm 0/0 steady 15/636 maxRel 1.23e-1 — 15 steady-state bars disagree; first at bar 161 (na: vendor 134.8 vs ours na) — scattered, last at bar 375
    Support Weekly                           DIVERGE       cmp 636 ok 633 warm 0/0 steady 3/636 maxRel 5.98e-2 — 3 steady-state bars disagree; first at bar 476 (na: vendor 127.705 vs ours na) — scattered, last at bar 509
    Resistance Monthly                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Support Monthly                          MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
support-and-resistance-multi-time-frame-spy- AMEX:SPY 1D      6      DIVERGE       Resistance Weekly: bar 27 t=1568381400 value vendor=302.46 ours=302.23
    Resistance Daily                         MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Support Daily                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Resistance Weekly                        DIVERGE       cmp 1800 ok 1665 warm 0/0 steady 135/1800 maxRel 1.41e-1 — 135 steady-state bars disagree; first at bar 27 (value: vendor 302.46 vs ours 302.23) — scattered, last at bar 1765
    Support Weekly                           DIVERGE       cmp 1800 ok 1787 warm 0/0 steady 13/1800 maxRel 4.68e-1 — 13 steady-state bars disagree; first at bar 152 (value: vendor 247.68 vs ours 233.76) — scattered, last at bar 1673
    Resistance Monthly                       DIVERGE       cmp 1800 ok 1754 warm 0/0 steady 46/1800 maxRel 5.37e-2 — 46 steady-state bars disagree; first at bar 38 (value: vendor 302.63 vs ours 302.23) — scattered, last at bar 1776
    Support Monthly                          DIVERGE       cmp 1800 ok 1799 warm 0/0 steady 1/1800 maxRel 6.93e-1 — 1 steady-state bars disagree; first at bar 164 (value: vendor 218.26 vs ours 67.10001) — scattered, last at bar 164
    objects                                  MATCH         neither side draws an object
support-and-resistance-rddt-1d-2026-10-02    NYSE:RDDT 1D     2      MATCH         all 3 items agree
    Plot                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Plot                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
support-and-resistance-spy-1d-2026-10-02     AMEX:SPY 1D      2      MATCH         all 3 items agree
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
swing-highlow-zigzag-chartprime-rddt-1d-2026 NYSE:RDDT 1D     1      MATCH         all 2 items agree
    Plot                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 18 paired slots (3 theme-relative); 1 slot on objects neither side draws not graded; coordinates are NOT compared by v1
swing-highlow-zigzag-chartprime-spy-1d-2026- AMEX:SPY 1D      1      MATCH         all 2 items agree
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 60 paired slots (3 theme-relative); 1 slot on objects neither side draws not graded; coordinates are NOT compared by v1
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
    %K                                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 4.46e-15
    %D                                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.16e-14
    objects                                  MATCH         neither side draws an object
tradingview-alerts-to-mt4-mt5-strategy-examp NYSE:RDDT 1D     2      MATCH         all 3 items agree
    %K                                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.86e-15
    %D                                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.61e-15
    objects                                  MATCH         object counts and texts agree; colours agree on 11 paired slots; coordinates are NOT compared by v1
tradingview-alerts-to-mt4-mt5-strategy-examp AMEX:SPY 1D      2      MATCH         all 3 items agree
    %K                                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 4.46e-15
    %D                                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.16e-14
    objects                                  MATCH         object counts and texts agree; colours agree on 11 paired slots; coordinates are NOT compared by v1
trend-duration-forecast-chartprime-rddt-1d-2 NYSE:RDDT 1D     1      MATCH         all 2 items agree
    HMA                                      MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 126 paired slots (22 theme-relative); coordinates are NOT compared by v1
trend-duration-forecast-chartprime-spy-1d-20 AMEX:SPY 1D      1      MATCH         all 2 items agree
    HMA                                      MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 180 paired slots (22 theme-relative); coordinates are NOT compared by v1
trend-lines-supports-and-resistances-rddt-1d NYSE:RDDT 1D     2      DIVERGE       1 of 3 compared items diverge
    High Pivots                              MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Low Pivots                               MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 14 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 6 drawing steps (dropped: never carried: box.new, label.delete, label.new, line.delete, line.new, line.set_color, line.set_extend, line.set_style)
trend-lines-supports-and-resistances-spy-1d- AMEX:SPY 1D      2      DIVERGE       1 of 3 compared items diverge
    High Pivots                              MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Low Pivots                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 11 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 6 drawing steps (dropped: never carried: box.new, label.delete, label.new, line.delete, line.new, line.set_color, line.set_extend, line.set_style)
trend-targets-algoalpha-rddt-1d-2026-10-02   NYSE:RDDT 1D     5      MATCH         all 7 items agree
    Bullish Rejection                        MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.95e-16
    Bearish Rejection                        MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 7.20e-16
    Baseline                                 MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.39e-15
    Bullish Trend Change                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.82e-16
    Bearish Trend Change                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 8.40e-16
    objects                                  MATCH         object counts and texts agree; colours agree on 15 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
trend-targets-algoalpha-spy-1d-2026-10-02    AMEX:SPY 1D      5      MATCH         all 7 items agree
    Bullish Rejection                        MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.57e-16
    Bearish Rejection                        MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.44e-16
    Baseline                                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 8.56e-16
    Bullish Trend Change                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 4.29e-16
    Bearish Trend Change                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 3.81e-16
    objects                                  MATCH         object counts and texts agree; colours agree on 15 paired slots; coordinates are NOT compared by v1
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
trendlines-spy-1d-2026-10-03                 AMEX:SPY 1D      8      MATCH         all 9 items agree
    Pivot High                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Pivot Low                                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Resistance Trendline                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Support Trendline                        MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Long Break                               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Short Break                              MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 52 paired slots; coordinates are NOT compared by v1
twin-range-filter-rddt-1d-2026-10-02         NYSE:RDDT 1D     2      MATCH         all 3 items agree
    Long                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Short                                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
twin-range-filter-spy-1d-2026-10-02          AMEX:SPY 1D      2      MATCH         all 3 items agree
    Long                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Short                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
ultimate-pivot-points-rddt-1d-2026-09-28     NYSE:RDDT 1D     3      MATCH         all 4 items agree
    PD_H                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    PD_L                                     MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Pivot                                    MATCH         cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 102 paired slots; 51 slots on objects neither side draws not graded; coordinates are NOT compared by v1
ultimate-pivot-points-spy-1d-2026-10-03      AMEX:SPY 1D      3      MATCH         all 4 items agree
    PD_H                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    PD_L                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Pivot                                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 102 paired slots; 51 slots on objects neither side draws not graded; coordinates are NOT compared by v1
vdubus-pattern-gen-v2-restored-refined-rddt- NYSE:RDDT 1D     0      MATCH         all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 122 paired slots; coordinates are NOT compared by v1
vdubus-pattern-gen-v2-restored-refined-spy-1 AMEX:SPY 1D      0      INCONCLUSIVE  1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our lines are withheld by name (TradingView's object limit may have removed some of them; objects:collector); every other object family's counts and texts agree
vold-market-breadth-rddt-1d-2026-09-28       NYSE:RDDT 1D     0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 2 paired slots; coordinates are NOT compared by v1
vold-market-breadth-spy-1d-2026-10-03        AMEX:SPY 1D      0      DIVERGE       1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 2 paired slots; coordinates are NOT compared by v1
volume-profile-rddt-1d-2026-09-28            NYSE:RDDT 1D     0      INCONCLUSIVE  1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our lines are withheld by name (objects:not-carried: No line is shown on this chart: the script makes them in steps this chart can't follow yet, so none are drawn here, though TradingView may draw some.); every other object family's counts and texts agree
volume-profile-spy-1d-2026-10-03             AMEX:SPY 1D      0      INCONCLUSIVE  1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our lines are withheld by name (objects:not-carried: No line is shown on this chart: the script makes them in steps this chart can't follow yet, so none are drawn here, though TradingView may draw some.); every other object family's counts and texts agree
vw-arm-history-rddt-1d-2026-10-02            NYSE:RDDT 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:roundtrip) [runtime declined: runtime:conditional-history]: the translator wrote formula text it could not read back, so it emitted none
vw-arm-history-spy-1d-2026-10-02             AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:roundtrip) [runtime declined: runtime:conditional-history]: the translator wrote formula text it could not read back, so it emitted none
vw-array-na-spy-1d-2026-10-02                AMEX:SPY 1D      13     INCONCLUSIVE  5 of 14 items could not be compared
    N00_bar_index_CONTROL                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    N01_min_with_na                          INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    N02_max_with_na                          INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    N03_sum_with_na                          INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    N04_avg_with_na                          INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    N05_min_all_na                           INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    N06_indexof_na                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    N07_includes_na                          MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    N08_indexof_of_min                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    N09_indexof_of_min_all_na                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    N10_get_minus_one                        MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    N11_vote_mixed_na                        MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    N12_vote_all_na                          MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
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
vw-bar-counters-rddt-5-2026-09-30            NYSE:RDDT 5      8      INCONCLUSIVE  7 of 9 items could not be compared
    C00_bar_index_CONTROL                    MATCH         cmp 20052 ok 20052 warm 0/0 steady 0/20052 maxRel 0.00e+0
    C01_var_n_plus_1                         INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C02_na_hist_seeded_counter               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C03_var_compound                         INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C04_var_na_seed_counter                  INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C05_ta_cum_1                             INCONCLUSIVE  cmp 20052 ok 20052 warm 0/0 steady 0/20052 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C06_n1_minus_bar_index                   INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C07_n2_minus_bar_index                   INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
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
vw-bar-counters-spy-1-2026-10-02             AMEX:SPY 1       8      INCONCLUSIVE  8 of 9 items could not be compared
    C00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    C01_var_n_plus_1                         INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C02_na_hist_seeded_counter               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C03_var_compound                         INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C04_var_na_seed_counter                  INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C05_ta_cum_1                             INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (running-total:window) — nothing is drawn for it
    C06_n1_minus_bar_index                   INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    C07_n2_minus_bar_index                   INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    objects                                  MATCH         neither side draws an object
vw-bar-counters-spy-30-2026-10-02            AMEX:SPY 30      8      INCONCLUSIVE  8 of 9 items could not be compared
    C00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    C01_var_n_plus_1                         INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C02_na_hist_seeded_counter               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C03_var_compound                         INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C04_var_na_seed_counter                  INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C05_ta_cum_1                             INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (running-total:window) — nothing is drawn for it
    C06_n1_minus_bar_index                   INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    C07_n2_minus_bar_index                   INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    objects                                  MATCH         neither side draws an object
vw-bar-origin-rddt-5-2026-10-02              NYSE:RDDT 5      11     INCONCLUSIVE  4 of 12 items could not be compared
    O00_bar_index_CONTROL                    MATCH         cmp 20208 ok 20208 warm 0/0 steady 0/20208 maxRel 0.00e+0
    O01_last_bar_index                       MATCH         cmp 20208 ok 20208 warm 0/0 steady 0/20208 maxRel 0.00e+0
    O02_isfirst                              MATCH         cmp 20208 ok 20208 warm 0/0 steady 0/20208 maxRel 0.00e+0
    O03_bars_seen_by_a_var_counter           INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    O04_bar_index_minus_counter_MUST_BE_MINU INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    O05_bar_index_where_isfirst_was_true     INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:bars) — nothing is drawn for it
    O06_barssince_isfirst                    MATCH         cmp 20208 ok 20208 warm 0/0 steady 0/20208 maxRel 0.00e+0
    O07_first_bar_time_in_days               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    O08_bar_index_mod_3                      MATCH         cmp 20208 ok 20208 warm 0/0 steady 0/20208 maxRel 0.00e+0
    O09_bar_index_gt_100                     MATCH         cmp 20208 ok 20208 warm 0/0 steady 0/20208 maxRel 0.00e+0
    O10_distance_MUST_BE_5                   MATCH         cmp 20208 ok 20208 warm 0/5 steady 0/20203 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-origin-rddt-60-2026-10-02             NYSE:RDDT 60     11     MATCH         all 12 items agree
    O00_bar_index_CONTROL                    MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O01_last_bar_index                       MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O02_isfirst                              MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O03_bars_seen_by_a_var_counter           MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O04_bar_index_minus_counter_MUST_BE_MINU MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O05_bar_index_where_isfirst_was_true     MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O06_barssince_isfirst                    MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O07_first_bar_time_in_days               MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O08_bar_index_mod_3                      MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O09_bar_index_gt_100                     MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O10_distance_MUST_BE_5                   MATCH         cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-origin-spy-1d-300-2026-10-02          AMEX:SPY 1D      11     MATCH         all 12 items agree
    O00_bar_index_CONTROL                    MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O01_last_bar_index                       MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O02_isfirst                              MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O03_bars_seen_by_a_var_counter           MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O04_bar_index_minus_counter_MUST_BE_MINU MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O05_bar_index_where_isfirst_was_true     MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O06_barssince_isfirst                    MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O07_first_bar_time_in_days               MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O08_bar_index_mod_3                      MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O09_bar_index_gt_100                     MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O10_distance_MUST_BE_5                   MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-origin-spy-1m-2026-10-02              AMEX:SPY 1M      11     MATCH         all 12 items agree
    O00_bar_index_CONTROL                    MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O01_last_bar_index                       MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O02_isfirst                              MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O03_bars_seen_by_a_var_counter           MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O04_bar_index_minus_counter_MUST_BE_MINU MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O05_bar_index_where_isfirst_was_true     MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O06_barssince_isfirst                    MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O07_first_bar_time_in_days               MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O08_bar_index_mod_3                      MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O09_bar_index_gt_100                     MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O10_distance_MUST_BE_5                   MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-origin-spy-1w-2026-10-02              AMEX:SPY 1W      11     MATCH         all 12 items agree
    O00_bar_index_CONTROL                    MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O01_last_bar_index                       MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O02_isfirst                              MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O03_bars_seen_by_a_var_counter           MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O04_bar_index_minus_counter_MUST_BE_MINU MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O05_bar_index_where_isfirst_was_true     MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O06_barssince_isfirst                    MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O07_first_bar_time_in_days               MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O08_bar_index_mod_3                      MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O09_bar_index_gt_100                     MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O10_distance_MUST_BE_5                   MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bgcolor-barcolor-spy-1d-2026-10-02        AMEX:SPY 1D      1      DIVERGE       1 of 3 compared items diverge
    control                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   DIVERGE       1 paint differs (first: barcolor plot_3 "O4" withheld (`offset = na` on `barcolor`: where TradingView draws such a paint is not captured (O4 of tools/visual_conformance/probes/vw-bgcolor-barcolor.pine is painted over on every bar by a later `barcolor`)))
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
    C01_highest10_cond                       INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for value (pine:block)
    C02_lowest10_cond                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2 (pine:block)
    C03_sma3_cond                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3 (pine:block)
    C04_ema3_cond                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4 (pine:block)
    C05_local_x1_cond                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out5 (pine:block)
    C06_bar_index1_cond                      MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    H01_param_src1_cond                      INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out7 (pine:block)
    H02_local_x1_cond                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out8 (pine:block)
    H03_sma3_cond                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out9 (pine:block)
    H04_highest10_cond                       INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out10 (pine:block)
    H05_bar_index1_cond                      INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out11 (pine:block)
    H06_volume1_cond                         MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    D01_highest3_even                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out13 (pine:block)
    D02_sma3_even                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out14 (pine:block)
    D03_local_y1_even                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out15 (pine:block)
    E01_highest10_every_bar                  MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    E02_lowest10_every_bar                   MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    E03_sma3_every_bar                       MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 1.32e-15
    E04_ema3_every_bar                       MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    E05_local_every_bar                      MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    E06_highest3_every_bar                   MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 48 paired slots; coordinates are NOT compared by v1
vw-call-site-history-spy-1d-2026-10-01       AMEX:SPY 1D      21     INCONCLUSIVE  13 of 22 items could not be compared
    C01_highest10_cond                       INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for value (pine:block)
    C02_lowest10_cond                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2 (pine:block)
    C03_sma3_cond                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3 (pine:block)
    C04_ema3_cond                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4 (pine:block)
    C05_local_x1_cond                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out5 (pine:block)
    C06_bar_index1_cond                      MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    H01_param_src1_cond                      INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out7 (pine:block)
    H02_local_x1_cond                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out8 (pine:block)
    H03_sma3_cond                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out9 (pine:block)
    H04_highest10_cond                       INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out10 (pine:block)
    H05_bar_index1_cond                      INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out11 (pine:block)
    H06_volume1_cond                         MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D01_highest3_even                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out13 (pine:block)
    D02_sma3_even                            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out14 (pine:block)
    D03_local_y1_even                        INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out15 (pine:block)
    E01_highest10_every_bar                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E02_lowest10_every_bar                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E03_sma3_every_bar                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.40e-15
    E04_ema3_every_bar                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E05_local_every_bar                      MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E06_highest3_every_bar                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 48 paired slots; coordinates are NOT compared by v1
vw-clock-close-tfchange-spy-1d-2026-09-28    AMEX:SPY 1D      18     MATCH         all 19 items agree
    K00_bar_index_CONTROL                    MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    K01_time_close_SECS                      MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    K02_time_closeD_SECS                     MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    K03_span_time_close_minus_time_SECS      MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    K04_tfchange_D                           MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    K05_tfchange_W                           MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    K06_tfchange_M                           MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    K07_newDay_from_timeD_CONTROL            MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    K08_time_SECS_CONTROL                    MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    K09_hour_time_close                      MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    K10_minute_time_close                    MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    K11_dayofweek_time_close                 MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    K12_time_close_spacing_SECS              MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    K13_time_closeD_minus_time_SECS          MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    K14_newWeek_from_timeW_CONTROL           MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    K15_newMonth_from_timeM_CONTROL          MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    K16_tfchange_1W_SPELLING                 MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    K17_isconfirmed_LAST_BAR_FORMING         MATCH         cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-clock-close-tfchange-spy-1d-2026-09-28    AMEX:SPY 1W      18     INCONCLUSIVE  18 of 19 items could not be compared
    K00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for value (runtime:warmup-never-converges)
    K01_time_close_SECS                      INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2 (runtime:warmup-never-converges)
    K02_time_closeD_SECS                     INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3 (runtime:warmup-never-converges)
    K03_span_time_close_minus_time_SECS      INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4 (runtime:warmup-never-converges)
    K04_tfchange_D                           INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out5 (runtime:warmup-never-converges)
    K05_tfchange_W                           INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out6 (runtime:warmup-never-converges)
    K06_tfchange_M                           INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out7 (runtime:warmup-never-converges)
    K07_newDay_from_timeD_CONTROL            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out8 (runtime:warmup-never-converges)
    K08_time_SECS_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out9 (runtime:warmup-never-converges)
    K09_hour_time_close                      INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out10 (runtime:warmup-never-converges)
    K10_minute_time_close                    INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out11 (runtime:warmup-never-converges)
    K11_dayofweek_time_close                 INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out12 (runtime:warmup-never-converges)
    K12_time_close_spacing_SECS              INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out13 (runtime:warmup-never-converges)
    K13_time_closeD_minus_time_SECS          INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out14 (runtime:warmup-never-converges)
    K14_newWeek_from_timeW_CONTROL           INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out15 (runtime:warmup-never-converges)
    K15_newMonth_from_timeM_CONTROL          INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out16 (runtime:warmup-never-converges)
    K16_tfchange_1W_SPELLING                 INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out17 (runtime:warmup-never-converges)
    K17_isconfirmed_LAST_BAR_FORMING         INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out18 (runtime:warmup-never-converges)
    objects                                  MATCH         neither side draws an object
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
    X01_highest_bi_3_every_3rd               INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2 (pine:block)
    X02_lowest_bi_3_every_3rd                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3 (pine:block)
    X03_lowest_bi_5_every_2nd                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4 (pine:block)
    X04_lowest_bi_3_up_bars                  INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out5 (pine:block)
    X05_highest_neg_bi_3_up_bars             INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out6 (pine:block)
    X06_lowest_3_onearg_every_3rd            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out7 (pine:block)
    X07_highest_3_onearg_every_3rd           INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out8 (pine:block)
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
vw-cond-window-extremes-spy-1d-2026-10-02    AMEX:SPY 1D      17     INCONCLUSIVE  7 of 18 items could not be compared
    X00_bar_index_CONTROL                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    X01_highest_bi_3_every_3rd               INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2 (pine:block)
    X02_lowest_bi_3_every_3rd                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3 (pine:block)
    X03_lowest_bi_5_every_2nd                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4 (pine:block)
    X04_lowest_bi_3_up_bars                  INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out5 (pine:block)
    X05_highest_neg_bi_3_up_bars             INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out6 (pine:block)
    X06_lowest_3_onearg_every_3rd            INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out7 (pine:block)
    X07_highest_3_onearg_every_3rd           INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out8 (pine:block)
    E01_highest_bi_3_every_bar               MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E02_lowest_bi_3_every_bar                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E03_lowest_bi_5_every_bar                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E06_lowest_3_every_bar                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E07_highest_3_every_bar                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E08_low_CONTROL                          MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E09_high_CONTROL                         MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E10_up_bar_CONTROL                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    R01_bar_index_prev_run                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
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
    DBHF                                     INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for value (runtime:warmup-never-converges)
    D00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2 (runtime:warmup-never-converges)
    D01_mintick                              INCONCLUSIVE   — our side produced no column for this plot — the member pane did not carry this output (hidden helper or beyond its row ceiling)
    D02_base_tau                             INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3 (runtime:warmup-never-converges)
    D03_dbhf                                 INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4 (runtime:warmup-never-converges)
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
vw-default-param-spy-1d-2026-10-02           AMEX:SPY 1D      16     MATCH         all 17 items agree
    D00_bar_index_CONTROL                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
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
vw-forin-collections-rddt-1d-2026-10-01      NYSE:RDDT 1D     14     MATCH         all 15 items agree
    F01_forin_passes_5                       MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    F02_forin_passes_empty                   MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    F03_forin_passes_body_shifts             MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    F04_forin_passes_body_pushes             MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    A01_box_all_size                         MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    A02_held_all_size_after_delete           MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    A03_box_all_size_after_delete            MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    A04_forin_all_delete_passes              MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    A05_box_all_size_after_walk              MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    W01_while_cap_passes                     MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    Z01_sized_list_size                      MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    Z02_sized_list_labels_held               MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    Z03_slot0_bar                            MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    C00_bar_index_CONTROL                    MATCH         cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 43 paired slots; coordinates are NOT compared by v1
vw-getter-history-2-spy-1d-2026-10-02        AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:drawing) [runtime declined: runtime:conditional-history]: a drawing object paints on a chart and answers with no number — `line.get_y1`
vw-getter-history-spy-1d-2026-10-01          AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:drawing) [runtime declined: runtime:history-expression]: a drawing object paints on a chart and answers with no number — `line.get_y1`
vw-gradient-edges-spy-1d-2026-10-02          AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:colour-value) [runtime declined: pine:colour-value]: a colour cannot be a value in a screened column — `color.from_gradient`
vw-gradient-spy-1d-2026-09-30                AMEX:SPY 1D      23     INCONCLUSIVE  6 of 24 items could not be compared
    G00_bar_index_CONTROL                    MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G01_v                                    MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G02_g1_r                                 MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G03_g1_g                                 MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G04_g1_b                                 MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G05_g1_t                                 MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G06_w                                    MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G07_g2_r_clamp                           MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G08_g2_g_clamp                           MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G09_g2_b_clamp                           MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G10_g2_t_clamp                           MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G11_g3_r_new30                           MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G12_g3_g_new30                           MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G13_g3_b_new30                           MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G14_g3_t_new30                           INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    G15_g4_t_interp_0_to_100                 MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G16_g4_r                                 MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G17_new_red_70p5_t                       INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    G18_new_red_70p5_r                       INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    G19_new_0064C8_70p5_t                    INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    G20_new_0064C8_70p4_t                    INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    G21_cA_t_CONTROL                         INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    G22_drawn_in_g1                          MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-h4-loops-rddt-1d-2026-10-03               NYSE:RDDT 1D     4      MATCH         all 5 items agree
    L1 wsum(close, a+b)                      MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    L2 seeded filter                         MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    L3 sum of last n closes                  MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    L3 n                                     MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-h4-loops-spy-1d-2026-10-03                AMEX:SPY 1D      4      MATCH         all 5 items agree
    L1 wsum(close, a+b)                      MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L2 seeded filter                         MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L3 sum of last n closes                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L3 n                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-input-tf-text-v5-spy-1d-2026-10-01        AMEX:SPY 1D      19     INCONCLUSIVE  18 of 20 items could not be compared
    I00_bar_index_CONTROL                    MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
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
vw-input-tf-text-v6-spy-1d-2026-10-01        AMEX:SPY 1D      19     INCONCLUSIVE  18 of 20 items could not be compared
    I00_bar_index_CONTROL                    MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
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
vw-int-array-avg-neg-spy-1d-2026-10-01       AMEX:SPY 1D      5      MATCH         all 6 items agree
    A00_bar_index_CONTROL                    MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    A01_avg_n1_n2                            MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    A02_avg_n2_n3                            MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    A03_avg_0_n1                             MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    A04_avg_n3_n4                            MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 47 paired slots; coordinates are NOT compared by v1
vw-int-array-avg-spy-1d-2026-09-30           AMEX:SPY 1D      17     MATCH         all 18 items agree
    A00_bar_index_CONTROL                    MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    A01_int_avg_1_2                          MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    A02_int_avg_1_1_2                        MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    A03_int_avg_1_2_2                        MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    A04_int_avg_2_3                          MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    A05_int_avg_n1_n2                        MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    A06_int_avg_n1_n1_n2                     MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    A07_int_avg_n1_n2_n2                     MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    B01_float_avg_1_2_CONTROL                MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    B02_float_avg_1_1_2_CONTROL              MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    B03_float_avg_1_2_2_CONTROL              MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    D01_int_avg_1_2_times_2                  MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    D02_int_avg_1_1_2_times_3                MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    D03_int_avg_1_2_2_times_3                MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    P01_var_push_avg_1_2                     MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    P02_var_push_avg_1_1_2                   MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    P03_var_push_avg_2_2_1                   MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 56 paired slots; coordinates are NOT compared by v1
vw-int-div-assign-spy-1d-2026-10-02          AMEX:SPY 1D      6      INCONCLUSIVE  3 of 7 items could not be compared
    D00_bar_index_CONTROL                    MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    D01_input_int_div_assign                 MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    D02_int_literal_div_assign               INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    D03_int_literal_over_int                 INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    D04_input_int_over_int                   MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    D05_int_reassigned_quotient              INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-library-import-rddt-1d-2026-10-02         NYSE:RDDT 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:module) [runtime declined: runtime:library]: importing another script pulls in code this engine never sees — the library `TradingView/ta/7` is not in this engine's library registry, so its code cannot be compiled
vw-loop-in-block-spy-1d-2026-10-02           AMEX:SPY 1D      9      MATCH         all 10 items agree
    L00_bar_index_CONTROL                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L01_close_CONTROL                        MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L02_m_below_loop                         MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L03_m_no_loop                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L04_acc_loop_written                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L05_d_from_loop_total                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L06_e_above_loop                         MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L07_w_below_while                        MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L08_k_else_arm                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 124 paired slots; coordinates are NOT compared by v1
vw-lower-tf-1-30-spy-1d-2026-10-02           AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:request) [runtime declined: lower-tf:unwitnessed]: this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `30` is not one of them. Below the chart's own timeframe: lower-tf:unwitnessed: `30` below a D chart reads intraday bars, and no committed capture shows TradingView answering that timeframe on that chart period — probe `tools/visual_conformance/probes/vw-lower-tf.pine` (Q-L1 in `docs/pine/capture-queue-2026-09-30-lower-tf.md`) with a row at this timeframe, on this chart period, beside TradingView's own intraday bars of the symbol at that timeframe. ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-lower-tf-1-30-spy-1m-2026-10-02           AMEX:SPY 1M      0      INCONCLUSIVE  refused on our side: member door refused (pine:request) [runtime declined: lower-tf:unwitnessed]: this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `30` is not one of them. Below the chart's own timeframe: lower-tf:unwitnessed: `30` below a D chart reads intraday bars, and no committed capture shows TradingView answering that timeframe on that chart period — probe `tools/visual_conformance/probes/vw-lower-tf.pine` (Q-L1 in `docs/pine/capture-queue-2026-09-30-lower-tf.md`) with a row at this timeframe, on this chart period, beside TradingView's own intraday bars of the symbol at that timeframe. ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-lower-tf-cava-1d-2026-10-02               NYSE:CAVA 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:request) [runtime declined: lower-tf:store-unmeasured]: this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-lower-tf-rddt-1d-2026-09-30               NYSE:RDDT 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:request) [runtime declined: lower-tf:store-unmeasured]: this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-lower-tf-spy-1d-2026-09-30                AMEX:SPY 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:request) [runtime declined: lower-tf:store-unmeasured]: this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-lower-tf-spy-1m-2026-10-02                AMEX:SPY 1M      0      INCONCLUSIVE  refused on our side: member door refused (pine:request) [runtime declined: lower-tf:store-unmeasured]: this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-lower-tf-spy-1w-2026-09-30                AMEX:SPY 1W      0      INCONCLUSIVE  refused on our side: member door refused (pine:request) [runtime declined: lower-tf:store-unmeasured]: this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-mbb-auto-spy-1d-2026-09-30                AMEX:SPY 1D      4      MATCH         all 5 items agree
    M00_bar_index_CONTROL                    MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    M01_k                                    MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    M02_close_at_k                           MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    M03_close_at_k_is_na                     MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-mintick-arkk-1d-2026-10-02                CBOE:ARKK 1D     0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-bac-pl-1d-2026-10-02              NYSE:BAC/PL 1D   0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-dfliw-1d-2026-10-02               NASDAQ:DFLIW 1D  0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-grrrw-1d-2026-10-02               NASDAQ:GRRRW 1D  0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-imo-1d-2026-10-02                 AMEX:IMO 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-qqq-1d-2026-10-02                 NASDAQ:QQQ 1D    0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-xlk-1d-2026-10-02                 AMEX:XLK 1D      0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-yhnau-1d-2026-10-02               NASDAQ:YHNAU 1D  0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-ne-na-spy-1d-2026-09-30                   AMEX:SPY 1D      12     MATCH         all 13 items agree
    Q00_bar_index_CONTROL                    MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q01_x_is_na                              MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q02_x_ne_close                           MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q03_x_eq_close                           MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q04_x_ne_x                               MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q05_x_eq_x                               MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q06_i_ne_1                               MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q07_i_eq_1                               MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q08_x_gt_0                               MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q09_not_x_eq_close                       MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
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
vw-offset-na-spy-1d-2026-09-30               AMEX:SPY 1D      6      MATCH         all 7 items agree
    E00_bar_index_CONTROL                    MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    E01_e_is_na                              MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    E02_close_at_e                           MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    E03_close_at_e_is_na                     MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    E04_close_1_CONTROL                      MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    E05_close_at_e_eq_close                  MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
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
vw-ratchet-stops-rddt-1d-2026-10-02          NYSE:RDDT 1D     8      MATCH         all 9 items agree
    R01_up                                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.71e-16
    R02_dn                                   MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.13e-16
    R03_trend                                MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    R04_local_stop                           MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.62e-16
    R05_range_filter                         MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.90e-16
    R06_pivot_high                           MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    R07_pivot_low                            MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    R00_bar_index_CONTROL                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-ratchet-stops-spy-1d-2026-10-02           AMEX:SPY 1D      8      MATCH         all 9 items agree
    R01_up                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.88e-16
    R02_dn                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.89e-16
    R03_trend                                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    R04_local_stop                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.55e-16
    R05_range_filter                         MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.20e-16
    R06_pivot_high                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    R07_pivot_low                            MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    R00_bar_index_CONTROL                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
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
    paints                                   MATCH         2 paints agree bar for bar
vw-rt6-runtime-colour-spy-1d-2026-10-03      AMEX:SPY 1D      7      DIVERGE       C01_var_colour: bar 0 t=1565098200 color vendor=#33ff00ff ours=#c9a84cff
    K00_bar_index_CONTROL                    MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    C01_var_colour                           DIVERGE       cmp 1800 ok 0 warm 0/0 steady 1800/1800 maxRel 0.00e+0 — 1800 steady-state bars disagree; first at bar 0 (color: vendor #33ff00ff vs ours #c9a84cff at value 287.8) — persistent, last at bar 1799
    C02_new_var_40                           DIVERGE       cmp 1800 ok 0 warm 0/0 steady 1800/1800 maxRel 0.00e+0 — 1800 steady-state bars disagree; first at bar 0 (color: vendor #33ff0099 vs ours #c9a84cff at value 287.8) — persistent, last at bar 1799
    C03_new_na_base                          DIVERGE       cmp 1800 ok 0 warm 0/0 steady 1800/1800 maxRel 0.00e+0 — 1800 steady-state bars disagree; first at bar 0 (color: vendor #00000099 vs ours #c9a84cff at value 287.8) — persistent, last at bar 1799
    C04_new_na_transp                        DIVERGE       cmp 1800 ok 0 warm 0/0 steady 1800/1800 maxRel 0.00e+0 — 1800 steady-state bars disagree; first at bar 0 (color: vendor #ff525200 vs ours #c9a84cff at value 287.8) — persistent, last at bar 1799
    C05_rgb_na                               DIVERGE       cmp 1800 ok 0 warm 0/0 steady 1800/1800 maxRel 0.00e+0 — 1800 steady-state bars disagree; first at bar 0 (color: vendor #000000ff vs ours #c9a84cff at value 287.8) — persistent, last at bar 1799
    C06_cond_or_na                           MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         2 paints agree bar for bar
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
vw-runtime-error-spy-1d-2026-09-30           AMEX:SPY 1D      2      MATCH         all 3 items agree
    E00_bar_index_CONTROL                    MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    E01_close_CONTROL                        MATCH         cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 100 paired slots; coordinates are NOT compared by v1
vw-ternary-draw-helper-rddt-1d-2026-10-02    NYSE:RDDT 1D     1      MATCH         all 2 items agree
    R00                                      MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 1009 paired slots; coordinates are NOT compared by v1
vw-tf-period-spy-1d-2026-09-30               AMEX:SPY 1D      12     INCONCLUSIVE  8 of 13 items could not be compared
    T00_bar_index_CONTROL                    MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
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
    T01_len_period                           INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2 (bind:period-reads)
    T02_eq_D                                 INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3 (bind:period-reads)
    T03_eq_1D                                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4 (bind:period-reads)
    T04_eq_W                                 INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out5 (bind:period-reads)
    T05_eq_1W                                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out6 (bind:period-reads)
    T06_eq_M                                 INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out7 (bind:period-reads)
    T07_eq_1M                                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out8 (bind:period-reads)
    T08_multiplier                           INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T09_isdaily                              MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    T10_isweekly                             MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    T11_ismonthly                            MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  INCONCLUSIVE  our object lane did not run: objectReaderFor returned null
vw-tf-period-spy-1w-2026-09-30               AMEX:SPY 1W      12     INCONCLUSIVE  10 of 13 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_len_period                           INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out2 (bind:period-reads)
    T02_eq_D                                 INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out3 (bind:period-reads)
    T03_eq_1D                                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out4 (bind:period-reads)
    T04_eq_W                                 INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out5 (bind:period-reads)
    T05_eq_1W                                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out6 (bind:period-reads)
    T06_eq_M                                 INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out7 (bind:period-reads)
    T07_eq_1M                                INCONCLUSIVE   — our side produced no column for this plot — computeFor returned no column for out8 (bind:period-reads)
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
vw-time-tf-bitstamp-btcusd-1d-2026-09-30     BITSTAMP:BTCUSD  18     DIVERGE       T01_timeW_minus_time_DAYS: bar 0 t=1313625600 na vendor=-3 ours=na
    T00_bar_index_CONTROL                    MATCH         cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                DIVERGE       cmp 5491 ok 5438 warm 0/0 steady 53/5491 maxRel 0.00e+0 — 53 steady-state bars disagree; first at bar 0 (na: vendor -3 vs ours na) — scattered, last at bar 5283
    T02_timeM_minus_time_DAYS                DIVERGE       cmp 5491 ok 4795 warm 0/0 steady 696/5491 maxRel 0.00e+0 — 696 steady-state bars disagree; first at bar 0 (na: vendor -17 vs ours na) — scattered, last at bar 5306
    T03_time3M_minus_time_DAYS               DIVERGE       cmp 5491 ok 4247 warm 0/0 steady 1244/5491 maxRel 0.00e+0 — 1244 steady-state bars disagree; first at bar 0 (na: vendor -48 vs ours na) — scattered, last at bar 5306
    T04_time12M_minus_time_DAYS              DIVERGE       cmp 5491 ok 1845 warm 0/0 steady 3646/5491 maxRel 0.00e+0 — 3646 steady-state bars disagree; first at bar 0 (na: vendor -229 vs ours na) — persistent, last at bar 5490
    T05_timeSelf_minus_time_MUST_BE_0        MATCH         cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH         cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0
    T07_newWeek                              DIVERGE       cmp 5491 ok 5406 warm 0/0 steady 85/5491 maxRel 0.00e+0 — 85 steady-state bars disagree; first at bar 0 (na: vendor 0 vs ours na) — scattered, last at bar 5284
    T08_newMonth                             DIVERGE       cmp 5491 ok 4765 warm 0/0 steady 726/5491 maxRel 0.00e+0 — 726 steady-state bars disagree; first at bar 0 (na: vendor 0 vs ours na) — scattered, last at bar 5307
    T09_newQuarter                           DIVERGE       cmp 5491 ok 4217 warm 0/0 steady 1274/5491 maxRel 0.00e+0 — 1274 steady-state bars disagree; first at bar 0 (na: vendor 0 vs ours na) — scattered, last at bar 5307
    T10_in_seconds_1                         INCONCLUSIVE  cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE  cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE  cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE  cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE  cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE  cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE  cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH         cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-eurusd-1d-2026-10-02              FX:EURUSD 1D     18     INCONCLUSIVE  16 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH         cmp 14330 ok 14330 warm 0/0 steady 0/14330 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T02_timeM_minus_time_DAYS                INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T03_time3M_minus_time_DAYS               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T04_time12M_minus_time_DAYS              INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T05_timeSelf_minus_time_MUST_BE_0        INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T06_time60_minus_time_DAYS               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T07_newWeek                              INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:weekend-bars) — nothing is drawn for it
    T08_newMonth                             INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:weekend-bars) — nothing is drawn for it
    T09_newQuarter                           INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:weekend-bars) — nothing is drawn for it
    T10_in_seconds_1                         INCONCLUSIVE  cmp 14330 ok 14330 warm 0/0 steady 0/14330 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE  cmp 14330 ok 14330 warm 0/0 steady 0/14330 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE  cmp 14330 ok 14330 warm 0/0 steady 0/14330 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE  cmp 14330 ok 14330 warm 0/0 steady 0/14330 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE  cmp 14330 ok 14330 warm 0/0 steady 0/14330 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE  cmp 14330 ok 14330 warm 0/0 steady 0/14330 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE  cmp 14330 ok 14330 warm 0/0 steady 0/14330 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH         cmp 14330 ok 14330 warm 0/0 steady 0/14330 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-fx-eurusd-1d-2026-10-01           FX:EURUSD 1D     18     INCONCLUSIVE  16 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH         cmp 14329 ok 14329 warm 0/0 steady 0/14329 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T02_timeM_minus_time_DAYS                INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T03_time3M_minus_time_DAYS               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T04_time12M_minus_time_DAYS              INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T05_timeSelf_minus_time_MUST_BE_0        INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T06_time60_minus_time_DAYS               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T07_newWeek                              INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:weekend-bars) — nothing is drawn for it
    T08_newMonth                             INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:weekend-bars) — nothing is drawn for it
    T09_newQuarter                           INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:weekend-bars) — nothing is drawn for it
    T10_in_seconds_1                         INCONCLUSIVE  cmp 14329 ok 14329 warm 0/0 steady 0/14329 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE  cmp 14329 ok 14329 warm 0/0 steady 0/14329 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE  cmp 14329 ok 14329 warm 0/0 steady 0/14329 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE  cmp 14329 ok 14329 warm 0/0 steady 0/14329 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE  cmp 14329 ok 14329 warm 0/0 steady 0/14329 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE  cmp 14329 ok 14329 warm 0/0 steady 0/14329 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE  cmp 14329 ok 14329 warm 0/0 steady 0/14329 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH         cmp 14329 ok 14329 warm 0/0 steady 0/14329 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-rddt-1d-2026-10-02                NYSE:RDDT 1D     18     INCONCLUSIVE  7 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T07_newWeek                              MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T08_newMonth                             MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T09_newQuarter                           MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE  cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-1-2026-10-02                  AMEX:SPY 1       18     INCONCLUSIVE  17 of 19 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_timeW_minus_time_DAYS                INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T02_timeM_minus_time_DAYS                INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T03_time3M_minus_time_DAYS               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T04_time12M_minus_time_DAYS              INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T05_timeSelf_minus_time_MUST_BE_0        INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-own:chart-unwitnessed) — nothing is drawn for it
    T06_time60_minus_time_DAYS               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-own:chart-unwitnessed) — nothing is drawn for it
    T07_newWeek                              INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T08_newMonth                             INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T09_newQuarter                           INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T10_in_seconds_1                         INCONCLUSIVE  cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE  cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE  cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE  cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE  cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE  cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE  cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH         cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-15-2026-10-01                 AMEX:SPY 15      18     INCONCLUSIVE  8 of 19 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_timeW_minus_time_DAYS                MATCH         cmp 3300 ok 3300 warm 0/1 steady 0/3299 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH         cmp 3300 ok 3300 warm 0/1 steady 0/3299 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH         cmp 3300 ok 3300 warm 0/1 steady 0/3299 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH         cmp 3300 ok 3300 warm 0/1 steady 0/3299 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH         cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH         cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0
    T07_newWeek                              MATCH         cmp 3300 ok 3299 warm 1/2 steady 0/3298 maxRel 0.00e+0
    T08_newMonth                             MATCH         cmp 3300 ok 3299 warm 1/2 steady 0/3298 maxRel 0.00e+0
    T09_newQuarter                           MATCH         cmp 3300 ok 3299 warm 1/2 steady 0/3298 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE  cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE  cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE  cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE  cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE  cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE  cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE  cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH         cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-1d-2026-09-28                 AMEX:SPY 1D      18     INCONCLUSIVE  7 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH         cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                MATCH         cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH         cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH         cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH         cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH         cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH         cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T07_newWeek                              MATCH         cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T08_newMonth                             MATCH         cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T09_newQuarter                           MATCH         cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE  cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE  cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE  cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE  cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE  cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE  cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE  cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH         cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-1d-full-2026-10-01            AMEX:SPY 1D      18     INCONCLUSIVE  7 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH         cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                MATCH         cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH         cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH         cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH         cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH         cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH         cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T07_newWeek                              MATCH         cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T08_newMonth                             MATCH         cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T09_newQuarter                           MATCH         cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE  cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE  cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE  cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE  cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE  cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE  cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE  cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH         cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-1d-full-2026-10-02            AMEX:SPY 1D      18     INCONCLUSIVE  7 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T07_newWeek                              MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T08_newMonth                             MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T09_newQuarter                           MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE  cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE  cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE  cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE  cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE  cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE  cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE  cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH         cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-1m-2026-10-01                 AMEX:SPY 1M      18     INCONCLUSIVE  7 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T07_newWeek                              MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T08_newMonth                             MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T09_newQuarter                           MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE  cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE  cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE  cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE  cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE  cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE  cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE  cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-1m-2026-10-02                 AMEX:SPY 1M      18     INCONCLUSIVE  7 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T07_newWeek                              MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T08_newMonth                             MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T09_newQuarter                           MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE  cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE  cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE  cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE  cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE  cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE  cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE  cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH         cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-1w-2026-10-01                 AMEX:SPY 1W      18     INCONCLUSIVE  7 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T07_newWeek                              MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T08_newMonth                             MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T09_newQuarter                           MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE  cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE  cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE  cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE  cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE  cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE  cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE  cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-1w-2026-10-02                 AMEX:SPY 1W      18     INCONCLUSIVE  7 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T07_newWeek                              MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T08_newMonth                             MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T09_newQuarter                           MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE  cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE  cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE  cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE  cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE  cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE  cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE  cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH         cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-240-2026-10-02                AMEX:SPY 240     18     INCONCLUSIVE  17 of 19 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_timeW_minus_time_DAYS                INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T02_timeM_minus_time_DAYS                INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T03_time3M_minus_time_DAYS               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T04_time12M_minus_time_DAYS              INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T05_timeSelf_minus_time_MUST_BE_0        INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-own:chart-unwitnessed) — nothing is drawn for it
    T06_time60_minus_time_DAYS               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-own:chart-unwitnessed) — nothing is drawn for it
    T07_newWeek                              INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T08_newMonth                             INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T09_newQuarter                           INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T10_in_seconds_1                         INCONCLUSIVE  cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE  cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE  cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE  cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE  cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE  cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE  cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH         cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-30-2026-10-02                 AMEX:SPY 30      18     INCONCLUSIVE  17 of 19 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_timeW_minus_time_DAYS                INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T02_timeM_minus_time_DAYS                INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T03_time3M_minus_time_DAYS               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T04_time12M_minus_time_DAYS              INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T05_timeSelf_minus_time_MUST_BE_0        INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-own:chart-unwitnessed) — nothing is drawn for it
    T06_time60_minus_time_DAYS               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-own:chart-unwitnessed) — nothing is drawn for it
    T07_newWeek                              INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T08_newMonth                             INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T09_newQuarter                           INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T10_in_seconds_1                         INCONCLUSIVE  cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE  cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE  cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE  cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE  cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE  cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE  cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH         cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-5-2026-10-01                  AMEX:SPY 5       18     INCONCLUSIVE  8 of 19 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_timeW_minus_time_DAYS                MATCH         cmp 3300 ok 3300 warm 0/1 steady 0/3299 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH         cmp 3300 ok 3300 warm 0/1 steady 0/3299 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH         cmp 3300 ok 3300 warm 0/1 steady 0/3299 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH         cmp 3300 ok 3300 warm 0/1 steady 0/3299 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH         cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH         cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0
    T07_newWeek                              MATCH         cmp 3300 ok 3299 warm 1/2 steady 0/3298 maxRel 0.00e+0
    T08_newMonth                             MATCH         cmp 3300 ok 3299 warm 1/2 steady 0/3298 maxRel 0.00e+0
    T09_newQuarter                           MATCH         cmp 3300 ok 3299 warm 1/2 steady 0/3298 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE  cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE  cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE  cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE  cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE  cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE  cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE  cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH         cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-5-ext-2026-10-02              AMEX:SPY 5       18     INCONCLUSIVE  16 of 19 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_timeW_minus_time_DAYS                INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:outside-session) — nothing is drawn for it
    T02_timeM_minus_time_DAYS                INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:outside-session) — nothing is drawn for it
    T03_time3M_minus_time_DAYS               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:outside-session) — nothing is drawn for it
    T04_time12M_minus_time_DAYS              INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:outside-session) — nothing is drawn for it
    T05_timeSelf_minus_time_MUST_BE_0        MATCH         cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:outside-session) — nothing is drawn for it
    T07_newWeek                              INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:outside-session) — nothing is drawn for it
    T08_newMonth                             INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:outside-session) — nothing is drawn for it
    T09_newQuarter                           INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:outside-session) — nothing is drawn for it
    T10_in_seconds_1                         INCONCLUSIVE  cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE  cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE  cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE  cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE  cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE  cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE  cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH         cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-60-2026-09-28                 AMEX:SPY 60      18     INCONCLUSIVE  8 of 19 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE   — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_timeW_minus_time_DAYS                MATCH         cmp 300 ok 300 warm 0/1 steady 0/299 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH         cmp 300 ok 300 warm 0/1 steady 0/299 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH         cmp 300 ok 300 warm 0/1 steady 0/299 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH         cmp 300 ok 300 warm 0/1 steady 0/299 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    T07_newWeek                              MATCH         cmp 300 ok 299 warm 1/2 steady 0/298 maxRel 0.00e+0
    T08_newMonth                             MATCH         cmp 300 ok 299 warm 1/2 steady 0/298 maxRel 0.00e+0
    T09_newQuarter                           MATCH         cmp 300 ok 299 warm 1/2 steady 0/298 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
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
w4-cross-round-spy-1d-2026-09-30             AMEX:SPY 1D      16     INCONCLUSIVE  9 of 17 items could not be compared
    X00_bar_index                            MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    X01_crossover_close_sma5                 MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    X02_crossunder_close_sma5                MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    X03_cross_EITHER_DIRECTION               MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    X04_rising3                              MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    X05_falling3                             MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
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
wyckoff-accumulation-distribution-rddt-1d-20 NYSE:RDDT 1D     8      MATCH         all 10 items agree
    The Selling Climax                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Automatic Rally                          MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    the Secondary Test                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    The Buying Climax                        MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Automatic Reaction                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    The Secondary Test                       MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    pivotHigh                                MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    pivotLow                                 MATCH         cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 36 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
wyckoff-accumulation-distribution-spy-1d-202 AMEX:SPY 1D      8      MATCH         all 10 items agree
    The Selling Climax                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Automatic Rally                          MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    the Secondary Test                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    The Buying Climax                        MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Automatic Reaction                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    The Secondary Test                       MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    pivotHigh                                MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    pivotLow                                 MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 66 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
zero-lag-ma-trend-levels-chartprime-spy-1d-2 AMEX:SPY 1D      4      MATCH         all 5 items agree
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.35e-16
    Plot                                     MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 5.59e-16
    plot_8                                   MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 5.09e-16
    plot_10                                  MATCH         cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 3.80e-16
    objects                                  MATCH         object counts and texts agree; colours agree on 267 paired slots (55 theme-relative); coordinates are NOT compared by v1
zero-lag-ma-trend-levels-rddt-1d-2026-09-27  NYSE:RDDT D      4      MATCH         all 5 items agree
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 4.96e-16
    Plot                                     MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 3.87e-16
    plot_8                                   MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 4.91e-16
    plot_10                                  MATCH         cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 4.95e-16
    objects                                  MATCH         object counts and texts agree; colours agree on 55 paired slots (13 theme-relative); 15 slots on objects neither side draws not graded; coordinates are NOT compared by v1
adx-14-2026-09-06                            AMEX:SPY D       1      MATCH         all 1 items agree
    adx                                      MATCH         cmp 273 ok 273 warm 0/193 steady 0/80 maxRel 1.29e-15
atr-14-2026-09-06                            AMEX:SPY D       1      MATCH         all 1 items agree
    atr14                                    MATCH         cmp 1314 ok 1314 warm 0/166 steady 0/1148 maxRel 1.24e-15
ema-close20-2026-09-06                       AMEX:SPY D       1      MATCH         all 1 items agree
    ema20                                    MATCH         cmp 2012 ok 2012 warm 0/81 steady 0/1931 maxRel 6.09e-16
hma-close20-2026-09-06                       AMEX:SPY D       1      MATCH         all 1 items agree
    hma20                                    MATCH         cmp 2009 ok 2009 warm 0/0 steady 0/2009 maxRel 0.00e+0
macd-hist-12-26-9-2026-09-06                 AMEX:SPY D       1      MATCH         all 1 items agree
    histLine                                 MATCH         cmp 1998 ok 1998 warm 0/177 steady 0/1821 maxRel 2.71e-9
macd-line-12-26-2026-09-06                   AMEX:SPY D       1      MATCH         all 1 items agree
    macdLine                                 MATCH         cmp 2006 ok 2006 warm 0/185 steady 0/1821 maxRel 9.66e-12
macd-signal-12-26-9-2026-09-06               AMEX:SPY D       1      MATCH         all 1 items agree
    signalLine                               MATCH         cmp 1998 ok 1998 warm 0/177 steady 0/1821 maxRel 2.97e-11
minus-di-14-2026-09-06                       AMEX:SPY D       1      MATCH         all 1 items agree
    minusDI                                  MATCH         cmp 286 ok 286 warm 0/156 steady 0/130 maxRel 7.44e-16
plus-di-14-2026-09-06                        AMEX:SPY D       1      MATCH         all 1 items agree
    plusDI                                   MATCH         cmp 286 ok 286 warm 0/156 steady 0/130 maxRel 6.61e-16
rma-close14-2026-09-06                       AMEX:SPY D       1      MATCH         all 1 items agree
    rma14                                    MATCH         cmp 2018 ok 2018 warm 0/137 steady 0/1881 maxRel 1.35e-15
rsi-close14-2026-09-06                       AMEX:SPY D       1      MATCH         all 1 items agree
    rsi14                                    MATCH         cmp 1314 ok 1314 warm 0/166 steady 0/1148 maxRel 0.00e+0
sma-close20-2026-09-06                       AMEX:SPY D       1      MATCH         all 1 items agree
    sma20                                    MATCH         cmp 2012 ok 2012 warm 0/0 steady 0/2012 maxRel 2.32e-15
stoch-k-14-2026-09-06                        AMEX:SPY D       1      MATCH         all 1 items agree
    stochK                                   MATCH         cmp 287 ok 287 warm 0/0 steady 0/287 maxRel 2.18e-16
wma-close20-2026-09-06                       AMEX:SPY D       1      MATCH         all 1 items agree
    wma20                                    MATCH         cmp 2012 ok 2012 warm 0/0 steady 0/2012 maxRel 0.00e+0
seed-warmup-spy-12m-2026-09-21               SPY 12M          8      MATCH         all 8 items agree
    N08_ema5_SEED_QUESTION_compare_to_N09_at MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 4.31e-16
    N09_sma5_THE_DISCRIMINATOR_FOR_N08       MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 2.31e-16
    N10_atr5                                 MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 4.40e-16
    N11_rma_of_tr5_MUST_EQUAL_N10            MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 4.40e-16
    N12_sma_of_tr5_SEED_DISCRIMINATOR        MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 2.60e-16
    N13_stdev5_POPULATION_OR_SAMPLE          MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 9.91e-15
    N15_sum5_PRE_WINDOW_na_or_partial        MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 2.03e-16
    N06_change_close_bar0_is_the_reading     MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
vw-alma-spy-1d-2026-09-27                    AMEX:SPY D       0      INCONCLUSIVE  refused on our side: member door refused (pine:arity) [runtime declined: pine:arity]: `ta.alma` with `floor = true` rounds the weights' centre down to a whole bar, and this engine carries only the unrounded weighting — TO UNBLOCK: drop the fifth argument, or write it as `false`
vw-clock-vwap-spy-1d-2026-09-27              AMEX:SPY D       15     MATCH         all 16 items agree
    V00_bar_index_CONTROL                    MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V01_year_time_minus_year_MUST_BE_0       MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V02_month_time_minus_month_MUST_BE_0     MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V03_dayofmonth_time_minus_bare_MUST_BE_0 MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V04_dayofweek_time_minus_bare_MUST_BE_0  MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V05_hour_time_minus_hour_MUST_BE_0       MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V06_minute_time_minus_minute_MUST_BE_0   MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V07_vwap_hlc3_minus_vwap_MUST_BE_0       MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V08_vwap_close_minus_vwap_CONTROL_NONZER MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 4.26e-9
    V09_vwap_bare_RAW                        MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 2.16e-16
    V10_vwap_hlc3_RAW                        MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 2.16e-16
    V11_year_time_RAW                        MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V12_dayofweek_time_RAW                   MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V13_year_MUST_SPAN_TWO_VALUES            MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V14_month_MUST_SPAN_SEVERAL_VALUES       MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-int-cast-spy-1d-2026-09-27                AMEX:SPY D       11     DIVERGE       I00_bar_index_CONTROL: bar 0 t=1752845400 value vendor=8172 ours=0
    I00_bar_index_CONTROL                    DIVERGE       cmp 300 ok 0 warm 0/0 steady 300/300 maxRel 1.00e+0 — 300 steady-state bars disagree; first at bar 0 (value: vendor 8172 vs ours 0) — persistent, last at bar 299
    I01_int_2p7                              INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I02_int_neg2p7                           INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I03_int_2p5                              INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I04_int_neg2p5                           INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I05_int_3p5_CONTROL                      INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I06_int_minus_TRUNC_series               MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    I07_int_minus_FLOOR_series               MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    I08_int_minus_ROUND_series               MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    I09_int_of_na_IS_NA                      INCONCLUSIVE  cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I10_x_RAW_so_negatives_are_visible       MATCH         cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-mintick-aapl-1d-2026-09-27                NASDAQ:AAPL D    0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-aitx-1d-2026-09-27                OTC:AITX D       0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-brka-1d-2026-09-27                NYSE:BRK.A D     0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-btcusdt-1d-2026-09-27             BINANCE:BTCUSDT  0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-es1-1d-2026-09-27                 CME_MINI:ES1! D  0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-eurusd-1d-2026-09-27              FX:EURUSD D      0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-nkla-1d-2026-09-27                NASDAQ:NKLA D    0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-sndl-1d-2026-09-27                NASDAQ:SNDL D    0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-spx-1d-2026-09-27                 SP:SPX D         0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-spy-1d-2026-09-27                 AMEX:SPY D       0      INCONCLUSIVE  refused on our side: member door refused (pine:builtin) [runtime declined: pine:builtin]: this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-nvi-pvi-spy-1d-full-2026-09-27            AMEX:SPY D       8      MATCH         all 9 items agree
    P00_bar_index_CONTROL                    MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    P01_nvi_RAW                              MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 1.53e-14
    P02_pvi_RAW                              MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 7.57e-15
    P03_nvi_step_resid_MUST_BE_0             MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 1.54e+3
    P04_pvi_step_resid_MUST_BE_0             MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 4.10e+2
    P05_first_nonNA_pvi_bar                  MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    P06_corpus_nvi_minus_ema255              MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 2.31e-11
    P07_corpus_pvi_minus_ema255              MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 7.25e-12
    objects                                  MATCH         neither side draws an object
vw-nvi-pvi-spy-1d-truncated-2026-09-27       AMEX:SPY D       8      DIVERGE       P00_bar_index_CONTROL: bar 0 t=1659619800 value vendor=7432 ours=0
    P00_bar_index_CONTROL                    DIVERGE       cmp 1040 ok 0 warm 0/0 steady 1040/1040 maxRel 1.00e+0 — 1040 steady-state bars disagree; first at bar 0 (value: vendor 7432 vs ours 0) — persistent, last at bar 1039
    P01_nvi_RAW                              DIVERGE       cmp 1040 ok 0 warm 0/0 steady 1040/1040 maxRel 9.99e-1 — 1040 steady-state bars disagree; first at bar 0 (value: vendor 1408.618771650051 vs ours 1) — persistent, last at bar 1039
    P02_pvi_RAW                              DIVERGE       cmp 1040 ok 0 warm 0/0 steady 1040/1040 maxRel 1.48e+2 — 1040 steady-state bars disagree; first at bar 0 (value: vendor 0.006691829727098147 vs ours 1) — persistent, last at bar 1039
    P03_nvi_step_resid_MUST_BE_0             DIVERGE       cmp 1040 ok 1039 warm 0/0 steady 1/1040 maxRel 1.71e+2 — 1 steady-state bars disagree; first at bar 0 (na: vendor 1.5287250632045613e-17 vs ours na) — scattered, last at bar 0
    P04_pvi_step_resid_MUST_BE_0             DIVERGE       cmp 1040 ok 1039 warm 0/0 steady 1/1040 maxRel 1.28e+2 — 1 steady-state bars disagree; first at bar 0 (na: vendor 0 vs ours na) — scattered, last at bar 0
    P05_first_nonNA_pvi_bar                  DIVERGE       cmp 1040 ok 0 warm 0/0 steady 1040/1040 maxRel 1.00e+0 — 1040 steady-state bars disagree; first at bar 0 (value: vendor 7432 vs ours 0) — persistent, last at bar 1039
    P06_corpus_nvi_minus_ema255              DIVERGE       cmp 1040 ok 0 warm 0/0 steady 1040/1040 maxRel 9.99e-1 — 1040 steady-state bars disagree; first at bar 0 (na: vendor 245.30448032866502 vs ours na) — persistent, last at bar 1039
    P07_corpus_pvi_minus_ema255              DIVERGE       cmp 1040 ok 0 warm 0/0 steady 1040/1040 maxRel 1.24e+3 — 1040 steady-state bars disagree; first at bar 0 (na: vendor -0.00190286212815499 vs ours na) — persistent, last at bar 1039
    objects                                  MATCH         neither side draws an object
vw-time-session-spy-1d-2026-09-27            AMEX:SPY D       0      INCONCLUSIVE  refused on our side: member door refused (pine:function) [runtime declined: pine:function]: this Pine function maps to nothing the engine grammar declares — `time(<timeframe>, <session>)`: `"2000-0000"` wraps past midnight (or spans the whole day). The capture read `"2000-0000"` as `na` on every bar it holds, but none of those bars opens after 20:00, so it cannot say whether such a window is empty or runs to midnight — and the two answer differently on a 24-hour symbol.
vw-time-tf-spy-1d-2026-09-27                 AMEX:SPY D       18     INCONCLUSIVE  7 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T07_newWeek                              MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T08_newMonth                             MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T09_newQuarter                           MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE  cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE  cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE  cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE  cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE  cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE  cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE  cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH         cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
w2-warmup-spy-12m-2026-09-22                 SPY 12M          14     MATCH         all 14 items agree
    W01_rsi5_GATED_ON_RMA                    MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
    W02_highest5                             MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
    W03_lowest5                              MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
    W04_wma5                                 MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
    W05_vwma5                                MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 1.69e-16
    W06_mom5                                 MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
    W07_roc5                                 MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
    W08_dev5                                 MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 4.00e-16
    W09_linreg5_offset0                      MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 7.86e-16
    W10_cci5                                 MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 1.02e-14
    W11_stoch5                               MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 2.20e-16
    W12_tr_BARE_na_on_bar0                   MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
    W13_cum_close_FROM_BAR0                  MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
    W14_sma1_DEGENERATE_WINDOW               MATCH         cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0

TOTAL 369 captures — MATCH 181 · DIVERGE 48 · INCONCLUSIVE 140
WITHOUT OBJECT COLOUR (the verdict before C44; colour graded on 112 captures) — MATCH 181 · DIVERGE 48 · INCONCLUSIVE 140
CHANGED BY OBJECT COLOUR (0): none
WITHOUT PAINTS (the verdict before B1; paints graded on 41 captures) — MATCH 182 · DIVERGE 46 · INCONCLUSIVE 141
CHANGED BY PAINTS (2): vw-bgcolor-barcolor-spy-1d-2026-10-02 MATCH → DIVERGE; vw-deadband-ticks-brk-a-1d-2026-09-28 INCONCLUSIVE → DIVERGE
```

## Runtime declines by code (68)

- `pine:builtin` 23
- `pine:function` 15
- `lower-tf:store-unmeasured` 5
- `runtime:library` 5
- `pine:arity` 3
- `runtime:conditional-history` 3
- `runtime:request` 3
- `lower-tf:unwitnessed` 2
- `pine:collection` 2
- `pine:colour-value` 2
- `pine:drawing` 1
- `runtime:call-undeclared-builtin-state` 1
- `runtime:colour` 1
- `runtime:history-expression` 1
- `runtime:loop` 1

## Not comparable (96)

- `tests/fixtures/vendor/agen-1d-bars-2000-2026-09-13.json` — these are OUR bars (/api/bars), not the vendor's — a companion file, not a capture
- `tests/fixtures/vendor/aroon-spy-1d-2026-09-10.json` — vendor built-in study — no Pine source exists to run on our side
- `tests/fixtures/vendor/barstate-daily-timeline.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/barstate-full-spy-1d-closed-2026-09-10.json` — the capture holds a short tail of study values but NOT the vendor's OHLCV — our side cannot be run on the vendor's bars
- `tests/fixtures/vendor/barstate-realtime-spy-2026-09-09.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/clock-close-tfchange-spy-60-excerpt-2026-09-28.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/divergences.json` — not a capture (schema / divergence register)
- `tests/fixtures/vendor/divergences.schema.json` — not a capture (schema / divergence register)
- `tests/fixtures/vendor/exchange-spelling-seven-witnesses-2026-09-10.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/fold-numeric-spy-1d-1w-2026-09-10.json` — the capture holds a short tail of study values but NOT the vendor's OHLCV — our side cannot be run on the vendor's bars
- `tests/fixtures/vendor/groupb-barssince-arity-spy-1d-2026-09-10.json` — the capture holds a short tail of study values but NOT the vendor's OHLCV — our side cannot be run on the vendor's bars
- `tests/fixtures/vendor/groupb-hilo-default-spy-1d-2026-09-10.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/groupb-pivot-default-spy-1d-2026-09-10.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/groupb-readings-spy-1d-2026-09-11.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/groupb-round-max-vwap-spy-1d-2026-09-10.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/observations/ta-accdist-delta5-2026-09-06.json` — vendor.values holds 15 readings that are not one plotted number (named candidate readings) — no single plot to compare
- `tests/fixtures/vendor/observations/ta-bbw-oracle-ambiguity-v3-1-2026-09-05.json` — the observation names no plot (`engine.formula` is empty), so its values cannot be mapped to one of our plots
- `tests/fixtures/vendor/observations/ta-falling-close3-2026-09-06.json` — vendor.values holds 15 readings that are not one plotted number (named candidate readings) — no single plot to compare
- `tests/fixtures/vendor/observations/ta-kcw-close20-2-2026-09-06.json` — vendor.values holds 15 readings that are not one plotted number (named candidate readings) — no single plot to compare
- `tests/fixtures/vendor/observations/ta-median_even_length-oracle-ambiguity-v3-1-2026-09-05.json` — the observation names no plot (`engine.formula` is empty), so its values cannot be mapped to one of our plots
- `tests/fixtures/vendor/observations/ta-percentrank-oracle-ambiguity-v3-1-2026-09-05.json` — the observation names no plot (`engine.formula` is empty), so its values cannot be mapped to one of our plots
- `tests/fixtures/vendor/observations/ta-pvt-delta5-2026-09-06.json` — vendor.values holds 15 readings that are not one plotted number (named candidate readings) — no single plot to compare
- `tests/fixtures/vendor/observations/ta-rising-oracle-ambiguity-v3-1-2026-09-05.json` — vendor.values holds 1 readings that are not one plotted number (named candidate readings) — no single plot to compare
- `tests/fixtures/vendor/p1-top-unmeasured-spy-1d-2026-09-21.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/palette-by-version-rddt-1d-2026-09-27.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/parity/adx-14-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/atr-14-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/ema-close20-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/hma-close20-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/macd-hist-12-26-9-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/macd-line-12-26-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/macd-signal-12-26-9-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/minus-di-14-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/plus-di-14-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/rma-close14-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/rsi-close14-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/sma-close20-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/stoch-k-14-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/ta-bbw-oracle-ambiguity-v3-1-2026-09-05.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/ta-median_even_length-oracle-ambiguity-v3-1-2026-09-05.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/ta-percentrank-oracle-ambiguity-v3-1-2026-09-05.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/ta-rising-oracle-ambiguity-v3-1-2026-09-05.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/parity/wma-close20-2026-09-06.json` — a derived parity table (uct_value vs vendor_value) produced from an observation, not a capture
- `tests/fixtures/vendor/r11-alma-spy-2026-09-11.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-barssince-spy-1d-2026-09-11.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-corr-pct-spy-2026-09-11.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-nine-safe-spy-1d-2026-09-11.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-nvi-spy-2026-09-11.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-time-session-spy-5m-2026-09-11.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-time-tf-spy-1d-2026-09-10.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-time-tf-spy-1d-2026-09-11.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-tr-true-spy-1d-2026-09-12.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-valuewhen-spy-1d-2026-09-10.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/r11-valuewhen-spy-2026-09-11.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/A/clouds-volume-spy-1d-250.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/A/volume-spy-1d-250.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/B/clouds-volume-nvda-1d-250.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/B/volume-nvda-1d-250.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/C/clouds-volume-spy-1w-150.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/C/volume-spy-1w-150.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/D/clouds-volume-spy-4h-300.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/D/volume-spy-4h-300.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/E/e0-defaults-control-spy-1d-250.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/E/e1-sma-sma-spy-1d-250.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/E/e2-sma-high-ema-low-spy-1d-250.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/E/e3-ema-5-50-spy-1d-250.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/E/e4-ema-21-8-inverted-spy-1d-250.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/E/e5-custom-colours-spy-1d-250.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/E/e6-hide-both-mas-spy-1d-250.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/E/e7a-fast-calc-true-spy-1d-250.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/E/e7b-profile-true-spy-1d-250.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/E/e8-sma-sma-nvda-4h-300.meta.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/F/f1-fill-v6.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/F/f2-fill-v4.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/reference/F/f3-linewidth-v6.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/runtime/callsite-state-spy-1d-2026-09-08.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/runtime/finite-window-na-policy-by-member-spy-1d-2026-09-08.json` — market.bars does not carry the vendor's OHLCV with a unix time (bar_index or nulls in `t`/OHLC) — the series cannot be recomputed
- `tests/fixtures/vendor/runtime/mutable-history-spy-1d-2026-09-08.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/runtime/na-in-a-source-window-vs-recurrence-spy-1d-2026-09-08.json` — market.bars does not carry the vendor's OHLCV with a unix time (bar_index or nulls in `t`/OHLC) — the series cannot be recomputed
- `tests/fixtures/vendor/runtime/recurrent-callsite-identity-and-event-history-spy-1d-2026-09-08.json` — market.bars does not carry the vendor's OHLCV with a unix time (bar_index or nulls in `t`/OHLC) — the series cannot be recomputed
- `tests/fixtures/vendor/runtime/recurrent-composites-and-window-closure-spy-1d-2026-09-08.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/runtime/recurrent-na-and-skipped-callsite-spy-1d-2026-09-08.json` — vendor readings are not a per-bar `values` series (split rows or named samples) — nothing contiguous to compare bar by bar
- `tests/fixtures/vendor/runtime/skipped-callsite-history-spy-1d-2026-09-08.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/runtime/ta-cum-and-context-namespaces-spy-1d-2026-09-08.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/runtime/vw-runtime-error-reached-spy-1d-2026-09-30.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/saved-probe-integrity-2026-09-10.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json` — these are OUR bars (/api/bars), not the vendor's — a companion file, not a capture
- `tests/fixtures/vendor/tuple-security-spy-1d-closed-2026-09-10.json` — the capture holds a short tail of study values but NOT the vendor's OHLCV — our side cannot be run on the vendor's bars
- `tests/fixtures/vendor/uncharted-volume-v2-agen-1d-hve-2026-09-12.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/uncharted-volume-v2-spy-1d-2026-09-12.json` — only 4 hand-read rows and no vendor OHLCV series
- `tests/fixtures/vendor/uncharted-volume-v2-spy-1d-forced-depth-2026-09-13.json` — only 4 hand-read rows and no vendor OHLCV series
- `tests/fixtures/vendor/visual/five-indicators-spy-1d-2026-09-23.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/visual/fvg-boxes-spy-1d-2026-09-22.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/visual/marker-semantics-spy-1d-2026-09-07.json` — vendor readings are not a per-bar `values` series (split rows or named samples) — nothing contiguous to compare bar by bar
- `tests/fixtures/vendor/visual/object-semantics-spy-1d-2026-09-08.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/w3-format-spy-1d-2026-09-22.json` — no vendor OHLCV series together with per-bar study values and a script source
