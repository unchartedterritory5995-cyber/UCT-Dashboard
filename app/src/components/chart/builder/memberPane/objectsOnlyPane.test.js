// app/src/components/chart/builder/memberPane/objectsOnlyPane.test.js
//
// ─── ⭐⭐ A SCRIPT THAT DRAWS AND OFFERS NO COLUMN — DARK BEHIND A FLAG ──────
//
// Ruling D2 says a member pane draws the HOST lane's verdict, and `paneGate`
// refuses anything whose verdict is `ok: false`. That was the whole story while
// `ok: false` meant "nothing came out of this script". It no longer does:
// `pine:objects-only` is a script that DRAWS — a table, labels, boxes — and
// offers no plot or alert condition, so there is nothing to filter a scan on.
//
// ⛔ THIS IS A D2 REVISIT AND IT ARRIVES OFF. Owner decision, 2026-09-20: admit
// it, but behind `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED`, defaulting OFF, so the
// first deploy carrying it changes nothing a member sees. Rollback is the
// variable, not a revert.
//
// ⚠️ ONE THING DOES CHANGE WITH THE FLAG OFF, and it is stated rather than
// hidden: the SENTENCE. A table-only script used to be refused with "this script
// declares nothing a chart can draw"; it is now refused with the objects-only
// one, which is the true statement about it. Still a refusal, still nothing
// drawn — a better sentence, arriving before the capability it describes.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { memberPaneDefinition } from './memberPaneDefinition'
import { paneGate } from '../../engine/ast/paneGate'
import { objectsOnlyPaneEnabled } from '../../engine/objectsOnlyPaneGate'

const APP = path.resolve(process.cwd())
const REPO = path.resolve(APP, '..')
const DASHBOARD = fs.readFileSync(
  path.join(REPO, 'corpus/committed/strong-start-rvol-dashboard__36140b1cbe.pine'), 'utf8')
const PLOTTING = '//@version=6\nindicator("t", overlay = true)\nplot(close)\n'

const on = () => vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
const off = () => vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '')
const build = (source) => memberPaneDefinition({ source, id: 'u_t', name: 'T' })

afterEach(() => { vi.unstubAllEnvs() })

describe('the flag', () => {
  it('⛔ defaults OFF, and anything but `1` is off', () => {
    for (const v of ['', '0', 'true', 'yes', 'TRUE']) {
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', v)
      expect(objectsOnlyPaneEnabled(), JSON.stringify(v)).toBe(false)
    }
    on()
    expect(objectsOnlyPaneEnabled()).toBe(true)
  })

  it('⛔⛔ it FAILS CLOSED when there is no env to read', () => {
    // ⚰ ADDED BECAUSE A MUTATION WAS GREEN WITHOUT IT. `import.meta.env` always
    // exists under vitest, so a `catch` that reads it directly can never be
    // entered by a test — flipping its `return false` to `return true` changed
    // nothing any case could see. That is this repo's definition of a guard that
    // is not a guard, and the reason the read is a late-bound parameter.
    //
    // ⛔ THE DIRECTION MATTERS: a build with no env must not quietly WIDEN what a
    // pane draws. Absent configuration is not consent.
    // `null` throws on property access; the Proxy is the hostile case — an env
    // object that exists and refuses to be read.
    const hostile = new Proxy({}, { get() { throw new Error('no env here') } })
    expect(objectsOnlyPaneEnabled(null)).toBe(false)
    expect(objectsOnlyPaneEnabled(hostile)).toBe(false)
    // ⛔ CONTROL: the seam still reads a real env when handed one, so the two
    // cases above are the CATCH firing and not the parameter being ignored.
    expect(objectsOnlyPaneEnabled({ VITE_PINE_OBJECTS_ONLY_PANE_ENABLED: '1' })).toBe(true)
  })

  it('⛔ the ledger declares it DARK, and names a reader that really reads it', () => {
    const led = JSON.parse(fs.readFileSync(
      path.join(REPO, 'docs', 'frontend_feature_flags.json'), 'utf8'))
    const entry = led.flags.VITE_PINE_OBJECTS_ONLY_PANE_ENABLED
    expect(entry, 'the flag is not declared in docs/frontend_feature_flags.json').toBeTruthy()
    expect(entry.status).toBe('dark')
    const named = entry.readBy[0].split('::')[0]
    expect(fs.existsSync(path.join(REPO, named)), named + ' does not exist').toBe(true)
    expect(fs.readFileSync(path.join(REPO, named), 'utf8')).toContain('objectsOnlyPaneEnabled')
  })
})

