// P0.10: the voice-notes tour. Go-live wave 1: its door is the notes list's New menu (Research Home's New note menu
// went with Research Home). On a wide screen step 1 asks the member to open the New menu's arrow (`waitFor` the voice
// row) and the later wide steps point at that row; on a phone, where the "+ New" group is not drawn, ⋯ carries the row
// and the phone steps do the same there. The anchors are railed generically by ../tourAnchors.test.js; the tiers by
// ../tourRegistry.test.js; this pins the tour's shape.
import { describe, it, expect } from 'vitest'
import { STEPS, COPY } from './b1VoiceNotes.steps'

const wide = STEPS.filter((s) => s.tier === 'wide')
const phone = STEPS.filter((s) => s.tier === 'phone')

describe('voice-notes walks into the menu it describes', () => {
  it('every step belongs to a tier, wide or phone (the door is in a different menu on each)', () => {
    expect(STEPS.every((s) => s.tier === 'wide' || s.tier === 'phone')).toBe(true)
    expect(wide.length).toBeGreaterThan(0)
    expect(phone.length).toBeGreaterThan(0)
  })

  it('wide: step 1 points at the New menu arrow and waits for the voice row; later steps point at that row', () => {
    expect(wide[0]).toMatchObject({ anchor: 'templates', waitFor: 'new-note-voice' })
    expect(wide.slice(1).map((s) => s.anchor)).toEqual(Array(wide.length - 1).fill('new-note-voice'))
  })

  it('phone: step 1 points at ⋯ and waits for its voice row; later steps point at that row', () => {
    expect(phone[0]).toMatchObject({ anchor: 'styles-button', waitFor: 'new-note-voice-phone' })
    expect(phone.slice(1).map((s) => s.anchor)).toEqual(Array(phone.length - 1).fill('new-note-voice-phone'))
  })

  it('every step names the notes list file, where every anchor lives', () => {
    expect(new Set(STEPS.map((s) => s.file))).toEqual(new Set(['tabs/NotebookTab.jsx']))
  })

  it('stays inside the 3 to 6 step budget of a replayable tour', () => {
    expect(STEPS.length).toBeGreaterThanOrEqual(3)
    expect(STEPS.length).toBeLessThanOrEqual(6)
  })

  it('control: every step still has its copy', () => {
    for (const s of STEPS) expect(COPY[s.id]?.title, s.id).toBeTruthy()
  })
})
