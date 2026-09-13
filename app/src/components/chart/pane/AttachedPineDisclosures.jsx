// app/src/components/chart/pane/AttachedPineDisclosures.jsx
//
// ─── ⭐⭐ T5b — THE DISCLOSURES, ON THE CHART A MEMBER ACTUALLY OPENS ────────
//
// T5 put a member's Pine on a pane inside the BUILDER, with the three
// disclosures beside it. That surface is a harness: it holds the script text in
// React state, translates it on every keystroke, and installs under a throwaway
// id that is uninstalled on unmount. A member closes the sheet and none of it
// survives.
//
// The route a member actually walks is the other one, and it is entirely shipped
// already: `BuilderSheet` saves a document to `/api/user-definitions` →
// `useInstalledUserDefinitions` reads it back on every page load and installs it
// → `IndicatorLibraryDialog` lists it as *Your formula* → `addInstance` writes an
// entry into `chart_settings.indicatorInstances` → the binder draws it. **This
// component is the one thing that route was missing**: on the way through, the
// three sentences the rulings owe a member were dropped on the floor.
//
// ⛔⛔ AND THEY CANNOT BE RE-DERIVED HERE, WHICH IS WHY THEY RIDE ON THE
// DOCUMENT. Measured 2026-09-13: a saved pane document's `compute.source` is
// **126 characters** — the first plot's expression — for a script of 34,378. The
// Pine is not in the artifact and never was; nothing downstream can re-translate
// it, re-read its `alertcondition`, or notice that a `request.security` was
// folded. `memberPaneDefinition` writes `meta.disclosures` at build time and this
// reads them back. The producer owns the wording; this owns nothing but the list.
//
// ⭐ EXCEPT THE ONE SENTENCE THAT NEEDS A NUMBER. `_requirement_tags
// .window_dependent` is the CONDITION on a pane being allowed to serve `ta.cum`
// at all — "the pane additionally shows a disclosure badge naming the bar count
// when the value is DISPLAYED" — and the bar count is knowable only by the chart
// that just drew. So the document carries the TAG and `parse.js::requirementNote`
// still owns the words; the caller supplies the count. Same split `MemberPane`
// makes, and deliberately the same two functions, so the builder and the chart
// cannot disagree about a sentence.
//
// ⛔⛔ THERE IS NO FLAG READ IN THIS FILE, AND THAT IS DELIBERATE — IT IS THE ONE
// PLACE `VITE_PINE_MEMBER_PANE_ENABLED` MUST NOT REACH.
//
// The flag gates the FEATURE: with it off, `MemberPane` returns `null`, the
// attach control does not exist, and no member can put a Pine document on a
// chart. That is what "flag-off is non-vacuous on this route" measures — no pane,
// no instance, nothing in the DOM — and `attachedPineDisclosures.test.jsx` drives
// the real doors to show it.
//
// ⛔ But a DISCLOSURE is an obligation, not a feature, and a flag that can switch
// one off is a flag that can leave a member reading a `ta.cum` series with the
// badge its permission depends on missing. The flag is a BUILD constant: turning
// it off is a deploy, and every definition a member attached while it was on is
// still in their `chart_settings` and still draws. Gating this component would
// mean that deploy silently strips the sentences off drawings that keep drawing.
// So the rule is: the flag decides whether a member can ATTACH one; nothing
// decides whether an attached one discloses.
import { useMemo } from 'react'
import * as defaultRegistry from '../engine/nativeRegistry'
import { requirementNote } from '../engine/ast/parse'
import styles from './AttachedPineDisclosures.module.css'

/** The definitions this chart is actually DRAWING, resolved through the registry.
 *
 *  ⛔ IT READS THE INSTANCES, NOT THE REGISTRY'S LIST. A definition a member
 *  SAVED but has not added to this chart discloses nothing here, because it draws
 *  nothing here — a note about a series that is not on screen is noise, and the
 *  badge's own justification ("when the value is DISPLAYED") says so in as many
 *  words.
 *
 *  ⛔ AND A HIDDEN INSTANCE IS STILL NOT DRAWN. `hidden: true` is the eye toggle;
 *  the series is off. Disclosing it would put a sentence about a fold beside a
 *  chart that shows no folded series. */