describe('⛔ OFF — a member sees exactly what they saw before', () => {
  it('the dashboard is refused, and nothing is built', () => {
    off()
    const r = build(DASHBOARD)
    expect(r.ok).toBe(false)
    expect(r.definition).toBeFalsy()
  })

  it('⭐ the refusal is the objects-only sentence, which is the TRUE one', () => {
    off()
    expect(String(build(DASHBOARD).reason)).toMatch(/draws objects/)
  })
})

describe('⭐⭐ ON — the dashboard becomes a pane definition', () => {
  it('a definition is built, and it carries the TABLE program', () => {
    on()
    const r = build(DASHBOARD)
    expect(r.ok).toBe(true)
    expect(r.definition.objects).toBeTruthy()
    expect(r.definition.objects.ops.length).toBeGreaterThan(0)
    // ⛔ THE OBJECT PROGRAM IS THE CONTENT, so a definition that passed the gate
    // and carried NO ops would be an empty pane with no sentence.
    expect(new Set(r.definition.objects.ops.map((o) => o.family)).has('table')).toBe(true)
  })

  it('⛔⛔ THE ANCHOR ROW IS HIDDEN — it must put nothing on screen', () => {
    // A definition's primary `source`/`ast` come from its first plot, and a
    // table-only script has none. The engine supplies the `plot(0)` placeholder
    // that real table-drawing scripts conventionally carry. Its hiddenness is
    // the whole justification: the renderer draws no series for a hidden row.
    on()
    const { definition, rows } = build(DASHBOARD)
    expect(rows).toHaveLength(0)              // nothing the MEMBER offered
    expect(definition.plots).toHaveLength(1)  // one anchor, and only one
    expect(definition.plots.every((p) => p.hidden === true)).toBe(true)
  })

  it('⛔ CONTROL: the anchor is never OFFERED as a column', () => {
    // It exists so the document has a well-formed primary. If it ever reached
    // the member as a screenable or selectable column, this engine would be
    // offering a constant nobody wrote.
    on()
    const { rows } = build(DASHBOARD)
    expect(rows.map((r) => r.label)).toEqual([])
  })
})

describe('⛔ the gate stays narrow', () => {
  const objectsOnly = {
    mode: 'host',
    ok: false,
    selected: -1,
    outputs: [],
    refusal: { guard: 'pine:objects-only', message: 'draws objects' },
    objects: { ops: [{ k: 'create', family: 'table' }] },
  }

  it('an objects-only verdict passes ONLY with the flag', () => {
    expect(paneGate(objectsOnly).ok).toBe(false)
    expect(paneGate(objectsOnly, { allowObjectsOnly: false }).ok).toBe(false)
    expect(paneGate(objectsOnly, { allowObjectsOnly: true }).ok).toBe(true)
  })

  it('⛔ a DIFFERENT refusal is still refused, flag or no flag', () => {
    // Without this, "allow ok:false" is satisfied by admitting every refusal —
    // which would put a script the host lane rejected onto a member's chart.
    const other = { ...objectsOnly, refusal: { guard: 'pine:request', message: 'no' } }
    expect(paneGate(other, { allowObjectsOnly: true }).ok).toBe(false)
  })

  it('⛔ objects-only with NO ops is still refused', () => {
    // A guard name is a claim about the script; the ops are the drawing.
    // Admitting on the name and finding nothing to draw is an empty pane with
    // no sentence — the one outcome the gate exists to prevent.
    for (const objects of [null, undefined, { ops: [] }, {}]) {
      expect(paneGate({ ...objectsOnly, objects }, { allowObjectsOnly: true }).ok,
        JSON.stringify(objects)).toBe(false)
    }
  })

  it('⛔ CONTROL: the screener lane is still inadmissible', () => {
    // The lane check runs FIRST and the flag must not reach around it.
    expect(paneGate({ ...objectsOnly, mode: 'screener' }, { allowObjectsOnly: true }).ok)
      .toBe(false)
  })
})

describe('⛔ CONTROL: a plot-bearing script is untouched either way', () => {
  it('builds identically with the flag on and off', () => {
    off()
    const a = build(PLOTTING)
    on()
    const b = build(PLOTTING)
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(b.rows.length).toBe(a.rows.length)
    expect(b.definition.plots.length).toBe(a.definition.plots.length)
    // ⭐ and its rows are REAL, not the anchor
    expect(a.definition.plots.some((p) => p.hidden === true)).toBe(false)
  })
})
