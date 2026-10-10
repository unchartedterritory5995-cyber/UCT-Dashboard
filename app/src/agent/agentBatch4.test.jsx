// BATCH 4 — the four Agent defect fixes, chart.setSetting (the product descriptor table), and
// truthful capability questions. Each defect test names its root cause.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

let EXT = 'regular'
vi.mock('../utils/extSession', async (orig) => ({ ...(await orig()), getExtSessionCached: () => ({ session: EXT }) }))

import { registerBuiltins } from './builtins'
import { getCapability, allCapabilityNames, shapeError, registerCapability } from './capabilities'
import { planOps, collectTargets, prepareOps, undoNotesFor } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { fastParse } from './fastPath'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { CHART_THEMES, applyThemeToSettings, themeWithAppSurface, chartThemeToAppTheme } from '../components/chart/chartThemes'
import { storable } from './capabilities/savedScreens'
import { loadSaved, _resetScreenerCache } from './capabilities/screener'
import { makeBoard } from './__fixtures__/board'
import { TOPICS, topicStatus, answerFor, fastDiscovery } from './discovery'

registerBuiltins()
const CTX = { surface: 'charts' }
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const ROOT = path.resolve(HERE, '..', '..', '..')

function makeHost(defs) {
  const st = new Map(defs.map(d => [d.ref, { stored: d.stored ?? null, tf: d.tf || 'D', symbol: d.symbol || 'SPY', label: d.ref }]))
  const read = (ref) => {
    const s = st.get(ref)
    return s ? { ref, label: s.label, symbol: s.symbol, tf: s.tf, stored: s.stored, cs: mergeChartSettings(s.stored || { chartType: 'candles' }), linkedCount: 0 } : null
  }
  return {
    charts: {
      list: () => [...st.keys()].map(read), read,
      commit(ref, patch) { const s = st.get(ref); if ('settings' in patch) s.stored = patch.settings; if ('tf' in patch) s.tf = patch.tf; return true },
    },
    otherWidgets: () => [],
    raw: (ref) => st.get(ref),
  }
}
const op = (action, args, target = 'c1') => ({ action, target, args })
const plan = (host, ops) => planOps(collectTargets(host, ['chart']), ops, {}, CTX)

describe('DEFECT 1 — saved screens keep the WHOLE canonical spec (root cause: storable kept only filters + sort)', () => {
  it('storable keeps filters, sort, view, columns, rank and logic — and drops only paging', () => {
    const spec = { filters: [{ key: 'adr_pct', op: 'gt', min: 5 }], sort: { key: 'adr_pct', dir: 'desc' }, view: 'technical', columns: ['ticker', 'adr_pct'],
      rank: { by: [{ key: 'rs_rating', w: 1 }] }, logic: { op: 'and', args: [] }, page: 3, page_size: 50 }
    const out = storable(spec)
    expect(out).toEqual({ filters: spec.filters, sort: spec.sort, view: 'technical', columns: spec.columns, rank: spec.rank, logic: spec.logic })
  })
  it('copying a ranked, logic-based screen POSTs rank and logic unchanged', async () => {
    _resetScreenerCache()
    const SRC = { filters: [{ key: 'adr_pct', op: 'gt', min: 5 }], sort: { key: 'adr_pct', dir: 'desc' }, rank: { by: [{ key: 'rs_rating', w: 1 }] }, logic: { op: 'and', args: [{ op: 'gt', l: 'close', r: 'sma50' }] }, view: 'technical' }
    const posts = []
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const u = String(url); const m = (init.method || 'GET').toUpperCase()
      const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
      if (u === '/api/screener/saved-screens' && m === 'GET') return json({ saved: [{ id: 7, name: 'Ranked', spec: SRC }, ...posts.map((p, i) => ({ id: 100 + i, ...p }))], starters: [] })
      if (u === '/api/screener/saved-screens' && m === 'POST') { const b = JSON.parse(init.body); posts.push(b); return json({ id: 99 + posts.length, ...b }) }
      return json({})
    })
    const { host } = makeBoard([])
    await loadSaved({ force: true })
    const ops = [{ action: 'screener.duplicateSaved', target: 'screens', args: { screen: '7', name: null } }]
    const env = await prepareOps(ops)
    const p = planOps(collectTargets(host, ['savedScreens']), ops, env, CTX)
    expect(p.ok).toBe(true)
    expect((await commitPlan(host, p, { env })).ok).toBe(true)
    expect(posts[0].spec).toEqual(SRC)
    vi.restoreAllMocks()
  })
})

