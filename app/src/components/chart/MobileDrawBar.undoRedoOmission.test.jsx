// @vitest-environment jsdom
/* Wave 13 lane 13H-4 — the fix that actually makes V390 pass.
 *
 * MobileDrawBar's fixed-width chrome (`.done` + `.allTools` + `.side`) is
 * ~279px, wider than the Notebook chart embed's own ~268px-wide canvas at a
 * 390px viewport (docs/notebook/evidence/wave13-13h4/walk-3's
 * V390_drawbar_geometry: `.tools` clientWidth 0 — the whole tool rail
 * invisible, every draw tool unreachable, measured BEFORE this fix). This is
 * the SAME squeeze class `toolPickerRepeat.test.jsx` already documents
 * (repeatMode moved off the bar for exactly this reason, "0.98 of one tile,
 * down from ~3") — recurring here because StockChart's annotationsEditable
 * caller never passes onUndo/onRedo (no undo history exists on that layer:
 * useChartDrawings backs only the showDrawingTools overlay), so those two
 * tiles rendered PERMANENTLY DISABLED (`disabled={!canUndo}`, default false)
 * while still consuming ~84px of the bar.
 *
 * The fix: render Undo/Redo ONLY when a real handler is passed. A caller with
 * no undo history (the Notebook embed) gets ~84px back; a caller WITH one
 * (the showDrawingTools/phone-chart-shell branch, which always passes both)
 * is byte-identical to before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import MobileDrawBar from './MobileDrawBar'

beforeEach(() => cleanup())

const base = {
  open: true,
  onClose: () => {},
  activeTool: null,
  setActiveTool: () => {},
  magnet: false,
  setMagnet: () => {},
  repeatMode: false,
  setRepeatMode: () => {},
}

describe('MobileDrawBar — Undo/Redo rendered only when a real handler exists', () => {
  it('no onUndo/onRedo (the annotationsEditable/Notebook-embed caller): neither tile renders', () => {
    render(<MobileDrawBar {...base} />)
    expect(screen.queryByLabelText('Undo')).toBeNull()
    expect(screen.queryByLabelText('Redo')).toBeNull()
    // The rest of the bar is unaffected -- Done, the tools rail and the
    // pinned All/Eraser/Magnet controls still render.
    expect(screen.getByLabelText('Done drawing')).toBeTruthy()
    expect(screen.getByLabelText('All drawing tools')).toBeTruthy()
    expect(screen.getByLabelText('Eraser')).toBeTruthy()
    expect(screen.getByLabelText('Snap to price')).toBeTruthy()
  })

  it('a caller WITH real history (the showDrawingTools branch, unchanged): both tiles render', () => {
    const onUndo = vi.fn()
    const onRedo = vi.fn()
    render(<MobileDrawBar {...base} onUndo={onUndo} onRedo={onRedo} canUndo canRedo />)
    expect(screen.getByLabelText('Undo')).toBeTruthy()
    expect(screen.getByLabelText('Redo')).toBeTruthy()
  })

  it('a handler with no history yet (canUndo/canRedo false) still renders the tile, disabled -- presence tracks the HANDLER, not the current enabled state', () => {
    render(<MobileDrawBar {...base} onUndo={() => {}} onRedo={() => {}} canUndo={false} canRedo={false} />)
    expect(screen.getByLabelText('Undo').disabled).toBe(true)
    expect(screen.getByLabelText('Redo').disabled).toBe(true)
  })
})
