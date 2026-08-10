# SOURCES

## 01-stoch-rsi-screener.pine
- URL: https://raw.githubusercontent.com/ahmetkasa/Pine-Script/main/Stoch%20RSI%20Screener
- Author/repo: ahmetkasa — github.com/ahmetkasa/Pine-Script (file "Stoch RSI Screener")
- Computes Stochastic RSI %K/%D and screens 40 selectable BIST symbols via `request.security`, printing every ticker whose %K crosses over %D into one dynamic label.

## 02-ict-retracement-to-order-block-screener.pine
- URL: https://raw.githubusercontent.com/ArunKBhaskar/PineScript/main/%5BScreener%5D%20ICT%20Retracement%20to%20Order%20Block%20with%20Screener.txt
- Author/repo: © Arun_K_Bhaskar — github.com/ArunKBhaskar/PineScript
- Detects an ICT order block plus a three-stage retracement back into it and renders a 40-symbol screener table of which tickers are at each stage.

## 03-rsi-directional-momentum-scanner.pine
- URL: https://raw.githubusercontent.com/ArunKBhaskar/PineScript/main/Momentum%20Setup%20-%20RSI%20Directional%20Momentum/%5BScanner%5D%20Momentum%20Setup%20-%20RSI%20Directional%20Momentum.txt
- Author/repo: © Arun_K_Bhaskar — github.com/ArunKBhaskar/PineScript
- Scans a symbol list for RSI continuous-break / retracement / flip-break momentum states and reports the matches in an on-chart scanner table.

## 04-superguppy-supertrend-screener.pine
- URL: https://raw.githubusercontent.com/rKv4dr4t/SuperGuppy_SuperTrend_Screener/main/SuperGuppySTPPScreener.pine
- Author/repo: rKv4dr4t — github.com/rKv4dr4t/SuperGuppy_SuperTrend_Screener
- Combines Guppy multiple-moving-average trend state with SuperTrend pivot points and emits uptrend/neutral/downtrend counts plus `alertcondition` trend-break and swing alerts.

## 05-mtf-structure-bias.pine
- URL: https://raw.githubusercontent.com/casoon/pine-scripts/main/indicators/market_structure/mtf_structure_bias/mtf_structure_bias.pine
- Author/repo: WavesUnchained — github.com/casoon/pine-scripts
- Classifies market structure as +1/0/-1 on four higher timeframes via `request.security` on rolling highest-high / lowest-low and plots the aggregate bias.

## 06-adx-advanced.pine
- URL: https://raw.githubusercontent.com/casoon/pine-scripts/main/indicators/trend_strength/adx_advanced/adx_advanced.pine
- Author/repo: WavesUnchained — github.com/casoon/pine-scripts
- ADX with DI+/DI- lines, pluggable smoothing kernels and four `alertcondition` trend-strength triggers.

## 07-rsi.pine
- URL: https://raw.githubusercontent.com/everget/tradingview-pinescript-indicators/master/oscillators/rsi_relative_strength_index.pine
- Author/repo: © Alex Orekhov (everget), GPL-3.0 — github.com/everget/tradingview-pinescript-indicators
- Relative Strength Index with overbought/oversold band fills, divergence-friendly plotting and highlight options.

## 08-stochastic-v4.pine
- URL: https://raw.githubusercontent.com/everget/tradingview-pinescript-indicators/master/oscillators/stochastic.pine
- Author/repo: © Alex Orekhov (everget), GPL-3.0 — github.com/everget/tradingview-pinescript-indicators
- Pine v4 Stochastic oscillator (`study`, bare `sma`/`stoch`/`crossover`) with %K/%D ribbon, histogram and breakout highlighting.

## 09-on-balance-volume.pine
- URL: https://raw.githubusercontent.com/everget/tradingview-pinescript-indicators/master/volume/on_balance_volume.pine
- Author/repo: © Alex Orekhov (everget), GPL-3.0 — github.com/everget/tradingview-pinescript-indicators
- On Balance Volume with an optional smoothing moving average.

## 10-supertrend.pine
- URL: https://raw.githubusercontent.com/everget/tradingview-pinescript-indicators/master/trailing_stops/supertrend.pine
- Author/repo: © Alex Orekhov (everget), GPL-3.0 — github.com/everget/tradingview-pinescript-indicators
- ATR-based SuperTrend trailing stop with buy/sell flip markers and `alertcondition` direction-change alerts.

