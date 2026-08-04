// app/src/components/research-kit/toneClasses.test.js
//
// Module classes resolve SCOPED (`_name_hash`) at runtime; that file's own
// disk-parsing assertions are unaffected.
//
// This reads each stylesheet straight off disk (same technique as
// styles/tokens.test.js — CSS is source text, not JS) and asserts every tone
// class name a component's TONE_CLASS map can produce is a real selector in
// that file.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TONE_CLASS as STAT_TILE_TONES } from './StatTile'
import { TONE_CLASS as VERDICT_CHIP_TONES } from './VerdictChip'
import { TONE_CLASS as RANGE_SLIDER_TONES } from './RangeSlider'

const read = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    // Strip comments so a class name mentioned only in prose can't fake a pass.
    .replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * True when `.name` exists as a real CSS selector — anchored so `.toneGold`
 * cannot be satisfied by a longer identifier like `.toneGoldAlt`, and so a
 * `.` preceded by a word/hyphen character (mid-identifier) never counts.
 */
function hasSelector(css, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(^|[^\\w-])\\.${escaped}(?![\\w-])`)
  return re.test(css)
}

const STAT_TILE = read('./StatTile.module.css')
const VERDICT_CHIP = read('./VerdictChip.module.css')
const RANGE_SLIDER = read('./RangeSlider.module.css')

describe.each([
  ['StatTile', STAT_TILE_TONES, STAT_TILE],
  ['VerdictChip', VERDICT_CHIP_TONES, VERDICT_CHIP],
  ['RangeSlider', RANGE_SLIDER_TONES, RANGE_SLIDER],
])('%s.module.css — every TONE_CLASS value is a real selector (M1 drift-guard)', (name, map, css) => {
  it('exports a non-empty TONE_CLASS map', () => {
    expect(Object.keys(map).length).toBeGreaterThan(0)
  })

  it.each(Object.values(map))('.%s is a real selector', (cls) => {
    expect(hasSelector(css, cls)).toBe(true)
  })
})
