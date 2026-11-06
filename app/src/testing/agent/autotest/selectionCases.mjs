// UCT Agent AUTOTEST: the SELECTION cases. Generated, not listed: capability × board × how the chart is identified, so a family
// is covered by construction and no phrasing is special. Each case states what the words and click MEAN (`intended`); the
// scripted plan is derived from that and reads its target out of the request the panel really sent (`$chart:sel` is the chart
// the context marks selected), so a context that lies sends the plan to the wrong chart and the oracle sees it.
//
// A case is a plain spec, so the held-out set can be sealed as specs (selectionHeldout.mjs):
//   { id, board, cap, say, intended: 'clicked' | [roles] | 'ask', clicks: [role | { role, where }], plan, pre: [...], ... }
//   plan     'honest' (default) | 'adversary' (the plan is a bad guess: it may never land anywhere but `intended`)
//   pre      steps before the last sentence: { click, where } | { hover } | { close } | { clickWidget } | { say, cap, on, plan }
import { BOARDS } from './boards.mjs'
import { op, say } from './families/dsl.mjs'

const ie = (r) => `$ie:${r}`
const dr = (r) => `$dr:${r}`
const ch = (r) => `$chart:${r}`
const px = (r) => [[`${r}.pixels`, 'changed']]

// One entry per capability family. `ops(role)` is the plan on a chart; `check(role)` a state fact a person could see.
export const CAPS = {
  timeframe: { inv: ['C1-006'], ops: r => [op('chart.setTimeframe', ch(r), { timeframe: 'W' })], check: r => [[`${r}.tf`, 'eq', 'W']], phrases: ['make {T} weekly', 'switch {T} to the weekly', '{T} should be on the weekly', 'flip {T} over to weekly candles'], bare: ['weekly please', 'switch to weekly'] },
  symbol: { inv: ['C1-001'], ops: r => [op('chart.setSymbol', ch(r), { symbol: 'AVGO' })], check: r => [[`${r}.sym`, 'eq', 'AVGO']], phrases: ['put AVGO on {T}', 'change {T} to AVGO', 'swap {T} over to AVGO'], bare: ['go to AVGO', 'pull up AVGO'] },
  scale: { inv: ['C1-022'], ops: r => [op('chart.setScale', ch(r), { scale: 'log' })], check: r => [[`${r}.scale`, 'eq', 'log']], phrases: ['log scale on {T}', 'make {T} logarithmic'], bare: ['log scale'] },
  volume: { inv: ['C1-086'], ops: r => [op('volume.setState', ch(r), { state: 'hidden' })], check: r => [[`${r}.volume`, 'eq', false]], phrases: ['hide volume on {T}', 'take the volume off {T}'], bare: ['hide volume'] },
  type: { inv: ['C1-013'], ops: r => [op('chart.setType', ch(r), { type: 'line' })], check: px, phrases: ['make {T} a line chart', 'turn {T} into a line'], bare: ['line chart'] },
  indicator: { inv: ['C2-004'], ops: r => [op('indicator.add', ie(r), { defId: 'rsi', inputs: null })], check: r => [[`${r}.panes`, 'delta', 1]], phrases: ['add rsi to {T}', 'put an rsi on {T}', 'slap rsi on {T}'], bare: ['add rsi'] },
  averages: { inv: ['C1-103'], ops: r => [op('chartSetup.setMovingAverages', ch(r), { visible: false })], check: px, phrases: ['no moving averages on {T}', 'hide the moving averages on {T}'], bare: ['hide the moving averages'] },
  range: { inv: ['C1-029'], ops: r => [op('chartSetup.setRange', ch(r), { range: '3M' })], check: px, phrases: ['show three months on {T}', 'zoom {T} to 3 months'], bare: ['just the last three months'] },
  compare: { inv: ['C1-034'], ops: r => [op('chart.compare', ch(r), { add: ['AMD'], remove: [], clear: false })], check: px, phrases: ['overlay AMD on {T}', 'compare {T} with AMD'], bare: ['compare with AMD'] },
  // Multi Chart's top-right cell already shows AMD, and a chart cannot be compared with itself
  compareOther: { inv: ['C1-034'], ops: r => [op('chart.compare', ch(r), { add: ['MSFT'], remove: [], clear: false })], check: px, phrases: ['overlay MSFT on {T}', 'compare {T} with MSFT'], bare: ['compare with MSFT'] },
  background: { inv: ['C1-047'], ops: r => [op('chart.setBackground', ch(r), { color: '#000000' })], check: px, phrases: ['black background on {T}', 'make the background of {T} black'], bare: ['black background'] },
  theme: { inv: ['C1-079'], ops: r => [op('chart.applyTheme', ch(r), { theme: 'nord' })], check: px, phrases: ['use the nord colors on {T}', 'apply the nord theme to {T}'], bare: ['apply the nord theme'] },
  setting: { inv: ['C1-049'], ops: r => [op('chart.setSetting', ch(r), { setting: 'grid.visible', value: false })], check: px, phrases: ['kill the grid lines on {T}', 'hide the grid on {T}'], bare: ['kill the grid lines'] },
  level: { inv: ['C1-131'], ops: r => [op('drawing.addLevel', dr(r), { price: 120, color: null, style: null })], check: () => [['drawingCount', 'gt', 0]], phrases: ['draw a line at 120 on {T}', 'mark 120 on {T}'], bare: ['draw a line at 120'] },
  date: { inv: ['C1-030'], ops: r => [op('chart.goToDate', ch(r), { date: '2025-03-03' })], check: r => [[`${r}.axis`, 'changed']], phrases: ['jump {T} to march 3rd 2025', 'take {T} to march 3 2025'], bare: ['jump to march 3rd 2025'] },
  alert: { inv: ['C1-114'], ops: r => [op('alert.create', '$list:alertLibrary', { symbol: `$sym:${r}`, price: 120, direction: 'above' })], check: () => [['alerts', 'len', 1]], phrases: ['alert me when {T} goes above 120', 'set an alert at 120 on {T}'], bare: ['alert me above 120'] },
}

