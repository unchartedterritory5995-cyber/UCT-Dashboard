// ─── A MEMBER TYPES TC2000 INTO THE SHIPPED BOX, AND A SCAN COMES OUT ───────
//
// ⛔ EVERY CASE HERE DRIVES THE READER **THROUGH THE SHEET**. `pcf.test.js`
// already proves the translation; those cases would stay green for the entire
// time the reader was reachable from nothing — which is exactly how eight
// features shipped this week built, tested, green and mounted nowhere. These
// fail if the wire is cut while `pcf.js` and `BuilderSheet` both stay perfectly
// correct, and that is the only thing that distinguishes a wiring test from a
// component test.
//
// ⛔ AND EVERY EXPECTATION COMES FROM THE SHIPPED DOOR. The read-back is
// `evaluateFormula(...).readback`, the save gate is `canSaveFormula`, the
// identity is `astHash(parseFormula(<native spelling>).ast)`. Retyping any of
// them would be a second authority over a value the source already owns.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { evaluateFormula, canSaveFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import { AuthContext } from '../../../context/AuthContext'
import { parseFormula, astHash } from '../engine/ast/parse'
import { offsetBinding } from '../engine/ast/pcf'

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

/** Flush microtasks under fake timers — `waitFor` schedules real intervals and
 *  hangs, so the promise chain is drained explicitly instead. */
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

const noop = () => {}

function mount() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={noop} onSaved={noop} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

const field = () => screen.getByLabelText('Formula')

async function settle() {
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 1) })
  await flush()
}

async function typeFormula(text) {
  fireEvent.change(field(), { target: { value: text } })
  await settle()
}

async function nameIt(text = 'TC2000 uptrend') {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: text } })
  await flush()
}

const saveBtn = () => screen.getByRole('button', { name: /^Sav/ })

/** The document the sheet actually PUT on the wire. ⛔ Read off `global.fetch`,
 *  not off an injected save function — `lesson_injected_dependency_hides_the_
 *  fetch`. */
function savedDocument() {
  const write = H.requests.filter((r) => r.method !== 'GET').at(-1)
  expect(write, 'nothing was written — the save never left the sheet').toBeTruthy()
  return JSON.parse(write.body).definition ?? JSON.parse(write.body)
}

beforeEach(() => {
  vi.useFakeTimers()
  stubFetch()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete global.fetch
})

// ═════════════════════════════════════════════════════════════════════════════

