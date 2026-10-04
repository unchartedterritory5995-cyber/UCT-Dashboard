// app/src/components/chart/builder/memberPane/paintsDoor.test.js
//
// ─── B1 — the member door carries `bgcolor` / `barcolor` onto the document ────
//
// `definition.paints`, one entry per drawn paint, whose colour rule is a hidden
// condition column minted by the SAME `conditionColumnFor` a plot and a fill use;
// a withheld paint is disclosed in words; a paint-only script is admitted on the
// objects-only flag, and a PANE script whose only drawing is a background is
// refused by name (the pane it would shade is never built).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { memberPaneDefinition } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { validateDefinition } from '../../engine/defSchema'

afterEach(() => { vi.unstubAllEnvs() })
const on = () => vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
const off = () => vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '')
const v5 = (body, overlay = true) => `//@version=5\nindicator("paints", overlay = ${overlay})\n${body}\n`
const build = (source) => memberPaneDefinition({ source, id: 'u_member-pane-b1' })

describe('a plotting script\'s paints ride on its document', () => {
  it('⭐ a conditional paint names a hidden condition column; a static one carries its colour', () => {
    const b = build(v5('plot(close, "c")\nbgcolor(close > open ? color.new(color.green, 80) : na)\nbarcolor(color.red)'))
    expect(b.ok).toBe(true)
    const [bg, bar] = b.definition.paints
    expect(bg).toMatchObject({ kind: 'bgcolor', line: 4, colorPalette: ['#4CAF50', 'rgba(0, 0, 0, 0)'] })
    expect(bg.opacity).toBeCloseTo(0.2, 6)
    const col = b.definition.plots.find((p) => `column:${p.key}` === bg.colorMode)
    expect(col && col.hidden).toBe(true)
    expect(bar).toEqual({ kind: 'barcolor', line: 5, color: '#FF5252' })
    // the install door accepts it, and keeps it
    const { installed, errors } = registry.installUserDefinitions([b.definition])
    try {
      expect(errors).toEqual([])
      expect(installed[0].paints).toEqual(b.definition.paints)
    } finally { registry.uninstallUserDefinition(b.definition.id) }
  })

  it('a paint and a plot coloured by ONE condition share ONE column', () => {
    const b = build(v5('plot(close, "c", color = close > open ? color.green : color.red)\nbarcolor(close > open ? color.green : color.red)'))
    const plotMode = b.definition.plots[0].colorMode
    expect(plotMode).toMatch(/^column:/)
    expect(b.definition.paints[0].colorMode).toBe(plotMode)
  })

  it('a withheld paint is disclosed by line and reason, and its plots still draw', () => {
    const b = build(v5('plot(close, "c")\nbarcolor(color.red, offset = na)'))
    expect(b.ok).toBe(true)
    expect(b.definition.paints).toBeUndefined()
    const note = b.notes.find((n) => n.name.startsWith('`barcolor`'))
    expect(note && note.note).toMatch(/line 4.*not drawn.*offset/s)
    expect(b.definition.meta.disclosures.some((d) => d.note === note.note)).toBe(true)
  })

  it('a script with no paint keeps the exact document shape it always had (no `paints` key)', () => {
    const b = build(v5('plot(close, "c")'))
    expect('paints' in b.definition).toBe(false)
  })
})

describe('a script whose only drawing is its paint', () => {
  const SRC = v5('bgcolor(close > open ? color.new(color.green, 80) : na)')
  it('⭐ is admitted on the objects-only flag, and the install door accepts the document', () => {
    on()
    const b = build(SRC)
    expect(b.ok, b.reason).toBe(true)
    expect(b.definition.paints).toHaveLength(1)
    expect(validateDefinition(b.definition).ok).toBe(true)
  })
  it('⛔ is refused with the flag off, exactly as an objects-only script is', () => {
    off()
    const b = build(SRC)
    expect(b.ok).toBe(false)
  })
  it('⛔ a PANE script whose only drawing is a background is refused by name', () => {
    on()
    const b = build(v5('bgcolor(close > open ? color.new(color.green, 80) : na)', false))
    expect(b.ok).toBe(false)
    expect(b.guard).toBe('pine:paint-pane')
  })
  it('…but a pane script whose only drawing is a `barcolor` is admitted: it recolours the chart\'s own bars', () => {
    on()
    const b = build(v5('barcolor(close > open ? color.green : na)', false))
    expect(b.ok, b.reason).toBe(true)
  })
})

describe('defSchema.validatePaints', () => {
  const base = (paints, plots) => ({
    schemaVersion: 2, id: 'u_b1x', version: 1, label: 'x', inputs: [],
    compute: { kind: 'ast', ast: { type: 'series', name: 'close' }, source: 'close' },
    plots: plots || [{ key: 'value', label: 'v', style: 'line' }],
    paints,
  })
  const errs = (paints, plots) => {
    const r = validateDefinition(base(paints, plots))
    return r.ok ? [] : r.errors.filter((e) => e.startsWith('paints'))
  }
  it('accepts a static and a column paint', () => {
    expect(errs([{ kind: 'bgcolor', color: '#ff0000', opacity: 0.2, line: 3 },
      { kind: 'barcolor', colorMode: 'column:value', colorUp: '#00ff00', colorDown: '#ff0000' }])).toEqual([])
  })
  it('refuses an unknown kind, a paint with no colour, a column nobody declares, two colour rules at once', () => {
    expect(errs([{ kind: 'plotcolor', color: '#ff0000' }]).length).toBe(1)
    expect(errs([{ kind: 'bgcolor' }]).length).toBe(1)
    expect(errs([{ kind: 'bgcolor', colorMode: 'column:nowhere', colorUp: '#0f0', colorDown: '#f00' }]).length).toBe(1)
    expect(errs([{ kind: 'bgcolor', colorMode: 'column:value', colorUp: '#0f0', colorDown: '#f00', colorPalette: ['#0f0', '#f00'] }]).length).toBe(1)
    expect(errs([{ kind: 'bgcolor', color: '#f00', opacity: 2 }]).length).toBe(1)
    expect(errs('nope').length).toBe(1)
  })
})
