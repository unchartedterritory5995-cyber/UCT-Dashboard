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
// ⭐ THE STORE IS KEYED BY SYMBOL (review of #2624, section 4): a copy that landed for one symbol makes only THAT symbol
// displayable, so "prime X, Enter Y" takes the round here as in the app. `lake` / `deep` are global (their answer is
// the same for every symbol in these cases); `syncLand`: the read lands inside the call, as a copy the device client
// already holds does (its recently-read cache); otherwise a few ms later, as a worker read does.
const st = { lake: false, deep: true, syncLand: false, bySym: new Map() }
const of = (sym) => st.bySym.get(String(sym)) || { device: false, displayable: false, held: false }
const LAND_MS = 3
const land = (sym) => { st.bySym.set(String(sym), { device: true, displayable: true, held: true }) }
const deviceWarm = vi.fn((sym) => {
  if (st.syncLand) { land(sym); return Promise.resolve(true) }
  return new Promise((resolve) => setTimeout(() => { land(sym); resolve(true) }, LAND_MS))
})
/** Every facade call, by name: what the store-off case reads (no read, no entry, no request). */
const facadeCalls = []
const rec = (name, fn) => (...a) => { facadeCalls.push(name); return fn(...a) }
const sw = { on: true }
vi.mock('../../../data/barStore/prefetch', () => ({
  peekDisplayable: rec('peekDisplayable', (sym) => of(sym).displayable),
  lakePending: rec('lakePending', () => st.lake),
  deepPending: rec('deepPending', () => st.deep),
  holdsBars: rec('holdsBars', (sym) => of(sym).held),
  devicePaints: rec('devicePaints', (sym) => of(sym).device),
  deviceVerdict: rec('deviceVerdict', (sym) => ({ paints: of(sym).device, reason: of(sym).device ? 'paints' : 'none', held: 'none' })),
  deviceWarm: rec('deviceWarm', (...a) => deviceWarm(...a)),
  deviceHold: rec('deviceHold', () => null),
  watch: rec('watch', () => () => {}),
  prepareForDisplay: rec('prepareForDisplay', () => new Promise(() => {})),
  prepareDailyForDisplay: rec('prepareDailyForDisplay', () => new Promise(() => {})),
  prefetchBarsToIDB: rec('prefetchBarsToIDB', () => {}),
  heldRows: rec('heldRows', () => 0),
  askForDisplay: rec('askForDisplay', () => Promise.resolve(null)),
}))
vi.mock('../../../utils/prefetchBars', () => ({ prefetchBarsToIDB: () => {}, prepareForDisplay: () => new Promise(() => {}), prepareDailyForDisplay: () => new Promise(() => {}) }))
vi.mock('../../../components/chart/engine/serverCompute', () => ({
  columnsReadyFor: () => true, whenColumnsReady: () => Promise.resolve(true), warmColumnsFor: () => {},
}))
vi.mock('../../../data/deviceStore/switch', () => ({ deviceStoreEnabled: () => sw.on }))
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
  Object.assign(st, { lake: false, deep: true, syncLand: false })
  st.bySym.clear()
  sw.on = true
  facadeCalls.length = 0
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
    expect(of('BBB').device).toBe(true)                                 // (the reads did land)
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

describe('with the device store OFF the prime does nothing at all', () => {
  it('no device read, no store entry, no request: not one facade call (the member prime returns at !DEVICE)', async () => {
    sw.on = false
    await load()                                                        // the store-off page load
    linkedPair()
    const before = facadeCalls.length
    primeTypedIntent(scope, 'A', 'BBB')
    await act(async () => { await vi.advanceTimersByTimeAsync(LAND_MS + 1) })
    expect(facadeCalls.slice(before)).toEqual([])
    expect(deviceWarm).not.toHaveBeenCalled()
  })
})

describe('so Enter shows a typed ticker in the key task, as a list pick does', () => {
  it('CONTROL: with no typed intent, the device reads start at Enter, land after it, and the group takes the round', () => {
    const h = linkedPair()
    expect(enter(h, 'BBB')).toBe(false)
    expect(h.result.current).toEqual(['AAA', 'AAA'])                   // the round shows it later
  })

  it('prime X, Enter Y: the copies are for X, so Enter on Y takes the round (the prime is for the text it was given)', async () => {
    const h = linkedPair()
    primeTypedIntent(scope, 'A', 'BBB')                                 // the text settled on BBB...
    await act(async () => { await vi.advanceTimersByTimeAsync(LAND_MS + 1) })
    expect(enter(h, 'CCC')).toBe(false)                                 // ...and Enter took CCC (an arrowed row)
    expect(h.result.current).toEqual(['AAA', 'AAA'])
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
