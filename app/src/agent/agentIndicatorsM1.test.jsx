// INDICATORS M1 — acceptance (docs/agent/M1-INDICATORS-PLAN.md §3; the contract is
// docs/indicators/AGENT-INTEGRATION-HANDOFF.md §11). The 19 cases written before the work, now
// executable, plus targeting / access-race / seed cases. SCRIPTED: no real model here — the
// panel tests drive the real AgentPanel + useAgent + planner + runtime with scripted envelopes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { buildContext, manifestFor, getCapability, MANIFEST_CONTRACT } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan } from './runtime'
import { routeManifest, selectGroups, groupOfAction } from './routing'
import { protectionRefusal } from './protectedLayouts'
import { OPENER_REFUSALS, openedLine } from './capabilities/indicators'
import { makeBoard } from './__fixtures__/board'
import * as registry from '../components/chart/engine/nativeRegistry'
import { instancesOf, seedFrom, SEED_MAX, instanceFingerprint } from '../components/chart/builder/agentSeams'
import { createIndicatorAccess, CREATE_INDICATOR_COHORT, CREATE_INDICATOR_FLAG_KEY } from '../components/chart/builder/studio/createIndicatorFlag'
import { STUDIO_PREVIEW_DEF_ID } from '../components/chart/builder/studio/chartPreview'
import { AuthContext } from '../context/AuthContext'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

