// app/src/components/chart/legend/legendRows.clouds.test.js
//
// ─── THE OWNER'S OWN SCRIPT PRINTS ONE LEGEND ROW ───────────────────────────
//
// Owner, 2026-11-16, on a chart carrying Uncharted Clouds: about 22 rows that all
// read "Uncharted Clouds", two with a value and the rest struck through. "Need that
// to just be ONE there."
//
// This runs the REAL script through the REAL member door and the REAL readout
// (`legendChips`), so the row count is a fact about today's engine and not about a
// hand-made chip list: `legendRows.test.js` holds the rule, this holds the case.
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition.js'
import * as registry from '../engine/nativeRegistry'
import { legendChips } from '../engine/readout'
import { legendRows } from './legendRows'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
const CLOUDS = 'tests/fixtures/member/uncharted-clouds.pine'
const DEF_ID = 'u_member-pane_legend-one-row'

afterAll(() => registry.clearUserDefinitions())

function cloudsOnAChart() {
  const built = memberPaneDefinition({ source: fs.readFileSync(path.join(REPO, CLOUDS), 'utf8'), id: DEF_ID, name: 'Uncharted Clouds' })
  if (!built.ok) throw new Error(`the member door refused Clouds: ${built.reason}`)
  const { installed, errors } = registry.installUserDefinitions([built.definition])
  if (!installed.length) throw new Error(`the install door refused Clouds: ${errors.join(' | ')}`)
  const def = installed[0]
  const inst = { instanceId: `inst:${DEF_ID}:1`, defId: def.id, inputs: {} }
  // What the binder holds: a series for each plot that draws, none for a hidden one.
  const drawn = def.plots.filter((p) => p && p.hidden !== true && p.legend && p.legend.hide !== true)
  const bindings = drawn.map((p, i) => ({ instanceId: inst.instanceId, defId: def.id, plotKey: p.key, series: {}, lastValue: 433.92 + i }))
  return { def, inst, drawn, bindings }
}

describe('Uncharted Clouds in the legend', () => {
  it('⛔ NON-VACUITY: the script still gives the legend many same-named plots to fold', () => {
    const { def, inst, drawn, bindings } = cloudsOnAChart()
    const chips = legendChips(bindings, null, registry, [inst])
    // The defect's own shape: one chip per plot, every one named for the script.
    expect(def.plots.length).toBeGreaterThan(20)
    expect(drawn.length, 'Clouds draws its two averages').toBe(2)
    expect(chips.length, 'the readout no longer answers per plot; this rail guards nothing').toBeGreaterThan(20)
    expect(new Set(chips.map((c) => c.label)).size, 'the plots no longer share one name').toBe(1)
    expect(chips.filter((c) => c.hidden === true).length).toBe(chips.length - 2)
  })

  it('⭐⭐ ONE row: the name once, both averages\' values on it, no hidden rows', () => {
    const { inst, drawn, bindings } = cloudsOnAChart()
    const rows = legendRows(legendChips(bindings, null, registry, [inst]))
    expect(rows).toHaveLength(1)
    expect(rows[0].chip.label).toBe('Uncharted Clouds')
    expect(rows[0].chip.hidden).toBe(false)
    expect(rows[0].chip.plotKey).toBe(drawn[0].key)
    expect(rows[0].chip.value).toBe(433.92)
    expect(rows[0].more.map((c) => c.plotKey)).toEqual([drawn[1].key])
    expect(rows[0].more[0].value).toBe(434.92)
  })

  it('hidden by the member: still exactly one row, the way back', () => {
    const { inst, bindings } = cloudsOnAChart()
    const rows = legendRows(legendChips(bindings, null, registry, [{ ...inst, hidden: true }]))
    expect(rows).toHaveLength(1)
    expect(rows[0].chip.hidden).toBe(true)
    expect(rows[0].more).toEqual([])
  })

  it('beside other indicators: they keep their rows and Clouds adds one', () => {
    const { inst, bindings } = cloudsOnAChart()
    const rsi = { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: {} }
    const macd = { instanceId: 'inst:macd:1', defId: 'macd', inputs: {} }
    const chips = legendChips(bindings, null, registry, [rsi, inst, macd])
    const labels = legendRows(chips).map((r) => r.chip.label)
    expect(labels.filter((l) => l === 'Uncharted Clouds')).toHaveLength(1)
    // MACD's two outputs print different names, so they stay two rows.
    expect(labels.filter((l) => l === 'MACD' || l === 'SIG').length).toBe(2)
    expect(labels.length).toBe(4)
  })
})
