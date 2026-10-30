// The starter pack offer belongs to the member it opened for (lib/prefsSession `beginPrefsOp`).
// Owner-approved rule-12 rail, 2026-10-30. Another tab signing in as B leaves the card on screen: a pack
// chosen then must install nothing (the cookie is B's), an install in flight must not write A's answer into
// B's preferences, and Not now must not write A's answer either. Controls: the same member installs and writes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { contractBody } from '../../../__fixtures__/contract'
import { publishPrefsUser, __resetPrefsSessionForTests } from '../../../../../lib/prefsSession'

// The real hook drops a merge begun for another member (setPrefMerged's `givenOp`); so does this one, so
// the rail reads what would be WRITTEN, not merely what was called.
const writes = []
let holdWrite = null          // set to a function: the next write waits until the test releases it
const setPrefMerged = vi.fn(async (key, updater, op = null) => {
  if (op && op.stale()) return false
  if (holdWrite) { await new Promise((resolve) => { holdWrite(resolve) }); holdWrite = null }
  if (op && op.stale()) return false                     // the real hook re-checks after every await
  const value = typeof updater === 'function' ? updater(undefined) : updater
  writes.push({ key, value })
  prefsNow = { ...prefsNow, [key]: value }               // the real hook's optimistic cache: the next render reads it
  return { ok: true }
})
let prefsNow = {}
vi.mock('../../../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: prefsNow, setPref: vi.fn(), setPrefMerged, loading: false, readFailed: false }),
}))

import StarterPackOffer, { useStarterPackOffer, __resetStarterPackOfferForTests } from './StarterPackOffer'

const INSTALLED = contractBody('journal-styles.starter-pack.install')
const TITLE = 'How do you trade?'
const INSTALL_URL = /^\/api\/j2\/journal-styles\/starter-packs\/swing$/

let calls
let releaseInstall
function installFetch({ hold = false } = {}) {
  calls = []
  releaseInstall = null
  globalThis.fetch = vi.fn((input, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const path = String(typeof input === 'string' ? input : input.url).split('?')[0]
    calls.push({ method, path })
    const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })
    if (method === 'POST' && INSTALL_URL.test(path)) {
      if (!hold) return Promise.resolve(answer(200, INSTALLED))
      return new Promise((resolve) => { releaseInstall = () => resolve(answer(200, INSTALLED)) })
    }
    return Promise.resolve(answer(404, { detail: 'Not found' }))
  })
}
const installPosts = () => calls.filter((c) => c.method === 'POST' && INSTALL_URL.test(c.path))
const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve() })
const show = (onClose) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    <StarterPackOffer onClose={onClose} />
  </SWRConfig>,
)

beforeEach(() => {
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_journal_styles_enabled: true, notebook_starter_packs_enabled: true })
  __resetPrefsSessionForTests()
  publishPrefsUser('A')
  prefsNow = {}
  writes.length = 0
  holdWrite = null
  setPrefMerged.mockClear()
  __resetStarterPackOfferForTests()
})
afterEach(() => { __resetNotebookFlags(); __resetPrefsSessionForTests() })

