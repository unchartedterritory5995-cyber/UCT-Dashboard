// app/src/components/chart/IndicatorLibraryDialog.jsx
//
// ─── THE BROWSE / ADD SURFACE (spec §6) ─────────────────────────────────────
//
// TV's add-flow, copied exactly on purpose: search-first, add-and-stay-open,
// checkmarks on what is already on. Spec §1.5 — "don't innovate on chrome" —
// this is chrome, and users are TV-pre-trained.
//
// ⛔ IT IS NOT A CONTROL DOOR. Every write goes through `setIndicatorEnabled`,
// the writer the toolbar checkbox, both right-click doors, the four keyboard
// chords and the generated settings row already share. B3 found six doors one at
// a time, each because someone wrote `cs.indicators.<id>` raw; this surface adds
// a SEVENTH USE of one writer, not a seventh writer.
//
// ⛔ ONE EXCEPTION, AND IT IS NAMED: `volumeProfile` has no definition, so there
// is nothing to instantiate — `setIndicatorEnabled` returns the settings BY
// IDENTITY for it and the toggle would silently do nothing. Its write goes to
// its settings slice, the way the MA overlays and the volume pane write.
//
// ⛔ AND IT LISTS `definitions ∪ CARVED_OUT_ROWS`, never `listDefinitions()`. A
// list built from definitions alone drops `volumeProfile` — the user-facing
// regression B3 Task 11 refused.
//
// 🔴 …AND SINCE THIS FIX, ∪ THE MEMBER'S OWN FORMULAS. Phase D built every part
// of authoring one but the last: it saved, it installed, it DREW, and
// `getDefinition` resolved it — while this dialog, the one screen called "the
// indicator library", read the shipped catalogue only. A member had to already
// know their formula existed to find it. `userCatalogRows()` is the read;
// `catalogGeneration()` is the memo dependency that makes it arrive (the rows
// install from SWR AFTER first paint, and the registry module namespace is the
// same object forever, so a memo keyed on `[registry]` alone never recomputes —
// the same class of not-wired defect, one memo over).
//
// ⛔ THE UNION IS MADE HERE AND NOWHERE ELSE. `catalogRows()` stays the SHIPPED
// catalogue for the share link, the voice bus, the right-click submenu, the
// on-count and three registry rails — see `indicatorCatalog.js`'s header. This
// is the one surface whose job is to offer a member their own formulas.
//
// 🐛 THE PORTAL TRAP, INHERITED AND HANDLED. `Sheet` renders into
// `document.body`, and `ChartToolbar`'s close-on-outside-mousedown asks
// `ref.contains(e.target)` — so without an exemption, the mousedown of the very
// click that adds an indicator closes the settings panel underneath. That is the
// bug that made every colour swatch in the panel unusable in production, one
// surface over. `PORTAL_POPUP_ATTR` is the contract and the body wrapper carries
// it. ⚠️ `fireEvent.click` sends NO mousedown and passes on the broken build —
// the case that guards this uses `userEvent`.
//
// 🔴 …AND SINCE THIS FIX, THE ONES THE GATES REFUSED SAY SO. A member could save
// a formula, have the STORE accept it, and then simply not be offered it — the
// catalog omits a definition `installUserDefinitions` refuses, which is correct
// per its contract and completely silent. The reason has existed in
// `useInstalledUserDefinitions().errors` since Task 16 with zero production
// consumers. It is rendered here, VERBATIM, because this is the surface whose
// job is to offer a member their own formulas and therefore the surface that
// owes them a sentence when it cannot. See `indicatorCatalog.userRefusalRows`.
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import Sheet from '../mobile/Sheet'
import { PORTAL_POPUP_ATTR } from './ColorPicker'
import { useUserDefinitions, useInstalledUserDefinitions } from '../../hooks/useUserDefinitions'
import {
  catalogRows, userCatalogRows, catalogGeneration, userRefusalRows, REFUSED_CATEGORY,
} from './indicatorCatalog'
import { isIndicatorEnabled, setIndicatorEnabled, addInstance } from './engine/instanceControls'
import { ENGINE_OWNED } from './engine/flipState'
import styles from './IndicatorLibraryDialog.module.css'

