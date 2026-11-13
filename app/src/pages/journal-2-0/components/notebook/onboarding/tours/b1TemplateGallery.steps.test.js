// W14-Q2: in a real browser the template-gallery tour's door step never showed for a member
// with notes (the picker that holds the door opens in a sheet, behind a click nothing asked
// for), and its last two steps pointed at the Templates button. This pins the repaired data:
// the first step asks for the click, and every later step points inside the open picker.
//
// Final fix (A1): the first step's ▾ is not drawn on a phone, so neither this tour nor the
// Template library tour (b4Styles.steps.js, the same first step) could open there. Each now has
// phone-tier steps through ⋯ > "New from a template", and the later steps are shared. Pinned
// here for both tours, through the engine's own tier filter (stepsForScreen).
import { describe, it, expect } from 'vitest'
import { STEPS, COPY } from './b1TemplateGallery.steps'
import { STYLE_LIBRARY_STEPS, STYLE_LIBRARY_COPY } from './b4Styles.steps'
import { stepsForScreen } from '../tourTiers'
import { MQ } from '../../../../../../styles/breakpoints'

const phoneScreen = (q) => q === MQ.phone || q === MQ.tabletDown
const desktopScreen = () => false

describe('template-gallery walks into the picker it describes', () => {
  const wide = stepsForScreen(STEPS, desktopScreen)
  it('wide: step 1 waits for the member to open Templates (the gallery door appears)', () => {
    expect(wide[0].anchor).toBe('templates')
    expect(wide[0].waitFor).toBe('template-gallery-door')
  })

  it('wide: every later step points at the gallery door, inside the open picker', () => {
    expect(wide.slice(1).map((s) => s.anchor)).toEqual(Array(wide.length - 1).fill('template-gallery-door'))
    expect(new Set(wide.slice(1).map((s) => s.file))).toEqual(new Set(['components/notebook/TemplatePicker.jsx']))
  })

  it('control: every step still has its copy', () => {
    for (const s of STEPS) expect(COPY[s.id]?.title, s.id).toBeTruthy()
  })
})

describe.each([
  ['template-gallery', STEPS, COPY],
  ['style-library', STYLE_LIBRARY_STEPS, STYLE_LIBRARY_COPY],
])('%s opens on a phone through ⋯ > New from a template (A1)', (_id, steps, copy) => {
  const phone = stepsForScreen(steps, phoneScreen)
  const wide = stepsForScreen(steps, desktopScreen)

  it('phone: step 1 is ⋯ and waits for its "New from a template" row', () => {
    expect(phone[0]).toMatchObject({ anchor: 'styles-button', waitFor: 'new-from-template-phone', file: 'tabs/NotebookTab.jsx' })
  })

  it('phone: step 2 is that row and waits for the gallery door in the sheet it opens', () => {
    expect(phone[1]).toMatchObject({ anchor: 'new-from-template-phone', waitFor: 'template-gallery-door', file: 'tabs/NotebookTab.jsx' })
  })

  it('phone: the ▾ step is not in the tour; the later steps are the wide tour\'s own', () => {
    expect(phone.map((s) => s.anchor)).not.toContain('templates')
    expect(phone.slice(2)).toEqual(wide.slice(1))
  })

  it('wide: no phone step is in the tour (CONTROL: the filter can say no)', () => {
    expect(wide.map((s) => s.anchor)).not.toContain('new-from-template-phone')
    expect(wide[0].anchor).toBe('templates')
  })

  it('the phone copy names the phone door, never the ▾', () => {
    for (const s of phone.slice(0, 2)) {
      expect(copy[s.id]?.body, s.id).toMatch(/New from a template/)
      expect(copy[s.id]?.body, s.id).not.toMatch(/▾/)
    }
  })

  it('stays inside the 3 to 6 step budget of a replayable tour', () => {
    expect(steps.length).toBeGreaterThanOrEqual(3)
    expect(steps.length).toBeLessThanOrEqual(6)
  })
})
