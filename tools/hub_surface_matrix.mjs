#!/usr/bin/env node
// ⛔ THE SURFACE MATRIX — what the joystick hub actually exposes, DERIVED, never typed.
//
// It answers one question the launch gate keeps asking and nobody should answer from memory:
// **which surfaces does a member reach today, and which of them arrived after Increment 2?**
// `docs/plans/joystick/glass-acceptance.md`'s step list is generated from this output, so a
// surface that ships without a glass step is a discrepancy this file makes visible.
//
// ── WHAT IT READS ──────────────────────────────────────────────────────────────────────────────
//   1. `app/src/hub/registry.js` — imported TWICE, once from the worktree and once at a baseline
//      commit, so "new since Increment 2" is a diff of two structures rather than a recollection.
//      The baseline default is `febe8ee67`, the Increment-2 manifest-of-record commit.
//   2. `app/src/hub/sections/*.js` — the controllers, for the mode-level gesture bindings
//      (`onTap` = Primary, `onDoubleTap` = Reverse, `onScrub`/`readout` = the scrub) and for the
//      `case '<action id>'` arm that handles each action.
//   3. `app/src/hub/writePaths.test.js` — the write-path MANIFEST, which is already the repo's
//      single claim about what the hub can write, joined here rather than restated.
//
// ⛔ PROSE IS NEVER MATCHED. Two mechanisms, and the difference matters: the GESTURE BINDINGS are
// read from a parse tree (`bindingsIn`), where a comment is not a node at all; everything else —
// the handler arms, the write join — still runs over `strip()`ed source, and `--self-check` proves
// both. This repo has paid six times in one session for an instrument that matched the prose
// describing a call instead of the call, including in this very directory (`writePaths.test.js`
// says so in its own header). Every controller here writes `onScrub` in its comments; a scanner
// that counts those reports bindings nobody wired.
//
// ⚰️ AND IT PAID A SEVENTH TIME HERE. `bindingsIn` was a regex for the COLON form, so ES6
// shorthand — `{ onTap, onDoubleTap, onScrub, onScrubCommit, readout }`, which is how `wire`,
// `home` and half of `journal` declare theirs — was invisible, and this file published
// "— none —" for two modes that wire everything. See `bindingsIn` below: **D-42**.
//
// ── WHAT IT DOES NOT CLAIM ─────────────────────────────────────────────────────────────────────
// The write column is a JOIN, not a dataflow proof: an action is credited with an endpoint when its
// handler arm calls a symbol that the manifest's own `via` module defines as performing that write.
// An arm this scanner cannot locate prints `?` — UNRESOLVED, never blank — because a blank would
// read as "writes nothing", and the scanner cannot tell those two apart.
//
// Usage:
//   node tools/hub_surface_matrix.mjs                 # markdown to stdout
//   node tools/hub_surface_matrix.mjs --json
//   node tools/hub_surface_matrix.mjs --baseline <sha>
//   node tools/hub_surface_matrix.mjs --self-check    # prove the scanner can fail
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const HUB = path.join(REPO, 'app', 'src', 'hub')
const SECTIONS = path.join(HUB, 'sections')

const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const BASELINE = arg('--baseline', 'febe8ee67')

/** ⛔ Strip block comments, then line comments — nothing below ever matches prose. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/**
 * ⛔ THE REPO'S OWN PARSER, RESOLVED THE WAY THE APP RESOLVES IT — this adds no dependency.
 *
 * `acorn` + `acorn-jsx` are already imported directly by two standing rails
 * (`components/screener/reachable.test.js:48` and
 * `chart/engine/__tests__/singleWriterIndex.test.js:51`), which is what makes them "the repo's
 * existing parser" rather than a new one. They live in `app/node_modules` and this script runs
 * from the repo ROOT, so the require is anchored at `app/package.json` instead of being left to
 * walk up from `tools/` and find nothing.
 */
const appRequire = createRequire(pathToFileURL(path.join(REPO, 'app', 'package.json')))
let PARSER = null
function parseJs(src) {
  if (!PARSER) {
    try {
      const { Parser } = appRequire('acorn')
      PARSER = Parser.extend(appRequire('acorn-jsx')())
    } catch (e) {
      // ⛔⛔ NO SILENT FALLBACK TO A REGEX. A scanner that quietly degrades and keeps printing a
      // confident table is exactly how D-42 shipped a glass sheet asserting the opposite of the
      // product. A missing parser is a FAILED INVOCATION, not a clean tree (rule 14).
      throw new Error('hub_surface_matrix: acorn is unavailable — run `npm ci` in app/ '
        + `(resolution is anchored at app/package.json). Original: ${e?.message || e}`)
    }
  }
  return PARSER.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
}

/** Depth-first over every node. Positional fields are skipped — they carry no children, and a
 *  `loc` object would otherwise be walked once per node for nothing. */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return }
  if (typeof node.type === 'string') visit(node)
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue
    walk(node[k], visit)
  }
}

/** Gesture bindings a mode controller can declare. Keys, not mentions. */
const BINDING_KEYS = ['onTap', 'onDoubleTap', 'onScrub', 'onScrubCommit', 'readout', 'onPeek']
const BINDING_ROLE = {
  onTap: 'Primary (tap)',
  onDoubleTap: 'Reverse (double-tap)',
  onScrub: 'Scrub (drag y)',
  onScrubCommit: 'Scrub commit (release)',
  readout: 'Chip readout',
  onPeek: 'Peek',
}

const controllerFiles = () => readdirSync(SECTIONS)
  .filter((f) => /\.jsx?$/.test(f) && !/\.test\.jsx?$/.test(f))
  .map((f) => ({ file: f, raw: readFileSync(path.join(SECTIONS, f), 'utf8') }))
  .map((c) => ({ ...c, src: strip(c.raw) }))

/** Which controller serves a mode — the two signals `runActionsHaveHandlers.test.js` settled on:
 *  by FILENAME (`screenerSection.js` serves `scan`, so ids alone are wrong) and by HANDLED ID
 *  (`wireSection.js` matches by suffix and never contains `'wire.`, so name alone is wrong too). */
const controllersFor = (modeId, ctrls) => ctrls
  .filter((c) => c.file === `${modeId}Section.js` || c.src.includes(`'${modeId}.`))
  .map((c) => c.file)

