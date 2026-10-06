// app/src/components/chart/builder/BuilderSheet.converse.test.jsx
//
// ─── ⭐ P2 — THE CONVERSATION IS MOUNTED IN THE REAL SHEET, WITH THE REAL CLIENT ─
//
// Only `fetch` is a spy. ASKED "RSI overbought" in the sheet · CLAIMED the
// request leaves for the converse route with the compact view, the readback is
// the definition's, and Save is the ordinary store POST · DID exactly that.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BuilderSheet from './BuilderSheet'
import { AuthContext } from '../../../context/AuthContext'
import { clearUserDefinitions } from '../engine/nativeRegistry'
import { parseFormula } from '../engine/ast/parse'
import { CONVERSE_ENDPOINT } from './authoring/converseClient'

const H = vi.hoisted(() => ({ requests: [] }))

function stubFetch() {
  H.requests = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (String(url).endsWith(CONVERSE_ENDPOINT)) {
      const body = JSON.parse(init.body)
      return { ok: true, status: 200, json: async () => ({
        ok: true, turn: 'patch', not_understood: [], unavailable: [],
        envelope: { contract: 'uct.authoring.patch/1', baseRevision: body.view.revision,
          ops: [{ op: 'create', name: 'RSI overbought', outputs: [{ tree: parseFormula('rsi(close, 14) > 70').ast }] }],
          assumptions: [], note: 'a MACD crossover' },
      }) }
    }
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_cccccccccccc', version: 1, rev: 1, semantics: 2 }) }
  })
}
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() }) }

beforeEach(() => { stubFetch(); clearUserDefinitions() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete globalThis.fetch; clearUserDefinitions() })

describe('BuilderSheet hosts the conversation', () => {
  it('ASKED "RSI overbought" · DID POST the converse route with the view, show the readback, and save through the store door once', async () => {
    const onChange = vi.fn()
    render(
      <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
          <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={{ indicatorInstances: [], indicators: {} }} onChange={onChange} />
        </SWRConfig>
      </AuthContext.Provider>,
    )
    expect(screen.getByTestId('converse')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Describe the indicator'), { target: { value: 'RSI overbought' } })
    fireEvent.click(screen.getByTestId('converse-send'))
    await flush()
    const conv = H.requests.filter((r) => r.url.endsWith(CONVERSE_ENDPOINT))
    expect(conv).toHaveLength(1)
    const sent = JSON.parse(conv[0].body)
    expect(sent.message).toBe('RSI overbought')
    expect(sent.view.contract).toBe('uct.authoring.view/1')
    expect(sent.view.revision).toBe(0)
    const rb = screen.getByTestId('converse-readback').textContent
    expect(rb).toContain('1 when (the 14-bar RSI of close) is greater than 70 and 0 otherwise')
    expect(screen.getByTestId('converse').textContent).not.toContain('MACD')

    fireEvent.click(screen.getByTestId('converse-save'))
    await flush()
    const writes = H.requests.filter((r) => r.method !== 'GET' && !r.url.endsWith(CONVERSE_ENDPOINT))
    expect(writes).toHaveLength(1)
    expect(writes[0].method).toBe('POST')
    expect(JSON.parse(writes[0].body).definition.compute.source).toBe('rsi(close, 14) > 70')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].indicatorInstances.some((i) => i.defId === 'u_cccccccccccc')).toBe(true)
  })
})
