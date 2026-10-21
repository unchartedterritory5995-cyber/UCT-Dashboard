// Notebook widgets: the per-wave release gates, read from the latched auth payload.
//
// Each wave has its own flag (`notebook_widgets_w<n>_enabled`). A flag gates menu entries and
// server reads only; a stored widget always renders. The reader is the same one-liner shape as
// `chartPlanEnabled`, and these cases use the same latch helpers the chart-plan tests use.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { widgetsWaveOn } from './notebookWidgetsFlags'
import { __resetNotebookFlags, latchNotebookFlags } from './offline/notebookFlags'

describe('widgetsWaveOn', () => {
  beforeEach(() => __resetNotebookFlags())
  afterEach(() => __resetNotebookFlags())

  it('is false for every wave when nothing has latched', () => {
    for (const wave of [1, 2, 3, 4, 5, 6]) expect(widgetsWaveOn(wave)).toBe(false)
  })

  it('is true once that wave is latched on, and the other waves stay false', () => {
    latchNotebookFlags({ notebook_widgets_w1_enabled: true })
    expect(widgetsWaveOn(1)).toBe(true)
    expect(widgetsWaveOn(2)).toBe(false)
    expect(widgetsWaveOn(6)).toBe(false)
  })

  it('is false when the payload carries the key as false', () => {
    latchNotebookFlags({ notebook_widgets_w3_enabled: false, notebook_widgets_w4_enabled: true })
    expect(widgetsWaveOn(3)).toBe(false)
    expect(widgetsWaveOn(4)).toBe(true)
  })

  it('answers false for a wave that does not exist', () => {
    latchNotebookFlags({ notebook_widgets_w1_enabled: true })
    expect(widgetsWaveOn(0)).toBe(false)
    expect(widgetsWaveOn(7)).toBe(false)
    expect(widgetsWaveOn(undefined)).toBe(false)
  })
})
