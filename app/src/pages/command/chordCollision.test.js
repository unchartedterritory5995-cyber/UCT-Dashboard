/**
 * S2 **CP1** — THE COMMAND-CHORD TABLE AS DECLARED DATA, PLUS A COLLISION RAIL.
 * GATE-S2 line 1, approval fingerprint `7ae6d9ca2`.
 *
 * The signed scope, verbatim:
 *
 *   CP1 - THE COMMAND-CHORD TABLE AS DECLARED DATA plus a COLLISION RAIL that
 *   fails on any two chords resolving to the same binding, INCLUDING
 *   modifier-order and platform-alias variants. The 2026-08-28 collision is the
 *   fixture. NO change to the shipped palette's behaviour. The rail runs against
 *   the LIVE binding set, never a copy of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⛔⛔ THE FIXTURE IS NOT HISTORY. IT IS STILL SHIPPED, IN ITS MODIFIER FORM.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The 2026-08-28 collision (HY-35) was *"one chord flagged a ticker in two
 * widgets at once"*, fixed by making widget ownership explicit. Measured on
 * 2026-09-13, **five surfaces claim Shift+F and they do not agree on which
 * modifiers they respond to**:
 *
 *   ChartPane.jsx        shift && (F|f) && !repeat && !ctrl && !alt && !meta
 *   GridChartCell.jsx    shift && (F|f) && !repeat && !ctrl && !alt && !meta
 *   TickerPopup.jsx      shift && (F|f) && !repeat
 *   ThemeTrackerPage.jsx shift && (F|f) && !repeat
 *   Watchlists.jsx       shift && (F|f) && !repeat && selectedSym
 *
 * ⚰️ S2 CP3 (2026-09-19) moved ChartPane.jsx onto the declared table too — it now
 * reads `matchesChord(e, SHIFT_F)` (see `tableReadersOf` below) rather than
 * spelling the modifier set inline. The population count and the modifier
 * signatures above are the 2026-09-13 snapshot the collision fixture is measured
 * against; `claimsOf`/`tableReadersOf` are what stay live.
 *
 * ⭐ **So `Ctrl+Shift+F` — and its platform alias `Cmd+Shift+F` — is an
 * UNDECLARED chord that nevertheless flags the ticker on three surfaces while
 * being correctly ignored on two.** A member reaching for a browser or OS chord
 * gets a silent write to their flag list on some screens and not others. That is
 * the 2026-08-28 class in its modifier form, and it is live.
 *
 * ⛔ **CP1 MAY NOT FIX IT.** The scope says *"NO change to the shipped palette's
 * behaviour."* Tightening three guards is a behaviour change and belongs to a
 * line that names it. So the loose sites are **BASELINED** — recorded here by
 * name, with the suite green today — and a SIXTH loose site fails. That is the
 * S5-CP2 construction the owner approved: today's sites baselined rather than
 * failed, so the rail protects the next one instead of blocking the commit.
 * Registered as **F-S2-1**.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⛔ DERIVED FROM THE LIVE BINDING SET, NEVER A COPY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The scope is explicit: *"The rail runs against the LIVE binding set, never a
 * copy of it."* Every guard below is parsed out of the shipped `.jsx`/`.js`
 * sources at test time. ⛔ A hand-listed table of chords would be a second
 * authority over the very thing this rail exists to police, and it would agree
 * with itself forever.
 */
import { describe, it, expect } from 'vitest'
import { CHORDS } from './chords.js'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', '..')

/**
 * ⛔ THE DECLARED CHORD TABLE — the one place a chord's IDENTITY is written.
 *
 * `binding` is what the chord DOES. Two different bindings on one normalized
 * chord is a collision and fails. `forbids` is the modifier set a correct guard
 * excludes; a surface that omits it answers platform-alias variants it never
 * declared.
 */
// ⛔ CP2: the table moved to ./chords.js so a SURFACE can read it. Imported, never
// copied - two lists that must agree is the defect this table exists to prevent.

/**
 * ⛔ SURFACES WHOSE Shift+F GUARD OMITS THE MODIFIER EXCLUSIONS, AS OF
 * 2026-09-13. Baselined, NOT blessed — see F-S2-1. A sixth entry is a new
 * defect and fails by name.
 *
 * ⚠️ `Watchlists.jsx` is here for the same reason as the other two: its extra
 * `selectedSym` term is a STATE guard, not a modifier guard, so it answers
 * Ctrl+Shift+F exactly as the other loose sites do.
 */
// ✅ EMPTY since 2026-09-14 — F-S2-1 CLOSED. The three surfaces that answered
// Ctrl/Cmd+Shift+F (TickerPopup, ThemeTrackerPage, Watchlists) now carry the same
// modifier exclusions ChartPane.jsx has always had.
//
// ⛔ DO NOT DELETE THIS LIST NOW THAT IT IS EMPTY. Both directions still run
// against it: a NEW loose surface fails by name, and an empty baseline is what
// makes that failure mean 'a defect was introduced' rather than 'the list drifted'.
const LOOSE_MODIFIER_BASELINE = []

