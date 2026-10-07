/**
 * Treemap view — the original Breadth heatmap, extracted. Groups → metric tiles,
 * color = 8-tier bull/bear system, click → drill. Date cursor lives in the
 * container; this component is pure-render from props.
 */
import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import {
  HM_METRICS_BY_KEY, TREEMAP_DEF,
  TIER_SCORES, TIER_LABELS,
} from '../heatmapMetrics'
import { heatTileInks, TIER_TIP_TOKEN } from '../heatTiles'
import { CHART_FONT_FAMILY } from '../../../utils/chartFont'
import { useThemeInk, CHROME_INK, SEMANTIC_INK, SIZE_INK, ensureContrast } from '../../../lib/theme'

// ⭐ THE TILES FOLLOW THE THEME (owner ruling 2026-10-06): each tier is the app's heat
// ladder (--heat-g3 … --heat-r3, the same tints as the Breadth tables) composited onto
// the theme's ground, carrying the theme's own text inks — heatTiles.js, whose contrast
// rail measures every tier in all 21 themes. The tier's intensity is still the tint's
// strength, so the heat meaning reads on a light page as well as a dark one.
const HEAT_INK = Object.freeze({
  g3: ['--heat-g3', 'rgba(47, 175, 104, 0.62)'],
  g2: ['--heat-g2', 'rgba(47, 175, 104, 0.36)'],
  g1: ['--heat-g1', 'rgba(47, 175, 104, 0.13)'],
  a: ['--heat-a', 'rgba(220, 187, 94, 0.22)'],
  r1: ['--heat-r1', 'rgba(223, 70, 70, 0.13)'],
  r2: ['--heat-r2', 'rgba(223, 70, 70, 0.36)'],
  r3: ['--heat-r3', 'rgba(223, 70, 70, 0.62)'],
})

