import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * Wave 6 (lane E, item 7) — the split-view gesture and the one note opener.
 * The wired behaviour (two panes, the refusals) is NotebookTab.split.test.jsx.
 */
const navSpy = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navSpy,
}))

import { NotePaneContext, SplitViewContext, isOpenBesideClick, useNoteNavigation } from './splitView'

beforeEach(() => navSpy.mockClear())

describe('isOpenBesideClick', () => {
  it('is Ctrl+click or Cmd+click with the primary button, and nothing else', () => {
    expect(isOpenBesideClick({ ctrlKey: true, button: 0 })).toBe(true)
    expect(isOpenBesideClick({ metaKey: true, button: 0 })).toBe(true)
    expect(isOpenBesideClick({ ctrlKey: true })).toBe(true)          // a synthetic click with no button
    expect(isOpenBesideClick({ button: 0 })).toBe(false)             // a plain click
    expect(isOpenBesideClick({ ctrlKey: true, shiftKey: true, button: 0 })).toBe(false)
    expect(isOpenBesideClick({ metaKey: true, altKey: true, button: 0 })).toBe(false)
    expect(isOpenBesideClick({ ctrlKey: true, button: 1 })).toBe(false) // middle click is the browser's
    expect(isOpenBesideClick(null)).toBe(false)
  })
})

function Link({ id }) {
  const go = useNoteNavigation()
  return <button type="button" onClick={(e) => go(id, e)}>open</button>
}

describe('useNoteNavigation', () => {
  it('outside the Notebook it is the route every note link always used', () => {
    render(<Link id="n7" />)
    fireEvent.click(screen.getByRole('button'), { ctrlKey: true })
    expect(navSpy).toHaveBeenCalledWith('/journal/notebook?note=n7')
  })

  it('Ctrl+click opens beside where the page can split — and only there', () => {
    const openToSide = vi.fn()
    const { rerender } = render(
      <SplitViewContext.Provider value={{ canSplit: true, openToSide }}><Link id="n7" /></SplitViewContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button'), { metaKey: true })
    expect(openToSide).toHaveBeenCalledWith('n7')
    expect(navSpy).not.toHaveBeenCalled()
    rerender(<SplitViewContext.Provider value={{ canSplit: false, openToSide }}><Link id="n7" /></SplitViewContext.Provider>)
    fireEvent.click(screen.getByRole('button'), { metaKey: true })
    expect(openToSide).toHaveBeenCalledTimes(1)
    expect(navSpy).toHaveBeenCalledWith('/journal/notebook?note=n7')
  })

  it('a plain click in a split page opens the note in its own pane', () => {
    const open = vi.fn()
    render(
      <SplitViewContext.Provider value={{ canSplit: true, openToSide: vi.fn() }}>
        <NotePaneContext.Provider value={{ pane: 'side', open }}><Link id="n7" /></NotePaneContext.Provider>
      </SplitViewContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(open).toHaveBeenCalledWith('n7')
    expect(navSpy).not.toHaveBeenCalled()
  })
})
