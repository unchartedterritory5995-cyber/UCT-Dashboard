// ─── THE FLAG-OFF RAIL FOR A PANE THAT DOES NOT EXIST YET ───────────────────
//
// ⭐ WRITTEN BEFORE THE FEATURE, DELIBERATELY, AND ITS VACUITY IS DECLARED RATHER
// THAN HIDDEN. Three of the four claims below are real today: the default, the
// single reader, and the ledger entry. The FOURTH — "no consumer reaches the
// renderer without consulting the gate" — is vacuously true while
// `pineRuntimeFrontend.js` has zero importers, so it carries a CONTROL proving the
// walker can actually SEE an importer. A rail that passes because it looked nowhere
// is the failure mode this repo names most often.
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { stripComments } from './sourceScan'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const APP = path.resolve(HERE, '..', '..', '..', '..', '..')
const REPO = path.resolve(APP, '..')
const GATE_SRC = path.resolve(HERE, '..', 'memberPaneGate.js')
const LEDGER = path.join(REPO, 'docs', 'frontend_feature_flags.json')

/** ⛔ DERIVED FROM THE SOURCE, NEVER TYPED. */
const GATE_NAME = (() => {
  const m = /import\.meta\.env\.(VITE_[A-Z0-9_]+)/.exec(fs.readFileSync(GATE_SRC, 'utf8'))
  return m ? m[1] : null
})()

/** Every `.js`/`.jsx` under app/src that is not a test. */
function sourceFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.vite') continue
      const full = path.join(dir, entry)
      if (fs.statSync(full).isDirectory()) { walk(full); continue }
      if (!/\.[cm]?jsx?$/.test(entry)) continue
      if (/\.(test|spec)\./.test(entry)) continue
      out.push(full)
    }
  }
  walk(path.join(APP, 'src'))
  return out
}

const importers = (moduleBase) => sourceFiles().filter((f) => {
  const src = fs.readFileSync(f, 'utf8')
  // ⚠️ String.raw, because a template literal resolves `\s` to `s` and `\(` to
  // `(` BEFORE RegExp ever sees them — which built `/import(s*.../` and threw
  // "Unterminated group". An escape eaten one layer up is this session's third.
  const stat = new RegExp(String.raw`from\s+['"][^'"]*` + moduleBase + String.raw`(\.js)?['"]`)
  const dyn = new RegExp(String.raw`import\(\s*['"][^'"]*` + moduleBase + String.raw`(\.js)?['"]`)
  return stat.test(src) || dyn.test(src)
})

const ENTRY = path.join(APP, 'src', 'main.jsx')
const RUNTIME = path.join(APP, 'src', 'components', 'chart', 'engine', 'ast', 'pineRuntimeFrontend.js')
const MEMBER_PANE = path.join(APP, 'src', 'components', 'chart', 'builder', 'memberPane', 'MemberPane.jsx')
const rel = (f) => (path.isAbsolute(f) ? path.relative(APP, f).split(path.sep).join('/') : f)

/** Does this module CALL the gate? Comments stripped — CODE, NEVER PROSE. */
const consultsGate = (f) => stripComments(fs.readFileSync(f, 'utf8')).includes('memberPaneEnabled()')

/** The non-test import graph of app/src: file → the app/src files it imports,
 *  statically, by re-export, for side effect, or through a dynamic `import()`
 *  (the app's routes are lazy, so a walk that skipped `import()` would stop at
 *  the router and see nothing). Comments are stripped first, so a commented-out
 *  import is not an edge. Bare (package) specifiers are not app code and are
 *  dropped. */
