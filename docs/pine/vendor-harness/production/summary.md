# Vendor harness — verdicts

Directories: `tests/fixtures/vendor`

Lane: **production**. LANE MEASURED: production (gate CLOSED, runtime lane reached 0, host refusals 534) · objects-only pane ARMED · runtime drew 0, declined 0 · strategy lane: broker gate off, 77 graded on their trades, 0 broker run(s)

Graded at script engine **89**.

```
capture                                      symbol/tf        plots  verdict           first divergence / reason
-------------------------------------------- ---------------- ------ ----------------- ----------------------------------------
3-level-zigzag-semafor-rddt-1d-2026-11-14    NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:function): `time(<timeframe>)` is the OPENING TIMESTAMP of the enclosing period — the anchor Pine scripts compare with `>` to detect a new day or week. `time("D")` (or a timeframe argument that folds to `"D"`) translates, and so do `"W"`, `"M"`, `"3M"` and `"12M"` on 5-minute, 15-minute, 60-minute, 1D, 1W and 1M charts (vendor captures `vw-time-tf-spy-{5,15,1d-full,1w,1m}-2026-10-01`, `vw-time-tf-spy-60-2026-09-28`); `time(timeframe.period)` is the bar's own `time` on those charts, and `time("60")` the open of its 60-minute bar (the same probe). Any OTHER period this engine does not have a node for: the clock it does declare is `dayofweek`, `dayofmonth`, `month`, `year` and `sessionfirst` — and `sessionfirst` is the closest to what an anchor comparison is usually asking
3-level-zigzag-semafor-spy-1d-2026-11-14     AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:function): `time(<timeframe>)` is the OPENING TIMESTAMP of the enclosing period — the anchor Pine scripts compare with `>` to detect a new day or week. `time("D")` (or a timeframe argument that folds to `"D"`) translates, and so do `"W"`, `"M"`, `"3M"` and `"12M"` on 5-minute, 15-minute, 60-minute, 1D, 1W and 1M charts (vendor captures `vw-time-tf-spy-{5,15,1d-full,1w,1m}-2026-10-01`, `vw-time-tf-spy-60-2026-09-28`); `time(timeframe.period)` is the bar's own `time` on those charts, and `time("60")` the open of its 60-minute bar (the same probe). Any OTHER period this engine does not have a node for: the clock it does declare is `dayofweek`, `dayofmonth`, `month`, `year` and `sessionfirst` — and `sessionfirst` is the closest to what an anchor comparison is usually asking
3-level-zigzag-semafor-spy-60-2026-11-14     AMEX:SPY 60      0      INCONCLUSIVE      refused on our side: member door refused (pine:function): `time(<timeframe>)` is the OPENING TIMESTAMP of the enclosing period — the anchor Pine scripts compare with `>` to detect a new day or week. `time("D")` (or a timeframe argument that folds to `"D"`) translates, and so do `"W"`, `"M"`, `"3M"` and `"12M"` on 5-minute, 15-minute, 60-minute, 1D, 1W and 1M charts (vendor captures `vw-time-tf-spy-{5,15,1d-full,1w,1m}-2026-10-01`, `vw-time-tf-spy-60-2026-09-28`); `time(timeframe.period)` is the bar's own `time` on those charts, and `time("60")` the open of its 60-minute bar (the same probe). Any OTHER period this engine does not have a node for: the clock it does declare is `dayofweek`, `dayofmonth`, `month`, `year` and `sessionfirst` — and `sessionfirst` is the closest to what an anchor comparison is usually asking
4c-nyse-market-breadth-ratio-rddt-1d-2026-11 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:request): This indicator reads `USI:UVOL`: other-symbol:venue-foreign — `USI:UVOL` names the exchange `USI`, outside the US stock listings our bar store holds, so what this indicator draws from it is not computed. It is a market breadth series (advancing / declining issues or volume), and this breadth symbol is not available yet.
4c-nyse-market-breadth-ratio-spy-1d-2026-11- AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): This indicator reads `USI:UVOL`: other-symbol:venue-foreign — `USI:UVOL` names the exchange `USI`, outside the US stock listings our bar store holds, so what this indicator draws from it is not computed. It is a market breadth series (advancing / declining issues or volume), and this breadth symbol is not available yet.
ad-line-of-sp-sectors-rddt-1d-2026-11-14     NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:request): This indicator reads `SP:SPN`: other-symbol:venue-foreign — `SP:SPN` names the exchange `SP`, outside the US stock listings our bar store holds, so what this indicator draws from it is not computed.
ad-line-of-sp-sectors-spy-1d-2026-11-14      AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): This indicator reads `SP:SPN`: other-symbol:venue-foreign — `SP:SPN` names the exchange `SP`, outside the US stock listings our bar store holds, so what this indicator draws from it is not computed.
adaptive-trend-following-suite-alpha-extract NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `TradingView/ta/10` is not in this engine's library registry, so its code cannot be compiled
advanced-custom-multi-ma-signals-emasmavwmav NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `240` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `240` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
advanced-custom-multi-ma-signals-emasmavwmav AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `240` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `240` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
adx-and-di-for-v4-rddt-1d-2026-09-27         NYSE:RDDT D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `SmoothedDirectionalMovementPlus` builds on its own previous bar without ever forgetting where it started, and this engine's accumulator re-seeds a fixed number of bars back, so it would become a rolling sum rather than a running total
adx-and-di-for-v4-rddt-1d-2026-11-17         NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `SmoothedDirectionalMovementPlus` builds on its own previous bar without ever forgetting where it started, and this engine's accumulator re-seeds a fixed number of bars back, so it would become a rolling sum rather than a running total
adx-and-di-for-v4-spy-1d-2026-10-03          AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `SmoothedDirectionalMovementPlus` builds on its own previous bar without ever forgetting where it started, and this engine's accumulator re-seeds a fixed number of bars back, so it would become a rolling sum rather than a running total
adx-and-di-for-v4-spy-1d-2026-11-17          AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `SmoothedDirectionalMovementPlus` builds on its own previous bar without ever forgetting where it started, and this engine's accumulator re-seeds a fixed number of bars back, so it would become a rolling sum rather than a running total
all-chart-patterns-theeccentrictrader-rddt-1 NYSE:RDDT 1D     0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 157 paired slots; 43 slots on objects neither side draws not graded; coordinates are NOT compared by v1
all-chart-patterns-theeccentrictrader-spy-1d AMEX:SPY 1D      0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 170 paired slots; 34 slots on objects neither side draws not graded; coordinates are NOT compared by v1
anchored-vwap-pinch-handoff-intervals-and-si NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:tuple): this Pine call answers with several values at once and a column carries one — `vwapH` — `avwap` is a function this script defines and this engine could not read, so none of its values can be handed out — this Pine call answers with several values at once and a column carries one — this engine has no tuple form for `ta.vwap` — the ones it can take apart are `ta.bb`, `ta.dmi`, `ta.kc`, `ta.macd`, `ta.supertrend`. Writing it WITHOUT the brackets says more about why (reached through `avwap`)
anchored-vwap-pinch-handoff-intervals-and-si AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:tuple): this Pine call answers with several values at once and a column carries one — `vwapH` — `avwap` is a function this script defines and this engine could not read, so none of its values can be handed out — this Pine call answers with several values at once and a column carries one — this engine has no tuple form for `ta.vwap` — the ones it can take apart are `ta.bb`, `ta.dmi`, `ta.kc`, `ta.macd`, `ta.supertrend`. Writing it WITHOUT the brackets says more about why (reached through `avwap`)
artemis-oscillator-pro-rddt-1d-2026-09-28    NYSE:RDDT 1D     12     DIVERGE           1 of 14 compared items diverge
    VP Bull                                  MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 8.15e-16
    VP Bear                                  MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.18e-15
    VP Base                                  MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    DRM Oscillator                           MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Signal Line                              MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 4.06e-16
    Bull Cross Dot                           MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 3.44e-16
    Bear Cross Dot                           MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 3.53e-16
    OB Level                                 MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    OS Level                                 MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Plot                                     MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Plot                                     MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Plot                                     MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 88 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
artemis-oscillator-pro-rddt-1d-2026-11-15    NYSE:RDDT 1D     12     DIVERGE           1 of 14 compared items diverge
    VP Bull                                  MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 8.51e-16
    VP Bear                                  MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 7.17e-16
    VP Base                                  MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    DRM Oscillator                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Signal Line                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 4.06e-16
    Bull Cross Dot                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 3.44e-16
    Bear Cross Dot                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 3.53e-16
    OB Level                                 MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    OS Level                                 MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Plot                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Plot                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Plot                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 91 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
artemis-oscillator-pro-spy-1d-2026-10-03     AMEX:SPY 1D      12     DIVERGE           1 of 14 compared items diverge
    VP Bull                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 8.03e-16
    VP Bear                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.85e-15
    VP Base                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    DRM Oscillator                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Signal Line                              MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 4.29e-16
    Bull Cross Dot                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 4.29e-16
    Bear Cross Dot                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 3.16e-16
    OB Level                                 MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    OS Level                                 MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 608 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
artemis-oscillator-pro-spy-1d-2026-11-15     AMEX:SPY 1D      12     DIVERGE           1 of 14 compared items diverge
    VP Bull                                  MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 1.13e-15
    VP Bear                                  MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 7.22e-16
    VP Base                                  MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    DRM Oscillator                           MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    Signal Line                              MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 4.45e-16
    Bull Cross Dot                           MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 4.29e-16
    Bear Cross Dot                           MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 4.06e-16
    OB Level                                 MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    OS Level                                 MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    Plot                                     MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    Plot                                     MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    Plot                                     MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 608 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
asianrange-and-killzones-rddt-1d-2026-11-14  NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
asianrange-and-killzones-spy-1d-2026-11-14   AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
atr-bands-rddt-1d-2026-10-02                 NYSE:RDDT 1D     4      MATCH             all 5 items agree
    Upper ATR Band                           MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Lower ATR Band                           MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Upper Take-Profit Band                   MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Lower Take-Profit Band                   MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; no colour slot was paired, so no colour was graded; coordinates are NOT compared by v1
atr-bands-spy-1d-2026-10-03                  AMEX:SPY 1D      4      MATCH             all 5 items agree
    Upper ATR Band                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Lower ATR Band                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Upper Take-Profit Band                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Lower Take-Profit Band                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; no colour slot was paired, so no colour was graded; coordinates are NOT compared by v1
atr-god-strategy-by-tradesmart-rddt-1d-2026- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — a Pine block spans several statements and this engine stores a single expression (reached through `switch_ma`); strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
atr-god-strategy-by-tradesmart-spy-1d-2026-1 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — a Pine block spans several statements and this engine stores a single expression (reached through `switch_ma`); strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
atr-stepped-pdf-ma-loxx-rddt-1d-2026-10-03   NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `_pdfma`)
atr-stop-loss-indicator-rddt-1d-2026-11-15   NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `ZenAndTheArtOfTrading/ZenLibrary/9` is not in this engine's library registry, so its code cannot be compiled
atr-support-and-resistance-rddt-1d-2026-09-2 NYSE:RDDT 1D     9      INCONCLUSIVE      1 of 11 items could not be compared
    Impulse Up                               MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Impulse Down                             MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    RSI Mid Line Support                     MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    RSI Mid Line Resistance                  MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    RSI Overbought                           MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    RSI Oversold                             MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Ran Previous High                        MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Ran Previous Low                         MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Moving Average                           MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  INCONCLUSIVE  our lines, boxes are withheld by name (objects:not-carried: No line or box is shown on this chart: the script makes them in steps this chart can't follow yet, so none are drawn here, though TradingView may draw some.); every other object family's counts and texts agree
    paints                                   MATCH         4 paints agree bar for bar
atr-support-and-resistance-spy-1d-2026-10-03 AMEX:SPY 1D      9      INCONCLUSIVE      1 of 11 items could not be compared
    Impulse Up                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Impulse Down                             MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    RSI Mid Line Support                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    RSI Mid Line Resistance                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    RSI Overbought                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    RSI Oversold                             MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Ran Previous High                        MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Ran Previous Low                         MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Moving Average                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  INCONCLUSIVE  our lines, boxes are withheld by name (objects:not-carried: No line or box is shown on this chart: the script makes them in steps this chart can't follow yet, so none are drawn here, though TradingView may draw some.); every other object family's counts and texts agree
    paints                                   MATCH         4 paints agree bar for bar
atr-trailing-stop-by-ceyhun-rddt-1d-2026-10- NYSE:RDDT 1D     4      DIVERGE           1 of 6 compared items diverge
    Fast Trail                               MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Slow Trail                               MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 4.69e-16
    BUY                                      MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    SELL                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 1 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 4 drawing steps (dropped: create:label ×2; pine:function)
    paints                                   MATCH         1 paint agree bar for bar
atr-trailing-stop-by-ceyhun-spy-1d-2026-10-0 AMEX:SPY 1D      4      DIVERGE           1 of 6 compared items diverge
    Fast Trail                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Slow Trail                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    BUY                                      MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    SELL                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 1 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 4 drawing steps (dropped: create:label ×2; pine:function)
    paints                                   MATCH         1 paint agree bar for bar
atr-trailing-stoploss-rddt-1d-2026-09-27     NYSE:RDDT D      3      MATCH             all 5 items agree
    ATR Trailing Stoploss                    MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    BUY                                      MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    SELL                                     MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         1 paint agree bar for bar
atr-trailing-stoploss-spy-1d-2026-10-03      AMEX:SPY 1D      3      MATCH             all 5 items agree
    ATR Trailing Stoploss                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    BUY                                      MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    SELL                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         1 paint agree bar for bar
atr-trend-bands-misu-rddt-1d-2026-11-15      NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:library-denied): this library version is withheld until its drawing is verified against TradingView — the library `Fontiramisu/fontilab/11` is not served: this library version is withheld until its drawing is verified against TradingView
auto-harmonic-patterns-open-source-rddt-1d-2 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
auto-trendline-dojiemoji-rddt-1d-2026-10-02  NYSE:RDDT 1D     6      DIVERGE           1 of 7 compared items diverge
    HH                                       MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    LH                                       MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    LL                                       MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    HL                                       MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Crossed upper trendline                  MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Crossed lower trendline                  MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (line.delete)
auto-trendline-dojiemoji-spy-1d-2026-10-03   AMEX:SPY 1D      6      DIVERGE           1 of 7 compared items diverge
    HH                                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    LH                                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    LL                                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    HL                                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Crossed upper trendline                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Crossed lower trendline                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (line.delete)
auto-trendlines-tradingfinder-support-resist NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `TFlab/AlertSenderLibrary_TradingFinder/1` is not in this engine's library registry, so its code cannot be compiled
average-day-range-adr-pivots-rddt-1d-2026-09 NYSE:RDDT 1D     7      MATCH             all 8 items agree
    ADR 1 Resistance                         MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    ADR 1 Support                            MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    ADR 2 Resistance                         MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    ADR 2 Support                            MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MA 1                                     MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MA 2                                     MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MA 3                                     MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 16 paired slots; coordinates are NOT compared by v1
average-day-range-adr-pivots-rddt-1d-2026-11 NYSE:RDDT 1D     7      MATCH             all 8 items agree
    ADR 1 Resistance                         MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    ADR 1 Support                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    ADR 2 Resistance                         MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    ADR 2 Support                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    MA 1                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    MA 2                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    MA 3                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 16 paired slots; coordinates are NOT compared by v1
average-day-range-adr-pivots-spy-1d-2026-10- AMEX:SPY 1D      7      MATCH             all 8 items agree
    ADR 1 Resistance                         MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    ADR 1 Support                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    ADR 2 Resistance                         MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    ADR 2 Support                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MA 1                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MA 2                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MA 3                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 16 paired slots; coordinates are NOT compared by v1
average-day-range-adr-pivots-spy-1d-2026-11- AMEX:SPY 1D      7      DIVERGE           1 of 8 compared items diverge
    ADR 1 Resistance                         MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    ADR 1 Support                            MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    ADR 2 Resistance                         MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    ADR 2 Support                            MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    MA 1                                     MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    MA 2                                     MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    MA 3                                     MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    objects                                  DIVERGE       1 object families differ (count or text); colours agree on 15 paired slots; coordinates are NOT compared by v1
black-scholes-option-pricing-model-w-greeks- NASDAQ:AAPL 1D   0      INCONCLUSIVE      refused on our side: member door refused (pine:library-denied): this library version is withheld until its drawing is verified against TradingView — the library `loxx/loxxexpandedsourcetypes/4` is not served: this library version is withheld until its drawing is verified against TradingView
black-scholes-option-pricing-model-w-greeks- NYSE:JPM 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:library-denied): this library version is withheld until its drawing is verified against TradingView — the library `loxx/loxxexpandedsourcetypes/4` is not served: this library version is withheld until its drawing is verified against TradingView
black-scholes-option-pricing-model-w-greeks- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:library-denied): this library version is withheld until its drawing is verified against TradingView — the library `loxx/loxxexpandedsourcetypes/4` is not served: this library version is withheld until its drawing is verified against TradingView
black-scholes-option-pricing-model-w-greeks- AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:library-denied): this library version is withheld until its drawing is verified against TradingView — the library `loxx/loxxexpandedsourcetypes/4` is not served: this library version is withheld until its drawing is verified against TradingView
blackflag-fts-rddt-1d-2026-11-14             NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:function-def): a Pine function definition introduces a name this engine has nowhere to keep — `Wild_ma` ends in no value this engine can read (reached through `Wild_ma`)
blackflag-fts-spy-1d-2026-11-14              AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:function-def): a Pine function definition introduces a name this engine has nowhere to keep — `Wild_ma` ends in no value this engine can read (reached through `Wild_ma`)
bolingger-bands-inside-bar-boxes-rddt-1d-202 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `IBStatus` — and the fold stopped before it, at line 98: this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `IBStatus`
bolingger-bands-inside-bar-boxes-rddt-1d-202 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `IBStatus` — and the fold stopped before it, at line 98: this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `IBStatus`
bolingger-bands-inside-bar-boxes-spy-1d-2026 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `IBStatus` — and the fold stopped before it, at line 98: this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `IBStatus`
bollinger-band-width-percentile-rddt-1d-2026 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `array.binary_search_rightmost`
boom-hunter-entry-point-screener-alerts-rddt NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:function-def): a Pine function definition introduces a name this engine has nowhere to keep — `eot_func` ends in no value this engine can read (reached through `eot_func`)
boom-hunter-entry-point-screener-alerts-spy- AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:function-def): a Pine function definition introduces a name this engine has nowhere to keep — `eot_func` ends in no value this engine can read (reached through `eot_func`)
breaks-and-retests-hg-rddt-1d-2026-11-14     NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — sBreak
btc-charlie-trader-xo-macro-trend-scanner-rd NYSE:RDDT 1D     5      MATCH             all 7 items agree
    Consolidated EMA                         MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    Fast EMA                                 MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 5.52e-16
    Slow EMA                                 MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 1.39e-15
    Bull                                     MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    Bear                                     MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         4 paints agree bar for bar; 4 paints neither side draws not graded (plot_14, plot_15, plot_16, plot_17)
btc-charlie-trader-xo-macro-trend-scanner-sp AMEX:SPY 1D      5      MATCH             all 7 items agree
    Consolidated EMA                         MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Fast EMA                                 MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 4.77e-16
    Slow EMA                                 MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.35e-15
    Bull                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bear                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         4 paints agree bar for bar; 4 paints neither side draws not graded (plot_14, plot_15, plot_16, plot_17)
camarilla-rddt-1d-2026-11-14                 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:window): a Pine length has to reach the engine as a plain whole number — argument 2 of `rsi`
camarilla-spy-1d-2026-11-14                  AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:window): a Pine length has to reach the engine as a plain whole number — argument 2 of `rsi`
candelacharts-equal-highslows-eqheql-rddt-1d NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:type): a user-defined type is outside the node shapes this engine stores — `bull_alert.ehl`
candlestick-patterns-identified-update-1-17- NYSE:RDDT 1D     15     MATCH             all 16 items agree
    Doji                                     MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bearish Harami                           MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bullish Harami                           MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bearish Engulfing                        MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bullish Engulfing                        MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Piercing Line                            MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bullish Belt                             MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bullish Kicker                           MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bearish Kicker                           MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Hanging Man                              MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Evening Star                             MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Morning Star                             MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Shooting Star                            MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Hammer                                   MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Inverted Hammer                          MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
candlestick-patterns-identified-update-1-17- AMEX:SPY 1D      15     MATCH             all 16 items agree
    Doji                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bearish Harami                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bullish Harami                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bearish Engulfing                        MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bullish Engulfing                        MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Piercing Line                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bullish Belt                             MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bullish Kicker                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bearish Kicker                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Hanging Man                              MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Evening Star                             MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Morning Star                             MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Shooting Star                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Hammer                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Inverted Hammer                          MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
candlestick-patterns-on-backtest-rddt-1d-202 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `MUQWISHI/CandlestickPatterns/2` is not in this engine's library registry, so its code cannot be compiled
cc-yata-rddt-1d-2026-09-27                   NYSE:RDDT D      0      INCONCLUSIVE      refused on our side: member door refused (pine:timeout): this Pine script did not finish translating inside the time budget — resolving `buyCounCC8Close` nested past 400 levels. That is a translator defect, not a limit on the script: this door expands a variable by re-reading its definition, and a definition that reaches its own previous bar can be re-entered without end. The deepest legitimate script measured needs 20 levels.
cdc-btc-rainbow-road-spy-1d-2026-10-02       AMEX:SPY 1D      13     MATCH             all 14 items agree
    Lower Channel                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.64e-15
    Upper Channel                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.64e-15
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.64e-15
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.77e-15
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.61e-15
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.76e-15
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.73e-15
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.65e-15
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.65e-15
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.73e-15
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.77e-15
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.83e-15
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.66e-15
    objects                                  MATCH         neither side draws an object
chart-champions-part-1-npoc-levels-vwaps-rdd NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (budget:lookback): this script is not drawn: its plot `pdVWAP` needs 961 bars of history behind every bar, and one plot may reach back at most 960 here. `vwap()` reaches back one whole trading session, which is the entire lookback budget — so it can be compared and combined, but nothing can be wrapped around it (no moving average of it, no bar offset on it)
chart-champions-part-1-npoc-levels-vwaps-spy AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (budget:lookback): this script is not drawn: its plot `pdVWAP` needs 961 bars of history behind every bar, and one plot may reach back at most 960 here. `vwap()` reaches back one whole trading session, which is the entire lookback budget — so it can be compared and combined, but nothing can be wrapped around it (no moving average of it, no bar offset on it)
chart-vwap-rddt-1d-2026-11-15                NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `PineCoders/VisibleChart/5` is not in this engine's library registry, so its code cannot be compiled
contraction-box-doji-lines-rddt-1d-2026-09-2 NYSE:RDDT 1D     0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 82 paired slots; 96 slots on objects neither side draws not graded; coordinates are NOT compared by v1
contraction-box-doji-lines-rddt-1d-2026-11-1 NYSE:RDDT 1D     0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 92 paired slots; 102 slots on objects neither side draws not graded; coordinates are NOT compared by v1
contraction-box-doji-lines-spy-1d-2026-10-03 AMEX:SPY 1D      0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 208 paired slots; 102 slots on objects neither side draws not graded; coordinates are NOT compared by v1
contraction-box-doji-lines-spy-1d-2026-11-15 AMEX:SPY 1D      0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 210 paired slots; 96 slots on objects neither side draws not graded; coordinates are NOT compared by v1
cppivot-boss-floor-pivots-with-atr-dilation- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `security`
cppivot-boss-floor-pivots-with-atr-dilation- AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `security`
cpr-with-mas-super-trend-vwap-by-guruprasadm NYSE:RDDT 1D     29     MATCH             all 30 items agree
    CP                                       MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    BC                                       MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    TC                                       MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    D-S1                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    D-S2                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    D-S3                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    D-R1                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    D-R2                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    D-R3                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    W-P                                      MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    W-S1                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    W-S2                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    W-S3                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    W-R1                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    W-R2                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    W-R3                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
     M-P                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    M-S1                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    M-S2                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    M-S3                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    M-R1                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    M-R2                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    M-R3                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    SMA                                      MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.57e-15
    EMA                                      MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.27e-15
    VWAP                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    SuperTrend                               MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 4.92e-16
    Up Arrow                                 MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Down Arrow                               MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
cpr-with-mas-super-trend-vwap-by-guruprasadm AMEX:SPY 1D      29     MATCH             all 30 items agree
    CP                                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    BC                                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    TC                                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D-S1                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D-S2                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D-S3                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D-R1                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D-R2                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D-R3                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    W-P                                      MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    W-S1                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    W-S2                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    W-S3                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    W-R1                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    W-R2                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    W-R3                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
     M-P                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    M-S1                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    M-S2                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    M-S3                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    M-R1                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    M-R2                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    M-R3                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    SMA                                      MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.99e-15
    EMA                                      MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.36e-15
    VWAP                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    SuperTrend                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Up Arrow                                 MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Down Arrow                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
cumulative-volume-delta-6ba9ad54-rddt-1d-202 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `security`
cumulative-volume-delta-6ba9ad54-spy-1d-2026 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `security`
cumulative-volume-delta-rddt-1d-2026-09-27   NYSE:RDDT D      4      MATCH             all 5 items agree
    Plot                                     MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 7.58e-16
    Plot                                     MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 8.08e-16
    Plot                                     MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 9.92e-16
    Plot                                     MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 6.55e-13
    objects                                  MATCH         neither side draws an object
cumulative-volume-delta-spy-1d-2026-10-03    AMEX:SPY 1D      4      MATCH             all 5 items agree
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 8.13e-16
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 7.24e-16
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 9.90e-16
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 3.69e-13
    objects                                  MATCH         neither side draws an object
cvd-cumulative-volume-delta-candles-rddt-1d- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `PineCoders/Time/5` is not in this engine's library registry, so its code cannot be compiled
cvd-cumulative-volume-delta-candles-spy-1d-2 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `PineCoders/Time/5` is not in this engine's library registry, so its code cannot be compiled
cvd-cumulative-volume-delta-chart-rddt-1d-20 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `PineCoders/Time/5` is not in this engine's library registry, so its code cannot be compiled
cvd-cumulative-volume-delta-chart-spy-1d-202 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `PineCoders/Time/5` is not in this engine's library registry, so its code cannot be compiled
deadband-hysteresis-filter-backquant-rddt-1d NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `dbhf` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total
delta-imbalance-map-joat-rddt-1d-2026-11-15  NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `newBullZone` — and the fold stopped before it, at line 173: a Pine block spans several statements and this engine stores a single expression — `for`
delta-imbalance-map-joat-spy-1d-2026-11-15   AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `newBullZone` — and the fold stopped before it, at line 173: a Pine block spans several statements and this engine stores a single expression — `for`
delta-rsi-oscillator-strategy-rddt-1d-2026-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:tuple): this Pine call answers with several values at once and a column carries one — `drsi` — `diff` is a function this script defines and this engine could not read, so none of its values can be handed out — a Pine block spans several statements and this engine stores a single expression — `for` (reached through `diff`)
delta-rsi-oscillator-strategy-spy-1d-2026-10 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:tuple): this Pine call answers with several values at once and a column carries one — `drsi` — `diff` is a function this script defines and this engine could not read, so none of its values can be handed out — a Pine block spans several statements and this engine stores a single expression — `for` (reached through `diff`)
delta-volume-candles-lucf-rddt-1d-2026-11-15 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `PineCoders/Time/2` is not in this engine's library registry, so its code cannot be compiled
delta-volume-candles-lucf-spy-1d-2026-11-15  AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `PineCoders/Time/2` is not in this engine's library registry, so its code cannot be compiled
delta-volume-v21-by-kernel-phi-rddt-1d-2026- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `security`
delta-volume-v21-by-kernel-phi-spy-1d-2026-1 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `security`
deviation-scaled-moving-average-w-dsl-loxx-r NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:library-denied): this library version is withheld until its drawing is verified against TradingView — the library `loxx/loxxexpandedsourcetypes/4` is not served: this library version is withheld until its drawing is verified against TradingView
deviation-scaled-moving-average-w-dsl-loxx-s AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:library-denied): this library version is withheld until its drawing is verified against TradingView — the library `loxx/loxxexpandedsourcetypes/4` is not served: this library version is withheld until its drawing is verified against TradingView
donchian-channels-rddt-1d-2026-09-28         NYSE:RDDT 1D     13     MATCH             all 14 items agree
    Basis                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Upper Donchian                           MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Upper Donchian | Inner                   MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Upper .786                               MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Upper Mid                                MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Upper.702                                MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Upper .382                               MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Lower .382                               MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Lower .702                               MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Lower Mid                                MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Lower .786                               MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Lower Donchian | Inner                   MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Lower Donchian                           MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
donchian-channels-spy-1d-2026-10-03          AMEX:SPY 1D      13     MATCH             all 14 items agree
    Basis                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Upper Donchian                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Upper Donchian | Inner                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Upper .786                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Upper Mid                                MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Upper.702                                MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Upper .382                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Lower .382                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Lower .702                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Lower Mid                                MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Lower .786                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Lower Donchian | Inner                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Lower Donchian                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
double-topbottom-ultimate-os-rddt-1d-2026-11 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `zigzagvalues` is written at line 55 by a statement this lane does not model (inside a block, a function, or a call), so its slots are not known before the chart runs
dual-view-htf-candlestick-patterns-theultima NYSE:RDDT 1D     1      DIVERGE           1 of 2 compared items diverge
    HTF MA                                   MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 436 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (coll:diverged, guard:copy, guard:delete, guard:loop, loop:bounds)
dual-view-htf-candlestick-patterns-theultima AMEX:SPY 1D      1      DIVERGE           1 of 2 compared items diverge
    HTF MA                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 272 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (coll:diverged, guard:copy, guard:delete, guard:loop, loop:bounds)
elliot-wave-detector-pro-rddt-1d-2026-11-14  NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `primaryPivots` is written at line 1674 by a statement this lane does not model (inside a block, a function, or a call), so its slots are not known before the chart runs
elliot-wave-detector-pro-spy-1d-2026-11-14   AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `primaryPivots` is written at line 1674 by a statement this lane does not model (inside a block, a function, or a call), so its slots are not known before the chart runs
elliot-wave-detector-pro-spy-60-2026-11-14   AMEX:SPY 60      0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `primaryPivots` is written at line 1674 by a statement this lane does not model (inside a block, a function, or a call), so its slots are not known before the chart runs
elliott-wave-3-finder-v2-rddt-1d-2026-09-28  NYSE:RDDT 1D     1      MATCH             all 3 items agree
    Plot                                     MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 2.63e-12
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         2 paints agree bar for bar
elliott-wave-3-finder-v2-spy-1d-2026-10-03   AMEX:SPY 1D      1      MATCH             all 3 items agree
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.57e-11
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         2 paints agree bar for bar
ema-92150-vwap-macd-rsi-pro-v6-rddt-1d-2026- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `vwap_value`
ema-92150-vwap-macd-rsi-pro-v6-rddt-1d-2026- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `vwap_value`
ema-92150-vwap-macd-rsi-pro-v6-spy-1d-2026-1 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `vwap_value`
ema-ribbon-trend-filter-strixedge-rddt-1d-20 NYSE:RDDT 1D     13     DIVERGE           1 of 15 compared items diverge
    Fast EMA                                 MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 3.66e-16
    Mid EMA                                  MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.02e-15
    Slow EMA                                 MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 9.49e-16
    F×M ▲                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    F×M ▼                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    F×S ▲                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    F×S ▼                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    M×S ▲                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    M×S ▼                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Squeeze Start                            MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 8.06e-16
    Squeeze Release ▲                        MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Squeeze Release ▼                        MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Squeeze Release ◆                        MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 4.87e-16
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 73 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         2 paints agree bar for bar
ema-ribbon-trend-filter-strixedge-spy-1d-202 AMEX:SPY 1D      13     DIVERGE           1 of 15 compared items diverge
    Fast EMA                                 MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 4.20e-16
    Mid EMA                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.04e-15
    Slow EMA                                 MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.39e-15
    F×M ▲                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    F×M ▼                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    F×S ▲                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    F×S ▼                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    M×S ▲                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    M×S ▼                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Squeeze Start                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 9.46e-16
    Squeeze Release ▲                        MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Squeeze Release ▼                        MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Squeeze Release ◆                        MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.64e-16
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 73 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         2 paints agree bar for bar
engulfingcandle-rddt-1d-2026-09-27           NYSE:RDDT D      2      MATCH             all 3 items agree
    bullish                                  MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    bearish                                  MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
engulfingcandle-spy-1d-2026-10-03            AMEX:SPY 1D      2      MATCH             all 3 items agree
    bullish                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    bearish                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
extrapolated-pivot-connector-rddt-1d-2026-09 NYSE:RDDT 1D     2      MATCH             all 3 items agree
    Pivot High's                             MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Pivot Low's                              MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 10 paired slots; coordinates are NOT compared by v1
extrapolated-pivot-connector-rddt-1d-2026-11 NYSE:RDDT 1D     2      MATCH             all 3 items agree
    Pivot High's                             MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Pivot Low's                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 10 paired slots; coordinates are NOT compared by v1
extrapolated-pivot-connector-spy-1d-2026-10- AMEX:SPY 1D      2      MATCH             all 3 items agree
    Pivot High's                             MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Pivot Low's                              MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 10 paired slots; coordinates are NOT compared by v1
extrapolated-pivot-connector-spy-1d-2026-11- AMEX:SPY 1D      2      MATCH             all 3 items agree
    Pivot High's                             MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    Pivot Low's                              MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 10 paired slots; coordinates are NOT compared by v1
fair-value-gap-rddt-1d-2026-11-14            NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:object-removal-lost): This script's drawing can't be shown yet. It removes drawings as it runs, and this chart can't follow part of that (a delete and a change to the list it deletes from), so drawing the rest would leave lines, labels, boxes or table cells on screen that TradingView would have removed.
fair-value-gap-rddt-1d-2026-11-15            NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:object-removal-lost): This script's drawing can't be shown yet. It removes drawings as it runs, and this chart can't follow part of that (a delete and a change to the list it deletes from), so drawing the rest would leave lines, labels, boxes or table cells on screen that TradingView would have removed.
fib-retracement-extrafibs-rddt-1d-2026-10-02 NYSE:RDDT 1D     0      INCONCLUSIVE      the vendor study ran with non-default inputs (Show 0.886 and 1.113 Fibs=true vs default false); v1 compares at default inputs only — re-capture at defaults
fib-retracement-rddt-1d-2026-10-02           NYSE:RDDT 1D     0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 21 paired slots; coordinates are NOT compared by v1
fib-retracement-rddt-1d-2026-11-15           NYSE:RDDT 1D     0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 21 paired slots; coordinates are NOT compared by v1
fib-retracement-spy-1d-2026-10-03            AMEX:SPY 1D      0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 21 paired slots; coordinates are NOT compared by v1
fib-retracement-spy-1d-2026-11-15            AMEX:SPY 1D      0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 21 paired slots; coordinates are NOT compared by v1
fibonacci-dolphintradebot-rddt-1d-2026-10-02 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `Z_value` is written at line 100 by a statement this lane does not model (inside a block, a function, or a call), so its slots are not known before the chart runs
fibonacci-dolphintradebot-rddt-1d-2026-11-15 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `Z_value` is written at line 100 by a statement this lane does not model (inside a block, a function, or a call), so its slots are not known before the chart runs
fibonacci-dolphintradebot-spy-1d-2026-10-02  AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `Z_value` is written at line 100 by a statement this lane does not model (inside a block, a function, or a call), so its slots are not known before the chart runs
fibonacci-pivot-points-cc-rddt-1d-2026-09-28 NYSE:RDDT 1D     7      MATCH             all 9 items agree
    PP                                       MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    R1                                       MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    R2                                       MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    R3                                       MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    S1                                       MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    S2                                       MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    S3                                       MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 14 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
fibonacci-pivot-points-cc-spy-1d-2026-10-03  AMEX:SPY 1D      7      MATCH             all 9 items agree
    PP                                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    R1                                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    R2                                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    R3                                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    S1                                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    S2                                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    S3                                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 14 paired slots; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
fibonacci-retracement-mtflog-rddt-1d-2026-11 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:statement): this Pine line is not a shape the translator reads (reached through `l_0236`)
fibonacci-retracement-statistics-by-volprofe NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:prop-unreadable): this script has no plot or alert condition, and the table it draws at line 1213 is withheld: a colour, width, count or tooltip of this drawing is a value this door cannot read; the drawing is withheld rather than drawn with a default colour, width or count
fibonacci-retracement-statistics-by-volprofe AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:prop-unreadable): this script has no plot or alert condition, and the table it draws at line 1213 is withheld: a colour, width, count or tooltip of this drawing is a value this door cannot read; the drawing is withheld rather than drawn with a default colour, width or count
fibonacci-retracement-statistics-by-volprofe AMEX:SPY 60      0      INCONCLUSIVE      refused on our side: member door refused (pine:prop-unreadable): this script has no plot or alert condition, and the table it draws at line 1213 is withheld: a colour, width, count or tooltip of this drawing is a value this door cannot read; the drawing is withheld rather than drawn with a default colour, width or count
footprint-iq-pro-tradingiq-rddt-1d-2026-11-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
footprint-iq-pro-tradingiq-spy-1d-2026-11-15 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
fvg-detector-tradingfinder-fair-value-gap-im NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
fvg-detector-tradingfinder-fair-value-gap-im NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
fvg-trend-rddt-1d-2026-09-27                 NYSE:RDDT D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `fvgCounter` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total
fvg-trend-rddt-1d-2026-11-17                 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `fvgCounter` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total
fvg-trend-spy-1d-2026-11-17                  AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `fvgCounter` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total
fx-market-sessions-rddt-1d-2026-11-15        NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `boitoki/AwesomeColor/9` is not in this engine's library registry, so its code cannot be compiled
h3-alma-v4-rddt-1d-2026-10-02                NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `pine_alma`)
h3-alma-v4-spy-1d-2026-10-02                 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `pine_alma`)
h3-vwap-source-spy-1d-2026-10-02             AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:arity): the engine grammar declares a different signature for that name — `ta.vwap` was given a source this table cannot weigh: the session VWAP is carried for a price the bar itself holds (`close`, `open`, `high`, `low`, `hl2`, `hlc3`, `ohlc4`, `hlcc4`) — vwap() / vwapOf(series). A computed source can be `na` on a bar, and what TradingView's session sum does with an `na` term has not been measured. TO UNBLOCK: weigh a bar price, e.g. `ta.vwap(close)`
h3-vwap-source-spy-5-2026-10-02              AMEX:SPY 5       0      INCONCLUSIVE      refused on our side: member door refused (pine:arity): the engine grammar declares a different signature for that name — `ta.vwap` was given a source this table cannot weigh: the session VWAP is carried for a price the bar itself holds (`close`, `open`, `high`, `low`, `hl2`, `hlc3`, `ohlc4`, `hlcc4`) — vwap() / vwapOf(series). A computed source can be `na` on a bar, and what TradingView's session sum does with an `na` term has not been measured. TO UNBLOCK: weigh a bar price, e.g. `ta.vwap(close)`
heat-map-seasons-rddt-1d-2026-09-28          NYSE:RDDT 1D     1      DIVERGE           1 of 3 compared items diverge
    Plot                                     MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.18e-14
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 34 paired slots; coordinates are NOT compared by v1
    paints                                   INCONCLUSIVE  no paint was graded; 1 paint withheld by name, not graded (first: barcolor plot_0 "Bar Color" — `barcolor`'s colour is an expression this door cannot carry yet)
heat-map-seasons-spy-1d-2026-10-03           AMEX:SPY 1D      1      DIVERGE           1 of 3 compared items diverge
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 9.40e-13
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 34 paired slots; coordinates are NOT compared by v1
    paints                                   INCONCLUSIVE  no paint was graded; 1 paint withheld by name, not graded (first: barcolor plot_0 "Bar Color" — `barcolor`'s colour is an expression this door cannot carry yet)
heikin-ashi-supertrend-rddt-1d-2026-11-15    NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `jordanfray/threengine_global_automation_library/89` is not in this engine's library registry, so its code cannot be compiled; strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
heikin-ashi-supertrend-spy-1d-2026-11-15     AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `jordanfray/threengine_global_automation_library/89` is not in this engine's library registry, so its code cannot be compiled; strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
heikin-ashi-true-strength-index-and-optimize NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:cycle): this Pine name is defined in terms of itself — `ma1`
heikin-ashi-true-strength-index-and-optimize NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:cycle): this Pine name is defined in terms of itself — `ma1`
heikin-ashi-true-strength-index-and-optimize AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:cycle): this Pine name is defined in terms of itself — `ma1`
high-low-open-mid-ranges-rddt-1d-2026-09-28  NYSE:RDDT 1D     7      MATCH             all 8 items agree
    plot_0                                   MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    plot_2                                   MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    plot_4                                   MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    plot_6                                   MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    plot_8                                   MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    plot_10                                  MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    plot_12                                  MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 1589 paired slots; 16 slots on objects neither side draws not graded; coordinates are NOT compared by v1
high-low-open-mid-ranges-spy-1d-2026-10-03   AMEX:SPY 1D      7      MATCH             all 8 items agree
    plot_0                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_2                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_4                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_6                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_8                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_10                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_12                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 1588 paired slots; 16 slots on objects neither side draws not graded; coordinates are NOT compared by v1
high_engagement__23-sweep-reversal-map-plus- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `bearishActive` is read, before it is set, inside the update of another `var` that is itself read before it is set in this one's, so the two carry each other's previous bar and one accumulator holds only one
high_engagement__23-sweep-reversal-map-plus- AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `bearishActive` is read, before it is set, inside the update of another `var` that is itself read before it is set in this one's, so the two carry each other's previous bar and one accumulator holds only one
htf-candle-footprint-cartel-console-rddt-1d- NYSE:RDDT 1D     0      INCONCLUSIVE      1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our lines, labels are withheld by name (objects:not-carried: No line or label is shown on this chart: the script makes them in steps this chart can't follow yet, so none are drawn here, though TradingView may draw some.); our drawing is a disclosed partial (boxes 3 of 13 drawn): each one drawn pairs with a record of TradingView's and agrees on every field this capture can compare, but where it sits on the chart (x) is not in this capture (it predates the x table), so its place is not witnessed; the rest are withheld by name (objects:partial-unpositioned); every other object family's counts and texts agree
htf-candle-footprint-cartel-console-spy-1d-2 AMEX:SPY 1D      0      INCONCLUSIVE      1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our lines, labels are withheld by name (objects:not-carried: No line or label is shown on this chart: the script makes them in steps this chart can't follow yet, so none are drawn here, though TradingView may draw some.); our drawing is a disclosed partial (boxes 3 of 11 drawn): each one drawn pairs with a record of TradingView's and agrees on every field this capture can compare, but where it sits on the chart (x) is not in this capture (it predates the x table), so its place is not witnessed; the rest are withheld by name (objects:partial-unpositioned); every other object family's counts and texts agree
htf-liquidity-dashboard-tfo-rddt-1d-2026-09- NYSE:RDDT 1D     0      DIVERGE           1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 19 paired slots; 4 slots on objects neither side draws not graded; coordinates are NOT compared by v1
htf-liquidity-dashboard-tfo-spy-1d-2026-10-0 AMEX:SPY 1D      0      DIVERGE           1 of 1 compared items diverge
    objects                                  DIVERGE       TradingView holds 43 drawing object(s) at the last bar and our drawing is withheld by name (objects:off-listing) — the line drawings live in a `var` list, and on a chart that does not start at the symbol's listing the objects earlier bars put there are not knowable
ict-institutional-order-flow-fadi-rddt-1d-20 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:object-removal-lost): This script's drawing can't be shown yet. It removes drawings as it runs, and this chart can't follow part of that (a function of its own that deletes), so drawing the rest would leave lines, labels, boxes or table cells on screen that TradingView would have removed.
ict-ipda-look-back-rddt-1d-2026-09-28        NYSE:RDDT 1D     0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 20 paired slots; coordinates are NOT compared by v1
ict-ipda-look-back-spy-1d-2026-10-03         AMEX:SPY 1D      0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 20 paired slots; coordinates are NOT compared by v1
ict-killzone-index-version-rddt-1d-2026-11-1 NYSE:RDDT 1D     0      MATCH             all 2 items agree
    objects                                  MATCH         object counts and texts agree; no colour slot was paired, so no colour was graded; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
ict-killzones-pivots-tfo-rddt-1d-2026-09-28  NYSE:RDDT 1D     7      MATCH             all 8 items agree
    Chars                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Chars                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Chars                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Chars                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Chars                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Chars                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Chars                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 9 paired slots (6 theme-relative); coordinates are NOT compared by v1
ict-killzones-pivots-tfo-spy-1d-2026-10-03   AMEX:SPY 1D      7      MATCH             all 8 items agree
    Chars                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Chars                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Chars                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Chars                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Chars                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Chars                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Chars                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 9 paired slots (6 theme-relative); coordinates are NOT compared by v1
implied-volatility-suite-rddt-1d-2026-10-02  NYSE:RDDT 1D     1      MATCH             all 2 items agree
    Volatility Data                          MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.70e-14
    objects                                  MATCH         neither side draws an object
implied-volatility-suite-spy-1d-2026-10-02   AMEX:SPY 1D      1      MATCH             all 2 items agree
    Volatility Data                          MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 5.42e-13
    objects                                  MATCH         neither side draws an object
initial-balance-ib-and-previous-day-week-hig NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `time(<timeframe>, <session>)`: it is read here on the chart's OWN timeframe (`timeframe.period`), which is what the vendor was measured on. A different period groups the session into bars this chart does not have, and nothing measured says how.
initial-balance-ib-and-previous-day-week-hig AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `time(<timeframe>, <session>)`: it is read here on the chart's OWN timeframe (`timeframe.period`), which is what the vendor was measured on. A different period groups the session into bars this chart does not have, and nothing measured says how.
inside-bar-boxes-rddt-1d-2026-11-14          NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `f` — and the fold stopped before it, at line 34: this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `f`
inside-bar-boxes-rddt-1d-2026-11-17          NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `f` — and the fold stopped before it, at line 34: this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `f`
inside-bar-boxes-spy-1d-2026-11-17           AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `f` — and the fold stopped before it, at line 34: this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `f`
inside-bar-range-mother-candle-breakoutbreak NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `breakoutOccurred` is read, before it is set, inside the update of another `var` that is itself read before it is set in this one's, so the two carry each other's previous bar and one accumulator holds only one
inside-bar-range-mother-candle-breakoutbreak NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `breakoutOccurred` is read, before it is set, inside the update of another `var` that is itself read before it is set in this one's, so the two carry each other's previous bar and one accumulator holds only one
inside-bar-range-mother-candle-breakoutbreak NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `breakoutOccurred` is read, before it is set, inside the update of another `var` that is itself read before it is set in this one's, so the two carry each other's previous bar and one accumulator holds only one
inside-bar-range-mother-candle-breakoutbreak AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `breakoutOccurred` is read, before it is set, inside the update of another `var` that is itself read before it is set in this one's, so the two carry each other's previous bar and one accumulator holds only one
inside-bar-range-mother-candle-breakoutbreak AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `breakoutOccurred` is read, before it is set, inside the update of another `var` that is itself read before it is set in this one's, so the two carry each other's previous bar and one accumulator holds only one
inside-bar-range-mother-candle-breakoutbreak AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `breakoutOccurred` is read, before it is set, inside the update of another `var` that is itself read before it is set in this one's, so the two carry each other's previous bar and one accumulator holds only one
institutional-smc-order-flow-matrix-pro-rddt NYSE:RDDT 1D     0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 92 paired slots; coordinates are NOT compared by v1
institutional-smc-order-flow-matrix-pro-spy- AMEX:SPY 1D      0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 1105 paired slots; coordinates are NOT compared by v1
ipda-standard-deviations-dexterlab-x-tfo-x-t NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
k-clustering-rddt-1d-2026-09-28              NYSE:RDDT 1D     0      INCONCLUSIVE      1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our lines, tables, tableCells are withheld by name (objects:not-computable: No line or fill between lines is shown on this chart: whether and where the script draws them depends on values this chart can't work out here, so none are drawn rather than a guess. Some table cells are not shown on this chart: 3 table cells depend on values this chart can’t work out here, so they are left out rather than guessed.); every other object family's counts and texts agree
k-clustering-spy-1d-2026-10-03               AMEX:SPY 1D      0      INCONCLUSIVE      1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our lines, tables, tableCells are withheld by name (objects:not-computable: No line or fill between lines is shown on this chart: whether and where the script draws them depends on values this chart can't work out here, so none are drawn rather than a guess. Some table cells are not shown on this chart: 3 table cells depend on values this chart can’t work out here, so they are left out rather than guessed.); every other object family's counts and texts agree
kalman-price-filter-backquant-rddt-1d-2026-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `f_kalman`)
kalman-psar-backquant-rddt-1d-2026-11-15     NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `result` is read, before it is set, inside the update of another `var` that is itself read before it is set in this one's, so the two carry each other's previous bar and one accumulator holds only one
keltner-center-of-gravity-channel-rddt-1d-20 NYSE:RDDT 1D     18     MATCH             all 19 items agree
    extra high line                          MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    outerhigh                                MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    innerhigh                                MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    coghigh                                  MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    coglow                                   MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    innerlow                                 MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    outerlow                                 MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    extra low line                           MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    Up Trend                                 MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    Down Trend                               MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    Support/Resistance Level                 MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    outhi                                    MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    inhi                                     MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    coghi                                    MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    cogl                                     MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    inlow                                    MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    outlow                                   MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    HMA                                      MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 8 paired slots; coordinates are NOT compared by v1
keltner-center-of-gravity-channel-spy-1d-202 AMEX:SPY 1D      18     MATCH             all 19 items agree
    extra high line                          MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    outerhigh                                MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    innerhigh                                MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    coghigh                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    coglow                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    innerlow                                 MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    outerlow                                 MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    extra low line                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Up Trend                                 MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Down Trend                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Support/Resistance Level                 MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    outhi                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    inhi                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    coghi                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    cogl                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    inlow                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    outlow                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    HMA                                      MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 8 paired slots; coordinates are NOT compared by v1
keltner-channels-bands-rddt-1d-2026-09-27    NYSE:RDDT D      7      MATCH             all 8 items agree
    Basis                                    MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 4.41e-16
    Upper 1                                  MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 4.13e-16
    Lower 1                                  MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 4.73e-16
    Upper 2                                  MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 3.90e-16
    Lower 2                                  MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 5.10e-16
    Upper 3                                  MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 3.92e-16
    Lower 3                                  MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 7.35e-16
    objects                                  MATCH         neither side draws an object
keltner-channels-bands-spy-1d-2026-10-03     AMEX:SPY 1D      7      MATCH             all 8 items agree
    Basis                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.09e-16
    Upper 1                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 5.95e-16
    Lower 1                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.25e-16
    Upper 2                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 5.81e-16
    Lower 2                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 7.86e-16
    Upper 3                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 5.70e-16
    Lower 3                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 7.95e-16
    objects                                  MATCH         neither side draws an object
kernel-channel-backquant-rddt-1d-2026-11-14  NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `kernelMu`)
lib-v5-in-v6-rddt-1d-2026-11-16              NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `BarefootJoey/AstroLib/1` is not in this engine's library registry, so its code cannot be compiled
linear-regression-channel-200-rddt-1d-2026-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:tuple): this Pine call answers with several values at once and a column carries one — `price1` — `calculateRegression` is a function this script defines and this engine could not read, so none of its values can be handed out — a Pine block spans several statements and this engine stores a single expression — `for` (reached through `calculateRegression`)
linear-regression-channel-tradingfinder-exis NYSE:RDDT 1D     0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 5 paired slots; coordinates are NOT compared by v1
linear-regression-channel-tradingfinder-exis AMEX:SPY 1D      0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 5 paired slots; coordinates are NOT compared by v1
liquidation-levels-rddt-1d-2026-09-28        NYSE:RDDT 1D     11     MATCH             all 12 items agree
    L1 Long                                  MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    L2 Long                                  MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    L3 Long                                  MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    L4 Long                                  MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    L5 Long                                  MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    L1 Short                                 MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    L2 Short                                 MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    L3 Short                                 MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    L4 Short                                 MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    L5 Short                                 MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    plot_20                                  MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 20 paired slots; coordinates are NOT compared by v1
liquidation-levels-spy-1d-2026-10-03         AMEX:SPY 1D      11     MATCH             all 12 items agree
    L1 Long                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L2 Long                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L3 Long                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L4 Long                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L5 Long                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L1 Short                                 MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L2 Short                                 MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L3 Short                                 MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L4 Short                                 MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    L5 Short                                 MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_20                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 20 paired slots; coordinates are NOT compared by v1
liquidity-engulfing-candles-upslidedown-rddt NYSE:RDDT 1D     3      MATCH             all 4 items agree
    Strategy Signal                          MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Shapes                                   MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Shapes                                   MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
liquidity-engulfing-candles-upslidedown-spy- AMEX:SPY 1D      3      MATCH             all 4 items agree
    Strategy Signal                          MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Shapes                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Shapes                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
liquidity-engulfing-displacement-msf-rddt-1d NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): `barstate.isnew` is a Pine built-in this engine holds no COLUMN for, though it holds its siblings: requires per-tick evaluation, and the captures pin every bar but the one that matters. RULING-0927 (2026-11-07): `isnew` reads 1 on the four closed bars of the tail of `tests/fixtures/vendor/barstate-full-spy-1d-closed-2026-09-10.json` and on the three timeline rows where the vendor had released the newest bar to history. On the NEWEST bar it equals the vendor's own `ishistory`, which is viewer- and time-dependent: 0 while the vendor still holds the bar realtime (six rows of `barstate-daily-timeline.json`, 16:17-20:55 ET) and 1 once it lets the bar go (three rows, 23:57-07:38 ET), while OUR clock answered "not forming" at all nine instants. Nothing this engine receives says which of the two the vendor would show, and the value on a realtime update of a forming bar was never captured, so any column would be a guess on the newest bar. Refused by name on every lane (the runtime lane's ledger producer `isNewByBar` stays unread). TO UNBLOCK: a capture that ties the vendor's release instant to something our calendar derives, plus a forming-bar reading.
liquidity-engulfing-displacement-msf-spy-1d- AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): `barstate.isnew` is a Pine built-in this engine holds no COLUMN for, though it holds its siblings: requires per-tick evaluation, and the captures pin every bar but the one that matters. RULING-0927 (2026-11-07): `isnew` reads 1 on the four closed bars of the tail of `tests/fixtures/vendor/barstate-full-spy-1d-closed-2026-09-10.json` and on the three timeline rows where the vendor had released the newest bar to history. On the NEWEST bar it equals the vendor's own `ishistory`, which is viewer- and time-dependent: 0 while the vendor still holds the bar realtime (six rows of `barstate-daily-timeline.json`, 16:17-20:55 ET) and 1 once it lets the bar go (three rows, 23:57-07:38 ET), while OUR clock answered "not forming" at all nine instants. Nothing this engine receives says which of the two the vendor would show, and the value on a realtime update of a forming bar was never captured, so any column would be a guess on the newest bar. Refused by name on every lane (the runtime lane's ledger producer `isNewByBar` stays unread). TO UNBLOCK: a capture that ties the vendor's release instant to something our calendar derives, plus a forming-bar reading.
liquidity-heatmap-nephew-sam-rddt-1d-2026-09 NYSE:RDDT 1D     0      INCONCLUSIVE      1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our labels are withheld by name (objects:not-carried: No label is shown on this chart: the script makes them in steps this chart can't follow yet, so none are drawn here, though TradingView may draw some.); every other object family's counts and texts agree
liquidity-heatmap-nephew-sam-spy-1d-2026-10- AMEX:SPY 1D      0      INCONCLUSIVE      1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our labels are withheld by name (objects:not-carried: No label is shown on this chart: the script makes them in steps this chart can't follow yet, so none are drawn here, though TradingView may draw some.); every other object family's counts and texts agree
liquidity-levels-sonarlab-rddt-1d-2026-11-14 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `remove_mitigated_lines`)
liquidity-levels-sonarlab-rddt-1d-2026-11-17 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `remove_mitigated_lines`)
liquidity-levels-sonarlab-spy-1d-2026-11-14  AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `remove_mitigated_lines`)
liquidity-levels-sonarlab-spy-1d-2026-11-17  AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `remove_mitigated_lines`)
liquidity-pools-rddt-1d-2026-09-28           NYSE:RDDT 1D     2      MATCH             all 3 items agree
    Swing High                               MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Swing Low                                MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 364 paired slots; coordinates are NOT compared by v1
liquidity-pools-spy-1d-2026-10-03            AMEX:SPY 1D      2      MATCH             all 3 items agree
    Swing High                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Swing Low                                MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 1512 paired slots; coordinates are NOT compared by v1
long_tail__09-signal-follow-through-ledger-r NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `resFav` — and the fold stopped before it, at line 284: a Pine block spans several statements and this engine stores a single expression — `for`
long_tail__09-signal-follow-through-ledger-s AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `resFav` — and the fold stopped before it, at line 284: a Pine block spans several statements and this engine stores a single expression — `for`
macd-shortlong-strategy-for-tradingview-inpu NYSE:RDDT 1D     6      MATCH             all 7 items agree
    Histogram Long                           MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 4.39e-12
    MACD Long                                MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 4.64e-12
    Signal Long                              MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.48e-12
    Histogram Short                          MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 6.84e-11
    MACD Short                               MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 6.86e-12
    Signal Short                             MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.34e-12
    objects                                  MATCH         neither side draws an object
macd-shortlong-strategy-for-tradingview-inpu AMEX:SPY 1D      6      MATCH             all 7 items agree
    Histogram Long                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 5.70e-10
    MACD Long                                MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.04e-10
    Signal Long                              MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 4.71e-11
    Histogram Short                          MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.31e-9
    MACD Short                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 7.77e-11
    Signal Short                             MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.03e-11
    objects                                  MATCH         neither side draws an object
macd-shortlong-strategy-is-rddt-1d-2026-11-1 NYSE:RDDT 1D     6      INCONCLUSIVE      all 7 items agree; strategy EXPECTED-REFUSAL at step 1: refused by harness:no-broker
    Histogram Long                           MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 6.09e-10
    MACD Long                                MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 4.64e-12
    Signal Long                              MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 2.48e-12
    Histogram Short                          MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 6.84e-11
    MACD Short                               MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 6.86e-12
    Signal Short                             MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 3.34e-12
    objects                                  MATCH         neither side draws an object
machine-learning-knn-based-strategy-rddt-1d- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `predictions` is filled by a block this engine could not read, so its slots are unknown rather than empty. Unrolling a bounded loop is item (a); a loop whose bound depends on a series is the IR lane's, item (c) — and the IR lane has no path for it yet, nor does any IR result reach a pane while ruling D2 stands.
machine-learning-logistic-regression-v3-rddt NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:offset-literal): a bar offset has to be a plain whole number written into the script — this one moves only with `barstate.*` (whether the bar is still forming), and a per-bar index was measured on closed bars only
machine-learning-logistic-regression-v3-spy- AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:offset-literal): a bar offset has to be a plain whole number written into the script — this one moves only with `barstate.*` (whether the bar is still forming), and a per-bar index was measured on closed bars only
machine-learning-lorentzian-classification-2 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `jdehorty/MLExtensions/2` is not in this engine's library registry, so its code cannot be compiled
machine-learning-lorentzian-classification-5 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `jdehorty/MLExtensions/2` is not in this engine's library registry, so its code cannot be compiled; strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
machine-learning-moving-average-backquant-rd NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `currentCluster` — a running total built inside a `for` is not folded into one expression on this lane — of 1,004 counted `for` loops in the reference corpus 379 do this, and only 1 of 379 has a seed, an update shape, an iteration count and a scope this engine can settle all at once (ruling R7). The binding constraint is the ITERATION COUNT: just 63 of 379 have a bound that folds before the chart runs
machine-learning-moving-average-backquant-rd NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `currentCluster` — a running total built inside a `for` is not folded into one expression on this lane — of 1,004 counted `for` loops in the reference corpus 379 do this, and only 1 of 379 has a seed, an update shape, an iteration count and a scope this engine can settle all at once (ruling R7). The binding constraint is the ITERATION COUNT: just 63 of 379 have a bound that folds before the chart runs
machine-learning-moving-average-backquant-sp AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `currentCluster` — a running total built inside a `for` is not folded into one expression on this lane — of 1,004 counted `for` loops in the reference corpus 379 do this, and only 1 of 379 has a seed, an update shape, an iteration count and a scope this engine can settle all at once (ruling R7). The binding constraint is the ITERATION COUNT: just 63 of 379 have a bound that folds before the chart runs
machine-learning-rsi-bullvision-rddt-1d-2026 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:tuple): this Pine call answers with several values at once and a column carries one — `knnRsi` — `knnEnhancedRsi` is a function this script defines and this engine could not read, so none of its values can be handed out — a Pine block spans several statements and this engine stores a single expression — `for` (reached through `knnEnhancedRsi`)
madrid-moving-average-ribbon-rddt-1d-2026-09 NYSE:RDDT 1D     18     MATCH             all 19 items agree
    MMA05                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 4.49e-16
    MMA10                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 6.29e-16
    MMA15                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 3.87e-16
    MMA20                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 4.41e-16
    MMA25                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.39e-15
    MMA30                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.57e-15
    MMA35                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.10e-15
    MMA40                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.47e-15
    MMA45                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.29e-15
    MMA50                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.26e-15
    MMA55                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 9.49e-16
    MMA60                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.99e-15
    MMA65                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.67e-15
    MMA70                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 2.14e-15
    MMA75                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.61e-15
    MMA80                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 7.06e-16
    MMA85                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 2.47e-15
    MMA90                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.97e-15
    objects                                  MATCH         neither side draws an object
madrid-moving-average-ribbon-spy-1d-2026-10- AMEX:SPY 1D      18     MATCH             all 19 items agree
    MMA05                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 4.44e-16
    MMA10                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.74e-16
    MMA15                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 5.59e-16
    MMA20                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.09e-16
    MMA25                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.35e-15
    MMA30                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.79e-15
    MMA35                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.14e-15
    MMA40                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.75e-15
    MMA45                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.22e-15
    MMA50                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.36e-15
    MMA55                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.39e-15
    MMA60                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.01e-15
    MMA65                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.77e-15
    MMA70                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.51e-15
    MMA75                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.19e-15
    MMA80                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.37e-15
    MMA85                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.78e-15
    MMA90                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 3.02e-15
    objects                                  MATCH         neither side draws an object
makuchaku039s-trade-tools-fair-value-gaps-rd NYSE:RDDT 1D     0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 102 paired slots; coordinates are NOT compared by v1
makuchaku039s-trade-tools-fair-value-gaps-sp AMEX:SPY 1D      0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 102 paired slots; coordinates are NOT compared by v1
market-sessions-and-volume-profile-by-leviat NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
market-sessions-and-volume-profile-by-leviat AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
market-structure-break-order-block-rddt-1d-2 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `low_points_arr` is written at line 69 by a statement this lane does not model (inside a block, a function, or a call), so its slots are not known before the chart runs
market-structure-by-leviathan-rddt-1d-2026-0 NYSE:RDDT 1D     0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 50 paired slots (16 theme-relative); coordinates are NOT compared by v1
market-structure-by-leviathan-spy-1d-2026-10 AMEX:SPY 1D      0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 853 paired slots (251 theme-relative); coordinates are NOT compared by v1
market-structure-inducements-ict-tradinfinde NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
market-structure-trend-targets-chartprime-rd NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:statement): this Pine line is not a shape the translator reads
mcclellan-indicators-rddt-1d-2026-09-28      NYSE:RDDT 1D     13     INCONCLUSIVE      1 of 15 items could not be compared
    Osc                                      INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (pine:request) — This indicator reads `ADVN`: other-symbol:bare — `"ADVN"` names no exchange, and those letters also name a market index or commodity outside our bar store, so which instrument TradingView resolves it to cannot be settled here; what this indicator draws from it is not computed. It is a market breadth series (advancing / declining issues or volume), and this breadth symbol is not available yet.
    MSI                                      MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MSI EMA                                  MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MSI Cross Up                             MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MSI Cross Down                           MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MSI RSI                                  MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    RSI Hook Down                            MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    RSI Hook Up                              MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MACD                                     MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MACD Signal Line                         MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MACD Histogram                           MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MACD Cross Up                            MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    MACD Cross Down                          MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         2 paints agree bar for bar
mcclellan-indicators-spy-1d-2026-10-03       AMEX:SPY 1D      13     INCONCLUSIVE      1 of 15 items could not be compared
    Osc                                      INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (pine:request) — This indicator reads `ADVN`: other-symbol:bare — `"ADVN"` names no exchange, and those letters also name a market index or commodity outside our bar store, so which instrument TradingView resolves it to cannot be settled here; what this indicator draws from it is not computed. It is a market breadth series (advancing / declining issues or volume), and this breadth symbol is not available yet.
    MSI                                      MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MSI EMA                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MSI Cross Up                             MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MSI Cross Down                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MSI RSI                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    RSI Hook Down                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    RSI Hook Up                              MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MACD                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MACD Signal Line                         MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MACD Histogram                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MACD Cross Up                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MACD Cross Down                          MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         2 paints agree bar for bar
mgi-levels-suite-rddt-1d-2026-11-15          NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
mgi-levels-suite-spy-1d-2026-11-15           AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
mid_engagement__20-mann-kendall-trend-signif NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `sCount` — a running total built inside a `for` is not folded into one expression on this lane — of 1,004 counted `for` loops in the reference corpus 379 do this, and only 1 of 379 has a seed, an update shape, an iteration count and a scope this engine can settle all at once (ruling R7). The binding constraint is the ITERATION COUNT: just 63 of 379 have a bound that folds before the chart runs
mid_engagement__20-mann-kendall-trend-signif AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `sCount` — a running total built inside a `for` is not folded into one expression on this lane — of 1,004 counted `for` loops in the reference corpus 379 do this, and only 1 of 379 has a seed, an update shape, an iteration count and a scope this engine can settle all at once (ruling R7). The binding constraint is the ITERATION COUNT: just 63 of 379 have a bound that folds before the chart runs
momentum-based-zigzag-rddt-1d-2026-11-14     NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:timeout): this Pine script did not finish translating inside the time budget — resolving `QQExlong` nested past 400 levels. That is a translator defect, not a limit on the script: this door expands a variable by re-reading its definition, and a definition that reaches its own previous bar can be re-entered without end. The deepest legitimate script measured needs 20 levels.
momentum-volatility-scanner-rddt-1d-2026-09- NYSE:RDDT 1D     11     MATCH             all 12 items agree
    Momentum Line                            MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Momentum Area                            MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Momentum Histogram                       MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 3.13e-13
    Vol Upper                                MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 7.16e-13
    Vol Lower                                MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 7.16e-13
    Bullish Shift                            MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bearish Shift                            MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Extreme Bull                             MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Extreme Bear                             MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bull Divergence                          MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Bear Divergence                          MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 25 paired slots; coordinates are NOT compared by v1
momentum-volatility-scanner-spy-1d-2026-10-0 AMEX:SPY 1D      11     MATCH             all 12 items agree
    Momentum Line                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Momentum Area                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Momentum Histogram                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.15e-12
    Vol Upper                                MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 7.80e-11
    Vol Lower                                MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 7.80e-11
    Bullish Shift                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bearish Shift                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Extreme Bull                             MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Extreme Bear                             MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bull Divergence                          MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Bear Divergence                          MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 25 paired slots; coordinates are NOT compared by v1
moving-averages-as-support-resistance-mtf-rd NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `min_higher` — a running total built inside a `for` is not folded into one expression on this lane — of 1,004 counted `for` loops in the reference corpus 379 do this, and only 1 of 379 has a seed, an update shape, an iteration count and a scope this engine can settle all at once (ruling R7). The binding constraint is the ITERATION COUNT: just 63 of 379 have a bound that folds before the chart runs
moving-averages-as-support-resistance-mtf-rd NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `min_higher` — a running total built inside a `for` is not folded into one expression on this lane — of 1,004 counted `for` loops in the reference corpus 379 do this, and only 1 of 379 has a seed, an update shape, an iteration count and a scope this engine can settle all at once (ruling R7). The binding constraint is the ITERATION COUNT: just 63 of 379 have a bound that folds before the chart runs
moving-averages-as-support-resistance-mtf-sp AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `min_higher` — a running total built inside a `for` is not folded into one expression on this lane — of 1,004 counted `for` loops in the reference corpus 379 do this, and only 1 of 379 has a seed, an update shape, an iteration count and a scope this engine can settle all at once (ruling R7). The binding constraint is the ITERATION COUNT: just 63 of 379 have a bound that folds before the chart runs
moving-averages-as-support-resistance-mtf-sp AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `min_higher` — a running total built inside a `for` is not folded into one expression on this lane — of 1,004 counted `for` loops in the reference corpus 379 do this, and only 1 of 379 has a seed, an update shape, an iteration count and a scope this engine can settle all at once (ruling R7). The binding constraint is the ITERATION COUNT: just 63 of 379 have a bound that folds before the chart runs
moving-averages-as-support-resistance-mtf-sp AMEX:SPY 60      0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `min_higher` — a running total built inside a `for` is not folded into one expression on this lane — of 1,004 counted `for` loops in the reference corpus 379 do this, and only 1 of 379 has a seed, an update shape, an iteration count and a scope this engine can settle all at once (ruling R7). The binding constraint is the ITERATION COUNT: just 63 of 379 have a bound that folds before the chart runs
mtf-dashboard-pro-rsi-fib-sr-volume-strixedg NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `r1`: lower-tf:store-unmeasured: `15` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`)
mtf-dashboard-pro-rsi-fib-sr-volume-strixedg AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `r1`: lower-tf:store-unmeasured: `15` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`)
mtf-key-levels-support-and-resistance-rddt-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (budget:series): this script is not drawn: its plot `W-VWAP` reads 10 different data series, and one plot may read at most 8 here
mtf-key-levels-support-and-resistance-spy-1d AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (budget:series): this script is not drawn: its plot `W-VWAP` reads 10 different data series, and one plot may read at most 8 here
mtf-watchlist-charts-anan-rddt-1d-2026-11-14 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
mtf-watchlist-charts-anan-spy-1d-2026-11-14  AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
mtf-watchlist-charts-anan-spy-60-2026-11-14  AMEX:SPY 60      0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
multi-timeframe-fvg-tfo-rddt-1d-2026-11-15   NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
multi-timeframe-fvg-tfo-spy-1d-2026-11-15    AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
multi-timeframe-rsi-buy-sell-strategy-traded AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `5` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `5` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.; strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
multi-timeframe-supply-demand-zones-rddt-1d- NYSE:RDDT 1D     0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; no colour slot was paired, so no colour was graded; 1008 slots on objects neither side draws not graded (16 of them hold a colour that differs); coordinates are NOT compared by v1
multi-timeframe-supply-demand-zones-spy-1d-2 AMEX:SPY 1D      0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; no colour slot was paired, so no colour was graded; 1008 slots on objects neither side draws not graded (12 of them hold a colour that differs); coordinates are NOT compared by v1
multi-timeframe-trend-indicator-rddt-1d-2026 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `5` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `5` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
multi-timeframe-trend-indicator-spy-1d-2026- AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `5` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `5` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
multicator-table-rddt-1d-2026-10-02          NYSE:RDDT 1D     28     DIVERGE           1 of 29 compared items diverge
    EMA1                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    EMA2                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    EMA3                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    SMA1                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    SMA2                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    SMA3                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    ParabolicSAR                             MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Basis                                    MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Upper                                    MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Lower                                    MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Conversion Line                          MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Base Line                                MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Lagging Span                             MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Leading Span A                           MATCH             cmp 611 ok 611 warm 0/0 steady 0/611 maxRel 0.00e+0
    Leading Span B                           MATCH             cmp 611 ok 611 warm 0/0 steady 0/611 maxRel 0.00e+0
    Kumo Cloud Upper Line                    MATCH             cmp 611 ok 611 warm 0/0 steady 0/611 maxRel 0.00e+0
    Kumo Cloud Lower Line                    MATCH             cmp 611 ok 611 warm 0/0 steady 0/611 maxRel 0.00e+0
    VWAP                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Supertrend                               MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Donchian High                            MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Donchian Low                             MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Keltner Upper                            MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Keltner Lower                            MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Keltner Basis                            MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    RSI bull div                             MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    RSI bear div                             MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    MACD bull div                            MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    MACD bear div                            MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 72 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (coll:diverged, coll:push)
multicator-table-spy-1d-2026-10-02           AMEX:SPY 1D      28     DIVERGE           1 of 29 compared items diverge
    EMA1                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    EMA2                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    EMA3                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    SMA1                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    SMA2                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    SMA3                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    ParabolicSAR                             MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Basis                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Upper                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Lower                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Conversion Line                          MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Base Line                                MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Lagging Span                             MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Leading Span A                           MATCH             cmp 1775 ok 1775 warm 0/0 steady 0/1775 maxRel 0.00e+0
    Leading Span B                           MATCH             cmp 1775 ok 1775 warm 0/0 steady 0/1775 maxRel 0.00e+0
    Kumo Cloud Upper Line                    MATCH             cmp 1775 ok 1775 warm 0/0 steady 0/1775 maxRel 0.00e+0
    Kumo Cloud Lower Line                    MATCH             cmp 1775 ok 1775 warm 0/0 steady 0/1775 maxRel 0.00e+0
    VWAP                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Supertrend                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Donchian High                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Donchian Low                             MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Keltner Upper                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Keltner Lower                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Keltner Basis                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    RSI bull div                             MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    RSI bear div                             MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MACD bull div                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    MACD bear div                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 72 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (coll:diverged, coll:push)
nadaraya-watson-rational-quadratic-kernel-no NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `kernel_regression`)
nadaraya-watson-rational-quadratic-kernel-no NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `kernel_regression`)
nadaraya-watson-rational-quadratic-kernel-no AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `kernel_regression`)
neural-network-buy-and-sell-signals-rddt-1d- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `buy_signal_shortStop[1]` reads what `buy_signal_shortStop` held on an earlier bar, and this script reassigns it
nonlinear-regression-zero-lag-moving-average NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `nonLinearRegression`)
nubia-auto-midas-anchored-vwap-xdecow-rddt-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `getVwap`)
nubia-auto-midas-anchored-vwap-xdecow-rddt-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `getVwap`)
nubia-auto-midas-anchored-vwap-xdecow-spy-1d AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `getVwap`)
one-sided-gaussian-support-resistance-rate-l NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `_smthMA`)
one-sided-gaussian-support-resistance-rate-l NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `_smthMA`)
one-sided-gaussian-support-resistance-rate-l AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `_smthMA`)
open-interest-suite-aggregated-by-leviathan- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `oic1`
open-interest-suite-aggregated-by-leviathan- AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `oic1`
opening-range-initial-balance-opening-price- NYSE:RDDT 1D     14     INCONCLUSIVE      11 of 15 items could not be compared
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    OR Low                                   INCONCLUSIVE       — UNMAPPED — vendor title "OR Low" is not unique in the study
    OR Low                                   INCONCLUSIVE       — UNMAPPED — vendor title "OR Low" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    IB Low                                   INCONCLUSIVE       — UNMAPPED — vendor title "IB Low" is not unique in the study
    IB Low                                   INCONCLUSIVE       — UNMAPPED — vendor title "IB Low" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Opening price                            MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    OR High                                  MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    IB High                                  MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
opening-range-initial-balance-opening-price- NYSE:RDDT 1D     14     INCONCLUSIVE      11 of 15 items could not be compared
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    OR Low                                   INCONCLUSIVE       — UNMAPPED — vendor title "OR Low" is not unique in the study
    OR Low                                   INCONCLUSIVE       — UNMAPPED — vendor title "OR Low" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    IB Low                                   INCONCLUSIVE       — UNMAPPED — vendor title "IB Low" is not unique in the study
    IB Low                                   INCONCLUSIVE       — UNMAPPED — vendor title "IB Low" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Opening price                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    OR High                                  MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    IB High                                  MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
opening-range-initial-balance-opening-price- AMEX:SPY 1D      14     INCONCLUSIVE      11 of 15 items could not be compared
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    OR Low                                   INCONCLUSIVE       — UNMAPPED — vendor title "OR Low" is not unique in the study
    OR Low                                   INCONCLUSIVE       — UNMAPPED — vendor title "OR Low" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    IB Low                                   INCONCLUSIVE       — UNMAPPED — vendor title "IB Low" is not unique in the study
    IB Low                                   INCONCLUSIVE       — UNMAPPED — vendor title "IB Low" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Opening price                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    OR High                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    IB High                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
opening-range-initial-balance-opening-price- AMEX:SPY 1D      14     INCONCLUSIVE      11 of 15 items could not be compared
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    OR Low                                   INCONCLUSIVE       — UNMAPPED — vendor title "OR Low" is not unique in the study
    OR Low                                   INCONCLUSIVE       — UNMAPPED — vendor title "OR Low" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    IB Low                                   INCONCLUSIVE       — UNMAPPED — vendor title "IB Low" is not unique in the study
    IB Low                                   INCONCLUSIVE       — UNMAPPED — vendor title "IB Low" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Shapes                                   INCONCLUSIVE       — UNMAPPED — vendor title "Shapes" is not unique in the study
    Opening price                            MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    OR High                                  MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    IB High                                  MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
optimized-keltner-channels-sltp-strategy-for NYSE:RDDT 1D     5      MATCH             all 6 items agree
    Upper                                    MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 5.65e-16
    Basis                                    MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 6.00e-16
    Lower                                    MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 7.64e-16
    Plot                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Plot                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
optimized-keltner-channels-sltp-strategy-for AMEX:SPY 1D      5      MATCH             all 6 items agree
    Upper                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.78e-16
    Basis                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.86e-16
    Lower                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.94e-16
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
options-max-pain-calculator-backquant-rddt-1 NYSE:RDDT 1D     0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 87 paired slots; coordinates are NOT compared by v1
options-max-pain-calculator-backquant-spy-1d AMEX:SPY 1D      0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 115 paired slots; coordinates are NOT compared by v1
order-blocks-rddt-1d-2026-11-14              NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
pa-zigzag-fibonacci-fan-altm-rddt-1d-2026-11 NYSE:RDDT 1D     0      INCONCLUSIVE      the vendor study ran with non-default inputs (Alt Timeframe="1M" vs default "1D"); v1 compares at default inputs only — re-capture at defaults
pa-zigzag-fibonacci-fan-altm-spy-1d-2026-11- AMEX:SPY 1D      0      INCONCLUSIVE      the vendor study ran with non-default inputs (Alt Timeframe="1M" vs default "1D"); v1 compares at default inputs only — re-capture at defaults
pa-zigzag-fibonacci-fan-altw-rddt-1d-2026-11 NYSE:RDDT 1D     0      INCONCLUSIVE      the vendor study ran with non-default inputs (Alt Timeframe="1W" vs default "1D"); v1 compares at default inputs only — re-capture at defaults
pa-zigzag-fibonacci-fan-altw-spy-1d-2026-11- AMEX:SPY 1D      0      INCONCLUSIVE      the vendor study ran with non-default inputs (Alt Timeframe="1W" vs default "1D"); v1 compares at default inputs only — re-capture at defaults
pa-zigzag-fibonacci-fan-rddt-1d-2026-10-02   NYSE:RDDT 1D     9      MATCH             all 10 items agree
    zigzag                                   MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
     0.000                                   MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    -0.236                                   MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    -0.382                                   MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    -0.500                                   MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    -0.618                                   MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    -1.000                                   MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    -1.618                                   MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    -3.141                                   MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
pa-zigzag-fibonacci-fan-spy-1d-2026-10-03    AMEX:SPY 1D      9      MATCH             all 10 items agree
    zigzag                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
     0.000                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    -0.236                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    -0.382                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    -0.500                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    -0.618                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    -1.000                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    -1.618                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    -3.141                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
parabolic-sar-rddt-1d-2026-10-03             NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:timeout): this Pine script did not finish translating inside the time budget — resolving `nextsar` nested past 400 levels. That is a translator defect, not a limit on the script: this door expands a variable by re-reading its definition, and a definition that reaches its own previous bar can be re-entered without end. The deepest legitimate script measured needs 20 levels.
parabolic-sar-rddt-1d-2026-11-15             NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:timeout): this Pine script did not finish translating inside the time budget — resolving `nextsar` nested past 400 levels. That is a translator defect, not a limit on the script: this door expands a variable by re-reading its definition, and a definition that reaches its own previous bar can be re-entered without end. The deepest legitimate script measured needs 20 levels.
parabolic-sar-spy-1d-2026-11-15              AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:timeout): this Pine script did not finish translating inside the time budget — resolving `nextsar` nested past 400 levels. That is a translator defect, not a limit on the script: this door expands a variable by re-reading its definition, and a definition that reaches its own previous bar can be re-entered without end. The deepest legitimate script measured needs 20 levels.
pivot-high-low-points-rddt-1d-2026-11-14     NYSE:RDDT 1D     2      MATCH             all 3 items agree
    Shapes                                   MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Shapes                                   MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
pivot-point-supertrend-rddt-1d-2026-09-27    NYSE:RDDT D      8      MATCH             all 9 items agree
    PP SuperTrend                            MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 1.86e-16
    Buy                                      MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Sell                                     MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Shapes                                   MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Shapes                                   MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Plot                                     MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Plot                                     MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Plot                                     MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
pivot-point-supertrend-spy-1d-2026-10-03     AMEX:SPY 1D      8      MATCH             all 9 items agree
    PP SuperTrend                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Buy                                      MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Sell                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Shapes                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Shapes                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
pivot-trendlines-with-breaks-hg-rddt-1d-2026 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `HoanGhetti/SimpleTrendlines/4` is not in this engine's library registry, so its code cannot be compiled
pmax-explorer-rddt-1d-2026-10-02             NYSE:RDDT 1D     7      DIVERGE           1 of 8 compared items diverge
    Buy                                      INCONCLUSIVE       — UNMAPPED — vendor title "Buy" is not unique in the study
    Sell                                     INCONCLUSIVE       — UNMAPPED — vendor title "Sell" is not unique in the study
    Buy                                      INCONCLUSIVE       — UNMAPPED — vendor title "Buy" is not unique in the study
    Sell                                     INCONCLUSIVE       — UNMAPPED — vendor title "Sell" is not unique in the study
    plot_12                                  INCONCLUSIVE       — UNMAPPED — title "" could not be paired unambiguously
    Moving Avg Line                          MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 6.81e-16
    PMax                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 8.62e-16
    objects                                  DIVERGE       TradingView holds 1 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 2 drawing steps (dropped: create:label ×1; pine:request)
pmax-explorer-spy-1d-2026-10-02              AMEX:SPY 1D      7      DIVERGE           1 of 8 compared items diverge
    Buy                                      INCONCLUSIVE       — UNMAPPED — vendor title "Buy" is not unique in the study
    Sell                                     INCONCLUSIVE       — UNMAPPED — vendor title "Sell" is not unique in the study
    Buy                                      INCONCLUSIVE       — UNMAPPED — vendor title "Buy" is not unique in the study
    Sell                                     INCONCLUSIVE       — UNMAPPED — vendor title "Sell" is not unique in the study
    plot_12                                  INCONCLUSIVE       — UNMAPPED — title "" could not be paired unambiguously
    Moving Avg Line                          MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 7.05e-16
    PMax                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 7.29e-16
    objects                                  DIVERGE       TradingView holds 1 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 2 drawing steps (dropped: create:label ×1; pine:request)
poor-man039s-volume-profile-rddt-1d-2026-09- NYSE:RDDT 1D     0      INCONCLUSIVE      1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our labels are withheld by name (objects:not-computable: No label is shown on this chart: whether and where the script draws them depends on values this chart can't work out here, so none are drawn rather than a guess.); every other object family's counts and texts agree
poor-man039s-volume-profile-rddt-1d-2026-11- NYSE:RDDT 1D     0      INCONCLUSIVE      1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our labels are withheld by name (objects:not-computable: No label is shown on this chart: whether and where the script draws them depends on values this chart can't work out here, so none are drawn rather than a guess.); every other object family's counts and texts agree
poor-man039s-volume-profile-spy-1d-2026-10-0 AMEX:SPY 1D      0      INCONCLUSIVE      1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our labels are withheld by name (objects:not-computable: No label is shown on this chart: whether and where the script draws them depends on values this chart can't work out here, so none are drawn rather than a guess.); every other object family's counts and texts agree
poor-man039s-volume-profile-spy-1d-2026-11-1 AMEX:SPY 1D      0      INCONCLUSIVE      1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our labels are withheld by name (objects:not-computable: No label is shown on this chart: whether and where the script draws them depends on values this chart can't work out here, so none are drawn rather than a guess.); every other object family's counts and texts agree
position-size-calc-rddt-1d-2026-09-28        NYSE:RDDT 1D     0      DIVERGE           1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 21 paired slots; coordinates are NOT compared by v1
position-size-calc-spy-1d-2026-10-03         AMEX:SPY 1D      0      DIVERGE           1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 21 paired slots; coordinates are NOT compared by v1
position-size-calculator-rddt-1d-2026-09-28  NYSE:RDDT 1D     3      MATCH             all 4 items agree
    Entry                                    MATCH             cmp 612 ok 612 warm 0/0 steady 0/612 maxRel 0.00e+0
    TP                                       MATCH             cmp 612 ok 612 warm 0/0 steady 0/612 maxRel 0.00e+0
    SL                                       MATCH             cmp 612 ok 612 warm 0/0 steady 0/612 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 8 paired slots; coordinates are NOT compared by v1
position-size-calculator-spy-1d-2026-10-03   AMEX:SPY 1D      3      MATCH             all 4 items agree
    Entry                                    MATCH             cmp 1780 ok 1780 warm 0/0 steady 0/1780 maxRel 0.00e+0
    TP                                       MATCH             cmp 1780 ok 1780 warm 0/0 steady 0/1780 maxRel 0.00e+0
    SL                                       MATCH             cmp 1780 ok 1780 warm 0/0 steady 0/1780 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 8 paired slots; coordinates are NOT compared by v1
previous-day-high-and-low-separators-dailywe NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
previous-n-daysweeksmonths-high-low-rddt-1d- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `security`
previous-n-daysweeksmonths-high-low-spy-1d-2 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `security`
price-action-as-in-book-fibonacci-supportres NYSE:RDDT 1D     2      MATCH             all 3 items agree
    Pivot High                               MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Pivot Low                                MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 212 paired slots; coordinates are NOT compared by v1
price-action-as-in-book-fibonacci-supportres AMEX:SPY 1D      2      MATCH             all 3 items agree
    Pivot High                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Pivot Low                                MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 516 paired slots; coordinates are NOT compared by v1
pro-trading-art-double-top-bottom-with-alert NYSE:RDDT 1D     0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 35 paired slots; coordinates are NOT compared by v1
pro-trading-art-double-top-bottom-with-alert AMEX:SPY 1D      0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 510 paired slots; coordinates are NOT compared by v1
probe-default-colour-v3-rddt-1d-2026-09-27   NYSE:RDDT D      3      MATCH             all 4 items agree
    Plot                                     MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Shapes                                   MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Chars                                    MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
probe-default-colour-v4-rddt-1d-2026-09-27   NYSE:RDDT D      3      MATCH             all 4 items agree
    Plot                                     MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Shapes                                   MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Chars                                    MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
probe-default-colour-v6-rddt-1d-2026-09-27   NYSE:RDDT D      3      MATCH             all 4 items agree
    Plot                                     MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Shapes                                   MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Chars                                    MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
probe-sparse-rows-rddt-1d-2026-09-27         NYSE:RDDT D      1      MATCH             all 2 items agree
    odd                                      MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
qqe-signals-rddt-1d-2026-09-27               NYSE:RDDT D      2      MATCH             all 3 items agree
    QQE long                                 MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 1.37e-14
    QQE short                                MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 4.91e-15
    objects                                  MATCH         neither side draws an object
qqe-signals-spy-1d-2026-10-03                AMEX:SPY 1D      2      MATCH             all 3 items agree
    QQE long                                 MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.09e-13
    QQE short                                MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.54e-13
    objects                                  MATCH         neither side draws an object
r1-strategy-draws-indicator-rddt-1d-2026-10- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `crosses` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total. THIS ENGINE DOES DECLARE A BOUNDED FORM: `cumFrom(<that value>, <anchor>, <bars>)` — the same running total with the starting instant STATED. Stating the window is what makes the answer the same tomorrow — an all-time value moves with however many bars were fetched.
r1-strategy-draws-rddt-1d-2026-10-02         NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `crosses` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total. THIS ENGINE DOES DECLARE A BOUNDED FORM: `cumFrom(<that value>, <anchor>, <bars>)` — the same running total with the starting instant STATED. Stating the window is what makes the answer the same tomorrow — an all-time value moves with however many bars were fetched.
rate-of-change-rddt-1d-2026-11-15            NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `ClassicScott/MyMovingAveragesLibrary/4` is not in this engine's library registry, so its code cannot be compiled
rate-of-change-spy-1d-2026-11-15             AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `ClassicScott/MyMovingAveragesLibrary/4` is not in this engine's library registry, so its code cannot be compiled
relative-volume-at-time-rddt-1d-2026-11-14   NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:text-value): this script uses a text feature our chart does not render yet. The numeric plots still run; the text output is skipped and named here
relative-volume-at-time-spy-1d-2026-11-14    AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:text-value): this script uses a text feature our chart does not render yet. The numeric plots still run; the text output is skipped and named here
relative-volume-rddt-1d-2026-11-14           NYSE:RDDT 1D     10     MATCH             all 11 items agree
    Volume                                   MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Entry Signal                             MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Hull MA                                  MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    ALMA                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 4.74e-16
    Std Deviation                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 2.76e-15
    SMA                                      MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    LSMA                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 1.08e-15
    Trend Columns                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Volume Alert                             MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Anomalies                                MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 4 paired slots; coordinates are NOT compared by v1
renderingnature-smc-reversal-engine-v71-rddt NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:text-value): this script uses a text feature our chart does not render yet. The numeric plots still run; the text output is skipped and named here
renderingnature-smc-reversal-engine-v71-spy- AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:text-value): this script uses a text feature our chart does not render yet. The numeric plots still run; the text output is skipped and named here
renderingnature-smc-reversal-engine-v71-spy- AMEX:SPY 60      0      INCONCLUSIVE      refused on our side: member door refused (pine:text-value): this script uses a text feature our chart does not render yet. The numeric plots still run; the text output is skipped and named here
renko-candles-overlay-crwv-1d-2026-11-16     NASDAQ:CRWV 1D   0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `rclose` is written at line 47 by a statement this lane does not model (inside a block, a function, or a call), so its slots are not known before the chart runs
renko-candles-overlay-rddt-1d-2026-10-03     NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `rclose` is written at line 47 by a statement this lane does not model (inside a block, a function, or a call), so its slots are not known before the chart runs
renko-candles-overlay-spy-1d-2026-10-03      AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `rclose` is written at line 47 by a statement this lane does not model (inside a block, a function, or a call), so its slots are not known before the chart runs
request-realtime-alignment-spy-5-2026-10-01  AMEX:SPY 5       8      INCONCLUSIVE      5 of 9 items could not be compared
    R1_close_D_lookahead_ON                  INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (request:other-timeframe) — nothing is drawn for it
    R2_close_D_lookahead_OFF                 INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (request:other-timeframe) — nothing is drawn for it
    R3_DELTA_on_minus_off                    INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (request:other-timeframe) — nothing is drawn for it
    R4_isrealtime                            MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    R5_islast                                MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    R6_chart_close                           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    R7_prev_D_close_OFF                      INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (request:other-timeframe) — nothing is drawn for it
    R8_bar_index_CONTROL                     INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    objects                                  MATCH         neither side draws an object
request-realtime-alignment-spy-5-b-2026-10-0 AMEX:SPY 5       8      DIVERGE           R4_isrealtime: bar 299 t=1790884200 value vendor=1 ours=0
    R1_close_D_lookahead_ON                  INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (request:other-timeframe) — nothing is drawn for it
    R2_close_D_lookahead_OFF                 INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (request:other-timeframe) — nothing is drawn for it
    R3_DELTA_on_minus_off                    INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (request:other-timeframe) — nothing is drawn for it
    R4_isrealtime                            DIVERGE           cmp 301 ok 300 warm 0/0 steady 1/301 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 299 (value: vendor 1 vs ours 0) — scattered, last at bar 299
    R5_islast                                DIVERGE           cmp 301 ok 300 warm 0/0 steady 1/301 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 299 (value: vendor 1 vs ours 0) — scattered, last at bar 299
    R6_chart_close                           MATCH             cmp 301 ok 301 warm 0/0 steady 0/301 maxRel 0.00e+0
    R7_prev_D_close_OFF                      INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (request:other-timeframe) — nothing is drawn for it
    R8_bar_index_CONTROL                     INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    objects                                  MATCH         neither side draws an object
reverse-stochastic-momentum-index-on-chart-r NYSE:RDDT 1D     7      MATCH             all 8 items agree
    Scale High                               MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.47e-15
    High Alert                               MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.03e-14
    Low Alert                                MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 8.93e-14
    Scale Low                                MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    SMI EQ Price                             MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.75e-15
    Signal Line Cross                        MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 5.36e-15
    Zero Line Cross                          MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.46e-13
    objects                                  MATCH         object counts and texts agree; colours agree on 2 paired slots; coordinates are NOT compared by v1
reverse-stochastic-momentum-index-on-chart-s AMEX:SPY 1D      7      MATCH             all 8 items agree
    Scale High                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 8.04e-16
    High Alert                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 8.86e-16
    Low Alert                                MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.85e-13
    Scale Low                                MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.66e-13
    SMI EQ Price                             MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.00e-15
    Signal Line Cross                        MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.00e-15
    Zero Line Cross                          MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.48e-15
    objects                                  MATCH         object counts and texts agree; colours agree on 2 paired slots; coordinates are NOT compared by v1
rolling-vwap-rddt-1d-2026-10-03              NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `PineCoders/ConditionalAverages/2` is not in this engine's library registry, so its code cannot be compiled
rolling-vwap-spy-1d-2026-10-03               AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `PineCoders/ConditionalAverages/2` is not in this engine's library registry, so its code cannot be compiled
rolling-vwap-spy-5-2026-11-16                AMEX:SPY 5       0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `PineCoders/ConditionalAverages/2` is not in this engine's library registry, so its code cannot be compiled
rs-arm-label-last-bar-rddt-1d-2026-11-15     NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:drawing): a drawing object paints on a chart and answers with no number — `label.new`
rs-arm-label-last-bar-spy-1d-2026-11-15      AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:drawing): a drawing object paints on a chart and answers with no number — `label.new`
rs-rating-fred6724-alab-1d-2026-11-15        NASDAQ:ALAB 1D   4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-rating-fred6724-alab-1d-2026-11-16        NASDAQ:ALAB 1D   4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-rating-fred6724-crwv-1d-2026-11-15        NASDAQ:CRWV 1D   4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  MATCH_SUBSTITUTED cmp 411 ok 411 warm 0/0 steady 0/411 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 411 ok 411 warm 0/0 steady 0/411 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 411 ok 411 warm 0/0 steady 0/411 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 411 ok 411 warm 0/0 steady 0/411 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-rating-fred6724-crwv-1d-2026-11-16        NASDAQ:CRWV 1D   4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  MATCH_SUBSTITUTED cmp 411 ok 411 warm 0/0 steady 0/411 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 411 ok 411 warm 0/0 steady 0/411 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 411 ok 411 warm 0/0 steady 0/411 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 411 ok 411 warm 0/0 steady 0/411 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-rating-fred6724-m-nvda-1m-2026-11-18      NASDAQ:NVDA 1M   4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  MATCH_SUBSTITUTED cmp 335 ok 265 warm 0/0 steady 70/335 maxRel 5.66e-3
    Plot                                     MATCH_SUBSTITUTED cmp 335 ok 335 warm 0/21 steady 0/314 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 335 ok 335 warm 0/21 steady 0/314 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 335 ok 335 warm 0/50 steady 0/285 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-rating-fred6724-m-rddt-1m-2026-11-18      NYSE:RDDT 1M     4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  MATCH_SUBSTITUTED cmp 33 ok 33 warm 0/0 steady 0/33 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 33 ok 33 warm 0/21 steady 0/12 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 33 ok 33 warm 0/21 steady 0/12 maxRel 0.00e+0
    Plot                                     INCONCLUSIVE      cmp 33 ok 33 warm 0/33 steady 0/0 maxRel 0.00e+0 — every compared bar is inside the warm-up region — nothing in steady state to judge
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-rating-fred6724-nvda-1d-2026-11-15        NASDAQ:NVDA 1D   4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  MATCH_SUBSTITUTED cmp 6997 ok 5705 warm 0/0 steady 1292/6997 maxRel 1.83e-2
    Plot                                     MATCH_SUBSTITUTED cmp 6997 ok 6997 warm 0/0 steady 0/6997 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 6997 ok 6997 warm 0/0 steady 0/6997 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 6997 ok 6997 warm 0/0 steady 0/6997 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-rating-fred6724-pc-agl-1d-2026-11-17      NYSE:AGL 1D      4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (other-symbol:no-bars)
    Plot                                     INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out2 (other-symbol:no-bars)
    Plot                                     INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out3 (other-symbol:no-bars)
    Plot                                     INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out4 (other-symbol:no-bars)
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-rating-fred6724-pc-nvda-1d-2026-11-17     NASDAQ:NVDA 1D   4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (other-symbol:no-bars)
    Plot                                     INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out2 (other-symbol:no-bars)
    Plot                                     INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out3 (other-symbol:no-bars)
    Plot                                     INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out4 (other-symbol:no-bars)
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-rating-fred6724-pc-rddt-1d-2026-11-17     NYSE:RDDT 1D     4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (other-symbol:no-bars)
    Plot                                     INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out2 (other-symbol:no-bars)
    Plot                                     INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out3 (other-symbol:no-bars)
    Plot                                     INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out4 (other-symbol:no-bars)
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-rating-fred6724-pm-alab-1d-2026-11-16     NASDAQ:ALAB 1D   4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-rating-fred6724-pm-rddt-1d-2026-11-16     NYSE:RDDT 1D     4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-rating-fred6724-rddt-1d-2026-11-15        NYSE:RDDT 1D     4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  MATCH_SUBSTITUTED cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-rating-fred6724-rddt-1d-2026-11-16        NYSE:RDDT 1D     4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  MATCH_SUBSTITUTED cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-rating-fred6724-seta-alab-1d-2026-11-16   NASDAQ:ALAB 1D   0      INCONCLUSIVE      the vendor study ran with non-default inputs (Rating Only=true vs default false, Offset (%)=60 vs default 80, Type="Historical RS New Highs" vs default "RS New Highs", Look-back=100 vs default 250, Size="Small" vs default "Tiny", Plot RS New Lows=true vs default false, Type="RS New Lows" vs default "Historical RS New Lows", Look-back=120 vs default 250, Size="Normal" vs default "Tiny", Display MA 1 on RS Line=true vs default false, Lenght Da=30 vs default 21, Type Da="SMA" vs default "EMA", Display MA 2 on RS Line=true vs default false, Use fix values for replay mode=true vs default false, For 99 stocks=190 vs default 195.93, For 90+ stocks=110 vs default 117.11, For 70+ stocks=95.5 vs default 99.04, For 50+ stocks=88 vs default 91.66, For 30+ stocks=75 vs default 80.96, For 10+ stocks=50 vs default 53.64, For 1- stocks=20 vs default 24.86); v1 compares at default inputs only — re-capture at defaults
rs-rating-fred6724-seta-rddt-1d-2026-11-16   NYSE:RDDT 1D     0      INCONCLUSIVE      the vendor study ran with non-default inputs (Rating Only=true vs default false, Offset (%)=60 vs default 80, Type="Historical RS New Highs" vs default "RS New Highs", Look-back=100 vs default 250, Size="Small" vs default "Tiny", Plot RS New Lows=true vs default false, Type="RS New Lows" vs default "Historical RS New Lows", Look-back=120 vs default 250, Size="Normal" vs default "Tiny", Display MA 1 on RS Line=true vs default false, Lenght Da=30 vs default 21, Type Da="SMA" vs default "EMA", Display MA 2 on RS Line=true vs default false, Use fix values for replay mode=true vs default false, For 99 stocks=190 vs default 195.93, For 90+ stocks=110 vs default 117.11, For 70+ stocks=95.5 vs default 99.04, For 50+ stocks=88 vs default 91.66, For 30+ stocks=75 vs default 80.96, For 10+ stocks=50 vs default 53.64, For 1- stocks=20 vs default 24.86); v1 compares at default inputs only — re-capture at defaults
rs-rating-fred6724-setb-alab-1d-2026-11-16   NASDAQ:ALAB 1D   0      INCONCLUSIVE      the vendor study ran with non-default inputs (Hide Rating=true vs default false, Approximate Value of Comparative Symbol=5000 vs default 4200, Plot RS New Highs=false vs default true, Plot RS New Lows=true vs default false, Type="Historical RS New Lows  Before Price" vs default "Historical RS New Lows", Look-back=200 vs default 250, Size="Large" vs default "Tiny", Display MA 1 on RS Line=true vs default false, Area Color=true vs default false, Lenght Da=40 vs default 50); v1 compares at default inputs only — re-capture at defaults
rs-rating-fred6724-setb-rddt-1d-2026-11-16   NYSE:RDDT 1D     0      INCONCLUSIVE      the vendor study ran with non-default inputs (Hide Rating=true vs default false, Approximate Value of Comparative Symbol=5000 vs default 4200, Plot RS New Highs=false vs default true, Plot RS New Lows=true vs default false, Type="Historical RS New Lows  Before Price" vs default "Historical RS New Lows", Look-back=200 vs default 250, Size="Large" vs default "Tiny", Display MA 1 on RS Line=true vs default false, Area Color=true vs default false, Lenght Da=40 vs default 50); v1 compares at default inputs only — re-capture at defaults
rs-rating-fred6724-setc-alab-1d-2026-11-16   NASDAQ:ALAB 1D   0      INCONCLUSIVE      the vendor study ran with non-default inputs (Color="rgba(255,0,0,1)" vs default "rgba(0,0,255,1)", Display MA 1 on RS Line=true vs default false, Color="#00BCD4" vs default "#FF9800"); v1 compares at default inputs only — re-capture at defaults
rs-rating-fred6724-setc-rddt-1d-2026-11-16   NYSE:RDDT 1D     0      INCONCLUSIVE      the vendor study ran with non-default inputs (Color="rgba(255,0,0,1)" vs default "rgba(0,0,255,1)", Display MA 1 on RS Line=true vs default false, Color="#00BCD4" vs default "#FF9800"); v1 compares at default inputs only — re-capture at defaults
rs-rating-fred6724-setd-alab-1d-2026-11-16   NASDAQ:ALAB 1D   4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  MATCH_SUBSTITUTED cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-rating-fred6724-setd-rddt-1d-2026-11-16   NYSE:RDDT 1D     4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-rating-fred6724-sete2-alab-1d-2026-11-16  NASDAQ:ALAB 1D   0      INCONCLUSIVE      the vendor study ran with non-default inputs (Type="Historical RS New Highs" vs default "RS New Highs", Color="rgba(255,152,0,0.5)" vs default "rgba(121,213,242,0.38)", Plot RS New Lows=true vs default false, Color="rgba(156,39,176,0.6)" vs default "rgba(255,82,82,0.38)"); v1 compares at default inputs only — re-capture at defaults
rs-rating-fred6724-sete2-rddt-1d-2026-11-16  NYSE:RDDT 1D     0      INCONCLUSIVE      the vendor study ran with non-default inputs (Type="Historical RS New Highs" vs default "RS New Highs", Color="rgba(255,152,0,0.5)" vs default "rgba(121,213,242,0.38)", Plot RS New Lows=true vs default false, Color="rgba(156,39,176,0.6)" vs default "rgba(255,82,82,0.38)"); v1 compares at default inputs only — re-capture at defaults
rs-rating-fred6724-setf-alab-1d-2026-11-16   NASDAQ:ALAB 1D   4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  MATCH_SUBSTITUTED cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 1.09e-15
    Plot                                     MATCH_SUBSTITUTED cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 1.09e-15
    Plot                                     MATCH_SUBSTITUTED cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-rating-fred6724-setf-rddt-1d-2026-11-16   NYSE:RDDT 1D     4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 7.75e-16
    Plot                                     MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 7.75e-16
    Plot                                     MATCH_SUBSTITUTED cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-rating-fred6724-spy-1d-2026-11-15         AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: the supply this grade needs is not recorded — other symbol SPX: not graded, by owner ruling 2026-11-15 ("Leave spy blank imo"). The served SPX source (FMP) is recorded since L9 (local supply store, out of git), but this capture is deliberately not supplied, so no verdict implies a pass or a fail for it. Before the ruling, the L5 builder's probe on the yfinance fallback read a rating of 63 where TradingView draws 64.
rs-rating-fred6724-w-nvda-1w-2026-11-17      NASDAQ:NVDA 1W   4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  MATCH_SUBSTITUTED cmp 1452 ok 1186 warm 0/0 steady 266/1452 maxRel 7.62e-3
    Plot                                     MATCH_SUBSTITUTED cmp 1452 ok 1452 warm 0/21 steady 0/1431 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 1452 ok 1452 warm 0/21 steady 0/1431 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 1452 ok 1452 warm 0/50 steady 0/1402 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-rating-fred6724-w-rddt-1w-2026-11-17      NYSE:RDDT 1W     4      DIVERGE           1 of 5 compared items diverge
    RS Line                                  MATCH_SUBSTITUTED cmp 139 ok 139 warm 0/0 steady 0/139 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 139 ok 139 warm 0/21 steady 0/118 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 139 ok 139 warm 0/21 steady 0/118 maxRel 0.00e+0
    Plot                                     MATCH_SUBSTITUTED cmp 139 ok 139 warm 0/50 steady 0/89 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 2 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-removal-lost) — the object gate withheld the whole drawing program for a lost removal (guard:delete)
rs-seed-rsrating-pm-alab-1d-2026-11-16       NASDAQ:ALAB 1D   6      DIVERGE           S01_seed_close: bar 639 t=1791379800 na vendor=199.57 ours=na
    S01_seed_close                           DIVERGE           cmp 668 ok 643 warm 0/0 steady 25/668 maxRel 0.00e+0 — 25 steady-state bars disagree; first at bar 639 (na: vendor 199.57 vs ours na) — scattered, last at bar 663
    S02_seed_open                            DIVERGE           cmp 668 ok 643 warm 0/0 steady 25/668 maxRel 0.00e+0 — 25 steady-state bars disagree; first at bar 639 (na: vendor 0 vs ours na) — scattered, last at bar 663
    S03_seed_high                            DIVERGE           cmp 668 ok 643 warm 0/0 steady 25/668 maxRel 0.00e+0 — 25 steady-state bars disagree; first at bar 639 (na: vendor 1000 vs ours na) — scattered, last at bar 663
    S04_seed_is_na                           DIVERGE           cmp 668 ok 0 warm 0/0 steady 668/668 maxRel 0.00e+0 — 668 steady-state bars disagree; first at bar 0 (na: vendor 1 vs ours na) — persistent, last at bar 667
    S05_barssince_seed                       DIVERGE           cmp 668 ok 639 warm 0/0 steady 29/668 maxRel 0.00e+0 — 29 steady-state bars disagree; first at bar 639 (na: vendor 0 vs ours na) — persistent, last at bar 667
    S06_chart_close_CONTROL                  MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
rs-seed-rsrating-pm-rddt-1d-2026-11-16       NYSE:RDDT 1D     6      DIVERGE           S01_seed_close: bar 638 t=1791379800 na vendor=199.57 ours=na
    S01_seed_close                           DIVERGE           cmp 667 ok 642 warm 0/0 steady 25/667 maxRel 0.00e+0 — 25 steady-state bars disagree; first at bar 638 (na: vendor 199.57 vs ours na) — scattered, last at bar 662
    S02_seed_open                            DIVERGE           cmp 667 ok 642 warm 0/0 steady 25/667 maxRel 0.00e+0 — 25 steady-state bars disagree; first at bar 638 (na: vendor 0 vs ours na) — scattered, last at bar 662
    S03_seed_high                            DIVERGE           cmp 667 ok 642 warm 0/0 steady 25/667 maxRel 0.00e+0 — 25 steady-state bars disagree; first at bar 638 (na: vendor 1000 vs ours na) — scattered, last at bar 662
    S04_seed_is_na                           DIVERGE           cmp 667 ok 0 warm 0/0 steady 667/667 maxRel 0.00e+0 — 667 steady-state bars disagree; first at bar 0 (na: vendor 1 vs ours na) — persistent, last at bar 666
    S05_barssince_seed                       DIVERGE           cmp 667 ok 638 warm 0/0 steady 29/667 maxRel 0.00e+0 — 29 steady-state bars disagree; first at bar 638 (na: vendor 0 vs ours na) — persistent, last at bar 666
    S06_chart_close_CONTROL                  MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
rs-seed-rsrating-rddt-1d-2026-11-15          NYSE:RDDT 1D     6      MATCH             all 7 items agree
    S01_seed_close                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    S02_seed_open                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    S03_seed_high                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    S04_seed_is_na                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    S05_barssince_seed                       MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    S06_chart_close_CONTROL                  MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
rs-spx-daily-pm-alab-1d-2026-11-16           NASDAQ:ALAB 1D   6      INCONCLUSIVE      5 of 7 items could not be compared
    X01_spx_D_open                           INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (other-symbol:no-bars)
    X02_spx_D_high                           INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out2 (other-symbol:no-bars)
    X03_spx_D_low                            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out3 (other-symbol:no-bars)
    X04_spx_D_close                          INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out4 (other-symbol:no-bars)
    X05_spx_period_close                     INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out5 (other-symbol:no-bars)
    X06_chart_close_CONTROL                  MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
rs-spx-daily-pm-rddt-1d-2026-11-16           NYSE:RDDT 1D     6      INCONCLUSIVE      5 of 7 items could not be compared
    X01_spx_D_open                           INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (other-symbol:no-bars)
    X02_spx_D_high                           INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out2 (other-symbol:no-bars)
    X03_spx_D_low                            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out3 (other-symbol:no-bars)
    X04_spx_D_close                          INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out4 (other-symbol:no-bars)
    X05_spx_period_close                     INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out5 (other-symbol:no-bars)
    X06_chart_close_CONTROL                  MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
rs-spx-daily-pm-spy-1d-2026-11-16            AMEX:SPY 1D      6      INCONCLUSIVE      5 of 7 items could not be compared
    X01_spx_D_open                           INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (other-symbol:no-bars)
    X02_spx_D_high                           INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out2 (other-symbol:no-bars)
    X03_spx_D_low                            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out3 (other-symbol:no-bars)
    X04_spx_D_close                          INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out4 (other-symbol:no-bars)
    X05_spx_period_close                     INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out5 (other-symbol:no-bars)
    X06_chart_close_CONTROL                  MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
rs-spx-daily-rddt-1d-2026-11-15              NYSE:RDDT 1D     6      INCONCLUSIVE      5 of 7 items could not be compared
    X01_spx_D_open                           INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (other-symbol:no-bars)
    X02_spx_D_high                           INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out2 (other-symbol:no-bars)
    X03_spx_D_low                            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out3 (other-symbol:no-bars)
    X04_spx_D_close                          INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out4 (other-symbol:no-bars)
    X05_spx_period_close                     INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out5 (other-symbol:no-bars)
    X06_chart_close_CONTROL                  MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
rs-spx-daily-spy-1d-2026-11-15               AMEX:SPY 1D      6      INCONCLUSIVE      5 of 7 items could not be compared
    X01_spx_D_open                           INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (other-symbol:no-bars)
    X02_spx_D_high                           INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out2 (other-symbol:no-bars)
    X03_spx_D_low                            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out3 (other-symbol:no-bars)
    X04_spx_D_close                          INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out4 (other-symbol:no-bars)
    X05_spx_period_close                     INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out5 (other-symbol:no-bars)
    X06_chart_close_CONTROL                  MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
rs-syminfo-industry-aapl-1d-2026-11-15       NASDAQ:AAPL 1D   0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-alab-1d-2026-11-15       NASDAQ:ALAB 1D   0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-alab-1d-2026-11-16       NASDAQ:ALAB 1D   0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-amd-1d-2026-11-15        NASDAQ:AMD 1D    0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-arkk-1d-2026-11-15       CBOE:ARKK 1D     0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-coin-1d-2026-11-15       NASDAQ:COIN 1D   0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-crwv-1d-2026-11-15       NASDAQ:CRWV 1D   0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-crwv-1d-2026-11-16       NASDAQ:CRWV 1D   0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-gld-1d-2026-11-15        AMEX:GLD 1D      0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-iwm-1d-2026-11-15        AMEX:IWM 1D      0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-jpm-1d-2026-11-15        NYSE:JPM 1D      0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-ko-1d-2026-11-15         NYSE:KO 1D       0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-msft-1d-2026-11-15       NASDAQ:MSFT 1D   0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-nvda-1d-2026-11-15       NASDAQ:NVDA 1D   0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-pltr-1d-2026-11-15       NASDAQ:PLTR 1D   0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-pm-alab-1d-2026-11-16    NASDAQ:ALAB 1D   0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-pm-rddt-1d-2026-11-16    NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-qqq-1d-2026-11-15        NASDAQ:QQQ 1D    0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-rddt-1d-2026-11-15       NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-rddt-1d-2026-11-16       NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-smh-1d-2026-11-15        NASDAQ:SMH 1D    0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-spy-1d-2026-11-15        AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-tlt-1d-2026-11-15        NASDAQ:TLT 1D    0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-tsla-1d-2026-11-15       NASDAQ:TSLA 1D   0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-unh-1d-2026-11-15        NYSE:UNH 1D      0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-xlk-1d-2026-11-15        AMEX:XLK 1D      0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rs-syminfo-industry-xom-1d-2026-11-15        NYSE:XOM 1D      0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
rsi-horizontal-resistance-levels-rddt-1d-202 NYSE:RDDT 1D     0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 5 paired slots; coordinates are NOT compared by v1
rsi-horizontal-resistance-levels-spy-1d-2026 AMEX:SPY 1D      0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 5 paired slots; coordinates are NOT compared by v1
rsi-swing-indicator-rddt-1d-2026-09-28       NYSE:RDDT 1D     0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 32 paired slots; 1 slot on objects neither side draws not graded; coordinates are NOT compared by v1
rsi-swing-indicator-spy-1d-2026-10-03        AMEX:SPY 1D      0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 150 paired slots; coordinates are NOT compared by v1
rsi-trendlines-with-breakouts-hg-rddt-1d-202 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `HoanGhetti/SimpleTrendlines/3` is not in this engine's library registry, so its code cannot be compiled
rsi-trendlines-with-breakouts-hg-spy-1d-2026 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `HoanGhetti/SimpleTrendlines/3` is not in this engine's library registry, so its code cannot be compiled
rt1-na-test-v4-rddt-1d-2026-10-02            NYSE:RDDT 1D     6      INCONCLUSIVE      1 of 7 items could not be compared
    A00_bar_index_CONTROL                    MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A01_cmp_na_test                          MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A02_cross_na_test                        MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A03_float_nonzero_control                MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A04_history_na_test                      MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A05_na_bool_test                         INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
rt1-na-test-v5-rddt-1d-2026-10-02            NYSE:RDDT 1D     6      INCONCLUSIVE      1 of 7 items could not be compared
    A00_bar_index_CONTROL                    MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A01_cmp_na_test                          MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A02_cross_na_test                        MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A03_float_nonzero_control                MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A04_history_na_test                      MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A05_na_bool_test                         INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
rt1-na-test-v6-rddt-1d-2026-10-02            NYSE:RDDT 1D     5      MATCH             all 6 items agree
    A00_bar_index_CONTROL                    MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A01_cmp_na_test                          MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A02_cross_na_test                        MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A03_float_nonzero_control                MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    A04_history_na_test                      MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
rt3-na-logic-rddt-1d-2026-10-02              NYSE:RDDT 1D     11     INCONCLUSIVE      4 of 12 items could not be compared
    B00_bar_index_CONTROL                    MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B01_naBool_or_true                       INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B02_not_naBool                           MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B03_naBool_and_true_CONTROL              MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B04_na_of_naBool_or_false                MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B05_na_of_not_naBool                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B06_naLiteral_or_true                    INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B07_not_naLiteral                        INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B08_naFloat_or_false                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B09_naFloat_or_true                      INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B10_not_naFloat                          MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
rt3-na-logic-v4-rddt-1d-2026-10-02           NYSE:RDDT 1D     11     INCONCLUSIVE      4 of 12 items could not be compared
    B00_bar_index_CONTROL                    MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B01_naBool_or_true                       INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B02_not_naBool                           MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B03_naBool_and_true_CONTROL              MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B04_na_of_naBool_or_false                MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B05_na_of_not_naBool                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B06_naLiteral_or_true                    INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B07_not_naLiteral                        INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B08_naFloat_or_false                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    B09_naFloat_or_true                      INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B10_not_naFloat                          MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
rvol-rddt-1d-2026-09-27                      NYSE:RDDT D      2      MATCH             all 3 items agree
    Plot                                     MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Plot                                     MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
rvol-spy-1d-2026-10-03                       AMEX:SPY 1D      2      MATCH             all 3 items agree
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
s1-broker-core-rddt-1d-2026-11-15            NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
screener-mean-reversion-channel-rddt-1d-2026 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
screener-mean-reversion-channel-spy-1d-2026- AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
sector-rotation-rddt-1d-2026-09-28           NYSE:RDDT 1D     1      INCONCLUSIVE      1 of 2 items could not be compared
    Current Symbol Percentage Change         MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 1.95e-16
    objects                                  INCONCLUSIVE  our lines, boxes are withheld by name (objects:collector-all, objects:not-carried: No box is shown on this chart: the script makes them in steps this chart can't follow yet, so none are drawn here, though TradingView may draw some.); every other object family's counts and texts agree
sector-rotation-spy-1d-2026-10-03            AMEX:SPY 1D      1      INCONCLUSIVE      1 of 2 items could not be compared
    Current Symbol Percentage Change         MATCH             cmp 1800 ok 1799 warm 1/1 steady 0/1799 maxRel 1.95e-16
    objects                                  INCONCLUSIVE  our lines, boxes are withheld by name (objects:collector-all, objects:not-carried: No box is shown on this chart: the script makes them in steps this chart can't follow yet, so none are drawn here, though TradingView may draw some.); every other object family's counts and texts agree
session-highs-and-lows-indicator-smc-session NYSE:RDDT 60     0      INCONCLUSIVE      refused on our side: member door refused (pine:hidden-only): the only outputs that translate are helper series the author hid; nothing this script displays can be screened
session-highs-and-lows-indicator-smc-session AMEX:SPY 60      0      INCONCLUSIVE      refused on our side: member door refused (pine:hidden-only): the only outputs that translate are helper series the author hid; nothing this script displays can be screened
session-hilo-rddt-1d-2026-11-14              NYSE:RDDT 1D     2      MATCH             all 4 items agree
    Highest High of Session                  MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Lowest Low of Session                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; no colour slot was paired, so no colour was graded; coordinates are NOT compared by v1
    paints                                   MATCH         1 paint agree bar for bar
sessions-rddt-1d-2026-11-14                  NYSE:RDDT 1D     8      MATCH             all 10 items agree
    Plot                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Plot                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Plot                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Plot                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Plot                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Plot                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Plot                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Plot                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         4 paints agree bar for bar
smart-money-breakout-channels-algoalpha-rddt NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `TradingView/ta/10` is not in this engine's library registry, so its code cannot be compiled
smart-money-breakouts-chartprime-rddt-1d-202 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `TradeisON` — and the fold stopped before it, at line 208: a Pine block spans several statements and this engine stores a single expression
smart-money-concept-tradingfinder-major-mino NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `TFlab/OrderBlockRefiner_TradingFinder/2` is not in this engine's library registry, so its code cannot be compiled
smart-money-interest-index-algoalpha-rddt-1d NYSE:RDDT 1D     4      MATCH             all 6 items agree
    Plot                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Plot                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Plot                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Plot                                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 7.52e-15
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         1 paint agree bar for bar
smart-money-volume-activity-algoalpha-rddt-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `retailBullBar` — and the fold stopped before it, at line 105: a Pine block spans several statements and this engine stores a single expression — `for`
smart-money-volume-activity-algoalpha-spy-1d AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `retailBullBar` — and the fold stopped before it, at line 105: a Pine block spans several statements and this engine stores a single expression — `for`
smart-money-volume-index-algoalpha-rddt-1d-2 NYSE:RDDT 1D     20     INCONCLUSIVE      1 of 21 items could not be compared
    Zero Line                                INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    Top Limit                                MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Bottom Limit                             MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    High Buy Threshold                       MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    High Sell Threshold                      MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Buy Interest                             MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Sell Interest                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    Net Buy 100                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 2.55e-13
    Net Buy 80                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 2.55e-13
    Net Buy 60                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 2.55e-13
    Net Buy 40                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 2.55e-13
    Net Buy 20                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 2.55e-13
    Net Buy Line                             MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 2.55e-13
    Net Sell 100                             MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 5.58e-13
    Net Sell 80                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 5.58e-13
    Net Sell 60                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 5.58e-13
    Net Sell 40                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 5.58e-13
    Net Sell 20                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 5.58e-13
    Net Sell Line                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 5.58e-13
    Price Tracking line                      MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
smarter-snr-rddt-1d-2026-11-14               NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `str.length`
smarter-snr-spy-1d-2026-11-14                AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `str.length`
smarter-snr-spy-60-2026-11-14                AMEX:SPY 60      0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `str.length`
smc-structures-and-multi-timeframe-fvg-ma-py NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `structureLow` is read, before it is set, inside the update of another `var` that is itself read before it is set in this one's, so the two carry each other's previous bar and one accumulator holds only one
smc-structures-and-multi-timeframe-fvg-ma-py AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `structureLow` is read, before it is set, inside the update of another `var` that is itself read before it is set in this one's, so the two carry each other's previous bar and one accumulator holds only one
smoothed-gaussian-trend-filter-algoalpha-rdd NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `runningFilterValue` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total
smoothed-gaussian-trend-filter-algoalpha-spy AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `runningFilterValue` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total
smt-divergence-ict-01-tradingfinder-smart-mo NYSE:RDDT 1D     0      INCONCLUSIVE      1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our lines, labels are withheld by name (objects:not-computable: No line or label is shown on this chart: whether and where the script draws them depends on values this chart can't work out here, so none are drawn rather than a guess.); every other object family's counts and texts agree
smt-divergence-ict-01-tradingfinder-smart-mo NYSE:RDDT 1D     0      INCONCLUSIVE      1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our lines, labels are withheld by name (objects:not-computable: No line or label is shown on this chart: whether and where the script draws them depends on values this chart can't work out here, so none are drawn rather than a guess.); every other object family's counts and texts agree
smt-divergence-ict-01-tradingfinder-smart-mo AMEX:SPY 1D      0      INCONCLUSIVE      1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our lines, labels are withheld by name (objects:not-computable: No line or label is shown on this chart: whether and where the script draws them depends on values this chart can't work out here, so none are drawn rather than a guess.); every other object family's counts and texts agree
smt-divergence-ict-01-tradingfinder-smart-mo AMEX:SPY 1D      0      INCONCLUSIVE      1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our lines, labels are withheld by name (objects:not-computable: No line or label is shown on this chart: whether and where the script draws them depends on values this chart can't work out here, so none are drawn rather than a guess.); every other object family's counts and texts agree
smt-divergence-ict-killzones-rddt-1d-2026-11 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `alert_bear` — and the fold stopped before it, at line 329: a Pine block spans several statements and this engine stores a single expression — `for`
smt-divergence-ict-killzones-spy-1d-2026-11- AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `alert_bear` — and the fold stopped before it, at line 329: a Pine block spans several statements and this engine stores a single expression — `for`
sonarlab-order-blocks-aapl-1d-2026-10-02     NASDAQ:AAPL 1D   0      DIVERGE           1 of 1 compared items diverge
    objects                                  DIVERGE       TradingView holds 17 drawing object(s) at the last bar and our drawing is withheld by name (objects:off-listing) — the box drawings live in a `var` list, and on a chart that does not start at the symbol's listing the objects earlier bars put there are not knowable
sonarlab-order-blocks-brk-a-1d-2026-10-02    NYSE:BRK.A 1D    0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 48 paired slots; coordinates are NOT compared by v1
sonarlab-order-blocks-rddt-1d-2026-10-02     NYSE:RDDT 1D     0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 10 paired slots; coordinates are NOT compared by v1
sonarlab-order-blocks-spy-1d-2026-10-02      AMEX:SPY 1D      0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 48 paired slots; coordinates are NOT compared by v1
std-filtered-adaptive-exponential-hull-movin NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:library-denied): this library version is withheld until its drawing is verified against TradingView — the library `loxx/loxxexpandedsourcetypes/4` is not served: this library version is withheld until its drawing is verified against TradingView
std-filtered-adaptive-exponential-hull-movin AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:library-denied): this library version is withheld until its drawing is verified against TradingView — the library `loxx/loxxexpandedsourcetypes/4` is not served: this library version is withheld until its drawing is verified against TradingView
strength-of-divergence-across-multiple-indic NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `reees/TA/11` is not in this engine's library registry, so its code cannot be compiled
strong-start-rvol-dashboard-rddt-1d-2026-11- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:object-removal-lost): This script's drawing can't be shown yet. It removes drawings as it runs, and this chart can't follow part of that (a table clear), so drawing the rest would leave lines, labels, boxes or table cells on screen that TradingView would have removed.
strong-start-rvol-dashboard-spy-1d-2026-11-1 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:object-removal-lost): This script's drawing can't be shown yet. It removes drawings as it runs, and this chart can't follow part of that (a table clear), so drawing the rest would leave lines, labels, boxes or table cells on screen that TradingView would have removed.
sub-rddt-1d-2026-11-15                       NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `security`
sub-spy-1d-2026-11-15                        AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `security`
supertrend-relative-volume-kernel-optimized- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `TradingView/ta/9` is not in this engine's library registry, so its code cannot be compiled
supertrend-strategy-alab-1d-2026-11-17       NASDAQ:ALAB 1D   7      INCONCLUSIVE      1 of 9 items could not be compared; strategy EXPECTED-REFUSAL at step 1: refused by harness:no-broker
    Up Trend                                 MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    UpTrend Begins                           MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    Buy                                      MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    Down Trend                               MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    DownTrend Begins                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    Sell                                     MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    plot_6                                   MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   INCONCLUSIVE  no paint was graded; 1 paint withheld by name, not graded (first: barcolor plot_9 "Bar Color" — `barcolor`'s colour is an expression this door cannot carry yet)
supertrend-strategy-is-rddt-1d-2026-11-18    NYSE:RDDT 1D     7      INCONCLUSIVE      1 of 9 items could not be compared; strategy EXPECTED-REFUSAL at step 1: refused by harness:no-broker
    Up Trend                                 MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 4.92e-16
    UpTrend Begins                           MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    Buy                                      MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    Down Trend                               MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    DownTrend Begins                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    Sell                                     MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    plot_6                                   MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   INCONCLUSIVE  no paint was graded; 1 paint withheld by name, not graded (first: barcolor plot_9 "Bar Color" — `barcolor`'s colour is an expression this door cannot carry yet)
supertrend-strategy-rddt-1d-2026-10-02       NYSE:RDDT 1D     7      INCONCLUSIVE      1 of 9 items could not be compared
    Up Trend                                 MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 4.92e-16
    UpTrend Begins                           MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Buy                                      MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Down Trend                               MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    DownTrend Begins                         MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Sell                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    plot_6                                   MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   INCONCLUSIVE  no paint was graded; 1 paint withheld by name, not graded (first: barcolor plot_9 "Bar Color" — `barcolor`'s colour is an expression this door cannot carry yet)
supertrend-strategy-rddt-1d-2026-11-17       NYSE:RDDT 1D     7      INCONCLUSIVE      1 of 9 items could not be compared; strategy EXPECTED-REFUSAL at step 1: refused by harness:no-broker
    Up Trend                                 MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 4.92e-16
    UpTrend Begins                           MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Buy                                      MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Down Trend                               MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    DownTrend Begins                         MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Sell                                     MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    plot_6                                   MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   INCONCLUSIVE  no paint was graded; 1 paint withheld by name, not graded (first: barcolor plot_9 "Bar Color" — `barcolor`'s colour is an expression this door cannot carry yet)
supertrend-strategy-spy-1d-2026-10-02        AMEX:SPY 1D      7      INCONCLUSIVE      1 of 9 items could not be compared
    Up Trend                                 MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    UpTrend Begins                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Buy                                      MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Down Trend                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    DownTrend Begins                         MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Sell                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    plot_6                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   INCONCLUSIVE  no paint was graded; 1 paint withheld by name, not graded (first: barcolor plot_9 "Bar Color" — `barcolor`'s colour is an expression this door cannot carry yet)
supply-demand-mtf-flux-charts-rddt-1d-2026-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `renderBreakLabelBuyside` — and the fold stopped before it, at line 431: a Pine block spans several statements and this engine stores a single expression — `for`
supply-demand-mtf-flux-charts-rddt-1d-2026-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `renderBreakLabelBuyside` — and the fold stopped before it, at line 431: a Pine block spans several statements and this engine stores a single expression — `for`
supply-demand-mtf-flux-charts-spy-1d-2026-11 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `renderBreakLabelBuyside` — and the fold stopped before it, at line 431: a Pine block spans several statements and this engine stores a single expression — `for`
supply-demand-mtf-flux-charts-spy-1d-2026-11 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `renderBreakLabelBuyside` — and the fold stopped before it, at line 431: a Pine block spans several statements and this engine stores a single expression — `for`
supply-demand-mtf-flux-charts-spy-60-2026-11 AMEX:SPY 60      0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `renderBreakLabelBuyside` — and the fold stopped before it, at line 431: a Pine block spans several statements and this engine stores a single expression — `for`
support-and-resistance-5f95e90f-rddt-1d-2026 NYSE:RDDT 1D     8      INCONCLUSIVE      2 of 9 items could not be compared
    L                                        INCONCLUSIVE       — UNMAPPED — vendor title "L" is not unique in the study
    L                                        INCONCLUSIVE       — UNMAPPED — vendor title "L" is not unique in the study
    STR                                      MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    STS                                      MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    LTR                                      MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    LTS                                      MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    .R                                       MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    .S                                       MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
support-and-resistance-7538ddd8-rddt-1d-2026 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
support-and-resistance-logistic-regression-f NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `_supportRetestDetected` — and the fold stopped before it, at line 233: a Pine block spans several statements and this engine stores a single expression — `for`
support-and-resistance-logistic-regression-f NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `_supportRetestDetected` — and the fold stopped before it, at line 233: a Pine block spans several statements and this engine stores a single expression — `for`
support-and-resistance-logistic-regression-f AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `_supportRetestDetected` — and the fold stopped before it, at line 233: a Pine block spans several statements and this engine stores a single expression — `for`
support-and-resistance-multi-time-frame-rddt NYSE:RDDT 1D     6      MATCH             all 7 items agree
    Resistance Daily                         MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Support Daily                            MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Resistance Weekly                        MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Support Weekly                           MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Resistance Monthly                       MATCH             cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    Support Monthly                          MATCH             cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
support-and-resistance-multi-time-frame-rddt NYSE:RDDT 1D     6      MATCH             all 7 items agree
    Resistance Daily                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    Support Daily                            MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    Resistance Weekly                        MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Support Weekly                           MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Resistance Monthly                       MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    Support Monthly                          MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
support-and-resistance-multi-time-frame-spy- AMEX:SPY 1D      6      MATCH             all 7 items agree
    Resistance Daily                         MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Support Daily                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Resistance Weekly                        MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Support Weekly                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Resistance Monthly                       MATCH             cmp 1799 ok 1799 warm 0/0 steady 0/1799 maxRel 0.00e+0
    Support Monthly                          MATCH             cmp 1799 ok 1799 warm 0/0 steady 0/1799 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
support-and-resistance-multi-time-frame-spy- AMEX:SPY 1D      6      MATCH             all 7 items agree
    Resistance Daily                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    Support Daily                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    Resistance Weekly                        MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    Support Weekly                           MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    Resistance Monthly                       MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    Support Monthly                          MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
support-and-resistance-rddt-1d-2026-10-02    NYSE:RDDT 1D     2      MATCH             all 3 items agree
    Plot                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Plot                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
support-and-resistance-spy-1d-2026-10-02     AMEX:SPY 1D      2      MATCH             all 3 items agree
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
support-resistance-mtf-flux-charts-rddt-1d-2 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:type): a user-defined type is outside the node shapes this engine stores — `alerts.get`
support-resistance-mtf-flux-charts-spy-1d-20 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:type): a user-defined type is outside the node shapes this engine stores — `alerts.get`
swing-highlow-zigzag-chartprime-rddt-1d-2026 NYSE:RDDT 1D     1      MATCH             all 2 items agree
    Plot                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 18 paired slots (3 theme-relative); 1 slot on objects neither side draws not graded; coordinates are NOT compared by v1
swing-highlow-zigzag-chartprime-spy-1d-2026- AMEX:SPY 1D      1      MATCH             all 2 items agree
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 60 paired slots (3 theme-relative); 1 slot on objects neither side draws not graded; coordinates are NOT compared by v1
swing-points-and-liquidity-by-leviathan-rddt NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`
swing-points-and-liquidity-by-leviathan-spy- AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`
syminfo-mincontract-aapl-1d-2026-11-16       NASDAQ:AAPL 1D   0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
syminfo-mincontract-rddt-1d-2026-11-16       NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
syminfo-mincontract-spy-1d-2026-11-16        AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
syminfo-roster-aapl-1d-2026-09-30            NASDAQ:AAPL 1D   0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): `syminfo.type` is a Pine built-in this engine holds no VALUE for, though it holds its sibling `syminfo.ticker`: what kind of instrument the symbol is (`stock`, `fund`, `crypto`…). ⭐ MEASURED 2026-09-30 (`tests/fixtures/vendor/harness/syminfo-roster-*-1d-2026-09-30.json`, S6/S8): AAPL, BRK.B and F answer `stock`, SPY answers a 4-character type that is NOT `stock` (a fund), and our symbol store holds no stock-vs-fund fact for a listing — so an answer served per exchange would call SPY a stock. It is refused until the store can tell the two apart exactly, per instrument, never per exchange.
syminfo-roster-bitstamp-btcusd-1d-2026-09-30 BITSTAMP:BTCUSD  0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): `syminfo.type` is a Pine built-in this engine holds no VALUE for, though it holds its sibling `syminfo.ticker`: what kind of instrument the symbol is (`stock`, `fund`, `crypto`…). ⭐ MEASURED 2026-09-30 (`tests/fixtures/vendor/harness/syminfo-roster-*-1d-2026-09-30.json`, S6/S8): AAPL, BRK.B and F answer `stock`, SPY answers a 4-character type that is NOT `stock` (a fund), and our symbol store holds no stock-vs-fund fact for a listing — so an answer served per exchange would call SPY a stock. It is refused until the store can tell the two apart exactly, per instrument, never per exchange.
syminfo-roster-brk-b-1d-2026-09-30           NYSE:BRK.B 1D    0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): `syminfo.type` is a Pine built-in this engine holds no VALUE for, though it holds its sibling `syminfo.ticker`: what kind of instrument the symbol is (`stock`, `fund`, `crypto`…). ⭐ MEASURED 2026-09-30 (`tests/fixtures/vendor/harness/syminfo-roster-*-1d-2026-09-30.json`, S6/S8): AAPL, BRK.B and F answer `stock`, SPY answers a 4-character type that is NOT `stock` (a fund), and our symbol store holds no stock-vs-fund fact for a listing — so an answer served per exchange would call SPY a stock. It is refused until the store can tell the two apart exactly, per instrument, never per exchange.
syminfo-roster-f-1d-2026-09-30               NYSE:F 1D        0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): `syminfo.type` is a Pine built-in this engine holds no VALUE for, though it holds its sibling `syminfo.ticker`: what kind of instrument the symbol is (`stock`, `fund`, `crypto`…). ⭐ MEASURED 2026-09-30 (`tests/fixtures/vendor/harness/syminfo-roster-*-1d-2026-09-30.json`, S6/S8): AAPL, BRK.B and F answer `stock`, SPY answers a 4-character type that is NOT `stock` (a fund), and our symbol store holds no stock-vs-fund fact for a listing — so an answer served per exchange would call SPY a stock. It is refused until the store can tell the two apart exactly, per instrument, never per exchange.
syminfo-roster-spy-1d-2026-09-30             AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): `syminfo.type` is a Pine built-in this engine holds no VALUE for, though it holds its sibling `syminfo.ticker`: what kind of instrument the symbol is (`stock`, `fund`, `crypto`…). ⭐ MEASURED 2026-09-30 (`tests/fixtures/vendor/harness/syminfo-roster-*-1d-2026-09-30.json`, S6/S8): AAPL, BRK.B and F answer `stock`, SPY answers a 4-character type that is NOT `stock` (a fund), and our symbol store holds no stock-vs-fund fact for a listing — so an answer served per exchange would call SPY a stock. It is refused until the store can tell the two apart exactly, per instrument, never per exchange.
take-profit-multi-timeframe-rddt-1d-2026-11- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `240` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `240` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.; strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
take-profit-multi-timeframe-spy-1d-2026-11-1 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `240` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `240` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.; strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
tehthomas-aligned-timeframe-fair-value-gaps- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
tehthomas-aligned-timeframe-fair-value-gaps- AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
tradingview-alerts-to-mt4-mt5-forex-indices- NYSE:RDDT 1D     2      MATCH             all 3 items agree
    %K                                       MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.86e-15
    %D                                       MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.61e-15
    objects                                  MATCH         neither side draws an object
tradingview-alerts-to-mt4-mt5-forex-indices- AMEX:SPY 1D      2      MATCH             all 3 items agree
    %K                                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 4.46e-15
    %D                                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.16e-14
    objects                                  MATCH         neither side draws an object
tradingview-alerts-to-mt4-mt5-strategy-examp NYSE:RDDT 1D     2      MATCH             all 3 items agree
    %K                                       MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.86e-15
    %D                                       MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.61e-15
    objects                                  MATCH         object counts and texts agree; colours agree on 11 paired slots; coordinates are NOT compared by v1
tradingview-alerts-to-mt4-mt5-strategy-examp AMEX:SPY 1D      2      MATCH             all 3 items agree
    %K                                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 4.46e-15
    %D                                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.16e-14
    objects                                  MATCH         object counts and texts agree; colours agree on 11 paired slots; coordinates are NOT compared by v1
trailing-take-profit-trailing-stop-loss-rddt NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `jason5480/chrono_utils/7` is not in this engine's library registry, so its code cannot be compiled; strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
trend-duration-forecast-chartprime-rddt-1d-2 NYSE:RDDT 1D     1      MATCH             all 2 items agree
    HMA                                      MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 126 paired slots (22 theme-relative); coordinates are NOT compared by v1
trend-duration-forecast-chartprime-spy-1d-20 AMEX:SPY 1D      1      MATCH             all 2 items agree
    HMA                                      MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 180 paired slots (22 theme-relative); coordinates are NOT compared by v1
trend-levels-chartprime-rddt-1d-2026-11-15   NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:window): a Pine length has to reach the engine as a plain whole number — argument 2 of `ta.highest`
trend-levels-chartprime-spy-1d-2026-11-15    AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:window): a Pine length has to reach the engine as a plain whole number — argument 2 of `ta.highest`
trend-line-harrybot-rddt-1d-2026-11-14       NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `care`)
trend-lines-supports-and-resistances-rddt-1d NYSE:RDDT 1D     2      DIVERGE           1 of 3 compared items diverge
    High Pivots                              MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Low Pivots                               MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 14 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 6 drawing steps (dropped: never carried: box.new, label.delete, label.new, line.delete, line.new, line.set_color, line.set_extend, line.set_style)
trend-lines-supports-and-resistances-spy-1d- AMEX:SPY 1D      2      DIVERGE           1 of 3 compared items diverge
    High Pivots                              MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Low Pivots                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 11 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 6 drawing steps (dropped: never carried: box.new, label.delete, label.new, line.delete, line.new, line.set_color, line.set_extend, line.set_style)
trend-targets-algoalpha-rddt-1d-2026-10-02   NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `rejcount` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total. THIS ENGINE DOES DECLARE A BOUNDED FORM: `cumFrom(<that value>, <anchor>, <bars>)` — the same running total with the starting instant STATED. Stating the window is what makes the answer the same tomorrow — an all-time value moves with however many bars were fetched.
trend-targets-algoalpha-rddt-1d-2026-11-15   NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `rejcount` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total. THIS ENGINE DOES DECLARE A BOUNDED FORM: `cumFrom(<that value>, <anchor>, <bars>)` — the same running total with the starting instant STATED. Stating the window is what makes the answer the same tomorrow — an all-time value moves with however many bars were fetched.
trend-targets-algoalpha-rddt-1d-2026-11-17   NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `rejcount` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total. THIS ENGINE DOES DECLARE A BOUNDED FORM: `cumFrom(<that value>, <anchor>, <bars>)` — the same running total with the starting instant STATED. Stating the window is what makes the answer the same tomorrow — an all-time value moves with however many bars were fetched.
trend-targets-algoalpha-spy-1d-2026-10-02    AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `rejcount` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total. THIS ENGINE DOES DECLARE A BOUNDED FORM: `cumFrom(<that value>, <anchor>, <bars>)` — the same running total with the starting instant STATED. Stating the window is what makes the answer the same tomorrow — an all-time value moves with however many bars were fetched.
trend-targets-algoalpha-spy-1d-2026-11-15    AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `rejcount` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total. THIS ENGINE DOES DECLARE A BOUNDED FORM: `cumFrom(<that value>, <anchor>, <bars>)` — the same running total with the starting instant STATED. Stating the window is what makes the answer the same tomorrow — an all-time value moves with however many bars were fetched.
trend-targets-algoalpha-spy-1d-2026-11-17    AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `rejcount` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total. THIS ENGINE DOES DECLARE A BOUNDED FORM: `cumFrom(<that value>, <anchor>, <bars>)` — the same running total with the starting instant STATED. Stating the window is what makes the answer the same tomorrow — an all-time value moves with however many bars were fetched.
trendline-pivots-quantvue-rddt-1d-2026-11-14 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:object-removal-lost): This script's drawing can't be shown yet. It removes drawings as it runs, and this chart can't follow part of that (a delete and a change to the list it deletes from), so drawing the rest would leave lines, labels, boxes or table cells on screen that TradingView would have removed.
trendlines-rddt-1d-2026-09-27                NYSE:RDDT D      8      MATCH             all 9 items agree
    Pivot High                               MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Pivot Low                                MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Resistance Trendline                     MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Support Trendline                        MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Long Break                               MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Short Break                              MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Plot                                     MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    Plot                                     MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 5 paired slots; 2 slots on objects neither side draws not graded; coordinates are NOT compared by v1
trendlines-spy-1d-2026-10-03                 AMEX:SPY 1D      8      MATCH             all 9 items agree
    Pivot High                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Pivot Low                                MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Resistance Trendline                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Support Trendline                        MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Long Break                               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Short Break                              MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 52 paired slots; coordinates are NOT compared by v1
trendlinesample-rddt-1d-2026-11-14           NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
twin-range-filter-rddt-1d-2026-10-02         NYSE:RDDT 1D     2      MATCH             all 3 items agree
    Long                                     MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    Short                                    MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
twin-range-filter-spy-1d-2026-10-02          AMEX:SPY 1D      2      MATCH             all 3 items agree
    Long                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Short                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
ultimate-pivot-points-rddt-1d-2026-09-28     NYSE:RDDT 1D     3      MATCH             all 4 items agree
    PD_H                                     MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    PD_L                                     MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    Pivot                                    MATCH             cmp 632 ok 632 warm 0/0 steady 0/632 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 102 paired slots; 51 slots on objects neither side draws not graded; coordinates are NOT compared by v1
ultimate-pivot-points-spy-1d-2026-10-03      AMEX:SPY 1D      3      MATCH             all 4 items agree
    PD_H                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    PD_L                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    Pivot                                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 102 paired slots; 51 slots on objects neither side draws not graded; coordinates are NOT compared by v1
vdubus-pattern-gen-v2-restored-refined-rddt- NYSE:RDDT 1D     0      MATCH             all 1 items agree
    objects                                  MATCH         object counts and texts agree; colours agree on 122 paired slots; coordinates are NOT compared by v1
vdubus-pattern-gen-v2-restored-refined-spy-1 AMEX:SPY 1D      0      INCONCLUSIVE      1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our lines are withheld by name (TradingView's object limit may have removed some of them; objects:collector); every other object family's counts and texts agree
visualizing-displacement-tfo-rddt-1d-2026-11 NYSE:RDDT 1D     0      MATCH             all 2 items agree
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         1 paint agree bar for bar
volatility-coil-edge-bullbyte-rddt-1d-2026-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `isContracted` — and the fold stopped before it, at line 378: a Pine block spans several statements and this engine stores a single expression — `for`
volatility-coil-edge-bullbyte-rddt-1d-2026-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `isContracted` — and the fold stopped before it, at line 378: a Pine block spans several statements and this engine stores a single expression — `for`
volatility-coil-edge-bullbyte-spy-1d-2026-11 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `isContracted` — and the fold stopped before it, at line 378: a Pine block spans several statements and this engine stores a single expression — `for`
volatility-stop-mtf-rddt-1d-2026-11-15       NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `PineCoders/Time/5` is not in this engine's library registry, so its code cannot be compiled
volatility-stop-mtf-spy-1d-2026-11-15        AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:module): importing another script pulls in code this engine never sees — the library `PineCoders/Time/5` is not in this engine's library registry, so its code cannot be compiled
volatility-trend-score-backquant-rddt-1d-202 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:type): a user-defined type is outside the node shapes this engine stores — `c.score`
vold-market-breadth-rddt-1d-2026-09-28       NYSE:RDDT 1D     0      DIVERGE           1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 2 paired slots; coordinates are NOT compared by v1
vold-market-breadth-spy-1d-2026-10-03        AMEX:SPY 1D      0      DIVERGE           1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 2 paired slots; coordinates are NOT compared by v1
volume-delta-hapharmonic-rddt-1d-2026-11-14  NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:type): a user-defined type is outside the node shapes this engine stores — `ohlcv.V`
volume-delta-oi-delta-kioseff-trading-rddt-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
volume-delta-oi-delta-kioseff-trading-spy-1d AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
volume-divergence-by-mm-rddt-1d-2026-11-17   NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `pine_wma`)
volume-divergence-by-mm-spy-1d-2026-11-17    AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `pine_wma`)
volume-open-interest-footprint-by-leviathan- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
volume-open-interest-footprint-by-leviathan- AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
volume-profile-auto-line-v2-rddt-1d-2026-11- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
volume-profile-bar-magnified-order-blocks-ja NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:tuple): this Pine call answers with several values at once and a column carries one — `bull` — `checkObCondition` is a function this script defines and this engine could not read, so none of its values can be handed out — a Pine block spans several statements and this engine stores a single expression — `for` (reached through `checkObCondition`)
volume-profile-bar-magnified-order-blocks-ja AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:tuple): this Pine call answers with several values at once and a column carries one — `bull` — `checkObCondition` is a function this script defines and this engine could not read, so none of its values can be handed out — a Pine block spans several statements and this engine stores a single expression — `for` (reached through `checkObCondition`)
volume-profile-rddt-1d-2026-09-28            NYSE:RDDT 1D     0      INCONCLUSIVE      1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our lines are withheld by name (objects:not-carried: No line is shown on this chart: the script makes them in steps this chart can't follow yet, so none are drawn here, though TradingView may draw some.); every other object family's counts and texts agree
volume-profile-spy-1d-2026-10-03             AMEX:SPY 1D      0      INCONCLUSIVE      1 of 1 items could not be compared
    objects                                  INCONCLUSIVE  our lines are withheld by name (objects:not-carried: No line is shown on this chart: the script makes them in steps this chart can't follow yet, so none are drawn here, though TradingView may draw some.); every other object family's counts and texts agree
volume-spikes-growing-volume-signals-with-al NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (budget:lookback): this script is not drawn: its plot `Volume Up Spike Marker` needs 1000 bars of history behind every bar, and one plot may reach back at most 960 here
volume-spikes-growing-volume-signals-with-al AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (budget:lookback): this script is not drawn: its plot `Volume Up Spike Marker` needs 1000 bars of history behind every bar, and one plot may reach back at most 960 here
volume-suite-by-leviathan-rddt-1d-2026-11-15 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:tuple): this Pine call answers with several values at once and a column carries one — `vwap` — this engine has no tuple form for `ta.vwap` — the ones it can take apart are `ta.bb`, `ta.dmi`, `ta.kc`, `ta.macd`, `ta.supertrend`. Writing it WITHOUT the brackets says more about why
volume-suite-by-leviathan-spy-1d-2026-11-15  AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:tuple): this Pine call answers with several values at once and a column carries one — `vwap` — this engine has no tuple form for `ta.vwap` — the ones it can take apart are `ta.bb`, `ta.dmi`, `ta.kc`, `ta.macd`, `ta.supertrend`. Writing it WITHOUT the brackets says more about why
volumized-order-blocks-flux-charts-rddt-1d-2 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
volumized-order-blocks-flux-charts-spy-1d-20 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
vw-andor-history-rddt-1d-2026-11-16          NYSE:RDDT 1D     9      INCONCLUSIVE      5 of 10 items could not be compared
    A00_bar_index_CONTROL                    MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    E05_change_every_bar                     MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    E03_sma_every_bar                        MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    E07_test_CONTROL                         MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    B01_and_change_positive                  INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out5 (pine:block)
    B02_and_close_above_sma                  INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out6 (pine:block)
    B03_and_crossover                        INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out7 (pine:block)
    B04_or_change_positive                   INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out8 (pine:block)
    B05_and_rising2                          INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out9 (pine:block)
    objects                                  MATCH         neither side draws an object
vw-andor-history-spy-1d-2026-11-16           AMEX:SPY 1D      9      INCONCLUSIVE      5 of 10 items could not be compared
    A00_bar_index_CONTROL                    MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    E05_change_every_bar                     MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    E03_sma_every_bar                        MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    E07_test_CONTROL                         MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    B01_and_change_positive                  INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out5 (pine:block)
    B02_and_close_above_sma                  INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out6 (pine:block)
    B03_and_crossover                        INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out7 (pine:block)
    B04_or_change_positive                   INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out8 (pine:block)
    B05_and_rising2                          INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out9 (pine:block)
    objects                                  MATCH         neither side draws an object
vw-arm-history-rddt-1d-2026-10-02            NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:roundtrip): the translator wrote formula text it could not read back, so it emitted none
vw-arm-history-spy-1d-2026-10-02             AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:roundtrip): the translator wrote formula text it could not read back, so it emitted none
vw-array-na-rddt-1d-2026-11-15               NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `array.indexof` is not folded on this lane — of 18 uses in the reference corpus none reach a plot or an alertcondition, so the binding constraint is what CONSUMES the result rather than what this lane could compute (ruling R9)
vw-array-na-spy-1d-2026-10-02                AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `array.indexof` is not folded on this lane — of 18 uses in the reference corpus none reach a plot or an alertcondition, so the binding constraint is what CONSUMES the result rather than what this lane could compute (ruling R9)
vw-bar-counters-rddt-15-2026-09-30           NYSE:RDDT 15     8      INCONCLUSIVE      1 of 9 items could not be compared
    C00_bar_index_CONTROL                    MATCH             cmp 16397 ok 16397 warm 0/0 steady 0/16397 maxRel 0.00e+0
    C01_var_n_plus_1                         MATCH             cmp 16397 ok 16397 warm 0/0 steady 0/16397 maxRel 0.00e+0
    C02_na_hist_seeded_counter               MATCH             cmp 16397 ok 16397 warm 0/0 steady 0/16397 maxRel 0.00e+0
    C03_var_compound                         MATCH             cmp 16397 ok 16397 warm 0/0 steady 0/16397 maxRel 0.00e+0
    C04_var_na_seed_counter                  MATCH             cmp 16397 ok 16397 warm 0/0 steady 0/16397 maxRel 0.00e+0
    C05_ta_cum_1                             INCONCLUSIVE      cmp 16397 ok 16397 warm 0/0 steady 0/16397 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C06_n1_minus_bar_index                   MATCH             cmp 16397 ok 16397 warm 0/0 steady 0/16397 maxRel 0.00e+0
    C07_n2_minus_bar_index                   MATCH             cmp 16397 ok 16397 warm 0/0 steady 0/16397 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-counters-rddt-1d-2026-09-30           NYSE:RDDT 1D     8      INCONCLUSIVE      1 of 9 items could not be compared
    C00_bar_index_CONTROL                    MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    C01_var_n_plus_1                         MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    C02_na_hist_seeded_counter               MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    C03_var_compound                         MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    C04_var_na_seed_counter                  MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    C05_ta_cum_1                             INCONCLUSIVE      cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C06_n1_minus_bar_index                   MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    C07_n2_minus_bar_index                   MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-counters-rddt-240-2026-09-30          NYSE:RDDT 240    8      INCONCLUSIVE      1 of 9 items could not be compared
    C00_bar_index_CONTROL                    MATCH             cmp 1262 ok 1262 warm 0/0 steady 0/1262 maxRel 0.00e+0
    C01_var_n_plus_1                         MATCH             cmp 1262 ok 1262 warm 0/0 steady 0/1262 maxRel 0.00e+0
    C02_na_hist_seeded_counter               MATCH             cmp 1262 ok 1262 warm 0/0 steady 0/1262 maxRel 0.00e+0
    C03_var_compound                         MATCH             cmp 1262 ok 1262 warm 0/0 steady 0/1262 maxRel 0.00e+0
    C04_var_na_seed_counter                  MATCH             cmp 1262 ok 1262 warm 0/0 steady 0/1262 maxRel 0.00e+0
    C05_ta_cum_1                             INCONCLUSIVE      cmp 1262 ok 1262 warm 0/0 steady 0/1262 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C06_n1_minus_bar_index                   MATCH             cmp 1262 ok 1262 warm 0/0 steady 0/1262 maxRel 0.00e+0
    C07_n2_minus_bar_index                   MATCH             cmp 1262 ok 1262 warm 0/0 steady 0/1262 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-counters-rddt-5-2026-09-30            NYSE:RDDT 5      8      INCONCLUSIVE      7 of 9 items could not be compared
    C00_bar_index_CONTROL                    MATCH             cmp 20052 ok 20052 warm 0/0 steady 0/20052 maxRel 0.00e+0
    C01_var_n_plus_1                         INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C02_na_hist_seeded_counter               INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C03_var_compound                         INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C04_var_na_seed_counter                  INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C05_ta_cum_1                             INCONCLUSIVE      cmp 20052 ok 20052 warm 0/0 steady 0/20052 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C06_n1_minus_bar_index                   INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C07_n2_minus_bar_index                   INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    objects                                  MATCH         neither side draws an object
vw-bar-counters-rddt-60-2026-09-30           NYSE:RDDT 60     8      INCONCLUSIVE      1 of 9 items could not be compared
    C00_bar_index_CONTROL                    MATCH             cmp 4417 ok 4417 warm 0/0 steady 0/4417 maxRel 0.00e+0
    C01_var_n_plus_1                         MATCH             cmp 4417 ok 4417 warm 0/0 steady 0/4417 maxRel 0.00e+0
    C02_na_hist_seeded_counter               MATCH             cmp 4417 ok 4417 warm 0/0 steady 0/4417 maxRel 0.00e+0
    C03_var_compound                         MATCH             cmp 4417 ok 4417 warm 0/0 steady 0/4417 maxRel 0.00e+0
    C04_var_na_seed_counter                  MATCH             cmp 4417 ok 4417 warm 0/0 steady 0/4417 maxRel 0.00e+0
    C05_ta_cum_1                             INCONCLUSIVE      cmp 4417 ok 4417 warm 0/0 steady 0/4417 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C06_n1_minus_bar_index                   MATCH             cmp 4417 ok 4417 warm 0/0 steady 0/4417 maxRel 0.00e+0
    C07_n2_minus_bar_index                   MATCH             cmp 4417 ok 4417 warm 0/0 steady 0/4417 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-counters-spy-1-2026-10-02             AMEX:SPY 1       8      INCONCLUSIVE      8 of 9 items could not be compared
    C00_bar_index_CONTROL                    INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    C01_var_n_plus_1                         INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C02_na_hist_seeded_counter               INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C03_var_compound                         INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C04_var_na_seed_counter                  INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C05_ta_cum_1                             INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (running-total:window) — nothing is drawn for it
    C06_n1_minus_bar_index                   INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    C07_n2_minus_bar_index                   INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    objects                                  MATCH         neither side draws an object
vw-bar-counters-spy-30-2026-10-02            AMEX:SPY 30      8      INCONCLUSIVE      8 of 9 items could not be compared
    C00_bar_index_CONTROL                    INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    C01_var_n_plus_1                         INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C02_na_hist_seeded_counter               INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C03_var_compound                         INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C04_var_na_seed_counter                  INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    C05_ta_cum_1                             INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (running-total:window) — nothing is drawn for it
    C06_n1_minus_bar_index                   INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    C07_n2_minus_bar_index                   INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    objects                                  MATCH         neither side draws an object
vw-bar-origin-rddt-5-2026-10-02              NYSE:RDDT 5      11     INCONCLUSIVE      4 of 12 items could not be compared
    O00_bar_index_CONTROL                    MATCH             cmp 20208 ok 20208 warm 0/0 steady 0/20208 maxRel 0.00e+0
    O01_last_bar_index                       MATCH             cmp 20208 ok 20208 warm 0/0 steady 0/20208 maxRel 0.00e+0
    O02_isfirst                              MATCH             cmp 20208 ok 20208 warm 0/0 steady 0/20208 maxRel 0.00e+0
    O03_bars_seen_by_a_var_counter           INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    O04_bar_index_minus_counter_MUST_BE_MINU INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    O05_bar_index_where_isfirst_was_true     INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:bars) — nothing is drawn for it
    O06_barssince_isfirst                    MATCH             cmp 20208 ok 20208 warm 0/0 steady 0/20208 maxRel 0.00e+0
    O07_first_bar_time_in_days               INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (var-origin:window) — nothing is drawn for it
    O08_bar_index_mod_3                      MATCH             cmp 20208 ok 20208 warm 0/0 steady 0/20208 maxRel 0.00e+0
    O09_bar_index_gt_100                     MATCH             cmp 20208 ok 20208 warm 0/0 steady 0/20208 maxRel 0.00e+0
    O10_distance_MUST_BE_5                   MATCH             cmp 20208 ok 20208 warm 0/5 steady 0/20203 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-origin-rddt-60-2026-10-02             NYSE:RDDT 60     11     MATCH             all 12 items agree
    O00_bar_index_CONTROL                    MATCH             cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O01_last_bar_index                       MATCH             cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O02_isfirst                              MATCH             cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O03_bars_seen_by_a_var_counter           MATCH             cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O04_bar_index_minus_counter_MUST_BE_MINU MATCH             cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O05_bar_index_where_isfirst_was_true     MATCH             cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O06_barssince_isfirst                    MATCH             cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O07_first_bar_time_in_days               MATCH             cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O08_bar_index_mod_3                      MATCH             cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O09_bar_index_gt_100                     MATCH             cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    O10_distance_MUST_BE_5                   MATCH             cmp 4431 ok 4431 warm 0/0 steady 0/4431 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-origin-spy-1d-300-2026-10-02          AMEX:SPY 1D      11     MATCH             all 12 items agree
    O00_bar_index_CONTROL                    MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O01_last_bar_index                       MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O02_isfirst                              MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O03_bars_seen_by_a_var_counter           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O04_bar_index_minus_counter_MUST_BE_MINU MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O05_bar_index_where_isfirst_was_true     MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O06_barssince_isfirst                    MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O07_first_bar_time_in_days               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O08_bar_index_mod_3                      MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O09_bar_index_gt_100                     MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    O10_distance_MUST_BE_5                   MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-origin-spy-1m-2026-10-02              AMEX:SPY 1M      11     MATCH             all 12 items agree
    O00_bar_index_CONTROL                    MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O01_last_bar_index                       MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O02_isfirst                              MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O03_bars_seen_by_a_var_counter           MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O04_bar_index_minus_counter_MUST_BE_MINU MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O05_bar_index_where_isfirst_was_true     MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O06_barssince_isfirst                    MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O07_first_bar_time_in_days               MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O08_bar_index_mod_3                      MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O09_bar_index_gt_100                     MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    O10_distance_MUST_BE_5                   MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bar-origin-spy-1w-2026-10-02              AMEX:SPY 1W      11     MATCH             all 12 items agree
    O00_bar_index_CONTROL                    MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O01_last_bar_index                       MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O02_isfirst                              MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O03_bars_seen_by_a_var_counter           MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O04_bar_index_minus_counter_MUST_BE_MINU MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O05_bar_index_where_isfirst_was_true     MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O06_barssince_isfirst                    MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O07_first_bar_time_in_days               MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O08_bar_index_mod_3                      MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O09_bar_index_gt_100                     MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    O10_distance_MUST_BE_5                   MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bgcolor-barcolor-spy-1d-2026-10-02        AMEX:SPY 1D      1      INCONCLUSIVE      1 of 3 items could not be compared
    control                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   INCONCLUSIVE  6 paints agree bar for bar; 1 paint withheld by name, not graded (first: barcolor plot_3 "O4" — `offset = na` on `barcolor`: where TradingView draws such a paint is not captured (O4 of tools/visual_conformance/probes/vw-bgcolor-barcolor.pine is painted over on every bar by a later `barcolor`))
vw-bgcolor-v4-default-spy-1d-2026-10-02      AMEX:SPY 1D      1      MATCH             all 3 items agree
    control                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         3 paints agree bar for bar
vw-bi-asin-spy-1d-2026-11-19                 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `math.asin` — did you mean `sin`?. This table declares abs, accum, accum2, accum3, accum4, acos, adx, alma, aroonDown, aroonUp, atan, atr, atrPine, avwap, barsAgo, barssince, bbw, boolNaWithheld, bop, cci, ceil, change, cos, crossOver, crossUnder, cum, cumFrom, dev, donchianLower, donchianMiddle, donchianUpper, ema, exp, falling, floor, highest, highestbars, hma, ichimokuChikou, ichimokuKijun, ichimokuSpanA, ichimokuSpanB, ichimokuTenkan, idiv, ln, log10, lowest, lowestbars, macd, max, median, mfi, mfiPine, min, minusDI, mod, na, nz, obvN, openingRangeHigh, openingRangeLow, percentileLinearInterpolation, percentileNearestRank, percentrank, pivothigh, pivotlow, plusDI, pow, pvtN, rci, rising, rma, round, rsi, sessionHigh, sessionLow, sessionOpen, sign, sin, sinh, sma, sqrt, stdev, stoch, stochPine, sum, tan, tieNewest, valuewhen, valuewhenOccurrence, vwap, vwapOf, williamsR, wma
vw-bi-correlation-v4-spy-1d-2026-11-19       AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:roundtrip): the translator wrote formula text it could not read back, so it emitted none
vw-bi-correlation-v6-spy-1d-2026-11-19       AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:roundtrip): the translator wrote formula text it could not read back, so it emitted none
vw-bi-dmi-rddt-1d-2026-11-19                 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:tuple): this Pine call answers with several values at once and a column carries one — `ta.dmi` smooths its ADX over the SECOND period and this table uses one period for both, so the two must agree
vw-bi-dmi-spy-1d-2026-11-19                  AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:tuple): this Pine call answers with several values at once and a column carries one — `ta.dmi` smooths its ADX over the SECOND period and this table uses one period for both, so the two must agree
vw-bi-pivot-point-levels-a-rddt-1d-2026-11-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `lv1` is read as an array here and nothing in this script creates it, so there are no slots to read
vw-bi-pivot-point-levels-a-spy-1d-2026-11-19 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `lv1` is read as an array here and nothing in this script creates it, so there are no slots to read
vw-bi-pivot-point-levels-b-rddt-1d-2026-11-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `lv1` is read as an array here and nothing in this script creates it, so there are no slots to read
vw-bi-pivot-point-levels-b-spy-1d-2026-11-19 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `lv1` is read as an array here and nothing in this script creates it, so there are no slots to read
vw-bi-session-isfirstbar-btcusd-60-2026-11-1 BITSTAMP:BTCUSD  0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `session.isfirstbar`
vw-bi-session-isfirstbar-spy-1d-2026-11-19   AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `session.isfirstbar`
vw-bi-session-isfirstbar-spy-5-2026-11-19    AMEX:SPY 5       0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `session.isfirstbar`
vw-bi-str-tonumber-spy-1d-2026-11-19         AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `str.tonumber`
vw-bi-time-close-2arg-spy-1d-2026-11-19      AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `time_close(<timeframe>)`: its timeframe does not fold to a literal this translation can read
vw-bi-time-close-2arg-spy-60-2026-11-19      AMEX:SPY 60      0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `time_close(<timeframe>)`: its timeframe does not fold to a literal this translation can read
vw-bi-time-d-extended-btcusd-60-2026-11-19   BITSTAMP:BTCUSD  0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `hour` with that argument. `hour(timenow)` -- this engine's answer for Pine's live wall clock, the newest fetched bar's own value -- translates, and so does `hour(time)`, which is this bar's own value. A different bar (`hour(time[1])`), a named timezone, and a computed timestamp are all real Pine and all currently refused as a function argument. TO UNBLOCK: read the bare `hour` (or `hour(time)`) for this bar's own value, or `hour(timenow)` for the newest fetched bar's.
vw-bi-time-d-extended-spy-60-2026-11-19      AMEX:SPY 60      0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `hour` with that argument. `hour(timenow)` -- this engine's answer for Pine's live wall clock, the newest fetched bar's own value -- translates, and so does `hour(time)`, which is this bar's own value. A different bar (`hour(time[1])`), a named timezone, and a computed timestamp are all real Pine and all currently refused as a function argument. TO UNBLOCK: read the bare `hour` (or `hour(time)`) for this bar's own value, or `hour(timenow)` for the newest fetched bar's.
vw-bi-weekofyear-spy-1d-2026-11-19           AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `weekofyear`
vw-bool-cast-spy-1d-2026-09-28               AMEX:SPY 1D      10     MATCH             all 11 items agree
    B00_bar_index_CONTROL                    MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B09_x_CLASS_1na_2zero_3value             MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B01_and                                  MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B02_not                                  MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B03_or                                   MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B04_ternary_test                         MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B05_if_else                              MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B06_valuewhen_condition_arg              MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B07_corpus_time_membership_first_bar     MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B08_t_is_na_CONTROL                      MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bool-cast-spy-60-2026-09-28               AMEX:SPY 60      10     MATCH             all 11 items agree
    B00_bar_index_CONTROL                    MATCH             cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B09_x_CLASS_1na_2zero_3value             MATCH             cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B01_and                                  MATCH             cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B02_not                                  MATCH             cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B03_or                                   MATCH             cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B04_ternary_test                         MATCH             cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B05_if_else                              MATCH             cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B06_valuewhen_condition_arg              MATCH             cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B07_corpus_time_membership_first_bar     MATCH             cmp 20616 ok 20616 warm 0/1 steady 0/20615 maxRel 0.00e+0
    B08_t_is_na_CONTROL                      MATCH             cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bool-cast-v4-spy-1d-2026-09-28            AMEX:SPY 1D      11     MATCH             all 12 items agree
    B00_bar_index_CONTROL                    MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B09_x_CLASS_1na_2zero_3value             MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B01_and                                  MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B02_not                                  MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B03_or                                   MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B04_ternary_test                         MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B05_if_else                              MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B06_valuewhen_condition_arg              MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B07_corpus_time_membership_first_bar     MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B10_iff_condition                        MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B08_t_is_na_CONTROL                      MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bool-cast-v4-spy-60-2026-09-28            AMEX:SPY 60      11     MATCH             all 12 items agree
    B00_bar_index_CONTROL                    MATCH             cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B09_x_CLASS_1na_2zero_3value             MATCH             cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B01_and                                  MATCH             cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B02_not                                  MATCH             cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B03_or                                   MATCH             cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B04_ternary_test                         MATCH             cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B05_if_else                              MATCH             cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B06_valuewhen_condition_arg              MATCH             cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B07_corpus_time_membership_first_bar     MATCH             cmp 20616 ok 20616 warm 0/1 steady 0/20615 maxRel 0.00e+0
    B10_iff_condition                        MATCH             cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    B08_t_is_na_CONTROL                      MATCH             cmp 20616 ok 20616 warm 0/0 steady 0/20616 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-bt-session-overnight-value-btcusd-1d-2026 BITSTAMP:BTCUSD  7      DIVERGE           HOUR: bar 0 t=1313625600 value vendor=0 ours=9
    V0_bar_index_CONTROL                     INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    HOUR                                     DIVERGE           cmp 5537 ok 0 warm 0/0 steady 5537/5537 maxRel 0.00e+0 — 5537 steady-state bars disagree; first at bar 0 (value: vendor 0 vs ours 9) — persistent, last at bar 5536
    MINUTE                                   DIVERGE           cmp 5537 ok 0 warm 0/0 steady 5537/5537 maxRel 0.00e+0 — 5537 steady-state bars disagree; first at bar 0 (value: vendor 0 vs ours 30) — persistent, last at bar 5536
    V1_secs_wrap_half_hour                   DIVERGE           cmp 5537 ok 0 warm 0/0 steady 5537/5537 maxRel 1.00e+0 — 5537 steady-state bars disagree; first at bar 0 (value: vendor -16200 vs ours -1) — persistent, last at bar 5536
    V2_secs_wrap_on_the_hour_CONTROL         DIVERGE           cmp 5537 ok 0 warm 0/0 steady 5537/5537 maxRel 1.00e+0 — 5537 steady-state bars disagree; first at bar 0 (value: vendor -21600 vs ours -1) — persistent, last at bar 5536
    V3_secs_whole_day_wrap                   DIVERGE           cmp 5537 ok 0 warm 0/0 steady 5537/5537 maxRel 1.36e+0 — 5537 steady-state bars disagree; first at bar 0 (value: vendor -25200 vs ours -59400) — persistent, last at bar 5536
    V4_secs_wrap_through_the_day             DIVERGE           cmp 5537 ok 0 warm 0/0 steady 5537/5537 maxRel 2.38e+0 — 5537 steady-state bars disagree; first at bar 0 (value: vendor -14400 vs ours -48600) — persistent, last at bar 5536
    objects                                  MATCH         neither side draws an object
vw-bt-session-overnight-value-btcusd-60-2026 BITSTAMP:BTCUSD  7      DIVERGE           HOUR: bar 0 t=1704067200 value vendor=0 ours=19
    V0_bar_index_CONTROL                     INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    HOUR                                     DIVERGE           cmp 25216 ok 0 warm 0/0 steady 25216/25216 maxRel 2.00e+1 — 25216 steady-state bars disagree; first at bar 0 (value: vendor 0 vs ours 19) — persistent, last at bar 25215
    MINUTE                                   MATCH             cmp 25216 ok 25216 warm 0/0 steady 0/25216 maxRel 0.00e+0
    V1_secs_wrap_half_hour                   DIVERGE           cmp 25216 ok 16139 warm 0/0 steady 9077/25216 maxRel 1.80e+3 — 9077 steady-state bars disagree; first at bar 0 (value: vendor -1800 vs ours -1) — scattered, last at bar 25204
    V2_secs_wrap_on_the_hour_CONTROL         DIVERGE           cmp 25216 ok 16137 warm 0/0 steady 9079/25216 maxRel 1.00e+0 — 9079 steady-state bars disagree; first at bar 2 (value: vendor -1 vs ours 0) — persistent, last at bar 25215
    V3_secs_whole_day_wrap                   MATCH             cmp 25216 ok 25216 warm 0/0 steady 0/25216 maxRel 0.00e+0
    V4_secs_wrap_through_the_day             DIVERGE           cmp 25216 ok 18913 warm 0/0 steady 6303/25216 maxRel 1.00e+0 — 6303 steady-state bars disagree; first at bar 0 (value: vendor 0 vs ours -1) — persistent, last at bar 25215
    objects                                  MATCH         neither side draws an object
vw-bt-session-to-midnight-daymask-btcusd-60- BITSTAMP:BTCUSD  5      DIVERGE           HOUR: bar 0 t=1704067200 value vendor=0 ours=19
    M0_bar_index_CONTROL                     INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    HOUR                                     DIVERGE           cmp 25216 ok 0 warm 0/0 steady 25216/25216 maxRel 2.00e+1 — 25216 steady-state bars disagree; first at bar 0 (value: vendor 0 vs ours 19) — persistent, last at bar 25215
    DOW_dayofweek                            DIVERGE           cmp 25216 ok 20677 warm 0/0 steady 4539/25216 maxRel 6.00e+0 — 4539 steady-state bars disagree; first at bar 0 (value: vendor 2 vs ours 1) — scattered, last at bar 25201
    M1_na_to_midnight_weekdays               DIVERGE           cmp 25216 ok 19218 warm 0/0 steady 5998/25216 maxRel 1.00e+0 — 5998 steady-state bars disagree; first at bar 20 (value: vendor 0 vs ours 1) — scattered, last at bar 25153
    M2_na_to_midnight_every_day_CONTROL      DIVERGE           cmp 25216 ok 16814 warm 0/0 steady 8402/25216 maxRel 1.00e+0 — 8402 steady-state bars disagree; first at bar 1 (value: vendor 1 vs ours 0) — scattered, last at bar 25201
    objects                                  MATCH         neither side draws an object
vw-bt-time-1440-spy-1d-2026-11-16            AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `time(<timeframe>, <session>)`: it is read here on the chart's OWN timeframe (`timeframe.period`), which is what the vendor was measured on. A different period groups the session into bars this chart does not have, and nothing measured says how.
vw-bt-time-1440-spy-60-2026-11-16            AMEX:SPY 60      0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `time(<timeframe>, <session>)`: it is read here on the chart's OWN timeframe (`timeframe.period`), which is what the vendor was measured on. A different period groups the session into bars this chart does not have, and nothing measured says how.
vw-bt-toradians-spy-1d-2026-11-16            AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `math.toradians`. This table declares abs, accum, accum2, accum3, accum4, acos, adx, alma, aroonDown, aroonUp, atan, atr, atrPine, avwap, barsAgo, barssince, bbw, boolNaWithheld, bop, cci, ceil, change, cos, crossOver, crossUnder, cum, cumFrom, dev, donchianLower, donchianMiddle, donchianUpper, ema, exp, falling, floor, highest, highestbars, hma, ichimokuChikou, ichimokuKijun, ichimokuSpanA, ichimokuSpanB, ichimokuTenkan, idiv, ln, log10, lowest, lowestbars, macd, max, median, mfi, mfiPine, min, minusDI, mod, na, nz, obvN, openingRangeHigh, openingRangeLow, percentileLinearInterpolation, percentileNearestRank, percentrank, pivothigh, pivotlow, plusDI, pow, pvtN, rci, rising, rma, round, rsi, sessionHigh, sessionLow, sessionOpen, sign, sin, sinh, sma, sqrt, stdev, stoch, stochPine, sum, tan, tieNewest, valuewhen, valuewhenOccurrence, vwap, vwapOf, williamsR, wma
vw-call-site-history-rddt-1d-2026-10-01      NYSE:RDDT 1D     21     INCONCLUSIVE      13 of 22 items could not be compared
    C01_highest10_cond                       INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (pine:block)
    C02_lowest10_cond                        INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out2 (pine:block)
    C03_sma3_cond                            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out3 (pine:block)
    C04_ema3_cond                            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out4 (pine:block)
    C05_local_x1_cond                        INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out5 (pine:block)
    C06_bar_index1_cond                      MATCH             cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    H01_param_src1_cond                      INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out7 (pine:block)
    H02_local_x1_cond                        INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out8 (pine:block)
    H03_sma3_cond                            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out9 (pine:block)
    H04_highest10_cond                       INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out10 (pine:block)
    H05_bar_index1_cond                      INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out11 (pine:block)
    H06_volume1_cond                         MATCH             cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    D01_highest3_even                        INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out13 (pine:block)
    D02_sma3_even                            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out14 (pine:block)
    D03_local_y1_even                        INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out15 (pine:block)
    E01_highest10_every_bar                  MATCH             cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    E02_lowest10_every_bar                   MATCH             cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    E03_sma3_every_bar                       MATCH             cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 1.32e-15
    E04_ema3_every_bar                       MATCH             cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    E05_local_every_bar                      MATCH             cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    E06_highest3_every_bar                   MATCH             cmp 635 ok 635 warm 0/0 steady 0/635 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 48 paired slots; coordinates are NOT compared by v1
vw-call-site-history-spy-1d-2026-10-01       AMEX:SPY 1D      21     INCONCLUSIVE      13 of 22 items could not be compared
    C01_highest10_cond                       INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (pine:block)
    C02_lowest10_cond                        INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out2 (pine:block)
    C03_sma3_cond                            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out3 (pine:block)
    C04_ema3_cond                            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out4 (pine:block)
    C05_local_x1_cond                        INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out5 (pine:block)
    C06_bar_index1_cond                      MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    H01_param_src1_cond                      INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out7 (pine:block)
    H02_local_x1_cond                        INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out8 (pine:block)
    H03_sma3_cond                            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out9 (pine:block)
    H04_highest10_cond                       INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out10 (pine:block)
    H05_bar_index1_cond                      INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out11 (pine:block)
    H06_volume1_cond                         MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D01_highest3_even                        INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out13 (pine:block)
    D02_sma3_even                            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out14 (pine:block)
    D03_local_y1_even                        INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out15 (pine:block)
    E01_highest10_every_bar                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E02_lowest10_every_bar                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E03_sma3_every_bar                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 1.40e-15
    E04_ema3_every_bar                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E05_local_every_bar                      MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E06_highest3_every_bar                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 48 paired slots; coordinates are NOT compared by v1
vw-cbc-history-reads-rddt-1d-2026-11-15      NYSE:RDDT 1D     10     INCONCLUSIVE      1 of 11 items could not be compared
    A00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_close_1                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A02_close_150                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A03_nz_close_100                         MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A04_highest_150                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A05_last_bar_index                       MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A06_isfirst                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A07_cum_one                              INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    A08_time_1                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A09_bar_index_1                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cbc-mbb-and-input-rddt-1d-2026-11-15      NYSE:RDDT 1D     3      MATCH             all 4 items agree
    A00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_close_300                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A02_sma_300                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cbc-security-rddt-1d-2026-11-15           NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (budget:lookback): this script is not drawn: its plot `S03_weekly_var_count` needs 1255 bars of history behind every bar, and one plot may reach back at most 960 here
vw-cbc-zero-rddt-1d-2026-11-15               NYSE:RDDT 1D     1      MATCH             all 2 items agree
    A00_bar_index                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-clock-close-tfchange-spy-1d-2026-09-28    AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `hour` with that argument. `hour(timenow)` -- this engine's answer for Pine's live wall clock, the newest fetched bar's own value -- translates, and so does `hour(time)`, which is this bar's own value. A different bar (`hour(time[1])`), a named timezone, and a computed timestamp are all real Pine and all currently refused as a function argument. TO UNBLOCK: read the bare `hour` (or `hour(time)`) for this bar's own value, or `hour(timenow)` for the newest fetched bar's.
vw-clock-close-tfchange-spy-1d-2026-09-28    AMEX:SPY 1W      0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `hour` with that argument. `hour(timenow)` -- this engine's answer for Pine's live wall clock, the newest fetched bar's own value -- translates, and so does `hour(time)`, which is this bar's own value. A different bar (`hour(time[1])`), a named timezone, and a computed timestamp are all real Pine and all currently refused as a function argument. TO UNBLOCK: read the bare `hour` (or `hour(time)`) for this bar's own value, or `hour(timenow)` for the newest fetched bar's.
vw-clock-vwap-spy-5-ext-2026-09-28           AMEX:SPY 5       15     INCONCLUSIVE      5 of 16 items could not be compared
    V00_bar_index_CONTROL                    INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    V01_year_time_minus_year_MUST_BE_0       MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    V02_month_time_minus_month_MUST_BE_0     MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    V03_dayofmonth_time_minus_bare_MUST_BE_0 MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    V04_dayofweek_time_minus_bare_MUST_BE_0  MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    V05_hour_time_minus_hour_MUST_BE_0       MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    V06_minute_time_minus_minute_MUST_BE_0   MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    V07_vwap_hlc3_minus_vwap_MUST_BE_0       INCONCLUSIVE      cmp 300 ok 300 warm 0/300 steady 0/0 maxRel 0.00e+0 — every compared bar is inside the warm-up region — nothing in steady state to judge
    V08_vwap_close_minus_vwap_CONTROL_NONZER INCONCLUSIVE      cmp 300 ok 191 warm 109/300 steady 0/0 maxRel 1.79e+1 — every compared bar is inside the warm-up region — nothing in steady state to judge
    V09_vwap_bare_RAW                        INCONCLUSIVE      cmp 300 ok 191 warm 109/300 steady 0/0 maxRel 9.78e-4 — every compared bar is inside the warm-up region — nothing in steady state to judge
    V10_vwap_hlc3_RAW                        INCONCLUSIVE      cmp 300 ok 191 warm 109/300 steady 0/0 maxRel 9.78e-4 — every compared bar is inside the warm-up region — nothing in steady state to judge
    V11_year_time_RAW                        MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    V12_dayofweek_time_RAW                   MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    V13_year_MUST_SPAN_TWO_VALUES            MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    V14_month_MUST_SPAN_SEVERAL_VALUES       MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-colour-components-spy-1d-2026-10-01       AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:colour-value): a colour cannot be a value in a screened column — `color.r`: its components are served for a fixed colour (a Pine colour name, a `#RRGGBB` or `#RRGGBBAA` literal, `color.rgb` of literals, an `input.color` of one), for `color.new` of one with a literal transparency or a per-bar one that stays within 0-100, for a ternary of two such colours, for `color.from_gradient` between two fixed colours, and for `color.new(<that gradient>, <literal>)` — the colours the `vw-gradient` and `vw-colour-components` captures measured. This one is none of those (a gradient between gradients and a colour returned by a user function are measured and not served)
vw-cond-window-extremes-rddt-1d-2026-10-02   NYSE:RDDT 1D     17     INCONCLUSIVE      7 of 18 items could not be compared
    X00_bar_index_CONTROL                    MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    X01_highest_bi_3_every_3rd               INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out2 (pine:block)
    X02_lowest_bi_3_every_3rd                INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out3 (pine:block)
    X03_lowest_bi_5_every_2nd                INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out4 (pine:block)
    X04_lowest_bi_3_up_bars                  INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out5 (pine:block)
    X05_highest_neg_bi_3_up_bars             INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out6 (pine:block)
    X06_lowest_3_onearg_every_3rd            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out7 (pine:block)
    X07_highest_3_onearg_every_3rd           INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out8 (pine:block)
    E01_highest_bi_3_every_bar               MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    E02_lowest_bi_3_every_bar                MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    E03_lowest_bi_5_every_bar                MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    E06_lowest_3_every_bar                   MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    E07_highest_3_every_bar                  MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    E08_low_CONTROL                          MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    E09_high_CONTROL                         MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    E10_up_bar_CONTROL                       MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    R01_bar_index_prev_run                   MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cond-window-extremes-spy-1d-2026-10-02    AMEX:SPY 1D      17     INCONCLUSIVE      7 of 18 items could not be compared
    X00_bar_index_CONTROL                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    X01_highest_bi_3_every_3rd               INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out2 (pine:block)
    X02_lowest_bi_3_every_3rd                INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out3 (pine:block)
    X03_lowest_bi_5_every_2nd                INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out4 (pine:block)
    X04_lowest_bi_3_up_bars                  INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out5 (pine:block)
    X05_highest_neg_bi_3_up_bars             INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out6 (pine:block)
    X06_lowest_3_onearg_every_3rd            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out7 (pine:block)
    X07_highest_3_onearg_every_3rd           INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out8 (pine:block)
    E01_highest_bi_3_every_bar               MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E02_lowest_bi_3_every_bar                MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E03_lowest_bi_5_every_bar                MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E06_lowest_3_every_bar                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E07_highest_3_every_bar                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E08_low_CONTROL                          MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E09_high_CONTROL                         MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    E10_up_bar_CONTROL                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    R01_bar_index_prev_run                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs1-bool-na-v2-rddt-1d-2026-11-14         NYSE:RDDT 1D     21     INCONCLUSIVE      4 of 22 items could not be compared
    A00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_na_s                                 MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A02_na_s_is_na                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B00_c                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B01_c_eq_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B02_c_ne_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B03_c_eq_true                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B04_not_c                                MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B05_c_and_true                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B06_c_or_true                            INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B07_c_and_false                          INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B08_c_or_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB00_c                                   MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB01_c_eq_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB02_c_ne_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB03_c_eq_true                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB04_not_c                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB05_c_and_true                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB06_c_or_true                           INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RB07_c_and_false                         INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RB08_c_or_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs1-bool-na-v4-rddt-1d-2026-11-14         NYSE:RDDT 1D     39     INCONCLUSIVE      22 of 40 items could not be compared
    A00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_na_s                                 MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A02_na_s_is_na                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B00_c                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B01_c_eq_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B02_c_ne_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B03_c_eq_true                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B04_not_c                                MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B05_c_and_true                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B06_c_or_true                            INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B07_c_and_false                          INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B08_c_or_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    N00_nb                                   INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    N01_nb_eq_false                          INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    N02_nb_ne_false                          INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    N03_nb_eq_true                           INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    N04_not_nb                               INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    N05_nb_and_true                          INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    N06_nb_or_true                           INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    N07_nb_and_false                         INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    N08_nb_or_false                          INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RB00_c                                   MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB01_c_eq_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB02_c_ne_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB03_c_eq_true                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB04_not_c                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB05_c_and_true                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB06_c_or_true                           INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RB07_c_and_false                         INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RB08_c_or_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RN00_nb                                  INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RN01_nb_eq_false                         INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RN02_nb_ne_false                         INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RN03_nb_eq_true                          INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RN04_not_nb                              INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RN05_nb_and_true                         INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RN06_nb_or_true                          INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RN07_nb_and_false                        INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RN08_nb_or_false                         INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-cs1-bool-na-v5-rddt-1d-2026-11-14         NYSE:RDDT 1D     39     INCONCLUSIVE      22 of 40 items could not be compared
    A00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_na_s                                 MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A02_na_s_is_na                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B00_c                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B01_c_eq_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B02_c_ne_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B03_c_eq_true                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B04_not_c                                MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B05_c_and_true                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B06_c_or_true                            INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B07_c_and_false                          INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B08_c_or_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    N00_nb                                   INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    N01_nb_eq_false                          INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    N02_nb_ne_false                          INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    N03_nb_eq_true                           INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    N04_not_nb                               INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    N05_nb_and_true                          INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    N06_nb_or_true                           INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    N07_nb_and_false                         INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    N08_nb_or_false                          INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RB00_c                                   MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB01_c_eq_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB02_c_ne_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB03_c_eq_true                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB04_not_c                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB05_c_and_true                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB06_c_or_true                           INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RB07_c_and_false                         INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RB08_c_or_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RN00_nb                                  INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RN01_nb_eq_false                         INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RN02_nb_ne_false                         INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RN03_nb_eq_true                          INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RN04_not_nb                              INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RN05_nb_and_true                         INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RN06_nb_or_true                          INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RN07_nb_and_false                        INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RN08_nb_or_false                         INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-cs1-calc-bars-rddt-1d-2026-11-14          NYSE:RDDT 1D     5      MATCH             all 6 items agree
    A00_bar_index                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_time_CONTROL                         MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A02_var_count                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A03_sma10                                MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A04_close                                MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs1-cell-positional-rddt-1d-2026-11-14    NYSE:RDDT 1D     1      MATCH             all 2 items agree
    A00_close_CONTROL                        MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 14 paired slots; coordinates are NOT compared by v1
vw-cs1-palette-v1-rddt-1d-2026-11-14         NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
vw-cs1-palette-v2-rddt-1d-2026-11-14         NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused: this script declares nothing a chart can draw
vw-cs1-rci-p1-rddt-1d-2026-11-14             NYSE:RDDT 1D     5      MATCH             all 6 items agree
    A00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_rci_close_10_CONTROL                 MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 1.58e-16
    P01_rci_sma5_10                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 3.14e-16
    P02_rci_flat_10                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    P03_flat_source                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs1-stoch-p2-rddt-1d-2026-11-14           NYSE:RDDT 1D     7      MATCH             all 8 items agree
    A00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_x                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A02_y                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    P01_stoch_xxx_10                         MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    P02_stoch_x_high_low_10                  MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    P03_stoch_yyy_10                         MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    P04_highest_x_10                         MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs1-ties-v4-rddt-1d-2026-11-14            NYSE:RDDT 1D     13     MATCH             all 14 items agree
    A00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_vt                                   MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A02_vt2                                  MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T01_highestbars_vt_4                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T02_lowestbars_vt_4                      MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T03_highestbars_vt2_4                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T04_lowestbars_vt2_4                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T05_highestbars_4                        MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T06_lowestbars_4                         MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T07_highestbars_high_4                   MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T08_lowestbars_low_4                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T09_high_eq_prev_high                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T10_highest_4                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs1-ties-v5-rddt-1d-2026-11-14            NYSE:RDDT 1D     13     MATCH             all 14 items agree
    A00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_vt                                   MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A02_vt2                                  MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T01_highestbars_vt_4                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T02_lowestbars_vt_4                      MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T03_highestbars_vt2_4                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T04_lowestbars_vt2_4                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T05_highestbars_4                        MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T06_lowestbars_4                         MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T07_highestbars_high_4                   MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T08_lowestbars_low_4                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T09_high_eq_prev_high                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T10_highest_4                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs1-transp-v1-rddt-1d-2026-11-14          NYSE:RDDT 1D     3      INCONCLUSIVE      1 of 5 items could not be compared
    P1_close_blue                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    P2_open_red                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    AR_arrow_aqua_fuchsia                    INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (withheld by name (pine:colour-unread) — the up and down colours of a `plotarrow` are not carried by this door yet)
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         1 paint agree bar for bar
vw-cs1-transp-v2-rddt-1d-2026-11-14          NYSE:RDDT 1D     3      INCONCLUSIVE      1 of 5 items could not be compared
    P1_close_blue                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    P2_open_red                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    AR_arrow_aqua_fuchsia                    INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (withheld by name (pine:colour-unread) — the up and down colours of a `plotarrow` are not carried by this door yet)
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         1 paint agree bar for bar
vw-cs1-transp-v3-rddt-1d-2026-11-14          NYSE:RDDT 1D     5      INCONCLUSIVE      1 of 7 items could not be compared
    P1_close_blue                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    P2_open_red                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    AR_arrow_aqua_fuchsia                    INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (withheld by name (pine:colour-unread) — the up and down colours of a `plotarrow` are not carried by this door yet)
    S1_columns_navy                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    S2_stepline_olive                        MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   MATCH         1 paint agree bar for bar
vw-cs2-bool-na-v1-cum-rddt-1d-2026-11-15     NYSE:RDDT 1D     25     INCONCLUSIVE      5 of 26 items could not be compared
    A00_bar_index_CONTROL                    INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    A01_na_s                                 MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A02_na_s_is_na                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B00_c                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B01_c_eq_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B02_c_ne_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B03_c_eq_true                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B04_not_c                                MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B05_c_and_true                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B06_c_or_true                            INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B07_c_and_false                          INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B08_c_or_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB00_c                                   MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB01_c_eq_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB02_c_ne_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB03_c_eq_true                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB04_not_c                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB05_c_and_true                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB06_c_or_true                           INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RB07_c_and_false                         INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RB08_c_or_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H00_cf_off1_and_x                        MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H01_cf_off1_and_x_raw                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H02_c_off1_ternary                       MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H03_c_off1                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs2-bool-na-v1-rddt-1d-2026-11-15         NYSE:RDDT 1D     25     INCONCLUSIVE      4 of 26 items could not be compared
    A00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_na_s                                 MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A02_na_s_is_na                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B00_c                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B01_c_eq_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B02_c_ne_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B03_c_eq_true                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B04_not_c                                MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B05_c_and_true                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B06_c_or_true                            INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B07_c_and_false                          INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B08_c_or_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB00_c                                   MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB01_c_eq_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB02_c_ne_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB03_c_eq_true                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB04_not_c                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB05_c_and_true                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB06_c_or_true                           INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RB07_c_and_false                         INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RB08_c_or_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H00_cf_off1_and_x                        MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H01_cf_off1_and_x_raw                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H02_c_off1_ternary                       MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H03_c_off1                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs2-bool-na-v3-cum-rddt-1d-2026-11-15     NYSE:RDDT 1D     25     INCONCLUSIVE      5 of 26 items could not be compared
    A00_bar_index_CONTROL                    INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    A01_na_s                                 MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A02_na_s_is_na                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B00_c                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B01_c_eq_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B02_c_ne_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B03_c_eq_true                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B04_not_c                                MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B05_c_and_true                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B06_c_or_true                            INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B07_c_and_false                          INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B08_c_or_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB00_c                                   MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB01_c_eq_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB02_c_ne_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB03_c_eq_true                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB04_not_c                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB05_c_and_true                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB06_c_or_true                           INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RB07_c_and_false                         INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RB08_c_or_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H00_cf_off1_and_x                        MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H01_cf_off1_and_x_raw                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H02_c_off1_ternary                       MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H03_c_off1                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs2-bool-na-v3-rddt-1d-2026-11-15         NYSE:RDDT 1D     25     INCONCLUSIVE      4 of 26 items could not be compared
    A00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_na_s                                 MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A02_na_s_is_na                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B00_c                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B01_c_eq_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B02_c_ne_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B03_c_eq_true                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B04_not_c                                MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B05_c_and_true                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B06_c_or_true                            INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B07_c_and_false                          INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    B08_c_or_false                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB00_c                                   MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB01_c_eq_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB02_c_ne_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB03_c_eq_true                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB04_not_c                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB05_c_and_true                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    RB06_c_or_true                           INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RB07_c_and_false                         INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    RB08_c_or_false                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H00_cf_off1_and_x                        MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H01_cf_off1_and_x_raw                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H02_c_off1_ternary                       MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H03_c_off1                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs2-highestbars-computed-v6-rddt-1d-2026- NYSE:RDDT 1D     5      MATCH             all 6 items agree
    B01_highestbars_vt_4                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B02_lowestbars_vt_4                      MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B03_highest_vt_4                         MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C01_vt                                   MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs2-holed-highest-stoch-v6-rddt-1d-2026-1 NYSE:RDDT 1D     5      MATCH             all 6 items agree
    H01_highest_x_10                         MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H02_lowest_x_10                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H03_stoch_x_10                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C01_x_holed                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs2-holed-highest-stoch-v6-spy-1d-2026-11 AMEX:SPY 1D      5      MATCH             all 6 items agree
    H01_highest_x_10                         MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    H02_lowest_x_10                          MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    H03_stoch_x_10                           MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    C01_x_holed                              MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    C00_bar_index_CONTROL                    MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs2-holed-highest-v5-rddt-1d-2026-11-15   NYSE:RDDT 1D     4      MATCH             all 5 items agree
    H01_highest_x_10                         MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H02_lowest_x_10                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C01_x_holed                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs2-holed-highest-v5-spy-1d-2026-11-15    AMEX:SPY 1D      4      MATCH             all 5 items agree
    H01_highest_x_10                         MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    H02_lowest_x_10                          MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    C01_x_holed                              MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    C00_bar_index_CONTROL                    MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs2-holed-highest-v6-rddt-1d-2026-11-15   NYSE:RDDT 1D     4      MATCH             all 5 items agree
    H01_highest_x_10                         MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    H02_lowest_x_10                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C01_x_holed                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs2-holed-highest-v6-spy-1d-2026-11-15    AMEX:SPY 1D      4      MATCH             all 5 items agree
    H01_highest_x_10                         MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    H02_lowest_x_10                          MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    C01_x_holed                              MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    C00_bar_index_CONTROL                    MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs2-holed-highestbars-rddt-1d-2026-11-15  NYSE:RDDT 1D     8      MATCH             all 9 items agree
    A00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_x_is_na                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B00_highestbars_x_10                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B01_lowestbars_x_10                      MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    W00_highest_close_10                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    W01_lowest_close_10                      MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    W02_highestbars_close_10                 MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    W03_lowestbars_close_10                  MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs2-label-format-rddt-1d-2026-11-15       NYSE:RDDT 1D     2      MATCH             all 3 items agree
    A00_close                                MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_close_over_3                         MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 12 paired slots; coordinates are NOT compared by v1
vw-cs2-label-format-v5-helper-rddt-1d-2026-1 NYSE:RDDT 1D     2      MATCH             all 3 items agree
    A00_close                                MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_close_over_3                         MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 12 paired slots; coordinates are NOT compared by v1
vw-cs2-label-format-v6-direct-rddt-1d-2026-1 NYSE:RDDT 1D     2      MATCH             all 3 items agree
    A00_close                                MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_close_over_3                         MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 12 paired slots; coordinates are NOT compared by v1
vw-cs2-label-number-format-rddt-1d-2026-11-1 NYSE:RDDT 1D     1      MATCH             all 2 items agree
    C01_close_CONTROL                        MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 13 paired slots; coordinates are NOT compared by v1
vw-cs2-rising-falling-na-v4-rddt-1d-2026-11- NYSE:RDDT 1D     8      MATCH             all 9 items agree
    A00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_s_is_na                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    R01_rising_1                             MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    F01_falling_1                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    R02_rising_2                             MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    F02_falling_2                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    R05_rising_5                             MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    F05_falling_5                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs2-rising-falling-na-v5-rddt-1d-2026-11- NYSE:RDDT 1D     8      MATCH             all 9 items agree
    A00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_s_is_na                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    R01_rising_1                             MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    F01_falling_1                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    R02_rising_2                             MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    F02_falling_2                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    R05_rising_5                             MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    F05_falling_5                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs2-sma-exact-tie-rddt-1d-2026-11-15      NYSE:RDDT 1D     6      MATCH             all 7 items agree
    T01_sma5_equals_prev                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T02_sma5                                 MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T03_sma5_of_close_1                      MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T04_difference                           MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T05_sum5                                 MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C01_close_CONTROL                        MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs2-sma-exact-tie-spy-1d-2026-11-15       AMEX:SPY 1D      6      MATCH             all 7 items agree
    T01_sma5_equals_prev                     MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    T02_sma5                                 MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    T03_sma5_of_close_1                      MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    T04_difference                           MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    T05_sum5                                 MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    C01_close_CONTROL                        MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs2-stoch-flat-rddt-1d-2026-11-15         NYSE:RDDT 1D     8      MATCH             all 9 items agree
    A00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_x                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    S00_stoch_x                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    S01_ema_stoch_x                          MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 2.88e-16
    S02_stoch_x2_ramp                        MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    S03_ema_stoch_x2                         MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 2.88e-16
    S04_stoch_y_holed                        MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    S05_stoch_x_is_na                        MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs2-stoch-flat-window-rddt-1d-2026-11-15  NYSE:RDDT 1D     11     MATCH             all 12 items agree
    K01_stoch_x                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    K02_ema3_stoch_x                         MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 2.88e-16
    K03_stoch_ramp_up                        MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    K04_ema3_stoch_ramp_up                   MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 2.88e-16
    K05_stoch_dip_rebound                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    K06_ema3_stoch_dip_rebound               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 2.88e-16
    K07_stoch_y_hole_at_215                  MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C01_x                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C02_xr                                   MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C03_xd                                   MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-cs2-v4-ternary-lazy-rddt-1d-2026-11-15    NYSE:RDDT 1D     8      INCONCLUSIVE      3 of 9 items could not be compared
    A00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_up                                   MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    T00_up_sma_else_close                    INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out3 (pine:block)
    T01_up_barssince_else_na                 INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out4 (pine:block)
    T02_up_helper_sma_else_close             INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out5 (pine:block)
    C00_iff_up_sma_close                     MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    E00_sma_eager                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    E01_barssince_eager                      MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-deadband-ticks-aapl-1d-2026-09-28         NASDAQ:AAPL 1D   0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `dbhf` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total
vw-deadband-ticks-brk-a-1d-2026-09-28        NYSE:BRK.A 1D    0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `dbhf` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total
vw-deadband-ticks-brk-a-1d-2026-11-15        NYSE:BRK.A 1D    0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `dbhf` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total
vw-deadband-ticks-spy-1d-2026-09-28          AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `dbhf` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total
vw-default-param-spy-1d-2026-10-02           AMEX:SPY 1D      16     MATCH             all 17 items agree
    D00_bar_index_CONTROL                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D01_number_omitted                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D02_number_written                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D03_negative_omitted                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D04_negative_written                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D05_bool_omitted                         MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D06_bool_written                         MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D07_string_omitted                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D08_string_written                       MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D09_na_omitted                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D10_na_written                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D11_two_defaults_none_given              MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D12_two_defaults_written                 MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D13_two_defaults_first_given             MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D14_two_defaults_first_given_written     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    D15_pairs_that_differ_MUST_BE_0          MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-draw-count-at-cap-rddt-1d-2026-11-16      NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `boxesMade` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total. THIS ENGINE DOES DECLARE A BOUNDED FORM: `cumFrom(<that value>, <anchor>, <bars>)` — the same running total with the starting instant STATED. Stating the window is what makes the answer the same tomorrow — an all-time value moves with however many bars were fetched.
vw-draw-count-at-cap-spy-1d-2026-11-16       AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `boxesMade` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total. THIS ENGINE DOES DECLARE A BOUNDED FORM: `cumFrom(<that value>, <anchor>, <bars>)` — the same running total with the starting instant STATED. Stating the window is what makes the answer the same tomorrow — an all-time value moves with however many bars were fetched.
vw-fcmp-arrays-rddt-1d-2026-11-18            NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `array.lastindexof`
vw-fcmp-arrays-spy-1d-2026-11-18             AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `array.lastindexof`
vw-fcmp-builtins-rddt-1d-2026-11-18          NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `this name` is read as an array here and nothing in this script creates it, so there are no slots to read
vw-fcmp-builtins-spy-1d-2026-11-18           AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `this name` is read as an array here and nothing in this script creates it, so there are no slots to read
vw-fcmp-builtins-v2-rddt-1d-2026-11-18       NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `this name` is read as an array here and nothing in this script creates it, so there are no slots to read
vw-fcmp-builtins-v2-spy-1d-2026-11-18        AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `this name` is read as an array here and nothing in this script creates it, so there are no slots to read
vw-fcmp-const-v4-spy-1d-2026-11-18           AMEX:SPY 1D      15     INCONCLUSIVE      10 of 16 items could not be compared
    C00_bar_index_CONTROL                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    C01_literals                             INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C02_named_consts                         INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C03_literal_sum                          INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C04_named_sum                            INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C05_input_literal                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    C06_input_input                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    C07_const_series                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    C08_series_series_CONTROL                MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    C09_reassigned                           INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C10_function_result                      INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C11_ternary_of_consts                    INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C12_int_vs_float                         INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C13_tie_literals                         INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C14_tie_inline                           INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-fcmp-const-v5-spy-1d-2026-11-18           AMEX:SPY 1D      15     INCONCLUSIVE      10 of 16 items could not be compared
    C00_bar_index_CONTROL                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    C01_literals                             INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C02_named_consts                         INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C03_literal_sum                          INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C04_named_sum                            INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C05_input_literal                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    C06_input_input                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    C07_const_series                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    C08_series_series_CONTROL                MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    C09_reassigned                           INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C10_function_result                      INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C11_ternary_of_consts                    INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C12_int_vs_float                         INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C13_tie_literals                         INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    C14_tie_inline                           INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-fcmp-form-rddt-1d-2026-11-18              NYSE:RDDT 1D     51     INCONCLUSIVE      2 of 52 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T01_ctl_eq                               MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T02_ctl_lt                               MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T03_ctl_gt                               MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T04_center_1e-13                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T05_center_1e-12                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T06_center_1e-11                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T07_center_1e-10                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T08_center_3e-10                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T09_center_4.9e-10                       MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T10_center_5.1e-10                       MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T11_center_9e-10                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T12_center_1.4e-9                        MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T13_center_1e-8                          MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T14_edge_0491                            MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T15_edge_0495                            MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T16_edge_0499                            MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T17_edge_0501                            MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T18_edge_051                             MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T19_edge_059                             MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T20_straddle_1                           MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T21_straddle_1_rev                       MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T22_straddle_0.09                        MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T23_straddle_100                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T24_neg_bucket                           MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T25_neg_straddle                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T26_neg_across                           MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T27_zero_p4e-10                          MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T28_zero_m4e-10                          MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T29_m4e-10_p4e-10                        MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T30_zero_p6e-10                          MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T31_tiny_zero                            MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T32_half_1.0000000025                    MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T33_half_1.0000000075                    MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T34_half_1.0000000015                    MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T35_half_1.0000000005                    MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T36_half_-1.0000000005                   MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T37_half_0.0000000005                    MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T38_half_-0.0000000005                   MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T39_half_2.0000000035                    MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T40_int1_f1.0000000003                   MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T41_int1_f0.9999999997                   MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T42_int1_f1.0000000006                   MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T43_f1.0000000003_int1                   MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T44_int7_int7_CONTROL                    MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T45_naf_naf                              MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T46_naf_1                                MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T47_1_naf                                MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T48_nai_nai                              MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T49_const_center_3e-10                   INCONCLUSIVE      cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T50_const_straddle_1                     INCONCLUSIVE      cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-fcmp-form-spy-1d-2026-11-18               AMEX:SPY 1D      51     INCONCLUSIVE      2 of 52 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T01_ctl_eq                               MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T02_ctl_lt                               MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T03_ctl_gt                               MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T04_center_1e-13                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T05_center_1e-12                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T06_center_1e-11                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T07_center_1e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T08_center_3e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T09_center_4.9e-10                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T10_center_5.1e-10                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T11_center_9e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T12_center_1.4e-9                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T13_center_1e-8                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T14_edge_0491                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T15_edge_0495                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T16_edge_0499                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T17_edge_0501                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T18_edge_051                             MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T19_edge_059                             MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T20_straddle_1                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T21_straddle_1_rev                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T22_straddle_0.09                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T23_straddle_100                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T24_neg_bucket                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T25_neg_straddle                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T26_neg_across                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T27_zero_p4e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T28_zero_m4e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T29_m4e-10_p4e-10                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T30_zero_p6e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T31_tiny_zero                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T32_half_1.0000000025                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T33_half_1.0000000075                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T34_half_1.0000000015                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T35_half_1.0000000005                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T36_half_-1.0000000005                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T37_half_0.0000000005                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T38_half_-0.0000000005                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T39_half_2.0000000035                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T40_int1_f1.0000000003                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T41_int1_f0.9999999997                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T42_int1_f1.0000000006                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T43_f1.0000000003_int1                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T44_int7_int7_CONTROL                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T45_naf_naf                              MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T46_naf_1                                MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T47_1_naf                                MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T48_nai_nai                              MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T49_const_center_3e-10                   INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T50_const_straddle_1                     INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-fcmp-form-v1-spy-1d-2026-11-18            AMEX:SPY 1D      51     INCONCLUSIVE      2 of 52 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T01_ctl_eq                               MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T02_ctl_lt                               MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T03_ctl_gt                               MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T04_center_1e-13                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T05_center_1e-12                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T06_center_1e-11                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T07_center_1e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T08_center_3e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T09_center_4.9e-10                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T10_center_5.1e-10                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T11_center_9e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T12_center_1.4e-9                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T13_center_1e-8                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T14_edge_0491                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T15_edge_0495                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T16_edge_0499                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T17_edge_0501                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T18_edge_051                             MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T19_edge_059                             MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T20_straddle_1                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T21_straddle_1_rev                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T22_straddle_0.09                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T23_straddle_100                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T24_neg_bucket                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T25_neg_straddle                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T26_neg_across                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T27_zero_p4e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T28_zero_m4e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T29_m4e-10_p4e-10                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T30_zero_p6e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T31_tiny_zero                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T32_half_1.0000000025                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T33_half_1.0000000075                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T34_half_1.0000000015                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T35_half_1.0000000005                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T36_half_-1.0000000005                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T37_half_0.0000000005                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T38_half_-0.0000000005                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T39_half_2.0000000035                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T40_int1_f1.0000000003                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T41_int1_f0.9999999997                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T42_int1_f1.0000000006                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T43_f1.0000000003_int1                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T44_int7_int7_CONTROL                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T45_naf_naf                              MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T46_naf_1                                MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T47_1_naf                                MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T48_nai_nai                              MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T49_const_center_3e-10                   INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T50_const_straddle_1                     INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-fcmp-form-v2-spy-1d-2026-11-18            AMEX:SPY 1D      51     INCONCLUSIVE      2 of 52 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T01_ctl_eq                               MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T02_ctl_lt                               MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T03_ctl_gt                               MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T04_center_1e-13                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T05_center_1e-12                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T06_center_1e-11                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T07_center_1e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T08_center_3e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T09_center_4.9e-10                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T10_center_5.1e-10                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T11_center_9e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T12_center_1.4e-9                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T13_center_1e-8                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T14_edge_0491                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T15_edge_0495                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T16_edge_0499                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T17_edge_0501                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T18_edge_051                             MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T19_edge_059                             MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T20_straddle_1                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T21_straddle_1_rev                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T22_straddle_0.09                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T23_straddle_100                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T24_neg_bucket                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T25_neg_straddle                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T26_neg_across                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T27_zero_p4e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T28_zero_m4e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T29_m4e-10_p4e-10                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T30_zero_p6e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T31_tiny_zero                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T32_half_1.0000000025                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T33_half_1.0000000075                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T34_half_1.0000000015                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T35_half_1.0000000005                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T36_half_-1.0000000005                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T37_half_0.0000000005                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T38_half_-0.0000000005                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T39_half_2.0000000035                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T40_int1_f1.0000000003                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T41_int1_f0.9999999997                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T42_int1_f1.0000000006                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T43_f1.0000000003_int1                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T44_int7_int7_CONTROL                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T45_naf_naf                              MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T46_naf_1                                MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T47_1_naf                                MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T48_nai_nai                              MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T49_const_center_3e-10                   INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T50_const_straddle_1                     INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-fcmp-form-v3-spy-1d-2026-11-18            AMEX:SPY 1D      51     INCONCLUSIVE      2 of 52 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T01_ctl_eq                               MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T02_ctl_lt                               MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T03_ctl_gt                               MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T04_center_1e-13                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T05_center_1e-12                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T06_center_1e-11                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T07_center_1e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T08_center_3e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T09_center_4.9e-10                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T10_center_5.1e-10                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T11_center_9e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T12_center_1.4e-9                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T13_center_1e-8                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T14_edge_0491                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T15_edge_0495                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T16_edge_0499                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T17_edge_0501                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T18_edge_051                             MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T19_edge_059                             MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T20_straddle_1                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T21_straddle_1_rev                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T22_straddle_0.09                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T23_straddle_100                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T24_neg_bucket                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T25_neg_straddle                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T26_neg_across                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T27_zero_p4e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T28_zero_m4e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T29_m4e-10_p4e-10                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T30_zero_p6e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T31_tiny_zero                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T32_half_1.0000000025                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T33_half_1.0000000075                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T34_half_1.0000000015                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T35_half_1.0000000005                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T36_half_-1.0000000005                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T37_half_0.0000000005                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T38_half_-0.0000000005                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T39_half_2.0000000035                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T40_int1_f1.0000000003                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T41_int1_f0.9999999997                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T42_int1_f1.0000000006                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T43_f1.0000000003_int1                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T44_int7_int7_CONTROL                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T45_naf_naf                              MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T46_naf_1                                MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T47_1_naf                                MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T48_nai_nai                              MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T49_const_center_3e-10                   INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T50_const_straddle_1                     INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-fcmp-form-v4-rddt-1d-2026-11-18           NYSE:RDDT 1D     51     INCONCLUSIVE      2 of 52 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T01_ctl_eq                               MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T02_ctl_lt                               MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T03_ctl_gt                               MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T04_center_1e-13                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T05_center_1e-12                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T06_center_1e-11                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T07_center_1e-10                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T08_center_3e-10                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T09_center_4.9e-10                       MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T10_center_5.1e-10                       MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T11_center_9e-10                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T12_center_1.4e-9                        MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T13_center_1e-8                          MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T14_edge_0491                            MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T15_edge_0495                            MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T16_edge_0499                            MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T17_edge_0501                            MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T18_edge_051                             MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T19_edge_059                             MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T20_straddle_1                           MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T21_straddle_1_rev                       MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T22_straddle_0.09                        MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T23_straddle_100                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T24_neg_bucket                           MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T25_neg_straddle                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T26_neg_across                           MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T27_zero_p4e-10                          MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T28_zero_m4e-10                          MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T29_m4e-10_p4e-10                        MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T30_zero_p6e-10                          MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T31_tiny_zero                            MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T32_half_1.0000000025                    MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T33_half_1.0000000075                    MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T34_half_1.0000000015                    MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T35_half_1.0000000005                    MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T36_half_-1.0000000005                   MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T37_half_0.0000000005                    MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T38_half_-0.0000000005                   MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T39_half_2.0000000035                    MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T40_int1_f1.0000000003                   MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T41_int1_f0.9999999997                   MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T42_int1_f1.0000000006                   MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T43_f1.0000000003_int1                   MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T44_int7_int7_CONTROL                    MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T45_naf_naf                              MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T46_naf_1                                MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T47_1_naf                                MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T48_nai_nai                              MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    T49_const_center_3e-10                   INCONCLUSIVE      cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T50_const_straddle_1                     INCONCLUSIVE      cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-fcmp-form-v4-spy-1d-2026-11-18            AMEX:SPY 1D      51     INCONCLUSIVE      2 of 52 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T01_ctl_eq                               MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T02_ctl_lt                               MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T03_ctl_gt                               MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T04_center_1e-13                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T05_center_1e-12                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T06_center_1e-11                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T07_center_1e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T08_center_3e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T09_center_4.9e-10                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T10_center_5.1e-10                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T11_center_9e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T12_center_1.4e-9                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T13_center_1e-8                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T14_edge_0491                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T15_edge_0495                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T16_edge_0499                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T17_edge_0501                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T18_edge_051                             MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T19_edge_059                             MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T20_straddle_1                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T21_straddle_1_rev                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T22_straddle_0.09                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T23_straddle_100                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T24_neg_bucket                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T25_neg_straddle                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T26_neg_across                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T27_zero_p4e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T28_zero_m4e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T29_m4e-10_p4e-10                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T30_zero_p6e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T31_tiny_zero                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T32_half_1.0000000025                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T33_half_1.0000000075                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T34_half_1.0000000015                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T35_half_1.0000000005                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T36_half_-1.0000000005                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T37_half_0.0000000005                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T38_half_-0.0000000005                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T39_half_2.0000000035                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T40_int1_f1.0000000003                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T41_int1_f0.9999999997                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T42_int1_f1.0000000006                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T43_f1.0000000003_int1                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T44_int7_int7_CONTROL                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T45_naf_naf                              MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T46_naf_1                                MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T47_1_naf                                MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T48_nai_nai                              MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T49_const_center_3e-10                   INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T50_const_straddle_1                     INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-fcmp-form-v5-spy-1d-2026-11-18            AMEX:SPY 1D      51     INCONCLUSIVE      2 of 52 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T01_ctl_eq                               MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T02_ctl_lt                               MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T03_ctl_gt                               MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T04_center_1e-13                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T05_center_1e-12                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T06_center_1e-11                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T07_center_1e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T08_center_3e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T09_center_4.9e-10                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T10_center_5.1e-10                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T11_center_9e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T12_center_1.4e-9                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T13_center_1e-8                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T14_edge_0491                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T15_edge_0495                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T16_edge_0499                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T17_edge_0501                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T18_edge_051                             MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T19_edge_059                             MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T20_straddle_1                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T21_straddle_1_rev                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T22_straddle_0.09                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T23_straddle_100                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T24_neg_bucket                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T25_neg_straddle                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T26_neg_across                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T27_zero_p4e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T28_zero_m4e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T29_m4e-10_p4e-10                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T30_zero_p6e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T31_tiny_zero                            MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T32_half_1.0000000025                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T33_half_1.0000000075                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T34_half_1.0000000015                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T35_half_1.0000000005                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T36_half_-1.0000000005                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T37_half_0.0000000005                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T38_half_-0.0000000005                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T39_half_2.0000000035                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T40_int1_f1.0000000003                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T41_int1_f0.9999999997                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T42_int1_f1.0000000006                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T43_f1.0000000003_int1                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T44_int7_int7_CONTROL                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T45_naf_naf                              MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T46_naf_1                                MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T47_1_naf                                MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T48_nai_nai                              MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    T49_const_center_3e-10                   INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T50_const_straddle_1                     INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-fcmp-magnitude-rddt-1d-2026-11-18         NYSE:RDDT 1D     35     MATCH             all 36 items agree
    M00_bar_index_CONTROL                    MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M01_M1e-12_16ulp                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M02_M1e-12_3e-10                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M03_M1e-12_7e-10                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M04_M1e-10_16ulp                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M05_M1e-10_3e-10                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M06_M1e-10_7e-10                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M07_M1e-9_16ulp                          MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M08_M1e-9_3e-10                          MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M09_M1e-9_7e-10                          MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M10_M1e-6_16ulp                          MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M11_M1e-6_3e-10                          MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M12_M1e-6_7e-10                          MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M13_M0.001_16ulp                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M14_M0.001_3e-10                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M15_M0.001_7e-10                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M16_M1000.0_16ulp                        MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M17_M1000.0_3e-10                        MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M18_M1000.0_7e-10                        MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M19_M1000000.0_16ulp                     MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M20_M1000000.0_3e-10                     MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M21_M1000000.0_7e-10                     MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M22_M10000000.0_16ulp                    MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M23_M1000000000.0_16ulp                  MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M24_M10000000.0_1e-6                     MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M25_M1000000000.0_1e-6                   MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M26_M10000000.0_1ulp                     MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M27_M123456789.123_1ulp                  MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M28_M1000000000.0_1ulp                   MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M29_mulmerge_1e7                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M30_mulmerge_1.2e8                       MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M31_mulmerge_1e9                         MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M32_dmi_moves_x1.0                       MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M33_dmi_moves_x1e6                       MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    M34_dmi_moves_x1e-8                      MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-fcmp-magnitude-spy-1d-2026-11-18          AMEX:SPY 1D      35     MATCH             all 36 items agree
    M00_bar_index_CONTROL                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M01_M1e-12_16ulp                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M02_M1e-12_3e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M03_M1e-12_7e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M04_M1e-10_16ulp                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M05_M1e-10_3e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M06_M1e-10_7e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M07_M1e-9_16ulp                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M08_M1e-9_3e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M09_M1e-9_7e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M10_M1e-6_16ulp                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M11_M1e-6_3e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M12_M1e-6_7e-10                          MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M13_M0.001_16ulp                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M14_M0.001_3e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M15_M0.001_7e-10                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M16_M1000.0_16ulp                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M17_M1000.0_3e-10                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M18_M1000.0_7e-10                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M19_M1000000.0_16ulp                     MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M20_M1000000.0_3e-10                     MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M21_M1000000.0_7e-10                     MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M22_M10000000.0_16ulp                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M23_M1000000000.0_16ulp                  MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M24_M10000000.0_1e-6                     MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M25_M1000000000.0_1e-6                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M26_M10000000.0_1ulp                     MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M27_M123456789.123_1ulp                  MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M28_M1000000000.0_1ulp                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M29_mulmerge_1e7                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M30_mulmerge_1.2e8                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M31_mulmerge_1e9                         MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M32_dmi_moves_x1.0                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M33_dmi_moves_x1e6                       MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    M34_dmi_moves_x1e-8                      MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-float-compare-tolerance-rddt-1d-2026-11-1 NYSE:RDDT 1D     13     INCONCLUSIVE      6 of 14 items could not be compared
    F00_bar_index_CONTROL                    MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    F01_sum_eq_point3                        INCONCLUSIVE      cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    F02_sum_gt_point3                        INCONCLUSIVE      cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    F03_y_gt_x_3e-14                         INCONCLUSIVE      cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    F04_y_eq_x_3e-14                         INCONCLUSIVE      cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    F05_up_gt_down                           MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    F06_up_lt_down                           MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    F07_up_eq_down                           MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    F08_up_minus_down                        MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    F09_up                                   MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    F10_down                                 MATCH             cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0
    F11_tie_literals_gt                      INCONCLUSIVE      cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    F12_tie_literals_eq                      INCONCLUSIVE      cmp 668 ok 668 warm 0/0 steady 0/668 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-float-compare-tolerance-spy-1d-2026-11-18 AMEX:SPY 1D      13     INCONCLUSIVE      6 of 14 items could not be compared
    F00_bar_index_CONTROL                    MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    F01_sum_eq_point3                        INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    F02_sum_gt_point3                        INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    F03_y_gt_x_3e-14                         INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    F04_y_eq_x_3e-14                         INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    F05_up_gt_down                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    F06_up_lt_down                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    F07_up_eq_down                           MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    F08_up_minus_down                        MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    F09_up                                   MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    F10_down                                 MATCH             cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0
    F11_tie_literals_gt                      INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    F12_tie_literals_eq                      INCONCLUSIVE      cmp 8509 ok 8509 warm 0/0 steady 0/8509 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-fmt-tie-readings-rddt-1d-2026-11-15       NYSE:RDDT 1D     0      DIVERGE           1 of 1 compared items diverge
    objects                                  DIVERGE       1 object families differ (count or text); colours agree on 50 paired slots; coordinates are NOT compared by v1
vw-fn-history-in-if-v2-rddt-1d-2026-11-15    NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:fn-history-in-block): a script function reads a chart series at a bar offset and is called inside a block that does not run on every bar; in Pine v2 and v3 that read is a copy the function keeps of the series, repeating its last value on bars the call does not run (captures `vw-fn-history-in-if-v2` / `-v3`; v1 does not compile an `if`, s24), which this lane does not compute — `f2`
vw-fn-history-in-if-v3-rddt-1d-2026-11-15    NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:fn-history-in-block): a script function reads a chart series at a bar offset and is called inside a block that does not run on every bar; in Pine v2 and v3 that read is a copy the function keeps of the series, repeating its last value on bars the call does not run (captures `vw-fn-history-in-if-v2` / `-v3`; v1 does not compile an `if`, s24), which this lane does not compute — `f2`
vw-fn-history-in-if-v4-rddt-1d-2026-11-15    NYSE:RDDT 1D     7      INCONCLUSIVE      2 of 8 items could not be compared
    T                                        INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    A_f2_in_if                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B_f1_in_if                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C_high2_EVERY_BAR                        MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    D_high3_CARRY                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    E_high6_SKIP                             MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    BI                                       INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-fn-history-in-if-v5-rddt-1d-2026-11-15    NYSE:RDDT 1D     7      INCONCLUSIVE      2 of 8 items could not be compared
    T                                        INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    A_f2_in_if                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B_f1_in_if                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C_high2_EVERY_BAR                        MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    D_high3_CARRY                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    E_high6_SKIP                             MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    BI                                       INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-fn-history-in-tern-v1-rddt-1d-2026-11-15  NYSE:RDDT 1D     7      INCONCLUSIVE      2 of 8 items could not be compared
    T                                        INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    A_f2_in_if                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B_f1_in_if                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C_high2_EVERY_BAR                        MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    D_high3_CARRY                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    E_high6_SKIP                             MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    BI                                       INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-fn-history-in-tern-v3-rddt-1d-2026-11-15  NYSE:RDDT 1D     7      INCONCLUSIVE      2 of 8 items could not be compared
    T                                        INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    A_f2_in_if                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B_f1_in_if                               MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C_high2_EVERY_BAR                        MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    D_high3_CARRY                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    E_high6_SKIP                             MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    BI                                       INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-fn-series-history-rddt-1d-2026-09-30      NYSE:RDDT 1D     4      MATCH             all 5 items agree
    E01_local_every_bar                      MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    E02_param_every_bar                      MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    E03_sma_every_bar                        MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 1.32e-15
    E04_highest_every_bar                    MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 50 paired slots; coordinates are NOT compared by v1
vw-forin-collections-2-rddt-1d-2026-10-02    NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `G01` — and the fold stopped before it, at line 46: a Pine block spans several statements and this engine stores a single expression — `for`
vw-forin-collections-rddt-1d-2026-10-01      NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `F01` — and the fold stopped before it, at line 63: a Pine block spans several statements and this engine stores a single expression — `for`
vw-getter-history-2-spy-1d-2026-10-02        AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:drawing): a drawing object paints on a chart and answers with no number — `line.get_y1`
vw-getter-history-spy-1d-2026-10-01          AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:drawing): a drawing object paints on a chart and answers with no number — `line.get_y1`
vw-gradient-edges-spy-1d-2026-10-02          AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:colour-value): a colour cannot be a value in a screened column — `color.from_gradient`
vw-gradient-spy-1d-2026-09-30                AMEX:SPY 1D      23     INCONCLUSIVE      6 of 24 items could not be compared
    G00_bar_index_CONTROL                    MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G01_v                                    MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G02_g1_r                                 MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G03_g1_g                                 MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G04_g1_b                                 MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G05_g1_t                                 MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G06_w                                    MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G07_g2_r_clamp                           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G08_g2_g_clamp                           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G09_g2_b_clamp                           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G10_g2_t_clamp                           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G11_g3_r_new30                           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G12_g3_g_new30                           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G13_g3_b_new30                           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G14_g3_t_new30                           INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    G15_g4_t_interp_0_to_100                 MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G16_g4_r                                 MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    G17_new_red_70p5_t                       INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    G18_new_red_70p5_r                       INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    G19_new_0064C8_70p5_t                    INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    G20_new_0064C8_70p4_t                    INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    G21_cA_t_CONTROL                         INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    G22_drawn_in_g1                          MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-h4-loops-rddt-1d-2026-10-03               NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `wsum`)
vw-h4-loops-spy-1d-2026-10-03                AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `wsum`)
vw-h5-format-volume-spy-1d-2026-11-16        AMEX:SPY 1D      0      DIVERGE           1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 37 paired slots; coordinates are NOT compared by v1
vw-h5-request-timeframe-text-spy-1d-2026-11- AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `240` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `240` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-hs2-v3-highestbars-spy-1d-2026-11-16      AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): `highestbars`: the sign of a Pine v1-v3 `highestbars` / `lowestbars` offset is not stated by any reference text this engine holds (the v4 reference states v4 only) and is not yet captured (Q-HS2); write it in `//@version=4` or later
vw-hs4-map-color-key-rddt-1d-2026-11-15      NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:type): a user-defined type is outside the node shapes this engine stores — `k1.size`
vw-hs5-int-array-float-param-spy-1d-2026-11- AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:type): a user-defined type is outside the node shapes this engine stores — `id.size`
vw-hs6-wrap-comment-spy-1d-2026-11-16        AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `w1`
vw-imp-change-before-reassign-rddt-1d-2026-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `x` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total. THIS ENGINE DOES DECLARE A BOUNDED FORM: `cumFrom(<that value>, <anchor>, <bars>)` — the same running total with the starting instant STATED. Stating the window is what makes the answer the same tomorrow — an all-time value moves with however many bars were fetched.
vw-imp-forin-reorder-rddt-1d-2026-11-16      NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — `R01` — and the fold stopped before it, at line 27: a Pine block spans several statements and this engine stores a single expression — `for`
vw-input-tf-text-v5-spy-1d-2026-10-01        AMEX:SPY 1D      19     INCONCLUSIVE      18 of 20 items could not be compared
    I00_bar_index_CONTROL                    MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    I01_len_D                                INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I02_D_eq_D                               INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I03_D_eq_1D                              INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I04_len_W                                INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I05_W_eq_W                               INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I06_W_eq_1W                              INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I07_len_M                                INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I08_M_eq_M                               INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I09_M_eq_1M                              INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I10_len_60                               INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I11_60_eq_60                             INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I12_len_240                              INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I13_240_eq_240                           INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I14_len_1D                               INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I15_1D_eq_1D                             INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I16_1D_eq_D                              INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I17_len_empty                            INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I18_empty_eq_timeframe_period            INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         object counts and texts agree; colours agree on 20 paired slots; coordinates are NOT compared by v1
vw-input-tf-text-v6-spy-1d-2026-10-01        AMEX:SPY 1D      19     INCONCLUSIVE      18 of 20 items could not be compared
    I00_bar_index_CONTROL                    MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    I01_len_D                                INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I02_D_eq_D                               INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I03_D_eq_1D                              INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I04_len_W                                INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I05_W_eq_W                               INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I06_W_eq_1W                              INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I07_len_M                                INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I08_M_eq_M                               INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I09_M_eq_1M                              INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I10_len_60                               INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I11_60_eq_60                             INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I12_len_240                              INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I13_240_eq_240                           INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I14_len_1D                               INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I15_1D_eq_1D                             INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I16_1D_eq_D                              INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I17_len_empty                            INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I18_empty_eq_timeframe_period            INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         object counts and texts agree; colours agree on 20 paired slots; coordinates are NOT compared by v1
vw-int-array-avg-neg-rddt-1d-2026-11-15      NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:type): a user-defined type is outside the node shapes this engine stores — `m15.avg`
vw-int-array-avg-neg-spy-1d-2026-10-01       AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:type): a user-defined type is outside the node shapes this engine stores — `m15.avg`
vw-int-array-avg-rddt-1d-2026-11-15          NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:type): a user-defined type is outside the node shapes this engine stores — `i1.avg`
vw-int-array-avg-spy-1d-2026-09-30           AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:type): a user-defined type is outside the node shapes this engine stores — `i1.avg`
vw-int-div-assign-spy-1d-2026-10-02          AMEX:SPY 1D      6      INCONCLUSIVE      3 of 7 items could not be compared
    D00_bar_index_CONTROL                    MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    D01_input_int_div_assign                 MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    D02_int_literal_div_assign               INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    D03_int_literal_over_int                 INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    D04_input_int_over_int                   MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    D05_int_reassigned_quotient              INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-library-import-rddt-1d-2026-10-02         NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:function-def): a Pine function definition introduces a name this engine has nowhere to keep — `tvta.highestSince` ends in no value this engine can read (reached through `tvta.highestSince`) — in the imported library `TradingView/ta/7`, line 236
vw-loop-in-block-spy-1d-2026-10-02           AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `e`
vw-lower-tf-1-30-spy-1d-2026-10-02           AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `30` is not one of them. Below the chart's own timeframe: lower-tf:unwitnessed: `30` below a D chart reads intraday bars, and no committed capture shows TradingView answering that timeframe on that chart period — probe `tools/visual_conformance/probes/vw-lower-tf.pine` (Q-L1 in `docs/pine/capture-queue-2026-09-30-lower-tf.md`) with a row at this timeframe, on this chart period, beside TradingView's own intraday bars of the symbol at that timeframe. ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-lower-tf-1-30-spy-1m-2026-10-02           AMEX:SPY 1M      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `30` is not one of them. Below the chart's own timeframe: lower-tf:unwitnessed: `30` below a D chart reads intraday bars, and no committed capture shows TradingView answering that timeframe on that chart period — probe `tools/visual_conformance/probes/vw-lower-tf.pine` (Q-L1 in `docs/pine/capture-queue-2026-09-30-lower-tf.md`) with a row at this timeframe, on this chart period, beside TradingView's own intraday bars of the symbol at that timeframe. ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-lower-tf-bars-rddt-15-2026-11-16          NYSE:RDDT 15     7      MATCH             all 8 items agree
    A00_bar_index_CONTROL                    MATCH             cmp 20886 ok 20886 warm 0/0 steady 0/20886 maxRel 0.00e+0
    B01_open                                 MATCH             cmp 20886 ok 20886 warm 0/0 steady 0/20886 maxRel 0.00e+0
    B02_high                                 MATCH             cmp 20886 ok 20886 warm 0/0 steady 0/20886 maxRel 0.00e+0
    B03_low                                  MATCH             cmp 20886 ok 20886 warm 0/0 steady 0/20886 maxRel 0.00e+0
    B04_close                                MATCH             cmp 20886 ok 20886 warm 0/0 steady 0/20886 maxRel 0.00e+0
    B05_volume                               MATCH             cmp 20886 ok 20886 warm 0/0 steady 0/20886 maxRel 0.00e+0
    B06_time_secs                            MATCH             cmp 20886 ok 20886 warm 0/0 steady 0/20886 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-lower-tf-bars-rddt-240-2026-11-16         NYSE:RDDT 240    7      MATCH             all 8 items agree
    A00_bar_index_CONTROL                    MATCH             cmp 2657 ok 2657 warm 0/0 steady 0/2657 maxRel 0.00e+0
    B01_open                                 MATCH             cmp 2657 ok 2657 warm 0/0 steady 0/2657 maxRel 0.00e+0
    B02_high                                 MATCH             cmp 2657 ok 2657 warm 0/0 steady 0/2657 maxRel 0.00e+0
    B03_low                                  MATCH             cmp 2657 ok 2657 warm 0/0 steady 0/2657 maxRel 0.00e+0
    B04_close                                MATCH             cmp 2657 ok 2657 warm 0/0 steady 0/2657 maxRel 0.00e+0
    B05_volume                               MATCH             cmp 2657 ok 2657 warm 0/0 steady 0/2657 maxRel 0.00e+0
    B06_time_secs                            MATCH             cmp 2657 ok 2657 warm 0/0 steady 0/2657 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-lower-tf-bars-rddt-5-2026-11-16           NYSE:RDDT 5      7      MATCH             all 8 items agree
    A00_bar_index_CONTROL                    MATCH             cmp 20340 ok 20340 warm 0/0 steady 0/20340 maxRel 0.00e+0
    B01_open                                 MATCH             cmp 20340 ok 20340 warm 0/0 steady 0/20340 maxRel 0.00e+0
    B02_high                                 MATCH             cmp 20340 ok 20340 warm 0/0 steady 0/20340 maxRel 0.00e+0
    B03_low                                  MATCH             cmp 20340 ok 20340 warm 0/0 steady 0/20340 maxRel 0.00e+0
    B04_close                                MATCH             cmp 20340 ok 20340 warm 0/0 steady 0/20340 maxRel 0.00e+0
    B05_volume                               MATCH             cmp 20340 ok 20340 warm 0/0 steady 0/20340 maxRel 0.00e+0
    B06_time_secs                            MATCH             cmp 20340 ok 20340 warm 0/0 steady 0/20340 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-lower-tf-bars-rddt-60-2026-11-16          NYSE:RDDT 60     7      MATCH             all 8 items agree
    A00_bar_index_CONTROL                    MATCH             cmp 10319 ok 10319 warm 0/0 steady 0/10319 maxRel 0.00e+0
    B01_open                                 MATCH             cmp 10319 ok 10319 warm 0/0 steady 0/10319 maxRel 0.00e+0
    B02_high                                 MATCH             cmp 10319 ok 10319 warm 0/0 steady 0/10319 maxRel 0.00e+0
    B03_low                                  MATCH             cmp 10319 ok 10319 warm 0/0 steady 0/10319 maxRel 0.00e+0
    B04_close                                MATCH             cmp 10319 ok 10319 warm 0/0 steady 0/10319 maxRel 0.00e+0
    B05_volume                               MATCH             cmp 10319 ok 10319 warm 0/0 steady 0/10319 maxRel 0.00e+0
    B06_time_secs                            MATCH             cmp 10319 ok 10319 warm 0/0 steady 0/10319 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-lower-tf-cava-1d-2026-10-02               NYSE:CAVA 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-lower-tf-rddt-1d-2026-09-30               NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-lower-tf-spy-1d-2026-09-30                AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-lower-tf-spy-1m-2026-10-02                AMEX:SPY 1M      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-lower-tf-spy-1w-2026-09-30                AMEX:SPY 1W      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-mbb-auto-spy-1d-2026-09-30                AMEX:SPY 1D      4      MATCH             all 5 items agree
    M00_bar_index_CONTROL                    MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    M01_k                                    MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    M02_close_at_k                           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    M03_close_at_k_is_na                     MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-mintick-arkk-1d-2026-10-02                CBOE:ARKK 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-bac-pl-1d-2026-10-02              NYSE:BAC/PL 1D   0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-dfliw-1d-2026-10-02               NASDAQ:DFLIW 1D  0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-grrrw-1d-2026-10-02               NASDAQ:GRRRW 1D  0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-imo-1d-2026-10-02                 AMEX:IMO 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-qqq-1d-2026-10-02                 NASDAQ:QQQ 1D    0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-xlk-1d-2026-10-02                 AMEX:XLK 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-yhnau-1d-2026-10-02               NASDAQ:YHNAU 1D  0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-ne-na-spy-1d-2026-09-30                   AMEX:SPY 1D      12     MATCH             all 13 items agree
    Q00_bar_index_CONTROL                    MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q01_x_is_na                              MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q02_x_ne_close                           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q03_x_eq_close                           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q04_x_ne_x                               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q05_x_eq_x                               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q06_i_ne_1                               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q07_i_eq_1                               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q08_x_gt_0                               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q09_not_x_eq_close                       MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q10_na_var_ne_close                      MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    Q11_na_var_eq_close                      MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-object-gc-a-spy-1d-2026-09-28             AMEX:SPY 1D      4      MATCH             all 5 items agree
    A00_bar_index_CONTROL                    MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    A01_isconfirmed                          MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    A02_islast                               MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    A03_O2_created_this_bar                  MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 194 paired slots; 132 slots on objects neither side draws not graded; coordinates are NOT compared by v1
vw-object-gc-a-spy-1d-2026-09-28             AMEX:SPY 1W      4      DIVERGE           A01_isconfirmed: bar 1757 t=1790602200 value vendor=0 ours=1
    A00_bar_index_CONTROL                    MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    A01_isconfirmed                          DIVERGE           cmp 1758 ok 1757 warm 0/0 steady 1/1758 maxRel 0.00e+0 — 1 steady-state bars disagree; first at bar 1757 (value: vendor 0 vs ours 1) — persistent, last at bar 1757
    A02_islast                               MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    A03_O2_created_this_bar                  MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 189 paired slots; 129 slots on objects neither side draws not graded; coordinates are NOT compared by v1
vw-object-gc-b-spy-1d-2026-09-28             AMEX:SPY 1D      3      MATCH             all 4 items agree
    B00_bar_index_CONTROL                    MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B01_isconfirmed                          MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    B02_islast                               MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 326 paired slots; coordinates are NOT compared by v1
vw-object-gc-b-spy-1d-2026-09-28             AMEX:SPY 1W      3      DIVERGE           B01_isconfirmed: bar 1757 t=1790602200 value vendor=0 ours=1
    B00_bar_index_CONTROL                    MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    B01_isconfirmed                          DIVERGE           cmp 1758 ok 1757 warm 0/0 steady 1/1758 maxRel 0.00e+0 — 1 steady-state bars disagree; first at bar 1757 (value: vendor 0 vs ours 1) — persistent, last at bar 1757
    B02_islast                               MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 324 paired slots; coordinates are NOT compared by v1
vw-object-gc-c-spy-1d-2026-09-28             AMEX:SPY 1D      4      MATCH             all 5 items agree
    C00_bar_index_CONTROL                    MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    C01_isconfirmed                          MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    C02_islast                               MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    C03_bar_index_mod3                       MATCH             cmp 8473 ok 8473 warm 0/0 steady 0/8473 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 38 paired slots; coordinates are NOT compared by v1
vw-object-gc-c-spy-1d-2026-09-28             AMEX:SPY 1W      4      DIVERGE           C01_isconfirmed: bar 1757 t=1790602200 value vendor=0 ours=1
    C00_bar_index_CONTROL                    MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    C01_isconfirmed                          DIVERGE           cmp 1758 ok 1757 warm 0/0 steady 1/1758 maxRel 0.00e+0 — 1 steady-state bars disagree; first at bar 1757 (value: vendor 0 vs ours 1) — persistent, last at bar 1757
    C02_islast                               MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    C03_bar_index_mod3                       MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 51 paired slots; coordinates are NOT compared by v1
vw-object-gc-d-spy-1d-2026-09-28             AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `label.all` is read as an array here and nothing in this script creates it, so there are no slots to read
vw-object-gc-d-spy-1d-2026-09-28             AMEX:SPY 1W      0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `label.all` is read as an array here and nothing in this script creates it, so there are no slots to read
vw-offset-na-spy-1d-2026-09-30               AMEX:SPY 1D      6      MATCH             all 7 items agree
    E00_bar_index_CONTROL                    MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    E01_e_is_na                              MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    E02_close_at_e                           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    E03_close_at_e_is_na                     MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    E04_close_1_CONTROL                      MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    E05_close_at_e_eq_close                  MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-once-ta-helper-rddt-1d-2026-10-02         NYSE:RDDT 1D     1      MATCH             all 2 items agree
    V00_close_CONTROL                        MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 28 paired slots; coordinates are NOT compared by v1
vw-once-ta-helper-spy-1d-2026-10-02          AMEX:SPY 1D      1      MATCH             all 2 items agree
    V00_close_CONTROL                        MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 28 paired slots; coordinates are NOT compared by v1
vw-other-symbol-rddt-1d-2026-09-30           NYSE:RDDT 1D     8      DIVERGE           O05_BRKB_bare: bar 0 t=1711027800 na vendor=413.78 ours=na
    O00_bar_index_CONTROL                    MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    O01_chart_close                          MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    O02_SPY_bare                             MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    O03_AMEX_SPY                             MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    O04_bare_eq_amex                         MATCH             cmp 634 ok 634 warm 0/0 steady 0/634 maxRel 0.00e+0
    O05_BRKB_bare                            DIVERGE           cmp 634 ok 300 warm 0/0 steady 334/634 maxRel 0.00e+0 — 334 steady-state bars disagree; first at bar 0 (na: vendor 413.78 vs ours na) — scattered, last at bar 333
    O06_NYSE_BRKB                            DIVERGE           cmp 634 ok 300 warm 0/0 steady 334/634 maxRel 0.00e+0 — 334 steady-state bars disagree; first at bar 0 (na: vendor 413.78 vs ours na) — scattered, last at bar 333
    O07_brkb_bare_eq_nyse                    DIVERGE           cmp 634 ok 300 warm 0/0 steady 334/634 maxRel 1.00e+0 — 334 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 333
    objects                                  MATCH         object counts and texts agree; colours agree on 2 paired slots; coordinates are NOT compared by v1
vw-pt-na-guard-and-rddt-1d-2026-11-16        NYSE:RDDT 1D     9      INCONCLUSIVE      3 of 10 items could not be compared
    A00_bar_index_CONTROL                    MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    A01_left_side_CONTROL                    MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    A02_x                                    MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    C01_and_crossover                        INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out4 (pine:block)
    E01_and_crossover_every_bar              MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    C02_and_change_positive                  INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out6 (pine:block)
    E02_and_change_positive_every_bar        MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    C03_and_sma3_above_close                 INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out8 (pine:block)
    E03_and_sma3_above_close_every_bar       MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-pt-na-guard-and-spy-1d-2026-11-16         AMEX:SPY 1D      9      INCONCLUSIVE      3 of 10 items could not be compared
    A00_bar_index_CONTROL                    MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    A01_left_side_CONTROL                    MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    A02_x                                    MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    C01_and_crossover                        INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out4 (pine:block)
    E01_and_crossover_every_bar              MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    C02_and_change_positive                  INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out6 (pine:block)
    E02_and_change_positive_every_bar        MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    C03_and_sma3_above_close                 INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out8 (pine:block)
    E03_and_sma3_above_close_every_bar       MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-ratchet-stops-rddt-1d-2026-10-02          NYSE:RDDT 1D     8      MATCH             all 9 items agree
    R01_up                                   MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 4.92e-16
    R02_dn                                   MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 1.94e-16
    R03_trend                                MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    R04_local_stop                           MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 3.96e-16
    R05_range_filter                         MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 2.90e-16
    R06_pivot_high                           MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    R07_pivot_low                            MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    R00_bar_index_CONTROL                    MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-ratchet-stops-spy-1d-2026-10-02           AMEX:SPY 1D      8      MATCH             all 9 items agree
    R01_up                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    R02_dn                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    R03_trend                                MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    R04_local_stop                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    R05_range_filter                         MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 2.20e-16
    R06_pivot_high                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    R07_pivot_low                            MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    R00_bar_index_CONTROL                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-request-htf-alignment-qqq-1d-2026-11-18   NASDAQ:QQQ 1D    0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-request-htf-alignment-spy-1d-2026-10-02   AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-request-htf-alignment-spy-1d-2026-11-18   AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-request-htf-alignment-spy-5-2026-10-02    AMEX:SPY 5       0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-request-htf-alignment-spy-60-2026-10-02   AMEX:SPY 60      0      INCONCLUSIVE      refused on our side: member door refused (pine:request): this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol as `sym` (limited to the benchmark roster) and another timeframe as `tf` (weekly and monthly from daily bars); what stops this one is that its arguments do not fold to those — `request.security`: this engine resamples weekly and monthly from the daily bars it holds, and `60` is not one of them. Below the chart's own timeframe: lower-tf:store-unmeasured: `60` is below this chart's timeframe, so it reads intraday bars — and our intraday bars have not been measured against TradingView's. TradingView's answer is known (the day's last regular-session bar, `vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored `/api/bars/<ticker>?tf=15` payload has been compared with TradingView's 15-minute bars for the same sessions (`storeIntradayAgreement`). ⚠️ THIS IS NOT THE SAME REQUEST: `timeframe.period` reads the timeframe the chart is on rather than forcing one, so decide whether that is what you meant before you take it.
vw-rt5-arm-draw-block-history-rddt-1d-2026-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:drawing): a drawing object paints on a chart and answers with no number — `label.new`
vw-rt6-runtime-colour-rddt-1d-2026-10-03     NYSE:RDDT 1D     7      INCONCLUSIVE      6 of 9 items could not be compared
    K00_bar_index_CONTROL                    MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    C01_var_colour                           INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (withheld by name (pine:colour-unread) — its colour is an expression this door cannot read yet)
    C02_new_var_40                           INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (withheld by name (pine:colour-unread) — its colour is an expression this door cannot read yet)
    C03_new_na_base                          INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (withheld by name (pine:colour-unread) — its colour is an expression this door cannot read yet)
    C04_new_na_transp                        INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (withheld by name (pine:colour-unread) — its colour is an expression this door cannot read yet)
    C05_rgb_na                               INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (withheld by name (pine:colour-unread) — its colour is an expression this door cannot read yet)
    C06_cond_or_na                           MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   INCONCLUSIVE  1 paint agree bar for bar; 1 paint withheld by name, not graded (first: barcolor plot_12 "B01_var_barcolor" — `barcolor`'s colour is an expression this door cannot carry yet)
vw-rt6-runtime-colour-spy-1d-2026-10-03      AMEX:SPY 1D      7      INCONCLUSIVE      6 of 9 items could not be compared
    K00_bar_index_CONTROL                    MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    C01_var_colour                           INCONCLUSIVE      cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (withheld by name (pine:colour-unread) — its colour is an expression this door cannot read yet)
    C02_new_var_40                           INCONCLUSIVE      cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (withheld by name (pine:colour-unread) — its colour is an expression this door cannot read yet)
    C03_new_na_base                          INCONCLUSIVE      cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (withheld by name (pine:colour-unread) — its colour is an expression this door cannot read yet)
    C04_new_na_transp                        INCONCLUSIVE      cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (withheld by name (pine:colour-unread) — its colour is an expression this door cannot read yet)
    C05_rgb_na                               INCONCLUSIVE      cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (withheld by name (pine:colour-unread) — its colour is an expression this door cannot read yet)
    C06_cond_or_na                           MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
    paints                                   INCONCLUSIVE  1 paint agree bar for bar; 1 paint withheld by name, not graded (first: barcolor plot_12 "B01_var_barcolor" — `barcolor`'s colour is an expression this door cannot carry yet)
vw-rt7-empty-reduce-fixnan-spy-1d-2026-10-04 AMEX:SPY 1D      11     MATCH             all 12 items agree
    E00_bar_index_CONTROL                    MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    E01_max_empty                            MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    E02_min_empty                            MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    E03_sum_empty                            MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    E04_avg_empty                            MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    E05_sum_all_na                           MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    E06_avg_all_na                           MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    F00_x_CONTROL                            MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    F01_fixnan                               MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    F02a_fixnan_in_fn                        MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    F02b_fixnan_in_fn_second_site            MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-runtime-error-spy-1d-2026-09-30           AMEX:SPY 1D      2      MATCH             all 3 items agree
    E00_bar_index_CONTROL                    MATCH             cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    E01_close_CONTROL                        MATCH             cmp 4800 ok 4800 warm 0/0 steady 0/4800 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 100 paired slots; coordinates are NOT compared by v1
vw-s1-q-s1d-close-reverse-rddt-1d-2026-11-16 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
vw-s1-q-s1d-close-reverse-rpt-rddt-1d-2026-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy UNGRADABLE at step 0: the reference has too few trades (1, floor 5)
vw-s1-q-s1d-two-entries-rddt-1d-2026-11-16   NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
vw-s1-q-s1d-two-entries-rpt-rddt-1d-2026-11- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy UNGRADABLE at step 0: the reference has too few trades (0, floor 5)
vw-s1-q-s1d-two-stops-rddt-1d-2026-11-16     NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
vw-s1-q-s1d-two-stops-rpt-rddt-1d-2026-11-16 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy UNGRADABLE at step 0: the reference has too few trades (2, floor 5)
vw-s1-q-s1e-stop-past-rddt-1d-2026-11-16     NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
vw-s1-q-s1e-stop-past-rpt-rddt-1d-2026-11-16 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy UNGRADABLE at step 0: the reference has too few trades (1, floor 5)
vw-s1-q-s1g-blocked-stop-entry-rddt-1d-2026- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
vw-s1-q-s1g-blocked-stop-entry-rpt-rddt-1d-2 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy UNGRADABLE at step 0: the reference has too few trades (1, floor 5)
vw-s1-q-s1h-fifo-exit-rddt-1d-2026-11-16     NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
vw-s1-q-s1h-fifo-exit-rpt-rddt-1d-2026-11-16 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy UNGRADABLE at step 0: the reference has too few trades (2, floor 5)
vw-s1-q-s1j-stop-limit-rddt-1d-2026-11-16    NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
vw-s1-q-s1j-stop-limit-rpt-rddt-1d-2026-11-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy UNGRADABLE at step 0: the reference has too few trades (0, floor 5)
vw-s1-q-s1k-fractional-profit-rddt-1d-2026-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
vw-s1-q-s1k-fractional-profit-rpt-rddt-1d-20 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy UNGRADABLE at step 0: the reference has too few trades (1, floor 5)
vw-s1-q-s1k-na-modify-rddt-1d-2026-11-16     NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
vw-s1-q-s1k-na-modify-rpt-rddt-1d-2026-11-16 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy UNGRADABLE at step 0: the reference has too few trades (0, floor 5)
vw-s1-q-s1k-profit-and-limit-rddt-1d-2026-11 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
vw-s1-q-s1k-profit-and-limit-rpt-rddt-1d-202 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy UNGRADABLE at step 0: the reference has too few trades (1, floor 5)
vw-tc1-colour-na-compare-rddt-1d-2026-11-16  NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:colour-value): a colour cannot be a value in a screened column — `color.yellow`
vw-ternary-arm-legacy-v1-cum-rddt-1d-2026-11 NYSE:RDDT 1D     7      INCONCLUSIVE      1 of 8 items could not be compared
    A_change                                 MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B_sma                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C_ema                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 4.49e-16
    D_rma                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    E_barssince                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    F_cum                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    BI                                       INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-ternary-arm-legacy-v1-rddt-1d-2026-11-15  NYSE:RDDT 1D     7      MATCH             all 8 items agree
    A_change                                 MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B_sma                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C_ema                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 4.49e-16
    D_rma                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    E_barssince                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    F_cum                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    BI                                       MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-ternary-arm-legacy-v2-cum-rddt-1d-2026-11 NYSE:RDDT 1D     7      INCONCLUSIVE      1 of 8 items could not be compared
    A_change                                 MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B_sma                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C_ema                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 4.49e-16
    D_rma                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    E_barssince                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    F_cum                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    BI                                       INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-ternary-arm-legacy-v2-rddt-1d-2026-11-15  NYSE:RDDT 1D     7      MATCH             all 8 items agree
    A_change                                 MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B_sma                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C_ema                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 4.49e-16
    D_rma                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    E_barssince                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    F_cum                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    BI                                       MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-ternary-arm-legacy-v3-cum-rddt-1d-2026-11 NYSE:RDDT 1D     7      INCONCLUSIVE      1 of 8 items could not be compared
    A_change                                 MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B_sma                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C_ema                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 4.49e-16
    D_rma                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    E_barssince                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    F_cum                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    BI                                       INCONCLUSIVE      cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
vw-ternary-arm-legacy-v3-rddt-1d-2026-11-15  NYSE:RDDT 1D     7      MATCH             all 8 items agree
    A_change                                 MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    B_sma                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    C_ema                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 4.49e-16
    D_rma                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    E_barssince                              MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    F_cum                                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    BI                                       MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-ternary-draw-helper-rddt-1d-2026-10-02    NYSE:RDDT 1D     1      MATCH             all 2 items agree
    R00                                      MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 1009 paired slots; coordinates are NOT compared by v1
vw-tf-period-spy-1d-2026-09-30               AMEX:SPY 1D      12     INCONCLUSIVE      8 of 13 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    T01_len_period                           INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T02_eq_D                                 INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T03_eq_1D                                INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T04_eq_W                                 INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T05_eq_1W                                INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T06_eq_M                                 INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T07_eq_1M                                INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T08_multiplier                           INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T09_isdaily                              MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    T10_isweekly                             MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    T11_ismonthly                            MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         object counts and texts agree; colours agree on 2 paired slots; coordinates are NOT compared by v1
vw-tf-period-spy-1m-2026-09-30               AMEX:SPY 1M      12     INCONCLUSIVE      10 of 13 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_len_period                           INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out2 (bind:period-reads)
    T02_eq_D                                 INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out3 (bind:period-reads)
    T03_eq_1D                                INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out4 (bind:period-reads)
    T04_eq_W                                 INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out5 (bind:period-reads)
    T05_eq_1W                                INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out6 (bind:period-reads)
    T06_eq_M                                 INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out7 (bind:period-reads)
    T07_eq_1M                                INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out8 (bind:period-reads)
    T08_multiplier                           INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T09_isdaily                              MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    T10_isweekly                             MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    T11_ismonthly                            MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  INCONCLUSIVE  our object lane did not run: objectReaderFor returned null
vw-tf-period-spy-1w-2026-09-30               AMEX:SPY 1W      12     INCONCLUSIVE      10 of 13 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_len_period                           INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out2 (bind:period-reads)
    T02_eq_D                                 INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out3 (bind:period-reads)
    T03_eq_1D                                INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out4 (bind:period-reads)
    T04_eq_W                                 INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out5 (bind:period-reads)
    T05_eq_1W                                INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out6 (bind:period-reads)
    T06_eq_M                                 INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out7 (bind:period-reads)
    T07_eq_1M                                INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out8 (bind:period-reads)
    T08_multiplier                           INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T09_isdaily                              MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    T10_isweekly                             MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    T11_ismonthly                            MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  INCONCLUSIVE  our object lane did not run: objectReaderFor returned null
vw-theme-colours-spy-1d-2026-10-01           AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:colour-value): a colour cannot be a value in a screened column — `color.r`: its components are served for a fixed colour (a Pine colour name, a `#RRGGBB` or `#RRGGBBAA` literal, `color.rgb` of literals, an `input.color` of one), for `color.new` of one with a literal transparency or a per-bar one that stays within 0-100, for a ternary of two such colours, for `color.from_gradient` between two fixed colours, and for `color.new(<that gradient>, <literal>)` — the colours the `vw-gradient` and `vw-colour-components` captures measured. This one is none of those (a gradient between gradients and a colour returned by a user function are measured and not served)
vw-time-close-tf-bitstamp-btcusd-1d-2026-09- BITSTAMP:BTCUSD  0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-eurusd-1d-2026-10-02        FX:EURUSD 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-fx-eurusd-1d-2026-10-01     FX:EURUSD 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-spy-15-2026-10-02           AMEX:SPY 15      0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-spy-1d-2026-09-30           AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-spy-1d-full-2026-10-01      AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-spy-1d-full-2026-10-02      AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-spy-1m-2026-10-01           AMEX:SPY 1M      0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-spy-1m-2026-10-02           AMEX:SPY 1M      0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-spy-1w-2026-10-01           AMEX:SPY 1W      0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-close-tf-spy-1w-2026-10-02           AMEX:SPY 1W      0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `time_close("3M")`: it is measured (vendor capture `vw-time-close-tf-spy-1d-2026-09-30`: the close of the quarter's or year's last session), and this engine resamples only weeks and months, so it has no quarterly or yearly bar to read that close from. `time_close("W")` and `time_close("M")` translate on a daily chart
vw-time-session-spy-1d-2026-09-28            AMEX:SPY D       19     MATCH             all 20 items agree
    S00_bar_index_CONTROL                    MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S01_hour_MUST_VARY_ON_INTRADAY           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S02_minute                               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S03_na_0930_1600                         MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S04_secs_0930_1600                       MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S05_na_0930_1000_OR_window               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S06_secs_0930_1000                       MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S07_na_1000_1100_EXCLUDES_OPEN           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S08_secs_1000_1100                       MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S09_na_0930_1000_ALLDAYS                 MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S10_na_0930_1000_MON_FRI_23456           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S11_na_OR_GMTminus4_CORPUS_FORM          MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S12_na_OR_GMTminus5                      MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S13_na_OR_America_New_York               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S14_na_OR_syminfo_timezone               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S15_na_2000_0000_OVERNIGHT               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S16_na_0930_1030_IB_window               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S17_secs_0930_1030                       MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S18_dayofweek_for_S10                    MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-session-spy-60-ext-2026-09-28        AMEX:SPY 60      19     INCONCLUSIVE      1 of 20 items could not be compared
    S00_bar_index_CONTROL                    INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    S01_hour_MUST_VARY_ON_INTRADAY           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S02_minute                               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S03_na_0930_1600                         MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S04_secs_0930_1600                       MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S05_na_0930_1000_OR_window               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S06_secs_0930_1000                       MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S07_na_1000_1100_EXCLUDES_OPEN           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S08_secs_1000_1100                       MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S09_na_0930_1000_ALLDAYS                 MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S10_na_0930_1000_MON_FRI_23456           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S11_na_OR_GMTminus4_CORPUS_FORM          MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S12_na_OR_GMTminus5                      MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S13_na_OR_America_New_York               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S14_na_OR_syminfo_timezone               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S15_na_2000_0000_OVERNIGHT               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S16_na_0930_1030_IB_window               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S17_secs_0930_1030                       MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S18_dayofweek_for_S10                    MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-session-spy-60-rth-2026-09-28        AMEX:SPY 60      19     INCONCLUSIVE      1 of 20 items could not be compared
    S00_bar_index_CONTROL                    INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    S01_hour_MUST_VARY_ON_INTRADAY           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S02_minute                               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S03_na_0930_1600                         MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S04_secs_0930_1600                       MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S05_na_0930_1000_OR_window               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S06_secs_0930_1000                       MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S07_na_1000_1100_EXCLUDES_OPEN           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S08_secs_1000_1100                       MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S09_na_0930_1000_ALLDAYS                 MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S10_na_0930_1000_MON_FRI_23456           MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S11_na_OR_GMTminus4_CORPUS_FORM          MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S12_na_OR_GMTminus5                      MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S13_na_OR_America_New_York               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S14_na_OR_syminfo_timezone               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S15_na_2000_0000_OVERNIGHT               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S16_na_0930_1030_IB_window               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S17_secs_0930_1030                       MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    S18_dayofweek_for_S10                    MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-bitstamp-btcusd-1d-2026-09-30     BITSTAMP:BTCUSD  18     DIVERGE           T01_timeW_minus_time_DAYS: bar 0 t=1313625600 na vendor=-3 ours=na
    T00_bar_index_CONTROL                    MATCH             cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                DIVERGE           cmp 5491 ok 5438 warm 0/0 steady 53/5491 maxRel 0.00e+0 — 53 steady-state bars disagree; first at bar 0 (na: vendor -3 vs ours na) — scattered, last at bar 5283
    T02_timeM_minus_time_DAYS                DIVERGE           cmp 5491 ok 4795 warm 0/0 steady 696/5491 maxRel 0.00e+0 — 696 steady-state bars disagree; first at bar 0 (na: vendor -17 vs ours na) — scattered, last at bar 5306
    T03_time3M_minus_time_DAYS               DIVERGE           cmp 5491 ok 4247 warm 0/0 steady 1244/5491 maxRel 0.00e+0 — 1244 steady-state bars disagree; first at bar 0 (na: vendor -48 vs ours na) — scattered, last at bar 5306
    T04_time12M_minus_time_DAYS              DIVERGE           cmp 5491 ok 1845 warm 0/0 steady 3646/5491 maxRel 0.00e+0 — 3646 steady-state bars disagree; first at bar 0 (na: vendor -229 vs ours na) — persistent, last at bar 5490
    T05_timeSelf_minus_time_MUST_BE_0        MATCH             cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH             cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0
    T07_newWeek                              DIVERGE           cmp 5491 ok 5406 warm 0/0 steady 85/5491 maxRel 0.00e+0 — 85 steady-state bars disagree; first at bar 0 (na: vendor 0 vs ours na) — scattered, last at bar 5284
    T08_newMonth                             DIVERGE           cmp 5491 ok 4765 warm 0/0 steady 726/5491 maxRel 0.00e+0 — 726 steady-state bars disagree; first at bar 0 (na: vendor 0 vs ours na) — scattered, last at bar 5307
    T09_newQuarter                           DIVERGE           cmp 5491 ok 4217 warm 0/0 steady 1274/5491 maxRel 0.00e+0 — 1274 steady-state bars disagree; first at bar 0 (na: vendor 0 vs ours na) — scattered, last at bar 5307
    T10_in_seconds_1                         INCONCLUSIVE      cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE      cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE      cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE      cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE      cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE      cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE      cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH             cmp 5491 ok 5491 warm 0/0 steady 0/5491 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-eurusd-1d-2026-10-02              FX:EURUSD 1D     18     INCONCLUSIVE      16 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 14330 ok 14330 warm 0/0 steady 0/14330 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T02_timeM_minus_time_DAYS                INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T03_time3M_minus_time_DAYS               INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T04_time12M_minus_time_DAYS              INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T05_timeSelf_minus_time_MUST_BE_0        INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T06_time60_minus_time_DAYS               INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T07_newWeek                              INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:weekend-bars) — nothing is drawn for it
    T08_newMonth                             INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:weekend-bars) — nothing is drawn for it
    T09_newQuarter                           INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:weekend-bars) — nothing is drawn for it
    T10_in_seconds_1                         INCONCLUSIVE      cmp 14330 ok 14330 warm 0/0 steady 0/14330 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE      cmp 14330 ok 14330 warm 0/0 steady 0/14330 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE      cmp 14330 ok 14330 warm 0/0 steady 0/14330 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE      cmp 14330 ok 14330 warm 0/0 steady 0/14330 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE      cmp 14330 ok 14330 warm 0/0 steady 0/14330 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE      cmp 14330 ok 14330 warm 0/0 steady 0/14330 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE      cmp 14330 ok 14330 warm 0/0 steady 0/14330 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH             cmp 14330 ok 14330 warm 0/0 steady 0/14330 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-fx-eurusd-1d-2026-10-01           FX:EURUSD 1D     18     INCONCLUSIVE      16 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 14329 ok 14329 warm 0/0 steady 0/14329 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T02_timeM_minus_time_DAYS                INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T03_time3M_minus_time_DAYS               INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T04_time12M_minus_time_DAYS              INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T05_timeSelf_minus_time_MUST_BE_0        INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T06_time60_minus_time_DAYS               INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:weekend-session) — nothing is drawn for it
    T07_newWeek                              INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:weekend-bars) — nothing is drawn for it
    T08_newMonth                             INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:weekend-bars) — nothing is drawn for it
    T09_newQuarter                           INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:weekend-bars) — nothing is drawn for it
    T10_in_seconds_1                         INCONCLUSIVE      cmp 14329 ok 14329 warm 0/0 steady 0/14329 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE      cmp 14329 ok 14329 warm 0/0 steady 0/14329 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE      cmp 14329 ok 14329 warm 0/0 steady 0/14329 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE      cmp 14329 ok 14329 warm 0/0 steady 0/14329 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE      cmp 14329 ok 14329 warm 0/0 steady 0/14329 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE      cmp 14329 ok 14329 warm 0/0 steady 0/14329 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE      cmp 14329 ok 14329 warm 0/0 steady 0/14329 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH             cmp 14329 ok 14329 warm 0/0 steady 0/14329 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-rddt-1d-2026-10-02                NYSE:RDDT 1D     18     INCONCLUSIVE      7 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T07_newWeek                              MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T08_newMonth                             MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T09_newQuarter                           MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE      cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH             cmp 636 ok 636 warm 0/0 steady 0/636 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-1-2026-10-02                  AMEX:SPY 1       18     INCONCLUSIVE      17 of 19 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_timeW_minus_time_DAYS                INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T02_timeM_minus_time_DAYS                INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T03_time3M_minus_time_DAYS               INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T04_time12M_minus_time_DAYS              INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T05_timeSelf_minus_time_MUST_BE_0        INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-own:chart-unwitnessed) — nothing is drawn for it
    T06_time60_minus_time_DAYS               INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-own:chart-unwitnessed) — nothing is drawn for it
    T07_newWeek                              INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T08_newMonth                             INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T09_newQuarter                           INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T10_in_seconds_1                         INCONCLUSIVE      cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE      cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE      cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE      cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE      cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE      cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE      cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH             cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-15-2026-10-01                 AMEX:SPY 15      18     INCONCLUSIVE      8 of 19 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_timeW_minus_time_DAYS                MATCH             cmp 3300 ok 3300 warm 0/1 steady 0/3299 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH             cmp 3300 ok 3300 warm 0/1 steady 0/3299 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH             cmp 3300 ok 3300 warm 0/1 steady 0/3299 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH             cmp 3300 ok 3300 warm 0/1 steady 0/3299 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH             cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH             cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0
    T07_newWeek                              MATCH             cmp 3300 ok 3299 warm 1/2 steady 0/3298 maxRel 0.00e+0
    T08_newMonth                             MATCH             cmp 3300 ok 3299 warm 1/2 steady 0/3298 maxRel 0.00e+0
    T09_newQuarter                           MATCH             cmp 3300 ok 3299 warm 1/2 steady 0/3298 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE      cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE      cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE      cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE      cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE      cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE      cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE      cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH             cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-1d-2026-09-28                 AMEX:SPY 1D      18     INCONCLUSIVE      7 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                MATCH             cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH             cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH             cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH             cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH             cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH             cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T07_newWeek                              MATCH             cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T08_newMonth                             MATCH             cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T09_newQuarter                           MATCH             cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE      cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE      cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE      cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE      cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE      cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE      cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE      cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH             cmp 900 ok 900 warm 0/0 steady 0/900 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-1d-full-2026-10-01            AMEX:SPY 1D      18     INCONCLUSIVE      7 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                MATCH             cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH             cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH             cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH             cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH             cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH             cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T07_newWeek                              MATCH             cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T08_newMonth                             MATCH             cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T09_newQuarter                           MATCH             cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE      cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE      cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE      cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE      cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE      cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE      cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE      cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH             cmp 8476 ok 8476 warm 0/0 steady 0/8476 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-1d-full-2026-10-02            AMEX:SPY 1D      18     INCONCLUSIVE      7 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T07_newWeek                              MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T08_newMonth                             MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T09_newQuarter                           MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE      cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE      cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE      cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE      cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE      cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE      cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE      cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH             cmp 8477 ok 8477 warm 0/0 steady 0/8477 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-1m-2026-10-01                 AMEX:SPY 1M      18     INCONCLUSIVE      7 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T07_newWeek                              MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T08_newMonth                             MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T09_newQuarter                           MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE      cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE      cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE      cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE      cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE      cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE      cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE      cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-1m-2026-10-02                 AMEX:SPY 1M      18     INCONCLUSIVE      7 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T07_newWeek                              MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T08_newMonth                             MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T09_newQuarter                           MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE      cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE      cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE      cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE      cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE      cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE      cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE      cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH             cmp 406 ok 406 warm 0/0 steady 0/406 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-1w-2026-10-01                 AMEX:SPY 1W      18     INCONCLUSIVE      7 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T07_newWeek                              MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T08_newMonth                             MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T09_newQuarter                           MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE      cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE      cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE      cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE      cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE      cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE      cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE      cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-1w-2026-10-02                 AMEX:SPY 1W      18     INCONCLUSIVE      7 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T07_newWeek                              MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T08_newMonth                             MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T09_newQuarter                           MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE      cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE      cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE      cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE      cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE      cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE      cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE      cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH             cmp 1758 ok 1758 warm 0/0 steady 0/1758 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-240-2026-10-02                AMEX:SPY 240     18     INCONCLUSIVE      17 of 19 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_timeW_minus_time_DAYS                INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T02_timeM_minus_time_DAYS                INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T03_time3M_minus_time_DAYS               INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T04_time12M_minus_time_DAYS              INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T05_timeSelf_minus_time_MUST_BE_0        INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-own:chart-unwitnessed) — nothing is drawn for it
    T06_time60_minus_time_DAYS               INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-own:chart-unwitnessed) — nothing is drawn for it
    T07_newWeek                              INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T08_newMonth                             INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T09_newQuarter                           INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T10_in_seconds_1                         INCONCLUSIVE      cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE      cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE      cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE      cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE      cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE      cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE      cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH             cmp 1200 ok 1200 warm 0/0 steady 0/1200 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-30-2026-10-02                 AMEX:SPY 30      18     INCONCLUSIVE      17 of 19 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_timeW_minus_time_DAYS                INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T02_timeM_minus_time_DAYS                INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T03_time3M_minus_time_DAYS               INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T04_time12M_minus_time_DAYS              INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T05_timeSelf_minus_time_MUST_BE_0        INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-own:chart-unwitnessed) — nothing is drawn for it
    T06_time60_minus_time_DAYS               INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-own:chart-unwitnessed) — nothing is drawn for it
    T07_newWeek                              INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T08_newMonth                             INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T09_newQuarter                           INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-anchor:not-daily) — nothing is drawn for it
    T10_in_seconds_1                         INCONCLUSIVE      cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE      cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE      cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE      cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE      cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE      cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE      cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH             cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-5-2026-10-01                  AMEX:SPY 5       18     INCONCLUSIVE      8 of 19 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_timeW_minus_time_DAYS                MATCH             cmp 3300 ok 3300 warm 0/1 steady 0/3299 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH             cmp 3300 ok 3300 warm 0/1 steady 0/3299 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH             cmp 3300 ok 3300 warm 0/1 steady 0/3299 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH             cmp 3300 ok 3300 warm 0/1 steady 0/3299 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH             cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH             cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0
    T07_newWeek                              MATCH             cmp 3300 ok 3299 warm 1/2 steady 0/3298 maxRel 0.00e+0
    T08_newMonth                             MATCH             cmp 3300 ok 3299 warm 1/2 steady 0/3298 maxRel 0.00e+0
    T09_newQuarter                           MATCH             cmp 3300 ok 3299 warm 1/2 steady 0/3298 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE      cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE      cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE      cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE      cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE      cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE      cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE      cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH             cmp 3300 ok 3300 warm 0/0 steady 0/3300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-5-ext-2026-10-02              AMEX:SPY 5       18     INCONCLUSIVE      16 of 19 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_timeW_minus_time_DAYS                INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:outside-session) — nothing is drawn for it
    T02_timeM_minus_time_DAYS                INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:outside-session) — nothing is drawn for it
    T03_time3M_minus_time_DAYS               INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:outside-session) — nothing is drawn for it
    T04_time12M_minus_time_DAYS              INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:outside-session) — nothing is drawn for it
    T05_timeSelf_minus_time_MUST_BE_0        MATCH             cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:outside-session) — nothing is drawn for it
    T07_newWeek                              INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:outside-session) — nothing is drawn for it
    T08_newMonth                             INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:outside-session) — nothing is drawn for it
    T09_newQuarter                           INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (time-clock:outside-session) — nothing is drawn for it
    T10_in_seconds_1                         INCONCLUSIVE      cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE      cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE      cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE      cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE      cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE      cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE      cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH             cmp 1500 ok 1500 warm 0/0 steady 0/1500 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-60-2026-09-28                 AMEX:SPY 60      18     INCONCLUSIVE      8 of 19 items could not be compared
    T00_bar_index_CONTROL                    INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    T01_timeW_minus_time_DAYS                MATCH             cmp 300 ok 300 warm 0/1 steady 0/299 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH             cmp 300 ok 300 warm 0/1 steady 0/299 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH             cmp 300 ok 300 warm 0/1 steady 0/299 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH             cmp 300 ok 300 warm 0/1 steady 0/299 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    T07_newWeek                              MATCH             cmp 300 ok 299 warm 1/2 steady 0/298 maxRel 0.00e+0
    T08_newMonth                             MATCH             cmp 300 ok 299 warm 1/2 steady 0/298 maxRel 0.00e+0
    T09_newQuarter                           MATCH             cmp 300 ok 299 warm 1/2 steady 0/298 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-type-word-names-spy-1d-2026-10-02         AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:type): a user-defined type is outside the node shapes this engine stores — `color.r`
vw-udt-fn-global-history-rddt-1d-2026-11-16  NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `m[1]` reads what `m` held on an earlier bar, and this script reassigns it
vw-udt-legacy-array-param-rddt-1d-2026-11-16 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:function-def): a Pine function definition introduces a name this engine has nowhere to keep — a Pine function definition introduces a name this engine has nowhere to keep (reached through `f`)
vw-udt-na-index-v5-rddt-1d-2026-11-16        NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `array.get`
vw-udt-na-index-v6-rddt-1d-2026-11-16        NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `array.get`
vw-uie3-na-index-v4-spy-1d-2026-11-16        AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `array.get`
vw-uie3-na-text-spy-1d-2026-11-16            AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:text-value): this script uses a text feature our chart does not render yet. The numeric plots still run; the text output is skipped and named here
vw-v6-bool-history-bar0-rddt-1d-2026-11-19   NYSE:RDDT 1D     11     DIVERGE           H01_b1_eq_false: bar 0 t=1711027800 value vendor=1 ours=0
    H00_bar_index_CONTROL                    MATCH             cmp 670 ok 670 warm 0/0 steady 0/670 maxRel 0.00e+0
    H01_b1_eq_false                          DIVERGE           cmp 670 ok 669 warm 0/0 steady 1/670 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 0
    H02_b1_as_condition                      MATCH             cmp 670 ok 670 warm 0/0 steady 0/670 maxRel 0.00e+0
    H03_not_b1                               DIVERGE           cmp 670 ok 669 warm 0/0 steady 1/670 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 0
    H04_b1_ne_true                           DIVERGE           cmp 670 ok 669 warm 0/0 steady 1/670 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 0
    H05_b_ne_b1                              DIVERGE           cmp 670 ok 669 warm 0/0 steady 1/670 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 0
    H06_edge_b_and_not_b1                    DIVERGE           cmp 670 ok 669 warm 0/0 steady 1/670 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 0
    H07_var_c1_eq_false                      DIVERGE           cmp 670 ok 669 warm 0/0 steady 1/670 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 0
    H08_var_not_c1                           DIVERGE           cmp 670 ok 669 warm 0/0 steady 1/670 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 0
    H09_u1_eq_false                          DIVERGE           cmp 670 ok 669 warm 0/0 steady 1/670 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 0
    H10_b2_eq_false                          DIVERGE           cmp 670 ok 668 warm 0/0 steady 2/670 maxRel 1.00e+0 — 2 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 1
    objects                                  MATCH         neither side draws an object
vw-v6-bool-history-bar0-spy-1d-2026-11-19    AMEX:SPY 1D      11     DIVERGE           H01_b1_eq_false: bar 0 t=728317800 value vendor=1 ours=0
    H00_bar_index_CONTROL                    MATCH             cmp 8511 ok 8511 warm 0/0 steady 0/8511 maxRel 0.00e+0
    H01_b1_eq_false                          DIVERGE           cmp 8511 ok 8510 warm 0/0 steady 1/8511 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 0
    H02_b1_as_condition                      MATCH             cmp 8511 ok 8511 warm 0/0 steady 0/8511 maxRel 0.00e+0
    H03_not_b1                               DIVERGE           cmp 8511 ok 8510 warm 0/0 steady 1/8511 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 0
    H04_b1_ne_true                           DIVERGE           cmp 8511 ok 8510 warm 0/0 steady 1/8511 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 0
    H05_b_ne_b1                              DIVERGE           cmp 8511 ok 8510 warm 0/0 steady 1/8511 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 0
    H06_edge_b_and_not_b1                    DIVERGE           cmp 8511 ok 8510 warm 0/0 steady 1/8511 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 0
    H07_var_c1_eq_false                      DIVERGE           cmp 8511 ok 8510 warm 0/0 steady 1/8511 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 0
    H08_var_not_c1                           DIVERGE           cmp 8511 ok 8510 warm 0/0 steady 1/8511 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 0
    H09_u1_eq_false                          DIVERGE           cmp 8511 ok 8510 warm 0/0 steady 1/8511 maxRel 1.00e+0 — 1 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 0
    H10_b2_eq_false                          DIVERGE           cmp 8511 ok 8509 warm 0/0 steady 2/8511 maxRel 1.00e+0 — 2 steady-state bars disagree; first at bar 0 (value: vendor 1 vs ours 0) — scattered, last at bar 1
    objects                                  MATCH         neither side draws an object
vw-var-seed-spy-1d-2026-09-28                AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `d` builds on its own previous bar and this engine cannot tell that it ever forgets where it started, so folding it would draw a rolling window over the last 250 bars rather than a running total. THIS ENGINE DOES DECLARE A BOUNDED FORM: `cumFrom(<that value>, <anchor>, <bars>)` — the same running total with the starting instant STATED. Stating the window is what makes the answer the same tomorrow — an all-time value moves with however many bars were fetched.
vw-w1-cmo-cog-derived-spy-1d-2026-11-16      AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:arity): the engine grammar declares a different signature for that name — `ta.cmo` was given a source that can be `na` on a bar after its first value, and what TradingView draws there is not known: its published body and its own remark ("na values in the source series are ignored") give different numbers on that bar and the bars after it, and no capture says which it computes, so this engine draws neither. It is served over a price the bar itself holds (`close`, `open`, `high`, `low`, `hl2`, `hlc3`, `ohlc4`, `hlcc4`). TO UNBLOCK: give it one of those, e.g. `ta.cmo(close, 14)`
vw-w19r2-collections-rddt-1d-2026-11-16      NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `array.binary_search`
vw-w19r2a-insert-at-size-rddt-1d-2026-11-16  NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `a` — its slots are written while the script runs, so this lane cannot read one as a value it knows before the first bar
vw-w19r2a-insert-into-empty-rddt-1d-2026-11- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `a` — its slots are written while the script runs, so this lane cannot read one as a value it knows before the first bar
vw-w19r2a-insert-negative-rddt-1d-2026-11-16 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `a` — its slots are written while the script runs, so this lane cannot read one as a value it knows before the first bar
vw-w19r2b-empty-binary-search-rddt-1d-2026-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `array.binary_search`
vw-w19r2b-empty-leftmost-rddt-1d-2026-11-16  NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `array.binary_search_leftmost`
vw-w19r2b-empty-rightmost-rddt-1d-2026-11-16 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `array.binary_search_rightmost`
vw-w3-format-date-spy-1d-2026-11-16          AMEX:SPY 1D      0      DIVERGE           1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 1 paired slots; coordinates are NOT compared by v1
vw-w3-loop-helper-text-spy-1d-2026-11-16     AMEX:SPY 1D      0      DIVERGE           1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 1 paired slots; coordinates are NOT compared by v1
vw-w3-str-repeat-length-spy-1d-2026-11-16    AMEX:SPY 1D      0      DIVERGE           1 of 1 compared items diverge
    objects                                  DIVERGE       2 object families differ (count or text); colours agree on 1 paired slots; coordinates are NOT compared by v1
vw-w34-i4-v2-selfref-seed-spy-1d-2026-11-16  AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `a` reads its own previous bar, and this engine can hold that only when the script states a first-bar value the way `na(a[1]) ? … : …` does
vw-w3n-draw-block-history-a-rddt-1d-2026-11- NYSE:RDDT 1D     2      DIVERGE           1 of 3 compared items diverge
    D01_sma3_plot                            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (pine:block)
    D00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 316 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 1 drawing steps (dropped: create:label ×1; pine:block)
vw-w3n-draw-block-history-a-spy-1d-2026-11-1 AMEX:SPY 1D      2      DIVERGE           1 of 3 compared items diverge
    D01_sma3_plot                            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (pine:block)
    D00_bar_index_CONTROL                    MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 501 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 1 drawing steps (dropped: create:label ×1; pine:block)
vw-w3n-draw-block-history-b-rddt-1d-2026-11- NYSE:RDDT 1D     2      DIVERGE           1 of 3 compared items diverge
    D02_ema3_plot                            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (pine:block)
    D00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 316 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 1 drawing steps (dropped: create:label ×1; pine:block)
vw-w3n-draw-block-history-b-spy-1d-2026-11-1 AMEX:SPY 1D      2      DIVERGE           1 of 3 compared items diverge
    D02_ema3_plot                            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (pine:block)
    D00_bar_index_CONTROL                    MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 501 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 1 drawing steps (dropped: create:label ×1; pine:block)
vw-w3n-draw-block-history-c-rddt-1d-2026-11- NYSE:RDDT 1D     2      DIVERGE           1 of 3 compared items diverge
    D03_rma3_plot                            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (pine:block)
    D00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 316 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 1 drawing steps (dropped: create:label ×1; pine:block)
vw-w3n-draw-block-history-c-spy-1d-2026-11-1 AMEX:SPY 1D      2      DIVERGE           1 of 3 compared items diverge
    D03_rma3_plot                            INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (pine:block)
    D00_bar_index_CONTROL                    MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 501 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 1 drawing steps (dropped: create:label ×1; pine:block)
vw-w3n-draw-block-history-d-rddt-1d-2026-11- NYSE:RDDT 1D     2      DIVERGE           1 of 3 compared items diverge
    D04_block_local_x1_plot                  INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (pine:block)
    D00_bar_index_CONTROL                    MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 316 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 1 drawing steps (dropped: create:label ×1; pine:block)
vw-w3n-draw-block-history-d-spy-1d-2026-11-1 AMEX:SPY 1D      2      DIVERGE           1 of 3 compared items diverge
    D04_block_local_x1_plot                  INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for value (pine:block)
    D00_bar_index_CONTROL                    MATCH             cmp 8507 ok 8507 warm 0/0 steady 0/8507 maxRel 0.00e+0
    objects                                  DIVERGE       TradingView holds 501 drawing object(s) at the last bar and our drawing is withheld by name (pine:object-ops-refused) — the program carried none of its 1 drawing steps (dropped: create:label ×1; pine:block)
vw-w4-arm-runs-rddt-1d-2026-11-16            NYSE:RDDT 1D     14     DIVERGE           W03_fixnan_in_true_arm: bar 7 t=1712064600 value vendor=59.8 ours=45.97
    A00_bar_index_CONTROL                    MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    A01_up_CONTROL                           MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    E01_change2_every_bar                    MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    E02_rma4_every_bar                       MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 1.36e-16
    E03_valuewhen_every_bar                  MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    E04_barssince_every_bar                  MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    C01_change2_in_true_arm                  INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out7 (pine:block)
    C02_change3_on_even_bars                 INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out8 (pine:block)
    R01_rma4_in_true_arm                     INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out9 (pine:block)
    R02_rma3_on_even_bars                    INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out10 (pine:block)
    N01_sma3_in_nested_arm                   INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out11 (pine:block)
    W01_valuewhen_in_true_arm                INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out12 (pine:block)
    W02_barssince_in_true_arm                INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out13 (pine:block)
    W03_fixnan_in_true_arm                   DIVERGE           cmp 667 ok 574 warm 0/0 steady 93/667 maxRel 4.29e-1 — 93 steady-state bars disagree; first at bar 7 (value: vendor 59.8 vs ours 45.97) — scattered, last at bar 663
    objects                                  MATCH         neither side draws an object
vw-w4-arm-runs-spy-1d-2026-11-16             AMEX:SPY 1D      14     DIVERGE           E01_change2_every_bar: bar 8507 t=1794839400 value vendor=-13.549999999999955 ours=-13.529999999999973
    A00_bar_index_CONTROL                    MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    A01_up_CONTROL                           MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    E01_change2_every_bar                    DIVERGE           cmp 8508 ok 8507 warm 0/0 steady 1/8508 maxRel 1.48e-3 — 1 steady-state bars disagree; first at bar 8507 (value: vendor -13.549999999999955 vs ours -13.529999999999973) — persistent, last at bar 8507
    E02_rma4_every_bar                       DIVERGE           cmp 8508 ok 8507 warm 0/0 steady 1/8508 maxRel 6.65e-6 — 1 steady-state bars disagree; first at bar 8507 (value: vendor 751.363468380645 vs ours 751.368468380645) — persistent, last at bar 8507
    E03_valuewhen_every_bar                  MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    E04_barssince_every_bar                  MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    C01_change2_in_true_arm                  INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out7 (pine:block)
    C02_change3_on_even_bars                 INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out8 (pine:block)
    R01_rma4_in_true_arm                     INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out9 (pine:block)
    R02_rma3_on_even_bars                    INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out10 (pine:block)
    N01_sma3_in_nested_arm                   INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out11 (pine:block)
    W01_valuewhen_in_true_arm                INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out12 (pine:block)
    W02_barssince_in_true_arm                INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out13 (pine:block)
    W03_fixnan_in_true_arm                   DIVERGE           cmp 8508 ok 7432 warm 0/0 steady 1076/8508 maxRel 2.19e-1 — 1076 steady-state bars disagree; first at bar 1 (na: vendor na vs ours 43.938) — persistent, last at bar 8507
    objects                                  MATCH         neither side draws an object
vw-w4-max-bars-back-m1-spy-1d-2026-11-18     AMEX:SPY 1D      3      MATCH             all 4 items agree
    A00_bar_index_CONTROL                    MATCH             cmp 8510 ok 8510 warm 0/0 steady 0/8510 maxRel 0.00e+0
    M1_close_30_declared_20                  MATCH             cmp 8510 ok 8510 warm 0/0 steady 0/8510 maxRel 0.00e+0
    M1_is_na                                 MATCH             cmp 8510 ok 8510 warm 0/0 steady 0/8510 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-w4-max-bars-back-m2-spy-1d-2026-11-18     AMEX:SPY 1D      2      MATCH             all 3 items agree
    A00_bar_index_CONTROL                    MATCH             cmp 8510 ok 8510 warm 0/0 steady 0/8510 maxRel 0.00e+0
    M2_close_n_declared_20                   MATCH             cmp 8510 ok 8510 warm 0/0 steady 0/8510 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-w4-max-bars-back-m3-spy-1d-2026-11-18     AMEX:SPY 1D      2      MATCH             all 3 items agree
    A00_bar_index_CONTROL                    MATCH             cmp 8510 ok 8510 warm 0/0 steady 0/8510 maxRel 0.00e+0
    M3_close_n_auto                          MATCH             cmp 8510 ok 8510 warm 0/0 steady 0/8510 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-w4-max-bars-back-m4-spy-1d-2026-11-18     AMEX:SPY 1D      3      MATCH             all 4 items agree
    A00_bar_index_CONTROL                    MATCH             cmp 8510 ok 8510 warm 0/0 steady 0/8510 maxRel 0.00e+0
    M4_x_60_after_mbb50                      MATCH             cmp 8510 ok 8510 warm 0/0 steady 0/8510 maxRel 0.00e+0
    M4_sma_x_60_after_mbb50                  MATCH             cmp 8510 ok 8510 warm 0/0 steady 0/8510 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-w4-max-bars-back-m5-spy-1d-2026-11-18     AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (budget:lookback): this script is not drawn: its plot `M5_close_6000` needs 6000 bars of history behind every bar, and one plot may reach back at most 960 here
vw-w4-series-length-rddt-1d-2026-11-16       NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:window): a Pine length has to reach the engine as a plain whole number — argument 2 of `ta.sma`
vw-w4-series-length-spy-1d-2026-11-16        AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:window): a Pine length has to reach the engine as a plain whole number — argument 2 of `ta.sma`
vw-w4-series-length-v4-rddt-1d-2026-11-16    NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:window): a Pine length has to reach the engine as a plain whole number — argument 2 of `sma`
vw-w4-series-length-v4-spy-1d-2026-11-16     AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:window): a Pine length has to reach the engine as a plain whole number — argument 2 of `sma`
vw-w4-session-daymask-btcusd-60-2026-11-16   BITSTAMP:BTCUSD  0      INCONCLUSIVE      refused on our side: member door refused (pine:text-value): this script uses a text feature our chart does not render yet. The numeric plots still run; the text output is skipped and named here
vw-w4-session-daymask-spy-60-2026-11-16      AMEX:SPY 60      0      INCONCLUSIVE      refused on our side: member door refused (pine:text-value): this script uses a text feature our chart does not render yet. The numeric plots still run; the text output is skipped and named here
vw-w4-session-default-days-btcusd-60-2026-11 BITSTAMP:BTCUSD  5      DIVERGE           DOW_dayofweek: bar 0 t=1704067200 value vendor=2 ours=1
    N0_bar_index_CONTROL                     INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    DOW_dayofweek                            DIVERGE           cmp 25215 ok 20676 warm 0/0 steady 4539/25215 maxRel 6.00e+0 — 4539 steady-state bars disagree; first at bar 0 (value: vendor 2 vs ours 1) — scattered, last at bar 25201
    N1_na_no_day_list                        MATCH             cmp 25215 ok 25215 warm 0/0 steady 0/25215 maxRel 0.00e+0
    N2_na_every_day_CONTROL                  MATCH             cmp 25215 ok 25215 warm 0/0 steady 0/25215 maxRel 0.00e+0
    N3_na_monday_to_friday_CONTROL           DIVERGE           cmp 25215 ok 23916 warm 0/0 steady 1299/25215 maxRel 1.00e+0 — 1299 steady-state bars disagree; first at bar 0 (value: vendor 0 vs ours 1) — scattered, last at bar 25201
    objects                                  MATCH         neither side draws an object
vw-w4-session-default-days-v4-btcusd-60-2026 BITSTAMP:BTCUSD  5      DIVERGE           DOW_dayofweek: bar 0 t=1704067200 value vendor=2 ours=1
    N0_bar_index_CONTROL                     INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    DOW_dayofweek                            DIVERGE           cmp 25216 ok 20677 warm 0/0 steady 4539/25216 maxRel 6.00e+0 — 4539 steady-state bars disagree; first at bar 0 (value: vendor 2 vs ours 1) — scattered, last at bar 25201
    N1_na_no_day_list                        DIVERGE           cmp 25216 ok 23917 warm 0/0 steady 1299/25216 maxRel 1.00e+0 — 1299 steady-state bars disagree; first at bar 0 (value: vendor 0 vs ours 1) — scattered, last at bar 25201
    N2_na_every_day_CONTROL                  MATCH             cmp 25216 ok 25216 warm 0/0 steady 0/25216 maxRel 0.00e+0
    N3_na_monday_to_friday_CONTROL           DIVERGE           cmp 25216 ok 23917 warm 0/0 steady 1299/25216 maxRel 1.00e+0 — 1299 steady-state bars disagree; first at bar 0 (value: vendor 0 vs ours 1) — scattered, last at bar 25201
    objects                                  MATCH         neither side draws an object
vw-w4-session-overnight-btcusd-60-2026-11-16 BITSTAMP:BTCUSD  7      DIVERGE           HOUR: bar 0 t=1704067200 value vendor=0 ours=19
    O0_bar_index_CONTROL                     INCONCLUSIVE       — our side produced no column for this plot — withheld on this chart on every bar, by name (bar-index:window) — nothing is drawn for it
    HOUR                                     DIVERGE           cmp 25215 ok 0 warm 0/0 steady 25215/25215 maxRel 2.00e+1 — 25215 steady-state bars disagree; first at bar 0 (value: vendor 0 vs ours 19) — persistent, last at bar 25214
    DOW_dayofweek                            DIVERGE           cmp 25215 ok 20676 warm 0/0 steady 4539/25215 maxRel 6.00e+0 — 4539 steady-state bars disagree; first at bar 0 (value: vendor 2 vs ours 1) — scattered, last at bar 25201
    O1_na_wrap_all_days                      DIVERGE           cmp 25215 ok 16137 warm 0/0 steady 9078/25215 maxRel 1.00e+0 — 9078 steady-state bars disagree; first at bar 2 (value: vendor 1 vs ours 0) — scattered, last at bar 25203
    O2_na_wrap_weekdays                      DIVERGE           cmp 25215 ok 18730 warm 0/0 steady 6485/25215 maxRel 1.00e+0 — 6485 steady-state bars disagree; first at bar 2 (value: vendor 1 vs ours 0) — scattered, last at bar 25203
    O3_na_to_midnight                        DIVERGE           cmp 25215 ok 16813 warm 0/0 steady 8402/25215 maxRel 1.00e+0 — 8402 steady-state bars disagree; first at bar 1 (value: vendor 1 vs ours 0) — scattered, last at bar 25201
    O4_na_whole_day                          MATCH             cmp 25215 ok 25215 warm 0/0 steady 0/25215 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-w4-session-param-spy-5-2026-11-16         AMEX:SPY 5       0      INCONCLUSIVE      refused on our side: member door refused (pine:function): this Pine function maps to nothing the engine grammar declares — `time(<timeframe>, <session>)`: it is read here on the chart's OWN timeframe (`timeframe.period`), which is what the vendor was measured on. A different period groups the session into bars this chart does not have, and nothing measured says how.
vw-w6-array-every-empty-spy-1d-2026-11-16    AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `array.every`
vw-w6-enum-spy-1d-2026-11-16                 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:type): a user-defined type is outside the node shapes this engine stores — `E.a`
vw-w6-forin-fn-two-sites-rddt-1d-2026-11-16  NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `total`)
vw-w6-forin-fn-value-rddt-1d-2026-11-16      NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — `for` (reached through `lastPass`)
vw-w6-forin-map-rddt-1d-2026-11-16           NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — passes
vw-w6-forin-matrix-rddt-1d-2026-11-16        NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — passes
vw-w6-forin-polyline-all-rddt-1d-2026-11-16  NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:reassign): a name that is reassigned later cannot be folded into one expression — n
vw-w6-forin-write-through-rddt-1d-2026-11-16 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:member): reading a member off the result of an expression needs the type of that result, and Pine decides which family the member belongs to from it — a type this engine does not track. Written with the receiver as the first argument instead, the same call resolves — `.v`
vw-w6-map-rddt-1d-2026-11-15                 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:collection): an array, a matrix or a map is outside the expression grammar this engine runs — `array.indexof`
vw-wsa-v6-bool-unmatched-rddt-1d-2026-11-16  NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:block): a Pine block spans several statements and this engine stores a single expression — an `if` with no `else` returns `na` for a number and, in Pine v6, `false` for a bool, and this branch is not a proven number
vw-wsa-v6-bool-unmatched-tuple-rddt-1d-2026- NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:tuple): this Pine call answers with several values at once and a column carries one — `p` — `f` is a function this script defines and this engine could not read, so none of its values can be handed out — a Pine function definition introduces a name this engine has nowhere to keep — `f` ends in no value this engine can read (reached through `f`)
vw-wsc-h7-v6-shortcircuit-rddt-1d-2026-11-16 NYSE:RDDT 1D     6      INCONCLUSIVE      2 of 7 items could not be compared
    A00_bar_index_CONTROL                    MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    A01_cond_CONTROL                         MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    E01_rising2_every_bar                    MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    E02_crossover_every_bar                  MATCH             cmp 667 ok 667 warm 0/0 steady 0/667 maxRel 0.00e+0
    S01_cond_and_rising2                     INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out5 (pine:block)
    S02_cond_or_crossover                    INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out6 (pine:block)
    objects                                  MATCH         neither side draws an object
vw-wsc-h7-v6-shortcircuit-spy-1d-2026-11-16  AMEX:SPY 1D      6      INCONCLUSIVE      2 of 7 items could not be compared
    A00_bar_index_CONTROL                    MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    A01_cond_CONTROL                         MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    E01_rising2_every_bar                    MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    E02_crossover_every_bar                  MATCH             cmp 8508 ok 8508 warm 0/0 steady 0/8508 maxRel 0.00e+0
    S01_cond_and_rising2                     INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out5 (pine:block)
    S02_cond_or_crossover                    INCONCLUSIVE       — our side produced no column for this plot — computeFor returned no column for out6 (pine:block)
    objects                                  MATCH         neither side draws an object
vw-wse-calc-bars-bar-index-rddt-1d-2026-11-1 NYSE:RDDT 1D     2      MATCH             all 3 items agree
    A00_bar_index                            MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    A01_time_CONTROL                         MATCH             cmp 666 ok 666 warm 0/0 steady 0/666 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
w4-cross-round-spy-1d-2026-09-30             AMEX:SPY 1D      16     INCONCLUSIVE      9 of 17 items could not be compared
    X00_bar_index                            MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    X01_crossover_close_sma5                 MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    X02_crossunder_close_sma5                MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    X03_cross_EITHER_DIRECTION               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    X04_rising3                              MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    X05_falling3                             MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    X06_round_2p5_HALF_UP_OR_EVEN            INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    X07_round_3p5_THE_SAME_QUESTION          INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    X08_round_neg2p5_WHICH_WAY               INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    X09_round_negHalf_IS_IT_MINUS_ZERO       INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    X10_round_close_2dp                      MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    X11_sign_of_zero                         INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    X12_mintick                              INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    X13_pointvalue                           INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    X14_in_seconds_D                         INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    X15_tf_multiplier                        INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    objects                                  MATCH         neither side draws an object
w9-d1-margin50-rddt-1d-2026-11-16            NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.margin_liquidation_price`; strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
w9-d1-margin50-rpt-rddt-1d-2026-11-16        NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.margin_liquidation_price`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-d11-late-first-use-rddt-1d-2026-11-16     NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.opentrades`; strategy INCONCLUSIVE at step 0: strategy-reference: the report is not-requested
w9-d11-late-first-use-rpt-rddt-1d-2026-11-16 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.opentrades`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-g1-v3-properties-rddt-1d-2026-11-15       NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-k1-commission-pct-rddt-1d-2026-11-15      NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-k2-commission-contract-rddt-1d-2026-11-15 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-k3-commission-order-rddt-1d-2026-11-15    NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-k4-slippage-rddt-1d-2026-11-15            NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-mk1-markers-rddt-1d-2026-11-16            NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-mk1-markers-rpt-rddt-1d-2026-11-16        NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-p1-on-close-rddt-1d-2026-11-15            NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-p1b-on-close-fills-nv-rddt-1d-2026-11-15  NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.opentrades`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-p1b-on-close-fills-rddt-1d-2026-11-15     NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `_runs`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-p2-order-fills-nv-rddt-1d-2026-11-15      NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.opentrades`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-p2-order-fills-rddt-1d-2026-11-15         NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `_runs`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-p3-every-tick-history-rddt-1d-2026-11-15  NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-q-s1a-size-stop-v6-rddt-1d-2026-11-17     NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.opentrades`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-q-s1a-size-v2-rddt-1d-2026-11-15          NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-q-s1a-size-v4-rddt-1d-2026-11-15          NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-q-s1a-size-v5cash-rddt-1d-2026-11-15      NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.opentrades`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-q-s1a-size-v5pct-rddt-1d-2026-11-15       NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.opentrades`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-q-s1a-size-v6-rddt-1d-2026-11-15          NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.opentrades`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-q-s1b-defaults-v4-rddt-1d-2026-11-15      NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.initial_capital`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-q-s1b-defaults-v5-rddt-1d-2026-11-15      NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.initial_capital`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-q-s1b-defaults-v6-rddt-1d-2026-11-15      NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.initial_capital`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-q-s1b-v4-shape-a-rddt-1d-2026-11-17       NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.initial_capital`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-q-s1b-v4-shape-b-rddt-1d-2026-11-17       NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.initial_capital`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-q-s1e-live-past-rddt-1d-2026-11-15        NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-q-s1i-funds-rddt-1d-2026-11-17            NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy UNGRADABLE at step 0: the reference has too few trades (0, floor 5)
w9-q-s1i-short-v6-rddt-1d-2026-11-16         NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.opentrades`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-q-s1j-stop-limit-rddt-1d-2026-11-15       NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-q-s1k-exit-levels-rddt-1d-2026-11-15      NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-q-s1k-exit-levels-v6-rddt-1d-2026-11-15   NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-q-s1p-when-rddt-1d-2026-11-15             NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-r1-risk-allow-rddt-1d-2026-11-15          NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-r1-risk-ddown-rddt-1d-2026-11-15          NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-r1-risk-intraday-range-spy-15-2026-11-15  AMEX:SPY 15      0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-x1-trail-rddt-1d-2026-11-15               NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-x2-partial-rddt-1d-2026-11-15             NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.closedtrades`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-x3-oca-rddt-1d-2026-11-15                 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.position_size`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-x4-order-rddt-1d-2026-11-15               NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.opentrades`; strategy EXPECTED-REFUSAL at step 1: refused by door
w9-x5-cancel-rddt-1d-2026-11-15              NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:strategy-call): a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders, fills, positions), which this engine does not simulate — `strategy.opentrades`; strategy EXPECTED-REFUSAL at step 1: refused by door
wyckoff-accumulation-distribution-rddt-1d-20 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `scBarIndex` is read, before it is set, inside the update of another `var` that is itself read before it is set in this one's, so the two carry each other's previous bar and one accumulator holds only one
wyckoff-accumulation-distribution-spy-1d-202 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:state): this value carries forward in a way the bounded accumulator cannot hold. `var` state that re-seeds does translate, as `accum`; what this one needs is a running total with no window, which the grammar has no node for. TO UNBLOCK: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum and the repaint verdict could no longer be decided before the tree runs — so it is not a backlog item. `closedTable.json::_no_offset_reopened_by` names who may re-open that (the repaint-claim owner and the manifest owner, together). Re-seeding the value at a stated window turns it into `accum`, which translates today — `scBarIndex` is read, before it is set, inside the update of another `var` that is itself read before it is set in this one's, so the two carry each other's previous bar and one accumulator holds only one
zero-lag-ma-trend-levels-chartprime-spy-1d-2 AMEX:SPY 1D      4      MATCH             all 5 items agree
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 6.35e-16
    Plot                                     MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 5.59e-16
    plot_8                                   MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 5.09e-16
    plot_10                                  MATCH             cmp 1800 ok 1800 warm 0/0 steady 0/1800 maxRel 3.80e-16
    objects                                  MATCH         object counts and texts agree; colours agree on 267 paired slots (55 theme-relative); coordinates are NOT compared by v1
zero-lag-ma-trend-levels-rddt-1d-2026-09-27  NYSE:RDDT D      4      MATCH             all 5 items agree
    Plot                                     MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 4.96e-16
    Plot                                     MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 3.87e-16
    plot_8                                   MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 4.91e-16
    plot_10                                  MATCH             cmp 631 ok 631 warm 0/0 steady 0/631 maxRel 4.95e-16
    objects                                  MATCH         object counts and texts agree; colours agree on 55 paired slots (13 theme-relative); 15 slots on objects neither side draws not graded; coordinates are NOT compared by v1
zigzag-ma-pattern-recognition-rddt-1d-2026-1 NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:function): `time(<timeframe>)` is the OPENING TIMESTAMP of the enclosing period — the anchor Pine scripts compare with `>` to detect a new day or week. `time("D")` (or a timeframe argument that folds to `"D"`) translates, and so do `"W"`, `"M"`, `"3M"` and `"12M"` on 5-minute, 15-minute, 60-minute, 1D, 1W and 1M charts (vendor captures `vw-time-tf-spy-{5,15,1d-full,1w,1m}-2026-10-01`, `vw-time-tf-spy-60-2026-09-28`); `time(timeframe.period)` is the bar's own `time` on those charts, and `time("60")` the open of its 60-minute bar (the same probe). Any OTHER period this engine does not have a node for: the clock it does declare is `dayofweek`, `dayofmonth`, `month`, `year` and `sessionfirst` — and `sessionfirst` is the closest to what an anchor comparison is usually asking
zigzag-ma-pattern-recognition-spy-1d-2026-11 AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:function): `time(<timeframe>)` is the OPENING TIMESTAMP of the enclosing period — the anchor Pine scripts compare with `>` to detect a new day or week. `time("D")` (or a timeframe argument that folds to `"D"`) translates, and so do `"W"`, `"M"`, `"3M"` and `"12M"` on 5-minute, 15-minute, 60-minute, 1D, 1W and 1M charts (vendor captures `vw-time-tf-spy-{5,15,1d-full,1w,1m}-2026-10-01`, `vw-time-tf-spy-60-2026-09-28`); `time(timeframe.period)` is the bar's own `time` on those charts, and `time("60")` the open of its 60-minute bar (the same probe). Any OTHER period this engine does not have a node for: the clock it does declare is `dayofweek`, `dayofmonth`, `month`, `year` and `sessionfirst` — and `sessionfirst` is the closest to what an anchor comparison is usually asking
zigzag-ma-pattern-recognition-spy-60-2026-11 AMEX:SPY 60      0      INCONCLUSIVE      refused on our side: member door refused (pine:function): `time(<timeframe>)` is the OPENING TIMESTAMP of the enclosing period — the anchor Pine scripts compare with `>` to detect a new day or week. `time("D")` (or a timeframe argument that folds to `"D"`) translates, and so do `"W"`, `"M"`, `"3M"` and `"12M"` on 5-minute, 15-minute, 60-minute, 1D, 1W and 1M charts (vendor captures `vw-time-tf-spy-{5,15,1d-full,1w,1m}-2026-10-01`, `vw-time-tf-spy-60-2026-09-28`); `time(timeframe.period)` is the bar's own `time` on those charts, and `time("60")` the open of its 60-minute bar (the same probe). Any OTHER period this engine does not have a node for: the clock it does declare is `dayofweek`, `dayofmonth`, `month`, `year` and `sessionfirst` — and `sessionfirst` is the closest to what an anchor comparison is usually asking
zigzag-multi-time-frame-with-fibonacci-retra NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
zigzag-multi-time-frame-with-fibonacci-retra NYSE:RDDT 1D     0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
zigzag-multi-time-frame-with-fibonacci-retra AMEX:SPY 1D      0      INCONCLUSIVE      refused on our side: member door refused (pine:no-output): the pasted script offers no plot and no alert condition to filter on
adx-14-2026-09-06                            AMEX:SPY D       1      MATCH             all 1 items agree
    adx                                      MATCH             cmp 273 ok 273 warm 0/193 steady 0/80 maxRel 1.29e-15
atr-14-2026-09-06                            AMEX:SPY D       1      MATCH             all 1 items agree
    atr14                                    MATCH             cmp 1314 ok 1314 warm 0/166 steady 0/1148 maxRel 0.00e+0
ema-close20-2026-09-06                       AMEX:SPY D       1      MATCH             all 1 items agree
    ema20                                    MATCH             cmp 2012 ok 2012 warm 0/81 steady 0/1931 maxRel 6.09e-16
hma-close20-2026-09-06                       AMEX:SPY D       1      MATCH             all 1 items agree
    hma20                                    MATCH             cmp 2009 ok 2009 warm 0/0 steady 0/2009 maxRel 0.00e+0
macd-hist-12-26-9-2026-09-06                 AMEX:SPY D       1      MATCH             all 1 items agree
    histLine                                 MATCH             cmp 1998 ok 1998 warm 0/177 steady 0/1821 maxRel 2.71e-9
macd-line-12-26-2026-09-06                   AMEX:SPY D       1      MATCH             all 1 items agree
    macdLine                                 MATCH             cmp 2006 ok 2006 warm 0/185 steady 0/1821 maxRel 9.66e-12
macd-signal-12-26-9-2026-09-06               AMEX:SPY D       1      MATCH             all 1 items agree
    signalLine                               MATCH             cmp 1998 ok 1998 warm 0/177 steady 0/1821 maxRel 2.97e-11
minus-di-14-2026-09-06                       AMEX:SPY D       1      MATCH             all 1 items agree
    minusDI                                  MATCH             cmp 286 ok 286 warm 0/156 steady 0/130 maxRel 7.44e-16
plus-di-14-2026-09-06                        AMEX:SPY D       1      MATCH             all 1 items agree
    plusDI                                   MATCH             cmp 286 ok 286 warm 0/156 steady 0/130 maxRel 6.61e-16
rma-close14-2026-09-06                       AMEX:SPY D       1      MATCH             all 1 items agree
    rma14                                    MATCH             cmp 2018 ok 2018 warm 0/137 steady 0/1881 maxRel 0.00e+0
rsi-close14-2026-09-06                       AMEX:SPY D       1      MATCH             all 1 items agree
    rsi14                                    MATCH             cmp 1314 ok 1314 warm 0/166 steady 0/1148 maxRel 0.00e+0
sma-close20-2026-09-06                       AMEX:SPY D       1      MATCH             all 1 items agree
    sma20                                    MATCH             cmp 2012 ok 2012 warm 0/0 steady 0/2012 maxRel 2.20e-15
stoch-k-14-2026-09-06                        AMEX:SPY D       1      MATCH             all 1 items agree
    stochK                                   MATCH             cmp 287 ok 287 warm 0/0 steady 0/287 maxRel 0.00e+0
wma-close20-2026-09-06                       AMEX:SPY D       1      MATCH             all 1 items agree
    wma20                                    MATCH             cmp 2012 ok 2012 warm 0/0 steady 0/2012 maxRel 0.00e+0
seed-warmup-spy-12m-2026-09-21               SPY 12M          8      MATCH             all 8 items agree
    N08_ema5_SEED_QUESTION_compare_to_N09_at MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 4.31e-16
    N09_sma5_THE_DISCRIMINATOR_FOR_N08       MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 2.40e-16
    N10_atr5                                 MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
    N11_rma_of_tr5_MUST_EQUAL_N10            MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
    N12_sma_of_tr5_SEED_DISCRIMINATOR        MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 1.81e-16
    N13_stdev5_POPULATION_OR_SAMPLE          MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 9.91e-15
    N15_sum5_PRE_WINDOW_na_or_partial        MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 2.03e-16
    N06_change_close_bar0_is_the_reading     MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
vw-alma-spy-1d-2026-09-27                    AMEX:SPY D       0      INCONCLUSIVE      refused on our side: member door refused (pine:arity): `ta.alma` with `floor = true` rounds the weights' centre down to a whole bar, and this engine carries only the unrounded weighting — TO UNBLOCK: drop the fifth argument, or write it as `false`
vw-clock-vwap-spy-1d-2026-09-27              AMEX:SPY D       15     MATCH             all 16 items agree
    V00_bar_index_CONTROL                    MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V01_year_time_minus_year_MUST_BE_0       MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V02_month_time_minus_month_MUST_BE_0     MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V03_dayofmonth_time_minus_bare_MUST_BE_0 MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V04_dayofweek_time_minus_bare_MUST_BE_0  MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V05_hour_time_minus_hour_MUST_BE_0       MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V06_minute_time_minus_minute_MUST_BE_0   MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V07_vwap_hlc3_minus_vwap_MUST_BE_0       MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V08_vwap_close_minus_vwap_CONTROL_NONZER MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V09_vwap_bare_RAW                        MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V10_vwap_hlc3_RAW                        MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V11_year_time_RAW                        MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V12_dayofweek_time_RAW                   MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V13_year_MUST_SPAN_TWO_VALUES            MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    V14_month_MUST_SPAN_SEVERAL_VALUES       MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-int-cast-spy-1d-2026-09-27                AMEX:SPY D       11     INCONCLUSIVE      6 of 12 items could not be compared
    I00_bar_index_CONTROL                    MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    I01_int_2p7                              INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I02_int_neg2p7                           INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I03_int_2p5                              INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I04_int_neg2p5                           INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I05_int_3p5_CONTROL                      INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I06_int_minus_TRUNC_series               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    I07_int_minus_FLOOR_series               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    I08_int_minus_ROUND_series               MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    I09_int_of_na_IS_NA                      INCONCLUSIVE      cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    I10_x_RAW_so_negatives_are_visible       MATCH             cmp 300 ok 300 warm 0/0 steady 0/300 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-mintick-aapl-1d-2026-09-27                NASDAQ:AAPL D    0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-aitx-1d-2026-09-27                OTC:AITX D       0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-brka-1d-2026-09-27                NYSE:BRK.A D     0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-btcusdt-1d-2026-09-27             BINANCE:BTCUSDT  0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-es1-1d-2026-09-27                 CME_MINI:ES1! D  0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-eurusd-1d-2026-09-27              FX:EURUSD D      0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-nkla-1d-2026-09-27                NASDAQ:NKLA D    0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-sndl-1d-2026-09-27                NASDAQ:SNDL D    0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-spx-1d-2026-09-27                 SP:SPX D         0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-mintick-spy-1d-2026-09-27                 AMEX:SPY D       0      INCONCLUSIVE      refused on our side: member door refused (pine:builtin): this Pine built-in names something the engine grammar does not hold — `syminfo.pricescale`
vw-nvi-pvi-spy-1d-full-2026-09-27            AMEX:SPY D       8      MATCH             all 9 items agree
    P00_bar_index_CONTROL                    MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    P01_nvi_RAW                              MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 1.53e-14
    P02_pvi_RAW                              MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 7.57e-15
    P03_nvi_step_resid_MUST_BE_0             MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 1.54e+3
    P04_pvi_step_resid_MUST_BE_0             MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 4.10e+2
    P05_first_nonNA_pvi_bar                  MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    P06_corpus_nvi_minus_ema255              MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 2.31e-11
    P07_corpus_pvi_minus_ema255              MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 7.25e-12
    objects                                  MATCH         neither side draws an object
vw-nvi-pvi-spy-1d-truncated-2026-09-27       AMEX:SPY D       8      MATCH             all 9 items agree
    P00_bar_index_CONTROL                    MATCH             cmp 1040 ok 1040 warm 0/0 steady 0/1040 maxRel 0.00e+0
    P01_nvi_RAW                              MATCH             cmp 1040 ok 1040 warm 0/0 steady 0/1040 maxRel 1.33e-14
    P02_pvi_RAW                              MATCH             cmp 1040 ok 1040 warm 0/0 steady 0/1040 maxRel 7.52e-15
    P03_nvi_step_resid_MUST_BE_0             MATCH             cmp 1040 ok 1040 warm 0/0 steady 0/1040 maxRel 3.41e+2
    P04_pvi_step_resid_MUST_BE_0             MATCH             cmp 1040 ok 1040 warm 0/0 steady 0/1040 maxRel 3.15e+2
    P05_first_nonNA_pvi_bar                  MATCH             cmp 1040 ok 1040 warm 0/0 steady 0/1040 maxRel 0.00e+0
    P06_corpus_nvi_minus_ema255              MATCH             cmp 1040 ok 1040 warm 0/0 steady 0/1040 maxRel 3.46e-14
    P07_corpus_pvi_minus_ema255              MATCH             cmp 1040 ok 1040 warm 0/0 steady 0/1040 maxRel 1.53e-13
    objects                                  MATCH         neither side draws an object
vw-time-session-spy-1d-2026-09-27            AMEX:SPY D       19     MATCH             all 20 items agree
    S00_bar_index_CONTROL                    MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    S01_hour_MUST_VARY_ON_INTRADAY           MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    S02_minute                               MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    S03_na_0930_1600                         MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    S04_secs_0930_1600                       MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    S05_na_0930_1000_OR_window               MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    S06_secs_0930_1000                       MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    S07_na_1000_1100_EXCLUDES_OPEN           MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    S08_secs_1000_1100                       MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    S09_na_0930_1000_ALLDAYS                 MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    S10_na_0930_1000_MON_FRI_23456           MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    S11_na_OR_GMTminus4_CORPUS_FORM          MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    S12_na_OR_GMTminus5                      MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    S13_na_OR_America_New_York               MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    S14_na_OR_syminfo_timezone               MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    S15_na_2000_0000_OVERNIGHT               MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    S16_na_0930_1030_IB_window               MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    S17_secs_0930_1030                       MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    S18_dayofweek_for_S10                    MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
vw-time-tf-spy-1d-2026-09-27                 AMEX:SPY D       18     INCONCLUSIVE      7 of 19 items could not be compared
    T00_bar_index_CONTROL                    MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T01_timeW_minus_time_DAYS                MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T02_timeM_minus_time_DAYS                MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T03_time3M_minus_time_DAYS               MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T04_time12M_minus_time_DAYS              MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T05_timeSelf_minus_time_MUST_BE_0        MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T06_time60_minus_time_DAYS               MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T07_newWeek                              MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T08_newMonth                             MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T09_newQuarter                           MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    T10_in_seconds_1                         INCONCLUSIVE      cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T11_in_seconds_60                        INCONCLUSIVE      cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T12_in_seconds_D                         INCONCLUSIVE      cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T13_in_seconds_W                         INCONCLUSIVE      cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T14_in_seconds_M                         INCONCLUSIVE      cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T15_in_seconds_12M                       INCONCLUSIVE      cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T16_input_time_default_DAYS              INCONCLUSIVE      cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0 — values agree, but the capture records per-bar colour and our side's colour could not be resolved (our pane draws no series for this row — hidden (constant))
    T17_dayofweek                            MATCH             cmp 8472 ok 8472 warm 0/0 steady 0/8472 maxRel 0.00e+0
    objects                                  MATCH         neither side draws an object
w2-warmup-spy-12m-2026-09-22                 SPY 12M          14     MATCH             all 14 items agree
    W01_rsi5_GATED_ON_RMA                    MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
    W02_highest5                             MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
    W03_lowest5                              MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
    W04_wma5                                 MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
    W05_vwma5                                MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 2.52e-16
    W06_mom5                                 MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
    W07_roc5                                 MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
    W08_dev5                                 MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 4.00e-16
    W09_linreg5_offset0                      MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 7.86e-16
    W10_cci5                                 MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 3.97e-15
    W11_stoch5                               MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
    W12_tr_BARE_na_on_bar0                   MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
    W13_cum_close_FROM_BAR0                  MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0
    W14_sma1_DEGENERATE_WINDOW               MATCH             cmp 34 ok 34 warm 0/0 steady 0/34 maxRel 0.00e+0

TOTAL 974 captures — MATCH 220 · DIVERGE 79 · INCONCLUSIVE 675
WITHOUT OBJECT COLOUR (the verdict before C44; colour graded on 119 captures) — MATCH 220 · DIVERGE 79 · INCONCLUSIVE 675
CHANGED BY OBJECT COLOUR (0): none
WITHOUT PAINTS (the verdict before B1; paints graded on 39 captures) — MATCH 226 · DIVERGE 79 · INCONCLUSIVE 669
CHANGED BY PAINTS (6): supertrend-strategy-alab-1d-2026-11-17 MATCH → INCONCLUSIVE; supertrend-strategy-is-rddt-1d-2026-11-18 MATCH → INCONCLUSIVE; supertrend-strategy-rddt-1d-2026-10-02 MATCH → INCONCLUSIVE; supertrend-strategy-rddt-1d-2026-11-17 MATCH → INCONCLUSIVE; supertrend-strategy-spy-1d-2026-10-02 MATCH → INCONCLUSIVE; vw-bgcolor-barcolor-spy-1d-2026-10-02 MATCH → INCONCLUSIVE
```

## Not comparable (97)

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
- `tests/fixtures/vendor/transparency-defaults-by-version-rddt-1d-2026-11-14.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/tuple-security-spy-1d-closed-2026-09-10.json` — the capture holds a short tail of study values but NOT the vendor's OHLCV — our side cannot be run on the vendor's bars
- `tests/fixtures/vendor/uncharted-volume-v2-agen-1d-hve-2026-09-12.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/uncharted-volume-v2-spy-1d-2026-09-12.json` — only 4 hand-read rows and no vendor OHLCV series
- `tests/fixtures/vendor/uncharted-volume-v2-spy-1d-forced-depth-2026-09-13.json` — only 4 hand-read rows and no vendor OHLCV series
- `tests/fixtures/vendor/visual/five-indicators-spy-1d-2026-09-23.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/visual/fvg-boxes-spy-1d-2026-09-22.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/visual/marker-semantics-spy-1d-2026-09-07.json` — vendor readings are not a per-bar `values` series (split rows or named samples) — nothing contiguous to compare bar by bar
- `tests/fixtures/vendor/visual/object-semantics-spy-1d-2026-09-08.json` — no vendor OHLCV series together with per-bar study values and a script source
- `tests/fixtures/vendor/w3-format-spy-1d-2026-09-22.json` — no vendor OHLCV series together with per-bar study values and a script source
