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
// 🔴 …AND SINCE THIS FIX, THE REPAINT BADGE IS THE LINTER'S MEASUREMENT. It used
// to be `meta.repaint`, the definition's declared CLAIM — a value one shared
// helper writes for all seventeen definitions before the `...meta` spread, so it
// audited nothing (decision record §1) and on `ichimoku` it CONTRADICTED the
// machine linter, which measures `chikou` as `preview-repaints` from the
// `i - kijunPeriod` back-shift. This surface was telling a member a line they
// might trade off cannot move. The row now reads `definitionRollUp` and names
// the PLOTS that carry the verdict; see `repaintNotice` at the foot of this file.
//
// 🔴 …AND SINCE AN EARLIER FIX, THE ONES THE GATES REFUSED SAY SO. A member could save
// a formula, have the STORE accept it, and then simply not be offered it — the
// catalog omits a definition `installUserDefinitions` refuses, which is correct
// per its contract and completely silent. The reason has existed in
// `useInstalledUserDefinitions().errors` since Task 16 with zero production
// consumers. It is rendered here, VERBATIM, because this is the surface whose
// job is to offer a member their own formulas and therefore the surface that
// owes them a sentence when it cannot. See `indicatorCatalog.userRefusalRows`.
import { withoutGuardIds } from './engine/ast/guardIdText'
import { orderCategories } from './technicalCategories'
import { useState, useMemo, useRef, useEffect, useCallback, useId, useSyncExternalStore } from 'react'
// ⭐ RS split U1 — a `meta.requiresServer` definition is offered only once the
// live server lists it; the version is what re-lists when the answer lands.
import { isCatalogRowOffered, subscribeServerDefinitions, serverDefinitionsVersion } from './engine/serverCompute'
import Sheet from '../mobile/Sheet'
import { PORTAL_POPUP_ATTR } from './ColorPicker'
import { useUserDefinitions, useInstalledUserDefinitions } from '../../hooks/useUserDefinitions'
import {
  catalogRows, userCatalogRows, catalogGeneration, userRefusalRows, REFUSED_CATEGORY,
  BUILT_IN_ROWS,
} from './indicatorCatalog'
import { isIndicatorEnabled, setIndicatorEnabled, addInstance, definitionVisibility } from './engine/instanceControls'
// The blob-shape readers for the two BUILT-IN rows. They are not instances and
// not settings slices, so `instanceControls` cannot answer for them — see
// `isRowOn` below, and `chartDefaults`'s tombstone header for why removal is a
// flag rather than a splice.
import { liveOverlays, isVolumeRemoved, newOverlay } from './chartDefaults'
import { isUctIntelligenceAdded, addUctIntelligence, removeUctIntelligence } from './uctIntelligence'
import { revivableSlotIndex, reviveSlot } from './maAdoption'
import { CLEAN } from './engine/repaintVerdict'
import { ENGINE_OWNED } from './engine/flipState'
import { isTouredFirstAdd } from './legend/indicatorTour'
import styles from './IndicatorLibraryDialog.module.css'
// ⭐⭐ THE SAME UNIFIED DOOR THE SETTINGS TAB OPENS. Symbols and breadth are
// results in this list too, created through `createFromResult` — one discovery
// facade, one creation composition, two mount points. A member who can search
// `QQQ` from Chart Settings and not from the toolbar has two products.
import {
  LIBRARY_HIDDEN_IDS, hiddenLibraryIds, libraryRowFor, symbolLibraryRow,
  createFromResult, CAPABILITY, isDelistedResult,
} from './discoveryCatalog'
import useSymbolDiscovery from './useSymbolDiscovery'
import { tagRestatesName } from './shortTag'
// ⭐ UCT RS Phase 4, unit 4-03 — definition-level onboarding. The engine names no
// indicator: a definition declares `meta.tour` / `meta.searchHint` (defSchema) and
// this surface reads them generically.
import { normalizeHintQuery } from './engine/defSchema'
import useIndicatorTours from './useIndicatorTours'

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

/** Does the search NAME this row exactly? The query equals its id, its short name, or
 *  one whole word of its short name ("rs" names `UCT RS`, "rsi" names `RSI`).
 *  ⭐ 2026-11-08, real-screen check: "rs" matched a dozen Momentum rows by substring
 *  and the fixed heading order put Relative Strength sixth, so the indicator the
 *  member typed the name of sat below RSI, MACD and ten oscillators. A row the query
 *  names exactly now leads its section, and its section leads the results. Only an
 *  EXACT word counts: "r" or "rel" never reorders anything. */
export function namesRow(row, q) {
  const n = String(q || '').trim().toLowerCase()
  if (!n || !row) return false
  const short = String(row.shortName || '').toLowerCase()
  if (String(row.id || '').toLowerCase() === n || short === n) return true
  return short.split(/[^a-z0-9]+/).includes(n)
}

/** Is this indicator on? Through the ONE reader for an engine row; through the
 *  settings slice for the carved-out one, which has no instance to read; and
 *  through the blob's own shape for the two BUILT-IN rows, which are neither.
 *
 *  ⭐ THE `builtIn` BRANCH IS WHAT MAKES A MOVING AVERAGE FINDABLE. `cs.overlays`
 *  is a positional ARRAY and `cs.volume` is a SECTION — neither is an instance
 *  and neither is `cs.indicators.<id>`, so both older branches answer `false` for
 *  them forever, which is precisely why the catalogue used to say "no indicator
 *  matches 'moving average'" over a chart drawing four of them. */
