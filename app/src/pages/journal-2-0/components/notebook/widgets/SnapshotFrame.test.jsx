// The shared snapshot frame (Task 7): its header, See it now, and the share switch.
// Asserted by RENDERED TEXT: what a member reads is the thing under test.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { waitFor } from '@testing-library/react'
import SnapshotFrame, { useSnapshotFrame, NA, changeKeysOf } from './SnapshotFrame'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../lib/offline/notebookFlags'
import { __resetDedicatedQueue } from '../../../lib/dedicatedWidgets'

const ASOF = '2026-10-20T13:14:00Z'

function frame(props = {}) {
  return render(
    <SnapshotFrame title="My P&L and stats" asOf={ASOF} account={false} share={false} editable
      onRefresh={vi.fn(async () => ({ ok: true }))} onShareChange={vi.fn()} sourceLine="Source: linked broker"
      {...props}>
      <span>+$2,840.00</span>
    </SnapshotFrame>,
  )
}

afterEach(() => vi.useRealTimers())

describe('SnapshotFrame header', () => {
  it('shows the title, a Snapshot chip, the ET as-of and the source line', () => {
    frame()
    expect(screen.getByText('My P&L and stats')).toBeInTheDocument()
    expect(screen.getByText('Snapshot')).toBeInTheDocument()
    expect(screen.getByText('as of Oct 20, 2026, 9:14 AM ET')).toBeInTheDocument()
    expect(screen.getByText('Source: linked broker')).toBeInTheDocument()
  })

  it('an account kind that is not shared says Only you, with a lock', () => {
    const { container } = frame({ account: true, share: false })
    expect(screen.getByText('Only you')).toBeInTheDocument()
    expect(screen.queryByText('Snapshot')).toBeNull()
    expect(container.querySelector('[data-snapshot-lock] svg')).not.toBeNull()
  })

  it('an account kind the member shares reads Snapshot again', () => {
    frame({ account: true, share: true })
    expect(screen.getByText('Snapshot')).toBeInTheDocument()
    expect(screen.queryByText('Only you')).toBeNull()
  })
})

describe('SnapshotFrame controls', () => {
  it('there are no controls when editable is false', () => {
    frame({ editable: false, account: true })
    expect(screen.queryByRole('button', { name: 'See it now' })).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByText('Show on shared pages')).toBeNull()
  })

  it('the share switch is absent for a market kind', () => {
    frame({ account: false })
    expect(screen.getByRole('button', { name: 'See it now' })).toBeInTheDocument()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByText('Show on shared pages')).toBeNull()
  })

  it('R58 I-8: a market kind says "Not shown on shared pages" where the switch would be, editable or not', () => {
    const { unmount } = frame({ account: false })
    expect(screen.getByText('Not shown on shared pages')).toBeInTheDocument()
    unmount()
    frame({ account: false, editable: false })
    expect(screen.getByText('Not shown on shared pages')).toBeInTheDocument()
  })

  it('control: an account kind offers the switch and never the market chip', () => {
    frame({ account: true })
    expect(screen.getByText('Show on shared pages')).toBeInTheDocument()
    expect(screen.queryByText('Not shown on shared pages')).toBeNull()
  })

  it('an account kind gets the switch, and flipping it asks for the new value', () => {
    const onShareChange = vi.fn()
    frame({ account: true, share: false, onShareChange })
    const sw = screen.getByRole('switch', { name: 'Show on shared pages' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(sw)
    expect(onShareChange).toHaveBeenCalledWith(true)
  })

  it('a failed refresh keeps the rendered numbers and says so for 4 seconds', async () => {
    vi.useFakeTimers()
    const onRefresh = vi.fn(async () => ({ ok: false, reason: 'failed' }))
    frame({ onRefresh })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'See it now' })) })
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Couldn't refresh. The saved snapshot is unchanged.")).toBeInTheDocument()
    expect(screen.getByText('+$2,840.00')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(4000) })
    expect(screen.queryByText("Couldn't refresh. The saved snapshot is unchanged.")).toBeNull()
    expect(screen.getByText('+$2,840.00')).toBeInTheDocument()
  })

  it('offline, the refresh says the saved snapshot is shown', async () => {
    frame({ onRefresh: vi.fn(async () => ({ ok: false, reason: 'offline' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'See it now' })) })
    expect(screen.getByText("You're offline. This shows the saved snapshot.")).toBeInTheDocument()
  })

  it('a refresh that throws is a failure, never a crash', async () => {
    frame({ onRefresh: vi.fn(async () => { throw new Error('boom') }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'See it now' })) })
    expect(screen.getByText("Couldn't refresh. The saved snapshot is unchanged.")).toBeInTheDocument()
  })
})

