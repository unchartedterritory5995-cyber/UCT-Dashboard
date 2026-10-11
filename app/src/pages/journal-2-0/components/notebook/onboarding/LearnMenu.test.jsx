// Research Home's "Learn" menu (Notebook UX pass, 2026-10-10), rendered.
//
// ⛔ The registry is extended here with one extra tour on a dark flag, so "the menu is DERIVED"
// has a tour to arm and disarm (the same fake-registry approach GettingStartedChecklist.test.jsx
// uses). ⛔ Copy and roles are asserted as rendered, after the action settles. ⛔ Starting a tour
// is read off the events the existing gates listen for -- no new tour machinery.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

// P0.12 / P0.15: the sample item, the navigation after it, the cache refresh and the phone
// sheet are all seams the menu reaches through its imports, so each is a mock here.
const { sampleMock, navigateMock, mutateMock, phone } = vi.hoisted(() => ({
  sampleMock: vi.fn(),
  navigateMock: vi.fn(),
  mutateMock: vi.fn(),
  phone: { on: false },
}))
vi.mock('./sampleNotebook', async (importOriginal) => ({
  ...(await importOriginal()),
  addSampleNotebook: (...a) => sampleMock(...a),
}))
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigateMock,
}))
vi.mock('swr', async (importOriginal) => ({
  ...(await importOriginal()),
  useSWRConfig: () => ({ mutate: mutateMock }),
}))
vi.mock('../../../../../hooks/useBreakpoint', async (importOriginal) => ({
  ...(await importOriginal()),
  useIsPhone: () => phone.on,
  useIsTouch: () => phone.on,
}))

vi.mock('./tourRegistry', async (importOriginal) => {
  const real = await importOriginal()
  const TOUR_REGISTRY = Object.freeze([
    ...real.TOUR_REGISTRY.filter((t) => t.id === real.BASE_TOUR_ID),
    Object.freeze({ id: 'learn-formulas', flag: 'notebook_formulas_enabled', title: 'Formulas', replayable: true, load: async () => ({}) }),
    // a real Trading-group id on its own (dark) flag, so the grouped menu has a second group to show
    Object.freeze({ id: 'chart-plan-basics', flag: 'notebook_chart_plan_enabled', title: 'Chart plan basics', replayable: true, load: async () => ({}) }),
    // the real voice tour's id (its first anchor, the New note control, exists only once a member has notes)
    Object.freeze({ id: 'voice-notes', flag: 'notebook_voice_notes_enabled', title: 'Voice notes', replayable: true, load: async () => ({}) }),
    Object.freeze({ id: 'learn-explainer', flag: 'notebook_formulas_enabled', title: 'An explainer', replayable: false, load: async () => ({}) }),
  ])
  return {
    ...real,
    TOUR_REGISTRY,
    replayableTours: (registry = TOUR_REGISTRY) => real.replayableTours(registry),
  }
})

import LearnMenu from './LearnMenu'
import { AuthContext } from '../../../../../context/AuthContext'
import { SAMPLE_COPY, isNotebookKey } from './sampleNotebook'
import { LEARN_COPY } from './learnTours'
import { PREVIEW_COPY, CAPABILITY_PREVIEW } from './capabilityList'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { TOUR_OPEN_EVENT, __resetTourControl } from './tourControl'
import { REGISTRY_TOUR_OPEN_EVENT, __resetRegistryTourControl } from './tourRegistryControl'

const WAVE14 = Object.freeze({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true })

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{`${loc.pathname}${loc.hash}`}</p>
}

