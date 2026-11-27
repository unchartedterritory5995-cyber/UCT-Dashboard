// ⛔ (#2641, first-open bytes) ChartPane tells the switch-speed instrument (lib/switchSpeed.js) that a picked search result
// is TYPED through the instrument's global, never by importing it: a static import here made the entry chunk 3 B heavier,
// and the Notebook's first-open bytes are a budget (tools/notebook_perf_budgets.py, measured on a production build of
// the merged head and of master 6f5fa08fef: 2,255,465 vs 2,255,462 B; without the import, 2,255,462). ChartPane holds
// the two literals; this rail pins them to the instrument's own.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { SWITCH_SPEED_GLOBAL, TRIGGER_TYPED, hintSwitchTrigger } from '../../../lib/switchSpeed'

const src = fs.readFileSync(path.resolve(__dirname, 'ChartPane.jsx'), 'utf8')

describe('ChartPane reaches the switch-speed instrument through its global door', () => {
  it('imports nothing from lib/switchSpeed', () => {
    expect(src).not.toMatch(/from\s+['"][./]*lib\/switchSpeed['"]/)
    expect(src).not.toMatch(/import\(\s*['"][./]*lib\/switchSpeed['"]/)
  })

  it('holds the instrument\'s global name and typed code, equal to the instrument\'s', () => {
    const g = src.match(/const SWITCH_SPEED_GLOBAL = '([^']+)'/)
    const t = src.match(/const TRIGGER_TYPED = (\d+)/)
    expect(g?.[1]).toBe(SWITCH_SPEED_GLOBAL)
    expect(Number(t?.[1])).toBe(TRIGGER_TYPED)
  })

  it('the door is the instrument\'s own hint', () => {
    expect(window[SWITCH_SPEED_GLOBAL].hint).toBe(hintSwitchTrigger)
  })
})
