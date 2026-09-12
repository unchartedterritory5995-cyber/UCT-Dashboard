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
// ⛔ COMMENTS ARE STRIPPED BEFORE ANY MATCH, and `--self-check` proves it. This repo has paid six
// times in one session for an instrument that matched the prose describing a call instead of the
// call — including in this very directory (`writePaths.test.js` says so in its own header). Every
// controller here writes `onScrub` in its comments; a scanner that counts those reports bindings
// nobody wired.
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

/** Bindings a controller DEFINES (`onScrub:` as an object key), never ones it talks about. */
const bindingsIn = (src) => BINDING_KEYS.filter((k) => new RegExp(`(^|[^\\w.])${k}\\s*:`, 'm').test(src))

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
  const ctrls = controllerFiles()
  const files = dispatchFiles(ctrls)
  const manifest = writeManifest()
  const symbols = symbolEndpointMap(manifest)
  const now = snapshot(await loadRegistry('WORKTREE'))
  const base = snapshot(await loadRegistry(BASELINE))

  const rows = []
  for (const m of now.modes) {
    const modeControllers = controllersFor(m.id, ctrls)
    const bindings = [...new Set(modeControllers.flatMap((f) => bindingsIn(ctrls.find((c) => c.file === f).src)))]
    const was = base.modes.find((x) => x.id === m.id)
    rows.push({
      row: 'mode', mode: m.id, label: m.label, route: m.route, cursor: m.cursor,
      tapHint: m.tapHint, preview: m.preview, controllers: modeControllers,
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
  return { baseline: BASELINE, generatedFrom: 'tools/hub_surface_matrix.mjs', manifest, rows }
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
  const ok = (cond, what) => { if (!cond) fails.push(what) }
  // 1. A binding mentioned ONLY in a comment must not count.
  ok(bindingsIn(strip('// onScrub: the thing\nconst x = 1\n')).length === 0, 'comment-only onScrub was counted')
  // 2. A real binding must count — the control that proves case 1 is not vacuous.
  ok(bindingsIn(strip('const cfg = { onScrub: (ctx, s) => s }')).includes('onScrub'), 'a real onScrub was missed')
  // 3. The needle this repo keeps tripping on: a comment that NAMES the key it forbids.
  ok(bindingsIn(strip('/* never add onPeek: here */\nconst c = { onTap: () => {} }')).join() === 'onTap',
    'a forbidding comment was read as a binding')
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
  if (fails.length) {
    console.error('SELF-CHECK FAILED:\n  ' + fails.join('\n  '))
    process.exit(1)
  }
  console.log(`self-check OK — 9 cases, ${man.length} manifest entries parsed`)
}

if (argv.includes('--self-check')) selfCheck()
else {
  const data = await build()
  console.log(argv.includes('--json') ? JSON.stringify(data, null, 1) : markdown(data))
}
