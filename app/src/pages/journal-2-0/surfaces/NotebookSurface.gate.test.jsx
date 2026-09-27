/**
 * ⛔⛔ F-8 (wave 10, lane 10C) — the v5 Notebook route goes through Wave K's gate.
 *
 * Before this, only the legacy v8 `JournalTwoRoot` mounted `NotebookFlagGate`,
 * so the route members use (/journal/notebook → NotebookSurface → NotebookTab)
 * never fired `notebook_config_served`, and K-1 — flipping the compile-time
 * default to OFF — could not have its precondition measured at all.
 *
 * These drive the REAL surface and the REAL gate; only NotebookTab (everything
 * that can reach the store) and the telemetry transport are stood in for.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'

const tabMounted = vi.fn()
vi.mock('../tabs/NotebookTab', () => ({
  default: () => { tabMounted(); return <div>notebook tab mounted</div> },
}))

const reported = vi.fn()
vi.mock('../lib/offline/configServedEvent', async (orig) => {
  const real = await orig()
  return { ...real, reportConfigServed: (...a) => { reported(...a); return Promise.resolve(a[0]) } }
})

import NotebookSurface from './NotebookSurface'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

beforeEach(() => {
  __resetNotebookFlags()
  tabMounted.mockClear()
  reported.mockClear()
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => { vi.useRealTimers(); __resetNotebookFlags() })

describe('⛔⛔ F-8 — the v5 route mounts the Wave K gate', () => {
  it('nothing that can reach the store mounts before the flags latch (§21, K-R4 on v5)', async () => {
    render(<NotebookSurface />)
    expect(tabMounted, '⛔ NotebookTab mounted on v5 before the wave\'s answer arrived').not.toHaveBeenCalled()
    expect(screen.queryByText('notebook tab mounted')).toBeNull()

    await act(async () => { latchNotebookFlags({ notebook_offline_default_on: false }); vi.advanceTimersByTime(100) })
    await waitFor(() => expect(tabMounted).toHaveBeenCalled())
  })

  it('⭐ config_served FIRES on v5 — the numerator K-1 needs, reported served:true', async () => {
    render(<NotebookSurface />)
    await act(async () => { latchNotebookFlags({ notebook_offline_default_on: true }); vi.advanceTimersByTime(100) })
    await waitFor(() => expect(reported).toHaveBeenCalledTimes(1))
    expect(reported.mock.calls[0][0].served).toBe(true)
  })

  it('⛔ and the NEGATIVE case is counted too — a deadline release reports served:false', async () => {
    render(<NotebookSurface />)
    await act(async () => { vi.advanceTimersByTime(3100) })
    await waitFor(() => expect(reported).toHaveBeenCalledTimes(1))
    expect(reported.mock.calls[0][0].served).toBe(false)
    expect(tabMounted, 'after the deadline the constant stands in and the Notebook renders').toHaveBeenCalled()
  })

  it('the normal v5 case: flags already latched by AuthContext — renders at once, one report', async () => {
    latchNotebookFlags({ notebook_offline_default_on: true })
    render(<NotebookSurface />)
    expect(tabMounted).toHaveBeenCalled()
    await waitFor(() => expect(reported).toHaveBeenCalledTimes(1))
    expect(reported.mock.calls[0][0]).toMatchObject({ served: true })
  })
})
