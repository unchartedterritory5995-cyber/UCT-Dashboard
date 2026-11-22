// Notebook simplify, Task 5 ("open on your notes"): "Add a sample notebook" for a member with no notes, in the notes
// list's empty state beside "Import notes". It was Research home's first-run door; Research home is no longer routed,
// so the door moved here, running the same action (`addSampleNotebook`, then every Notebook read refreshed and the
// welcome note opened) under the same rule: only while `notebook_onboarding_enabled` is on, for a paid member who has
// never had the sample (its ids are recorded in `notebook_sample`).
// Fix round 1 (first-open bytes): a lazy chunk of the zero-notes state now (tabs/NotebookTab.jsx); its hooks live in
// useSampleNotebook.js, so the list's first open carries neither this file nor the sample's client.
// Final fix (C4): not drawn while the get-started card is up with its "Open the sample notebook" step not yet done:
// that step is the door then (the same action), and the empty list showed the same control twice. Drawn again when
// the card is hidden, closed, finished or absent, or once its sample step is done.
import UIcon from '../../../../../components/ui/UIcon'
import usePreferences from '../../../../../hooks/usePreferences'
import { useGettingStartedCardUp } from '../GettingStartedChecklist'
import { CHECKLIST_PREF, recordedDone } from './gettingStartedPref'
import { SAMPLE_COPY } from './sampleNotebook'
import { useCanAddSample } from './useSampleNotebook'

export default function SampleNotebookDoor({ add, adding = false, error = '' }) {
  const canAdd = useCanAddSample()
  const { prefs } = usePreferences()
  const cardOffersSample = useGettingStartedCardUp() && !recordedDone(prefs?.[CHECKLIST_PREF]).has('sample')
  if ((!canAdd || cardOffersSample) && !error) return null
  return (
    <>
      {canAdd && !cardOffersSample && (
        <button type="button" className="btn btn-outline" onClick={add} disabled={adding}>
          <UIcon name="book" size={16} gold={false} /> {adding ? SAMPLE_COPY.adding : SAMPLE_COPY.add}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  )
}
