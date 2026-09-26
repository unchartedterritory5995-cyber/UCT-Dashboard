import TileCard from '../../../components/TileCard'
import { notebookFlag } from '../lib/offline/notebookFlags'

/**
 * Settings → Sharing & publishing — a STUB (wave 8 seam S8-5). Lane 8B builds it: every
 * share link and publication with its note or folder, date, expiry and state, with Revoke
 * on each row and Update on folder rows (ruling D-B8's second door).
 *
 * Mounted now (Settings.jsx, beside the Personal API card) so the lane fills this file
 * without touching Settings. ⛔ DARK MEANS ABSENT: it renders nothing unless the auth
 * payload latched `j2_share_links_enabled` or `notebook_publish_enabled` ON — both stay off
 * until the owner's legal sign-off (ruling D-B9), and a tab that has not heard from the
 * server yet reads as off. With a gate on it shows only its title, and claims nothing
 * about links it has not read.
 */
export default function SharingCard() {
  const on = notebookFlag('j2_share_links_enabled') === true
    || notebookFlag('notebook_publish_enabled') === true
  if (!on) return null
  return <TileCard icon="link" title="Sharing & publishing" />
}
