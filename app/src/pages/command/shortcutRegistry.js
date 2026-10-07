/**
 * S2 / TERM-063 (FB-S2-01) — THE KEYBOARD REGISTRY.
 *
 * One module owns (1) the DECLARATION of every page- or app-level shortcut it
 * governs, (2) their REGISTRATION on the DOM, and (3) CONFLICT DETECTION between
 * them. A surface binds a key by naming a declared id:
 *
 *     useEffect(() => registerShortcuts({ 'palette.toggle': (e) => { ... } }), [])
 *
 * ⛔ WHAT THIS IS NOT (yet). It governs the bindings declared in `SHORTCUTS` below
 * — the command palette and the app-shell batch (push-to-talk, the global video
 * player). Every OTHER raw key listener in `app/src` is counted, per file, by the
 * AST census in `keyListenerCensus.test.js` and held under a ratchet that can only
 * shrink. Migrating the rest is the `L` half of TERM-063 and is deliberately not
 * done here.
 *
 * ⛔ BEHAVIOUR-IDENTICAL BY CONSTRUCTION, which is why the declaration carries so
 * many fields. Each binding keeps the exact target (window/document), phase
 * (capture/bubble), key-matching rule (exact / case-folded / physical `code`),
 * modifier rule, auto-repeat rule and focus rule of the raw listener it replaced.
 * `registerShortcuts` installs ONE native listener per (target, phase) per call —
 * the same count, on the same node, at the same moment (inside the caller's own
 * effect) as before — so listener ORDER relative to every unmigrated listener is
 * unchanged. It deliberately does NOT multiplex every binding through one global
 * listener: that would move migrated handlers ahead of raw listeners registered in
 * between, and `stopImmediatePropagation` / `defaultPrevented` would change meaning.
 *
 * ⛔ H14 (the 2026-09-10 navigation freeze). Nothing here holds React state or
 * causes a render: registration is a plain function returning its own cleanup,
 * the dispatcher reads the event and calls a handler, and the live-id set is a
 * module Map that no component subscribes to. A keystroke costs one predicate walk
 * over the bindings of that one call.
 */

// ── the chord language ───────────────────────────────────────────────────────
//
// chord = {
//   keys?:  string[]   exact `e.key` values (with fold: compared lower-cased)
//   fold?:  boolean    compare `String(e.key).toLowerCase()` against keys[i].toLowerCase()
//   code?:  string     physical `e.code` (layout-independent). Exactly one of keys/code.
//   ctrl?, meta?, shift?, alt?:  true = required · false = forbidden · undefined = don't care
//   mod?:   'either'   Ctrl OR Cmd required (the palette's original `metaKey || ctrlKey`)
//           'platform' Cmd on a Mac, Ctrl elsewhere (push-to-talk's original rule)
// }

const MODIFIERS = ['ctrl', 'meta', 'shift', 'alt']
const MOD_PROP = { ctrl: 'ctrlKey', meta: 'metaKey', shift: 'shiftKey', alt: 'altKey' }

/** push-to-talk's original platform test, evaluated per event exactly as it was. */
export function platformIsMac() {
  try {
    return String((typeof navigator !== 'undefined' && navigator.platform) || '')
      .toUpperCase().includes('MAC')
  } catch {
    return false
  }
}

/** Does this event satisfy the chord? `env.isMac` overrides the platform read (tests, overlap). */
export function chordMatches(chord, e, env = {}) {
  if (!chord || !e) return false
  if (chord.code != null) {
    if (e.code !== chord.code) return false
  } else {
    const k = String(e.key)
    if (chord.fold) {
      const lk = k.toLowerCase()
      if (!chord.keys.some((c) => String(c).toLowerCase() === lk)) return false
    } else if (!chord.keys.includes(k)) {
      return false
    }
  }
  for (const m of MODIFIERS) {
    const want = chord[m]
    if (want === undefined) continue
    if (!!e[MOD_PROP[m]] !== want) return false
  }
  if (chord.mod === 'either' && !(e.ctrlKey || e.metaKey)) return false
  if (chord.mod === 'platform') {
    const isMac = env.isMac !== undefined ? env.isMac : platformIsMac()
    if (!(isMac ? e.metaKey : e.ctrlKey)) return false
  }
  return true
}

