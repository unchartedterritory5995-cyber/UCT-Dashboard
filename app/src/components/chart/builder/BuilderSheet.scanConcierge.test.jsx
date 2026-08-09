// 🔴 THE WIRE-CUT FILE. Every case here drives the CONCIERGE **THROUGH THE
// SHEET**, on the tab a member builds a screen on.
//
// ⛔ AND THAT IS THE ONLY THING THAT DISTINGUISHES IT FROM `ConciergeBox.test.jsx`.
// The box is correct on its own and the server is correct on its own; the defect
// this repo measured eight times in one week is two correct components with
// nothing between them. `ConciergeBox` itself shipped complete — a prop contract,
// a derived read-back, a full test file — with ZERO non-test importers, so the AI
// door existed on no screen at all. These cases FAIL if the `kind` prop stops
// travelling, or if the accepted source stops landing in the shared field, while
// both components stay perfectly correct.
//
// ⛔ EVERY EXPECTATION IS TAKEN FROM THE SHIPPED DOOR, NEVER FROM A COPY OF IT.
// The read-back is `evaluateFormula(...).readback`; the save gate is
// `canSaveFormula`; the tree is `parseFormula`'s. A test that retyped any of the
// three would be a second authority over a value the source already owns.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { evaluateFormula, canSaveFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import { AuthContext } from '../../../context/AuthContext'
import { parseFormula, astHash } from '../engine/ast/parse'
import { sentenceFor } from '../engine/ast/sentence'

const PROPOSE = '/api/user-definitions/propose'

/** A server `sentence` that is a LIE — plausible, fluent, about another formula.
 *  If it ever reaches the screen, the read-back rail has rotted. */
const LIE = 'a smoothed momentum oscillator of the last nine bars'

const H = vi.hoisted(() => ({ requests: [], proposeResponse: null, servedAst: null }))

function stubFetch() {
  H.requests = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (String(url).endsWith(PROPOSE)) return H.proposeResponse
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1 }) }
  })
}

/** The LAST request this surface actually issued to the concierge — read off
 *  `global.fetch`, never off an injected impl. The sheet passes no `fetchImpl`
 *  on purpose (`lesson_injected_dependency_hides_the_fetch`). */
function lastProposal() {
  const sent = H.requests.filter((r) => r.url.endsWith(PROPOSE)).at(-1)
  expect(sent, 'the sheet never asked the concierge anything').toBeTruthy()
  return JSON.parse(sent.body)
}

/** ⚠️ MICROTASKS ARE DRAINED EXPLICITLY, NEVER `waitFor`/`findBy*`. Those
 *  schedule REAL intervals, and this file runs under fake timers to drive the
 *  formula debounce — the combination hangs for the full test timeout and reads
 *  as a broken assertion rather than a broken wait. */
const flush = async () => {
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() })
}

const noop = () => {}

function mount() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={noop} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

const field = () => screen.getByLabelText('Formula')
const englishBox = () => screen.getByLabelText(/plain English/i)
const openConditions = () => fireEvent.click(screen.getByRole('tab', { name: /conditions/i }))

async function settle() {
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 1) })
  await flush()
}

async function askFor(text) {
  fireEvent.change(englishBox(), { target: { value: text } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /draft a formula/i }))
  })
  await flush()
}

/** A proposal the SERVER would send: a tree, its source, and a lying sentence. */
function proposalFor(source, extra = {}) {
  const parsed = parseFormula(source)
  expect(parsed.ok, `the fixture source does not parse: ${source}`).toBe(true)
  H.servedAst = parsed.ast
  return {
    ok: true, status: 200,
    json: async () => ({
      ok: true, kind: 'scan', ast: parsed.ast, source,
      repaint: 'non-repainting', freshness: 'live', cadence: null,
      concepts: [], sentence: LIE, ...extra,
    }),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  stubFetch()
  H.proposeResponse = null
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete global.fetch
})

