import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Wave 6 lane E fix round 1, I6 — NoteLinkView.jsx called
// `navigate(notePath(id))` directly: Ctrl/Cmd+click did not open the target
// beside, and a plain click on an in-body link inside the side pane
// collapsed the split (it always navigated the whole route, never "this
// pane"). `NotebookTab.split.test.jsx`'s own split rail passed the whole
// time regardless of this bug: its STUB editor's "note link" already routed
// through `useNoteNavigation` on its own, so it was never exercising the
// real NoteLinkView at all -- say so here rather than re-trusting that file.
// This renders the REAL component (same mocking shape as NoteLinkView.test.jsx,
// which covers the un-split, plain-route case and needs no change: outside any
// provider, useNoteNavigation's fallback IS `navigate(notePath(id))`).

const navSpy = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navSpy }))

let targetResult
vi.mock('../../hooks/useNoteLinkTarget', () => ({
  default: () => targetResult,
}))

import NoteLinkView from './NoteLinkView'
import { SplitViewContext, NotePaneContext } from '../../lib/splitView'

function nodeFor(noteId) {
  return { attrs: { noteId } }
}

beforeEach(() => {
  navSpy.mockClear()
  targetResult = { status: 'active', title: 'Target' }
})

describe('NoteLinkView — split view (wave 6 fix round 1, I6)', () => {
  it('Ctrl/Cmd+click opens the target beside, where the page can split', () => {
    const openToSide = vi.fn()
    render(
      <SplitViewContext.Provider value={{ canSplit: true, openToSide }}>
        <NoteLinkView node={nodeFor('n2')} />
      </SplitViewContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button'), { metaKey: true })
    expect(openToSide).toHaveBeenCalledWith('n2')
    expect(navSpy).not.toHaveBeenCalled()
  })

  it('a plain click inside the side pane navigates THAT pane, never the main route', () => {
    const paneOpen = vi.fn()
    render(
      <NotePaneContext.Provider value={{ pane: 'side', open: paneOpen }}>
        <NoteLinkView node={nodeFor('n3')} />
      </NotePaneContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(paneOpen).toHaveBeenCalledWith('n3')
    expect(navSpy).not.toHaveBeenCalled()
  })

  it('CONTROL: a plain click where the page CAN split but is not split yet still uses the ordinary route', () => {
    const openToSide = vi.fn()
    render(
      <SplitViewContext.Provider value={{ canSplit: true, openToSide }}>
        <NoteLinkView node={nodeFor('n4')} />
      </SplitViewContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(openToSide).not.toHaveBeenCalled()
    expect(navSpy).toHaveBeenCalledWith('/journal/notebook?note=n4')
  })
})