// Spec §6 (final review M-10): offline, See it now is disabled with the reason, and comes back online.
describe('SnapshotFrame offline', () => {
  const setOnline = (v) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v })
  afterEach(() => setOnline(true))

  it('offline: See it now is disabled and its title says the saved snapshot is shown; online enables it again', async () => {
    setOnline(false)
    const onRefresh = vi.fn(async () => ({ ok: true }))
    frame({ onRefresh })
    const btn = screen.getByRole('button', { name: 'See it now' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title', "You're offline. This shows the saved snapshot.")
    fireEvent.click(btn)
    expect(onRefresh).not.toHaveBeenCalled()
    setOnline(true)
    act(() => { window.dispatchEvent(new Event('online')) })
    expect(btn).toBeEnabled()
    expect(btn).not.toHaveAttribute('title')
    // ...and the offline event disables it again, in place.
    act(() => { window.dispatchEvent(new Event('offline')) })
    expect(btn).toBeDisabled()
  })

  it('online: See it now is enabled with no offline title (control)', () => {
    frame()
    const btn = screen.getByRole('button', { name: 'See it now' })
    expect(btn).toBeEnabled()
    expect(btn).not.toHaveAttribute('title')
    expect(screen.queryByText('Offline')).toBeNull()
    expect(screen.queryByText("You're offline. This shows the saved snapshot.")).toBeNull()
  })

  it('R58 I-3: offline, the frame shows an Offline marker and the sentence as text, not only in a title', () => {
    setOnline(false)
    frame()
    expect(screen.getByText('Offline')).toHaveAttribute('title', "You're offline. This shows the saved snapshot.")
    expect(screen.getByText("You're offline. This shows the saved snapshot.").tagName).toBe('P')
    setOnline(true)
    act(() => { window.dispatchEvent(new Event('online')) })
    expect(screen.queryByText('Offline')).toBeNull()
  })
})

// R58 (UX I-3): an n/a's reason is reachable without hover: in the button's name, and as text once pressed.
describe('NA', () => {
  it('names its reason for a screen reader and shows it as text when pressed', () => {
    render(<NA reason="No price available right now" />)
    const btn = screen.getByRole('button', { name: 'n/a: No price available right now' })
    expect(btn).toHaveTextContent('n/a')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('No price available right now')).toBeNull()
    fireEvent.click(btn)
    expect(screen.getByText('No price available right now')).toBeInTheDocument()
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(btn)
    expect(screen.queryByText('No price available right now')).toBeNull()
  })
})

