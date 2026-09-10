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
  onSetProp: vi.fn(), onAdjustAnchors: vi.fn(),
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
const STEPPER = new Set(['A−', 'A+', '✕', 'Set', 'S', 'M', 'L', 'T', 'C', 'B'])
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

  it('⭐ a Rectangle reads as Border + Fill, then its label toggle', () => {
    // ⛔ AND IT HAS NO "Color" ROW. The colour row MOVED into Appearance and was
    // renamed — a shape has an outline and an inside, and a second row that also
    // set the outline colour would be the duplicate control the brief warns off.
    open('rect')
    expect(rowLabels()).toEqual([
      'Border', 'Fill', 'Show percent change',
      'Duplicate', 'Lock', 'Hide', 'Save as default', 'Delete Drawing',
    ])
    expect(screen.getByText('Appearance')).toBeTruthy()
    expect(screen.getByText('Label')).toBeTruthy()
  })

  it('a Horizontal Line gains its price label toggle, above the level rows', () => {
    open('horizontal')
    expect(rowLabels()).toEqual([
      'Color', 'Show price label', 'Set level…', 'Set alert…',
      'Duplicate', 'Lock', 'Hide', 'Save as default', 'Delete Drawing',
    ])
  })

  it('an Arrow gains a size picker and nothing else', () => {
    open('arrow')
    // The picker is a row with controls in it, not an action row — same shape as
    // the Text Note's font stepper, so it is checked the same way.
    expect(rowLabels()).toEqual([
      'Color', 'Duplicate', 'Lock', 'Hide', 'Save as default', 'Delete Drawing',
    ])
    expect(screen.getByText('Arrow size')).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })

  it('⛔ a caller with no onSetProp gets none of the new rows', () => {
    // Every read-only surface is in this shape: a menu cannot offer a setting it
    // has no way to apply.
    open('rect', { props: { onSetProp: null } })
    expect(rowLabels()).toEqual([
      'Border', 'Duplicate', 'Lock', 'Hide', 'Save as default', 'Delete Drawing',
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
    // A rectangle's Border row persists colour/width/style; its label toggle is
    // off and saved as such; it has no font size and no fill of its own yet.
    expect(h.onSaveDefaults).toHaveBeenCalledWith({
      color: '#60a5fa', width: 3, style: 'dotted',
      byTool: { rect: { showPercentChange: false } },
    })
    expect(screen.getByText('Saved as default ✓')).toBeTruthy()
  })

  it('⛔ A TOOL-SPECIFIC VALUE IS FILED UNDER ITS TOOL, never in the shared half', () => {
    const r = open('rect', { drawing: { fillColor: '#3f7fe0aa', showPercentChange: true } })
    fireEvent.click(screen.getByText('Save as default'))
    const payload = r.h.onSaveDefaults.mock.calls[0][0]
    expect(payload.byTool).toEqual({ rect: { fillColor: '#3f7fe0aa', showPercentChange: true } })
    expect(payload).not.toHaveProperty('fillColor')
    cleanup()
    // …and an Arrow saves its size under `arrow`, where a Rectangle can't see it.
    const a = open('arrow', { drawing: { arrowSize: 16 } })
    fireEvent.click(screen.getByText('Save as default'))
    expect(a.h.onSaveDefaults.mock.calls[0][0].byTool).toEqual({ arrow: { arrowSize: 16 } })
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


// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ PHASE 4 WIDGETS — two generic ones, no tool-specific branching', () => {
  it('a toggle reports its state and flips the named property', () => {
    const { h } = open('horizontal')
    const sw = screen.getByRole('switch')
    expect(sw.getAttribute('aria-checked')).toBe('false')   // a legacy line: OFF
    fireEvent.click(sw)
    expect(h.onSetProp).toHaveBeenCalledWith('showPriceLabel', true)
  })

  it('a toggle already ON turns OFF — it is not a one-way switch', () => {
    const { h } = open('horizontal', { drawing: { showPriceLabel: true } })
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('switch'))
    expect(h.onSetProp).toHaveBeenCalledWith('showPriceLabel', false)
  })

  it('the Rectangle’s toggle writes ITS property, not the line’s', () => {
    const { h } = open('rect')
    fireEvent.click(screen.getByRole('switch'))
    expect(h.onSetProp).toHaveBeenCalledWith('showPercentChange', true)
  })

  it('the arrow size picker offers three sizes and marks the current one', () => {
    const { h } = open('arrow')
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.textContent)).toEqual(['S', 'M', 'L'])
    // ⛔ A LEGACY ARROW SHOWS AS MEDIUM, because Medium IS the size it is drawn at.
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    fireEvent.click(radios[2])
    expect(h.onSetProp).toHaveBeenCalledWith('arrowSize', 16)
  })

  it('a stored size lights up its own button', () => {
    open('arrow', { drawing: { arrowSize: 7 } })
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-checked')))
      .toEqual(['true', 'false', 'false'])
  })

  it('Border and Fill open the SAME panel, one at a time', () => {
    open('rect')
    fireEvent.click(screen.getByText('Border'))
    expect(document.querySelectorAll('[data-color-panel]')).toHaveLength(1)
    fireEvent.click(screen.getByText('Fill'))
    expect(document.querySelectorAll('[data-color-panel]')).toHaveLength(1)
  })

  it('⛔ THE FILL PANEL HAS NO LINE CONTROLS — a fill has no width or dash', () => {
    const { h } = open('rect')
    fireEvent.click(screen.getByText('Fill'))
    const panel = document.querySelector('[data-color-panel]')
    for (const s of ['solid', 'dashed', 'dotted']) {
      expect(panel.querySelector(`button[aria-label="${s}"]`), s).toBeNull()
    }
    // …and it writes fillColor, never the drawing's own colour.
    expect(h.onSetColor).not.toHaveBeenCalled()
  })

  it('the Border panel keeps the width + line-style controls', () => {
    open('rect')
    fireEvent.click(screen.getByText('Border'))
    const panel = document.querySelector('[data-color-panel]')
    for (const s of ['solid', 'dashed', 'dotted']) {
      expect(panel.querySelector(`button[aria-label="${s}"]`), s).toBeTruthy()
    }
  })

  it('the Fill swatch shows the drawing’s colour until a fill is chosen', () => {
    // Which is honest: with no fill of its own, that IS what the inside is tinted.
    open('rect', { drawing: { color: '#1ae51a' } })
    const row = screen.getByText('Fill').closest('button')
    const swatch = [...row.querySelectorAll('span')].find((el) => el.style.borderRadius === '50%')
    expect(swatch.style.background).toContain('26, 229, 26')
  })

  it('Delete is still the last row on every Phase 4 tool', () => {
    for (const type of ['horizontal', 'hray', 'rect', 'arrow']) {
      cleanup()
      open(type)
      expect(rowLabels().at(-1), type).toBe('Delete Drawing')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ PHASE 5 — the measurement family, in the menu', () => {
  it('a Measure gets four independent field switches and a position picker', () => {
    open('measure')
    expect(rowLabels()).toEqual([
      'Color', 'Show dollar change', 'Show percent change', 'Show bars', 'Show time',
      'Duplicate', 'Lock', 'Hide', 'Save as default', 'Delete Drawing',
    ])
    expect(screen.getByText('Label position')).toBeTruthy()
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['T', 'C', 'B'])
  })

  it('⛔ A LEGACY MEASURE\u2019S SWITCHES SHOW WHAT THE CANVAS SHOWS', () => {
    // The drawing carries no toggles at all, and still prints its dollar,
    // percent and bar count. A menu reading a flat default would say "off" for
    // all three while the user looks straight at them.
    open('measure')
    const state = () => screen.getAllByRole('switch').map((b) => b.getAttribute('aria-checked'))
    expect(state()).toEqual(['true', 'true', 'true', 'false'])   // $ % bars · not time
  })

  it('flipping a switch writes that one property', () => {
    const { h } = open('measure')
    fireEvent.click(screen.getAllByRole('switch')[3])            // Show time
    expect(h.onSetProp).toHaveBeenCalledWith('showTime', true)
  })

  it('a Bars & Time ruler offers only the two questions it can answer', () => {
    open('dateRange')
    expect(rowLabels()).toEqual([
      'Color', 'Show bars', 'Show time',
      'Duplicate', 'Lock', 'Hide', 'Save as default', 'Delete Drawing',
    ])
    expect(screen.queryByText('Show dollar change')).toBeNull()
    expect(screen.getByText('Label position')).toBeTruthy()
  })

  it('the position picker reports the stored position and sets a new one', () => {
    const { h } = open('measure', { drawing: { labelPos: 'top' } })
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    fireEvent.click(radios[2])
    expect(h.onSetProp).toHaveBeenCalledWith('labelPos', 'bottom')
  })

  it('…and defaults to centre for a drawing that names none', () => {
    open('measure')
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-checked')))
      .toEqual(['false', 'true', 'false'])
  })

  it('a Price Move gets its two figures and Adjust anchors', () => {
    open('advance')
    expect(rowLabels()).toEqual([
      'Color', 'Show dollar change', 'Show percent change', 'Adjust anchors…',
      'Duplicate', 'Lock', 'Hide', 'Save as default', 'Delete Drawing',
    ])
  })

  it('⛔ THE LAST VISIBLE FIGURE REFUSES TO SWITCH OFF', () => {
    // A Price Move showing neither figure is an invisible, unclickable drawing.
    const { h } = open('advance')                 // legacy: percent only
    const sw = screen.getAllByRole('switch')
    expect(sw[1].getAttribute('aria-checked')).toBe('true')
    expect(sw[1].getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(sw[1])
    expect(h.onSetProp).not.toHaveBeenCalled()
    // …and it unlocks the moment the other one is on.
    cleanup()
    const both = open('advance', { drawing: { showDollar: true, showPercent: true } })
    for (const b of screen.getAllByRole('switch')) expect(b.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(screen.getAllByRole('switch')[0])
    expect(both.h.onSetProp).toHaveBeenCalledWith('showDollar', false)
  })

  it('⭐ MEASURE IS NOT LOCKED — its box survives every switch being off', () => {
    const { h } = open('measure', { drawing: { showDollar: true, showPercent: false, showBars: false, showTime: false } })
    const sw = screen.getAllByRole('switch')
    expect(sw[0].getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(sw[0])
    expect(h.onSetProp).toHaveBeenCalledWith('showDollar', false)
  })

  it('Adjust anchors calls its handler and renames itself while active', () => {
    const { h } = open('advance')
    fireEvent.click(screen.getByText('Adjust anchors…'))
    expect(h.onAdjustAnchors).toHaveBeenCalled()
    cleanup()
    render(<DrawingContextMenu x={0} y={0} drawing={draw('advance')} adjusting {...HANDLERS()} />)
    expect(screen.getByText('Done adjusting')).toBeTruthy()
  })

  it('a caller with no anchor handler simply has no such row', () => {
    open('advance', { props: { onAdjustAnchors: null } })
    expect(rowLabels()).not.toContain('Adjust anchors…')
    expect(rowLabels()).toContain('Show percent change')
  })

  it('Save as default files the measurement settings under the tool', () => {
    const { h } = open('measure', { drawing: { showTime: true, labelPos: 'top' } })
    fireEvent.click(screen.getByText('Save as default'))
    expect(h.onSaveDefaults.mock.calls[0][0].byTool).toEqual({
      measure: { showDollar: true, showPercent: true, showBars: true, showTime: true, labelPos: 'top' },
    })
  })

  it('⛔ …and a Bars & Time saves only what IT offers', () => {
    const { h } = open('dateRange')
    fireEvent.click(screen.getByText('Save as default'))
    const payload = h.onSaveDefaults.mock.calls[0][0]
    expect(payload.byTool).toEqual({ dateRange: { showBars: true, showTime: false, labelPos: 'center' } })
    expect(payload.byTool.dateRange).not.toHaveProperty('showDollar')
  })

  it('Delete is still the last row on every Phase 5 tool', () => {
    for (const type of ['measure', 'dateRange', 'advance']) {
      cleanup()
      open(type)
      expect(rowLabels().at(-1), type).toBe('Delete Drawing')
    }
  })
})
