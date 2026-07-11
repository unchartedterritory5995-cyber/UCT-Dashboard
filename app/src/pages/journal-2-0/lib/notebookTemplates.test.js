import { describe, it, expect } from 'vitest'
import { TEMPLATES, containsTableNode, getTemplate } from './notebookTemplates'

describe('notebook templates', () => {
  it('exports exactly the three expected templates', () => {
    expect(TEMPLATES.map((t) => t.key)).toEqual([
      'trade-review',
      'weekly-plan',
      'daily-prep',
    ])
  })

  it('each template has a key, label, and defaultTitle', () => {
    for (const t of TEMPLATES) {
      expect(typeof t.key).toBe('string')
      expect(t.key.length).toBeGreaterThan(0)
      expect(typeof t.label).toBe('string')
      expect(t.label.length).toBeGreaterThan(0)
      expect(typeof t.defaultTitle).toBe('string')
      expect(t.defaultTitle.length).toBeGreaterThan(0)
    }
  })

  it('the three defaultTitles are Trade Review / Weekly Plan / Daily Prep', () => {
    const byKey = Object.fromEntries(TEMPLATES.map((t) => [t.key, t.defaultTitle]))
    expect(byKey['trade-review']).toBe('Trade Review')
    expect(byKey['weekly-plan']).toBe('Weekly Plan')
    expect(byKey['daily-prep']).toBe('Daily Prep')
  })

  it('each build() returns a valid, non-empty TipTap doc', () => {
    for (const t of TEMPLATES) {
      const d = t.build()
      expect(d.type).toBe('doc')
      expect(Array.isArray(d.content)).toBe(true)
      expect(d.content.length).toBeGreaterThan(0)
    }
  })

  it('build() returns a fresh object each call (no shared mutable scaffold)', () => {
    const t = TEMPLATES[0]
    const a = t.build()
    const b = t.build()
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })

  it('contains NO table-family node anywhere in any template (extension-set safe)', () => {
    for (const t of TEMPLATES) {
      expect(containsTableNode(t.build())).toBe(false)
    }
  })

  it('every node in every template uses an allowed StarterKit-family type', () => {
    // Types available from StarterKit + Image/Link/Placeholder/SlashMenu/VideoTimestamp.
    const allowed = new Set([
      'doc',
      'heading',
      'paragraph',
      'text',
      'bulletList',
      'listItem',
      'horizontalRule',
      'blockquote',
      'orderedList',
      'image',
      'hardBreak',
      'codeBlock',
    ])
    const walk = (node) => {
      expect(allowed.has(node.type)).toBe(true)
      for (const child of node.content || []) walk(child)
    }
    for (const t of TEMPLATES) walk(t.build())
  })

  it('text nodes never carry an empty string (invalid ProseMirror text node)', () => {
    const walk = (node) => {
      if (node.type === 'text') {
        expect(typeof node.text).toBe('string')
        expect(node.text.length).toBeGreaterThan(0)
      }
      for (const child of node.content || []) walk(child)
    }
    for (const t of TEMPLATES) walk(t.build())
  })

  it('every heading uses level 2 or 3', () => {
    const walk = (node) => {
      if (node.type === 'heading') {
        expect([2, 3]).toContain(node.attrs?.level)
      }
      for (const child of node.content || []) walk(child)
    }
    for (const t of TEMPLATES) walk(t.build())
  })

  describe('containsTableNode helper', () => {
    it('detects a nested table node', () => {
      expect(
        containsTableNode({
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
            { type: 'table', content: [] },
          ],
        }),
      ).toBe(true)
    })
    it('detects a deeply nested tableCell', () => {
      expect(
        containsTableNode({
          type: 'doc',
          content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [] }] }],
        }),
      ).toBe(true)
    })
    it('returns false for a table-free doc', () => {
      expect(
        containsTableNode({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
        }),
      ).toBe(false)
    })
    it('returns false for null / non-object input', () => {
      expect(containsTableNode(null)).toBe(false)
      expect(containsTableNode(undefined)).toBe(false)
      expect(containsTableNode('table')).toBe(false)
    })
  })

  describe('getTemplate helper', () => {
    it('returns the matching template by key', () => {
      expect(getTemplate('weekly-plan')?.defaultTitle).toBe('Weekly Plan')
    })
    it('returns null for an unknown key', () => {
      expect(getTemplate('nope')).toBeNull()
    })
  })
})