/**
 * Bindings a controller DEFINES — the keys of an object LITERAL, read from the parse tree.
 *
 * ⚰️⛔⛔ THIS MATCHED THE COLON FORM ONLY (`key` followed by `:`) AND WAS THEREFORE BLIND TO ES6
 * SHORTHAND. `wireSection.js:282-286` and `homeSection.js:240-244` return
 * `{ onTap, onDoubleTap, onScrub, onScrubCommit, readout }` and this file printed **“— none —”**
 * for both. `journalSection.js:642-646` writes `onTap:`/`onDoubleTap:` with a colon and
 * `onScrub,`/`onScrubCommit,`/`readout,` shorthand, so its SCRUB — the stop-adjust flagship — was
 * missing from a matrix that confidently listed its tap.
 *
 * `glass-acceptance-steps.md` is GENERATED from this output, so ten shipped surfaces had no glass
 * step at all and `GS-wire-0` published *“Tap, double-tap and scrub do **nothing** here”* for a
 * mode that wires all four. An operator running that sheet files a FAIL against working code, or
 * passes a broken one. Filed **D-42** by the completion audit, 2026-09-13; fixed here.
 *
 * ⭐ THE SELF-CHECK COULD NOT HAVE CAUGHT IT. Its case 2 fixture was `{ onScrub: (ctx, s) => s }`
 * — the colon form — so the control only ever exercised the one shape the scanner could see. A
 * fixture that cannot distinguish is not a rail, and this one sat inside the instrument built to
 * make exactly this class of gap visible.
 *
 * ⛔ AN AST, NOT A WIDER REGEX. Accepting a comma or a brace after the key would also match a
 * destructuring pattern (`const { onScrub } = props`), an argument list, and a key inside a
 * string — every one of them a MENTION, which is the defect this file's header is about. The
 * parse tree separates them by construction: only the properties of an **ObjectExpression**
 * count, a computed key is skipped because `{ [k]: v }` names nothing statically, and an
 * **ObjectPattern** is a different node type, so a destructure can never read as a declaration.
 *
 * ⭐ IT ALSO RETIRES `strip()` HERE, so this reads the RAW file: a parser never sees a comment at
 * all, which is a stronger guarantee than deleting them first — and `strip`'s line-comment pass
 * would truncate a `'https://…'` literal on its way past and fail the parse.
 *
 * ⚠️ SCOPE, stated rather than discovered later from a blank cell: an object literal's own keys.
 * A binding attached afterwards (`config.onTap = fn`) is not seen. No controller does that today;
 * if one ever does, widen this deliberately.
 *
 * ── MUTATION PROOF, PERFORMED 2026-09-13 ──────────────────────────────────────────────────────
 * ⛔ Not a claim — a run. The AST body below was replaced, IN PLACE, with the colon-only regex it
 * supersedes, and `--self-check` was re-run. It exited 1 with eleven named failures, among them:
 *
 *     ES6 shorthand bindings were missed
 *     the mixed colon + comma-list form was missed
 *     wireSection.js declares onScrubCommit and the scanner did not see it
 *
 * ⭐ Nine cases stayed GREEN — the colon-form positive, the destructure and computed-key
 * negatives, the manifest parse, the controller lookup, the write map and both dispatch cases —
 * which is what proves the red came from the PARSER and not from the harness falling over. A
 * mutation run where everything goes red proves only that something broke.
 *
 * The mutation was reverted by writing the original bytes back, never `git checkout`
 * (`feedback_mutation_check_never_git_checkout`), and the restored file was byte-compared.
 */
const bindingsIn = (src) => {
  const found = new Set()
  walk(parseJs(src), (n) => {
    if (n.type !== 'ObjectExpression') return
    for (const p of n.properties || []) {
      if (p.type !== 'Property' || p.computed) continue
      const k = p.key
      const name = k?.type === 'Identifier' ? k.name : (k?.type === 'Literal' ? k.value : null)
      if (typeof name === 'string' && BINDING_KEYS.includes(name)) found.add(name)
    }
  })
  // Ordered by BINDING_KEYS, never by source position: the glass sheet numbers its steps off this
  // list, so a step id must not move because a controller reordered its own object.
  return BINDING_KEYS.filter((k) => found.has(k))
}

/**
 * The spec's own words for what each mode's gestures DO — §C3, read from the spec of record.
 *
 * ⛔ THE SPEC FILE IS DERIVED, never typed. A rail pinned to `v1.6` stops reading the spec the day
 * `v1.7` lands and passes for ever against a document nobody edits any more.
 *
 * §C3 gives each mode one line of the shape
 *   `- Primary: next note. Reverse: previous note. Scrub: scroll the notes list.`
 * under a `### <mode> — <route>` heading. Anything it does not state comes back `null`, and a
 * `null` prints as UNSTATED rather than as a sentence this file invented.
 */
function specPromises() {
  const dir = path.join(REPO, 'docs', 'plans', 'joystick')
  const versioned = readdirSync(dir)
    .filter((f) => /^00-master-spec-v[\d.]+\.md$/.test(f))
    .sort((a, b) => {
      const n = (s) => s.match(/v([\d.]+)\./)[1].split('.').map(Number)
      const [x, y] = [n(a), n(b)]
      for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
        if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0)
      }
      return 0
    })
  if (!versioned.length) throw new Error(`hub_surface_matrix: no 00-master-spec-v*.md under ${dir}`)
  const file = versioned[versioned.length - 1]
  const text = readFileSync(path.join(dir, file), 'utf8')
  const out = new Map()
  let mode = null
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^### (\S+)\s*—/)
    if (h) mode = h[1]
    if (!mode || !line.startsWith('- Primary:')) continue
    const grab = (label) => {
      const m = line.match(new RegExp(`${label}:\\s*([^.]+)\\.`))
      return m ? m[1].trim() : null
    }
    out.set(mode, { primary: grab('Primary'), reverse: grab('Reverse'), scrub: grab('Scrub') })
  }
  return { file, promises: out }
}

/**
 * Resolve a binding to the FUNCTION that runs, through the two indirections controllers use.
 *
 * ⛔ A SHORTHAND PROPERTY IS A REFERENCE, NOT A BODY. `wireSection.js` returns `{ onTap, … }` where
 * `onTap` is `useCallback(() => { next() }, …)` declared 70 lines above; reading the property's
 * value node alone yields an Identifier and tells you nothing. So: shorthand → the `const` it
 * names → the first argument of the `use*` hook wrapping it.
 */
function resolveBindingFn(ast, key) {
  const decls = new Map()
  walk(ast, (n) => {
    if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier') decls.set(n.id.name, n.init)
  })
  const unwrap = (node) => {
    if (!node) return null
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier'
        && /^use[A-Z]/.test(node.callee.name)) return node.arguments?.[0] ?? null
    return node
  }
  let found = null
  walk(ast, (n) => {
    if (n.type !== 'ObjectExpression') return
    for (const p of n.properties || []) {
      if (p.type !== 'Property' || p.computed) continue
      const name = p.key?.type === 'Identifier' ? p.key.name : p.key?.value
      if (name !== key) continue
      let v = p.value
      if (p.shorthand && v?.type === 'Identifier') v = unwrap(decls.get(v.name))
      else v = unwrap(v)
      if (v) found = { fn: v, decls }
    }
  })
  return found
}

