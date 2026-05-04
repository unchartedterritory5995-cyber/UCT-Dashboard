// app/src/pages/journal/tabs/PsychologyTimeline.jsx
import { useState, useMemo } from 'react'
import useSWR from 'swr'
import ReactECharts from 'echarts-for-react'
import styles from './PsychologyTimeline.module.css'

const fetcher = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json() })

const PERIOD_OPTIONS = [
  { key: '30', label: '30D' },
  { key: '90', label: '90D' },
  { key: '180', label: '180D' },
  { key: '0', label: 'All' },
]

const EMOTION_COLORS = {
  calm: '#3cb868',
  anxious: '#f97316',
  confident: '#14b8a6',
  fearful: '#ef4444',
  disciplined: '#3b82f6',
  frustrated: '#c9a84c',
  euphoric: '#a855f7',
  focused: '#06b6d4',
  impulsive: '#f43f5e',
  patient: '#84cc16',
}

function getEmotionColor(emotion) {
  return EMOTION_COLORS[emotion?.toLowerCase()] || '#888'
}

const CHART_AXIS = {
  axisLine: { show: false },
  axisTick: { show: false },
  splitLine: { lineStyle: { color: '#2e312720' } },
}
const CHART_LABEL = { color: '#706b5e', fontFamily: 'Instrument Sans', fontSize: 9 }
const CHART_TOOLTIP = {
  backgroundColor: '#1a1c17',
  borderColor: '#2e3127',
  textStyle: { color: '#e0dac8', fontFamily: 'Instrument Sans', fontSize: 11 },
}

