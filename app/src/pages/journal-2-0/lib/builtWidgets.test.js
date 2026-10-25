// Wave 8 (Task 8.13): the built-widget client. Asserted by the request the browser actually sends and by the
// exact sentences a member reads.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BUILT_KIND, DEFS_URL, BUILT_CHANGE_KEYS, FAILURE_COPY, FAILED_SENTENCE,
  postJson, putJson, getJson, ifMatchHeader, runBuilt, drillBuilt, builtRefreshParams, viewerSettingsOf, failureText,
  overridableFilter, loadAccounts, loadVocabulary, loadCatalog, loadDefinition, __resetBuiltCaches,
} from './builtWidgets'

const setOnline = (value) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

let fetchSpy
beforeEach(() => {
  setOnline(true)
  __resetBuiltCaches()
  fetchSpy = vi.fn(async () => reply(200, { asOf: '2026-10-24T14:00:00Z' }))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => {
  vi.unstubAllGlobals()
  setOnline(true)
})

const PARAMS = {
  asOf: '2026-10-20T14:00:00Z', defId: 'd-1', defRev: 3, def: { v: 1, source: 'closed_trades' },
  title: 'Net P&L by setup', count: 47, share: true, range: { token: 'last_30d' }, accountId: 'acc-2',
  filter: ['Flag', 'VCP'], rows: [{ label: 'Flag', v1: 120 }],
}

describe('constants', () => {
  it('names the kind, the route and the three settings Change edits', () => {
    expect(BUILT_KIND).toBe('builtWidget')
    expect(DEFS_URL).toBe('/api/j2/widget-definitions')
    expect(BUILT_CHANGE_KEYS).toEqual(['range', 'accountId', 'filter'])
  })
})

describe('failureText', () => {
  it('failureText_exact_copy: the spec 5.10 sentence for each state', () => {
    expect(failureText('busy')).toBe('Busy right now. Try again in a moment.')
    expect(failureText('too_long')).toBe('This is a lot of data to add up. Try a shorter range or fewer splits.')
    expect(failureText('rate')).toBe('Too many refreshes in a minute. Try again shortly.')
    expect(failureText('rate_preview')).toBe('Pausing the preview for a moment; your changes are kept.')
    expect(failureText('daily_cap')).toBe('You have refreshed widgets a lot today. Snapshots stay; refreshing resumes tomorrow.')
    expect(failureText('count_cap')).toBe('You have 100 widgets. Archive one in My tools to make room.')
    expect(failureText('conflict')).toBe('Changed in another tab. Reload to see the newer version.')
    expect(failureText('too_new')).toBe('This widget was made with a newer version of the app. Reload to use it.')
    expect(failureText('offline')).toBe("Offline. The preview updates when you're back.")
    expect(failureText('unavailable')).toBe('Not available right now.')
  })

  it('superseded is quiet, invalid shows the server sentence, anything else the snapshot-unchanged sentence', () => {
    expect(failureText('superseded', 'A newer preview replaced this one.')).toBe('')
    expect(failureText('invalid', 'The start date is after the end date.')).toBe('The start date is after the end date.')
    expect(failureText('invalid')).toBe(FAILED_SENTENCE)
    expect(failureText('failed')).toBe(FAILED_SENTENCE)
    expect(failureText(undefined)).toBe(FAILED_SENTENCE)
    // R60: a code that names an Object.prototype member reads only the table's own entries.
    expect(failureText('__proto__')).toBe(FAILED_SENTENCE)
    expect(failureText('toString')).toBe(FAILED_SENTENCE)
    // superseded is not in the visible copy set
    expect(Object.keys(FAILURE_COPY)).not.toContain('superseded')
  })
})

describe('postJson', () => {
  it('run_offline_makes_no_request', async () => {
    setOnline(false)
    const got = await runBuilt(PARAMS)
    expect(got).toEqual({ ok: false, code: 'offline', message: FAILURE_COPY.offline })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('posts JSON to the route under DEFS_URL, with POST named, and answers the data', async () => {
    fetchSpy.mockResolvedValueOnce(reply(200, { hello: 1 }))
    const got = await postJson('/preview', { plan: { a: 1 } })
    expect(got).toEqual({ ok: true, data: { hello: 1 } })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/j2/widget-definitions/preview')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(init.body)).toEqual({ plan: { a: 1 } })
  })

  it('reads the server error body; a 404 is unavailable; a 428 (no If-Match) is a conflict; a throw never escapes', async () => {
    fetchSpy.mockResolvedValueOnce(reply(503, { detail: { code: 'busy', message: 'Busy right now. Try again in a moment.' } }))
    expect(await postJson('/run', {})).toEqual({ ok: false, code: 'busy', message: 'Busy right now. Try again in a moment.', status: 503 })
    fetchSpy.mockResolvedValueOnce(reply(404, { detail: 'Not Found' }))
    expect((await postJson('/run', {})).code).toBe('unavailable')
    fetchSpy.mockResolvedValueOnce(reply(428, { detail: { code: 'conflict', message: 'Reload to see the newer version.' } }))
    expect((await postJson('/run', {})).code).toBe('conflict')
    fetchSpy.mockResolvedValueOnce(reply(428, {}))
    expect((await postJson('/run', {})).code).toBe('conflict')
    fetchSpy.mockResolvedValueOnce(reply(500, null))
    expect((await postJson('/run', {})).code).toBe('failed')
    fetchSpy.mockRejectedValueOnce(new Error('network'))
    expect(await postJson('/run', {})).toEqual({ ok: false, code: 'failed', message: '' })
    fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('bad json') } })
    expect((await postJson('/run', {})).code).toBe('failed')
  })
})

