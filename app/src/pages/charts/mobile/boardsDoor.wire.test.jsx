/* Drawing Boards — the WIRE, not the component.
 *
 * `MobileBoardsSheet.test.jsx` proves the sheet behaves. This proves it is
 * REACHABLE, which is the whole defect: boards were real, per-user, synced, and
 * rendered by the canvas — and the only surface that could switch, name, add or
 * delete one lived inside a `ChartToolbar` that the phone shell sets to
 * `display:none`. Nothing was broken. Nothing was missing. It was unreachable.
 *
 * ⭐ THAT IS THE FAILURE A COMPONENT TEST CANNOT SEE, and it is the same shape
 * MOB-01 shipped with — which is why this file mirrors `layoutsDoor.wire.test.jsx`
 * rather than inventing a second idiom. Both rails carry a NON-VACUITY control so
 * they cannot pass for the wrong reason.
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

describe('the Tools sheet carries the boards door', () => {
  it('renders a Drawing boards row and calls onOpenBoards', async () => {
    const onOpenBoards = vi.fn()
    render(<MobileMoreSheet {...base} onOpenBoards={onOpenBoards} activeBoardName="Macro" />)
    const row = screen.getByRole('button', { name: 'Drawing boards' })
    expect(row).toBeInTheDocument()
    await userEvent.click(row)
    expect(onOpenBoards).toHaveBeenCalledTimes(1)
  })

  it('shows the ACTIVE board name, so you know what you are drawing on before you open it', () => {
    render(<MobileMoreSheet {...base} onOpenBoards={vi.fn()} activeBoardName="Macro" />)
    expect(screen.getByText('Macro')).toBeInTheDocument()
  })

  it('NON-VACUITY · with no handler the row is absent — it is not always-on chrome', () => {
    render(<MobileMoreSheet {...base} />)
    expect(screen.queryByRole('button', { name: 'Drawing boards' })).toBeNull()
    // …while a row that IS always present still renders, proving the sheet drew.
    expect(screen.getByRole('button', { name: /Chart settings/i })).toBeInTheDocument()
  })
})

describe('the phone shell actually passes the handler', () => {
  // ⛔ THE HALF THE COMPONENT TEST CANNOT REACH. `MobileChartsApp` mounts a real
  // chart and is not renderable here, so the wire is read from source — and the
  // read THROWS BY NAME if its markers move, rather than silently matching
  // nothing and reporting success.
  const app = read('MobileChartsApp.jsx')

  it('mounts MobileBoardsSheet and gives the Tools sheet a way to open it', () => {
    expect(app, 'the boards sheet is never mounted').toContain('<MobileBoardsSheet')
    expect(app, 'the Tools sheet is never handed an opener').toContain("onOpenBoards={() => setSheet('boards')}")
    expect(app, "the sheet is not bound to the 'boards' key it is opened with")
      .toMatch(/open=\{sheet === 'boards'\}/)
  })

  it('passes the symbol, so the per-board counts are about the chart on screen', () => {
    const block = app.slice(app.indexOf('<MobileBoardsSheet'), app.indexOf('<MobileBoardsSheet') + 260)
    expect(block).toContain('sym={sym}')
  })

  it('NON-VACUITY · the same read finds the LAYOUTS door too', () => {
    // If this probe were matching nothing, this would fail as well.
    expect(app).toContain('<MobileLayoutsSheet')
    expect(app).toContain("onOpenLayouts={() => setSheet('layouts')}")
  })
})
