// UCT Agent AUTOTEST: a dev server owned by the runner's own process (no stray vite to hunt down later), the routing bundle the
// scripted relay needs, and the wrong-chart mutants the selection oracle has to catch. Dev-only, nothing imports this in the app.
//
// A mutant is a transform at serve time: no file in the worktree changes, so a mutated run cannot leak into a commit.
import { build } from 'esbuild'
import { join } from 'node:path'
import { createServer } from 'vite'
import { MUTANTS } from './selectionMutants.mjs'


function mutantPlugin(name) {
  const m = MUTANTS[name]
  if (!m) throw new Error(`unknown mutant ${name}`)
  return {
    name: 'selection-mutant',
    enforce: 'pre',
    transform(code, id) {
      if (!m.file.test(id.split('?')[0].replace(/\\/g, '/'))) return null
      const text = code.replace(/\r\n/g, '\n')
      if (!text.includes(m.from)) throw new Error(`mutant ${name}: the source moved, it no longer applies`)
      return { code: text.replace(m.from, m.to), map: null }
    },
  }
}

export async function startServer({ port, cacheDir, mutate = null, root = process.cwd() }) {
  const routing = join(cacheDir, 'routing.bundle.mjs')
  await build({ entryPoints: [join(root, 'src/agent/routing.js')], bundle: true, format: 'esm', platform: 'node', outfile: routing, logLevel: 'error' })
  const server = await createServer({
    root, configFile: join(root, 'vite.config.js'), cacheDir: join(cacheDir, mutate ? `vite-${mutate}` : 'vite'), logLevel: 'silent',
    // /api never reaches a real dev backend on this machine (the rig answers what it needs in the page)
    server: { host: '127.0.0.1', port, strictPort: true, fs: { strict: false }, hmr: false, watch: null, proxy: { '/api': 'http://127.0.0.1:9' } },
    plugins: mutate ? [mutantPlugin(mutate)] : [],
  })
  await server.listen()
  return { base: `http://127.0.0.1:${port}`, routing, close: () => server.close() }
}
