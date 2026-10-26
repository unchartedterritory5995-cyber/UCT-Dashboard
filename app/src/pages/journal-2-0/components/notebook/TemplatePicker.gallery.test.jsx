// Wave 10 lane D2 (design finding D-4): the Templates dialog is a browsable gallery.
//
// Every expectation here is DERIVED from the catalog (lib/notebookTemplates.js:
// TEMPLATES / FAMILIES / getTemplate), never typed: a template added tomorrow is
// covered the day it lands, and a card the gallery drops fails by name. The preview
// is checked against the template's own body by an INDEPENDENT walk (every text node
// of `build({})`), so a preview typed by hand -- or taken from the wrong template --
// cannot pass.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TemplatePicker from './TemplatePicker'
import { loadTemplates } from '../../lib/templatesLoader'

// Wave 7 Task 7.4: the picker reads the catalog through the loader (no static import). Loaded once up front, the
// picker renders synchronously, as it does on the page once the catalog has arrived.
beforeAll(() => loadTemplates())
import {
  FAMILIES, TEMPLATES, getTemplate, PREVIEW_LINES, STRUCTURE_PROBE_CONTEXT,
} from '../../lib/notebookTemplates'
import { emptyTemplateContext } from '../../lib/templateContext'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

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

const text = (n) => (n.type === 'text' ? n.text || '' : (n.content || []).map(text).join(''))
const norm = (t) => t.replace(/\s+/g, ' ').trim()

/** Fix round 1 (M-2): the text of every block ONLY the no-data branch writes -- in
 *  `build({})`, but not identically in the build with every data field present.
 *  Derived from the source every run, never a typed list of sentences. */
function noDataTexts(tpl) {
  const withData = new Set((tpl.build(STRUCTURE_PROBE_CONTEXT).content || []).map((n) => JSON.stringify(n)))
  const out = []
  for (const n of tpl.build({}).content || []) {
    if (withData.has(JSON.stringify(n))) continue
    const items = n.type === 'bulletList' ? (n.content || []) : [n]
    for (const it of items) {
      const t = norm(text(it))
      if (t) out.push(t)
    }
  }
  return out
}

/** A card's preview lines as rendered, marker and ellipsis stripped ([] = no preview). */
function previewLines(tpl) {
  const el = card(tpl).querySelector('[data-template-preview]')
  return el ? [...el.children].map((c) => c.textContent.replace(/^• /, '').replace(/…$/, '')) : []
}

