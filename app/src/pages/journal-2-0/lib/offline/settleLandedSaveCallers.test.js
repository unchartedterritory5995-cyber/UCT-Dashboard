/**
 * ⛔⛔ EVERY CALLER OF `settleLandedSave`, AND WHAT EACH ONE PASSES AS `acked`.
 *
 * Review N3, fix round 1 (wave 5). `discardsUnsentWork` — the guard
 * `settleLandedSave` asks — treats `acked` as the server's word: "what landed
 * holds the record's words plus only server-appended blocks" is read as caught
 * up (D3, A-2). That is sound exactly as long as `acked` IS what the server
 * accepted or returned. A caller that passed LOCAL state as `acked` (the fix-4
 * lie) shaped "record + a member-inserted widget/fact/excerpt at the end" would
 * clear the queue with the words unsent (`docs/notebook/f5-fixes-2026-09-23.md`
 * §A.3, the residual).
 *
 * So the set of callers is pinned here, each with the expression it passes, and
 * a fourth caller — or a changed `acked` — fails BY NAME until someone has
 * reviewed it against that residual and added it below on purpose.
 *
 * ⭐ READ BY AST (acorn + acorn-jsx), never by grep: a comment naming the call
 * must not count as one, and the enclosing function is part of the pin.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const JSXParser = Parser.extend(jsx())
const SRC = join(__dirname, '..', '..', '..', '..')           // app/src
const rel = (p) => relative(SRC, p).split(sep).join('/')

/**
 * The reviewed set. Each entry: where it is, the function it sits in, and the
 * exact source text of its `acked` value.
 *   restoreDraft / commitSave  `ackedNow` — built AFTER the PUT's 200, from the
 *                              title/subtitle/body that PUT carried
 *   settleMetadataRevision     `saved` — the note the metadata PUT returned
 */
const REVIEWED = [
  { file: 'pages/journal-2-0/components/notebook/NoteEditorPage.jsx', fn: 'restoreDraft', acked: 'ackedNow' },
  { file: 'pages/journal-2-0/components/notebook/NoteEditorPage.jsx', fn: 'commitSave', acked: 'ackedNow' },
  { file: 'pages/journal-2-0/components/notebook/NoteEditorPage.jsx', fn: 'settleMetadataRevision', acked: 'saved' },
]

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name.startsWith('__')) continue
      yield* sourceFiles(p)
    } else if (/\.(js|jsx)$/.test(name) && !/\.(test|spec)\.(js|jsx)$/.test(name)) {
      yield p
    }
  }
}

/** Every call to `settleLandedSave(...)` in one source, with its enclosing
 *  function and the text of the `acked` property it passes. */
function callersIn(src, file = '<src>') {
  const ast = JSXParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true })
  const out = []
  const walk = (node, fnName) => {
    if (!node || typeof node.type !== 'string') return
    let name = fnName
    if (node.type === 'FunctionDeclaration' && node.id) name = node.id.name
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier'
        && /Function/.test(node.init?.type || '')) name = node.id.name
    if (node.type === 'CallExpression') {
      const c = node.callee
      const called = c?.type === 'Identifier' ? c.name
        : (c?.type === 'MemberExpression' && !c.computed ? c.property?.name : null)
      if (called === 'settleLandedSave') {
        const arg = node.arguments[0]
        const prop = arg?.type === 'ObjectExpression'
          ? arg.properties.find((p) => p.type === 'Property' && (p.key?.name || p.key?.value) === 'acked')
          : null
        out.push({
          file, fn: fnName || '<top level>',
          acked: prop ? src.slice(prop.value.start, prop.value.end) : '<no acked property>',
        })
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue
      const v = node[key]
      if (Array.isArray(v)) v.forEach((c) => walk(c, name))
      else if (v && typeof v.type === 'string') walk(v, name)
    }
  }
  walk(ast, null)
  return out
}

const key = (c) => `${c.file} :: ${c.fn} :: acked=${c.acked}`

describe('⛔ settleLandedSave — the reviewed callers and what each passes as `acked`', () => {
  it('the callers in app/src are EXACTLY the reviewed set', () => {
    const found = []
    let scanned = 0
    for (const p of sourceFiles(SRC)) {
      const src = readFileSync(p, 'utf8')
      if (!src.includes('settleLandedSave')) continue
      scanned += 1
      found.push(...callersIn(src, rel(p)))
    }
    // ⭐ NON-VACUITY: the definition's own module and the editor both mention it.
    expect(scanned, 'the scan found no file mentioning settleLandedSave — the walk is broken').toBeGreaterThanOrEqual(2)
    expect(found.map(key).sort(),
      '⛔ a caller of settleLandedSave appeared, moved, or changed what it passes as `acked`. '
      + 'Review it against the A-2 residual (f5-fixes-2026-09-23.md §A.3) — `acked` must be what '
      + 'the server accepted or returned, never local state — then add it to REVIEWED.')
      .toEqual(REVIEWED.map(key).sort())
  })

  it('⭐ CONTROL — the walker sees a fourth caller, its function, and its `acked`', () => {
    const planted = `
      // settleLandedSave({ acked: fromAComment }) — prose, not a call
      async function laterDoor() { await settleLandedSave({ noteId, acked: captureLocalState(), current }) }
      const other = () => lib.settleLandedSave({ acked: saved })
    `
    expect(callersIn(planted).map(key)).toEqual([
      '<src> :: laterDoor :: acked=captureLocalState()',
      '<src> :: other :: acked=saved',
    ])
  })
})
