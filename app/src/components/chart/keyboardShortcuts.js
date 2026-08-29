// app/src/components/chart/keyboardShortcuts.js

import { labelFor } from './indicatorCatalog';

/**
 * ⭐ THE FOUR INDICATOR CHORDS, DECLARED ONCE.
 *
 * B3's ledger called this "two shortcuts, one file", then three, then FOUR
 * across FOUR regions in TWO files — the `SHORTCUTS` row, the matcher below,
 * `StockChart`'s `toggle:` switch and its `e.altKey` block. Two of those regions
 * are where a command is DECLARED and two are where it is CONSUMED, and `Alt+U`
 * spent a whole phase declared-in-one-place-and-handled-in-another because
 * `matchShortcut` rejects Alt.
 *
 * ⛔ `modifier: 'alt'` IS NOT MATCHED HERE. Alt is rejected on the first line of
 * `matchShortcut` so browser Alt shortcuts keep working; `StockChart`'s own
 * `e.altKey` block is the live handler and reads THIS TABLE for its `code`. If
 * the matcher ever answered for an Alt chord, both handlers would fire.
 *
 * ⚠️ IT NAMES FOUR INDICATOR IDS, WHICH IS WHY IT IS ON THE ENUMERATION LEDGER
 * (`enumerationSites.test.js`, fate `keep`). A key binding is irreducibly a
 * (key, indicator) pair — there is nothing in a definition that says "Ctrl+I" —
 * so this list legitimately lists things, the way `RAW_DEFS` does. What it is
 * NOT is a region a new indicator has to be edited into: an indicator without a
 * chord simply has no chord, and adding one is a deliberate act in ONE place.
 *
 * `keys` is the help-sheet label, `code` the layout-independent physical key.
 */
export const INDICATOR_CHORDS = Object.freeze([
  Object.freeze({ defId: 'rsi', keys: 'Ctrl+I', code: 'KeyI', modifier: 'ctrl' }),
  Object.freeze({ defId: 'macd', keys: 'Ctrl+O', code: 'KeyO', modifier: 'ctrl' }),
  Object.freeze({ defId: 'bb', keys: 'Ctrl+B', code: 'KeyB', modifier: 'ctrl' }),
  Object.freeze({ defId: 'vwap', keys: 'Alt+U', code: 'KeyU', modifier: 'alt' }),
]);

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

/**
 * Should a chart shortcut claim this key, beating ticker search?
 *
 * A single letter with no Ctrl/Alt/Meta is ALWAYS a ticker character — INCLUDING
 * a shifted uppercase letter, because traders type tickers uppercase (HOOD, LLY,
 * TSLA, COIN). So a shortcut never claims a letter, even though some letters are
 * bound to drawing tools and Shift+L/T/C are display toggles; those toggles stay
 * reachable whenever a chart is NOT focused. Digits (timeframes) and Shift+digit
 * DO claim.
 *
 * ⚰️ THE SENTENCE THAT USED TO END THIS PARAGRAPH WAS FALSE FOR MONTHS: "Shift+F
 * (flag) is handled by each widget's own branch before this is consulted, so it is
 * unaffected." It is true of THIS matcher and of nothing else. `matchShortcut`
 * never answered for Shift+F — but `ChartDrawingOverlay` never asked it, carrying
 * its own switch that read Shift+F as the Fibonacci extension. The comment named a
 * mechanism that made the collision look already-handled, so nobody re-checked it.
 * The overlay now routes through `matchOverlayTool` below.
 */
export function shortcutClaimsKey(event) {
  if (!matchShortcut(event)) return false;
  const isTickerLetter = /^[a-zA-Z]$/.test(event.key)
    && !event.ctrlKey && !event.altKey && !event.metaKey;
  return !isTickerLetter;
}

