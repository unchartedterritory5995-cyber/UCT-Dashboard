// Research Home's "Learn" menu (Notebook UX pass, 2026-10-10), rendered.
//
// ⛔ The registry is extended here with one extra tour on a dark flag, so "the menu is DERIVED"
// has a tour to arm and disarm (the same fake-registry approach GettingStartedChecklist.test.jsx
// uses). ⛔ Copy and roles are asserted as rendered, after the action settles. ⛔ Starting a tour
// is read off the events the existing gates listen for -- no new tour machinery.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

vi.mock('./tourRegistry', async (importOriginal) => {
  const real = await importOriginal()
  const TOUR_REGISTRY = Object.freeze([
    ...real.TOUR_REGISTRY.filter((t) => t.id === real.BASE_TOUR_ID),
    Object.freeze({ id: 'learn-formulas', flag: 'notebook_formulas_enabled', title: 'Formulas', replayable: true, load: async () => ({}) }),
    Object.freeze({ id: 'learn-explainer', flag: 'notebook_formulas_enabled', title: 'An explainer', replayable: false, load: async () => ({}) }),
  ])
  return {
    ...real,
    TOUR_REGISTRY,
    replayableTours: (registry = TOUR_REGISTRY) => real.replayableTours(registry),
  }
})

import LearnMenu from './LearnMenu'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { TOUR_OPEN_EVENT, __resetTourControl } from './tourControl'
import { REGISTRY_TOUR_OPEN_EVENT, __resetRegistryTourControl } from './tourRegistryControl'

const WAVE14 = Object.freeze({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true })

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{`${loc.pathname}${loc.hash}`}</p>
}

function renderMenu() {
  return render(
    <MemoryRouter initialEntries={['/journal/notebook']}>
      <button type="button">before</button>
      <LearnMenu />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  )
}

const menuItems = () => within(screen.getByRole('menu', { name: 'Learn: walkthroughs' })).getAllByRole('menuitem')

beforeEach(() => {
  __resetNotebookFlags()
  __resetTourControl()
  __resetRegistryTourControl()
})
afterEach(() => {
  __resetNotebookFlags()
  vi.restoreAllMocks()
})

describe('when it shows', () => {
  it('nothing at all with the wave-14 switch off (the pre-wave-14 page)', () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: false, notebook_formulas_enabled: true })
    renderMenu()
    expect(screen.queryByRole('button', { name: 'Learn' })).toBeNull()
  })

  it('a closed menu button: aria-haspopup="menu", aria-expanded false, no menu in the page', () => {
    latchNotebookFlags(WAVE14)
    renderMenu()
    const btn = screen.getByRole('button', { name: 'Learn' })
    expect(btn).toHaveAttribute('aria-haspopup', 'menu')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('what it lists -- DERIVED from the registry', () => {
  it('the live replayable tours, then the Help link; a dark tour is not there', () => {
    latchNotebookFlags(WAVE14)
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    expect(screen.getByRole('button', { name: 'Learn' })).toHaveAttribute('aria-expanded', 'true')
    expect(menuItems().map((el) => el.textContent)).toEqual(['Notebook basics tour', 'All walkthroughs in Help'])
  })

  it('arming the fake tour\'s flag adds it, in registry order; the passive explainer never appears', () => {
    latchNotebookFlags({ ...WAVE14, notebook_formulas_enabled: true })
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    expect(menuItems().map((el) => el.textContent))
      .toEqual(['Notebook basics tour', 'Formulas tour', 'All walkthroughs in Help'])
    expect(screen.queryByText(/An explainer/)).toBeNull()
  })

  it('the Help link goes to Help > Walkthroughs', () => {
    latchNotebookFlags(WAVE14)
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    const help = screen.getByRole('menuitem', { name: 'All walkthroughs in Help' })
    expect(help).toHaveAttribute('href', '/support#walkthroughs')
    fireEvent.click(help)
    expect(screen.getByTestId('where')).toHaveTextContent('/support#walkthroughs')
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('choosing a tour -- the existing start path', () => {
  it('a registry tour opens through openRegistryTour (its event, its id); the menu closes; focus is back on Learn', () => {
    latchNotebookFlags({ ...WAVE14, notebook_formulas_enabled: true })
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    const reg = vi.fn()
    const base = vi.fn()
    window.addEventListener(REGISTRY_TOUR_OPEN_EVENT, reg)
    window.addEventListener(TOUR_OPEN_EVENT, base)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Formulas tour' }))
    window.removeEventListener(REGISTRY_TOUR_OPEN_EVENT, reg)
    window.removeEventListener(TOUR_OPEN_EVENT, base)
    expect(reg).toHaveBeenCalledTimes(1)
    expect(reg.mock.calls[0][0].detail).toEqual({ tourId: 'learn-formulas' })
    expect(base).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Learn' }))
  })

  it('the base tour opens through its own door (openNotebookTour)', () => {
    latchNotebookFlags(WAVE14)
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    const base = vi.fn()
    window.addEventListener(TOUR_OPEN_EVENT, base)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Notebook basics tour' }))
    window.removeEventListener(TOUR_OPEN_EVENT, base)
    expect(base).toHaveBeenCalledTimes(1)
  })
})

describe('keyboard and screen reader -- the menu button pattern', () => {
  it('opening puts focus on the first item; Arrow keys walk, Home/End jump; Escape closes and focus returns to Learn', async () => {
    const user = userEvent.setup()
    latchNotebookFlags({ ...WAVE14, notebook_formulas_enabled: true })
    renderMenu()
    const btn = screen.getByRole('button', { name: 'Learn' })
    btn.focus()
    await user.keyboard('{Enter}')
    expect(document.activeElement).toHaveTextContent('Notebook basics tour')
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toHaveTextContent('Formulas tour')
    await user.keyboard('{End}')
    expect(document.activeElement).toHaveTextContent('All walkthroughs in Help')
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toHaveTextContent('Notebook basics tour')   // wraps
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toHaveTextContent('All walkthroughs in Help')
    await user.keyboard('{Home}')
    expect(document.activeElement).toHaveTextContent('Notebook basics tour')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(btn)
  })

  it('ArrowDown on the closed button opens it; the open button names the menu it controls', async () => {
    const user = userEvent.setup()
    latchNotebookFlags(WAVE14)
    renderMenu()
    const btn = screen.getByRole('button', { name: 'Learn' })
    btn.focus()
    await user.keyboard('{ArrowDown}')
    const menu = screen.getByRole('menu')
    expect(btn).toHaveAttribute('aria-controls', menu.id)
    expect(document.activeElement).toHaveTextContent('Notebook basics tour')
  })

  it('a press outside closes it', () => {
    latchNotebookFlags(WAVE14)
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'before' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
