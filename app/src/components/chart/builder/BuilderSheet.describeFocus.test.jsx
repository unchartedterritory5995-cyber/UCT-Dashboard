// THE NEW FORMULA WINDOW OPENS WITH THE CURSOR IN "DESCRIBE IT" (Studio plan X1 / X9).
//
// Measured on production 2026-11-17: after "Create indicator" the window's focus sat on the dialog
// itself, so a member had to click the box before typing. On a desktop it opens ready to type; on
// a touch screen it does not (a keyboard that opens by itself covers the doors under the box).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { setCreateIndicatorFlag } from './studio/createIndicatorFlag'
import BuilderSheet from './BuilderSheet'
import { AuthContext } from '../../../context/AuthContext'
import { clearUserDefinitions } from '../engine/nativeRegistry'

const realMatchMedia = window.matchMedia
function pointer(coarse) {
  window.matchMedia = (q) => ({ matches: /pointer:\s*coarse/.test(q) ? coarse : false, media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
}
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ definitions: [] }) }))
  clearUserDefinitions(); setCreateIndicatorFlag(true)
})
afterEach(() => {
  vi.useRealTimers(); cleanup(); delete globalThis.fetch; window.matchMedia = realMatchMedia
  clearUserDefinitions(); setCreateIndicatorFlag(null)
})

async function open(extra = {}) {
  render(
    <AuthContext.Provider value={{ user: { id: 7, role: 'admin' }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={{ indicatorInstances: [], indicators: {} }} onChange={vi.fn()} {...extra} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
  await act(async () => { vi.advanceTimersByTime(50) })
}

describe('the start view’s cursor', () => {
  it('on a desktop the window opens ready to type in "Describe it"', async () => {
    pointer(false)
    await open()
    expect(document.activeElement).toBe(screen.getByLabelText('Describe it'))
  })

  it('⛔ on a touch screen it does not: no keyboard opens by itself', async () => {
    pointer(true)
    await open()
    expect(document.activeElement).not.toBe(screen.getByLabelText('Describe it'))
  })

  it('CONTROL: with no matchMedia at all (an old engine) it still opens ready to type', async () => {
    window.matchMedia = undefined
    await open()
    expect(document.activeElement).toBe(screen.getByLabelText('Describe it'))
  })
})
