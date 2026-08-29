// app/src/pages/formulas/SharedFormula.jsx
//
// ─── 🔴 THE DOOR AT THE FAR END OF A FORMULA SHARE LINK ─────────────────────
//
// `GET /api/user-definitions/shared/{token}` has been served this whole time —
// six routes, an append-only `definition_shares` table, a revoke path, and a
// grammar-version check that refuses a byte-identical copy when the closed table
// has moved under it. A complete public-sharing backend. And **no route rendered
// its answer**: `SharePanel.jsx:31` hand-typed `${origin}/formulas/shared/${token}`
// into the Copy button while `App.jsx`'s route table carried no `/formulas` entry
// at all, so every link any member ever copied out of the builder resolved to the
// catch-all `<Route path="*" element={<NotFound />} />`.
//
// ⛔ THE ONE PATH THAT WORKED IS WHY NOBODY NOTICED. `SharePanel` also ships a
// paste box that pulls the `sh_…` token out of a pasted URL and installs from it,
// and `SharePanel.test.jsx` exercises exactly that. So the feature had a green
// test, a working manual path, and a dead link — the shape this repo has recorded
// as "built, tested, green and unreachable", and the SECOND time it has landed on
// a share link specifically (`pages/screener/SharedScreen.jsx` is the first).
//
// ⛔ THIS PAGE IS OUTSIDE `AuthGuard`, DELIBERATELY, AND FOR A DIFFERENT REASON
// THAN THE SCREENER'S. A shared SCREEN is anonymous by design — its server route
// takes no auth because a filter spec carries no positions and no prices. A
// shared FORMULA is NOT: `api/routers/user_definitions.py:437` gates
// `/shared/{token}` on `require_paid`, so the recipient must be a paying member.
// Routing this page behind `AuthGuard` anyway would bounce a logged-out
// recipient to a login form with no idea what they had been sent. Outside it,
// the page can say what they were sent and what it costs to open — which is the
// difference between a dead link and an invitation.
//
// ⭐ SO THE 401/403 IS RENDERED AS A SENTENCE, NOT AS A FAILURE. That is why
// `previewSharedDefinition` now returns the HTTP status beside the reason: a
// refusal the server NAMED (`revoked`, `gone`, `table-version`) and a refusal the
// auth dependency made are different answers and need opposite words.
//
// ⚠️ THE ASYMMETRY ITSELF IS AN OWNER DECISION, NOT MINE. Whether a shared
// formula should be previewable by anyone holding the link — the way a shared
// screen is — is a product call with a real privacy edge, since a definition
// carries its author's own maths. This page implements the CURRENT rule and
// makes it legible; it does not quietly widen it.

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import UIcon from '../../components/ui/UIcon'
import { previewSharedDefinition, installSharedDefinition } from '../../hooks/useUserDefinitions'
import { whatToDo } from './shareRefusal'
import styles from './SharedFormula.module.css'

/** Every plot's source text, as `[key, source]`, for a definition of either schema.
 *
 *  ⛔ DERIVED FROM THE DOCUMENT, never re-parsed. `compute.sources` is the v2 map
 *  (plot key → the text the author typed) and `compute.source` is the schema-1
 *  single-tree spelling; a single-tree v2 document does not exist by construction
 *  (`defSchema` refuses a one-key `trees`), so these two cases are exhaustive and
 *  there is no third to fall through to. */
export function plotSources(definition) {
  const compute = (definition && definition.compute) || {}
  const sources = compute.sources
  if (sources && typeof sources === 'object') {
    return Object.keys(sources).sort().map((k) => [k, String(sources[k] ?? '')])
  }
  if (typeof compute.source === 'string' && compute.source) {
    return [[compute.scanPlot || 'value', compute.source]]
  }
  return []
}

/** The repaint badge's words, or `null` when the document declares none.
 *  The vocabulary is the engine's (`defSchema`'s repaint honesty labels); this
 *  file only chooses how to say each one to somebody who did not write it. */
export function repaintWords(definition) {
  const mode = definition && definition.repaint
  if (mode === 'non-repainting') return 'Non-repainting — its value on a closed bar never changes.'
  if (mode === 'preview-repaints') return 'Repaints while the bar is forming, and settles when the bar closes.'
  if (mode === 'repaints') return 'Repaints — earlier values can change as new bars arrive.'
  return null
}

/**
 * The page a formula share link opens.
 *
 * The whole chain a recipient reaches: a link → `App.jsx`'s
 * `SHARED_FORMULA_ROUTE` → this page → `GET /api/user-definitions/shared/{token}`.
 * Cutting any link in it is what `sharedFormula.route.test.jsx` turns red.
 */
