// VIS-6 (audit 2026-11-05, issue 24): the Notebook's two icon sizes and its one stroke.
//
// The visual pass measured 8 icon sizes (10 to 18 px), 3 stroke widths (1.6, 1.7, 1.85) and gold-gradient
// icons mixed with flat ones in the same toolbars. The plan: 16 px in toolbars, 20 px in nav, one 1.75
// stroke, and `gold={false}` on every in-toolbar icon (gold stays for section titles).
//
// UIcon takes numbers, not CSS, so these are the values tokens.css states as --icon-size-toolbar,
// --icon-size-nav and --icon-stroke. notebookTokens.lint.test.js reads both files and holds them equal.
// Spread one onto a UIcon: <UIcon name="more" {...TOOLBAR_ICON} />.

export const ICON_STROKE = 1.75

/** A toolbar icon: 16 px, the one stroke, flat (currentColor). */
export const TOOLBAR_ICON = Object.freeze({ size: 16, strokeWidth: ICON_STROKE, gold: false })

// The nav size (20, --icon-size-nav) has no Notebook consumer yet, so it has no constant (fix round 1, review 8):
// the token lint's icon-size rule allows 16 and 20 and nothing else.
