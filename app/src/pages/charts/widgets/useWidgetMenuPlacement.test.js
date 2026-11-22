import { describe, it, expect } from 'vitest'
import { placeWidgetMenu } from './useWidgetMenuPlacement'

const el = (left, top, width, height) => ({ getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }) })
const VW = 1600, VH = 900, W = 268

describe('placeWidgetMenu (owner 11-14)', () => {
  it('a left-half widget gets the menu on its right, top flush with the frame, as tall as the widget', () => {
    const p = placeWidgetMenu({ frame: el(20, 60, 560, 800), panelW: W, vw: VW, vh: VH })
    expect(p).toEqual({ left: 588, top: 60, maxHeight: 800, side: 'right' })
  })
  it('a right-half widget gets it on its left', () => {
    const p = placeWidgetMenu({ frame: el(1000, 60, 580, 400), panelW: W, vw: VW, vh: VH })
    expect(p.side).toBe('left')
    expect(p.left).toBe(1000 - 8 - W)
  })
  it('a short widget still gets a usable menu, capped by the screen', () => {
    const p = placeWidgetMenu({ frame: el(20, 700, 400, 120), panelW: W, vw: VW, vh: VH })
    expect(p.maxHeight).toBe(VH - 8 - 700)
  })
  it('no room either side → drops down from the gear, right-aligned inside the widget', () => {
    const p = placeWidgetMenu({ frame: el(8, 60, 1584, 800), gear: el(1540, 66, 24, 24), panelW: W, vw: VW, vh: VH })
    expect(p.side).toBe('down')
    expect(p.left).toBe(1564 - W)
    expect(p.top).toBe(96)
  })
  it('dropdown mode always drops down', () => {
    expect(placeWidgetMenu({ frame: el(20, 60, 400, 600), gear: el(380, 66, 24, 24), panelW: W, dropdown: true, vw: VW, vh: VH }).side).toBe('down')
  })
})
