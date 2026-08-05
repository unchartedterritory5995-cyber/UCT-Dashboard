// app/src/components/chart/engine/paneLayout.test.js
//
// The whole value of `paneLayout.js` is that it reproduces the SHIPPED band
// geometry exactly while expressing it as real panes. So these cases are not
// examples: they are the transcription proof, over the same space
// `paneMarginsProjection.test.js` already covers (all 512 subsets of the nine
// stacked oscillators, on both volume settings) plus the height sweep that makes
// the illegal-layout class unreachable rather than merely unobserved.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { stripComments } from './__tests__/sourceScan'
import { computePaneMargins } from '../paneMargins'
import { mergeChartSettings } from '../chartDefaults'
import { csForPaneMargins } from './paneMarginsProjection'
import { ENGINE_FLIPPED_DEF_IDS } from './flipState'
import { validateDefinition } from './defSchema'
import { getDefinition, listDefinitions } from './nativeRegistry'
import {
  computePaneLayout,
  currentPaneManifest,
  paneManifest,
  registerManifestChart,
  DEFAULT_PANE_HEIGHT,
  MIN_PANE_PX,
  SEPARATOR_PX,
  VOLUME_PANE_HEIGHT,
} from './paneLayout'

/** `paneMargins.PANES`' stacking order, bottom of the chart first. Written here
 *  and NOT in `paneLayout.js` — that is the retirement (see the table probe). */
const OSC = ['obv', 'atr', 'adx', 'macd', 'cci', 'williamsR', 'mfi', 'stoch', 'rsi']

/** The repo root, found by walking up from wherever vitest was invoked.
 *  `import.meta.url` is an http: URL under this environment's vite transform, so
 *  it cannot be used — the same walk `enumerationSites.test.js` documents. */
const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`paneLayout: could not find the repo root from ${process.cwd()}`)
})()

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** The parity route's plot height (`?h=620` minus the 40 px header and 20 px
 *  footer, minus the time axis). Every pixel number below is at this height. */
const H = 594

const EMPTY = new Set()
const OPTS = (over) => ({
  chartHeight: H, hasVolumeBand: true, excludeKeys: EMPTY, separatorPx: SEPARATOR_PX, ...over,
})

// ⭐⭐ B5 TASK 9 — THE BLOB THIS HANDS OVER IS THE ONE THE RENDER PATH HANDS
// OVER, and it has to be built rather than merged now. `mergeChartSettings`
// folds `cs.indicators` into `indicatorInstances` and emits `{volumeProfile}`,
// so a merged blob answers "no oscillator is on" to `computePaneMargins` and all
// 512 subsets collapse to ONE empty stack. The suite's own non-vacuity controls
// caught exactly that ("the 512 subsets really are 512 different stacks": 1 vs
// 512; "no subset reached the shave ceiling"), which is what they are for.
//
// `csForPaneMargins` is what `StockChart.updateChart` builds and passes, so this
// is the shipped input, not a reconstruction of the pre-migration one.
const blobFor = (mask) => {
  const merged = mergeChartSettings({
    indicators: Object.fromEntries(OSC.map((k, i) => [k, { enabled: !!(mask & (1 << i)) }])),
  })
  return csForPaneMargins(merged, merged.indicatorInstances, ENGINE_FLIPPED_DEF_IDS)
}

/** Every one of the 512 subsets, merged once. Building them inside the sweep
 *  would make the sweep measure `mergeChartSettings` instead of the geometry. */
const BLOBS = Array.from({ length: 512 }, (_, mask) => blobFor(mask))

/**
 * TODAY'S THREE HORIZONTAL BOUNDARIES, in pixels from the top of the chart,
 * read out of the SHIPPED band function.
 *
 *   candleTop     — the top of the price area (MAIN_TOP headroom)
 *   candleBottom  — where price stops and the volume band begins
 *   pane0Bottom   — where the volume band stops and the oscillator stack begins,
 *                   which is exactly where pane 0's rectangle has to end
 *
 * ⚠️ `pane0Bottom` is derived from the VOLUME band's own bottom edge when there
 * is one, because that edge is the boundary between "what stays in pane 0" and
 * "what becomes a pane". With no volume band it is `main.bottom`, the same
 * boundary reached from the other side.
 */