/** Does this row match the search box? Name, short name, id, category and tags —
 *  five ways in, because a user who knows an indicator as "BB", as "Bollinger",
 *  as a "volatility" tool or as an "oscillator" is looking for the same row. */
export function matches(row, q) {
  if (!q) return true
  const n = q.trim().toLowerCase()
  if (!n) return true
  return row.name.toLowerCase().includes(n)
    || row.shortName.toLowerCase().includes(n)
    || row.id.toLowerCase().includes(n)
    || row.category.toLowerCase().includes(n)
    || (row.tags || []).some((t) => String(t).toLowerCase().includes(n))
}

/** Is this indicator on? Through the ONE reader for an engine row; through the
 *  settings slice for the carved-out one, which has no instance to read. */
export function isRowOn(row, settings) {
  return row.carvedOut
    ? settings?.indicators?.[row.id]?.enabled === true
    : isIndicatorEnabled(settings, row.id, ENGINE_OWNED)
}

export default function IndicatorLibraryDialog({ open, onClose, settings, onChange, registry }) {
  const [query, setQuery] = useState('')
  const searchRef = useRef(null)

  // Search-first: the box has focus the moment the dialog opens, so the flow is
  // "hit the chord, type three letters, Enter" without a pointer.
  useEffect(() => { if (open) searchRef.current?.focus() }, [open])

  // ─── THE MEMBER'S STORED FORMULAS: WHAT INSTALLED, AND WHAT DID NOT ───────
  //
  // ⛔⛔ THESE TWO CALLS RUN BEFORE `catalogGeneration` BELOW, AND THE ORDER IS
  // LOAD-BEARING — MEASURED, NOT ASSUMED. `useInstalledUserDefinitions` performs
  // the install DURING RENDER (that is its documented ordering point), so a
  // `generation` read ABOVE it is the value from BEFORE this render's install.
  // With the calls the other way round, the render in which a member's formulas
  // first arrive from SWR computed the catalogue memo against the stale number
  // and nothing re-rendered afterwards — the formulas appeared only if something
  // else happened to repaint the dialog. This file's own accepted-formula CONTROL
  // caught it on its first run. Reading the generation after the install makes
  // "arrived" and "listed" the same render.
  //
  // ⚠️ TWO HOOKS, ONE REQUEST. `useInstalledUserDefinitions` calls
  // `useUserDefinitions` itself and both hand SWR the SAME key, so the second
  // call is deduped into the first — no extra fetch, and no second copy of the
  // install (it is idempotent by `installKey`, which is a documented property of
  // the door rather than a hope). `errors` is the only place the refusal
  // sentence exists; `storedRows` is the only place the NAME the member typed
  // exists, because a refused document never becomes a registry definition.
  //
  // ⚠️ NEITHER READS THE `registry` PROP, DELIBERATELY. The install door is the
  // module registry — it is what `StockChart` draws through and what the store's
  // documents are validated against — so a caller that injected a fake registry
  // for the CATALOGUE still gets the real refusals rather than an empty list
  // that would read as "nothing was refused".
  const { rows: storedRows } = useUserDefinitions()
  const { errors: installErrors } = useInstalledUserDefinitions()

  // ⛔ `generation` IS NOT DECORATION IN THIS DEPENDENCY LIST. `registry` is a
  // module NAMESPACE — the same object for the lifetime of the tab — so a memo
  // keyed on it alone computes once, at first open, and never again. The user
  // rows arrive from SWR after first paint, so without this the member's own
  // formulas would be missing from the very dialog that is meant to list them
  // on every mount that opened before the fetch landed.
  const generation = catalogGeneration(registry)
  // Member's formulas LAST, so their section heading lands at the bottom of the
  // list rather than wherever an alphabet would have put it, and so the shipped
  // rows a user is pre-trained on keep the positions they have always had.
  const all = useMemo(
    () => [...catalogRows(registry), ...userCatalogRows(registry)],
    [registry, generation],
  )
  const rows = useMemo(() => all.filter((r) => matches(r, query)), [all, query])

  // ─── THE FORMULAS THAT ARE NOT ON THAT LIST, AND WHY ──────────────────────
  const refusals = useMemo(
    () => userRefusalRows(
      (storedRows || []).map((r) => r && r.definition),
      installErrors,
    ).filter((r) => matches(r, query)),
    [storedRows, installErrors, query],
  )

  // Groups are DERIVED, in first-appearance order. Adding a definition in a new
  // category brings its own heading; there is no group array to forget to edit —
  // the exact defect the settings modal's hardcoded section list was.
  const groups = useMemo(() => [...new Set(rows.map((r) => r.category))], [rows])

  const toggle = useCallback((row) => {
    const on = isRowOn(row, settings)
    const next = row.carvedOut
      ? {
          ...settings,
          indicators: {
            ...(settings?.indicators || {}),
            [row.id]: { ...(settings?.indicators?.[row.id] || {}), enabled: !on },
          },
        }
      : setIndicatorEnabled(settings, row.id, !on, registry)
    // Identity, not deep-equality: a REFUSED write returns `settings` itself and
    // the caller must be able to skip persisting. Calling `onChange`
    // unconditionally would persist a no-op and mark the preset custom for a
    // click that changed nothing.
    if (next !== settings) onChange?.({ ...next, preset: 'custom' })
  }, [settings, onChange, registry])

  /** ⭐ chart-UX-walls TASK 6 — "+ Add another", on a row that is already ON.
   *
   * ⛔ IT IS THE SAME DOOR THE CHIP MENU'S DUPLICATE USES, and it is `addInstance`
   * rather than a second `setIndicatorEnabled` call: the toggle above REVIVES
   * `legacy:<id>` when it is already there, so clicking a ticked row twice can
   * never produce two lines. That asymmetry is the whole reason this control has
   * to exist separately from the checkmark.
   *
   * ⛔ `stopPropagation` IS NOT TIDINESS. The whole `<li>` is the toggle, so
   * without it every Add-another click would ALSO fire `toggle(row)` and turn the
   * indicator off in the same gesture — a control that does the opposite of what
   * it says. */
  const addAnother = useCallback((row, e) => {
    e.stopPropagation()
    const next = addInstance(settings, row.id, registry)
    if (next !== settings) onChange?.({ ...next, preset: 'custom' })
  }, [settings, onChange, registry])

  if (!open) return null

  return (
    <Sheet open={open} onClose={onClose} variant="auto" title="Indicators" maxWidth={640}>
      {/* The portal exemption. See the header. */}
      <div className={styles.body} {...{ [PORTAL_POPUP_ATTR]: 'indicator-library' }}>
        <input
          ref={searchRef}
          type="search"
          role="searchbox"
          className={styles.search}
          placeholder="Search indicators"
          aria-label="Search indicators"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {rows.length === 0 && refusals.length === 0 && (
          <div className={styles.empty}>No indicator matches “{query}”.</div>
        )}
        {groups.map((category) => (
          <section key={category} className={styles.group}>
            <h3 className={styles.groupHead}>{category}</h3>
            <ul className={styles.list} role="listbox" aria-label={category}>
              {rows.filter((r) => r.category === category).map((row) => {
                const on = isRowOn(row, settings)
                return (
                  <li
                    key={row.id}
                    role="option"
                    aria-selected={on}
                    data-def-id={row.id}
                    /* ⭐ THE PROVENANCE, ON THE ROW ITSELF. A member's formula is
                       a different KIND of thing from a shipped indicator — they
                       wrote it, only they have it, and it is theirs to delete —
                       so it is marked structurally (this attribute + the class
                       below + the pill) rather than only by which heading it
                       happens to sit under. */
                    data-user-defined={row.userDefined ? 'true' : 'false'}
                    tabIndex={0}
                    className={`${styles.row} ${on ? styles.rowOn : ''} ${row.userDefined ? styles.rowMine : ''}`}
                    onClick={() => toggle(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(row) }
                    }}
                  >
                    <span className={styles.check} aria-hidden="true">{on ? '✓' : ''}</span>
                    <span className={styles.main}>
                      <span className={styles.titleRow}>
                        {/* The LONG name here — `meta.name`. Menus, region titles
                            and compact strips take `shortName`; this surface and
                            the generated settings rows take the full one. */}
                        <span className={styles.name}>{row.name}</span>
                        <span className={styles.chip}>{row.shortName}</span>
                        {/* ⭐ NAMED, NOT JUST TINTED. A colour alone is not a
                            distinction for a member who cannot see it, and the
                            heading scrolls out of view on a long list. */}
                        {row.userDefined && <span className={styles.mine}>Your formula</span>}
                        {row.sessionOnly && <span className={styles.pill}>Intraday only</span>}
                        {row.repaint && <span className={styles.badge}>{labelForRepaint(row.repaint)}</span>}
                        {/* Tier is shown only when it is NOT free. Every native
                            is free today, so this renders for nothing — which is
                            why the test asserts its ABSENCE rather than its text. */}
                        {row.tier && row.tier !== 'free' && (
                          <span className={styles.tier}>{row.tier}</span>
                        )}
                      </span>
                      {row.description && <span className={styles.blurb}>{row.description}</span>}
                    </span>
                    {/* ⛔ ONLY ON A ROW THAT IS ON, AND NEVER ON THE CARVED-OUT ONE.
                        `volumeProfile` has no definition, so `addInstance` returns
                        the settings BY IDENTITY for it and the button would be a
                        live control that writes nowhere — the exact defect this
                        phase retires. A second volume profile is not a thing the
                        canvas overlay can draw anyway. */}
                    {on && !row.carvedOut && (
                      <button
                        type="button"
                        className={styles.addAnother}
                        aria-label={`Add another ${row.name}`}
                        title={`Add a second ${row.shortName} with the default settings`}
                        onClick={(e) => addAnother(row, e)}
                      >+ Add another</button>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
        {/* 🔴 SAVED, AND NOT OFFERED — WITH THE REASON. Rendered LAST, and only
            when something was actually refused, so a member whose formulas all
            install sees no new section, no empty heading and no warning about
            nothing. */}
        {refusals.length > 0 && (
          <section className={styles.group} data-testid="user-definition-refusals">
            <h3 className={styles.groupHead}>{REFUSED_CATEGORY}</h3>
            {/* The ONE sentence this surface writes for itself, and it says WHAT
                happened, never WHY — the why is the gate's and is printed
                untouched below it. Same split `useUserDefinitions` draws when it
                refuses to paraphrase the store's refusal. */}
            <p className={styles.refusedLede}>
              These saved formulas are not being offered on this chart. The reason
              below comes from the check that refused each one.
            </p>
            {/* ⛔ NOT a `role="listbox"` and NOT `role="option"`. There is no
                installed definition behind these rows, so there is nothing to
                tick: an option here would be a control that writes nowhere. */}
            <ul className={styles.list}>
              {refusals.map((row) => (
                <li
                  key={row.id}
                  className={`${styles.row} ${styles.refusedRow} ${styles.rowMine}`}
                  data-testid="user-definition-refusal"
                  data-def-id={row.id}
                >
                  <span className={styles.main}>
                    <span className={styles.titleRow}>
                      <span className={styles.name}>{row.name}</span>
                      <span className={styles.mine}>Your formula</span>
                    </span>
                    {/* ⛔ THE GATE'S OWN SENTENCE, WHOLE AND UNEDITED — including
                        the `<id>: ` prefix the door itself writes. A definition
                        can fail more than one gate, and every sentence is shown:
                        dropping all but the first would hide a second reason
                        that has to be fixed too. */}
                    {row.messages.map((message, i) => (
                      <span
                        key={i}
                        className={styles.refusedWhy}
                        data-testid="user-definition-refusal-reason"
                      >{message}</span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  )
}

/** `non-repainting` → `Non-repainting`. The definition's vocabulary is the
 *  authority; this only cases it for display. ⛔ Informational styling, never
 *  error-coloured (spec §6 state 9) — a factual property is not a warning. */
function labelForRepaint(value) {
  const s = String(value).replace(/-/g, '-')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
