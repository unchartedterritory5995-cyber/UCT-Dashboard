// ⭐ (2026-11-23, the typed ticker) THE KEY PRESS'S DEVICE READS, MADE AT THE TYPED INTENT.
// A ticker picked in a list paints in the key task (one render, handoffGroups' decision): the list's own warms have
// already read its rows from the device, so the press's device read (primeGroup) lands synchronously and every linked
// chart can show it now. A TYPED ticker's device read started only in the Enter task, landed after it, and the linked
// group took the round (a second render after the worker's answer). Now, when the typed text settles
// (SymbolSearch TYPED_INTENT_SETTLE_MS, the moment the store's own typed warm already runs), the chart's host starts
// the SAME reads (primeTypedIntent -> handoffGroups.primeGroup: every member of the linked group, on the key its own
// switch reads, each member latest-only). By Enter the copies are in the store, and Enter takes the decision.
// It DECIDES NOTHING and SHOWS NOTHING: no decision, no group symbol, no settle-clock request, no display change.
// Through the real handoffGroups and the real useSymbolHandoff (the facade mocked as in useSymbolHandoff.coldGates).
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

vi.mock('../../../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
const st = { displayable: false, lake: false, deep: true, device: false, held: true, syncLand: false }
// The device read: lands a few ms later, as a worker read does; `syncLand`: inside the call, as a copy the device
// client already holds does (its recently-read cache)
const LAND_MS = 3
const land = () => { st.device = true; st.displayable = true }
const deviceWarm = vi.fn(() => {
  if (st.syncLand) { land(); return Promise.resolve(true) }
  return new Promise((resolve) => setTimeout(() => { land(); resolve(true) }, LAND_MS))
})
vi.mock('../../../data/barStore/prefetch', () => ({
  peekDisplayable: () => st.displayable,
  lakePending: () => st.lake,
  deepPending: () => st.deep,
  holdsBars: () => st.held,
  devicePaints: () => st.device,
  deviceVerdict: () => ({ paints: st.device, reason: st.device ? 'paints' : 'none', held: 'none' }),
  deviceWarm: (...a) => deviceWarm(...a),
  deviceHold: () => null,
  watch: () => () => {},
  prepareForDisplay: () => new Promise(() => {}),
  prepareDailyForDisplay: () => new Promise(() => {}),
  prefetchBarsToIDB: () => {},
  heldRows: () => 0,
}))
vi.mock('../../../utils/prefetchBars', () => ({ prefetchBarsToIDB: () => {}, prepareForDisplay: () => new Promise(() => {}), prepareDailyForDisplay: () => new Promise(() => {}) }))
vi.mock('../../../components/chart/engine/serverCompute', () => ({
  columnsReadyFor: () => true, whenColumnsReady: () => Promise.resolve(true), warmColumnsFor: () => {},
}))
vi.mock('../../../data/deviceStore/switch', () => ({ deviceStoreEnabled: () => true }))
vi.mock('../../../data/deviceStore/source', () => ({ deviceSource: () => null }))

let useSymbolHandoff, G, primeTypedIntent
async function load() {
  vi.resetModules()
  useSymbolHandoff = (await import('../../../hooks/useSymbolHandoff')).default
  G = await import('../../../hooks/handoffGroups')
  primeTypedIntent = (await import('./typedIntentPrime')).primeTypedIntent
}
const scope = { board: 1 }

beforeEach(async () => {
  vi.useFakeTimers()
  Object.assign(st, { displayable: false, lake: false, deep: true, device: false, held: true, syncLand: false })
  deviceWarm.mockClear()
  await load()
})
afterEach(() => { vi.useRealTimers() })

/** A linked daily + 30-minute pair on colour A (the measured layout), as ChartWidget mounts them. */
function linkedPair() {
  return renderHook(({ s }) => [
    useSymbolHandoff(s, 'D', { group: 'charts:A', scope, showExtended: false }),
    useSymbolHandoff(s, '30', { group: 'charts:A', scope, showExtended: true }),
  ], { initialProps: { s: 'AAA' } })
}
/** Enter: the board's setGroupSym (beginGroupSwitch, then the symbol written) and the render it causes. */
function enter(h, sym) {
  let decided
  act(() => { decided = G.beginGroupSwitch(scope, 'charts:A', sym); h.rerender({ s: sym }) })
  return decided
}

describe('the typed intent starts the key press\'s device reads early', () => {
  it('every chart of the linked group reads the key its own switch reads (the D key; the 30m fetch key and session)', () => {
    linkedPair()
    primeTypedIntent(scope, 'A', 'BBB')
    expect(deviceWarm).toHaveBeenCalledWith('BBB', 'D', {})
    expect(deviceWarm).toHaveBeenCalledWith('BBB', '30', { showExtended: true })
    expect(deviceWarm).toHaveBeenCalledTimes(2)
  })

  it('it decides nothing and shows nothing, even when the copies land inside the call; the Enter after it decides', async () => {
    st.syncLand = true                                                  // the device client already holds them
    const h = linkedPair()
    act(() => { primeTypedIntent(scope, 'A', 'BBB') })
    expect(st.device).toBe(true)                                        // (the reads did land)
    expect(G.decisionFor(scope, 'charts:A')).toBeNull()                 // no decision published before Enter
    expect(h.result.current).toEqual(['AAA', 'AAA'])                   // nothing moves before Enter
    await act(async () => { await vi.advanceTimersByTimeAsync(5) })
    expect(enter(h, 'BBB')).toBe(true)
    expect(h.result.current).toEqual(['BBB', 'BBB'])
  })

  it('no board (a host with no store: the drill, the screener), no symbol, or no group members: it does nothing', () => {
    linkedPair()
    primeTypedIntent(null, 'A', 'BBB')
    primeTypedIntent(scope, 'A', '')
    primeTypedIntent(scope, 'B', 'BBB')                                 // colour B has no charts
    expect(deviceWarm).not.toHaveBeenCalled()
  })
})

describe('so Enter shows a typed ticker in the key task, as a list pick does', () => {
  it('CONTROL: with no typed intent, the device reads start at Enter, land after it, and the group takes the round', () => {
    const h = linkedPair()
    expect(enter(h, 'BBB')).toBe(false)
    expect(h.result.current).toEqual(['AAA', 'AAA'])                   // the round shows it later
  })

  it('with the typed intent before Enter, the copies are in, and Enter shows BOTH charts in its own render', async () => {
    const h = linkedPair()
    primeTypedIntent(scope, 'A', 'BBB')                                 // the text settled (140 ms after the last key)
    await act(async () => { await vi.advanceTimersByTimeAsync(LAND_MS + 1) })
    expect(enter(h, 'BBB')).toBe(true)
    expect(h.result.current).toEqual(['BBB', 'BBB'])                   // one render, one frame, both charts
  })
})

// ── ChartWidget hands the pane this prime, for its own board and colour (read by acorn AST, never grep) ────────
describe('ChartWidget wires it', () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url))
  const ast = Parser.extend(jsx()).parse(fs.readFileSync(path.join(HERE, 'ChartWidget.jsx'), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })
  function walk(n, fn) {
    if (!n || typeof n.type !== 'string') return
    fn(n)
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach((c) => walk(c, fn))
      else if (v && typeof v.type === 'string') walk(v, fn)
    }
  }

  it('imports primeTypedIntent and passes ChartPane an onTypedIntent that calls it with the board and the active colour', () => {
    const imp = ast.body.find((n) => n.type === 'ImportDeclaration' && n.specifiers.some((s) => s.local.name === 'primeTypedIntent'))
    expect(imp?.source.value).toBe('./typedIntentPrime')
    let attr = null
    walk(ast, (n) => {
      if (n.type === 'JSXOpeningElement' && n.name?.name === 'ChartPane') {
        const a = n.attributes.find((x) => x.type === 'JSXAttribute' && x.name?.name === 'onTypedIntent')
        if (a) attr = a
      }
    })
    expect(attr?.value?.expression?.type).toBe('Identifier')
    const handler = attr.value.expression.name
    let calls = null
    walk(ast, (n) => {
      if (n.type === 'VariableDeclarator' && n.id?.name === handler) {
        calls = []
        walk(n.init, (c) => { if (c.type === 'CallExpression' && c.callee?.name === 'primeTypedIntent') calls.push(c.arguments.map((a) => a.name ?? a.type)) })
      }
    })
    expect(calls).toEqual([['groupSymsStore', 'activeColor', expect.any(String)]])
  })
})
