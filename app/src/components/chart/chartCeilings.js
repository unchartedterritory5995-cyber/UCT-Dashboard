// TERM-052 (FB-S6-01) — chart ceilings a member can run into, as named constants in one light
// module.
//
// ⛔ These are the ENFORCING values, not copies of them: `ComparisonPicker.jsx` and
// `ChartSettingsModal.jsx` import them from here and apply them, and the Settings card
// "What Syncs Across Your Devices" publishes them by importing the same names
// (`lib/persistence/personalization.js`). They live in their own module rather than in those
// components so the Settings page can read them without pulling a chart component into its
// bundle. Change a number here and both the behaviour and the published ceiling move together.

/** Symbols that can be overlaid on one chart for comparison (`ComparisonPicker` refuses more). */
export const MAX_COMPARISONS = 5

/** Saved chart-settings templates kept per member. New and re-saved templates go to the front,
 *  and `ChartSettingsModal`'s `persistTemplates` keeps only the first this-many. */
export const MAX_CHART_TEMPLATES = 40
