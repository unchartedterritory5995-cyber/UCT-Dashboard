// @vitest-environment node
// app/src/components/chart/builder/memberPane/memberDoorWorkerGraph.test.js
//
// ─── ⭐⭐ THE PASTE WORKER — THE WORKER-ONLY RESOLUTION: THE SAME FUNCTIONS, NOTHING ELSE ALIASED, NOTHING LEFT OUT ───
//
// `scripts/memberDoorWorkerPure.mjs` (vite `worker.plugins`): inside a WORKER bundle a few named imports of pure
// functions through React components (`../BuilderSheet` and `../FormulaField` from the chart door,
// `./FormulaField` from PasteBox's report and from the several-scripts intake) resolve to the pure modules, so the
// member door's worker holds no React. On the page every one of those imports stays as it was. So:
//   1. the SAME functions either way: every name an importer takes through a component IS the pure module's export
//      (identity, not equality);
//   2. the table names real files, and every row is an import the file really makes (no stale row);
//   3. the resolver matches the named (specifier, importer) pairs and NOTHING ELSE: other specifiers from those files,
//      the same specifiers from any other file (a test, a namesake, a near-miss name), and the prototype's keys;
//   4. over EVERY import of every non-test module in app/src, it matches exactly the table's pairs (with a control:
//      the walk reads the door's own imports, so "nothing matched" cannot pass by reading nothing);
//   5. the worker graph makes every load-time registration the page's door graph makes, except named page-only ones
//      (with a control), and holds no React and no CSS.
// The census proves the bundle's ANSWER equals the page's (docs/pine/evidence/2026-11-20-paste-worker, section 4);
// this rail proves the alias cannot reach anything it was not written for, and leaves nothing out.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { memberDoorWorkerPureTarget, WORKER_PURE_RESOLUTIONS } from '../../../../../scripts/memberDoorWorkerPure.mjs'

const APP = path.resolve(__dirname, '../../../../..')
const DOOR_FILE = 'src/components/chart/builder/memberPane/memberPaneDefinition.js'
const DOOR = path.join(APP, DOOR_FILE)
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
const ROWS = Object.entries(WORKER_PURE_RESOLUTIONS)
  .flatMap(([file, table]) => Object.entries(table).map(([spec, to]) => ({ file, spec, to })))
const IMPORT_NAMED = /import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g
/** The names `file` imports from `spec` (`import { a, b as c } from 'spec'`). */
function namesImported(file, spec) {
  const src = strip(fs.readFileSync(path.join(APP, file), 'utf8'))
  return [...src.matchAll(IMPORT_NAMED)].filter((m) => m[2] === spec)
    .flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean))
}
const resolveFrom = (file, spec) => {
  const base = path.resolve(path.dirname(path.join(APP, file)), spec)
  return [base, `${base}.js`, `${base}.jsx`].find((c) => fs.existsSync(c) && fs.statSync(c).isFile())
}

/** The static module graph from `root` (app-relative), every relative import resolved as vite resolves it: on the
 *  page, or (`worker`) inside a worker bundle, through `memberDoorWorkerPureTarget`. Dynamic imports are other
 *  chunks, not this graph's load. */