export const SHORTCUTS = [
  // Timeframes — Shift+digit intraday, bare digit daily and up.
  // (Ctrl+digit is browser-reserved for tab switching, so Shift carries these.)
  { keys: 'Shift+1', command: 'tf:1', description: '1-minute' },
  { keys: 'Shift+3', command: 'tf:5', description: '5-minute' },
  { keys: 'Shift+4', command: 'tf:15', description: '15-minute' },
  { keys: 'Shift+5', command: 'tf:30', description: '30-minute' },
  { keys: 'Shift+6', command: 'tf:60', description: '1-hour' },
  { keys: '1', command: 'tf:D', description: 'Daily' },
  { keys: '5', command: 'tf:W', description: 'Weekly' },
  { keys: '9', command: 'tf:M', description: 'Monthly' },

  // Drawing tools (Alt+letter — bare letters go to ticker search)
  { keys: 'Esc', command: 'tool:cursor', description: 'Cursor / cancel' },
  { keys: 'Alt+T', command: 'tool:trendline', description: 'Trendline' },
  { keys: 'Alt+H', command: 'tool:horizontal', description: 'Horizontal line' },
  { keys: 'Alt+J', command: 'tool:hray', description: 'Horizontal ray' },
  { keys: 'Alt+V', command: 'tool:vertical', description: 'Vertical line' },
  { keys: 'Alt+R', command: 'tool:rect', description: 'Rectangle' },
  { keys: 'Alt+C', command: 'tool:circle', description: 'Ellipse / circle' },
  { keys: 'Alt+A', command: 'tool:arrow', description: 'Arrow' },
  { keys: 'Alt+F', command: 'tool:fib', description: 'Fibonacci retracement' },
  { keys: 'Alt+E', command: 'tool:fibext', description: 'Fibonacci extension' },
  { keys: 'Alt+W', command: 'tool:avwap', description: 'Anchored VWAP' },
  { keys: 'Alt+X', command: 'tool:text', description: 'Text annotation' },
  { keys: 'Alt+P', command: 'tool:position', description: 'Position tool (long / short R:R)' },
  { keys: 'Alt+Shift+P', command: 'tool:priceRange', description: 'Price range' },
  { keys: 'Alt+Shift+D', command: 'tool:dateRange', description: 'Date range' },
  { keys: 'Alt+Shift+E', command: 'tool:eraser', description: 'Eraser (click to delete)' },
  // ⛔ THESE TWO MOVED OFF `Shift+<letter>` ON 2026-08-28. `Shift+F` armed the
  // Fibonacci extension and `Shift+P` the pitchfork, straight into the
  // **flag-the-selected-ticker** chord every list surface binds. See
  // `matchOverlayTool` below for the full account.
  { keys: 'Alt+Y', command: 'tool:pitchfork', description: 'Pitchfork' },
  { keys: 'Alt+M', command: 'tool:measure', description: 'Measure' },

  // Display toggles
  { keys: 'Shift+L', command: 'toggle:log', description: 'Toggle log scale' },
  { keys: 'Shift+T', command: 'toggle:theme', description: 'Toggle light/dark theme' },
  { keys: 'Shift+C', command: 'toggle:countdown', description: 'Toggle bar-close countdown' },
  { keys: 'Alt+Shift+W', command: 'toggle:watermark', description: 'Toggle symbol watermark' },
  { keys: 'Alt+I', command: 'toggle:invert', description: 'Invert price scale' },
  { keys: 'Alt+Shift+I', command: 'toggle:hideindicators', description: 'Hide all indicators' },

  // Indicator toggles — GENERATED from INDICATOR_CHORDS, labelled by the catalog.
  //
  // ⚠️ `Alt+U` IS IN HERE, not up with the display toggles where it used to sit:
  // the help sheet is where a user looks for a chord, and grouping it by MODIFIER
  // rather than by what it does is what let it read as a display toggle for a
  // phase. It is still matched by StockChart, never by `matchShortcut`.
  //
  // ⚠️ TWO VISIBLE RELABELS, both argued for in `indicatorCatalog.test.js`'s
  // `BEYOND_A7` table: `Toggle Bollinger Bands` → `Toggle BB` and `Toggle session
  // VWAP` → `Toggle VWAP`. The `?` overlay shows these strings.
  ...INDICATOR_CHORDS.map(c => ({
    keys: c.keys, command: 'toggle:' + c.defId, description: 'Toggle ' + labelFor(c.defId),
  })),
  // ⛔ NOT CHORDS. `ma` toggles the four MA overlay slots and `volume` a pane;
  // neither is a definition, so neither has a catalog row to be labelled from and
  // neither routes at `setIndicatorEnabled`. They stay hand-written.
  { keys: 'Ctrl+M', command: 'toggle:ma', description: 'Toggle moving averages' },
  { keys: 'Ctrl+V', command: 'toggle:volume', description: 'Toggle volume' },

  // Replay
  { keys: 'Space', command: 'replay:playpause', description: 'Replay play/pause' },
  { keys: '←', command: 'replay:back', description: 'Replay step back' },
  { keys: '→', command: 'replay:forward', description: 'Replay step forward' },

  // Other
  { keys: '+ / -', command: 'zoom', description: 'Zoom in / out' },
  { keys: 'Alt+,', command: 'settings', description: 'Open chart settings' },
  { keys: 'Alt+Shift+A', command: 'addindicator', description: 'Add indicator (settings)' },
  { keys: 'Alt+S', command: 'screenshot', description: 'Screenshot chart (PNG)' },
  { keys: 'Alt+G', command: 'gotodate', description: 'Go to date' },
  { keys: 'Alt+Q', command: 'addwatchlist', description: 'Add ticker to watchlist' },
  { keys: 'Alt+N', command: 'pricealert', description: 'Price alert at cursor' },
  { keys: 'Alt+\\', command: 'gridcycle', description: 'Cycle grid layout (multi-chart)' },
  { keys: '?', command: 'help', description: 'Show this help overlay' },
];


