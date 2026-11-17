// A SAVED INDICATOR'S ROW: THE NAME KEEPS ITS LINE (seen on production 2026-11-17).
// "Uncharted Clouds" wrapped onto two lines and collided with its formula text. jsdom does no
// layout, so this pins the rule that prevents it, read from the stylesheet itself.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const CSS = fs.readFileSync(path.resolve(__dirname, 'BuilderSheet.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of the rule whose selector is exactly `sel`, on one line. */
function rule(sel) {
  const at = CSS.split('}').map((block) => block.split('{')).find((parts) => parts.length === 2 && parts[0].trim() === sel)
  return at ? at[1].replace(/\s+/g, ' ').trim() : ''
}

describe('a saved indicator row in the New formula window', () => {
  it('the name never wraps and never shrinks below its text until its cap', () => {
    const name = rule('.listName')
    expect(name).toMatch(/white-space: nowrap/)
    expect(name).toMatch(/text-overflow: ellipsis/)
    expect(name).toMatch(/overflow: hidden/)
    expect(name).toMatch(/flex: 0 0 auto/)
    expect(name).toMatch(/max-width: \d+%/)
  })

  it('the formula text beside it is the part that gives way', () => {
    const source = rule('.listSource')
    expect(source).toMatch(/flex: 1 1 auto/)
    expect(source).toMatch(/min-width: 0/)
    expect(source).toMatch(/overflow: hidden/)
  })

  it('CONTROL: the reader finds a rule that exists and nothing for one that does not', () => {
    expect(rule('.listRow')).toMatch(/display: flex/)
    expect(rule('.noSuchRuleHere')).toBe('')
  })
})
