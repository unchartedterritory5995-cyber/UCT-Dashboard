import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ColumnPicker from './ColumnPicker'
import { phonePanelStyle, PANEL_GUTTER } from './phonePanel'

// RS Phase 2a visual round, unit VA6 (spec A7, 2026-11-07): on a phone the Columns
// picker opens as a panel pinned 8 px inside each screen edge, under the Columns
// button; desktop keeps the anchored 300 px popover.

const ALL = [
  { key: 'ticker', label: 'Ticker' }, { key: 'price', label: 'Price' },
  { key: 'mansfield_cross_bars_ago', label: 'Mans Cross Age' },
]

const realMatchMedia = window.matchMedia
const realInnerH = window.innerHeight
function setPhone(phone, h = 844) {
  window.matchMedia = (q) => ({
    matches: phone && q === '(max-width: 640px)', media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false },
  })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h })
}
afterEach(() => {
  window.matchMedia = realMatchMedia
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: realInnerH })
})

// The toolbar wraps the trigger and the picker in `.pickerAnchor`; the picker reads
// its placement from that wrapper. Measured from the phone frame
// (phone_*_screener_view_picker_after_rs): the Columns button's bottom at y = 375.
function Anchored(props) {
  return (
    <span data-testid="anchor" ref={el => {
      if (el) el.getBoundingClientRect = () => ({ left: 20, right: 110, top: 332, bottom: 375, width: 90, height: 43, x: 20, y: 332 })
    }}>
      <button type="button">Columns</button>
      <ColumnPicker open onClose={() => {}} allColumns={ALL} visible={['ticker']}
        onChange={() => {}} onReset={() => {}} {...props} />
    </span>
  )
}

describe('ColumnPicker on a phone (A7)', () => {
  it('acceptance 2: pinned 8 px inside both edges of a 390 px screen, under the trigger', () => {
    setPhone(true)
    // Mounted closed, then opened (as the Columns button does), so the anchor's
    // box is in place before the picker measures it.
    const { rerender } = render(<Anchored open={false} />)
    rerender(<Anchored open />)
    const pop = screen.getByRole('dialog', { name: 'Choose columns' })
    expect(pop).toHaveAttribute('data-phone-panel')
    expect(pop.style.position).toBe('fixed')
    expect(pop.style.left).toBe('8px')
    expect(pop.style.right).toBe('8px')
    expect(390 - parseFloat(pop.style.right)).toBeLessThanOrEqual(382)
    expect(pop.style.width).toBe('auto')          // the 300 px desktop width is released
    expect(pop.style.top).toBe('379px')
    expect(parseFloat(pop.style.maxHeight)).toBeLessThanOrEqual(Math.round(844 * 0.7))
  })

  it('control: desktop keeps the anchored popover (no inline placement)', () => {
    setPhone(false, 900)
    render(<Anchored />)
    const pop = screen.getByRole('dialog', { name: 'Choose columns' })
    expect(pop).not.toHaveAttribute('data-phone-panel')
    expect(pop.getAttribute('style')).toBeNull()
  })

  it('closed renders nothing, as before', () => {
    setPhone(true)
    const { container } = render(<ColumnPicker open={false} onClose={() => {}} allColumns={ALL}
      visible={['ticker']} onChange={() => {}} onReset={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('the stylesheet wraps column names and gives Close 44 px on every touch width; canonical breakpoints only', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const css = readFileSync(join(globalThis.process.cwd(), 'src/pages/screener/shell/ScannerShell.module.css'), 'utf8').replace(/\r\n/g, '\n')
    const at = css.indexOf('@media (max-width: 640px) {\n  .shell')
    expect(at).toBeGreaterThan(-1)
    const block = css.slice(at, css.indexOf('\n}\n', at))
    expect(block).toMatch(/\.pickerLabel\s*\{[^}]*overflow-wrap:\s*anywhere/)
    // 2026-11-07: the 44 px floor for Reset and Close moved to the TOUCH block
    // (<=1024 px), which covers the phone too (tapFloor rail: tablet is touch).
    const touchAt = css.indexOf('@media (max-width: 1024px) {\n  .railSlot')
    expect(touchAt).toBeGreaterThan(-1)
    const touch = css.slice(touchAt, css.indexOf('\n}\n', touchAt))
    expect(touch).toMatch(/\.pickerClose\s*\{[^}]*min-width:\s*var\(--tap-min, 44px\)/)
    for (const m of css.matchAll(/@media \(max-width: (\d+)px\)/g)) expect(['640', '1024']).toContain(m[1])
  })
})

describe('phonePanelStyle (pure geometry)', () => {
  it('under the trigger when there is room, capped at 70vh and at the room left', () => {
    const s = phonePanelStyle({ bottom: 100 }, 844)
    expect(s).toMatchObject({ position: 'fixed', left: PANEL_GUTTER, right: PANEL_GUTTER, top: 104, bottom: 'auto' })
    expect(s.maxHeight).toBe(Math.round(844 * 0.7))
    const t = phonePanelStyle({ bottom: 400 }, 844)
    expect(t.top).toBe(404)
    expect(t.maxHeight).toBe(844 - 404 - PANEL_GUTTER)
  })

  it('docks to the bottom edge when the trigger sits too low', () => {
    const s = phonePanelStyle({ bottom: 700 }, 844)
    expect(s).toMatchObject({ top: 'auto', bottom: PANEL_GUTTER, maxHeight: Math.round(844 * 0.7) })
  })

  it('never leaves the screen: top + maxHeight + gutter <= viewport', () => {
    for (let b = 0; b <= 844; b += 37) {
      const s = phonePanelStyle({ bottom: b }, 844)
      if (s.top === 'auto') expect(s.maxHeight + 2 * PANEL_GUTTER).toBeLessThanOrEqual(844)
      else expect(s.top + s.maxHeight + PANEL_GUTTER).toBeLessThanOrEqual(844)
    }
  })
})
