// The shared snapshot frame (Task 7): its header, See it now, and the share switch.
// Asserted by RENDERED TEXT: what a member reads is the thing under test.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react'
import SnapshotFrame, { useSnapshotFrame, NA } from './SnapshotFrame'

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

