/**
 * TERM-063 (FB-S2-01) — THE KEYBOARD REGISTRY'S OWN RAIL.
 *
 * Four things are railed here, each with a control that proves it can fail:
 *
 *   1. CONFLICT — two declarations that can answer ONE physical event are a
 *      named failure (`ShortcutConflictError`), including the modifier-order and
 *      platform-alias variants `chordCollision.test.js` already polices for the
 *      one-row `CHORDS` table. The overlap is computed by ENUMERATING EVENTS
 *      against the same `chordMatches` the runtime dispatches with — never by
 *      normalising two strings, which is a second matcher that can disagree.
 *   2. THE LIVE SET — the registry's declarations PLUS the two chord tables that
 *      already ship (`chords.js::CHORDS`, `keyboardShortcuts.js::INDICATOR_CHORDS`)
 *      may overlap only where `ACKNOWLEDGED_OVERLAPS` says so, and every
 *      acknowledged overlap must still be real (the list can only shrink).
 *   3. INPUT FOCUS — a binding not declared `inEditable` never fires while an
 *      input, textarea or contenteditable element has focus.
 *   4. DECLARED == REGISTERED — every declaration has a registrant in the tree and
 *      every registrant names a declaration, derived by AST (a roster nobody reads
 *      is the DOC-1 failure this ticket was warned about).
 *
 * ⛔ The foreign-table adapters below are the ONE place the rail restates another
 * module's matching semantics, so each is cross-validated against that module's
 * real matcher over every modifier combination — an adapter that drifts from its
 * source goes red here rather than silently hiding a conflict.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import {
  SHORTCUTS,
  ACKNOWLEDGED_OVERLAPS,
  chordMatches,
  findShortcutConflicts,
  assertNoShortcutConflicts,
  registerShortcuts,
  isEditableFocus,
  validateDeclaration,
  ShortcutConflictError,
  UnknownShortcutError,
  bindingMatches,
  shortcutById,
} from './shortcutRegistry'
import { CHORDS, matchesChord } from './chords'
import { INDICATOR_CHORDS, matchShortcut } from '../../components/chart/keyboardShortcuts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '..', '..')
const REGISTRY_FILE = path.join(HERE, 'shortcutRegistry.js')

const MODS = ['ctrl', 'meta', 'shift', 'alt']
const ALL_MOD_COMBOS = Array.from({ length: 16 }, (_, n) => ({
  ctrlKey: !!(n & 1), metaKey: !!(n & 2), shiftKey: !!(n & 4), altKey: !!(n & 8),
}))

// ── foreign tables, adapted into the registry's chord language ──────────────

/** `chords.js` rows: `requires` → true, `forbids` → false, the rest don't-care;
 *  `matchesChord` compares the key case-insensitively, which is `fold`. */
function adaptChordsRow(c) {
  const chord = { keys: [String(c.key).toLowerCase()], fold: true }
  for (const m of MODS) {
    if (c.requires.includes(m)) chord[m] = true
    else if (c.forbids.includes(m)) chord[m] = false
  }
  return { id: `chords:${c.id}`, type: 'keydown', chord }
}

/** `INDICATOR_CHORDS`: a `ctrl` row is answered by `matchShortcut` (Ctrl OR Cmd,
 *  no Shift, no Alt, key folded — the Ctrl map is keyed on `code.slice(3)`); an
 *  `alt` row by StockChart's own `e.altKey && !e.ctrlKey && !e.metaKey` block,
 *  which compares `e.code` (StockChart.jsx, the `altChord` lookup). */
function adaptIndicatorChord(c) {
  const chord = c.modifier === 'ctrl'
    ? { keys: [c.code.slice(3).toLowerCase()], fold: true, mod: 'either', shift: false, alt: false }
    : { code: c.code, alt: true, ctrl: false, meta: false }
  return { id: `chart:toggle:${c.defId}`, type: 'keydown', chord }
}

const FOREIGN = [...CHORDS.map(adaptChordsRow), ...INDICATOR_CHORDS.map(adaptIndicatorChord)]
const DECLARED = [...SHORTCUTS, ...FOREIGN]