// ── the input-focus guard ────────────────────────────────────────────────────

/**
 * Is focus inside a text control? `INPUT`, `TEXTAREA`, or a contenteditable region.
 *
 * ⛔ It reads `document.activeElement`, and it deliberately does NOT count
 * `SELECT` — both exactly as the global video player's own guard did, because that
 * is the only migrated binding that uses it and behaviour must not move. (Adding
 * SELECT would stop ArrowLeft/Right seeking the video while a <select> has focus.)
 *
 * ⚠️ `isContentEditable` is a boolean in every browser. jsdom does not implement it
 * (it is `undefined` there), so ONLY in that case the attribute is consulted — the
 * fallback can never run in a real browser, so it cannot change product behaviour.
 */
export function isEditableFocus(doc = typeof document !== 'undefined' ? document : null) {
  const el = doc && doc.activeElement
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  if (el.isContentEditable === true) return true
  if (el.isContentEditable === undefined && typeof el.closest === 'function') {
    const host = el.closest('[contenteditable]')
    return !!host && String(host.getAttribute('contenteditable')).toLowerCase() !== 'false'
  }
  return false
}

// ── declarations ─────────────────────────────────────────────────────────────

const TARGETS = new Set(['window', 'document'])
const KEY_EVENT_TYPES = new Set(['keydown', 'keyup'])

/** Throws on a malformed declaration. Exported for the rail. */
export function validateDeclaration(d) {
  const where = `shortcut ${d && d.id}`
  if (!d || typeof d.id !== 'string' || !d.id) throw new Error('shortcut: missing id')
  if (!KEY_EVENT_TYPES.has(d.type)) throw new Error(`${where}: type must be keydown|keyup`)
  if (!TARGETS.has(d.target)) throw new Error(`${where}: target must be window|document`)
  for (const f of ['capture', 'inEditable', 'repeat']) {
    if (typeof d[f] !== 'boolean') throw new Error(`${where}: ${f} must be a boolean`)
  }
  if (typeof d.why !== 'string' || d.why.length < 10) throw new Error(`${where}: say why`)
  const c = d.chord
  if (!c || typeof c !== 'object') throw new Error(`${where}: missing chord`)
  const hasKeys = Array.isArray(c.keys) && c.keys.length > 0
  const hasCode = typeof c.code === 'string' && c.code.length > 0
  if (hasKeys === hasCode) throw new Error(`${where}: chord needs exactly one of keys / code`)
  if (c.mod !== undefined && c.mod !== 'either' && c.mod !== 'platform') {
    throw new Error(`${where}: chord.mod must be 'either' or 'platform'`)
  }
  if (c.mod !== undefined && (c.ctrl !== undefined || c.meta !== undefined)) {
    throw new Error(`${where}: chord.mod already decides ctrl/meta — do not also set them`)
  }
  for (const m of MODIFIERS) {
    if (c[m] !== undefined && typeof c[m] !== 'boolean') {
      throw new Error(`${where}: chord.${m} must be true, false or absent`)
    }
  }
  return d
}

const decl = (d) => Object.freeze({ type: 'keydown', ...d, chord: Object.freeze({ ...d.chord }) })

/**
 * ⭐ THE DECLARED BINDINGS. The id is what a surface names; everything else is
 * the behaviour contract it inherits. `why` records where the rule came from.
 */
