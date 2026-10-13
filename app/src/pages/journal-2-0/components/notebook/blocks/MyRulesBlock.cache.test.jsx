// Fix round 1 (m6): the saved rule reaches the screen at once. The block writes the server's answer into
// the rule list's SWR cache, so the switch moves BEFORE the re-read answers. This file runs the REAL
// seam and the REAL useJournalRules over SWR; only fetch and the selected account are stood in for, and
// the re-read is held so it can never be what moved the switch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../../hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'a1' }) }))
import MyRulesBlock from './MyRulesBlock'

const RULE = { id: 'r1', label: 'Wait 15 minutes', evidence: null, version: 2, changedAt: '2026-10-02T15:00:00+00:00', beforeEntry: false, status: 'active' }
const LIST = '/api/j2/accounts/a1/rules?status=active'
const realFetch = globalThis.fetch
let listReads

beforeEach(() => {
  listReads = 0
  globalThis.fetch = vi.fn((url, init) => {
    if (url === LIST) {
      listReads += 1
      // the first read answers; every re-read is held, so it can never move the switch
      if (listReads === 1) return Promise.resolve({ ok: true, status: 200, json: async () => [RULE] })
      return new Promise(() => {})
    }
    if (init?.method === 'PUT') {
      const patch = JSON.parse(init.body)
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ...RULE, ...patch }) })
    }
    return Promise.reject(new Error(`unexpected ${url}`))
  })
})
afterEach(() => { globalThis.fetch = realFetch })

const fresh = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <MyRulesBlock params={{}} setParams={vi.fn()} editable />
  </SWRConfig>,
)

describe('MyRulesBlock: the saved rule shows before the re-read (m6)', () => {
  it('the switch shows the saved state while the re-read is still out', async () => {
    fresh()
    const sw = await screen.findByRole('switch', { name: "Check 'Wait 15 minutes' before entry" })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    await waitFor(() => expect(screen.getByRole('switch', { name: "Check 'Wait 15 minutes' before entry" })
      .getAttribute('aria-checked')).toBe('true'))
    // the re-read was asked for, and is still held: the cache write is what moved it
    expect(listReads).toBeGreaterThanOrEqual(2)
  })
  it('an edit\'s new words show at once too, with the new version line', async () => {
    fresh()
    fireEvent.click(await screen.findByRole('button', { name: "Edit 'Wait 15 minutes'" }))
    fireEvent.change(screen.getByLabelText('Rule'), { target: { value: 'Wait 20 minutes' } })
    const realImpl = globalThis.fetch.getMockImplementation()
    globalThis.fetch.mockImplementation((url, init) => (init?.method === 'PUT'
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ...RULE, label: 'Wait 20 minutes', version: 3 }) })
      : realImpl(url, init)))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Wait 20 minutes')).toBeTruthy()
    expect(screen.getByText('v3 · changed Oct 2')).toBeTruthy()
  })
})
