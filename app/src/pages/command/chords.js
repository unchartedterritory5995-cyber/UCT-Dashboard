/**
 * S2 — THE COMMAND-CHORD TABLE, as a module a surface can actually read.
 *
 * CP1 (fingerprint `7ae6d9ca2`) declared this table and railed it for collisions, but it
 * lived as a `const` INSIDE `chordCollision.test.js` — so nothing shippable could read it
 * and "the binding table as declared data" was, in practice, declared to the test alone.
 * CP2 moves it here unchanged and points both the rail and one surface at it.
 *
 * ⛔ ONE AUTHORITY. `chordCollision.test.js` imports `CHORDS` from here rather than
 * keeping a copy. Two lists that must agree are the defect this table exists to prevent —
 * a chord table with a second authority over chord identity is worse than no table.
 *
 * ⚠️ `repeat` IS DELIBERATELY NOT A CHORD PROPERTY. Whether a held key should re-fire is
 * a property of the BINDING (a toggle must not auto-repeat ~30×/sec; a scroll may), not
 * of the chord's identity. Handlers keep their own `!e.repeat` guard and their own reason
 * for it.
 */

/** @typedef {{id:string,binding:string,key:string,requires:string[],forbids:string[],why:string}} Chord */

/** @type {Chord[]} */
export const CHORDS = [
  {
    id: 'SHIFT_F',
    binding: 'flag-ticker',
    key: 'F',
    requires: ['shift'],
    forbids: ['ctrl', 'alt', 'meta'],
    why: 'flag the selected ticker. The 2026-08-28 collision fixture (HY-35).',
  },
];

export const chordById = (id) => CHORDS.find((c) => c.id === id) || null;

const MODIFIER_PROP = { shift: 'shiftKey', ctrl: 'ctrlKey', alt: 'altKey', meta: 'metaKey' };

/**
 * Does this keyboard event match the declared chord?
 *
 * ⛔ `forbids` IS THE HALF THAT MATTERS. A guard that checks only `requires` answers the
 * platform-alias variants it never declared — which is exactly how `Ctrl+Shift+F` came to
 * flag a ticker on three surfaces while being correctly ignored on two (F-S2-1).
 *
 * ⛔ The key comparison is case-insensitive BY CONSTRUCTION: `Shift+f` and `Shift+F` are
 * the same physical chord, and which one the browser reports depends on caps-lock.
 */
export function matchesChord(e, chord) {
  if (!e || !chord) return false;
  if (String(e.key).toLowerCase() !== String(chord.key).toLowerCase()) return false;
  for (const m of chord.requires) if (!e[MODIFIER_PROP[m]]) return false;
  for (const m of chord.forbids) if (e[MODIFIER_PROP[m]]) return false;
  return true;
}
