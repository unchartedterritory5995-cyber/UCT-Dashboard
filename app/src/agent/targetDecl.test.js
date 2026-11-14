// ⭐ TARGET DECLARATIONS — Phase 1 unit tests (UNWIRED: docs/agent/design/TARGET-DECLARATIONS.md, AUDIT verdict on 5f3ecdd618).
// The REAL planner (executor.planOps) on the REAL fixture board; the resolver and validator read the plans it builds. No panel,
// no model, no network. Each `MUTANT:` test pins one AUDIT-named mutant (run by hand: see the PR body for the kill table).
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { getCapability } from './capabilities'
import { planOps, collectTargets } from './executor'
import {
  declareTargets, validateDeclaration, validateFanOut, refusesUnder, permitsEffect, narrowByModel, withAliases, rewriteAliases,
  shadowTelemetry, TELEMETRY_FIELDS, finalSpec, TD_KINDS, planEffects,
} from './targetDecl'

registerBuiltins()

const settings = () => ({ settings: mergeChartSettings(null) })
const chart = (id, x, w = 12) => ({ id, type: 'chart', x, y: 0, w, h: 20, color: 'N', opts: settings() })
const SPY_NVDA = () => [[chart('c1', 0), chart('c2', 12)], { 'N:c1': 'SPY', 'N:c2': 'NVDA' }]
const LAYOUTS = () => [[chart('c1', 0), chart('c2', 12)], { 'N:c1': 'SPY', 'N:c2': 'NVDA', 'N:x1': 'QQQ' },
  { layouts: { entries: [{ id: 11, name: 'Mine' }, { id: 12, name: 'Swing' }], boards: { 11: [chart('c1', 0), chart('c2', 12)], 12: [chart('x1', 0, 24)] }, active: 11 } }]
function hostOf([widgets, groups, opts] = SPY_NVDA(), { sel = null } = {}) {
  const b = makeBoard(widgets, groups, opts)
  const base = b.host.charts
  return { b, host: { ...b.host, charts: { ...base, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => sel } } }
}
const kindsOf = (ops) => [...new Set(ops.map(o => getCapability(o.action)?.target).filter(Boolean))]
const plan = (host, ops, env = {}) => planOps(collectTargets(host, kindsOf(ops)), ops, env, { surface: 'charts' })
const setSym = (target, symbol) => ({ action: 'chart.setSymbol', target, args: { symbol } })
const grid = (symbols, extra = {}) => ({ action: 'chartGrid.set', target: 'board', args: { symbols, timeframe: null, layout: 'grid', new_charts: null, watchlist: null, replace: null, ...extra } })
const run = (words, host, ops, more = {}) => {
  const p = plan(host, ops)
  expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
  const decl = declareTargets({ words, host, ...more })
  return { p, decl, r: validateDeclaration(p, decl, { host, words }) }
}
const vias = (decl) => decl.entries.map(e => `${e.ref}:${e.effect}:${e.via}`)
const CHART_ENFORCED = new Set(['chart', 'board', 'multiChart', 'layouts', 'content'])

describe('the lattice', () => {
  it('create < overwrite < replace < remove; switch only covers switch; nothing covers unreadable', () => {
    expect(permitsEffect('remove', 'overwrite')).toBe(true)
    expect(permitsEffect('overwrite', 'replace')).toBe(false)
    expect(permitsEffect('replace', 'remove')).toBe(false)
    expect(permitsEffect('switch', 'overwrite')).toBe(false)
    expect(permitsEffect('remove', 'switch')).toBe(false)
    expect(permitsEffect('switch', 'switch')).toBe(true)
    expect(permitsEffect('remove', 'unreadable')).toBe(false)
    expect(permitsEffect(undefined, 'overwrite')).toBe(false)
  })
})