/** Every function name a node calls, bare or through a member. */
function callsIn(node) {
  const out = new Set()
  walk(node, (n) => {
    if (n.type !== 'CallExpression') return
    const c = n.callee
    if (c?.type === 'Identifier') out.add(c.name)
    else if (c?.type === 'MemberExpression') {
      const prop = c.property?.type === 'Identifier' ? c.property.name : c.property?.value
      if (prop) out.add(prop)
    }
  })
  return out
}

/**
 * What a binding DOES, classified from the controller rather than guessed from its name.
 *
 * ⚰️ THIS EXISTS BECAUSE THE SHEET PUBLISHED FOUR SENTENCES ABOUT `home` THAT WERE NEVER TRUE.
 * Every expected result used to be a lookup on the binding KEY, so every mode was described as
 * stepping a cursor and revealing a row. `home` NAVIGATES — Primary to the last-used section,
 * Reverse to Wire, release to the section under the cursor — and `homeSection.js` says in so many
 * words that nothing on its page moves during a scrub. An operator running those rows on a fresh
 * account sees nothing happen, reads the sheet, and files a FAIL against code obeying spec
 * §C3:915. That is **D-44**, found on glass 2026-09-13, and it is D-42's defect one layer up:
 * D-42 was the sheet not knowing a binding EXISTS, D-44 was it not knowing what the binding DOES.
 *
 * Three outcomes, decided in this order and each from a DIFFERENT source so they cannot all be
 * wrong the same way:
 *   · `navigate` — the body reaches a `navigate` call. A route change beats everything: `home`
 *     declares a cursor AND navigates, and what the member sees is the route change.
 *   · `cursor`   — the mode declares `cursor.listId` in the registry.
 *   · `cycle`    — neither: it steps a fixed set in place (breadth's tabs, chart's timeframes).
 * A binding whose function cannot be resolved returns `unresolved` and PRINTS as unresolved. A
 * guess here would be indistinguishable from a measurement, which is the whole disease.
 */
function bindingSemantics(ast, key, hasCursor) {
  const resolved = resolveBindingFn(ast, key)
  if (!resolved) return { kind: 'unresolved', guarded: false }
  const calls = callsIn(resolved.fn)
  const kind = calls.has('navigate') ? 'navigate' : (hasCursor ? 'cursor' : 'cycle')
  return { kind, guarded: hasEarlyReturnGuard(resolved.fn), calls: [...calls] }
}

/**
 * Does the body open with a guard that can make the whole gesture do nothing?
 *
 * ⭐ THIS IS THE OTHER HALF OF D-44. `homeSection.js`'s Primary begins
 * `if (!lastSection || !DECLARED_SECTION_ORDER.includes(lastSection)) return` — spec §C3:915
 * requires it to be inert on a first-ever visit, because defaulting it to Wire would make Primary
 * and Reverse fire the same destination. An operator who is not told that reads "nothing happened"
 * as a failure. The shape is cheap to detect and precise: the first statement is an `if` whose
 * consequent is a bare `return`.
 */
function hasEarlyReturnGuard(fn) {
  const body = fn?.body
  if (!body || body.type !== 'BlockStatement') return false
  const first = body.body?.[0]
  if (!first || first.type !== 'IfStatement' || first.alternate) return false
  const c = first.consequent
  if (c?.type === 'ReturnStatement' && !c.argument) return true
  return c?.type === 'BlockStatement' && c.body.length === 1
    && c.body[0].type === 'ReturnStatement' && !c.body[0].argument
}

/** The manifest in `writePaths.test.js`, read from the array literal itself. */
function writeManifest() {
  const src = readFileSync(path.join(HUB, 'writePaths.test.js'), 'utf8')
  const body = src.slice(src.indexOf('const WRITE_PATHS = ['))
  const out = []
  const re = /endpoint:\s*'([^']+)',\s*\n\s*method:\s*'([^']+)',\s*\n\s*via:\s*'([^']+)',\s*\n\s*owner:\s*'([^']+)'/g
  let m
  while ((m = re.exec(body)) !== null) out.push({ endpoint: m[1], method: m[2], via: m[3], owner: m[4] })
  return out
}

/** symbol → endpoint: for each `via` module, the NAME ENCLOSING each write call site.
 *
 *  ⛔ ONLY the enclosing declaration, never "every exported name in a module that writes". The
 *  first version of this function did the latter and credited `scan.scans` — a picker that opens a
 *  sheet — with `POST /api/watchlists/flagged/sync`, because it called a same-named export from a
 *  module that happens to contain a write. An instrument reporting a property of ITSELF as a
 *  property of the product is the exact defect this file's header warns about; a `?` is the honest
 *  answer where the join cannot resolve. */
function symbolEndpointMap(manifest) {
  const map = new Map()
  for (const p of manifest) {
    const file = path.join(REPO, 'app', 'src', p.via)
    let src
    try { src = strip(readFileSync(file, 'utf8')) } catch { continue }
    const re = /method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/g
    let m
    while ((m = re.exec(src)) !== null) {
      const before = src.slice(0, m.index)
      const decl = [...before.matchAll(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g)].pop()
      const name = decl && (decl[1] || decl[2])
      if (name && !/^(use[A-Z]|[A-Z])/.test(name)) map.set(name, `${p.method} ${p.endpoint}`)
    }
  }
  return map
}

/** Every file that can dispatch an action: the section controllers plus `HubRoot.jsx`, which owns
 *  `.voice` for every mode and says so in each controller's default arm. */
function dispatchFiles(ctrls) {
  const root = path.join(HUB, 'HubRoot.jsx')
  const raw = readFileSync(root, 'utf8')
  return [...ctrls.map((c) => ({ ...c, label: `sections/${c.file}` })),
    { file: 'HubRoot.jsx', raw, src: strip(raw), label: 'HubRoot.jsx' }]
}

/** How far a handler arm runs, from just after the id literal.
 *
 *  Walks brackets rather than bytes: a `,`/`;` at depth zero ends a map entry
 *  (`'journal.planTrade': () => openPlanSheet(),`), a closed block ends an `if` arm
 *  (`if (action.id === 'notebook.newNote') { … }`), and a `case` arm ends at its `break`/`return`
 *  or the next `case`. A stray closer just steps out of an enclosing paren — never a stop.
 *  Hard ceiling 700 chars so a pathological shape truncates rather than swallowing the file. */
function armEnd(rest) {
  let depth = 0
  let closedBlock = false
  for (let i = 0; i < Math.min(rest.length, 700); i += 1) {
    const ch = rest[i]
    if (ch === '(' || ch === '{' || ch === '[') depth += 1
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth -= 1
      if (depth <= 0) { depth = 0; if (ch === '}') closedBlock = true }
    } else if (depth === 0) {
      if (ch === ',' || ch === ';') return i + 1
      if (ch === '\n' && closedBlock) return i
    }
    if (depth === 0 && rest.startsWith('case ', i)) return i
  }
  return Math.min(rest.length, 700)
}

