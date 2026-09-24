/**
 * S1 / H14 — the schema table covers every type the LIVE editor registers, and
 * the header this bundle sends is derived from that live schema.
 *
 * ⛔ Read from a CONSTRUCTED editor's `schema.nodes` / `schema.marks`, never
 * from a list: a node added to `buildExtensions()` without a table entry reads
 * as 0 on the server ("every client can read this"), which is how a note blanks.
 * The server/client equality is the Python rail
 * (tests/test_notebook_schema_guard.py), which parses notebookSchema.js.
 *
 * ⚠️ Deliberately NOT asserted: "every table entry is registered". A rollback
 * that reverts the features and keeps the guard commit leaves wave-5 entries in
 * the table with no extension behind them — that is correct, and the derived
 * declaration drops below their level (see the unit cases below).
 */
import { Editor } from '@tiptap/core'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildExtensions, editorSchema } from './tiptap'
import {
  NOTEBOOK_SCHEMA_HEADER, NOTEBOOK_TYPE_SCHEMA, deriveDeclaredSchema, notebookSchemaHeaders,
} from './notebookSchema'
import { sendNoteUpdate } from './offline/useOutboxDrain'
import { useJ2Note } from '../hooks/useJ2Notes'
import { saveEntryBody } from '../../modelbook/builder/UpbEntryPage'

let editor = null
afterEach(() => { editor?.destroy(); editor = null })

describe('the note-type schema table (S1)', () => {
  it('holds every node and mark name the live editor schema registers', () => {
    editor = new Editor({ extensions: buildExtensions() })
    const names = [...Object.keys(editor.schema.nodes), ...Object.keys(editor.schema.marks)]
    // Non-vacuity: an editor that registered nothing would pass any subset test.
    expect(names.length).toBeGreaterThanOrEqual(35)
    expect(names).toContain('paragraph')
    expect(names).toContain('inlineMath')
    expect(names).toContain('highlight')
    const missing = names.filter((n) => !Object.hasOwn(NOTEBOOK_TYPE_SCHEMA, n))
    expect(missing).toEqual([])
    // A node and a mark sharing one name would make one table entry answer
    // for two types.
    const both = Object.keys(editor.schema.nodes).filter((n) => editor.schema.marks[n])
    expect(both).toEqual([])
  })

  it('sends the declaration derived from THIS bundle’s editor schema', async () => {
    editor = new Editor({ extensions: buildExtensions() })
    const fromEditor = deriveDeclaredSchema(editor.schema)
    expect(deriveDeclaredSchema(editorSchema())).toBe(fromEditor)
    expect(await notebookSchemaHeaders()).toEqual({ [NOTEBOOK_SCHEMA_HEADER]: String(fromEditor) })
  })
})

describe('every body-writing door sends the declaration (S1)', () => {
  const realFetch = globalThis.fetch
  let calls
  beforeEach(() => {
    calls = []
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), init })
      return { ok: true, status: 200, json: async () => ({ note: { id: 'n1', updatedAt: 'r2' }, entry: { id: 'e1' } }) }
    })
  })
  afterEach(() => { globalThis.fetch = realFetch })
  const expected = async () => String(deriveDeclaredSchema(editorSchema()))
  const headerOf = (c) => c.init.headers?.[NOTEBOOK_SCHEMA_HEADER]

  it('the outbox drain’s PUT', async () => {
    await sendNoteUpdate({ noteId: 'n1', patch: { title: 't', bodyJson: { type: 'doc', content: [] } }, baseUpdatedAt: 'r1' })
    const put = calls.find((c) => c.init.method === 'PUT')
    expect(put.url).toBe('/api/j2/notes/n1')
    expect(headerOf(put)).toBe(await expected())
  })

  it('the shared note PUT when it carries a body', async () => {
    const { result } = renderHook(() => useJ2Note('n1'))
    await act(async () => { await result.current.update({ bodyJson: { type: 'doc', content: [] } }) })
    const put = calls.find((c) => c.init.method === 'PUT')
    expect(put.url).toBe('/api/j2/notes/n1')
    expect(headerOf(put)).toBe(await expected())
  })

  it('the Model Book playbook entry’s body write', async () => {
    await saveEntryBody('e1', { type: 'doc', content: [] })
    const put = calls.find((c) => c.init.method === 'PUT')
    expect(put.url).toBe('/api/upb/entries/e1')
    expect(headerOf(put)).toBe(await expected())
  })
})

describe('deriveDeclaredSchema', () => {
  const fake = (drop = []) => {
    const nodes = {}
    const marks = {}
    for (const name of Object.keys(NOTEBOOK_TYPE_SCHEMA)) {
      if (!drop.includes(name)) (['bold', 'code', 'italic', 'link', 'strike', 'textStyle', 'underline', 'highlight', 'textColor'].includes(name) ? marks : nodes)[name] = {}
    }
    return { nodes, marks }
  }
  const top = Math.max(...Object.values(NOTEBOOK_TYPE_SCHEMA))

  it('declares the newest level when every type is registered', () => {
    expect(top).toBe(1)
    expect(deriveDeclaredSchema(fake())).toBe(top)
  })
  it('drops below a level one of whose types is missing — the rollback case', () => {
    expect(deriveDeclaredSchema(fake(['inlineMath']))).toBe(0)
    expect(deriveDeclaredSchema(fake(['textColor']))).toBe(0)
  })
  it('never declares below 0, and an unreadable schema is the oldest client', () => {
    expect(deriveDeclaredSchema(fake(['paragraph']))).toBe(0)
    expect(deriveDeclaredSchema(null)).toBe(0)
    expect(deriveDeclaredSchema({})).toBe(0)
  })
})
