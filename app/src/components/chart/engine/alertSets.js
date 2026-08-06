// app/src/components/chart/engine/alertSets.js
//
// ─── PER-CHART ALERT SETS AND TEMPLATES ─────────────────────────────────────
//
// Spec §5: *"`scope` (chartId) present from day one as data; global default at
// cutover, per-chart + templates flips on in Phase C."* This is the Phase C
// half. `instances.js` owns the SHAPE (what a `scope` is, and that an absent one
// is global); this module owns the three questions that shape exists to answer:
//
//   · `instancesForChart(cs, chartId)` — which indicators does THIS chart draw
//   · `alertSetFor(chartId, alerts)`   — which alerts belong to THIS chart
//   · `applyAlertTemplate(tpl, chartId)` — a named set, applied to ONE chart
//
// ⛔ PURE, AND IT WRITES NOTHING. No React, no preferences hook, no fetch. Every
// caller already has a settings object and a way to hand one back, and the one
// thing this returns that is meant to be persisted is a PATCH — see
// `applyAlertTemplate`.
//
// ⛔ IT NAMES NO INDICATOR. Not one id appears in this file: a template's
// contents are data the caller supplies, and a list of ids here would be a new
// enumeration site in the phase that exists to end them.
//
// ─── WHY "ABSENT MEANS GLOBAL" IS THE WHOLE DESIGN ──────────────────────────
//
// Every `chart_settings` blob and every `indicator_alerts` row in production
// predates this feature, so all of them are unscoped. If unscoped meant "belongs
// to no chart", every indicator and every alert anybody has would disappear from
// every chart the day this ships. So unscoped means "belongs to ALL charts", the
// filters below are ADDITIVE, and the migration is that there is no migration.
//
// The mirror-image rule holds on the read side and is easy to get wrong: the
// Python column is nullable and the API serves `null`, so `alertSetFor` has to
// treat a `null` scope on an ALERT ROW as global. (An INSTANCE's `null` scope is
// a different story — see `instances.js`: an instance is written by this client,
// so a `null` there is a client that wrote something meaningless and is told so,
// while an alert row's `null` is what SQLite stores for "no value".)

import {
  INSTANCE_SCOPE_FIELD,
  instanceScope,
  scopeInstance,
} from './instances'

// Re-exported so a consumer of per-chart sets has ONE import. The definitions
// live beside the rest of the instance shape, because that is what they are.
export { INSTANCE_SCOPE_FIELD, instanceScope, scopeInstance }

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== ''
}

/** A chart id, or `null` when the caller named none. Empty strings, `undefined`
 *  and non-strings all collapse to "no chart" — a surface with no identity must
 *  not accidentally match a scope. */
function chartKey(chartId) {
  return isNonEmptyString(chartId) ? chartId : null
}

/** `cs.indicatorInstances`, `cs` itself when it is already an array, or `[]`. */
function instanceList(csOrList) {
  if (Array.isArray(csOrList)) return csOrList
  if (isPlainObject(csOrList) && Array.isArray(csOrList.indicatorInstances)) {
    return csOrList.indicatorInstances
  }
  return []
}

// ─── which indicators does THIS chart draw ──────────────────────────────────

/**
 * The instances visible on `chartId`: every GLOBAL one, plus the ones scoped to
 * this chart, IN THE STORED ORDER.
 *
 * ⛔ IT IS A FILTER, NOT A SORT AND NOT A VALIDATOR. The stored order is the
 * shipped pane order (`instances.SHIPPED_STACK_ORDER`, seeded once and then
 * maintained by `instanceControls.withInstances`), so what a chart shows is a
 * SUBSEQUENCE of it — a chart with a scoped indicator has the same panes in the
 * same order as one without, plus one. Re-sorting here would move an existing
 * user's panes the first time anybody scoped anything.
 *
 * Tombstones and unknown definitions are passed through untouched: this answers
 * "whose chart is this", and `normalizeInstances` answers "is it drawable". Two
 * filters, composable in either order, neither pretending to be the other.
 *
 * @param {object|unknown[]} csOrList a settings blob or a bare instance list
 * @param {string|null} chartId
 * @returns {object[]}
 */
