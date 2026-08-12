/**
 * ConnectedAppsCard — Settings panel for note connectors (spec §8, Task 12).
 * Mirrors BrokerConnectionsCard's shape: upsell when !isPaid, per-provider
 * tiles from GET /status, OAuth return-querystring self-heal.
 *
 * Card states (spec §8 / task brief):
 *   - !isPaid                       -> upsell
 *   - provider.configured === false -> "Coming soon" tile (dark provider, no env creds yet)
 *   - configured, no sources        -> "Connect" (token modal for roam/craft, OAuth redirect for notion/dropbox)
 *   - configured, sources.length>0  -> "Connected · N source(s)" + a SourceRow per source
 *
 * OAuth return: the backend's own `/{provider}/callback` route does the code
 * exchange and redirects the browser back with `?connector=notion&connected=1`
 * (task brief) — this card detects that querystring the way
 * BrokerConnectionsCard detects `?broker=connected`: refresh status, then
 * strip the params so a refresh doesn't replay the self-heal.
 */
import { useEffect, useRef, useState } from 'react'
import TileCard from '../../../../components/TileCard'
import { useAuth } from '../../../../context/AuthContext'
import useNoteConnectors, { NOTE_CONNECTOR_PROVIDERS } from '../../hooks/useNoteConnectors'
import ConnectTokenModal from './ConnectTokenModal'
import SourceRow from './SourceRow'
import styles from './ConnectedAppsCard.module.css'

export default function ConnectedAppsCard() {
  const { isPaid, startCheckout } = useAuth()
  const {
    providers, isLoading, refresh, connectToken, startOAuth, syncSource, updateSource, disconnect,
  } = useNoteConnectors()

  const [tokenModalProvider, setTokenModalProvider] = useState(null)
  const [busyProvider, setBusyProvider] = useState(null)
  const [actionError, setActionError] = useState(null)

  // OAuth return self-heal: ?connector=<provider>&connected=1 — the backend
  // callback already created the source row(s); this just needs to see them.
  const healedRef = useRef(false)
  useEffect(() => {
    if (healedRef.current) return
    const params = new URLSearchParams(window.location.search)
    const connector = params.get('connector')
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
            Connect Roam, Craft, Notion, or Dropbox and your notes sync into the
            Notebook automatically — no export, no drag-and-drop.
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

  const openConnect = async (p) => {
    setActionError(null)
    if (p.tokenKind === 'oauth') {
      setBusyProvider(p.key)
      try {
        await startOAuth(p.key)
      } catch (err) {
        setActionError(err?.detail || err?.message || 'Could not start the connection.')
        setBusyProvider(null)
      }
      // On success `startOAuth` navigates the browser away — no need to clear busy.
    } else {
      setTokenModalProvider(p.key)
    }
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

        <div className={styles.tiles}>
          {NOTE_CONNECTOR_PROVIDERS.map((p) => {
            const info = providers[p.key] || {}
            const sources = info.sources || []
            const connected = sources.length > 0
            return (
              <div key={p.key} className={styles.tile} data-provider={p.key} data-testid={`connector-tile-${p.key}`}>
                <div className={styles.tileHead}>
                  <span className={styles.tileName}>{p.label}</span>
                  {!info.configured ? (
                    <span className={styles.comingSoon}>Coming soon</span>
                  ) : connected ? (
                    <span className={styles.connectedBadge}>
                      Connected · {sources.length} source{sources.length === 1 ? '' : 's'}
                    </span>
                  ) : (
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

                {connected && (
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
    </TileCard>
  )
}
