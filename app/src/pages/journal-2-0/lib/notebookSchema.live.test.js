/**
 * Wave 13 lane 13H-1 — THIS bundle's live editor registers `widgetEmbed.ta`,
 * declares schema level 4, and round-trips a `ta` value.
 *
 * ⛔ Why this is its own file. `notebookSchema.rail.test.js` stays at the tip
 * through a rollback (tools/notebook_rollback_chain.py, SCHEMA_RAILS), so it may
 * only assert what is true of a rolled-back editor too. These three assertions
 * are true ONLY while the attribute is registered, so they live here and revert
 * with the feature (lane ROLLBACK, 2026-10-06; they were in the rail until then
 * and were its only two red tests on the rolled-back tree).
 *
 * At the tip this file is the strict half: if `ta` is ever dropped from
 * `lib/widgetEmbedNode.jsx` by accident, the declaration falls to 3, every note
 * that carries plan data turns read-only for every member, and this goes red.
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { buildExtensions } from './tiptap'
import { NOTEBOOK_ATTR_SCHEMA, deriveDeclaredSchema } from './notebookSchema'

let editor = null
afterEach(() => { editor?.destroy(); editor = null })

describe('this bundle and `widgetEmbed.ta` (13H-1, schema level 4)', () => {
  it('THIS bundle’s live editor registers `widgetEmbed.ta` and declares 4', () => {
    editor = new Editor({ extensions: buildExtensions() })
    expect(Object.keys(editor.schema.nodes.widgetEmbed.attrs)).toContain('ta')
    expect(editor.schema.nodes.widgetEmbed.attrs.ta.default).toBe(null)
    expect(NOTEBOOK_ATTR_SCHEMA['widgetEmbed.ta']).toBe(4)
    expect(deriveDeclaredSchema(editor.schema)).toBe(4)
  })
  it('a `ta` value survives the editor round trip (load → getJSON), and null stays null', () => {
    const ta = { v: 1, setupTag: 'Breakout', fingerprint: { v: 1 }, planBlock: { shares: 200, sizedBy: 'starter' } }
    const doc = { type: 'doc', content: [
      { type: 'widgetEmbed', attrs: { widgetId: 'chart', params: { symbol: 'NVDA' }, ta } },
      { type: 'widgetEmbed', attrs: { widgetId: 'chart', params: { symbol: 'AMD' } } },
    ] }
    editor = new Editor({ extensions: buildExtensions(), content: doc })
    const out = editor.getJSON().content.filter((n) => n.type === 'widgetEmbed')
    expect(out[0].attrs.ta).toEqual(ta)
    expect(out[1].attrs.ta).toBe(null)
  })
})
