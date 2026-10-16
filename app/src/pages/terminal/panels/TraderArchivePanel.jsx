// WHO: what the UCT trading team posted and called on one ticker (the TSDR trader archive).
//
// ⭐ NO NEW ROUTE AND NO SECOND READ. The panel is the research modal's own "What the traders
// said" block (components/research/sections/TraderArchiveBlock.jsx), embedded as-is, plus the
// states a whole panel has to SAY that an inline block hides: archive switched off (404), not on
// the member's plan (402), a failed read, and a ticker the team never mentioned. Both read the
// same SWR key (useArchiveTicker), so the block costs no second request.
//
// ⛔ "No posts" is only said when the archive ANSWERED with none. An error is never drawn as an
// empty archive.
import { PanelSkeleton, PanelState, useInTerminalPanel, usePanelFreshness, panelAsOf } from '../../../components/terminal'
import TraderArchiveBlock from '../../../components/research/sections/TraderArchiveBlock'
import useArchiveTicker, { newestCalls } from '../../../components/research/sections/useArchiveTicker'
import { dayOf } from '../../../utils/traderArchive'
import styles from './myNamesPanel.module.css'

/** The newest post or call date in the payload: what the panel header's "as of" reports. */
export function newestArchiveDay(data) {
  const records = Array.isArray(data?.records) ? data.records : []
  const days = [
    ...records.map((r) => dayOf(r.stated_date)),
    ...newestCalls(data).slice(0, 1).map((c) => dayOf(c.posted)),
  ].filter(Boolean).sort()
  return days.length ? days[days.length - 1] : null
}

export default function TraderArchivePanel({ sym }) {
  const s = String(sym || '').trim().toUpperCase()
  const inPanel = useInTerminalPanel()
  const { data, error } = useArchiveTicker(s)
  const newest = data && !data.paywalled ? newestArchiveDay(data) : null
  usePanelFreshness(newest ? panelAsOf('UCT trader archive (TSDR Discord, posts by the trading team)', newest) : null)

  if (!s) {
    return (
      <PanelState kind="input" title="WHO needs a ticker.">
        Type one first, e.g. <kbd>NVDA WHO</kbd>
      </PanelState>
    )
  }
  if (!data && !error) return <PanelSkeleton label={`Reading the trader archive for ${s}`} testId="terminal-who-loading" />
  if (data?.paywalled) {
    return <PanelState kind="locked" role="status" testId="terminal-who-locked" title="The trader archive is part of the paid plan." />
  }
  if (error) {
    if (error.status === 404) {
      return (
        <PanelState kind="locked" role="status" testId="terminal-who-off"
          title="The trader archive is not switched on for this server yet." />
      )
    }
    return (
      <PanelState kind="error" testId="terminal-who-error" title={`Could not read the trader archive for ${s} just now.`}>
        That is not the same as the team never mentioning {s}. Run {s} WHO again.
      </PanelState>
    )
  }
  const records = Array.isArray(data.records) ? data.records : []
  if (!records.length && !newestCalls(data).length) {
    return (
      <PanelState kind="empty" role="status" testId="terminal-who-empty" title={`The trading team has no archived posts on ${s}.`}>
        The archive holds the team&apos;s Discord posts from March 2024 on.
      </PanelState>
    )
  }
  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-who">
      <TraderArchiveBlock sym={s} />
    </div>
  )
}
