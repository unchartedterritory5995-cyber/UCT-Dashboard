// app/src/components/chart/engine/ast/chartOnly.test.js
//
// ─── B1 (step 61) — the `pine:chart-only` sentence is TRUE per call ─────────────
//
// ⚰️ It was one sentence for every call on every lane — "`x` paints on a chart;
// TradingView's own screener reads plot() and alertcondition() and nothing else,
// so this line is ignored here too" — and B1 made it false on the host lane, where
// `bgcolor` / `barcolor` now draw, as C1-B already had for a carried `fill`.
//
// ⭐ ONE AUTHORITY, `pine.js::chartOnlySentence`, and this rail checks each sentence
// against WHAT THE DOOR DID — never against a restated table: the paint record
// (`presentation.paints`), the carried band (`presentation.fills`), the folded level
// (`presentation.levels`), and, on the host lane, the member document itself
// (`memberPaneDefinition`): what it draws is what the sentence may call drawn.
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine, chartOnlySentence } from './pine'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

afterEach(() => { vi.unstubAllEnvs() })
const v5 = (body, overlay = true) => `//@version=5\nindicator("t", overlay = ${overlay})\n${body}\n`
const HOST = { strict: true }
const notesAt = (t, line) => (t.notes || []).filter((n) => n.code === 'pine:chart-only' && n.line === line)
const sayAt = (t, line) => {
  const n = notesAt(t, line)
  expect(n, `exactly one chart-only note on line ${line}`).toHaveLength(1)
  return n[0].message
}
const IGNORED = /ignored here too|paints on a chart/

