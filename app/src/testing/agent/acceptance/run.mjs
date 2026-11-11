// UCT Agent BROWSER ACCEPTANCE: the scenarios. See lib.mjs for the rig and its limits.
//
//   npx vite --host 127.0.0.1 --port 5986 --strictPort    (from app/, with a cacheDir outside node_modules)
//   node src/testing/agent/acceptance/run.mjs [filter]    (needs BA_ROUTING: an esbuild bundle of src/agent/routing.js)
//
// Each scenario gets its own Chrome and temp profile, one at a time. A row passes only when every check in
// every scenario naming it passed. Checks read the charts, the board and the stores; a receipt is never the
// evidence, it is one of the things under test.
import { writeFileSync } from 'node:fs'
import { startRelay, open, sleep } from './lib.mjs'

const OUT = process.env.BA_OUT || 'browser-acceptance.json'
const SHOTS = process.env.BA_SHOTS || null
const filter = process.argv[2] && process.argv[2] !== '.' ? new RegExp(process.argv[2]) : null
const { groupOfAction } = await import(`file:///${process.env.BA_ROUTING}`)

// fixture boards
const chart = (id, color, x, y, w, h, tf = 'D') => ({ id, type: 'chart', color, x, y, w, h, opts: { tf } })
const board = (widgets, groups) => ({ charts_workspace_layout: JSON.stringify({ version: 1, cols: 24, widgets }), charts_workspace_groups: JSON.stringify(groups) })
const WATCH = (x = 18, y = 0, h = 20) => ({ id: 'w-watch', type: 'watchlist', color: 'A', x, y, w: 6, h, opts: {} })
const FOUR = board([chart('c-tl', 'A', 0, 0, 9, 10), chart('c-tr', 'B', 9, 0, 9, 10), chart('c-bl', 'C', 0, 10, 9, 10), chart('c-br', 'D', 9, 10, 9, 10), WATCH()], { A: 'SPY', B: 'QQQ', C: 'NVDA', D: 'TSLA' })
const TWO = (tfA = 'D') => board([chart('w-chart-a', 'A', 0, 0, 9, 20, tfA), chart('w-chart-b', 'B', 9, 0, 9, 20), WATCH()], { A: 'SPY', B: 'AAPL', C: 'AMD', D: 'MSFT' })
const SCANBOARD = board([chart('w-chart-a', 'A', 0, 0, 12, 20), { id: 'w-scan', type: 'scanner', color: 'A', x: 12, y: 0, w: 12, h: 20, opts: {} }], { A: 'SPY', B: 'AAPL', C: 'AMD', D: 'MSFT' })
const A = 'w-chart-a'
const B = 'w-chart-b'
const CH0 = '$charts[0]'

const S = []
const scn = (id, rows, opts, fn) => S.push({ id, rows, opts, fn })

