import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { MONITOR_ROW_H, MONITOR_ROW_H_WIDE, MONITOR_WIDE_QUERY } from '../Breadth'

// The virtualizer's fixed row height must equal the CSS row height at BOTH sizes,
// switched at the SAME breakpoint, or scroll-to-index drifts (owner 2026-11-19).
const css = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../Breadth.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

describe('Monitor row height follows the wide-screen breakpoint', () => {
  it('compact: .table --br-row-h equals MONITOR_ROW_H', () => {
    const base = /\.table\s*\{[^}]*--br-row-h:\s*(\d+)px/.exec(css)
    expect(Number(base?.[1])).toBe(MONITOR_ROW_H)
  })
  it('wide: the media block uses the same query and MONITOR_ROW_H_WIDE', () => {
    const at = css.indexOf(`@media ${MONITOR_WIDE_QUERY}`)
    expect(at, `no @media ${MONITOR_WIDE_QUERY} block`).toBeGreaterThan(-1)
    const block = /^@media[^{]*\{\s*\.table\s*\{([^}]*)\}/.exec(css.slice(at))
    expect(block, 'the wide block must set the .table variables').toBeTruthy()
    expect(Number(/--br-row-h:\s*(\d+)px/.exec(block[1])?.[1])).toBe(MONITOR_ROW_H_WIDE)
  })
  it('body cells and headers take their height from --br-row-h', () => {
    expect(css).toMatch(/\.td\s*\{[^}]*height:\s*var\(--br-row-h\)/)
    expect(css).toMatch(/\.th\s*\{[^}]*height:\s*var\(--br-row-h\)/)
  })
})
