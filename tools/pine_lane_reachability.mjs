// tools/pine_lane_reachability.mjs
//
// ─── ⭐⭐ WHICH PINE LANE CAN A MEMBER ACTUALLY REACH? ───────────────────────
//
//   node tools/pine_lane_reachability.mjs
//   node tools/pine_lane_reachability.mjs --self-check
//
// ⛔⛔ THE QUESTION THIS EXISTS TO STOP ANYONE GUESSING. This programme publishes
// build counts for three lanes, and a reader naturally hears them as product
// progress. They are not the same thing: a lane with no rendered component above
// it cannot show a member anything, however many corpus scripts it builds.
//
// Measured 2026-09-23, the answer is lopsided enough that it has to be said out
// loud rather than left to be inferred — `pine.js` is reached by 134 `.jsx`
// components, and the runtime and object lanes by NONE.
//
// ⭐ AN IMPORT-GRAPH WALK, NOT A GREP. A text search over `.jsx` files answers
// "does a component NAME this module", which is a different question and gets the
// wrong answer both ways: a component three hops away is missed, and a prose
// mention in a comment is counted. This resolves relative imports (including
// `import(...)`, `index.js` and extensionless forms) and walks the graph
// backwards from each lane entry point.
//
// ⚠️ IT REPORTS, IT DOES NOT GATE. A rail asserting "the runtime lane is
// unreachable" would go red on the day somebody opens the door — failing on
// exactly the progress it exists to describe. The number belongs in a report that
// is re-derived, never in an assertion.
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', 'app', 'src')

/** Every non-test source module, and the relative imports each one resolves to. */
function buildGraph(root) {
  const files = []
  ;(function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(js|jsx)$/.test(e.name)
        && !/\.test\.|\.measure\.|__tests__|__fixtures__/.test(p)) files.push(p)
    }
  })(root)

  const rev = new Map()
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.[^'"]+)['"]/g)) {
      const base = path.resolve(path.dirname(f), m[1])
      const hit = [base, `${base}.js`, `${base}.jsx`,
        path.join(base, 'index.js'), path.join(base, 'index.jsx')]
        .find((c) => fs.existsSync(c) && fs.statSync(c).isFile())
      if (!hit) continue
      if (!rev.has(hit)) rev.set(hit, new Set())
      rev.get(hit).add(f)
    }
  }
  return { files, rev }
}

/** Every module that transitively imports `entry`. */
function importersOf(rev, entry) {
  const seen = new Set([entry])
  const stack = [entry]
  while (stack.length) {
    for (const p of rev.get(stack.pop()) || []) {
      if (!seen.has(p)) { seen.add(p); stack.push(p) }
    }
  }
  seen.delete(entry)
  return seen
}

const LANES = [
  ['COLUMNAR / host', 'components/chart/engine/ast/pine.js'],
  ['RUNTIME frontend', 'components/chart/engine/ast/pineRuntimeFrontend.js'],
  ['RUNTIME vm', 'components/chart/engine/runtime/vm.js'],
  ['OBJECT lane', 'components/chart/engine/runtime/objectLane.js'],
]

function report() {
  const { rev } = buildGraph(ROOT)
  const rows = LANES.map(([label, rel]) => {
    const entry = path.join(ROOT, rel)
    if (!fs.existsSync(entry)) return { label, rel, missing: true }
    const imp = importersOf(rev, entry)
    const jsx = [...imp].filter((f) => f.endsWith('.jsx'))
    return { label, rel, modules: imp.size, jsx: jsx.length, sample: jsx.slice(0, 4) }
  })
  return rows
}

function print(rows) {
  console.log('| lane | modules importing it | rendered components (.jsx) |')
  console.log('|---|---|---|')
  for (const r of rows) {
    if (r.missing) { console.log(`| ${r.label} | **MISSING** \`${r.rel}\` | — |`); continue }
    console.log(`| ${r.label} | ${r.modules} | **${r.jsx}** |`)
  }
  for (const r of rows) {
    if (!r.missing && r.sample && r.sample.length) {
      console.log(`\n${r.label} is reached by, among others:`)
      for (const f of r.sample) console.log('   ', path.relative(ROOT, f).split(path.sep).join('/'))
    }
  }
}

// ⛔ THE SELF-CHECK PROVES THE WALK CAN SEE AN EDGE IT WOULD OTHERWISE MISS —
// a component that imports a lane through TWO hops, which a grep over `.jsx`
// cannot find. Without it, "0 components" is indistinguishable from a walker
// that resolved nothing at all (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
function selfCheck() {
  const tmp = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'lane-'))
  const w = (rel, body) => {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, body, 'utf8')
    return p
  }
  const lane = w('lane.js', 'export const x = 1\n')
  w('middle.js', "import { x } from './lane.js'\nexport const y = x\n")
  w('Screen.jsx', "import { y } from './middle.js'\nexport default () => y\n")
  w('Unrelated.jsx', 'export default () => 1\n')
  const { rev } = buildGraph(tmp)
  const imp = importersOf(rev, lane)
  const jsx = [...imp].filter((f) => f.endsWith('.jsx'))
  const twoHops = jsx.some((f) => f.endsWith('Screen.jsx'))
  const notEverything = !jsx.some((f) => f.endsWith('Unrelated.jsx'))
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('self-check — a component TWO hops above the lane is found :', twoHops ? 'PASS' : 'FAIL')
  console.log('self-check — an unrelated component is NOT counted        :', notEverything ? 'PASS' : 'FAIL')
  if (!twoHops || !notEverything) process.exit(1)
}

if (process.argv.includes('--self-check')) selfCheck()
else print(report())