describe('🔴 the English box on the CONDITIONS tab asks for a SCAN, and the answer lands in the shared source', () => {
  it('the request carries kind="scan" and the accepted formula fills the shipped field', async () => {
    mount()
    openConditions()
    H.proposeResponse = proposalFor('(close > open)')

    await askFor('stocks closing above the open')

    // ⛔ THE REQUEST CARRIED THE KIND. A box that always asks for an indicator is
    // a box whose scan stage can never fire — and no component test on either
    // side of the wire can see that.
    expect(lastProposal().kind).toBe('scan')

    fireEvent.click(screen.getByRole('button', { name: /use this formula/i }))
    await settle()

    // …and the answer went into the SAME field the picker and the text box share,
    // so it meets the same parse, budget, linter and Save button a typed formula
    // does. Taking the tree straight to the store would be a second write path.
    expect(field()).toHaveValue('(close > open)')

    // …and the sentence shown is the TREE'S, not the server's.
    expect(screen.queryByText(LIE)).toBeNull()
    const expected = evaluateFormula('(close > open)', BUILDER_INPUT_SCOPE)
    expect(screen.getByTestId('readback')).toHaveTextContent(expected.readback)
    expect(expected.readback).toBe(sentenceFor(parseFormula('(close > open)').ast))
  })

  it('the FORMULA tab asks for an indicator — the kind is the mode, not a constant', async () => {
    // ⚠️ THE CONTROL. Without it, "the request says scan" would be satisfied by a
    // box hard-wired to scan, which would refuse every indicator a member drafts.
    mount()
    H.proposeResponse = proposalFor('sma(close, 20)', { kind: 'indicator' })
    await askFor('the twenty bar average of the close')
    expect(lastProposal().kind).toBe('indicator')

    // …and switching tabs moves it, with no remount and no retyping.
    openConditions()
    H.proposeResponse = proposalFor('(close > open)')
    await askFor('stocks closing above the open')
    expect(lastProposal().kind).toBe('scan')
  })

  it('a REFUSED concept reaches the member BY NAME and nothing is drafted', async () => {
    // ⛔ A WRONG SCAN THAT LOOKS RIGHT IS WORSE THAN A REFUSAL. The firm's own
    // vocabulary declines "cheap" because its own screen that uses the word
    // bundles three measures — so the member is told WHICH WORD failed and is
    // handed nothing they could mistake for an answer.
    mount()
    openConditions()
    H.proposeResponse = {
      ok: true, status: 200,
      json: async () => ({
        ok: false, gate: 'concept:ambiguous',
        reason: '"cheap" is ambiguous — tell me which measure you mean',
      }),
    }

    await askFor('find me cheap stocks')

    expect(screen.getByText(/"cheap" is ambiguous/)).toBeInTheDocument()
    expect(screen.getByTestId('concierge-gate')).toHaveTextContent('concept:ambiguous')
    // ⛔ AND NOTHING WAS DRAFTED. Not a partial expansion, not a nearest match.
    expect(field()).toHaveValue('')
    expect(screen.queryByTestId('concierge-proposal')).toBeNull()
    expect(screen.queryByRole('button', { name: /use this formula/i })).toBeNull()
  })

  it("⭐ THE PHASE'S ACCEPTANCE TREE arrives from the AI door and goes through the shipped doors", async () => {
    // `rs_rank > 80 && adr_pct > 4 && close > sma(close, 50)` — two table
    // SCALARS and a function call. It was unsayable and therefore unsaveable
    // until the fourth section reached both lanes; here it is proposed in
    // English, read back from the TREE, and gated by `canSaveFormula` itself.
    const ACCEPTANCE = 'rs_rank > 80 && adr_pct > 4 && close > sma(close, 50)'
    mount()
    openConditions()
    H.proposeResponse = proposalFor(ACCEPTANCE, { freshness: 'as-of-snapshot', cadence: 'nightly' })

    await askFor('trending leaders pulling back, above the 50 day')
    expect(lastProposal().kind).toBe('scan')

    fireEvent.click(screen.getByRole('button', { name: /use this formula/i }))
    await settle()

    expect(field()).toHaveValue(ACCEPTANCE)

    // ⛔ THROUGH `evaluateFormula` AND `canSaveFormula` THEMSELVES. A private copy
    // of either would be a second gate, and the two would disagree the day the
    // linter moves.
    const result = evaluateFormula(ACCEPTANCE, BUILDER_INPUT_SCOPE)
    expect(result.ok, result.error || '').toBe(true)
    expect(result.verdict.mode).toBe('non-repainting')
    expect(canSaveFormula(result, false)).toBe(true)
    expect(screen.getByTestId('readback')).toHaveTextContent(result.readback)

    // …and the tree the sheet is holding is the tree the SERVER proposed. ⛔ THE
    // HASH, NOT THE STRING: the claim is that the same OBJECT survived the trip
    // through the text field, and only `astHash` can say that.
    expect(astHash(parseFormula(field().value).ast)).toBe(astHash(H.servedAst))
    expect(screen.queryByText(LIE)).toBeNull()

    // The Save button opens only once the formula is named — the same gate a
    // typed formula meets, unchanged by the door the source came through.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Leaders pulling back' } })
    await flush()
    expect(screen.getByRole('button', { name: /^Sav/ })).not.toBeDisabled()
  })
})
