/**
 * StudyGallery — many examples of ONE subject on one screen, each on the
 * firm's own chart, with a four-grade row under every one (owner 2026-10-21:
 * "I want to see a ton of examples so we can distinguish what is okay, good,
 * and great, and bad and use the ones that teach the lesson the best").
 *
 *   GET  /api/study/admin/review?skill=&status=any&limit=500   every item of the skill
 *   POST /api/study/admin/review/{id}  {action:'grade', after:'okay'|'good'|'great'}
 *   POST /api/study/admin/review/{id}  {action:'reject', reason:'bad chart'}   ("Bad")
 *
 * Items are grouped by the prompt's `subject` (a candle name, a chart word);
 * one subject renders at a time so the page never mounts hundreds of charts.
 * A grade lives in reveal_json.example_grade and never changes the review
 * status; "Bad" is a reject. The bars come from the same admin route the
 * review card uses, normalised the same way, drawn with the house look.
 */
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import StockChart from '../../components/StockChart'
import { appendForwardBars, normalizeBars } from '../study/useStudySession'
import { studySettingsOverride, HOUSE_CHART_URL } from '../study/studyChartLook'
import { chartFrameOf, REVIEW_URL } from './StudyReview'
import { GRADES, galleryKey, subjectOf } from './studyGalleryHelpers'
import styles from './StudyReview.module.css'

const GOLD = '#dcbb5e'
const STATUS_RANK = { approved: 0, draft: 1, rejected: 2 }

const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => {
  if (!r.ok) {
    const e = new Error(`HTTP ${r.status}`)
    e.status = r.status
    throw e
  }
  return r.json()
})

function hasChart(item) {
  return !!(item && item.sym && item.asof && !item.prompt_json?.image_url)
}

