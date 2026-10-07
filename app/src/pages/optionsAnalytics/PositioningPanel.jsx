import useDarkSection from './useDarkSection'
import OffNotice from './OffNotice'
import { money } from './MarketTidePanel'
import { num, fracPct } from './optionsFormat'
import styles from './optionsAnalytics.module.css'
import { usePanelFreshness } from '../../components/terminal/terminalPanel'

// BRK-08 positioning extensions under the option chain: FT-047 named levels, FT-049 heatmap,
// FT-055 max pain + NOPE, FT-050 Options Impact, FT-052 dealer short.
// (api/services/options_analytics/positioning.py)
//
// ⛔ Each block is its OWN dark surface: it reads its own route, and a 404 (switch off) or 402
//    renders nothing. Arming one never shows another.
// ⛔ Every block is labelled computed; vendor inputs are named. Words for levels come from the
//    server's closed vocabulary (positioning_vocab.py), never typed here.

const enc = encodeURIComponent

function Block({ title, testid, children, failed, what }) {
  return (
    <section className={styles.panel} data-testid={testid}>
      <div className={styles.head}>
        <span className={styles.title}>{title}</span>
        <span className={styles.badge}>computed</span>
      </div>
      {failed ? <p className={styles.note}>{what} is unavailable right now. That is a failed read, not an empty one.</p> : children}
    </section>
  )
}

function Levels({ sym }) {
  const { data, hidden, failed } = useDarkSection(`/api/options/positioning/${enc(sym)}/levels`)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.levels))) return null
  return (
    <Block title="Positioning levels" testid="posn-levels" failed={failed} what="The positioning levels">
      {data && (
        <>
          <ul className={styles.list}>
            {data.levels.map((l) => (
              <li key={l.id} data-testid={`posn-level-${l.id}`}>
                <b>{l.label}</b>: {l.value == null ? '—' : (l.unit === '$ move' ? `±$${num(l.value)}` : num(l.value))}
                {l.role ? <span className={styles.muted}> ({l.role})</span> : null}
              </li>
            ))}
          </ul>
          {(data.notes || []).map((n) => <p key={n} className={styles.muted}>{n}</p>)}
          {Number.isFinite(data.atm_iv?.value) && (
            <p className={styles.muted} data-testid="levels-atm-iv">
              ATM IV {fracPct(data.atm_iv.value)}{data.atm_iv.expiration ? ` on ${data.atm_iv.expiration}` : ' (30-day interpolated)'}.
            </p>
          )}
          <p className={styles.muted}>{data.method}</p>
        </>
      )}
    </Block>
  )
}

