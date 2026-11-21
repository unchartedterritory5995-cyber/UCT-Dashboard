// ── D31 RESOLVER PILOT · the ORACLE's own checks (no resolver code exists yet) ─────────────────────────────────────────────
// 1. SHAPE: ids unique, reasons from the closed sets, required fields, no duplicate (words + context + plan), flags justified.
// 2. AGREEMENT with the rails on master: every row is run through the REAL chart rail then state rail, the way useAgent.railOf
//    composes them (chart rail first; the state rail only when it allows). A non-flagged row's expectation must agree:
//    the same resolved target, or both blocked (ask / refuse — a kind difference is counted, not failed: the state rail has no
//    ask for most destroys). `masterGap` / `adds` rows are LISTED as known gaps and never fail the suite; an expectation is
//    never changed to match master.
//    Offers are emulated as the rail-pick path does it (useAgent chooseTarget / railPickedRef): the answer read by deixis
//    pickedChoice against the offered choices → picked = { chart:<ref> }; the rail words are "<carried> . <answer>"
//    (railWordsRef). A stale offer carries nothing (no pending question: the answer's words alone).
import { describe, it, expect, afterAll } from 'vitest'
import { registerBuiltins } from '../builtins'
import { makeBoard } from '../__fixtures__/board'
import { stateFixture, settingsWithRsi } from '../__fixtures__/stateBoard'
import { mergeChartSettings } from '../../components/chart/chartDefaults'
import { planOps, collectTargets, prepareOps } from '../executor'
import { buildContext, getTargetKind } from '../capabilities'
import { chartRailRefusal } from '../chartRail'
import { stateRailDecision, stateEffects } from '../stateRail'
import { pickedChoice } from '../deixis'
import { POLICY, CODES, SOURCES, REASONS, EVIDENCE, WORLDS, INVARIANTS, FAMILY } from './policy'

registerBuiltins()

// ── 1 · SHAPE ──
describe(`ORACLE SHAPE · removal policy table (${POLICY.length} rows)`, () => {
  it('has 150–320 rows, every id unique', () => {
    expect(POLICY.length).toBeGreaterThanOrEqual(150)
    expect(POLICY.length).toBeLessThanOrEqual(320)
    expect(new Set(POLICY.map(r => r.id)).size).toBe(POLICY.length)
  })
  it.each(POLICY.map(r => [r.id, r]))('%s · fields, reason set, flags', (_id, r) => {
    expect(r.family).toBe(FAMILY)
    for (const k of ['id', 'words', 'plan', 'expect', 'reason', 'evidence', 'source']) expect(typeof r[k], k).toBe('string')
    expect(r.words.trim().length).toBeGreaterThan(0)
    expect(WORLDS).toContain(r.context.world)
    expect(EVIDENCE).toContain(r.evidence)
    expect(REASONS).toContain(r.reason)
    for (const part of r.plan.split('+')) expect(part).toMatch(/^(?:chart:c[1-4]|ind:c[1-3]:(?:rsi|ema20)|draw:dr-[a-z]|list:wl[12]|item:wl[12]:[A-Z]+)$/)
    if (r.emulated) expect(r.emulatedNote).toMatch(/emulated/)
    expect(r.expect).toMatch(/^(?:resolved:.+|ask|refuse)$/)
    // a resolved row licenses EXACTLY the plan's target, by a source; a blocked row carries a code
    if (r.expect.startsWith('resolved:')) { expect(r.expect).toBe(`resolved:${r.plan}`); expect(SOURCES).toContain(r.reason) } else expect(CODES).toContain(r.reason)
    for (const i of r.inv || []) expect(INVARIANTS).toContain(i)
    if (r.adds || r.masterGap) { expect(r.expect, 'a gap / add row blocks').not.toMatch(/^resolved:/); expect(typeof r.why, 'justified').toBe('string') }
    // (an AUDIT row keeps AUDIT's expectation even where master over-blocks: listed apart, never altered)
    if (r.overAsk) { if (r.source !== 'audit') expect(r.expect, 'overAsk keeps master’s block').not.toMatch(/^resolved:/); expect(r.policy).toMatch(/^resolved:/); expect(typeof r.why).toBe('string') }
    if (r.context.offers) expect(r.context.offers.refs.length).toBeGreaterThan(0)
  })
  it('no duplicate words + context + plan', () => {
    const keys = POLICY.map(r => JSON.stringify([r.words, r.context, r.plan]))
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i)
    expect(dup).toEqual([])
  })
  it('the table is frozen', () => {
    expect(Object.isFrozen(POLICY)).toBe(true)
    expect(POLICY.every(r => Object.isFrozen(r) && Object.isFrozen(r.context))).toBe(true)
  })
})

