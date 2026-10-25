// Notebook widgets phase 2 (wave 8, Task 8.18): the "My tools" header action on the REAL Notebook tab, with only the
// network faked. ⛔ The wave gates the door: off, there is no button a member could press. Each absent case has a
// control proving the list header itself rendered (the Import button).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFetch, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import NotebookTab from './NotebookTab'
import { openMyTools } from '../components/notebook/myTools/openMyTools.js'

// My tools has its own rails (MyToolsSheet tests, galleryDoor.test.jsx): here only that the tab's door asks for it.
vi.mock('../components/notebook/myTools/openMyTools.js', () => ({ openMyTools: vi.fn(() => () => {}) }))

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })

beforeEach(() => {
  installFetch([[/mapping-offer$/, { offer: null }]])
  vi.mocked(openMyTools).mockClear()
})
afterEach(() => { cleanup(); __resetNotebookFlags() })

async function show() {
  render(<Providers route="/journal/notebook?view=all"><NotebookTab /></Providers>)
  await settle()
  expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument()   // control: the header rendered
}

describe('the My tools door on the Notebook tab', () => {
  it('my_tools_header_action_only_when_w8_on', async () => {
    latchNotebookFlags({ notebook_widgets_w8_enabled: true })
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'My tools' }))
    await waitFor(() => expect(openMyTools).toHaveBeenCalledTimes(1))
    const args = vi.mocked(openMyTools).mock.calls[0][0]
    expect(args.tab).toBe('widgets')
    expect(typeof args.navigate).toBe('function')        // R-45: links out of My tools go through the router
  })

  it('has no My tools button while wave 8 is off', async () => {
    latchNotebookFlags({ notebook_widgets_w8_enabled: false, notebook_widgets_w5_enabled: true })
    await show()
    expect(screen.queryByRole('button', { name: 'My tools' })).toBeNull()
  })

  it('has no My tools button when the server never said', async () => {
    await show()
    expect(screen.queryByRole('button', { name: 'My tools' })).toBeNull()
  })
})
