// Follow-up A: a row of the phone "+" sheet sends exactly ONE `menu_row_used` {plus_sheet, <row>}.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import NotebookPlusSheet from './NotebookPlusSheet'

let spy
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const sent = () => spy.mock.calls.filter(([u]) => u === '/api/j2/telemetry').map(([, i]) => JSON.parse(i.body))

describe('menu_row_used from the "+" sheet', () => {
  it('Quick note sends one {plus_sheet, quick_note} and runs its door', () => {
    spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true })
    const onQuickNote = vi.fn()
    render(<NotebookPlusSheet open onClose={vi.fn()} onQuickNote={onQuickNote} onAskNotebook={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Quick note/ }))
    expect(onQuickNote).toHaveBeenCalledTimes(1)
    expect(sent()).toEqual([{ event: 'menu_row_used', props: { menu: 'plus_sheet', row: 'quick_note' } }])
  })

  it('the photo row (a file input inside its label) counts once, not once per element', () => {
    spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true })
    render(<NotebookPlusSheet open onClose={vi.fn()} onQuickNote={vi.fn()} onPhoto={vi.fn()} />)
    fireEvent.click(screen.getByText(/Photo \/ chart screenshot/))
    expect(sent()).toEqual([{ event: 'menu_row_used', props: { menu: 'plus_sheet', row: 'photo' } }])
  })
})
