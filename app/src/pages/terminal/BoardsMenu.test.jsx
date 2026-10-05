// FIX 2: an invalid per-ticker preset shows an error instead of silently clearing as if it
// had worked. FIX 4a (BoardsMenu half): `openToVersions` lands directly on Version history.
import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi } from 'vitest'
import { BoardsMenu } from './BoardsMenu'
import { emptyLibrary } from './boardModel'

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

function library(overrides = {}) {
  return {
    ...emptyLibrary(),
    boards: [{ id: 'b1', name: 'Swing Board', slug: 'swing-board', layout: {}, updatedAt: 1, openedAt: 1 }],
    ...overrides,
  }
}

function baseProps(overrides = {}) {
  return {
    library: library(),
    libraryWritable: true,
    currentName: null,
    onSave: vi.fn(),
    onOpen: vi.fn(),
    onDelete: vi.fn(),
    onPreset: vi.fn(),
    onKeepCalendar: vi.fn(),
    onShareCurrent: vi.fn(() => 'https://example.test/share'),
    onRestored: vi.fn(),
    ...overrides,
  }
}

afterEach(() => { delete global.fetch })

describe('FIX 2: preset ticker validation', () => {
  test('an invalid preset ticker shows an error and does NOT call onPreset or clear as if it worked', () => {
    const props = baseProps()
    render(<BoardsMenu {...props} />)

    const input = screen.getByTestId('terminal-board-preset-input-swing-board')
    fireEvent.change(input, { target: { value: 'not a ticker!!' } })
    fireEvent.click(screen.getByTestId('terminal-board-preset-swing-board'))

    expect(props.onPreset).not.toHaveBeenCalled()
    expect(screen.getByTestId('terminal-board-preset-error-swing-board').textContent).toMatch(/isn.?t a ticker/i)
    // The input is NOT silently cleared — the member's typed text stays visible.
    expect(input.value).toBe('not a ticker!!')
  })

  test('a valid preset ticker (NVDA) is accepted: onPreset called, input cleared, no error', () => {
    const props = baseProps()
    render(<BoardsMenu {...props} />)

    const input = screen.getByTestId('terminal-board-preset-input-swing-board')
    fireEvent.change(input, { target: { value: 'nvda' } })
    fireEvent.click(screen.getByTestId('terminal-board-preset-swing-board'))

    expect(props.onPreset).toHaveBeenCalledWith('nvda', 'b1')
    expect(input.value).toBe('')
    expect(screen.queryByTestId('terminal-board-preset-error-swing-board')).toBeNull()
  })

  test('a valid class-share ticker (BRK.B) is accepted', () => {
    const props = baseProps()
    render(<BoardsMenu {...props} />)

    const input = screen.getByTestId('terminal-board-preset-input-swing-board')
    fireEvent.change(input, { target: { value: 'BRK.B' } })
    fireEvent.click(screen.getByTestId('terminal-board-preset-swing-board'))

    expect(props.onPreset).toHaveBeenCalledWith('BRK.B', 'b1')
  })

  test('the any-ticker wildcard "*" is accepted', () => {
    const props = baseProps()
    render(<BoardsMenu {...props} />)

    const input = screen.getByTestId('terminal-board-preset-input-swing-board')
    fireEvent.change(input, { target: { value: '*' } })
    fireEvent.click(screen.getByTestId('terminal-board-preset-swing-board'))

    expect(props.onPreset).toHaveBeenCalledWith('*', 'b1')
  })

  test('typing again after an error clears the error', () => {
    const props = baseProps()
    render(<BoardsMenu {...props} />)

    const input = screen.getByTestId('terminal-board-preset-input-swing-board')
    fireEvent.change(input, { target: { value: '???' } })
    fireEvent.click(screen.getByTestId('terminal-board-preset-swing-board'))
    expect(screen.getByTestId('terminal-board-preset-error-swing-board')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'AAPL' } })
    expect(screen.queryByTestId('terminal-board-preset-error-swing-board')).toBeNull()
  })
})

describe('FIX 4a: the banner opens version history directly', () => {
  async function flush() {
    await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() })
  }

  test('openToVersions=false (default): lands on the Boards menu with a "Version history" button, not the panel', () => {
    render(<BoardsMenu {...baseProps()} />)
    expect(screen.getByTestId('terminal-versions-open')).toBeInTheDocument()
    expect(screen.queryByTestId('terminal-versions')).toBeNull()
  })

  test('openToVersions=true: the version history panel is shown immediately, no second click needed', async () => {
    global.fetch = vi.fn(async () => res(200, { versions: [] }))
    render(<BoardsMenu {...baseProps()} openToVersions />)
    await flush()
    expect(screen.queryByTestId('terminal-versions-open')).toBeNull()
    expect(screen.getByTestId('terminal-versions')).toBeInTheDocument()
  })
})