// A real saved definition, installed as the chart would (the Indicators seam test's fixture).
const FIX = JSON.parse(fs.readFileSync(path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/authoring/batch2_definitions.json'), 'utf8'))
const CUSTOM = 'u_aaaaaaaaaac1'
registry.installUserDefinitions([{ ...FIX.styled_markers, id: CUSTOM, version: 2 }])

const RSI = { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: {} }
const MACD_HIDDEN = { instanceId: 'inst:macd:1', defId: 'macd', inputs: {}, hidden: true }
const MINE = { instanceId: `inst:${CUSTOM}:1`, defId: CUSTOM, defVersion: 2, inputs: {} }
const PREVIEW = { instanceId: `inst:${STUDIO_PREVIEW_DEF_ID}:1`, defId: STUDIO_PREVIEW_DEF_ID, inputs: {} }

// Charts with EXACTLY these indicators (no adopted averages, no Volume pane) unless asked.
const csWith = (instances, { volume = false } = {}) => ({ indicatorInstances: instances, ...(volume ? { volume: { visible: true, separatePane: true } } : {}) })

/** A small host: charts by ref, each with a fake Create Indicator door. */
function host(charts, { canCreate = true, opener = null } = {}) {
  const calls = []
  const writes = []
  const access = { on: canCreate }
  const snap = (c) => ({ ref: c.ref, label: c.label, position: c.position || null, symbol: c.symbol, tf: 'D', cs: c.cs, stored: c.cs })
  return {
    calls, writes, access,
    charts: {
      list: () => charts.map(snap),
      read: (ref) => { const c = charts.find(x => x.ref === ref); return c ? snap(c) : null },
      commit: (ref, patch) => { writes.push([ref, patch]); return true },
      canCreateIndicator: () => access.on,
      openCreateIndicator: (ref, opts) => {
        calls.push([ref, opts])
        if (opener) return opener(ref, opts)
        if (!access.on) return { ok: false, reason: 'access', prefilled: false, draft: false, editing: false }
        return { ok: true, prefilled: !!opts?.seed, draft: false, editing: !!opts?.defId }
      },
    },
  }
}
const LEFT = (cs) => ({ ref: 'L', label: 'Left chart (NVDA)', position: 'left', symbol: 'NVDA', cs })
const RIGHT = (cs) => ({ ref: 'R', label: 'Right chart (AAPL)', position: 'right', symbol: 'AAPL', cs })
const CTX = { surface: 'charts', createIndicator: true }
const iref = (chartRef) => `ind:${chartRef}`

const list = (h, chartRef, filter = null) => getCapability('indicator.list').answer(collectTargets(h, ['indicators']).get(iref(chartRef))?.snap || null, { filter }, h)
async function run(h, ops, ctx = CTX) {
  buildContext(h, ctx)
  const env = await prepareOps(ops)
  const p = planOps(collectTargets(h, ['indicators', 'chart']), ops, env, ctx)
  return { p, env, commit: () => commitPlan(h, p, { env, ctx }) }
}
const open = (chartRef, request = null, defId = null) => ({ action: 'indicator.openCreate', target: iref(chartRef), args: { request, defId } })

// ── 1. indicator.list ────────────────────────────────────────────────────────────────────
describe('M1 indicator.list (query) — built only from instancesOf', () => {
  it('0 indicators → "No indicators on <chart>." (no model text)', () => {
    expect(list(host([LEFT(csWith([]))]), 'L')).toBe('No indicators on Left chart (NVDA).')
  })
  it('1 indicator → one row: name, built-in/custom, shown/hidden, price/pane', () => {
    const a = list(host([LEFT(csWith([RSI]))]), 'L')
    expect(a.text).toBe('1 indicator on Left chart (NVDA).')
    expect(a.table.columns.map(c => c.label)).toEqual(['Indicator', 'Type', 'Shown', 'Where'])
    expect(a.table.rows).toEqual([{ name: instancesOf(csWith([RSI]), registry)[0].name, kind: 'built-in', state: 'shown', place: 'own pane' }])
    expect(a.table.rows[0].name).toMatch(/RSI/)
  })
  it('12 indicators → 12 rows in stored order, exactly instancesOf(cs, registry)', () => {
    const ids = ['rsi', 'macd', 'atr', 'rsi', 'macd', 'atr', 'rsi', 'macd', 'atr', 'rsi', 'macd', 'atr']
    const many = ids.map((d, i) => ({ instanceId: `inst:${d}:${i + 1}`, defId: d, inputs: {}, ...(i % 4 === 0 ? { hidden: true } : {}) }))
    const cs = csWith(many)
    const seam = instancesOf(cs, registry)
    expect(seam).toHaveLength(12)
    const a = list(host([LEFT(cs)]), 'L')
    expect(a.table.rows.map(r => r.name)).toEqual(seam.map(s => s.name))
    expect(a.table.rows.map(r => r.state)).toEqual(seam.map(s => (s.hidden ? 'hidden' : 'shown')))
    expect(a.table.rows.map(r => r.place)).toEqual(seam.map(s => (s.placement === 'price' ? 'price chart' : 'own pane')))
  })
  it('the live Create Indicator preview (u_studio-preview) is never listed', () => {
    const h = host([LEFT(csWith([RSI, PREVIEW]))])
    expect(list(h, 'L').table.rows).toHaveLength(1)
    expect(JSON.stringify(buildContext(h, CTX).context.indicators)).not.toMatch(/studio-preview/)
  })
  it('instances are addressed through short refs and defIds, never by name (a name passed as defId is refused)', async () => {
    const h = host([LEFT(csWith([RSI, MINE]))])
    const { context, refMap } = buildContext(h, CTX)
    const e = context.indicators[0]
    expect(refMap[e.ref]).toEqual({ kind: 'indicators', ref: 'ind:L' })
    expect(e.indicators.find(i => i.custom)).toMatchObject({ defId: CUSTOM })
    expect(e.indicators.find(i => /RSI/.test(i.name)).defId).toBeUndefined()       // built-ins: name only
    const byName = e.indicators.find(i => i.custom).name
    const { p } = await run(h, [open('L', null, byName)])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/only open Modify on one of your own custom indicators/)
    expect(h.calls).toEqual([])
  })
  it('hidden / disabled state and placement survive as the seam reports them; filter hidden / shown', () => {
    const h = host([LEFT(csWith([RSI, MACD_HIDDEN, MINE], { volume: true }))])
    expect(list(h, 'L').table.rows.map(r => [r.kind, r.state])).toEqual([['built-in', 'shown'], ['built-in', 'hidden'], ['custom (v2)', 'shown'], ['chart setting', 'shown']])
    const hidden = list(h, 'L', 'hidden')
    expect(hidden.text).toBe('1 indicator hidden on Left chart (NVDA).')
    expect(hidden.table.rows.map(r => r.name)).toEqual([instancesOf(csWith([MACD_HIDDEN]), registry)[0].name])
    expect(list(h, 'L', 'shown').table.rows).toHaveLength(3)
    expect(list(host([LEFT(csWith([RSI]))]), 'L', 'hidden')).toMatch(/^Nothing is hidden on Left chart \(NVDA\) — everything on it is shown\./)
  })
})

// ── 2. indicator.openCreate ──────────────────────────────────────────────────────────────
describe('M1 indicator.openCreate — the Indicators opener, never /converse', () => {
  it('absent from the manifest for a non-admin, an admin without uct.feature.createIndicator, and a member outside the cohort', () => {
    const has = (auth, flag) => manifestFor({ surface: 'charts', createIndicator: createIndicatorAccess(auth, flag) }).some(c => c.name === 'indicator.openCreate')
    expect(has({ user: { role: 'member' }, cohorts: [] }, true)).toBe(false)          // a member: the flag is ignored
    expect(has({ user: { role: 'admin' } }, false)).toBe(false)                         // admin, flag off
    expect(has({ user: { role: 'member' }, cohorts: ['other'] }, false)).toBe(false)    // outside the cohort
    expect(has({ user: { role: 'admin' } }, true)).toBe(true)
    expect(has({ user: { role: 'member' }, cohorts: [CREATE_INDICATOR_COHORT] }, false)).toBe(true)
    // the list is a read and stays for everyone on Charts
    expect(manifestFor({ surface: 'charts', createIndicator: false }).some(c => c.name === 'indicator.list')).toBe(true)
    // and an op for it is refused when the ctx says no access (planning re-validates against the ctx)
    const h = host([LEFT(csWith([]))])
    expect(planOps(collectTargets(h, ['indicators']), [open('L', 'x')], {}, { surface: 'charts', createIndicator: false }).ok).toBe(false)
  })
  it('with a request: opener called with seedFrom(request); receipt says "press Send"; nothing created or saved', async () => {
    const h = host([LEFT(csWith([]))])
    const req = '  help me build an indicator that\thighlights candles when the 9 EMA is above the 20 EMA  '
    const { p, commit } = await run(h, [open('L', req)])
    expect(p.ok).toBe(true)
    expect(p.lines).toEqual(['Open Create Indicator on Left chart (NVDA) with your request in the box (not sent)'])
    const res = await commit()
    expect(h.calls).toEqual([['L', { seed: seedFrom(req) }]])
    expect(res.ok).toBe(true)
    expect(res.lines[0]).toMatch(/^Opened Create Indicator on Left chart \(NVDA\) with your request in the box — press Send when you’re ready\. Nothing was created or saved/)
    expect(h.writes).toEqual([])
  })
  it('existing draft on that chart: receipt says the draft is open instead; never claims the seed was placed', async () => {
    const h = host([LEFT(csWith([]))], { opener: () => ({ ok: true, prefilled: false, draft: true, editing: false }) })
    const res = await (await run(h, [open('L', 'an RSI with a 4-colour histogram')])).commit()
    expect(res.lines[0]).toMatch(/your earlier draft is open instead, so your new request was not added/)
    expect(res.lines[0]).not.toMatch(/request in the box/)
  })
  it('defId from an indicator.list row → Modify; unknown/foreign defId → refusal, nothing opened', async () => {
    const h = host([LEFT(csWith([RSI, MINE]))])
    const res = await (await run(h, [open('L', null, CUSTOM)])).commit()
    expect(h.calls).toEqual([['L', { defId: CUSTOM }]])
    expect(res.lines[0]).toMatch(/^Opened Modify on .+ in Create Indicator on Left chart \(NVDA\)\./)
    for (const bad of ['u_ffffffffffff', 'rsi']) {          // not on the chart / a built-in
      const { p } = await run(h, [open('L', null, bad)])
      expect(p.ok, bad).toBe(false)
    }
    expect(h.calls).toHaveLength(1)
    // the opener's own refusal (a foreign id that slipped through) is a refusal receipt, nothing claimed
    const h2 = host([LEFT(csWith([MINE]))], { opener: () => ({ ok: false, reason: 'unknown-definition', prefilled: false, draft: false, editing: false }) })
    const r2 = await (await run(h2, [open('L', null, CUSTOM)])).commit()
    expect(r2.ok).toBe(false)
    expect(r2.failed[0].reason).toContain(OPENER_REFUSALS['unknown-definition'])
  })
  it('refused when the chart snapshot says canCreateIndicator is false (read-only chart / no access)', async () => {
    const h = host([LEFT(csWith([]))], { canCreate: false })
    const { p } = await run(h, [open('L', 'x')])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/Create Indicator isn’t available/)
    expect(h.calls).toEqual([])
  })
  it('access lost BETWEEN planning and Apply → refused at Apply, nothing opened; the opener\'s own "access" answer is a refusal too', async () => {
    const h = host([LEFT(csWith([]))])
    const { p, commit } = await run(h, [open('L', 'x')])
    expect(p.ok).toBe(true)
    h.access.on = false                                   // e.g. the flag turned off in another tab
    const res = await commit()
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/changed while I was working/)
    expect(h.calls).toEqual([])
    const h3 = host([LEFT(csWith([]))], { opener: () => ({ ok: false, reason: 'access', prefilled: false, draft: false, editing: false }) })
    const r3 = await (await run(h3, [open('L', 'x')])).commit()
    expect(r3.ok).toBe(false)
    expect(r3.failed[0].reason).toContain(OPENER_REFUSALS.access)
  })
  it('exclusive: never combined with another change in one plan (same chart or another)', async () => {
    const h = host([LEFT(csWith([])), RIGHT(csWith([]))])
    const same = await run(h, [open('L', 'x'), { action: 'chart.setType', target: 'L', args: { type: 'bars' } }])
    expect(same.p.ok).toBe(false)
    expect(same.p.refusals[0].reason).toMatch(/its own step/)
    const two = await run(h, [open('L', 'x'), open('R', 'y')])
    expect(two.p.ok).toBe(false)
    expect(h.calls).toEqual([])
  })
  it('undo is none; the receipt says how to cancel (close the panel); no Undo entry is offered', async () => {
    expect(getCapability('indicator.openCreate').undo).toBe('none')
    const h = host([LEFT(csWith([]))])
    const res = await (await run(h, [open('L', null)])).commit()
    expect(res.undo).toBe(null)
    expect(res.lines[0]).toMatch(/close the panel to cancel/)
  })
  it('prefill: control characters stripped, whitespace folded, capped at 600 at a word boundary', async () => {
    const h = host([LEFT(csWith([]))])
    const long = `rsi${String.fromCharCode(7)} above 70 ` + 'and more words '.repeat(80)
    await (await run(h, [open('L', long)])).commit()
    const sent = h.calls[0][1].seed
    expect(sent).toBe(seedFrom(long))
    expect(sent.length).toBeLessThanOrEqual(SEED_MAX)
    expect(sent.includes(String.fromCharCode(7))).toBe(false)
    expect(sent.startsWith('rsi above 70')).toBe(true)
  })
  it('joint-acceptance polish: a restored MODIFY draft says Modify; "not added" only when a request was given; counts exclude the Volume pane', () => {
    expect(openedLine({ ok: true, prefilled: false, draft: true, editing: true }, { defId: CUSTOM, name: 'LINREG 50', chart: 'Left chart (NVDA)' }))
      .toMatch(/^Opened Modify on LINREG 50 in Create Indicator on Left chart \(NVDA\) — your earlier draft is open instead\. Nothing/)
    expect(openedLine({ ok: true, prefilled: false, draft: true, editing: false }, { chart: 'Left chart (NVDA)' })).not.toMatch(/not added/)
    expect(openedLine({ ok: true, prefilled: false, draft: true, editing: false }, { seed: 'x', chart: 'Left chart (NVDA)' })).toMatch(/so your new request was not added\./)
    const h = host([LEFT(csWith([RSI, MACD_HIDDEN], { volume: true }))])
    expect(list(h, 'L').text).toBe('2 indicators on Left chart (NVDA) (plus the Volume pane).')
    expect(list(host([LEFT(csWith([], { volume: true }))]), 'L').text).toBe('Only the Volume pane is on Left chart (NVDA) — no indicators.')
  })
  it('already open on the same target: the receipt says nothing was typed over (never "in the box")', () => {
    expect(openedLine({ ok: true, prefilled: false, draft: false, editing: false }, { seed: 'x', chart: 'Left chart (NVDA)' }))
      .toMatch(/was already open on Left chart \(NVDA\), so I didn’t type over what’s in the box/)
  })
})