export const SHORTCUTS = Object.freeze([
  // ── the command palette (components/CommandPalette.jsx) ──────────────────
  decl({
    id: 'palette.toggle',
    chord: { keys: ['k'], fold: true, mod: 'either' },
    target: 'window', capture: true, inEditable: true, repeat: false,
    why: 'Ctrl/Cmd+K opens or closes the palette from anywhere, including inside a text field '
      + '(it always has). Capture phase + stopPropagation so no page handler sees it first; '
      + 'held keys do not toggle ~30x/sec.',
  }),
  decl({
    id: 'palette.close',
    chord: { keys: ['Escape'] },
    target: 'document', capture: true, inEditable: true, repeat: true,
    why: 'Escape closes the open palette. Registered only while it is open; focus is in its own '
      + 'input, so it must fire inside a text field.',
  }),
  decl({
    id: 'palette.trapTab',
    chord: { keys: ['Tab'] },
    target: 'document', capture: true, inEditable: true, repeat: true,
    why: 'Tab (and Shift+Tab) keep focus pinned to the single palette input while it is open.',
  }),

  // ── the UCT Terminal (TERMINAL-NEXT lane T3, V4) ─────────────────────────
  decl({
    id: 'terminal.focus',
    chord: { keys: ['`'], ctrl: false, meta: false, alt: false },
    target: 'window', capture: false, inEditable: false, repeat: false,
    why: 'Backtick is the global UCT Terminal key: on /terminal it puts focus in the command '
      + 'line, elsewhere it opens the shell (for a member it is released to). Never inside a text '
      + 'field, so typing a backtick still types one. Owned by the app-wide palette mount.',
  }),
  ...[1, 2, 3, 4].map((n) => decl({
    id: `terminal.panel${n}`,
    chord: { code: `Digit${n}`, alt: true, ctrl: false, meta: false, shift: false },
    target: 'window', capture: false, inEditable: true, repeat: false,
    why: `Alt+${n} focuses terminal panel ${n} (physical key, so Mac Option+${n} works too). `
      + 'Fires from the command line, which is where a terminal user\'s focus lives.',
  })),
  ...[['Prev', 'BracketLeft', 'previous'], ['Next', 'BracketRight', 'next']].map(([name, code, word]) => decl({
    id: `terminal.panel${name}`,
    chord: { code, alt: true, ctrl: false, meta: false, shift: false },
    target: 'window', capture: false, inEditable: true, repeat: false,
    why: `Alt+${code === 'BracketLeft' ? '[' : ']'} focuses the ${word} terminal panel, wrapping `
      + 'around (physical key). The companion to Alt+1..4 for boards a member steps through.',
  })),
  // Daily-use panel and board keys (2026-10-06). All Alt + a PHYSICAL key with Ctrl/Cmd
  // forbidden, so AltGr (Ctrl+Alt on Windows) still types Polish/German characters. Letters
  // avoid the browser's own Alt keys (D address bar, E/F Chrome menu, F/E/V/S/B/T/H Firefox
  // menus) and StockChart's Alt chords (U, I, G, Q, N, S, Comma; Shift+A/I/W).
  ...[['MoveLeft', 'BracketLeft', '[', 'left'], ['MoveRight', 'BracketRight', ']', 'right']].map(([name, code, ch, word]) => decl({
    id: `terminal.panel${name}`,
    chord: { code, alt: true, shift: true, ctrl: false, meta: false },
    target: 'window', capture: false, inEditable: true, repeat: false,
    why: `Alt+Shift+${ch} moves the focused terminal panel one place ${word}; focus moves with it. `
      + 'Shift is what separates it from the panel-step key on the same bracket.',
  })),
  ...[
    ['panelMaximise', 'KeyM', 'M', 'maximises the focused terminal panel, or restores the board',
      'The other panels stay mounted; Alt+1..4 flips between them full size.'],
    ['panelClose', 'KeyX', 'X', 'closes the focused terminal panel',
      'Alt+Z brings it back. The last panel on a board cannot close.'],
    ['panelUndoClose', 'KeyZ', 'Z', 're-opens the last closed terminal panel',
      'Not Ctrl+Z, which is the text field\'s own undo.'],
    ['panelDuplicate', 'KeyC', 'C', 'duplicates the focused terminal panel beside it',
      'Refused, and said, on a board already showing four.'],
    ['panelLink', 'KeyL', 'L', 'links the focused terminal panel to the next group',
      'It steps A, B, C, D, any group the board added, then not linked, and says which.'],
    ['boards', 'KeyO', 'O', 'opens the terminal Boards sheet',
      'Not Alt+B, which opens the Bookmarks menu in Firefox.'],
    ['recents', 'KeyR', 'R', 'opens the terminal Recents sheet',
      'Recent functions, securities by group, and boards.'],
    ['keys', 'Slash', '/', 'shows the terminal keyboard sheet',
      'The same list HELP prints, over the board.'],
  ].map(([id, code, ch, does, more]) => decl({
    id: `terminal.${id}`,
    chord: { code, alt: true, shift: false, ctrl: false, meta: false },
    target: 'window', capture: false, inEditable: true, repeat: false,
    why: `Alt+${ch} ${does}. ${more} Physical key, and it fires from the command line.`,
  })),

  // ── push-to-talk (hooks/usePushToTalkHotkey.js, mounted by GlobalVoiceLayer) ──
  decl({
    id: 'voice.talk',
    chord: { code: 'KeyV', mod: 'platform', shift: true },
    target: 'window', capture: false, inEditable: false, repeat: true,
    why: 'Cmd+Shift+V (Mac) / Ctrl+Shift+V starts or ends a Realtime conversation. Physical key, '
      + 'so it survives non-QWERTY layouts. NOT inside a text field (2026-09-28): there the chord is '
      + 'paste-as-plain-text in the browser, which push-to-talk used to preventDefault away.',
  }),
  decl({
    id: 'voice.trainMe',
    chord: { code: 'KeyT', mod: 'platform', shift: true },
    target: 'window', capture: false, inEditable: true, repeat: true,
    why: 'Cmd+Shift+T (Mac) / Ctrl+Shift+T starts or ends a Train Me session.',
  }),

  // ── the global video player (components/video/GlobalVideoLayer.jsx) ──────
  // Registered only while a video is active. None of these ever looked at a
  // modifier, so none declares one — that is preserved, and it is what the
  // ACKNOWLEDGED_OVERLAPS entries below are about.
  // 2026-09-28: the bare video keys answer only UNMODIFIED (arrows: no Ctrl/Meta/Alt).
  // Before, Ctrl+F (browser find) also toggled fullscreen, Shift+F flagged a ticker AND
  // toggled fullscreen, and Alt+Left (browser Back) also seeked. Caps-Lock F / M still
  // work (`e.key` upper-case, shiftKey false). Two ACKNOWLEDGED_OVERLAPS retired.
  decl({
    id: 'video.playPause',
    chord: { keys: [' ', 'k'], ctrl: false, meta: false, alt: false, shift: false },
    target: 'window', capture: false, inEditable: false, repeat: true,
    why: 'Space or lower-case k plays/pauses the active video (YouTube convention).',
  }),
  decl({
    id: 'video.seekBack',
    chord: { keys: ['ArrowLeft'], ctrl: false, meta: false, alt: false },
    target: 'window', capture: false, inEditable: false, repeat: true,
    why: 'ArrowLeft seeks the active video back 15 s; auto-repeat keeps seeking.',
  }),
  decl({
    id: 'video.seekForward',
    chord: { keys: ['ArrowRight'], ctrl: false, meta: false, alt: false },
    target: 'window', capture: false, inEditable: false, repeat: true,
    why: 'ArrowRight seeks the active video forward 15 s; auto-repeat keeps seeking.',
  }),
  decl({
    id: 'video.fullscreen',
    chord: { keys: ['f', 'F'], ctrl: false, meta: false, alt: false, shift: false },
    target: 'window', capture: false, inEditable: false, repeat: true,
    why: 'f / F toggles fullscreen on the active video.',
  }),
  decl({
    id: 'video.mute',
    chord: { keys: ['m', 'M'], ctrl: false, meta: false, alt: false, shift: false },
    target: 'window', capture: false, inEditable: false, repeat: true,
    why: 'm / M toggles mute on the active video.',
  }),
  decl({
    id: 'video.escape',
    chord: { keys: ['Escape'] },
    target: 'window', capture: false, inEditable: false, repeat: true,
    why: 'Escape exits fullscreen / picture-in-picture on the active video.',
  }),
])

