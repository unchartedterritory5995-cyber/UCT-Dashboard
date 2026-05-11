/**
 * Returns the most-recent EOD recap for the current account whose
 * metadata.viewed_at is unset. Used by the cross-tab notification banner.
 */

import useJ2EODRecaps from './useJ2EODRecaps'

export default function useJ2UnviewedEOD(accountId) {
  const { recaps, isLoading } = useJ2EODRecaps(accountId)
  if (!recaps || recaps.length === 0) {
    return { unviewed: null, isLoading }
  }
  const found = recaps.find((r) => !r?.metadata?.viewed_at)
  return { unviewed: found || null, isLoading }
}
