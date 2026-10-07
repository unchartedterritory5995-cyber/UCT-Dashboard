// app/src/pages/journal-2-0/a11y/onboardingKeys.test.jsx
//
// Wave 14, lane W14-keys: the onboarding flows on KEYS (docs/notebook/wave14-keys.md).
// W14-Q1 measured every onboarding flow over budget on a keyboard and within budget on a
// pointer; the cost was the order of chrome, not the surfaces. This file rails the doors
// added for it, each with the wave-14 switch ON (the door exists) and OFF (nothing new
// renders), and each surface through axe:
//   * the get-started checklist's steps are ONE Tab stop (a vertical toolbar), its heading
//     is the landing of "Skip to getting started", and the list announces itself to that link;
//   * the offer card's two buttons are ONE Tab stop (a toolbar), and "Not now" declares the
//     Escape the card already honoured;
//   * "Skip to getting started" exists exactly while the checklist is on screen, and moves
//     focus to the checklist's heading.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installFetch, Providers } from './fixtures'
import { expectNoAxeViolations } from './axeHarness'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import GettingStartedChecklist from '../components/notebook/GettingStartedChecklist'
import TourOfferPrompt from '../components/notebook/onboarding/TourOfferPrompt'
import { OFFER_COPY } from '../components/notebook/onboarding/tourOfferCopy'
import { CHECKLIST_COPY } from '../components/notebook/onboarding/gettingStarted'
import {
  GettingStartedSkipLink, GETTING_STARTED_HEADING_ID, GETTING_STARTED_SKIP_TEXT,
} from '../components/notebook/onboarding/keyboardDoors'

const EMPTY_HOME = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }
const SWITCH_ON = { notebook_task_reminders_enabled: false, notebook_onboarding_enabled: true, notebook_getting_started_enabled: true }

function renderChecklist() {
  installFetch([
    [/^\/api\/auth\/preferences$/, {}],
    [/^\/api\/j2\/notebook\/home$/, EMPTY_HOME],
  ])
  return render(
    <Providers>
      <main>
        <GettingStartedSkipLink className="skip" />
        <GettingStartedChecklist hasAnyNotes={false} onCreateNote={() => {}} onAddSample={async () => {}} />
        <button type="button">after the list</button>
      </main>
    </Providers>,
  )
}

const tabbable = (root) => [...root.querySelectorAll('a[href], button:not([disabled])')]
  .filter((el) => el.tabIndex >= 0)

beforeEach(() => { __resetNotebookFlags() })
afterEach(() => { cleanup(); __resetNotebookFlags(); vi.restoreAllMocks() })

