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
const screen = (w) => (q) => (q === MQ.phone ? w <= 640 : q === MQ.tabletDown ? w <= 1024 : false)
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
    expect(STEP_TIERS.touch.query).toBe(MQ.tabletDown)
    expect(ids(stepsForScreen(STEPS, screen(640)))).toEqual(['all', 'p', 't'])
    expect(ids(stepsForScreen(STEPS, screen(641)))).toEqual(['all', 'w', 't'])
    expect(ids(stepsForScreen(STEPS, screen(1024)))).toEqual(['all', 'w', 't'])
    expect(ids(stepsForScreen(STEPS, screen(1025)))).toEqual(['all', 'w', 'd'])
  })
  it('reads window.matchMedia by default; without it, the desktop tour is kept', () => {
    vi.stubGlobal('matchMedia', (q) => ({ matches: q === MQ.phone || q === MQ.tabletDown }))
    expect(ids(stepsForScreen(STEPS))).toEqual(['all', 'p', 't'])
    vi.stubGlobal('matchMedia', undefined)
    expect(ids(stepsForScreen(STEPS))).toEqual(['all', 'w', 'd'])
  })
  it('an unknown tier never hides a step; a step with no tier is on every screen', () => {
    expect(stepOnThisScreen({ id: 'x', tier: 'watch' }, screen(390))).toBe(true)
    expect(stepOnThisScreen({ id: 'x' }, screen(390))).toBe(true)
  })
})