// ── walking the live sources ────────────────────────────────────────────────

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name)
    if (name.isDirectory()) {
      if (name.name === 'node_modules' || name.name === '__tests__') continue
      sourceFiles(p, out)
    } else if (/\.(js|jsx)$/.test(name.name) && !/\.test\.(js|jsx)$/.test(name.name)) {
      out.push(p)
    }
  }
  return out
}

/**
 * Every surface whose source contains a guard for this chord, with the modifier
 * set that guard EXCLUDES.
 *
 * ⛔ The match is anchored to the `shiftKey && (e.key === 'F' ...)` conjunction,
 * not to a bare mention of `'F'` — the letter appears in prose, in enum values
 * and in a dozen unrelated comparisons across the tree.
 */
function claimsOf(chord) {
  const claims = []
  for (const file of sourceFiles(SRC)) {
    const src = readFileSync(file, 'utf8')
    const rx = new RegExp(
      `\\w+\\.shiftKey\\s*&&\\s*\\([^)]*\\.key === '${chord.key}'[^)]*\\)([^{;]*)`, 'g')
    let m
    while ((m = rx.exec(src)) !== null) {
      const tail = m[1] || ''
      const forbids = []
      if (/!\w+\.ctrlKey/.test(tail)) forbids.push('ctrl')
      if (/!\w+\.altKey/.test(tail)) forbids.push('alt')
      if (/!\w+\.metaKey/.test(tail)) forbids.push('meta')
      claims.push({
        file: relative(SRC, file).replace(/\\/g, '/'),
        forbids: forbids.sort(),
      })
    }
  }
  return claims
}

/**
 * Every surface that reads the chord from the TABLE instead of spelling it inline.
 *
 * ⛔ CP2 MOVES SURFACES FROM ONE DERIVATION TO THE OTHER, so the rail must count BOTH
 * or its non-vacuity control fails the moment CP2 succeeds - which is exactly what it did
 * on 2026-09-14. The population is what must stay >= 5; its COMPOSITION is what CP2
 * changes, and it may only move one way: inline -> table.
 */
function tableReadersOf(chord) {
  const out = []
  for (const file of sourceFiles(SRC)) {
    if (file.includes('.test.')) continue          // the rails reference it by nature
    const src = readFileSync(file, 'utf8')
    const rx = new RegExp('matchesChord\\s*\\([^,]+,\\s*' + chord.id + '\\b')
    if (rx.test(src)) out.push(relative(SRC, file).split(String.fromCharCode(92)).join('/'))
  }
  return out
}

/**
 * ⛔ NORMALISATION IS THE POINT OF THE RAIL, not a detail.
 *
 * `Ctrl+Shift+F`, `Shift+Ctrl+F` and (on macOS) `Cmd+Shift+F` are ONE chord to a
 * member and three strings to a naive comparison. Modifiers are SORTED, so order
 * cannot create a phantom second chord; and `meta` folds to `ctrl`, because the
 * accelerator modifier is the same *intent* on both platforms — which is exactly
 * the "platform-alias variant" the scope names.
 */
export function normalizeChord(key, mods) {
  const folded = mods.map(m => (m === 'meta' || m === 'cmd' ? 'ctrl' : m))
  return [...new Set(folded)].sort().concat(key.toUpperCase()).join('+')
}

// ═══════════════════════════════════════════════════════════════════════════
// NON-VACUITY — every assertion below is satisfied by an empty derivation
// ═══════════════════════════════════════════════════════════════════════════

