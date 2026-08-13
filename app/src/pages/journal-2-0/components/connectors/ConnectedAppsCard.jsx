/**
 * ConnectedAppsCard — Settings panel for note connectors (spec §8, Task 12
 * + 12b, widened to the Microsoft Graph wave in Task 7). Mirrors
 * BrokerConnectionsCard's shape: upsell when !isPaid, per-provider tiles
 * from GET /status, OAuth return-querystring self-heal.
 *
 * Card states (spec §8 / task brief, corrected by Task 12b, generalized by
 * Task 7):
 *   - !isPaid                                          -> upsell
 *   - provider.configured === false                    -> "Coming soon" tile (dark provider, no env creds yet)
 *   - configured, !connected                           -> "Connect" (token modal for roam/craft, consent panel + OAuth redirect for oauth providers)
 *   - FOLDER_PICKER_PROVIDERS, connected, sources.length===0 -> "Choose folder" CTA (amber, NOT the green Connected badge) -> DropboxFolderPicker
 *   - connected, sources.length>0                       -> "Connected · N source(s)" + a SourceRow per source
 *
 * `FOLDER_PICKER_PROVIDERS` (dropbox, onedrive) is the small, shared
 * allow-set that decides both the "needs a folder" CTA gate below AND which
 * provider's folders `DropboxFolderPicker` browses — imported from the hook
 * so it can never drift from the backend's own `_FOLDER_PICKER_PROVIDERS`
 * (note_sync.py) in spirit. OneNote is whole-account (Notion's shape, one
 * implicit source auto-created by the callback) and is deliberately NOT in
 * that set — a sourceless-connected OneNote would mean something actually
 * failed, not "needs a folder," so it renders the ordinary connected/
 * SourceRow states like Notion/Roam/Craft.
 *
 * OAuth return: the backend's own `/{provider}/callback` route does the code
 * exchange and redirects the browser back with `?connector=<provider>&connected=1`
 * (verified against the shipped router) — this card detects that querystring
 * the way BrokerConnectionsCard detects `?broker=connected`: refresh status,
 * strip the params, and — Task 12b, widened in Task 7 — if the just-returned
 * provider is IN `FOLDER_PICKER_PROVIDERS` and lands connected-but-sourceless,
 * auto-open the folder picker for THAT provider (the router's own comment:
 * "Dropbox needs a FOLDER before a source can exist"; OneDrive is the
 * identical shape; the callback deliberately does NOT create a source for
 * either).
 *
 * Consent (fix-round 1, finding #1): OAuth providers don't get an immediate
 * redirect on "Connect" — first click reveals a `ConnectConsentPanel`
 * (mirrors BrokerConnectionsCard's `showConsent` panel); only its "Continue"
 * (disabled until checked) fires `startOAuth`, which sends `consent: true`.
 */
import { useEffect, useRef, useState } from 'react'
import TileCard from '../../../../components/TileCard'
import { useAuth } from '../../../../context/AuthContext'
import useNoteConnectors, { FOLDER_PICKER_PROVIDERS, NOTE_CONNECTOR_PROVIDERS } from '../../hooks/useNoteConnectors'
import ConnectConsentPanel from './ConnectConsentPanel'
import ConnectTokenModal from './ConnectTokenModal'
import DropboxFolderPicker from './DropboxFolderPicker'
import SourceRow from './SourceRow'
import styles from './ConnectedAppsCard.module.css'