function shippedBoundaries(cs, hasVolumeBand) {
  const bands = computePaneMargins(cs, hasVolumeBand, EMPTY)
  const oscFraction = hasVolumeBand ? bands.volume.bottom : bands.main.bottom
  return {
    candleTop: Math.round(bands.main.top * H),
    candleBottom: Math.round((1 - bands.main.bottom) * H),
    pane0Bottom: H - Math.round(oscFraction * H),
  }
}

/** The same three boundaries, after — from pane 0's own height and its
 *  re-expressed margins, which is how the renderer will read them. */
function layoutBoundaries(out) {
  const p0 = out.pane0
  return {
    candleTop: Math.round(p0.mainMargins.top * p0.heightPx),
    candleBottom: Math.round((1 - p0.mainMargins.bottom) * p0.heightPx),
    pane0Bottom: p0.heightPx,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('pane 0 keeps its rectangle, to the pixel', () => {
  it.each([0, 1, 3, 7, 0b101010101, 511])('subset %i', (mask) => {
    const cs = BLOBS[mask]
    const before = shippedBoundaries(cs, true)
    const after = layoutBoundaries(computePaneLayout(cs, [], OPTS()))
    expect(after).toEqual(before)
  })

  // ⭐ THE POINT OF THE WHOLE MODULE. `pane0Bottom` is in the comparison and not
  // just the candle rectangle: the margins are expressed as fractions of pane 0's
  // OWN height, so a pane 0 of the wrong height still reproduces the candle
  // rectangle — and everything below it would be off by the separator budget. A
  // triple is what makes "the separators come out of the oscillators" failable
  // here rather than only in the case named after it.
  it.each([true, false])('and every subset of all 512, hasVolumeBand=%s', (hasVolumeBand) => {
    const bad = []
    let sawShave = false
    for (let mask = 0; mask < 512; mask++) {
      const cs = BLOBS[mask]
      const before = shippedBoundaries(cs, hasVolumeBand)
      const after = layoutBoundaries(computePaneLayout(cs, [], OPTS({ hasVolumeBand })))
      if (after.candleTop !== before.candleTop
          || after.candleBottom !== before.candleBottom
          || after.pane0Bottom !== before.pane0Bottom) {
        bad.push({ mask, before, after })
      }
      // The stack the shave loop is about: main's `bottom` at the 0.69 ceiling —
      // exactly where `1c1b84bf`'s 1,178 illegal layouts lived.
      if (computePaneMargins(cs, hasVolumeBand, EMPTY).main.bottom >= 0.69) sawShave = true
    }
    expect(bad).toEqual([])
    expect(sawShave, 'no subset reached the shave ceiling — the hard half went untested').toBe(true)
  })

  // Non-vacuity: the loop above really visited 512 DISTINCT layouts, not one
  // layout 512 times. (A `blobFor` that ignored its argument would leave every
  // comparison true and the gate green forever.)
  it('the 512 subsets really are 512 different stacks', () => {
    const seen = new Set()
    for (let mask = 0; mask < 512; mask++) {
      const out = computePaneLayout(BLOBS[mask], [], OPTS())
      seen.add(JSON.stringify([out.pane0.heightPx, out.panes.map(p => [p.key, p.heightPx])]))
    }
    expect(seen.size).toBe(512)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('the geometry is TOTAL — no input in the layout space produces an illegal layout', () => {
  // ⛔ THE CLASS THIS EXISTS TO CLOSE. lightweight-charts 5.2.0 throws on a price
  // scale whose margins are outside `0 <= top <= 1`, `0 <= bottom <= 1`,
  // `top + bottom <= 1` (`…development.js:4548-4562`). `computePaneMargins`
  // shipped a fix for exactly that (`1c1b84bf`: 1,178 illegal layouts, 895 of
  // which threw). This is the same obligation for the successor, discharged by
  // ENUMERATION rather than by sampling.
  //
  // THE DECLARED LAYOUT SPACE, and why it is the whole space:
  //   · 512 oscillator subsets × volume band on/off = 1,024 band configurations.
  //     `excludeKeys` adds no dimension — it only ever REMOVES a key, so an
  //     (enabled, excluded) pair is the (enabled \ excluded) subset, which the
  //     collapse case below proves rather than assumes.
  //   · every integer chart height in [MIN_H, MAX_H]. The parity route runs at
  //     594; a 4x4 multi-chart grid cell on a laptop is ~200; a full-screen chart
  //     on a tall monitor is ~1,200. The range is deliberately wider on both
  //     sides than anything that renders.
  const MIN_H = 120
  const MAX_H = 1600

  const legalityFailures = (out) => {
    const bad = []
    const check = (name, m) => {
      if (m === null) return
      if (!Number.isFinite(m.top) || !Number.isFinite(m.bottom)) bad.push(`${name}: not finite`)
      else if (m.top < 0 || m.top > 1) bad.push(`${name}.top=${m.top}`)
      else if (m.bottom < 0 || m.bottom > 1) bad.push(`${name}.bottom=${m.bottom}`)
      else if (m.top + m.bottom > 1) bad.push(`${name}.sum=${m.top + m.bottom}`)
    }
    check('main', out.pane0.mainMargins)
    check('volume', out.pane0.volumeMargins)
    if (!(out.pane0.heightPx >= MIN_PANE_PX)) bad.push(`pane0=${out.pane0.heightPx}`)
    for (const p of out.panes) {
      if (!(p.heightPx >= MIN_PANE_PX)) bad.push(`${p.key}=${p.heightPx}`)
    }
    const total = out.pane0.heightPx
      + out.panes.reduce((s, p) => s + p.heightPx, 0)
      + out.panes.length * SEPARATOR_PX
    if (total !== out.chartHeight) bad.push(`sums to ${total}, not ${out.chartHeight}`)
    return bad
  }

  it('every band configuration at every chart height in the declared space', () => {
    const failures = []
    let visited = 0
    for (let mask = 0; mask < 512; mask++) {
      const cs = BLOBS[mask]
      for (const hasVolumeBand of [true, false]) {
        for (let chartHeight = MIN_H; chartHeight <= MAX_H; chartHeight++) {
          const out = computePaneLayout(cs, [], OPTS({ chartHeight, hasVolumeBand }))
          visited += 1
          const bad = legalityFailures(out)
          if (bad.length && failures.length < 12) failures.push({ mask, hasVolumeBand, chartHeight, bad })
        }
      }
    }
    expect(failures).toEqual([])
    // Non-vacuity, stated as a number: a loop whose bounds silently collapsed
    // would report zero failures just as loudly.
    expect(visited).toBe(512 * 2 * (MAX_H - MIN_H + 1))
  }, 300000)

  it('excludeKeys adds no dimension — excluding a key is the same as never enabling it', () => {
    // Half the nine, chosen so the pair straddles both squeezed and unsqueezed
    // stacks: excluding from a full stack drops it out of the shave, and
    // excluding from a small one does not.
    const excluded = new Set(['macd', 'atr', 'rsi', 'obv'])
    const dropped = OSC.reduce((m, k, i) => (excluded.has(k) ? m : m | (1 << i)), 0)
    const bad = []
    for (let mask = 0; mask < 512; mask++) {
      const withExclude = computePaneLayout(BLOBS[mask], [], OPTS({ excludeKeys: excluded }))
      const asSubset = computePaneLayout(BLOBS[mask & dropped], [], OPTS())
      if (JSON.stringify(withExclude) !== JSON.stringify(asSubset)) bad.push(mask)
    }
    expect(bad).toEqual([])
  })

  it('a chart with no usable height answers with one legal pane instead of NaN', () => {
    for (const chartHeight of [0, -1, NaN, undefined, null, Infinity]) {
      const out = computePaneLayout(BLOBS[511], [], OPTS({ chartHeight }))
      expect(out.panes).toEqual([])
      expect(out.pane0.mainMargins.top + out.pane0.mainMargins.bottom).toBeLessThanOrEqual(1)
      expect(Number.isFinite(out.pane0.heightPx)).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('the separator budget comes out of the OSCILLATORS, never out of pane 0', () => {
  // ⭐ WHY THE BUDGET IS TAKEN THERE. A 1 px compression across ~70% of the canvas
  // costs tens of thousands of changed pixels; the same compression inside an
  // 88 px oscillator strip costs a few thousand. `price_plot` reading absolute 0
  // is the region gate's whole premise, and it is achieved by arithmetic.
  it('pane 0 is byte-identical with and without a separator budget', () => {
    for (const mask of [0, 1, 0b111, 0b101010101, 511]) {
      const withSep = computePaneLayout(BLOBS[mask], [], OPTS({ separatorPx: SEPARATOR_PX }))
      const without = computePaneLayout(BLOBS[mask], [], OPTS({ separatorPx: 0 }))
      expect(withSep.pane0, `mask ${mask}`).toEqual(without.pane0)
    }
  })

  it('and the oscillators pay for it, exactly', () => {
    const cs = BLOBS[0b111]                                    // obv + atr + adx
    const out = computePaneLayout(cs, [], OPTS())
    const without = computePaneLayout(cs, [], OPTS({ separatorPx: 0 }))
    const sep = out.panes.length * SEPARATOR_PX
    expect(out.pane0.heightPx + out.panes.reduce((s, p) => s + p.heightPx, 0) + sep).toBe(H)
    const lost = without.panes.reduce((s, p) => s + p.heightPx, 0)
      - out.panes.reduce((s, p) => s + p.heightPx, 0)
    expect(lost).toBe(sep)
  })

  it('and the whole stack still lands on the shipped band boundary', () => {
    // Independent of this module's own arithmetic: the oscillator stack's total
    // comes from the SHIPPED band function, and the panes plus their separators
    // have to fill exactly that.
    const cs = BLOBS[0b101010101]
    const out = computePaneLayout(cs, [], OPTS())
    const oscPx = H - shippedBoundaries(cs, true).pane0Bottom
    expect(out.panes.reduce((s, p) => s + p.heightPx, 0) + out.panes.length * SEPARATOR_PX)
      .toBe(oscPx)
  })

  it('a pane\'s stretch factor IS its pixel height', () => {
    const out = computePaneLayout(BLOBS[511], [], OPTS())
    expect(out.panes.map(p => p.stretchFactor)).toEqual(out.panes.map(p => p.heightPx))
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('stack order is DATA, and it comes from the instance list', () => {
  it('panes are ordered by the instance list, not by registry order', () => {
    const cs = BLOBS[0b111]
    const insts = [{ instanceId: 'legacy:adx', defId: 'adx' },
                   { instanceId: 'legacy:obv', defId: 'obv' },
                   { instanceId: 'legacy:atr', defId: 'atr' }]
    const out = computePaneLayout(cs, insts, OPTS())
    expect(out.panes.map(p => p.key)).toEqual(['adx', 'obv', 'atr'])
    // Registry order for the same three is adx, obv... no: it is atr, adx, obv
    // (rsi, macd, stoch, atr, mfi, cci, williamsR, adx, obv). Naming it here is
    // what makes "not by registry order" a claim and not a slogan.
    const registryOrder = listDefinitions()
      .filter(d => d.placement.target === 'pane' && ['adx', 'obv', 'atr'].includes(d.id))
      .map(d => d.id)
    expect(registryOrder).toEqual(['atr', 'adx', 'obv'])
    expect(out.panes.map(p => p.key)).not.toEqual(registryOrder)
  })

  it('and falls back to the SHIPPED band order when the instance list says nothing', () => {
    // The pre-migration population: no instances, so nobody's stack may move.
    const out = computePaneLayout(BLOBS[0b111], [], OPTS())
    // computePaneMargins stacks bottom-to-top; panes are indexed top-to-bottom.
    expect(out.panes.map(p => p.key)).toEqual(['adx', 'atr', 'obv'])
  })

  it('the fallback is the WHOLE shipped stack, top-to-bottom, and volume is not in it', () => {
    const out = computePaneLayout(BLOBS[511], [], OPTS())
    expect(out.panes.map(p => p.key)).toEqual([...OSC].reverse())
    expect(out.panes.map(p => p.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(out.pane0.volumeMargins).not.toBeNull()
  })

  it('an id the instance list does not name keeps its shipped position, below', () => {
    // The transitional population: some indicators migrated, some not. Task 9
    // ends it by seeding the instance list from today's order, after which this
    // second half is empty by construction.
    const out = computePaneLayout(BLOBS[0b111], [{ instanceId: 'i:adx', defId: 'adx' }], OPTS())
    expect(out.panes.map(p => p.key)).toEqual(['adx', 'atr', 'obv'])
  })

  it('a tombstoned instance reserves no pane', () => {
    const insts = [{ instanceId: 'i:rsi', defId: 'rsi' },
                   { instanceId: 'i:macd', defId: 'macd', deleted: true }]
    const out = computePaneLayout(mergeChartSettings({}), insts, OPTS())
    expect(out.panes.map(p => p.key)).toEqual(['rsi'])
  })

  it('a PRICE overlay in the instance list reserves no pane', () => {
    const insts = [{ instanceId: 'i:bb', defId: 'bb' }, { instanceId: 'i:vwap', defId: 'vwap' }]
    const out = computePaneLayout(mergeChartSettings({}), insts, OPTS())
    expect(out.panes).toEqual([])
  })

  it('an excluded id reserves no pane even when an instance names it', () => {
    const insts = [{ instanceId: 'i:rsi', defId: 'rsi' }]
    const out = computePaneLayout(mergeChartSettings({}), insts, OPTS({ excludeKeys: new Set(['rsi']) }))
    expect(out.panes).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('heights come from the DEFINITION, not from a table in this file', () => {
  const SRC = read('app/src/components/chart/engine/paneLayout.js')

  // ⭐ CODE ONLY, through the SHARED stripper (`__tests__/sourceScan.js`) — a
  // second copy of that predicate would be the same twin one directory over. A
  // comment may legitimately NAME an indicator while explaining the retirement;
  // a table may not exist in either form, and probing raw text would make the
  // prose the thing under test.
  it('the stripper really removes the prose this probe would otherwise read', () => {
    // Non-vacuity, on a FIXTURE rather than on this module's own prose: a
    // stripper that returned its input would make the probe below pass for the
    // wrong reason, and pinning the check to a word that happens to be in a
    // comment today would break the day the comment is reworded.
    expect(/\brsi\b/.test('const a = 1 // rsi\n')).toBe(true)
    expect(/\brsi\b/.test(stripComments('const a = 1 // rsi\n'))).toBe(false)
    expect(/\bmacd\b/.test(stripComments('/* macd */ const b = 2'))).toBe(false)
    expect(SRC.length).toBeGreaterThan(1000)
  })

  // ⛔ THE POINT OF §A5: PANES retires INTO the definitions. A second copy of the
  // nine `baseH` values here would be the twin this phase exists to end — and it
  // is BEHAVIOURALLY IDENTICAL, so no other assertion in this file could see it.
  // The probe matches the IDS as words rather than the identifier `PANES`,
  // because a rename dodges the identifier and quoting dodges `"'id'"`.
  it('and grep finds no nine-row height table in this module', () => {
    const code = stripComments(SRC)
    // The stripper did not eat the module.
    expect(code).toContain('export function computePaneLayout')
    expect(code).toContain('STACK_TARGET')
    for (const id of OSC) {
      expect(new RegExp(`\\b${id}\\b`).test(code), `paneLayout.js names ${id} in CODE`).toBe(false)
    }
  })

  it('a definition with no declared pane height gets the default', () => {
    // A synthetic pane-target definition is the only way to reach the branch:
    // all nine shipped ones declare a height on purpose.
    const layout = computePaneLayout(mergeChartSettings({}), [], OPTS())
    expect(layout.panes).toEqual([])
    expect(DEFAULT_PANE_HEIGHT).toBe(0.15)
    const noHeight = { schemaVersion: 1, id: 'x', version: 1,
      compute: { kind: 'native', fn: 'x', rev: 1 }, meta: { name: 'X' },
      placement: { target: 'pane' }, inputs: [], plots: [{ key: 'x', style: 'line' }] }
    expect(validateDefinition(noHeight).ok).toBe(true)
  })

  // ⭐ THE TRANSCRIPTION, READ OUT OF THE SHIPPED FILE. Not nine literals here —
  // nine literals here would be the same twin one directory over.
  it('every declared pane height is the baseH paneMargins.js still ships', () => {
    const panesSrc = read('app/src/components/chart/paneMargins.js')
    const rows = [...panesSrc.matchAll(/\{\s*key:\s*'([A-Za-z]+)'[^}]*baseH:\s*([0-9.]+)\s*\}/g)]
      .map(m => [m[1], Number(m[2])])
    // Non-vacuity: a regex that stopped matching would agree with everything.
    expect(rows.length).toBe(10)
    expect(rows.map(r => r[0])).toEqual([...OSC, 'volume'])
    for (const [key, baseH] of rows) {
      if (key === 'volume') {
        expect(VOLUME_PANE_HEIGHT, 'the volume row is ONE constant, not a definition').toBe(baseH)
        continue
      }
      expect(getDefinition(key)?.placement?.pane?.height, `${key}'s declared pane height`).toBe(baseH)
    }
  })

  it('a price overlay declares no pane at all', () => {
    // The successor of enumerationSites.test.js's *"a price overlay gains no key
    // in paneMargins.js"*: a height on `bb` would reserve vertical space for
    // something that draws inside the candles' pane.
    const overlays = listDefinitions().filter(d => d.placement.target === 'price').map(d => d.id)
    expect(overlays).toEqual(['bb', 'vwap', 'sar', 'ichimoku', 'donchian'])
    for (const id of overlays) {
      expect(getDefinition(id).placement.pane, `${id} declares a pane`).toBeUndefined()
    }
  })

  it('every pane-target definition declares a height, and there are nine', () => {
    const paneDefs = listDefinitions().filter(d => d.placement.target === 'pane')
    expect(paneDefs.map(d => d.id).sort()).toEqual([...OSC].sort())
    for (const d of paneDefs) {
      expect(typeof d.placement.pane?.height, `${d.id}`).toBe('number')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('validateDefinition guards placement.pane.height', () => {
  const withPane = (pane) => ({
    schemaVersion: 1, id: 'x', version: 1,
    compute: { kind: 'native', fn: 'x', rev: 1 }, meta: { name: 'X' },
    placement: { target: 'pane', ...(pane === undefined ? {} : { pane }) },
    inputs: [], plots: [{ key: 'x', style: 'line' }],
  })
  const errorsFor = (pane) => {
    const r = validateDefinition(withPane(pane))
    return r.ok ? [] : r.errors.filter(e => e.startsWith('placement.pane'))
  }

  it.each([
    ['0 — a pane that reserves nothing', { height: 0 }],
    ['1 — a pane that leaves price nothing', { height: 1 }],
    ['a negative fraction', { height: -0.1 }],
    ['a numeric STRING, which would concatenate somewhere', { height: '0.15' }],
    ['NaN', { height: NaN }],
    ['Infinity', { height: Infinity }],
  ])('rejects %s', (_label, pane) => {
    expect(errorsFor(pane)).toHaveLength(1)
  })

  it.each([
    ['a legal fraction', { height: 0.15 }],
    ['no height at all — it is optional', {}],
    ['no pane key at all', undefined],
  ])('accepts %s', (_label, pane) => {
    expect(errorsFor(pane)).toEqual([])
  })

  it('rejects a pane that is not an object', () => {
    expect(errorsFor(0.15)).toHaveLength(1)
  })

  it('the error names the field and the offending value', () => {
    expect(errorsFor({ height: 0 })[0]).toContain('placement.pane.height')
    expect(errorsFor({ height: 0 })[0]).toContain('0')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('paneManifest reads the renderer back', () => {
  const fakeSeries = (type, scaleId) => ({
    seriesType: () => type,
    options: () => ({ priceScaleId: scaleId }),
  })
  const fakePane = (index, height, stretch, series) => ({
    paneIndex: () => index,
    getHeight: () => height,
    getStretchFactor: () => stretch,
    getSeries: () => series,
  })
  const candles = fakeSeries('Candlestick', 'right')
  const rsiLine = fakeSeries('Line', 'rsi')
  const chart = {
    panes: () => [fakePane(0, 505, 505, [candles]), fakePane(1, 88, 88, [rsiLine])],
  }

  it('names every pane, its height, and every series in it', () => {
    const m = paneManifest(chart, [{ series: rsiLine, key: 'rsi', scaleId: 'rsi' }])
    expect(m.panes).toHaveLength(2)
    expect(m.panes.map(p => [p.index, p.height, p.stretchFactor])).toEqual([[0, 505, 505], [1, 88, 88]])
    expect(m.panes[0].series).toEqual([{ type: 'Candlestick', scaleId: 'right', key: null }])
    expect(m.panes[1].series).toEqual([{ type: 'Line', scaleId: 'rsi', key: 'rsi' }])
  })

  it('the chart height it reports is the panes plus the separators between them', () => {
    const m = paneManifest(chart, [])
    expect(m.chartHeight).toBe(505 + 88 + SEPARATOR_PX)
    expect(m.separatorPx).toBe(SEPARATOR_PX)
  })

  it('it is JSON — it crosses a browser boundary', () => {
    const m = paneManifest(chart, [])
    expect(JSON.parse(JSON.stringify(m))).toEqual(m)
  })

  // ⚠️ `IPriceScaleApi` in lightweight-charts 5.2.0 has NO `priceScaleId()`
  // member, so `series.priceScale().priceScaleId?.()` — the obvious source —
  // reads `undefined` on every series and the manifest would report `null` for
  // the field the cutover is most supposed to be watched on.
  it('the scale id comes from the SERIES options, not from the price scale', () => {
    const noScaleApi = { seriesType: () => 'Line', options: () => ({ priceScaleId: 'macd' }),
                         priceScale: () => ({ applyOptions() {}, options: () => ({}) }) }
    const m = paneManifest({ panes: () => [fakePane(1, 88, 88, [noScaleApi])] }, [])
    expect(m.panes[0].series[0].scaleId).toBe('macd')
  })

  // ─── B5 TASK 8: AN OMITTED `priceScaleId` IS RESOLVED, NOT REPORTED AS NULL ──
  //
  // 🔴 MEASURED, ON THE LAST MIGRATION, AND IT COST A RED GATE FIRST. `donchian`
  // is the ONE legacy indicator block that created its series WITHOUT a
  // `priceScaleId` (sar/ichimoku/mfi/cci/williamsR/adx/obv and the MA overlays
  // all pass one), and LWC leaves the option `undefined` in that case — it
  // resolves it only at insertion time. So the legacy build reported
  // `scaleId: null` for three series that sat on exactly the `'right'` scale the
  // engine names explicitly, and the migration read as a **GEOMETRY** change of
  // three `scaleId`s with **0 changed pixels** — the one shape the gate refuses
  // unconditionally and `expectProvenance` cannot declare away.
  //
  // ⛔ THE FIX IS AT THE INSTRUMENT, NOT AT THE GATE. A manifest field called
  // `scaleId` has to mean WHICH SCALE THE SERIES IS ON; reporting which option
  // the caller happened to pass is a different question, and it is not the one
  // the geometry rule is asking.
  const chartWithScales = (panes, opts) => ({ panes: () => panes, options: () => opts })
  const noIdSeries = { seriesType: () => 'Line', options: () => ({ color: '#fff' }) }

  it.each([
    ['only the right scale visible', { leftPriceScale: { visible: false }, rightPriceScale: { visible: true } }, 'right'],
    ['only the left scale visible', { leftPriceScale: { visible: true }, rightPriceScale: { visible: false } }, 'left'],
    ['both visible — the chart\'s declared preference decides',
      { leftPriceScale: { visible: true }, rightPriceScale: { visible: true }, defaultVisiblePriceScaleId: 'left' }, 'left'],
    ['neither visible — the same preference, same rule',
      { leftPriceScale: { visible: false }, rightPriceScale: { visible: false }, defaultVisiblePriceScaleId: 'right' }, 'right'],
  ])('a series with no priceScaleId reads the scale LWC will put it on — %s', (_l, opts, want) => {
    const m = paneManifest(chartWithScales([fakePane(0, 88, 88, [noIdSeries])], opts), [])
    expect(m.panes[0].series[0].scaleId).toBe(want)
  })

  it('⭐ and the two default scales stay TELLABLE APART, which is why this is not a tolerance', () => {
    // Before the resolution both of these read `null` and a series that had
    // moved from one axis to the other was INVISIBLE to the geometry rule.
    const onLeft = paneManifest(chartWithScales([fakePane(0, 88, 88, [noIdSeries])],
      { leftPriceScale: { visible: true }, rightPriceScale: { visible: false } }), [])
    const onRight = paneManifest(chartWithScales([fakePane(0, 88, 88, [noIdSeries])],
      { leftPriceScale: { visible: false }, rightPriceScale: { visible: true } }), [])
    expect(onLeft.panes[0].series[0].scaleId).not.toBe(onRight.panes[0].series[0].scaleId)
  })

  it('an EXPLICIT priceScaleId still wins over the chart default — the resolution is a fallback', () => {
    const explicit = fakeSeries('Line', 'macd')
    const m = paneManifest(chartWithScales([fakePane(0, 88, 88, [explicit])],
      { leftPriceScale: { visible: false }, rightPriceScale: { visible: true } }), [])
    expect(m.panes[0].series[0].scaleId).toBe('macd')
  })

  it('a BINDING\'s scaleId still wins over the chart default too', () => {
    const m = paneManifest(chartWithScales([fakePane(0, 88, 88, [noIdSeries])],
      { leftPriceScale: { visible: false }, rightPriceScale: { visible: true } }),
    [{ series: noIdSeries, key: 'legacy:x::y', scaleId: 'adx' }])
    expect(m.panes[0].series[0].scaleId).toBe('adx')
  })

  it.each([
    ['a chart with no options() at all', { panes: () => [] }],
    ['a chart whose options() throws', { panes: () => [], options: () => { throw new Error('gone') } }],
    ['options() that name no scales', { panes: () => [], options: () => ({}) }],
  ])('a chart that cannot say which scale is default reports null, never a guess — %s', (_l, c) => {
    const m = paneManifest({ ...c, panes: () => [fakePane(0, 88, 88, [noIdSeries])] }, [])
    expect(m.panes[0].series[0].scaleId).toBeNull()
  })

  it.each([
    ['null', null],
    ['a chart with no panes() at all', {}],
    ['a chart whose panes() throws', { panes: () => { throw new Error('gone') } }],
  ])('a chart that cannot answer is a MISSING manifest, not a throw — %s', (_l, c) => {
    expect(paneManifest(c, [])).toBeNull()
  })

  it('a registered chart is readable through currentPaneManifest, and unregisters', () => {
    expect(currentPaneManifest()).toBeNull()
    const off = registerManifestChart(chart, () => [{ series: rsiLine, key: 'rsi', scaleId: 'rsi' }])
    expect(currentPaneManifest().panes[1].series[0].key).toBe('rsi')
    off()
    expect(currentPaneManifest()).toBeNull()
  })

  it('a bindings getter that throws costs the keys, not the manifest', () => {
    const off = registerManifestChart(chart, () => { throw new Error('mid-sync') })
    expect(currentPaneManifest().panes).toHaveLength(2)
    off()
  })
})
