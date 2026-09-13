/**
 * Wave Q1 — THE DENOMINATOR HAS TO BE TRUSTWORTHY TOO.
 *
 * The flag-flip gate reads "zero `notebook_blocked_no_baseline` events across
 * the instrument clock". That number is meaningless without knowing how many
 * browsers ran the offline layer, so this event supplies the denominator — and
 * a denominator that fires on the wrong thing is worse than none, because it
 * makes an empty population look like a real one.
 *
 * ⛔ So every test here is "and on nothing else", and the silent cases are the
 * load-bearing ones: a reload with `'1'` already set, `'1'` → `'1'`, and the
 * state PRODUCTION IS ACTUALLY IN — flag off, key unset — which must never
 * report, ever.
 */
import { render, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { OFFLINE_FLAG_KEY } from './offlineFlag'
import {
  OPT_IN_EVENT, OPT_IN_REPORTED_KEY, shouldReportOptIn, optInProps, reportOptIn,
} from './offlineOptInEvent'
import { AuthContext } from '../../../../context/AuthContext'

/** A localStorage that is real enough to hold state and simple enough to drive. */
function store(initial = {}) {
  const m = new Map(Object.entries(initial))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _dump: () => Object.fromEntries(m),
  }
}

describe('⭐ the transition, and only the transition', () => {
  it('unset → "1" REPORTS — this is the opt-in', async () => {
    const s = store({ [OFFLINE_FLAG_KEY]: '1' })
    const post = vi.fn(async () => {})
    expect(shouldReportOptIn(s)).toBe(true)
    const props = await reportOptIn({ storage: s, post })
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0][0]).toBe(OPT_IN_EVENT)
    expect(props).not.toBeNull()
  })

  it('⛔ "1" → "1" is SILENT — a reload is not a new browser', async () => {
    // The single most likely way a count like this gets inflated: every mount
    // reporting, so one enthusiastic tester reads as a population.
    const s = store({ [OFFLINE_FLAG_KEY]: '1', [OPT_IN_REPORTED_KEY]: '1' })
    const post = vi.fn(async () => {})
    expect(shouldReportOptIn(s)).toBe(false)
    expect(await reportOptIn({ storage: s, post })).toBeNull()
    expect(post).not.toHaveBeenCalled()
  })

  it('⛔ a SECOND mount in the same browser is silent — proved by running it twice', async () => {
    const s = store({ [OFFLINE_FLAG_KEY]: '1' })
    const post = vi.fn(async () => {})
    await reportOptIn({ storage: s, post })
    await reportOptIn({ storage: s, post })
    await reportOptIn({ storage: s, post })
    expect(post).toHaveBeenCalledTimes(1)
  })

  // REWRITTEN AT THE FLIP. This asserted that production's state - key unset -
  // NEVER reports, and it was right while unset meant OFF. After the flip unset
  // means ON, so "never reports" would put the denominator at zero for the
  // entire member population: a healthy-looking zero over everyone.
  describe('THE DENOMINATOR COUNTS THE ACTIVE LAYER, NOT THE LITERAL KEY', () => {
    it('unset key + default ON => reports ONCE, and the payload says it was the default', async () => {
      const s = store({})
      const post = vi.fn(async () => {})
      expect(shouldReportOptIn(s)).toBe(true)
      const props = await reportOptIn({ storage: s, post })
      expect(post).toHaveBeenCalledTimes(1)
      expect(props.flag).toMatchObject({ key: null, byDefault: true, enabled: true })
      expect(s.getItem(OPT_IN_REPORTED_KEY)).toBe('1')
    })

    it('a SECOND and THIRD load of the same browser do not re-report', async () => {
      // THE REGRESSION THIS PINS. The marker used to mirror the KEY and remove
      // itself when the key was unset - which, once unset means ON, clears the
      // dedupe every load and turns a once-per-BROWSER count into a
      // once-per-PAGE-VIEW count. The denominator would inflate without bound.
      const s = store({})
      const post = vi.fn(async () => {})
      await reportOptIn({ storage: s, post })
      await reportOptIn({ storage: s, post })
      await reportOptIn({ storage: s, post })
      expect(post).toHaveBeenCalledTimes(1)
    })

    it("an EXPLICIT key of 0 never reports, however many loads", async () => {
      const s = store({ [OFFLINE_FLAG_KEY]: '0' })
      const post = vi.fn(async () => {})
      expect(shouldReportOptIn(s)).toBe(false)
      expect(await reportOptIn({ storage: s, post })).toBeNull()
      expect(await reportOptIn({ storage: s, post })).toBeNull()
      expect(post).not.toHaveBeenCalled()
      expect(s.getItem(OPT_IN_REPORTED_KEY)).toBe('0')
    })

    it("an EXPLICIT key of 1 reports once, and says it was NOT the default", async () => {
      const s = store({ [OFFLINE_FLAG_KEY]: '1' })
      const post = vi.fn(async () => {})
      const props = await reportOptIn({ storage: s, post })
      expect(props.flag).toMatchObject({ key: '1', byDefault: false, enabled: true })
      await reportOptIn({ storage: s, post })
      expect(post).toHaveBeenCalledTimes(1)
    })

    it('CONTROL - off and back on counts AGAIN, so a real re-opt-in is not swallowed', async () => {
      const s = store({})
      const post = vi.fn(async () => {})
      await reportOptIn({ storage: s, post })
      s.setItem(OFFLINE_FLAG_KEY, '0')
      await reportOptIn({ storage: s, post })
      s.removeItem(OFFLINE_FLAG_KEY)
      await reportOptIn({ storage: s, post })
      expect(post).toHaveBeenCalledTimes(2)
    })
  })

  it('⛔ an explicit opt-OUT ("0") never reports', async () => {
    const s = store({ [OFFLINE_FLAG_KEY]: '0' })
    const post = vi.fn(async () => {})
    expect(await reportOptIn({ storage: s, post })).toBeNull()
    expect(post).not.toHaveBeenCalled()
  })

  it('⭐ opt-out then opt-in REPORTS AGAIN — and that is deliberate', async () => {
    // The marker records what was OBSERVED, not merely what was reported. If it
    // only ever recorded '1', an opt-out would freeze the marker and a genuine
    // later opt-in would be invisible — the count would under-report exactly the
    // population it exists to size.
    const s = store({ [OFFLINE_FLAG_KEY]: '1' })
    const post = vi.fn(async () => {})
    await reportOptIn({ storage: s, post })          // opt-in     -> 1 call
    s.setItem(OFFLINE_FLAG_KEY, '0')
    await reportOptIn({ storage: s, post })          // opt-out    -> silent
    expect(post).toHaveBeenCalledTimes(1)
    s.setItem(OFFLINE_FLAG_KEY, '1')
    await reportOptIn({ storage: s, post })          // re-opt-in  -> 2 calls
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('⛔ the marker is written even when nothing is sent', async () => {
    const s = store({ [OFFLINE_FLAG_KEY]: '0' })
    await reportOptIn({ storage: s, post: vi.fn(async () => {}) })
    expect(s.getItem(OPT_IN_REPORTED_KEY)).toBe('0')
  })
})

