// TERM-087 — the object a generated answer returns OPENS IN THE PRODUCT'S
// EDITOR and round-trips through the product's own SAVE.
//
// ⛔ NOTHING ON THE PATH UNDER TEST IS MOCKED. The card lazy-loads the real
// `BuilderSheet`; the formula lands in the real `FormulaField`; Save goes through
// the real `saveUserDefinition` onto `global.fetch`, and the request is read off
// the wire (`lesson_injected_dependency_hides_the_fetch`). Acceptance (a) is
// asserted by OPENING the object, not by schema-validating it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

import ScanObjectCard from './ScanObjectCard'
import { AuthContext } from '../../../context/AuthContext'
import { evaluateFormula } from '../../../components/chart/builder/FormulaField'
import { BUILDER_INPUT_SCOPE } from '../../../components/chart/builder/builderInputs'
import { parseFormula, astHash } from '../../../components/chart/engine/ast/parse'

const CONDITION = '(close > sma(close, 50))'
const H = vi.hoisted(() => ({ requests: [] }))

function stubFetch() {
  H.requests = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1 }) }
  })
}

function objectFor(source, extra = {}) {
  const parsed = parseFormula(source)
  expect(parsed.ok).toBe(true)
  return { ok: true, kind: 'scan', source, ast: parsed.ast, repaint: 'non-repainting',
    freshness: 'live', cadence: null, not_understood: [], unavailable: [],
    import_id: 'imp-ai-1', ...extra }
}

function mount(object) {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <ScanObjectCard object={object} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

beforeEach(() => { stubFetch() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete global.fetch })

describe('the card', () => {
  it('renders NOTHING when the answer carries no object (flag off)', () => {
    const { container } = mount(undefined)
    expect(container.innerHTML).toBe('')
  })

  it('shows the tree\'s read-back and the formula, beside an Open in builder door', () => {
    mount(objectFor(CONDITION))
    const expected = evaluateFormula(CONDITION, BUILDER_INPUT_SCOPE)
    expect(screen.getByTestId('scan-object')).toHaveTextContent(expected.readback)
    expect(screen.getByTestId('scan-object-source')).toHaveTextContent(CONDITION)
    expect(screen.getByRole('button', { name: /open in builder/i })).toBeInTheDocument()
  })

  it('an honest refusal renders its reason and NO door', () => {
    mount({ ok: false, kind: 'scan', gate: 'scan:not-a-condition',
      reason: 'compare it to something, or save it as an indicator' })
    expect(screen.getByTestId('scan-object-refusal'))
      .toHaveTextContent('compare it to something, or save it as an indicator')
    expect(screen.queryByRole('button', { name: /open in builder/i })).toBeNull()
    expect(screen.queryByTestId('scan-object-source')).toBeNull()
  })

  it('⛔ a half-object (valid text, different tree) is refused by the card, not opened', () => {
    const obj = objectFor(CONDITION)
    obj.ast = parseFormula('(close < sma(close, 50))').ast
    mount(obj)
    expect(screen.getByTestId('scan-object-refusal')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /open in builder/i })).toBeNull()
  })
})

describe('🔴 the object OPENS in the shipped builder and SAVES through its own door', () => {
  it('lands in the Formula field on the Conditions tab, and Save writes that exact tree', async () => {
    const obj = objectFor(CONDITION)
    mount(obj)
    fireEvent.click(screen.getByRole('button', { name: /open in builder/i }))

    const field = await screen.findByLabelText('Formula', {}, { timeout: 10000 })
    expect(field).toHaveValue(CONDITION)
    expect(screen.getByRole('tab', { name: /conditions/i })).toHaveAttribute('aria-selected', 'true')

    // The builder's OWN read-back of the draft — derived from the tree it parsed.
    const expected = evaluateFormula(CONDITION, BUILDER_INPUT_SCOPE)
    await waitFor(() => expect(screen.getByTestId('readback')).toHaveTextContent(expected.readback))

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Above the 50' } })
    await waitFor(() => expect(screen.getByRole('button', { name: /^Sav/ })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /^Sav/ }))

    const write = await waitFor(() => {
      const w = H.requests.filter((r) => r.method !== 'GET' && r.url.includes('/api/user-definitions')).at(-1)
      expect(w, 'nothing was written').toBeTruthy()
      return w
    })
    const body = JSON.parse(write.body)
    expect(write.method).toBe('POST')
    // ⭐ THE SAME OBJECT, BY THE STORE'S OWN IDENTITY — not merely the same text.
    expect(body.definition.compute.fn).toBe(astHash(obj.ast))
    expect(body.definition.compute.source).toBe(CONDITION)
    // …and the save carries the door's import id, so "edited then saved" is countable.
    expect(body.import_id).toBe('imp-ai-1')
    expect(body.source_dialect).toBe('ai-search')
  }, 20000)
})