export function isRowOn(row, settings) {
  // The UCT Intelligence row (uctIntelligence.js): on while the indicator is added to this chart.
  if (row.builtIn === 'uctIntelligence') return isUctIntelligenceAdded(settings)
  if (row.builtIn === 'overlay') return liveOverlays(settings).length > 0
  if (row.builtIn === 'volume') return !isVolumeRemoved(settings)
  return row.carvedOut
    ? settings?.indicators?.[row.id]?.enabled === true
    : isIndicatorEnabled(settings, row.id, ENGINE_OWNED)
}

/** ⭐ A1 (D3) — what the row's CHECKMARK and its click DIRECTION read: `absent`, `shown`
 *  or `hidden` (`definitionVisibility`), with `live` / `visible` counts for "2 of 3".
 *  `isRowOn` keeps its "exists" meaning for every other caller. Built-in and carved-out
 *  rows have no hidden state: `shown` when on, `absent` when off. */
export function rowVisibility(row, settings) {
  if (row.builtIn || row.carvedOut) {
    const on = isRowOn(row, settings)
    return { state: on ? 'shown' : 'absent', live: 0, visible: 0, partial: false }
  }
  return definitionVisibility(settings, row.id, ENGINE_OWNED)
}

/** The settings blob after flipping one catalog row — the ONE write every
 *  toggling surface shares (this dialog, the phone ƒx sheet's Studies
 *  switches). Carved-out rows flip their settings slice; engine rows go
 *  through `setIndicatorEnabled`. A refused engine write returns `settings`
 *  BY IDENTITY so callers can skip persisting a no-op. */
export function toggledRow(row, settings, registry) {
  const on = isRowOn(row, settings)
  // ⭐ UCT INTELLIGENCE: adding turns Auto patterns + labels on (the owner's defaults); removing turns every
  // layer off, Auto patterns included, since `showPatterns` IS that layer's one switch.
  if (row.builtIn === 'uctIntelligence') {
    return on ? removeUctIntelligence(settings) : addUctIntelligence(settings)
  }
  // ⭐ THE BUILT-IN ROWS: a moving average and the volume pane.
  //
  // ⛔ ADD-BACK PREFERS A TOMBSTONE OVER A NEW SLOT, and that is the member's
  // work being handed back to them rather than replaced. Removing EMA 9 leaves
  // its slot in place carrying `removed: true` (see `chartDefaults`'s
  // `isOverlayRemoved` for why a splice is unsafe), so the colour, the period and
  // the line width they set are all still there — reviving the tombstone gives
  // them the EMA 9 they had, not a fresh SMA 50 they have to configure again.
  // Only when nothing is tombstoned does this mint a new overlay, appended to the
  // END (the merge reads `.concat(parsed.overlays.slice(4))`, and the array's own
  // comment says new slots go on the end).
  //
  // ⛔ THE OVERLAY ROW IS ADD-ONLY, AND `on` IS DELIBERATELY NOT CONSULTED. A
  // chart holds MANY moving averages, so there is no single thing for "off" to
  // mean: the honest readings are "delete every moving average I have" — which no
  // one click should mean — or "delete the last one", which is a rule nobody can
  // predict. Removal of a SPECIFIC moving average already has a precise door: the
  // ✕ on its own row in the active list, which names the one you are looking at.
  if (row.builtIn === 'overlay') {
    // ⭐ 2026-09-28 — a restored slot is re-adopted as its `movingAverage`
    // instance (`maAdoption.reviveSlot`), and a NEW one is appended as a live slot
    // the same fold turns into an instance. Either way the chart gets an instance.
    const list = Array.isArray(settings?.overlays) ? settings.overlays : []
    const revive = revivableSlotIndex(settings)
    return revive >= 0
      ? reviveSlot(settings, revive)
      : { ...settings, overlays: [...list, newOverlay(list.length)] }
  }
  // ⛔ THE VOLUME PANE FLIPS `removed`, NEVER `visible`. `visible` is the hide
  // toggle the member already has on the row and in three other menus; writing it
  // from the CATALOGUE would make "add volume back" silently un-hide a pane they
  // had deliberately hidden, and would make the catalogue and the row's own
  // switch two controls over one fact.
  if (row.builtIn === 'volume') {
    return { ...settings, volume: { ...(settings?.volume || {}), removed: on } }
  }
  if (row.carvedOut) {
    return {
      ...settings,
      indicators: {
        ...(settings?.indicators || {}),
        [row.id]: { ...(settings?.indicators?.[row.id] || {}), enabled: !on },
      },
    }
  }
  // ⭐⭐ AN ADD-ONLY DEFINITION IS NEVER SWITCHED OFF FROM HERE (2026-09-28). The
  // Moving Average is where the member's default averages live now (`maAdoption.js`),
  // and "off" for a DEFINITION tombstones EVERY live instance of it — one click on
  // an active row would take EMA 9, EMA 20, SMA 50 and SMA 200 off the chart with
  // it. It inherits the legacy MA row's rule stated above: a chart holds many, so
  // there is no single thing for "off" to mean, and removing a specific one has a
  // precise door (its own row). So the row ADDS, on or not.
  const def = typeof registry?.getDefinition === 'function' ? registry.getDefinition(row.id) : null
  if (def && def.meta && def.meta.addOnly === true) return addInstance(settings, row.id, registry)
  // ⭐ A1 (D3): the direction comes from VISIBILITY, not existence — a click on a shown
  // row HIDES it (kept, with its settings), a click on a hidden row shows exactly what
  // was hidden, and an absent row is added. Deleting every instance is Chart Settings'
  // "Remove all", never this row.
  return setIndicatorEnabled(settings, row.id, rowVisibility(row, settings).state !== 'shown', registry)
}