function renderMenu({ isPaid = false, hasAnyNotes = false } = {}) {
  return render(
    <AuthContext.Provider value={{ isPaid }}>
      <MemoryRouter initialEntries={['/journal/notebook']}>
        <button type="button">before</button>
        <LearnMenu hasAnyNotes={hasAnyNotes} />
        <Routes><Route path="*" element={<Where />} /></Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

const menuItems = () => within(screen.getByRole('menu', { name: 'Learn: walkthroughs' })).getAllByRole('menuitem')

// Residual round (R25): the menu BEHIND the Learn button is a lazy chunk, fetched on the first press
// (LearnMenu.jsx -> LearnMenuPanel.jsx). React.lazy resolves once per page, so one warm-up press here
// lets every later case in this file find the menu synchronously, as before. The first-press path
// itself (button drawn at once, menu after the chunk, one fetch) is held by LearnMenu.lazy.test.jsx,
// which is its own file so its module registry is fresh.
beforeAll(async () => {
  latchNotebookFlags(WAVE14)
  const warm = renderMenu()
  fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
  await screen.findByRole('menu')
  warm.unmount()
  __resetNotebookFlags()
})

beforeEach(() => {
  __resetNotebookFlags()
  __resetTourControl()
  __resetRegistryTourControl()
  phone.on = false
  navigateMock.mockReset()
  mutateMock.mockReset()
  sampleMock.mockReset()
  sampleMock.mockResolvedValue({ ok: true, folderId: 'f1', welcomeNoteId: 'w1' })
})
afterEach(() => {
  __resetNotebookFlags()
  vi.restoreAllMocks()
})

const flagged = (...extra) => ({ ...WAVE14, ...Object.fromEntries(extra.map((k) => [k, true])) })

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

  it('I3: the voice-notes tour is NOT offered while the member has no notes (its first anchor does not exist yet)', () => {
    latchNotebookFlags({ ...WAVE14, notebook_voice_notes_enabled: true })
    renderMenu({ hasAnyNotes: false })
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    expect(screen.queryByRole('menuitem', { name: 'Voice notes tour' })).toBeNull()
    // the other live tours are untouched (non-vacuity: the menu really did render its tours)
    expect(menuItems().map((el) => el.textContent)).toEqual(['Notebook basics tour', 'What your Notebook can do', 'All walkthroughs in Help'])
  })

  it('I3: the voice-notes tour IS offered once the member has notes (and by default, when the caller does not say)', () => {
    latchNotebookFlags({ ...WAVE14, notebook_voice_notes_enabled: true })
    const first = renderMenu({ hasAnyNotes: true })
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    expect(menuItems().map((el) => el.textContent)).toEqual(['Notebook basics tour', 'Voice notes tour', 'What your Notebook can do', 'All walkthroughs in Help'])
    first.unmount()
    render(
      <AuthContext.Provider value={{ isPaid: false }}>
        <MemoryRouter initialEntries={['/journal/notebook']}><LearnMenu /></MemoryRouter>
      </AuthContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    expect(screen.getByRole('menuitem', { name: 'Voice notes tour' })).toBeInTheDocument()
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

// Integrator, measured in a browser at 390 px: the menu hung from the button's right edge and
// started 30 px off the left of the screen. It is shifted back inside a 16 px gutter on open.
describe('the open menu stays on screen', () => {
  // The popover (menu + status line) is what is measured and shifted; the menu is inside it.
  const isPopover = (el) => el.hasAttribute('data-learn-popover')
  const rectOf = (left, width) => () => ({ left, right: left + width, top: 0, bottom: 420, width, height: 420, x: left, y: 0 })

  it('shifts right when it would start off the left edge', () => {
    latchNotebookFlags(WAVE14)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      return isPopover(this) ? rectOf(-30, 280)() : rectOf(0, 0)()
    })
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    expect(screen.getByRole('menu').closest('[data-learn-popover]').style.transform).toBe('translateX(46px)')
  })

  it('shifts left when it would run off the right edge, and leaves a menu that fits alone', () => {
    latchNotebookFlags(WAVE14)
    const vw = window.innerWidth
    let left = vw - 100
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      return isPopover(this) ? rectOf(left, 280)() : rectOf(0, 0)()
    })
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    expect(screen.getByRole('menu').closest('[data-learn-popover]').style.transform).toBe(`translateX(${(vw - 16) - (left + 280)}px)`)
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))   // close
    left = 100
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    expect(screen.getByRole('menu').closest('[data-learn-popover]').style.transform).toBe('')
  })
})

