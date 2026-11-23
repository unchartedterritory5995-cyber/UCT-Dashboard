// LEGEND family through the REAL panel: the member's words → the instant path's general readers (capabilities/legendPhrases.js,
// indicatorPhrases.js toggle / copy / modify) → the existing capability → the product's own writer (the Chart Settings legend
// control's setHeader, withBarInfoField, the stat picker's headerStatTogglePatch; Indicators' setVisible / add; the Create
// custom copy door; the Modify opener) → the chart's stored settings, read back here through the product's own resolvers
// (legendModeOf, barInfoFieldsOf, headerStatKeys), then Undo through the same door. Multi-chart forms run on a four-chart board
// (two daily, two weekly) through the same target rules and spatial safety net a model plan meets. The model is a stand-in
// (scripted, or a sentinel when a turn would have needed it): no paid call. Evidence: LOCAL vitest + jsdom, SIMULATED.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, FOUR } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { legendModeOf } from '../components/chart/legendMode'
import { barInfoFieldsOf } from '../components/chart/barInfoFields'
import { headerStatKeys, statLabelsOf } from '../components/chart/headerStatCatalog'
import { CREATE_INDICATOR_FLAG_KEY } from '../components/chart/builder/studio/createIndicatorFlag'
import { setOwnedDefinitionSource } from './capabilities/indicatorEdits'
import { setDefinitionDeps } from './capabilities/definitions'
import * as R from '../components/chart/engine/nativeRegistry'
import { instancesOf } from '../components/chart/builder/agentSeams'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const csOf = (board, id) => { const w = board.state.widgets.find(x => x.id === id); return mergeChartSettings(w?.opts?.settings ? JSON.stringify(w.opts.settings) : null) }
const storedOf = (board, id) => JSON.stringify(board.state.widgets.find(x => x.id === id)?.opts?.settings ?? null)
const rowsOf = (board, id) => instancesOf(csOf(board, id), R).filter(r => !r.setting)
const seed = (w, patch) => ({ ...w, opts: { ...w.opts, settings: { ...w.opts.settings, ...patch } } })

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { cleanup(); setDefinitionDeps({}) })

