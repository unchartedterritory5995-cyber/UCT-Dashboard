import { useCallback, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { heatTileInks, TIER_HEAT_TOKEN } from '../../breadth/heatTiles'
import { CHART_FONT_FAMILY } from '../../../utils/chartFont'
import { useThemeInk, CHROME_INK, SEMANTIC_INK, SIZE_INK } from '../../../lib/theme'
import { buildHeatMap, GROUP_BYS } from './heatMapModel'
import styles from './FocusScreener.module.css'

// The Map view: the screen's results as a treemap (Finviz's map), sized by market cap, coloured
// by the day's change on the app's heat ladder, grouped by sector, industry or theme. The tiles
// follow the theme exactly as the Breadth treemap's do (heatTiles.js: the --heat-* tint composited
// onto the theme's ground, text inks that clear 4.5:1 on it in all 21 themes). A tile opens the
// stock's chart.
const GROUP_KEY = 'uct.screener.mapGroup'
const readLS = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const writeLS = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const TIERS = Object.keys(TIER_HEAT_TOKEN)
const HEAT_INK = Object.fromEntries(TIERS.map(t => [`heat_${t}`, [TIER_HEAT_TOKEN[t], 'transparent']]))
const pct = v => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`)
const cap = v => {
  if (v == null) return 'Market cap unknown'
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  return `$${(v / 1e6).toFixed(0)}M`
}
// A tile's label grows with its share of the map (Finviz's big-name labels): [ticker, change] px.
const LABEL_SIZES = { xl: [26, 15], l: [18, 12], m: [13, 10], s: [10, 9] }
const labelSize = share => (share > 0.08 ? 'xl' : share > 0.03 ? 'l' : share > 0.008 ? 'm' : 's')
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export default function ScreenerHeatMap({ rows, themeData, livePrices, onOpen }) {
  const [groupBy, setGroupBy] = useState(() => {
    const v = readLS(GROUP_KEY, 'sector')
    return GROUP_BYS.some(g => g.key === v) ? v : 'sector'
  })
  const pickGroup = useCallback(k => { setGroupBy(k); writeLS(GROUP_KEY, k) }, [])
  const ink = useThemeInk({ bg: CHROME_INK.bg, surface: CHROME_INK.surface, elevated: CHROME_INK.elevated,
    text: CHROME_INK.text, muted: CHROME_INK.muted, gold: SEMANTIC_INK.gold, ...HEAT_INK, ...SIZE_INK })
  const model = useMemo(() => buildHeatMap(rows, { groupBy, themeData, livePrices }), [rows, groupBy, themeData, livePrices])

  const option = useMemo(() => {
    const tileInk = { bg: ink.bg, surface: ink.surface, text: ink.text, muted: ink.muted,
      heat: Object.fromEntries(TIERS.map(t => [t, ink[`heat_${t}`]])) }
    const fill = {}
    const rich = {}
    for (const t of [...TIERS, '']) {
      const c = heatTileInks(t, tileInk)
      fill[t] = c.fill
      for (const [sz, [tf, cf]] of Object.entries(LABEL_SIZES)) {
        rich[`t_${t || 'none'}_${sz}`] = { fontFamily: CHART_FONT_FAMILY, fontWeight: 700, fontSize: tf, color: c.value, lineHeight: Math.round(tf * 1.25) }
        rich[`c_${t || 'none'}_${sz}`] = { fontFamily: CHART_FONT_FAMILY, fontWeight: 600, fontSize: cf, color: c.label, lineHeight: Math.round(cf * 1.3) }
      }
    }
    const total = model.groups.reduce((s, g) => s + g.value, 0) || 1
    const data = model.groups.map(g => ({
      name: g.name, value: g.value,
      children: g.children.map(c => ({ name: c.ticker, value: c.value, ticker: c.ticker, company: c.company, cap: c.cap, chg: c.chg, tier: c.tier,
        size: labelSize(c.value / total), itemStyle: { color: fill[c.tier] ?? fill[''] } })),
    }))
    return {
      backgroundColor: 'transparent', animation: false,
      tooltip: {
        backgroundColor: ink.elevated, borderColor: ink.gold, borderWidth: 1, padding: [8, 12],
        textStyle: { color: ink.text, fontFamily: CHART_FONT_FAMILY, fontSize: ink.sm },
        formatter: p => {
          const d = p.data
          if (!d?.ticker) return `<b>${esc(p.name)}</b>`
          return `<div style="font-family:var(--font-sans)"><div style="color:${ink.gold};font-weight:700">${esc(d.ticker)}</div>` +
            (d.company ? `<div style="color:${ink.muted}">${esc(d.company)}</div>` : '') +
            `<div>${pct(d.chg)} · ${cap(d.cap)}</div></div>`
        },
      },
      series: [{
        type: 'treemap', data, width: '100%', height: '100%', top: 0, bottom: 0, left: 0, right: 0,
        roam: false, nodeClick: false, breadcrumb: { show: false }, visibleMin: 300, sort: false,
        label: {
          show: true, position: 'inside', align: 'center', verticalAlign: 'middle', overflow: 'truncate', rich,
          formatter: p => {
            const d = p.data
            if (!d?.ticker) return ''
            const k = `${d.tier || 'none'}_${d.size}`
            return `{t_${k}|${d.ticker}}\n{c_${k}|${pct(d.chg)}}`
          },
        },
        levels: [
          // The gutters are the page's own ground, whatever the theme (as the Breadth treemap).
          { itemStyle: { borderWidth: 0, gapWidth: 2, borderColor: ink.bg }, upperLabel: { show: false } },
          // The group: its name on a band above its tiles (Finviz's sector header).
          { itemStyle: { borderWidth: 2, gapWidth: 1, borderColor: ink.bg, color: ink.surface },
            upperLabel: { show: true, height: 20, formatter: '{b}', color: ink.muted, fontFamily: CHART_FONT_FAMILY, fontSize: 11, fontWeight: 700 } },
          { itemStyle: { borderWidth: 1, gapWidth: 0, borderColor: ink.bg }, emphasis: { itemStyle: { borderColor: ink.gold, borderWidth: 2 } } },
        ],
      }],
    }
  }, [model, ink])

  const onEvents = useMemo(() => ({ click: p => { if (p.data?.ticker) onOpen?.(p.data.ticker) } }), [onOpen])
  const shown = model.groups.reduce((s, g) => s + g.children.length, 0)
  return (
    <div className={styles.gridView} data-testid="focus-heat-map">
      <div className={styles.gridBar}>
        <span className={styles.gridCount}>
          {shown ? `${shown.toLocaleString('en-US')} stocks, sized by market cap, coloured by today's change` : 'No results'}
          {model.missingCap > 0 && ` · ${model.missingCap} without a market cap drawn at the smallest size`}
        </span>
        <span className={styles.spacer} />
        <div role="group" aria-label="Group by" className={styles.seg}>
          {GROUP_BYS.map(g => (
            <button key={g.key} type="button" aria-pressed={groupBy === g.key} className={groupBy === g.key ? styles.segOn : styles.segOff}
              onClick={() => pickGroup(g.key)}>{g.label}</button>
          ))}
        </div>
      </div>
      <div className={styles.gridHost}>
        {/* The tiles are canvas, out of reach of a screen reader: the same stocks as a list it can read. */}
        <ul className="sr-only" aria-label="Stocks on the map">
          {model.groups.flatMap(g => g.children.map(c => (
            <li key={c.ticker}><button type="button" onClick={() => onOpen?.(c.ticker)}>{`${c.ticker}, ${g.name}, ${pct(c.chg)}`}</button></li>
          )))}
        </ul>
        <ReactECharts option={option} style={{ width: '100%', height: '100%' }} opts={{ renderer: 'canvas' }} notMerge onEvents={onEvents} />
      </div>
    </div>
  )
}