let GRAPH = null
function importGraph() {
  if (GRAPH) return GRAPH
  const files = sourceFiles()
  const known = new Set(files)
  const resolve = (from, spec) => {
    const base = path.resolve(path.dirname(from), spec)
    for (const c of [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`,
      path.join(base, 'index.js'), path.join(base, 'index.jsx')]) {
      if (known.has(c)) return c
    }
    return null
  }
  const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]*)\1/g
  GRAPH = new Map()
  for (const f of files) {
    const src = stripComments(fs.readFileSync(f, 'utf8'))
    const deps = []
    for (const m of src.matchAll(SPEC)) {
      const r = resolve(f, m[2])
      if (r && !deps.includes(r)) deps.push(r)
    }
    GRAPH.set(f, deps)
  }
  return GRAPH
}

/** ⭐⭐ THE RULE, AS A PURE FUNCTION OF A GRAPH, so it can be shown to fire on a
 *  synthetic one while the real tree is clean. Breadth-first from `entry`,
 *  NOT descending past any module that `consults` the gate: a door that calls
 *  `memberPaneEnabled()` is where the member path is decided. Returns the first
 *  path that reaches `target` without passing one, or null.
 *  ⚠️ ITS LIMIT, STATED: a module that calls the gate is treated as gating
 *  everything it imports. It proves a consult is ON the path, not that the call
 *  guards that particular render. */
function ungatedPathTo(graph, entry, target, consults) {
  const parent = new Map([[entry, null]])
  const queue = [entry]
  while (queue.length) {
    const f = queue.shift()
    if (f === target) {
      const out = []
      for (let p = f; p !== null; p = parent.get(p)) out.unshift(p)
      return out
    }
    if (f !== entry && consults(f)) continue
    for (const d of graph.get(f) || []) {
      if (!parent.has(d)) { parent.set(d, f); queue.push(d) }
    }
  }
  return null
}

describe('the member-pane gate', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('is named, and the name is derivable from its one reader', () => {
    expect(GATE_NAME).toBe('VITE_PINE_MEMBER_PANE_ENABLED')
  })

  it('⛔ defaults OFF, and ONLY the string "1" turns it on', async () => {
    const { memberPaneEnabled } = await import('../memberPaneGate.js')
    // unset
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', undefined)
    expect(memberPaneEnabled()).toBe(false)
    // the near-misses a careless deploy produces
    for (const v of ['', '0', 'true', 'TRUE', 'yes', 'on', '1 ']) {
      vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', v)
      expect(memberPaneEnabled(), `"${v}" must not enable the pane`).toBe(false)
    }
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
    expect(memberPaneEnabled()).toBe(true)
  })

  it('⛔ is read in exactly ONE place, so a rename is one line', () => {
    // ⛔⛔ CODE, NEVER PROSE — the repo's most repeated instrument defect, and
    // this sweep committed it. ⚰️ 2026-09-13: T5b's `pane/AttachedPineDisclosures
    // .jsx` explains IN A COMMENT why the flag must not reach that file, and this
    // check, matching raw text, reported it as a second reader of the flag. The
    // fix is the tool: strip comments before matching. Deleting the sentence would
    // make the check pass and leave the next reader without the reason a
    // disclosure surface is deliberately ungated.
    const readers = sourceFiles()
      .filter((f) => stripComments(fs.readFileSync(f, 'utf8')).includes(GATE_NAME))
    expect(readers.map((f) => path.relative(APP, f).split(path.sep).join('/')))
      .toEqual(['src/components/chart/engine/memberPaneGate.js'])
  })

  it('⛔ …and the stripper has a CONTROL, so the sweep cannot pass by seeing nothing', () => {
    // The needle is built by concatenation so this case does not contain the
    // literal it hunts — the other half of the same rule.
    const needle = `VITE_PINE_MEMBER${'_'}PANE_ENABLED`
    expect(needle).toBe(GATE_NAME)
    // A real read is still SEEN …
    expect(stripComments(`const x = import.meta.env.${needle}`)).toContain(needle)
    // … and the same words in a comment are NOT.
    expect(stripComments(`// we deliberately never read ${needle} here`)).not.toContain(needle)
    expect(stripComments(`/* ${needle} */`)).not.toContain(needle)
    // And the file that provoked the fix really does mention it, in prose only.
    const disclosures = fs.readFileSync(
      path.join(APP, 'src/components/chart/pane/AttachedPineDisclosures.jsx'), 'utf8')
    expect(disclosures).toContain(needle)
    expect(stripComments(disclosures)).not.toContain(needle)
  })

  it('the ledger declares it, and names the reader that really reads it', () => {
    const led = JSON.parse(fs.readFileSync(LEDGER, 'utf8'))
    const entry = led.flags[GATE_NAME]
    expect(entry, `${GATE_NAME} is not declared in docs/frontend_feature_flags.json`).toBeTruthy()
    // ⚰️ WAS `'dark'` — written in #145 (e855f62cd) the same day the owner flipped
    // the flag LIVE (c2c048653, "do it so it is fully live", set on the web
    // service as a build-time Vite arg and verified end to end on the live
    // site). The ledger is the declared truth and it says `armed`; this case
    // asserts that declaration EXACTLY, not "some status", so a retirement or
    // a silent flip back to dark still reds here by name.
    expect(entry.status).toBe('armed')
    const named = entry.readBy[0].split('::')[0]
    expect(fs.existsSync(path.join(REPO, named)), `${named} does not exist`).toBe(true)
    expect(fs.readFileSync(path.join(REPO, named), 'utf8')).toContain(GATE_NAME)
  })

  // ⚰️ WAS VACUOUS. This case asserted `importers('pineRuntimeFrontend')` was
  // EMPTY and said: "the moment it has a non-test importer, make that importer
  // call memberPaneEnabled() before it renders anything, then replace this
  // assertion with the real one." It got one — `runtime/objectLane.js`, the lane
  // seam — and went red on master. objectLane RENDERS NOTHING (its header: "a
  // lane, not a door"), and its only importer is `ast/peelToBuilding.js`, a
  // census helper only tests import. So the importer is not the thing that can
  // show a member anything; a DOOR that reaches it is. The real claim is about
  // the path from the app's entry, not about the first hop.
  it('⭐⭐ NO PATH FROM THE APP ENTRY REACHES THE RUNTIME LANE WITHOUT PASSING THROUGH A GATE CONSULT', () => {
    const graph = importGraph()
    const hit = ungatedPathTo(graph, ENTRY, RUNTIME, consultsGate)
    expect(hit && hit.map(rel),
      'the member runtime lane is reachable from the app entry along a path on which '
      + 'no module calls memberPaneEnabled(). Make the door on this path consult the '
      + 'gate before it renders anything.').toBeNull()
  })

  it('⛔ …NON-VACUITY: the lane HAS a consumer, and the walk from the entry really reaches the gated surface', () => {
    const graph = importGraph()
    // The importer side is not empty — the reason the old case went red.
    const consumers = [...graph].filter(([, deps]) => deps.includes(RUNTIME)).map(([f]) => rel(f))
    expect(consumers.length, 'pineRuntimeFrontend.js has no non-test importer; the '
      + 'rule above is vacuous again').toBeGreaterThan(0)
    // The entry side is not empty either: an UNPRUNED walk reaches MemberPane.jsx,
    // the one surface that consults the gate — so the resolver follows the app's
    // real (lazy) imports and the pruned walk above had something to prune.
    const all = ungatedPathTo(graph, ENTRY, MEMBER_PANE, () => false)
    expect(all && all.map(rel), 'the walk from main.jsx cannot reach MemberPane.jsx — '
      + 'the resolver is broken and the rule above passes by seeing nothing').toBeTruthy()
    expect(consultsGate(MEMBER_PANE)).toBe(true)
  })

  it('⛔ …CONTROL: the path predicate fires on an ungated door and is silenced only by a consult ON the path', () => {
    const g = new Map([
      ['main', ['app']], ['app', ['door', 'other']], ['other', []],
      ['door', ['lane']], ['lane', ['runtime']], ['runtime', []],
    ])
    expect(ungatedPathTo(g, 'main', 'runtime', () => false))
      .toEqual(['main', 'app', 'door', 'lane', 'runtime'])
    expect(ungatedPathTo(g, 'main', 'runtime', (f) => f === 'door')).toBeNull()
    // A consult OFF the path does not count.
    expect(ungatedPathTo(g, 'main', 'runtime', (f) => f === 'other'))
      .toEqual(['main', 'app', 'door', 'lane', 'runtime'])
    // A second, ungated route beside a gated one still fires.
    g.set('app', ['door', 'side']); g.set('side', ['lane'])
    expect(ungatedPathTo(g, 'main', 'runtime', (f) => f === 'door'))
      .toEqual(['main', 'app', 'side', 'lane', 'runtime'])
  })

  it('⭐⭐ THE GATE NOW HAS A CONSUMER, AND IT CONSULTS THE GATE (T5)', () => {
    // ⚰️ THIS USED TO ASSERT `importers('memberPaneGate').length === 0` and borrow
    // `placement.js` as its positive control, because the gate had been written
    // before the surface it guards. `MemberPane.jsx` is that surface, so the
    // borrowed control is retired and the real claim takes its place.
    const known = importers('memberPaneGate')
      .map((f) => path.relative(APP, f).split(path.sep).join('/'))
    expect(known,
      'the member-pane gate has no non-test importer. If the pane was deleted, '
      + 'delete this case with it; if it stopped importing the gate, that is the '
      + 'defect this file exists for.')
      // ⭐⭐ T5b DELIBERATELY DID NOT JOIN THIS LIST, and the reason is the one
      // thing about this flag worth writing twice. T5b puts the same three
      // disclosures on the member's REAL chart
      // (`pane/AttachedPineDisclosures.jsx`), and that file reads NO flag: the
      // gate decides whether a member may ATTACH a Pine document, never whether
      // an attached one discloses. A build constant turned off is a deploy, and
      // every definition attached while it was on keeps drawing — gating the
      // sentences would strip them off drawings that survive the flip. So the
      // census stays at one, and a second name appearing here is a question, not
      // a formality.
      .toEqual(['src/components/chart/builder/memberPane/MemberPane.jsx'])

    // ⛔ IMPORTING IT IS NOT CONSULTING IT, AND THAT IS ASSERTED OF EVERY
    // IMPORTER RATHER THAN OF THE ONE THIS CASE WAS WRITTEN FOR. A component that
    // pulled the module in and never called the reader would satisfy an import
    // scan and still show a member an unfinished pane on a default build — and
    // checking only the first name in the list is how the fourth importer gets
    // to be the one that does it.
    for (const rel of known) {
      const src = fs.readFileSync(path.join(APP, rel), 'utf8')
      expect(src, `${rel} imports the gate and never calls it`).toContain('memberPaneEnabled()')
    }

    // ⭐ AND THE WALKER IS STILL SHOWN TO WORK ON A MODULE WITH MANY IMPORTERS,
    // so a walker that had broken into "finds exactly one file, always" reds.
    expect(importers('placement').length).toBeGreaterThan(0)
  })
})
