// The version-history panel names each persisted board key for members. The names are
// hand-written copy; the SET of keys is not -- it is WORKSPACE_PREF_KEYS on the server,
// which is itself railed to what ChartsWorkspace writes. A key the server versions but the
// panel cannot name would show its raw id; a label for a key the server no longer versions
// is a stale claim. Both directions are asserted, reading the Python source directly.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { KEY_LABELS } from './VersionHistory.jsx'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STORE = path.join(HERE, '../../../../api/services/workspace_doc_store.py')

function serverKeys(src) {
  const code = src.split('\n').map((l) => l.replace(/#.*$/, '')).join('\n')
  const m = /WORKSPACE_PREF_KEYS\s*=\s*frozenset\(\{([\s\S]*?)\}\)/.exec(code)
  if (!m) return null
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort()
}

describe('VersionHistory KEY_LABELS covers exactly the keys the store versions', () => {
  const keys = serverKeys(readFileSync(STORE, 'utf8'))

  it('reads a non-empty key set from the server source (non-vacuity)', () => {
    expect(keys).not.toBeNull()
    expect(keys).toContain('charts_workspace_layout')
    expect(keys.length).toBeGreaterThan(5)
  })

  it('labels every versioned key, and nothing else', () => {
    expect(Object.keys(KEY_LABELS).sort()).toEqual(keys)
  })

  it('CONTROL: a key planted into the server source is seen', () => {
    const planted = readFileSync(STORE, 'utf8').replace(
      'WORKSPACE_PREF_KEYS = frozenset({', 'WORKSPACE_PREF_KEYS = frozenset({\n    "zz_planted_key",')
    expect(serverKeys(planted)).toContain('zz_planted_key')
    expect(Object.keys(KEY_LABELS)).not.toContain('zz_planted_key')
  })
})