describe('the declaration — entries only from positive evidence (AUDIT condition 2)', () => {
  it('a click authorises the clicked chart for a bare command', () => {
    const { host } = hostOf(SPY_NVDA(), { sel: 'c1' })
    const { decl, r } = run('show AAPL', host, [setSym('c1', 'AAPL')])
    expect(vias(decl)).toEqual(['c1:overwrite:click'])
    expect(r.verdict).toBe('match')
    expect(r.kinds.chart).toEqual({ match: 1, mismatch: 0, open: 0 })
  })
  it('DEFAULT-DENY: no click, nothing named → an effect on an existing chart is a mismatch', () => {
    const { host } = hostOf()
    const { decl, r } = run('show AAPL', host, [setSym('c1', 'AAPL')])
    expect(decl.entries).toEqual([])
    expect(r.verdict).toBe('mismatch')
    expect(r.mismatches[0]).toMatchObject({ kind: 'chart', why: 'no-entry', ref: 'c1' })
  })
  it('a chart the words name by its ticker, with the replace ceiling the words give', () => {
    const { host } = hostOf()
    const { decl, r } = run('change SPY to AAPL', host, [setSym('c1', 'AAPL')])
    expect(vias(decl)).toEqual(['c1:replace:named'])
    expect(r.verdict).toBe('match')
  })
  it('a chart named by position', () => {
    const { host } = hostOf()
    const { decl } = run('put AAPL on the right chart', host, [setSym('c2', 'AAPL')])
    expect(vias(decl)).toContain('c2:overwrite:named')
    expect(decl.entries.some(e => e.ref === 'c1')).toBe(false)
  })
  it('NEVER from the absence of a keep: "add … but keep SPY and NVDA" authorises neither chart', () => {
    const { host } = hostOf()
    const decl = declareTargets({ words: 'Add AAPL and MSFT to my charts, but keep SPY and NVDA', host })
    expect(decl.entries).toEqual([])
    expect(decl.keep.refs.sort()).toEqual(['c1', 'c2'])
  })
  it('an ADD names no existing chart: "add AAPL" authorises nothing on the board', () => {
    const { host } = hostOf()
    expect(declareTargets({ words: 'add AAPL', host }).entries).toEqual([])
  })
  it('a kept chart named by ticker is never an entry ("change NVDA to AAPL, keep SPY")', () => {
    const { host } = hostOf()
    const decl = declareTargets({ words: 'change NVDA to AAPL, keep SPY', host })
    expect(vias(decl)).toEqual(['c2:replace:named'])
  })
  it('the memory subject behind an anaphor', () => {
    const { host } = hostOf()
    const { decl, r } = run('make it AAPL', host, [setSym('c2', 'AAPL')], { subject: 'c2' })
    expect(vias(decl)).toEqual(['c2:overwrite:subject'])
    expect(r.verdict).toBe('match')
  })
  it('the created set behind a created-set reference — an old chart is a mismatch', () => {
    const { host } = hostOf()
    const decl = declareTargets({ words: 'change the new chart to AAPL', host, created: ['c2'] })
    expect(vias(decl)).toEqual(['c2:replace:created'])
    const p = plan(host, [setSym('c1', 'AAPL')])
    expect(validateDeclaration(p, decl, { host }).mismatches[0]).toMatchObject({ ref: 'c1', why: 'no-entry' })
  })
  it('"both charts" / "all my charts" names every chart', () => {
    const { host } = hostOf()
    const { decl, r } = run('make both charts AAPL', host, [setSym('c1', 'AAPL'), setSym('c2', 'AAPL')])
    expect(decl.entries.map(e => e.ref).sort()).toEqual(['c1', 'c2'])
    expect(r.verdict).toBe('match')
  })
  it('a layout opened in words switches every chart on screen …', () => {
    const { host } = hostOf(LAYOUTS())
    const { decl, r } = run('open my Swing layout', host, [{ action: 'layout.open', target: 'layouts', args: { layout: '12' } }])
    expect(decl.entries.filter(e => e.effect === 'switch').map(e => e.ref).sort()).toEqual(['c1', 'c2'])
    expect(r.kinds.layouts.match).toBe(2)
    expect(r.verdict).toBe('match')
  })
  it('… never a kept one (KEPT is an identity)', () => {
    const { host } = hostOf(LAYOUTS())
    const { r } = run('open my Swing layout but keep SPY', host, [{ action: 'layout.open', target: 'layouts', args: { layout: '12' } }])
    expect(r.verdict).toBe('mismatch')
    expect(r.mismatches.map(m => m.why)).toContain('kept')
  })
  it('a one-chart board: STRICT by default (sole is not an AUDIT evidence type), authorised only with opts.sole', () => {
    const { host } = hostOf([[chart('c1', 0, 24)], { 'N:c1': 'NVDA' }])
    expect(run('show AAPL', host, [setSym('c1', 'AAPL')]).r.verdict).toBe('mismatch')
    expect(run('show AAPL', host, [setSym('c1', 'AAPL')], { opts: { sole: true } }).r.verdict).toBe('match')
  })
  it('a resolver that throws → error, every chart kind OPEN (never a silent pass)', () => {
    const { host } = hostOf()
    const decl = declareTargets({ words: { toString() { throw new Error('x') } }, host })
    expect(decl.error).toBe(true)
    expect(decl.open).toEqual(['chart', 'board', 'multiChart', 'layouts', 'content'])
  })
  it('a stored card is the authority on approval — "do it" re-resolves nothing', () => {
    const { host } = hostOf()
    const card = declareTargets({ words: 'change SPY to AAPL', host })
    const again = declareTargets({ words: 'do it', host, card })
    expect(again.source).toBe('card')
    expect(validateDeclaration(plan(host, [setSym('c1', 'AAPL')]), again, { host, words: 'do it' }).verdict).toBe('match')
    expect(validateDeclaration(plan(host, [setSym('c2', 'AAPL')]), again, { host, words: 'do it' }).verdict).toBe('mismatch')
  })
})

