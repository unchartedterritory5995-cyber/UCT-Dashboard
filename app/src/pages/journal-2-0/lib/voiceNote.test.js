/**
 * Wave 11 lane 11A — the voice note's client half: the note a result becomes,
 * the transcription loop, the gate, and the two doors.
 *
 * ⛔ The note is checked as the editor will read it: the doc is built by the
 * REAL `buildVoiceNoteDoc` and parsed by the REAL schema (`buildExtensions`), so a
 * node shape the editor would drop fails here, not on a member's screen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { __resetNotebookFlags, latchNotebookFlags } from './offline/notebookFlags'
import {
  NO_SUMMARY_SENTENCE, VOICE_NOTE_LOCKED_SENTENCE, VOICE_SUMMARY_ACTION, appendVoiceNote, buildVoiceNoteDoc,
  createVoiceNote, defaultVoiceNoteTitle, tickerHref, transcribeRecording, transcriptParagraphs,
  voiceNotesEnabled,
} from './voiceNote'

const settleSpy = vi.hoisted(() => vi.fn(async () => null))
vi.mock('./offline/settleNoteWrite', () => ({ settleNoteWrite: (...a) => settleSpy(...a) }))

const RESULT = {
  source: 'recording', title: 'Voice note', name: '', date: '2026-10-01', durationSeconds: 754,
  transcript: 'I am watching NVDA for a breakout.\n\nSet a stop on AMD below the 50-day.',
  transcriptShortened: false, words: 15,
  summary: 'Watching NVDA for a breakout; a stop on AMD below the 50-day.',
  tickers: ['NVDA', 'AMD'], actionItems: ['Set a stop on AMD below the 50-day', 'Review position size'],
  ai: { ok: true, model: 'claude-sonnet-5', sentence: '' },
}
const NO_AI = { ...RESULT, summary: '', tickers: [], actionItems: [], ai: { ok: false, model: 'claude-sonnet-5', sentence: 'The summary couldn’t be written this time.' } }

// 21:52 LOCAL on Oct 1 — already Oct 2 in UTC for any member west of Greenwich.
const EVENING = new Date(2026, 9, 1, 21, 52)
const headings = (doc) => doc.content.filter((n) => n.type === 'heading').map((n) => n.content[0].text)
const find = (doc, type) => doc.content.find((n) => n.type === type)

function resp(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

beforeEach(() => { settleSpy.mockClear(); __resetNotebookFlags() })
afterEach(() => { vi.unstubAllGlobals(); __resetNotebookFlags() })

describe('the note a result becomes', () => {
  it('holds the four sections, the AI label on the summary, linked tickers, a real task list and a closed transcript', () => {
    const doc = buildVoiceNoteDoc(RESULT, { insertedAt: '2026-10-01T13:00:00.000Z', now: EVENING })
    expect(headings(doc)).toEqual(['Summary', 'Tickers', 'Action items', 'Transcript'])
    const ai = find(doc, 'askInsert')
    expect(ai.attrs).toMatchObject({ action: VOICE_SUMMARY_ACTION, model: 'claude-sonnet-5', question: 'Recording' })
    expect(ai.content[0].content[0].text).toBe(RESULT.summary)
    const tickerPara = doc.content[doc.content.findIndex((n) => n.type === 'heading' && n.content[0].text === 'Tickers') + 1]
    const links = tickerPara.content.filter((n) => n.marks?.some((m) => m.type === 'link'))
    expect(links.map((n) => n.text)).toEqual(['$NVDA', '$AMD'])
    expect(links[0].marks.find((m) => m.type === 'link').attrs.href).toBe('/journal/notebook/research/NVDA')
    const tasks = find(doc, 'taskList')
    expect(tasks.content.map((t) => [t.attrs.checked, t.content[0].content[0].text])).toEqual([
      [false, 'Set a stop on AMD below the 50-day'], [false, 'Review position size']])
    const toggle = find(doc, 'toggle')
    expect(toggle.attrs.open).toBe(false)
    expect(toggle.content[0].content[0].text).toBe('Full transcript · 15 words')
    expect(toggle.content[1].content.map((p) => p.content[0].text)).toEqual([
      'I am watching NVDA for a breakout.', 'Set a stop on AMD below the 50-day.'])
    // the source and the date are the first line
    expect(doc.content[0].content[0].text).toBe('Recording · Oct 1, 2026 · 13 min')
  })

  it('the editor\'s own schema reads every node of it (nothing is dropped on open)', () => {
    const schema = getSchema(buildExtensions())
    const doc = buildVoiceNoteDoc(RESULT)
    expect(() => schema.nodeFromJSON(doc).check()).not.toThrow()
    expect(() => schema.nodeFromJSON(buildVoiceNoteDoc(NO_AI)).check()).not.toThrow()
  })

  it('without an AI answer the note holds the transcript alone — no unlabelled summary, no sections', () => {
    const doc = buildVoiceNoteDoc(NO_AI)
    expect(headings(doc)).toEqual(['Transcript'])
    expect(JSON.stringify(doc)).not.toContain('askInsert')
    expect(find(doc, 'toggle')).toBeTruthy()
  })

  it('a Desk session is named as the source and titled by the session', () => {
    const desk = { ...RESULT, source: 'desk', title: 'Live Trading — Oct 1, 2026', desk: { id: 7, title: 'Live Trading — Oct 1, 2026' } }
    expect(buildVoiceNoteDoc(desk, { now: EVENING }).content[0].content[0].text).toMatch(/^Desk session: Live Trading — Oct 1, 2026 · Oct 1, 2026/)
    expect(defaultVoiceNoteTitle(desk, EVENING)).toBe('Live Trading — Oct 1, 2026')
    expect(defaultVoiceNoteTitle(RESULT, EVENING)).toBe('Voice note — Oct 1, 2026')
  })

  it("is dated by the MEMBER's own day, never the server's UTC day", () => {
    // the server's own date says Oct 2 (UTC); the member saved at 21:52 on Oct 1
    const doc = buildVoiceNoteDoc({ ...RESULT, date: '2026-10-02' }, { now: EVENING })
    expect(doc.content[0].content[0].text).toBe('Recording · Oct 1, 2026 · 13 min')
  })

  it('a summary dropped by validation leaves a plain sentence — never an empty AI-labelled block', () => {
    const doc = buildVoiceNoteDoc({ ...RESULT, summary: '' }, { now: EVENING })
    expect(headings(doc)).toEqual(['Summary', 'Tickers', 'Action items', 'Transcript'])
    expect(find(doc, 'askInsert')).toBeUndefined()
    const after = doc.content[doc.content.findIndex((n) => n.type === 'heading' && n.content[0].text === 'Summary') + 1]
    expect(after).toEqual({ type: 'paragraph', content: [{ type: 'text', text: NO_SUMMARY_SENTENCE }] })
  })

  it('long transcript runs are cut at a sentence, never mid-word', () => {
    const long = 'Word one two three. '.repeat(200)
    const paras = transcriptParagraphs(long, 300)
    expect(paras.length).toBeGreaterThan(5)
    for (const p of paras) { expect(p.length).toBeLessThanOrEqual(300); expect(p.endsWith('.')).toBe(true) }
    expect(tickerHref('BRK-B')).toBe('/journal/notebook/research/BRK-B')
  })
})

describe('the gate', () => {
  it('is off until the flag latches on, and off for a free member', () => {
    expect(voiceNotesEnabled(true)).toBe(false)
    latchNotebookFlags({ notebook_voice_notes_enabled: false })
    expect(voiceNotesEnabled(true)).toBe(false)
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_voice_notes_enabled: true })
    expect(voiceNotesEnabled(true)).toBe(true)
    expect(voiceNotesEnabled(false)).toBe(false)
  })
})

describe('transcription, in order, with a retry that keeps the recording', () => {
  it('uploads once, then asks for each part in turn and reports the progress', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push(`${init?.method || 'GET'} ${url}`)
      if (url.endsWith('/jobs')) return resp(200, { jobId: 'j1', parts: 3, done: 0, finished: false })
      const n = calls.filter((c) => c.endsWith('/transcribe')).length
      return resp(200, { jobId: 'j1', parts: 3, done: n, finished: n === 3 })
    }))
    const progress = []
    const res = await transcribeRecording({ blob: new Blob(['x']), filename: 'memo.m4a', source: 'upload', onProgress: (p) => progress.push(p) })
    expect(res).toEqual({ ok: true, jobId: 'j1' })
    expect(calls).toEqual([
      'POST /api/j2/voice-notes/jobs',
      'POST /api/j2/voice-notes/jobs/j1/transcribe',
      'POST /api/j2/voice-notes/jobs/j1/transcribe',
      'POST /api/j2/voice-notes/jobs/j1/transcribe',
    ])
    expect(progress.map((p) => `${p.phase}:${p.done}/${p.total}`)).toEqual([
      'uploading:0/0', 'transcribing:0/3', 'transcribing:1/3', 'transcribing:2/3', 'transcribing:3/3'])
    const form = fetch.mock.calls[0][1].body
    expect(form.get('source')).toBe('upload')
    expect(form.get('audio').name).toBe('memo.m4a')
  })

  it('a failed part keeps the job; the retry resumes it WITHOUT uploading again', async () => {
    let failNext = true
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push(`${init?.method} ${url.replace('/api/j2/voice-notes', '')}`)
      if (url.endsWith('/jobs')) return resp(200, { jobId: 'j9', parts: 2, done: 0, finished: false })
      if (failNext) { failNext = false; return resp(502, { detail: 'Transcription failed for part 1 of 2. Your recording is kept — choose Retry to continue from where it stopped.' }) }
      const n = calls.filter((c) => c.endsWith('/transcribe')).length - 1
      return resp(200, { jobId: 'j9', parts: 2, done: n, finished: n === 2 })
    }))
    const blob = new Blob(['audio'])
    const first = await transcribeRecording({ blob, source: 'recording' })
    expect(first).toMatchObject({ ok: false, jobId: 'j9', status: 502 })
    expect(first.error).toMatch(/Your recording is kept/)
    const again = await transcribeRecording({ blob, source: 'recording', jobId: first.jobId })
    expect(again).toEqual({ ok: true, jobId: 'j9' })
    expect(calls.filter((c) => c === 'POST /jobs')).toHaveLength(1)
  })

  it('a job the server no longer holds is uploaded again from the blob this tab kept', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push(`${init?.method} ${url.replace('/api/j2/voice-notes', '')}`)
      if (url.endsWith('/jobs')) return resp(200, { jobId: 'fresh', parts: 1, done: 0, finished: false })
      if (url.includes('/old/')) return resp(404, { detail: 'gone' })
      return resp(200, { jobId: 'fresh', parts: 1, done: 1, finished: true })
    }))
    const res = await transcribeRecording({ blob: new Blob(['a']), source: 'recording', jobId: 'old' })
    expect(res).toEqual({ ok: true, jobId: 'fresh' })
    expect(calls).toEqual(['POST /jobs/old/transcribe', 'POST /jobs', 'POST /jobs/fresh/transcribe'])
  })

  it('a refusal (the month\'s cap) is said in the server\'s own sentence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(429, { detail: "You've used all 60 minutes of voice transcription for this month. It resets on the 1st." })))
    const res = await transcribeRecording({ blob: new Blob(['a']), source: 'upload' })
    expect(res).toMatchObject({ ok: false, status: 429, jobId: null })
    expect(res.error).toMatch(/It resets on the 1st/)
  })
})

describe('the create door lands its revision', () => {
  it('creates through the canonical path, tagged, and settles the answer', async () => {
    let body = null
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      body = JSON.parse(init.body)
      return resp(200, { note: { id: 'nv1', title: body.title, updatedAt: '2026-10-01T14:00:00.000000+00:00' } })
    }))
    const created = await createVoiceNote({ title: '  Morning call  ', result: RESULT })
    expect(fetch.mock.calls[0][0]).toBe('/api/j2/notes')
    expect(body.title).toBe('Morning call')
    expect(body.tags).toEqual(['voice-note'])
    expect(body.bodyJson.content.some((n) => n.type === 'askInsert')).toBe(true)
    expect(settleSpy).toHaveBeenCalledWith('nv1', created)
  })

  it('a refused create throws and lands nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(500, {})))
    await expect(createVoiceNote({ title: 't', result: RESULT })).rejects.toThrow()
    expect(settleSpy).not.toHaveBeenCalled()
  })
})

describe('the append door is an editor transaction', () => {
  const mk = (editable = true) => new Editor({
    element: document.createElement('div'), extensions: buildExtensions(), editable,
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My own words.' }] }, { type: 'paragraph' }] },
  })

  it('appends every section at the END of the note, after the member\'s words', () => {
    const editor = mk()
    const res = appendVoiceNote(editor, RESULT, { note: { locked: false } })
    expect(res).toEqual({ ok: true })
    const json = editor.getJSON()
    expect(json.content[0].content[0].text).toBe('My own words.')
    const types = json.content.map((n) => n.type)
    expect(types).toContain('askInsert')
    expect(types).toContain('taskList')
    expect(types).toContain('toggle')
    // the empty trailing paragraph was replaced, not left as a gap above the note
    expect(json.content[1].type).toBe('paragraph')
    expect(json.content[1].content[0].text).toMatch(/^Recording/)
    editor.destroy()
  })

  it('a LOCKED note refuses with the standard sentence and is left untouched', () => {
    const editor = mk()
    const before = JSON.stringify(editor.getJSON())
    expect(appendVoiceNote(editor, RESULT, { note: { locked: true } })).toEqual({ ok: false, reason: VOICE_NOTE_LOCKED_SENTENCE })
    expect(JSON.stringify(editor.getJSON())).toBe(before)
    editor.destroy()
  })

  it('a read-only editor refuses the same way (control: the guard reads the editor, not only the flag)', () => {
    const editor = mk(false)
    expect(appendVoiceNote(editor, RESULT, { note: { locked: false } })).toEqual({ ok: false, reason: VOICE_NOTE_LOCKED_SENTENCE })
    editor.destroy()
  })
})
