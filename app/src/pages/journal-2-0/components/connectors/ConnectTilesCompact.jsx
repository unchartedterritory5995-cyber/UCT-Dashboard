/**
 * ConnectTilesCompact — compact connect tiles above the ImportWizard dropzone
 * (task brief item 6: "ImportWizard drop step: compact connect tiles above
 * the dropzone, configured providers only").
 *
 * Renders NOTHING while loading. When at least one provider is `configured`,
 * dark providers (no env creds yet) still get no individual tile HERE — the
 * Settings card is the full, authoritative place for that (an explicit
 * "Coming soon" pill per provider); duplicating that per-provider detail
 * onto this deliberately compact wizard strip would work against the one
 * thing this component is FOR (a quick nudge above a drag-and-drop zone,
 * not a connections-management page).
 *
 * ⛔⛔ THE ONE CASE THAT WAS GENUINELY SILENT, NOT JUST COMPACT: when ZERO
 * providers are configured, this used to return null outright — a member on
 * a deployment where nothing has been set up yet saw no evidence this
 * capability is even a category of feature (the whole "Or connect an app —
 * your notes stay in sync automatically" label vanished with it). That is
 * the gap this file's own comment pointed at the Settings card for, without
 * the Settings card actually being reachable FROM here. Competitive audit
 * finding UX #17, 2026-09-22. One honest line, not a per-provider list.
 *
 * Clicking a
 * configured, not-yet-connected tile opens the same connect flow as the
 * Settings card: token modal for roam/craft, or (fix-round 1, finding #1) a
 * `ConnectConsentPanel` for notion/evernote — OAuth never fires straight off
 * the tile click, same consent gate as the Settings card.
 *
 * The folder-picker tile state ("Choose a folder for ...") left with Dropbox
 * and OneDrive when they were archived on 2026-11-04.
 */
import { useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import useNoteConnectors, { NOTE_CONNECTOR_PROVIDERS } from '../../hooks/useNoteConnectors'
import { PROVIDER_CONNECT_NOTES } from './evernoteCopy'
import ConnectConsentPanel from './ConnectConsentPanel'
import ConnectTokenModal from './ConnectTokenModal'
import ObsidianConnectModal from './ObsidianConnectModal'
import styles from './ConnectTilesCompact.module.css'

export default function ConnectTilesCompact() {
  const {
    providers, obsidianAttachments, isLoading, connectToken, startOAuth, mintConnectCode, refresh,
  } = useNoteConnectors()
  const [tokenModalProvider, setTokenModalProvider] = useState(null)
  const [consentProvider, setConsentProvider] = useState(null)
  const [consentChecked, setConsentChecked] = useState(false)
  const [busyProvider, setBusyProvider] = useState(null)
  const [error, setError] = useState(null)
  // Which device-kind provider (obsidian) currently has its connect-code
  // modal open — null when closed (mirrors ConnectedAppsCard's identical
  // state shape).
  const [deviceModalProvider, setDeviceModalProvider] = useState(null)

  if (isLoading) return null

  // `providers[p.key]` is always fully-shaped (normalizeStatus guarantees
  // every provider key) — `.configured`/`.connected` read directly, never
  // re-derived from `.sources.length` here.
  const configured = NOTE_CONNECTOR_PROVIDERS.filter((p) => providers[p.key].configured)
  if (configured.length === 0) {
    return (
      <p className={styles.label}>
        Connecting an app for automatic sync is coming soon — for now, import a file below.
      </p>
    )
  }

  const openConnect = (p) => {
    setError(null)
    if (p.tokenKind === 'oauth') {
      setConsentProvider(p.key)
      setConsentChecked(false)
    } else if (p.tokenKind === 'device') {
      setDeviceModalProvider(p.key)
    } else {
      setTokenModalProvider(p.key)
    }
  }

  const confirmOAuthConnect = async (p) => {
    setError(null)
    setBusyProvider(p.key)
    try {
      await startOAuth(p.key)
    } catch (err) {
      setError(err?.detail || err?.message || 'Could not start the connection.')
      setBusyProvider(null)
    }
  }

  const cancelOAuthConsent = () => {
    setConsentProvider(null)
    setConsentChecked(false)
  }

  const activeTokenProvider = NOTE_CONNECTOR_PROVIDERS.find((p) => p.key === tokenModalProvider)
  const activeConsentProvider = configured.find((p) => p.key === consentProvider)

  return (
    <div className={styles.wrap}>
      <p className={styles.label}>Or connect an app — your notes stay in sync automatically</p>
      <div className={styles.tiles}>
        {configured.map((p) => {
          const info = providers[p.key]
          const label = info.connected ? `${p.label} connected` : `Connect ${p.label}`
          return (
            <button
              key={p.key}
              type="button"
              className={styles.tile}
              data-connected={info.connected}
              data-testid={`connect-tile-${p.key}`}
              disabled={busyProvider === p.key || (p.tokenKind === 'oauth' && consentProvider === p.key)}
              onClick={() => openConnect(p)}
            >
              <UIcon name="link" size={13} gold={false} />
              {label}
            </button>
          )
        })}
      </div>
      {error && <p className={styles.error}>{error}</p>}

      {activeConsentProvider && !providers[activeConsentProvider.key].connected && (
        <ConnectConsentPanel
          providerLabel={activeConsentProvider.label}
          checked={consentChecked}
          onCheck={setConsentChecked}
          busy={busyProvider === activeConsentProvider.key}
          onConfirm={() => confirmOAuthConnect(activeConsentProvider)}
          onCancel={cancelOAuthConsent}
          notes={PROVIDER_CONNECT_NOTES[activeConsentProvider.key]}
        />
      )}

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
    </div>
  )
}