// ── 3. routing ───────────────────────────────────────────────────────────────────────────
describe('M1 routing — the indicators group', () => {
  const FULL = manifestFor(CTX)
  const groups = (m) => selectGroups(m).priority.filter(g => g !== 'agent')
  it('"add an RSI with a 4-colour histogram" routes indicators', () => {
    expect(groups('add an RSI with a 4-colour histogram')).toContain('indicators')
  })
  it('"make the chart dark" does not route indicators', () => {
    expect(groups('make the chart dark')).not.toContain('indicators')
  })
  it('"colour the candles by trend" routes indicators AND charts', () => {
    // the agreed overlap: a colour rule over an indicator condition routes both; the hints decide
    expect(groups('colour the candles by trend when RSI is above 70')).toEqual(expect.arrayContaining(['indicators', 'charts']))
    expect(groups('colour the candles by trend')).toEqual(expect.arrayContaining(['indicators', 'charts']))
    expect(groups('colour the candles green')).not.toContain('indicators')
    expect(groups('compare AAPL to SPY')).not.toContain('indicators')
    expect(groups('turn on earnings markers')).not.toContain('indicators')
  })
  it('"arrows when the 9 EMA crosses the 20" routes indicators (condition rule)', () => {
    expect(groups('arrows when the 9 EMA crosses the 20')).toContain('indicators')
    expect(groups('highlight candles when the 9 EMA is above the 20 EMA')).toContain('indicators')
    expect(groups('What indicators are on my chart?')).toContain('indicators')
    expect(groups('Open the indicator builder for a relative-strength formula')).toContain('indicators')
  })
  it('the indicators group packs under the routed budget beside every other group', () => {
    const budget = { limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold }
    expect(FULL.filter(c => groupOfAction(c.name) === 'indicators').map(c => c.name).sort()).toEqual(['indicator.list', 'indicator.openCreate'])
    for (const msg of ['colour the candles when RSI is above 70 and add a watchlist widget', 'what indicators are on the left chart, then switch it to weekly', 'add an rsi and draw a line at 200 and alert me when NVDA crosses 150']) {
      const r = routeManifest(FULL, msg, budget)
      expect(r.manifest.length, msg).toBeLessThanOrEqual(MANIFEST_CONTRACT.routingThreshold)
      expect(r.manifest.some(c => c.name === 'indicator.list'), msg).toBe(true)
    }
  })
})

