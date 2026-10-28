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

// ─── ⭐ THE ONE WAY A CHART TEMPLATE IS SAVED OR DELETED (Charts operator P1, 2026-10-27) ───────
// Chart Settings → Templates → Save as Template / ✕, and UCT Agent's template save / delete, all
// compute the member's new `chart_templates` list HERE, so the two doors cannot drift apart. Pure:
// the caller writes the returned list through its own preference writer.

/** The longest name Save as Template keeps (the dialog's input clips to it). */
export const CHART_TEMPLATE_NAME_MAX = 40

/**
 * The template list after saving `settings` as `name`: the new template goes FIRST, and a template
 * with the same name (case-insensitive) is REPLACED — re-saving updates in place, never piles up.
 * The list is capped at `max` (the oldest fall off, as the dialog's write always did).
 * @returns {{ templates: object[], template: object, replaced: object|null } | null} null when the
 *          name is empty or the settings are not a settings object
 */
export function chartTemplatesAfterSave(templates, name, settings, { id = null, max = Infinity } = {}) {
  const nm = String(name || '').trim().slice(0, CHART_TEMPLATE_NAME_MAX)
  if (!nm || !settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const list = Array.isArray(templates) ? templates : []
  const template = { id: id || `tpl${Math.random().toString(36).slice(2, 9)}`, name: nm, settings: JSON.parse(JSON.stringify({ ...settings, preset: 'custom' })) }
  const same = (t) => String(t?.name || '').toLowerCase() === nm.toLowerCase()
  const replaced = list.find(same) || null
  return { templates: [template, ...list.filter(t => !same(t))].slice(0, max), template, replaced }
}

/** The template list without the template whose id is `id` (unchanged when there is none). */
export function chartTemplatesAfterDelete(templates, id) {
  const list = Array.isArray(templates) ? templates : []
  return list.filter(t => t?.id !== id)
}
