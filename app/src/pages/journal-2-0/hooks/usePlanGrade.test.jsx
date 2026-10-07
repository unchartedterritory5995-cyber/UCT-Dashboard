// hooks/usePlanGrade.js: the client's reads of plan vs execution grading. Every answer here is
// the one the SERVER really gives (contract fixtures), fed through a fake `fetch`.
//
// What a member depends on:
//   * a FAILED read is an error, never "no plan" (that would be a claim about their discipline
//     the server never made) and never an empty record;
//   * with the switch off nothing is fetched at all;
//   * Re-link shows the server's own sentence when it refuses, and the new grade without a
//     second read when it works;
//   * a page with more trades than one request may carry still gets a status for every trade.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import usePlanGrade, {
  MAX_STATUS_IDS, PLAN_GRADING_FLAG, planGradingEnabled, usePlanStatuses, useDisciplineRecord,
} from './usePlanGrade'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { contract, contractBody, contractResponse, nonJsonResponse } from '../__fixtures__/contract'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)
const on = () => latchNotebookFlags({ [PLAN_GRADING_FLAG]: true })

let calls
let server
beforeEach(() => {
  calls = []
  server = () => { throw new Error('this test did not expect a request') }
  global.fetch = vi.fn(async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, init }
    calls.push(call)
    return server(call)
  })
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

const gets = () => calls.filter((c) => c.method === 'GET')

describe('the gate', () => {
  it('is off until the server sends a real true', () => {
    expect(planGradingEnabled()).toBe(false)
    latchNotebookFlags({ [PLAN_GRADING_FLAG]: 'true', notebook_offline_read_on: true })
    expect(planGradingEnabled()).toBe(false)
  })

  it('is on for true', () => {
    on()
    expect(planGradingEnabled()).toBe(true)
  })
})