describe('S2 CP1 — the derivation can see the live binding set', () => {
  it('NON-VACUITY: it finds a real population of sources and of claims', () => {
    const files = sourceFiles(SRC)
    expect(files.length).toBeGreaterThan(500)
    const claims = claimsOf(CHORDS[0])
    const readers = tableReadersOf(CHORDS[0])
    // ⛔ THE POPULATION, not the inline half. CP2 moves surfaces off the inline
    // derivation and onto the table; counting only inline guards makes this control
    // fail the moment the work it is meant to protect actually lands.
    expect(claims.length + readers.length,
      'no Shift+F binding was found at all — the parser is broken, not the codebase')
      .toBeGreaterThanOrEqual(5)
    expect(readers.length,
      'CP2 put at least one surface on the table; if this is 0 the table is unread again')
      .toBeGreaterThanOrEqual(1)
  })

  it('CONTROL: the matcher reads the GUARD, not a bare mention of the letter', () => {
    const chord = CHORDS[0]
    const rx = new RegExp(
      `\\w+\\.shiftKey\\s*&&\\s*\\([^)]*\\.key === '${chord.key}'[^)]*\\)([^{;]*)`)
    expect(rx.test("// pressing F flags the ticker")).toBe(false)
    expect(rx.test("const grade = 'F'")).toBe(false)
    expect(rx.test("if (e.shiftKey && (e.key === 'F' || e.key === 'f') && !e.repeat) {")).toBe(true)
  })

  it('CONTROL: normalisation folds modifier ORDER and the PLATFORM ALIAS', () => {
    // Order cannot create a second chord.
    expect(normalizeChord('f', ['ctrl', 'shift']))
      .toBe(normalizeChord('F', ['shift', 'ctrl']))
    // Cmd on macOS is Ctrl on Windows — one chord, not two.
    expect(normalizeChord('F', ['meta', 'shift']))
      .toBe(normalizeChord('F', ['ctrl', 'shift']))
    // ⛔ And it must still DISCRIMINATE, or it would collapse every chord into one.
    expect(normalizeChord('F', ['shift'])).not.toBe(normalizeChord('F', ['ctrl', 'shift']))
    expect(normalizeChord('F', ['shift'])).not.toBe(normalizeChord('G', ['shift']))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// THE COLLISION RAIL
// ═══════════════════════════════════════════════════════════════════════════

describe('S2 CP1 — no two bindings claim one chord', () => {
  it('every declared chord normalizes to a DISTINCT binding', () => {
    const byChord = new Map()
    for (const c of CHORDS) {
      const norm = normalizeChord(c.key, c.requires)
      const seen = byChord.get(norm)
      expect(seen === undefined || seen === c.binding,
        `chord ${norm} resolves to BOTH '${seen}' and '${c.binding}' — that is a ` +
        'collision, and modifier order or a platform alias will not save it').toBe(true)
      byChord.set(norm, c.binding)
    }
    expect(byChord.size).toBe(CHORDS.length)
  })

  it('the declared table and the live sources agree that Shift+F is flag-ticker', () => {
    const chord = CHORDS[0]
    const claims = claimsOf(chord)
    // ⛔ INLINE **OR** TABLE. CP2 moved GridChartCell onto the declared table, so it no
    // longer spells the guard out - but it still BINDS the chord, which is what this
    // assertion is protecting. Checking only the inline derivation would fail the moment
    // the migration this packet exists to perform actually happens.
    const files = claims.map(c => c.file).concat(tableReadersOf(chord))
    // The two surfaces that guard it correctly must still be there — if the
    // STRICT sites vanish, the baseline below stops meaning anything.
    expect(files).toContain('components/chart/pane/ChartPane.jsx')
    expect(files).toContain('pages/charts/grid/GridChartCell.jsx')
  })
})

describe('S2 CP1 — platform-alias variants reach no NEW surface', () => {
  it('no SIXTH surface answers Ctrl/Cmd+Shift+F', () => {
    const chord = CHORDS[0]
    const loose = claimsOf(chord)
      .filter(c => chord.forbids.some(m => !c.forbids.includes(m)))
      .map(c => c.file)
      .sort()

    const added = loose.filter(f => !LOOSE_MODIFIER_BASELINE.includes(f))
    expect(added, added.length
      ? `NEW surface(s) answering Ctrl+Shift+F / Cmd+Shift+F: ${added.join(', ')}.\n` +
        "A guard of the shape `e.shiftKey && (e.key === 'F' ...)` WITHOUT " +
        '`!e.ctrlKey && !e.altKey && !e.metaKey` fires on the platform accelerator ' +
        'chord too, silently writing to the member\'s flag list on a keystroke they ' +
        'aimed at the browser. Add the exclusions — ChartPane.jsx is the shape to copy.'
      : '').toEqual([])
  })

  it('the baseline has not gone stale in the other direction', () => {
    // ⭐ A site that gets FIXED must leave the baseline deliberately, or the
    // record quietly outlives the defect it describes.
    const chord = CHORDS[0]
    const loose = claimsOf(chord)
      .filter(c => chord.forbids.some(m => !c.forbids.includes(m)))
      .map(c => c.file)
    const fixed = LOOSE_MODIFIER_BASELINE.filter(f => !loose.includes(f))
    expect(fixed, fixed.length
      ? `${fixed.join(', ')} no longer omits the modifier exclusions — remove it ` +
        'from LOOSE_MODIFIER_BASELINE in the same commit that fixed it, and close ' +
        'F-S2-1 when the list is empty.'
      : '').toEqual([])
  })

  it('records WHICH surfaces are loose, so F-S2-1 has a measurement not an adjective', () => {
    const chord = CHORDS[0]
    const loose = claimsOf(chord)
      .filter(c => chord.forbids.some(m => !c.forbids.includes(m)))
    // ⛔ Three of the five BINDING surfaces, and the count is asserted so a silent drift
    // in either direction is caught even if the file list somehow still matched.
    expect(loose.length).toBe(LOOSE_MODIFIER_BASELINE.length)
    // ⭐ The POPULATION is five; CP2 changes only how each member binds. A surface on the
    // table cannot be loose by construction - `forbids` is enforced in one place - so a
    // migration can only ever SHRINK the loose set, never hide it.
    expect(claimsOf(chord).length + tableReadersOf(chord).length).toBeGreaterThanOrEqual(5)
  })
})
