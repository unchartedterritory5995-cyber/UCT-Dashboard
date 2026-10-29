// ⛔⛔ THE NOTEBOOK CALLERS, ACROSS A CHANGE OF MEMBER (review of 6f9fbaff4d reproduced member A's
// notebook_tours POSTED into member B's account; the "local only" note that had excused them was
// wrong). Owner-approved rule-12 edits, 2026-10-29: tourSeenState, AdoptLayoutSheet, notebookSets now
// begin their operation before their own await and carry it into every write.
//
// Real usePreferences, real tourSeenState and AdoptLayoutSheet; only fetch (and the gallery's adopt
// round trip) is faked, so the member change lands exactly between a door's request and its answer.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook, render, screen, fireEvent } from '@testing-library/react'
import { SWRConfig, mutate as globalMutate } from 'swr'
import usePreferences, { __resetRevisionStateForTests } from './usePreferences'
import { publishPrefsUser, __resetPrefsSessionForTests } from '../lib/prefsSession'
import { recordTourState, TOURS_PREF } from '../pages/journal-2-0/components/notebook/onboarding/tourSeenState'
import { LAYOUT_PREF } from '../pages/journal-2-0/lib/pageLayouts'

const adopt = vi.hoisted(() => ({ resolve: null }))
vi.mock('../pages/journal-2-0/lib/styleLibrary', async (orig) => ({
  ...(await orig()),
  adoptLayout: vi.fn(() => new Promise((r) => { adopt.resolve = r })),
}))
// eslint-disable-next-line import/first
import AdoptLayoutSheet, { CHANGE_FAILED } from '../pages/journal-2-0/components/notebook/AdoptLayoutSheet'
// eslint-disable-next-line import/first
import { saveSets, __resetSetsCache } from '../pages/journal-2-0/lib/notebookSets'

let servers, who, posts, puts, putGate, putAnswer
function installFetch() {
  global.fetch = vi.fn(async (url, init) => {
    const account = who
    const u = String(url)
    const method = (init && init.method) || 'GET'
    if (u.includes('/api/j2/onboarding/tours/') && method === 'PUT') {
      puts.push({ account, url: u, body: JSON.parse(init.body) })
      if (putGate) await putGate()
      return putAnswer ? putAnswer(account) : { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ value: servers[account][TOURS_PREF] || '{}' }) }
    }
    if (u.includes('/api/auth/preferences') && method === 'POST') {
      const body = JSON.parse(init.body)
      posts.push({ account, ...body })
      servers[account][body.key] = body.value
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) }
    }
    if (u.includes('/api/auth/preferences')) {
      const snapshot = { ...servers[account] }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => snapshot }
    }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }
  })
}
const gwrapper = ({ children }) => <SWRConfig value={{ dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>
const flush = async (n = 15) => { for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve() }) }
const switchTo = async (id) => { who = id ?? who; await act(async () => { publishPrefsUser(id) }); await flush() }

beforeEach(async () => {
  __resetRevisionStateForTests(); __resetPrefsSessionForTests()
  await globalMutate(() => true, undefined, { revalidate: false })
  servers = {
    a: { [TOURS_PREF]: JSON.stringify({ 'a-tour': { v: 1, state: 'done', step: null } }) },
    b: { [TOURS_PREF]: JSON.stringify({ 'b-tour': { v: 1, state: 'started', step: 's1' } }) },
  }
  who = 'a'; posts = []; puts = []; putGate = null; putAnswer = null; adopt.resolve = null
  __resetSetsCache()
  installFetch()
})
afterEach(() => { vi.restoreAllMocks() })

const hold = () => { let release; putGate = () => new Promise((r) => { release = r; putGate = null }); return () => release() }

