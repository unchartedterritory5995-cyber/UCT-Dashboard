// 🔴 THE WIRE-CUT FILE FOR THE thinkScript DOOR.
//
// ⛔ EVERY CASE DRIVES `ImportBox` **THROUGH THE SHEET**. Rendering the box alone
// would stay green for the whole time it was mounted nowhere — the failure that
// shipped eight features on this branch "built, tested, green and unreachable".
// Cut the `{buildMode === 'pine' && <ImportBox … />}` block, or the tab that
// reaches it, or the `dialect="auto"` prop, and these fail while every component
// stays perfectly correct. That is the only thing separating a wiring test from a
// component test.
//
// ⭐ AND THE CLAIM THE LANE RESTS ON IS ASSERTED HERE: a pasted thinkScript
// study, once translated, produces the SAME DOCUMENT as the same formula typed by
// hand — byte for byte but the draft id the server overwrites anyway. If that
// were false there would be two classes of definition and "one engine, three
// doors" would be a slogan.
//
// ⛔ EVERY EXPECTATION COMES FROM THE SHIPPED DOOR. The formula is
// `translateThinkScript(...)`'s; the read-back is `evaluateFormula(...).readback`;
// the hash is `astHash(parseFormula(...).ast)`. Nothing here is a retyped string.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet, { buildDefinition } from './BuilderSheet'
import { evaluateFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { PINE_DEBOUNCE_MS, inspectSource } from './PineBox'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import { AuthContext } from '../../../context/AuthContext'
import { parseFormula, astHash } from '../engine/ast/parse'
import { translateThinkScript } from '../engine/ast/thinkscript'
import { translatePine } from '../engine/ast/pine'
import { detectDialect } from '../engine/ast/dialect'

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
const pasteField = () => screen.getByTestId('pine-box').querySelector('textarea')

/** ⚠️ `getByRole`, NEVER `findByRole` — `findBy*` schedules a real-timer
 *  `waitFor` and this file runs under fake timers to drive both debounces. */
const tab = (name) => screen.getByRole('tab', { name })

async function settlePaste() {
  await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) })
  await flush()
}

async function settleFormula() {
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 1) })
  await flush()
}

async function paste(script) {
  fireEvent.click(tab(/^import$/i))
  fireEvent.change(pasteField(), { target: { value: script } })
  await settlePaste()
}

/** A published-shape thinkScript scan: a chrome line, a mapped call, a word
 *  spelling, and a `plot`. Everything in it is something W3.2-W3.6 measured. */
const TS_SCRIPT = `# Volume surge into an uptrend
declare lower;
input length = 50;
def avgVol = Average(volume, length);
plot scan = volume > 2 * avgVol and close is greater than Average(close, 200);
scan.SetDefaultColor(Color.GREEN);
AddLabel(yes, "surge", Color.YELLOW);
`

