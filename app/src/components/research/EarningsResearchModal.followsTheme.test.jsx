// app/src/components/research/EarningsResearchModal.followsTheme.test.jsx
//
// ⭐ THE EARNINGS RESEARCH MODAL FOLLOWS THE MEMBER'S APP THEME (owner ruling, 2026-10-07).
//
// It used to be a dark "theme island": its shell sat on the always-dark `--menu-*` chrome and a
// block pinned every themed token to its dark `:root` value, so the modal stayed dark on a light
// page. The ruling is that it follows the theme like every terminal panel. This file replaces
// `EarningsResearchModal.themeIsland.test.js` and proves the opposite of what that one proved:
//
//   1. the stylesheet declares no island and pins no themed token to a literal;
//   2. the shell reads none of the always-dark `--menu-*` tokens (the menus app-wide keep them);
//   3. every text colour the modal's own stylesheets declare clears WCAG AA against the surfaces
//      it sits on, in ALL 21 themes — measured with the terminal's contrast reader, with the
//      modal's own scope (its `--glass-*` re-pointing) layered over each theme;
//   4. every chart inside it re-resolves its inks through lib/theme when the theme changes.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, relative, sep, dirname, normalize } from 'node:path'
import { render, act } from '@testing-library/react'
import { APP_THEMES } from '../../styles/appThemes'
import {
  allThemes, auditCss, parseRules, declarations, stripComments as stripCss,
} from '../../pages/terminal/a11y/__tests__/terminalContrast'
import { colourLiteralsIn } from '../../pages/terminal/__tests__/themeScope'

let captured = null
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props) => { captured = props; return null },
}))
const { default: LollipopChart } = await import('../research-kit/charts/LollipopChart')
const { CHART_INK } = await import('../research-kit/charts/echartsCore')

const SRC = join(process.cwd(), 'src')
const RESEARCH = join(SRC, 'components', 'research')
const KIT = join(SRC, 'components', 'research-kit')
const MODAL_CSS_PATH = join(RESEARCH, 'EarningsResearchModal.module.css')
const MODAL_CSS = readFileSync(MODAL_CSS_PATH, 'utf8')
const posix = (p) => p.split(sep).join('/')
const read = (p) => readFileSync(p, 'utf8')

function walk(dir, keep) {
  const out = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...walk(p, keep))
    else if (keep(p)) out.push(p)
  }
  return out.sort()
}

/**
 * Every stylesheet the modal draws with — DERIVED by walking its imports from
 * EarningsResearchModal.jsx, never typed. Named imports from the research-kit barrel are resolved
 * to the module that defines them, so a kit component the modal never renders is not counted.
 * The walk stays inside the modal's own trees (research, research-kit, the research tabs it
 * embeds, the terminal kit and Sheet); other surfaces it can OPEN (TickerPopup) are their own.
 */