// ── 2 · AGREEMENT with the rails on master ──
const SYMS = { B3: ['SPY', 'QQQ', 'IWM'], B1: ['SPY'], BDUP: ['SPY', 'SPY', 'IWM'], B3R: ['SPY', 'QQQ', 'IWM'], B3E: ['SPY', 'QQQ', 'IWM'], B4: ['SPY', 'QQQ', 'NVDA', 'AMD'] }
function boardOf(syms, selected, { rsiOn = [], empty = [] } = {}) {
  const cw = syms.length > 3 ? 6 : 8
  const widgets = syms.map((_, i) => ({ id: `c${i + 1}`, type: 'chart', x: i * cw, y: 0, w: cw, h: 20, color: 'N', opts: { settings: rsiOn.includes(`c${i + 1}`) ? settingsWithRsi() : mergeChartSettings(null) } }))
  const g = {}
  syms.forEach((s, i) => { g[`N:c${i + 1}`] = s })
  const b = makeBoard(widgets, g)
  const base = b.host.charts
  // (an EMPTY chart: no symbol — the fixture otherwise defaults one)
  const blank = (x) => (x && empty.includes(x.ref) ? { ...x, symbol: '' } : x)
  b.host = { ...b.host, charts: { ...base, read: (r) => blank(base.read(r)), list: () => base.list().map(blank), selected: () => selected,
    canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null } }
  return b.host
}
function worldOf(ctx) {
  if (ctx.world === 'B3R') return boardOf(SYMS.B3R, ctx.selection, { rsiOn: ['c1', 'c3'] })
  if (ctx.world === 'B3E') return boardOf(SYMS.B3E, ctx.selection, { empty: ['c3'] })
  if (ctx.world !== 'ST') return boardOf(SYMS[ctx.world], ctx.selection)
  const fx = stateFixture()
  fx.host.charts = { ...fx.host.charts, selected: () => ctx.selection }
  return fx.host
}
const DRAW_SYM = { 'dr-n': 'NVDA' }
const INSTANCE = { rsi: 'inst:rsi:1', ema20: 'ovl:1' }
function opsOf(refs) {
  return refs.split('+').flatMap(opOf)
}
function opOf(ref) {
  const [type, a, b] = ref.split(':')
  if (type === 'chart') return [{ action: 'widget.remove', target: 'board', args: { widget: a } }]
  if (type === 'ind') return [{ action: 'indicator.remove', target: `ixe:${a}`, args: { instance: INSTANCE[b] } }]
  if (type === 'draw') return [{ action: 'drawing.remove', target: DRAW_SYM[a] || 'SPY', args: { drawing: a } }]
  if (type === 'list') return [{ action: 'watchlist.delete', target: a, args: {} }]
  if (type === 'item') return [{ action: 'watchlist.remove', target: a, args: { symbols: [b] } }]
  throw new Error(`unknown plan ref ${ref}`)
}
const kindOf = (o) => (o.target === 'board' ? 'board' : String(o.target).startsWith('ixe:') ? 'indicatorEdits' : /^wl\d$/.test(o.target) ? 'watchlist' : /^[A-Z]+$/.test(o.target) ? 'drawing' : 'chart')
async function planOf(host, ref) {
  const ops = opsOf(ref)
  buildContext(host, { surface: 'charts' })
  return planOps(collectTargets(host, [...new Set(ops.map(kindOf))]), ops, { ...(await prepareOps(ops)), boundDrawingIds: new Set(), boundAlerts: [] }, { surface: 'charts' })
}
// the typed id master's `previous` carries for a policy ref (chart:c3 as is; a thing: the id its own destroy plan's effect has)
async function previousIdOf(ctx) {
  if (!ctx.previous) return null
  if (ctx.previous.startsWith('chart:')) return ctx.previous
  const plan = await planOf(worldOf({ ...ctx, selection: null }), ctx.previous)
  return stateEffects(plan)[0]?.id || null
}
const ASK_TEXT = /^Which do you mean|Nothing is selected, so I can’t tell|I can’t tell which chart|fits \d+ charts|\d+ charts show|^Which chart should change/
/** The rails' outcome for a row: { verdict: 'resolved:<plan>' | 'ask' | 'refuse', text }. */
async function railOutcome(r) {
  const ctx = r.context
  const host = worldOf(ctx)
  const plan = await planOf(host, r.plan)
  if (!plan.ok) return { verdict: 'refuse', text: `PLAN NOT BUILT: ${JSON.stringify(plan.refusals || [])}` }
  const prev = await previousIdOf(ctx)
  const live = ctx.offers && !ctx.offers.stale
  const words = live ? `${ctx.offers.carried} . ${r.words}` : r.words
  let picked = null
  if (live) {
    const all = host.charts.list()
    const choices = ctx.offers.refs.map(ref => ({ ref, label: `the ${all.find(c => c.ref === ref)?.symbol} chart` }))
    const p = pickedChoice(r.words, choices)
    if (p) picked = new Set([`chart:${p}`])
  }
  const c = chartRailRefusal(plan, { words, host, mode: 'apply', subject: ctx.subject, picked, previous: prev, previousLabel: null })
  if (c) return { verdict: ASK_TEXT.test(c) ? 'ask' : 'refuse', text: c, rail: 'chart' }
  let scope = null
  try { const ls = getTargetKind('watchlist')?.list?.(host) || null; scope = { watchlists: ls ? ls.length : null, lists: ls ? ls.map(l => ({ ref: l.ref, name: l.name, symbols: (l.symbols || []).map(x => String(x).toUpperCase()) })) : null } } catch { scope = null }
  const d = stateRailDecision(plan, { words, mode: 'apply', subjects: prev ? new Set([prev]) : null, picked, previous: prev, previousSet: prev ? [{ id: prev }] : null, scope })
  if (d?.text) return { verdict: d.ask ? 'ask' : 'refuse', text: d.text, rail: 'state' }
  if (d?.card) return { verdict: 'refuse', text: 'CARD', rail: 'state' }
  return { verdict: `resolved:${r.plan}`, text: null, rail: null }
}

