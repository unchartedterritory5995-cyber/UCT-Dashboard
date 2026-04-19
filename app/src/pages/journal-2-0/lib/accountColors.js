/**
 * Curated 12-color palette for accounts. Tuned for contrast against
 * var(--bg-surface) and distinct from the gold accent.
 */

export const ACCOUNT_COLORS = {
  blue:    { hex: '#5b9bd5', label: 'Blue'    },
  purple:  { hex: '#9d6bd9', label: 'Purple'  },
  teal:    { hex: '#3aa99e', label: 'Teal'    },
  magenta: { hex: '#cc66bb', label: 'Magenta' },
  orange:  { hex: '#e08956', label: 'Orange'  },
  lime:    { hex: '#a3c853', label: 'Lime'    },
  cyan:    { hex: '#5cb8d3', label: 'Cyan'    },
  pink:    { hex: '#e597b3', label: 'Pink'    },
  slate:   { hex: '#7a8499', label: 'Slate'   },
  sky:     { hex: '#82b6d9', label: 'Sky'     },
  emerald: { hex: '#5fbb8e', label: 'Emerald' },
  amber:   { hex: '#d4b35c', label: 'Amber'   },
}

export const COLOR_KEYS = Object.keys(ACCOUNT_COLORS)

/** Get hex for a color key, falling back to slate. */
export function colorHex(key) {
  return ACCOUNT_COLORS[key]?.hex || ACCOUNT_COLORS.slate.hex
}

/** Pick the next color in rotation that isn't already in use. */
export function nextAvailableColor(usedColors = []) {
  const used = new Set(usedColors)
  for (const k of COLOR_KEYS) {
    if (!used.has(k)) return k
  }
  return 'slate'
}
