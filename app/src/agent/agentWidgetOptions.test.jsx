// W1-B (Wave 1, BOARD B-05) — widget.setOption: ONE per-widget option, validated against the widget registry's own
// param schema (widgets/registry.js paramsSchema: enum | boolean | number, never an identity key), written through the
// board writer's `set[id].opts` — the same `{...w, opts}` + scheduleSave that ChartsWorkspace.handleOptsChange performs
// for a widget's own settings panel. Undo puts the previous opts object back exactly. Keys the schema does not declare
// as options are refused, and so are the ones it declares that the mounted widget does not read (settingsLiveness.test.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability, shapeError } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { makeBoard } from './__fixtures__/board'
import { setupPanel, ONE } from './testing/panelHarness'
import { WIDGET_REGISTRY, WORKSPACE_MENU_TYPES } from '../widgets/registry'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
const CTX = { surface: 'charts' }
const w = (id, type, x, y, opts = {}) => ({ id, type, x, y, w: 6, h: 10, color: 'N', opts })
const BOARD = () => [
  w('ch', 'chart', 0, 0, { tf: 'D' }), w('th', 'themes', 6, 0, { period: '1d', sortDir: 'desc', openTheme: 'Semis' }), w('fu', 'fundamentals', 12, 0, { view: 'quarterly' }),
  w('nw', 'news', 18, 0, {}), w('br', 'breadth', 0, 10, { tileStyle: 'values', hiddenMetrics: ['x'] }), w('of', 'optionsflow', 6, 10, { lead: 'tape' }), w('ca', 'calendar', 12, 10, { date: '2026-10-30', econStars: 3 }),
  w('vs', 'volumescan', 18, 10, { minRvol: 2 }), w('nh', 'nhnl', 0, 0, {}),
]
const op = (args) => ({ action: 'widget.setOption', target: 'board', args })
async function plan(h, ops) {
  buildContext(h, CTX)
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(h, ['board']), ops, env, CTX), env }
}
const optsOf = (board, id) => board.state.widgets.find(x => x.id === id).opts
const refuse = async (h, args) => (await plan(h, [op(args)])).p.refusals[0]?.reason

describe('widget.setOption — options the widget reads, off the Widgets menu too', () => {
  const BOARD2 = () => [w('tn', 'tradeExchangeNews', 0, 0, { presetId: 'p1', presets: [{ id: 'p1', name: 'Mine' }] }), w('rl', 'researchLibrary', 6, 0, {}), w('ps', 'periodsort', 12, 0, { start: 1, end: 2 })]
  const apply = async (host, args) => {
    const { p, env } = await plan(host, [op(args)])
    expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
    return commitPlan(host, p, { env })
  }
  it('News: pause (follow) and the linked filter; a Period Sort: its grouping; each listed for the model, each undone exactly', async () => {
    const { host, state } = makeBoard(BOARD2(), {})
    const hints = getCapability('widget.setOption').hints
    expect(hints).toMatch(/tradeExchangeNews: follow \(on\/off\), linked \(on\/off\)/)
    expect(hints).toMatch(/periodsort: group \(theme\|sector\|industry\)/)
    for (const [widget, key, value, want] of [['tn', 'follow', 'off', false], ['rl', 'linked', 'on', true], ['ps', 'group', 'Sector', 'sector']]) {
      const before = JSON.stringify(state.widgets)
      const res = await apply(host, { widget, key, value })
      expect(optsOf({ state }, widget)[key], `${widget}.${key}`).toBe(want)
      expect((await undoEntry(host, res.undo)).ok).toBe(true)
      expect(JSON.stringify(state.widgets)).toBe(before)
    }
  })
  it('the linked filter clears the applied preset as the widget\'s own control does; a no-op does not, and Undo puts the preset back', async () => {
    const { host, state } = makeBoard(BOARD2(), {})
    const res = await apply(host, { widget: 'tn', key: 'linked', value: 'on' })
    expect(optsOf({ state }, 'tn')).toMatchObject({ linked: true, presetId: null })
    await undoEntry(host, res.undo)
    expect(optsOf({ state }, 'tn').presetId).toBe('p1')
    await apply(host, { widget: 'tn', key: 'follow', value: 'off' })
    expect(optsOf({ state }, 'tn').presetId).toBe('p1')                       // follow is no filter: a preset does not store it
    const { host: h2, state: s2 } = makeBoard([w('tn', 'tradeExchangeNews', 0, 0, { linked: true, presetId: 'p1' })], {})
    await plan(h2, [op({ widget: 'tn', key: 'linked', value: 'on' })])
    expect(s2.widgets[0].opts.presetId).toBe('p1')
  })
})

