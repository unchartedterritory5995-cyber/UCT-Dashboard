// LVL: the key price levels for one stock, from options and dark pool data. `NVDA LVL`.
//
// ⭐ NO NEW ROUTE. Two paid reads that until now fed only chart indicators
// (api/routers/signature.py): `/api/signature/gex-walls` (call wall, put wall, zero gamma, the
// price they were measured against) and `/api/signature/darkpool-levels` (where confirmed dark
// pool prints bunched up over the last 20 sessions). The pure half is levelsModel.js, re-exported
// below.
//
// ONE list, highest price first, with the price marked among the levels and each level's distance
// from it. The price is the options read's own `spot`; only when that read gave none does the
// panel fall back to the shared live-price pool (the same pool the panel headline already reads,
// so it costs no extra request).
//
// ⛔ THE TWO READS FAIL APART. One failing never blanks the other: its levels are listed and a note
// says what is missing. An `error` inside a 200 answer is a failed read, said as one, never "no
// levels". A healthy answer with no levels says there are none, and why.
import { useMemo } from 'react'
import useLivePrices from '../../../hooks/useLivePrices'
import {
  PanelCommand, PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import {
  formatCompactTerminal, formatCurrency, formatNumber, formatPercent, formatTimeEt,
} from '../../../lib/presentation/presentationPrimitives'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import {
  DARK_POOL_MIN_MILLIONS, DARK_POOL_TOP, GEX_BAND_PCT, LEVELS_CODE, LEVEL_KINDS, REGIME_TEXT, darkPoolRead,
  darkpoolLevelsUrl, gexRead, gexWallsUrl, kindsIn, levelRows,
} from './levelsModel'
import styles from './marketPanels.module.css'

export {
  DARK_POOL_MIN_MILLIONS, DARK_POOL_TOP, GEX_BAND_PCT, LEVELS_CODE, LEVEL_KINDS, REGIME_TEXT, darkPoolRead,
  darkpoolLevelsUrl, distancePct, gexRead, gexWallsUrl, kindsIn, levelRows, sideOf,
} from './levelsModel'

const SOURCE = 'UCT Signature levels (options chain, confirmed dark pool prints)'
/** The server rebuilds the options levels at most every 10 minutes; the dark pool ledger is nightly. */
const GEX_POLL_MS = 10 * 60 * 1000
const NA = 'n/a'
const num = (v) => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null)
const clock = (epochSeconds) => (epochSeconds ? formatTimeEt(epochSeconds * 1000, { zoneSuffix: 'ET', absent: '' }) : '')

/** Pure: `+3.2% above`, `-1.8% below`, `at the price`, or n/a when no price is known. */
export function distanceText(row) {
  if (!row || row.distPct == null || !row.side) return NA
  if (row.side === 'at') return 'at the price'
  return `${formatPercent(row.distPct, { decimals: 1, signed: true })} ${row.side}`
}

/** Pure: what a level is built from, in a few words. */
export function detailText(row) {
  if (!row) return ''
  if (row.kind !== 'darkPool') return 'Options expiring within a week'
  const parts = []
  if (row.notional != null) {
    parts.push(`${formatCompactTerminal(row.notional, { money: true })}${row.printCount != null
      ? ` in ${formatNumber(row.printCount, { decimals: 0 })} ${row.printCount === 1 ? 'print' : 'prints'}` : ''}`)
  }
  if (row.lo != null && row.hi != null) parts.push(`zone ${formatCurrency(row.lo)} to ${formatCurrency(row.hi)}`)
  if (row.lastDate) parts.push(`last print ${row.lastDate}`)
  return parts.join(', ') || 'Dark pool prints'
}

/** One read's outcome: 'loading' | 'http' (the request itself failed) | the model's own state. */
const outcomeOf = (q, parsed) => (q.loading ? 'loading' : q.error && !q.body ? 'http' : parsed.state)

