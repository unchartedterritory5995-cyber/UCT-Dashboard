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

// ── Node builders — shared with the Notebook's template catalog ───────────────

import { p, doc, sections } from '../../../lib/tiptapDocBuilders'

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
