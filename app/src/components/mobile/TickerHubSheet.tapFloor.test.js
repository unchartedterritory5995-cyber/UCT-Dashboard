// The Ticker Hub sheet's "+ Compare" badge clears --tap-min for a finger.
// Measured in WebKit: 97x14 at 834 (touch) and 97x40 at 390 -- it is SymbolSearch's badge,
// sized for a chart TF bar. Same device condition as the TickerPopup floor:
// `(max-width: 1024px), (pointer: coarse)`.
//
// A STRUCTURAL RAIL (jsdom lays nothing out); the WebKit walk is the measurement.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mediaBodiesOn } from '../../testing/cssMediaAt'

const read = (p) => readFileSync(join(process.cwd(), 'src', p), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const CSS = stripComments(read('components/mobile/TickerHubSheet.module.css'))
const JSX = read('components/mobile/TickerHubSheet.jsx')
const SEL = '.compareRow button'

function pinned(block, selector, prop) {
  for (const [, sels, decls] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!sels.split(',').some((s) => s.trim() === selector)) continue
    if (new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*var\\(--tap-min\\)\\s*(?:;|$)`).test(decls.trim())) return true
  }
  return false
}

const FINGERS = [{ width: 390, pointer: 'coarse' }, { width: 834, pointer: 'coarse' }, { width: 1194, pointer: 'coarse' }]

describe('TickerHubSheet "+ Compare" badge touch floor', () => {
  it('is pinned to --tap-min at 390, 834 and 1194 on touch', () => {
    const misses = FINGERS.filter((d) => !pinned(mediaBodiesOn(CSS, d), SEL, 'min-height')).map((d) => d.width)
    expect(misses).toEqual([])
  })

  it('a mouse desktop is untouched', () => {
    expect(pinned(mediaBodiesOn(CSS, { width: 1200, pointer: 'fine' }), SEL, 'min-height')).toBe(false)
  })

  it('the row the floor names is the one that holds the compare door (the wire)', () => {
    expect(JSX).toMatch(/<div className=\{styles\.compareRow\}>\s*<CompareSymbolSearch\b/)
  })

  it('CONTROL: a phone-only or literal-px floor does not count', () => {
    const phoneOnly = `@media (max-width: 640px) { ${SEL} { min-height: var(--tap-min); } }`
    const literal = `@media (max-width: 1024px), (pointer: coarse) { ${SEL} { min-height: 44px; } }`
    expect(pinned(mediaBodiesOn(phoneOnly, FINGERS[1]), SEL, 'min-height')).toBe(false)
    expect(pinned(mediaBodiesOn(literal, FINGERS[1]), SEL, 'min-height')).toBe(false)
  })
})
