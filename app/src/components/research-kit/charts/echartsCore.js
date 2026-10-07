// app/src/components/research-kit/charts/echartsCore.js
//
// THE single ECharts entry point for research-kit (spec §3.4). Every kit chart
// imports `EChart` from here. No other new file may import 'echarts' or
// 'echarts-for-react' directly.
//
// WHY: the full entry (`import ReactECharts from 'echarts-for-react'`, which
// app/src/pages/BreadthCharts.jsx:3 still uses) drags ~1MB min / ~340KB gz of
// echarts in. This module imports 'echarts/core' plus exactly the charts and
// components the kit draws, and registers them once. Adding a chart type means
// adding it HERE, deliberately — echartsCore.test.jsx pins the list.
//
// HONEST BUNDLE NOTE (spec §3.4): while ANY full-entry import survives
// (BreadthCharts, breadth/views/TreemapView, 3 Journal 2.0 files) vendor-echarts
// still contains all of echarts, so this module cannot SHRINK the chunk — it
// must simply not grow it. The shrink lands in P5 when those 5 files migrate.
//
// Canvas cannot read CSS custom properties, so CHART_INK mirrors the token
// hexes as literals — the same reason app/src/utils/chartFont.js exists.
// echartsCore.test.jsx pins the mirror to tokens.css so a token retune fails
// the test instead of the two silently forking. The DARK values are mirrored:
// light-theme glass is a deliberate deferral (§3.2), and these surfaces are
// dark-only.
// NOTE: this file is intentionally `.js`, not `.jsx` — but Vite's esbuild
// transform only enables JSX parsing for `.jsx`/`.tsx`. Rather than rename
// (the file list + registration-source-text test both pin `echartsCore.js`)
// the one JSX return below is written with `createElement` instead.
import { useMemo, createElement } from 'react'
import * as echarts from 'echarts/core'
// LineChart: BRK-01 increment 3's vol smile and term structure (pages/research/tabs/volSurface.js).
import { BarChart, CustomChart, LineChart } from 'echarts/charts'
import {
  AxisPointerComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import EChartsReactCore from 'echarts-for-react/lib/core'
import { CHART_FONT_FAMILY } from '../../../utils/chartFont'
import { resolveThemeColor, withAlpha } from '../../../lib/theme/resolveThemeColor'
import { useThemeVersion } from '../../../lib/theme/useThemeInk'
import styles from './echartsCore.module.css'

echarts.use([BarChart, CustomChart, LineChart, GridComponent, TooltipComponent, MarkLineComponent, AxisPointerComponent, CanvasRenderer])

export { echarts }

/** Token hexes mirrored for canvas. Keep in sync with app/src/styles/tokens.css. */
export const CHART_INK = {
  gain: '#2faf68',
  loss: '#df4646',
  gold: '#dcbb5e',
  text: '#f0efea',
  muted: '#cfcac0',
  bright: '#f8f7f3',
  /** The default single-series ink (SeriesChart rank/band fallback) — the body text. */
  ink: '#f0efea',
  /** ~8% warm white — Part C rule 5: 3-4 hairline gridlines, no spine, no box. */
  grid: 'rgba(224, 218, 200, 0.08)',
  /** Tooltip surface: --glass-chrome's dark value, so tip text is never on translucency. */
  tooltipBg: 'rgba(20, 22, 18, 0.94)',
  /** A receding comparison series (statement panels' year-ago ghost): ~20% of the body text. */
  ghost: 'rgba(255, 255, 255, 0.2)',
}

/** No axis spine, no ticks, muted 10px labels. Part C rule 5. */
export function axisBase(extra = {}) {
  return {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: CHART_INK.muted, fontFamily: CHART_FONT_FAMILY, fontSize: 10 },
    splitLine: { show: false },
    ...extra,
  }
}

/** Tight grid — the kit's charts are card-resident, not page-resident. */
export const GRID_BASE = { left: 44, right: 14, top: 16, bottom: 24, containLabel: false }

export const TOOLTIP_BASE = {
  backgroundColor: CHART_INK.tooltipBg,
  borderWidth: 0,
  padding: [6, 10],
  textStyle: { color: CHART_INK.bright, fontFamily: CHART_FONT_FAMILY, fontSize: 11 },
}

