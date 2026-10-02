import { describe, it, expect } from 'vitest'
import {
  TEMPLATES,
  FAMILIES,
  PREVIEW_LINES,
  STRUCTURE_PROBE_CONTEXT,
  getTemplate,
  templatesByFamily,
  templatePreview,
  templateStructure,
} from './notebookTemplates'
import { WALKTHROUGH_TITLE, isWalkthroughNode, table, toggle } from './templateBlocks'
import { NOTEBOOK_TYPE_SCHEMA } from './notebookSchema'
import { editorSchema } from './tiptap'
import { emptyTemplateContext } from './templateContext'

const KEYS = [
  'daily-prep',
  'post-market-debrief',
  'weekly-plan',
  'weekly-review',
  'monthly-review',
  'quarterly-review',
  'thesis',
  'sector-theme-research',
  'sector-note',
  'watchlist-thesis',
  'catalyst-tracker',
  'earnings-prep',
  'ipo-notes',
  'meeting-notes',
  'trade-review',
  'swing-log',
  'earnings-play',
  'trade-plan',
  'breakout-plan',
  'pullback-plan',
  'episodic-pivot-plan',
  'undercut-rally-plan',
  'parabolic-short-plan',
  'position-sizing-worksheet',
  'position-tracker',
  'setup-playbook-entry',
  'options-trade-plan',
  'risk-checklist',
  'mistake-log',
  'lessons-learned',
  'goals',
  'drawdown-recovery-plan',
  'tilt-log',
]

// Wave 12 lane 12B: the owner's list (docs/notebook/WAVE-12-PLAN.md §2.3) -- one trade plan
// per setup family, an earnings-prep note and a sector note.
const SETUP_PLAN_KEYS = [
  'breakout-plan',
  'pullback-plan',
  'episodic-pivot-plan',
  'undercut-rally-plan',
  'parabolic-short-plan',
]
const WAVE12_NEW_KEYS = [...SETUP_PLAN_KEYS, 'earnings-prep', 'sector-note']

// A fully-populated context — templates must stay valid with data present.
const RICH_CTX = {
  ...emptyTemplateContext(),
  regimeLine: 'UPTREND — UCT exposure 95/150',
  positionLines: ['NVDA LONG · in $120.00 · stop $112.00'],
  gamePlanNote: { id: 'n1', title: 'Game Plan — Jul 12', planBullets: ['If SPY holds 560, add'] },
  ticker: 'NVDA',
}

const CONTEXTS = [['bare', {}], ['rich', RICH_CTX]]

/** Every node in a subtree, depth first. */
function walkNodes(node, out = []) {
  if (!node || typeof node !== 'object') return out
  out.push(node)
  for (const child of node.content || []) walkNodes(child, out)
  return out
}

const textOf = (n) => (n?.type === 'text' ? n.text || '' : (n?.content || []).map(textOf).join(''))

