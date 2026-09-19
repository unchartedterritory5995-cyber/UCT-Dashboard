// app/src/components/chart/engine/__tests__/lwcHazards.test.js
//
// ─── R0.4 — THE HAZARD RAILS ────────────────────────────────────────────────
//
// ⭐⭐ THE LOAD-BEARING TEST IN THIS FILE IS THE SOURCE SWEEP. Four files in this
// repo already carry a comment warning that `createPriceLine`'s `lineStyle`
// defaults to Dashed. That is precisely the state a fact reaches just before it
// gets re-broken: everybody has written it down and NOTHING ENFORCES IT. The sweep
// reads every `createPriceLine` call site out of `app/src` and fails by name.
//
// It carries a control proving it can see a call site that omits the option —
// without that, a sweep whose regex has rotted reports a clean pass forever, which
// is `lesson_gate_that_cannot_fail`.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  HAZARDS,
  LINE_STYLE,
  PRICE_LINE_DEFAULT_STYLE,
  NATIVE_LINE_WIDTHS,
  X_DOMAIN,
  POLYLINE,
  priceLineSpec,
  clampNativeLineWidth,
  boxSpan,
  withinXDomain,
  needsCulling,
  primitiveCountFor,
  hiddenSeriesOptions,
} from '../lwcHazards'

const SRC = path.resolve(__dirname, '../../../..')            // app/src
const REPO = path.resolve(SRC, '../..')
const MAP = fs.readFileSync(path.join(REPO, 'docs/pine/lwc5-capability-map.md'), 'utf8').replace(/\r\n/g, '\n')

/** Every `.js`/`.jsx` under app/src, tests excluded. */
function sourceFiles(dir = SRC, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === '__fixtures__') continue
      sourceFiles(p, acc)
    } else if (/\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)) {
      acc.push(p)
    }
  }
  return acc
}

/**
 * Find `createPriceLine( ... )` calls and report whether each names `lineStyle`.
 *
 * ⚠️ Brace-matched, not regex-to-the-closing-paren: a spec object can contain
 * nested braces and a ternary, and a lazy `\)` stops at the first one it meets —
 * truncating the text the check runs on and passing for the wrong reason.
 */