const BY_ID = new Map(SHORTCUTS.map((d) => [d.id, d]))
export const shortcutById = (id) => BY_ID.get(id) || null

/**
 * ⚠️ OVERLAPS THAT EXIST TODAY, NAMED RATHER THAN HIDDEN. Each pair can be
 * answered by one physical keystroke. The conflict rail fails on any overlap NOT
 * listed here, and on any listed overlap that no longer overlaps — so this list
 * can only shrink. Ids prefixed `chords:` / `chart:` are the two pre-existing
 * chord tables (`pages/command/chords.js::CHORDS`,
 * `components/chart/keyboardShortcuts.js::INDICATOR_CHORDS`), adapted in the rail.
 */
export const ACKNOWLEDGED_OVERLAPS = Object.freeze([
  Object.freeze({
    ids: ['palette.close', 'video.escape'],
    kind: 'focus',
    why: 'Escape matches both. While the palette is open focus sits in its input, and '
      + 'video.escape is not inEditable, so it does not fire. Resolved by the focus guard — '
      + 'but only while focus stays in that input.',
  }),
])

// ── conflict detection ───────────────────────────────────────────────────────

export class ShortcutConflictError extends Error {
  constructor(message, conflicts = []) {
    super(message)
    this.name = 'ShortcutConflictError'
    this.conflicts = conflicts
  }
}

