import { useMemo } from 'react'
import useSWR from 'swr'
import { sectionFetcher } from '../../../components/research/sections/sectionFetch'
import EChart from '../../../components/research-kit/charts/echartsCore'
import { buildSmileOption, buildTermOption, etDay, etStamp, heatOf, pct, quoteClock, quoteSpan } from './volSurface'
import styles from './OptionsChainTab.module.css'
import rp from '../ResearchPage.module.css'
import { memberText, memberSentence } from '../../../lib/presentation/memberCopy'
import { num } from '../../optionsAnalytics/optionsFormat'

// BRK-01 increment 3 (roadmap RM-L01): the implied-vol surface, under the chain, from TODAY'S
// live chain only (api/services/vol_surface.py). DARK behind OPTIONS_VOL_SURFACE_ENABLED, which
// rides on top of OPTIONS_CHAIN_ENABLED; ResearchPage passes the switch down.
//
// ⛔ Read-only by charter: no button, nothing runs, sends or simulates a trade.
// ⛔ Every claim the server makes about its basis is printed: vendor IV, today's chain not
//    history, the quote times, the strikes it refused and the expirations it could not draw.
// ⛔ Polling: bare useSWR at 60 s with revalidateOnFocus false -- the SAME decision as the chain
//    grid above it, pinned to the server's 60 s cache (polling faster cannot return a newer
//    surface). Recorded in app/src/hooks/pollingSites.rail.test.js.

function SideNote({ side, testId }) {
  if (!side) return null
  return (
    <>
      {!side.drawable && <p className={styles.note} data-testid={`${testId}-not-drawn`}>{memberSentence(side.reason)}</p>}
      {side.refused_text && (
        <p className={styles.muted} data-testid={`${testId}-refused`}>Left out: {side.refused_text}.</p>
      )}
    </>
  )
}