describe('⛔⛔ WHAT IS SENT — a session id, the flag, a timestamp. Nothing else.', () => {
  it('the key set is EXACTLY these three fields', () => {
    const props = optInProps({ sessionId: 's-1', now: () => '2026-09-10T06:00:00.000Z', storage: store({ [OFFLINE_FLAG_KEY]: '1' }) })
    expect(Object.keys(props).sort()).toEqual(['at', 'flag', 'sessionId'])
    expect(props).toMatchObject({ sessionId: 's-1', at: '2026-09-10T06:00:00.000Z' })
  })

  it('⭐ the flag state distinguishes "off by default" from "explicitly off"', () => {
    // ⛔⛔ FLIPPED 2026-09-12. `byDefault` still means "the key was unset" — what
    // CHANGED is what that resolves to. An unset key is now ENABLED, and this is
    // the assertion that proves the telemetry says so.
    expect(optInProps({ storage: store({}) }).flag).toMatchObject({ key: null, byDefault: true, enabled: true })
    expect(optInProps({ storage: store({ [OFFLINE_FLAG_KEY]: '1' }) }).flag).toMatchObject({ key: '1', byDefault: false, enabled: true })
  })

  it('no member content can reach the payload', () => {
    const json = JSON.stringify(optInProps({ sessionId: 's-1', storage: store({ [OFFLINE_FLAG_KEY]: '1', 'uct.j2.notedraft.n1': 'MEMBER SECRET' }) }))
    expect(json).not.toMatch(/MEMBER SECRET/)
    expect(json).not.toMatch(/notedraft|title|body/i)
  })

  it('⛔ a throwing transport does not propagate', async () => {
    const s = store({ [OFFLINE_FLAG_KEY]: '1' })
    const post = vi.fn(async () => { throw new Error('telemetry is down') })
    await expect(reportOptIn({ storage: s, post })).rejects.toThrow()
    // …but the real transport swallows, which is what the call site relies on:
    // ⛔ importActual: this file mocks './telemetry' for the wire tests below,
    //    and asserting the transport against its own mock would prove nothing.
    const { postJ2Telemetry } = await vi.importActual('./telemetry')
    const fetchImpl = vi.fn(async () => { throw new Error('offline') })
    await expect(postJ2Telemetry(OPT_IN_EVENT, {}, { fetchImpl })).resolves.toBeDefined()
  })
})

