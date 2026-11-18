// The shared which-widget guard (widget.setOption / widget.sendToJournal resolveArgs), as a unit: Lead 2026-11-10 — FAIL CLOSED
// (no words → an ambiguous widget is asked), a name in the words → that widget, one of its type → never asked, an approved
// proposal → never asked again (it exists only because the guard already ran on its request). LOCAL, vitest (node).
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'

registerBuiltins()
const W = (id, x, opts = {}) => ({ id, type: 'optionsflow', x, y: 0, w: 12, h: 14, color: 'N', opts })
const host = (widgets) => ({ widgets: { snapshot: () => ({ raw: widgets, visible: widgets.map(w => ({ id: w.id, type: w.type })), groupSyms: { N: 'AAA' } }) } })
const TWO = host([W('a', 0), W('b', 12)])
const args = { widget: 'a', key: 'printType', value: 'Sweep' }

describe.each(['widget.setOption', 'widget.sendToJournal'])('%s: which widget', (name) => {
  const r = (h, words, how) => getCapability(name).resolveArgs(name === 'widget.setOption' ? args : { widget: 'a', where: 'note' }, h, words, how)
  it('no words at all (a path that passes none): FAIL CLOSED — asked, with both', () => {
    for (const words of [null, undefined, '']) {
      const out = r(TWO, words)
      expect(out?.ask?.choices?.map(c => c.ref), String(words)).toEqual(['a', 'b'])
    }
  })
  it('words that name none: asked', () => expect(r(TWO, 'only sweeps in the options flow')?.ask?.text).toMatch(/Which Options Flow/))
  it('words that name the planned one: no question', () => expect(r(TWO, 'only sweeps in the left options flow')).toBe(null))
  it('words that name the OTHER one: re-aimed at it, not the planner\'s pick', () => expect(r(TWO, 'only sweeps on the right options flow')?.args?.widget).toBe('b'))
  it('one widget of its type: never asked', () => expect(r(host([W('a', 0)]), null)).toBe(null))
  it('an approved proposal: never asked again', () => expect(r(TWO, 'yes', { approved: true })).toBe(null))
})
