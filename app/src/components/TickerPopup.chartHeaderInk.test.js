// The TickerPopup's chart header (identity row: day change, market clock) reads at >= 4.5:1 in
// every app theme.
//
// Measured (WebKit + axe, local harness, /api mocked, a DOWN ticker, light theme, 390/834/1200):
// axe flagged the day change (#ff3b47, the chart theme's red, an inline style) at 3.6:1 and the
// clock (#d8d2c2 "12:45 PM", #9b9684 "ET": the `--widget-text*` fallbacks) at 1.51:1 and 2.9:1 on
// the header's #ffffff. The popup's header is an APP surface, exactly like the Ticker Hub's
// (`--widget-canvas` is set only by WidgetHost, so `.chartHeaderTop` falls back to
// `--bg-elevated`), and the popup is portalled out of any widget. So it takes the hub's fix
// (TickerHubSheet.dayGainInk.test.jsx): the text inks for the day change, the pill on
// `--bg-surface`, and here the app text tokens for the clock. /charts (its own chart canvas) is
// untouched: every rule is scoped to `data-ticker-popup-chart` / `data-ticker-hub-chart`.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { allThemes, parseColor, resolveVars } from '../pages/terminal/a11y/__tests__/terminalContrast'
import { contrast, composite } from '../styles/__tests__/contrastMath'

