import { useEffect, useRef, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import { INSIDE_ANSWER_SENTENCE, draftParagraphs } from '../../lib/writingHelp'
import {
  WRITING_HELP_CHOICES, WRITING_HELP_LANGUAGES, streamWritingHelp,
} from '../../lib/writingHelpStream'
import styles from './WritingHelpPanel.module.css'

/**
 * Wave 7 lane H (H2) — the writing-help PREVIEW. Lazy-loaded by
 * NoteEditorPage: a note opens without it.
 *
 * ⛔⛔ THE DRAFT LIVES HERE, NEVER IN THE NOTE (ruling D-H1). It streams into
 * this panel's state; Accept is the one moment anything reaches the document
 * (`onAccept`, which inserts ONE labelled `askInsert` block); Discard closes
 * the panel and removes nothing, because nothing was ever added.
 *
 * ⛔ Every refusal is a sentence rendered in the panel — the daily limit
 * ("You've used today's writing help — it resets at midnight ET"), a paid-plan
 * refusal, a failure mid-stream. A click that seems to do nothing is the
 * defect this file must never have.
 *
 * Props:
 *   noteId, request — `{ scope, text, range, originalText }`, captured when opened
 *   onAccept(draft) — inserts; returns `{ ok, replaced }` / `{ ok: false, reason }`
 *   onClose()
 */
export default function WritingHelpPanel({ noteId, request, onAccept, onClose }) {
  const [choiceId, setChoiceId] = useState(WRITING_HELP_CHOICES[0].id)
  const [lang, setLang] = useState(WRITING_HELP_LANGUAGES[0][0])
  const [status, setStatus] = useState('idle')   // idle | writing | ready | error
  const [draft, setDraft] = useState('')
  const [meta, setMeta] = useState(null)
  const [error, setError] = useState('')
  const abortRef = useRef(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  const choice = WRITING_HELP_CHOICES.find((c) => c.id === choiceId) || WRITING_HELP_CHOICES[0]
  const selection = request?.scope === 'selection'

  const write = async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setStatus('writing'); setDraft(''); setError(''); setMeta(null)
    const res = await streamWritingHelp({
      noteId, choice, lang, scope: request.scope, text: request.text, signal: ac.signal,
      onStart: setMeta, onDelta: setDraft,
    })
    if (ac.signal.aborted || res.aborted) return
    if (!res.ok) { setStatus('error'); setError(res.error); return }
    setDraft(res.text)
    setMeta({ model: res.model, action: res.action, instruction: res.instruction })
    setStatus('ready')
  }
  const stop = () => { abortRef.current?.abort(); setStatus('idle') }
  const discard = () => { abortRef.current?.abort(); onClose() }
  const accept = () => {
    const res = onAccept({
      draft, action: meta?.action || choice.action, model: meta?.model || null,
      instruction: meta?.instruction || choice.label, scope: request.scope,
      range: request.range, originalText: request.originalText,
    })
    if (res?.ok) { onClose(); return }
    setStatus('error')
    setError(INSIDE_ANSWER_SENTENCE)
  }

  const writing = status === 'writing'
  const footer = (
    <div className={styles.actions}>
      {status === 'ready' && (
        <>
          <button type="button" className={styles.primary} onClick={accept}>Accept</button>
          <button type="button" className={styles.secondary} onClick={write}>Try again</button>
          <button type="button" className={styles.secondary} onClick={discard}>Discard</button>
        </>
      )}
      {writing && <button type="button" className={styles.secondary} onClick={stop}>Stop</button>}
      {(status === 'idle' || status === 'error') && (
        <>
          <button type="button" className={styles.primary} onClick={write}>Write it</button>
          <button type="button" className={styles.secondary} onClick={discard}>Cancel</button>
        </>
      )}
    </div>
  )

  return (
    <Sheet open onClose={discard} title="Writing help" footer={footer} maxWidth={560}>
      <p className={styles.scope}>
        {selection
          ? `Working on your selection · ${request.text.length.toLocaleString('en-US')} characters`
          : 'Working on the whole note'}
      </p>
      <div className={styles.choices} role="group" aria-label="What should Compass do?">
        {WRITING_HELP_CHOICES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`${styles.choice} ${c.id === choiceId ? styles.choiceOn : ''}`}
            aria-pressed={c.id === choiceId}
            disabled={writing}
            onClick={() => setChoiceId(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {choice.action === 'translate' && (
        <label className={styles.lang}>
          <span>Into</span>
          <select value={lang} disabled={writing} onChange={(e) => setLang(e.target.value)}
                  aria-label="Language to translate into">
            {WRITING_HELP_LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div
        className={styles.preview}
        role="region"
        aria-label="Draft preview"
        aria-live="polite"
        aria-busy={writing}
      >
        {draft
          ? draftParagraphs(draft).map((p, i) => <p key={i}>{p}</p>)
          : <p className={styles.placeholder}>{writing ? 'Writing…' : 'The draft appears here.'}</p>}
      </div>
      <p className={styles.fine}>
        Nothing is added to your note until you choose Accept.
        {meta?.model ? ` Written by ${meta.model}.` : ''}
      </p>
    </Sheet>
  )
}
