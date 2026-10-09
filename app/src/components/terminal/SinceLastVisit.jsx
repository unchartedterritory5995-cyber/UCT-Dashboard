// The two pieces a panel draws for "new since your last visit" (wave 3 lane 13, #7): the NEW tag on
// an item and the one line above the list ("4 new since Tue 3:12 PM ET" / "First visit ...").
// The state comes from useSinceLastVisit; with it off or unavailable both render nothing.
import { etVisitLabel } from './useSinceLastVisit'
import styles from './SinceLastVisit.module.css'

export function NewTag({ since, itemKey }) {
  if (!since?.isNew?.(itemKey)) return null
  return <span className={styles.tag} title="Arrived since your last visit" data-testid="since-new">NEW</span>
}

export function SinceLine({ since, noun = 'item', plural = `${noun}s`, testId = 'since-line' }) {
  if (!since || since.status === 'off' || since.status === 'unavailable' || since.status === 'pending') return null
  if (since.status === 'first') {
    return (
      <p className={styles.line} role="status" data-testid={testId}>
        First visit: nothing is marked new yet. Next time, anything that arrives after now gets a NEW tag.
      </p>
    )
  }
  const when = etVisitLabel(since.lastVisitAt) || 'your last visit'
  const n = since.count
  return (
    <p className={styles.line} role="status" data-testid={testId}>
      {n ? <><strong>{n} new {n === 1 ? noun : plural}</strong> since {when}.</> : <>Nothing new since {when}.</>}
    </p>
  )
}
