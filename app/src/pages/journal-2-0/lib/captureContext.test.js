// ⚰️ THE DEFECT THIS FILE EXISTS FOR, and why the unit tests below are the
// SMALLER half of it.
//
// Slice 2 shipped context-sensitive capture defaults: `captureDestination`
// computed the label, `CaptureDialog` rendered it, `CaptureHost` accepted it,
// and `captureConvergence.test.js` asserted "context changes the DEFAULT
// destination, and the label says so". Every one of those passed.
//
// No door ever passed a destination. Both live doors — the command palette and
// the global hotkey — opened with an empty detail, so a member standing inside
// a note was asked "Choose a note…" about the note they were reading. It took
// the Slice 5 integrated E2E to see it, because every door test supplied the
// context itself.
//
// So this file has two halves, and the second is the one that matters:
//   1. the derivation is correct                     (ordinary unit tests)
//   2. a real door ACTUALLY CALLS IT                 (a reachability rail)
// A capability nobody invokes is not a feature → lesson_built_tested_green_and_unreachable.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import * as acorn from 'acorn'
import jsx from 'acorn-jsx'

import { destinationFromLocation, noteIdFromLocation, tickerFromLocation } from './captureContext'

const APP_SRC = path.resolve(__dirname, '..', '..', '..')

describe('where the member is standing', () => {
  it('a note being read is the destination, by name when we know it', () => {
    const d = destinationFromLocation(
      { pathname: '/journal/notebook', search: '?note=n1' },
      { recents: [{ id: 'n1', title: 'Weekly review' }] })
    expect(d.noteId).toBe('n1')
    expect(d.contextLabel).toBe('Weekly review')
  })

  it('…and by an honest generic label when we do not', () => {
    // ⛔ NEVER "Notebook" here: that is the label for "somewhere in your
    // Notebook", and we are about to write to one specific note. A default may
    // be silent to type, never silent on screen.
    const d = destinationFromLocation(
      { pathname: '/journal/notebook', search: '?note=n1' }, { recents: [] })
    expect(d.noteId).toBe('n1')
    expect(d.contextLabel).toBe('This note')
    expect(d.contextLabel).not.toBe('Notebook')
  })

  it('a security research page is that security', () => {
    const d = destinationFromLocation({ pathname: '/research/nvda', search: '' })
    expect(d.ticker).toBe('NVDA')
    expect(d.contextLabel).toBe('NVDA Research')
    // ⛔ No note is implied — the thought path creates one carrying the ticker.
    expect(d.noteId).toBeNull()
  })

  it('the compare sub-route is still that security', () => {
    expect(tickerFromLocation({ pathname: '/research/AMD/compare/NVDA' })).toBe('AMD')
  })

  it('⛔ no context returns null, so the dialog ASKS', () => {
    // Guessing is how a fast capture lands in the wrong place, which is worse
    // than one extra tap.
    expect(destinationFromLocation({ pathname: '/dashboard', search: '' })).toBeNull()
    expect(destinationFromLocation({ pathname: '/journal/notebook', search: '' })).toBeNull()
  })

  it('⛔ does not sniff a ticker out of any old query string', () => {
    expect(tickerFromLocation({ pathname: '/screener' })).toBeNull()
    expect(noteIdFromLocation({ pathname: '/charts', search: '?note=n1' })).toBeNull()
  })

  it('survives a malformed location without throwing', () => {
    expect(() => destinationFromLocation({})).not.toThrow()
    expect(destinationFromLocation({})).toBeNull()
  })
})

// ── The half that would have caught the original defect ─────────────────────

function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return
  fn(node)
  for (const k of Object.keys(node)) {
    if (k === 'type') continue
    const v = node[k]
    if (Array.isArray(v)) v.forEach((c) => walk(c, fn))
    else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, fn)
  }
}

function callsDestinationFromLocation(file) {
  const Parser = acorn.Parser.extend(jsx())
  let ast
  try {
    ast = Parser.parse(fs.readFileSync(file, 'utf8'),
      { ecmaVersion: 'latest', sourceType: 'module' })
  } catch { return false }
  let found = false
  walk(ast, (n) => {
    if (n.type === 'CallExpression' && n.callee?.type === 'Identifier'
        && n.callee.name === 'destinationFromLocation') found = true
  })
  return found
}

describe('⛔⛔ a real door actually uses it', () => {
  const DOORS = {
    hotkey: path.join(APP_SRC, 'pages/journal-2-0/components/notebook/CaptureHost.jsx'),
    palette: path.join(APP_SRC, 'components/CommandPalette.jsx'),
  }

  it.each(Object.entries(DOORS))('the %s door derives a destination', (_name, file) => {
    expect(fs.existsSync(file)).toBe(true)
    expect(callsDestinationFromLocation(file)).toBe(true)
  })

  it('⭐ the probe can tell a caller from a non-caller (non-vacuity)', () => {
    // Without this, "true" above could mean the walker matches anything.
    const notADoor = path.join(APP_SRC, 'pages/journal-2-0/lib/capture.js')
    expect(callsDestinationFromLocation(notADoor)).toBe(false)
  })

  it('⛔ every door that opens capture is one we checked', () => {
    // The original defect was a door that existed and passed nothing. If a
    // THIRD door appears, it must be added here and given context — otherwise
    // it silently reintroduces "Choose a note…" for a member who was standing
    // somewhere perfectly specific.
    const files = []
    const sweep = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== 'node_modules') sweep(p); continue }
        if (/\.(jsx?|tsx?)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p)
      }
    }
    sweep(APP_SRC)
    const openers = files.filter((f) => {
      const code = fs.readFileSync(f, 'utf8')
      if (!code.includes('openCapture(')) return false
      return !f.endsWith(path.join('lib', 'captureBus.js'))   // the definition
    })
    const rel = (f) => path.relative(APP_SRC, f).split(path.sep).join('/')
    expect(openers.map(rel).sort()).toEqual(['components/CommandPalette.jsx'])
  })
})
