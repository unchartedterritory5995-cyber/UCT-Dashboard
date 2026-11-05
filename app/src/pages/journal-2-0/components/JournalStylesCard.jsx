// Settings > Notebook door to the Styles manager (spec P1.4). Renders nothing while journal styles are off.
import { Link } from 'react-router-dom'
import TileCard from '../../../components/TileCard'
import { journalStylesEnabled } from '../lib/journalStylesFlag'

export default function JournalStylesCard() {
  if (!journalStylesEnabled()) return null
  return (
    <TileCard icon="sliders" title="Templates">
      <p>Set up how each note type starts: its outline, its blocks and the properties it fills.</p>
      <Link to="/journal/notebook?styles=1" className="btn btn-ghost">Manage templates</Link>
    </TileCard>
  )
}
