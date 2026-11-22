// app/src/components/chart/engine/ast/objectSilentCreateGaps.test.js
//
// ⭐⭐ FOUR PRE-EXISTING SILENT DROPS (UDT-FIELD-CREATES / CHAINED-REMOVAL reviews):
//   (a) `array.insert(declared, i, box.new(…))` / `a.insert(i, box.new(…))` — the
//       list was marked diverged, the CREATE vanished with no count;
//   (b) `m.put(k, label.new(…))` / `map.put(m, k, …)` — no op, no count;
//   (c) `p = P.new(box.new(…))` into a user type's SCALAR field — no op, no count;
//   (d) `m.get(k).delete()` on a `map<K, label>` — named `object.delete`, so the
//       WHOLE drawing was refused (coarse, not silent).
//
// THE RULE (coordinator, 2026-11-08): serve if exact; else withhold that family by
// name with a count; never a whole-script refusal. None of (a)-(c) is exact here —
// the object program has no `insert` step, no map and no register for a user
// type's field, so every later step on the object would be unaddressable — so each
// create is named (`<family>.new`) and counted (`content:lost`). (d) reads the
// map's family off `map.new<K, fam>()` and withholds that family per object, as a
// chained array removal does.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { translatePine } from './pine'
import { assessObjectLoss } from './objectLoss'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const LF = String.fromCharCode(10)
const src = (lines) => ['//@version=5', 'indicator("t", overlay=true)', ...lines].join(LF)
const host = (lines) => translatePine(src(lines), { strict: true })
const fams = (t) => ((t.objects && t.objects.ops) || []).filter((o) => o.k === 'create').map((o) => o.family).sort()
const door = (lines) => memberPaneDefinition({ source: src(lines), id: 'u_gap', name: 'gap' })

const L0 = 'var l0 = line.new(bar_index - 5, low, bar_index, low)'
const BOX = 'box.new(bar_index - 5, high, bar_index, low)'
const LAB = 'label.new(bar_index, high, "x")'
const MAP = 'var m = map.new<string, label>()'

afterEach(() => { vi.unstubAllEnvs() })

const withheldCreate = (lines, family) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const t = host(lines)
  expect(t.objectDiagnostics.unsupported).toContain(`${family}.new`)
  expect(t.objectDiagnostics.dropReasons['content:lost']).toBe(1)
  expect(fams(t)).toEqual(['line'])
  expect(assessObjectLoss(t).verdict).toBe('partial')
  const d = door(lines)
  expect(d.ok, d.reason).toBe(true)
}

describe('(a) a create inserted into a DECLARED list — named, counted', () => {
  it('`array.insert(a, 0, box.new(…))`', () => withheldCreate(['var a = array.new_box()', L0, `array.insert(a, 0, ${BOX})`], 'box'))
  it('`a.insert(0, box.new(…))`', () => withheldCreate(['var a = array.new_box()', L0, `a.insert(0, ${BOX})`], 'box'))
  it('⭐ control: `a.unshift(box.new(…))` on the same list is still served', () => {
    const t = host(['var a = array.new_box()', L0, `a.unshift(${BOX})`])
    expect(fams(t)).toEqual(['box', 'line'])
    expect(t.objectDiagnostics.dropReasons['content:lost']).toBeUndefined()
  })
})

describe('(b) a create put into a map — named, counted', () => {
  it('`m.put(k, label.new(…))`', () => withheldCreate([MAP, L0, `m.put("a", ${LAB})`], 'label'))
  it('`map.put(m, k, label.new(…))`', () => withheldCreate([MAP, L0, `map.put(m, "a", ${LAB})`], 'label'))
  it('⭐ control: a numeric map is not a drawing', () => {
    const t = host(['var n = map.new<string, float>()', L0, 'n.put("a", close)', 'map.put(n, "b", open)'])
    expect(t.objectDiagnostics.unsupported).toEqual([])
  })
})

describe('(c) a create into a user type\'s SCALAR field — named, counted', () => {
  const T = ['type P', '    box b']
  it('`p = P.new(box.new(…))`', () => withheldCreate([...T, L0, `p = P.new(${BOX})`], 'box'))
  it('`var p = P.new(box.new(…))`', () => withheldCreate([...T, L0, `var p = P.new(${BOX})`], 'box'))
  it('⭐ control: a DRAWING constructor with creates nested in it keeps its own reader', () => {
    const t = host([L0, 'lf = linefill.new(line.new(bar_index - 5, low, bar_index, low), line.new(bar_index - 5, high, bar_index, high), color.red)'])
    expect(t.objectDiagnostics.unsupported).not.toContain('line.new')
    expect(t.objectDiagnostics.dropReasons['content:lost']).toBeUndefined()
  })
  it('⭐ control: a constructor with no drawing in it is nothing', () => {
    const t = host(['type Q', '    float v', L0, 'q = Q.new(close)'])
    expect(t.objectDiagnostics.unsupported).toEqual([])
  })
})

describe('(d) a removal on a map element — the map\'s family, withheld per object', () => {
  for (const stmt of ['m.get("a").delete()', 'map.get(m, "a").delete()', 'm.remove("a").delete()']) {
    it(`\`${stmt}\`: \`label.delete\`, labels withheld, the line served — not the whole script`, () => {
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      const lines = [MAP, L0, `var l1 = ${LAB}`, 'if m.size() > 0', `    ${stmt}`]
      const t = host(lines)
      expect(t.objectDiagnostics.unsupported).toContain('label.delete')
      expect(t.objectDiagnostics.unsupported).not.toContain('object.delete')
      expect(t.objectDiagnostics.removalWithheldFamilies).toEqual(['label'])
      expect(fams(t)).toEqual(['line'])
      expect(assessObjectLoss(t).verdict).toBe('partial')
      expect(door(lines).ok, door(lines).reason).toBe(true)
    })
  }
  for (const stmt of ['m.get("a").delete()', 'map.get(m, "a").delete()']) {
    it(`inside a helper whose only step it is (\`${stmt}\`), the same`, () => {
      const t = host([MAP, L0, 'del() =>', '    if m.size() > 0', `        ${stmt}`, 'del()'])
      expect(t.objectDiagnostics.unsupported).toContain('label.delete')
      expect(t.objectDiagnostics.removalWithheldFamilies).toEqual(['label'])
    })
  }
  it('G6: a `map<K, fam>` FIELD takes its family from the VALUE type, never the key', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const lines = ['type Z', '    map<string, label> _m', 'var z = Z.new(map.new<string, label>())', L0, `var l1 = ${LAB}`,
      'if z._m.size() > 0', '    z._m.get("a").delete()']
    const t = host(lines)
    expect(t.objectDiagnostics.unsupported).toContain('label.delete')
    expect(t.objectDiagnostics.unsupported).not.toContain('object.delete')
    expect(t.objectDiagnostics.removalWithheldFamilies).toEqual(['label'])
    expect(assessObjectLoss(t).verdict).toBe('partial')
    expect(door(lines).ok, door(lines).reason).toBe(true)
  })
  for (const stmt of ['m.get("a").delete()', 'map.get(m, "a").delete()']) {
    it(`in a REFUSED helper (\`${stmt}\`), the family is still withheld`, () => {
      const t = host([MAP, L0, `var l1 = ${LAB}`, 'del() =>', '    if m.size() > 0', `        ${stmt}`, '    1',
        'plot(close + del())'])
      expect(t.objectDiagnostics.removalWithheldFamilies).toEqual(['label'])
    })
  }
})