function drawnMeta(settings, registry) {
  const instances = (settings && Array.isArray(settings.indicatorInstances))
    ? settings.indicatorInstances : []
  const out = []
  for (const inst of instances) {
    if (!inst || typeof inst !== 'object' || inst.hidden) continue
    const def = typeof registry.getDefinition === 'function'
      ? registry.getDefinition(inst.defId) : null
    if (def && def.meta) out.push(def.meta)
  }
  return out
}

/**
 * Does anything drawn on this chart raise a tag whose sentence needs a bar count?
 *
 * ⚠️ NOT A GATE ON COUNTING, AND `ChartPane`'s `noteDrawnBars` header records why:
 * `StockChart` reports the count ONCE, when the bars land, which is before the
 * member adds the indicator — so a host that waited for this to be true would
 * never hear the number at all. Exported for the rails, which use it to say which
 * documents are window-dependent without re-typing `requirementTags`.
 */
export function attachedNeedsBarCount(settings, registry = defaultRegistry) {
  return drawnMeta(settings, registry)
    .some((m) => Array.isArray(m.requirementTags) && m.requirementTags.length > 0)
}

/**
 * Every disclosure the instances on this chart raise, deduped, in list order.
 *
 * ⚠️ DEDUPED BY `name :: note`, ACROSS INSTANCES. Two definitions built from one
 * script — the coexistence case T5b has to demonstrate — carry the SAME alert
 * sentence and the same fold sentence, and rendering each twice reads as two
 * problems. Same key `memberPaneDefinition` dedupes rows with, for the same
 * reason.
 *
 * @param {object|null} settings the member's RESOLVED chart settings
 * @param {object} registry      nativeRegistry (injected in tests)
 * @param {number|null} barsLoaded what the chart actually drew
 * @returns {{name: string, note: string}[]}
 */
export function attachedDisclosures(settings, registry = defaultRegistry, barsLoaded = null) {
  const out = []
  const seen = new Set()
  const push = (n) => {
    if (!n || typeof n.note !== 'string' || !n.note.trim()) return
    const key = `${n.name} :: ${n.note}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(n)
  }
  for (const meta of drawnMeta(settings, registry)) {
    for (const n of (Array.isArray(meta.disclosures) ? meta.disclosures : [])) push(n)
    for (const tag of (Array.isArray(meta.requirementTags) ? meta.requirementTags : [])) {
      push(requirementNote(tag, barsLoaded))
    }
  }
  return out
}

/**
 * @param {object} props
 * @param {object|null} props.settings   the pane's resolved chart settings
 * @param {number|null} props.barsLoaded the count the chart reported drawing
 * @param {object} [props.registry]
 */
export default function AttachedPineDisclosures({
  settings = null, barsLoaded = null, registry = defaultRegistry,
}) {
  // ⭐ THE GENERATION IS IN THE DEPENDENCY LIST BECAUSE THE ROWS ARRIVE LATE.
  // `useInstalledUserDefinitions` installs from SWR, after the first paint, so
  // the render that mounted this pane resolved `getDefinition` to nothing. That
  // number is the one value that changes when the installed set does — the same
  // reason `paneLayout` reads it.
  const generation = typeof registry.registryGeneration === 'function'
    ? registry.registryGeneration() : 0
  const rows = useMemo(
    () => attachedDisclosures(settings, registry, barsLoaded),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, registry, barsLoaded, generation],
  )
  if (!rows.length) return null
  return (
    <ul data-testid="pine-attached-disclosures" className={styles.notes}>
      {rows.map((n) => <li key={`${n.name}::${n.note}`}>{n.note}</li>)}
    </ul>
  )
}
