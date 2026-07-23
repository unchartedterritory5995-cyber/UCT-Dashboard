import { describe, it, expect } from 'vitest';
import { matchShortcut, SHORTCUTS, TF_ORDER, resolveTfCycle } from './keyboardShortcuts';


function evt(key, opts = {}) {
  return {
    key,
    code: opts.code,
    ctrlKey: opts.ctrl,
    shiftKey: opts.shift,
    altKey: opts.alt,
    metaKey: opts.meta,
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