// Final review M-1: two writes before a re-render. The host's attrs reach the hook only on the next render, so a
// refresh that resolves in the same frame as the member switching share OFF must not write share back ON.
describe('useSnapshotFrame: two writes in one frame', () => {
  const realFetch = global.fetch
  afterEach(() => { global.fetch = realFetch })
  const PARAMS = { asOf: ASOF, source: 'broker', share: true, netPnl: 100 }

  const pending = () => {
    let answer
    global.fetch = vi.fn(() => new Promise((r) => { answer = r }))
    return (payload) => answer({ ok: true, status: 200, json: async () => payload })
  }

  it('share switched off, then a refresh resolves before any re-render: the refresh keeps share off', async () => {
    const onUpdateParams = vi.fn(() => true)                 // takes the write, never re-renders the hook
    const { result } = renderHook(() => useSnapshotFrame('myPnlStats', { params: PARAMS }, { editable: true, onUpdateParams }))
    const answer = pending()
    let refreshed
    act(() => { refreshed = result.current.onRefresh() })
    act(() => { result.current.onShareChange(false) })
    answer({ asOf: '2026-10-20T15:00:00Z', source: 'broker', netPnl: 250 })
    await act(async () => { await refreshed })
    expect(onUpdateParams).toHaveBeenCalledTimes(2)
    expect(onUpdateParams.mock.calls[0][0].share).toBe(false)          // the switch
    expect(onUpdateParams.mock.calls[1][0]).toMatchObject({ share: false, netPnl: 250 })   // the refresh
  })

  it('control: with no switch in between, the refresh keeps the member share on', async () => {
    const onUpdateParams = vi.fn(() => true)
    const { result } = renderHook(() => useSnapshotFrame('myPnlStats', { params: PARAMS }, { editable: true, onUpdateParams }))
    const answer = pending()
    let refreshed
    act(() => { refreshed = result.current.onRefresh() })
    answer({ asOf: '2026-10-20T15:00:00Z', source: 'broker', netPnl: 250 })
    await act(async () => { await refreshed })
    expect(onUpdateParams).toHaveBeenCalledTimes(1)
    expect(onUpdateParams.mock.calls[0][0]).toMatchObject({ share: true, netPnl: 250 })
  })

  it('a write the host refused is not written through: the next write starts from the node as it is', async () => {
    const onUpdateParams = vi.fn().mockReturnValueOnce(false).mockReturnValue(true)
    const { result } = renderHook(() => useSnapshotFrame('myPnlStats', { params: PARAMS }, { editable: true, onUpdateParams }))
    act(() => { result.current.onShareChange(false) })          // refused: nothing changed on the node
    const answer = pending()
    let refreshed
    act(() => { refreshed = result.current.onRefresh() })
    answer({ asOf: '2026-10-20T15:00:00Z', source: 'broker', netPnl: 250 })
    await act(async () => { await refreshed })
    expect(onUpdateParams.mock.calls[1][0].share).toBe(true)
  })
})


