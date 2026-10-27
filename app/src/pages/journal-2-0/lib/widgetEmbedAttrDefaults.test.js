// W11-R79 m-2: the server stores a styled note's widgetEmbeds in the editor's own form
// (journal_styles.WIDGET_EMBED_ATTR_DEFAULTS + with_editor_attrs), so a first open writes nothing but the
// self-archive. That table is a COPY of this schema's attribute defaults, so this rail pins it: the JSON between the
// server's two markers must equal the real editor schema's `widgetEmbed` defaults, key for key (a new attribute here,
// a changed default, or one dropped on either side goes red).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getSchema } from '@tiptap/core'
import { buildExtensions } from './tiptap'

function serverDefaults() {
  const src = readFileSync(join(process.cwd(), '..', 'api', 'services', 'journal_two', 'journal_styles.py'), 'utf8')
  const m = /# widgetEmbed-attr-defaults:begin\n([\s\S]*?)\)\s*# widgetEmbed-attr-defaults:end/.exec(src.replace(/\r\n/g, '\n'))
  if (!m) return null
  const json = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).join('')
  return JSON.parse(json)
}

describe("the server's widgetEmbed attribute defaults are the editor schema's (W11-R79 m-2)", () => {
  it('key for key, value for value', () => {
    const schema = getSchema(buildExtensions())
    const attrs = schema.nodes.widgetEmbed.spec.attrs
    const editor = Object.fromEntries(Object.entries(attrs).map(([k, a]) => [k, a.default ?? null]))
    const server = serverDefaults()
    expect(server, 'the markers and the JSON between them are found').not.toBeNull()
    expect(Object.keys(editor).length).toBeGreaterThan(10)                       // non-vacuity: the real schema
    expect(server).toEqual(editor)
  })
})