// ── P0.12: the menu is grouped ─────────────────────────────────────────────────────────────
describe('grouped by what a member is trying to do', () => {
  it('groups tours under Basics, Writing and capture, Trading, Research (only the non-empty ones)', () => {
    latchNotebookFlags(flagged('notebook_chart_plan_enabled', 'notebook_formulas_enabled'))
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    const groups = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))
    expect(groups).toEqual(expect.arrayContaining(['Basics', 'Trading']))
    // an empty group is not drawn (no Research tour is live in this registry)
    expect(groups).not.toContain('Research')
  })

  it('each tour sits in the group learnTourGroup names, and the groups read in the declared order', () => {
    latchNotebookFlags(flagged('notebook_chart_plan_enabled', 'notebook_formulas_enabled'))
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    const menu = screen.getByRole('menu', { name: 'Learn: walkthroughs' })
    const basics = within(within(menu).getByRole('group', { name: 'Basics' })).getAllByRole('menuitem').map((e) => e.textContent)
    const trading = within(within(menu).getByRole('group', { name: 'Trading' })).getAllByRole('menuitem').map((e) => e.textContent)
    expect(basics).toEqual(['Notebook basics tour', 'Formulas tour'])   // formulas is not in the map: it falls back to Basics
    expect(trading).toEqual(['Chart plan basics tour'])
    const order = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))
    expect(order.indexOf('Basics')).toBeLessThan(order.indexOf('Trading'))
  })

  it('a group heading is visible text, not only a label', () => {
    latchNotebookFlags(flagged('notebook_chart_plan_enabled'))
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    const trading = screen.getByRole('group', { name: 'Trading' })
    expect(within(trading).getByText('Trading')).toBeInTheDocument()
  })
})

