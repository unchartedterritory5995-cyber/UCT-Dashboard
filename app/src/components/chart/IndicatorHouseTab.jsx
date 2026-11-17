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
// ⛔ INSTALLING MAKES THE MEMBER'S OWN COPY, through the same save door their own indicators
// use (`saveUserDefinition`, a new id). It then lives under "Your indicators": theirs to rename,
// change in Create Indicator, or delete. Nothing here is a second kind of indicator.
//
// ⚠️ THE SET IS LOADED ON OPEN (`house/houseIndicators.json`, about 90 KB): it is not part of
// the first-open bytes of any page.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { saveUserDefinition } from '../../hooks/useUserDefinitions'
import ownStyles from './IndicatorMembersTab.module.css'

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

const loadHouseSet = () => import('./house/houseIndicators.json').then((m) => (m.default || m).indicators || [])

/**
 * @param {object} p
 * @param {object} [p.styles]   the host's class map (the Indicators window passes its own)
 * @param {string} [p.query]    the host's search box
 * @param {(defId: string) => boolean} p.isOnOffer    has the installed copy reached the chart's registry
 * @param {(defId: string) => boolean} p.onPutOnChart add the installed copy to this chart
 * @param {Function} [p.load] / [p.save]  injectable doors (tests)
 */
export default function IndicatorHouseTab({
  styles = ownStyles, query = '', isOnOffer = () => false, onPutOnChart = () => false,
  load = loadHouseSet, save = saveUserDefinition,
}) {
  const [items, setItems] = useState(null)
  const [failed, setFailed] = useState(false)
  /** slug → 'busy' | {defId} | {error} */
  const [state, setState] = useState({})

  useEffect(() => {
    let live = true
    load().then((list) => { if (live) setItems(Array.isArray(list) ? list : []) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [load])

  const install = useCallback(async (item) => {
    setState((p) => ({ ...p, [item.slug]: 'busy' }))
    // ⛔ A NEW ID EVERY TIME: the copy is the member's own definition, never the house one.
    const r = await save({ ...item.definition, id: mintDefId(), version: 1 }, null)
    if (r && r.ok) {
      setState((p) => ({ ...p, [item.slug]: { defId: (r.row && r.row.def_id) || null } }))
      return
    }
    setState((p) => ({ ...p, [item.slug]: { error: (r && r.error) || 'It could not be installed just now. Try again.' } }))
  }, [save])

  const shown = useMemo(() => (items || []).filter((it) => houseMatches(it, query)), [items, query])

  if (failed) {
    return <div className={styles.indEmpty} data-testid="house-error" role="alert">UCT's indicators could not be loaded. Close this window and open it again.</div>
  }
  if (items === null) {
    return <div className={styles.insSearching} data-testid="house-loading">Loading UCT's indicators…</div>
  }

  return (
    <section className={styles.insAddGroup} data-testid="house-tab">
      <p className={styles.resRefusedLede}>
        Built by UCT and checked bar by bar. Installing one makes your own copy: rename it, change
        it in Create Indicator, or delete it.
      </p>
      {shown.length === 0 ? (
        <div className={styles.indEmpty} data-testid="house-no-match">No UCT indicator matches “{query}”.</div>
      ) : (
        <ul className={styles.resList} aria-label="UCT indicators" data-testid="house-entries">
          {shown.map((it) => {
            const st = state[it.slug]
            const done = st && typeof st === 'object' && 'defId' in st
            const ready = done && st.defId && isOnOffer(st.defId)
            return (
              <li key={it.slug} className={`${styles.resRow} ${styles.resRefused}`} data-testid="house-entry" data-slug={it.slug}>
                <span className={`${styles.resMain} ${styles.resMainStacked}`}>
                  <span className={styles.resTitleRow} style={{ cursor: 'default' }}>
                    <span className={styles.resName} style={{ color: 'inherit' }}>{it.name}</span>
                  </span>
                  <span className={styles.resSub} style={{ whiteSpace: 'normal' }}>{it.summary}</span>
                  {done ? (
                    <span className={styles.resMeta} data-testid="house-installed-note" role="status">
                      Installed. Your copy is under “Your indicators”.
                    </span>
                  ) : null}
                  {st && st.error ? (
                    <span className={styles.resRefusedWhy} data-testid="house-install-error" role="alert">{st.error}</span>
                  ) : null}
                </span>
                <span className={styles.resActions}>
                  {done ? (
                    <button type="button" className={styles.resAction} data-testid="house-put-on-chart"
                      disabled={!ready} title={ready ? 'Add your copy to this chart' : 'Your copy is being prepared'}
                      onClick={() => onPutOnChart(st.defId)}>Put it on this chart</button>
                  ) : (
                    <button type="button" className={styles.resAction} data-testid="house-install"
                      disabled={st === 'busy'} onClick={() => install(it)}>
                      {st === 'busy' ? 'Installing…' : 'Install'}
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
