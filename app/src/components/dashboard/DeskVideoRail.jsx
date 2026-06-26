// "From the Desk" — a horizontal video rail on the Dashboard. Leads with the
// user's Continue Watching, fills with the newest videos. Clicking a card opens
// it in the persistent Desk player. Renders nothing when there's nothing to show.
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import useSWR from 'swr'
import { useNavigate } from 'react-router-dom'
import { subscribe, getSnapshot, hydrateFromServer } from '../../pages/desk/videoProgress'
import { play as playVideo } from '../video/videoStore'
import { GraduationIcon, PlayIcon } from '../../pages/education/icons'
import { buildRail } from './buildRail'
import styles from './DeskVideoRail.module.css'

const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))
const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

export default function DeskVideoRail() {
  const navigate = useNavigate()
  const { data, error, isLoading } = useSWR('/api/education/videos', fetcher)
  const progress = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => { hydrateFromServer() }, [])

  const items = useMemo(() => buildRail(data?.categories || [], progress), [data, progress])

  if (isLoading || error || items.length === 0) return null

  const open = (item) => {
    playVideo(item.list, item.index)
    navigate('/desk?section=videos')
  }

  return (
    <section className={styles.rail} aria-label="From the Desk videos">
      <div className={styles.head}>
        <span className={styles.headIcon} aria-hidden="true"><GraduationIcon size={18} /></span>
        <span className={styles.headTitle}>From the Desk</span>
        <button className={styles.viewAll} onClick={() => navigate('/desk?section=videos')}>
          View all →
        </button>
      </div>
      <div className={styles.scroll}>
        {items.map((item) => (
          <button
            key={item.video.youtube_id}
            className={styles.card}
            onClick={() => open(item)}
            aria-label={`Play ${item.video.title}`}
          >
            <span className={styles.thumbWrap}>
              <img className={styles.thumb} src={thumb(item.video.youtube_id)} alt="" loading="lazy" />
              <span className={styles.playOverlay} aria-hidden="true"><PlayIcon /></span>
              {item.resume && <span className={styles.resumePill}>Resume</span>}
              {item.pct > 0 && (
                <span className={styles.progressBar}>
                  <span className={styles.progressFill} style={{ width: `${item.pct}%` }} />
                </span>
              )}
            </span>
            <span className={styles.cardTitle}>{item.video.title}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
