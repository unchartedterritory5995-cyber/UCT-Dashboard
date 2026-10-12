import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Notebook P1 round 2 (review I1): every dynamic import in an eager Notebook file costs first-open bytes (the
// import expression plus a preload list as long as its chunk's dependencies, ~265 B each), and a second
// import of the same module costs them again. The whole journal-styles feature therefore rides ONE dynamic
// import (styles/lazyStyles.js -> styles/StyleSurfaces.js).
const NOTEBOOK = path.join(__dirname, '..', '..')
const STYLES = path.join(__dirname, 'styles')
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(jsx?|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p)
  }
  return out
}

describe('the journal-styles surfaces load through one dynamic import', () => {
  // Integrator ruling at the lane C + D merge: the Styles manager (lane C) keeps its OWN chunk, opened on demand by
  // NotebookTab's lazyDialog. It is a large, rarely opened dialog; folding it into StyleSurfaces would make every
  // editor-surface load carry it. Its one import() was already counted in lane C's measured first-open bytes.
  // The list stays EXACT: a third styles/ import, or a second import of either module, still fails here.
  it('exactly two import()s of a styles/ module in all of journal-2-0: the surfaces module and the Styles manager dialog', () => {
    const found = []
    for (const f of walk(NOTEBOOK)) {
      const src = fs.readFileSync(f, 'utf8')
      for (const m of src.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
        if (path.resolve(path.dirname(f), m[1]).startsWith(STYLES)) found.push([path.relative(NOTEBOOK, f).replace(/\\/g, '/'), m[1]])
      }
    }
    expect(found.sort()).toEqual([
      ['components/notebook/styles/lazyStyles.js', './StyleSurfaces'],
      ['tabs/NotebookTab.jsx', '../components/notebook/styles/StylesManager'],
    ])
  })

  it('the three surfaces are exported from that one module', () => {
    const src = read('styles/StyleSurfaces.js')
    for (const n of ['KindSection', 'StyleHost', 'SaveStyleDoor']) expect(src).toMatch(new RegExp(`as ${n} `))
  })

  it('the host is where the banner, the sheet and the chooser meet', () => {
    const host = read('styles/StyleHost.jsx')
    expect(host).toMatch(/from '\.\/StyleUpdateBanner'/)
    expect(host).toMatch(/from '\.\/StyleUpdateSheet'/)
    expect(host).toMatch(/StyleChooser/)
  })

  it('nothing eager imports a surface statically (only the loader helper)', () => {
    for (const f of ['NoteEditorPage.jsx', 'NoteMenuActions.jsx', 'TemplatePicker.jsx', 'TemplatePreview.jsx', 'NewNoteMenu.jsx', 'SlashMenu.jsx']) {
      const statics = [...read(f).matchAll(/^import .* from '\.\/styles\/([^']+)'/gm)].map((m) => m[1])
      expect(statics.filter((s) => s !== 'lazyStyles'), f).toEqual([])
    }
  })
})
