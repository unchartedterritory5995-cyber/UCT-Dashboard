// TERM-078 (FB-I1-04) — member-visible AI meters, read-only.
//
// "Never ship a hard cap without a meter" (F-01 PROD-C1). With one paid tier there
// is no tier to explain a refusal, so the only honest lever is the number itself,
// readable BEFORE it runs out. Every row is fed by GET /api/ai-search/meters, which
// reads the SAME counter each AI door spends (api/services/ai_meters.py).
//
// ⛔ An unreadable counter is NOT shown as zero used: the doors fail OPEN while the
// count cannot be read, and this card says so in words.
import { useEffect, useState } from 'react'
import TileCard from '../../components/TileCard'
import styles from './AiMetersCard.module.css'

export const METERS_URL = '/api/ai-search/meters'

export const UNREADABLE_SENTENCE =
  "Usage can't be read right now, so this limit isn't being counted. The feature stays available."
export const LOAD_FAILED_SENTENCE = "Your AI allowances couldn't be loaded right now."

function periodWord(period) {
  return period === 'month' ? 'this month' : 'today'
}

export function MeterRow({ m }) {
  if (!m.readable) {
    return (
      <li className={styles.row} data-testid={`ai-meter-${m.key}`}>
        <div className={styles.head}>
          <span className={styles.label}>{m.label}</span>
          <span className={styles.value}>Unavailable</span>
        </div>
        <div className={styles.note}>{UNREADABLE_SENTENCE}</div>
      </li>
    )
  }
  if (m.uncapped || m.limit == null) {
    return (
      <li className={styles.row} data-testid={`ai-meter-${m.key}`}>
        <div className={styles.head}>
          <span className={styles.label}>{m.label}</span>
          <span className={styles.value}>{m.used} {m.unit} {periodWord(m.period)} · no limit</span>
        </div>
      </li>
    )
  }
  const pct = m.limit > 0 ? Math.min(100, Math.round((m.used / m.limit) * 100)) : 100
  const out = m.remaining <= 0
  return (
    <li className={styles.row} data-testid={`ai-meter-${m.key}`}>
      <div className={styles.head}>
        <span className={styles.label}>{m.label}</span>
        <span className={styles.value}>{m.used} / {m.limit} {m.unit}</span>
      </div>
      <div className={styles.bar} role="meter" aria-label={m.label}
           aria-valuemin={0} aria-valuemax={m.limit} aria-valuenow={m.used}>
        <div className={`${styles.fill} ${out ? styles.fillOut : ''}`} style={{ width: `${pct}%` }} />
      </div>
      <div className={styles.note}>
        {out
          ? `None left ${periodWord(m.period)}. Resets ${m.resets}.`
          : `${m.remaining} left ${periodWord(m.period)} · resets ${m.resets}`}
      </div>
    </li>
  )
}

function PopulationRow({ p }) {
  if (!p || !p.enforced) return null
  if (!p.readable) {
    return (
      <div className={styles.population} data-testid="ai-meter-population">
        <span className={styles.label}>Shared membership limit</span>
        <div className={styles.note}>{UNREADABLE_SENTENCE}</div>
      </div>
    )
  }
  return (
    <div className={styles.population} data-testid="ai-meter-population">
      <div className={styles.head}>
        <span className={styles.label}>Shared membership limit</span>
        <span className={styles.value}>{p.pct_used}% used today</span>
      </div>
      {/* the server's own refusal sentence -- one authority for what a refusal says */}
      {p.reached && p.message && <div className={styles.note}>{p.message}</div>}
    </div>
  )
}

export default function AiMetersCard() {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(METERS_URL, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [])

  return (
    <TileCard icon="sparkle" title="AI Allowances">
      <p className={styles.intro}>
        What you have used of each AI feature's limit, and what remains. Limits keep AI
        available for every member on the one plan.
      </p>
      {failed && <div className={styles.note}>{LOAD_FAILED_SENTENCE}</div>}
      {!failed && !data && <div className={styles.note}>Loading…</div>}
      {data && (
        <>
          {data.meters.length === 0
            ? <div className={styles.note}>No AI feature with a limit is on for your account.</div>
            : <ul className={styles.list}>{data.meters.map((m) => <MeterRow key={m.key} m={m} />)}</ul>}
          <PopulationRow p={data.population} />
        </>
      )}
    </TileCard>
  )
}
