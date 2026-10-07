import { useEffect, useState } from 'react'
import { grammarAvailable, parseCriteria, compileAvailable, compileEnglish } from './criteriaApi'
import styles from './CriteriaBox.module.css'
import Input from '../../../components/ui/Input'

// CriteriaBox — type criteria as text (FT-029) and get grouped logic (FT-026):
//
//   price > 10 and avg_volume_30d >= 1.5m and (rs_rank >= 90 or eps_growth > 25%)
//
// Apply sends the text to the server's parser; what comes back is the logic
// tree the screen runs PLUS one sentence per criterion, rendered below as the
// explanation of what was applied. Nothing is guessed client-side: a text the
// parser refuses shows the parser's own sentence and changes nothing.
//
// FT-024/030: when the compile door is open, a plain-English line above it
// asks the server to WRITE the criteria. The result lands in the same text
// box, editable, with every assumption the compile made listed beside it —
// the member always sees, and can change, the exact criteria being run.
//
// Renders nothing until the server says the grammar exists.
export default function CriteriaBox({ logic, onApply, fetcher }) {
  const [available, setAvailable] = useState(false)
  const [canCompile, setCanCompile] = useState(false)
  const [english, setEnglish] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [outline, setOutline] = useState(null)
  const [assumptions, setAssumptions] = useState([])

  useEffect(() => {
    let live = true
    grammarAvailable(fetcher).then(ok => {
      if (!live) return
      setAvailable(ok)
      if (ok) compileAvailable(fetcher).then(c => { if (live) setCanCompile(c) })
    })
    return () => { live = false }
  }, [fetcher])

  // A spec cleared elsewhere (Clear, a preset) clears the outline too, so the
  // panel never describes criteria the screen is no longer running.
  useEffect(() => { if (!logic) { setOutline(null); setAssumptions([]) } }, [logic])

  if (!available) return null

  const apply = async () => {
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    try {
      const out = await parseCriteria(text, fetcher)
      setOutline(out.explanation || [])
      setAssumptions([])
      onApply(out.logic)
    } catch (e) {
      setError(e?.message || 'Those criteria could not be read.')
    } finally {
      setBusy(false)
    }
  }

  const write = async () => {
    if (!english.trim()) return
    setBusy(true)
    setError(null)
    try {
      const out = await compileEnglish(english, fetcher)
      setText(out.criteria || '')
      setOutline(out.explanation || [])
      setAssumptions(out.assumptions || [])
      onApply(out.logic)
    } catch (e) {
      setError(e?.message || 'That could not be turned into a screen.')
    } finally {
      setBusy(false)
    }
  }

  const clear = () => {
    setText(''); setEnglish(''); setOutline(null); setAssumptions([]); setError(null); onApply(null)
  }

  return (
    <section className={styles.box} aria-label="Typed criteria">
      {canCompile && (
        <>
          <label className={styles.label} htmlFor="screener-english">Describe it</label>
          <Input id="screener-english" className={styles.input} value={english}
            placeholder="liquid tech leaders up 20% this quarter, no utilities"
            onChange={e => setEnglish(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); write() } }} />
          <div className={styles.actions}>
            <button type="button" className={styles.btn} onClick={write} disabled={busy || !english.trim()}>
              {busy ? 'Writing…' : 'Write criteria'}
            </button>
          </div>
        </>
      )}
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
      {logic && assumptions.length > 0 && (
        <ul className={styles.outline} aria-label="Assumptions made">
          {assumptions.map((a, i) => <li key={i}>Assumed: {a}</li>)}
        </ul>
      )}
    </section>
  )
}