// 🔴 …AND SINCE THIS FIX, THE MEMBER CAN AUTHOR ONE FROM HERE — `onCreateFormula`.
// The criteria builder (Phase E, nine tasks: picker, plain-language door,
// crossings, starter library) had EXACTLY ONE mount site, `ChartToolbar`'s
// `<BuilderSheet>`, opened from EXACTLY ONE place: `ChartSettingsPanel`'s "New
// formula" launcher. That panel renders behind `!hideSettingsButton`, and
// `/charts` sets `hideSettingsButton` — deliberately, because the workspace has
// `ChartSettingsModal` and two settings surfaces over one `chart_settings` blob
// is a second authority. So on the ONE surface a charting member lives on, the
// builder was unreachable on every viewport. Fourteenth measured instance of
// built-tested-green-and-unreachable in this repo, and the largest.
//
// ⭐ THE DOOR BELONGS HERE AND NOT IN THE SETTINGS MODAL. This dialog is already
// one click from the chart on `/charts` (the toolbar's labelled "Indicators"
// button is deliberately NOT gated on `hideSettingsButton` — see its comment in
// `ChartToolbar.jsx`), it is the surface whose stated job is to offer a member
// their own formulas, and a member's formula LANDS here wearing a "Your formula"
// pill. Browse-and-add and author-your-own are the same act one step further
// out; `ChartSettingsPanel` already puts them side by side for exactly that
// reason. Putting it in `ChartSettingsModal` instead would be three menus deep
// and would put an AUTHORING surface inside a TUNING one.
//
// ⛔ IT IS A LAUNCHER, NOT A SECOND BUILDER. The prop's only job is to ask the
// toolbar — which already owns `builderOpen` and already mounts the ONE
// `<BuilderSheet>` — to open it. No second sheet is mounted, no second draft
// state exists here, and this file imports nothing from `builder/`.
//
// ⚠️ ABSENT PROP ⇒ ABSENT DOOR. Every other mount site of this dialog still
// reaches the builder through the settings panel, so the launcher renders only
// where a host asks for it rather than appearing twice on the surfaces that
// already have one.
// ⭐ `extraRows`: rows a HOST offers on top of the catalogue — today only the chart's UCT Intelligence row,
// passed only while the pattern layer exists for this viewer (absent prop = absent row, the same rule as
// `onCreateFormula`). Never part of `catalogRows()` or `BUILT_IN_ROWS`, whose consumers are railed id-for-id.
//
// ⭐ `onFirstAdd(defId)` (Phase 4, unit 4-03): called when a click here adds the FIRST live instance of a
// definition that declares `meta.tour` and whose tour this member has not seen (`useIndicatorTours`). Never on
// showing a hidden instance, never on a second instance. The HOST shows the tour and calls `markSeen` when the
// member finishes or skips it; this dialog only reports the add. Absent prop ⇒ no preferences read for it.
export default function IndicatorLibraryDialog({ open, onClose, settings, onChange, registry, onCreateFormula, sheetClassName = '', extraRows = null, onFirstAdd = null }) {
  const [query, setQuery] = useState('')
  const { seen: tourSeen } = useIndicatorTours(typeof onFirstAdd === 'function')
  const searchRef = useRef(null)
  const bodyRef = useRef(null)

  // Search-first: the box has focus the moment the dialog opens, so the flow is
  // "hit the chord, type three letters, Enter" without a pointer.
  //
  // ⛔ AND IT OPENS EMPTY. This dialog is not unmounted on close — the host only
  // toggles `open` — so `query` survives, and a member who searched once came
  // back to a filtered library with no visible cause.
  //
  // ⚰️ MEASURED ON PRODUCTION 2026-08-14: searched `sma` (which matches nothing,
  // because the moving averages are not in this library at all), closed, reopened
  // — the box still read `sma` and the list still read "No indicator matches
  // “sma”". Reproduced again with `macd`. A library that looks EMPTY is the worst
  // possible thing for the surface whose whole job is "here is everything you can
  // add", and the cause is one render old and invisible.
  useEffect(() => {
    if (!open) return
    setQuery('')
    // Desktop only: type-to-filter the moment the dialog opens. On touch the
    // autofocus is a double bug — iOS Safari zooms the viewport for any
    // focused input under 16px, and the software keyboard eats half the sheet
    // before the member sees a single row. (max-width: 1024px) is the
    // canonical TOUCH boundary (styles/breakpoints.css).
    if (!window.matchMedia?.('(max-width: 1024px)').matches) searchRef.current?.focus()
  }, [open])

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
  // ⭐ `BUILT_IN_ROWS` FIRST — the moving averages and the volume pane, which are
  // neither definitions nor settings slices and so appeared in NO catalogue until
  // now. They are unioned HERE rather than inside `catalogRows()` for the reason
  // written beside them: that function is the shipped DEFINITION manifest and two
  // railed consumers assert against it id-for-id.
  //
  // ⛔⛔ AND `LIBRARY_HIDDEN_IDS` IS SUBTRACTED HERE, NOT OMITTED UPSTREAM.
  // `catalogRows()` is the shipped DEFINITION manifest and two railed consumers
  // assert against it id-for-id, so a definition cannot be left out of it — it
  // has to be listed there and subtracted HERE, as a written claim. Its one
  // member is `dataSeries`: it plots whatever it is pointed at, so a row reading
  // "Data Series", offering to plot `close` in a pane of its own, means nothing
  // to anybody. Its member-facing rows are `QQQ` and `UCTA50`, which carry the
  // source that gives it meaning — and those arrive through symbol search, not
  // through this list.
  // ⭐ THE BUILT-IN ROWS ARE SUBTRACTED TOO (2026-09-15). The hidden list used to
  // apply only to definitions because only a definition had ever needed hiding;
  // the legacy `ma` row is the first BUILT-IN that does. It is SETTINGS-AWARE —
  // hidden on an ordinary chart so browse shows one Moving Average, offered again
  // when there is a tombstoned overlay to revive. See `hiddenLibraryIds`.
  const hidden = hiddenLibraryIds(settings)
  // ⭐ RS split U1 — AND A `meta.requiresServer` DEFINITION IS SUBTRACTED UNTIL
  // THE LIVE SERVER LISTS IT (`isCatalogRowOffered`, the same fail-closed fetch
  // as the per-input gate). Subtracted here, not inside `catalogRows()`, for the
  // reason written above. `serverVersion` moves when the answer lands, so the
  // row appears without a reopen.
  const serverVersion = useSyncExternalStore(subscribeServerDefinitions, serverDefinitionsVersion, () => 0)
  // ⭐ AND THE REVEALED REVIVE ROW IS RENAMED — *Restore EMA 9*, not a second row
  // reading "Moving Average". See `discoveryCatalog.libraryRowFor`.
  const all = useMemo(
    () => [
      ...(Array.isArray(extraRows) ? extraRows : []),
      ...BUILT_IN_ROWS.filter((r) => !hidden.includes(r.id)).map((r) => libraryRowFor(r, settings)),
      ...catalogRows(registry).filter((r) => !hidden.includes(r.id) && isCatalogRowOffered(r, registry)),
      ...userCatalogRows(registry),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `generation` IS the registry's version; `serverVersion` the gate's
    [registry, generation, hidden, settings, extraRows, serverVersion],
  )
  // ⛔ ONE SEARCH, SHARED WITH THE SETTINGS TAB AND THE SOURCE PICKER. Same hook,
  // same endpoints, same debounce, same facade adapters — see the import block.
  const { results: symbolResults, loading: symbolsLoading } = useSymbolDiscovery(query, open)
  // ⛔⛔ THE **RESULT** IS WHAT CREATES, NOT THE ROW: a library row's `shortName`
  // is its chip (`ETF`), a result's is the series' display NAME. Handing the row
  // to `createFromResult` would label a QQQ series "ETF" everywhere.
  const symbolRows = useMemo(() => {
    const out = []
    const byKey = new Map()
    for (const res of symbolResults) {
      // ⛔ A DELISTED SECURITY IS NOT OFFERED HERE (2026-11-08). `/api/ticker-search`
      // folds the delisted registry into its reply, so "rsi" listed a dozen dead
      // companies whose NAMES contain the letters (Mattersight, Tarsier, …), each a
      // row that `createFromResult` refuses — clicking it did nothing. This is an
      // INDICATOR library; the symbol search still finds them, with their reason.
      if (isDelistedResult(res)) continue
      const row = symbolLibraryRow(res)
      if (!row) continue
      out.push(row)
      byKey.set(row.key, res)
    }
    return { rows: out, byKey }
  }, [symbolResults])
  // ⛔ THE REMOTE ROWS ARE ALREADY THE ANSWER TO THIS QUERY and are not re-filtered
  // by `matches` — see the settings tab's own note for the measured reason.
  // A row the query names exactly (`namesRow`) leads; the rest keep catalogue order (a stable sort).
  const indicatorRows = useMemo(() => {
    const hit = all.filter((r) => matches(r, query))
    return [...hit.filter((r) => namesRow(r, query)), ...hit.filter((r) => !namesRow(r, query))]
  }, [all, query])
  const rows = useMemo(
    () => [...indicatorRows, ...symbolRows.rows],
    [indicatorRows, symbolRows],
  )

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
  //
  // ⭐ EXCEPT the member's OWN work, which is hoisted to the front. Derivation put
  // it LAST — below Momentum, Volatility, Volume and Trend — because a member's
  // formulas are appended after the natives, so the thing they built took a full
  // dialog-height of scrolling to reach while every built-in sat above it.
  // Measured in production 2026-08-10: I saved a formula and could not find it
  // without searching for it by name.
  //
  // ⛔ STILL DERIVED, NOT LISTED. The hoist is a PARTITION of the derived order on
  // `userDefined`, so a new native category continues to bring its own heading and
  // there is no second list to keep in step.
  //
  // ⭐⭐ 2026-11-08 — INDICATORS FIRST WHEN THE QUERY MATCHES ANY; DISCOVERY AFTER.
  // ⚰️ MEASURED ON THE REAL SCREEN: "rsi" is also a TICKER (Rush Street), so the
  // exact-ticker hoist below put the whole Symbols group — RSI plus every company
  // whose name contains "rsi" — ABOVE Momentum, and the RSI indicator and the UCT
  // RS signpost ended up at the bottom of the INDICATOR library. And the remote
  // reply lands ~150 ms to seconds after the local rows, so the hoist could MOVE
  // the indicator sections under a member who had already reached RSI; a browser
  // blurs a focused node that is moved, which fits the reported "first Enter was
  // ignored while the row re-laid out" (inferred, not traced on a device).
  // So the two halves are ranked apart: the indicator headings (in their fixed
  // order, the member's own first), then the hint row, then the discovery
  // headings. The exact-ticker hoist still decides the order AMONG the discovery
  // headings, and when NO indicator matches (`QQQ`) it is still the first section.
  // A discovery heading an indicator section already has (none today) joins that
  // section instead of printing the heading twice.
  const { indicatorGroups, discoveryGroups } = useMemo(() => {
    // ⭐ 2026-10-01 — THE TECHNICAL HEADINGS IN THEIR FIXED ORDER
    // (`technicalCategories.js`), never in whatever order the catalogue happened
    // to list its rows; any other heading keeps its first-appearance place after.
    const order = orderCategories([...new Set(indicatorRows.map((r) => r.category))])
    const mine = new Set(indicatorRows.filter((r) => r.userDefined).map((r) => r.category))
    const base = [...order.filter((c) => mine.has(c)), ...order.filter((c) => !mine.has(c))]
    // ⭐ The section holding a row the query names exactly (`namesRow`) goes first.
    const named = new Set(indicatorRows.filter((r) => namesRow(r, query)).map((r) => r.category))
    const ranked = [...base.filter((c) => named.has(c)), ...base.filter((c) => !named.has(c))]
    const own = new Set(ranked)
    const disc = orderCategories([...new Set(symbolRows.rows.map((r) => r.category))])
      .filter((c) => !own.has(c))
    // ⭐ AN EXACT TICKER OUTRANKS THE OTHER DISCOVERY RESULTS (§9) — the same
    // condition the settings tab hoists on.
    const first = symbolRows.rows[0]
    const exact = first && String(first.id).toUpperCase() === String(query).trim().toUpperCase()
      ? first.category : null
    const discRanked = exact && disc.includes(exact) ? [exact, ...disc.filter((c) => c !== exact)] : disc
    return { indicatorGroups: ranked, discoveryGroups: discRanked }
  }, [indicatorRows, symbolRows, query])

  // ⭐ A row's description id, for its title button's `aria-describedby`. The key
  // is encoded injectively (every non-alphanumeric becomes its code point).
  const blurbBase = useId()
  const blurbId = (row) => `${blurbBase}-blurb-${String(row.key || row.id).replace(/[^A-Za-z0-9]/g, (ch) => `_${ch.codePointAt(0)}_`)}`

  // ─── THE SEARCH HINT (Phase 4, unit 4-03) ─────────────────────────────────
  //
  // A shipped definition may declare `meta.searchHint.queries`; when the WHOLE
  // search equals one of them (in `normalizeHintQuery`'s form), one muted row is
  // printed under the results. ⛔ AN EXACT COMPARISON, NEVER A SUBSTRING OR A
  // REGEX: "rsi divergence" is a search for RSI and gets no correction, and a
  // pattern over names matches more than one definition (see the warning in
  // `IndicatorLibraryDialog.test.jsx` about a name lookup hitting two rows).
  // A member's own formula never carries one here: its meta is member-written,
  // and a hint is an editorial row. The first declaring definition in list order
  // wins, so there is only ever one row.
  const searchHint = useMemo(() => {
    const q = normalizeHintQuery(query)
    if (!q) return null
    for (const row of all) {
      if (row.userDefined || row.builtIn || row.carvedOut || row.restores) continue
      const def = typeof registry?.getDefinition === 'function' ? registry.getDefinition(row.id) : null
      const h = def && def.meta && def.meta.searchHint
      if (h && Array.isArray(h.queries) && h.queries.includes(q)) return { row, def, hint: h }
    }
    return null
  }, [all, query, registry])

  /** Report a first add to the host (`isTouredFirstAdd`), unless the member has
   *  seen the definition's tour. */
  const reportFirstAdd = useCallback((row, before, after) => {
    if (typeof onFirstAdd !== 'function' || !row) return
    if (!isTouredFirstAdd(row, before, after, registry)) return
    if (tourSeen(row.id)) return
    onFirstAdd(row.id)
  }, [onFirstAdd, registry, tourSeen])

  const toggle = useCallback((row) => {
    // ⭐ A DISCOVERY RESULT CREATES THROUGH THE FACADE. `toggledRow` speaks
    // definitions, overlays and settings slices; a SYMBOL is none of those, and
    // `createFromResult` is the one composition that turns one into the canonical
    // `dataSeries` instance. Refusals stay identity-based at both doors.
    const res = symbolRows.byKey.get(row.key)
    if (res) {
      const created = createFromResult(settings, res, registry)
      if (created !== settings) onChange?.({ ...created, preset: 'custom' })
      return
    }
    const next = toggledRow(row, settings, registry)
    // Identity, not deep-equality: a REFUSED write returns `settings` itself and
    // the caller must be able to skip persisting. Calling `onChange`
    // unconditionally would persist a no-op and mark the preset custom for a
    // click that changed nothing.
    if (next !== settings) {
      onChange?.({ ...next, preset: 'custom' })
      reportFirstAdd(row, settings, next)
    }
  }, [settings, onChange, registry, symbolRows, reportFirstAdd])

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
    // ⛔ A BUILT-IN ROW HAS NO DEFINITION TO INSTANTIATE, so `addInstance` would
    // return the settings BY IDENTITY and the ＋ would be a live control that
    // writes nowhere. `toggledRow`'s overlay branch is what means "another moving
    // average" — it revives a tombstone or appends a slot — so the two doors
    // share one writer here exactly as they do everywhere else.
    const next = row.builtIn
      ? toggledRow(row, settings, registry)
      : addInstance(settings, row.id, registry)
    if (next !== settings) {
      onChange?.({ ...next, preset: 'custom' })
      reportFirstAdd(row, settings, next)
    }
  }, [settings, onChange, registry, reportFirstAdd])

  /**
   * ⭐ ↓ / ↑ THROUGH THE RESULTS (2026-11-08). ↓ in the search box moves to the
   * first result; ↓ / ↑ walk the result title buttons and the hint's button in
   * the order they are drawn; ↑ from the first returns to the box; Home / End
   * jump to the ends. ROVING FOCUS on real buttons — the pattern the settings
   * tab's structure list uses (`onStructureKeys`) — not `aria-activedescendant`,
   * which needs a listbox of options, and this list is deliberately not one (a
   * row holds a second button, "+ Add another"). Tab order is unchanged.
   */
  const onLibraryKeys = useCallback((e) => {
    const k = e.key
    if (k !== 'ArrowDown' && k !== 'ArrowUp' && k !== 'Home' && k !== 'End') return
    const box = searchRef.current
    const t = e.target
    const fromBox = !!box && t === box
    const onItem = !!t && t.getAttribute && t.getAttribute('data-library-nav') === 'true'
    if (!fromBox && !onItem) return
    if (fromBox && k !== 'ArrowDown') return   // Home / End / ↑ keep the caret's own keys
    const items = Array.from(bodyRef.current?.querySelectorAll('[data-library-nav="true"]') || [])
    if (!items.length) return
    let next = null
    if (fromBox) next = items[0]
    else if (k === 'Home') next = items[0]
    else if (k === 'End') next = items[items.length - 1]
    else {
      const at = items.indexOf(t)
      if (k === 'ArrowDown') next = items[Math.min(items.length - 1, at + 1)]
      else next = at <= 0 ? box : items[at - 1]
    }
    if (!next) return
    e.preventDefault()
    // ⚰️ MEASURED ON THE REAL SCREEN (2026-11-08, 1440×900, "rs"): scrolling the
    // focused BUTTON into view is not enough. The button is only the title line;
    // the ring and the description belong to the ROW around it, so ↓ onto a row
    // whose title had just scrolled into view left its lower half and the bottom
    // of the ring clipped under the sheet's edge. One more ↓ then hit a button
    // that was wholly out of view, and the browser's own focus scroll CENTRED it,
    // jumping the list ~400 px. So: focus without the browser's scroll, then
    // bring the whole row (or the hint row) into view by the smallest move.
    try { next.focus({ preventScroll: true }) } catch { next.focus() }
    const frame = next.closest?.('li, [data-testid="library-search-hint"]') || next
    try { frame.scrollIntoView?.({ block: 'nearest' }) } catch { /* jsdom */ }
  }, [])

  /** One heading and its rows — shared by the indicator half and the discovery half. */
  const renderGroup = (category) => (
    <section key={category} className={styles.group}>
      <h3 className={styles.groupHead}>{category}</h3>
      <ul className={styles.list} aria-label={category}>
        {rows.filter((r) => r.category === category).map((row) => {
          // ⛔ A SYMBOL IS NEVER "ALREADY ON" — `isRowOn` answers per
          // DEFINITION and a symbol row's id is a ticker. Three QQQ series on
          // one chart is legitimate (§32), so the row keeps offering.
          // ⭐ AND SO IS A RESTORE ROW — `discoveryCatalog.libraryRowFor`.
          const creates = symbolRows.byKey.has(row.key) || row.restores === true
          const vis = creates ? null : rowVisibility(row, settings)
          const on = !!vis && vis.state === 'shown'
          const hiddenRow = !!vis && vis.state === 'hidden'
          return (
            /* ⛔⛔ THE ROW IS NOT A CONTROL; ITS TITLE LINE IS. This `<li>`
               was a `role="option"` with `tabIndex={0}`, and an ON row
               carries "+ Add another" — a focusable control nested inside an
               interactive one (axe `nested-interactive`, measured on
               `movingAverage`, the one row on a default chart). An option
               cannot hold a button, so the list is a plain list: the toggle
               is the real `<button aria-pressed>` round the title line, its
               click BUBBLES to this `onClick` (one writer for pointer and
               keyboard), and "+ Add another" is its sibling. */
            <li
              key={row.key || row.id}
              data-def-id={row.id}
              data-result-kind={row.kind || undefined}
              /* ⭐ THE PROVENANCE, ON THE ROW ITSELF. A member's formula is
                 a different KIND of thing from a shipped indicator — they
                 wrote it, only they have it, and it is theirs to delete —
                 so it is marked structurally (this attribute + the class
                 below + the pill) rather than only by which heading it
                 happens to sit under. */
              data-user-defined={row.userDefined ? 'true' : 'false'}
              className={`${styles.row} ${on ? styles.rowOn : ''} ${row.userDefined ? styles.rowMine : ''}`}
              onClick={() => toggle(row)}
            >
              <span className={styles.check} aria-hidden="true"
                title={vis && vis.partial ? `${vis.visible} of ${vis.live} shown` : undefined}>
                {on ? (vis.partial ? '✓◐' : '✓') : hiddenRow ? '○' : ''}
              </span>
              <span className={styles.main}>
                {/* ⭐ THE KEYBOARD DOOR. No handler of its own: Enter and
                    Space click a native button and the click bubbles to the
                    row. `aria-pressed` is the state `aria-selected` used to
                    carry; the description is named by reference. */}
                <button
                  type="button"
                  className={`${styles.titleRow} ${styles.primary}`}
                  data-result-primary="true"
                  data-library-nav="true"
                  /* ⭐ ENTER ADDS ON THE KEYDOWN, ONCE (2026-11-08). The native
                     button turns Enter into a click that bubbles to the row; doing
                     it here instead (and cancelling that click) makes a held key
                     one add rather than an auto-repeating toggle, and leaves no
                     gap between the key and the write for a re-layout to fall
                     into. Space keeps the native click. */
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    if (!e.repeat) toggle(row)
                  }}
                  aria-pressed={on}
                  aria-describedby={row.description ? blurbId(row) : undefined}
                >
                  {/* The LONG name here — `meta.name`. Menus, region titles
                      and compact strips take `shortName`; this surface and
                      the generated settings rows take the full one. */}
                  <span className={styles.name}>{row.name}</span>
                  {/* ⛔ VISIBLE, NOT SPOKEN, ONLY WHEN THE NAME ALREADY SAYS IT
                      word for word ("Parabolic SAR SAR"); see `shortTag.js`.
                      Any other tag (ADX, RSI) is visible text and stays in
                      the accessible name: WCAG 2.5.3 Label in Name. */}
                  <span className={styles.chip}
                    aria-hidden={tagRestatesName(row.name, row.shortName) ? 'true' : undefined}>{row.shortName}</span>
                  {/* ⭐ NAMED, NOT JUST TINTED. A colour alone is not a
                      distinction for a member who cannot see it, and the
                      heading scrolls out of view on a long list. */}
                  {row.userDefined && <span className={styles.mine}>Your formula</span>}
                  {hiddenRow && <span className={styles.pill} data-testid="row-hidden">Hidden</span>}
                  {row.sessionOnly && <span className={styles.pill}>Intraday only</span>}
                  {/* ⭐⭐ THE LINTER'S MEASUREMENT, PER PLOT — never the
                      definition's declared badge. See `repaintNotice`. */}
                  {repaintNotice(row)}
                  {/* Tier is shown only when it is NOT free: a free row
                      carries no badge, which is why the test asserts its
                      ABSENCE on a free definition rather than its text.

                      ⛔ AND NEVER ON THE MEMBER'S OWN FORMULA. A custom
                      indicator IS premium-tier, so this badge was true and
                      still wrong: beside "Your formula", on a row the member
                      wrote themselves and already has on their chart, the
                      word "Premium" reads as "you cannot use this". A tier
                      badge is an offer to someone who does not have it, not
                      a label on something you already own. */}
                  {row.tier && row.tier !== 'free' && !row.userDefined && (
                    <span className={styles.tier}>{row.tier}</span>
                  )}
                </button>
                {row.description && <span className={styles.blurb} id={blurbId(row)}>{row.description}</span>}
              </span>
              {/* ⛔ ONLY ON A ROW THAT IS ON, AND NEVER ON THE CARVED-OUT ONE.
                  `volumeProfile` has no definition, so `addInstance` returns
                  the settings BY IDENTITY for it and the button would be a
                  live control that writes nowhere — the exact defect this
                  phase retires. A second volume profile is not a thing the
                  canvas overlay can draw anyway. */}
              {on && !row.carvedOut && !row.singleton && (
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
  )

  if (!open) return null

  return (
    <Sheet open={open} onClose={onClose} variant="auto" title="Indicators" ariaLabel="Indicator library" maxWidth={640} className={sheetClassName}>
      {/* The portal exemption. See the header. */}
      <div className={styles.body} ref={bodyRef} onKeyDown={onLibraryKeys} {...{ [PORTAL_POPUP_ATTR]: 'indicator-library' }}>
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
        {/* ⭐ THE BUILDER'S DOOR ON `/charts`. Full width and directly under the
            search rather than beside it: at 375px a search field and a labelled
            button sharing one row leaves neither usable, and this reads as the
            way OUT of the catalogue ("none of these — write one") which is what
            it is. It is NOT filtered by `query`: a member who searched and found
            nothing is exactly the member who needs it, so it must not vanish
            with the rows. */}
        {onCreateFormula && (
          <button
            type="button"
            className={styles.createRow}
            data-testid="library-new-formula"
            data-guide="indicators.newFormula"
            onClick={() => onCreateFormula()}
          >
            <span className={styles.createPlus} aria-hidden="true">＋</span>
            <span className={styles.createMain}>
              <span className={styles.createName}>New formula</span>
              <span className={styles.createBlurb}>
                Build your own indicator or screen — pick conditions, describe it in
                plain English, or start from one of the firm’s setups.
              </span>
            </span>
            <span className={styles.createArrow} aria-hidden="true">→</span>
          </button>
        )}
        {rows.length === 0 && refusals.length === 0 && (
          <div className={styles.empty}>
            {/* ⚠️ A REQUEST IN FLIGHT IS NOT A FINISHED ANSWER, AND BOTH FACTS GO IN
                ONE SENTENCE. Replacing the line with a bare "Searching…" hid the
                only thing this box is for — saying that the local catalogue has
                nothing — and left a member staring at a spinner-word when their
                query was never going to match anything. Saying "nothing yet, still
                looking" is true at every moment of the round trip. */}
            {symbolsLoading
              ? `Nothing matches “${query}” yet — still searching symbols…`
              : `Nothing matches “${query}”.`}
          </div>
        )}
        {indicatorGroups.map(renderGroup)}
        {/* ⭐ THE HINT ROW SITS UNDER THE INDICATOR RESULTS AND ABOVE ANY SYMBOL
            RESULTS: it is a note about the indicators, so it must not end up
            below a dozen tickers (2026-11-08). */}
        {searchHint && renderSearchHint(searchHint, settings, toggle)}
        {discoveryGroups.map(renderGroup)}
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

/**
 * ⭐ THE SEARCH HINT ROW (Phase 4, unit 4-03): the definition's own `line`, and
 * one button that calls the dialog's `toggle` for the hinted row — the same door
 * a click on the row itself uses. The label is `cta`, or "Add <meta.name>"; it
 * never hard-codes an indicator.
 *
 * ⛔ THE BUTTON FOLLOWS THE ROW'S STATE. `toggle` on a SHOWN row hides it, so an
 * "Add" button there would take the indicator off the chart. Shown ⇒ no button,
 * a plain note instead; hidden ⇒ "Show <name>", which is what the toggle does.
 */
function renderSearchHint({ row, def, hint }, settings, toggle) {
  const name = (def && def.meta && def.meta.name) || row.name
  const state = rowVisibility(row, settings).state
  return (
    <div className={styles.hintRow} data-testid="library-search-hint" data-def-id={row.id}>
      <span className={styles.hintLine}>{hint.line}</span>
      {state === 'shown' ? (
        <span className={styles.hintOn} data-testid="library-search-hint-on">{name} is already on this chart.</span>
      ) : (
        <button
          type="button"
          className={styles.hintButton}
          data-testid="library-search-hint-add"
          data-library-nav="true"
          onClick={() => toggle(row)}
        >{state === 'hidden' ? `Show ${name}` : (hint.cta || `Add ${name}`)}</button>
      )}
    </div>
  )
}

/** `preview-repaints` → `Preview-repaints`. The LINTER's vocabulary is the
 *  authority (`ast/lint.REPAINT_MODES`); this only cases it for display. */
export function labelForRepaint(value) {
  const s = String(value)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * 🔴 THE ROW'S REPAINT BADGE — THE LINTER'S MEASUREMENT, PER PLOT.
 *
 * ⚰️ WHAT THIS REPLACED, AND WHY THAT WAS A DEFECT RATHER THAN A STYLE. The row
 * used to render `row.repaint` — `meta.repaint`, the definition's own DECLARED
 * claim. Measured (decision record §1): `nativeRegistry.nativeDef` writes
 * `repaint: 'non-repainting'` in ONE shared helper before the `...meta` spread,
 * so all seventeen definitions inherit it and no definition overrides it. It was
 * a uniform column, which is indistinguishable from an unset one — and on
 * `ichimoku` it was worse than uniform, it was FALSE: `computeIchimoku` writes
 * bar `i`'s close to index `i - kijunPeriod`, so a plotted point at a historical
 * index moves while the newest bar forms, which is spec §4's own definition of
 * repainting. This surface was printing that claim to a member as a fact.
 *
 * `5387d97e` built the machinery and the owner took the call: **accept the
 * machine linter's reading.** So the badge is `engine/repaintVerdict`'s
 * `definitionRollUp` — DERIVED from `ast/lint.lintDefinition` on every read,
 * stored nowhere, and unspellable by an author (`defSchema` refuses a
 * `plots[].repaint` by name, and `validateAstLane` refuses a `meta.repaint` that
 * disagrees with the tree in BOTH directions).
 *
 * ⛔ AND IT NAMES THE PLOTS, WHICH IS THE WHOLE RULING. `ichimoku` draws five
 * columns and exactly one — `chikou` — carries the verdict; Tenkan, Kijun,
 * Span A and Span B genuinely do not repaint. A badge that said only *"Ichimoku
 * repaints"* would slander four honest columns, trading a false "safe" for a
 * false "unsafe" — the second of the three moves record §4.1 refused.
 *
 * ⚠️ SILENCE IS "NO OPINION OR CLEAN", AND IT IS NEVER RENDERED AS A GREEN TICK.
 * Sixteen definitions are hand-written computes spec §11 forbids analysing, so
 * `definitionRollUp` answers `null` for them; a formula the linter reads and
 * finds clean answers `CLEAN`. Both show NOTHING, because *"a badge that every
 * indicator wears carries no information"* — and because painting an undecidable
 * plot green would write *"the linter agreed"* over silence, which is the one
 * sentence obligation 8 exists to make impossible.
 */
function repaintNotice(row) {
  const mode = row.measuredRepaint
  if (!mode || mode === CLEAN) return null
  const notices = row.repaintingPlots || []
  return (
    <span
      className={styles.badgeRepaint}
      data-repaint={mode}
      data-repaint-plots={notices.map((n) => n.plotKey).join(' ')}
      /* The linter's own settling sentence, per plot, untouched. */
      title={notices.map((n) => `${n.label} — ${withoutGuardIds(n.sentence)}`).join(' ')}
    >{labelForRepaint(mode)}{notices.length ? ` — ${notices.map((n) => n.label).join(', ')}` : ''}</span>
  )
}
