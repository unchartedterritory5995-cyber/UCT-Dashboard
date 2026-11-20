// A currency pair (Bitcoin, BTC/USD) in a terminal panel. `BTCUSD GP` is the chart, `BTCUSD DES`
// is its price, and every other one-security function says in one sentence that it has nothing
// for a pair.
//
// Not a registered function: `panels.jsx` hands a panel to this component INSTEAD of its own
// when the panel's security is a pair the server admits this member to (lib/cryptoPairs.js;
// dark behind CRYPTO_BARS_ENABLED). With the switch off nothing reaches here.
//
// ⛔ FMP ONLY, AND NEVER "LIVE". The price is `GET /api/crypto/quote/{sym}` (a quote the server
//    holds for a few seconds), shown with FMP's own time for it. The chart is daily, weekly or
//    monthly bars from `/api/bars`, and its header carries the newest bar's own day.
// ⛔ A FIELD FMP DID NOT SEND IS LEFT OUT, never drawn as 0. No price is "no price", in words.
// ⛔ THE CHART TAKES NO LIVE TICKS: the site's price stream carries stocks, not pairs. It is GP's
//    own panel (ChartPanel.jsx), handed in by panels.jsx, with live updates switched off.
//
// The pure half is currencyPairModel.js. Reads go through marketRead.js and lib/cryptoPairs.js
// (SWR, which skips ticks while the app is hidden).
import {
  PanelCommand, PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import { pairQuoteView, pairSourceLine, useCryptoQuote } from '../../../lib/cryptoPairs'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import {
  PAIR_TF_NOTE, newestBarDay, pairChartTf, pairDayNote, pairNewestBarUrl, pairSentence, pairViewOf, quoteFacts,
} from './currencyPairModel'
import market from './marketPanels.module.css'
import styles from './CurrencyPairPanel.module.css'

const BARS_POLL_MS = 5 * 60 * 1000
const sourceOf = (pair) => pair.source || 'FMP'

/** `BTCUSD GP`: the shared chart on daily, weekly or monthly bars, with no live ticks. */
function PairChart({ pair, tf, Chart }) {
  const sym = pair.symbol
  const chart = pairChartTf(tf)
  const newest = useMarketRead(pairNewestBarUrl(sym), { refreshInterval: BARS_POLL_MS })
  const day = newestBarDay(newest.body)
  usePanelFreshness(panelAsOf(`${sourceOf(pair)} daily bars`, day))
  return (
    <div className={styles.chartWrap} data-testid="terminal-pair-chart" data-sym={sym} data-tf={chart.tf}>
      {chart.refused ? <p className={styles.strip} role="status" data-testid="terminal-pair-tf-note">{PAIR_TF_NOTE}</p> : null}
      <div className={styles.chart}>
        {/* GP's own panel (the shared chart), told to take no live ticks and no intraday warm-up */}
        {Chart ? <Chart sym={sym} tf={chart.tf} liveUpdates={false} chartProps={{ breadthSeries: true, watermarkName: pair.name }} /> : null}
      </div>
    </div>
  )
}

/** `BTCUSD DES`: the pair's price and the day's range, with the source and its time. */
function PairQuote({ pair }) {
  const sym = pair.symbol
  const inPanel = useInTerminalPanel()
  const read = useCryptoQuote(sym)
  const view = pairQuoteView(read.quote)
  const priced = view.kind === 'price'
  usePanelFreshness(priced ? panelAsOf(view.source, read.quote.as_of) : null)
  if (read.loading) return <PanelSkeleton label={`Loading the ${sym} price`} testId="terminal-pair-loading" />
  if (!read.quote) {
    const locked = !canRetry(read.error)
    return (
      <PanelState kind={failureKind(read.error)} testId="terminal-pair-error" title={failureText(read.error, `The ${sym} price`)}
        action={locked ? null : <button type="button" className={market.chip} onClick={read.retry}>Retry</button>} />
    )
  }
  if (view.kind === 'waiting') {
    return (
      <PanelState kind="empty" role="status" title={WARMING_TITLE} testId="terminal-pair-waiting">
        The server is reading the {sym} price from {view.source}. This panel asks again on its own.
      </PanelState>
    )
  }
  if (!priced) {
    return (
      <PanelState kind="error" testId="terminal-pair-no-price" title={`${view.source} sent no price for ${sym} on the last read.`}
        action={<button type="button" className={market.chip} onClick={read.retry}>Retry</button>}>
        That is not a price of zero. The chart may still load: <PanelCommand cmd={`${sym} GP`} label={`Price chart for ${sym}`}>{sym} GP</PanelCommand>.
      </PanelState>
    )
  }
  const facts = quoteFacts(read.quote)
  return (
    <div className={`${market.wrap} ${inPanel ? market.inPanel : ''}`} data-testid="terminal-pair-quote" data-sym={sym} data-stale={view.stale ? 'true' : 'false'}>
      <p className={styles.lead}>
        <span className={styles.name}>{pair.name}</span>{' '}
        <span className={market.muted}>{pair.base && pair.quote ? `${pair.base} priced in ${pair.quote}` : sym}</span>
      </p>
      <p className={styles.priceRow}>
        <span className={styles.price} data-testid="terminal-pair-price">{view.price}</span>
        {view.pct ? (
          <span className={`${styles.change} ${styles[view.dir]}`} data-testid="terminal-pair-change" data-dir={view.dir}>
            <span aria-hidden="true">{view.dir === 'up' ? '▲' : view.dir === 'down' ? '▼' : ''}</span>{view.pct}
            <span className={styles.changeNote}> since {view.source}&apos;s previous close</span>
          </span>
        ) : null}
      </p>
      {facts.length ? (
        <dl className={styles.facts} data-testid="terminal-pair-facts">
          {facts.map(([label, text]) => (
            <div key={label} className={styles.fact}><dt>{label}</dt><dd>{text}</dd></div>
          ))}
        </dl>
      ) : null}
      <p className={market.muted} data-testid="terminal-pair-source">
        {pairSourceLine(view)}. {view.stale ? 'This price is older than the newest read; the panel is asking again. ' : ''}
        This panel asks again every 30 seconds, so the price can trail the market.{' '}
        {pairDayNote(pair)} Chart: <PanelCommand cmd={`${sym} GP`} label={`Price chart for ${sym}`}>{sym} GP</PanelCommand>.
        A currency pair has no company behind it, so financials, earnings, ownership and options panels have nothing for it.
      </p>
    </div>
  )
}

/** A one-security function that has nothing for a pair: one sentence, and what does work. */
function PairUnavailable({ panel, pair }) {
  const sym = pair.symbol
  return (
    <PanelState kind="empty" role="status" testId="terminal-pair-unavailable" title={pairSentence(panel, pair)}>
      For {sym}: <PanelCommand cmd={`${sym} GP`} label={`Price chart for ${sym}`}>{sym} GP</PanelCommand> is the chart
      and <PanelCommand cmd={`${sym} DES`} label={`Price for ${sym}`}>{sym} DES</PanelCommand> is the price.
    </PanelState>
  )
}

/** `panel` is the panel name the function asked for, `Panel` that panel's own component. */
export default function CurrencyPairPanel({ panel, pair, tf, Panel = null }) {
  const view = pairViewOf(panel)
  if (view === 'chart') return <PairChart pair={pair} tf={tf} Chart={Panel} />
  if (view === 'quote') return <PairQuote pair={pair} />
  return <PairUnavailable panel={panel} pair={pair} />
}
