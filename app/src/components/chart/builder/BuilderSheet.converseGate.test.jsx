// ⛔⛔ RELEASE GATE 2026-10-06 — conversational authoring in the member's New
// Formula sheet is DARK. It shipped ungated once and reached every paid member
// (rolled back). Two keys, like Create Indicator: the per-browser opt-in AND the
// server's admin role. ASKED / CLAIMED / DID per case.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { setCreateIndicatorFlag } from './studio/createIndicatorFlag'
import BuilderSheet from './BuilderSheet'
import { AuthContext } from '../../../context/AuthContext'

function mount(role, initialMode = undefined) {
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ definitions: [] }) }))
  render(
    <AuthContext.Provider value={{ user: { id: 7, role }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={{ indicatorInstances: [], indicators: {} }} onChange={() => {}}
          initialMode={initialMode} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

afterEach(() => { cleanup(); setCreateIndicatorFlag(null); delete globalThis.fetch })

describe('the New Formula sheet — conversation is admin + opt-in only', () => {
  it('a MEMBER with the browser flag flipped sees NO conversation box', () => {
    setCreateIndicatorFlag(true)
    mount('user')
    expect(screen.queryByTestId('converse')).toBeNull()
  })
  it('an ADMIN without the opt-in sees NO conversation box (the default)', () => {
    mount('admin')
    expect(screen.queryByTestId('converse')).toBeNull()
  })
  it('an ADMIN who opted this browser in sees it', () => {
    setCreateIndicatorFlag(true)
    mount('admin')
    expect(screen.getByTestId('converse')).toBeTruthy()
  })
})

// ⭐ SLICE 2 ROLLOUT RULE — conversation OFF → the one-shot indicator drafting box;
// conversation ON → the conversation instead; the Conditions scan box always stays.
// No normal member loses the AI drafting path they have today.
describe('the one-shot fallback rule', () => {
  it('a MEMBER (conversation dark) keeps the one-shot INDICATOR box', () => {
    setCreateIndicatorFlag(true)
    mount('user', 'formula')
    expect(screen.queryByTestId('converse')).toBeNull()
    expect(screen.getByTestId('concierge-box').dataset.kind).toBe('indicator')
  })
  it('an ADMIN without the opt-in keeps the one-shot INDICATOR box', () => {
    mount('admin', 'formula')
    expect(screen.getByTestId('concierge-box').dataset.kind).toBe('indicator')
  })
  it('conversation ON: the one-shot indicator box is hidden; the conversation replaces it', () => {
    setCreateIndicatorFlag(true)
    mount('admin', 'formula')
    expect(screen.getByTestId('converse')).toBeTruthy()
    expect(screen.queryByTestId('concierge-box')).toBeNull()
  })
  it('conversation ON, Conditions tab: the SCAN box remains', () => {
    setCreateIndicatorFlag(true)
    mount('admin', 'picker')
    expect(screen.queryByTestId('converse')).toBeNull()
    expect(screen.getByTestId('concierge-box').dataset.kind).toBe('scan')
  })
})