/** Where one action id is handled, and the symbols that arm calls.
 *
 *  ⛔ THE DISPATCH SHAPE IS NOT ONE SHAPE — this is why the search is for the id LITERAL and not
 *  for `case`. Measured in this tree: `screenerSection.js` uses `switch/case`, `journalSection.js`
 *  a `{ 'journal.moveStop': () => … }` map literal, `notebookSection.js` a chain of
 *  `if (action.id === …)`, and `.voice` is dispatched in `HubRoot.jsx` by SUFFIX
 *  (`action.id.endsWith('.voice')`) for all ten modes. A `case`-only scan reported four of ten
 *  modes as having no handler at all. */
function handlerFor(actionId, files) {
  const suffix = actionId.slice(actionId.indexOf('.'))
  const at = (c, needle) => {
    const idx = c.src.indexOf(needle)
    if (idx < 0) return null
    // ⛔ THE ARM ENDS WHERE THE STATEMENT ENDS, not at a fixed byte count. A flat 700-char window
    // ran out of `'journal.planTrade': () => openPlanSheet(),` — a one-line map entry — through
    // the whole `config` memo below it, and credited Plan trade with
    // `PUT /api/j2/positions/{id}`, a write it does not perform, printed with exactly the same
    // confidence as a real one. `armEnd` walks brackets instead of counting bytes.
    const arm = c.src.slice(idx, idx + needle.length + armEnd(c.src.slice(idx + needle.length)))
    return {
      file: c.label,
      line: c.raw.slice(0, c.raw.indexOf(needle)).split('\n').length,
      calls: [...new Set([...arm.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]))],
    }
  }
  // Pass 1 — the action's own id, wherever it is dispatched.
  for (const c of files) {
    const hit = at(c, `'${actionId}'`)
    if (hit) return hit
  }
  // Pass 2 — SUFFIX dispatch, and `HubRoot.jsx` is asked FIRST on purpose.
  // ⛔ `screenerSection.js:331` also contains `endsWith('.voice')`, in a line that PASSES the
  // action THROUGH (`out.push(action)`) rather than running it. Scanning controllers first
  // therefore attributed every Voice bubble to a projection arm — a mention, not a handler.
  const root = files.find((c) => c.file === 'HubRoot.jsx')
  const ordered = root ? [root, ...files.filter((c) => c !== root)] : files
  for (const c of ordered) {
    const hit = at(c, `endsWith('${suffix}')`)
    if (hit) return hit
  }
  return null
}

async function loadRegistry(ref) {
  if (ref === 'WORKTREE') return import(pathToFileURL(path.join(HUB, 'registry.js')).href)
  const src = execFileSync('git', ['show', `${ref}:app/src/hub/registry.js`], { cwd: REPO, maxBuffer: 8e6 })
  const dir = mkdtempSync(path.join(tmpdir(), 'hubreg-'))
  const f = path.join(dir, `reg-${ref.replace(/[^\w]/g, '')}.mjs`)
  writeFileSync(f, src)
  return import(pathToFileURL(f).href)
}

function snapshot(M) {
  const actions = new Map()
  const modes = M.modes.map((m) => {
    const projected = M.fanFor(m).map((a) => a.id)
    for (const a of m.fan || []) {
      actions.set(a.id, {
        id: a.id, mode: m.id, label: a.label, kind: a.kind, ring: a.ring, to: a.to ?? null,
        escalate: a.escalate === true, flickable: a.flickable !== false,
        requires: a.requires ?? [], reachable: projected.includes(a.id),
      })
    }
    return {
      id: m.id, label: m.label, route: m.route ?? null, tapHint: m.tapHint ?? null,
      cursor: m.cursor?.listId ?? null, preview: M.PREVIEW_MODES.has(m.id),
      fan: (m.fan || []).map((a) => a.id), projected,
    }
  })
  return { modes, actions }
}

async function build() {
  // ⛔ THE NUMBERS COME FROM `constants.js`, NEVER FROM THIS FILE. The sheet used to type
  //    "(`DOUBLE_TAP_MS` 280)" beside the constant it was describing — a hand-typed count next to
  //    its own source, which is the drift this whole tool exists to stop.
  const K = await import(pathToFileURL(path.join(HUB, 'constants.js')).href)
  const spec = specPromises()
  const ctrls = controllerFiles()
  const files = dispatchFiles(ctrls)
  const manifest = writeManifest()
  const symbols = symbolEndpointMap(manifest)
  const now = snapshot(await loadRegistry('WORKTREE'))
  const base = snapshot(await loadRegistry(BASELINE))

  const rows = []
  for (const m of now.modes) {
    const modeControllers = controllersFor(m.id, ctrls)
    const bindings = [...new Set(modeControllers.flatMap((f) => bindingsIn(ctrls.find((c) => c.file === f).raw)))]
    // What each binding DOES, read from the controller that serves this mode (D-44).
    const semantics = {}
    for (const f of modeControllers) {
      const ast = parseJs(ctrls.find((c) => c.file === f).raw)
      for (const k of bindings) {
        const s = bindingSemantics(ast, k, !!m.cursor)
        if (s.kind !== 'unresolved' || !semantics[k]) semantics[k] = s
      }
    }
    const was = base.modes.find((x) => x.id === m.id)
    rows.push({
      row: 'mode', mode: m.id, label: m.label, route: m.route, cursor: m.cursor,
      tapHint: m.tapHint, preview: m.preview, controllers: modeControllers,
      semantics,
      bindings: bindings.map((b) => ({ key: b, role: BINDING_ROLE[b] })),
      newlyLive: was?.preview === true && m.preview === false,
      cursorNew: !was?.cursor && !!m.cursor,
    })
    for (const id of m.fan) {
      const a = now.actions.get(id)
      const b = base.actions.get(id)
      const h = handlerFor(id, files)
      const hits = h ? [...new Set(h.calls.map((c) => symbols.get(c)).filter(Boolean))] : []
      // `navigate` and `home` change the route and nothing else — a structural `—`, not an
      // unresolved join. Every other empty result stays `?`: the scanner looked and could not tell.
      const structural = a.kind === 'navigate' || a.kind === 'home'
      rows.push({
        row: 'action', ...a,
        handler: h ? `${h.file}:${h.line}` : null,
        write: hits.length ? hits.join(' + ') : (structural ? '— (route only)' : '?'),
        isNew: !b,
        becameReachable: !!b && b.reachable === false && a.reachable === true,
        changed: b ? ['kind', 'ring', 'escalate', 'flickable', 'label'].filter((k) => b[k] !== a[k]) : [],
      })
    }
  }
  return { baseline: BASELINE, generatedFrom: 'tools/hub_surface_matrix.mjs', manifest, rows,
    constants: { HOLD_MS: K.HOLD_MS, DOUBLE_TAP_MS: K.DOUBLE_TAP_MS }, spec }
}

