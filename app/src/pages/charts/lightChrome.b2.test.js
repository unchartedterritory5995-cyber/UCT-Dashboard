// Decision B2 (2026-11-07): in the LIGHT app theme the chart canvas keeps its own theme, while
// the chrome around it follows the page: a /charts chart widget's drag bar, tab strip, identity
// row and TF bar, and the Chart Settings dialog. Both are pure CSS (the canvas colours are JS and
// untouched), and jsdom does no cascade, so this reads the stylesheets and does the cascade's
// arithmetic itself, in the style of ColumnPicker.va6.test.jsx and TickerPopup.chartHeaderInk.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { allThemes, parseColor, resolveVars } from '../terminal/a11y/__tests__/terminalContrast'
import { contrast, composite } from '../../styles/__tests__/contrastMath'
import { APP_THEMES } from '../../styles/appThemes'

const SRC = join(globalThis.process.cwd(), 'src')
const read = (p) => readFileSync(join(SRC, p), 'utf8').replace(/\r\n/g, '\n')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const WS = strip(read('pages/charts/ChartsWorkspace.module.css'))
const CSM = strip(read('components/chart/ChartSettingsModal.module.css'))
const TOKENS = strip(read('styles/tokens.css'))

/** [selectorList[], body] for every flat rule. */
const rules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => [m[1].split(',').map((s) => s.trim()), m[2]])
const decls = (body) => new Map([...body.matchAll(/(--[\w-]+|[a-z-]+)\s*:\s*([^;]+);/g)]
  .map((m) => [m[1], m[2].trim()]))
const ruleFor = (css, selector) => rules(css).filter(([sels]) => sels.includes(selector)).map(([, b]) => decls(b))

const LIGHT = ":global([data-theme='light'])"
const SCOPE = `${LIGHT} [data-charts-theme='default'] .widget`
const DARK_BLOCK = ruleFor(WS, `${SCOPE}`)[0]
const DRAG_BAR = `${SCOPE}:has(.chartWidget) > .widgetHeader`
const ROWS = [
  `${SCOPE} .chartWidget > .chartTabStrip`,
  `${SCOPE} .chartWidget > .chartHeaderTop`,
  `${SCOPE} .chartWidget > .tfBar`,
]
const LIFT = ruleFor(WS, ROWS[2])[0]
const ALIASES = ruleFor(WS, LIGHT)[0]

const LIGHT_THEMES = Object.entries(allThemes())
  .filter(([name]) => name === 'light' || APP_THEMES.some((t) => `uct:${t.id}` === name && t.family === 'light'))
  .map(([name, raw]) => [name, new Map(raw)])

const opaque = (value, vars, under) => {
  const c = parseColor(resolveVars(value.replace(/\s*!important$/, ''), vars))
  return c.alpha >= 1 ? c.rgb.map(Math.round) : composite(c.rgb, c.alpha, under)
}
/** `[theme what ratio]` for every ink under 4.5:1 on each named page surface. */
function failures(inks, surfaces) {
  const out = []
  for (const [name, vars] of LIGHT_THEMES) {
    for (const s of surfaces) {
      const bg = opaque(`var(${s})`, vars, [255, 255, 255])
      for (const [what, ink] of Object.entries(inks)) {
        const r = contrast(opaque(ink, vars, bg), bg)
        if (r < 4.5) out.push(`${name} ${what} on ${s} ${r.toFixed(2)}`)
      }
    }
  }
  return out
}