const DEICTIC = ['this chart', 'this one', 'the selected chart', 'the chart I clicked', 'the one I just clicked', 'my current chart', 'the active chart', 'the chart I have selected']
const CORE = ['timeframe', 'indicator', 'level', 'compare', 'symbol']
const ORDER = ['first', 'second', 'third', 'fourth']
const filled = (board) => Object.keys(BOARDS[board].roles).filter(r => BOARDS[board].roles[r].sym)
const wordOf = (board, r) => BOARDS[board].roles[r].position || BOARDS[board].roles[r].word

function planOf(spec) {
  const c = CAPS[spec.cap]
  if (!c || spec.noPlan) return { ops: [], disposition: 'answer', reply: '' }
  const on = (roles) => roles.flatMap(r => c.ops(r))
  if (spec.plan === 'adversary') return { ops: on([spec.bad]) }
  if (spec.intended === 'ask') return { disposition: 'clarify', question: { text: 'Which chart?', choices: filled(spec.board).map(r => wordOf(spec.board, r)) }, ops: [] }
  return { ops: on(spec.intended === 'clicked' ? ['sel'] : spec.intended) }
}

/** A spec → a full autotest request. The oracle comes from the meaning, never from the plan. */
export function buildCase(spec) {
  const c = CAPS[spec.cap]
  const clicks = (spec.clicks || []).map(x => (typeof x === 'string' ? { act: 'click', role: x } : { act: 'click', ...x }))
  const pre = (spec.pre || []).map(p => {
    if (p.say) return say(p.say, p.plan || (p.cap ? { ops: p.on.flatMap(r => CAPS[p.cap].ops(r)) } : { ops: [] }))
    if (p.click) return { act: 'click', role: p.click, where: p.where }
    if (p.hover) return { act: 'hover', role: p.hover }
    if (p.close) return { act: 'close', role: p.close }
    if (p.clickWidget) return { act: 'clickWidget', id: p.clickWidget }
    throw new Error(`unknown step ${JSON.stringify(p)}`)
  })
  const post = (spec.post || []).map(p => ({ act: p.act, role: p.role }))
  const last = spec.read ? say(spec.say, { ops: [], disposition: 'answer', reply: spec.read }) : say(spec.say, planOf(spec), spec.plan === 'adversary' ? { approve: false } : {})
  const lastClick = clicks.at(-1)?.role ?? [...(spec.pre || [])].reverse().find(p => p.click)?.click ?? null
  const target = { intended: spec.intended, ...(spec.expectClick !== undefined ? { click: spec.expectClick } : { click: lastClick }), ...(spec.plan === 'adversary' ? { guarded: true } : {}), ...(spec.ring ? { ring: true } : {}) }
  const roles = spec.intended === 'clicked' ? (lastClick ? [lastClick] : []) : spec.intended === 'ask' ? [] : spec.intended
  const expect = spec.plan === 'adversary' || spec.ring || spec.undone ? [] : roles.flatMap(r => c?.check(r) || []).filter((e, i, all) => all.findIndex(x => JSON.stringify(x) === JSON.stringify(e)) === i)
  const oracle = spec.read ? { outcome: 'read', target: { ...target, read: true }, says: spec.says, saysNot: spec.saysNot }
    : spec.ring ? { outcome: 'answer', target }
    : spec.plan === 'adversary' ? { outcome: 'guarded', target }
    : spec.intended === 'ask' ? { outcome: 'clarify', target }
    : { outcome: 'change', expect, target, ...(spec.undone ? { receipt: false } : {}) }
  return { id: spec.id, family: `sel-${spec.cap || 'flow'}`, kind: 'target', inventory: c?.inv || spec.inv || ['C1-006'], board: spec.board, select: null, turns: [...clicks, ...pre, last, ...post], oracle, unverifiable: spec.undone ? ['the state check is the target check: the chart Undo restores is the one that moved'] : [], browserOnly: true, negative: spec.negative || false, ...(spec.mutantOnly ? { mutantOnly: true } : {}) }
}

