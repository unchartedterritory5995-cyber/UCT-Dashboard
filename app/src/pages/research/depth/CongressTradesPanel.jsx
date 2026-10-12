import useSWR from 'swr'
import { depthFetcher } from './depthFetch'
import styles from './Depth.module.css'
import { useDepthChrome, DepthLoading, DepthBadRequest } from './depthChrome'
import { memberText, memberSentence } from '../../../lib/presentation/memberCopy'
import { usePanelFreshness } from '../../../components/terminal/terminalPanel'
import SwitchedOff, { isSwitchedOff } from '../SwitchedOff'

// COV-12 / FT-067 — congressional trades (STOCK Act disclosures, Senate + House), from our FMP
// plan only. DARK behind CONGRESS_TRADES_ENABLED (auth payload `congress_trades_enabled`).
// Mounted three ways: Research › Depth, the Ownership tab beside insiders and 13F, and the
// terminal's `NVDA CONG` panel.
//
// ⛔ "No trades disclosed" and "could not read" are different facts and read differently; one
//    chamber failing says WHICH chamber is missing, it never reads as that chamber's silence.
// ⛔ The amount is the disclosed RANGE, shown as filed — never turned into one number.
// ⛔ Disclosures lag the trade (up to 45 days): said under the table, and each row shows both dates.

export const congressUrl = (sym) => `/api/research/congress-trades/${encodeURIComponent(sym)}`

const SIDE_LABEL = { buy: 'Buy', sell: 'Sell', exchange: 'Exchange', other: 'Other' }

function sideClass(side) {
  if (side === 'buy') return styles.up
  if (side === 'sell') return styles.down
  return undefined
}

function memberLine(t) {
  const where = [t.chamber_label, t.district].filter(Boolean).join(' · ')
  return where ? `${t.member} (${where})` : t.member
}

function summary(data, s) {
  const c = data.counts || {}
  const n = (data.trades || []).length
  const people = c.members ?? 0
  return `${n} disclosed ${n === 1 ? 'trade' : 'trades'} in ${s} by ${people} ${people === 1 ? 'member' : 'members'} `
    + `of Congress: ${c.buys ?? 0} ${c.buys === 1 ? 'buy' : 'buys'}, ${c.sells ?? 0} ${c.sells === 1 ? 'sale' : 'sales'}`
    + `${c.other ? `, ${c.other} other` : ''}. Newest disclosure ${data.newest_disclosure || 'not dated'}.`
}

export default function CongressTradesPanel({ sym }) {
  const chrome = useDepthChrome()
  const s = (sym || '').toUpperCase().trim()
  const { data, error, mutate } = useSWR(s ? congressUrl(s) : null, depthFetcher, { revalidateOnFocus: false })
  usePanelFreshness(chrome.alone && data && !data.paywalled && !data.badRequest && !error
    ? { source: memberText(data.source) || null, age: { asOfDate: data.newest_disclosure || null } }
    : null)

  const retry = <button type="button" className={styles.retry} onClick={() => mutate()}>Retry</button>
  let body
  if (isSwitchedOff(error)) body = <SwitchedOff what="Congressional trades" className={styles.note} testId="congress-off" />
  else if (error) body = <div className={styles.error} data-testid="congress-unavailable">Congressional trades are unavailable right now. That is a gap in what we could read, not a finding about {s}.{' '}{retry}</div>
  else if (!data) body = <DepthLoading inPanel={chrome.inPanel} label="Loading congressional trades" />
  else if (data.paywalled) body = <div className={styles.note}>Congressional trades require a paid plan.</div>
  else if (data.badRequest) body = <DepthBadRequest sentence={data.badRequest} />
  else if (data.state === 'unavailable') body = <div className={styles.error} data-testid="congress-unavailable">{memberSentence(data.reason) || 'Neither the Senate nor the House records could be read just now.'} That is not the same as no trades.{' '}{retry}</div>
  else if (data.state === 'none_disclosed') body = <div className={styles.note} data-testid="congress-none">{memberSentence(data.reason) || `No congressional trades disclosed for ${s}.`}</div>
  else {
    const trades = data.trades || []
    const atCap = Object.values(data.chambers || {}).some((c) => c?.at_cap)
    body = (
      <div data-testid="congress">
        {data.state === 'partial' && (
          <p className={styles.warn} role="status" data-testid="congress-partial">
            {memberSentence(data.reason) || 'One chamber could not be read just now.'}{' '}{retry}
          </p>
        )}
        {trades.length === 0
          ? <div className={styles.note} data-testid="congress-none-partial">The chamber that answered holds no disclosed trades in {s}.</div>
          : (
            <>
              <p className={styles.lede} data-testid="congress-summary">{summary(data, s)}</p>
              <div className={styles.scroll}>
                <table className={styles.grid} aria-label={`Congressional trades in ${s}, newest disclosure first`}>
                  <thead>
                    <tr>
                      <th scope="col">Disclosed</th><th scope="col">Traded</th><th scope="col">Member</th>
                      <th scope="col">Type</th><th scope="col">Amount (range)</th><th scope="col">Owner</th><th scope="col">Filing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t, i) => (
                      <tr key={`${t.chamber}-${t.member}-${t.transaction_date}-${t.disclosure_date}-${i}`} data-testid="congress-row">
                        <th scope="row">{t.disclosure_date || 'not dated'}</th>
                        <td title={t.lag_days != null ? `Disclosed ${t.lag_days} days after the trade` : undefined}>{t.transaction_date || 'not dated'}</td>
                        <td className={styles.text}>{memberLine(t)}</td>
                        <td className={sideClass(t.side)}>{t.type || SIDE_LABEL[t.side] || 'Not given'}</td>
                        <td>{t.amount || 'Not given'}</td>
                        <td>{t.owner || 'Not given'}</td>
                        <td>{t.link ? <a href={t.link} target="_blank" rel="noopener noreferrer">Report</a> : 'None'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {atCap && (
                <p className={styles.muted} data-testid="congress-cap">
                  FMP returns up to 100 disclosures per chamber for a symbol, so older ones may not be listed.
                </p>
              )}
            </>
          )}
      </div>
    )
  }
  return (
    <section className={chrome.panelClass} data-testid="congress-panel">
      {chrome.showTitle && <h3 className={styles.panelTitle}>Congressional trades</h3>}
      {body}
      {data && !data.paywalled && !data.badRequest && !error && (
        <p className={styles.muted} data-testid="congress-basis">{data.basis} Source: {memberText(data.source)}.</p>
      )}
    </section>
  )
}
