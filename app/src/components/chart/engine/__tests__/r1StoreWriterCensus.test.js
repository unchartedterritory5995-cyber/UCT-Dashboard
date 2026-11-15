// app/src/components/chart/engine/__tests__/r1StoreWriterCensus.test.js
//
// ─── R1 (BARSTORE-SPEC.md invariants, P3-S2): UNDER BARSTORE THE STORE IS THE ONLY LIVE WRITER ───
//
// Beside `singleWriterIndex.test.js` (which derives WHO writes the developing bar), this rail
// pins WHERE the candle series is written at all, and that the legacy writers cannot run under
// the BarStore source:
//
//   1. THE GATE. Every export of chart/legacyLiveWriters.js is chosen at module load from the
//      BARSTORE switch. With the switch ON every hook export IS the inert stand-in, and the two
//      updateChart steps call nothing but the store paint they are handed (they read no ctx).
//      With the switch OFF they are the writers (non-vacuity).
//   2. THE WRITE SITES OF THE CANDLE AND VOLUME SERIES IN StockChart, one row per (component-level
//      statement, method) — setData / update directly, through a local alias, or through
//      updateChart's `_applyData` helper, whose incremental last-point update() is its OWN row
//      (P3-S2b review: it was hidden inside "setData"). Ledger (CANDLE_SITES / VOLUME_SITES):
//        • `updateChart`            — the BASE paint (P3-S3 replaces it with diffRenderer)
//        • the candleFrameFade layout effect / volume re-tint — static Setup⇄Result crossfades
//        • the setup-day highlight effect — a static Model Book recolour of the base frame
//        • `_storeDevPaintRef.current = …` — THE store's developing-bar paint (snapshot.developing)
//      Any other site — a live writer creeping back into StockChart — fails here by line.
//
// ⚠️ Like the single-writer index, the site scan resolves `const x = candleSeriesRef.current`
// aliases (shadowing respected) and nothing deeper; it pins the count so a new site forces a
// decision here.
import fs from 'fs'
import path from 'path'
import { describe, it, expect, vi } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { loadWithBarStore } from '../../../../testing/barStoreModes'

vi.mock('../../../../hooks/useRealtimeBars', () => ({ default: () => ({}) }))

const ROOT = (() => {
  let dir = globalThis.process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`r1 census: could not find the repo root from ${globalThis.process.cwd()}`)
})()
const SRC = fs.readFileSync(path.join(ROOT, 'app/src/components/StockChart.jsx'), 'utf8')

const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])
const isCandleRef = (n) => !!n && n.type === 'MemberExpression' && n.object.type === 'Identifier' &&
  n.object.name === 'candleSeriesRef' && n.property.type === 'Identifier' && n.property.name === 'current'

/** The `_applyData(series, data)` helper inside updateChart: which write methods it calls on its
 *  `series` parameter (an incremental last-point update() AND a full setData()). */