function markdown({ baseline, rows }) {
  const L = []
  L.push(`<!-- GENERATED by tools/hub_surface_matrix.mjs (baseline ${baseline}) — do not hand-edit -->`)
  L.push('')
  L.push('| Mode | Surface | Kind | Ring | Flick | Esc | Requires | Write path | Handled in | Since Inc 2 |')
  L.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const r of rows) {
    if (r.row === 'mode') {
      const b = r.bindings.map((x) => x.role).join(' · ') || '— none —'
      const since = r.newlyLive ? '**LEFT PREVIEW**' : (r.cursorNew ? '**cursor added**' : '')
      const where = r.route || 'in place'
      L.push(`| **${r.mode}** | _mode_ · ${where} · chip “${r.tapHint}” · ${b}${r.cursor ? ` · cursor \`${r.cursor}\`` : ''} | | | | | | | ${r.controllers.join(', ') || '— no controller —'} | ${since} |`)
    } else {
      const since = r.isNew ? '**NEW action**'
        : r.becameReachable ? '**newly reachable**'
        : (r.changed.length ? `changed: ${r.changed.join(',')}` : '')
      L.push(`| ${r.mode} | \`${r.id}\` “${r.label}” | ${r.kind}${r.to ? ` → ${r.to}` : ''} | ${r.ring === 0 ? 'outer' : 'inner'} | ${r.flickable ? 'yes' : '⛔ no'} | ${r.escalate ? 'yes' : ''} | ${r.requires.join(',')} | ${r.write} | ${r.handler || '—'} | ${since} |`)
    }
  }
  return L.join('\n')
}

