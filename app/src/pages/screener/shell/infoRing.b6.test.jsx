import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ColumnDesc from './ColumnDesc'
import { allThemes, parseColor, resolveVars } from '../../terminal/a11y/__tests__/terminalContrast'
import { contrast } from '../../../styles/__tests__/contrastMath'

// Decision B6 (2026-11-07): the screener's filter-label info rings render in --text-muted, and
// turn gold only under :hover or :focus-visible. UIcon paints gold BY DEFAULT, so the ring must
// opt out (gold={false}) and take its trigger's CSS colour. jsdom has no :hover, so the state
// half is read from the stylesheets.

const SRC = join(globalThis.process.cwd(), 'src')
const read = (p) => readFileSync(join(SRC, p), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
const DESC_CSS = read('pages/screener/shell/ColumnDesc.module.css')
const SHELL_CSS = read('pages/screener/shell/ScannerShell.module.css')
const body = (css, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&')
  return new RegExp(`(?:^|[}\\n])\\s*${esc}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? null
}

describe('B6: filter info rings are muted at rest, gold only when reached for', () => {
  it('the ColumnDesc ring renders in currentColor, not the gold emboss', () => {
    render(<ColumnDesc colKey="rs_rank" name="RS" desc="Price-performance rank." tapTarget />)
    const btn = screen.getByRole('button', { name: 'What RS means' })
    const svg = btn.querySelector('svg')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.querySelector('linearGradient')).toBeNull()
  })

  it('the trigger is --text-muted at rest and --ut-gold on hover and keyboard focus', () => {
    expect(body(DESC_CSS, '.trigger')).toMatch(/color:\s*var\(--text-muted\)/)
    expect(DESC_CSS).toMatch(/\.trigger:hover,\s*\.trigger:focus-visible\s*\{\s*color:\s*var\(--ut-gold\)/)
  })

  it('the Universe ring follows the same rule', () => {
    expect(read('pages/screener/shell/UniverseBar.jsx')).toMatch(/<UIcon name="info" size=\{12\} gold=\{false\} \/>/)
    expect(body(SHELL_CSS, '.uInfoBtn')).toMatch(/color:\s*var\(--text-muted\)/)
    expect(SHELL_CSS).toMatch(/\.uInfoBtn:hover,\s*\.uInfoBtn:focus-visible\s*\{\s*color:\s*var\(--ut-gold\)/)
  })

  it('every app theme: the resting ring clears the 3:1 non-text floor on the rail and the page', () => {
    const fails = []
    for (const [name, raw] of Object.entries(allThemes())) {
      const vars = new Map(raw)
      const c = (t) => parseColor(resolveVars(`var(${t})`, vars)).rgb.map(Math.round)
      for (const bg of ['--bg', '--bg-surface']) {
        const r = contrast(c('--text-muted'), c(bg))
        if (r < 3) fails.push(`${name} on ${bg} ${r.toFixed(2)}`)
      }
    }
    expect(fails).toEqual([])
  })
})
