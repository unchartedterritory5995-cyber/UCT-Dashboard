// @vitest-environment jsdom
// P0.8: the iPhone Shortcut how-to. Its copy comes ONLY from docs/notebook/ios-shortcuts.md, so
// the test reads that doc and holds every address, header and field the sheet names to it.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ShortcutHowTo, { SHORTCUT_STEPS } from './ShortcutHowTo'

const DOC = readFileSync(join(process.cwd(), '..', 'docs', 'notebook', 'ios-shortcuts.md'), 'utf8')

function open(onClose = vi.fn()) {
  render(<MemoryRouter><ShortcutHowTo onClose={onClose} /></MemoryRouter>)
  return onClose
}
const textOf = (v) => {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(textOf).join(' ')
  if (v && typeof v === 'object') return Object.values(v).map(textOf).join(' ')
  return ''
}

describe('ShortcutHowTo', () => {
  it('is a named dialog holding five ordered steps', () => {
    open()
    const dlg = screen.getByRole('dialog', { name: 'Send notes from your iPhone' })
    const steps = within(dlg).getByRole('list', { name: 'Steps' })
    expect(steps.tagName).toBe('OL')
    const top = Array.from(steps.children).filter((c) => c.tagName === 'LI')
    expect(top).toHaveLength(5)
    expect(top.map((li) => li.querySelector('strong')?.textContent))
      .toEqual(SHORTCUT_STEPS.map((s) => s.title))
  })

  it('the steps are the five a member walks, in order', () => {
    expect(SHORTCUT_STEPS.map((s) => s.title)).toEqual([
      'Make a key',
      'Open the Shortcuts app',
      'Add the actions',
      'Paste the key',
      'Test it',
    ])
  })

  it('SHORTCUT_STEPS is frozen all the way down', () => {
    expect(Object.isFrozen(SHORTCUT_STEPS)).toBe(true)
    for (const s of SHORTCUT_STEPS) {
      expect(Object.isFrozen(s)).toBe(true)
      if (s.details) expect(Object.isFrozen(s.details)).toBe(true)
    }
  })

  it('names no address, header or field the doc does not name', () => {
    const copy = textOf(SHORTCUT_STEPS)
    const named = copy.match(/https?:\/\/[^\s)`'",]+|\/api\/[\w/.-]+|\b(?:Authorization|Bearer|markdown|detail)\b/g) || []
    expect(named.length).toBeGreaterThan(0)
    for (const n of named) expect(DOC, `the doc never names ${n}`).toContain(n)
    // the Append-to-today's-note address is the one this sheet teaches
    expect(copy).toContain('https://uctintelligence.com/api/j2/personal/daily/append')
  })

  it('names the controls where a member finds them, by the words the cards use', () => {
    const copy = textOf(SHORTCUT_STEPS)
    expect(copy).toContain('Connect apps & shortcuts')
    expect(copy).toContain('Make a token')
    expect(copy).not.toMatch(/\bPersonal API\b/)   // jargon the member never needs
  })

  it('warns that the Shortcut carries the key and must not be shared', () => {
    open()
    const dlg = screen.getByRole('dialog', { name: 'Send notes from your iPhone' })
    expect(dlg.textContent).toMatch(/Never share this Shortcut/)
    expect(dlg.textContent).toMatch(/revoke/i)
  })

  it('"Make a key" links to Settings > Connections and closes the sheet on the way', () => {
    const onClose = open()
    const link = screen.getByRole('link', { name: /Make a key/ })
    expect(link.getAttribute('href')).toBe('/settings?section=connections')
    fireEvent.click(link)
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape closes it', () => {
    const onClose = open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('uses no emoji', () => {
    open()
    expect(screen.getByRole('dialog').textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
