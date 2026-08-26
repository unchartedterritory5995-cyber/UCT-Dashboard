// ⭐ COMPLETIONS ARE A DERIVED VIEW OF THE MANIFEST. The source is exercised
// through CodeMirror's own `CompletionContext` with no view mounted, so a case
// here is about WHAT is offered, never about a popup.
//
// ⛔ AND NOTHING BELOW PINS A COUNT OR A SECTION LIST. The closed table is moving
// under this lane right now (W2a: `tableVersion` 1 → 2, a new `clock` section),
// and a case that summed three named sections would go red on their commit while
// describing nothing that had broken. Every size here is pinned against another
// artifact that derives the same answer a different way.
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import { TABLE, KEY_RE } from '../../engine/ast/parse'
import { declaredInputs } from '../../engine/ast/lint'
import { prepareSource } from '../../engine/ast/letPrepass'
import { FORMULA_VOCAB } from './languages'
import { formulaCompletionSource, tableOptions, inputOptions, letNames, letBindings } from './completions'

async function complete(doc, { inputs, explicit = false, pos = doc.length } = {}) {
  const state = EditorState.create({ doc })
  return formulaCompletionSource({ inputs })(new CompletionContext(state, pos, explicit))
}
const labels = (res) => (res ? res.options.map((o) => o.label) : [])

/** Is this a name the manifest declares ANYWHERE? Walks the sections the way the
 *  manifest shapes them (`_`-prefixed keys are notes) rather than naming three. */
function inTable(label) {
  for (const [section, entries] of Object.entries(TABLE)) {
    if (section.startsWith('_') || !entries || typeof entries !== 'object') continue
    if (Object.prototype.hasOwnProperty.call(entries, label)) return true
  }
  return false
}

