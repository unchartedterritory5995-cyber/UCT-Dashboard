// Test support for the source rails: which Study-workbench modules SHIP.
//
// `src/lab/` is the Study workbench, a dev-server-only Vite entry (app/lab.html -> lab/main.jsx) that is never
// built: lab/labAbsent.test.js rails that index.html, vite.config.js and App.jsx never reference it. A rail about
// SHIPPED surfaces therefore has no business with the workbench's pieces. But the product MAY import single lab
// modules (the Study challenges reuse the workbench's start card and bits), and those ship with their importer.
//
// ⛔ So the answer is DERIVED, never a typed list: a lab module ships when a module OUTSIDE lab/ imports it, or a
// shipped lab module does (followed transitively inside lab/). Static `import ... from`, `export ... from`, a bare
// `import '...'` and a literal dynamic `import('...')` are all followed; a specifier that resolves to no file is
// ignored.
import fs from 'node:fs'
import path from 'node:path'

const CODE = /\.(m?jsx?)$/
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.[^'"]+)['"]/g
const EXT = ['', '.js', '.jsx', '.mjs', '/index.js', '/index.jsx']

function codeFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') codeFiles(p, out) } else if (CODE.test(e.name) && !/\.(test|spec)\./.test(e.name)) out.push(p)
  }
  return out
}

function resolveFrom(file, spec) {
  const base = path.resolve(path.dirname(file), spec)
  for (const ext of EXT) {
    const p = base + ext
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
  }
  return null
}

/** `{ isLab(rel), ships(rel) }` over app/src (`srcRoot`); `rel` is forward-slashed, relative to src. */
export function labShipping(srcRoot) {
  const rel = (abs) => path.relative(srcRoot, abs).split(path.sep).join('/')
  const isLab = (r) => r.startsWith('lab/')
  const files = codeFiles(srcRoot)
  const importsOf = new Map(files.map((f) => [f, [...fs.readFileSync(f, 'utf8').matchAll(SPEC)]
    .map((m) => resolveFrom(f, m[1])).filter(Boolean)]))
  const shipped = new Set()
  const queue = []
  for (const f of files) {
    if (isLab(rel(f)) || /[\\/]__tests__[\\/]/.test(f)) continue
    for (const t of importsOf.get(f)) if (isLab(rel(t)) && !shipped.has(rel(t))) { shipped.add(rel(t)); queue.push(t) }
  }
  while (queue.length) {
    const f = queue.pop()
    for (const t of importsOf.get(f) || []) if (isLab(rel(t)) && !shipped.has(rel(t))) { shipped.add(rel(t)); queue.push(t) }
  }
  return { isLab, ships: (r) => !isLab(r) || shipped.has(r), shippedLab: shipped }
}
