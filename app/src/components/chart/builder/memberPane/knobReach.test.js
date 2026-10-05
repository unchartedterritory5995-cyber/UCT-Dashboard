// app/src/components/chart/builder/memberPane/knobReach.test.js
//
// ─── ⭐⭐ H10 — A KNOB REACHES EVERY USE OF ITS INPUT, OR IT IS NOT OFFERED ────
//
// The oracle in every case is the translator at the knob's new value
// (`inputValues`, a moved `input.*` on TradingView). An offered knob's edit must
// equal it; a knob whose edit would not is absent from `compute.paramManifest`
// and named in the document's disclosures. See `knobReach.js`.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from '../../engine/ast/pine'
import { memberInputTranslation } from '../builderInputs'
import { applyParamEdit } from '../paramEdit'
import { inspectSource, inspectPine, paramPlacementsOf } from '../PineBox.jsx'
import { memberPaneDefinition, memberTranslationOpts } from './memberPaneDefinition'
import { comparableDocument, knobReachProbeValue, REACH } from './knobReach'

const CORPUS = path.resolve(process.cwd(), '..', 'corpus', 'committed')
const corpus = (slug) => {
  const f = fs.readdirSync(CORPUS).find((x) => x.split('__')[0] === slug)
  return fs.readFileSync(path.join(CORPUS, f), 'utf8')
}
const ID = 'u_h10knobreach'
const build = (source) => memberPaneDefinition({ source, id: ID })
const manifestOf = (b) => (b.definition.compute || {}).paramManifest || {}
const bySource = (b, name) => Object.entries(manifestOf(b)).find(([, e]) => e.sourceName === name)
const lockNote = (b, title) => (b.notes || []).find((n) => n.name === title
  && /is not offered as an adjustable setting here: /.test(n.note))

/** The edit at `v` against the script translated at `v`. */
function reaches(source, base, id, v) {
  const entry = manifestOf(base)[id]
  const edited = applyParamEdit(base.definition, id, v)
  expect(edited.ok, edited.error).toBe(true)
  const t = memberInputTranslation(translatePine, source, memberTranslationOpts({ [entry.sourceName]: v }))
  const oracle = memberPaneDefinition({ source, id: ID, translation: t })
  expect(oracle.ok, oracle.reason).toBe(true)
  return JSON.stringify(comparableDocument(edited.definition)) === JSON.stringify(comparableDocument(oracle.definition))
}

