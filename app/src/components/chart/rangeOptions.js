// The chart's range bar: label → what applyRange (StockChart) takes. Value = months back from the newest bar; 'ytd' =
// since Jan 1 of the newest bar's year; 'origin' = the first bar. One list, read by the bar and by UCT Agent's
// chartSetup.setRange, so a new button reaches the Agent the day it ships.
export const RANGE_OPTS = [
  ['3M', 3], ['6M', 6], ['YTD', 'ytd'], ['1Y', 12], ['5Y', 60], ['Origin', 'origin'],
]
