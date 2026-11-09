import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import HubChip from './HubChip'
import { COMPONENT_PROPS } from './contracts'
import { allThemes, parseColor, resolveVars } from '../pages/terminal/a11y/__tests__/terminalContrast'
import { contrast, composite } from '../styles/__tests__/contrastMath'

// Decision B4 (2026-11-07): no violet or sky blue outside data. The joystick's mode pill (the
// chip: "CHART · ...", "SCREENER · No results") says its mode word in --ut-gold, and its body
// reads --text-bright on a solid --bg-elevated plate. The per-mode hue stays on the knob's dot.

const SRC = join(globalThis.process.cwd(), 'src')
const read = (p) => readFileSync(join(SRC, p), 'utf8').replace(/\r\n/g, '\n')
const HUB_CSS = read('hub/hub.module.css').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (sel) => new RegExp(`(?:^|\\n)${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(HUB_CSS)?.[1] ?? ''
const prop = (body, p) => new RegExp(`(?:^|;|\\n)\\s*${p}\\s*:\\s*([^;]+);`).exec(body)?.[1]?.trim()

describe('B4: the mode pill', () => {
  it('the mode word is gold and the body bright, on an opaque elevated plate', () => {
    expect(prop(rule('.chipMode'), 'color')).toBe('var(--ut-gold)')
    expect(prop(rule('.chipHint'), 'color')).toBe('var(--text-bright)')
    expect(prop(rule('.chip'), 'background')).toBe('var(--bg-elevated)')
    // an opaque plate has nothing behind it to blur
    expect(rule('.chip')).not.toMatch(/backdrop-filter/)
  })

  it('the rendered mode word carries no per-mode colour, whatever mode it names', () => {
    render(<HubChip label="Chart" tapHint="tap: next timeframe" modeColor="--hub-mode-chart" />)
    const word = screen.getByText('Chart')
    expect(word.getAttribute('style')).toBeNull()
    expect(word.closest('[data-testid="hub-chip"]').innerHTML).not.toMatch(/--hub-mode-/)
  })

  it('the chip no longer takes a mode colour: not in its contract, not passed by the hub', () => {
    expect(COMPONENT_PROPS.HubChip).not.toContain('modeColor')
    expect(COMPONENT_PROPS.HubKnob).toContain('modeColor')   // the dot keeps the mode hue
    const root = read('hub/HubRoot.jsx')
    const chip = root.slice(root.indexOf('<HubChip'), root.indexOf('/>', root.indexOf('<HubChip')))
    expect(chip).not.toMatch(/modeColor/)
    expect(read('hub/HubChip.jsx')).not.toMatch(/var\(\$\{modeColor\}\)/)
  })

  it('every app theme: gold word and bright body clear 4.5:1 on the plate', () => {
    const fails = []
    for (const [name, raw] of Object.entries(allThemes())) {
      const vars = new Map(raw)
      const ink = (v, under) => {
        const c = parseColor(resolveVars(v, vars))
        return c.alpha >= 1 ? c.rgb.map(Math.round) : composite(c.rgb, c.alpha, under)
      }
      const plate = ink('var(--bg-elevated)', [0, 0, 0])
      for (const t of ['--ut-gold', '--text-bright']) {
        const r = contrast(ink(`var(${t})`, plate), plate)
        if (r < 4.5) fails.push(`${name} ${t} ${r.toFixed(2)}`)
      }
    }
    expect(fails).toEqual([])
  })

  it('the mode hues stay defined for the knob, and the chip\'s glass token is retired with the glass', () => {
    const tokens = read('styles/tokens.css')
    expect(tokens).toMatch(/--hub-mode-chart:\s*#9d95ff/)
    expect(tokens).not.toMatch(/--hub-blur-chip:/)   // retired with the glass
  })
})
