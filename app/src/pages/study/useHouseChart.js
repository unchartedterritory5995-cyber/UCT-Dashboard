/**
 * useHouseChart(fetcher) — the owner's chart_settings blob for the Study
 * charts, fetched once per mount and failing OPEN to null (the house look
 * still applies over the defaults, so a lookup can never cost a member the
 * chart). Takes the session's fetcher so a test feeds it like every other call.
 */
import { useEffect, useState } from 'react'
import { studyFetch } from './useStudySession'
import { HOUSE_CHART_URL } from './studyChartLook'

export default function useHouseChart(fetcher = studyFetch) {
  const [settings, setSettings] = useState(null)
  useEffect(() => {
    let alive = true
    Promise.resolve()
      .then(() => fetcher(HOUSE_CHART_URL))
      .then((j) => { if (alive) setSettings(j?.chart_settings || null) })
      .catch(() => { if (alive) setSettings(null) })
    return () => { alive = false }
  }, [fetcher])
  return settings
}
