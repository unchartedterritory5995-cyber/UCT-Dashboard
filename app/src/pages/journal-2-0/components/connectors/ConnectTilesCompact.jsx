/**
 * ConnectTilesCompact — compact connect tiles above the ImportWizard dropzone
 * (task brief item 6: "ImportWizard drop step: compact connect tiles above
 * the dropzone, configured providers only").
 *
 * Renders NOTHING while loading and nothing at all when no provider is
 * `configured` — dark providers (no env creds yet) never show a tile here;
 * that's what the Settings card's "Coming soon" tile is for. Clicking a
 * configured, not-yet-connected tile opens the same connect flow as the
 * Settings card (token modal for roam/craft, OAuth redirect for
 * notion/dropbox) so a user can connect without leaving the wizard.
 */
import { useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import useNoteConnectors, { NOTE_CONNECTOR_PROVIDERS } from '../../hooks/useNoteConnectors'
import ConnectTokenModal from './ConnectTokenModal'
import styles from './ConnectTilesCompact.module.css'

export default function ConnectTilesCompact() {
  const { providers, isLoading, connectToken, startOAuth, refresh } = useNoteConnectors()
  const [tokenModalProvider, setTokenModalProvider] = useState(null)
  const [busyProvider, setBusyProvider] = useState(null)
  const [error, setError] = useState(null)

  if (isLoading) return null

  const configured = NOTE_CONNECTOR_PROVIDERS.filter((p) => providers[p.key]?.configured)
  if (configured.length === 0) return null

  const openConnect = async (p) => {
    setError(null)
    if (p.tokenKind === 'oauth') {
      setBusyProvider(p.key)
      try {
        await startOAuth(p.key)
      } catch (err) {
        setError(err?.detail || err?.message || 'Could not start the connection.')
        setBusyProvider(null)
      }
    } else {
      setTokenModalProvider(p.key)
    }
  }

  const activeTokenProvider = NOTE_CONNECTOR_PROVIDERS.find((p) => p.key === tokenModalProvider)

  return (
    <div className={styles.wrap}>
      <p className={styles.label}>Or connect an app — your notes stay in sync automatically</p>
      <div className={styles.tiles}>
        {configured.map((p) => {
          const connected = (providers[p.key]?.sources || []).length > 0
          return (
            <button
              key={p.key}
              type="button"
              className={styles.tile}
              data-connected={connected}
              data-testid={`connect-tile-${p.key}`}
              disabled={busyProvider === p.key}
              onClick={() => openConnect(p)}
            >
              <UIcon name="link" size={13} gold={false} />
              {connected ? `${p.label} connected` : `Connect ${p.label}`}
            </button>
          )
        })}
      </div>
      {error && <p className={styles.error}>{error}</p>}

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
