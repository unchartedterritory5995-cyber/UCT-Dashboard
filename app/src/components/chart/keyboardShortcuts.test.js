import { describe, it, expect } from 'vitest';
import { INDICATOR_CHORDS, matchShortcut, matchOverlayTool, chordForTool, resetShiftLatch, SHORTCUTS, TF_ORDER, resolveTfCycle } from './keyboardShortcuts';
import { labelFor } from './indicatorCatalog';
import { CHART_DEFAULTS } from './chartDefaults';
import * as engineRegistry from './engine/nativeRegistry';
import { listDefinitions } from './engine/nativeRegistry';


// ⛔ THE SHIFT LATCH IS MODULE STATE, and a keydown-only test never fires the
// keyup that would clear it. Without this reset the 26-letter Shift sweep below
// latches every letter and silently mutes the bare-letter tests that follow —
// the leak showed up as "arms undefined" the first time this file grew a sweep.
beforeEach(() => resetShiftLatch());

function evt(key, opts = {}) {
  return {
    key,
    code: opts.code,
    ctrlKey: opts.ctrl,
    shiftKey: opts.shift,
    altKey: opts.alt,
    metaKey: opts.meta,
    repeat: opts.repeat,
  };
}


describe('matchShortcut', () => {
  it('returns "tf:D" for bare "1"', () => {
    expect(matchShortcut(evt('1'))).toBe('tf:D');
  });

  it('returns "tf:W" for bare "5"', () => {
    expect(matchShortcut(evt('5'))).toBe('tf:W');
  });

  it('bare "d"/"w" no longer switch timeframe (freed for ticker search)', () => {
    expect(matchShortcut(evt('d'))).toBe(null);
    expect(matchShortcut(evt('w'))).toBe(null);
  });

  it('returns "tool:trendline" for "t"', () => {
    expect(matchShortcut(evt('t'))).toBe('tool:trendline');
  });

  it('returns "tool:horizontal" for "h"', () => {
    expect(matchShortcut(evt('h'))).toBe('tool:horizontal');
  });

  it('returns "tool:cursor" for "Escape"', () => {
    expect(matchShortcut(evt('Escape'))).toBe('tool:cursor');
  });

  it('shift+H is no longer bound (Heikin Ashi shortcut removed)', () => {
    expect(matchShortcut(evt('H', { shift: true }))).toBe(null);
    expect(matchShortcut(evt('H', { shift: true, code: 'KeyH' }))).toBe(null);
  });

  it('returns "toggle:log" for shift+L', () => {
    expect(matchShortcut(evt('L', { shift: true }))).toBe('toggle:log');
  });

  it('returns "help" for "?"', () => {
    expect(matchShortcut(evt('?'))).toBe('help');
  });

  it('returns null for unknown key', () => {
    expect(matchShortcut(evt('q'))).toBe(null);
  });

  it('ignores when ctrl is held for non-toggle keys (preserve browser shortcuts)', () => {
    expect(matchShortcut(evt('t', { ctrl: true }))).toBe(null);
    expect(matchShortcut(evt('f', { ctrl: true }))).toBe(null);
  });

  it('ignores when meta is held for non-toggle keys', () => {
    expect(matchShortcut(evt('t', { meta: true }))).toBe(null);
  });

  it('returns "toggle:rsi" for Ctrl+I', () => {
    expect(matchShortcut(evt('i', { ctrl: true }))).toBe('toggle:rsi');
    expect(matchShortcut(evt('I', { ctrl: true }))).toBe('toggle:rsi');
  });

  it('returns "toggle:macd" for Ctrl+O', () => {
    expect(matchShortcut(evt('o', { ctrl: true }))).toBe('toggle:macd');
  });

  it('returns "toggle:bb" for Ctrl+B', () => {
    expect(matchShortcut(evt('b', { ctrl: true }))).toBe('toggle:bb');
  });

  it('returns "toggle:ma" for Ctrl+M', () => {
    expect(matchShortcut(evt('m', { ctrl: true }))).toBe('toggle:ma');
  });

  it('returns "toggle:volume" for Ctrl+V', () => {
    expect(matchShortcut(evt('v', { ctrl: true }))).toBe('toggle:volume');
  });

  it('supports Cmd (meta) for toggles on Mac', () => {
    expect(matchShortcut(evt('m', { meta: true }))).toBe('toggle:ma');
    expect(matchShortcut(evt('v', { meta: true }))).toBe('toggle:volume');
  });

  it('plain i/o/b no longer toggle indicators (now require Ctrl)', () => {
    expect(matchShortcut(evt('i'))).toBe(null);
    expect(matchShortcut(evt('o'))).toBe(null);
    expect(matchShortcut(evt('b'))).toBe(null);
  });

  it('plain m is now unbound; plain v stays the vertical-line tool', () => {
    expect(matchShortcut(evt('m'))).toBe(null);
    expect(matchShortcut(evt('v'))).toBe('tool:vertical');
  });

  it('SHORTCUTS array structure', () => {
    expect(Array.isArray(SHORTCUTS)).toBe(true);
    expect(SHORTCUTS.length).toBeGreaterThan(0);
    for (const s of SHORTCUTS) {
      expect(typeof s.keys).toBe('string');
      expect(typeof s.command).toBe('string');
      expect(typeof s.description).toBe('string');
    }
  });

  it('maps Shift+digit to the intraday timeframes by physical key', () => {
    // Shift+1 produces "!" on a US layout — the code is what identifies the key.
    expect(matchShortcut(evt('!', { shift: true, code: 'Digit1' }))).toBe('tf:1');
    expect(matchShortcut(evt('#', { shift: true, code: 'Digit3' }))).toBe('tf:5');
    expect(matchShortcut(evt('$', { shift: true, code: 'Digit4' }))).toBe('tf:15');
    expect(matchShortcut(evt('%', { shift: true, code: 'Digit5' }))).toBe('tf:30');
    expect(matchShortcut(evt('^', { shift: true, code: 'Digit6' }))).toBe('tf:60');
  });

  it('accepts the numpad for Shift+digit timeframes', () => {
    expect(matchShortcut(evt('1', { shift: true, code: 'Numpad1' }))).toBe('tf:1');
    expect(matchShortcut(evt('6', { shift: true, code: 'Numpad6' }))).toBe('tf:60');
  });

  it('leaves Shift+2 unbound (reserved for a future 2-minute timeframe)', () => {
    expect(matchShortcut(evt('@', { shift: true, code: 'Digit2' }))).toBe(null);
  });

  it('returns "tf:M" for bare "9"', () => {
    expect(matchShortcut(evt('9'))).toBe('tf:M');
  });

  it('leaves unassigned bare digits unbound', () => {
    expect(matchShortcut(evt('2'))).toBe(null);
    expect(matchShortcut(evt('3'))).toBe(null);
    expect(matchShortcut(evt('4'))).toBe(null);
    expect(matchShortcut(evt('7'))).toBe(null);
    expect(matchShortcut(evt('0'))).toBe(null);
  });

  it('keeps the Shift letter toggles working alongside Shift+digit', () => {
    expect(matchShortcut(evt('L', { shift: true, code: 'KeyL' }))).toBe('toggle:log');
    expect(matchShortcut(evt('C', { shift: true, code: 'KeyC' }))).toBe('toggle:countdown');
  });

  it('every SHORTCUTS timeframe command names a real rung', () => {
    for (const s of SHORTCUTS) {
      if (s.command.startsWith('tf:')) {
        expect(TF_ORDER).toContain(s.command.slice(3));
      }
    }
  });
});


