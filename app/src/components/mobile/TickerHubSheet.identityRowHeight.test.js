// The Ticker Hub sheet's chart identity row, on a phone, is ONE declared height in every session,
// and the loading fallback reserves that same height.
//
// Measured in WebKit at 390 (2026-10-28): the row was 49px in a regular session and 75px in
// pre/post, where the shaded extended-hours pill ("POST -0.07 (-0.28%)") no longer fits beside
// the company name and the row (allowed to wrap at <=640) took a second line. The fallback
// reserved 49 + 45, so out of market hours the chart box grew 388 -> 414 when ChartPane replaced
// the fallback and pushed the action row and the tweets 26px. After the fix: 410 loading and
// 410 loaded in regular, post AND pre; 373 / 373 at 834 (unchanged).
//
// A STRUCTURAL RAIL (jsdom lays nothing out); the WebKit walk is the measurement. What it pins is
// that the two heights are ONE value: the row's height and the fallback's reserve are built from
// the same tokens, and each token is derived from the rule that produces that part of the row.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mediaBodiesOn } from '../../testing/cssMediaAt'

const read = (p) => readFileSync(join(process.cwd(), 'src', p), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const HUB_CSS = stripComments(read('components/mobile/TickerHubSheet.module.css'))
const WS_CSS = stripComments(read('pages/charts/ChartsWorkspace.module.css'))
const SCOPE = ':global([data-ticker-hub-chart])'
const PHONE = { width: 390, pointer: 'coarse' }
const TABLET = { width: 834, pointer: 'coarse' }

/** Top-level (non-@media) rules of a stylesheet. */
const plain = (css) => css.replace(/@media[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')

/** The LAST value any rule whose selector list holds exactly `selector` gives `prop`, or null. */
function decl(block, selector, prop) {
  let out = null
  for (const [, sels, decls] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!sels.split(',').some((s) => s.trim() === selector)) continue
    for (const d of decls.split(';')) {
      const i = d.indexOf(':')
      if (i > 0 && d.slice(0, i).trim() === prop) out = d.slice(i + 1).trim()
    }
  }
  return out
}

/** A `.chartWrap` custom property in px, every var() resolved from `.chartWrap`, calc()s summed. */
function wrapPx(block, name, depth = 0) {
  const raw = decl(block, '.chartWrap', name)
  if (raw == null || depth > 8) return null
  let expr = raw
  for (const [ref, inner] of raw.matchAll(/var\((--[\w-]+)\)/g)) {
    const v = wrapPx(block, inner, depth + 1)
    if (v == null) return null
    expr = expr.replace(ref, `${v}px`)
  }
  expr = expr.replace(/calc\(/g, '(')
  if (!/^[\d.px+\-()\s]+$/.test(expr)) return null
  // eslint-disable-next-line no-new-func
  return Function(`return (${expr.replace(/px/g, '')})`)()
}
const px = (v) => (v == null ? null : Number(/^(\d+(?:\.\d+)?)px$/.exec(v.trim())?.[1] ?? NaN))

describe('Ticker Hub chart identity row (phone): one height in every session', () => {
  const hub = mediaBodiesOn(HUB_CSS, PHONE)
  const ws = mediaBodiesOn(WS_CSS, PHONE)

  it('the row\'s height IS the token the fallback reserve is built from', () => {
    expect(decl(ws, `${SCOPE} .chartHeaderTop`, 'height')).toMatch(/^var\(--hub-id-row-h\b/)
    expect(decl(hub, '.chartWrap', '--hub-chart-chrome-h')).toMatch(/var\(--hub-id-row-h\)/)
    // and the fallback uses the chrome, so the loading box and the loaded box share it
    expect(decl(hub, '.chartWrap .chartLoading', 'height')).toBe('calc(var(--hub-chart-h) + var(--hub-chart-chrome-h))')
    expect(wrapPx(hub, '--hub-id-row-h')).toBe(71)
    expect(wrapPx(hub, '--hub-chart-chrome-h')).toBe(71 + 45)
  })

  it('the day change is ALWAYS line two, so a regular session and pre/post lay out alike', () => {
    for (const sel of [`${SCOPE} .chartHeaderTop > .chartDayGainWrap`, `${SCOPE} .chartHeaderTop > .chartDayGain`]) {
      expect(decl(ws, sel, 'flex'), sel).toBe('0 0 100%')
      expect(decl(ws, sel, 'min-height'), sel).toMatch(/^var\(--hub-id-line2-h\b/)
    }
    expect(decl(ws, `${SCOPE} .chartHeaderTop > .symbolSlot`, 'min-height')).toMatch(/^var\(--hub-id-line1-h\b/)
    expect(decl(ws, `${SCOPE} .chartHeaderTop`, 'row-gap')).toMatch(/^var\(--hub-id-gap\b/)
    // the compact pane's empty right cluster is not a third line
    expect(decl(ws, `${SCOPE} .chartHeaderTop > .headerTopRight:empty`, 'display')).toBe('none')
  })

  it('each token is the size of the part it names (derived from the rules, not retyped)', () => {
    // line 1: the <=640 symbol slot floor
    expect(wrapPx(hub, '--hub-id-line1-h')).toBe(px(decl(ws, '.symbolSlot', 'min-height')))
    // line 2: the extended-hours pill, the taller of the two readouts: its text (line-height 1)
    // plus its vertical padding
    const pill = plain(WS_CSS)
    expect(decl(pill, '.chartDayGainExt', 'line-height')).toBe('1')
    const [padV] = decl(pill, '.chartDayGainExt', 'padding').split(/\s+/)
    expect(wrapPx(hub, '--hub-id-line2-h'))
      .toBe(px(decl(pill, '.chartDayGainExt', 'font-size')) + 2 * px(padV))
    expect(decl(pill, '.chartDayGain', 'line-height')).toBe('1')
    expect(px(decl(pill, '.chartDayGain', 'font-size'))).toBeLessThanOrEqual(wrapPx(hub, '--hub-id-line2-h'))
    // the two fixed terms: the <=640 row's padding-bottom and the row's 1px rule
    expect(decl(hub, '.chartWrap', '--hub-id-row-h'))
      .toBe('calc(var(--hub-id-line1-h) + var(--hub-id-gap) + var(--hub-id-line2-h) + 4px + 1px)')
    expect(decl(ws, '.chartHeaderTop', 'padding-bottom')).toBe('4px')
    expect(decl(plain(WS_CSS), '.chartHeaderTop', 'border-bottom')).toMatch(/^1px solid\b/)
    expect(decl(plain(WS_CSS), '.chartHeaderTop', 'box-sizing')).toBe('border-box')
  })

  it('CONTROL: none of it reaches the tablet tier, and nothing outside the hub scope', () => {
    const wsTab = mediaBodiesOn(WS_CSS, TABLET)
    expect(decl(wsTab, `${SCOPE} .chartHeaderTop`, 'height')).toBeNull()
    expect(decl(mediaBodiesOn(HUB_CSS, TABLET), '.chartWrap', '--hub-id-row-h')).toBeNull()
    // the unscoped phone row keeps its content-sized height (the /charts phone shell)
    expect(decl(ws, '.chartHeaderTop', 'height')).toBe('auto')
    // and a literal reserve would not count as the shared token
    const literal = '@media (max-width: 640px) { .chartWrap { --hub-chart-chrome-h: calc(49px + 45px); } }'
    expect(decl(mediaBodiesOn(literal, PHONE), '.chartWrap', '--hub-chart-chrome-h')).not.toMatch(/var\(--hub-id-row-h\)/)
  })
})
