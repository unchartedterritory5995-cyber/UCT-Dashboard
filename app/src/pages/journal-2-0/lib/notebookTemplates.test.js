import { describe, it, expect } from 'vitest'
import {
  TEMPLATES,
  FAMILIES,
  containsTableNode,
  getTemplate,
  templatesByFamily,
} from './notebookTemplates'
import { emptyTemplateContext } from './templateContext'

const KEYS = [
  'daily-prep',
  'post-market-debrief',
  'weekly-plan',
  'weekly-review',
  'trade-review',
  'swing-log',
  'earnings-play',
  'tilt-log',
]

// A fully-populated context — templates must stay valid with data present.
const RICH_CTX = {
  ...emptyTemplateContext(),
  regimeLine: 'UPTREND — UCT exposure 95/150',
  positionLines: ['NVDA LONG · in $120.00 · stop $112.00'],
  gamePlanNote: { id: 'n1', title: 'Game Plan — Jul 12', planBullets: ['If SPY holds 560, add'] },
  ticker: 'NVDA',
}

describe('notebook templates catalog', () => {
  it('exports exactly the eight planned templates (stable keys)', () => {
    expect(TEMPLATES.map((t) => t.key)).toEqual(KEYS)
  })

  it('every template is fully described for the picker', () => {
    const familyKeys = new Set(FAMILIES.map((f) => f.key))
    for (const t of TEMPLATES) {
      expect(t.key.length).toBeGreaterThan(0)
      expect(t.label.length).toBeGreaterThan(0)
      expect(familyKeys.has(t.family)).toBe(true)
      expect(t.when.length).toBeGreaterThan(0)
      expect(t.description.length).toBeGreaterThan(0)
      expect(Array.isArray(t.tags) && t.tags.length > 0).toBe(true)
      expect(typeof t.needs).toBe('object')
      expect(typeof t.defaultTitle).toBe('function')
      expect(typeof t.build).toBe('function')
    }
  })

  it('every family has at least one template', () => {
    for (const f of FAMILIES) {
      expect(templatesByFamily(f.key).length).toBeGreaterThan(0)
    }
  })

  it('defaultTitle works bare and reflects a ticker where it should', () => {
    for (const t of TEMPLATES) {
      expect(t.defaultTitle({}).length).toBeGreaterThan(0)
      expect(t.defaultTitle(emptyTemplateContext()).length).toBeGreaterThan(0)
    }
    expect(getTemplate('trade-review').defaultTitle({ ticker: 'NVDA' }))
      .toBe('Trade Post-Mortem — NVDA')
    expect(getTemplate('earnings-play').defaultTitle({ ticker: 'GH' }))
      .toBe('Earnings Play — GH')
    expect(getTemplate('swing-log').defaultTitle({ ticker: 'PL' }))
      .toBe('Swing Log — PL')
  })

  it('every build() returns a valid, non-empty doc from a bare context', () => {
    for (const t of TEMPLATES) {
      const d = t.build({})
      expect(d.type).toBe('doc')
      expect(Array.isArray(d.content)).toBe(true)
      expect(d.content.length).toBeGreaterThan(0)
    }
  })

  it('build() returns a fresh object each call (no shared mutable scaffold)', () => {
    for (const t of TEMPLATES) {
      const a = t.build({})
      const b = t.build({})
      expect(a).not.toBe(b)
      expect(a).toEqual(b)
    }
  })

  it('contains NO table-family node in any template, bare or data-filled', () => {
    for (const t of TEMPLATES) {
      expect(containsTableNode(t.build({}))).toBe(false)
      expect(containsTableNode(t.build(RICH_CTX))).toBe(false)
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
    for (const t of TEMPLATES) {
      walk(t.build({}))
      walk(t.build(RICH_CTX))
    }
  })

  it('text nodes never carry an empty string (invalid ProseMirror text node)', () => {
    const walk = (node) => {
      if (node.type === 'text') {
        expect(typeof node.text).toBe('string')
        expect(node.text.length).toBeGreaterThan(0)
      }
      for (const child of node.content || []) walk(child)
    }
    for (const t of TEMPLATES) {
      walk(t.build({}))
      walk(t.build(RICH_CTX))
    }
  })

  it('every heading uses level 2 or 3', () => {
    const walk = (node) => {
      if (node.type === 'heading') {
        expect([2, 3]).toContain(node.attrs?.level)
      }
      for (const child of node.content || []) walk(child)
    }
    for (const t of TEMPLATES) walk(t.build(RICH_CTX))
  })

  it('daily game plan pre-fills regime + open positions, and omits them bare', () => {
    const filled = JSON.stringify(getTemplate('daily-prep').build(RICH_CTX))
    expect(filled).toContain('UPTREND — UCT exposure 95/150')
    expect(filled).toContain('Open positions')
    expect(filled).toContain('NVDA LONG')
    expect(JSON.stringify(getTemplate('daily-prep').build({}))).not.toContain('Open positions')
  })

  it('post-market debrief quotes and links the morning game plan (the grading loop)', () => {
    const flat = JSON.stringify(getTemplate('post-market-debrief').build(RICH_CTX))
    expect(flat).toContain('The morning plan said')
    expect(flat).toContain('If SPY holds 560, add')
    expect(flat).toContain('/journal/journal?seg=notebook&note=n1')
    const bare = JSON.stringify(getTemplate('post-market-debrief').build({}))
    expect(bare).toContain('No game plan found')
    expect(bare).not.toContain('seg=notebook&note=')
  })

  it('getTemplate resolves stable keys and rejects unknowns', () => {
    expect(getTemplate('daily-prep').label).toBe('Daily Game Plan')
    expect(getTemplate('trade-review').label).toBe('Trade Post-Mortem')
    expect(getTemplate('nope')).toBeNull()
  })

  describe('containsTableNode helper', () => {
    it('detects a table anywhere in a subtree', () => {
      expect(containsTableNode({
        type: 'doc',
        content: [{ type: 'bulletList', content: [{ type: 'tableRow' }] }],
      })).toBe(true)
    })
    it('passes clean docs and garbage input', () => {
      expect(containsTableNode({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(false)
      expect(containsTableNode(null)).toBe(false)
    })
  })
})
