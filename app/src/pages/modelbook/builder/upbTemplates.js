/**
 * My Playbook — entry template library.
 *
 * Pre-built TipTap document scaffolds the "+ New entry" template picker seeds
 * an entry with. Mirrors the Notebook's notebookTemplates.js pattern: each
 * `doc()` returns a fresh, valid TipTap doc built from plain nodes.
 *
 * ⚠️ Extension-set constraint (see journal-2-0/lib/tiptap.js buildExtensions):
 * the editor runs StarterKit + Image + Link + Placeholder + SlashMenu +
 * VideoTimestamp. StarterKit does NOT include @tiptap/extension-table, so a
 * template MUST NOT contain table-family nodes — TipTap silently drops unknown
 * nodes on load, corrupting the doc. Structure here is headings + empty
 * paragraphs ONLY (the user writes under each heading).
 */

// ── Node builders (each returns a plain ProseMirror JSON node) ────────────────

/** Heading node (level 2 = section). */
const h = (level, text) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
})

/** A truly empty paragraph — a text node may never carry an empty string. */
const p = () => ({ type: 'paragraph' })

const doc = (content) => ({ type: 'doc', content })

/** Section = heading + an empty paragraph to write into. */
const sections = (titles) => doc(titles.flatMap((t) => [h(2, t), p()]))

// ── The three templates ───────────────────────────────────────────────────────

export const TEMPLATES = [
  {
    key: 'blank',
    label: 'Blank',
    description: 'An empty page — structure it your way.',
    doc: () => doc([p()]),
  },
  {
    key: 'setup-definition',
    label: 'Setup definition',
    description: 'Define a setup you trade — criteria, risk, and the traps.',
    doc: () =>
      sections([
        'What it is',
        'When I trade this',
        'Entry criteria',
        'Stop & target',
        'Common mistakes',
      ]),
  },
  {
    key: 'trade-recipe',
    label: 'Trade recipe',
    description: 'A step-by-step play, from context to exit.',
    doc: () =>
      sections([
        'Context',
        'Trigger',
        'Entry',
        'Management',
        'Exit',
      ]),
  },
]

/** Lookup a template by its stable key. */
export function getTemplate(key) {
  return TEMPLATES.find((t) => t.key === key) || null
}
