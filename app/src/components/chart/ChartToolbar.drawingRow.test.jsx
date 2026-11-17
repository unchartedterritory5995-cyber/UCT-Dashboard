// Drawing tools row in UCT Signature style (owner 11-16): resting #c9c6be ink,
// #f8f7f3 hover on a soft fill, the armed tool = flat gold icon (no gold fill /
// edge), disabled = ~30% opacity, and 1px hairlines between TOOLS' own groups.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ChartToolbar, { TOOLS, TOOL_GROUP } from './ChartToolbar'
import { mergeChartSettings } from './chartDefaults'
import { commandBarFor } from '../../utils/dividerColor'
import { AuthContext } from '../../context/AuthContext'

const css = readFileSync(resolve(__dirname, 'ChartToolbar.module.css'), 'utf8')
const rule = (sel) => {
  const i = css.indexOf(`\n${sel} {`)
  expect(i, sel).toBeGreaterThan(-1)
  return css.slice(i, css.indexOf('}', i))
}

function mount(props = {}) {
  return render(
    <AuthContext.Provider value={{ isPaid: true, user: null, loading: false }}>
      <ChartToolbar
        activeTool="cursor" setActiveTool={() => {}} color="#c9a84c" setColor={() => {}}
        lineWidth={1} setLineWidth={() => {}} hasSelection={false} onDelete={() => {}}
        onClearAll={() => {}} onUndo={() => {}} onRedo={() => {}} drawingCount={0}
        repeatMode={false} setRepeatMode={() => {}} chartSettings={mergeChartSettings({})}
        onUpdateSettings={() => {}} magnet={false} setMagnet={() => {}}
        onReplayToggle={() => {}} setLineStyle={() => {}} setFontSize={() => {}}
        {...props}
      />
    </AuthContext.Provider>,
  )
}

describe('drawing tools row — UCT Signature', () => {
  it('groups come from TOOLS\' own sep markers', () => {
    const groups = TOOLS.filter((t) => t !== 'sep').map((t) => TOOL_GROUP[t.id])
    expect(TOOL_GROUP.trendline).toBe(0)
    expect(TOOL_GROUP.rect).toBe(1)
    expect(TOOL_GROUP.fib).toBe(2)
    expect(TOOL_GROUP.text).toBe(3)
    expect(TOOL_GROUP.position).toBe(4)
    expect([...groups].sort((a, b) => a - b)).toEqual(groups) // order untouched
  })

  it('a hairline between every group, plus one before the ★ pair', () => {
    const { container } = mount()
    const strip = container.querySelector('[data-guide="chart.drawingTools"]')
    const dividers = strip.querySelectorAll('[data-tool-divider]')
    expect(dividers.length).toBe(5)
    for (const d of dividers) expect(d.getAttribute('aria-hidden')).toBe('true')
    // first divider sits right before the first shape tool
    expect(dividers[0].nextElementSibling.getAttribute('data-guide')).toBe('chart.tool.rect')
  })

  it('a filtered strip only divides between the groups it shows', () => {
    const { container } = mount({ toolFilter: ['trendline', 'measure'] })
    expect(container.querySelectorAll('[data-tool-divider]').length).toBe(1)
  })

  it('the armed tool is the one gold mark (active class), others are not', () => {
    mount({ activeTool: 'fib' })
    const fib = screen.getByRole('button', { name: /Fibonacci Retracement/ })
    const trend = screen.getByRole('button', { name: /Trendline/ })
    expect(fib.className).toMatch(/active/)
    expect(fib.getAttribute('data-guide-on')).toBe('true')
    expect(trend.className).not.toMatch(/active/)
  })

  it('CSS: flat gold icon, no gold fill or edge; resting/hover/disabled per spec', () => {
    const active = rule('.btn.active')
    expect(active).toMatch(/background:\s*transparent/)
    expect(active).toMatch(/color:\s*var\(--chart-cmd-icon-active/)
    expect(active).not.toMatch(/box-shadow/)
    expect(rule('.btn')).toMatch(/var\(--chart-cmd-icon, #c9c6be\)/)
    expect(rule('.btn:hover')).toMatch(/#f8f7f3/)
    expect(rule('.btn:disabled')).toMatch(/opacity:\s*var\(--chart-cmd-disabled-opacity, 0\.3\)/)
    const div = rule('.groupDivider')
    expect(div).toMatch(/height:\s*14px/)
    expect(div).toMatch(/rgba\(248, 247, 243, 0\.08\)/)
  })

  it('commandBarFor: dark canvas = Signature inks; light canvas stays dark-on-light', () => {
    const dark = commandBarFor('#0e0f0d')
    expect(dark.icon).toBe('#c9c6be')
    expect(dark.iconHover).toBe('#f8f7f3')
    expect(dark.surfaceHover).toBe('rgba(248, 247, 243, 0.07)')
    expect(dark.disabledOpacity).toBe('0.3')
    const light = commandBarFor('#ffffff')
    expect(light.icon).not.toBe('#c9c6be')
    expect(light.iconActive).toBe('#7a5c16')
  })
})
