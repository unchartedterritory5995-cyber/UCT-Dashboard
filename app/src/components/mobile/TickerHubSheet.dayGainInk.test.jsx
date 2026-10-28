// The Ticker Hub sheet's day-change numbers read as TEXT at >= 4.5:1 in every app theme.
//
// Measured in WebKit (axe, live site, 390 touch): a ticker DOWN in pre-market showed its
// "PRE -32.24 (-7.02%)" pill in the chart-header red (#ff3b47 / the chart theme's own red) on
// the pill's grey tint, 3.8:1 in dark. In the light app theme (local WebKit, route-mocked /api)
// it read 2.8:1, and the regular-session number beside it 3.5:1 on the white header.
//
// Why the hub and not the /charts workspace: the hub's chart header sits on an APP surface
// (`--widget-canvas` is unset there, so it falls back to `--bg-elevated`), which is exactly what
// the text inks are calibrated against. A workspace header sits on a chart-theme canvas the
// app inks know nothing about, so that surface keeps the chart's own colours.
//
// The fix: ChartDayGain (and ChartIdentityRow's index branch) mark each number with its
// direction (`data-day-gain="up|down"`), and ChartsWorkspace.module.css, scoped to the hub's
// `data-ticker-hub-chart` area, colours it with `--success-ink` / `--danger-ink`, never the
// candle hues (`terminalReachableContrast`'s rule). `!important` because the chart colour is an
// inline style. Not media-gated: the inks are right on the hub at every width.
//
// ⛔ The inks alone were NOT enough: the pill's own tint (`--text-muted` at 16% over the header)
// lifts a dark surface, and the inks read 3.6-4.4:1 on it in 13 of 21 themes. So in the hub the
// pill sits on `--bg-surface` instead -- a flat app surface the inks are calibrated against, one
// step off `--bg-elevated` in every theme so it still reads as a pill (worst 5.17:1, Sand).
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { allThemes, parseColor, resolveVars } from '../../pages/terminal/a11y/__tests__/terminalContrast'
import { contrast, composite } from '../../styles/__tests__/contrastMath'

