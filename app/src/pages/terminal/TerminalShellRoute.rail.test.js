// Where the watchlist marks' ONE read is mounted, and where it must not be (2026-11-17).
//
// The provider rides the Terminal's lazy chunk (TerminalShellRoute.jsx). Mounted in
// TerminalRoutes.jsx or App.jsx it would be in the app's ENTRY chunk, which every page's first
// load pays for: that is what breached the Notebook first-open byte budget by 403 B. Unmounted,
// every list would silently lose its marks. Both directions fail here by name.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// eslint-disable-next-line no-undef
const SRC = join(process.cwd(), 'src')
const read = (rel) => readFileSync(join(SRC, rel), 'utf8')
const imports = (text) => [...text.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
  .concat([...text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]))

describe('watchlist marks: the provider is mounted once, in the Terminal\'s own chunk', () => {
  it('the route wrapper mounts the provider around the shell', () => {
    const text = read('pages/terminal/TerminalShellRoute.jsx')
    expect(imports(text)).toContain('./TerminalShell')
    expect(imports(text)).toContain('../../components/terminal/WatchMarksProvider')
    expect(text).toMatch(/<WatchMarksProvider>\s*<TerminalShell \/>\s*<\/WatchMarksProvider>/)
  })

  it('the app loads the Terminal through that wrapper, lazily', () => {
    const app = read('App.jsx')
    expect(app).toContain("lazyPage('/terminal', () => import('./pages/terminal/TerminalShellRoute'))")
    // never a static import of the shell, the wrapper or the provider from the entry
    const statics = [...app.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
    for (const bad of ['./pages/terminal/TerminalShell', './pages/terminal/TerminalShellRoute', './components/terminal/WatchMarksProvider', './components/terminal']) {
      expect(statics).not.toContain(bad)
    }
  })

  it('the entry-chunk route file imports neither the provider nor the kit\'s index', () => {
    const from = imports(read('pages/terminal/TerminalRoutes.jsx'))
    expect(from).not.toContain('../../components/terminal/WatchMarksProvider')
    expect(from).not.toContain('../../components/terminal')
    expect(from).not.toContain('../../components/terminal/index')
    expect(from).toContain('../../components/terminal/PanelSkeleton')
  })

  it('CONTROL: the import reader sees a static and a dynamic import', () => {
    expect(imports("import A from './a'\nconst B = lazy(() => import('./b'))\n")).toEqual(['./a', './b'])
  })
})
