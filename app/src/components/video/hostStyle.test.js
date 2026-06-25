import { describe, it, expect } from 'vitest'
import { computeHostStyle, MINI } from './hostStyle'

describe('computeHostStyle', () => {
  it('docked fills the slot rect exactly', () => {
    const r = { top: 100, left: 50, width: 640, height: 360 }
    expect(computeHostStyle('docked', 'br', r, 1280, 800)).toEqual(r)
  })

  it('mini bottom-right sits inside the desktop viewport with margins', () => {
    const s = computeHostStyle('mini', 'br', null, 1280, 800)
    expect(s.width).toBe(MINI.desktopW)
    expect(s.height).toBe(Math.round((MINI.desktopW * 9) / 16))
    expect(s.left).toBe(1280 - MINI.desktopW - MINI.desktopMargin)
    expect(s.top).toBe(800 - s.height - MINI.desktopMargin)
  })

  it('mini top-left anchors to the top-left margin', () => {
    const s = computeHostStyle('mini', 'tl', null, 1280, 800)
    expect(s.left).toBe(MINI.desktopMargin)
    expect(s.top).toBe(MINI.desktopMargin)
  })

  it('mobile widths shrink the mini and clear the bottom tab bar', () => {
    const s = computeHostStyle('mini', 'br', null, 380, 700)
    expect(s.width).toBeLessThanOrEqual(MINI.mobileMaxW)
    // bottom clearance must leave room for the tab bar + orb
    expect(s.top + s.height).toBeLessThanOrEqual(700 - MINI.mobileBottomClear)
  })

  it('docked without a rect falls back to the mini corner (no flash)', () => {
    const s = computeHostStyle('docked', 'br', null, 1280, 800)
    expect(s.width).toBe(MINI.desktopW)
  })
})
