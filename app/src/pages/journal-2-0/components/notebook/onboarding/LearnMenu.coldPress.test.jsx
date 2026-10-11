// Polish round (review I4-c): a COLD first press of the Learn button, with the REAL panel.
// LearnMenu.test.jsx warms the lazy chunk in `beforeAll` and LearnMenu.lazy.test.jsx stands a mock in
// for the panel, so neither walks the path a member takes on the first press of a page load: press,
// wait for the chunk, the real menu mounts already open. This file is its own module registry and
// does no warm-up, so its first press is that cold press.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import LearnMenu from './LearnMenu'
import { AuthContext } from '../../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { TOUR_OPEN_EVENT, __resetTourControl } from './tourControl'

const WAVE14 = Object.freeze({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true })

afterEach(() => { __resetNotebookFlags(); __resetTourControl() })

describe('the Learn menu on a cold first press (real panel, no warm-up)', () => {
  it('the menu arrives with focus inside it; Escape returns focus to Learn; a tour launches from it', async () => {
    const user = userEvent.setup()
    latchNotebookFlags(WAVE14)
    render(
      <AuthContext.Provider value={{ isPaid: false }}>
        <MemoryRouter initialEntries={['/journal/notebook']}>
          <LearnMenu hasAnyNotes />
        </MemoryRouter>
      </AuthContext.Provider>,
    )
    const learn = screen.getByRole('button', { name: 'Learn' })
    learn.focus()
    // A synchronous press (fireEvent), so nothing awaited here can let the chunk land early.
    fireEvent.click(learn)
    // Cold: the press is answered at once, but the menu is not on the page until the chunk lands,
    // and nothing names an id that does not exist yet.
    expect(learn).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(learn).not.toHaveAttribute('aria-controls')

    const menu = await screen.findByRole('menu', { name: 'Learn: walkthroughs' })
    expect(document.activeElement).toHaveTextContent('Notebook basics tour')
    expect(menu.contains(document.activeElement)).toBe(true)
    // named once the panel has mounted (its passive onReady, one commit after the menu appears)
    await waitFor(() => expect(learn).toHaveAttribute('aria-controls', menu.id))

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(learn).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(learn)

    fireEvent.click(learn)
    const base = vi.fn()
    window.addEventListener(TOUR_OPEN_EVENT, base)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Notebook basics tour' }))
    window.removeEventListener(TOUR_OPEN_EVENT, base)
    expect(base).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(learn)
  })
})
