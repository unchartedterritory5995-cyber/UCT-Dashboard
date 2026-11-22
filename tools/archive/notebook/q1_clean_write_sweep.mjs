/**
 * ⛔⛔ §10.36 CLASS SWEEP — every write that can reconcile a record CLEAN and
 * empty its queue in the same transaction.
 *
 * THE CLASS (§10.35), named from the STEP 2 spy log rather than from a reading:
 *
 *   > A write that marks a durable record CLEAN and passes a NULL intent,
 *   > without proving that the server holds what the record and the queue were
 *   > carrying.
 *
 * `putNoteWithIntent(db, record, intent)` deletes every queued entry for a note
 * when `intent` is null AND `record.dirty` is falsy — that is the cursor-delete
 * branch, and it is correct when the note really has nothing left to say. Its
 * own class guard (`else if (noteRecord.dirty)`) reads the record it is HANDED,
 * so a writer that flips dirty 1 -> 0 in the same write walks straight past it.
 * That is why the guard cannot live only there and the call sites must be swept.
 *
 * ⛔ AN AST, NEVER A GREP. A grep over this repo has previously "found 5 call
 * sites, all five of them prose". This parses with the same acorn + acorn-jsx
 * pair two standing rails already use, and reports:
 *
 *   · every `putNoteWithIntent` call site, by file:line, with its enclosing fn
 *   · whether the INTENT argument can be null (statically)
 *   · whether the DIRTY field can be falsy (statically)
 *   · whether the enclosing function reads the STORED record (`getNote`) and
 *     whether it calls `sameAuthoredContent`
 *
 * ⛔ THE LAST TWO ARE EVIDENCE, NOT A VERDICT. "Calls sameAuthoredContent"
 * is a PROXY for "proves content" and this tool does not pretend otherwise —
 * it prints what it found and a human states the judgement per site, with the
 * reason. A tool that scored these automatically would be the kind-2 failure
 * this programme keeps cataloguing.
 *
 * Usage:  node tools/q1_clean_write_sweep.mjs [--json]
 *         node tools/q1_clean_write_sweep.mjs --self-check
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const ROOT = path.join(REPO, 'app', 'src', 'pages', 'journal-2-0')
const TARGET = 'putNoteWithIntent'

// acorn lives in app/node_modules, exactly as hub_surface_matrix.mjs resolves it.
const appRequire = createRequire(path.join(REPO, 'app', 'package.json'))
const { Parser } = appRequire('acorn')
const PARSER = Parser.extend(appRequire('acorn-jsx')())

function sourceFiles(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__fixtures__') continue
      out.push(...sourceFiles(p))
    } else if (/\.jsx?$/.test(e.name) && !/\.test\.jsx?$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

function parse(code) {
  return PARSER.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
}

/** Walk every node, carrying the nearest enclosing function. */
function walk(node, fnStack, visit) {
  if (!node || typeof node.type !== 'string') return
  const isFn = /Function(Declaration|Expression)$/.test(node.type) || node.type === 'ArrowFunctionExpression'
  const nextStack = isFn ? [...fnStack, node] : fnStack
  visit(node, nextStack)
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue
    const v = node[key]
    if (Array.isArray(v)) v.forEach((c) => walk(c, nextStack, visit))
    else if (v && typeof v.type === 'string') walk(v, nextStack, visit)
  }
}

function fnName(fn, code) {
  if (!fn) return '(module top level)'
  if (fn.id?.name) return fn.id.name
  // `const persist = async (...) => {}` / `const x = function () {}`
  const before = code.slice(Math.max(0, fn.start - 200), fn.start)
  const m = before.match(/(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)\s*=?\s*(?:async\s*)?$/)
  return m ? m[1] : '(anonymous)'
}

/**
 * ⛔⛔ RESOLVE A LOCAL BINDING BEFORE JUDGING IT.
 *
 * ⚰️ The first version of this sweep analysed the ARGUMENT EXPRESSION and
 * reported `persist at useDurableNote.js:444` as "cannot empty the queue" —
 * while the STEP 2 spy log had already watched it empty the queue. Both
 * arguments there are locals (`record`, `intent`), so the walk saw an
 * Identifier and learned nothing. That is a kind-2 failure inside the very
 * tool written to find this class: the instrument was pointed at a PROXY (the
 * spelling of the argument) for the thing it named (what the argument can BE).
 *
 * So an Identifier is followed to its `const`/`let` declarator inside the
 * enclosing function, once. ⛔ One hop, and unresolved stays UNRESOLVED rather
 * than becoming "safe" — an answer this cannot reach must never read as a pass.
 */