export default function ConnectedAppsCard() {
  const { isPaid, startCheckout } = useAuth()
  const {
    providers, enabled, isLoading, refresh, connectToken, startOAuth, syncSource, updateSource,
    disconnect, listFolders, addSource,
  } = useNoteConnectors()

  const [tokenModalProvider, setTokenModalProvider] = useState(null)
  const [consentProvider, setConsentProvider] = useState(null)   // oauth key currently showing its consent panel
  const [consentChecked, setConsentChecked] = useState(false)
  const [busyProvider, setBusyProvider] = useState(null)
  const [actionError, setActionError] = useState(null)
  // Which FOLDER_PICKER_PROVIDERS key currently has its picker sheet open —
  // null when closed. A single shared `DropboxFolderPicker` instance is
  // parameterized by this (see the render below) rather than one boolean +
  // one instance per provider, so a THIRD folder-picker provider (should one
  // ever land) needs no new state variable here.
  const [folderPickerProvider, setFolderPickerProvider] = useState(null)

  // OAuth return self-heal: ?connector=<provider>&connected=1 — the backend
  // callback already created the source row for roam/craft/notion/onenote.
  // FOLDER_PICKER_PROVIDERS (dropbox, onedrive) are the exception
  // (connector only, no source yet) — remember it here so the follow-up
  // effect (below, once fresh `providers` lands) can auto-open the folder
  // picker instead of leaving a silently-incomplete tile.
  const healedRef = useRef(false)
  const autoPickProviderRef = useRef(null)
  useEffect(() => {
    if (healedRef.current) return
    const params = new URLSearchParams(window.location.search)
    const connector = params.get('connector')
    if (!connector || params.get('connected') !== '1') return
    healedRef.current = true
    autoPickProviderRef.current = connector
    params.delete('connector')
    params.delete('connected')
    const qs = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
    refresh()
  }, [refresh])

  // Fires once fresh status has landed after the return above. Split from
  // the effect that triggers `refresh()` because `mutate()` is async — this
  // one reacts to the NEW `providers` value rather than racing it.
  useEffect(() => {
    const p = autoPickProviderRef.current
    if (!p || !FOLDER_PICKER_PROVIDERS.has(p) || isLoading) return
    autoPickProviderRef.current = null
    if (providers[p]?.connected && providers[p].sources.length === 0) {
      setFolderPickerProvider(p)
    }
  }, [providers, isLoading])

  if (!isPaid) {
    return (
      <TileCard icon="link" title="Connected Apps">
        <div className={styles.section}>
          <p className={styles.lead}>
            Connect Roam, Craft, Notion, Dropbox, OneNote, or OneDrive and your
            notes sync into the Notebook automatically — no export, no drag-and-drop.
          </p>
          <p className={styles.muted}>Note Connectors is a premium feature.</p>
          <button className={styles.primaryBtn} onClick={() => startCheckout?.()}>
            Upgrade to connect
          </button>
        </div>
      </TileCard>
    )
  }

  if (isLoading) {
    return (
      <TileCard icon="link" title="Connected Apps">
        <div className={styles.muted}>Loading…</div>
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

  const handleSync = (source) => syncSource(source.id)
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

  return (
    <TileCard icon="link" title="Connected Apps">
      <div className={styles.section}>
        <p className={styles.lead}>
          Connect a note app once — your whole library imports, then edits keep
          syncing into the Notebook in the background.
        </p>
        {actionError && <div className={styles.error} role="alert">{actionError}</div>}

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
          {NOTE_CONNECTOR_PROVIDERS.map((p) => {
            // Always fully-shaped — normalizeStatus guarantees every provider
            // key, so no `|| {}` fallback and no re-deriving `connected` here.
            const info = providers[p.key]
            const { configured, connected, sources } = info
            const showingConsent = p.tokenKind === 'oauth' && consentProvider === p.key
            // Only FOLDER_PICKER_PROVIDERS (dropbox, onedrive) can land
            // connector-without-source today (Roam/Craft/Notion/OneNote
            // create both atomically — see the router) — scope the CTA to
            // that shared allow-set rather than a dropbox-only literal, so
            // OneDrive lands the same "Choose folder" state Dropbox already
            // had, and a future whole-account provider joining Notion/
            // OneNote's shape never needs this gate touched.
            const needsFolder = FOLDER_PICKER_PROVIDERS.has(p.key) && connected && sources.length === 0
            return (
              <div key={p.key} className={styles.tile} data-provider={p.key} data-testid={`connector-tile-${p.key}`}>
                <div className={styles.tileHead}>
                  <span className={styles.tileName}>{p.label}</span>
                  {!configured ? (
                    <span className={styles.comingSoon}>Coming soon</span>
                  ) : needsFolder ? (
                    <button
                      type="button"
                      className={styles.chooseFolderBtn}
                      onClick={() => setFolderPickerProvider(p.key)}
                    >
                      Choose folder
                    </button>
                  ) : connected ? (
                    <span className={styles.connectedBadge}>
                      Connected · {sources.length} source{sources.length === 1 ? '' : 's'}
                    </span>
                  ) : showingConsent ? null : (
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      disabled={busyProvider === p.key}
                      onClick={() => openConnect(p)}
                    >
                      {busyProvider === p.key ? 'Opening…' : 'Connect'}
                    </button>
                  )}
                </div>

                {needsFolder && (
                  <p className={styles.needsFolderHint}>
                    Connected — pick a folder to start syncing.
                  </p>
                )}

                {!connected && showingConsent && (
                  <ConnectConsentPanel
                    providerLabel={p.label}
                    checked={consentChecked}
                    onCheck={setConsentChecked}
                    busy={busyProvider === p.key}
                    onConfirm={() => confirmOAuthConnect(p)}
                    onCancel={cancelOAuthConsent}
                  />
                )}

                {connected && sources.length > 0 && (
                  <div className={styles.sourcesWrap}>
                    {sources.map((s) => (
                      <SourceRow
                        key={s.id}
                        source={s}
                        providerSourceCount={sources.length}
                        onSync={handleSync}
                        onTogglePause={handleTogglePause}
                        onDisconnect={handleDisconnect}
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

      <DropboxFolderPicker
        open={!!folderPickerProvider}
        provider={folderPickerProvider || 'dropbox'}
        providerLabel={NOTE_CONNECTOR_PROVIDERS.find((p) => p.key === folderPickerProvider)?.label || 'Dropbox'}
        listFolders={listFolders}
        addSource={addSource}
        onClose={() => setFolderPickerProvider(null)}
        onPicked={() => {}}
      />
    </TileCard>
  )
}