describe('the validator — effects ⊆ declaration, fail closed', () => {
  it('an effect beyond the declared ceiling is a mismatch ("exceeds")', () => {
    const { host } = hostOf(SPY_NVDA(), { sel: 'c1' })
    const { r } = run('show AAPL', host, [{ action: 'widget.remove', target: 'board', args: { widget: 'c1' } }])
    expect(r.mismatches[0]).toMatchObject({ ref: 'c1', why: 'exceeds', effect: 'remove' })
  })
  it('an effect that cannot be read is a mismatch', () => {
    const { host } = hostOf()
    const bad = { ok: true, plans: [{ kind: 'chart', ref: 'c1', before: { symbol: 'SPY' }, after: { get symbol() { throw new Error('x') } } }] }
    const r = validateDeclaration(bad, declareTargets({ words: 'change SPY to AAPL', host }), { host })
    expect(r.verdict).toBe('mismatch')
    expect(r.mismatches[0].why).toBe('unreadable')
  })
  it('a content write (a chart setting) to an existing chart is read as kind "content"', () => {
    const { host } = hostOf(SPY_NVDA(), { sel: 'c2' })
    const { p, r } = run('make this weekly', host, [{ action: 'chart.setTimeframe', target: 'c2', args: { timeframe: 'W' } }])
    expect(planEffects(p, host).effects.map(e => `${e.kind}:${e.ref}`)).toEqual(['content:c2'])
    expect(r.kinds.content.match).toBe(1)
  })
  it('a linked follower takes its leader\'s verdict', () => {
    const { host } = hostOf([[{ ...chart('c1', 0), color: 'A' }, { ...chart('c2', 12), color: 'A' }], { A: 'SPY' }], { sel: 'c1' })
    const { p, r } = run('show AAPL here', host, [setSym('c1', 'AAPL')])
    const fx = planEffects(p, host).effects
    expect(fx.some(e => e.linked)).toBe(true)
    expect(r.verdict).toBe('match')
  })
  it('refusesUnder: only enforced kinds refuse; shadow (empty set) never does', () => {
    const { host } = hostOf()
    const { r } = run('show AAPL', host, [setSym('c1', 'AAPL')])
    expect(refusesUnder(r, new Set())).toBe(false)
    expect(refusesUnder(r, new Set(['layouts']))).toBe(false)
    expect(refusesUnder(r, new Set(['chart']))).toBe(true)
  })
})

