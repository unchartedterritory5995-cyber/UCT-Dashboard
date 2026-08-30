// 🔴 THE WIRE-CUT FILE FOR THE PINE DOOR.
//
// ⛔ EVERY CASE HERE DRIVES `PineBox` **THROUGH THE SHEET**. Rendering the box on
// its own would stay green for the entire time it was mounted nowhere — which is
// exactly how eight features on this branch shipped built, tested, green and
// unreachable. Remove the `{buildMode === 'pine' && <PineBox … />}` block, or the
// tab that reaches it, and these fail while both components stay perfectly
// correct. That is the only thing separating a wiring test from a component test.
//
// ⭐ AND THE CLAIM THE WHOLE TASK RESTS ON IS ASSERTED HERE, because this is
// where `buildDefinition` lives: a pasted Pine script, once translated, produces
// the SAME DOCUMENT as the same formula typed by hand — byte for byte but the
// draft id the server overwrites anyway. If that were false there would be two
// classes of definition and "one engine, three doors" would be a slogan.
//
// ⛔ EVERY EXPECTATION COMES FROM THE SHIPPED DOOR. The formula is
// `translatePine(...)`'s; the read-back is `evaluateFormula(...).readback`; the
// save gate is `canSaveFormula`; the hash is `astHash(parseFormula(...).ast)`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet, { buildDefinition } from './BuilderSheet'
import { evaluateFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { PINE_DEBOUNCE_MS } from './PineBox'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import { AuthContext } from '../../../context/AuthContext'
import { parseFormula, astHash } from '../engine/ast/parse'
import { translatePine } from '../engine/ast/pine'

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

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
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

const formulaField = () => screen.getByLabelText('Formula')
// ⏳ HAND-BACK (W3.7): the box became `ImportBox` and its aria-label now names
// every dialect it reads, so the field is found by TESTID — which is what
// `pine-box` always meant ("the paste box"), not "the Pine box". Every other
// assertion in this file is byte-identical: the Pine door behaves exactly as it
// did, which is the point of asserting it here.
const pineField = () => screen.getByTestId('pine-box').querySelector('textarea')

/** ⚠️ `getByRole`, NEVER `findByRole` — `findBy*` schedules a real-timer
 *  `waitFor` and this file runs under fake timers to drive both debounces. */
const tab = (name) => screen.getByRole('tab', { name })

async function settlePine() {
  await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) })
  await flush()
}

async function settleFormula() {
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 1) })
  await flush()
}

async function paste(script) {
  fireEvent.click(tab(/^import$/i))
  fireEvent.change(pineField(), { target: { value: script } })
  await settlePine()
}

const SCREEN_SCRIPT = `//@version=5
indicator("Oversold in an uptrend", overlay=false)
rsiLen = input.int(14, "RSI Length", minval=1)
maLen  = input.int(200, "Trend Length")
r = ta.rsi(close, rsiLen)
trend = ta.sma(close, maLen)
signal = r < 30 and close > trend
plot(signal ? 1 : 0, "Signal")
alertcondition(signal, "Oversold in an uptrend")
`

/** What the SHIPPED translator says about that script — never a retyped string. */
const EXPECTED = (() => {
  const out = translatePine(SCREEN_SCRIPT)
  return out.outputs[out.selected]
})()

beforeEach(() => {
  vi.useFakeTimers()
  stubFetch()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the Pine door is reachable from the builder', () => {
  it('a Pine tab exists beside the other three', async () => {
    mount()
    await flush()
    expect(tab(/^import$/i)).toBeTruthy()
    expect(tab(/library/i)).toBeTruthy()
    expect(tab(/conditions/i)).toBeTruthy()
    expect(tab(/formula/i)).toBeTruthy()
  })

  it('clicking it mounts a box a member can paste into', async () => {
    mount()
    await flush()
    expect(screen.queryByTestId('pine-box')).toBe(null)
    fireEvent.click(tab(/^import$/i))
    expect(screen.getByTestId('pine-box')).toBeTruthy()
    expect(pineField()).toBeTruthy()
  })
})

