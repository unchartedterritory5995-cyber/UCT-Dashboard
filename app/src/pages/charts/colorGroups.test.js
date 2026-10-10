import { describe, expect, test } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BASE_GROUPS, EXTRA_GROUPS, GROUP_HEX, groupCycle, linkGroups, nextGroup,
  effectiveGroup, isSuspendedGroup,
} from './colorGroups'

// COV-10 remainder: colour groups beyond A-D, dark behind CHARTS_EXTRA_GROUPS_ENABLED.

describe('OFF is byte-identical to the four-group board', () => {
  test('the dot cycle is exactly A B C D N', () => {
    expect(groupCycle(false)).toEqual(['A', 'B', 'C', 'D', 'N'])
    expect(groupCycle(undefined)).toEqual(['A', 'B', 'C', 'D', 'N'])
  })
  test('a tab cycle (no N) is exactly A B C D', () => {
    expect(linkGroups(false)).toEqual(['A', 'B', 'C', 'D'])
    expect(nextGroup('D', false, { includeNone: false })).toBe('A')
  })
  test('the A-D and N dot colours are the values the panels typed before', () => {
    expect(GROUP_HEX).toMatchObject({ A: '#c9a84c', B: '#60a5fa', C: '#4ade80', D: '#c084fc', N: '#6b7280' })
  })
  test('only literal true turns it on (an enablement gate never defaults open)', () => {
    for (const v of [false, undefined, null, 'true', 1]) expect(groupCycle(v)).toHaveLength(5)
  })
})

describe('ON offers E-H', () => {
  test('the cycle runs A..H then N, and wraps', () => {
    expect(groupCycle(true)).toEqual([...BASE_GROUPS, ...EXTRA_GROUPS, 'N'])
    expect(nextGroup('D', true)).toBe('E')
    expect(nextGroup('H', true)).toBe('N')
    expect(nextGroup('N', true)).toBe('A')
  })
  test('every group has a dot colour', () => {
    for (const g of groupCycle(true)) expect(GROUP_HEX[g]).toMatch(/^#[0-9a-f]{6}$/)
  })
  test('an extra group is itself while on', () => {
    expect(effectiveGroup('E', true)).toBe('E')
    expect(isSuspendedGroup('E', true)).toBe(false)
  })
})

describe('a stored E-H while OFF: kept, not linked, never remapped', () => {
  test('reads as not linked, not as any of A-D', () => {
    for (const g of EXTRA_GROUPS) {
      expect(effectiveGroup(g, false)).toBe('N')
      expect(isSuspendedGroup(g, false)).toBe(true)
    }
  })
  test('base groups and N are never suspended', () => {
    for (const g of [...BASE_GROUPS, 'N']) {
      expect(effectiveGroup(g, false)).toBe(g)
      expect(isSuspendedGroup(g, false)).toBe(false)
    }
  })
  test('a click on a suspended dot lands on a real choice (A), not on another hidden group', () => {
    expect(nextGroup('F', false)).toBe('A')
    expect(nextGroup('F', false, { includeNone: false })).toBe('A')
  })
})

// COV-10: WidgetHeader's `COLORS` and PeriodSortPanel's `COLOR_HEX` were literal copies of
// this module, kept only because the terminal rail regexed them. That rail now reads this
// module (pages/terminal/functions.rail.test.js) and the copies are deleted. This keeps
// them deleted: neither consumer may retype the group cycle or a group's hex.
const LITERAL_CYCLE = /\[\s*['"]A['"]\s*,\s*['"]B['"]\s*,\s*['"]C['"]\s*,\s*['"]D['"]/
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('no second authority: the /charts consumers do not retype the groups', () => {
  test.each(['WidgetHeader.jsx', 'PeriodSortPanel.jsx'])('%s carries no literal group list or group hex', (file) => {
    const src = codeOnly(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), file), 'utf8'))
    expect(src).not.toMatch(LITERAL_CYCLE)
    for (const hex of Object.values(GROUP_HEX)) {
      expect(src.toLowerCase(), `${file} retypes ${hex}`).not.toContain(hex)
    }
  })
  test('control: the checks see a planted literal and a planted hex', () => {
    expect("const X = ['A', 'B', 'C', 'D', 'N']").toMatch(LITERAL_CYCLE)
    expect(codeOnly("const H = { A: '#c9a84c' } // x").toLowerCase()).toContain(GROUP_HEX.A)
  })
})
