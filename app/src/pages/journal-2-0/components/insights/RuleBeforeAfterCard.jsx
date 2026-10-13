/**
 * RuleBeforeAfterCard — Insights, "Before / after this rule" (Notebook P2b Task 9; spec §P2 item 2;
 * R-P2b-3; Review Focus 2).
 *
 * Pick one of the account's rules; for each version of its words, newest first, the member's trades
 * BEFORE the change and AFTER it, side by side (they stack on a phone), split on the ET day the words
 * changed (the server's windows, GET /api/j2/trader-blocks/rules/{id}/before-after). Every line comes
 * from lib/blocks/beforeAfterText.windowLines: sample sizes always, and never a bare rate under 10
 * trades. Adherence is read through the server's ONE join (trader_blocks.adherence_of_trade); the
 * card adds no fallback of its own.
 *
 * Read-only. A rule the server will not read (404: dismissed, or not the member's, R-PF-N20) is said in
 * words. PsychologySection mounts it, as its own chunk, only while Journal styles is on and one account
 * is selected. NO emoji.
 */
import { useId, useState } from 'react'
import useSWR from 'swr'
import useJournalRules from '../../hooks/useJournalRules'
import { windowLines } from '../../lib/blocks/beforeAfterText'
import { versionLine } from '../../lib/blocks/rulesApi'
import styles from './RuleBeforeAfterCard.module.css'

const NOT_READ = 'This rule could not be read. It may have been dismissed.'
const FAILED = "The before and after numbers couldn't load."

async function fetcher(url) {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) {
    const err = new Error(`${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

function WindowColumn({ id, name, win }) {
  return (
    <div className={styles.col}>
      <p id={id} className={styles.colHead}>{name}</p>
      <ul aria-labelledby={id} className={styles.lines}>
        {Object.entries(windowLines(win)).map(([k, line]) => <li key={k}>{line}</li>)}
      </ul>
    </div>
  )
}

export default function RuleBeforeAfterCard({ accountId }) {
  const baseId = useId()
  const { rules } = useJournalRules(accountId)
  const list = Array.isArray(rules) ? rules : []
  const [picked, setPicked] = useState(null)
  // The picked rule while it is still listed; otherwise the first (a dismissed rule leaves the list).
  const ruleId = list.some((r) => r.id === picked) ? picked : (list[0]?.id ?? null)
  const key = ruleId ? `/api/j2/trader-blocks/rules/${encodeURIComponent(ruleId)}/before-after` : null
  const { data, error, mutate } = useSWR(key, fetcher, { revalidateOnFocus: false, shouldRetryOnError: false })

  if (!list.length) return null

  let body
  if (error?.status === 404) body = <p role="status" className={styles.muted}>{NOT_READ}</p>
  else if (error) {
    body = (
      <div role="status" className={styles.failed}>
        <span>{FAILED}</span>
        <button type="button" className={`btn btn-ghost ${styles.tap}`} onClick={() => mutate()}>Try again</button>
      </div>
    )
  } else if (!data) body = <p className={styles.muted} aria-live="polite">Loading…</p>
  else {
    const versions = Array.isArray(data.versions) ? data.versions : []
    body = versions.map((v) => (
      <section key={v.version} aria-label={`Version ${v.version}`} className={styles.version}>
        <p className={styles.words}>{v.label}</p>
        <p className={styles.muted}>{versionLine(v)}</p>
        <div className={styles.cols}>
          <WindowColumn id={`${baseId}-${v.version}-before`} name="Before" win={v.before} />
          <WindowColumn id={`${baseId}-${v.version}-after`} name="After" win={v.after} />
        </div>
      </section>
    ))
  }

  return (
    <section aria-labelledby={`${baseId}-title`} className={styles.card}>
      <h5 id={`${baseId}-title`} className={styles.title}>Before / after this rule</h5>
      <p className={styles.sub}>
        Your trades before and after each change to a rule&apos;s words, split on the day it changed.
        Every number shows its sample; under 10 trades there is no rate.
      </p>
      <label className={styles.pick}>
        <span>Rule</span>
        <select aria-label="Rule" className={styles.tap} value={ruleId ?? ''} onChange={(e) => setPicked(e.target.value)}>
          {list.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>
      {body}
    </section>
  )
}
