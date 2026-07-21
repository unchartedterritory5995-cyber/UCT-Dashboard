// app/src/components/chart/keyboardShortcuts.js

/**
 * The timeframe ladder, in time order. Single source of truth — the ChartWidget
 * timeframe bar and the repeat-press cycle both read it.
 */
export const TF_ORDER = ['1', '5', '15', '30', '60', 'D', 'W', 'M'];


/**
 * Resolve where a timeframe keypress lands.
 *
 * Rules, evaluated in order:
 *  1. Same key pressed again with the chain intact -> advance one rung.
 *  2. Chart already sits on this key's home -> advance one rung (so no press
 *     is ever a silent no-op).
 *  3. Otherwise -> jump to this key's home.
 * The walk wraps at the end of TF_ORDER. The chain is considered broken when
 * the chart's current timeframe is not the rung the last keypress landed on
 * (i.e. the TF bar, a saved layout or a grid restore moved it).
 *
 * Pure: callers own the {command, index} they pass back in next time.
 */
export function resolveTfCycle({ command, currentTf, lastCommand, lastIndex }) {
  const home = String(command || '').slice(3);
  const homeIndex = TF_ORDER.indexOf(home);
  if (homeIndex === -1) return null;

  const chainIntact = command === lastCommand
    && Number.isInteger(lastIndex)
    && TF_ORDER[lastIndex] === currentTf;

  let index;
  if (chainIntact) index = (lastIndex + 1) % TF_ORDER.length;
  else if (currentTf === home) index = (homeIndex + 1) % TF_ORDER.length;
  else index = homeIndex;

  return { tf: TF_ORDER[index], index };
}

export const SHORTCUTS = [
  // Timeframes
  { keys: '1', command: 'tf:1', description: 'Switch to 1-minute' },
  { keys: '5', command: 'tf:5', description: 'Switch to 5-minute' },
  { keys: '2', command: 'tf:15', description: 'Switch to 15-minute' },
  { keys: '3', command: 'tf:30', description: 'Switch to 30-minute' },
  { keys: '4', command: 'tf:60', description: 'Switch to 1-hour' },
  { keys: 'D', command: 'tf:D', description: 'Daily' },
  { keys: 'W', command: 'tf:W', description: 'Weekly' },
  { keys: 'M', command: 'tf:M', description: 'Monthly' },

  // Drawing tools
  { keys: 'Esc', command: 'tool:cursor', description: 'Cursor / cancel' },
  { keys: 'T', command: 'tool:trendline', description: 'Trendline' },
  { keys: 'H', command: 'tool:horizontal', description: 'Horizontal line' },
  { keys: 'V', command: 'tool:vertical', description: 'Vertical line' },
  { keys: 'R', command: 'tool:rect', description: 'Rectangle' },
  { keys: 'C', command: 'tool:circle', description: 'Circle' },
  { keys: 'A', command: 'tool:arrow', description: 'Arrow' },
  { keys: 'F', command: 'tool:fib', description: 'Fibonacci retracement' },
  { keys: 'X', command: 'tool:text', description: 'Text annotation' },

  // Display toggles
  { keys: 'Shift+H', command: 'toggle:ha', description: 'Toggle Heikin Ashi' },
  { keys: 'Shift+L', command: 'toggle:log', description: 'Toggle log scale' },
  { keys: 'Shift+T', command: 'toggle:theme', description: 'Toggle light/dark theme' },
  { keys: 'Shift+C', command: 'toggle:countdown', description: 'Toggle bar-close countdown' },

  // Indicator toggles (Ctrl/Cmd held)
  { keys: 'Ctrl+I', command: 'toggle:rsi', description: 'Toggle RSI' },
  { keys: 'Ctrl+O', command: 'toggle:macd', description: 'Toggle MACD' },
  { keys: 'Ctrl+B', command: 'toggle:bb', description: 'Toggle Bollinger Bands' },
  { keys: 'Ctrl+M', command: 'toggle:ma', description: 'Toggle moving averages' },
  { keys: 'Ctrl+V', command: 'toggle:volume', description: 'Toggle volume' },

  // Replay
  { keys: 'Space', command: 'replay:playpause', description: 'Replay play/pause' },
  { keys: '←', command: 'replay:back', description: 'Replay step back' },
  { keys: '→', command: 'replay:forward', description: 'Replay step forward' },

  // Help
  { keys: '?', command: 'help', description: 'Show this help overlay' },
];


/**
 * Match a KeyboardEvent to a command id. Returns null on no match.
 * Ignores events with ctrl/meta held (so browser shortcuts like Ctrl+F work).
 */
export function matchShortcut(event) {
  if (!event || event.altKey) return null;
  const key = event.key;
  const shift = event.shiftKey;
  const ctrl = event.ctrlKey || event.metaKey;

  // Ctrl/Cmd held — indicator, moving-average, and volume toggles.
  // (Other Ctrl/Cmd combos fall through to null so browser shortcuts like
  //  Ctrl+F / Ctrl+R / Ctrl+T keep working.)
  if (ctrl) {
    if (shift) return null;
    const k = key.toLowerCase();
    if (k === 'i') return 'toggle:rsi';
    if (k === 'o') return 'toggle:macd';
    if (k === 'b') return 'toggle:bb';
    if (k === 'm') return 'toggle:ma';
    if (k === 'v') return 'toggle:volume';
    return null;
  }

  // Direct key match
  if (!shift) {
    if (/^[1-5]$/.test(key)) {
      const tfMap = { '1': 'tf:1', '2': 'tf:15', '3': 'tf:30', '4': 'tf:60', '5': 'tf:5' };
      return tfMap[key] || null;
    }
    if (key === 'd' || key === 'D') return 'tf:D';
    if (key === 'w' || key === 'W') return 'tf:W';
    if (key === 'm' || key === 'M') return 'tf:M';
    if (key === 't' || key === 'T') return 'tool:trendline';
    if (key === 'h' || key === 'H') return 'tool:horizontal';
    if (key === 'v' || key === 'V') return 'tool:vertical';
    if (key === 'r' || key === 'R') return 'tool:rect';
    if (key === 'c' || key === 'C') return 'tool:circle';
    if (key === 'a' || key === 'A') return 'tool:arrow';
    if (key === 'f' || key === 'F') return 'tool:fib';
    if (key === 'x' || key === 'X') return 'tool:text';
    if (key === 'Escape') return 'tool:cursor';
    if (key === ' ' || key === 'Spacebar') return 'replay:playpause';
    if (key === 'ArrowLeft') return 'replay:back';
    if (key === 'ArrowRight') return 'replay:forward';
    if (key === '?' || (key === '/' && shift)) return 'help';
  } else {
    // Shift held
    if (key === 'H') return 'toggle:ha';
    if (key === 'L') return 'toggle:log';
    if (key === 'T') return 'toggle:theme';
    if (key === 'C') return 'toggle:countdown';
    if (key === '?' || key === '/') return 'help';
  }
  return null;
}
