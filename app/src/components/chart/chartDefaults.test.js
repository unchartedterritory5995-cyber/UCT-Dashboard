import { describe, it, expect } from 'vitest'
import { mergeChartSettings, CHART_DEFAULTS } from './chartDefaults'
// The real array the settings panel renders its rows from — imported, never
// mirrored, so a key renamed on the toolbar side fails here instead of shipping
// a checkbox that ticks and does nothing.
import { SIGNATURE_ROWS } from './signatureToggles'
// The read side: the keys the fetch hook actually indexes the settings blob by.
import { SIGNATURE_TOGGLE } from '../../hooks/useSignatureIndicators'

describe('watermark settings', () => {
  it('default watermark has lines/color/sizeScale/x/y', () => {
    expect(CHART_DEFAULTS.watermark).toEqual({
      visible: true, opacity: 0.07, color: '#a8a290', sizeScale: 1.0,
      lines: { ticker: true, company: true, sector: true, industry: true, theme: true },
      x: 0.5, y: 0.5,
    })
  })

  it('merges partial user watermark over defaults (back-compat with {visible,opacity}-only)', () => {
    const cs = mergeChartSettings(JSON.stringify({ watermark: { visible: false, opacity: 0.12 } }))
    expect(cs.watermark.visible).toBe(false)
    expect(cs.watermark.opacity).toBe(0.12)
    expect(cs.watermark.color).toBe('#a8a290')
    expect(cs.watermark.lines).toEqual({ ticker: true, company: true, sector: true, industry: true, theme: true })
    expect(cs.watermark.x).toBe(0.5)
  })

  it('deep-merges partial lines (user disables only ticker)', () => {
    const cs = mergeChartSettings(JSON.stringify({ watermark: { lines: { ticker: false } } }))
    expect(cs.watermark.lines).toEqual({ ticker: false, company: true, sector: true, industry: true, theme: true })
  })
})

describe('header per-item colors', () => {
  it('defaults to no colors set (every item keeps its built-in color)', () => {
    expect(CHART_DEFAULTS.header.colors).toEqual({})
    const cs = mergeChartSettings(JSON.stringify({}))
    expect(cs.header.colors).toEqual({})
  })

  it('preserves stored day-change up/down colors while keeping the show toggle', () => {
    const cs = mergeChartSettings(JSON.stringify({ header: { colors: { dayChangeUp: '#00ff00', dayChangeDown: '#ff0000' } } }))
    expect(cs.header.colors.dayChangeUp).toBe('#00ff00')
    expect(cs.header.colors.dayChangeDown).toBe('#ff0000')
    expect(cs.header.showChange).toBe(true)   // untouched sibling
  })

  it('a partial colors blob does NOT wipe unset keys (the mergeChartSettings wholesale-replace trap)', () => {
    // header is spread as one object, so without the dedicated colors deep-merge a
    // stored {marketCap} would drop the rest — this pins that it stays a real merge.
    const cs = mergeChartSettings(JSON.stringify({
      header: { colors: { marketCap: '#111111', legend: '#222222' } },
    }))
    expect(cs.header.colors).toEqual({ marketCap: '#111111', legend: '#222222' })
    // and the other header fields survive the colors-only save
    expect(cs.header.timeframes).toEqual(CHART_DEFAULTS.header.timeframes)
    expect(cs.header.showLegend).toBe(true)
  })
})

describe('signature indicator toggles', () => {
  // mergeChartSettings' return object is a hard ALLOW-LIST: a key it doesn't
  // re-emit is silently destroyed on every read. These pin the merge line, not
  // just the default.
  it('signature toggles survive a merge round-trip', () => {
    const merged = mergeChartSettings(JSON.stringify({ signature: { darkPoolLevels: true } }))
    expect(merged.signature.darkPoolLevels).toBe(true)
    expect(merged.signature.gexWalls).toBe(false)   // default fills in
  })

  it('signature defaults exist and are off', () => {
    const merged = mergeChartSettings(null)
    expect(merged.signature).toEqual({ darkPoolLevels: false, gexWalls: false, flowSignals: false })
  })

  // ── The three-way key contract ───────────────────────────────────────────
  // WRITE side: the toolbar's `update('signature.<key>', bool)` rows.
  // STORE side: CHART_DEFAULTS.signature.
  // READ side:  SIGNATURE_TOGGLE, which the fetch hook indexes cfg by.
  //
  // A mismatch fails SILENTLY, which is exactly why it needs a test. The
  // `signature` merge is a SPREAD, not a per-key allow-list, so a mistyped
  // toolbar key persists happily — the checkbox ticks, the save round-trips,
  // and the indicator just never draws, because the hook read a different key.
  // Nothing throws and nothing logs. These pin all three sets together.

  it('every key the toolbar toggles is a key CHART_DEFAULTS.signature declares', () => {
    const declared = Object.keys(CHART_DEFAULTS.signature)
    const toolbarKeys = SIGNATURE_ROWS.map(([key]) => key)

    expect(toolbarKeys.length).toBeGreaterThan(0)          // never pass vacuously
    expect(new Set(toolbarKeys).size).toBe(toolbarKeys.length)  // no duplicate rows
    for (const key of toolbarKeys) expect(declared).toContain(key)
  })

  it('the toolbar writes exactly the keys the fetch hook reads', () => {
    // The one that catches a dead toggle: a row whose key the hook never looks
    // at is a checkbox that does nothing at all, with no error to notice.
    expect(new Set(SIGNATURE_ROWS.map(([key]) => key)))
      .toEqual(new Set(Object.values(SIGNATURE_TOGGLE)))
  })

  it('each toolbar row survives the same merge its update() write lands in', () => {
    // Walks every rendered row through the real persistence path, so the gate
    // covers the round-trip and not just the key spelling.
    for (const [key] of SIGNATURE_ROWS) {
      const merged = mergeChartSettings(JSON.stringify({ signature: { [key]: true } }))
      expect(merged.signature[key]).toBe(true)
    }
  })

  it('every declared signature key has a toolbar row (no unreachable indicator)', () => {
    // The reverse direction: an indicator shipped into the defaults with no
    // toggle is invisible to users. If a future signature key is deliberately
    // NOT user-toggleable, loosen THIS test — never the subset gate above.
    const toolbarKeys = new Set(SIGNATURE_ROWS.map(([key]) => key))
    for (const key of Object.keys(CHART_DEFAULTS.signature)) {
      expect(toolbarKeys).toContain(key)
    }
  })

  it('each toolbar row carries a label and a tooltip', () => {
    for (const [key, label, tip] of SIGNATURE_ROWS) {
      expect(typeof label).toBe('string')
      expect(label.trim().length, `${key} label`).toBeGreaterThan(0)
      expect(typeof tip).toBe('string')
      expect(tip.trim().length, `${key} tooltip`).toBeGreaterThan(0)
    }
  })
})
