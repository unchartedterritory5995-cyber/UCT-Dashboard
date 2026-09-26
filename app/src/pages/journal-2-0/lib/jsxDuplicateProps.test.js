// @vitest-environment node
/**
 * ⛔ NO JSX ELEMENT IN THE NOTEBOOK CARRIES THE SAME PROP TWICE.
 *
 * Wave 6 whole-branch review I-3. The wave-5 merge (07e1a74ae) auto-merged wave
 * 5's `readOnly={unreadable}` BESIDE wave 6's `readOnly={locked}` on the note
 * title and subtitle — not a conflict, so nobody resolved it. In JSX the later
 * prop wins, so the schema guard's read-only was silently undone on both inputs,
 * and every structural test stayed green (`lesson_a_clean_merge_can_still_
 * duplicate_a_key`). A duplicate prop is never intended: one of the two is dead
 * code that reads as protection.
 *
 * ⛔ AN AST, NEVER A REGEX: the same attribute name in a comment, a string or a
 * neighbouring element is not a duplicate. The file set is WALKED, never typed,
 * so a file added tomorrow is covered the day it lands.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const HERE = dirname(fileURLToPath(import.meta.url))
const NOTEBOOK = join(HERE, '..')                      // app/src/pages/journal-2-0
const JsxParser = Parser.extend(jsx())

function sourceFiles(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) sourceFiles(full, acc)
    else if (/\.jsx$/.test(e.name) && !/\.test\.jsx$/.test(e.name)) acc.push(full)
  }
  return acc
}

const attrName = (a) => (a.name.type === 'JSXNamespacedName'
  ? `${a.name.namespace.name}:${a.name.name.name}` : a.name.name)

/** Every `<El a={1} a={2}>` in `src`, as `line: prop`. */
function duplicateProps(src) {
  const ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const found = []
  ;(function walk(n) {
    if (!n || typeof n !== 'object') return
    if (n.type === 'JSXOpeningElement') {
      const seen = new Map()
      for (const a of n.attributes) {
        if (a.type !== 'JSXAttribute') continue            // a {...spread} is not a named prop
        const name = attrName(a)
        if (seen.has(name)) found.push(`${seen.get(name)}/${a.loc.start.line}: ${name}`)
        else seen.set(name, a.loc.start.line)
      }
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc') continue
      const c = n[k]
      if (Array.isArray(c)) c.forEach(walk)
      else if (c && typeof c === 'object') walk(c)
    }
  })(ast)
  return found
}

describe('no duplicate JSX props in the Notebook (review I-3)', () => {
  const files = sourceFiles(NOTEBOOK)

  it('NON-VACUITY: the walk sees the Notebook, including the file the defect was in', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(files.some((f) => f.endsWith('NoteEditorPage.jsx'))).toBe(true)
  })

  it('CONTROL: the scan sees a real duplicate, and not a spread or a neighbour', () => {
    expect(duplicateProps('const x = <input readOnly={a} value={v} readOnly={b} />')).toEqual(['1/1: readOnly'])
    expect(duplicateProps('const x = <input readOnly={a} {...rest} />')).toEqual([])
    expect(duplicateProps('const x = <><a title="1" /><b title="2" /></>')).toEqual([])
    expect(duplicateProps('// <input readOnly={a} readOnly={b} />\nconst x = 1')).toEqual([])
  })

  it('⛔ no element in a Notebook source file names a prop twice', () => {
    const offenders = []
    for (const f of files) {
      for (const d of duplicateProps(readFileSync(f, 'utf8'))) offenders.push(`${relative(NOTEBOOK, f)}:${d}`)
    }
    expect(offenders, `duplicate JSX props (the later one silently wins): ${offenders.join(', ')}`).toEqual([])
  })
})
