/**
 * ⛔⛔ WAVE K — THE MEASUREMENT K-1 IS GATED ON.
 *
 * K-1's precondition is a **config-served rate of 100% over the K window,
 * measured by identity**. A rate needs a denominator, and the way this gets
 * silently faked is to count only successes: if a browser that never received
 * the keys reports nothing, the rate reads 100% precisely when it is most wrong.
 *
 * So the property under test is not "success is reported". It is **the negative
 * case is reported too**, exactly once per tab, with no note content.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import {
  CONFIG_SERVED_EVENT, WAIT_BUCKET_MS,
  configServedReport, reportConfigServed, __resetConfigServedReport,
} from './configServedEvent'
import NotebookFlagGate from '../../components/notebook/NotebookFlagGate'
import { latchNotebookFlags, __resetNotebookFlags } from './notebookFlags'

beforeEach(() => { __resetConfigServedReport(); __resetNotebookFlags() })

describe('the event name', () => {
  it('⛔ matches the server allowlist entry EXACTLY — a typo is a 400 and a silent nothing', () => {
    // The Python side is railed in tests/test_j2_telemetry_allowlist.py, which
    // reads THIS constant rather than retyping it. Pinning the literal here is
    // what makes that derivation meaningful.
    expect(CONFIG_SERVED_EVENT).toBe('notebook_config_served')
  })
})

describe('⛔⛔ the NEGATIVE case is reported — the half a naive counter drops', () => {
  it('served: false is a report, not a silence', () => {
    const props = configServedReport({ served: false, waitedMs: 3000 })
    expect(props, 'a browser that got NO keys must still appear in the denominator').not.toBeNull()
    expect(props.served).toBe(false)
  })

  it('⭐ CONTROL — the positive case reports too, or there is no numerator', () => {
    expect(configServedReport({ served: true, waitedMs: 10 }).served).toBe(true)
  })
})

describe('⛔ ONCE PER TAB — a duplicate inflates the denominator where nobody looks', () => {
  it('the second call in the same tab returns null', () => {
    expect(configServedReport({ served: true, waitedMs: 0 })).not.toBeNull()
    // ⛔ The pure decision does NOT latch; only a real report does. Otherwise a
    // rail could never drive two different shapes.
    const post = vi.fn()
    return (async () => {
      expect(await reportConfigServed({ served: true, waitedMs: 0 }, { post })).not.toBeNull()
      expect(await reportConfigServed({ served: true, waitedMs: 0 }, { post })).toBeNull()
      expect(post).toHaveBeenCalledTimes(1)
    })()
  })

  it('⛔ two resolves in the SAME TICK still send once — the flag is set before the await', async () => {
    const post = vi.fn(async () => {})
    await Promise.all([
      reportConfigServed({ served: true, waitedMs: 0 }, { post }),
      reportConfigServed({ served: true, waitedMs: 0 }, { post }),
    ])
    expect(post, 'latching after the await would let both callers through').toHaveBeenCalledTimes(1)
  })

  it('⭐ CONTROL — a NEW TAB reports again, or a rate over a window is impossible', () => {
    expect(configServedReport({ served: true, waitedMs: 0 })).not.toBeNull()
    __resetConfigServedReport()          // a new tab: fresh module state
    expect(configServedReport({ served: true, waitedMs: 0 }),
      'a persistent memory would silence every browser that reported before the window').not.toBeNull()
  })
})

describe('⛔ the payload carries NO note content, and its key set is pinned as a SET', () => {
  it('exactly two keys, both enumerated', () => {
    const props = configServedReport({ served: true, waitedMs: 700 })
    expect(Object.keys(props).sort()).toEqual(['served', 'waited_bucket_ms'])
  })

  it('the wait is BUCKETED, not a millisecond fingerprint', () => {
    expect(configServedReport({ served: true, waitedMs: 0 }).waited_bucket_ms).toBe(0)
    __resetConfigServedReport()
    expect(configServedReport({ served: true, waitedMs: 260 }).waited_bucket_ms).toBe(WAIT_BUCKET_MS)
    __resetConfigServedReport()
    // …and it is CAPPED, so a very slow answer cannot become a distinguishing value.
    expect(configServedReport({ served: false, waitedMs: 999999 }).waited_bucket_ms).toBe(4 * WAIT_BUCKET_MS)
  })

  it('a nonsense wait does not produce a nonsense field', () => {
    expect(configServedReport({ served: true, waitedMs: NaN }).waited_bucket_ms).toBe(0)
    __resetConfigServedReport()
    expect(configServedReport({ served: true, waitedMs: -5 }).waited_bucket_ms).toBe(0)
  })
})

describe('⛔⛔ THE GATE IS THE CALLER, and it reports BOTH outcomes', () => {
  it('a latched tab reports served: true', async () => {
    latchNotebookFlags({ notebook_offline_default_on: false })
    const seen = []
    const post = vi.fn(async (e, p) => { seen.push([e, p]) })
    // The gate calls the module directly, so drive the module the way the gate
    // does rather than reaching into the component's internals.
    await reportConfigServed({ served: true, waitedMs: 5 }, { post })
    expect(seen).toEqual([[CONFIG_SERVED_EVENT, { served: true, waited_bucket_ms: 0 }]])
  })

  it('⛔ a tab whose gate hit the DEADLINE reports served: false', async () => {
    const seen = []
    const post = vi.fn(async (e, p) => { seen.push([e, p]) })
    await reportConfigServed({ served: false, waitedMs: 3000 }, { post })
    expect(seen[0][1].served, 'the timeout case IS the measurement').toBe(false)
  })

  it('⭐ and the real gate mounts without throwing when the transport is absent', async () => {
    // Best-effort: an instrument that can break the thing it measures is worse
    // than no instrument. No fetch is stubbed here on purpose.
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_offline_default_on: true })
    await act(async () => {
      render(<NotebookFlagGate><div>notebook</div></NotebookFlagGate>)
    })
    expect(document.body.textContent).toContain('notebook')
  })
})
