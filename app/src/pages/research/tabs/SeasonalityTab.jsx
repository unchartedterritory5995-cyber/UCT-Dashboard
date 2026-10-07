import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { sectionFetcher, SectionFetchError } from '../../../components/research/sections/sectionFetch'
import { isTransientStatus } from '../../../utils/warmRetry'
import { signedPct } from '../researchFormat'
import rp from '../ResearchPage.module.css'
import styles from './SeasonalityTab.module.css'
import { usePanelFreshness } from '../../../components/terminal/terminalPanel'
import { formatPercentAsSent } from '../../../lib/presentation/presentationPrimitives'

// COV-01 (roadmap RM-L11) — how this stock has done by calendar month and by weekday,
// from our own daily bars. DARK behind SEASONALITY_ENABLED.
//
// ⛔ Every bucket shows its n. A month seen fewer than `min_years` times is marked thin
//    rather than hidden, so a big average from three years does not read like a law.
// ⛔ The covered window is stated ("since 2011"), never implied to be longer.
// ⛔ A failed request says so; it is never an empty table presented as "no pattern".

const pct = (v) => signedPct(v, 2)
const tone = (v) => (v == null ? '' : v > 0 ? styles.up : v < 0 ? styles.down : '')

function Table({ caption, rows, nLabel, thinNote }) {
  return (
    <table className={styles.grid}>
      <caption className={styles.caption}>{caption}</caption>
      <thead>
        <tr><th scope="col">{caption.startsWith('By month') ? 'Month' : 'Day'}</th>
          <th scope="col">Average</th><th scope="col">Median</th><th scope="col">% up</th><th scope="col">{nLabel}</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className={r.thin ? styles.thin : undefined} data-testid={`row-${r.label}`}>
            <th scope="row">{r.label}{r.thin ? <span className={styles.thinMark} title={thinNote}> *</span> : null}</th>
            <td className={tone(r.avg_pct)}>{pct(r.avg_pct)}</td>
            <td className={tone(r.median_pct)}>{pct(r.median_pct)}</td>
            <td>{formatPercentAsSent(r.pct_up)}</td>
            <td>{r.n}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// L8 + live sweep 2026-10-05: a COLD read answers 503 with Retry-After while the full daily
// history is still being read (the server refuses to compute from a partial read). That is a
// wait, not a failure: the panel says so and asks again on its own, at most PENDING_TRIES times.
export const PENDING_TRIES = 8

// Completeness audit 2026-10-07: every answer that was not a pending 503 was handed to
// sectionFetcher, which fetched the SAME url a second time -- two reads per open. The response in
// hand is read once now; only a transient failure goes on to sectionFetcher (its one warm retry).
export async function seasonalityFetcher(url) {
  let res = null
  try { res = await fetch(url) } catch { return sectionFetcher(url) }
  const retryAfter = res?.status === 503 ? res.headers?.get?.('Retry-After') : null
  if (retryAfter) {
    const secs = Number(retryAfter) || 15
    return { pending: true, retryAfterMs: Math.min(Math.max(secs, 2), 60) * 1000 }
  }
  if (res.status === 402) return { paywalled: true }
  if (res.ok) {
    try { return await res.json() } catch (cause) {
      throw new SectionFetchError(`Malformed response: ${cause?.message || cause}`, { status: res.status, url })
    }
  }
  if (isTransientStatus(res.status)) return sectionFetcher(url)
  throw new SectionFetchError(`Request failed (${res.status})`, { status: res.status, url })
}

export default function SeasonalityTab({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const { data, error, mutate } = useSWR(s ? `/api/research/seasonality/${encodeURIComponent(s)}` : null,
    seasonalityFetcher, { revalidateOnFocus: false })
  // TERM-019: name this panel's source (and its as-of) in the terminal panel header; a no-op elsewhere.
  usePanelFreshness(data && !data.pending && !data.paywalled && !error
    ? { source: 'UCT daily bar store', age: { dataClass: 'end_of_day', asOfDate: data.covered_to || null } }
    : null)
  // The re-ask counter is STATE, not a ref: Retry resets it and that reset must re-render (a ref
  // reset left the panel on "unavailable" with the re-asks spent -- completeness audit
  // 2026-10-07), and a re-ask whose answer equals the last one must still schedule the next.
  const [tries, setTries] = useState(0)
  useEffect(() => { setTries(0) }, [s])
  useEffect(() => {
    if (!data?.pending || tries >= PENDING_TRIES) return undefined
    const t = setTimeout(() => { setTries((n) => n + 1); mutate() }, data.retryAfterMs)
    return () => clearTimeout(t)
  }, [data, mutate, tries])
  const retry = () => { setTries(0); mutate() }

  if (data?.pending && tries < PENDING_TRIES) {
    return <div className={styles.note} data-testid="seasonality-pending">
      Reading the full daily history for {s}… this panel fills in by itself.
    </div>
  }
  if (error || data?.pending) {
    return <div className={styles.note} data-testid="seasonality-unavailable">
      Seasonality is unavailable right now. That is a gap in what we could read, not a finding about {s}.{' '}<button type="button" className={rp.basisBtn} onClick={retry}>Retry</button>
    </div>
  }
  if (!data) return <div className={styles.note}>Loading seasonality…</div>
  if (data.paywalled) return <div className={styles.note}>Seasonality requires a paid plan.</div>

  const since = data.covered_from ? data.covered_from.slice(0, 4) : null
  // tq-panels: a symbol with no full month on file (a fresh listing, a thin record) used to
  // render two empty tables. Say there is not enough history, and for what window we hold.
  if (!data.full_months) {
    const held = data.covered_from && data.covered_to
      ? `We hold daily bars for ${s} only from ${data.covered_from} to ${data.covered_to}`
      : `We hold no daily bars for ${s}`
    return <div className={styles.note} data-testid="seasonality-thin">
      Not enough history for seasonality. {held}, which is not one full calendar month
      — at least one full month is needed, and {data.min_years || 5} years before a month can be leaned on.
    </div>
  }
  const thinNote = `Seen fewer than ${data.min_years} times: too few to lean on.`
  return (
    <section data-testid="seasonality">
      <p className={styles.lede} data-testid="seasonality-window">
        {s} since {since || '—'} ({data.full_months} full months of history), close to close.
      </p>
      <div className={styles.tables}>
        <Table caption="By month" rows={data.months || []} nLabel="Years" thinNote={thinNote} />
        <Table caption="By weekday" rows={data.weekdays || []} nLabel="Sessions" thinNote={thinNote} />
      </div>
      <p className={styles.muted} data-testid="seasonality-basis">
        From the UCT daily bar store. A partial first or last month is not counted. * {thinNote}
        History describes the past; it is not a forecast.
      </p>
    </section>
  )
}