function resolveBinding(arg, fn, code) {
  if (!arg || arg.type !== 'Identifier' || !fn) return arg
  let found = null
  walk(fn, [], (n) => {
    if (n.type !== 'VariableDeclarator') return
    if (n.id?.type === 'Identifier' && n.id.name === arg.name && n.init) found = n.init
  })
  return found || arg
}

/** Can this expression evaluate to null/undefined, statically? */
function intentCanBeNull(arg) {
  if (!arg) return true
  if (arg.type === 'Literal' && arg.value === null) return 'always'
  if (arg.type === 'Identifier' && arg.name === 'undefined') return 'always'
  if (arg.type === 'ConditionalExpression') {
    return intentCanBeNull(arg.consequent) || intentCanBeNull(arg.alternate) ? 'conditionally' : false
  }
  if (arg.type === 'LogicalExpression') {
    return intentCanBeNull(arg.left) || intentCanBeNull(arg.right) ? 'conditionally' : false
  }
  // ⛔ An expression this cannot read is UNRESOLVED, never "cannot be null".
  if (arg.type === 'Identifier' || arg.type === 'MemberExpression' || arg.type === 'CallExpression') {
    return 'unresolved'
  }
  return false
}

/** Find the `dirty:` property in the record argument and describe it. */
function dirtyOf(arg, code) {
  if (!arg || arg.type !== 'ObjectExpression') {
    return arg ? { shape: code.slice(arg.start, Math.min(arg.end, arg.start + 60)).replace(/\s+/g, ' '), falsy: 'unknown' } : { shape: '(none)', falsy: 'unknown' }
  }
  for (const p of arg.properties) {
    if (p.type !== 'Property' || p.key?.name !== 'dirty') continue
    const src = code.slice(p.value.start, p.value.end).replace(/\s+/g, ' ')
    if (p.value.type === 'Literal') return { shape: src, falsy: !p.value.value }
    return { shape: src, falsy: 'conditionally' }
  }
  return { shape: '(inherited via spread / absent)', falsy: 'unknown' }
}

