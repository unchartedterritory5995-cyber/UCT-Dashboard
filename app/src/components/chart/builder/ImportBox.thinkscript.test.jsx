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

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet, { buildDefinition } from './BuilderSheet'
import { evaluateFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { PINE_DEBOUNCE_MS, inspectSource } from './PineBox'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import { AuthContext } from '../../../context/AuthContext'
import { parseFormula, astHash } from '../engine/ast/parse'
import { TS_DOC_BLOCKED } from '../engine/ast/thinkscript'
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

/** A study blocked on a default thinkorswim does not publish. */
const BLOCKED_SCRIPT = `plot p = RSI() > 30;
`

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
    //
    // ⭐ Phase One Track C fires telemetry POSTs (`/api/indicator-telemetry/
    // event`) on the SAME "Use this formula" click this flow exercises, so a
    // bare `method === 'POST'` now matches the FIRST of several POSTs rather
    // than the one save this test cares about — scoped to the save endpoint.
    const post = H.requests.find((r) => r.method === 'POST' && r.url.includes('/api/user-definitions'))
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

describe('🔴 a documentation-blocked study OFFERS the conventional call', () => {
  // ⛔⛔ THE RULING THIS RENDERS. thinkorswim publishes no default for several
  // study parameters, and this engine REFUSES to assume one — `displace` shifts
  // every bar, a guessed `price` draws a plausible column that is wrong on every
  // bar with no refusal anywhere, and assuming them was PRICED at two corpus
  // scripts before it was refused. So the conventional call is OFFERED and the
  // member applies it: written into their own script the value is visible in the
  // read-back, which is the entire difference between their choice and our guess
  // (`closedTable.json::_functions_na`, one lane over).
  //
  // 🔴 AND IT IS A WIRE-CUT TEST, THROUGH THE SHEET. The registry can be perfect
  // and the refusal can carry the suggestion, and a member still sees nothing if
  // `Refusal` does not render it — "built, tested, green and unreachable" is this
  // branch's own recorded failure, eight times over.

  it('the fixture really is blocked on a missing default — non-vacuity', () => {
    // Without this, every assertion below would pass for a script that translates
    // fine and shows no refusal at all.
    const out = translateThinkScript(BLOCKED_SCRIPT)
    expect(out.refusal, 'the fixture must refuse').toBeTruthy()
    expect(out.refusal.guard).toBe('thinkscript:arity')
    expect(out.refusal.suggest).toBe(TS_DOC_BLOCKED.RSI.suggest)
  })

  it('⭐⭐ the member sees the conventional call, verbatim from the registry', async () => {
    mount()
    await flush()
    await paste(BLOCKED_SCRIPT)
    const offer = screen.getByTestId('import-suggest')
    // ⛔ THE REGISTRY OWNS THE TEXT — not a string retyped here, which would go
    // stale the day the suggestion is corrected and still pass.
    expect(offer.textContent).toContain(TS_DOC_BLOCKED.RSI.suggest)
    // ⭐ AND IT SAYS WHOSE DECISION IT IS. An offer a member reads as "the engine
    // handled it" is the silent assumption wearing different clothes.
    expect(offer.textContent).toMatch(/won.t assume|conventional/i)
  })

  it('⛔ a study that translates offers NOTHING — the offer is not decoration', async () => {
    // ⚰️ THE CONTROL. A box that rendered this block unconditionally would satisfy
    // the case above while telling every member their working script needs fixing.
    mount()
    await flush()
    await paste(TS_SCRIPT)
    expect(screen.queryByTestId('import-suggest')).toBe(null)
  })
})


// --------------------------------------------------------------------------- //
// ⭐⭐ ACCEPTING THE OFFERED CALL — the half the ruling described and nothing did
// --------------------------------------------------------------------------- //
//
// `TS_DOC_BLOCKED` has always said the member APPLIES the suggestion: *"they
// accept it, it lands in the script, and the formula read-back shows
// `length = 14, price = close` in their own text."* There was no accepting it.
// The box printed the call and the member retyped it — for this fixture, the same
// call four times across two lines, and then a fifth for its RSI.
//
// ⛔ THE RULING IS UNCHANGED. Nothing is applied without the click, no unpublished
// default is assumed, and the text lands in the textarea the member is looking at
// where they can type over it. What moved is that accepting no longer means
// retyping.
//
// ─── what this block can see, measured against `PineBox.jsx` ─────────────────
//
//   control  unmutated                                  exit 0   25 passed
//   U1       button drops its `refusal.span` condition  exit 1    1 failed
//   U2       the stale-source guard removed             exit 1    1 failed
//   U3       splice by text search instead of by span   exit 1    1 failed
//
// ⚠️ U3 SURVIVED THE FIRST DRAFT AND THE FIXTURE IS WHY. On `05-bollinger-rsi` the
// refusal names the FIRST of four identical calls, so a string search lands in the
// same place a span does and the whole `parseCall`/`endTok`/`span` mechanism looks
// unnecessary. The two-`def` case tells them apart, because resolution order is
// not source order.

const FIVE = readFileSync(path.resolve(process.cwd(), '..',
  'tests/fixtures/thinkscript/05-bollinger-rsi-buy-arrow.ts'), 'utf8')

const PINE_WMA = `//@version=5
indicator("t")
plot(ta.wma(close, 27.5))
`

describe('🔴 the offered call can be ACCEPTED from the box', () => {
  it('the fixture is blocked, carries a span, and its own length is 30', () => {
    // ⛔ NON-VACUITY FIRST. Every case below reads the box after a click; if this
    // script translated on paste, or carried no span, they would pass against a
    // box that renders no button at all.
    const out = translateThinkScript(FIVE)
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('thinkscript:arity')
    expect(Array.isArray(out.refusal.span)).toBe(true)
    expect(FIVE).toMatch(/input\s+BB_Length\s*=\s*30/)
    // ⭐ AND THE FIXTURE REALLY DOES REPEAT THE CALL, which is what makes
    // “replace the one the refusal names” a claim with something to get wrong.
    expect((FIVE.match(/BollingerBands\(/g) || []).length).toBeGreaterThan(1)
  })

  it('⭐⭐ one click lands the call in their script, on THEIR number', async () => {
    mount()
    await paste(FIVE)
    fireEvent.click(screen.getByTestId('import-suggest-apply'))
    await settlePaste()

    const now = pasteField().value
    expect(now).toContain('length = BB_Length')
    // ⚰️ THE DEFECT THIS WHOLE LANE EXISTS AGAINST: the registry's static call
    // says `length = 20`, and this script's input is 30. A member accepting that
    // would get a column that charts and screens and is wrong on every bar.
    expect(now).not.toContain('length = 20')
    // ⭐⭐ EXACTLY ONE OF THE IDENTICAL CALLS MOVED. A text search for the call
    // would have hit the wrong one three times out of four; the span comes from
    // the parser, which already decided which `)` closed which call.
    expect((now.match(/BollingerBands\(price = close/g) || []).length).toBe(1)
  })

  it('⭐⭐ accepting every offer TRANSLATES the script — and on the member’s 30', async () => {
    // ⚠️ “THE REFUSAL MOVED” IS NOT “THE MEMBER GAINED SOMETHING”, so this case
    // clicks until the offers run out and then reads the COLUMN.
    mount()
    await paste(FIVE)
    let clicks = 0
    for (let i = 0; i < 12; i += 1) {
      const btn = screen.queryByTestId('import-suggest-apply')
      if (!btn) break
      fireEvent.click(btn)
      await settlePaste()
      clicks += 1
    }
    expect(clicks).toBeGreaterThan(1)
    expect(screen.queryByTestId('pine-refusal')).toBeNull()

    const out = translateThinkScript(pasteField().value)
    expect(out.ok, JSON.stringify(out.refusal)).toBe(true)
    const formula = out.outputs.map((o) => o.formula || '').join(' ')
    // ⭐⭐ THE ASSERTION THE OLD STATIC SUGGESTION WOULD HAVE FAILED. Same shape,
    // same column count, no refusal — and a 20-bar band on a script that says 30.
    expect(formula).toContain('sma(close, 30)')
    expect(formula).not.toContain('sma(close, 20)')
  })

  it('⭐⭐ it edits the call the refusal NAMES, not the first one that matches', async () => {
    // ⚰️ THE MUTATION THAT SURVIVED THE FIXTURE ABOVE. Replacing the call by
    // SEARCHING for its text passes on `05-bollinger-rsi`, because there the
    // refusal happens to name the first of the four identical calls — so that
    // script cannot tell a span from a string search
    // (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    //
    // ⛔ RESOLUTION ORDER IS NOT SOURCE ORDER. Two `def`s holding the same call
    // are resolved in the order the `plot` USES them, so here the refusal names
    // line 2 while the first textual match is on line 1. A search-and-replace
    // edits the wrong `def`: line 2 keeps refusing, and line 1 — which the member
    // was never told about — silently becomes a different band.
    const TWO_DEFS = `def a = BollingerBands(length = 20).LowerBand;
def b = BollingerBands(length = 20).LowerBand;
plot p = close > b and close < a;
`;
    mount()
    await paste(TWO_DEFS)
    fireEvent.click(screen.getByTestId('import-suggest-apply'))
    await settlePaste()

    const lines = pasteField().value.split(String.fromCharCode(10))
    expect(lines[1]).toContain('price = close')
    expect(lines[0]).toBe('def a = BollingerBands(length = 20).LowerBand;')
  })

  it('⛔⛔ it DECLINES while the box is one keystroke behind', async () => {
    // ⚠️ THE OFFSETS ON SCREEN DESCRIBE THE TEXT THE ENGINE LAST READ, and
    // `report` is debounced by `PINE_DEBOUNCE_MS`. Between a keystroke and the next
    // inspection they are one edit old — and splicing stale offsets into the
    // current text does not fail, it just cuts at the wrong characters and throws
    // away whatever was typed in between.
    mount()
    await paste(FIVE)
    const edited = FIVE + '# a note the member is midway through typing'
    fireEvent.change(pasteField(), { target: { value: edited } })

    // the button is still on screen: the refusal it belongs to has not been
    // recomputed yet, which is exactly the window this guard exists for
    fireEvent.click(screen.getByTestId('import-suggest-apply'))
    expect(pasteField().value).toBe(edited)

    // ⭐ AND IT COMES BACK LIVE ONE DEBOUNCE LATER, so declining is a pause and
    // not a dead button.
    await settlePaste()
    fireEvent.click(screen.getByTestId('import-suggest-apply'))
    await settlePaste()
    expect(pasteField().value).toContain('length = BB_Length')
    expect(pasteField().value).toContain('# a note the member is midway through typing')
  })

  it('⛔ the Pine door shows the offer and NO button — it cannot name the place', async () => {
    // Pine carries `span: null`, so the button is absent rather than guessing at
    // an offset. The OFFER is still there, which is what makes this a test of the
    // button's condition rather than of whether suggestions reach Pine at all.
    mount()
    await paste(PINE_WMA)
    expect(screen.getByTestId('import-suggest')).toBeTruthy()
    expect(screen.queryByTestId('import-suggest-apply')).toBeNull()
  })
})