function selfCheck() {
  const fails = []
  let cases = 0
  // ⛔ THE CASE COUNT IS DERIVED. The line this printed read "9 cases" while the function
  //    held nine — and a hand-typed number beside the thing it counts is the drift this whole
  //    file exists to stop (`lesson_a_second_authority_over_one_value`).
  const ok = (cond, what) => { cases += 1; if (!cond) fails.push(what) }
  // ── BINDING DISCOVERY ────────────────────────────────────────────────────────────────────────
  // ⛔ RAW SOURCE, NOT `strip()`ed. These cases test the PARSER, which is what refuses prose now;
  // passing pre-stripped text would have tested `strip` and left the real mechanism unproved —
  // the shape of D-42 itself, whose only binding fixture was the one form the scanner could see.
  //
  // 1. A binding mentioned ONLY in a comment must not count — neither comment style.
  ok(bindingsIn('// onScrub: the thing\n/* onTap: nor this */\nconst x = 1\n').length === 0,
    'a comment was counted as a binding')
  // 2. A real colon-form binding must count — the control that proves case 1 is not vacuous.
  ok(bindingsIn('const cfg = { onScrub: (ctx, s) => s }').includes('onScrub'),
    'a real colon-form onScrub was missed')
  // 2b. ⛔⛔ D-42, THE CASE THAT DID NOT EXIST. `{ onScrub }` is the same declaration as
  //     `{ onScrub: onScrub }`, and the colon-only matcher this replaced read it as ABSENT — for
  //     all of `wire`, all of `home`, and the scrub half of `journal`.
  ok(bindingsIn('const cfg = { onTap, onDoubleTap }').join() === 'onTap,onDoubleTap',
    'ES6 shorthand bindings were missed')
  // 2c. …and the comma-list form as the controllers actually write it: a spread, a colon key, then
  //     a run of shorthand keys, inside the `useMemo` every section returns.
  ok(bindingsIn('const c = useMemo(() => ({ ...mode, onTap: f, onDoubleTap, onScrub, onScrubCommit,'
    + ' readout, listAdapter }), [])').join() === 'onTap,onDoubleTap,onScrub,onScrubCommit,readout',
    'the mixed colon + comma-list form was missed')
  // 2d. A quoted key is still a key.
  ok(bindingsIn("const c = { 'onPeek': f }").includes('onPeek'), 'a quoted key was missed')
  // 3. The needle this repo keeps tripping on: a comment that NAMES the key it forbids.
  ok(bindingsIn('/* never add onPeek: here */\nconst c = { onTap: () => {} }').join() === 'onTap',
    'a forbidding comment was read as a binding')
  // 3b. ⛔ A DESTRUCTURE IS NOT A DECLARATION — the false positive a merely-widened regex would
  //     have introduced. `const { onScrub } = props` CONSUMES a binding; it does not offer one.
  ok(bindingsIn('const { onScrub, readout } = props').length === 0,
    'a destructuring pattern was counted as a declaration')
  // 3c. …nor is a member read, a call argument, or a string that happens to contain the key.
  ok(bindingsIn('mode.onScrub(ctx); const s = "onTap: x"; f({ a: 1 })').length === 0,
    'a member read, an argument or a string literal was counted')
  // 3d. A computed key names nothing statically, so it is skipped rather than guessed at.
  ok(bindingsIn('const k = "onTap"; const c = { [k]: f }').length === 0, 'a computed key was counted')
  // 3e. ⭐ THE CONTROL ON THE REAL TREE. Cases 2b-2d are fixtures; this is the shipped file that
  //     D-42 reported as "— none —". Named members, never a count: a count drifts the day a
  //     controller gains a binding and turns a correct change into a red self-check.
  const wireBindings = bindingsIn(controllerFiles().find((c) => c.file === 'wireSection.js').raw)
  for (const k of ['onTap', 'onDoubleTap', 'onScrub', 'onScrubCommit', 'readout']) {
    ok(wireBindings.includes(k), `wireSection.js declares ${k} and the scanner did not see it`)
  }
  // 4. The manifest must parse to the same count the file declares.
  const man = writeManifest()
  const declared = (readFileSync(path.join(HUB, 'writePaths.test.js'), 'utf8').match(/\n\s{4}endpoint:/g) || []).length
  ok(man.length === declared, `manifest parsed ${man.length} of ${declared} declared entries`)
  // 5. A mode whose controller filename does NOT match its id must still resolve.
  ok(controllersFor('scan', controllerFiles()).includes('screenerSection.js'), 'scan -> screenerSection.js lookup broke')
  // 6. The write join must not credit a hook FACTORY with the write its returned verb performs —
  //    the loose version of this map put `POST /api/watchlists/flagged/sync` on `scan.scans`.
  const sym = symbolEndpointMap(man)
  ok(![...sym.keys()].some((k) => /^use[A-Z]/.test(k)), 'a hook factory name entered the write map')
  // 7. …and it must still credit a real one, so case 6 is not passing by emptiness.
  ok(sym.size > 0, 'the write map resolved no symbols at all')
  // 8. Dispatch discovery must find a map-literal arm, not only `switch/case`.
  const f = dispatchFiles(controllerFiles())
  ok(handlerFor('journal.moveStop', f)?.file === 'sections/journalSection.js', 'map-literal dispatch was missed')
  ok(handlerFor('scan.voice', f)?.file === 'HubRoot.jsx', 'HubRoot suffix dispatch for .voice was missed')

  // ── D-44: WHAT A BINDING DOES, NOT WHAT IT IS CALLED ──────────────────────────────────────────
  // Every case below existed only after the sheet was caught publishing four sentences about
  // `home` that were never true, and a scrub step that omitted the hold it requires.
  const astOf = (src) => parseJs(src)

  // 9. A NAVIGATE mode: the body reaches `navigate`, and that beats a declared cursor.
  ok(bindingSemantics(astOf('const c = { onTap: (ctx) => ctx?.navigate?.(x) }'), 'onTap', true).kind === 'navigate',
    'a navigating binding was not classified as navigate')
  // 10. A CURSOR mode: no navigate, and the registry declares a cursor list.
  ok(bindingSemantics(astOf('const c = { onTap: () => next() }'), 'onTap', true).kind === 'cursor',
    'a cursor binding was not classified as cursor')
  // 11. A CYCLE mode: no navigate, no cursor — it steps a fixed set in place.
  ok(bindingSemantics(astOf('const c = { onTap: () => step(+1) }'), 'onTap', false).kind === 'cycle',
    'a cycling binding was not classified as cycle')
  // 12. ⛔ SHORTHAND AGAIN, one level deeper. `wireSection.js` returns `{ onTap }` where onTap is a
  //     `useCallback` declared far above; reading the property's value alone yields an Identifier
  //     and classifies nothing. This is the case that makes the other three reach real code.
  ok(bindingSemantics(astOf('const onTap = useCallback(() => { next() }, [next])\nconst c = { onTap }'),
    'onTap', true).kind === 'cursor', 'a shorthand binding was not resolved to its useCallback body')
  // 13. An absent binding is UNRESOLVED and must never be guessed at.
  ok(bindingSemantics(astOf('const c = { readout: () => 1 }'), 'onTap', true).kind === 'unresolved',
    'a missing binding was given a classification anyway')
  // 14. ⭐ THE GUARD. `homeSection.js`'s Primary opens with `if (!lastSection) return` because spec
  //     §C3:915 requires it to be inert on a first-ever visit. An operator not told that reads
  //     "nothing happened" as a failure.
  ok(bindingSemantics(astOf('const c = { onTap: (ctx) => { if (!x) return; ctx.navigate(x) } }'), 'onTap', false).guarded,
    'an early-return guard was not detected')
  // 15. …and the control: an unguarded body must not claim a precondition.
  ok(!bindingSemantics(astOf('const c = { onTap: (ctx) => { ctx.navigate(x) } }'), 'onTap', false).guarded,
    'an unguarded binding was reported as having a precondition')

  // 16. ⛔⛔ THE HOLD SENTENCE. A scrub is a HOLD that turns into a drag (`useJoystick.js`, C1); a
  //     drag without it is a fan push resolved by DIRECTION. The sheet omitted this, and on glass
  //     it made the operator fire `wire.voice` and raise a microphone prompt instead of measuring
  //     a row. Delete the sentence and this case goes red — that is its mutation proof.
  const scrubFixture = bindingStep(
    { mode: 'x', tapHint: 't', cursor: 'x', controllers: ['xSection.js'], semantics: { onScrub: { kind: 'cursor' }, onScrubCommit: { kind: 'cursor' } } },
    { key: 'onScrub', role: 'Scrub (drag y)' },
    { HOLD_MS: 500, DOUBLE_TAP_MS: 280 },
    { primary: 'next x', reverse: 'previous', scrub: 'the list' },
  )
  ok(/hold 500 ms/.test(scrubFixture.step), 'the scrub step no longer states the 500 ms hold')
  ok(/fan push/.test(scrubFixture.step), 'the scrub step no longer warns that a drag alone is a fan push')
  // 17. The numbers are READ, not typed: a different constant must reach the sentence.
  const altHold = bindingStep(
    { mode: 'x', tapHint: 't', cursor: 'x', controllers: [], semantics: { onScrub: { kind: 'cursor' }, onScrubCommit: { kind: 'cursor' } } },
    { key: 'onScrub', role: 'r' }, { HOLD_MS: 999, DOUBLE_TAP_MS: 1 }, null,
  )
  ok(/hold 999 ms/.test(altHold.step), 'the hold is hard-coded rather than read from constants.js')

  // 18. ⭐ A NAVIGATE MODE MUST NOT BE TOLD ITS CURSOR STEPS — the D-44 sentence itself.
  const navStep = bindingStep(
    { mode: 'home', tapHint: 'tap: last section', cursor: 'home', controllers: ['homeSection.js'], semantics: { onTap: { kind: 'navigate' }, onScrubCommit: { kind: 'navigate' } } },
    { key: 'onTap', role: 'Primary (tap)' }, { HOLD_MS: 500, DOUBLE_TAP_MS: 280 },
    { primary: 'last-used section', reverse: 'Morning Wire', scrub: null },
  )
  ok(/ROUTE changes/.test(navStep.expected) && !/cursor steps \*\*once\*\*/.test(navStep.expected),
    'a navigate mode is still described as stepping a cursor')
  // 19. …and the control, so case 18 is not passing by emptiness: a cursor mode still says so.
  const curStep = bindingStep(
    { mode: 'wire', tapHint: 'tap: next segment', cursor: 'wire', controllers: ['wireSection.js'], semantics: { onTap: { kind: 'cursor' }, onScrubCommit: { kind: 'cursor' } } },
    { key: 'onTap', role: 'Primary (tap)' }, { HOLD_MS: 500, DOUBLE_TAP_MS: 280 },
    { primary: 'next segment', reverse: 'previous', scrub: 'read progress' },
  )
  ok(/cursor steps \*\*once\*\*/.test(curStep.expected), 'a cursor mode is no longer described as stepping a cursor')

  // 20. The spec of record resolves and states something for a mode we know it covers.
  const sp = specPromises()
  ok(/^00-master-spec-v[\d.]+\.md$/.test(sp.file), 'the spec of record was not resolved by version')
  ok((sp.promises.get('home')?.primary || '') === 'last-used section',
    'spec §C3 no longer states home\'s Primary where this generator reads it')
  // 21. ⭐ THE CONTROL ON THE REAL TREE, named not counted: `home` navigates, `wire` does not.
  const realAst = (f) => parseJs(controllerFiles().find((c) => c.file === f).raw)
  ok(bindingSemantics(realAst('homeSection.js'), 'onTap', true).kind === 'navigate',
    'homeSection.js onTap no longer reads as a navigation')
  ok(bindingSemantics(realAst('wireSection.js'), 'onTap', true).kind === 'cursor',
    'wireSection.js onTap no longer reads as a cursor step')
  if (fails.length) {
    console.error('SELF-CHECK FAILED:\n  ' + fails.join('\n  '))
    process.exit(1)
  }
  console.log(`self-check OK — ${cases} cases, ${man.length} manifest entries parsed`)
}

