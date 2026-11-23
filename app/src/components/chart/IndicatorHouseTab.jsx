// app/src/components/chart/IndicatorHouseTab.jsx
//
// ─── ⭐ UCT: THE HOUSE SET, INSIDE THE INDICATORS WINDOW ──────────────────────
//
// The indicators traders build first, already built: a distribution day count, the relative
// strength line, extension in ATRs, tight weekly closes and the rest. Each one was made by
// describing it to Create Indicator, and is here only because (a) its formula says what the
// description asked and (b) every value it draws was checked against an independent
// calculation on real bars (2026-11-16) and is held to one by `tests/test_house_indicators_values.py`.
//
// ⛔ ADDING ONE MAKES THE MEMBER'S OWN COPY, through the same save door their own indicators
// use (`saveUserDefinition`, a new id). It then lives under "Your indicators": theirs to rename,
// change in Create Indicator, or delete. Nothing here is a second kind of indicator.
//
// ⭐ ONE PRESS (2026-11-17). "Add to chart" saves the copy and puts it on the chart as soon as
// the chart knows it; it was two presses and a wait (Install, then Put it on this chart). A
// member who already holds an unchanged copy gets THAT copy, not a second one: the copy is
// recognised by its maths (`compute.fn`, which the store keeps as saved; checked on production).
// A copy the member has since changed is their own indicator now, and adding makes a new copy.
// ⭐ 2026-11-18 — ITS WHOLE MATHS: `compute.fn` is the FIRST line's formula only, so it could not
// tell "Relative Strength vs SPY" from "RS New High vs SPY" (one ratio, different marks: a member
// holding one got it again when adding the other), nor version 1 of a house indicator from
// version 2 when only a later line changed. `compute.treesHash` (every line; the store holds it
// to its trees) is compared too.
//
// ⚠️ THE SET IS LOADED ON OPEN (`house/houseIndicators.json`): it is not part of the first-open
// bytes of any page.
//
// ⭐⭐ FRED RS (2026-11-18, owner): the house set also ships PINE scripts (`house/housePineIndicators.json`),
// third-party TradingView scripts whose own source carries an explicit open licence (docs/pine/LICENSING.md),
// byte for byte, so every parity proof keyed to the script's sha256 holds for the member's copy. Adding one
// builds the copy through the SAME steps a pasted script takes in Create Indicator (`memberPaneDefinition`,
// the engine stamp, the registry's validation) and saves the script beside it (`pineSource`), licence notice
// included. The first is Fred6724's RS Rating, named "Fred RS". The build happens on the press, never on open
// (a translation is a quarter second).
// ⭐ A PINE COPY IS RECOGNISED BY ITS SCRIPT, NOT ITS MATHS (patrick-0b, 2026-11-18): the maths a script
// translates to moves with the engine, its bytes do not. On the press, the member's own SCRIPT documents that
// could be this one (the same maths now, the same name, or the same other-symbol reads) have their stored
// script fetched (`GET /api/user-definitions/<id>?source=true`, at most `PINE_PROBE_MAX`), and only a copy
// whose script is this entry's BYTE FOR BYTE is reused. A copy whose script the member changed is theirs; a
// fetch that fails reuses nothing (a second copy is harmless, a wrong one is not).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { saveUserDefinition } from '../../hooks/useUserDefinitions'
import ownStyles from './IndicatorMembersTab.module.css'

/** How long a saved copy may take to reach the chart before the row offers the button instead. */
export const ADD_WAIT_MS = 8000

/** A NEW definition id in the store's own shape (`u_` + 12 hex), as the builder mints one.
 *  Named `mint`, not `fresh`: the one-freshness rail (rails/oneKey.census) reads a `fresh` name
 *  segment as a function that judges BAR freshness, and this one judges nothing. */