describe('one chart — instant, the end state read back through the product resolver, exact Undo', () => {
  it('C1-064 "only show the legend when I hold" → Hold; "show the legend only when I press and hold" is the same; Undo back to Always', async () => {
    const m = p.mount(...ONE('QQQ'))
    const before = storedOf(m.board, 'c')
    expect(legendModeOf(csOf(m.board, 'c'))).toBe('always')
    const out = await m.say('only show the legend when I hold')
    expect(legendModeOf(csOf(m.board, 'c'))).toBe('hold')
    expect(out).toMatch(/Chart legend: hold/i)
    expect(p.turns()).toBe(0)
    await m.say('undo')
    expect(storedOf(m.board, 'c')).toBe(before)
    await m.say('show the legend only when I press and hold')
    expect(legendModeOf(csOf(m.board, 'c'))).toBe('hold')
    await m.say('hide the status line')
    expect(legendModeOf(csOf(m.board, 'c'))).toBe('off')
    await m.say('always show the legend')
    expect(legendModeOf(csOf(m.board, 'c'))).toBe('always')
    expect(p.turns()).toBe(0)
  })

  it('C1-065 "hide the open in the legend", then "show the % change in the status line" (it was off); each receipt names the strip; Undo exact', async () => {
    const [[c], g] = ONE('QQQ')
    const m = p.mount([seed(c, { header: { ...(c.opts.settings.header || {}), barInfo: ['date', 'open', 'high', 'low', 'close', 'change'] } })], g)
    const before = storedOf(m.board, 'c')
    const out = await m.say('hide the open in the legend')
    expect(barInfoFieldsOf(csOf(m.board, 'c'))).toEqual(['date', 'high', 'low', 'close', 'change'])
    expect(out).toMatch(/Bar info: removed Open — it shows Date, High, Low, Close, Net Chg/)
    const out2 = await m.say('show the % change in the status line')
    expect(barInfoFieldsOf(csOf(m.board, 'c'))).toEqual(['date', 'high', 'low', 'close', 'change', 'changePct'])
    expect(out2).toMatch(/Bar info: added % Chg/)
    expect(p.turns()).toBe(0)
    // a field already shown: said in words, nothing written
    const mid = storedOf(m.board, 'c')
    expect(await m.say('add the close to the legend')).toMatch(/Bar info already shows Close/)
    expect(storedOf(m.board, 'c')).toBe(mid)
    await m.say('undo')
    await m.say('undo')
    expect(storedOf(m.board, 'c')).toBe(before)
  })

  it('C1-066 a library stat the picker offers ("the short float") is now reachable; the picker\'s own unpick takes the stat\'s rename with it; Undo exact', async () => {
    const [[c], g] = ONE('QQQ')
    const m = p.mount([seed(c, { header: { ...(c.opts.settings.header || {}), fields: ['mcap', 'earn'], statLabels: { mcap: 'Cap' } } })], g)
    const before = storedOf(m.board, 'c')
    const out = await m.say('add the short float to the info row')
    expect(headerStatKeys(csOf(m.board, 'c').header)).toEqual(['mcap', 'earn', 'shortf'])
    expect(out).toMatch(/Info row: added Short % of Float — it shows Market Cap, Next Earnings, Short % of Float/)
    await m.say('take market cap off the header')
    const h = csOf(m.board, 'c').header
    expect(headerStatKeys(h)).toEqual(['earn', 'shortf'])
    expect(statLabelsOf(h)).toEqual({})                       // the rename went with it, exactly as the ✕ in Chart Settings does
    expect(p.turns()).toBe(0)
    await m.say('undo')
    expect(statLabelsOf(csOf(m.board, 'c').header)).toEqual({ mcap: 'Cap' })
    await m.say('undo')
    expect(storedOf(m.board, 'c')).toBe(before)
  })

  it('C1-104 "toggle rsi" is the chord: absent → added, shown → hidden, hidden → shown; each its own Undo', async () => {
    const m = p.mount(...ONE('QQQ'))
    await m.say('toggle rsi')
    await waitFor(() => expect(rowsOf(m.board, 'c').map(r => r.defId)).toEqual(['rsi']))
    await m.say('toggle rsi')
    await waitFor(() => expect(rowsOf(m.board, 'c').find(r => r.defId === 'rsi').hidden).toBe(true))
    await m.say('toggle the rsi')
    await waitFor(() => expect(rowsOf(m.board, 'c').find(r => r.defId === 'rsi').hidden).toBeFalsy())
    expect(p.turns()).toBe(0)
    await m.say('undo')
    await waitFor(() => expect(rowsOf(m.board, 'c').find(r => r.defId === 'rsi').hidden).toBe(true))
    // "toggle rsi off" on a hidden RSI is not a show: the words say off — the model hears it
    await m.say('toggle rsi off')
    expect(p.turns()).toBe(1)
    expect(rowsOf(m.board, 'c').find(r => r.defId === 'rsi').hidden).toBe(true)
  })
})