// ── THE GLASS SHEET ────────────────────────────────────────────────────────────────────────────
// One step per surface, derived from the same rows as the matrix, so a bubble that ships without a
// glass step is impossible rather than merely unlikely. `glass-acceptance.md`'s hand-written blocks
// (G0-G4) stay where they are: they carry judgement a generator cannot — the colour-confusability
// question, the chip-vs-button overlap — and this is the exhaustive sweep beside them, not a
// replacement for them.

/** Which device each step needs, from the property under test. */
function deviceFor(r) {
  if (r.row === 'action' && r.escalate) return 'Android only — `haptics.js` no-ops without `navigator.vibrate`, which iOS Safari does not expose'
  return 'both'
}

/** Live (a human on glass) vs Automate (scriptable). ⚠️ BrowserStack meters these SEPARATELY and
 *  the account's Automate allowance was exhausted at the Phase-2 run; a Live seat does not fund it.
 *  So the column is a purchasing decision made visible, not a promise that anything is wired. */
function runnerFor(r) {
  if (r.row === 'mode') return 'Automate-able'
  if (r.flickable === false) return '⛔ LIVE ONLY — the flick is the measurement'
  if (r.escalate) return '⛔ LIVE ONLY — a haptic is felt, never asserted'
  if (r.kind === 'navigate' || r.kind === 'home') return 'Automate-able'
  return 'Live preferred'
}

function expectedForAction(r) {
  if (r.flickable === false) {
    return `**D4, here.** A fast flick (under \`FLICK_MS\`) toward “${r.label}” **opens the fan and fires NOTHING**; `
      + `a deliberate press (~500ms) DOES fire it. ⛔ Both halves, or the row proves nothing.`
  }
  if (r.kind === 'navigate') return `The route changes to \`${r.to}\`, once. Nothing is written.`
  if (r.kind === 'home') return 'The Home fan returns. No navigation happens on its own.'
  if (r.kind === 'confirm') return `Exactly **ONE** sheet opens — the confirm sheet — never two. It names the action, and the commit button performs it.${r.escalate ? ' The fire haptic ESCALATES (`warn`, not `impact`).' : ''}`
  return `The action runs once and the fan closes.${r.escalate ? ' The fire haptic ESCALATES (`warn`, not `impact`) — this is a write to a live position.' : ''}`
}

/**
 * One binding step's instruction and expected result.
 *
 * ⛔ BOTH HALVES ARE DERIVED. The instruction takes its numbers from `constants.js` (`HOLD_MS`,
 * `DOUBLE_TAP_MS`) so a tuning change cannot leave the sheet describing a gesture nobody can
 * perform. The expectation takes its VERB from the controller (`bindingSemantics`) and its NOUN
 * from spec §C3, so the sheet cannot promise cursor-stepping for a mode that navigates — D-44.
 */
function bindingStep(m, b, K, promise) {
  const sem = (m.semantics && m.semantics[b.key]) || { kind: 'unresolved' }
  const commit = (m.semantics && m.semantics.onScrubCommit) || sem
  const phrase = { onTap: promise?.primary, onDoubleTap: promise?.reverse }[b.key] || null
  const said = phrase ? `spec §C3 says **“${phrase}”**` : '⛔ **spec §C3 states nothing for this one**'
  const cursorList = m.cursor ? ` over the \`${m.cursor}\` list` : ''

  const step = {
    onTap: `Tap the pad once. (The chip says “${m.tapHint}”.)`,
    onDoubleTap: `Tap twice, the second press inside **${K.DOUBLE_TAP_MS} ms** of the first.`,
    onScrub: `Press the pad and **hold ${K.HOLD_MS} ms** — until the knob dot enlarges — then drag `
      + `along y without lifting; release to commit. ⛔ A drag WITHOUT the hold is a fan push, not a `
      + `scrub: it aims at a bubble by direction and fires that action.`,
    onScrubCommit: `Release the scrub from the step above.`,
    readout: `While still dragging, read the chip.`,
    onPeek: 'Perform the Peek gesture.',
  }[b.key]

  const guard = sem.guarded
    ? ' ⚠️ **This one has a precondition and is deliberately inert without it** — if nothing happens, '
      + 'that is not automatically a FAIL; check spec §C3 for what it needs first.'
    : ''

  const tapLike = {
    navigate: `The **ROUTE changes** — ${said}. No cursor steps and nothing on this page scrolls; `
      + `the whole effect is that you are somewhere else. ⛔ Exactly one navigation per gesture.${guard}`,
    cursor: `The cursor steps **once**${cursorList} — ${said} — and the target scrolls into view. `
      + `⛔ Exactly one step per gesture; a double step is the gesture firing twice.${guard}`,
    cycle: `The selection steps **once** in place — ${said} — and the page updates to match. It `
      + `**CLAMPS** at each end and must never wrap. ⛔ Exactly one step per gesture.${guard}`,
    unresolved: `⛔ **UNRESOLVED — do not run this row.** The generator could not resolve this `
      + `binding's body in ${m.controllers.join(', ') || 'any controller'}, so it has no expectation `
      + `to offer. An invented one is worse than none. Fix the derivation, not this sentence.`,
  }[sem.kind]

  const expected = {
    onTap: tapLike,
    onDoubleTap: tapLike,
    onScrub: commit.kind === 'navigate'
      ? `The cursor moves with your thumb and **nothing on the page moves** — by design. The chip is `
        + `the ONLY thing telling you where release will take you, so read it.`
      : `The cursor moves with your thumb${cursorList}, and the page follows it`
        + `${promise?.scrub ? ` — spec §C3 says **“${promise.scrub}”**` : ''}.`,
    onScrubCommit: commit.kind === 'navigate'
      ? `Releasing **NAVIGATES** to whatever the chip was naming. Nothing is "revealed" on this page, `
        + `because you have left it. ⛔ Releasing on the section you are already on must not reload it.`
      : `The landing row is **revealed** — scrolled into view, not merely selected.`,
    readout: commit.kind === 'navigate'
      ? `The chip names the **destination** you would land on — a section name, never a bare index.`
      : `The chip names the thing under the cursor in the page's OWN words (a ticker, a note title, `
        + `a date), never a bare index.`,
    onPeek: 'The Peek sheet opens once.',
  }[b.key]

  return { step, expected }
}

