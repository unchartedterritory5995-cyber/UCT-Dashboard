// useTagColors.js — TAG_COLORS merged with user-customized labels from preferences
import { useMemo } from 'react'
import { TAG_COLORS } from '../constants/tagColors'
import usePreferences from './usePreferences'

export default function useTagColors() {
  const { prefs, setPref } = usePreferences()

  const tagColors = useMemo(() => {
    let custom = {}
    try { custom = JSON.parse(prefs.tag_labels || '{}') } catch {}
    return TAG_COLORS.map(tc => ({
      ...tc,
      label: custom[tc.key] || tc.label,
    }))
  }, [prefs.tag_labels])

  const tagByKey = useMemo(
    () => Object.fromEntries(tagColors.map(t => [t.key, t])),
    [tagColors]
  )

  const setTagLabel = (key, label) => {
    let current = {}
    try { current = JSON.parse(prefs.tag_labels || '{}') } catch {}
    const next = { ...current, [key]: label }
    setPref('tag_labels', JSON.stringify(next))
  }

  return { tagColors, tagByKey, setTagLabel }
}
