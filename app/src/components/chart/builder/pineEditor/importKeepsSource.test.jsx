// O6 (integrator ruling 2026-10-04) — the Import tab's "Add this script to my
// chart" keeps the member's Pine source EXACTLY like the Pine Editor's save:
// the same field (`meta.pineSource`), the same store door (one POST through
// `storePine`), the same gate (build flag AND the per-member stage). With
// authoring dark the posted document carries no source — byte-for-byte the
// shipped attach.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from '../BuilderSheet'
import { PINE_DEBOUNCE_MS } from '../PineBox'
import * as engineRegistry from '../../engine/nativeRegistry'
import { AuthContext } from '../../../../context/AuthContext'
import {
  __resetPineAuthoringPermission, latchPineAuthoringPermission, __permitPineAuthoringForTests,
} from '../../engine/pineAuthoringGate'
import { PINE_SOURCE_FIELD } from './pineScripts'

const NEW = 'u_dddddddddddd'
const SCRIPT = '//@version=5\nindicator("Imported")\nlength = input.int(14, "Length", minval = 1)\nplot(ta.sma(close, length), "SMA")'

const H = vi.hoisted(() => ({ requests: [] }))
function stubFetch() {
  H.requests = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    const ok = (b) => ({ ok: true, status: 200, json: async () => b })
    if (method === 'GET') return ok({ definitions: [] })
    return ok({ def_id: NEW, version: 1, rev: 1, pine_source: { pine_source: 'stored' } })
  })
}
const posts = () => H.requests.filter((r) => r.method === 'POST' && /user-definitions/.test(r.url))
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

function mount() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={{ indicatorInstances: [] }}
          onChange={() => {}} sym="SPY" tf="D" />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}
async function pasteAndAttach(script) {
  mount()
  await flush()
  fireEvent.click(screen.getByRole('tab', { name: /^import$/i }))
  fireEvent.change(screen.getByTestId('pine-box').querySelector('textarea'), { target: { value: script } })
  await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) })
  await flush()
  await act(async () => { fireEvent.click(screen.getByTestId('pine-member-pane-attach').querySelector('button')) })
  await flush(); await flush()
  expect(posts()).toHaveLength(1)
  const b = JSON.parse(posts()[0].body)
  return b.definition ?? b
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  stubFetch()
})
afterEach(() => {
  engineRegistry.uninstallUserDefinition(NEW)
  __permitPineAuthoringForTests()
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs()
})

describe('O6 — the Import tab attach keeps the source like the editor save', () => {
  it('⭐ authoring on: the posted document carries the pasted script verbatim', async () => {
    vi.stubEnv('VITE_PINE_AUTHORING_ENABLED', '1')
    const posted = await pasteAndAttach(SCRIPT)
    expect(posted.meta[PINE_SOURCE_FIELD]).toBe(SCRIPT)
    // never compute: the trees are the authority, the formula is not the script
    expect(posted.compute.source).not.toBe(SCRIPT)
  })

  it('⛔ build flag off: no source is sent (the shipped attach, unchanged)', async () => {
    const posted = await pasteAndAttach(SCRIPT)
    expect(posted.meta && posted.meta[PINE_SOURCE_FIELD]).toBeUndefined()
  })

  it('⛔ build flag on but the member stage says no: no source is sent', async () => {
    vi.stubEnv('VITE_PINE_AUTHORING_ENABLED', '1')
    __resetPineAuthoringPermission()
    latchPineAuthoringPermission({ pine_authoring_enabled: false })
    const posted = await pasteAndAttach(SCRIPT)
    expect(posted.meta && posted.meta[PINE_SOURCE_FIELD]).toBeUndefined()
  })
})
