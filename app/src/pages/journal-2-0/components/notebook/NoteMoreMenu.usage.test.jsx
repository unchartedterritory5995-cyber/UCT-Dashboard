// Follow-up A fix round 1 (M2): the note More panel counts `menu_row_used` only for a press that does something: never
// a busy row (aria-disabled) and never a row pressed to close what it opened (aria-expanded="true").
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import NoteMoreMenu, { MORE_NOTE_ACTIONS } from './NoteMoreMenu'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('menu_row_used in the note More panel', () => {
  it('a busy row and a closing press count nothing; a real press counts once', () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true })
    render(
      <NoteMoreMenu>
        <button type="button" data-row="lock" aria-disabled="true">Lock</button>
        <button type="button" data-row="export" aria-haspopup="menu" aria-expanded="true">Export</button>
        <button type="button" data-row="history">History</button>
      </NoteMoreMenu>,
    )
    fireEvent.click(screen.getByRole('button', { name: MORE_NOTE_ACTIONS }))
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    const sent = spy.mock.calls.filter(([u]) => u === '/api/j2/telemetry').map(([, i]) => JSON.parse(i.body))
    expect(sent).toEqual([{ event: 'menu_row_used', props: { menu: 'note_more', row: 'history' } }])
  })
})
