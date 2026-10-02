import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import UIcon from '../../../../components/ui/UIcon'
import useVoiceRecorder, { canRecord, clockLabel } from '../../lib/useVoiceRecorder'
import {
  ACCEPTED_AUDIO, MAX_RECORD_SECONDS, MAX_UPLOAD_BYTES,
  createVoiceNote, dayLabel, defaultVoiceNoteTitle, discardVoiceJob, fetchVoiceStatus,
  hasAiSections, listDeskSessions, sourceLabel, summarizeDeskSession, summarizeVoiceJob,
  transcribeRecording, transcriptParagraphs,
} from '../../lib/voiceNote'
import { AI_SUMMARY_ACTION_LABELS } from './AskInsertView'
import styles from './VoiceNoteDialog.module.css'

/**
 * Wave 11 lane 11A — turn speech into a finished note.
 *
 * Three sources (record in the browser, upload a file, a Desk session that already
 * has a transcript) reach one preview. ⛔ NOTHING IS WRITTEN UNTIL THE MEMBER
 * SAVES: the preview shows the AI-written summary under its label, the tickers,
 * the action items and the transcript, with an editable title, and only "Save as
 * a new note" / "Add to this note" writes anything.
 *
 * ⛔ THE RECORDING IS NEVER LOST TO A FAILURE: a failed upload, part or summary
 * keeps the recording (in this tab) and the server's job; Retry continues from
 * where it stopped. Closing with unsaved work asks first.
 *
 * Props:
 *   initialSource   'record' | 'upload' | 'desk'
 *   deskVideo       {id, title} — opens straight onto that Desk session
 *   onAppend(result) → {ok, reason} — offered only when a note is open
 *   onSave({title, result}) → the created note (default: `createVoiceNote`)
 *   onSaved(note)   after a new note was saved
 *   onClose()
 */
const SOURCES = [
  { id: 'record', label: 'Record', icon: 'mic' },
  { id: 'upload', label: 'Upload a file', icon: 'upload' },
  { id: 'desk', label: 'Desk session', icon: 'desk' },
]

const TOO_BIG_SENTENCE = 'That file is larger than 90 MB. Trim it or export it at a lower quality, then try again.'

