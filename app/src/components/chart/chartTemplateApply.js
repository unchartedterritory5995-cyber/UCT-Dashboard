// app/src/components/chart/chartTemplateApply.js
//
// ─── ⭐ THE ONE WAY A SAVED CHART TEMPLATE IS APPLIED ──────────────────────────
//
// A member's saved chart templates (pref `chart_templates`, written by Chart
// Settings → Templates → Save as Template) can be applied from three places:
//
//   1. Chart Settings → Templates ▾ → a template's name   (ChartSettingsModal)
//   2. right-click → Chart template → a template's name    (ChartWidget)
//   3. UCT Agent's `chart.applyTemplate`                   (agent/capabilities/chart.js)
//
// All three call THIS function and write what it returns. The template is the
// whole saved look INCLUDING its indicators — that is what clicking has always
// done, and members already know it.
//
// ⚰️ WHY THIS FILE EXISTS (integrator ruling, owner delegated, 2026-10-11). Until
// today the two click paths copied the template's indicators and the Agent path
// kept the member's current ones (`keepOwned`), so "apply my Swing template" gave a
// different chart depending on whether you clicked or asked. The ruling: one
// behaviour, the one members already use — and one function, so the two cannot
// drift apart again. `agentChartTemplateParity.test.jsx` drives the click and the
// Agent over the same template and asserts the resulting settings are identical.
//
// ⛔ PURE. No React, no preferences, no write. The caller persists the result
// through its own surface's settings path (the modal's onChange, the pane's
// applySettings, the Agent's commit).

/**
 * The chart settings a saved template applies: a deep copy of the template's
 * settings with `preset: 'custom'` (a template is never one of the built-in
 * presets, even when it was saved from one).
 *
 * @param {{settings?: object}|null|undefined} template a `chart_templates` entry
 * @returns {object|null} the settings to write, or null when the template has none
 */
export function chartTemplateSettings(template) {
  const settings = template && typeof template === 'object' ? template.settings : null
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  return JSON.parse(JSON.stringify({ ...settings, preset: 'custom' }))
}
