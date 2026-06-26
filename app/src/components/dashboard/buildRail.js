// Pure derivation of the dashboard "From the Desk" rail from the education API
// payload + watch progress. Continue Watching (in-progress) first, then the
// newest videos. Mirrors VideosSection's Continue Watching rule (>= 8s, !done).
const MIN_RESUME = 8

export function buildRail(categories = [], progress = {}, cap = 12) {
  const cats = Array.isArray(categories) ? categories : []
  const seen = new Set()
  const resume = []

  // Pass 1 — in-progress (resume) videos, and mark finished ones as handled.
  for (const cat of cats) {
    const list = cat.videos || []
    list.forEach((video, index) => {
      const id = video.youtube_id
      if (!id || seen.has(id)) return
      const e = progress[id]
      if (e && e.done) { seen.add(id); return } // never surface finished videos
      if (e && (e.t || 0) >= MIN_RESUME) {
        seen.add(id)
        const pct = e.d ? Math.min(100, Math.round((e.t / e.d) * 100)) : 0
        resume.push({ video, list, index, pct, resume: true, _at: e.at || 0 })
      }
    })
  }
  resume.sort((a, b) => b._at - a._at)

  // Pass 2 — everything else, newest by created_at.
  const latest = []
  for (const cat of cats) {
    const list = cat.videos || []
    list.forEach((video, index) => {
      const id = video.youtube_id
      if (!id || seen.has(id)) return
      seen.add(id)
      latest.push({ video, list, index, pct: 0, resume: false, _ts: video.created_at || 0 })
    })
  }
  latest.sort((a, b) => b._ts - a._ts)

  return [...resume, ...latest]
    .slice(0, cap)
    .map(({ _at, _ts, ...item }) => item)
}
