// Go-live wave 1, fix round 1 (first-open bytes): the notes list's two sample-notebook hooks, without the sample's
// client (sampleNotebook.js) on the Notebook's first open. The add action fetches that client on the press; whether the
// door is offered reads only the preference (sampleNotebookKeys.js). The door itself (SampleNotebookDoor.jsx) is a
// lazy chunk of the zero-notes state.
import { useState } from 'react'
import { useSWRConfig } from 'swr'
import usePreferences from '../../../../../hooks/usePreferences'
import { useIsPaid } from '../../../../../context/AuthContext'
import { notebookFlag } from '../../../lib/offline/notebookFlags'
import { importWithOneRetry } from '../../../lib/lazyChunk'
import { SAMPLE_PREF, readSamplePref } from './sampleNotebookKeys'

/** The sample's client, on demand (a named-export module: accepted when it carries the add action). */
export const loadSampleNotebook = () => importWithOneRetry(() => import('./sampleNotebook'), undefined,
  (m) => typeof m?.addSampleNotebook === 'function')

/** The add action, shared by the door and the get-started list's sample step: `{ add, adding, error }`. */
export function useAddSampleNotebook({ onOpenNote } = {}) {
  const { mutate } = useSWRConfig()
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const add = async () => {
    if (adding) return
    setAdding(true)
    setError('')
    let m
    try { m = await loadSampleNotebook() } catch {
      setAdding(false)
      setError("We couldn't add the sample notebook. Try again in a moment.")
      return
    }
    const out = await m.addSampleNotebook()
    setAdding(false)
    if (!out.ok) {
      setError(out.message)
      return
    }
    mutate(m.isNotebookKey)
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