describe('DEFECT 2 — chart.applyTheme = the UI\'s one-chart apply (root cause: the Agent skipped themeWithAppSurface)', () => {
  const mirrored = CHART_THEMES.find(t => chartThemeToAppTheme(t.id) && themeWithAppSurface(t).bg !== t.bg)
  it('an app-mirrored theme paints the app surface, exactly like Chart Settings → 🎨 → this chart', () => {
    expect(mirrored, 'need an app-mirrored chart theme').toBeTruthy()
    const host = makeHost([{ ref: 'c1' }])
    const before = host.charts.read('c1').cs
    const p = plan(host, [op('chart.applyTheme', { theme: mirrored.id })])
    expect(p.plans[0].after.cs).toEqual(applyThemeToSettings(before, themeWithAppSurface(mirrored)))
    expect(p.plans[0].after.cs).not.toEqual(applyThemeToSettings(before, mirrored))
  })
  it('the dialog and the Agent call ONE function (source rail)', () => {
    const modal = fs.readFileSync(path.join(ROOT, 'app/src/components/chart/ChartSettingsModal.jsx'), 'utf8')
    const chart = fs.readFileSync(path.join(ROOT, 'app/src/agent/capabilities/chart.js'), 'utf8')
    expect(modal).toContain('applyThemeToOneChart(settings, theme)')
    expect(chart).toContain('applyThemeToOneChart(st.cs, CHART_THEME_BY_ID[theme])')
  })
})

describe('DEFECT 3 — chart.setSession honours the UI\'s eligibility (root cause: no extEnabled / econ check)', () => {
  afterEach(() => { EXT = 'regular' })
  it('D/W/M extended is refused outside pre/post — where the toggle is disabled — and allowed inside it', () => {
    EXT = 'regular'
    const p = plan(makeHost([{ ref: 'c1', tf: 'D' }]), [op('chart.setSession', { mode: 'extended' })])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/only available during pre-market and post-market/)
    EXT = 'post'
    const q = plan(makeHost([{ ref: 'c1', tf: 'D' }]), [op('chart.setSession', { mode: 'extended' })])
    expect(q.ok).toBe(true)
    expect(q.plans[0].after.cs.sessionView).toBe('extended')
  })
  it('regular is always allowed; intraday extended is always allowed (its toggle is never disabled)', () => {
    EXT = 'regular'
    expect(plan(makeHost([{ ref: 'c1', tf: '5', stored: { extendedHoursShading: false } }]), [op('chart.setSession', { mode: 'extended' })]).ok).toBe(true)
    expect(plan(makeHost([{ ref: 'c1', tf: 'D', stored: { sessionView: 'extended' } }]), [op('chart.setSession', { mode: 'regular' })]).ok).toBe(true)
  })
  it('economic-data charts have no session control → refused', () => {
    const econ = 'ECON:CPIAUCSL'
    const p = plan(makeHost([{ ref: 'c1', tf: 'M', symbol: econ, stored: { sessionView: 'extended' } }]), [op('chart.setSession', { mode: 'regular' })])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/Economic-data charts/)
  })
})

