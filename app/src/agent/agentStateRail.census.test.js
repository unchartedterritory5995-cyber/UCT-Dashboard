// ⛔ STATE RAIL CENSUS (owner principle 2026-11-13: "An additive request must never be treated as permission to replace or
// destroy existing user state.") — BY TOOL, enumerated from the registry (never a hand list), the chart rail census's method
// (agentChartRail.census.test.js) for the rest of the Charts workspace: every registered capability is planned by the REAL
// planner (executor.planOps) over a Charts fixture holding EXISTING state of every kind — indicators on the charts (an RSI and
// the four classic averages), drawings, two Drawing Boards, saved watchlists with a note, a Flagged list, a Watchlist widget
// showing a list and a Scanner widget showing a scan (one with a tab), saved layouts pinned on the Layout bar, a saved chart
// template — with arguments generated from its own args schema (plus the fixture's real ids / names). What every plan would
// do to that state is read per TARGET KIND by stateRail.stateEffects; a capability not planned from the fuzz arguments has its
// own apply() run unchecked on the real state; a kind the rail does not read must be STRUCTURALLY unable to write any of
// these states (its writer calls none of their writers).
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { stateFixture, drawingIds, SCAN } from './__fixtures__/stateBoard'
import { allCapabilityNames, getCapability, getTargetKind } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { stateEffects, stateRailRefusal, STATE_KINDS } from './stateRail'
import { RAIL_KINDS } from './chartRail'

vi.stubEnv('VITE_INDICATOR_TEMPLATES_ENABLED', '1')
registerBuiltins()

// ── arguments from the capability's own schema: each argument's candidates by its TYPE, the fixture's real ids / names
// first for the argument names that take them (a widget, a drawing, a layout …), then every generic value ──
const BY_NAME = () => ({
  widget: ['wl', 'sc', 'c1'], a: ['wl', 'c1'], b: ['sc', 'c2'], drawing: drawingIds(), tab: ['wt1', 'main', '1'], list: ['wl1', 'wl2'],
  layout: ['12', 'Swing', '11'], board: ['Swing board', 'Board 1'], template: ['Dark', 'Momentum'], range: ['3M', '1Y'],
  instance: ['inst:rsi:1', 'ovl:0'], pane: ['inst:rsi:1'], place: ['pane', 'price', 'inst:rsi:1'], from: ['c2', '2026-01-05', 'c1'], to: ['up', 'Renamed', '2026-02-02'],
  date: ['2026-01-05', '2026-03-02'], color: ['red', null], up: ['red'], down: ['blue'], name: ['New one', 'Swing', 'Tech'], text: ['Note'],
  symbol: ['SPY', 'AAPL'], key: ['period', 'scan', 'showLogos'], value: [SCAN, 'red'], chart: ['c1', 'c2'], defId: ['rsi', 'macd'], screen: ['Mine'],
})
const NUMS = { point: [1, 2], price: [105], level: [0.618], x: [0, 16], y: [0], w: [4, 8], h: [20, 10] }
const STRINGS = () => [...drawingIds(), 'inst:rsi:1', 'ovl:0', 'rsi', 'c1', 'c2', 'wl', 'sc', 'wt1', '1', 'main', 'AAPL', 'SPY',
  'Tech', 'Swing', 'Mine', '11', '12', 'Dark', 'Momentum', 'Board 1', 'Swing board', 'wl1', SCAN, 'flagged', 'red', 'D', 'New one', '2026-03-02']
