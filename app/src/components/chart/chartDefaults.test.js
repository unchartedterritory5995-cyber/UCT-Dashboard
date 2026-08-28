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
      visible: true, opacity: 0.07, color: '#a8a290', sizeScale: 1.25, weight: 500,
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

  it('mergeChartSettings keeps merging the signature section at all', () => {
    // NOT drift coverage — be clear about what this does and doesn't buy. The
    // merge SPREADS `signature`, so any key round-trips and a renamed toolbar
    // key sails straight through here (verified: this case stays green under a
    // WRITE-side key mutation). The two gates above are what catch drift.
    //
    // What this DOES guard is the section vanishing from the merge's return —
    // drop the `signature:` line from mergeChartSettings and every row below
    // reads undefined. That is the regression this case exists for.
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

describe('engine settings passthrough (settingsVersion + indicatorInstances)', () => {
  // Same allow-list hazard as `signature` above, landed BEFORE any writer
  // exists: mergeChartSettings' return is an explicit key list, so a key it
  // does not name is silently destroyed on every read-merge-write cycle. These
  // pin the merge lines, not just the defaults.
  it('settingsVersion and indicatorInstances survive a merge round-trip', () => {
    const merged = mergeChartSettings(JSON.stringify({
      settingsVersion: 2,
      indicatorInstances: [{ instanceId: 'a1', defId: 'rsi', inputs: { period: 7 } }],
    }))
    expect(merged.settingsVersion).toBe(2)
    expect(merged.indicatorInstances).toHaveLength(1)
    expect(merged.indicatorInstances[0]).toEqual({ instanceId: 'a1', defId: 'rsi', inputs: { period: 7 } })
  })

  it('defaults them when absent — engine state starts empty, not undefined', () => {
    const merged = mergeChartSettings(null)
    // ⭐ B5 TASK 9: version 2. The blob stops enumerating indicators, and the
    // READ is what heals — so what comes out is the current version whatever
    // went in, and a fresh blob starts there.
    expect(merged.settingsVersion).toBe(2)
    expect(merged.indicatorInstances).toEqual([])
  })

  it('⭐ …and the version is what comes OUT, not what went in — the read heals', () => {
    // The R2 hazard, asserted directly: a preset (or an older tab) writing
    // `settingsVersion: 1` must not make the fold re-run on every load and
    // re-seed instances the user has since deleted. Whatever the blob claims,
    // the answer is the current version.
    for (const stored of [undefined, 0, 1, 2, 99, 'two', null]) {
      const merged = mergeChartSettings(JSON.stringify({ settingsVersion: stored }))
      expect(merged.settingsVersion, `stored settingsVersion: ${JSON.stringify(stored)}`).toBe(2)
    }
  })

  it('a non-array indicatorInstances is coerced, never trusted', () => {
    const merged = mergeChartSettings(JSON.stringify({ indicatorInstances: { nope: true } }))
    expect(merged.indicatorInstances).toEqual([])
  })

  // ─── engineEnabled — DELETED AT B5 TASK 4, AND THE CASES ARE INVERTED ──────
  //
  // ⭐ THREE CASES STOOD HERE AND THEY ASSERTED THE MERGE RULE ITSELF: *defaults
  // OFF — the engine lands dark*, *survives the merge when explicitly true*, and
  // *only a boolean true enables it*. The record's §9 named them as three of the
  // six things that would go red the day the flag moved, and they did.
  //
  // They are inverted rather than deleted, because "the tests are gone" and "the
  // key is gone" look identical in a green suite. `mergeChartSettings`' return is
  // a hard ALLOW-LIST, so the whole of the old behaviour collapses into one
  // sentence: whatever the blob says, the key is not emitted.
  //
  // Record: `docs/decisions/2026-08-04-engine-enabled-deleted.md`.
  it('engineEnabled is not declared — a default flip is not even available', () => {
    expect(Object.prototype.hasOwnProperty.call(CHART_DEFAULTS, 'engineEnabled')).toBe(false)
    expect('engineEnabled' in mergeChartSettings(null)).toBe(false)
  })

  it('engineEnabled does NOT survive the merge, even when explicitly true', () => {
    const merged = mergeChartSettings(JSON.stringify({ engineEnabled: true }))
    expect('engineEnabled' in merged).toBe(false)
    // …and the surrounding blob is otherwise intact, so this is the allow-list
    // dropping ONE key and not the merge failing.
    expect(merged.settingsVersion).toBe(2)
    expect(merged.indicatorInstances).toEqual([])
  })

  it('every stored value of it is destroyed alike — true, false and the impostors', () => {
    // The old rule distinguished a boolean `true` from "a `1` out of a URL param,
    // a leftover string, a stray object", because the flag decided whether a whole
    // second render path ran. There is no path and no flag: the allow-list treats
    // all of these the way it treats any key nobody declared.
    for (const value of [true, false, '1', 1, 'true', 'false', {}, [], 'yes']) {
      const merged = mergeChartSettings(JSON.stringify({ engineEnabled: value }))
      expect('engineEnabled' in merged, `engineEnabled: ${JSON.stringify(value)}`).toBe(false)
    }
  })
})
