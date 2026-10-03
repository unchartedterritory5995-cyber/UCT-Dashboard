import { useEffect, useMemo, useRef, useState } from 'react'
import { mutate as mutateSWR } from 'swr'
import { Sheet } from '../../../../components/mobile'
import UIcon from '../../../../components/ui/UIcon'
import {
  fetchQuarters, fetchTranscript, savePassage,
  turnWords, quarterText,
} from '../../lib/researchCapture'
import { createNoteViaApi } from '../../lib/noteCreation'
import { settleNoteWrite } from '../../lib/offline/settleNoteWrite'
import styles from './SaveTranscriptPassage.module.css'

const NEW_NOTE = '__new__'
const EMPTY = Object.freeze([])

/** The member's selection, when it sits inside `el` -- what they meant to quote. */
function selectionInside(el) {
  if (typeof window === 'undefined' || !el || !window.getSelection) return ''
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return ''
  const node = sel.getRangeAt(0).commonAncestorContainer
  return el.contains(node) ? sel.toString().trim() : ''
}

/**
 * Wave 13 lane 13G-1 -- save a call-transcript passage into a note as a cited excerpt.
 *
 * The member picks a quarter UCT already HOLDS (the server reads only its cache and its stored
 * transcript index -- nothing is fetched, never AlphaVantage), a speaker turn, and the words;
 * the server re-checks the words are on that turn and files them as an ordinary excerpt, cited
 * `{call, date, source} · p.{turn}`. Nothing is saved until Save is pressed.
 *
 * Two doors, one sheet (the doors are `TranscriptDoors.jsx`, which load this file on use):
 *   - the ticker research workspace (`SaveTranscriptButton`): the member picks the note;
 *   - the note editor's /transcript insert (`TranscriptInsertHost`): the note is the open one,
 *     and the excerpt node lands at the caret.
 */
