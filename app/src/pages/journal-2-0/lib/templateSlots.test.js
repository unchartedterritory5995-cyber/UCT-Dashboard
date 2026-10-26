// Notebook widgets phase 2, wave 11 (Task 11.14): the member's words for a template's slots, and the twins of the
// server's slot grammar and "pick yours" type words, read from the server's own source text (never restated).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { SLOT_ID_RE, slotFamily, slotLabel, bindWords, TYPE_LABELS } from './templateSlots'

const REPO = path.resolve(__dirname, '../../../../..')
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
// The server twins land on the backend branch (Tasks 11.3 and 11.4) and reach this branch at the be -> impl merge.
// Until then the server's source is read from that branch, never skipped: a twin rail that passes because the
// other side is absent proves nothing. After the merge the working tree holds it and git is not consulted.
// (GIT_* is scrubbed from the child's environment: an inherited GIT_DIR once corrupted the shared repo config.)
const BE_BRANCH = 'origin/feat/notebook-widgets-p2-be'
function serverSource(rel, marker) {
  const local = fs.existsSync(path.join(REPO, rel)) ? read(rel) : ''
  if (marker.test(local)) return local
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
  return execFileSync('git', ['-C', REPO, 'show', `${BE_BRANCH}:${rel}`], { env, encoding: 'utf8' })
}

describe('templateSlots', () => {
  it('slot_label_with_and_without_names', () => {
    const built = { block: 'built_a', settings: { ref: 'def:7d1e3f0a-1111-4222-8333-444455556666', defRev: 3 } }
    const routine = { block: 'routine_1', settings: { template: 'pmr', bind: 'next-trading-day' } }
    const tracker = { block: 'tracker_b', settings: { inline: 'k1' } }
    const names = {
      'def:7d1e3f0a-1111-4222-8333-444455556666': 'Equity curve',
      'template:pmr': 'Pre-market routine',
      'inline:k1': 'Sleep',
    }
    expect(slotLabel(built, names)).toBe('Widget: Equity curve')
    expect(slotLabel(routine, names)).toBe('Routine: Pre-market routine')
    expect(slotLabel(tracker, names)).toBe('Tracker: Sleep')
    // Unknown names: the family word alone.
    expect(slotLabel(built)).toBe('Widget')
    expect(slotLabel(routine, {})).toBe('Routine')
    expect(slotLabel(tracker, { 'inline:k1': '   ' })).toBe('Tracker')
    // A name may also be keyed by the block id.
    expect(slotLabel({ block: 'built_c', settings: {} }, { built_c: 'Win rate by setup' })).toBe('Widget: Win rate by setup')
    // Not a slot: null, and an inherited key is never a name.
    expect(slotLabel({ block: 'chart' }, names)).toBeNull()
    expect(slotLabel({ block: 'built_d', settings: { ref: 'toString' } })).toBe('Widget')
    expect(slotFamily('built_a')).toBe('built')
    expect(slotFamily('routine_9')).toBe('routine')
    expect(slotFamily('tracker_xy')).toBe('tracker')
    expect(slotFamily('tracker_xyz')).toBeNull()
    expect(slotFamily(7)).toBeNull()
  })

  it('bind_words_exact', () => {
    expect(bindWords('note-day')).toBe('For the day of the note')
    expect(bindWords('next-trading-day')).toBe('For the next trading day')
    expect(bindWords('week')).toBe('For the trading week')
    expect(bindWords(undefined)).toBe('For the day of the note')   // the server's default bind
    expect(bindWords('today')).toBe('')                            // never a template value
    expect(bindWords('constructor')).toBe('')
  })

  it('regex_twin_of_server', () => {
    const src = serverSource('api/services/journal_two/journal_styles.py', /^SLOT_ID_RE = /m)
    const m = /^SLOT_ID_RE = re\.compile\(r"([^"]+)"\)$/m.exec(src)
    expect(m, 'journal_styles.SLOT_ID_RE not found').toBeTruthy()
    expect(SLOT_ID_RE.source).toBe(m[1])
    expect(SLOT_ID_RE.flags).toBe('')
    // The eager journalBlocks.js keeps its own literal (it imports nothing): the same source.
    const eager = /const SLOT_FAMILY_RE = \/(.+)\/\n/.exec(read('app/src/pages/journal-2-0/lib/journalBlocks.js'))
    expect(eager, 'journalBlocks SLOT_FAMILY_RE not found').toBeTruthy()
    expect(eager[1]).toBe(m[1])
  })

  it('type_labels_are_the_servers_ten', () => {
    const src = serverSource('api/services/journal_two/widget_engine/share.py', /^TYPE_LABELS = /m)
    const block = /^TYPE_LABELS = \{([\s\S]*?)\}$/m.exec(src)
    expect(block, 'share.TYPE_LABELS not found').toBeTruthy()
    const server = Object.fromEntries([...block[1].matchAll(/"(\w+)": "([^"]+)"/g)].map((x) => [x[1], x[2]]))
    expect(Object.keys(server)).toHaveLength(10)
    expect(TYPE_LABELS).toEqual(server)
  })
})
