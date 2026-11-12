// Notebook simplify, Task 5 ("open on your notes"): "Add a sample notebook" for a member with no notes, in the notes
// list's empty state beside "Import notes". It was Research home's first-run door; Research home is no longer routed,
// so the door moved here, running the same action (`addSampleNotebook`, then every Notebook read refreshed and the
// welcome note opened) under the same rule: only while `notebook_onboarding_enabled` is on, for a paid member who has
// never had the sample (its ids are recorded in `notebook_sample`).
import { useState } from 'react'
import { useSWRConfig } from 'swr'
import UIcon from '../../../../../components/ui/UIcon'
import usePreferences from '../../../../../hooks/usePreferences'
import { useIsPaid } from '../../../../../context/AuthContext'
import { notebookFlag } from '../../../lib/offline/notebookFlags'
import { SAMPLE_COPY, SAMPLE_PREF, addSampleNotebook, isNotebookKey, readSamplePref } from './sampleNotebook'

/** The add action, shared by the door and the get-started list's sample step: `{ add, adding, error }`. */
export function useAddSampleNotebook({ onOpenNote } = {}) {
  const { mutate } = useSWRConfig()
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const add = async () => {
    if (adding) return
    setAdding(true)
    setError('')
    const out = await addSampleNotebook()
    setAdding(false)
    if (!out.ok) {
      setError(out.message)
      return
    }
    mutate(isNotebookKey)
    if (out.welcomeNoteId) onOpenNote?.({ id: out.welcomeNoteId })
  }
  return { add, adding, error }
}

/** Whether the door is offered: the onboarding switch, a paid member, and no sample recorded yet. */
export function useCanAddSample() {
  const isPaid = useIsPaid()
  const { prefs } = usePreferences()
  const onboarding = notebookFlag('notebook_onboarding_enabled') === true
  return onboarding && isPaid && !readSamplePref(prefs?.[SAMPLE_PREF])
}

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