// One strike x expiry grid. FT-049's gamma heatmap, and (lane/o-options-remainders) its delta-pressure
// and charm siblings: each its OWN route and switch (OPTIONS_DELTA_PRESSURE_ENABLED /
// OPTIONS_CHARM_HEATMAP_ENABLED), same chain, same cell rule (blank = no computable contract, never 0).
function Heatmap({ sym, path = 'heatmap', title = 'Gamma exposure by strike and expiry', testid = 'posn-heatmap', what = 'The gamma heatmap' }) {
  const { data, hidden, failed } = useDarkSection(`/api/options/positioning/${enc(sym)}/${path}?dte=month`)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.cells))) return null
  const max = data?.max_abs || 1
  return (
    <Block title={title} testid={testid} failed={failed} what={what}>
      {data && (
        <>
          <div className={styles.scroll}>
            <table className={styles.table} aria-label={title}>
              <thead><tr><th scope="col">Expiry</th>{data.strikes.map((k) => <th scope="col" key={k}>{num(k)}</th>)}</tr></thead>
              <tbody>
                {data.expirations.map((e, i) => (
                  <tr key={e}>
                    <th scope="row">{e}</th>
                    {data.cells[i].map((v, j) => (
                      <td key={data.strikes[j]} className={v == null ? undefined : (v >= 0 ? styles.cellPos : styles.cellNeg)}
                        style={v == null ? undefined : { '--heat': Math.min(1, Math.abs(v) / max) }}>
                        {v == null ? '' : money(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.muted}>Unit: {data.unit}. {data.note} {data.method}</p>
          {data.contracts_without_defined_charm > 0 && (
            <p className={styles.muted} data-testid={`${testid}-undefined`}>
              {data.contracts_without_defined_charm} contract{data.contracts_without_defined_charm === 1 ? '' : 's'} had no defined charm (expiring today, delta pinned at 0/1, or no gamma) and are left out.
            </p>
          )}
          {data.not_built && <p className={styles.muted}>{data.not_built}</p>}
        </>
      )}
    </Block>
  )
}

function MaxPain({ sym }) {
  const { data, hidden, failed } = useDarkSection(`/api/options/positioning/${enc(sym)}/max-pain?dte=month`)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.expirations))) return null
  return (
    <Block title="Max pain" testid="posn-maxpain" failed={failed} what="Max pain">
      {data && (
        <>
          <ul className={styles.list}>
            {data.expirations.map((e) => (
              <li key={e.expiration}>{e.expiration}: <b>{num(e.max_pain)}</b>
                {e.distance_pct != null ? ` (${e.distance_pct > 0 ? '+' : ''}${num(e.distance_pct)}% from spot)` : ''}
                <span className={styles.muted}> · call OI {e.call_oi.toLocaleString()} · put OI {e.put_oi.toLocaleString()}</span>
              </li>
            ))}
          </ul>
          <p className={styles.muted}>{data.band_note} {data.method}</p>
        </>
      )}
    </Block>
  )
}

function Nope({ sym }) {
  const { data, hidden, failed } = useDarkSection(`/api/options/positioning/${enc(sym)}/nope`)
  if (hidden || (!data && !failed) || (data && !('nope' in data))) return null
  return (
    <Block title="NOPE" testid="posn-nope" failed={failed} what="NOPE">
      {data && (
        <>
          <p className={styles.facts}>
            {data.nope != null
              ? <>NOPE <b className={data.nope >= 0 ? styles.gain : styles.loss}>{data.nope > 0 ? '+' : ''}{num(data.nope)}%</b>{' '}
                ({Number(data.net_option_delta_shares).toLocaleString()} delta-shares on {Number(data.share_volume).toLocaleString()} shares traded)</>
              : data.nope_note}
          </p>
          <p className={styles.muted}>{data.method}</p>
        </>
      )}
    </Block>
  )
}

const BAND_WORDS = {
  low: 'Low: the stock trades far more than dealers would need to hedge a 1% move. Ignore the positioning read.',
  moderate: 'Moderate: dealer hedging is a real but minor part of the day\'s volume.',
  high: 'High: dealer hedging is large against the stock\'s volume. Positioning can steer price.',
}

function Impact({ sym }) {
  const { data, hidden, failed } = useDarkSection(`/api/options/positioning/${enc(sym)}/impact`)
  if (hidden || (!data && !failed) || (data && !('impact_ratio' in data))) return null
  return (
    <Block title="Options Impact" testid="posn-impact" failed={failed} what="Options Impact">
      {data && (
        <>
          <p className={styles.facts} data-testid="posn-impact-read">
            {data.impact_ratio != null
              ? <>{num(data.impact_ratio * 100)}% of daily dollar volume · {BAND_WORDS[data.band]}</>
              : data.impact_note}
          </p>
          <p className={styles.muted}>{data.method}</p>
        </>
      )}
    </Block>
  )
}

function DealerShort({ sym }) {
  const { data, hidden, failed } = useDarkSection(`/api/options/positioning/${enc(sym)}/dealer-short`)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.dealer_short))) return null
  return (
    <Block title="Dealer short" testid="posn-dealer-short" failed={failed} what="The dealer-short read">
      {data && (
        <>
          <p className={styles.facts}>{data.summary}</p>
          <p className={styles.muted}>{data.explanation}</p>
          <ul className={styles.list}>
            {data.dealer_short.slice(0, 10).map((r) => (
              <li key={r.contract_key}>{r.expiration} {num(r.strike)} {r.cp === 'C' ? 'call' : 'put'}: dealers {Number(r.est_dealer_net).toLocaleString()} contracts
                {r.flow_confidence != null ? <span className={styles.muted}> (confidence {num(r.flow_confidence)})</span> : null}
              </li>
            ))}
          </ul>
          <p className={styles.muted}>{data.method}</p>
        </>
      )}
    </Block>
  )
}

// Every route this panel reads, in render order -- OffNotice asks the SAME keys (SWR shares the
// request), so it can say "not switched on" exactly when every block above rendered nothing.
export const positioningUrls = (s) => [
  `/api/options/positioning/${enc(s)}/levels`,
  `/api/options/positioning/${enc(s)}/heatmap?dte=month`,
  `/api/options/positioning/${enc(s)}/delta-heatmap?dte=month`,
  `/api/options/positioning/${enc(s)}/charm-heatmap?dte=month`,
  `/api/options/positioning/${enc(s)}/max-pain?dte=month`,
  `/api/options/positioning/${enc(s)}/nope`,
  `/api/options/positioning/${enc(s)}/impact`,
  `/api/options/positioning/${enc(s)}/dealer-short`,
]

// `offNotice`: set by the terminal's POS, which opens this panel on its own.
export default function PositioningPanel({ sym, offNotice = false }) {
  const s = (sym || '').toUpperCase().trim()
  // TERM-019: every section below is computed by UCT from Massive's chain; each dates itself.
  usePanelFreshness(s ? { source: 'UCT, computed from Massive options data' } : null)
  if (!s) return null
  return (
    <div data-testid="positioning">
      {offNotice && <OffNotice urls={positioningUrls(s)} feature="Options positioning" />}
      <Levels sym={s} />
      <Heatmap sym={s} />
      <Heatmap sym={s} path="delta-heatmap" title="Delta pressure by strike and expiry" testid="posn-delta-heatmap" what="The delta-pressure heatmap" />
      <Heatmap sym={s} path="charm-heatmap" title="Charm by strike and expiry" testid="posn-charm-heatmap" what="The charm heatmap" />
      <MaxPain sym={s} />
      <Nope sym={s} />
      <Impact sym={s} />
      <DealerShort sym={s} />
    </div>
  )
}
