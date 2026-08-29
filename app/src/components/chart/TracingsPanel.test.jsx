// @vitest-environment jsdom
// Component tests for TracingsPanel — the Tracings sheet manager. Verifies the UI
// is correctly wired to the drawingsStore tracings API (the store logic itself is
// covered in drawingsStore.tracings.test.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import TracingsPanel from './TracingsPanel'
import * as drawingsStore from './drawingsStore'

beforeEach(() => {
  localStorage.clear()
  drawingsStore._reset()
})
afterEach(() => { vi.restoreAllMocks() })

const rows = () => screen.getAllByTestId('tracing-row')

describe('TracingsPanel', () => {
  it('renders the default sheet with its placeholder name', () => {
    render(<TracingsPanel />)
    expect(rows()).toHaveLength(1)
    expect(screen.getByText('Board 1')).toBeTruthy()
  })

  it('New board adds a sheet and makes it active', () => {
    render(<TracingsPanel />)
    fireEvent.click(screen.getByText(/New board/i))
    expect(rows()).toHaveLength(2)
    expect(drawingsStore.getActiveTracingId()).not.toBe('default')  // switched to the new sheet
    // exactly one board's pick button reads as active (aria-pressed)
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1)
  })

  it('clicking a sheet makes it active', () => {
    render(<TracingsPanel />)
    fireEvent.click(screen.getByText(/New board/i))     // now 2 sheets, new one active
    // click the first sheet's name to re-activate 'default'
    fireEvent.click(screen.getByText('Board 1'))
    expect(drawingsStore.getActiveTracingId()).toBe('default')
  })

  it('double-click name → rename', () => {
    render(<TracingsPanel />)
    fireEvent.doubleClick(screen.getByText('Board 1'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Levels' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(drawingsStore.listTracings()[0].name).toBe('Levels')
  })

  it('delete respects window.confirm and removes the sheet', () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    render(<TracingsPanel />)
    fireEvent.click(screen.getByText(/New board/i))     // 2 sheets
    const before = rows().length
    // delete the non-active 'default'
    const defaultRow = rows().find((r) => within(r).queryByText('Board 1'))
    fireEvent.click(within(defaultRow).getByLabelText(/Delete Board 1/i))
    expect(rows().length).toBe(before - 1)
  })

  it('the only sheet cannot be deleted (button disabled)', () => {
    render(<TracingsPanel />)
    const del = screen.getByLabelText(/Delete Board 1/i)
    expect(del.disabled).toBe(true)
  })

  it('shows the current-symbol mark count', () => {
    drawingsStore.subscribe('NVDA', () => {})
    drawingsStore.addDrawing('NVDA', { type: 'horizontal', points: [{ price: 1 }] })
    render(<TracingsPanel currentSym="NVDA" />)
    expect(screen.getByTitle('1 on NVDA')).toBeTruthy()   // count badge (just the number)
  })
})