export class UnknownShortcutError extends Error {
  constructor(id) {
    super(`registerShortcuts: '${id}' is not declared in SHORTCUTS `
      + '(app/src/pages/command/shortcutRegistry.js). Declare it there first.')
    this.name = 'UnknownShortcutError'
    this.id = id
  }
}

const NAMED_CODE_FOR = { ' ': 'Space' }

/** Physical candidates a chord could be answered by: [{key, code}], both cases for letters. */
function candidatesOf(chord) {
  const out = []
  const push = (key, code) => out.push({ key, code })
  const fromChar = (ch) => {
    const s = String(ch)
    if (/^[a-z]$/i.test(s)) {
      const code = `Key${s.toUpperCase()}`
      push(s.toLowerCase(), code)
      push(s.toUpperCase(), code)
    } else if (/^[0-9]$/.test(s)) {
      push(s, `Digit${s}`)
    } else {
      push(s, NAMED_CODE_FOR[s] || s)
    }
  }
  if (chord.code != null) {
    const m = /^Key([A-Z])$/.exec(chord.code) || /^Digit([0-9])$/.exec(chord.code)
    if (m) fromChar(m[1])
    else if (chord.code === 'Space') push(' ', 'Space')
    else push(chord.code, chord.code)
  } else {
    for (const k of chord.keys) fromChar(k)
  }
  return out
}

const MOD_COMBOS = Array.from({ length: 16 }, (_, n) => ({
  ctrlKey: !!(n & 1), metaKey: !!(n & 2), shiftKey: !!(n & 4), altKey: !!(n & 8),
}))

/**
 * One physical event both chords answer, or null. EXHAUSTIVE over every modifier
 * combination and both platforms, using the SAME `chordMatches` the runtime
 * dispatches with — so order, the Cmd/Ctrl alias and key-vs-code spellings
 * cannot hide an overlap, and there is no second matcher to disagree.
 */
export function overlapExample(a, b) {
  if ((a.type || 'keydown') !== (b.type || 'keydown')) return null
  const phys = [...candidatesOf(a.chord), ...candidatesOf(b.chord)]
  for (const p of phys) {
    for (const mods of MOD_COMBOS) {
      for (const isMac of [false, true]) {
        const e = { ...p, ...mods, repeat: false }
        if (chordMatches(a.chord, e, { isMac }) && chordMatches(b.chord, e, { isMac })) {
          return { ...e, isMac }
        }
      }
    }
  }
  return null
}

/** Every overlapping pair in a declaration set: [{ids:[a,b], example}]. */
export function findShortcutConflicts(decls) {
  const out = []
  for (let i = 0; i < decls.length; i += 1) {
    for (let j = i + 1; j < decls.length; j += 1) {
      const ex = overlapExample(decls[i], decls[j])
      if (ex) out.push({ ids: [decls[i].id, decls[j].id], example: ex })
    }
  }
  return out
}

const pairKey = (a, b) => [a, b].sort().join(' <> ')

