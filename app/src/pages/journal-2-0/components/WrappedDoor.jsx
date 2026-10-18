/**
 * P2 Tier 3, Task 8 — the Report page's door to "Your <year> in trading" (ruling R-T3-V6).
 *
 *   - the current ET year, from December 1 ET (`currentYearOpen`, whose date is the server's
 *     `wrapped.OPENS_ON`);
 *   - a picker of EARLIER years, fed by `GET /api/j2/wrapped/years` for the account the report is
 *     showing, because the Report page holds no trade list by default.
 *
 * Only while `tier3Enabled()`: with the switch off it renders nothing and fetches nothing. It links
 * to the page and never imports it, so the report pays only for this door.
 */
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import UIcon from '../../../components/ui/UIcon'
import { tier3Enabled } from '../lib/tier3Flag'
import { WRAPPED_YEARS_API, currentYearOpen, wrappedHref } from '../lib/wrappedLink'
import styles from './WrappedDoor.module.css'

const getJson = (url) => fetch(url, { credentials: 'include' }).then((r) => {
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
})

export default function WrappedDoor({ accountId }) {
  const on = tier3Enabled()
  const pickerId = useId()
  const [picked, setPicked] = useState(null)
  const key = on ? `${WRAPPED_YEARS_API}${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ''}` : null
  const { data } = useSWR(key, getJson, { revalidateOnFocus: false, shouldRetryOnError: false })
  if (!on) return null

  const cur = currentYearOpen()
  const earlier = (Array.isArray(data?.years) ? data.years : []).filter((y) => y < cur.year)
  if (!cur.open && !earlier.length) return null
  const year = earlier.includes(picked) ? picked : earlier[0]

  return (
    <nav className={styles.door} aria-label="Your trading year" data-testid="wrapped-door">
      {cur.open ? (
        <Link className={styles.current} to={wrappedHref(cur.year)}>
          <UIcon name="calendar" size={13} className={styles.icon} />
          {`Your ${cur.year} in trading`}
        </Link>
      ) : null}
      {earlier.length ? (
        <span className={styles.picker}>
          <label className={styles.label} htmlFor={pickerId}>Earlier years</label>
          <select id={pickerId} className={styles.select} value={year}
                  onChange={(e) => setPicked(Number(e.target.value))}>
            {earlier.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <Link className={styles.open} to={wrappedHref(year)}>{`Your ${year} in trading`}</Link>
        </span>
      ) : null}
    </nav>
  )
}
