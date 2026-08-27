// app/src/components/chart/builder/BuilderSheet.evidence.test.jsx
//
// The builder's Evidence door exists ONLY for a saved definition: a new sheet
// has nothing to show evidence for. Harness copied from BuilderSheet.edit.test.jsx.
//
// ⭐ EVERY AFFORDANCE IS TRUE OF THE THING IT SITS ON. A tab that says "Evidence"
// on a definition that can never have any is the same defect as a spinner saying
// "Replaying…" when nothing was requested, one level up. So the tab is gated on
// `editing` (the store's own row id), and the receipt it opens is bound to the
// hash of the SAVED row — never the draft in the box, which may already differ.
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { AuthContext } from '../../../context/AuthContext'
import { parseFormula } from '../engine/ast/parse'
import BuilderSheet, { buildDefinition } from './BuilderSheet'
import { evaluateFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import { BACKTEST_ENDPOINT, RECORD_ENDPOINT } from './EvidenceTab'

const DEF_ID = 'u_0123456789ab'

function storedRow({ source = 'close > sma(close, 50)', name = 'Above the 50', version = 1, rev = 1 } = {}) {
  const parsed = parseFormula(source)
  if (!parsed.ok) throw new Error(`fixture formula does not parse: ${parsed.error}`)
  const evaluated = evaluateFormula(source, BUILDER_INPUT_SCOPE)
  const definition = buildDefinition({
    defId: DEF_ID, name, source, ast: parsed.ast, mode: evaluated.verdict.mode,
    readback: evaluated.readback, version, rev,
  })
  return { def_id: DEF_ID, version, rev, ast_hash: definition.compute.fn, definition,
    repaint: definition.meta.repaint, created_at: 0 }
}

// ⚠️ MEASURED AGAINST THE ROUTE, NOT SKETCHED. `api/routers/definition_record.py`
// returns `{def_id, def_hash, rev, tf, tf_label, window, claim, hit_rate_means}` —
// `hit_rate_means` at the TOP LEVEL, beside `claim` and never inside it, pinned by
// `tests/test_definition_record_route.py`. A fixture that omitted it would let this
// suite go green over a tab that drops the one sentence keeping the number honest.
// A fixture written from a sketch certifies the sketch.
const HIT_RATE_MEANS = (
  'the share of evaluated bars on which this definition was TRUE — an '
  + 'occurrence rate, not a win rate: the forward record stores whether the '
  + 'screen fired, never what happened next, so there is no return here and no '
  + 'baseline to put beside it')

const H = vi.hoisted(() => ({ requests: [], rows: [] }))
function stubFetch() {
  H.requests = []; H.rows = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url); const method = init.method || 'GET'
    H.requests.push({ url: u, method, body: init.body ?? null })
    if (method === 'POST' && u.startsWith(BACKTEST_ENDPOINT)) return { ok: true, status: 200, json: async () => ({ job: 'j1', status: 'running' }) }
    if (u.startsWith(`${BACKTEST_ENDPOINT}/`)) return { ok: true, status: 200, json: async () => ({ job: 'j1', status: 'running' }) }
    if (u.startsWith(RECORD_ENDPOINT)) {
      return { ok: true, status: 200, json: async () => ({
        def_id: DEF_ID, def_hash: 'sha256:whatever', rev: 1, tf: 'D', tf_label: '1D', window: null,
        claim: { coverage: 'unproven', refusal: 'no record yet',
          symbols: { requested: 0, proven: 0, unproven: [] }, evaluated: 0,
          hits: null, hit_rate: null, horizon: { retention_days: 540 } },
        hit_rate_means: HIT_RATE_MEANS,
      }) }
    }
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: H.rows }) }
    return { ok: true, status: 200, json: async () => ({ def_id: DEF_ID, version: 2, rev: 2, rev_bumped: true, migrated: 0 }) }
  })
}
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }) }

function mount() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={null} onChange={() => {}} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}
const tab = (name) => screen.queryByRole('tab', { name })
async function clickEdit(name = 'Above the 50') {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: `Edit ${name}` })) })
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
  await flush()
}

