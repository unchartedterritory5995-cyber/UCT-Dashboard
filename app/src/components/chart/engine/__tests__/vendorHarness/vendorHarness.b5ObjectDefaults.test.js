// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.b5ObjectDefaults.test.js
//
// ─── LEGACY SEMANTICS (B5) — AN OBJECT'S DEFAULT COLOUR IS A NAME, AT THE SCRIPT'S VERSION ─────
//
// `inside-bar-boxes-rddt-1d-2026-11-14` (committed; //@version=4; every `box.new` sets `bgcolor` and
// leaves `border_color` unset): TradingView draws all 52 borders in v4's `color.blue`, `#2196F3`. We
// drew `#2962FF` (v5/v6 blue), on both lanes, because `OBJECT_DEFAULTS` spelled the default as a hex.
// Now every default colour is a Pine colour NAME (`objectDefaults.js::NAMED_OBJECT_DEFAULTS`) resolved
// through the one palette (`pinePalette.js`) at the version — no second table.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { loadCapture, gradeCapture } from './harness'
import { censusOf } from './colourColumn'
import { objectDefaultsFor, OBJECT_DEFAULTS } from '../../objectRenderState'
import { NAMED_OBJECT_DEFAULTS, namedObjectDefaults } from '../../objectDefaults'
import { pineColourHex } from '../../pinePalette'

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

const REPO = path.resolve(process.cwd(), '..')
const ID = 'inside-bar-boxes-rddt-1d-2026-11-14'
const cap = () => loadCapture(path.join(REPO, 'tests/fixtures/vendor/harness', `${ID}.json`)).capture
/** TradingView's packed colour (0xAABBGGRR) as `#rrggbb` + alpha byte */
const decode = (c) => {
  const n = c >>> 0
  const hex = (v) => v.toString(16).padStart(2, '0')
  return { hex: `#${hex(n & 255)}${hex((n >>> 8) & 255)}${hex((n >>> 16) & 255)}`, alpha: (n >>> 24) & 255 }
}

describe('⭐⭐ B5 — the witness: a v4 box with no border_color is v4\'s color.blue', () => {
  it('the committed capture is what it says', () => {
    const c = cap()
    expect(c.source.text).toMatch(/^\/\/@version=4/m)
    expect(c.source.text).not.toMatch(/border_color/)
    const boxes = c.objects.records.boxes
    expect(boxes.length).toBe(52)
    for (const b of boxes) expect(decode(b.c)).toEqual({ hex: '#2196f3', alpha: 255 })
  })

  it('⭐ the defaults resolve the NAME at the version: v4 border #2196F3, v5/v6 #2962FF', () => {
    expect(objectDefaultsFor(4).box.border_color).toBe(pineColourHex('color.blue', 4))
    expect(objectDefaultsFor(4).box.border_color).toBe('#2196F3')
    expect(objectDefaultsFor(5).box.border_color).toBe('#2962FF')
    expect(objectDefaultsFor(6).box.border_color).toBe('#2962FF')
    expect(objectDefaultsFor(undefined).box.border_color).toBe('#2962FF')
    // the base keeps exactly the spellings it always carried (v6 / unstamped)
    expect(OBJECT_DEFAULTS.box.bgcolor).toBe('rgba(41,98,255,0.20)')
    expect(OBJECT_DEFAULTS.linefill.color).toBe('rgba(41,98,255,0.20)')
    expect(OBJECT_DEFAULTS.label.textcolor).toBe('#FFFFFF')
    // the witnessed per-version slots still win over the names (C37)
    expect(objectDefaultsFor(5).box.bgcolor).toBe('#2962FF')
    expect(objectDefaultsFor(4).label.textcolor).toBe('#363A45')
  })

  it('⛔ no default colour is a hex typed outside the palette: every one is a name it resolves', () => {
    for (const slots of Object.values(NAMED_OBJECT_DEFAULTS)) {
      for (const [name] of Object.values(slots)) expect(pineColourHex(name, 6), name).toMatch(/^#[0-9A-F]{6}$/i)
    }
    const src = fs.readFileSync(path.join(REPO, 'app/src/components/chart/engine/objectRenderState.js'), 'utf8')
    const block = src.slice(src.indexOf('export const OBJECT_DEFAULTS'), src.indexOf('const defaultsMemo'))
    expect(block).not.toMatch(/#[0-9A-Fa-f]{6}|rgba\(/)
    expect(namedObjectDefaults(4).box.bgcolor).toBe('rgba(33,150,243,0.20)')
  })

  // ⭐ DRAW-1 (2026-11-16, coordinator ruling) — this capture is the one whose box COUNT moved TradingView off
  // the C7 collector (52 held where C7 holds 50), so the runtime lane now withholds its boxes by name
  // (`objects:count-at-cap`, `objectPool.js` COUNT_AT_CAP_FAMILIES) and no border of it is drawn at all.
  // The border colour this rail witnessed (all 50 paired borders TradingView's v4 blue by default, before
  // the carve-out) stays witnessed by the defaults above; the runtime lane's border reading comes back
  // when vw-draw-count-at-cap (queue Q-DRAW-CAP-1/2) settles the count and the carve-out lifts.
  it('⭐⭐ the runtime lane (the lane that draws this script; the host lane refuses it `pine:reassign`): its boxes are withheld by name at the count, and no border is drawn in another colour', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    try {
      const { ours } = gradeCapture(cap())
      expect(ours && ours.ok, JSON.stringify(ours && ours.refusal)).toBe(true)
      expect(ours.objects && ours.objects.lane).toBe('runtime')
      expect(ours.objects.withheldGuards || []).toContain('objects:count-at-cap')
      const row = censusOf(cap())
      const t = (row.objects && row.objects.tally['box.border_color']) || null
      // nothing drawn, so nothing drawn wrong: no paired border differs or is carried another way
      expect(t ? t.carriedDiffers + t.notCarried + t.vendorUndecodable : 0, JSON.stringify(t)).toBe(0)
    } finally { vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '') }
  }, 120000)
})
