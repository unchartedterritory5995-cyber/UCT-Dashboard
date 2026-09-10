// @vitest-environment jsdom
/* The migrated drawing menu, rendered.
 *
 * `drawingSettingsSchema.test.js` proves the TABLE is capability-neutral.
 * This file proves the RENDERER honours it — that a tool's declared controls
 * become the rows a user sees, in both the desktop popover and the touch
 * bottom-sheet, and that the chrome the migration was told not to redesign is
 * still the chrome it had.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { DrawingContextMenu } from './ChartDrawingOverlay'

const HANDLERS = () => ({
  onSetColor: vi.fn(), onSetWidth: vi.fn(), onSetStyle: vi.fn(), onSetFontSize: vi.fn(),
  onDuplicate: vi.fn(), onToggleLock: vi.fn(), onToggleHide: vi.fn(),
  onDelete: vi.fn(), onSaveDefaults: vi.fn(), onClose: vi.fn(),
  onSetAlert: vi.fn(), onSetLevel: vi.fn(), onMakeHorizontal: vi.fn(),
})

const draw = (type, extra = {}) => ({
  id: 'd1', type, color: '#1ae51a', lineWidth: 2, lineStyle: 'solid',
  points: [{ price: 1 }, { price: 2 }], ...extra,
})

function open(type, { sheet = false, drawing = {}, props = {} } = {}) {
  const h = { ...HANDLERS(), ...props }
  const utils = render(
    <DrawingContextMenu x={100} y={100} sheet={sheet} drawing={draw(type, drawing)} {...h} />,
  )
  return { ...utils, h }
}

/** Row labels, in DOM order.
 *  The colour row's text carries its disclosure caret, and the font stepper's
 *  A− / A+ are controls inside a row rather than rows — neither is a label. */
const STEPPER = new Set(['A−', 'A+', '✕', 'Set'])
const rowLabels = () => [...document.querySelectorAll('button')]
  .map((b) => (b.textContent || '').trim().replace(/[▸▾]$/, '').trim())
  .filter((t) => t && !STEPPER.has(t))

beforeEach(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
})
afterEach(cleanup)

describe('the rows come from the schema', () => {
  it('a Trend Line gets colour, the three level/alert rows, then the actions', () => {
    open('trendline')
    expect(rowLabels()).toEqual([
      'Color', 'Set level…', 'Make horizontal', 'Set alert…',
      'Duplicate', 'Lock', 'Hide', 'Save as default', 'Delete Drawing',
    ])
  })

  it('a Horizontal Line has no "Make horizontal" — it already is', () => {
    open('horizontal')
    expect(rowLabels()).not.toContain('Make horizontal')
    expect(rowLabels()).toContain('Set level…')
  })

  it('a Text Note gets Text size and no level/alert rows', () => {
    open('text')
    const rows = rowLabels()
    expect(rows).toContain('Color')
    expect(rows).not.toContain('Set level…')
    expect(rows).not.toContain('Set alert…')
    expect(screen.getByLabelText('Bigger text')).toBeTruthy()
    expect(screen.getByLabelText('Smaller text')).toBeTruthy()
  })

  it('a Rectangle gets colour and the actions only', () => {
    open('rect')
    expect(rowLabels()).toEqual([
      'Color', 'Duplicate', 'Lock', 'Hide', 'Save as default', 'Delete Drawing',
    ])
  })

  it('a control whose handler is missing is absent, not inert', () => {
    open('trendline', { props: { onSetAlert: null, onSaveDefaults: null, onToggleHide: null } })
    const rows = rowLabels()
    expect(rows).not.toContain('Set alert…')
    expect(rows).not.toContain('Save as default')
    expect(rows).not.toContain('Hide')
    expect(rows).toContain('Delete Drawing')      // still deletable
  })

  it('a half-placed sloped line cannot be "made horizontal"', () => {
    open('trendline', { drawing: { points: [{ price: 1 }] } })
    expect(rowLabels()).not.toContain('Make horizontal')
  })

  it('Lock / Hide read their label from the drawing', () => {
    open('rect', { drawing: { locked: true, hidden: true } })
    expect(rowLabels()).toContain('Unlock')
    expect(rowLabels()).toContain('Show')
  })

  it('an unknown drawing type still gets a usable menu', () => {
    open('a-tool-from-the-future')
    expect(rowLabels()).toContain('Color')
    expect(rowLabels()).toContain('Delete Drawing')
  })
})

