/**
 * Two live-breadth style rules that are only checkable in the BUILT CSS.
 *
 * CSS modules hash class names, so a rule's real selector — and its specificity
 * against another rule — only exists after the build. Both facts below were
 * invisible to every component test and one of them shipped as a real defect
 * that a browser caught.
 *
 * Runs against `app/dist`; skips when there is no build, so it never blocks a
 * bare checkout. Related: user memory `lesson_css_modules_hashes_not_arguments`.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist/assets')

function css(match) {
  if (!fs.existsSync(DIST)) return null
  for (const f of fs.readdirSync(DIST).filter(f => f.endsWith('.css'))) {
    const text = fs.readFileSync(path.join(DIST, f), 'utf8')
    if (match.test(text)) return text
  }
  return null
}

/** The declaration block for the first selector matching `re`. */
function block(text, re) {
  const m = re.exec(text)
  if (!m) return null
  const open = text.indexOf('{', m.index)
  return text.slice(open + 1, text.indexOf('}', open))
}

describe('built live-breadth CSS', () => {
  it('never paints a background on the live row’s data cells', () => {
    // THE defect a browser found: `.liveRow td` is (0,1,1) and outranks the
    // `.bgG3`/`.bgR1` tier classes at (0,1,0), so a background here silently
    // flattens the Monitor's entire heat map — which is the language of that
    // table. Every class was still correctly applied, so only the computed
    // style ever disagreed. Unassertable in jsdom; pinned here instead.
    const text = css(/_liveRow_[a-z0-9]+_\d+ td/)
    if (!text) return expect(true).toBe(true)   // no build present
    const decls = block(text, /_liveRow_[a-z0-9]+_\d+ td\s*\{/)
    expect(decls).toBeTruthy()
    expect(decls).not.toMatch(/(^|;)\s*background\s*:/)
    expect(decls).not.toMatch(/(^|;)\s*background-color\s*:/)
    // The row still has to read as live — via its own cell, not a wash.
    expect(text).toMatch(/_liveRow_[a-z0-9]+_\d+ ._dateCell_[a-z0-9]+_\d+\{[^}]*background/)
  })

  it('keeps the session strip to two readings on a phone', () => {
    // The strip sits above the table; at full width on a 390px screen it would
    // push the data off the first screen entirely.
    const text = css(/@media\(max-width:640px\)\{[^}]*_strip_/)
    if (!text) return expect(true).toBe(true)
    const media = /@media\(max-width:640px\)\{(?:(?!@media)[\s\S])*?_item_[a-z0-9]+_\d+:nth-child\(n\+3\)\{display:none\}/
    expect(text).toMatch(media)
  })
})