describe('usePlanGrade: one trade\'s plan and four checks', () => {
  it('fetches nothing and reports nothing while the switch is off', async () => {
    const { result } = renderHook(() => usePlanGrade('pg-planned'), { wrapper })
    expect(result.current).toMatchObject({ enabled: false, grade: null, error: null, isLoading: false })
    await expect(result.current.relink({ none: true })).resolves.toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it.each([['null', null], ['undefined', undefined], ['an empty string', '']])(
    'fetches nothing for a trade id of %s, and is not "loading"', (_label, id) => {
      on()
      const { result } = renderHook(() => usePlanGrade(id), { wrapper })
      expect(result.current).toMatchObject({ enabled: true, grade: null, error: null, isLoading: false })
      expect(global.fetch).not.toHaveBeenCalled()
    })

  it('returns the grade exactly as the server sent it', async () => {
    on()
    server = () => contractResponse('plan-grades.trade.planned')
    const { result } = renderHook(() => usePlanGrade('pg-planned'), { wrapper })
    expect(result.current.isLoading).toBe(true)
    expect(result.current.grade).toBeNull()
    await waitFor(() => expect(result.current.grade).not.toBeNull())
    expect(result.current.grade).toEqual(contractBody('plan-grades.trade.planned'))
    expect(result.current).toMatchObject({ error: null, isLoading: false })
    expect(gets()).toHaveLength(1)
    expect(gets()[0].url).toBe(contract('plan-grades.trade.planned')._contract.path)
    expect(gets()[0].init.credentials).toBe('include')
  })

  it('escapes the trade id in the path', async () => {
    on()
    server = () => contractResponse('plan-grades.trade.unplanned')
    renderHook(() => usePlanGrade('a/b c?d'), { wrapper })
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toBe('/api/j2/plan-grades/trades/a%2Fb%20c%3Fd')
  })

  it('an unplanned trade is DATA (status "unplanned"), not an error and not null', async () => {
    on()
    server = () => contractResponse('plan-grades.trade.unplanned')
    const { result } = renderHook(() => usePlanGrade('pg-unplanned'), { wrapper })
    await waitFor(() => expect(result.current.grade).not.toBeNull())
    expect(result.current.grade.status).toBe('unplanned')
    expect(result.current.grade.plan).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('a refused read is an ERROR carrying the status, never an empty grade', async () => {
    on()
    server = () => contractResponse('plan-grades.trade.not-found')
    const { result } = renderHook(() => usePlanGrade('pg-theirs'), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error.status).toBe(404)
    expect(result.current.error.message).toBe('Plan grade request failed (404)')
    expect(result.current.grade).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('a server error with a body that is not JSON is still an error', async () => {
    on()
    server = () => nonJsonResponse(502)
    const { result } = renderHook(() => usePlanGrade('pg-planned'), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error.status).toBe(502)
    expect(result.current.grade).toBeNull()
  })

  it('a dropped connection is an error, not an unplanned trade', async () => {
    on()
    server = () => { throw new TypeError('Failed to fetch') }
    const { result } = renderHook(() => usePlanGrade('pg-planned'), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.grade).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('does not retry a failed read on its own', async () => {
    on()
    server = () => contractResponse('plan-grades.trade.not-found')
    const { result } = renderHook(() => usePlanGrade('pg-theirs'), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    await new Promise((r) => setTimeout(r, 60))
    expect(calls).toHaveLength(1)
  })

  describe('Re-link', () => {
    const picking = () => {
      on()
      server = (c) => (c.method === 'GET' ? contractResponse('plan-grades.trade.needs-pick') : contractResponse('plan-grades.relink.pick'))
      return renderHook(() => usePlanGrade('pg-pick'), { wrapper })
    }

    it('posts the choice and shows the new grade without reading again', async () => {
      const { result } = picking()
      await waitFor(() => expect(result.current.grade?.status).toBe('needs_pick'))
      const choice = contract('plan-grades.relink.pick')._contract.requestBody
      let returned
      await act(async () => { returned = await result.current.relink(choice) })
      const post = calls.find((c) => c.method === 'POST')
      expect(post.url).toBe('/api/j2/plan-grades/trades/pg-pick/relink')
      expect(post.body).toEqual(choice)
      expect(post.init.credentials).toBe('include')
      expect(post.init.headers['Content-Type']).toBe('application/json')
      expect(returned).toEqual(contractBody('plan-grades.relink.pick'))
      await waitFor(() => expect(result.current.grade.status).toBe('planned'))
      expect(result.current.grade).toEqual(contractBody('plan-grades.relink.pick'))
      expect(result.current.grade.plan.noteId).toBe('pg-note-other')
      expect(gets()).toHaveLength(1)                             // the POST's answer IS the new grade
    })

    it('throws the server\'s own sentence when it refuses, and leaves the grade as it was', async () => {
      const { result } = picking()
      await waitFor(() => expect(result.current.grade?.status).toBe('needs_pick'))
      server = () => contractResponse('plan-grades.relink.choose-one')
      const sentence = contractBody('plan-grades.relink.choose-one').detail
      expect(sentence).toMatch(/exactly one/)                     // non-vacuity: the fixture carries a sentence
      await expect(result.current.relink({})).rejects.toThrow(sentence)
      expect(result.current.grade.status).toBe('needs_pick')
    })

    it('carries the refusal for a note that is not the member\'s', async () => {
      const { result } = picking()
      await waitFor(() => expect(result.current.grade).not.toBeNull())
      server = () => contractResponse('plan-grades.relink.unknown-note')
      await expect(result.current.relink({ noteId: 'nope' })).rejects.toThrow(contractBody('plan-grades.relink.unknown-note').detail)
    })

    it('says which status failed when the refusal has no readable body', async () => {
      const { result } = picking()
      await waitFor(() => expect(result.current.grade).not.toBeNull())
      server = () => nonJsonResponse(502)
      await expect(result.current.relink({ none: true })).rejects.toThrow('Re-link failed (502)')
    })

    it('sends an empty object when called with nothing, so the server answers, not a crash', async () => {
      const { result } = picking()
      await waitFor(() => expect(result.current.grade).not.toBeNull())
      server = () => contractResponse('plan-grades.relink.choose-one')
      await expect(result.current.relink()).rejects.toThrow()
      expect(calls.find((c) => c.method === 'POST').body).toEqual({})
    })
  })
})

describe('usePlanStatuses: planned or unplanned for a page of trades', () => {
  it('fetches nothing while the switch is off', () => {
    const { result } = renderHook(() => usePlanStatuses(['pg-planned']), { wrapper })
    expect(result.current).toEqual({ enabled: false, statuses: null, error: null })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it.each([['undefined', undefined], ['null', null], ['an empty list', []], ['only junk', [null, '', 5, {}, undefined]]])(
    'fetches nothing for %s', (_label, ids) => {
      on()
      const { result } = renderHook(() => usePlanStatuses(ids), { wrapper })
      expect(result.current.statuses).toBeNull()
      expect(global.fetch).not.toHaveBeenCalled()
    })

  it('returns the statuses the server sent, keyed by trade id', async () => {
    on()
    server = () => contractResponse('plan-grades.status')
    const ids = ['pg-planned', 'pg-pick', 'pg-unplanned', 'pg-placeholder', 'nope']
    const { result } = renderHook(() => usePlanStatuses(ids), { wrapper })
    await waitFor(() => expect(result.current.statuses).not.toBeNull())
    expect(result.current.statuses).toEqual(contractBody('plan-grades.status').statuses)
    expect(result.current.statuses['pg-unplanned'].status).toBe('unplanned')
    expect(result.current.statuses.nope).toBeUndefined()         // an id the server does not know is absent
    expect(result.current.error).toBeNull()
  })

  it('asks once for a sorted, de-duplicated, escaped id list, whatever order the page lists them in', async () => {
    on()
    server = () => contractResponse('plan-grades.status')
    const { rerender } = renderHook(({ ids }) => usePlanStatuses(ids), {
      wrapper, initialProps: { ids: ['b', 'a', 'b', null, 7, '', 'c d'] },
    })
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toBe('/api/j2/plan-grades/status?ids=a,b,c%20d')
    rerender({ ids: ['c d', 'a', 'b'] })
    await new Promise((r) => setTimeout(r, 40))
    expect(calls).toHaveLength(1)                                // same set, same key, no second request
  })

  it('a member with no trades gets an empty object, which is data, not a failure', async () => {
    on()
    server = () => contractResponse('plan-grades.status.empty')
    const { result } = renderHook(() => usePlanStatuses(['pg-planned']), { wrapper })
    await waitFor(() => expect(result.current.statuses).not.toBeNull())
    expect(result.current.statuses).toEqual({})
    expect(result.current.error).toBeNull()
  })

  it('a refused read is an error with no statuses, never "every trade is unplanned"', async () => {
    on()
    server = () => contractResponse('plan-grades.status.too-many')
    const { result } = renderHook(() => usePlanStatuses(['a']), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error.status).toBe(400)
    expect(result.current.statuses).toBeNull()
  })

  it('the client cap is the server\'s cap', () => {
    // The server refuses 201 ids with this sentence; the client batches at the same number.
    expect(contractBody('plan-grades.status.too-many').detail).toBe(`At most ${MAX_STATUS_IDS} trades at a time`)
  })

  describe('more trades than one request may carry', () => {
    const many = Array.from({ length: MAX_STATUS_IDS + 50 }, (_, i) => `t${String(i).padStart(4, '0')}`)
    const answerFor = (c) => {
      const ids = decodeURIComponent(c.url.split('ids=')[1]).split(',')
      return { ok: true, status: 200, json: async () => ({ statuses: Object.fromEntries(ids.map((id) => [id, { tradeRef: `id:${id}`, status: 'unplanned' }])) }) }
    }

    it('asks in batches of the cap and merges them, dropping no trade', async () => {
      on()
      server = answerFor
      const { result } = renderHook(() => usePlanStatuses(many), { wrapper })
      await waitFor(() => expect(result.current.statuses).not.toBeNull())
      expect(calls).toHaveLength(2)
      const sizes = calls.map((c) => c.url.split('ids=')[1].split(',').length).sort((a, b) => a - b)
      expect(sizes).toEqual([50, MAX_STATUS_IDS])
      expect(Object.keys(result.current.statuses)).toHaveLength(many.length)
      expect(result.current.statuses[many[many.length - 1]].status).toBe('unplanned')   // the LAST one too
    })

    it('one failing batch fails the whole read: a partial answer would read as "planned"', async () => {
      on()
      let n = 0
      server = (c) => { n += 1; return n === 2 ? contractResponse('plan-grades.status.too-many') : answerFor(c) }
      const { result } = renderHook(() => usePlanStatuses(many), { wrapper })
      await waitFor(() => expect(result.current.error).not.toBeNull())
      expect(result.current.statuses).toBeNull()
    })

    it('exactly the cap is still one request', async () => {
      on()
      server = answerFor
      renderHook(() => usePlanStatuses(many.slice(0, MAX_STATUS_IDS)), { wrapper })
      await waitFor(() => expect(calls.length).toBeGreaterThan(0))
      await new Promise((r) => setTimeout(r, 30))
      expect(calls).toHaveLength(1)
    })
  })
})

describe('useDisciplineRecord: the last 20 and 60 closed trades', () => {
  it('fetches nothing while the switch is off', () => {
    const { result } = renderHook(() => useDisciplineRecord(), { wrapper })
    expect(result.current).toMatchObject({ enabled: false, record: null, error: null, isLoading: false })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns the record exactly as the server sent it', async () => {
    on()
    server = () => contractResponse('plan-grades.discipline')
    const { result } = renderHook(() => useDisciplineRecord(), { wrapper })
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.record).not.toBeNull())
    expect(result.current.record).toEqual(contractBody('plan-grades.discipline'))
    expect(result.current.record.windows.map((w) => w.size)).toEqual([20, 60])
    expect(calls[0].url).toBe('/api/j2/plan-grades/discipline')
  })

  it('a member with no closed trades gets a record of zeros with "too few" wording, not null', async () => {
    on()
    server = () => contractResponse('plan-grades.discipline.empty')
    const { result } = renderHook(() => useDisciplineRecord(), { wrapper })
    await waitFor(() => expect(result.current.record).not.toBeNull())
    expect(result.current.record.totalClosed).toBe(0)
    expect(result.current.record.windows[0].planRate).toMatchObject({ band: 'too_few', n: 0, rate: null })
    expect(result.current.error).toBeNull()
  })

  it('narrows to an account, escaped', async () => {
    on()
    server = () => contractResponse('plan-grades.discipline')
    renderHook(() => useDisciplineRecord('acct a&b'), { wrapper })
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toBe('/api/j2/plan-grades/discipline?accountId=acct%20a%26b')
  })

  it('a failed read is an error with no record, and Try again reads once more', async () => {
    on()
    server = () => contractResponse('plan-grades.discipline.signed-out')
    const { result } = renderHook(() => useDisciplineRecord(), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error.status).toBe(401)
    expect(result.current.record).toBeNull()
    expect(result.current.isLoading).toBe(false)
    server = () => contractResponse('plan-grades.discipline')
    await act(async () => { await result.current.retry() })
    await waitFor(() => expect(result.current.record).not.toBeNull())
    expect(result.current.error).toBeNull()
    expect(calls).toHaveLength(2)
  })
})