describe('DEFECT 4 — Undo metadata is truthful (root cause: reversible:true with no Undo, and the server dropped it)', () => {
  it('app.open and the digest switch declare undo:none; the digest receipt says how to reverse it', () => {
    expect(getCapability('app.open').undo).toBe('none')
    const digest = getCapability('settings.setWatchlistDigest')
    expect(digest.undo).toBe('none')
    const fakePlan = { plans: [{ items: [{ op: { action: 'settings.setWatchlistDigest' } }] }] }
    expect(undoNotesFor(fakePlan, { ok: true, undo: null })).toEqual([digest.undoNote])
    expect(undoNotesFor(fakePlan, { ok: true, undo: { id: 'u1' } })).toEqual([])
  })
  it('a registration with an unknown undo value is refused', () => {
    expect(() => registerCapability({
      name: 'x.bad', summary: 'x', target: 'chart', undo: 'maybe',
      args: { type: 'object', properties: {}, required: [], additionalProperties: false }, check() {}, apply() {}, describe() {},
    })).toThrow()
  })
})

describe('chart.setSetting — one capability over the product descriptor table', () => {
  it('grid off: the dialog\'s exact write, a receipt, read back, and Undo restores', async () => {
    const host = makeHost([{ ref: 'c1' }])
    const p = plan(host, [op('chart.setSetting', { setting: 'grid.visible', value: false })])
    expect(p.ok).toBe(true)
    expect(p.lines).toEqual(['Grid lines: off'])
    expect(decideMode('apply', p)).toBe('apply')
    const before = host.charts.read('c1').cs
    expect(p.plans[0].after.cs).toEqual({ ...before, grid: { ...before.grid, visible: false }, preset: 'custom' })
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    expect(mergeChartSettings(host.raw('c1').stored).grid.visible).toBe(false)
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(host.raw('c1').stored).toBeNull()
  })
  it('a 3-way mode takes on/off; enums are validated; a no-op says so', () => {
    const host = makeHost([{ ref: 'c1' }])
    expect(plan(host, [op('chart.setSetting', { setting: 'crosshair.mode', value: false })]).plans[0].after.cs.crosshair.mode).toBe('off')
    expect(plan(host, [op('chart.setSetting', { setting: 'textSize', value: 13 })]).refusals[0].reason).toMatch(/Scale text size can be 8, 10/)
    expect(plan(host, [op('chart.setSetting', { setting: 'grid.visible', value: true })]).noops).toEqual(['Grid lines is already on'])
  })
  it('the UI prerequisite holds: thin bars refused on candles, allowed on bars', () => {
    expect(plan(makeHost([{ ref: 'c1' }]), [op('chart.setSetting', { setting: 'candles.thinBars', value: false })]).refusals[0].reason).toMatch(/Bars and HLC/)
    const p = plan(makeHost([{ ref: 'c1', stored: { chartType: 'bars' } }]), [op('chart.setSetting', { setting: 'candles.thinBars', value: false })])
    expect(p.ok).toBe(true)
  })
  it('KNOWING ≠ DOING: a known-but-not-eligible setting is not even an option', () => {
    expect(shapeError('chart.setSetting', { setting: 'watermark.opacity', value: 0.5 }, CTX)).toMatch(/isn't an option/)
    expect(shapeError('chart.setSetting', { setting: 'indicatorInstances', value: 'x' }, CTX)).toMatch(/isn't an option/)
  })
  it('fast path: "turn off the grid", "crosshair off", "hide the watermark", "show swing labels" — and "hide volume" stays Volume', () => {
    expect(fastParse('turn off the grid').ops[0]).toEqual({ action: 'chart.setSetting', args: { setting: 'grid.visible', value: false } })
    expect(fastParse('crosshair off').ops[0]).toEqual({ action: 'chart.setSetting', args: { setting: 'crosshair.mode', value: 'off' } })
    expect(fastParse('hide the watermark').ops[0]).toEqual({ action: 'chart.setSetting', args: { setting: 'watermark.visible', value: false } })
    expect(fastParse('show swing labels').ops[0]).toEqual({ action: 'chart.setSetting', args: { setting: 'swingLabels.enabled', value: true } })
    expect(fastParse('hide volume').ops[0].action).toBe('volume.setState')
  })
})

describe('capability questions — deterministic, truthful, never future-as-present', () => {
  const ask = (q) => fastParse(q)?.ops?.[0] || null
  const answer = (q) => answerFor(ask(q).args.topic)
  it('Overnight Batch 8: drawings are PARTLY available — levels yes, trendlines not yet (said, planned 8b), never claimed', () => {
    // "Can you draw…" may now be a request the Agent can do (a level), so it is no longer swallowed here.
    expect(fastDiscovery('Can you draw trendlines for me?')).toBe(null)
    const a = answerFor('drawings')
    expect(a.status).toBe('partial')
    expect(a.text).toMatch(/^Partly\. .*horizontal line at a price/)
    expect(a.text).toMatch(/trendlines, rectangles, Fibonacci and text need anchors in time/)
    expect(a.text).toMatch(/Planned for UCT Agent \(Batch 8b, not available yet\)/)
  })
  it('Batch 5: "Can you resize my chart widgets?" is now something the Agent DOES — a polite command, not a question', () => {
    expect(fastDiscovery('Can you resize my chart widgets?')).toBe(null)
    expect(answerFor('arrange').status).toBe('partial')
    expect(answerFor('arrange').text).toMatch(/^Partly\. .*move one.*resize one/)
  })
  it('"Can you create a custom indicator?" → partial (M1: I open Create Indicator with your request; I never build or save it)', () => {
    // like drawings / resize: "Can you…" is now a polite request the Agent can act on, so the model gets it
    expect(fastDiscovery('Can you create a custom indicator?')).toBe(null)
    const a = answerFor('customIndicator')
    expect(a.status).toBe('partial')
    expect(a.text).toMatch(/Create Indicator/)
    // M3: the Agent builds through Create Indicator's own builder and always proposes the Save
    expect(a.text).toMatch(/build a custom indicator with you through Create Indicator’s own builder/)
    expect(a.text).toMatch(/save it \(always shown to you first\)/)
  })
  it('"What can you do with saved screeners?" → partial, listing only REGISTERED abilities', () => {
    expect(ask('What can you do with saved screeners?').args.topic).toBe('savedScreens')
    const a = answer('What can you do with saved screeners?')
    expect(['available', 'partial']).toContain(a.status)
    expect(a.text).toMatch(/save the last screen I ran/)
  })
  it('"Can you backtest this strategy?" and "recreate a chart from a screenshot?" → planned stages, never "yes"', () => {
    const b = answer('Can you backtest this strategy?')
    expect(b.status).toBe('planned')
    expect(b.text).toMatch(/isn't something UCT Agent can do today/)
    expect(b.text).toMatch(/Stage 4, not available yet/)
    const v = answer('Can you recreate a chart from a screenshot?')
    expect(v.status).toBe('planned')
    expect(v.text).not.toMatch(/^Yes/)
  })
  it('a polite COMMAND for something I can do is NOT swallowed as a question', () => {
    expect(fastDiscovery('can you switch the left chart to weekly?')).toBe(null)
    expect(fastDiscovery('can you turn off the grid?')).toBe(null)
  })
  it('rails: every topic capability is registered; every registered capability is described by a topic', () => {
    const reg = new Set(allCapabilityNames())
    const covered = new Set(TOPICS.flatMap(t => t.caps))
    for (const c of covered) expect(reg.has(c), c).toBe(true)
    for (const c of reg) if (c !== 'agent.capabilities') expect(covered.has(c), `${c} is in no discovery topic`).toBe(true)
  })
  it('rails: a topic is never "available" without a registered capability; every planned label is in the roadmap', () => {
    const roadmap = fs.readFileSync(path.join(ROOT, 'docs/agent/ROADMAP.md'), 'utf8')
    for (const t of TOPICS) {
      if (!t.caps.length) expect(['known', 'planned', 'unsupported'], t.id).toContain(topicStatus(t))
      if (t.planned) expect(roadmap, `${t.id}: "${t.planned.when}"`).toContain(t.planned.when)
    }
  })
})
