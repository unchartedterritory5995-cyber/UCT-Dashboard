// W14-Q2: in a real browser the template-gallery tour's door step never showed for a member
// with notes (the picker that holds the door opens in a sheet, behind a click nothing asked
// for), and its last two steps pointed at the Templates button. This pins the repaired data:
// the first step asks for the click, and every later step points inside the open picker.
import { describe, it, expect } from 'vitest'
import { STEPS, COPY } from './b1TemplateGallery.steps'

describe('template-gallery walks into the picker it describes', () => {
  it('step 1 waits for the member to open Templates (the gallery door appears)', () => {
    expect(STEPS[0].anchor).toBe('templates')
    expect(STEPS[0].waitFor).toBe('template-gallery-door')
  })

  it('every later step points at the gallery door, inside the open picker', () => {
    expect(STEPS.slice(1).map((s) => s.anchor)).toEqual(Array(STEPS.length - 1).fill('template-gallery-door'))
    expect(new Set(STEPS.slice(1).map((s) => s.file))).toEqual(new Set(['components/notebook/TemplatePicker.jsx']))
  })

  it('control: every step still has its copy', () => {
    for (const s of STEPS) expect(COPY[s.id]?.title, s.id).toBeTruthy()
  })
})
