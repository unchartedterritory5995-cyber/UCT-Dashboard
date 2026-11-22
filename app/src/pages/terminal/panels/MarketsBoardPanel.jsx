// MKTS: the markets board. Index funds, volatility, Treasury yields and Bitcoin on one screen,
// each group with its own source and its own as-of. `MKTS` takes no argument.
//
// Reads (all existing; nothing is written):
//   GET /api/snapshot                   index funds, VIX and Bitcoin (signed in). Read again every
//                                       30 seconds through SWR, which skips ticks while the app is hidden.
//   GET /api/research/treasury-yields   the Treasury's daily curve (paid): the SAME stamped read RATES uses
//   GET /api/crypto/pairs, /quote/BTCUSD   Bitcoin with FMP's own time, when that route is switched on
// The pure half is marketsBoardModel.js, re-exported below.
//
// ⛔ WHAT THIS PANEL NEVER DOES
//   * It never draws a missing price as 0. A leg the server could not price is named in words.
//   * It never blends the sources' times: the snapshot says when this screen read it (it carries
//     no time of its own), the yields carry the curve's date, Bitcoin carries FMP's time.
//   * It never says "live", and it never shows a change in points the data does not carry.
//   * It never links `BTC` as Bitcoin (that is a fund's ticker): only the BTCUSD pair is a link.
//   * It has no futures, gold, oil or dollar rows: the data it reads holds none.
import { useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import { pairQuoteView, pairSourceLine, useCryptoPair, useCryptoQuote } from '../../../lib/cryptoPairs'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { RATES_URL, SOURCE as RATES_SOURCE, ratesRead, unavailableWords } from './ratesModel'
import {
  MKTS_CODE, MKTS_PAIR, MKTS_POLL_MS, MKTS_RATES_HELD_POLL_MS, MKTS_RATES_WARMING_POLL_MS, MKTS_SNAPSHOT_SOURCE, MKTS_SNAPSHOT_URL, MKTS_WHAT, bitcoinRow, missingLine, ratesAsOf, ratesRows,
  snapshotAsOf, snapshotRead,
} from './marketsBoardModel'
import styles from './marketPanels.module.css'

const RATES_WHAT = 'Treasury yields'

const signClass = (dir) => (dir === 'up' ? styles.up : dir === 'down' ? styles.down : undefined)

/** A group's header row: its name and its own as-of words. */
function GroupHead({ name, asOf, testId }) {
  return (
    <tr>
      <th scope="rowgroup" colSpan={3} className={styles.phoneWrap} data-testid={testId}>
        {name}{asOf ? <span className={styles.muted}>{` (${asOf})`}</span> : null}
      </th>
    </tr>
  )
}

/** One priced row, or the row saying in words that it has no price. */
function PriceRow({ name, price, chg, dir, testId }) {
  return (
    <tr data-testid={testId} data-priced={price != null ? 'yes' : 'no'}>
      <th scope="row" className={styles.phoneWrap}>{name}</th>
      {price != null ? (
        <>
          <td data-testid={`${testId}-last`}>{price}</td>
          <td data-testid={`${testId}-chg`}>
            {chg != null ? <span className={signClass(dir)}>{chg}</span> : <span className={styles.muted}>n/a</span>}
          </td>
        </>
      ) : (
        <td colSpan={2} className={styles.phoneWrap}><span className={styles.muted}>No price right now</span></td>
      )}
    </tr>
  )
}

/** A group that has words instead of rows (a read that failed, is locked or is still being built). */
function WordsRow({ children, testId }) {
  return (
    <tr>
      <td colSpan={3} className={styles.phoneWrap} data-testid={testId}><span className={styles.muted}>{children}</span></td>
    </tr>
  )
}

const retryButton = (onClick, testId) => (
  <button type="button" className={styles.linkBtn} onClick={onClick} data-testid={testId}>Retry</button>
)

export default function MarketsBoardPanel() {
  const inPanel = useInTerminalPanel()
  const code = inPanel?.code || MKTS_CODE
  const [ratesPace, setRatesPace] = useState(MKTS_RATES_HELD_POLL_MS)
  const snap = useMarketRead(MKTS_SNAPSHOT_URL, { refreshInterval: MKTS_POLL_MS })
  const rates = useMarketRead(RATES_URL, { refreshInterval: ratesPace })
  const pair = useCryptoPair(MKTS_PAIR)
  const quote = useCryptoQuote(MKTS_PAIR, !!pair)

  const snapView = useMemo(() => snapshotRead(snap.body), [snap.body])
  const ratesView = useMemo(() => ratesRead(rates.body), [rates.body])
  // The pace follows the server's own word (adjusted during render from the last answer).
  const wantPace = rates.body && ratesView.state === 'computing' ? MKTS_RATES_WARMING_POLL_MS : MKTS_RATES_HELD_POLL_MS
  if (wantPace !== ratesPace) setRatesPace(wantPace)

  const snapOk = !!snap.body && snapView.state === 'ok'
  const yields = rates.body ? ratesRows(ratesView) : []
  const pairView = pair && quote.quote ? pairQuoteView(quote.quote) : pair && quote.error ? { kind: 'none', source: 'FMP' } : null
  const btc = bitcoinRow(pairView, quote.quote?.change_pct, snapOk ? snapView.btc : null)

  // ONE reporter: the snapshot when it answered, else the curve; nothing is reported for a board with no rows.
  usePanelFreshness(
    snapOk ? panelAsOf(MKTS_SNAPSHOT_SOURCE, snap.receivedAt)
      : yields.length ? panelAsOf(RATES_SOURCE, ratesView.asOf) : null,
  )

  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-mkts" data-state={state}>{body}</div>
  )

  if (snap.loading) return <PanelSkeleton label="Loading the markets board" testId="terminal-mkts-loading" />
  const snapErr = snap.body ? null : snap.error
  // Signed out: nothing on this board can be read, so the whole panel says so.
  if (snapErr?.status === 401) {
    return <PanelState kind="locked" testId="terminal-mkts-error" title={failureText(snapErr, MKTS_WHAT)} />
  }
  if (!snapOk && !yields.length && btc.from !== 'quote') {
    if (rates.loading) return <PanelSkeleton label="Loading the markets board" testId="terminal-mkts-loading" />
    if (snap.body && snapView.state === 'none') {
      return wrap('none', (
        <PanelState kind="empty" role="status" testId="terminal-mkts-none" title="The market snapshot came back with no prices."
          action={<button type="button" className={styles.chip} onClick={snap.retry}>Retry</button>}>
          Not one index fund, VIX or Bitcoin price was in this read. That is a missing read, not a flat market.
        </PanelState>
      ))
    }
    const locked = snapErr ? !canRetry(snapErr) : false
    return (
      <PanelState kind={snapErr ? failureKind(snapErr) : 'error'} testId="terminal-mkts-error"
        title={snapErr ? failureText(snapErr, MKTS_WHAT) : `${MKTS_WHAT} could not be read just now.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={() => { snap.retry(); rates.retry() }}>Retry</button>}>
        {locked ? null : `That is not the same as no prices. Retry, or run ${code} again.`}
      </PanelState>
    )
  }

  const snapWords = snapshotAsOf(snap.receivedAt)
  const missing = snapOk ? missingLine(snapView.missing) : ''

  let ratesBody
  if (yields.length) {
    ratesBody = yields.map((r) => (
      <tr key={r.key} data-testid="terminal-mkts-rate" data-key={r.key}>
        <th scope="row" className={styles.phoneWrap}>
          <PanelCommand cmd="RATES" label={`${r.label}, open Treasury yields`}>{r.label}</PanelCommand>
        </th>
        <td data-testid="terminal-mkts-rate-yield">{r.yieldText}</td>
        <td data-testid="terminal-mkts-rate-chg">
          {/* no green or red: a rising yield is not good or bad (the same rule RATES follows) */}
          {r.dir == null ? <span className={styles.muted}>n/a</span> : <span>{r.changeText}</span>}
        </td>
      </tr>
    ))
  } else if (rates.loading) {
    ratesBody = <WordsRow testId="terminal-mkts-rates-loading">Loading Treasury yields.</WordsRow>
  } else if (!rates.body) {
    ratesBody = (
      <WordsRow testId="terminal-mkts-rates-error">
        {failureText(rates.error, RATES_WHAT)}{' '}
        {canRetry(rates.error) ? retryButton(rates.retry, 'terminal-mkts-rates-retry') : null}
      </WordsRow>
    )
  } else if (ratesView.state === 'computing') {
    ratesBody = (
      <WordsRow testId="terminal-mkts-rates-computing">
        The server is reading Treasury yields from the Treasury&apos;s website. This fills in on its own; that is not the same as no figures.
      </WordsRow>
    )
  } else if (ratesView.state === 'unavailable') {
    ratesBody = <WordsRow testId="terminal-mkts-rates-unavailable">{unavailableWords(ratesView.reason, ratesView.httpStatus)}</WordsRow>
  } else {
    ratesBody = (
      <WordsRow testId="terminal-mkts-rates-error">
        {RATES_WHAT} could not be read just now. {retryButton(rates.retry, 'terminal-mkts-rates-retry')}
      </WordsRow>
    )
  }

  const btcAsOf = btc.from === 'quote'
    ? `${pairSourceLine(pairView)}${pairView.stale && !pairView.failed ? ', the last price the server holds' : ''}`
    : btc.from === 'snapshot' ? `Source: Yahoo Finance, ${snapWords}` : null
  const showCrypto = btc.from !== 'none' || snapOk || btc.asked

  return wrap(snapOk ? 'ok' : 'partial', (
    <>
      {snap.error && snap.body ? (
        <p className={styles.note} role="status" data-testid="terminal-mkts-stale-read">
          {failureText(snap.error, 'The market snapshot')} Showing the last read: {snapWords}.
        </p>
      ) : null}
      {!snapOk ? (
        <p className={styles.note} role="status" data-testid="terminal-mkts-snapshot-failed">
          {snapErr ? failureText(snapErr, 'Index fund, VIX and Bitcoin prices')
            : snap.body && snapView.state === 'none' ? 'The market snapshot came back with no index fund, VIX or Bitcoin price.'
              : 'Index fund, VIX and Bitcoin prices could not be read just now.'}{' '}
          That is not the same as no prices.{' '}
          {snapErr && !canRetry(snapErr) ? null : retryButton(snap.retry, 'terminal-mkts-snapshot-retry')}
        </p>
      ) : null}
      {missing ? <p className={styles.note} role="status" data-testid="terminal-mkts-missing">{missing}</p> : null}
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-mkts-table" aria-label="Markets board: index funds, volatility, Treasury yields and Bitcoin">
          <thead>
            <tr>
              <th scope="col">Market</th>
              <th scope="col">Last</th>
              <th scope="col" title="Percent change on the day for prices; change from the previous published day, in basis points, for yields">Change</th>
            </tr>
          </thead>
          {snapOk ? (
            <tbody data-testid="terminal-mkts-group-funds">
              <GroupHead name="Index funds" asOf={snapWords} testId="terminal-mkts-head-funds" />
              {snapView.funds.map((r) => (
                <PriceRow key={r.sym} testId={`terminal-mkts-row-${r.sym}`} price={r.price} chg={r.chg} dir={r.dir}
                  name={<><PanelSymbol sym={r.sym} /> <span className={styles.muted}>{r.name}</span></>} />
              ))}
            </tbody>
          ) : null}
          {snapOk ? (
            <tbody data-testid="terminal-mkts-group-vol">
              <GroupHead name="Volatility" asOf={snapWords} testId="terminal-mkts-head-vol" />
              <PriceRow testId="terminal-mkts-row-VIX" name={snapView.vix.name} price={snapView.vix.price} chg={snapView.vix.chg} dir={snapView.vix.dir} />
            </tbody>
          ) : null}
          <tbody data-testid="terminal-mkts-group-rates">
            <GroupHead name="Rates" asOf={yields.length ? `${ratesAsOf(ratesView)}, a daily figure` : null} testId="terminal-mkts-head-rates" />
            {ratesBody}
          </tbody>
          {showCrypto ? (
            <tbody data-testid="terminal-mkts-group-crypto" data-from={btc.from}>
              <GroupHead name="Crypto" asOf={btcAsOf} testId="terminal-mkts-head-crypto" />
              {btc.from === 'none' ? (
                <WordsRow testId="terminal-mkts-btc-none">No Bitcoin price right now. That is a missing price, not a zero.</WordsRow>
              ) : (
                <PriceRow testId="terminal-mkts-row-BTC" price={btc.price} chg={btc.chg} dir={btc.dir}
                  name={btc.linked ? <><PanelSymbol sym={MKTS_PAIR} /> <span className={styles.muted}>Bitcoin in US dollars</span></> : 'Bitcoin'} />
              )}
              {btc.asked && btc.from !== 'none' ? (
                <WordsRow testId="terminal-mkts-btc-fallback">The FMP quote gave no price just now, so this is the snapshot&apos;s Bitcoin price.</WordsRow>
              ) : null}
            </tbody>
          ) : null}
        </table>
      </div>
      <p className={styles.muted} data-testid="terminal-mkts-method">
        Each fund&apos;s price is the fund&apos;s own, not the index level it tracks. Change is the percent change on
        the day as the source reports it; the snapshot carries no change in points and no time of its own, so its
        as-of is when this screen read it, and the server may hold a read for up to two minutes. Yields are the US
        Treasury&apos;s daily par yield curve; their change is from the previous published day, in basis points. This
        board has no index futures, gold, oil or dollar rows: those prices are not in the data it reads. Green and red
        mark the sign of a price change only; a yield change carries no color.
      </p>
      <p className={styles.muted} data-testid="terminal-mkts-links">
        The whole curve: <PanelCommand cmd="RATES" label="Treasury yields">Treasury yields (RATES)</PanelCommand>. Futures
        positioning: <PanelCommand cmd="COT" label="Futures positioning">Commitments of Traders (COT)</PanelCommand>
      </p>
    </>
  ))
}
