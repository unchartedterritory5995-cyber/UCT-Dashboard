/**
 * ConnectedAppsCard — Settings panel for note connectors (spec §8, Task 12
 * + 12b). Mirrors
 * BrokerConnectionsCard's shape: upsell when !isPaid, per-provider tiles
 * from GET /status, OAuth return-querystring self-heal.
 *
 * Card states (spec §8 / task brief, corrected by Task 12b, generalized by
 * Task 7):
 *   - !isPaid                                          -> upsell
 *   - provider.configured === false                    -> "Coming soon" tile (dark provider, no env creds yet)
 *   - a MEMBER_GATED_PROVIDERS key (evernote) not configured -> NO tile at all (Plan E Task 10: /status lists it to
 *     every member, `configured: false` while the flag is off or the member is not allowed; `isProviderShown`)
 *   - `p.beta`                                          -> a "Beta" pill beside the label
 *   - evernote's consent panel                          -> EVERNOTE_CONNECT_NOTES above the checkbox, the `.enex`
 *     offer under the panel; a `reason=evernote_plan` return -> EVERNOTE_PLAN_RETURN + the `.enex` link
 *   - configured, !connected                           -> "Connect" (token modal for roam/craft, consent panel + OAuth redirect for oauth providers)
 *   - connected, sources.length>0                       -> "Connected · N source(s)" + a SourceRow per source
 *   - a source with status==='broken'                   -> that SourceRow additionally shows "Reconnect",
 *     which re-opens THIS provider's connect flow (openConnect(p)) so the member can heal it without
 *     disconnecting first — the backend upserts over broken credentials on a fresh connect (see
 *     SourceRow.jsx's own comment on `onReconnect`).
 *
 * The folder-picker providers (Dropbox, OneDrive) and OneNote were archived
 * on 2026-11-04 with their "Choose folder" state and `DropboxFolderPicker`.
 *
 * OAuth return: the backend's own `/{provider}/callback` route does the code
 * exchange and redirects the browser back with `?connector=<provider>&connected=1`
 * (verified against the shipped router) — this card detects that querystring
 * the way BrokerConnectionsCard detects `?broker=connected`: refresh status
 * and strip the params.
 *
 * Consent (fix-round 1, finding #1): OAuth providers don't get an immediate
 * redirect on "Connect" — first click reveals a `ConnectConsentPanel`
 * (mirrors BrokerConnectionsCard's `showConsent` panel); only its "Continue"
 * (disabled until checked) fires `startOAuth`, which sends `consent: true`.
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import TileCard from '../../../../components/TileCard'
import { useAuth } from '../../../../context/AuthContext'
import useNoteConnectors, { NOTE_CONNECTOR_PROVIDERS, isProviderShown } from '../../hooks/useNoteConnectors'
import { ENEX_IMPORT_HREF, EVERNOTE_ENEX_OFFER, EVERNOTE_PLAN_RETURN, PROVIDER_CONNECT_NOTES } from './evernoteCopy'
import ConnectConsentPanel from './ConnectConsentPanel'
import ConnectTokenModal from './ConnectTokenModal'
import ObsidianConnectModal from './ObsidianConnectModal'
import SourceRow from './SourceRow'
import { SkeletonLine } from '../../../../components/Skeleton'
import styles from './ConnectedAppsCard.module.css'

export default function ConnectedAppsCard() {
  const { isPaid, startCheckout } = useAuth()
  const {
    providers, enabled, obsidianAttachments, isLoading, refresh, connectToken, startOAuth, mintConnectCode,
    syncSource, getSourceLog, updateSource, disconnect,
  } = useNoteConnectors()

  const [tokenModalProvider, setTokenModalProvider] = useState(null)
  const [consentProvider, setConsentProvider] = useState(null)   // oauth key currently showing its consent panel
  const [consentChecked, setConsentChecked] = useState(false)
  const [busyProvider, setBusyProvider] = useState(null)
  const [actionError, setActionError] = useState(null)
  // Which device-kind provider (obsidian) currently has its connect-code
  // modal open — null when closed. Mirrors `tokenModalProvider`'s shape,
  // kept separate because the two modals show entirely different UI.
  const [deviceModalProvider, setDeviceModalProvider] = useState(null)
  // OAuth return self-heal: ?connector=<provider>&connected=1 — the backend
  // callback already created the source row.
  const [returnNotice, setReturnNotice] = useState(null)   // { connector, reason } after a failed OAuth return
  const healedRef = useRef(false)
  useEffect(() => {
    if (healedRef.current) return
    const params = new URLSearchParams(window.location.search)
    const connector = params.get('connector')
    if (connector && params.get('connected') === '0') {
      // A return that did NOT connect (provider error, or the callback landed
      // in a browser that is not the one that pressed Connect). Say so and
      // strip the params; nothing to refresh, nothing was connected.
      healedRef.current = true
      setReturnNotice({ connector, reason: params.get('reason') || '' })
      params.delete('connector')
      params.delete('connected')
      params.delete('reason')
      const failQs = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (failQs ? `?${failQs}` : ''))
      return
    }
    if (!connector || params.get('connected') !== '1') return
    healedRef.current = true
    params.delete('connector')
    params.delete('connected')
    const qs = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
    refresh()
  }, [refresh])

  if (!isPaid) {
    return (
      <TileCard icon="link" title="Connected Apps">
        <div className={styles.section}>
          <p className={styles.lead}>
            Connect Roam, Craft, Notion, or Obsidian
            and your notes sync into the Notebook automatically — no export, no drag-and-drop.
          </p>
          {/* Spec §8.2 again, and this is the version that matters most: this
              member has not paid yet and is deciding whether to commit their
              library at all. "You can leave" is the sentence that makes the
              ask reasonable, so it belongs BEFORE the upgrade button, not
              after it. */}
          <p className={styles.muted} data-testid="export-reassurance">
            Your notes are never locked in — export the whole Notebook to
            markdown, with attachments, any time.
          </p>
          <p className={styles.muted}>Note Connectors is a premium feature.</p>
          <button className="btn btn-primary" onClick={() => startCheckout?.()}>
            Upgrade to connect
          </button>
        </div>
      </TileCard>
    )
  }

  if (isLoading) {
    // G-106 (Wave B lower-frequency sweep): a couple of provider-tile-shaped
    // skeleton rows, instead of bare text.
    return (
      <TileCard icon="link" title="Connected Apps">
        <div className={styles.section} role="status" aria-label="Loading…">
          <SkeletonLine width="60%" height={13} />
          <SkeletonLine width="45%" height={13} />
        </div>
      </TileCard>
    )
  }

  const openConnect = (p) => {
    setActionError(null)
    if (p.tokenKind === 'oauth') {
      // Reveal the consent panel — startOAuth only fires from its "Continue"
      // (disabled until checked), never on this first click.
      setConsentProvider(p.key)
      setConsentChecked(false)
    } else if (p.tokenKind === 'device') {
      setDeviceModalProvider(p.key)
    } else {
      setTokenModalProvider(p.key)
    }
  }

  const confirmOAuthConnect = async (p) => {
    setActionError(null)
    setBusyProvider(p.key)
    try {
      await startOAuth(p.key)
      // On success `startOAuth` navigates the browser away — no need to clear busy/consent.
    } catch (err) {
      setActionError(err?.detail || err?.message || 'Could not start the connection.')
      setBusyProvider(null)
    }
  }

  const cancelOAuthConsent = () => {
    setConsentProvider(null)
    setConsentChecked(false)
  }

  // Returns the normalized sync result; SourceRow turns it (or a throw) into its notice.
  const handleSync = (source) => syncSource(source.id)
  const handleLoadLog = (source) => getSourceLog(source.id)
  const handleTogglePause = (source) => updateSource(source.id, { syncEnabled: !source.syncEnabled })
  const handleDisconnect = async (source) => {
    setActionError(null)
    try {
      await disconnect(source.provider)
    } catch (err) {
      setActionError(err?.detail || err?.message || 'Could not disconnect.')
    }
  }

  const activeTokenProvider = NOTE_CONNECTOR_PROVIDERS.find((p) => p.key === tokenModalProvider)
  // Review M3: Evernote's plan sentence needs BOTH the connector and the reason; any other pair is generic.
  const evernotePlanReturn = !!returnNotice && returnNotice.connector === 'evernote' && returnNotice.reason === 'evernote_plan'

  return (
    <TileCard icon="link" title="Connected Apps">
      <div className={styles.section}>
        <p className={styles.lead}>
          Connect a note app once — your whole library imports, then edits keep
          syncing into the Notebook in the background.
        </p>

        {/* Spec §8.2, and its wording is deliberate: "say so on the connect
            screen". Nobody moves a decade of writing into a product they
            cannot leave, and the more valuable the library the more that
            matters — so the export has to be stated BEFORE the ask, not
            discovered afterwards. It is the cheapest trust this product will
            ever buy, and it is only worth stating because it is true: the
            archive is markdown plus attachments, and it re-imports here (a
            round trip proven end-to-end in exportRoundtrip.test.js). Left as
            a fact rather than a button on purpose — the export lives on the
            Notebook tab, and reaching across surfaces to open it from
            Settings would buy an extra click's convenience at the price of
            coupling two screens together. */}
        <p className={styles.muted} data-testid="export-reassurance">
          Your notes are never locked in — export the whole Notebook to
          markdown, with attachments, any time from the Notebook tab.
        </p>

        {actionError && <div className={styles.error} role="alert">{actionError}</div>}

        {evernotePlanReturn && (
          // Evernote refused a Free account (the callback maps that to `evernote_plan`): say what it
          // means and offer the import a Free member CAN use, never the raw reason.
          <p className={styles.offerNotice} role="status" data-testid="oauth-return-notice">
            {EVERNOTE_PLAN_RETURN}{' '}
            <Link to={ENEX_IMPORT_HREF} className={styles.offerLink}>Import an .enex export</Link>
          </p>
        )}

        {returnNotice && !evernotePlanReturn && (() => {
          const label = NOTE_CONNECTOR_PROVIDERS.find((x) => x.key === returnNotice.connector)?.label || returnNotice.connector
          const text = returnNotice.reason === 'oauth_state'
            ? `Connecting ${label} didn't finish in this browser. Press Connect below to start again here.`
            : returnNotice.reason
              ? `Couldn't connect ${label}: ${returnNotice.reason}`
              : `Couldn't connect ${label}. Try again.`
          return <p className={styles.pausedNotice} role="status" data-testid="oauth-return-notice">{text}</p>
        })()}

        {/* Final-review Item B: `enabled` (server's NOTE_SYNC_ENABLED gate)
            has no consumer without this — a connected, healthy-looking tile
            with the background scheduler off is a SILENT failure mode (one
            manual sync, then nothing, forever). Deliberately dim/informational
            (not styles.error/role=alert) — this isn't a per-action failure,
            it's an ambient fact about the server the whole card should be
            read in light of. */}
        {enabled === false && (
          <p className={styles.pausedNotice} data-testid="sync-paused-notice">
            Background sync is paused on this server — connected apps sync
            when it&rsquo;s re-enabled.
          </p>
        )}

        <div className={styles.tiles}>
          {NOTE_CONNECTOR_PROVIDERS.filter((p) => isProviderShown(p.key, providers[p.key])).map((p) => {
            // Always fully-shaped — normalizeStatus guarantees every provider
            // key, so no `|| {}` fallback and no re-deriving `connected` here.
            const info = providers[p.key]
            const { configured, connected, sources } = info
            const showingConsent = p.tokenKind === 'oauth' && consentProvider === p.key
            return (
              <div key={p.key} className={styles.tile} data-provider={p.key} data-testid={`connector-tile-${p.key}`}>
                <div className={styles.tileHead}>
                  <span className={styles.tileName}>
                    {p.label}
                    {/* Review M2: the visual gap is margin only, so a hidden ", " gives a screen reader "Evernote, Beta". */}
                    {p.beta && <span className="sr-only">, </span>}
                    {p.beta && <span className={styles.betaPill}>Beta</span>}
                  </span>
                  {!configured && connected ? (
                    <span className={styles.statusPill}>Sync off</span>
                  ) : !configured ? (
                    <span className={styles.statusPill}>Coming soon</span>
                  ) : connected ? (
                    <span className={styles.connectedBadge}>
                      Connected · {sources.length} source{sources.length === 1 ? '' : 's'}
                    </span>
                  ) : showingConsent ? null : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busyProvider === p.key}
                      onClick={() => openConnect(p)}
                    >
                      {busyProvider === p.key ? 'Opening…' : 'Connect'}
                    </button>
                  )}
                </div>

                {!connected && showingConsent && (
                  <ConnectConsentPanel
                    providerLabel={p.label}
                    checked={consentChecked}
                    onCheck={setConsentChecked}
                    busy={busyProvider === p.key}
                    onConfirm={() => confirmOAuthConnect(p)}
                    onCancel={cancelOAuthConsent}
                    notes={PROVIDER_CONNECT_NOTES[p.key]}
                  />
                )}

                {!connected && showingConsent && p.key === 'evernote' && (
                  <p className={styles.offerLine}>
                    <Link to={ENEX_IMPORT_HREF} className={styles.offerLink}>{EVERNOTE_ENEX_OFFER}</Link>
                  </p>
                )}

                {!configured && connected && (
                  // Connected, but the server will not sync it for this member now (flag off, admin mode,
                  // or no longer set up). Sync now and pause would 503; Disconnect and the log still work.
                  <p className={styles.pausedNotice} data-testid={`sync-off-${p.key}`}>
                    {p.label} sync is off for this account. Your imported notes stay here, and you can disconnect.
                  </p>
                )}

                {connected && sources.length > 0 && (
                  <div className={styles.sourcesWrap}>
                    {sources.map((s) => (
                      <SourceRow
                        key={s.id}
                        source={s}
                        providerSourceCount={sources.length}
                        providerLabel={p.label}
                        onSync={handleSync}
                        onLoadLog={handleLoadLog}
                        onTogglePause={handleTogglePause}
                        onDisconnect={handleDisconnect}
                        onReconnect={() => openConnect(p)}
                        syncOff={!configured}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <ConnectTokenModal
        open={!!tokenModalProvider}
        provider={tokenModalProvider}
        providerLabel={activeTokenProvider?.label || ''}
        connectToken={connectToken}
        onClose={() => setTokenModalProvider(null)}
        onConnected={refresh}
      />

      <ObsidianConnectModal
        open={!!deviceModalProvider}
        providerLabel={NOTE_CONNECTOR_PROVIDERS.find((p) => p.key === deviceModalProvider)?.label || 'Obsidian'}
        mintConnectCode={mintConnectCode}
        attachments={obsidianAttachments}
        onClose={() => setDeviceModalProvider(null)}
      />
    </TileCard>
  )
}