describe('paste a real screener script and get a working scan', () => {
  it('the translated column, its formula and its read-back are on screen', async () => {
    mount()
    await flush()
    await paste(SCREEN_SCRIPT)

    // ⭐ THE FORMULA IS THE TRANSLATOR'S, and the read-back is the engine's.
    expect(screen.getByTestId(`pine-formula-${translatePine(SCREEN_SCRIPT).selected}`).textContent)
      .toBe(EXPECTED.formula)
    const down = evaluateFormula(EXPECTED.formula, BUILDER_INPUT_SCOPE)
    expect(down.ok).toBe(true)
    expect(screen.getByText(down.readback)).toBeTruthy()
  })

  it("the author's lengths arrive as FIELDS, seeded with their own numbers", async () => {
    // ⚰️ THIS READ `pine-inputs-folded` AND THE SENTENCE *"Fixed at their
    // defaults"*. Both lengths here land in `int` slots, so neither could be a
    // declared knob — true, and the wrong thing to leave a member with, since
    // `translatePine` has taken an `inputValues` override since the knob work and
    // nothing in the product ever passed one.
    mount()
    await flush()
    await paste(SCREEN_SCRIPT)
    const rsi = screen.getByTestId('pine-input-rsiLen')
    const ma = screen.getByTestId('pine-input-maLen')
    expect(rsi.placeholder).toBe('14')
    expect(ma.placeholder).toBe('200')
    // ⛔ THE AUTHOR'S OWN BOUND RIDES ALONG. `rsiLen` declares `minval=1` and
    // `maLen` declares none, so the two fields must not claim the same limits.
    expect(rsi).toHaveAttribute('min', '1')
    expect(ma).not.toHaveAttribute('min')
    // ⭐ AND NOTHING IS STILL BEING CALLED FIXED.
    expect(screen.queryByTestId('pine-inputs-folded')).toBeNull()
  })

  it('"Use this formula" puts it in the box the member already types in', async () => {
    mount()
    await flush()
    await paste(SCREEN_SCRIPT)
    fireEvent.click(screen.getByTestId('pine-use'))
    await settleFormula()

    // ⛔ THE SOURCE AND NOTHING ELSE. This is the whole contract: the pasted
    // script becomes text in the one field, and every gate downstream is the one
    // that was already there.
    expect(formulaField().value).toBe(EXPECTED.formula)
    const down = evaluateFormula(EXPECTED.formula, BUILDER_INPUT_SCOPE)
    expect(screen.getByTestId('readback').textContent).toBe(down.readback)
  })

  it('...and Save is then enabled, with no acknowledgement needed', async () => {
    mount()
    await flush()
    await paste(SCREEN_SCRIPT)
    fireEvent.click(screen.getByTestId('pine-use'))
    await settleFormula()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Oversold uptrend' } })
    await settleFormula()
    const save = screen.getByRole('button', { name: /^save$/i })
    expect(save.disabled).toBe(false)
  })

  it('⭐ the SAVED DOCUMENT is byte-identical to the same formula typed by hand', async () => {
    mount()
    await flush()
    await paste(SCREEN_SCRIPT)
    fireEvent.click(screen.getByTestId('pine-use'))
    await settleFormula()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Oversold uptrend' } })
    await settleFormula()
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await flush()

    const post = H.requests.find((r) => r.method === 'POST')
    expect(post, 'nothing was written').toBeTruthy()
    const sent = JSON.parse(post.body).definition

    const typed = buildDefinition({
      defId: sent.id,
      name: 'Oversold uptrend',
      source: EXPECTED.formula,
      ast: parseFormula(EXPECTED.formula).ast,
      mode: evaluateFormula(EXPECTED.formula, BUILDER_INPUT_SCOPE).verdict.mode,
      readback: evaluateFormula(EXPECTED.formula, BUILDER_INPUT_SCOPE).readback,
    })
    expect(sent).toEqual(typed)

    // ⭐ `compute.fn` IS `astHash`, which IS `def_hash`. A Pine-authored
    // definition and a typed one of the same shape are ONE object to the chart,
    // the alert and the scan.
    expect(sent.compute.fn).toBe(astHash(parseFormula(EXPECTED.formula).ast))
    // ⛔ AND NOTHING IN IT REMEMBERS IT WAS PINE.
    expect(JSON.stringify(sent).toLowerCase()).not.toContain('pine')
  })
})

