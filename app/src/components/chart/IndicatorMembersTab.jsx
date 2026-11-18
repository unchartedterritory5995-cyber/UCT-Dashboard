// app/src/components/chart/IndicatorMembersTab.jsx
//
// ─── ⭐ MEMBERS: WHAT OTHER MEMBERS PUBLISHED, INSIDE THE INDICATORS WINDOW ───
//
// The published library lived on a page of its own (`/formulas/library`). A member
// looking for an indicator was in this window, on a chart, and had to leave both to
// find one somebody else had already built. This tab shows the same library here.
//
// ⛔ NOTHING HERE IS A SECOND WAY IN. The list is `fetchDefinitionLibrary` and the
// install is `installSharedDefinition`: the doors the page uses, with the same
// refusal reasons and the same advice (`shareRefusal.WHAT_TO_DO`). Installing makes
// the member's OWN copy; it then appears under "Your indicators" like anything
// else they saved. The page stays, for links.
//
// ⛔ NO AUTHOR, as on the page: the server does not send one.
//
// ⛔ THE EMPTY STATE NEVER SAYS "PUBLISH YOURS". A member who came to find an
// indicator is not helped by being asked to supply one.

import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { fetchDefinitionLibrary, installSharedDefinition, moderateListing } from '../../hooks/useUserDefinitions'
import { AuthContext } from '../../context/AuthContext'
import { WHAT_TO_DO } from '../../pages/formulas/shareRefusal'
import { sharedVerdict } from '../../pages/formulas/sharedVerdict'
import { loadLine } from '../../pages/formulas/loadWords'
import ownStyles from './IndicatorMembersTab.module.css'

/** The engine's three repaint verdicts in a chooser's words (the page's own map). */
export const REPAINT_WORDS = Object.freeze({
  'non-repainting': 'never repaints',
  'preview-repaints': 'repaints while the bar forms',
  repaints: 'repaints',
})

/** The facts a member chooses by, in one line. */
export function factsOf(entry) {
  const out = []
  if (entry.repaint) out.push(REPAINT_WORDS[entry.repaint] || entry.repaint)
  if (entry.placement) out.push(entry.placement)
  if (entry.inputs > 0) out.push(`${entry.inputs} ${entry.inputs === 1 ? 'setting' : 'settings'}`)
  return out.join(', ')
}

/** The closed reasons UCT gives for a takedown (the server's `TAKEDOWN_REASONS`), in words. */
export const TAKEDOWN_REASONS = Object.freeze([
  ['licence', 'Not theirs to share'],
  ['misleading', 'Misleading'],
  ['broken', 'Does not work'],
  ['abuse', 'Abuse'],
  ['other', 'Other'],
])

/**
 * UCT's takedown, for an ADMIN only (the server refuses anyone else). A reason from the
 * closed set, then one press. Exported so the library page uses the same control.
 */
export function TakedownControl({ token, styles, onDone, moderate = moderateListing }) {
  const [reason, setReason] = useState('other')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const go = async () => {
    setBusy(true); setError('')
    const r = await moderate(token, { down: true, reason })
    setBusy(false)
    if (r.ok) onDone?.(token)
    else setError(r.error)
  }
  return (
    <span className={styles.resMeta} data-testid="members-takedown">
      UCT:{' '}
      <select aria-label="Reason to take it down" value={reason} disabled={busy}
        data-testid="members-takedown-reason" onChange={(e) => setReason(e.target.value)}>
        {TAKEDOWN_REASONS.map(([k, w]) => <option key={k} value={k}>{w}</option>)}
      </select>{' '}
      <button type="button" className={styles.resAction} disabled={busy}
        data-testid="members-takedown-go" onClick={go}>{busy ? 'Taking it down…' : 'Take it down'}</button>
      {error ? <span className={styles.resRefusedWhy} role="alert"> {error}</span> : null}
    </span>
  )
}

/** Does this entry match what is typed? Name, short name and description; any case. */
export function entryMatches(entry, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  return [entry.name, entry.shortName, entry.description]
    .some((v) => typeof v === 'string' && v.toLowerCase().includes(q))
}

/**
 * @param {object} p
 * @param {object} [p.styles]          the host's class map, so the list looks like its surroundings
 *                                     (the Indicators window passes its own). Without one it uses
 *                                     `IndicatorMembersTab.module.css`, sized for touch.
 * @param {string} [p.query]           the window's search box
 * @param {(defId: string) => boolean} p.isOnOffer  has the installed copy reached the chart's registry yet
 * @param {(defId: string) => boolean} p.onPutOnChart  add the installed copy to this chart
 * @param {Function} [p.fetchLibrary] / [p.install]  injectable doors (tests)
 */