// ── 4. safety ────────────────────────────────────────────────────────────────────────────
describe('M1 safety', () => {
  it('no chart_settings / board write in any M1 action (fingerprint before = after)', async () => {
    const cs = csWith([RSI, MINE])
    const h = host([LEFT(cs)])
    const fp = instanceFingerprint(cs)
    const before = JSON.stringify(cs)
    list(h, 'L')
    await (await run(h, [open('L', 'x')])).commit()
    await (await run(h, [open('L', null, CUSTOM)])).commit()
    expect(h.writes).toEqual([])
    expect(JSON.stringify(cs)).toBe(before)
    expect(instanceFingerprint(cs)).toBe(fp)
  })
  it('Main Trading open: indicator.list still answers (a read); openCreate writes no settings, so the protected-layout guard does not block it', async () => {
    const h = host([LEFT(csWith([RSI]))])
    h.layouts = { snapshot: () => ({ entries: [{ id: '1', name: 'Main Trading' }], active: { scope: 'user', id: '1' } }) }
    expect(list(h, 'L').table.rows).toHaveLength(1)
    const { p } = await run(h, [open('L', 'x')])
    expect(p.ok).toBe(true)
    expect(p.plans.every(x => x.kind === 'indicators')).toBe(true)        // not a board kind
    expect(protectionRefusal(h, p, [open('L', 'x')])).toBe(null)
    // …while a chart change on the same board is still refused there
    const c = await run(h, [{ action: 'chart.setType', target: 'L', args: { type: 'bars' } }])
    expect(protectionRefusal(h, c.p, [{ action: 'chart.setType' }])).toMatch(/protected layout/)
  })
})

