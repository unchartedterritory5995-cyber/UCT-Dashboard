// @vitest-environment node
// Wave 8 lane 8C (C3): the sample notebook's content against the CLIENT's schema, and the
// small helpers the first-run screen uses. The server-side rails (content rules, the seed,
// the routes) are tests/test_sample_notebook.py; this is the half only the client can say:
// every node and mark type in the sample is one lib/notebookSchema.js registers, so the
// editor can open every sample note.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { NOTEBOOK_TYPE_SCHEMA } from '../../../lib/notebookSchema'
import { readSamplePref, isNotebookKey, SAMPLE_URL } from './sampleNotebook'

const JSON_PATH = path.resolve(process.cwd(), '..', 'api', 'services', 'journal_two', 'sample_notebook.json')
const SAMPLE = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'))

function types(node, out = new Set()) {
  if (node && typeof node === 'object') {
    if (typeof node.type === 'string') out.add(node.type)
    for (const m of node.marks || []) if (m && typeof m.type === 'string') out.add(m.type)
    for (const c of node.content || []) types(c, out)
  }
  return out
}

describe('the sample notebook against the client schema', () => {
  it('non-vacuity: the file holds five notes', () => {
    expect(SAMPLE.notes.map((n) => n.key)).toEqual(['welcome', 'research', 'thesis', 'daily', 'checklist'])
  })

  it('every node and mark type is registered in lib/notebookSchema.js', () => {
    const registered = new Set(Object.keys(NOTEBOOK_TYPE_SCHEMA))
    for (const n of SAMPLE.notes) {
      const stray = [...types(n.body)].filter((t) => !registered.has(t))
      expect(stray, n.key).toEqual([])
    }
  })

  it('control: an unregistered type is seen', () => {
    const registered = new Set(Object.keys(NOTEBOOK_TYPE_SCHEMA))
    expect([...types({ type: 'doc', content: [{ type: 'madeUpNode' }] })].filter((t) => !registered.has(t))).toEqual(['madeUpNode'])
  })
})

describe('readSamplePref', () => {
  it('reads the server TEXT or an object, and nothing without ids', () => {
    expect(readSamplePref(JSON.stringify({ v: 1, ids: ['a', 'b'], at: 'x' }))).toEqual({ v: 1, ids: ['a', 'b'], at: 'x' })
    expect(readSamplePref({ v: 1, ids: ['a', '', 3] })).toEqual({ v: 1, ids: ['a'] })
    expect(readSamplePref(undefined)).toBeNull()
    expect(readSamplePref('{bad json')).toBeNull()
    expect(readSamplePref(JSON.stringify({ v: 1, ids: [] }))).toBeNull()
  })
})

describe('isNotebookKey', () => {
  it('matches what a sample write changes, and nothing else', () => {
    for (const k of ['/api/j2/notes?sort=title', '/api/j2/notes/folder-counts', '/api/j2/note-folders',
      '/api/j2/notebook/home', '/api/auth/preferences', SAMPLE_URL]) expect(isNotebookKey(k), k).toBe(true)
    for (const k of ['/api/j2/trades', '/api/auth/me', null, ['/api/j2/notes']]) expect(isNotebookKey(k)).toBe(false)
  })
})