/** Throws `ShortcutConflictError` naming every unacknowledged overlapping pair. */
export function assertNoShortcutConflicts(decls, acknowledged = []) {
  const ok = new Set(acknowledged.map((o) => pairKey(...o.ids)))
  const bad = findShortcutConflicts(decls).filter((c) => !ok.has(pairKey(...c.ids)))
  if (bad.length) {
    throw new ShortcutConflictError(
      `shortcut conflict: ${bad.map((c) => `${c.ids[0]} and ${c.ids[1]} both answer `
        + `${JSON.stringify(c.example)}`).join('; ')}`,
      bad,
    )
  }
}

// ── registration ─────────────────────────────────────────────────────────────

const LIVE = new Map() // id -> live registration count

const isProduction = () => {
  try { return !!(import.meta && import.meta.env && import.meta.env.PROD) } catch { return false }
}

/** Does this binding answer this event right now? (chord + auto-repeat + focus). */
export function bindingMatches(d, e, env) {
  if (e.type && e.type !== d.type) return false
  if (!d.repeat && e.repeat) return false
  if (!chordMatches(d.chord, e, env)) return false
  if (!d.inEditable && isEditableFocus(env && env.document)) return false
  return true
}

function resolveTarget(name) {
  if (name === 'window') return typeof window !== 'undefined' ? window : null
  return typeof document !== 'undefined' ? document : null
}

/**
 * Bind handlers to declared shortcut ids. Returns an idempotent cleanup.
 *
 * `handlers` is an object literal `{ '<declared id>': (event) => void }` —
 * the rail reads these keys by AST, so it must be a literal. Within one call,
 * bindings that share a (target, phase) share ONE native listener, and the first
 * matching binding (in the order given) handles the event, as an if/else chain did.
 *
 * ⛔ An undeclared id throws `UnknownShortcutError`. A second LIVE registration of
 * an id already bound throws `ShortcutConflictError` in development and tests; in
 * a production build it is reported to the console and still bound (exactly what
 * two raw listeners would have done), because throwing inside a shared shell
 * component's effect would take the page down — rule H14. Nothing is installed
 * when a registration is refused.
 */
export function registerShortcuts(handlers) {
  const entries = Object.entries(handlers || {})
  const decls = entries.map(([id]) => {
    const d = BY_ID.get(id)
    if (!d) throw new UnknownShortcutError(id)
    return d
  })
  const dupes = decls.filter((d) => (LIVE.get(d.id) || 0) > 0).map((d) => d.id)
  if (dupes.length) {
    const err = new ShortcutConflictError(
      `shortcut conflict: ${dupes.join(', ')} ${dupes.length > 1 ? 'are' : 'is'} already bound `
      + 'by a live registration. One owner per binding — unbind the first before binding again.',
    )
    if (!isProduction()) throw err
    console.error(err)
  }

  const groups = new Map()
  entries.forEach(([, fn], i) => {
    const d = decls[i]
    const k = `${d.target}|${d.capture ? 1 : 0}|${d.type}`
    if (!groups.has(k)) groups.set(k, { target: d.target, capture: d.capture, type: d.type, items: [] })
    groups.get(k).items.push({ d, fn })
  })

  const installed = []
  for (const g of groups.values()) {
    const node = resolveTarget(g.target)
    if (!node) continue
    const listener = (e) => {
      for (const { d, fn } of g.items) {
        if (bindingMatches(d, e)) { fn(e); return }
      }
    }
    node.addEventListener(g.type, listener, g.capture)
    installed.push({ node, type: g.type, listener, capture: g.capture })
  }
  for (const d of decls) LIVE.set(d.id, (LIVE.get(d.id) || 0) + 1)

  let released = false
  return function unregisterShortcuts() {
    if (released) return
    released = true
    for (const { node, type, listener, capture } of installed) {
      node.removeEventListener(type, listener, capture)
    }
    for (const d of decls) {
      const n = (LIVE.get(d.id) || 0) - 1
      if (n > 0) LIVE.set(d.id, n)
      else LIVE.delete(d.id)
    }
  }
}