export default function SharedFormula() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [state, setState] = useState({ status: 'loading' })
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState(null)

  useEffect(() => {
    if (!token) { setState({ status: 'refused', reason: 'not-found', message: 'This link carries no token.' }); return undefined }
    let alive = true
    setState({ status: 'loading' })
    previewSharedDefinition(token).then((r) => {
      if (!alive) return
      if (r.ok) { setState({ status: 'ok', shared: r.shared }); return }
      // 401 = no session at all; 403 = signed in without a plan. Both are the
      // membership answer and neither is a broken link, so they must not read
      // like one.
      if (r.status === 401 || r.status === 403) { setState({ status: 'needs-plan' }); return }
      setState({ status: 'refused', reason: r.reason, message: r.error })
    })
    return () => { alive = false }
  }, [token])

  const install = useCallback(async () => {
    setInstalling(true); setInstallError(null)
    const r = await installSharedDefinition(token)
    setInstalling(false)
    if (r.ok) { navigate('/charts'); return }
    setInstallError({ reason: r.reason, message: r.error })
  }, [token, navigate])

  if (state.status === 'loading') {
    return (
      <div className={styles.page}>
        <p className={styles.notice} data-testid="shared-formula-loading">Opening this formula…</p>
      </div>
    )
  }

  if (state.status === 'needs-plan') {
    return (
      <div className={styles.page}>
        <div className={styles.card} data-testid="shared-formula-needs-plan">
          <div className={styles.eyebrow}><UIcon name="link" size={13} /> Shared formula</div>
          <h1 className={styles.title}>Somebody shared a formula with you</h1>
          <p className={styles.body}>
            A custom indicator built on UCT&nbsp;Intelligence. Opening it — and installing
            your own editable copy — needs a membership, because a formula runs against
            the same market data your charts and screens do.
          </p>
          <Link className={styles.cta} to="/login">Sign in to open it</Link>
        </div>
      </div>
    )
  }

  if (state.status === 'refused') {
    const advice = whatToDo(state.reason)
    return (
      <div className={styles.page}>
        <div className={styles.card} data-testid="shared-formula-refused" role="alert">
          <div className={styles.eyebrow}><UIcon name="link" size={13} /> Shared formula</div>
          <h1 className={styles.title}>This link doesn&rsquo;t open</h1>
          {/* ⛔ THE SERVER'S OWN SENTENCE, VERBATIM. It already distinguishes
              revoked from deleted from grammar-moved, and re-wording it here
              would be a second authority over what happened. */}
          <p className={styles.body}>{state.message}</p>
          {advice ? <p className={styles.advice} data-testid="shared-formula-advice">{advice}</p> : null}
          <Link className={styles.cta} to="/charts">Go to Charts</Link>
        </div>
      </div>
    )
  }

  const shared = state.shared || {}
  const def = shared.definition || {}
  const meta = def.meta || {}
  const sources = plotSources(def)
  const repaint = repaintWords(def)

  return (
    <div className={styles.page}>
      <div className={styles.card} data-testid="shared-formula">
        <div className={styles.eyebrow}><UIcon name="link" size={13} /> Shared formula</div>
        <h1 className={styles.title}>{meta.name || 'Untitled formula'}</h1>

        <h2 className={styles.sectionHdr}>What it computes</h2>
        {sources.length === 0 ? (
          <p className={styles.body} data-testid="shared-formula-nosource">
            This document carries no readable source text — install it to open it in the builder.
          </p>
        ) : (
          <ul className={styles.plots} data-testid="shared-formula-plots">
            {sources.map(([key, src]) => (
              <li key={key} className={styles.plot}>
                <span className={styles.plotKey}>{key}</span>
                <code className={styles.plotSrc}>{src}</code>
              </li>
            ))}
          </ul>
        )}

        <dl className={styles.meta}>
          {meta.shortName ? (<><dt>Short name</dt><dd>{meta.shortName}</dd></>) : null}
          <dt>Version</dt><dd>v{shared.origin_version}</dd>
          {repaint ? (<><dt>Honesty</dt><dd>{repaint}</dd></>) : null}
        </dl>

        {/* ⭐ THE SENTENCE THAT MAKES THIS SAFE TO SEND, and it is a different
            promise than the screener's. A formula IS somebody's maths, so what
            crossed the line is the maths and nothing around it. */}
        <p className={styles.disclosure} data-testid="shared-formula-disclosure">
          <UIcon name="info" size={13} />{' '}
          What was shared is the <strong>formula itself</strong> — no watchlist, no
          positions, no results. Installing makes <strong>your own copy</strong>, which
          you can edit freely; the original stays theirs, and later edits they make do
          not reach your copy.
        </p>

        <button
          type="button"
          className={styles.cta}
          onClick={install}
          disabled={installing}
          data-testid="shared-formula-install"
        >
          {installing ? 'Installing…' : 'Install my own copy'}
        </button>

        {installError ? (
          <div className={styles.error} role="alert" data-testid="shared-formula-install-error">
            <p>{installError.message}</p>
            {whatToDo(installError.reason)
              ? <p className={styles.advice}>{whatToDo(installError.reason)}</p>
              : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
