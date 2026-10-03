// RSCH — the `/research/:sym` "My Research" tab, embedded. ⛔ An ADAPTER, not a fork: it
// renders the same TickerResearchWorkspace with the same props ResearchPage passes, and opens
// a note through the same `notePath` door.
import { useNavigate } from 'react-router-dom'
import TickerResearchWorkspace from '../../journal-2-0/components/notebook/TickerResearchWorkspace'
import { notePath } from '../../../hooks/useNoteBacklinks'

export default function MyResearchPanel({ sym }) {
  const navigate = useNavigate()
  return (
    <TickerResearchWorkspace symbol={sym} showBackLink={false} onOpenNote={(note) => navigate(notePath(note.id))} />
  )
}
