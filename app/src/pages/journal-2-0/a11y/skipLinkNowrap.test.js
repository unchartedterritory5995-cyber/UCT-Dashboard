// VIS-5 (audit 2026-11-05, issue 25): "The skip links wrap one word per line" when they take focus. Every
// skip link the Notebook renders (the app's own, the pane's, the folders panel's, the editor's) holds its
// words on one line.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRules, declarations } from './cssAudit'

const SRC = join(process.cwd(), 'src')
const FILES = [
  'components/Layout.module.css',
  'pages/journal-2-0/tabs/NotebookTab.module.css',
  'pages/journal-2-0/components/notebook/FolderSidebar.module.css',
  'pages/journal-2-0/components/notebook/NoteEditorPage.module.css',
]

describe('skip links never wrap', () => {
  it.each(FILES)('%s: the base .skipLink rule says white-space: nowrap', (file) => {
    const rule = parseRules(readFileSync(join(SRC, file), 'utf8')).find((r) => r.selector === '.skipLink')
    expect(rule, `${file} has no .skipLink rule`).toBeTruthy()
    const ws = declarations(rule).find((d) => d.prop === 'white-space')
    expect(ws?.value).toBe('nowrap')
  })

  it('CONTROL: a rule without it fails the same read', () => {
    const rule = parseRules('.skipLink { position: absolute; }')[0]
    expect(declarations(rule).find((d) => d.prop === 'white-space')).toBeUndefined()
  })
})