describe('widget.setOption — the registry schema decides, the board writer writes, Undo is exact', () => {
  it('a Fundamentals view: the option written beside the widget\'s other opts (nothing else touched); receipt; Undo restores the exact previous opts', async () => {
    const { host, state } = makeBoard(...[BOARD(), { 'N:ch': 'NVDA' }])
    const before = JSON.stringify(state.widgets)
    const { p, env } = await plan(host, [op({ widget: 'fu', key: 'view', value: 'Annual' })])
    expect(p.ok).toBe(true)
    expect(p.lines.length).toBe(1)
    expect(p.lines[0]).toMatch(/view is now annual \(was quarterly\)$/)
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(true)
    expect(optsOf({ state }, 'fu')).toEqual({ view: 'annual' })
    expect(state.boardWrites).toBe(1)                                             // the board writer (= handleOptsChange's write)
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(JSON.stringify(state.widgets)).toBe(before)
  })
  it('every option type: an enum word in any case, on/off words for a boolean, a number for a number; a no-op is said', async () => {
    const { host, state } = makeBoard(...[BOARD(), { 'N:ch': 'NVDA' }])
    for (const [id, key, value, want] of [['fu', 'view', 'Annual', 'annual'], ['nw', 'filter', 'up', 'up'], ['of', 'scope', 'symbol', 'symbol'], ['ca', 'econStars', '2', 2], ['vs', 'showLogos', 'on', true]]) {
      const { p, env } = await plan(host, [op({ widget: id, key, value })])
      expect(p.ok, `${id}.${key}`).toBe(true)
      await commitPlan(host, p, { env })
      expect(optsOf({ state }, id)[key], `${id}.${key}`).toEqual(want)
    }
    const { p } = await plan(host, [op({ widget: 'fu', key: 'view', value: 'annual' })])
    expect(p.ok).toBe(true)
    expect(p.noops ?? p.plans?.[0]?.noops ?? []).toBeTruthy()
  })
  it('refused (nothing written): an unknown widget, a key the schema does not declare as an option (identity, json, capture-only), a wrong enum value, a non-number, a widget type with no options', async () => {
    const { host, state } = makeBoard(...[BOARD(), { 'N:ch': 'NVDA' }])
    const before = JSON.stringify(state.widgets)
    expect(await refuse(host, { widget: 'zz', key: 'period', value: '1w' })).toMatch(/no widget “zz”/)
    expect(await refuse(host, { widget: 'fu', key: 'rows', value: '1w' })).toMatch(/has no option “rows” — its options are view/)
    expect(await refuse(host, { widget: 'th', key: 'openTheme', value: 'x' })).toMatch(/has no options I can change here/)      // a free string is not an option
    expect(await refuse(host, { widget: 'nw', key: 'symbol', value: 'AMD' })).toMatch(/no option “symbol”/)          // identity: chart.setSymbol's business
    expect(await refuse(host, { widget: 'ca', key: 'date', value: '2026-01-01' })).toMatch(/no option “date”/)
    expect(await refuse(host, { widget: 'fu', key: 'view', value: 'daily' })).toMatch(/“view” can be annual, quarterly, analyst, ownership — not “daily”/)
    expect(await refuse(host, { widget: 'ca', key: 'econStars', value: 'many' })).toMatch(/“econStars” is a number from 1 to 3/)
    // a NUMBER is accepted only within the product's own declared range, and a whole-number control takes whole numbers
    expect(await refuse(host, { widget: 'ca', key: 'econStars', value: 4 })).toMatch(/“econStars” is from 1 to 3/)
    expect(await refuse(host, { widget: 'ca', key: 'econStars', value: 2.5 })).toMatch(/whole number from 1 to 3/)
    // an UNBOUNDED numeric key (no min/max in the registry: nhnl.minPrice, volumescan.minRvol/minMove/minDollarK) is not an option at all
    expect(await refuse(host, { widget: 'nh', key: 'minPrice', value: 5 })).toMatch(/has no options I can change here/)
    expect(await refuse(host, { widget: 'vs', key: 'minRvol', value: 3 })).toMatch(/has no option “minRvol” — its options are showLogos\.$/)
    expect(await refuse(host, { widget: 'ch', key: 'tf', value: 'W' })).toMatch(/has no options I can change here/)
    // ⛔ declared in the schema, but the mounted widget never reads them back from opts: refused in words, nothing written
    for (const [id, key, value] of [['th', 'period', '1w'], ['th', 'sortDir', 'asc'], ['br', 'tileStyle', 'spark'], ['ca', 'tbdOpen', true], ['nh', 'minCount', 5]]) {
      expect(await refuse(host, { widget: id, key, value }), `${id}.${key}`).toMatch(new RegExp(`I can't change “${key}” .*doesn't read a saved value`))
    }
    expect(shapeError('widget.setOption', { widget: 'th', key: 'period' }, CTX)).toBeTruthy()                        // a closed schema
    expect(JSON.stringify(state.widgets)).toBe(before)
  })
  it('the offered keys are exactly the registry\'s scalar, non-identity params; the capability is local and exactly undoable; the hints name them per widget type', () => {
    const c = getCapability('widget.setOption')
    expect([c.target, c.risk, c.undo]).toEqual(['board', 'local', 'exact'])
    for (const type of WORKSPACE_MENU_TYPES) {
      const offered = (WIDGET_REGISTRY[type].paramsSchema || []).filter(f => f.live === true)
      if (offered.length) expect(c.hints, type).toContain(`${type}: `)
      else expect(c.hints, type).not.toContain(`${type}: `)
    }
    expect(c.hints).not.toContain('statYear')                                   // a capture's frozen clock, not a control
    expect(c.hints).toContain('calendar: econStars (1–3)')
    expect(c.hints).not.toContain('themes: ')
    expect(c.hints).not.toContain('minRvol')                                    // unbounded numbers are never offered
    expect(c.hints.length).toBeLessThanOrEqual(1000)
  })
})