describe('one client for every caller (wave 8 consolidation: My tools reads and writes through these)', () => {
  it('a refusal keeps its HTTP status; 402 is `paid` with the client sentence; a plain-string detail is the message', async () => {
    fetchSpy.mockResolvedValueOnce(reply(402, { detail: 'Built widgets require a paid plan' }))
    expect(await postJson('/d-1/archive')).toEqual({ ok: false, code: 'paid', message: 'Widgets need a paid plan.', status: 402 })
    expect(failureText('paid')).toBe('Widgets need a paid plan.')
    fetchSpy.mockResolvedValueOnce(reply(404, { detail: 'Not Found' }))
    expect(await putJson('/d-1', {}, 3)).toEqual({ ok: false, code: 'unavailable', message: FAILURE_COPY.unavailable, status: 404 })
    fetchSpy.mockResolvedValueOnce(reply(428, {}))
    expect(await postJson('/d-1/revs/2/restore', {})).toMatchObject({ code: 'conflict', status: 428 })
    fetchSpy.mockResolvedValueOnce(reply(400, { detail: 'Something plain' }))
    expect(await getJson('/api/j2/widget-definitions?view=live')).toEqual({ ok: false, code: 'failed', message: 'Something plain', status: 400 })
    fetchSpy.mockResolvedValueOnce(reply(409, { detail: { code: 'count_cap', message: 'You have 100 widgets.' } }))
    expect(await postJson('', {})).toEqual({ ok: false, code: 'count_cap', message: 'You have 100 widgets.', status: 409 })
    fetchSpy.mockResolvedValueOnce(reply(200, [1, 2]))
    expect(await getJson('/x')).toEqual({ ok: false, code: 'failed', message: '', status: 200 })
  })

  it('POST carries If-Match for an etag (a version restore), with the same headers, credentials and body as before', async () => {
    fetchSpy.mockResolvedValue(reply(200, { etag: 9 }))
    await postJson('/d-1/revs/2/restore', {}, { etag: 8 })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/j2/widget-definitions/d-1/revs/2/restore')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', body: '{}' })
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'If-Match': '8' })
    expect(init.signal).toBeDefined()                                     // the same 15 s ceiling
    await postJson('/d-1/archive')
    expect(fetchSpy.mock.calls[1][1].headers).toEqual({ 'Content-Type': 'application/json' })
    expect(fetchSpy.mock.calls[1][1].body).toBe('{}')
    await getJson('/api/j2/widget-definitions/d-1')
    expect(fetchSpy.mock.calls[2][1]).toMatchObject({ method: 'GET', credentials: 'include' })
    expect(fetchSpy.mock.calls[2][1].headers).toBeUndefined()
  })
})