function applyDataMethods(ast) {
  let methods = null
  ;(function walk(n) {
    if (methods || !n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (typeof n.type !== 'string') return
    if (n.type === 'VariableDeclarator' && n.id?.name === '_applyData' && FN.has(n.init?.type)) {
      const param = n.init.params[0]?.name
      const found = new Set()
      ;(function w2(m) {
        if (!m || typeof m !== 'object') return
        if (Array.isArray(m)) { m.forEach(w2); return }
        if (m.type === 'CallExpression' && m.callee.type === 'MemberExpression' &&
            m.callee.object.type === 'Identifier' && m.callee.object.name === param &&
            ['update', 'setData'].includes(m.callee.property.name)) found.add(m.callee.property.name)
        for (const k in m) { if (k !== 'loc' && k !== 'start' && k !== 'end') w2(m[k]) }
      })(n.init.body)
      methods = [...found].sort()
      return
    }
    for (const k in n) { if (k !== 'loc' && k !== 'start' && k !== 'end') walk(n[k]) }
  })(ast)
  return methods || []
}

function label(st, text) {
  if (st.type === 'VariableDeclaration' && st.declarations[0]?.id?.name === 'updateChart') return 'updateChart'
  if (st.type === 'ExpressionStatement' && st.expression.type === 'AssignmentExpression' &&
      /^_storeDevPaintRef\.current\b/.test(SRC.slice(st.expression.left.start, st.expression.left.end))) return 'storeDevPaint'
  if (/^useLayoutEffect\(/.test(text) && /\bcandleFrameFade\b/.test(text)) return 'candleFrameFade'
  if (/^useEffect\(/.test(text) && /\bhighlightTimeSet\b/.test(text)) return 'setupHighlight'
  if (/^useEffect\(/.test(text) && /\bfadedVolData\b/.test(text)) return 'volumeFadeRetint'
  return `UNLEDGERED@${st.loc.start.line}`
}

/**
 * Every write SITE of `<refName>.current` in StockChart, one row per (component-level statement,
 * method): `{site, text, lines}`. A call through `_applyData(<ref>.current, …)` counts once per
 * method the helper calls on its series — its incremental update() is its own site, never hidden
 * inside "setData".
 */
function seriesWriteSites(refName) {
  const ast = Parser.extend(jsx()).parse(SRC, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const comp = ast.body.find((s) => s.type === 'ExportDefaultDeclaration').declaration
  const isRef = (n) => !!n && n.type === 'MemberExpression' && n.object.type === 'Identifier' &&
    n.object.name === refName && n.property.type === 'Identifier' && n.property.name === 'current'
  const helper = applyDataMethods(ast)
  const rows = new Map()
  for (const st of comp.body.body) {
    const scopes = new Map()
    const text = SRC.slice(st.start, st.end)
    const add = (method, line) => {
      const k = `${label(st, text)}:${method}`
      if (!rows.has(k)) rows.set(k, { site: k, text, lines: [] })
      rows.get(k).lines.push(line)
    }
    ;(function walk(node, stack) {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach((n) => walk(n, stack)); return }
      if (typeof node.type !== 'string') return
      const isFn = FN.has(node.type)
      if (isFn) {
        stack.push(node)
        scopes.set(node, new Map(node.params.filter((p) => p.type === 'Identifier').map((p) => [p.name, false])))
      }
      const owner = stack[stack.length - 1]
      if (owner && node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
        scopes.get(owner).set(node.id.name, isRef(node.init))
      }
      if (node.type === 'CallExpression') {
        const recvIs = (r) => {
          if (isRef(r)) return true
          if (r?.type === 'ChainExpression') return recvIs(r.expression)
          if (r?.type !== 'Identifier') return false
          for (let i = stack.length - 1; i >= 0; i--) {
            const sc = scopes.get(stack[i])
            if (sc?.has(r.name)) return sc.get(r.name)
          }
          return false
        }
        const callee = node.callee.type === 'ChainExpression' ? node.callee.expression : node.callee
        if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier' &&
            (callee.property.name === 'update' || callee.property.name === 'setData') && recvIs(callee.object)) {
          add(callee.property.name, node.loc.start.line)
        }
        if (callee.type === 'Identifier' && callee.name === '_applyData' && isRef(node.arguments[0])) {
          for (const m of helper) add(`_applyData.${m}`, node.loc.start.line)
        }
      }
      for (const k in node) { if (k !== 'loc' && k !== 'start' && k !== 'end') walk(node[k], stack) }
      if (isFn) stack.pop()
    })(st, [])
  }
  return [...rows.values()]
}

// THE LEDGER (P3-S3 replaces every `updateChart:*` row with diffRenderer). Under BARSTORE the only
// DEVELOPING-bar writes are `storeDevPaint:update`; updateChart's `_applyData.update` is the base
// paint's incremental last-point write of the BASE series (displayBars / volData), never a live one.
const CANDLE_SITES = [
  'candleFrameFade:setData',        // static Setup⇄Result crossfade of the base frame (Model Book)
  'setupHighlight:setData',         // static Model Book setup-day recolour
  'storeDevPaint:update',           // THE store's developing-bar paint
  'updateChart:_applyData.setData', // base paint (full)
  'updateChart:_applyData.update',  // base paint (incremental last point of the base series)
  'updateChart:setData',            // base paint: the empty-series clear
]
const VOLUME_SITES = [
  'candleFrameFade:setData',
  'volumeFadeRetint:setData',       // static Setup⇄Result volume crossfade re-tint (Model Book)
  'storeDevPaint:update',
  'updateChart:_applyData.setData',
  'updateChart:_applyData.update',
  'updateChart:setData',
]

describe('R1 — the series-write sites of StockChart (candle AND volume, per method)', () => {
  it('candle: exactly the ledgered sites', () => {
    const sites = seriesWriteSites('candleSeriesRef')
    expect(sites.length, 'the scan is not blind').toBeGreaterThan(0)
    expect(sites.map((s) => s.site).sort()).toEqual([...CANDLE_SITES].sort())
  })

  it('volume: exactly the ledgered sites', () => {
    const sites = seriesWriteSites('volumeSeriesRef')
    expect(sites.length, 'the scan is not blind').toBeGreaterThan(0)
    expect(sites.map((s) => s.site).sort()).toEqual([...VOLUME_SITES].sort())
  })

  it('the incremental _applyData update() is counted as its own site (non-vacuity)', () => {
    const ast = Parser.extend(jsx()).parse(SRC, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
    expect(applyDataMethods(ast)).toEqual(['setData', 'update'])
  })

  it('the store paint writes ONLY with update() (never setData) and reads the store\'s developing bar', () => {
    const paint = seriesWriteSites('candleSeriesRef').find((s) => s.site === 'storeDevPaint:update')
    expect(paint.text).not.toMatch(/\.setData\(/)
    expect(paint.text).toMatch(/_storeDevRef\.current/)
  })
})


describe('R1 — the legacy live writers are inert under BARSTORE (one structural gate)', () => {
  const HOOKS = ['useLegacyGapWatchdog', 'useLegacyLiveReset', 'useLegacyWriterA', 'useLegacyPushWriterB',
    'useLegacyHeldPushFold', 'useLegacyCustomTfF', 'useLegacyDailyTickE', 'useLegacyRegistryWriterC']
  // A ctx that throws on ANY read: an inert step must not even look at the legacy state.
  const untouchable = () => new Proxy({}, { get: (_, k) => { throw new Error(`read ctx.${String(k)} under BARSTORE`) } })

  it('BARSTORE=on: every hook export IS the inert stand-in; the updateChart steps only call the store paint', async () => {
    const M = await loadWithBarStore(true, () => import('../../legacyLiveWriters'))
    expect(M.__barStore).toBe(true)
    expect(M.LEGACY_LIVE).toBe(false)
    for (const h of HOOKS) expect(M[h], h).toBe(M.__inertHook)
    expect(M.__inertHook()).toBeUndefined()
    for (const step of ['liveAfterSetData', 'liveAfterVolumeSetData']) {
      const paint = vi.fn()
      expect(() => M[step](untouchable(), paint), step).not.toThrow()
      expect(paint, step).toHaveBeenCalledWith(true)
    }
    const store = { current: { time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 9, sym: 'X' } }
    const legacy = { tail: { current: 'L' }, dev: { current: 'L' }, sym: { current: 'L' } }
    const src = M.devOnScreenSource(legacy, store)
    expect([src.tail(), src.dev(), src.sym()]).toEqual([store.current, store.current, 'X'])
  })

  it('BARSTORE=off (non-vacuity): the exports are the writers and read the legacy state', async () => {
    const M = await loadWithBarStore(false, () => import('../../legacyLiveWriters'))
    expect(M.__barStore).toBe(false)
    expect(M.LEGACY_LIVE).toBe(true)
    for (const h of HOOKS) expect(M[h], h).not.toBe(M.__inertHook)
    const paint = vi.fn()
    expect(() => M.liveAfterSetData(untouchable(), paint)).toThrow(/read ctx\./)
    expect(paint).not.toHaveBeenCalled()
    const legacy = { tail: { current: 'T' }, dev: { current: 'D' }, sym: { current: 'S' } }
    const src = M.devOnScreenSource(legacy, { current: null })
    expect([src.tail(), src.dev(), src.sym()]).toEqual(['T', 'D', 'S'])
  })
})
