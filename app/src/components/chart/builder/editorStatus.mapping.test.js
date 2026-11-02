// Rails for the editor status panel's LINE MAPPING (spec section 6).
//
// Each named rail below is the one a mutation of the mapping turns red:
//   M1 out-of-range drop       `lineMarks` keeps a mark past the last line (or clamps)
//   M2 refusal line priority   `statusItems` uses the output's line over the refusal's
//   M3 severity merge          two items on one line keep the FIRST severity, not the worst
//   M4 stale-source gate       `lineMarksToDiagnostics` marks a buffer the marks were not computed on
import { describe, it, expect } from 'vitest'
import { Text } from '@codemirror/state'
import { lineMarks, lineCount, statusItems, SEVERITY, sourceLine } from './editorStatus'
import { lineMarksToDiagnostics } from './editor/diagnostics'

const SRC = ['//@version=6', 'indicator("x")', 'a = ta.sma(close, 3)', 'plot(a)', 'plot(close)'].join('\n')

const it3 = (over) => ({
  severity: SEVERITY.WITHHELD, label: 'L', reason: 'r', why: 'w', guard: 'pine:builtin', ...over,
})

describe('lineMarks', () => {
  it('counts lines the way CodeMirror does', () => {
    expect(lineCount('')).toBe(1)
    expect(lineCount('a\nb')).toBe(2)
    expect(lineCount(SRC)).toBe(Text.of(SRC.split('\n')).lines)
  })

  it('M1: a line past the end (or below 1) is DROPPED, never clamped onto the last line', () => {
    const status = { items: [it3({ line: 99 }), it3({ line: 0 }), it3({ line: 5, reason: 'last' })] }
    const m = lineMarks(status, SRC)
    expect(m.marks.map((x) => x.line)).toEqual([5])
    expect(m.marks[0].message).toContain('last')
    expect(m.marks.every((x) => !x.message.includes(': r'))).toBe(true)
  })

  it('M3: the worst severity on a line wins, in either order, and messages join', () => {
    const a = lineMarks({ items: [it3({ line: 4, severity: SEVERITY.NOTE, reason: 'n' }), it3({ line: 4, reason: 'w' })] }, SRC)
    const b = lineMarks({ items: [it3({ line: 4, reason: 'w' }), it3({ line: 4, severity: SEVERITY.NOTE, reason: 'n' })] }, SRC)
    for (const m of [a, b]) {
      expect(m.marks).toHaveLength(1)
      expect(m.marks[0].severity).toBe(SEVERITY.WITHHELD)
      expect(m.marks[0].message.split('\n')).toHaveLength(2)
    }
    const c = lineMarks({ items: [it3({ line: 4, severity: SEVERITY.NOTE }), it3({ line: 4, severity: SEVERITY.MAY_WITHHOLD, reason: 'm' })] }, SRC)
    expect(c.marks[0].severity).toBe(SEVERITY.MAY_WITHHOLD)
  })

  it('carries the source it was computed on', () => {
    expect(lineMarks({ items: [] }, SRC).source).toBe(SRC)
  })

  it('reads a source line by number, and nothing past the end', () => {
    expect(sourceLine(SRC, 3)).toBe('a = ta.sma(close, 3)')
    expect(sourceLine(SRC, 6)).toBeNull()
  })
})

describe('statusItems line choice', () => {
  it('M2: a refusal\'s own line wins over its output\'s plot line', () => {
    const report = {
      ok: true, dialect: 'pine', outcome: { missing: [], semantic: [] }, ignored: [],
      outputs: [{ kind: 'plot', title: 'S', line: 4, formula: null,
        refusal: { guard: 'pine:request', message: 'no', line: 3, column: 5, token: 'request.security' } }],
    }
    const items = statusItems(report)
    expect(items).toHaveLength(1)
    expect(items[0].line).toBe(3)
    expect(items[0].column).toBe(5)
    expect(items[0].family).toBe('request')
  })

  it('falls back to the output line when the refusal names none', () => {
    const report = {
      ok: true, dialect: 'pine', outcome: { missing: [], semantic: [] }, ignored: [],
      outputs: [{ kind: 'plot', line: 4, formula: null, refusal: { guard: 'pine:builtin', message: 'no' } }],
    }
    expect(statusItems(report)[0].line).toBe(4)
  })
})

describe('lineMarksToDiagnostics (CodeEditor)', () => {
  const doc = Text.of(SRC.split('\n'))
  const marks = lineMarks({ items: [it3({ line: 3 }), it3({ line: 4, severity: SEVERITY.MAY_WITHHOLD })] }, SRC)

  it('marks whole lines with the mapped severities on the buffer they were computed on', () => {
    const d = lineMarksToDiagnostics(doc, marks)
    expect(d).toHaveLength(2)
    expect(d[0]).toMatchObject({ from: doc.line(3).from, to: doc.line(3).to, severity: 'warning' })
    expect(d[1]).toMatchObject({ from: doc.line(4).from, severity: 'info' })
    expect(d[0].source).toBe('pine:builtin')
  })

  it('M4: a stale buffer (one keystroke newer) gets NO marks', () => {
    const newer = Text.of(`${SRC} `.split('\n'))
    expect(lineMarksToDiagnostics(newer, marks)).toEqual([])
  })

  it('drops a mark past the end of the buffer rather than clamping it', () => {
    const forged = { source: SRC, marks: [{ line: 42, severity: 'withheld', message: 'x' }] }
    expect(lineMarksToDiagnostics(doc, forged)).toEqual([])
  })
})