describe('the table half', () => {
  it('for `s` offers sma and stdev — and nothing the table does not declare', async () => {
    const got = labels(await complete('s'))
    expect(got).toContain('sma')
    expect(got).toContain('stdev')
    expect(got).not.toContain('nosuchfn')
    for (const label of got) expect(inTable(label), `${label} is not in the table`).toBe(true)
    // every one of them really does start with what was typed
    for (const label of got) expect(label.toLowerCase().startsWith('s'), label).toBe(true)
  })

  it('a function carries its arity/lookback as detail and the manifest sentence as info', async () => {
    const sma = (await complete('sm')).options.find((o) => o.label === 'sma')
    const entry = TABLE.functions.sma
    expect(sma.type).toBe('function')
    expect(sma.detail).toBe(`(${entry.argRoles.join(', ')}) · lookback ${entry.lookback}`)
    // ⭐ `{0}`/`{1}` ARE THE MANIFEST'S OWN ARGUMENT POSITIONS and they are filled
    // with the manifest's own role names. Pinned as a PROPERTY rather than as the
    // rendered sentence: a literal here would be a hand copy of a string W2a owns,
    // and would red on a rewording that broke nothing.
    expect(entry.sentence, 'sma declares no positional sentence — this case measured nothing').toMatch(/\{\d+\}/)
    expect(sma.info).not.toMatch(/\{\d+\}/)
    for (const role of entry.argRoles) expect(sma.info, role).toContain(role)
  })

  it('⛔ no offered sentence keeps an unfilled position — swept over the whole table', async () => {
    let positional = 0
    for (const option of tableOptions(TABLE)) {
      if (typeof option.info !== 'string') continue
      expect(option.info, option.label).not.toMatch(/\{\d+\}/)
    }
    for (const entry of Object.values(TABLE.functions)) {
      if (typeof entry.sentence === 'string' && /\{\d+\}/.test(entry.sentence)) positional += 1
    }
    expect(positional, 'no manifest sentence carries a position — the sweep proved nothing').toBeGreaterThan(0)
  })

  it('a series and a scalar carry their own kind', async () => {
    const close = (await complete('c')).options.find((o) => o.label === 'close')
    expect(close).toMatchObject({ type: 'variable', detail: 'series', info: TABLE.series.close.doc })
    const cap = (await complete('market')).options.find((o) => o.label === 'market_cap')
    expect(cap).toMatchObject({
      type: 'property', detail: `scalar · ${TABLE.scalars.market_cap.cadence}`, info: TABLE.scalars.market_cap.sentence,
    })
  })

  it('⛔ the option set IS the editor vocabulary — the same names it COLOURS, pinned both ways', () => {
    // ⭐ THE ORACLE IS THE TOKENIZER, which derives the same answer from the same
    // manifest by a different route. Offering a name the editor paints as an error
    // — or painting one it offers — is the defect this pins, and a section the
    // manifest gains lands on BOTH sides at once, so neither goes stale.
    const offered = tableOptions(TABLE).map((o) => o.label).sort()
    const coloured = [...new Set([
      ...FORMULA_VOCAB.functions, ...FORMULA_VOCAB.series, ...FORMULA_VOCAB.clock, ...FORMULA_VOCAB.scalars,
    ])].sort()
    expect(offered).toEqual(coloured)
    expect(offered.length, 'the manifest declares no names at all').toBeGreaterThan(0)
    // ⛔ AND THE OPERATOR SECTION IS NOT IN IT: `&&` is a name nobody types as a
    // word, and a completion list is a list of NAMES.
    expect(Object.keys(TABLE.operators).length).toBeGreaterThan(0)
    for (const op of Object.keys(TABLE.operators)) expect(offered).not.toContain(op)
    for (const label of offered) expect(KEY_RE.test(label), label).toBe(true)
  })

  it('⛔ a v2 function declares a `cadence` TOO — and is still a call, not a fundamental', () => {
    // The closed-table v2 contract: *"Every entry carries `yields`, `lookback`,
    // `sentence`, and (functions) `cadence`"*. Nothing declares both YET, so this
    // plants the shape that is coming: read `cadence` before `args` and all fifty
    // calls silently become `scalar · nightly`, with no refusal anywhere to say so.
    expect(Object.values(TABLE.functions).filter((e) => e.cadence !== undefined).length,
      'a function already declares cadence — this case is now measuring the real thing, not a plant').toBe(0)
    const planted = tableOptions({
      ...TABLE,
      functions: { ...TABLE.functions, sma: { ...TABLE.functions.sma, cadence: 'nightly' } },
    })
    const sma = planted.find((o) => o.label === 'sma')
    expect(sma.type).toBe('function')
    expect(sma.detail).toBe(`(${TABLE.functions.sma.argRoles.join(', ')}) · lookback ${TABLE.functions.sma.lookback}`)
  })

  it('⭐ a section the manifest gains later is offered the day it lands — read by shape, never typed', () => {
    const planted = tableOptions({
      ...TABLE,
      clock: { ...(TABLE.clock || {}), nosuchclock: { lookback: 0, yields: 'num', sentence: 'a planted clock read' } },
    })
    const it0 = planted.find((o) => o.label === 'nosuchclock')
    expect(it0).toMatchObject({ type: 'variable', detail: 'clock', info: 'a planted clock read' })
    // CONTROL: the same name, the same function, without the perturbation.
    expect(tableOptions(TABLE).find((o) => o.label === 'nosuchclock')).toBeUndefined()
  })
})