describe('postJson idempotency (ruling R-43)', () => {
  it('sends Idempotency-Key only when one is given (the create POST of the builder), never a blank one', async () => {
    fetchSpy.mockResolvedValue(reply(200, { id: 'd-1' }))
    await postJson('', { plan: {} }, { idempotencyKey: '3f2b8c1e-9d4a-4b7e-8f21-6a5c0d9e1b72' })
    expect(fetchSpy.mock.calls[0][1].headers['Idempotency-Key']).toBe('3f2b8c1e-9d4a-4b7e-8f21-6a5c0d9e1b72')
    expect(fetchSpy.mock.calls[0][1].headers['Content-Type']).toBe('application/json')
    await postJson('/preview', { plan: {} })
    await postJson('', { plan: {} }, { idempotencyKey: '' })
    for (const call of fetchSpy.mock.calls.slice(1)) expect('Idempotency-Key' in call[1].headers).toBe(false)
  })
})

describe('putJson / ifMatchHeader (ruling R-15: the etag, never rev)', () => {
  it('sends If-Match with the etag, and no header for a missing one', async () => {
    fetchSpy.mockResolvedValue(reply(200, { etag: 8 }))
    await putJson('/d-1', { name: 'x' }, 7)
    expect(fetchSpy.mock.calls[0][1].method).toBe('PUT')
    expect(fetchSpy.mock.calls[0][1].headers['If-Match']).toBe('7')
    await putJson('/d-1', { name: 'x' }, undefined)
    expect(fetchSpy.mock.calls[1][1].headers['If-Match']).toBeUndefined()
    expect(ifMatchHeader('12')).toEqual({ 'If-Match': '12' })
    expect(ifMatchHeader('W/"12"')).toEqual({})
    expect(ifMatchHeader(1.5)).toEqual({})
  })
})

describe('runBuilt', () => {
  it('posts {defId, defRev, def, settings} where settings are the viewer settings', async () => {
    fetchSpy.mockResolvedValueOnce(reply(200, { asOf: '2026-10-24T14:00:00Z', rows: [] }))
    const got = await runBuilt(PARAMS)
    expect(got.ok).toBe(true)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/j2/widget-definitions/run')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      defId: 'd-1', defRev: 3, def: { v: 1, source: 'closed_trades' },
      settings: { range: { token: 'last_30d' }, accountId: 'acc-2', filter: ['Flag', 'VCP'] },
    })
  })

  it('an answer that is not a snapshot (no asOf) is a failure', async () => {
    fetchSpy.mockResolvedValueOnce(reply(200, { rows: [] }))
    expect(await runBuilt(PARAMS)).toEqual({ ok: false, code: 'failed', message: '' })
  })

  it('a frozen copy alone runs: no defId sent', async () => {
    await runBuilt({ def: { v: 1 } })
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ def: { v: 1 }, settings: {} })
  })
})

describe('drillBuilt', () => {
  it('sends the cell, the snapshot count and snapshotAt = params.asOf', async () => {
    fetchSpy.mockResolvedValueOnce(reply(200, { rows: [], more: 0 }))
    await drillBuilt(PARAMS, { label: 'Flag' })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/j2/widget-definitions/drill')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.cell).toEqual({ label: 'Flag' })
    expect(body.snapshotCount).toBe(47)
    expect(body.snapshotAt).toBe('2026-10-20T14:00:00Z')
    expect(body.defId).toBe('d-1')
  })
})