// ── P0.15: the sample notebook, from Learn ─────────────────────────────────────────────────
describe('"Add the sample notebook"', () => {
  it('is offered to a paid member with onboarding on', () => {
    latchNotebookFlags(WAVE14)
    renderMenu({ isPaid: true })
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    expect(screen.getByRole('menuitem', { name: 'Add the sample notebook' })).toBeTruthy()
  })

  // R15 (D-C6): the server refuses the sample (409) to a member with ANY note, active, archived or
  // trashed, so Learn offers it only to a member with none.
  it('is offered only to a member with no notes: absent once they have one', () => {
    latchNotebookFlags(WAVE14)
    renderMenu({ isPaid: true, hasAnyNotes: true })
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Add the sample notebook' })).toBeNull()
  })

  it('fails closed: a caller that does not say whether there are notes gets no sample item', () => {
    latchNotebookFlags(WAVE14)
    render(
      <AuthContext.Provider value={{ isPaid: true }}>
        <MemoryRouter><LearnMenu /></MemoryRouter>
      </AuthContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    expect(screen.queryByRole('menuitem', { name: 'Add the sample notebook' })).toBeNull()
  })

  it('its status line is mounted from the start (empty), so the refusal is announced when its text arrives', async () => {
    latchNotebookFlags(WAVE14)
    sampleMock.mockResolvedValueOnce({ ok: false, message: SAMPLE_COPY.refused })
    renderMenu({ isPaid: true })
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add the sample notebook' }))
    await vi.waitFor(() => expect(status).toHaveTextContent(SAMPLE_COPY.refused))
    expect(screen.getByRole('status')).toBe(status)   // the same node, text swapped
  })

  it('is never offered to a member who is not paid', () => {
    latchNotebookFlags(WAVE14)
    renderMenu({ isPaid: false })
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    expect(screen.queryByRole('menuitem', { name: 'Add the sample notebook' })).toBeNull()
  })

  it('sits after the tours and before the Help link, and the arrow keys walk onto it', async () => {
    const user = userEvent.setup()
    latchNotebookFlags(WAVE14)
    renderMenu({ isPaid: true })
    const btn = screen.getByRole('button', { name: 'Learn' })
    btn.focus()
    await user.keyboard('{Enter}')
    expect(menuItems().map((el) => el.textContent))
      .toEqual(['Notebook basics tour', 'Add the sample notebook', 'All walkthroughs in Help'])
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toHaveTextContent('Add the sample notebook')
  })

  it('on success it asks the notebook lists to refresh, opens the welcome note, and closes the menu', async () => {
    latchNotebookFlags(WAVE14)
    renderMenu({ isPaid: true })
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add the sample notebook' }))
    await vi.waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/journal/notebook?note=w1'))
    expect(sampleMock).toHaveBeenCalledTimes(1)
    // the SAME key predicate Research Home uses (one authority, imported from sampleNotebook.js)
    expect(mutateMock).toHaveBeenCalledWith(isNotebookKey)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('sample409: an existing sample shows the refusal, creates nothing, and leaves the menu open', async () => {
    latchNotebookFlags(WAVE14)
    sampleMock.mockResolvedValueOnce({ ok: false, message: SAMPLE_COPY.refused })
    renderMenu({ isPaid: true })
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add the sample notebook' }))
    expect(await screen.findByText(SAMPLE_COPY.refused)).toBeTruthy()
    expect(screen.getByText(SAMPLE_COPY.refused).closest('[role="status"]')).not.toBeNull()
    expect(navigateMock).not.toHaveBeenCalled()
    expect(mutateMock).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('says it is working while it adds, and a second press does not add a second sample', async () => {
    latchNotebookFlags(WAVE14)
    let finish
    sampleMock.mockReturnValueOnce(new Promise((r) => { finish = r }))
    renderMenu({ isPaid: true })
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add the sample notebook' }))
    const busy = await screen.findByRole('menuitem', { name: SAMPLE_COPY.adding })
    fireEvent.click(busy)
    expect(sampleMock).toHaveBeenCalledTimes(1)
    finish({ ok: true, folderId: 'f1', welcomeNoteId: 'w1' })
    await vi.waitFor(() => expect(navigateMock).toHaveBeenCalledTimes(1))
  })
})

// ── P0.12: on a phone the menu is a sheet ──────────────────────────────────────────────────
describe('on a phone the menu opens as a sheet', () => {
  it('on a phone the menu opens as a sheet', () => {
    phone.on = true
    latchNotebookFlags(WAVE14)
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    expect(screen.getByRole('dialog', { name: LEARN_COPY.menuLabel })).toBeTruthy()
    // the same menu, inside it
    expect(within(screen.getByRole('dialog')).getAllByRole('menuitem').map((e) => e.textContent))
      .toEqual(['Notebook basics tour', 'All walkthroughs in Help'])
  })

  it('on a desktop it is the anchored popover, not a dialog', () => {
    phone.on = false
    latchNotebookFlags(WAVE14)
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('menu', { name: 'Learn: walkthroughs' })).toBeInTheDocument()
  })

  it('a choice in the sheet starts the tour and closes the sheet', () => {
    phone.on = true
    latchNotebookFlags(WAVE14)
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    const base = vi.fn()
    window.addEventListener(TOUR_OPEN_EVENT, base)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Notebook basics tour' }))
    window.removeEventListener(TOUR_OPEN_EVENT, base)
    expect(base).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Learn' }))
  })

  it('Escape closes the sheet and focus returns to the Learn button', async () => {
    const user = userEvent.setup()
    phone.on = true
    latchNotebookFlags(WAVE14)
    renderMenu()
    const btn = screen.getByRole('button', { name: 'Learn' })
    btn.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: LEARN_COPY.menuLabel })).toBeInTheDocument()
    expect(document.activeElement).toHaveTextContent('Notebook basics tour')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(btn)
  })

  it('the sample item works inside the sheet too', async () => {
    phone.on = true
    latchNotebookFlags(WAVE14)
    sampleMock.mockResolvedValueOnce({ ok: false, message: SAMPLE_COPY.refused })
    renderMenu({ isPaid: true })
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('menuitem', { name: 'Add the sample notebook' }))
    expect(await within(screen.getByRole('dialog')).findByText(SAMPLE_COPY.refused)).toBeTruthy()
  })
})

// ── Task 14b (ruling R16): "What your Notebook can do", the catalog every member can reach ────
// The audit's rows 29 (Compass reads notes) and 53 (terminal commands in notes) had no door. The
// capability preview was shown only on the first-run welcome; this opens the SAME component in a
// Sheet from Learn. It is lazy (a chunk), so every find here awaits it.
const CATALOG = PREVIEW_COPY.heading
const entry = (id) => CAPABILITY_PREVIEW.find((c) => c.id === id)
const openLearn = () => fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
const openCatalog = async () => {
  openLearn()
  fireEvent.click(screen.getByRole('menuitem', { name: CATALOG }))
  return screen.findByRole('dialog', { name: CATALOG })
}