const QUOTE = { current: {} }
vi.mock('../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: { CLS: QUOTE.current } }) }))
vi.mock('../../hooks/useRealtimeBarPrices', async (orig) => ({ ...(await orig()), default: () => ({}) }))
vi.mock('../../pages/charts/WorkspaceContext', () => ({ useWorkspace: () => ({ chartsTheme: 'dark' }) }))

const { default: ChartIdentityRow } = await import('../chart/pane/ChartIdentityRow')

const SRC = join(process.cwd(), 'src')
const read = (p) => readFileSync(join(SRC, p), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const WS_CSS = stripComments(read('pages/charts/ChartsWorkspace.module.css'))
const HUB_JSX = read('components/mobile/TickerHubSheet.jsx')
const SCOPE = ':global([data-ticker-hub-chart]) .chartHeaderTop'
const INK = { up: '--success-ink', down: '--danger-ink' }

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

/** The value a rule whose selector list holds exactly `selector` gives `prop`, or null. */
function declared(css, selector, prop) {
  for (const [, sels, decls] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!sels.split(',').some((s) => s.trim() === selector)) continue
    const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+?)\\s*(?:;|$)`).exec(decls.trim())
    if (m) return m[1]
  }
  return null
}

const inkRule = (dir, css = WS_CSS) => declared(plainRules(css), `${SCOPE} [data-day-gain='${dir}']`, 'color')
/** The rule's selector as the DOM sees it: `:global(x)` unwrapped, the module class left plain
 *  (the rows below render ChartIdentityRow with an identity `styles` map). */
const domSelector = (dir) => `${SCOPE} [data-day-gain='${dir}']`.replace(/:global\((\[[^\]]*\])\)/, '$1')
const STYLES = { chartHeaderTop: 'chartHeaderTop', chartDayGain: 'chartDayGain', headerTopRight: 'headerTopRight' }

/** Render the identity row as the hub mounts it (inside its scope) and return the marked numbers. */
function hubRow(props) {
  const { container, unmount } = render(
    <div data-ticker-hub-chart=""><ChartIdentityRow sym="CLS" displayLabel="CLS" showClock={false} styles={STYLES}
      dayGainColors={{ up: '#1ae51a', down: '#ff3b47' }} {...props} /></div>)
  return { marked: [...container.querySelectorAll('[data-day-gain]')], unmount }
}

function quote(dir) {
  const prev = 459.3
  const ext = dir === 'down' ? 427.06 : 491.54
  return { price: ext, ext_price: ext, ext_session: 'pre_market', prev_close: prev,
    prev_change_pct: dir === 'down' ? -1.85 : 1.85, prev_change: dir === 'down' ? -8.5 : 8.5 }
}

describe('Ticker Hub day-change text uses the text inks', () => {
  it('the hub scope colours each direction with its ink, on every device', () => {
    for (const dir of ['up', 'down']) {
      expect(inkRule(dir), dir).toBe(`var(${INK[dir]}) !important`)
    }
  })

  it('the hub chart area carries the scope the rule names (the wire)', () => {
    expect(HUB_JSX).toMatch(/<div className=\{styles\.chartWrap\} data-ticker-hub-chart="">/)
  })

  for (const dir of ['down', 'up']) {
    it(`ChartDayGain marks BOTH numbers ${dir}, and the hub rule reaches them (regular + pre-market pill)`, () => {
      QUOTE.current = quote(dir)
      const { marked, unmount } = hubRow({})
      expect(marked.map((e) => e.getAttribute('data-day-gain'))).toEqual([dir, dir])
      expect(marked[1].textContent).toMatch(/^Pre/)
      for (const el of marked) expect(el.matches(domSelector(dir)), el.textContent).toBe(true)
      unmount()
    })
  }

  it('ChartIdentityRow\'s index branch (its own span, outside ChartDayGain) is marked and reached too', () => {
    const { marked, unmount } = hubRow({ dayGain: { up: false, abs: -3.1, pct: -0.52 } })
    expect(marked.map((e) => e.getAttribute('data-day-gain'))).toEqual(['down'])
    expect(marked[0].matches(domSelector('down'))).toBe(true)
    // CONTROL: the same span outside the hub scope is not reached
    expect(marked[0].matches(domSelector('down').replace('[data-ticker-hub-chart] ', '[data-elsewhere] '))).toBe(false)
    unmount()
  })

  // The hub header's surface: `.chartHeaderTop`'s own background, with `--widget-canvas` UNSET
  // (only WidgetHost publishes it, and the hub is not a workspace widget) -- so its fallback.
  const HEADER_BG = declared(plainRules(WS_CSS), '.chartHeaderTop', 'background')
  const PILL_BG = declared(plainRules(WS_CSS), `:global([data-ticker-hub-chart]) .chartDayGainExt`, 'background')
  const opaque = (value, vars, under) => {
    const c = parseColor(resolveVars(value, vars))
    return c.alpha >= 1 ? c.rgb.map(Math.round) : composite(c.rgb, c.alpha, under)
  }

  /** Every [theme, dir, where, ratio] below 4.5 for a given pill background. */
  function inkFailures(pillBg) {
    const fails = []
    for (const [name, raw] of Object.entries(allThemes())) {
      const vars = new Map(raw)
      vars.delete('--widget-canvas')
      const header = opaque(HEADER_BG, vars, [0, 0, 0])
      const pill = opaque(pillBg, vars, header)
      for (const [dir, token] of Object.entries(INK)) {
        const ink = opaque(`var(${token})`, vars, header)
        for (const [where, bg] of [['header', header], ['pill', pill]]) {
          const r = contrast(ink, bg)
          if (r < 4.5) fails.push(`${name} ${dir} on ${where}: ${r.toFixed(2)}`)
        }
      }
    }
    return fails
  }

  it('every app theme: each ink clears 4.5:1 on the hub header AND on the hub pill', () => {
    expect(Object.keys(allThemes()).length).toBeGreaterThanOrEqual(15)
    expect(HEADER_BG).toMatch(/var\(--widget-canvas, var\(--bg-elevated/)
    expect(PILL_BG, 'the hub pill background').not.toBeNull()
    expect(inkFailures(PILL_BG)).toEqual([])
  })

  it('the hub pill still reads as a pill: never the header colour, in any theme', () => {
    const same = Object.entries(allThemes()).filter(([, raw]) => {
      const vars = new Map(raw)
      vars.delete('--widget-canvas')
      const header = opaque(HEADER_BG, vars, [0, 0, 0])
      return opaque(PILL_BG, vars, header).join() === header.join()
    }).map(([n]) => n)
    expect(same).toEqual([])
  })

  it('CONTROL: the workspace pill tint fails the same check (the math can fail)', () => {
    const tint = declared(plainRules(WS_CSS), '.chartDayGainExt', 'background')
    expect(tint).toMatch(/color-mix/)
    expect(inkFailures(tint).length).toBeGreaterThan(10)
  })

  it('CONTROL: a candle hue, an unscoped or a phone-only rule does not count as the fix', () => {
    const hue = `${SCOPE} [data-day-gain='down'] { color: var(--loss) !important; }`
    const unscoped = `.chartDayGainWrap [data-day-gain='down'] { color: var(--danger-ink) !important; }`
    const phoneOnly = `@media (max-width: 640px) { ${SCOPE} [data-day-gain='down'] { color: var(--danger-ink) !important; } }`
    const noImportant = `${SCOPE} [data-day-gain='down'] { color: var(--danger-ink); }`
    for (const css of [hue, unscoped, phoneOnly, noImportant]) expect(inkRule('down', css)).not.toBe('var(--danger-ink) !important')
    expect(inkRule('down', `${SCOPE} [data-day-gain='down'] { color: var(--danger-ink) !important; }`)).toBe('var(--danger-ink) !important')
  })
})
