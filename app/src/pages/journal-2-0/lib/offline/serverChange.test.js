/**
 * The three shapes, one rail each — and one rail per server-side appender, so
 * that adding a fourth append function without teaching this file about it is
 * caught here rather than by a member losing a paragraph.
 *
 * ⛔ EVERY "SAFE" ANSWER IS PAIRED WITH THE NEAREST UNSAFE NEIGHBOUR. A rail
 * that only shows the merge branch saying yes cannot distinguish a classifier
 * from `() => APPEND_ONLY`.
 */
import { describe, expect, it } from 'vitest'
import {
  APPEND_ONLY, BODY_REWRITE, METADATA_ONLY, SERVER_APPENDED_TYPES,
  appendedServerNodes, classifyServerChange, missingServerNodes, nodeKeyOf,
  lastKnownServerCopy, serverAppendedKeysIn, snapshotOfServerCopy,
} from './serverChange'

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...content) => ({ type: 'doc', content })
const note = (bodyJson, extra = {}) => ({ title: 'T', subtitle: 'S', bodyJson, ...extra })

const embed = { type: 'widgetEmbed', attrs: { widgetId: 'w1', capturedAt: '2026-09-12T00:00:00Z', searchText: 'AAPL' } }
const fact = { type: 'financialFact', attrs: { factId: 'f1' } }
const excerpt = { type: 'documentExcerpt', attrs: { excerptId: 'x1' } }

describe('classifyServerChange — metadata-only', () => {
  it('is metadata-only when the body, title and subtitle never moved', () => {
    const base = note(doc(para('hello')))
    // the folder/ticker/tags/hero doors change none of these three
    const fresh = note(doc(para('hello')), { folderId: 'moved', ticker: 'NVDA', updatedAt: 'later' })
    expect(classifyServerChange(fresh, base)).toBe(METADATA_ONLY)
  })

  it('is metadata-only for two notes with no body at all', () => {
    expect(classifyServerChange(note(null), note(null))).toBe(METADATA_ONLY)
  })

  it('⛔ a changed TITLE is authored content, not metadata', () => {
    const base = note(doc(para('hello')))
    expect(classifyServerChange({ ...base, title: 'renamed' }, base)).toBe(BODY_REWRITE)
  })

  it('⛔ a changed SUBTITLE is authored content, not metadata', () => {
    const base = note(doc(para('hello')))
    expect(classifyServerChange({ ...base, subtitle: 'new' }, base)).toBe(BODY_REWRITE)
  })
})

describe('classifyServerChange — append-only, one rail per server appender', () => {
  for (const [type, node] of [['widgetEmbed', embed], ['financialFact', fact], ['documentExcerpt', excerpt]]) {
    it(`is append-only when the server appended a ${type}`, () => {
      const base = note(doc(para('hello')))
      const fresh = note(doc(para('hello'), node))
      expect(classifyServerChange(fresh, base)).toBe(APPEND_ONLY)
      expect(appendedServerNodes(fresh, base)).toEqual([node])
    })
  }

  it('is append-only for several appends at once, in order', () => {
    const base = note(doc(para('hello')))
    const fresh = note(doc(para('hello'), embed, fact, excerpt))
    expect(classifyServerChange(fresh, base)).toBe(APPEND_ONLY)
    expect(appendedServerNodes(fresh, base)).toEqual([embed, fact, excerpt])
  })

  it('is append-only when the base already held one of the same type', () => {
    const base = note(doc(para('hello'), embed))
    const fresh = note(doc(para('hello'), embed, fact))
    expect(classifyServerChange(fresh, base)).toBe(APPEND_ONLY)
    expect(appendedServerNodes(fresh, base)).toEqual([fact])
  })

  it('⛔ an appended PARAGRAPH is not an append the server makes — it is a rewrite', () => {
    const base = note(doc(para('hello')))
    const fresh = note(doc(para('hello'), para('someone else typed this')))
    expect(classifyServerChange(fresh, base)).toBe(BODY_REWRITE)
    expect(appendedServerNodes(fresh, base)).toBeNull()
  })

  it('⛔ an embed inserted in the MIDDLE is not a tail append — the server never does that', () => {
    const base = note(doc(para('one'), para('two')))
    const fresh = note(doc(para('one'), embed, para('two')))
    expect(classifyServerChange(fresh, base)).toBe(BODY_REWRITE)
  })

  it('⛔ an append ALONGSIDE an edit to existing prose is a rewrite', () => {
    const base = note(doc(para('hello')))
    const fresh = note(doc(para('hello, world'), embed))
    expect(classifyServerChange(fresh, base)).toBe(BODY_REWRITE)
  })

  it('⛔ a REMOVED block is a rewrite even when blocks were also appended', () => {
    const base = note(doc(para('one'), para('two')))
    const fresh = note(doc(para('one'), embed))
    expect(classifyServerChange(fresh, base)).toBe(BODY_REWRITE)
  })

  it('⛔ an unknown node type at the tail is a rewrite — the default is the safe answer', () => {
    const base = note(doc(para('hello')))
    const fresh = note(doc(para('hello'), { type: 'somethingNew', attrs: { id: 'z' } }))
    expect(classifyServerChange(fresh, base)).toBe(BODY_REWRITE)
  })
})