describe('multi-chart forms — two daily and two weekly charts (spatialCheck / deixis)', () => {
  let m
  const daily = ['c0', 'c1']
  const weekly = ['c2', 'c3']
  beforeEach(() => {
    const [w, g] = FOUR()
    w[2].opts.tf = 'W'; w[3].opts.tf = 'W'
    m = p.mount(w, g)
  })
  const modes = () => Object.fromEntries([...daily, ...weekly].map(c => [c, legendModeOf(csOf(m.board, c))]))

  it('"hide the legend on all the daily charts" — exactly the daily ones; the weekly ones untouched; ONE Undo takes the request back', async () => {
    const before = [...daily, ...weekly].map(c => storedOf(m.board, c))
    await m.say('hide the legend on all the daily charts')
    expect(modes()).toEqual({ c0: 'off', c1: 'off', c2: 'always', c3: 'always' })
    expect(p.turns()).toBe(0)
    await m.say('undo')
    expect([...daily, ...weekly].map(c => storedOf(m.board, c))).toEqual(before)
  })

  it('"hide the open in the legend on the weekly charts" — the weekly strips only', async () => {
    await m.say('hide the open in the legend on the weekly charts')
    for (const c of weekly) expect(barInfoFieldsOf(csOf(m.board, c)), c).not.toContain('open')
    for (const c of daily) expect(barInfoFieldsOf(csOf(m.board, c)), c).toContain('open')
  })

  it('the CLICKED chart never stands in for the named set: a weekly chart selected, "only show the legend when I hold on the daily charts"', async () => {
    const weeklyRef = m.h.charts.list().find(s => s.symbol === 'NVDA').ref
    p.select(weeklyRef)
    await m.say('set the legend to hold on the daily charts')
    expect(modes()).toEqual({ c0: 'hold', c1: 'hold', c2: 'always', c3: 'always' })
    expect(p.turns()).toBe(0)
  })
  it('a scope word ("only … on the daily charts") is never read as the set here: it goes to the model, nothing changes locally', async () => {
    const before = [...daily, ...weekly].map(c => storedOf(m.board, c))
    await m.say('only show the legend when I hold on the daily charts')
    expect(p.turns()).toBe(1)
    expect([...daily, ...weekly].map(c => storedOf(m.board, c))).toEqual(before)
  })

  it('a set no chart is on ("every monthly chart") is asked, and nothing changes', async () => {
    const before = [...daily, ...weekly].map(c => storedOf(m.board, c))
    const out = await m.say('hide the legend on every monthly chart')
    expect(out).toMatch(/None of the charts here is on monthly/)
    expect([...daily, ...weekly].map(c => storedOf(m.board, c))).toEqual(before)
  })

  it('no chart named on a four-chart board, none clicked: asked which, nothing changes', async () => {
    const before = [...daily, ...weekly].map(c => storedOf(m.board, c))
    const out = await m.say('hide the legend')
    expect(out).toMatch(/which chart/i)
    expect([...daily, ...weekly].map(c => storedOf(m.board, c))).toEqual(before)
  })

  it('spatial safety net: a MODEL plan on exactly the daily charts runs; one that also touches a weekly chart is never applied silently', async () => {
    const ref = (body, sym) => body.context.charts.find(c => c.label.includes(sym)).ref
    const off = (body, sym) => ({ action: 'chart.setSetting', target: ref(body, sym), args: { setting: 'header.legendMode', value: 'off' } })
    p.st.envelopes.push((body) => p.env('apply', [off(body, 'SPY'), off(body, 'QQQ')]))
    await m.say('could you make the legends go away on all of my daily charts please')
    expect(modes()).toEqual({ c0: 'off', c1: 'off', c2: 'always', c3: 'always' })
    await m.say('undo')
    // the wrong set: the daily SPY chart and a WEEKLY one, for words naming the daily charts
    const before = [...daily, ...weekly].map(c => storedOf(m.board, c))
    p.st.envelopes.push((body) => p.env('apply', [off(body, 'SPY'), off(body, 'NVDA')]))
    await m.say('could you make the legends go away on all of my daily charts please')
    expect([...daily, ...weekly].map(c => storedOf(m.board, c))).toEqual(before)
    expect(p.transcript()).toMatch(/I wasn't sure you meant Chart \(NVDA\), so check this first — nothing has changed yet/)
    expect(p.proposals().length).toBeGreaterThan(0)
  })
})

describe('the legend menu\'s definition verbs', () => {
  const MINE = 'u_aaaaaaaaab44'
  let FIX
  beforeAll(() => {
    FIX = JSON.parse(fs.readFileSync(path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/authoring/batch2_definitions.json'), 'utf8'))
    const res = R.installUserDefinitions([{ ...FIX.styled_markers, id: MINE, version: 1, meta: { ...(FIX.styled_markers.meta || {}), name: 'Trend Gauge' } }])
    expect(res.errors).toEqual([])
  })
  afterEach(() => setOwnedDefinitionSource(() => []))
  // the member's own definitions as the SERVER lists them (useUserDefinitions → useAgent's owned source): `rows()` is read at
  // every list request, so a copy saved in the test is listed (and owned) after the Agent's mutate, as in the product
  let listed = 0
  const serveDefinitions = (rows) => {
    const base = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('/api/user-definitions')) return base(url, init)
      listed++
      return new Response(JSON.stringify({ definitions: rows() }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  }

  it('C2-043 "create a custom copy of the rsi" — proposed first; approved, the copy is saved and read back as one of mine; Undo deletes it', async () => {
    const saved = new Map()
    let n = 0
    setDefinitionDeps({
      save: async (definition, id) => { const def_id = id || `u_c0ffee00000${++n}`; saved.set(def_id, { def_id, version: 1, definition: { ...definition, id: def_id }, live: true }); return { ok: true, row: { def_id, version: 1 } } },
      read: async (id) => { const r = saved.get(id); return r && r.live ? { ok: true, row: { ...r } } : { ok: false, status: 404, error: 'Not found' } },
      remove: async (id) => { const r = saved.get(id); if (!r || !r.live) return { ok: false, error: 'Not found' }; r.live = false; return { ok: true } },
      fork: async () => ({ ok: false, error: 'not in this test' }),
    })
    serveDefinitions(() => [...saved.values()].filter(r => r.live).map(r => ({ def_id: r.def_id, version: r.version, definition: r.definition })))
    const m = p.mount(...ONE('QQQ'))
    const before = storedOf(m.board, 'c')
    await m.say('create a custom copy of the rsi')
    expect(p.turns()).toBe(0)
    expect(p.proposals()).toHaveLength(1)
    expect(p.transcript()).toMatch(/Save a copy of “Relative Strength Index” as one of your indicators \(a built-in becomes an editable formula\)/)
    expect(saved.size).toBe(0)                                  // nothing saved until approved
    const out = await m.say('do it')
    expect(saved.size).toBe(1)
    const [id] = saved.keys()
    expect(saved.get(id).live).toBe(true)
    expect(R.getDefinition(id)).toBeTruthy()                    // installed: the member's list can draw it
    expect(out).toMatch(/Saved a copy of “Relative Strength Index” as your indicator/)
    expect(storedOf(m.board, 'c')).toBe(before)                // the chart is not changed by a copy
    await m.say('undo')
    await waitFor(() => expect(saved.get(id).live).toBe(false))
    expect(p.transcript()).toMatch(/Deleted the copy/)
  })

  it('C2-044 "modify trend gauge with the uct agent" — the chart\'s own Modify door, on that definition; nothing created or saved', async () => {
    serveDefinitions(() => [{ def_id: MINE, version: 1, definition: { ...FIX.styled_markers, id: MINE, version: 1, meta: { ...(FIX.styled_markers.meta || {}), name: 'Trend Gauge' } } }])
    localStorage.setItem(CREATE_INDICATOR_FLAG_KEY, '1')
    const [[c], g] = ONE('QQQ')
    const m = p.mount([seed(c, { indicatorInstances: [{ instanceId: `inst:${MINE}:1`, defId: MINE, defVersion: 1, inputs: {}, hidden: false }] })], g)
    const calls = []
    m.h.charts.openCreateIndicator = (ref, o) => { calls.push([ref, o]); return { ok: true, prefilled: false, draft: false, editing: true } }
    const before = storedOf(m.board, 'c')
    // the member's list arrives from the server (SWR) before the reader can name one of theirs
    await waitFor(() => expect(listed).toBeGreaterThan(0))
    await new Promise(r => setTimeout(r, 50))
    const out = await m.say('modify trend gauge with the uct agent')
    expect(p.turns()).toBe(0)
    expect(calls).toEqual([[m.h.charts.list()[0].ref, { defId: MINE }]])
    // (the receipt names the indicator as the chart's legend does — its chip label, not the definition's catalogue name)
    expect(out).toMatch(/Modify on .+ is open in Create Indicator on Chart \(QQQ\)\. Nothing was created or saved/)
    expect(storedOf(m.board, 'c')).toBe(before)
    // a built-in has no Modify: not read as one (the model hears it), and nothing is opened
    await m.say('modify the rsi with the uct agent')
    expect(calls).toHaveLength(1)
  })
})