function priceLineCallSites(src, file) {
  const out = []
  const rx = /createPriceLine\s*\(/g
  let m
  while ((m = rx.exec(src))) {
    let i = m.index + m[0].length
    let depth = 1
    while (i < src.length && depth > 0) {
      const ch = src[i]
      if (ch === '(') depth += 1
      else if (ch === ')') depth -= 1
      i += 1
    }
    const args = src.slice(m.index + m[0].length, i - 1)
    const line = src.slice(0, m.index).split('\n').length
    out.push({ file, line, args, namesLineStyle: /\blineStyle\s*:/.test(args) })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
describe('H1 — createPriceLine must always name lineStyle', () => {
  const files = sourceFiles()
  const sites = files.flatMap((f) => priceLineCallSites(fs.readFileSync(f, 'utf8'), path.relative(SRC, f)))

  it('the sweep can see the codebase at all', () => {
    // ⭐ NON-VACUITY. Zero files or zero call sites means the sweep proves nothing.
    expect(files.length).toBeGreaterThan(100)
    expect(sites.length).toBeGreaterThan(0)
  })

  it('⛔ every call site that passes an object literal names lineStyle', () => {
    // A call passing a prebuilt variable (`createPriceLine(spec)`) is checked
    // where that spec is BUILT — priceLineSpec below is what builds it.
    const literals = sites.filter((s) => s.args.includes(':'))
    const offenders = literals.filter((s) => !s.namesLineStyle)
    expect(offenders.map((o) => `${o.file}:${o.line}`)).toEqual([])
    expect(literals.length).toBeGreaterThan(0)     // the filter must not empty the set
  })

  it('THE CONTROL: the sweep catches a call site that omits it', () => {
    // Without this, a rotted regex reports a clean pass forever.
    const planted = `series.createPriceLine({ price: 50, color: '#fff', lineWidth: 1 })`
    const found = priceLineCallSites(planted, 'planted.js')
    expect(found).toHaveLength(1)
    expect(found[0].namesLineStyle).toBe(false)
  })

  it('THE CONTROL: and passes one that names it, even with nested braces', () => {
    const planted = `s.createPriceLine({ price: p, title: fmt({ a: 1 }), lineStyle: LINE_STYLE.Solid })`
    const found = priceLineCallSites(planted, 'planted.js')
    expect(found).toHaveLength(1)
    expect(found[0].namesLineStyle).toBe(true)
  })

  it('the default really is Dashed, and the map still says so', () => {
    expect(PRICE_LINE_DEFAULT_STYLE).toBe(LINE_STYLE.Dashed)
    expect(PRICE_LINE_DEFAULT_STYLE).not.toBe(LINE_STYLE.Solid)
    expect(MAP).toMatch(/is `Dashed`, not solid/)
    expect(MAP).toMatch(/379 px/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('priceLineSpec', () => {
  it('refuses to leave the style to LWC, and says what the default would be', () => {
    expect(() => priceLineSpec({ price: 50 })).toThrow(/lineStyle is required/)
    expect(() => priceLineSpec({ price: 50 })).toThrow(/Dashed/)
    expect(() => priceLineSpec({ price: 50, lineStyle: null })).toThrow(/lineStyle is required/)
  })

  it('accepts an explicit style and keeps it', () => {
    const s = priceLineSpec({ price: 50, lineStyle: LINE_STYLE.Solid })
    expect(s.lineStyle).toBe(LINE_STYLE.Solid)
    expect(s.price).toBe(50)
  })

  it('defaults axisLabelVisible to false, because Pine hlines draw no label', () => {
    expect(priceLineSpec({ price: 50, lineStyle: LINE_STYLE.Solid }).axisLabelVisible).toBe(false)
    // …but an explicit request still wins.
    expect(priceLineSpec({ price: 50, lineStyle: LINE_STYLE.Solid, axisLabelVisible: true }).axisLabelVisible).toBe(true)
  })

  it('clamps Pine\'s unbounded width into the native four', () => {
    expect(priceLineSpec({ price: 1, lineStyle: LINE_STYLE.Solid, width: 17 }).lineWidth).toBe(4)
    expect(priceLineSpec({ price: 1, lineStyle: LINE_STYLE.Solid }).lineWidth).toBe(1)
  })

  it('names an unknown style rather than passing it through', () => {
    expect(() => priceLineSpec({ price: 1, lineStyle: 99 })).toThrow(/unknown lineStyle 99/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('H2 — native line width', () => {
  it('is exactly 1|2|3|4', () => {
    expect(NATIVE_LINE_WIDTHS).toEqual([1, 2, 3, 4])
    expect(MAP).toMatch(/`LineWidth` is `1\\?\|2\\?\|3\\?\|4`/)
  })

  it('clamps out-of-range widths and says it clamped', () => {
    expect(clampNativeLineWidth(3)).toEqual({ lineWidth: 3, clamped: false })
    expect(clampNativeLineWidth(17)).toEqual({ lineWidth: 4, clamped: true })
    expect(clampNativeLineWidth(0)).toEqual({ lineWidth: 1, clamped: true })
    expect(clampNativeLineWidth('wide')).toEqual({ lineWidth: 1, clamped: true })
  })

  it('⚠️ the module says the clamp is native-only', () => {
    // A canvas stroke has no cap, so routing a primitive-drawn line through this
    // would invent a limit TradingView does not have.
    const src = fs.readFileSync(path.join(SRC, 'components/chart/engine/lwcHazards.js'), 'utf8')
    expect(src).toMatch(/NATIVE PATH ONLY/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('H3 — positionsBox length is inclusive', () => {
  it('a one-bar box has inclusive length 1 and gap-corrected length 0', () => {
    expect(boxSpan(10, 10)).toMatchObject({ from: 10, to: 10, inclusiveLength: 1, gapCorrectedLength: 0 })
  })

  it('a ten-bar span is 11 inclusive, which is the trap', () => {
    // Using 11 as a width makes every box one bar too wide and adjacent boxes
    // overlap by exactly one bar.
    expect(boxSpan(10, 20)).toMatchObject({ inclusiveLength: 11, gapCorrectedLength: 10 })
    expect(MAP).toMatch(/`positionsBox` returns `length = \\?\|Δ\\?\| ?\+ ?1`/)
  })

  it('normalises a reversed span', () => {
    expect(boxSpan(20, 10)).toMatchObject({ from: 10, to: 20, inclusiveLength: 11 })
  })

  it('refuses a non-finite index', () => {
    expect(() => boxSpan(NaN, 5)).toThrow(/finite/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('H4 — the bar_index x-domain', () => {
  it('is 10000 back and 500 forward', () => {
    expect(X_DOMAIN).toEqual({ back: 10000, forward: 500 })
    expect(MAP).toMatch(/\[bar_index-10000, bar_index\+500\]/)
  })

  it('accepts the edges and rejects just outside them', () => {
    expect(withinXDomain(0, 10000).ok).toBe(true)
    expect(withinXDomain(-1, 10000).ok).toBe(false)
    expect(withinXDomain(10500, 10000).ok).toBe(true)
    expect(withinXDomain(10501, 10000).ok).toBe(false)
  })

  it('reports rather than clamps', () => {
    // ⛔ Out-of-domain is a Pine runtime error. Dragging the coordinate to the
    // edge would draw something the script never asked for.
    const r = withinXDomain(-5, 10000)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/10000 bars back/)
    expect(r).not.toHaveProperty('clamped')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('H5 / H6 — primitives get no culling, and one layer owns a kind', () => {
  it('knows the polyline budget', () => {
    expect(POLYLINE).toEqual({ maxPoints: 10000, maxObjects: 100 })
    expect(POLYLINE.maxPoints * POLYLINE.maxObjects).toBe(1000000)
    expect(MAP).toMatch(/\*\*1M vertices\*\*/)
  })

  it('says to cull when the point count exceeds the visible range', () => {
    expect(needsCulling(10000, 250).cull).toBe(true)
    expect(needsCulling(100, 250).cull).toBe(false)
    expect(needsCulling(0, 250).cull).toBe(false)
  })

  it('⛔ 500 boxes are ONE primitive, not 500', () => {
    // hitTest runs per attached primitive on every mousemove.
    expect(primitiveCountFor(500)).toEqual({ primitives: 1, objects: 500 })
    expect(primitiveCountFor(0)).toEqual({ primitives: 0, objects: 0 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('H7 — display.none', () => {
  it('hides the series AND removes it from autoscale', () => {
    // ⚠️ visible:false alone still lets the plot drive the price scale, and Pine's
    // hidden plots are often extreme values used only as fill anchors.
    const o = hiddenSeriesOptions()
    expect(o.visible).toBe(false)
    expect(typeof o.autoscaleInfoProvider).toBe('function')
    expect(o.autoscaleInfoProvider()).toBeNull()
  })

  it('the capability map still specifies both halves', () => {
    expect(MAP).toMatch(/`display\.none` ⇒ `\{visible:false, autoscaleInfoProvider: \(\)=>null\}`/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the hazard register', () => {
  it('every registered hazard is named by a describe block in this file', () => {
    // A hazard documented and unguarded is worse than one nobody wrote down: it
    // reads as covered. Hazards may share a block (H5/H6 do), so the id is looked
    // for anywhere in a describe TITLE rather than at its start.
    const self = fs.readFileSync(__filename, 'utf8')
    const titles = [...self.matchAll(/describe\('([^']+)'/g)].map((m) => m[1])
    expect(titles.length).toBeGreaterThan(5)          // the extractor works at all
    for (const id of Object.keys(HAZARDS)) {
      expect(titles.some((t) => t.includes(id)), `${id} is registered but no describe names it`).toBe(true)
    }
  })

  it('THE CONTROL: the register check can spot an uncovered hazard', () => {
    // Without this the loop above passes for an extractor that found nothing.
    const titles = ['H1 — something', 'H2 — something else']
    expect(['H1', 'H2'].every((id) => titles.some((t) => t.includes(id)))).toBe(true)
    expect(['H1', 'H9'].every((id) => titles.some((t) => t.includes(id)))).toBe(false)
  })

  it('names seven hazards', () => {
    // Growing this set is a deliberate act, not a refactor.
    expect(Object.keys(HAZARDS)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7'])
  })
})