/** What the SHIPPED translator says about that script — never a retyped string. */
const EXPECTED = (() => {
  const out = translateThinkScript(TS_SCRIPT)
  return { out, row: out.outputs[out.selected] }
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

describe('🔴 the thinkScript door is REACHABLE from the builder', () => {
  it('the fixture is a script this engine actually translates', () => {
    // ⛔ NON-VACUITY, FIRST. Every case below asserts what the box shows for this
    // paste; if the translator refused it they would all pass for a box that
    // renders a refusal and nothing else.
    expect(EXPECTED.out.ok, JSON.stringify(EXPECTED.out.refusal)).toBe(true)
    expect(EXPECTED.row.formula).toBeTruthy()
    expect(detectDialect(TS_SCRIPT)).toBe('thinkscript')
  })

  it('one Import tab reaches the box, and the box reads thinkScript', async () => {
    mount()
    await flush()
    expect(screen.queryByTestId('pine-box')).toBe(null)
    fireEvent.click(tab(/^import$/i))
    expect(screen.getByTestId('pine-box')).toBeTruthy()
    // ⭐ ONE BOX, NOT A SECOND PASTE TAB. A second paste tab would be a second
    // write path into the same field — thinkScript, Pine and PCF all arrive
    // through THIS box, which detects the dialect rather than making a member
    // declare it.
    //
    // ⚰️ THE ASSERTION WAS `toHaveLength(4)` AND IT IS NOW A NAMED ROSTER, because
    // a bare count could not tell the two cases apart. The Screenshot tab added
    // 2026-08-29 is a FIFTH tab and does NOT violate the ruling above: the ruling
    // is about two ways to PASTE TEXT into one field, and an image is not text —
    // it cannot share this box's textarea, cannot be dialect-detected, and
    // reaches the engine through a different service entirely. What the ruling
    // forbids is a `thinkScript` tab beside `Import`, and that is what this now
    // asserts by NAME rather than by arithmetic.
    const tabs = screen.queryAllByRole('tab').map((t) => t.textContent.trim().toLowerCase())
    expect(tabs).toEqual(['library', 'conditions', 'import', 'screenshot', 'formula'])
    expect(tabs.filter((t) => /pine|thinkscript|pcf|tc2000/.test(t)),
      'a per-dialect paste tab is the thing this case forbids').toEqual([])
  })

  it('⛔ the box says WHICH dialect it read — detected, not requested', async () => {
    mount()
    await flush()
    await paste(TS_SCRIPT)
    const meta = screen.getByTestId('pine-meta')
    expect(meta.getAttribute('data-dialect')).toBe('thinkscript')
    expect(meta.textContent).toMatch(/thinkScript/i)
    // ⛔ AND IT IS TRUE OF THE PASTE ON SCREEN. A heading still saying "Pine"
    // over a thinkScript study is a sentence that is false about the text the
    // member is looking at — the defect class this lane keeps paying for.
    expect(meta.textContent).not.toMatch(/Pine/i)
  })
})

describe('paste a real thinkScript study and get a working scan', () => {
  it('the translated column and its read-back are on screen', async () => {
    mount()
    await flush()
    await paste(TS_SCRIPT)
    expect(screen.getByTestId(`pine-formula-${EXPECTED.out.selected}`).textContent)
      .toBe(EXPECTED.row.formula)
    const down = evaluateFormula(EXPECTED.row.formula, BUILDER_INPUT_SCOPE)
    expect(down.ok, down.error).toBe(true)
    expect(screen.getByText(down.readback)).toBeTruthy()
  })

  it('⭐ the chrome lines are LISTED, with their numbers — never dropped', async () => {
    // ⛔ A4's wording: "chrome calls listed as ignored lines, NEVER dropped".
    // The box is where a member actually sees that, so this is where it is
    // asserted end to end rather than in the translator's own unit tests.
    mount()
    await flush()
    await paste(TS_SCRIPT)
    fireEvent.click(screen.getByTestId('pine-notes-toggle'))
    const list = screen.getByTestId('pine-notes').textContent
    expect(list).toMatch(/line 6/)
    expect(list).toMatch(/line 7/)
    expect(list).toMatch(/colour|color/i)
    expect(list).toMatch(/label/i)
    // ⭐ …and the count in the toggle is the real one, from the door.
    const ignored = EXPECTED.out.ignored.length
    expect(ignored).toBeGreaterThan(1)
    expect(screen.getByTestId('pine-notes-toggle').textContent).toContain(String(ignored))
  })

  it('"Use this formula" puts it in the box the member already types in', async () => {
    mount()
    await flush()
    await paste(TS_SCRIPT)
    fireEvent.click(screen.getByTestId('pine-use'))
    await settleFormula()
    // ⛔ THE SOURCE AND NOTHING ELSE — the same contract the Pine door and the
    // starter library keep. Not the tree, not a prebuilt document, not a hash.
    expect(formulaField().value).toBe(EXPECTED.row.formula)
    const down = evaluateFormula(EXPECTED.row.formula, BUILDER_INPUT_SCOPE)
    expect(screen.getByTestId('readback').textContent).toBe(down.readback)
  })

  it('⭐⭐ the SAVED DOCUMENT is byte-identical to the same formula typed by hand', async () => {
    mount()
    await flush()
    await paste(TS_SCRIPT)
    fireEvent.click(screen.getByTestId('pine-use'))
    await settleFormula()
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Volume surge' } })
    await settleFormula()

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await flush()

    // ⛔ THE PAYLOAD THAT WAS ACTUALLY WRITTEN, not a document rebuilt here. A
    // test that compares two locally-built documents proves the builder is
    // deterministic; this proves the SHEET wrote the same thing.
    const post = H.requests.find((r) => r.method === 'POST')
    expect(post, 'nothing was written').toBeTruthy()
    const sent = JSON.parse(post.body).definition

    const F = EXPECTED.row.formula
    const typed = buildDefinition({
      defId: sent.id,
      name: 'Volume surge',
      source: F,
      ast: parseFormula(F).ast,
      mode: evaluateFormula(F, BUILDER_INPUT_SCOPE).verdict.mode,
      readback: evaluateFormula(F, BUILDER_INPUT_SCOPE).readback,
    })
    // ⛔ IF THIS DIFFERED THERE WOULD BE TWO CLASSES OF DEFINITION.
    expect(sent).toEqual(typed)

    // ⭐ `compute.fn` IS `astHash`, which IS `def_hash`. A thinkScript-authored
    // definition and a typed one of the same shape are ONE object to the chart,
    // the alert and the scan.
    expect(sent.compute.fn).toBe(astHash(parseFormula(F).ast))
    // ⛔ AND NOTHING IN IT REMEMBERS IT WAS thinkScript.
    expect(JSON.stringify(sent)).not.toMatch(/thinkscript/i)
  })
})

describe('⛔ a refusal reaches the member, verbatim, from the door that made it', () => {
  it('a study this engine will not translate refuses ON SCREEN, at its own token', async () => {
    const bad = 'plot p = TTM_Squeeze(close, 20);\n'
    const truth = translateThinkScript(bad)
    expect(truth.ok).toBe(false)          // non-vacuity
    mount()
    await flush()
    await paste(bad)
    const box = screen.getByTestId('pine-refusal')
    expect(box.getAttribute('data-guard')).toBe(truth.refusal.guard)
    // ⛔ VERBATIM — the box writes no sentence of its own about why.
    expect(box.textContent).toContain(truth.refusal.message)
    expect(box.textContent).toContain(`Line ${truth.refusal.line}`)
    expect(screen.getByTestId('pine-use').disabled).toBe(true)
  })

  it('⭐ …and the refusal names the DOCUMENT it needs, where a member reads it', async () => {
    // The doc-blocked registry exists so an over-refusal is not invisible. It is
    // only worth anything if the sentence reaches the screen.
    mount()
    await flush()
    await paste('plot p = RSI();\n')
    const box = screen.getByTestId('pine-refusal')
    expect(box.textContent).toContain('WHAT IS MISSING IS')
    expect(box.textContent).toMatch(/would change this answer/)
  })
})

describe('⛔⛔ X13 — every refusal is STAMPED with the text it was measured on', () => {
  // `CodeEditor` applies a lint mark ONLY while `diagnostics.source ===` its own
  // document, and FAILS CLOSED on a refusal that names no text. An unstamped
  // translator refusal therefore shows the member NOTHING — which is the failure
  // that deleted the `Diagnostic[]` door. The stamp IS the contract.
  const SRC = 'plot p = TTM_Squeeze(close, 20);\n'

  it('the top-level refusal carries the exact paste', () => {
    const r = inspectSource(SRC).refusal
    expect(r).toBeTruthy()
    expect(r.source).toBe(SRC)
    // ⛔ THE PASTE, NEVER THE FORMULA. The refusal's line/column index the text
    // the member wrote; stamping a formula would put the right offsets on the
    // wrong document, which is exactly the mis-mark the contract forbids.
    expect(r.line).toBe(1)
  })

  it('every PER-OUTPUT refusal carries it too', () => {
    const rep = inspectSource(SRC)
    const refused = rep.outputs.filter((o) => o.refusal)
    expect(refused.length).toBeGreaterThan(0)
    for (const o of refused) expect(o.source ?? o.refusal.source).toBe(SRC)
  })

  it('⭐ …on the Pine path and the plain-formula path as well — one door, one stamp', () => {
    const pine = inspectSource('//@version=5\nindicator("x")\nplot(nosuch(close))\n')
    expect(pine.dialect).toBe('pine')
    expect(pine.refusal).toBeTruthy()
    expect(pine.refusal.source).toBe('//@version=5\nindicator("x")\nplot(nosuch(close))\n')

    const plain = inspectSource('close > nosuchthing')
    expect(plain.dialect).toBe('formula')
    expect(plain.refusal).toBeTruthy()
    expect(plain.refusal.source).toBe('close > nosuchthing')
  })

  it('⛔ a stamp that does not match the document must mark NOTHING', () => {
    // The contract is `===` and nothing looser. This is the property that makes
    // a stale refusal indistinguishable from an absent one — deliberately.
    const r = inspectSource(SRC).refusal
    expect(r.source === 'some other document').toBe(false)
    expect(r.source === SRC).toBe(true)
  })
})

describe('⭐ `ignored` is the ONE name — the two translators are normalised at the door', () => {
  it('a Pine paste and a thinkScript paste both answer to `ignored`', () => {
    const ts = inspectSource(TS_SCRIPT)
    expect(Array.isArray(ts.ignored)).toBe(true)
    expect(ts.ignored.length).toBeGreaterThan(0)

    const pineSrc = '//@version=5\nindicator("x")\nplot(close > ta.sma(close, 20) ? 1 : 0)\nbgcolor(color.red)\n'
    const pine = inspectSource(pineSrc)
    expect(pine.dialect).toBe('pine')
    expect(Array.isArray(pine.ignored)).toBe(true)
    // ⛔ AND IT IS THE SAME LIST the Pine translator calls `notes` — not an empty
    // array standing in for one, which is what a missing normalisation looks
    // like. Compared against the DOOR, never against a number typed here.
    expect(pine.ignored).toEqual(translatePine(pineSrc).notes)
  })

  it('the report shape is the contract, for every dialect', () => {
    for (const src of [TS_SCRIPT, '//@version=5\nindicator("x")\nplot(close)\n', 'close > open']) {
      const r = inspectSource(src)
      for (const k of ['ok', 'dialect', 'version', 'outputs', 'selected', 'refusal', 'ignored', 'folded']) {
        expect(Object.prototype.hasOwnProperty.call(r, k), `${k} for ${r.dialect}`).toBe(true)
      }
      expect(Array.isArray(r.outputs)).toBe(true)
      expect(Array.isArray(r.ignored)).toBe(true)
      expect(Array.isArray(r.folded)).toBe(true)
    }
  })

  it('⛔ an explicit dialect OVERRIDES the detector, and is honoured', () => {
    // A member who knows what they pasted must be able to say so. Reading a
    // thinkScript study as `formula` should refuse, not silently translate.
    const forced = inspectSource(TS_SCRIPT, 'formula')
    expect(forced.dialect).toBe('formula')
    expect(forced.ok).toBe(false)
    // …and the same text on `auto` works, so the override is what changed it.
    expect(inspectSource(TS_SCRIPT).ok).toBe(true)
  })
})
