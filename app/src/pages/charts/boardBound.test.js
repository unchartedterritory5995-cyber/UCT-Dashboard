// TERM-001 — the board-size bound's client half. The number is boardBound.json's; nothing here
// types it. The server half is tests/test_board_bound.py, reading the same file.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bound from './boardBound.json'
import {
  MAX_BOARD_WIDGETS, boardWidgetCount, boardCanGrow, boardMayBecome,
  boardRefusalSentence, boardLayoutRefusalSentence, boardOverBoundSentence,
} from './boardBound'

const HERE = path.dirname(fileURLToPath(import.meta.url))

describe('the bound is the shared file, read, never typed', () => {
  it('MAX_BOARD_WIDGETS is boardBound.json maxWidgets, a positive integer', () => {
    expect(MAX_BOARD_WIDGETS).toBe(bound.maxWidgets)
    expect(Number.isInteger(MAX_BOARD_WIDGETS) && MAX_BOARD_WIDGETS > 0).toBe(true)
  })
  it('no module under pages/charts declares a second board-size number', () => {
    const offenders = []
    for (const f of fs.readdirSync(HERE)) {
      if (!/\.(js|jsx)$/.test(f) || /\.test\./.test(f)) continue
      const src = fs.readFileSync(path.join(HERE, f), 'utf8')
      if (/(?:const|let|var)\s+[A-Z_]*(?:MAX_WIDGETS|BOARD_WIDGETS|MAX_BOARD)[A-Z_]*\s*=\s*\d/.test(src)) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })
  it('CONTROL: that check sees a typed declaration when one exists', () => {
    expect(/(?:const|let|var)\s+[A-Z_]*(?:MAX_WIDGETS|BOARD_WIDGETS|MAX_BOARD)[A-Z_]*\s*=\s*\d/
      .test('export const MAX_BOARD_WIDGETS = 16')).toBe(true)
  })
})

describe('the rule', () => {
  it('a board grows only while under the bound', () => {
    expect(boardCanGrow(0)).toBe(true)
    expect(boardCanGrow(MAX_BOARD_WIDGETS - 1)).toBe(true)
    expect(boardCanGrow(MAX_BOARD_WIDGETS)).toBe(false)
    expect(boardCanGrow(MAX_BOARD_WIDGETS + 5)).toBe(false)
  })
  it('an unknown size is never treated as room', () => {
    expect(boardCanGrow(null)).toBe(false)
    expect(boardWidgetCount(null)).toBe(null)
    expect(boardWidgetCount({ widgets: 'x' })).toBe(null)
    expect(boardWidgetCount({ widgets: [1, 2] })).toBe(2)
  })
  it('a saved layout replaces a board under the server rule: within the bound, or no larger', () => {
    expect(boardMayBecome(MAX_BOARD_WIDGETS, 0)).toBe(true)
    expect(boardMayBecome(MAX_BOARD_WIDGETS + 1, MAX_BOARD_WIDGETS)).toBe(false)
    expect(boardMayBecome(MAX_BOARD_WIDGETS + 1, MAX_BOARD_WIDGETS + 1)).toBe(true)
    expect(boardMayBecome(MAX_BOARD_WIDGETS + 1, null)).toBe(false)
  })
})

describe('the sentences', () => {
  it('name the bound and the count, with no placeholder left over', () => {
    for (const s of [boardRefusalSentence(17), boardLayoutRefusalSentence(20), boardOverBoundSentence(MAX_BOARD_WIDGETS + 2)]) {
      expect(s).toContain(String(MAX_BOARD_WIDGETS))
      expect(s).not.toMatch(/\{max\}|\{count\}/)
    }
  })
  it('an over-bound sentence exists only past the bound', () => {
    expect(boardOverBoundSentence(MAX_BOARD_WIDGETS)).toBe(null)
    expect(boardOverBoundSentence(MAX_BOARD_WIDGETS + 1)).toContain('Nothing was removed')
  })
})
