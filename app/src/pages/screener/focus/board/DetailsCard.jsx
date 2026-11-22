// The scan board's "Why it's here" widget: the selected stock as a card. It carries what
// ChartPane's header, tags and "Why it's here" strip carry today, laid top to bottom, with News as
// a second tab (the chart widget's own News & Catalysts widget is portalled into `setNewsEl`).
import { useState } from 'react'
import { setupLine } from '../setupLine'
import { earningsText } from '../dates'
import { paneFacts } from '../ChartPane'
import focus from '../FocusScreener.module.css'
import s from './Board.module.css'

const BUSY_TITLE = 'Waiting for the new screen to load'

const MAX_RULES = 4

export default function DetailsCard({ row, why, now, onOpenFilters, onFlag, isFlagged, onWatch, structures, theme = null, busy = false, news = false, setNewsEl }) {
  const [tab, setTab] = useState('why')
  const showNews = news && tab === 'news'
  const head = (
    <div className={s.dTabs} role="tablist" aria-label="Stock details">
      <button type="button" role="tab" aria-selected={!showNews} className={!showNews ? s.dTabOn : s.dTab} onClick={() => setTab('why')}>Why it&apos;s here</button>
      {news && <button type="button" role="tab" aria-selected={showNews} className={showNews ? s.dTabOn : s.dTab} onClick={() => setTab('news')}>News</button>}
    </div>
  )
  // The news host stays mounted (hidden) so the portalled widget keeps its state between tabs.
  const newsHost = news ? <div ref={setNewsEl} className={showNews ? s.dNews : s.hidden} /> : null
  if (!row) return <section className={`${s.widget} ${s.details}`}>{head}<p className={s.dEmpty}>Pick a stock from the list</p>{newsHost}</section>
  const st = setupLine(row, structures)
  const factText = paneFacts(row)
  const earn = earningsText(row.next_earnings_date, now)
  const industry = row.industry || row.sector
  return (
    <section className={`${s.widget} ${s.details}`} aria-label={`${row.ticker} details`} data-testid="board-details">
      {head}
      {newsHost}
      {!showNews && (
        <div className={s.dBody}>
          <div className={s.dHead}>
            <span className={s.dTicker}>{row.ticker}</span>
            <span className={s.dSub}>{[row.company, industry].filter(Boolean).join(' · ')}</span>
          </div>
          <div className={s.dTags}>
            <span className={focus.setupTag} title={st.title || undefined}>{st.text}</span>
            {st.detail && <span className={focus.setupTag}>{st.detail}</span>}
            {theme && <span className={focus.setupTag}>{theme}</span>}
            {earn && <span className={earn.soon ? focus.paneEarnSoon : focus.paneFacts}>{earn.text}</span>}
          </div>
          {factText && <p className={s.dFacts}>{factText}</p>}
          {why?.items?.length > 0 && (
            <ul className={s.dWhy}>
              {why.items.slice(0, MAX_RULES).map((it, i) => (
                <li key={i} className={s.dWhyItem}>
                  <span aria-hidden="true" className={it.kind === 'check' ? focus.whyCheck : focus.whyPool}>{it.kind === 'check' ? '✓' : '○'}</span>
                  <span className={s.dWhyText}>{it.label}</span>
                  {it.value && <span className={s.dWhyValue}>{it.value}</span>}
                </li>
              ))}
              {why.items.length - MAX_RULES + (why.more || 0) > 0 && <li><button type="button" className={focus.linkBtn} onClick={onOpenFilters}>Show all {why.items.length + (why.more || 0)} rules</button></li>}
            </ul>
          )}
          <div className={s.dActions}>
            <button type="button" className={`${isFlagged ? focus.btnOn : focus.btn} ${busy ? focus.btnBusy : ''}`} aria-pressed={!!isFlagged}
              aria-disabled={busy ? 'true' : undefined} title={busy ? BUSY_TITLE : undefined} onClick={() => onFlag(row)}>Flag</button>
            <button type="button" className={`${focus.btnPrimary} ${busy ? focus.btnBusy : ''}`}
              aria-disabled={busy ? 'true' : undefined} title={busy ? BUSY_TITLE : undefined} onClick={() => onWatch(row)}>Add to watchlist</button>
          </div>
        </div>
      )}
    </section>
  )
}