const SRC = join(process.cwd(), 'src')
const read = (p) => readFileSync(join(SRC, p), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const WS_RAW = stripComments(read('pages/charts/ChartsWorkspace.module.css'))
const POPUP_JSX = read('components/TickerPopup.jsx')
const POPUP = ':global([data-ticker-popup-chart])'
const HUB = ':global([data-ticker-hub-chart])'

/** `css` with every @media block removed: the rules that apply on EVERY device. */
function plainRules(css) {
  let out = ''
  let i = 0
  const re = /@media[^{]+\{/g
  let m
  while ((m = re.exec(css))) {
    out += css.slice(i, m.index)
    let d = 1
    let j = re.lastIndex
    for (; j < css.length && d; j += 1) { if (css[j] === '{') d += 1; else if (css[j] === '}') d -= 1 }
    i = j
    re.lastIndex = j
  }
  return out + css.slice(i)
}
const WS = plainRules(WS_RAW)

/** [{ index, value }] for every rule whose selector list holds exactly `selector`, in file order. */
function rules(css, selector, prop) {
  const out = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(',').some((s) => s.trim() === selector)) continue
    const v = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+?)\\s*(?:;|$)`).exec(m[2].trim())
    if (v) out.push({ index: m.index, value: v[1] })
  }
  return out
}
const last = (css, selector, prop) => rules(css, selector, prop).pop()?.value ?? null

const opaque = (value, vars, under) => {
  const c = parseColor(resolveVars(value, vars))
  return c.alpha >= 1 ? c.rgb.map(Math.round) : composite(c.rgb, c.alpha, under)
}
const HEADER_BG = last(WS, '.chartHeaderTop', 'background')

/** Every [theme what ratio] under 4.5:1 for `inks` ({ what: cssValue }) on `bg` (default: the header). */
function failures(inks, bgOf = () => HEADER_BG) {
  const out = []
  for (const [name, raw] of Object.entries(allThemes())) {
    const vars = new Map(raw)
    vars.delete('--widget-canvas')
    vars.delete('--widget-text')
    vars.delete('--widget-text-strong')
    const header = opaque(HEADER_BG, vars, [0, 0, 0])
    for (const [what, ink] of Object.entries(inks)) {
      const bg = opaque(bgOf(what), vars, header)
      const r = contrast(opaque(ink, vars, bg), bg)
      if (r < 4.5) out.push(`${name} ${what} ${r.toFixed(2)}`)
    }
  }
  return out
}

describe('TickerPopup chart header text clears 4.5:1 on the popup header', () => {
  it('the popup scope gets the same day-change inks and pill surface as the hub', () => {
    expect(last(WS, `${POPUP} .chartHeaderTop [data-day-gain='up']`, 'color')).toBe('var(--success-ink) !important')
    expect(last(WS, `${POPUP} .chartHeaderTop [data-day-gain='down']`, 'color')).toBe('var(--danger-ink) !important')
    expect(last(WS, `${POPUP} .chartDayGainExt`, 'background')).toBe('var(--bg-surface)')
    // the hub keeps its own (same rules, one selector list)
    expect(last(WS, `${HUB} .chartHeaderTop [data-day-gain='down']`, 'color')).toBe('var(--danger-ink) !important')
  })

  it('the clock takes the app text tokens in the popup and the hub', () => {
    for (const scope of [POPUP, HUB]) {
      expect(last(WS, `${scope} .clockTime`, 'color'), scope).toBe('var(--text-bright)')
      expect(last(WS, `${scope} .clockEt`, 'color'), scope).toBe('var(--text-muted)')
    }
  })

  it('the scoped clock rule comes AFTER the Sunrise canvas remap, so it wins at equal specificity', () => {
    for (const cls of ['.clockTime', '.clockEt']) {
      const sunrise = rules(WS, `:global([data-charts-theme='sunrise']) ${cls}`, 'color').pop()
      const popup = rules(WS, `${POPUP} ${cls}`, 'color').pop()
      expect(sunrise, cls).toBeTruthy()
      expect(popup.index, cls).toBeGreaterThan(sunrise.index)
    }
  })

  it('every app theme: day change, pill and clock clear 4.5:1 on the popup header', () => {
    expect(HEADER_BG).toMatch(/var\(--widget-canvas, var\(--bg-elevated/)
    const inks = {
      'up': last(WS, `${POPUP} .chartHeaderTop [data-day-gain='up']`, 'color').replace(' !important', ''),
      'down': last(WS, `${POPUP} .chartHeaderTop [data-day-gain='down']`, 'color').replace(' !important', ''),
      'clock': last(WS, `${POPUP} .clockTime`, 'color'),
      'et': last(WS, `${POPUP} .clockEt`, 'color'),
    }
    expect(failures(inks)).toEqual([])
    const pill = last(WS, `${POPUP} .chartDayGainExt`, 'background')
    expect(failures({ 'up': inks.up, 'down': inks.down }, () => pill)).toEqual([])
  })

  it('the popup chart area carries the scope the rules name, and the modal is portalled (the wire)', () => {
    expect(POPUP_JSX).toMatch(/className=\{styles\.chartArea\}\s*data-ticker-popup-chart=""/)
    expect(POPUP_JSX).toMatch(/modalOpen && createPortal\(/)
    expect(read('pages/charts/widgets/ChartMarketClock.jsx')).toMatch(/styles\.clockTime\b[\s\S]*styles\.clockEt\b|styles\.clockEt\b[\s\S]*styles\.clockTime\b/)
  })

  it('CONTROL: the shipped unscoped colours fail on the popup header (the math can fail)', () => {
    const clock = { 'clock': last(WS, '.clockTime', 'color'), 'et': last(WS, '.clockEt', 'color'), 'down-hue': '#ff3b47' }
    const fails = failures(clock)
    expect(fails).toContain('light clock 1.51')
    expect(fails.some((f) => /^light et /.test(f)), fails.join('\n')).toBe(true)
    expect(fails.some((f) => /^light down-hue 3\.\d\d$/.test(f)), fails.join('\n')).toBe(true)
  })
})

// The identity label and the info strip on the same app surface. Measured (WebKit + axe, light theme,
// 1200 mouse, the member's stored /charts title colour): the label at 1.22:1 (#e8e8ec on #ffffff,
// `header.colors.title`, written by applying a dark /charts theme), the Market Cap / Next Earnings
// values at 2.76:1 (#6ba3be) and the UCT Rating at 1.85:1 (#dcbb5e), all inline styles. After: 0.
describe('TickerPopup / Ticker Hub chart header: identity label and info values clear 4.5:1', () => {
  const VALUE_KEYS = { mcap: 'info', earn: 'info', rating: 'accent' }
  it('both scopes re-ink the label and every info value with app tokens, over the inline colour', () => {
    for (const scope of [POPUP, HUB]) {
      expect(last(WS, `${scope} .chartHeaderTop [data-testid='sym-label']`, 'color'), scope).toBe('var(--text-bright) !important')
      expect(last(WS, `${scope} .chartMetaVal`, 'color'), scope).toBe('var(--text-bright) !important')
      for (const [key, token] of Object.entries(VALUE_KEYS)) {
        expect(last(WS, `${scope} .chartMetaVal[data-meta-key='${key}']`, 'color'), `${scope} ${key}`).toBe(`var(--${token}) !important`)
      }
      expect(last(WS, `${scope} .chartMetaVal[data-sign='pos']`, 'color'), scope).toBe('var(--success-ink) !important')
      expect(last(WS, `${scope} .chartMetaVal[data-sign='neg']`, 'color'), scope).toBe('var(--danger-ink) !important')
    }
  })

  it('every app theme: label, default, keyed and signed values clear 4.5:1 on the header', () => {
    const v = (sel) => last(WS, `${POPUP} ${sel}`, 'color').replace(' !important', '')
    const inks = {
      'label': v(".chartHeaderTop [data-testid='sym-label']"),
      'value': v('.chartMetaVal'),
      'mcap': v(".chartMetaVal[data-meta-key='mcap']"),
      'rating': v(".chartMetaVal[data-meta-key='rating']"),
      'pos': v(".chartMetaVal[data-sign='pos']"),
      'neg': v(".chartMetaVal[data-sign='neg']"),
    }
    expect(failures(inks)).toEqual([])
  })

  it('CONTROL: the chart colours the rules replace fail on the light header (the math can fail)', () => {
    const fails = failures({ 'title': '#e8e8ec', 'mcap-dflt': '#6ba3be', 'rating-dflt': '#dcbb5e' })
    expect(fails).toContain('light title 1.22')
    expect(fails).toContain('light mcap-dflt 2.76')
    expect(fails).toContain('light rating-dflt 1.86') // axe truncates to 1.85
  })

  it('the wire: the static label carries the test id, the value span carries its key and sign', () => {
    expect(read('components/chart/pane/ChartIdentityRow.jsx')).toMatch(/data-testid="sym-label"\s*className=\{styles\.symbolStatic\}/)
    const row = read('components/chart/pane/ChartMetaRow.jsx')
    expect(row).toMatch(/className=\{styles\.chartMetaVal\} data-meta-key=\{it\.key\} data-sign=\{it\.sign \|\| undefined\}/)
    expect(read('components/chart/pane/ChartPane.jsx')).toMatch(/sign: f\.signed \? \(sign \|\| 'pos'\) : null/)
    // the keys the rules name are the field registry's own
    const fields = read('components/chart/headerFields.js')
    for (const key of Object.keys(VALUE_KEYS)) expect(fields, key).toMatch(new RegExp(`key: '${key}'`))
  })
})