describe('"What your Notebook can do" -- the Learn item', () => {
  it("is named by the preview's own heading (one authority), not a second copy", () => {
    expect(CATALOG).toBe('What your Notebook can do')
  })

  it('sits after the tours and before the sample and the Help link', () => {
    latchNotebookFlags(flagged('notebook_playbook_enabled'))
    renderMenu({ isPaid: true })
    openLearn()
    expect(menuItems().map((el) => el.textContent)).toEqual([
      'Notebook basics tour', CATALOG, 'Add the sample notebook', 'All walkthroughs in Help',
    ])
  })

  it("is one of the menu's own items: a real menuitem button the arrow keys walk onto", async () => {
    const user = userEvent.setup()
    latchNotebookFlags(flagged('notebook_playbook_enabled'))
    renderMenu()
    screen.getByRole('button', { name: 'Learn' }).focus()
    await user.keyboard('{Enter}')
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toHaveTextContent(CATALOG)
    expect(document.activeElement.tagName).toBe('BUTTON')
  })

  it('is not offered when no capability is armed: there is nothing to list, so no empty sheet', () => {
    latchNotebookFlags(WAVE14)
    renderMenu({ isPaid: true, hasAnyNotes: true })
    openLearn()
    expect(screen.queryByRole('menuitem', { name: CATALOG })).toBeNull()
  })
})

describe('"What your Notebook can do" -- the Sheet', () => {
  it('opens the capability preview in a dialog named by its title, and closes the menu', async () => {
    latchNotebookFlags(flagged('notebook_playbook_enabled'))
    renderMenu({ hasAnyNotes: true })
    const dlg = await openCatalog()
    expect(screen.queryByRole('menu')).toBeNull()
    const list = await within(dlg).findByRole('list', { name: CATALOG })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(list).toHaveTextContent(`${entry('playbook').label}. ${entry('playbook').line}`)
  })

  it('reaches EVERY member: with notes, without notes, paid or not', async () => {
    for (const [isPaid, hasAnyNotes] of [[true, true], [true, false], [false, true], [false, false]]) {
      __resetNotebookFlags()
      latchNotebookFlags(flagged('notebook_playbook_enabled'))
      const { unmount } = renderMenu({ isPaid, hasAnyNotes })
      const dlg = await openCatalog()
      expect(await within(dlg).findByRole('list', { name: CATALOG }), `paid ${isPaid}, notes ${hasAnyNotes}`).toBeTruthy()
      unmount()
    }
  })

  it('shows the title once: the preview leaves its own heading out under the dialog title', async () => {
    latchNotebookFlags(flagged('notebook_playbook_enabled'))
    renderMenu()
    const dlg = await openCatalog()
    await within(dlg).findByRole('list', { name: CATALOG })
    expect(within(dlg).queryByRole('heading', { name: CATALOG })).toBeNull()
    expect(within(dlg).getAllByText(CATALOG)).toHaveLength(1)
  })

  it.each([
    ['terminal-links', 'notebook_terminal_links_enabled'],
    ['compass-notes', 'compass_notes_tool_enabled'],
  ])('%s is in the sheet when its own gate is armed, and absent when it is dark', async (id, flag) => {
    latchNotebookFlags(flagged('notebook_playbook_enabled', flag))
    const armed = renderMenu({ hasAnyNotes: true })
    let dlg = await openCatalog()
    expect(await within(dlg).findByText(`${entry(id).label}.`)).toBeInTheDocument()
    expect(dlg).toHaveTextContent(entry(id).line)
    armed.unmount()
    __resetNotebookFlags()
    latchNotebookFlags({ ...flagged('notebook_playbook_enabled'), [flag]: false })
    renderMenu({ hasAnyNotes: true })
    dlg = await openCatalog()
    await within(dlg).findByRole('list', { name: CATALOG })
    expect(dlg.textContent).not.toContain(entry(id).label)
  })

  it('Escape closes it and focus returns to the Learn button', async () => {
    const user = userEvent.setup()
    latchNotebookFlags(flagged('notebook_playbook_enabled'))
    renderMenu()
    const btn = screen.getByRole('button', { name: 'Learn' })
    btn.focus()
    await user.keyboard('{Enter}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog', { name: CATALOG })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(btn)
  })

  it('the Close button closes it and focus returns to the Learn button', async () => {
    latchNotebookFlags(flagged('notebook_playbook_enabled'))
    renderMenu()
    const dlg = await openCatalog()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Learn' }))
  })

  it('on a phone the menu sheet is REPLACED by the catalog sheet, never stacked under it', async () => {
    phone.on = true
    latchNotebookFlags(flagged('notebook_playbook_enabled'))
    renderMenu()
    openLearn()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('menuitem', { name: CATALOG }))
    const dlg = await screen.findByRole('dialog', { name: CATALOG })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(await within(dlg).findByRole('list', { name: CATALOG })).toBeTruthy()
  })
})