describe('OPEN is reported, never a bypass (AUDIT condition 1)', () => {
  it('words that point at a chart the resolver cannot place → every chart kind open; an effect there is OPEN', () => {
    const { host } = hostOf()
    const { decl, r } = run('make that chart AAPL', host, [setSym('c1', 'AAPL')])
    expect(decl.open).toContain('chart')
    expect(r.verdict).toBe('open')
    expect(r.kinds.chart.open).toBe(1)
  })
  it('MUTANT open-as-match: an OPEN effect in an ENFORCED kind refuses', () => {
    const { host } = hostOf()
    const { r } = run('make that chart AAPL', host, [setSym('c1', 'AAPL')])
    expect(r.kinds.chart.match).toBe(0)
    expect(refusesUnder(r, CHART_ENFORCED)).toBe(true)
  })
  it('MUTANT model-fills-open: a model target never authorises an open kind (narrowByModel only removes)', () => {
    const { host } = hostOf()
    const decl = declareTargets({ words: 'make that chart AAPL', host })
    const narrowed = narrowByModel(decl, [{ ref: 'c1', effect: 'overwrite' }])
    expect(narrowed.entries).toEqual([])
    expect(narrowed.open).toEqual(decl.open)
    const r = validateDeclaration(plan(host, [setSym('c1', 'AAPL')]), narrowed, { host })
    expect(r.verdict).toBe('open')
    expect(refusesUnder(r, CHART_ENFORCED)).toBe(true)
  })
  it('narrowByModel narrows an authorised set: drops refs the model did not target, never widens an effect', () => {
    const { host } = hostOf()
    const decl = declareTargets({ words: 'make both charts AAPL', host })
    const n = narrowByModel(decl, [{ ref: 'c1', effect: 'overwrite' }, { ref: 'c9', effect: 'remove' }])
    expect(n.entries.map(e => `${e.ref}:${e.effect}`)).toEqual(['c1:overwrite'])
    expect(narrowByModel(decl, [{ ref: 'c1', effect: 'remove' }]).entries).toEqual([])
  })
})

