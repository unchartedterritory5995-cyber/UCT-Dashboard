/**
 * The five Today panels (P4a Task 4): checklist for today, my rules, market regime, today's note, notices.
 *
 * Each panel is rendered with the REAL hooks it reads through (day detail, day-notes mutation, regime, notices),
 * over a stubbed `fetch`, so the tests see the requests a member's browser would make. Only the things a panel
 * does not own are replaced: the preference read, `openDailyNote`, the router's `navigate`, and the My rules
 * block (it has its own tests; here it is a probe that records what the panel handed it).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { AuthContext } from '../../../../../context/AuthContext'
import { todayET } from '../../../lib/calendar'
import { DAILY_TEMPLATE_MISSING } from '../../../lib/dailyNote'

const { navigateSpy, openDailyNoteSpy, prefsRef, myRulesProbe } = vi.hoisted(() => ({
  navigateSpy: vi.fn(),
  openDailyNoteSpy: vi.fn(),
  prefsRef: { current: {} },
  myRulesProbe: vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigateSpy }
})
vi.mock('../../../../../hooks/usePreferences', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, default: () => ({ prefs: prefsRef.current, setPref: vi.fn(), loading: false }) }
})
vi.mock('../../../lib/dailyNote', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, openDailyNote: openDailyNoteSpy }
})
vi.mock('../../../components/notebook/blocks/MyRulesBlock', () => ({
  default: (props) => {
    myRulesProbe(props)
    return <div data-testid="my-rules-block-probe">my rules block</div>
  },
}))

import ChecklistTodayPanel from './ChecklistTodayPanel'
import MyRulesPanel from './MyRulesPanel'
import RegimePanel from './RegimePanel'
import TodayNotePanel from './TodayNotePanel'
import NoticesPanel from './NoticesPanel'

const NO_ACCOUNT_LINE = 'Pick an account to see its rules.'
const TODAY = todayET()
const DAY_URL = `/api/j2/calendar/day/${TODAY}`

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

const DAY = {
  metrics: null,
  trades: [],
  strategies: { closed: [], expiring: [] },
  notes: {
    notes: 'The tape was thin after lunch.',
    prepNotes: 'Watch the open for a reclaim of yesterday\'s high.',
    midDayNotes: 'Stopped trading at 11.',
    recapNotes: 'Followed the plan, sized small.',
    attachments: [{ id: 'att1', name: 'chart.png' }],
    rules: [
      { id: 'r1', label: 'Waited for confirmation', checked: false },
      { id: 'r2', label: 'Sized at 1R', checked: true },
    ],
  },
}

let calls
function stubFetch(routes) {
  calls = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const method = (init.method || 'GET').toUpperCase()
    calls.push({ url: u, method, body: init.body ? JSON.parse(init.body) : undefined })
    for (const [match, answer] of routes) {
      if (match(u, method)) return typeof answer === 'function' ? answer(u, init) : answer
    }
    return json({})
  })
}

function mount(ui, { userId = 'u1' } = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ user: { id: userId } }}>
        <MemoryRouter>{ui}</MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>,
  )
}

const account = { id: 'a1', name: 'Main', balanceSource: 'manual' }

beforeEach(() => {
  navigateSpy.mockReset()
  openDailyNoteSpy.mockReset()
  myRulesProbe.mockReset()
  prefsRef.current = {}
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('ChecklistTodayPanel', () => {
  it('renders today\'s rules from the day detail, and a tick is a day-notes write carrying the rules, not a note write', async () => {
    stubFetch([
      [(u, m) => m === 'GET' && u.startsWith(DAY_URL), () => json(DAY)],
      [(u, m) => m === 'PUT' && u === `${DAY_URL}/notes`, () => json({ rules: [] })],
    ])
    mount(<ChecklistTodayPanel account={account} accountId="a1" />)

    const first = await screen.findByLabelText('Waited for confirmation')
    expect(screen.getByLabelText('Sized at 1R')).toBeChecked()
    expect(first).not.toBeChecked()

    fireEvent.click(first)
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))

    const put = calls.find((c) => c.method === 'PUT')
    expect(put.url).toBe(`${DAY_URL}/notes`)
    expect(put.body.rules).toEqual([
      { id: 'r1', label: 'Waited for confirmation', checked: true },
      { id: 'r2', label: 'Sized at 1R', checked: true },
    ])
    // The checklist writes the day's rules, never a Notebook note.
    expect(calls.filter((c) => c.method !== 'GET').every((c) => c.url.startsWith('/api/j2/calendar/day/'))).toBe(true)
    expect(calls.some((c) => c.url.startsWith('/api/j2/notes'))).toBe(false)
  })

  it('a tick sends the day\'s existing narrative unchanged, so it cannot blank prep, mid-day, recap or the notes', async () => {
    stubFetch([
      [(u, m) => m === 'GET' && u.startsWith(DAY_URL), () => json(DAY)],
      [(u, m) => m === 'PUT', () => json({})],
    ])
    mount(<ChecklistTodayPanel account={account} accountId="a1" />)
    fireEvent.click(await screen.findByLabelText('Waited for confirmation'))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))

    const { body } = calls.find((c) => c.method === 'PUT')
    expect(body.prepNotes).toBe(DAY.notes.prepNotes)
    expect(body.notes).toBe(DAY.notes.notes)
    expect(body.midDayNotes).toBe(DAY.notes.midDayNotes)
    expect(body.recapNotes).toBe(DAY.notes.recapNotes)
    expect(body.attachments).toEqual(DAY.notes.attachments)
  })

  it('reads the day with the same account and basis the day page does: a broker account follows the member\'s basis preference', async () => {
    prefsRef.current = { j2_calendar_pnl_basis: JSON.stringify('closed') }
    stubFetch([[(u, m) => m === 'GET', () => json(DAY)]])
    mount(<ChecklistTodayPanel account={{ id: 'a1', name: 'Broker', balanceSource: 'snaptrade' }} accountId="a1" />)
    await screen.findByLabelText('Waited for confirmation')
    expect(calls[0].url).toBe(`${DAY_URL}?account_id=a1&basis=closed`)
  })

  it('a manual account reads the day on the closed basis', async () => {
    stubFetch([[(u, m) => m === 'GET', () => json(DAY)]])
    mount(<ChecklistTodayPanel account={account} accountId="a1" />)
    await screen.findByLabelText('Waited for confirmation')
    expect(calls[0].url).toBe(`${DAY_URL}?account_id=a1&basis=closed`)
  })

  it('says one muted line while the day loads', async () => {
    stubFetch([[(u, m) => m === 'GET', () => new Promise(() => {})]])
    mount(<ChecklistTodayPanel account={account} accountId="a1" />)
    expect(await screen.findByText("Loading today's checklist…")).toBeInTheDocument()
    expect(screen.queryByLabelText('New rule')).not.toBeInTheDocument()
  })

  it('does not offer to write when the day could not be read (a write would send a blank narrative)', async () => {
    stubFetch([[(u, m) => m === 'GET', () => json({}, 500)]])
    mount(<ChecklistTodayPanel account={account} accountId="a1" />)
    expect(await screen.findByText("Today's checklist isn't available right now.")).toBeInTheDocument()
    expect(screen.queryByLabelText('New rule')).not.toBeInTheDocument()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('after a failed read, "Try again" asks for the day again and shows the checklist when it answers', async () => {
    let answers = 0
    stubFetch([[(u, m) => m === 'GET' && u.startsWith(DAY_URL), () => { answers += 1; return answers === 1 ? json({}, 500) : json(DAY) }]])
    mount(<ChecklistTodayPanel account={account} accountId="a1" />)
    expect(await screen.findByText("Today's checklist isn't available right now.")).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByLabelText('Waited for confirmation')).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('"Try again" is not offered while the day loads or once it has loaded', async () => {
    stubFetch([[(u, m) => m === 'GET' && u.startsWith(DAY_URL), () => json(DAY)]])
    mount(<ChecklistTodayPanel account={account} accountId="a1" />)
    await screen.findByLabelText('Waited for confirmation')
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('with no account selected says exactly the pick-an-account line and reads nothing', () => {
    stubFetch([])
    mount(<ChecklistTodayPanel account={null} accountId={null} />)
    expect(screen.getByText(NO_ACCOUNT_LINE)).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })
})

describe('MyRulesPanel', () => {
  it('hands the My rules block the active rules, read-only', async () => {
    mount(<MyRulesPanel account={account} accountId="a1" />)
    expect(await screen.findByTestId('my-rules-block-probe')).toBeInTheDocument()
    const props = myRulesProbe.mock.calls.at(-1)[0]
    expect(props.params).toEqual({ which: 'active' })
    expect(props.editable).toBe(false)
  })

  it('with no account selected says exactly the pick-an-account line and mounts no block', () => {
    mount(<MyRulesPanel account={null} accountId={null} />)
    expect(screen.getByText(NO_ACCOUNT_LINE)).toBeInTheDocument()
    expect(screen.queryByTestId('my-rules-block-probe')).not.toBeInTheDocument()
  })
})

describe('RegimePanel', () => {
  it('shows the regime word for the id the payload names (amber is shown as Yellow)', async () => {
    stubFetch([[(u) => u === '/api/j2/regime', () => json({ regime: 'amber', score: 62, source: 'wire_data', asOf: '2026-10-17' })]])
    mount(<RegimePanel />)
    expect(await screen.findByText('Yellow')).toBeInTheDocument()
    expect(screen.queryByText('Market regime is not available right now.')).not.toBeInTheDocument()
  })

  it('says the market regime is not available on a 500, and names no regime', async () => {
    stubFetch([[(u) => u === '/api/j2/regime', () => json({ detail: 'boom' }, 500)]])
    mount(<RegimePanel />)
    expect(await screen.findByText('Market regime is not available right now.')).toBeInTheDocument()
    for (const word of ['Green', 'Yellow', 'Orange', 'Red']) expect(screen.queryByText(word)).not.toBeInTheDocument()
  })

  it('says it is not available when the payload names no regime, never a guessed one', async () => {
    stubFetch([[(u) => u === '/api/j2/regime', () => json({ regime: null, score: null, source: null, asOf: null })]])
    mount(<RegimePanel />)
    expect(await screen.findByText('Market regime is not available right now.')).toBeInTheDocument()
  })

  it('says it is not available for a regime id it has no word for', async () => {
    stubFetch([[(u) => u === '/api/j2/regime', () => json({ regime: 'constructor' })]])
    mount(<RegimePanel />)
    expect(await screen.findByText('Market regime is not available right now.')).toBeInTheDocument()
  })

  it('says it is not available while the read is still in flight', () => {
    stubFetch([[(u) => u === '/api/j2/regime', () => new Promise(() => {})]])
    mount(<RegimePanel />)
    expect(screen.getByText('Market regime is not available right now.')).toBeInTheDocument()
  })

  it('adds the regime\'s own reason line only when the payload carries one', async () => {
    stubFetch([[(u) => u === '/api/j2/regime', () => json({ regime: 'green', reason: 'Breadth is broad and trending.' })]])
    mount(<RegimePanel />)
    expect(await screen.findByText('Green')).toBeInTheDocument()
    expect(screen.getByText('Breadth is broad and trending.')).toBeInTheDocument()
  })
})

describe('TodayNotePanel', () => {
  it('one press opens today\'s note once and goes to the note the call returned', async () => {
    openDailyNoteSpy.mockResolvedValue({ note: { id: 'n42' }, created: false, templateMissing: false })
    mount(<TodayNotePanel />)
    fireEvent.click(screen.getByRole('button', { name: "Open today's note" }))
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1))
    expect(openDailyNoteSpy).toHaveBeenCalledTimes(1)
    expect(navigateSpy.mock.calls[0][0]).toBe('/journal?j2tab=notebook&note=n42')
  })

  it('opens the note with the member\'s own daily template, as the Ctrl+Alt+D shortcut does', async () => {
    prefsRef.current = { notebook_daily_template: 'tpl7' }
    openDailyNoteSpy.mockResolvedValue({ note: { id: 'n1' } })
    mount(<TodayNotePanel />)
    fireEvent.click(screen.getByRole('button', { name: "Open today's note" }))
    await waitFor(() => expect(openDailyNoteSpy).toHaveBeenCalledTimes(1))
    expect(openDailyNoteSpy.mock.calls[0][0]).toEqual({ templateId: 'tpl7' })
  })

  it('a rejected call shows the failure sentence and goes nowhere', async () => {
    openDailyNoteSpy.mockRejectedValue(new Error('daily note request failed (500)'))
    mount(<TodayNotePanel />)
    fireEvent.click(screen.getByRole('button', { name: "Open today's note" }))
    expect(await screen.findByText("Couldn't open today's note. Try again.")).toBeInTheDocument()
    expect(navigateSpy).not.toHaveBeenCalled()
  })

  it('a second press while the first is in flight does not open a second note', async () => {
    let release
    openDailyNoteSpy.mockReturnValue(new Promise((res) => { release = res }))
    mount(<TodayNotePanel />)
    const button = screen.getByRole('button', { name: "Open today's note" })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(openDailyNoteSpy).toHaveBeenCalledTimes(1)
    release({ note: { id: 'n9' } })
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1))
  })
})

describe('TodayNotePanel: in flight, failure and a missing template', () => {
  const open = () => screen.getByRole('button', { name: "Open today's note" })

  it('while the request runs the button is disabled and aria-busy, and it comes back after', async () => {
    let release
    openDailyNoteSpy.mockReturnValue(new Promise((res) => { release = res }))
    mount(<TodayNotePanel />)
    expect(open()).not.toBeDisabled()
    expect(open()).not.toHaveAttribute('aria-busy', 'true')

    fireEvent.click(open())
    await waitFor(() => expect(open()).toBeDisabled())
    expect(open()).toHaveAttribute('aria-busy', 'true')

    release({ note: { id: 'n3' } })
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(open()).not.toBeDisabled())
    expect(open()).not.toHaveAttribute('aria-busy', 'true')
  })

  it('after a rejected call the guard has reset: a second tap asks again and opens the note', async () => {
    openDailyNoteSpy.mockRejectedValueOnce(new Error('daily note request failed (500)'))
    openDailyNoteSpy.mockResolvedValueOnce({ note: { id: 'n8' } })
    mount(<TodayNotePanel />)

    fireEvent.click(open())
    expect(await screen.findByText("Couldn't open today's note. Try again.")).toBeInTheDocument()
    await waitFor(() => expect(open()).not.toBeDisabled())

    fireEvent.click(open())
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1))
    expect(openDailyNoteSpy).toHaveBeenCalledTimes(2)
    expect(navigateSpy.mock.calls[0][0]).toBe('/journal?j2tab=notebook&note=n8')
    expect(screen.queryByText("Couldn't open today's note. Try again.")).not.toBeInTheDocument()
  })

  it('when the chosen daily template is gone it says so, as the shortcut does, then opens the note on request', async () => {
    openDailyNoteSpy.mockResolvedValue({ note: { id: 'n5' }, created: true, templateMissing: true })
    mount(<TodayNotePanel />)
    fireEvent.click(open())

    expect(await screen.findByText(DAILY_TEMPLATE_MISSING)).toBeInTheDocument()
    expect(DAILY_TEMPLATE_MISSING).toBe("Your daily template no longer exists, so today's note started blank.")
    // The member reads the notice before leaving Today: nothing navigated yet.
    expect(navigateSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Open the note' }))
    expect(navigateSpy).toHaveBeenCalledTimes(1)
    expect(navigateSpy.mock.calls[0][0]).toBe('/journal?j2tab=notebook&note=n5')
  })

  it('no notice and no extra button when the template is not missing', async () => {
    openDailyNoteSpy.mockResolvedValue({ note: { id: 'n6' }, created: false, templateMissing: false })
    mount(<TodayNotePanel />)
    fireEvent.click(open())
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(DAILY_TEMPLATE_MISSING)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open the note' })).not.toBeInTheDocument()
  })
})

describe('NoticesPanel', () => {
  const stubNotices = ({ alerts, insights }) => stubFetch([
    [(u) => u === '/api/alerts?limit=20', () => json(alerts)],
    [(u) => u === '/api/voice/insights', () => json({ insights })],
  ])

  it('with nothing to show renders nothing at all, not an empty card', async () => {
    stubNotices({ alerts: [], insights: [] })
    const { container } = mount(<NoticesPanel />)
    // NoticesBox has loaded and asked for both reads: only then is "nothing" a statement about it.
    await waitFor(() => expect(calls.map((c) => c.url)).toEqual(expect.arrayContaining(['/api/alerts?limit=20', '/api/voice/insights'])))
    await waitFor(() => expect(container.innerHTML).toBe(''))
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('CONTROL: with a notice to show the same panel renders the box', async () => {
    stubNotices({
      alerts: [{ id: 5, type: 'notebook_task_reminder', title: 'Tasks due', message: '2 tasks are due today', read: false, data: {} }],
      insights: [],
    })
    const { container } = mount(<NoticesPanel />)
    expect(await screen.findByText(/Notices · 1/)).toBeInTheDocument()
    expect(within(container).getByText('Tasks due')).toBeInTheDocument()
  })
})