describe('the starter pack offer never acts for the next member', () => {
  it('B signs in while A\'s install is in flight: A\'s answer is not written, no result is shown, the card closes', async () => {
    installFetch({ hold: true })
    const onClose = vi.fn()
    show(onClose)
    const offer = screen.getByRole('region', { name: TITLE })
    fireEvent.click(within(offer).getByRole('button', { name: 'Swing' }))
    await flush()
    expect(installPosts()).toHaveLength(1)
    act(() => { publishPrefsUser('B') })                 // another tab signed in as B
    await act(async () => { releaseInstall() })
    await flush()
    expect(writes).toEqual([])
    expect(screen.queryByText(/^Added:/)).toBeNull()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('B signs in while A\'s card is open: choosing a pack installs nothing into B\'s account', async () => {
    installFetch()
    const onClose = vi.fn()
    show(onClose)
    act(() => { publishPrefsUser('B') })
    fireEvent.click(within(screen.getByRole('region', { name: TITLE })).getByRole('button', { name: 'Swing' }))
    await flush()
    expect(installPosts()).toEqual([])
    expect(writes).toEqual([])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('B signs in while A\'s card is open: Not now writes no answer', async () => {
    installFetch()
    const onClose = vi.fn()
    show(onClose)
    act(() => { publishPrefsUser('B') })
    fireEvent.click(within(screen.getByRole('region', { name: TITLE })).getByRole('button', { name: 'Not now' }))
    await flush()
    expect(writes).toEqual([])
    expect(setPrefMerged).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('B signs in while A\'s Not now write is waiting: nothing is written and no not-saved alert is left for B', async () => {
    installFetch()
    let releaseWrite
    holdWrite = (resolve) => { releaseWrite = resolve }
    const onClose = vi.fn()
    show(onClose)
    fireEvent.click(within(screen.getByRole('region', { name: TITLE })).getByRole('button', { name: 'Not now' }))
    await flush()
    expect(setPrefMerged).toHaveBeenCalledTimes(1)
    act(() => { publishPrefsUser('B') })
    await act(async () => { releaseWrite() })
    await flush()
    expect(writes).toEqual([])
    expect(screen.queryByRole('alert')).toBeNull()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('control: the same member installs, writes the installed answer once and sees the result', async () => {
    installFetch({ hold: true })
    const onClose = vi.fn()
    show(onClose)
    fireEvent.click(within(screen.getByRole('region', { name: TITLE })).getByRole('button', { name: 'Swing' }))
    await flush()
    await act(async () => { releaseInstall() })
    await flush()
    expect(installPosts()).toHaveLength(1)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ key: 'notebook_starter_pack', value: { state: 'installed', pack: 'swing' } })
    expect(screen.getByText(/^Added:/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('control: the same member\'s Not now writes dismissed and closes', async () => {
    installFetch()
    const onClose = vi.fn()
    show(onClose)
    fireEvent.click(within(screen.getByRole('region', { name: TITLE })).getByRole('button', { name: 'Not now' }))
    await flush()
    expect(writes).toHaveLength(1)
    expect(writes[0].value).toMatchObject({ state: 'dismissed' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// A's install landed (A's cookie) after B signed in, so A's answer could not be written then. It is kept for A
// ALONE and written the next time A is the member on this page; B never receives it.
function Host() {
  const offer = useStarterPackOffer({ styles: [] })
  return <p data-testid="offer">{offer.show ? 'shown' : 'hidden'}</p>
}
const host = () => render(<Host />)
async function installForAThenSwitchToB() {
  installFetch({ hold: true })
  const card = show(vi.fn())
  fireEvent.click(within(screen.getByRole('region', { name: TITLE })).getByRole('button', { name: 'Swing' }))
  await flush()
  act(() => { publishPrefsUser('B') })
  await act(async () => { releaseInstall() })
  await flush()
  card.unmount()
  expect(installPosts()).toHaveLength(1)
  expect(writes).toEqual([])                           // nothing written while B is the member
}

describe("an install that landed for A after B signed in keeps A's answer for A", () => {
  it("B is never written A's answer, and B's own offer is unaffected", async () => {
    await installForAThenSwitchToB()
    const b = host()
    await flush()
    expect(writes).toEqual([])
    expect(screen.getByTestId('offer').textContent).toBe('shown')   // B has answered nothing: B is still offered
    b.unmount()
  })

  it("A back on the page: A's installed answer is written once, for A, and the offer does not re-show", async () => {
    await installForAThenSwitchToB()
    act(() => { publishPrefsUser('A') })
    host()
    await flush()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ key: 'notebook_starter_pack', value: { state: 'installed', pack: 'swing' } })
    expect(setPrefMerged.mock.calls.at(-1)[2].user).toBe('A')
    expect(screen.getByTestId('offer').textContent).toBe('hidden')
  })

  it('B, then A: written only once A is the member, never during B', async () => {
    await installForAThenSwitchToB()
    const b = host()
    await flush()
    expect(writes).toEqual([])
    b.unmount()
    act(() => { publishPrefsUser('A') })
    host()
    await flush()
    expect(writes).toHaveLength(1)
    expect(setPrefMerged.mock.calls.every((c) => c[2]?.user === 'A')).toBe(true)
  })

  it('A already answered elsewhere: the kept answer is dropped, nothing is overwritten', async () => {
    await installForAThenSwitchToB()
    act(() => { publishPrefsUser('A') })
    prefsNow = { notebook_starter_pack: JSON.stringify({ v: 1, state: 'dismissed', at: '2026-10-30T00:00:00Z' }) }
    host()
    await flush()
    expect(writes).toEqual([])
    // and it is not kept for later either
    prefsNow = {}
    host()
    await flush()
    expect(writes).toEqual([])
  })

  it('control: an install that wrote its answer for A keeps nothing to replay', async () => {
    installFetch({ hold: true })
    const card = show(vi.fn())
    fireEvent.click(within(screen.getByRole('region', { name: TITLE })).getByRole('button', { name: 'Swing' }))
    await flush()
    await act(async () => { releaseInstall() })
    await flush()
    card.unmount()
    expect(writes).toHaveLength(1)
    host()
    await flush()
    expect(writes).toHaveLength(1)
  })
})
