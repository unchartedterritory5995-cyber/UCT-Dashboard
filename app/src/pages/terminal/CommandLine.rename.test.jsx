// TERM-023 in the terminal: a ticker that changed hands resolves to the company that holds it
// now. The command line already asks the ticker search whether it knows the security a line
// names; when the search does NOT know it as a live ticker, and only while the Entity Master's
// rename notice is armed on the auth payload, the echo asks the Entity Master's dated ticker
// history and says "FB now trades as META" instead of "check the spelling".
//
// Module caches (the search's and the rename notice's) live for the file, so every test names
// its own ticker.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import CommandLine, { renameLine, delistedTicker } from './CommandLine'
import { AuthContext } from '../../context/AuthContext'

const notice = (sym, previous, extra = {}) => ({
  sym, state: 'ok', current: null, previous_holders: previous, source: 'x', ...extra,
})
const holder = (now, held = ['2012-05-18', '2022-06-09'], extra = {}) => ({
  entity_id: `ent_${now.map((a) => a.alias).join('_') || 'gone'}`,
  held_from: held[0], held_to: held[1], now_trades_as: now,
  lifecycle_state: 'active', lifecycle_since: null, ...extra,
})

describe('renameLine (pure)', () => {
  it('one earlier holder that trades under one ticker now: says so, with the date, and suggests it', () => {
    const r = renameLine('FB', notice('FB', [holder([{ alias: 'META', valid_from: '2022-06-09' }])]))
    expect(r).toEqual({ text: 'FB now trades as META (since 2022-06-09)', now: 'META' })
  })

  it('two different companies used the symbol: names both, suggests NEITHER', () => {
    const r = renameLine('GM', notice('GM', [
      holder([{ alias: 'MTLQQ', valid_from: '2009-06-01' }], ['1990-01-01', '2009-06-01']),
      holder([{ alias: 'GMX', valid_from: '2015-01-01' }], ['2010-11-18', '2015-01-01']),
    ]))
    expect(r.now).toBeNull()
    expect(r.text).toBe('GM was used by more than one company (now MTLQQ, GMX).')
  })

  it('the earlier holder trades under no ticker at all: says so, suggests nothing', () => {
    const r = renameLine('LEHMQ', notice('LEHMQ', [holder([], ['2001-01-01', '2008-09-15'], { lifecycle_state: 'delisted' })]))
    expect(r).toEqual({ text: 'LEHMQ belonged to a company that no longer trades under any ticker after 2008-09-15.', now: null })
  })

  it('a holder that answers to two tickers today is not collapsed to either', () => {
    const r = renameLine('XX', notice('XX', [holder([{ alias: 'AA', valid_from: '2020-01-01' }, { alias: 'BB', valid_from: '2020-01-01' }])]))
    expect(r.now).toBeNull()
  })

  it('says NOTHING unless the store was read and answered ok (could-not-look is not no-rename)', () => {
    expect(renameLine('FB', null)).toBeNull()
    expect(renameLine('FB', { state: 'store_unavailable', previous_holders: [] })).toBeNull()
    expect(renameLine('FB', { state: 'not_in_store', previous_holders: [] })).toBeNull()
    expect(renameLine('FB', notice('FB', []))).toBeNull()
    // someone holds it today: not the terminal's question (the search knows it)
    expect(renameLine('FB', notice('FB', [holder([{ alias: 'META', valid_from: '2022-06-09' }])],
      { current: { entity_id: 'e1', ambiguous: false, formerly: [] } }))).toBeNull()
  })

  it('delistedTicker reads the exact row only (share-class spellings are one ticker)', () => {
    expect(delistedTicker('BRK-B', [{ ticker: 'BRK.B', delisted: true }])).toBe(true)
    expect(delistedTicker('FB', [{ ticker: 'FBX', delisted: true }])).toBe(false)
    expect(delistedTicker('FB', [{ ticker: 'FB' }])).toBe(false)
  })
})

// ── wired ──────────────────────────────────────────────────────────────────