export function instancesForChart(csOrList, chartId) {
  const want = chartKey(chartId)
  const out = []
  for (const inst of instanceList(csOrList)) {
    if (!isPlainObject(inst)) continue
    const scope = instanceScope(inst)
    if (scope === undefined || scope === want) out.push(inst)
  }
  return out
}

// ─── which alerts belong to THIS chart ──────────────────────────────────────

/**
 * The alert SET for a chart: the user's global alerts plus this chart's own, in
 * the order the server sent them.
 *
 * ⚠️ A `null` / absent / empty `scope` IS GLOBAL. That is not leniency, it is
 * the column's own default: `indicator_alerts.scope` is nullable and every row
 * that exists today is NULL, so anything stricter empties every user's alert
 * list on the day the column lands.
 *
 * ⛔ AND THIS IS A DISPLAY FILTER, NOWHERE NEAR THE EVALUATOR. The lane that
 * decides what FIRES reads `indicator_alert_service.list_active()`, which is
 * scope-blind by design and has a test that says so — the Task 6 shadow lane and
 * the Task 11 soak matrix both read it, and a scope filter there would silently
 * shrink what Task 8's gate observes.
 *
 * @param {string|null} chartId
 * @param {unknown[]} alerts rows as served by `GET /api/indicator-alerts`
 * @returns {object[]}
 */
export function alertSetFor(chartId, alerts) {
  const want = chartKey(chartId)
  const out = []
  for (const a of (Array.isArray(alerts) ? alerts : [])) {
    if (!isPlainObject(a)) continue
    const scope = isNonEmptyString(a.scope) ? a.scope : null
    if (scope === null || scope === want) out.push(a)
  }
  return out
}

// ─── templates ──────────────────────────────────────────────────────────────

/** Every instance a template creates carries this prefix. A namespace, not
 *  decoration: it is how a template-owned instance is told from `legacy:` and
 *  from one a user added by hand, which is what makes re-applying a template
 *  safe. */
export const TEMPLATE_ID_PREFIX = 'tpl:'

/**
 * The id a template entry gets on a given chart. DETERMINISTIC — a pure function
 * of (templateId, chartId, key) and nothing else: no counter, no clock, no
 * `Math.random`.
 *
 * ⛔ THAT IS WHAT MAKES APPLYING A TEMPLATE IDEMPOTENT. `mergeSettingsOverride`
 * merges instances BY ID, so a derived id means the second application updates
 * the same rows the first created; a generated id would add a second copy of
 * every indicator every time the button was pressed.
 */
export function templateInstanceId(templateId, chartId, key) {
  return `${TEMPLATE_ID_PREFIX}${templateId}:${chartId}:${key}`
}

/**
 * Apply a named alert set to ONE chart.
 *
 * A template is authored data:
 *
 *   {
 *     id: 'momentum',                       // stable — it is part of every id
 *     name: 'Momentum',
 *     instances: [{ key?, defId, inputs?, placement?, hidden? }, …],
 *     alerts:    [{ instanceKey?, indicator, condition, threshold?, tf }, …],
 *   }
 *
 * and what comes back is:
 *
 *   {
 *     templateId, scope,
 *     settings: { indicatorInstances: [...] },   // ⭐ A PATCH. See below.
 *     alerts:   [ …POST bodies for /api/indicator-alerts… ],
 *   }
 *
 * ─── ⭐ THE RETURN IS A PATCH, AND REPLACING THE ARRAY WOULD BE THE BUG ─────
 *
 * Spec §5 safeguard 3 (architect R4): *"multiple chart widgets are concurrent
 * writers; last-writer-wins loses instance adds."* A grid holds up to sixteen
 * cells over one `chart_settings` blob. If applying a template handed back a
 * whole `indicatorInstances` array, it would be authored from a snapshot taken
 * before whatever the neighbouring cell wrote two seconds ago, and saving it
 * would delete that. So `settings` carries ONLY the instances the template
 * creates and is meant to be fed to `mergeSettingsOverride`, whose union-by-id
 * is the concurrency guarantee. Nothing here ever removes an instance.
 *
 * ─── AND WHY THE ALERTS CAN NAME AN INSTANCE HONESTLY ───────────────────────
 *
 * Phase C Task 10 shipped `indicator_alerts.instance_id` and left it with no
 * producer, because the surface that could supply one (the alert popover) knows
 * an alert ADDRESS (`rsi`, `williams_r`, `ichimoku.tenkan`) and the chart knows
 * a DEFINITION id (`rsi`, `williamsR`, …), and the map between them lies for two
 * of fourteen — `price_vs_ma` has no definition at all. A template does not need
 * that map: its author states the `defId` and the address side by side, so the
 * alert's `params` are read off the very instance the template created and the
 * two cannot disagree about which RSI this is.
 *
 * REFUSES, loudly, rather than guessing:
 *   · no chart id — a template applied to "no chart" is a GLOBAL write, which is
 *     the thing per-chart sets exist to avoid;
 *   · no template id — every derived id would collide with every other
 *     template's, so re-applying either would silently overwrite the other;
 *   · an alert naming an `instanceKey` the template does not declare — it would
 *     otherwise store an `instance_id` pointing at nothing, i.e. an alert that
 *     the deletion sweep reports as orphaned the moment it is created.
 *
 * @param {object} template
 * @param {string} chartId
 * @returns {{templateId: string, scope: string, settings: {indicatorInstances: object[]}, alerts: object[]}}
 */
