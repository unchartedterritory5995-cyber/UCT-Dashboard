// app/src/components/chart/engine/__tests__/e96GetterArithLabels.test.js
//
// ─── ⭐⭐ e96 (2026-11-23) — A LABEL WHOSE TEXT IS ARITHMETIC ON A VALUE READ BACK FROM A DRAWING ─
//
// FOUND BY THE STUDIO, NINE PROBES (`ast/__fixtures__/e96GetterArith/`, our own scripts; its README
// records what the member pane's own path returned on master 037e8d75b6). In the object-program lane,
// inside `if barstate.islast`:
//
//   DRAWN     `str.tostring(line.get_y2(ln))`, `str.tostring(line.get_y1(ln))`, a local set from ONE
//             getter, and the same script with no getter (`close - lo`, "$8.06");
//   NOT DRAWN `line.get_y2(ln) - line.get_y1(ln)` inline or through a local, `line.get_y2(ln) - 1.0`,
//             `line.get_y2(ln) + line.get_y2(ln)` — with `errors: {}` and nothing named anywhere. The
//             line itself was drawn, so the chart showed a line beside a missing label.
//
// ROOT CAUSE (`ast/pine.js`). The text reader took object state only WHOLE (`stateOperand`); anything
// else fell to `canonicalOf`, which answers `null` on a getter and records no refusal, so the create
// dropped as "no refusal recorded". Through a local, the getter-fed scalar reader admitted only a bare
// getter write (`objectFnInline.js::getterScalars`), so `rise` resolved to `pine:drawing`'s "answers
// with no number" — false of a getter.
//
// THE RULE: a script draws the right value or refuses BY NAME, never neither. So, below:
//   A  every probe through the MEMBER'S OWN ROUTE (`memberPaneDefinition` → `objectReaderFor` →
//      `evaluateObjects` → `toRenderState`), graded BY VALUE against the bars it ran on;
//   B  a local set from getter arithmetic is written WHERE IT STANDS (a later setter does not move it);
//   C  each shape this lane still does not compute is refused BY NAME, with a sentence that is true;
//   D  CORPUS CLASS: `e96TextDropCorpus.test.js` (its own file: it translates the committed corpus);
//   E  the document validator admits exactly the scalar arithmetic the converter builds.
import { describe, it, expect, vi, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'
import * as nativeRegistry from '../nativeRegistry'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../runtimeKill'
import { translatePine } from '../ast/pine'
import { assertObjectProgram, isGetterArith } from '../ast/objectProgram'
import { assessObjectLoss, objectLossNote, textDropsSentence, TEXT_DROPS_KEPT } from '../ast/objectLoss'
import { recipeBars, recipeContext } from '../../supportLoop/assistantRecipes'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
// ⭐ The objects-only pane, as a member's build carries it: these probes plot nothing.
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')

const LF = String.fromCharCode(10)
const FIX = path.resolve(process.cwd(), 'src/components/chart/engine/ast/__fixtures__/e96GetterArith')
const PROBE = Object.fromEntries(fs.readdirSync(FIX).filter((f) => f.endsWith('.pine'))
  .map((f) => [f.slice(0, 2), fs.readFileSync(path.join(FIX, f), 'utf8').replace(/\r\n/g, LF)]))

// The bars the studio's lane ran on (`tools/value_cases/script_lane.mjs`): the engine's own built daily chart.
const BARS = recipeBars('daily')
const CTX = recipeContext('daily', 'fromListing')
const N = BARS.length
const CLOSE = BARS[N - 1].c
const LOW5 = BARS[N - 6].l
const LOW60 = Math.min(...BARS.slice(N - 60).map((b) => b.l))
/** `"#.00"` by its own rule, independently of the engine's formatter: two decimals, half away from zero. */
const fmt2 = (x) => (Math.sign(x) * Math.round(Math.abs(x) * 100) / 100).toFixed(2)

let seq = 0
/** The member's route, end to end, with no layer mocked: what the chart draws. */
function drawn(source) {
  const pane = memberPaneDefinition({ source, id: `u_e96_${seq += 1}`, name: 'probe' })
  if (!pane.ok) return { pane, labels: null, lines: null }
  const reader = objectReaderFor(pane.definition, BARS, { inputs: undefined, tf: CTX.tf, symbol: CTX.symbol })
  if (!reader) return { pane, labels: null, lines: null }
  const run = evaluateObjects(reader.program, {
    barCount: N, readNode: reader.readNode, readUnknown: reader.readUnknown, readTime: (i) => BARS[i].t,
  })
  const state = toRenderState(run.live, { bars: BARS })
  return { pane, labels: (state.labels || []).map((l) => String(l.text)), lines: state.lines || [] }
}
const diag = (src) => translatePine(src, { strict: true }).objectDiagnostics || {}

/** A probe-shaped script: one line read back, and a label whose text is `text`. */
const withText = (text, ...before) => [
  '//@version=5', 'indicator("t", overlay=true)', 'var line ln = na', 'var label lb = na', 'if barstate.islast',
  '    line.delete(ln)', '    label.delete(lb)', '    ln := line.new(bar_index - 5, low[5], bar_index, close)',
  ...before.map((l) => `    ${l}`), `    lb := label.new(bar_index, close, ${text})`,
].join(LF) + LF

describe('A — every probe, graded by value on the member\'s own route', () => {
  // [probe, the text it must draw, computed from the bars it ran on]
  const EXPECT = [
    ['01', fmt2(CLOSE)], ['02', fmt2(LOW5)], ['03', fmt2(CLOSE)], ['04', fmt2(CLOSE - LOW5)],
    ['05', fmt2(CLOSE - LOW5)], ['06', `$${fmt2(CLOSE - LOW5)}`], ['07', fmt2(CLOSE - 1.0)], ['08', fmt2(CLOSE + CLOSE)],
    ['10', `$${fmt2(CLOSE - LOW60)}`], ['11', `$${fmt2(CLOSE - LOW60)}`],
  ]
  for (const [id, text] of EXPECT) {
    it(`probe ${id} draws its line and the label "${text}"`, () => {
      const got = drawn(PROBE[id])
      expect(got.pane.ok, `${id}: ${got.pane.reason}`).toBe(true)
      expect(got.lines.length, id).toBe(1)
      expect(got.labels, id).toEqual([text])
    })
  }

  it('the values the studio recorded for the controls are the values here (README, master 037e8d75b6)', () => {
    expect(fmt2(CLOSE)).toBe('113.09')
    expect(fmt2(LOW5)).toBe('111.49')
    expect(fmt2(CLOSE - LOW5)).toBe('1.60')
    expect(`$${fmt2(CLOSE - LOW60)}`).toBe('$8.06')
  })

  it('⛔ the four that drew nothing now carry nothing lost: no drop, no refusal, a clean program', () => {
    for (const id of ['05', '06', '07', '08', '10']) {
      const d = diag(PROBE[id])
      expect(d.droppedOps, id).toBe(0)
      expect(d.textDrops, id).toBeUndefined()
      expect(d.createDropWhy, id).toBeUndefined()
    }
  })

  it('the arithmetic rides the object runtime\'s own value operators, formatted by the one formatter', () => {
    const t = translatePine(PROBE['05'], { strict: true })
    const text = t.objects.ops.find((o) => o.k === 'create' && o.family === 'label').props.text
    expect(text).toEqual({ v: 'text', node: { t: 'val', fmt: '#.00', v: {
      v: 'op', op: '-', args: [{ v: 'get', target: { r: 'reg', id: 'r0' }, prop: 'y2' }, { v: 'get', target: { r: 'reg', id: 'r0' }, prop: 'y1' }],
    } } })
    // through a local: a getter-fed scalar written by `setnum` where the local stands, read whole
    const six = translatePine(PROBE['06'], { strict: true }).objects
    const setnum = six.ops.find((o) => o.k === 'setnum')
    expect(setnum.value).toEqual({ v: 'op', op: '-', args: [
      { v: 'get', target: { r: 'reg', id: 'r0' }, prop: 'y2' }, { v: 'get', target: { r: 'reg', id: 'r0' }, prop: 'y1' }] })
    expect(() => assertObjectProgram(six)).not.toThrow()
  })

  describe('probe 09 — the same subtraction PLOTTED (the bar-by-bar lane), unchanged', () => {
    const RUNTIME_FLAG = flagOf('src/components/chart/engine/runtimePaneGate.js')
    // ⛔ back to the member's object-program route for every case after this one
    afterAll(() => { __resetRuntimePanePermission(); __resetRuntimeAllowList(); vi.stubEnv(RUNTIME_FLAG, '0') })
    it('is 15.5 on every bar', () => {
      vi.stubEnv(RUNTIME_FLAG, '1')
      __permitRuntimePaneForTests()
      __allowEveryRuntimeScriptForTests()
      const pane = memberPaneDefinition({ source: PROBE['09'], id: 'u_e96_09', name: 'probe 09' })
      expect(pane.ok, pane.reason).toBe(true)
      const cols = nativeRegistry.computeFor(pane.definition, BARS, undefined, CTX)
      expect(nativeRegistry.columnErrors(cols) || {}).toEqual({})
      const key = Object.keys(cols).find((k) => !k.startsWith('__'))
      const values = Array.from(cols[key])
      expect(values.length).toBe(N)
      expect(values.every((v) => v === 15.5)).toBe(true)
    }, 120_000)
  })
})

describe('B — a local is written where it stands: a later setter does not move what it held', () => {
  it('`rise` keeps the line\'s rise before `line.set_y2`; the inline read after it sees the move', () => {
    const src = withText('str.tostring(rise, "#.00") + " / " + str.tostring(line.get_y2(ln) - line.get_y1(ln), "#.00")',
      'float rise = line.get_y2(ln) - line.get_y1(ln)', 'line.set_y2(ln, close + 10)')
    const got = drawn(src)
    expect(got.pane.ok, got.pane.reason).toBe(true)
    expect(got.labels).toEqual([`${fmt2(CLOSE - LOW5)} / ${fmt2(CLOSE + 10 - LOW5)}`])
  })

  it('`*`, `/` and a unary minus are the same operators, in a local and inline', () => {
    const src = withText('str.tostring(half, "#.00") + " " + str.tostring(-(line.get_y2(ln) * 2) / 4, "#.00")',
      'float half = (line.get_y2(ln) - line.get_y1(ln)) / 2')
    expect(drawn(src).labels).toEqual([`${fmt2((CLOSE - LOW5) / 2)} ${fmt2(-(CLOSE * 2) / 4)}`])
  })
})

describe('C — what this lane still does not compute is refused BY NAME, with a true sentence', () => {
  const READ_BACK = "a value read back from the chart's drawings"
  const CASES = {
    'a call over the arithmetic': withText('str.tostring(math.abs(line.get_y2(ln) - line.get_y1(ln)), "#.00")'),
    'a local that mixes in a series': withText('"$" + str.tostring(rise, "#.00")', 'float rise = line.get_y2(ln) - low'),
    'a format this lane does not render for a read-back value': withText('str.tostring(line.get_y2(ln), format.mintick)'),
  }
  /** The 1-based line of the script's `label.new`. */
  const labelLine = (src) => src.split(LF).findIndex((l) => l.includes('label.new(')) + 1
  for (const [what, src] of Object.entries(CASES)) {
    it(`${what}: the label is not drawn, and says so`, () => {
      const d = diag(src)
      const line = labelLine(src)
      expect(d.dropReasons['create:label'], what).toBe(1)
      expect(d.textDrops, what).toHaveLength(1)
      const [td] = d.textDrops
      expect(td).toMatchObject({ family: 'label', slot: 'text', line, guard: 'pine:text-value' })
      expect(td.sentence).toContain(READ_BACK)
      expect(td.sentence).toContain('line.get_y2')
      // ⛔ never the silent shape, and never `pine:drawing`'s "answers with no number" (false of a getter)
      for (const w of d.createDropWhy) {
        expect(w).not.toContain('no refusal recorded')
        expect(w).not.toContain('answers with no number')
      }
      // the member's drawing note names the label, where it is and why
      const note = objectLossNote(assessObjectLoss(translatePine(src, { strict: true })))
      expect(note.note).toContain(`A label whose text is written at line ${line} is not drawn because that text cannot be computed here: this text (\``)
      expect(note.note).toContain(READ_BACK)
      // and the chart draws the line and no label: the rest of the script stands
      const got = drawn(src)
      expect(got.lines.length, what).toBe(1)
      expect(got.labels, what).toEqual([])
    })
  }

  it('the sentence names the local it reads, and states what IS computed', () => {
    const [td] = diag(CASES['a local that mixes in a series']).textDrops
    expect(td.sentence).toContain('this text (`"$" + str.tostring(rise, "#.00")`) reads `line.get_y2` (through `rise`)')
    expect(td.sentence).toContain("in a drawing's own text (a label's or a box's, not a table cell's)")
    expect(td.sentence).toContain('`+`, `-`, `*` or `/`')
  })

  it('a table cell that reads a drawing back is refused by name (a cell never reads object state)', () => {
    const src = ['//@version=5', 'indicator("t", overlay=true)', 'var line ln = na',
      'var table t = table.new(position.top_right, 2, 2)', 'if barstate.islast', '    line.delete(ln)',
      '    ln := line.new(bar_index - 5, low[5], bar_index, close)',
      '    table.cell(t, 0, 0, str.tostring(line.get_y2(ln) - line.get_y1(ln), "#.00"))'].join(LF) + LF
    const d = diag(src)
    expect(d.dropReasons['cell:text']).toBe(1)
    expect(d.textDrops).toEqual([expect.objectContaining({ family: 'table', slot: 'text', line: 8, guard: 'pine:text-value' })])
    expect(d.cellTextWhy).toEqual([expect.stringContaining(READ_BACK)])
  })

  it('a setter\'s text is refused by name too: the label it writes is withheld, and that says why', () => {
    const src = withText('"x"') + '    label.set_text(lb, str.tostring(math.abs(line.get_y2(ln) - 1), "#.00"))' + LF
    const d = diag(src)
    expect(d.dropReasons['update:props']).toBe(1)
    expect(d.textDrops).toEqual([expect.objectContaining({ family: 'label', slot: 'text', guard: 'pine:text-value' })])
    expect(d.textDrops[0].sentence).toContain(READ_BACK)
  })

  it('CONTROL: the note\'s sentence is the first drop\'s, the rest counted, a full list said as a floor', () => {
    const one = { family: 'box', line: 3, guard: 'pine:x', sentence: 'why one.' }
    expect(textDropsSentence([one])).toBe('A box whose text is written at line 3 is not drawn because that text cannot be computed here: why one.')
    expect(textDropsSentence([one, { ...one, line: 4 }, { ...one, line: 5 }]))
      .toContain('The text of 2 more drawings cannot be computed here either, so they are not drawn.')
    const full = Array.from({ length: TEXT_DROPS_KEPT }, (_, i) => ({ ...one, line: i }))
    expect(textDropsSentence(full)).toContain(`The text of at least ${TEXT_DROPS_KEPT - 1} more drawings`)
    expect(textDropsSentence([])).toBeNull()
  })
})

describe('E — the validator admits exactly the scalar arithmetic the converter builds', () => {
  const get = (prop) => ({ v: 'get', target: { r: 'reg', id: 'r0' }, prop })
  it('getters and numbers under the value operators, at least one getter', () => {
    expect(isGetterArith({ v: 'op', op: '-', args: [get('y2'), get('y1')] })).toBe(true)
    expect(isGetterArith({ v: 'op', op: '*', args: [{ v: 'op', op: '-', args: [get('y2')] }, { v: 'const', value: 2 }] })).toBe(true)
    expect(isGetterArith({ v: 'op', op: '+', args: [{ v: 'const', value: 1 }, { v: 'const', value: 2 }] })).toBe(false)
    expect(isGetterArith({ v: 'op', op: '-', args: [get('y2'), { v: 'tree', tree: 0 }] })).toBe(false)
    expect(isGetterArith({ v: 'op', op: '-', args: [get('y2'), { v: 'num', id: 'n0' }] })).toBe(false)
    expect(isGetterArith({ v: 'op', op: '-', args: [{ ...get('y2'), back: 1 }, get('y1')] })).toBe(false)
    expect(isGetterArith({ v: 'op', op: 'trunc', args: [get('y2')] })).toBe(false)
    expect(isGetterArith(get('y2'))).toBe(false)                     // a bare getter is the other admitted shape
  })
  it('a stored program whose scalar is written from anything wider is refused', () => {
    const prog = translatePine(PROBE['06'], { strict: true }).objects
    const forged = JSON.parse(JSON.stringify(prog))
    forged.ops.find((o) => o.k === 'setnum').value.args[1] = { v: 'graph', node: 0 }
    expect(() => assertObjectProgram(forged)).toThrow(/bad setnum/)
  })
})