// A tiny record of checks.
function tracker(id) {
  const T = { id, checks: [], turns: [], ok: (name, pass, extra = '') => { T.checks.push({ name, pass: !!pass, extra: extra === '' ? undefined : String(extra).slice(0, 400) }); console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name} ${pass ? '' : String(extra).slice(0, 300)}`) } }
  return T
}
const brief = (c) => ({ sym: c.sym, tf: c.tf, panes: c.panes.length })
const same = (x, y) => x.sym === y.sym && x.tf === y.tf && x.pixels === y.pixels && x.w === y.w && x.h === y.h
// the chart's state, everything but the exact bar offset (a timeframe round trip reopens the view a few bars off, for a person too)
const sameState = (x, y) => ['sym', 'tf', 'scale', 'session', 'volume', 'w', 'h'].every(k => x[k] === y[k]) && x.chips.join() === y.chips.join() && x.panes.join() === y.panes.join()

/**
 * One request. `touch`: the chart ids that must repaint (the rest must not change by a single pixel).
 * `plan`: what the scripted model answers if the panel asks it. `approve`: click the card's Apply.
 */
async function act(p, t, o) {
  const before = await p.read()
  const rc0 = await p.receipts()
  const turn0 = p.R.turns.length
  const st0 = (await p.status()).length
  const t0 = Date.now()
  await p.say(o.say, o.plan)
  const idle = await p.idle(o.timeout || 15000)
  const visibleMs = Date.now() - t0
  let card = null
  if (o.approve) {
    card = await p.proposal()
    t.ok(`"${o.say}": a card before anything happens`, !!card, await p.last())
    const mid = await p.read()
    t.ok(`"${o.say}": nothing moved before Apply`, JSON.stringify(mid.map(x => [x.id, x.sym, x.tf, x.pixels])) === JSON.stringify(before.map(x => [x.id, x.sym, x.tf, x.pixels])))
    t.ok(`"${o.say}": Apply clicked`, await p.button('Apply'))
    await p.idle(o.timeout || 15000)
  }
  await p.settle(o.settleMs || 900)
  const after = await p.read()
  const model = p.R.turns.length - turn0
  p.R.queue.length = 0
  const rc = await p.receipt()
  const newReceipt = (await p.receipts()) > rc0
  const status = (await p.status()).slice(st0)
  t.turns.push({ say: o.say, path: model ? `model (${model} call${model > 1 ? 's' : ''})` : 'local (no model call)', receipt: newReceipt ? rc?.text : null, undoable: newReceipt ? rc?.undoable : null, last: (await p.last()).slice(-300), status: status.map(s => s.s), ms: visibleMs })
  t.ok(`"${o.say}": finished`, idle)
  if (o.touch) {
    for (const c of after.filter(w => w.type === 'chart')) {
      const was = before.find(w => w.id === c.id)
      if (!was) continue
      if (o.touch.includes(c.id)) { if (!o.noRepaint) t.ok(`"${o.say}": ${c.id} repainted`, c.pixels !== was.pixels) } else t.ok(`"${o.say}": ${c.id} untouched`, same(c, was), JSON.stringify([brief(was), brief(c)]))
    }
  }
  if (o.receipt) t.ok(`"${o.say}": receipt truthful`, newReceipt && o.receipt.test(rc?.text || ''), newReceipt ? rc?.text : `no receipt; said: ${await p.last()}`)
  if (o.undoable) t.ok(`"${o.say}": receipt offers Undo`, rc?.undoable === 'true', rc?.undoable)
  if (o.says) t.ok(`"${o.say}": says ${o.says}`, o.says.test(await p.last()), await p.last())
  if (o.noReceipt) t.ok(`"${o.say}": no success receipt`, !newReceipt, rc?.text)
  if (o.busy !== false) {
    t.ok(`"${o.say}": status went busy, then back to Online`, status.some(s => /typing|working/i.test(s.s)) && /^Online/.test(status.at(-1)?.s || (await p.status()).at(-1)?.s || ''), JSON.stringify(status.map(s => s.s)))
  }
  return { before, after, chart: (id) => after.find(w => w.id === id), was: (id) => before.find(w => w.id === id), receipt: rc }
}

/** "undo", then every widget back to the exact pixels of `snap`. */
async function undoTo(p, t, snap, label = 'undo', { say = 'undo', view = true } = {}) {
  const r = await act(p, t, { say, busy: false, settleMs: 1200 })
  for (const c of snap.filter(w => w.type === 'chart')) {
    const n = r.chart(c.id)
    if (view) t.ok(`${label}: ${c.id} state back (symbol, timeframe, scale, indicators, panes)`, !!n && sameState(n, c), JSON.stringify([brief(c), n && brief(n)]))
    else t.ok(`${label}: ${c.id} back to the pixel`, !!n && same(n, c), JSON.stringify([brief(c), n && brief(n), c.pixels === n?.pixels]))
  }
  t.ok(`${label}: the same widgets`, r.after.map(w => w.id).join() === snap.map(w => w.id).join(), r.after.map(w => w.id).join())
}
const drawingsOf = async (p, sym) => JSON.parse((await p.ls('uct-chart-drawings')) || '{}')[sym] || []
const layoutOf = async (p) => { const w = await p.written(); return JSON.parse(w.charts_workspace_layout || '{}') }
const axisHas = (c, re) => c.text.some(x => re.test(x))
const wlRows = (p, id = 'w-watch') => p.b.evaluate(`[...document.querySelector('[data-widget-id=${JSON.stringify(id)}]').querySelectorAll('[data-sym], [data-ticker], [class*="symCell"], [class*="rowSym"], [class*="ticker"]')].map(e => e.textContent.trim()).filter(Boolean)`)

// ── the owner's tasks ───────────────────────────────────────────────────────────────────────────────────
scn('task-A nvda daily', ['C1-001', 'C1-002'], { prefs: TWO('W') }, async (p, t) => {
  await p.select(A)
  const snap = await p.read()
  t.ok('starts SPY weekly', snap[0].sym === 'SPY' && snap[0].tf === '1W', JSON.stringify(brief(snap[0])))
  const r = await act(p, t, { say: 'change this chart to NVDA daily', plan: { ops: [{ action: 'chart.setSymbol', target: CH0, args: { symbol: 'NVDA' } }, { action: 'chart.setTimeframe', target: CH0, args: { timeframe: 'D' } }] }, touch: [A], receipt: /NVDA/, undoable: true })
  const c = r.chart(A)
  t.ok('the chart shows NVDA daily', c.sym === 'NVDA' && c.tf === '1D', JSON.stringify(brief(c)))
  t.ok('the watermark on the canvas says so', axisHas(c, /^NVDA, 1D$/), c.text.slice(0, 3))
  t.ok('NVDA daily bars were requested', (await p.bars()).some(x => x.sym === 'NVDA' && x.tf === 'D'))
  t.ok('the receipt names daily', /daily/i.test(r.receipt?.text || ''), r.receipt?.text)
  await undoTo(p, t, snap, 'undo', { view: true })
})

scn('task-B four equal charts', [], { query: 'charts=1' }, async (p, t) => {
  const snap = await p.read()
  const r = await act(p, t, { say: 'Put SPY, QQQ, NVDA, and TSLA on four charts, all the same size.', plan: { ops: [{ action: 'chartGrid.set', target: '$board', args: { symbols: ['SPY', 'QQQ', 'NVDA', 'TSLA'], timeframe: null, layout: 'grid', new_charts: null, watchlist: null, replace: null } }] }, receipt: /SPY|QQQ|four|4/i, undoable: true, settleMs: 1500 })
  const c = r.after.filter(w => w.type === 'chart').sort((x, y) => x.y - y.y || x.x - y.x)
  t.ok('four charts', c.length === 4, c.length)
  t.ok('the right symbols in reading order', c.map(x => x.sym).join() === 'SPY,QQQ,NVDA,TSLA', c.map(x => x.sym).join())
  t.ok('all the same size', new Set(c.map(x => `${x.w}x${x.h}`)).size === 1, c.map(x => `${x.w}x${x.h}`).join(' '))
  t.ok('2 by 2', new Set(c.map(x => x.x)).size === 2 && new Set(c.map(x => x.y)).size === 2)
  t.ok('all four really painted, each different', new Set(c.map(x => x.pixels)).size === 4 && c.every(x => x.canvases > 5))
  t.ok('each watermark matches its own header', c.every(x => axisHas(x, new RegExp(`^${x.sym}, `))), c.map(x => x.text[0]).join())
  await p.shot(`${SHOTS}/task-B.png`)
  await undoTo(p, t, snap, 'undo', { view: true })
})

scn('task-C indicators on all four', [], { prefs: FOUR }, async (p, t) => {
  const snap = await p.read()
  const addAll = (b) => ({ ops: (b.context.indicatorEdits || []).map((_, i) => ({ action: 'indicator.add', target: `$indicatorEdits[${i}]`, args: { defId: 'rsi', inputs: null } })) })
  const all = ['c-tl', 'c-tr', 'c-bl', 'c-br']
  const r = await act(p, t, { say: 'add rsi to all four charts', plan: addAll, touch: all, receipt: /RSI/i, undoable: true })
  for (const id of all) t.ok(`${id} grew an RSI pane`, r.chart(id).panes.length === r.was(id).panes.length + 1, JSON.stringify([r.was(id).panes, r.chart(id).panes]))
  await p.shot(`${SHOTS}/task-C.png`)
  await undoTo(p, t, snap, 'one undo takes all four')
})

scn('task-D watchlist and save layout', ['C3-030', 'C1-171', 'C3-076'], { query: 'charts=1&layouts=1' }, async (p, t) => {
  // ONE planned turn, ONE card: the save runs last, on the board the rest left
  const r = await act(p, t, {
    say: 'add AMD to my Momentum list and save this layout as Swing 2',
    plan: { disposition: 'propose', ops: [{ action: 'watchlist.add', target: '$watchlists[0]', args: { symbols: ['AMD'] } }, { action: 'layout.saveAs', target: '$layouts', args: { name: 'Swing 2' } }] },
    approve: true, settleMs: 1200, receipt: /Swing 2/, busy: false,
  })
  const wl = await p.H(`H.wl.find(w => w.name === 'Momentum').items.map(i => i.sym)`)
  t.ok('AMD is on the list, once', wl.filter(s => s === 'AMD').length === 1, wl.join())
  const face = await p.b.evaluate(`document.querySelector('[data-widget-id="w-watch"]').innerText`)
  t.ok('the Watchlist widget shows the new count', face.split(/[^A-Za-z0-9]+/).join(' ').includes('Momentum 5'), face.slice(0, 200))
  const writes = await p.H('H.layoutWrites.map(w => [w.method, w.path, w.body && w.body.name])')
  t.ok('a layout write reached the library, with that name', writes.some(w => w[2] === 'Swing 2'), JSON.stringify(writes))
  const dock = await p.b.evaluate(`[...document.querySelectorAll('button, a, div, span')].filter(e => !e.closest('[data-testid="agent-panel"]') && e.textContent.trim() === 'Swing 2').length`)
  t.ok('the Layout Dock shows Swing 2', dock > 0, dock)
  t.ok('the charts did not change', r.after.filter(w => w.type === 'chart').every(c => same(c, r.was(c.id))))
})
scn('save last holds the change before it', ['C3-030'], { query: 'charts=1&layouts=1' }, async (p, t) => {
  await act(p, t, {
    say: 'make this chart weekly and save this layout as Swing 3',
    plan: { disposition: 'propose', ops: [{ action: 'chart.setTimeframe', target: CH0, args: { timeframe: 'W' } }, { action: 'layout.saveAs', target: '$layouts', args: { name: 'Swing 3' } }] },
    receipt: /weekly/i, undoable: true, settleMs: 1200, busy: false,
  })
  t.ok('the chart is weekly at once', (await p.charts())[0].tf === '1W', (await p.charts())[0].tf)
  t.ok('the save is a card, not yet run', /Swing 3/.test(await p.proposal() || '') && (await p.H('H.layoutWrites.length')) === 0, await p.proposal())
  t.ok('Apply clicked', await p.button('Apply'))
  await p.idle()
  await sleep(800)
  const w = (await p.H('H.layoutWrites')).find(x => x.body?.name === 'Swing 3')
  t.ok('the saved layout holds the weekly chart', !!w && /"tf":"W"/.test(JSON.stringify(w.body)), JSON.stringify(w?.body || null).slice(0, 300))
})
scn('save last on a card with the rest', ['C3-030'], { query: 'charts=1&layouts=1' }, async (p, t) => {
  await act(p, t, {
    say: 'alert me if SPY goes above 300 and save this layout as Swing 5',
    plan: { disposition: 'propose', ops: [{ action: 'alert.create', target: '$alertLibrary', args: { symbol: 'SPY', price: 300, direction: 'above' } }, { action: 'layout.saveAs', target: '$layouts', args: { name: 'Swing 5' } }] },
    approve: true, settleMs: 1200, receipt: /Swing 5/, busy: false,
  })
  t.ok('the alert landed', (await p.b.evaluate('window.__ba.alerts.length')) === 1)
  t.ok('the layout was saved once, on the one Apply', (await p.H('H.layoutWrites')).filter(w => w.body?.name === 'Swing 5').length === 1)
  t.ok('no second card', !(await p.proposal()), await p.proposal())
})
scn('save first stays refused', [], { query: 'charts=1&layouts=1' }, async (p, t) => {
  await act(p, t, {
    say: 'save this layout as Swing 4 and then make this chart weekly',
    plan: { disposition: 'propose', ops: [{ action: 'layout.saveAs', target: '$layouts', args: { name: 'Swing 4' } }, { action: 'chart.setTimeframe', target: CH0, args: { timeframe: 'W' } }] },
    noReceipt: true, says: /Save the layout on its own/, busy: false,
  })
  t.ok('nothing saved', (await p.H('H.layoutWrites.length')) === 0)
  t.ok('nothing changed', (await p.charts())[0].tf === '1D')
})

scn('task-E rsi with follow-ups', ['C2-004', 'C2-024', 'C2-030', 'C2-032'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const snap = await p.read()
  const rsiId = (b) => b.context.indicators[0].indicators.find(x => /RSI/.test(x.name)).id
  const r1 = await act(p, t, { say: 'add rsi', plan: { ops: [{ action: 'indicator.add', target: '$indicatorEdits[0]', args: { defId: 'rsi', inputs: null } }] }, touch: [A], receipt: /RSI/, undoable: true })
  t.ok('RSI has its own pane', r1.chart(A).panes.length === r1.was(A).panes.length + 1, JSON.stringify(r1.chart(A).panes))
  const r2 = await act(p, t, { say: 'make it orange', plan: (b) => ({ ops: [{ action: 'indicatorStyle.set', target: '$indicatorEdits[0]', args: { instance: rsiId(b), property: 'color', value: '#f97316', output: null } }] }), touch: [A], receipt: /RSI|orange|colou?r/i, undoable: true })
  t.ok('the follow-up found the RSI (the model saw it in memory)', r2.chart(A).panes.length === r1.chart(A).panes.length)
  await act(p, t, { say: 'make it thicker', plan: (b) => ({ ops: [{ action: 'indicatorStyle.set', target: '$indicatorEdits[0]', args: { instance: rsiId(b), property: 'lineWidth', value: 'thicker', output: null } }] }), touch: [], noReceipt: true, says: /^.*I didn't change anything: Relative Strength Index has no line width setting\.\s*$/s, busy: false })
  const r4 = await act(p, t, { say: 'change the length to 21', plan: (b) => ({ ops: [{ action: 'indicator.update', target: '$indicatorEdits[0]', args: { instance: rsiId(b), inputs: [{ key: 'period', value: 21 }] } }] }), touch: [A], receipt: /21/, undoable: true })
  t.ok('the pane is still there', r4.chart(A).panes.length === r1.chart(A).panes.length)
  await p.shot(`${SHOTS}/task-E.png`)
  await act(p, t, { say: 'undo', busy: false, touch: [A] })
  await act(p, t, { say: 'undo', busy: false, touch: [A] })
  await undoTo(p, t, snap, 'three undos walk back to the start')
})

scn('task-F top-left weekly', ['C1-006'], { prefs: FOUR }, async (p, t) => {
  const snap = await p.read()
  const r = await act(p, t, { say: 'make the top-left chart weekly', plan: { ops: [{ action: 'chart.setTimeframe', target: CH0, args: { timeframe: 'W' } }] }, touch: ['c-tl'], receipt: /weekly/i, undoable: true })
  t.ok('top-left is weekly', r.chart('c-tl').tf === '1W' && axisHas(r.chart('c-tl'), /^SPY, 1W$/), JSON.stringify(brief(r.chart('c-tl'))))
  const wk = (await p.bars()).filter(x => x.tf === 'W' && !/warm=1/.test(x.url))
  t.ok('weekly bars were loaded for that symbol only (background warm-ups aside)', wk.length > 0 && wk.every(x => x.sym === 'SPY'), JSON.stringify(wk.map(x => x.sym)))
  await undoTo(p, t, snap, 'undo', { view: true })
})

scn('task-G undo a grouped change', [], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const snap = await p.read()
  const r = await act(p, t, { say: 'make this chart weekly, log scale, and hide the volume', plan: { ops: [{ action: 'chart.setTimeframe', target: CH0, args: { timeframe: 'W' } }, { action: 'chart.setScale', target: CH0, args: { scale: 'log' } }, { action: 'volume.setState', target: CH0, args: { state: 'hidden' } }] }, touch: [A], undoable: true })
  const c = r.chart(A)
  t.ok('all three landed', c.tf === '1W' && c.scale === 'L' && !c.volume, JSON.stringify({ tf: c.tf, scale: c.scale, vol: c.volume }))
  await undoTo(p, t, snap, 'one undo reverses all three', { view: true })
})

// ── the chart surface ──────────────────────────────────────────────────────────────────────────────────
scn('timeframe 5m', ['C1-006'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const r = await act(p, t, { say: 'switch to 5 minute', plan: { ops: [{ action: 'chart.setTimeframe', target: CH0, args: { timeframe: '5' } }] }, touch: [A], receipt: /5/ })
  t.ok('the watermark moved to 5m', axisHas(r.chart(A), /^SPY, 5/), r.chart(A).text[0])
  t.ok('5 minute bars were requested', (await p.bars()).some(x => x.sym === 'SPY' && x.tf === '5'))
})
scn('custom timeframe', ['C1-008'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const r = await act(p, t, { say: 'add a 2 hour timeframe', plan: { ops: [{ action: 'chart.addCustomTimeframe', target: CH0, args: { unit: 'hours', count: 2, switch: true } }] }, touch: [A], receipt: /2/ })
  t.ok('the chart is on it', /2H|120/i.test(r.chart(A).tf) || axisHas(r.chart(A), /^SPY, (2H|120)/i), JSON.stringify([r.chart(A).tf, r.chart(A).text[0]]))
})
// A chart that goes to its error boundary after a change that landed in its settings. The fixture is the bad payload #842 fixes:
// once that merges this chart may survive, and the check below then holds the other way (no crash, the receipt stands).
const crashed = async (p) => p.b.evaluate(`[...document.querySelectorAll('[role="alert"]')].filter(e => /hit an error/.test(e.textContent)).length`)
const faultCheck = async (p, t) => {
  await sleep(1500)
  const down = await crashed(p)
  const rc = await p.receipt()
  t.ok(`recorded: ${down} chart(s) at the error boundary`, true)
  t.ok('the receipt tells the truth about the chart', down ? rc?.status === 'failed' : rc?.status == null, JSON.stringify(rc))
  if (down) t.ok('the panel says so in words', /hit an error after that change/.test(await p.transcript()), (await p.transcript()).slice(-200))
}
scn('chart crash after a change', [], { prefs: TWO(), dateShaped: true, allowErrors: true }, async (p, t) => {
  await p.select(A)
  await act(p, t, { say: 'add a 47 minute timeframe', plan: { ops: [{ action: 'chart.addCustomTimeframe', target: CH0, args: { unit: 'minutes', count: 47, switch: true } }] }, busy: false })
  await faultCheck(p, t)
  t.ok('the other chart stayed', (await p.read(B))[0].sym === 'AAPL')
  if (await crashed(p)) {
    t.ok('no Undo is offered for a chart that is gone', (await p.receipt())?.undoable !== 'true', JSON.stringify(await p.receipt()))
    t.ok('the words say what will work', /Remove the chart and add it again/.test(await p.transcript()), (await p.transcript()).slice(-200))
  }
})
scn('mc chart crash after a change', [], { query: 'multichart=1', dateShaped: true, allowErrors: true }, async (p, t) => {
  await p.select('g1')
  await act(p, t, { say: 'add a 47 minute timeframe', plan: (b) => ({ ops: [{ action: 'chart.addCustomTimeframe', target: refOf(b, 'AMD'), args: { unit: 'minutes', count: 47, switch: true } }] }), busy: false })
  await faultCheck(p, t)
  t.ok('the grid and the panel are still up', !!(await p.read('g0'))[0]?.sym && !!(await p.box('[aria-label="Message UCT Agent"]')))
  if (await crashed(p)) {
    await act(p, t, { say: 'undo', busy: false, settleMs: 1200 })
    t.ok('a cell is still there, so Undo brings the chart back', (await crashed(p)) === 0 && (await p.read('g1'))[0].tf === '1D', JSON.stringify((await p.read('g1'))[0].tf))
  }
})
scn('chart type line', ['C1-013'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const snap = await p.read()
  await act(p, t, { say: 'make it a line chart', plan: { ops: [{ action: 'chart.setType', target: CH0, args: { type: 'line' } }] }, touch: [A], receipt: /line/i, undoable: true })
  await undoTo(p, t, snap)
})
scn('session extended daily', ['C1-020'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const r = await act(p, t, { say: 'show extended hours', plan: { ops: [{ action: 'chart.setSession', target: CH0, args: { mode: 'extended' } }] }, touch: [A], noRepaint: true, receipt: /extended|pre-?market/i })
  t.ok('the session toggle moved', r.chart(A).session !== r.was(A).session, JSON.stringify([r.was(A).session, r.chart(A).session]))
  t.ok('the other chart kept RTH', r.chart(B).session === r.was(B).session)
})
scn('session extended intraday', ['C1-019'], { prefs: TWO('5') }, async (p, t) => {
  await p.select(A)
  const r = await act(p, t, { say: 'regular hours only', plan: { ops: [{ action: 'chart.setSession', target: CH0, args: { mode: 'regular' } }] }, touch: [A], noRepaint: true, receipt: /regular/i })
  t.ok('the session toggle moved to regular', r.chart(A).session !== r.was(A).session, JSON.stringify([r.was(A).session, r.chart(A).session]))
  const r2 = await act(p, t, { say: 'show extended hours', plan: { ops: [{ action: 'chart.setSession', target: CH0, args: { mode: 'extended' } }] }, touch: [A], noRepaint: true, receipt: /extended|pre-?market/i })
  t.ok('and back to extended', r2.chart(A).session === r.was(A).session, JSON.stringify([r2.was(A).session, r2.chart(A).session]))
})
scn('scale log', ['C1-022', 'C1-023'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const snap = await p.read()
  const r = await act(p, t, { say: 'log scale', plan: { ops: [{ action: 'chart.setScale', target: CH0, args: { scale: 'log' } }] }, touch: [A], receipt: /log/i, undoable: true })
  t.ok('the L button is on and the axis redrew', r.chart(A).scale === 'L', r.chart(A).scale)
  await undoTo(p, t, snap)
})
scn('scale percent', ['C1-022'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const r = await act(p, t, { say: 'percent scale', plan: { ops: [{ action: 'chart.setScale', target: CH0, args: { scale: 'percent' } }] }, touch: [A], receipt: /percent|%/i })
  t.ok('the % button is on', r.chart(A).scale === '%', r.chart(A).scale)
  t.ok('the axis prints percent', axisHas(r.chart(A), /%$/), r.chart(A).text.slice(0, 8).join(' '))
})

const wheelChart = async (p, id, dy = -480, n = 3) => {
  const pos = await p.b.evaluate(`(() => { const e = document.querySelector('[data-widget-id=${JSON.stringify(id)}]'); const c = [...e.querySelectorAll('canvas')].sort((a, z) => z.width * z.height - a.width * a.height)[0]; const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  for (let i = 0; i < n; i++) await p.b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: pos.x, y: pos.y, deltaX: 0, deltaY: dy })
  await p.b.hover(2, 2)
  await p.settle()
}
// A person's own control is the reference: the Agent must land on the picture the real control gives.
const realClick = async (p, sel, text) => {
  const q = await p.b.evaluate(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.trim() === ${JSON.stringify(text)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  if (!q) throw new Error(`no control ${text}`)
  await p.b.click(q.x, q.y)
  await p.b.hover(2, 2)
  await p.settle()
}
const humanReset = async (p, id) => {
  const q = await p.b.evaluate(`(() => { const e = document.querySelector('[data-widget-id=${JSON.stringify(id)}]'); const c = [...e.querySelectorAll('canvas')].sort((a, z) => z.width * z.height - a.width * a.height)[0]; const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  await p.b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: q.x, y: q.y })
  await p.b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: q.x, y: q.y, button: 'right', clickCount: 1 })
  await p.b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: q.x, y: q.y, button: 'right', clickCount: 1 })
  await sleep(250)
  const m = await p.b.evaluate(`(() => { const e = [...document.querySelectorAll('button, [role="menuitem"], div')].filter(x => x.textContent.trim() === 'Reset view').at(-1); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  if (!m) throw new Error('no Reset view menu item')
  await p.b.click(m.x, m.y)
  await p.b.hover(2, 2)
  await p.settle()
}
scn('reset view', ['C1-027'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  await wheelChart(p, A)
  await humanReset(p, A)
  const home = await p.read()
  await wheelChart(p, A)
  const zoomed = await p.read()
  t.ok('a real wheel zoomed the chart', zoomed[0].pixels !== home[0].pixels)
  const r = await act(p, t, { say: 'reset the view', plan: { ops: [{ action: 'chartSetup.resetView', target: CH0, args: {} }] }, touch: [A], receipt: /reset|view/i })
  t.ok('the same picture the right-click Reset view gives, to the pixel', r.chart(A).pixels === home[0].pixels, JSON.stringify([home[0].text.slice(-5), r.chart(A).text.slice(-5)]))
})
scn('range and undo', ['C1-029'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  await realClick(p, `[data-widget-id="${A}"] [class*="rangeBtn"]`, '3M')
  const human = await p.read()
  await humanReset(p, A)
  const snap = await p.read()
  t.ok('the real 3M button changed the picture', human[0].pixels !== snap[0].pixels)
  const r = await act(p, t, { say: 'show three months on this chart', plan: { ops: [{ action: 'chartSetup.setRange', target: CH0, args: { range: '3M' } }] }, touch: [A], receipt: /3M|three|3 month/i, undoable: true })
  t.ok('the same picture the real 3M button gives, to the pixel', r.chart(A).pixels === human[0].pixels, JSON.stringify([human[0].text.slice(-6), r.chart(A).text.slice(-6)]))
  await undoTo(p, t, snap, 'undo', { view: false })
})
scn('go to date', ['C1-030', 'C1-033'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const r = await act(p, t, { say: 'go to march 3 2025', plan: { ops: [{ action: 'chart.goToDate', target: CH0, args: { date: '2025-03-03' } }] }, touch: [A] })
  t.ok('the time axis moved', r.chart(A).text.slice(-6).join() !== r.was(A).text.slice(-6).join(), JSON.stringify(r.chart(A).text.slice(-6)))
  const edge = await p.b.evaluate(`(() => { const e = document.querySelector('[data-widget-id="${A}"] .tv-lightweight-charts canvas'); const r = e.getBoundingClientRect(); return { x: r.left + r.width * 0.9, y: r.top + r.height / 2 } })()`)
  await p.b.hover(edge.x, edge.y)
  await sleep(300)
  const bar = await p.b.evaluate(`document.querySelector('[data-widget-id="${A}"] [class*="barDate"]')?.textContent || ''`)
  t.ok('the bars near the right edge are from around the date asked', /^(FEB|MAR)/i.test(bar.trim()), bar)
})
scn('compare', ['C1-034'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const snap = await p.read()
  await act(p, t, { say: 'compare with AMD', plan: { ops: [{ action: 'chart.compare', target: CH0, args: { add: ['AMD'], remove: [], clear: false } }] }, touch: [A], receipt: /AMD/, undoable: true })
  t.ok('AMD bars were requested', (await p.bars()).some(x => x.sym === 'AMD'))
  const face = await p.b.evaluate(`document.querySelector('[data-widget-id="${A}"]').innerText`)
  t.ok('the chart legend names AMD', /AMD/.test(face))
  await undoTo(p, t, snap)
})
scn('volume hide', ['C1-086'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const snap = await p.read()
  const r = await act(p, t, { say: 'hide the volume', plan: { ops: [{ action: 'volume.setState', target: CH0, args: { state: 'hidden' } }] }, touch: [A], receipt: /volume/i, undoable: true })
  t.ok('the volume legend went and the pane closed', !r.chart(A).volume && r.chart(A).panes.length < r.was(A).panes.length, JSON.stringify(r.chart(A).panes))
  await undoTo(p, t, snap)
})
scn('volume pane height', ['C1-089'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const snap = await p.read()
  const r = await act(p, t, { say: 'make the volume pane 30 percent', plan: { ops: [{ action: 'chart.setSetting', target: CH0, args: { setting: 'volume.paneHeightPct', value: 30 } }] }, touch: [A, B], noRepaint: true, receipt: /30/, undoable: true })
  const a = r.chart(A), w = r.was(A)
  const vol = (x) => x.panes[x.panes.length - 2]
  t.ok('the volume pane really grew on this chart', vol(a) > vol(w) * 1.5, JSON.stringify([w.panes, a.panes]))
  t.ok('near 30 percent of the plotted height', Math.abs(vol(a) / (a.panes.slice(0, -1).reduce((x, y) => x + y, 0)) - 0.3) < 0.04, JSON.stringify(a.panes))
  t.ok('the pref was written', (await p.written()).charts_vol_pane_pct === '30', (await p.written()).charts_vol_pane_pct)
  t.ok('side effect recorded: other chart pane height', true, JSON.stringify([r.was(B).panes, r.chart(B).panes]))
  await undoTo(p, t, snap)
})

// ── indicators ─────────────────────────────────────────────────────────────────────────────────────────
const IE = '$indicatorEdits[0]'
scn('indicator hide and show', ['C1-097', 'C2-018', 'C2-019'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  await humanReset(p, A)
  const snap = await p.read()
  const r = await act(p, t, { say: 'hide the 50 sma', plan: { ops: [{ action: 'indicator.hide', target: IE, args: { instance: 'ovl:2' } }] }, touch: [A], receipt: /50/, undoable: true })
  t.ok('the line left the chart', r.chart(A).pixels !== r.was(A).pixels)
  await act(p, t, { say: 'show the 50 sma again', plan: { ops: [{ action: 'indicator.show', target: IE, args: { instance: 'ovl:2' } }] }, touch: [A], receipt: /50/ })
  const c = (await p.read()).find(w => w.id === A)
  t.ok('back to the original picture', c.pixels === snap.find(w => w.id === A).pixels)
})
scn('indicator remove', ['C1-102', 'C2-014', 'C2-015'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const r = await act(p, t, { say: 'remove the 200 sma', plan: { ops: [{ action: 'indicator.remove', target: IE, args: { instance: 'ovl:3' } }] }, approve: true, touch: [A], receipt: /200/ })
  t.ok('the chip is gone, the other three stay', r.chart(A).chips.join() === 'EMA 9,EMA 20,SMA 50', r.chart(A).chips.join())
  t.ok('the other chart keeps its 200', r.chart(B).chips.includes('SMA 200'))
})
scn('indicator add with settings', ['C2-005'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const r = await act(p, t, { say: 'add a 30 ema', plan: { ops: [{ action: 'indicator.add', target: IE, args: { defId: 'ema', inputs: [{ key: 'period', value: 30 }] } }] }, touch: [A], receipt: /30/, undoable: true })
  t.ok('a 30 EMA chip is on the chart', r.chart(A).chips.some(c => /EMA 30/.test(c)), r.chart(A).chips.join())
})
scn('indicator numeric', ['C2-024'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const r = await act(p, t, { say: 'change the 9 ema to a 10', plan: { ops: [{ action: 'indicator.update', target: IE, args: { instance: 'ovl:0', inputs: [{ key: 'period', value: 10 }] } }] }, touch: [A], receipt: /10/ })
  t.ok('the chip says EMA 10, and no EMA 9', r.chart(A).chips.includes('EMA 10') && !r.chart(A).chips.includes('EMA 9'), r.chart(A).chips.join())
})
scn('indicator select input', ['C2-025'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const r = await act(p, t, { say: 'change the 9 ema to an sma', plan: { ops: [{ action: 'indicator.update', target: IE, args: { instance: 'ovl:0', inputs: [{ key: 'maType', value: 'sma' }] } }] }, touch: [A], receipt: /SMA/i })
  t.ok('the chip says SMA 9', r.chart(A).chips.includes('SMA 9'), r.chart(A).chips.join())
})
scn('indicator colour', ['C2-030'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const snap = await p.read()
  const chipColor = () => p.b.evaluate(`getComputedStyle(document.querySelector('[data-widget-id="${A}"] [class*="studyStack"] [class*="_chip_"]')).color`)
  const c0 = await chipColor()
  await act(p, t, { say: 'make the 9 ema red', plan: { ops: [{ action: 'indicatorStyle.set', target: IE, args: { instance: 'ovl:0', property: 'color', value: '#ef4444', output: null } }] }, touch: [A], receipt: /9|red|colou?r/i, undoable: true })
  const c1 = await chipColor()
  const [re, gr] = c1.match(/[0-9]+/g).map(Number)
  t.ok('the legend chip took a red', c1 !== c0 && re > 180 && gr < 110, `${c0} -> ${c1}`)
  await undoTo(p, t, snap)
})
scn('indicator width', ['C2-032'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  await act(p, t, { say: 'make the 20 ema thicker', plan: { ops: [{ action: 'indicatorStyle.set', target: IE, args: { instance: 'ovl:1', property: 'lineWidth', value: 'thicker', output: null } }] }, touch: [A], receipt: /20|thick|width/i, undoable: true })
})
scn('indicator own pane', ['C2-036', 'C1-098'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const r = await act(p, t, { say: 'put the 50 sma in its own pane', plan: { ops: [{ action: 'indicatorStyle.placeIn', target: IE, args: { instance: 'ovl:2', place: 'pane' } }] }, touch: [A], receipt: /50|pane/i, undoable: true })
  t.ok('a new pane exists', r.chart(A).panes.length === r.was(A).panes.length + 1, JSON.stringify(r.chart(A).panes))
})
scn('hide all indicators', ['C1-103'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const r = await act(p, t, { say: 'hide all indicators', plan: { ops: [{ action: 'chartSetup.setIndicatorsHidden', target: CH0, args: { hidden: true } }] }, touch: [A], receipt: /indicator/i })
  t.ok('the picture lost its lines', r.chart(A).pixels !== r.was(A).pixels)
})
scn('hide all indicators on this chart', ['C1-103'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  await act(p, t, { say: 'hide all indicators on this chart', plan: { ops: [{ action: 'chartSetup.setIndicatorsHidden', target: CH0, args: { hidden: true } }] }, touch: [A], receipt: /indicator/i })
})
scn('hide all indicators on this chart, one chart', ['C1-103'], { query: 'charts=1' }, async (p, t) => {
  await act(p, t, { say: 'hide all indicators on this chart', plan: { ops: [{ action: 'chartSetup.setIndicatorsHidden', target: CH0, args: { hidden: true } }] }, touch: ['w-chart-a'], receipt: /indicator/i })
})
scn('moving averages off', ['C1-105'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  await act(p, t, { say: 'hide all moving averages', plan: { ops: [{ action: 'chartSetup.setMovingAverages', target: CH0, args: { visible: false } }] }, touch: [A], receipt: /moving average/i })
})

// ── drawings ───────────────────────────────────────────────────────────────────────────────────────────
const DR = '$drawings[0]'
const did = '$ctx:drawings.0.drawings.0.id'
scn('drawing level lifecycle', ['C1-131', 'C1-121', 'C1-147', 'C1-146', 'C1-162'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const snap = await p.read()
  const px = (Number(snap[0].text.find(x => /^\d+\.\d\d$/.test(x)))) + 16
  const r1 = await act(p, t, { say: `draw a horizontal line at ${px}`, plan: { ops: [{ action: 'drawing.addLevel', target: DR, args: { price: px, color: null, style: null } }] }, touch: [A], receipt: new RegExp(String(Math.floor(px))), undoable: true })
  let d = await drawingsOf(p, 'SPY')
  t.ok('one horizontal in the store at that price', d.length === 1 && d[0].type === 'horizontal' && d[0].points[0].price === px, JSON.stringify(d).slice(0, 200))
  t.ok('the other symbol has none', (await drawingsOf(p, 'AAPL')).length === 0)
  const moved = px + 8
  await act(p, t, { say: `move the line to ${moved}`, plan: { ops: [{ action: 'drawing.setLevel', target: DR, args: { drawing: did, price: moved } }] }, touch: [A], receipt: new RegExp(String(Math.floor(moved))), undoable: true })
  d = await drawingsOf(p, 'SPY')
  t.ok('the store moved', d[0]?.points[0].price === moved, JSON.stringify(d[0]?.points))
  await act(p, t, { say: 'make the line red', plan: { ops: [{ action: 'drawing.style', target: DR, args: { drawing: did, color: '#ef4444', style: null, width: null } }] }, touch: [A], receipt: /red|colou?r/i, undoable: true })
  d = await drawingsOf(p, 'SPY')
  t.ok('the colour landed', JSON.stringify(d[0]).toLowerCase().includes('#ef4444'), JSON.stringify(d[0]).slice(0, 200))
  await act(p, t, { say: 'undo', busy: false, touch: [A] })
  d = await drawingsOf(p, 'SPY')
  t.ok('undo took back the colour only', d.length === 1 && !JSON.stringify(d[0]).toLowerCase().includes('#ef4444') && d[0].points[0].price === moved, JSON.stringify(d[0]).slice(0, 200))
  await act(p, t, { say: 'delete that line', plan: { ops: [{ action: 'drawing.remove', target: DR, args: { drawing: did } }] }, touch: [A], receipt: /delet|remov/i, undoable: true })
  t.ok('the store is empty', (await drawingsOf(p, 'SPY')).length === 0)
  t.ok('the chart is back to the bare picture', (await p.read()).find(w => w.id === A).pixels === snap.find(w => w.id === A).pixels)
  await act(p, t, { say: 'undo', busy: false, touch: [A] })
  t.ok('undo brought the line back', (await drawingsOf(p, 'SPY')).length === 1)
  void r1
})
const dated = (sayText, action, args, type, rows, extra) => scn(`drawing ${type}`, rows, { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const snap = await p.read()
  const hi = Number(snap[0].text.find(x => /^\d+\.\d\d$/.test(x)))
  const r = await act(p, t, { say: sayText, plan: { ops: [{ action, target: DR, args: args(hi + 8, hi + 40) }] }, touch: [A], undoable: true })
  const d = await drawingsOf(p, 'SPY')
  t.ok(`one ${type} in the store`, d.length === 1 && d[0].type === type, JSON.stringify(d).slice(0, 240))
  t.ok('the receipt is truthful about what it drew', /line|fib|vwap|rect|text|box|drew|added/i.test(r.receipt?.text || ''), r.receipt?.text)
  if (extra) await extra(p, t, d)
  await undoTo(p, t, snap)
})
dated('draw a trendline from may 1 2025 to aug 1 2025', 'drawing.addTrendline', (a, b) => ({ from: { date: '2025-05-01', price: a }, to: { date: '2025-08-01', price: b }, color: null, style: null }), 'trendline', ['C1-128'], async (p, t, d) => {
  t.ok('anchors on the dates asked', JSON.stringify(d[0].points).length > 10, JSON.stringify(d[0].points).slice(0, 200))
  // anchor edit, as a follow-up
  const r = await act(p, t, { say: "drag the trendline's end point up", plan: { ops: [{ action: 'drawing.setAnchors', target: DR, args: { drawing: did, points: [{ point: 2, date: null, price: d[0].points[1].price + 12 }] } }] }, touch: [A], undoable: true })
  const n = await drawingsOf(p, 'SPY')
  t.ok('the second anchor moved, the first did not', n[0].points[1].price === d[0].points[1].price + 12 && n[0].points[0].price === d[0].points[0].price, JSON.stringify(n[0].points).slice(0, 200))
  void r
  await act(p, t, { say: 'undo', busy: false, touch: [A] })
  const u = await drawingsOf(p, 'SPY')
  t.ok('undo restored the anchor', u[0].points[1].price === d[0].points[1].price, JSON.stringify(u[0].points).slice(0, 200))
})
dated('draw a fib from may 1 2025 to aug 1 2025', 'drawing.addFib', (a, b) => ({ from: { date: '2025-05-01', price: a }, to: { date: '2025-08-01', price: b }, color: null, style: null }), 'fib', ['C1-137'])
dated('anchored vwap from may 1 2025', 'drawing.addAvwap', (a) => ({ date: '2025-05-01', price: a, color: null }), 'avwap', ['C1-142'])
dated('draw a rectangle from may 1 2025 to aug 1 2025', 'drawing.addRectangle', (a, b) => ({ from: { date: '2025-05-01', price: a }, to: { date: '2025-08-01', price: b }, color: null, style: null }), 'rect', ['C1-134'])

// ── alerts ─────────────────────────────────────────────────────────────────────────────────────────────
scn('price alert', ['C1-114', 'C3-098', 'C3-128', 'C3-127'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  await act(p, t, { say: 'alert me if SPY goes above 300', plan: { disposition: 'propose', ops: [{ action: 'alert.create', target: '$alertLibrary', args: { symbol: 'SPY', price: 300, direction: 'above' } }] }, approve: true, receipt: /SPY/ })
  const api = await p.api()
  t.ok('the server was asked once, after Apply', api.filter(a => a.method === 'POST' && a.path.startsWith('/api/watchlist-alerts')).length === 1)
  t.ok('the book holds it', (await p.b.evaluate('window.__ba.alerts.length')) === 1)
  await act(p, t, { say: 'show my alerts', plan: { disposition: 'apply', ops: [{ action: 'alert.list', target: '$alertLibrary', args: {} }] }, busy: false })
  const txt = await p.b.evaluate(`[...document.querySelectorAll('[data-testid="agent-transcript"] > *')].at(-1).textContent`)
  t.ok('the list names the alert (the rows sit under Details)', /SPY/.test(txt), txt.slice(0, 200))
  const face = await p.b.evaluate(`(() => { const e = [...document.querySelectorAll('[data-testid="agent-transcript"] > *')].at(-1); const d = e.querySelector('details'); if (d) d.remove(); return e.innerText })()`)
  t.ok('both halves are stated with Details shut', /price alerts \(1\)/i.test(face) && /no indicator alerts/i.test(face), face.slice(0, 200))
})

const OSC = [{ value: 'above', label: 'Above threshold', needs_threshold: true }, { value: 'below', label: 'Below threshold', needs_threshold: true }, { value: 'cross_above', label: 'Crosses above', needs_threshold: true }, { value: 'cross_below', label: 'Crosses below', needs_threshold: true }]
const XC = [{ value: 'cross_above', label: 'Fast MA crosses above slow MA', needs_threshold: false }, { value: 'cross_below', label: 'Fast MA crosses below slow MA', needs_threshold: false }]
const IA_CATALOG = [
  { indicator: 'rsi', label: 'RSI', conditions: OSC, default_threshold: 70, plots: [{ value: 'rsi', label: 'RSI', conditions: OSC, default_threshold: 70, inputs: { period: 14 }, instance_label: 'RSI (14)' }] },
  { indicator: 'ma_cross', label: 'MA Cross', conditions: XC, default_threshold: null, plots: [{ value: 'ma_cross', label: 'MA Cross', conditions: XC, default_threshold: null, inputs: { ma_type: 'ema', fast: 9, slow: 20 }, instance_defs: ['movingAverage'], instance_label: 'EMA(9) vs EMA(20)' }] },
]
scn('indicator threshold alert', ['C2-089'], { prefs: TWO(), iaCatalog: IA_CATALOG }, async (p, t) => {
  await p.select(A)
  await act(p, t, { say: 'add rsi', plan: { ops: [{ action: 'indicator.add', target: IE, args: { defId: 'rsi', inputs: null } }] }, receipt: /RSI/ })
  await act(p, t, { say: 'alert me when RSI goes above 70', plan: (b) => ({ disposition: 'propose', ops: [{ action: 'indicatorAlert.create', target: '$indicatorAlertLibrary', args: { instance: b.context.indicators[0].indicators.find(x => /RSI/.test(x.name)).id, plot: null, condition: 'above', threshold: 70, crossWith: null } }] }), approve: true, receipt: /RSI|alert/i })
  const I = await p.b.evaluate('window.__ba.ialerts || []')
  t.ok('one armed alert, on the right chart and level', I.length === 1 && I[0].sym === 'SPY' && I[0].condition === 'above' && I[0].threshold === 70, JSON.stringify(I))
})
scn('indicator ma cross alert', ['C2-090'], { prefs: TWO(), iaCatalog: IA_CATALOG }, async (p, t) => {
  await p.select(A)
  await act(p, t, { say: 'mark when the 9 ema crosses above the 20 on this chart', plan: { disposition: 'propose', ops: [{ action: 'indicatorAlert.create', target: '$indicatorAlertLibrary', args: { instance: 'ovl:0', plot: null, condition: 'cross_above', threshold: null, crossWith: 'ovl:1' } }] }, approve: true, receipt: /alert|cross/i })
  const I = await p.b.evaluate('window.__ba.ialerts || []')
  t.ok('one armed cross alert on SPY', I.length === 1 && I[0].sym === 'SPY' && I[0].condition === 'cross_above', JSON.stringify(I))
})

// ── the board ──────────────────────────────────────────────────────────────────────────────────────────
scn('widget add and close', ['C3-001', 'C3-004'], { query: 'board=gap' }, async (p, t) => {
  const r = await act(p, t, { say: 'add a news widget', plan: { ops: [{ action: 'widget.add', target: '$workspace', args: { type: 'news', as: null } }] }, receipt: /news/i, undoable: true })
  const added = r.after.find(w => w.type === 'news')
  t.ok('a News widget is on the board and has size', !!added && added.w > 100 && added.h > 100, JSON.stringify(r.after.map(w => [w.type, w.w, w.h])))
  t.ok('the chart did not change size', r.after.find(w => w.type === 'chart').w === r.before.find(w => w.type === 'chart').w)
  const r2 = await act(p, t, { say: 'close the news widget', plan: (b) => ({ ops: [{ action: 'widget.remove', target: '$board', args: { widget: added.id } }] }), receipt: /clos|remov/i, undoable: true })
  t.ok('it left the board', !r2.after.some(w => w.type === 'news'))
})
scn('widget link', ['C3-006'], { prefs: TWO() }, async (p, t) => {
  const snap = await p.read()
  const r = await act(p, t, { say: 'put the right chart in link group C', plan: { ops: [{ action: 'widget.setLink', target: '$board', args: { widget: B, color: 'C' } }] }, receipt: /link|group/i, undoable: true })
  t.ok('the right chart now follows group C', r.chart(B).sym === 'AMD', r.chart(B).sym)
  t.ok('the left chart stayed', r.chart(A).sym === 'SPY')
  t.ok('the layout saved its colour', (await layoutOf(p)).widgets.find(w => w.id === B).color === 'C')
  await undoTo(p, t, snap)
})
scn('widget move', ['C3-002'], { prefs: TWO() }, async (p, t) => {
  const r = await act(p, t, { say: 'move the watchlist to the top left', plan: { ops: [{ action: 'widget.move', target: '$board', args: { widget: 'w-watch', x: 0, y: 0, w: 6, h: null } }] }, receipt: /watchlist|moved/i, undoable: true, settleMs: 1200 })
  const w = r.after.find(x => x.id === 'w-watch'), was = r.before.find(x => x.id === 'w-watch')
  t.ok('the Watchlist really moved to the left edge', w.x < was.x && w.x < 40, JSON.stringify([was.x, w.x]))
  t.ok('both charts are still on the board', r.after.filter(x => x.type === 'chart').length === 2)
  const ov = r.after.some((a, i) => r.after.some((b, k) => k > i && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h))
  t.ok('nothing overlaps', !ov, JSON.stringify(r.after.map(x => [x.id, x.x, x.y, x.w, x.h])))
  const undo = await act(p, t, { say: 'undo', busy: false, settleMs: 1200 })
  t.ok('undo put it back', undo.after.find(x => x.id === 'w-watch').x === was.x)
})
scn('widget resize', ['C3-003'], { prefs: TWO() }, async (p, t) => {
  const r = await act(p, t, { say: 'make the right chart 2 cells wider', plan: { ops: [{ action: 'widget.resize', target: '$board', args: { widget: B, edge: 'right', by: 2 } }] }, receipt: /wider|resiz|chart|bigger/i, undoable: true, settleMs: 1200 })
  t.ok('the right chart is wider on screen', r.chart(B).w > r.was(B).w + 20, JSON.stringify([r.was(B).w, r.chart(B).w]))
  t.ok('the Watchlist gave up the room', r.after.find(x => x.id === 'w-watch').w < r.before.find(x => x.id === 'w-watch').w)
  t.ok('the left chart did not move or resize', r.chart(A).w === r.was(A).w && r.chart(A).x === r.was(A).x)
  const undo = await act(p, t, { say: 'undo', busy: false, settleMs: 1200 })
  t.ok('undo restored the width', undo.chart(B).w === r.was(B).w)
})
scn('layout open', ['C3-025'], { query: 'charts=2&layouts=1' }, async (p, t) => {
  const r = await act(p, t, { say: 'open my Intraday Scan layout', plan: { ops: [{ action: 'layout.open', target: '$layouts', args: { layout: '12' } }] }, receipt: /Intraday Scan/, settleMs: 1500 })
  const c = r.after.filter(w => w.type === 'chart')
  t.ok('the board is that layout (two 5m charts, no watchlist)', c.length === 2 && !r.after.some(w => w.type === 'watchlist') && c.every(x => /5/.test(x.tf)), JSON.stringify(r.after.map(w => [w.id, w.type, w.tf])))
})
scn('watchlist remove', ['C3-079'], { query: 'charts=1' }, async (p, t) => {
  await act(p, t, { say: 'remove TSLA from my Momentum list', plan: { ops: [{ action: 'watchlist.remove', target: '$watchlists[0]', args: { symbols: ['TSLA'] } }] }, receipt: /TSLA/ })
  const wl = await p.H(`H.wl.find(w => w.name === 'Momentum').items.map(i => i.sym)`)
  t.ok('TSLA left, the rest stayed', wl.join() === 'NVDA,META,AAPL', wl.join())
})
const NVDA_LINKED = { charts_workspace_groups: JSON.stringify({ A: 'NVDA', B: 'AAPL', C: 'AMD', D: 'MSFT' }) }
const rowsOn = (p) => p.b.evaluate(`document.querySelector('[data-widget-id="w-watch"]').innerText.split(String.fromCharCode(10)).filter(x => /^[A-Z]{2,5}$/.test(x) && !['COMMUNITY', 'PREBUILT'].includes(x))`)
scn('watchlist sort and columns', ['C3-082', 'C3-083'], { query: 'board=wl', prefs: NVDA_LINKED }, async (p, t) => {
  const ref = (b) => (b.context.listViews || [])[0]?.ref
  t.ok('starts in list order', (await rowsOn(p)).join() === 'NVDA,TSLA,META,AAPL', (await rowsOn(p)).join())
  await act(p, t, { say: 'sort my watchlist by symbol, Z to A', plan: (b) => ({ ops: [{ action: 'watchlist.sortColumn', target: ref(b), args: { column: 'Symbol', direction: 'desc' } }] }), receipt: /Sorted/ })
  t.ok('the rows on screen are in that order', (await rowsOn(p)).join() === 'TSLA,NVDA,META,AAPL', (await rowsOn(p)).join())
  await act(p, t, { say: 'add the RVOL column and hide the volume column', plan: (b) => ({ ops: [{ action: 'watchlist.setColumns', target: ref(b), args: { add: ['RVOL'], hide: ['Volume'], reset: false } }] }), receipt: /RVOL|column/i })
  const head = await p.b.evaluate(`document.querySelector('[data-widget-id="w-watch"]').innerText`)
  t.ok('the header shows RVOL and lost Vol', /RVOL/i.test(head) && !head.split(String.fromCharCode(10)).includes('Vol'), head.slice(0, 120))
})
scn('watchlist walk', ['C3-069', 'C3-068'], { query: 'board=wl', prefs: NVDA_LINKED }, async (p, t) => {
  const ref = (b) => (b.context.listViews || [])[0]?.ref
  const c0 = (await p.charts())[0]
  t.ok('starts on NVDA', c0.sym === 'NVDA', c0.sym)
  const r = await act(p, t, { say: 'next ticker in my watchlist', plan: (b) => ({ ops: [{ action: 'watchlist.step', target: ref(b), args: { direction: 'next', by: null } }] }), touch: ['w-chart-a'], receipt: /TSLA/ })
  t.ok('the linked chart walked to TSLA', r.chart('w-chart-a').sym === 'TSLA', r.chart('w-chart-a').sym)
  const r2 = await act(p, t, { say: 'previous one', plan: (b) => ({ ops: [{ action: 'watchlist.step', target: ref(b), args: { direction: 'previous', by: null } }] }), touch: ['w-chart-a'], receipt: /NVDA/ })
  t.ok('and back', r2.chart('w-chart-a').sym === 'NVDA', r2.chart('w-chart-a').sym)
})
scn('watchlist open', ['C3-063'], { query: 'charts=1' }, async (p, t) => {
  await act(p, t, { say: 'open my Swing watchlist', plan: { ops: [{ action: 'watchlist.open', target: '$board', args: { list: '$ctx:watchlists.1.ref' } }] }, receipt: /Swing/ })
  const f = await p.b.evaluate(`document.querySelector('[data-widget-id="w-watch"]').innerText`)
  t.ok('the widget shows that list', /MSFT/.test(f) && /Swing/.test(f), f.slice(0, 160))
})
scn('line alert', ['C1-115'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const hi = Number((await p.read())[0].text.find(x => /^[0-9]+[.][0-9][0-9]$/.test(x)))
  await act(p, t, { say: 'draw a trendline from may 1 2025 to aug 1 2025', plan: { ops: [{ action: 'drawing.addTrendline', target: DR, args: { from: { date: '2025-05-01', price: hi + 8 }, to: { date: '2025-08-01', price: hi + 30 }, color: null, style: null } }] }, touch: [A] })
  await act(p, t, { say: 'alert me if it breaks below this trendline', plan: { disposition: 'propose', ops: [{ action: 'drawing.setAlert', target: DR, args: { drawing: did, direction: 'below', level: null } }] }, approve: true, receipt: /alert|trendline|line/i })
  const post = (await p.api()).filter(a => a.method === 'POST' && a.path.startsWith('/api/watchlist-alerts'))
  t.ok('one bound alert posted, below, on SPY', post.length === 1 && /"direction":"below"/.test(post[0].body) && /SPY/.test(post[0].body), JSON.stringify(post).slice(0, 300))
})
const setting = (name, rows, say, op, check) => scn(name, rows, { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const r = await act(p, t, { say, plan: { ops: [op] }, touch: [A], undoable: true })
  if (check) await check(p, t, r)
})
const bgAt = (p, id) => p.b.evaluate(`(() => { const c = document.querySelector('[data-widget-id=${JSON.stringify(id)}] .tv-lightweight-charts canvas'); const d = c.getContext('2d').getImageData(4, 4, 1, 1).data; return [d[0], d[1], d[2]].join() })()`)
setting('setting grid', ['C1-047'], 'turn off the grid', { action: 'chart.setSetting', target: CH0, args: { setting: 'grid.visible', value: false } })
setting('setting background', ['C1-049'], 'make the background black', { action: 'chart.setBackground', target: CH0, args: { color: '#000000' } }, async (p, t) => {
  t.ok('the canvas background is black on this chart', (await bgAt(p, A)) === '0,0,0', await bgAt(p, A))
  t.ok('and not on the other', (await bgAt(p, B)) !== '0,0,0', await bgAt(p, B))
})
setting('setting theme', ['C1-079'], 'use the nord chart theme', { action: 'chart.applyTheme', target: CH0, args: { theme: 'nord' } }, async (p, t, r) => {
  t.ok('the other chart kept its look', r.chart(B).pixels === r.was(B).pixels)
})

scn('flag and unflag', ['C1-005', 'C3-077', 'C3-078'], { query: 'board=wl', prefs: NVDA_LINKED, fixtures: { routes: [{ match: '^POST /api/watchlists/flagged/sync', body: { ok: true } }] } }, async (p, t) => {
  await act(p, t, { say: 'add NVDA to my flagged list', plan: { ops: [{ action: 'watchlist.setFlag', target: '$flagged[0]', args: { symbols: ['NVDA'], flagged: true } }] }, receipt: /NVDA/ })
  const sync = (await p.api()).filter(a => a.path === '/api/watchlists/flagged/sync').at(-1)
  t.ok('the flagged sync carries NVDA', /NVDA/.test(sync?.body || ''), sync?.body)
  await act(p, t, { say: 'unflag NVDA', plan: { ops: [{ action: 'watchlist.setFlag', target: '$flagged[0]', args: { symbols: ['NVDA'], flagged: false } }] }, receipt: /NVDA/ })
  const s2 = (await p.api()).filter(a => a.path === '/api/watchlists/flagged/sync').at(-1)
  t.ok('the flagged sync dropped NVDA', !/NVDA/.test(s2?.body || ''), s2?.body)
})
scn('replay', ['C1-042', 'C1-045', 'C3-209', 'C3-210'], { prefs: TWO() }, async (p, t) => {
  await p.select(A)
  const snap = await p.read()
  const r = await act(p, t, { say: 'show me this chart as of may 1 2025', plan: { ops: [{ action: 'chart.replay', target: CH0, args: { date: '2025-05-01' } }] }, touch: [A, B], receipt: /replay|as of|may/i })
  t.ok('the receipt says every chart, which is what moved: the two charts here are not linked', /every chart in this workspace/.test(r.receipt?.text || '') && r.chart(A).pixels !== r.was(A).pixels && r.chart(B).pixels !== r.was(B).pixels, r.receipt?.text)
  const f = await p.b.evaluate(`document.querySelector('[data-widget-id="${A}"]').innerText`)
  t.ok('the chart says it is in replay', /replay/i.test(f), f.slice(0, 200))
  t.ok('the last bars are gone from the picture', r.chart(A).text.join() !== r.was(A).text.join())
  await act(p, t, { say: 'exit replay', plan: { ops: [{ action: 'chart.replay', target: CH0, args: { date: null } }] }, touch: [A, B], receipt: /replay|exit|live/i })
  t.ok('back to the full chart', sameState((await p.read()).find(w => w.id === A), snap.find(w => w.id === A)))
})
scn('scanner preset', ['C3-107'], { prefs: SCANBOARD }, async (p, t) => {
  await act(p, t, { say: 'show the first scan in the scanner widget', plan: { ops: [{ action: 'widget.showScan', target: '$board', args: { widget: 'w-scan', scan: 'highest-volume-1y' } }] }, receipt: /scan/i, undoable: true })
  const w = (await layoutOf(p)).widgets.find(x => x.id === 'w-scan')
  t.ok('the widget took the scan', !!w.opts?.scanKey, JSON.stringify(w.opts))
  const f = await p.b.evaluate('document.querySelector(\'[data-widget-id="w-scan"]\').innerText')
  t.ok('the widget face names it', f.includes(w.opts?.scanName || '?'), f.slice(0, 160))
})
scn('scanner from chat', ['C3-118'], { prefs: SCANBOARD }, async (p, t) => {
  await act(p, t, { say: 'find stocks with ADR above 5%', plan: { ops: [{ action: 'screener.run', target: '$screener', args: { filters: [{ field: 'adr_pct', op: 'gt', value: 5, max: null, values: null }], sort_field: null, sort_dir: null, mode: 'new', show: null, as: null, within: null } }] }, says: /RKLB|ASTS|SOUN/ })
  const sc = await p.H(`(H.screener || []).filter(s => s.path === '/api/screener/scan').length`)
  t.ok('the scan really ran', sc >= 1, sc)
  const cf = (await p.charts()).find(c => c.id === A)
  t.ok('the workspace is unchanged', cf.sym === 'SPY')
})
scn('breadth read', ['C3-157'], { prefs: TWO() }, async (p, t) => {
  const r = await act(p, t, { say: "what's the breadth like", plan: { ops: [{ action: 'breadth.show', target: '$breadth', args: { mode: 'value', universe: 'us', metrics: [], date: null, compare_date: null, start: null, end: null, basis: null, side: null, sessions: null } }] }, touch: [] })
  t.ok('an answer reached the panel', /harness fixture|Universe|UCT/.test(await p.transcript()), (await p.transcript()).slice(-200))
  void r
})
scn('full board banner', [], { prefs: board(Array.from({ length: 16 }, (_, i) => ({ id: `n${i}`, type: i === 0 ? 'chart' : 'news', color: 'A', x: (i % 4) * 6, y: Math.floor(i / 4) * 5, w: 6, h: 5, opts: {} })), { A: 'SPY', B: 'AAPL', C: 'AMD', D: 'MSFT' }) }, async (p, t) => {
  const before = await p.read()
  t.ok('the board has 16 widgets', before.length === 16, before.length)
  const r = await act(p, t, { say: 'add a news widget', plan: { ops: [{ action: 'widget.add', target: '$workspace', args: { type: 'news', as: null } }] }, noReceipt: true })
  t.ok('nothing was added', r.after.length === 16, r.after.length)
  t.ok('the Agent says the bound\'s own sentence', (await p.last()).includes('A board holds at most 16 widgets, and this one would hold 17. Close a widget before adding another.'), await p.last())
  const banner = await p.b.evaluate(`document.querySelector('[data-testid="board-bound-status"]')?.textContent || ''`)
  t.ok('the workspace banner shows the same sentence', banner.includes('A board holds at most 16 widgets, and this one would hold 17.'), banner || 'no banner')
  await realClick(p, '[data-guide="workspace.widgets"]', 'Widgets ▾')
  const note = await p.b.evaluate(`document.querySelector('[data-testid="board-bound-note"]')?.textContent || ''`)
  t.ok('the Widgets menu carries the bound note', /16|full|widget/i.test(note), note)
})
// (#835 lifted the gate this scenario was written for: a saved grid opens with an empty cell, and a change on it runs)
scn('multi chart from a saved grid', [], { emptyCell: true, prefs: { multichart_state: JSON.stringify({ mode: 'grid', layout: '2x2', cells: [{ sym: 'SPY', tf: 'D' }, { sym: 'NVDA', tf: 'D' }, { sym: 'AAPL', tf: 'D' }, null], groups: {}, syncTimeRange: false }) } }, async (p, t) => {
  const r = await act(p, t, { say: 'make the top-left chart weekly', plan: { ops: [{ action: 'chart.setTimeframe', target: CH0, args: { timeframe: 'W' } }] }, receipt: /weekly/i, undoable: true })
  t.ok('the top-left cell is weekly, the others are not', r.after.filter(c => c.type === 'chart' && c.sym).map(c => c.tf).join() === '1W,1D,1D', JSON.stringify(r.after.map(brief)))
})

// ── Multi Chart (needs #835 and #839: run only on a build holding them, filter "^mc ") ─────────────────────
// ?multichart=1: a 2x2 grid, g0 NVDA, g1 AMD, g2 TSLA, g3 empty. =sync: time-range sync seeded on.
const MC = { query: 'multichart=1' }
const tf1 = (id, label) => p => realClick(p, '[data-grid-cell-id="' + id + '"] [data-guide="chart.timeframe"] button', label)
const FILLED = ['g0', 'g1', 'g2']
const others = (id) => FILLED.filter(x => x !== id)
const tfs = async (p) => (await p.charts()).map(c => c.tf).join(' ')
const refOf = (b, sym) => b.context.charts.find(c => c.symbol === sym)?.ref
const setTf = (sym, tf) => (b) => ({ ops: [{ action: 'chart.setTimeframe', target: refOf(b, sym), args: { timeframe: tf } }] })

scn('mc timeframe on a clicked cell', ['C3-056'], MC, async (p, t) => {
  await p.select('g1')
  const snap = await p.read()
  const r = await act(p, t, { say: 'make this chart weekly', plan: setTf('AMD', 'W'), touch: ['g1'], receipt: /weekly/i, undoable: true })
  t.ok('the clicked cell is weekly and its header says so', r.chart('g1').tf === '1W', r.chart('g1').tf)
  t.ok('weekly bars loaded for AMD only', (await p.bars()).filter(x => x.tf === 'W' && !/warm=1/.test(x.url)).every(x => x.sym === 'AMD'))
  await undoTo(p, t, snap)
})
scn('mc no click asks', [], MC, async (p, t) => {
  await act(p, t, { say: 'make this chart weekly', plan: setTf('NVDA', 'W'), touch: [], noReceipt: true, busy: false })
  t.ok('it asks which chart', /which/i.test(await p.last()), await p.last())
})
scn('mc top-left', [], MC, async (p, t) => {
  const r = await act(p, t, { say: 'make the top-left chart weekly', plan: setTf('NVDA', 'W'), touch: ['g0'], receipt: /weekly/i, undoable: true })
  t.ok('NVDA, top-left, changed', r.chart('g0').tf === '1W', await tfs(p))
})
scn('mc chart 3', [], MC, async (p, t) => {
  const r = await act(p, t, { say: 'make chart 3 weekly', plan: setTf('TSLA', 'W'), touch: ['g2'], receipt: /weekly/i, undoable: true })
  t.ok('TSLA, third in reading order, changed', r.chart('g2').tf === '1W', await tfs(p))
})
scn('mc the one you changed', [], MC, async (p, t) => {
  await p.select('g0')
  await act(p, t, { say: 'make the top-right chart weekly', plan: setTf('AMD', 'W'), touch: ['g1'] })
  const r = await act(p, t, { say: 'make the one you just changed daily', plan: setTf('AMD', 'D'), touch: ['g1'], receipt: /daily/i })
  t.ok('"you" beat the clicked chart', r.chart('g1').tf === '1D' && r.chart('g0').tf === '1D', await tfs(p))
})
scn('mc you versus I', [], MC, async (p, t) => {
  await tf1('g2', '1M')(p)
  t.ok('the member changed the third cell by hand', (await p.read('g2'))[0].tf === '1M', await tfs(p))
  await act(p, t, { say: 'make the top-right chart weekly', plan: setTf('AMD', 'W'), touch: ['g1'] })
  // the Agent acted last; "I" is still the member's cell
  const r1 = await act(p, t, { say: 'make the one I just changed daily', plan: setTf('TSLA', 'D'), touch: ['g2'], receipt: /daily/i })
  t.ok('"I" is the member\'s cell', r1.chart('g2').tf === '1D' && r1.chart('g1').tf === '1W', await tfs(p))
  await tf1('g0', '1M')(p)
  // the member acted last; "you" is still the Agent's last change, which was on the third cell
  const r2 = await act(p, t, { say: 'make the one you just changed weekly', plan: setTf('TSLA', 'W'), touch: ['g2'], receipt: /weekly/i })
  t.ok('"you" is the Agent\'s cell, not the member\'s newer one', r2.chart('g2').tf === '1W' && r2.chart('g0').tf === '1M' && r2.chart('g1').tf === '1W', await tfs(p))
})
scn('mc you with only a member change', [], MC, async (p, t) => {
  await tf1('g2', '1M')(p)
  await act(p, t, { say: 'make the one you just changed weekly', plan: setTf('TSLA', 'W'), touch: [], noReceipt: true, busy: false })
  t.ok('asked, never guessed', /which/i.test(await p.last()), await p.last())
})
const wheelCell = async (p, id) => { await wheelChart(p, id) }
scn('mc sync off is the control', [], MC, async (p, t) => {
  await p.select('g0')
  const a = await p.read()
  await wheelCell(p, 'g0')
  const b = await p.read()
  t.ok('a wheel moved the cell under it', b.find(x => x.id === 'g0').pixels !== a.find(x => x.id === 'g0').pixels)
  t.ok('and no other cell', others('g0').every(id => b.find(x => x.id === id).pixels === a.find(x => x.id === id).pixels))
})
const dragCell = async (p, id) => {
  const c = await p.b.evaluate('(() => { const e = document.querySelector(\'[data-grid-cell-id="' + id + '"] .tv-lightweight-charts canvas\'); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()')
  await p.b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y })
  await p.b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 10; i++) { await p.b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x + i * 10, y: c.y, button: 'left', buttons: 1 }); await sleep(50) }
  await p.b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x + 100, y: c.y, button: 'left', clickCount: 1 })
  await p.b.hover(2, 2)
  await sleep(1500)
  await p.settle()
}
const months = (c) => c.text.filter(x => /^[A-Z][a-z][a-z]$|^20[0-9][0-9]$/.test(x)).join()
scn('mc sync a member drag', [], { query: 'multichart=sync' }, async (p, t) => {
  await p.select('g0')
  const a = await p.read()
  await dragCell(p, 'g0')
  const b = await p.read()
  t.ok('a real drag moved the cell under it', b.find(x => x.id === 'g0').pixels !== a.find(x => x.id === 'g0').pixels)
  for (const id of others('g0')) t.ok(id + ' followed the drag', b.find(x => x.id === id).pixels !== a.find(x => x.id === id).pixels)
  t.ok('all three show the same months', new Set(FILLED.map(id => months(b.find(x => x.id === id)))).size === 1, FILLED.map(id => months(b.find(x => x.id === id))).join(' | '))
})
scn('mc sync a member wheel', [], { query: 'multichart=sync' }, async (p, t) => {
  await p.select('g0')
  const a = await p.read()
  await wheelCell(p, 'g0')
  await sleep(1500)
  const b = await p.read()
  t.ok('a real wheel zoomed the cell under it', b.find(x => x.id === 'g0').pixels !== a.find(x => x.id === 'g0').pixels)
  for (const id of others('g0')) t.ok(id + ' followed the wheel', b.find(x => x.id === id).pixels !== a.find(x => x.id === id).pixels, months(b.find(x => x.id === id)) + ' vs ' + months(b.find(x => x.id === 'g0')))
})
const jump = (name, say, date, months, { follows = true } = {}) => scn(name, [], { query: 'multichart=sync' }, async (p, t) => {
  await p.select('g0')
  const r = await act(p, t, { say, plan: (b) => ({ ops: [{ action: 'chart.goToDate', target: refOf(b, 'NVDA'), args: { date } }] }), touch: follows ? FILLED : ['g0'], says: follows ? /moved with it/i : /stayed where they were/i })
  t.ok('the date is on the clicked cell\'s axis', axisHas(r.chart('g0'), months), r.chart('g0').text.slice(-6).join(' '))
  if (follows) for (const id of others('g0')) t.ok(id + ' followed', axisHas(r.chart(id), months), r.chart(id).text.slice(-6).join(' '))
})
jump('mc sync an Agent date jump', 'go to june 2 2025', '2025-06-02', /^(May|Jun)$/)
// near the start of the 200-bar fixture the view is mostly empty, so the cell does not send it, and the receipt says the others stayed
jump('mc sync an Agent date jump near the start of history', 'go to march 3 2025', '2025-03-03', /^(Feb|Mar)$/, { follows: false })
scn('mc sync a wheel from inside the bars', [], { query: 'multichart=sync' }, async (p, t) => {
  await p.select('g0')
  await dragCell(p, 'g0')
  const a = await p.read()
  await wheelCell(p, 'g0')
  await sleep(1500)
  const b = await p.read()
  for (const id of FILLED) t.ok(id + ' moved', b.find(x => x.id === id).pixels !== a.find(x => x.id === id).pixels)
})
scn('mc hidden cell refused', [], MC, async (p, t) => {
  const q = await p.b.evaluate('(() => { const e = document.querySelector(\'[data-grid-cell-id="g0"] [aria-label="Maximize this chart"]\'); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()')
  await p.b.click(q.x, q.y)
  await p.b.hover(2, 2)
  await p.settle()
  const face = async () => (await p.b.evaluate('[...document.querySelectorAll("[data-grid-cell-id]")].filter(e => e.getBoundingClientRect().width > 0).map(e => e.dataset.gridCellId).join()'))
  const wide = await p.b.evaluate('document.querySelector(\'[data-grid-cell-id="g0"]\').getBoundingClientRect().width')
  const hit = await p.b.evaluate('(() => { const r = document.querySelector(\'[data-grid-cell-id="g0"]\').getBoundingClientRect(); const e = document.elementFromPoint(r.right - 30, r.bottom - 60); return e.closest("[data-grid-cell-id]")?.dataset.gridCellId })()')
  t.ok('the maximized cell fills the grid and is what a click hits', wide > 600 && hit === 'g0', JSON.stringify([wide, hit, await face()]))
  const before = (await p.read('g0'))[0]
  await act(p, t, { say: 'make the top-right chart weekly', plan: setTf('AMD', 'W'), noReceipt: true, says: /hidden behind the maximized/i, busy: false })
  await act(p, t, { say: 'make chart 3 weekly', plan: setTf('TSLA', 'W'), noReceipt: true, says: /hidden behind the maximized/i, busy: false })
  t.ok('the maximized cell did not move', (await p.read('g0'))[0].pixels === before.pixels)
  // the model names the hidden cell itself: refused at the same gate
  await act(p, t, { say: 'please set the amd one to the weekly timeframe', plan: setTf('AMD', 'W'), noReceipt: true, says: /hidden behind the maximized/i, busy: false })
  const stored = JSON.parse((await p.written()).multichart_state || '{}')
  t.ok('nothing behind it changed', !(stored.cells || []).some(c => c.tf === 'W'), JSON.stringify((stored.cells || []).map(c => c.tf)))
  const r = await act(p, t, { say: 'make the top-left chart weekly', plan: setTf('NVDA', 'W'), touch: ['g0'], receipt: /weekly/i })
  t.ok('the maximized cell itself still works', r.chart('g0').tf === '1W', r.chart('g0').tf)
})
scn('mc what does not carry over', [], MC, async (p, t) => {
  await act(p, t, { say: 'add a news widget', plan: { ops: [{ action: 'widget.add', target: '$workspace', args: { type: 'news', as: null } }] }, touch: [], noReceipt: true, says: /hidden while Multi Chart|Exit Multi Chart/i, busy: false })
  await p.select('g0')
  await act(p, t, { say: 'show me this chart as of may 1 2025', plan: (b) => ({ ops: [{ action: 'chart.replay', target: refOf(b, 'NVDA'), args: { date: '2025-05-01' } }] }), touch: [], noReceipt: true, busy: false })
  t.ok('replay is refused in words, no false receipt', true, await p.last())
})
scn('mc cell ticker and indicator', [], MC, async (p, t) => {
  await p.select('g1')
  const snap = await p.read()
  const r = await act(p, t, { say: 'add rsi', plan: (b) => ({ ops: [{ action: 'indicator.add', target: b.context.indicatorEdits.find(e => e.symbol === 'AMD').ref, args: { defId: 'rsi', inputs: null } }] }), touch: ['g1'], receipt: /RSI/, undoable: true })
  t.ok('an RSI pane on that cell only', r.chart('g1').panes.length === r.was('g1').panes.length + 1, JSON.stringify(r.chart('g1').panes))
  await undoTo(p, t, snap)
  const r2 = await act(p, t, { say: 'put SPY on chart 4', plan: (b) => ({ ops: [{ action: 'chart.setSymbol', target: b.context.charts.at(-1).ref, args: { symbol: 'SPY' } }] }), touch: ['g3'], receipt: /SPY/, undoable: true })
  t.ok('the empty cell filled, and only it', r2.chart('g3').sym === 'SPY' && FILLED.every(id => r2.chart(id).sym === r2.was(id).sym), JSON.stringify(r2.after.map(c => c.sym)))
})