const PTS = [{ date: '2026-01-05', price: 100 }, { date: '2026-02-02', price: 110 }, { date: '2026-03-02', price: 105 }]
const ARRAYS = [[], ['AAPL'], ['SPY'], ['SPY', 'NVDA'], ['inst:rsi:1'], ['AAPL', 'MSFT'], ['entry', 'stop']]
// an array of OBJECTS: items built from the item schema itself — every combination of each property's first candidates
// (one item, and that item followed by the next)
function itemsOf(schema) {
  const props = Object.keys(schema?.properties || {})
  const lists = props.map(p => candidates(schema.properties[p], p).slice(0, props.length > 3 ? 2 : 4))
  let all = [{}]
  props.forEach((p, i) => { all = all.flatMap(o => lists[i].map(v => ({ ...o, [p]: v }))) })
  all = all.slice(0, 24)
  return [...all.map(x => [x]), ...all.slice(0, 8).map((x, i) => [x, all[(i + 1) % all.length]])]
}
// each TYPE's candidates, interleaved (a string / number / boolean argument meets every type in its first few values)
function candidates(prop, key = '') {
  const types = [].concat(prop?.type || [])
  if (Array.isArray(prop?.enum)) return [...prop.enum, ...(types.includes('null') && !prop.enum.includes(null) ? [null] : [])]
  const per = []
  if (types.includes('string')) per.push([...(BY_NAME()[key] || []), ...STRINGS()])
  if (types.includes('integer') || types.includes('number')) per.push([...(NUMS[key] || []), 1, 20, 150])
  if (types.includes('boolean')) per.push(['visible', 'reset'].includes(key) ? [false, true] : [true, false])
  if (types.includes('array')) per.push([[], ...(prop.items?.type === 'object' ? itemsOf(prop.items) : []), ...(key === 'points' ? [PTS.slice(0, 2), PTS] : []), ...ARRAYS])
  if (types.includes('object')) per.push([PTS[0], {}])
  const out = []
  for (let i = 0; per.some(l => i < l.length); i++) for (const l of per) if (i < l.length) out.push(l[i])
  if (types.includes('null')) out.push(null)
  return out.length ? [...new Set(out)] : [null]
}
function shapeArgs(cap) {
  const m = /^\s*(\{.*?\})(?=\s+or\s|;|\s*$)/.exec(String(cap.shape || ''))
  try { return m ? JSON.parse(m[1]) : null } catch { return null }
}
function* argSets(cap) {
  const ex = shapeArgs(cap)
  if (ex) yield ex
  const schema = cap.args
  const keys = Object.keys(schema?.properties || {})
  const lists = keys.map(k => candidates(schema.properties[k], k))
  // the DIAGONALS first (every argument moves at once: each candidate of every argument is tried early), then the product
  const longest = Math.max(1, ...lists.map(l => l.length))
  for (let d = 0; d < longest; d++) for (let s = 0; s < 3; s++) yield Object.fromEntries(keys.map((k, i) => [k, lists[i][(d + s * i) % lists[i].length]]))
  yield* combos(keys, lists)
}
// the whole product when it is small; else the product walked in order (the first argument fastest) AND a fixed
// pseudo-random sample of it (every argument varying independently — an ordered walk holds its last argument still)
function* combos(keys, lists, cap = 1500) {
  const size = lists.reduce((n, l) => n * l.length, 1)
  const idx = keys.map(() => 0)
  for (let n = 0; n < Math.min(size, cap); n++) {
    yield Object.fromEntries(keys.map((k, i) => [k, lists[i][idx[i]]]))
    for (let i = 0; i < keys.length && ++idx[i] >= lists[i].length; i++) idx[i] = 0
  }
  if (size <= cap) return
  let seed = 20261113
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed >> 4 }
  for (let n = 0; n < cap; n++) yield Object.fromEntries(keys.map((k, i) => [k, lists[i][next() % lists[i].length]]))
}
// what a look-up step (prepare) hands the planner when the member has no alerts yet and SPY last traded at 105
const ENV = { mcGroups: [], boundDrawingIds: new Set(), boundAlerts: [], positionQuotes: { SPY: 105 } }
const CTX = { surface: 'charts' }
const effectKey = (e) => `${e.state}:${e.type}`

