// app/src/components/chart/builder/BuilderSheet.initialDescription.test.jsx
//
// ⭐ UCT SIGNATURE R2 (owner Option 1, 2026-11-16) — `initialDescription`: the Indicators
// window's "Build “…” with the UCT Agent" row opens the New formula window on its START view
// with the member's words PRE-FILLED in Describe it. NOTHING IS SENT: no request leaves until the
// member presses Send. Both Describe it boxes take it — the conversation (ConverseBox, where
// Create Indicator access is released) and the one-shot box (ConciergeBox, everyone else).
// An edit or a named door opens the editor, so the words are not applied there.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BuilderSheet from './BuilderSheet'
import { setCreateIndicatorFlag } from './studio/createIndicatorFlag'
import { AuthContext } from '../../../context/AuthContext'
import { clearUserDefinitions } from '../engine/nativeRegistry'

const H = vi.hoisted(() => ({ requests: [] }))
function stubFetch() {
  H.requests = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    H.requests.push({ url: String(url), method })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({}) }
  })
}
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() }) }
const posts = () => H.requests.filter((r) => r.method !== 'GET')

function Host({ user, ...props }) {
  return (
    <AuthContext.Provider value={{ user, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet onClose={() => {}} {...props} />
      </SWRConfig>
    </AuthContext.Provider>
  )
}
const ADMIN = { id: 7, role: 'admin' }
const MEMBER = { id: 7 }
const WORDS = 'rsi below 30 above the 200 day'

beforeEach(() => { stubFetch(); clearUserDefinitions() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete globalThis.fetch; clearUserDefinitions(); setCreateIndicatorFlag(null) })

describe('BuilderSheet initialDescription — pre-filled, never sent', () => {
  it('the conversation (Create Indicator access): the start view opens with the words in Describe it, and nothing is sent', async () => {
    setCreateIndicatorFlag(true)
    render(<Host user={ADMIN} open initialDescription={WORDS} />)
    await flush()
    expect(screen.getByTestId('converse')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Write the formula myself/ })).toBeTruthy()   // the START view
    expect(screen.getByLabelText('Describe it').value).toBe(WORDS)
    expect(posts()).toEqual([])
  })

  it('the one-shot box (every other account): the same words, nothing sent', async () => {
    render(<Host user={MEMBER} open initialDescription={WORDS} />)
    await flush()
    expect(screen.getByTestId('concierge-box')).toBeTruthy()
    expect(screen.getByLabelText('Describe it').value).toBe(WORDS)
    expect(posts()).toEqual([])
  })

  it('a reopen with new words replaces them; a bare reopen leaves the box as the member left it', async () => {
    const { rerender } = render(<Host user={MEMBER} open initialDescription="first words" />)
    await flush()
    expect(screen.getByLabelText('Describe it').value).toBe('first words')
    rerender(<Host user={MEMBER} open={false} initialDescription="first words" />)
    rerender(<Host user={MEMBER} open initialDescription="second words" />)
    await flush()
    expect(screen.getByLabelText('Describe it').value).toBe('second words')
    expect(posts()).toEqual([])
  })

  it('without words the box opens empty (the plain "Create indicator")', async () => {
    render(<Host user={MEMBER} open />)
    await flush()
    expect(screen.getByLabelText('Describe it').value).toBe('')
  })

  it('a named door opens the editor and does not apply the words', async () => {
    setCreateIndicatorFlag(true)
    render(<Host user={ADMIN} open initialMode="formula" initialDescription={WORDS} />)
    await flush()
    expect(screen.queryByRole('button', { name: /Write the formula myself/ })).toBeNull()
    const box = document.getElementById('converse-input')
    if (box) expect(box.value).toBe('')
    expect(posts()).toEqual([])
  })
})