export default function VoiceNoteDialog({
  initialSource = 'record', deskVideo = null, onAppend = null, onSave = null, onSaved = null, onClose,
}) {
  const recorder = useVoiceRecorder({ maxSeconds: MAX_RECORD_SECONDS })
  const [source, setSource] = useState(deskVideo ? 'desk' : initialSource)
  const [file, setFile] = useState(null)
  const [desk, setDesk] = useState({ loading: false, sessions: null, error: '' })
  const [work, setWork] = useState(null)            // {phase, done, total}
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(null)          // () => void
  const [jobId, setJobId] = useState(null)
  const [result, setResult] = useState(null)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [cap, setCap] = useState(null)
  const fileRef = useRef(null)
  const jobRef = useRef(null)
  jobRef.current = jobId
  const uid = useId()
  const titleId = `voice-note-title-${uid}`

  const busy = Boolean(work) || saving
  const unsaved = Boolean(recorder.blob || file || result || recorder.state === 'recording' || recorder.state === 'paused')

  useEffect(() => {
    let live = true
    fetchVoiceStatus().then((r) => { if (live && r.ok) setCap(r.data?.cap || null) })
    return () => { live = false }
  }, [])

  // A reload or a closed tab with an unsaved recording asks first.
  useEffect(() => {
    if (!unsaved) return undefined
    const guard = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [unsaved])

  const fail = (sentence, again) => { setWork(null); setError(sentence); setRetry(() => again) }

  const summarize = useCallback(async (id) => {
    setError(''); setRetry(null)
    setWork({ phase: 'summarizing', done: 0, total: 0 })
    const res = await summarizeVoiceJob(id)
    if (!res.ok) { fail(res.error, () => summarize(id)); return }
    setWork(null)
    setResult(res.data)
    setTitle(defaultVoiceNoteTitle(res.data))
  }, [])

  const transcribe = useCallback(async (blob, filename, src) => {
    setError(''); setRetry(null)
    setWork({ phase: 'uploading', done: 0, total: 0 })
    const res = await transcribeRecording({
      blob, filename, source: src, jobId: jobRef.current,
      onProgress: (p) => setWork(p),
    })
    if (res.jobId) setJobId(res.jobId)
    if (!res.ok) { fail(res.error, () => transcribe(blob, filename, src)); return }
    await summarize(res.jobId)
  }, [summarize])

  const summarizeDesk = useCallback(async (video) => {
    setError(''); setRetry(null)
    setWork({ phase: 'summarizing', done: 0, total: 0 })
    const res = await summarizeDeskSession(video.id)
    if (!res.ok) { fail(res.error, () => summarizeDesk(video)); return }
    setWork(null)
    setResult(res.data)
    setTitle(defaultVoiceNoteTitle(res.data))
  }, [])

  // The recorder hands over its blob when it stops (by the member, or at the limit).
  const handedRef = useRef(null)
  useEffect(() => {
    if (recorder.state === 'stopped' && recorder.blob && handedRef.current !== recorder.blob) {
      handedRef.current = recorder.blob
      transcribe(recorder.blob, recorder.filename, 'recording')
    }
  }, [recorder.state, recorder.blob, recorder.filename, transcribe])

  // The Desk list loads when its source is chosen; a named session opens at once.
  useEffect(() => {
    if (source !== 'desk' || desk.sessions || desk.loading) return
    if (deskVideo) return
    setDesk({ loading: true, sessions: null, error: '' })
    listDeskSessions().then((r) => setDesk(r.ok
      ? { loading: false, sessions: r.data?.sessions || [], error: '' }
      : { loading: false, sessions: [], error: r.error }))
  }, [source, desk.sessions, desk.loading, deskVideo])
  const deskStarted = useRef(false)
  useEffect(() => {
    if (deskVideo && !deskStarted.current) { deskStarted.current = true; summarizeDesk(deskVideo) }
  }, [deskVideo, summarizeDesk])

  const pickFile = (e) => {
    const f = e.target.files?.[0] || null
    setError(''); setRetry(null)
    if (f && f.size > MAX_UPLOAD_BYTES) { setFile(null); setError(TOO_BIG_SENTENCE); return }
    setFile(f)
  }

  const discardAll = () => {
    recorder.reset()
    discardVoiceJob(jobRef.current)
    onClose?.()
  }
  const requestClose = () => {
    if (busy || unsaved) { setConfirmingClose(true); return }
    onClose?.()
  }

  const saveNew = async () => {
    if (saving || !result) return
    setSaving(true); setSaveError('')
    try {
      const created = await (onSave ? onSave({ title, result }) : createVoiceNote({ title, result }))
      discardVoiceJob(jobRef.current)
      recorder.reset()
      onSaved?.(created)
      onClose?.()
    } catch {
      setSaveError("Couldn't save the note. Your recording and transcript are still here — try again.")
    } finally {
      setSaving(false)
    }
  }
  const addHere = () => {
    if (!onAppend || !result) return
    setSaveError('')
    const res = onAppend(result)
    if (res?.ok) {
      discardVoiceJob(jobRef.current)
      recorder.reset()
      onClose?.()
      return
    }
    setSaveError(res?.reason || "Couldn't add it to this note.")
  }

  const minutesLeft = cap && !cap.unlimited ? Math.floor((cap.remainingSeconds || 0) / 60) : null
  const progressLabel = !work ? '' : work.phase === 'uploading' ? 'Uploading the recording…'
    : work.phase === 'summarizing' ? 'Writing the summary…'
      : work.total ? `Transcribing part ${Math.min(work.done + 1, work.total)} of ${work.total}…` : 'Transcribing…'
  const choosing = !result && !work && !error

  const footer = confirmingClose ? (
    <div className={styles.actions} role="group" aria-label="Discard this recording?">
      <span className={styles.confirm}>Discard this recording? It is not saved anywhere.</span>
      <button type="button" className={styles.secondary} onClick={() => setConfirmingClose(false)} autoFocus>Keep it</button>
      <button type="button" className={styles.danger} onClick={discardAll}>Discard</button>
    </div>
  ) : (
    <div className={styles.actions}>
      {result && (
        <>
          {onAppend && (
            <button type="button" className={styles.secondary} onClick={addHere} disabled={saving}>
              Add to this note
            </button>
          )}
          <button type="button" className={styles.primary} onClick={saveNew} disabled={saving}>
            {saving ? 'Saving…' : 'Save as a new note'}
          </button>
        </>
      )}
      {error && retry && (
        <button type="button" className={styles.primary} onClick={() => retry()}>Retry</button>
      )}
      <button type="button" className={styles.secondary} onClick={requestClose}>
        {result || error ? 'Discard' : 'Cancel'}
      </button>
    </div>
  )

  return (
    <Sheet open onClose={requestClose} title="Voice note" labelledByTitle footer={footer}
           maxWidth={600} dismissOnBackdrop={false}>
      {choosing && (
        <>
          <div className={styles.sources} role="group" aria-label="Where is the audio?">
            {SOURCES.map((s) => (
              <button
                key={s.id} type="button"
                className={`${styles.source} ${source === s.id ? styles.sourceOn : ''}`}
                aria-pressed={source === s.id}
                disabled={recorder.state === 'recording' || recorder.state === 'paused'}
                onClick={() => { setSource(s.id); setError('') }}
              >
                <UIcon name={s.icon} size={15} gold={false} /> {s.label}
              </button>
            ))}
          </div>
          {minutesLeft != null && source !== 'desk' && (
            <p className={styles.fine} data-testid="voice-cap">
              {minutesLeft} of {Math.floor((cap.capSeconds || 0) / 60)} minutes of transcription left this month.
            </p>
          )}

          {source === 'record' && (
            <div className={styles.panel}>
              {!canRecord() && recorder.state === 'idle' && (
                <p className={styles.error} role="alert">This browser can&apos;t record audio. Upload a recording instead.</p>
              )}
              <div className={styles.recorder}>
                <span
                  className={`${styles.timer} ${recorder.state === 'recording' ? styles.live : ''}`}
                  role="timer" aria-label="Recorded time"
                >
                  {clockLabel(recorder.elapsed)}
                  <span className={styles.limit}> / {clockLabel(MAX_RECORD_SECONDS)}</span>
                </span>
                <span className={styles.recState} aria-live="polite">
                  {recorder.state === 'recording' ? 'Recording' : recorder.state === 'paused' ? 'Paused' : ''}
                </span>
              </div>
              <div className={styles.controls}>
                {recorder.state === 'idle' || recorder.state === 'error' ? (
                  <button type="button" className={styles.primary} onClick={() => recorder.start()} disabled={!canRecord()}>
                    <UIcon name="mic" size={15} gold={false} /> Start recording
                  </button>
                ) : null}
                {recorder.state === 'recording' && (
                  <button type="button" className={styles.secondary} onClick={recorder.pause}>
                    <UIcon name="pause" size={15} gold={false} /> Pause
                  </button>
                )}
                {recorder.state === 'paused' && (
                  <button type="button" className={styles.secondary} onClick={recorder.resume}>
                    <UIcon name="play" size={15} gold={false} /> Resume
                  </button>
                )}
                {(recorder.state === 'recording' || recorder.state === 'paused') && (
                  <button type="button" className={styles.primary} onClick={recorder.stop}>
                    Stop and transcribe
                  </button>
                )}
              </div>
              {recorder.error && <p className={styles.error} role="alert">{recorder.error}</p>}
              <p className={styles.fine}>Up to 60 minutes. Your recording stays in this tab until the note is saved.</p>
            </div>
          )}

          {source === 'upload' && (
            <div className={styles.panel}>
              <label className={styles.fileLabel} htmlFor={`voice-file-${uid}`}>
                Choose an audio file
              </label>
              <input
                id={`voice-file-${uid}`} ref={fileRef} type="file" accept={ACCEPTED_AUDIO}
                className={styles.file} onChange={pickFile}
              />
              <p className={styles.fine}>m4a, mp3, wav or webm — a voice memo or a call recording. Up to 90 MB and 60 minutes.</p>
              {file && (
                <div className={styles.controls}>
                  <span className={styles.fileName}>{file.name}</span>
                  <button type="button" className={styles.primary} onClick={() => transcribe(file, file.name, 'upload')}>
                    Transcribe
                  </button>
                </div>
              )}
            </div>
          )}

          {source === 'desk' && !deskVideo && (
            <div className={styles.panel}>
              {desk.loading && <p className={styles.fine}>Loading Desk sessions…</p>}
              {desk.error && <p className={styles.error} role="alert">{desk.error}</p>}
              {desk.sessions && !desk.sessions.length && !desk.error && (
                <p className={styles.fine}>No Desk session has a transcript yet.</p>
              )}
              {desk.sessions?.length > 0 && (
                <ul className={styles.deskList} aria-label="Desk sessions with a transcript">
                  {desk.sessions.map((s) => (
                    <li key={s.id}>
                      <button type="button" className={styles.deskItem} onClick={() => summarizeDesk(s)}>
                        <span className={styles.deskTitle}>{s.title || 'Desk session'}</span>
                        <span className={styles.deskDate}>{s.category}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className={styles.fine}>The session&apos;s existing transcript is used — nothing is re-transcribed.</p>
            </div>
          )}
        </>
      )}

      {work && (
        <div className={styles.working} role="status" aria-live="polite" aria-busy="true">
          <p>{progressLabel}</p>
          {work.phase === 'transcribing' && work.total > 0 && (
            <progress className={styles.progress} max={work.total} value={work.done}
                      aria-label={`Transcribed ${work.done} of ${work.total} parts`} />
          )}
        </div>
      )}

      {error && (
        <div className={styles.failure}>
          <p className={styles.error} role="alert">{error}</p>
          {retry && <p className={styles.fine}>Your recording is kept. Retry continues from where it stopped.</p>}
        </div>
      )}

      {result && (
        <Preview result={result} title={title} setTitle={setTitle} titleId={titleId} />
      )}
      {saveError && <p className={styles.error} role="alert">{saveError}</p>}
    </Sheet>
  )
}

function Preview({ result, title, setTitle, titleId }) {
  const ai = hasAiSections(result)
  const paras = transcriptParagraphs(result.transcript)
  return (
    <div className={styles.preview} aria-label="Voice note preview" role="region">
      <label className={styles.titleLabel} htmlFor={titleId}>Title</label>
      <input id={titleId} className={styles.title} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
      <p className={styles.meta}>{[sourceLabel(result), dayLabel(result.date)].filter(Boolean).join(' · ')}</p>
      {!ai && (
        <p className={styles.notice} role="note">
          {result.ai?.sentence || 'There is no summary for this recording.'} The note will hold the transcript.
        </p>
      )}
      {ai && (
        <>
          <section aria-labelledby={`${titleId}-sum`}>
            <h3 id={`${titleId}-sum`} className={styles.h}>Summary</h3>
            <div className={styles.aiBlock}>
              <p className={styles.aiLabel}>
                <UIcon name="sparkle" size={12} gold={false} /> AI-written · Compass · {AI_SUMMARY_ACTION_LABELS.voice_summary}
                {result.ai?.model ? ` · ${result.ai.model}` : ''}
              </p>
              <p>{result.summary || 'No summary was written for this recording.'}</p>
            </div>
          </section>
          <section aria-labelledby={`${titleId}-tk`}>
            <h3 id={`${titleId}-tk`} className={styles.h}>Tickers</h3>
            {result.tickers?.length ? (
              <ul className={styles.chips}>
                {result.tickers.map((t) => <li key={t} className={styles.chip}>${t}</li>)}
              </ul>
            ) : <p className={styles.fine}>No tickers were mentioned.</p>}
          </section>
          <section aria-labelledby={`${titleId}-ai`}>
            <h3 id={`${titleId}-ai`} className={styles.h}>Action items</h3>
            {result.actionItems?.length ? (
              <ul className={styles.tasks}>
                {result.actionItems.map((t) => <li key={t}><span className={styles.box} aria-hidden="true" /> {t}</li>)}
              </ul>
            ) : <p className={styles.fine}>No action items were named.</p>}
          </section>
        </>
      )}
      <section aria-labelledby={`${titleId}-tr`}>
        <h3 id={`${titleId}-tr`} className={styles.h}>Transcript</h3>
        <details className={styles.transcript}>
          <summary>Full transcript · {result.words || 0} words</summary>
          {paras.map((p, i) => <p key={i}>{p}</p>)}
        </details>
      </section>
      <p className={styles.fine}>Nothing is saved until you choose Save. The audio is deleted from the server once it is transcribed.</p>
    </div>
  )
}
