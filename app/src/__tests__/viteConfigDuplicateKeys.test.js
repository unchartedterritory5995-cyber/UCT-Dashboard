// @vitest-environment node
//
// A duplicate key in a Vite config is a SILENT DELETION.
//
// `app/vite.config.js` carried two top-level `build` keys from 2026-09-12
// (`d261d0731` added `build: { target }` for the iOS engine floor) until wave 7.
// In an object literal the LATER key wins, so the earlier `build` — which held
// `rollupOptions.output.manualChunks` and `chunkSizeWarningLimit` — was thrown
// away wholesale. Nothing errored: `vite build` succeeded, the app worked, the
// dist simply had ZERO `vendor-*` chunks and a ~1.1 MB entry, for two weeks.
// ESLint's `no-dupe-keys` would have caught it; the config is not linted by any
// gate that runs.
//
// This rail parses every `vite*.config.*` under `app/` (the set is READ from the
// directory, never typed) and fails on a duplicate key in ANY object literal of
// the exported config, naming the path. A second half imports the real config
// and asserts BOTH intents the merge had to keep are present at runtime — the
// evaluated object is what Vite reads, and it is exactly what was wrong.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
// vite.config.js, vite.device.config.mjs, vite.config.parity-bands.mjs ... — any dotted name
// that starts with `vite` and has a `config` segment.
const isViteConfig = (f) => /^vite\./.test(f) && /\.(js|mjs|cjs)$/.test(f) && f.split('.').includes('config')

function keyName(prop) {
  if (!prop || prop.type !== 'Property' || prop.computed) return null
  const k = prop.key
  if (k.type === 'Identifier') return k.name
  if (k.type === 'Literal') return String(k.value)
  return null
}

function exportedConfigNode(ast) {
  const exp = ast.body.find((n) => n.type === 'ExportDefaultDeclaration')
  if (!exp) return null
  let node = exp.declaration
  // defineConfig({...}) / defineConfig(() => ({...}))
  if (node.type === 'CallExpression') node = node.arguments[0]
  if (node && (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression')) {
    node = node.body.type === 'ObjectExpression'
      ? node.body
      : node.body.body?.find((s) => s.type === 'ReturnStatement')?.argument
  }
  return node && node.type === 'ObjectExpression' ? node : null
}

/** Every duplicate key in every object literal under the exported config. */
function duplicateConfigKeys(source) {
  const ast = Parser.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const root = exportedConfigNode(ast)
  if (!root) throw new Error('no exported config object found — the rail would measure nothing')
  const found = []
  const walk = (obj, where) => {
    const seen = new Map()
    for (const prop of obj.properties) {
      const name = keyName(prop)
      if (name == null) continue
      if (seen.has(name)) {
        found.push({ path: where || '(root)', key: name, lines: [seen.get(name), prop.loc.start.line] })
      } else {
        seen.set(name, prop.loc.start.line)
      }
      if (prop.value && prop.value.type === 'ObjectExpression') {
        walk(prop.value, where ? `${where}.${name}` : name)
      }
    }
  }
  walk(root, '')
  return { rootKeys: root.properties.map(keyName).filter(Boolean), duplicates: found }
}

const configFiles = readdirSync(APP).filter(isViteConfig).sort()

describe('vite configs carry no duplicate keys', () => {
  it('CONTROL: a duplicated top-level key is reported, with both line numbers', () => {
    const src = [
      "import { defineConfig } from 'vite'",
      'export default defineConfig({',
      "  build: { rollupOptions: { output: { manualChunks: { a: ['a'] } } } },",
      "  server: {},",
      "  build: { target: ['safari16'] },",
      '})',
    ].join('\n')
    const { duplicates } = duplicateConfigKeys(src)
    expect(duplicates).toEqual([{ path: '(root)', key: 'build', lines: [3, 5] }])
  })

  it('CONTROL: a duplicate nested two levels down is reported with its path', () => {
    const src = "export default { test: { server: { deps: {}, deps: { inline: [] } } } }"
    const { duplicates } = duplicateConfigKeys(src)
    expect(duplicates.map((d) => `${d.path}:${d.key}`)).toEqual(['test.server:deps'])
  })

  it('CONTROL: a clean config reports nothing (the checker is not always-red)', () => {
    const src = "export default defineConfig({ build: { target: 'x' }, test: { globals: true } })"
    expect(duplicateConfigKeys(src).duplicates).toEqual([])
  })

  it('NON-VACUITY: the config set is non-empty and includes vite.config.js', () => {
    expect(configFiles).toContain('vite.config.js')
  })

  it('NON-VACUITY: the real vite.config.js exported object was found and walked', () => {
    const { rootKeys } = duplicateConfigKeys(readFileSync(path.join(APP, 'vite.config.js'), 'utf8'))
    for (const k of ['plugins', 'build', 'server', 'test']) expect(rootKeys).toContain(k)
  })

  for (const file of configFiles) {
    it(`${file} has no duplicate key anywhere in its exported config`, () => {
      const { duplicates } = duplicateConfigKeys(readFileSync(path.join(APP, file), 'utf8'))
      expect(duplicates, `${file}: ${JSON.stringify(duplicates)}`).toEqual([])
    })
  }
})

describe('the merged build keeps BOTH intents (evaluated config, the object Vite reads)', () => {
  it('build.target keeps the iOS engine floor AND manualChunks keeps the vendor map', async () => {
    const mod = await import('../../vite.config.js')
    const cfg = mod.default
    expect(cfg.build?.target, 'the safari16 engine floor went missing').toContain('safari16')
    const chunks = cfg.build?.rollupOptions?.output?.manualChunks
    expect(chunks, 'manualChunks went missing — the vendor split is dead again').toBeTruthy()
    expect(Object.keys(chunks)).toEqual(
      expect.arrayContaining(['vendor-react', 'vendor-swr', 'vendor-charts']),
    )
  })

  it('does NOT force an echarts vendor chunk (ruling D-I1)', async () => {
    // A forced `vendor-echarts` merged both halves of echarts into one chunk, so the routes that
    // need only its core -- ResearchPage, Calendar (the UCT Terminal), MyStocksHub -- fetched
    // ~580 KB more on first open. docs/notebook/perf-budgets.md section 1 has both measurements.
    const mod = await import('../../vite.config.js')
    const chunks = mod.default.build.rollupOptions.output.manualChunks
    expect(Object.keys(chunks)).toContain('vendor-react') // control: the map was read
    expect(Object.keys(chunks)).not.toContain('vendor-echarts')
    const listed = Object.values(chunks).flat()
    expect(listed).not.toContain('echarts')
    expect(listed).not.toContain('echarts-for-react')
  })
})