/** Each top-level block of the template's own body, as plain text (independent walk). */
function bodyBlocks(tpl) {
  const out = []
  for (const node of tpl.build({}).content || []) {
    if (node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'taskList') {
      for (const item of node.content || []) out.push(text(item))
    } else {
      out.push(text(node))
    }
  }
  return out.map(norm).filter(Boolean)
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
      // a template with no structure line shows its description alone -- never an empty box
      const preview = c.querySelector('[data-template-preview]')
      if (preview) {
        const lines = [...preview.children].map((el) => el.textContent)
        expect(lines.length, tpl.key).toBeGreaterThan(0)
        expect(lines.length, tpl.key).toBeLessThanOrEqual(PREVIEW_LINES)
      }
    }
  })

  it("⛔ each preview line comes from THAT template's own body, in order", () => {
    renderGallery()
    for (const tpl of TEMPLATES) {
      const blocks = bodyBlocks(tpl)
      const lines = previewLines(tpl)
      let from = 0
      for (const line of lines) {
        const at = blocks.findIndex((b, i) => i >= from && b.startsWith(line))
        expect(at, `${tpl.key}: "${line}" is not a line of its body`).toBeGreaterThanOrEqual(0)
        from = at + 1
      }
    }
  })

  it('⛔ M-2 -- no preview, on any template, shows a no-data sentence', () => {
    renderGallery()
    const all = TEMPLATES.flatMap(noDataTexts)
    // NON-VACUITY: the catalog really has a no-data branch, and the known ones are in the set
    expect(all.some((t) => t.startsWith('No game plan found for today'))).toBe(true)
    expect(all).toContain('Regime: —')
    for (const tpl of TEMPLATES) {
      const scaffold = noDataTexts(tpl)
      for (const line of previewLines(tpl)) {
        expect(scaffold.some((t) => t.startsWith(line)), `${tpl.key}: "${line}" is a no-data sentence`).toBe(false)
      }
    }
    // ...and every card still previews its structure
    expect(TEMPLATES.filter((t) => previewLines(t).length === 0).map((t) => t.key)).toEqual([])
  })

  it('M-2 -- the probe context has the real context shape and covers every field a template reads', () => {
    expect(Object.keys(STRUCTURE_PROBE_CONTEXT).sort()).toEqual(Object.keys(emptyTemplateContext()).sort())
    const read = new Set()
    const nested = new Set()
    for (const tpl of TEMPLATES) {
      tpl.build(new Proxy({}, { get: (_, k) => { read.add(k); return undefined } }))
      const gp = new Proxy({}, { get: (_, k) => { nested.add(k); return undefined } })
      tpl.build(new Proxy({}, { get: (_, k) => (k === 'gamePlanNote' ? gp : undefined) }))
    }
    expect(read.size).toBeGreaterThan(0)
    for (const k of read) if (typeof k === 'string') expect(STRUCTURE_PROBE_CONTEXT, `ctx.${k}`).toHaveProperty(k)
    for (const k of nested) if (typeof k === 'string') expect(STRUCTURE_PROBE_CONTEXT.gamePlanNote, `gamePlanNote.${k}`).toHaveProperty(k)
  })

  it('⛔ M-3 -- a screen reader hears the name, then the "when" line and the description ONLY', () => {
    renderGallery()
    for (const tpl of TEMPLATES) {
      const c = card(tpl)
      const ids = (c.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
      expect(ids.map((id) => document.getElementById(id)?.textContent || ''), tpl.key)
        .toEqual([tpl.when, tpl.description])
      // the preview is visual: hidden from assistive tech, and not what describes the card
      const preview = c.querySelector('[data-template-preview]')
      if (preview) {
        expect(preview).toHaveAttribute('aria-hidden', 'true')
        for (const id of ids) expect(preview.contains(document.getElementById(id))).toBe(false)
      }
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

  it('⛔ M-4 -- the arrows SKIP a disabled card to the next enabled one (and End skips a disabled last)', () => {
    renderGallery()
    const all = cards()
    // A MIX of enabled and disabled cards. jsdom will not focus a disabled button, so
    // arrows that computed a disabled card as the target would leave focus where it
    // started -- and these assertions go red.
    all[1].disabled = true
    all[all.length - 1].disabled = true
    all[0].focus()
    fireEvent.keyDown(all[0], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(all[2])
    fireEvent.keyDown(all[2], { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(all[0])
    fireEvent.keyDown(all[0], { key: 'End' })
    expect(document.activeElement).toBe(all[all.length - 2])
  })
})

// Notebook widgets wave 11 (Task 11.16): the Template library section sits between Blank and "Your templates" while
// wave 11 is on. These rails hold the picker to "additive only": with wave 11 off its chunk is never asked for and
// nothing renders; with it on, every keyboard rail above still holds over the SAME cards (the library's cards are not
// picker cards), and the search box's Enter still picks a built-in template.
describe('Task 11.16 -- the Template library section (wave 11)', () => {
  const LIB_ID = 'g-lib-1'
  let fetched
  beforeEach(() => {
    fetched = []
    const row = { id: LIB_ID, title: `${TEMPLATES[0].label} from the library`, description: 'From the library',
      group: 'before_open', category: 'journal', itemType: 'style', usedBy: 0, contains: [], inYourTemplates: false }
    globalThis.fetch = vi.fn(async (url) => {
      fetched.push(String(url))
      if (String(url).endsWith('/template-gallery/library')) return { ok: true, status: 200, json: async () => ({ templates: [row] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    })
  })
  afterEach(() => { __resetNotebookFlags() })

  const cards = () => [...document.querySelectorAll('[data-template-card]')]
  const buttonNames = (outside) => [...document.querySelectorAll('button')]
    .filter((b) => !outside || !b.closest('[data-template-library]'))
    .map((b) => b.getAttribute('aria-label') || b.textContent)
  const libraryCard = () => document.querySelector(`[data-library-card="${LIB_ID}"]`)

  it('picker_unchanged_when_w11_off', async () => {
    // The section's chunk is loaded up front, so a section that rendered while wave 11 is off would have mounted and
    // asked for the library well inside the wait below (the mutation that drops the gate goes red here).
    await import('./library/TemplateLibrarySection')
    renderGallery()
    await act(async () => { await new Promise((r) => setTimeout(r, 150)) })
    const off = buttonNames(false)
    expect(document.querySelector('[data-template-library]')).toBeNull()
    expect(screen.queryByText('Template library')).toBeNull()
    expect(fetched).toEqual([])
    cleanup()

    // CONTROL: the same picker with wave 11 on DOES draw the section, and outside it every button is the same, in order.
    latchNotebookFlags({ notebook_widgets_w11_enabled: true })
    renderGallery()
    await waitForLibrary()
    expect(fetched.filter((u) => u.endsWith('/template-gallery/library'))).toHaveLength(1)
    expect(buttonNames(true)).toEqual(off)
    expect(buttonNames(false).length).toBeGreaterThan(off.length)
  })

  async function waitForLibrary() {
    await screen.findByRole('heading', { name: 'Template library' })
    await vi.waitFor(() => expect(libraryCard()).not.toBeNull())
  }

  it('existing_card_keyboard_rails_green', async () => {
    latchNotebookFlags({ notebook_widgets_w11_enabled: true })
    const user = userEvent.setup()
    const { onPick } = renderGallery()
    await waitForLibrary()
    const all = cards()
    expect(all.length).toBe(TEMPLATES.length + 2)
    expect(libraryCard().querySelector('[data-template-card]')).toBeNull()
    // Between Blank and the rest, as the plan places it.
    const section = document.querySelector('[data-template-library]')
    expect(all[0].compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(section.compareDocumentPosition(all[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const c of all) expect(c.getAttribute('tabindex')).not.toBe('-1')
    // The arrows still walk the picker's cards only: Blank -> the first catalog card, past the library.
    all[0].focus()
    fireEvent.keyDown(all[0], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(all[1])
    fireEvent.keyDown(all[1], { key: 'End' })
    expect(document.activeElement).toBe(all[all.length - 1])
    fireEvent.keyDown(all[all.length - 1], { key: 'Home' })
    expect(document.activeElement).toBe(all[0])
    // A key on a library control moves nothing.
    const libPreview = within(libraryCard()).getByRole('button', { name: /^Preview / })
    libPreview.focus()
    fireEvent.keyDown(libPreview, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(libPreview)
    // The search box's Enter picks the first matching BUILT-IN card, although a library card matches too.
    const box = screen.getByRole('searchbox', { name: 'Search templates' })
    await user.type(box, TEMPLATES[0].label)
    expect(libraryCard()).not.toBeNull()
    await user.keyboard('{Enter}')
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(TEMPLATES.map((t) => t.key)).toContain(onPick.mock.calls[0][0]?.key)
  })
})
