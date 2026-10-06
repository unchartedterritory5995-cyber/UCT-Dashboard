import { useState } from 'react'
import useSWR from 'swr'
import { depthFetcher } from './depthFetch'
import styles from './Depth.module.css'

// Lane R — Research › Depth › News desk, over the company-news store.
// Three annotations, each riding ONLY with its own server flag (the payload's
// `annotations` list says which are present; the client never assumes one):
//   D-6 versions   — "Edited N×" with the prior texts we observed; retraction is
//                    stated as NOT tracked, never inferred from absence.
//   D-7 importance — High / Normal / Low, ALWAYS with the rule that set it.
//   D-8 read       — per-member read / unread, saved server-side.
// ⛔ A failed read of the desk is "could not read", never "no news".
// ⛔ A failed read-state save says so; the row does not pretend it was saved.

const LABEL = { high: 'High', normal: 'Normal', low: 'Low' }

function Versions({ id }) {
  const { data, error } = useSWR(`/api/research/news-desk/story/${id}/versions`, depthFetcher,
    { revalidateOnFocus: false })
  if (error) return <p className={styles.error} data-testid="news-versions-error">The earlier versions could not be read.</p>
  if (!data) return <p className={styles.muted}>Loading earlier versions…</p>
  return (
    <ol className={styles.help} data-testid="news-versions">
      {(data.prior_versions || []).map(v => (
        <li key={v.version_no}>
          <span>{v.headline}</span>
          <span className={styles.cite}> · replaced {v.replaced_at} · changed: {(v.changed || []).join(', ')}</span>
        </li>
      ))}
    </ol>
  )
}

export default function NewsDeskPanel({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const key = s ? `/api/research/news-desk/${encodeURIComponent(s)}` : null
  const { data, error, mutate } = useSWR(key, depthFetcher, { revalidateOnFocus: false })
  const [open, setOpen] = useState(null)
  const [saveError, setSaveError] = useState('')

  async function setRead(ids, read) {
    setSaveError('')
    try {
      const res = await fetch('/api/research/news-desk/read', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, read }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await mutate()
    } catch (e) {
      setSaveError(`Read state was not saved (${e?.message || e}).`)
    }
  }

  let body
  if (error) body = <div className={styles.error} data-testid="news-desk-unavailable">The news desk is unavailable right now. That is a gap in what we could read, not a finding about {s}.{' '}<button type="button" className={styles.retry} onClick={() => mutate()}>Retry</button></div>
  else if (!data) body = <div className={styles.note}>Loading news…</div>
  else if (data.paywalled) body = <div className={styles.note}>The news desk requires a paid plan.</div>
  else {
    const ann = data.annotations || []
    const items = data.items || []
    const unread = ann.includes('read') ? items.filter(it => !it.read_at).map(it => it.id) : []
    body = (
      <div data-testid="news-desk">
        {saveError && <p className={styles.error} data-testid="news-read-error">{saveError}</p>}
        {ann.includes('read') && unread.length > 0 && (
          <button type="button" className={styles.button} data-testid="news-mark-all"
            onClick={() => setRead(unread, true)}>Mark {unread.length} read</button>
        )}
        {items.length === 0
          ? <p className={styles.note} data-testid="news-desk-empty">No stories about {s} are in our news store.</p>
          : (
            <ul className={styles.hits}>
              {items.map(it => (
                <li key={it.id} className={styles.hit} data-testid="news-desk-row"
                  data-read={ann.includes('read') ? (it.read_at ? 'read' : 'unread') : undefined}>
                  <div>
                    {ann.includes('read') && !it.read_at && <strong data-testid="news-unread">● </strong>}
                    <a href={it.url} target="_blank" rel="noopener noreferrer"
                      onClick={() => { if (ann.includes('read') && !it.read_at) setRead([it.id], true) }}>{it.headline}</a>
                  </div>
                  <div className={styles.cite}>
                    {it.source} · {it.published_at} · {it.category}
                    {ann.includes('importance') && it.importance && (
                      <span data-testid="news-importance"> · <strong>{LABEL[it.importance.label] || it.importance.label}</strong>
                        {' '}({(it.importance.reasons || []).join('; ')})</span>
                    )}
                    {ann.includes('versions') && it.prior_versions > 0 && (
                      <> · <button type="button" className={styles.button} data-testid="news-edited"
                        onClick={() => setOpen(open === it.id ? null : it.id)}>
                        Edited {it.prior_versions}×</button></>
                    )}
                    {ann.includes('read') && it.read_at && (
                      <> · <button type="button" className={styles.button} data-testid="news-mark-unread"
                        onClick={() => setRead([it.id], false)}>Mark unread</button></>
                    )}
                  </div>
                  {open === it.id && <Versions id={it.id} />}
                </li>
              ))}
            </ul>
          )}
        {ann.includes('versions') && data.retraction && (
          <p className={styles.muted} data-testid="news-retraction">Retractions: {data.retraction.reason}</p>
        )}
        {ann.includes('importance') && (data.importance_rules || []).length > 0 && (
          <details>
            <summary className={styles.muted}>How importance is labelled</summary>
            <ul className={styles.help} data-testid="news-importance-rules">
              {data.importance_rules.map((r, i) => <li key={i}><strong>{LABEL[r.label] || r.label}</strong>: {r.rule}</li>)}
            </ul>
          </details>
        )}
        <p className={styles.muted}>{data.source}.</p>
      </div>
    )
  }
  return (
    <section className={styles.panel} data-testid="news-desk-panel">
      <h3 className={styles.panelTitle}>News desk</h3>
      {body}
    </section>
  )
}