async function post(id, body) {
  const r = await fetch(`${REVIEW_URL}/${encodeURIComponent(id)}`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

function GalleryCard({ item, houseSettings, onChanged }) {
  const barsKey = `/api/study/admin/items/${encodeURIComponent(item.id)}/bars`
  // No automatic retry: a gallery mounts a whole subject's cards at once, and
  // retrying each failed one three times multiplies the reads that hit the
  // rate limit in the first place. A failed card offers Retry instead.
  const { data: stored, error, mutate: retryBars } = useSWR(barsKey, fetcher, {
    revalidateOnFocus: false, shouldRetryOnError: false,
  })
  // 404 is the route's own answer for an item with no stored chart; any other
  // failure (a 429, a 5xx, the network) says nothing about the data.
  const noStoredBars = error?.status === 404
  const bars = useMemo(() => {
    if (!stored || !Array.isArray(stored.bars) || !stored.bars.length) return null
    return appendForwardBars(normalizeBars(stored), stored.forward)
  }, [stored])
  const frame = useMemo(() => chartFrameOf(item), [item])
  const settingsOverride = useMemo(() => studySettingsOverride(item.prompt_json?.chart, houseSettings), [item, houseSettings])
  const markers = useMemo(
    () => [{ time: item.asof, position: 'aboveBar', color: GOLD, shape: 'arrowDown', text: 'here', id: 'study-asof' }],
    [item.asof],
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const grade = item.reveal_json?.example_grade || null
  const status = item.review_status || 'draft'

  const act = async (body) => {
    setBusy(true)
    setErr(null)
    try {
      const res = await post(item.id, body)
      onChanged?.(res?.item || null)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className={styles.gCard} data-testid="gallery-card" data-status={status} data-grade={grade || ''}>
      <header className={styles.gHead}>
        <span className={styles.gSym}>{item.sym}</span>
        <span className={styles.gDate}>{item.asof}</span>
        <span className={`${styles.gStatus} ${styles[`gSt_${status}`] || ''}`}>{status}</span>
        {grade && <span className={styles.gGrade}>{grade}</span>}
      </header>
      <div className={styles.gChart}>
        {!error ? (
          <StockChart
            sym={item.sym}
            tf={stored?.tf || item.prompt_json?.chart?.tf || 'D'}
            height={210}
            studyMode
            barsOverride={bars}
            barsOverridePending={!stored && !error}
            liveUpdates={false}
            backgroundWarm={false}
            frozen
            hideWatermark
            showBrandMark={false}
            disablePatterns
            hideJournalOverlay
            hideCompare
            hideLegend
            showDrawingTools={false}
            entryDate={frame?.entryDate || null}
            exitDate={frame?.exitDate || null}
            exactDateRange
            settingsOverride={settingsOverride}
            markers={markers}
          />
        ) : noStoredBars ? (
          <div className={styles.gNoBars}>No stored bars</div>
        ) : (
          <div className={styles.gNoBars}>
            Could not load the bars ({error.message}).{' '}
            <button type="button" className={styles.gBtn} onClick={() => retryBars()}>Retry</button>
          </div>
        )}
      </div>
      <div className={styles.gGrades} role="group" aria-label={`Grade ${item.sym} ${item.asof}`}>
        <button type="button" className={`${styles.gBtn} ${styles.gBad}`} disabled={busy || status === 'rejected'}
          onClick={() => act({ action: 'reject', reason: 'bad chart' })}>Bad</button>
        {GRADES.map((g) => (
          <button key={g} type="button" className={`${styles.gBtn} ${grade === g ? styles.gBtnOn : ''}`} disabled={busy}
            onClick={() => act({ action: 'grade', after: g })}>{g[0].toUpperCase() + g.slice(1)}</button>
        ))}
      </div>
      {err && <span className={styles.err}>{err}</span>}
    </article>
  )
}

export default function StudyGallery({ skill }) {
  const key = galleryKey(skill)
  const { data, error, mutate } = useSWR(key, fetcher, { revalidateOnFocus: false })
  const { data: houseData } = useSWR(HOUSE_CHART_URL, fetcher, { revalidateOnFocus: false, shouldRetryOnError: false })
  const houseSettings = houseData?.chart_settings || null
  const items = useMemo(() => (data?.drafts || []).filter(hasChart), [data])
  const subjects = useMemo(() => {
    const m = new Map()
    for (const it of items) {
      const sname = subjectOf(it)
      const row = m.get(sname) || { name: sname, n: 0, graded: 0, rejected: 0 }
      row.n += 1
      if (it.reveal_json?.example_grade) row.graded += 1
      if (it.review_status === 'rejected') row.rejected += 1
      m.set(sname, row)
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [items])
  const [subject, setSubject] = useState('')
  const current = subject || subjects[0]?.name || ''
  // the live examples first (approved, then drafts), the retired ones last
  const shown = useMemo(
    () => items.filter((it) => subjectOf(it) === current)
      .sort((a, b) => (STATUS_RANK[a.review_status] ?? 1) - (STATUS_RANK[b.review_status] ?? 1)),
    [items, current],
  )

  const onChanged = (updated) => {
    if (!updated) return mutate()
    return mutate(
      (cur) => (cur && Array.isArray(cur.drafts)
        ? { ...cur, drafts: cur.drafts.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)) }
        : cur),
      { revalidate: false },
    )
  }

  if (error) return <div className={styles.empty}>Could not load the gallery ({error.message}).</div>
  if (!data) return <div className={styles.empty}>Loading the gallery…</div>

  return (
    <section className={styles.gallery} aria-label="Example gallery">
      <div className={styles.gBar}>
        <label className={styles.filter}>
          <span>Subject</span>
          <select aria-label="Subject" className={styles.select} value={current} onChange={(e) => setSubject(e.target.value)}>
            {subjects.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.n}{s.graded ? ` · ${s.graded} graded` : ''}{s.rejected ? ` · ${s.rejected} bad` : ''})
              </option>
            ))}
          </select>
        </label>
        <span className={styles.gHint}>
          Grade every chart: Bad rejects it; Okay / Good / Great are kept and the best ones lead the lesson.
        </span>
      </div>
      {shown.length === 0 && <div className={styles.empty}>No chart items for this skill.</div>}
      <div className={styles.gGrid}>
        {shown.map((it) => <GalleryCard key={it.id} item={it} houseSettings={houseSettings} onChanged={onChanged} />)}
      </div>
    </section>
  )
}