/** True when the user asked for reduced motion. Canvas can't use a CSS media
 *  query, so ECharts animation is gated in JS instead (Part C rule 8). */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return !!window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const FILL = { width: '100%', height: '100%' }

/**
 * ⭐ THE KIT'S CHARTS FOLLOW THE MEMBER'S THEME HERE, AT THE ONE HOST.
 *
 * Every option the kit builds carries CHART_INK's DARK literals (and some
 * callers hand a `var(--token)` string, which a canvas silently drops). Rather
 * than thread a theme through every builder, the host swaps them at render:
 *   • a `var(--x[, fallback])` string → the token's resolved value;
 *   • a CHART_INK literal → the token it mirrors, resolved now.
 * Strings are swapped only on an EXACT match, so HTML tooltip bodies and data
 * are untouched. In jsdom no token is set, so every swap resolves to the
 * literal it replaces and the option is unchanged.
 */
const INK_TOKEN = [
  [CHART_INK.gain, () => resolveThemeColor('--gain', CHART_INK.gain)],
  [CHART_INK.loss, () => resolveThemeColor('--loss', CHART_INK.loss)],
  [CHART_INK.gold, () => resolveThemeColor('--ut-gold', CHART_INK.gold)],
  [CHART_INK.text, () => resolveThemeColor('--text', CHART_INK.text)],
  [CHART_INK.muted, () => resolveThemeColor('--text-muted', CHART_INK.muted)],
  [CHART_INK.bright, () => resolveThemeColor('--text-bright', CHART_INK.bright)],
  [CHART_INK.grid, () => {
    const t = resolveThemeColor('--text', null)
    return t ? withAlpha(t, 0.1) : CHART_INK.grid
  }],
  [CHART_INK.ghost, () => {
    const t = resolveThemeColor('--text', null)
    return t ? withAlpha(t, 0.22) : CHART_INK.ghost
  }],
  [CHART_INK.tooltipBg, () => {
    const b = resolveThemeColor('--bg-elevated', null)
    return b ? withAlpha(b, 0.97) : CHART_INK.tooltipBg
  }],
]

function inkTable() {
  const m = new Map()
  for (const [lit, fn] of INK_TOKEN) if (!m.has(lit.toLowerCase())) m.set(lit.toLowerCase(), fn())
  return m
}

const VAR_RE = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)$/

/** One colour string through the same swap the host applies to a whole option. */
export function resolveChartInk(color, table = inkTable()) {
  return themeOptionInks(color, table)
}

/** Pure: a copy of `option` with theme literals and `var()` strings resolved. */
export function themeOptionInks(option, table = inkTable()) {
  const walk = (v) => {
    if (typeof v === 'string') {
      const s = v.trim()
      const m = VAR_RE.exec(s)
      if (m) return resolveThemeColor(m[1], m[2] ? m[2].trim() : v)
      const hit = table.get(s.toLowerCase())
      return hit === undefined ? v : hit
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const out = {}
      for (const k of Object.keys(v)) out[k] = walk(v[k])
      return out
    }
    return v
  }
  return walk(option)
}

/**
 * The kit's ECharts host.
 *
 * A canvas is invisible to assistive tech, so the wrapper is `role="img"` with
 * a caller-built `aria-label` that states the chart's actual finding — never
 * "chart". `height` comes from the component's exported SIZE so SkeletonBlock
 * can reserve the identical box (§3.4 size contract); it is the one inline
 * style here, and it is computed geometry, not a token.
 */
export default function EChart({
  option,
  height = 220,
  ariaLabel,
  className = '',
  onEvents,
  testId = 'rk-echart',
}) {
  // Re-resolve the inks when the member switches theme.
  const themeVersion = useThemeVersion()
  const resolved = useMemo(
    () => ({ animation: !prefersReducedMotion(), animationDuration: 300, ...themeOptionInks(option) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [option, themeVersion],
  )

  return createElement(
    'div',
    {
      className: `${styles.wrap} ${className}`,
      role: 'img',
      'aria-label': ariaLabel,
      'data-testid': testId,
      style: { height },
    },
    createElement(EChartsReactCore, {
      echarts,
      option: resolved,
      notMerge: true,
      lazyUpdate: true,
      opts: { renderer: 'canvas' },
      style: FILL,
      onEvents,
    }),
  )
}
