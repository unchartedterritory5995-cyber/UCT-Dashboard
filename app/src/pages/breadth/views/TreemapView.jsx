/**
 * Treemap view — the original Breadth heatmap, extracted. Groups → metric tiles,
 * color = 8-tier bull/bear system, click → drill. Date cursor lives in the
 * container; this component is pure-render from props.
 */
import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import {
  HM_METRICS_BY_KEY, TREEMAP_DEF, TIER_CELL_COLORS,
  TIER_SCORES, TIER_LABELS, TIER_TIP_COLORS,
} from '../../Breadth'

export default function TreemapView({ currentRow, prevRow, pctileByKey, visibleKeys, signalKey, notableKey, onDrill, options = {} }) {
  const option = useMemo(() => {
    if (!currentRow) return {}
    const items = TREEMAP_DEF[0].items.filter(it => visibleKeys.has(it.metricKey))
    const weightBy = options.weightBy ?? 'curated'
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
      const color = TIER_CELL_COLORS[tier] ?? TIER_CELL_COLORS['']
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
        ? { color, borderColor: '#c9a84c', borderWidth: 2 }
        : isNotable
        ? { color, borderColor: '#fbbf24', borderWidth: 2 }
        : { color, borderColor: 'rgba(0,0,0,0.35)', borderWidth: 1 }
      return {
        name: item.metricKey, value: tileWeight(item),
        labelText: (isSignal ? '★ ' : '') + metric.label,
        valText: val + arrow, tier, itemStyle,
      }
    }).filter(Boolean)

    return {
      backgroundColor: 'transparent', animation: false,
      tooltip: {
        trigger: 'item', backgroundColor: 'rgba(8,8,8,0.96)', borderColor: '#c9a84c',
        borderWidth: 1, padding: [8, 12],
        textStyle: { color: '#e0e0e0', fontFamily: 'Instrument Sans, sans-serif', fontSize: 11 },
        formatter: params => {
          const d = params.data
          if (!d || !d.tier) return ''
          const metric = HM_METRICS_BY_KEY[d.name]
          if (!metric) return ''
          const score = TIER_SCORES[d.tier]
          const tierLabel = score != null ? (TIER_LABELS[score] ?? '') : 'No signal'
          const tierColor = score != null ? (TIER_TIP_COLORS[score] ?? '#666') : '#666'
          let pctileStr = ''
          const rawVal = currentRow[d.name]
          const sorted = pctileByKey[d.name]
          if (sorted && rawVal != null && !isNaN(Number(rawVal))) {
            const v = Number(rawVal)
            const pct = Math.round(sorted.filter(x => x <= v).length / sorted.length * 100)
            pctileStr = `p${pct} of ${sorted.length}d`
          }
          return (
            `<div style="min-width:145px;font-family:Instrument Sans,sans-serif">` +
            `<div style="color:#c9a84c;font-weight:700;margin-bottom:3px">${metric.label}</div>` +
            `<div style="color:#555;font-size:10px;margin-bottom:6px">${currentRow.date}</div>` +
            `<div style="font-size:16px;font-weight:700;margin-bottom:4px">${metric.getFmt(currentRow)}</div>` +
            `<div style="color:${tierColor};font-size:10px;letter-spacing:0.5px${pctileStr ? ';margin-bottom:3px' : ''}">${tierLabel}</div>` +
            (pctileStr ? `<div style="color:#555;font-size:10px">${pctileStr}</div>` : '') +
            `</div>`
          )
        },
      },
      label: {
        show: true,
        formatter: params => {
          if (!params.data.labelText) return ''
          return `{lbl|${params.data.labelText.toUpperCase()}}\n{val|${params.data.valText ?? '—'}}`
        },
        rich: {
          lbl: { fontSize: 11, fontFamily: 'Instrument Sans, sans-serif', fontWeight: 700, color: 'rgba(255,255,255,0.60)', lineHeight: 18 },
          val: { fontSize: 30, fontFamily: 'Instrument Sans, sans-serif', fontWeight: 700, color: '#ffffff', lineHeight: 40 },
        },
        position: 'inside', align: 'center', verticalAlign: 'middle', overflow: 'truncate',
      },
      upperLabel: { show: false },
      series: [{
        type: 'treemap', data: [{ name: 'main', value: 100, children, itemStyle: { color: 'transparent', borderWidth: 0 } }],
        width: '100%', height: '100%', top: 0, bottom: 0, left: 0, right: 0,
        roam: false, nodeClick: false, breadcrumb: { show: false }, visibleMin: 200,
        levels: [
          { itemStyle: { borderWidth: 0, gapWidth: 1, borderColor: '#0a0f1a' }, upperLabel: { show: false }, label: { show: false } },
          { itemStyle: { borderWidth: 1, gapWidth: 0, borderColor: '#0a0f1a' }, emphasis: { itemStyle: { borderColor: '#c9a84c', borderWidth: 2 } } },
        ],
      }],
    }
  }, [currentRow, prevRow, pctileByKey, visibleKeys, signalKey, notableKey, options])

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