export default function PsychologyTimeline() {
  const [days, setDays] = useState('90')

  const { data, isLoading } = useSWR(
    `/api/journal/psychology?days=${days}`,
    fetcher,
    { refreshInterval: 300000, dedupingInterval: 300000, revalidateOnFocus: false }
  )

  const processTrend = data?.process_trend || []
  const emotionByWeek = data?.emotion_by_week || []
  const emotionOutcomes = data?.emotion_outcomes || []

  // Top 8 emotions by total count across all weeks
  const topEmotions = useMemo(() => {
    const totals = {}
    emotionByWeek.forEach(w => {
      Object.entries(w.emotions).forEach(([e, c]) => {
        totals[e] = (totals[e] || 0) + c
      })
    })
    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([e]) => e)
  }, [emotionByWeek])

  const qualifiedOutcomes = emotionOutcomes.filter(e => e.trade_count >= 3)

  // Panel 1: Process score trend line
  const processTrendOption = useMemo(() => {
    if (processTrend.length === 0) return null
    return {
      backgroundColor: 'transparent',
      grid: { top: 24, right: 20, bottom: 50, left: 46 },
      tooltip: {
        ...CHART_TOOLTIP,
        trigger: 'axis',
        formatter: (params) => {
          const p = params[0]
          if (!p) return ''
          const tc = processTrend[p.dataIndex]?.trade_count
          const col = p.value >= 70 ? '#3cb868' : p.value >= 30 ? '#c9a84c' : '#ef4444'
          return `<div style="font-size:10px;color:#706b5e;">${p.axisValue}</div>
            <div style="font-size:13px;color:${col};font-weight:700;">${p.value} / 100</div>
            ${tc != null ? `<div style="font-size:10px;color:#706b5e;">${tc} trade${tc !== 1 ? 's' : ''}</div>` : ''}`
        },
      },
      visualMap: {
        show: false,
        pieces: [
          { lte: 30, color: '#ef4444' },
          { gt: 30, lte: 70, color: '#c9a84c' },
          { gt: 70, color: '#3cb868' },
        ],
      },
      xAxis: {
        type: 'category',
        data: processTrend.map(p => p.date),
        axisLine: { lineStyle: { color: '#2e3127' } },
        axisTick: { show: false },
        axisLabel: { ...CHART_LABEL, rotate: 45 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0, max: 100,
        ...CHART_AXIS,
        axisLabel: { ...CHART_LABEL, fontSize: 10 },
      },
      series: [{
        type: 'line',
        data: processTrend.map(p => p.avg_process),
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2 },
        markLine: {
          silent: true,
          symbol: 'none',
          data: [
            { yAxis: 30, lineStyle: { color: '#ef444460', type: 'dashed' }, label: { formatter: '30', color: '#ef4444', fontSize: 9, position: 'end' } },
            { yAxis: 70, lineStyle: { color: '#3cb86860', type: 'dashed' }, label: { formatter: '70', color: '#3cb868', fontSize: 9, position: 'end' } },
          ],
        },
      }],
    }
  }, [processTrend])

  // Panel 2: Emotion by week stacked bar
  const emotionWeekOption = useMemo(() => {
    if (emotionByWeek.length === 0 || topEmotions.length === 0) return null
    return {
      backgroundColor: 'transparent',
      grid: { top: 14, right: 20, bottom: 60, left: 40 },
      tooltip: {
        ...CHART_TOOLTIP,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
      },
      legend: {
        data: topEmotions,
        textStyle: { ...CHART_LABEL },
        bottom: 0,
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
      },
      xAxis: {
        type: 'category',
        data: emotionByWeek.map(w => w.week),
        axisLine: { lineStyle: { color: '#2e3127' } },
        axisTick: { show: false },
        axisLabel: { ...CHART_LABEL, rotate: 45 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        ...CHART_AXIS,
        axisLabel: { ...CHART_LABEL, fontSize: 10 },
      },
      series: topEmotions.map(emotion => ({
        name: emotion,
        type: 'bar',
        stack: 'total',
        data: emotionByWeek.map(w => w.emotions[emotion] || 0),
        itemStyle: { color: getEmotionColor(emotion) },
      })),
    }
  }, [emotionByWeek, topEmotions])

  // Panel 3: Emotion vs outcome horizontal bar
  const emotionOutcomeOption = useMemo(() => {
    if (qualifiedOutcomes.length === 0) return null
    return {
      backgroundColor: 'transparent',
      grid: { top: 10, right: 60, bottom: 20, left: 90 },
      tooltip: {
        ...CHART_TOOLTIP,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params) => {
          const p = params[0]
          if (!p) return ''
          const d = qualifiedOutcomes.find(e => e.emotion === p.name)
          const col = p.value >= 0 ? '#3cb868' : '#ef4444'
          return `<div style="font-size:11px;font-weight:700;color:#e0dac8;">${p.name}</div>
            <div style="color:${col};font-size:12px;">${p.value >= 0 ? '+' : ''}${p.value}%</div>
            ${d ? `<div style="font-size:10px;color:#706b5e;">Win rate: ${d.win_rate}% · ${d.trade_count} trades</div>` : ''}`
        },
      },
      xAxis: {
        type: 'value',
        ...CHART_AXIS,
        axisLabel: { ...CHART_LABEL, fontSize: 10, formatter: v => `${v >= 0 ? '+' : ''}${v}%` },
      },
      yAxis: {
        type: 'category',
        data: qualifiedOutcomes.map(e => e.emotion),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#a8a290', fontFamily: 'Instrument Sans', fontSize: 11 },
      },
      series: [{
        type: 'bar',
        data: qualifiedOutcomes.map(e => ({
          value: e.avg_pnl,
          itemStyle: { color: e.avg_pnl >= 0 ? '#3cb868' : '#ef4444' },
        })),
      }],
    }
  }, [qualifiedOutcomes])

  if (isLoading && !data) {
    return <div className={styles.wrap}><div className={styles.loading}>Loading psychology data...</div></div>
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.periodBar}>
        {PERIOD_OPTIONS.map(p => (
          <button
            key={p.key}
            className={`${styles.periodBtn} ${days === p.key ? styles.periodActive : ''}`}
            onClick={() => setDays(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>Process Score Trend</span>
        </div>
        {processTrendOption
          ? <ReactECharts option={processTrendOption} style={{ height: 220 }} notMerge lazyUpdate />
          : <div className={styles.emptyState}>No scored trades in this period.</div>
        }
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>Emotional State by Week</span>
        </div>
        {emotionWeekOption
          ? <ReactECharts option={emotionWeekOption} style={{ height: 220 }} notMerge lazyUpdate />
          : <div className={styles.emptyState}>No emotion tags recorded yet.</div>
        }
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>Average P&L by Emotional State</span>
        </div>
        {emotionOutcomeOption
          ? <ReactECharts
              option={emotionOutcomeOption}
              style={{ height: Math.max(160, qualifiedOutcomes.length * 28 + 40) }}
              notMerge
              lazyUpdate
            />
          : <div className={styles.emptyState}>Need ≥3 trades per emotion to show outcomes.</div>
        }
      </div>
    </div>
  )
}