function glassSheet({ baseline, rows, constants: K, spec }) {
  const L = []
  L.push('# Joystick hub — the per-surface glass sweep (GENERATED)')
  L.push('')
  L.push('> ## ⛔⛔ RUN AFTER G0-1 RESOLVES. DO NOT RUN EARLY.')
  L.push('>')
  L.push('> `glass-acceptance.md:104` is the rule this sheet inherits: *"Resolve G0-1 before reading')
  L.push('> any G1."* G0-1 is an iPhone 15 Pro scoring flick **0/10** where an SE scored 10/10 on the')
  L.push('> same calibrated path, and it is **UNEXPLAINED**. Every row below is the same gesture')
  L.push('> measured by hand, so a PASS read while that is open is a pass against an instrument known')
  L.push('> to disagree with itself. ⛔ Below 8/10 on the flick score, every row here is')
  L.push('> **BLOCKED-BY-G0**, never FAIL.')
  L.push('>')
  L.push('> **Two devices, both required:** a notched iOS (**iPhone 15 Pro**) and an Android')
  L.push('> (**Pixel 8**). Run every "both" row on each; the device column names the rows that belong')
  L.push('> to one of them only.')
  L.push('>')
  L.push('> ⚰️ **GENERATED — do not hand-edit.** `node tools/hub_surface_matrix.mjs --glass`')
  L.push(`> (baseline \`${baseline}\`). A hand-maintained copy of this list beside the registry that owns`)
  L.push('> it is the drift this repo has paid for in a nav roster, a writer index, a setup catalog and')
  L.push('> a COT route count. Regenerate it; do not patch it.')
  L.push('>')
  L.push('> ⚠️ **The Runner column is a purchasing decision, not a wiring claim.** BrowserStack meters')
  L.push('> **Live** and **Automate** separately, the account\'s Automate allowance was exhausted at the')
  L.push('> Phase-2 run, and no CI device job exists (`71-open-items-proposals.md` §2). Every row is a')
  L.push('> Live row today; the column says which ones would stop needing a human if minutes were bought.')
  L.push('')
  L.push('**Judgement rows live in `glass-acceptance.md` and are not duplicated here** — G3-15 (the')
  L.push('chip/Actions-button overlap) and G3-16 (Wire vs Journal colour confusability) ask a human a')
  L.push('question no generator can phrase. This sheet is the exhaustive per-surface sweep beside them.')
  L.push('')

  const modes = rows.filter((r) => r.row === 'mode')
  for (const m of modes) {
    const acts = rows.filter((r) => r.row === 'action' && r.mode === m.mode)
    L.push(`## ${m.mode} — ${m.route || 'in place'}${m.newlyLive ? '  ⭐ **LEFT PREVIEW SINCE INCREMENT 2 — every row below is untested on glass**' : ''}`)
    L.push('')
    L.push('| # | Step | Expected | Device | Runner | Result |')
    L.push('|---|---|---|---|---|---|')
    // ⛔⛔ TWO COUNTERS, AND THE `b` PREFIX IS LOAD-BEARING. Binding steps are numbered `b1, b2…`
    // and action steps keep their own plain sequence, because a step id is what an operator writes
    // a result against and a SINGLE counter makes every id positional. When D-42's fix added five
    // binding rows to `wire`, a single counter moved `GS-wire-1` from "Chart it" to "Primary
    // (tap)" and shifted every action row in four modes — silently, in a file whose whole purpose
    // is to be filled in by hand. Nothing was lost that day only because no result had been
    // recorded yet (the sheet is gated behind G0-1). Separate sequences make a binding change
    // purely ADDITIVE: `GS-wire-3` means the same step before and after.
    let nb = 0
    let na = 0
    for (const b of m.bindings) {
      nb += 1
      const { step, expected } = bindingStep(m, b, K, spec.promises.get(m.mode))
      L.push(`| GS-${m.mode}-b${nb} | **${b.role}.** ${step} | ${expected} | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |`)
    }
    if (!m.bindings.length) {
      L.push(`| GS-${m.mode}-b0 | _This mode declares no gesture bindings._ | Tap, double-tap and scrub do **nothing** here, and the chip does not promise otherwise. | both | Automate-able | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |`)
    }
    for (const a of acts) {
      na += 1
      const req = a.requires.length
        ? ` Then repeat with **no ${a.requires.join('/')}** in context: the bubble must render **DISABLED with a reason, never hidden**.`
        : ''
      const tag = a.isNew ? ' 🆕' : a.becameReachable ? ' ⭐' : ''
      L.push(`| GS-${m.mode}-${na} | **${a.label}**${tag} (\`${a.id}\`) — flick to it from the pad.${req} | ${expectedForAction(a)} | ${deviceFor(a)} | ${runnerFor(a)} | [ ] PASS [ ] FAIL [ ] BLOCKED-BY-G0 |`)
    }
    L.push('')
  }

  L.push('## The two named doors — run these on BOTH devices, whatever else is skipped')
  L.push('')
  L.push('| # | Door | Step | Expected | Device |')
  L.push('|---|---|---|---|---|')
  const guarded = rows.filter((r) => r.row === 'action' && r.flickable === false)
  L.push(`| D4 | **A real touch surface honours \`flickable:false\`** | ${guarded.map((g) => `\`${g.id}\``).join(', ') || '_none declared_'} — eight fast flicks at it, then ONE deliberate press as the control. | 0 of 8 fire. The control DOES fire. ⛔ Without the control this row proves nothing: a bubble that never fires because the fan never opened would also read 0/8. | both |`)
  L.push('| D1 | **The no-drag door** | With **VoiceOver** (iOS) / **TalkBack** (Android) running, reach the Actions button and operate EVERY action in the sheet — including a `confirm` action\'s numeric field and its ± steppers — with **no drag at any point**. | Every action is reachable and fires, and the confirm commits at the ADJUSTED value. This is the EQUAL path the sheet exists for, not a lesser one. ⛔ Two-finger Peek is NOT this door and was removed: screen readers consume two-finger tap, and two pointers fails WCAG 2.5.1 on its face. | both — iOS uses VoiceOver, Android TalkBack |')
  L.push('')
  L.push('⛔ **An unfilled row is OPEN, never PASS.** This programme has already recorded a device')
  L.push('template coming back blank four times and nearly being read as a pass; the rule that came out')
  L.push('of it is the one that governs this sheet — **an absent result is not a pass, it is an absent**')
  L.push('**result.**')
  return L.join('\n')
}

if (argv.includes('--self-check')) selfCheck()
else {
  const data = await build()
  if (argv.includes('--glass')) console.log(glassSheet(data))
  else console.log(argv.includes('--json') ? JSON.stringify(data, null, 1) : markdown(data))
}
