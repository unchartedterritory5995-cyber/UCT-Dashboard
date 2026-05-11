import { describe, it, expect } from 'vitest';
import { matchShortcut, SHORTCUTS } from './keyboardShortcuts';


function evt(key, opts = {}) {
  return { key, ctrlKey: opts.ctrl, shiftKey: opts.shift, altKey: opts.alt, metaKey: opts.meta };
}


describe('matchShortcut', () => {
  it('returns "tf:1" for "1" key', () => {
    expect(matchShortcut(evt('1'))).toBe('tf:1');
  });

  it('returns "tf:5" for "5"', () => {
    expect(matchShortcut(evt('5'))).toBe('tf:5');
  });

  it('returns "tf:D" for "d"', () => {
    expect(matchShortcut(evt('d'))).toBe('tf:D');
  });

  it('returns "tf:W" for "w"', () => {
    expect(matchShortcut(evt('w'))).toBe('tf:W');
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

  it('returns "toggle:ha" for shift+H', () => {
    expect(matchShortcut(evt('H', { shift: true }))).toBe('toggle:ha');
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

  it('ignores when ctrl is held (preserve browser shortcuts)', () => {
    expect(matchShortcut(evt('t', { ctrl: true }))).toBe(null);
  });

  it('ignores when meta is held', () => {
    expect(matchShortcut(evt('t', { meta: true }))).toBe(null);
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
});
