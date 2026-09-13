import useSWR, { mutate as globalMutate } from 'swr'

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

/** ⛔ ONE authority for this endpoint's URL. The refresher below has to name
 *  the same key the hook subscribes to, and two hand-written copies of a URL
 *  is how a cache invalidation quietly stops matching anything. */
export function evidenceCandidatesUrl(noteId, q = '') {
  const base = `/api/j2/notes/${encodeURIComponent(noteId)}/evidence-candidates`
  return q ? `${base}?q=${encodeURIComponent(q)}` : base
}

/** ⚰️ WAVE P5 — SAVING A PASSAGE HAS TO REACH THE PICKER THAT OFFERS IT.
 *
 * Found by driving the whole journey on a phone in one sitting: save an
 * excerpt from a scanned page, then open Add evidence, and the picker said
 * "Capture a passage from the web, or save an excerpt from a PDF, in this
 * note first" — about the passage saved forty seconds earlier. The server was
 * right the whole time (`/evidence-candidates` returned the row); the list is
 * subscribed from note-open with `revalidateOnFocus: false`, and nothing on
 * the save path invalidated it, so the browser kept serving the empty answer
 * it cached before the excerpt existed. A reload fixed it — which is exactly
 * why no rail and no earlier pass caught it: every check that reloads first
 * sees a working picker.
 *
 * Invalidates every query variant, not just the bare URL: the picker holds a
 * second, `?q=`-filtered subscription while the member is searching. */
export function refreshEvidenceCandidates(noteId) {
  if (!noteId) return Promise.resolve()
  const base = evidenceCandidatesUrl(noteId)
  return globalMutate(
    (key) => typeof key === 'string' && (key === base || key.startsWith(`${base}?`)),
  )
}

export default function useEvidenceCandidates(noteId, { q = '', enabled = true } = {}) {
  const url = enabled && noteId ? evidenceCandidatesUrl(noteId, q) : null
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
