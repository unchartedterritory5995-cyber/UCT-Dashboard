import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Schema } from 'prosemirror-model'
import {
  ASK_CITATION_TYPE, ASK_INSERT_TYPE, PENDING_ASK_INSERT_KEY, PENDING_ASK_INSERT_TTL_MS,
  buildAskInsertNode, claimFromBlock, claimFromJson, clearPendingAskInsert, normalizeClaim,
  takePendingAskInsert, writePendingAskInsert,
} from './askInsert'

const SRC1 = { n: 1, label: 'NVDA thesis', citation: 'exact', navigation: { kind: 'note', note_id: 'n1' } }
const SRC2 = { n: 2, label: 'Q3 call', citation: 'page_only', navigation: { kind: 'document', document_id: 'd1', page_number: 3 } }
const AT = '2026-09-22T12:00:00.000Z'

describe('the claim is ONE normalization, used at insert and at render', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeClaim(['  Margins  fell ', '\n in Q3. '])).toBe('Margins fell in Q3.')
  })

  it('a JSON paragraph and a ProseMirror paragraph with the same text agree', () => {
    const schema = new Schema({ nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'inline*' },
      text: { group: 'inline' },
      askCitation: { group: 'inline', inline: true, atom: true, attrs: { n: { default: null } } },
    } })
    const content = [
      { type: 'text', text: 'Margins fell ' },
      { type: 'askCitation', attrs: { n: 1 } },
      { type: 'text', text: ' in Q3.' },
    ]
    const pm = schema.nodeFromJSON({ type: 'paragraph', content })
    expect(claimFromJson(content)).toBe('Margins fell in Q3.')
    expect(claimFromBlock(pm)).toBe(claimFromJson(content))
  })
})

describe('buildAskInsertNode — exactly what the panel showed', () => {
  it('turns cited handles into chips, one paragraph per line', () => {
    const node = buildAskInsertNode({
      answer: 'Margins fell [1].\n\nGuidance held [2].',
      sources: [SRC1, SRC2], question: 'margins?', scope: 'notebook', insertedAt: AT,
    })
    expect(node.type).toBe(ASK_INSERT_TYPE)
    expect(node.attrs).toEqual({ insertedAt: AT, scope: 'notebook', question: 'margins?' })
    expect(node.content).toHaveLength(2)
    expect(node.content[0]).toEqual({ type: 'paragraph', content: [
      { type: 'text', text: 'Margins fell ' },
      { type: ASK_CITATION_TYPE, attrs: {
        n: 1, label: 'NVDA thesis', nav: { kind: 'note', note_id: 'n1' },
        citation: 'exact', claim: 'Margins fell .' } },
      { type: 'text', text: '.' },
    ] })
    expect(node.content[1].content[1].attrs.claim).toBe('Guidance held .')
    expect(node.content[1].content[1].attrs.citation).toBe('page_only')
  })

  it('an invented handle stays literal text, never a chip', () => {
    const node = buildAskInsertNode({ answer: 'Margins fell [9].', sources: [SRC1], insertedAt: AT })
    expect(node.content[0].content).toEqual([{ type: 'text', text: 'Margins fell [9].' }])
  })

  it('drops empty lines and never emits an empty text node', () => {
    const node = buildAskInsertNode({ answer: 'A [1]\n\n\nB', sources: [SRC1], insertedAt: AT })
    expect(node.content).toHaveLength(2)
    const texts = []
    node.content.forEach((p) => p.content.forEach((n) => { if (n.type === 'text') texts.push(n.text) }))
    expect(texts.every((t) => t.length > 0)).toBe(true)
  })

  it('returns null when nothing survives', () => {
    expect(buildAskInsertNode({ answer: '\n\n', sources: [], insertedAt: AT })).toBeNull()
  })

  it('copies the navigation object rather than sharing it', () => {
    const node = buildAskInsertNode({ answer: 'A [1]', sources: [SRC1], insertedAt: AT })
    const nav = node.content[0].content[1].attrs.nav
    expect(nav).toEqual(SRC1.navigation)
    expect(nav).not.toBe(SRC1.navigation)
  })
})

describe('the pending hand-off is consumed exactly once, and only by its note', () => {
  const NODE = { type: ASK_INSERT_TYPE, attrs: {}, content: [] }
  beforeEach(() => { clearPendingAskInsert(); sessionStorage.clear() })

  it('hands the entry to the matching note once', () => {
    writePendingAskInsert('n1', NODE, 1000)
    expect(takePendingAskInsert('n1', 2000)?.node).toEqual(NODE)
    expect(takePendingAskInsert('n1', 2000)).toBeNull()
  })

  it("another note does not consume it", () => {
    writePendingAskInsert('n1', NODE, 1000)
    expect(takePendingAskInsert('n2', 2000)).toBeNull()
    expect(takePendingAskInsert('n1', 2000)?.noteId).toBe('n1')
  })

  it('an expired entry is discarded everywhere', () => {
    writePendingAskInsert('n1', NODE, 1000)
    expect(takePendingAskInsert('n1', 1000 + PENDING_ASK_INSERT_TTL_MS)).toBeNull()
    expect(sessionStorage.getItem(PENDING_ASK_INSERT_KEY)).toBeNull()
  })

  it('survives a full reload through sessionStorage', () => {
    writePendingAskInsert('n1', NODE, 1000)
    const raw = sessionStorage.getItem(PENDING_ASK_INSERT_KEY)
    clearPendingAskInsert()               // a reload clears the memory carrier…
    sessionStorage.setItem(PENDING_ASK_INSERT_KEY, raw)  // …and keeps storage
    expect(takePendingAskInsert('n1', 2000)?.noteId).toBe('n1')
  })

  it('still works when storage is refused (memory carrier)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(writePendingAskInsert('n1', NODE, 1000)).toBe(false)
    spy.mockRestore()
    expect(takePendingAskInsert('n1', 2000)?.noteId).toBe('n1')
  })

  it('a corrupt stored entry is ignored', () => {
    sessionStorage.setItem(PENDING_ASK_INSERT_KEY, '{not json')
    expect(takePendingAskInsert('n1', 2000)).toBeNull()
  })

  it('an entry that is not an askInsert is refused', () => {
    writePendingAskInsert('n1', { type: 'paragraph' }, 1000)
    expect(takePendingAskInsert('n1', 2000)).toBeNull()
  })

  it('a write whose storage half fails can never leave a stale entry behind for another note', () => {
    const NODE_A = { type: ASK_INSERT_TYPE, attrs: {}, content: [{ marker: 'A' }] }
    const NODE_B = { type: ASK_INSERT_TYPE, attrs: {}, content: [{ marker: 'B' }] }
    writePendingAskInsert('A', NODE_A, 1000)
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(writePendingAskInsert('B', NODE_B, 1000)).toBe(false)
    spy.mockRestore()
    expect(sessionStorage.getItem(PENDING_ASK_INSERT_KEY)).toBeNull()
    expect(takePendingAskInsert('A', 2000)).toBeNull()
    expect(takePendingAskInsert('B', 2000)?.noteId).toBe('B')
  })
})
