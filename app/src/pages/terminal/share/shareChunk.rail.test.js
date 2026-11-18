// Share a panel: WHERE ITS CODE LOADS (first-open bytes are a hard budget).
//
//   app entry chunk       nothing of the feature. App.jsx and TerminalRoutes.jsx never reach it.
//   the Terminal's chunk  the button (PanelShare.jsx) and the rule (shareRule.js): small, no canvas.
//   its own lazy chunk    the reader, the file writer, the picture and the actions, behind ONE
//                         `import('./shareActions')` taken when a member opens a Share menu.
//
// Walked with an AST over STATIC imports and re-exports (never a grep), the same way
// boardPrefs.entry.rail.test.js keeps the function registry out of the entry. Both directions
// fail by name: the lazy code reached statically, or the button no longer reaching it at all.
//
// One more door is shut here. A lazy chunk that imports from a module the ENTRY chunk holds can
// keep an export alive there that tree-shaking would have dropped, which is first-open weight
// with no file of this feature in the entry. So the lazy files import no entry-held module
// directly; they reach one only through the chart's screenshot helper, which already did.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

// eslint-disable-next-line no-undef
const SRC = path.join(process.cwd(), 'src')
const P = Parser.extend(jsx())
const EXT = ['', '.js', '.jsx', '/index.js', '/index.jsx']
const rel = (f) => path.relative(SRC, f).split(path.sep).join('/')
const abs = (r) => path.join(SRC, r)

function resolve(from, spec) {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(from), spec)
  for (const e of EXT) {
    const f = base + e
    if (fs.existsSync(f) && fs.statSync(f).isFile() && /\.jsx?$/.test(f)) return f
  }
  return null
}

/** `{ statics, dynamics }`: the specifiers a file imports, by kind. */
function specsOf(file, text = fs.readFileSync(file, 'utf8')) {
  const ast = P.parse(text, { ecmaVersion: 'latest', sourceType: 'module' })
  const statics = []
  const dynamics = []
  for (const n of ast.body) {
    if (n.type === 'ImportDeclaration') statics.push(n.source.value)
    else if ((n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source) statics.push(n.source.value)
  }
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.type === 'ImportExpression' && node.source?.type === 'Literal') dynamics.push(node.source.value)
    for (const k of Object.keys(node)) if (k !== 'loc' && k !== 'range') walk(node[k])
  }
  walk(ast)
  return { statics, dynamics }
}

function staticClosure(root) {
  const seen = new Set()
  const stack = [root]
  while (stack.length) {
    const f = stack.pop()
    if (seen.has(f)) continue
    seen.add(f)
    for (const s of specsOf(f).statics) {
      const r = resolve(f, s)
      if (r) stack.push(r)
    }
  }
  return new Set([...seen].map(rel))
}

const DIR = 'pages/terminal/share/'
const EAGER = ['PanelShare.jsx', 'shareRule.js'].map((f) => DIR + f)
const LAZY = ['shareActions.js', 'shareRead.js', 'shareText.js', 'shareImage.js'].map((f) => DIR + f)

const entry = new Set([...staticClosure(abs('main.jsx')), ...staticClosure(abs('App.jsx'))])
const shell = staticClosure(abs('pages/terminal/TerminalShellRoute.jsx'))
const lazy = staticClosure(abs(`${DIR}shareActions.js`))

