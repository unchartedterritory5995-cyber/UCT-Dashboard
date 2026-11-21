// FUND: one company's metrics over time, point in time from its SEC filings (revenue, EPS, margins,
// cash flow, valuation), and up to three more companies beside it. `NVDA FUND`.
//
//   NVDA FUND               the default six rows (revenue TTM, EPS TTM, revenue growth, net margin,
//                           FCF margin, P/E), one column per fiscal quarter, newest first
//   NVDA FUND AMD AVGO      the same rows for each company, quarters lined up by calendar quarter
//   FUND NVDA AMD AVGO      the same (the first ticker is the main one)
//   NVDA FUND PE            P/E as a line over every quarter held
//   NVDA FUND REV+EPS+ROE   the table's rows (up to 12, words in fundMetricsModel.js)
//
// Reads, all through the terminal's one reader (marketRead.js; SWR skips ticks while the app is hidden):
//   GET /api/fundamentals/pit/catalog                  the metrics library, read first
//   GET /api/fundamentals/pit/series/{SYM}?series=...  one per company, after the catalog answered
//   GET /api/bars/{SYM}?tf=W&bars=600                  only when a valuation metric is on screen
// (api/routers/fundamentals_pit.py: FUNDAMENTALS_PIT_ENABLED, require_bars_access; api/routers/bars.py.)
// Nothing is computed on the server for this panel and no route was added. The pure half is
// fundMetricsModel.js.
//
// ⛔ A MISSING NUMBER IS NEVER 0: a series the company does not have, a quarter it did not file and a
//    figure its filing does not give are words, row by row and cell by cell.
// ⛔ THE FEATURE SWITCHED OFF FOR THIS SERVER (404 from the catalog) IS SAID, never an empty panel.
// ⛔ A CHOICE IS KEPT BY THE BOARD: the compared tickers, the rows and the line's metric are written
//    back into the panel's own command (usePanelWriteBack), never into browser storage.
//
// WIDTH. The period table scrolls sideways inside its own box (SidewaysScroll) with the label column
// pinned; the panel itself never scrolls sideways. The toolbar, the picker and the compare row wrap.
import { useId, useMemo, useState } from 'react'
import { PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import Checkbox from '../../../components/ui/Checkbox'
import FieldError from '../../../components/ui/FieldError'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import SidewaysScroll from '../../../components/research/fmpDepth/SidewaysScroll'
import { isWarmingError, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  DEFAULT_METRICS, FUND_CATALOG_URL, FUND_CODE, FUND_POLL_MS, FUND_SOURCE, FUND_SOURCE_LINE, MAX_METRICS, MAX_PEERS,
  TABLE_QUARTERS, WORD_OF_METRIC, barsUrl, companyOf, dateText, etDay, fundCommandArgs, fundFailure, fundLine, fundView,
  lagNote, metricSub, normMetrics, normPeers, ownLimitations, peerInput, pricesOf, readCatalog, seriesIdsFor, seriesUrl,
  shownColumns, unitWords, valuationNote,
} from './fundMetricsModel'
import styles from './marketPanels.module.css'
import form from './panelForm.module.css'
import own from './fundMetricsPanel.module.css'

export { FUND_CATALOG_URL, FUND_CODE, FUND_POLL_MS, FUND_SOURCE } from './fundMetricsModel'

const POLL = { refreshInterval: FUND_POLL_MS }
const LINE_CLASS = [own.line0, own.line1, own.line2, own.line3]

function MetricName({ m }) {
  return (
    <>
      <span className={own.name}>{m.name}</span>
      <span className={own.sub}>{metricSub(m)}</span>
    </>
  )
}

function Cell({ c, showDates }) {
  return (
    <td className={c.state === 'ok' ? own.cell : `${own.cell} ${own.none}`} title={c.words} data-state={c.state}>
      <span aria-hidden="true">{c.text}{c.revised ? <sup className={own.mark}>r</sup> : null}</span>
      <span className="sr-only">{c.words}</span>
      {showDates && c.line2 ? <span className={own.when} aria-hidden="true">{c.line2}</span> : null}
    </td>
  )
}

function PeriodTable({ groups, columns, compare, showDates, syms }) {
  const span = columns.length
  return (
    <div className={styles.tableBox}>
      <SidewaysScroll label="Company metrics by quarter, scrolls sideways">
        <table className={`${styles.table} ${own.periods}`} data-testid="terminal-fund-table"
          aria-label={compare ? `Metrics of ${syms.join(', ')} by calendar quarter, newest first` : `Metrics of ${syms[0]} by fiscal quarter, newest first`}>
          <thead>
            <tr>
              <th scope="col" className={own.label}>{compare ? 'Metric, ticker' : 'Metric'}</th>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={own.quarter} title={c.title} data-testid="terminal-fund-quarter">
                  <span className={own.qTop}>{c.top}</span>
                  <span className={own.qBottom}>{c.bottom}</span>
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.metric.id} data-testid={`terminal-fund-metric-${g.metric.word}`}>
              {compare ? (
                <tr className={own.groupHead}>
                  <th scope="rowgroup" className={own.label}><MetricName m={g.metric} /></th>
                  <td colSpan={span} />
                </tr>
              ) : null}
              {g.rows.map((r) => (
                <tr key={r.sym} data-testid={`terminal-fund-row-${g.metric.word}-${r.sym}`} data-state={r.words ? 'words' : 'cells'}>
                  <th scope="row" className={own.label}>{compare ? <PanelSymbol sym={r.sym} /> : <MetricName m={g.metric} />}</th>
                  {r.words ? (
                    <td colSpan={span} className={own.rowWords} data-testid="terminal-fund-row-words">
                      <span className={own.rowWordsText}>{r.words}</span>
                    </td>
                  ) : r.cells.slice(0, span).map((c, i) => <Cell key={columns[i].key} c={c} showDates={showDates} />)}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </SidewaysScroll>
    </div>
  )
}

function LinePicture({ line, compare }) {
  if (line.state !== 'ok') {
    return (
      <div className={own.figure} data-testid="terminal-fund-line-words" data-state={line.state}>
        {line.words.map((w) => <p key={w} className={styles.muted}>{w}</p>)}
      </div>
    )
  }
  const { geo } = line
  return (
    <figure className={own.figure} data-testid="terminal-fund-line">
      <figcaption className={own.figTitle}>{`${line.metric.name}, ${line.quarters} quarters`}</figcaption>
      <svg className={own.chart} viewBox={`0 0 ${geo.w} ${geo.h}`} preserveAspectRatio="none" role="img" aria-label={line.words.join(' ')}>
        {geo.zeroY != null ? <line className={own.zero} x1="0" x2={geo.w} y1={geo.zeroY} y2={geo.zeroY} vectorEffect="non-scaling-stroke" /> : null}
        {geo.lines.map((l, i) => <path key={l.key} className={`${own.line} ${LINE_CLASS[i] || ''}`} d={l.path} vectorEffect="non-scaling-stroke" data-sym={l.key} />)}
      </svg>
      <div className={own.axis} aria-hidden="true">
        <span>{line.fromText}</span>
        <span>{line.rangeText}</span>
        <span>{line.toText}</span>
      </div>
      {compare ? (
        <ul className={own.legend} aria-label="Lines" data-testid="terminal-fund-legend">
          {line.legend.map((l) => (
            <li key={l.sym} className={own.legendItem}>
              <svg className={own.swatch} viewBox="0 0 24 8" aria-hidden="true">
                <line className={`${own.line} ${LINE_CLASS[l.style] || ''}`} x1="0" y1="4" x2="24" y2="4" />
              </svg>
              <PanelSymbol sym={l.sym} />
              <span className={own.legendValue}>{l.last}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {line.words.map((w) => <p key={w} className={styles.muted} data-testid="terminal-fund-line-sentence">{w}</p>)}
    </figure>
  )
}

function Picker({ id, catalog, draft, onToggle, onApply, onDefault, onCancel }) {
  const full = draft.length >= MAX_METRICS
  return (
    <div id={id} className={own.picker} data-testid="terminal-fund-picker">
      <p className={styles.muted} data-testid="terminal-fund-picker-count">
        {`${draft.length} chosen. Up to ${MAX_METRICS} at once; every metric is from the catalog, with its unit and how it is measured.`}
      </p>
      <div className={own.cats}>
        {catalog.categories.map((cat) => (
          <fieldset key={cat} className={own.cat}>
            <legend className={own.catTitle}>{cat}</legend>
            {catalog.metrics.filter((m) => m.category === cat).map((m) => {
              const on = draft.includes(m.id)
              return (
                <label key={m.id} className={own.option} title={m.methodology || undefined} data-testid={`terminal-fund-pick-${m.word}`}>
                  <Checkbox checked={on} disabled={!on && full} onChange={() => onToggle(m.id)} />
                  <span className={own.optionText}>
                    <span className={own.optionName}>{m.name}</span>
                    <span className={own.optionSub}>{metricSub(m)}</span>
                  </span>
                </label>
              )
            })}
          </fieldset>
        ))}
      </div>
      <div className={styles.group}>
        <button type="button" className={styles.chip} onClick={onApply} disabled={!draft.length} data-testid="terminal-fund-apply">Apply</button>
        <button type="button" className={styles.chip} onClick={onDefault}>The default six</button>
        <button type="button" className={styles.chip} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function Compare({ peers, onRemove, onAdd }) {
  const inputId = useId()
  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  const submit = (e) => {
    e.preventDefault()
    const why = onAdd(text)
    setError(why)
    if (!why) setText('')
  }
  return (
    <div className={own.compare} data-testid="terminal-fund-compare">
      <span className={styles.muted}>{peers.length ? 'Compared with' : 'Compare with up to three more'}</span>
      {peers.map((p) => (
        <span key={p} className={own.peer} data-testid="terminal-fund-peer">
          <PanelSymbol sym={p} />
          <button type="button" className={styles.chip} onClick={() => onRemove(p)} aria-label={`Stop comparing ${p}`}>Remove</button>
        </span>
      ))}
      {peers.length < MAX_PEERS ? (
        <form className={form.form} onSubmit={submit} aria-label="Add a ticker to compare">
          <label className={form.field} htmlFor={inputId}>Add a ticker</label>
          <Input id={inputId} className={form.input} value={text} size={8} maxLength={9} autoComplete="off" spellCheck={false}
            error={error} onChange={(e) => { setText(e.target.value); setError(null) }} data-testid="terminal-fund-add-input" />
          <button type="submit" className={styles.chip}>Add</button>
          <FieldError forId={inputId} className={form.error}>{error}</FieldError>
        </form>
      ) : <span className={styles.muted} data-testid="terminal-fund-peers-full">{`Up to ${MAX_PEERS} more can be compared.`}</span>}
    </div>
  )
}

function FundBody({ sym, code, peers: peersProp, metrics: metricsProp, line: lineProp }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const pickerId = useId()
  const [clock] = useState(() => {
    const nowSec = Math.floor(Date.now() / 1000)
    return { nowSec, today: etDay(nowSec) }
  })
  const [peers, setPeers] = useState(() => normPeers(peersProp, sym))
  const [chosen, setChosen] = useState(() => normMetrics(metricsProp))
  const [lineId, setLineId] = useState(() => (lineProp && WORD_OF_METRIC[lineProp] ? lineProp : null))
  const [showDates, setShowDates] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [draft, setDraft] = useState(null)

  const syms = [sym, ...peers]
  const catalogRead = useMarketRead(FUND_CATALOG_URL, POLL)
  const catalog = useMemo(() => readCatalog(catalogRead.body), [catalogRead.body])
  const catOk = !!catalogRead.body && catalog.state === 'ok'
  const shownIds = useMemo(() => [...new Set([...chosen, ...(lineId ? [lineId] : [])])], [chosen, lineId])
  const ids = useMemo(() => (catOk ? seriesIdsFor(shownIds, catalog) : []), [catOk, catalog, shownIds])
  const urlOf = (i) => (catOk && syms[i] ? seriesUrl(syms[i], ids) : null)
  const s0 = useMarketRead(urlOf(0), POLL)
  const s1 = useMarketRead(urlOf(1), POLL)
  const s2 = useMarketRead(urlOf(2), POLL)
  const s3 = useMarketRead(urlOf(3), POLL)
  const seriesReads = [s0, s1, s2, s3]
  const companies = useMemo(
    () => syms.map((s, i) => companyOf(s, seriesReads[i])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syms.join(','), s0.body, s0.error, s0.loading, s1.body, s1.error, s1.loading, s2.body, s2.error, s2.loading, s3.body, s3.error, s3.loading],
  )
  const needPrices = catOk && shownIds.some((id) => catalog.byId.get(id)?.compose)
  const barsOf = (i) => (needPrices && companies[i]?.state === 'ok' ? barsUrl(syms[i]) : null)
  const b0 = useMarketRead(barsOf(0), POLL)
  const b1 = useMarketRead(barsOf(1), POLL)
  const b2 = useMarketRead(barsOf(2), POLL)
  const b3 = useMarketRead(barsOf(3), POLL)
  const barReads = [b0, b1, b2, b3]
  const prices = {}
  syms.forEach((s, i) => {
    if (barsOf(i)) prices[s] = pricesOf(s, barReads[i], { warming: isWarmingError(barReads[i].error) })
  })
  const priceKey = syms.map((s) => `${prices[s]?.state}:${prices[s]?.closes?.length || 0}`).join('|')
  const view = useMemo(
    () => (catOk ? fundView({ catalog, companies, metricIds: shownIds, prices, nowSec: clock.nowSec, today: clock.today }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catOk, catalog, companies, shownIds, priceKey, b0.body, b1.body, b2.body, b3.body, clock],
  )
  const main = companies[0]
  const ok = catOk && main?.state === 'ok'
  usePanelFreshness(ok && view ? panelAsOf(FUND_SOURCE, view.newestT) : null)

  // A choice writes itself into the command (`NVDA FUND AMD PE`), so the board keeps it; outside the
  // shell it stays in this panel's own state.
  const commit = (next) => {
    const p = next.peers ?? peers
    const m = next.metrics ?? chosen
    const l = Object.prototype.hasOwnProperty.call(next, 'line') ? next.line : lineId
    setPeers(p)
    setChosen(m)
    setLineId(l)
    writeBack(fundCommandArgs({ peers: p, metrics: m, line: l }), sym)
  }
  const inCatalogOrder = (list) => catalog.metrics.map((m) => m.id).filter((id) => list.includes(id))

  const frame = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-fund" data-state={state} data-sym={sym}>{body}</div>
  )
  if (catalogRead.loading) return frame('loading', <PanelSkeleton label="Loading the metrics library" testId="terminal-fund-loading" />)
  if (!catOk && catalog.state !== 'empty') {
    const f = fundFailure(catalogRead.body ? null : catalogRead.error)
    return frame(f.state, (
      <PanelState kind={f.kind} testId="terminal-fund-error" title={f.title}
        action={f.retry ? <button type="button" className={styles.chip} onClick={catalogRead.retry}>Retry</button> : null}>
        {f.hint || (f.retry ? `Retry, or run ${sym} ${code} again.` : null)}
      </PanelState>
    ))
  }
  if (catalog.state === 'empty') {
    return frame('empty', (
      <PanelState kind="empty" role="status" testId="terminal-fund-empty" title="The metrics library on this server has nothing this panel can show.">
        That is not the same as a company with no figures.
      </PanelState>
    ))
  }
  if (main.state === 'loading') return frame('loading', <PanelSkeleton label={`Loading ${sym}'s figures from its SEC filings`} testId="terminal-fund-loading" />)
  if (main.state === 'not_held') {
    return frame('not_held', (
      <PanelState kind="empty" role="status" testId="terminal-fund-not-held" title={main.words}>
        Try a US company that files 10-Qs, e.g. <kbd>NVDA {code}</kbd>.
      </PanelState>
    ))
  }
  if (main.state === 'failed') {
    return frame('failed', (
      <PanelState kind={main.retry ? 'error' : 'locked'} testId="terminal-fund-error" title={main.words}
        action={main.retry ? <button type="button" className={styles.chip} onClick={s0.retry}>Retry</button> : null}>
        {main.retry ? `That is not the same as no figures. Retry, or run ${sym} ${code} again.` : null}
      </PanelState>
    ))
  }

  const compare = syms.length > 1
  const lineView = !!lineId
  const tableGroups = view.groups.filter((g) => chosen.includes(g.metric.id))
  const shownMetrics = view.metrics.filter((m) => chosen.includes(m.id) || m.id === lineId)
  const columns = shownColumns(view.columns, showAll)
  const line = lineView ? fundLine(view, lineId) : null
  const lineOptions = catalog.metrics.filter((m) => shownIds.includes(m.id)).map((m) => ({ value: m.id, label: m.name }))
  const others = companies.slice(1).filter((c) => c.state !== 'ok' && c.state !== 'loading')
  const self = (Array.isArray(peersProp) ? peersProp : []).some((p) => String(p).replace(/^\$/, '').toUpperCase() === sym)
  const pricesFailed = syms.filter((s) => prices[s]?.state === 'failed' || prices[s]?.state === 'warming')
  const valuation = valuationNote(shownMetrics)
  const lag = lagNote(shownMetrics)
  const pickView = (v) => {
    if (v === 'line' && !lineView) commit({ line: inCatalogOrder(chosen)[0] || DEFAULT_METRICS[0] })
    if (v === 'table' && lineView) commit({ line: null })
  }
  const togglePick = (id) => setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : d.length >= MAX_METRICS ? d : [...d, id]))
  const apply = () => {
    const next = inCatalogOrder(draft)
    setDraft(null)
    if (next.length) commit({ metrics: next })
  }
  const addPeer = (text) => {
    const r = peerInput(text, { sym, peers })
    if (r.error) return r.error
    commit({ peers: [...peers, r.sym] })
    return null
  }
  const retryPrices = () => { b0.retry(); b1.retry(); b2.retry(); b3.retry() }

  return frame('ok', (
    <>
      {catalogRead.error || s0.error ? (
        <p className={styles.note} role="status" data-testid="terminal-fund-stale-read">{fundFailure(catalogRead.error || s0.error).title} Showing the last read.</p>
      ) : null}
      <p className={own.head} data-testid="terminal-fund-head">
        <PanelSymbol sym={sym} />
        {main.series.name ? <span className={own.coName}>{main.series.name}</span> : null}
        <span className={own.coName}>{view.newestT ? `Newest figure public ${dateText(etDay(view.newestT))}.` : 'No dated figure yet.'}</span>
      </p>
      <div className={styles.toolbar} role="toolbar" aria-label="Company metrics controls">
        <div className={styles.group} role="group" aria-label="View">
          <button type="button" className={styles.chip} aria-pressed={!lineView} onClick={() => pickView('table')} data-testid="terminal-fund-view-table">Table</button>
          <button type="button" className={styles.chip} aria-pressed={lineView} onClick={() => pickView('line')} data-testid="terminal-fund-view-line">Line</button>
        </div>
        <button type="button" className={styles.chip} aria-expanded={!!draft} aria-controls={pickerId}
          onClick={() => setDraft(draft ? null : [...chosen])} data-testid="terminal-fund-metrics">
          {`Metrics: ${tableGroups.length} of ${catalog.metrics.length}`}
        </button>
        {lineView ? (
          <label className={`${form.field} ${styles.pick}`}>
            Line
            <Select className={form.input} value={lineId} options={lineOptions} onChange={(e) => commit({ line: e.target.value })} data-testid="terminal-fund-line-metric" />
          </label>
        ) : (
          <button type="button" className={styles.chip} aria-pressed={showDates} onClick={() => setShowDates(!showDates)} data-testid="terminal-fund-dates">
            Show dates
          </button>
        )}
      </div>
      {draft ? (
        <Picker id={pickerId} catalog={catalog} draft={draft} onToggle={togglePick} onApply={apply}
          onDefault={() => setDraft([...DEFAULT_METRICS])} onCancel={() => setDraft(null)} />
      ) : null}
      <Compare peers={peers} onRemove={(p) => commit({ peers: peers.filter((x) => x !== p) })} onAdd={addPeer} />
      {self ? <p className={styles.muted} data-testid="terminal-fund-self">{`${sym} is the main ticker, so it is not compared with itself.`}</p> : null}
      {main.series.withheld ? (
        <p className={styles.note} role="status" data-testid="terminal-fund-withheld">
          {`${sym}'s split history could not be verified, so its per-share and share-count figures (EPS, shares, and the valuation built on them) are withheld rather than shown on the wrong share basis.`}
        </p>
      ) : null}
      {others.map((c) => (
        <p key={c.sym} className={styles.note} role="status" data-testid="terminal-fund-peer-note">
          {c.words}{' '}
          {c.state === 'failed' && c.retry ? (
            <button type="button" className={styles.chip} onClick={() => seriesReads[syms.indexOf(c.sym)].retry()}>Retry</button>
          ) : null}
        </p>
      ))}
      {pricesFailed.length ? (
        <p className={styles.note} role="status" data-testid="terminal-fund-prices-note">
          {pricesFailed.map((s) => prices[s].words).join(' ')}{' '}
          <button type="button" className={styles.chip} onClick={retryPrices}>Retry prices</button>
        </p>
      ) : null}
      {view.notInCatalog.length ? (
        <p className={styles.muted} data-testid="terminal-fund-not-in-catalog">
          {`Not in this server's metrics library, so not shown: ${view.notInCatalog.map((id) => WORD_OF_METRIC[id] || id).join(', ')}.`}
        </p>
      ) : null}
      {view.note ? <p className={styles.lede} data-testid="terminal-fund-align">{view.note}</p> : null}
      {view.merged.map((m) => (
        <p key={m.sym} className={styles.muted} data-testid="terminal-fund-merged">
          {`${m.sym} changed its fiscal year: the quarter${m.ends.length > 1 ? 's' : ''} ended ${m.ends.map(dateText).join(', ')} share a calendar quarter with a later one and ${m.ends.length > 1 ? 'are' : 'is'} left out here.`}
        </p>
      ))}
      {!view.columns.length ? (
        <PanelState kind="empty" compact role="status" testId="terminal-fund-no-quarters" title={`No quarter of ${sym}'s filings is held yet.`}>
          A company's figures start one year after its first XBRL filing.
        </PanelState>
      ) : lineView ? (
        <LinePicture line={line} compare={compare} />
      ) : (
        <>
          <PeriodTable groups={tableGroups} columns={columns} compare={compare} showDates={showDates} syms={syms} />
          {view.columns.length > TABLE_QUARTERS ? (
            <p className={styles.muted} role="status" data-testid="terminal-fund-cut">
              {showAll ? `All ${view.columns.length} quarters.` : `The newest ${TABLE_QUARTERS} of ${view.columns.length} quarters.`}{' '}
              <button type="button" className={styles.linkBtn} onClick={() => setShowAll(!showAll)} data-testid="terminal-fund-all">
                {showAll ? `Show the newest ${TABLE_QUARTERS}` : `Show all ${view.columns.length}`}
              </button>
            </p>
          ) : null}
          {tableGroups.some((g) => g.rows.some((r) => r.cells.some((c) => c.revised))) ? (
            <p className={styles.muted} data-testid="terminal-fund-revised">r: a later filing revised the figure; hover it for the first one.</p>
          ) : null}
        </>
      )}
      <details className={own.details} data-testid="terminal-fund-method">
        <summary className={own.summary}>How each figure is worked out</summary>
        <dl className={own.methods}>
          {shownMetrics.map((m) => (
            <div key={m.id} className={own.method}>
              <dt className={own.methodName}>{`${m.name} (${unitWords(m.unit)})`}</dt>
              <dd className={own.methodText}>{[m.methodology, ownLimitations(m)].filter(Boolean).join(' ')}</dd>
            </div>
          ))}
        </dl>
      </details>
      <div className={own.footer} data-testid="terminal-fund-footer">
        <p data-testid="terminal-fund-source">{`Source: ${FUND_SOURCE_LINE}`}</p>
        {valuation ? <p data-testid="terminal-fund-valuation">{valuation}</p> : null}
        {lag ? <p data-testid="terminal-fund-lag">{lag}</p> : null}
        <p>
          {compare
            ? 'One column per calendar quarter, newest first; each figure is the newest one held for that quarter.'
            : 'One column per fiscal quarter, newest first, headed by the quarter\'s last day; each figure is the newest one held for that quarter.'}
        </p>
      </div>
    </>
  ))
}

export default function FundMetricsPanel({ sym, peers, metrics, line }) {
  const s = String(sym || '').trim().toUpperCase()
  const code = useInTerminalPanel()?.code || FUND_CODE
  if (!s) {
    return (
      <PanelState kind="input" title={`${code} needs a ticker.`} testId="terminal-fund-input">
        Type one first, e.g. <kbd>NVDA {code}</kbd>, or compare: <kbd>NVDA {code} AMD AVGO</kbd>
      </PanelState>
    )
  }
  // Keyed by ticker: a new ticker is a new read, so one company's figures are never drawn under another's name.
  return <FundBody key={s} sym={s} code={code} peers={peers} metrics={metrics} line={line} />
}