describe('builtRefreshParams', () => {
  it('builtRefreshParams_keeps_current_share_and_server_echo', () => {
    const payload = { asOf: '2026-10-24T14:00:00Z', defId: 'd-1', defRev: 4, def: { v: 1 }, title: 'T', scopeLabel: 'All my accounts',
      rangeLabel: 'Last 30 days', range: { token: 'last_30d' }, accountId: null, filter: null, rows: [{ label: 'A' }] }
    const next = builtRefreshParams({ ...PARAMS, share: true, stale: 'gone' }, payload)
    expect(next.share).toBe(true)
    for (const [k, v] of Object.entries(payload)) expect(next[k]).toEqual(v)
    // nothing else is copied from the old params
    expect(next.stale).toBeUndefined()
    expect(next.count).toBeUndefined()
    expect(Object.keys(next).sort()).toEqual([...Object.keys(payload), 'share'].sort())
  })

  it('a share the payload claims never wins over the member switch', () => {
    expect(builtRefreshParams({ share: false }, { asOf: 'x', share: true }).share).toBe(false)
    expect(builtRefreshParams({}, { asOf: 'x' }).share).toBe(false)
  })
})

describe('viewerSettingsOf (ruling R-19)', () => {
  it('reads range, accountId and filter, and only what is set', () => {
    expect(viewerSettingsOf({})).toEqual({})
    expect(viewerSettingsOf({ range: { from: '2026-10-01', to: '2026-10-20' } })).toEqual({ range: { from: '2026-10-01', to: '2026-10-20' } })
    expect(viewerSettingsOf({ range: 'last_30d', accountId: '', filter: [] })).toEqual({})
    expect(viewerSettingsOf({ filter: { values: ['A'] } })).toEqual({ filter: ['A'] })
    expect(viewerSettingsOf({ range: { token: 'ytd', junk: 1 }, accountId: 'a', filter: ['x'] }))
      .toEqual({ range: { token: 'ytd' }, accountId: 'a', filter: ['x'] })
  })

  it('overridableFilter finds the one filter the note may change', () => {
    expect(overridableFilter(null)).toBe(null)
    expect(overridableFilter({ filters: [{ field: 'symbol' }] })).toBe(null)
    expect(overridableFilter({ filters: [{ field: 'symbol' }, { field: 'setup', overridable: true }] }).field).toBe('setup')
  })
})

describe('the reads', () => {
  it('loadAccounts lists [{id, name}] from GET /api/j2/accounts, once per tab', async () => {
    fetchSpy.mockResolvedValue(reply(200, { accounts: [{ id: 1, name: 'Main', size: 5 }, { id: 'b', name: '' }] }))
    expect(await loadAccounts()).toEqual([{ id: '1', name: 'Main' }, { id: 'b', name: 'Account' }])
    await loadAccounts()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/j2/accounts')
    expect(fetchSpy.mock.calls[0][1].method).toBe('GET')
  })

  it('a failed read is retried next time, not cached', async () => {
    fetchSpy.mockResolvedValueOnce(reply(500, null)).mockResolvedValueOnce(reply(200, { accounts: [] }))
    await expect(loadAccounts()).rejects.toThrow()
    expect(await loadAccounts()).toEqual([])
  })

  it('loadDefinition reads GET /{defId} and answers its plan; an unreadable answer rejects', async () => {
    fetchSpy.mockResolvedValueOnce(reply(200, { id: 'd 1', plan: { v: 1, filters: [] } }))
    expect(await loadDefinition('d 1')).toEqual({ v: 1, filters: [] })
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/j2/widget-definitions/d%201')
    expect(fetchSpy.mock.calls[0][1].method).toBe('GET')
    fetchSpy.mockResolvedValueOnce(reply(404, {}))
    await expect(loadDefinition('gone')).rejects.toThrow()
    fetchSpy.mockResolvedValueOnce(reply(200, { id: 'x' }))
    await expect(loadDefinition('x')).rejects.toThrow()
  })

  it('loadVocabulary asks for the field; loadCatalog for the static catalog', async () => {
    fetchSpy.mockResolvedValueOnce(reply(200, { field: 'setup', values: ['Flag', 'VCP'] }))
    expect(await loadVocabulary('setup')).toEqual(['Flag', 'VCP'])
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/j2/widget-definitions/vocabulary?field=setup')
    fetchSpy.mockResolvedValueOnce(reply(200, { ranges: [{ token: 'ytd', label: 'year to date' }] }))
    expect((await loadCatalog()).ranges[0].token).toBe('ytd')
    expect(fetchSpy.mock.calls[1][0]).toBe('/api/j2/widget-definitions/vocabulary')
  })
})