// R15 (D-C6) inside the sheet: the preview's own sample offer shows ONLY to a member with no notes.
describe('"What your Notebook can do" -- the sample offer follows R15', () => {
  const promo = (dlg) => within(dlg).queryByText(PREVIEW_COPY.sampleLead, { exact: false })
  const sampleButton = (dlg) => within(dlg).queryByRole('button', { name: 'Add a sample notebook' })

  it('hasAnyNotes false and paid: the promotion and a button that adds it', async () => {
    latchNotebookFlags(flagged('notebook_playbook_enabled'))
    renderMenu({ isPaid: true, hasAnyNotes: false })
    const dlg = await openCatalog()
    await within(dlg).findByRole('list', { name: CATALOG })
    expect(promo(dlg)).toBeTruthy()
    expect(sampleButton(dlg)).toBeTruthy()
    expect(sampleButton(dlg)).toHaveAccessibleDescription(new RegExp(PREVIEW_COPY.sampleLead.replace('?', '\\?')))
    fireEvent.click(sampleButton(dlg))
    await vi.waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/journal/notebook?note=w1'))
    expect(sampleMock).toHaveBeenCalledTimes(1)
    expect(mutateMock).toHaveBeenCalledWith(isNotebookKey)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('hasAnyNotes true: no promotion, no button', async () => {
    latchNotebookFlags(flagged('notebook_playbook_enabled'))
    renderMenu({ isPaid: true, hasAnyNotes: true })
    const dlg = await openCatalog()
    await within(dlg).findByRole('list', { name: CATALOG })
    expect(promo(dlg)).toBeNull()
    expect(sampleButton(dlg)).toBeNull()
  })

  it('fails closed: a caller that does not say whether there are notes gets no offer', async () => {
    latchNotebookFlags(flagged('notebook_playbook_enabled'))
    render(
      <AuthContext.Provider value={{ isPaid: true }}>
        <MemoryRouter><LearnMenu /></MemoryRouter>
      </AuthContext.Provider>,
    )
    const dlg = await openCatalog()
    await within(dlg).findByRole('list', { name: CATALOG })
    expect(promo(dlg)).toBeNull()
    expect(sampleButton(dlg)).toBeNull()
  })

  it('a member who is not paid is never offered it (the server refuses it to them)', async () => {
    latchNotebookFlags(flagged('notebook_playbook_enabled'))
    renderMenu({ isPaid: false, hasAnyNotes: false })
    const dlg = await openCatalog()
    await within(dlg).findByRole('list', { name: CATALOG })
    expect(promo(dlg)).toBeNull()
    expect(sampleButton(dlg)).toBeNull()
  })

  it('a refusal is said inside the sheet (a status line mounted from the start) and nothing is created', async () => {
    latchNotebookFlags(flagged('notebook_playbook_enabled'))
    sampleMock.mockResolvedValueOnce({ ok: false, message: SAMPLE_COPY.refused })
    renderMenu({ isPaid: true, hasAnyNotes: false })
    const dlg = await openCatalog()
    await within(dlg).findByRole('list', { name: CATALOG })
    const status = within(dlg).getByRole('status')
    expect(status).toHaveTextContent('')
    fireEvent.click(sampleButton(dlg))
    await vi.waitFor(() => expect(within(dlg).getByRole('status')).toHaveTextContent(SAMPLE_COPY.refused))
    expect(within(dlg).getByRole('status')).toBe(status)
    expect(navigateMock).not.toHaveBeenCalled()
    expect(mutateMock).not.toHaveBeenCalled()
  })
})