// ── the generator ────────────────────────────────────────────────────────────────────────────────────────────
function kindsFor(board, cap, n) {
  const c = CAPS[cap]
  const R = filled(board)
  const clickRole = R.at(-1)                       // never the first chart: "defaults to the first" must not pass by luck
  const other = R[Math.min(1, R.length - 1)]       // a chart that is neither the first nor the one clicked
  const phrase = (i = 0) => c.phrases[(n + i) % c.phrases.length]
  const fill = (t, T) => t.replace('{T}', T)
  const sym = BOARDS[board].roles[other].sym
  const count = ['two', 'three', 'four'][R.length - 2]
  return {
    deictic: { clicks: [clickRole], say: fill(phrase(), DEICTIC[n % DEICTIC.length]), intended: 'clicked' },
    bare: { clicks: [clickRole], say: c.bare[n % c.bare.length], intended: 'clicked' },
    position: { clicks: [clickRole], say: fill(phrase(1), `the ${wordOf(board, other)} chart`), intended: [other] },
    named: { clicks: [clickRole], say: fill(phrase(2), `the ${sym} chart`), intended: [other] },
    ordinal: { clicks: [clickRole], say: fill(phrase(), `the ${ORDER[R.indexOf(other)]} chart`), intended: [other] },
    noClickDeictic: { clicks: [], say: fill(phrase(), DEICTIC[(n + 1) % DEICTIC.length]), intended: 'ask' },
    noClickBare: { clicks: [], say: c.bare[(n + 1) % c.bare.length], intended: 'ask' },
    all: { clicks: [clickRole], say: fill(phrase(), n % 2 ? 'every chart' : `all ${count} charts`), intended: R },
    badDeictic: { clicks: [clickRole], say: fill(phrase(1), DEICTIC[(n + 2) % DEICTIC.length]), intended: 'clicked', plan: 'adversary', bad: 'notSel' },
    badNamed: { clicks: [clickRole], say: fill(phrase(2), `the ${wordOf(board, other)} chart`), intended: [other], plan: 'adversary', bad: 'sel' },
    badBare: { clicks: [], say: c.bare[n % c.bare.length], intended: 'ask', plan: 'adversary', bad: R[0] },
  }
}
const ALL_KINDS = ['deictic', 'bare', 'position', 'named', 'ordinal', 'noClickDeictic', 'noClickBare', 'all', 'badDeictic', 'badNamed', 'badBare']
// an alert belongs to one symbol: "alert on every chart" is not one request
const skip = (cap, kind) => cap === 'alert' && kind === 'all'

