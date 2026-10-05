// FIX 1: deleting the currently-open board must clear `currentBoard`, so the toolbar
// stops claiming a deleted board is active. Scoped narrowly to the Boards sheet — heavy,
// network-dependent children (chart panels, command line, help panel, the L0 strip) are
// stubbed so this exercises only the delete -> currentBoard wiring in TerminalShell.jsx.
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import TerminalShell from './TerminalShell'
import { AuthContext } from '../../context/AuthContext'
import { emptyLibrary, saveBoard, defaultLayout } from './boardModel'
import { TERMINAL_LAYOUT_PREF, TERMINAL_BOARDS_PREF } from './useTerminalLayout'

vi.mock('./CommandLine', () => ({ default: () => <div data-testid="stub-command-line" /> }))
vi.mock('./L0Strip', () => ({ default: () => <div data-testid="stub-l0-strip" /> }))
vi.mock('./panels/HelpPanel', () => ({ default: () => <div data-testid="stub-help-panel" /> }))
vi.mock('./panels', () => ({
  panelComponent: () => null,
  panelNameFor: () => null,
  URL_OWNING_PANELS: new Set(),
}))

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

function buildPrefs() {
  const layout = defaultLayout()
  const { library } = saveBoard(emptyLibrary(), 'Swing Board', layout, {}, 1000)
  return {
    [TERMINAL_LAYOUT_PREF]: JSON.stringify(layout),
    [TERMINAL_BOARDS_PREF]: JSON.stringify(library),
  }
}

async function flush() {
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() })
}

function renderShell(prefs) {
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u.startsWith('/api/auth/preferences')) return res(200, prefs)
    return res(404, {})
  })
  return render(
    <AuthContext.Provider value={{ cohorts: ['terminal-next'], addressSpaceEnabled: true }}>
      <MemoryRouter initialEntries={['/terminal']}>
        <TerminalShell />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

afterEach(() => { delete global.fetch })

test('deleting the open board clears currentBoard and the toolbar stops naming it', async () => {
  const prefs = buildPrefs()
  renderShell(prefs)
  await flush()

  // Open the Boards sheet and open the saved board, so it becomes the current one.
  fireEvent.click(screen.getByTestId('terminal-boards-button'))
  await flush()
  fireEvent.click(screen.getByText('Swing Board'))
  await flush()

  // The toolbar now names the open board.
  expect(screen.getByTestId('terminal-boards-button').textContent).toBe('Board: Swing Board')

  // Re-open the Boards sheet and delete it.
  fireEvent.click(screen.getByTestId('terminal-boards-button'))
  await flush()
  fireEvent.click(screen.getByLabelText('Delete Swing Board'))
  await flush()

  // The toolbar must fall back to the generic label — not keep claiming the deleted
  // board is still open.
  expect(screen.getByTestId('terminal-boards-button').textContent).toBe('Boards')
})

test('deleting a DIFFERENT board while one is open leaves currentBoard untouched', async () => {
  const layout = defaultLayout()
  let library = saveBoard(emptyLibrary(), 'Swing Board', layout, {}, 1000).library
  library = saveBoard(library, 'Earnings Board', layout, {}, 2000).library
  const prefs = {
    [TERMINAL_LAYOUT_PREF]: JSON.stringify(layout),
    [TERMINAL_BOARDS_PREF]: JSON.stringify(library),
  }
  renderShell(prefs)
  await flush()

  fireEvent.click(screen.getByTestId('terminal-boards-button'))
  await flush()
  fireEvent.click(screen.getByText('Swing Board'))
  await flush()
  expect(screen.getByTestId('terminal-boards-button').textContent).toBe('Board: Swing Board')

  fireEvent.click(screen.getByTestId('terminal-boards-button'))
  await flush()
  fireEvent.click(screen.getByLabelText('Delete Earnings Board'))
  await flush()

  // The OPEN board's name must survive deleting an unrelated one.
  expect(screen.getByTestId('terminal-boards-button').textContent).toBe('Board: Swing Board')
})
