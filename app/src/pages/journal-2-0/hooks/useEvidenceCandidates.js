import useSWR from 'swr'

// ⛔ THE EVIDENCE PICKER'S SOURCE LIST (Wave N).
//
// ⚰️ It used to be `useNoteExcerpts` — `list_note_excerpts`, which joins the
// `j2_note_excerpt_refs` sidecar that `notes.py` REBUILDS FROM `documentExcerpt`
// NODES IN THE NOTE BODY. A captured web passage never embeds one, so it had no
// ref and the member could never pick it, even though the evidence API accepted
// it perfectly. BUILT + GREEN + MEMBER-UNREACHABLE.
//
// ⭐ This asks the other question — what does the note OWN that could serve as
// evidence — and every candidate carries its own `sourceKind`, so the picker can
// say what it is instead of formatting `· p.N` over a capture ordinal.
const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => {
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
})

export default function useEvidenceCandidates(noteId, { q = '', enabled = true } = {}) {
  const url = enabled && noteId
    ? `/api/j2/notes/${encodeURIComponent(noteId)}/evidence-candidates`
      + (q ? `?q=${encodeURIComponent(q)}` : '')
    : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
  })
  return {
    candidates: data?.candidates || [],
    isLoading: Boolean(url) && isLoading,
    error,
    refresh: mutate,
  }
}