// Physical-key lookup for the Shift+digit intraday set. Keyed on event.code
// because Shift+1 yields "!" on a US layout and other symbols elsewhere;
// the code is layout-independent and picks up the numpad for free.
const SHIFT_CODE_TF = {
  Digit1: 'tf:1', Numpad1: 'tf:1',
  Digit3: 'tf:5', Numpad3: 'tf:5',
  Digit4: 'tf:15', Numpad4: 'tf:15',
  Digit5: 'tf:30', Numpad5: 'tf:30',
  Digit6: 'tf:60', Numpad6: 'tf:60',
};

// Bare digits — the higher timeframes. Letters are deliberately NOT bound to
// timeframes so DELL / WMT / MU can be typed straight into ticker search.
const BARE_DIGIT_TF = { '1': 'tf:D', '5': 'tf:W', '9': 'tf:M' };

/**
 * The Ctrl/Cmd letter map — DERIVED from `INDICATOR_CHORDS` for the indicators,
 * hand-written for the two commands that are not indicators.
 *
 * ⛔ THE `modifier === 'ctrl'` FILTER IS LOAD-BEARING. `Alt+U`'s code is `KeyU`,
 * so without it this map would bind **Ctrl+U** to VWAP — a chord nobody declared,
 * taking a browser combo, and INVISIBLE to any test that only checks Alt is
 * rejected (Alt is rejected on the first line of `matchShortcut`, before this map
 * is consulted). `keyboardShortcuts.test.js` asserts `Ctrl+U` is null for exactly
 * that reason.
 *
 * Null-prototype so a `key` that happens to spell an `Object.prototype` member
 * ('constructor', 'toString') cannot resolve to a function instead of a command.
 */
const CTRL_KEY_TO_COMMAND = Object.freeze(Object.assign(Object.create(null), {
  ...Object.fromEntries(INDICATOR_CHORDS
    .filter(c => c.modifier === 'ctrl')
    .map(c => [c.code.slice(3).toLowerCase(), 'toggle:' + c.defId])),
  m: 'toggle:ma',
  v: 'toggle:volume',
}));

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
    return CTRL_KEY_TO_COMMAND[String(key || '').toLowerCase()] || null;
  }

  // Direct key match
  if (!shift) {
    if (/^[0-9]$/.test(key)) return BARE_DIGIT_TF[key] || null;
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
    if (key === '?') return 'help';
  } else {
    // Shift held
    if (event.code && SHIFT_CODE_TF[event.code]) return SHIFT_CODE_TF[event.code];
    if (key === 'L') return 'toggle:log';
    if (key === 'T') return 'toggle:theme';
    if (key === 'C') return 'toggle:countdown';
    if (key === '?' || key === '/') return 'help';
  }
  return null;
}


