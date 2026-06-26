import { describe, it, expect } from 'vitest'
import { computeHostStyle, MINI } from './hostStyle'

describe('computeHostStyle', () => {
  it('docked fills the slot rect exactly', () => {
    const r = { top: 100, left: 50, width: 640, height: 360 }
    expect(computeHostStyle('docked', r, 1280, 800, null)).toEqual(r)
  })

  it('mini with no saved position defaults to bottom-right', () => {
    const s = computeHostStyle('mini', null, 1280, 800, null)
    expect(s.width).toBe(MINI.desktopW)
    expect(s.height).toBe(Math.round((MINI.desktopW * 9) / 16))
    expect(s.left).toBe(1280 - MINI.desktopW - MINI.desktopMargin)
    expect(s.top).toBe(800 - s.height - MINI.desktopMargin)
  })

  it('mini honors a saved free-drag position', () => {
    const s = computeHostStyle('mini', null, 1280, 800, { x: 300, y: 200 })
    expect(s.left).toBe(300)
    expect(s.top).toBe(200)
  })

  it('mini clamps an off-screen saved position back inside', () => {
    const s = computeHostStyle('mini', null, 1280, 800, { x: 5000, y: 5000 })
    expect(s.left).toBe(1280 - MINI.desktopW - 8)
  })

  it('mobile widths shrink the mini and clear the bottom tab bar', () => {
    const s = computeHostStyle('mini', null, 380, 700, null)
    expect(s.width).toBeLessThanOrEqual(MINI.mobileMaxW)
    expect(s.top + s.height).toBeLessThanOrEqual(700 - MINI.mobileBottomClear)
  })

  it('docked without a rect falls back to the mini placement (no flash)', () => {
    const s = computeHostStyle('docked', null, 1280, 800, null)
    expect(s.width).toBe(MINI.desktopW)
  })
})
