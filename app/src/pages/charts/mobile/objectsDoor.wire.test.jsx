/* The Objects recovery surface — the WIRE, not the component.
 *
 * `MobileObjectsSheet.test.jsx` proves the sheet behaves. This proves it is
 * REACHABLE, and that matters more here than for any other sheet: per-object
 * Hide is only a safe control BECAUSE this door exists. A severed wire would
 * leave the hide control shipping alone — precisely the thing the owner said not
 * to do — with every component test still green.
 *
 * Mirrors `boardsDoor.wire.test.jsx` rather than inventing a second idiom, and
 * carries the same NON-VACUITY controls so it cannot pass for the wrong reason.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import MobileMoreSheet from './MobileMoreSheet'

vi.mock('../../../hooks/useFlagged', () => ({
  useFlagged: () => ({ isFlagged: () => false, toggle: vi.fn() }),
}))

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel) => fs.readFileSync(path.join(HERE, rel), 'utf8')

const base = {
  open: true, onClose: vi.fn(), sym: 'SPY',
  widgets: [], onOpenWidget: vi.fn(), onAddWidget: vi.fn(), onOpenSettings: vi.fn(),
}

describe('the Tools sheet carries the objects door', () => {
  it('renders an Objects row and calls onOpenObjects', async () => {
    const onOpenObjects = vi.fn()
    render(<MobileMoreSheet {...base} onOpenObjects={onOpenObjects} />)
    const row = screen.getByRole('button', { name: 'Objects' })
    await userEvent.click(row)
    expect(onOpenObjects).toHaveBeenCalledTimes(1)
  })

  it('⭐ the HIDDEN COUNT is on the door, before you open anything', () => {
    // A hidden object is only recoverable if you have a reason to go looking. A
    // chart quietly missing three of your levels gives you none.
    render(<MobileMoreSheet {...base} onOpenObjects={vi.fn()} hiddenObjectCount={3} />)
    expect(screen.getByText('3 hidden')).toBeInTheDocument()
  })

  it('stays quiet when nothing is hidden', () => {
    render(<MobileMoreSheet {...base} onOpenObjects={vi.fn()} hiddenObjectCount={0} />)
    expect(screen.getByRole('button', { name: 'Objects' })).toBeInTheDocument()
    expect(screen.queryByText(/hidden/)).toBeNull()
  })

  it('NON-VACUITY · with no handler the row is absent — it is not always-on chrome', () => {
    render(<MobileMoreSheet {...base} />)
    expect(screen.queryByRole('button', { name: 'Objects' })).toBeNull()
    expect(screen.getByRole('button', { name: /Chart settings/i })).toBeInTheDocument()
  })
})

describe('the phone shell actually passes the handler', () => {
  const app = read('MobileChartsApp.jsx')

  it('mounts MobileObjectsSheet and gives the Tools sheet a way to open it', () => {
    expect(app, 'the objects sheet is never mounted').toContain('<MobileObjectsSheet')
    expect(app, 'the Tools sheet is never handed an opener').toContain("onOpenObjects={() => setSheet('objects')}")
    expect(app, "the sheet is not bound to the 'objects' key it is opened with")
      .toMatch(/open=\{sheet === 'objects'\}/)
  })

  it('⛔ reads the SAME store the canvas draws from, never a copy', () => {
    // A manager that could disagree with the chart about what exists is the one
    // thing a recovery surface must never be.
    expect(app).toContain('useChartDrawings(sym)')
    const block = app.slice(app.indexOf('<MobileObjectsSheet'), app.indexOf('<MobileObjectsSheet') + 900)
    expect(block).toContain('drawings={_objDrawings.drawings}')
    expect(block).toContain('onShowAll=')
  })

  it('NON-VACUITY · the same read finds the BOARDS door too', () => {
    expect(app).toContain('<MobileBoardsSheet')
    expect(app).toContain("onOpenBoards={() => setSheet('boards')}")
  })
})
