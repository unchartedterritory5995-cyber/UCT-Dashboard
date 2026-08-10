// app/src/components/calendar/KeywordAlerts.jsx
//
// Subscribe to a THEME across every company, from the place you just searched
// for it. The backend has had full CRUD and a nightly scan since day one and
// no face at all — arming a delivery pipeline nobody could see or unsubscribe
// from is why it stayed switched off.
//
// It lives beside the cross-company search on purpose: you type "tariff", see
// 351 companies said it, and the next thought is "tell me when someone new
// does". Making that one click is the whole point.
import { useCallback, useEffect, useState } from 'react'
import styles from './KeywordAlerts.module.css'

const j = (url, opts) => fetch(url, opts)
  .then((r) => (r.ok ? r.json() : null)).catch(() => null)

/** The server's refusal reason → something a person can act on. */
export function reasonText(res, min, max) {
  if (!res) return 'Could not save that. Try again.'
  switch (res.reason) {
    case 'too_short_or_too_long':
      return `Keywords need at least ${res.min_length ?? min ?? 3} characters — `
           + 'shorter ones match almost every call.'
    case 'limit_reached':
      return `That is the maximum of ${res.max ?? max} keywords. Remove one first.`
    default:
      return 'Could not save that. Try again.'
  }
}

export default function KeywordAlerts({ suggestion = '' }) {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setState(await j('/api/earnings/keyword-alerts'))
  }, [])

  useEffect(() => { load() }, [load])

  const add = useCallback(async (word) => {
    const term = (word || '').trim()
    if (!term) return
    setBusy(true); setErr('')
    const res = await j('/api/earnings/keyword-alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: term }),
    })
    // The endpoint answers {ok:false, reason} rather than throwing — a silent
    // no-op would look like a saved subscription that never fires.
    if (!res?.ok) setErr(reasonText(res, state?.min_length, state?.max))
    else setState((s) => ({ ...s, keywords: res.keywords }))
    setBusy(false)
  }, [state])

  const remove = useCallback(async (word) => {
    setBusy(true); setErr('')
    const res = await j(
      `/api/earnings/keyword-alerts?keyword=${encodeURIComponent(word)}`,
      { method: 'DELETE' })
    if (res?.keywords) setState((s) => ({ ...s, keywords: res.keywords }))
    setBusy(false)
  }, [])

  if (!state) return null

  const words = state.keywords || []
  const full = state.max ? words.length >= state.max : false
  const already = suggestion && words.includes(suggestion.trim().toLowerCase())

  return (
    <div className={styles.wrap} data-testid="keyword-alerts">
      <div className={styles.head}>
        <span className={styles.label}>ALERT ME WHEN ANYONE SAYS…</span>
        {/* State the delivery, always. A subscription whose destination is
            invisible is one nobody can reason about. */}
        <span className={styles.channel}>
          {state.enabled ? 'email + Discord, after the close'
                         : 'paused — not currently sending'}
        </span>
      </div>

      {suggestion && !already && !full && (
        <button type="button" className={styles.add} disabled={busy}
                onClick={() => add(suggestion)}>
          + Alert me on “{suggestion}”
        </button>
      )}

      {words.length > 0 && (
        <ul className={styles.chips}>
          {words.map((w) => (
            <li key={w} className={styles.chip}>
              {w}
              <button type="button" aria-label={`Remove ${w}`} disabled={busy}
                      onClick={() => remove(w)}>×</button>
            </li>
          ))}
        </ul>
      )}

      {words.length === 0 && !suggestion && (
        <p className={styles.note}>
          Search a term above, then subscribe to it here.
        </p>
      )}

      {full && <p className={styles.note}>Maximum of {state.max} keywords reached.</p>}
      {err && <p className={styles.err} role="alert">{err}</p>}
    </div>
  )
}
