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
//
// ⚠️ THE SET IS LOADED ON OPEN (`house/houseIndicators.json`): it is not part of the first-open
// bytes of any page.

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
  const fn = item && item.definition && item.definition.compute && item.definition.compute.fn
  if (typeof fn !== 'string' || !fn) return null
  const hit = (Array.isArray(own) ? own : []).find((d) => d && d.compute && d.compute.fn === fn && typeof d.id === 'string')
  return hit ? hit.id : null
}

const loadHouseSet = () => import('./house/houseIndicators.json').then((m) => (m.default || m).indicators || [])
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
  listOwn = NONE, load = loadHouseSet, save = saveUserDefinition, addWaitMs = ADD_WAIT_MS,
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
    // ⛔ A NEW ID EVERY TIME: the copy is the member's own definition, never the house one.
    const r = await save({ ...item.definition, id: mintDefId(), version: 1 }, null)
    if (!live.current) return
    if (r && r.ok) {
      const defId = (r.row && r.row.def_id) || null
      setState((p) => ({ ...p, [item.slug]: defId ? { defId, adding: Date.now() } : { error: 'It was saved, but could not be added to this chart. It is under “Your indicators”.' } }))
      return
    }
    setState((p) => ({ ...p, [item.slug]: { error: (r && r.error) || 'It could not be added just now. Try again.' } }))
  }, [save, listOwn, isOnOffer, put])

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

  if (failed) {
    return <div className={styles.indEmpty} data-testid="house-error" role="alert">UCT's indicators could not be loaded. Close this window and open it again.</div>
  }
  if (items === null) {
    return <div className={styles.insSearching} data-testid="house-loading">Loading UCT's indicators…</div>
  }

  return (
    <section className={styles.insAddGroup} data-testid="house-tab">
      <p className={styles.resRefusedLede}>
        Built by UCT and checked bar by bar. Adding one puts your own copy on this chart: rename it,
        change it in Create Indicator, or delete it.
      </p>
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