const tally = { auditOverOpen: [], auditOverClosed: [], emulated: [], agree: 0, agreeBlockedKindDiffers: 0, masterGapOpen: [], masterGapClosed: [], addsOpen: [], addsClosed: [], disagree: [], kindDiffers: [] }
describe(`ORACLE AGREEMENT · each row against master's rails (chartRail → stateRail)`, () => {
  it.each(POLICY.map(r => [r.id, r.words, r]))('%s · "%s"', async (_id, _w, r) => {
    const got = await railOutcome(r)
    const blocked = (v) => !v.startsWith('resolved:')
    const rec = { id: r.id, words: r.words, ctx: r.context, plan: r.plan, expect: r.expect, rail: got.verdict, text: got.text }
    // (AUDIT 11-16) emulated rows: reported apart, never counted as agreement or resolver wins
    if (r.emulated) tally.emulated.push(rec)
    if (r.overAsk && r.source === 'audit') { (blocked(got.verdict) ? tally.auditOverOpen : tally.auditOverClosed).push(rec); return }
    if (r.masterGap || r.adds) {
      const list = r.masterGap ? (blocked(got.verdict) ? tally.masterGapClosed : tally.masterGapOpen) : (blocked(got.verdict) ? tally.addsClosed : tally.addsOpen)
      list.push(rec)
      return
    }
    if (r.emulated) { expect(blocked(got.verdict) && blocked(r.expect) ? 'blocked' : got.verdict).toBe(blocked(r.expect) ? 'blocked' : r.expect); return }
    if (got.verdict === r.expect) tally.agree++
    else if (blocked(got.verdict) && blocked(r.expect)) { tally.agree++; tally.agreeBlockedKindDiffers++; tally.kindDiffers.push(rec) }
    else tally.disagree.push(rec)
    expect(blocked(got.verdict) && blocked(r.expect) ? 'blocked' : got.verdict, `${r.id} "${r.words}" — rail said: ${got.text}`).toBe(blocked(r.expect) ? 'blocked' : r.expect)
  })
})
afterAll(() => {
  if (!process.env.POLICY_REPORT) return
  const line = (x) => `  ${x.id} · "${x.words}" · ${JSON.stringify(Object.fromEntries(Object.entries(x.ctx).filter(([, v]) => v)))} · plan ${x.plan} · expect ${x.expect} · rail ${x.rail}${x.text ? ` · ${String(x.text).slice(0, 110)}` : ''}`
  console.log([
    `ORACLE AGREEMENT: rows ${POLICY.length} · emulated (apart) ${tally.emulated.length} · agree ${tally.agree} (blocked, kind differs ${tally.agreeBlockedKindDiffers}) · disagree ${tally.disagree.length}`,
    `masterGap open ${tally.masterGapOpen.length} / closed ${tally.masterGapClosed.length} · adds open ${tally.addsOpen.length} / closed ${tally.addsClosed.length}`,
    'DISAGREE:', ...tally.disagree.map(line), 'MASTER GAPS (open):', ...tally.masterGapOpen.map(line), 'MASTER GAPS (closed):', ...tally.masterGapClosed.map(line),
    'AUDIT OVER-BLOCK (open):', ...tally.auditOverOpen.map(line), 'AUDIT OVER-BLOCK (closed):', ...tally.auditOverClosed.map(line), 'EMULATED (offer rows, apart):', ...tally.emulated.map(line), 'ADDS (open):', ...tally.addsOpen.map(line), 'KIND DIFFERS:', ...tally.kindDiffers.map(line),
  ].join('\n'))
})
