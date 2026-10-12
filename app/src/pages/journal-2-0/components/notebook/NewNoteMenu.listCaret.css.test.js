// @vitest-environment node
// P1 follow-up, fix round 1 (review I1). The notes list's New note caret (NewNoteCaret) owes its touch
// floor and its phone placement to CSS that no jsdom test can see, split across TWO stylesheets:
//   - NewNoteMenu.module.css: `.listCaret > button` gets min-height AND min-width var(--tap-min) at
//     <=1024px (phone AND tablet), and at <=640px `.listCaret` is position: static with its `.menu`
//     right-aligned, so the menu hangs from the row rather than from the caret;
//   - NotebookTab.module.css: at <=640px `.newWrap` is position: relative, the box it hangs from.
// Remove either half and the failure is silent: a ~30px-wide caret on a tablet, or a phone menu
// anchored to some distant ancestor. This reads the declarations; it cannot measure a rendered box.
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const MENU_CSS = read('./NewNoteMenu.module.css')
const TAB_CSS = read('../../tabs/NotebookTab.module.css')
const MENU_JSX = read('./NewNoteMenu.jsx')

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/** Bodies of every `@media <cond> {…}` block whose condition is exactly `cond`. */
function mediaBlocks(css, cond) {
  const out = []
  const src = strip(css)
  const re = /@media\s*([^{]+)\{/g
  let m
  while ((m = re.exec(src))) {
    let depth = 1
    let i = re.lastIndex
    while (i < src.length && depth) {
      if (src[i] === '{') depth += 1
      else if (src[i] === '}') depth -= 1
      i += 1
    }
    if (m[1].replace(/\s+/g, '') === cond.replace(/\s+/g, '')) out.push(src.slice(re.lastIndex, i - 1))
  }
  return out.join('\n')
}

/** The declarations every rule in `block` gives `selector` (a rule counts when one of its
 *  comma-separated selectors is exactly `selector`, whitespace-normalised). */
function declsFor(block, selector) {
  const want = selector.replace(/\s+/g, ' ').trim()
  const out = {}
  const rule = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = rule.exec(block))) {
    const sels = m[1].split(',').map((s) => s.replace(/\s+/g, ' ').trim())
    if (!sels.includes(want)) continue
    for (const d of m[2].split(';')) {
      const k = d.indexOf(':')
      if (k > 0) out[d.slice(0, k).trim()] = d.slice(k + 1).trim()
    }
  }
  return out
}

const TOUCH = '(max-width: 1024px)'
const PHONE = '(max-width: 640px)'

describe('CONTROLS: the reader can see a rule, and can miss one', () => {
  it('non-vacuity: it finds Home\'s own caret floor in the same touch block', () => {
    const touch = mediaBlocks(MENU_CSS, TOUCH)
    expect(touch.length).toBeGreaterThan(0)
    expect(declsFor(touch, '.caret')).toMatchObject({ 'min-height': 'var(--tap-min)', 'min-width': 'var(--tap-min)' })
  })
  it('a stylesheet without the rule yields nothing, and a commented-out rule does not count', () => {
    const css = '@media (max-width: 1024px) { .caret { min-height: var(--tap-min); } /* .listCaret > button { min-width: var(--tap-min); } */ }'
    expect(declsFor(mediaBlocks(css, TOUCH), '.listCaret > button')).toEqual({})
    expect(declsFor(mediaBlocks(css, PHONE), '.caret')).toEqual({})
  })
})

describe('the list caret\'s CSS contract (review I1)', () => {
  it('the list form renders its own class on a DIV, never keyed on element type', () => {
    const fn = MENU_JSX.slice(MENU_JSX.indexOf('export function NewNoteCaret'))
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/<div className=\{styles\.listCaret\}>/)
    expect(strip(MENU_CSS)).not.toMatch(/\bspan\.|\bdiv\./)
  })
  it('keeps the 44px touch floor on BOTH axes at <=1024px (phone and tablet)', () => {
    const d = declsFor(mediaBlocks(MENU_CSS, TOUCH), '.listCaret > button')
    expect(d['min-height']).toBe('var(--tap-min)')
    expect(d['min-width']).toBe('var(--tap-min)')
  })
  it('on a phone the menu hangs right-aligned from the row, not from the caret', () => {
    const phone = mediaBlocks(MENU_CSS, PHONE)
    expect(declsFor(phone, '.listCaret')['position']).toBe('static')
    expect(declsFor(phone, '.listCaret .menu')).toMatchObject({ left: 'auto', right: '0' })
  })
  it('…and the row it hangs from is positioned (NotebookTab.module.css .newWrap)', () => {
    expect(declsFor(mediaBlocks(TAB_CSS, PHONE), '.newWrap')['position']).toBe('relative')
  })
})
