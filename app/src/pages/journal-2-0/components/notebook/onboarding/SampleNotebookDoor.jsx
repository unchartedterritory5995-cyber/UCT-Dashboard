// Notebook simplify, Task 5 ("open on your notes"): "Add a sample notebook" for a member with no notes, in the notes
// list's empty state beside "Import notes". It was Research home's first-run door; Research home is no longer routed,
// so the door moved here, running the same action (`addSampleNotebook`, then every Notebook read refreshed and the
// welcome note opened) under the same rule: only while `notebook_onboarding_enabled` is on, for a paid member who has
// never had the sample (its ids are recorded in `notebook_sample`).
// Fix round 1 (first-open bytes): a lazy chunk of the zero-notes state now (tabs/NotebookTab.jsx); its hooks live in
// useSampleNotebook.js, so the list's first open carries neither this file nor the sample's client.
import UIcon from '../../../../../components/ui/UIcon'
import { SAMPLE_COPY } from './sampleNotebook'
import { useCanAddSample } from './useSampleNotebook'

export default function SampleNotebookDoor({ add, adding = false, error = '' }) {
  const canAdd = useCanAddSample()
  if (!canAdd && !error) return null
  return (
    <>
      {canAdd && (
        <button type="button" className="btn btn-outline" onClick={add} disabled={adding}>
          <UIcon name="book" size={16} gold={false} /> {adding ? SAMPLE_COPY.adding : SAMPLE_COPY.add}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  )
}