export default function SaveTranscriptPassage({
  open, onClose, symbol: givenSymbol = '', notes = null, fixedNoteId = null,
  quarter: preferredQuarter = null, onSaved, onOpenNote,
}) {
  const [symbol, setSymbol] = useState(givenSymbol || '')
  const [symbolDraft, setSymbolDraft] = useState(givenSymbol || '')
  const [quarters, setQuarters] = useState(null)
  const [quarter, setQuarter] = useState('')
  const [transcript, setTranscript] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(false)
  const [find, setFind] = useState('')
  const [turn, setTurn] = useState(null)
  const [passage, setPassage] = useState('')
  const [annotation, setAnnotation] = useState('')
  const [dest, setDest] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [fetchedNotes, setFetchedNotes] = useState(null)
  const turnRefs = useRef({})
  const passageRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setSymbol(givenSymbol || '')
    setSymbolDraft(givenSymbol || '')
    setResult(null)
    setError('')
  }, [open, givenSymbol])

  // A door that was not handed the member's notes (the calendar's transcript panel) asks for
  // their notes on this ticker; the workspace hands its own list in.
  useEffect(() => {
    if (!open || fixedNoteId || notes !== null || !symbol) return undefined
    let live = true
    fetch(`/api/j2/notes?ticker=${encodeURIComponent(symbol)}&limit=50`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { notes: [] }))
      .then((d) => { if (live) setFetchedNotes(Array.isArray(d?.notes) ? d.notes : []) })
      .catch(() => { if (live) setFetchedNotes([]) })
    return () => { live = false }
  }, [open, fixedNoteId, notes, symbol])
  const destNotes = useMemo(() => notes ?? fetchedNotes ?? EMPTY, [notes, fetchedNotes])

  useEffect(() => {
    if (fixedNoteId) return
    setDest((d) => (d && d !== NEW_NOTE ? d : (destNotes.length ? destNotes[0].id : NEW_NOTE)))
  }, [destNotes, fixedNoteId])

  // The quarters UCT holds for this symbol.
  useEffect(() => {
    if (!open || !symbol) return undefined
    let live = true
    setQuarters(null)
    setTranscript(null)
    setTurn(null)
    setLoadError('')
    fetchQuarters(symbol)
      .then((d) => {
        if (!live) return
        const qs = Array.isArray(d?.quarters) ? d.quarters : []
        setQuarters(qs)
        const preferred = qs.find((x) => x.quarter === preferredQuarter)
        setQuarter(preferred ? preferred.quarter : (qs.length ? qs[0].quarter : ''))
      })
      .catch((e) => { if (live) { setQuarters([]); setLoadError(e.message) } })
    return () => { live = false }
  }, [open, symbol, preferredQuarter])

  // The chosen call, as numbered speaker turns.
  useEffect(() => {
    if (!open || !symbol || !quarter) return undefined
    let live = true
    setLoading(true)
    setTranscript(null)
    setTurn(null)
    setLoadError('')
    fetchTranscript(symbol, quarter)
      .then((d) => { if (live) setTranscript(d) })
      .catch((e) => { if (live) setLoadError(e.message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [open, symbol, quarter])

  const turns = useMemo(() => {
    const all = transcript?.turns || []
    const q = find.trim().toLowerCase()
    return q ? all.filter((t) => t.text.toLowerCase().includes(q)) : all
  }, [transcript, find])

  const pickTurn = (t) => {
    const chosen = selectionInside(turnRefs.current[t.turn])
    setTurn(t)
    setPassage(chosen || turnWords(t))
    setError('')
    setResult(null)
    requestAnimationFrame(() => passageRef.current?.focus())
  }

  const save = async () => {
    if (!turn || !passage.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      let noteId = fixedNoteId || dest
      let noteTitle = null
      if (!fixedNoteId && dest === NEW_NOTE) {
        const created = await createNoteViaApi({
          title: `${symbol} ${quarterText(quarter)} call`, ticker: symbol,
        })
        noteId = created.id
        noteTitle = created.title
      } else if (!fixedNoteId) {
        noteTitle = destNotes.find((n) => n.id === dest)?.title || null
      }
      const out = await savePassage({
        noteId, symbol, quarter, turn: turn.turn, passage, annotation: annotation.trim(),
      })
      // ⛔ The save ADVANCED the note (the server placed the node). Land that revision, or the
      // offline queue reads the member's own write as somebody else's and forks the note.
      await settleNoteWrite(noteId, out)
      mutateSWR(`/api/j2/notes/${noteId}/excerpts`)
      setResult({ ...out, noteId, noteTitle })
      setAnnotation('')
      onSaved?.(out, noteId)
    } catch (e) {
      setError(e?.message || "Couldn't save that passage. Your note is unchanged.")
    } finally {
      setSaving(false)
    }
  }

  const heldNothing = quarters && quarters.length === 0 && !loadError

  return (
    <Sheet open={open} onClose={onClose} variant="auto" ariaLabel="Save a transcript passage"
      className={styles.sheet}>
      <div className={styles.wrap} data-save-transcript="">
        <div className={styles.head}>
          <h3 className={styles.title}>
            <UIcon name="document" size={13} gold={false} /> Save from a call transcript
          </h3>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <UIcon name="x" size={13} gold={false} />
          </button>
        </div>

        <div className={styles.controls}>
          {givenSymbol ? (
            <span className={styles.symbol}>${symbol}</span>
          ) : (
            <form className={styles.symbolForm} onSubmit={(e) => {
              e.preventDefault()
              setSymbol(symbolDraft.trim().toUpperCase().replace(/^\$/, ''))
            }}>
              <label className={styles.label} htmlFor="tc-symbol">Ticker</label>
              <input id="tc-symbol" className={styles.input} value={symbolDraft}
                onChange={(e) => setSymbolDraft(e.target.value)} placeholder="NVDA" autoComplete="off" />
              <button type="submit" className={styles.action}>Find calls</button>
            </form>
          )}
          {quarters && quarters.length > 0 && (
            <label className={styles.inline}>
              <span className={styles.label}>Call</span>
              <select className={styles.select} value={quarter} aria-label="Call quarter"
                onChange={(e) => setQuarter(e.target.value)}>
                {quarters.map((q) => (
                  <option key={q.quarter} value={q.quarter}>
                    {quarterText(q.quarter)}{q.callDate ? ` · ${q.callDate}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {symbol && quarters === null && <p className={styles.quiet} role="status">Looking for held transcripts…</p>}
        {heldNothing && (
          <p className={styles.quiet} role="note" data-no-transcript="">
            UCT does not hold a {symbol} call transcript yet. Open the call in the UCT Terminal's
            transcript panel first, then save from it here.
          </p>
        )}
        {loadError && <p className={styles.error} role="alert">{loadError}</p>}
        {loading && <p className={styles.quiet} role="status">Loading the call…</p>}

        {transcript && (
          <>
            <p className={styles.source}>
              {transcript.source} · {quarterText(transcript.quarter)} ·{' '}
              {transcript.callDate ? `call of ${transcript.callDate}` : 'call date not stored'}
            </p>
            <label className={styles.findRow}>
              <span className={styles.label}>Find in this call</span>
              <input className={styles.input} type="search" value={find}
                onChange={(e) => setFind(e.target.value)} placeholder="margin, guidance, supply…" />
            </label>
            <ol className={styles.turns} aria-label="Speaker turns">
              {turns.map((t) => (
                <li key={t.turn} className={`${styles.turn} ${turn?.turn === t.turn ? styles.picked : ''}`}>
                  <div className={styles.turnHead}>
                    <span className={styles.turnNo}>Turn {t.turn}</span>
                    {t.speaker && <span className={styles.speaker}>{t.speaker}</span>}
                    <button type="button" className={styles.action}
                      onMouseDown={(e) => e.preventDefault() /* keep the member's selection */}
                      onClick={() => pickTurn(t)} aria-label={`Quote from turn ${t.turn}`}>
                      Quote from this turn
                    </button>
                  </div>
                  <p className={styles.turnText} ref={(el) => { turnRefs.current[t.turn] = el }}>
                    {turnWords(t)}
                  </p>
                </li>
              ))}
              {turns.length === 0 && <li className={styles.quiet}>No turn mentions “{find}”.</li>}
            </ol>
          </>
        )}

        {turn && (
          <div className={styles.editor} data-passage-editor="">
            <label className={styles.label} htmlFor="tc-passage">
              Passage from turn {turn.turn}{turn.speaker ? ` (${turn.speaker})` : ''} — trim it to the words you keep
            </label>
            <textarea id="tc-passage" ref={passageRef} className={styles.textarea} rows={4}
              value={passage} onChange={(e) => setPassage(e.target.value)} />
            <label className={styles.label} htmlFor="tc-annotation">Why it matters (optional, your words)</label>
            <input id="tc-annotation" className={styles.input} value={annotation}
              onChange={(e) => setAnnotation(e.target.value)} />
            {!fixedNoteId && (
              <label className={styles.inline}>
                <span className={styles.label}>Save into</span>
                <select className={styles.select} value={dest} aria-label="Destination note"
                  onChange={(e) => setDest(e.target.value)}>
                  {destNotes.map((n) => (
                    <option key={n.id} value={n.id}>{n.title?.trim() || 'Untitled'}</option>
                  ))}
                  <option value={NEW_NOTE}>A new {symbol} note</option>
                </select>
              </label>
            )}
            <div className={styles.saveRow}>
              <button type="button" className={`${styles.action} ${styles.primary}`}
                onClick={save} disabled={saving || !passage.trim()}>
                {saving ? 'Saving…' : 'Save passage'}
              </button>
            </div>
          </div>
        )}

        {error && <p className={styles.error} role="alert">{error}</p>}
        {result && (
          <div className={styles.done} role="status" data-saved-excerpt={result.excerpt?.id || ''}>
            <p>
              {result.deduped ? 'Already saved' : 'Saved'}{result.noteTitle ? ` to “${result.noteTitle}”` : ''}.
              {' '}Cited as <span className={styles.cite}>{result.excerpt?.documentName} · turn {result.turn}</span>
              {result.speaker ? ` (${result.speaker})` : ''}.
            </p>
            {onOpenNote && !fixedNoteId && (
              <button type="button" className={styles.action}
                onClick={() => onOpenNote({ id: result.noteId })}>
                Open the note
              </button>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}
