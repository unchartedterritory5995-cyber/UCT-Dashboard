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

  it('plain m stays Monthly, plain v stays vertical-line tool', () => {
    expect(matchShortcut(evt('m'))).toBe('tf:M');
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
});
