// Quick replies fit the board on screen: the top chart's symbol, a change the chart isn't already
// in, one tap that does two things at once. A tap sends the text as the member's own message.
const INDICATOR_IDEA = 'Build an indicator that flags volume spikes'
export function quickReplies(charts) {
  const list = Array.isArray(charts) ? charts : []
  const top = list[0]
  const sym = top?.symbol || 'SPY'
  let change
  if (list.length === 1) {
    const tf = top.tf === 'W' ? 'daily' : 'weekly'
    const style = (top.cs?.chartType || 'candles') === 'candles' ? 'bars' : 'candles'
    change = `Switch this chart to ${tf} ${style}`
  } else {
    const onBoard = new Set(list.map(c => c.symbol))
    change = `Add a chart for ${['QQQ', 'SPY', 'IWM'].find(t => !onBoard.has(t)) || 'NVDA'}`
  }
  return [change, `Why is ${sym} moving today?`, INDICATOR_IDEA]
}
