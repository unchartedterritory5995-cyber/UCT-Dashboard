// app/src/pages/journal-2-0/a11y/voiceNote.a11y.test.jsx
//
// Wave 11, lane 11A: the voice-note dialog through 8A's axe harness (the ONE way a Notebook
// rail asks axe-core; frozen exclusions, ruling D-A5), in each state a member reaches that
// holds controls: choosing a source (record), the upload step, a Desk session list, and the
// preview (the AI-labelled summary, the tickers, the action items, the transcript and the
// editable title). Each recipe proves the state it is about rendered before axe runs, so an
// empty or wrong screen can never pass as a clean one.
import { describe, beforeEach, vi } from 'vitest'
import { render, screen, act, within } from '@testing-library/react'
import { installFetch, Providers } from './fixtures'
import { axeSurface } from './surface'
import VoiceNoteDialog from '../components/notebook/VoiceNoteDialog'

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const RESULT = {
  source: 'desk', title: 'Live Trading — Oct 1, 2026', date: '2026-10-01', words: 9,
  transcript: '[0:05] NVDA is holding the gap. [0:40] Watching AMD for a reclaim.',
  summary: 'NVDA held the gap; AMD is on watch for a reclaim.', tickers: ['NVDA', 'AMD'],
  actionItems: ['Set alerts on both before lunch'], desk: { id: 7, title: 'Live Trading — Oct 1, 2026' },
  ai: { ok: true, model: 'claude-sonnet-5', sentence: '' },
}

describe('lane 11A surfaces', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaRecorder', class { static isTypeSupported() { return true } })
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [] }) } })
    installFetch([
      [/^\/api\/j2\/voice-notes\/status$/, { cap: { usedSeconds: 0, capSeconds: 3600, remainingSeconds: 3600, unlimited: false } }],
      [/^\/api\/j2\/voice-notes\/desk-sessions$/, { sessions: [{ id: 7, title: 'Live Trading — Oct 1, 2026', category: 'Live Trading Sessions' }] }],
      [/^\/api\/j2\/voice-notes\/desk-sessions\/7\/summarize$/, RESULT],
    ])
  })

  axeSurface('voice-note-dialog', async () => {
    render(<Providers><VoiceNoteDialog initialSource="record" onClose={() => {}} /></Providers>)
    const dialog = await screen.findByRole('dialog', { name: 'Voice note' })
    await within(dialog).findByRole('button', { name: 'Start recording' })
    await settle()
  })

  axeSurface('voice-note-dialog-upload', async () => {
    render(<Providers><VoiceNoteDialog initialSource="upload" onClose={() => {}} /></Providers>)
    await screen.findByLabelText('Choose an audio file')
    await settle()
  })

  axeSurface('voice-note-dialog-desk', async () => {
    render(<Providers><VoiceNoteDialog initialSource="desk" onClose={() => {}} /></Providers>)
    await screen.findByRole('list', { name: 'Desk sessions with a transcript' })
    await settle()
  })

  axeSurface('voice-note-dialog-preview', async () => {
    render(<Providers><VoiceNoteDialog deskVideo={{ id: 7, title: 'Live Trading — Oct 1, 2026' }} onAppend={() => ({ ok: true })} onClose={() => {}} /></Providers>)
    const preview = await screen.findByRole('region', { name: 'Voice note preview' })
    within(preview).getByText(/AI-written · Compass · Voice note summary/)
    within(preview).getByRole('textbox', { name: 'Title' })
    await settle()
  })
})