describe('tourSeenState.recordTourState across A -> B', () => {
  it('(a) A\'s PUT answers after the switch: no A data in B\'s cache, nothing posted into B', async () => {
    publishPrefsUser('a')
    const { result } = renderHook(() => usePreferences(), { wrapper: gwrapper })
    await flush()
    const release = hold()
    let p
    await act(async () => { p = recordTourState(result.current.setPrefMerged, 'a-new-tour', 'started', 'x1') })
    await flush()
    expect(puts.map((x) => x.account)).toEqual(['a'])
    who = 'b'
    await switchTo('b')
    await act(async () => { release(); await p })
    await flush()
    expect(JSON.parse(result.current.prefs[TOURS_PREF])).toEqual({ 'b-tour': { v: 1, state: 'started', step: 's1' } })
    expect(posts.filter((x) => x.account === 'b')).toEqual([])
  })

  it('(b) A\'s PUT FAILS (404) after the switch: the fallback does not post A\'s row into B', async () => {
    publishPrefsUser('a')
    const { result } = renderHook(() => usePreferences(), { wrapper: gwrapper })
    await flush()
    putAnswer = () => ({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) })
    const release = hold()
    let p; let r
    await act(async () => { p = recordTourState(result.current.setPrefMerged, 'a-new-tour', 'started', 'x1') })
    await flush()
    who = 'b'
    await switchTo('b')
    await act(async () => { release(); r = await p })
    await flush()
    expect(r).toBe(false)
    expect(JSON.stringify(posts)).not.toMatch(/a-new-tour/)
    expect(JSON.parse(result.current.prefs[TOURS_PREF])).toEqual({ 'b-tour': { v: 1, state: 'started', step: 's1' } })
  })

  it('CONTROL: the same member throughout — the 404 fallback merges A\'s row into A', async () => {
    publishPrefsUser('a')
    const { result } = renderHook(() => usePreferences(), { wrapper: gwrapper })
    await flush()
    putAnswer = () => ({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) })
    let r
    await act(async () => { r = await recordTourState(result.current.setPrefMerged, 'a-new-tour', 'started', 'x1') })
    await flush()
    expect(r).toBe(true)
    expect(posts.map((x) => [x.account, x.key])).toEqual([['a', TOURS_PREF]])
    expect(JSON.parse(posts[0].value)['a-new-tour']).toEqual({ v: 1, state: 'started', step: 'x1' })
  })
})

describe('AdoptLayoutSheet across A -> B', () => {
  const item = { id: 'lay-1', layoutPage: 'today', title: 'Calm open' }
  const lists = { market: [{ id: 'regime', shown: true }, { id: 'todayNote', shown: true }], premarket: [{ id: 'checklistToday', shown: true }] }
  const answer = { layout: { page: 'today', lists }, credit: '' }

  async function mount(onMessage = () => {}) {
    publishPrefsUser('a')
    render(<SWRConfig value={{ dedupingInterval: 0, shouldRetryOnError: false }}>
      <AdoptLayoutSheet item={item} version={1} layout={{ lists }} onClose={() => {}} onMessage={onMessage} />
    </SWRConfig>)
    await flush()
  }

  it('the adopt answers after the switch: nothing written into B', async () => {
    await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use this layout' })) })
    await flush()
    expect(typeof adopt.resolve).toBe('function')
    who = 'b'
    await switchTo('b')
    await act(async () => { adopt.resolve(answer) })
    await flush()
    expect(posts.filter((x) => x.key === LAYOUT_PREF)).toEqual([])
  })

  it('Undo run after the switch does not write A\'s previous layout into B', async () => {
    const msgs = []
    await mount((m) => msgs.push(m))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use this layout' })) })
    await flush()
    await act(async () => { adopt.resolve(answer) })
    await flush()
    servers.b[LAYOUT_PREF] = JSON.stringify({ v: 1 })            // B has a layout of their own, so a stray Undo WOULD write
    const ok = msgs.find((m) => m.tone === 'ok' && m.action)
    expect(ok, 'the adopt did not succeed for A (no Undo offered)').toBeTruthy()
    expect(posts.filter((x) => x.key === LAYOUT_PREF).map((x) => x.account)).toEqual(['a'])
    who = 'b'
    await switchTo('b')
    await act(async () => { await ok.action.run() })
    await flush()
    expect(posts.filter((x) => x.key === LAYOUT_PREF).map((x) => x.account)).toEqual(['a'])
  })
})