export function mintDefId() {
  const bytes = new Uint8Array(6)
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return `u_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** Does this house indicator match what is typed? Name and summary; any case. */
export function houseMatches(item, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  return [item.name, item.summary].some((v) => typeof v === 'string' && v.toLowerCase().includes(q))
}

/** The member's own UNCHANGED copy of a house indicator, by its maths; `null` when they have none. */
export function ownCopyId(item, own) {
  const compute = item && item.definition && item.definition.compute
  const fn = compute && compute.fn
  if (typeof fn !== 'string' || !fn) return null
  const all = wholeMaths(compute)
  const hit = (Array.isArray(own) ? own : []).find((d) => d && d.compute && d.compute.fn === fn
    && wholeMaths(d.compute) === all && typeof d.id === 'string')
  return hit ? hit.id : null
}

/** Every line's formula as one fingerprint, or '' for an indicator of one formula (no `trees`). */
const wholeMaths = (compute) => (compute && typeof compute.treesHash === 'string' ? compute.treesHash : '')

const listOf = (m) => (m.default || m).indicators || []
/** The whole set, Pine entries first (Fred RS leads the tab). */
export const loadHouseSet = () => Promise.all([import('./house/housePineIndicators.json'), import('./house/houseIndicators.json')])
  .then(([pine, formulas]) => [...listOf(pine), ...listOf(formulas)])

/** How many of the member's script documents one press may ask the store about. */
export const PINE_PROBE_MAX = 5

/** The stored Pine script of the member's definition `defId`, or null (absent, refused or unreachable). */
export async function fetchStoredScript(defId) {
  try {
    const r = await fetch(`/api/user-definitions/${encodeURIComponent(defId)}?source=true`, { credentials: 'include', cache: 'no-store' })
    if (!r.ok) return null
    const row = await r.json()   // the store row, flat: `pine_source` beside `definition` (`svc.get(with_source=True)`)
    return row && typeof row.pine_source === 'string' ? row.pine_source : null
  } catch {
    return null
  }
}

/** The member's own copy of a Pine house entry whose stored script IS the entry's, byte for byte; null when none.
 *  `built` is the fresh copy (its maths and reads narrow which documents are asked about); `own` the member's
 *  installed definitions; `fetchScript(defId)` the store's answer. */
export async function ownScriptCopyId(item, built, own, fetchScript = fetchStoredScript) {
  const doc = built || {}
  const fn = doc.compute && doc.compute.fn
  const trees = doc.compute && doc.compute.treesHash
  const reads = JSON.stringify((doc.meta && doc.meta.otherSymbols) || null)
  const name = String(item.name || '').trim().toLowerCase()
  // the strongest guesses first (patrick-0b): the same maths now, then the same name, then the same reads; the
  // cap only ever cuts the weakest (six scripts reading SPX must not crowd the true copy out of the probe)
  const rank = (d) => ((d.compute.fn === fn && d.compute.treesHash === trees) ? 0
    : String(d.meta.name || '').trim().toLowerCase() === name ? 1
      : (reads !== 'null' && JSON.stringify(d.meta.otherSymbols || null) === reads) ? 2 : 3)
  const candidates = (Array.isArray(own) ? own : []).filter((d) => d && typeof d.id === 'string' && d.compute && d.meta
    && Number.isInteger(d.meta.engineVersion) && d.meta.scriptEdited !== true)
    .map((d, i) => ({ d, i, r: rank(d) })).filter((x) => x.r < 3)
    .sort((x, y) => x.r - y.r || x.i - y.i).map((x) => x.d)
  for (const d of candidates.slice(0, PINE_PROBE_MAX)) {
    const script = await fetchScript(d.id)
    if (typeof script === 'string' && script === item.pine) return d.id
  }
  return null
}

/** A Pine house entry's copy, built exactly as Create Indicator builds a pasted script: `{doc, options}` to
 *  save, or `{error}`. Loaded on the press, so the tab itself stays light. */
export async function buildPineCopy(item, id) {
  const [{ doorBuildOnce }, { withEngineStamp }, registry] = await Promise.all([
    import('./builder/memberPane/memberDoorAsync'), import('./engine/scriptEngineVersion'), import('./engine/nativeRegistry')])
  // ⭐ THE PASTE WORKER (2026-11-21): built in the member door's worker, never on the page's thread (a long script held
  // the tab for the whole translation on the press); where there are no workers the door builds here, as before
  const landed = await doorBuildOnce({ source: item.pine, id, name: item.name })
  const built = landed && !landed.error ? landed.built : null
  const def = built && built.ok ? built.definition : null
  if (!def || built.saveable === false) return { error: 'It could not be prepared just now. Try again.' }
  // ⛔ a script that repaints needs the member's own acknowledgement, which only Create Indicator asks for
  if (def.meta && def.meta.repaint === 'preview-repaints') return { error: 'This one has to be added from Create Indicator.' }
  const formulaLane = def.compute && def.compute.kind === 'ast'
  const doc = formulaLane ? withEngineStamp(def) : def
  const { defs, errors } = registry.validateUserDefinitions([doc])
  if (errors.length || defs.length !== 1) return { error: 'It could not be prepared just now. Try again.' }
  return { doc, options: formulaLane ? { pineSource: item.pine } : null }
}
const NONE = () => []

/**
 * @param {object} p
 * @param {object} [p.styles]   the host's class map (the Indicators window passes its own)
 * @param {string} [p.query]    the host's search box
 * @param {(defId: string) => boolean} p.isOnOffer    has a copy reached the chart's registry
 * @param {(defId: string) => boolean} p.onPutOnChart add a copy to this chart
 * @param {() => object[]} [p.listOwn]  the member's own installed definitions (to reuse a copy)
 * @param {Function} [p.load] / [p.save]  injectable doors (tests)
 */
export default function IndicatorHouseTab({
  styles = ownStyles, query = '', isOnOffer = () => false, onPutOnChart = () => false,
  listOwn = NONE, load = loadHouseSet, save = saveUserDefinition, addWaitMs = ADD_WAIT_MS, buildPine = buildPineCopy,
  fetchScript = fetchStoredScript, searchOnly = false, onMatches = null,
}) {
  const [items, setItems] = useState(null)
  const [failed, setFailed] = useState(false)
  /** slug → 'busy' | {defId, adding: since} | {defId, added: true} | {defId} | {error} */
  const [state, setState] = useState({})
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])

  useEffect(() => {
    let on = true
    load().then((list) => { if (on) setItems(Array.isArray(list) ? list : []) })
      .catch(() => { if (on) setFailed(true) })
    return () => { on = false }
  }, [load])

  const put = useCallback((slug, defId) => {
    const ok = !!onPutOnChart(defId)
    if (!live.current) return ok
    setState((p) => ({ ...p, [slug]: ok ? { defId, added: true } : { defId } }))
    return ok
  }, [onPutOnChart])

  const add = useCallback(async (item) => {
    // ⭐ a copy the member already holds, unchanged: that one goes on the chart
    const mine = ownCopyId(item, listOwn())
    if (mine && isOnOffer(mine)) { put(item.slug, mine); return }
    setState((p) => ({ ...p, [item.slug]: 'busy' }))
    let r
    if (typeof item.pine === 'string') {
      // ⭐ FRED RS — a Pine entry is built now, as Create Indicator builds a pasted script
      const built = await buildPine(item, mintDefId())
      if (!live.current) return
      if (!built || built.error || !built.doc) {
        setState((p) => ({ ...p, [item.slug]: { error: (built && built.error) || 'It could not be added just now. Try again.' } }))
        return
      }
      const held = await ownScriptCopyId(item, built.doc, listOwn(), fetchScript)
      if (!live.current) return
      if (held && isOnOffer(held)) { put(item.slug, held); return }
      r = await save({ ...built.doc, version: 1 }, null, null, built.options)
    } else {
      // ⛔ A NEW ID EVERY TIME: the copy is the member's own definition, never the house one.
      r = await save({ ...item.definition, id: mintDefId(), version: 1 }, null)
    }
    if (!live.current) return
    if (r && r.ok) {
      const defId = (r.row && r.row.def_id) || null
      setState((p) => ({ ...p, [item.slug]: defId ? { defId, adding: Date.now() } : { error: 'It was saved, but could not be added to this chart. It is under “Your indicators”.' } }))
      return
    }
    setState((p) => ({ ...p, [item.slug]: { error: (r && r.error) || 'It could not be added just now. Try again.' } }))
  }, [save, listOwn, isOnOffer, put, buildPine, fetchScript])

  // ⭐ a saved copy goes on the chart the moment the chart knows it; after `addWaitMs` the row
  // stops waiting and offers the button instead (the copy is saved either way).
  const waiting = Object.entries(state).filter(([, st]) => st && typeof st === 'object' && st.adding)
  useEffect(() => {
    if (!waiting.length) return undefined
    for (const [slug, st] of waiting) if (isOnOffer(st.defId)) put(slug, st.defId)
    const t = setTimeout(() => {
      if (!live.current) return
      setState((p) => {
        const next = { ...p }
        for (const [slug, st] of Object.entries(p)) {
          if (st && typeof st === 'object' && st.adding && Date.now() - st.adding >= addWaitMs) next[slug] = { defId: st.defId }
        }
        return next
      })
    }, Math.max(50, addWaitMs - (Date.now() - Math.min(...waiting.map(([, st]) => st.adding)))))
    return () => clearTimeout(t)
  })

  const shown = useMemo(() => (items || []).filter((it) => houseMatches(it, query)), [items, query])
  const own = listOwn()
  // ⭐ SEARCH-ONLY (2026-11-18, owner: "i still dont see fred's RS indicator as an option"): a search across
  // EVERY tab never reached the UCT set (it is its own file, loaded by this tab only), so typing "Fred" said
  // "Nothing matches". The host now mounts this tab in `searchOnly` mode under its search results: only the
  // matching entries, under a "UCT" heading, nothing at all while loading, on a failed load or with no match,
  // and it tells the host how many matched (`onMatches`) so "Nothing matches" is never said over a match.
  const matched = items === null || failed ? 0 : shown.length
  useEffect(() => { if (typeof onMatches === 'function') onMatches(matched) }, [matched, onMatches])

  if (searchOnly && (failed || items === null || shown.length === 0)) return null
  if (failed) {
    return <div className={styles.indEmpty} data-testid="house-error" role="alert">UCT's indicators could not be loaded. Close this window and open it again.</div>
  }
  if (items === null) {
    return <div className={styles.insSearching} data-testid="house-loading">Loading UCT's indicators…</div>
  }

  return (
    <section className={styles.insAddGroup} data-testid={searchOnly ? 'house-search' : 'house-tab'}>
      {searchOnly ? (
        <div className={styles.insSectionLabel}>UCT</div>
      ) : (
        <p className={styles.resRefusedLede}>
          Chosen by UCT and checked bar by bar. Adding one puts your own copy on this chart: rename it,
          change it in Create Indicator, or delete it.
        </p>
      )}
      {shown.length === 0 ? (
        <div className={styles.indEmpty} data-testid="house-no-match">No UCT indicator matches “{query}”.</div>
      ) : (
        <ul className={styles.resList} aria-label="UCT indicators" data-testid="house-entries">
          {shown.map((it) => {
            const st = state[it.slug]
            const obj = st && typeof st === 'object' ? st : null
            const busy = st === 'busy' || !!(obj && obj.adding)
            const added = !!(obj && obj.added)
            const installedOnly = !!(obj && obj.defId && !obj.adding && !obj.added)
            const ready = installedOnly && isOnOffer(obj.defId)
            const haveIt = !obj && st !== 'busy' && !!ownCopyId(it, own)
            return (
              <li key={it.slug} className={`${styles.resRow} ${styles.resRefused}`} data-testid="house-entry" data-slug={it.slug}>
                <span className={`${styles.resMain} ${styles.resMainStacked}`}>
                  <span className={styles.resTitleRow} style={{ cursor: 'default' }}>
                    <span className={styles.resName} style={{ color: 'inherit' }}>{it.name}</span>
                  </span>
                  <span className={styles.resSub} style={{ whiteSpace: 'normal' }}>{it.summary}</span>
                  {it.attribution ? (
                    <span className={styles.resMeta} data-testid="house-attribution">{it.attribution}</span>
                  ) : null}
                  {haveIt ? (
                    <span className={styles.resMeta} data-testid="house-have-note">You have this one under “Your indicators”.</span>
                  ) : null}
                  {added ? (
                    <span className={styles.resMeta} data-testid="house-added-note" role="status">
                      Added to this chart. Your copy is under “Your indicators”.
                    </span>
                  ) : null}
                  {installedOnly ? (
                    <span className={styles.resMeta} data-testid="house-installed-note" role="status">
                      Saved. Your copy is under “Your indicators”.
                    </span>
                  ) : null}
                  {obj && obj.error ? (
                    <span className={styles.resRefusedWhy} data-testid="house-install-error" role="alert">{obj.error}</span>
                  ) : null}
                </span>
                <span className={styles.resActions}>
                  {installedOnly ? (
                    <button type="button" className={styles.resAction} data-testid="house-put-on-chart"
                      disabled={!ready} title={ready ? 'Add your copy to this chart' : 'Your copy is being prepared'}
                      onClick={() => put(it.slug, obj.defId)}>Put it on this chart</button>
                  ) : (
                    <button type="button" className={styles.resAction} data-testid="house-install"
                      disabled={busy} onClick={() => add(it)}>
                      {busy ? 'Adding…' : (added ? 'Add again' : 'Add to chart')}
                    </button>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
