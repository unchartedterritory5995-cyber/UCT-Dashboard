// The community library's Helpful toggle, shared by StyleLibraryCard.jsx and LayoutLibraryCard.jsx (P4b review M-1:
// one copy of the rule, not two). Lazy-only, like the cards that use it.
//
// The local values hold only until the next answer: they re-seed from the server when the item changes (a different item,
// or a refresh that brings another member's vote) (P3a review M-6). A refusal is the server's sentence, otherwise ours.
import { useState } from 'react'
import { markHelpful } from '../../lib/styleLibrary'
import { libraryError } from './styles/styleErrors'

/** A sentence ends with a stop: the credit the server sends may or may not carry one. */
export const withStop = (s) => (/[.!?]$/.test(s) ? s : `${s}.`)

/** `{helped, helpfulCount, voting, toggleHelpful}` for one library item. */
export function useHelpfulToggle(item, onMessage) {
  const [helped, setHelped] = useState(Boolean(item.helpedByMe))
  const [helpfulCount, setHelpfulCount] = useState(Number(item.helpfulCount) || 0)
  const seed = `${item.id}|${Boolean(item.helpedByMe)}|${Number(item.helpfulCount) || 0}`
  const [seenSeed, setSeenSeed] = useState(seed)
  if (seed !== seenSeed) {
    setSeenSeed(seed)
    setHelped(Boolean(item.helpedByMe))
    setHelpfulCount(Number(item.helpfulCount) || 0)
  }
  const [voting, setVoting] = useState(false)

  const toggleHelpful = async () => {
    if (voting) return
    setVoting(true)
    try {
      const out = await markHelpful(item.id, !helped)
      setHelped(Boolean(out?.helpful))
      setHelpfulCount(Number(out?.count) || 0)
    } catch (err) {
      onMessage?.({ tone: 'error', text: libraryError(err, `Couldn't record that for "${item.title}". Nothing was changed.`) })
    } finally {
      setVoting(false)
    }
  }

  return { helped, helpfulCount, voting, toggleHelpful }
}
