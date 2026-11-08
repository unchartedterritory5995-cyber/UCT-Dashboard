// app/src/components/chart/engine/ast/objectFieldCreate.test.js
//
// ⭐⭐ A DRAWING CREATED STRAIGHT INTO A LIST THE OBJECT PROGRAM DOES NOT HOLD —
// `k._box.unshift(box.new(…))`, `array.push(k._box, …)`, `.insert`, `.set` on a
// user type's FIELD.
//
// ⚰️ Every such statement fell through each reader with no op and no count: the
// objects were missing and the member was told nothing (silent drop).
//
// THE RULING (coordinator, 2026-11-08): no silent drops. Where the program cannot
// hold the list, the create is WITHHELD BY NAME with a count (`box.new` in
// `unsupported`, one `content:lost` each) and the rest of the script keeps
// serving — never a whole-script refusal. A create that ALSO lands in a register
// the program holds (`b = box.new(…)`, then `k._box.push(b)`) is executable
// exactly and is served.
//
// Why not serve the field create as a bare create: Pine does draw it at
// `box.new`, but its only handle is in the field, so every later step on it
// (setter, `pop().delete()`, `box.delete(k._box.get(0))`) is unaddressable here —
// a served create would stay on screen where TradingView moves or removes it.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { translatePine } from './pine'
import { assessObjectLoss, objectLossNote } from './objectLoss'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const LF = String.fromCharCode(10)
const src = (lines) => ['//@version=5', 'indicator("t", overlay=true)', ...lines].join(LF)
const host = (lines) => translatePine(src(lines), { strict: true })
const fams = (t) => ((t.objects && t.objects.ops) || []).filter((o) => o.k === 'create').map((o) => o.family).sort()

const U = ['type kz', '    array<box> _box', 'var k = kz.new(array.new_box())']
const L0 = 'var l0 = line.new(bar_index - 5, low, bar_index, low)'
const BOX = 'box.new(bar_index - 5, high, bar_index, low)'

afterEach(() => { vi.unstubAllEnvs() })

describe('⛔ WITHHELD BY NAME, COUNTED — every spelling of a create into a field', () => {
  for (const [name, stmt] of [
    ['method push', `k._box.push(${BOX})`],
    ['method unshift', `k._box.unshift(${BOX})`],
    ['method insert', `k._box.insert(0, ${BOX})`],
    ['method set', `k._box.set(0, ${BOX})`],
    ['array.push', `array.push(k._box, ${BOX})`],
    ['array.unshift', `array.unshift(k._box, ${BOX})`],
    ['array.insert', `array.insert(k._box, 0, ${BOX})`],
  ]) {
    it(`${name}: \`box.new\` named, one content:lost, the line still drawn, the door serves`, () => {
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      const lines = [...U, L0, stmt]
      const t = host(lines)
      expect(t.objectDiagnostics.unsupported).toContain('box.new')
      expect(t.objectDiagnostics.dropReasons['content:lost']).toBe(1)
      expect(fams(t)).toEqual(['line'])
      expect(assessObjectLoss(t).verdict).toBe('partial')
      const d = memberPaneDefinition({ source: src(lines), id: 'u_fc', name: 'fc' })
      expect(d.ok, d.reason).toBe(true)
    })
  }

  it('inside an inlined helper, the same', () => {
    const t = host([...U, L0, 'add(kz q) =>', `    q._box.unshift(${BOX})`, 'add(k)'])
    expect(t.objectDiagnostics.unsupported).toContain('box.new')
    expect(t.objectDiagnostics.dropReasons['content:lost']).toBe(1)
  })
})

describe('⭐ SERVED / CONTROLS', () => {
  it('a create that also lands in a register is served (the push into the field draws nothing new)', () => {
    const t = host([...U, L0, `b = ${BOX}`, 'k._box.push(b)'])
    expect(fams(t)).toEqual(['box', 'line'])
    expect(t.objectDiagnostics.dropReasons['content:lost']).toBeUndefined()
    expect(t.objectDiagnostics.unsupported).not.toContain('box.new')
  })

  it('a DECLARED list keeps its own reader', () => {
    const t = host(['var a = array.new_box()', L0, `a.unshift(${BOX})`])
    expect(fams(t)).toEqual(['box', 'line'])
    expect(t.objectDiagnostics.unsupported).toEqual([])
  })

  // ⚰️ This said the declared insert is never counted at all; that was the silent
  // drop `fix/pine-silent-create-gaps` (a) closes (2026-11-08): the declared list's
  // own mutator branch now counts it ONCE. What U1 pins is unchanged — the
  // method-form hook (`recv !== 'array'`) never counts it a SECOND time.
  it('U1: `array.insert(declared, 0, box.new(…))` is counted once, never again as a field create', () => {
    const t = host(['var a = array.new_box()', L0, `array.insert(a, 0, ${BOX})`])
    expect(t.objectDiagnostics.unsupported.filter((n) => n === 'box.new').length).toBeLessThanOrEqual(1)
    expect(t.objectDiagnostics.dropReasons['content:lost']).toBe(1)
  })

  it('the note names a family whose every create went into a field', () => {
    const loss = assessObjectLoss(host([...U, L0, `k._box.unshift(${BOX})`]))
    expect(loss.hiddenFamilies).toEqual(['box'])
    expect(objectLossNote(loss).note).toContain('No box is shown:')
  })

  it('a numeric list is not a drawing', () => {
    const t = host([...U, L0, 'var f = array.new_float()', 'f.push(close)', 'array.push(f, close)'])
    expect(t.objectDiagnostics.unsupported).toEqual([])
    expect(t.objectDiagnostics.dropReasons['content:lost']).toBeUndefined()
  })
})
