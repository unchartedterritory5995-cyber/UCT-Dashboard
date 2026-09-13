// Joystick hub — D-17, the Notebook's voice note.
//
// ⭐ THE WHOLE ROW, IN ONE SENTENCE: "Call the generic `POST /api/voice/transcribe` from the hub and
// feed the text into `createNoteViaApi` — no Notebook change needed" (`deferred.md` D-17). Both ends
// already exist and are already reached from here: `notebookSection.js` imports `createNoteViaApi`
// for `notebook.newNote`, and `pages/journal-2-0/components/VoiceInputButton.jsx` has been posting to
// `/api/voice/transcribe` since dictation shipped. This module is the wire between them, and nothing
// under `pages/journal-2-0/**` changes (rule 12).
//
// ⛔ A REFUSAL IS A SENTENCE THE MEMBER READS, NEVER A SILENT NO-OP.
//
// That endpoint refuses for FOUR different reasons that a member can act on, and each one already
// carries its own words in the response body's `detail`:
//   402 "Voice features require a paid plan"    (auth_middleware.py:110, requires_voice_access)
//   400 "voice features disabled in settings"   (voice.py:790)
//   429 "monthly dictation cap reached"         (voice.py:794)
//   503 <the OpenAI client's own message>       (voice.py:800)
// So `transcribeVoiceNote` PREFERS the server's own sentence and only falls back to one of ours when
// the body carries none. `VoiceInputButton` does the opposite — on `!resp.ok` it silently retries
// through Web Speech and, when that is unavailable too, the member gets nothing at all. That is
// defensible for a dictation button sitting beside a text field the member can just type into; it is
// not defensible for a gesture whose ONLY outcome is a note, because the member has no other way to
// find out the note was never made.
//
// ⛔ NO WEB-SPEECH FALLBACK HERE, AND THAT IS A DECISION. `window.SpeechRecognition` streams into a
// live text field, which is the one thing this path does not have: the fan has already closed and
// there is nothing on screen to type into. A second transcription authority that produced a
// different note body from the same words would also be exactly the second-authority shape this
// project keeps re-finding. One path, one refusal, one sentence.
import { createNoteViaApi } from '../pages/journal-2-0/lib/noteCreation'

/** The generic dictation endpoint (`api/routers/voice.py:776`). Declared once — `writePaths.test.js`
 *  resolves it from this constant. */
export const TRANSCRIBE_URL = '/api/voice/transcribe'

/** Tagged so a voice note is findable as one. Mirrors `quoteNote.js`'s `QUOTE_NOTE_TAGS` shape. */
export const VOICE_NOTE_TAGS = ['voice']

/** Copy, in one place, so a rail can assert the sentence rather than a status code. */
export const VOICE_NOTE_MESSAGES = Object.freeze({
  unsupported: 'This browser cannot record audio.',
  micBlocked: 'Microphone blocked — allow access to record a voice note.',
  empty: 'Nothing was recorded — try again.',
  noTranscript: 'Nothing came back from that recording — try again.',
  failed: 'Could not transcribe that recording. Try again.',
})

const two = (n) => String(n).padStart(2, '0')

/**
 * ⛔ NEVER AN UNTITLED ORPHAN — spec §7 (notebook), guard (a): "the note is pre-titled
 * `{SYMBOL} · {Section} · {HH:mm}` so it is never an untitled orphan". The Notebook route carries no
 * symbol (it is the same absence that removed `notebook.linkTicker` under R-17), so the symbol slot
 * is dropped rather than filled with a placeholder that would read as a real ticker.
 *
 * ⛔ NOT DERIVED FROM THE TRANSCRIPT. A title taken from the first words would be a second opinion
 * about what the member said, and it would be wrong in exactly the cases transcription is wrong in.
 */
export function voiceNoteTitle(at = new Date()) {
  return `Voice note · ${two(at.getHours())}:${two(at.getMinutes())}`
}

/**
 * The TipTap/ProseMirror doc the server's validator expects (`type: 'doc'` is required) — the same
 * shape `components/quote/quoteNote.js` builds for a saved quote, so there is one answer in this app
 * to "what does a note body look like".
 */
export function voiceNoteBody(text) {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}

/** The server's own words for this refusal, or ours when the body carries none. */
async function refusalMessage(res) {
  try {
    const body = await res.json()
    const detail = body?.detail
    if (typeof detail === 'string' && detail.trim()) return detail.trim()
  } catch { /* a non-JSON error body is not a reason to say nothing */ }
  return `${VOICE_NOTE_MESSAGES.failed} (${res.status})`
}

