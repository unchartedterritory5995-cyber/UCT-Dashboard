// GP — the shared StockChart, embedded AS-IS (the chart engine is not touched). Drawing
// toolbar and replay off: a panel is a read, the full workspace is /charts.
// `tf` is the command's timeframe argument (`NVDA GP W`, args.js) — daily when none was typed.
// `liveUpdates` and `chartProps` are set by ONE caller, CurrencyPairPanel (a currency pair takes
// no live ticks: the price stream carries stocks). Every registered GP leaves both alone.
import StockChart from '../../../components/StockChart'
import styles from './ChartPanel.module.css'

export default function ChartPanel({ sym, tf = 'D', liveUpdates = true, chartProps = null }) {
  return (
    <div className={styles.chartPanel} data-testid="terminal-chart-panel" data-tf={tf}>
      <StockChart sym={sym} tf={tf} height="100%" showDrawingTools={false} hideReplay liveUpdates={liveUpdates} {...(chartProps || {})} />
    </div>
  )
}
