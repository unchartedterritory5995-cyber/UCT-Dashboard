// Go-live wave 1: tourTiers.js -- which steps a screen keeps. The tiers are the app's two boundaries, read through
// matchMedia once; a step with no tier is on every screen; with no matchMedia the desktop tour is what is kept.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { STEP_TIERS, stepOnThisScreen, stepsForScreen } from './tourTiers'
import { MQ } from '../../../../../styles/breakpoints'

const STEPS = [
  { id: 'all', anchor: 'a', file: 'f' },
  { id: 'p', anchor: 'b', file: 'f', tier: 'phone' },
  { id: 'w', anchor: 'c', file: 'f', tier: 'wide' },
  { id: 't', anchor: 'd', file: 'f', tier: 'touch' },
  { id: 'd', anchor: 'e', file: 'f', tier: 'desktop' },
]
// A real screen of width `w` (fractional under browser zoom), answering each query the way a browser does.
const screen = (w) => (q) => {
  if (q === 'all') return true
  if (q === MQ.phone) return w <= 640
  if (q === MQ.tabletDown) return w <= 1024
  if (q === MQ.desktop) return w >= 1025
  return false
}
const ids = (steps) => steps.map((s) => s.id)

afterEach(() => vi.unstubAllGlobals())

describe('stepsForScreen', () => {
  it('390 px (phone): the untiered, phone and touch steps', () => {
    expect(ids(stepsForScreen(STEPS, screen(390)))).toEqual(['all', 'p', 't'])
  })
  it('820 px (tablet): the untiered, wide and touch steps', () => {
    expect(ids(stepsForScreen(STEPS, screen(820)))).toEqual(['all', 'w', 't'])
  })
  it('1280 px (desktop): the untiered, wide and desktop steps', () => {
    expect(ids(stepsForScreen(STEPS, screen(1280)))).toEqual(['all', 'w', 'd'])
  })
  it('the boundaries are 640 and 1024 (styles/breakpoints.js), never a new literal', () => {
    expect(STEP_TIERS.phone.query).toBe(MQ.phone)
    expect(STEP_TIERS.wide.query).toBe(MQ.phone)
    expect(STEP_TIERS.desktop.query).toBe(MQ.desktop)
    expect(STEP_TIERS.touch.query).toBe(MQ.desktop)
    expect(ids(stepsForScreen(STEPS, screen(640)))).toEqual(['all', 'p', 't'])
    expect(ids(stepsForScreen(STEPS, screen(641)))).toEqual(['all', 'w', 't'])
    expect(ids(stepsForScreen(STEPS, screen(1024)))).toEqual(['all', 'w', 't'])
    expect(ids(stepsForScreen(STEPS, screen(1025)))).toEqual(['all', 'w', 'd'])
  })
  // Follow-up B, item 2a: each tier is read from the CSS's own string (phone: MQ.phone; desktop: MQ.desktop), so at a
  // fractional width under browser zoom the tour agrees with what the CSS draws. At 1024.5 px neither
  // `(max-width: 1024px)` nor `(min-width: 1025px)` matches: the desktop-only controls are hidden, so it is touch.
  it('fractional widths (browser zoom) follow the CSS: 640.5 is wide, 1024.5 is touch', () => {
    expect(ids(stepsForScreen(STEPS, screen(640)))).toEqual(['all', 'p', 't'])
    expect(ids(stepsForScreen(STEPS, screen(640.5)))).toEqual(['all', 'w', 't'])
    expect(ids(stepsForScreen(STEPS, screen(641)))).toEqual(['all', 'w', 't'])
    expect(ids(stepsForScreen(STEPS, screen(1024)))).toEqual(['all', 'w', 't'])
    expect(ids(stepsForScreen(STEPS, screen(1024.5)))).toEqual(['all', 'w', 't'])
    expect(ids(stepsForScreen(STEPS, screen(1025)))).toEqual(['all', 'w', 'd'])
  })
  it('reads window.matchMedia by default; without it, or with one that matches nothing, the desktop tour is kept', () => {
    vi.stubGlobal('matchMedia', (q) => ({ matches: q === MQ.phone || q === MQ.tabletDown }))
    expect(ids(stepsForScreen(STEPS))).toEqual(['all', 'p', 't'])
    vi.stubGlobal('matchMedia', undefined)
    expect(ids(stepsForScreen(STEPS))).toEqual(['all', 'w', 'd'])
    vi.stubGlobal('matchMedia', () => ({ matches: false }))       // the test environment's shim
    expect(ids(stepsForScreen(STEPS))).toEqual(['all', 'w', 'd'])
    // CONTROL: a real window at 1024.5 px matches `all` and nothing else, and is read as touch, not "no screen"
    vi.stubGlobal('matchMedia', (q) => ({ matches: q === 'all' }))
    expect(ids(stepsForScreen(STEPS))).toEqual(['all', 'w', 't'])
  })
  it('an unknown tier never hides a step; a step with no tier is on every screen', () => {
    expect(stepOnThisScreen({ id: 'x', tier: 'watch' }, screen(390))).toBe(true)
    expect(stepOnThisScreen({ id: 'x' }, screen(390))).toBe(true)
  })
})