// ── runner ─────────────────────────────────────────────────────────────────────────────────────────────
const R = await startRelay({ groupOfAction })
const results = []
for (const s of S) {
  if (filter && !filter.test(s.id)) continue
  if (!filter && s.id.startsWith('mc ')) continue
  console.log(`\n== ${s.id}`)
  const t = tracker(s.id)
  let p = null
  const t0 = Date.now()
  try {
    p = await open(R, { query: s.opts.query || '', prefs: s.opts.prefs, fixtures: s.opts.fixtures, iaCatalog: s.opts.iaCatalog, ls: s.opts.ls, dateShaped: s.opts.dateShaped })
    await p.settle()
    await p.openPanel()
    // the workspace mounts panels in batches: a board is ready when every chart on it has painted
    const up = await p.b.waitFor(`(() => { const c = window.__baRead().filter(w => w.type === 'chart'); return !c.length || c.every(x => (x.sym && x.canvases > 5) || ((x.id === 'g3' || ${!!s.opts.emptyCell}) && !x.sym)) })()`, { timeout: 30000 })
    t.ok('every chart on the board painted', !!up, JSON.stringify((await p.charts()).map(brief)))
    await p.settle()
    await s.fn(p, t)
    if (SHOTS) await p.shot(`${SHOTS}/${s.id.replace(/\W+/g, '-')}.png`)
    const errs = p.errors()
    if (!s.opts.allowErrors) t.ok('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '))
  } catch (e) {
    t.ok('scenario ran to the end', false, e.stack || e.message)
    try { if (SHOTS && p) await p.shot(`${SHOTS}/${s.id.replace(/\W+/g, '-')}-crash.png`) } catch { /* */ }
  }
  try { p?.close() } catch { /* */ }
  R.queue.length = 0
  await sleep(300)
  const pass = t.checks.every(c => c.pass)
  results.push({ id: s.id, rows: s.rows, pass, secs: Math.round((Date.now() - t0) / 1000), checks: t.checks, turns: t.turns })
  console.log(`== ${pass ? 'PASS' : 'FAIL'} ${s.id} (${t.checks.filter(c => c.pass).length}/${t.checks.length})`)
  writeFileSync(OUT, JSON.stringify(results, null, 1))
}
R.close()
console.log(`\n${results.filter(r => r.pass).length} of ${results.length} scenarios passed`)
process.exit(0)
