// app/src/components/chart/builder/memberPane/memberPaneRefusalLog.test.jsx
//
// ⭐ U4 (2026-11-14) — A REFUSAL THE MEMBER PANE ANSWERS IS LOGGED AS A WORK ITEM: its guard
// code (and its runtime decline code), through the support loop's gap log, once the source
// has been still for the settle time, once per distinct set per page. ⛔ CODES ONLY: the
// request carries no sentence and no part of the script.
// Driven through the real BuilderSheet's Import tab, with the real member pane.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from '../BuilderSheet'
import { writeMyself, toStart, startFrom, openSource, openTab, formulaBox, reveal, openPlots, openInputs, pickChoice, choiceValue, chooseValue, choiceOf } from '../../../../testing/builder/builderStart.testkit.js'
import { PINE_DEBOUNCE_MS } from '../PineBox'
import { memberPaneDefinition } from './memberPaneDefinition'
import { AuthContext } from '../../../../context/AuthContext'
import { _resetForTests } from '../../supportLoop/supportApi'

const REFUSED = '//@version=5\nindicator("t")\nsecretLevel = 42\nplot(ta.notARealBuiltinXyz(close, secretLevel))\n'

const H = vi.hoisted(() => ({ requests: [] }))
function stubFetch() {
  H.requests = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  })
}
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
function mount() {
  const view = render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={null} onChange={() => {}} sym="SPY" tf="D" />
      </SWRConfig>
    </AuthContext.Provider>,
  )
  writeMyself()
  return view
}
async function paste(script) {
  openSource('pine')
  fireEvent.change(screen.getByTestId('pine-box').querySelector('textarea'), { target: { value: script } })
  await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) })
  await flush()
}
const codePosts = () => H.requests
  .filter((r) => r.method === 'POST' && r.url.endsWith('/api/indicator-support/gaps'))
  .map((r) => JSON.parse(r.body))
  .filter((b) => Array.isArray(b.guards) && b.gaps.length === 0 && b.unlisted === 0)

beforeEach(() => {
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.useFakeTimers()
  _resetForTests()
  stubFetch()
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('U4 — the member pane logs the codes of a refusal it answers', () => {
  it('⭐ the guard code leaves, after the settle time, once, and nothing else of the script', async () => {
    const built = memberPaneDefinition({ source: REFUSED, id: 'probe' })
    expect(built.ok).toBe(false)
    expect(typeof built.guard).toBe('string')
    mount()
    await paste(REFUSED)
    expect(codePosts()).toEqual([])                         // not while the source may still change
    await act(async () => { vi.advanceTimersByTime(1500) })
    await flush()
    const got = codePosts()
    expect(got).toHaveLength(1)
    expect(got[0].guards).toContain(built.guard)
    expect(JSON.stringify(got)).not.toMatch(/secretLevel|notARealBuiltinXyz|indicator/)
    await act(async () => { vi.advanceTimersByTime(60000) })
    expect(codePosts()).toHaveLength(1)                     // once per distinct set per page
  })

  it('a source replaced before the settle time logs nothing for it', async () => {
    mount()
    await paste(REFUSED)
    await paste('//@version=5\nindicator("t")\nplot(ta.sma(close, 20))\n')
    await act(async () => { vi.advanceTimersByTime(5000) })
    await flush()
    expect(codePosts()).toEqual([])
  })
})
