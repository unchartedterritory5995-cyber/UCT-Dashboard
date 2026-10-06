/* P14b — the WIRE, not the component.
 *
 * The audit behind this task found `ChartsWorkspace.jsx`'s `isMobile` branch
 * WILL render `MultiChartGrid` (with a working "Exit Multi Chart" button) the
 * moment `mc.state.mode === 'grid'` — but the only control that ever flips
 * `mode` to `'grid'` (the desktop "Open Layout ▾ → ▦ Multi Chart ▸" menu,
 * `MultiChartMenu.jsx`'s `pickPreset` → `mc.enterGrid(id)`) lives in the
 * DESKTOP toolbar JSX, after `if (isMobile) return (...)`. A phone could never
 * reach grid mode. This mirrors `layoutsDoor.wire.test.jsx` /
 * `boardsDoor.wire.test.jsx` rather than inventing a third idiom.
 *
 * Two things are proved, each with a NON-VACUITY control so it cannot pass for
 * the wrong reason:
 *   1. The Tools sheet shows a "▦ Multi Chart" entry and activating it calls
 *      the handler it was given.
 *   2. The wire from ChartsWorkspace down actually calls `mc.enterGrid()` —
 *      the SAME action the desktop menu uses — not a mobile-only copy.
 * A third suite proves `enterGrid()` itself (the shared state hook, already
 * covered generally by `useMultiChartState.test.jsx`) flips `state.mode` to
 * `'grid'`, which is the exact condition the audit named as the door.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderHook, act } from '@testing-library/react'
import MobileMoreSheet from './MobileMoreSheet'

vi.mock('../../../hooks/useFlagged', () => ({
  useFlagged: () => ({ isFlagged: () => false, toggle: vi.fn() }),
}))

vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: vi.fn(), loading: false }),
}))

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel) => fs.readFileSync(path.join(HERE, rel), 'utf8')

const base = {
  open: true, onClose: vi.fn(), sym: 'SPY',
  widgets: [], onOpenWidget: vi.fn(), onAddWidget: vi.fn(), onOpenSettings: vi.fn(),
}

describe('the Tools sheet carries the Multi Chart door', () => {
  it('renders a ▦ Multi Chart row and calls onEnterMultiChart', async () => {
    const onEnterMultiChart = vi.fn()
    render(<MobileMoreSheet {...base} onEnterMultiChart={onEnterMultiChart} />)
    const row = screen.getByRole('button', { name: 'Multi Chart' })
    expect(row).toBeInTheDocument()
    expect(row).toHaveTextContent('Multi Chart')
    await userEvent.click(row)
    expect(onEnterMultiChart).toHaveBeenCalledTimes(1)
  })

  it('NON-VACUITY · with no handler the row is absent — it is not always-on chrome', () => {
    render(<MobileMoreSheet {...base} />)
    expect(screen.queryByRole('button', { name: 'Multi Chart' })).toBeNull()
    // …while a row that IS always present still renders, proving the sheet drew.
    expect(screen.getByRole('button', { name: /Chart settings/i })).toBeInTheDocument()
  })
})

describe('the phone shell actually passes the handler through', () => {
  // ⛔ THE HALF THE COMPONENT TEST CANNOT REACH. `MobileChartsApp` mounts a real
  // chart and is not renderable here, so the wire is read from source — and the
  // read THROWS BY NAME if its markers move, rather than silently matching
  // nothing and reporting success.
  const app = read('MobileChartsApp.jsx')

  it('accepts onEnterMultiChart and hands it to the Tools sheet', () => {
    expect(app, 'MobileChartsApp no longer declares the prop').toContain('onEnterMultiChart')
    const block = app.slice(app.indexOf('<MobileMoreSheet'), app.indexOf('<MobileMoreSheet') + 900)
    expect(block, 'the Tools sheet is never handed the handler')
      .toContain('onEnterMultiChart={onEnterMultiChart}')
  })

  it('NON-VACUITY · the same read finds the LAYOUTS door too', () => {
    expect(app).toContain("onOpenLayouts={() => setSheet('layouts')}")
  })
})

describe('ChartsWorkspace wires the SAME action the desktop menu uses', () => {
  const ws = read('../ChartsWorkspace.jsx')

  it('the file still has the shapes this rail reasons about', () => {
    expect(ws.indexOf('if (isMobile) {'), 'the isMobile branch moved or was renamed').toBeGreaterThan(-1)
    expect(ws.indexOf('<MobileChartsApp'), 'the phone shell is no longer rendered here').toBeGreaterThan(-1)
    expect(ws.indexOf('const mc = useMultiChartState'), 'the multichart state hook moved').toBeGreaterThan(-1)
  })

  it('passes onEnterMultiChart={() => mc.enterGrid()} — the desktop\'s own enterGrid, not a copy', () => {
    const start = ws.indexOf('<MobileChartsApp')
    const call = ws.slice(start, ws.indexOf('/>', start))
    expect(call, 'onEnterMultiChart is missing or not wired to mc.enterGrid()')
      .toContain('onEnterMultiChart={() => mc.enterGrid()}')
  })

  it('mc is declared BEFORE the phone branch returns, so it is in scope there', () => {
    const mcDeclAt = ws.indexOf('const mc = useMultiChartState')
    const mobileReturnAt = ws.indexOf('if (isMobile) {')
    expect(mcDeclAt).toBeLessThan(mobileReturnAt)
  })

  it('CONTROL — the probe can see a prop that is NOT there', () => {
    const start = ws.indexOf('<MobileChartsApp')
    const call = ws.slice(start, ws.indexOf('/>', start))
    expect(call).not.toContain('onInventedMultiChartThing=')
  })
})

describe('enterGrid() flips the shared multichart state to grid mode', () => {
  // The exact condition ChartsWorkspace's isMobile branch checks
  // (`mc.state.mode === 'grid'`) to render MultiChartGrid + the Exit control.
  it('mode starts as workspace and flips to grid on enterGrid()', async () => {
    const useMultiChartState = (await import('../grid/useMultiChartState')).default
    const { result } = renderHook(() => useMultiChartState())
    expect(result.current.state.mode).toBe('workspace')
    act(() => result.current.enterGrid())
    expect(result.current.state.mode).toBe('grid')
  })

  it('enterGrid() on a phone device class also flips mode to grid (mobile-scoped presentation)', async () => {
    const useMultiChartState = (await import('../grid/useMultiChartState')).default
    const { result } = renderHook(() => useMultiChartState('mobile'))
    expect(result.current.state.mode).toBe('workspace')
    act(() => result.current.enterGrid())
    expect(result.current.state.mode).toBe('grid')
  })
})
