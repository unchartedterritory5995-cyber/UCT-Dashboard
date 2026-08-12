/**
 * NoteConnectorsTrustStrip — compact trust line on NotebookTab (task brief
 * item 7): "Roam · synced 5m ago · 2 conflicts" linking to Settings.
 * Renders nothing when no source exists across any provider (fresh install,
 * or the feature dark) — mirrors SyncTrustCenter's self-hiding contract, just
 * far more compact since this is a one-line strip, not a full trust panel.
 */
import UIcon from '../../../../components/ui/UIcon'
import { timeAgo } from '../../../../utils/timeAgo'
import useNoteConnectors, { NOTE_CONNECTOR_PROVIDERS } from '../../hooks/useNoteConnectors'
import styles from './NoteConnectorsTrustStrip.module.css'

const LABEL_BY_KEY = Object.fromEntries(NOTE_CONNECTOR_PROVIDERS.map((p) => [p.key, p.label]))

export default function NoteConnectorsTrustStrip() {
  const { providers, isLoading } = useNoteConnectors()
  if (isLoading) return null

  // `providers[key].sources` is always an array — normalizeStatus guarantees
  // every provider key + shape, so no `|| []` fallback needed here.
  const sources = Object.entries(providers).flatMap(([key, info]) =>
    info.sources.map((s) => ({ ...s, providerLabel: LABEL_BY_KEY[key] || key }))
  )
  if (sources.length === 0) return null

  return (
    <div className={styles.strip} aria-label="Note connectors sync status">
      <UIcon name="link" size={12} gold={false} className={styles.icon} />
      {sources.map((s) => {
        const conflicts = s.counts?.conflicts || 0
        return (
          <a key={s.id} className={styles.line} href="/settings?section=connections">
            {s.providerLabel}
            {' · '}
            {s.lastSyncAt ? `synced ${timeAgo(s.lastSyncAt)}` : 'not synced yet'}
            {conflicts > 0 && (
              <span className={styles.conflict}>
                {' · '}{conflicts} conflict{conflicts === 1 ? '' : 's'}
              </span>
            )}
          </a>
        )
      })}
    </div>
  )
}