export function generated() {
  const out = []
  let n = 0
  const add = (board, cap, kind) => {
    if (skip(cap, kind)) return
    n += 1
    out.push({ id: `sel-${board}-${cap}-${kind}`, board, cap, ...kindsFor(board, cap, n)[kind] })
  }
  for (const board of ['FOUR', 'MC']) for (const cap of CORE) for (const kind of ALL_KINDS) add(board, board === 'MC' && cap === 'compare' ? 'compareOther' : cap, kind)
  for (const cap of Object.keys(CAPS)) if (!CORE.includes(cap) && cap !== 'compareOther') for (const kind of ['deictic', 'position']) add('FOUR', cap, kind)
  for (const cap of Object.keys(CAPS)) if (!CORE.includes(cap) && !['alert', 'compareOther'].includes(cap)) add('MC', cap, 'deictic')
  for (const board of ['TWO', 'THREE']) for (const cap of ['timeframe', 'indicator', 'level']) for (const kind of ['deictic', 'position', 'noClickBare', 'badDeictic', 'badNamed']) add(board, cap, kind)
  return out
}

// ── flows: the ways selection moves, and what happens around it ──────────────────────────────────────────────
export const FLOWS = [
  { id: 'flow-last-click-wins', board: 'FOUR', cap: 'timeframe', clicks: ['TL', 'BR'], say: 'make this chart weekly', intended: 'clicked' },
  { id: 'flow-last-click-wins-model', board: 'FOUR', cap: 'indicator', clicks: ['TR', 'BL'], say: 'add rsi to this chart', intended: 'clicked' },
  { id: 'flow-click-back', board: 'FOUR', cap: 'timeframe', clicks: ['BL', 'TR', 'BL'], say: 'make this one weekly', intended: 'clicked' },
  { id: 'flow-hover-does-not-select', board: 'FOUR', cap: 'timeframe', clicks: ['BL'], pre: [{ hover: 'TR' }], say: 'make this chart weekly', intended: 'clicked', expectClick: 'BL' },
  { id: 'flow-hover-alone', board: 'FOUR', cap: 'timeframe', pre: [{ hover: 'TR' }], say: 'make this chart weekly', intended: 'ask' },
  { id: 'flow-click-the-edge', board: 'FOUR', cap: 'timeframe', clicks: [{ role: 'BR', where: 'edge' }], say: 'make this chart weekly', intended: 'clicked' },
  { id: 'flow-click-the-axis', board: 'FOUR', cap: 'timeframe', clicks: [{ role: 'BL', where: 'axis' }], say: 'make this chart weekly', intended: 'clicked' },
  { id: 'flow-watchlist-click-keeps-it', board: 'FOUR', cap: 'timeframe', clicks: ['BL'], pre: [{ clickWidget: 'w-watch' }], say: 'make this chart weekly', intended: 'clicked', expectClick: 'BL' },
  { id: 'flow-it-after-a-new-click', board: 'FOUR', cap: 'scale', clicks: ['TL'], pre: [{ say: 'make this chart weekly', cap: 'timeframe', on: ['sel'] }, { click: 'BR' }], say: 'make it logarithmic', intended: 'clicked' },
  { id: 'flow-bare-after-a-new-click', board: 'FOUR', cap: 'scale', clicks: ['TL'], pre: [{ say: 'make this chart weekly', cap: 'timeframe', on: ['sel'] }, { click: 'BR' }], say: 'log scale', intended: 'clicked' },
  { id: 'flow-that-one-too', board: 'FOUR', cap: 'timeframe', clicks: ['TL'], pre: [{ say: 'make this chart weekly', cap: 'timeframe', on: ['sel'] }, { click: 'BR' }], say: 'that one too', intended: 'clicked' },
  { id: 'flow-same-to-the-other', board: 'TWO', cap: 'timeframe', clicks: ['A'], pre: [{ say: 'make this weekly', cap: 'timeframe', on: ['sel'] }], say: 'now do the same to the other one', intended: ['B'] },
  { id: 'flow-other-on-four-names-nothing', board: 'FOUR', cap: 'timeframe', clicks: ['TL'], say: 'make the other chart weekly', intended: 'ask' },
  { id: 'flow-followup-keeps-the-named-chart', board: 'FOUR', cap: 'scale', clicks: ['TL'], pre: [{ say: 'make the top-right chart weekly', cap: 'timeframe', on: ['TR'] }], say: 'now log scale', intended: ['TR'] },
  { id: 'flow-undo-after-a-new-click', board: 'FOUR', cap: 'timeframe', clicks: ['TL'], pre: [{ say: 'make this chart weekly', cap: 'timeframe', on: ['sel'] }, { click: 'BR' }], say: 'undo', intended: ['TL'], undone: true },
  { id: 'flow-selected-chart-closed', board: 'FOUR', cap: 'timeframe', clicks: ['BR'], pre: [{ close: 'BR' }], say: 'make this chart weekly', intended: 'ask', expectClick: 'BR' },
  { id: 'flow-position-beats-click', board: 'FOUR', cap: 'timeframe', clicks: ['BL'], say: 'make the top-right chart weekly', intended: ['TR'] },
  { id: 'flow-weekly-names-one', board: 'TFMIX', cap: 'scale', clicks: ['BR'], say: 'log scale on the weekly chart', intended: ['TR'] },
  { id: 'flow-five-minute-names-one', board: 'TFMIX', cap: 'volume', clicks: ['BR'], say: 'hide volume on the 5 minute chart', intended: ['BL'] },
  { id: 'flow-daily-names-two-click-decides', board: 'TFMIX', cap: 'scale', clicks: ['BR'], say: 'log scale on the daily chart', intended: 'clicked' },
  { id: 'flow-daily-names-two-no-click', board: 'TFMIX', cap: 'scale', say: 'log scale on the daily chart', intended: 'ask' },
  { id: 'flow-daily-names-two-clicked-elsewhere', board: 'TFMIX', cap: 'scale', clicks: ['TR'], say: 'log scale on the daily chart', intended: 'ask' },
  { id: 'flow-twin-no-click', board: 'TWIN', cap: 'volume', say: 'hide volume on the NVDA chart', intended: 'ask' },
  { id: 'flow-twin-click-one', board: 'TWIN', cap: 'volume', clicks: ['BL'], say: 'hide volume on the NVDA chart', intended: 'clicked' },
  { id: 'flow-twin-clicked-elsewhere', board: 'TWIN', cap: 'volume', clicks: ['TL'], say: 'hide volume on the NVDA chart', intended: 'ask' },
  { id: 'flow-linked-symbol-reaches-partner', board: 'LINKED', cap: 'symbol', clicks: ['L'], say: 'put AVGO on this chart', intended: ['L', 'M'] },
  { id: 'flow-linked-timeframe-stays', board: 'LINKED', cap: 'timeframe', clicks: ['M'], say: 'make this chart weekly', intended: 'clicked' },
  { id: 'flow-middle', board: 'THREE', cap: 'timeframe', clicks: ['L'], say: 'make the middle chart weekly', intended: ['M'] },
  { id: 'flow-last-of-three', board: 'THREE', cap: 'timeframe', clicks: ['L'], say: 'make the last chart weekly', intended: ['R'] },
  { id: 'flow-chart-number', board: 'THREE', cap: 'indicator', clicks: ['R'], say: 'add rsi to chart 2', intended: ['M'] },
  { id: 'flow-answer-picks-chart', board: 'FOUR', cap: 'volume', pre: [{ say: 'hide volume on this chart', plan: { disposition: 'clarify', question: { text: 'Which chart?', choices: ['Top-left chart (SPY)', 'Top-right chart (QQQ)', 'Bottom-left chart (NVDA)', 'Bottom-right chart (TSLA)'] }, ops: [] } }], say: 'the top right one', intended: ['TR'] },
  { id: 'flow-mc-last-click-wins', board: 'MC', cap: 'timeframe', clicks: ['A', 'C'], say: 'make this chart weekly', intended: 'clicked' },
  { id: 'flow-mc-empty-cell', board: 'MC', cap: 'timeframe', clicks: ['D'], say: 'make this chart weekly', intended: 'ask' },
  { id: 'flow-mc-position-beats-click', board: 'MC', cap: 'timeframe', clicks: ['C'], say: 'make the top-right chart weekly', intended: ['B'] },
  { id: 'flow-mc-it-after-a-new-click', board: 'MC', cap: 'scale', clicks: ['A'], pre: [{ say: 'make this chart weekly', cap: 'timeframe', on: ['sel'] }, { click: 'C' }], say: 'make it logarithmic', intended: 'clicked' },
  { id: 'flow-read-symbol', board: 'FOUR', clicks: ['BR'], say: 'what symbol is this chart', intended: [], read: 'TSLA', says: 'TSLA', saysNot: 'SPY' },
  { id: 'flow-read-timeframe', board: 'TFMIX', clicks: ['TR'], say: 'what timeframe is this chart on', intended: [], read: 'weekly', says: 'week', saysNot: 'daily' },
  { id: 'flow-read-mc', board: 'MC', clicks: ['C'], say: 'what symbol is this chart', intended: [], read: 'TSLA', says: 'TSLA', saysNot: 'NVDA' },
  { id: 'flow-ring-timeframe', board: 'FOUR', clicks: ['BR'], say: 'how do I change the timeframe on this chart', intended: 'clicked', ring: true },
  { id: 'flow-ring-indicator', board: 'FOUR', clicks: ['BL'], say: 'how do I add an indicator to this chart', intended: 'clicked', ring: true },
  { id: 'flow-ring-named', board: 'FOUR', clicks: ['BL'], say: 'how do I change the timeframe on the top right chart', intended: ['TR'], ring: true },
  { id: 'flow-ring-mc', board: 'MC', clicks: ['C'], say: 'how do I change the timeframe on this chart', intended: 'clicked', ring: true },
]