function sweep() {
  const rows = []
  for (const file of sourceFiles(ROOT)) {
    const code = fs.readFileSync(file, 'utf8')
    if (!code.includes(TARGET)) continue
    let ast
    try { ast = parse(code) } catch (e) { rows.push({ file, error: String(e.message) }); continue }
    walk(ast, [], (node, stack) => {
      if (node.type !== 'CallExpression') return
      const callee = node.callee
      const name = callee.type === 'Identifier' ? callee.name
        : callee.type === 'MemberExpression' ? callee.property?.name : null
      if (name !== TARGET) return
      // the declaration itself is not a call site
      const fn = stack[stack.length - 1]
      const enclosing = fnName(fn, code)
      const body = fn ? code.slice(fn.start, fn.end) : code
      const recordArg = resolveBinding(node.arguments[1], fn, code)
      const intentArg = resolveBinding(node.arguments[2], fn, code)
      rows.push({
        file: path.relative(REPO, file).replace(/\\/g, '/'),
        line: node.loc.start.line,
        fn: enclosing,
        dirty: dirtyOf(recordArg, code),
        intentNull: intentCanBeNull(intentArg),
        readsStoredRecord: /\bgetNote\s*\(/.test(body),
        callsSameAuthoredContent: /\bsameAuthoredContent\s*\(/.test(body),
      })
    })
  }
  return rows.sort((a, b) => (a.file + String(a.line).padStart(6, '0')).localeCompare(b.file + String(b.line).padStart(6, '0')))
}

/** ⛔ A sweep that can only answer "nothing" is indistinguishable from a broken
 *  one. This plants both shapes and asserts the sweep tells them apart. */
function selfCheck() {
  const fails = []
  const code = [
    // ⚰️ THE REGRESSION CASE, planted first. Both arguments are LOCALS — the
    // exact shape of `persist at useDurableNote.js:444`, which the first
    // version of this sweep reported as safe while the spy log watched it
    // empty a queue. If binding resolution ever comes out, this goes red.
    'async function viaLocals(db, state) {',
    '  const record = { noteId: 1, dirty: state.synced ? 0 : 1 }',
    '  const intent = record.dirty ? { mutationId: 1 } : null',
    '  await putNoteWithIntent(db, record, intent)',
    '}',
    'async function proves(db, entry) {',
    '  const rec = await getNote(db, entry.noteId)',
    '  const caughtUp = sameAuthoredContent(rec, entry.patch)',
    '  await putNoteWithIntent(db, { noteId: 1, dirty: caughtUp ? 0 : 1 }, caughtUp ? null : entry)',
    '}',
    'async function provesNothing(db, state) {',
    '  await putNoteWithIntent(db, { noteId: 1, dirty: state.synced ? 0 : 1 }, null)',
    '}',
    'async function neverClears(db, entry) {',
    '  await putNoteWithIntent(db, { noteId: 1, dirty: 1 }, { mutationId: 2 })',
    '}',
    // ⛔ A PARAMETER cannot be resolved to a value, and the honest answer is
    // UNRESOLVED. It must NOT read as "cannot be null" — the direction that
    // fails safe is the one that keeps the site on the list.
    'async function viaParameter(db, entry) {',
    '  await putNoteWithIntent(db, { noteId: 1, dirty: 0 }, entry)',
    '}',
  ].join('\n')
  const ast = parse(code)
  const got = []
  walk(ast, [], (node, stack) => {
    if (node.type !== 'CallExpression') return
    if (node.callee?.name !== TARGET) return
    const fn = stack[stack.length - 1]
    const body = code.slice(fn.start, fn.end)
    got.push({
      fn: fnName(fn, code),
      dirty: dirtyOf(resolveBinding(node.arguments[1], fn, code), code),
      intentNull: intentCanBeNull(resolveBinding(node.arguments[2], fn, code)),
      callsSameAuthoredContent: /\bsameAuthoredContent\s*\(/.test(body),
      readsStoredRecord: /\bgetNote\s*\(/.test(body),
    })
  })
  if (got.length !== 5) fails.push(`expected 5 planted call sites, found ${got.length}`)
  const byFn = Object.fromEntries(got.map((r) => [r.fn, r]))
  if (byFn.proves?.intentNull !== 'conditionally') fails.push('a conditional null intent must read as conditionally')
  if (byFn.provesNothing?.intentNull !== 'always') fails.push('a literal null intent must read as always')
  if (byFn.neverClears?.intentNull !== false) fails.push('a non-null intent must read as false — otherwise every site looks dangerous and the sweep says nothing')
  // ⛔ UNRESOLVED IS NOT A PASS. If this ever reads `false` the sweep has started
  // clearing sites it never actually read, which is the flattering direction.
  if (byFn.viaParameter?.intentNull !== 'unresolved') {
    fails.push('an intent this cannot resolve must read as unresolved, never as safe — '
      + `got ${byFn.viaParameter?.intentNull}`)
  }
  if (byFn.provesNothing?.callsSameAuthoredContent !== false) fails.push('the prove-nothing shape must NOT read as proving content')
  if (byFn.proves?.callsSameAuthoredContent !== true) fails.push('the proving shape must read as proving content')
  if (byFn.neverClears?.dirty?.falsy !== false) fails.push('a literal dirty:1 must read as not-falsy')
  // ⛔⛔ THE LOAD-BEARING CASE. Without binding resolution this reads as safe.
  if (byFn.viaLocals?.intentNull !== 'conditionally') {
    fails.push('a null intent reached through a LOCAL must still read as conditionally — '
      + `got ${byFn.viaLocals?.intentNull}. This is the regression that made the sweep `
      + 'report persist at useDurableNote.js:444 as safe.')
  }
  if (byFn.viaLocals?.dirty?.falsy !== 'conditionally') {
    fails.push('a conditional dirty reached through a LOCAL must read as conditionally — '
      + `got ${byFn.viaLocals?.dirty?.falsy}`)
  }
  fails.forEach((f) => console.log('  ⛔', f))
  console.log('self-check:', fails.length ? 'FAIL'
    : 'PASS — the sweep resolves a local binding, and distinguishes a proving write, '
      + 'a prove-nothing write, and a write that never clears')
  return fails.length ? 1 : 0
}

const args = process.argv.slice(2)
if (args.includes('--self-check')) process.exit(selfCheck())

const rows = sweep()
if (args.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2))
} else {
  console.log(`§10.36 sweep — ${TARGET} call sites under app/src/pages/journal-2-0/ (tests excluded)\n`)
  for (const r of rows) {
    if (r.error) { console.log(`  ⛔ ${r.file}: ${r.error}`); continue }
    const canClear = r.intentNull !== false && r.dirty.falsy !== false
    console.log(`${canClear ? '⛔' : '  '} ${r.file}:${r.line}  ${r.fn}`)
    console.log(`     dirty: ${r.dirty.shape}   (falsy: ${r.dirty.falsy})`)
    console.log(`     intent can be null: ${r.intentNull}`)
    console.log(`     reads stored record: ${r.readsStoredRecord}   calls sameAuthoredContent: ${r.callsSameAuthoredContent}`)
    console.log(`     => ${canClear ? 'CAN empty the queue in this write' : 'cannot empty the queue here'}`)
  }
  const flagged = rows.filter((r) => !r.error && r.intentNull !== false && r.dirty.falsy !== false)
  console.log(`\n${rows.length} call site(s); ${flagged.length} can empty the queue.`)
  console.log('⛔ "calls sameAuthoredContent" is EVIDENCE, not a verdict — state the judgement per site, with the reason.')
}