describe('B2: a /charts chart widget\'s chrome follows the light page', () => {
  it('CONTROL: the dark re-assertion and the lift both exist, and there are light themes to check', () => {
    expect(DARK_BLOCK?.get('--bg'), 'the dark widget block moved; re-derive this rail').toBe('#000000')
    expect(LIFT, 'the lift block is gone').toBeTruthy()
    expect(LIGHT_THEMES.length, 'no light theme found: the theme walk broke').toBeGreaterThan(1)
  })

  it('the three ChartPane rows share ONE lift rule (tab strip, identity row, TF bar)', () => {
    const lists = rules(WS).filter(([sels]) => ROWS.every((r) => sels.includes(r)))
    expect(lists, 'the three rows are not one selector list').toHaveLength(1)
  })

  it('the drag bar is lifted by a rule of its own, so a browser without :has() keeps the rows', () => {
    // one unparseable selector drops its WHOLE list; the floor (Chrome / Firefox 100) lacks :has()
    const withHas = rules(WS).filter(([sels]) => sels.some((s) => s.includes(':has(')) && sels.some((s) => ROWS.includes(s)))
    expect(withHas).toEqual([])
    const bar = rules(WS).filter(([sels]) => sels.length === 1 && sels[0] === DRAG_BAR).map(([, b]) => decls(b))
    expect(bar, 'the chart drag bar is not lifted').toHaveLength(1)
    for (const t of ['--text-muted', '--ut-gold', '--accent', '--border', '--widget-text', '--widget-text-strong']) {
      expect(bar[0].get(t), t).toMatch(/^var\(--pg-/)
    }
    expect(bar[0].get('background')).toBe('var(--pg-bg-elevated)')
  })

  it('a bottom-docked header over a gradient cannot keep its canvas inks: every var WidgetHost sets inline is !important here', () => {
    // review, 2026-11-07: inline custom properties beat a class, so without this the bar
    // went white while its tab labels kept the dark canvas's light grey
    const src = read('pages/charts/WidgetHost.jsx')
    const inline = [...src.slice(src.indexOf('const headerStyle'), src.indexOf('const addMenuTheme'))
      .matchAll(/'(--widget-[\w-]+)'/g)].map((m) => m[1])
    expect(inline.length, 'the inline header vars were found').toBeGreaterThan(4)
    const bar = rules(WS).filter(([sels]) => sels.length === 1 && sels[0] === DRAG_BAR).map(([, b]) => decls(b))[0]
    for (const t of new Set(inline)) expect(bar.get(t), t).toMatch(/^var\(--pg-[\w-]+\)\s*!important$/)
  })

  it('every token the dark block re-asserts is pointed back at the page, through its --pg- twin', () => {
    const darkened = [...DARK_BLOCK.keys()].filter((k) => k.startsWith('--'))
    expect(darkened.length).toBeGreaterThan(30)
    const missing = darkened.filter((t) => LIFT.get(t) !== `var(--pg-${t.slice(2)})`)
    expect(missing, 'darkened by the widget block but not lifted on the chrome rows').toEqual([])
    // a twin may carry a TOKEN fallback (`var(--tick-up-bg, var(--gain-bg))`): the tick tints
    // are set by some themes only, and the terminal theme rail requires every read to resolve
    const bare = (v) => (v || '').replace(/^var\((--[\w-]+),\s*var\(--[\w-]+\)\)$/, 'var($1)')
    const unbound = darkened.filter((t) => bare(ALIASES.get(`--pg-${t.slice(2)}`)) !== `var(${t})`)
    expect(unbound, 'a --pg- twin is not declared on the light <html> as the page token').toEqual([])
  })

  it('the canvas-derived chrome family and --accent are the page\'s on those rows too', () => {
    for (const t of ['--widget-canvas', '--widget-text', '--widget-text-strong', '--widget-accent',
      '--widget-divider', '--widget-popup-bg', '--accent']) {
      expect(LIFT.get(t), t).toMatch(/^var\(--pg-/)
    }
    expect(LIFT.get('background')).toBe('var(--pg-bg-elevated)')
  })

  it('the canvas is NOT lifted: nothing in the lift names the chart fill or the drawing toolbar', () => {
    const lifted = rules(WS).filter(([sels]) => sels.some((s) => s.startsWith(SCOPE) && /chartFill|toolbar|legend/i.test(s)))
    expect(lifted).toEqual([])
  })

  it('every light theme: each ink the rows use clears 4.5:1 on the page header surface', () => {
    const inks = {
      'tf / labels / session (--text-muted)': 'var(--text-muted)',
      'hover (--text)': 'var(--text)',
      'title, values, clock (--text-bright)': 'var(--text-bright)',
      'active TF, rating (--ut-gold)': 'var(--ut-gold)',
      'market cap, earnings (--info)': 'var(--info)',
      'up (--success-ink)': 'var(--success-ink)',
      'down (--danger-ink)': 'var(--danger-ink)',
    }
    expect(failures(inks, ['--bg-elevated'])).toEqual([])
    // the extended-hours pill sits on --bg-surface
    expect(failures({ up: 'var(--success-ink)', down: 'var(--danger-ink)' }, ['--bg-surface'])).toEqual([])
  })

  it('the inline chart colours on those rows are overridden with the same inks as the popup header', () => {
    const want = {
      [`${SCOPE} .chartWidget > .chartHeaderTop [data-day-gain='up']`]: ['color', 'var(--success-ink) !important'],
      [`${SCOPE} .chartWidget > .chartHeaderTop [data-day-gain='down']`]: ['color', 'var(--danger-ink) !important'],
      [`${SCOPE} .chartWidget > .chartHeaderTop [data-testid='sym-label']`]: ['color', 'var(--text-bright) !important'],
      [`${SCOPE} .chartWidget > .tfBar .chartMetaVal`]: ['color', 'var(--text-bright) !important'],
      [`${SCOPE} .chartWidget > .tfBar .chartMetaVal[data-meta-key='rating']`]: ['color', 'var(--accent) !important'],
      [`${SCOPE} .chartWidget > .tfBar .chartMetaVal[data-sign='neg']`]: ['color', 'var(--danger-ink) !important'],
      [`${SCOPE} .chartWidget > .chartHeaderTop [data-delisted]`]: ['color', 'var(--ut-gold) !important'],
    }
    for (const [sel, [prop, val]] of Object.entries(want)) {
      expect(ruleFor(WS, sel).pop()?.get(prop), sel).toBe(val)
    }
    // the delisted badge carries the hook the rule names
    expect(read('components/chart/pane/ChartIdentityRow.jsx')).toMatch(/data-delisted=""/)
  })

  it('CONTROL: the dark widget ink fails on the light header (the arithmetic can fail)', () => {
    const fails = failures({ 'dark muted': DARK_BLOCK.get('--text-muted'), 'dark gold': DARK_BLOCK.get('--ut-gold') }, ['--bg-elevated'])
    expect(fails.some((f) => /^light dark muted /.test(f)), fails.join('\n')).toBe(true)
    expect(fails.some((f) => /^light dark gold /.test(f)), fails.join('\n')).toBe(true)
  })
})

describe('B2: Chart Settings follows the light page', () => {
  const PANEL = ruleFor(CSM, `${LIGHT} .panel`).find((d) => d.has('--menu-bg'))
  const ROOT_MENU = [...TOKENS.matchAll(/(--menu-[\w-]+)\s*:/g)].map((m) => m[1])

  it('the light block re-points EVERY --menu-* token :root defines, above the inline dark palette', () => {
    expect(PANEL, 'the light Chart Settings block is gone').toBeTruthy()
    expect(ROOT_MENU.length).toBeGreaterThan(10)
    const missing = [...new Set(ROOT_MENU)].filter((t) => !PANEL.has(t))
    expect(missing, 'a menu token would stay dark inside the light dialog').toEqual([])
    // ChartPane hands the dialog the dark palette INLINE, so each must be !important to win
    const weak = [...new Set(ROOT_MENU)].filter((t) => !/!important$/.test(PANEL.get(t)))
    expect(weak).toEqual([])
    // every value is a page token or derived from one: a catalog light theme carries its own
    const literal = [...new Set(ROOT_MENU)].filter((t) => t !== '--menu-shadow' && !/var\(--/.test(PANEL.get(t)))
    expect(literal).toEqual([])
    // the field picker it portals beside itself is part of the dialog
    expect(rules(CSM).some(([sels]) => sels.includes(`${LIGHT} .panel`) && sels.includes(`${LIGHT} .fieldMenu`))).toBe(true)
  })

  it('every light theme: each text tier and the accent clear 4.5:1 on the panel and its raised rows', () => {
    const inks = {
      text: PANEL.get('--menu-text'),
      dim: PANEL.get('--menu-text-dim'),
      faint: PANEL.get('--menu-text-faint'),
      accent: PANEL.get('--menu-accent'),
    }
    // --menu-bg (panel) and --menu-bg-top / --menu-input-bg (header, fields, inputs)
    expect(failures(inks, ['--bg-elevated', '--bg-surface'])).toEqual([])
  })

  it('the tiers stay tiers: text > dim > faint on the panel in the default light theme', () => {
    const vars = LIGHT_THEMES.find(([n]) => n === 'light')[1]
    const bg = opaque('var(--bg-elevated)', vars, [255, 255, 255])
    const r = (k) => contrast(opaque(PANEL.get(k), vars, bg), bg)
    expect(r('--menu-text')).toBeGreaterThan(r('--menu-text-dim'))
    expect(r('--menu-text-dim')).toBeGreaterThan(r('--menu-text-faint'))
  })

  it('no white wash is left as a literal: the faint fills ride --csm-ink, which is black on light', () => {
    // A literal inside a var() FALLBACK is not painted while the token is defined (every
    // --menu-* is, on :root and in the light block), so only text outside var() counts.
    const outsideVar = (line) => {
      let out = ''
      let i = 0
      while (i < line.length) {
        const at = line.indexOf('var(', i)
        if (at < 0) { out += line.slice(i); break }
        out += line.slice(i, at)
        let d = 1
        let j = at + 4
        while (j < line.length && d) { if (line[j] === '(') d += 1; else if (line[j] === ')') d -= 1; j += 1 }
        out += 'V'
        i = j
      }
      return out
    }
    const left = CSM.split('\n').filter((l) => /rgba\(255,\s*255,\s*255/.test(outsideVar(l)))
    expect(left, 'a literal white wash would vanish on the light panel').toEqual([])
    expect(PANEL.get('--csm-ink')).toBe('0 0 0')
    expect(CSM).toMatch(/rgb\(var\(--csm-ink, 255 255 255\) \/ 0\.045\)/)   // the selected inspector row
    // --uct-border is undefined, so ITS fallback is painted: it must be the ink wash too
    expect(CSM).toMatch(/var\(--uct-border, rgb\(var\(--csm-ink, 255 255 255\) \/ 0\.14\)\)/)
    // CONTROL: the scan sees a bare literal
    expect(outsideVar('  background: rgba(255, 255, 255, 0.05);')).toMatch(/rgba\(255/)
  })

  it('the dialog\'s native select follows it to light', () => {
    expect(ruleFor(CSM, `${LIGHT} .sizeSelect`).pop()?.get('color-scheme')).toBe('light')
  })

  it('the dark themes are untouched: :root still carries the dark menu palette', () => {
    const root = decls([...TOKENS.matchAll(/:root\s*\{([^]*?)\n\}/g)][0][1])
    expect(root.get('--menu-bg')).toBe('#0e0e10')
    expect(root.get('--menu-text')).toBe('#ededed')
  })
})