// a capability that looks things up first (prepare: the alerts book, a ticker check) is planned with what it looked up — the
// alerts route answers with none (fetch stubbed: no network)
async function envFor(cap, name, ref) {
  if (!cap.prepare) return ENV
  try { return { ...Object.fromEntries(Object.entries(await prepareOps([{ action: name, target: ref, args: argSets(cap).next().value }])).filter(([, v]) => v != null)), ...ENV } } catch { return ENV }
}
async function census() {
  globalThis.fetch = async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  const rows = []
  for (const name of allCapabilityNames().sort()) {
    const cap = getCapability(name)
    if (cap.query) continue
    const kind = getTargetKind(cap.target)
    const { host } = stateFixture()
    let targets
    try { targets = collectTargets(host, [cap.target]) } catch { targets = new Map() }
    const refs = [...targets.keys()].slice(0, 3)
    const seen = new Set()
    const samples = []                          // up to 8 plans with a destroying effect, for the rail tests below
    const keep = (plan, args) => { const eff = stateEffects(plan); for (const e of eff) seen.add(effectKey(e)); if (eff.length && samples.length < 8) samples.push({ plan, args }) }
    let planned = 0
    const env = await envFor(cap, name, refs[0])
    for (const ref of refs) {
      for (const args of argSets(cap)) {
        let plan
        try { plan = planOps(collectTargets(host, [cap.target]), [{ action: name, target: ref, args }], env, CTX) } catch { continue }
        if (!plan.ok) continue
        planned++
        keep(plan, args)
      }
    }
    // (1) not planned from the fuzz arguments, on a kind the rail READS: its own apply() run unchecked on the real state,
    //     the patch its kind would write read the same way
    let applied = 0
    if (!planned && kind && STATE_KINDS.includes(cap.target)) {
      for (const ref of refs) {
        const snap = targets.get(ref)?.snap
        if (!snap) continue
        for (const args of argSets(cap)) {
          let after, patch
          const before = kind.stateOf(snap)
          try { after = cap.apply(before, args, { ...env, target: snap, peer: () => null }); patch = after ? kind.patch(before, after) : null } catch { continue }
          if (!after) continue
          applied++
          keep({ ok: true, plans: [{ ref, kind: cap.target, snap, before, after, patch, items: [], virtual: false }] }, args)
        }
      }
    }
    // (2) a kind the rail does NOT read: its writer (commit) calls none of the writers of these states — checked on its source
    const structural = !!kind && !STATE_KINDS.includes(cap.target) && !STATE_WRITERS.test(String(kind.commit || ''))
    rows.push({ name, kind: cap.target, reachable: refs.length > 0 && !!kind, planned, applied, structural, effects: [...seen].sort(), samples })
  }
  return rows
}
// the host writers that can remove, replace or overwrite the member's indicators, drawings, boards, watchlists, widgets,
// layouts, the Layout bar or templates (a chart's settings — its indicators — go through charts.commit)
const STATE_WRITERS = /charts\.commit|drawings\.|drawingBoards\.|watchlists\.|flagged\.|applyBoard|widgets\.remove|layouts\.|layoutDock\.|prefs\.(?:write|merge)\([^)]*templat/i

let rowsP = []
beforeAll(async () => { rowsP = await census() }, 120000)
describe('STATE RAIL census — by tool, from the registry', () => {
  const hits = () => rowsP.filter(r => r.effects.length)
  it('prints the census (every capability that can remove / replace / overwrite existing state)', () => {
    const reach = rowsP.filter(r => r.reachable)
    // eslint-disable-next-line no-console
    console.log(`STATE RAIL CENSUS: ${rowsP.length} capabilities, ${reach.length} reachable on the fixture · planned ${reach.filter(r => r.planned).length} · apply() unchecked ${reach.filter(r => !r.planned && r.applied).length} · structural (a kind with no state writer) ${reach.filter(r => !r.planned && !r.applied && r.structural).length} · chart rail kind ${reach.filter(r => !r.planned && !r.applied && !r.structural && RAIL_KINDS.includes(r.kind)).length}\n`
      + hits().map(r => `  ${r.name.padEnd(32)} [${r.kind}] ${r.effects.join(', ')}`).join('\n'))
    expect(rowsP.length).toBeGreaterThan(150)
  })
  it('EXHAUSTIVE: every capability on a state kind is planned or its apply() run; every other kind is structurally unable to write state', () => {
    // (a CHART RAIL kind the state rail does not read — the Multi Chart grid — is the chart rail's: its own census proves it)
    const open = rowsP.filter(r => (STATE_KINDS.includes(r.kind) ? !(r.planned || r.applied) : !(r.structural || RAIL_KINDS.includes(r.kind)))).map(r => `${r.name} [${r.kind}]`)
    expect(open).toEqual([])
  })
  it('the set of destroying capabilities is exactly what the rail is tested against (a new tool with such an effect fails here until covered)', () => {
    expect(Object.fromEntries(hits().map(r => [r.name, r.effects]))).toEqual(EXPECTED)
  })
  it('every destroying plan is REFUSED for every additive wording (any casing, with or without a verb) — and allowed for its explicit words', () => {
    let n = 0
    for (const r of hits()) {
      expect(r.samples.length, r.name).toBeGreaterThan(0)
      for (const { plan, args } of r.samples) {
        for (const w of ADDITIVE_WORDS) {
          n++
          expect(stateRailRefusal(plan, { words: w }), `${r.name} ${JSON.stringify(args)} · "${w}"`).toMatch(/^I didn’t change anything/)
        }
        // the explicit word for its kind of change lets it through (and a request with no additive word is never read)
        // (kind-matched: the explicit clause names each effect's own class)
        const eff = stateEffects(plan)
        const nouns = [...new Set(eff.map(e => NOUN[e.state]))].join(' and the ')
        const explicit = eff.every(e => e.type === 'overwrite') ? `add AAPL, and change the ${nouns}` : eff.every(e => e.type === 'replace') ? `add AAPL, and replace the ${nouns}` : `add AAPL, and remove the ${nouns}`
        // …and the same permit for ANOTHER class licenses nothing here
        for (const [st, noun] of Object.entries(NOUN)) if (!eff.some(e => (e.classes || [e.state]).includes(st))) expect(stateRailRefusal(plan, { words: `add AAPL, and remove the ${noun}` }), `${r.name} cross-kind ${noun}`).toBeTruthy()
        expect(stateRailRefusal(plan, { words: explicit }), `${r.name} explicit "${explicit}"`).toBe(null)
        expect(stateRailRefusal(plan, { words: 'do it' }), `${r.name} not additive`).toBe(null)
      }
    }
    // eslint-disable-next-line no-console
    console.log(`STATE RAIL census refusals checked: ${n}`)
  })
})