describe('⭐⭐ H10 — knob reach (member door)', () => {
  it('⛔ pivot-high-low-points: `lb` (also `high[lb]` and `highestbars(lb + rb + 1)`) is NOT offered, by name', () => {
    const src = corpus('pivot-high-low-points')
    const b = build(src)
    expect(b.ok, b.reason).toBe(true)
    expect(bySource(b, 'lb')).toBeUndefined()
    expect(bySource(b, 'rb')).toBeUndefined()
    const n = lockNote(b, 'Left Bars')
    expect(n, JSON.stringify(b.notes)).toBeDefined()
    expect(n.note).toContain(REACH.fold)
    expect(n.note).toContain("script's value (5)")
    // ⭐ and it rides on the saved document
    expect(b.definition.meta.disclosures.some((d) => d.name === 'Left Bars' && d.note === n.note)).toBe(true)
  })

  it('⛔ a history offset: `close[len]` beside `sma(close, len)` locks `len` (synthetic)', () => {
    const src = `//@version=5
indicator("h10 offset")
len = input.int(10, "Len")
plot(ta.sma(close, len) - close[len], "S")
`
    const b = build(src)
    expect(b.ok, b.reason).toBe(true)
    expect(bySource(b, 'len')).toBeUndefined()
    expect(lockNote(b, 'Len').note).toContain(REACH.fold)
  })

  it('⛔ a folded window alone: `highest(high, len + 1)` is 11 -> 12, a number no (default, probe) pair names — each knob is then asked on its own', () => {
    const src = `//@version=5
indicator("h10 fold")
len = input.int(10, "Len")
n = input.int(5, "N")
plot(ta.highest(high, len + 1) - ta.sma(close, len), "S")
plot(ta.ema(close, n), "E")
`
    const b = build(src)
    expect(b.ok, b.reason).toBe(true)
    expect(bySource(b, 'len')).toBeUndefined()
    expect(lockNote(b, 'Len').note).toContain(REACH.fold)
    // ⭐ the other knob is untouched by it, and reaches
    const n = bySource(b, 'n')
    expect(n, JSON.stringify(b.notes)).toBeDefined()
    expect(reaches(src, b, n[0], 9)).toBe(true)
  })

  it('⭐ CONTROL: an input used only where a locator reaches stays offered, and its edit IS the re-translation', () => {
    const src = `//@version=5
indicator("h10 reach")
len = input.int(10, "Len")
plot(ta.sma(close, len), "A")
plot(ta.ema(close, len), "B")
`
    const b = build(src)
    const hit = bySource(b, 'len')
    expect(hit, JSON.stringify(b.notes)).toBeDefined()
    expect(lockNote(b, 'Len')).toBeUndefined()
    expect(reaches(src, b, hit[0], 11)).toBe(true)
    expect(reaches(src, b, hit[0], 25)).toBe(true)
  })

  it('⛔ a drawing: atr-bands `atrPeriod` also sets its drawing program, so it is not offered', () => {
    const b = build(corpus('atr-bands'))
    expect(b.ok, b.reason).toBe(true)
    const hit = Object.values((b.translation && b.translation.inputParams) || []).find((p) => p.sourceName === 'atrPeriod')
    expect(hit).toBeDefined()
    expect(bySource(b, 'atrPeriod')).toBeUndefined()
    expect(lockNote(b, hit.title).note).toContain(REACH.drawings)
  })

  it('⭐ the corpus: every knob still offered on these scripts reaches every use (the oracle, at a probe value)', () => {
    let offered = 0
    for (const slug of ['pivot-high-low-points', 'keltner-channels-bands', 'atr-bands', 'rvol',
      'donchian-channels', 'macd-shortlong-strategy-for-tradingview-input-optimizer']) {
      const src = corpus(slug)
      const b = build(src)
      expect(b.ok, `${slug}: ${b.reason}`).toBe(true)
      for (const [id, entry] of Object.entries(manifestOf(b))) {
        const v = knobReachProbeValue(entry)
        if (v === null) continue
        offered += 1
        expect(reaches(src, b, id, v), `${slug} ${entry.sourceName} -> ${v}`).toBe(true)
      }
    }
    expect(offered).toBeGreaterThan(0) // non-vacuity: keltner's `alen` reaches
  })
})

describe('⭐⭐ H10 — knob reach (paste door, PineBox)', () => {
  it('⛔ the same lock: pivot-high-low-points `lb` is never placed, and the report says why', () => {
    const report = inspectSource(corpus('pivot-high-low-points'), 'pine')
    const lb = (report.inputParams || []).find((p) => p.sourceName === 'lb')
    expect(lb).toBeDefined()
    const lock = (report.knobLocks || []).find((k) => k.id === lb.id)
    expect(lock, JSON.stringify(report.knobLocks)).toBeDefined()
    expect(lock.note).toContain(REACH.fold)
    // ⛔ and never placed: no output carries a locator for it
    const placed = (paramPlacementsOf(report) || []).flat()
    expect(placed.some((l) => l.id === lb.id)).toBe(false)
    // non-vacuity: without the lock the comparator's literal IS placed
    const unlocked = (paramPlacementsOf({ ...report, knobLocks: [] }) || []).flat()
    expect(unlocked.some((l) => l.id === lb.id)).toBe(true)
  })

  it('⛔ inspectPine (the Pine-only door) carries the same locks', () => {
    const report = inspectPine(corpus('pivot-high-low-points'))
    const lb = (report.inputParams || []).find((p) => p.sourceName === 'lb')
    expect((report.knobLocks || []).some((k) => k.id === lb.id)).toBe(true)
  })
})
