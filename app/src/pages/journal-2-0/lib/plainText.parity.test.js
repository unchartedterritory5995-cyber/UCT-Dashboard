/**
 * body_plain parity — the client's `extractPlainText` and the server's
 * `extract_plain_text` read ONE table of documents and expected text
 * (tests/fixtures_plain_text.json). body_plain is the notebook's search index
 * and the text History diffs; a node one side reads and the other does not is
 * a search that finds a note on one path and not the other. The server half is
 * tests/test_plain_text_parity.py, which reads the same fixture and THIS side's
 * source.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractPlainText } from './tiptap'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../../../..')
const FIXTURE = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures_plain_text.json'), 'utf8'))

function clientNodeTypes() {
  const src = fs.readFileSync(path.join(HERE, 'tiptap.js'), 'utf8')
  const start = src.indexOf('export function extractPlainText(')
  const end = src.slice(start).search(/\r?\n\}/)
  const body = src.slice(start, start + end)
  return new Set([...body.matchAll(/node\.type === '(\w+)'/g)].map((m) => m[1]))
}

function serverNodeTypes() {
  const src = fs.readFileSync(path.join(REPO, 'api/services/journal_two/notes.py'), 'utf8')
  const start = src.indexOf('def extract_plain_text(')
  const rest = src.slice(start + 1)
  const next = rest.search(/\r?\n(def |class |# ──)/)
  const body = src.slice(start, start + 1 + next)
  const found = new Set([...body.matchAll(/ntype == "(\w+)"/g)].map((m) => m[1]))
  for (const group of body.matchAll(/ntype in \(([^)]*)\)/g)) {
    for (const m of group[1].matchAll(/"(\w+)"/g)) found.add(m[1])
  }
  return found
}

function fixtureNodeTypes() {
  const seen = new Set()
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (typeof node.type === 'string') seen.add(node.type)
    for (const child of node.content || []) walk(child)
  }
  for (const c of FIXTURE.cases) walk(c.doc)
  return seen
}

describe('extractPlainText ⇄ extract_plain_text', () => {
  it.each(FIXTURE.cases.map((c) => [c.name, c]))('%s', (_name, c) => {
    expect(extractPlainText(c.doc)).toBe(c.expected)
  })

  it('both serializers read the same node types', () => {
    const client = clientNodeTypes()
    const server = serverNodeTypes()
    // Non-vacuity: both probes see what they look for.
    for (const t of ['text', 'widgetEmbed', 'inlineMath', 'blockMath']) {
      expect(client.has(t), `client probe misses ${t}`).toBe(true)
      expect(server.has(t), `server probe misses ${t}`).toBe(true)
    }
    expect([...client].sort()).toEqual([...server].sort())
  })

  it('every node type either side reads has a fixture', () => {
    const covered = fixtureNodeTypes()
    const missing = [...new Set([...clientNodeTypes(), ...serverNodeTypes()])].filter((t) => !covered.has(t))
    expect(missing).toEqual([])
  })
})
