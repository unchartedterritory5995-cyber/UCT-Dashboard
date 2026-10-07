// ⛔ HARNESS DOUBLE — NOT A MODEL. Stands in for /api/agent/turn in
// agent-harness.html (no model key exists locally). It returns ENVELOPES only,
// keyed off a few phrases, using refs from the context it was sent — so every
// step after it (planner, policy, runtime, ACK, receipt, undo) is the real code.

const env = (disposition, ops = [], reply = '', question = null, cat = null) =>
  ({ disposition, reply, question, ops, unsupported_category: cat })

export function scriptedTurn(body) {
  const m = String(body.message || '').toLowerCase()
  const charts = body.context?.charts || []
  const names = new Set((body.capabilities || []).map(c => c.name))
  const first = charts[0]?.ref

  if (/^(what|why|how|explain|is |are |does |should )/.test(m) || m.endsWith('?')) {
    return env('answer', [], 'An exponential moving average (EMA) weights recent prices more heavily, so it turns faster than a simple moving average (SMA), which weights every bar in the window equally. Traders use the EMA for responsiveness and the SMA for a steadier read of trend. (harness double)')
  }
  if (/this one|this chart/.test(m) && charts.length > 1 && /weekly|daily|bars|candles/.test(m)) {
    return env('clarify', [], '', { text: 'Which chart do you mean?', choices: charts.map(c => c.label) })
  }
  if (/cleaner|look calmer|tidy/.test(m)) {
    if (!first) return env('answer', [], 'There is no chart to restyle.')
    return env('propose', [
      { action: 'chart.applyTheme', target: first, args: { theme: 'cream' } },
      { action: 'volume.setState', target: first, args: { state: 'hidden' } },
    ], 'A light, calm canvas without the volume noise.')
  }
  if (/indicator|rsi|macd|moving average|ema|sma/.test(m)) {
    return env('unsupported', [], "I can't add or change indicators yet — use Chart Settings › Indicators, or Create Indicator for a custom one.", null, 'indicators')
  }
  const target = /right/.test(m) ? charts[charts.length - 1]?.ref : first
  const ops = []
  if (/\bbars\b/.test(m)) ops.push({ action: 'chart.setType', target, args: { type: 'bars' } })
  if (/\bline\b/.test(m)) ops.push({ action: 'chart.setType', target, args: { type: 'line' } })
  if (/weekly/.test(m)) ops.push({ action: 'chart.setTimeframe', target, args: { timeframe: 'W' } })
  if (/hide volume/.test(m)) ops.push({ action: 'volume.setState', target, args: { state: 'hidden' } })
  const bg = /background (?:to )?(cream|white|black|navy|#[0-9a-f]{6})/.exec(m)
  if (bg) ops.push({ action: 'chart.setBackground', target, args: { color: bg[1] } })
  if (ops.length && ops.every(o => names.has(o.action)) && target) {
    if (charts.length > 1 && !/right|left/.test(m)) {
      return env('clarify', [], '', { text: 'Which chart do you mean?', choices: charts.map(c => c.label) })
    }
    return env('apply', ops)
  }
  return env('unsupported', [], "I can't do that yet.", null, 'other')
}
