// @vitest-environment node
// Rail (wave 7 whole-branch fix, frontend review M-3): every Notebook capability flag's CLIENT
// fallback agrees with the SERVER's default for it, parsed from the server's own table.
//
// `FLAG_FALLBACKS` is what a tab uses until the auth payload arrives -- and for ever if it never
// does (a pod that predates Wave K). The review flipped `notebook_writing_help_enabled` to `true`
// and 37 tests stayed green: nothing compared the two files. An enablement gate whose fallback is
// ON would switch a DARK feature on in exactly the tabs that never heard from the server.
//
// ⭐ The server table is PARSED here, never retyped (a copy in this file would be a third
// authority): `NOTEBOOK_FLAGS` in api/routers/auth.py, whose payload keys are derived by
// `_notebook_flag_key` = env_name.lower().
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { FLAG_FALLBACKS } from './notebookFlags'

function repoRoot() {
  let dir = path.resolve(__dirname)
  for (let i = 0; i < 10; i += 1) {
    if (fs.existsSync(path.join(dir, 'api', 'routers', 'auth.py'))) return dir
    dir = path.dirname(dir)
  }
  throw new Error('could not find api/routers/auth.py above this file')
}

/** `{payloadKey: serverDefault}` for every row of NOTEBOOK_FLAGS, read from auth.py's source. */
function serverNotebookFlags(src) {
  const m = src.match(/^NOTEBOOK_FLAGS\s*=\s*\{([\s\S]*?)^\}/m)
  if (!m) throw new Error('NOTEBOOK_FLAGS = { ... } not found in auth.py')
  const out = {}
  for (const row of m[1].matchAll(/^\s*"(NOTEBOOK_[A-Z0-9_]+)"\s*:\s*(True|False)\s*,/gm)) {
    out[row[1].toLowerCase()] = row[2] === 'True'
  }
  return out
}

const AUTH_PY = fs.readFileSync(path.join(repoRoot(), 'api', 'routers', 'auth.py'), 'utf8')
const SERVER = serverNotebookFlags(AUTH_PY)

describe('the client flag fallbacks agree with the server defaults (M-3)', () => {
  it('NON-VACUITY — the parse read the real table, both polarities, and the writing-help row', () => {
    expect(Object.keys(SERVER).length).toBeGreaterThanOrEqual(6)
    expect(SERVER).toHaveProperty('notebook_writing_help_enabled')
    expect(Object.values(SERVER)).toContain(true)   // the kill switch
    expect(Object.values(SERVER)).toContain(false)  // the enablement gates
  })

  it('CONTROL — the parser reads a row it is handed, and ignores a commented one', () => {
    const src = 'NOTEBOOK_FLAGS = {\n    "NOTEBOOK_X_ON": False,  # c\n    # "NOTEBOOK_Y_ON": True,\n    "NOTEBOOK_Z_ON": True,\n}\n'
    expect(serverNotebookFlags(src)).toEqual({ notebook_x_on: false, notebook_z_on: true })
  })

  it('⛔ writing help: the client fallback IS the server default, OFF', () => {
    expect(SERVER.notebook_writing_help_enabled).toBe(false)
    expect(FLAG_FALLBACKS.notebook_writing_help_enabled).toBe(false)
  })

  it('every enablement gate (server default OFF) falls back to OFF on the client', () => {
    const gates = Object.entries(SERVER).filter(([, on]) => on === false).map(([k]) => k)
    const wrong = gates.filter((k) => FLAG_FALLBACKS[k] !== false).map((k) => `${k}=${FLAG_FALLBACKS[k]}`)
    expect(wrong, 'a dark gate would switch ON in every tab that never hears from the server').toEqual([])
  })

  it('a kill switch (server default ON) never falls back to OFF on the client', () => {
    const kills = Object.entries(SERVER).filter(([, on]) => on === true).map(([k]) => k)
    expect(kills.filter((k) => FLAG_FALLBACKS[k] === false)).toEqual([])
  })

  it('every boolean fallback on the client has a row on the server (no client-only gate)', () => {
    const clientBooleans = Object.entries(FLAG_FALLBACKS)
      .filter(([, v]) => typeof v === 'boolean' || v === null)
      .map(([k]) => k)
    expect(clientBooleans.filter((k) => !(k in SERVER))).toEqual([])
  })
})