describe('FINAL BOARD (AUDIT conditions 4, 5)', () => {
  const OWNER_1114 = 'Add AAPL and MSFT to my charts, but keep SPY and NVDA . All four in a grid'
  it('OWNER 11-14: the six-panel plan (SPY, NVDA re-created beside the kept ones) is a mismatch: duplicate-kept', () => {
    const { host } = hostOf()
    const { p, r } = run(OWNER_1114, host, [grid(['SPY', 'NVDA', 'AAPL', 'MSFT'], { new_charts: true })])
    expect(planEffects(p, host).created.sort()).toEqual(['AAPL', 'MSFT', 'NVDA', 'SPY'])
    expect(r.final).toBe('fail')
    expect(r.mismatches.map(m => m.why)).toContain('duplicate-kept')
  })
  it('OWNER 11-14: the four-panel plan (the kept panels + AAPL + MSFT) passes', () => {
    const { host } = hostOf()
    const { r } = run(OWNER_1114, host, [grid(['AAPL', 'MSFT'], { new_charts: true })])
    expect(r.final).toBe('ok')
    expect(r.verdict).toBe('match')
  })
  it('OWNER 11-13: "keeping SPY and NVDA" → "Add AAPL and MSFT as the other two charts", planned as a grid re-symbolling both → kept', () => {
    const { host } = hostOf()
    const words = 'Change my chart layout to a 2-by-2 grid, keeping SPY and NVDA in the layout. . Add AAPL and MSFT as the other two charts'
    const { r } = run(words, host, [grid(['AAPL', 'MSFT'])])
    expect(r.verdict).toBe('mismatch')
    expect(r.mismatches.filter(m => m.why === 'kept').map(m => m.ref).sort()).toEqual(['c1', 'c2'])
  })
  it('(ii) every named off-board ticker must be on the final board', () => {
    const { host } = hostOf()
    const { r } = run('add AAPL and MSFT', host, [grid(['AAPL'], { new_charts: true })])
    expect(r.mismatches.map(m => m.why)).toContain('missing-named')
  })
  it('(iii) at least the count asked', () => {
    const { host } = hostOf()
    const { r } = run('make it a 2x2 with AAPL', host, [grid(['AAPL'], { new_charts: true })])
    expect(r.mismatches.map(m => m.why)).toContain('count')
  })
  it('a copy asked for outright ("another SPY chart") is not a duplicate', () => {
    const { host } = hostOf()
    const { r } = run('keep my charts and add another SPY chart', host, [grid(['SPY'], { new_charts: true })])
    expect(r.mismatches.map(m => m.why)).not.toContain('duplicate-kept')
  })
  it('a plan that only writes a chart CONTENT (a compare overlay) has no final-board check, whatever symbols the words name', () => {
    const { host } = hostOf(SPY_NVDA(), { sel: 'c1' })
    const { r } = run('compare this with AMD', host, [{ action: 'chart.compare', target: 'c1', args: { add: ['AMD'], remove: [], clear: false } }])
    expect(r.final).toBe('skip')
    expect(r.verdict).toBe('match')
  })
  it('MUTANT vague-words-invent-board: no keep / count / shape / symbol → no final check at all', () => {
    const { host } = hostOf()
    expect(finalSpec('tidy up my charts', host)).toBeNull()
    const p = plan(host, [grid(['SPY', 'NVDA'], { new_charts: true })])
    const r = validateDeclaration(p, declareTargets({ words: 'tidy up my charts', host }), { host, words: 'tidy up my charts' })
    expect(r.final).toBe('skip')
    expect(r.kinds.final).toEqual({ match: 0, mismatch: 0, open: 0 })
  })
  it('MUTANT recreated-kept-accepted: a kept panel closed and its ticker re-created is remove + create — a mismatch', () => {
    const { host } = hostOf()
    const words = 'keep SPY and NVDA and add AAPL'
    const decl = declareTargets({ words, host })
    const recreated = { ok: true, plans: [{ kind: 'board', ref: 'board', snap: { charts: new Map([['c1', { ref: 'c1', symbol: 'SPY' }]]) },
      before: { board: [{ id: 'c1', type: 'chart' }, { id: 'c2', type: 'chart' }] },
      after: { board: [{ id: 'c2', type: 'chart' }, { id: 'n1', type: 'chart' }, { id: 'n2', type: 'chart' }], grid: { add: [{ symbol: 'SPY' }, { symbol: 'AAPL' }], reuse: [] } } }] }
    const r = validateDeclaration(recreated, decl, { host, words })
    expect(r.verdict).toBe('mismatch')
    expect(r.mismatches.map(m => m.why)).toEqual(expect.arrayContaining(['kept', 'duplicate-kept', 'kept-gone']))
  })
  it('… unless the words ask to MOVE / reorder (the same plan, "rearrange them")', () => {
    const { host } = hostOf()
    const words = 'keep SPY and NVDA but rearrange them'
    const decl = declareTargets({ words, host })
    const moved = { ok: true, plans: [{ kind: 'board', ref: 'board', snap: { charts: new Map([['c1', { ref: 'c1', symbol: 'SPY' }]]) },
      before: { board: [{ id: 'c1', type: 'chart' }, { id: 'c2', type: 'chart' }] },
      after: { board: [{ id: 'c2', type: 'chart' }, { id: 'n1', type: 'chart' }], grid: { add: [{ symbol: 'SPY' }], reuse: [] } } }] }
    const r = validateDeclaration(moved, decl, { host, words })
    expect(r.mismatches.filter(m => m.why === 'kept')).toEqual([])
  })
})

