// The doors on one of the member's own indicators in the Indicators window (Studio lane R1, second slice).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import YourIndicatorActions from './YourIndicatorActions'
import WINDOW_SRC from './ChartSettingsIndicators.jsx?raw'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const MINE = { id: 'u_0123456789ab', label: 'My indicator' }
const doors = (over = {}) => ({ canModify: () => true, modify: vi.fn(), editFormula: vi.fn(), customCopy: vi.fn(), ...over })
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('the doors on a member’s own indicator', () => {
  it('Modify, Edit formula and Custom copy call the host’s doors with this indicator', () => {
    const d = doors()
    render(<YourIndicatorActions def={MINE} doors={d} />)
    fireEvent.click(screen.getByTestId('your-indicator-modify'))
    fireEvent.click(screen.getByTestId('your-indicator-edit'))
    fireEvent.click(screen.getByTestId('your-indicator-copy'))
    expect(d.modify).toHaveBeenCalledWith(MINE.id)
    expect(d.editFormula).toHaveBeenCalledWith(MINE.id)
    expect(d.customCopy).toHaveBeenCalledWith(MINE, {})
  })

  it('"Run over a list" opens the Screener’s address for this indicator, in this tab', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<YourIndicatorActions def={MINE} doors={doors()} />)
    const run = screen.getByTestId('your-indicator-run')
    expect(run.textContent).toBe('Run over a list')
    fireEvent.click(run)
    expect(open).toHaveBeenCalledWith(`/screener?scan=${MINE.id}`, '_self')
  })

  it('a press on a door never also presses the row behind it', () => {
    vi.spyOn(window, 'open').mockImplementation(() => null)
    const rowClick = vi.fn()
    render(<div onClick={rowClick}><YourIndicatorActions def={MINE} doors={doors()} /></div>)
    for (const id of ['your-indicator-modify', 'your-indicator-edit', 'your-indicator-copy', 'your-indicator-run']) {
      fireEvent.click(screen.getByTestId(id))
    }
    expect(rowClick).not.toHaveBeenCalled()
  })

  it('CONTROL: an indicator with no stored id (a draft) offers no run, and no Modify without access', () => {
    render(<YourIndicatorActions def={{ id: 'draft_1' }} doors={doors({ canModify: () => false })} />)
    expect(screen.queryByTestId('your-indicator-run')).toBeNull()
    expect(screen.queryByTestId('your-indicator-modify')).toBeNull()
    expect(screen.getByTestId('your-indicator-edit')).toBeTruthy()
  })

  it('CONTROL: nothing renders without a definition or without doors', () => {
    const { container, rerender } = render(<YourIndicatorActions def={null} doors={doors()} />)
    expect(container.firstChild).toBeNull()
    rerender(<YourIndicatorActions def={MINE} doors={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('the Indicators window uses these doors for the member’s own rows (source rail; comments stripped)', () => {
    const w = code(WINDOW_SRC)
    expect(w).toMatch(/<YourIndicatorActions def=\{d\} doors=\{definitionDoors\}/)
    expect(w).not.toMatch(/data-testid="your-indicator-edit"/)       // one implementation, not two
  })
})
