// @vitest-environment node
/**
 * S2 CP2 — SNAPSHOT IDENTITY on the one surface that now reads the chord table.
 *
 * The signed scope is *"ONE surface reads the table instead of its local constants, with
 * snapshot-identity on its key handling."* Snapshot identity means exactly this: the new
 * predicate and the expression it replaced must agree on EVERY input, not on the inputs
 * someone thought to try.
 *
 * ⛔ THE LEGACY EXPRESSION IS REPRODUCED VERBATIM BELOW, FROM THE DIFF. If it is ever
 * "tidied", this test stops comparing anything real — so it is copied as a single
 * unformatted line and left ugly on purpose.
 *
 * ⚠️ `!e.repeat` is NOT part of this comparison. It stayed in the handler, so it is
 * outside the chord's identity by design; folding it in here would test the handler's
 * toggle semantics under the name of the chord table.
 */
import { describe, it, expect } from 'vitest';
import { CHORDS, chordById, matchesChord } from './chords.js';

// GridChartCell.jsx, as it read before CP2 (minus `!e.repeat`, see the docblock):
const legacy = (e) =>
  e.shiftKey && (e.key === 'F' || e.key === 'f') && !e.ctrlKey && !e.altKey && !e.metaKey;

const SHIFT_F = chordById('SHIFT_F');
const BOOL = [false, true];
const KEYS = ['F', 'f', 'G', 'g', 'Shift', 'Enter', '', 'FF', 'ArrowUp', '1'];

function* matrix() {
  for (const key of KEYS)
    for (const shiftKey of BOOL)
      for (const ctrlKey of BOOL)
        for (const altKey of BOOL)
          for (const metaKey of BOOL) yield { key, shiftKey, ctrlKey, altKey, metaKey };
}

describe('S2 CP2 — the table matches the expression it replaced, everywhere', () => {
  it('agrees with the legacy guard on the entire modifier matrix', () => {
    const disagreements = [];
    for (const e of matrix()) {
      if (matchesChord(e, SHIFT_F) !== legacy(e)) disagreements.push(e);
    }
    expect(disagreements, `inputs where the table and the old expression disagree: ${JSON.stringify(disagreements)}`).toEqual([]);
  });

  it('the matrix is big enough to mean something (non-vacuity)', () => {
    const all = [...matrix()];
    expect(all.length).toBe(KEYS.length * 16);
    // and it must contain BOTH answers, or "they agree" is trivially true
    const trues = all.filter(legacy).length;
    expect(trues).toBeGreaterThan(0);
    expect(trues).toBeLessThan(all.length);
  });
});

describe('S2 CP2 — the properties the surface now depends on', () => {
  it('fires on Shift+F and Shift+f', () => {
    for (const key of ['F', 'f'])
      expect(matchesChord({ key, shiftKey: true }, SHIFT_F)).toBe(true);
  });

  it('⛔ does NOT fire on Ctrl+Shift+F or Cmd+Shift+F — the F-S2-1 variants', () => {
    expect(matchesChord({ key: 'F', shiftKey: true, ctrlKey: true }, SHIFT_F)).toBe(false);
    expect(matchesChord({ key: 'F', shiftKey: true, metaKey: true }, SHIFT_F)).toBe(false);
    expect(matchesChord({ key: 'F', shiftKey: true, altKey: true }, SHIFT_F)).toBe(false);
  });

  it('does not fire without the required modifier', () => {
    expect(matchesChord({ key: 'F' }, SHIFT_F)).toBe(false);
  });

  it('a missing chord never matches — a bad id disables, it does not open', () => {
    expect(chordById('NO_SUCH_CHORD')).toBeNull();
    expect(matchesChord({ key: 'F', shiftKey: true }, null)).toBe(false);
  });

  it('every declared chord names its forbidden modifiers', () => {
    // ⛔ `requires` alone is how Ctrl+Shift+F became an undeclared chord that worked.
    for (const c of CHORDS) {
      expect(Array.isArray(c.forbids), c.id).toBe(true);
      expect(c.forbids.length, c.id).toBeGreaterThan(0);
    }
  });
});
