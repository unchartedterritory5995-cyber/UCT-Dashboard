import { useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import StockChart from '../../components/StockChart'
import { captureChartPng } from '../../utils/chartCapture'
import styles from './PatternReview.module.css'

const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => r.json())

function parseDrawings(json) {
  if (!json) return []
  try {
    const d = JSON.parse(json)
    return Array.isArray(d) ? d : []
  } catch {
    return []
  }
}

export default function PatternReview() {
  const { data, mutate } = useSWR('/api/patterns/admin/review?limit=120', fetcher, {
    revalidateOnFocus: false,
  })
  const verdicts = data?.verdicts || []
  const [selId, setSelId] = useState(null)
  const sel = useMemo(
    () => verdicts.find((v) => `${v.ticker}|${v.setup}|${v.asof_date}` === selId) || verdicts[0],
    [verdicts, selId],
  )

  const [note, setNote] = useState('')
  const [drawMode, setDrawMode] = useState(false)
  const [draft, setDraft] = useState([])
  const [saving, setSaving] = useState('')
  const wrapRef = useRef(null)

  // reset per-selection editing state
  const selKey = sel ? `${sel.ticker}|${sel.setup}|${sel.asof_date}` : null
  const lastKey = useRef(null)
  if (selKey !== lastKey.current) {
    lastKey.current = selKey
    setNote(sel?.feedback?.note || '')
    setDrawMode(false)
    setDraft([])
  }

  async function sendFeedback(rating) {
    if (!sel) return
    setSaving('feedback')
    await fetch('/api/patterns/feedback', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: sel.ticker, tf: sel.tf, setup: sel.setup,
        asof_date: sel.asof_date, rating, note: note || null,
      }),
    })
    setSaving('')
    mutate()
  }

  async function saveExemplar() {
    if (!sel) return
    const image = captureChartPng(wrapRef.current)
    if (!image) {
      setSaving('error')
      return
    }
    setSaving('exemplar')
    await fetch('/api/patterns/exemplar', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setup: sel.setup, ticker: sel.ticker, asof_date: sel.asof_date,
        note: note || null, image, drawings_json: JSON.stringify(draft),
      }),
    })
    setSaving('')
    setDrawMode(false)
    examplars.mutate()
  }

  const examplars = useSWR(
    sel ? `/api/patterns/admin/exemplars?setup=${encodeURIComponent(sel.setup)}` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  async function deleteExemplar(id) {
    await fetch(`/api/patterns/exemplar/${id}`, { method: 'DELETE', credentials: 'include' })
    examplars.mutate()
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Pattern Review</h1>
        <p className={styles.sub}>
          Review the AI judge's verdicts, give feedback, and draw the ideal — saved drawings become
          gold-standard examples the judge learns from.
        </p>
      </div>

      <div className={styles.body}>
        {/* LEFT: verdict list */}
        <div className={styles.list}>
          {verdicts.length === 0 && <div className={styles.empty}>No judged verdicts yet.</div>}
          {verdicts.map((v) => {
            const key = `${v.ticker}|${v.setup}|${v.asof_date}`
            return (
              <button
                key={key}
                className={`${styles.row} ${key === selKey ? styles.rowActive : ''}`}
                onClick={() => setSelId(key)}
              >
                <span className={styles.rowSym}>{v.ticker}</span>
                <span className={styles.rowSetup}>{v.setup}</span>
                <span className={v.confirmed ? styles.badgeYes : styles.badgeNo}>
                  {v.confirmed ? 'confirmed' : 'rejected'}
                </span>
                <span className={styles.rowConf}>{Math.round(v.vision_confidence || 0)}</span>
                {v.feedback && (
                  <span className={styles.fbDot} title={v.feedback.note || ''}>
                    {v.feedback.rating === 'up' ? '▲' : '▼'}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* RIGHT: chart + verdict + feedback + draw */}
        <div className={styles.detail}>
          {!sel && <div className={styles.empty}>Select a verdict.</div>}
          {sel && (
            <>
              <div className={styles.detailHead}>
                <span className={styles.detailSym}>{sel.ticker}</span>
                <span className={styles.detailSetup}>{sel.setup}</span>
                <span className={sel.confirmed ? styles.badgeYes : styles.badgeNo}>
                  {sel.confirmed ? 'confirmed' : 'rejected'} · {Math.round(sel.vision_confidence || 0)}
                </span>
              </div>
              {sel.rationale && <div className={styles.reason}>“{sel.rationale}”</div>}
              {Array.isArray(sel.checks) && sel.checks.length > 0 && (
                <ul className={styles.checks}>
                  {sel.checks.map((c, i) => (
                    <li key={i} className={c.passed ? styles.ckPass : styles.ckFail}>
                      {c.passed ? '✓' : '✗'} {c.criterion}
                    </li>
                  ))}
                </ul>
              )}

              <div className={styles.chartWrap} ref={wrapRef}>
                <StockChart
                  sym={sel.ticker}
                  tf="D"
                  showDrawingTools={false}
                  annotations={drawMode ? draft : null}
                  annotationsVisible={drawMode}
                  annotationsEditable={drawMode}
                  onAnnotationsChange={setDraft}
                />
              </div>

              <div className={styles.actions}>
                <button className={styles.up} disabled={saving === 'feedback'}
                  onClick={() => sendFeedback('up')}>👍 Agree</button>
                <button className={styles.down} disabled={saving === 'feedback'}
                  onClick={() => sendFeedback('down')}>👎 Wrong</button>
                {!drawMode ? (
                  <button className={styles.draw} onClick={() => { setDrawMode(true); setDraft([]) }}>
                    ✏️ Draw the ideal
                  </button>
                ) : (
                  <>
                    <button className={styles.save} disabled={saving === 'exemplar'}
                      onClick={saveExemplar}>💾 Save as ideal example</button>
                    <button className={styles.cancel}
                      onClick={() => { setDrawMode(false); setDraft([]) }}>Cancel</button>
                  </>
                )}
                {saving === 'error' && <span className={styles.err}>Capture failed — try again.</span>}
              </div>

              <textarea
                className={styles.note}
                placeholder="Note / insight (saved with feedback and the ideal example)…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />

              {/* existing ideal examples for this setup */}
              <div className={styles.exHead}>Ideal examples for “{sel.setup}”</div>
              <div className={styles.exList}>
                {(examplars.data?.exemplars || []).length === 0 && (
                  <span className={styles.exEmpty}>None yet — draw one above.</span>
                )}
                {(examplars.data?.exemplars || []).map((e) => (
                  <div key={e.id} className={styles.exItem}>
                    <span>{e.ticker || '—'} {e.note ? `· ${e.note}` : ''}</span>
                    <button className={styles.exDel} onClick={() => deleteExemplar(e.id)}>delete</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
