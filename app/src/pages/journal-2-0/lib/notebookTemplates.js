/**
 * Journal 2.0 — Notebook template library.
 *
 * Three fixed, pre-built TipTap document scaffolds the Notebook seeds a new
 * note with. These are TEMPLATES (static heading/paragraph/bullet scaffolds),
 * NOT a template engine — each `build()` returns a fresh, valid TipTap doc.
 *
 * ⚠️ Extension-set constraint (see lib/tiptap.js `buildExtensions`): the editor
 * runs StarterKit + Image + Link + Placeholder + SlashMenu + VideoTimestamp.
 * StarterKit does NOT include @tiptap/extension-table, so a template MUST NOT
 * contain table/tableRow/tableCell/tableHeader nodes — TipTap silently drops
 * unknown nodes on load, corrupting the doc. Structure is expressed with
 * headings + paragraphs + bullet lists + horizontal rules ONLY.
 */

// ── Node builders (each returns a plain ProseMirror JSON node) ────────────────

/** Heading node (level 2 = section, level 3 = sub-section). */
const h = (level, text) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
})

/**
 * Paragraph node. Empty text ⇒ a truly empty paragraph ({type:'paragraph'})
 * — a text node may never carry an empty string, which would be invalid.
 */
const p = (text) =>
  text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' }

/** Bullet list from an array of plain strings. */
const bullets = (items) => ({
  type: 'bulletList',
  content: items.map((text) => ({
    type: 'listItem',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })),
})

/** Horizontal rule separator. */
const hr = () => ({ type: 'horizontalRule' })

const doc = (content) => ({ type: 'doc', content })

// ── The three templates ───────────────────────────────────────────────────────

export const TEMPLATES = [
  {
    key: 'trade-review',
    label: 'Trade review',
    defaultTitle: 'Trade Review',
    build: () =>
      doc([
        h(2, 'What was the setup?'),
        p('Name the pattern and the market context. Why did this trade earn a place on the sheet?'),
        h(2, 'Entry & thesis'),
        bullets([
          'Entry trigger and price',
          'Stop placement and dollar risk',
          'Target(s) and the plan to manage the position',
        ]),
        hr(),
        h(2, 'What went right'),
        p('What did you execute well — regardless of the outcome?'),
        h(2, 'What went wrong'),
        p('Where did process break down? Be specific and honest.'),
        h(2, 'The lesson'),
        p('One sentence you can carry into the next trade.'),
      ]),
  },
  {
    key: 'weekly-plan',
    label: 'Weekly plan',
    defaultTitle: 'Weekly Plan',
    build: () =>
      doc([
        h(2, 'Market context'),
        p('Regime, breadth, leading themes, and the level of the major indexes going into the week.'),
        h(2, "This week's focus"),
        p('The one or two things you most want to get right this week.'),
        h(2, 'A+ setups to hunt'),
        bullets([
          'Setup / ticker and the trigger you are waiting for',
          'Setup / ticker and the trigger you are waiting for',
          'Setup / ticker and the trigger you are waiting for',
        ]),
        hr(),
        h(2, 'Risk plan'),
        bullets([
          'Max risk per trade',
          'Max open risk / daily loss limit',
          'Position sizing rules for this regime',
        ]),
        h(2, 'Rules I will follow'),
        bullets([
          'Only trade my A+ setups',
          'Wait for the trigger — no anticipating',
          'Honor the stop, every time',
        ]),
      ]),
  },
  {
    key: 'daily-prep',
    label: 'Daily prep',
    defaultTitle: 'Daily Prep',
    build: () =>
      doc([
        h(2, 'Overnight & premarket'),
        p('Futures, notable gaps, news, and earnings that matter for today.'),
        h(2, 'Levels that matter'),
        bullets([
          'Index levels: support / resistance to watch',
          'Ticker + the price level that changes your plan',
        ]),
        hr(),
        h(2, 'My plan'),
        p('If X happens, I do Y. Spell out the scenarios you will actually trade.'),
        h(2, 'Discipline reminders'),
        bullets([
          'Trade the plan, not the P&L',
          'One good trade at a time',
          'Step away if you feel tilted',
        ]),
      ]),
  },
]

/** Node types that the editor's extension set cannot render (no table ext). */
export const TABLE_NODE_TYPES = new Set([
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
])

/**
 * Recursively test whether a TipTap node (or doc) contains any table-family
 * node anywhere in its subtree. Used by tests to guarantee templates stay
 * within the editor's extension set.
 */
export function containsTableNode(node) {
  if (!node || typeof node !== 'object') return false
  if (TABLE_NODE_TYPES.has(node.type)) return true
  return (node.content || []).some(containsTableNode)
}

/** Lookup a template by its stable key. */
export function getTemplate(key) {
  return TEMPLATES.find((t) => t.key === key) || null
}