describe('the member half', () => {
  it('a declared input appears; the same name undeclared does not', async () => {
    const scope = declaredInputs({ inputs: [{ key: 'period', type: 'int', default: 14 }] })
    expect(labels(await complete('per', { inputs: scope }))).toContain('period')
    expect(labels(await complete('per'))).not.toContain('period')
    const period = (await complete('per', { inputs: scope })).options.find((o) => o.label === 'period')
    expect(period).toMatchObject({ type: 'variable', detail: 'input' })
    expect(inputOptions(undefined)).toEqual([])
  })

  it('a `let` name found in the buffer is offered, with its kind', async () => {
    const doc = 'let fast = sma(close, 10)\nlet slow = sma(close, 30)\nfa'
    expect(letNames(doc)).toEqual(['fast', 'slow'])
    const fast = (await complete(doc)).options.find((o) => o.label === 'fast')
    expect(fast).toMatchObject({ type: 'variable', detail: 'let' })
    expect(labels(await complete(doc))).not.toContain('slow')
  })

  it('⛔ the `let` names come from letPrepass — the ONE module that owns the grammar', () => {
    const doc = 'let fast = sma(close, 10)\nlet slow = fast * 2\nslow'
    // The authority's own answer, taken a different way.
    expect(prepareSource(doc).bindings.map((b) => b.name)).toEqual(letNames(doc))
    expect(letBindings(doc)).toEqual([{ name: 'fast', line: 1 }, { name: 'slow', line: 2 }])
    // ⛔ A NAME THE GRAMMAR REFUSES IS NOT A BINDING. `close` is a closed-table
    // name, so `let close = …` is `let:shadow` — a regex scanning for `^\s*let\s+(\w+)`
    // would offer it and the editor would then paint the very line that refuses.
    expect(prepareSource('let close = high\nclose').guard).toBe('let:shadow')
    expect(letNames('let close = high\nclose')).toEqual([])
  })

  it('⭐ a buffer still being typed keeps its bindings — the expression line is not there YET', () => {
    // The commonest mid-type state: the bindings are written, the expression is not.
    // `prepareSource` refuses that source ("the last line must be the expression"),
    // which is the right answer for a SAVE and the wrong one for a caret. The retry
    // supplies the missing expression and asks the SAME grammar again — it never
    // second-guesses what binds.
    expect(prepareSource('let fast = sma(close, 10)\n').ok).toBe(false)
    expect(letNames('let fast = sma(close, 10)\n')).toEqual(['fast'])
    expect(letNames('let fast = sma(close, 10)\nlet slow = fa')).toEqual(['fast', 'slow'])
    // …and a genuinely malformed `let` still binds nothing, rather than the retry
    // inventing a name out of half a line.
    expect(letNames('let fast')).toEqual([])
    expect(letNames('let 1bad = 2\nclose')).toEqual([])
  })

  it('⛔ a binding does not complete ITSELF on the line that declares it', async () => {
    const doc = 'let fast = sma(close, 10)\nlet slow = fa'
    // caret at the end of line 2, inside `let slow = fa` — `fast` is in scope here,
    // `slow` is not (the grammar refuses a binding bound to itself).
    const got = labels(await complete(doc))
    expect(got).toContain('fast')
    expect(got).not.toContain('slow')
    // and on its OWN name, the same binding is still not offered
    const onName = labels(await complete('let fast = sma(close, 10)\nclose', { pos: 8 }))
    expect(onName).not.toContain('fast')
  })

  it('nothing is offered with no word under the caret unless asked explicitly', async () => {
    expect(await complete('sma(close, ')).toBe(null)
    expect(labels(await complete('sma(close, ', { explicit: true }))).toContain('close')
  })

  it('the three sources land in ONE list and each keeps its own kind', async () => {
    const scope = declaredInputs({ inputs: [{ key: 'span', type: 'int', default: 14 }] })
    const doc = 'let sTop = high\nsm'
    const res = await complete(doc, { inputs: scope, pos: doc.length })
    const kinds = Object.fromEntries(res.options.map((o) => [o.label, o.detail]))
    expect(kinds.sma).toBe(`(${TABLE.functions.sma.argRoles.join(', ')}) · lookback ${TABLE.functions.sma.lookback}`)
    const all = await complete('let sTop = high\ns', { inputs: scope, pos: 'let sTop = high\ns'.length })
    const byLabel = Object.fromEntries(all.options.map((o) => [o.label, o.detail]))
    expect(byLabel.sma).toBeTypeOf('string')
    expect(byLabel.span).toBe('input')
    expect(byLabel.sTop).toBe('let')
    expect(all.from).toBe('let sTop = high\n'.length)
    expect(all.validFor.test('close')).toBe(true)
    expect(all.validFor.test('close(')).toBe(false)
  })
})
