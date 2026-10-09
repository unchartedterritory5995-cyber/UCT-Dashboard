// `CN MINE` (wave 3 lane 13, product item #6): news across ALL of the member's own names, in the
// terminal's CN panel. No new route and no per-name fan-out: the market news feed (`/api/news`,
// cached server-side and warmed on boot) filtered to "your names" (hooks/useMyTickers -- the
// calendar's My Stocks set), the same read the My Stocks hub already makes.
import useMobileSWR from '../../../hooks/useMobileSWR'
import useMyTickers from '../../../hooks/useMyTickers'
import jsonFetcher from '../../../utils/jsonFetcher'
import { MineEmpty } from '../../../components/terminal/MineChip'
import PanelSymbol from '../../../components/terminal/PanelSymbol'
import ResearchLoading from '../ResearchLoading'
import styles from '../ResearchPage.module.css'

export const MARKET_NEWS_URL = '/api/news'
const MAX_ITEMS = 60

/** Pure: the market-feed stories that name at least one of `syms`, each with the names it matched. */
export function mineStories(items, syms) {
  if (!Array.isArray(items) || !syms || !syms.size) return []
  const out = []
  for (const it of items) {
    if (!it || !it.headline || it.error) continue
    const hit = (Array.isArray(it.tickers) ? it.tickers : [])
      .map((t) => String(t || '').toUpperCase()).filter((t) => syms.has(t))
    if (hit.length) out.push({ ...it, mine: [...new Set(hit)] })
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

export default function MyNewsList({ whenLabel, renderMark = null }) {
  const names = useMyTickers()
  const { data, error, mutate } = useMobileSWR(MARKET_NEWS_URL, jsonFetcher, {
    refreshInterval: 10 * 60 * 1000, revalidateOnFocus: false,
  })
  if (names.state === 'loading' || (!data && !error)) return <ResearchLoading label="Loading news on your names" />
  if (error && !data) {
    return (
      <div className={styles.fnote} data-testid="mynews-error">
        Couldn&apos;t load the news feed.{' '}
        <button type="button" className={styles.basisBtn} onClick={() => mutate()}>Retry</button>
      </div>
    )
  }
  const stories = mineStories(data, names.syms)
  if (!stories.length) {
    return (
      <MineEmpty state={names.state === 'error' ? 'error' : 'ready'} what="is in the news feed right now"
        explainer={names.explainer} testId="mynews-empty" />
    )
  }
  return (
    <section className={styles.card}>
      <div className={styles.ct}>News on your names</div>
      <ul className={styles.newsList} data-testid="mynews-list">
        {stories.map((it, i) => (
          <li key={`${it.url || it.headline}-${i}`} className={styles.newsItem} data-panel-row>
            <div className={styles.newsBody}>
              <div className={styles.newsMeta}>
                {renderMark ? renderMark(it) : null}
                {it.mine.map((s) => <PanelSymbol key={s} sym={s} />)}
                <span className={styles.newsPub}>{it.source || 'Unknown source'}</span>
                <span className={styles.newsWhen}>{whenLabel(it.time)}</span>
              </div>
              <a className={styles.newsTitle} href={it.url} target="_blank" rel="noopener noreferrer">{it.headline}</a>
            </div>
          </li>
        ))}
      </ul>
      <p className={styles.fnote}>{names.explainer}</p>
    </section>
  )
}
