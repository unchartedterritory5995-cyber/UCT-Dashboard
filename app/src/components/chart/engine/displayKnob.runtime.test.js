// app/src/components/chart/engine/displayKnob.runtime.test.js
//
// ─── ⭐ e97 U6 — A RUNTIME CANDLE'S DISPLAY IS THE HOST ROW'S, BOUND AT THE INSTANCE'S SETTINGS ──────────────────────
//
// `kernel-channel-backquant` (committed corpus) writes `plotcandle(..., display = useBarColor ? display.all :
// display.none)` with `useBarColor = input.bool(false, ...)`. The runtime door read the run's own descriptor, a bare name
// only, so the candle was withheld ("its `display = unread` is not a place this pane reads"). It now carries the host
// row's display (`pine.js::outputDisplayOf`): the candle row holds `hiddenWhen`, hidden at the default as on
// TradingView, drawn when the member turns "Color Bars By Regime" on. Run with the runtime pane as the runtime-on lane runs.

import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { plotHiddenAt } from './knobBind.js'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from './runtimeKill'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')

const SOURCE = path.resolve(process.cwd(), '../corpus/committed/kernel-channel-backquant__d8c4b7f75c.pine')

describe('e97 U6 — the runtime candle reads the host row\'s display', () => {
  it('kernel-channel: the candle row is hidden at the default and drawn when the member turns useBarColor on', () => {
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    const r = memberPaneDefinition({ source: fs.readFileSync(SOURCE, 'utf8') })
    expect(r.ok, r.reason).toBe(true)
    expect(r.lane).toBe('runtime')
    const def = r.definition
    const candle = def.plots.find((p) => p.style === 'candles')
    expect(candle, 'the candle is carried, no longer withheld').toBeTruthy()
    expect(candle.hiddenWhen).toEqual({ type: 'op', name: '!', args: [{ type: 'series', name: 'useBarColor' }] })
    expect(def.inputs.some((i) => i.key === 'useBarColor')).toBe(true)
    expect(plotHiddenAt(candle, def, {})).toBe(true)
    expect(plotHiddenAt(candle, def, { useBarColor: true })).toBe(false)
    expect((r.notes || []).map((n) => n.note).join('\n')).not.toContain('`display = unread`')
  }, 60000)
})
