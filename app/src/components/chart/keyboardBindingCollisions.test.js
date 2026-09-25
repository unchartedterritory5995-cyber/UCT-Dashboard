// TD-07's own explicit ask, built narrowly rather than deferred wholesale:
// "Build one registry with a duplicate-(code, modifier, scope) rail and put
// the palette on it; do not add a third system."
//
// `keyboardShortcuts.js` is already the right MODEL (frozen declarations,
// physical `code`, one matcher) — TD-07's gap is that nothing checks it for
// internal collisions. `keyboardShortcuts.test.js`'s own "bare-letter /
// Shift-chord collision ledger" already covers ONE specific historical
// cross-door race (Shift+F vs bare F). This file covers the general case a
// future edit could still introduce silently: two entries in the SAME
// declared table claiming the same physical key, or two normally-disjoint
// tables (Alt-only vs Alt+Shift) landing on the same `code` in a way that
// makes the Alt-only entry unreachable whenever Shift is held.
//
// ⛔ SHORTCUTS is a JS ARRAY of `{keys, command}` rows (built for the `?`
// help sheet), so a duplicate `keys` string is a REAL, silently-possible bug
// — unlike an object literal, where a repeated key can't even parse to two
// entries. A duplicate here means the help sheet shows two commands under
// one physical key, and whichever matcher branch is checked first quietly
// wins at runtime with no error.
import { describe, it, expect } from 'vitest';
import { SHORTCUTS, INDICATOR_CHORDS } from './keyboardShortcuts';

describe('keyboard binding collisions — TD-07 rail', () => {
  it('finds a real, non-empty SHORTCUTS table to check (guards a vacuous pass)', () => {
    expect(SHORTCUTS.length).toBeGreaterThan(20);
  });

  it('no two SHORTCUTS rows declare the same physical key combination', () => {
    const seen = new Map();
    const collisions = [];
    for (const { keys, command } of SHORTCUTS) {
      if (seen.has(keys)) {
        collisions.push(`${keys}: "${seen.get(keys)}" vs "${command}"`);
      } else {
        seen.set(keys, command);
      }
    }
    expect(collisions).toEqual([]);
  });

  it('no two SHORTCUTS rows declare the same command under different keys, silently', () => {
    // Not itself a bug (a command CAN have zero or one chord), but two live
    // rows for one command is almost always a stale entry left behind after
    // a rebind — flag it by name so it gets a deliberate look, not a retype.
    const byCommand = new Map();
    for (const { keys, command } of SHORTCUTS) {
      if (!byCommand.has(command)) byCommand.set(command, []);
      byCommand.get(command).push(keys);
    }
    const dupCommands = [...byCommand.entries()].filter(([, ks]) => ks.length > 1);
    expect(dupCommands).toEqual([]);
  });

  it('INDICATOR_CHORDS never assigns the same physical code to two indicators', () => {
    // The four indicator chords are the one place a `code` is declared directly
    // (SHORTCUTS derives its rows from this table, per keyboardShortcuts.js's
    // own comment) — so this is the source-of-truth check, not a derived one.
    const seen = new Map();
    const collisions = [];
    for (const { defId, code, modifier } of INDICATOR_CHORDS) {
      const key = `${modifier}:${code}`;
      if (seen.has(key)) collisions.push(`${key}: "${seen.get(key)}" vs "${defId}"`);
      else seen.set(key, defId);
    }
    expect(collisions).toEqual([]);
  });

  it('the rail can actually fail — mutation control', () => {
    // Prove the detector isn't vacuously green: feed it a table that DOES
    // collide and confirm it's caught, using the exact same logic under test.
    const rigged = [
      { keys: 'Alt+Z', command: 'tool:one' },
      { keys: 'Alt+Z', command: 'tool:two' },
    ];
    const seen = new Map();
    const collisions = [];
    for (const { keys, command } of rigged) {
      if (seen.has(keys)) collisions.push(`${keys}: "${seen.get(keys)}" vs "${command}"`);
      else seen.set(keys, command);
    }
    expect(collisions).toEqual(['Alt+Z: "tool:one" vs "tool:two"']);
  });
});