describe('⭐ THE TRANSPORT', () => {
  it('posts the allow-listed name to /api/j2/telemetry', async () => {
    // ⛔ importActual: this file mocks './telemetry' for the wire tests below,
    //    and asserting the transport against its own mock would prove nothing.
    const { postJ2Telemetry } = await vi.importActual('./telemetry')
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    await postJ2Telemetry(OPT_IN_EVENT, { sessionId: 's-1' }, { fetchImpl })
    const [url, opts] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/j2/telemetry')
    expect(JSON.parse(opts.body).event).toBe('notebook_offline_opt_in')
    expect(OPT_IN_EVENT).toBe('notebook_offline_opt_in')
  })
})

/* ─── the wire ────────────────────────────────────────────────────────────── */

const posted = []
vi.mock('./telemetry', async (orig) => {
  const real = await orig()
  return {
    ...real,
    postJ2Telemetry: async (event, props) => { posted.push({ event, props }); return props },
  }
})
vi.mock('../../hooks/useJ2Notes', () => ({
  default: () => ({ notes: [], isLoading: false, error: null, refresh: vi.fn(), mutate: vi.fn(), total: 0, hasMore: false, loadMore: vi.fn(), isLoadingMore: false }),
}))
vi.mock('../../hooks/useJ2SavedViews', () => ({ default: () => ({ views: [], create: vi.fn(), update: vi.fn(), remove: vi.fn(), refresh: vi.fn() }) }))
vi.mock('../../hooks/useJ2PropertyDefs', () => ({ default: () => ({ defs: [], refresh: vi.fn() }) }))
vi.mock('../../components/notebook/FolderSidebar', () => ({ default: () => null }))
vi.mock('../../components/notebook/NoteEditorPage', () => ({ default: () => null }))
vi.mock('../../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../../components/notebook/export/ExportDialog', () => ({ default: () => null }))
vi.mock('../../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../../components/notebook/ResearchHome', () => ({ default: () => <div data-testid="home" /> }))

describe('⭐⭐ THE WIRE — the Notebook actually reports it', () => {
  beforeEach(() => {
    posted.length = 0
    localStorage.clear()
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
  })
  afterEach(() => { localStorage.clear(); vi.clearAllMocks() })

  async function mountTab() {
    const NotebookTab = (await import('../../tabs/NotebookTab')).default
    render(
      <AuthContext.Provider value={{ user: { id: 'u42', role: 'member' } }}>
        <MemoryRouter><NotebookTab /></MemoryRouter>
      </AuthContext.Provider>,
    )
    await act(async () => { await Promise.resolve() })
  }

  it('an opted-in browser reports once on mount', async () => {
    // §MUTATION: delete the `reportOptIn()` effect in NotebookTab and this goes
    // red while every other rail in the wave stays green.
    localStorage.setItem(OFFLINE_FLAG_KEY, '1')
    await mountTab()
    expect(posted.filter((p) => p.event === OPT_IN_EVENT)).toHaveLength(1)
  })

  it('a DEFAULT browser (key unset) now reports EXACTLY ONCE - it IS the denominator', async () => {
    // Was "reports nothing", correct while unset meant OFF. The flip makes the
    // default browser THE population, so it is the one that must be counted; a
    // wire test asserting silence here would have hidden that.
    await mountTab()
    expect(posted.filter((p) => p.event === OPT_IN_EVENT)).toHaveLength(1)
  })
})
