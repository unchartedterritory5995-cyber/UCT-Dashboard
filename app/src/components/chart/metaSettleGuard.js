// WHEN A METADATA ANSWER MAY RE-ASSERT THE SETTLING FRAME (2026-11-24, next-row switch).
//
// `settleOnMetaLanded` (StockChart.jsx) frames the chart in the index space of the bars it is handed: the newest bar is
// `bars.length - 1`. That is a frame of THIS board only on a chart whose series hold exactly those bars. The chart's
// own record of what it holds is the array the last `updateChart` pass painted (`prevBarsRef`: stamped at the end of
// every pass, cleared whenever the series are emptied or the chart is rebuilt). When the two differ, the chart still
// holds another board (the outgoing name on a list switch, or the same name before prepended history is painted) and a
// pass for these bars is already coming (the switch applier's layout effect, or the passive effect of the commit that
// changed them), which re-asserts the settling frame itself.
//
// Identity, not the symbol: a same-symbol commit that prepends history moves every index as surely as a new symbol.

/** True when the chart's series hold exactly `bars` (the array the last updateChart pass painted is `bars`). */
export function settleBoardReady(paintedBars, bars) {
  return paintedBars === bars
}
