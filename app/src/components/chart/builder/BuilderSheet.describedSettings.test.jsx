// AN INDICATOR DESCRIBED IN THE NEW FORMULA WINDOW SHOWS ITS NUMBERS (the owner's "Inputs 0").
//
// Describe "RSI overbought" and the window built `rsi(close, 14) > 70`, with the Inputs tab reading
// 0. The conversation's own indicator now gives the tab its count, and its numbers are fields both
// under what was built and on the Inputs tab; a change needs no second request to the assistant.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { setCreateIndicatorFlag } from './studio/createIndicatorFlag'
import BuilderSheet from './BuilderSheet'
import { openInputs } from '../../../testing/builder/builderStart.testkit.js'
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
        ok: true, disposition: 'change', reply: '', turn: 'patch', not_understood: [], unavailable: [],
        envelope: { contract: 'uct.authoring.patch/1', baseRevision: body.view.revision,
          ops: [{ op: 'create', name: 'RSI overbought', outputs: [{ tree: parseFormula('rsi(close, 14) > 70').ast }] }],
          assumptions: [] },
      }) }
    }
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_cccccccccccc', version: 1, rev: 1, semantics: 2 }) }
  })
}
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() }) }
const converseCalls = () => H.requests.filter((r) => r.url.endsWith(CONVERSE_ENDPOINT)).length
const inputsCount = () => {
  const tab = [...document.querySelectorAll('button, [role="tab"]')].find((b) => /^Inputs\s*\d+$/.test(b.textContent.trim()))
  return tab ? Number(tab.textContent.replace(/\D+/g, '')) : null
}
const box = (row) => within(row).getByRole('textbox')

beforeEach(() => { stubFetch(); clearUserDefinitions(); setCreateIndicatorFlag(true) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete globalThis.fetch; clearUserDefinitions(); setCreateIndicatorFlag(null) })

async function describeIt() {
  render(
    <AuthContext.Provider value={{ user: { id: 7, role: 'admin' }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={{ indicatorInstances: [], indicators: {} }} onChange={vi.fn()} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
  fireEvent.change(screen.getByLabelText('Describe it'), { target: { value: 'RSI overbought' } })
  fireEvent.click(screen.getByTestId('converse-send'))
  await flush()
}

describe('a described indicator shows its numbers', () => {
  it('under what was built: the length and the level, as fields', async () => {
    await describeIt()
    const rows = within(screen.getByTestId('converse')).getAllByTestId('studio-setting')
    expect(rows.map((r) => [r.getAttribute('data-role'), box(r).value])).toEqual([['length', '14'], ['level', '70']])
  })

  it('the Inputs tab counts them (it read 0), and shows the same fields', async () => {
    await describeIt()
    expect(inputsCount()).toBe(2)
    openInputs()
    const rows = within(screen.getByTestId('converse-settings')).getAllByTestId('studio-setting')
    expect(rows.map((r) => box(r).value)).toEqual(['14', '70'])
    // the form's own "add an input" note is not offered beside them: it would act on a formula
    // this indicator does not have
    expect(screen.getByTestId('declared-inputs').hidden).toBe(true)
  })

  it('changing a number asks the assistant nothing, and what will run follows it', async () => {
    await describeIt()
    const calls = converseCalls()
    const level = within(screen.getByTestId('converse')).getAllByTestId('studio-setting')[1]
    fireEvent.change(box(level), { target: { value: '80' } })
    await act(async () => { fireEvent.keyDown(box(level), { key: 'Enter' }) })
    await flush()
    expect(converseCalls(), 'a settings change asked the assistant').toBe(calls)
    expect(screen.getByTestId('converse-readback').textContent).toContain('RSI 14 above 80')
    expect(inputsCount()).toBe(2)
    // and Undo takes it back
    await act(async () => { fireEvent.click(screen.getByTestId('converse-undo')) })
    expect(screen.getByTestId('converse-readback').textContent).toContain('RSI 14 above 70')
  })

  it('from the Inputs tab the same change reaches the conversation’s indicator, and saving stores it', async () => {
    await describeIt()
    openInputs()
    const length = within(screen.getByTestId('converse-settings')).getAllByTestId('studio-setting')[0]
    fireEvent.change(box(length), { target: { value: '21' } })
    await act(async () => { fireEvent.keyDown(box(length), { key: 'Enter' }) })
    await flush()
    expect(box(within(screen.getByTestId('converse-settings')).getAllByTestId('studio-setting')[0]).value).toBe('21')
    fireEvent.click(screen.getByTestId('sheet-save'))
    await flush()
    const writes = H.requests.filter((r) => r.method !== 'GET' && !r.url.endsWith(CONVERSE_ENDPOINT) && !r.url.includes('/api/indicator-telemetry/'))
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0].body).definition.compute.source).toBe('rsi(close, 21) > 70')
  })

  it('CONTROL: before anything is described there are no fields and the count is 0', () => {
    render(
      <AuthContext.Provider value={{ user: { id: 7, role: 'admin' }, isPaid: true, loading: false }}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
          <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={{ indicatorInstances: [], indicators: {} }} onChange={vi.fn()} />
        </SWRConfig>
      </AuthContext.Provider>,
    )
    expect(screen.queryAllByTestId('studio-setting')).toHaveLength(0)
  })
})
