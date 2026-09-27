/**
 * Wave 10 integration (10C concern 5) -- every place that renders the unreadable
 * notice hands it ITS editor.
 *
 * `UnreadableNoteNotice` picks its sentence by WHY the editor locked: a type a newer
 * bundle wrote, or a body that is merely malformed. With no editor it falls back to
 * the reason every live locked editor agrees on, so a malformed note could tell the
 * member to reload for a newer app. `UpbRichEditor.unreadable.test.jsx` proves the
 * behaviour on one surface; this is the structural rail that keeps every call site
 * on the right side of it, NoteEditorPage included (it rendered the bare form until
 * the wave-10 integration).
 *
 * A STRUCTURAL rail (source text, comments stripped), labelled as such: it cannot
 * say the passed value is the right editor, only that one is passed. The set of
 * files is found by searching the source tree, never typed, and a control proves the
 * search finds the call sites at all.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '../../..')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.jsx?$/.test(e.name) && !/\.test\.jsx?$/.test(e.name)) out.push(p)
  }
  return out
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const TAG = /<UnreadableNoteNotice\b([^>]*)\/?>/g

function callSites() {
  const sites = []
  for (const f of walk(SRC)) {
    const text = stripComments(fs.readFileSync(f, 'utf8'))
    for (const m of text.matchAll(TAG)) {
      sites.push({ file: path.relative(SRC, f).split(path.sep).join('/'), attrs: m[1] })
    }
  }
  return sites
}

describe('the unreadable notice is always given its editor', () => {
  it('CONTROL: the search finds the known call sites', () => {
    const files = callSites().map((s) => s.file)
    expect(files).toContain('pages/journal-2-0/components/notebook/NoteEditorPage.jsx')
    expect(files).toContain('pages/modelbook/builder/UpbRichEditor.jsx')
    expect(files.length).toBeGreaterThanOrEqual(5)
  })

  it('every <UnreadableNoteNotice> passes an editor= prop', () => {
    const bare = callSites().filter((s) => !/\beditor=\{/.test(s.attrs)).map((s) => s.file)
    expect(bare).toEqual([])
  })
})
