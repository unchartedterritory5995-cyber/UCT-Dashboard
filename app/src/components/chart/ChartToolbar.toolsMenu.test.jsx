// The ★ drawing-tools menu in UCT Signature style (owner 11-15): showing / hiding a tool, starring it,
// searching, and the "— click the …" instruction moved out of the name into the hint strip.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(__dirname, 'ChartToolbar.jsx'), 'utf8')
const css = readFileSync(resolve(__dirname, 'ChartToolbar.module.css'), 'utf8')

describe('drawing-tools menu (UCT Signature)', () => {
  it('names drop the bracketed hint and the "— click the …" instruction', () => {
    const toolName = (label) => label.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+[—–-]\s+.*$/, '')
    expect(toolName('Cup Curve — click the left lip')).toBe('Cup Curve')
    expect(toolName('Trendline (T)')).toBe('Trendline')
    expect(toolName('Bars & Time')).toBe('Bars & Time')
    expect(src).toContain('const toolName = (label) =>')
    expect(src).toContain('{toolName(h.label)}')
  })
  it('each row is a real checkbox plus a star button with names', () => {
    expect(src).toMatch(/role="checkbox" aria-checked=\{visible\}/)
    expect(src).toMatch(/aria-pressed=\{fav\}/)
  })
  it("gold only on a favourite's star (UCT Signature gold mix)", () => {
    const block = css.slice(css.indexOf('Drawing-tools menu'))
    const goldRules = block.split(/\r?\n/).filter((l) => /--ut-gold|#dcbb5e|#c9a84c|--accent/i.test(l))
    expect(goldRules.length).toBeGreaterThan(0)
    for (const l of goldRules) expect(l).toMatch(/^\.dt(StarOn|HintStar) /)
  })
})
