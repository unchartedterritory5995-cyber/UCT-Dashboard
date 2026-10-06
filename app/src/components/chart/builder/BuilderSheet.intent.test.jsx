// app/src/components/chart/builder/BuilderSheet.intent.test.jsx
//
// ─── ⭐⭐ P1 — AUTHORING INTENT ON THE REAL SHEET ─────────────────────────────
//
// PLOT / SIGNAL / VALUE guide the read-back, the default presentation and the
// consumer asked for — and NEVER the type. These drive the real sheet with the
// real `useUserDefinitions` hook (only `fetch` is a spy), so "the document Save
// sends" is the request that actually leaves.
//
// Each case: ASKED / CLAIMED / DID.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BuilderSheet from './BuilderSheet'
import { FORMULA_DEBOUNCE_MS } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'
import { clearUserDefinitions } from '../engine/nativeRegistry'

const H = vi.hoisted(() => ({ requests: [] }))

function stubFetch() {
  H.requests = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1, semantics: 2 }) }
  })
}

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

function mount({ onChange = () => {}, settings = { indicatorInstances: [], indicators: {} } } = {}) {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={settings} onChange={onChange} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

async function typeFormula(text) {
  fireEvent.change(screen.getByLabelText('Formula'), { target: { value: text } })
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
  await flush()
}
async function nameIt(text = 'Mine') {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: text } })
  await flush()
}
const saveBtn = () => screen.getByRole('button', { name: /^Sav/ })
const sentDefinition = () => {
  const w = H.requests.find((r) => r.method !== 'GET')
  return w ? JSON.parse(w.body).definition : null
}

beforeEach(() => { vi.useFakeTimers(); stubFetch(); clearUserDefinitions() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); delete global.fetch; clearUserDefinitions() })

describe('the typed read-back names every output’s DERIVED type in plain words', () => {
  it('ASKED a comparison · CLAIMED "a yes/no" · DID type it CONDITION, from the tree', async () => {
    mount()
    await typeFormula('close > sma(close, 20)')
    const row = screen.getByTestId('typed-output-value')
    expect(row.getAttribute('data-type')).toBe('condition')
    expect(row.textContent).toContain('a yes/no on every bar')
    expect(screen.getByTestId('intent-plot').checked).toBe(true)
  })

  it('ASKED two plots, one a current-only scalar · CLAIMED partial · DID refuse that one and say so, not "all good"', async () => {
    mount()
    await typeFormula('sma(close, 20)')
    fireEvent.click(screen.getByTestId('add-plot'))
    await flush()
    fireEvent.change(screen.getByLabelText('Plot 2 key'), { target: { value: 'cap' } })
    fireEvent.change(screen.getByLabelText('Formula for plot 2'), { target: { value: 'market_cap > 1e9' } })
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
    await flush()
    const status = screen.getByTestId('typed-status')
    expect(status.getAttribute('data-status')).toBe('partial')
    expect(status.textContent).toMatch(/1 of 2 outputs/)
    const scalarRow = screen.getAllByTestId(/^typed-output-/).find((el) => el.getAttribute('data-type') === 'scalar')
    expect(scalarRow).toBeTruthy()
    expect(scalarRow.getAttribute('data-status')).toBe('refused')
  })
})

