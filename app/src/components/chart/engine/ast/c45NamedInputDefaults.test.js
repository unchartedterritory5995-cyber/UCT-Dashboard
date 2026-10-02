// app/src/components/chart/engine/ast/c45NamedInputDefaults.test.js
//
// ─── ⭐⭐ C45 — AN INPUT'S DEFAULT IS ITS `defval`, WHEREVER THE SCRIPT WROTE IT ──
//
// ⚰️ `pine.js::inputColourDefaultNode` read `args[0]` whatever that argument was
// NAMED. `input.color(title = "Table Color: ", defval = color.rgb(0, 175, 200, 20))`
// (atr-bands, door-attached) therefore answered the TITLE string as the colour:
// nothing folded, and the pane drew its own default where TradingView draws the
// author's colour. A wrong default is a wrong VALUE on a member's chart.
//
// The oracle is the script itself: Pine lets `defval` be named or first
// positional, so the SAME declaration written three ways must build the SAME
// document. The positional spelling is the one every capture witnesses
// (contraction-box, makuchaku, cc-yata — C23 / C37), so it is the reference.
//
// ⛔ Every input kind is asked, not only `input.color`: the other readers
// (`resolveInput`, `stringValueOf`, `inputDefaultNode`) already read the name,
// and this file is what keeps them reading it.

import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { inputColourDefaultNode } from './pine'

afterEach(() => { vi.unstubAllEnvs() })

const HEAD = '//@version=5\nindicator("t", overlay=true)\n'
const build = (source) => memberPaneDefinition({ source, id: 'u_member-pane-c45inputs', name: 'c45' })
const doc = (d) => JSON.stringify({
  plots: d.definition && d.definition.plots,
  compute: d.definition && d.definition.compute,
  inputs: d.definition && d.definition.inputs,
  objects: d.definition && d.definition.objects,
})

/** kind → [use site, positional, `defval, title`, `title, defval`] */
const KINDS = {
  color: ['plot(close, color = c)', 'input.color(color.red, "C")', 'input.color(defval = color.red, title = "C")', 'input.color(title = "C", defval = color.red)'],
  int: ['plot(ta.sma(close, c))', 'input.int(7, "C")', 'input.int(defval = 7, title = "C")', 'input.int(title = "C", defval = 7)'],
  float: ['plot(close * c)', 'input.float(1.5, "C")', 'input.float(defval = 1.5, title = "C")', 'input.float(title = "C", defval = 1.5)'],
  bool: ['plot(c ? close : open)', 'input.bool(true, "C")', 'input.bool(defval = true, title = "C")', 'input.bool(title = "C", defval = true)'],
  string: ['plot(c == "hi" ? close : open)', 'input.string("hi", "C")', 'input.string(defval = "hi", title = "C")', 'input.string(title = "C", defval = "hi")'],
  source: ['plot(ta.sma(c, 5))', 'input.source(hl2, "C")', 'input.source(defval = hl2, title = "C")', 'input.source(title = "C", defval = hl2)'],
  timeframe: ['plot(request.security(syminfo.tickerid, c, close))', 'input.timeframe("W", "C")', 'input.timeframe(defval = "W", title = "C")', 'input.timeframe(title = "C", defval = "W")'],
  'v4 input()': ['plot(close, color = c)', 'input(color.red, "C")', 'input(defval = color.red, title = "C")', 'input(title = "C", defval = color.red)'],
}

describe('C45 — a named `defval` is the default in any argument order, for every input kind', () => {
  for (const [kind, [use, positional, defvalFirst, titleFirst]] of Object.entries(KINDS)) {
    it(`${kind}: \`${titleFirst}\` builds the document \`${positional}\` builds`, () => {
      const ref = build(`${HEAD}c = ${positional}\n${use}\n`)
      expect(ref.ok, ref.reason).toBe(true)
      for (const decl of [defvalFirst, titleFirst]) {
        const d = build(`${HEAD}c = ${decl}\n${use}\n`)
        expect(d.ok, `${decl}: ${d.reason}`).toBe(true)
        expect(doc(d), decl).toBe(doc(ref))
      }
    }, 60000)
  }

  it('⭐ the colour a member sees: red, not the pane\'s own gold (the value drawn before C45)', () => {
    const d = build(`${HEAD}c = input.color(title = "C", defval = color.red)\nplot(close, color = c)\n`)
    expect(d.ok, d.reason).toBe(true)
    const colour = d.definition.inputs.find((i) => i.key === 'color')
    expect(colour.default).toBe('#FF5252')
    expect(colour.default).not.toBe('#c9a84c')
  })

  it('control: a DIFFERENT default builds a different document (the comparison can fail)', () => {
    const a = build(`${HEAD}c = input.color(title = "C", defval = color.red)\nplot(close, color = c)\n`)
    const b = build(`${HEAD}c = input.color(title = "C", defval = color.blue)\nplot(close, color = c)\n`)
    expect(doc(a)).not.toBe(doc(b))
  })

  it('the reader itself: named beats position; a first argument NAMED something else is not the default', () => {
    const arg = (name, value) => ({ ...(name ? { name } : {}), value })
    const call = (...args) => ({ type: 'call', name: 'input.color', args })
    expect(inputColourDefaultNode(call(arg(null, 'POS'), arg('title', 'T')))).toBe('POS')
    expect(inputColourDefaultNode(call(arg('title', 'T'), arg('defval', 'DEF')))).toBe('DEF')
    expect(inputColourDefaultNode(call(arg('defval', 'DEF'), arg('title', 'T')))).toBe('DEF')
    // no default at all: unknown, never the title
    expect(inputColourDefaultNode(call(arg('title', 'T'), arg('group', 'G')))).toBeUndefined()
    expect(inputColourDefaultNode(call())).toBeUndefined()
    expect(inputColourDefaultNode(null)).toBeUndefined()
  })
})

// ─── atr-bands — the corpus script the defect was found on ────────────────────
describe('C45 — atr-bands (door-attached): its `input.color(title = …, defval = …)` colours are carried', () => {
  const file = path.resolve(process.cwd(), '..', 'corpus/committed/atr-bands__ad60b125e6.pine')
  const source = fs.readFileSync(file, 'utf8')
  /** `input.color(title="T", defval=X, …)` → `input.color(X, "T", …)`: the same
   *  declaration in the positional spelling the captures witness. */
  const positional = source.replace(
    /input\.color\(title=("[^"]*"), defval=(color\.rgb\([^)]*\))/g,
    (_, title, defval) => `input.color(${defval}, ${title}`,
  )
  const programOf = (src) => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const d = build(src)
    expect(d.ok, d.reason).toBe(true)
    return d
  }

  it('control: the rewrite changed every declaration (five live, one commented out)', () => {
    expect(source.match(/input\.color\(title=/g).length).toBe(6)
    expect(positional.match(/input\.color\(title=/g)).toBeNull()
    expect(positional).not.toBe(source)
  })

  it('⭐ as written, it builds the document its positional spelling builds', () => {
    expect(doc(programOf(source))).toBe(doc(programOf(positional)))
  }, 120000)

  it('⭐ and the table\'s colours are the author\'s — not a default', () => {
    const d = programOf(source)
    const text = JSON.stringify(d.definition.objects).toLowerCase()
    // `tableColor = color.rgb(0, 175, 200, 20)`
    expect(text).toContain('#00afc8')
    // `tableLongBGColor = color.rgb(0, 255, 0, 90)`, `tableShortBGColor = color.rgb(255, 0, 0, 80)`
    expect(text).toContain('#00ff00')
    expect(text).toContain('#ff0000')
  }, 120000)
})
