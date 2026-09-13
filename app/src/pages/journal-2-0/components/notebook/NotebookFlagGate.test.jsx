/**
 * ⛔⛔ K-R4 — THE GATE, AND WHY IT IS THE ONLY ADMISSIBLE SHAPE.
 *
 * The requirement: a pre-config render must never enable what config would
 * disable. Two shapes were considered; the second is disproved HERE rather than
 * argued about, because the argument is the whole justification for shape A.
 *
 *   A  first-render gate — nothing mounts until the answer latches, or the
 *      deadline passes and the compile-time constant stands in.   ✅ chosen
 *   B  reactive flag, pre-config value = the compile-time constant. ❌
 *
 * B renders with the wave ON when the server says off, because the constant is
 * `true`. In that window the durable layer mounts: it can open the account's
 * IndexedDB, take the sync Web Lock and write a working copy. That is not a
 * wrong frame — it is a WRITE, and §21 forbids exactly it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import NotebookFlagGate, { CONFIG_TIMEOUT_MS } from './NotebookFlagGate'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

const OFF = { notebook_offline_default_on: false }

/** A stand-in for everything the Notebook mounts that can reach the store. */
function StoreToucher({ onMount }) {
  onMount()
  return <div>notebook mounted</div>
}

beforeEach(() => { __resetNotebookFlags(); vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { vi.useRealTimers(); __resetNotebookFlags() })

describe('⛔⛔ K-R4 — nothing mounts before the answer lands', () => {
  it('renders NOTHING that could touch the store until the flags latch', async () => {
    const mounted = vi.fn()
    render(<NotebookFlagGate><StoreToucher onMount={mounted} /></NotebookFlagGate>)

    // ⛔ THE ASSERTION IS THAT THE CHILD NEVER MOUNTED, not that it is hidden.
    // A hidden mount is still a mount, and a mounted `useDurableNote` opens a
    // database.
    expect(mounted, '⛔ the Notebook mounted before the wave\'s answer arrived').not.toHaveBeenCalled()
    expect(screen.queryByText('notebook mounted')).toBeNull()

    await act(async () => { latchNotebookFlags(OFF); vi.advanceTimersByTime(100) })
    await waitFor(() => expect(mounted).toHaveBeenCalledTimes(1))
  })

  it('⛔ the DEADLINE releases the gate — a slow payload is not a dead Notebook', async () => {
    const mounted = vi.fn()
    render(<NotebookFlagGate><StoreToucher onMount={mounted} /></NotebookFlagGate>)
    expect(mounted).not.toHaveBeenCalled()

    await act(async () => { vi.advanceTimersByTime(CONFIG_TIMEOUT_MS + 50) })
    await waitFor(() => expect(mounted, 'after the deadline the constant stands in').toHaveBeenCalled())
  })

  it('⭐ an ALREADY-LATCHED tab renders immediately — no flash of a loading state', async () => {
    latchNotebookFlags(OFF)
    const mounted = vi.fn()
    render(<NotebookFlagGate><StoreToucher onMount={mounted} /></NotebookFlagGate>)
    // ⛔ Synchronously, on the first render: a member switching tabs must not
    // see a spinner for an answer known minutes ago.
    expect(mounted).toHaveBeenCalledTimes(1)
  })

  it('renders the fallback while it waits, when one is given', () => {
    render(<NotebookFlagGate fallback={<div>loading</div>}><StoreToucher onMount={vi.fn()} /></NotebookFlagGate>)
    expect(screen.getByText('loading')).toBeInTheDocument()
  })

  it('⛔⛔ SHAPE B, DISPROVED — a reactive gate WOULD have mounted before the answer', async () => {
    // ⭐ THE CONTROL THAT MAKES THE DESIGN CHOICE EVIDENCE RATHER THAN OPINION.
    // Same children, same timing, but the "gate" renders immediately the way a
    // reactive flag seeded from the constant would. The child mounts BEFORE the
    // server's `false` arrives — one mount is one chance to open the store.
    const ReactiveShapeB = ({ children }) => children
    const mounted = vi.fn()
    render(<ReactiveShapeB><StoreToucher onMount={mounted} /></ReactiveShapeB>)

    expect(mounted, 'shape B mounts the durable layer before the wave is switched off').toHaveBeenCalledTimes(1)
    await act(async () => { latchNotebookFlags(OFF) })
    // …and by now the write has already been possible. The flag arriving late
    // cannot un-open a database.
    expect(mounted).toHaveBeenCalledTimes(1)
  })
})
