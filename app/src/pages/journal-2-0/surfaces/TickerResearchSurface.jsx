/**
 * Ticker Research Workspace's own top-level route
 * (/journal/notebook/research/:symbol, checkpoint decision 8) — a NEW
 * sibling under the existing /journal nested-route parent, deliberately NOT
 * nested inside NotebookTab's own three-pane shell (a focused, single-
 * purpose page). The same component also mounts as /research/:sym's "My
 * Research" bridge tab (checkpoint decision 6) — one implementation, two
 * entry surfaces.
 */
import { useNavigate, useParams } from 'react-router-dom'
import TickerResearchWorkspace from '../components/notebook/TickerResearchWorkspace'
import { notePath } from '../../../hooks/useNoteBacklinks'

export default function TickerResearchSurface() {
  const { symbol } = useParams()
  const navigate = useNavigate()
  return (
    <TickerResearchWorkspace
      symbol={(symbol || '').toUpperCase()}
      onOpenNote={(note) => navigate(notePath(note.id))}
    />
  )
}
