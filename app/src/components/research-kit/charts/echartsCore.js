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
import { BarChart, CustomChart } from 'echarts/charts'
import {
  AxisPointerComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import EChartsReactCore from 'echarts-for-react/lib/core'
import { CHART_FONT_FAMILY } from '../../../utils/chartFont'
import styles from './echartsCore.module.css'

echarts.use([BarChart, CustomChart, GridComponent, TooltipComponent, MarkLineComponent, AxisPointerComponent, CanvasRenderer])

export { echarts }

/** Token hexes mirrored for canvas. Keep in sync with app/src/styles/tokens.css. */
export const CHART_INK = {
  gain: '#3cb868',
  loss: '#e74c3c',
  gold: '#c9a84c',
  text: '#b6b09d',
  muted: '#8c8674',
  bright: '#e0dac8',
  /** ~8% warm white — Part C rule 5: 3-4 hairline gridlines, no spine, no box. */
  grid: 'rgba(224, 218, 200, 0.08)',
  /** Tooltip surface: --glass-chrome's dark value, so tip text is never on translucency. */
  tooltipBg: 'rgba(20, 22, 18, 0.94)',
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
  const resolved = useMemo(
    () => ({ animation: !prefersReducedMotion(), animationDuration: 300, ...option }),
    [option],
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