function LevelsBody({ sym: s, code }) {
  const inPanel = useInTerminalPanel()
  const gexQ = useMarketRead(gexWallsUrl(s), { refreshInterval: GEX_POLL_MS })
  const dpQ = useMarketRead(darkpoolLevelsUrl(s))
  const gex = useMemo(() => gexRead(gexQ.body), [gexQ.body])
  const dp = useMemo(() => darkPoolRead(dpQ.body), [dpQ.body])
  const gexState = outcomeOf(gexQ, gex)
  const dpState = outcomeOf(dpQ, dp)

  // The options read's own price; the shared live pool only when that read settled without one.
  const spot = gexState === 'ok' ? gex.spot : null
  const needLive = gexState !== 'loading' && spot === null
  const { prices } = useLivePrices(needLive ? [s] : [])
  const livePrice = needLive ? num(prices?.[s]?.price) : null
  const price = spot ?? livePrice

  const rows = useMemo(() => levelRows({
    gexLevels: gexState === 'ok' ? gex.levels : [],
    darkPoolLevels: dpState === 'ok' ? dp.levels : [],
    price,
  }), [gexState, gex.levels, dpState, dp.levels, price])
  const levelCount = rows.filter((r) => r.kind !== 'price').length

  // As of: the OLDER of the two answers, so the header never claims to be fresher than its parts.
  const stamps = [gexState === 'ok' ? gex.asOf : null, dpState === 'ok' ? dp.asOf : null].filter((v) => v != null)
  usePanelFreshness(stamps.length ? panelAsOf(SOURCE, Math.min(...stamps)) : null)

  const retryAll = () => { gexQ.retry(); dpQ.retry() }
  if (gexState === 'loading' && dpState === 'loading') {
    return <PanelSkeleton label={`Reading the key levels for ${s}`} testId="terminal-lvl-loading" />
  }
  if (gexState === 'http' && dpState === 'http') {
    if (gexQ.error?.status === 422 && dpQ.error?.status === 422) {
      return (
        <PanelState kind="input" role="status" testId="terminal-lvl-bad-ticker" title={`${s} is not a ticker this panel can read.`}>
          Check the ticker, then run it again, e.g. <kbd>NVDA {code}</kbd>
        </PanelState>
      )
    }
    const locked = !canRetry(gexQ.error) && !canRetry(dpQ.error)
    return (
      <PanelState kind={locked ? failureKind(gexQ.error) : 'error'} testId="terminal-lvl-error"
        title={locked ? failureText(gexQ.error, 'Key levels') : `The key levels for ${s} could not be read just now.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={retryAll}>Retry</button>}>
        {locked ? null : `That is not the same as having none. Retry, or run ${s} ${code} again.`}
      </PanelState>
    )
  }

  const retryBtn = (q, label) => (
    <button type="button" className={styles.linkBtn} onClick={() => q.retry()}>{label}</button>
  )
  // Each read says its own state: waiting, failed (with a way to retry), or healthy with nothing to list.
  const gexNote = gexState === 'loading' ? (
    <p className={styles.lede} role="status" data-testid="terminal-lvl-gex-loading">
      Reading the options levels. This can take up to 20 seconds.
    </p>
  ) : gexState === 'http' ? (
    <p className={styles.note} role="status" data-testid="terminal-lvl-gex-error">
      {failureText(gexQ.error, 'The options data')} So the call wall, put wall and zero gamma level are missing, which is
      not the same as having none.{' '}{canRetry(gexQ.error) ? retryBtn(gexQ, 'Retry the options levels') : null}
    </p>
  ) : gexState === 'failed' ? (
    <p className={styles.note} role="status" data-testid="terminal-lvl-gex-error">
      The options data could not be read just now. So the call wall, put wall and zero gamma level are missing, which is
      not the same as having none.{' '}{retryBtn(gexQ, 'Retry the options levels')}
    </p>
  ) : gexState === 'no-options' ? (
    <p className={styles.muted} data-testid="terminal-lvl-gex-none">
      The options source has no usable options data for {s}, so there is no call wall, put wall or zero gamma level.
    </p>
  ) : gex.levels.length === 0 ? (
    <p className={styles.muted} data-testid="terminal-lvl-gex-none">
      No call wall, put wall or zero gamma level sits within {GEX_BAND_PCT}% of the price.
    </p>
  ) : null

  const sessions = dp.windowDays ?? 20
  const dpNote = dpState === 'loading' ? (
    <p className={styles.lede} role="status" data-testid="terminal-lvl-dp-loading">Reading the dark pool levels.</p>
  ) : dpState === 'http' ? (
    <p className={styles.note} role="status" data-testid="terminal-lvl-dp-error">
      {failureText(dpQ.error, 'The dark pool data')} So the dark pool levels are missing, which is not the same as having
      none.{' '}{canRetry(dpQ.error) ? retryBtn(dpQ, 'Retry the dark pool levels') : null}
    </p>
  ) : dpState === 'failed' ? (
    <p className={styles.note} role="status" data-testid="terminal-lvl-dp-error">
      The dark pool data could not be read just now. So the dark pool levels are missing, which is not the same as having
      none.{' '}{retryBtn(dpQ, 'Retry the dark pool levels')}
    </p>
  ) : dp.levels.length === 0 ? (
    <p className={styles.muted} data-testid="terminal-lvl-dp-none">
      {dp.datesCovered === 0
        ? `No dark pool prints are on record for ${s} in the last ${sessions} sessions.`
        : `No price gathered $${DARK_POOL_MIN_MILLIONS}M or more of dark pool prints for ${s} in the last ${sessions} sessions.`}
    </p>
  ) : null

  const settledClean = ['ok', 'no-options'].includes(gexState) && dpState === 'ok'
  const priceLabel = spot !== null
    ? `Price${gex.asOf ? ` at ${clock(gex.asOf)}` : ''}`
    : 'Price now'
  const priceDetail = spot !== null ? 'Read with the options data' : 'Live price'

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-lvl">
      {levelCount === 0 && settledClean ? (
        <PanelState kind="empty" role="status" testId="terminal-lvl-empty" title={`No key levels for ${s} right now.`}>
          {gexNote}{dpNote}
        </PanelState>
      ) : (
        <>
          {gexState === 'ok' && gex.regime ? (
            <p className={styles.lede} data-testid="terminal-lvl-regime">{REGIME_TEXT[gex.regime]}</p>
          ) : null}
          {gexNote}
          {dpNote}
          {gexQ.error && gexQ.body ? (
            <p className={styles.note} role="status" data-testid="terminal-lvl-gex-stale">
              {failureText(gexQ.error, 'The options data')} Showing the last read.
            </p>
          ) : null}
          {dpQ.error && dpQ.body ? (
            <p className={styles.note} role="status" data-testid="terminal-lvl-dp-stale">
              {failureText(dpQ.error, 'The dark pool data')} Showing the last read.
            </p>
          ) : null}
          {levelCount > 0 && price === null && gexState !== 'loading' ? (
            <p className={styles.note} role="status" data-testid="terminal-lvl-no-price">
              No price is on hand for {s} right now, so the levels are listed without their distance from it.
            </p>
          ) : null}
        </>
      )}

      {levelCount > 0 ? (
        <>
          <div className={styles.tableBox}>
            <table className={styles.table} data-testid="terminal-lvl-table" aria-label={`Key levels for ${s}, highest price first`}>
              <thead>
                <tr>
                  <th scope="col">Level</th>
                  <th scope="col">Price ($)</th>
                  <th scope="col">From the price</th>
                  <th scope="col" className={`${styles.phoneHide} ${styles.wrapCell}`}>Built from</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (r.kind === 'price' ? (
                  <tr key={r.key} aria-current="true" data-testid="terminal-lvl-row-price">
                    <td><strong>{priceLabel}</strong></td>
                    <td><strong>{formatNumber(r.price, { decimals: 2, absent: NA })}</strong></td>
                    <td>{''}</td>
                    <td className={`${styles.phoneHide} ${styles.wrapCell}`}>{priceDetail}</td>
                  </tr>
                ) : (
                  <tr key={r.key} data-testid={`terminal-lvl-row-${r.kind}`} data-side={r.side || undefined}>
                    <td>{r.label}</td>
                    <td>{formatNumber(r.price, { decimals: 2, absent: NA })}</td>
                    <td>{distanceText(r)}</td>
                    <td className={`${styles.phoneHide} ${styles.wrapCell}`}>{detailText(r)}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
          <dl className={styles.fields} data-testid="terminal-lvl-meanings">
            {kindsIn(rows).map((k) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{LEVEL_KINDS[k].label}</dt>
                <dd>{LEVEL_KINDS[k].meaning}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}

      <p className={styles.muted} data-testid="terminal-lvl-links">
        Also for {s}:{' '}
        <PanelCommand cmd={`${s} GP`} label={`Price chart (GP) for ${s}`}>Price chart (GP)</PanelCommand>,{' '}
        <PanelCommand cmd={`${s} GEX`} label={`Gamma exposure page (GEX) for ${s}`}>Gamma exposure page (GEX)</PanelCommand>,{' '}
        <PanelCommand cmd={`${s} DP`} label={`Dark pool prints page (DP) for ${s}`}>Dark pool prints page (DP)</PanelCommand>
      </p>
      <p className={styles.muted} data-testid="terminal-lvl-method">
        Options levels come from the options expiring within a week and are listed when they sit within {GEX_BAND_PCT}%
        of the price. Dark pool levels are the {DARK_POOL_TOP} largest clusters of confirmed dark pool prints over the
        last {sessions} sessions, each ${DARK_POOL_MIN_MILLIONS}M or more. Distance is each level against the price row;
        the words above and below say which side, so color is never the only signal.
        {gexState === 'ok' && gex.asOf ? ` Options levels worked out at ${clock(gex.asOf)}.` : ''}
        {dpState === 'ok' && dp.asOf ? ` Dark pool levels worked out at ${clock(dp.asOf)}.` : ''}
      </p>
    </div>
  )
}

export default function LevelsPanel({ sym }) {
  const s = String(sym || '').trim().toUpperCase()
  const code = useInTerminalPanel()?.code || LEVELS_CODE
  if (!s) {
    return (
      <PanelState kind="input" title={`${code} needs a ticker.`}>
        Type one first, e.g. <kbd>NVDA {code}</kbd>
      </PanelState>
    )
  }
  // Keyed by ticker: a new ticker is a new pair of reads, so one stock's levels are never drawn under another's name.
  return <LevelsBody key={s} sym={s} code={code} />
}