describe('classifyServerChange — missing evidence never merges', () => {
  it.each([
    ['no fresh', null, note(doc(para('x')))],
    ['no base', note(doc(para('x'))), null],
    ['fresh has no doc', note(null), note(doc(para('x')))],
    ['base has no doc', note(doc(para('x'))), note(null)],
    ['fresh body is not a doc', note({ type: 'doc' }), note(doc(para('x')))],
  ])('%s ⇒ body-rewrite', (_label, fresh, base) => {
    expect(classifyServerChange(fresh, base)).toBe(BODY_REWRITE)
  })
})

describe('node identity', () => {
  it('keys each appended type by its own identity attrs, not the whole attrs object', () => {
    // A live ProseMirror node carries schema defaults the stored JSON lacks.
    const live = { type: 'financialFact', attrs: { factId: 'f1', class: null, draggable: false } }
    expect(nodeKeyOf(live)).toBe(nodeKeyOf(fact))
  })

  it('gives null for a node the server never appends', () => {
    expect(nodeKeyOf(para('x'))).toBeNull()
    expect(nodeKeyOf(null)).toBeNull()
  })

  it('distinguishes two embeds captured at different times', () => {
    const other = { ...embed, attrs: { ...embed.attrs, capturedAt: '2026-09-12T01:00:00Z' } }
    expect(nodeKeyOf(other)).not.toBe(nodeKeyOf(embed))
  })

  it('finds appended keys at any depth', () => {
    const nested = doc({ type: 'blockquote', content: [embed] })
    expect(serverAppendedKeysIn(nested)).toEqual(new Set([nodeKeyOf(embed)]))
  })

  it('missingServerNodes drops the ones already held', () => {
    const held = new Set([nodeKeyOf(embed)])
    expect(missingServerNodes([embed, fact], held)).toEqual([fact])
  })
})

describe('the appender roster is a contract', () => {
  it('names exactly the three server-side appenders in api/services/journal_two/notes.py', () => {
    // ⛔ If a fourth `content.append({...})` lands on the server, this list is
    // the thing that must change with it. Failing here is the cheap version of
    // finding out from a member's lost paragraph.
    expect(Object.keys(SERVER_APPENDED_TYPES).sort()).toEqual(
      ['documentExcerpt', 'financialFact', 'widgetEmbed'],
    )
  })
})

describe('the last-known server copy', () => {
  const rec = (extra) => ({ noteId: 'n1', title: 'T', subtitle: 'S', bodyJson: doc(para('x')), baseUpdatedAt: 'T1', ...extra })

  it('a CLEAN record is its own base — no second copy is stored', () => {
    expect(lastKnownServerCopy(rec({ dirty: 0 }))).toEqual({
      title: 'T', subtitle: 'S', bodyJson: doc(para('x')), updatedAt: 'T1',
    })
  })

  it('a DIRTY record answers with its snapshot, not with the working copy', () => {
    const snap = { title: 'T', subtitle: 'S', bodyJson: doc(para('before')), updatedAt: 'T1' }
    const r = rec({ dirty: 1, bodyJson: doc(para('the member kept typing')), serverBase: snap })
    expect(lastKnownServerCopy(r)).toBe(snap)
  })

  it('⛔ a DIRTY record with no snapshot answers null — never the working copy', () => {
    expect(lastKnownServerCopy(rec({ dirty: 1 }))).toBeNull()
    // …and null classifies as the safe answer.
    expect(classifyServerChange(note(doc(para('x'))), lastKnownServerCopy(rec({ dirty: 1 })))).toBe(BODY_REWRITE)
  })

  it('⛔ no record at all answers null', () => {
    expect(lastKnownServerCopy(null)).toBeNull()
  })

  it('snapshotOfServerCopy keeps the revision it was told, not the note`s own', () => {
    expect(snapshotOfServerCopy({ title: 'A', bodyJson: null, updatedAt: 'stale' }, 'T9').updatedAt).toBe('T9')
    expect(snapshotOfServerCopy(null)).toBeNull()
  })
})
