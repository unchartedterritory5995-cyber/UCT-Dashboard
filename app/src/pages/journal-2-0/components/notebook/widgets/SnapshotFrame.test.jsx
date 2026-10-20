// The shared snapshot frame (Task 7): its header, See it now, and the share switch.
// Asserted by RENDERED TEXT: what a member reads is the thing under test.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import SnapshotFrame from './SnapshotFrame'

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