describe('share a panel: nothing in the app entry chunk', () => {
  it('the entry\'s static graph holds no file of the feature', () => {
    expect([...entry].filter((f) => f.startsWith(DIR))).toEqual([])
    expect(entry.has('pages/terminal/TerminalRoutes.jsx')).toBe(true)
    expect(entry.size).toBeGreaterThan(50)
  })

  it('TerminalRoutes.jsx and App.jsx import nothing of it, statically or lazily', () => {
    for (const f of ['pages/terminal/TerminalRoutes.jsx', 'App.jsx']) {
      const { statics, dynamics } = specsOf(abs(f))
      expect([...statics, ...dynamics].filter((s) => /(^|\/)share\//.test(s) && /terminal|^\.\/share/.test(s)), f).toEqual([])
    }
  })

  it('the lazy files import no entry-held module directly (no export kept alive in the entry)', () => {
    for (const f of LAZY) {
      const direct = specsOf(abs(f)).statics.map((s) => resolve(abs(f), s)).filter(Boolean).map(rel)
      expect(direct.filter((d) => entry.has(d)), `${f} imports an entry-chunk module`).toEqual([])
    }
    // What the lazy chunk does share with the entry, it reaches through the chart's helper alone.
    const viaHelper = staticClosure(abs('components/chart/chartScreenshot.js'))
    expect([...lazy].filter((f) => entry.has(f) && !viaHelper.has(f))).toEqual([])
  })
})

describe('share a panel: the button rides the Terminal\'s chunk, the rest its own', () => {
  it('the shell reaches the button and the rule statically, and none of the lazy files', () => {
    for (const f of EAGER) expect(shell.has(f), `${f} is not in the Terminal's chunk`).toBe(true)
    expect(LAZY.filter((f) => shell.has(f))).toEqual([])
  })

  it('the button takes the lazy module with ONE dynamic import, and imports none of it statically', () => {
    const { statics, dynamics } = specsOf(abs(`${DIR}PanelShare.jsx`))
    expect(dynamics).toEqual(['./shareActions'])
    expect(statics.filter((s) => /share(Actions|Read|Text|Image)/.test(s))).toEqual([])
    expect(specsOf(abs(`${DIR}shareRule.js`))).toEqual({ statics: [], dynamics: [] })
  })

  it('the lazy chunk holds the reader, the file writer and the picture, and neither the button nor the shell', () => {
    for (const f of LAZY) expect(lazy.has(f), f).toBe(true)
    expect(lazy.has(`${DIR}PanelShare.jsx`)).toBe(false)
    expect(lazy.has('pages/terminal/TerminalShell.jsx')).toBe(false)
    expect(lazy.has('pages/terminal/functions.js')).toBe(false)
  })

  it('no other source file imports the lazy files statically', () => {
    const offenders = []
    const visit = (dir) => {
      for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, name.name)
        if (name.isDirectory()) { if (name.name !== 'node_modules') visit(full); continue }
        if (!/\.jsx?$/.test(name.name) || /\.(test|spec)\.jsx?$/.test(name.name)) continue
        const text = fs.readFileSync(full, 'utf8')
        if (!/share(Actions|Read|Text|Image)/.test(text)) continue
        if (LAZY.includes(rel(full))) continue
        const hit = specsOf(full, text).statics.map((s) => resolve(full, s)).filter(Boolean).map(rel).filter((r) => LAZY.includes(r))
        if (hit.length) offenders.push(`${rel(full)} -> ${hit.join(', ')}`)
      }
    }
    visit(SRC)
    expect(offenders).toEqual([])
  })

  it('the two names differ by more than letter case (Windows and macOS file systems ignore case)', () => {
    // `./PanelShare` and a lazy `./panelShare` were one file to Windows: a mock of one replaced
    // the other, and an extensionless import could resolve to either.
    const sources = fs.readdirSync(abs(DIR)).filter((n) => !/\.test\./.test(n)).map((n) => n.replace(/\.jsx?$/, '').toLowerCase())
    expect(sources).toContain('panelshare')
    expect(new Set(sources).size).toBe(sources.length)
  })
})

describe('CONTROL: the walker can see what it is asked about', () => {
  it('reads a static import, a re-export and a dynamic import, each as its own kind', () => {
    const got = specsOf('x.jsx', "import A from './a'\nexport { b } from './b'\nconst C = () => import('./c')\nexport default function X() { return <A onClick={() => import('./d')} /> }\n")
    expect(got).toEqual({ statics: ['./a', './b'], dynamics: ['./c', './d'] })
  })

  it('the same walk from the shell DOES reach the registry, and from the button would reach a static lazy import', () => {
    expect(shell.has('pages/terminal/functions.js')).toBe(true)
    const bad = specsOf('x.jsx', "import { sharePanel } from './shareActions'\n").statics
    expect(bad.filter((s) => /share(Actions|Read|Text|Image)/.test(s))).toEqual(['./shareActions'])
  })
})
