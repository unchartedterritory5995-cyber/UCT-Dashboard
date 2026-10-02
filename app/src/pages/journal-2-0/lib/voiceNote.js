/**
 * Wave 11 lane 11A — voice and meeting notes: speech becomes a finished note.
 *
 * The server (`/api/j2/voice-notes/*`, api/routers/notebook_voice_notes.py)
 * transcribes and summarises and NEVER writes a note. This file is the client's
 * half: the calls, the document a result becomes, and the two ways it lands —
 *
 *   · a NEW note, through the canonical create door (`createNoteViaApi`), whose
 *     answer is landed with `settleNoteWrite` like every other door;
 *   · an APPEND to the note open in the editor, as ONE editor transaction on the
 *     normal autosave path (G-064's rule: a server-side append of new block types
 *     would fork an open or queued copy of the note). A locked note refuses it
 *     with the standard locked sentence.
 *
 * ⛔ DARK behind `notebook_voice_notes_enabled` (NOTEBOOK_VOICE_NOTES_ENABLED on
 * the auth payload) and paid-only, like the routes.
 *
 * ⛔ NOTHING IS WRITTEN UNTIL THE MEMBER SAVES (the WAVE-11 ruling that nothing
 * an AI proposes is written without approval): the dialog previews the result and
 * the member presses Save. The AI-written summary sits inside an `askInsert`
 * block carrying `action: 'voice_summary'` and the model, so it is labelled as
 * AI-written wherever the note is read (G-064's provenance label).
 */
import { notebookFlag } from './offline/notebookFlags'
import { createNoteViaApi } from './noteCreation'
import { settleNoteWrite } from './offline/settleNoteWrite'
import { noteIsLocked } from './lockedNote'
import { ASK_INSERT_TYPE } from './askInsert'
import { NOTEBOOK_PATH } from './journalRoutes'

export const VOICE_NOTE_EVENT = 'uct:notebook-voice-note'
export const VOICE_NOTE_FLAG = 'notebook_voice_notes_enabled'
export const VOICE_SUMMARY_ACTION = 'voice_summary'
export const VOICE_NOTE_TAG = 'voice-note'
const BASE = '/api/j2/voice-notes'

/** The browser recorder's hard limit — the server's own `MAX_AUDIO_SECONDS`. */
export const MAX_RECORD_SECONDS = 60 * 60
/** The upload limit — the server's own `MAX_UPLOAD_BYTES`. */
export const MAX_UPLOAD_BYTES = 90 * 1024 * 1024
export const ACCEPTED_AUDIO = '.m4a,.mp3,.wav,.webm,.ogg,.mp4,.aac,audio/*'

/**
 * ⛔ The locked-note sentence, word for word the server's
 * (`notes.LOCKED_APPEND_SENTENCE`, pinned by voiceNote.test.js reading notes.py),
 * so "why didn't it land" reads the same from every append door.
 */
export const VOICE_NOTE_LOCKED_SENTENCE = 'This note is locked — unlock it in the Notebook first'

export const SOURCE_LABELS = Object.freeze({
  recording: 'Recording',
  upload: 'Uploaded recording',
  desk: 'Desk session',
})

/** Is the capability on for this tab? Latched flag AND a paid member. */
export function voiceNotesEnabled(isPaid) {
  return notebookFlag(VOICE_NOTE_FLAG) === true && isPaid === true
}

// ── The calls ────────────────────────────────────────────────────────────────

async function call(url, init = {}) {
  let res
  try {
    res = await fetch(url, { credentials: 'include', ...init })
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach the server. Check your connection and try again." }
  }
  let body = null
  try { body = await res.json() } catch { body = null }
  if (!res.ok) {
    const detail = body && typeof body.detail === 'string' ? body.detail : null
    return { ok: false, status: res.status, error: detail || `Something went wrong (${res.status}). Try again.` }
  }
  return { ok: true, status: res.status, data: body }
}

export const fetchVoiceStatus = () => call(`${BASE}/status`)
export const listDeskSessions = () => call(`${BASE}/desk-sessions`)

export async function uploadVoiceJob(blob, { source = 'upload', filename } = {}) {
  const form = new FormData()
  form.append('audio', blob, filename || (source === 'recording' ? 'recording.webm' : 'recording'))
  form.append('source', source)
  return call(`${BASE}/jobs`, { method: 'POST', body: form })
}

export async function transcribeNextPart(jobId) {
  return call(`${BASE}/jobs/${encodeURIComponent(jobId)}/transcribe`, { method: 'POST' })
}

