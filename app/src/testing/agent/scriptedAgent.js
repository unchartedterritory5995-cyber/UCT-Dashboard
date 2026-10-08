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

  // Screener requests — the production model's shape (measured 2026-10-07): field keys
  // taken from the screener catalog in context, "above"=gt, "at least"=gte.
  const scr = body.context?.screener?.[0]
  // Screen → watchlist composition — the production model's shape (measured 2026-10-07):
  // screener.run {as:"screen1"} → [watchlist.create {as:"new1"}] → watchlist.add {symbols:{from,top}}.
  const comp = /^(?:find|show me) stocks with (.+?)(?:, then| and then| and)? (?:put|add) the top (\d+) (?:in a (?:new )?watch ?list called (.+?)|to (.+?))[.!]?$/i.exec(String(body.message || '').trim())
  if (scr && comp) {
    const keys = String(scr.fields || '').split(';').map(x => x.split(':')[0])
    const filters = []
    const adr = /adr (?:above|over) (\d+(?:\.\d+)?)/i.exec(comp[1])
    if (adr && keys.includes('adr_pct')) filters.push({ field: 'adr_pct', op: 'gt', value: Number(adr[1]), max: null })
    const px = /price (?:above|over) \$?(\d+(?:\.\d+)?)/i.exec(comp[1])
    if (px && keys.includes('price')) filters.push({ field: 'price', op: 'gt', value: Number(px[1]), max: null })
    const sorted = /sort by adr highest first/i.test(comp[1])
    const ops = [{ action: 'screener.run', target: scr.ref, args: { filters, sort_field: sorted ? 'adr_pct' : null, sort_dir: sorted ? 'desc' : null, mode: 'new', show: null, as: 'screen1' } }]
    const top = Number(comp[2])
    if (comp[3]) {
      const lib = body.context?.watchlistLibrary?.[0]
      ops.push({ action: 'watchlist.create', target: lib.ref, args: { name: comp[3], as: 'new1' } })
      ops.push({ action: 'watchlist.add', target: 'new1', args: { symbols: { from: 'screen1', top } } })
    } else {
      const wl = (body.context?.watchlists || []).find(w => w.name.toLowerCase() === comp[4].toLowerCase())
      ops.push({ action: 'watchlist.add', target: wl?.ref || comp[4], args: { symbols: { from: 'screen1', top } } })
    }
    return env('propose', ops, 'Screen, then fill the list with the results.')
  }
  // Symbol sources → charts: screener.run|watchlist.show {as} → widget.addCharts {symbols:{from,top}}.
  const ws0 = body.context?.workspace?.[0]?.ref
  const tfOf = (t) => (/5-?min/i.test(t) ? '5' : /daily/i.test(t) ? 'D' : /weekly/i.test(t) ? 'W' : null)
  const chartsOp = (from, top, text) => ({ action: 'widget.addCharts', target: ws0, args: { symbols: { from, top }, timeframe: tfOf(text), chart_type: /\bbars\b/i.test(text) ? 'bars' : null, exact: /exactly/i.test(text) } })
  const sc = /^find stocks with (.+?),? (?:and |then )?(?:open|chart) (?:exactly )?the top (\d+) as (.*?)charts?[.!]?$/i.exec(String(body.message || '').trim())
  if (scr && ws0 && sc) {
    const keys = String(scr.fields || '').split(';').map(x => x.split(':')[0])
    const filters = []
    const adr = /adr (?:above|over) (\d+(?:\.\d+)?)/i.exec(sc[1])
    if (adr && keys.includes('adr_pct')) filters.push({ field: 'adr_pct', op: 'gt', value: Number(adr[1]), max: null })
    const sorted = /sort(?:ed)? by adr highest first/i.test(sc[1])
    return env('propose', [
      { action: 'screener.run', target: scr.ref, args: { filters, sort_field: sorted ? 'adr_pct' : null, sort_dir: sorted ? 'desc' : null, mode: 'new', show: null, as: 'screen1' } },
      chartsOp('screen1', Number(sc[2]), String(body.message)),
    ], 'Screen, then chart the results.')
  }
  const lc = /^(?:open|chart) (?:the (?:first|top) (\d+) (?:stocks )?(?:in|of) )?(?:my |the )?(.+?) (?:watch ?list )?as (.*?)charts?[.!]?$/i.exec(String(body.message || '').trim())
  if (ws0 && lc && !/^those$/i.test(lc[2])) {
    const hits = (body.context?.watchlists || []).filter(w => w.name.toLowerCase().includes(lc[2].toLowerCase().replace(/ watch ?list$/, '')))
    if (hits.length > 1) return env('clarify', [], '', { text: 'Which watchlist?', choices: hits.map(h => h.name) })
    if (!hits.length) return env('answer', [], `You don't have a watchlist called ${lc[2]}.`)
    return env('propose', [
      { action: 'watchlist.show', target: hits[0].ref, args: { as: 'list1' } },
      chartsOp('list1', Number(lc[1]) || Math.min(12, hits[0].count || 12), String(body.message)),
    ], 'Chart that list.')
  }
  const tc = /^(?:open|chart) the top (\d+) of (?:those|that screen) as (.*?)charts?[.!]?$/i.exec(String(body.message || '').trim())
  if (ws0 && tc) return env('propose', [chartsOp('lastScreen', Number(tc[1]), String(body.message))], 'Chart the last screen.')

  if (scr && /^(show me|find|screen for) stocks/i.test(String(body.message || '').trim())) {
    const keys = String(scr.fields || '').split(';').map(x => x.split(':')[0])
    const filters = []
    const adr = /adr (?:above|over) (\d+(?:\.\d+)?)/i.exec(m)
    if (adr && keys.includes('adr_pct')) filters.push({ field: 'adr_pct', op: 'gt', value: Number(adr[1]), max: null })
    const px = /price (?:above|over) \$?(\d+(?:\.\d+)?)/i.exec(m)
    if (px && keys.includes('price')) filters.push({ field: 'price', op: 'gt', value: Number(px[1]), max: null })
    const up = /up at least (\d+)% over the last month/i.exec(m)
    if (up && keys.includes('chg_pct_1m')) filters.push({ field: 'chg_pct_1m', op: 'gte', value: Number(up[1]), max: null })
    if (/reddit/i.test(m)) return env('unsupported', [], "The Screener doesn't have a Reddit-mentions field.", null, 'screener')
    return env('apply', [{ action: 'screener.run', target: scr.ref, args: { filters, sort_field: null, sort_dir: null, mode: 'new', show: null, as: null } }])
  }

  // "Create a watchlist called X with A, B and C" — the production model's shape
  // (measured 2026-10-07): create with `as`, then add to that alias.
  const wlib = body.context?.watchlistLibrary?.[0]
  const cm = /^create a (?:new )?watch ?list (?:called|named) (.+?)(?: with (.+?))?[.!]?$/i.exec(String(body.message || '').trim())
  if (wlib && cm) {
    const ops = [{ action: 'watchlist.create', target: wlib.ref, args: { name: cm[1], as: cm[2] ? 'new1' : null } }]
    if (cm[2]) ops.push({ action: 'watchlist.add', target: 'new1', args: { symbols: cm[2].split(/\s*(?:,|\band\b)\s*/).filter(Boolean).map(s => s.toUpperCase()) } })
    return env('propose', ops, `I'll create ${cm[1]}${cm[2] ? ' and fill it' : ''}.`)
  }

  // Layout names the fast path could not resolve (as the production model does, measured
  // 2026-10-07): several real matches → clarify with them; none → say so, invent nothing.
  const lib = body.context?.layouts?.[0]
  const lm = /^(?:open|switch to|take me to|go to) (?:my |the )?(.+?)(?: layout)?$/.exec(m.replace(/[.!?]+$/, ''))
  if (lib && lm) {
    const want = lm[1].trim()
    const hits = lib.layouts.filter(l => l.name.toLowerCase().includes(want))
    if (hits.length === 1) return env('apply', [{ action: 'layout.open', target: lib.ref, args: { layout: hits[0].id } }])
    if (hits.length > 1) return env('clarify', [], '', { text: 'Which layout?', choices: hits.map(h => h.name) })
    return env('answer', [], `You don't have a layout called ${want}. Your layouts: ${lib.layouts.map(l => l.name).join(', ')}.`)
  }

  // "Add 4 charts. Make them all 5-minute. Put SPY, QQQ, NVDA and TSLA in them."
  const nm = /add (\d+|two|three|four|five|six) charts?/.exec(m)
  const ws = body.context?.workspace?.[0]?.ref
  if (nm && ws) {
    const words = { two: 2, three: 3, four: 4, five: 5, six: 6 }
    const n = Number(nm[1]) || words[nm[1]]
    const syms = (String(body.message).match(/\b[A-Z]{2,5}\b/g) || []).slice(0, n)
    const tf = /5-?min/.test(m) ? '5' : null
    const ops = []
    for (let i = 1; i <= n; i++) ops.push({ action: 'widget.add', target: ws, args: { type: 'chart', as: `new${i}` } })
    if (tf) for (let i = 1; i <= n; i++) ops.push({ action: 'chart.setTimeframe', target: `new${i}`, args: { timeframe: tf } })
    syms.forEach((s, i) => ops.push({ action: 'chart.setSymbol', target: `new${i + 1}`, args: { symbol: s } }))
    return env('propose', ops, `I'll add ${n} charts${tf ? ' on 5-minute' : ''}${syms.length ? `: ${syms.join(', ')}` : ''}.`)
  }
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