## 11-donchian-channel.pine
- URL: https://raw.githubusercontent.com/f13end/tradingview-custom-indicators/master/channels/Donchian%20Channel%20indicator.pine
- Author/repo: github.com/f13end/tradingview-custom-indicators (channels collection)
- Donchian Channel upper/lower/mid bands with optional fill and breakout `alertcondition` signals.

## 12-ichimoku-clouds.pine
- URL: https://raw.githubusercontent.com/f13end/tradingview-custom-indicators/master/indicators/Ichimoku%20Clouds%20%5BYield%5D
- Author/repo: created by Yield, CC BY-NC-ND 4.0 — via github.com/f13end/tradingview-custom-indicators
- Full Ichimoku Kinko Hyo (Tenkan, Kijun, Senkou A/B cloud, Chikou) with configurable periods and cross alerts.

## 13-average-true-range.pine
- URL: https://raw.githubusercontent.com/f13end/tradingview-custom-indicators/master/strategies/Highlight%20ATR.pine
- Author/repo: github.com/f13end/tradingview-custom-indicators (filed under strategies, but declares `study`)
- Average True Range in regular / percentage / ticks / currency units with selectable smoothing and six threshold `alertcondition`s.

## 14-bollinger-bands-fixed-timeframe.pine
- URL: https://raw.githubusercontent.com/f13end/tradingview-custom-indicators/master/indicators/Fixed%20timeframe%20Bollinger%20Bands
- Author/repo: github.com/f13end/tradingview-custom-indicators, credited in-file to munkeefonix and yield65
- Bollinger Bands locked to a fixed time interval regardless of chart timeframe, plus a %B breach indicator with two `alertcondition`s.

## 15-anchored-vwap.pine
- URL: https://raw.githubusercontent.com/casoon/pine-scripts/main/indicators/mean_reversion/anchored_vwap/anchored_vwap.pine
- Author/repo: WavesUnchained — github.com/casoon/pine-scripts
- VWAP anchored to a selectable origin (swing pivot, session/week/month/year, or manual date) with volume-weighted sigma bands and a stats table.

## 16-smacd.pine
- URL: https://raw.githubusercontent.com/f13end/tradingview-custom-indicators/master/indicators/SmacD.pine
- Author/repo: github.com/f13end/tradingview-custom-indicators
- MACD variant built from five stacked EMA differences, plotted as coloured columns against its signal line.

## 17-simple-moving-average.pine
- URL: https://raw.githubusercontent.com/everget/tradingview-pinescript-indicators/master/movings/simple_moving_average.pine
- Author/repo: © Alex Orekhov (everget), GPL-3.0 — github.com/everget/tradingview-pinescript-indicators
- Nine-line Simple Moving Average overlay with length and source inputs.

## 18-normalized-average-true-range.pine
- URL: https://raw.githubusercontent.com/everget/tradingview-pinescript-indicators/master/volatility/normalized_average_true_range.pine
- Author/repo: © Alex Orekhov (everget), GPL-3.0 — github.com/everget/tradingview-pinescript-indicators
- Normalized ATR: ATR expressed as a percentage of close, in eleven lines.

## 19-strategy-supertrend-atr.pine
- URL: https://raw.githubusercontent.com/f13end/tradingview-custom-indicators/master/strategies/SuperTrend%20ATR
- Author/repo: "XTR SuperTrend ATR Strategy" — github.com/f13end/tradingview-custom-indicators
- Backtestable `strategy()` that enters and exits on SuperTrend flips with a date-range filter, pyramiding and percentage commission.

## 20-smc-toolkit-udt.pine
- URL: https://raw.githubusercontent.com/btankutt/smc-pine-suite/main/indicators/01-smc-toolkit/smc-toolkit.pine
- Author/repo: Baris Tankut (@btankutt), MPL-2.0 — github.com/btankutt/smc-pine-suite
- Smart-Money-Concepts toolkit using user-defined `type`s (OrderBlock, FVG, LiquidityLevel), arrays, `box.new`/`line.new`/`label.new` drawings, `var` state and `for` loops to track structure, order blocks, fair value gaps and liquidity sweeps.

## 21-volume-profile-plus.pine
- URL: https://raw.githubusercontent.com/btankutt/smc-pine-suite/main/indicators/02-volume-profile-plus/volume-profile-plus.pine
- Author/repo: Baris Tankut (@btankutt), MPL-2.0 — github.com/btankutt/smc-pine-suite
- Volume profile with POC and value area, built from float arrays binned in `for` loops and rendered with `box.new`/`line.new`/`label.new`.
