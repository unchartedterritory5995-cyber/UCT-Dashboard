// app/src/components/chart/builder/BuilderSheet.runsOn.test.jsx
//
// W5-T18 - the editor's "Runs on" line, over the four states of `server_lanes`:
// all lanes true / some refused with sentences / an ast row (no key) / a malformed or
// absent stamp. The hook is NOT mocked (a stubbed `fetch`, as the repaint-notice rail).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet, { buildDefinition } from './BuilderSheet'
import RunsOnLine from './RunsOnLine'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import { evaluateFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'
import { parseFormula } from '../engine/ast/parse'
import { clearUserDefinitions } from '../engine/nativeRegistry'

function storedRow({ defId, name, source = 'sma(close, 20)', lanes = undefined }) {
  const parsed = parseFormula(source)
  const evaluated = evaluateFormula(source, BUILDER_INPUT_SCOPE)
  return {
    def_id: defId, version: 1, rev: 1,
    definition: buildDefinition({
      defId, name, source, ast: parsed.ast, mode: evaluated.verdict.mode,
      readback: evaluated.readback, version: 1, rev: 1,
    }),
    ...(lanes === undefined ? {} : { server_lanes: lanes }),
  }
}

let ROWS = []
beforeEach(() => {
  vi.useFakeTimers()
  clearUserDefinitions()
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ definitions: ROWS }) }))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

function mount() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={null} onChange={() => {}} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

async function clickEdit(name) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: `Edit ${name}` })) })
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
  await flush()
}


const G = { guard: 'runtime:server-unavailable', sentence: 'This script cannot run in alerts yet: the server runtime is off.' }
const H = { guard: 'consumer:request', sentence: 'Screens cannot read request.security here.' }

describe('W5-T18 - Runs on, from server_lanes', () => {
  it('1 - all lanes true: names chart and every server lane, no refusal', async () => {
    ROWS = [storedRow({ defId: 'u_0000000000d1', name: 'All lanes', lanes: { alerts: true, screener: true, scans: true } })]
    mount(); await flush()
    expect(screen.queryByTestId('runs-on')).toBeNull() // not before it is opened
    await clickEdit('All lanes')
    expect(screen.getByTestId('runs-on-lanes').textContent).toBe('Runs on: chart, alerts, screener, scans')
    expect(screen.queryByTestId('runs-on-unconfirmed')).toBeNull()
    expect(screen.getByTestId('runs-on').textContent).not.toMatch(/cannot/)
  })

  it('2 - refused lanes show the server sentence verbatim and are not listed as running', async () => {
    ROWS = [storedRow({ defId: 'u_0000000000d2', name: 'Some refused', lanes: { alerts: G, screener: true, scans: H } })]
    mount(); await flush()
    await clickEdit('Some refused')
    expect(screen.getByTestId('runs-on-lanes').textContent).toBe('Runs on: chart, screener')
    expect(screen.getByTestId('runs-on-refused-alerts').textContent).toBe(`alerts: ${G.sentence}`)
    expect(screen.getByTestId('runs-on-refused-scans').textContent).toBe(`scans: ${H.sentence}`)
  })

  it('2b - every lane refused: no "Runs on" claim at all', async () => {
    ROWS = [storedRow({ defId: 'u_0000000000d5', name: 'None run', lanes: { alerts: G, screener: G, scans: G } })]
    mount(); await flush()
    await clickEdit('None run')
    expect(screen.queryByTestId('runs-on-lanes')).toBeNull()
    expect(screen.getByTestId('runs-on-refused-screener').textContent).toBe(`screener: ${G.sentence}`)
  })

  it('3 - an ast row (no server_lanes key) shows nothing new', async () => {
    ROWS = [storedRow({ defId: 'u_0000000000d3', name: 'Ast row' })]
    mount(); await flush()
    await clickEdit('Ast row')
    expect(screen.queryByTestId('runs-on')).toBeNull()
  })

  it.each([
    ['a string', 'yes'],
    ['an array', [true, true, true]],
    ['an empty object', {}],
    ['a truthy non-true lane', { alerts: 'yes', screener: 1, scans: {} }],
    ['a refusal without a sentence', { alerts: { guard: 'g' }, screener: { guard: 'g', sentence: '' }, scans: false }],
  ])('4 - a malformed stamp (%s) never claims a lane runs', async (_n, lanes) => {
    ROWS = [storedRow({ defId: 'u_0000000000d4', name: 'Bad stamp', lanes })]
    mount(); await flush()
    await clickEdit('Bad stamp')
    expect(screen.queryByTestId('runs-on-lanes')).toBeNull()
    expect(screen.getByTestId('runs-on-unconfirmed').textContent).toBe('Not confirmed for: alerts, screener, scans')
    expect(screen.getByTestId('runs-on').textContent).not.toMatch(/Runs on/)
  })

  it('4a - a null stamp (absent) renders nothing and claims nothing', async () => {
    ROWS = [storedRow({ defId: 'u_0000000000d7', name: 'Null stamp', lanes: null })]
    mount(); await flush()
    await clickEdit('Null stamp')
    expect(screen.queryByTestId('runs-on')).toBeNull()
  })

  it('4b - one good lane beside a malformed one: only the good one is claimed', async () => {
    ROWS = [storedRow({ defId: 'u_0000000000d6', name: 'Half bad', lanes: { alerts: true, screener: 'x', scans: true } })]
    mount(); await flush()
    await clickEdit('Half bad')
    expect(screen.getByTestId('runs-on-lanes').textContent).toBe('Runs on: chart, alerts, scans')
    expect(screen.getByTestId('runs-on-unconfirmed').textContent).toBe('Not confirmed for: screener')
  })
})

describe('W5-T18 - RunsOnLine alone fails closed on any input', () => {
  it.each([[undefined], [null]])('no stamp (%s) renders nothing', (v) => {
    const { container } = render(<RunsOnLine serverLanes={v} />)
    expect(container.innerHTML).toBe('')
  })
  it.each([['yes'], [5], [[true, true, true]], [{}]])('a non-stamp (%j) claims nothing', (v) => {
    const { container } = render(<RunsOnLine serverLanes={v} />)
    expect(container.textContent).not.toMatch(/Runs on/)
    expect(container.textContent).toBe('Not confirmed for: alerts, screener, scans')
  })
})
