// app/src/pages/formulas/FormulaLibrary.jsx
//
// ─── ⭐⭐ THE LIBRARY: WHAT OTHER MEMBERS PUBLISHED ──────────────────────────
//
// ⛔⛔ EVERY ENTRY HERE IS ON THIS PAGE BECAUSE ITS OWNER ASKED FOR THAT
// SPECIFICALLY. Sharing a link is a different act with a different button: it
// sends a formula to one person the member chose. The two consents are separate
// tables, separate routes and separate controls, and this page reads only the
// second — so a year of already-minted share links did not become a directory the
// day it shipped.
//
// ⛔ NO AUTHOR IS SHOWN, and that is a decision rather than an omission. Members
// published a formula, not their name. Attribution is additive later and cannot
// be taken back once it has shipped, so the default is the reversible one. The
// server does not send one either — this page could not display it if it wanted.
//
// ⚠️ WHAT AN ENTRY DOES CARRY is what a member needs to CHOOSE it: the name the
// author gave it, whether it repaints, where it draws, and how many knobs it has.
// The install path is the shipped one — the same token, the same
// `previewSharedDefinition` / `installSharedDefinition` doors, the same
// grammar-version refusal. Nothing here is a second way in.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import UIcon from '../../components/ui/UIcon'
import TileCard from '../../components/TileCard'
import {
  fetchDefinitionLibrary, installSharedDefinition,
} from '../../hooks/useUserDefinitions'
import { sharedFormulaPath } from './formulaShareLink'
import { WHAT_TO_DO } from './shareRefusal'
import styles from './FormulaLibrary.module.css'

/** A repaint verdict → what it means to somebody deciding whether to install.
 *
 *  ⛔ THE ENGINE'S OWN THREE VALUES, not a re-description of them. `lint.js`
 *  decides `non-repainting` / `preview-repaints` / `repaints` and the badge here
 *  only translates; inventing a fourth state would be this page disagreeing with
 *  the linter about a formula it did not analyse. An unrecognised value renders
 *  the raw string rather than a guess. */
const REPAINT_LABEL = Object.freeze({
  'non-repainting': 'never repaints',
  'preview-repaints': 'repaints while the bar forms',
  repaints: 'repaints',
})

export default function FormulaLibrary() {
  const [entries, setEntries] = useState([])
  const [next, setNext] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [installed, setInstalled] = useState({})

  const load = useCallback(async (after) => {
    setLoading(true)
    const r = await fetchDefinitionLibrary(after ? { after } : {})
    setLoading(false)
    if (!r.ok) { setError(r.error); return }
    setError('')
    // ⛔ APPEND ON A PAGE, REPLACE ON A FIRST LOAD. Replacing on a page would
    // silently drop everything the member has already scrolled past.
    setEntries((prev) => (after ? [...prev, ...r.entries] : r.entries))
    setNext(r.next)
  }, [])

  useEffect(() => { load(null) }, [load])

  const install = useCallback(async (token) => {
    setInstalled((p) => ({ ...p, [token]: 'busy' }))
    const r = await installSharedDefinition(token)
    if (r.ok) { setInstalled((p) => ({ ...p, [token]: 'done' })); return }
    // ⛔ THE REFUSAL REASON, NOT A FLATTENED SENTENCE. `revoked`, `gone` and
    // `table-version` are different situations and only the last has an action —
    // `WHAT_TO_DO` is the shipped map the share page already reads, so the two
    // surfaces cannot say different things about the same refusal.
    setInstalled((p) => ({
      ...p,
      [token]: { error: r.error, todo: WHAT_TO_DO[r.reason] || null },
    }))
  }, [])

  return (
    <div className={styles.page} data-testid="formula-library">
      <TileCard title="Formula library" icon="book">
        <p className={styles.lead}>
          Formulas other members chose to publish. Installing one makes your own copy —
          {' '}you can edit it freely, and your edits never reach theirs.
        </p>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}

        {!loading && !error && entries.length === 0 ? (
          <p className={styles.empty} data-testid="library-empty">
            {/* ⛔ "NOTHING PUBLISHED YET" IS NOT "SOMETHING WENT WRONG", and the two
                must not share a sentence — an empty library on a working page is
                the honest state on the day this ships. */}
            Nothing has been published yet. Any formula you have built can be the first:
            {' '}open it in the builder and choose “Publish to the library”.
          </p>
        ) : null}

        <ul className={styles.grid} data-testid="library-entries">
          {entries.map((e) => {
            const state = installed[e.token]
            return (
              <li key={e.token} className={styles.card} data-testid={`library-entry-${e.token}`}>
                <div className={styles.cardHead}>
                  <span className={styles.name}>{e.name}</span>
                  {e.shortName ? <span className={styles.short}>{e.shortName}</span> : null}
                </div>
                {e.description ? <p className={styles.desc}>{e.description}</p> : null}
                <div className={styles.facts}>
                  {e.repaint ? (
                    <span className={styles.fact} data-repaint={e.repaint}>
                      {REPAINT_LABEL[e.repaint] || e.repaint}
                    </span>
                  ) : null}
                  {e.placement ? <span className={styles.fact}>{e.placement}</span> : null}
                  {e.inputs > 0 ? (
                    <span className={styles.fact}>
                      {e.inputs} {e.inputs === 1 ? 'setting' : 'settings'}
                    </span>
                  ) : null}
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.install}
                    data-testid={`library-install-${e.token}`}
                    onClick={() => install(e.token)}
                    disabled={state === 'busy' || state === 'done'}
                  >
                    <UIcon name="download" size={13} />
                    {state === 'done' ? 'Installed' : state === 'busy' ? 'Installing…' : 'Install'}
                  </button>
                  {/* ⭐ THE SAME TOKEN, THE SAME PAGE somebody sent a link to.
                      A second preview surface would be a second description of
                      one formula. */}
                  <Link className={styles.preview} to={sharedFormulaPath(e.token)}>Preview</Link>
                </div>
                {state && state.error ? (
                  <p className={styles.error} role="alert">
                    {state.error}{state.todo ? ` ${state.todo}` : ''}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>

        {next ? (
          <button
            type="button"
            className={styles.more}
            data-testid="library-more"
            onClick={() => load(next)}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Show more'}
          </button>
        ) : null}
      </TileCard>
    </div>
  )
}
