// Wave 14 lane W14-A: the first-run welcome's capability preview, as DATA.
//
// ⛔ A capability line is shown only when its OWN flag is armed for this member. A flag key
// that names nothing would never be armed, so its line would be silently invisible forever
// and every test of "the line is hidden while dark" would pass for the wrong reason. The
// first rail below therefore holds every key to the ONE flag authority (FLAG_FALLBACKS).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CAPABILITY_PREVIEW, armedCapabilities, PREVIEW_COPY } from './capabilityList'
import { FLAG_FALLBACKS, __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { SAMPLE_COPY } from './sampleNotebook'
import { VOICE_NOTE_FLAG } from '../../../lib/voiceNote'

beforeEach(() => { __resetNotebookFlags() })
afterEach(() => { __resetNotebookFlags() })

describe('capabilityList -- the list', () => {
  it('non-vacuity: the list is not empty and carries the five the plan names', () => {
    const flags = CAPABILITY_PREVIEW.map((c) => c.flag)
    for (const f of [
      'notebook_plan_grading_enabled', 'notebook_chart_plan_enabled', 'notebook_playbook_enabled',
      'notebook_review_drafts_enabled', 'notebook_earnings_prep_enabled',
    ]) expect(flags, f).toContain(f)
  })

  it('every flag is a real, boolean enablement gate in FLAG_FALLBACKS (absent => OFF)', () => {
    for (const c of CAPABILITY_PREVIEW) {
      expect(Object.prototype.hasOwnProperty.call(FLAG_FALLBACKS, c.flag), c.flag).toBe(true)
      expect(FLAG_FALLBACKS[c.flag], `${c.flag} must fall back to OFF`).toBe(false)
    }
  })

  it('ids and flags are unique, and every line has a label and a sentence', () => {
    const ids = CAPABILITY_PREVIEW.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    const flags = CAPABILITY_PREVIEW.map((c) => c.flag)
    expect(new Set(flags).size).toBe(flags.length)
    for (const c of CAPABILITY_PREVIEW) {
      expect(c.label.trim().length, c.id).toBeGreaterThan(0)
      expect(c.line.trim().length, c.id).toBeGreaterThan(0)
    }
  })

  it('copy is plain: no em dash, no exclamation, short lines', () => {
    const all = [PREVIEW_COPY.heading, PREVIEW_COPY.sampleLead, PREVIEW_COPY.sampleTail,
      ...CAPABILITY_PREVIEW.flatMap((c) => [c.label, c.line])]
    for (const s of all) {
      expect(s, s).not.toMatch(/—/)
      expect(s, s).not.toMatch(/!/)
    }
    for (const c of CAPABILITY_PREVIEW) expect(c.line.length, c.id).toBeLessThanOrEqual(120)
  })

  // P0.10: voice notes are a shipped door the preview never named.
  it("voice notes follow writing help, on the voice-note gate's ONE flag name", () => {
    const ids = CAPABILITY_PREVIEW.map((c) => c.id)
    expect(ids.indexOf('voice-notes')).toBe(ids.indexOf('writing-help') + 1)
    const voice = CAPABILITY_PREVIEW.find((c) => c.id === 'voice-notes')
    expect(voice.flag).toBe(VOICE_NOTE_FLAG)
    expect(voice.flag).toBe('notebook_voice_notes_enabled')
    expect(voice.label).toBe('Voice notes')
    expect(voice.line).toBe('Record or upload a voice memo, or pick a Desk session. You get a transcript and a short summary in a new note.')
  })

  it('the promotion names the sample button by its ONE label (SAMPLE_COPY.add)', () => {
    expect(PREVIEW_COPY.sampleButton).toBe(SAMPLE_COPY.add)
  })
})

describe('armedCapabilities', () => {
  it('nothing latched: nothing armed', () => {
    expect(armedCapabilities()).toEqual([])
  })

  it('a payload with every gate OFF: nothing armed', () => {
    const off = Object.fromEntries(CAPABILITY_PREVIEW.map((c) => [c.flag, false]))
    latchNotebookFlags(off)
    expect(armedCapabilities()).toEqual([])
  })

  it('only the armed lines, in list order', () => {
    latchNotebookFlags({ notebook_playbook_enabled: true, notebook_plan_grading_enabled: true })
    const ids = armedCapabilities().map((c) => c.flag)
    expect(ids).toEqual(CAPABILITY_PREVIEW
      .filter((c) => c.flag === 'notebook_playbook_enabled' || c.flag === 'notebook_plan_grading_enabled')
      .map((c) => c.flag))
    expect(ids).toHaveLength(2)
  })

  it('every line can be armed on its own (discriminator: no line is tied to another flag)', () => {
    for (const c of CAPABILITY_PREVIEW) {
      const got = armedCapabilities((k) => (k === c.flag ? true : null))
      expect(got.map((x) => x.id), c.id).toEqual([c.id])
    }
  })

  it('a non-true answer (null, false, a string) never arms a line', () => {
    for (const v of [null, false, undefined, 'true', 1]) {
      expect(armedCapabilities(() => v)).toEqual([])
    }
  })
})
