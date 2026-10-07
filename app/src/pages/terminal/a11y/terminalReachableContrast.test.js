// app/src/pages/terminal/a11y/terminalReachableContrast.test.js
//
// RAIL (sibling of terminalContrast.test.js): the terminal's OWN stylesheets are measured there;
// this measures every stylesheet the terminal can MOUNT — the import walk from pages/terminal
// (themeScope.js: static imports, lazy `import()`, CSS `composes`) minus those two directories.
// A Research tab, a tile, a widget opened from a panel is read inside the terminal, so its red and
// green numbers are terminal text.
//
// Two different strengths, on purpose:
//   1. GAIN/LOSS AS TEXT IS ZERO, NOT BASELINED. `--loss`/`--gain` are the chart-candle hues and
//      read 3.18–4.44:1 as text on 13 of 21 themes (a11y-audit-2026-10-06). Text uses
//      `--danger-ink`/`--success-ink`. Fills, strokes, borders, backgrounds and candles keep
//      `--loss`/`--gain` — the check below only looks at `color:` and SVG text `fill:`.
//   2. EVERY OTHER TEXT PAIR IS SHRINK-ONLY against reachableContrast.baseline.json, each file
//      with its reason (menu tokens, widget chart-theme inks owned by components/chart, literal
//      inks, opacity-dimmed base inks). That debt belongs to other lanes and to the tokens; the
//      rail stops it growing and reds until a fixed rule is struck from the baseline.
//
// Owner-blocked files (components/chart/**, StockChart, OptionsFlow, optionsFlow/**,
// journal-2-0/**, useTapeFeed) are not walked by themeScope (NOT_WALKED), so they are neither
// measured nor edited here.
import { describe, it, expect } from 'vitest'
import BASELINE from './__tests__/reachableContrast.baseline.json'
import {
  failingTextRules, lossGainJsLines, lossGainTextUses, reachableCss, reachableFailures, reachableJs,
} from './__tests__/reachableContrast'
import { allThemes } from './__tests__/terminalContrast'

const THEMES = allThemes()
const FILES = reachableCss()
const FAILS = reachableFailures(FILES, THEMES)

/** JS/JSX lines that name --loss/--gain beside `color`/`fill` and are NOT text. Exact file → count. */
const JS_NOT_TEXT = {
  'components/TickerPopup.jsx': { count: 1, why: 'the flow badge BACKGROUND is --gain/--loss; its text is var(--bg)' },
  'components/calendar/CallRecapSection.jsx': { count: 2, why: 'stacked-bar SERIES colours for the analyst-rating chart (bars, not text)' },
  'components/tiles/MARelationship.jsx': { count: 1, why: 'the chip BORDER hue; the chip text uses the separate `ink` (--success-ink/--danger-ink)' },
  'pages/optionsAnalytics/VolSkewPanels.jsx': { count: 1, why: 'heat-map cell FILL mixed between --loss and --gain' },
}

describe('terminal-reachable stylesheets — text contrast in every theme', () => {
  it('walked the reachable stylesheets (non-vacuity)', () => {
    expect(FILES.length).toBeGreaterThan(100)
    expect(FILES).toContain('pages/MorningWire.module.css')
    expect(FILES).toContain('components/tiles/CatalystTable.module.css')
    expect(FILES.some((f) => f.startsWith('pages/terminal/') || f.startsWith('components/terminal/'))).toBe(false)
    expect(FILES.some((f) => /^components\/chart\/|^pages\/journal-2-0\//.test(f))).toBe(false)
  })

  it('no var(--loss)/var(--gain) as text colour in any reachable stylesheet', () => {
    const hits = FILES.flatMap((f) => lossGainTextUses(f))
      .map((h) => `${h.file}:${h.line} ${h.selector} [${h.prop}]`)
    expect(hits, `chart-candle hue used as TEXT — use var(--danger-ink) / var(--success-ink):\n${hits.join('\n')}`).toEqual([])
  })

  it('no inline color/fill var(--loss)/var(--gain) in reachable JS beyond the declared non-text uses', () => {
    const got = {}
    for (const f of reachableJs()) {
      const n = lossGainJsLines(f).length
      if (n) got[f] = n
    }
    const want = Object.fromEntries(Object.entries(JS_NOT_TEXT).map(([f, v]) => [f, v.count]))
    expect(got, 'a new inline --loss/--gain beside color/fill: if it is text use --danger-ink/--success-ink; if it is a fill/border/series, declare it in JS_NOT_TEXT with its reason').toEqual(want)
  })

  it('every other failing text rule is in the shrink-only baseline, file by file', () => {
    const got = Object.fromEntries(Object.entries(FAILS).map(([f, rules]) => [f, rules.length]))
    const want = Object.fromEntries(Object.entries(BASELINE.files).map(([f, v]) => [f, v.count]))
    const grew = Object.keys(got).filter((f) => got[f] > (want[f] || 0))
      .map((f) => `${f}: ${got[f]} > ${want[f] || 0}\n  ${FAILS[f].map((r) => `${r.selector} [${r.prop}] ${r.unreadable || `${r.theme} on ${r.surface} ${r.worst.toFixed(2)} < ${r.bar}`}`).join('\n  ')}`)
    expect(grew, `NEW text under WCAG AA — fix it in a TOKEN, not per theme:\n${grew.join('\n')}`).toEqual([])
    const shrank = Object.keys(want).filter((f) => (got[f] || 0) < want[f]).map((f) => `${f}: ${got[f] || 0} < ${want[f]}`)
    expect(shrank, `a baselined rule now passes — lower its count in reachableContrast.baseline.json:\n${shrank.join('\n')}`).toEqual([])
  })

  it('every baseline entry carries a reason', () => {
    for (const [f, v] of Object.entries(BASELINE.files)) {
      expect(typeof v.why, f).toBe('string')
      expect(v.why.length, f).toBeGreaterThan(20)
      expect(v.count, f).toBeGreaterThan(0)
    }
  })

  it('CONTROL: the text check SEES --loss/--gain as text (plain and with a fallback) and ignores fills/borders', () => {
    const css = '.a { color: var(--loss); }\n.b { color: var(--gain, #4ade80); }\n.c { background: var(--loss); border-color: var(--gain); }\n.barUp { fill: var(--gain); }\n.valueDown { fill: var(--loss); }'
    const hits = lossGainTextUses('fixture.css', css).map((h) => h.selector)
    expect(hits).toEqual(['.a', '.b', '.valueDown'])
    expect(lossGainJsLines('x.jsx', "<b style={{ color: up ? 'var(--gain)' : 'var(--loss)' }} />")).toHaveLength(1)
    expect(lossGainJsLines('x.jsx', "<b style={{ background: 'var(--loss)' }} />")).toHaveLength(0)
  })

  it('CONTROL: the contrast audit SEES a failing rule and records an unreadable one instead of throwing', () => {
    const rules = failingTextRules('fixture.css', '.bad { color: var(--loss); }\n.ok { color: var(--danger-ink); }\n.x { color: var(--no-such-token); }', THEMES)
    expect(rules.map((r) => r.selector)).toEqual(['.bad', '.x'])
    expect(rules[1].unreadable).toMatch(/--no-such-token/)
  })
})
