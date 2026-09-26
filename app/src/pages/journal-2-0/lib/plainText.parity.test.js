/**
 * body_plain parity — the client's `extractPlainText` and the server's
 * `extract_plain_text` read ONE table of documents and expected text
 * (tests/fixtures_plain_text.json). body_plain is the notebook's search index
 * and the text History diffs; a node one side reads and the other does not is
 * a search that finds a note on one path and not the other. The server half is
 * tests/test_plain_text_parity.py, which reads the same fixture and THIS side's
 * source.
 *
 * Both serializers are ProseMirror's own textBetween(0, size, ' ', leafText).
 * This half ALSO runs the real textBetween over the app schema -- on every
 * schema-valid plain-text fixture and on every citation fixture the real
 * library generated -- so the JSON walk is checked against the library itself,
 * not against a reading of it. ⚰️ Until 2026-09-23 both serializers joined
 * EVERY text node with a space: "**NV**DA" was indexed as "NV DA".
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSchema } from '@tiptap/core'
import { Node as PMNode } from '@tiptap/pm/model'
import { buildExtensions, extractPlainText, plainLeafText } from './tiptap'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../../../..')
const FIXTURE = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures_plain_text.json'), 'utf8'))
const PM_FIXTURES = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures_pm_citation_text.json'), 'utf8'))
const schema = getSchema(buildExtensions())

function realTextBetween(json) {
  const doc = PMNode.fromJSON(schema, json)
  doc.check() // a doc the schema would refuse is not a ground truth
  return doc.textBetween(0, doc.content.size, ' ', plainLeafText)
}

function bodyOf(src, head, endRe) {
  const start = src.indexOf(head)
  if (start < 0) return ''
  const end = src.slice(start + 1).search(endRe)
  return src.slice(start, start + 1 + end)
}

function clientLeafExtras() {
  const src = fs.readFileSync(path.join(HERE, 'tiptap.js'), 'utf8')
  const body = bodyOf(src, 'export function plainLeafText(', /\r?\n\}/)
  return new Set([...body.matchAll(/node\?\.type\?\.name === '(\w+)'/g)].map((m) => m[1]))
}

function serverLeafExtras() {
  // The server table is {**_CITATION_ATOM_TEXT, <extras>}: its own quoted keys
  // are exactly what it reads beyond the citation table.
  const src = fs.readFileSync(path.join(REPO, 'api/services/journal_two/notes.py'), 'utf8')
  const body = bodyOf(src, '_PLAIN_LEAF_TEXT = {', /\r?\n\}/)
  return new Set([...body.matchAll(/^\s+"(\w+)":/gm)].map((m) => m[1]))
}

describe('extractPlainText ⇄ extract_plain_text', () => {
  it.each(FIXTURE.cases.map((c) => [c.name, c]))('%s', (_name, c) => {
    expect(extractPlainText(c.doc)).toBe(c.expected)
  })

  it.each(FIXTURE.cases.filter((c) => c.pm).map((c) => [c.name, c]))(
    'the REAL textBetween agrees: %s', (_name, c) => {
      expect(realTextBetween(c.doc)).toBe(c.expected)
    })

  it('the fixture marks what the schema refuses honestly (pm:false really is refused)', () => {
    const refused = FIXTURE.cases.filter((c) => !c.pm)
    expect(refused.length).toBeGreaterThan(0)
    for (const c of refused) expect(() => realTextBetween(c.doc), c.name).toThrow()
  })

  it('equals the real textBetween on every citation fixture the library generated', () => {
    const names = Object.keys(PM_FIXTURES)
    expect(names.length).toBeGreaterThanOrEqual(40) // non-vacuity
    for (const name of names) {
      const json = PM_FIXTURES[name].json
      expect(extractPlainText(json), name).toBe(realTextBetween(json))
    }
  })

  it('reads the leaf table as the citation table plus the same one extra as the server', () => {
    const client = clientLeafExtras()
    const server = serverLeafExtras()
    expect(client.has('videoTimestamp'), 'client probe misses videoTimestamp').toBe(true)
    expect(server.has('videoTimestamp'), 'server probe misses videoTimestamp').toBe(true)
    expect([...client].sort()).toEqual([...server].sort())
  })
})
