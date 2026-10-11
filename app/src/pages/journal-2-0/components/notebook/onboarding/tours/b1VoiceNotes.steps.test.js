// P0.10: the voice-notes tour. Its door is inside the New note caret menu on Research Home
// (NewNoteMenu.jsx), so step 1 asks the member to open the menu (`waitFor` the voice item) and
// every later step points at that item. The anchors themselves are railed generically by
// ../tourAnchors.test.js once this file names NewNoteMenu.jsx; this pins the tour's shape.
import { describe, it, expect } from 'vitest'
import { STEPS, COPY } from './b1VoiceNotes.steps'

describe('voice-notes walks into the menu it describes', () => {
  it('step 1 points at the New note split and waits for the voice item to appear', () => {
    expect(STEPS[0].anchor).toBe('new-note-home')
    expect(STEPS[0].waitFor).toBe('new-note-voice')
  })

  it('every later step points at the voice item, inside the open menu', () => {
    expect(STEPS.slice(1).map((s) => s.anchor)).toEqual(Array(STEPS.length - 1).fill('new-note-voice'))
  })

  it('every step names the menu file, where both anchors live', () => {
    expect(new Set(STEPS.map((s) => s.file))).toEqual(new Set(['components/notebook/NewNoteMenu.jsx']))
  })

  it('stays inside the 3 to 6 step budget of a replayable tour', () => {
    expect(STEPS.length).toBeGreaterThanOrEqual(3)
    expect(STEPS.length).toBeLessThanOrEqual(6)
  })

  it('control: every step still has its copy', () => {
    for (const s of STEPS) expect(COPY[s.id]?.title, s.id).toBeTruthy()
  })
})