const WALK_DIRS = ['components/research/', 'components/research-kit/', 'pages/research/', 'components/terminal/', 'components/mobile/']
const KIT_BARREL = join(KIT, 'index.js')
const barrelExports = (() => {
  const map = {}
  for (const m of read(KIT_BARREL).matchAll(/export\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim()
      if (name) map[name] = m[2]
    }
  }
  return map
})()
const resolveSpec = (from, spec) => {
  const base = join(dirname(from), spec)
  const hit = ['', '.js', '.jsx', '/index.js', '/index.jsx'].map((e) => base + e)
    .find((p) => existsSync(p) && statSync(p).isFile())
  return hit && normalize(hit)
}
function modalSheets() {
  const seen = new Set()
  const sheets = new Set()
  const queue = [join(RESEARCH, 'EarningsResearchModal.jsx')]
  while (queue.length) {
    const f = queue.pop()
    if (seen.has(f)) continue
    seen.add(f)
    const rel = posix(relative(SRC, f))
    if (f.endsWith('.css')) { sheets.add(rel); continue }
    const text = read(f).replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of text.matchAll(/import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}\s*)?(?:from\s*)?'(\.[^']+)'/g)) {
      const target = resolveSpec(f, m[3])
      if (!target) continue
      if (target === KIT_BARREL) {
        for (const part of (m[2] || '').split(',')) {
          const name = part.trim().split(/\s+as\s+/)[0].trim()
          const mod = name && barrelExports[name] && resolveSpec(KIT_BARREL, barrelExports[name])
          if (mod) queue.push(mod)
        }
        continue
      }
      if (WALK_DIRS.some((d) => posix(relative(SRC, target)).startsWith(d))) queue.push(target)
    }
    // Lazy `import('./x')` and `export … from './x'` edges.
    for (const m of text.matchAll(/(?:\bimport\(\s*|\bexport\b[^;'"]*?\bfrom\s*)'(\.[^']+)'/g)) {
      const target = resolveSpec(f, m[1])
      if (target && target !== KIT_BARREL && WALK_DIRS.some((d) => posix(relative(SRC, target)).startsWith(d))) queue.push(target)
    }
  }
  return [...sheets].sort()
}
const MODAL_SHEETS = modalSheets()

// ── the themed token set, derived from tokens.css (never typed) ──────────────────────────────
const TOKENS_CSS = stripCss(read(join(SRC, 'styles', 'tokens.css')))
const rootBody = (() => {
  const at = TOKENS_CSS.indexOf(':root {')
  return TOKENS_CSS.slice(at, TOKENS_CSS.indexOf('}', at))
})()
const ROOT_DEFAULTS = new Set([...rootBody.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
const THEMED = new Set()
for (const m of TOKENS_CSS.matchAll(/\[data-theme=[^\]]+\][^{]*\{([^}]*)\}/g)) {
  for (const d of m[1].matchAll(/(--[\w-]+)\s*:/g)) THEMED.add(d[1])
}
const THEMED_WITH_DEFAULT = [...THEMED].filter((t) => ROOT_DEFAULTS.has(t))

/** Custom properties the modal stylesheet declares, anywhere: [selector, name, value]. */
const modalDecls = (css) => parseRules(css).flatMap((r) => [...r.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
  .map((m) => [r.selector.replace(/\s+/g, ' '), m[1], m[2].trim()]))

/** The modal's own scope (`.modal, .sheet`), layered over each theme the way the cascade does. */
function themesWithModalScope(themes = allThemes()) {
  const scope = parseRules(MODAL_CSS).find((r) => /(^|,)\s*\.modal\s*(,|$)/.test(r.selector) && /--glass-/.test(r.body))
  const own = scope ? [...scope.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]) : []
  return Object.fromEntries(Object.entries(themes).map(([name, vars]) => [name, new Map([...vars, ...own])]))
}

const THEMES = themesWithModalScope()

const ROWS = MODAL_SHEETS.flatMap((f) => auditCss(f, read(join(SRC, f)), THEMES))

describe('the earnings research modal follows the member\'s theme', () => {
  it('CONTROL: the themed token set is real (derived from tokens.css)', () => {
    expect(THEMED_WITH_DEFAULT.length).toBeGreaterThan(20)
    expect(THEMED_WITH_DEFAULT).toContain('--text')
    expect(THEMED_WITH_DEFAULT).toContain('--bg-surface')
  })

  it('declares no theme island', () => {
    expect(modalDecls(MODAL_CSS).filter(([, name]) => name === '--theme-island')).toEqual([])
  })

  it('pins no themed token to a literal — anything it declares is a reference that resolves per theme', () => {
    const pinned = modalDecls(MODAL_CSS)
      .filter(([, name, value]) => THEMED_WITH_DEFAULT.includes(name) && !/var\(/.test(value))
      .map(([sel, name, value]) => `${sel} ${name}: ${value}`)
    expect(pinned, `themed tokens pinned to a fixed value:\n${pinned.join('\n')}`).toEqual([])
  })

  it('CONTROL: the pin check sees the island it replaced', () => {
    const island = '.modal, .sheet { --theme-island: x; --text: #f0efea; --bg: #101012; }'
    const pinned = modalDecls(island).filter(([, n, v]) => THEMED_WITH_DEFAULT.includes(n) && !/var\(/.test(v))
    expect(pinned.map(([, n]) => n)).toEqual(['--text', '--bg'])
  })

  it('the shell reads none of the always-dark --menu-* tokens', () => {
    // The menus app-wide keep `--menu-*` (that ruling is unchanged); this modal does not.
    const stripped = stripCss(MODAL_CSS)
    expect(stripped.match(/var\(--menu-[\w-]+/g) ?? []).toEqual([])
    expect(stripCss(read(join(RESEARCH, 'EarningsResearchModal.jsx')))).not.toMatch(/--menu-/)
    // …and it paints on the theme's own surface ramp.
    const modal = parseRules(MODAL_CSS).find((r) => r.selector === '.modal')
    expect(declarations(modal.body).get('background')).toBe('var(--bg-surface)')
  })

  it('hardcodes no colour the theme cannot reach', () => {
    const lits = colourLiteralsIn('components/research/EarningsResearchModal.module.css', MODAL_CSS)
    expect(lits, lits.map((l) => `:${l.line} ${l.lit}`).join('\n')).toEqual([])
  })
})

describe('text contrast inside the modal — all 21 themes', () => {
  it('measures every theme, and real text pairs (non-vacuity)', () => {
    expect(Object.keys(THEMES)).toHaveLength(3 + APP_THEMES.length)
    expect(MODAL_SHEETS).toContain('components/research/EarningsResearchModal.module.css')
    expect(MODAL_SHEETS).toContain('components/research/sections/SetupSection.module.css')
    expect(MODAL_SHEETS).toContain('components/research-kit/shell/IdentityBanner.module.css')
    const sel = new Set(ROWS.filter((r) => r.file.endsWith('EarningsResearchModal.module.css')).map((r) => r.selector))
    expect(sel.has('.notAdvice')).toBe(true)
    expect(sel.has('.close')).toBe(true)
    expect(ROWS.length).toBeGreaterThan(2000)
  })

  it('no text pair falls under its WCAG AA bar', () => {
    const fails = ROWS.filter((r) => !r.pass)
      .map((r) => `${r.file} ${r.selector} [${r.prop}] ${r.theme} on ${r.surface}: ${r.ratio.toFixed(2)} < ${r.bar}`)
    expect(fails, `text under WCAG AA inside the modal:\n${fails.slice(0, 40).join('\n')}`).toEqual([])
  })

  it('CONTROL: the audit would have caught the old always-dark shell ink on a light theme', () => {
    const rows = auditCss('fixture.css', '.close { color: var(--menu-text-faint); }', THEMES)
    expect(rows.some((r) => r.theme === 'light' && !r.pass)).toBe(true)
  })

  it('CONTROL: the kit\'s glass resolves to the theme\'s own surfaces inside the modal', () => {
    // Without the modal-scope re-point, a light page puts the kit's olive-dark translucent glass
    // under near-black text. With it, --glass-surface IS the theme's --bg-elevated.
    expect(THEMES.light.get('--glass-surface')).toBe('var(--bg-elevated)')
    expect(allThemes().light.get('--glass-surface')).toMatch(/^rgba\(34/)
  })
})

// ── charts ─────────────────────────────────────────────────────────────────────────────────────
const KIT_INDEX = read(join(KIT, 'index.js'))
/** research-kit export name → the ./charts/ module that defines it. */
const CHART_EXPORTS = (() => {
  const map = {}
  for (const m of KIT_INDEX.matchAll(/export\s*\{([^}]*)\}\s*from\s*'\.\/charts\/(\w+)'/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim()
      if (name) map[name] = m[2]
    }
  }
  return map
})()
const MODAL_SOURCES = [
  ...walk(RESEARCH, (p) => /\.jsx?$/.test(p) && !/\.test\./.test(p)),
  join(SRC, 'pages', 'research', 'tabs', 'FilingsTab.jsx'),
]
/** The research-kit chart modules the modal's own source renders. */
const MODAL_CHARTS = (() => {
  const used = new Set()
  for (const f of MODAL_SOURCES) {
    for (const m of read(f).matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']*research-kit)'/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim()
        if (CHART_EXPORTS[name] && /^[A-Z]/.test(name)) used.add(CHART_EXPORTS[name])
      }
    }
  }
  return [...used].sort()
})()
const chartSrc = (mod) => read(join(KIT, 'charts', `${mod}.jsx`))
const ECHARTS_CORE = read(join(KIT, 'charts', 'echartsCore.js'))

describe('charts inside the modal follow the theme through lib/theme', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('style')
    captured = null
  })

  it('CONTROL: the modal\'s charts are derived from its imports, not typed', () => {
    expect(MODAL_CHARTS).toEqual(expect.arrayContaining(['LollipopChart', 'ReactionBars', 'SeriesChart', 'ImpliedVsRealized']))
  })

  it('every canvas chart re-resolves its inks via lib/theme/useThemeInk; every DOM chart is token-only', () => {
    expect(ECHARTS_CORE).toMatch(/from '\.\.\/\.\.\/\.\.\/lib\/theme\/useThemeInk'/)
    expect(ECHARTS_CORE).toMatch(/useThemeVersion\(\)/)
    const offenders = []
    for (const mod of MODAL_CHARTS) {
      const src = chartSrc(mod)
      const canvas = /from '\.\/echartsCore'/.test(src)
      if (canvas) {
        // The host (EChart) re-resolves on a theme change; a chart that ALSO resolves inks itself
        // must subscribe through lib/theme too.
        if (/resolveThemeColor\(/.test(src) && !/lib\/theme\/useThemeInk/.test(src)) offenders.push(`${mod}: resolves inks without useThemeInk`)
      } else {
        const lits = colourLiteralsIn(`components/research-kit/charts/${mod}.jsx`, src)
        const css = join(KIT, 'charts', `${mod}.module.css`)
        const cssLits = colourLiteralsIn(`components/research-kit/charts/${mod}.module.css`, read(css))
        if (lits.length || cssLits.length) offenders.push(`${mod}: ${[...lits, ...cssLits].map((l) => l.lit).join(' ')}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the earnings-history lollipop repaints with the light theme\'s inks when the theme changes', async () => {
    const Q = (over) => ({
      quarter: 'Q1 26', report_date: '2026-02-04', period_end: '2025-12-31', session: 'amc', reported: true,
      eps_estimate: 1.0, eps_estimate_low: 0.9, eps_estimate_high: 1.1, eps_actual: 1.2, surprise_pct: 20, ...over,
    })
    const rows = [Q({ quarter: 'Q1 25' }), Q({ quarter: 'Q2 25', eps_actual: 0.8 }), Q({ quarter: 'Q3 25' })]
    render(<LollipopChart quarters={rows} />)
    expect(JSON.stringify(captured.option)).toContain(CHART_INK.muted)
    await act(async () => {
      const el = document.documentElement
      el.setAttribute('data-theme', 'light')
      el.style.setProperty('--text-muted', '#57606a')
      el.style.setProperty('--text', '#1f2328')
    })
    await act(async () => { await Promise.resolve() })
    const after = JSON.stringify(captured.option)
    expect(after).toContain('#57606a')
    expect(after).not.toContain(CHART_INK.muted)
  })
})