function wire({ search = () => [], rename = {} } = {}) {
  const calls = []
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    calls.push(u)
    if (u.startsWith('/api/ticker-search')) {
      const q = new URL(u, 'http://x').searchParams.get('q').toUpperCase()
      return { ok: true, status: 200, json: async () => ({ results: search(q) }) }
    }
    const m = u.match(/^\/api\/research\/rename-notice\/([^/?]+)/)
    if (m) {
      const r = rename[decodeURIComponent(m[1])]
      if (typeof r === 'number') return { ok: false, status: r, json: async () => ({}) }
      if (r) return { ok: true, status: 200, json: async () => r }
      return { ok: true, status: 200, json: async () => ({ state: 'not_in_store', previous_holders: [] }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  return calls
}

const renderLine = (armed) => render(
  <AuthContext.Provider value={armed ? { researchNotices: { entity_rename_notice_enabled: true } } : {}}>
    <CommandLine onSubmit={() => {}} />
  </AuthContext.Provider>,
)
const typeText = (v) => fireEvent.change(screen.getByTestId('terminal-command'), { target: { value: v } })
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))
const renameCalls = (calls) => calls.filter((u) => u.startsWith('/api/research/rename-notice/'))

afterEach(() => cleanup())

describe('the echo, armed', () => {
  it('an old ticker resolves to the company that holds it now, before Enter', async () => {
    const calls = wire({ rename: { FBRN: notice('FBRN', [holder([{ alias: 'META', valid_from: '2022-06-09' }])]) } })
    renderLine(true)
    typeText('FBRN DES')
    await wait(400)
    const echo = screen.getByTestId('terminal-echo')
    expect(echo).toHaveTextContent('FBRN now trades as META (since 2022-06-09) — did you mean META?')
    expect(echo).not.toHaveTextContent('check the spelling')
    expect(echo.dataset.tone).toBe('warn')
    expect(renameCalls(calls)).toEqual(['/api/research/rename-notice/FBRN'])
  })

  it('a delisted row the search still names gets the rename too', async () => {
    wire({
      search: (q) => (q === 'SQRN' ? [{ ticker: 'SQRN', delisted: true }] : []),
      rename: { SQRN: notice('SQRN', [holder([{ alias: 'XYZ', valid_from: '2025-01-21' }])]) },
    })
    renderLine(true)
    typeText('SQRN DES')
    await wait(400)
    expect(screen.getByTestId('terminal-echo')).toHaveTextContent('SQRN now trades as XYZ (since 2025-01-21) — did you mean XYZ?')
  })

  it('a known live ticker never asks the Entity Master (it costs nothing)', async () => {
    const calls = wire({ search: (q) => (q === 'MSRN' ? [{ ticker: 'MSRN', name: 'M' }] : []) })
    renderLine(true)
    typeText('MSRN DES')
    await wait(400)
    expect(renameCalls(calls)).toEqual([])
    expect(screen.getByTestId('terminal-echo')).not.toHaveTextContent('not a ticker we know')
  })

  it('a paywalled or failed rename read falls back to the spelling check, never a guess', async () => {
    wire({ rename: { PWRN: 402 } })
    renderLine(true)
    typeText('PWRN DES')
    await wait(400)
    const echo = screen.getByTestId('terminal-echo')
    expect(echo).toHaveTextContent('PWRN is not a ticker we know')
    expect(echo).not.toHaveTextContent('now trades as')
  })

  it('a store that knows nothing about the ticker leaves the spelling check as it was', async () => {
    wire({ search: (q) => (q.startsWith('NVDZ') ? [{ ticker: 'NVDA', name: 'NVIDIA' }] : []) })
    renderLine(true)
    typeText('NVDZ DES')
    await wait(400)
    expect(screen.getByTestId('terminal-echo')).toHaveTextContent('NVDZ is not a ticker we know — did you mean NVDA?')
  })
})

describe('the echo, not armed', () => {
  it('asks nothing of the Entity Master and says what it said before', async () => {
    const calls = wire({ rename: { DKRN: notice('DKRN', [holder([{ alias: 'META', valid_from: '2022-06-09' }])]) } })
    renderLine(false)
    typeText('DKRN DES')
    await wait(400)
    expect(renameCalls(calls)).toEqual([])
    const echo = screen.getByTestId('terminal-echo')
    expect(echo).toHaveTextContent('DKRN is not a ticker we know')
    expect(echo).not.toHaveTextContent('now trades as')
  })
})