describe('the four indicator chords are declared once', () => {
  // ⚠️ FOUR, ACROSS TWO MODIFIERS. B3's ledger called this "two shortcuts, one
  // file", then three, then FOUR across FOUR regions in TWO files — and every
  // correction came from someone reading the code rather than the previous
  // number. `Alt+U` is the one that keeps getting missed, because `matchShortcut`
  // REJECTS Alt and its live handler is StockChart's own `e.altKey` block.

  it('names exactly the four, with their real modifiers', () => {
    expect(INDICATOR_CHORDS.map(c => [c.defId, c.keys, c.modifier])).toEqual([
      ['rsi', 'Ctrl+I', 'ctrl'],
      ['macd', 'Ctrl+O', 'ctrl'],
      ['bb', 'Ctrl+B', 'ctrl'],
      ['vwap', 'Alt+U', 'alt'],
    ]);
    // …and the `code` really is the physical key the `keys` label promises, or
    // the Alt handler (which matches on `e.code`) and the help sheet disagree.
    expect(INDICATOR_CHORDS.map(c => c.code))
      .toEqual(INDICATOR_CHORDS.map(c => 'Key' + c.keys.split('+').pop()));
  });

  it('every chord names a definition that exists', () => {
    const known = new Set(engineRegistry.listDefinitions().map(d => d.id));
    expect(INDICATOR_CHORDS.filter(c => !known.has(c.defId)).map(c => c.defId)).toEqual([]);
    // A chord for a carved-out key would route at `setIndicatorEnabled`, which
    // refuses a definition-less id BY IDENTITY — the keystroke would do nothing.
    // ⭐ B5 TASK 9: a chord names a DEFINITION, not a settings section — the blob
    // stopped enumerating indicators, so `in CHART_DEFAULTS.indicators` answered
    // false for all four and this case reported every live chord as dangling.
    const _defIds = new Set(listDefinitions().map(d => d.id));
    expect(INDICATOR_CHORDS.filter(c => !_defIds.has(c.defId))).toEqual([]);
  });

  it('the help sheet rows are GENERATED from it, description included', () => {
    for (const c of INDICATOR_CHORDS) {
      const row = SHORTCUTS.find(s => s.keys === c.keys);
      expect(row, c.keys).toBeTruthy();
      expect(row.command).toBe('toggle:' + c.defId);
      expect(row.description).toBe('Toggle ' + labelFor(c.defId));
    }
    // ⛔ AND NOTHING ELSE NAMES AN INDICATOR. A hand-written row left beside the
    // spread would show the user a second, stale line for the same chord — which
    // is the exact shape ("declared twice, one of them dead") this table ends.
    const indicatorRows = SHORTCUTS
      .filter(s => s.command.startsWith('toggle:')
        && new Set(listDefinitions().map(d => d.id)).has(s.command.slice(7)));
    expect(indicatorRows.map(s => s.command))
      .toEqual(INDICATOR_CHORDS.map(c => 'toggle:' + c.defId));
    // The two non-indicator Ctrl rows are NOT chords — `ma` toggles four overlay
    // slots and `volume` a pane, and neither is a definition — so they stay
    // hand-written and must survive the generation.
    expect(SHORTCUTS.find(s => s.keys === 'Ctrl+M').command).toBe('toggle:ma');
    expect(SHORTCUTS.find(s => s.keys === 'Ctrl+V').command).toBe('toggle:volume');
  });

  it('matchShortcut resolves the Ctrl chords from the table, and still rejects Alt', () => {
    expect(matchShortcut(evt('i', { ctrl: true }))).toBe('toggle:rsi');
    expect(matchShortcut(evt('o', { ctrl: true }))).toBe('toggle:macd');
    expect(matchShortcut(evt('b', { ctrl: true }))).toBe('toggle:bb');
    // ⛔ Alt is still rejected here ON PURPOSE — browser Alt shortcuts keep
    // working, and StockChart's own block is the live handler. If this ever
    // returned a command, the Alt block and the `toggle:` dispatch would BOTH fire.
    expect(matchShortcut(evt('u', { alt: true, code: 'KeyU' }))).toBe(null);
    // ⛔ …and an ALT chord must not leak into the CTRL map either. `Alt+U`'s code
    // is `KeyU`, so a matcher built without the `modifier === 'ctrl'` filter binds
    // **Ctrl+U** to VWAP — a chord nobody declared, stealing a browser combo, and
    // invisible to the Alt assertion above (Alt is rejected on the first line).
    expect(matchShortcut(evt('u', { ctrl: true }))).toBe(null);
    // …and the non-indicator Ctrl chords are untouched.
    expect(matchShortcut(evt('m', { ctrl: true }))).toBe('toggle:ma');
    expect(matchShortcut(evt('v', { ctrl: true }))).toBe('toggle:volume');
  });
});