// ── negative cases: each of these MUST fail its target checks. A pass here means the oracle is blind ───────────
export const NEGATIVES = [
  // the oracle told the wrong meaning: the board is right, the oracle must still object
  { id: 'neg-wrong-chart-landed', board: 'FOUR', cap: 'timeframe', clicks: ['BL'], say: 'make this chart weekly', intended: ['TR'], negative: 'landed where intended' },
  // the Agent did its job, then a real click changed another chart: two charts moved, one was meant
  { id: 'neg-another-chart-moved-too', board: 'FOUR', cap: 'timeframe', clicks: ['BL'], say: 'make this chart weekly', intended: 'clicked', post: [{ act: 'humanScale', role: 'TR' }], negative: 'landed where intended' },
  // the case meant to click BL, and no click happened
  { id: 'neg-the-click-never-happened', board: 'FOUR', cap: 'timeframe', say: 'make this chart weekly', intended: 'ask', expectClick: 'BL', negative: 'the real click was on BL' },
  // the rig clicked a different chart from the one the case meant
  { id: 'neg-the-click-missed', board: 'FOUR', cap: 'timeframe', clicks: ['TR'], say: 'make this chart weekly', intended: 'clicked', expectClick: 'BL', negative: 'the real click was on BL' },
  // nothing landed where the click said it should
  { id: 'neg-nothing-landed', board: 'FOUR', cap: 'timeframe', clicks: ['BL'], say: 'what symbol is this chart', intended: 'clicked', noPlan: true, negative: 'landed where intended' },
]

export const specs = () => [...generated(), ...FLOWS]
export const selectionRequests = () => specs().map(buildCase).map(r => ({ ...r, set: 'public' }))
export const negativeRequests = () => NEGATIVES.map(s => {
  const r = buildCase(s)
  return { ...r, set: 'public', negative: s.negative }
})