beforeEach(() => { vi.useFakeTimers(); stubFetch() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('BuilderSheet — the Evidence tab', () => {
  it('a NEW sheet has no Evidence tab (nothing saved to show evidence for)', async () => {
    mount(); await flush()
    expect(tab(/formula/i)).toBeTruthy()
    expect(tab(/evidence/i)).toBeNull()
  })

  it('editing a saved definition shows the tab; opening it mounts EvidenceTab for THAT hash and asks for its study', async () => {
    const row = storedRow(); H.rows = [row]
    mount(); await flush()
    await clickEdit()
    expect(tab(/evidence/i)).toBeTruthy()
    await act(async () => { fireEvent.click(tab(/evidence/i)) })
    await flush()
    const ev = screen.getByTestId('evidence-tab')
    expect(ev.getAttribute('data-definition')).toBe(row.definition.compute.fn)
    const post = H.requests.find((r) => r.method === 'POST' && r.url.startsWith(BACKTEST_ENDPOINT))
    expect(post).toBeTruthy()
    expect(JSON.parse(post.body).def_id).toBe(DEF_ID)
    expect(tab(/evidence/i)).toHaveAttribute('aria-selected', 'true')
  })

  it('CONTROL: nothing is asked for until the tab is opened', async () => {
    H.rows = [storedRow()]
    mount(); await flush()
    await clickEdit()
    expect(tab(/evidence/i)).toBeTruthy()
    expect(H.requests.find((r) => r.method === 'POST' && r.url.startsWith(BACKTEST_ENDPOINT))).toBeFalsy()
    expect(screen.queryByTestId('evidence-tab')).toBeNull()
  })

  it('"New formula" leaves edit mode: the tab goes away and the sheet is back on Formula', async () => {
    H.rows = [storedRow()]
    mount(); await flush()
    await clickEdit()
    await act(async () => { fireEvent.click(tab(/evidence/i)) })
    await flush()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'New formula' })) })
    await flush()
    expect(tab(/evidence/i)).toBeNull()
    expect(screen.queryByTestId('evidence-tab')).toBeNull()
    expect(tab(/formula/i)).toHaveAttribute('aria-selected', 'true')
  })
})

// ⭐ THE RECEIPT IS THE SAVED DEFINITION'S, AND THE PANEL SAYS SO WHEN THAT
// MATTERS. `def_hash` is read off the STORE row, never off the draft in the box
// — correct, because a receipt must be keyed to the tree that actually RAN. But
// a member who has just retyped the formula and clicks Evidence is looking at a
// receipt for something OTHER than what is in front of them, and nothing on
// screen said so. Trivially reachable: open an edit, type, click Evidence.
describe('BuilderSheet — Evidence for a definition whose box has moved on', () => {
  it('says the receipt is the SAVED version when the draft differs', async () => {
    H.rows = [storedRow()]
    mount(); await flush()
    await clickEdit()
    // the repo's own handle for the value carrier: an EXACT label. A regex
    // matches the editor lane's second labelled node too and throws on
    // 'multiple elements' — measured.
    const box = screen.getByLabelText('Formula')
    await act(async () => { fireEvent.change(box, { target: { value: 'close > sma(close, 200)' } }) })
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
    await flush()
    await act(async () => { fireEvent.click(tab(/evidence/i)) })
    await flush()
    const said = screen.getByTestId('evidence-draft-differs')
    expect(said.textContent).toMatch(/saved version/i)
    expect(said.textContent).toMatch(/not the formula in the box/i)
    // …and the receipt is still bound to the SAVED hash, not the draft
    expect(screen.getByTestId('evidence-tab').getAttribute('data-definition'))
      .toBe(H.rows[0].definition.compute.fn)
  })

  it('CONTROL: an untouched draft says nothing — the note is about a DIFFERENCE', async () => {
    H.rows = [storedRow()]
    mount(); await flush()
    await clickEdit()
    await act(async () => { fireEvent.click(tab(/evidence/i)) })
    await flush()
    expect(screen.queryByTestId('evidence-draft-differs')).toBeNull()
    expect(screen.getByTestId('evidence-tab')).toBeTruthy()
  })
})
