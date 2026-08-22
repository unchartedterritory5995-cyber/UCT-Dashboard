// FIX C (8/21 UI stress sweep, zero_a11y_name:_btn_1mmqs_135): the harness's
// a11y check dedupes by CSS class, so this ONE signature stood in for every
// icon-only `.btn`-classed control in this toolbar that carried only a
// `title` — the check reads `aria-label || textContent`, never `title`. Pins
// the fix across the toolbar's icon-only controls (buttons that already show
// visible text — Extended hours, Indicators, Line style — needed no change
// and are intentionally not asserted here).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ChartToolbar from './ChartToolbar'
import { mergeChartSettings } from './chartDefaults'
import { AuthContext } from '../../context/AuthContext'

function mount(props = {}) {
  return render(
    <AuthContext.Provider value={{ isPaid: true, user: null, loading: false }}>
      <ChartToolbar
        activeTool="cursor"
        setActiveTool={() => {}}
        color="#c9a84c"
        setColor={() => {}}
        lineWidth={1}
        setLineWidth={() => {}}
        hasSelection={false}
        onDelete={() => {}}
        onClearAll={() => {}}
        onUndo={() => {}}
        onRedo={() => {}}
        drawingCount={0}
        repeatMode={false}
        setRepeatMode={() => {}}
        chartSettings={mergeChartSettings({})}
        onUpdateSettings={() => {}}
        magnet={false}
        setMagnet={() => {}}
        onReplayToggle={() => {}}
        setLineStyle={() => {}}
        setFontSize={() => {}}
        {...props}
      />
    </AuthContext.Provider>,
  )
}

describe('ChartToolbar — icon-only controls have accessible names', () => {
  it('a drawing tool button is named by its tool label', () => {
    mount()
    // DRAW_TOOL_LIST always includes the trendline tool.
    expect(screen.getByRole('button', { name: 'Trendline (T)' })).toBeInTheDocument()
  })

  it('Favorite Drawings, Magnet, Repeat, Replay, and toolbar collapse are named', () => {
    mount()
    expect(screen.getByRole('button', { name: 'Customize drawing tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Magnet: off' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repeat drawing: off' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replay / Time Machine' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide toolbar' })).toBeInTheDocument()
  })

  it('Chart settings, Drawing color, Line width, and Text size are named', () => {
    mount()
    expect(screen.getByRole('button', { name: 'Chart settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Drawing color' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Line width: 1px' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Text size: 13px' })).toBeInTheDocument()
  })

  it('Hide drawings, Undo, Redo, Delete selected, and Clear all are named', () => {
    mount()
    expect(screen.getByRole('button', { name: 'Hide all drawings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete selected' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear all drawings (0)' })).toBeInTheDocument()
  })
})
