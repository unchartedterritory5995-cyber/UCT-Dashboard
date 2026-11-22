// Final fix pass, round 2 (A2): `noteReadKey.js` names the writers that still spell the note-read key by hand.
// This holds that list true: a fifth hand-written SWR write of `/api/j2/notes/${id}` (not a sub-resource) under
// app/src goes red here until it uses the helper or joins the comment's list.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { noteReadKey } from './noteReadKey'

const SRC = join(__dirname, '..', '..', '..')
const rel = (p) => relative(SRC, p).split(sep).join('/')
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name)) out.push(p)
  }
  return out
}
// A `mutate(` / `globalMutate(` whose first argument is exactly the note's own key (no `/sub-resource`).
const HAND_WRITTEN = /utate\(`\/api\/j2\/notes\/\$\{[\w.]+\}`/g

const LISTED = [
  'pages/journal-2-0/components/notebook/styles/StyleHost.jsx',
  'pages/journal-2-0/hooks/useJ2NoteVersions.js',
  'pages/journal-2-0/hooks/useJ2Notes.js',
  'pages/journal-2-0/tabs/NotebookTab.jsx',
]

describe('noteReadKey', () => {
  it('builds the key useJ2Note reads', () => {
    expect(noteReadKey('n1')).toBe('/api/j2/notes/n1')
    expect(noteReadKey(null)).toBeNull()
  })

  it('the hand-written writers are exactly the four its comment names', () => {
    const found = walk(SRC).filter((p) => (readFileSync(p, 'utf8').match(HAND_WRITTEN) || []).length > 0).map(rel).sort()
    expect(found).toEqual(LISTED)
    const comment = readFileSync(join(__dirname, 'noteReadKey.js'), 'utf8')
    for (const f of LISTED) expect(comment).toContain(f.replace('pages/journal-2-0/', ''))
  })

  it('control: the matcher tells the note key from a sub-resource', () => {
    expect('mutate(`/api/j2/notes/${applied.id}`, x)'.match(HAND_WRITTEN)).toHaveLength(1)
    expect('mutate(`/api/j2/notes/${applied.id}/versions`)'.match(HAND_WRITTEN)).toBeNull()
  })
})
