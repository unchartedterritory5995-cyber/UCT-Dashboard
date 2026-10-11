// P0.7 fix round 1: the Ask section must not shrink the "Or tell Notebook what to change" box.
//
// The section is a flex column. `align-items: flex-start` on it shrank EVERY child to its content
// width, so the opened request box, the review list and the applied/undo views collapsed (the old
// `.aiSlot` was a plain block, so AiActionsPanel's `.wrap` filled the home column). Only the
// question door is meant to stay compact. jsdom lays nothing out, so this reads the DECLARATIONS;
// the box widths are measured in a real browser by tools/notebook_home_ask_measure.py.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, 'ResearchHome.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const block = (sel) => {
  const m = css.match(new RegExp(String.raw`(?:^|\})\s*\.` + sel + String.raw`\s*\{([^}]*)\}`))
  return m ? m[1] : null
}
const decl = (body, prop) => (body?.match(new RegExp(String.raw`(?:^|;|\s)` + prop + String.raw`\s*:\s*([^;]+)`)) || [])[1]?.trim()

describe('the Ask section does not shrink its children', () => {
  it('is a flex column that STRETCHES them (never flex-start / start / center / end)', () => {
    const body = block('askSection')
    expect(body, '.askSection exists').toBeTruthy()
    expect(decl(body, 'display')).toBe('flex')
    expect(decl(body, 'flex-direction')).toBe('column')
    const align = decl(body, 'align-items')
    expect(align === undefined || align === 'stretch' || align === 'normal', `align-items is ${align}`).toBe(true)
  })

  it('keeps the question door compact on its OWN wrapper, not on the section', () => {
    const door = block('askDoor')
    expect(door, '.askDoor exists').toBeTruthy()
    expect(decl(door, 'align-self')).toBe('flex-start')
  })

  it('the section is the home column width, as the old AI slot was', () => {
    expect(decl(block('askSection'), 'max-width')).toBe('820px')
  })
})
