import { useId } from 'react'
import useSWR from 'swr'
import LoadFailed from '../LoadFailed'
import { notebookFlag } from '../../lib/offline/notebookFlags'
import styles from './SetupsBoard.module.css'

/**
 * Wave 13 lane 13J -- "Find more like this": today's names whose technical fingerprint and
 * confirmed patterns most closely match one of the member's tagged charts, each with its
 * reasons per field.
 *
 * ⛔ THIS ONLY READS. The matches are PRECOMPUTED NIGHTLY (`similar_matches.py`, after the
 * 05:00 ET scan sweep) into `j2_similar_matches`; the route reads those rows and nothing else.
 * A chart tagged today has no matches until tonight's run, and this says so rather than
 * asking the server to scan the universe on a click.
 *
 * The reasons are the server's own field deltas (label, unit, this name's value, your
 * chart's value); this file only words them.
 */

export const SIMILAR_FLAG = 'notebook_find_similar_enabled'
export const TEMPLATES_URL = '/api/j2/similar-names/templates'
export const similarUrl = (noteId, embedKey) =>
  `/api/j2/similar-names/${encodeURIComponent(noteId)}/${encodeURIComponent(embedKey)}`

export function findSimilarEnabled() {
  return notebookFlag(SIMILAR_FLAG) === true
}

export async function fetchJson(url) {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) {
    const err = new Error(`Could not load (${res.status})`)
    err.status = res.status
    throw err
  }
  return res.json()
}

const SETUP_WORDS = { vcp: 'VCP', htf: 'HTF', flat_base: 'Flat base' }
export function setupLabel(s) {
  const key = String(s || '')
  if (SETUP_WORDS[key]) return SETUP_WORDS[key]
  const words = key.replace(/_/g, ' ').trim()
  return words.length <= 4 ? words.toUpperCase() : words.charAt(0).toUpperCase() + words.slice(1)
}

function fmtValue(v, unit) {
  if (typeof v === 'boolean') return v ? 'intact' : 'broken'
  if (typeof v === 'number') {
    const n = Number.isInteger(v) ? String(v) : v.toFixed(1)
    return `${n}${unit || ''}`
  }
  return String(v)
}

/** One reason, worded: "RS 94 vs 92", "depth 11.0% vs 12.0%", "MA stack full-bull". */
export function reasonText(r) {
  if (r.candidate == null) return `${r.label}: not available for this name`
  if (r.same === true) return `${r.label} ${fmtValue(r.candidate, r.unit)}`
  return `${r.label} ${fmtValue(r.candidate, r.unit)} vs ${fmtValue(r.template, r.unit)}`
}

/** The closest compared fields first (the strongest reasons), ties in the server's order. */
export function topReasons(reasons, n = 3) {
  const fields = (reasons?.fields || []).filter((r) => r.candidate != null && r.d != null)
  return fields.map((r, i) => [r, i]).sort((a, b) => a[0].d - b[0].d || a[1] - b[1]).slice(0, n).map(([r]) => r)
}

function MatchRow({ m }) {
  const shared = m.reasons?.patterns?.shared || []
  const top = topReasons(m.reasons)
  const summary = [...top.map(reasonText), ...shared.map(setupLabel)].join(' · ')
  return (
    <li className={styles.match} data-match={m.symbol}>
      <div className={styles.matchHead}>
        <span className={styles.matchRank}>{m.rank}</span>
        <span className={styles.symbol}>{m.symbol}</span>
        <span className={styles.score}>{m.score} match</span>
      </div>
      <p className={styles.reasons} data-reasons="">{summary}</p>
      <details className={styles.allFields}>
        <summary>Every field compared</summary>
        <ul className={styles.fieldList}>
          {(m.reasons?.fields || []).map((r) => <li key={r.field}>{reasonText(r)}</li>)}
          {m.reasons?.patterns && (
            <li>
              Patterns: {shared.length ? `${shared.map(setupLabel).join(', ')} on both` : 'none shared'}
              {m.reasons.patterns.missing ? ' (this name’s confirmed patterns could not be read)' : ''}
            </li>
          )}
        </ul>
      </details>
    </li>
  )
}

export default function SimilarNames({ noteId, embedKey }) {
  const enabled = findSimilarEnabled()
  const titleId = useId()
  const key = enabled && noteId && embedKey ? similarUrl(noteId, embedKey) : null
  const { data, error, isLoading, mutate } = useSWR(key, fetchJson,
    { revalidateOnFocus: false, shouldRetryOnError: false })
  if (!enabled) return null
  const t = data?.template
  return (
    <section className={styles.similar} aria-labelledby={titleId} data-similar-names="">
      <h3 id={titleId} className={styles.sectionTitle}>
        Names like {t?.symbol || 'this chart'}{t?.setupTag ? ` (${t.setupTag})` : ''}
      </h3>
      {error && <LoadFailed compact what="the similar names" error={error} onRetry={() => mutate()} />}
      {!error && isLoading && <p className={styles.quiet} role="status">Reading tonight’s matches…</p>}
      {!error && data?.status === 'not_tagged' && (
        <p className={styles.quiet}>Tag this chart with a setup and it is matched in the nightly run.</p>
      )}
      {!error && data?.status === 'pending' && (
        <p className={styles.quiet}>
          No matches yet. Tagged charts are matched against the day’s scored names every night after
          the scan sweep, so this one is matched tonight.
        </p>
      )}
      {!error && data?.status === 'ready' && (
        <>
          <p className={styles.scope}>
            Today’s scored names closest to your chart (as of {data.asOf}). The first value is the
            name’s, the second is your chart’s. A match is scored out of 100: 100 is an identical
            fingerprint.
          </p>
          <ol className={styles.matchList}>
            {data.matches.map((m) => <MatchRow key={m.symbol} m={m} />)}
          </ol>
        </>
      )}
    </section>
  )
}
