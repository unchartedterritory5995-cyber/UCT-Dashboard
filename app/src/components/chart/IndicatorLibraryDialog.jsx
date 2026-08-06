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
// 🐛 THE PORTAL TRAP, INHERITED AND HANDLED. `Sheet` renders into
// `document.body`, and `ChartToolbar`'s close-on-outside-mousedown asks
// `ref.contains(e.target)` — so without an exemption, the mousedown of the very
// click that adds an indicator closes the settings panel underneath. That is the
// bug that made every colour swatch in the panel unusable in production, one
// surface over. `PORTAL_POPUP_ATTR` is the contract and the body wrapper carries
// it. ⚠️ `fireEvent.click` sends NO mousedown and passes on the broken build —
// the case that guards this uses `userEvent`.
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import Sheet from '../mobile/Sheet'
import { PORTAL_POPUP_ATTR } from './ColorPicker'
import { catalogRows } from './indicatorCatalog'
import { isIndicatorEnabled, setIndicatorEnabled } from './engine/instanceControls'
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

  const all = useMemo(() => catalogRows(registry), [registry])
  const rows = useMemo(() => all.filter((r) => matches(r, query)), [all, query])

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
        {rows.length === 0 && (
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
                    tabIndex={0}
                    className={`${styles.row} ${on ? styles.rowOn : ''}`}
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
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
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