export default function VolSurfacePanel({ sym, expiration }) {
  const s = (sym || '').toUpperCase().trim()
  const url = s ? `/api/research/options/${encodeURIComponent(s)}/surface?expiration=${expiration || ''}` : null
  const { data: d, error, mutate } = useSWR(url, sectionFetcher, { refreshInterval: 60_000, revalidateOnFocus: false })

  const servedDay = d?.served_at ? etDay(d.served_at) : null
  const smile = d?.smile
  const smileOpt = useMemo(() => (smile ? buildSmileOption(smile, Number(d?.spot), servedDay) : null),
    [smile, d?.spot, servedDay])
  const termOpt = useMemo(() => (d?.term ? buildTermOption(d.term, servedDay) : null), [d?.term, servedDay])
  const grid = d?.grid
  const [lo, hi] = useMemo(() => {
    const ivs = (grid?.rows || []).flatMap((r) => r.cells.filter(Boolean).map((c) => c.iv))
    return ivs.length ? [Math.min(...ivs), Math.max(...ivs)] : [NaN, NaN]
  }, [grid])

  if (error) {
    return <div className={styles.note} data-testid="vol-unavailable">
      The implied-vol surface is unavailable right now. That does not mean {s} has no options.{' '}
      {/* Audit 2026-10-08 (OVS P2 point 8): a failed read had no way to ask again. */}
      <button type="button" className={rp.basisBtn} onClick={() => mutate()}>Retry</button>
    </div>
  }
  if (!d) return <div className={styles.note}>Loading the implied-vol surface…</div>
  if (d.paywalled) return null

  const smilePts = [...(smile?.calls?.points || []), ...(smile?.puts?.points || [])]
  const drawnSmile = smile?.calls?.drawable || smile?.puts?.drawable
  const termOut = (d.term?.points || []).filter((p) => p.atm_iv == null)

  return (
    <section className={styles.payoff} data-testid="vol-surface">
      <div className={styles.head}><strong>Implied volatility</strong></div>
      <p className={styles.muted} data-testid="vol-basis">{d.basis}</p>
      <p className={styles.muted} data-testid="vol-source">{d.iv_source_text}</p>

      <h4 className={styles.volHead}>Smile · {smile?.expiration || '—'}</h4>
      {drawnSmile ? (
        <>
          <ul className={styles.legend} data-testid="vol-smile-legend" aria-label="Smile legend">
            {smile?.calls?.drawable && <li><span className={`${styles.legendSwatch} ${styles.legendCall}`} aria-hidden="true" />Calls</li>}
            {smile?.puts?.drawable && <li><span className={`${styles.legendSwatch} ${styles.legendPut}`} aria-hidden="true" />Puts</li>}
            {Number.isFinite(Number(d.spot)) && <li><span className={`${styles.legendSwatch} ${styles.legendSpot}`} aria-hidden="true" />Spot</li>}
          </ul>
          <EChart option={smileOpt} height={200} testId="vol-smile-chart"
                  ariaLabel={`Implied volatility by strike for the ${smile.expiration} expiration, calls and puts`} />
        </>
      ) : null}
      <SideNote side={smile?.calls} testId="smile-calls" />
      <SideNote side={smile?.puts} testId="smile-puts" />
      {smilePts.length > 0 && (
        <p className={styles.muted} data-testid="smile-quoted">Quoted {quoteSpan(smilePts, servedDay)}</p>
      )}

      <h4 className={styles.volHead}>Term structure · at-the-money IV</h4>
      {d.term?.drawable ? (
        <EChart option={termOpt} height={180} testId="vol-term-chart"
                ariaLabel="At-the-money implied volatility by days to expiration" />
      ) : (
        <p className={styles.note} data-testid="term-not-drawn">{memberSentence(d.term?.reason)}</p>
      )}
      <ul className={styles.volList} data-testid="term-points">
        {(d.term?.points || []).filter((p) => p.atm_iv != null).map((p) => (
          <li key={p.expiration}>
            {p.expiration} ({p.dte}d) · ATM {num(p.atm_strike)} · <b>{pct(p.atm_iv)}</b>
            {' '}<span className={styles.muted}>{p.atm_basis} · quoted {quoteClock(p.t, servedDay)}</span>
          </li>
        ))}
      </ul>
      {termOut.length > 0 && (
        <p className={styles.muted} data-testid="term-left-out">
          Not on the line: {termOut.map((p) => `${p.expiration} (${memberText(p.reason)})`).join('; ')}.
        </p>
      )}

      {grid?.rows?.length > 0 && grid.expirations.length > 1 && (
        <>
          <h4 className={styles.volHead}>Strike × expiration</h4>
          <div className={styles.scroll}>
            <table className={styles.grid} data-testid="vol-grid" aria-label="Implied volatility, strike by expiration">
              <thead>
                <tr><th scope="col" className={styles.strikeHead}>Strike</th>{grid.expirations.map((x) => <th scope="col" key={x}>{x}</th>)}</tr>
              </thead>
              <tbody>
                {grid.rows.map((r) => (
                  <tr key={r.strike}>
                    <td className={styles.strike}>{num(r.strike)}</td>
                    {r.cells.map((c, i) => (
                      <td key={grid.expirations[i]}
                          className={c ? styles.volCell : undefined}
                          style={c ? { '--heat': heatOf(c.iv, lo, hi) } : undefined}
                          title={c ? `quoted ${quoteClock(c.t, servedDay)}` : 'no valid quote'}>
                        {c ? pct(c.iv) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.muted}>Each cell is the {grid.side_rule}; a dash is no valid quote, never a filled-in guess.</p>
        </>
      )}

      <p className={styles.muted} data-testid="vol-coverage">
        {d.expirations_sampled} of {d.expirations_listed} listed expirations sampled
        {d.missing?.length ? `; not fetched: ${d.missing.map((m) => `${m.expiration} (${memberText(m.reason)})`).join('; ')}` : ''}
        {' '}· refreshed every {d.cache_seconds || 60}s
        {etStamp(d.served_at) ? ` · as of ${etStamp(d.served_at)}` : ''}
      </p>
    </section>
  )
}