describe('HOST lane — `bgcolor` / `barcolor` say how they draw, or why they do not', () => {
  it('⭐ a drawn paint says DRAWN, and the member document carries it', () => {
    const src = v5('plot(close, "c")\nbgcolor(close > open ? color.green : na)\nbarcolor(color.red)')
    const t = translatePine(src, HOST)
    expect(sayAt(t, 4)).toMatch(/^`bgcolor` is drawn: it shades the background behind this script, bar by bar/)
    expect(sayAt(t, 5)).toMatch(/^`barcolor` is drawn: it recolours the chart's own candles, bar by bar/)
    const b = memberPaneDefinition({ source: src, id: 'u_chart-only-1' })
    expect(b.ok).toBe(true)
    expect(b.definition.paints.map((p) => p.kind)).toEqual(['bgcolor', 'barcolor'])
  })

  it('a WITHHELD paint says it is not drawn, with the door\'s own reason', () => {
    const t = translatePine(v5('plot(close)\nbgcolor(color.red, offset = 1)'), HOST)
    const rec = t.presentation.paints[0]
    expect(rec.withheld).toBeTruthy()
    expect(sayAt(t, 4)).toBe(`\`bgcolor\` is not drawn here: ${rec.withheld.reason}`)
  })

  it('`display.none` and an `na` colour say they paint nothing — as TradingView does', () => {
    const t = translatePine(v5('plot(close)\nbgcolor(color.red, display = display.none)\nbarcolor(na)'), HOST)
    expect(t.presentation.paints[0].hidden).toBe(true)
    expect(sayAt(t, 4)).toMatch(/display = display.none`, so it is not drawn — TradingView does not draw it either/)
    expect(t.presentation.paints[1].na).toBe(true)
    expect(sayAt(t, 5)).toMatch(/^`barcolor`'s colour is `na`, so it paints no bar/)
  })
})

describe('HOST lane — `hline` and `fill` are said precisely', () => {
  it('⭐ `hline` is NOT drawn on the host lane, and the member document indeed carries no level', () => {
    const src = v5('plot(ta.rsi(close, 14))\nhline(70, "Upper")', false)
    const t = translatePine(src, HOST)
    expect(sayAt(t, 4)).toMatch(/^`hline` is not drawn on this chart/)
    const b = memberPaneDefinition({ source: src, id: 'u_chart-only-2' })
    expect(b.ok).toBe(true)
    expect(JSON.stringify(b.definition)).not.toMatch(/"levels"|"hlines"/)
  })

  it('⭐ a `fill` whose two edges are carried plots is CARRIED as a band, and the document draws it', () => {
    const src = v5('p1 = plot(high, "h")\np2 = plot(low, "l")\nfill(p1, p2, color = color.new(color.blue, 80))')
    const t = translatePine(src, HOST)
    expect(t.presentation.fills).toHaveLength(1)
    expect(sayAt(t, 5)).toMatch(/^`fill` is carried as the band between its two plots/)
    const b = memberPaneDefinition({ source: src, id: 'u_chart-only-3' })
    expect(b.ok).toBe(true)
    expect(b.definition.plots.some((p) => p.fill && p.fill.with)).toBe(true)
  })

  it('a `fill` whose edge is not a carried plot says it is NOT drawn, and why', () => {
    const t = translatePine(v5('p1 = plot(high, "h")\nh = hline(50)\nfill(p1, h)'), HOST)
    expect(t.presentation.fills).toHaveLength(0)
    expect(sayAt(t, 5)).toBe('`fill` is not drawn: its two edges are not both plots this door carries')
  })

  it('a `fill` assigned to a name is not carried, and says so', () => {
    const t = translatePine(v5('p1 = plot(high, "h")\np2 = plot(low, "l")\nf = fill(p1, p2)'), HOST)
    expect(t.presentation.fills).toHaveLength(0)
    expect(sayAt(t, 5)).toBe('`fill` is not drawn: a `fill` assigned to a name is not read')
  })

  it('`alert()` says it draws nothing and nothing here delivers it', () => {
    const t = translatePine(v5('plot(close)\nalert("x")'), HOST)
    expect(sayAt(t, 4)).toMatch(/^`alert\(\)` sends an alert on TradingView and draws nothing; this door delivers no/)
  })

  it('a chart-only call inside a block is said as one Pine accepts only at the top level', () => {
    const t = translatePine(v5('plot(close)\nif close > open\n    bgcolor(color.red)'), HOST)
    expect(sayAt(t, 5)).toBe("`bgcolor` inside a block is not drawn here — Pine accepts it only at a script's top level")
  })
})

describe('SCREENER lane — the screen statement stays, and what the builder carries is said', () => {
  it('`bgcolor` / `barcolor` are not carried on this lane, and say so', () => {
    const t = translatePine(v5('plot(close)\nbgcolor(color.red)\nbarcolor(color.red)'), {})
    expect(t.presentation.paints).toBeUndefined()
    expect(sayAt(t, 4)).toMatch(/^`bgcolor` paints a chart's background; this door does not carry it, and a screen reads plot\(\) and alertcondition\(\) and nothing else/)
    expect(sayAt(t, 5)).toMatch(/^`barcolor` paints a chart's candles; this door does not carry it/)
  })

  it('a folded `hline` is carried as a level line; one that is not, says it is not', () => {
    const t = translatePine(v5('plot(close)\nhline(70)\nh = hline(30)'), {})
    expect(t.presentation.levels.map((l) => l.value)).toEqual([70])
    expect(sayAt(t, 4)).toMatch(/^`hline` draws a horizontal level; this door carries it as a level line for a chart/)
    expect(sayAt(t, 5)).toMatch(/assigned to a name it is not carried/)
  })

  it('a carried `fill` is said as that band', () => {
    const t = translatePine(v5('p1 = plot(high, "h")\np2 = plot(low, "l")\nfill(p1, p2)'), {})
    expect(t.presentation.fills).toHaveLength(1)
    expect(sayAt(t, 5)).toMatch(/^`fill` shades the band between two plots; this door carries it as that band for a chart/)
  })
})

describe('⭐⭐ the sentence agrees with the door on every corpus script, both lanes', () => {
  const ROOT = path.resolve(__dirname, '../../../../../../tests/fixtures')
  const files = ['pine', 'pine_community', 'pine_c1', 'pine_multiplot', 'member']
    .flatMap((d) => (fs.existsSync(path.join(ROOT, d)) ? fs.readdirSync(path.join(ROOT, d)) : [])
      .filter((f) => f.endsWith('.pine')).map((f) => path.join(ROOT, d, f)))

  it('NON-VACUITY — the corpus writes every kind of chart-only call', () => {
    expect(files.length).toBeGreaterThan(40)
    const words = new Set()
    for (const f of files) {
      for (const n of translatePine(fs.readFileSync(f, 'utf8'), HOST).notes || []) {
        if (n.code === 'pine:chart-only') words.add(/^`(\w+)/.exec(n.message)[1])
      }
    }
    expect([...words].sort()).toEqual(expect.arrayContaining(['bgcolor', 'barcolor', 'fill', 'hline', 'alert']))
  }, 300000)

  it('⛔ no note says "ignored" on the host lane, a paint says drawn iff its record draws, and a fill says carried iff a band is', () => {
    const bad = []
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8')
      for (const opts of [HOST, {}]) {
        let t
        try { t = translatePine(src, opts) } catch { continue }
        const notes = (t.notes || []).filter((n) => n.code === 'pine:chart-only')
        const host = opts === HOST
        const name = `${path.basename(f)} ${host ? 'host' : 'screen'}`
        if (host) for (const n of notes) if (IGNORED.test(n.message)) bad.push(`${name} line ${n.line}: ${n.message}`)
        // paints, in source order, against their records
        const paintNotes = notes.filter((n) => /^`(bgcolor|barcolor)`( is drawn| is not drawn here| has `display|'s colour)/.test(n.message))
        const recs = ((t.presentation || {}).paints) || []
        if (host && paintNotes.length !== recs.length) bad.push(`${name}: ${paintNotes.length} paint sentences, ${recs.length} paint records`)
        paintNotes.forEach((n, i) => {
          const r = recs[i]
          const draws = !!r && !r.withheld && !r.hidden && !r.na
          if (/is drawn:/.test(n.message) !== draws) bad.push(`${name} line ${n.line}: "${n.message}" vs record ${JSON.stringify(r && { withheld: !!r.withheld, hidden: !!r.hidden, na: !!r.na })}`)
        })
        // bands: as many "carried" sentences as bands carried
        const carried = notes.filter((n) => /^`fill` (is carried as the band|shades the band between two plots; this door carries)/.test(n.message)).length
        const bands = (((t.presentation || {}).fills) || []).length
        if (carried !== bands) bad.push(`${name}: ${carried} fill sentences say carried, ${bands} bands carried`)
      }
    }
    expect(bad).toEqual([])
  }, 600000)

  it('⛔ ONE AUTHORITY — every `pine:chart-only` note in pine.js is worded by `chartOnlyNote`', () => {
    const src = fs.readFileSync(path.join(__dirname, 'pine.js'), 'utf8')
    const sites = [...src.matchAll(/noteOf\('pine:chart-only',\s*([^,]+?)\(/g)].map((m) => m[1].trim())
    expect(sites.length).toBeGreaterThanOrEqual(6)
    expect([...new Set(sites)]).toEqual(['chartOnlyNote'])
    // and the deferred sentences are re-said through the same function
    expect(src).toMatch(/p\.note\.message = chartOnlySentence\(p\.word, p\.how\)/)
  })

  it('the authority never answers "drawn" for a call nothing draws', () => {
    for (const word of ['hline', 'alert', 'plotshape', 'plotchar', 'somethingElse']) {
      for (const lane of ['host', 'screen']) {
        for (const site of ['top', 'bound', 'nested']) {
          expect(chartOnlySentence(word, { lane, site }), `${word} ${lane} ${site}`).not.toMatch(/is drawn:/)
        }
      }
    }
    expect(chartOnlySentence('bgcolor', { lane: 'host', site: 'top' })).toMatch(/is not drawn here/)
  })
})
