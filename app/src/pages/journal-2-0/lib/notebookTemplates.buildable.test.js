// Wave 10 lane DR-C (design finding D-4, breadth): every built-in template's
// body must be BUILDABLE BY THE REAL EDITOR SCHEMA, not merely "uses known
// type names" -- ProseMirror's `Schema.nodeFromJSON` is the exact call TipTap
// makes when it opens a stored document (H14: one node it cannot build and
// the note opens EMPTY, see lib/notebookSchema.js). This runs that call
// directly against `editorSchema()` (lib/tiptap.js's real, live schema --
// StarterKit + every custom node/mark the Notebook registers), for every
// template, bare AND with the probe context filled, so a future template that
// reaches for a node type this bundle cannot render fails HERE, at the
// cheapest possible layer, rather than as a failed `POST /api/j2/notes`
// (tests/test_notebook_builtin_templates_create.py is the create-path half of
// this same guarantee, on the Python side of the door).
import { describe, it, expect } from 'vitest'
import { TEMPLATES, STRUCTURE_PROBE_CONTEXT } from './notebookTemplates'
import { editorSchema } from './tiptap'

describe('D-4 -- every built-in template is buildable by the real editor schema', () => {
  const schema = editorSchema()

  it('non-vacuity: the schema really knows the node types these templates use', () => {
    for (const name of ['doc', 'heading', 'paragraph', 'bulletList', 'listItem', 'horizontalRule']) {
      expect(schema.nodes[name], name).toBeTruthy()
    }
    expect(schema.marks.bold).toBeTruthy()
    expect(schema.marks.link).toBeTruthy()
  })

  it('`schema.nodeFromJSON` accepts every template, bare and data-filled', () => {
    const failures = []
    for (const tpl of TEMPLATES) {
      for (const [label, ctx] of [['bare', {}], ['data-filled', STRUCTURE_PROBE_CONTEXT]]) {
        try {
          const node = schema.nodeFromJSON(tpl.build(ctx))
          node.check() // ProseMirror's own structural validity check
        } catch (e) {
          failures.push(`${tpl.key} (${label}): ${e.message}`)
        }
      }
    }
    expect(failures).toEqual([])
  })

  // CONTROL: the check above can fail -- an empty text node (the exact H14
  // shape) is rejected by the real schema, the same way it would be rejected
  // if a template shipped one.
  it('CONTROL: the check rejects a body the real editor cannot open', () => {
    const bad = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }] }
    expect(() => schema.nodeFromJSON(bad)).toThrow()
  })
})
