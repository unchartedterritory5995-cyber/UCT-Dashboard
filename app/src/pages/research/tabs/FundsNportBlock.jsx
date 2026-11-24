// app/src/pages/research/tabs/FundsNportBlock.jsx
//
// The OWN panel's "Funds (N-PORT)" block, below the Funds (13F) block of OwnershipTab (which is also the research
// page's Ownership tab): which mutual funds and ETFs hold the stock, and who added or cut since each fund's previous
// report, from the SEC's quarterly Form N-PORT data sets.
//
// Reads only the ownership answer the tab already holds (`funds_nport`: no read of its own). The rows, the words and
// the sorting are `fundNportModel.js`; this file draws them:
//   * who holds it and what changed (over every matched fund, not only the rows kept), the span of the periods, the
//     data sets read and how old a report can be;
//   * the funds in a table that sorts on any column (a header is a button; the header cell carries aria-sort) and
//     scrolls sideways inside SidewaysScroll with the fund column held in place; 20 rows, the rest on request;
//   * the funds that sold out, how this stock was matched to the funds' holdings, and the source line;
//   * a state with no table (not read yet, could not be matched, unreadable) in words.
// No screen-reader-only text sits inside the scrolling table: an off-screen span there once widened a whole panel.
import { useMemo, useState } from 'react'
import SidewaysScroll from '../../../components/research/fmpDepth/SidewaysScroll'
import depth from '../../../components/research/fmpDepth/FmpDepth.module.css'
import { ariaSortFor, sortCaretFor } from '../../../lib/presentation/dataGrid'
import {
  DEFAULT_ROWS, DEFAULT_SORT, NOT_KNOWN, NOT_REPORTED, NPORT_SOURCE, STATE_WORDS, nextNportSort, nportCheckLine,
  nportColumns, nportCoverageLine, nportHeldLine, nportMatchLine, nportPeriodLine, nportRows, nportSoldRows,
  nportStateWords, nportSummaryLines, nportTableName, soldMoreLine, soldText, sortNportRows, toneOf,
} from '../../terminal/panels/fundNportModel'
import css from './FundHoldersBlock.module.css'
import own from './FundsNportBlock.module.css'

function FundCell({ row }) {
  const name = row.name || 'Name not reported'
  const state = STATE_WORDS[row.state]
  return (
    <th scope="row" className={`${depth.rowHead} ${css.holderCell}`} data-col="fund">
      <span className={css.holder}>
        {row.url
          ? <a className={css.holderLink} href={row.url} target="_blank" rel="noopener noreferrer">{name}</a>
          : name}
      </span>
      {row.family && <span className={own.family}>{row.family}</span>}
      {state && <span className={`${css.state} ${state.tone ? css[state.tone] : own.plainState}`} data-fund-state={row.state}>{state.text}</span>}
    </th>
  )
}

function SoldList({ block }) {
  const rows = nportSoldRows(block)
  if (!rows.length) return null
  const more = soldMoreLine(block, rows.length)
  return (
    <div className={own.sold} data-testid="funds-nport-sold">
      <div className={own.soldTitle}>Sold out since the previous report</div>
      <ul className={own.soldList}>
        {rows.map((r) => (
          <li key={r.key} className={own.soldRow}>
            <span className={own.soldName}>
              {r.url
                ? <a className={css.holderLink} href={r.url} target="_blank" rel="noopener noreferrer">{r.name}</a>
                : r.name}
            </span>
            {r.family && <span className={own.family}>{r.family}</span>}
            <span className={css.line}>{soldText(r)}</span>
          </li>
        ))}
      </ul>
      {more && <div className={css.line} data-testid="funds-nport-sold-more">{more}</div>}
    </div>
  )
}

export default function FundsNportBlock({ block, sym }) {
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [showAll, setShowAll] = useState(false)
  const rows = useMemo(() => nportRows(block), [block])
  const columns = useMemo(() => nportColumns(rows), [rows])
  const sorted = useMemo(() => sortNportRows(rows, sort), [rows, sort])
  const visible = showAll ? sorted : sorted.slice(0, DEFAULT_ROWS)

  const state = block?.state
  const stateWords = nportStateWords(block, sym)
  const hasList = state === 'ok' || state === 'none_now'
  const summary = hasList ? nportSummaryLines(block) : []
  const check = nportCheckLine(block)
  const held = nportHeldLine({ shown: visible.length, rows: rows.length, total: block?.holders_total, limit: block?.holders_limit, sort })
  const name = nportTableName(block)
  const match = hasList ? nportMatchLine(block, sym) : null
  const showCoverage = hasList || state === 'not_matched'

  return (
    <div className={css.block} data-testid="funds-nport" data-state={state || 'none'}>
      {stateWords && (
        <div className={css.line} data-testid="funds-nport-state">{stateWords}</div>
      )}
      {(summary.length > 0 || hasList) && (
        <div className={css.lines}>
          {summary.map((line, i) => {
            // the first line says who holds it; with no current holder it is the change line, drawn plain
            const lead = i === 0 && state === 'ok'
            return <div key={line} className={lead ? css.summary : css.line} data-testid={lead ? 'funds-nport-summary' : undefined}>{line}</div>
          })}
          <div className={css.line} data-testid="funds-nport-period">{nportPeriodLine(block)}</div>
          {check && <div className={css.line} data-testid="funds-nport-check">{check}</div>}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <SidewaysScroll label={`${name}, scrolls sideways`}>
            <table className={depth.table} aria-label={name} data-testid="funds-nport-table">
              <thead>
                <tr>
                  {columns.map((c) => {
                    const active = sort.key === c.key
                    return (
                      <th key={c.key} scope="col" className={active ? css.sorted : undefined}
                        aria-sort={ariaSortFor(sort, c.key, undefined)}>
                        <button type="button" className={css.sortBtn} data-sort-key={c.key}
                          onClick={() => setSort((s) => nextNportSort(s, c.key))}>
                          {c.label}
                          {active && <span aria-hidden="true" className={css.caret}>{sortCaretFor(sort, c.key)}</span>}
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
                      if (c.key === 'fund') return <FundCell key={c.key} row={r} />
                      const body = c.cell(r)
                      const tone = toneOf(c, r)
                      const cls = tone ? css[tone] : (body === NOT_REPORTED || body === NOT_KNOWN || body === 'no earlier report') ? css.missing : undefined
                      return <td key={c.key} className={cls} data-col={c.key}>{body}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </SidewaysScroll>
          <div className={css.foot}>
            <span className={css.line} data-testid="funds-nport-held">{held}</span>
            {rows.length > DEFAULT_ROWS && (
              <button type="button" className={css.moreBtn} data-testid="funds-nport-more"
                onClick={() => setShowAll((v) => !v)}>
                {showAll ? `Show first ${DEFAULT_ROWS}` : `Show all ${rows.length}`}
              </button>
            )}
          </div>
        </>
      )}

      {hasList && <SoldList block={block} />}

      {(match || showCoverage) && (
        <div className={css.lines}>
          {match && <div className={css.line} data-testid="funds-nport-match">{match}</div>}
          {showCoverage && <div className={css.line} data-testid="funds-nport-coverage">{nportCoverageLine(block)}</div>}
        </div>
      )}
      <div className={css.line} data-testid="funds-nport-source">
        Source: {NPORT_SOURCE}. A report shows what a fund held on its period&apos;s last day, not when it bought or sold.
      </div>
    </div>
  )
}
