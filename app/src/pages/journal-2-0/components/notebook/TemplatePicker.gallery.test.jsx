// Wave 10 lane D2 (design finding D-4): the Templates dialog is a browsable gallery.
//
// Every expectation here is DERIVED from the catalog (lib/notebookTemplates.js:
// TEMPLATES / FAMILIES / getTemplate), never typed: a template added tomorrow is
// covered the day it lands, and a card the gallery drops fails by name. The preview
// is checked against the template's own body by an INDEPENDENT walk (every text node
// of `build({})`), so a preview typed by hand -- or taken from the wrong template --
// cannot pass.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TemplatePicker from './TemplatePicker'
import { FAMILIES, TEMPLATES, getTemplate, PREVIEW_LINES } from '../../lib/notebookTemplates'

function renderGallery(props = {}) {
  const onPick = vi.fn()
  render(
    <MemoryRouter>
      <TemplatePicker onPick={onPick} {...props} />
    </MemoryRouter>,
  )
  return { onPick }
}

const card = (tpl) => screen.getByRole('button', { name: tpl.label })

/** Each top-level block of the template's own body, as plain text (independent walk). */
function bodyBlocks(tpl) {
  const text = (n) => (n.type === 'text' ? n.text || '' : (n.content || []).map(text).join(''))
  const out = []
  for (const node of tpl.build({}).content || []) {
    if (node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'taskList') {
      for (const item of node.content || []) out.push(text(item))
    } else {
      out.push(text(node))
    }
  }
  return out.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

describe('D-4 -- the gallery renders every template the source has', () => {
  it('⛔ NON-VACUITY -- the catalog is not empty and every template names a family that exists', () => {
    expect(TEMPLATES.length).toBeGreaterThan(0)
    const famKeys = new Set(FAMILIES.map((f) => f.key))
    for (const tpl of TEMPLATES) expect(famKeys.has(tpl.family), tpl.key).toBe(true)
  })

  it('one card per catalog template -- no more, no fewer, no duplicates', () => {
    renderGallery()
    const keys = [...document.querySelectorAll('[data-template-key]')].map((el) => el.getAttribute('data-template-key'))
    expect(keys.length).toBe(TEMPLATES.length)
    expect(new Set(keys)).toEqual(new Set(TEMPLATES.map((t) => t.key)))
  })

  it("each card sits in its family's group, named by the family label", () => {
    renderGallery()
    for (const fam of FAMILIES) {
      const members = TEMPLATES.filter((t) => t.family === fam.key)
      if (members.length === 0) continue
      const group = screen.getByRole('group', { name: fam.label })
      for (const tpl of members) {
        expect(within(group).getByRole('button', { name: tpl.label })).toBeInTheDocument()
      }
    }
  })

  it('each card shows the name, the one-line description, and a preview of its first lines', () => {
    renderGallery()
    for (const tpl of TEMPLATES) {
      const c = card(tpl)
      expect(c).toHaveTextContent(tpl.label)
      expect(c).toHaveTextContent(tpl.description)
      const preview = c.querySelector('[data-template-preview]')
      expect(preview, tpl.key).not.toBeNull()
      const lines = [...preview.children].map((el) => el.textContent)
      expect(lines.length, tpl.key).toBeGreaterThan(0)
      expect(lines.length, tpl.key).toBeLessThanOrEqual(PREVIEW_LINES)
    }
  })

  it("⛔ each preview line comes from THAT template's own body, in order", () => {
    renderGallery()
    for (const tpl of TEMPLATES) {
      const blocks = bodyBlocks(tpl)
      const lines = [...card(tpl).querySelector('[data-template-preview]').children]
        .map((el) => el.textContent.replace(/^• /, '').replace(/…$/, ''))
      let from = 0
      for (const line of lines) {
        const at = blocks.findIndex((b, i) => i >= from && b.startsWith(line))
        expect(at, `${tpl.key}: "${line}" is not a line of its body`).toBeGreaterThanOrEqual(0)
        from = at + 1
      }
      // ...and it starts where the note starts
      expect(blocks[0].startsWith(lines[0]), tpl.key).toBe(true)
    }
  })

  it('a screen reader hears the name, then the rest as the description', () => {
    renderGallery()
    for (const tpl of TEMPLATES) {
      const c = card(tpl)
      const described = (c.getAttribute('aria-describedby') || '').split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '').join(' ')
      expect(described).toContain(tpl.description)
      expect(described).toContain(tpl.when)
      expect(described).toContain(c.querySelector('[data-template-preview]').textContent)
    }
  })
})

describe('D-4 -- choosing a template creates the same note as before', () => {
  it("every card hands onPick the catalog's OWN template object (createFromTemplate is unchanged)", () => {
    const { onPick } = renderGallery()
    for (const tpl of TEMPLATES) {
      onPick.mockClear()
      fireEvent.click(card(tpl))
      expect(onPick).toHaveBeenCalledTimes(1)
      expect(onPick.mock.calls[0][0]).toBe(getTemplate(tpl.key))
    }
  })

  it('Blank note still picks null', () => {
    const { onPick } = renderGallery()
    fireEvent.click(screen.getByRole('button', { name: /Blank note/ }))
    expect(onPick).toHaveBeenCalledWith(null)
  })
})

describe('D-4 -- keyboard selection', () => {
  const cards = () => [...document.querySelectorAll('[data-template-card]')]

  it('every card is in the Tab order (no roving tabindex hides one)', () => {
    renderGallery()
    for (const c of cards()) expect(c.getAttribute('tabindex')).not.toBe('-1')
  })

  it('arrow keys move between cards; Home and End go to the ends', () => {
    renderGallery()
    const all = cards()
    expect(all.length).toBe(TEMPLATES.length + 2) // Blank + the catalog + the Playbook pointer
    all[0].focus()
    fireEvent.keyDown(all[0], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(all[1])
    fireEvent.keyDown(all[1], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(all[2])
    fireEvent.keyDown(all[2], { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(all[1])
    fireEvent.keyDown(all[1], { key: 'End' })
    expect(document.activeElement).toBe(all[all.length - 1])
    fireEvent.keyDown(all[all.length - 1], { key: 'Home' })
    expect(document.activeElement).toBe(all[0])
    // the ends hold rather than wrap
    fireEvent.keyDown(all[0], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(all[0])
  })

  it('Enter on a focused card picks that template', async () => {
    const user = userEvent.setup()
    const { onPick } = renderGallery()
    const tpl = TEMPLATES[TEMPLATES.length - 1]
    card(tpl).focus()
    await user.keyboard('{Enter}')
    expect(onPick).toHaveBeenCalledWith(getTemplate(tpl.key))
  })

  it('arrows then Space picks the card focus landed on', async () => {
    const user = userEvent.setup()
    const { onPick } = renderGallery()
    const all = cards()
    all[0].focus()
    await user.keyboard('{ArrowRight}{ArrowRight} ')
    const key = all[2].getAttribute('data-template-key')
    expect(onPick).toHaveBeenCalledWith(getTemplate(key))
  })

  it('a disabled gallery (a create in flight) is skipped by the arrows', () => {
    renderGallery({ busy: true })
    const all = cards()
    all[0].focus()
    fireEvent.keyDown(all[0], { key: 'ArrowRight' })
    // every card is disabled: nothing to move to, focus does not jump onto a dead card
    expect(document.activeElement === all[1]).toBe(false)
  })
})
