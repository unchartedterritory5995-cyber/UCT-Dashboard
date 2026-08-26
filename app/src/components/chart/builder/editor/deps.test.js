// ⭐ THE DEPENDENCY SET IS PINNED IN BOTH DIRECTIONS AND READ OFF THE ARTIFACT.
// Spec §5.4 names the CodeMirror packages; a package that arrives unpinned, or an
// eighth `@codemirror/*` that arrives unlisted, both show up here by name.
//
// Chunking rule (recorded, not acted on): CodeMirror is NOT added to
// `vite.config.js` `manualChunks`. That object FORCES a chunk into existence and
// Rollup then hosts unassigned shared runtime modules inside it — which is how
// tiptap + recharts once landed on the LOGIN screen (see the L128-146 comment in
// vite.config.js). The editor is reached from source through ONE dynamic
// `import()` edge only, so it gets Rollup's default lazy treatment and the chart
// bundle (`StockChart-*.js`, where BuilderSheet is mounted statically) does not
// grow for members who never open the builder. The size gate on that lazy chunk
// is Task W1a.6.
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
// The artifact, read through Vite's resolver the way `rendererPin.test.js` reads
// the lightweight-charts pin. Not `fs` + `__dirname` (a `no-undef` to this repo's
// browser-only eslint globals) and not `import.meta.url` (NOT a `file:` URL under
// this vitest transform — `fileURLToPath` throws "The URL must be of scheme file";
// see the ruling in `IndicatorSettingsDialog.test.jsx`).
import PKG from '../../../../../package.json'

/** Spec §5.4's list, exactly — the declaration this rail pins the artifact against. */
const EDITOR_DEPS = Object.freeze([
  '@codemirror/state', '@codemirror/view', '@codemirror/language',
  '@codemirror/autocomplete', '@codemirror/lint', '@codemirror/commands',
  '@lezer/highlight',
])

describe('the editor dependencies', () => {
  it('are installed — a state can be created and read back', () => {
    expect(EditorState.create({ doc: 'sma(close, 20)' }).doc.toString()).toBe('sma(close, 20)')
  })

  it('are every one of them pinned EXACTLY, like jsep and lightweight-charts already are', () => {
    for (const name of EDITOR_DEPS) {
      const v = PKG.dependencies[name]
      expect(v, `${name} is not a dependency`).toBeTypeOf('string')
      expect(v, `${name} must be an exact pin, not a range`).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })

  it('⛔ and the SET is closed — no unlisted @codemirror/@lezer package rides in', () => {
    const present = Object.keys(PKG.dependencies).filter((n) => /^@(codemirror|lezer)\//.test(n)).sort()
    expect(present).toEqual([...EDITOR_DEPS].sort())
  })
})