const STATIC_IMPORT = /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g
function graph(root, worker) {
  const mods = new Map()
  const queue = [path.join(APP, root)]
  mods.set(root, '')
  while (queue.length) {
    const abs = queue.shift()
    if (!/\.(js|jsx|mjs)$/.test(abs)) continue
    const src = strip(fs.readFileSync(abs, 'utf8'))
    mods.set(path.relative(APP, abs).split(path.sep).join('/'), src)
    for (const m of src.matchAll(STATIC_IMPORT)) {
      let spec = m[1] || m[2]
      if (!spec.startsWith('.')) continue
      if (worker) spec = memberDoorWorkerPureTarget(spec, abs) || spec
      const base = path.resolve(path.dirname(abs), spec)
      const hit = [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`, path.join(base, 'index.js')]
        .find((c) => fs.existsSync(c) && fs.statSync(c).isFile())
      if (!hit) continue
      const rel = path.relative(APP, hit).split(path.sep).join('/')
      if (!mods.has(rel)) { mods.set(rel, ''); queue.push(hit) }
    }
  }
  return mods
}
/** Modules of `page` missing from `work` that DO something when they load: a statement at column 0 that is a call
 *  (`registerX(fn)`, `store.register(...)`), outside a template string. */
function loadTimeEffects(page, work) {
  const out = []
  for (const [m, src] of page) {
    if (work.has(m) || !/\.(js|jsx|mjs)$/.test(m)) continue
    const code = src.replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
    const calls = code.split('\n').filter((l) => /^[A-Za-z_$][\w$.]*\s*\(/.test(l)
      && !/^(if|for|while|switch|return|function|export|import|const|let|var|class|describe|it|test)\b/.test(l))
    if (calls.length) out.push(m)
  }
  return out.sort()
}

describe('⭐⭐ the member door worker resolves named imports to the pure modules, and nothing else', () => {
  it('1. every name taken through a component is the pure module\'s own export (identity)', async () => {
    let names = 0
    for (const { file, spec, to } of ROWS) {
      const via = await import(resolveFrom(file, spec))
      const pure = await import(resolveFrom(file, to))
      for (const n of namesImported(file, spec)) {
        names += 1
        expect(typeof pure[n], `${file}: ${n} from ${to}`).toBe('function')
        expect(via[n], `${file}: ${n} through ${spec}`).toBe(pure[n])
      }
    }
    expect(names, 'the rows import something').toBeGreaterThanOrEqual(5)
  })

  it('2. the table names real files, and every row is an import the file makes', () => {
    expect(ROWS.length, 'the table holds exactly the four pairs (one more would alias another import)').toBe(4)
    for (const { file, spec, to } of ROWS) {
      expect(fs.existsSync(path.join(APP, file)), file).toBe(true)
      expect(resolveFrom(file, to), `${file} -> ${to}`).toBeTruthy()
      expect(namesImported(file, spec).length, `${file} imports from ${spec}`).toBeGreaterThan(0)
    }
    expect(namesImported(DOOR_FILE, '../BuilderSheet')).toEqual(['buildDefinition'])
    expect(namesImported(DOOR_FILE, '../FormulaField')).toEqual(['evaluateFormula'])
  })

  it('3. the resolver matches the named pairs and nothing else', () => {
    for (const { file, spec, to } of ROWS) {
      const abs = path.join(APP, file)
      const posix = abs.split(path.sep).join('/')
      expect(memberDoorWorkerPureTarget(spec, abs)).toBe(to)
      expect(memberDoorWorkerPureTarget(spec, `${posix}?worker_file&type=module`)).toBe(to)
      const dir = path.dirname(abs)
      const base = path.basename(file, '.js')
      const otherImporters = [
        path.join(dir, `${base}.test.js`), path.join(dir, `x${base}.js`), path.join(dir, `${base}.jsx`),
        path.join(APP, 'src', `${base}.js`), path.join(dir, '..', `${base}.js`), path.join(dir, 'PineBox.jsx'),
        path.join(dir, 'MemberPane.jsx'), path.join(dir, 'memberDoorWorkerCore.js'), '', null, undefined,
      ]
      for (const imp of otherImporters) expect(memberDoorWorkerPureTarget(spec, imp), `${spec} from ${imp}`).toBe(null)
      const near = [`${spec}.jsx`, spec.replace(/^\.\.?\//, './x'), '../pineParamManifest', to.replace(/\.js$/, ''),
        'react', 'constructor', 'toString', '__proto__', 'hasOwnProperty', '', null, undefined]
      for (const other of near) {
        if (ROWS.some((r) => r.file === file && r.spec === other)) continue
        expect(memberDoorWorkerPureTarget(other, abs), `${other} from ${file}`).toBe(null)
      }
    }
  })

  it('4. over every import of every non-test module in app/src, exactly the table\'s pairs match (with a control)', () => {
    const files = []
    const walk = (d) => {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n)
        if (fs.statSync(p).isDirectory()) { if (n !== 'node_modules') walk(p) } else if (/\.(js|jsx|mjs)$/.test(n) && !/\.test\.|\.spec\./.test(n)) files.push(p)
      }
    }
    walk(path.join(APP, 'src'))
    const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g
    const matched = []
    let doorImports = 0
    for (const f of files) {
      for (const m of strip(fs.readFileSync(f, 'utf8')).matchAll(SPEC)) {
        if (f === DOOR) doorImports += 1
        if (memberDoorWorkerPureTarget(m[2], f)) matched.push(`${path.relative(APP, f).split(path.sep).join('/')} ${m[2]}`)
      }
    }
    expect(files.length, 'the walk read the app').toBeGreaterThan(1000)
    expect(doorImports, 'the control: the walk read the door\'s own imports').toBeGreaterThan(20)
    expect(matched.sort()).toEqual(ROWS.map((r) => `${r.file} ${r.spec}`).sort())
  })

  it('5. the worker graph makes every load-time registration the page\'s door graph makes (with a control)', () => {
    // A worker is its own module graph: a registration the page makes when a module LOADS (`registerX(fn)` at the
    // top level) exists in the worker only if that module is in the worker's graph. The page's door graph is
    // BuilderSheet's; the worker's is the pure one (the resolution above). Every module the page's graph has and the
    // worker's lacks, that does something when it loads, is named here as the page's own, with its reason.
    const pageOnly = {
      'src/components/StockChart.jsx': 'the chart: its runtime lane loader and warmers serve painting, on the page',
      'src/hooks/usePreferences.js': 'the member\'s preferences store',
      'src/lib/priceStreamManager.js': 'the live price stream',
      'src/lib/barsStreamManager.js': 'the live bars stream',
      'src/components/chart/drawingsStore.js': 'the chart\'s drawings',
      'src/components/chart/builder/authoring/patchValidate.js': 'an import-time self-check of its own tables, no state',
    }
    const page = graph('src/components/chart/builder/memberPane/memberPaneDefinition.js', false)
    const work = graph('src/components/chart/builder/memberPane/memberDoorWorker.js', true)
    expect(page.size, 'the page graph is BuilderSheet\'s').toBeGreaterThan(500)
    expect(work.size, 'the worker graph is the pure one').toBeLessThan(400)
    expect([...work.keys()].filter((m) => /\.jsx$|\.css$/.test(m)), 'no React, no CSS in the worker').toEqual([])
    const missing = loadTimeEffects(page, work).filter((m) => !Object.prototype.hasOwnProperty.call(pageOnly, m))
    expect(missing, 'registrations the page makes and the member door\'s worker would not').toEqual([])
    // every page-only row is still a real difference (a stale row is a hole in the check)
    expect(Object.keys(pageOnly).filter((m) => !loadTimeEffects(page, work).includes(m))).toEqual([])
    // ⛔ THE CONTROL: the chart door alone, as a worker resolves it (no handler, so without the run half's rail), must
    // be reported
    const bare = graph('src/components/chart/builder/memberPane/memberPaneDefinition.js', true)
    const caught = loadTimeEffects(page, bare).filter((m) => !Object.prototype.hasOwnProperty.call(pageOnly, m))
    expect(caught).toEqual(expect.arrayContaining([
      'src/components/chart/engine/runHalfObjectRail.js', 'src/components/chart/engine/runtimeErrorStop.js']))
  })

})