export default function IndicatorMembersTab({
  styles = ownStyles, query = '', isOnOffer = () => false, onPutOnChart = () => false,
  fetchLibrary = fetchDefinitionLibrary, install = installSharedDefinition, moderate = moderateListing,
}) {
  // ⛔ READ WITHOUT `useAuth`, which throws outside the provider: a host mounted without
  // one (a test, an embed) simply shows no admin control.
  const auth = useContext(AuthContext)
  const isAdmin = !!(auth && auth.user && auth.user.role === 'admin')
  const [entries, setEntries] = useState([])
  const [next, setNext] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /** token → 'busy' | {defId} | {error, todo} */
  const [state, setState] = useState({})

  const load = useCallback(async (after) => {
    setLoading(true)
    const r = await fetchLibrary(after ? { after } : {})
    setLoading(false)
    if (!r.ok) { setError(r.error); return }
    setError('')
    // Append on a further page, replace on a first load.
    setEntries((prev) => (after ? [...prev, ...r.entries] : r.entries))
    setNext(r.next)
  }, [fetchLibrary])

  useEffect(() => { load(null) }, [load])

  const installOne = useCallback(async (token) => {
    setState((p) => ({ ...p, [token]: 'busy' }))
    const r = await install(token)
    if (r.ok) {
      const defId = (r.row && (r.row.def_id || (r.row.definition && r.row.definition.id))) || null
      // ⭐ R4: the install's row carries the saved version's verdict; kept to say it once, on install
      const verdict = sharedVerdict(r.row)
      setState((p) => ({ ...p, [token]: { defId, verdict: verdict ? verdict.headline : null } }))
      return
    }
    setState((p) => ({ ...p, [token]: { error: r.error, todo: WHAT_TO_DO[r.reason] || null } }))
  }, [install])

  const shown = useMemo(() => entries.filter((e) => entryMatches(e, query)), [entries, query])

  if (error && entries.length === 0) {
    return (
      <div className={styles.insUnavailable} data-testid="members-error" role="alert">
        <div className={styles.insUnavailableLede}>Members' indicators could not be loaded.</div>
        <p className={styles.insUnavailableWhy}>{error}</p>
        <button type="button" className={styles.resAction} data-testid="members-retry" onClick={() => load(null)}>Try again</button>
      </div>
    )
  }
  if (loading && entries.length === 0) {
    return <div className={styles.insSearching} data-testid="members-loading">Loading members' indicators…</div>
  }
  if (entries.length === 0) {
    return (
      <div className={styles.indEmpty} data-testid="members-empty">
        No member has published an indicator yet.
      </div>
    )
  }

  return (
    <section className={styles.insAddGroup} data-testid="members-tab">
      <p className={styles.resRefusedLede}>
        Indicators other members chose to publish. Installing one makes your own copy: you can
        change it freely, and your changes never reach theirs.
      </p>
      {shown.length === 0 ? (
        <div className={styles.indEmpty} data-testid="members-no-match">
          No published indicator matches “{query}”{next ? ' among those loaded so far' : ''}.
        </div>
      ) : (
        <ul className={styles.resList} aria-label="Members' indicators" data-testid="members-entries">
          {shown.map((e) => {
            const st = state[e.token]
            const done = st && typeof st === 'object' && 'defId' in st
            const ready = done && st.defId && isOnOffer(st.defId)
            const facts = factsOf(e)
            return (
              <li key={e.token} className={`${styles.resRow} ${styles.resRefused}`} data-testid="members-entry" data-token={e.token}>
                <span className={`${styles.resMain} ${styles.resMainStacked}`}>
                  <span className={styles.resTitleRow} style={{ cursor: 'default' }}>
                    <span className={styles.resName} style={{ color: 'inherit' }}>{e.name}</span>
                    {e.shortName ? <span className={styles.resShort}>{e.shortName}</span> : null}
                  </span>
                  {e.description ? <span className={styles.resSub}>{e.description}</span> : null}
                  {facts ? <span className={styles.resMeta} data-testid="members-entry-facts">{facts}</span> : null}
                  {/* ⭐ R4: the author's verdict for the listed version, when the listing carries it */}
                  {sharedVerdict(e) ? (
                    <span className={styles.resMeta} data-testid="members-entry-verdict">{sharedVerdict(e).sentence}</span>
                  ) : null}
                  {/* ⭐ R6: how heavy the listed version is to draw, as the server measured it */}
                  {loadLine(e.load) ? (
                    <span className={styles.resMeta} data-testid="members-entry-load" data-load={loadLine(e.load).code}>{loadLine(e.load).text}</span>
                  ) : null}
                  {e.licence ? (
                    <span className={styles.resMeta} data-testid="members-entry-licence">
                      Licence, from its original script: {e.licence}
                    </span>
                  ) : null}
                  {isAdmin ? (
                    <TakedownControl token={e.token} styles={styles} moderate={moderate}
                      onDone={(t) => setEntries((prev) => prev.filter((x) => x.token !== t))} />
                  ) : null}
                  {done ? (
                    <span className={styles.resMeta} data-testid="members-installed-note" role="status">
                      Installed{st.verdict ? `: ${st.verdict}` : ''}. Your copy is under “Your indicators”.
                    </span>
                  ) : null}
                  {st && st.error ? (
                    <span className={styles.resRefusedWhy} data-testid="members-install-error" role="alert">
                      {st.error}{st.todo ? ` ${st.todo}` : ''}
                    </span>
                  ) : null}
                </span>
                <span className={styles.resActions}>
                  {done ? (
                    <button type="button" className={styles.resAction} data-testid="members-put-on-chart"
                      disabled={!ready}
                      title={ready ? 'Add your copy to this chart' : 'Your copy is being prepared'}
                      onClick={() => onPutOnChart(st.defId)}>Put it on this chart</button>
                  ) : (
                    <button type="button" className={styles.resAction} data-testid="members-install"
                      disabled={st === 'busy'} onClick={() => installOne(e.token)}>
                      {st === 'busy' ? 'Installing…' : 'Install'}
                    </button>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {error ? <p className={styles.resRefusedWhy} role="alert" data-testid="members-more-error">{error}</p> : null}
      {next ? (
        <div style={{ padding: '10px 4px' }}>
          <button type="button" className={styles.resAction} data-testid="members-more"
            disabled={loading} onClick={() => load(next)}>{loading ? 'Loading…' : 'Show more'}</button>
        </div>
      ) : null}
    </section>
  )
}
