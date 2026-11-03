// W1-B (Wave 1, BOARD B-05) — widget.setOption: ONE per-widget option, validated against the widget registry's own
// param schema (widgets/registry.js paramsSchema: enum | boolean | number, never an identity key), written through the
// board writer's `set[id].opts` — the same `{...w, opts}` + scheduleSave that ChartsWorkspace.handleOptsChange performs
// for a widget's own settings panel. Undo puts the previous opts object back exactly. Keys the schema does not declare
// as options are refused.
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

describe('widget.setOption — the registry schema decides, the board writer writes, Undo is exact', () => {
  it('a Theme Tracker period: the option written beside the widget\'s other opts (nothing else touched); receipt; Undo restores the exact previous opts', async () => {
    const { host, state } = makeBoard(...[BOARD(), { 'N:ch': 'NVDA' }])
    const before = JSON.stringify(state.widgets)
    const { p, env } = await plan(host, [op({ widget: 'th', key: 'period', value: '1W' })])
    expect(p.ok).toBe(true)
    expect(p.lines.length).toBe(1)
    expect(p.lines[0]).toMatch(/^The Theme Tracker( \([a-z -]+\))?: period is now 1w \(was 1d\)$/)
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(true)
    expect(optsOf({ state }, 'th')).toEqual({ period: '1w', sortDir: 'desc', openTheme: 'Semis' })
    expect(state.boardWrites).toBe(1)                                             // the board writer (= handleOptsChange's write)
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(JSON.stringify(state.widgets)).toBe(before)
  })
  it('every option type: an enum word in any case, on/off words for a boolean, a number for a number; a no-op is said', async () => {
    const { host, state } = makeBoard(...[BOARD(), { 'N:ch': 'NVDA' }])
    for (const [id, key, value, want] of [['fu', 'view', 'Annual', 'annual'], ['nw', 'filter', 'up', 'up'], ['br', 'tileStyle', 'spark', 'spark'], ['of', 'scope', 'symbol', 'symbol'], ['ca', 'econStars', '2', 2], ['ca', 'tbdOpen', 'on', true]]) {
      const { p, env } = await plan(host, [op({ widget: id, key, value })])
      expect(p.ok, `${id}.${key}`).toBe(true)
      await commitPlan(host, p, { env })
      expect(optsOf({ state }, id)[key], `${id}.${key}`).toEqual(want)
    }
    expect(optsOf({ state }, 'br').hiddenMetrics).toEqual(['x'])                 // a json option is never touched
    const { p } = await plan(host, [op({ widget: 'fu', key: 'view', value: 'annual' })])
    expect(p.ok).toBe(true)
    expect(p.noops ?? p.plans?.[0]?.noops ?? []).toBeTruthy()
  })
  it('refused (nothing written): an unknown widget, a key the schema does not declare as an option (identity, json, capture-only), a wrong enum value, a non-number, a widget type with no options', async () => {
    const { host, state } = makeBoard(...[BOARD(), { 'N:ch': 'NVDA' }])
    const before = JSON.stringify(state.widgets)
    expect(await refuse(host, { widget: 'zz', key: 'period', value: '1w' })).toMatch(/no widget “zz”/)
    expect(await refuse(host, { widget: 'th', key: 'rows', value: '1w' })).toMatch(/has no option “rows” — its options are period, sortDir/)
    expect(await refuse(host, { widget: 'th', key: 'openTheme', value: 'x' })).toMatch(/no option “openTheme”/)      // a free string is not an option
    expect(await refuse(host, { widget: 'nw', key: 'symbol', value: 'AMD' })).toMatch(/no option “symbol”/)          // identity: chart.setSymbol's business
    expect(await refuse(host, { widget: 'ca', key: 'date', value: '2026-01-01' })).toMatch(/no option “date”/)
    expect(await refuse(host, { widget: 'th', key: 'period', value: '2w' })).toMatch(/“period” can be 1d, 1w, 1m, 3m, 1y, ytd — not “2w”/)
    expect(await refuse(host, { widget: 'ca', key: 'econStars', value: 'many' })).toMatch(/“econStars” is a number from 1 to 3/)
    // a NUMBER is accepted only within the product's own declared range, and a whole-number control takes whole numbers
    expect(await refuse(host, { widget: 'ca', key: 'econStars', value: 4 })).toMatch(/“econStars” is from 1 to 3/)
    expect(await refuse(host, { widget: 'ca', key: 'econStars', value: 2.5 })).toMatch(/whole number from 1 to 3/)
    expect(await refuse(host, { widget: 'nh', key: 'minCount', value: 0 })).toMatch(/“minCount” is from 1 to 260/)
    // an UNBOUNDED numeric key (no min/max in the registry: nhnl.minPrice, volumescan.minRvol/minMove/minDollarK) is not an option at all
    expect(await refuse(host, { widget: 'nh', key: 'minPrice', value: 5 })).toMatch(/has no option “minPrice” — its options are minCount/)
    expect(await refuse(host, { widget: 'vs', key: 'minRvol', value: 3 })).toMatch(/has no option “minRvol” — its options are showLogos$/)
    expect(await refuse(host, { widget: 'ch', key: 'tf', value: 'W' })).toMatch(/has no options I can change here/)
    expect(shapeError('widget.setOption', { widget: 'th', key: 'period' }, CTX)).toBeTruthy()                        // a closed schema
    expect(JSON.stringify(state.widgets)).toBe(before)
  })
  it('the offered keys are exactly the registry\'s scalar, non-identity params; the capability is local and exactly undoable; the hints name them per widget type', () => {
    const c = getCapability('widget.setOption')
    expect([c.target, c.risk, c.undo]).toEqual(['board', 'local', 'exact'])
    for (const type of WORKSPACE_MENU_TYPES) {
      const offered = (WIDGET_REGISTRY[type].paramsSchema || []).filter(f => ['enum', 'boolean', 'number'].includes(f.type) && !f.required && !['fields', 'uncaptured', 'reason', 'statYear'].includes(f.key)
        && (f.type !== 'number' || (Number.isFinite(f.min) && Number.isFinite(f.max))))
      if (offered.length) expect(c.hints, type).toContain(`${type}: `)
      else expect(c.hints, type).not.toContain(`${type}: `)
    }
    expect(c.hints).not.toContain('statYear')                                   // a capture's frozen clock, not a control
    expect(c.hints).toContain('themes: period (1d|1w|1m|3m|1y|ytd), sortDir (asc|desc)')
    expect(c.hints).toContain('calendar: econStars (1–3), tbdOpen (on/off)')
    expect(c.hints).not.toContain('minRvol')                                    // unbounded numbers are never offered
    expect(c.hints.length).toBeLessThanOrEqual(1000)
  })
})

describe('through the REAL panel (panelHarness)', () => {
  let p
  beforeEach(() => { p = setupPanel() })
  afterEach(() => { cleanup() })
  it('"show the theme tracker by week" (scripted) → applied (local), receipt, undo exact', async () => {
    const [[chart], syms] = ONE('NVDA')
    const { say, board } = p.mount([{ ...chart, w: 18 }, w('th', 'themes', 18, 0, { period: '1d', sortDir: 'desc' })], syms)
    const before = JSON.stringify(board.state.widgets)
    p.st.envelopes.push(p.env('apply', [op({ widget: 'th', key: 'period', value: '1w' })]))
    const out = await say('show the theme tracker by week')
    expect(out).toMatch(/period is now 1w \(was 1d\)/)
    expect(optsOf(board, 'th')).toEqual({ period: '1w', sortDir: 'desc' })
    expect(screen.queryAllByTestId('agent-proposal').length).toBe(0)
    await say('undo')
    expect(JSON.stringify(board.state.widgets)).toBe(before)
    expect(p.turns()).toBe(1)
  }, 40000)
})