describe('a script this engine cannot run says so, at its own token', () => {
  it('a strategy is refused by name with the line and a caret', async () => {
    mount()
    await flush()
    await paste('//@version=5\nstrategy("My strat", overlay=true)\nplot(ta.sma(close, 5))\n')

    const chip = screen.getByTestId('pine-refusal')
    expect(chip.getAttribute('data-guard')).toBe('pine:declaration-strategy')
    expect(chip.textContent).toContain('Line 2, column 1')
    expect(screen.queryByTestId('pine-use').disabled).toBe(true)
  })

  it('a variable bar offset is refused at the index, with the caret under it', async () => {
    mount()
    await flush()
    // ⚠️ THE EXAMPLE MOVED 2026-08-11, THE BEHAVIOUR UNDER TEST DID NOT. `n = 3`
    // used to refuse here and now FOLDS to `close[3]` — owner decision: the
    // stored tree is authoritative, so an input is frozen for offsets exactly as
    // it already was for lengths. What this test is about is the CARET landing
    // under the index, so it now uses an index that genuinely cannot be reduced
    // — a series — and the guard it names is unchanged.
    await paste('//@version=5\nindicator("t")\nn = ta.sma(close, 3)\nplot(close - close[n])\n')

    const chip = screen.getByTestId('pine-refusal')
    expect(chip.getAttribute('data-guard')).toBe('pine:offset-literal')
    expect(chip.textContent).toContain('Line 4, column 20')
    expect(chip.querySelector('pre').textContent)
      .toBe('plot(close - close[n])\n                   ^')
  })

  it('⭐ but `close[1]` itself goes all the way to the formula box', async () => {
    // The construct Pine members reach for most. It used to be the single most
    // common refusal in the corpus; it is now an ordinary column.
    mount()
    await flush()
    await paste('//@version=5\nindicator("t")\nplot(close > close[1] ? 1 : 0, "Up bar")\n')

    expect(screen.queryByTestId('pine-refusal')).toBe(null)
    expect(screen.getByTestId('pine-formula-0').textContent).toBe('close > close[1] ? 1 : 0')
    fireEvent.click(screen.getByTestId('pine-use'))
    await settleFormula()
    expect(formulaField().value).toBe('close > close[1] ? 1 : 0')
    const down = evaluateFormula('close > close[1] ? 1 : 0', BUILDER_INPUT_SCOPE)
    expect(down.ok).toBe(true)
    expect(down.verdict.mode).toBe('non-repainting')
    expect(screen.getByTestId('readback').textContent).toBe(down.readback)
  })

  it('a refused script cannot reach the formula box at all', async () => {
    mount()
    await flush()
    await paste('//@version=5\nindicator("t")\nplot(request.security(syminfo.tickerid, "D", close))\n')
    expect(screen.getByTestId('pine-use').disabled).toBe(true)
    fireEvent.click(tab(/formula/i))
    expect(formulaField().value).toBe('')
  })

  it('one bad plot beside a good one offers the good one and NAMES the bad one', async () => {
    mount()
    await flush()
    await paste('//@version=5\nindicator("t")\n'
      + 'plot(ta.sma(close, 5), "Good")\n'
      + 'plot(request.security(syminfo.tickerid, "D", close), "Bad")\n')

    expect(screen.getByTestId('pine-formula-0').textContent).toBe('sma(close, 5)')
    expect(screen.getByTestId('pine-output-refusal-1').getAttribute('data-guard')).toBe('pine:request')
    expect(screen.getByTestId('pine-use').disabled).toBe(false)
  })
})

describe('the lines a screen does not read are listed, never dropped', () => {
  it('a chart-only call is shown as an ignored line with its number', async () => {
    mount()
    await flush()
    await paste('//@version=5\nindicator("t")\nhline(80, "Upper")\nplot(ta.sma(close, 5))\n')
    fireEvent.click(screen.getByTestId('pine-notes-toggle'))
    const notes = screen.getByTestId('pine-notes').textContent
    expect(notes).toContain('line 3')
    expect(notes).toContain('hline')
  })
})
