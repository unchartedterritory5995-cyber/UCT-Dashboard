// app/src/pages/research/tabs/FundHoldersBlock.jsx
//
// The OWN panel's "Funds (13F)" block, inside the Form 13F card of OwnershipTab (which is also the
// research page's Ownership tab and the calendar earnings modal's): which funds hold the stock and
// who added or cut last quarter.
//
// Reads only the ownership answer the tab already holds (`thirteen_f`: no read of its own). The rows,
// the words and the sorting are `fundHoldersModel.js`; this file draws them:
//   * the one-line summary of the quarter's position counts, the quarter end with how long ago it
//     was and the 45-day filing rule, and the quarter-end price the values use;
//   * every holder figure the answer carries, in a table that sorts on any column (a header is a
//     button; the header cell carries aria-sort) and scrolls sideways inside SidewaysScroll with the
//     holder column held in place;
//   * the first 20 rows, the rest on request, and where the list stops.
// No screen-reader-only text sits inside the scrolling table: an off-screen span there once widened a
// whole panel. Every word in it is visible.
import { useMemo, useState } from 'react'
import SidewaysScroll from '../../../components/research/fmpDepth/SidewaysScroll'
import depth from '../../../components/research/fmpDepth/FmpDepth.module.css'
import {
  DEFAULT_ROWS, DEFAULT_SORT, FUNDS_SOURCE, NOT_REPORTED, STATE_WORDS, boundRows, fundRows,
  fundsSummaryLine, heldLine, nextSort, noHoldersWords, presentColumns, priceLine, quarterFacts,
  secFilerUrl, sortFundRows, tableName, toneOf,
} from '../../terminal/panels/fundHoldersModel'
import css from './FundHoldersBlock.module.css'

function HolderCell({ row }) {
  const url = secFilerUrl(row.cik)
  const name = row.name || 'Name not reported'
  const state = STATE_WORDS[row.state]
  return (
    <th scope="row" className={`${depth.rowHead} ${css.holderCell}`} data-col="holder">
      <span className={css.holder}>
        {url
          ? <a className={css.holderLink} href={url} target="_blank" rel="noopener noreferrer">{name}</a>
          : name}
      </span>
      {state && <span className={`${css.state} ${css[state.tone]}`} data-holder-state={row.state}>{state.text}</span>}
    </th>
  )
}

export default function FundHoldersBlock({ tf, failed = false, now }) {
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [showAll, setShowAll] = useState(false)
  // "N days ago" is counted from when the block opened (a render stays pure)
  const [openedAt] = useState(() => Date.now())
  const rows = useMemo(() => fundRows(tf), [tf])
  const columns = useMemo(() => presentColumns(rows), [rows])
  const sorted = useMemo(() => sortFundRows(rows, sort), [rows, sort])
  const visible = boundRows(sorted, showAll)

  const quarter = quarterFacts(tf, rows, Number.isFinite(now) ? now : openedAt)
  const summary = fundsSummaryLine(tf?.summary)
  const price = priceLine(rows)
  const held = heldLine({
    total: rows.length, shown: visible.length, limit: tf?.holders_limit,
    investors: tf?.summary?.investors_holding, sort,
  })
  const name = tableName(tf)

  return (
    <div className={css.block} data-testid="funds-13f">
      <div className={css.lines}>
        {summary && <div className={css.summary} data-testid="funds-13f-summary">{summary}</div>}
        <div className={css.line} data-testid="funds-13f-quarter">{quarter.text}</div>
        {price && <div className={css.line} data-testid="funds-13f-price">{price}</div>}
      </div>

      {rows.length === 0 ? (
        <div className={css.line} data-testid="funds-13f-none" data-state={failed ? 'failed' : 'none'}>
          {noHoldersWords(failed)}
        </div>
      ) : (
        <>
          <SidewaysScroll label={`${name}, scrolls sideways`}>
            <table className={depth.table} aria-label={name} data-testid="funds-13f-table">
              <thead>
                <tr>
                  {columns.map((c) => {
                    const active = sort.key === c.key
                    return (
                      <th key={c.key} scope="col" className={active ? css.sorted : undefined}
                        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                        <button type="button" className={css.sortBtn} data-sort-key={c.key}
                          onClick={() => setSort((s) => nextSort(s, c.key))}>
                          {c.label}
                          {active && <span aria-hidden="true" className={css.caret}>{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.key}>
                    {columns.map((c) => {
                      if (c.key === 'holder') return <HolderCell key={c.key} row={r} />
                      const body = c.cell(r)
                      const tone = toneOf(c, r)
                      const cls = tone ? css[tone] : body === NOT_REPORTED ? css.missing : undefined
                      return <td key={c.key} className={cls} data-col={c.key}>{body}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </SidewaysScroll>
          <div className={css.foot}>
            <span className={css.line} data-testid="funds-13f-held">{held}</span>
            {rows.length > DEFAULT_ROWS && (
              <button type="button" className={css.moreBtn} data-testid="funds-13f-more"
                onClick={() => setShowAll((v) => !v)}>
                {showAll ? `Show first ${DEFAULT_ROWS}` : `Show all ${rows.length}`}
              </button>
            )}
          </div>
        </>
      )}

      <div className={css.line} data-testid="funds-13f-source">
        Source: {FUNDS_SOURCE}. A 13F shows what a filer held on the quarter&apos;s last day, not when it bought or sold.
      </div>
    </div>
  )
}