describe('notebook templates catalog', () => {
  it('exports exactly the built-in catalog, in order (stable keys, wave 12 lane 12B depth)', () => {
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

  it('keys and labels are unique', () => {
    expect(new Set(TEMPLATES.map((t) => t.key)).size).toBe(TEMPLATES.length)
    expect(new Set(TEMPLATES.map((t) => t.label)).size).toBe(TEMPLATES.length)
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
    expect(getTemplate('breakout-plan').defaultTitle({ ticker: 'NVDA' })).toBe('Breakout Plan — NVDA')
    expect(getTemplate('earnings-prep').defaultTitle({ ticker: 'GH' })).toBe('Earnings Prep — GH')
    expect(getTemplate('sector-note').defaultTitle({ ticker: 'SMH' })).toBe('Sector Note — SMH')
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

  it('text nodes never carry an empty string (invalid ProseMirror text node)', () => {
    for (const t of TEMPLATES) {
      for (const [, ctx] of CONTEXTS) {
        for (const node of walkNodes(t.build(ctx))) {
          if (node.type !== 'text') continue
          expect(typeof node.text).toBe('string')
          expect(node.text.length, t.key).toBeGreaterThan(0)
        }
      }
    }
  })

  it('every heading uses level 2 or 3', () => {
    for (const t of TEMPLATES) {
      for (const node of walkNodes(t.build(RICH_CTX))) {
        if (node.type === 'heading') expect([2, 3]).toContain(node.attrs?.level)
      }
    }
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
    expect(flat).toContain('/journal/notebook?note=n1')
    const bare = JSON.stringify(getTemplate('post-market-debrief').build({}))
    expect(bare).toContain('No game plan found')
    expect(bare).not.toContain('note=n1')
  })

  it('getTemplate resolves stable keys and rejects unknowns', () => {
    expect(getTemplate('daily-prep').label).toBe('Daily Game Plan')
    expect(getTemplate('trade-review').label).toBe('Trade Post-Mortem')
    expect(getTemplate('nope')).toBeNull()
  })

  it('the thesis template never writes a direction into its body (checkpoint §47 -- direction lives in the Research Type property)', () => {
    const flat = JSON.stringify(getTemplate('thesis').build(RICH_CTX)).toLowerCase()
    expect(flat).not.toContain('long thesis')
    expect(flat).not.toContain('short thesis')
    expect(flat).toContain('bull case')
    expect(flat).toContain('bear case')
    expect(flat).toContain('what would prove me wrong')
  })

  it('the thesis template carries the legacy thesis tag (checkpoint §4 dual recognition)', () => {
    expect(getTemplate('thesis').tags).toContain('thesis')
  })
})

// ── Wave 12 lane 12B: node types are DERIVED from the schema table ────────────

describe('12B -- every type a template builds is in the Notebook schema table', () => {
  // ⚰️ This replaced `containsTableNode` (and a typed "StarterKit-family" list). The editor
  // has registered tables, callouts and toggles since wave 6; the allowed set is now the
  // schema table itself (lib/notebookSchema.js), so a type added there tomorrow is allowed
  // the day it lands, and a type that is not there fails by name.
  const known = new Set(Object.keys(NOTEBOOK_TYPE_SCHEMA))
  const unknownTypes = (doc) => {
    const bad = []
    for (const node of walkNodes(doc)) {
      if (!known.has(node.type)) bad.push(node.type)
      for (const m of node.marks || []) if (!known.has(m.type)) bad.push(`mark:${m.type}`)
    }
    return bad
  }

  it('every node and mark type, bare and data-filled, is a key of NOTEBOOK_TYPE_SCHEMA', () => {
    const failures = []
    for (const t of TEMPLATES) {
      for (const [label, ctx] of CONTEXTS) {
        for (const bad of unknownTypes(t.build(ctx))) failures.push(`${t.key} (${label}): ${bad}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('NON-VACUITY -- the catalog really builds the types the old rule forbade', () => {
    const used = new Set(TEMPLATES.flatMap((t) => walkNodes(t.build({})).map((n) => n.type)))
    for (const type of ['table', 'tableRow', 'tableHeader', 'tableCell', 'toggle', 'toggleSummary', 'toggleContent', 'callout', 'orderedList']) {
      expect(used.has(type), type).toBe(true)
    }
  })

  it('CONTROL -- the check names a type the table does not hold', () => {
    expect(unknownTypes({ type: 'doc', content: [{ type: 'notANotebookNode' }] })).toEqual(['notANotebookNode'])
    expect(unknownTypes({ type: 'doc', content: [{ type: 'text', text: 'x', marks: [{ type: 'notAMark' }] }] }))
      .toEqual(['mark:notAMark'])
  })

  it('the real editor schema builds every template, bare AND with the rich context', () => {
    const schema = editorSchema()
    const failures = []
    for (const t of TEMPLATES) {
      for (const [label, ctx] of CONTEXTS) {
        try {
          schema.nodeFromJSON(t.build(ctx)).check()
        } catch (e) {
          failures.push(`${t.key} (${label}): ${e.message}`)
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('every table has a header row first and rows of one width (never ragged)', () => {
    let tables = 0
    for (const t of TEMPLATES) {
      for (const node of walkNodes(t.build({}))) {
        if (node.type !== 'table') continue
        tables += 1
        const rows = node.content || []
        expect(rows.length, t.key).toBeGreaterThan(1)
        expect(rows[0].content.every((c) => c.type === 'tableHeader'), t.key).toBe(true)
        for (const r of rows.slice(1)) expect(r.content.every((c) => c.type === 'tableCell'), t.key).toBe(true)
        expect(new Set(rows.map((r) => r.content.length)).size, t.key).toBe(1)
      }
    }
    expect(tables).toBeGreaterThan(0)
  })

  it('the table builder pads a short row to the header width', () => {
    const tbl = table(['A', 'B', 'C'], [['x']])
    expect(tbl.content.map((r) => r.content.length)).toEqual([3, 3])
    expect(textOf(tbl.content[1])).toBe('x')
  })
})

// ── Wave 12 lane 12B: the walkthrough ─────────────────────────────────────────

describe('12B -- every template carries a walkthrough, and the preview never shows it', () => {
  it('every template has 3-5 short walkthrough steps, as data on its catalog entry', () => {
    for (const t of TEMPLATES) {
      expect(Array.isArray(t.walkthrough), t.key).toBe(true)
      expect(t.walkthrough.length, t.key).toBeGreaterThanOrEqual(3)
      expect(t.walkthrough.length, t.key).toBeLessThanOrEqual(5)
      for (const step of t.walkthrough) {
        expect(typeof step, t.key).toBe('string')
        expect(step.trim().length, t.key).toBeGreaterThan(0)
        expect(step.length, `${t.key}: "${step}" is not short`).toBeLessThanOrEqual(140)
      }
    }
  })

  it('the body ENDS in exactly one collapsed "How to use this template" toggle holding those steps', () => {
    for (const t of TEMPLATES) {
      for (const [label, ctx] of CONTEXTS) {
        const top = t.build(ctx).content
        const last = top[top.length - 1]
        expect(isWalkthroughNode(last), `${t.key} (${label})`).toBe(true)
        expect(last.attrs.open, `${t.key} (${label}) must be collapsed`).toBe(false)
        expect(top.filter(isWalkthroughNode).length, `${t.key} (${label})`).toBe(1)
        expect(textOf(last.content[0])).toBe(WALKTHROUGH_TITLE)
        const list = last.content[1].content[0]
        expect(list.type).toBe('orderedList')
        expect(list.content.map(textOf), `${t.key}: the toggle renders its own data`).toEqual(t.walkthrough)
      }
    }
  })

  it('⛔ templateStructure never includes the walkthrough toggle', () => {
    for (const t of TEMPLATES) {
      expect(templateStructure(t).some(isWalkthroughNode), t.key).toBe(false)
    }
  })

  it('⛔ the preview never shows the walkthrough -- not its title, not a step -- even with no line limit', () => {
    for (const t of TEMPLATES) {
      // NON-VACUITY: the body this preview is drawn from really does hold the walkthrough
      const body = JSON.stringify(t.build({}))
      expect(body, t.key).toContain(WALKTHROUGH_TITLE)
      const all = templatePreview(t, Infinity).map((l) => l.text)
      expect(all.length, `${t.key} previews nothing`).toBeGreaterThan(0)
      for (const line of all) {
        expect(line, t.key).not.toContain(WALKTHROUGH_TITLE)
        // A body heading may legitimately share words with a step ("Edge by setup"), so a
        // whole line is compared whole, and only a CLIPPED line is compared as a prefix.
        const clipped = line.endsWith('…')
        const stem = line.replace(/…$/, '')
        for (const step of t.walkthrough) {
          const hit = clipped ? step.startsWith(stem) : step === line
          expect(hit, `${t.key}: "${line}" is a walkthrough step`).toBe(false)
        }
      }
      expect(templatePreview(t).length, t.key).toBeLessThanOrEqual(PREVIEW_LINES)
    }
  })

  it('only the walkthrough is skipped: another toggle is not mistaken for it', () => {
    expect(isWalkthroughNode(toggle('Something else', []))).toBe(false)
    expect(isWalkthroughNode(toggle(WALKTHROUGH_TITLE, []))).toBe(true)
    expect(isWalkthroughNode({ type: 'paragraph', content: [{ type: 'text', text: WALKTHROUGH_TITLE }] })).toBe(false)
    expect(isWalkthroughNode(null)).toBe(false)
  })

  it('the preview skips a table rather than running its cells together', () => {
    for (const t of TEMPLATES) {
      for (const line of templatePreview(t, Infinity)) {
        expect(line.text, t.key).not.toMatch(/PlanActual|EstimateA year ago|ValueWhy there/)
      }
    }
  })
})

// ── Wave 12 lane 12B: the deeper library ──────────────────────────────────────

describe('12B -- the owner\'s list is in the catalog', () => {
  it('one trade plan per setup family, in the trades family, each with the regime line and the numbers table', () => {
    for (const key of SETUP_PLAN_KEYS) {
      const t = getTemplate(key)
      expect(t, key).toBeTruthy()
      expect(t.family).toBe('trades')
      expect(t.needs.regime).toBe(true)
      const filled = t.build(RICH_CTX)
      expect(JSON.stringify(filled)).toContain('UPTREND — UCT exposure 95/150')
      expect(walkNodes(filled).some((n) => n.type === 'table'), key).toBe(true)
      expect(walkNodes(filled).some((n) => n.type === 'callout'), key).toBe(true)
      expect(JSON.stringify(t.build({}))).toContain('Regime:')
    }
  })

  it('the setup plans are distinct plans, not one body under five names', () => {
    const setups = SETUP_PLAN_KEYS.map((k) => textOf(getTemplate(k).build({}).content[2]))
    expect(new Set(setups).size).toBe(SETUP_PLAN_KEYS.length)
  })

  it('earnings prep and the sector note are research notes with tables', () => {
    for (const key of ['earnings-prep', 'sector-note']) {
      const t = getTemplate(key)
      expect(t.family).toBe('research')
      expect(walkNodes(t.build({})).some((n) => n.type === 'table'), key).toBe(true)
    }
  })

  it('the deepened post-mortem and reviews keep their keys and gain the tables', () => {
    for (const key of ['trade-review', 'weekly-review', 'monthly-review']) {
      expect(walkNodes(getTemplate(key).build({})).some((n) => n.type === 'table'), key).toBe(true)
    }
    expect(getTemplate('trade-review').label).toBe('Trade Post-Mortem')
    expect(getTemplate('weekly-review').label).toBe('Weekly Review')
    expect(getTemplate('monthly-review').label).toBe('Monthly Review')
    // the post-mortem still starts where it always did, so its card preview is unchanged
    expect(textOf(getTemplate('trade-review').build({}).content[0])).toBe('What was the setup?')
  })

  it('every new key is deep-linkable through getTemplate', () => {
    for (const key of WAVE12_NEW_KEYS) expect(getTemplate(key)?.key).toBe(key)
  })

  it('no new template reads a context field the probe context lacks', () => {
    for (const key of WAVE12_NEW_KEYS) {
      const read = new Set()
      getTemplate(key).build(new Proxy({}, { get: (_, k) => { read.add(k); return undefined } }))
      for (const k of read) if (typeof k === 'string') expect(STRUCTURE_PROBE_CONTEXT, `${key} reads ctx.${k}`).toHaveProperty(k)
    }
  })
})
