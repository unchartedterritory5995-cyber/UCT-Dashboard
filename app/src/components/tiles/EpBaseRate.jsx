// app/src/components/tiles/EpBaseRate.jsx — TERM-090 (item 15 ACC-06).
//
// When a catalyst row is flagged as an Episodic Pivot, the member also sees how
// often that flag has followed through — derived by the server on every request
// from the engine's outcome record (`GET /api/catalysts/ep-base-rate`,
// `api/services/ep_base_rate.py`).
//
// ⛔ THIS FILE HOLDS NO RATE AND NO FLOOR. The server owns the thin-sample rule
// (`rate_pct` is null below `min_resolved`); this renders what it is given, so
// the rule lives in exactly one place. A null rate reads "not enough history"
// with n — never a percentage, never "0%".
//
// ⛔ THE CHIP REPLACES THE OLD EP "FIRM EDGE %" — it does not sit beside it. That
// figure came from `setup_performance` EP/ALL, which the engine picks per flag by
// `check_date DESC` and a same-day tie scores STOPPED flags as wins (42.2% vs
// 17.0% by id, measured 2026-09-28). Two rates for one flag on one row would be
// two authorities for one value.
//
// ⛔ EP IS PROHIBITED ON AN EARNINGS GAPPER (that is a PEG). Rows stored before
// the backend fix can still carry an EP grade on an earnings name, so the label
// is refused here too, by the row's own fields.
import useSWR from 'swr'
import UIcon from '../ui/UIcon'
import { formatNumber } from '../../lib/presentation/presentationPrimitives'
import styles from './CatalystTable.module.css'

export const EP_BASE_RATE_URL = '/api/catalysts/ep-base-rate'
export const EP_SETUP_LABEL = 'Episodic Pivot'

const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : null))

/** True for the Brain's EP grade. `brain_grades` names the setup "Episodic
 *  Pivot", but the engine resolves it to its canonical template key before the
 *  grade is stored, so the rows actually carry `EP` — both are the EP flag. */
export function isEpSetup(setup) {
  const s = String(setup || '').trim().toUpperCase().replace(/[-_]/g, ' ')
  return s === 'EP' || s === 'EPISODIC PIVOT'
}

/** True when the row is an earnings gapper — the EP label must not render. */
export function isEarningsGapper(row, rs) {
  if ((row?.catalyst_type || '') === 'Earnings') return true
  return Boolean(rs?.earnings_meta?.reported_recently)
}

function windowText(w) {
  if (!w || !w.start || !w.end) return 'no resolved flags yet'
  return `${w.start} → ${w.end}`
}

/** The one line beside the flag. Null when there is no payload to state. */
export function EpBaseRateLine({ data }) {
  if (!data || data.ok !== true) return null
  const n = formatNumber(data.resolved)
  const title = [
    data.definition,
    `${formatNumber(data.unresolved)} flags still being tracked are not counted.`,
    data.source ? `Source: ${data.source}.` : '',
  ].filter(Boolean).join(' ')
  const text = data.rate_pct == null
    ? `EP flags: not enough history · n=${n} resolved (need ${formatNumber(data.min_resolved)}) · ${windowText(data.window)}`
    : `${Math.round(Number(data.rate_pct))}% of EP flags followed through · ${formatNumber(data.followed_through)} of ${n} resolved · ${windowText(data.window)}`
  return (
    <span className={styles.epBase} title={title} data-testid="ep-base-rate">{text}</span>
  )
}

/** The EP flag plus its base rate, or nothing on an earnings gapper. */
export function EpFlagChip({ row, rs, data }) {
  if (isEarningsGapper(row, rs)) return null
  return (
    <>
      <span className={styles.edgeChip} title="Flagged as an Episodic Pivot">
        <UIcon name="patterns" size={10} style={{ marginRight: 3, verticalAlign: '-1px' }} />
        {EP_SETUP_LABEL}
      </span>
      <EpBaseRateLine data={data} />
    </>
  )
}

/** Fetching wrapper — SWR dedupes, so every EP row shares one request. */
export default function EpFlag({ row, rs }) {
  const { data } = useSWR(EP_BASE_RATE_URL, fetcher, { revalidateOnFocus: false })
  return <EpFlagChip row={row} rs={rs} data={data} />
}