describe('the get-started checklist on keys', () => {
  it('its steps are ONE Tab stop: a vertical toolbar named for them, Arrow keys move inside it', async () => {
    latchNotebookFlags(SWITCH_ON)
    renderChecklist()
    const bar = await screen.findByRole('toolbar', { name: CHECKLIST_COPY.stepsLabel })
    expect(bar).toHaveAttribute('aria-orientation', 'vertical')
    const steps = [...bar.querySelectorAll('a[href], button')]
    expect(steps.length).toBeGreaterThanOrEqual(3)                 // non-vacuity: note, template, sample, tours
    expect(steps.filter((s) => s.tabIndex === 0)).toHaveLength(1)  // one stop
    expect(steps[0].tabIndex).toBe(0)                              // the first step is it

    const user = userEvent.setup()
    screen.getByRole('button', { name: CHECKLIST_COPY.hideLabel }).focus()
    await user.tab()
    expect(document.activeElement).toBe(steps[0])
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(steps[1])
    expect(steps[1].tabIndex).toBe(0)
    expect(steps[0].tabIndex).toBe(-1)
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(steps[steps.length - 1])
    // Tab leaves the list in one press, whatever step holds the stop
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'after the list' }))
  })

  it('Hide stays its own Tab stop, BEFORE the steps (the header order a member sees)', async () => {
    latchNotebookFlags(SWITCH_ON)
    const { container } = renderChecklist()
    await screen.findByRole('toolbar', { name: CHECKLIST_COPY.stepsLabel })
    const stops = tabbable(container).map((el) => el.getAttribute('aria-label') || el.textContent)
    expect(stops.slice(0, 3)).toEqual([GETTING_STARTED_SKIP_TEXT, CHECKLIST_COPY.hideLabel, CHECKLIST_COPY.note])
    expect(stops).toHaveLength(4)                                  // skip, Hide, the steps (one), after
  })

  it('"Skip to getting started" lands on the checklist heading, which takes focus only by script', async () => {
    latchNotebookFlags(SWITCH_ON)
    renderChecklist()
    const link = await screen.findByRole('link', { name: GETTING_STARTED_SKIP_TEXT })
    const heading = screen.getByRole('heading', { name: CHECKLIST_COPY.title })
    expect(heading.id).toBe(GETTING_STARTED_HEADING_ID)
    expect(heading.tabIndex).toBe(-1)
    expect(link).toHaveAttribute('href', `#${GETTING_STARTED_HEADING_ID}`)
    fireEvent.click(link)
    expect(document.activeElement).toBe(heading)
    // and the region is still named by that heading
    expect(screen.getByRole('region', { name: CHECKLIST_COPY.title })).toBeInTheDocument()
  })

  it('the skip link leaves with the list (Hide), and never renders while the switch is off', async () => {
    latchNotebookFlags(SWITCH_ON)
    renderChecklist()
    await screen.findByRole('link', { name: GETTING_STARTED_SKIP_TEXT })
    fireEvent.click(screen.getByRole('button', { name: CHECKLIST_COPY.hideLabel }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: CHECKLIST_COPY.title })).toBeNull())
    expect(screen.queryByRole('link', { name: GETTING_STARTED_SKIP_TEXT })).toBeNull()
    cleanup()

    __resetNotebookFlags()
    latchNotebookFlags({ ...SWITCH_ON, notebook_getting_started_enabled: false })
    renderChecklist()
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(screen.queryByRole('heading', { name: CHECKLIST_COPY.title })).toBeNull()
    expect(screen.queryByRole('link', { name: GETTING_STARTED_SKIP_TEXT })).toBeNull()
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('axe: 0 violations with the steps toolbar and the skip link on screen', async () => {
    latchNotebookFlags(SWITCH_ON)
    const { container } = renderChecklist()
    await screen.findByRole('toolbar', { name: CHECKLIST_COPY.stepsLabel })
    screen.getByRole('link', { name: GETTING_STARTED_SKIP_TEXT })
    await expectNoAxeViolations(container)
  })
})

describe('the tour offer on keys', () => {
  const ENTRY = { id: 'k-a', title: 'Template gallery' }

  it('its two buttons are ONE Tab stop (a toolbar named by the card), Arrow keys move between them', async () => {
    const onLater = vi.fn()
    render(<main><TourOfferPrompt entry={ENTRY} onAccept={vi.fn()} onLater={onLater} /><button type="button">next</button></main>)
    const bar = screen.getByRole('toolbar', { name: OFFER_COPY.title('Template gallery') })
    const accept = screen.getByRole('button', { name: OFFER_COPY.accept })
    const later = screen.getByRole('button', { name: OFFER_COPY.later })
    expect(bar).toContainElement(accept)
    expect(bar).toContainElement(later)
    expect(accept.tabIndex).toBe(0)
    expect(later.tabIndex).toBe(-1)

    const user = userEvent.setup()
    await user.tab()
    expect(document.activeElement).toBe(accept)
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(later)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'next' }))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(later)                      // the stop roved with focus
    await user.keyboard('{Enter}')
    expect(onLater).toHaveBeenCalledTimes(1)
  })

  it('"Not now" declares the Escape the card honours, and Escape from either button still declines', async () => {
    const onLater = vi.fn()
    render(<main><TourOfferPrompt entry={ENTRY} onAccept={vi.fn()} onLater={onLater} /></main>)
    expect(screen.getByRole('button', { name: OFFER_COPY.later })).toHaveAttribute('aria-keyshortcuts', 'Escape')
    const user = userEvent.setup()
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: OFFER_COPY.accept }))
    await user.keyboard('{Escape}')
    expect(onLater).toHaveBeenCalledTimes(1)
  })

  it('never takes focus on arrival (plan 5.3, R4) -- the toolbar changes Tab order, not focus', () => {
    const before = document.activeElement
    render(<main><TourOfferPrompt entry={ENTRY} onAccept={vi.fn()} onLater={vi.fn()} /></main>)
    expect(document.activeElement).toBe(before)
  })

  it('axe: 0 violations with the actions toolbar', async () => {
    const { container } = render(<main><TourOfferPrompt entry={ENTRY} onAccept={vi.fn()} onLater={vi.fn()} /></main>)
    screen.getByRole('toolbar')
    await expectNoAxeViolations(container)
  })
})