// Wave 10 (Task 10.14, W10-R4): a ready-made dedicated widget refreshes and changes through its own POST door,
// with the member's settings in the body; a phase 1 kind keeps its GET. Asserted by the request the browser
// sends and by the text a member reads. The embeds land in Task 10.15, so a minimal host draws the frame here.
describe('dedicated kinds: See it now and Change through the POST door', () => {
  const realFetch = global.fetch
  afterEach(() => { global.fetch = realFetch; __resetNotebookFlags(); __resetDedicatedQueue() })

  const PROP = {
    asOf: '2026-10-20T14:00:00Z', source: 'broker', since: '2026-10-01', accountId: 'acc-1',
    daily: { limit: 500, used: 100, left: 400 }, trailing: null, lines: ['$400 left today.'], share: true,
  }
  const ok = (body) => ({ ok: true, status: 200, json: async () => body })

  function Embed({ kind, payload, writes, extra = {} }) {
    const [attrs, setAttrs] = useState(() => {
      const a = widgetEmbedNode(kind, payload).attrs
      return { ...a, params: { ...a.params, ...extra } }
    })
    const onUpdateParams = (next) => { writes.push(next); setAttrs((a) => ({ ...a, params: next })); return true }
    const f = useSnapshotFrame(kind, attrs, { editable: true, onUpdateParams })
    return <SnapshotFrame {...f}><p>{(attrs.params.lines || []).join(' ')}</p></SnapshotFrame>
  }

  it('changeKeysOf: the prop-firm limits, and the phase 1 range keys for the tilt check', () => {
    expect(changeKeysOf('myPropFirm')).toEqual(['dailyLoss', 'maxDrawdown', 'since', 'accountId'])
    expect(changeKeysOf('myTiltCheck')).toEqual(['from', 'to'])
    expect(changeKeysOf('myPlanVsActual')).toEqual([])                  // a trade is chosen from the / menu
    expect(changeKeysOf('myGamePlan')).toEqual([])
    expect(changeKeysOf('myPnlStats')).toEqual(['from', 'to'])          // phase 1 unchanged
  })

  it('prop_firm_change_fields_and_post_refresh', async () => {
    latchNotebookFlags({ notebook_widgets_w5_enabled: true })           // presets on: still none for this kind
    const calls = []
    global.fetch = vi.fn(async (url, init = {}) => {
      calls.push([String(url), init.method || 'GET', init.body ? JSON.parse(init.body) : null])
      if (String(url) === '/api/j2/accounts') return ok({ accounts: [{ id: 'acc-1', name: 'Main' }, { id: 'acc-2', name: 'Funded' }] })
      return ok({ ...PROP, asOf: '2026-10-21T14:00:00Z', daily: { limit: 750, used: 0, left: 750 }, lines: ['$750 left today.'] })
    })
    const writes = []
    render(<Embed kind="myPropFirm" payload={PROP} writes={writes}
      extra={{ settings: { dailyLoss: 500, since: '2026-10-01' } }} />)
    expect(screen.queryByRole('button', { name: 'Save these settings as a preset' })).toBeNull()

    // See it now: the member's settings, in the body of a POST to the kind's own door
    fireEvent.click(screen.getByRole('button', { name: 'See it now' }))
    await screen.findByText('$750 left today.')
    expect(calls[0]).toEqual(['/api/j2/notebook-shelf-widgets/myPropFirm', 'POST',
      { params: { dailyLoss: 500, since: '2026-10-01' } }])
    expect(writes[0]).toMatchObject({ lines: ['$750 left today.'], settings: { dailyLoss: 500, since: '2026-10-01' }, share: true })

    // Change: the four fields, labelled
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByLabelText('Daily loss limit ($)')).toHaveValue(500)
    expect(screen.getByLabelText('Daily loss limit ($)')).toHaveAttribute('type', 'number')
    expect(screen.getByLabelText('Max drawdown ($)')).toHaveValue(null)
    expect(screen.getByLabelText('Challenge started')).toHaveValue('2026-10-01')
    expect(screen.getByLabelText('Challenge started')).toHaveAttribute('type', 'date')
    await screen.findByRole('option', { name: 'Funded' })               // Accounts reads the member's own accounts
    fireEvent.change(screen.getByLabelText('Daily loss limit ($)'), { target: { value: '750' } })
    fireEvent.change(screen.getByLabelText('Max drawdown ($)'), { target: { value: '2500' } })
    fireEvent.change(screen.getByLabelText('Accounts'), { target: { value: 'acc-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show these' }))
    await waitFor(() => expect(writes).toHaveLength(2))
    const post = calls.filter((c) => c[1] === 'POST').at(-1)
    expect(post).toEqual(['/api/j2/notebook-shelf-widgets/myPropFirm', 'POST',
      { params: { dailyLoss: 750, maxDrawdown: 2500, since: '2026-10-01', accountId: 'acc-2' } }])
    expect(writes[1].settings).toEqual({ dailyLoss: 750, maxDrawdown: 2500, since: '2026-10-01', accountId: 'acc-2' })
    expect(writes[1].share).toBe(true)
    // never the phase 1 GET, and never a limit in a URL
    expect(calls.some(([u]) => u.includes('/api/j2/notebook-widgets/'))).toBe(false)
    expect(calls.some(([u]) => /750|2500/.test(u))).toBe(false)
  })

  it('Change: an emptied limit is cleared (the server default applies), never re-asked with its old value', async () => {
    const calls = []
    global.fetch = vi.fn(async (url, init = {}) => {
      calls.push([String(url), init.body ? JSON.parse(init.body) : null])
      if (String(url) === '/api/j2/accounts') return ok({ accounts: [] })
      return ok({ ...PROP, asOf: '2026-10-21T14:00:00Z' })
    })
    const writes = []
    render(<Embed kind="myPropFirm" payload={PROP} writes={writes} extra={{ settings: { dailyLoss: 500, maxDrawdown: 2500 } }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.change(screen.getByLabelText('Daily loss limit ($)'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show these' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(calls.at(-1)[1]).toEqual({ params: { maxDrawdown: 2500 } })
    expect(writes[0].settings).toEqual({ maxDrawdown: 2500 })
  })

  it('a refused limit shows the server sentence and writes nothing', async () => {
    global.fetch = vi.fn(async (url) => (String(url) === '/api/j2/accounts' ? ok({ accounts: [] })
      : { ok: false, status: 400, json: async () => ({ detail: { code: 'invalid', message: 'Amounts are dollars, like 500.' } }) }))
    const writes = []
    render(<Embed kind="myPropFirm" payload={PROP} writes={writes} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.change(screen.getByLabelText('Daily loss limit ($)'), { target: { value: '-3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show these' }))
    expect(await screen.findByText('Amounts are dollars, like 500.')).toBeInTheDocument()
    expect(writes).toEqual([])
  })

  it('with wave 10 dark the door answers 404 and the frame says "Not available right now."; the snapshot stays', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ detail: 'Not found' }) }))
    const writes = []
    render(<Embed kind="myGamePlan" payload={{ asOf: '2026-10-20T12:00:00Z', source: 'broker', lines: ['Breadth thrust'] }}
      writes={writes} />)
    fireEvent.click(screen.getByRole('button', { name: 'See it now' }))
    expect(await screen.findByText('Not available right now.')).toBeInTheDocument()
    expect(screen.getByText('Breadth thrust')).toBeInTheDocument()
    expect(writes).toEqual([])
  })

  it('phase1_kind_still_refreshes_through_get', async () => {
    const calls = []
    global.fetch = vi.fn(async (url, init = {}) => {
      calls.push([String(url), init.method || 'GET'])
      return ok({ asOf: '2026-10-21T14:00:00Z', source: 'broker', range: { from: '2026-10-13', to: '2026-10-17' }, netPnl: 9,
        lines: ['fresh'] })
    })
    const writes = []
    render(<Embed kind="myPnlStats" payload={{ asOf: '2026-10-20T14:00:00Z', source: 'broker',
      range: { from: '2026-10-13', to: '2026-10-17' }, netPnl: 1 }} writes={writes} />)
    fireEvent.click(screen.getByRole('button', { name: 'See it now' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toMatch(/^\/api\/j2\/notebook-widgets\/myPnlStats/)
    expect(calls[0][1]).toBe('GET')
    expect(calls.some(([u]) => u.includes('notebook-shelf-widgets'))).toBe(false)
  })

  it('four dedicated widgets refreshed at once all land, and none says Busy (10.12 M7: MEMBER_MAX is 2)', async () => {
    let inFlight = 0
    global.fetch = vi.fn(async (url) => {
      inFlight += 1
      try {
        if (inFlight > 2) return { ok: false, status: 503, json: async () => ({ detail: { code: 'busy', message: 'Busy right now. Try again in a moment.' } }) }
        await new Promise((r) => setTimeout(r, 5))
        return ok({ asOf: '2026-10-21T14:00:00Z', source: 'broker', lines: [`fresh ${String(url).split('/').pop()}`] })
      } finally { inFlight -= 1 }
    })
    const kinds = ['myTiltCheck', 'myRevengeClean', 'myRiskLeftToday', 'myAlertsFired']
    const writes = []
    for (const kind of kinds) render(<Embed kind={kind} payload={{ asOf: '2026-10-20T14:00:00Z', source: 'broker', lines: [`old ${kind}`] }} writes={writes} />)
    for (const b of screen.getAllByRole('button', { name: 'See it now' })) fireEvent.click(b)
    for (const kind of kinds) expect(await screen.findByText(`fresh ${kind}`)).toBeInTheDocument()
    expect(screen.queryByText(/Busy right now/)).toBeNull()
    expect(writes).toHaveLength(4)
  })
})