export function applyAlertTemplate(template, chartId) {
  const scope = chartKey(chartId)
  if (!scope) {
    throw new TypeError(
      'applyAlertTemplate: a chart id is required — a template applied to no chart ' +
      'is a GLOBAL write, and per-chart sets exist so that is never the accident',
    )
  }
  if (!isPlainObject(template) || !isNonEmptyString(template.id)) {
    throw new TypeError(
      'applyAlertTemplate: the template needs a stable `id` — it is part of every ' +
      'instance id this derives, so without one two templates collide on one chart',
    )
  }
  const templateId = template.id

  const idByKey = new Map()
  const instances = []
  const declared = Array.isArray(template.instances) ? template.instances : []
  declared.forEach((entry, i) => {
    if (!isPlainObject(entry) || !isNonEmptyString(entry.defId)) return
    // The key defaults to the definition id, then to the index — so a template
    // with one instance per indicator needs no keys at all, and one with two
    // RSIs must name them (or they would collide and the second would win).
    const key = isNonEmptyString(entry.key) ? entry.key : `${entry.defId}${i ? `-${i}` : ''}`
    const instanceId = templateInstanceId(templateId, scope, key)
    idByKey.set(key, { instanceId, inputs: entry.inputs })
    instances.push(scopeInstance({
      instanceId,
      defId: entry.defId,
      ...(Number.isInteger(entry.defVersion) ? { defVersion: entry.defVersion } : {}),
      inputs: isPlainObject(entry.inputs) ? { ...entry.inputs } : {},
      ...(isPlainObject(entry.placement) ? { placement: { ...entry.placement } } : {}),
      hidden: entry.hidden === true,
    }, scope))
  })

  const alerts = []
  for (const spec of (Array.isArray(template.alerts) ? template.alerts : [])) {
    if (!isPlainObject(spec) || !isNonEmptyString(spec.indicator)) continue
    let bound = null
    if (isNonEmptyString(spec.instanceKey)) {
      bound = idByKey.get(spec.instanceKey)
      if (!bound) {
        throw new TypeError(
          `applyAlertTemplate: alert names instance ${JSON.stringify(spec.instanceKey)}, ` +
          `which this template does not declare — the alert would store an instance id ` +
          `pointing at nothing and be reported orphaned the moment it was created`,
        )
      }
    }
    alerts.push({
      indicator: spec.indicator,
      condition: spec.condition,
      ...(spec.threshold === undefined || spec.threshold === null
        ? {} : { threshold: spec.threshold }),
      tf: spec.tf,
      // ⚠️ From the INSTANCE, never from a second copy of the knobs on the alert
      // spec. One source, so "RSI(7) crossed 70" names the RSI the chart draws.
      ...(bound && isPlainObject(bound.inputs) ? { params: { ...bound.inputs } } : {}),
      ...(bound ? { instance_id: bound.instanceId } : {}),
      scope,
    })
  }

  return { templateId, scope, settings: { indicatorInstances: instances }, alerts }
}