describe('TF_ORDER', () => {
  it('is the eight-rung ladder in time order', () => {
    expect(TF_ORDER).toEqual(['1', '5', '15', '30', '60', 'D', 'W', 'M']);
  });
});


describe('resolveTfCycle', () => {
  const cold = { lastCommand: null, lastIndex: null };

  it('goes to the key home on a cold press', () => {
    expect(resolveTfCycle({ command: 'tf:1', currentTf: 'D', ...cold }))
      .toEqual({ tf: '1', index: 0 });
    expect(resolveTfCycle({ command: 'tf:D', currentTf: '5', ...cold }))
      .toEqual({ tf: 'D', index: 5 });
    expect(resolveTfCycle({ command: 'tf:M', currentTf: '5', ...cold }))
      .toEqual({ tf: 'M', index: 7 });
  });

  it('advances one rung when the same key repeats', () => {
    // Shift+1 pressed twice: home 1m, then 5m.
    const first = resolveTfCycle({ command: 'tf:1', currentTf: 'D', ...cold });
    const second = resolveTfCycle({
      command: 'tf:1', currentTf: first.tf,
      lastCommand: 'tf:1', lastIndex: first.index,
    });
    expect(second).toEqual({ tf: '5', index: 1 });
  });

  it('walks the entire ladder and wraps', () => {
    const seen = [];
    let last = { command: null, index: null };
    let currentTf = 'D';
    for (let i = 0; i < 9; i++) {
      const next = resolveTfCycle({
        command: 'tf:1', currentTf,
        lastCommand: last.command, lastIndex: last.index,
      });
      seen.push(next.tf);
      currentTf = next.tf;
      last = { command: 'tf:1', index: next.index };
    }
    expect(seen).toEqual(['1', '5', '15', '30', '60', 'D', 'W', 'M', '1']);
  });

  it('advances instead of no-opping when already sitting on the key home', () => {
    // Chart is already Daily (clicked in the TF bar); pressing 1 must move.
    expect(resolveTfCycle({ command: 'tf:D', currentTf: 'D', ...cold }))
      .toEqual({ tf: 'W', index: 6 });
  });

  it('resets to home when a different timeframe key is pressed', () => {
    // Mid-walk at Monthly via tf:1, then press 5 (home Weekly).
    expect(resolveTfCycle({
      command: 'tf:W', currentTf: 'M',
      lastCommand: 'tf:1', lastIndex: 7,
    })).toEqual({ tf: 'W', index: 6 });
  });

  it('breaks the chain when the timeframe changed by other means', () => {
    // Last keypress landed on 15m (index 2) but the TF bar moved us to 60.
    expect(resolveTfCycle({
      command: 'tf:1', currentTf: '60',
      lastCommand: 'tf:1', lastIndex: 2,
    })).toEqual({ tf: '1', index: 0 });
  });

  it('returns null for a command outside the ladder', () => {
    expect(resolveTfCycle({ command: 'tf:ZZ', currentTf: 'D', ...cold })).toBe(null);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// matchOverlayTool — the drawing overlay's key→tool door.
//
// ⛔⛔ REGRESSION RAIL (2026-08-28). `ChartDrawingOverlay` used to carry its OWN
// key→tool switch, and that switch bound **Shift+F → fibext** and
// **Shift+P → pitchfork**. Every list surface (Watchlists, Breadth, Theme
// Tracker, ChartPane, GridChartCell) binds **Shift+F to FLAG the selected
// ticker**, and BOTH listeners sit on `window` — so one Shift+F flagged the
// ticker AND armed the Fibonacci extension. The owner hit this scanning lists.
//
// `stopPropagation()` in the pane handlers could never save it: two listeners on
// the SAME node need `stopImmediatePropagation`, and from a list row the event
// never passes through the pane element at all.
//
// The sweep below is the real rail — it pins the CLASS (no Shift+letter arms a
// tool), not just the one letter that was reported.
// ─────────────────────────────────────────────────────────────────────────────
describe('matchOverlayTool — Shift+letter is never a drawing tool', () => {
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  it('Shift+F arms no tool (it is the flag chord)', () => {
    expect(matchOverlayTool(evt('F', { shift: true, code: 'KeyF' }))).toBe(null);
  });

  it('Shift+P arms no tool (pitchfork moved to Alt+Y)', () => {
    expect(matchOverlayTool(evt('P', { shift: true, code: 'KeyP' }))).toBe(null);
  });

  it('NO Shift+<letter> arms a tool, for any letter', () => {
    const armed = LETTERS
      .map(L => [L, matchOverlayTool(evt(L, { shift: true, code: 'Key' + L }))])
      .filter(([, tool]) => tool !== null);
    expect(armed).toEqual([]);
  });
});

describe('matchOverlayTool — reachability is preserved', () => {
  it('every tool the old Shift chords reached still has a chord', () => {
    expect(matchOverlayTool(evt('e', { alt: true, code: 'KeyE' }))).toBe('fibext');
    expect(matchOverlayTool(evt('y', { alt: true, code: 'KeyY' }))).toBe('pitchfork');
    expect(matchOverlayTool(evt('m', { alt: true, code: 'KeyM' }))).toBe('measure');
  });

  it('the bare-letter tools are untouched (they are the railed design)', () => {
    expect(matchOverlayTool(evt('f'))).toBe('fib');
    expect(matchOverlayTool(evt('t'))).toBe('trendline');
    expect(matchOverlayTool(evt('h'))).toBe('horizontal');
    expect(matchOverlayTool(evt('r'))).toBe('rect');
    expect(matchOverlayTool(evt('x'))).toBe('text');
    expect(matchOverlayTool(evt('m'))).toBe('measure');
    expect(matchOverlayTool(evt('v'))).toBe('cursor');
  });

  it('Alt+Shift power tools still resolve', () => {
    expect(matchOverlayTool(evt('P', { alt: true, shift: true, code: 'KeyP' }))).toBe('priceRange');
    expect(matchOverlayTool(evt('D', { alt: true, shift: true, code: 'KeyD' }))).toBe('dateRange');
    expect(matchOverlayTool(evt('E', { alt: true, shift: true, code: 'KeyE' }))).toBe('eraser');
  });

  it('Ctrl/Meta combos are left to the browser', () => {
    expect(matchOverlayTool(evt('f', { ctrl: true, code: 'KeyF' }))).toBe(null);
    expect(matchOverlayTool(evt('f', { meta: true, code: 'KeyF' }))).toBe(null);
  });
});

describe('every overlay tool chord is declared in the help sheet', () => {
  it('Alt+Y (pitchfork) and Alt+M (measure) appear in SHORTCUTS', () => {
    const commands = SHORTCUTS.map(s => s.command);
    expect(commands).toContain('tool:pitchfork');
    expect(commands).toContain('tool:measure');
  });

  it('no SHORTCUTS row still advertises a Shift+<letter> drawing tool', () => {
    const offenders = SHORTCUTS
      .filter(s => s.command.startsWith('tool:'))
      .filter(s => /^Shift\+[A-Z]$/.test(s.keys));
    expect(offenders).toEqual([]);
  });
});


// ⭐ THE ROUND TRIP. An advertised chord is a PROMISE about a keypress, so it is
// not enough that the tooltip and the matcher agree on a NAME — press the chord
// and the matcher must hand back that exact tool. This is what would have caught
// "Fibonacci Extension (Shift+F)" and "Position Tool (P)" the day they rotted.
describe('chordForTool round-trips through matchOverlayTool', () => {
  const TOOLBAR_TOOLS = [
    'trendline', 'horizontal', 'hray', 'vertical', 'rect', 'circle', 'arrow',
    'fib', 'fibext', 'pitchfork', 'avwap', 'text', 'measure', 'position',
  ];

  // Turn 'Alt+E' / 'Alt+Shift+P' / 'F' back into the event that spells it.
  function eventFor(chord) {
    const parts = chord.split('+');
    const letter = parts[parts.length - 1];
    return evt(letter.toLowerCase(), {
      alt: parts.includes('Alt'),
      shift: parts.includes('Shift'),
      code: 'Key' + letter.toUpperCase(),
    });
  }

  it.each(TOOLBAR_TOOLS)('pressing the advertised chord for %s arms %s', (tool) => {
    const chord = chordForTool(tool);
    expect(chord, `${tool} has no chord to advertise`).toBeTruthy();
    expect(matchOverlayTool(eventFor(chord))).toBe(tool);
  });

  it('no toolbar tool advertises a Shift+<letter> chord', () => {
    const shifted = TOOLBAR_TOOLS
      .map(t => [t, chordForTool(t)])
      .filter(([, c]) => c && /^Shift+/.test(c));
    expect(shifted).toEqual([]);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// ⛔⛔ THE TIMING CROSSOVER, REPORTED 2026-08-29: "sometimes the crossover
// between SHIFT+F and just F get mixed up and Fibonacci gets called instead of
// flagged."
//
// Not a mapping bug — the mapping was already fixed. A PHYSICAL one. You lift
// the modifier before the letter, so the tail of a Shift+F press arrives as
// `{ key: 'f', shiftKey: false, repeat: true }`, which is a picture-perfect bare
// F. Two independent vectors, both railed below:
//   1. auto-repeat — hold the chord past ~500ms and it fires ~30x/sec;
//   2. release order — Shift up while F is still down.
// ─────────────────────────────────────────────────────────────────────────────
describe('Shift+F cannot decay into bare F', () => {
  beforeEach(() => resetShiftLatch());

  it('auto-repeat never arms a tool', () => {
    expect(matchOverlayTool(evt('f', { code: 'KeyF', repeat: true }))).toBe(null);
    expect(matchShortcut(evt('f', { code: 'KeyF', repeat: true }))).toBe(null);
  });

  it('a first press still arms normally (the repeat guard is not a blanket off-switch)', () => {
    expect(matchOverlayTool(evt('f', { code: 'KeyF' }))).toBe('fib');
    expect(matchShortcut(evt('f', { code: 'KeyF' }))).toBe('tool:fib');
  });

  it('Shift released mid-press does NOT arm fib — the physical key stays latched', () => {
    // Shift+F goes down: the flag chord.
    expect(matchOverlayTool(evt('F', { shift: true, code: 'KeyF' }))).toBe(null);
    // Shift comes off first; F is still physically held and keeps repeating.
    expect(matchOverlayTool(evt('f', { code: 'KeyF' }))).toBe(null);
    expect(matchShortcut(evt('f', { code: 'KeyF' }))).toBe(null);
  });

  it('after F is actually released, bare F arms fib again', () => {
    matchOverlayTool(evt('F', { shift: true, code: 'KeyF' }));
    expect(matchOverlayTool(evt('f', { code: 'KeyF' }))).toBe(null);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF' }));
    expect(matchOverlayTool(evt('f', { code: 'KeyF' }))).toBe('fib');
  });

  it('the latch is per physical key — Shift+F does not disarm bare T', () => {
    matchOverlayTool(evt('F', { shift: true, code: 'KeyF' }));
    expect(matchOverlayTool(evt('t', { code: 'KeyT' }))).toBe('trendline');
  });

  it('Alt+Shift power chords still resolve (the latch must not eat them)', () => {
    expect(matchOverlayTool(evt('E', { alt: true, shift: true, code: 'KeyE' }))).toBe('eraser');
    expect(matchOverlayTool(evt('P', { alt: true, shift: true, code: 'KeyP' }))).toBe('priceRange');
  });
});