export async function summarizeVoiceJob(jobId) {
  return call(`${BASE}/jobs/${encodeURIComponent(jobId)}/summarize`, { method: 'POST' })
}

export async function summarizeDeskSession(videoId) {
  return call(`${BASE}/desk-sessions/${encodeURIComponent(videoId)}/summarize`, { method: 'POST' })
}

/** Best-effort: the server sweeps an abandoned job after 2 hours anyway. */
export async function discardVoiceJob(jobId) {
  if (!jobId) return
  try {
    await fetch(`${BASE}/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE', credentials: 'include' })
  } catch { /* the sweep deletes it */ }
}

/**
 * Upload (when there is no live job), then transcribe part after part, in order,
 * reporting `{phase, done, total}`. Resolves `{ok, jobId}` or
 * `{ok:false, error, jobId}` — a failed part keeps `jobId`, so Retry resumes on
 * the server without re-uploading; a job the server no longer holds (a restart,
 * the 2-hour sweep) is uploaded again from the blob this browser still has.
 */
export async function transcribeRecording({ blob, filename, source, jobId: existing, onProgress } = {}) {
  let jobId = existing || null
  const report = (p) => { try { onProgress?.(p) } catch { /* a progress callback is not the work */ } }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!jobId) {
      report({ phase: 'uploading', done: 0, total: 0 })
      const up = await uploadVoiceJob(blob, { source, filename })
      if (!up.ok) return { ok: false, error: up.error, status: up.status, jobId: null }
      jobId = up.data.jobId
      report({ phase: 'transcribing', done: up.data.done, total: up.data.parts })
      if (up.data.finished) return { ok: true, jobId }
    }
    for (;;) {
      const step = await transcribeNextPart(jobId)
      if (!step.ok) {
        if (step.status === 404 && attempt === 0) { jobId = null; break }   // gone: upload again
        return { ok: false, error: step.error, status: step.status, jobId }
      }
      report({ phase: 'transcribing', done: step.data.done, total: step.data.parts })
      if (step.data.finished) return { ok: true, jobId }
    }
  }
  return { ok: false, error: 'This recording could not be transcribed. Try again.', jobId: null }
}

// ── The note a result becomes ────────────────────────────────────────────────

const text = (t) => (t ? [{ type: 'text', text: t }] : [])
const para = (t) => ({ type: 'paragraph', content: text(t) })
const heading = (t) => ({ type: 'heading', attrs: { level: 2 }, content: text(t) })

export function tickerHref(symbol) {
  return `${NOTEBOOK_PATH}/research/${encodeURIComponent(symbol)}`
}

/** "Oct 1, 2026" from an ISO day, in UTC parts (no timezone drift). */
export function dayLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return ''
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export function durationLabel(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  if (!s) return ''
  if (s < 60) return `${s} sec`
  const m = Math.round(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}

export function sourceLabel(result) {
  if (!result) return ''
  if (result.source === 'desk') return `${SOURCE_LABELS.desk}: ${result.desk?.title || result.title || ''}`.trim()
  if (result.source === 'upload' && result.name) return `${SOURCE_LABELS.upload} (${result.name})`
  return SOURCE_LABELS[result.source] || SOURCE_LABELS.recording
}

/** The transcript as paragraphs: blank-line breaks kept, long runs cut at a sentence. */
export function transcriptParagraphs(transcript, maxChars = 1200) {
  const out = []
  for (const block of String(transcript || '').split(/\n\s*\n/)) {
    let rest = block.replace(/\s+/g, ' ').trim()
    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars)
      const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '))
      const at = cut > maxChars / 3 ? cut + 1 : (window.lastIndexOf(' ') > 0 ? window.lastIndexOf(' ') : maxChars)
      out.push(rest.slice(0, at).trim())
      rest = rest.slice(at).trim()
    }
    if (rest) out.push(rest)
  }
  return out
}

/** Does this result carry anything the AI wrote? */
export const hasAiSections = (result) => Boolean(result?.ai?.ok)

/**
 * The nodes a result becomes, in order. With an AI answer: the source line, then
 * "Summary" (inside the labelled askInsert block), "Tickers" (linked chips),
 * "Action items" (a real task list) and "Transcript" (a closed toggle). Without
 * one: the source line and the transcript alone.
 */
export function buildVoiceNoteNodes(result, { insertedAt = new Date().toISOString() } = {}) {
  const meta = [sourceLabel(result), dayLabel(result?.date), durationLabel(result?.durationSeconds)]
    .filter(Boolean).join(' · ')
  const nodes = [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'italic' }], text: meta || 'Voice note' }] }]
  if (hasAiSections(result)) {
    nodes.push(heading('Summary'))
    nodes.push({
      type: ASK_INSERT_TYPE,
      attrs: { insertedAt, scope: null, question: sourceLabel(result), action: VOICE_SUMMARY_ACTION, model: result.ai.model || null },
      content: [para(result.summary || 'No summary was written for this recording.')],
    })
    nodes.push(heading('Tickers'))
    const tickers = (result.tickers || []).filter((t) => typeof t === 'string' && t)
    if (tickers.length) {
      const content = []
      tickers.forEach((sym, i) => {
        if (i) content.push({ type: 'text', text: '  ·  ' })
        content.push({ type: 'text', marks: [{ type: 'link', attrs: { href: tickerHref(sym) } }, { type: 'bold' }], text: `$${sym}` })
      })
      nodes.push({ type: 'paragraph', content })
    } else {
      nodes.push(para('No tickers were mentioned.'))
    }
    nodes.push(heading('Action items'))
    const items = (result.actionItems || []).filter((t) => typeof t === 'string' && t.trim())
    nodes.push(items.length
      ? { type: 'taskList', content: items.map((t) => ({ type: 'taskItem', attrs: { checked: false }, content: [para(t.trim())] })) }
      : para('No action items were named.'))
  }
  nodes.push(heading('Transcript'))
  const paras = transcriptParagraphs(result?.transcript)
  const words = Number(result?.words) || String(result?.transcript || '').split(/\s+/).filter(Boolean).length
  const body = paras.length ? paras.map(para) : [para('(No speech was transcribed.)')]
  if (result?.transcriptShortened) body.push(para('The transcript was shortened to fit in a note.'))
  nodes.push({
    type: 'toggle',
    attrs: { open: false },
    content: [
      { type: 'toggleSummary', content: text(`Full transcript · ${words} words`) },
      { type: 'toggleContent', content: body },
    ],
  })
  return nodes
}

export function buildVoiceNoteDoc(result, opts) {
  return { type: 'doc', content: [...buildVoiceNoteNodes(result, opts), { type: 'paragraph' }] }
}

export function defaultVoiceNoteTitle(result) {
  if (!result) return 'Voice note'
  const day = dayLabel(result.date)
  if (result.source === 'desk') return result.title || 'Desk session'
  return day ? `${result.title || 'Voice note'} — ${day}` : (result.title || 'Voice note')
}

/**
 * ⛔ THE CREATE DOOR. Through `createNoteViaApi` (the one network path every
 * creation uses), and the answer is landed with `settleNoteWrite`: the revision
 * this browser just made is recorded, so the editor that opens the note next
 * starts from a revision it knows is its own. Throws when the create fails.
 */
export async function createVoiceNote({ title, result, folderId } = {}) {
  const created = await createNoteViaApi({
    title: (title || '').trim() || defaultVoiceNoteTitle(result),
    bodyJson: buildVoiceNoteDoc(result),
    tags: [VOICE_NOTE_TAG],
    ...(folderId ? { folderId } : {}),
  })
  await settleNoteWrite(created?.id ?? null, created)
  return created
}

/**
 * ⛔ THE APPEND DOOR: the note open in `editor`, as ONE editor transaction at
 * the END of the note (never the selection — `insertContent` replaces a
 * selected node), on the note's own autosave path. An empty last paragraph is
 * replaced rather than left as a blank line. A locked or read-only note refuses
 * with the standard sentence and changes nothing.
 */
export function appendVoiceNote(editor, result, { note } = {}) {
  if (noteIsLocked(note) || !editor || editor.isDestroyed || !editor.isEditable) {
    return { ok: false, reason: VOICE_NOTE_LOCKED_SENTENCE }
  }
  const nodes = buildVoiceNoteNodes(result)
  const { doc } = editor.state
  const size = doc.content.size
  const last = doc.lastChild
  const replaceEmptyLast = Boolean(last && last.type.name === 'paragraph' && last.content.size === 0)
  const at = replaceEmptyLast ? size - last.nodeSize : size
  const ok = editor.chain()
    .insertContentAt(replaceEmptyLast ? { from: at, to: size } : at, [...nodes, { type: 'paragraph' }], { updateSelection: false })
    .run()
  return ok ? { ok: true } : { ok: false, reason: VOICE_NOTE_LOCKED_SENTENCE }
}