/**
 * Blob -> transcript. Throws an Error whose `message` is a sentence for the member.
 *
 * `cleanup` rides at the endpoint's own default (`cleanup: bool = Form(False)`) by being omitted:
 * the gpt-4o-mini pass is a SECOND model call over the member's words, and §D-17 asked for the
 * transcript, not for a rewrite of it.
 */
export async function transcribeVoiceNote(blob) {
  if (!blob || !blob.size) throw new Error(VOICE_NOTE_MESSAGES.empty)
  const form = new FormData()
  form.append('audio', blob, 'audio.webm')
  const res = await fetch(TRANSCRIBE_URL, {
    method: 'POST',
    credentials: 'include',
    body: form,
  })
  if (!res.ok) throw new Error(await refusalMessage(res))
  let data = null
  try { data = await res.json() } catch { /* handled by the blank check below */ }
  const text = typeof data?.text === 'string' ? data.text.trim() : ''
  if (!text) throw new Error(VOICE_NOTE_MESSAGES.noTranscript)
  return text
}

/**
 * The whole row: dictate -> transcribe -> note. Returns the created note.
 *
 * ⛔ `createNoteViaApi`, NEVER A SECOND `POST /api/j2/notes`. `SaveQuoteButton` hand-rolls its own
 * because it predates that helper; a third copy here would be the drift `noteCreation.js`'s own
 * header says it was extracted to stop.
 */
export async function createVoiceNote({ blob, at } = {}) {
  const text = await transcribeVoiceNote(blob)
  return createNoteViaApi({
    title: voiceNoteTitle(at),
    bodyJson: voiceNoteBody(text),
    tags: VOICE_NOTE_TAGS,
  })
}

/** Both halves of "can this device record", read from the live globals at CALL time — the same read
 *  `VoiceInputButton.jsx:27-31` makes, so the two agree about what a recordable browser is. */
export function voiceRecordingSupported(root = globalThis) {
  return !!root?.MediaRecorder && !!root?.navigator?.mediaDevices?.getUserMedia
}

const stopTracks = (stream) => {
  try { stream?.getTracks?.().forEach((t) => t.stop()) } catch { /* already gone */ }
}

/**
 * Open the microphone and start recording.
 *
 * @returns {Promise<{stop: () => Promise<Blob>, cancel: () => void}>}
 *   `stop` resolves with the recorded audio AFTER the recorder's own `onstop` has fired — waiting on
 *   that event rather than reading the chunk array straight back is what keeps the final
 *   `ondataavailable` from being dropped on the floor, which would hand the endpoint an empty blob
 *   and produce the `empty` refusal for a recording that actually happened.
 *
 * Throws a member-readable Error when the device cannot record or the member declined the mic.
 */
export async function startVoiceRecording(root = globalThis) {
  if (!voiceRecordingSupported(root)) throw new Error(VOICE_NOTE_MESSAGES.unsupported)

  let stream
  try {
    stream = await root.navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    throw new Error(VOICE_NOTE_MESSAGES.micBlocked)
  }

  let rec
  try {
    rec = new root.MediaRecorder(stream)
  } catch {
    stopTracks(stream)
    throw new Error(VOICE_NOTE_MESSAGES.unsupported)
  }

  const chunks = []
  rec.ondataavailable = (e) => { if (e?.data && e.data.size > 0) chunks.push(e.data) }
  // ⛔ THE RESOLVER IS HELD AS WELL AS WIRED TO `onstop`. A recorder that is already inactive when
  // `stop()` is called never fires `onstop` again, and `await stopped` would then hang forever — a
  // gesture that produces no note AND no message, which is the one outcome this module exists to
  // make impossible. Holding the resolver lets the stop path settle the promise itself.
  let settleStopped
  const stopped = new Promise((resolve) => { settleStopped = resolve; rec.onstop = resolve })

  try {
    rec.start()
  } catch {
    stopTracks(stream)
    throw new Error(VOICE_NOTE_MESSAGES.unsupported)
  }

  return {
    stop: async () => {
      try {
        if (rec.state === 'recording') rec.stop()
        else settleStopped()
      } catch { settleStopped() }
      await stopped
      stopTracks(stream)
      return new Blob(chunks, { type: 'audio/webm' })
    },
    cancel: () => {
      try { rec.stop() } catch { /* nothing to stop */ }
      stopTracks(stream)
    },
  }
}
