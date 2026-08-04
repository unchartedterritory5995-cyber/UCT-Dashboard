// Two things are asserted here that nothing else can catch:
//   1. the registration list is EXACTLY the kit's needs (source-text oracle) —
//      the moment someone adds `import 'echarts'` or registers the whole
//      bundle, this fails instead of the bundle silently doubling;
//   2. CHART_INK matches tokens.css — canvas can't read CSS variables, so the
//      hexes are mirrored by hand and would otherwise fork silently.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let captured = null
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props) => {
    captured = props
    return <div data-testid="echart-inner" />
  },
}))

import EChart, { CHART_INK, GRID_BASE, echarts, prefersReducedMotion } from './echartsCore'

// Strip BOTH comment forms: this file's own header quotes the banned
// `from 'echarts-for-react'` import in prose, and a source-text test that reads
// its own documentation is a false failure waiting to happen.
const read = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const SOURCE = read('./echartsCore.js')
const TOKENS = read('../../../styles/tokens.css')

/** Declared value of a custom property inside the first :root block. */
function rootDecl(prop) {
  const i = TOKENS.indexOf(':root')
  const open = TOKENS.indexOf('{', i)
  let depth = 0
  let body = ''
  for (let j = open; j < TOKENS.length; j++) {
    if (TOKENS[j] === '{') depth++
    else if (TOKENS[j] === '}') {
      depth--
      if (depth === 0) { body = TOKENS.slice(open + 1, j); break }
    }
  }
  const re = new RegExp(`(?:^|[;{\\s])${prop.replace(/-/g, '\\-')}\\s*:\\s*([^;]+);`)
  const m = re.exec(body)
  return m ? m[1].trim() : null
}

describe('echartsCore — tree-shaken registration (§3.4)', () => {
  it('imports from echarts/core, never the full entry', () => {
    expect(SOURCE).toMatch(/from 'echarts\/core'/)
    expect(SOURCE).not.toMatch(/from 'echarts'/)
    expect(SOURCE).not.toMatch(/from "echarts"/)
    expect(SOURCE).toMatch(/from 'echarts-for-react\/lib\/core'/)
    // The full React wrapper entry pulls the full echarts entry with it.
    expect(SOURCE).not.toMatch(/from 'echarts-for-react'/)
  })

  it('registers exactly the modules the kit draws — no more', () => {
    const use = /echarts\.use\(\[([\s\S]*?)\]\)/.exec(SOURCE)
    expect(use).not.toBeNull()
    const registered = use[1].split(',').map((s) => s.trim()).filter(Boolean).sort()
    expect(registered).toEqual([
      'AxisPointerComponent',
      'BarChart',
      'CanvasRenderer',
      'CustomChart',
      'GridComponent',
      'MarkLineComponent',
      'TooltipComponent',
    ])
  })

  it('exposes the registered core namespace', () => {
    expect(typeof echarts.use).toBe('function')
    expect(typeof echarts.init).toBe('function')
  })
})

describe('echartsCore — CHART_INK mirrors tokens.css', () => {
  it.each([
    ['gain', '--gain'],
    ['loss', '--loss'],
    ['gold', '--ut-gold'],
    ['text', '--text'],
    ['muted', '--text-muted'],
    ['bright', '--text-bright'],
  ])('CHART_INK.%s === %s', (key, token) => {
    expect(CHART_INK[key]).toBe(rootDecl(token))
  })
})

describe('EChart wrapper', () => {
  const option = { series: [{ type: 'bar', data: [1, 2] }] }

  it('renders role=img with the given aria-label (canvas is otherwise mute)', () => {
    render(<EChart option={option} ariaLabel="Quarterly EPS" />)
    expect(screen.getByRole('img', { name: 'Quarterly EPS' })).toBeInTheDocument()
  })

  it('reserves the height it is given (the SIZE contract)', () => {
    render(<EChart option={option} ariaLabel="x" height={240} />)
    expect(screen.getByRole('img', { name: 'x' })).toHaveStyle({ height: '240px' })
  })

  it('hands the option straight through and asks for the canvas renderer', () => {
    render(<EChart option={option} ariaLabel="x" />)
    expect(captured.option.series).toEqual(option.series)
    expect(captured.opts).toEqual({ renderer: 'canvas' })
    expect(captured.notMerge).toBe(true)
  })

  it('animates by default and not under prefers-reduced-motion', () => {
    render(<EChart option={option} ariaLabel="x" />)
    expect(captured.option.animation).toBe(true)      // test-setup's matchMedia stub returns matches:false

    const spy = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} })
    expect(prefersReducedMotion()).toBe(true)
    render(<EChart option={option} ariaLabel="y" />)
    expect(captured.option.animation).toBe(false)
    spy.mockRestore()
  })
})