describe('fan-out union and deferred alias rewrite (AUDIT condition 6, design §4.5)', () => {
  it('MUTANT fan-out-union: a fan that writes a chart the declaration does not hold is fan-extra', () => {
    const { host } = hostOf(SPY_NVDA(), { sel: 'c1' })
    const decl = declareTargets({ words: 'show AAPL', host })
    const f = validateFanOut([plan(host, [setSym('c1', 'AAPL')]), plan(host, [setSym('c2', 'AAPL')])], decl, { host })
    expect(f.mismatches.map(m => m.why)).toContain('fan-extra')
    expect(f.kinds.fanout.mismatch).toBe(1)
  })
  it('MUTANT fan-out-union: a fan that leaves out a declared chart is fan-missing (each plan alone matches)', () => {
    const { host } = hostOf()
    const decl = declareTargets({ words: 'make both charts AAPL', host })
    const f = validateFanOut([plan(host, [setSym('c1', 'AAPL')])], decl, { host })
    expect(f.results.every(x => x.verdict === 'match')).toBe(true)
    expect(f.mismatches.map(m => m.why)).toEqual(['fan-missing'])
  })
  it('a fan over exactly the declared charts matches', () => {
    const { host } = hostOf()
    const decl = declareTargets({ words: 'make both charts AAPL', host })
    const f = validateFanOut([plan(host, [setSym('c1', 'AAPL')]), plan(host, [setSym('c2', 'AAPL')])], decl, { host })
    expect(f.verdict).toBe('match')
    expect(f.kinds.fanout.match).toBe(1)
  })
  it('MUTANT deferred-alias: an alias entry lands on the chart the request created — and only there', () => {
    const { host } = hostOf([[chart('c1', 0, 8), chart('c2', 8, 8), chart('c3', 16, 8)], { 'N:c1': 'SPY', 'N:c2': 'NVDA', 'N:c3': 'AAPL' }])
    const decl = withAliases(declareTargets({ words: 'add a weekly chart', host }), ['new1'])
    const step = plan(host, [{ action: 'chart.setTimeframe', target: 'c3', args: { timeframe: 'W' } }])
    // before the rewrite the step's real target is unknown to the declaration
    expect(validateDeclaration(step, decl, { host }).verdict).toBe('mismatch')
    const landed = rewriteAliases(decl, { new1: 'c3' })
    expect(landed.entries.find(e => e.alias === 'new1').ref).toBe('c3')
    expect(validateDeclaration(step, landed, { host }).verdict).toBe('match')
    // never another chart, and never a removal of the created one
    expect(validateDeclaration(plan(host, [{ action: 'chart.setTimeframe', target: 'c2', args: { timeframe: 'W' } }]), landed, { host }).verdict).toBe('mismatch')
    expect(validateDeclaration(plan(host, [{ action: 'widget.remove', target: 'board', args: { widget: 'c3' } }]), landed, { host }).verdict).toBe('mismatch')
    // an entry that is not an alias keeps its own ref (the rewrite touches aliases only)
    const both = rewriteAliases(withAliases(declareTargets({ words: 'show TSLA', host: hostOf([[chart('c1', 0, 8), chart('c2', 8, 8), chart('c3', 16, 8)], { 'N:c1': 'SPY', 'N:c2': 'NVDA', 'N:c3': 'AAPL' }], { sel: 'c1' }).host }), ['new1']), { new1: 'c3' })
    expect(both.entries.map(e => `${e.ref}:${e.via}`)).toEqual(['c1:click', 'c3:alias'])
    // an alias the request did not create is left as it was
    expect(rewriteAliases(decl, { other: 'c2' }).entries.find(e => e.alias === 'new1').ref).toBe('new1')
  })
})

describe('shadow telemetry (AUDIT condition 9): counts, letters, kind and evidence-type names only', () => {
  it('the field list is exactly the documented one', () => {
    const { host } = hostOf(SPY_NVDA(), { sel: 'c1' })
    const { decl, r } = run('show AAPL', host, [setSym('c1', 'AAPL')])
    const t = shadowTelemetry(r, decl, { path: 'fast' })
    expect(Object.keys(t)).toEqual(TELEMETRY_FIELDS)
    expect(t).toEqual({ td: 'match', tdPath: 'fast', tdKinds: { chart: 'm', final: 'm' }, tdCounts: { match: 2, mismatch: 0, open: 0 }, tdFinal: 'ok', tdVia: ['click'], tdOpen: [] })
  })
  it('no member words, symbols or ids leave — whatever the plan and the words held', () => {
    const { host } = hostOf()
    const words = 'Add AAPL and MSFT to my charts, but keep SPY and NVDA . All four in a grid'
    const { decl, r } = run(words, host, [grid(['SPY', 'NVDA', 'AAPL', 'MSFT'], { new_charts: true })])
    const s = JSON.stringify(shadowTelemetry(r, decl, { path: 'model' }))
    for (const leak of ['SPY', 'NVDA', 'AAPL', 'MSFT', 'c1', 'c2', 'keep', 'Add', 'grid']) expect(s).not.toContain(leak)
    expect(JSON.stringify(shadowTelemetry(r, decl, { path: 'some free text' }))).not.toContain('free text')
  })
  it('every kind the validator reports is a known one', () => {
    expect(TD_KINDS).toEqual(['chart', 'board', 'multiChart', 'layouts', 'content', 'final', 'fanout'])
  })
})
