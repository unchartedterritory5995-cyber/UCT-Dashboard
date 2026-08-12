/**
 * ConnectTilesCompact — compact connect tiles above the ImportWizard dropzone
 * (task brief item 6: "ImportWizard drop step: compact connect tiles above
 * the dropzone, configured providers only").
 *
 * Renders NOTHING while loading and nothing at all when no provider is
 * `configured` — dark providers (no env creds yet) never show a tile here;
 * that's what the Settings card's "Coming soon" tile is for. Clicking a
 * configured, not-yet-connected tile opens the same connect flow as the
 * Settings card: token modal for roam/craft, or (fix-round 1, finding #1) a
 * `ConnectConsentPanel` for notion/dropbox — OAuth never fires straight off
 * the tile click, same consent gate as the Settings card.
 */
import { useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import useNoteConnectors, { NOTE_CONNECTOR_PROVIDERS } from '../../hooks/useNoteConnectors'
import ConnectConsentPanel from './ConnectConsentPanel'
import ConnectTokenModal from './ConnectTokenModal'
import styles from './ConnectTilesCompact.module.css'

export default function ConnectTilesCompact() {
  const { providers, isLoading, connectToken, startOAuth, refresh } = useNoteConnectors()
  const [tokenModalProvider, setTokenModalProvider] = useState(null)
  const [consentProvider, setConsentProvider] = useState(null)
  const [consentChecked, setConsentChecked] = useState(false)
  const [busyProvider, setBusyProvider] = useState(null)
  const [error, setError] = useState(null)

  if (isLoading) return null

  // `providers[p.key]` is always fully-shaped (normalizeStatus guarantees
  // every provider key) — `.configured`/`.connected` read directly, never
  // re-derived from `.sources.length` here.
  const configured = NOTE_CONNECTOR_PROVIDERS.filter((p) => providers[p.key].configured)
  if (configured.length === 0) return null

  const openConnect = (p) => {
    setError(null)
    if (p.tokenKind === 'oauth') {
      setConsentProvider(p.key)
      setConsentChecked(false)
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
          const connected = providers[p.key].connected
          return (
            <button
              key={p.key}
              type="button"
              className={styles.tile}
              data-connected={connected}
              data-testid={`connect-tile-${p.key}`}
              disabled={busyProvider === p.key || (p.tokenKind === 'oauth' && consentProvider === p.key)}
              onClick={() => openConnect(p)}
            >
              <UIcon name="link" size={13} gold={false} />
              {connected ? `${p.label} connected` : `Connect ${p.label}`}
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
    </div>
  )
}