describe('the rows do what they say', () => {
  it('Duplicate / Lock / Hide / Delete call their handlers', () => {
    const { h } = open('rect')
    for (const [label, fn] of [
      ['Duplicate', 'onDuplicate'], ['Lock', 'onToggleLock'],
      ['Hide', 'onToggleHide'], ['Delete Drawing', 'onDelete'],
    ]) {
      fireEvent.click(screen.getByText(label))
      expect(h[fn], label).toHaveBeenCalled()
    }
  })

  it('Save as default sends the tool’s own properties, and confirms', () => {
    const { h } = open('rect', { drawing: { color: '#60a5fa', lineWidth: 3, lineStyle: 'dotted' } })
    fireEvent.click(screen.getByText('Save as default'))
    // A rectangle has a colour row and nothing else that persists, so: no fontSize.
    expect(h.onSaveDefaults).toHaveBeenCalledWith({ color: '#60a5fa', width: 3, style: 'dotted' })
    expect(screen.getByText('Saved as default ✓')).toBeTruthy()
  })

  it('⭐ a Text Note’s defaults DO carry its font size; a line’s never do', () => {
    const t = open('text', { drawing: { fontSize: 22 } })
    fireEvent.click(screen.getByText('Save as default'))
    expect(t.h.onSaveDefaults.mock.calls[0][0]).toHaveProperty('fontSize', 22)
    cleanup()
    const l = open('trendline')
    fireEvent.click(screen.getByText('Save as default'))
    expect(l.h.onSaveDefaults.mock.calls[0][0]).not.toHaveProperty('fontSize')
  })

  it('the colour row opens ColorPanel with width and line style', () => {
    open('trendline')
    fireEvent.click(screen.getByText('Color'))
    expect(document.querySelector('[data-color-panel]')).toBeTruthy()
    // ⛔ ALL THREE STYLES REACH THE PICKER — the Phase 1 fix, through the new menu.
    for (const s of ['solid', 'dashed', 'dotted']) {
      expect(document.querySelector(`[data-color-panel] button[aria-label="${s}"]`), s).toBeTruthy()
    }
  })

  it('choosing dotted stores "dotted", not "dashed"', () => {
    const { h } = open('trendline')
    fireEvent.click(screen.getByText('Color'))
    fireEvent.click(document.querySelector('[data-color-panel] button[aria-label="dotted"]'))
    expect(h.onSetStyle).toHaveBeenCalledWith('dotted')
  })

  it('Set level… reveals an input that submits the typed price', () => {
    const { h } = open('horizontal')
    fireEvent.click(screen.getByText('Set level…'))
    const input = document.querySelector('input[type="number"]')
    expect(input).toBeTruthy()
    fireEvent.change(input, { target: { value: '412.5' } })
    fireEvent.click(screen.getByText('Set'))
    expect(h.onSetLevel).toHaveBeenCalledWith(412.5)
  })

  it('Set alert… reveals the bound/fixed choice and both directions', () => {
    const { h } = open('horizontal')
    fireEvent.click(screen.getByText('Set alert…'))
    expect(screen.getByText('Follows the line')).toBeTruthy()
    expect(screen.getByText('Fixed level')).toBeTruthy()
    fireEvent.click(screen.getByText('▲ Above'))
    expect(h.onSetAlert).toHaveBeenCalledWith('above', expect.objectContaining({ bound: expect.any(Boolean) }))
  })

  it('Escape closes the menu', () => {
    const { h } = open('rect')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(h.onClose).toHaveBeenCalled()
  })
})

describe('the chrome the migration was told not to redesign', () => {
  const shell = () => screen.getByText('Delete Drawing').closest('div[style*="position"]')

  it('desktop: a fixed dark popover with the shipped padding and radius', () => {
    open('rect')
    const el = shell()
    expect(el.style.position).toBe('fixed')
    expect(el.style.padding).toBe('5px')
    expect(el.style.borderRadius).toBe('10px')
    expect(el.style.fontFamily).toContain('Instrument Sans')
  })

  it('every action row still carries its icon', () => {
    open('trendline')
    for (const label of ['Set level…', 'Set alert…', 'Duplicate', 'Lock', 'Hide', 'Save as default', 'Delete Drawing']) {
      const btn = screen.getByText(label).closest('button')
      expect(btn.querySelector('svg'), `${label} lost its icon`).toBeTruthy()
    }
  })

  it('Delete keeps its destructive treatment, and is the only row that has it', () => {
    open('rect')
    const danger = [...document.querySelectorAll('button')]
      .filter((b) => (b.style.color || '').includes('danger'))
      .map((b) => b.textContent.trim())
    expect(danger).toEqual(['Delete Drawing'])
  })

  it('Delete stays the LAST row — never buried in a submenu', () => {
    for (const type of ['trendline', 'horizontal', 'text', 'rect']) {
      cleanup()
      open(type)
      expect(rowLabels().at(-1), type).toBe('Delete Drawing')
    }
  })
})

describe('touch: the bottom sheet', () => {
  it('docks to the bottom behind a dimming backdrop', () => {
    open('rect', { sheet: true })
    const el = screen.getByText('Delete Drawing').closest('div[style*="position: fixed"]')
    expect(el.style.bottom).toBe('0px')
    expect(el.style.borderTopLeftRadius).toBe('14px')
    const backdrop = el.parentElement
    expect(backdrop.style.background).toContain('rgba(0, 0, 0, 0.35)')
  })

  it('shows a grab handle', () => {
    open('rect', { sheet: true })
    const el = screen.getByText('Delete Drawing').closest('div[style*="position: fixed"]')
    const grabber = el.firstElementChild.firstElementChild
    expect(grabber.style.width).toBe('40px')
    expect(grabber.style.height).toBe('4px')
  })

  it('uses ≥44px tap targets', () => {
    open('rect', { sheet: true })
    const btn = screen.getByText('Delete Drawing').closest('button')
    expect(parseInt(btn.style.minHeight, 10)).toBeGreaterThanOrEqual(44)
  })

  it('tapping the backdrop dismisses', () => {
    const { h } = open('rect', { sheet: true })
    const el = screen.getByText('Delete Drawing').closest('div[style*="position: fixed"]')
    fireEvent.pointerDown(el.parentElement)
    expect(h.onClose).toHaveBeenCalled()
  })

  it('renders the same rows as desktop — the schema does not branch on pointer', () => {
    open('trendline', { sheet: true })
    const touch = rowLabels()
    cleanup()
    open('trendline')
    expect(touch).toEqual(rowLabels())
  })
})
