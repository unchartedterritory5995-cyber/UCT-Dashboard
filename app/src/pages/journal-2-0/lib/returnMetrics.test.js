// Audit 2026-11-05, S20: the two trust incidents are recognised exactly, and nothing else is one.
import { describe, it, expect } from 'vitest'
import { restoredWidgetByUndo } from './notebookTips'
import { TRUST_UNDO_WINDOW_MS, publishUndoneMs } from './notePublishLink'

/** A step whose inserted slice holds `names` (node type names). */
function step(names) {
  const nodes = names.map((n) => ({ type: { name: n } }))
  return {
    slice: {
      content: {
        size: nodes.length,
        descendants(fn) { for (const n of nodes) { if (fn(n) === false) break } },
      },
    },
  }
}
const tr = (meta, names) => ({ getMeta: (k) => (k === 'history$' ? meta : undefined), steps: [step(names)] })

describe('a widget deleted then restored by undo', () => {
  it('an undo that puts a widget back is an incident', () => {
    expect(restoredWidgetByUndo(tr({ redo: false }, ['paragraph', 'widgetEmbed']))).toBe(true)
  })
  it('CONTROL: a redo, an ordinary insert and an undo of text are not', () => {
    expect(restoredWidgetByUndo(tr({ redo: true }, ['widgetEmbed']))).toBe(false)
    expect(restoredWidgetByUndo(tr(undefined, ['widgetEmbed']))).toBe(false)
    expect(restoredWidgetByUndo(tr({ redo: false }, ['paragraph', 'text']))).toBe(false)
  })
})

describe('a publish undone within 10 minutes', () => {
  const now = Date.parse('2026-11-04T18:00:00Z')
  it('reads the server UTC stamp, with or without a zone', () => {
    expect(publishUndoneMs({ createdAt: '2026-11-04T17:58:00Z' }, now)).toBe(120000)
    expect(publishUndoneMs({ createdAt: '2026-11-04 17:55:00' }, now)).toBe(300000)
  })
  it('CONTROL: an older publish, a future stamp and an unreadable one are not incidents', () => {
    expect(publishUndoneMs({ createdAt: new Date(now - TRUST_UNDO_WINDOW_MS - 1).toISOString() }, now)).toBeNull()
    expect(publishUndoneMs({ createdAt: '2026-11-04T18:05:00Z' }, now)).toBeNull()
    expect(publishUndoneMs({ createdAt: 'yesterday' }, now)).toBeNull()
    expect(publishUndoneMs({}, now)).toBeNull()
  })
})