describe('⭐ item 6 — SIGNAL intent cannot lie about a number', () => {
  it('ASKED SIGNAL on sma(close,20) · CLAIMED a refusal · DID refuse with signal:numeric-output, Save shut, nothing converted', async () => {
    mount()
    await nameIt()
    await typeFormula('sma(close, 20)')
    expect(saveBtn().disabled).toBe(false)
    fireEvent.click(screen.getByTestId('intent-signal'))
    await flush()
    expect(screen.getByTestId('typed-output-value').getAttribute('data-type')).toBe('series')
    expect(screen.getByTestId('intent-refusal').textContent).toMatch(/not a yes\/no/)
    expect(screen.getByTestId('intent-refusal').textContent).toMatch(/compare it to something/)
    // no marker / paint control is offered for a number
    expect(screen.queryByTestId('signal-look')).toBeNull()
    expect(saveBtn().disabled).toBe(true)
    expect(screen.getByTestId('save-hint').textContent).toMatch(/cannot be saved as what you chose it for/)
    // switching back to PLOT is the explicit choice, and it saves as a line
    fireEvent.click(screen.getByTestId('intent-plot'))
    await flush()
    expect(saveBtn().disabled).toBe(false)
  })

  it('ASKED SIGNAL on a condition · CLAIMED a marker where true + candle colour · DID store a markers plot and a barcolor paint on its column', async () => {
    mount()
    await nameIt('Above MA')
    await typeFormula('close > sma(close, 20)')
    fireEvent.click(screen.getByTestId('intent-signal'))
    await flush()
    expect(screen.getByTestId('signal-marker').checked).toBe(true) // the default presentation
    fireEvent.click(screen.getByTestId('signal-barcolor'))
    await flush()
    expect(saveBtn().disabled).toBe(false)
    await act(async () => { fireEvent.click(saveBtn()) })
    await flush()
    const doc = sentDefinition()
    expect(doc).toBeTruthy()
    const plot = doc.plots.find((p) => p.key === 'value')
    expect(plot.style).toBe('markers')
    expect(plot.marker).toEqual({ shape: 'arrowUp', position: 'belowBar' })
    expect(doc.paints).toEqual([expect.objectContaining({
      kind: 'barcolor', colorMode: 'column:value', colorDown: 'transparent',
    })])
    // ⛔ intent is not persisted, and no type is stored
    expect(JSON.stringify(doc)).not.toMatch(/"intent"|authoringIntent|outputTypes/)
  })

  it('ASKED PLOT on the same condition · CLAIMED today\'s document · DID send no paints and no marker', async () => {
    mount()
    await nameIt('Above MA')
    await typeFormula('close > sma(close, 20)')
    await act(async () => { fireEvent.click(saveBtn()) })
    await flush()
    const doc = sentDefinition()
    expect(doc.paints).toBeUndefined()
    expect(doc.plots[0].style).toBe('line')
    expect(doc.plots[0].marker).toBeUndefined()
  })
})

describe('⭐ item 5 — VALUE intent on a SERIES stays a SERIES', () => {
  it('ASKED VALUE on sma(close,20) · CLAIMED its latest value · DID keep it SERIES, add it to the chart and reference its output in the header', async () => {
    const onChange = vi.fn()
    mount({ onChange })
    await nameIt('MA20')
    await typeFormula('sma(close, 20)')
    fireEvent.click(screen.getByTestId('intent-value'))
    await flush()
    expect(screen.getByTestId('typed-output-value').getAttribute('data-type')).toBe('series')
    expect(screen.queryByTestId('intent-refusal')).toBeNull()
    expect(screen.getByTestId('value-intent-note').textContent).toContain('a number on every bar')
    await act(async () => { fireEvent.click(saveBtn()) })
    await flush()
    expect(onChange).toHaveBeenCalledTimes(1)
    const cs = onChange.mock.calls[0][0]
    const inst = cs.indicatorInstances.find((i) => i.defId === 'u_aaaaaaaaaaaa')
    expect(inst).toBeTruthy()
    // ⭐ integrated: the header holds a REFERENCE to that instance's output — no formula
    expect(cs.header.infoValues).toEqual([{ instanceId: inst.instanceId, plotKey: 'value', format: 'auto' }])
    expect(JSON.stringify(cs.header.infoValues)).not.toMatch(/ast|source|sma/)
    expect(screen.getByTestId('value-note').textContent).toMatch(/latest value is shown in the chart header/)
    // and nothing was converted
    const doc = sentDefinition()
    expect(doc.paints).toBeUndefined()
  })

  it('ASKED VALUE on a current-only scalar · CLAIMED a refusal · DID refuse on the info-value lane', async () => {
    mount()
    await nameIt('Cap')
    await typeFormula('market_cap')
    fireEvent.click(screen.getByTestId('intent-value'))
    await flush()
    expect(screen.getByTestId('typed-output-value').getAttribute('data-type')).toBe('scalar')
    expect(screen.getByTestId('intent-refusal')).toBeTruthy()
    expect(saveBtn().disabled).toBe(true)
  })
})