describe('through the REAL panel (panelHarness)', () => {
  let p
  beforeEach(() => { p = setupPanel() })
  afterEach(() => { cleanup() })
  it('"show annual on the fundamentals" (scripted) → applied (local), receipt, undo exact', async () => {
    const [[chart], syms] = ONE('NVDA')
    const { say, board } = p.mount([{ ...chart, w: 18 }, w('fu', 'fundamentals', 18, 0, { view: 'quarterly' })], syms)
    const before = JSON.stringify(board.state.widgets)
    p.st.envelopes.push(p.env('apply', [op({ widget: 'fu', key: 'view', value: 'annual' })]))
    const out = await say('show annual on the fundamentals')
    expect(out).toMatch(/view is now annual \(was quarterly\)/)
    expect(optsOf(board, 'fu')).toEqual({ view: 'annual' })
    expect(screen.queryAllByTestId('agent-proposal').length).toBe(0)
    await say('undo')
    expect(JSON.stringify(board.state.widgets)).toBe(before)
    expect(p.turns()).toBe(1)
  }, 40000)
  it('"show the theme tracker by week" (scripted): the widget would ignore it, so it refuses and nothing is stored', async () => {
    const [[chart], syms] = ONE('NVDA')
    const { say, board } = p.mount([{ ...chart, w: 18 }, w('th', 'themes', 18, 0, { period: '1d', sortDir: 'desc' })], syms)
    p.st.envelopes.push(p.env('apply', [op({ widget: 'th', key: 'period', value: '1w' })]))
    expect(await say('show the theme tracker by week')).toMatch(/doesn't read a saved value/)
    expect(optsOf(board, 'th')).toEqual({ period: '1d', sortDir: 'desc' })
  }, 40000)
})
