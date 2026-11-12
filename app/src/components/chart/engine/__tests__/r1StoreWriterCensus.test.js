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
//   2. THE CANDLE-WRITE SITES IN StockChart. Exactly four component-level statements write the
//      candle series (setData / update, directly or through a local alias, or `_applyData` on it):
//        • `updateChart`            — the BASE paint (setData; P3-S3 replaces it with diffRenderer)
//        • the candleFrameFade layout effect — a static Setup⇄Result crossfade of the base frame
//        • the setup-day highlight effect — a static Model Book recolour of the base frame
//        • `_storeDevPaintRef.current = …` — THE store's developing-bar paint (snapshot.developing)
//      A fifth site — a live writer creeping back into StockChart — fails here by line.
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

/** Component-level statements of StockChart that write the candle series, with the write lines. */
function candleWriteSites() {
  const ast = Parser.extend(jsx()).parse(SRC, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const comp = ast.body.find((s) => s.type === 'ExportDefaultDeclaration').declaration
  const sites = []
  for (const st of comp.body.body) {
    const scopes = new Map()
    const lines = []
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
        scopes.get(owner).set(node.id.name, isCandleRef(node.init))
      }
      if (node.type === 'CallExpression') {
        const c = node.callee
        const candleRecv = (r) => {
          if (isCandleRef(r)) return true
          if (r?.type === 'ChainExpression') return candleRecv(r.expression)
          if (r?.type !== 'Identifier') return false
          for (let i = stack.length - 1; i >= 0; i--) {
            const sc = scopes.get(stack[i])
            if (sc?.has(r.name)) return sc.get(r.name)
          }
          return false
        }
        const callee = c.type === 'ChainExpression' ? c.expression : c
        if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier' &&
            (callee.property.name === 'update' || callee.property.name === 'setData') && candleRecv(callee.object)) {
          lines.push(node.loc.start.line)
        }
        if (callee.type === 'Identifier' && callee.name === '_applyData' && isCandleRef(node.arguments[0])) {
          lines.push(node.loc.start.line)
        }
      }
      for (const k in node) { if (k !== 'loc' && k !== 'start' && k !== 'end') walk(node[k], stack) }
      if (isFn) stack.pop()
    })(st, [])
    if (lines.length) sites.push({ st, lines, text: SRC.slice(st.start, st.end) })
  }
  return sites
}

const label = (site) => {
  const st = site.st
  if (st.type === 'VariableDeclaration' && st.declarations[0]?.id?.name === 'updateChart') return 'updateChart'
  if (st.type === 'ExpressionStatement' && st.expression.type === 'AssignmentExpression' &&
      /^_storeDevPaintRef\.current\b/.test(SRC.slice(st.expression.left.start, st.expression.left.end))) return 'storeDevPaint'
  if (/^useLayoutEffect\(/.test(site.text) && /\bcandleFrameFade\b/.test(site.text)) return 'candleFrameFade'
  if (/^useEffect\(/.test(site.text) && /\bhighlightTimeSet\b/.test(site.text)) return 'setupHighlight'
  return `UNLEDGERED@${st.loc.start.line} (writes at ${site.lines})`
}

describe('R1 — the candle-write sites of StockChart', () => {
  it('exactly: the base paint, the two static Model Book repaints, and the store\'s developing-bar paint', () => {
    const sites = candleWriteSites()
    expect(sites.length, 'the scan is not blind').toBeGreaterThan(0)
    expect(sites.map(label).sort()).toEqual(['candleFrameFade', 'setupHighlight', 'storeDevPaint', 'updateChart'])
  })

  it('the store paint writes ONLY with update() (never setData) and reads the store\'s developing bar', () => {
    const paint = candleWriteSites().find((s) => label(s) === 'storeDevPaint')
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
