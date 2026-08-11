// app/src/components/research/sections/AskAiSection.jsx
//
// The modal's Ask AI panel — the last rail section, under News and Filings.
//
// Every other section PRESENTS what we hold about this print. This one answers a
// question the reader brought, so it composes the app's existing AI Search
// rather than growing a second chat implementation: `AiSearchWidget` already
// owns streaming, citations, clickable tickers, copy/save, follow-ups, voice
// input, the daily-limit message and the retention disclaimer. Re-implementing
// any of that here would put a second authority on all of it.
//
// Nothing is asked until the reader asks it — no auto-run. `/api/ai-search` is
// paid-gated with a daily cap, and opening a tab should not spend one.
import { useCallback, useMemo, useState } from 'react'

import AiSearchWidget from '../../../pages/charts/widgets/AiSearchWidget'
import TickerPopup from '../../TickerPopup'
import { suggestionsFor } from '../askAiSuggestions'
import { getThread, setThread } from '../askAiThreads'
import styles from './AskAiSection.module.css'

export default function AskAiSection({ sym, lifecycle }) {
  const suggestions = useMemo(() => suggestionsFor({ sym, lifecycle }), [sym, lifecycle])
  const onThread = useCallback((thread) => setThread(sym, thread), [sym])

  // Answers render tickers as buttons. Inside the /charts workspace those load
  // the widget's colour group; here there is no workspace, so `handleTicker`
  // fell through to a no-op FALLBACK and every ticker in an answer was a button
  // that did NOTHING when clicked.
  //
  // It opens the chart IN PLACE rather than navigating: the owner removed this
  // modal's last route out on 2026-08-09 because it dropped the reader onto a
  // new page mid-read. TickerPopup's controlled mode exists for exactly this —
  // a click source that isn't a React child it can wrap.
  const [chartSym, setChartSym] = useState(null)

  // `key` on the SYMBOL is the reset: stepping AAPL → MSFT remounts the widget,
  // so an AAPL answer can never sit under an MSFT banner reading as MSFT's. The
  // restore is keyed the same way, so what comes back is this company's or
  // nothing.
  return (
    <div className={styles.panel} data-testid="erm-ask-ai">
      <AiSearchWidget
        key={sym || 'blank'}
        scope={{ sym, suggestions }}
        chrome={false}
        initialThread={getThread(sym)}
        onThread={onThread}
        onTicker={setChartSym}
      />
      {chartSym && (
        <TickerPopup sym={chartSym} open onClose={() => setChartSym(null)} />
      )}
    </div>
  )
}