const pairKey = (a, b) => [a, b].sort().join(' <> ')

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TERM-063 — the declarations are well formed', () => {
  it('NON-VACUITY: the registry declares the palette and the app-shell batch', () => {
    const ids = SHORTCUTS.map((d) => d.id)
    expect(ids).toEqual(expect.arrayContaining([
      'palette.toggle', 'palette.close', 'palette.trapTab',
      'voice.talk', 'voice.trainMe',
      'video.playPause', 'video.seekBack', 'video.seekForward',
      'video.fullscreen', 'video.mute', 'video.escape',
    ]))
    expect(FOREIGN.length).toBe(CHORDS.length + INDICATOR_CHORDS.length)
    expect(FOREIGN.length).toBeGreaterThanOrEqual(5)
  })

  it('every id is unique and every declaration is frozen and valid', () => {
    const seen = new Set()
    for (const d of SHORTCUTS) {
      expect(seen.has(d.id), `duplicate declaration id ${d.id}`).toBe(false)
      seen.add(d.id)
      expect(Object.isFrozen(d), `${d.id} is not frozen`).toBe(true)
      expect(Object.isFrozen(d.chord), `${d.id}.chord is not frozen`).toBe(true)
      expect(() => validateDeclaration(d)).not.toThrow()
    }
    expect(Object.isFrozen(SHORTCUTS)).toBe(true)
  })

  it('CONTROL: validation refuses a chord with both keys and code, and an ambiguous mod', () => {
    expect(() => validateDeclaration({
      id: 'x', type: 'keydown', target: 'window', capture: false, inEditable: false, repeat: true,
      chord: { keys: ['k'], code: 'KeyK' }, why: 'a control fixture',
    })).toThrow(/exactly one of/)
    expect(() => validateDeclaration({
      id: 'y', type: 'keydown', target: 'window', capture: false, inEditable: false, repeat: true,
      chord: { keys: ['k'], mod: 'either', ctrl: true }, why: 'a control fixture',
    })).toThrow(/mod/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TERM-063 — CONFLICT: two registrations for one chord is a named failure', () => {
  const decl = (id, chord) => ({ id, type: 'keydown', chord })

  it('two declarations of one chord are reported, naming BOTH ids', () => {
    const a = decl('test.a', { keys: ['k'], fold: true, mod: 'either' })
    const b = decl('test.b', { keys: ['k'], fold: true, mod: 'either' })
    const found = findShortcutConflicts([a, b])
    expect(found.map((c) => pairKey(...c.ids))).toEqual([pairKey('test.a', 'test.b')])
    expect(() => assertNoShortcutConflicts([a, b])).toThrow(ShortcutConflictError)
    expect(() => assertNoShortcutConflicts([a, b])).toThrow(/test\.a.*test\.b|test\.b.*test\.a/)
  })

  it('modifier ORDER and the PLATFORM ALIAS cannot hide a conflict', () => {
    // Cmd+K on a Mac is answered by `mod: either`; so is Ctrl+K. A second binding
    // spelled `meta: true` is the same physical event and must collide.
    const a = decl('alias.a', { keys: ['k'], fold: true, mod: 'either' })
    const b = decl('alias.b', { keys: ['K'], fold: true, meta: true })
    expect(findShortcutConflicts([a, b])).toHaveLength(1)
    // `platform` (Cmd on a Mac, Ctrl elsewhere) collides with a Ctrl-only chord.
    const c = decl('plat.c', { code: 'KeyV', mod: 'platform', shift: true })
    const d = decl('plat.d', { keys: ['v'], fold: true, ctrl: true, shift: true })
    expect(findShortcutConflicts([c, d])).toHaveLength(1)
    // A code-declared chord collides with the key-declared spelling of that key.
    const e = decl('code.e', { code: 'KeyF', shift: true })
    const f = decl('code.f', { keys: ['F'] })
    expect(findShortcutConflicts([e, f])).toHaveLength(1)
  })

  it('CONTROL: the detector still DISCRIMINATES (it does not collapse every chord)', () => {
    const plain = decl('d.plain', { keys: ['k'], fold: true, mod: 'either', shift: false })
    const shifted = decl('d.shifted', { keys: ['k'], fold: true, mod: 'either', shift: true })
    const other = decl('d.other', { keys: ['j'], fold: true, mod: 'either' })
    const keyup = { ...decl('d.up', { keys: ['k'], fold: true, mod: 'either', shift: false }), type: 'keyup' }
    expect(findShortcutConflicts([plain, shifted, other, keyup])).toEqual([])
  })

  it('THE LIVE SET: registry + CHORDS + INDICATOR_CHORDS overlap only where acknowledged', () => {
    const acknowledged = new Set(ACKNOWLEDGED_OVERLAPS.map((o) => pairKey(...o.ids)))
    const found = findShortcutConflicts(DECLARED)
    const unacknowledged = found.filter((c) => !acknowledged.has(pairKey(...c.ids)))
    expect(unacknowledged.map((c) => `${pairKey(...c.ids)} (e.g. ${JSON.stringify(c.example)})`),
      'UNACKNOWLEDGED SHORTCUT CONFLICT — two bindings answer one keystroke. Change a chord, '
      + 'or (only if the overlap is resolved by phase/propagation/focus and you can say how) '
      + 'add it to ACKNOWLEDGED_OVERLAPS with that reason.').toEqual([])
    expect(() => assertNoShortcutConflicts(DECLARED, ACKNOWLEDGED_OVERLAPS)).not.toThrow()
  })

  it('THE LIVE SET: an acknowledged overlap that no longer overlaps is STALE (the list only shrinks)', () => {
    const found = new Set(findShortcutConflicts(DECLARED).map((c) => pairKey(...c.ids)))
    const known = new Set(DECLARED.map((d) => d.id))
    for (const o of ACKNOWLEDGED_OVERLAPS) {
      expect(o.ids.every((id) => known.has(id)), `ACKNOWLEDGED_OVERLAPS names an unknown id: ${o.ids}`).toBe(true)
      expect(found.has(pairKey(...o.ids)),
        `${pairKey(...o.ids)} no longer overlaps — delete it from ACKNOWLEDGED_OVERLAPS`).toBe(true)
      expect(String(o.why || '').length, `${pairKey(...o.ids)} carries no reason`).toBeGreaterThan(20)
    }
  })

  it('CONTROL: a deliberately duplicated LIVE binding turns the live-set rail red', () => {
    const dup = { ...SHORTCUTS.find((d) => d.id === 'voice.talk'), id: 'planted.duplicate' }
    const acknowledged = new Set(ACKNOWLEDGED_OVERLAPS.map((o) => pairKey(...o.ids)))
    const unack = findShortcutConflicts([...DECLARED, dup])
      .filter((c) => !acknowledged.has(pairKey(...c.ids)))
    expect(unack.map((c) => pairKey(...c.ids))).toContain(pairKey('planted.duplicate', 'voice.talk'))
    expect(() => assertNoShortcutConflicts([...DECLARED, dup], ACKNOWLEDGED_OVERLAPS))
      .toThrow(ShortcutConflictError)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TERM-063 — the foreign-table adapters agree with their sources', () => {
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('')
  const events = []
  for (const l of letters) {
    for (const mods of ALL_MOD_COMBOS) {
      events.push({ key: mods.shiftKey ? l.toUpperCase() : l, code: `Key${l.toUpperCase()}`, repeat: false, ...mods })
      events.push({ key: mods.shiftKey ? l : l.toUpperCase(), code: `Key${l.toUpperCase()}`, repeat: false, ...mods }) // caps-lock
    }
  }

  it('chords.js rows: the adapter matches exactly the events `matchesChord` matches', () => {
    for (const row of CHORDS) {
      const adapted = adaptChordsRow(row)
      let positives = 0
      for (const e of events) {
        const want = matchesChord(e, row)
        if (want) positives += 1
        expect(chordMatches(adapted.chord, e, { isMac: false }), `${row.id} ${JSON.stringify(e)}`).toBe(want)
      }
      expect(positives, `${row.id}: the sweep never produced a matching event`).toBeGreaterThan(0)
    }
  })

  it('INDICATOR_CHORDS ctrl rows: the adapter matches exactly what `matchShortcut` answers', () => {
    for (const c of INDICATOR_CHORDS.filter((r) => r.modifier === 'ctrl')) {
      const adapted = adaptIndicatorChord(c)
      let positives = 0
      for (const e of events) {
        const want = matchShortcut({ ...e }) === `toggle:${c.defId}`
        if (want) positives += 1
        expect(chordMatches(adapted.chord, e, { isMac: false }), `${c.defId} ${JSON.stringify(e)}`).toBe(want)
      }
      expect(positives, `${c.defId}: the sweep never produced a matching event`).toBeGreaterThan(0)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TERM-063 — runtime registration', () => {
  it('a SECOND live registration of one binding is a named failure', () => {
    const off = registerShortcuts({ 'voice.talk': () => {} })
    try {
      expect(() => registerShortcuts({ 'voice.talk': () => {} })).toThrow(ShortcutConflictError)
      expect(() => registerShortcuts({ 'voice.talk': () => {} })).toThrow(/voice\.talk/)
    } finally {
      off()
    }
    // ...and releasing it makes the binding available again (StrictMode re-mounts).
    const again = registerShortcuts({ 'voice.talk': () => {} })
    again()
    again() // idempotent
  })

  it('an undeclared id is refused by name — nothing binds a key off the table', () => {
    expect(() => registerShortcuts({ 'nobody.declared.this': () => {} })).toThrow(UnknownShortcutError)
    expect(() => registerShortcuts({ 'nobody.declared.this': () => {} })).toThrow(/nobody\.declared\.this/)
  })

  it('a refused registration installs NOTHING (no half-bound group)', () => {
    const spy = vi.spyOn(window, 'addEventListener')
    const off = registerShortcuts({ 'voice.talk': () => {} })
    const before = spy.mock.calls.length
    expect(() => registerShortcuts({ 'video.mute': () => {}, 'voice.talk': () => {} }))
      .toThrow(ShortcutConflictError)
    expect(spy.mock.calls.length).toBe(before)
    off()
  })

  it('each binding listens on its DECLARED target and phase (identical to the raw listener it replaced)', () => {
    const w = vi.spyOn(window, 'addEventListener')
    const d = vi.spyOn(document, 'addEventListener')
    const off = registerShortcuts({
      'palette.toggle': () => {}, 'palette.close': () => {}, 'palette.trapTab': () => {},
    })
    expect(w.mock.calls.filter((c) => c[0] === 'keydown').map((c) => c[2])).toEqual([true])
    // close + trapTab share document/capture — ONE native listener, as before.
    expect(d.mock.calls.filter((c) => c[0] === 'keydown').map((c) => c[2])).toEqual([true])
    off()
  })

  it('repeat: palette.toggle ignores auto-repeat, video.seekBack does not', () => {
    const toggle = vi.fn()
    const seek = vi.fn()
    const off = registerShortcuts({ 'palette.toggle': toggle })
    const off2 = registerShortcuts({ 'video.seekBack': seek })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, repeat: true, bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', repeat: true, bubbles: true }))
    expect(toggle).not.toHaveBeenCalled()
    expect(seek).toHaveBeenCalledTimes(1)
    off(); off2()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TERM-063 — INPUT FOCUS: no stolen keys inside a text control', () => {
  const press = (key, init = {}) => window.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))

  const focusNew = (html) => {
    document.body.innerHTML = html
    const el = document.body.firstElementChild
    el.focus()
    return el
  }

  it('a non-inEditable binding does NOT fire while an input, textarea or contenteditable is focused', () => {
    const mute = vi.fn()
    const off = registerShortcuts({ 'video.mute': mute })
    try {
      for (const html of [
        '<input type="text" />',
        '<textarea></textarea>',
        '<div contenteditable="true" tabindex="0"></div>',
      ]) {
        const el = focusNew(html)
        expect(document.activeElement, `could not focus ${html}`).toBe(el)
        expect(isEditableFocus(document), html).toBe(true)
        press('m')
        expect(mute, `video.mute fired while ${html} had focus`).not.toHaveBeenCalled()
      }
      // CONTROL: the same keystroke with focus on a non-text element DOES fire.
      focusNew('<button>x</button>')
      expect(isEditableFocus(document)).toBe(false)
      press('m')
      expect(mute).toHaveBeenCalledTimes(1)
    } finally {
      off()
    }
  })

  it('a nested element inside a contenteditable region is still a text control', () => {
    document.body.innerHTML = '<div contenteditable="true"><p tabindex="0" id="p">x</p></div>'
    document.getElementById('p').focus()
    expect(isEditableFocus(document)).toBe(true)
  })

  it('an inEditable binding (Ctrl/Cmd+K) keeps firing inside an input, exactly as it always has', () => {
    const toggle = vi.fn()
    const off = registerShortcuts({ 'palette.toggle': toggle })
    try {
      const el = focusNew('<input type="text" />')
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
      expect(toggle).toHaveBeenCalledTimes(1)
    } finally {
      off()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TERM-063 — declared == registered (derived by AST)', () => {
  const parse = (src) => Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const walk = (node, visit) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return }
    if (typeof node.type === 'string') visit(node)
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, visit)
  }
  const files = (dir, out = []) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) { if (ent.name !== 'node_modules') files(p, out) } else if (/\.(m?jsx?|cjs)$/.test(ent.name) && !/\.(test|spec)\./.test(ent.name)) out.push(p)
    }
    return out
  }
  const REGISTER = 'register' + 'Shortcuts'

  /** Every object-literal key passed to `registerShortcuts(...)`, by file. */
  function registrants() {
    const out = new Map()
    for (const f of files(SRC)) {
      if (path.resolve(f) === path.resolve(REGISTRY_FILE)) continue
      const src = fs.readFileSync(f, 'utf8')
      if (!src.includes(REGISTER)) continue
      walk(parse(src), (n) => {
        if (n.type !== 'CallExpression') return
        const callee = n.callee.type === 'Identifier' ? n.callee.name
          : (n.callee.type === 'MemberExpression' && !n.callee.computed ? n.callee.property.name : null)
        if (callee !== REGISTER) return
        const arg = n.arguments[0]
        if (!arg || arg.type !== 'ObjectExpression') {
          throw new Error(`${path.relative(SRC, f)}: ${REGISTER} must be called with an object literal `
            + 'so its bindings can be read by this rail')
        }
        for (const p of arg.properties) {
          const k = p.key && (p.key.type === 'Literal' ? p.key.value : (!p.computed ? p.key.name : null))
          if (k == null) throw new Error(`${path.relative(SRC, f)}: computed ${REGISTER} key`)
          if (!out.has(k)) out.set(k, [])
          out.get(k).push(path.relative(SRC, f).split(path.sep).join('/'))
        }
      })
    }
    return out
  }

  it('every declaration has a registrant, and every registrant names a declaration', () => {
    const reg = registrants()
    const declared = new Set(SHORTCUTS.map((d) => d.id))
    const orphanDecls = [...declared].filter((id) => !reg.has(id))
    const undeclared = [...reg.keys()].filter((id) => !declared.has(id))
    expect(orphanDecls, 'declared but registered by nothing — delete the declaration').toEqual([])
    expect(undeclared, 'registered but never declared — declare it in SHORTCUTS').toEqual([])
    expect(reg.get('palette.toggle')).toEqual(['components/CommandPalette.jsx'])
  })
})

// ── 2026-09-28: the video keys answer only UNMODIFIED ────────────────────────
describe('video shortcuts never steal a modified chord', () => {
  const env = { document: { activeElement: null }, isMac: false }
  const key = (k, mods = {}) => ({ type: 'keydown', key: k, repeat: false, ...mods })
  const fires = (id, e) => bindingMatches(shortcutById(id), e, env)

  it('the bare keys still work, including Caps-Lock letters', () => {
    expect(fires('video.fullscreen', key('f'))).toBe(true)
    expect(fires('video.fullscreen', key('F'))).toBe(true) // Caps Lock: shiftKey false
    expect(fires('video.mute', key('m'))).toBe(true)
    expect(fires('video.playPause', key(' '))).toBe(true)
    expect(fires('video.seekBack', key('ArrowLeft'))).toBe(true)
    expect(fires('video.seekBack', key('ArrowLeft', { shiftKey: true }))).toBe(true)
  })

  it('Ctrl+F is browser find, never fullscreen', () => {
    expect(fires('video.fullscreen', key('f', { ctrlKey: true }))).toBe(false)
    expect(fires('video.fullscreen', key('f', { metaKey: true }))).toBe(false)
  })

  it('Shift+F flags a ticker and no longer ALSO toggles fullscreen', () => {
    expect(fires('video.fullscreen', key('F', { shiftKey: true }))).toBe(false)
  })

  it('Alt+Left is browser Back, never a seek', () => {
    expect(fires('video.seekBack', key('ArrowLeft', { altKey: true }))).toBe(false)
    expect(fires('video.seekForward', key('ArrowRight', { altKey: true }))).toBe(false)
  })
})
