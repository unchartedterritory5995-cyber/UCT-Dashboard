// app/src/pages/journal-2-0/a11y/entryContext.a11y.test.jsx
//
// Wave 13, lane 13E-2: the Entry-context card and its "Why did you take it?" prompt through 8A's
// axe harness (the ONE way a Notebook rail asks axe-core). Dark behind
// notebook_entry_context_enabled, latched ON for the recipe. One recipe, two states on screen at
// the end of it -- the card's captured fields AND WhyPrompt's editing form with dictation armed --
// so an empty screen or a half-rendered prompt can never pass as a clean one:
//   * entry-context-card -- the fields grid (regime/exposure/breadth/RS/earnings/scans), the
//     saved "why" text, then switched into edit mode with the voice button mounted.
// The last describe holds OUTSIDE_POPULATION_SURFACES to the rails: every entry's file exists
// and its recipe is registered in a rail file, so the manifest can never be decorative.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Providers } from './fixtures'
import { axeSurface } from './surface'
import { OUTSIDE_POPULATION_SURFACES } from './notebookSurfaces'
import { J2_DIR } from './population'
import EntryContextCard from '../components/EntryContextCard'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })

const META = {
  version: 1,
  fields: ['regime', 'exposure', 'breadth_pct_above_50', 'rs_rank', 'days_to_earnings',
    'uct_scans', 'member_screens', 'fingerprint'],
  missingReasons: { rs_cache_cold: 'the RS rankings cache was cold' },
  notCaptured: { not_captured: 'No market context was captured for this entry.' },
  captureKinds: ['at_entry', 'captured_late'],
  whyMaxChars: 500,
}
const CONTEXT = {
  symbol: 'NVDA', entryDay: '2026-10-02', captureKind: 'at_entry', capturedLate: false,
  captureDay: '2026-10-02', capturedAt: '2026-10-02T14:31:07+00:00', trigger: 'manual_add',
  version: 1,
  fields: {
    regime: { value: 'amber', source: 'x', asOf: '2026-10-02', missing: null, detail: null },
    exposure: { value: 72.5, source: 'x', asOf: '2026-10-02', missing: null, detail: null },
    breadth_pct_above_50: { value: 55.1, source: 'x', asOf: '2026-10-02', missing: null, detail: null },
    rs_rank: { value: 91, source: 'x', asOf: '2026-10-02', missing: null, detail: null },
    days_to_earnings: { value: 18, source: 'x', asOf: '2026-10-02', missing: null, detail: null },
    uct_scans: { value: ['pullback_ma'], source: 'x', asOf: '2026-10-02', missing: null, detail: null },
    member_screens: { value: null, source: 'x', asOf: null, missing: 'no_screens_swept', detail: null },
    fingerprint: { value: null, source: 'x', asOf: null, missing: 'source_error', detail: null },
  },
  why: { text: 'Tight flag at the 21EMA', updatedAt: '2026-10-02T14:33:00+00:00' },
}

describe('a11y: the Entry-context card and WhyPrompt (wave 13, lane 13E-2)', () => {
  beforeEach(() => {
    latchNotebookFlags({ notebook_entry_context_enabled: true, notebook_voice_notes_enabled: true })
    // The voice flag is armed for this recipe, so WhyPrompt's dictation control must render the
    // real (supported) mic button, not its disabled "not supported" fallback — same stub
    // VoiceInputButton.test.jsx installs.
    try { localStorage.setItem('voice.dictation.hintSeen', '1') } catch { /* ignore */ }
    class MockMediaRecorder {}
    MockMediaRecorder.isTypeSupported = () => true
    global.MediaRecorder = MockMediaRecorder
    global.navigator.mediaDevices = { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) }
    global.fetch = vi.fn((url) => {
      const u = String(url)
      if (u.endsWith('/api/j2/entry-context/meta')) return json(META)
      if (u.includes('/api/j2/entry-context/position/')) {
        return json({ status: 'captured', key: { symbol: 'NVDA', entryDay: '2026-10-02' }, context: CONTEXT, reason: null })
      }
      return json({})
    })
  })
  afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

  axeSurface('entry-context-card', async () => {
    render(<Providers route="/journal-2-0/position/NVDA"><EntryContextCard kind="position" id="p1" /></Providers>)
    await screen.findByTestId('entry-context-card')
    expect(screen.getByText('Tight flag at the 21EMA')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByTestId('why-prompt-editing')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start voice input' })).toBeTruthy()
    await settle()
  })
})

describe('OUTSIDE_POPULATION_SURFACES is held to the rails', () => {
  const rails = readdirSync(join(J2_DIR, 'a11y'))
    .filter((f) => f.endsWith('.a11y.test.jsx'))
    .map((f) => readFileSync(join(J2_DIR, 'a11y', f), 'utf8'))

  it('every entry names a real file and a recipe registered in a rail', () => {
    const entries = Object.entries(OUTSIDE_POPULATION_SURFACES)
    expect(entries.length).toBeGreaterThan(0)
    for (const [file, { recipe, railFile }] of entries) {
      expect(existsSync(join(J2_DIR, file)), file).toBe(true)
      expect(existsSync(join(J2_DIR, railFile)), railFile).toBe(true)
      expect(rails.some((src) => src.includes(`axeSurface('${recipe}'`)), recipe).toBe(true)
    }
  })

  it('the registration check can fail (a recipe nobody registered is caught)', () => {
    const never = ['no-such', 'recipe', '13e2'].join('-')   // built, so this file cannot contain it
    expect(rails.some((src) => src.includes(`axeSurface('${never}'`))).toBe(false)
  })
})