/**
 * ⭐ THE DRAWING OVERLAY'S KEY→TOOL DOOR, DECLARED ONCE.
 *
 * ⚰️ MEASURED BY THE OWNER 2026-08-28, scanning lists: pressing **Shift+F to flag
 * a ticker kept arming the Fibonacci extension instead.** `ChartDrawingOverlay`
 * carried its OWN key→tool switch — a leftover from before tools moved to
 * Alt+<letter> — and that switch read `Shift+F` as `fibext` and `Shift+P` as
 * `pitchfork`. Every list surface (Watchlists, Breadth, Theme Tracker, ChartPane,
 * GridChartCell) binds Shift+F to FLAG the selected ticker.
 *
 * ⛔⛔ THE TWO HANDLERS BOTH SAT ON `window`, WHICH IS WHY THE EXISTING GUARD
 * COULD NOT SAVE IT. `ChartPane`/`GridChartCell` call `stopPropagation()` on their
 * flag branch, but two listeners on the SAME node need `stopImmediatePropagation`,
 * and an event raised on a LIST ROW never travels through the pane element at all.
 * So one Shift+F flagged the ticker AND armed a drawing tool, every time.
 *
 * ⛔ A SHIFTED LETTER IS NEVER A TOOL HERE. Traders type tickers uppercase and
 * Shift+F is the flag chord, so the bare-letter branch below is gated on
 * `!shiftKey` — that gate is the fix, and `keyboardShortcuts.test.js` sweeps all
 * 26 letters to keep it that way rather than pinning only the letter that was
 * reported. The two tools that lived on Shift chords moved to `Alt+Y` (pitchfork)
 * and `Alt+M` (measure), both now declared in `SHORTCUTS` so the `?` overlay and
 * the toolbar tooltips can read them instead of restating them.
 *
 * Returns a tool id, or null when the event arms nothing.
 */
const ALT_TOOL = Object.freeze(Object.assign(Object.create(null), {
  KeyT: 'trendline', KeyH: 'horizontal', KeyJ: 'hray', KeyV: 'vertical',
  KeyR: 'rect', KeyC: 'circle', KeyA: 'arrow', KeyF: 'fib', KeyE: 'fibext',
  KeyW: 'avwap', KeyX: 'text', KeyP: 'position',
  KeyY: 'pitchfork', KeyM: 'measure',
}));

// Alt+Shift+<letter> → the power-user tools.
const ALT_SHIFT_TOOL = Object.freeze(Object.assign(Object.create(null), {
  KeyP: 'priceRange', KeyD: 'dateRange', KeyE: 'eraser',
}));

// Bare letters. Kept because they are the railed design (see `matchShortcut`) —
// a focused pane swallows ticker characters before they reach here.
// Null-prototype so 'constructor'/'toString' cannot resolve to a function.
const BARE_TOOL = Object.freeze(Object.assign(Object.create(null), {
  v: 'cursor', t: 'trendline', h: 'horizontal', r: 'rect',
  f: 'fib', x: 'text', m: 'measure',
}));

export function matchOverlayTool(event) {
  if (!event) return null;
  if (event.ctrlKey || event.metaKey) return null;

  if (event.altKey) {
    const map = event.shiftKey ? ALT_SHIFT_TOOL : ALT_TOOL;
    return map[event.code] || null;
  }

  // ⛔ LOAD-BEARING: a shifted letter belongs to the flag chord and to ticker
  // entry, never to a drawing tool. Removing this gate is what caused the
  // Shift+F collision described above.
  if (event.shiftKey) return null;

  return BARE_TOOL[String(event.key || '').toLowerCase()] || null;
}

/**
 * The chord to ADVERTISE for a drawing tool, derived from the very maps
 * `matchOverlayTool` dispatches on — so a tooltip cannot promise a keypress the
 * matcher does not honour. Bare letter wins when one exists (it is the shortest
 * thing that actually works), else the Alt chord, else null for a click-only tool.
 *
 * ⚰️ Before this existed the toolbar TYPED its chords and they rotted: it
 * advertised `Shift+F` for the Fibonacci extension (that chord flags a ticker),
 * `Shift+P` for the pitchfork, and `(P)` for the position tool — a bare letter
 * that has never armed anything.
 */
export function chordForTool(toolId) {
  for (const [letter, id] of Object.entries(BARE_TOOL)) {
    if (id === toolId) return letter.toUpperCase();
  }
  for (const [code, id] of Object.entries(ALT_TOOL)) {
    if (id === toolId) return 'Alt+' + code.slice(3);
  }
  for (const [code, id] of Object.entries(ALT_SHIFT_TOOL)) {
    if (id === toolId) return 'Alt+Shift+' + code.slice(3);
  }
  return null;
}
