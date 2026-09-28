// Wave 10 follow-up F5 -- the board scrolls ALONE, and shows that it scrolls.
//
// design review D-5 (docs/notebook/design-review.md on feat/notebook-w10-e2): at 1200 px a
// board column was cut at the right edge with no visible scroll affordance. proof walk
// 10E-1 6b: at 390 px the board made the app's <main> 1154 px wide. The F5 probe named the
// cause (docs/notebook/proof/f5-before-0bbfd3f68/f5probe.json, `board`): `.columns` DID
// scroll its own overflow, but every card carries a visually-hidden "Move <note> to" label
// that is `position: absolute` -- and with nothing positioned between it and the Notebook
// panel, the panel was its containing block. An absolutely positioned box escapes every
// scroller that is not its containing block, so the labels of cards scrolled out of view
// stayed out there: the panel (and at 390 px the page) grew to hold them.
//
// ⛔ STRUCTURAL, NOT THE VERDICT: jsdom lays nothing out. The measured widths and the
// scrollbar's thickness are the proof walk's before/after (docs/notebook/proof/f5-*/f5probe.json).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRules, declarations, stripComments } from '../../a11y/cssAudit'

const DIR = join(process.cwd(), 'src', 'pages', 'journal-2-0', 'components', 'notebook')
const css = readFileSync(join(DIR, 'NoteBoardView.module.css'), 'utf8')
const jsx = readFileSync(join(DIR, 'NoteBoardView.jsx'), 'utf8')

const rule = (text, selector) => {
  const r = parseRules(text).find((x) => x.selector === selector)
  if (!r) throw new Error(`${selector} not found`)
  return Object.fromEntries(declarations(r).map((d) => [d.prop, d.value]))
}

describe('the board row (NoteBoardView.module.css `.columns`)', () => {
  const columns = rule(css, '.columns')

  it('non-vacuity: the cards carry an absolutely positioned label INSIDE the row', () => {
    expect(rule(css, '.srOnly').position).toBe('absolute')
    const code = stripComments(jsx)
    const rowAt = code.indexOf('className={styles.columns}')
    const labelAt = code.indexOf('className={styles.srOnly}')
    expect(rowAt, 'the row is rendered').toBeGreaterThan(-1)
    expect(labelAt, 'the hidden label is rendered after the row opens (inside it)').toBeGreaterThan(rowAt)
  })

  it('scrolls its own overflow sideways', () => {
    expect(columns['overflow-x']).toBe('auto')
  })

  it('is the containing block of what it holds -- so an absolute label scrolls and clips WITH it', () => {
    expect(['relative', 'absolute', 'sticky']).toContain(columns.position)
  })

  it('shows its scrollbar (thin, in theme tokens) -- never hidden', () => {
    expect(columns['scrollbar-width']).toBe('thin')
    expect(columns['scrollbar-color']).toMatch(/^var\(--[a-z-]+\)\s+/)
  })

  it('control: the old rule fails the containment and affordance checks', () => {
    const old = rule('.columns { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px; }', '.columns')
    expect(old.position).toBeUndefined()
    expect(old['scrollbar-width']).toBeUndefined()
  })
})
