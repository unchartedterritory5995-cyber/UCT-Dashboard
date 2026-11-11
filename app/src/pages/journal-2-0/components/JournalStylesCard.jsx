// Settings > Notebook door to the Styles manager (spec P1.4). Renders nothing while journal styles are off.
// Audit 2026-11-05, S16: and the door back to the 60-second first run ("Set up my Notebook").
import { Link } from 'react-router-dom'
import TileCard from '../../../components/TileCard'
import { journalStylesEnabled } from '../lib/journalStylesFlag'
import { starterPacksEnabled } from '../lib/starterPacksFlag'
import { FIRST_RUN_STATE } from '../lib/firstRun'

export default function JournalStylesCard() {
  if (!journalStylesEnabled()) return null
  return (
    <TileCard icon="sliders" title="Templates">
      <p>Set up how each note type starts: its outline, its blocks and the properties it fills.</p>
      <Link to="/journal/notebook?styles=1" className="btn btn-ghost">Manage templates</Link>
      {starterPacksEnabled() && (
        <Link to="/journal/notebook" state={{ [FIRST_RUN_STATE]: true }} className="btn btn-ghost">Set up my Notebook</Link>
      )}
    </TileCard>
  )
}