export default function TreemapView({ currentRow, prevRow, pctileByKey, visibleKeys, signalKey, notableKey, onDrill, options = {} }) {
  const ink = useThemeInk({ bg: CHROME_INK.bg, surface: CHROME_INK.surface, elevated: CHROME_INK.elevated,
    text: CHROME_INK.text, muted: CHROME_INK.muted, gold: SEMANTIC_INK.gold,
    // The "notable" accent: the indicator amber, kept distinct from the gold "signal" border.
    notable: ['--ind-warn', '#ff8100'],
    successInk: ['--success-ink', '#2faf68'], dangerInk: ['--danger-ink', '#e87878'],
    warn: SEMANTIC_INK.warn,
    ...Object.fromEntries(Object.entries(HEAT_INK).map(([k, v]) => [`heat_${k}`, v])),
    ...SIZE_INK })
  const option = useMemo(() => {
    if (!currentRow) return {}
    const tileInk = {
      bg: ink.bg, surface: ink.surface, text: ink.text, muted: ink.muted,
      heat: Object.fromEntries(Object.keys(HEAT_INK).map((k) => [k, ink[`heat_${k}`]])),
    }
    const tipInk = { '--success-ink': ink.successInk, '--danger-ink': ink.dangerInk, '--warn': ink.warn }
    const items = TREEMAP_DEF[0].items.filter(it => visibleKeys.has(it.metricKey))
    const weightBy = options.weightBy ?? 'curated'
    const valFontSize = options.valFontSize ?? 30
    // options.valFontSize: the newsletter's MARKET INTERNALS panel renders
    // narrower tiles than the Breadth page; at 30px a value carrying its
    // tier arrow ("29.0% ▼") truncated to "29...." (9/26). Default unchanged.
    const rich = {
      lbl: { fontSize: ink.sm, fontFamily: CHART_FONT_FAMILY, fontWeight: 700, color: ink.muted, lineHeight: 18 },
      val: { fontSize: valFontSize, fontFamily: CHART_FONT_FAMILY, fontWeight: 700, color: ink.text, lineHeight: Math.round(valFontSize * 4 / 3) },
    }
    // One rich style pair per tier: the text inks heatTileInks picked for THAT tier's fill
    // (each clears 4.5:1 on it, in every theme). The formatter names the tile's own pair.
    const tileFill = {}
    for (const t of [...Object.keys(HEAT_INK), '']) {
      const { fill, value, label } = heatTileInks(t, tileInk)
      tileFill[t] = fill
      rich[`lbl_${t || 'none'}`] = { ...rich.lbl, color: label }
      rich[`val_${t || 'none'}`] = { ...rich.val, color: value }
    }
    const tileWeight = (item) => {
      if (weightBy === 'equal') return 1
      if (weightBy === 'extremity') {
        const sorted = pctileByKey[item.metricKey]
        const raw = currentRow[item.metricKey]
        if (sorted && raw != null && !isNaN(Number(raw))) {
          const v = Number(raw)
          const pct = sorted.filter(x => x <= v).length / sorted.length * 100
          return Math.max(1, Math.abs(pct - 50))
        }
        return 1
      }
      return item.weight  // curated
    }
    const children = items.map(item => {
      const metric = HM_METRICS_BY_KEY[item.metricKey]
      if (!metric) return null
      const tier = metric.getTier(currentRow)
      const val = metric.getFmt(currentRow)
      const color = tileFill[tier] ?? tileFill['']
      let arrow = ''
      if (prevRow && tier) {
        const prevTier = metric.getTier(prevRow)
        const cur = TIER_SCORES[tier] ?? 3
        const prev = TIER_SCORES[prevTier] ?? 3
        if (cur > prev) arrow = ' ▲'; else if (cur < prev) arrow = ' ▼'
      }
      // Canvas treemap can't pulse, so signal/notable get a colored accent border.
      const isSignal = item.metricKey === signalKey
      const isNotable = item.metricKey === notableKey
      const itemStyle = isSignal
        ? { color, borderColor: ink.gold, borderWidth: 2 }
        : isNotable
        ? { color, borderColor: ink.notable, borderWidth: 2 }
        : { color, borderColor: ink.bg, borderWidth: 1 }
      return {
        name: item.metricKey, value: tileWeight(item),
        labelText: (isSignal ? '★ ' : '') + metric.label,
        valText: val + arrow, tier, itemStyle,
      }
    }).filter(Boolean)

    return {
      backgroundColor: 'transparent', animation: false,
      tooltip: {
        trigger: 'item', backgroundColor: ink.elevated, borderColor: ink.gold,
        borderWidth: 1, padding: [8, 12],
        textStyle: { color: ink.text, fontFamily: CHART_FONT_FAMILY, fontSize: ink.sm },
        formatter: params => {
          const d = params.data
          if (!d || !d.tier) return ''
          const metric = HM_METRICS_BY_KEY[d.name]
          if (!metric) return ''
          const score = TIER_SCORES[d.tier]
          const tierLabel = score != null ? (TIER_LABELS[score] ?? '') : 'No signal'
          // Tooltip TEXT, so 4.5:1 against the tooltip's own (themed) surface.
          const tierColor = score != null && TIER_TIP_TOKEN[score]
            ? ensureContrast(tipInk[TIER_TIP_TOKEN[score]], ink.elevated, 4.5)
            : ink.muted
          let pctileStr = ''
          const rawVal = currentRow[d.name]
          const sorted = pctileByKey[d.name]
          if (sorted && rawVal != null && !isNaN(Number(rawVal))) {
            const v = Number(rawVal)
            const pct = Math.round(sorted.filter(x => x <= v).length / sorted.length * 100)
            pctileStr = `p${pct} of ${sorted.length}d`
          }
          return (
            `<div style="min-width:145px;font-family:var(--font-sans)">` +
            `<div style="color:${ink.gold};font-weight:700;margin-bottom:3px">${metric.label}</div>` +
            `<div style="color:${ink.muted};font-size:var(--text-xs);margin-bottom:6px">${currentRow.date}</div>` +
            `<div style="font-size:16px;font-weight:700;margin-bottom:4px">${metric.getFmt(currentRow)}</div>` +
            `<div style="color:${tierColor};font-size:var(--text-xs);letter-spacing:0.5px${pctileStr ? ';margin-bottom:3px' : ''}">${tierLabel}</div>` +
            (pctileStr ? `<div style="color:${ink.muted};font-size:var(--text-xs)">${pctileStr}</div>` : '') +
            `</div>`
          )
        },
      },
      label: {
        show: true,
        formatter: params => {
          if (!params.data.labelText) return ''
          const k = (params.data.tier && rich[`lbl_${params.data.tier}`]) ? params.data.tier : 'none'
          return `{lbl_${k}|${params.data.labelText.toUpperCase()}}\n{val_${k}|${params.data.valText ?? '—'}}`
        },
        rich,
        position: 'inside', align: 'center', verticalAlign: 'middle', overflow: 'truncate',
      },
      upperLabel: { show: false },
      series: [{
        type: 'treemap', data: [{ name: 'main', value: 100, children, itemStyle: { color: 'transparent', borderWidth: 0 } }],
        width: '100%', height: '100%', top: 0, bottom: 0, left: 0, right: 0,
        roam: false, nodeClick: false, breadcrumb: { show: false }, visibleMin: 200,
        levels: [
          // The gutters between tiles are the page's own ground, whatever the theme.
          { itemStyle: { borderWidth: 0, gapWidth: 1, borderColor: ink.bg }, upperLabel: { show: false }, label: { show: false } },
          { itemStyle: { borderWidth: 1, gapWidth: 0, borderColor: ink.bg }, emphasis: { itemStyle: { borderColor: ink.gold, borderWidth: 2 } } },
        ],
      }],
    }
  }, [currentRow, prevRow, pctileByKey, visibleKeys, signalKey, notableKey, options, ink])

  if (!currentRow) return null
  return (
    <div style={{ flex: 1, minHeight: 0, height: '100%' }}>
      <ReactECharts
        option={option} style={{ width: '100%', height: '100%' }}
        opts={{ renderer: 'canvas' }} notMerge
        onEvents={{ click: params => {
          const metric = HM_METRICS_BY_KEY[params.data?.name]
          if (metric?.drillKey) onDrill(metric)
        } }}
      />
    </div>
  )
}
