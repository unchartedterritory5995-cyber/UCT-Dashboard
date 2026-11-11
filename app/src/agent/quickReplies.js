// Quick replies fit the board on screen: the top chart's symbol, a change the chart isn't already
// in, one tap that does two things at once. A tap sends the text as the member's own message.
const INDICATOR_IDEA = 'Build an indicator that flags volume spikes'
// ⭐ W2-C1: on a page other than /charts the replies fit THAT page (its own reads and writes); the Charts
// list below is untouched.
const PAGE_REPLIES = {
  screener: ['What screen is on this page?', 'List my saved screens', 'Why is SPY moving today?'],
  breadth: ['What does this breadth page show?', 'How is US breadth looking now?', 'When was US breadth last below 20% above the 50-day?'],
  calendar: ['When does NVDA report next?', 'What reports are on this week?', 'Why is SPY moving today?'],
  journal: ['List my recent notes', 'Add a note: what I am watching this week', 'Why is SPY moving today?'],
}
export function quickReplies(charts, surface = 'charts') {
  if (surface !== 'charts' && PAGE_REPLIES[surface]) return [...PAGE_REPLIES[surface]]
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
