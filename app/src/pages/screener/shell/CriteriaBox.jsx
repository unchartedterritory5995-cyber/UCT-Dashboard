import { useEffect, useState } from 'react'
import { grammarAvailable, parseCriteria } from './criteriaApi'
import styles from './CriteriaBox.module.css'

// CriteriaBox — type criteria as text (FT-029) and get grouped logic (FT-026):
//
//   price > 10 and avg_volume_30d >= 1.5m and (rs_rank >= 90 or eps_growth > 25%)
//
// Apply sends the text to the server's parser; what comes back is the logic
// tree the screen runs PLUS one sentence per criterion, rendered below as the
// explanation of what was applied. Nothing is guessed client-side: a text the
// parser refuses shows the parser's own sentence and changes nothing.
//
// Renders nothing until the server says the grammar exists.
export default function CriteriaBox({ logic, onApply, fetcher }) {
  const [available, setAvailable] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [outline, setOutline] = useState(null)

  useEffect(() => {
    let live = true
    grammarAvailable(fetcher).then(ok => { if (live) setAvailable(ok) })
    return () => { live = false }
  }, [fetcher])

  // A spec cleared elsewhere (Clear, a preset) clears the outline too, so the
  // panel never describes criteria the screen is no longer running.
  useEffect(() => { if (!logic) setOutline(null) }, [logic])

  if (!available) return null

  const apply = async () => {
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    try {
      const out = await parseCriteria(text, fetcher)
      setOutline(out.explanation || [])
      onApply(out.logic)
    } catch (e) {
      setError(e?.message || 'Those criteria could not be read.')
    } finally {
      setBusy(false)
    }
  }

  const clear = () => { setText(''); setOutline(null); setError(null); onApply(null) }

  return (
    <section className={styles.box} aria-label="Typed criteria">
      <label className={styles.label} htmlFor="screener-criteria">Criteria</label>
      <textarea id="screener-criteria" className={styles.input} rows={3} value={text}
        placeholder="price > 10 and (rs_rank >= 90 or eps_growth > 25%)"
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply() } }} />
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={apply} disabled={busy || !text.trim()}>
          {busy ? 'Reading…' : 'Apply'}
        </button>
        {logic && <button type="button" className={styles.btnGhost} onClick={clear}>Remove</button>}
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {logic && outline?.length > 0 && (
        <ul className={styles.outline} aria-label="Applied criteria">
          {outline.map((line, i) => (
            <li key={i} style={{ paddingLeft: `${line.depth * 12}px` }}>{line.text}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