describe('🔴 TC2000 PCF reaches the shipped formula box', () => {
  it('a real TC2000 uptrend filter TYPES, READS BACK IN ENGLISH and SAVES', async () => {
    // The Trade Risk's published long-term uptrend filter, verbatim.
    const PCF = '(C > AVGC50) AND (AVGC50 > AVGC200)'
    const NATIVE = '(close > sma(close, 50)) && (sma(close, 50) > sma(close, 200))'

    mount()
    await typeFormula(PCF)

    // No refusal…
    expect(screen.queryByTestId('formula-error')).toBeNull()
    // …the member is TOLD which language we read…
    expect(screen.getByTestId('formula-dialect')).toHaveAttribute('data-dialect', 'pcf')
    // …and the read-back is the shipped `sentenceFor`'s, in English.
    const expected = evaluateFormula(PCF, BUILDER_INPUT_SCOPE)
    expect(expected.ok, expected.error || '').toBe(true)
    expect(expected.dialect).toBe('pcf')
    expect(screen.getByTestId('readback')).toHaveTextContent(expected.readback)
    expect(expected.readback).toContain('50-bar average')

    // The linter's badge is the machine's, computed on the tree PCF produced.
    expect(screen.getByTestId('repaint-badge')).toHaveAttribute('data-mode', 'non-repainting')
    expect(canSaveFormula(expected, false)).toBe(true)

    await nameIt()
    expect(saveBtn()).not.toBeDisabled()
    fireEvent.click(saveBtn())
    await flush()

    // ⭐ THE TREE THAT LEFT THE SHEET IS THE NATIVE TREE. Not "a tree the PCF
    // reader produced" — the very object the engine already runs on both lanes
    // at 1e-9, so this layer adds no numeric surface and no parity obligation.
    const doc = savedDocument()
    expect(astHash(doc.compute.ast)).toBe(astHash(parseFormula(NATIVE).ast))
  })

  it('⭐ a TC2000 bar offset behaves IN THE BOX exactly as the engine allows', async () => {
    // 'Reclaiming the 50-day' — TC2000's most common shape. ⭐ THE EXPECTATION IS
    // DERIVED FROM THE MANIFEST, not written: while the table declares no offset
    // form the box must name the missing capability at the offending token, and
    // the moment it declares one the same keystrokes must SAVE. A surface test
    // that only asserted the refusal would go silently green the day the engine
    // grew the offset and this box carried on refusing it.
    const bound = offsetBinding()
    mount()
    await typeFormula('(C > AVGC50) AND (C1 < AVGC50.1)')

    if (!bound) {
      const chip = screen.getByTestId('formula-error')
      expect(chip).toHaveAttribute('data-guard', 'pcf:offset')
      expect(chip).toHaveAttribute('data-dialect', 'pcf')
      expect(chip).toHaveTextContent('C1')
      expect(chip).toHaveTextContent('1 bar back')
      // ⛔ AND SAVE IS SHUT. A refusal that left the button live would be a
      // caption, not a gate.
      await nameIt()
      expect(saveBtn()).toBeDisabled()
      return
    }

    expect(screen.queryByTestId('formula-error')).toBeNull()
    expect(screen.getByTestId('formula-dialect')).toHaveAttribute('data-dialect', 'pcf')
    await nameIt('Reclaims the 50-day')
    fireEvent.click(saveBtn())
    await flush()
    // ⛔ AND IT SURVIVES THE SCHEMA'S ROUND-TRIP GATE, which re-reads the STORED
    // TC2000 source against the stored tree. That gate is where this feature
    // failed the first time it was wired.
    const doc = savedDocument()
    expect(doc.compute.source).toBe('(C > AVGC50) AND (C1 < AVGC50.1)')
    expect(astHash(doc.compute.ast)).toBe(doc.compute.fn)
  })

  it('the crossing TC2000 needs an offset for IS expressible, and saves', async () => {
    // TC2000 defines `XUP(C, AVGC50)` as `C >= AVGC50 AND C1 <= AVGC50.1`. The
    // offset lives inside TC2000's definition, not the member's formula — so the
    // most common offset idiom has a supported spelling.
    mount()
    await typeFormula('XUP(C, AVGC50)')
    expect(screen.queryByTestId('formula-error')).toBeNull()
    await nameIt('Reclaims the 50-day')
    fireEvent.click(saveBtn())
    await flush()
    expect(astHash(savedDocument().compute.ast))
      .toBe(astHash(parseFormula('crossOver(close, sma(close, 50))').ast))
  })

  it('a TC2000 token this table has no name for refuses at `pcf:name`, not silently', async () => {
    // ⚰️ THIS EXAMPLE WAS `SUM(C, 10)` AND IT ROTTED. `SUM` was wired to the
    // table's rolling sum in `1a5f5b2d`, so the token chosen to demonstrate
    // "this table has no name for it" acquired a name — and the test went red
    // for the best possible reason, coverage growing, while reading exactly like
    // a regression.
    //
    // ⛔ A NEGATIVE EXAMPLE MUST BE ONE NOBODY WILL EVER IMPLEMENT, or it is a
    // time bomb set by our own roadmap: every real TC2000 spelling worth naming
    // here is one somebody may wire next quarter. So the unknown half is
    // nonsense — the same control token `pcf.vocabulary.test.js` uses.
    //
    // ⚠️ AND IT NEEDS A REAL MARKER BESIDE IT. `ZZNOPE9 > 100` alone is not
    // TC2000 to the DETECTOR, so it would reach the native reader and refuse at
    // `sentence:name` — a different guard, testing a different thing. `ATR14`
    // makes the dialect unambiguous, which is what puts the refusal in `pcf.js`
    // where this case belongs. (`MS20`/`OBV20` fail the same way for the same
    // reason; both were tried.)
    mount()
    await typeFormula('ATR14 > ZZNOPE9')
    const chip = screen.getByTestId('formula-error')
    expect(chip).toHaveAttribute('data-guard', 'pcf:name')
    expect(chip).toHaveTextContent('ZZNOPE9')
  })

  it('⛔ A NATIVE FORMULA IS UNTOUCHED — the detector cannot take one away', async () => {
    // The regression this wire could cause. Every formula this product has ever
    // saved is native; if the box started reading one as TC2000, a working
    // formula would start refusing.
    mount()
    await typeFormula('close > sma(close, 50) && rs_rank > 80')
    expect(screen.queryByTestId('formula-error')).toBeNull()
    expect(screen.queryByTestId('formula-dialect')).toBeNull()
    expect(field()).toHaveAttribute('data-dialect', 'native')
    const expected = evaluateFormula('close > sma(close, 50) && rs_rank > 80', BUILDER_INPUT_SCOPE)
    expect(expected.dialect).toBe('native')
    expect(screen.getByTestId('readback')).toHaveTextContent(expected.readback)
  })

  it('a NATIVE typo is refused by the NATIVE door, never by a TC2000 one', async () => {
    // ⛔ THE WRONG-DOOR DEFECT. Trying native, failing, then trying TC2000 would
    // report a `pcf:` guard for a native mistake. The dialect is decided BEFORE
    // the read, so the refusal always names the language the member was writing.
    mount()
    await typeFormula('sma(close, 20')
    const chip = screen.getByTestId('formula-error')
    expect(chip.getAttribute('data-guard').startsWith('pcf:')).toBe(false)
    expect(chip).toHaveAttribute('data-dialect', 'native')
  })

  it('switching from TC2000 back to native inside one session re-reads the box', async () => {
    // The dialect is a property of the SOURCE, so a member pasting one and then
    // the other never has to tell the box anything.
    mount()
    await typeFormula('C > AVGC50')
    expect(screen.getByTestId('formula-dialect')).toBeTruthy()
    await typeFormula('close > sma(close, 50)')
    expect(screen.queryByTestId('formula-dialect')).toBeNull()
    expect(screen.queryByTestId('formula-error')).toBeNull()
  })
})
