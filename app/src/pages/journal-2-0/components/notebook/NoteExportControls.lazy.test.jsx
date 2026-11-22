// Tier 1a bytes (perf-budgets.md): the PNG and print doors' module (lib/exportNote) is fetched when one is pressed, never
// when the controls mount (they sit in the note's More panel on every note). Its own file: the factory counter starts at 0.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const loads = vi.hoisted(() => ({ factoryRuns: 0, printNote: null }))
vi.mock('../../lib/exportNote', () => {
  loads.factoryRuns += 1
  loads.printNote = vi.fn()
  return { exportNoteAsPng: vi.fn(async () => ({ ok: true })), printNote: loads.printNote }
})

import NoteExportControls from './NoteExportControls'

describe('the export doors load their module on use', () => {
  it('mount fetches nothing; Print fetches it once and prints', async () => {
    render(<NoteExportControls noteId="n1" title="T" columnRef={{ current: null }} onMessage={() => {}} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(loads.factoryRuns).toBe(0)
    // Notebook simplify, Task 4: Print is an item of the Export menu.
    fireEvent.click(screen.getByRole('button', { name: /^export/i }))
    // Simplify pass 2: the menu itself is a held chunk (export/NoteExportMenu.jsx), here pressed before it landed.
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Print' }))
    await waitFor(() => expect(loads.printNote).toHaveBeenCalledTimes(1))
    expect(loads.factoryRuns).toBe(1)
  })
})
