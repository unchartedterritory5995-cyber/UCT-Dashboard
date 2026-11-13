// Tier 2 fix round 1 (review Important 4): on a phone's empty notebook the kind picker's loading line (21 px) was
// replaced by its 1,055 px section above the template gallery -- a layout shift of 0.2257 (measured on production,
// 390 x 844). While loading, the section is drawn at its SETTLED shape: the same heading, the library door's slot, and
// one card per built-in kind with the same boxes (the same classes, the same elements). jsdom lays nothing out, so
// the rail compares the STRUCTURE the browser sizes: the element tree, tag by tag and class by class, of the loading
// state against the loaded state for a member with only the built-in kinds.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { BUILTIN_NOTE_KINDS } from '../../../lib/noteKinds'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../lib/offline/notebookFlags'
import KindSection from './KindSection'

const listBody = {
  kinds: BUILTIN_NOTE_KINDS.map((k) => ({ ...k, builtin: true })),
  styles: BUILTIN_NOTE_KINDS.map((k) => ({ id: `builtin:${k.id}`, name: `${k.name} (starter)`, kindId: k.id,
    builtin: true, isDefault: true, version: 1, outlineTemplateId: null, hasOutline: true, blocks: [], properties: {} })),
  blockKinds: [],
}

/** The boxes the browser sizes: every element's tag and class, in order (sr-only, hidden and status lines skipped). */
function shape(root) {
  return [...root.querySelectorAll('*')]
    .filter((el) => !el.closest('.sr-only') && el.getAttribute('role') !== 'status' && el.tagName !== 'svg' && !el.closest('svg'))
    .map((el) => `${el.tagName}.${el.getAttribute('class') || ''}`)
}

let release
beforeEach(() => latchNotebookFlags({ notebook_journal_styles_enabled: true, notebook_style_library_enabled: true }))
afterEach(() => { vi.restoreAllMocks(); __resetNotebookFlags() })

describe('KindSection loads at its settled shape (CLS)', () => {
  it('loading and loaded have the same boxes: heading, library door, one card per built-in kind', async () => {
    const gate = new Promise((r) => { release = r })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { await gate; return { ok: true, status: 200, json: async () => listBody } })
    const { container } = render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <KindSection onCreate={() => {}} />
    </SWRConfig>)
    const loading = container.querySelector('[data-kind-section-loading]')
    expect(loading, 'the loading state is the section').not.toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Loading note types…')
    expect(loading.querySelectorAll('[data-kind-placeholder]').length).toBe(BUILTIN_NOTE_KINDS.length)
    const before = shape(loading)
    release()
    await screen.findByRole('group', { name: 'Start from a template' })
    const loaded = container.querySelector('section')
    expect(loaded.hasAttribute('data-kind-section-loading')).toBe(false)
    expect(shape(loaded)).toEqual(before)
  })

  it('nothing in the loading state can be pressed or reached by Tab', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))
    const { container } = render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <KindSection onCreate={() => {}} />
    </SWRConfig>)
    const buttons = [...container.querySelectorAll('[data-kind-section-loading] button')]
    expect(buttons.length).toBeGreaterThan(BUILTIN_NOTE_KINDS.length)
    for (const b of buttons) { expect(b.disabled).toBe(true); expect(b.tabIndex).toBe(-1) }
  })
})
