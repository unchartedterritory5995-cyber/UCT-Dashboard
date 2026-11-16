// ── D31 RESOLVER · the ORACLE's worlds as the resolver reads them (test-only) ─────────────────────────────────────────────
// Each policy.js world letter is built on the SAME fixtures policy.test.js runs the rails on (makeBoard / stateFixture), then
// read through resolver/world.js worldFromHost — so the oracle runner exercises the host adapter the shadow hook uses too.
// A policy ref (chart:c1 · ind:c1:rsi · draw:dr-t · list:wl2 · item:wl1:NVDA) maps to the world's typed id.
import { makeBoard } from '../../__fixtures__/board'
import { stateFixture, settingsWithRsi } from '../../__fixtures__/stateBoard'
import { mergeChartSettings } from '../../../components/chart/chartDefaults'
import { worldFromHost } from '../world'

export const SYMS = { B3: ['SPY', 'QQQ', 'IWM'], B1: ['SPY'], BDUP: ['SPY', 'SPY', 'IWM'], B3R: ['SPY', 'QQQ', 'IWM'], B3E: ['SPY', 'QQQ', 'IWM'], B4: ['SPY', 'QQQ', 'NVDA', 'AMD'] }
export function boardHost(syms, { rsiOn = [] } = {}) {
  const cw = syms.length > 3 ? 6 : 8
  const widgets = syms.map((_, i) => ({ id: `c${i + 1}`, type: 'chart', x: i * cw, y: 0, w: cw, h: 20, color: 'N', opts: { settings: rsiOn.includes(`c${i + 1}`) ? settingsWithRsi() : mergeChartSettings(null) } }))
  const g = {}
  syms.forEach((s, i) => { g[`N:c${i + 1}`] = s })
  return makeBoard(widgets, g).host
}
const HOSTS = new Map()
/** The host for a world letter (built once per letter; the state fixture's drawings live in the module store). */
export function hostOf(world) {
  if (HOSTS.has(world)) return HOSTS.get(world)
  const h = world === 'ST' ? stateFixture().host : boardHost(SYMS[world], { rsiOn: world === 'B3R' ? ['c1', 'c3'] : [] })
  HOSTS.set(world, h)
  return h
}
/** The world one policy row describes (its selection, conversation chart, previous object and offers). */
export function worldOfRow(ctx, mapRef) {
  const host = hostOf(ctx.world)
  const w = worldFromHost(host, { selection: ctx.selection, subject: ctx.subject })
  if (ctx.world === 'B3E') w.charts = w.charts.map(c => (c.ref === 'c3' ? { ...c, symbol: '' } : c))
  w.previous = ctx.previous ? mapRef(w, ctx.previous) : null
  w.offers = ctx.offers ? { refs: [...ctx.offers.refs], stale: !!ctx.offers.stale } : null
  return w
}
const IND = { rsi: (i) => i.defId === 'rsi', ema20: (i) => i.defId === 'movingAverage' && Number(i.inputs?.period) === 20 && String(i.inputs?.maType).toLowerCase() === 'ema',
  ema9: (i) => i.defId === 'movingAverage' && Number(i.inputs?.period) === 9, sma50: (i) => Number(i.inputs?.period) === 50, sma200: (i) => Number(i.inputs?.period) === 200 }
/** policy ref → the world's typed id (a ref the world does not hold maps to a synthetic id of the right type). */
export function mapRef(w, r) {
  const [type, a, b] = String(r).split(':')
  if (type === 'chart') return `chart:${a}`
  if (type === 'ind') return w.indicators.find(i => i.chart === a && IND[b]?.(i))?.id || `ind:${a}:${b}`
  if (type === 'draw') return w.drawings.find(d => d.drawingId === a)?.id || `draw:?:${a}`
  if (type === 'list') return `list:${a}`
  if (type === 'item') return `item:${a}:${b}`
  return r
}
export const planOfRow = (w, plan) => plan.split('+').map(p => mapRef(w, p))
