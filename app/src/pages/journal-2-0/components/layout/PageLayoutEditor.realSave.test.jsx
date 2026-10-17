/**
 * The Customize editor against the REAL preferences hook (P4a Task 7).
 *
 * PageLayoutEditor.test.jsx fakes `setPrefMerged`. This file does not: it runs the real hook over a faked
 * `fetch`, because the editor's success test depends on what the hook ACTUALLY answers. Measured from
 * usePreferences.js: a refused write (the server's 400 "That page layout could not be saved...") resolves
 * `{ ok: false }`; a POST that throws resolves with nothing; a confirmed write resolves `{ ok: true }`. A
 * fake that returned something else would pass the editor's tests and miss the real contract.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { __resetRevisionStateForTests } from '../../../../hooks/usePreferences'
import PageLayoutEditor from './PageLayoutEditor'
import { DEFAULT_LAYOUT, LAYOUT_PREF } from '../../lib/pageLayouts'

const PREFS_URL = '/api/auth/preferences'
const STORED = JSON.stringify({
  ...JSON.parse(JSON.stringify(DEFAULT_LAYOUT)),
  futureField: { keep: 'me' },
})

let posts
let postStatus
let realFetch

function installFetch() {
  realFetch = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, opts) => {
    if (url === PREFS_URL && (!opts || !opts.method || opts.method === 'GET')) {
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ [LAYOUT_PREF]: STORED }) }
    }
    if (url === PREFS_URL && opts?.method === 'POST') {
      posts.push(JSON.parse(opts.body))
      const status = postStatus
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        json: async () => (status === 400 ? { detail: 'That page layout could not be saved. Reset it and try again.' } : { version: 1 }),
      }
    }
    throw new Error(`unexpected fetch ${url}`)
  })
}

function open(props = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PageLayoutEditor page="today" initialPhase="market" onClose={onClose} onSaved={onSaved} {...props} />
    </SWRConfig>,
  )
  return { onClose, onSaved }
}

beforeEach(() => {
  posts = []
  postStatus = 200
  __resetRevisionStateForTests()
  installFetch()
})
afterEach(() => { globalThis.fetch = realFetch })

describe('PageLayoutEditor over the real preferences hook', () => {
  it('waits for the stored layout, then shows it', async () => {
    open()
    expect(await screen.findByRole('checkbox', { name: 'Show Coach notes' })).toBeTruthy()
  })

  it('a confirmed save POSTs the blob with only the edited list changed, then closes and announces', async () => {
    const { onClose, onSaved } = open()
    await screen.findByRole('checkbox', { name: 'Show Notices' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Notices' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSaved).toHaveBeenCalledTimes(1)

    expect(posts).toHaveLength(1)
    expect(posts[0].key).toBe('journal_page_layout')
    const value = JSON.parse(posts[0].value)
    expect(value.today.market.find((e) => e.id === 'notices').shown).toBe(true)
    expect(JSON.stringify(value.today.premarket)).toBe(JSON.stringify(DEFAULT_LAYOUT.today.premarket))
    expect(JSON.stringify(value.trade)).toBe(JSON.stringify(DEFAULT_LAYOUT.trade))
    expect(value.futureField).toEqual({ keep: 'me' })
  })

  it("the server's 400 is a failure: the sentence shows, the sheet stays open, nothing is announced as saved", async () => {
    postStatus = 400
    const { onClose, onSaved } = open()
    await screen.findByRole('checkbox', { name: 'Show Notices' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Notices' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe("Couldn't save your layout. Nothing was changed.")
    expect(posts).toHaveLength(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('a POST that throws is a failure too', async () => {
    const ok = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, opts) => {
      if (opts?.method === 'POST') throw new Error('network down')
      return ok(url, opts)
    })
    const { onClose, onSaved } = open()
    await screen.findByRole('checkbox', { name: 'Show Notices' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Notices' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't save your layout. Nothing was changed.")
    expect(onClose).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })
})