describe('AdoptLayoutSheet — Try again and the write\'s answer belong to the member who adopted', () => {
  const item = { id: 'lay-2', layoutPage: 'today', title: 'Calm open' }
  const lists = { market: [{ id: 'regime', shown: true }], premarket: [{ id: 'checklistToday', shown: true }] }
  const answer = { layout: { page: 'today', lists }, credit: '' }

  it('A\'s read failed during the adopt (Try again offered), then B signs in: B\'s Try again posts nothing', async () => {
    publishPrefsUser('a')
    let failGets = true
    const base = global.fetch
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes('/api/auth/preferences') && !(init && init.method === 'POST') && failGets) {
        return { ok: false, status: 502, headers: { get: () => null }, json: async () => ({}) }
      }
      return base(url, init)
    })
    const onClose = vi.fn()
    render(<SWRConfig value={{ dedupingInterval: 0, shouldRetryOnError: false }}>
      <AdoptLayoutSheet item={item} version={1} layout={{ lists }} onClose={onClose} onMessage={() => {}} />
    </SWRConfig>)
    await flush()
    failGets = false
    // the sheet's own Use is disabled while the read failed; drive the adopt answer through the
    // failed-read branch: Use was pressed while the read was still good, the read failed during it
    await act(async () => { await globalMutate('/api/auth/preferences') })
    await flush()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use this layout' })) })
    failGets = true
    await act(async () => { await globalMutate('/api/auth/preferences') })   // the read fails during the round trip
    await flush()
    await act(async () => { adopt.resolve(answer) })
    await flush()
    const retry = screen.queryByRole('button', { name: 'Try again' })
    expect(retry, 'Try again was not offered after the failed read').toBeTruthy()
    failGets = false
    who = 'b'
    await switchTo('b')
    await act(async () => { fireEvent.click(retry) })
    await flush()
    expect(posts.filter((x) => x.key === LAYOUT_PREF), 'A\'s adopted layout was posted into B').toEqual([])
  })

  it('the write answers after the switch: B sees neither A\'s "now uses" nor a stuck failure', async () => {
    publishPrefsUser('a')
    servers.a[LAYOUT_PREF] = JSON.stringify({ v: 1 })
    let releasePost
    const base = global.fetch
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes('/api/auth/preferences') && init && init.method === 'POST') {
        await new Promise((r) => { releasePost = r })
      }
      return base(url, init)
    })
    const msgs = []
    const onClose = vi.fn()
    render(<SWRConfig value={{ dedupingInterval: 0, shouldRetryOnError: false }}>
      <AdoptLayoutSheet item={item} version={1} layout={{ lists }} onClose={onClose} onMessage={(m) => msgs.push(m)} />
    </SWRConfig>)
    await flush()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use this layout' })) })
    await flush()
    await act(async () => { adopt.resolve(answer) })
    await flush()
    expect(typeof releasePost).toBe('function')               // A's write is in flight
    who = 'b'
    await switchTo('b')
    await act(async () => { releasePost() })
    await flush()
    expect(msgs.filter((m) => m.tone === 'ok'), 'B was told A\'s layout is now in use').toEqual([])
    expect(screen.queryByText(CHANGE_FAILED)).toBeNull()
    expect(onClose).toHaveBeenCalled()
  })
})

describe('notebookSets.saveSets — a switch during the fresh read posts nothing', () => {
  it('A\'s read answers after A->B: no POST of A\'s sets under B\'s cookie', async () => {
    publishPrefsUser('a')
    let releaseGet
    const base = global.fetch
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes('/api/auth/preferences') && !(init && init.method === 'POST') && !releaseGet) {
        await new Promise((r) => { releaseGet = r })
      }
      return base(url, init)
    })
    let p
    await act(async () => { p = saveSets({ presets: [] }) })
    await flush()
    expect(typeof releaseGet).toBe('function')
    who = 'b'
    await switchTo('b')
    let r
    await act(async () => { releaseGet(); r = await p })
    expect(r.ok).toBe(false)
    expect(posts).toEqual([])
  })

  it('CONTROL: the same member: the save posts once', async () => {
    publishPrefsUser('a')
    let r
    await act(async () => { r = await saveSets({ presets: [] }) })
    expect(r.ok).toBe(true)
    expect(posts.map((x) => x.account)).toEqual(['a'])
  })
})