// ── 5. the real panel (scripted model): targeting, ambiguity, no /converse ────────────────
let calls, envelopes
beforeEach(() => {
  try { localStorage.clear() } catch { /* */ }
  calls = []; envelopes = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([init.method || 'GET', String(url), body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') {
      const e = envelopes.shift()
      return json({ conversationId: 'ac_1', envelope: typeof e === 'function' ? e(body) : e, usage: { research_calls: 0, citations: [] } })
    }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks() })

const W = (id, x, settings) => ({ id, type: 'chart', x, y: 0, w: 12, h: 20, color: 'N', opts: { settings } })
function mountPanel({ admin = true, flag = true } = {}) {
  if (flag) localStorage.setItem(CREATE_INDICATOR_FLAG_KEY, '1')
  const board = makeBoard([W('L', 0, csWith([RSI, MACD_HIDDEN])), W('R', 12, csWith([MINE]))], { 'N:L': 'NVDA', 'N:R': 'AAPL' })
  const opened = []
  const pos = { L: 'left', R: 'right' }
  const decorate = (s) => (s ? { ...s, position: pos[s.ref], label: `${pos[s.ref][0].toUpperCase()}${pos[s.ref].slice(1)} chart (${s.symbol})` } : s)
  const base = board.host.charts
  const h = {
    ...board.host,
    charts: {
      ...base,
      list: () => base.list().map(decorate),
      read: (ref) => decorate(base.read(ref)),
      canCreateIndicator: () => true,
      openCreateIndicator: (ref, opts) => { opened.push([ref, opts]); return { ok: true, prefilled: !!opts?.seed, draft: false, editing: !!opts?.defId } },
    },
  }
  render(
    <AuthContext.Provider value={{ user: { role: admin ? 'admin' : 'member' }, cohorts: [] }}>
      <AgentPanel host={h} onClose={() => {}} />
    </AuthContext.Provider>,
  )
  const box = screen.getByLabelText('Message UCT Agent')
  const say = (t) => { fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
  return { board, opened, say }
}
const turnBodies = () => calls.filter(c => c[1] === '/api/agent/turn').map(c => c[2])
const converse = () => calls.filter(c => /converse|user-definitions/.test(c[1]))
const env = (disposition, ops) => ({ disposition, reply: '', question: null, ops, unsupported_category: null })

describe('M1 in the real panel (scripted model)', () => {
  it('"What indicators are on my chart?" with TWO charts and none named → asks which (no model call); a pick answers from that chart', async () => {
    const { say } = mountPanel()
    say('What indicators are on my chart?')
    await screen.findByText('Which indicators?')
    expect(turnBodies()).toHaveLength(0)
    fireEvent.click(await screen.findByRole('button', { name: /Right chart \(AAPL\)/ }))
    await screen.findByText(/^\d+ indicators? on Right chart \(AAPL\)( \(plus the Volume pane\))?\./)
  })
  it('"List the indicators on the right chart." → answered from the RIGHT chart only, fast path', async () => {
    const { say } = mountPanel()
    say('List the indicators on the right chart.')
    await screen.findByText(/^\d+ indicators? on Right chart \(AAPL\)( \(plus the Volume pane\))?\./)
    expect(turnBodies()).toHaveLength(0)
  })
  it('"Which indicators are hidden?" on the left chart → only the hidden one', async () => {
    const { say } = mountPanel()
    say('which indicators are hidden on the left chart')
    await screen.findByText(/^1 indicator hidden on Left chart \(NVDA\)\./)
  })
  it('model path: the request routes the indicators group; openCreate opens with the seed; NO /converse, NO definition write, no board write', async () => {
    const { say, opened, board } = mountPanel()
    const before = JSON.stringify(board.state.widgets)
    envelopes.push((b) => {
      expect(b.routing?.selected || ['indicators']).toContain('indicators')
      expect(b.capabilities.some(c => c.name === 'indicator.openCreate')).toBe(true)
      const ref = b.context.indicators.find(e => e.position === 'left').ref
      return env('apply', [{ action: 'indicator.openCreate', target: ref, args: { request: 'highlight candles when the 9 EMA is above the 20 EMA', defId: null } }])
    })
    say('Help me build an indicator that highlights candles when the 9 EMA is above the 20 EMA on the left chart')
    await screen.findByText(/press Send when you’re ready/)
    expect(opened).toEqual([['L', { seed: 'highlight candles when the 9 EMA is above the 20 EMA' }]])
    expect(converse()).toEqual([])
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  })
  it('a member WITHOUT access: the manifest the model gets has no openCreate, and an op naming it is refused', async () => {
    const { say, opened } = mountPanel({ admin: false, flag: true })
    envelopes.push((b) => {
      expect(b.capabilities.some(c => c.name === 'indicator.openCreate')).toBe(false)
      expect(b.capabilities.some(c => c.name === 'indicator.list')).toBe(true)
      return env('apply', [{ action: 'indicator.openCreate', target: b.context.indicators[0].ref, args: { request: 'x', defId: null } }])
    })
    say('Open Create Indicator on the left chart and write an rsi indicator')
    await waitFor(() => expect(turnBodies()).toHaveLength(1))
    await screen.findByText(/can’t “indicator\.openCreate” here|can't “indicator\.openCreate” here/)
    expect(opened).toEqual([])
  })
})