const NOUN = { indicator: 'indicators', drawing: 'drawings', drawingBoard: 'drawing board', watchlist: 'watchlist', widget: 'widget', layout: 'layout', layoutBar: 'layout bar', template: 'template' }
const ADDITIVE_WORDS = ['add AAPL', 'ADD an RSI', 'Add a trendline', 'adding one', 'put a new one on', 'PUT ANOTHER LINE', 'include MSFT', 'another one', 'Another RSI',
  'one more please', 'also MSFT', 'AAPL as well', 'TSLA too', 'a new layout', 'Insert a widget', 'more indicators', 'extra line', 'additional watchlist',
  'add it, don’t remove anything', 'add AAPL without deleting anything', 'put AAPL on — never replace']
// every capability that can destroy, replace or overwrite existing state, and how (read by stateRail.stateEffects)
const EXPECTED = {
  'chart.applyTemplate': ['indicator:replace'],
  'chartSetup.deleteTemplate': ['template:delete'],
  'chartSetup.saveTemplate': ['template:overwrite'],
  'drawing.clear': ['drawing:clear', 'drawing:remove'],
  'drawing.deleteBoard': ['drawingBoard:delete'],
  'drawing.remove': ['drawing:remove'],
  'drawing.renameBoard': ['drawingBoard:overwrite'],
  'drawing.setAnchors': ['drawing:overwrite'],
  'drawing.setFibLevels': ['drawing:overwrite'],
  'drawing.setLevel': ['drawing:overwrite'],
  'drawing.setProps': ['drawing:overwrite'],
  'drawing.style': ['drawing:overwrite'],
  'indicator.remove': ['indicator:remove'],
  'indicator.update': ['indicator:overwrite'],
  'indicatorStyle.set': ['indicator:overwrite'],
  'indicatorTemplate.delete': ['template:delete'],
  'indicatorTemplate.save': ['template:overwrite'],
  'layout.delete': ['layout:delete'],
  'layout.rename': ['layout:overwrite'],
  'layout.saveCurrent': ['layout:overwrite'],
  'layout.unpinFromBar': ['layoutBar:remove'],
  'watchlist.clear': ['watchlist:clear'],
  'watchlist.delete': ['watchlist:delete'],
  'watchlist.keepOnly': ['watchlist:remove'],
  'watchlist.open': ['widget:replace'],
  'watchlist.remove': ['watchlist:remove'],
  'watchlist.rename': ['watchlist:overwrite'],
  'watchlist.setFlag': ['watchlist:remove'],
  'watchlist.setNote': ['watchlist:overwrite'],
  'watchlist.showList': ['widget:replace'],
  'widget.closeTab': ['widget:remove'],
  'widget.remove': ['widget:remove'],
  'widget.setOption': ['widget:replace'],
  'widget.showList': ['widget:replace'],
  'widget.showScan': ['widget:replace'],
}
